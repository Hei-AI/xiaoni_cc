import express from 'express';
import winston from 'winston';
import {
  createTopicProjectionJob,
  createGoldenChatCase,
  createTopicReviewEvent,
  getChatSpaceTopicById,
  getTopicProjectionJobById,
  getTopicProjectionVersionById,
  listChatSpaceTopics,
  listGoldenChatCases,
  listTopicProjectionJobs,
  listTopicProjectionVersions,
  listTopicReviewEvents,
  listTopicVersionEvidence,
  listTopicVersionRelationships,
  updateTopicProjectionJob
} from '@qq-bot/persistence';
import { DatabaseManager } from '../services/database';

const PROVIDER_SERVICE_URL = process.env.PROVIDER_SERVICE_URL || 'http://qqbot-provider-service:8090';

type TopicWorkspaceVersionSummary = {
  id: number;
  version_number: number;
  status: string | null;
  lifecycle_state: string | null;
  title: string | null;
  summary_text: string;
  review_priority_score: number;
  heat_score: number;
  evidence_count: number;
  relationship_count: number;
  runtime_hit_count: number;
  last_runtime_hit_at: string | null;
  updated_at: string | null;
  created_at: string | null;
};

const CURRENT_TOPIC_STATES = new Set(['candidate', 'active', 'cooling', 'reopened']);

function parseChatSpaceType(value: unknown): 'group' | 'direct' | null {
  return value === 'group' || value === 'direct' ? value : null;
}

function toFiniteId(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

function toNullableString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function toNumber(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function sortVersionsDescending(left: any, right: any) {
  return toNumber(right.version_number) - toNumber(left.version_number)
    || new Date(right.updated_at || 0).getTime() - new Date(left.updated_at || 0).getTime()
    || toNumber(right.id) - toNumber(left.id);
}

function normalizeVersionSummary(version: any): TopicWorkspaceVersionSummary | null {
  if (!version) {
    return null;
  }

  return {
    id: toNumber(version.id),
    version_number: toNumber(version.version_number),
    status: toNullableString(version.status),
    lifecycle_state: toNullableString(version.lifecycle_state),
    title: toNullableString(version.title),
    summary_text: String(version.summary_text || ''),
    review_priority_score: toNumber(version.review_priority_score),
    heat_score: toNumber(version.heat_score),
    evidence_count: toNumber(version.evidence_count),
    relationship_count: toNumber(version.relationship_count),
    runtime_hit_count: toNumber(version.runtime_hit_count),
    last_runtime_hit_at: toNullableString(version.last_runtime_hit_at),
    updated_at: toNullableString(version.updated_at),
    created_at: toNullableString(version.created_at)
  };
}

function deriveLifecycleState(topic: any, acceptedVersion: any | null, candidateVersion: any | null) {
  return toNullableString(acceptedVersion?.lifecycle_state)
    || toNullableString(candidateVersion?.lifecycle_state)
    || toNullableString(topic?.status)
    || 'candidate';
}

function normalizeTopicSummary(params: {
  topic: any;
  acceptedVersion: any | null;
  candidateVersion: any | null;
  latestFailedVersion: any | null;
  reviewCount: number;
  goldenCaseCount: number;
}) {
  const { topic, acceptedVersion, candidateVersion, latestFailedVersion, reviewCount, goldenCaseCount } = params;
  const lifecycleState = deriveLifecycleState(topic, acceptedVersion, candidateVersion);
  const primaryVersion = acceptedVersion || candidateVersion || latestFailedVersion || null;

  return {
    id: toNumber(topic.id),
    chat_space_type: topic.chat_space_type,
    chat_space_id: toNumber(topic.chat_space_id),
    topic_status: toNullableString(topic.status),
    lifecycle_state: lifecycleState,
    canonical_title: toNullableString(topic.canonical_title),
    started_at: toNullableString(topic.started_at),
    last_activity_at: toNullableString(topic.last_activity_at),
    closed_at: toNullableString(topic.closed_at),
    current_accepted_version_id: toFiniteId(topic.current_accepted_version_id),
    current_candidate_version_id: toFiniteId(topic.current_candidate_version_id),
    accepted_version: normalizeVersionSummary(acceptedVersion),
    candidate_version: normalizeVersionSummary(candidateVersion),
    latest_failed_version: normalizeVersionSummary(latestFailedVersion),
    review_count: reviewCount,
    golden_case_count: goldenCaseCount,
    review_priority_score: primaryVersion ? toNumber(primaryVersion.review_priority_score) : 0,
    heat_score: primaryVersion ? toNumber(primaryVersion.heat_score) : 0
  };
}

async function buildTopicSummaries(topics: any[]) {
  const topicPayloads = await Promise.all(topics.map(async (topic) => {
    const versions = (await listTopicProjectionVersions({
      topicId: topic.id,
      limit: 20
    })).sort(sortVersionsDescending);
    const acceptedVersion = toFiniteId(topic.current_accepted_version_id)
      ? versions.find((version) => toNumber(version.id) === toNumber(topic.current_accepted_version_id)) || null
      : versions.find((version) => version.status === 'accepted') || null;
    const candidateVersion = toFiniteId(topic.current_candidate_version_id)
      ? versions.find((version) => toNumber(version.id) === toNumber(topic.current_candidate_version_id)) || null
      : versions.find((version) => version.status === 'candidate') || null;
    const latestFailedVersion = versions.find((version) => version.status === 'failed') || null;
    const [reviews, goldenCases] = await Promise.all([
      listTopicReviewEvents({ topicId: topic.id, limit: 200 }),
      listGoldenChatCases({ topicId: topic.id, limit: 200 })
    ]);

    return normalizeTopicSummary({
      topic,
      acceptedVersion,
      candidateVersion,
      latestFailedVersion,
      reviewCount: reviews.length,
      goldenCaseCount: goldenCases.length
    });
  }));

  return topicPayloads;
}

export function createTopicLabRoutes(_database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();

  router.get('/topic-lab/chat-spaces/:chatSpaceType/:chatSpaceId/workspace', async (req, res) => {
    try {
      const chatSpaceType = parseChatSpaceType(req.params.chatSpaceType);
      const chatSpaceId = toFiniteId(req.params.chatSpaceId);

      if (!chatSpaceType || !chatSpaceId) {
        return res.status(400).json({
          success: false,
          error: 'Invalid chat space',
          timestamp: new Date().toISOString()
        });
      }

      const [topics, jobs] = await Promise.all([
        listChatSpaceTopics({
          chatSpaceType,
          chatSpaceId,
          limit: 100
        }),
        listTopicProjectionJobs({
          chatSpaceType,
          chatSpaceId,
          limit: 20
        })
      ]);

      const summaries = await buildTopicSummaries(topics);
      const currentTopics = summaries
        .filter((topic) => CURRENT_TOPIC_STATES.has(topic.lifecycle_state))
        .sort((left, right) => right.review_priority_score - left.review_priority_score || right.heat_score - left.heat_score || right.id - left.id);
      const historicalTopics = summaries
        .filter((topic) => !CURRENT_TOPIC_STATES.has(topic.lifecycle_state))
        .sort((left, right) => new Date(right.last_activity_at || 0).getTime() - new Date(left.last_activity_at || 0).getTime() || right.id - left.id);

      return res.json({
        success: true,
        data: {
          chat_space_type: chatSpaceType,
          chat_space_id: chatSpaceId,
          current_topics: currentTopics,
          historical_topics: historicalTopics,
          latest_jobs: jobs
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch topic lab workspace', {
        error,
        params: req.params
      });
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch topic lab workspace',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/topic-lab/topics/:topicId', async (req, res) => {
    try {
      const topicId = toFiniteId(req.params.topicId);
      if (!topicId) {
        return res.status(400).json({
          success: false,
          error: 'Invalid topic id',
          timestamp: new Date().toISOString()
        });
      }

      const topic = await getChatSpaceTopicById(topicId);
      if (!topic) {
        return res.status(404).json({
          success: false,
          error: 'Topic not found',
          timestamp: new Date().toISOString()
        });
      }

      const [versions, reviews, goldenCases] = await Promise.all([
        listTopicProjectionVersions({ topicId, limit: 50 }),
        listTopicReviewEvents({ topicId, limit: 100 }),
        listGoldenChatCases({ topicId, limit: 100 })
      ]);
      const orderedVersions = versions.sort(sortVersionsDescending);
      const acceptedVersion = toFiniteId(topic.current_accepted_version_id)
        ? orderedVersions.find((version) => toNumber(version.id) === toNumber(topic.current_accepted_version_id)) || null
        : orderedVersions.find((version) => version.status === 'accepted') || null;
      const candidateVersion = toFiniteId(topic.current_candidate_version_id)
        ? orderedVersions.find((version) => toNumber(version.id) === toNumber(topic.current_candidate_version_id)) || null
        : orderedVersions.find((version) => version.status === 'candidate') || null;
      const latestFailedVersion = orderedVersions.find((version) => version.status === 'failed') || null;
      const detailVersion = acceptedVersion || candidateVersion || orderedVersions[0] || null;
      const [relationships, evidence] = detailVersion
        ? await Promise.all([
            listTopicVersionRelationships({ projectionVersionId: detailVersion.id, limit: 500 }),
            listTopicVersionEvidence({ projectionVersionId: detailVersion.id, limit: 500 })
          ])
        : [[], []];

      return res.json({
        success: true,
        data: {
          topic: normalizeTopicSummary({
            topic,
            acceptedVersion,
            candidateVersion,
            latestFailedVersion,
            reviewCount: reviews.length,
            goldenCaseCount: goldenCases.length
          }),
          versions: orderedVersions,
          detail_version: detailVersion,
          relationships,
          evidence,
          review_events: reviews,
          golden_cases: goldenCases
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch topic detail', {
        error,
        topicId: req.params.topicId
      });
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch topic detail',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.post('/topic-lab/topics/:topicId/reviews', async (req, res) => {
    try {
      const topicId = toFiniteId(req.params.topicId);
      if (!topicId) {
        return res.status(400).json({
          success: false,
          error: 'Invalid topic id',
          timestamp: new Date().toISOString()
        });
      }

      const topic = await getChatSpaceTopicById(topicId);
      if (!topic) {
        return res.status(404).json({
          success: false,
          error: 'Topic not found',
          timestamp: new Date().toISOString()
        });
      }

      const actionType = typeof req.body?.action_type === 'string' ? req.body.action_type.trim() : '';
      if (!actionType) {
        return res.status(400).json({
          success: false,
          error: 'Missing action_type',
          timestamp: new Date().toISOString()
        });
      }

      const applyNow = req.body?.apply_now === true;
      const created = await createTopicReviewEvent({
        topicId,
        baseProjectionVersionId: toFiniteId(req.body?.base_projection_version_id),
        resultProjectionVersionId: toFiniteId(req.body?.result_projection_version_id),
        actionType,
        status: typeof req.body?.status === 'string'
          ? req.body.status.trim()
          : applyNow ? 'recorded_pending_materialization' : 'recorded',
        createdBy: typeof req.body?.created_by === 'string' ? req.body.created_by.trim() : 'admin-panel',
        manualNote: typeof req.body?.manual_note === 'string' ? req.body.manual_note : null,
        patchJson: req.body?.patch_json && typeof req.body.patch_json === 'object' ? req.body.patch_json : null,
        metadata: {
          source: 'admin-panel',
          apply_now: applyNow
        }
      });

      if (applyNow) {
        const response = await fetch(`${PROVIDER_SERVICE_URL}/api/internal/topic-reviews/apply`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            review_event_id: Number(created.id)
          })
        });

        if (!response.ok) {
          return res.status(502).json({
            success: false,
            error: 'Failed to dispatch review materialization to provider-service',
            timestamp: new Date().toISOString()
          });
        }

        const payload = await response.json();
        return res.json(payload);
      }

      return res.json({
        success: true,
        data: created,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to create topic review event', {
        error,
        topicId: req.params.topicId,
        body: req.body
      });
      return res.status(500).json({
        success: false,
        error: 'Failed to create topic review event',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.post('/topic-lab/topics/:topicId/golden-cases', async (req, res) => {
    try {
      const topicId = toFiniteId(req.params.topicId);
      if (!topicId) {
        return res.status(400).json({
          success: false,
          error: 'Invalid topic id',
          timestamp: new Date().toISOString()
        });
      }

      const topic = await getChatSpaceTopicById(topicId);
      if (!topic) {
        return res.status(404).json({
          success: false,
          error: 'Topic not found',
          timestamp: new Date().toISOString()
        });
      }

      const fallbackVersionId = toFiniteId(topic.current_accepted_version_id) || toFiniteId(topic.current_candidate_version_id);
      const sourceProjectionVersionId = toFiniteId(req.body?.source_projection_version_id) || fallbackVersionId;
      if (!sourceProjectionVersionId) {
        return res.status(400).json({
          success: false,
          error: 'Missing source projection version',
          timestamp: new Date().toISOString()
        });
      }

      const sourceVersion = await getTopicProjectionVersionById(sourceProjectionVersionId);
      if (!sourceVersion || toNumber(sourceVersion.topic_id) !== topicId) {
        return res.status(400).json({
          success: false,
          error: 'Invalid source projection version',
          timestamp: new Date().toISOString()
        });
      }

      const created = await createGoldenChatCase({
        chatSpaceType: topic.chat_space_type,
        chatSpaceId: toNumber(topic.chat_space_id),
        topicId,
        sourceProjectionVersionId,
        label: typeof req.body?.label === 'string' ? req.body.label : null,
        status: typeof req.body?.status === 'string' ? req.body.status.trim() : 'active',
        inputBundleHash: toNullableString(req.body?.input_bundle_hash) || String(sourceVersion.input_bundle_hash || ''),
        expectedSnapshotJson: req.body?.expected_snapshot_json && typeof req.body.expected_snapshot_json === 'object'
          ? req.body.expected_snapshot_json
          : sourceVersion.snapshot_json || {},
        fixtureBundleJson: req.body?.fixture_bundle_json && typeof req.body.fixture_bundle_json === 'object'
          ? req.body.fixture_bundle_json
          : sourceVersion.provenance_json || {},
        createdBy: typeof req.body?.created_by === 'string' ? req.body.created_by.trim() : 'admin-panel',
        metadata: {
          source: 'admin-panel'
        }
      });

      return res.json({
        success: true,
        data: created,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to create golden chat case', {
        error,
        topicId: req.params.topicId,
        body: req.body
      });
      return res.status(500).json({
        success: false,
        error: 'Failed to create golden chat case',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.post('/topic-lab/topics/:topicId/reprojection', async (req, res) => {
    try {
      const topicId = toFiniteId(req.params.topicId);
      if (!topicId) {
        return res.status(400).json({
          success: false,
          error: 'Invalid topic id',
          timestamp: new Date().toISOString()
        });
      }

      const topic = await getChatSpaceTopicById(topicId);
      if (!topic) {
        return res.status(404).json({
          success: false,
          error: 'Topic not found',
          timestamp: new Date().toISOString()
        });
      }

      const fallbackVersionId = toFiniteId(topic.current_candidate_version_id) || toFiniteId(topic.current_accepted_version_id);
      const sourceProjectionVersionId = toFiniteId(req.body?.source_projection_version_id) || fallbackVersionId;
      if (!sourceProjectionVersionId) {
        return res.status(400).json({
          success: false,
          error: 'Missing source projection version',
          timestamp: new Date().toISOString()
        });
      }

      const sourceVersion = await getTopicProjectionVersionById(sourceProjectionVersionId);
      if (!sourceVersion || toNumber(sourceVersion.topic_id) !== topicId) {
        return res.status(400).json({
          success: false,
          error: 'Invalid source projection version',
          timestamp: new Date().toISOString()
        });
      }

      const sourceJobId = toFiniteId(sourceVersion.projection_job_id);
      if (!sourceJobId) {
        return res.status(400).json({
          success: false,
          error: 'Source version has no projection job',
          timestamp: new Date().toISOString()
        });
      }

      const sourceJob = await getTopicProjectionJobById(sourceJobId);
      if (!sourceJob || !sourceJob.input_bundle_json || typeof sourceJob.input_bundle_json !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'Source projection job is missing immutable input bundle',
          timestamp: new Date().toISOString()
        });
      }

      const createdJob = await createTopicProjectionJob({
        chatSpaceType: topic.chat_space_type,
        chatSpaceId: toNumber(topic.chat_space_id),
        triggerType: 'manual_reprojection',
        status: 'pending',
        inputBundleJson: sourceJob.input_bundle_json,
        inputBundleHash: String(sourceJob.input_bundle_hash || ''),
        baseVersionIds: [sourceProjectionVersionId],
        modelName: toNullableString(req.body?.model_name) || toNullableString(sourceJob.model_name),
        modelConfigJson: sourceJob.model_config_json && typeof sourceJob.model_config_json === 'object'
          ? sourceJob.model_config_json
          : null,
        promptVersion: toNullableString(sourceJob.prompt_version),
        metadata: {
          source: 'admin-panel',
          reprojection_of_job_id: sourceJobId,
          reprojection_of_version_id: sourceProjectionVersionId,
          reason: toNullableString(req.body?.reason) || 'manual_reprojection'
        }
      });

      try {
        const response = await fetch(`${PROVIDER_SERVICE_URL}/api/internal/topic-projection/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            job_id: Number(createdJob.id)
          })
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          await updateTopicProjectionJob(Number(createdJob.id), {
            status: 'failed',
            errorCode: 'provider_execute_failed',
            errorMessage: errorText || `provider_execute_failed_http_${response.status}`,
            finishedAt: new Date()
          }).catch(() => undefined);
          return res.status(502).json({
            success: false,
            error: 'Failed to dispatch reprojection job to provider-service',
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        await updateTopicProjectionJob(Number(createdJob.id), {
          status: 'failed',
          errorCode: 'provider_execute_dispatch_failed',
          errorMessage: error instanceof Error ? error.message : 'provider_execute_dispatch_failed',
          finishedAt: new Date()
        }).catch(() => undefined);
        throw error;
      }

      return res.json({
        success: true,
        data: {
          job_id: Number(createdJob.id),
          status: 'pending',
          source_projection_version_id: sourceProjectionVersionId
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to trigger topic reprojection', {
        error,
        topicId: req.params.topicId,
        body: req.body
      });
      return res.status(500).json({
        success: false,
        error: 'Failed to trigger topic reprojection',
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
}

export default createTopicLabRoutes;

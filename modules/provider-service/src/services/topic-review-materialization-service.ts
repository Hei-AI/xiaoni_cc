import {
  createTopicProjectionVersionSnapshot,
  getChatSpaceTopicById,
  getTopicProjectionVersionById,
  getTopicReviewEventById,
  listTopicProjectionVersions,
  listTopicVersionEvidence,
  listTopicVersionRelationships,
  updateChatSpaceTopic,
  updateTopicProjectionVersion,
  updateTopicReviewEvent
} from '@qq-bot/persistence';
import { databaseConfig } from '../config';
import { logger } from '../utils/logger';

type TopicReviewMaterializationDeps = {
  getReviewEvent?: typeof getTopicReviewEventById;
  updateReviewEvent?: typeof updateTopicReviewEvent;
  getTopic?: typeof getChatSpaceTopicById;
  getVersion?: typeof getTopicProjectionVersionById;
  listVersions?: typeof listTopicProjectionVersions;
  listRelationships?: typeof listTopicVersionRelationships;
  listEvidence?: typeof listTopicVersionEvidence;
  createVersionSnapshot?: typeof createTopicProjectionVersionSnapshot;
  updateVersion?: typeof updateTopicProjectionVersion;
  updateTopic?: typeof updateChatSpaceTopic;
  now?: () => Date;
};

function toFiniteId(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

function normalizeString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function sortVersionsDescending(left: any, right: any) {
  return Number(right.version_number || 0) - Number(left.version_number || 0)
    || new Date(right.updated_at || 0).getTime() - new Date(left.updated_at || 0).getTime()
    || Number(right.id || 0) - Number(left.id || 0);
}

export class TopicReviewMaterializationService {
  private readonly moduleLogger = logger.createModuleLogger('topic-review-materialization');
  private readonly getReviewEvent: typeof getTopicReviewEventById;
  private readonly updateReviewEvent: typeof updateTopicReviewEvent;
  private readonly getTopic: typeof getChatSpaceTopicById;
  private readonly getVersion: typeof getTopicProjectionVersionById;
  private readonly listVersions: typeof listTopicProjectionVersions;
  private readonly listRelationships: typeof listTopicVersionRelationships;
  private readonly listEvidence: typeof listTopicVersionEvidence;
  private readonly createVersionSnapshot: typeof createTopicProjectionVersionSnapshot;
  private readonly updateVersion: typeof updateTopicProjectionVersion;
  private readonly updateTopic: typeof updateChatSpaceTopic;
  private readonly now: () => Date;

  constructor(deps: TopicReviewMaterializationDeps = {}) {
    this.getReviewEvent = deps.getReviewEvent || ((id) => getTopicReviewEventById(id, databaseConfig));
    this.updateReviewEvent = deps.updateReviewEvent || ((id, updates) => updateTopicReviewEvent(id, updates, databaseConfig));
    this.getTopic = deps.getTopic || ((id) => getChatSpaceTopicById(id, databaseConfig));
    this.getVersion = deps.getVersion || ((id) => getTopicProjectionVersionById(id, databaseConfig));
    this.listVersions = deps.listVersions || ((filters) => listTopicProjectionVersions(filters, databaseConfig));
    this.listRelationships = deps.listRelationships || ((filters) => listTopicVersionRelationships(filters, databaseConfig));
    this.listEvidence = deps.listEvidence || ((filters) => listTopicVersionEvidence(filters, databaseConfig));
    this.createVersionSnapshot = deps.createVersionSnapshot || ((input) => createTopicProjectionVersionSnapshot(input, databaseConfig));
    this.updateVersion = deps.updateVersion || ((id, updates) => updateTopicProjectionVersion(id, updates, databaseConfig));
    this.updateTopic = deps.updateTopic || ((id, updates) => updateChatSpaceTopic(id, updates, databaseConfig));
    this.now = deps.now || (() => new Date());
  }

  async applyReviewEvent(reviewEventId: number) {
    const reviewEvent = await this.getReviewEvent(reviewEventId);
    if (!reviewEvent) {
      throw new Error('topic_review_event_not_found');
    }

    const topicId = toFiniteId(reviewEvent.topic_id);
    if (!topicId) {
      throw new Error('topic_review_event_missing_topic');
    }

    const topic = await this.getTopic(topicId);
    if (!topic) {
      throw new Error('topic_review_topic_not_found');
    }

    const versions = (await this.listVersions({ topicId, limit: 200 })).sort(sortVersionsDescending);
    const baseVersionId = toFiniteId(reviewEvent.base_projection_version_id)
      || toFiniteId(topic.current_candidate_version_id)
      || toFiniteId(topic.current_accepted_version_id)
      || toFiniteId(versions[0]?.id);
    if (!baseVersionId) {
      throw new Error('topic_review_missing_base_version');
    }

    const baseVersion = await this.getVersion(baseVersionId);
    if (!baseVersion || toFiniteId(baseVersion.topic_id) !== topicId) {
      throw new Error('topic_review_invalid_base_version');
    }

    await this.updateReviewEvent(reviewEventId, {
      status: 'materializing',
      metadata: {
        materialization_started_at: this.now().toISOString()
      }
    });

    try {
      const actionType = normalizeString(reviewEvent.action_type);
      if (actionType === 'approve_candidate' || actionType === 'approve') {
        await this.updateVersion(baseVersionId, {
          status: 'accepted'
        });
        await this.updateTopic(topicId, {
          currentAcceptedVersionId: baseVersionId,
          currentCandidateVersionId: null,
          status: baseVersion.lifecycle_state || topic.status || 'active',
          canonicalTitle: normalizeString(baseVersion.title) || topic.canonical_title || null,
          lastActivityAt: baseVersion.updated_at || this.now()
        });
        await this.updateReviewEvent(reviewEventId, {
          status: 'applied',
          resultProjectionVersionId: baseVersionId,
          metadata: {
            materialization_finished_at: this.now().toISOString(),
            action_type: actionType
          }
        });
        return {
          topicId,
          resultProjectionVersionId: baseVersionId,
          actionType,
          materialized: 'approve_candidate'
        };
      }

      if (actionType === 'retitle') {
        const patchJson = reviewEvent.patch_json && typeof reviewEvent.patch_json === 'object' ? reviewEvent.patch_json as Record<string, unknown> : {};
        const nextTitle = normalizeString(patchJson.title) || normalizeString(reviewEvent.manual_note);
        if (!nextTitle) {
          throw new Error('topic_review_retitle_missing_title');
        }

        const relationships = await this.listRelationships({ projectionVersionId: baseVersionId, limit: 500 });
        const evidence = await this.listEvidence({ projectionVersionId: baseVersionId, limit: 500 });
        const nextVersionNumber = versions.length > 0 ? Math.max(...versions.map((version) => Number(version.version_number || 0))) + 1 : 1;
        const snapshotJson = baseVersion.snapshot_json && typeof baseVersion.snapshot_json === 'object'
          ? { ...(baseVersion.snapshot_json as Record<string, unknown>), title: nextTitle }
          : { title: nextTitle };
        const provenanceJson = baseVersion.provenance_json && typeof baseVersion.provenance_json === 'object'
          ? {
              ...(baseVersion.provenance_json as Record<string, unknown>),
              review_event_id: reviewEventId,
              materialized_from_version_id: baseVersionId,
              materialized_at: this.now().toISOString(),
              materialization_action: 'retitle'
            }
          : {
              review_event_id: reviewEventId,
              materialized_from_version_id: baseVersionId,
              materialized_at: this.now().toISOString(),
              materialization_action: 'retitle'
            };

        const createdVersion = await this.createVersionSnapshot({
          topicId,
          projectionJobId: toFiniteId(baseVersion.projection_job_id),
          versionNumber: nextVersionNumber,
          status: 'candidate',
          lifecycleState: normalizeString(baseVersion.lifecycle_state) || 'active',
          title: nextTitle,
          summaryText: normalizeString(baseVersion.summary_text),
          reviewPriorityScore: Number(baseVersion.review_priority_score || 0),
          heatScore: Number(baseVersion.heat_score || 0),
          participantIds: Array.isArray(baseVersion.participant_ids) ? baseVersion.participant_ids : [],
          topicKeywords: Array.isArray(baseVersion.topic_keywords) ? baseVersion.topic_keywords : [],
          evidenceCount: Number(baseVersion.evidence_count || evidence.length),
          relationshipCount: Number(baseVersion.relationship_count || relationships.length),
          runtimeHitCount: Number(baseVersion.runtime_hit_count || 0),
          lastRuntimeHitAt: baseVersion.last_runtime_hit_at || null,
          inputBundleHash: String(baseVersion.input_bundle_hash || ''),
          snapshotJson,
          provenanceJson,
          metadata: {
            materialized_by: 'topic_review_materialization_service',
            review_event_id: reviewEventId
          },
          relationships: relationships.map((relationship: any) => ({
            targetUserId: relationship.target_user_id,
            relationshipKind: relationship.relationship_kind,
            summaryText: relationship.summary_text,
            actors: Array.isArray(relationship.actors) ? relationship.actors : [],
            sourceEventIds: Array.isArray(relationship.source_event_ids) ? relationship.source_event_ids : [],
            sourceMessageIds: Array.isArray(relationship.source_message_ids) ? relationship.source_message_ids : [],
            metadata: relationship.metadata && typeof relationship.metadata === 'object' ? relationship.metadata : {}
          })),
          evidence: evidence.map((item: any) => ({
            sourceKind: item.source_kind,
            sourceId: item.source_id,
            sortOrder: Number(item.sort_order || 0),
            excerptText: item.excerpt_text || null,
            speakerId: item.speaker_id || null,
            speakerName: item.speaker_name || null,
            occurredAt: item.occurred_at || null,
            metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : {}
          })),
          topicUpdates: {
            canonicalTitle: nextTitle,
            lastActivityAt: this.now()
          }
        });

        await this.updateTopic(topicId, {
          currentCandidateVersionId: createdVersion.id,
          canonicalTitle: nextTitle,
          lastActivityAt: this.now()
        });

        await this.updateReviewEvent(reviewEventId, {
          status: 'applied',
          resultProjectionVersionId: createdVersion.id,
          metadata: {
            materialization_finished_at: this.now().toISOString(),
            action_type: actionType
          }
        });
        return {
          topicId,
          resultProjectionVersionId: Number(createdVersion.id),
          actionType,
          materialized: 'retitle'
        };
      }

      throw new Error(`unsupported_topic_review_action:${actionType || 'unknown'}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'topic_review_materialization_failed';
      await this.updateReviewEvent(reviewEventId, {
        status: 'materialization_failed',
        metadata: {
          materialization_failed_at: this.now().toISOString(),
          error: message
        }
      }).catch(() => undefined);
      this.moduleLogger.error('Failed to materialize topic review event', {
        error: message,
        reviewEventId,
        topicId
      });
      throw error;
    }
  }
}

export default TopicReviewMaterializationService;

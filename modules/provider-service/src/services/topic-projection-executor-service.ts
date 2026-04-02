import {
  createChatSpaceTopic,
  createTopicProjectionVersionSnapshot,
  getTopicProjectionJobById,
  listChatSpaceTopics,
  listTopicProjectionVersions,
  updateChatSpaceTopic,
  updateTopicProjectionJob
} from '@qq-bot/persistence';
import { aiConfig, databaseConfig } from '../config';
import type { UnifiedLLMConfig } from '../types';
import { buildUnifiedConfig } from './provider-debug-service';
import { createProviderClient, resolveProviderId } from './llm-provider';
import type { LLMProvider, OpenResponseCreateRequest } from './llm-provider/types';
import { logger } from '../utils/logger';
import type { TopicProjectionInputBundle } from './topic-projection-service';

type TopicProjectionExecutionRequest = {
  jobId: number;
};

type TopicProjectionRelationshipDraft = {
  target_user_id: number;
  relationship_kind: string | null;
  summary_text: string;
  actors: string[];
  source_event_ids: number[];
  source_message_ids: number[];
  metadata: Record<string, unknown>;
};

type TopicProjectionDraft = {
  title: string;
  summary_text: string;
  lifecycle_state: string;
  review_priority_score: number;
  heat_score: number;
  participant_ids: number[];
  topic_keywords: string[];
  evidence_message_ids: number[];
  source_event_ids: number[];
  relationships: TopicProjectionRelationshipDraft[];
};

type TopicProjectionExecutionResult = {
  modelName: string;
  rawText: string;
  topics: TopicProjectionDraft[];
  createdVersionIds: number[];
  touchedTopicIds: number[];
};

type TopicProjectionExecutorDeps = {
  llmProviderFactory?: (providerId: ReturnType<typeof resolveProviderId>) => LLMProvider;
  now?: () => number;
  modelName?: string;
  getJob?: typeof getTopicProjectionJobById;
  updateJob?: typeof updateTopicProjectionJob;
  listTopics?: typeof listChatSpaceTopics;
  createTopic?: typeof createChatSpaceTopic;
  updateTopic?: typeof updateChatSpaceTopic;
  listVersions?: typeof listTopicProjectionVersions;
  createVersionSnapshot?: typeof createTopicProjectionVersionSnapshot;
};

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function truncateText(value: unknown, maxLength: number) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 1))}…`;
}

function clampScore(value: unknown, fallback: number) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
}

function normalizeNumericArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(
    value
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0)
      .map((item) => Math.trunc(item))
  ));
}

function normalizeStringArray(value: unknown, maxItems = 8): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(
    value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
  )).slice(0, maxItems);
}

function normalizeLifecycleState(value: unknown) {
  const state = typeof value === 'string' ? value.trim().toLowerCase() : '';
  switch (state) {
    case 'active':
    case 'cooling':
    case 'archived':
    case 'reopened':
    case 'candidate':
      return state;
    default:
      return 'active';
  }
}

function normalizeTopicStatus(value: string) {
  switch (value) {
    case 'archived':
      return 'archived';
    case 'cooling':
      return 'cooling';
    case 'reopened':
      return 'reopened';
    case 'active':
      return 'active';
    default:
      return 'candidate';
  }
}

function buildPromptPayload(bundle: TopicProjectionInputBundle) {
  return {
    chat_space_type: bundle.chat_space_type,
    chat_space_id: bundle.chat_space_id,
    session_key: bundle.session_key,
    trigger_type: bundle.trigger_type,
    summary_text: truncateText(bundle.summary_text, 300),
    transcript_compact_offset: bundle.transcript_compact_offset,
    estimated_input_tokens: bundle.estimated_input_tokens,
    turns: bundle.turns.map((turn) => ({
      conversation_id: turn.conversation_id,
      user_id: turn.user_id,
      group_id: turn.group_id,
      user_message: truncateText(turn.user_message, 180),
      ai_response: truncateText(turn.ai_response, 180),
      timestamp: turn.timestamp,
      source_message_ids: normalizeNumericArray(turn.source_message_ids)
    })),
    ledger_events: bundle.ledger_events.map((event) => ({
      id: event.id,
      target_user_id: event.target_user_id,
      event_type: event.event_type,
      event_weight: event.event_weight,
      confidence: event.confidence,
      source_message_ids: normalizeNumericArray(event.source_message_ids),
      source_excerpt: truncateText(event.source_excerpt, 180),
      created_at: event.created_at
    }))
  };
}

function buildTopicProjectionConfig(modelName: string, providerId: ReturnType<typeof resolveProviderId>): UnifiedLLMConfig {
  return buildUnifiedConfig(
    modelName,
    providerId,
    {
      advanced_config: {
        generationConfig: {
          temperature: 0.1,
          topP: 0.2,
          maxOutputTokens: 2200
        },
        thinkingConfig: {
          reasoningEffort: 'low'
        }
      }
    },
    undefined,
    null
  );
}

function buildTurnLookup(bundle: TopicProjectionInputBundle) {
  const lookup = new Map<number, TopicProjectionInputBundle['turns'][number]>();
  for (const turn of bundle.turns) {
    for (const sourceMessageId of normalizeNumericArray(turn.source_message_ids)) {
      if (!lookup.has(sourceMessageId)) {
        lookup.set(sourceMessageId, turn);
      }
    }
  }
  return lookup;
}

function buildEventLookup(bundle: TopicProjectionInputBundle) {
  return new Map<number, TopicProjectionInputBundle['ledger_events'][number]>(
    bundle.ledger_events
      .filter((event) => Number.isFinite(Number(event.id)) && Number(event.id) > 0)
      .map((event) => [Number(event.id), event])
  );
}

function deriveSourceEventIds(
  evidenceMessageIds: number[],
  eventIds: number[],
  bundle: TopicProjectionInputBundle
) {
  const explicit = normalizeNumericArray(eventIds);
  if (explicit.length > 0) {
    return explicit;
  }
  const evidenceSet = new Set(normalizeNumericArray(evidenceMessageIds));
  return bundle.ledger_events
    .filter((event) => normalizeNumericArray(event.source_message_ids).some((messageId) => evidenceSet.has(messageId)))
    .map((event) => Number(event.id))
    .filter((id) => Number.isFinite(id));
}

function normalizeRelationshipDraft(
  raw: unknown,
  bundle: TopicProjectionInputBundle
): TopicProjectionRelationshipDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const item = raw as Record<string, unknown>;
  const targetUserId = Number(item.target_user_id);
  const summaryText = truncateText(item.summary_text, 200);
  const sourceMessageIds = normalizeNumericArray(item.source_message_ids);
  if (!Number.isFinite(targetUserId) || targetUserId <= 0 || !summaryText || sourceMessageIds.length === 0) {
    return null;
  }

  const sourceEventIds = deriveSourceEventIds(sourceMessageIds, normalizeNumericArray(item.source_event_ids), bundle);
  return {
    target_user_id: Math.trunc(targetUserId),
    relationship_kind: truncateText(item.relationship_kind, 64) || null,
    summary_text: summaryText,
    actors: normalizeStringArray(item.actors),
    source_event_ids: sourceEventIds,
    source_message_ids: sourceMessageIds,
    metadata: {}
  };
}

function normalizeTopicDraft(
  raw: unknown,
  bundle: TopicProjectionInputBundle
): TopicProjectionDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const item = raw as Record<string, unknown>;
  const title = truncateText(item.title, 120);
  const summaryText = truncateText(item.summary_text, 320);
  const evidenceMessageIds = normalizeNumericArray(item.evidence_message_ids);
  if (!title || !summaryText || evidenceMessageIds.length === 0) {
    return null;
  }

  const participantIds = Array.from(new Set([
    ...normalizeNumericArray(item.participant_ids),
    ...evidenceMessageIds
      .map((messageId) => buildTurnLookup(bundle).get(messageId)?.user_id ?? null)
      .filter((userId): userId is number => Number.isFinite(userId))
  ]));
  const relationships = Array.isArray(item.relationships)
    ? item.relationships
      .map((relationship) => normalizeRelationshipDraft(relationship, bundle))
      .filter((relationship): relationship is TopicProjectionRelationshipDraft => Boolean(relationship))
    : [];
  for (const relationship of relationships) {
    if (!participantIds.includes(relationship.target_user_id)) {
      participantIds.push(relationship.target_user_id);
    }
  }

  return {
    title,
    summary_text: summaryText,
    lifecycle_state: normalizeLifecycleState(item.lifecycle_state),
    review_priority_score: clampScore(item.review_priority_score, 0.5),
    heat_score: clampScore(item.heat_score, 0.5),
    participant_ids: participantIds,
    topic_keywords: normalizeStringArray(item.topic_keywords),
    evidence_message_ids: evidenceMessageIds,
    source_event_ids: deriveSourceEventIds(evidenceMessageIds, normalizeNumericArray(item.source_event_ids), bundle),
    relationships
  };
}

function normalizeSnapshotTitle(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export class TopicProjectionExecutorService {
  private readonly moduleLogger = logger.createModuleLogger('topic-projection-executor');
  private readonly llmProviderFactory: (providerId: ReturnType<typeof resolveProviderId>) => LLMProvider;
  private readonly now: () => number;
  private readonly modelName: string;
  private readonly getJob: typeof getTopicProjectionJobById;
  private readonly updateJob: typeof updateTopicProjectionJob;
  private readonly listTopics: typeof listChatSpaceTopics;
  private readonly createTopic: typeof createChatSpaceTopic;
  private readonly updateTopic: typeof updateChatSpaceTopic;
  private readonly listVersions: typeof listTopicProjectionVersions;
  private readonly createVersionSnapshot: typeof createTopicProjectionVersionSnapshot;

  constructor(deps: TopicProjectionExecutorDeps = {}) {
    this.llmProviderFactory = deps.llmProviderFactory || createProviderClient;
    this.now = deps.now || (() => Date.now());
    this.modelName = deps.modelName || aiConfig.model_name || 'gemini-2.5-flash';
    this.getJob = deps.getJob || ((id) => getTopicProjectionJobById(id, databaseConfig));
    this.updateJob = deps.updateJob || ((id, updates) => updateTopicProjectionJob(id, updates, databaseConfig));
    this.listTopics = deps.listTopics || ((filters) => listChatSpaceTopics(filters, databaseConfig));
    this.createTopic = deps.createTopic || ((input) => createChatSpaceTopic(input, databaseConfig));
    this.updateTopic = deps.updateTopic || ((id, updates) => updateChatSpaceTopic(id, updates, databaseConfig));
    this.listVersions = deps.listVersions || ((filters) => listTopicProjectionVersions(filters, databaseConfig));
    this.createVersionSnapshot = deps.createVersionSnapshot || ((input) => createTopicProjectionVersionSnapshot(input, databaseConfig));
  }

  async executePersistedJob(params: TopicProjectionExecutionRequest): Promise<TopicProjectionExecutionResult> {
    const job = await this.getJob(params.jobId);
    if (!job) {
      throw new Error('topic_projection_job_not_found');
    }
    if (!job.input_bundle_json || typeof job.input_bundle_json !== 'object') {
      throw new Error('topic_projection_job_missing_bundle');
    }

    await this.updateJob(params.jobId, {
      status: 'running',
      startedAt: new Date(this.now()),
      errorCode: null,
      errorMessage: null
    });

    try {
      const bundle = job.input_bundle_json as TopicProjectionInputBundle;
      const execution = await this.execute(bundle);
      const materialized = await this.materializeTopics({
        jobId: Number(job.id),
        inputBundleHash: String(job.input_bundle_hash || ''),
        bundle,
        topics: execution.topics,
        modelName: execution.modelName
      });

      const jobMetadata = job.metadata && typeof job.metadata === 'object' ? job.metadata as Record<string, unknown> : {};
      await this.updateJob(params.jobId, {
        status: 'succeeded',
        modelName: execution.modelName,
        finishedAt: new Date(this.now()),
        metadata: {
          ...jobMetadata,
          result_topic_count: execution.topics.length,
          created_version_ids: materialized.createdVersionIds,
          touched_topic_ids: materialized.touchedTopicIds
        }
      });

      return {
        ...execution,
        createdVersionIds: materialized.createdVersionIds,
        touchedTopicIds: materialized.touchedTopicIds
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'topic_projection_execute_failed';
      await this.updateJob(params.jobId, {
        status: 'failed',
        errorCode: message,
        errorMessage: message,
        finishedAt: new Date(this.now())
      }).catch(() => undefined);
      throw error;
    }
  }

  async execute(bundle: TopicProjectionInputBundle): Promise<Omit<TopicProjectionExecutionResult, 'createdVersionIds' | 'touchedTopicIds'>> {
    const providerId = resolveProviderId(null, this.modelName);
    const provider = this.llmProviderFactory(providerId);
    const config = buildTopicProjectionConfig(this.modelName, providerId);
    const requestPayload = buildPromptPayload(bundle);
    const instructions = [
      '你是聊天空间主题投影器。你的任务是把一个聊天空间最近的对话 turns 和 ledger 事件，整理成 1 到 3 个可追溯的话题快照。',
      '必须严格依据输入，不要编造不存在的主题、人物关系或证据。',
      '只输出 JSON，不要输出解释、Markdown 或代码块外文字。',
      '每个 topic 必须包含：title, summary_text, lifecycle_state, review_priority_score, heat_score, participant_ids, topic_keywords, evidence_message_ids, source_event_ids, relationships。',
      'evidence_message_ids 必须来自 turns[*].source_message_ids。',
      'relationships 是 topic 内的人物关系投影数组。每项必须包含 target_user_id, relationship_kind, summary_text, actors, source_event_ids, source_message_ids。',
      '如果证据不足，返回空数组，不要硬写。',
      'lifecycle_state 只能是 active、cooling、archived、reopened、candidate。',
      'JSON schema: {"topics":[{"title":"string","summary_text":"string","lifecycle_state":"active","review_priority_score":0.8,"heat_score":0.7,"participant_ids":[123],"topic_keywords":["梗"],"evidence_message_ids":[1],"source_event_ids":[10],"relationships":[{"target_user_id":123,"relationship_kind":"inside_joke","summary_text":"string","actors":["小腻","对方"],"source_event_ids":[10],"source_message_ids":[1]}]}]}'
    ].join('\n');

    const request: OpenResponseCreateRequest = {
      model: this.modelName,
      instructions,
      input: [
        {
          type: 'message',
          role: 'user',
          content: JSON.stringify(requestPayload, null, 2)
        }
      ],
      temperature: 0.1,
      top_p: 0.2,
      max_output_tokens: 2200
    };

    const result = await provider.generateContent({
      modelName: this.modelName,
      providerConfig: config,
      request,
      context: {
        sessionId: bundle.session_key,
        agentType: 'topic_projection_executor',
        promptName: 'topic_projection_executor'
      }
    });

    return {
      modelName: result.modelName,
      rawText: result.text,
      topics: this.parseTopics(result.text, bundle)
    };
  }

  parseTopics(text: string, bundle: TopicProjectionInputBundle): TopicProjectionDraft[] {
    const parsed = parseJsonObject(text);
    if (!parsed) {
      throw new Error('topic_projection_non_json');
    }

    const rawTopics = Array.isArray(parsed.topics) ? parsed.topics : [];
    const drafts = rawTopics
      .slice(0, 3)
      .map((topic) => normalizeTopicDraft(topic, bundle))
      .filter((topic): topic is TopicProjectionDraft => Boolean(topic));

    const deduped = new Map<string, TopicProjectionDraft>();
    for (const draft of drafts) {
      const key = `${normalizeSnapshotTitle(draft.title)}:${draft.evidence_message_ids.join(',')}`;
      if (!deduped.has(key)) {
        deduped.set(key, draft);
      }
    }
    return Array.from(deduped.values());
  }

  private async materializeTopics(params: {
    jobId: number;
    inputBundleHash: string;
    bundle: TopicProjectionInputBundle;
    topics: TopicProjectionDraft[];
    modelName: string;
  }) {
    const existingTopics = await this.listTopics({
      chatSpaceType: params.bundle.chat_space_type,
      chatSpaceId: params.bundle.chat_space_id,
      limit: 200
    });

    const touchedTopicIds: number[] = [];
    const createdVersionIds: number[] = [];
    const turnLookup = buildTurnLookup(params.bundle);
    const eventLookup = buildEventLookup(params.bundle);

    for (const draft of params.topics) {
      const matchedTopic = existingTopics.find((topic) => normalizeSnapshotTitle(topic.canonical_title) === normalizeSnapshotTitle(draft.title)) || null;
      const topic = matchedTopic || await this.createTopic({
        chatSpaceType: params.bundle.chat_space_type,
        chatSpaceId: params.bundle.chat_space_id,
        status: normalizeTopicStatus(draft.lifecycle_state),
        canonicalTitle: draft.title,
        startedAt: this.findStartedAt(draft, params.bundle),
        lastActivityAt: this.findLastActivityAt(draft, params.bundle),
        lastProjectionJobId: params.jobId,
        metadata: {
          created_by: 'topic_projection_executor',
          identity_strategy: matchedTopic ? 'title_match' : 'new_topic'
        }
      });

      const versions = await this.listVersions({
        topicId: topic.id,
        limit: 100
      });
      const nextVersionNumber = versions.length > 0
        ? Math.max(...versions.map((version) => Number(version.version_number) || 0)) + 1
        : 1;

      const snapshot = {
        title: draft.title,
        summary_text: draft.summary_text,
        lifecycle_state: draft.lifecycle_state,
        review_priority_score: draft.review_priority_score,
        heat_score: draft.heat_score,
        participant_ids: draft.participant_ids,
        topic_keywords: draft.topic_keywords,
        evidence_message_ids: draft.evidence_message_ids,
        source_event_ids: draft.source_event_ids,
        relationships: draft.relationships
      };

      const evidence = [
        ...draft.evidence_message_ids.map((messageId, index) => {
          const turn = turnLookup.get(messageId);
          return {
            sourceKind: 'message',
            sourceId: messageId,
            sortOrder: index,
            excerptText: truncateText(turn?.user_message, 220),
            speakerId: turn ? String(turn.user_id) : null,
            speakerName: null,
            occurredAt: turn?.timestamp || null,
            metadata: {
              conversation_id: turn?.conversation_id ?? null,
              ai_response: turn?.ai_response ?? null,
              source_message_sids: turn?.source_message_sids ?? []
            }
          };
        }),
        ...draft.source_event_ids.map((eventId, index) => {
          const event = eventLookup.get(eventId);
          return {
            sourceKind: 'ledger_event',
            sourceId: eventId,
            sortOrder: draft.evidence_message_ids.length + index,
            excerptText: truncateText(event?.source_excerpt, 220),
            speakerId: event?.target_user_id ? String(event.target_user_id) : null,
            speakerName: null,
            occurredAt: event?.created_at || null,
            metadata: {
              event_type: event?.event_type ?? null,
              confidence: event?.confidence ?? null,
              event_weight: event?.event_weight ?? null,
              source_message_ids: event?.source_message_ids ?? []
            }
          };
        })
      ];

      const version = await this.createVersionSnapshot({
        topicId: topic.id,
        projectionJobId: params.jobId,
        versionNumber: nextVersionNumber,
        status: 'candidate',
        lifecycleState: draft.lifecycle_state,
        title: draft.title,
        summaryText: draft.summary_text,
        reviewPriorityScore: draft.review_priority_score,
        heatScore: draft.heat_score,
        participantIds: draft.participant_ids,
        topicKeywords: draft.topic_keywords,
        evidenceCount: evidence.length,
        relationshipCount: draft.relationships.length,
        inputBundleHash: params.inputBundleHash,
        snapshotJson: snapshot,
        provenanceJson: {
          source: 'topic_projection_executor',
          projection_job_id: params.jobId,
          input_bundle_hash: params.inputBundleHash,
          model_name: params.modelName,
          captured_at: params.bundle.captured_at
        },
        relationships: draft.relationships.map((relationship) => ({
          targetUserId: relationship.target_user_id,
          relationshipKind: relationship.relationship_kind,
          summaryText: relationship.summary_text,
          actors: relationship.actors,
          sourceEventIds: relationship.source_event_ids,
          sourceMessageIds: relationship.source_message_ids,
          metadata: relationship.metadata
        })),
        evidence,
        topicUpdates: {
          status: normalizeTopicStatus(draft.lifecycle_state),
          canonicalTitle: draft.title,
          startedAt: topic.started_at || this.findStartedAt(draft, params.bundle),
          lastActivityAt: this.findLastActivityAt(draft, params.bundle),
          lastProjectionJobId: params.jobId,
          metadata: {
            updated_by: 'topic_projection_executor',
            last_input_bundle_hash: params.inputBundleHash
          }
        }
      });

      await this.updateTopic(topic.id, {
        currentCandidateVersionId: version.id,
        lastProjectionJobId: params.jobId
      });
      touchedTopicIds.push(Number(topic.id));
      createdVersionIds.push(Number(version.id));
    }

    return { touchedTopicIds, createdVersionIds };
  }

  private findStartedAt(draft: TopicProjectionDraft, bundle: TopicProjectionInputBundle) {
    const timestamps = [
      ...draft.evidence_message_ids
        .map((messageId) => buildTurnLookup(bundle).get(messageId)?.timestamp || null)
        .filter((value): value is string => Boolean(value)),
      ...draft.source_event_ids
        .map((eventId) => buildEventLookup(bundle).get(eventId)?.created_at || null)
        .filter((value): value is string => Boolean(value))
    ];
    if (timestamps.length === 0) {
      return bundle.captured_at;
    }
    return timestamps.sort()[0];
  }

  private findLastActivityAt(draft: TopicProjectionDraft, bundle: TopicProjectionInputBundle) {
    const timestamps = [
      ...draft.evidence_message_ids
        .map((messageId) => buildTurnLookup(bundle).get(messageId)?.timestamp || null)
        .filter((value): value is string => Boolean(value)),
      ...draft.source_event_ids
        .map((eventId) => buildEventLookup(bundle).get(eventId)?.created_at || null)
        .filter((value): value is string => Boolean(value))
    ];
    if (timestamps.length === 0) {
      return bundle.captured_at;
    }
    return timestamps.sort().slice(-1)[0];
  }
}

export default TopicProjectionExecutorService;

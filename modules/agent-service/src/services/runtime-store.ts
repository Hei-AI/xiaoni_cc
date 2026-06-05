import {
  createAgentMediaObservation,
  createAgentTask,
  createFeedbackEpisode,
  createSqlAdapter,
  createFeedbackReflection,
  appendIdentityChangeCandidate,
  createAcceptedIdentityFact,
  ensureAgentMediaSchema,
  ensureAgentTaskSchema,
  ensureAgentPresenceSchema,
  ensureAgentLifeEventSchema,
  ensureIdentityLineageSchema,
  ensureXiaoniIdentityRoot,
  ensureFeedbackReflectionSchema,
  getAgentMediaAssetByTag,
  getFeedbackLearningState,
  listAgentMediaAssets,
  listAcceptedIdentityFacts,
  getTopicProjectionVersionById,
  listFeedbackLearningStates,
  listAgentInboundMessages,
  listQqUsageThreads,
  listQqUsageThreadWindow,
  getQqUsageUnreadSummary,
  markQqUsageThreadRead,
  listFeedbackReflections,
  recordRuntimeIdentityActivationTrace,
  listSelfEvolutionStates,
  listChatSpaceTopics,
  markFeedbackReflectionsHit,
  upsertFeedbackLearningState,
  ensureRelationshipTrustSchema,
  getRelationshipTrustLevel,
  upsertRelationshipTrust,
  ensureAgentLifeState,
  getAgentLifeState,
  updateAgentLifeState,
  upsertAgentGroupPresenceState,
  listAgentSharePoolItems,
  createAgentShareItemUsage,
  createAgentPresenceStateSidecar,
  listAgentLifeEvents,
  recordAgentLifeEvent,
  createAgentMemoryAssertion,
  createAgentMemoryObservation,
  createAgentMemoryReflection,
  ensureAgentMemorySchema,
  incrementRelationshipTrust,
  serializeTimestampForApi,
  type AgentLifeEventProjection,
  type QqUsageThreadList,
  type QqUsageThreadWindow,
  type QqUsageUnreadSummary,
  type RecordAgentLifeEventInput,
  type SqlAdapter
} from '@qq-bot/persistence';
import { v4 as uuidv4 } from 'uuid';
import { agentConfig, databaseConfig } from '../config';
import { logger } from '../utils/logger';
import {
  PRESENCE_FATIGUE_RECOVERY_THRESHOLD,
  scoreSharePoolItem,
  type PresenceAnchors,
  type PresenceSharePoolItem
} from './presence-context';
import {
  reduceXiaoniLifeState,
  XIAONI_LIFE_PROJECTION_VERSION,
  type XiaoniLifeStateExplanation,
  type XiaoniLifeStateProjection
} from './xiaoni-life-reducer';
import type { UnreadMeaningSocialActType } from '../types/social-act-type';
import {
  ConversationTranscriptItem,
  ConversationTranscriptPhase,
  ConversationTranscriptRole,
  ConversationTranscriptSource,
  ConversationTurn,
  FinalizedInboundContext,
  QueueBatchMessage,
  QueueMessagePayload,
  QueueMessageRecord
} from '../types';
import { renderRuntimeBatchMessage } from './runtime-input-renderer';

const moduleLogger = logger.createModuleLogger('runtime-store');

type QueueRow = {
  id: number;
  trace_id: string;
  batch_id: string | null;
  run_id: string | null;
  source: string;
  message_sid: string;
  chat_type: string;
  session_key: string;
  peer_id: string;
  peer_name: string | null;
  sender_id: string;
  sender_name: string | null;
  account_id: string;
  body_for_agent: string;
  raw_payload: string | Record<string, unknown>;
  inbound_context: string | Record<string, unknown>;
  status: string;
  attempts: number;
  created_at: string | Date;
  processing_started_at: string | Date | null;
  completed_at: string | Date | null;
  conversation_id: number | null;
  error_message: string | null;
  payload: string | Record<string, unknown>;
};

type AgentLifeStateRow = {
  last_active_at?: Date | string | null;
  service_started_at?: Date | string | null;
  last_boredom_reset_at?: Date | string | null;
  last_sleep_at?: Date | string | null;
  last_presence_tick_enqueued_at?: Date | string | null;
  last_proactive_at?: Date | string | null;
  last_user_message_at?: Date | string | null;
  daily_proactive_count?: number | string | null;
  daily_proactive_date?: Date | string | null;
  projection_json?: Record<string, unknown> | null;
  explanation_json?: Record<string, unknown> | null;
  reduced_through_event_id?: bigint | number | string | null;
  reduced_through_occurred_at?: Date | string | null;
  projection_version?: string | null;
  projection_updated_at?: Date | string | null;
};

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSameUtcDate(left: Date | string | null | undefined, right: Date) {
  const leftDate = toValidDate(left);
  return Boolean(leftDate
    && leftDate.getUTCFullYear() === right.getUTCFullYear()
    && leftDate.getUTCMonth() === right.getUTCMonth()
    && leftDate.getUTCDate() === right.getUTCDate());
}

export function buildPresenceAnchorsFromLife(life: AgentLifeStateRow, now: Date): PresenceAnchors {
  const dailyProactiveCount = isSameUtcDate(life.daily_proactive_date, now)
    ? Number(life.daily_proactive_count || 0)
    : 0;
  return {
    now,
    lastActiveAt: life.last_active_at ?? null,
    serviceStartedAt: life.service_started_at ?? null,
    lastBoredomResetAt: life.last_boredom_reset_at ?? null,
    lastSleepAt: life.last_sleep_at ?? null,
    lastPresenceTickEnqueuedAt: life.last_presence_tick_enqueued_at ?? null,
    lastProactiveAt: life.last_proactive_at ?? null,
    lastUserMessageAt: life.last_user_message_at ?? null,
    dailyProactiveCount
  };
}

function normalizeProjectionJson(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function eventOccurredAfterProjection(
  event: AgentLifeEventProjection,
  reducedThroughEventId: bigint | null,
  reducedThroughOccurredAt: Date | null
) {
  if (!reducedThroughEventId || !reducedThroughOccurredAt) {
    return true;
  }
  const occurredAt = event.occurredAt ? new Date(event.occurredAt) : null;
  if (!occurredAt || Number.isNaN(occurredAt.getTime())) {
    return true;
  }
  if (occurredAt.getTime() > reducedThroughOccurredAt.getTime()) {
    return true;
  }
  if (occurredAt.getTime() < reducedThroughOccurredAt.getTime()) {
    return false;
  }
  try {
    return BigInt(event.id || '0') > reducedThroughEventId;
  } catch {
    return true;
  }
}

function projectionEventId(value: bigint | number | string | null | undefined): bigint | null {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

const REST_RECOVERY_BUCKET_MS = 60 * 60 * 1000;
const SLEEP_RECOVERY_BUCKET_MS = 6 * 60 * 60 * 1000;
const VISIBLE_REPLY_BASE_ACTION_COST = 0.01;
const VISIBLE_REPLY_EXTRA_MESSAGE_ACTION_COST = 0.005;
const VISIBLE_REPLY_MAX_ACTION_COST = 0.02;

function shanghaiHour(now: Date) {
  const value = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    hourCycle: 'h23'
  }).format(now);
  const hour = Number.parseInt(value, 10);
  return Number.isFinite(hour) ? hour : now.getHours();
}

function compactContributor(contributor: XiaoniLifeStateExplanation['contributors'][number]) {
  return [
    contributor.effect
  ].filter(Boolean).join(' ');
}

function actionCostContributors(explanation: XiaoniLifeStateExplanation) {
  return explanation.contributors
    .filter((item) => item.eventKind !== 'rest_period'
      && item.eventKind !== 'sleep_period'
      && item.eventKind !== 'presence_tick_evaluated')
    .slice(0, 5);
}

function recoveryContributors(explanation: XiaoniLifeStateExplanation) {
  return explanation.contributors
    .filter((item) => item.eventKind === 'rest_period' || item.eventKind === 'sleep_period')
    .slice(0, 3);
}

function metric(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

function renderRecoveryLabel(
  eventKind: 'rest_period' | 'sleep_period',
  state: XiaoniLifeStateProjection['state']
) {
  const energy = `当前精力=${metric(state.energy)}`;
  if (eventKind === 'sleep_period') {
    return `${energy}；暂不继续打开消息列表，记录休息恢复。`;
  }
  return `${energy}；暂不继续主动看群，记录短暂休息。`;
}

export function renderXiaoniLifeStateExplanation(explanation: XiaoniLifeStateExplanation) {
  const actionCosts = actionCostContributors(explanation)
    .map(compactContributor)
    .join('；');
  const recoveries = recoveryContributors(explanation)
    .map(compactContributor)
    .join('；');
  return [
    `现在的精力：${explanation.summary}`,
    actionCosts ? `最近行动消耗：${actionCosts}` : null,
    recoveries ? `刚才怎么恢复：${recoveries}` : null
  ].filter(Boolean).join('；');
}

function visibleReplyActionCost(messageCount: number) {
  const extraCount = Math.max(0, Math.floor(messageCount) - 1);
  return Math.min(
    VISIBLE_REPLY_MAX_ACTION_COST,
    VISIBLE_REPLY_BASE_ACTION_COST + (extraCount * VISIBLE_REPLY_EXTRA_MESSAGE_ACTION_COST)
  );
}

export function resolvePresenceRecoveryEvent(
  state: XiaoniLifeStateProjection['state'],
  now: Date
): {
  eventKind: 'rest_period' | 'sleep_period';
  reason: string;
  bucketMs: number;
} | null {
  if (state.fatigue <= PRESENCE_FATIGUE_RECOVERY_THRESHOLD) {
    return null;
  }
  const hour = shanghaiHour(now);
  if (hour >= 1 && hour < 9) {
    return {
      eventKind: 'sleep_period',
      reason: 'fatigue_sleep_window',
      bucketMs: SLEEP_RECOVERY_BUCKET_MS
    };
  }
  return {
    eventKind: 'rest_period',
    reason: 'fatigue_recovery',
    bucketMs: REST_RECOVERY_BUCKET_MS
  };
}

type StructuredReplayQueueRow = {
  id: number;
  trace_id: string;
  run_id: string | null;
  conversation_id: number | null;
  source: string;
  message_sid: string;
  chat_type: string;
  session_key: string;
  peer_id: string;
  peer_name: string | null;
  sender_id: string;
  sender_name: string | null;
  account_id: string;
  body_for_agent: string;
  raw_payload: string | Record<string, unknown>;
  inbound_context: string | Record<string, unknown>;
  payload: string | Record<string, unknown>;
  created_at: string | Date;
};

type StructuredReplayInboundRow = {
  id: number;
  trace_id: string;
  source: string;
  message_sid: string;
  chat_type: string;
  session_key: string;
  peer_id: string;
  peer_name: string | null;
  sender_id: string;
  sender_name: string | null;
  account_id: string;
  body_for_agent: string;
  raw_payload: string | Record<string, unknown>;
  inbound_context: string | Record<string, unknown>;
  created_at: string | Date;
};

type StructuredReplayToolRow = {
  id: number;
  trace_id: string;
  agent_turn: number | null;
  tool_call_id: string | null;
  tool_name: string;
  arguments: string | Record<string, unknown> | null;
  result: string | Record<string, unknown> | null;
  started_at: string | Date | null;
};

type StructuredReplayLlmCallRow = {
  id: number;
  trace_id: string;
  agent_turn: number | null;
  canonical_response: string | Record<string, unknown> | null;
  started_at: string | Date | null;
};

export type ExecutionLeaseDeliveryPhase = 'reasoning_open' | 'delivery_committed' | 'lease_released';

type ExecutionLeaseDeliveryStateRow = {
  delivery_phase: string | null;
  delivery_commit_count: number | string | null;
  blocked_delivery_attempt_count: number | string | null;
  last_blocked_delivery_reason: string | null;
};

export type ExecutionLeaseDeliveryState = {
  deliveryPhase: ExecutionLeaseDeliveryPhase;
  deliveryCommitCount: number;
  blockedDeliveryAttemptCount: number;
  lastBlockedDeliveryReason: string | null;
};

export type SessionReadCutoffState = {
  sessionKey: string;
  readCutoffAfterConversationId: number | null;
  lastContextWindowTokens: number | null;
  lastTargetBudgetTokens: number | null;
  lastHardBudgetTokens: number | null;
  contextSummary: string | null;
  pendingProactiveShare: string | null;
  pendingProactiveShareAge: number;
  updatedAt: string | null;
};

export type RuntimeSelfEvolutionState = {
  id: number;
  sessionKey: string;
  groupId: number | null;
  targetUserId: number | null;
  scopeType: string;
  version: number;
  socialPresenceBaseline: string;
  entryPreference: string;
  warmthBias: string;
  familiarityCeiling: string;
  topicResonance: string[];
  boundaryTendencies: Record<string, unknown>;
  reinforcedModes: string[];
  suppressedModes: string[];
  summaryText: string;
  sourceEventIds: number[];
  sourceMessageIds: number[];
  metadata: Record<string, unknown>;
  updatedAt: string | null;
};

export type RuntimeFeedbackReflection = {
  id: number;
  sessionKey: string;
  groupId: number | null;
  sourceUserId: number | null;
  sourceUserName: string | null;
  scopeType: string;
  learningKey: string;
  learningScope: string;
  reflectionType: string;
  feedbackKind: string;
  confidence: string;
  importanceScore: number;
  evidenceWeight: number;
  stabilityScore: number;
  summaryText: string;
  retrievalText: string | null;
  embeddingText: string | null;
  sourceMessageIds: number[];
  sourceEpisodeIds: number[];
  sourceConversationId: number | null;
  supersedesReflectionId: number | null;
  conflictGroupKey: string | null;
  metadata: Record<string, unknown>;
  lastHitAt: string | null;
  hitCount: number;
  updatedAt: string | null;
};

export type RuntimeFeedbackEpisode = {
  id: number;
  sessionKey: string;
  groupId: number | null;
  sourceUserId: number | null;
  sourceUserName: string | null;
  scopeType: string;
  eventKind: string;
  excerptText: string | null;
  sourceMessageIds: number[];
  sourceConversationId: number | null;
  eventImportance: number;
  sourceSalience: number;
  metadata: Record<string, unknown>;
  updatedAt: string | null;
};

export type RuntimePresenceContext = {
  sourceItems: PresenceSharePoolItem[];
  recallScores: Record<string, unknown>[];
  boundaryJudgments: Record<string, unknown>[];
  compressionMapping: Record<string, unknown>;
  lifeProjection: XiaoniLifeStateProjection;
  lifeExplanation: XiaoniLifeStateExplanation;
};

function isImmediateVisibleImWake(queueMessage: QueueMessagePayload) {
  if (queueMessage.presenceTick) {
    return false;
  }
  if (queueMessage.chatType === 'direct') {
    return true;
  }
  return Boolean(queueMessage.wasMentioned || queueMessage.messages.some((message) => {
    return Boolean(message.wasMentioned || message.inboundContext?.WasMentioned);
  }));
}

function normalizeLifeEventOccurredAt(value: unknown) {
  if (!value) {
    return new Date();
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function compactDedupePart(value: unknown, fallback: string) {
  const normalized = String(value || fallback).replace(/\s+/g, '_');
  return normalized.length > 80 ? normalized.slice(0, 80) : normalized;
}

function extractDeliveredTexts(toolResult: Record<string, unknown>) {
  if (!Array.isArray(toolResult.sent_messages)) {
    return [];
  }
  return toolResult.sent_messages
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean);
}

export type RuntimeFeedbackLearningState = {
  id: number;
  sessionKey: string;
  groupId: number | null;
  scopeType: string;
  learningKey: string;
  learningScope: string;
  scopeHash: string;
  stateType: string;
  activeReflectionId: number | null;
  latestReflectionId: number | null;
  activationWeight: number;
  recencyWeight: number;
  importanceWeight: number;
  sourceWeight: number;
  conflictPenalty: number;
  metadata: Record<string, unknown>;
  updatedAt: string | null;
};

export type RuntimeAcceptedIdentityFact = {
  id: number;
  identityKey: string;
  factKey: string;
  factText: string;
  factType: string;
  sourceCandidateId: number | null;
  sourceEventId: number | null;
  status: string;
  confidence: string;
  activationTags: string[];
  metadata: Record<string, unknown>;
  acceptedAt: string | null;
  updatedAt: string | null;
};

export type RuntimeTopicProjection = {
  topicId: number;
  versionId: number;
  source: 'candidate' | 'accepted';
  title: string;
  summaryText: string;
  lifecycleState: string;
  topicKeywords: string[];
  participantIds: number[];
  relationshipSummaries: string[];
  evidenceMessageIds: number[];
  heatScore: number;
  reviewPriorityScore: number;
  updatedAt: string | null;
};

export type RuntimeMemoryRagContext = {
  packSummary: string;
  timeScope: {
    oldestMessageAt: string | null;
    newestMessageAt: string | null;
  };
  segments: Array<{
    segmentId: string;
    reason: string;
    source: 'recent_turns' | 'summary_bridge';
    messageIds: number[];
    content: string;
  }>;
  bridgeNotes: Array<{
    kind: 'compact_bridge';
    summary: string;
  }>;
};

type FeedbackReflectionScore = {
  reflection: RuntimeFeedbackReflection;
  learningState: RuntimeFeedbackLearningState | null;
  bm25Score: number;
  embeddingScore: number;
  learningStateScore: number;
  evidenceScore: number;
  combinedScore: number;
};

type IdentityEvidenceRefParams = {
  sourceType: string;
  sourceId: string;
  traceId?: string | null;
  runId?: string | null;
  conversationId?: number | string | null;
  confidence?: string;
  redactionStatus?: string;
  metadata?: Record<string, unknown>;
};

function toIso(value: string | Date | null | undefined): string | null {
  return serializeTimestampForApi(value) as string | null;
}

function normalizeSearchText(value: string | null | undefined) {
  return (value || '').trim().toLowerCase();
}

function buildSearchTokens(text: string) {
  const normalized = normalizeSearchText(text)
    .replace(/[\s,，。！？!?:：;；、()[\]{}"']/g, ' ')
    .trim();
  if (!normalized) {
    return [];
  }

  const tokens = new Set<string>();
  for (const token of normalized.split(/\s+/).filter(Boolean)) {
    if (token.length >= 2) {
      tokens.add(token);
    }
  }

  const compact = normalized.replace(/\s+/g, '');
  for (let index = 0; index < compact.length - 1; index += 1) {
    const gram = compact.slice(index, index + 2);
    if (!/\s/.test(gram)) {
      tokens.add(gram);
    }
  }

  return Array.from(tokens);
}

function estimateBudgetLength(targetTokenBudget: number) {
  const normalized = Number.isFinite(targetTokenBudget) ? Math.max(1024, Math.trunc(targetTokenBudget)) : 12000;
  return normalized * 3;
}

function renderTranscriptItemForMemoryPack(turn: ConversationTurn) {
  const transcriptItems = Array.isArray(turn.items) ? turn.items : [];
  if (transcriptItems.length > 0) {
    return transcriptItems
      .map((item) => `${item.role}${item.phase ? `/${item.phase}` : ''}: ${item.content}`)
      .join('\n');
  }

  return [
    `user: ${turn.userMessage}`,
    turn.aiResponse ? `assistant: ${turn.aiResponse}` : ''
  ].filter(Boolean).join('\n');
}

function parseSelfEvolutionState(row: Record<string, unknown>): RuntimeSelfEvolutionState {
  return {
    id: Number(row.id),
    sessionKey: typeof row.session_key === 'string' ? row.session_key : '',
    groupId: row.group_id === null || typeof row.group_id === 'undefined' ? null : Number(row.group_id),
    targetUserId: row.target_user_id === null || typeof row.target_user_id === 'undefined' ? null : Number(row.target_user_id),
    scopeType: typeof row.scope_type === 'string' ? row.scope_type : 'group_self',
    version: Number(row.version || 1),
    socialPresenceBaseline: typeof row.social_presence_baseline === 'string' ? row.social_presence_baseline : 'light',
    entryPreference: typeof row.entry_preference === 'string' ? row.entry_preference : 'cue_first',
    warmthBias: typeof row.warmth_bias === 'string' ? row.warmth_bias : 'warm_light',
    familiarityCeiling: typeof row.familiarity_ceiling === 'string' ? row.familiarity_ceiling : 'warm_not_performative',
    topicResonance: normalizeStringArray(row.topic_resonance),
    boundaryTendencies: row.boundary_tendencies && typeof row.boundary_tendencies === 'object' && !Array.isArray(row.boundary_tendencies)
      ? row.boundary_tendencies as Record<string, unknown>
      : {},
    reinforcedModes: normalizeStringArray(row.reinforced_modes),
    suppressedModes: normalizeStringArray(row.suppressed_modes),
    summaryText: typeof row.summary_text === 'string' ? row.summary_text : '',
    sourceEventIds: normalizeNumberArray(row.source_event_ids),
    sourceMessageIds: normalizeNumberArray(row.source_message_ids),
    metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {},
    updatedAt: toIso(row.updated_at as string | Date | null | undefined)
  };
}

function parseFeedbackReflection(row: Record<string, unknown>): RuntimeFeedbackReflection {
  return {
    id: Number(row.id),
    sessionKey: typeof row.session_key === 'string' ? row.session_key : '',
    groupId: row.group_id === null || typeof row.group_id === 'undefined' ? null : Number(row.group_id),
    sourceUserId: row.source_user_id === null || typeof row.source_user_id === 'undefined' ? null : Number(row.source_user_id),
    sourceUserName: typeof row.source_user_name === 'string' && row.source_user_name.trim() ? row.source_user_name.trim() : null,
    scopeType: typeof row.scope_type === 'string' ? row.scope_type : 'group_self',
    learningKey: typeof row.learning_key === 'string' && row.learning_key.trim() ? row.learning_key.trim() : 'feedback.general',
    learningScope: typeof row.learning_scope === 'string' && row.learning_scope.trim() ? row.learning_scope.trim() : 'group_self',
    reflectionType: typeof row.reflection_type === 'string' && row.reflection_type.trim() ? row.reflection_type.trim() : 'social_lesson',
    feedbackKind: typeof row.feedback_kind === 'string' ? row.feedback_kind : 'mixed',
    confidence: typeof row.confidence === 'string' ? row.confidence : 'medium',
    importanceScore: Number.isFinite(Number(row.importance_score)) ? Number(row.importance_score) : 0,
    evidenceWeight: Number.isFinite(Number(row.evidence_weight)) ? Number(row.evidence_weight) : 0,
    stabilityScore: Number.isFinite(Number(row.stability_score)) ? Number(row.stability_score) : 0,
    summaryText: typeof row.summary_text === 'string' ? row.summary_text.trim() : '',
    retrievalText: typeof row.retrieval_text === 'string' && row.retrieval_text.trim() ? row.retrieval_text.trim() : null,
    embeddingText: typeof row.embedding_text === 'string' && row.embedding_text.trim() ? row.embedding_text.trim() : null,
    sourceMessageIds: normalizeNumberArray(row.source_message_ids),
    sourceEpisodeIds: normalizeNumberArray(row.source_episode_ids),
    sourceConversationId: row.source_conversation_id === null || typeof row.source_conversation_id === 'undefined'
      ? null
      : Number(row.source_conversation_id),
    supersedesReflectionId: row.supersedes_reflection_id === null || typeof row.supersedes_reflection_id === 'undefined'
      ? null
      : Number(row.supersedes_reflection_id),
    conflictGroupKey: typeof row.conflict_group_key === 'string' && row.conflict_group_key.trim() ? row.conflict_group_key.trim() : null,
    metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {},
    lastHitAt: toIso(row.last_hit_at as string | Date | null | undefined),
    hitCount: Number.isFinite(Number(row.hit_count)) ? Number(row.hit_count) : 0,
    updatedAt: toIso(row.updated_at as string | Date | null | undefined)
  };
}

function parseFeedbackEpisode(row: Record<string, unknown>): RuntimeFeedbackEpisode {
  return {
    id: Number(row.id),
    sessionKey: typeof row.session_key === 'string' ? row.session_key : '',
    groupId: row.group_id === null || typeof row.group_id === 'undefined' ? null : Number(row.group_id),
    sourceUserId: row.source_user_id === null || typeof row.source_user_id === 'undefined' ? null : Number(row.source_user_id),
    sourceUserName: typeof row.source_user_name === 'string' && row.source_user_name.trim() ? row.source_user_name.trim() : null,
    scopeType: typeof row.scope_type === 'string' ? row.scope_type : 'group_self',
    eventKind: typeof row.event_kind === 'string' ? row.event_kind : 'feedback',
    excerptText: typeof row.excerpt_text === 'string' && row.excerpt_text.trim() ? row.excerpt_text.trim() : null,
    sourceMessageIds: normalizeNumberArray(row.source_message_ids),
    sourceConversationId: row.source_conversation_id === null || typeof row.source_conversation_id === 'undefined'
      ? null
      : Number(row.source_conversation_id),
    eventImportance: Number.isFinite(Number(row.event_importance)) ? Number(row.event_importance) : 0,
    sourceSalience: Number.isFinite(Number(row.source_salience)) ? Number(row.source_salience) : 0,
    metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {},
    updatedAt: toIso(row.updated_at as string | Date | null | undefined)
  };
}

function parseFeedbackLearningState(row: Record<string, unknown>): RuntimeFeedbackLearningState {
  return {
    id: Number(row.id),
    sessionKey: typeof row.session_key === 'string' ? row.session_key : '',
    groupId: row.group_id === null || typeof row.group_id === 'undefined' ? null : Number(row.group_id),
    scopeType: typeof row.scope_type === 'string' ? row.scope_type : 'group_self',
    learningKey: typeof row.learning_key === 'string' ? row.learning_key : '',
    learningScope: typeof row.learning_scope === 'string' ? row.learning_scope : '',
    scopeHash: typeof row.scope_hash === 'string' ? row.scope_hash : '',
    stateType: typeof row.state_type === 'string' ? row.state_type : 'reinforced',
    activeReflectionId: row.active_reflection_id === null || typeof row.active_reflection_id === 'undefined'
      ? null
      : Number(row.active_reflection_id),
    latestReflectionId: row.latest_reflection_id === null || typeof row.latest_reflection_id === 'undefined'
      ? null
      : Number(row.latest_reflection_id),
    activationWeight: Number.isFinite(Number(row.activation_weight)) ? Number(row.activation_weight) : 0,
    recencyWeight: Number.isFinite(Number(row.recency_weight)) ? Number(row.recency_weight) : 0,
    importanceWeight: Number.isFinite(Number(row.importance_weight)) ? Number(row.importance_weight) : 0,
    sourceWeight: Number.isFinite(Number(row.source_weight)) ? Number(row.source_weight) : 0,
    conflictPenalty: Number.isFinite(Number(row.conflict_penalty)) ? Number(row.conflict_penalty) : 0,
    metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {},
    updatedAt: toIso(row.updated_at as string | Date | null | undefined)
  };
}

function parseAcceptedIdentityFact(row: Record<string, unknown>): RuntimeAcceptedIdentityFact {
  return {
    id: Number(row.id),
    identityKey: typeof row.identity_key === 'string' ? row.identity_key : '',
    factKey: typeof row.fact_key === 'string' ? row.fact_key : '',
    factText: typeof row.fact_text === 'string' ? row.fact_text : '',
    factType: typeof row.fact_type === 'string' ? row.fact_type : 'self_boundary',
    sourceCandidateId: row.source_candidate_id === null || typeof row.source_candidate_id === 'undefined'
      ? null
      : Number(row.source_candidate_id),
    sourceEventId: row.source_event_id === null || typeof row.source_event_id === 'undefined'
      ? null
      : Number(row.source_event_id),
    status: typeof row.status === 'string' ? row.status : 'active',
    confidence: typeof row.confidence === 'string' ? row.confidence : 'medium',
    activationTags: normalizeStringArray(row.activation_tags),
    metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {},
    acceptedAt: toIso(row.accepted_at as string | Date | null | undefined),
    updatedAt: toIso(row.updated_at as string | Date | null | undefined)
  };
}

function parseRuntimeTopicProjection(params: {
  topicRow: Record<string, unknown>;
  versionRow: Record<string, unknown>;
  source: 'candidate' | 'accepted';
}): RuntimeTopicProjection | null {
  const snapshot = params.versionRow.snapshot_json && typeof params.versionRow.snapshot_json === 'object' && !Array.isArray(params.versionRow.snapshot_json)
    ? params.versionRow.snapshot_json as Record<string, unknown>
    : {};
  const title = typeof params.versionRow.title === 'string' && params.versionRow.title.trim()
    ? params.versionRow.title.trim()
    : typeof snapshot.title === 'string' && snapshot.title.trim()
      ? snapshot.title.trim()
      : typeof params.topicRow.canonical_title === 'string' && params.topicRow.canonical_title.trim()
        ? params.topicRow.canonical_title.trim()
        : '';
  const summaryText = typeof params.versionRow.summary_text === 'string' && params.versionRow.summary_text.trim()
    ? params.versionRow.summary_text.trim()
    : typeof snapshot.summary_text === 'string' && snapshot.summary_text.trim()
      ? snapshot.summary_text.trim()
      : '';
  if (!title || !summaryText) {
    return null;
  }

  const relationships = Array.isArray(snapshot.relationships)
    ? snapshot.relationships
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return '';
        }
        const summaryText = (item as Record<string, unknown>).summary_text;
        return typeof summaryText === 'string' ? summaryText.trim() : '';
      })
      .filter(Boolean)
      .slice(0, 4)
    : [];

  return {
    topicId: Number(params.topicRow.id),
    versionId: Number(params.versionRow.id),
    source: params.source,
    title,
    summaryText,
    lifecycleState: typeof params.versionRow.lifecycle_state === 'string' && params.versionRow.lifecycle_state.trim()
      ? params.versionRow.lifecycle_state.trim()
      : typeof snapshot.lifecycle_state === 'string' && snapshot.lifecycle_state.trim()
        ? snapshot.lifecycle_state.trim()
        : (typeof params.topicRow.status === 'string' && params.topicRow.status.trim() ? params.topicRow.status.trim() : 'active'),
    topicKeywords: normalizeStringArray(
      typeof params.versionRow.topic_keywords !== 'undefined'
        ? params.versionRow.topic_keywords
        : snapshot.topic_keywords
    ).slice(0, 8),
    participantIds: normalizeNumberArray(
      typeof params.versionRow.participant_ids !== 'undefined'
        ? params.versionRow.participant_ids
        : snapshot.participant_ids
    ),
    relationshipSummaries: relationships,
    evidenceMessageIds: normalizeNumberArray(
      typeof snapshot.evidence_message_ids !== 'undefined'
        ? snapshot.evidence_message_ids
        : params.versionRow.evidence_message_ids
    ),
    heatScore: Number.isFinite(Number(params.versionRow.heat_score)) ? Number(params.versionRow.heat_score) : 0,
    reviewPriorityScore: Number.isFinite(Number(params.versionRow.review_priority_score)) ? Number(params.versionRow.review_priority_score) : 0,
    updatedAt: toIso(params.versionRow.updated_at as string | Date | null | undefined) || toIso(params.topicRow.updated_at as string | Date | null | undefined)
  };
}

function normalizeScoreMap(scores: Map<number, number>) {
  let maxScore = 0;
  for (const score of scores.values()) {
    maxScore = Math.max(maxScore, score);
  }
  if (maxScore <= 0) {
    return new Map<number, number>();
  }

  const normalized = new Map<number, number>();
  for (const [cardId, score] of scores.entries()) {
    normalized.set(cardId, score / maxScore);
  }
  return normalized;
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function computeLastHitBoost(lastHitAt: string | null) {
  if (!lastHitAt) {
    return 0;
  }
  const ageMs = Date.now() - new Date(lastHitAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return 0;
  }
  const dayMs = 24 * 60 * 60 * 1000;
  if (ageMs <= dayMs) {
    return 1;
  }
  if (ageMs <= 7 * dayMs) {
    return 0.55;
  }
  return 0.15;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(value, 1));
}

function buildFeedbackReflectionSearchText(reflection: RuntimeFeedbackReflection) {
  return [
    reflection.learningKey,
    reflection.learningScope,
    reflection.reflectionType,
    reflection.feedbackKind,
    reflection.summaryText,
    reflection.retrievalText || '',
    reflection.embeddingText || ''
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .join('\n');
}

function computeFeedbackBm25Scores(reflections: RuntimeFeedbackReflection[], queryText: string) {
  const queryTokens = buildSearchTokens(queryText);
  if (queryTokens.length === 0 || reflections.length === 0) {
    return new Map<number, number>();
  }

  const documents = reflections.map((reflection) => {
    const tokens = buildSearchTokens(buildFeedbackReflectionSearchText(reflection));
    const frequencies = new Map<string, number>();
    for (const token of tokens) {
      frequencies.set(token, (frequencies.get(token) || 0) + 1);
    }
    return {
      reflectionId: reflection.id,
      length: Math.max(tokens.length, 1),
      frequencies
    };
  });
  const avgDocLength = documents.reduce((sum, document) => sum + document.length, 0) / documents.length;
  const docFrequency = new Map<string, number>();
  for (const token of queryTokens) {
    const count = documents.reduce((sum, document) => sum + (document.frequencies.has(token) ? 1 : 0), 0);
    docFrequency.set(token, count);
  }

  const scores = new Map<number, number>();
  const k1 = 1.2;
  const b = 0.75;
  for (const document of documents) {
    let score = 0;
    for (const token of queryTokens) {
      const termFrequency = document.frequencies.get(token) || 0;
      if (!termFrequency) {
        continue;
      }
      const df = docFrequency.get(token) || 0;
      const idf = Math.log(1 + ((documents.length - df + 0.5) / (df + 0.5)));
      const numerator = termFrequency * (k1 + 1);
      const denominator = termFrequency + k1 * (1 - b + b * (document.length / Math.max(avgDocLength, 1)));
      score += idf * (numerator / denominator);
    }
    scores.set(document.reflectionId, score);
  }
  return scores;
}

function computeFeedbackLearningStateScore(state: RuntimeFeedbackLearningState | null) {
  if (!state) {
    return 0;
  }
  return clamp01(
    state.activationWeight * 0.3
    + state.recencyWeight * 0.25
    + state.importanceWeight * 0.25
    + state.sourceWeight * 0.15
    - state.conflictPenalty * 0.2
  );
}

function computeFeedbackEvidenceScore(reflection: RuntimeFeedbackReflection) {
  return clamp01(
    reflection.importanceScore * 0.35
    + reflection.evidenceWeight * 0.35
    + reflection.stabilityScore * 0.2
    + (reflection.confidence === 'high' ? 0.1 : reflection.confidence === 'medium' ? 0.05 : 0)
  );
}

export function rankFeedbackReflectionsForRecall(params: {
  reflections: RuntimeFeedbackReflection[];
  learningStates: RuntimeFeedbackLearningState[];
  queryText: string;
  currentUserId: number;
  recentUserIds: number[];
  embeddingScores?: Map<number, number>;
  limit: number;
  socialActTypeHint?: UnreadMeaningSocialActType | null;
}) {
  const reflectionById = new Map(params.reflections.map((reflection) => [reflection.id, reflection]));
  const supersededIds = new Set(
    params.reflections
      .map((reflection) => reflection.supersedesReflectionId)
      .filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && reflectionById.has(id))
  );
  const stateByReflectionId = new Map<number, RuntimeFeedbackLearningState>();
  for (const state of params.learningStates) {
    if (typeof state.activeReflectionId === 'number' && reflectionById.has(state.activeReflectionId)) {
      stateByReflectionId.set(state.activeReflectionId, state);
    }
  }

  const activeReflectionIds = new Set(stateByReflectionId.keys());
  const baseReflections = params.reflections
    .filter((reflection) => !supersededIds.has(reflection.id) || activeReflectionIds.has(reflection.id));
  const bm25Scores = normalizeScoreMap(computeFeedbackBm25Scores(baseReflections, params.queryText));
  const embeddingScores = normalizeScoreMap(params.embeddingScores || new Map<number, number>());
  const recentUserIds = new Set(params.recentUserIds);

  const ranked = baseReflections
    .map((reflection) => {
      const learningState = stateByReflectionId.get(reflection.id) || null;
      const bm25Score = bm25Scores.get(reflection.id) || 0;
      const embeddingScore = embeddingScores.get(reflection.id) || 0;
      const learningStateScore = computeFeedbackLearningStateScore(learningState);
      const evidenceScore = computeFeedbackEvidenceScore(reflection);
      const sourceScore = reflection.sourceUserId === params.currentUserId
        ? 0.25
        : reflection.sourceUserId && recentUserIds.has(reflection.sourceUserId)
          ? 0.15
          : 0;
      const freshnessScore = reflection.updatedAt ? computeLastHitBoost(reflection.updatedAt) * 0.08 : 0;
      const hitPenalty = Math.min(reflection.hitCount * 0.03, 0.24);
      const conflictPenalty = learningState?.stateType === 'conflicted' ? 0.08 : 0;
      const actHintScore = (() => {
        if (!params.socialActTypeHint) return 0;
        if (params.socialActTypeHint === 'invitation_curiosity' && reflection.reflectionType === 'self_model_update') return 0.08;
        if (params.socialActTypeHint === 'relationship_probe' && reflection.reflectionType === 'social_lesson') return 0.06;
        return 0;
      })();
      return {
        reflection,
        learningState,
        bm25Score,
        embeddingScore,
        learningStateScore,
        evidenceScore,
        combinedScore: bm25Score * 0.36
          + embeddingScore * 0.32
          + learningStateScore * 0.16
          + evidenceScore * 0.1
          + sourceScore
          + freshnessScore
          + actHintScore
          - hitPenalty
          - conflictPenalty
      } satisfies FeedbackReflectionScore;
    })
    .filter((item) => item.bm25Score > 0 || item.embeddingScore >= 0.2)
    .sort((left, right) => (
      right.combinedScore - left.combinedScore
      || right.learningStateScore - left.learningStateScore
      || right.evidenceScore - left.evidenceScore
      || right.reflection.id - left.reflection.id
    ));

  const selected: FeedbackReflectionScore[] = [];
  const selectedKeys = new Set<string>();
  const selectedConflictGroups = new Set<string>();
  for (const item of ranked) {
    const learningKey = `${item.reflection.learningKey}\u0000${item.reflection.learningScope}`;
    if (selectedKeys.has(learningKey)) {
      continue;
    }
    const conflictGroupKey = item.reflection.conflictGroupKey;
    if (conflictGroupKey && selectedConflictGroups.has(conflictGroupKey)) {
      continue;
    }
    selected.push(item);
    selectedKeys.add(learningKey);
    if (conflictGroupKey) {
      selectedConflictGroups.add(conflictGroupKey);
    }
    if (selected.length >= Math.max(1, Math.min(params.limit, 3))) {
      break;
    }
  }

  return selected;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'object') {
    return value as T;
  }
  if (typeof value !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeDeliveryPhase(value: unknown): ExecutionLeaseDeliveryPhase {
  if (value === 'delivery_committed' || value === 'lease_released') {
    return value;
  }
  if (value === 'finished') {
    return 'lease_released';
  }
  return 'reasoning_open';
}

function mapExecutionLeaseDeliveryState(row?: Partial<ExecutionLeaseDeliveryStateRow> | null): ExecutionLeaseDeliveryState {
  return {
    deliveryPhase: normalizeDeliveryPhase(row?.delivery_phase),
    deliveryCommitCount: Number(row?.delivery_commit_count || 0),
    blockedDeliveryAttemptCount: Number(row?.blocked_delivery_attempt_count || 0),
    lastBlockedDeliveryReason: typeof row?.last_blocked_delivery_reason === 'string' && row.last_blocked_delivery_reason.trim().length > 0
      ? row.last_blocked_delivery_reason
      : null
  };
}

function buildBatchSummary(rows: QueueRow[]) {
  return rows.map((row, index) => `#${index + 1} ${row.sender_name || row.sender_id}: ${row.body_for_agent}`).join('\n');
}

function isPresenceTickPayload(queueMessage: QueueMessagePayload) {
  return queueMessage.source === 'presence_tick'
    || queueMessage.sessionKey === 'presence_tick:xiaoni'
    || Boolean((queueMessage as QueueMessagePayload & { presenceTick?: unknown }).presenceTick);
}

function buildTranscriptSessionId(userId: number, groupId?: number | null) {
  if (groupId && Number.isFinite(groupId)) {
    return `group:${groupId}`;
  }
  return `private:${userId}`;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function normalizeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.trunc(item));
}

type ConversationTranscriptItemInput = {
  sessionKey: string | null;
  role: ConversationTranscriptRole;
  phase?: ConversationTranscriptPhase | null;
  content: string;
  groupIndex: number;
  itemIndex: number;
  source: ConversationTranscriptSource;
  deliveryMessageId?: number | null;
  runId?: string | null;
  traceId?: string | null;
};

function buildLegacyConversationItems(params: {
  conversationId: number;
  sessionKey: string;
  userMessage: string;
  aiResponse: string | null;
  traceId?: string | null;
}): ConversationTranscriptItem[] {
  const items: ConversationTranscriptItem[] = [{
    id: null,
    conversationId: params.conversationId,
    sessionKey: params.sessionKey,
    role: 'user',
    phase: null,
    content: params.userMessage,
    groupIndex: 0,
    itemIndex: 0,
    source: 'legacy_user_message',
    deliveryMessageId: null,
    runId: null,
    traceId: params.traceId ?? null
  }];

  if (typeof params.aiResponse === 'string' && params.aiResponse.trim().length > 0) {
    items.push({
      id: null,
      conversationId: params.conversationId,
      sessionKey: params.sessionKey,
      role: 'assistant',
      phase: null,
      content: params.aiResponse,
      groupIndex: 1,
      itemIndex: 0,
      source: 'legacy_ai_response',
      deliveryMessageId: null,
      runId: null,
      traceId: params.traceId ?? null
    });
  }

  return items;
}

function buildQueueBatchMessageFromStructuredRow(row: StructuredReplayQueueRow): QueueBatchMessage {
  const payload = parseJson<Partial<QueueBatchMessage>>(row.payload, {});
  const defaultInboundContext: FinalizedInboundContext = {
    Body: payload.bodyForAgent || row.body_for_agent,
    BodyForAgent: payload.bodyForAgent || row.body_for_agent,
    BodyForCommands: payload.commandBody || payload.bodyForAgent || row.body_for_agent,
    CommandAuthorized: false
  };

  return {
    queueMessageId: Number(row.id),
    traceId: row.trace_id,
    source: row.source,
    messageId: payload.messageId ?? Number(row.id),
    messageSid: row.message_sid,
    chatType: row.chat_type === 'group' ? 'group' : 'direct',
    sessionKey: row.session_key,
    peerId: row.peer_id,
    peerName: row.peer_name || undefined,
    senderId: row.sender_id,
    senderName: row.sender_name || undefined,
    accountId: row.account_id,
    bodyForAgent: payload.bodyForAgent || row.body_for_agent,
    rawBody: payload.rawBody || payload.bodyForAgent || row.body_for_agent,
    commandBody: payload.commandBody || payload.bodyForAgent || row.body_for_agent,
    wasMentioned: Boolean(payload.wasMentioned),
    receivedAt: payload.receivedAt || toIso(row.created_at) || new Date().toISOString(),
    messageTimestamp: payload.messageTimestamp ?? null,
    rawPayload: parseJson<Record<string, unknown>>(row.raw_payload, {}),
    inboundContext: parseJson(row.inbound_context, defaultInboundContext)
  };
}

function buildQueueBatchMessageFromInboundRow(row: StructuredReplayInboundRow): QueueBatchMessage {
  const inboundContext = parseJson<FinalizedInboundContext>(row.inbound_context, {
    Body: row.body_for_agent,
    BodyForAgent: row.body_for_agent,
    BodyForCommands: row.body_for_agent,
    CommandAuthorized: false
  });

  return {
    queueMessageId: Number(row.id),
    traceId: row.trace_id,
    source: row.source,
    messageId: Number(row.id),
    messageSid: row.message_sid,
    chatType: row.chat_type === 'group' ? 'group' : 'direct',
    sessionKey: row.session_key,
    peerId: row.peer_id,
    peerName: row.peer_name || undefined,
    senderId: row.sender_id,
    senderName: row.sender_name || undefined,
    accountId: row.account_id,
    bodyForAgent: row.body_for_agent,
    rawBody: inboundContext.RawBody || inboundContext.Body || inboundContext.BodyForAgent || row.body_for_agent,
    commandBody: inboundContext.CommandBody || inboundContext.BodyForCommands || row.body_for_agent,
    wasMentioned: Boolean(inboundContext.WasMentioned),
    receivedAt: toIso(row.created_at) || new Date().toISOString(),
    messageTimestamp: typeof inboundContext.Timestamp === 'number'
      ? new Date(inboundContext.Timestamp * 1000).toISOString()
      : null,
    rawPayload: parseJson<Record<string, unknown>>(row.raw_payload, {}),
    inboundContext
  };
}

function buildStructuredReplayConversationItems(params: {
  rows: Array<StructuredReplayQueueRow | StructuredReplayInboundRow>;
  traceToConversationId: Map<string, number>;
}): Map<number, ConversationTranscriptItem[]> {
  const itemsByConversationId = new Map<number, ConversationTranscriptItem[]>();

  for (const row of params.rows) {
    const traceId = typeof row.trace_id === 'string' ? row.trace_id.trim() : '';
    const conversationId = ('conversation_id' in row ? Number(row.conversation_id) : 0) || params.traceToConversationId.get(traceId);
    if (!conversationId) {
      continue;
    }

    const items = itemsByConversationId.get(conversationId) || [];
    const isQueueReplayRow = 'payload' in row;
    const message = isQueueReplayRow
      ? buildQueueBatchMessageFromStructuredRow(row)
      : buildQueueBatchMessageFromInboundRow(row);
    const isPresenceAction = isQueueReplayRow && row.source === 'presence_tick';
    items.push({
      id: null,
      conversationId,
      sessionKey: row.session_key,
      role: isPresenceAction ? 'assistant' : 'user',
      phase: isPresenceAction ? 'commentary' : null,
      content: isPresenceAction
        ? '<ACTION source="presence_tick">我从自己的生活里抬头看了一眼消息列表。</ACTION>'
        : renderRuntimeBatchMessage(message, items.length),
      groupIndex: 0,
      itemIndex: items.length,
      source: isPresenceAction ? 'presence_action' : 'inbound_batch',
      deliveryMessageId: null,
      runId: isQueueReplayRow ? row.run_id : null,
      traceId: traceId || null
    });
    itemsByConversationId.set(conversationId, items);
  }

  return itemsByConversationId;
}

function flattenReplayMessageText(content: unknown) {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return '';
      }
      const typedPart = part as { type?: unknown; text?: unknown; refusal?: unknown };
      if ((typedPart.type === 'output_text' || typedPart.type === 'input_text') && typeof typedPart.text === 'string') {
        return typedPart.text.trim();
      }
      if (typedPart.type === 'refusal' && typeof typedPart.refusal === 'string') {
        return typedPart.refusal.trim();
      }
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function buildStructuredLlmReplayItems(rows: StructuredReplayLlmCallRow[]) {
  const replayItemsByTraceId = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const traceId = typeof row.trace_id === 'string' ? row.trace_id.trim() : '';
    if (!traceId) {
      continue;
    }
    const response = parseJson<Record<string, unknown>>(row.canonical_response, {});
    const output = Array.isArray(response.output) ? response.output : [];
    const replayItems = replayItemsByTraceId.get(traceId) || [];
    for (const item of output) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const outputItem = item as Record<string, unknown>;
      if (outputItem.type === 'reasoning') {
        const reasoningItem: Record<string, unknown> = { type: 'reasoning' };
        if (typeof outputItem.content === 'string' && outputItem.content.length > 0) {
          reasoningItem.content = outputItem.content;
        }
        if (typeof outputItem.summary === 'string' && outputItem.summary.length > 0 || Array.isArray(outputItem.summary) && outputItem.summary.length > 0) {
          reasoningItem.summary = outputItem.summary;
        }
        if (typeof outputItem.encrypted_content === 'string' && outputItem.encrypted_content.length > 0) {
          reasoningItem.encrypted_content = outputItem.encrypted_content;
        }
        if (Object.keys(reasoningItem).length > 1) {
          replayItems.push(reasoningItem);
        }
        continue;
      }
      if (outputItem.type === 'message' && outputItem.role === 'assistant') {
        const text = flattenReplayMessageText(outputItem.content);
        if (text) {
          replayItems.push({
            type: 'message',
            role: 'assistant',
            phase: outputItem.phase === 'final_answer' ? 'final_answer' : 'commentary',
            content: [{ type: 'output_text', text }]
          });
        }
        continue;
      }
      if (outputItem.type !== 'function_call') {
        continue;
      }
      const callId = typeof outputItem.call_id === 'string' ? outputItem.call_id.trim() : '';
      const toolName = typeof outputItem.name === 'string' ? outputItem.name.trim() : '';
      if (!callId || !toolName) {
        continue;
      }
      replayItems.push({
        type: 'function_call',
        call_id: callId,
        name: toolName,
        arguments: typeof outputItem.arguments === 'string' ? outputItem.arguments : JSON.stringify(outputItem.arguments || {})
      });
    }
    if (replayItems.length > 0) {
      replayItemsByTraceId.set(traceId, replayItems);
    }
  }
  return replayItemsByTraceId;
}

function buildStructuredToolReplayItems(rows: StructuredReplayToolRow[]) {
  const replayItemsByTraceId = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const traceId = typeof row.trace_id === 'string' ? row.trace_id.trim() : '';
    const callId = typeof row.tool_call_id === 'string' ? row.tool_call_id.trim() : '';
    const toolName = typeof row.tool_name === 'string' ? row.tool_name.trim() : '';
    if (!traceId || !callId || !toolName) {
      continue;
    }
    const args = parseJson<Record<string, unknown>>(row.arguments, {});
    const result = parseJson<Record<string, unknown>>(row.result, {});
    const output = toolName === 'exec_command' && typeof result.codex_output === 'string'
      ? result.codex_output
      : JSON.stringify(result);
    const replayItems = replayItemsByTraceId.get(traceId) || [];
    replayItems.push({
      type: 'function_call',
      call_id: callId,
      name: toolName,
      arguments: JSON.stringify(args)
    });
    replayItems.push({
      type: 'function_call_output',
      call_id: callId,
      output
    });
    replayItemsByTraceId.set(traceId, replayItems);
  }
  return replayItemsByTraceId;
}

function buildReplayItemKey(item: Record<string, unknown>) {
  const callId = typeof item.call_id === 'string' ? item.call_id : '';
  if (callId && (item.type === 'function_call' || item.type === 'function_call_output')) {
    return `${String(item.type)}:${callId}`;
  }
  if (item.type === 'message') {
    return `message:${String(item.role || '')}:${String(item.phase || '')}:${JSON.stringify(item.content || '')}`;
  }
  if (item.type === 'reasoning') {
    return `reasoning:${JSON.stringify(item.summary || item.content || item.encrypted_content || '')}`;
  }
  return '';
}

function mergeResponseReplayItems(rawResponse: Record<string, unknown>, recoveredReplayItems: Array<Record<string, unknown>>) {
  if (recoveredReplayItems.length === 0) {
    return rawResponse;
  }
  const existingReplayItems = Array.isArray(rawResponse.responses_replay_items)
    ? rawResponse.responses_replay_items.filter((item): item is Record<string, unknown> => (
        Boolean(item && typeof item === 'object' && !Array.isArray(item))
      ))
    : [];
  const existingReplayKeys = new Set(
    existingReplayItems
      .map(buildReplayItemKey)
      .filter(Boolean)
  );
  const missingReplayItems = recoveredReplayItems.filter((item) => {
    const replayKey = buildReplayItemKey(item);
    if (!replayKey || existingReplayKeys.has(replayKey)) {
      return !replayKey;
    }
    existingReplayKeys.add(replayKey);
    return true;
  });
  if (missingReplayItems.length === 0) {
    return rawResponse;
  }
  return {
    ...rawResponse,
    responses_replay_items: [
      ...existingReplayItems,
      ...missingReplayItems
    ]
  };
}

export class RuntimeStore {
  private readonly sql: SqlAdapter;

  constructor() {
    this.sql = createSqlAdapter({
      databaseUrl: databaseConfig.url,
      host: databaseConfig.host,
      port: databaseConfig.port,
      user: databaseConfig.user,
      password: databaseConfig.password,
      database: databaseConfig.database,
      connectionLimit: 8,
      applicationName: 'agent-service'
    });
  }

  private async recordLifeEventSafe(input: RecordAgentLifeEventInput) {
    try {
      await recordAgentLifeEvent(input, databaseConfig);
    } catch (error) {
      moduleLogger.warn('Failed to record agent life event', {
        eventKind: input.eventKind || input.event_kind,
        dedupeKey: input.dedupeKey || input.dedupe_key,
        runId: input.runId || input.run_id,
        traceId: input.traceId || input.trace_id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async refreshXiaoniLifeProjection(now = new Date()) {
    const life = (await getAgentLifeState('xiaoni', databaseConfig) || await ensureAgentLifeState('xiaoni', databaseConfig)) as AgentLifeStateRow;
    const projectionIsCurrent = life.projection_version === XIAONI_LIFE_PROJECTION_VERSION;
    const previousProjection = projectionIsCurrent ? normalizeProjectionJson(life.projection_json) : null;
    const reducedThroughEventId = projectionIsCurrent ? projectionEventId(life.reduced_through_event_id) : null;
    const reducedThroughOccurredAt = projectionIsCurrent ? toValidDate(life.reduced_through_occurred_at) : null;
    const candidateEvents = await listAgentLifeEvents({
      identityKey: 'xiaoni',
      ...(reducedThroughOccurredAt ? { occurredAfter: reducedThroughOccurredAt } : {}),
      chronological: true,
      limit: 1000
    }, databaseConfig) as AgentLifeEventProjection[];
    const events = previousProjection
      ? candidateEvents.filter((event) => eventOccurredAfterProjection(event, reducedThroughEventId, reducedThroughOccurredAt))
      : candidateEvents;
    const { projection, explanation } = reduceXiaoniLifeState({
      identityKey: 'xiaoni',
      now,
      events,
      previousProjection,
      legacyAnchors: buildPresenceAnchorsFromLife(life, now)
    });
    const reducedThroughEventIdForDb = projection.reducedThroughEventId
      ? projectionEventId(projection.reducedThroughEventId)
      : null;
    await updateAgentLifeState('xiaoni', {
      projection_json: projection,
      explanation_json: explanation,
      reduced_through_event_id: reducedThroughEventIdForDb,
      reduced_through_occurred_at: projection.reducedThroughOccurredAt ? new Date(projection.reducedThroughOccurredAt) : null,
      projection_version: XIAONI_LIFE_PROJECTION_VERSION,
      projection_updated_at: now
    }, databaseConfig);
    return { projection, explanation };
  }

  async initialize() {
    await this.ensureSchema();
    await ensureFeedbackReflectionSchema(databaseConfig);
    await ensureRelationshipTrustSchema(databaseConfig);
    await ensureIdentityLineageSchema(databaseConfig);
    await ensureAgentMediaSchema(databaseConfig);
    await ensureAgentTaskSchema(databaseConfig);
    await ensureAgentPresenceSchema(databaseConfig);
    await ensureAgentLifeEventSchema(databaseConfig);
    await ensureAgentMemorySchema(databaseConfig);
    await ensureAgentLifeState('xiaoni', databaseConfig);
    await this.refreshXiaoniLifeProjection(new Date()).catch((error) => {
      moduleLogger.warn('Failed to refresh Xiaoni life projection during startup', {
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  async close() {
    await this.sql.close();
  }

  async recordPresenceUserMessage(queueMessage: QueueMessagePayload) {
    if (!isImmediateVisibleImWake(queueMessage)) {
      return;
    }

    const now = new Date();
    await updateAgentLifeState('xiaoni', {
      last_user_message_at: now,
      last_boredom_reset_at: now
    }, databaseConfig);
    if (queueMessage.chatType === 'group') {
      await upsertAgentGroupPresenceState({
        identityKey: 'xiaoni',
        sessionKey: queueMessage.sessionKey,
        lastUserMessageAt: now
      }, databaseConfig);
    }

    const wakeKind = queueMessage.wasMentioned ? 'explicit_mention' : 'proactive_use_im';
    await this.recordLifeEventSafe({
      identityKey: 'xiaoni',
      eventKind: 'surface_visit',
      occurredAt: now,
      surface: 'qq',
      chatType: queueMessage.chatType,
      sessionKey: queueMessage.sessionKey,
      surfaceId: queueMessage.sessionKey,
      peerId: queueMessage.peerId,
      accountId: queueMessage.accountId,
      batchId: queueMessage.batchId,
      runId: queueMessage.runId,
      traceId: queueMessage.traceId,
      actorType: 'xiaoni',
      actorId: queueMessage.accountId,
      targetId: queueMessage.peerId,
      visibility: 'active_surface',
      actionCost: 0.01,
      attentionDelta: 0.2,
      payload: {
        source: queueMessage.source,
        wake_kind: wakeKind,
        peer_name: queueMessage.peerName || null,
        unread_batch_size: queueMessage.messages.length,
        direct_materialization_policy: queueMessage.chatType === 'direct'
          ? 'private_dm_claimed_by_active_im_open'
          : 'group_message_requires_explicit_mention_or_active_im_open'
      },
      dedupeKey: `surface_visit:${compactDedupePart(queueMessage.runId, queueMessage.traceId)}:${compactDedupePart(queueMessage.sessionKey, 'session')}`
    });

    for (const message of queueMessage.messages) {
      await this.recordLifeEventSafe({
        identityKey: 'xiaoni',
        eventKind: 'qq_message_seen',
        occurredAt: normalizeLifeEventOccurredAt(message.messageTimestamp || message.receivedAt),
        surface: 'qq',
        chatType: queueMessage.chatType,
        sessionKey: queueMessage.sessionKey,
        surfaceId: queueMessage.sessionKey,
        peerId: message.peerId,
        accountId: message.accountId,
        messageSid: message.messageSid,
        messageId: String(message.messageId),
        batchId: queueMessage.batchId,
        queueMessageId: message.queueMessageId,
        runId: queueMessage.runId,
        traceId: message.traceId || queueMessage.traceId,
        actorType: 'human',
        actorId: message.senderId,
        targetId: message.accountId,
        visibility: 'active_surface',
        attentionDelta: 0.1,
        payload: {
          wake_kind: wakeKind,
          sender_id: message.senderId,
          sender_name: message.senderName || null,
          peer_name: message.peerName || queueMessage.peerName || null,
          was_mentioned: Boolean(message.wasMentioned || message.inboundContext?.WasMentioned),
          body_for_agent: message.bodyForAgent,
          raw_body: message.rawBody,
          message_timestamp: message.messageTimestamp || null
        },
        dedupeKey: `qq_message_seen:${message.messageSid || message.queueMessageId || message.messageId}`
      });
    }
  }

  async recordPresenceAssistantAction(queueMessage: QueueMessagePayload) {
    const now = new Date();
    await updateAgentLifeState('xiaoni', {
      last_active_at: now,
      last_boredom_reset_at: now
    }, databaseConfig);
    if (queueMessage.chatType === 'group') {
      await upsertAgentGroupPresenceState({
        identityKey: 'xiaoni',
        sessionKey: queueMessage.sessionKey,
        lastSpokeAt: now
      }, databaseConfig);
    }
  }

  async recordVisibleDeliveryLifeEvents(input: {
    queueMessage: QueueMessagePayload;
    runId?: string;
    toolName: string;
    toolResult: Record<string, unknown>;
    forced?: boolean;
  }) {
    const now = new Date();
    const queueMessage = input.queueMessage;
    const runId = input.runId || queueMessage.runId;
    const messages = extractDeliveredTexts(input.toolResult);
    if (messages.length === 0) {
      return;
    }
    const replyActionCost = visibleReplyActionCost(messages.length);
    const actualChatType = input.toolResult.message_type === 'group'
      ? 'group'
      : input.toolResult.message_type === 'private'
      ? 'direct'
      : queueMessage.chatType === 'group'
      ? 'group'
      : 'direct';
    const targetGroupId = Number(input.toolResult.target_group_id);
    const targetUserId = Number(input.toolResult.target_user_id);
    const deliverySessionKey = actualChatType === 'group'
      ? queueMessage.chatType === 'group' && queueMessage.sessionKey
        ? queueMessage.sessionKey
        : `qq:group:${Math.trunc(targetGroupId)}`
      : queueMessage.chatType === 'direct' && queueMessage.sessionKey
      ? queueMessage.sessionKey
      : `qq:direct:${queueMessage.accountId}:${Math.trunc(targetUserId)}`;
    const deliveryPeerId = actualChatType === 'group' && Number.isFinite(targetGroupId)
      ? String(Math.trunc(targetGroupId))
      : actualChatType === 'direct' && Number.isFinite(targetUserId)
      ? String(Math.trunc(targetUserId))
      : queueMessage.peerId;
    const deliveryVisibility = actualChatType === 'direct' ? 'private_surface' : 'active_surface';

    if (actualChatType === 'group') {
      await this.recordLifeEventSafe({
        identityKey: 'xiaoni',
        eventKind: 'send_in_group',
        occurredAt: now,
        surface: 'qq',
        chatType: actualChatType,
        sessionKey: deliverySessionKey,
        surfaceId: deliverySessionKey,
        peerId: deliveryPeerId,
        accountId: queueMessage.accountId,
        batchId: queueMessage.batchId,
        runId,
        traceId: queueMessage.traceId,
        actorType: 'xiaoni',
        actorId: queueMessage.accountId,
        targetId: deliveryPeerId,
        visibility: 'active_surface',
        actionCost: replyActionCost,
        payload: {
          tool_name: input.toolName,
          forced: Boolean(input.forced),
          message_count: messages.length,
          sent_messages: messages,
          delivery: input.toolResult.delivery || null
        },
        dedupeKey: `send_in_group:${compactDedupePart(runId, queueMessage.traceId)}`
      });
    }

    for (const [index, content] of messages.entries()) {
      await this.recordLifeEventSafe({
        identityKey: 'xiaoni',
        eventKind: 'qq_self_message',
        occurredAt: now,
        surface: 'qq',
        chatType: actualChatType,
        sessionKey: deliverySessionKey,
        surfaceId: deliverySessionKey,
        peerId: deliveryPeerId,
        accountId: queueMessage.accountId,
        batchId: queueMessage.batchId,
        runId,
        traceId: queueMessage.traceId,
        actorType: 'xiaoni',
        actorId: queueMessage.accountId,
        targetId: deliveryPeerId,
        visibility: deliveryVisibility,
        actionCost: actualChatType === 'direct' && index === 0 ? replyActionCost : 0,
        payload: {
          tool_name: input.toolName,
          forced: Boolean(input.forced),
          index,
          content,
          delivery: input.toolResult.delivery || null
        },
        dedupeKey: `qq_self_message:${compactDedupePart(runId, queueMessage.traceId)}:${index}`
      });
    }
  }

  async recordNoVisibleDeliveryLifeEvent(input: {
    queueMessage: QueueMessagePayload;
    runId?: string;
    traceId?: string;
    outcome?: string | null;
    presenceOutcome?: string | null;
    leaseRelease: {
      reason: string;
      detail?: string | null;
      outcome?: string | null;
      noVisibleDelivery?: boolean;
    };
    modelRequestSlices?: number;
    conversationId?: number | null;
  }) {
    const now = new Date();
    const queueMessage = input.queueMessage;
    const runId = input.runId || queueMessage.runId;
    const traceId = input.traceId || queueMessage.traceId;
    const outcome = input.outcome || input.presenceOutcome || (isPresenceTickPayload(queueMessage) ? 'lurked' : 'silent');
    const firstMessage = queueMessage.messages[0] || null;

    await this.recordLifeEventSafe({
      identityKey: 'xiaoni',
      eventKind: 'no_visible_delivery_observed',
      occurredAt: now,
      surface: isPresenceTickPayload(queueMessage) ? 'presence_tick' : 'qq',
      chatType: queueMessage.chatType,
      sessionKey: queueMessage.sessionKey,
      surfaceId: queueMessage.sessionKey,
      peerId: queueMessage.peerId,
      accountId: queueMessage.accountId,
      messageSid: firstMessage?.messageSid || null,
      messageId: typeof firstMessage?.messageId === 'undefined' ? null : String(firstMessage.messageId),
      batchId: queueMessage.batchId,
      queueMessageId: firstMessage?.queueMessageId,
      runId,
      traceId,
      actorType: 'xiaoni',
      actorId: queueMessage.accountId,
      targetId: queueMessage.peerId,
      visibility: 'self_private',
      actionCost: isPresenceTickPayload(queueMessage) ? 0.01 : 0.005,
      payload: {
        run_id: runId,
        trace_id: traceId,
        chat_type: queueMessage.chatType,
        session_key: queueMessage.sessionKey,
        peer_id: queueMessage.peerId,
        peer_name: queueMessage.peerName || null,
        account_id: queueMessage.accountId,
        batch_id: queueMessage.batchId,
        source: queueMessage.source,
        outcome,
        presence_outcome: input.presenceOutcome || outcome,
        lease_release: {
          reason: input.leaseRelease.reason,
          detail: input.leaseRelease.detail || null,
          outcome: input.leaseRelease.outcome || null,
          no_visible_delivery: input.leaseRelease.noVisibleDelivery ?? true
        },
        reason: input.leaseRelease.detail || input.leaseRelease.reason,
        model_request_slices: input.modelRequestSlices ?? null,
        conversation_id: input.conversationId ?? null,
        unread_batch_size: queueMessage.messages.length
      },
      dedupeKey: `no_visible_delivery:${compactDedupePart(runId, traceId || 'lease')}:${compactDedupePart(queueMessage.sessionKey, 'session')}`
    });
  }

  async recordRecoverEnergyLifeEvent(input: {
    queueMessage: QueueMessagePayload;
    runId?: string;
    toolName: string;
    toolResult: Record<string, unknown>;
  }) {
    const now = new Date();
    const queueMessage = input.queueMessage;
    const runId = input.runId || queueMessage.runId;
    await this.recordLifeEventSafe({
      identityKey: 'xiaoni',
      eventKind: 'sleep_period',
      occurredAt: now,
      surface: isPresenceTickPayload(queueMessage) ? 'presence_tick' : 'qq',
      chatType: queueMessage.chatType,
      sessionKey: queueMessage.sessionKey,
      surfaceId: queueMessage.sessionKey,
      peerId: queueMessage.peerId,
      accountId: queueMessage.accountId,
      batchId: queueMessage.batchId,
      runId,
      traceId: queueMessage.traceId,
      actorType: 'xiaoni',
      actorId: queueMessage.accountId,
      targetId: queueMessage.peerId,
      visibility: 'self_private',
      actionCost: 0,
      payload: {
        tool_name: input.toolName,
        source: queueMessage.source,
        reason: typeof input.toolResult.reason === 'string' ? input.toolResult.reason : null,
        xiaoni_os: typeof input.toolResult.xiaoni_os === 'string' ? input.toolResult.xiaoni_os : null,
        duration_minutes: typeof input.toolResult.duration_minutes === 'number' ? input.toolResult.duration_minutes : null,
        duration_ms: typeof input.toolResult.duration_ms === 'number' ? input.toolResult.duration_ms : null,
        recovery_policy: 'recover_energy_tool_only'
      },
      dedupeKey: `sleep_period:${compactDedupePart(runId, queueMessage.traceId)}:recover_energy`
    });
    await this.refreshXiaoniLifeProjection(now).catch((error) => {
      moduleLogger.warn('Failed to refresh Xiaoni life projection after recover_energy', {
        traceId: queueMessage.traceId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  async recordPresenceProactiveCompletion(queueMessage: QueueMessagePayload, outcome: string) {
    const now = new Date();
    const spoke = outcome === 'shared' || outcome === 'replied';
    const nextState: Record<string, unknown> = {
      last_proactive_at: now
    };
    if (spoke) {
      const currentDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const life = await getAgentLifeState('xiaoni', databaseConfig) || await ensureAgentLifeState('xiaoni', databaseConfig);
      const sameDay = isSameUtcDate(life.daily_proactive_date as Date | string | null | undefined, now);
      nextState.daily_proactive_date = currentDate;
      nextState.daily_proactive_count = sameDay ? { increment: 1 } : 1;
    }
    await updateAgentLifeState('xiaoni', nextState, databaseConfig);
    if (queueMessage.chatType === 'group') {
      await upsertAgentGroupPresenceState({
        identityKey: 'xiaoni',
        sessionKey: queueMessage.sessionKey,
        ...(spoke ? { lastSpokeAt: now } : {})
      }, databaseConfig);
    }
  }

  async buildPresenceContext(queueMessage: QueueMessagePayload): Promise<RuntimePresenceContext> {
    const now = new Date();
    const { projection, explanation } = await this.refreshXiaoniLifeProjection(now);
    const items = await listAgentSharePoolItems({
      identityKey: 'xiaoni',
      targetSessionKey: queueMessage.sessionKey,
      limit: 8
    }, databaseConfig) as PresenceSharePoolItem[];
    const scored = items
      .map((item) => ({ item, score: scoreSharePoolItem(item, now) }))
      .sort((left, right) => right.score.finalScore - left.score.finalScore);
    const selectedItems = scored.slice(0, 3).map((entry) => entry.item);
    const recallScores = scored.map((entry) => entry.score);
    return {
      sourceItems: selectedItems,
      recallScores,
      boundaryJudgments: selectedItems.map((item) => ({
        item_id: item.id,
        boundary_label: item.boundaryLabel,
        source_wording: item.sourceWording
      })),
      compressionMapping: {
        selected_item_ids: selectedItems.map((item) => item.id),
        life_projection_version: projection.version,
        reduced_through_event_id: projection.reducedThroughEventId,
        explanation_contributors: explanation.contributors,
        sections: ['source_items', 'recall_scores', 'boundary_judgments', 'life_projection']
      },
      lifeProjection: projection,
      lifeExplanation: explanation
    };
  }

  async recordPresenceSidecar(input: {
    queueMessage: QueueMessagePayload;
    presenceContext: RuntimePresenceContext;
    outcome?: string | null;
  }) {
    await createAgentPresenceStateSidecar({
      runId: input.queueMessage.runId,
      traceId: input.queueMessage.traceId,
      identityKey: 'xiaoni',
      targetSessionKey: input.queueMessage.sessionKey,
      sourceItems: input.presenceContext.sourceItems.map((item) => ({
        id: item.id,
        content: item.content,
        source_kind: item.sourceKind
      })),
      recallScores: input.presenceContext.recallScores,
      boundaryJudgments: input.presenceContext.boundaryJudgments,
      compressionMapping: input.presenceContext.compressionMapping,
      finalContextBlock: '',
      modelActionOutcome: input.outcome || null
    }, databaseConfig);

    for (const item of input.presenceContext.sourceItems) {
      await createAgentShareItemUsage({
        itemId: item.id,
        identityKey: 'xiaoni',
        targetSessionKey: input.queueMessage.sessionKey,
        targetGroupId: input.queueMessage.chatType === 'group' ? Number(input.queueMessage.peerId) : null,
        runId: input.queueMessage.runId,
        traceId: input.queueMessage.traceId,
        outcome: input.outcome || 'lurked'
      }, databaseConfig);

      await this.recordLifeEventSafe({
        identityKey: 'xiaoni',
        eventKind: 'pending_share_consumed',
        occurredAt: new Date(),
        surface: 'qq',
        chatType: input.queueMessage.chatType,
        sessionKey: input.queueMessage.sessionKey,
        surfaceId: input.queueMessage.sessionKey,
        peerId: input.queueMessage.peerId,
        accountId: input.queueMessage.accountId,
        batchId: input.queueMessage.batchId,
        runId: input.queueMessage.runId,
        traceId: input.queueMessage.traceId,
        actorType: 'xiaoni',
        actorId: input.queueMessage.accountId,
        targetId: input.queueMessage.peerId,
        visibility: 'self_private',
        actionCost: 0.002,
        payload: {
          share_pool_item_id: item.id,
          source_kind: item.sourceKind,
          source_wording: item.sourceWording,
          outcome: input.outcome || 'lurked'
        },
        dedupeKey: `pending_share_consumed:${item.id}:${compactDedupePart(input.queueMessage.runId, input.queueMessage.traceId)}`
      });
    }
  }

  async listMediaAssetsForQueueMessage(queueMessage: QueueMessagePayload) {
    const messageSids = queueMessage.messages
      .map((message) => message.messageSid)
      .filter(Boolean);
    return listAgentMediaAssets({
      sessionKey: queueMessage.sessionKey,
      messageSids,
      limit: 50
    }, databaseConfig);
  }

  async getMediaAssetByTag(sessionKey: string, mediaTag: string) {
    return getAgentMediaAssetByTag({
      sessionKey,
      mediaTag,
      limit: 1
    }, databaseConfig);
  }

  async recordMediaObservation(input: Record<string, unknown>) {
    return createAgentMediaObservation(input, databaseConfig);
  }

  async createRuntimeTask(input: Record<string, unknown>) {
    return createAgentTask(input, databaseConfig);
  }

  async claimNextQueueMessage(workerId: string): Promise<QueueMessageRecord | null> {
    return this.sql.withTransaction(async (tx) => {
      const candidates = await tx.query<QueueRow>(
        `
          SELECT *
          FROM agent_queue_messages
          WHERE status = 'pending'
            AND available_at <= NOW()
          ORDER BY available_at ASC, id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `
      );

      const candidate = candidates[0];
      if (!candidate) {
        return null;
      }

      const rows = await tx.query<QueueRow>(
        `
          SELECT *
          FROM agent_queue_messages
          WHERE status = 'pending'
            AND session_key = ?
            AND available_at <= NOW()
          ORDER BY available_at ASC, id ASC
          FOR UPDATE
        `,
        [candidate.session_key]
      );

      if (rows.length === 0) {
        return null;
      }

      const batchId = `batch_${Date.now()}_${uuidv4().slice(0, 8)}`;
      const runId = `run_${Date.now()}_${uuidv4().slice(0, 8)}`;
      const traceId = `runtrace_${Date.now()}_${uuidv4().slice(0, 8)}`;
      const latest = rows[rows.length - 1];
      const placeholders = rows.map(() => '?').join(', ');
      const queueIds = rows.map((row) => Number(row.id));
      const chatType = latest.chat_type === 'group' ? 'group' : 'direct';

      await tx.insert(
        `
          INSERT INTO agent_message_batches (
            id,
            trace_id,
            session_key,
            chat_type,
            peer_id,
            peer_name,
            account_id,
            status,
            reason_for_start,
            input_message_count,
            summary,
            processing_started_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', 'debounce_window_elapsed', ?, ?, NOW())
        `,
        [
          batchId,
          traceId,
          latest.session_key,
          chatType,
          latest.peer_id,
          latest.peer_name,
          latest.account_id,
          rows.length,
          buildBatchSummary(rows)
        ]
      );

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        await tx.insert(
          `
            INSERT INTO agent_message_batch_items (
              batch_id,
              queue_message_id,
              inbound_message_id,
              message_sid,
              position
            )
            VALUES (?, ?, ?, ?, ?)
          `,
          [batchId, row.id, row.id, row.message_sid, index + 1]
        );
      }

      await tx.insert(
        `
          INSERT INTO agent_runs (
            id,
            batch_id,
            trace_id,
            session_key,
            chat_type,
            peer_id,
            peer_name,
            account_id,
            status,
            delivery_phase,
            started_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing', 'reasoning_open', NOW())
        `,
        [
          runId,
          batchId,
          traceId,
          latest.session_key,
          chatType,
          latest.peer_id,
          latest.peer_name,
          latest.account_id
        ]
      );

      await tx.execute(
        `
          UPDATE agent_queue_messages
          SET status = 'processing',
              attempts = attempts + 1,
              locked_at = NOW(),
              locked_by = ?,
              processing_started_at = COALESCE(processing_started_at, NOW()),
              batch_id = ?,
              run_id = ?,
              trace_id = ?,
              updated_at = NOW()
          WHERE id IN (${placeholders})
        `,
        [workerId, batchId, runId, traceId, ...queueIds]
      );

      return this.mapClaimedRun({
        runId,
        batchId,
        traceId,
        rows: rows.map((row) => ({
          ...row,
          batch_id: batchId,
          run_id: runId,
          trace_id: traceId,
        })),
      });
    });
  }

  async settleQueueMessages(runId: string, params: { conversationId?: number | null; result?: Record<string, unknown> }) {
    await this.sql.execute(
      `
        UPDATE agent_queue_messages
        SET status = 'settled',
            conversation_id = COALESCE(?, conversation_id),
            result = ?::jsonb,
            completed_at = NOW(),
            updated_at = NOW(),
            error_message = NULL
        WHERE run_id = ?
      `,
      [
        params.conversationId ?? null,
        JSON.stringify(params.result || {}),
        runId
      ]
    );
  }

  async failQueueMessage(runId: string, errorMessage: string, conversationId?: number | null) {
    await this.sql.execute(
      `
        UPDATE agent_queue_messages
        SET status = 'failed',
            error_message = ?,
            conversation_id = COALESCE(?, conversation_id),
            completed_at = NOW(),
            updated_at = NOW()
        WHERE run_id = ?
      `,
      [errorMessage, conversationId ?? null, runId]
    );
  }

  async releaseExecutionLease(runId: string, updates: {
    status: string;
    leaseRelease: {
      reason: string;
      detail?: string | null;
      outcome?: string | null;
    };
    noVisibleDelivery: boolean;
    finalResponse?: string | null;
    sentMessages?: string[];
    modelRequestSlices?: number;
    errorMessage?: string | null;
    conversationId?: number | null;
  }) {
    await this.sql.execute(
      `
        UPDATE agent_runs
        SET status = ?,
            delivery_phase = 'lease_released',
            termination_reason = ?,
            finish_reason = ?,
            finish_outcome = ?,
            no_reply = ?,
            final_response = ?,
            sent_messages = ?::jsonb,
            total_turns = ?,
            error_message = ?,
            conversation_id = COALESCE(?, conversation_id),
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = ?
      `,
      [
        updates.status,
        updates.leaseRelease.reason,
        updates.leaseRelease.detail ?? null,
        updates.leaseRelease.outcome ?? null,
        updates.noVisibleDelivery,
        updates.finalResponse ?? null,
        JSON.stringify(updates.sentMessages || []),
        updates.modelRequestSlices ?? 0,
        updates.errorMessage ?? null,
        updates.conversationId ?? null,
        runId
      ]
    );

    await this.sql.execute(
      `
        UPDATE agent_message_batches
        SET status = ?,
            conversation_id = COALESCE(?, conversation_id),
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = (SELECT batch_id FROM agent_runs WHERE id = ?)
      `,
      [updates.status, updates.conversationId ?? null, runId]
    );
  }

  async getExecutionLeaseDeliveryState(runId: string): Promise<ExecutionLeaseDeliveryState> {
    const rows = await this.sql.query<ExecutionLeaseDeliveryStateRow>(
      `
        SELECT
          delivery_phase,
          delivery_commit_count,
          blocked_delivery_attempt_count,
          last_blocked_delivery_reason
        FROM agent_runs
        WHERE id = ?
        LIMIT 1
      `,
      [runId]
    );

    return mapExecutionLeaseDeliveryState(rows[0]);
  }

  async markLeaseVisibleDeliveryCommitted(runId: string) {
    await this.sql.execute(
      `
        UPDATE agent_runs
        SET delivery_phase = 'delivery_committed',
            delivery_commit_count = CASE
              WHEN delivery_commit_count >= 1 THEN delivery_commit_count
              ELSE 1
            END,
            updated_at = NOW()
        WHERE id = ?
      `,
      [runId]
    );
    await this.recordLifeEventSafe({
      identityKey: 'xiaoni',
      eventKind: 'visible_delivery_committed',
      occurredAt: new Date(),
      runId,
      actorType: 'xiaoni',
      actorId: 'xiaoni',
      visibility: 'operator_only',
      payload: {
        delivery_phase: 'delivery_committed'
      },
      dedupeKey: `visible_delivery_committed:${compactDedupePart(runId, 'lease')}`
    });
  }

  async markLeaseDeliveryBlocked(runId: string, reason: string) {
    await this.sql.execute(
      `
        UPDATE agent_runs
        SET blocked_delivery_attempt_count = COALESCE(blocked_delivery_attempt_count, 0) + 1,
            last_blocked_delivery_reason = ?,
            updated_at = NOW()
        WHERE id = ?
      `,
      [reason, runId]
    );
    await this.recordLifeEventSafe({
      identityKey: 'xiaoni',
      eventKind: 'post_commit_side_effect_blocked',
      occurredAt: new Date(),
      runId,
      actorType: 'xiaoni',
      actorId: 'xiaoni',
      visibility: 'operator_only',
      payload: {
        reason
      },
      dedupeKey: `post_commit_side_effect_blocked:${compactDedupePart(runId, 'lease')}:${Date.now()}:${uuidv4().slice(0, 8)}`
    });
  }

  async createLlmJob(params: {
    traceId: string;
    sessionId: string;
    agentType: string;
    metadata?: Record<string, unknown>;
  }) {
    const jobId = `job_${Date.now()}_${uuidv4().slice(0, 8)}`;
    await this.sql.insert(
      `
        INSERT INTO llm_jobs (
          job_id,
          trace_id,
          session_id,
          agent_type,
          status,
          metadata,
          started_at
        )
        VALUES (?, ?, ?, ?, 'processing', ?::jsonb, NOW())
      `,
      [
        jobId,
        params.traceId,
        params.sessionId,
        params.agentType,
        JSON.stringify(params.metadata || {})
      ]
    );
    return jobId;
  }

  async updateLlmJob(jobId: string, updates: {
    status: string;
    finalResponse?: string | null;
    errorMessage?: string | null;
    totalTurns?: number;
    conversationId?: number | null;
    metadata?: Record<string, unknown>;
  }) {
    await this.sql.execute(
      `
        UPDATE llm_jobs
        SET status = ?,
            final_response = ?,
            error_message = ?,
            total_turns = ?,
            conversation_id = COALESCE(?, conversation_id),
            metadata = COALESCE(?::jsonb, metadata),
            completed_at = CASE WHEN ? IN ('completed', 'failed') THEN NOW() ELSE completed_at END,
            updated_at = NOW()
        WHERE job_id = ?
      `,
      [
        updates.status,
        updates.finalResponse ?? null,
        updates.errorMessage ?? null,
        updates.totalTurns ?? 0,
        updates.conversationId ?? null,
        updates.metadata ? JSON.stringify(updates.metadata) : null,
        updates.status,
        jobId
      ]
    );
  }

  async createToolExecutionLog(params: {
    traceId: string;
    jobId: string;
    agentTurn: number;
    llmCallId: string;
    toolCallId: string;
    toolName: string;
    methodId?: string;
    arguments: Record<string, unknown>;
    sideEffect: boolean;
  }) {
    const result = await this.sql.insert(
      `
        INSERT INTO tool_execution_logs (
          tool_call_id,
          trace_id,
          job_id,
          agent_turn,
          llm_call_id,
          tool_type,
          tool_name,
          method_id,
          arguments,
          status,
          execution_mode,
          side_effect,
          started_at
        )
        VALUES (?, ?, ?, ?, ?, 'function', ?, ?, ?::jsonb, 'processing', 'agent_loop', ?, NOW())
      `,
      [
        params.toolCallId,
        params.traceId,
        params.jobId,
        params.agentTurn,
        params.llmCallId,
        params.toolName,
        params.methodId || params.toolName,
        JSON.stringify(params.arguments || {}),
        params.sideEffect
      ]
    );

    return result.insertId;
  }

  async completeToolExecutionLog(logId: number, params: {
    status: string;
    result?: Record<string, unknown>;
    errorMessage?: string | null;
  }) {
    await this.sql.execute(
      `
        UPDATE tool_execution_logs
        SET status = ?,
            result = ?::jsonb,
            error_message = ?,
            completed_at = NOW(),
            duration_ms = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000))
        WHERE id = ?
      `,
      [
        params.status,
        JSON.stringify(params.result || {}),
        params.errorMessage ?? null,
        logId
      ]
    );
  }

  async logTimelineEvent(params: {
    traceId: string;
    eventType: string;
    eventName: string;
    eventPhase?: string | null;
    conversationId?: number | null;
    metadata?: Record<string, unknown>;
    durationMs?: number | null;
  }) {
    await this.sql.insert(
      `
        INSERT INTO timeline_events (
          trace_id,
          conversation_id,
          event_type,
          event_name,
          event_phase,
          component,
          duration_ms,
          metadata
        )
        VALUES (?, ?, ?, ?, ?, 'agent-service', ?, ?::jsonb)
      `,
      [
        params.traceId,
        params.conversationId ?? null,
        params.eventType,
        params.eventName,
        params.eventPhase ?? null,
        params.durationMs ?? null,
        JSON.stringify(params.metadata || {})
      ]
    );
  }

  async listRecentTurns(params: {
    userId: number;
    groupId?: number | null;
    afterConversationId?: number | null;
    limit?: number;
    scope?: 'session' | 'global';
  }): Promise<ConversationTurn[]> {
    const limit = typeof params.limit === 'number'
      ? Math.max(1, Math.min(params.limit, 1000))
      : null;
    const conditions: string[] = [];
    const values: Array<number | null> = [];

    if (params.scope !== 'global') {
      if (params.groupId && Number.isFinite(params.groupId)) {
        conditions.push('group_id = ?');
        values.push(params.groupId);
      } else {
        conditions.push('group_id IS NULL');
        conditions.push('user_id = ?');
        values.push(params.userId);
      }
    }

    if (params.afterConversationId && Number.isFinite(params.afterConversationId)) {
      conditions.push('id > ?');
      values.push(params.afterConversationId);
    }

    const rows = await this.sql.query<{
      id: number;
      batch_id: number | null;
      trace_id: string | null;
      user_id: number;
      group_id: number | null;
      user_message: string;
      ai_response: string | null;
      raw_response: unknown;
    }>(
      `
        SELECT id, batch_id, trace_id, user_id, group_id, user_message, ai_response, raw_response
        FROM conversations
        WHERE ${conditions.length > 0 ? conditions.join(' AND ') : 'TRUE'}
        ORDER BY id DESC
        ${limit ? `LIMIT ${limit}` : ''}
      `,
      values
    );

    const orderedRows = rows.reverse();
    const conversationIds = orderedRows.map((row) => Number(row.id));
    const traceToConversationId = new Map<string, number>();
    for (const row of orderedRows) {
      if (typeof row.trace_id === 'string' && row.trace_id.trim()) {
        traceToConversationId.set(row.trace_id.trim(), Number(row.id));
      }
    }
    const itemRows = conversationIds.length > 0
      ? await this.sql.query<{
          id: number;
          conversation_id: number;
          session_key: string | null;
          role: string;
          phase: string | null;
          content: string;
          group_index: number;
          item_index: number;
          source: string;
          delivery_message_id: number | null;
          run_id: string | null;
          trace_id: string | null;
        }>(
          `
            SELECT
              id,
              conversation_id,
              session_key,
              role,
              phase,
              content,
              group_index,
              item_index,
              source,
              delivery_message_id,
              run_id,
              trace_id
            FROM conversation_items
            WHERE conversation_id IN (${conversationIds.map(() => '?').join(', ')})
            ORDER BY conversation_id ASC, group_index ASC, item_index ASC, id ASC
          `,
          conversationIds
        )
      : [];
    const structuredReplayRows = traceToConversationId.size > 0
      ? await this.sql.query<StructuredReplayQueueRow>(
          `
            SELECT
              q.id,
              q.trace_id,
              q.run_id,
              q.conversation_id,
              q.source,
              q.message_sid,
              q.chat_type,
              q.session_key,
              q.peer_id,
              q.peer_name,
              q.sender_id,
              q.sender_name,
              q.account_id,
              q.body_for_agent,
              q.raw_payload,
              q.inbound_context,
              q.payload,
              q.created_at
            FROM agent_queue_messages q
            LEFT JOIN agent_message_batch_items bi ON bi.queue_message_id = q.id
            WHERE q.trace_id IN (${Array.from(traceToConversationId.keys()).map(() => '?').join(', ')})
            ORDER BY q.trace_id ASC, COALESCE(bi.position, 2147483647) ASC, q.id ASC
          `,
          Array.from(traceToConversationId.keys())
        )
      : [];
    const missingStructuredTraceIds = Array.from(traceToConversationId.keys()).filter((traceId) => (
      !structuredReplayRows.some((row) => row.trace_id === traceId)
    ));
    const structuredReplayInboundRows = missingStructuredTraceIds.length > 0
      ? await this.sql.query<StructuredReplayInboundRow>(
          `
            SELECT
              m.id,
              m.trace_id,
              m.source,
              m.message_sid,
              m.chat_type,
              m.session_key,
              m.peer_id,
              m.peer_name,
              m.sender_id,
              m.sender_name,
              m.account_id,
              m.body_for_agent,
              m.raw_payload,
              m.inbound_context,
              m.received_at AS created_at
            FROM agent_inbound_messages m
            WHERE m.trace_id IN (${missingStructuredTraceIds.map(() => '?').join(', ')})
            ORDER BY m.trace_id ASC, m.received_at ASC, m.id ASC
          `,
          missingStructuredTraceIds
        )
      : [];
    const llmReplayRows = traceToConversationId.size > 0
      ? await this.sql.query<StructuredReplayLlmCallRow>(
          `
            SELECT
              id,
              trace_id,
              agent_turn,
              canonical_response,
              started_at
            FROM llm_call_logs
            WHERE trace_id IN (${Array.from(traceToConversationId.keys()).map(() => '?').join(', ')})
              AND status = 'completed'
            ORDER BY trace_id ASC, COALESCE(agent_turn, 2147483647) ASC, started_at ASC, id ASC
          `,
          Array.from(traceToConversationId.keys())
        )
      : [];
    const toolReplayRows = traceToConversationId.size > 0
      ? await this.sql.query<StructuredReplayToolRow>(
          `
            SELECT
              id,
              trace_id,
              agent_turn,
              tool_call_id,
              tool_name,
              arguments,
              result,
              started_at
            FROM tool_execution_logs
            WHERE trace_id IN (${Array.from(traceToConversationId.keys()).map(() => '?').join(', ')})
              AND status = 'completed'
              AND tool_call_id IS NOT NULL
            ORDER BY trace_id ASC, COALESCE(agent_turn, 2147483647) ASC, started_at ASC, id ASC
          `,
          Array.from(traceToConversationId.keys())
        )
      : [];

    const itemsByConversationId = new Map<number, ConversationTranscriptItem[]>();
    for (const row of itemRows) {
      const conversationId = Number(row.conversation_id);
      const items = itemsByConversationId.get(conversationId) || [];
      items.push({
        id: Number(row.id),
        conversationId,
        sessionKey: row.session_key,
        role: row.role === 'assistant' ? 'assistant' : 'user',
        phase: row.phase === 'commentary' || row.phase === 'final_answer' ? row.phase : null,
        content: row.content,
        groupIndex: Number(row.group_index),
        itemIndex: Number(row.item_index),
        source: row.source === 'delivery'
          || row.source === 'presence_action'
          || row.source === 'legacy_user_message'
          || row.source === 'legacy_ai_response'
          ? row.source
          : 'inbound_batch',
        deliveryMessageId: row.delivery_message_id === null ? null : Number(row.delivery_message_id),
        runId: row.run_id,
        traceId: row.trace_id
      });
      itemsByConversationId.set(conversationId, items);
    }
    const reconstructedUserItemsByConversationId = buildStructuredReplayConversationItems({
      rows: [...structuredReplayRows, ...structuredReplayInboundRows],
      traceToConversationId
    });
    const recoveredLlmReplayItemsByTraceId = buildStructuredLlmReplayItems(llmReplayRows);
    const recoveredToolReplayItemsByTraceId = buildStructuredToolReplayItems(toolReplayRows);

    return orderedRows.map((row) => {
      const conversationId = Number(row.id);
      const traceId = typeof row.trace_id === 'string' ? row.trace_id.trim() : '';
      const rawResponse = parseJson<Record<string, unknown>>(row.raw_response, {});
      const recoveredReplayItems = traceId
        ? [
            ...(recoveredLlmReplayItemsByTraceId.get(traceId) || []),
            ...(recoveredToolReplayItemsByTraceId.get(traceId) || [])
          ]
        : [];
      const sessionKey = buildTranscriptSessionId(
        Number(row.user_id),
        row.group_id === null ? null : Number(row.group_id)
      );
      const existingItems = itemsByConversationId.get(conversationId) || buildLegacyConversationItems({
        conversationId,
        sessionKey,
        userMessage: row.user_message,
        aiResponse: row.ai_response,
        traceId: row.trace_id
      });
      const reconstructedUserItems = reconstructedUserItemsByConversationId.get(conversationId) || [];
      const items = reconstructedUserItems.length > 0
        ? [
            ...reconstructedUserItems,
            ...existingItems.filter((item) => item.role === 'assistant')
          ]
        : existingItems;

      return {
        id: conversationId,
        userId: Number(row.user_id),
        groupId: row.group_id === null ? null : Number(row.group_id),
        batchId: row.batch_id === null ? null : Number(row.batch_id),
        sessionKey,
        userMessage: row.user_message,
        aiResponse: row.ai_response,
        items,
        rawResponse: mergeResponseReplayItems(rawResponse, recoveredReplayItems)
      };
    });
  }

  async getSessionReadCutoffState(sessionKey: string): Promise<SessionReadCutoffState | null> {
    const rows = await this.sql.query<{
      session_key: string;
      read_cutoff_after_conversation_id: number | null;
      last_context_window_tokens: number | null;
      last_target_budget_tokens: number | null;
      last_hard_budget_tokens: number | null;
      context_summary: string | null;
      pending_proactive_share: string | null;
      pending_proactive_share_age: number | null;
      updated_at: string | Date | null;
    }>(
      `
        SELECT
          session_key,
          read_cutoff_after_conversation_id,
          last_context_window_tokens,
          last_target_budget_tokens,
          last_hard_budget_tokens,
          context_summary,
          pending_proactive_share,
          pending_proactive_share_age,
          updated_at
        FROM agent_session_context_windows
        WHERE session_key = ?
        LIMIT 1
      `,
      [sessionKey]
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      sessionKey: row.session_key,
      readCutoffAfterConversationId: row.read_cutoff_after_conversation_id === null
        ? null
        : Number(row.read_cutoff_after_conversation_id),
      lastContextWindowTokens: row.last_context_window_tokens === null ? null : Number(row.last_context_window_tokens),
      lastTargetBudgetTokens: row.last_target_budget_tokens === null ? null : Number(row.last_target_budget_tokens),
      lastHardBudgetTokens: row.last_hard_budget_tokens === null ? null : Number(row.last_hard_budget_tokens),
      contextSummary: row.context_summary ?? null,
      pendingProactiveShare: row.pending_proactive_share ?? null,
      pendingProactiveShareAge: row.pending_proactive_share_age === null ? 0 : Number(row.pending_proactive_share_age),
      updatedAt: toIso(row.updated_at)
    };
  }

  async upsertSessionReadCutoffState(params: {
    sessionKey: string;
    readCutoffAfterConversationId: number | null;
    lastContextWindowTokens: number;
    lastTargetBudgetTokens: number;
    lastHardBudgetTokens: number;
  }) {
    await this.sql.execute(
      `
        INSERT INTO agent_session_context_windows (
          session_key,
          read_cutoff_after_conversation_id,
          last_context_window_tokens,
          last_target_budget_tokens,
          last_hard_budget_tokens,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (session_key)
        DO UPDATE SET
          read_cutoff_after_conversation_id = EXCLUDED.read_cutoff_after_conversation_id,
          last_context_window_tokens = EXCLUDED.last_context_window_tokens,
          last_target_budget_tokens = EXCLUDED.last_target_budget_tokens,
          last_hard_budget_tokens = EXCLUDED.last_hard_budget_tokens,
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        params.sessionKey,
        params.readCutoffAfterConversationId,
        params.lastContextWindowTokens,
        params.lastTargetBudgetTokens,
        params.lastHardBudgetTokens
      ]
    );
  }

  async upsertProactiveShareState(sessionKey: string, share: string | null, age: number) {
    await this.sql.execute(
      `
        INSERT INTO agent_session_context_windows (session_key, pending_proactive_share, pending_proactive_share_age, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (session_key)
        DO UPDATE SET
          pending_proactive_share = EXCLUDED.pending_proactive_share,
          pending_proactive_share_age = EXCLUDED.pending_proactive_share_age,
          updated_at = CURRENT_TIMESTAMP
      `,
      [sessionKey, share, age]
    );
  }

  async upsertSessionContextSummary(params: {
    sessionKey: string;
    contextSummary: string;
  }) {
    await this.sql.execute(
      `
        INSERT INTO agent_session_context_windows (session_key, context_summary, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (session_key)
        DO UPDATE SET
          context_summary = EXCLUDED.context_summary,
          updated_at = CURRENT_TIMESTAMP
      `,
      [params.sessionKey, params.contextSummary]
    );
  }

  async loadSessionReplayState(params: {
    userId: number;
    groupId?: number | null;
  }): Promise<{
    summaryText: string | null;
    summarizedThroughConversationId: number | null;
  }> {
    const snapshotSessionId = buildTranscriptSessionId(params.userId, params.groupId);
    const snapshotRows = await this.sql.query<{
      summary_text: string;
      summarized_through_conversation_id: number | string;
      summary_status: string;
    }>(
      `
        SELECT
          summary_text,
          summarized_through_conversation_id,
          summary_status
        FROM chat_transcript_snapshots
        WHERE session_id = ?
          AND summary_status = 'ready'
        LIMIT 1
      `,
      [snapshotSessionId]
    );

    const snapshot = snapshotRows[0];
    return {
      summaryText: snapshot?.summary_text?.trim() || null,
      summarizedThroughConversationId: snapshot
        ? Number(snapshot.summarized_through_conversation_id)
        : null
    };
  }

  async getSpeakerTrustLevel(identityKey: string, speakerQq: number): Promise<'L1' | 'L2' | 'L3' | 'L4'> {
    try {
      return await getRelationshipTrustLevel(identityKey, speakerQq, databaseConfig);
    } catch {
      return 'L1';
    }
  }

  async updateSpeakerTrustLevel(identityKey: string, speakerQq: number, trustScore: number, level: 'L1' | 'L2' | 'L3' | 'L4') {
    try {
      await upsertRelationshipTrust({ identityKey, speakerQq, trustScore, level }, databaseConfig);
    } catch {
      // Non-fatal — trust update failure doesn't block the main flow
    }
  }

  async getSessionEmotionalState(_sessionKey: string): Promise<{ dopamine: 'low' | 'medium' | 'high'; stress: 'low' | 'medium' | 'high' } | null> {
    try {
      const { projection } = await this.refreshXiaoniLifeProjection(new Date());
      const state = projection.state;
      const dopamine: 'low' | 'medium' | 'high' = state.sharingDesire > 0.66 ? 'high' : state.sharingDesire < 0.33 ? 'low' : 'medium';
      const stress: 'low' | 'medium' | 'high' = state.fatigue > 0.75 ? 'high' : state.fatigue > 0.45 ? 'medium' : 'low';
      return { dopamine, stress };
    } catch {
      return null;
    }
  }

  async updateSessionEmotionalState(_sessionKey: string, dopamine: 'low' | 'medium' | 'high', stress: 'low' | 'medium' | 'high') {
    try {
      const now = new Date();
      await updateAgentLifeState('xiaoni', {
        ...(dopamine === 'high' || stress === 'low' ? { last_boredom_reset_at: now } : {}),
        last_active_at: now
      }, databaseConfig);
    } catch {
      // Non-fatal — state update failure doesn't block the main flow
    }
  }

  async incrementSpeakerTrustLevel(identityKey: string, speakerQq: number, delta: number) {
    try {
      await incrementRelationshipTrust({ identityKey, speakerQq, delta }, databaseConfig);
    } catch {
      // Non-fatal — trust increment failure doesn't block the main flow
    }
  }

  async listInboundMessagesForMemoryBackfill(params: {
    groupId: string;
    offset?: number;
    limit?: number | null;
  }) {
    return listAgentInboundMessages({
      chatType: 'group',
      peerId: params.groupId,
      offset: params.offset ?? 0,
      limit: params.limit ?? undefined
    }, databaseConfig);
  }

  async getQqUsageUnreadSummary(): Promise<QqUsageUnreadSummary> {
    return getQqUsageUnreadSummary({}, databaseConfig);
  }

  async listQqUsageThreads(params: { limit?: number; offset?: number }): Promise<QqUsageThreadList> {
    return listQqUsageThreads({
      limit: params.limit,
      offset: params.offset
    }, databaseConfig);
  }

  async listQqUsageThreadWindow(params: {
    threadKey: string;
    mode?: 'latest' | 'older' | 'newer';
    anchorMessageId?: number | string | null;
    limit?: number;
  }): Promise<QqUsageThreadWindow> {
    return listQqUsageThreadWindow({
      threadKey: params.threadKey,
      mode: params.mode,
      anchorMessageId: params.anchorMessageId ?? null,
      limit: params.limit
    }, databaseConfig);
  }

  async markQqUsageThreadRead(params: { threadKey?: string | null }): Promise<{ threadKey: string | null; clearedCount: number }> {
    return markQqUsageThreadRead({
      threadKey: params.threadKey || null
    }, databaseConfig);
  }

  async listRelevantFeedbackReflections(params: {
    sessionKey: string;
    groupId?: number | null;
    currentUserId: number;
    recentUserIds?: number[];
    queryText: string;
    limit?: number;
    socialActTypeHint?: UnreadMeaningSocialActType | null;
  }): Promise<RuntimeFeedbackReflection[]> {
    const [reflectionRows, learningStateRows] = await Promise.all([
      listFeedbackReflections({
        sessionKey: params.sessionKey,
        groupId: params.groupId ?? null,
        isActive: true,
        limit: 96
      }, databaseConfig),
      listFeedbackLearningStates({
        sessionKey: params.sessionKey,
        groupId: params.groupId ?? null,
        scopeType: 'group_self',
        limit: 64
      }, databaseConfig)
    ]);
    const reflections = reflectionRows.map((row) => parseFeedbackReflection(row as Record<string, unknown>));
    if (reflections.length === 0) {
      return [];
    }
    const learningStates = learningStateRows.map((row) => parseFeedbackLearningState(row as Record<string, unknown>));
    const recentUserIds = (Array.isArray(params.recentUserIds) ? params.recentUserIds : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);
    const embeddingScores = await this.computeFeedbackEmbeddingScores(reflections, params.queryText);
    const ranked = rankFeedbackReflectionsForRecall({
      reflections,
      learningStates,
      queryText: params.queryText,
      currentUserId: params.currentUserId,
      recentUserIds,
      embeddingScores,
      limit: Math.max(1, Math.min(params.limit ?? 3, 3)),
      socialActTypeHint: params.socialActTypeHint
    });
    const selected = ranked.map((item) => item.reflection);

    if (selected.length > 0) {
      await markFeedbackReflectionsHit(selected.map((item) => item.id), { hitAt: new Date() }, databaseConfig).catch(() => undefined);
    }

    return selected;
  }

  private async computeFeedbackEmbeddingScores(reflections: RuntimeFeedbackReflection[], queryText: string) {
    const normalizedQuery = queryText.trim();
    if (!normalizedQuery || reflections.length === 0) {
      return new Map<number, number>();
    }

    const indexedTexts = reflections
      .map((reflection) => ({
        reflectionId: reflection.id,
        text: reflection.embeddingText || reflection.retrievalText || reflection.summaryText
      }))
      .filter((item) => item.text.trim());
    if (indexedTexts.length === 0) {
      return new Map<number, number>();
    }

    try {
      const response = await fetch(`${agentConfig.providerServiceUrl}/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          input: [normalizedQuery, ...indexedTexts.map((item) => item.text)]
        })
      });
      if (!response.ok) {
        return new Map<number, number>();
      }
      const payload = await response.json() as {
        data?: Array<{ embedding?: number[] }>;
      };
      const embeddings = Array.isArray(payload.data)
        ? payload.data.map((item) => Array.isArray(item.embedding) ? item.embedding : [])
        : [];
      if (embeddings.length !== indexedTexts.length + 1 || embeddings[0].length === 0) {
        return new Map<number, number>();
      }

      const queryEmbedding = embeddings[0];
      const scores = new Map<number, number>();
      for (let index = 0; index < indexedTexts.length; index += 1) {
        const vector = embeddings[index + 1];
        if (!Array.isArray(vector) || vector.length === 0 || vector.length !== queryEmbedding.length) {
          continue;
        }
        scores.set(indexedTexts[index]!.reflectionId, cosineSimilarity(queryEmbedding, vector));
      }
      return scores;
    } catch {
      return new Map<number, number>();
    }
  }

  async createFeedbackReflection(params: {
    sessionKey: string;
    groupId?: number | null;
    sourceUserId?: number | null;
    sourceUserName?: string | null;
    scopeType?: string;
    learningKey?: string;
    learningScope?: string;
    reflectionType?: string;
    feedbackKind?: string;
    confidence?: string;
    importanceScore?: number;
    evidenceWeight?: number;
    stabilityScore?: number;
    summaryText: string;
    retrievalText?: string | null;
    embeddingText?: string | null;
    sourceMessageIds?: number[];
    sourceEpisodeIds?: number[];
    sourceConversationId?: number | null;
    supersedesReflectionId?: number | null;
    conflictGroupKey?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    return createFeedbackReflection({
      sessionKey: params.sessionKey,
      groupId: params.groupId ?? null,
      sourceUserId: params.sourceUserId ?? null,
      sourceUserName: params.sourceUserName ?? null,
      scopeType: params.scopeType || 'group_self',
      learningKey: params.learningKey || 'feedback.general',
      learningScope: params.learningScope || params.scopeType || 'group_self',
      reflectionType: params.reflectionType || 'social_lesson',
      feedbackKind: params.feedbackKind || 'mixed',
      confidence: params.confidence || 'medium',
      importanceScore: params.importanceScore ?? 0,
      evidenceWeight: params.evidenceWeight ?? 0,
      stabilityScore: params.stabilityScore ?? 0,
      summaryText: params.summaryText,
      retrievalText: params.retrievalText ?? null,
      embeddingText: params.embeddingText ?? null,
      sourceMessageIds: params.sourceMessageIds || [],
      sourceEpisodeIds: params.sourceEpisodeIds || [],
      sourceConversationId: params.sourceConversationId ?? null,
      supersedesReflectionId: params.supersedesReflectionId ?? null,
      conflictGroupKey: params.conflictGroupKey ?? null,
      metadata: params.metadata || {}
    }, databaseConfig);
  }

  async createFeedbackEpisode(params: {
    sessionKey: string;
    groupId?: number | null;
    sourceUserId?: number | null;
    sourceUserName?: string | null;
    scopeType?: string;
    eventKind?: string;
    excerptText?: string | null;
    sourceMessageIds?: number[];
    sourceConversationId?: number | null;
    eventImportance?: number;
    sourceSalience?: number;
    metadata?: Record<string, unknown>;
  }) {
    const row = await createFeedbackEpisode({
      sessionKey: params.sessionKey,
      groupId: params.groupId ?? null,
      sourceUserId: params.sourceUserId ?? null,
      sourceUserName: params.sourceUserName ?? null,
      scopeType: params.scopeType || 'group_self',
      eventKind: params.eventKind || 'feedback',
      excerptText: params.excerptText ?? null,
      sourceMessageIds: params.sourceMessageIds || [],
      sourceConversationId: params.sourceConversationId ?? null,
      eventImportance: params.eventImportance ?? 0,
      sourceSalience: params.sourceSalience ?? 0,
      metadata: params.metadata || {}
    }, databaseConfig);
    return parseFeedbackEpisode(row as Record<string, unknown>);
  }

  async createAgentMemoryObservation(params: {
    sessionKey: string;
    groupId?: number | null;
    sourceConversationId?: number | null;
    sourceTurnIds?: number[];
    sourceMessageIds?: number[];
    topic: string;
    text: string;
    poignancy?: number;
    participants?: Array<Record<string, unknown>>;
    xiaoniRole: string;
    sourceTraceId?: string | null;
    sourceRunId?: string | null;
    writerModel?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    return createAgentMemoryObservation({
      sessionKey: params.sessionKey,
      groupId: params.groupId ?? null,
      sourceConversationId: params.sourceConversationId ?? null,
      sourceTurnIds: params.sourceTurnIds || [],
      sourceMessageIds: params.sourceMessageIds || [],
      topic: params.topic,
      text: params.text,
      poignancy: params.poignancy ?? 1,
      participants: params.participants || [],
      xiaoniRole: params.xiaoniRole,
      sourceTraceId: params.sourceTraceId ?? null,
      sourceRunId: params.sourceRunId ?? null,
      writerModel: params.writerModel ?? null,
      metadata: params.metadata || {}
    }, databaseConfig);
  }

  async createAgentMemoryAssertion(params: {
    sessionKey: string;
    groupId?: number | null;
    sourceConversationId?: number | null;
    sourceTurnIds?: number[];
    sourceMessageIds?: number[];
    text: string;
    factType: string;
    entities?: Array<Record<string, unknown>>;
    participants?: Array<Record<string, unknown>>;
    sourceTraceId?: string | null;
    sourceRunId?: string | null;
    writerModel?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    return createAgentMemoryAssertion({
      sessionKey: params.sessionKey,
      groupId: params.groupId ?? null,
      sourceConversationId: params.sourceConversationId ?? null,
      sourceTurnIds: params.sourceTurnIds || [],
      sourceMessageIds: params.sourceMessageIds || [],
      text: params.text,
      factType: params.factType,
      entities: params.entities || [],
      participants: params.participants || [],
      sourceTraceId: params.sourceTraceId ?? null,
      sourceRunId: params.sourceRunId ?? null,
      writerModel: params.writerModel ?? null,
      metadata: params.metadata || {}
    }, databaseConfig);
  }

  async createAgentMemoryReflection(params: {
    sessionKey: string;
    groupId?: number | null;
    sourceConversationId?: number | null;
    text: string;
    kind: string;
    subjects?: string[];
    evidenceBasis: string;
    evidenceTimeStart?: string | Date | null;
    evidenceTimeEnd?: string | Date | null;
    poignancy?: number;
    sourceObservationIds?: number[];
    sourceMessageIds?: number[];
    sourceTraceId?: string | null;
    sourceRunId?: string | null;
    writerModel?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    return createAgentMemoryReflection({
      sessionKey: params.sessionKey,
      groupId: params.groupId ?? null,
      sourceConversationId: params.sourceConversationId ?? null,
      text: params.text,
      kind: params.kind,
      subjects: params.subjects || [],
      evidenceBasis: params.evidenceBasis,
      evidenceTimeStart: params.evidenceTimeStart ?? null,
      evidenceTimeEnd: params.evidenceTimeEnd ?? null,
      poignancy: params.poignancy ?? 1,
      sourceObservationIds: params.sourceObservationIds || [],
      sourceMessageIds: params.sourceMessageIds || [],
      sourceTraceId: params.sourceTraceId ?? null,
      sourceRunId: params.sourceRunId ?? null,
      writerModel: params.writerModel ?? null,
      metadata: params.metadata || {}
    }, databaseConfig);
  }

  async listAcceptedIdentityFacts(params: {
    identityKey: string;
    status?: string;
    factType?: string;
    limit?: number;
  }) {
    const rows = await listAcceptedIdentityFacts({
      identityKey: params.identityKey,
      status: params.status || 'active',
      factType: params.factType,
      limit: params.limit ?? 12
    }, databaseConfig);
    return rows.map((row: Record<string, unknown>) => parseAcceptedIdentityFact(row));
  }

  async ensureXiaoniIdentityRoot(params: {
    identityKey: string;
    sourcePromptId?: string | null;
    systemInstructionSnapshot: string;
    createdBy?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    return ensureXiaoniIdentityRoot({
      identityKey: params.identityKey,
      sourcePromptId: params.sourcePromptId ?? null,
      systemInstructionSnapshot: params.systemInstructionSnapshot,
      createdBy: params.createdBy ?? 'agent-service',
      metadata: params.metadata || {}
    }, databaseConfig);
  }

  async recordRuntimeIdentityActivationTrace(params: {
    identityKey: string;
    runId?: string | null;
    traceId?: string | null;
    conversationId?: number | null;
    sceneFingerprint?: string | null;
    cueSummary?: string | null;
    activatedRefs?: unknown[];
    suppressedRefs?: unknown[];
    selectedSkillRef?: string | null;
    activationReason?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    return recordRuntimeIdentityActivationTrace({
      identityKey: params.identityKey,
      runId: params.runId ?? null,
      traceId: params.traceId ?? null,
      conversationId: params.conversationId ?? null,
      sceneFingerprint: params.sceneFingerprint ?? null,
      cueSummary: params.cueSummary ?? null,
      activatedRefs: params.activatedRefs || [],
      suppressedRefs: params.suppressedRefs || [],
      selectedSkillRef: params.selectedSkillRef ?? null,
      activationReason: params.activationReason ?? null,
      metadata: params.metadata || {}
    }, databaseConfig);
  }

  async appendIdentityChangeCandidate(params: {
    identityKey: string;
    candidateType?: string;
    proposedBy?: string | null;
    proposedFrom?: string | null;
    claimText: string;
    beforeSummary?: string | null;
    afterSummary?: string | null;
    status?: string;
    judgeStatus?: string;
    judgeReason?: string | null;
    judgeRunId?: string | null;
    judgeLlmCallId?: string | null;
    quarantineGroupKey?: string | null;
    supersedesFactId?: number | null;
    metadata?: Record<string, unknown>;
    judgedAt?: string | Date | null;
    evidenceRefs?: IdentityEvidenceRefParams[];
    lineageMetadata?: Record<string, unknown>;
  }) {
    return appendIdentityChangeCandidate({
      identityKey: params.identityKey,
      candidateType: params.candidateType || 'natural_growth',
      proposedBy: params.proposedBy ?? null,
      proposedFrom: params.proposedFrom ?? null,
      claimText: params.claimText,
      beforeSummary: params.beforeSummary ?? null,
      afterSummary: params.afterSummary ?? null,
      status: params.status || 'pending',
      judgeStatus: params.judgeStatus || 'not_judged',
      judgeReason: params.judgeReason ?? null,
      judgeRunId: params.judgeRunId ?? null,
      judgeLlmCallId: params.judgeLlmCallId ?? null,
      quarantineGroupKey: params.quarantineGroupKey ?? null,
      supersedesFactId: params.supersedesFactId ?? null,
      metadata: params.metadata || {},
      judgedAt: params.judgedAt ?? null,
      evidenceRefs: params.evidenceRefs || [],
      lineageMetadata: params.lineageMetadata || {}
    }, databaseConfig);
  }

  async createAcceptedIdentityFact(params: {
    identityKey: string;
    factKey: string;
    factText: string;
    factType?: string;
    sourceCandidateId?: number | null;
    sourceEventId?: number | null;
    status?: string;
    confidence?: string;
    activationTags?: string[];
    metadata?: Record<string, unknown>;
    evidenceRefs?: IdentityEvidenceRefParams[];
    lineageMetadata?: Record<string, unknown>;
  }) {
    return createAcceptedIdentityFact({
      identityKey: params.identityKey,
      factKey: params.factKey,
      factText: params.factText,
      factType: params.factType || 'self_boundary',
      sourceCandidateId: params.sourceCandidateId ?? null,
      sourceEventId: params.sourceEventId ?? null,
      status: params.status || 'active',
      confidence: params.confidence || 'medium',
      activationTags: params.activationTags || [],
      metadata: params.metadata || {},
      evidenceRefs: params.evidenceRefs || [],
      lineageMetadata: params.lineageMetadata || {}
    }, databaseConfig);
  }

  async getFeedbackLearningState(params: {
    sessionKey: string;
    groupId?: number | null;
    scopeType?: string;
    learningKey: string;
    learningScope: string;
  }) {
    const row = await getFeedbackLearningState({
      sessionKey: params.sessionKey,
      groupId: params.groupId ?? null,
      scopeType: params.scopeType || 'group_self',
      learningKey: params.learningKey,
      learningScope: params.learningScope
    }, databaseConfig);
    return row ? parseFeedbackLearningState(row as Record<string, unknown>) : null;
  }

  async listFeedbackLearningStates(params: {
    sessionKey: string;
    groupId?: number | null;
    scopeType?: string;
    learningKey?: string;
    learningScope?: string;
    limit?: number;
  }) {
    const rows = await listFeedbackLearningStates({
      sessionKey: params.sessionKey,
      groupId: params.groupId ?? null,
      scopeType: params.scopeType,
      learningKey: params.learningKey,
      learningScope: params.learningScope,
      limit: params.limit
    }, databaseConfig);
    return rows.map((row) => parseFeedbackLearningState(row as Record<string, unknown>));
  }

  async upsertFeedbackLearningState(params: {
    sessionKey: string;
    groupId?: number | null;
    scopeType?: string;
    learningKey: string;
    learningScope: string;
    stateType?: string;
    activeReflectionId?: number | null;
    latestReflectionId?: number | null;
    activationWeight?: number;
    recencyWeight?: number;
    importanceWeight?: number;
    sourceWeight?: number;
    conflictPenalty?: number;
    metadata?: Record<string, unknown>;
  }) {
    const row = await upsertFeedbackLearningState({
      sessionKey: params.sessionKey,
      groupId: params.groupId ?? null,
      scopeType: params.scopeType || 'group_self',
      learningKey: params.learningKey,
      learningScope: params.learningScope,
      stateType: params.stateType || 'reinforced',
      activeReflectionId: params.activeReflectionId ?? null,
      latestReflectionId: params.latestReflectionId ?? null,
      activationWeight: params.activationWeight ?? 0,
      recencyWeight: params.recencyWeight ?? 0,
      importanceWeight: params.importanceWeight ?? 0,
      sourceWeight: params.sourceWeight ?? 0,
      conflictPenalty: params.conflictPenalty ?? 0,
      metadata: params.metadata || {}
    }, databaseConfig);
    return parseFeedbackLearningState(row as Record<string, unknown>);
  }

  private async loadTopicProjectionState(params: {
    userId: number;
    groupId?: number | null;
    recentUserIds?: number[];
  }): Promise<{
    activeTopics: RuntimeTopicProjection[];
  }> {
    const chatSpaceType = params.groupId && Number.isFinite(params.groupId) ? 'group' : 'direct';
    const chatSpaceId = chatSpaceType === 'group' ? Number(params.groupId) : Number(params.userId);
    if (!Number.isFinite(chatSpaceId) || chatSpaceId <= 0) {
      return { activeTopics: [] };
    }

    const topicRows = await listChatSpaceTopics({
      chatSpaceType,
      chatSpaceId,
      limit: 12
    }, databaseConfig);

    const collected: RuntimeTopicProjection[] = [];
    for (const topicRow of topicRows) {
      if (!topicRow || typeof topicRow !== 'object') {
        continue;
      }
      const status = typeof topicRow.status === 'string' ? topicRow.status.trim() : '';
      if (status === 'archived') {
        continue;
      }

      const candidateVersionId = Number((topicRow as Record<string, unknown>).current_candidate_version_id);
      const acceptedVersionId = Number((topicRow as Record<string, unknown>).current_accepted_version_id);
      const versionRef = Number.isFinite(candidateVersionId) && candidateVersionId > 0
        ? { versionId: candidateVersionId, source: 'candidate' as const }
        : Number.isFinite(acceptedVersionId) && acceptedVersionId > 0
          ? { versionId: acceptedVersionId, source: 'accepted' as const }
          : null;
      if (!versionRef) {
        continue;
      }

      const versionRow = await getTopicProjectionVersionById(versionRef.versionId, databaseConfig);
      if (!versionRow || typeof versionRow !== 'object') {
        continue;
      }

      const parsed = parseRuntimeTopicProjection({
        topicRow: topicRow as Record<string, unknown>,
        versionRow: versionRow as Record<string, unknown>,
        source: versionRef.source
      });
      if (parsed) {
        collected.push(parsed);
      }
    }

    const recentUserIds = Array.isArray(params.recentUserIds) ? params.recentUserIds : [];
    collected.sort((left, right) => {
      const leftSenderHit = left.participantIds.includes(params.userId) ? 1 : 0;
      const rightSenderHit = right.participantIds.includes(params.userId) ? 1 : 0;
      if (leftSenderHit !== rightSenderHit) {
        return rightSenderHit - leftSenderHit;
      }

      const leftRecentHit = recentUserIds.some((userId) => left.participantIds.includes(userId)) ? 1 : 0;
      const rightRecentHit = recentUserIds.some((userId) => right.participantIds.includes(userId)) ? 1 : 0;
      if (leftRecentHit !== rightRecentHit) {
        return rightRecentHit - leftRecentHit;
      }

      if (left.heatScore !== right.heatScore) {
        return right.heatScore - left.heatScore;
      }

      if (left.reviewPriorityScore !== right.reviewPriorityScore) {
        return right.reviewPriorityScore - left.reviewPriorityScore;
      }

      return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
    });

    return {
      activeTopics: collected.slice(0, 3)
    };
  }

  async buildMemoryRagContext(params: {
    userId: number;
    groupId?: number | null;
    currentMessageText: string;
    recentUserIds?: number[];
    targetTokenBudget?: number;
  }): Promise<RuntimeMemoryRagContext> {
    const replayState = await this.loadSessionReplayState({
      userId: params.userId,
      groupId: params.groupId ?? null
    });
    const history = await this.listRecentTurns({
      userId: params.userId,
      groupId: params.groupId ?? null,
      afterConversationId: replayState.summarizedThroughConversationId
    });

    const maxChars = estimateBudgetLength(params.targetTokenBudget || 12000);
    const pickedTurns: ConversationTurn[] = [];
    let usedChars = 0;

    for (const turn of [...history].reverse()) {
      const block = renderTranscriptItemForMemoryPack(turn);
      if (!block.trim()) {
        continue;
      }
      if (pickedTurns.length > 0 && usedChars + block.length > maxChars) {
        break;
      }
      pickedTurns.unshift(turn);
      usedChars += block.length;
    }

    const segments = pickedTurns.map((turn, index) => {
      const transcriptItems = Array.isArray(turn.items) ? turn.items : [];
      const messageIds = transcriptItems
        .map((item) => Number(item.id))
        .filter((value) => Number.isFinite(value) && value > 0);
      return {
        segmentId: `recent-turn-${index + 1}`,
        reason: index === 0 ? 'oldest retained recent turn' : index === pickedTurns.length - 1 ? 'latest retained recent turn' : 'recent thread continuation',
        source: 'recent_turns' as const,
        messageIds,
        content: renderTranscriptItemForMemoryPack(turn)
      };
    });

    const bridgeNotes = replayState.summaryText
      ? [{
          kind: 'compact_bridge' as const,
          summary: replayState.summaryText
        }]
      : [];

    return {
      packSummary: segments.length > 0
        ? 'Long-context memory pack stitched from recent transcript trajectory.'
        : bridgeNotes.length > 0
          ? 'No raw recent turns available, using compact bridge only.'
          : 'No historical memory context available.',
      timeScope: {
        oldestMessageAt: null,
        newestMessageAt: null
      },
      segments,
      bridgeNotes
    };
  }

  private async loadSelfEvolutionStates(params: {
    groupId: number | null;
    currentUserId: number;
    recentUserIds: number[];
    sessionKey: string;
  }): Promise<{
    groupStates: RuntimeSelfEvolutionState[];
    currentUserStates: RuntimeSelfEvolutionState[];
    recentUserStates: RuntimeSelfEvolutionState[];
  }> {
    if (!params.groupId || !Number.isFinite(params.groupId)) {
      return {
        groupStates: [],
        currentUserStates: [],
        recentUserStates: []
      };
    }

    const uniqueRecentUserIds = Array.from(new Set(
      params.recentUserIds
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0 && value !== params.currentUserId)
    )).slice(0, 2);

    const [groupRows, currentUserRows, ...recentRowsList] = await Promise.all([
      listSelfEvolutionStates({
        sessionKey: params.sessionKey,
        groupId: params.groupId,
        targetUserId: null,
        isActive: true,
        limit: 6
      }, databaseConfig),
      listSelfEvolutionStates({
        sessionKey: params.sessionKey,
        groupId: params.groupId,
        targetUserId: params.currentUserId,
        isActive: true,
        limit: 6
      }, databaseConfig),
      ...uniqueRecentUserIds.map((userId) => listSelfEvolutionStates({
        sessionKey: params.sessionKey,
        groupId: params.groupId as number,
        targetUserId: userId,
        isActive: true,
        limit: 4
      }, databaseConfig))
    ]);

    return {
      groupStates: groupRows.map((row) => parseSelfEvolutionState(row as Record<string, unknown>)),
      currentUserStates: currentUserRows.map((row) => parseSelfEvolutionState(row as Record<string, unknown>)),
      recentUserStates: recentRowsList.flat().map((row) => parseSelfEvolutionState(row as Record<string, unknown>))
    };
  }

  async createConversation(params: {
    batchId?: number | null;
    userId: number;
    groupId?: number | null;
    userMessage: string;
    aiResponse?: string | null;
    sessionKey?: string | null;
    transcriptItems?: ConversationTranscriptItemInput[];
    responseTimeMs: number;
    status: string;
    errorReason?: string | null;
    modelName?: string | null;
    traceId: string;
    rawRequest?: Record<string, unknown>;
    rawResponse?: Record<string, unknown>;
  }) {
    const result = await this.sql.insert(
      `
        INSERT INTO conversations (
          batch_id,
          user_id,
          group_id,
          user_message,
          ai_response,
          response_time,
          status,
          error_reason,
          model_name,
          raw_request,
          raw_response,
          trace_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?)
      `,
      [
        params.batchId ?? null,
        params.userId,
        params.groupId ?? null,
        params.userMessage,
        params.aiResponse ?? null,
        params.responseTimeMs,
        params.status,
        params.errorReason ?? null,
        params.modelName ?? null,
        JSON.stringify(params.rawRequest || {}),
        JSON.stringify(params.rawResponse || {}),
        params.traceId
      ]
    );

    const conversationId = Number(result.insertId);
    const transcriptItems = Array.isArray(params.transcriptItems) ? params.transcriptItems : [];
    if (transcriptItems.length > 0) {
      for (const item of transcriptItems) {
        await this.sql.insert(
          `
            INSERT INTO conversation_items (
              conversation_id,
              session_key,
              role,
              phase,
              content,
              group_index,
              item_index,
              source,
              delivery_message_id,
              run_id,
              trace_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            conversationId,
            item.sessionKey ?? params.sessionKey ?? null,
            item.role,
            item.phase ?? null,
            item.content,
            item.groupIndex,
            item.itemIndex,
            item.source,
            item.deliveryMessageId ?? null,
            item.runId ?? null,
            item.traceId ?? params.traceId
          ]
        );
      }
    }

    return conversationId;
  }

  async attachConversationIdToTrace(traceId: string, conversationId: number) {
    await Promise.all([
      this.sql.execute(
        'UPDATE agent_queue_messages SET conversation_id = COALESCE(conversation_id, ?) WHERE trace_id = ?',
        [conversationId, traceId]
      ),
      this.sql.execute(
        'UPDATE agent_runs SET conversation_id = COALESCE(conversation_id, ?) WHERE trace_id = ?',
        [conversationId, traceId]
      ),
      this.sql.execute(
        'UPDATE agent_message_batches SET conversation_id = COALESCE(conversation_id, ?) WHERE trace_id = ?',
        [conversationId, traceId]
      ),
      this.sql.execute(
        'UPDATE llm_jobs SET conversation_id = COALESCE(conversation_id, ?) WHERE trace_id = ?',
        [conversationId, traceId]
      ),
      this.sql.execute(
        'UPDATE tool_execution_logs SET conversation_id = COALESCE(conversation_id, ?) WHERE trace_id = ?',
        [conversationId, traceId]
      ),
      this.sql.execute(
        'UPDATE llm_call_logs SET conversation_id = COALESCE(conversation_id, ?) WHERE trace_id = ?',
        [conversationId, traceId]
      ),
      this.sql.execute(
        'UPDATE timeline_events SET conversation_id = COALESCE(conversation_id, ?) WHERE trace_id = ?',
        [conversationId, traceId]
      )
    ]);
  }

  private mapClaimedRun(input: {
    runId: string;
    batchId: string;
    traceId: string;
    rows: QueueRow[];
  }): QueueMessageRecord {
    const messages = input.rows.map((row) => {
      const payload = parseJson<Partial<QueueBatchMessage>>(row.payload, {});
      return {
        queueMessageId: Number(row.id),
        traceId: input.traceId,
        source: row.source,
        messageId: payload.messageId ?? Number(row.id),
        messageSid: row.message_sid,
        chatType: row.chat_type === 'group' ? 'group' : 'direct',
        sessionKey: row.session_key,
        peerId: row.peer_id,
        peerName: row.peer_name || undefined,
        senderId: row.sender_id,
        senderName: row.sender_name || undefined,
        accountId: row.account_id,
        bodyForAgent: row.body_for_agent,
        rawBody: payload.rawBody || row.body_for_agent,
        commandBody: payload.commandBody || row.body_for_agent,
        wasMentioned: Boolean(payload.wasMentioned),
        receivedAt: payload.receivedAt || toIso(row.created_at) || new Date().toISOString(),
        messageTimestamp: payload.messageTimestamp ?? null,
        rawPayload: parseJson<Record<string, unknown>>(row.raw_payload, {}),
        inboundContext: parseJson(row.inbound_context, {}),
      } as QueueBatchMessage;
    });

    const latest = messages[messages.length - 1];
    const latestPayload = parseJson<Partial<QueueMessagePayload>>(input.rows[input.rows.length - 1]?.payload, {});
    const payload: QueueMessagePayload = {
      traceId: input.traceId,
      runId: input.runId,
      batchId: input.batchId,
      source: latest.source,
      chatType: latest.chatType,
      sessionKey: latest.sessionKey,
      peerId: latest.peerId,
      peerName: latest.peerName,
      senderId: latest.senderId,
      senderName: latest.senderName,
      accountId: latest.accountId,
      bodyForAgent: buildBatchSummary(input.rows),
      rawBody: messages.map((message) => message.rawBody).join('\n'),
      commandBody: messages.map((message) => message.commandBody).join('\n'),
      wasMentioned: messages.some((message) => message.wasMentioned),
      receivedAt: latest.receivedAt,
      messageTimestamp: latest.messageTimestamp,
      rawPayload: latest.rawPayload,
      inboundContext: latest.inboundContext,
      messages,
      ...(latestPayload.presenceTick ? { presenceTick: latestPayload.presenceTick } : {}),
    };

    return {
      id: input.runId,
      traceId: input.traceId,
      batchId: input.batchId,
      status: 'processing',
      attempts: Math.max(...input.rows.map((row) => Number(row.attempts || 0) + 1), 1),
      createdAt: toIso(input.rows[0]?.created_at) || new Date().toISOString(),
      processingStartedAt: new Date().toISOString(),
      completedAt: null,
      conversationId: null,
      errorMessage: null,
      queueMessageIds: input.rows.map((row) => Number(row.id)),
      payload,
    };
  }

  private async ensureSchema() {
    const ddlStatements = [
      `
        ALTER TABLE llm_call_logs
          ADD COLUMN IF NOT EXISTS llm_call_id VARCHAR(100),
          ADD COLUMN IF NOT EXISTS agent_turn INTEGER,
          ADD COLUMN IF NOT EXISTS canonical_response JSONB,
          ADD COLUMN IF NOT EXISTS wire_request JSONB,
          ADD COLUMN IF NOT EXISTS wire_response JSONB,
          ADD COLUMN IF NOT EXISTS effective_unified_config JSONB,
          ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP(3)
      `,
      `
        ALTER TABLE agent_queue_messages
          ADD COLUMN IF NOT EXISTS batch_id VARCHAR(128),
          ADD COLUMN IF NOT EXISTS run_id VARCHAR(128)
      `,
      `
        CREATE TABLE IF NOT EXISTS agent_queue_messages (
          id BIGSERIAL PRIMARY KEY,
          trace_id VARCHAR(128) NOT NULL,
          batch_id VARCHAR(128),
          run_id VARCHAR(128),
          source VARCHAR(32) NOT NULL,
          message_sid VARCHAR(191) NOT NULL,
          dedupe_key VARCHAR(255) NOT NULL UNIQUE,
          chat_type VARCHAR(16) NOT NULL,
          session_key VARCHAR(191) NOT NULL,
          peer_id VARCHAR(191) NOT NULL,
          peer_name VARCHAR(255),
          sender_id VARCHAR(191) NOT NULL,
          sender_name VARCHAR(255),
          account_id VARCHAR(191) NOT NULL,
          body_for_agent TEXT NOT NULL,
          raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          inbound_context JSONB NOT NULL DEFAULT '{}'::jsonb,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          status VARCHAR(16) NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 3,
          available_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          locked_at TIMESTAMP(3),
          locked_by VARCHAR(128),
          processing_started_at TIMESTAMP(3),
          completed_at TIMESTAMP(3),
          conversation_id BIGINT,
          error_message TEXT,
          result JSONB,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS agent_message_batches (
          id VARCHAR(128) PRIMARY KEY,
          trace_id VARCHAR(128) NOT NULL,
          conversation_id BIGINT,
          session_key VARCHAR(191) NOT NULL,
          chat_type VARCHAR(16) NOT NULL,
          peer_id VARCHAR(191) NOT NULL,
          peer_name VARCHAR(255),
          account_id VARCHAR(191) NOT NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'pending',
          reason_for_start VARCHAR(64),
          input_message_count INTEGER NOT NULL DEFAULT 0,
          summary TEXT,
          processing_started_at TIMESTAMP(3),
          completed_at TIMESTAMP(3),
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS chat_transcript_snapshots (
          session_id VARCHAR(191) PRIMARY KEY,
          chat_type VARCHAR(16) NOT NULL,
          private_user_id BIGINT NULL,
          group_id BIGINT NULL,
          summary_text TEXT NOT NULL,
          summary_format_version VARCHAR(32) NOT NULL,
          summarized_through_conversation_id BIGINT NOT NULL,
          summary_status VARCHAR(16) NOT NULL DEFAULT 'ready',
          summary_job_id VARCHAR(128) NULL,
          last_compacted_at TIMESTAMP(3) NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS conversation_items (
          id BIGSERIAL PRIMARY KEY,
          conversation_id BIGINT NOT NULL,
          session_key VARCHAR(191),
          role VARCHAR(16) NOT NULL,
          phase VARCHAR(32),
          content TEXT NOT NULL,
          group_index INTEGER NOT NULL DEFAULT 0,
          item_index INTEGER NOT NULL DEFAULT 0,
          source VARCHAR(32) NOT NULL,
          delivery_message_id BIGINT,
          run_id VARCHAR(128),
          trace_id VARCHAR(128),
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS agent_session_context_windows (
          session_key VARCHAR(191) PRIMARY KEY,
          read_cutoff_after_conversation_id BIGINT,
          last_context_window_tokens INTEGER,
          last_target_budget_tokens INTEGER,
          last_hard_budget_tokens INTEGER,
          context_summary TEXT,
          pending_proactive_share TEXT,
          pending_proactive_share_age INTEGER DEFAULT 0,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `,
      'CREATE INDEX IF NOT EXISTS idx_chat_transcript_snapshots_private_user ON chat_transcript_snapshots (private_user_id, updated_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_chat_transcript_snapshots_group ON chat_transcript_snapshots (group_id, updated_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_chat_transcript_snapshots_status ON chat_transcript_snapshots (summary_status, updated_at DESC)',
      `
        CREATE TABLE IF NOT EXISTS agent_message_batch_items (
          id BIGSERIAL PRIMARY KEY,
          batch_id VARCHAR(128) NOT NULL,
          queue_message_id BIGINT NOT NULL,
          inbound_message_id BIGINT NOT NULL,
          message_sid VARCHAR(191),
          position INTEGER NOT NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS agent_runs (
          id VARCHAR(128) PRIMARY KEY,
          batch_id VARCHAR(128) NOT NULL,
          trace_id VARCHAR(128) NOT NULL,
          conversation_id BIGINT,
          session_key VARCHAR(191) NOT NULL,
          chat_type VARCHAR(16) NOT NULL,
          peer_id VARCHAR(191) NOT NULL,
          peer_name VARCHAR(255),
          account_id VARCHAR(191) NOT NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'pending',
          delivery_phase TEXT NOT NULL DEFAULT 'reasoning_open',
          delivery_commit_count INTEGER NOT NULL DEFAULT 0,
          blocked_delivery_attempt_count INTEGER NOT NULL DEFAULT 0,
          last_blocked_delivery_reason TEXT,
          termination_reason VARCHAR(64),
          finish_reason TEXT,
          finish_outcome TEXT,
          no_reply BOOLEAN NOT NULL DEFAULT FALSE,
          final_response TEXT,
          sent_messages JSONB,
          total_turns INTEGER NOT NULL DEFAULT 0,
          error_message TEXT,
          started_at TIMESTAMP(3),
          completed_at TIMESTAMP(3),
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS delivery_phase TEXT NOT NULL DEFAULT 'reasoning_open'`,
      `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS delivery_commit_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS blocked_delivery_attempt_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS last_blocked_delivery_reason TEXT`,
      `
        CREATE TABLE IF NOT EXISTS llm_jobs (
          id BIGSERIAL PRIMARY KEY,
          job_id VARCHAR(128) NOT NULL UNIQUE,
          trace_id VARCHAR(128) NOT NULL,
          conversation_id BIGINT,
          session_id VARCHAR(191),
          agent_type VARCHAR(64),
          status VARCHAR(32) NOT NULL DEFAULT 'pending',
          final_response TEXT,
          error_message TEXT,
          total_turns INTEGER NOT NULL DEFAULT 0,
          metadata JSONB,
          started_at TIMESTAMP(3),
          completed_at TIMESTAMP(3),
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS tool_execution_logs (
          id BIGSERIAL PRIMARY KEY,
          tool_call_id VARCHAR(128),
          trace_id VARCHAR(128) NOT NULL,
          conversation_id BIGINT,
          job_id VARCHAR(128),
          agent_turn INTEGER,
          llm_call_id VARCHAR(128),
          tool_type VARCHAR(64),
          tool_name VARCHAR(128) NOT NULL,
          method_id VARCHAR(128),
          arguments JSONB,
          result JSONB,
          status VARCHAR(32) NOT NULL DEFAULT 'pending',
          error_message TEXT,
          execution_mode VARCHAR(64),
          side_effect BOOLEAN NOT NULL DEFAULT FALSE,
          started_at TIMESTAMP(3),
          completed_at TIMESTAMP(3),
          duration_ms BIGINT
        )
      `,
      'CREATE INDEX IF NOT EXISTS idx_agent_queue_pending_available ON agent_queue_messages (status, available_at, id)',
      'CREATE INDEX IF NOT EXISTS idx_agent_queue_session_pending ON agent_queue_messages (session_key, status, available_at, id)',
      'CREATE INDEX IF NOT EXISTS idx_agent_queue_trace_created ON agent_queue_messages (trace_id, created_at, id)',
      'CREATE INDEX IF NOT EXISTS idx_agent_runs_session_created ON agent_runs (session_key, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_agent_runs_trace_id ON agent_runs (trace_id)',
      'CREATE INDEX IF NOT EXISTS idx_agent_batches_session_created ON agent_message_batches (session_key, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_agent_batch_items_batch_position ON agent_message_batch_items (batch_id, position)',
      'CREATE INDEX IF NOT EXISTS idx_conversation_items_conversation_group_item ON conversation_items (conversation_id, group_index, item_index, id)',
      'CREATE INDEX IF NOT EXISTS idx_conversation_items_session_created ON conversation_items (session_key, created_at, id)',
      `ALTER TABLE agent_session_context_windows ADD COLUMN IF NOT EXISTS pending_proactive_share TEXT`,
      `ALTER TABLE agent_session_context_windows ADD COLUMN IF NOT EXISTS pending_proactive_share_age INTEGER DEFAULT 0`,
      'CREATE INDEX IF NOT EXISTS idx_agent_session_context_windows_updated ON agent_session_context_windows (updated_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_llm_jobs_trace_created ON llm_jobs (trace_id, created_at, id)',
      'CREATE INDEX IF NOT EXISTS idx_tool_execution_logs_trace_started ON tool_execution_logs (trace_id, started_at, completed_at, id)',
      'CREATE INDEX IF NOT EXISTS idx_conversations_trace_id ON conversations (trace_id)'
    ];

    for (const ddl of ddlStatements) {
      try {
        await this.sql.execute(ddl);
      } catch (error: any) {
        if (error?.code === '42P07' || error?.code === '42710') {
          continue;
        }
        throw error;
      }
    }
  }
}

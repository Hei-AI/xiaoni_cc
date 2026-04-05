import type { PrismaClient } from './generated/client';

export type DatabaseUrlConfig = {
  databaseUrl?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  connectionLimit?: number;
  applicationName?: string;
};

export type SqlTransaction = {
  query<T = Record<string, unknown>>(query: string, params?: any[]): Promise<T[]>;
  execute(query: string, params?: any[]): Promise<number>;
  insert(query: string, params?: any[]): Promise<{ insertId: number; affectedRows: number }>;
};

export type SqlAdapter = SqlTransaction & {
  testConnection(): Promise<boolean>;
  withTransaction<T>(callback: (tx: SqlTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

export type TrafficLogFilters = {
  startTime?: string | Date;
  endTime?: string | Date;
  method?: string;
  host?: string;
  status?: number | string;
  isAiRequest?: boolean;
  apiType?: string;
  containerName?: string;
  traceId?: string;
  llmCallId?: string;
  search?: string;
};

export type TrafficLogListParams = {
  page?: number;
  limit?: number;
  filters?: TrafficLogFilters;
};

export type TrafficStatsParams = {
  startTime?: string | Date;
  endTime?: string | Date;
};

export type TrafficEndpointParams = {
  limit?: number;
  sortBy?: 'request_count' | 'avg_duration' | 'error_rate';
};

export type TrafficExportParams = {
  startTime?: string | Date;
  endTime?: string | Date;
  includeBody?: boolean;
  limit?: number;
};

export type TrafficTraceParams = {
  traceId?: string;
  conversationId?: number | bigint | string;
};

export type TrafficLogBatchInput = {
  request_id?: string | null;
  trace_id?: string | null;
  conversation_id?: number | bigint | string | null;
  user_id?: string | null;
  session_id?: string | null;
  agent_turn?: number | null;
  llm_call_id?: string | null;
  tool_call_id?: string | null;
  container_name?: string | null;
  service_name?: string | null;
  method: string;
  url: string;
  host: string;
  path: string;
  query_params?: Record<string, unknown> | string | null;
  request_headers?: Record<string, unknown> | string | null;
  request_body?: string | null;
  request_content_type?: string | null;
  request_size?: number | null;
  response_status?: number | null;
  response_headers?: Record<string, unknown> | string | null;
  response_body?: string | null;
  response_content_type?: string | null;
  response_size?: number | null;
  duration_ms?: number | bigint | null;
  request_timestamp: string | Date;
  response_timestamp?: string | Date | null;
  is_ai_request?: boolean;
  api_type?: string | null;
  api_version?: string | null;
  client_ip?: string | null;
  user_agent?: string | null;
  error_message?: string | null;
};

export type TrafficReplayHistoryInput = {
  original_log_id: number | bigint;
  replay_name?: string | null;
  target_url?: string | null;
  request_method?: string | null;
  request_headers?: Record<string, unknown> | null;
  request_body?: string | null;
  response_status?: number | null;
  response_headers?: Record<string, unknown> | null;
  response_body?: string | null;
  duration_ms?: number | null;
  status?: string | null;
  error_message?: string | null;
  replayed_by?: string | null;
  modified_method?: string | null;
  modified_url?: string | null;
  modified_headers?: Record<string, unknown> | null;
  modified_body?: string | null;
  modification_summary?: Record<string, unknown> | null;
  replay_request_headers?: Record<string, unknown> | null;
  replay_request_body?: string | null;
  replay_response_status?: number | null;
  replay_duration_ms?: number | null;
  replay_response_headers?: Record<string, unknown> | null;
  replay_response_body?: string | null;
  replay_response_size?: number | null;
  diff_summary?: Record<string, unknown> | null;
  status_code_match?: boolean;
  response_body_match?: boolean;
  duration_diff_ms?: number | null;
  body_size_diff?: number | null;
  success?: boolean;
  template_id?: number | null;
};

export type RelationshipLedgerEventInput = {
  groupId?: number | bigint | string | null;
  targetUserId?: number | bigint | string | null;
  sessionKey: string;
  eventType: string;
  eventWeight?: number;
  confidence?: 'high' | 'medium' | 'low' | string;
  sourceMessageIds: Array<number | bigint | string> | Array<string>;
  sourceExcerpt?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string | Date | null;
  lastReinforcedAt?: string | Date | null;
};

export type RelationshipMemoryJobInput = {
  groupId?: number | bigint | string | null;
  sessionKey: string;
  status?: 'pending' | 'running' | 'succeeded' | 'failed' | string;
  triggerReason?: string;
  turnRangeStart?: number | bigint | string | null;
  turnRangeEnd?: number | bigint | string | null;
  ledgerEventCount?: number;
  inputMessageIds?: Array<number | bigint | string> | Array<string>;
  outputCardVersion?: number | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
  startedAt?: string | Date | null;
  finishedAt?: string | Date | null;
};

export type RelationshipMemoryCardInput = {
  isActive?: boolean;
  summaryText: string;
  actors?: unknown[];
  contextBefore?: string | null;
  trigger?: string | null;
  interaction?: string | null;
  outcome?: string | null;
  sourceEventIds?: Array<number | bigint | string> | Array<string>;
  sourceMessageIds?: Array<number | bigint | string> | Array<string>;
  importanceScore?: number;
  freshnessScore?: number;
  decayedScore?: number;
  retrievalText?: string | null;
  embeddingText?: string | null;
  lastHitAt?: string | Date | null;
  metadata?: Record<string, unknown> | null;
};

export type RelationshipMemoryOverrideInput = {
  cardId: number | bigint | string;
  actionType: string;
  manualNote?: string | null;
  createdBy?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type RelationshipMemoryHitInput = {
  hitAt?: string | Date | null;
};
export type SelfEvolutionJobInput = {
  groupId?: number | bigint | string | null;
  targetUserId?: number | bigint | string | null;
  sessionKey: string;
  status?: string;
  triggerReason?: string;
  turnRangeStart?: number | bigint | string | null;
  turnRangeEnd?: number | bigint | string | null;
  sourceEventCount?: number;
  inputMessageIds?: unknown[];
  outputStateVersion?: number | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
  startedAt?: string | Date | null;
  finishedAt?: string | Date | null;
};
export type SelfEvolutionStateInput = {
  isActive?: boolean;
  socialPresenceBaseline: string;
  entryPreference: string;
  warmthBias: string;
  familiarityCeiling: string;
  topicResonance?: unknown[];
  boundaryTendencies?: Record<string, unknown>;
  reinforcedModes?: unknown[];
  suppressedModes?: unknown[];
  summaryText: string;
  sourceEventIds?: unknown[];
  sourceMessageIds?: unknown[];
  metadata?: Record<string, unknown>;
};

export type ChatSpaceTopicInput = {
  chatSpaceType: 'group' | 'direct' | string;
  chatSpaceId: number | bigint | string;
  status?: string;
  canonicalTitle?: string | null;
  startedAt?: string | Date | null;
  lastActivityAt?: string | Date | null;
  closedAt?: string | Date | null;
  currentAcceptedVersionId?: number | bigint | string | null;
  currentCandidateVersionId?: number | bigint | string | null;
  lastProjectionJobId?: number | bigint | string | null;
  metadata?: Record<string, unknown> | null;
};

export type TopicProjectionJobInput = {
  chatSpaceType: 'group' | 'direct' | string;
  chatSpaceId: number | bigint | string;
  triggerType?: string;
  status?: string;
  inputBundleJson?: Record<string, unknown> | null;
  inputBundleHash: string;
  baseVersionIds?: Array<number | bigint | string>;
  modelName?: string | null;
  modelConfigJson?: Record<string, unknown> | null;
  promptVersion?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
  startedAt?: string | Date | null;
  finishedAt?: string | Date | null;
};

export type TopicVersionRelationshipInput = {
  targetUserId: number | bigint | string;
  relationshipKind?: string | null;
  summaryText: string;
  actors?: unknown[];
  sourceEventIds?: Array<number | bigint | string>;
  sourceMessageIds?: Array<number | bigint | string>;
  metadata?: Record<string, unknown> | null;
};

export type TopicVersionEvidenceInput = {
  sourceKind: string;
  sourceId: number | bigint | string;
  sortOrder?: number;
  excerptText?: string | null;
  speakerId?: string | null;
  speakerName?: string | null;
  occurredAt?: string | Date | null;
  metadata?: Record<string, unknown> | null;
};

export type TopicProjectionVersionSnapshotInput = {
  topicId: number | bigint | string;
  projectionJobId?: number | bigint | string | null;
  versionNumber: number;
  status?: string;
  lifecycleState?: string;
  title?: string | null;
  summaryText: string;
  reviewPriorityScore?: number;
  heatScore?: number;
  participantIds?: Array<number | bigint | string> | Array<string>;
  topicKeywords?: string[];
  evidenceCount?: number;
  relationshipCount?: number;
  runtimeHitCount?: number;
  lastRuntimeHitAt?: string | Date | null;
  inputBundleHash: string;
  snapshotJson?: Record<string, unknown> | null;
  provenanceJson?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  relationships?: TopicVersionRelationshipInput[];
  evidence?: TopicVersionEvidenceInput[];
  topicUpdates?: Partial<ChatSpaceTopicInput>;
};

export type TopicReviewEventInput = {
  topicId: number | bigint | string;
  baseProjectionVersionId?: number | bigint | string | null;
  resultProjectionVersionId?: number | bigint | string | null;
  actionType: string;
  status?: string;
  createdBy?: string | null;
  manualNote?: string | null;
  patchJson?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type GoldenChatCaseInput = {
  chatSpaceType: 'group' | 'direct' | string;
  chatSpaceId: number | bigint | string;
  topicId?: number | bigint | string | null;
  sourceProjectionVersionId: number | bigint | string;
  label?: string | null;
  status?: string;
  inputBundleHash: string;
  expectedSnapshotJson?: Record<string, unknown> | null;
  fixtureBundleJson?: Record<string, unknown> | null;
  createdBy?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ChatPromptBindingSource = 'group' | 'private';

export type ResolvedChatAgentPrompt = {
  bindingSource: ChatPromptBindingSource;
  bindingPromptId: string;
  prompt: {
    id: string;
    promptName: string;
    agentType: string;
    systemInstruction: string;
    userPromptTemplate: string | null;
    contextVariables: Record<string, unknown>;
    modelName: string | null;
    modelConfig: Record<string, unknown>;
    advancedConfig: Record<string, unknown>;
  } | null;
};

export const Prisma: unknown;
export const STORAGE_TIMEZONE: string;
export const STORAGE_OFFSET: string;
export function buildDatabaseUrl(config?: DatabaseUrlConfig): string;
export function resolveDatabaseUrl(config?: DatabaseUrlConfig): string;
export function createSqlAdapter(config?: DatabaseUrlConfig): SqlAdapter;
export function getPrismaClient(config?: DatabaseUrlConfig): PrismaClient;
export function closePrismaClient(): Promise<void>;
export function resolveChatAgentPrompt(
  params: { chatType: 'direct' | 'group'; userId?: number | string | null; groupId?: number | string | null },
  config?: DatabaseUrlConfig
): Promise<ResolvedChatAgentPrompt | null>;
export function parseInstantValue(value: string | Date | null | undefined): Date | null;
export function parseStoredTimestamp(value: string | Date | null | undefined): Date | null;
export function serializeTimestampForStorage(value: string | Date | null | undefined): string | null;
export function serializeTimestampForApi(value: string | Date | null | undefined): string | null;
export function normalizeTimestampField(fieldName: string, value: unknown): unknown;
export function normalizeRowTimestampFields<T>(record: T): T;
export function prepareSqlParameter(value: unknown): unknown;
export function getEast8StartOfDay(value?: string | Date): Date;
export function formatEast8IsoOffset(value: string | Date): string;
export function formatEast8WallClock(value: string | Date): string;
export function listTrafficLogs(params?: TrafficLogListParams): Promise<{ data: any[]; total: number; page: number; limit: number }>;
export function getTrafficLogById(id: number | bigint | string): Promise<any | null>;
export function listTraceTrafficLogs(params?: TrafficTraceParams): Promise<any[]>;
export function getTrafficStats(params?: TrafficStatsParams): Promise<any>;
export function getTrafficEndpoints(params?: TrafficEndpointParams): Promise<any[]>;
export function searchTrafficLogs(params: { query: string; limit?: number }): Promise<any[]>;
export function exportTrafficLogs(params?: TrafficExportParams): Promise<any[]>;
export function ensureReplayHistorySchema(): Promise<void>;
export function listTrafficReplayHistory(originalLogId: number | bigint | string): Promise<any[]>;
export function createTrafficReplayHistory(data: TrafficReplayHistoryInput): Promise<any>;
export function listAiTrafficSamples(params?: { search?: string; limit?: number }): Promise<any[]>;
export function createTrafficLogBatch(records: TrafficLogBatchInput[]): Promise<{ count: number }>;
export function ensureRelationshipMemorySchema(config?: DatabaseUrlConfig): Promise<void>;
export function ensureSelfEvolutionSchema(config?: DatabaseUrlConfig): Promise<void>;
export function ensureTopicLabSchema(config?: DatabaseUrlConfig): Promise<void>;
export function appendRelationshipLedgerEvent(input: RelationshipLedgerEventInput, config?: DatabaseUrlConfig): Promise<any>;
export function reinforceRelationshipLedgerEvent(
  id: number | bigint | string,
  updates?: Partial<RelationshipLedgerEventInput>,
  config?: DatabaseUrlConfig
): Promise<any>;
export function listRelationshipLedgerEvents(
  filters?: { groupId?: number | bigint | string; targetUserId?: number | bigint | string; sessionKey?: string; eventType?: string; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function listRelationshipLedgerEventsByIds(
  ids: Array<number | bigint | string>,
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function createRelationshipMemoryJob(input: RelationshipMemoryJobInput, config?: DatabaseUrlConfig): Promise<any>;
export function updateRelationshipMemoryJob(
  id: number | bigint | string,
  updates?: Partial<RelationshipMemoryJobInput>,
  config?: DatabaseUrlConfig
): Promise<any>;
export function listRelationshipMemoryJobs(
  filters?: { groupId?: number | bigint | string; sessionKey?: string; status?: string; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function replaceRelationshipMemoryCards(
  input: {
    groupId?: number | bigint | string | null;
    targetUserId?: number | bigint | string | null;
    cardType: string;
    version: number;
    cards: RelationshipMemoryCardInput[];
  },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function listRelationshipMemoryCards(
  filters?: { groupId?: number | bigint | string | null; targetUserId?: number | bigint | string | null; cardType?: string; isActive?: boolean; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function getRelationshipMemoryCardById(
  id: number | bigint | string,
  config?: DatabaseUrlConfig
): Promise<any | null>;
export function listConversationItemsByIds(
  ids: Array<number | bigint | string>,
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function listAgentInboundMessages(
  filters?: { sessionKey?: string; chatType?: string; senderId?: string; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function listAgentInboundMessagesByIds(
  ids: Array<number | bigint | string>,
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function getAgentInboundMessageByMessageSid(
  messageSid: string,
  filters?: { sessionKey?: string },
  config?: DatabaseUrlConfig
): Promise<any | null>;
export function recordRelationshipMemoryOverride(input: RelationshipMemoryOverrideInput, config?: DatabaseUrlConfig): Promise<any>;
export function listRelationshipMemoryOverrides(cardId: number | bigint | string, config?: DatabaseUrlConfig): Promise<any[]>;
export function deleteRelationshipMemoryOverride(id: number | bigint | string, config?: DatabaseUrlConfig): Promise<any>;
export function markRelationshipMemoryCardsHit(
  ids: Array<number | bigint | string>,
  params?: RelationshipMemoryHitInput,
  config?: DatabaseUrlConfig
): Promise<{ count: number; hit_at: Date | null }>;
export function createSelfEvolutionJob(input: SelfEvolutionJobInput, config?: DatabaseUrlConfig): Promise<any>;
export function updateSelfEvolutionJob(
  id: number | bigint | string,
  updates?: Partial<SelfEvolutionJobInput>,
  config?: DatabaseUrlConfig
): Promise<any>;
export function listSelfEvolutionJobs(
  filters?: { groupId?: number | bigint | string | null; targetUserId?: number | bigint | string | null; sessionKey?: string; status?: string; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function replaceSelfEvolutionStates(
  input: {
    sessionKey: string;
    groupId?: number | bigint | string | null;
    targetUserId?: number | bigint | string | null;
    scopeType: string;
    version: number;
    states: SelfEvolutionStateInput[];
  },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function listSelfEvolutionStates(
  filters?: { sessionKey?: string; groupId?: number | bigint | string | null; targetUserId?: number | bigint | string | null; scopeType?: string; isActive?: boolean; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function createChatSpaceTopic(input: ChatSpaceTopicInput, config?: DatabaseUrlConfig): Promise<any>;
export function updateChatSpaceTopic(
  id: number | bigint | string,
  updates?: Partial<ChatSpaceTopicInput>,
  config?: DatabaseUrlConfig
): Promise<any>;
export function getChatSpaceTopicById(id: number | bigint | string, config?: DatabaseUrlConfig): Promise<any | null>;
export function listChatSpaceTopics(
  filters?: { chatSpaceType?: string; chatSpaceId?: number | bigint | string; status?: string; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function createTopicProjectionJob(input: TopicProjectionJobInput, config?: DatabaseUrlConfig): Promise<any>;
export function updateTopicProjectionJob(
  id: number | bigint | string,
  updates?: Partial<TopicProjectionJobInput>,
  config?: DatabaseUrlConfig
): Promise<any>;
export function getTopicProjectionJobById(id: number | bigint | string, config?: DatabaseUrlConfig): Promise<any | null>;
export function listTopicProjectionJobs(
  filters?: { chatSpaceType?: string; chatSpaceId?: number | bigint | string; status?: string; triggerType?: string; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function createTopicProjectionVersionSnapshot(
  input: TopicProjectionVersionSnapshotInput,
  config?: DatabaseUrlConfig
): Promise<any>;
export function updateTopicProjectionVersion(
  id: number | bigint | string,
  updates?: Partial<TopicProjectionVersionSnapshotInput>,
  config?: DatabaseUrlConfig
): Promise<any>;
export function getTopicProjectionVersionById(id: number | bigint | string, config?: DatabaseUrlConfig): Promise<any | null>;
export function listTopicProjectionVersions(
  filters?: { topicId?: number | bigint | string; projectionJobId?: number | bigint | string; status?: string; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function listTopicVersionRelationships(
  filters?: { projectionVersionId?: number | bigint | string; targetUserId?: number | bigint | string; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function listTopicVersionEvidence(
  filters?: { projectionVersionId?: number | bigint | string; sourceKind?: string; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function createTopicReviewEvent(input: TopicReviewEventInput, config?: DatabaseUrlConfig): Promise<any>;
export function updateTopicReviewEvent(
  id: number | bigint | string,
  updates?: Partial<TopicReviewEventInput>,
  config?: DatabaseUrlConfig
): Promise<any>;
export function getTopicReviewEventById(id: number | bigint | string, config?: DatabaseUrlConfig): Promise<any | null>;
export function listTopicReviewEvents(
  filters?: { topicId?: number | bigint | string; baseProjectionVersionId?: number | bigint | string; status?: string; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function createGoldenChatCase(input: GoldenChatCaseInput, config?: DatabaseUrlConfig): Promise<any>;
export function listGoldenChatCases(
  filters?: { chatSpaceType?: string; chatSpaceId?: number | bigint | string; topicId?: number | bigint | string; status?: string; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;

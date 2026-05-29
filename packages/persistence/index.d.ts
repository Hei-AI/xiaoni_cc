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

export type FeedbackEpisodeInput = {
  sessionKey: string;
  groupId?: number | bigint | string | null;
  sourceUserId?: number | bigint | string | null;
  sourceUserName?: string | null;
  scopeType?: 'group_self' | 'from_user' | string;
  eventKind?: 'feedback' | 'praise' | 'critique' | 'correction' | 'interaction_outcome' | string;
  excerptText?: string | null;
  sourceMessageIds?: Array<number | bigint | string> | Array<string>;
  sourceConversationId?: number | bigint | string | null;
  eventImportance?: number;
  sourceSalience?: number;
  metadata?: Record<string, unknown> | null;
};
export type FeedbackReflectionInput = {
  sessionKey: string;
  groupId?: number | bigint | string | null;
  sourceUserId?: number | bigint | string | null;
  sourceUserName?: string | null;
  scopeType?: 'group_self' | 'from_user' | string;
  learningKey?: string;
  learningScope?: string;
  reflectionType?: 'semantic_lesson' | 'social_lesson' | 'self_model_update' | string;
  feedbackKind?: 'positive' | 'negative' | 'mixed' | string;
  confidence?: 'high' | 'medium' | 'low' | string;
  importanceScore?: number;
  evidenceWeight?: number;
  stabilityScore?: number;
  isActive?: boolean;
  isSeed?: boolean | null;
  summaryText: string;
  retrievalText?: string | null;
  embeddingText?: string | null;
  sourceMessageIds?: Array<number | bigint | string> | Array<string>;
  sourceEpisodeIds?: Array<number | bigint | string> | Array<string>;
  sourceConversationId?: number | bigint | string | null;
  supersedesReflectionId?: number | bigint | string | null;
  conflictGroupKey?: string | null;
  metadata?: Record<string, unknown> | null;
  lastHitAt?: string | Date | null;
  hitCount?: number;
};
export type FeedbackReflectionHitInput = {
  hitAt?: string | Date | null;
};
export type FeedbackLearningStateInput = {
  sessionKey: string;
  groupId?: number | bigint | string | null;
  scopeType?: 'group_self' | 'from_user' | string;
  learningKey: string;
  learningScope: string;
  stateType?: 'reinforced' | 'tentative' | 'conflicted' | 'revised' | string;
  activeReflectionId?: number | bigint | string | null;
  latestReflectionId?: number | bigint | string | null;
  activationWeight?: number;
  recencyWeight?: number;
  importanceWeight?: number;
  sourceWeight?: number;
  conflictPenalty?: number;
  metadata?: Record<string, unknown> | null;
};

export type AgentMemoryObservationInput = {
  sessionKey: string;
  groupId?: number | bigint | string | null;
  sourceConversationId?: number | bigint | string | null;
  sourceTurnIds?: Array<number | bigint | string>;
  sourceMessageIds?: Array<number | bigint | string>;
  topic: string;
  text: string;
  poignancy?: number;
  participants?: Array<Record<string, unknown>>;
  xiaoniRole?: string;
  sourceTraceId?: string | null;
  sourceRunId?: string | null;
  writerModel?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type AgentMemoryAssertionInput = {
  sessionKey: string;
  groupId?: number | bigint | string | null;
  sourceConversationId?: number | bigint | string | null;
  sourceTurnIds?: Array<number | bigint | string>;
  sourceMessageIds?: Array<number | bigint | string>;
  text: string;
  factType: string;
  entities?: Array<Record<string, unknown>>;
  participants?: Array<Record<string, unknown>>;
  sourceTraceId?: string | null;
  sourceRunId?: string | null;
  writerModel?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type AgentMemoryReflectionInput = {
  sessionKey: string;
  groupId?: number | bigint | string | null;
  sourceConversationId?: number | bigint | string | null;
  text: string;
  kind: string;
  subjects?: string[];
  evidenceBasis: string;
  evidenceTimeStart?: string | Date | null;
  evidenceTimeEnd?: string | Date | null;
  poignancy?: number;
  sourceObservationIds?: Array<number | bigint | string>;
  sourceMessageIds?: Array<number | bigint | string>;
  sourceTraceId?: string | null;
  sourceRunId?: string | null;
  writerModel?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ImageLabRunInput = {
  id: string;
  operation: string;
  status?: string;
  parentRunId?: string | null;
  parent_run_id?: string | null;
  prompt: string;
  provider?: string | null;
  model?: string | null;
  size?: string | null;
  quality?: string | null;
  format?: string | null;
  inputJson?: Record<string, unknown> | null;
  input_json?: Record<string, unknown> | null;
  resultJson?: Record<string, unknown> | null;
  result_json?: Record<string, unknown> | null;
  errorMessage?: string | null;
  error_message?: string | null;
  startedAt?: string | Date | null;
  started_at?: string | Date | null;
  completedAt?: string | Date | null;
  completed_at?: string | Date | null;
};

export type ImageLabRunUpdateInput = {
  id: string;
  status?: string;
  resultJson?: Record<string, unknown> | null;
  result_json?: Record<string, unknown> | null;
  errorMessage?: string | null;
  error_message?: string | null;
  completedAt?: string | Date | null;
  completed_at?: string | Date | null;
};

export type ImageLabArtifactInput = {
  id: string;
  kind?: string | null;
  filePath?: string;
  file_path?: string;
  publicPath?: string;
  public_path?: string;
  mimeType?: string;
  mime_type?: string;
  format?: string | null;
  bytes?: number | null;
  width?: number | null;
  height?: number | null;
  revisedPrompt?: string | null;
  revised_prompt?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type IdentityEvidenceRefInput = {
  identityKey?: string;
  identityEventId?: number | bigint | string | null;
  changeCandidateId?: number | bigint | string | null;
  acceptedFactId?: number | bigint | string | null;
  sourceType: string;
  sourceId: string | number | bigint;
  traceId?: string | null;
  runId?: string | null;
  conversationId?: number | bigint | string | null;
  redactionStatus?: 'visible' | 'redacted' | 'tombstoned' | string;
  confidence?: 'high' | 'medium' | 'low' | string;
  metadata?: Record<string, unknown> | null;
};

export type XiaoniIdentityRootInput = {
  identityKey: string;
  sourcePromptId?: string | null;
  systemInstructionHash?: string | null;
  systemInstructionSnapshot: string;
  status?: 'active' | 'retired' | string;
  createdBy?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type IdentityLineageEventInput = {
  identityKey: string;
  eventType?: 'genesis' | 'candidate_proposed' | 'candidate_judged' | 'fact_accepted' | 'fact_superseded' | 'fact_revoked' | 'natural_growth' | 'guided_growth' | 'external_intervention' | 'identity_retcon' | 'corruption' | 'fork' | 'forgetting' | 'death_or_reset' | 'continuity_trial' | string;
  sourceType?: string;
  sourceId?: string | number | bigint | null;
  summaryText: string;
  previousEventId?: number | bigint | string | null;
  parentEventId?: number | bigint | string | null;
  forkedFromIdentityKey?: string | null;
  forkPointEventId?: number | bigint | string | null;
  changeCandidateId?: number | bigint | string | null;
  acceptedFactId?: number | bigint | string | null;
  integrityStatus?: 'accepted' | 'needs_review' | 'quarantined' | 'rejected' | string;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string | Date | null;
  evidenceRefs?: IdentityEvidenceRefInput[];
};

export type IdentityChangeCandidateInput = {
  identityKey: string;
  candidateType?: 'natural_growth' | 'guided_growth' | 'external_intervention' | 'identity_retcon' | 'corruption' | 'fork' | 'forgetting' | 'death_or_reset' | string;
  proposedBy?: string | null;
  proposedFrom?: string | null;
  claimText: string;
  beforeSummary?: string | null;
  afterSummary?: string | null;
  status?: 'pending' | 'accepted' | 'quarantined' | 'rejected' | 'superseded' | string;
  judgeStatus?: 'not_judged' | 'accepted' | 'quarantined' | 'rejected' | 'failed' | string;
  judgeReason?: string | null;
  judgeRunId?: string | null;
  judgeLlmCallId?: string | null;
  quarantineGroupKey?: string | null;
  supersedesFactId?: number | bigint | string | null;
  legacySourceTable?: string | null;
  legacySourceId?: string | null;
  judgedAt?: string | Date | null;
  metadata?: Record<string, unknown> | null;
  lineageMetadata?: Record<string, unknown> | null;
  recordLineageEvent?: boolean;
  evidenceRefs?: IdentityEvidenceRefInput[];
};

export type AcceptedIdentityFactInput = {
  identityKey: string;
  factKey: string;
  factText: string;
  factType?: string;
  sourceCandidateId?: number | bigint | string | null;
  sourceEventId?: number | bigint | string | null;
  status?: 'active' | 'superseded' | 'revoked' | 'inactive' | string;
  supersedesFactId?: number | bigint | string | null;
  revokedByEventId?: number | bigint | string | null;
  confidence?: 'high' | 'medium' | 'low' | string;
  activationTags?: unknown[];
  acceptedAt?: string | Date | null;
  metadata?: Record<string, unknown> | null;
  lineageMetadata?: Record<string, unknown> | null;
  recordLineageEvent?: boolean;
  evidenceRefs?: IdentityEvidenceRefInput[];
};

export type RuntimeIdentityActivationTraceInput = {
  identityKey: string;
  runId?: string | null;
  traceId?: string | null;
  conversationId?: number | bigint | string | null;
  sceneFingerprint?: string | null;
  cueSummary?: string | null;
  activatedRefs?: unknown[];
  suppressedRefs?: unknown[];
  selectedSkillRef?: string | null;
  activationReason?: string | null;
  metadata?: Record<string, unknown> | null;
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
export function ensureSelfEvolutionSchema(config?: DatabaseUrlConfig): Promise<void>;
export function ensureFeedbackReflectionSchema(config?: DatabaseUrlConfig): Promise<void>;
export function ensureIdentityLineageSchema(config?: DatabaseUrlConfig): Promise<void>;
export function ensureTopicLabSchema(config?: DatabaseUrlConfig): Promise<void>;
export function ensureAbExperimentSchema(config?: DatabaseUrlConfig): Promise<void>;
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
export function listConversationItemsByIds(
  ids: Array<number | bigint | string>,
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function listAgentInboundMessages(
  filters?: { sessionKey?: string; chatType?: string; peerId?: string; senderId?: string; limit?: number; offset?: number },
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
export function createFeedbackEpisode(input: FeedbackEpisodeInput, config?: DatabaseUrlConfig): Promise<any>;
export function listFeedbackEpisodes(
  filters?: {
    sessionKey?: string;
    groupId?: number | bigint | string | null;
    sourceUserId?: number | bigint | string | null;
    scopeType?: string;
    eventKind?: string;
    limit?: number;
  },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function createFeedbackReflection(input: FeedbackReflectionInput, config?: DatabaseUrlConfig): Promise<any>;
export function listFeedbackReflections(
  filters?: {
    sessionKey?: string;
    groupId?: number | bigint | string | null;
    sourceUserId?: number | bigint | string | null;
    scopeType?: string;
    learningKey?: string;
    learningScope?: string;
    feedbackKind?: string;
    isActive?: boolean;
    limit?: number;
  },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function markFeedbackReflectionsHit(
  ids: Array<number | bigint | string>,
  params?: FeedbackReflectionHitInput,
  config?: DatabaseUrlConfig
): Promise<{ count: number; hit_at: Date | null }>;
export function getFeedbackLearningState(
  filters: {
    sessionKey?: string;
    groupId?: number | bigint | string | null;
    scopeType?: string;
    learningKey?: string;
    learningScope?: string;
    scopeHash?: string;
  },
  config?: DatabaseUrlConfig
): Promise<any | null>;
export function listFeedbackLearningStates(
  filters?: {
    sessionKey?: string;
    groupId?: number | bigint | string | null;
    scopeType?: string;
    learningKey?: string;
    learningScope?: string;
    limit?: number;
  },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function upsertFeedbackLearningState(input: FeedbackLearningStateInput, config?: DatabaseUrlConfig): Promise<any>;
export function ensureAgentMemorySchema(config?: DatabaseUrlConfig): Promise<void>;
export function createAgentMemoryObservation(input: AgentMemoryObservationInput, config?: DatabaseUrlConfig): Promise<any>;
export function createAgentMemoryAssertion(input: AgentMemoryAssertionInput, config?: DatabaseUrlConfig): Promise<any>;
export function createAgentMemoryReflection(input: AgentMemoryReflectionInput, config?: DatabaseUrlConfig): Promise<any>;
export function listAgentMemoryObservations(
  filters?: { sessionKey?: string; groupId?: number | bigint | string | null; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export const IdentityLineageValidationError: {
  new(message: string, code?: string): Error & { code?: string };
};
export function createXiaoniIdentityRoot(input: XiaoniIdentityRootInput, config?: DatabaseUrlConfig): Promise<any>;
export function ensureXiaoniIdentityRoot(
  input: XiaoniIdentityRootInput,
  config?: DatabaseUrlConfig
): Promise<{ root: any; event: any | null; created: boolean }>;
export function getActiveXiaoniIdentityRoot(identityKey: string, config?: DatabaseUrlConfig): Promise<any | null>;
export function appendIdentityLineageEvent(
  input: IdentityLineageEventInput,
  config?: DatabaseUrlConfig
): Promise<{ event: any; evidenceRefs: any[] }>;
export function appendIdentityChangeCandidate(
  input: IdentityChangeCandidateInput,
  config?: DatabaseUrlConfig
): Promise<{ candidate: any; event: any | null; evidenceRefs: any[] }>;
export function createAcceptedIdentityFact(
  input: AcceptedIdentityFactInput,
  config?: DatabaseUrlConfig
): Promise<{ fact: any; event: any | null; evidenceRefs: any[] }>;
export function recordIdentityFork(
  input: IdentityLineageEventInput & { forkedFromIdentityKey: string; forkPointEventId: number | bigint | string },
  config?: DatabaseUrlConfig
): Promise<{ event: any; evidenceRefs: any[] }>;
export function recordForgettingTombstone(
  input: IdentityLineageEventInput,
  config?: DatabaseUrlConfig
): Promise<{ event: any; evidenceRefs: any[] }>;
export function recordContinuityTrial(
  input: IdentityLineageEventInput,
  config?: DatabaseUrlConfig
): Promise<{ event: any; evidenceRefs: any[] }>;
export function recordRuntimeIdentityActivationTrace(input: RuntimeIdentityActivationTraceInput, config?: DatabaseUrlConfig): Promise<any>;
export function listIdentityLineageEvents(
  filters?: { identityKey?: string; eventType?: string; integrityStatus?: string; changeCandidateId?: number | bigint | string; acceptedFactId?: number | bigint | string; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function listIdentityChangeCandidates(
  filters?: { identityKey?: string; candidateType?: string; status?: string; judgeStatus?: string; quarantineGroupKey?: string; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function listIdentityEvidenceRefs(
  filters?: {
    identityKey?: string;
    identityEventId?: number | bigint | string;
    changeCandidateId?: number | bigint | string;
    acceptedFactId?: number | bigint | string;
    sourceType?: string;
    traceId?: string;
    runId?: string;
    redactionStatus?: string;
    limit?: number;
  },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function listAcceptedIdentityFacts(
  filters?: { identityKey?: string; factType?: string; status?: string; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function listRuntimeIdentityActivationTraces(
  filters?: { identityKey?: string; traceId?: string; runId?: string; conversationId?: number | bigint | string; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
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
export function ensureImageLabSchema(config?: DatabaseUrlConfig): Promise<void>;
export function createImageLabRun(input: ImageLabRunInput, config?: DatabaseUrlConfig): Promise<any>;
export function updateImageLabRun(input: ImageLabRunUpdateInput, config?: DatabaseUrlConfig): Promise<any>;
export function addImageLabArtifacts(runId: string, artifacts: ImageLabArtifactInput[], config?: DatabaseUrlConfig): Promise<any[]>;
export function getImageLabRunById(id: string, config?: DatabaseUrlConfig): Promise<any | null>;
export function listImageLabRuns(
  filters?: { operation?: string; status?: string; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function ensureAgentMediaSchema(config?: DatabaseUrlConfig): Promise<void>;
export function upsertAgentMediaAsset(input: Record<string, any>, config?: DatabaseUrlConfig): Promise<any>;
export function upsertAgentMediaAssets(inputs: Record<string, any>[], config?: DatabaseUrlConfig): Promise<any[]>;
export function listAgentMediaAssets(
  filters?: { sessionKey?: string; session_key?: string; messageSids?: string[]; message_sids?: string[]; mediaTag?: string; media_tag?: string; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function getAgentMediaAssetByTag(
  filters?: { sessionKey?: string; session_key?: string; messageSids?: string[]; message_sids?: string[]; mediaTag?: string; media_tag?: string; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any | null>;
export function createAgentMediaObservation(input: Record<string, any>, config?: DatabaseUrlConfig): Promise<any>;
export function ensureAgentTaskSchema(config?: DatabaseUrlConfig): Promise<void>;
export function createAgentTask(input: Record<string, any>, config?: DatabaseUrlConfig): Promise<any>;
export function claimNextAgentTask(workerId: string, config?: DatabaseUrlConfig): Promise<any | null>;
export function updateAgentTask(input: Record<string, any>, config?: DatabaseUrlConfig): Promise<any>;
export function addAgentTaskArtifacts(taskId: string, artifacts: Record<string, any>[], config?: DatabaseUrlConfig): Promise<any[]>;
export function getAgentTaskById(id: string, config?: DatabaseUrlConfig): Promise<any | null>;
export function listAgentTasks(
  filters?: { sessionKey?: string; session_key?: string; status?: string; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export type AbTurnSnapshotInput = {
  id?: string;
  sourceKey?: string;
  source_key?: string;
  traceId?: string | null;
  trace_id?: string | null;
  runId?: string | null;
  run_id?: string | null;
  sessionKey?: string | null;
  session_key?: string | null;
  chatType?: string | null;
  chat_type?: string | null;
  peerId?: string | null;
  peer_id?: string | null;
  senderId?: string | null;
  sender_id?: string | null;
  queueMessageIds?: unknown[];
  queue_message_ids?: unknown[];
  providerEventIds?: unknown[];
  provider_event_ids?: unknown[];
  scene?: Record<string, unknown>;
  memoryStreamView?: Record<string, unknown>;
  memory_stream_view?: Record<string, unknown>;
  retrievalPolicy?: Record<string, unknown>;
  retrieval_policy?: Record<string, unknown>;
  runtimeConfig?: Record<string, unknown>;
  runtime_config?: Record<string, unknown>;
  captureStatus?: string;
  capture_status?: string;
  controlStatus?: string;
  control_status?: string;
  treatmentStatus?: string;
  treatment_status?: string;
  evalStatus?: string;
  eval_status?: string;
  captureError?: string | null;
  capture_error?: string | null;
};
export type AbArmRunInput = {
  id?: string;
  snapshotId?: string;
  snapshot_id?: string;
  arm: 'control' | 'treatment' | string;
  projectOrNamespace?: string | null;
  project_or_namespace?: string | null;
  runnerName?: string | null;
  runner_name?: string | null;
  modelName?: string | null;
  model_name?: string | null;
  inputSummary?: Record<string, unknown>;
  input_summary?: Record<string, unknown>;
  outputArtifact?: Record<string, unknown>;
  output_artifact?: Record<string, unknown>;
  memoryContext?: Record<string, unknown>;
  memory_context?: Record<string, unknown>;
  failure?: Record<string, unknown> | null;
  startedAt?: string | Date | null;
  started_at?: string | Date | null;
  completedAt?: string | Date | null;
  completed_at?: string | Date | null;
  status?: string;
};
export type AbMemoryStreamItemInput = {
  id?: string;
  namespace: string;
  arm: 'control' | 'treatment' | string;
  type: 'observation' | 'reflection' | 'plan' | string;
  subtype?: string | null;
  content: string;
  retrievalText?: string | null;
  retrieval_text?: string | null;
  embeddingText?: string | null;
  embedding_text?: string | null;
  importance?: number;
  confidence?: number;
  status?: string;
  sourceEventRefs?: unknown[];
  source_event_refs?: unknown[];
  provenance?: Record<string, unknown>;
  ttlExpiresAt?: string | Date | null;
  ttl_expires_at?: string | Date | null;
  fulfilledAt?: string | Date | null;
  fulfilled_at?: string | Date | null;
};
export type AbEvalResultInput = {
  id?: string;
  snapshotId?: string;
  snapshot_id?: string;
  controlArmRunId?: string | null;
  control_arm_run_id?: string | null;
  treatmentArmRunId?: string | null;
  treatment_arm_run_id?: string | null;
  label?: 'mini_better' | 'control_better' | 'tie' | 'both_bad' | 'unclear' | string;
  dimensions?: Record<string, unknown>;
  reviewerNotes?: string | null;
  reviewer_notes?: string | null;
  isolationCheck?: Record<string, unknown>;
  isolation_check?: Record<string, unknown>;
  fixtureId?: string | null;
  fixture_id?: string | null;
};
export function createAbTurnSnapshot(input: AbTurnSnapshotInput, config?: DatabaseUrlConfig): Promise<any>;
export function getAbTurnSnapshot(idOrSourceKey: string, config?: DatabaseUrlConfig): Promise<any | null>;
export function listAbTurnSnapshots(
  filters?: {
    traceId?: string;
    trace_id?: string;
    runId?: string;
    run_id?: string;
    sessionKey?: string;
    session_key?: string;
    chatType?: string;
    chat_type?: string;
    captureStatus?: string;
    capture_status?: string;
    controlStatus?: string;
    control_status?: string;
    treatmentStatus?: string;
    treatment_status?: string;
    evalStatus?: string;
    eval_status?: string;
    limit?: number;
  },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function updateAbTurnSnapshotStatuses(snapshotId: string, statuses?: Record<string, string>, config?: DatabaseUrlConfig): Promise<any | null>;
export function upsertAbArmRun(input: AbArmRunInput, config?: DatabaseUrlConfig): Promise<any>;
export function getAbArmRunsForSnapshot(snapshotId: string, config?: DatabaseUrlConfig): Promise<any[]>;
export function createAbMemoryStreamItem(input: AbMemoryStreamItemInput, config?: DatabaseUrlConfig): Promise<any>;
export function listAbMemoryStreamItems(
  filters?: { namespace?: string; arm?: string; type?: string; subtype?: string; status?: string; includeExpired?: boolean; limit?: number },
  config?: DatabaseUrlConfig
): Promise<any[]>;
export function markAbMemoryPlanFulfilled(id: string, params?: { status?: string; fulfilledAt?: string | Date; fulfilled_at?: string | Date }, config?: DatabaseUrlConfig): Promise<any>;
export function createAbEvalResult(input: AbEvalResultInput, config?: DatabaseUrlConfig): Promise<any>;
export function getAbExperimentTrace(snapshotId: string, config?: DatabaseUrlConfig): Promise<any | null>;

export type RelationshipTrustLevel = 'L1' | 'L2' | 'L3' | 'L4';
export function ensureRelationshipTrustSchema(config?: DatabaseUrlConfig): Promise<void>;
export function getRelationshipTrustLevel(identityKey: string, speakerQq: number | bigint | string, config?: DatabaseUrlConfig): Promise<RelationshipTrustLevel>;
export function upsertRelationshipTrust(input: { identityKey: string; speakerQq: number | bigint | string; trustScore: number; level: RelationshipTrustLevel }, config?: DatabaseUrlConfig): Promise<void>;
export function incrementRelationshipTrust(input: { identityKey: string; speakerQq: number; delta: number }, config?: Record<string, unknown>): Promise<void>;

// agent-queue
export type AgentQueueEnqueueInput = {
  message?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  availableAt?: string | Date;
  available_at?: string | Date;
} & Record<string, unknown>;
export function enqueueAgentQueueMessage(input: AgentQueueEnqueueInput, config?: DatabaseUrlConfig): Promise<{
  queueId: number;
  traceId: string;
  dedupeKey: string;
  status: string;
  attempts: number;
  availableAt: string | null;
  payload: Record<string, unknown>;
}>;

// agent-presence
export type AgentSharePoolItemProjection = {
  id: number;
  identityKey: string;
  content: string;
  sourceKind: string;
  boundaryLabel: string;
  sourceWording: string;
  effortCost: number;
  baseHeat: number;
  createdAt: string | null;
  metadata: Record<string, unknown>;
};
export function ensureAgentPresenceSchema(config?: DatabaseUrlConfig): Promise<void>;
export function ensureAgentLifeState(identityKey: string, config?: DatabaseUrlConfig): Promise<Record<string, unknown>>;
export function getAgentLifeState(identityKey: string, config?: DatabaseUrlConfig): Promise<Record<string, unknown> | null>;
export function updateAgentLifeState(identityKey: string, data: Record<string, unknown>, config?: DatabaseUrlConfig): Promise<Record<string, unknown>>;
export function upsertAgentGroupPresenceState(input: Record<string, unknown>, config?: DatabaseUrlConfig): Promise<Record<string, unknown>>;
export function listAgentSharePoolItems(input?: Record<string, unknown>, config?: DatabaseUrlConfig): Promise<AgentSharePoolItemProjection[]>;
export function createAgentShareItemUsage(input: Record<string, unknown>, config?: DatabaseUrlConfig): Promise<Record<string, unknown>>;
export function createAgentPresenceStateSidecar(input: Record<string, unknown>, config?: DatabaseUrlConfig): Promise<Record<string, unknown>>;

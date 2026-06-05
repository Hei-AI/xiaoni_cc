export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type AbArm = 'control' | 'treatment';
export type AbRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type AbCaptureStatus = 'created' | 'failed' | 'partial';
export type AbEvalLabel = 'mini_better' | 'control_better' | 'tie' | 'both_bad' | 'unclear';
export type AbMemoryItemType = 'observation' | 'reflection' | 'plan';
export type AbMemoryItemStatus = 'active' | 'fulfilled' | 'expired' | 'superseded';

export interface AbSourceEventRef {
  table?: string;
  kind: string;
  id: string;
  traceId?: string | null;
  runId?: string | null;
  createdAt?: string | null;
  metadata?: JsonObject;
}

export interface AbRuntimeConfigSnapshot {
  controlModelName?: string | null;
  treatmentModelName?: string | null;
  promptVersions?: Record<string, string | null>;
  rendererVersions?: Record<string, string | null>;
  providerConfig?: JsonObject;
  featureFlags?: Record<string, boolean>;
  metadata?: JsonObject;
}

export interface AbRetrievalPolicySnapshot {
  relevanceWeight: number;
  recencyWeight: number;
  importanceWeight: number;
  typeLimits: {
    observations: AbMemoryBudgetLimit;
    reflections: AbMemoryBudgetLimit;
    plans: AbMemoryBudgetLimit;
    selfState?: AbMemoryBudgetLimit;
  };
  totalSoftCapTokens: number;
  totalHardCapTokens: number;
  metadata?: JsonObject;
}

export interface AbMemoryBudgetLimit {
  maxItems: number;
  maxTokens: number;
}

export interface AbSceneSnapshot {
  unreadMessages: AbSceneMessage[];
  recentContext: AbSceneMessage[];
  readCutoff?: {
    messageId?: string | number | null;
    timestamp?: string | null;
  };
  summary?: string | null;
  metadata?: JsonObject;
}

export interface AbSceneMessage {
  id?: string | number | null;
  role: 'user' | 'assistant' | 'system' | 'event';
  content: string;
  senderId?: string | null;
  senderName?: string | null;
  timestamp?: string | null;
  sourceRefs?: AbSourceEventRef[];
  metadata?: JsonObject;
}

export interface AbTurnSnapshot {
  id: string;
  sourceKey: string;
  traceId?: string | null;
  runId?: string | null;
  sessionKey?: string | null;
  chatType?: 'private' | 'group' | string | null;
  peerId?: string | null;
  senderId?: string | null;
  queueMessageIds: Array<string | number>;
  providerEventIds: Array<string | number>;
  scene: AbSceneSnapshot;
  memoryStreamView: RetrievedMemoryContext;
  retrievalPolicy: AbRetrievalPolicySnapshot;
  runtimeConfig: AbRuntimeConfigSnapshot;
  captureStatus: AbCaptureStatus;
  controlStatus: AbRunStatus;
  treatmentStatus: AbRunStatus;
  evalStatus: AbRunStatus;
  captureError?: AbFailureDetail | null;
  createdAt: string;
  updatedAt: string;
}

export interface AbArmRun {
  id: string;
  snapshotId: string;
  arm: AbArm;
  projectOrNamespace: string;
  runnerName: string;
  modelName: string;
  inputSummary: AbArmRunInputSummary;
  outputArtifact: AbArmOutputArtifact;
  memoryContext: RetrievedMemoryContext;
  failure?: AbFailureDetail | null;
  startedAt: string;
  completedAt?: string | null;
  status: AbRunStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface AbArmRunInputSummary {
  sceneTokenEstimate?: number | null;
  memoryTokenEstimate?: number | null;
  promptVersion?: string | null;
  modelRequestId?: string | null;
  inputHash?: string | null;
  metadata?: JsonObject;
}

export interface AbArmOutputArtifact {
  initialImpulse?: InitialImpulse | null;
  retrievedMemoryContext?: RetrievedMemoryContext | null;
  memoryTensionSummary?: MemoryTensionSummary | null;
  finalCandidateAction?: CandidateAction | null;
  modelUsage?: JsonObject;
  rawOutput?: JsonValue;
  metadata?: JsonObject;
}

export interface AbMemoryStreamItem {
  id: string;
  namespace: string;
  arm: AbArm;
  type: AbMemoryItemType;
  subtype?: string | null;
  content: string;
  retrievalText?: string | null;
  embeddingText?: string | null;
  importance: number;
  confidence: number;
  status: AbMemoryItemStatus;
  sourceEventRefs: AbSourceEventRef[];
  provenance: JsonObject;
  ttlExpiresAt?: string | null;
  fulfilledAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RetrievedMemoryContext {
  namespace: string;
  observations: RetrievedMemoryItem[];
  reflections: RetrievedMemoryItem[];
  plans: RetrievedMemoryItem[];
  selfState?: RetrievedMemoryItem[];
  budget: RetrievedMemoryBudgetUsage;
  query?: AbMemoryQuery;
}

export interface RetrievedMemoryItem {
  id: string;
  type: AbMemoryItemType;
  subtype?: string | null;
  content: string;
  score: number;
  relevanceScore?: number | null;
  recencyScore?: number | null;
  importanceScore?: number | null;
  confidence?: number | null;
  sourceEventRefs?: AbSourceEventRef[];
  createdAt?: string | null;
  updatedAt?: string | null;
  metadata?: JsonObject;
}

export interface RetrievedMemoryBudgetUsage {
  observationsTokens: number;
  reflectionsTokens: number;
  plansTokens: number;
  selfStateTokens?: number;
  totalTokens: number;
  truncated: boolean;
  truncationReason?: string | null;
}

export interface AbMemoryQuery {
  text: string;
  sessionKey?: string | null;
  peerId?: string | null;
  senderId?: string | null;
  types?: AbMemoryItemType[];
  limit?: number;
  metadata?: JsonObject;
}

export interface InitialImpulse {
  summary: string;
  likelyAction: CandidateActionKind | 'unknown';
  reasons: string[];
  uncertainty: number;
  shouldRecall: boolean;
  rawModelOutput?: JsonValue;
  metadata?: JsonObject;
}

export interface MemoryTensionSummary {
  summary: string;
  supportsSpeaking: string[];
  supportsSilence: string[];
  continuityRisks: string[];
  conflicts: string[];
  recommendedPosture?: string | null;
  confidence: number;
  metadata?: JsonObject;
}

export type CandidateAction =
  | StaySilentCandidateAction
  | SpeakInGroupCandidateAction
  | PrivateReplyCandidateAction
  | WebSearchCandidateAction
  | ImageTaskCandidateAction;

export type CandidateActionKind =
  | 'silent_candidate'
  | 'speak_in_group_candidate'
  | 'private_reply_candidate'
  | 'web_search_candidate'
  | 'image_task_candidate';

export interface CandidateActionBase {
  kind: CandidateActionKind;
  rationale: string;
  confidence: number;
  memoryItemIds?: string[];
  metadata?: JsonObject;
}

export interface StaySilentCandidateAction extends CandidateActionBase {
  kind: 'silent_candidate';
  silenceReason: string;
}

export interface SpeakInGroupCandidateAction extends CandidateActionBase {
  kind: 'speak_in_group_candidate';
  text: string;
  targetGroupId?: string | null;
}

export interface PrivateReplyCandidateAction extends CandidateActionBase {
  kind: 'private_reply_candidate';
  text: string;
  targetUserId: string;
}

export interface WebSearchCandidateAction extends CandidateActionBase {
  kind: 'web_search_candidate';
  query: string;
  intendedUse: string;
}

export interface ImageTaskCandidateAction extends CandidateActionBase {
  kind: 'image_task_candidate';
  prompt: string;
  intendedUse: string;
}

export interface AbEvalDimensionScore {
  score: number;
  rationale?: string | null;
}

export interface AbEvalDimensions {
  contextuality: AbEvalDimensionScore;
  continuity: AbEvalDimensionScore;
  socialNaturalness: AbEvalDimensionScore;
  actionFit: AbEvalDimensionScore;
  memoryUse: AbEvalDimensionScore;
  isolationIntegrity: AbEvalDimensionScore;
}

export interface AbIsolationCheck {
  passed: boolean;
  productionSideEffects: string[];
  forbiddenSymbolsObserved: string[];
  notes?: string | null;
  metadata?: JsonObject;
}

export interface AbEvalResult {
  id: string;
  snapshotId: string;
  controlArmRunId?: string | null;
  treatmentArmRunId?: string | null;
  label: AbEvalLabel;
  dimensions: AbEvalDimensions;
  reviewerNotes?: string | null;
  isolationCheck: AbIsolationCheck;
  fixtureId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AbFailureDetail {
  code: string;
  message: string;
  retryable?: boolean;
  stack?: string | null;
  cause?: JsonValue;
  occurredAt?: string;
}

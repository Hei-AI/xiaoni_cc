export type AbTraceArm = 'control' | 'treatment';
export type AbTraceStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type AbTraceEvalLabel = 'mini_better' | 'control_better' | 'tie' | 'both_bad' | 'unclear';
export type AbTraceMemoryItemType = 'observation' | 'reflection' | 'plan';

export interface AbTraceSceneSummaryDto {
  chatType?: string | null;
  peerId?: string | null;
  senderId?: string | null;
  unreadMessageCount: number;
  recentContextCount: number;
  summary?: string | null;
}

export interface AbTraceActionSummaryDto {
  kind?: string | null;
  textPreview?: string | null;
  confidence?: number | null;
  rationalePreview?: string | null;
}

export interface AbTraceArmSummaryDto {
  arm: AbTraceArm;
  status: AbTraceStatus;
  armRunId?: string | null;
  modelName?: string | null;
  runnerName?: string | null;
  finalAction?: AbTraceActionSummaryDto | null;
  failureCode?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface AbTraceDimensionSummaryDto {
  contextuality?: number | null;
  continuity?: number | null;
  socialNaturalness?: number | null;
  actionFit?: number | null;
  memoryUse?: number | null;
  isolationIntegrity?: number | null;
}

export interface AbTraceIsolationSummaryDto {
  passed?: boolean | null;
  productionSideEffectCount: number;
  forbiddenSymbolCount: number;
}

export interface AbTracePayloadSizeMarkersDto {
  sceneBytes?: number;
  retrievedMemoryBytes?: number;
  initialImpulseBytes?: number;
  memoryTensionBytes?: number;
  finalCandidateBytes?: number;
  evalBytes?: number;
}

export interface AbTraceSummaryDto {
  snapshotId: string;
  traceId?: string | null;
  runId?: string | null;
  createdAt: string;
  updatedAt: string;
  captureStatus: AbTraceStatus | 'created' | 'partial';
  controlStatus: AbTraceStatus;
  treatmentStatus: AbTraceStatus;
  evalStatus: AbTraceStatus;
  scene: AbTraceSceneSummaryDto;
  controlArm?: AbTraceArmSummaryDto | null;
  treatmentArm?: AbTraceArmSummaryDto | null;
  evalLabel?: AbTraceEvalLabel | null;
  evalDimensions?: AbTraceDimensionSummaryDto | null;
  isolationCheck?: AbTraceIsolationSummaryDto | null;
  payloadSizeMarkers: AbTracePayloadSizeMarkersDto;
  hasDetail: boolean;
}

export interface AbTraceSourceRefDto {
  kind: string;
  id: string;
  table?: string | null;
  traceId?: string | null;
  runId?: string | null;
  createdAt?: string | null;
}

export interface AbTraceSceneMessageDto {
  id?: string | number | null;
  role: 'user' | 'assistant' | 'system' | 'event' | string;
  content: string;
  senderId?: string | null;
  senderName?: string | null;
  timestamp?: string | null;
  sourceRefs?: AbTraceSourceRefDto[];
  metadata?: Record<string, unknown>;
}

export interface AbTraceSceneDetailDto {
  unreadMessages: AbTraceSceneMessageDto[];
  recentContext: AbTraceSceneMessageDto[];
  readCutoff?: {
    messageId?: string | number | null;
    timestamp?: string | null;
  } | null;
  summary?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AbTraceMemoryItemDto {
  id: string;
  type: AbTraceMemoryItemType;
  subtype?: string | null;
  content: string;
  score?: number | null;
  relevanceScore?: number | null;
  recencyScore?: number | null;
  importanceScore?: number | null;
  confidence?: number | null;
  sourceRefs?: AbTraceSourceRefDto[];
  createdAt?: string | null;
  updatedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AbTraceRetrievedMemoryDto {
  namespace: string;
  observations: AbTraceMemoryItemDto[];
  reflections: AbTraceMemoryItemDto[];
  plans: AbTraceMemoryItemDto[];
  selfState?: AbTraceMemoryItemDto[];
  budget?: Record<string, unknown>;
}

export interface AbTraceInitialImpulseDto {
  summary: string;
  likelyAction?: string | null;
  reasons: string[];
  uncertainty?: number | null;
  shouldRecall?: boolean | null;
  rawModelOutput?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AbTraceMemoryTensionSummaryDto {
  summary: string;
  supportsSpeaking: string[];
  supportsSilence: string[];
  continuityRisks: string[];
  conflicts: string[];
  recommendedPosture?: string | null;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
}

export interface AbTraceCandidateActionDto {
  kind: string;
  rationale?: string | null;
  confidence?: number | null;
  text?: string | null;
  targetGroupId?: string | null;
  targetUserId?: string | null;
  query?: string | null;
  prompt?: string | null;
  intendedUse?: string | null;
  silenceReason?: string | null;
  memoryItemIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface AbTraceFailureDto {
  code: string;
  message: string;
  retryable?: boolean;
  stack?: string | null;
  cause?: unknown;
  occurredAt?: string | null;
}

export interface AbTraceEvalDetailDto {
  label: AbTraceEvalLabel;
  dimensions: {
    contextuality?: Record<string, unknown>;
    continuity?: Record<string, unknown>;
    socialNaturalness?: Record<string, unknown>;
    actionFit?: Record<string, unknown>;
    memoryUse?: Record<string, unknown>;
    isolationIntegrity?: Record<string, unknown>;
  };
  reviewerNotes?: string | null;
  isolationCheck?: {
    passed: boolean;
    productionSideEffects: string[];
    forbiddenSymbolsObserved: string[];
    notes?: string | null;
    metadata?: Record<string, unknown>;
  } | null;
  fixtureId?: string | null;
}

export interface AbTraceDetailDto {
  summary: AbTraceSummaryDto;
  providerEventIds: Array<string | number>;
  queueMessageIds: Array<string | number>;
  scene: AbTraceSceneDetailDto;
  retrievedMemory: AbTraceRetrievedMemoryDto;
  initialImpulse?: AbTraceInitialImpulseDto | null;
  memoryTensionSummary?: AbTraceMemoryTensionSummaryDto | null;
  finalCandidateAction?: AbTraceCandidateActionDto | null;
  failure?: AbTraceFailureDto | null;
  eval?: AbTraceEvalDetailDto | null;
}

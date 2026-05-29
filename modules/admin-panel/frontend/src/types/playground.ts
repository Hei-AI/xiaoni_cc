export type PlaygroundSourceType = 'traffic' | 'conversation' | 'span';
export type PlaygroundCaseMode = 'contextual' | 'wire';
export type PlaygroundPromptMode = 'saved' | 'draft';
export type PlaygroundExecutionMode = 'exact_replay' | 'patched_replay';
export type PlaygroundImportFidelity = 'exact' | 'partial' | 'unsupported';
export type PlaygroundImportSourceType = 'span' | 'traffic' | 'conversation' | 'none';
export type PlaygroundImportReasonCode =
  | 'exact_span_available'
  | 'traffic_fallback_available'
  | 'conversation_fallback_available'
  | 'missing_canonical_request'
  | 'missing_effective_config'
  | 'no_viable_source';

export interface PlaygroundMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PlaygroundPromptInput {
  systemInstruction: string;
  messages: PlaygroundMessage[];
  contextVariables: Record<string, unknown>;
}

export type PlaygroundProviderId =
  | 'google'
  | 'google-gemini-cli'
  | 'google-legacy'
  | 'openai'
  | 'codex'
  | 'codex-local'
  | 'custom';

export interface PlaygroundProviderConfig {
  id?: string;
  name?: string;
  description?: string;
  category?: string;
  model: {
    name?: string | null;
    provider: PlaygroundProviderId;
    allowedTokenIds?: number[];
    providerSpecific?: Record<string, unknown>;
    fallbackModels?: string[];
  };
  generation: Record<string, unknown>;
  thinking?: Record<string, unknown>;
  safety: Array<Record<string, unknown>>;
  tools: Record<string, unknown>;
  context: Record<string, unknown>;
  performance?: Record<string, unknown>;
  version?: Record<string, unknown>;
}

export interface PlaygroundBaselineSnapshot {
  traceId?: string | null;
  conversationId?: string | null;
  llmCallId?: string | null;
  spanId?: string | null;
  agentTurn?: number | null;
  provider?: string | null;
  modelName?: string | null;
  canonicalRequest: Record<string, unknown> | null;
  canonicalResponse?: unknown;
  wireRequest?: unknown;
  wireResponse?: unknown;
  requestFormatVersion?: string | null;
  wireProviderFormat?: string | null;
  effectiveUnifiedConfig?: Record<string, unknown> | null;
}

export interface PlaygroundRequestPatch {
  instructions?: string;
  input?: unknown[];
  tools?: unknown;
  tool_choice?: unknown;
  max_output_tokens?: number | null;
  temperature?: number | null;
  top_p?: number | null;
  stop?: unknown;
  provider?: PlaygroundProviderId;
  modelName?: string | null;
  providerSpecific?: Record<string, unknown>;
}

export interface PlaygroundBaselineOutput {
  sourceKind: 'conversation' | 'llm_call' | 'traffic' | 'manual';
  responseText: string;
  thinking?: string;
  provider?: string;
  modelName?: string;
  usage?: Record<string, unknown>;
  canonicalRequest?: unknown;
  canonicalResponse?: unknown;
  wireRequest?: unknown;
  wireResponse?: unknown;
  rawResponse?: unknown;
  metadata?: Record<string, unknown>;
}

export interface PlaygroundTraceContext {
  traceId?: string | null;
  conversationId?: string | null;
  llmCallId?: string | null;
  toolCallId?: string | null;
  agentTurn?: number | null;
  trafficLogId?: number | null;
  spanId?: string | null;
}

export interface PlaygroundCase {
  id: string;
  name: string;
  source: PlaygroundSourceType;
  sourceRef: string;
  caseMode: PlaygroundCaseMode;
  traceContext: PlaygroundTraceContext;
  promptId?: string | null;
  promptModeDefault: PlaygroundPromptMode;
  promptInput: PlaygroundPromptInput;
  providerConfig: PlaygroundProviderConfig;
  baselineSnapshot?: PlaygroundBaselineSnapshot | null;
  currentPatch?: PlaygroundRequestPatch | null;
  importFidelity?: PlaygroundImportFidelity;
  baselineOutput?: PlaygroundBaselineOutput | null;
  rawEvidence: Record<string, unknown>;
  tags: string[];
  notes?: string | null;
  isFavorite: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlaygroundRun {
  id: string;
  caseId: string;
  executionMode?: PlaygroundExecutionMode;
  promptMode: PlaygroundPromptMode;
  promptId?: string | null;
  promptSnapshot?: Record<string, unknown> | null;
  providerConfigSnapshot: PlaygroundProviderConfig;
  inputSnapshot: PlaygroundPromptInput;
  baselineSnapshot?: PlaygroundBaselineSnapshot | null;
  requestPatch?: PlaygroundRequestPatch | null;
  effectiveRequest?: Record<string, unknown> | null;
  effectiveConfig?: Record<string, unknown> | null;
  outputSnapshot?: {
    responseText?: string;
    thinking?: string;
    usage?: Record<string, unknown>;
    performance?: Record<string, unknown>;
    provider?: string;
    modelName?: string;
    canonicalRequest?: unknown;
    wireRequest?: unknown;
    canonicalResponse?: unknown;
    wireResponse?: unknown;
    rawResponse?: unknown;
    metadata?: Record<string, unknown>;
    error?: string;
  } | null;
  comparisonSnapshot?: {
    hasBaseline?: boolean;
    match?: boolean;
    similarity?: number;
    diffCount?: number;
    baselineText?: string;
    currentText?: string;
    previousRunText?: string;
  } | null;
  diffSnapshot?: Record<string, unknown> | null;
  modelName?: string | null;
  provider?: string | null;
  status: 'completed' | 'failed';
  executedBy: string;
  createdAt: string;
}

export interface PlaygroundLibraryPayload {
  trafficSamples: Array<{
    id: number;
    trace_id?: string;
    conversation_id?: string;
    method: string;
    host: string;
    path: string;
    url: string;
    api_type?: string;
    service_name?: string;
    response_status?: number;
    duration_ms?: number;
    request_timestamp?: string;
  }>;
  savedCases: PlaygroundCase[];
  recentRuns: PlaygroundRun[];
}

export interface PlaygroundImportResolution {
  importable: boolean;
  sourceType: PlaygroundImportSourceType;
  reasonCode: PlaygroundImportReasonCode;
  reasonMessage: string;
  traceId?: string | null;
  conversationId?: string | null;
  spanId?: string | null;
  trafficId?: number | null;
}

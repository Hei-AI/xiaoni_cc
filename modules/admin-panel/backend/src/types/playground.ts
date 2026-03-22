export type PlaygroundSourceType = 'traffic' | 'conversation' | 'span';

export type PlaygroundCaseMode = 'contextual' | 'wire';

export type PlaygroundPromptMode = 'saved' | 'draft';

export type PlaygroundRunStatus = 'completed' | 'failed';

export type PlaygroundExecutionMode = 'exact_replay' | 'patched_replay';

export type PlaygroundImportFidelity = 'exact' | 'partial' | 'unsupported';

export interface PlaygroundMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PlaygroundPromptInput {
  systemInstruction: string;
  messages: PlaygroundMessage[];
  contextVariables: Record<string, unknown>;
}

export interface PlaygroundProviderConfig {
  provider: 'google-gemini-cli' | 'google-legacy' | 'openai' | 'codex';
  generation: Record<string, unknown>;
  thinking?: Record<string, unknown>;
  safety?: Array<Record<string, unknown>>;
  tools?: Record<string, unknown>;
  context?: Record<string, unknown>;
  providerSpecific?: Record<string, unknown>;
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
  provider?: PlaygroundProviderConfig['provider'];
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

export interface PlaygroundComparison {
  hasBaseline: boolean;
  match: boolean;
  similarity: number;
  diffCount: number;
  baselineText?: string;
  currentText?: string;
  previousRunText?: string;
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
  outputSnapshot?: Record<string, unknown> | null;
  comparisonSnapshot?: Record<string, unknown> | null;
  diffSnapshot?: Record<string, unknown> | null;
  modelName?: string | null;
  provider?: string | null;
  status: PlaygroundRunStatus;
  executedBy: string;
  createdAt: string;
}

export interface PlaygroundLibraryPayload {
  trafficSamples: Array<Record<string, unknown>>;
  savedCases: PlaygroundCase[];
  recentRuns: PlaygroundRun[];
}

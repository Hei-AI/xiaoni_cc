export type PlaygroundSourceType = 'traffic' | 'conversation';
export type PlaygroundCaseMode = 'contextual' | 'wire';
export type PlaygroundPromptMode = 'saved' | 'draft';

export interface PlaygroundMessage {
  role: 'user' | 'assistant';
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
  promptMode: PlaygroundPromptMode;
  promptId?: string | null;
  promptSnapshot?: Record<string, unknown> | null;
  providerConfigSnapshot: PlaygroundProviderConfig;
  inputSnapshot: PlaygroundPromptInput;
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

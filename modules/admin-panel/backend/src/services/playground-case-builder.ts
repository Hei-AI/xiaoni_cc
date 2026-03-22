import crypto from 'crypto';
import winston from 'winston';
import { DatabaseManager } from './database';
import {
  PlaygroundBaselineOutput,
  PlaygroundBaselineSnapshot,
  PlaygroundCase,
  PlaygroundCaseMode,
  PlaygroundExecutionMode,
  PlaygroundImportFidelity,
  PlaygroundLibraryPayload,
  PlaygroundMessage,
  PlaygroundPromptInput,
  PlaygroundProviderConfig,
  PlaygroundPromptMode,
  PlaygroundRequestPatch,
  PlaygroundRun
} from '../types/playground';

type PromptRecord = {
  id: string;
  prompt_name: string;
  system_instructions: unknown;
  user_prompt_template?: string | null;
  context_variables?: unknown;
  model_config?: unknown;
  advanced_config?: unknown;
  model_name?: string | null;
};

type TrafficLogRow = {
  id: number;
  trace_id?: string | null;
  conversation_id?: string | null;
  llm_call_id?: string | null;
  tool_call_id?: string | null;
  agent_turn?: number | null;
  method: string;
  url: string;
  host: string;
  path: string;
  request_headers?: unknown;
  request_body?: string | null;
  response_body?: string | null;
  response_status?: number | null;
  request_timestamp?: string | null;
  duration_ms?: number | null;
  api_type?: string | null;
  service_name?: string | null;
};

type ConversationRow = {
  id: string;
  trace_id?: string | null;
  user_message?: string | null;
  ai_response?: string | null;
  raw_request?: unknown;
  timestamp?: string | null;
  response_time?: number | null;
  model_name?: string | null;
  status?: string | null;
};

type LLMCallRow = {
  id?: number;
  trace_id?: string | null;
  conversation_id?: string | null;
  llm_call_id?: string | null;
  agent_turn?: number | null;
  model_provider?: string | null;
  model_name?: string | null;
  prompt_template?: string | null;
  canonical_request?: unknown;
  canonical_response?: unknown;
  wire_request?: unknown;
  wire_response?: unknown;
  effective_unified_config?: unknown;
  request_format_version?: string | null;
  wire_provider_format?: string | null;
  processed_response?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  api_call_time_ms?: number | null;
  processing_time_ms?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
  status?: string | null;
};

type PlaygroundCaseRow = {
  id: string;
  name: string;
  source: 'traffic' | 'conversation' | 'span';
  source_ref: string;
  case_mode: 'contextual' | 'wire';
  trace_context: unknown;
  prompt_id?: string | null;
  prompt_mode_default: PlaygroundPromptMode;
  prompt_input: unknown;
  provider_config: unknown;
  baseline_snapshot?: unknown;
  current_patch?: unknown;
  import_fidelity?: PlaygroundImportFidelity | null;
  baseline_output?: unknown;
  raw_evidence: unknown;
  tags?: unknown;
  notes?: string | null;
  is_favorite: number | boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type PlaygroundRunRow = {
  id: string;
  case_id: string;
  execution_mode?: PlaygroundExecutionMode;
  prompt_mode: PlaygroundPromptMode;
  prompt_id?: string | null;
  prompt_snapshot?: unknown;
  provider_config_snapshot: unknown;
  input_snapshot: unknown;
  baseline_snapshot?: unknown;
  request_patch?: unknown;
  effective_request?: unknown;
  effective_config?: unknown;
  output_snapshot?: unknown;
  comparison_snapshot?: unknown;
  diff_snapshot?: unknown;
  model_name?: string | null;
  provider?: string | null;
  status: 'completed' | 'failed';
  executed_by: string;
  created_at: string;
};

type PlaygroundLibraryTrafficRow = {
  id: number;
  trace_id?: string | null;
  conversation_id?: string | null;
  method: string;
  host: string;
  path: string;
  url: string;
  api_type?: string | null;
  service_name?: string | null;
  response_status?: number | null;
  duration_ms?: number | null;
  request_timestamp?: string | null;
};

export class PlaygroundCompatibilityError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'PlaygroundCompatibilityError';
    this.statusCode = statusCode;
  }
}

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  if (typeof value === 'object') {
    return value as T;
  }

  return fallback;
}

function stringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function normalizeProvider(value?: string | null): PlaygroundProviderConfig['provider'] {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'openai') return 'openai';
  if (normalized === 'codex' || normalized === 'openai-codex') return 'codex';
  if (normalized === 'google-legacy' || normalized === 'gemini-api') return 'google-legacy';
  return 'google-gemini-cli';
}

function defaultModelForProvider(provider: PlaygroundProviderConfig['provider']): string {
  switch (provider) {
    case 'openai':
      return 'gpt-5-mini';
    case 'codex':
      return 'gpt-5.2-codex';
    case 'google-legacy':
      return 'gemini-2.5-flash';
    case 'google-gemini-cli':
    default:
      return 'gemini-2.5-flash';
  }
}

function normalizePromptMessages(messages: PlaygroundMessage[]): PlaygroundMessage[] {
  return messages
    .map((message): PlaygroundMessage => ({
      role: message.role === 'assistant'
        ? 'assistant'
        : message.role === 'system'
          ? 'system'
          : 'user',
      content: typeof message.content === 'string' ? message.content : ''
    }))
    .filter((message) => message.content.trim().length > 0);
}

function parseSystemInstructions(value: unknown): string {
  const parsed = parseJsonField<unknown>(value, value);
  if (Array.isArray(parsed)) {
    return parsed
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean)
      .join('\n');
  }
  return typeof parsed === 'string' ? parsed : '';
}

function applyContextVariables(
  template: string,
  contextVariables: Record<string, unknown> = {},
  runtimeVariables: Record<string, unknown> = {}
): string {
  if (!template) {
    return '';
  }

  const variables = {
    ...contextVariables,
    ...runtimeVariables
  };

  return template
    .replace(/\{\{(\w+)\}\}/g, (match, key) => {
      if (!(key in variables)) {
        return match;
      }
      const value = variables[key];
      return typeof value === 'string' ? value : stringify(value);
    })
    .replace(/\$\{(\w+)\}/g, (match, key) => {
      if (!(key in variables)) {
        return match;
      }
      const value = variables[key];
      return typeof value === 'string' ? value : stringify(value);
    });
}

function normalizeOpenResponseMessageRole(role?: string): PlaygroundMessage['role'] | null {
  if (role === 'assistant') return 'assistant';
  if (role === 'system' || role === 'developer') return 'system';
  if (role === 'user') return 'user';
  return null;
}

function extractTextFromOpenResponseMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    throw new PlaygroundCompatibilityError('Unsupported OpenResponse message content shape for Playground import');
  }

  const textParts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') {
      throw new PlaygroundCompatibilityError('Unsupported OpenResponse message content item for Playground import');
    }

    if ((part as { type?: string }).type !== 'input_text') {
      throw new PlaygroundCompatibilityError('Only text OpenResponse message parts can be imported into Playground');
    }

    textParts.push(String((part as { text?: unknown }).text || ''));
  }

  return textParts.join('\n');
}

function extractMessagesFromOpenResponseInput(input: unknown): PlaygroundMessage[] {
  const items = Array.isArray(input) ? input : [];
  const messages: PlaygroundMessage[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object' || (item as { type?: string }).type !== 'message') {
      throw new PlaygroundCompatibilityError(`Unsupported OpenResponse input item for Playground import: ${(item as { type?: string }).type || 'unknown'}`);
    }

    const role = normalizeOpenResponseMessageRole((item as { role?: string }).role);
    if (!role) {
      throw new PlaygroundCompatibilityError(`Unsupported OpenResponse message role for Playground import: ${String((item as { role?: unknown }).role || 'unknown')}`);
    }

    const text = extractTextFromOpenResponseMessageContent((item as { content?: unknown }).content);
    if (text.trim()) {
      messages.push({ role, content: text });
    }
  }

  return normalizePromptMessages(messages);
}

function extractMessagesFromGeminiContents(contents: unknown): PlaygroundMessage[] {
  if (!Array.isArray(contents)) {
    return [];
  }

  return normalizePromptMessages(
    contents.map((content) => {
      const rawRole = (content as { role?: string }).role;
      const role = rawRole === 'model'
        ? 'assistant'
        : rawRole === 'system' || rawRole === 'developer'
          ? 'system'
          : 'user';
      const parts = Array.isArray((content as { parts?: unknown[] }).parts)
        ? ((content as { parts?: Array<{ text?: unknown }> }).parts || [])
        : [];
      const text = parts
        .map((part) => (typeof part.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join('\n');
      return { role, content: text };
    })
  );
}

function extractTextResponse(value: unknown): string {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return extractTextResponse(parsed);
    } catch {
      return value;
    }
  }

  if (typeof value !== 'object') {
    return '';
  }

  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string' && record.text.trim()) {
    return record.text;
  }
  if (typeof record.output_text === 'string' && record.output_text.trim()) {
    return record.output_text;
  }
  if (typeof record.processed_response === 'string' && record.processed_response.trim()) {
    return record.processed_response;
  }

  const parts = (((record.candidates as Array<Record<string, unknown>> | undefined)?.[0]?.content as Record<string, unknown> | undefined)?.parts as Array<Record<string, unknown>> | undefined) || [];
  const text = parts
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n');

  return text;
}

function providerFromApiType(apiType?: string | null): PlaygroundProviderConfig['provider'] {
  const normalized = (apiType || '').trim().toLowerCase();
  if (normalized === 'openai') return 'openai';
  if (normalized === 'codex') return 'codex';
  if (normalized === 'google-legacy') return 'google-legacy';
  return 'google-gemini-cli';
}

function buildProviderConfigFromPrompt(prompt?: PromptRecord | null): PlaygroundProviderConfig {
  const modelConfig = parseJsonField<Record<string, unknown>>(prompt?.model_config, {});
  const advancedConfig = parseJsonField<Record<string, unknown>>(prompt?.advanced_config, {});
  const provider = normalizeProvider(
    typeof modelConfig.provider === 'string'
      ? modelConfig.provider
      : typeof (advancedConfig.provider) === 'string'
        ? (advancedConfig.provider as string)
        : typeof (advancedConfig.model as Record<string, unknown> | undefined)?.provider === 'string'
          ? ((advancedConfig.model as Record<string, unknown>).provider as string)
          : null
  );

  const providerSpecific = {
    ...(parseJsonField<Record<string, unknown>>(modelConfig.providerSpecific, {})),
    ...(parseJsonField<Record<string, unknown>>((advancedConfig.model as Record<string, unknown> | undefined)?.providerSpecific, {}))
  };

  return {
    provider,
    generation: parseJsonField<Record<string, unknown>>((advancedConfig.generationConfig), {
      temperature: modelConfig.temperature ?? 0.7,
      topP: modelConfig.topP ?? 0.95,
      topK: modelConfig.topK ?? 40,
      maxOutputTokens: modelConfig.maxOutputTokens ?? 2048
    }),
    thinking: parseJsonField<Record<string, unknown>>(advancedConfig.thinkingConfig, {}),
    safety: parseJsonField<Array<Record<string, unknown>>>(advancedConfig.safetySettings, []),
    tools: parseJsonField<Record<string, unknown>>(advancedConfig.toolsConfig, {}),
    context: {
      promptId: prompt?.id || null,
      promptName: prompt?.prompt_name || null,
      modelName: prompt?.model_name || defaultModelForProvider(provider)
    },
    providerSpecific: Object.keys(providerSpecific).length > 0 ? providerSpecific : {}
  };
}

function buildProviderConfigFromTraffic(log: TrafficLogRow, llmCall?: LLMCallRow | null): PlaygroundProviderConfig {
  const requestBody = parseJsonField<Record<string, unknown>>(log.request_body, {});
  const canonicalRequest = parseJsonField<Record<string, unknown>>(llmCall?.canonical_request, {});
  const generation = parseJsonField<Record<string, unknown>>(
    (canonicalRequest.generationConfig as Record<string, unknown> | undefined) || requestBody.generationConfig,
    {}
  );
  const thinking = parseJsonField<Record<string, unknown>>(
    ((generation as Record<string, unknown>).thinkingConfig as Record<string, unknown> | undefined),
    {}
  );

  const provider = llmCall?.model_provider
    ? normalizeProvider(llmCall.model_provider)
    : providerFromApiType(log.api_type);

  return {
    provider,
    generation,
    thinking,
    safety: parseJsonField<Array<Record<string, unknown>>>(
      requestBody.safetySettings || canonicalRequest.safetySettings,
      []
    ),
    tools: parseJsonField<Record<string, unknown>>(
      requestBody.toolConfig || canonicalRequest.toolConfig || {},
      {}
    ),
    context: {
      modelName: llmCall?.model_name || defaultModelForProvider(provider),
      promptTemplate: llmCall?.prompt_template || null
    },
    providerSpecific: {}
  };
}

function buildPromptInputFromCanonicalRequest(canonicalRequest: Record<string, unknown>): PlaygroundPromptInput {
  const systemInstruction = typeof canonicalRequest.instructions === 'string' ? canonicalRequest.instructions : '';
  const normalizedSystemInstruction = systemInstruction.trim();
  const messages = extractMessagesFromOpenResponseInput(canonicalRequest.input).filter((message) => {
    if (message.role !== 'system' || !normalizedSystemInstruction) {
      return true;
    }

    return message.content.trim() !== normalizedSystemInstruction;
  });

  return {
    systemInstruction,
    messages,
    contextVariables: {}
  };
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null || left === undefined || right === undefined) {
    return left === right;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    return left.every((item, index) => deepEqual(item, right[index]));
  }

  if (typeof left === 'object' && typeof right === 'object') {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();

    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(leftRecord[key], rightRecord[key]));
  }

  return false;
}

function mapUnifiedProvider(value?: string | null): PlaygroundProviderConfig['provider'] {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'openai') return 'openai';
  if (normalized === 'codex' || normalized === 'openai-codex') return 'codex';
  if (normalized === 'google-legacy' || normalized === 'google') return 'google-legacy';
  return 'google-gemini-cli';
}

function buildOpenResponseInput(messages: PlaygroundMessage[]): Array<Record<string, unknown>> {
  return normalizePromptMessages(messages).map((message) => ({
    type: 'message',
    role: message.role === 'system' ? 'developer' : message.role,
    content: [
      {
        type: 'input_text',
        text: message.content
      }
    ]
  }));
}

function buildBaselineSnapshot(
  llmCall: LLMCallRow,
  traceId?: string | null,
  spanId?: string | null
): PlaygroundBaselineSnapshot {
  return {
    traceId: llmCall.trace_id || traceId || null,
    conversationId: llmCall.conversation_id || null,
    llmCallId: llmCall.llm_call_id || null,
    spanId: spanId || null,
    agentTurn: llmCall.agent_turn ?? null,
    provider: llmCall.model_provider || null,
    modelName: llmCall.model_name || null,
    canonicalRequest: parseJsonField<Record<string, unknown> | null>(llmCall.canonical_request, null),
    canonicalResponse: parseJsonField(llmCall.canonical_response, null),
    wireRequest: parseJsonField(llmCall.wire_request, null),
    wireResponse: parseJsonField(llmCall.wire_response, null),
    requestFormatVersion: typeof llmCall.request_format_version === 'string' ? llmCall.request_format_version : null,
    wireProviderFormat: typeof llmCall.wire_provider_format === 'string' ? llmCall.wire_provider_format : null,
    effectiveUnifiedConfig: parseJsonField<Record<string, unknown> | null>(llmCall.effective_unified_config, null)
  };
}

function buildProviderConfigFromBaselineSnapshot(
  snapshot: PlaygroundBaselineSnapshot,
  fallbackProvider?: string | null
): PlaygroundProviderConfig {
  const canonicalRequest = snapshot.canonicalRequest || {};
  const unifiedConfig = parseJsonField<Record<string, unknown> | null>(snapshot.effectiveUnifiedConfig, null) || {};
  const modelConfig = parseJsonField<Record<string, unknown>>((unifiedConfig as any).model, {});
  const generationConfig = parseJsonField<Record<string, unknown>>((unifiedConfig as any).generation, {});
  const thinkingConfig = parseJsonField<Record<string, unknown>>((unifiedConfig as any).thinking, {});
  const safetyConfig = parseJsonField<Array<Record<string, unknown>>>((unifiedConfig as any).safety, []);
  const providerSpecific = parseJsonField<Record<string, unknown>>(modelConfig.providerSpecific, {});
  const canonicalGeneration = {
    temperature: canonicalRequest.temperature,
    topP: canonicalRequest.top_p,
    maxOutputTokens: canonicalRequest.max_output_tokens,
    stop: canonicalRequest.stop
  };

  return {
    provider: mapUnifiedProvider(
      typeof modelConfig.provider === 'string' ? modelConfig.provider : (snapshot.provider || fallbackProvider || null)
    ),
    generation: {
      ...generationConfig,
      ...Object.fromEntries(Object.entries(canonicalGeneration).filter(([, value]) => value !== undefined))
    },
    thinking: thinkingConfig,
    safety: safetyConfig,
    tools: {
      definitions: Array.isArray(canonicalRequest.tools) ? canonicalRequest.tools : [],
      toolChoice: canonicalRequest.tool_choice ?? null
    },
    context: {
      modelName: snapshot.modelName || (typeof modelConfig.name === 'string' ? modelConfig.name : null),
      promptTemplate: null
    },
    providerSpecific
  };
}

function buildRequestPatch(
  baselineSnapshot: PlaygroundBaselineSnapshot | null | undefined,
  promptInput: PlaygroundPromptInput,
  providerConfig: PlaygroundProviderConfig
): PlaygroundRequestPatch {
  if (!baselineSnapshot?.canonicalRequest) {
    return {};
  }

  const baselineRequest = baselineSnapshot.canonicalRequest;
  const baselinePromptInput = buildPromptInputFromCanonicalRequest(baselineRequest);
  const patch: PlaygroundRequestPatch = {};

  if (promptInput.systemInstruction !== baselinePromptInput.systemInstruction) {
    patch.instructions = promptInput.systemInstruction;
  }

  if (!deepEqual(promptInput.messages, baselinePromptInput.messages)) {
    patch.input = buildOpenResponseInput(promptInput.messages);
  }

  const nextTools = providerConfig.tools || {};
  const baselineTools = {
    definitions: Array.isArray(baselineRequest.tools) ? baselineRequest.tools : [],
    toolChoice: baselineRequest.tool_choice ?? null
  };
  if (!deepEqual(nextTools, baselineTools)) {
    patch.tools = (nextTools as any).definitions ?? nextTools;
    patch.tool_choice = (nextTools as any).toolChoice ?? null;
  }

  const numericFields: Array<[keyof PlaygroundRequestPatch, unknown, unknown]> = [
    ['temperature', providerConfig.generation.temperature, baselineRequest.temperature],
    ['top_p', providerConfig.generation.topP, baselineRequest.top_p],
    ['max_output_tokens', providerConfig.generation.maxOutputTokens, baselineRequest.max_output_tokens],
    ['stop', providerConfig.generation.stop, baselineRequest.stop]
  ];

  numericFields.forEach(([key, nextValue, baselineValue]) => {
    if (!deepEqual(nextValue, baselineValue) && nextValue !== undefined) {
      (patch as any)[key] = nextValue as any;
    }
  });

  const nextProvider = providerConfig.provider || undefined;
  const baselineProvider = mapUnifiedProvider(
    typeof (baselineSnapshot.effectiveUnifiedConfig as any)?.model?.provider === 'string'
      ? (baselineSnapshot.effectiveUnifiedConfig as any).model.provider
      : baselineSnapshot.provider || null
  );
  if (nextProvider && nextProvider !== baselineProvider) {
    patch.provider = nextProvider;
  }

  const nextModelName = typeof providerConfig.context?.modelName === 'string' ? providerConfig.context.modelName : null;
  const baselineModelName = baselineSnapshot.modelName || (typeof baselineRequest.model === 'string' ? baselineRequest.model : null);
  if (nextModelName && nextModelName !== baselineModelName) {
    patch.modelName = nextModelName;
  }

  if (!deepEqual(providerConfig.providerSpecific || {}, (baselineSnapshot.effectiveUnifiedConfig as any)?.model?.providerSpecific || {})) {
    patch.providerSpecific = providerConfig.providerSpecific || {};
  }

  return patch;
}

export class PlaygroundCaseBuilder {
  private llmCallTableName: 'llm_call_logs' | 'llm_calls' | null | undefined;
  private static readonly LIBRARY_TRAFFIC_LIMIT = 24;
  private static readonly LIBRARY_CASE_LIMIT = 24;
  private static readonly LIBRARY_RUN_LIMIT = 12;
  private static readonly TRAFFIC_SEARCH_BATCH_SIZE = 200;

  constructor(
    private readonly db: DatabaseManager,
    private readonly logger: winston.Logger
  ) {}

  async ensureTables(): Promise<void> {
    await this.db.executeUpdate(`
      CREATE TABLE IF NOT EXISTS playground_cases (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        source ENUM('traffic', 'conversation', 'span') NOT NULL,
        source_ref VARCHAR(255) NOT NULL,
        case_mode ENUM('contextual', 'wire') NOT NULL,
        trace_context JSON NOT NULL,
        prompt_id VARCHAR(36) NULL,
        prompt_mode_default ENUM('saved', 'draft') NOT NULL DEFAULT 'draft',
        prompt_input JSON NOT NULL,
        provider_config JSON NOT NULL,
        baseline_snapshot JSON NULL,
        current_patch JSON NULL,
        import_fidelity ENUM('exact', 'partial', 'unsupported') NOT NULL DEFAULT 'exact',
        baseline_output JSON NULL,
        raw_evidence JSON NOT NULL,
        tags JSON NULL,
        notes TEXT NULL,
        is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
        created_by VARCHAR(100) NOT NULL DEFAULT 'admin',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_source_ref (source, source_ref),
        INDEX idx_prompt_id (prompt_id),
        INDEX idx_updated_at (updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await this.db.executeUpdate(`
      CREATE TABLE IF NOT EXISTS playground_runs (
        id VARCHAR(36) PRIMARY KEY,
        case_id VARCHAR(36) NOT NULL,
        execution_mode ENUM('exact_replay', 'patched_replay') NOT NULL DEFAULT 'exact_replay',
        prompt_mode ENUM('saved', 'draft') NOT NULL,
        prompt_id VARCHAR(36) NULL,
        prompt_snapshot JSON NULL,
        provider_config_snapshot JSON NOT NULL,
        input_snapshot JSON NOT NULL,
        baseline_snapshot JSON NULL,
        request_patch JSON NULL,
        effective_request JSON NULL,
        effective_config JSON NULL,
        output_snapshot JSON NULL,
        comparison_snapshot JSON NULL,
        diff_snapshot JSON NULL,
        model_name VARCHAR(120) NULL,
        provider VARCHAR(50) NULL,
        status ENUM('completed', 'failed') NOT NULL DEFAULT 'completed',
        executed_by VARCHAR(100) NOT NULL DEFAULT 'admin',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_case_created_at (case_id, created_at),
        INDEX idx_created_at (created_at),
        CONSTRAINT fk_playground_runs_case FOREIGN KEY (case_id) REFERENCES playground_cases(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await this.ensureIndex(
      'http_traffic_logs',
      'idx_ai_request_time_id',
      'ALTER TABLE http_traffic_logs ADD INDEX idx_ai_request_time_id (is_ai_request, request_timestamp, id)'
    );
    await this.ensureIndex(
      'playground_cases',
      'idx_library_sort',
      'ALTER TABLE playground_cases ADD INDEX idx_library_sort (is_favorite, updated_at, id)'
    );
    await this.ensureIndex(
      'playground_cases',
      'idx_prompt_library_sort',
      'ALTER TABLE playground_cases ADD INDEX idx_prompt_library_sort (prompt_id, is_favorite, updated_at, id)'
    );
    await this.ensureIndex(
      'playground_cases',
      'idx_source_ref_updated_at_id',
      'ALTER TABLE playground_cases ADD INDEX idx_source_ref_updated_at_id (source, source_ref, updated_at, id)'
    );
    await this.ensureIndex(
      'playground_runs',
      'idx_created_at_id',
      'ALTER TABLE playground_runs ADD INDEX idx_created_at_id (created_at, id)'
    );
    await this.ensureColumn(
      'playground_cases',
      'baseline_snapshot',
      'ALTER TABLE playground_cases ADD COLUMN baseline_snapshot JSON NULL AFTER provider_config'
    );
    await this.ensureColumn(
      'playground_cases',
      'current_patch',
      'ALTER TABLE playground_cases ADD COLUMN current_patch JSON NULL AFTER baseline_snapshot'
    );
    await this.ensureColumn(
      'playground_cases',
      'import_fidelity',
      "ALTER TABLE playground_cases ADD COLUMN import_fidelity ENUM('exact', 'partial', 'unsupported') NOT NULL DEFAULT 'exact' AFTER current_patch"
    );
    await this.ensureColumn(
      'playground_runs',
      'execution_mode',
      "ALTER TABLE playground_runs ADD COLUMN execution_mode ENUM('exact_replay', 'patched_replay') NOT NULL DEFAULT 'exact_replay' AFTER case_id"
    );
    await this.ensureColumn(
      'playground_runs',
      'baseline_snapshot',
      'ALTER TABLE playground_runs ADD COLUMN baseline_snapshot JSON NULL AFTER input_snapshot'
    );
    await this.ensureColumn(
      'playground_runs',
      'request_patch',
      'ALTER TABLE playground_runs ADD COLUMN request_patch JSON NULL AFTER baseline_snapshot'
    );
    await this.db.executeUpdate(
      'ALTER TABLE playground_cases MODIFY COLUMN source_ref VARCHAR(255) NOT NULL'
    );
    await this.ensureColumn(
      'playground_runs',
      'effective_request',
      'ALTER TABLE playground_runs ADD COLUMN effective_request JSON NULL AFTER request_patch'
    );
    await this.ensureColumn(
      'playground_runs',
      'effective_config',
      'ALTER TABLE playground_runs ADD COLUMN effective_config JSON NULL AFTER effective_request'
    );
    await this.ensureColumn(
      'playground_runs',
      'diff_snapshot',
      'ALTER TABLE playground_runs ADD COLUMN diff_snapshot JSON NULL AFTER comparison_snapshot'
    );
    await this.db.executeUpdate(
      "ALTER TABLE playground_cases MODIFY COLUMN source ENUM('traffic', 'conversation', 'span') NOT NULL"
    );
  }

  async listLibrary(params: { search?: string; promptId?: string | null } = {}): Promise<PlaygroundLibraryPayload> {
    const searchLike = params.search ? `%${params.search}%` : null;
    const trafficSamples = await this.listTrafficSamples(params.search);

    const caseFilters: string[] = [];
    const caseParams: unknown[] = [];
    if (params.promptId) {
      caseFilters.push('prompt_id = ?');
      caseParams.push(params.promptId);
    }
    if (searchLike) {
      caseFilters.push('(name LIKE ? OR notes LIKE ?)');
      caseParams.push(searchLike, searchLike);
    }
    const caseWhere = caseFilters.length > 0 ? `WHERE ${caseFilters.join(' AND ')}` : '';
    const caseIndexHint = params.promptId ? 'FORCE INDEX (idx_prompt_library_sort)' : 'FORCE INDEX (idx_library_sort)';

    const cases = await this.db.executeQuery<PlaygroundCaseRow>(
      `
        SELECT *
        FROM playground_cases
        ${caseIndexHint}
        ${caseWhere}
        ORDER BY is_favorite DESC, updated_at DESC, id DESC
        LIMIT ${PlaygroundCaseBuilder.LIBRARY_CASE_LIMIT}
      `,
      caseParams
    );

    const runs = await this.db.executeQuery<PlaygroundRunRow>(
      `
        SELECT *
        FROM playground_runs
        FORCE INDEX (idx_created_at_id)
        ORDER BY created_at DESC, id DESC
        LIMIT ${PlaygroundCaseBuilder.LIBRARY_RUN_LIMIT}
      `
    );

    return {
      trafficSamples,
      savedCases: cases.map((row) => this.mapCaseRow(row)),
      recentRuns: runs.map((row) => this.mapRunRow(row))
    };
  }

  private async ensureIndex(tableName: string, indexName: string, ddl: string): Promise<void> {
    const rows = await this.db.executeQuery<{ total: number }>(
      `
        SELECT COUNT(*) AS total
        FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND index_name = ?
      `,
      [tableName, indexName]
    );

    if ((rows[0]?.total || 0) === 0) {
      await this.db.executeUpdate(ddl);
    }
  }

  private async ensureColumn(tableName: string, columnName: string, ddl: string): Promise<void> {
    const rows = await this.db.executeQuery<{ total: number }>(
      `
        SELECT COUNT(*) AS total
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND column_name = ?
      `,
      [tableName, columnName]
    );

    if ((rows[0]?.total || 0) === 0) {
      await this.db.executeUpdate(ddl);
    }
  }

  private async listTrafficSamples(search?: string): Promise<PlaygroundLibraryTrafficRow[]> {
    const normalizedSearch = search?.trim().toLowerCase() || null;
    const rows: PlaygroundLibraryTrafficRow[] = [];
    let cursorTimestamp: string | null = null;
    let cursorId: number | null = null;

    while (rows.length < PlaygroundCaseBuilder.LIBRARY_TRAFFIC_LIMIT) {
      const params: Array<string | number> = [];
      let cursorClause = '';

      if (cursorTimestamp !== null && cursorId !== null) {
        cursorClause = `
          AND (
            request_timestamp < ?
            OR (request_timestamp = ? AND id < ?)
          )
        `;
        params.push(cursorTimestamp, cursorTimestamp, cursorId);
      }

      const batch = await this.db.executeQuery<PlaygroundLibraryTrafficRow>(
        `
          SELECT id, trace_id, conversation_id, method, host, path, url, api_type, service_name,
                 response_status, duration_ms, request_timestamp
          FROM http_traffic_logs
          FORCE INDEX (idx_ai_request_time_id)
          WHERE is_ai_request = 1
            ${cursorClause}
          ORDER BY request_timestamp DESC, id DESC
          LIMIT ${PlaygroundCaseBuilder.TRAFFIC_SEARCH_BATCH_SIZE}
        `,
        params
      );

      if (batch.length === 0) {
        break;
      }

      for (const item of batch) {
        if (!normalizedSearch || this.matchesTrafficSearch(item, normalizedSearch)) {
          rows.push(item);
          if (rows.length >= PlaygroundCaseBuilder.LIBRARY_TRAFFIC_LIMIT) {
            break;
          }
        }
      }

      const lastItem = batch[batch.length - 1];
      cursorTimestamp = lastItem.request_timestamp || null;
      cursorId = typeof lastItem.id === 'number' ? lastItem.id : Number(lastItem.id);

      if (batch.length < PlaygroundCaseBuilder.TRAFFIC_SEARCH_BATCH_SIZE || !cursorTimestamp || !Number.isFinite(cursorId)) {
        break;
      }
    }

    return rows;
  }

  private matchesTrafficSearch(item: PlaygroundLibraryTrafficRow, normalizedSearch: string): boolean {
    const haystacks = [item.url, item.host, item.path]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .map((value) => value.toLowerCase());

    return haystacks.some((value) => value.includes(normalizedSearch));
  }

  async getCaseById(caseId: string): Promise<PlaygroundCase | null> {
    const rows = await this.db.executeQuery<PlaygroundCaseRow>(
      'SELECT * FROM playground_cases WHERE id = ?',
      [caseId]
    );
    return rows[0] ? this.mapCaseRow(rows[0]) : null;
  }

  async listRunsByCase(caseId: string): Promise<ReturnType<PlaygroundCaseBuilder['mapRunRow']>[]> {
    const rows = await this.db.executeQuery<PlaygroundRunRow>(
      'SELECT * FROM playground_runs WHERE case_id = ? ORDER BY created_at DESC',
      [caseId]
    );
    return rows.map((row) => this.mapRunRow(row));
  }

  async getRunById(runId: string): Promise<ReturnType<PlaygroundCaseBuilder['mapRunRow']> | null> {
    const rows = await this.db.executeQuery<PlaygroundRunRow>(
      'SELECT * FROM playground_runs WHERE id = ?',
      [runId]
    );
    return rows[0] ? this.mapRunRow(rows[0]) : null;
  }

  async updateCase(caseId: string, payload: Partial<PlaygroundCase>): Promise<PlaygroundCase | null> {
    const existing = await this.getCaseById(caseId);
    if (!existing) {
      return null;
    }

    const next = {
      ...existing,
      ...payload,
      traceContext: payload.traceContext || existing.traceContext,
      promptInput: payload.promptInput || existing.promptInput,
      providerConfig: payload.providerConfig || existing.providerConfig,
      baselineSnapshot: payload.baselineSnapshot ?? existing.baselineSnapshot,
      currentPatch: payload.currentPatch ?? existing.currentPatch,
      importFidelity: payload.importFidelity || existing.importFidelity || 'exact',
      baselineOutput: payload.baselineOutput ?? existing.baselineOutput,
      rawEvidence: payload.rawEvidence || existing.rawEvidence,
      tags: payload.tags || existing.tags
    };

    await this.db.executeUpdate(
      `
        UPDATE playground_cases
        SET name = ?, prompt_id = ?, prompt_mode_default = ?, trace_context = ?,
            prompt_input = ?, provider_config = ?, baseline_snapshot = ?, current_patch = ?, import_fidelity = ?,
            baseline_output = ?, raw_evidence = ?,
            tags = ?, notes = ?, is_favorite = ?
        WHERE id = ?
      `,
      [
        next.name,
        next.promptId || null,
        next.promptModeDefault,
        stringify(next.traceContext),
        stringify(next.promptInput),
        stringify(next.providerConfig),
        stringify(next.baselineSnapshot || null),
        stringify(next.currentPatch || null),
        next.importFidelity || 'exact',
        stringify(next.baselineOutput || null),
        stringify(next.rawEvidence),
        stringify(next.tags),
        next.notes || null,
        next.isFavorite ? 1 : 0,
        caseId
      ]
    );

    return this.getCaseById(caseId);
  }

  async createCaseFromTraffic(trafficId: number, promptId?: string | null): Promise<PlaygroundCase> {
    const trafficRows = await this.db.executeQuery<TrafficLogRow>(
      `
        SELECT id, trace_id, conversation_id, llm_call_id, tool_call_id, agent_turn,
               method, url, host, path, request_headers, request_body, response_body,
               response_status, request_timestamp, duration_ms, api_type, service_name
        FROM http_traffic_logs
        WHERE id = ?
      `,
      [trafficId]
    );

    const traffic = trafficRows[0];
    if (!traffic) {
      throw new Error(`Traffic sample not found: ${trafficId}`);
    }

    const prompt = promptId ? await this.loadPrompt(promptId) : null;
    const llmCall = await this.loadLLMCallForTraffic(traffic);
    const conversation = traffic.conversation_id ? await this.loadConversation(traffic.conversation_id) : null;

    const caseMode: PlaygroundCaseMode = llmCall || conversation ? 'contextual' : 'wire';
    const baselineSnapshot = llmCall ? buildBaselineSnapshot(llmCall, traffic.trace_id || null, null) : null;
    const providerConfig = prompt
      ? buildProviderConfigFromPrompt(prompt)
      : baselineSnapshot
        ? buildProviderConfigFromBaselineSnapshot(baselineSnapshot, llmCall?.model_provider || traffic.api_type || null)
        : buildProviderConfigFromTraffic(traffic, llmCall);
    const promptInput = this.buildPromptInput({
      prompt,
      llmCall,
      conversation,
      traffic
    });
    const baselineOutput = this.buildBaselineOutput(traffic, llmCall, conversation);

    const caseRecord: PlaygroundCase = {
      id: crypto.randomUUID(),
      name: `${traffic.api_type || 'AI'} · ${traffic.host}${traffic.path ? ` ${traffic.path}` : ''}`.slice(0, 255),
      source: 'traffic',
      sourceRef: String(traffic.id),
      caseMode,
      traceContext: {
        traceId: traffic.trace_id || llmCall?.trace_id || conversation?.trace_id || null,
        conversationId: traffic.conversation_id || llmCall?.conversation_id || conversation?.id || null,
        llmCallId: traffic.llm_call_id || llmCall?.llm_call_id || null,
        toolCallId: traffic.tool_call_id || null,
        agentTurn: traffic.agent_turn ?? llmCall?.agent_turn ?? null,
        trafficLogId: traffic.id,
        spanId: null
      },
      promptId: prompt?.id || null,
      promptModeDefault: prompt ? 'saved' : 'draft',
      promptInput,
      providerConfig,
      baselineSnapshot,
      currentPatch: null,
      importFidelity: baselineSnapshot?.effectiveUnifiedConfig ? 'exact' : 'partial',
      baselineOutput,
      rawEvidence: {
        traffic,
        llmCall,
        conversation
      },
      tags: [traffic.api_type || 'ai-traffic', caseMode],
      notes: null,
      isFavorite: false,
      createdBy: 'admin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await this.persistCase(caseRecord);
    const saved = await this.getCaseById(caseRecord.id);
    if (!saved) {
      throw new Error('Failed to persist playground case');
    }
    return saved;
  }

  async createCaseFromConversation(conversationId: string, promptId?: string | null): Promise<PlaygroundCase> {
    const conversation = await this.loadConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const prompt = promptId ? await this.loadPrompt(promptId) : null;
    const llmCall = await this.loadLLMCallForConversation(conversation);
    if (!llmCall?.canonical_request) {
      throw new PlaygroundCompatibilityError(`Conversation ${conversationId} has no canonical LLM request to import into Playground`);
    }
    const baselineSnapshot = buildBaselineSnapshot(llmCall, conversation.trace_id || null, null);
    const providerConfig = prompt
      ? buildProviderConfigFromPrompt(prompt)
      : buildProviderConfigFromBaselineSnapshot(baselineSnapshot, llmCall?.model_provider || null);
    const promptInput = this.buildPromptInput({
      prompt,
      llmCall,
      conversation,
      traffic: null
    });

    const caseRecord: PlaygroundCase = {
      id: crypto.randomUUID(),
      name: `Conversation · ${conversation.id}`.slice(0, 255),
      source: 'conversation',
      sourceRef: conversation.id,
      caseMode: 'contextual',
      traceContext: {
        traceId: conversation.trace_id || llmCall?.trace_id || null,
        conversationId: conversation.id,
        llmCallId: llmCall?.llm_call_id || null,
        agentTurn: llmCall?.agent_turn ?? null,
        trafficLogId: null,
        spanId: null
      },
      promptId: prompt?.id || null,
      promptModeDefault: prompt ? 'saved' : 'draft',
      promptInput,
      providerConfig,
      baselineSnapshot,
      currentPatch: null,
      importFidelity: baselineSnapshot.effectiveUnifiedConfig ? 'exact' : 'partial',
      baselineOutput: this.buildBaselineOutput(null, llmCall, conversation),
      rawEvidence: {
        conversation,
        llmCall
      },
      tags: ['conversation', 'contextual'],
      notes: null,
      isFavorite: false,
      createdBy: 'admin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await this.persistCase(caseRecord);
    const saved = await this.getCaseById(caseRecord.id);
    if (!saved) {
      throw new Error('Failed to persist playground case');
    }
    return saved;
  }

  async createCaseFromSpan(traceId: string, spanId: string, promptId?: string | null): Promise<PlaygroundCase> {
    const existing = await this.findExistingSpanCase(traceId, spanId);
    if (existing) {
      return existing;
    }

    const llmCall = await this.loadLLMCallForSpan(traceId, spanId);
    if (!llmCall) {
      throw new PlaygroundCompatibilityError(`Span ${spanId} is not a compatible LLM span`);
    }
    if (!llmCall.canonical_request) {
      throw new PlaygroundCompatibilityError(`Span ${spanId} has no canonical LLM request to import into Playground`);
    }
    const baselineSnapshot = buildBaselineSnapshot(llmCall, traceId, spanId);
    if (!baselineSnapshot.effectiveUnifiedConfig) {
      throw new PlaygroundCompatibilityError(`Span ${spanId} is missing effective unified config and cannot be replayed exactly`);
    }

    const conversation = llmCall.conversation_id ? await this.loadConversation(llmCall.conversation_id) : null;
    const providerConfig = buildProviderConfigFromBaselineSnapshot(baselineSnapshot, llmCall.model_provider || null);
    const promptInput = buildPromptInputFromCanonicalRequest(baselineSnapshot.canonicalRequest || {});

    const caseRecord: PlaygroundCase = {
      id: crypto.randomUUID(),
      name: `Span · ${spanId}`.slice(0, 255),
      source: 'span',
      sourceRef: `${traceId}:${spanId}`,
      caseMode: 'contextual',
      traceContext: {
        traceId: llmCall.trace_id || traceId || conversation?.trace_id || null,
        conversationId: conversation?.id || llmCall.conversation_id || null,
        llmCallId: llmCall.llm_call_id || null,
        agentTurn: llmCall.agent_turn ?? null,
        trafficLogId: null,
        spanId
      },
      promptId: null,
      promptModeDefault: 'draft',
      promptInput,
      providerConfig,
      baselineSnapshot,
      currentPatch: null,
      importFidelity: 'exact',
      baselineOutput: this.buildBaselineOutput(null, llmCall, conversation),
      rawEvidence: {
        spanId,
        baselineSnapshot,
        llmCall,
        conversation
      },
      tags: ['span', 'generation'],
      notes: null,
      isFavorite: false,
      createdBy: 'admin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await this.persistCase(caseRecord);
    const saved = await this.getCaseById(caseRecord.id);
    if (!saved) {
      throw new Error('Failed to persist playground case');
    }
    return saved;
  }

  private async findExistingSpanCase(traceId: string, spanId: string): Promise<PlaygroundCase | null> {
    const caseIds = await this.db.executeQuery<{ id: string }>(
      `
        SELECT id
        FROM playground_cases
        FORCE INDEX (idx_source_ref_updated_at_id)
        WHERE source = 'span'
          AND source_ref = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `,
      [`${traceId}:${spanId}`]
    );

    return caseIds[0] ? this.getCaseById(caseIds[0].id) : null;
  }

  private async persistCase(caseRecord: PlaygroundCase): Promise<void> {
    await this.db.executeInsert(
      `
        INSERT INTO playground_cases (
          id, name, source, source_ref, case_mode, trace_context, prompt_id, prompt_mode_default,
          prompt_input, provider_config, baseline_snapshot, current_patch, import_fidelity,
          baseline_output, raw_evidence, tags, notes,
          is_favorite, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        caseRecord.id,
        caseRecord.name,
        caseRecord.source,
        caseRecord.sourceRef,
        caseRecord.caseMode,
        stringify(caseRecord.traceContext),
        caseRecord.promptId || null,
        caseRecord.promptModeDefault,
        stringify(caseRecord.promptInput),
        stringify(caseRecord.providerConfig),
        stringify(caseRecord.baselineSnapshot || null),
        stringify(caseRecord.currentPatch || null),
        caseRecord.importFidelity || 'exact',
        stringify(caseRecord.baselineOutput || null),
        stringify(caseRecord.rawEvidence),
        stringify(caseRecord.tags),
        caseRecord.notes || null,
        caseRecord.isFavorite ? 1 : 0,
        caseRecord.createdBy
      ]
    );
  }

  private buildPromptInput(params: {
    prompt: PromptRecord | null;
    llmCall: LLMCallRow | null;
    conversation: ConversationRow | null;
    traffic: TrafficLogRow | null;
  }): PlaygroundPromptInput {
    const promptContextVariables = parseJsonField<Record<string, unknown>>(params.prompt?.context_variables, {});

    if (params.prompt) {
      const systemInstruction = applyContextVariables(
        parseSystemInstructions(params.prompt.system_instructions),
        promptContextVariables,
        {
          conversation_id: params.conversation?.id || params.traffic?.conversation_id || null,
          trace_id: params.conversation?.trace_id || params.traffic?.trace_id || null
        }
      );

      const baseMessages: PlaygroundMessage[] = params.llmCall
        ? buildPromptInputFromCanonicalRequest(
            parseJsonField<Record<string, unknown>>(params.llmCall.canonical_request, {})
          ).messages.filter((message) => message.role !== 'system')
        : params.conversation?.user_message
          ? [{ role: 'user', content: params.conversation.user_message }]
          : params.traffic
            ? extractMessagesFromGeminiContents(
                parseJsonField<Record<string, unknown>>(params.traffic.request_body, {}).contents
              ).filter((message) => message.role !== 'system')
            : [];

      return {
        systemInstruction,
        messages: normalizePromptMessages(baseMessages),
        contextVariables: promptContextVariables
      };
    }

    if (params.llmCall) {
      return buildPromptInputFromCanonicalRequest(
        parseJsonField<Record<string, unknown>>(params.llmCall.canonical_request, {})
      );
    }

    if (params.traffic) {
      const requestBody = parseJsonField<Record<string, unknown>>(params.traffic.request_body, {});
      return {
        systemInstruction: typeof requestBody.system_instruction === 'object'
          ? extractTextResponse(requestBody.system_instruction)
          : '',
        messages: extractMessagesFromGeminiContents(requestBody.contents),
        contextVariables: {}
      };
    }

    return {
      systemInstruction: '',
      messages: params.conversation?.user_message
        ? [{ role: 'user', content: params.conversation.user_message }]
        : [],
      contextVariables: {}
    };
  }

  private buildBaselineOutput(
    traffic: TrafficLogRow | null,
    llmCall: LLMCallRow | null,
    conversation: ConversationRow | null
  ): PlaygroundBaselineOutput | null {
    if (llmCall) {
      return {
        sourceKind: 'llm_call',
        responseText: llmCall.processed_response || extractTextResponse(llmCall.canonical_response),
        provider: llmCall.model_provider || undefined,
        modelName: llmCall.model_name || undefined,
        usage: {
          inputTokens: llmCall.input_tokens || 0,
          outputTokens: llmCall.output_tokens || 0
        },
        canonicalRequest: parseJsonField(llmCall.canonical_request, null),
        canonicalResponse: parseJsonField(llmCall.canonical_response, null),
        wireRequest: parseJsonField(llmCall.wire_request, null),
        wireResponse: parseJsonField(llmCall.wire_response, null),
        metadata: {
          status: llmCall.status || null,
          processingTimeMs: llmCall.processing_time_ms || null,
          apiCallTimeMs: llmCall.api_call_time_ms || null
        }
      };
    }

    if (conversation?.ai_response) {
      return {
        sourceKind: 'conversation',
        responseText: conversation.ai_response,
        modelName: conversation.model_name || undefined,
        metadata: {
          status: conversation.status || null,
          responseTime: conversation.response_time || null
        }
      };
    }

    if (traffic?.response_body) {
      return {
        sourceKind: 'traffic',
        responseText: extractTextResponse(traffic.response_body),
        provider: traffic.api_type || undefined,
        metadata: {
          statusCode: traffic.response_status || null,
          durationMs: traffic.duration_ms || null
        },
        rawResponse: parseJsonField(traffic.response_body, traffic.response_body)
      };
    }

    return null;
  }

  private async loadPrompt(promptId: string): Promise<PromptRecord | null> {
    const rows = await this.db.executeQuery<PromptRecord>(
      `
        SELECT id, prompt_name, system_instructions, user_prompt_template,
               context_variables, model_config, advanced_config, model_name
        FROM agent_prompts
        WHERE id = ?
      `,
      [promptId]
    );

    return rows[0] || null;
  }

  private async loadConversation(conversationId: string): Promise<ConversationRow | null> {
    const rows = await this.db.executeQuery<ConversationRow>(
      `
        SELECT id, trace_id, user_message, ai_response, raw_request, timestamp,
               response_time, model_name, status
        FROM conversations
        WHERE id = ?
      `,
      [conversationId]
    );
    return rows[0] || null;
  }

  private llmCallStartedAtValue(row: LLMCallRow | null): number {
    if (!row) {
      return Number.POSITIVE_INFINITY;
    }

    const startedAt = row.started_at || row.completed_at || null;
    if (!startedAt) {
      return Number.POSITIVE_INFINITY;
    }

    const value = new Date(startedAt).getTime();
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  }

  private pickEarliestLlmCall(candidates: Array<LLMCallRow | null>): LLMCallRow | null {
    const rows = candidates
      .filter((candidate): candidate is LLMCallRow => Boolean(candidate))
      .filter((candidate, index, list) => {
        const key = candidate.id != null ? `id:${candidate.id}` : `llm:${candidate.llm_call_id || ''}`;
        return list.findIndex((row) => (row.id != null ? `id:${row.id}` : `llm:${row.llm_call_id || ''}`) === key) === index;
      });

    if (rows.length === 0) {
      return null;
    }

    rows.sort((left, right) => {
      const startedDiff = this.llmCallStartedAtValue(left) - this.llmCallStartedAtValue(right);
      if (startedDiff !== 0) {
        return startedDiff;
      }
      return (left.id || 0) - (right.id || 0);
    });

    return rows[0] || null;
  }

  private async loadLLMCallForTraffic(traffic: TrafficLogRow): Promise<LLMCallRow | null> {
    const tableName = await this.resolveLlmCallTableName();
    if (!tableName) {
      return null;
    }

    const [byCallId, byTraceId, byConversationId] = await Promise.all([
      traffic.llm_call_id
        ? this.db.executeQuery<LLMCallRow>(
            `
              SELECT *
              FROM ${tableName}
              WHERE llm_call_id = ?
              ORDER BY started_at ASC, id ASC
              LIMIT 1
            `,
            [traffic.llm_call_id]
          )
        : Promise.resolve([]),
      traffic.trace_id
        ? this.db.executeQuery<LLMCallRow>(
            `
              SELECT *
              FROM ${tableName}
              WHERE trace_id = ?
              ORDER BY started_at ASC, id ASC
              LIMIT 1
            `,
            [traffic.trace_id]
          )
        : Promise.resolve([]),
      traffic.conversation_id
        ? this.db.executeQuery<LLMCallRow>(
            `
              SELECT *
              FROM ${tableName}
              WHERE conversation_id = ?
              ORDER BY started_at ASC, id ASC
              LIMIT 1
            `,
            [traffic.conversation_id]
          )
        : Promise.resolve([])
    ]);

    return this.pickEarliestLlmCall([byCallId[0] || null, byTraceId[0] || null, byConversationId[0] || null]);
  }

  private async loadLLMCallForConversation(conversation: ConversationRow): Promise<LLMCallRow | null> {
    const tableName = await this.resolveLlmCallTableName();
    if (!tableName) {
      return null;
    }

    const [byTraceId, byConversationId] = await Promise.all([
      conversation.trace_id
        ? this.db.executeQuery<LLMCallRow>(
            `
              SELECT *
              FROM ${tableName}
              WHERE trace_id = ?
              ORDER BY started_at ASC, id ASC
              LIMIT 1
            `,
            [conversation.trace_id]
          )
        : Promise.resolve([]),
      this.db.executeQuery<LLMCallRow>(
        `
          SELECT *
          FROM ${tableName}
          WHERE conversation_id = ?
          ORDER BY started_at ASC, id ASC
          LIMIT 1
        `,
        [conversation.id]
      )
    ]);

    return this.pickEarliestLlmCall([byTraceId[0] || null, byConversationId[0] || null]);
  }

  private async loadLLMCallForSpan(traceId: string, spanId: string): Promise<LLMCallRow | null> {
    const tableName = await this.resolveLlmCallTableName();
    if (!tableName) {
      return null;
    }

    if (spanId.startsWith('llm-call:')) {
      const llmCallId = spanId.slice('llm-call:'.length).trim();
      if (!llmCallId) {
        return null;
      }

      const rows = await this.db.executeQuery<LLMCallRow>(
        `
          SELECT *
          FROM ${tableName}
          WHERE llm_call_id = ?
          ORDER BY started_at ASC, id ASC
          LIMIT 1
        `,
        [llmCallId]
      );

      return rows[0] || null;
    }

    if (spanId.startsWith('llm:')) {
      const legacyId = Number(spanId.slice('llm:'.length).trim());
      if (!Number.isFinite(legacyId)) {
        return null;
      }

      const rows = await this.db.executeQuery<LLMCallRow>(
        `
          SELECT *
          FROM ${tableName}
          WHERE id = ?
          LIMIT 1
        `,
        [legacyId]
      );

      return rows[0] || null;
    }

    return null;
  }

  private async resolveLlmCallTableName(): Promise<'llm_call_logs' | 'llm_calls' | null> {
    if (this.llmCallTableName !== undefined) {
      return this.llmCallTableName;
    }

    const rows = await this.db.executeQuery<{ TABLE_NAME: 'llm_call_logs' | 'llm_calls' }>(
      `
        SELECT TABLE_NAME
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('llm_call_logs', 'llm_calls')
        ORDER BY FIELD(TABLE_NAME, 'llm_call_logs', 'llm_calls')
        LIMIT 1
      `
    );

    this.llmCallTableName = rows[0]?.TABLE_NAME || null;
    if (!this.llmCallTableName) {
      this.logger.warn('No LLM call table found for playground case builder', {
        checkedTables: ['llm_call_logs', 'llm_calls']
      });
    }

    return this.llmCallTableName;
  }

  private mapCaseRow(row: PlaygroundCaseRow): PlaygroundCase {
    return {
      id: row.id,
      name: row.name,
      source: row.source,
      sourceRef: row.source_ref,
      caseMode: row.case_mode,
      traceContext: parseJsonField(row.trace_context, {}),
      promptId: row.prompt_id || null,
      promptModeDefault: row.prompt_mode_default,
      promptInput: parseJsonField<PlaygroundPromptInput>(row.prompt_input, {
        systemInstruction: '',
        messages: [],
        contextVariables: {}
      }),
      providerConfig: parseJsonField<PlaygroundProviderConfig>(row.provider_config, {
        provider: 'google-gemini-cli',
        generation: {},
        context: {},
        providerSpecific: {}
      }),
      baselineSnapshot: parseJsonField<PlaygroundBaselineSnapshot | null>(row.baseline_snapshot, null),
      currentPatch: parseJsonField<PlaygroundRequestPatch | null>(row.current_patch, null),
      importFidelity: row.import_fidelity || 'exact',
      baselineOutput: parseJsonField<PlaygroundBaselineOutput | null>(row.baseline_output, null),
      rawEvidence: parseJsonField<Record<string, unknown>>(row.raw_evidence, {}),
      tags: parseJsonField<string[]>(row.tags, []),
      notes: row.notes || null,
      isFavorite: Boolean(row.is_favorite),
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapRunRow(row: PlaygroundRunRow): PlaygroundRun {
    return {
      id: row.id,
      caseId: row.case_id,
      executionMode: row.execution_mode || 'exact_replay',
      promptMode: row.prompt_mode,
      promptId: row.prompt_id || null,
      promptSnapshot: parseJsonField<Record<string, unknown> | null>(row.prompt_snapshot, null),
      providerConfigSnapshot: parseJsonField<PlaygroundProviderConfig>(row.provider_config_snapshot, {
        provider: 'google-gemini-cli',
        generation: {},
        context: {},
        providerSpecific: {}
      }),
      inputSnapshot: parseJsonField<PlaygroundPromptInput>(row.input_snapshot, {
        systemInstruction: '',
        messages: [],
        contextVariables: {}
      }),
      baselineSnapshot: parseJsonField<PlaygroundBaselineSnapshot | null>(row.baseline_snapshot, null),
      requestPatch: parseJsonField<PlaygroundRequestPatch | null>(row.request_patch, null),
      effectiveRequest: parseJsonField<Record<string, unknown> | null>(row.effective_request, null),
      effectiveConfig: parseJsonField<Record<string, unknown> | null>(row.effective_config, null),
      outputSnapshot: parseJsonField<Record<string, unknown> | null>(row.output_snapshot, null),
      comparisonSnapshot: parseJsonField<Record<string, unknown> | null>(row.comparison_snapshot, null),
      diffSnapshot: parseJsonField<Record<string, unknown> | null>(row.diff_snapshot, null),
      modelName: row.model_name || null,
      provider: row.provider || null,
      status: row.status,
      executedBy: row.executed_by,
      createdAt: row.created_at
    };
  }
}

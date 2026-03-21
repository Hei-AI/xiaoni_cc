import crypto from 'crypto';
import winston from 'winston';
import { DatabaseManager } from './database';
import {
  PlaygroundBaselineOutput,
  PlaygroundCase,
  PlaygroundCaseMode,
  PlaygroundLibraryPayload,
  PlaygroundMessage,
  PlaygroundPromptInput,
  PlaygroundProviderConfig,
  PlaygroundPromptMode
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
  source: 'traffic' | 'conversation';
  source_ref: string;
  case_mode: 'contextual' | 'wire';
  trace_context: unknown;
  prompt_id?: string | null;
  prompt_mode_default: PlaygroundPromptMode;
  prompt_input: unknown;
  provider_config: unknown;
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
  prompt_mode: PlaygroundPromptMode;
  prompt_id?: string | null;
  prompt_snapshot?: unknown;
  provider_config_snapshot: unknown;
  input_snapshot: unknown;
  output_snapshot?: unknown;
  comparison_snapshot?: unknown;
  model_name?: string | null;
  provider?: string | null;
  status: 'completed' | 'failed';
  executed_by: string;
  created_at: string;
};

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
      role: message.role === 'assistant' ? 'assistant' : 'user',
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

function extractMessagesFromOpenResponseInput(input: unknown): PlaygroundMessage[] {
  const items = Array.isArray(input) ? input : [];
  const messages: PlaygroundMessage[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object' || (item as { type?: string }).type !== 'message') {
      continue;
    }

    const role = (item as { role?: string }).role === 'assistant' ? 'assistant' : 'user';
    const content = (item as { content?: unknown }).content;

    if (typeof content === 'string') {
      messages.push({ role, content });
      continue;
    }

    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (!part || typeof part !== 'object') {
            return '';
          }
          if ((part as { type?: string }).type === 'input_text') {
            return String((part as { text?: unknown }).text || '');
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');

      if (text.trim()) {
        messages.push({ role, content: text });
      }
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
      const role = (content as { role?: string }).role === 'model' ? 'assistant' : 'user';
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

export class PlaygroundCaseBuilder {
  constructor(
    private readonly db: DatabaseManager,
    private readonly logger: winston.Logger
  ) {}

  async ensureTables(): Promise<void> {
    await this.db.executeUpdate(`
      CREATE TABLE IF NOT EXISTS playground_cases (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        source ENUM('traffic', 'conversation') NOT NULL,
        source_ref VARCHAR(64) NOT NULL,
        case_mode ENUM('contextual', 'wire') NOT NULL,
        trace_context JSON NOT NULL,
        prompt_id VARCHAR(36) NULL,
        prompt_mode_default ENUM('saved', 'draft') NOT NULL DEFAULT 'draft',
        prompt_input JSON NOT NULL,
        provider_config JSON NOT NULL,
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
        prompt_mode ENUM('saved', 'draft') NOT NULL,
        prompt_id VARCHAR(36) NULL,
        prompt_snapshot JSON NULL,
        provider_config_snapshot JSON NOT NULL,
        input_snapshot JSON NOT NULL,
        output_snapshot JSON NULL,
        comparison_snapshot JSON NULL,
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
  }

  async listLibrary(params: { search?: string; promptId?: string | null } = {}): Promise<PlaygroundLibraryPayload> {
    const searchLike = params.search ? `%${params.search}%` : null;

    const trafficSamples = await this.db.executeQuery<Record<string, unknown>>(
      `
        SELECT id, trace_id, conversation_id, method, host, path, url, api_type, service_name,
               response_status, duration_ms, request_timestamp
        FROM http_traffic_logs
        WHERE is_ai_request = 1
          ${searchLike ? 'AND (url LIKE ? OR host LIKE ? OR path LIKE ?)' : ''}
        ORDER BY request_timestamp DESC
        LIMIT 24
      `,
      searchLike ? [searchLike, searchLike, searchLike] : []
    );

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

    const cases = await this.db.executeQuery<PlaygroundCaseRow>(
      `
        SELECT *
        FROM playground_cases
        ${caseWhere}
        ORDER BY is_favorite DESC, updated_at DESC
        LIMIT 24
      `,
      caseParams
    );

    const runs = await this.db.executeQuery<PlaygroundRunRow>(
      `
        SELECT *
        FROM playground_runs
        ORDER BY created_at DESC
        LIMIT 12
      `
    );

    return {
      trafficSamples,
      savedCases: cases.map((row) => this.mapCaseRow(row)),
      recentRuns: runs.map((row) => this.mapRunRow(row))
    };
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
      baselineOutput: payload.baselineOutput ?? existing.baselineOutput,
      rawEvidence: payload.rawEvidence || existing.rawEvidence,
      tags: payload.tags || existing.tags
    };

    await this.db.executeUpdate(
      `
        UPDATE playground_cases
        SET name = ?, prompt_id = ?, prompt_mode_default = ?, trace_context = ?,
            prompt_input = ?, provider_config = ?, baseline_output = ?, raw_evidence = ?,
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
    const providerConfig = prompt
      ? buildProviderConfigFromPrompt(prompt)
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
        trafficLogId: traffic.id
      },
      promptId: prompt?.id || null,
      promptModeDefault: prompt ? 'saved' : 'draft',
      promptInput,
      providerConfig,
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
    const providerConfig = prompt
      ? buildProviderConfigFromPrompt(prompt)
      : buildProviderConfigFromTraffic({
          id: 0,
          method: 'POST',
          url: '',
          host: '',
          path: '',
          api_type: llmCall?.model_provider || null
        } as TrafficLogRow, llmCall);
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
        trafficLogId: null
      },
      promptId: prompt?.id || null,
      promptModeDefault: prompt ? 'saved' : 'draft',
      promptInput,
      providerConfig,
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

  private async persistCase(caseRecord: PlaygroundCase): Promise<void> {
    await this.db.executeInsert(
      `
        INSERT INTO playground_cases (
          id, name, source, source_ref, case_mode, trace_context, prompt_id, prompt_mode_default,
          prompt_input, provider_config, baseline_output, raw_evidence, tags, notes,
          is_favorite, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

      const baseMessages: PlaygroundMessage[] = params.conversation?.user_message
        ? [{ role: 'user', content: params.conversation.user_message }]
        : params.llmCall
          ? extractMessagesFromOpenResponseInput(
              parseJsonField<Record<string, unknown>>(params.llmCall.canonical_request, {}).input
            )
          : params.traffic
            ? extractMessagesFromGeminiContents(
                parseJsonField<Record<string, unknown>>(params.traffic.request_body, {}).contents
              )
            : [];

      return {
        systemInstruction,
        messages: normalizePromptMessages(baseMessages),
        contextVariables: promptContextVariables
      };
    }

    if (params.llmCall) {
      const canonicalRequest = parseJsonField<Record<string, unknown>>(params.llmCall.canonical_request, {});
      const messages = extractMessagesFromOpenResponseInput(canonicalRequest.input);
      return {
        systemInstruction: typeof canonicalRequest.instructions === 'string' ? canonicalRequest.instructions : '',
        messages,
        contextVariables: {}
      };
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

  private async loadLLMCallForTraffic(traffic: TrafficLogRow): Promise<LLMCallRow | null> {
    const rows = await this.db.executeQuery<LLMCallRow>(
      `
        SELECT *
        FROM llm_calls
        WHERE (${traffic.llm_call_id ? 'llm_call_id = ?' : '1 = 0'})
           OR (${traffic.trace_id ? 'trace_id = ?' : '1 = 0'})
           OR (${traffic.conversation_id ? 'conversation_id = ?' : '1 = 0'})
        ORDER BY started_at ASC
        LIMIT 1
      `,
      [
        ...(traffic.llm_call_id ? [traffic.llm_call_id] : []),
        ...(traffic.trace_id ? [traffic.trace_id] : []),
        ...(traffic.conversation_id ? [traffic.conversation_id] : [])
      ]
    );
    return rows[0] || null;
  }

  private async loadLLMCallForConversation(conversation: ConversationRow): Promise<LLMCallRow | null> {
    const rows = await this.db.executeQuery<LLMCallRow>(
      `
        SELECT *
        FROM llm_calls
        WHERE (${conversation.trace_id ? 'trace_id = ?' : '1 = 0'})
           OR conversation_id = ?
        ORDER BY started_at ASC
        LIMIT 1
      `,
      [
        ...(conversation.trace_id ? [conversation.trace_id] : []),
        conversation.id
      ]
    );
    return rows[0] || null;
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

  private mapRunRow(row: PlaygroundRunRow) {
    return {
      id: row.id,
      caseId: row.case_id,
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
      outputSnapshot: parseJsonField<Record<string, unknown> | null>(row.output_snapshot, null),
      comparisonSnapshot: parseJsonField<Record<string, unknown> | null>(row.comparison_snapshot, null),
      modelName: row.model_name || null,
      provider: row.provider || null,
      status: row.status,
      executedBy: row.executed_by,
      createdAt: row.created_at
    };
  }
}

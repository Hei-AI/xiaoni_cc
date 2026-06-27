import axios, { AxiosRequestConfig } from 'axios';
import { AIConfig, UnifiedLLMConfig } from '../../types';
import { logger } from '../../utils/logger';
import {
  cloneValue,
  extractTextFromOpenAIResponse,
  geminiRequestToOpenResponseRequest,
  normalizeUsageDetails,
  openResponseInputToOpenAIInput,
  toOpenResponseUsage
} from './helpers';
import {
  LLMProvider,
  LLMProviderContentRequest,
  LLMProviderContentResult,
  LLMProviderId,
  LLMProviderTextRequest,
  LLMProviderTextResult,
  OpenResponseCreateRequest
} from './types';
import { buildTraceHeaders } from '../../utils/trace-headers';

type OpenAIProviderOptions = {
  id?: LLMProviderId;
  apiKey?: string;
  baseUrl?: string;
  responsesPath?: string;
  timeoutMs?: number;
  defaultHeaders?: Record<string, string>;
};

type WireExchangeMetadata = {
  requestHeaders: Record<string, unknown> | null;
  requestUrl: string | null;
  responseHeaders: Record<string, unknown> | null;
  responseStatus: number | null;
  responseStatusText: string | null;
};

const DEFAULT_LLM_RESPONSE_TIMEOUT_MS = 300_000;

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'openai-api-key',
  'proxy-authorization',
  'chatgpt-account-id'
]);

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeHeaderRecord(headers: unknown): Record<string, unknown> {
  if (!headers || typeof headers !== 'object') {
    return {};
  }

  const entries = typeof (headers as any).toJSON === 'function'
    ? Object.entries((headers as any).toJSON())
    : Object.entries(headers as Record<string, unknown>);

  return Object.fromEntries(entries.map(([key, value]) => [
    key,
    SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) ? '[redacted]' : value
  ]));
}

function stringifyRawLlmErrorPayload(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined) {
    return 'undefined';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function withNullableType(schema: Record<string, any>): Record<string, any> {
  const next = { ...schema };
  if (Array.isArray(next.type)) {
    next.type = next.type.includes('null') ? next.type : [...next.type, 'null'];
  } else if (typeof next.type === 'string') {
    next.type = next.type === 'null' ? next.type : [next.type, 'null'];
  }
  if (Array.isArray(next.enum) && !next.enum.includes(null)) {
    next.enum = [...next.enum, null];
  }
  return next;
}

function normalizeStrictJsonSchema(schema: unknown, options: { optional?: boolean } = {}): unknown {
  if (!isPlainObject(schema)) {
    return schema;
  }

  const normalized: Record<string, any> = { ...schema };
  if (isPlainObject(normalized.properties)) {
    const originalRequired = new Set(Array.isArray(normalized.required) ? normalized.required : []);
    const properties: Record<string, any> = {};
    for (const [key, value] of Object.entries(normalized.properties)) {
      properties[key] = normalizeStrictJsonSchema(value, { optional: !originalRequired.has(key) });
    }
    normalized.properties = properties;
    normalized.required = Object.keys(properties);
    normalized.additionalProperties = false;
  }

  if (isPlainObject(normalized.items)) {
    normalized.items = normalizeStrictJsonSchema(normalized.items);
  }

  return options.optional ? withNullableType(normalized) : normalized;
}

function normalizeFunctionToolStrictMode(tool: NonNullable<OpenResponseCreateRequest['tools']>[number]): boolean | undefined {
  if (tool.type !== 'function') {
    return undefined;
  }
  if (typeof tool.function.strict === 'boolean') {
    return tool.function.strict;
  }
  return typeof tool.strict === 'boolean' ? tool.strict : true;
}

export class OpenAIProvider implements LLMProvider {
  readonly id: LLMProviderId;
  protected readonly apiKey?: string;
  protected readonly baseUrl: string;
  protected readonly responsesPath: string;
  protected readonly timeoutMs?: number;
  protected readonly defaultHeaders: Record<string, string>;
  protected readonly moduleLogger = logger.createModuleLogger('llm-provider-openai');
  protected lastWireExchange: WireExchangeMetadata | null = null;

  constructor(aiConfig: AIConfig, options: OpenAIProviderOptions = {}) {
    this.id = options.id || 'openai';
    this.apiKey = options.apiKey !== undefined
      ? options.apiKey
      : (aiConfig.openai_api_key || process.env.OPENAI_API_KEY || undefined);
    this.baseUrl = (options.baseUrl || aiConfig.openai_base_url || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.responsesPath = options.responsesPath || '/responses';
    this.timeoutMs = options.timeoutMs;
    this.defaultHeaders = options.defaultHeaders || {};
  }

  async generateText(input: LLMProviderTextRequest): Promise<LLMProviderTextResult> {
    const contentRequest = this.buildContentRequestFromPrompt(input.prompt, input.config);
    const contentResult = await this.generateContent({
      request: contentRequest,
      modelName: input.config.model.name,
      providerConfig: input.config,
      context: input.context
    });

    return {
      provider: contentResult.provider,
      modelName: contentResult.modelName,
      text: contentResult.text,
      rawResponse: contentResult.rawResponse,
      canonicalRequest: contentResult.canonicalRequest,
      wireRequest: contentResult.wireRequest,
      wireRequestHeaders: contentResult.wireRequestHeaders,
      wireRequestUrl: contentResult.wireRequestUrl,
      canonicalResponse: contentResult.canonicalResponse,
      wireResponse: contentResult.wireResponse,
      wireResponseHeaders: contentResult.wireResponseHeaders,
      wireResponseStatus: contentResult.wireResponseStatus,
      wireResponseStatusText: contentResult.wireResponseStatusText,
      requestFormatVersion: contentResult.requestFormatVersion,
      wireProviderFormat: contentResult.wireProviderFormat,
      usage: contentResult.usage
    };
  }

  async generateContent(input: LLMProviderContentRequest): Promise<LLMProviderContentResult> {
    const callStartTime = Date.now();
    try {
      const providerConfig = input.providerConfig;
      const apiKey = await this.resolveApiKey();
      const providerSpecific = providerConfig?.model?.providerSpecific || {};
      const baseUrl = typeof providerSpecific.baseUrl === 'string' ? providerSpecific.baseUrl.replace(/\/$/, '') : this.baseUrl;
      const responsesPath =
        typeof providerSpecific.responsesPath === 'string' ? providerSpecific.responsesPath : this.responsesPath;
      const payload = this.buildResponsesPayload(input.request, providerConfig);
      const response = await this.postResponses(
        baseUrl,
        responsesPath,
        payload,
        apiKey,
        providerConfig?.performance.timeout || this.timeoutMs,
        buildTraceHeaders(input.context)
      );
      const wireExchange = this.lastWireExchange;

      const text = extractTextFromOpenAIResponse(response);
      const processingTimeMs = Date.now() - callStartTime;
      const normalizedUsage = normalizeUsageDetails(response?.usage, Math.ceil(text.length / 4));
      const inputTokens = normalizedUsage.inputTokens;
      const outputTokens = normalizedUsage.outputTokens;

      const canonicalResponse = {
        ...cloneValue(response),
        status: response?.status || 'completed',
        model: response?.model || input.modelName,
        output: Array.isArray(response?.output) ? cloneValue(response.output) : [],
        output_text: response?.output_text || text,
        usage: toOpenResponseUsage({
          inputTokens,
          outputTokens,
          totalTokens: normalizedUsage.totalTokens,
          cachedInputTokens: normalizedUsage.cachedInputTokens,
          reasoningTokens: normalizedUsage.reasoningTokens,
          rawUsage: normalizedUsage.rawUsage
        })
      };

      const result = {
        provider: this.id,
        modelName: input.modelName,
        text,
        response: canonicalResponse,
        rawResponse: cloneValue(response),
        canonicalRequest: cloneValue(input.request),
        wireRequest: cloneValue(payload),
        wireRequestHeaders: wireExchange?.requestHeaders || null,
        wireRequestUrl: wireExchange?.requestUrl || null,
        canonicalResponse,
        wireResponse: cloneValue(response),
        wireResponseHeaders: wireExchange?.responseHeaders || null,
        wireResponseStatus: wireExchange?.responseStatus ?? null,
        wireResponseStatusText: wireExchange?.responseStatusText || null,
        requestFormatVersion: 'openresponse/v1',
        wireProviderFormat: `${this.id}/responses`,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: normalizedUsage.totalTokens,
          processingTimeMs,
          cachedInputTokens: normalizedUsage.cachedInputTokens,
          reasoningTokens: normalizedUsage.reasoningTokens,
          rawUsage: normalizedUsage.rawUsage
        }
      };
      return result;
    } catch (error) {
      this.moduleLogger.error('LLM provider content generation failed', {
        provider: this.id,
        modelName: input.modelName,
        traceId: input.context?.traceId || null,
        llmCallId: input.context?.llmCallId || null,
        elapsedMs: Math.max(0, Date.now() - callStartTime),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  protected buildContentRequestFromPrompt(prompt: string, config: UnifiedLLMConfig): OpenResponseCreateRequest {
    return geminiRequestToOpenResponseRequest({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: config.generation.temperature,
        topP: config.generation.topP,
        maxOutputTokens: config.generation.maxOutputTokens,
        stopSequences: config.generation.stopSequences
      },
      toolConfig: {
        functionCallingConfig: config.tools?.functionCalling
      },
      systemInstruction: config.context.systemInstruction
    }, config.model.name, config);
  }

  protected buildResponsesPayload(request: OpenResponseCreateRequest, providerConfig?: UnifiedLLMConfig): Record<string, any> {
    const payload: Record<string, any> = {
      model: request.model,
      input: openResponseInputToOpenAIInput(request.input, undefined)
    };

    if (typeof request.instructions === 'string' && request.instructions.trim().length > 0) {
      payload.instructions = request.instructions;
    }

    if (request.temperature !== undefined) {
      payload.temperature = request.temperature;
    }
    if (request.top_p !== undefined) {
      payload.top_p = request.top_p;
    }
    if (request.max_output_tokens !== undefined) {
      payload.max_output_tokens = request.max_output_tokens;
    }
    if (Array.isArray(request.stop) && request.stop.length > 0) {
      payload.stop = request.stop;
    }

    if (Array.isArray(request.tools) && request.tools.length > 0) {
      payload.tools = request.tools.map((tool) => this.serializeToolDefinition(tool));
      payload.tool_choice = this.serializeToolChoice(request.tool_choice);
    }

    if (typeof request.parallel_tool_calls === 'boolean') {
      payload.parallel_tool_calls = request.parallel_tool_calls;
    }

    const providerSpecific = providerConfig?.model?.providerSpecific || {};
    const text = this.buildTextConfig(request, providerSpecific);
    if (text) {
      payload.text = text;
    }
    const reasoningEffort = providerSpecific.reasoningEffort || request.reasoning?.effort;
    const reasoningSummary = providerSpecific.reasoningSummary || request.reasoning?.summary;
    if (typeof reasoningEffort === 'string' || typeof reasoningSummary === 'string') {
      payload.reasoning = {
        ...(request.reasoning || {}),
        ...(typeof reasoningEffort === 'string' ? { effort: reasoningEffort } : {}),
        ...(typeof reasoningSummary === 'string' ? { summary: reasoningSummary } : {})
      };
    } else if (request.reasoning) {
      payload.reasoning = request.reasoning;
    }

    if (Array.isArray(request.include) && request.include.length > 0) {
      payload.include = Array.from(new Set(request.include.filter((item) => typeof item === 'string' && item.trim())));
    }

    if (typeof request.store === 'boolean') {
      payload.store = request.store;
    }

    if (request.metadata) {
      payload.metadata = request.metadata;
    }

    if (typeof request.previous_response_id === 'string' && request.previous_response_id.trim()) {
      payload.previous_response_id = request.previous_response_id.trim();
    }

    if (typeof request.prompt_cache_key === 'string' && request.prompt_cache_key.trim()) {
      payload.prompt_cache_key = request.prompt_cache_key.trim();
    }
    if (typeof request.prompt_cache_retention === 'string' && request.prompt_cache_retention.trim()) {
      payload.prompt_cache_retention = request.prompt_cache_retention.trim();
    }
    if (Array.isArray(request.context_management) && request.context_management.length > 0) {
      payload.context_management = cloneValue(request.context_management);
    }

    return payload;
  }

  protected async postResponses(
    baseUrl: string,
    responsesPath: string,
    payload: Record<string, any>,
    apiKey: string,
    timeoutMs?: number,
    traceHeaders: Record<string, string> = {}
  ): Promise<any> {
    const requestUrl = `${baseUrl}${responsesPath.startsWith('/') ? responsesPath : `/${responsesPath}`}`;
    const requestConfig: AxiosRequestConfig = {
      url: requestUrl,
      method: 'post',
      timeout: timeoutMs || DEFAULT_LLM_RESPONSE_TIMEOUT_MS,
      data: payload,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...this.defaultHeaders,
        ...traceHeaders
      }
    };

    this.lastWireExchange = {
      requestHeaders: normalizeHeaderRecord(requestConfig.headers),
      requestUrl,
      responseHeaders: null,
      responseStatus: null,
      responseStatusText: null
    };

    try {
      const response = await axios(requestConfig);
      this.lastWireExchange = {
        requestHeaders: normalizeHeaderRecord(requestConfig.headers),
        requestUrl,
        responseHeaders: normalizeHeaderRecord(response.headers),
        responseStatus: response.status,
        responseStatusText: response.statusText || null
      };
      return response.data;
    } catch (error: any) {
      if (error?.response) {
        this.lastWireExchange = {
          requestHeaders: normalizeHeaderRecord(requestConfig.headers),
          requestUrl,
          responseHeaders: normalizeHeaderRecord(error.response.headers),
          responseStatus: error.response.status ?? null,
          responseStatusText: error.response.statusText || null
        };
        const rawBody = stringifyRawLlmErrorPayload(error.response.data);
        const message = `LLM API error (${error.response.status} ${error.response.statusText || ''}): ${rawBody}`;
        const next = new Error(message.trim()) as Error & {
          status?: number;
          response?: unknown;
          cause?: unknown;
        };
        next.status = error.response.status;
        next.response = error.response;
        next.cause = error;
        throw next;
      }
      throw error;
    }
  }

  protected recordWireExchange(metadata: WireExchangeMetadata): void {
    this.lastWireExchange = metadata;
  }

  protected sanitizeWireHeaders(headers: unknown): Record<string, unknown> {
    return normalizeHeaderRecord(headers);
  }

  protected async resolveApiKey(): Promise<string> {
    if (!this.apiKey) {
      throw new Error(`Missing API credentials for provider ${this.id}`);
    }
    return this.apiKey;
  }

  protected serializeToolDefinition(tool: NonNullable<OpenResponseCreateRequest['tools']>[number]): Record<string, any> {
    if (tool.type === 'function') {
      const strict = normalizeFunctionToolStrictMode(tool);
      const parameters = tool.function.parameters || { type: 'object', properties: {} };
      return {
        type: 'function',
        name: tool.function.name,
        description: tool.function.description,
        parameters: strict === true ? normalizeStrictJsonSchema(parameters) : parameters,
        ...(typeof strict === 'boolean' ? { strict } : {})
      };
    }

    if (tool.type === 'image_generation') {
      return {
        type: tool.type,
        ...(tool.model ? { model: tool.model } : {}),
        ...(tool.output_format ? { output_format: tool.output_format } : {}),
        ...(tool.size ? { size: tool.size } : {}),
        ...(tool.quality ? { quality: tool.quality } : {}),
        ...(tool.background ? { background: tool.background } : {})
      };
    }

    if (tool.type === 'computer_use') {
      // Computer use is an Anthropic-only tool handled on the Anthropic path; it is
      // never added to requests routed to the OpenAI/codex provider. Emit a bare
      // passthrough so the union narrows — this branch is unreachable in practice.
      return { type: tool.type };
    }

    return {
      type: tool.type,
      ...(tool.user_location ? { user_location: tool.user_location } : {}),
      ...(tool.filters ? { filters: tool.filters } : {}),
      ...(tool.search_context_size ? { search_context_size: tool.search_context_size } : {}),
      ...(typeof tool.external_web_access === 'boolean' ? { external_web_access: tool.external_web_access } : {})
    };
  }

  protected serializeToolChoice(toolChoice: OpenResponseCreateRequest['tool_choice']) {
    if (!toolChoice || typeof toolChoice === 'string') {
      return toolChoice;
    }

    if (toolChoice.type === 'allowed_tools') {
      return {
        type: 'allowed_tools',
        mode: toolChoice.mode || 'required',
        tools: toolChoice.tools.map((tool) => (
          tool.type === 'function'
            ? { type: 'function', name: tool.name }
            : { type: tool.type }
        ))
      };
    }

    return toolChoice;
  }

  private buildTextConfig(
    request: OpenResponseCreateRequest,
    providerSpecific: Record<string, any>
  ): Record<string, any> | undefined {
    const requestText = isPlainObject(request.text) ? cloneValue(request.text) as Record<string, any> : {};
    const verbosity = typeof providerSpecific.textVerbosity === 'string' && providerSpecific.textVerbosity.trim()
      ? providerSpecific.textVerbosity.trim()
      : typeof requestText.verbosity === 'string' && requestText.verbosity.trim()
      ? requestText.verbosity.trim()
      : '';
    if (verbosity === 'low' || verbosity === 'medium' || verbosity === 'high') {
      requestText.verbosity = verbosity;
    }
    return Object.keys(requestText).length > 0 ? requestText : undefined;
  }
}

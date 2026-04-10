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

export class OpenAIProvider implements LLMProvider {
  readonly id: LLMProviderId;
  protected readonly apiKey?: string;
  protected readonly baseUrl: string;
  protected readonly responsesPath: string;
  protected readonly timeoutMs?: number;
  protected readonly defaultHeaders: Record<string, string>;
  protected readonly moduleLogger = logger.createModuleLogger('llm-provider-openai');

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
      canonicalResponse: contentResult.canonicalResponse,
      wireResponse: contentResult.wireResponse,
      requestFormatVersion: contentResult.requestFormatVersion,
      wireProviderFormat: contentResult.wireProviderFormat,
      usage: contentResult.usage
    };
  }

  async generateContent(input: LLMProviderContentRequest): Promise<LLMProviderContentResult> {
    const callStartTime = Date.now();
    const apiKey = await this.resolveApiKey();
    const providerConfig = input.providerConfig;
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

    return {
      provider: this.id,
      modelName: input.modelName,
      text,
      response: canonicalResponse,
      rawResponse: cloneValue(response),
      canonicalRequest: cloneValue(input.request),
      wireRequest: cloneValue(payload),
      canonicalResponse,
      wireResponse: cloneValue(response),
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
      payload.tool_choice = request.tool_choice;
    }

    if (typeof request.parallel_tool_calls === 'boolean') {
      payload.parallel_tool_calls = request.parallel_tool_calls;
    }

    const providerSpecific = providerConfig?.model?.providerSpecific || {};
    const reasoningEffort = providerSpecific.reasoningEffort || request.reasoning?.effort;
    if (typeof reasoningEffort === 'string') {
      payload.reasoning = { ...(request.reasoning || {}), effort: reasoningEffort };
    } else if (request.reasoning) {
      payload.reasoning = request.reasoning;
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
    const requestConfig: AxiosRequestConfig = {
      url: `${baseUrl}${responsesPath.startsWith('/') ? responsesPath : `/${responsesPath}`}`,
      method: 'post',
      timeout: timeoutMs || 30000,
      data: payload,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...this.defaultHeaders,
        ...traceHeaders
      }
    };

    const response = await axios(requestConfig);
    return response.data;
  }

  protected async resolveApiKey(): Promise<string> {
    if (!this.apiKey) {
      throw new Error(`Missing API credentials for provider ${this.id}`);
    }
    return this.apiKey;
  }

  protected serializeToolDefinition(tool: NonNullable<OpenResponseCreateRequest['tools']>[number]): Record<string, any> {
    if (tool.type === 'function') {
      return {
        type: 'function',
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters || { type: 'object', properties: {} }
      };
    }

    return {
      type: tool.type,
      ...(tool.user_location ? { user_location: tool.user_location } : {}),
      ...(tool.filters ? { filters: tool.filters } : {}),
      ...(tool.search_context_size ? { search_context_size: tool.search_context_size } : {}),
      ...(typeof tool.external_web_access === 'boolean' ? { external_web_access: tool.external_web_access } : {})
    };
  }
}

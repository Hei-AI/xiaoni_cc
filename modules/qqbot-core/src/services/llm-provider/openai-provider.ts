import axios, { AxiosRequestConfig } from 'axios';
import { AIConfig, UnifiedLLMConfig } from '../../types';
import { logger } from '../../utils/logger';
import {
  cloneValue,
  extractTextFromOpenAIResponse,
  geminiRequestToOpenResponseRequest,
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
    const response = await this.postResponses(baseUrl, responsesPath, payload, apiKey, providerConfig?.performance.timeout || this.timeoutMs);

    const text = extractTextFromOpenAIResponse(response);
    const processingTimeMs = Date.now() - callStartTime;
    const usage = response?.usage || {};
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? Math.ceil(text.length / 4);

    return {
      provider: this.id,
      modelName: input.modelName,
      text,
      response: {
        ...cloneValue(response),
        status: response?.status || 'completed',
        model: response?.model || input.modelName,
        output: Array.isArray(response?.output) ? cloneValue(response.output) : [],
        output_text: response?.output_text || text,
        usage: toOpenResponseUsage({
          inputTokens,
          outputTokens,
          totalTokens: usage.total_tokens
        })
      },
      rawResponse: cloneValue(response),
      usage: {
        inputTokens,
        outputTokens,
        processingTimeMs
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
      input: openResponseInputToOpenAIInput(request.input, request.instructions)
    };

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
      payload.tools = request.tools.map((tool) => ({
        type: 'function',
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters || { type: 'object', properties: {} }
      }));
      payload.tool_choice = request.tool_choice;
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

    return payload;
  }

  protected async postResponses(
    baseUrl: string,
    responsesPath: string,
    payload: Record<string, any>,
    apiKey: string,
    timeoutMs?: number
  ): Promise<any> {
    const requestConfig: AxiosRequestConfig = {
      url: `${baseUrl}${responsesPath.startsWith('/') ? responsesPath : `/${responsesPath}`}`,
      method: 'post',
      timeout: timeoutMs || 30000,
      data: payload,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...this.defaultHeaders
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
}

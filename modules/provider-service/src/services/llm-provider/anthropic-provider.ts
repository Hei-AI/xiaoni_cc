/**
 * AnthropicProvider — runs Xiaoni on a Claude Code subscription by translating
 * the OpenAI-Responses-shaped canonical request into the Anthropic Messages API.
 *
 * Stand-alone LLMProvider (NOT a subclass of OpenAIProvider): the wire shape,
 * auth, and response shape all differ. canonical<->Messages translation lives in
 * anthropic-translate.ts (pure); OAuth in anthropic-oauth.ts.
 *
 *   generateContent(canonical) ->
 *     resolve Claude OAuth (refresh if expired)
 *     translate canonical -> Messages body
 *     POST api.anthropic.com/v1/messages (Bearer + cc headers)   [401 -> refresh, retry once]
 *     translate Messages response -> OpenResponseResource (output items)
 *     record llm_request_slices via the same provider-debug pipeline
 */

import axios, { AxiosRequestConfig } from 'axios';
import { AIConfig } from '../../types';
import { logger } from '../../utils/logger';
import { buildTraceHeaders } from '../../utils/trace-headers';
import { cloneValue } from './helpers';
import { codexPromptCacheAdmissionGate } from './codex-prompt-cache-gate';
import {
  buildClaudeHeaders,
  CLAUDE_API_BASE_URL,
  CLAUDE_MESSAGES_PATH,
  resolveClaudeOAuthCredential
} from './anthropic-oauth';
import {
  computerUseBeta,
  extractTextFromMessagesResponse,
  translateCanonicalToMessages,
  translateMessagesResponseToCanonical,
  type AnthropicMessagesResponse
} from './anthropic-translate';
import {
  LLMProvider,
  LLMProviderContentRequest,
  LLMProviderContentResult,
  LLMProviderId,
  LLMProviderTextRequest,
  LLMProviderTextResult
} from './types';

const DEFAULT_LLM_RESPONSE_TIMEOUT_MS = 300_000;
const TRANSIENT_RETRY_ATTEMPTS = 2;
const CONNECTION_RETRY_ATTEMPTS = 4;
const TRANSIENT_RETRY_BASE_DELAY_MS = 400;

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-anthropic-billing-header',
  'proxy-authorization'
]);

type WireExchangeMetadata = {
  requestHeaders: Record<string, unknown> | null;
  requestUrl: string | null;
  responseHeaders: Record<string, unknown> | null;
  responseStatus: number | null;
  responseStatusText: string | null;
};

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

function stringifyRawError(value: unknown): string {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AnthropicProviderOptions {
  id?: LLMProviderId;
  baseUrl?: string;
  timeoutMs?: number;
  defaultMaxTokens?: number;
}

export class AnthropicProvider implements LLMProvider {
  readonly id: LLMProviderId;
  private readonly aiConfig: AIConfig;
  private readonly baseUrl: string;
  private readonly timeoutMs?: number;
  private readonly defaultMaxTokens?: number;
  private readonly moduleLogger = logger.createModuleLogger('llm-provider-anthropic');
  private lastWireExchange: WireExchangeMetadata | null = null;

  constructor(aiConfig: AIConfig, options: AnthropicProviderOptions = {}) {
    this.aiConfig = aiConfig;
    this.id = options.id || 'anthropic';
    this.baseUrl = (options.baseUrl || aiConfig.anthropic_base_url || process.env.ANTHROPIC_BASE_URL || CLAUDE_API_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs;
    this.defaultMaxTokens = options.defaultMaxTokens;
  }

  async generateText(input: LLMProviderTextRequest): Promise<LLMProviderTextResult> {
    const contentResult = await this.generateContent({
      request: {
        model: input.config.model.name,
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: input.prompt }] }],
        max_output_tokens: input.config.generation.maxOutputTokens
      },
      modelName: input.config.model.name,
      providerConfig: input.config,
      context: input.context
    });
    const { response: _response, ...rest } = contentResult;
    void _response;
    return rest;
  }

  async generateContent(input: LLMProviderContentRequest): Promise<LLMProviderContentResult> {
    const callStartTime = Date.now();
    try {
      const { body } = translateCanonicalToMessages(input.request, {
        model: input.modelName || input.request.model,
        defaultMaxTokens: this.defaultMaxTokens
      });

      const response = await this.postMessages(body, input);
      const wireExchange = this.lastWireExchange;

      const text = extractTextFromMessagesResponse(response);
      const processingTimeMs = Date.now() - callStartTime;
      const canonicalResponse = translateMessagesResponseToCanonical(response, input.modelName);

      const inputTokens = canonicalResponse.usage.input_tokens;
      const outputTokens = canonicalResponse.usage.output_tokens;
      const cachedInputTokens = canonicalResponse.usage.input_tokens_details?.cached_tokens || 0;

      return {
        provider: this.id,
        modelName: input.modelName,
        text,
        response: canonicalResponse,
        rawResponse: cloneValue(response),
        canonicalRequest: cloneValue(input.request),
        wireRequest: cloneValue(body),
        wireRequestHeaders: wireExchange?.requestHeaders || null,
        wireRequestUrl: wireExchange?.requestUrl || null,
        canonicalResponse,
        wireResponse: cloneValue(response),
        wireResponseHeaders: wireExchange?.responseHeaders || null,
        wireResponseStatus: wireExchange?.responseStatus ?? null,
        wireResponseStatusText: wireExchange?.responseStatusText || null,
        requestFormatVersion: 'openresponse/v1',
        wireProviderFormat: `${this.id}/messages`,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          processingTimeMs,
          cachedInputTokens,
          rawUsage: response?.usage || undefined
        }
      };
    } catch (error) {
      this.moduleLogger.error('Anthropic content generation failed', {
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

  private async postMessages(
    body: Record<string, any>,
    input: LLMProviderContentRequest
  ): Promise<AnthropicMessagesResponse> {
    const requestUrl = `${this.baseUrl}${CLAUDE_MESSAGES_PATH}`;
    const traceHeaders = buildTraceHeaders(input.context);
    const timeout = input.providerConfig?.performance.timeout || this.timeoutMs || DEFAULT_LLM_RESPONSE_TIMEOUT_MS;

    // Prefix-cache admission gate (Claude parity with the Codex path). Anthropic has
    // no prompt_cache_key — cache identity is purely content-prefix + manual
    // breakpoints + 5min TTL. When the main loop and its forks (which share the same
    // tools/system/history prefix) fire concurrently while that prefix is still cold,
    // they each cold-prefill and duplicate-write instead of one warming it for the
    // rest. The gate (keyed on model + stable-prefix-hash) serializes same-prefix
    // requests so one warms the cache, then the others read it. Forks/heartbeat/
    // subconscious run as background priority; the interactive main loop bypasses
    // after a bounded wait. The gate keys off the canonical request (which still
    // carries prompt_cache_key=xiaoni:global), not the translated Messages body.
    const admission = await codexPromptCacheAdmissionGate.admit({
      payload: input.request as unknown as Record<string, any>,
      executionMode: typeof traceHeaders['x-execution-mode'] === 'string'
        ? traceHeaders['x-execution-mode']
        : null
    });
    if (admission.enabled && admission.waitMs > 0) {
      this.moduleLogger.info('Anthropic prompt cache admission gate released request', {
        bucketKey: admission.bucketKey,
        waitMs: admission.waitMs,
        queueDepth: admission.queueDepth,
        priority: admission.priority,
        bypassed: admission.bypassed,
        llmCallId: input.context?.llmCallId || null,
        executionMode: traceHeaders['x-execution-mode'] || null
      });
    }

    let refreshedOnce = false;
    let attempt = 0;
    let connAttempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const resolved = await resolveClaudeOAuthCredential(this.aiConfig, refreshedOnce);
      const accessToken = resolved.credential?.access;
      if (!accessToken) {
        throw new Error('Claude OAuth access token is unavailable (check ~/.claude/.credentials.json).');
      }
      const headers = { ...buildClaudeHeaders(accessToken, this.aiConfig), ...traceHeaders };
      // Computer use is gated behind a per-version beta flag. Derive it from the
      // computer_* tool type the translator placed in the body (model-resolved),
      // and append it so we never send the wrong/no computer-use beta. No-op when
      // the body carries no computer tool.
      const computerToolType = Array.isArray((body as any).tools)
        ? ((body as any).tools.find(
            (t: any) => typeof t?.type === 'string' && t.type.startsWith('computer_')
          )?.type as string | undefined)
        : undefined;
      if (computerToolType) {
        const cuBeta = computerUseBeta(computerToolType);
        const existing = String(headers['anthropic-beta'] || '');
        if (cuBeta && !existing.split(',').includes(cuBeta)) {
          headers['anthropic-beta'] = existing ? `${existing},${cuBeta}` : cuBeta;
        }
      }
      const requestConfig: AxiosRequestConfig = {
        url: requestUrl,
        method: 'post',
        timeout,
        data: body,
        headers
      };

      this.lastWireExchange = {
        requestHeaders: normalizeHeaderRecord(headers),
        requestUrl,
        responseHeaders: null,
        responseStatus: null,
        responseStatusText: null
      };

      try {
        const response = await axios(requestConfig);
        this.lastWireExchange = {
          requestHeaders: normalizeHeaderRecord(headers),
          requestUrl,
          responseHeaders: normalizeHeaderRecord(response.headers),
          responseStatus: response.status,
          responseStatusText: response.statusText || null
        };
        return response.data as AnthropicMessagesResponse;
      } catch (error: any) {
        const status: number | undefined = error?.response?.status;
        if (error?.response) {
          this.lastWireExchange = {
            requestHeaders: normalizeHeaderRecord(headers),
            requestUrl,
            responseHeaders: normalizeHeaderRecord(error.response.headers),
            responseStatus: status ?? null,
            responseStatusText: error.response.statusText || null
          };
        }

        // 401 -> refresh the OAuth token once and retry
        if (status === 401 && !refreshedOnce) {
          refreshedOnce = true;
          continue;
        }

        // transient: 429 / 5xx / overloaded -> bounded backoff retry
        if ((status === 429 || (status && status >= 500)) && attempt < TRANSIENT_RETRY_ATTEMPTS) {
          const retryAfter = Number(error?.response?.headers?.['retry-after']);
          const delay = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : TRANSIENT_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          attempt += 1;
          await sleep(delay);
          continue;
        }

        // connection-level errors (no HTTP response): TLS reset / socket disconnected /
        // timeout / DNS. This network drops TLS to api.anthropic.com intermittently, so
        // retry these (they cost no tokens — nothing reached the model).
        if (!error?.response && connAttempt < CONNECTION_RETRY_ATTEMPTS) {
          connAttempt += 1;
          await sleep(TRANSIENT_RETRY_BASE_DELAY_MS * Math.pow(2, connAttempt - 1));
          continue;
        }

        if (error?.response) {
          const rawBody = stringifyRawError(error.response.data);
          const message = `Anthropic API error (${status} ${error.response.statusText || ''}): ${rawBody}`;
          const next = new Error(message.trim()) as Error & { status?: number; response?: unknown; cause?: unknown };
          next.status = status;
          next.response = error.response;
          next.cause = error;
          throw next;
        }
        throw error;
      }
    }
  }
}

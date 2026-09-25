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
import { anthropicRetryWindow } from './provider-retry-window';
import {
  buildClaudeHeaders,
  claudeAccountKey,
  CLAUDE_API_BASE_URL,
  CLAUDE_MESSAGES_PATH,
  resolveClaudeOAuthCredential
} from './anthropic-oauth';
import {
  computerUseBeta,
  extractTextFromMessagesResponse,
  translateCanonicalToMessages,
  translateMessagesResponseToCanonical,
  type AnthropicMessagesResponse,
  type AnthropicWireDialect
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
const MAX_TRANSIENT_RETRY_DELAY_MS = 30_000;

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

function createAbortError(): Error {
  const error = new Error('Anthropic request aborted during retry backoff');
  error.name = 'AbortError';
  return error;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface AnthropicProviderOptions {
  id?: LLMProviderId;
  baseUrl?: string;
  timeoutMs?: number;
  defaultMaxTokens?: number;
  /** wire dialect of the target endpoint (default 'claude') */
  dialect?: AnthropicWireDialect;
  /**
   * Static API key sent as `Authorization: Bearer`. When set, the Claude OAuth credential
   * and Claude Code client headers are not used (third-party Anthropic-compatible endpoints).
   */
  apiKey?: string;
}

// A forced multi-tool choice (tool_choice any) that the endpoint does not enforce is
// re-requested this many extra times when the reply carries no tool call.
const FORCED_TOOL_CHOICE_RETRIES = 2;

type ResolvedAuth = { headers: Record<string, string>; accountKey: string };

// Third-party endpoints get no Files API: drop stamped Files API ids so the translator
// sends the image_url (base64) the canonical item always keeps.
function stripAnthropicFileIds<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripAnthropicFileIds(entry)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'anthropic_file_id') continue;
      out[key] = stripAnthropicFileIds(entry);
    }
    return out as T;
  }
  return value;
}

function hasToolUse(response: AnthropicMessagesResponse): boolean {
  return Array.isArray(response.content) && response.content.some((block) => block?.type === 'tool_use');
}

export class AnthropicProvider implements LLMProvider {
  readonly id: LLMProviderId;
  private readonly aiConfig: AIConfig;
  private readonly baseUrl: string;
  private readonly timeoutMs?: number;
  private readonly defaultMaxTokens?: number;
  private readonly dialect: AnthropicWireDialect;
  private readonly apiKey?: string;
  private readonly moduleLogger = logger.createModuleLogger('llm-provider-anthropic');
  private lastWireExchange: WireExchangeMetadata | null = null;

  constructor(aiConfig: AIConfig, options: AnthropicProviderOptions = {}) {
    this.aiConfig = aiConfig;
    this.id = options.id || 'anthropic';
    this.baseUrl = (options.baseUrl || aiConfig.anthropic_base_url || process.env.ANTHROPIC_BASE_URL || CLAUDE_API_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs;
    this.defaultMaxTokens = options.defaultMaxTokens;
    this.dialect = options.dialect || 'claude';
    this.apiKey = options.apiKey;
  }

  private async resolveAuth(forceRefresh = false): Promise<ResolvedAuth> {
    if (this.apiKey !== undefined) {
      if (!this.apiKey) throw new Error(`${this.id} API key is not configured.`);
      return {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        accountKey: `${this.id}:api-key`
      };
    }
    const resolved = await resolveClaudeOAuthCredential(this.aiConfig, forceRefresh);
    const accessToken = resolved.credential?.access;
    if (!accessToken) {
      throw new Error('Claude OAuth access token is unavailable (check ~/.claude/.credentials.json).');
    }
    return {
      headers: buildClaudeHeaders(accessToken, this.aiConfig),
      accountKey: claudeAccountKey(resolved.credential!)
    };
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
      const request = this.dialect === 'claude' ? input.request : stripAnthropicFileIds(input.request);
      const { body } = translateCanonicalToMessages(request, {
        model: input.modelName || input.request.model,
        defaultMaxTokens: this.defaultMaxTokens,
        dialect: this.dialect
      });

      let response = await this.postMessages(body, input);
      if (body.tool_choice?.type === 'any') {
        for (let retry = 1; retry <= FORCED_TOOL_CHOICE_RETRIES && !hasToolUse(response); retry += 1) {
          this.moduleLogger.warn('Forced tool_choice returned no tool call; re-requesting', {
            provider: this.id,
            modelName: input.modelName,
            retry,
            llmCallId: input.context?.llmCallId || null
          });
          response = await this.postMessages(body, input);
        }
      }
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
    const initialAccountKey = (await this.resolveAuth()).accountKey;
    const isMainRequest = input.context?.executionMode === 'agent_loop';
    if (!isMainRequest) {
      anthropicRetryWindow.assertReady(JSON.stringify([this.baseUrl, body.model, initialAccountKey]));
    }

    // Prefix-cache admission gate (Claude parity with the Codex path). Anthropic has
    // no prompt_cache_key on the wire, so the gate uses the canonical request's
    // stable-prefix key. A cache prefix is a single-flight resource: the gate lease
    // stays held for the whole upstream retry loop, and a waiting interactive request
    // may not bypass it. Otherwise a cold prefill can be duplicated by a retry before
    // the first request has returned and written its cache entry.
    const admission = await codexPromptCacheAdmissionGate.acquire({
      // Admission-only namespace; canonical/wire request bytes are untouched.
      payload: {
        ...input.request,
        model: body.model,
        prompt_cache_key: input.request.prompt_cache_key
          ? JSON.stringify([this.baseUrl, initialAccountKey, input.request.prompt_cache_key])
          : undefined
      },
      executionMode: typeof traceHeaders['x-execution-mode'] === 'string'
        ? traceHeaders['x-execution-mode']
        : null,
      signal: input.signal
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

    try {
      let refreshedOnce = false;
      let attempt = 0;
      let connAttempt = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        let auth = await this.resolveAuth(refreshedOnce);
        const retryScope = JSON.stringify([this.baseUrl, body.model, auth.accountKey]);
        // Only main requests own timed retry. Auxiliary calls fail promptly during
        // the same model/account window instead of maintaining their own timers.
        if (isMainRequest) {
          await anthropicRetryWindow.wait(retryScope, input.signal);
          // OAuth may expire or be switched while waiting hours for rate reset.
          auth = await this.resolveAuth();
          if (retryScope !== JSON.stringify([this.baseUrl, body.model, auth.accountKey])) continue;
        } else anthropicRetryWindow.assertReady(retryScope);
        const headers: Record<string, string> = { ...auth.headers, ...traceHeaders };
        // Computer use is gated behind a per-version beta flag. Derive it from the
        // computer_* tool type the translator placed in the body (model-resolved),
        // and append it so we never send the wrong/no computer-use beta. No-op when
        // the body carries no computer tool.
        const computerToolType = Array.isArray((body as any).tools)
          ? ((body as any).tools.find(
              (t: any) => typeof t?.type === 'string' && t.type.startsWith('computer_')
            )?.type as string | undefined)
          : undefined;
        if (computerToolType && this.dialect === 'claude') {
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
          headers,
          // Cancellation: when the caller aborts (e.g. cache-heartbeat client timeout),
          // axios tears down the in-flight upstream request so it stops burning tokens
          // instead of orphaning it to completion. Undefined signal → no-op.
          signal: input.signal
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
          // Caller aborted (heartbeat client timeout / disconnect): bail immediately.
          // An axios cancel has no `error.response`, so without this guard it would fall
          // into the connection-level retry below and re-issue the very request we just
          // cancelled — defeating the whole point. Never retry an aborted request.
          if (
            input.signal?.aborted ||
            axios.isCancel(error) ||
            error?.code === 'ERR_CANCELED' ||
            error?.name === 'CanceledError' ||
            error?.name === 'AbortError'
          ) {
            throw error;
          }
          const status: number | undefined = error?.response?.status;
          if (status === 429) {
            const retryAt = anthropicRetryWindow.defer(retryScope, error.response.headers?.['retry-after']);
            this.moduleLogger.warn('Anthropic requests deferred until Retry-After', {
              retryAt: new Date(retryAt).toISOString(),
              llmCallId: input.context?.llmCallId || null
            });
            if (!isMainRequest) throw error;
          }
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
          if (status === 401 && !refreshedOnce && this.apiKey === undefined) {
            refreshedOnce = true;
            continue;
          }

          // transient: 429 / 5xx / overloaded -> bounded backoff retry
          if ((status === 429 || (status && status >= 500)) && attempt < TRANSIENT_RETRY_ATTEMPTS) {
            const retryAfter = Number(error?.response?.headers?.['retry-after']);
            const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : 0;
            const longRateLimitReset = status === 429 && retryAfterMs > MAX_TRANSIENT_RETRY_DELAY_MS;
            if (!longRateLimitReset) {
              const delay = retryAfterMs > 0
                ? Math.min(retryAfterMs, MAX_TRANSIENT_RETRY_DELAY_MS)
                : TRANSIENT_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
              attempt += 1;
              await sleep(delay, input.signal);
              continue;
            }
            this.moduleLogger.warn('Skipping long Anthropic rate-limit retry-after', {
              retryAfterSeconds: retryAfter,
              maxRetryDelayMs: MAX_TRANSIENT_RETRY_DELAY_MS,
              traceId: input.context?.traceId || null,
              llmCallId: input.context?.llmCallId || null
            });
          }

          // connection-level errors (no HTTP response): TLS reset / socket disconnected /
          // timeout / DNS. This network drops TLS to api.anthropic.com intermittently, so
          // retry these (they cost no tokens — nothing reached the model).
          if (!error?.response && connAttempt < CONNECTION_RETRY_ATTEMPTS) {
            connAttempt += 1;
            await sleep(TRANSIENT_RETRY_BASE_DELAY_MS * Math.pow(2, connAttempt - 1), input.signal);
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
    } finally {
      // Do not release between internal provider retries: a waiting request must not
      // become another cold prefill while this logical request is still unresolved.
      admission.release();
    }
  }
}

import os from 'os';
import path from 'path';
import { AIConfig, UnifiedLLMConfig } from '../../types';
import { logger } from '../../utils/logger';
import {
  openResponseInputToOpenAIInput
} from './helpers';
import {
  isOAuthCredentialExpired,
  loadOAuthCredential,
  persistOAuthCredential,
  type NormalizedOAuthCredential,
  type OAuthCredentialSource
} from './oauth-credentials';
import { OpenAIProvider } from './openai-provider';

const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_JWT_CLAIM_PATH = 'https://api.openai.com/auth';

export class CodexProvider extends OpenAIProvider {
  readonly id = 'codex' as const;
  private readonly codexLogger = logger.createModuleLogger('llm-provider-codex');
  private readonly aiConfig: AIConfig;

  constructor(aiConfig: AIConfig) {
    super(aiConfig, {
      id: 'codex',
      apiKey: aiConfig.codex_access_token || process.env.CODEX_OAUTH_ACCESS_TOKEN || '',
      baseUrl: aiConfig.codex_base_url || process.env.CODEX_BASE_URL || 'https://chatgpt.com/backend-api',
      responsesPath: aiConfig.codex_responses_path || process.env.CODEX_RESPONSES_PATH || '/codex/responses',
      defaultHeaders: {
        Origin: 'https://chatgpt.com',
        Referer: 'https://chatgpt.com/',
        originator: 'pi',
        'OpenAI-Beta': 'responses=experimental'
      }
    });
    this.aiConfig = aiConfig;
  }

  protected override async resolveApiKey(): Promise<string> {
    const { credential } = await this.resolveCredential();
    if (!credential?.access) {
      throw new Error(
        'Missing Codex OAuth access token. Set CODEX_OAUTH_ACCESS_TOKEN / CODEX_OAUTH_REFRESH_TOKEN or provide a Codex OAuth credentials file.'
      );
    }

    return credential.access;
  }

  protected override buildResponsesPayload(
    request: any,
    providerConfig?: UnifiedLLMConfig
  ): Record<string, any> {
    const instructions = request.instructions || this.resolveInstructions(request, providerConfig);
    const payload: Record<string, any> = {
      model: request.model,
      store: request.store ?? false,
      stream: true,
      instructions: instructions || 'You are a helpful assistant.',
      input: this.buildCodexInput(request),
      text: {
        verbosity: this.resolveTextVerbosity(providerConfig)
      },
      include: ['reasoning.encrypted_content'],
      parallel_tool_calls: true
    };

    if (request.temperature !== undefined) {
      payload.temperature = request.temperature;
    }
    if (request.top_p !== undefined) {
      payload.top_p = request.top_p;
    }
    if (Array.isArray(request.stop) && request.stop.length > 0) {
      payload.stop = request.stop;
    }

    const promptCacheKey = request.prompt_cache_key || this.resolvePromptCacheKey(providerConfig);
    if (promptCacheKey) {
      payload.prompt_cache_key = promptCacheKey;
    }

    if (Array.isArray(request.tools) && request.tools.length > 0) {
      payload.tools = request.tools.map((tool: any) => ({
        type: 'function',
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters || { type: 'object', properties: {} },
        strict: null
      }));
      payload.tool_choice = request.tool_choice;
    }

    const providerSpecific = providerConfig?.model?.providerSpecific || {};
    const reasoningEffort =
      providerSpecific.reasoningEffort ||
      request?.reasoning?.effort;
    if (typeof reasoningEffort === 'string') {
      payload.reasoning = {
        effort: this.normalizeReasoningEffort(request.model, reasoningEffort),
        summary: providerSpecific.reasoningSummary || 'auto'
      };
    }

    return payload;
  }

  protected override async postResponses(
    baseUrl: string,
    responsesPath: string,
    payload: Record<string, any>,
    apiKey: string,
    timeoutMs?: number
  ): Promise<any> {
    const accountId = this.extractAccountId(apiKey);

    try {
      return await this.fetchAndAssembleCodexResponse(
        baseUrl,
        responsesPath,
        payload,
        apiKey,
        accountId,
        timeoutMs
      );
    } catch (error: any) {
      const status = error?.response?.status || error?.status;
      if (status !== 401 && status !== 403) {
        throw error;
      }

      const { credential } = await this.resolveCredential(true);
      if (!credential?.access || credential.access === apiKey) {
        throw error;
      }

      this.codexLogger.warn('Retrying Codex request with refreshed OAuth token', {
        status
      });

      return await this.fetchAndAssembleCodexResponse(
        baseUrl,
        responsesPath,
        payload,
        credential.access,
        this.extractAccountId(credential.access),
        timeoutMs
      );
    }
  }

  private async fetchAndAssembleCodexResponse(
    baseUrl: string,
    responsesPath: string,
    payload: Record<string, any>,
    apiKey: string,
    accountId: string | null,
    timeoutMs?: number
  ): Promise<any> {
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
    const normalizedPath = responsesPath.startsWith('/') ? responsesPath : `/${responsesPath}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs || 30000);

    try {
      const response = await fetch(`${normalizedBaseUrl}${normalizedPath}`, {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify(payload),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'User-Agent': this.buildUserAgent(),
          ...(accountId ? { 'chatgpt-account-id': accountId } : {}),
          ...this.defaultHeaders
        }
      });

      if (!response.ok) {
        const errorData = await response.text().catch(() => '');
        const error = new Error(
          `Codex API error (${response.status} ${response.statusText}): ${errorData}`
        ) as Error & {
          status?: number;
          response?: {
            status: number;
            data: any;
          };
        };
        error.status = response.status;
        error.response = {
          status: response.status,
          data: this.tryParseJson(errorData)
        };
        throw error;
      }

      const bodyText = await response.text();
      return this.parseCodexSsePayload(bodyText);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private parseCodexSsePayload(payload: string): any {
    const events = payload
      .split(/\r?\n\r?\n/)
      .flatMap((block) =>
        block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .filter((line) => line.length > 0 && line !== '[DONE]')
      )
      .map((line) => this.tryParseJson(line))
      .filter(Boolean);

    const outputItems: any[] = [];
    const functionCalls = new Map<string, any>();
    let outputText = '';
    let completedResponse: any = {};

    for (const event of events) {
      const type = typeof event?.type === 'string' ? event.type : '';
      if (!type) {
        continue;
      }

      if (type === 'error') {
        throw new Error(event?.message || event?.code || 'Codex SSE error');
      }
      if (type === 'response.failed') {
        throw new Error(event?.response?.error?.message || 'Codex response failed');
      }
      if (type === 'response.output_text.delta' && typeof event?.delta === 'string') {
        outputText += event.delta;
        continue;
      }
      if (type === 'response.function_call_arguments.done' && event?.item?.call_id) {
        functionCalls.set(event.item.call_id, {
          type: 'function_call',
          call_id: event.item.call_id,
          name: event.item.name,
          arguments: event.item.arguments || '{}'
        });
        continue;
      }
      if (type === 'response.output_item.done' && event?.item) {
        const normalized = this.normalizeCodexOutputItem(event.item);
        if (normalized) {
          outputItems.push(normalized);
        }
        continue;
      }
      if (type === 'response.done' || type === 'response.completed' || type === 'response.incomplete') {
        completedResponse = event?.response || {};
      }
    }

    for (const functionCall of functionCalls.values()) {
      const exists = outputItems.some(
        (item) => item?.type === 'function_call' && item?.call_id === functionCall.call_id
      );
      if (!exists) {
        outputItems.push(functionCall);
      }
    }

    const messageText = outputItems
      .filter((item) => item?.type === 'message')
      .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
      .filter((part) => part?.type === 'output_text' && typeof part?.text === 'string')
      .map((part) => part.text)
      .join('');

    const finalText = messageText || outputText;
    if (finalText && !outputItems.some((item) => item?.type === 'message')) {
      outputItems.unshift({
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: finalText }]
      });
    }

    return {
      ...completedResponse,
      status: completedResponse?.status || 'completed',
      output_text: finalText,
      output: outputItems,
      usage: completedResponse?.usage || {}
    };
  }

  private buildCodexInput(request: any): any[] {
    const input = openResponseInputToOpenAIInput(request?.input || [], undefined);
    return Array.isArray(input)
      ? input.filter((item: any) => item?.role !== 'system')
      : [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: String(input || '') }] }];
  }

  private buildUserAgent(): string {
    return `pi (${os.platform()} ${os.release()}; ${os.arch()})`;
  }

  private resolveTextVerbosity(providerConfig?: UnifiedLLMConfig): 'low' | 'medium' | 'high' {
    const verbosity = providerConfig?.model?.providerSpecific?.textVerbosity;
    return verbosity === 'low' || verbosity === 'high' ? verbosity : 'medium';
  }

  private resolvePromptCacheKey(providerConfig?: UnifiedLLMConfig): string | undefined {
    const key = providerConfig?.model?.providerSpecific?.promptCacheKey;
    return typeof key === 'string' && key.trim().length > 0 ? key.trim() : undefined;
  }

  private normalizeReasoningEffort(modelName: string, effort: string): string {
    const normalizedModel = modelName.includes('/') ? modelName.split('/').pop() || modelName : modelName;
    if (/^gpt-5\.[234]/.test(normalizedModel) && effort === 'minimal') {
      return 'low';
    }
    if (normalizedModel === 'gpt-5.1' && effort === 'xhigh') {
      return 'high';
    }
    if (normalizedModel === 'gpt-5.1-codex-mini') {
      return effort === 'high' || effort === 'xhigh' ? 'high' : 'medium';
    }
    return effort;
  }

  private normalizeCodexOutputItem(item: any): any | null {
    if (!item || typeof item !== 'object') {
      return null;
    }

    if (item.type === 'message') {
      const content = Array.isArray(item.content)
        ? item.content
            .filter((part: any) => part?.type === 'output_text' && typeof part?.text === 'string')
            .map((part: any) => ({ type: 'output_text', text: part.text }))
        : [];
      return {
        type: 'message',
        role: item.role || 'assistant',
        status: item.status || 'completed',
        content
      };
    }

    if (item.type === 'function_call' && item.call_id) {
      return {
        type: 'function_call',
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments || '{}'
      };
    }

    return null;
  }

  private tryParseJson(value: string): any {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private resolveInstructions(request: any, providerConfig?: UnifiedLLMConfig): string | undefined {
    const directInstruction = this.normalizeInstruction(
      request?.systemInstruction || providerConfig?.context?.systemInstruction
    );
    if (directInstruction) {
      return directInstruction;
    }

    const systemParts = Array.isArray(request?.contents)
      ? request.contents
          .filter((item: any) => item?.role === 'system')
          .flatMap((item: any) => (Array.isArray(item?.parts) ? item.parts : []))
          .map((part: any) => (typeof part?.text === 'string' ? part.text.trim() : ''))
          .filter(Boolean)
      : [];

    if (systemParts.length > 0) {
      return systemParts.join('\n');
    }

    return undefined;
  }

  private normalizeInstruction(value: any): string | undefined {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    if (value && typeof value === 'object' && Array.isArray(value.parts)) {
      const text = value.parts
        .map((part: any) => (typeof part?.text === 'string' ? part.text.trim() : ''))
        .filter(Boolean)
        .join('\n');

      return text || undefined;
    }

    return undefined;
  }

  private async resolveCredential(forceRefresh = false): Promise<{
    credential: NormalizedOAuthCredential | null;
    source?: OAuthCredentialSource;
  }> {
    const resolved = await loadOAuthCredential({
      envAccessToken: this.aiConfig.codex_access_token || process.env.CODEX_OAUTH_ACCESS_TOKEN,
      envRefreshToken: this.aiConfig.codex_refresh_token || process.env.CODEX_OAUTH_REFRESH_TOKEN,
      envExpiresAt: this.aiConfig.codex_expires_at || process.env.CODEX_OAUTH_EXPIRES_AT,
      envAccountId: this.aiConfig.codex_account_id || process.env.CODEX_ACCOUNT_ID,
      explicitPath: this.aiConfig.codex_oauth_path || process.env.CODEX_OAUTH_PATH,
      fallbackPaths: [
        path.join(os.homedir(), '.openclaw', 'credentials', 'oauth.json'),
        path.join(os.homedir(), '.codex', 'auth.json')
      ],
      providerKey: 'openai-codex'
    });

    const credential = resolved.credential;
    if (!credential) {
      return resolved;
    }

    const needsRefresh = forceRefresh || !credential.access || isOAuthCredentialExpired(credential);
    if (needsRefresh && credential.refresh) {
      return {
        credential: await this.refreshCredential(credential, resolved.source),
        source: resolved.source
      };
    }

    if (!credential.accountId && credential.access) {
      credential.accountId = this.extractAccountId(credential.access) || undefined;
    }

    return resolved;
  }

  private async refreshCredential(
    credential: NormalizedOAuthCredential,
    source?: OAuthCredentialSource
  ): Promise<NormalizedOAuthCredential> {
    if (!credential.refresh) {
      throw new Error('Codex OAuth refresh token is missing.');
    }

    const response = await fetch(CODEX_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: credential.refresh,
        client_id: CODEX_CLIENT_ID
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Codex OAuth token refresh failed: ${errorText}`);
    }

    const payload = await response.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!payload.access_token || typeof payload.expires_in !== 'number') {
      throw new Error('Codex OAuth token refresh returned an invalid payload.');
    }

    const refreshed: NormalizedOAuthCredential = {
      access: payload.access_token,
      refresh: payload.refresh_token || credential.refresh,
      expires: Date.now() + (payload.expires_in * 1000),
      accountId: this.extractAccountId(payload.access_token) || credential.accountId,
      email: credential.email
    };

    await persistOAuthCredential(source, refreshed);
    return refreshed;
  }

  private extractAccountId(accessToken: string): string | null {
    try {
      const payload = this.decodeJwtPayload(accessToken);
      const auth = payload?.[CODEX_JWT_CLAIM_PATH];
      const accountId = auth?.chatgpt_account_id;
      return typeof accountId === 'string' && accountId.trim().length > 0 ? accountId : null;
    } catch (error) {
      this.codexLogger.debug('Failed to extract Codex account id from access token', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  private decodeJwtPayload(token: string): Record<string, any> | null {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) {
      return null;
    }

    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    const decoded = Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');

    try {
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }
}

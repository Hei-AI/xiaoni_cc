import fs from 'fs';
import { delimiter, dirname, join } from 'path';
import os from 'os';
import { AIConfig, UnifiedLLMConfig } from '../../types';
import { logger } from '../../utils/logger';
import {
  cloneValue,
  geminiRequestToOpenResponseRequest,
  openResponseInputToGeminiRequest,
  toOpenResponseUsage
} from './helpers';
import {
  isOAuthCredentialExpired,
  loadOAuthCredential,
  persistOAuthCredential,
  type NormalizedOAuthCredential,
  type OAuthCredentialSource
} from './oauth-credentials';
import {
  LLMProvider,
  LLMProviderContentRequest,
  LLMProviderContentResult,
  LLMProviderTextRequest,
  LLMProviderTextResult
} from './types';

const GEMINI_CLI_DEFAULT_BASE_URL = 'https://cloudcode-pa.googleapis.com';
const GEMINI_CLI_STREAM_PATH = '/v1internal:streamGenerateContent?alt=sse';
const GEMINI_CLI_LOAD_CODE_ASSIST_PATH = '/v1internal:loadCodeAssist';
const GEMINI_CLI_ONBOARD_USER_PATH = '/v1internal:onboardUser';
const GEMINI_CLI_VPC_SC_REASON = 'SECURITY_POLICY_VIOLATED';
const GEMINI_CLI_TIER_FREE = 'free-tier';
const GEMINI_CLI_TIER_LEGACY = 'legacy-tier';
const GEMINI_CLI_TIER_STANDARD = 'standard-tier';
const GEMINI_CLI_CLIENT_ID_KEYS = [
  'OPENCLAW_GEMINI_OAUTH_CLIENT_ID',
  'GEMINI_CLI_OAUTH_CLIENT_ID'
];
const GEMINI_CLI_CLIENT_SECRET_KEYS = [
  'OPENCLAW_GEMINI_OAUTH_CLIENT_SECRET',
  'GEMINI_CLI_OAUTH_CLIENT_SECRET'
];

export class GeminiCliProvider implements LLMProvider {
  readonly id = 'google-gemini-cli' as const;
  private readonly aiConfig: AIConfig;
  private readonly moduleLogger = logger.createModuleLogger('llm-provider-gemini-cli');
  private discoveredProjectId?: string;
  private projectDiscoveryPromise?: Promise<string | undefined>;

  constructor(aiConfig: AIConfig) {
    this.aiConfig = aiConfig;
  }

  async generateText(input: LLMProviderTextRequest): Promise<LLMProviderTextResult> {
    const contentResult = await this.generateContent({
      modelName: input.config.model.name,
      providerConfig: input.config,
      request: this.buildContentRequestFromPrompt(input.prompt, input.config),
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
    const { credential, source } = await this.resolveCredential();
    if (!credential?.access || !credential.projectId) {
      throw new Error('Missing Gemini CLI OAuth credentials or projectId.');
    }

    const providerSpecific = input.providerConfig?.model?.providerSpecific || {};
    const baseUrl =
      (typeof providerSpecific.baseUrl === 'string' && providerSpecific.baseUrl.trim()) ||
      this.aiConfig.gemini_cli_base_url ||
      process.env.GEMINI_CLI_BASE_URL ||
      GEMINI_CLI_DEFAULT_BASE_URL;
    const streamPath =
      (typeof providerSpecific.streamPath === 'string' && providerSpecific.streamPath.trim()) ||
      (typeof providerSpecific.responsesPath === 'string' && providerSpecific.responsesPath.trim()) ||
      this.aiConfig.gemini_cli_stream_path ||
      process.env.GEMINI_CLI_STREAM_PATH ||
      GEMINI_CLI_STREAM_PATH;

    const payload = this.buildRequestPayload(input, credential.projectId);
    const events = await this.executeStreamRequest(baseUrl, streamPath, payload, credential, source);
    const assembled = this.assembleResponse(events);
    const usageMetadata = assembled.usageMetadata || {};
    const inputTokens = usageMetadata.promptTokenCount ?? 0;
    const outputTokens = usageMetadata.candidatesTokenCount ?? Math.ceil(assembled.text.length / 4);
    const processingTimeMs = Date.now() - callStartTime;

    return {
      provider: this.id,
      modelName: input.modelName,
      text: assembled.text,
      response: {
        status: 'completed',
        model: input.modelName,
        output_text: assembled.text,
        output: this.partsToOpenResponseOutput(assembled.parts),
        usage: toOpenResponseUsage({
          inputTokens,
          outputTokens,
          totalTokens: usageMetadata.totalTokenCount
        })
      },
      rawResponse: {
        events: cloneValue(events)
      },
      usage: {
        inputTokens,
        outputTokens,
        processingTimeMs
      }
    };
  }

  private buildContentRequestFromPrompt(prompt: string, config: UnifiedLLMConfig) {
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
        topK: config.generation.topK,
        maxOutputTokens: config.generation.maxOutputTokens,
        stopSequences: config.generation.stopSequences
      },
      toolConfig: {
        functionCallingConfig: config.tools?.functionCalling
      },
      systemInstruction: config.context.systemInstruction
    }, config.model.name, config);
  }

  private buildRequestPayload(input: LLMProviderContentRequest, projectId: string): Record<string, any> {
    const geminiRequest = openResponseInputToGeminiRequest(input.request);
    const requestPayload: Record<string, any> = {
      contents: geminiRequest.contents || []
    };

    if (input.request.temperature !== undefined || input.request.top_p !== undefined || input.request.max_output_tokens !== undefined || input.request.stop) {
      requestPayload.generationConfig = {
        ...(input.request.temperature !== undefined ? { temperature: input.request.temperature } : {}),
        ...(input.request.top_p !== undefined ? { topP: input.request.top_p } : {}),
        ...(input.request.max_output_tokens !== undefined ? { maxOutputTokens: input.request.max_output_tokens } : {}),
        ...(Array.isArray(input.request.stop) ? { stopSequences: input.request.stop } : {})
      };
    }
    if (input.request.tools) {
      requestPayload.tools = input.request.tools.map((tool) => ({
        functionDeclarations: [{
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters || { type: 'object', properties: {} }
        }]
      }));
    }
    if (input.request.tool_choice) {
      requestPayload.toolConfig = {
        functionCallingConfig: {
          mode: input.request.tool_choice === 'required'
            ? 'ANY'
            : input.request.tool_choice === 'none'
              ? 'NONE'
              : 'AUTO'
        }
      };
    }
    if (geminiRequest.systemInstruction) {
      requestPayload.systemInstruction = geminiRequest.systemInstruction;
    }

    return {
      project: projectId,
      model: input.modelName,
      request: requestPayload,
      requestId: `pi-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      userAgent: 'pi-coding-agent'
    };
  }

  private async executeStreamRequest(
    baseUrl: string,
    streamPath: string,
    payload: Record<string, any>,
    credential: NormalizedOAuthCredential,
    source?: OAuthCredentialSource
  ): Promise<any[]> {
    try {
      return await this.fetchEvents(baseUrl, streamPath, payload, credential.access!);
    } catch (error: any) {
      const status = error?.response?.status || error?.status;
      if (status === 403 && this.shouldRetryProjectDiscovery(error)) {
        const rediscoveredProjectId = await this.ensureProjectId(credential, source, undefined, true);
        if (rediscoveredProjectId && rediscoveredProjectId !== payload.project) {
          return await this.fetchEvents(
            baseUrl,
            streamPath,
            {
              ...payload,
              project: rediscoveredProjectId
            },
            credential.access!
          );
        }
      }

      if ((status === 401 || status === 403) && credential.refresh) {
        const refreshed = await this.refreshCredential(credential, source);
        const refreshedProjectId = await this.ensureProjectId(
          refreshed,
          source,
          credential.projectId || payload.project
        );
        return await this.fetchEvents(
          baseUrl,
          streamPath,
          {
            ...payload,
            project: refreshedProjectId || payload.project
          },
          refreshed.access!
        );
      }
      throw error;
    }
  }

  private async fetchEvents(
    baseUrl: string,
    streamPath: string,
    payload: Record<string, any>,
    accessToken: string
  ): Promise<any[]> {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${streamPath}`, {
      method: 'POST',
      headers: {
        ...this.buildCodeAssistHeaders(accessToken),
        Accept: 'text/event-stream',
        'Client-Metadata': JSON.stringify({
          ideType: 'IDE_UNSPECIFIED',
          platform: 'PLATFORM_UNSPECIFIED',
          pluginType: 'GEMINI'
        })
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      const error = new Error(
        `Gemini CLI API error (${response.status} ${response.statusText}): ${errorText}`
      ) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    const bodyText = await response.text();
    return this.parseSseEvents(bodyText);
  }

  private parseSseEvents(payload: string): any[] {
    const events: any[] = [];
    const blocks = payload.split(/\r?\n\r?\n/);

    for (const block of blocks) {
      const dataLines = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);

      if (dataLines.length === 0) {
        continue;
      }

      const data = dataLines.join('\n');
      if (data === '[DONE]') {
        continue;
      }

      try {
        events.push(JSON.parse(data));
      } catch (error) {
        this.moduleLogger.debug('Failed to parse Gemini CLI SSE event', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return events;
  }

  private shouldRetryProjectDiscovery(error: any): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    return /SERVICE_DISABLED|cloudaicompanion\.googleapis\.com|Cloud Code Assist/i.test(message);
  }

  private buildCodeAssistHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'google-api-nodejs-client/9.15.1',
      'X-Goog-Api-Client': `gl-node/${process.versions.node}`
    };
  }

  private assembleResponse(events: any[]): {
    text: string;
    parts: any[];
    usageMetadata?: Record<string, any>;
  } {
    const parts: any[] = [];
    let text = '';
    let usageMetadata: Record<string, any> | undefined;

    for (const event of events) {
      const payload = event?.value && typeof event.value === 'object'
        ? event.value
        : event?.response && typeof event.response === 'object'
          ? event.response
          : event;

      if (payload?.usageMetadata && typeof payload.usageMetadata === 'object') {
        usageMetadata = payload.usageMetadata;
      }

      const eventParts = payload?.candidates?.[0]?.content?.parts;
      if (!Array.isArray(eventParts)) {
        const functionCalls = Array.isArray(payload?.functionCalls) ? payload.functionCalls : [];
        for (const functionCall of functionCalls) {
          if (functionCall?.name) {
            parts.push({
              functionCall: {
                name: functionCall.name,
                args: functionCall.args || {}
              }
            });
          }
        }
        continue;
      }

      for (const part of eventParts) {
        if (typeof part?.text === 'string') {
          parts.push({ text: part.text });
          text += part.text;
        } else if (part?.functionCall?.name) {
          parts.push({
            functionCall: {
              name: part.functionCall.name,
              args: part.functionCall.args || {}
            }
          });
        }
      }
    }

    return { text, parts, usageMetadata };
  }

  private partsToOpenResponseOutput(parts: any[]) {
    const output: any[] = [];
    const textParts = parts
      .filter((part: any) => typeof part?.text === 'string')
      .map((part: any) => ({ type: 'output_text', text: part.text }));

    if (textParts.length > 0) {
      output.push({
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: textParts
      });
    }

    for (const part of parts) {
      if (part?.functionCall?.name) {
        output.push({
          type: 'function_call',
          call_id: part.functionCall.name,
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {}),
          status: 'completed'
        });
      }
    }

    return output;
  }

  private async resolveCredential(): Promise<{
    credential: NormalizedOAuthCredential | null;
    source?: OAuthCredentialSource;
  }> {
    const resolved = await loadOAuthCredential({
      envAccessToken: this.aiConfig.gemini_cli_access_token || process.env.GEMINI_CLI_ACCESS_TOKEN,
      envRefreshToken: this.aiConfig.gemini_cli_refresh_token || process.env.GEMINI_CLI_REFRESH_TOKEN,
      envExpiresAt: this.aiConfig.gemini_cli_expires_at || process.env.GEMINI_CLI_EXPIRES_AT,
      envProjectId: this.aiConfig.gemini_cli_project_id || process.env.GEMINI_CLI_PROJECT_ID,
      explicitPath: this.aiConfig.gemini_cli_oauth_path || process.env.GEMINI_CLI_OAUTH_PATH,
      fallbackPaths: [
        join(os.homedir(), '.openclaw', 'credentials', 'oauth.json'),
        join(os.homedir(), '.gemini', 'oauth_creds.json')
      ],
      providerKey: 'google-gemini-cli'
    });

    const credential = resolved.credential;
    if (!credential) {
      return resolved;
    }

    const projectHint = await this.resolveProjectIdHint();
    credential.projectId ||= projectHint;

    if ((!credential.access || isOAuthCredentialExpired(credential)) && credential.refresh) {
      const refreshed = await this.refreshCredential(credential, resolved.source);
      refreshed.projectId = await this.ensureProjectId(refreshed, resolved.source, projectHint);
      return { credential: refreshed, source: resolved.source };
    }

    credential.projectId = await this.ensureProjectId(credential, resolved.source, projectHint);
    return resolved;
  }

  private resolveExplicitProjectId(): string | undefined {
    const explicit =
      this.aiConfig.gemini_cli_project_id ||
      process.env.GEMINI_CLI_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT_ID ||
      process.env.GCLOUD_PROJECT;

    if (typeof explicit === 'string' && explicit.trim().length > 0) {
      return explicit.trim();
    }

    return undefined;
  }

  private async resolveProjectIdHint(): Promise<string | undefined> {
    const explicit = this.resolveExplicitProjectId();
    if (explicit) {
      return explicit;
    }

    const projectsPath = join(os.homedir(), '.gemini', 'projects.json');

    try {
      const raw = JSON.parse(fs.readFileSync(projectsPath, 'utf8'));
      const projects = raw?.projects;
      if (!projects || typeof projects !== 'object') {
        return undefined;
      }

      const cwd = process.cwd();
      const candidates = Object.entries(projects)
        .filter(([projectPath, projectId]) => {
          return (
            typeof projectPath === 'string' &&
            projectPath.length > 0 &&
            typeof projectId === 'string' &&
            projectId.trim().length > 0 &&
            (cwd === projectPath || cwd.startsWith(`${projectPath}${process.platform === 'win32' ? '\\' : '/'}`))
          );
        })
        .sort((a, b) => b[0].length - a[0].length);

      if (candidates.length > 0) {
        return candidates[0][1] as string;
      }

      const firstProjectId = Object.values(projects).find(
        (projectId): projectId is string => typeof projectId === 'string' && projectId.trim().length > 0
      );

      return firstProjectId;
    } catch (error) {
      this.moduleLogger.debug('Failed to resolve Gemini CLI project id from ~/.gemini/projects.json', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return undefined;
    }
  }

  private async ensureProjectId(
    credential: NormalizedOAuthCredential,
    source?: OAuthCredentialSource,
    projectHint?: string,
    forceRefresh = false
  ): Promise<string | undefined> {
    if (!credential.access) {
      return credential.projectId || projectHint;
    }

    if (this.discoveredProjectId && !forceRefresh) {
      return this.discoveredProjectId;
    }

    if (!this.projectDiscoveryPromise || forceRefresh) {
      this.projectDiscoveryPromise = this.discoverProject(credential.access, projectHint)
        .then(async (projectId) => {
          if (projectId) {
            this.discoveredProjectId = projectId;
            if (credential.projectId !== projectId) {
              credential.projectId = projectId;
              await persistOAuthCredential(source, credential);
            }
          }
          return projectId;
        })
        .catch((error) => {
          this.projectDiscoveryPromise = undefined;
          if (credential.projectId || projectHint) {
            this.moduleLogger.warn('Gemini CLI project discovery failed, falling back to cached project id', {
              error: error instanceof Error ? error.message : 'Unknown error',
              projectId: credential.projectId || projectHint
            });
            return credential.projectId || projectHint;
          }
          throw error;
        });
    }

    return this.projectDiscoveryPromise;
  }

  private async discoverProject(
    accessToken: string,
    projectHint?: string
  ): Promise<string | undefined> {
    const explicitProjectId = this.resolveExplicitProjectId();
    const loadPayload = await this.loadCodeAssist(accessToken, explicitProjectId);

    if (loadPayload.currentTier) {
      if (typeof loadPayload.cloudaicompanionProject === 'string' && loadPayload.cloudaicompanionProject.trim()) {
        return loadPayload.cloudaicompanionProject.trim();
      }
      if (explicitProjectId) {
        return explicitProjectId;
      }
      return projectHint;
    }

    const tierId = this.getDefaultTier(loadPayload.allowedTiers)?.id || GEMINI_CLI_TIER_FREE;
    if (tierId !== GEMINI_CLI_TIER_FREE && !explicitProjectId) {
      throw new Error(
        'This account requires setting GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID before using Gemini CLI OAuth.'
      );
    }

    const onboardPayload: Record<string, any> = {
      tierId,
      metadata: {
        ideType: 'IDE_UNSPECIFIED',
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI'
      }
    };

    if (tierId !== GEMINI_CLI_TIER_FREE && explicitProjectId) {
      onboardPayload.cloudaicompanionProject = explicitProjectId;
      onboardPayload.metadata.duetProject = explicitProjectId;
    }

    const onboardResponse = await fetch(
      `${GEMINI_CLI_DEFAULT_BASE_URL}${GEMINI_CLI_ONBOARD_USER_PATH}`,
      {
        method: 'POST',
        headers: this.buildCodeAssistHeaders(accessToken),
        body: JSON.stringify(onboardPayload)
      }
    );

    if (!onboardResponse.ok) {
      const errorText = await onboardResponse.text().catch(() => '');
      throw new Error(
        `onboardUser failed: ${onboardResponse.status} ${onboardResponse.statusText}: ${errorText}`
      );
    }

    let operation = await onboardResponse.json() as {
      name?: string;
      done?: boolean;
      response?: {
        cloudaicompanionProject?: { id?: string };
      };
    };

    if (!operation.done && operation.name) {
      operation = await this.pollOperation(operation.name, accessToken);
    }

    const onboardedProjectId = operation.response?.cloudaicompanionProject?.id;
    if (typeof onboardedProjectId === 'string' && onboardedProjectId.trim()) {
      return onboardedProjectId.trim();
    }

    return explicitProjectId || projectHint;
  }

  private async loadCodeAssist(accessToken: string, explicitProjectId?: string): Promise<{
    cloudaicompanionProject?: string;
    currentTier?: { id?: string };
    allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
  }> {
    const response = await fetch(
      `${GEMINI_CLI_DEFAULT_BASE_URL}${GEMINI_CLI_LOAD_CODE_ASSIST_PATH}`,
      {
        method: 'POST',
        headers: this.buildCodeAssistHeaders(accessToken),
        body: JSON.stringify({
          ...(explicitProjectId ? { cloudaicompanionProject: explicitProjectId } : {}),
          metadata: {
            ideType: 'IDE_UNSPECIFIED',
            platform: 'PLATFORM_UNSPECIFIED',
            pluginType: 'GEMINI',
            ...(explicitProjectId ? { duetProject: explicitProjectId } : {})
          }
        })
      }
    );

    if (!response.ok) {
      let errorPayload: any;
      try {
        errorPayload = await response.clone().json();
      } catch {
        errorPayload = undefined;
      }

      if (this.isVpcScAffectedUser(errorPayload)) {
        return {
          currentTier: {
            id: GEMINI_CLI_TIER_STANDARD
          }
        };
      }

      const errorText = await response.text().catch(() => '');
      throw new Error(
        `loadCodeAssist failed: ${response.status} ${response.statusText}: ${errorText}`
      );
    }

    const payload = await response.json() as {
      cloudaicompanionProject?: string | { id?: string };
      currentTier?: { id?: string };
      allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
    };

    return {
      ...payload,
      cloudaicompanionProject:
        typeof payload.cloudaicompanionProject === 'string'
          ? payload.cloudaicompanionProject
          : payload.cloudaicompanionProject?.id
    };
  }

  private async pollOperation(operationName: string, accessToken: string): Promise<{
    name?: string;
    done?: boolean;
    response?: {
      cloudaicompanionProject?: { id?: string };
    };
  }> {
    let attempt = 0;

    while (true) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      const response = await fetch(
        `${GEMINI_CLI_DEFAULT_BASE_URL}/v1internal/${operationName}`,
        {
          method: 'GET',
          headers: this.buildCodeAssistHeaders(accessToken)
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to poll operation: ${response.status} ${response.statusText}`);
      }

      const payload = await response.json() as {
        done?: boolean;
        response?: {
          cloudaicompanionProject?: { id?: string };
        };
      };

      if (payload.done) {
        return payload;
      }

      attempt += 1;
    }
  }

  private getDefaultTier(allowedTiers?: Array<{ id?: string; isDefault?: boolean }>): { id?: string } {
    if (!allowedTiers || allowedTiers.length === 0) {
      return { id: GEMINI_CLI_TIER_LEGACY };
    }

    return allowedTiers.find((tier) => tier.isDefault) || { id: GEMINI_CLI_TIER_LEGACY };
  }

  private isVpcScAffectedUser(payload: any): boolean {
    const details = payload?.error?.details;
    return Array.isArray(details) && details.some((detail) => detail?.reason === GEMINI_CLI_VPC_SC_REASON);
  }

  private async refreshCredential(
    credential: NormalizedOAuthCredential,
    source?: OAuthCredentialSource
  ): Promise<NormalizedOAuthCredential> {
    if (!credential.refresh) {
      throw new Error('Gemini CLI OAuth refresh token is missing.');
    }

    const { clientId, clientSecret } = this.resolveOAuthClientConfig();
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret || '',
        refresh_token: credential.refresh,
        grant_type: 'refresh_token'
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Google Cloud token refresh failed: ${errorText}`);
    }

    const payload = await response.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!payload.access_token || typeof payload.expires_in !== 'number') {
      throw new Error('Google Cloud token refresh returned an invalid payload.');
    }

    const refreshed: NormalizedOAuthCredential = {
      access: payload.access_token,
      refresh: payload.refresh_token || credential.refresh,
      expires: Date.now() + (payload.expires_in * 1000) - (5 * 60 * 1000),
      projectId: credential.projectId,
      email: credential.email
    };

    await persistOAuthCredential(source, refreshed);
    return refreshed;
  }

  private resolveOAuthClientConfig(): { clientId: string; clientSecret?: string } {
    const envClientId = this.resolveEnv(GEMINI_CLI_CLIENT_ID_KEYS);
    const envClientSecret = this.resolveEnv(GEMINI_CLI_CLIENT_SECRET_KEYS);

    if (envClientId) {
      return {
        clientId: envClientId,
        clientSecret: envClientSecret
      };
    }

    const extracted = this.extractGeminiCliCredentials();
    if (extracted) {
      return extracted;
    }

    throw new Error(
      'Gemini CLI OAuth client credentials not found. Install gemini-cli or set GEMINI_CLI_OAUTH_CLIENT_ID / GEMINI_CLI_OAUTH_CLIENT_SECRET.'
    );
  }

  private resolveEnv(keys: string[]): string | undefined {
    for (const key of keys) {
      const value = process.env[key]?.trim();
      if (value) {
        return value;
      }
    }
    return undefined;
  }

  private extractGeminiCliCredentials(): { clientId: string; clientSecret: string } | null {
    try {
      const geminiPath = this.findInPath('gemini');
      if (!geminiPath) {
        return null;
      }

      const resolvedPath = fs.realpathSync(geminiPath);
      const geminiCliDirs = this.resolveGeminiCliDirs(geminiPath, resolvedPath);

      for (const geminiCliDir of geminiCliDirs) {
        const searchPaths = [
          join(
            geminiCliDir,
            'node_modules',
            '@google',
            'gemini-cli-core',
            'dist',
            'src',
            'code_assist',
            'oauth2.js'
          ),
          join(
            geminiCliDir,
            'node_modules',
            '@google',
            'gemini-cli-core',
            'dist',
            'code_assist',
            'oauth2.js'
          )
        ];

        for (const candidate of searchPaths) {
          if (fs.existsSync(candidate)) {
            const content = fs.readFileSync(candidate, 'utf8');
            const resolved = this.extractClientIdAndSecret(content);
            if (resolved) {
              return resolved;
            }
          }
        }
      }
    } catch (error) {
      this.moduleLogger.debug('Failed to extract Gemini CLI OAuth client credentials', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    return null;
  }

  private resolveGeminiCliDirs(geminiPath: string, resolvedPath: string): string[] {
    const binDir = dirname(geminiPath);
    const candidates = [
      dirname(dirname(resolvedPath)),
      join(dirname(resolvedPath), 'node_modules', '@google', 'gemini-cli'),
      join(binDir, 'node_modules', '@google', 'gemini-cli'),
      join(dirname(binDir), 'node_modules', '@google', 'gemini-cli'),
      join(dirname(binDir), 'lib', 'node_modules', '@google', 'gemini-cli')
    ];

    return Array.from(new Set(candidates));
  }

  private findInPath(name: string): string | null {
    const exts = process.platform === 'win32' ? ['.cmd', '.bat', '.exe', ''] : [''];
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
      for (const ext of exts) {
        const candidate = join(dir, name + ext);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }

  private extractClientIdAndSecret(content: string): { clientId: string; clientSecret: string } | null {
    const idMatch = content.match(/(\d+-[a-z0-9]+\.apps\.googleusercontent\.com)/i);
    const secretMatch = content.match(/(GOCSPX-[A-Za-z0-9_-]+)/);

    if (!idMatch || !secretMatch) {
      return null;
    }

    return {
      clientId: idMatch[1],
      clientSecret: secretMatch[1]
    };
  }
}

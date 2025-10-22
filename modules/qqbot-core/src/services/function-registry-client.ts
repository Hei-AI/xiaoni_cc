import axios, { AxiosInstance } from 'axios';
import { LRUCache } from 'lru-cache';
import { FunctionRegistryConfig } from '../types';
import { logger } from '../utils/logger';

export type RegistryFunctionCallingMode = 'AUTO' | 'ANY' | 'NONE';
export type RegistryFunctionInvokeMethod = 'HTTP' | 'GRPC' | 'INTERNAL';

interface FunctionListResponse {
  items: RegistryFunctionDefinition[];
  total: number;
}

export interface RegistryFunctionDefinition {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  parametersSchema: any;
  sideEffect: boolean;
  expectResponse: boolean;
  category?: string;
  tags?: string[];
  invokeMethod: RegistryFunctionInvokeMethod;
  invokeUrl?: string;
  httpMethod?: string;
  authType: string;
  timeoutMs: number;
  retryPolicy?: Record<string, unknown>;
  executionAdapter?: string;
  managedBySystem: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RegistryFunctionUpsertPayload {
  name: string;
  displayName: string;
  description?: string;
  parametersSchema: any;
  sideEffect: boolean;
  expectResponse: boolean;
  category?: string;
  tags?: string[];
  invokeMethod: RegistryFunctionInvokeMethod;
  invokeUrl?: string;
  httpMethod?: string;
  authType: string;
  timeoutMs: number;
  retryPolicy?: Record<string, unknown>;
  executionAdapter?: string;
  managedBySystem: boolean;
  enabled: boolean;
  createdBy: string;
  updatedBy?: string;
}

export interface PromptFunctionRegistryResponse {
  promptId: string;
  functions: RegistryFunctionDefinition[];
}

export interface FunctionInvokeRequestPayload {
  traceId?: string;
  jobId?: string;
  arguments: Record<string, unknown>;
  context?: Record<string, unknown>;
  requestMode?: RegistryFunctionCallingMode;
}

export interface FunctionInvokeResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  suppressAutoReply?: boolean;
  durationMs?: number;
}

export class FunctionRegistryClient {
  private axios: AxiosInstance;
  private cache: LRUCache<string, PromptFunctionRegistryResponse>;
  private moduleLogger = logger.createModuleLogger('function-registry-client');
  private enabled: boolean;

  constructor(config: FunctionRegistryConfig) {
    this.enabled = config.enabled;

    this.axios = axios.create({
      baseURL: config.base_url,
      timeout: config.timeout_ms,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    this.cache = new LRUCache<string, PromptFunctionRegistryResponse>({
      max: 200,
      ttl: 30 * 1000 // 30 seconds
    });
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public async getFunctionsForPrompt(promptId: string): Promise<PromptFunctionRegistryResponse | null> {
    if (!this.enabled) {
      return null;
    }

    const cacheKey = `prompt:${promptId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.axios.get<PromptFunctionRegistryResponse>(`/prompts/${promptId}/functions`);
      this.cache.set(cacheKey, response.data);
      return response.data;
    } catch (error: any) {
      this.moduleLogger.error('Failed to fetch functions for prompt', {
        promptId,
        error: error?.message
      });
      return null;
    }
  }

  public invalidatePrompt(promptId: string): void {
    const cacheKey = `prompt:${promptId}`;
    this.cache.delete(cacheKey);
  }

  public async invokeFunction(
    functionId: string,
    payload: FunctionInvokeRequestPayload
  ): Promise<FunctionInvokeResult | null> {
    if (!this.enabled) {
      this.moduleLogger.warn('Function registry disabled, skip remote invocation', { functionId });
      return null;
    }

    try {
      const response = await this.axios.post<FunctionInvokeResult>(`/functions/${functionId}/invoke`, payload);
      return response.data;
    } catch (error: any) {
      this.moduleLogger.error('Function invocation failed', {
        functionId,
        error: error?.message
      });
      throw error;
    }
  }

  public async upsertFunctionDefinition(
    payload: RegistryFunctionUpsertPayload
  ): Promise<RegistryFunctionDefinition | null> {
    if (!this.enabled) {
      this.moduleLogger.debug('Function registry disabled, skip definition upsert', {
        name: payload.name
      });
      return null;
    }

    try {
      const existing = await this.findFunctionByName(payload.name);

      if (!existing) {
        const response = await this.axios.post<RegistryFunctionDefinition>('/functions', {
          name: payload.name,
          displayName: payload.displayName,
          description: payload.description,
          parametersSchema: payload.parametersSchema,
          sideEffect: payload.sideEffect,
          expectResponse: payload.expectResponse,
          category: payload.category,
          tags: payload.tags,
          invokeMethod: payload.invokeMethod,
          invokeUrl: payload.invokeUrl,
          httpMethod: payload.httpMethod,
          authType: payload.authType,
          timeoutMs: payload.timeoutMs,
          retryPolicy: payload.retryPolicy,
          executionAdapter: payload.executionAdapter,
          managedBySystem: payload.managedBySystem,
          enabled: payload.enabled,
          createdBy: payload.createdBy
        });
        return response.data;
      }

      const updatePayload = this.cleanupPayload({
        displayName: payload.displayName,
        description: payload.description,
        parametersSchema: payload.parametersSchema,
        sideEffect: payload.sideEffect,
        expectResponse: payload.expectResponse,
        category: payload.category,
        tags: payload.tags,
        invokeMethod: payload.invokeMethod,
        invokeUrl: payload.invokeUrl,
        httpMethod: payload.httpMethod,
        authType: payload.authType,
        timeoutMs: payload.timeoutMs,
        retryPolicy: payload.retryPolicy,
        executionAdapter: payload.executionAdapter,
        managedBySystem: payload.managedBySystem,
        enabled: payload.enabled,
        updatedBy: payload.updatedBy || payload.createdBy
      });

      const response = await this.axios.patch<RegistryFunctionDefinition>(
        `/functions/${existing.id}`,
        updatePayload
      );
      return response.data;
    } catch (error: any) {
      this.moduleLogger.error('Failed to upsert function definition', {
        name: payload.name,
        error: error?.message || error
      });
      throw error;
    }
  }

  private async findFunctionByName(name: string): Promise<RegistryFunctionDefinition | null> {
    try {
      const response = await this.axios.get<FunctionListResponse>('/functions', {
        params: {
          search: name,
          limit: 1,
          page: 1
        }
      });

      const items = response.data?.items || [];
      const match = items.find(item => item.name === name);
      return match ?? null;
    } catch (error: any) {
      this.moduleLogger.error('Failed to find function by name', {
        name,
        error: error?.message
      });
      return null;
    }
  }

  private cleanupPayload(payload: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined)
    );
  }
}

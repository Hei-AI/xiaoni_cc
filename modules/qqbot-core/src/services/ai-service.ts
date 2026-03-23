/**
 * 🔥 简化版AI Service - 纯统一配置架构
 * 移除Legacy配置系统，采用单一现代化配置架构
 */

import {
  HarmCategory,
  HarmBlockThreshold,
  Type,
  type GenerateContentConfig,
  type GenerateContentResponse
} from '@google/genai';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import {
  AIConfig,
  ConversationData,
  UnifiedLLMConfig,
  UnifiedToolConfig,
  TokenStats,
  FunctionCallingMode
} from '../types';
import type { GenerationConfig, ThinkingConfig } from '../types';
import { getTokenManager } from '../utils/token-manager';
import { DatabaseManager } from './database';
import { LoggingService } from './logging-service';
import { CacheManagerFactory } from '../utils/cache-manager';
import { errorHandler, createLLMAPIError, safeExecuteWithRetry } from '../utils/error-handler';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import {
  createLLMProvider,
  inferProviderFromModelName,
  resolveProviderConfigFromPrompt,
  resolveProviderFromUnifiedConfig,
  type LLMProviderId,
  type OpenResponseCreateRequest
} from './llm-provider';
import {
  buildGeminiCompatibleResponseFromOpenResponse,
  geminiRequestToOpenResponseRequest
} from './llm-provider/helpers';

interface GenerateResponseOptions {
  promptId?: string;
  configOverride?: UnifiedLLMConfig;
}

interface GenerateContentOptions {
  modelName?: string;
  agentType?: string;
  promptName?: string;
  promptId?: string;
  conversationId?: string;
  agentTurn?: number;
  llmCallId?: string;
  toolCallId?: string;
  configOverride?: UnifiedLLMConfig;
}

export class AIService {
  private static proxyConfigured = false;
  private aiConfig: AIConfig;
  private database: DatabaseManager;
  private loggingService: LoggingService;
  private tokenManager: ReturnType<typeof getTokenManager>;
  private moduleLogger = logger.createModuleLogger('ai-service');

  // 统一缓存管理
  private configCache = CacheManagerFactory.getInstance<UnifiedLLMConfig>('llm-config', {
    maxSize: 100,
    defaultTTL: 5 * 60 * 1000, // 5分钟
    evictionPolicy: 'LRU'
  });

  // API配置
  private defaultTimeout = 30000;

  constructor(
    config: AIConfig,
    database: DatabaseManager,
    loggingService: LoggingService
  ) {
    this.aiConfig = config;
    this.database = database;
    this.loggingService = loggingService;
    this.tokenManager = getTokenManager(database);

    const proxy = process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
    if (proxy) {
      this.configureGlobalProxy(proxy);
    }

    this.moduleLogger.info('Simplified AI Service initialized with unified configuration');

    // 预热常用配置
    this.preloadConfigurations();
  }

  // ============================================================================
  // 🎯 核心业务接口
  // ============================================================================

  /**
   * 生成AI响应 - 简化版核心接口
   */
  public async generateResponse(
    userMessage: string,
    userId: number,
    agentType: string = 'chat_bot',
    promptName?: string,
    traceId?: string,
    options?: GenerateResponseOptions
  ): Promise<ConversationData | null> {
    const conversationId = uuidv4();
    const timestamp = new Date();

    const result = await safeExecuteWithRetry(
      async () => {
        // 1. 获取统一配置
        const config = options?.configOverride
          ?? (options?.promptId
                ? await this.getConfigurationByPromptId(options.promptId)
                : await this.getConfiguration(agentType, promptName));
        if (!config) {
          throw new Error(`Configuration not found for ${agentType}/${promptName || options?.promptId || 'default'}`);
        }

        // 2. 执行LLM调用 (🔥 传入conversationId以建立关联)
        const callResult = await this.callLLMAPI(userMessage, config, traceId, userId, conversationId);
        if (!callResult) {
          throw new Error('LLM API call failed');
        }

        // 3. 构建响应数据
        const conversationData: ConversationData = {
          id: conversationId,
          user_id: userId,
          user_message: userMessage,
          ai_response: callResult.response,
          timestamp,
          created_at: timestamp,
          updated_at: timestamp,
          response_time: callResult.metrics.processingTimeMs / 1000,
          model_name: callResult.modelName,
          raw_request: JSON.stringify({
            userMessage,
            agentType,
            promptName,
            configId: config.id
          }),
          raw_response: JSON.stringify(callResult.rawResponse),
          status: 'completed',
          trace_id: traceId
        };

        // 4. 保存到数据库
        await this.database.saveConversation(conversationData);

        this.moduleLogger.info('Response generated successfully', {
          conversationId,
          agentType,
          modelName: callResult.modelName,
          responseLength: callResult.response.length,
          processingTime: callResult.metrics.processingTimeMs
        });

        return conversationData;
      },
      {
        service: 'ai-service',
        method: 'generateResponse',
        agentType: agentType
      },
      3 // 最多重试3次
    );

    return result || null;
  }

  /**
   * 带上下文的响应生成
   */
  public async generateResponseWithContext(
    originalUserMessage: string,
    fullContextPrompt: string,
    userId: number,
    agentType: string = 'chat_bot',
    promptName?: string,
    traceId?: string,
    options?: GenerateResponseOptions
  ): Promise<ConversationData | null> {
    // 使用上下文提示词调用核心方法
    return await this.generateResponse(
      fullContextPrompt,
      userId,
      agentType,
      promptName,
      traceId,
      options
    );
  }

  /**
   * 意图分析
   */
  public async analyzeIntent(
    message: string,
    userId: number,
    traceId?: string
  ): Promise<{ intent: string; confidence: number; reasoning: string } | null> {
    const result = await safeExecuteWithRetry(
      async () => {
        const config = await this.getConfiguration('intent_analyzer');
        if (!config) {
          throw new Error('Intent analyzer configuration not found');
        }

        const analysisPrompt = `分析以下消息的意图，返回JSON格式：
消息: "${message}"

请返回:
{
  "intent": "具体意图类别",
  "confidence": 0.0-1.0的置信度,
  "reasoning": "分析理由"
}`;

        const callResult = await this.callLLMAPI(analysisPrompt, config, traceId, userId);
        if (!callResult) return null;

        try {
          const result = JSON.parse(callResult.response);
          return {
            intent: result.intent || 'unknown',
            confidence: result.confidence || 0.5,
            reasoning: result.reasoning || 'No reasoning provided'
          };
        } catch (error) {
          this.moduleLogger.warn('Failed to parse intent analysis result', { error });
          return null;
        }
      },
      {
        service: 'ai-service',
        method: 'analyzeIntent'
      }
    );

    return result || null;
  }

  // ============================================================================
  // 🔧 配置管理
  // ============================================================================

  /**
   * 获取统一配置
   */
  private async getConfiguration(agentType: string, promptName?: string): Promise<UnifiedLLMConfig | null> {
    const cacheKey = `${agentType}:${promptName || 'default'}`;

    // 检查缓存
    let config = this.configCache.get(cacheKey);
    if (config) {
      return config;
    }

    // 从数据库加载
    const result = await safeExecuteWithRetry(
      async () => {
        // 1. 获取Agent Prompt数据
        const agentPrompt = await this.database.getAgentPrompt(agentType, promptName);
        if (!agentPrompt) {
          throw new Error(`Agent prompt not found: ${agentType}/${promptName}`);
        }

        // 2. 转换为统一配置
        const config = await this.convertToUnifiedConfig(agentPrompt);

        // 3. 缓存配置
        this.configCache.set(cacheKey, config, undefined, [agentType]);

        return config;
      },
      {
        service: 'ai-service',
        method: 'getConfiguration',
        agentType: agentType
      }
    );

    return result || null;
  }

  public async getConfigurationByPromptId(promptId: string): Promise<UnifiedLLMConfig | null> {
    if (!promptId) {
      return null;
    }

    const cacheKey = `id:${promptId}`;
    const cached = this.configCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const agentPrompt = await this.database.getAgentPromptById(promptId);
    if (!agentPrompt) {
      return null;
    }

    if (typeof agentPrompt.system_instructions === 'string') {
      try {
        agentPrompt.system_instructions = JSON.parse(agentPrompt.system_instructions);
      } catch (error) {
        this.moduleLogger.warn('Failed to parse system instructions JSON', { error, promptId });
      }
    }

    if (typeof agentPrompt.model_config === 'string') {
      try {
        agentPrompt.model_config = JSON.parse(agentPrompt.model_config);
      } catch (error) {
        this.moduleLogger.warn('Failed to parse model config JSON', { error, promptId });
      }
    }

    const config = await this.convertToUnifiedConfig(agentPrompt);
    this.configCache.set(cacheKey, config, undefined, [agentPrompt.agent_type]);
    return config;
  }

  public async getConfigurationForAgent(agentType: string, promptName?: string): Promise<UnifiedLLMConfig | null> {
    return this.getConfiguration(agentType, promptName);
  }

  /**
   * 转换AgentPromptData为UnifiedLLMConfig
   */
  private async convertToUnifiedConfig(agentPrompt: any): Promise<UnifiedLLMConfig> {
    const now = new Date();
    const resolvedProvider = resolveProviderConfigFromPrompt(agentPrompt);

    let advancedConfig: Record<string, any> | null = null;
    if (agentPrompt?.advanced_config) {
      try {
        advancedConfig = typeof agentPrompt.advanced_config === 'string'
          ? JSON.parse(agentPrompt.advanced_config)
          : agentPrompt.advanced_config;
      } catch (error) {
        this.moduleLogger.warn('Failed to parse advanced_config when building unified config', {
          promptId: agentPrompt?.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    const toolsConfig = await this.buildToolsConfig(agentPrompt);

    const selectFirstDefined = <T>(...values: Array<T | undefined | null>): T | undefined => {
      for (const value of values) {
        if (value !== undefined && value !== null) {
          return value;
        }
      }
      return undefined;
    };

    const modelConfig = agentPrompt.model_config || {};
    const advancedGenerationConfig = advancedConfig?.generationConfig && typeof advancedConfig.generationConfig === 'object'
      ? advancedConfig.generationConfig as Record<string, any>
      : undefined;

    const generation: GenerationConfig & Record<string, any> = {};

    generation.temperature = selectFirstDefined(
      advancedGenerationConfig?.temperature,
      advancedConfig?.temperature,
      modelConfig.temperature
    );
    if (generation.temperature === undefined) {
      generation.temperature = 0.7;
    }

    generation.topK = selectFirstDefined(
      advancedGenerationConfig?.topK,
      advancedConfig?.topK,
      modelConfig.topK
    );
    if (generation.topK === undefined) {
      generation.topK = 40;
    }

    generation.topP = selectFirstDefined(
      advancedGenerationConfig?.topP,
      advancedConfig?.topP,
      modelConfig.topP
    );
    if (generation.topP === undefined) {
      generation.topP = 0.95;
    }

    generation.maxOutputTokens = selectFirstDefined(
      advancedGenerationConfig?.maxOutputTokens,
      advancedConfig?.maxOutputTokens,
      modelConfig.maxOutputTokens
    );
    if (generation.maxOutputTokens === undefined) {
      generation.maxOutputTokens = 2048;
    }

    const stopSequences = selectFirstDefined(
      advancedGenerationConfig?.stopSequences,
      advancedConfig?.stopSequences,
      modelConfig.stopSequences
    );
    generation.stopSequences = Array.isArray(stopSequences) ? stopSequences : [];

    const generationExtraKeys = advancedGenerationConfig
      ? Object.keys(advancedGenerationConfig).filter((key) =>
          !['temperature', 'topP', 'topK', 'maxOutputTokens', 'stopSequences', 'thinkingConfig'].includes(key)
        )
      : [];

    for (const key of generationExtraKeys) {
      generation[key] = advancedGenerationConfig![key];
    }

    let thinkingConfig: ThinkingConfig | undefined;
    const thinkingSource = advancedGenerationConfig?.thinkingConfig
      || advancedConfig?.thinkingConfig;

    // 🔍 Debug logging for thinking config parsing
    this.moduleLogger.debug('Parsing thinkingConfig from advanced_config', {
      promptId: agentPrompt.id,
      hasAdvancedConfig: !!advancedConfig,
      hasAdvancedGenerationConfig: !!advancedGenerationConfig,
      advancedGenerationConfigThinking: advancedGenerationConfig?.thinkingConfig,
      advancedConfigThinking: advancedConfig?.thinkingConfig,
      thinkingSource
    });

    if (thinkingSource && typeof thinkingSource === 'object') {
      const normalizedThinking: ThinkingConfig = {};
      if (typeof thinkingSource.includeThoughts === 'boolean') {
        normalizedThinking.includeThoughts = thinkingSource.includeThoughts;
      }
      if (
        typeof thinkingSource.thinkingBudget === 'number' &&
        !Number.isNaN(thinkingSource.thinkingBudget)
      ) {
        normalizedThinking.thinkingBudget = thinkingSource.thinkingBudget;
      }

      if (Object.keys(normalizedThinking).length > 0) {
        thinkingConfig = normalizedThinking;
      }

      this.moduleLogger.debug('Normalized thinkingConfig', {
        promptId: agentPrompt.id,
        normalizedThinking,
        finalThinkingConfig: thinkingConfig
      });
    }

    return {
      id: agentPrompt.id,
      name: agentPrompt.prompt_name,
      description: agentPrompt.description || `${agentPrompt.agent_type} configuration`,
      category: agentPrompt.agent_type as any,

      model: {
        name: agentPrompt.model_name || 'gemini-2.5-flash',
        provider: resolvedProvider.provider,
        allowedTokenIds: agentPrompt.allowed_token_ids || [],
        ...(resolvedProvider.providerSpecific
          ? { providerSpecific: resolvedProvider.providerSpecific }
          : {})
      },

      generation,

      ...(thinkingConfig ? { thinking: thinkingConfig } : {}),

      safety: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
      ],

      tools: toolsConfig,

      context: {
        systemInstruction: Array.isArray(agentPrompt.system_instructions)
          ? agentPrompt.system_instructions.join('\n')
          : agentPrompt.system_instructions || '',
        maxContextLength: 32000,
        historyWindowSize: 20
      },

      performance: {
        timeout: this.defaultTimeout,
        retry: {
          maxRetries: 3,
          retryDelayMs: 1000,
          exponentialBackoff: true
        }
      },

      version: {
        version: agentPrompt.config_version || 'v1.0.0',
        createdAt: agentPrompt.created_at || now,
        updatedAt: agentPrompt.updated_at || now,
        createdBy: agentPrompt.created_by || 'system',
        isActive: agentPrompt.is_active !== false
      }
    };
  }

  /**
   * 构建工具配置，确保functionCalling和自定义工具同步
   */
  private async buildToolsConfig(agentPrompt: any): Promise<UnifiedToolConfig> {
    const defaultConfig: UnifiedToolConfig = {
      functionCalling: {
        mode: 'NONE',
        allowedFunctionIds: []
      },
      predefinedTools: {
        enabledTools: [],
        callingMode: 'AUTO'
      },
      customTools: []
    };

    let advancedConfig: any = null;
    if (agentPrompt?.advanced_config) {
      try {
        advancedConfig = typeof agentPrompt.advanced_config === 'string'
          ? JSON.parse(agentPrompt.advanced_config)
          : agentPrompt.advanced_config;
      } catch (error) {
        this.moduleLogger.warn('Failed to parse advanced_config JSON for prompt', {
          error: error instanceof Error ? error.message : 'Unknown error',
          promptId: agentPrompt?.id
        });
      }
    }

    const legacyToolsConfig = advancedConfig?.toolsConfig && typeof advancedConfig.toolsConfig === 'object'
      ? advancedConfig.toolsConfig
      : {};
    const rawCustomTools = Array.isArray(legacyToolsConfig.customTools) ? legacyToolsConfig.customTools : [];
    const customTools = rawCustomTools
      .map((tool: any) => {
        if (!tool || typeof tool !== 'object') {
          return null;
        }

        const name = typeof tool.name === 'string' ? tool.name.trim() : '';
        const id = typeof tool.id === 'string' ? tool.id.trim() : '';
        const normalizedName = name.length > 0 ? name : id;
        if (!normalizedName) {
          return null;
        }

        const description = typeof tool.description === 'string' ? tool.description.trim() : '';
        const parameters =
          tool.parameters && typeof tool.parameters === 'object'
            ? tool.parameters
            : {};

        return {
          id: id || normalizedName,
          name: normalizedName,
          description,
          parameters
        };
      })
      .filter(Boolean) as Array<{
        id: string;
        name: string;
        description: string;
        parameters: Record<string, any>;
      }>;

    const customToolNameSet = new Set(customTools.map(tool => tool.name));
    const customToolIdSet = new Set(customTools.map(tool => tool.id));

    const rawFunctionCalling = legacyToolsConfig.functionCalling && typeof legacyToolsConfig.functionCalling === 'object'
      ? legacyToolsConfig.functionCalling
      : legacyToolsConfig.functionCallingConfig && typeof legacyToolsConfig.functionCallingConfig === 'object'
        ? legacyToolsConfig.functionCallingConfig
        : {};
    const callingMode = this.normalizeFunctionCallingMode(
      rawFunctionCalling.mode,
      customTools.length > 0 ? 'AUTO' : 'NONE'
    );

    const allowedFunctionNames = Array.isArray(rawFunctionCalling.allowedFunctionNames)
      ? rawFunctionCalling.allowedFunctionNames.filter(
          (name: unknown): name is string => typeof name === 'string' && customToolNameSet.has(name)
        )
      : customTools.map(tool => tool.name);
    const allowedFunctionIds = Array.isArray(rawFunctionCalling.allowedFunctionIds)
      ? rawFunctionCalling.allowedFunctionIds.filter(
          (id: unknown): id is string => typeof id === 'string' && customToolIdSet.has(id)
        )
      : customTools.map(tool => tool.id);

    const functionCalling: {
      mode: FunctionCallingMode;
      allowedFunctionNames?: string[];
      allowedFunctionIds: string[];
    } = {
      mode: customTools.length > 0 ? callingMode : 'NONE',
      allowedFunctionIds
    };

    if (functionCalling.mode === 'ANY') {
      if (allowedFunctionNames.length > 0) {
        functionCalling.allowedFunctionNames = allowedFunctionNames;
      }
    }

    return {
      ...defaultConfig,
      functionCalling,
      predefinedTools: legacyToolsConfig?.predefinedTools || {
        enabledTools: [],
        callingMode: 'AUTO'
      },
      customTools,
      googleSearch: legacyToolsConfig?.googleSearch,
      urlContext: legacyToolsConfig?.urlContext,
      structuredOutput: legacyToolsConfig?.structuredOutput
    };
  }

  private normalizeFunctionCallingMode(
    mode: unknown,
    fallback: FunctionCallingMode = 'AUTO'
  ): FunctionCallingMode {
    if (typeof mode === 'string') {
      const upper = mode.toUpperCase();
      if (upper === 'AUTO' || upper === 'ANY' || upper === 'NONE') {
        return upper as FunctionCallingMode;
      }
    }

    return fallback;
  }

  /**
   * 预热配置缓存
   */
  private async preloadConfigurations(): Promise<void> {
    const commonAgentTypes = ['chat_bot', 'intent_analyzer', 'decision_engine'];

    const preloadPromises = commonAgentTypes.map(async (agentType) => {
      try {
        await this.getConfiguration(agentType);
        this.moduleLogger.debug('Configuration preloaded', { agentType });
      } catch (error) {
        this.moduleLogger.warn('Failed to preload configuration', { agentType, error });
      }
    });

    await Promise.allSettled(preloadPromises);
    this.moduleLogger.info('Configuration preloading completed');
  }

  // ============================================================================
  // 🚀 LLM API调用
  // ============================================================================

  /**
   * 统一的LLM API调用
   */
  private async callLLMAPI(
    prompt: string,
    config: UnifiedLLMConfig,
    traceId?: string,
    userId?: number,
    conversationId?: string
  ): Promise<{
    response: string;
    rawResponse: any;
    modelName: string;
    metrics: {
      inputTokens: number;
      outputTokens: number;
      processingTimeMs: number;
    };
  } | null> {
    const callStartTime = Date.now();
    const llmCallId = uuidv4();
    const startedAt = new Date(callStartTime);
    const providerId = resolveProviderFromUnifiedConfig(config);
    const canonicalRequest = geminiRequestToOpenResponseRequest({
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

    this.moduleLogger.debug('Starting LLM API call', {
      providerId,
      modelName: config.model.name,
      configId: config.id,
      traceId,
      llmCallId
    });

    // 埋点：LLM调用开始
    if (traceId && this.loggingService) {
      await this.loggingService.logEventStart(traceId, 'llm', 'api_call', undefined, {
        config_id: config.id,
        model_name: config.model.name,
        llm_call_id: llmCallId
      });
    }

    try {
      const provider = createLLMProvider({
        providerId,
        aiConfig: this.aiConfig,
        tokenManager: this.tokenManager
      });

      const response = await provider.generateText({
        prompt,
        config,
        context: {
          traceId,
          conversationId,
          agentType: config.category,
          promptName: config.name,
          llmCallId
        }
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error('Invalid response format from LLM API');
      }

      const processingTimeMs = response.usage.processingTimeMs || (Date.now() - callStartTime);
      const inputTokens = response.usage.inputTokens;
      const outputTokens = response.usage.outputTokens;
      const plainResponse = response.rawResponse;

      // 埋点：LLM调用成功
      if (traceId && this.loggingService) {
        await this.loggingService.logEventEnd(traceId, 'llm', 'api_call', new Date(callStartTime), undefined, {
          status: 'success',
          model_name: config.model.name,
          processing_time_ms: processingTimeMs,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          llm_call_id: llmCallId
        });
      }

      if (traceId && this.loggingService) {
        try {
          await this.loggingService.logLLMCall({
            traceId: traceId,
            llmCallId,
            conversationId: conversationId || undefined,
            sessionId: undefined,
            agentTurn: undefined,
            agentType: config.category || 'unknown',
            modelName: config.model.name,
            modelProvider: response.provider,
            promptTemplate: config.name || 'default',
            canonicalRequest: response.canonicalRequest,
            wireRequest: response.wireRequest,
            requestFormatVersion: response.requestFormatVersion,
            wireProviderFormat: response.wireProviderFormat,
            effectiveUnifiedConfig: this.buildEffectiveUnifiedConfigSnapshot(config, config.model.name, response.provider),
            inputTokens: inputTokens,
            canonicalResponse: response.canonicalResponse,
            wireResponse: response.wireResponse,
            processedResponse: responseText,
            outputTokens: outputTokens,
            apiCallTimeMs: processingTimeMs,
            processingTimeMs: processingTimeMs,
            startedAt,
            completedAt: new Date(),
            status: 'SUCCESS',
            userId: userId || undefined
          });

          this.moduleLogger.debug('LLM call logged successfully', {
            traceId,
            conversationId,
            agentType: config.category,
            modelName: config.model.name
          });
        } catch (logError) {
          this.moduleLogger.error('Failed to log LLM call', {
            traceId,
            conversationId,
            error: logError instanceof Error ? logError.message : 'Unknown error'
          });
        }
      }

      this.moduleLogger.info('LLM API call successful', {
        providerId: response.provider,
        modelName: config.model.name,
        configId: config.id,
        processingTimeMs,
        responseLength: responseText.length
      });

      return {
        response: responseText,
        rawResponse: plainResponse,
        modelName: config.model.name,
        metrics: {
          inputTokens,
          outputTokens,
          processingTimeMs
        }
      };

    } catch (error: any) {
      const processingTimeMs = Date.now() - callStartTime;

      // 埋点：LLM调用失败
      if (traceId && this.loggingService) {
        await this.loggingService.logEventEnd(traceId, 'llm', 'api_call', new Date(callStartTime), undefined, {
          status: 'failed',
          error_message: error.message,
          llm_call_id: llmCallId
        });
      }

      // 🔥 核心修复：记录失败的LLM调用
      if (traceId && this.loggingService) {
        try {
          await this.loggingService.logLLMCall({
            traceId: traceId,
            llmCallId,
            conversationId: conversationId || undefined,
            sessionId: undefined,
            agentTurn: undefined,
            agentType: config.category || 'unknown',
            modelName: config.model.name,
            modelProvider: providerId,
            promptTemplate: config.name || 'default',
            canonicalRequest,
            wireRequest: undefined,
            requestFormatVersion: 'openresponse/v1',
            wireProviderFormat: `${providerId}/unknown`,
            effectiveUnifiedConfig: this.buildEffectiveUnifiedConfigSnapshot(config, config.model.name, providerId),
            inputTokens: Math.ceil(prompt.length / 4),
            canonicalResponse: undefined,
            wireResponse: undefined,
            processedResponse: undefined,
            outputTokens: 0,
            apiCallTimeMs: processingTimeMs,
            processingTimeMs: processingTimeMs,
            startedAt,
            completedAt: new Date(),
            status: 'ERROR',
            errorMessage: error.message,
            errorCode: error.status?.toString() || 'UNKNOWN',
            userId: userId || undefined
          });
        } catch (logError) {
          this.moduleLogger.error('Failed to log failed LLM call', {
            traceId,
            conversationId,
            error: logError instanceof Error ? logError.message : 'Unknown error'
          });
        }
      }

      // 创建标准化错误
      const standardizedError = createLLMAPIError(error, {
        service: 'ai-service',
        method: 'callLLMAPI',
        modelName: config.model.name
      });

      errorHandler.handleError(standardizedError);

      throw standardizedError;
    }
  }

  private async handleTokenFailure(
    tokenInfo: {
      token: string;
      tokenId: number;
      projectName: string;
    },
    modelName: string,
    error: any,
    context: string
  ): Promise<void> {
    if (!this.isTokenError(error)) {
      return;
    }

    const statusCode = this.getErrorStatusCode(error);

    if (statusCode === 429) {
      await this.tokenManager.markTokenFailedForModel(tokenInfo.token, modelName, error, context);
      return;
    }

    if (statusCode === 401 || statusCode === 403) {
      await this.tokenManager.reportError(tokenInfo.token, error.message);
    }
  }

  private isTokenError(error: any): boolean {
    const statusCode = this.getErrorStatusCode(error);
    return statusCode === 401 || statusCode === 403 || statusCode === 429;
  }

  private getErrorStatusCode(error: any): number | undefined {
    if (!error) {
      return undefined;
    }

    if (typeof error.status === 'number') {
      return error.status;
    }

    if (typeof error.statusCode === 'number') {
      return error.statusCode;
    }

    if (error.response && typeof error.response.status === 'number') {
      return error.response.status;
    }

    if (error.originalError) {
      return this.getErrorStatusCode(error.originalError);
    }

    return undefined;
  }

  private configureGlobalProxy(proxyUrl: string): void {
    if (AIService.proxyConfigured) {
      return;
    }

    let maskedProxy = proxyUrl;
    try {
      const parsed = new URL(proxyUrl);
      const port = parsed.port ? `:${parsed.port}` : '';
      maskedProxy = `${parsed.protocol}//${parsed.hostname}${port}`;
    } catch {
      maskedProxy = proxyUrl.includes('@')
        ? proxyUrl.split('@').pop() || proxyUrl
        : proxyUrl;
    }

    try {
      const agent = new ProxyAgent(proxyUrl);
      setGlobalDispatcher(agent);
      AIService.proxyConfigured = true;
      this.moduleLogger.info('HTTP client configured to use proxy', { proxy: maskedProxy });
    } catch (error) {
      this.moduleLogger.error('Failed to configure HTTP proxy for Google GenAI client', {
        proxy: maskedProxy,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 🔥 直接调用 Gemini generateContent API
   * 用于 LLMJobWorker 的工具编排系统
   *
   * @param request - Gemini API 请求体 {contents, tools, generationConfig, safetySettings, ...}
   * @param traceId - 追踪ID
   * @param options - 可选配置（模型、agent、prompt 等信息）
   * @returns Gemini API 原始响应
   */
  public async generateContent(
    request: {
      contents: any[];
      tools?: any[];
      generationConfig?: any;
      safetySettings?: any;
      systemInstruction?: any;
      model?: { name: string };
      [key: string]: any;
    },
    traceId?: string,
    options?: GenerateContentOptions | string
  ): Promise<any> {
    const callStartTime = Date.now();
    const normalizedOptions: GenerateContentOptions = typeof options === 'string'
      ? { modelName: options }
      : (options || {});
    const llmCallId = normalizedOptions.llmCallId || uuidv4();
    const startedAt = new Date(callStartTime);

    const defaultModel = process.env.AI_MODEL_NAME || 'gemini-2.5-flash';
    const targetModel = normalizedOptions.modelName
      || request?.model?.name
      || defaultModel;

    if (!request.model && targetModel) {
      request.model = { name: targetModel };
    }

    const resolvedAgentType = normalizedOptions.agentType || 'tool_system';
    const resolvedPromptName = normalizedOptions.promptName || 'direct_call';
    const resolvedPromptConfig = await this.resolveProviderConfigForGenerateContent(
      normalizedOptions,
      resolvedAgentType,
      resolvedPromptName
    );
    const providerRequest = this.normalizeGenerateContentRequest(
      request,
      targetModel,
      resolvedPromptConfig || undefined
    );

    this.moduleLogger.debug('Starting direct LLM generateContent call', {
      modelName: targetModel,
      traceId,
      llmCallId,
      contentCount: request.contents?.length || 0,
      hasTools: !!request.tools,
      agentType: normalizedOptions.agentType,
      promptName: normalizedOptions.promptName,
      promptId: normalizedOptions.promptId
    });

    const providerId = this.resolveProviderForGenerateContent(
      targetModel,
      request,
      normalizedOptions,
      resolvedPromptConfig
    );

    try {
      const provider = createLLMProvider({
        providerId,
        aiConfig: this.aiConfig,
        tokenManager: this.tokenManager
      });

      if (traceId && this.loggingService) {
        await this.loggingService.logEventStart(traceId, 'llm', 'generate_content', normalizedOptions.conversationId, {
          model_name: targetModel,
          llm_call_id: llmCallId,
          agent_turn: normalizedOptions.agentTurn,
          prompt_name: resolvedPromptName
        });
      }

      const response = await provider.generateContent({
        request: providerRequest,
        modelName: targetModel,
        providerConfig: resolvedPromptConfig || undefined,
        context: {
          traceId,
          conversationId: normalizedOptions.conversationId,
          agentType: resolvedAgentType,
          promptName: resolvedPromptName,
          promptId: normalizedOptions.promptId,
          agentTurn: normalizedOptions.agentTurn,
          llmCallId,
          toolCallId: normalizedOptions.toolCallId
        }
      });

      const processingTimeMs = response.usage.processingTimeMs || (Date.now() - callStartTime);
      const inputTokens = response.usage.inputTokens;
      const outputTokens = response.usage.outputTokens;
      const processedResponse = response.text;
      const plainResponse = response.rawResponse;

      if (traceId && this.loggingService) {
        await this.loggingService.logEventEnd(traceId, 'llm', 'generate_content', new Date(callStartTime), normalizedOptions.conversationId, {
          status: 'success',
          model_name: targetModel,
          llm_call_id: llmCallId,
          agent_turn: normalizedOptions.agentTurn,
          prompt_name: resolvedPromptName
        });
      }

      if (traceId && this.loggingService) {
        try {
          await this.loggingService.logLLMCall({
            traceId,
            llmCallId,
            conversationId: normalizedOptions.conversationId,
            sessionId: undefined,
            agentTurn: normalizedOptions.agentTurn,
            agentType: resolvedAgentType,
            modelName: targetModel,
            modelProvider: response.provider,
            promptTemplate: resolvedPromptName,
            canonicalRequest: response.canonicalRequest,
            wireRequest: response.wireRequest,
            requestFormatVersion: response.requestFormatVersion,
            wireProviderFormat: response.wireProviderFormat,
            effectiveUnifiedConfig: this.buildEffectiveUnifiedConfigSnapshot(resolvedPromptConfig, targetModel, response.provider),
            inputTokens,
            canonicalResponse: response.canonicalResponse,
            wireResponse: response.wireResponse,
            processedResponse,
            outputTokens,
            apiCallTimeMs: processingTimeMs,
            processingTimeMs,
            startedAt,
            completedAt: new Date(),
            status: 'SUCCESS'
          });
        } catch (logError) {
          this.moduleLogger.error('Failed to log generateContent call', {
            traceId,
            error: logError instanceof Error ? logError.message : 'Unknown error'
          });
        }
      }

      this.moduleLogger.info('Direct LLM generateContent call successful', {
        providerId: response.provider,
        modelName: targetModel,
        processingTimeMs,
        hasTools: !!request.tools,
        toolCount: request.tools?.length || 0,
        agentType: resolvedAgentType,
        promptName: resolvedPromptName
      });

      const compatibleResponse = buildGeminiCompatibleResponseFromOpenResponse(response.response, plainResponse);

      return {
        ...compatibleResponse,
        provider: response.provider,
        model: targetModel,
        usage: compatibleResponse.usageMetadata,
        performance: {
          processing_time_ms: processingTimeMs,
          api_call_time_ms: processingTimeMs
        },
        canonical_request: response.canonicalRequest,
        wire_request: response.wireRequest,
        canonical_response: response.canonicalResponse,
        wire_response: response.wireResponse,
        raw_response: plainResponse,
        debug_metadata: {
          provider: response.provider,
          model: targetModel,
          canonicalRequest: response.canonicalRequest,
          wireRequest: response.wireRequest,
          canonicalResponse: response.canonicalResponse,
          wireResponse: response.wireResponse,
          requestFormatVersion: response.requestFormatVersion,
          wireProviderFormat: response.wireProviderFormat
        }
      };

    } catch (error: any) {
      const processingTimeMs = Date.now() - callStartTime;

      if (traceId && this.loggingService) {
        await this.loggingService.logEventEnd(traceId, 'llm', 'generate_content', new Date(callStartTime), normalizedOptions.conversationId, {
          status: 'failed',
          model_name: targetModel,
          llm_call_id: llmCallId,
          agent_turn: normalizedOptions.agentTurn,
          prompt_name: resolvedPromptName,
          error_message: error.message
        });
      }

      if (traceId && this.loggingService) {
        try {
          await this.loggingService.logLLMCall({
            traceId,
            llmCallId,
            conversationId: normalizedOptions.conversationId,
            sessionId: undefined,
            agentTurn: normalizedOptions.agentTurn,
            agentType: resolvedAgentType,
            modelName: targetModel,
            modelProvider: providerId,
            promptTemplate: resolvedPromptName,
            canonicalRequest: providerRequest,
            wireRequest: undefined,
            requestFormatVersion: 'openresponse/v1',
            wireProviderFormat: `${providerId}/unknown`,
            effectiveUnifiedConfig: this.buildEffectiveUnifiedConfigSnapshot(resolvedPromptConfig, targetModel, providerId),
            inputTokens: 0,
            canonicalResponse: undefined,
            wireResponse: undefined,
            processedResponse: undefined,
            outputTokens: 0,
            apiCallTimeMs: processingTimeMs,
            processingTimeMs,
            startedAt,
            completedAt: new Date(),
            status: 'ERROR',
            errorMessage: error.message,
            errorCode: (error.status ?? error.statusCode ?? error.code ?? 'UNKNOWN').toString()
          });
        } catch (logError) {
          this.moduleLogger.error('Failed to log failed generateContent call', {
            traceId,
            error: logError instanceof Error ? logError.message : 'Unknown error'
          });
        }
      }

      this.moduleLogger.error('Direct LLM generateContent call failed', {
        providerId,
        modelName: targetModel,
        error: error.message,
        status: error.status,
        agentType: resolvedAgentType,
        promptName: resolvedPromptName,
        traceId,
        hasTools: !!request.tools,
        toolCount: request.tools?.length || 0
      });

      throw error;
    }
  }

  private normalizeGenerateContentRequest(
    request: Record<string, any>,
    modelName: string,
    providerConfig?: UnifiedLLMConfig
  ): OpenResponseCreateRequest {
    if (request && typeof request === 'object' && request.model && request.input) {
      return {
        ...request,
        model: typeof request.model === 'string' ? request.model : modelName
      } as OpenResponseCreateRequest;
    }

    return geminiRequestToOpenResponseRequest(request, modelName, providerConfig);
  }

  private buildEffectiveUnifiedConfigSnapshot(
    config: UnifiedLLMConfig | null | undefined,
    modelName: string,
    provider: string
  ): Record<string, unknown> | null {
    if (!config) {
      return null;
    }

    const snapshot = JSON.parse(JSON.stringify(config)) as UnifiedLLMConfig;
    snapshot.model = {
      ...(snapshot.model || {}),
      name: modelName,
      provider: provider as UnifiedLLMConfig['model']['provider']
    };
    return snapshot as unknown as Record<string, unknown>;
  }

  private async resolveProviderConfigForGenerateContent(
    options: GenerateContentOptions,
    agentType: string,
    promptName: string
  ): Promise<UnifiedLLMConfig | null> {
    if (options.configOverride) {
      return options.configOverride;
    }

    if (options.promptId) {
      return await this.getConfigurationByPromptId(options.promptId);
    }

    if (options.agentType) {
      return await this.getConfiguration(options.agentType, options.promptName);
    }

    return null;
  }

  private resolveProviderForGenerateContent(
    targetModel: string,
    request: { model?: { name: string } },
    options: GenerateContentOptions,
    config?: UnifiedLLMConfig | null
  ): LLMProviderId {
    if (
      config?.model?.provider &&
      resolveProviderFromUnifiedConfig(config) !== inferProviderFromModelName(config.model.name)
    ) {
      return resolveProviderFromUnifiedConfig(config);
    }

    const hasExplicitModel = Boolean(options.modelName || request?.model?.name);
    if (hasExplicitModel) {
      return inferProviderFromModelName(targetModel);
    }

    if (config) {
      return resolveProviderFromUnifiedConfig(config);
    }

    return inferProviderFromModelName(targetModel);
  }

  private buildContents(prompt: string, systemInstruction?: string): any[] {
    const contents: any[] = [];

    if (systemInstruction && systemInstruction.trim().length > 0) {
      contents.push({
        role: 'system',
        parts: [{ text: systemInstruction }]
      });
    }

    contents.push({
      role: 'user',
      parts: [{ text: prompt }]
    });

    return contents;
  }

  private buildGenerateContentConfig(config: UnifiedLLMConfig): GenerateContentConfig {
    const generation = config.generation || {};
    const sdkConfig: GenerateContentConfig = {};

    if (generation.temperature !== undefined) sdkConfig.temperature = generation.temperature;
    if (generation.topK !== undefined) sdkConfig.topK = generation.topK;
    if (generation.topP !== undefined) sdkConfig.topP = generation.topP;
    if (generation.maxOutputTokens !== undefined) sdkConfig.maxOutputTokens = generation.maxOutputTokens;
    if (generation.stopSequences) sdkConfig.stopSequences = generation.stopSequences;
    if (generation.responseMimeType) sdkConfig.responseMimeType = generation.responseMimeType;
    if (generation.responseSchema) sdkConfig.responseSchema = generation.responseSchema;

    if (config.safety?.length) {
      sdkConfig.safetySettings = config.safety.map(safety => ({
        category: safety.category as HarmCategory,
        threshold: safety.threshold as HarmBlockThreshold
      }));
    }

    // 🔍 Debug logging for thinking config
    this.moduleLogger.debug('Building SDK config with thinking config', {
      configId: config.id,
      hasThinking: !!config.thinking,
      thinking: config.thinking,
      includeThoughts: config.thinking?.includeThoughts,
      thinkingBudget: config.thinking?.thinkingBudget
    });

    if (config.thinking?.includeThoughts !== undefined) {
      sdkConfig.thinkingConfig = {
        includeThoughts: config.thinking.includeThoughts,
        thinkingBudget: config.thinking.thinkingBudget
      } as any;
      this.moduleLogger.debug('Added thinkingConfig to SDK config', {
        thinkingConfig: sdkConfig.thinkingConfig
      });
    } else if (config.thinking?.thinkingBudget !== undefined) {
      sdkConfig.thinkingConfig = {
        thinkingBudget: config.thinking.thinkingBudget
      } as any;
      this.moduleLogger.debug('Added thinkingBudget-only to SDK config', {
        thinkingConfig: sdkConfig.thinkingConfig
      });
    } else {
      this.moduleLogger.debug('No thinkingConfig added to SDK config');
    }

    return sdkConfig;
  }

  private buildGenerateContentConfigFromRequest(request: any): GenerateContentConfig {
    const sdkConfig: GenerateContentConfig = {};

    if (request.generationConfig && typeof request.generationConfig === 'object') {
      Object.assign(sdkConfig, request.generationConfig);
    } else {
      sdkConfig.temperature = 1.0;
      sdkConfig.topK = 40;
      sdkConfig.topP = 0.95;
      sdkConfig.maxOutputTokens = 8192;
    }

    if (request.safetySettings) {
      sdkConfig.safetySettings = request.safetySettings;
    }

    const normalizedInstruction = this.normalizeSystemInstruction(request.systemInstruction);
    if (normalizedInstruction) {
      sdkConfig.systemInstruction = normalizedInstruction;
    }

    if (Array.isArray(request.tools) && request.tools.length > 0) {
      const normalizedTools = this.normalizeToolsForSDK(request.tools);
      if (normalizedTools) {
        sdkConfig.tools = normalizedTools as any;
      } else {
        this.moduleLogger.warn('Skipping tool injection due to invalid tool definitions', {
          providedToolCount: request.tools.length
        });
      }
    }

    if (request.toolConfig) {
      sdkConfig.toolConfig = request.toolConfig;
    }

    if (request.thinkingConfig) {
      sdkConfig.thinkingConfig = request.thinkingConfig as any;
    }

    return sdkConfig;
  }

  private normalizeSystemInstruction(systemInstruction: any): any {
    if (!systemInstruction) {
      return undefined;
    }

    if (typeof systemInstruction === 'string') {
      return {
        role: 'system',
        parts: [{ text: systemInstruction }]
      };
    }

    return systemInstruction;
  }

  private normalizeToolsForSDK(tools: any[]): any[] | undefined {
    if (!Array.isArray(tools) || tools.length === 0) {
      return undefined;
    }

    const isGeminiToolObject = (tool: any): boolean => {
      if (!tool || typeof tool !== 'object') {
        return false;
      }

      if (Array.isArray(tool.functionDeclarations)) {
        return true;
      }

      const knownKeys = ['googleSearch', 'codeExecution', 'vertexAISearch', 'retrieval', 'grounding', 'speechModel', 'textModel'];
      return knownKeys.some((key) => key in tool);
    };

    const normalizeDeclaration = (decl: any) => this.normalizeFunctionDeclarationForSDK(decl);

    const geminiTools: any[] = [];
    const declarationCandidates: any[] = [];

    for (const tool of tools) {
      if (isGeminiToolObject(tool)) {
        geminiTools.push(tool);
      } else {
        declarationCandidates.push(tool);
      }
    }

    const normalizedGeminiTools = geminiTools.map((tool) => {
      if (!tool || typeof tool !== 'object') {
        return tool;
      }

      if (!Array.isArray(tool.functionDeclarations)) {
        return { ...tool };
      }

      const normalizedDeclarations = tool.functionDeclarations
        .map(normalizeDeclaration)
        .filter(Boolean);

      return {
        ...tool,
        functionDeclarations: normalizedDeclarations
      };
    }).filter((tool) => {
      if (!tool || typeof tool !== 'object') {
        return true;
      }

      if (Array.isArray((tool as any).functionDeclarations)) {
        return (tool as any).functionDeclarations.length > 0;
      }

      return true;
    });

    const normalizedDeclarations = declarationCandidates
      .map(normalizeDeclaration)
      .filter(Boolean) as Array<Record<string, any>>;

    const result: any[] = [...normalizedGeminiTools];

    if (normalizedDeclarations.length > 0) {
      result.push({ functionDeclarations: normalizedDeclarations });
    }

    return result.length > 0 ? result : undefined;
  }

  private normalizeFunctionDeclarationForSDK(input: any): Record<string, any> | null {
    if (!input) {
      return null;
    }

    let declaration: Record<string, any>;

    if (typeof input === 'string') {
      try {
        const parsed = JSON.parse(input);
        if (!parsed || typeof parsed !== 'object') {
          return null;
        }
        declaration = { ...parsed };
      } catch (error) {
        this.moduleLogger.warn('Failed to parse function declaration string', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        return null;
      }
    } else if (typeof input === 'object') {
      declaration = { ...input };
    } else {
      return null;
    }

    const name = declaration.name || declaration.id;
    if (!name || typeof name !== 'string') {
      return null;
    }

    const normalized: Record<string, any> = {
      ...declaration,
      name,
      description: declaration.description || ''
    };

    if (declaration.parameters) {
      const rawParameters = typeof declaration.parameters === 'string'
        ? this.safeJsonParse(declaration.parameters)
        : declaration.parameters;

      if (rawParameters && typeof rawParameters === 'object') {
        normalized.parameters = this.normalizeSchemaForSDK(rawParameters);
      }
    }

    if (declaration.response) {
      const rawResponse = typeof declaration.response === 'string'
        ? this.safeJsonParse(declaration.response)
        : declaration.response;

      if (rawResponse && typeof rawResponse === 'object') {
        normalized.response = this.normalizeSchemaForSDK(rawResponse);
      }
    }

    delete normalized.id;

    return normalized;
  }

  private normalizeSchemaForSDK(schema: any): any {
    if (!schema || typeof schema !== 'object') {
      return schema;
    }

    if (Array.isArray(schema)) {
      return schema.map((item) => this.normalizeSchemaForSDK(item));
    }

    const normalized: Record<string, any> = { ...schema };

    const mappedType = this.mapSchemaType(schema.type);
    if (mappedType) {
      normalized.type = mappedType;
    }

    if (schema.properties && typeof schema.properties === 'object') {
      normalized.properties = Object.entries(schema.properties).reduce<Record<string, any>>((acc, [key, value]) => {
        acc[key] = this.normalizeSchemaForSDK(value);
        return acc;
      }, {});
    }

    if (schema.items) {
      normalized.items = this.normalizeSchemaForSDK(schema.items);
    }

    if (Array.isArray(schema.anyOf)) {
      normalized.anyOf = schema.anyOf.map((item: any) => this.normalizeSchemaForSDK(item));
    }

    if (Array.isArray(schema.oneOf)) {
      normalized.oneOf = schema.oneOf.map((item: any) => this.normalizeSchemaForSDK(item));
    }

    if (Array.isArray(schema.allOf)) {
      normalized.allOf = schema.allOf.map((item: any) => this.normalizeSchemaForSDK(item));
    }

    return normalized;
  }

  private mapSchemaType(typeValue: any): Type | undefined {
    if (typeof typeValue !== 'string') {
      return undefined;
    }

    const normalized = typeValue.toUpperCase();

    switch (normalized) {
      case 'OBJECT':
        return Type.OBJECT;
      case 'ARRAY':
        return Type.ARRAY;
      case 'STRING':
        return Type.STRING;
      case 'NUMBER':
        return Type.NUMBER;
      case 'INTEGER':
        return Type.INTEGER;
      case 'BOOLEAN':
        return Type.BOOLEAN;
      case 'TYPE_UNSPECIFIED':
        return Type.TYPE_UNSPECIFIED;
      default:
        return undefined;
    }
  }

  private safeJsonParse(payload: string): any | null {
    try {
      return JSON.parse(payload);
    } catch (error) {
      this.moduleLogger.warn('Failed to parse JSON payload for tool schema', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  private cloneResponse<T>(response: T): T {
    if (response === null || response === undefined) {
      return response;
    }

    const globalRef = global as typeof global & {
      structuredClone?: <K>(value: K) => K;
    };
    const structuredCloneFn = globalRef.structuredClone;

    try {
      if (typeof structuredCloneFn === 'function') {
        return structuredCloneFn(response);
      }
    } catch {
      // ignore and fallback to JSON serialization
    }

    try {
      return JSON.parse(JSON.stringify(response));
    } catch {
      return response;
    }
  }

  /**
   * 估算输入内容的 token 数量
   */
  private estimateTokens(contents: any[]): number {
    if (!Array.isArray(contents) || contents.length === 0) {
      return 0;
    }
    let totalChars = 0;
    for (const content of contents) {
      if (content.parts) {
        for (const part of content.parts) {
          if (part.text) {
            totalChars += part.text.length;
          } else if (part.functionResponse) {
            totalChars += JSON.stringify(part.functionResponse).length;
          }
        }
      }
    }
    return Math.ceil(totalChars / 4);
  }

  /**
   * 估算响应的 token 数量
   */
  private estimateTokensFromResponse(response: any): number {
    if (!response) {
      return 0;
    }

    const usage = response.usageMetadata || response?.data?.usageMetadata;
    if (usage?.candidatesTokenCount !== undefined) {
      return usage.candidatesTokenCount;
    }

    const candidates = response.candidates || response?.data?.candidates;
    if (!candidates?.[0]?.content?.parts) {
      return 0;
    }

    let totalChars = 0;
    for (const part of candidates[0].content.parts) {
      if (part.text) {
        totalChars += part.text.length;
      } else if (part.functionCall) {
        totalChars += JSON.stringify(part.functionCall).length;
      }
    }
    return Math.ceil(totalChars / 4);
  }

  /**
   * 从响应中提取文本内容
   */
  private extractTextFromResponse(response: any): string {
    if (!response) {
      return '';
    }

    const textValue = (response as GenerateContentResponse).text;
    if (typeof textValue === 'string' && textValue.length > 0) {
      return textValue;
    }

    const candidates = response.candidates || response?.data?.candidates;
    if (!candidates?.[0]?.content?.parts) {
      return '';
    }

    const textParts: string[] = [];
    for (const part of candidates[0].content.parts) {
      if (part.text) {
        textParts.push(part.text);
      }
    }
    return textParts.join(' ');
  }

  // ============================================================================
  // 📊 管理和监控接口
  // ============================================================================

  /**
   * 获取Token统计
   */
  public async getTokenStats(): Promise<TokenStats> {
    return await this.tokenManager.getStats();
  }

  /**
   * 获取配置缓存统计
   */
  public getConfigurationStats(): {
    cache: any;
    errorStats: any;
    tokenStats: Promise<TokenStats>;
  } {
    return {
      cache: this.configCache.getStatistics(),
      errorStats: errorHandler.getErrorStats(),
      tokenStats: this.getTokenStats()
    };
  }

  /**
   * 清理配置缓存
   */
  public clearConfigurationCache(agentType?: string): void {
    if (agentType) {
      this.configCache.deleteByTags([agentType]);
    } else {
      this.configCache.clear();
    }

    this.moduleLogger.info('Configuration cache cleared', { agentType: agentType || 'all' });
  }

  /**
   * 重新加载Token
   */
  public async reloadTokens(): Promise<void> {
    // Token manager will automatically reload when needed
    this.moduleLogger.info('Token reload requested');
  }

  /**
   * 系统健康检查
   */
  public async getHealthStatus(): Promise<{
    status: 'healthy' | 'warning' | 'error';
    components: {
      database: boolean;
      cache: any;
      tokenManager: boolean;
      errorHandler: boolean;
    };
  }> {
    try {
      // 检查数据库
      await this.database.getAgentPrompts(undefined);
      const dbHealthy = true;

      // 检查缓存
      const cacheHealth = this.configCache.getHealthStatus();

      // 检查Token管理器
      const tokenStats = await this.getTokenStats();
      const tokenHealthy = tokenStats.healthy > 0;

      // 检查错误处理器
      const errorHandlerHealthy = true; // 错误处理器总是可用

      const allHealthy = dbHealthy && tokenHealthy && errorHandlerHealthy && cacheHealth.status === 'healthy';

      return {
        status: allHealthy ? 'healthy' : 'warning',
        components: {
          database: dbHealthy,
          cache: cacheHealth,
          tokenManager: tokenHealthy,
          errorHandler: errorHandlerHealthy
        }
      };
    } catch (error) {
      this.moduleLogger.error('Health check failed', { error });
      return {
        status: 'error',
        components: {
          database: false,
          cache: { status: 'error' },
          tokenManager: false,
          errorHandler: true
        }
      };
    }
  }

  /**
   * 检查用户是否被授权
   */
  public isAuthorizedUser(userId: number): boolean {
    // Use environment variables for authorization check
    const authorizedUserId = process.env.AUTHORIZED_USER_ID;
    return authorizedUserId ? userId === parseInt(authorizedUserId) : false;
  }

  /**
   * 获取机器人QQ号
   */
  public getBotQQNumber(): number {
    return parseInt(process.env.BOT_QQ_NUMBER || '0');
  }

  /**
   * 获取模型信息
   */
  public async getModelInfo(): Promise<{ name: string; apiKeysCount: number }> {
    const stats = await this.getTokenStats();
    return {
      name: process.env.AI_MODEL_NAME || 'gemini-2.5-flash',
      apiKeysCount: stats.total
    };
  }

  /**
   * 为现有对话生成响应 (兼容方法)
   */
  public async generateResponseForExistingConversation(
    userMessage: string,
    conversationId: string,
    messageContext: any,
    agentType?: string,
    promptName?: string,
    traceId?: string,
    options?: GenerateResponseOptions
  ): Promise<string> {
    if (!conversationId) {
      this.moduleLogger.error('conversationId is required for generateResponseForExistingConversation');
      throw new Error('conversationId is required');
    }

    // 调用标准生成方法，提取userId从messageContext
    const userId = messageContext?.userId || 0;
    const response = await this.generateResponse(
      userMessage,
      userId,
      agentType || 'chat_bot',
      promptName,
      traceId,
      options
    );

    // 返回AI响应内容
    return response?.ai_response || '';
  }

}

export default AIService;

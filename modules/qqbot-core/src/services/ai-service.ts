/**
 * 🔥 简化版AI Service - 纯统一配置架构
 * 移除Legacy配置系统，采用单一现代化配置架构
 */

import axios from 'axios';
import { 
  AIConfig,
  ConversationData,
  UnifiedLLMConfig,
  TokenStats
} from '../types';
import { getTokenManager } from '../utils/token-manager';
import { DatabaseManager } from './database';
import { LoggingService } from './logging-service';
import { CacheManagerFactory } from '../utils/cache-manager';
import { errorHandler, createLLMAPIError, safeExecuteWithRetry } from '../utils/error-handler';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

interface GenerateResponseOptions {
  promptId?: string;
  configOverride?: UnifiedLLMConfig;
}

interface GenerateContentOptions {
  modelName?: string;
  agentType?: string;
  promptName?: string;
  promptId?: string;
}

export class AIService {
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
  private baseURL = 'https://generativelanguage.googleapis.com/v1beta/models';
  private defaultTimeout = 30000;

  constructor(config: AIConfig, database: DatabaseManager, loggingService: LoggingService) {
    this.database = database;
    this.loggingService = loggingService;
    this.tokenManager = getTokenManager(database);

    // axios会自动读取HTTP_PROXY和HTTPS_PROXY环境变量，无需显式配置
    const proxy = process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
    if (proxy) {
      this.moduleLogger.info(`HTTP client will use proxy from environment: ${proxy}`);
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
        const config = this.convertToUnifiedConfig(agentPrompt);

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

    const config = this.convertToUnifiedConfig(agentPrompt);
    this.configCache.set(cacheKey, config, undefined, [agentPrompt.agent_type]);
    return config;
  }

  public async getConfigurationForAgent(agentType: string, promptName?: string): Promise<UnifiedLLMConfig | null> {
    return this.getConfiguration(agentType, promptName);
  }

  /**
   * 转换AgentPromptData为UnifiedLLMConfig
   */
  private convertToUnifiedConfig(agentPrompt: any): UnifiedLLMConfig {
    const now = new Date();

    return {
      id: agentPrompt.id,
      name: agentPrompt.prompt_name,
      description: agentPrompt.description || `${agentPrompt.agent_type} configuration`,
      category: agentPrompt.agent_type as any,

      model: {
        name: agentPrompt.model_name || 'gemini-2.5-flash',
        provider: 'google',
        allowedTokenIds: agentPrompt.allowed_token_ids || []
      },

      generation: {
        temperature: agentPrompt.model_config?.temperature || 0.7,
        topK: agentPrompt.model_config?.topK || 40,
        topP: agentPrompt.model_config?.topP || 0.95,
        maxOutputTokens: agentPrompt.model_config?.maxOutputTokens || 2048,
        stopSequences: agentPrompt.model_config?.stopSequences || []
      },

      safety: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
      ],

      tools: agentPrompt.advanced_config?.toolsConfig || {
        functionCalling: { enabled: false },
        predefinedTools: { enabledTools: [], callingMode: 'AUTO' }
      },

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

    this.moduleLogger.debug('Starting LLM API call', {
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
      // 1. 获取Token
      const tokenInfo = await this.tokenManager.getTokenForModel(
        config.model.name,
        config.category,
        config.name
      );

      if (!tokenInfo) {
        throw new Error(`No available tokens for model ${config.model.name}`);
      }

      // 2. 构建请求
      const requestBody = {
        contents: [
          {
            parts: [
              {
                text: config.context.systemInstruction
                  ? `${config.context.systemInstruction}\n\n${prompt}`
                  : prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: config.generation.temperature,
          topK: config.generation.topK,
          topP: config.generation.topP,
          maxOutputTokens: config.generation.maxOutputTokens,
          stopSequences: config.generation.stopSequences
        },
        safetySettings: config.safety.map(safety => ({
          category: safety.category,
          threshold: safety.threshold
        }))
      };

      // 3. 执行API调用（axios自动使用HTTP_PROXY环境变量）
      const response = await axios.post(
        `${this.baseURL}/${config.model.name}:generateContent?key=${tokenInfo.token}`,
        requestBody,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: config.performance.timeout
        }
      );

      // 4. 处理响应
      if (!response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
        throw new Error('Invalid response format from LLM API');
      }

      const responseText = response.data.candidates[0].content.parts[0].text;
      const processingTimeMs = Date.now() - callStartTime;

      // 估算token使用
      const inputTokens = Math.ceil(prompt.length / 4);
      const outputTokens = Math.ceil(responseText.length / 4);

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

      // 🔥 核心修复：记录LLM调用到llm_call_logs表
      if (traceId && this.loggingService) {
        try {
          await this.loggingService.logLLMCall({
            traceId: traceId,
            conversationId: conversationId || undefined,
            sessionId: undefined, // 暂时不设置session_id
            agentType: config.category || 'unknown',
            modelName: config.model.name,
            modelProvider: 'google',
            promptTemplate: config.name || 'default',
            inputPrompt: prompt,
            inputTokens: inputTokens,
            modelConfig: JSON.stringify({
              temperature: config.generation.temperature,
              topK: config.generation.topK,
              topP: config.generation.topP,
              maxOutputTokens: config.generation.maxOutputTokens
            }),
            rawResponse: JSON.stringify(response.data),
            processedResponse: responseText,
            outputTokens: outputTokens,
            apiCallTimeMs: processingTimeMs,
            processingTimeMs: processingTimeMs,
            status: 'SUCCESS',
            userId: userId || undefined,
            contextSummary: prompt.length > 200 ? prompt.substring(0, 200) + '...' : prompt
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
          // 不抛出错误，避免影响主要功能
        }
      }

      this.moduleLogger.info('LLM API call successful', {
        modelName: config.model.name,
        configId: config.id,
        processingTimeMs,
        tokenId: tokenInfo.tokenId,
        responseLength: responseText.length
      });

      return {
        response: responseText,
        rawResponse: response.data,
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
            conversationId: conversationId || undefined,
            sessionId: undefined,
            agentType: config.category || 'unknown',
            modelName: config.model.name,
            modelProvider: 'google',
            promptTemplate: config.name || 'default',
            inputPrompt: prompt,
            inputTokens: Math.ceil(prompt.length / 4),
            modelConfig: JSON.stringify({
              temperature: config.generation.temperature,
              topK: config.generation.topK,
              topP: config.generation.topP,
              maxOutputTokens: config.generation.maxOutputTokens
            }),
            rawResponse: undefined,
            processedResponse: undefined,
            outputTokens: 0,
            apiCallTimeMs: processingTimeMs,
            processingTimeMs: processingTimeMs,
            status: 'ERROR',
            errorMessage: error.message,
            errorCode: error.status?.toString() || 'UNKNOWN',
            userId: userId || undefined,
            contextSummary: prompt.length > 200 ? prompt.substring(0, 200) + '...' : prompt
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

      // 如果是Token错误，报告给TokenManager
      if (this.isTokenError(error)) {
        await this.tokenManager.reportError(config.model.name, error.message);
      }

      throw standardizedError;
    }
  }

  private isTokenError(error: any): boolean {
    return error.status === 401 || error.status === 403 || error.status === 429;
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
    const llmCallId = uuidv4();

    const normalizedOptions: GenerateContentOptions = typeof options === 'string'
      ? { modelName: options }
      : (options || {});

    const defaultModel = process.env.AI_MODEL_NAME || 'gemini-2.5-flash';
    const targetModel = normalizedOptions.modelName
      || request?.model?.name
      || defaultModel;

    if (!request.model && targetModel) {
      request.model = { name: targetModel };
    }

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

    const resolvedAgentType = normalizedOptions.agentType || 'tool_system';
    const resolvedPromptName = normalizedOptions.promptName || 'direct_call';

    try {
      // 1. 获取Token
      const tokenInfo = await this.tokenManager.getTokenForModel(
        targetModel,
        resolvedAgentType,
        resolvedPromptName
      );

      if (!tokenInfo) {
        throw new Error(`No available tokens for model ${targetModel}`);
      }

      // 2. 构建请求体
      const requestBody: any = {
        contents: request.contents
      };

      if (request.tools && request.tools.length > 0) {
        requestBody.tools = request.tools;
      }

      if (request.generationConfig) {
        requestBody.generationConfig = request.generationConfig;
      } else {
        requestBody.generationConfig = {
          temperature: 1.0,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192
        };
      }

      if (request.safetySettings) {
        requestBody.safetySettings = request.safetySettings;
      }

      if (request.systemInstruction) {
        requestBody.systemInstruction = request.systemInstruction;
      }

      // 3. 执行API调用
      const response = await axios.post(
        `${this.baseURL}/${targetModel}:generateContent?key=${tokenInfo.token}`,
        requestBody,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: this.defaultTimeout
        }
      );

      const processingTimeMs = Date.now() - callStartTime;

      // 4. 估算token使用
      const inputTokens = this.estimateTokens(request.contents);
      const outputTokens = this.estimateTokensFromResponse(response.data);

      // 5. 记录日志
      if (traceId && this.loggingService) {
        try {
          await this.loggingService.logLLMCall({
            traceId,
            conversationId: undefined,
            sessionId: undefined,
            agentType: resolvedAgentType,
            modelName: targetModel,
            modelProvider: 'google',
            promptTemplate: resolvedPromptName,
            inputPrompt: JSON.stringify(request.contents),
            inputTokens,
            modelConfig: JSON.stringify(requestBody.generationConfig),
            rawResponse: JSON.stringify(response.data),
            processedResponse: this.extractTextFromResponse(response.data),
            outputTokens,
            apiCallTimeMs: processingTimeMs,
            processingTimeMs,
            status: 'SUCCESS',
            contextSummary: `Tool system call with ${request.tools?.length || 0} tools`
          });
        } catch (logError) {
          this.moduleLogger.error('Failed to log generateContent call', {
            traceId,
            error: logError instanceof Error ? logError.message : 'Unknown error'
          });
        }
      }

      this.moduleLogger.info('Direct LLM generateContent call successful', {
        modelName: targetModel,
        processingTimeMs,
        tokenId: tokenInfo.tokenId,
        hasTools: !!request.tools,
        toolCount: request.tools?.length || 0,
        agentType: resolvedAgentType,
        promptName: resolvedPromptName
      });

      return response.data;

    } catch (error: any) {
      const processingTimeMs = Date.now() - callStartTime;

      if (traceId && this.loggingService) {
        try {
          await this.loggingService.logLLMCall({
            traceId,
            conversationId: undefined,
            sessionId: undefined,
            agentType: resolvedAgentType,
            modelName: targetModel,
            modelProvider: 'google',
            promptTemplate: resolvedPromptName,
            inputPrompt: JSON.stringify(request.contents),
            inputTokens: 0,
            modelConfig: JSON.stringify(request.generationConfig || {}),
            rawResponse: undefined,
            processedResponse: undefined,
            outputTokens: 0,
            apiCallTimeMs: processingTimeMs,
            processingTimeMs,
            status: 'ERROR',
            errorMessage: error.message,
            errorCode: error.status?.toString() || 'UNKNOWN',
            contextSummary: 'Tool system call failed'
          });
        } catch (logError) {
          this.moduleLogger.error('Failed to log failed generateContent call', {
            traceId,
            error: logError instanceof Error ? logError.message : 'Unknown error'
          });
        }
      }

      if (this.isTokenError(error)) {
        await this.tokenManager.reportError(targetModel, error.message);
      }

      this.moduleLogger.error('Direct LLM generateContent call failed', {
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

  /**
   * 估算输入内容的 token 数量
   */
  private estimateTokens(contents: any[]): number {
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
    if (!response?.candidates?.[0]?.content?.parts) {
      return 0;
    }

    let totalChars = 0;
    for (const part of response.candidates[0].content.parts) {
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
    if (!response?.candidates?.[0]?.content?.parts) {
      return '';
    }

    const textParts: string[] = [];
    for (const part of response.candidates[0].content.parts) {
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

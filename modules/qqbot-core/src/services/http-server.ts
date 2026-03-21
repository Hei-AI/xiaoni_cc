import express, { Express, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { config } from '../config';
import MessageQueueService from './message-queue-service';

interface HttpServerConfig {
  port?: number;
  host?: string;
}

interface HttpServerServices {
  database?: any;
  websocketClient?: any;
  debugService?: any;
  qqBot?: any;
  aiService?: any; // 🔥 新增：AI服务，用于内部LLM调试
  messageQueueService?: MessageQueueService;
}

class HttpServer {
  private app: Express;
  private server: any;
  private moduleLogger = logger.createModuleLogger('http-server');
  private config: HttpServerConfig;
  private services: HttpServerServices;

  constructor(serverConfig?: HttpServerConfig, services?: HttpServerServices) {
    this.config = serverConfig || {};
    this.services = services || {};
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({
        status: 'healthy',
        service: 'qq-bot-core',
        timestamp: new Date().toISOString()
      });
    });

    // Status endpoint
    this.app.get('/api/status', (req: Request, res: Response) => {
      res.json({
        service: 'QQBot Core Service',
        status: 'running',
        port: this.config.port || config.http_server.port || 8081,
        timestamp: new Date().toISOString()
      });
    });

    // NOTE: Business API endpoints (send_private, send_group) have been moved to HTTP API Gateway
    // This improves separation of concerns - Core focuses on bot logic, Gateway handles external APIs

    // Internal API endpoints for HTTP Gateway communication
    this.app.post('/api/internal/send_private', async (req: Request, res: Response) => {
      const { user_id, message } = req.body;
      
      if (!user_id || !message) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: user_id, message',
          timestamp: new Date().toISOString()
        });
      }

      this.moduleLogger.info(`Internal API: 发送私聊消息`, { user_id, messageLength: message.length });
      
      try {
        if (this.services.websocketClient) {
          await this.services.websocketClient.sendPrivateMessage(user_id, message);
          res.json({
            success: true,
            message: 'Private message sent successfully',
            user_id: user_id,
            timestamp: new Date().toISOString()
          });
        } else {
          res.status(503).json({
            success: false,
            error: 'WebSocket client not available',
            timestamp: new Date().toISOString()
          });
        }
      } catch (error: any) {
        this.moduleLogger.error('Failed to send private message', { error: error.message, user_id });
        res.status(500).json({
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    this.app.post('/api/internal/send_group', async (req: Request, res: Response) => {
      const { group_id, message } = req.body;
      
      if (!group_id || !message) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: group_id, message',
          timestamp: new Date().toISOString()
        });
      }

      this.moduleLogger.info(`Internal API: 发送群聊消息`, { group_id, messageLength: message.length });
      
      try {
        if (this.services.websocketClient) {
          await this.services.websocketClient.sendGroupMessage(group_id, message);
          res.json({
            success: true,
            message: 'Group message sent successfully',
            group_id: group_id,
            timestamp: new Date().toISOString()
          });
        } else {
          res.status(503).json({
            success: false,
            error: 'WebSocket client not available',
            timestamp: new Date().toISOString()
          });
        }
      } catch (error: any) {
        this.moduleLogger.error('Failed to send group message', { error: error.message, group_id });
        res.status(500).json({
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // 🔥 新增：Stage 2测试端点，用于模拟用户消息
    this.app.post('/api/test/simulate-message', async (req: Request, res: Response) => {
      try {
        const { message } = req.body;
        
        if (!message) {
          return res.status(400).json({
            success: false,
            error: 'Missing message parameter',
            timestamp: new Date().toISOString()
          });
        }

        this.moduleLogger.info('🧪 Testing: Simulating user message', { 
          messageType: message.message_type,
          userId: message.user_id,
          messagePreview: message.raw_message?.substring(0, 50)
        });

        // 直接调用QQ Bot的消息处理逻辑
        if (this.services.qqBot) {
          // 模拟WebSocket事件数据
          const eventData = {
            traceId: `test_${Date.now()}_${Math.random().toString(36).substr(2, 8)}_${message.user_id}`
          };

          if (message.message_type === 'private') {
            await this.services.qqBot.simulatePrivateMessageSimple(message, eventData);
          } else if (message.message_type === 'group') {
            await this.services.qqBot.simulateGroupMessageSimple(message, eventData);
          } else {
            throw new Error(`Unsupported message type: ${message.message_type}`);
          }

          res.json({
            success: true,
            message: 'Message simulation completed',
            trace_id: eventData.traceId,
            timestamp: new Date().toISOString()
          });
        } else {
          res.status(503).json({
            success: false,
            error: 'QQ Bot instance not available',
            timestamp: new Date().toISOString()
          });
        }

      } catch (error: any) {
        this.moduleLogger.error('Message simulation failed', { 
          error: error.message,
          stack: error.stack
        });
        res.status(500).json({
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // 🔥 增强的内部LLM调试接口 - 支持 provider-aware 调试
    this.app.post('/api/internal/llm/debug', async (req: Request, res: Response) => {
      try {
        const {
          systemPrompt,
          userInput,
          messages = [],
          parameters: incomingParameters = {},
          model = 'gemini-2.5-flash',
          conversation_id
        } = req.body;

        const parameters = this.normalizeDebugParameters(incomingParameters);
        const finalMessages = Array.isArray(messages) && messages.length > 0
          ? messages
          : (typeof userInput === 'string' && userInput.trim().length > 0
            ? [{ role: 'user', content: userInput }]
            : []);

        if (finalMessages.length === 0) {
          return res.status(400).json({
            success: false,
            error: 'Either messages array or userInput string is required',
            timestamp: new Date().toISOString()
          });
        }

        if (!this.services.aiService) {
          return res.status(503).json({
            success: false,
            error: 'AI Service not available',
            timestamp: new Date().toISOString()
          });
        }

        const advancedConfig = parameters.advanced_config || {};
        const modelConfig = parameters.model_config || {};
        const provider = this.resolveDebugProvider(parameters, model);
        const resolvedModel = typeof model === 'string' && model.trim().length > 0
          ? model
          : this.resolveDefaultModelForProvider(provider);

        const selectFirstDefined = <T>(...values: Array<T | undefined | null>): T | undefined => {
          for (const value of values) {
            if (value !== undefined && value !== null) {
              return value;
            }
          }
          return undefined;
        };

        const mergedGenerationConfig = {
          ...(advancedConfig.generationConfig && typeof advancedConfig.generationConfig === 'object'
            ? advancedConfig.generationConfig
            : {}),
          ...(parameters.generationConfig && typeof parameters.generationConfig === 'object'
            ? parameters.generationConfig
            : {})
        };

        const generationConfig: Record<string, unknown> = {
          ...mergedGenerationConfig,
          temperature: selectFirstDefined(
            mergedGenerationConfig.temperature,
            advancedConfig.temperature,
            modelConfig.temperature,
            parameters.temperature
          ) ?? 0.7,
          maxOutputTokens: selectFirstDefined(
            mergedGenerationConfig.maxOutputTokens,
            advancedConfig.maxOutputTokens,
            modelConfig.maxOutputTokens,
            parameters.maxOutputTokens,
            (parameters as any).max_output_tokens
          ) ?? 1000,
          topP: selectFirstDefined(
            mergedGenerationConfig.topP,
            advancedConfig.topP,
            modelConfig.topP,
            parameters.topP,
            (parameters as any).top_p
          ) ?? 0.95,
          topK: selectFirstDefined(
            mergedGenerationConfig.topK,
            advancedConfig.topK,
            modelConfig.topK,
            parameters.topK,
            (parameters as any).top_k
          ) ?? 40
        };

        const stopSequences = selectFirstDefined(
          mergedGenerationConfig.stopSequences,
          advancedConfig.stopSequences,
          modelConfig.stopSequences,
          parameters.stopSequences,
          (parameters as any).stop_sequences
        );
        if (stopSequences !== undefined) {
          generationConfig.stopSequences = stopSequences;
        }

        const rawThinkingConfig = selectFirstDefined(
          mergedGenerationConfig.thinkingConfig,
          advancedConfig.thinkingConfig,
          parameters.thinkingConfig
        );

        const normalizedThinkingConfig: Record<string, unknown> = {};
        if (rawThinkingConfig && typeof rawThinkingConfig === 'object') {
          if (typeof rawThinkingConfig.includeThoughts === 'boolean') {
            normalizedThinkingConfig.includeThoughts = rawThinkingConfig.includeThoughts;
          }
          if (
            typeof rawThinkingConfig.thinkingBudget === 'number' &&
            !Number.isNaN(rawThinkingConfig.thinkingBudget)
          ) {
            normalizedThinkingConfig.thinkingBudget = rawThinkingConfig.thinkingBudget;
          }
          if ((rawThinkingConfig as any).responseSchema) {
            generationConfig.responseSchema = (rawThinkingConfig as any).responseSchema;
          }
        }

        const toolsConfig = advancedConfig.toolsConfig && typeof advancedConfig.toolsConfig === 'object'
          ? advancedConfig.toolsConfig
          : {};
        const requestBody: Record<string, unknown> = {
          contents: finalMessages.map((message: any) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: typeof message.content === 'string' ? message.content : '' }]
          })),
          generationConfig,
          safetySettings: Array.isArray(advancedConfig.safetySettings) ? advancedConfig.safetySettings : []
        };

        const debugTools = this.buildDebugTools(toolsConfig);
        if (debugTools.length > 0) {
          requestBody.tools = debugTools;
        }

        const debugToolConfig = this.buildDebugToolConfig(toolsConfig);
        if (debugToolConfig) {
          requestBody.toolConfig = debugToolConfig;
        }

        if (Object.keys(normalizedThinkingConfig).length > 0) {
          requestBody.thinkingConfig = normalizedThinkingConfig;
        }

        if (typeof systemPrompt === 'string' && systemPrompt.trim().length > 0) {
          requestBody.systemInstruction = systemPrompt;
        }

        const configOverride = this.buildDebugConfig({
          provider,
          modelName: resolvedModel,
          systemPrompt: typeof systemPrompt === 'string' ? systemPrompt : '',
          generationConfig,
          thinkingConfig: normalizedThinkingConfig,
          safetySettings: Array.isArray(advancedConfig.safetySettings) ? advancedConfig.safetySettings : [],
          toolsConfig,
          providerSpecific:
            (modelConfig.providerSpecific && typeof modelConfig.providerSpecific === 'object')
              ? modelConfig.providerSpecific
              : {},
          allowedTokenIds: Array.isArray(parameters.allowed_token_ids) ? parameters.allowed_token_ids : []
        });

        const startedAt = Date.now();
        const llmResponse = await this.services.aiService.generateContent(requestBody, {
          modelName: resolvedModel,
          conversationId: conversation_id,
          agentType: 'playground_debug',
          promptName: 'playground_debug',
          configOverride
        });

        const aiResponse = this.extractResponseText(llmResponse);
        const thinking = this.extractThinkingText(llmResponse);
        const processingTimeMs = Date.now() - startedAt;

        res.json({
          success: true,
          response: aiResponse,
          thinking: thinking || undefined,
          model: typeof llmResponse.model === 'string' ? llmResponse.model : resolvedModel,
          provider,
          performance: {
            processing_time_ms: (llmResponse.performance as any)?.processing_time_ms ?? processingTimeMs,
            api_call_time_ms: (llmResponse.performance as any)?.api_call_time_ms ?? processingTimeMs
          },
          usage: llmResponse.usage || llmResponse.usageMetadata,
          canonical_request: llmResponse.canonical_request || null,
          wire_request: llmResponse.wire_request || null,
          canonical_response: llmResponse.canonical_response || null,
          wire_response: llmResponse.wire_response || null,
          raw_response: llmResponse.raw_response || llmResponse,
          debug_metadata: llmResponse.debug_metadata || null,
          timestamp: new Date().toISOString()
        });

        this.moduleLogger.info('Internal LLM Debug API succeeded', {
          provider,
          model: resolvedModel,
          conversation_id,
          messageCount: finalMessages.length,
          processingTimeMs
        });
      } catch (error: any) {
        this.moduleLogger.error('Internal LLM Debug API failed', {
          error: error.message,
          stack: error.stack
        });
        res.status(500).json({
          success: false,
          error: 'Failed to execute debug request',
          message: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    if (this.services.messageQueueService) {
      this.setupSimpleQueueRoutes();
    }

    // NOTE: Debug and test endpoints have been moved to Admin Panel Backend
    // This separation improves module responsibility and security
    // For debugging features, use Admin Panel at port 9080

  }

  private setupSimpleQueueRoutes(): void {
    const queueService = this.services.messageQueueService;
    if (!queueService) return;

    this.moduleLogger.info('Registering simple queue monitor endpoints');

    this.app.get('/api/simple-queue/stats', (req: Request, res: Response) => {
      try {
        const stats = queueService.getStats();
        res.json({
          success: true,
          data: {
            partition_count: stats.totalPartitions ?? stats.partitionCount ?? 0,
            active_partitions: stats.activePartitions ?? 0,
            total_messages: stats.totalMessages ?? 0,
            processed_messages: stats.processedMessages ?? 0,
            avg_messages_per_partition: stats.avgMessagesPerPartition ?? 0,
            last_cleanup_at: stats.lastCleanupAt ? new Date(stats.lastCleanupAt).toISOString() : null
          }
        });
      } catch (error) {
        this.moduleLogger.error('Failed to load queue stats', { error });
        res.status(500).json({ success: false, error: 'Failed to load queue statistics' });
      }
    });

    this.app.post('/api/internal/config-cache/clear', (req: Request, res: Response) => {
      try {
        if (!this.services.aiService) {
          return res.status(503).json({
            success: false,
            error: 'AI Service not available',
            timestamp: new Date().toISOString()
          });
        }

        const agentType = typeof req.body?.agentType === 'string' ? req.body.agentType : undefined;
        this.services.aiService.clearConfigurationCache(agentType);

        res.json({
          success: true,
          agentType: agentType || 'all',
          timestamp: new Date().toISOString()
        });
      } catch (error: any) {
        this.moduleLogger.error('Failed to clear configuration cache', {
          error: error?.message || error
        });
        res.status(500).json({
          success: false,
          error: error?.message || 'Failed to clear configuration cache',
          timestamp: new Date().toISOString()
        });
      }
    });

    this.app.get('/api/simple-queue/config', (req: Request, res: Response) => {
      try {
        const configSnapshot = queueService.getRuntimeConfig();
        res.json({ success: true, config: configSnapshot });
      } catch (error) {
        this.moduleLogger.error('Failed to load queue config', { error });
        res.status(500).json({ success: false, error: 'Failed to load queue config' });
      }
    });

    this.app.get('/api/simple-queue/partitions', (req: Request, res: Response) => {
      try {
        const partitions = queueService.getAllPartitions().map((partition) => ({
          partition_key: partition.partitionKey,
          type: partition.type === 'user' ? 'private' : 'group',
          queue_size: partition.messageCount,
          last_activity: partition.lastProcessedAt ? partition.lastProcessedAt.toISOString() : null,
          processing: 0,
          status: partition.messageCount > 0 ? 'pending' : 'idle'
        }));

        res.json({ success: true, data: partitions });
      } catch (error) {
        this.moduleLogger.error('Failed to list queue partitions', { error });
        res.status(500).json({ success: false, error: 'Failed to list queue partitions' });
      }
    });

    this.app.get('/api/simple-queue/partitions/:partitionKey', (req: Request, res: Response) => {
      try {
        const snapshot = queueService.getPartitionSnapshot(req.params.partitionKey, 20);
        if (!snapshot) {
          return res.status(404).json({ success: false, error: 'Partition not found' });
        }

        res.json({ success: true, data: snapshot });
      } catch (error) {
        this.moduleLogger.error('Failed to load partition snapshot', { error });
        res.status(500).json({ success: false, error: 'Failed to load partition information' });
      }
    });

    this.app.delete('/api/simple-queue/partitions/:partitionKey', (req: Request, res: Response) => {
      try {
        const cleared = queueService.clearPartition(req.params.partitionKey);
        res.json({
          success: true,
          data: {
            partitionKey: req.params.partitionKey,
            clearedMessages: cleared
          }
        });
      } catch (error) {
        this.moduleLogger.error('Failed to clear partition', { error });
        res.status(500).json({ success: false, error: 'Failed to clear partition' });
      }
    });

    this.app.post('/api/simple-queue/simulate/private', async (req: Request, res: Response) => {
      try {
        const { user_id, message, priority } = req.body;

        if (user_id === undefined || !message) {
          return res.status(400).json({ success: false, error: 'Missing user_id or message' });
        }

        const result = await queueService.simulatePrivateMessage({
          user_id: Number(user_id),
          message: String(message),
          priority
        });

        res.json({ success: true, data: result });
      } catch (error) {
        this.moduleLogger.error('Failed to simulate private message', { error });
        res.status(500).json({ success: false, error: 'Failed to simulate private message' });
      }
    });

    this.app.post('/api/simple-queue/simulate/group', async (req: Request, res: Response) => {
      try {
        const { user_id, group_id, message, atBot, priority } = req.body;

        if (user_id === undefined || group_id === undefined || !message) {
          return res.status(400).json({ success: false, error: 'Missing user_id, group_id or message' });
        }

        const result = await queueService.simulateGroupMessage({
          user_id: Number(user_id),
          group_id: Number(group_id),
          message: String(message),
          atBot: Boolean(atBot),
          priority
        });

        res.json({ success: true, data: result });
      } catch (error) {
        this.moduleLogger.error('Failed to simulate group message', { error });
        res.status(500).json({ success: false, error: 'Failed to simulate group message' });
      }
    });

    this.app.post('/api/simple-queue/simulate/batch', async (req: Request, res: Response) => {
      try {
        const { messages } = req.body;

        if (!Array.isArray(messages) || messages.length === 0) {
          return res.status(400).json({ success: false, error: 'messages must be a non-empty array' });
        }

        const traceIds = await queueService.simulateBatch(messages.map((msg: any) => ({
          type: msg.type,
          user_id: Number(msg.user_id),
          group_id: msg.group_id !== undefined ? Number(msg.group_id) : undefined,
          message: String(msg.message),
          priority: msg.priority,
          atBot: msg.atBot
        })));

        res.json({
          success: true,
          data: {
            traceIds,
            messageCount: traceIds.length
          }
        });
      } catch (error) {
        this.moduleLogger.error('Failed to simulate batch messages', { error });
        res.status(500).json({ success: false, error: 'Failed to simulate messages' });
      }
    });
  }

  private resolveDebugProvider(parameters: Record<string, any>, modelName?: string): 'google-gemini-cli' | 'google-legacy' | 'openai' | 'codex' {
    const modelConfig = parameters.model_config && typeof parameters.model_config === 'object'
      ? parameters.model_config
      : {};
    const advancedConfig = parameters.advanced_config && typeof parameters.advanced_config === 'object'
      ? parameters.advanced_config
      : {};

    const explicitProvider = (
      modelConfig.provider ||
      advancedConfig.provider ||
      (advancedConfig.model && typeof advancedConfig.model === 'object' ? advancedConfig.model.provider : undefined)
    );

    const normalized = typeof explicitProvider === 'string' ? explicitProvider.trim().toLowerCase() : '';
    if (normalized === 'openai') return 'openai';
    if (normalized === 'codex' || normalized === 'openai-codex') return 'codex';
    if (normalized === 'google-legacy' || normalized === 'gemini-api') return 'google-legacy';

    const normalizedModel = (modelName || '').trim().toLowerCase();
    if (normalizedModel.startsWith('gpt-') || normalizedModel.startsWith('o1') || normalizedModel.startsWith('o3') || normalizedModel.startsWith('o4')) {
      return 'openai';
    }
    if (normalizedModel.includes('codex')) {
      return 'codex';
    }

    return 'google-gemini-cli';
  }

  private resolveDefaultModelForProvider(provider: 'google-gemini-cli' | 'google-legacy' | 'openai' | 'codex'): string {
    switch (provider) {
      case 'openai':
        return 'gpt-5-mini';
      case 'codex':
        return 'gpt-5.2-codex';
      case 'google-legacy':
        return 'gemini-2.5-flash';
      case 'google-gemini-cli':
      default:
        return 'gemini-2.5-flash';
    }
  }

  private buildDebugTools(toolsConfig: Record<string, any>): any[] {
    const customTools = Array.isArray(toolsConfig.customTools) ? toolsConfig.customTools : [];
    const normalizedDeclarations = customTools
      .filter((tool: any) => tool && typeof tool.name === 'string' && tool.name.trim().length > 0)
      .map((tool: any) => ({
        name: tool.name,
        description: typeof tool.description === 'string' ? tool.description : '',
        parameters: tool.parameters && typeof tool.parameters === 'object'
          ? tool.parameters
          : { type: 'object', properties: {} }
      }));

    return normalizedDeclarations.length > 0
      ? [{ functionDeclarations: normalizedDeclarations }]
      : [];
  }

  private buildDebugToolConfig(toolsConfig: Record<string, any>): any | undefined {
    const functionCalling = toolsConfig.functionCalling && typeof toolsConfig.functionCalling === 'object'
      ? toolsConfig.functionCalling
      : {};
    const mode = typeof functionCalling.mode === 'string'
      ? functionCalling.mode
      : typeof toolsConfig.mode === 'string'
        ? toolsConfig.mode
        : undefined;

    if (!mode) {
      return undefined;
    }

    return {
      functionCallingConfig: {
        mode
      }
    };
  }

  private buildDebugConfig(params: {
    provider: 'google-gemini-cli' | 'google-legacy' | 'openai' | 'codex';
    modelName: string;
    systemPrompt: string;
    generationConfig: Record<string, unknown>;
    thinkingConfig: Record<string, unknown>;
    safetySettings: Array<Record<string, unknown>>;
    toolsConfig: Record<string, unknown>;
    providerSpecific: Record<string, unknown>;
    allowedTokenIds: number[];
  }): any {
    return {
      id: 'internal-debug-config',
      name: 'Internal Debug Config',
      category: 'custom',
      model: {
        name: params.modelName,
        provider: params.provider,
        allowedTokenIds: params.allowedTokenIds,
        providerSpecific: params.providerSpecific
      },
      generation: params.generationConfig,
      ...(Object.keys(params.thinkingConfig).length > 0 ? { thinking: params.thinkingConfig } : {}),
      safety: params.safetySettings,
      tools: {
        functionCalling: this.buildDebugToolConfig(params.toolsConfig)?.functionCallingConfig,
        customTools: Array.isArray(params.toolsConfig.customTools) ? params.toolsConfig.customTools : []
      },
      context: {
        systemInstruction: params.systemPrompt,
        variables: {}
      },
      performance: {
        timeout: 30000
      },
      version: {
        version: 'internal-debug',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'system',
        isActive: true
      }
    };
  }

  private extractResponseText(response: any): string {
    if (typeof response?.text === 'string' && response.text.trim().length > 0) {
      return response.text.trim();
    }

    const parts = response?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
      return '';
    }

    return parts
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  private extractThinkingText(response: any): string {
    const canonicalResponse = response?.canonical_response || response?.debug_metadata?.canonicalResponse;
    const output = Array.isArray(canonicalResponse?.output) ? canonicalResponse.output : [];
    const reasoning = output
      .filter((item: any) => item?.type === 'reasoning')
      .flatMap((item: any) => {
        const segments: string[] = [];
        if (typeof item.content === 'string') {
          segments.push(item.content);
        }
        if (Array.isArray(item.summary)) {
          segments.push(
            ...item.summary
              .map((entry: any) => (typeof entry?.text === 'string' ? entry.text : ''))
              .filter(Boolean)
          );
        }
        return segments;
      })
      .filter(Boolean)
      .join('\n');

    if (reasoning.trim().length > 0) {
      return reasoning.trim();
    }

    const thoughts = Array.isArray(response?.thoughts) ? response.thoughts : [];
    return thoughts
      .map((entry: any) => (typeof entry?.text === 'string' ? entry.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  private normalizeDebugParameters(parameters: any): Record<string, any> {
    if (!parameters || typeof parameters !== 'object') {
      return {};
    }

    const normalized: Record<string, any> = { ...parameters };

    if (normalized.temperature !== undefined && typeof normalized.temperature === 'string') {
      const parsed = Number(normalized.temperature);
      if (!Number.isNaN(parsed)) {
        normalized.temperature = parsed;
      }
    }

    if (normalized.maxOutputTokens !== undefined && typeof normalized.maxOutputTokens === 'string') {
      const parsed = Number(normalized.maxOutputTokens);
      if (!Number.isNaN(parsed)) {
        normalized.maxOutputTokens = parsed;
      }
    }

    return normalized;
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const port = this.config.port || config.http_server.port || 8081;
      const host = this.config.host || config.http_server.host || '0.0.0.0';

      this.server = this.app.listen(port, host, () => {
        this.moduleLogger.info(`HTTP服务器已启动 - ${host}:${port}`);
        resolve();
      });

      this.server.on('error', (error: any) => {
        this.moduleLogger.error(`HTTP服务器启动失败: ${error.message}`);
        reject(error);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.moduleLogger.info('HTTP服务器已关闭');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public getApp(): Express {
    return this.app;
  }

}

export default HttpServer;

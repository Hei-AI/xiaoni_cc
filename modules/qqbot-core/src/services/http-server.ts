import express, { Express, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { config } from '../config';
import MessageQueueService from './message-queue-service';
import EmbeddingService, {
  OpenAIEmbeddingListResponse,
  OpenAIModelListResponse
} from './embedding-service';
import {
  AgentProactivityRuntimeConfig
} from './agent-memory-service';

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
  embeddingService?: EmbeddingService;
  messageQueueService?: MessageQueueService;
  agentMemoryService?: any;
  getProactivityDefaults?: () => AgentProactivityRuntimeConfig;
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

    this.setupEmbeddingRoutes();

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
          canonicalRequest,
          configOverride,
          executionMode,
          systemPrompt,
          userInput,
          messages = [],
          parameters: incomingParameters = {},
          model = 'gemini-2.5-flash',
          conversation_id
        } = req.body;

        if (!this.services.aiService) {
          return res.status(503).json({
            success: false,
            error: 'AI Service not available',
            timestamp: new Date().toISOString()
          });
        }

        const hasCanonicalRequest = Boolean(
          canonicalRequest &&
          typeof canonicalRequest === 'object' &&
          !Array.isArray(canonicalRequest)
        );
        const parameters = this.normalizeDebugParameters(incomingParameters);
        const finalMessages = Array.isArray(messages) && messages.length > 0
          ? messages
          : (typeof userInput === 'string' && userInput.trim().length > 0
            ? [{ role: 'user', content: userInput }]
            : []);

        const parsedConfigOverride = configOverride && typeof configOverride === 'object' && !Array.isArray(configOverride)
          ? configOverride
          : null;
        const explicitProvider = typeof (parsedConfigOverride as any)?.model?.provider === 'string'
          ? (parsedConfigOverride as any).model.provider
          : null;
        const provider = explicitProvider || this.resolveDebugProvider(parameters, model);
        const canonicalRequestModel = typeof canonicalRequest?.model === 'string'
          ? canonicalRequest.model
          : typeof canonicalRequest?.model?.name === 'string'
            ? canonicalRequest.model.name
            : null;
        const resolvedModel = canonicalRequestModel
          || (typeof model === 'string' && model.trim().length > 0 ? model : '')
          || (typeof (parsedConfigOverride as any)?.model?.name === 'string' ? (parsedConfigOverride as any).model.name : '')
          || this.resolveDefaultModelForProvider(provider);

        const selectFirstDefined = <T>(...values: Array<T | undefined | null>): T | undefined => {
          for (const value of values) {
            if (value !== undefined && value !== null) {
              return value;
            }
          }
          return undefined;
        };

        let requestBody: Record<string, unknown>;
        let effectiveConfigOverride: Record<string, unknown> | null;
        let contentMessages: Array<Record<string, unknown>>;

        if (hasCanonicalRequest) {
          requestBody = {
            ...(canonicalRequest as Record<string, unknown>),
            model: resolvedModel
          };
          effectiveConfigOverride = parsedConfigOverride;
          contentMessages = Array.isArray((canonicalRequest as any).input)
            ? (canonicalRequest as any).input.filter((item: any) => item?.type === 'message')
            : [];
        } else {
          const systemPromptParts = [
            typeof systemPrompt === 'string' ? systemPrompt.trim() : '',
            ...finalMessages
              .filter((message: any) => message?.role === 'system')
              .map((message: any) => (typeof message?.content === 'string' ? message.content.trim() : ''))
              .filter(Boolean)
          ].filter(Boolean);
          const mergedSystemPrompt = systemPromptParts.join('\n\n');
          contentMessages = finalMessages.filter((message: any) => message?.role !== 'system');

          if (contentMessages.length === 0) {
            return res.status(400).json({
              success: false,
              error: 'At least one non-system message or userInput string is required',
              timestamp: new Date().toISOString()
            });
          }

          const advancedConfig = parameters.advanced_config || {};
          const modelConfig = parameters.model_config || {};
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
          requestBody = {
            contents: contentMessages.map((message: any) => ({
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

          if (mergedSystemPrompt.length > 0) {
            requestBody.systemInstruction = mergedSystemPrompt;
          }

          effectiveConfigOverride = this.buildDebugConfig({
            provider,
            modelName: resolvedModel,
            systemPrompt: mergedSystemPrompt,
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
        }

        const startedAt = Date.now();
        const debugTraceId = `playground_debug_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const llmResponse = await this.services.aiService.generateContent(requestBody, debugTraceId, {
          modelName: resolvedModel,
          conversationId: conversation_id,
          agentType: 'playground_debug',
          promptName: typeof executionMode === 'string' ? executionMode : 'playground_debug',
          configOverride: effectiveConfigOverride as any
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
          effective_unified_config: effectiveConfigOverride || null,
          debug_metadata: llmResponse.debug_metadata || null,
          trace_id: debugTraceId,
          timestamp: new Date().toISOString()
        });

        this.moduleLogger.info('Internal LLM Debug API succeeded', {
          provider,
          model: resolvedModel,
          conversation_id,
          messageCount: contentMessages.length,
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

    this.app.get('/api/internal/proactivity', async (_req: Request, res: Response) => {
      try {
        if (!this.services.agentMemoryService || !this.services.getProactivityDefaults) {
          return res.status(503).json({
            success: false,
            error: 'Proactivity service not available',
            timestamp: new Date().toISOString()
          });
        }

        const data = await this.services.agentMemoryService.getProactivityControls(
          this.services.getProactivityDefaults()
        );

        return res.json({
          success: true,
          data,
          timestamp: new Date().toISOString()
        });
      } catch (error: any) {
        this.moduleLogger.error('Failed to fetch proactivity controls', { error: error?.message || error });
        return res.status(500).json({
          success: false,
          error: error?.message || 'Failed to fetch proactivity controls',
          timestamp: new Date().toISOString()
        });
      }
    });

    this.app.patch('/api/internal/proactivity', async (req: Request, res: Response) => {
      try {
        if (!this.services.agentMemoryService || !this.services.getProactivityDefaults) {
          return res.status(503).json({
            success: false,
            error: 'Proactivity service not available',
            timestamp: new Date().toISOString()
          });
        }

        const normalizedPatch = this.normalizeProactivityPatch(req.body);
        const data = await this.services.agentMemoryService.updateProactivityControls(
          normalizedPatch,
          this.services.getProactivityDefaults()
        );

        return res.json({
          success: true,
          data,
          timestamp: new Date().toISOString()
        });
      } catch (error: any) {
        const message = error instanceof Error ? error.message : 'Failed to update proactivity controls';
        const status = message.includes('invalid') || message.includes('must') ? 400 : 500;
        this.moduleLogger.error('Failed to update proactivity controls', { error: message });
        return res.status(status).json({
          success: false,
          error: message,
          timestamp: new Date().toISOString()
        });
      }
    });

    this.app.post('/api/internal/cognition/recompute', async (req: Request, res: Response) => {
      try {
        if (!this.services.agentMemoryService) {
          return res.status(503).json({
            success: false,
            error: 'Cognition service not available',
            timestamp: new Date().toISOString()
          });
        }

        const subjectType = String(req.body?.subject_type || '').trim();
        const subjectId = req.body?.subject_id;
        const groupId = req.body?.group_id ?? null;

        if (!['user', 'group', 'self'].includes(subjectType) || subjectId === undefined || subjectId === null || subjectId === '') {
          return res.status(400).json({
            success: false,
            error: 'subject_type and subject_id are required',
            timestamp: new Date().toISOString()
          });
        }

        const data = await this.services.agentMemoryService.recomputeDerivedPlansForSubject({
          subjectType,
          subjectId,
          groupId
        });

        return res.json({
          success: true,
          data,
          timestamp: new Date().toISOString()
        });
      } catch (error: any) {
        const message = error instanceof Error ? error.message : 'Failed to recompute cognition state';
        this.moduleLogger.error('Failed to recompute cognition state', { error: message });
        return res.status(500).json({
          success: false,
          error: message,
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

  private setupEmbeddingRoutes(): void {
    this.app.get('/v1/models', (req: Request, res: Response) => {
      const embeddingService = this.services.embeddingService;

      if (!embeddingService || !embeddingService.isEnabled()) {
        return this.sendOpenAIError(res, 503, 'Embedding service is not enabled', 'service_unavailable', null, 'embedding_unavailable');
      }

      const payload: OpenAIModelListResponse = embeddingService.listModels();
      res.json(payload);
    });

    this.app.post('/v1/embeddings', async (req: Request, res: Response) => {
      const embeddingService = this.services.embeddingService;

      if (!embeddingService || !embeddingService.isEnabled()) {
        return this.sendOpenAIError(res, 503, 'Embedding service is not enabled', 'service_unavailable', null, 'embedding_unavailable');
      }

      const requestedModel = typeof req.body?.model === 'string'
        ? req.body.model.trim()
        : embeddingService.getPublicModelId();

      if (requestedModel !== embeddingService.getPublicModelId()) {
        return this.sendOpenAIError(
          res,
          400,
          `Unsupported model: ${requestedModel}`,
          'invalid_request_error',
          'model',
          'invalid_model'
        );
      }

      if (req.body?.encoding_format !== undefined && req.body.encoding_format !== 'float') {
        return this.sendOpenAIError(
          res,
          400,
          'Only encoding_format "float" is supported',
          'invalid_request_error',
          'encoding_format',
          'unsupported_encoding_format'
        );
      }

      if (req.body?.dimensions !== undefined) {
        if (!Number.isInteger(req.body.dimensions) || req.body.dimensions !== embeddingService.getDimensions()) {
          return this.sendOpenAIError(
            res,
            400,
            `Only dimensions=${embeddingService.getDimensions()} is supported`,
            'invalid_request_error',
            'dimensions',
            'unsupported_dimensions'
          );
        }
      }

      let normalizedInput: string | string[];
      try {
        normalizedInput = this.normalizeEmbeddingInput(req.body?.input);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid embedding input';
        return this.sendOpenAIError(res, 400, message, 'invalid_request_error', 'input', 'invalid_input');
      }

      try {
        const payload: OpenAIEmbeddingListResponse = await embeddingService.createEmbeddings({
          input: normalizedInput,
          model: requestedModel,
          user: typeof req.body?.user === 'string' ? req.body.user : undefined
        });
        res.json(payload);
      } catch (error) {
        this.moduleLogger.error('Failed to serve embedding request', {
          error: error instanceof Error ? error.message : String(error)
        });

        return this.sendOpenAIError(
          res,
          502,
          error instanceof Error ? error.message : 'Embedding upstream request failed',
          'api_error',
          null,
          'embedding_upstream_failed'
        );
      }
    });

    this.app.get('/api/internal/embedding/health', async (req: Request, res: Response) => {
      const embeddingService = this.services.embeddingService;

      if (!embeddingService || !embeddingService.isEnabled()) {
        return res.status(503).json({
          success: false,
          error: 'Embedding service is not enabled',
          timestamp: new Date().toISOString()
        });
      }

      try {
        const health = await embeddingService.healthCheck();
        res.json({
          success: true,
          data: health,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.moduleLogger.error('Embedding health check failed', {
          error: error instanceof Error ? error.message : String(error)
        });
        res.status(502).json({
          success: false,
          error: error instanceof Error ? error.message : 'Embedding health check failed',
          timestamp: new Date().toISOString()
        });
      }
    });
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

  private normalizeEmbeddingInput(input: unknown): string | string[] {
    if (typeof input === 'string') {
      if (input.trim().length === 0) {
        throw new Error('input must not be empty');
      }
      return input;
    }

    if (!Array.isArray(input) || input.length === 0) {
      throw new Error('input must be a non-empty string or array of strings');
    }

    const normalized = input.map((entry) => {
      if (typeof entry !== 'string' || entry.trim().length === 0) {
        throw new Error('input array must contain only non-empty strings');
      }
      return entry;
    });

    return normalized;
  }

  private normalizeProactivityPatch(body: Record<string, unknown> | undefined): Partial<AgentProactivityRuntimeConfig> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('invalid proactivity payload');
    }

    const patch: Partial<AgentProactivityRuntimeConfig> = {};

    if (body.followup_enabled !== undefined) {
      patch.followupEnabled = this.parseBooleanField(body.followup_enabled, 'followup_enabled');
    }

    if (body.is_paused !== undefined) {
      patch.isPaused = this.parseBooleanField(body.is_paused, 'is_paused');
    }

    if (body.allowed_user_ids !== undefined) {
      patch.allowedUserIds = this.parseAllowedUserIds(body.allowed_user_ids);
    }

    if (body.observed_group_ids !== undefined) {
      patch.observedGroupIds = this.parseAllowedUserIds(body.observed_group_ids);
    }

    if (body.allowed_group_ids !== undefined) {
      patch.allowedGroupIds = this.parseAllowedUserIds(body.allowed_group_ids);
    }

    if (body.max_per_run !== undefined) {
      patch.maxPerRun = this.parseIntegerField(body.max_per_run, 'max_per_run', 1, 5);
    }

    if (body.retry_delay_ms !== undefined) {
      patch.retryDelayMs = this.parseIntegerField(body.retry_delay_ms, 'retry_delay_ms', 60_000);
    }

    return patch;
  }

  private parseBooleanField(value: unknown, fieldName: string): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (value === 1 || value === '1' || value === 'true') {
      return true;
    }
    if (value === 0 || value === '0' || value === 'false') {
      return false;
    }
    throw new Error(`${fieldName} must be a boolean`);
  }

  private parseIntegerField(value: unknown, fieldName: string, min: number, max?: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      throw new Error(`${fieldName} must be an integer`);
    }
    if (parsed < min) {
      throw new Error(`${fieldName} must be >= ${min}`);
    }
    if (typeof max === 'number' && parsed > max) {
      throw new Error(`${fieldName} must be <= ${max}`);
    }
    return parsed;
  }

  private parseAllowedUserIds(value: unknown): number[] {
    let rawValues: unknown[] = [];

    if (Array.isArray(value)) {
      rawValues = value;
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return [];
      }
      try {
        const parsed = JSON.parse(trimmed);
        rawValues = Array.isArray(parsed) ? parsed : trimmed.split(',');
      } catch {
        rawValues = trimmed.split(',');
      }
    } else {
      throw new Error('allowed_user_ids must be an array or comma-separated string');
    }

    return Array.from(
      new Set(
        rawValues
          .map(item => Number(String(item).trim()))
          .filter(item => Number.isFinite(item) && item > 0)
      )
    );
  }

  private sendOpenAIError(
    res: Response,
    status: number,
    message: string,
    type: string,
    param: string | null,
    code: string
  ): Response {
    return res.status(status).json({
      error: {
        message,
        type,
        param,
        code
      }
    });
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

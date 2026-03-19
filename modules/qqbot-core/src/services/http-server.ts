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

    // 🔥 增强的内部LLM调试接口 - 支持多轮对话和完整配置
    this.app.post('/api/internal/llm/debug', async (req: Request, res: Response) => {
      try {
        const {
          systemPrompt,
          userInput,          // 向后兼容单条消息
          messages = [],      // 🔥 新增: 多轮对话消息数组
          parameters: incomingParameters = {},
          model = 'gemini-2.5-flash',
          conversation_id
        } = req.body;

        const parameters = this.normalizeDebugParameters(incomingParameters);

        // 🔥 参数验证: 支持messages数组或单个userInput
        let finalMessages = [];
        if (messages && Array.isArray(messages) && messages.length > 0) {
          finalMessages = messages;
        } else if (userInput && typeof userInput === 'string') {
          // 向后兼容: 单个userInput转换为messages格式
          finalMessages = [{ role: 'user', content: userInput }];
        } else {
          return res.status(400).json({
            success: false,
            error: 'Either messages array or userInput string is required',
            timestamp: new Date().toISOString()
          });
        }

        this.moduleLogger.info('Internal LLM Debug API called', {
          hasSystemPrompt: !!systemPrompt,
          messageCount: finalMessages.length,
          model,
          conversation_id,
          isMultiTurn: finalMessages.length > 1
        });

        // 🔥 复用企业级AIService，而非重复实现Token管理
        if (!this.services.aiService) {
          return res.status(503).json({
            success: false,
            error: 'AI Service not available',
            timestamp: new Date().toISOString()
          });
        }

        // 🔥 直接调用TokenManager和AI API，支持Token限制过滤
        const tokenManager = this.services.aiService.tokenManager;
        if (!tokenManager) {
          return res.status(503).json({
            success: false,
            error: 'Token Manager not available',
            timestamp: new Date().toISOString()
          });
        }

        // 🔥 获取可用Token (支持allowed_token_ids限制)
        let tokenInfo;
        if (parameters.allowed_token_ids && Array.isArray(parameters.allowed_token_ids) && parameters.allowed_token_ids.length > 0) {
          // TODO: 实现TokenManager.getSpecificToken方法以支持token ID过滤
          // 当前使用默认策略，未来需要在TokenManager中添加此功能
          this.moduleLogger.warn('allowed_token_ids specified but getSpecificToken not implemented yet', {
            allowed_token_ids: parameters.allowed_token_ids
          });
          tokenInfo = await tokenManager.getTokenWithRetry(3);
        } else {
          // 使用默认token获取策略
          tokenInfo = await tokenManager.getTokenWithRetry(3);
        }

        if (!tokenInfo) {
          return res.status(503).json({
            success: false,
            error: 'No healthy tokens available',
            timestamp: new Date().toISOString()
          });
        }

        // 🔥 构建Gemini API多轮对话请求
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${tokenInfo.token}`;

        // 🔥 转换消息格式为Gemini API格式
        const contents = finalMessages.map(msg => ({
          role: msg.role === 'assistant' ? 'model' : msg.role,
          parts: [{ text: msg.content }]
        }));

        // 🔥 支持高级配置和参数合并
        const advancedConfig = parameters.advanced_config || {};
        const modelConfig = parameters.model_config || {};
        const advancedGenerationConfig =
          (advancedConfig.generationConfig && typeof advancedConfig.generationConfig === 'object')
            ? advancedConfig.generationConfig
            : {};
        const inlineGenerationConfig =
          (parameters.generationConfig && typeof parameters.generationConfig === 'object')
            ? parameters.generationConfig
            : {};

        const mergedGenerationConfig = {
          ...advancedGenerationConfig,
          ...inlineGenerationConfig
        };

        const selectFirstDefined = <T>(...values: Array<T | undefined | null>): T | undefined => {
          for (const value of values) {
            if (value !== undefined && value !== null) {
              return value;
            }
          }
          return undefined;
        };

        const generationConfig: any = {
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

        const resolvedStopSequences = selectFirstDefined(
          mergedGenerationConfig.stopSequences,
          advancedConfig.stopSequences,
          modelConfig.stopSequences,
          parameters.stopSequences,
          (parameters as any).stop_sequences
        );

        if (resolvedStopSequences !== undefined) {
          generationConfig.stopSequences = resolvedStopSequences;
        }

        const rawThinkingConfig = selectFirstDefined(
          mergedGenerationConfig.thinkingConfig,
          advancedConfig.thinkingConfig,
          parameters.thinkingConfig
        );

        let normalizedThinkingConfig: any;
        if (rawThinkingConfig && typeof rawThinkingConfig === 'object') {
          normalizedThinkingConfig = {};
          if (typeof rawThinkingConfig.includeThoughts === 'boolean') {
            normalizedThinkingConfig.includeThoughts = rawThinkingConfig.includeThoughts;
          }
          if (
            typeof rawThinkingConfig.thinkingBudget === 'number' &&
            !Number.isNaN(rawThinkingConfig.thinkingBudget)
          ) {
            normalizedThinkingConfig.thinkingBudget = rawThinkingConfig.thinkingBudget;
          }
          if (Object.keys(normalizedThinkingConfig).length === 0) {
            normalizedThinkingConfig = undefined;
          }
        }

        const safetySettings = Array.isArray(advancedConfig.safetySettings) && advancedConfig.safetySettings.length > 0
          ? advancedConfig.safetySettings
          : [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" }
            ];

        const requestBody: any = {
          contents,
          generationConfig,
          safetySettings
        };

        if (normalizedThinkingConfig) {
          requestBody.generationConfig.thinkingConfig = normalizedThinkingConfig;
        }

        if (rawThinkingConfig && typeof rawThinkingConfig === 'object') {
          if (!requestBody.generationConfig.responseSchema && rawThinkingConfig.responseSchema) {
            requestBody.generationConfig.responseSchema = rawThinkingConfig.responseSchema;
          }
          if (!requestBody.tools && rawThinkingConfig.tools) {
            requestBody.tools = rawThinkingConfig.tools;
          }
        }

        // 添加系统指令
        if (systemPrompt) {
          requestBody.system_instruction = {
            parts: [{ text: systemPrompt }]
          };
        }

        const startTime = Date.now();
        const geminiResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (!geminiResponse.ok) {
          const errorText = await geminiResponse.text();
          this.moduleLogger.error('Gemini API call failed', {
            status: geminiResponse.status,
            error: errorText
          });

          return res.status(geminiResponse.status).json({
            success: false,
            error: `Gemini API failed: ${geminiResponse.statusText}`,
            timestamp: new Date().toISOString()
          });
        }

        const geminiData = await geminiResponse.json() as any;
        const responseTime = Date.now() - startTime;

        // 🔥 支持思考模式响应解析
        let aiResponse = '';
        let thinking = '';

        if (geminiData.candidates?.[0]?.content?.parts) {
          const parts = geminiData.candidates[0].content.parts;
          for (const part of parts) {
            if (part.thought) {
              // 思考部分
              thinking += part.text || '';
            } else {
              // 实际回复部分
              aiResponse += part.text || '';
            }
          }
        }

        if (!thinking && Array.isArray((geminiData as any).thoughts)) {
          for (const thoughtEntry of (geminiData as any).thoughts) {
            if (thoughtEntry && typeof thoughtEntry.text === 'string' && thoughtEntry.text.trim().length > 0) {
              thinking += `\n${thoughtEntry.text}`;
            }
          }
        }

        // 如果没有找到分离的内容，使用第一个part作为回复
        if (!aiResponse && !thinking) {
          aiResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';
        }

        // 报告Token使用成功
        await tokenManager.reportSuccess(tokenInfo.token, responseTime);

        const result = {
          ai_response: aiResponse.trim(),
          thinking: thinking.trim() || undefined,
          model_name: model,
          response_time: responseTime / 1000
        };

        // 🔥 响应成功，返回增强结果
        res.json({
          success: true,
          response: result.ai_response,
          thinking: result.thinking,          // 🔥 支持思考过程
          token_used: {
            id: tokenInfo.tokenId,
            project_name: tokenInfo.projectName || 'Debug Token'
          },
          model: result.model_name,
          performance: {
            processing_time_ms: result.response_time * 1000
          },
          usage: geminiData.usageMetadata,    // 🔥 返回使用统计
          thinking_tokens: geminiData.usageMetadata?.thoughtsTokenCount,
          timestamp: new Date().toISOString()
        });

        this.moduleLogger.info('Internal LLM Debug API succeeded', {
          model,
          responseTime: result.response_time,
          conversation_id
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

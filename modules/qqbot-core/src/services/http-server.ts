import express, { Express, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { config } from '../config';

interface HttpServerConfig {
  port?: number;
  host?: string;
}

interface HttpServerServices {
  database?: any;
  websocketClient?: any;
  debugService?: any;
  qqBot?: any;
  simpleQueue?: any; // 简单队列集成
  aiService?: any; // 🔥 新增：AI服务，用于内部LLM调试
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

    // 🔥 新增：内部LLM调试接口 - 复用企业级AIService
    this.app.post('/api/internal/llm/debug', async (req: Request, res: Response) => {
      try {
        const { systemPrompt, userInput, parameters = {}, model = 'gemini-2.5-flash', conversation_id } = req.body;

        // 参数验证
        if (!userInput || typeof userInput !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'userInput is required and must be a string',
            timestamp: new Date().toISOString()
          });
        }

        this.moduleLogger.info('Internal LLM Debug API called', {
          hasSystemPrompt: !!systemPrompt,
          userInputLength: userInput.length,
          model,
          conversation_id
        });

        // 🔥 复用企业级AIService，而非重复实现Token管理
        if (!this.services.aiService) {
          return res.status(503).json({
            success: false,
            error: 'AI Service not available',
            timestamp: new Date().toISOString()
          });
        }

        // 🔥 直接调用TokenManager和AI API，避免依赖agent配置
        const tokenManager = this.services.aiService.tokenManager;
        if (!tokenManager) {
          return res.status(503).json({
            success: false,
            error: 'Token Manager not available',
            timestamp: new Date().toISOString()
          });
        }

        // 获取可用Token
        const tokenInfo = await tokenManager.getTokenWithRetry(3);
        if (!tokenInfo) {
          return res.status(503).json({
            success: false,
            error: 'No healthy tokens available',
            timestamp: new Date().toISOString()
          });
        }

        // 构建Gemini API请求
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${tokenInfo.token}`;

        const requestBody: any = {
          contents: [{
            parts: [{ text: userInput }]
          }],
          generationConfig: {
            temperature: parameters.temperature || 0.7,
            maxOutputTokens: parameters.maxOutputTokens || parameters.max_output_tokens || 1000,
            topP: parameters.top_p || 0.95,
            topK: parameters.top_k || 40
          },
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" }
          ]
        };

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
        const aiResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';

        // 报告Token使用成功
        await tokenManager.reportSuccess(tokenInfo.token, responseTime);

        const result = {
          ai_response: aiResponse,
          model_name: model,
          response_time: responseTime / 1000
        };

        // 响应成功，返回结果
        res.json({
          success: true,
          response: result.ai_response,
          token_used: {
            id: tokenInfo.tokenId,
            project_name: tokenInfo.projectName || 'Debug Token'
          },
          model: result.model_name,
          performance: {
            processing_time_ms: result.response_time * 1000
          },
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

    // 简单队列监控API
    this.setupQueueRoutes();

    // NOTE: Debug and test endpoints have been moved to Admin Panel Backend
    // This separation improves module responsibility and security
    // For debugging features, use Admin Panel at port 9080

  }

  private setupQueueRoutes(): void {
    this.moduleLogger.info('Setting up queue routes...', { 
      hasSimpleQueue: !!this.services.simpleQueue,
      servicesKeys: Object.keys(this.services)
    });
    
    if (!this.services.simpleQueue) {
      this.moduleLogger.warn('Simple queue not available, skipping queue routes', {
        services: Object.keys(this.services)
      });
      return;
    }

    // 获取队列统计
    this.app.get('/api/queue/stats', (req: Request, res: Response) => {
      try {
        const stats = this.services.simpleQueue.getStats();
        res.json({
          success: true,
          data: stats
        });
      } catch (error) {
        this.moduleLogger.error('Failed to get queue stats', { error });
        res.status(500).json({
          success: false,
          error: 'Failed to get queue statistics'
        });
      }
    });

    // 获取活跃分区
    this.app.get('/api/queue/partitions', (req: Request, res: Response) => {
      try {
        const partitions = this.services.simpleQueue.getActivePartitions();
        res.json({
          success: true,
          data: partitions
        });
      } catch (error) {
        this.moduleLogger.error('Failed to get active partitions', { error });
        res.status(500).json({
          success: false,
          error: 'Failed to get active partitions'
        });
      }
    });

    // 获取指定分区详情
    this.app.get('/api/queue/partitions/:partitionKey', (req: Request, res: Response) => {
      try {
        const { partitionKey } = req.params;
        const info = this.services.simpleQueue.getPartitionInfo(partitionKey);
        
        if (!info) {
          return res.status(404).json({
            success: false,
            error: 'Partition not found'
          });
        }

        res.json({
          success: true,
          data: info
        });
      } catch (error) {
        this.moduleLogger.error('Failed to get partition info', { error });
        res.status(500).json({
          success: false,
          error: 'Failed to get partition information'
        });
      }
    });

    // 清空指定分区
    this.app.delete('/api/queue/partitions/:partitionKey', (req: Request, res: Response) => {
      try {
        const { partitionKey } = req.params;
        const clearedCount = this.services.simpleQueue.clearPartition(partitionKey);
        
        this.moduleLogger.info('Partition cleared via API', { partitionKey, clearedCount });
        
        res.json({
          success: true,
          data: {
            partitionKey,
            clearedMessages: clearedCount
          }
        });
      } catch (error) {
        this.moduleLogger.error('Failed to clear partition', { error });
        res.status(500).json({
          success: false,
          error: 'Failed to clear partition'
        });
      }
    });

    // 模拟私聊消息
    this.app.post('/api/queue/simulate/private', async (req: Request, res: Response) => {
      try {
        const { user_id, message, priority } = req.body;
        
        if (!user_id || !message) {
          return res.status(400).json({
            success: false,
            error: 'Missing required fields: user_id, message'
          });
        }

        const traceId = await this.services.simpleQueue.simulatePrivateMessage({
          user_id,
          message,
          priority
        });

        this.moduleLogger.info('Private message simulated via API', { user_id, traceId });

        res.json({
          success: true,
          data: {
            traceId,
            user_id,
            message: message.substring(0, 100),
            priority: priority || 'HIGH'
          }
        });
      } catch (error) {
        this.moduleLogger.error('Failed to simulate private message', { error });
        res.status(500).json({
          success: false,
          error: 'Failed to simulate private message'
        });
      }
    });

    // 模拟群聊消息
    this.app.post('/api/queue/simulate/group', async (req: Request, res: Response) => {
      try {
        const { user_id, group_id, message, atBot, priority } = req.body;
        
        if (!user_id || !group_id || !message) {
          return res.status(400).json({
            success: false,
            error: 'Missing required fields: user_id, group_id, message'
          });
        }

        const traceId = await this.services.simpleQueue.simulateGroupMessage({
          user_id,
          group_id,
          message,
          atBot,
          priority
        });

        this.moduleLogger.info('Group message simulated via API', { user_id, group_id, traceId });

        res.json({
          success: true,
          data: {
            traceId,
            user_id,
            group_id,
            message: message.substring(0, 100),
            atBot: !!atBot,
            priority: priority || 'MEDIUM'
          }
        });
      } catch (error) {
        this.moduleLogger.error('Failed to simulate group message', { error });
        res.status(500).json({
          success: false,
          error: 'Failed to simulate group message'
        });
      }
    });

    // 批量模拟消息
    this.app.post('/api/queue/simulate/batch', async (req: Request, res: Response) => {
      try {
        const { messages } = req.body;
        
        if (!Array.isArray(messages) || messages.length === 0) {
          return res.status(400).json({
            success: false,
            error: 'Invalid messages array'
          });
        }

        if (messages.length > 50) {
          return res.status(400).json({
            success: false,
            error: 'Too many messages (max 50)'
          });
        }

        const traceIds = await this.services.simpleQueue.simulateBatch(messages);

        this.moduleLogger.info('Batch messages simulated via API', { 
          count: messages.length,
          traceIds: traceIds.slice(0, 5) // 只记录前5个
        });

        res.json({
          success: true,
          data: {
            messageCount: messages.length,
            traceIds,
            summary: {
              privateMessages: messages.filter(m => m.type === 'private').length,
              groupMessages: messages.filter(m => m.type === 'group').length
            }
          }
        });
      } catch (error) {
        this.moduleLogger.error('Failed to simulate batch messages', { error });
        res.status(500).json({
          success: false,
          error: 'Failed to simulate batch messages'
        });
      }
    });

    this.moduleLogger.info('Queue API routes registered');
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
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { HttpServerConfig } from '../types';
import { logger } from '../utils/logger';
import { DatabaseManager } from './database';
import WebSocketClient from './websocket-client';

export interface HttpServerDependencies {
  database: DatabaseManager;
  websocketClient: WebSocketClient;
}

export class HttpServer {
  private app: Express;
  private config: HttpServerConfig;
  private server: any = null;
  private moduleLogger = logger.createModuleLogger('http-server');
  private database: DatabaseManager;
  private websocketClient: WebSocketClient;

  constructor(config: HttpServerConfig, dependencies: HttpServerDependencies) {
    this.config = config;
    this.database = dependencies.database;
    this.websocketClient = dependencies.websocketClient;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    
    // 请求日志中间件
    this.app.use((req, res, next) => {
      this.moduleLogger.debug('HTTP Request', {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });
  }

  private setupRoutes(): void {
    // 健康检查
    this.app.get('/health', this.handleHealth.bind(this));

    // OneBot API 路由
    this.app.post('/api/send_private', this.handleSendPrivateMessage.bind(this));
    this.app.post('/api/send_group', this.handleSendGroupMessage.bind(this));
    this.app.post('/api/send_reply', this.handleSendReplyMessage.bind(this));
    this.app.post('/api/send_at', this.handleSendAtMessage.bind(this));
    
    // 系统状态 API
    this.app.get('/api/status', this.handleGetStatus.bind(this));
    this.app.get('/api/connection', this.handleGetConnectionStatus.bind(this));
    
    // 对话历史 API
    this.app.get('/api/conversations', this.handleGetConversations.bind(this));
    this.app.get('/api/conversations/:id', this.handleGetConversation.bind(this));
    this.app.delete('/api/conversations', this.handleClearConversations.bind(this));
    
    // 需求管理 API
    this.app.get('/api/requirements', this.handleGetRequirements.bind(this));
    this.app.get('/api/requirements/:id', this.handleGetRequirement.bind(this));
    this.app.post('/api/requirements/standardized', this.handleStandardizedRequirement.bind(this));
    
    // 多Agent会话 API (占位符)
    this.app.get('/api/multi_agent_sessions', this.handleGetMultiAgentSessions.bind(this));
    this.app.get('/api/multi_agent_sessions/:id', this.handleGetMultiAgentSession.bind(this));

    // 错误处理中间件
    this.app.use(this.handleError.bind(this));
  }

  // 健康检查
  private async handleHealth(req: Request, res: Response): Promise<void> {
    const status = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      websocket_connected: this.websocketClient.isConnected(),
      database_connected: await this.database.testConnection()
    };

    res.json(status);
  }

  // 发送私聊消息
  private async handleSendPrivateMessage(req: Request, res: Response): Promise<void> {
    try {
      const { user_id, message } = req.body;

      if (!user_id || !message) {
        res.status(400).json({ error: 'Missing required parameters: user_id, message' });
        return;
      }

      await this.websocketClient.sendPrivateMessage(user_id, message);
      res.json({ success: true, message: 'Message sent successfully' });
    } catch (error) {
      this.moduleLogger.error('Failed to send private message', { error });
      res.status(500).json({ error: 'Failed to send message' });
    }
  }

  // 发送群聊消息
  private async handleSendGroupMessage(req: Request, res: Response): Promise<void> {
    try {
      const { group_id, message } = req.body;

      if (!group_id || !message) {
        res.status(400).json({ error: 'Missing required parameters: group_id, message' });
        return;
      }

      await this.websocketClient.sendGroupMessage(group_id, message);
      res.json({ success: true, message: 'Message sent successfully' });
    } catch (error) {
      this.moduleLogger.error('Failed to send group message', { error });
      res.status(500).json({ error: 'Failed to send message' });
    }
  }

  // 发送回复消息
  private async handleSendReplyMessage(req: Request, res: Response): Promise<void> {
    try {
      const { message_id, message } = req.body;

      if (!message_id || !message) {
        res.status(400).json({ error: 'Missing required parameters: message_id, message' });
        return;
      }

      await this.websocketClient.sendReplyMessage(message_id, message);
      res.json({ success: true, message: 'Reply sent successfully' });
    } catch (error) {
      this.moduleLogger.error('Failed to send reply message', { error });
      res.status(500).json({ error: 'Failed to send reply' });
    }
  }

  // 发送@消息
  private async handleSendAtMessage(req: Request, res: Response): Promise<void> {
    try {
      const { group_id, user_id, message } = req.body;

      if (!group_id || !user_id || !message) {
        res.status(400).json({ error: 'Missing required parameters: group_id, user_id, message' });
        return;
      }

      await this.websocketClient.sendAtMessage(group_id, user_id, message);
      res.json({ success: true, message: 'At message sent successfully' });
    } catch (error) {
      this.moduleLogger.error('Failed to send at message', { error });
      res.status(500).json({ error: 'Failed to send at message' });
    }
  }

  // 获取系统状态
  private async handleGetStatus(req: Request, res: Response): Promise<void> {
    try {
      const connectionInfo = this.websocketClient.getConnectionInfo();
      const dbConnected = await this.database.testConnection();
      
      const status = {
        websocket: connectionInfo,
        database: { connected: dbConnected },
        server: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          version: process.version
        },
        timestamp: new Date().toISOString()
      };

      res.json(status);
    } catch (error) {
      this.moduleLogger.error('Failed to get status', { error });
      res.status(500).json({ error: 'Failed to get status' });
    }
  }

  // 获取连接状态
  private async handleGetConnectionStatus(req: Request, res: Response): Promise<void> {
    try {
      const connectionInfo = this.websocketClient.getConnectionInfo();
      res.json(connectionInfo);
    } catch (error) {
      this.moduleLogger.error('Failed to get connection status', { error });
      res.status(500).json({ error: 'Failed to get connection status' });
    }
  }

  // 获取对话历史
  private async handleGetConversations(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.query.user_id ? parseInt(req.query.user_id as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

      const conversations = await this.database.getConversations(userId, limit);
      res.json({ conversations, total: conversations.length });
    } catch (error) {
      this.moduleLogger.error('Failed to get conversations', { error });
      res.status(500).json({ error: 'Failed to get conversations' });
    }
  }

  // 获取单个对话
  private async handleGetConversation(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const conversation = await this.database.getConversationById(id);
      
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      res.json(conversation);
    } catch (error) {
      this.moduleLogger.error('Failed to get conversation', { error });
      res.status(500).json({ error: 'Failed to get conversation' });
    }
  }

  // 清空对话历史
  private async handleClearConversations(req: Request, res: Response): Promise<void> {
    try {
      const deletedCount = await this.database.clearConversations();
      res.json({ success: true, deleted_count: deletedCount });
    } catch (error) {
      this.moduleLogger.error('Failed to clear conversations', { error });
      res.status(500).json({ error: 'Failed to clear conversations' });
    }
  }

  // 获取需求列表
  private async handleGetRequirements(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.query.user_id ? parseInt(req.query.user_id as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

      const requirements = await this.database.getRequirements(userId, limit);
      res.json({ requirements, total: requirements.length });
    } catch (error) {
      this.moduleLogger.error('Failed to get requirements', { error });
      res.status(500).json({ error: 'Failed to get requirements' });
    }
  }

  // 获取单个需求
  private async handleGetRequirement(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const requirement = await this.database.getRequirementById(id);
      
      if (!requirement) {
        res.status(404).json({ error: 'Requirement not found' });
        return;
      }

      res.json(requirement);
    } catch (error) {
      this.moduleLogger.error('Failed to get requirement', { error });
      res.status(500).json({ error: 'Failed to get requirement' });
    }
  }

  // 标准化需求处理 (占位符)
  private async handleStandardizedRequirement(req: Request, res: Response): Promise<void> {
    try {
      const { user_id, message } = req.body;

      if (!user_id || !message) {
        res.status(400).json({ error: 'Missing required parameters: user_id, message' });
        return;
      }

      // TODO: 实现标准化需求处理逻辑
      res.json({ 
        success: true, 
        message: 'Standardized requirement processing not implemented yet',
        requirement_id: 'placeholder-' + Date.now()
      });
    } catch (error) {
      this.moduleLogger.error('Failed to process standardized requirement', { error });
      res.status(500).json({ error: 'Failed to process standardized requirement' });
    }
  }

  // 多Agent会话列表 (占位符)
  private async handleGetMultiAgentSessions(req: Request, res: Response): Promise<void> {
    try {
      // TODO: 实现多Agent会话管理
      res.json({ 
        sessions: [],
        total: 0,
        message: 'Multi-agent sessions not implemented yet'
      });
    } catch (error) {
      this.moduleLogger.error('Failed to get multi-agent sessions', { error });
      res.status(500).json({ error: 'Failed to get multi-agent sessions' });
    }
  }

  // 单个多Agent会话 (占位符)
  private async handleGetMultiAgentSession(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      // TODO: 实现多Agent会话详情
      res.json({ 
        session_id: id,
        message: 'Multi-agent session details not implemented yet'
      });
    } catch (error) {
      this.moduleLogger.error('Failed to get multi-agent session', { error });
      res.status(500).json({ error: 'Failed to get multi-agent session' });
    }
  }

  // 错误处理中间件
  private handleError(error: Error, req: Request, res: Response): void {
    this.moduleLogger.error('HTTP Server Error', { 
      error: error.message,
      stack: error.stack,
      method: req.method,
      url: req.url
    });

    res.status(500).json({
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.port, this.config.host, () => {
          this.moduleLogger.info(`HTTP server started on ${this.config.host}:${this.config.port}`);
          resolve();
        });

        this.server.on('error', (error: Error) => {
          this.moduleLogger.error('HTTP server error', { error });
          reject(error);
        });
      } catch (error) {
        this.moduleLogger.error('Failed to start HTTP server', { error });
        reject(error);
      }
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.moduleLogger.info('HTTP server stopped');
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
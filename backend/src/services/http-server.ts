import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { HttpServerConfig, TokenListResponse, TokenStatsResponse, TokenHealthCheckResponse, TokenResetResponse, TokenUsageHistoryResponse, GroupListResponse, GroupDetailResponse, GroupStatsResponse, GroupBulkOperationRequest, GroupBulkOperationResponse, GroupChatSettings, ConversationQueryParams, ConversationListResponse, ConversationFilters } from '../types';
import { logger } from '../utils/logger';
import { DatabaseManager } from './database';
import WebSocketClient from './websocket-client';
import { SessionApiHandlers } from './session-api-handlers';
import { getTokenManager } from '../utils/token-manager';

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
  private sessionApiHandlers: SessionApiHandlers;
  private tokenManager = getTokenManager();

  constructor(config: HttpServerConfig, dependencies: HttpServerDependencies) {
    this.config = config;
    this.database = dependencies.database;
    this.websocketClient = dependencies.websocketClient;
    this.sessionApiHandlers = new SessionApiHandlers(this.database);
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // 配置Helmet CSP以允许前端页面正常工作
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'", // 允许内联脚本
            "https://cdn.jsdelivr.net", // 允许Bootstrap CDN
            "https://cdnjs.cloudflare.com" // 允许FontAwesome CDN
          ],
          styleSrc: [
            "'self'",
            "'unsafe-inline'", // 允许内联样式
            "https://cdn.jsdelivr.net", // 允许Bootstrap CDN
            "https://cdnjs.cloudflare.com" // 允许FontAwesome CDN
          ],
          fontSrc: [
            "'self'",
            "https://cdnjs.cloudflare.com", // 允许FontAwesome字体
            "data:" // 允许data: URLs的字体
          ],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"] // 只允许连接到同源
        }
      }
    }));
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
    // 静态文件服务
    this.app.use('/static', express.static(path.join(__dirname, '../../public')));
    
    // Dashboard页面路由
    this.app.get('/', (req, res) => {
      res.redirect('/dashboard');
    });
    
    this.app.get('/dashboard', (req, res) => {
      res.sendFile(path.join(__dirname, '../../public/dashboard.html'));
    });
    
    this.app.get('/conversations', (req, res) => {
      res.sendFile(path.join(__dirname, '../../public/conversations-admin.html'));
    });
    
    this.app.get('/test', (req, res) => {
      res.sendFile(path.join(__dirname, '../../public/simple-frontend-test.html'));
    });

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
    
    // Agent Prompts管理 API
    this.app.get('/api/agent_prompts', this.handleGetAgentPrompts.bind(this));
    this.app.get('/api/agent_prompts/:agent_type', this.handleGetAgentPromptsByType.bind(this));
    this.app.post('/api/agent_prompts', this.handleCreateAgentPrompt.bind(this));
    this.app.put('/api/agent_prompts/:id', this.handleUpdateAgentPrompt.bind(this));
    this.app.delete('/api/agent_prompts/:id', this.handleDeactivateAgentPrompt.bind(this));
    
    // Session管理 API
    this.app.get('/api/sessions', this.sessionApiHandlers.handleGetSessions.bind(this.sessionApiHandlers));
    this.app.get('/api/sessions/:id', this.sessionApiHandlers.handleGetSession.bind(this.sessionApiHandlers));
    this.app.post('/api/sessions/:id/switch', this.sessionApiHandlers.handleSwitchSessionService.bind(this.sessionApiHandlers));
    this.app.delete('/api/sessions/cleanup', this.sessionApiHandlers.handleCleanupSessions.bind(this.sessionApiHandlers));
    
    // Token管理 API
    this.app.get('/api/tokens', this.handleGetTokens.bind(this));
    this.app.get('/api/tokens/stats', this.handleGetTokenStats.bind(this));
    this.app.get('/api/tokens/usage-history', this.handleGetTokenUsageHistory.bind(this));
    this.app.get('/api/tokens/:id', this.handleGetToken.bind(this));
    this.app.post('/api/tokens/health-check', this.handleRunAllTokensHealthCheck.bind(this));
    this.app.post('/api/tokens/:id/health-check', this.handleRunTokenHealthCheck.bind(this));
    this.app.post('/api/tokens/:id/reset', this.handleResetToken.bind(this));
    this.app.post('/api/tokens/:id/activate', this.handleActivateToken.bind(this));
    this.app.post('/api/tokens/:id/deactivate', this.handleDeactivateToken.bind(this));
    this.app.delete('/api/tokens/blacklist', this.handleClearTokenBlacklist.bind(this));
    this.app.get('/api/tokens/:id/logs', this.handleGetTokenLogs.bind(this));
    
    // 多Agent会话 API (占位符)
    this.app.get('/api/multi_agent_sessions', this.handleGetMultiAgentSessions.bind(this));
    this.app.get('/api/multi_agent_sessions/:id', this.handleGetMultiAgentSession.bind(this));
    
    // Group Chat Management API
    this.app.get('/api/groups', this.handleGetGroups.bind(this));
    this.app.get('/api/groups/stats', this.handleGetGroupStats.bind(this));
    this.app.get('/api/groups/:id', this.handleGetGroup.bind(this));
    this.app.post('/api/groups', this.handleCreateGroup.bind(this));
    this.app.put('/api/groups/:id', this.handleUpdateGroup.bind(this));
    this.app.delete('/api/groups/:id', this.handleDeleteGroup.bind(this));
    this.app.post('/api/groups/bulk', this.handleBulkGroupOperations.bind(this));

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
      const memUsage = process.memoryUsage();
      
      const status = {
        success: true,
        data: {
          websocket: connectionInfo,
          database: { connected: dbConnected },
          system_info: {
            uptime: process.uptime(),
            memory_usage: memUsage.rss,
            heap_used: memUsage.heapUsed,
            heap_total: memUsage.heapTotal,
            cpu_usage: Math.round(process.cpuUsage().user / 1000), // 简化CPU使用率计算
            node_version: process.version,
            platform: process.platform,
            arch: process.arch
          },
          timestamp: new Date().toISOString()
        }
      };

      res.json(status);
    } catch (error) {
      this.moduleLogger.error('Failed to get status', { error });
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get status',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
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

  // 获取对话历史 - 扩展版本支持分页、筛选和搜索
  private async handleGetConversations(req: Request, res: Response): Promise<void> {
    try {
      // 解析查询参数
      const queryParams: ConversationQueryParams = {
        user_id: req.query.user_id ? parseInt(req.query.user_id as string) : undefined,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
        start_date: req.query.start_date as string,
        end_date: req.query.end_date as string,
        search: req.query.search as string,
        model_name: req.query.model_name as string,
        sort_order: (req.query.sort_order as 'desc' | 'asc') || 'desc',
        include_raw: req.query.include_raw === 'true'
      };

      // 参数验证
      if (queryParams.page && queryParams.page < 1) {
        res.status(400).json({
          success: false,
          error: 'Invalid page parameter',
          message: 'Page number must be greater than 0'
        });
        return;
      }

      if (queryParams.limit && (queryParams.limit < 1 || queryParams.limit > 1000)) {
        res.status(400).json({
          success: false,
          error: 'Invalid limit parameter',
          message: 'Limit must be between 1 and 1000'
        });
        return;
      }

      // 日期格式验证
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (queryParams.start_date && !dateRegex.test(queryParams.start_date)) {
        res.status(400).json({
          success: false,
          error: 'Invalid start_date format',
          message: 'Date format should be YYYY-MM-DD'
        });
        return;
      }

      if (queryParams.end_date && !dateRegex.test(queryParams.end_date)) {
        res.status(400).json({
          success: false,
          error: 'Invalid end_date format',
          message: 'Date format should be YYYY-MM-DD'
        });
        return;
      }

      // 检查是否为遗留API调用（向后兼容）
      const isLegacyCall = !req.query.page && !req.query.start_date && !req.query.end_date && !req.query.search;
      
      if (isLegacyCall) {
        // 使用旧的简单查询方法保持向后兼容
        const userId = queryParams.user_id;
        const limit = queryParams.limit || 50;
        const conversations = await this.database.getConversations(userId, limit);
        
        res.json({ 
          success: true,
          data: conversations, 
          total: conversations.length 
        });
        return;
      }

      // 使用新的分页查询方法
      const result = await this.database.getConversationsPaginated(queryParams);

      // 构建筛选信息
      const filters: ConversationFilters = {};
      if (queryParams.user_id) filters.user_id = queryParams.user_id;
      if (queryParams.start_date || queryParams.end_date) {
        filters.date_range = {
          start_date: queryParams.start_date || '',
          end_date: queryParams.end_date || ''
        };
      }
      if (queryParams.search) filters.search = queryParams.search;
      if (queryParams.model_name) filters.model_name = queryParams.model_name;
      if (queryParams.sort_order) filters.sort_order = queryParams.sort_order;

      const response: ConversationListResponse = {
        success: true,
        data: {
          conversations: result.conversations,
          pagination: result.pagination,
          filters: Object.keys(filters).length > 0 ? filters : undefined
        }
      };

      // 记录查询日志
      this.moduleLogger.info('Conversations query executed', {
        user_id: queryParams.user_id,
        page: queryParams.page,
        limit: queryParams.limit,
        total_results: result.totalCount,
        has_search: !!queryParams.search,
        has_date_filter: !!(queryParams.start_date || queryParams.end_date)
      });

      res.json(response);
    } catch (error) {
      this.moduleLogger.error('Failed to get conversations', { error, query: req.query });
      res.status(500).json({ 
        success: false,
        error: 'Failed to get conversations',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // 获取单个对话
  private async handleGetConversation(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const conversation = await this.database.getConversationById(id);
      
      if (!conversation) {
        res.status(404).json({ 
          success: false,
          error: 'Conversation not found' 
        });
        return;
      }

      res.json({
        success: true,
        data: conversation
      });
    } catch (error) {
      this.moduleLogger.error('Failed to get conversation', { error });
      res.status(500).json({ 
        success: false,
        error: 'Failed to get conversation' 
      });
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
      // const status = req.query.status as string;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

      const requirements = await this.database.getRequirements(userId, limit);
      res.json({ 
        success: true,
        data: requirements, 
        total: requirements.length 
      });
    } catch (error) {
      this.moduleLogger.error('Failed to get requirements', { error });
      res.status(500).json({ 
        success: false,
        error: 'Failed to get requirements',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
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

  // Agent Prompts管理处理器
  private async handleGetAgentPrompts(req: Request, res: Response): Promise<void> {
    try {
      const agentType = req.query.agent_type as string;
      const prompts = await this.database.getAgentPrompts(agentType);
      
      res.json({
        prompts,
        total: prompts.length,
        agentType: agentType || 'all'
      });
    } catch (error) {
      this.moduleLogger.error('Failed to get agent prompts', { error });
      res.status(500).json({ 
        error: 'Failed to get agent prompts',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async handleGetAgentPromptsByType(req: Request, res: Response): Promise<void> {
    try {
      const agentType = req.params.agent_type;
      const promptName = req.query.prompt_name as string;
      
      if (promptName) {
        const prompt = await this.database.getAgentPrompt(agentType, promptName);
        if (prompt) {
          res.json({ prompt });
        } else {
          res.status(404).json({ error: 'Agent prompt not found' });
        }
      } else {
        const prompts = await this.database.getAgentPrompts(agentType);
        res.json({
          prompts,
          total: prompts.length,
          agentType
        });
      }
    } catch (error) {
      this.moduleLogger.error('Failed to get agent prompts by type', { error });
      res.status(500).json({ 
        error: 'Failed to get agent prompts by type',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async handleCreateAgentPrompt(req: Request, res: Response): Promise<void> {
    try {
      const promptData = req.body;
      
      // 验证必需字段
      if (!promptData.agent_type || !promptData.prompt_name || !promptData.system_instructions) {
        res.status(400).json({ error: 'Missing required fields: agent_type, prompt_name, system_instructions' });
        return;
      }
      
      // 添加默认值
      const { v4: uuidv4 } = require('uuid');
      const newPrompt = {
        id: uuidv4(),
        ...promptData,
        is_active: promptData.is_active !== undefined ? promptData.is_active : true,
        version: promptData.version || 1,
        created_by: promptData.created_by || 'user',
        created_at: new Date(),
        updated_at: new Date()
      };
      
      const success = await this.database.saveAgentPrompt(newPrompt);
      
      if (success) {
        res.json({ success: true, message: 'Agent prompt created successfully', id: newPrompt.id });
      } else {
        res.status(500).json({ error: 'Failed to create agent prompt' });
      }
    } catch (error) {
      this.moduleLogger.error('Failed to create agent prompt', { error });
      res.status(500).json({ 
        error: 'Failed to create agent prompt',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async handleUpdateAgentPrompt(req: Request, res: Response): Promise<void> {
    try {
      const promptId = req.params.id;
      const updateData = req.body;
      
      updateData.id = promptId;
      updateData.updated_at = new Date();
      
      const success = await this.database.saveAgentPrompt(updateData);
      
      if (success) {
        res.json({ success: true, message: 'Agent prompt updated successfully' });
      } else {
        res.status(500).json({ error: 'Failed to update agent prompt' });
      }
    } catch (error) {
      this.moduleLogger.error('Failed to update agent prompt', { error });
      res.status(500).json({ 
        error: 'Failed to update agent prompt',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async handleDeactivateAgentPrompt(req: Request, res: Response): Promise<void> {
    try {
      const promptId = req.params.id;
      const success = await this.database.deactivateAgentPrompt(promptId);
      
      if (success) {
        res.json({ success: true, message: 'Agent prompt deactivated successfully' });
      } else {
        res.status(500).json({ error: 'Failed to deactivate agent prompt' });
      }
    } catch (error) {
      this.moduleLogger.error('Failed to deactivate agent prompt', { error });
      res.status(500).json({ 
        error: 'Failed to deactivate agent prompt',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private handleError(error: Error, req: Request, res: Response, __next: NextFunction): void {
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

  // Token管理API处理方法
  
  /**
   * 获取所有Token信息 - 增强版
   */
  private async handleGetTokens(req: Request, res: Response): Promise<void> {
    try {
      const stats = await this.tokenManager.getStats();
      
      // 转换为dashboard API格式，隐藏敏感信息
      const responseData: TokenListResponse = {
        success: true,
        data: stats.tokens.map(token => ({
          id: token.id,
          project_name: token.project_name,
          project_id: token.project_id,
          is_active: true, // 从stats中获取的都是active token
          is_healthy: token.is_healthy,
          daily_limit: token.daily_limit,
          daily_used: token.daily_used,
          error_count: token.error_count,
          priority: 1, // 默认优先级，可以从数据库获取更精确的值
          weight: 1,   // 默认权重，可以从数据库获取更精确的值
          last_used: token.last_used,
          last_health_check: undefined, // 需要从数据库查询
          blacklisted_until: token.blacklisted_until,
          blacklist_reason: undefined, // 不在当前stats中，需要查询
          created_at: new Date().toISOString() // 占位符，需要从数据库查询
        })),
        total: stats.tokens.length
      };
      
      res.json(responseData);
    } catch (error) {
      this.moduleLogger.error('Failed to get tokens', { error });
      res.status(500).json({ 
        success: false,
        error: 'Failed to retrieve token information',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取Token统计信息 - 增强版
   */
  private async handleGetTokenStats(req: Request, res: Response): Promise<void> {
    try {
      const stats = await this.tokenManager.getStats();
      
      // 计算使用率和日使用情况
      const availableTokens = stats.healthy - stats.blacklisted;
      const totalDailyLimit = stats.tokens.reduce((sum, token) => sum + token.daily_limit, 0);
      const totalDailyUsed = stats.tokens.reduce((sum, token) => sum + token.daily_used, 0);
      const usageRate = totalDailyLimit > 0 ? (totalDailyUsed / totalDailyLimit) * 100 : 0;
      
      // 获取今日日志统计
      const today = new Date().toISOString().split('T')[0];
      const dailyLogs = await this.database.executeQuery<any>(`
        SELECT 
          COUNT(*) as total_requests,
          SUM(CASE WHEN result = 'success' THEN 1 ELSE 0 END) as successful_requests,
          SUM(CASE WHEN result = 'error' THEN 1 ELSE 0 END) as failed_requests
        FROM api_token_logs 
        WHERE DATE(created_at) = ?
      `, [today]);
      
      const dailyStats = dailyLogs[0] || {
        total_requests: 0,
        successful_requests: 0,
        failed_requests: 0
      };
      
      const errorRate = dailyStats.total_requests > 0 
        ? (dailyStats.failed_requests / dailyStats.total_requests) * 100 
        : 0;
      
      const responseData: TokenStatsResponse = {
        success: true,
        data: {
          total: stats.total,
          active: stats.active,
          healthy: stats.healthy,
          blacklisted: stats.blacklisted,
          over_daily_limit: stats.over_daily_limit,
          available: availableTokens,
          usage_rate: Math.round(usageRate * 100) / 100,
          daily_summary: {
            total_requests: parseInt(dailyStats.total_requests) || 0,
            successful_requests: parseInt(dailyStats.successful_requests) || 0,
            failed_requests: parseInt(dailyStats.failed_requests) || 0,
            error_rate: Math.round(errorRate * 100) / 100
          }
        }
      };
      
      res.json(responseData);
    } catch (error) {
      this.moduleLogger.error('Failed to get token stats', { error });
      res.status(500).json({ 
        success: false,
        error: 'Failed to retrieve token statistics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取单个Token详细信息
   */
  private async handleGetToken(req: Request, res: Response): Promise<void> {
    try {
      const tokenId = parseInt(req.params.id);
      if (isNaN(tokenId)) {
        res.status(400).json({ error: 'Invalid token ID' });
        return;
      }

      const tokenData = await this.database.executeQuery<any>(
        'SELECT * FROM api_tokens WHERE id = ?',
        [tokenId]
      );

      if (tokenData.length === 0) {
        res.status(404).json({ error: 'Token not found' });
        return;
      }

      // 隐藏真实token值，只显示前8位
      const token = tokenData[0];
      token.token = token.token.substring(0, 8) + '...';

      res.json({
        success: true,
        data: token
      });
    } catch (error) {
      this.moduleLogger.error('Failed to get token', { error, tokenId: req.params.id });
      res.status(500).json({ error: 'Failed to retrieve token information' });
    }
  }

  /**
   * 运行单个Token健康检查
   */
  private async handleRunTokenHealthCheck(req: Request, res: Response): Promise<void> {
    try {
      const tokenId = parseInt(req.params.id);
      if (isNaN(tokenId)) {
        res.status(400).json({ error: 'Invalid token ID' });
        return;
      }

      // 获取token数据
      const tokenData = await this.database.executeQuery<any>(
        'SELECT * FROM api_tokens WHERE id = ? AND is_active = TRUE',
        [tokenId]
      );

      if (tokenData.length === 0) {
        res.status(404).json({ error: 'Token not found or inactive' });
        return;
      }

      // 运行健康检查 (这里简化实现，实际应该调用TokenManager的方法)
      await this.tokenManager.runHealthCheck();

      res.json({
        success: true,
        message: 'Health check initiated for token'
      });
    } catch (error) {
      this.moduleLogger.error('Failed to run token health check', { error, tokenId: req.params.id });
      res.status(500).json({ error: 'Failed to run health check' });
    }
  }

  /**
   * 运行所有Token健康检查 - 增强版
   */
  private async handleRunAllTokensHealthCheck(req: Request, res: Response): Promise<void> {
    try {
      const startTime = Date.now();
      
      // 获取检查前的统计
      const beforeStats = await this.tokenManager.getStats();
      
      // 执行健康检查
      await this.tokenManager.runHealthCheck();
      
      // 获取检查后的统计
      const afterStats = await this.tokenManager.getStats();
      
      const duration = Date.now() - startTime;
      
      const responseData: TokenHealthCheckResponse = {
        success: true,
        message: 'Health check completed for all tokens',
        data: {
          checked_tokens: beforeStats.active,
          healthy_tokens: afterStats.healthy,
          unhealthy_tokens: afterStats.active - afterStats.healthy,
          duration_ms: duration
        }
      };
      
      // 记录操作日志
      this.moduleLogger.info('Manual health check completed', {
        checkedTokens: beforeStats.active,
        healthyAfter: afterStats.healthy,
        duration
      });
      
      res.json(responseData);
    } catch (error) {
      this.moduleLogger.error('Failed to run all tokens health check', { error });
      res.status(500).json({ 
        success: false,
        message: 'Failed to run health check',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 激活Token
   */
  private async handleActivateToken(req: Request, res: Response): Promise<void> {
    try {
      const tokenId = parseInt(req.params.id);
      if (isNaN(tokenId)) {
        res.status(400).json({ error: 'Invalid token ID' });
        return;
      }

      const result = await this.database.executeUpdate(
        'UPDATE api_tokens SET is_active = TRUE, updated_at = NOW() WHERE id = ?',
        [tokenId]
      );

      if (result === 0) {
        res.status(404).json({ error: 'Token not found' });
        return;
      }

      res.json({
        success: true,
        message: 'Token activated successfully'
      });
    } catch (error) {
      this.moduleLogger.error('Failed to activate token', { error, tokenId: req.params.id });
      res.status(500).json({ error: 'Failed to activate token' });
    }
  }

  /**
   * 停用Token
   */
  private async handleDeactivateToken(req: Request, res: Response): Promise<void> {
    try {
      const tokenId = parseInt(req.params.id);
      if (isNaN(tokenId)) {
        res.status(400).json({ error: 'Invalid token ID' });
        return;
      }

      const result = await this.database.executeUpdate(
        'UPDATE api_tokens SET is_active = FALSE, updated_at = NOW() WHERE id = ?',
        [tokenId]
      );

      if (result === 0) {
        res.status(404).json({ error: 'Token not found' });
        return;
      }

      res.json({
        success: true,
        message: 'Token deactivated successfully'
      });
    } catch (error) {
      this.moduleLogger.error('Failed to deactivate token', { error, tokenId: req.params.id });
      res.status(500).json({ error: 'Failed to deactivate token' });
    }
  }

  /**
   * 清除Token黑名单 - 增强版
   */
  private async handleClearTokenBlacklist(req: Request, res: Response): Promise<void> {
    try {
      const beforeStats = await this.tokenManager.getStats();
      const clearedCount = await this.tokenManager.clearBlacklist();
      const afterStats = await this.tokenManager.getStats();
      
      // 记录管理操作
      this.moduleLogger.warn('Token blacklist manually cleared', {
        clearedCount,
        blacklistedBefore: beforeStats.blacklisted,
        blacklistedAfter: afterStats.blacklisted,
        operationTime: new Date().toISOString()
      });
      
      res.json({
        success: true,
        message: `Successfully cleared ${clearedCount} tokens from blacklist`,
        data: {
          cleared_count: clearedCount,
          blacklisted_before: beforeStats.blacklisted,
          blacklisted_after: afterStats.blacklisted
        }
      });
    } catch (error) {
      this.moduleLogger.error('Failed to clear token blacklist', { error });
      res.status(500).json({ 
        success: false,
        error: 'Failed to clear blacklist',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取Token使用日志
   */
  private async handleGetTokenLogs(req: Request, res: Response): Promise<void> {
    try {
      const tokenId = parseInt(req.params.id);
      if (isNaN(tokenId)) {
        res.status(400).json({ error: 'Invalid token ID' });
        return;
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const logs = await this.database.executeQuery<any>(`
        SELECT 
          l.*,
          t.project_name,
          t.project_id
        FROM api_token_logs l
        JOIN api_tokens t ON l.token_id = t.id
        WHERE l.token_id = ?
        ORDER BY l.created_at DESC
        LIMIT ? OFFSET ?
      `, [tokenId, limit, offset]);

      const total = await this.database.executeQuery<{count: number}>(
        'SELECT COUNT(*) as count FROM api_token_logs WHERE token_id = ?',
        [tokenId]
      );

      res.json({
        success: true,
        data: {
          logs,
          total: total[0]?.count || 0,
          limit,
          offset
        }
      });
    } catch (error) {
      this.moduleLogger.error('Failed to get token logs', { error, tokenId: req.params.id });
      res.status(500).json({ error: 'Failed to retrieve token logs' });
    }
  }

  /**
   * 获取Token使用历史统计 - 新增
   */
  private async handleGetTokenUsageHistory(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const startDate = req.query.start_date as string;
      const endDate = req.query.end_date as string;

      let whereClause = '';
      const params: any[] = [];

      // 构建日期范围过滤条件
      if (startDate && endDate) {
        whereClause = 'WHERE DATE(l.created_at) BETWEEN ? AND ?';
        params.push(startDate, endDate);
      } else if (startDate) {
        whereClause = 'WHERE DATE(l.created_at) >= ?';
        params.push(startDate);
      } else if (endDate) {
        whereClause = 'WHERE DATE(l.created_at) <= ?';
        params.push(endDate);
      }

      // 获取历史日志
      const logsQuery = `
        SELECT 
          l.id,
          l.token_id,
          t.project_name,
          l.action,
          l.result,
          l.error_message,
          l.response_time_ms,
          l.created_at
        FROM api_token_logs l
        JOIN api_tokens t ON l.token_id = t.id
        ${whereClause}
        ORDER BY l.created_at DESC
        LIMIT ? OFFSET ?
      `;
      const queryParams = [...params, limit, offset];
      const logs = await this.database.executeQuery<any>(logsQuery, queryParams);

      // 获取总数
      const totalQuery = await this.database.executeQuery<{count: number}>(
        `SELECT COUNT(*) as count FROM api_token_logs l ${whereClause}`,
        params
      );

      // 获取摘要统计
      const summaryQuery = await this.database.executeQuery<any>(`
        SELECT 
          COUNT(*) as total_requests,
          SUM(CASE WHEN result = 'success' THEN 1 ELSE 0 END) as successful_requests,
          SUM(CASE WHEN result = 'error' THEN 1 ELSE 0 END) as failed_requests,
          AVG(CASE WHEN response_time_ms IS NOT NULL THEN response_time_ms END) as avg_response_time
        FROM api_token_logs l
        ${whereClause}
      `, params);

      const summary = summaryQuery[0] || {
        total_requests: 0,
        successful_requests: 0,
        failed_requests: 0,
        avg_response_time: 0
      };

      const responseData: TokenUsageHistoryResponse = {
        success: true,
        data: {
          logs: logs.map((log: any) => ({
            id: log.id,
            token_id: log.token_id,
            project_name: log.project_name,
            action: log.action,
            result: log.result,
            error_message: log.error_message,
            response_time_ms: log.response_time_ms,
            created_at: new Date(log.created_at).toISOString()
          })),
          total: totalQuery[0]?.count || 0,
          limit,
          offset,
          date_range: startDate && endDate ? {
            start_date: startDate,
            end_date: endDate
          } : undefined,
          summary: {
            total_requests: parseInt(summary.total_requests) || 0,
            successful_requests: parseInt(summary.successful_requests) || 0,
            failed_requests: parseInt(summary.failed_requests) || 0,
            average_response_time: Math.round(parseFloat(summary.avg_response_time) || 0)
          }
        }
      };

      res.json(responseData);
    } catch (error) {
      this.moduleLogger.error('Failed to get token usage history', { error });
      res.status(500).json({ 
        success: false,
        error: 'Failed to retrieve token usage history',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 重置Token从黑名单 - 新增
   */
  private async handleResetToken(req: Request, res: Response): Promise<void> {
    try {
      const tokenId = parseInt(req.params.id);
      if (isNaN(tokenId)) {
        res.status(400).json({ 
          success: false,
          error: 'Invalid token ID',
          message: 'Token ID must be a valid number'
        });
        return;
      }

      // 获取token当前状态
      const tokenData = await this.database.executeQuery<any>(
        'SELECT * FROM api_tokens WHERE id = ?',
        [tokenId]
      );

      if (tokenData.length === 0) {
        res.status(404).json({ 
          success: false,
          error: 'Token not found',
          message: `No token found with ID ${tokenId}`
        });
        return;
      }

      const token = tokenData[0];
      const previousStatus = token.blacklisted_until ? 'blacklisted' : 'active';

      // 重置token状态
      const updateResult = await this.database.executeUpdate(`
        UPDATE api_tokens SET 
          blacklisted_until = NULL,
          blacklist_reason = NULL,
          error_count = 0,
          is_healthy = TRUE,
          updated_at = NOW()
        WHERE id = ?
      `, [tokenId]);

      if (updateResult === 0) {
        res.status(404).json({ 
          success: false,
          error: 'Failed to reset token',
          message: 'No rows were updated'
        });
        return;
      }

      // 记录操作日志
      this.moduleLogger.info('Token manually reset from blacklist', {
        tokenId,
        projectName: token.project_name,
        previousStatus,
        operationTime: new Date().toISOString()
      });

      const responseData: TokenResetResponse = {
        success: true,
        message: 'Token successfully reset from blacklist',
        data: {
          token_id: tokenId,
          previous_status: previousStatus,
          new_status: 'active'
        }
      };

      res.json(responseData);
    } catch (error) {
      this.moduleLogger.error('Failed to reset token', { error, tokenId: req.params.id });
      res.status(500).json({ 
        success: false,
        error: 'Failed to reset token',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  // Group Chat Management API Handlers
  
  /**
   * 获取群聊列表
   * GET /api/groups
   */
  private async handleGetGroups(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const enabled = req.query.enabled as string;
      
      // 获取群聊设置数据
      const groupSettings = await this.database.getGroupChatSettings();
      
      // 获取群聊统计概览
      const groupOverview = await this.database.getGroupChatOverview();
      
      // 合并数据
      const groupsData = groupSettings.map(setting => {
        const overview = groupOverview.find(o => o.group_id === setting.group_id);
        return {
          group_id: setting.group_id,
          group_name: setting.group_name,
          is_enabled: setting.is_enabled,
          auto_reply_enabled: setting.auto_reply_enabled,
          member_count: undefined, // 这个需要通过OneBot API获取，这里先设为未定义
          last_activity: setting.last_activity ? new Date(setting.last_activity).toISOString() : undefined,
          total_messages: overview?.total_messages || 0,
          total_ai_responses: overview?.total_ai_responses || 0,
          created_at: new Date(setting.created_at).toISOString()
        };
      })
      .filter(group => {
        // 按照enabled状态过滤
        if (enabled === 'true') return group.is_enabled;
        if (enabled === 'false') return !group.is_enabled;
        return true;
      })
      .slice(0, limit);
      
      const responseData: GroupListResponse = {
        success: true,
        data: groupsData,
        total: groupsData.length
      };
      
      res.json(responseData);
    } catch (error) {
      this.moduleLogger.error('Failed to get groups', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve groups',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * 获取单个群聊详情
   * GET /api/groups/:id
   */
  private async handleGetGroup(req: Request, res: Response): Promise<void> {
    try {
      const groupId = parseInt(req.params.id);
      if (isNaN(groupId)) {
        res.status(400).json({
          success: false,
          error: 'Invalid group ID',
          message: 'Group ID must be a valid number'
        });
        return;
      }
      
      // 获取群聊设置
      const groupSetting = await this.database.getGroupChatSettingById(groupId);
      if (!groupSetting) {
        res.status(404).json({
          success: false,
          error: 'Group not found',
          message: `No group found with ID ${groupId}`
        });
        return;
      }
      
      // 获取群聊统计数据 (最近30天)
      const groupStats = await this.database.getGroupChatStats(groupId, 30);
      const overview = await this.database.getGroupChatOverview();
      const groupOverview = overview.find(o => o.group_id === groupId);
      
      const responseData: GroupDetailResponse = {
        success: true,
        data: {
          group_id: groupSetting.group_id,
          group_name: groupSetting.group_name,
          is_enabled: groupSetting.is_enabled,
          auto_reply_enabled: groupSetting.auto_reply_enabled,
          welcome_message: groupSetting.welcome_message,
          admin_user_id: groupSetting.admin_user_id,
          last_activity: groupSetting.last_activity ? new Date(groupSetting.last_activity).toISOString() : undefined,
          created_at: new Date(groupSetting.created_at).toISOString(),
          updated_at: new Date(groupSetting.updated_at).toISOString(),
          stats: {
            total_messages: groupOverview?.total_messages || 0,
            total_ai_responses: groupOverview?.total_ai_responses || 0,
            avg_active_users: groupOverview?.avg_active_users || 0,
            recent_activity: groupStats.map(stat => ({
              date: stat.date,
              message_count: stat.message_count,
              ai_responses: stat.ai_responses,
              active_users: stat.active_users
            }))
          }
        }
      };
      
      res.json(responseData);
    } catch (error) {
      this.moduleLogger.error('Failed to get group', { error, groupId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve group',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * 创建/添加群聊
   * POST /api/groups
   */
  private async handleCreateGroup(req: Request, res: Response): Promise<void> {
    try {
      const { group_id, group_name, is_enabled, auto_reply_enabled, welcome_message, admin_user_id } = req.body;
      
      if (!group_id) {
        res.status(400).json({
          success: false,
          error: 'Missing required parameter: group_id'
        });
        return;
      }
      
      // 检查群聊是否已存在
      const existingGroup = await this.database.getGroupChatSettingById(group_id);
      if (existingGroup) {
        res.status(409).json({
          success: false,
          error: 'Group already exists',
          message: `Group with ID ${group_id} is already configured`
        });
        return;
      }
      
      const groupSettings: GroupChatSettings = {
        group_id: parseInt(group_id),
        group_name: group_name || null,
        is_enabled: is_enabled !== undefined ? Boolean(is_enabled) : true,
        auto_reply_enabled: auto_reply_enabled !== undefined ? Boolean(auto_reply_enabled) : true,
        welcome_message: welcome_message || null,
        admin_user_id: admin_user_id || null,
        created_at: new Date(),
        updated_at: new Date()
      };
      
      const success = await this.database.saveGroupChatSettings(groupSettings);
      
      if (success) {
        this.moduleLogger.info('Group chat created', { group_id, group_name });
        res.json({
          success: true,
          message: 'Group chat configuration created successfully',
          data: {
            group_id: groupSettings.group_id,
            is_enabled: groupSettings.is_enabled
          }
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to create group chat configuration'
        });
      }
    } catch (error) {
      this.moduleLogger.error('Failed to create group', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to create group',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * 更新群聊设置
   * PUT /api/groups/:id
   */
  private async handleUpdateGroup(req: Request, res: Response): Promise<void> {
    try {
      const groupId = parseInt(req.params.id);
      if (isNaN(groupId)) {
        res.status(400).json({
          success: false,
          error: 'Invalid group ID',
          message: 'Group ID must be a valid number'
        });
        return;
      }
      
      const { group_name, is_enabled, auto_reply_enabled, welcome_message, admin_user_id } = req.body;
      
      // 检查群聊是否存在
      const existingGroup = await this.database.getGroupChatSettingById(groupId);
      if (!existingGroup) {
        res.status(404).json({
          success: false,
          error: 'Group not found',
          message: `No group found with ID ${groupId}`
        });
        return;
      }
      
      const updateData: Partial<GroupChatSettings> = {};
      
      if (group_name !== undefined) updateData.group_name = group_name;
      if (is_enabled !== undefined) updateData.is_enabled = Boolean(is_enabled);
      if (auto_reply_enabled !== undefined) updateData.auto_reply_enabled = Boolean(auto_reply_enabled);
      if (welcome_message !== undefined) updateData.welcome_message = welcome_message;
      if (admin_user_id !== undefined) updateData.admin_user_id = admin_user_id;
      
      if (Object.keys(updateData).length === 0) {
        res.status(400).json({
          success: false,
          error: 'No valid fields provided for update'
        });
        return;
      }
      
      const success = await this.database.updateGroupChatSettings(groupId, updateData);
      
      if (success) {
        this.moduleLogger.info('Group chat settings updated', { groupId, updateData });
        res.json({
          success: true,
          message: 'Group chat settings updated successfully',
          data: {
            group_id: groupId,
            updated_fields: Object.keys(updateData)
          }
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to update group chat settings'
        });
      }
    } catch (error) {
      this.moduleLogger.error('Failed to update group', { error, groupId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Failed to update group',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * 删除群聊设置
   * DELETE /api/groups/:id
   */
  private async handleDeleteGroup(req: Request, res: Response): Promise<void> {
    try {
      const groupId = parseInt(req.params.id);
      if (isNaN(groupId)) {
        res.status(400).json({
          success: false,
          error: 'Invalid group ID',
          message: 'Group ID must be a valid number'
        });
        return;
      }
      
      // 检查群聊是否存在
      const existingGroup = await this.database.getGroupChatSettingById(groupId);
      if (!existingGroup) {
        res.status(404).json({
          success: false,
          error: 'Group not found',
          message: `No group found with ID ${groupId}`
        });
        return;
      }
      
      const success = await this.database.deleteGroupChatSettings(groupId);
      
      if (success) {
        this.moduleLogger.info('Group chat settings deleted', { groupId });
        res.json({
          success: true,
          message: 'Group chat configuration deleted successfully',
          data: {
            group_id: groupId
          }
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to delete group chat configuration'
        });
      }
    } catch (error) {
      this.moduleLogger.error('Failed to delete group', { error, groupId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Failed to delete group',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * 批量群聊操作
   * POST /api/groups/bulk
   */
  private async handleBulkGroupOperations(req: Request, res: Response): Promise<void> {
    try {
      const { group_ids, action, settings }: GroupBulkOperationRequest = req.body;
      
      if (!group_ids || !Array.isArray(group_ids) || group_ids.length === 0) {
        res.status(400).json({
          success: false,
          error: 'Missing or invalid group_ids array'
        });
        return;
      }
      
      if (!action || !['enable', 'disable', 'delete'].includes(action)) {
        res.status(400).json({
          success: false,
          error: 'Invalid action. Must be one of: enable, disable, delete'
        });
        return;
      }
      
      let results: { successful: number; failed: number; results: Array<{ group_id: number; success: boolean; message?: string }> };
      
      if (action === 'delete') {
        // 批量删除
        const deleteResults = [];
        let successful = 0;
        let failed = 0;
        
        for (const groupId of group_ids) {
          try {
            const success = await this.database.deleteGroupChatSettings(groupId);
            if (success) {
              successful++;
              deleteResults.push({ group_id: groupId, success: true });
            } else {
              failed++;
              deleteResults.push({ group_id: groupId, success: false, message: 'No rows affected' });
            }
          } catch (error) {
            failed++;
            deleteResults.push({
              group_id: groupId,
              success: false,
              message: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
        
        results = { successful, failed, results: deleteResults };
      } else {
        // 批量更新（启用/禁用）
        const updateData: Partial<GroupChatSettings> = {
          is_enabled: action === 'enable'
        };
        
        // 如果提供了额外设置，合并到更新数据中
        if (settings) {
          Object.assign(updateData, settings);
        }
        
        results = await this.database.bulkUpdateGroupChatSettings(group_ids, updateData);
      }
      
      this.moduleLogger.info('Bulk group operation completed', {
        action,
        groupCount: group_ids.length,
        successful: results.successful,
        failed: results.failed
      });
      
      const responseData: GroupBulkOperationResponse = {
        success: true,
        data: {
          processed: group_ids.length,
          successful: results.successful,
          failed: results.failed,
          results: results.results
        },
        message: `Bulk ${action} operation completed: ${results.successful} successful, ${results.failed} failed`
      };
      
      res.json(responseData);
    } catch (error) {
      this.moduleLogger.error('Failed to perform bulk group operations', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to perform bulk operations',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * 获取群聊统计信息
   * GET /api/groups/stats
   */
  private async handleGetGroupStats(req: Request, res: Response): Promise<void> {
    try {
      const globalStats = await this.database.getGroupChatGlobalStats();
      
      const responseData: GroupStatsResponse = {
        success: true,
        data: globalStats
      };
      
      res.json(responseData);
    } catch (error) {
      this.moduleLogger.error('Failed to get group stats', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve group statistics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

export default HttpServer;
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

    // Send private message endpoint
    this.app.post('/api/send_private', async (req: Request, res: Response) => {
      const { user_id, message } = req.body;
      
      if (!user_id || !message) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: user_id, message',
          timestamp: new Date().toISOString()
        });
      }

      this.moduleLogger.info(`API请求发送私聊消息: ${user_id} - ${message}`);
      
      try {
        if (!this.services.websocketClient) {
          throw new Error('WebSocket client not available');
        }

        if (!this.services.websocketClient.isConnected()) {
          throw new Error('WebSocket client not connected');
        }

        await this.services.websocketClient.sendPrivateMessage(user_id, message);
        
        res.json({
          success: true,
          message: 'Private message sent successfully',
          user_id: user_id,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.moduleLogger.error('Failed to send private message', { error, user_id, message });
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Send group message endpoint
    this.app.post('/api/send_group', async (req: Request, res: Response) => {
      const { group_id, message } = req.body;
      
      if (!group_id || !message) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: group_id, message',
          timestamp: new Date().toISOString()
        });
      }

      this.moduleLogger.info(`API请求发送群聊消息: ${group_id} - ${message}`);
      
      try {
        if (!this.services.websocketClient) {
          throw new Error('WebSocket client not available');
        }

        if (!this.services.websocketClient.isConnected()) {
          throw new Error('WebSocket client not connected');
        }

        await this.services.websocketClient.sendGroupMessage(group_id, message);
        
        res.json({
          success: true,
          message: 'Group message sent successfully',
          group_id: group_id,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.moduleLogger.error('Failed to send group message', { error, group_id, message });
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    });

    // 调试API端点
    this.app.get('/api/debug/stats', (req: Request, res: Response) => {
      if (!this.services.debugService) {
        return res.status(404).json({
          success: false,
          error: 'Debug service not available',
          timestamp: new Date().toISOString()
        });
      }

      try {
        const stats = this.services.debugService.getDebugStats();
        res.json({
          success: true,
          data: stats,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    });

    // 获取对话调试信息
    this.app.get('/api/debug/conversation/:conversationId', (req: Request, res: Response) => {
      if (!this.services.debugService) {
        return res.status(404).json({
          success: false,
          error: 'Debug service not available',
          timestamp: new Date().toISOString()
        });
      }

      try {
        const { conversationId } = req.params;
        const debugInfo = this.services.debugService.getConversationDebugInfo(conversationId);
        
        if (!debugInfo) {
          return res.status(404).json({
            success: false,
            error: 'Conversation not found',
            timestamp: new Date().toISOString()
          });
        }

        res.json({
          success: true,
          data: debugInfo,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    });

    // 获取用户最近的对话调试信息
    this.app.get('/api/debug/user/:userId/recent', (req: Request, res: Response) => {
      if (!this.services.debugService) {
        return res.status(404).json({
          success: false,
          error: 'Debug service not available',
          timestamp: new Date().toISOString()
        });
      }

      try {
        const userId = parseInt(req.params.userId);
        const limit = parseInt(req.query.limit as string) || 10;
        const recentInfo = this.services.debugService.getRecentDebugInfo(userId, limit);

        res.json({
          success: true,
          data: recentInfo,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    });

    // 搜索调试信息
    this.app.get('/api/debug/search', (req: Request, res: Response) => {
      if (!this.services.debugService) {
        return res.status(404).json({
          success: false,
          error: 'Debug service not available',
          timestamp: new Date().toISOString()
        });
      }

      try {
        const { keyword, limit } = req.query;
        if (!keyword) {
          return res.status(400).json({
            success: false,
            error: 'Missing keyword parameter',
            timestamp: new Date().toISOString()
          });
        }

        const searchLimit = parseInt(limit as string) || 20;
        const results = this.services.debugService.searchDebugInfo(keyword as string, searchLimit);

        res.json({
          success: true,
          data: results,
          count: results.length,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    });

    // 导出调试信息
    this.app.get('/api/debug/export/:conversationId', (req: Request, res: Response) => {
      if (!this.services.debugService) {
        return res.status(404).json({
          success: false,
          error: 'Debug service not available',
          timestamp: new Date().toISOString()
        });
      }

      try {
        const { conversationId } = req.params;
        const exportData = this.services.debugService.exportDebugInfo(conversationId);
        
        if (!exportData) {
          return res.status(404).json({
            success: false,
            error: 'Conversation not found',
            timestamp: new Date().toISOString()
          });
        }

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="debug_${conversationId}.json"`);
        res.send(exportData);
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    });

    // 📊 新增：全面对话调试接口 - 查看用户原始输入和所有LLM调用
    this.app.get('/api/debug/conversations', async (req: Request, res: Response) => {
      try {
        if (!this.services.database) {
          return res.status(500).json({
            success: false,
            error: 'Database service not available',
            timestamp: new Date().toISOString()
          });
        }

        const limit = Math.min(Math.max(1, Math.floor(Number(req.query.limit as string) || 20)), 100);
        const offset = Math.max(0, Math.floor(Number(req.query.offset as string) || 0));
        const userId = req.query.userId ? parseInt(req.query.userId as string) : null;

        // 获取对话记录 - 包含用户原始输入和AI回复，使用安全的JSON处理
        let query = `
          SELECT c.*, 
                 CASE 
                   WHEN c.raw_request IS NOT NULL AND JSON_VALID(c.raw_request) 
                   THEN JSON_UNQUOTE(JSON_EXTRACT(c.raw_request, '$.raw_message'))
                   ELSE NULL 
                 END as user_raw_input,
                 CASE 
                   WHEN c.raw_request IS NOT NULL AND JSON_VALID(c.raw_request) 
                   THEN JSON_UNQUOTE(JSON_EXTRACT(c.raw_request, '$.sender.nickname'))
                   ELSE NULL 
                 END as user_nickname,
                 CASE 
                   WHEN c.raw_request IS NOT NULL AND JSON_VALID(c.raw_request) 
                   THEN JSON_UNQUOTE(JSON_EXTRACT(c.raw_request, '$.message_type'))
                   ELSE NULL 
                 END as message_type,
                 CASE 
                   WHEN c.raw_request IS NOT NULL AND JSON_VALID(c.raw_request) 
                   THEN JSON_EXTRACT(c.raw_request, '$.group_id')
                   ELSE NULL 
                 END as group_id
          FROM conversations c 
        `;
        
        const params: any[] = [];
        
        if (userId) {
          query += ` WHERE c.user_id = ? `;
          params.push(userId);
        }
        
        // LIMIT/OFFSET不支持参数绑定，使用字符串插值（已验证为安全数值）
        query += ` ORDER BY c.timestamp DESC LIMIT ${parseInt(limit.toString())} OFFSET ${parseInt(offset.toString())}`;

        this.moduleLogger.info('Executing debug conversations query', { 
          limit, 
          offset, 
          userId,
          queryLength: query.length
        });

        const conversations = await this.services.database.executeQuery(query, params);

        // 增强对话记录，暂时简化LLM调用详情以避免超时
        const enhancedConversations = conversations.map((conv: any) => {
          return {
            conversation_id: conv.id,
            user_id: conv.user_id,
            user_nickname: conv.user_nickname,
            message_type: conv.message_type,
            group_id: conv.group_id,
            timestamp: conv.timestamp,
            
            // 用户原始输入
            user_input: {
              raw_message: conv.user_raw_input,
              processed_message: conv.user_message,
              full_raw_data: conv.raw_request
            },
            
            // AI回复
            ai_response: {
              final_response: conv.ai_response,
              response_time: conv.response_time,
              model_name: conv.model_name
            },
            
            // LLM调用详情 - 暂时简化
            llm_calls: [], // 简化版本，避免文件系统IO导致超时
            llm_call_count: 0,
            
            // 性能指标
            total_processing_time: conv.response_time,
            total_llm_time: 0
          };
        });

        res.json({
          success: true,
          data: enhancedConversations,
          pagination: {
            limit,
            offset,
            count: enhancedConversations.length,
            total: userId ? 'N/A' : 'N/A' // 简化版本不计算总数
          },
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        this.moduleLogger.error('Failed to fetch debug conversations', { error });
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    });

    // 📊 获取特定对话的详细LLM调用流程
    this.app.get('/api/debug/conversation/:conversationId/llm-flow', async (req: Request, res: Response) => {
      try {
        const { conversationId } = req.params;
        
        if (!this.services.database) {
          return res.status(500).json({
            success: false,
            error: 'Database service not available',
            timestamp: new Date().toISOString()
          });
        }

        // 获取对话基本信息
        const conversationQuery = `SELECT * FROM conversations WHERE id = ?`;
        const conversations = await this.services.database.executeQuery(conversationQuery, [conversationId]);
        
        if (conversations.length === 0) {
          return res.status(404).json({
            success: false,
            error: 'Conversation not found',
            timestamp: new Date().toISOString()
          });
        }

        const conversation = conversations[0];
        
        // 获取数据库中的LLM追踪数据
        const llmTraces = conversation.session_id ? 
          await this.services.database.executeQuery(
            `SELECT * FROM llm_call_traces WHERE conversation_id = ? ORDER BY call_sequence ASC`, 
            [conversationId]
          ) : [];

        res.json({
          conversation_id: conversationId,
          websocket_input: this.safeJsonParse(conversation.raw_request) || {},
          websocket_output: {
            content: conversation.ai_response,
            response_time_ms: conversation.response_time,
            model: conversation.model_name,
            timestamp: conversation.timestamp instanceof Date ? conversation.timestamp.toISOString() : new Date(conversation.timestamp).toISOString()
          },
          llm_trace: llmTraces.map((trace: any) => ({
            llm_raw_input: {
              engine_type: trace.engine_type,
              call_sequence: trace.call_sequence,
              model_name: trace.model_name,
              timestamp: trace.timestamp instanceof Date ? trace.timestamp.toISOString() : new Date(trace.timestamp).toISOString(),
              gemini_request: this.safeJsonParse(trace.request)
            },
            llm_raw_output: {
              prompt_tokens: trace.prompt_tokens,
              completion_tokens: trace.completion_tokens,
              total_tokens: trace.total_tokens,
              response_time_ms: trace.response_time,
              success: trace.success,
              gemini_response: this.safeJsonParse(trace.response)
            }
          }))
        });

      } catch (error) {
        this.moduleLogger.error('Failed to fetch LLM flow', { error, conversationId: req.params.conversationId });
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    });

    // 🧪 测试端点：模拟私聊消息
    this.app.post('/api/test/simulate_private_message', async (req: Request, res: Response) => {
      const { user_id, message } = req.body;
      
      if (!user_id || !message) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: user_id, message',
          timestamp: new Date().toISOString()
        });
      }

      this.moduleLogger.info('🧪 Simulating private message via API', { user_id, message });
      
      try {
        if (!this.services.qqBot) {
          throw new Error('QQBot instance not available');
        }

        const result = await this.services.qqBot.simulatePrivateMessage({
          user_id: parseInt(user_id),
          message,
          raw_message: message,
          message_id: Date.now()
        });
        
        res.json({
          success: result.success,
          error: result.error || null,
          message: result.success ? 'Test message processed successfully' : 'Test message failed',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.moduleLogger.error('Failed to simulate private message', { error, user_id, message });
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    });

    // 🧪 测试端点：模拟群聊消息
    this.app.post('/api/test/simulate_group_message', async (req: Request, res: Response) => {
      const { user_id, group_id, message } = req.body;
      
      if (!user_id || !group_id || !message) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: user_id, group_id, message',
          timestamp: new Date().toISOString()
        });
      }

      this.moduleLogger.info('🧪 Simulating group message via API', { user_id, group_id, message });
      
      try {
        if (!this.services.qqBot) {
          throw new Error('QQBot instance not available');
        }

        const result = await this.services.qqBot.simulateGroupMessage({
          user_id: parseInt(user_id),
          group_id: parseInt(group_id),
          message,
          raw_message: message,
          message_id: Date.now()
        });
        
        res.json({
          success: result.success,
          error: result.error || null,
          message: result.success ? 'Test group message processed successfully' : 'Test group message failed',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.moduleLogger.error('Failed to simulate group message', { error, user_id, group_id, message });
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
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

  /**
   * Safe JSON parsing utility
   */
  private safeJsonParse(jsonString: any): any {
    if (!jsonString) return null;
    if (typeof jsonString === 'object') return jsonString;
    if (typeof jsonString !== 'string') return null;
    
    try {
      return JSON.parse(jsonString);
    } catch (error) {
      this.moduleLogger.warn('Failed to parse JSON string', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        preview: typeof jsonString === 'string' ? jsonString.substring(0, 100) : 'N/A'
      });
      return null;
    }
  }

  /**
   * 从日志中提取LLM调用信息 (异步优化版本)
   */
  private async extractLLMCallsFromLogs(conversationId: string, timestamp: Date): Promise<any[]> {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      
      // 读取AI服务日志文件
      const logDate = new Date(timestamp).toISOString().split('T')[0];
      const logPath = path.join(__dirname, '../../logs', `ai-service_${logDate}.log`);
      
      // 检查文件是否存在
      try {
        await fs.access(logPath);
      } catch (error) {
        this.moduleLogger.debug(`Log file not found: ${logPath}`);
        return [];
      }
      
      // 检查文件大小，避免读取过大的文件
      const stats = await fs.stat(logPath);
      const fileSizeInMB = stats.size / 1024 / 1024;
      
      if (fileSizeInMB > 10) { // 超过10MB则跳过
        this.moduleLogger.warn(`Log file too large (${fileSizeInMB.toFixed(2)}MB), skipping LLM extraction`, { 
          logPath, 
          conversationId 
        });
        return [];
      }
      
      // 异步读取文件内容
      const logContent = await fs.readFile(logPath, 'utf-8');
      const logLines = logContent.split('\n').filter((line: string) => line.trim());
      
      const llmCalls: any[] = [];
      const timeWindow = 5 * 60 * 1000; // 5分钟窗口
      
      // 优化：只处理时间窗口内可能的行数（避免处理整个文件）
      for (let i = 0; i < Math.min(logLines.length, 1000); i++) { // 最多处理1000行
        const line = logLines[i];
        try {
          const logEntry = JSON.parse(line);
          
          // 先检查时间窗口，减少不必要的处理
          const logTime = new Date(logEntry.timestamp);
          const timeDiff = Math.abs(logTime.getTime() - timestamp.getTime());
          
          if (timeDiff > timeWindow) {
            continue; // 超出时间窗口，跳过
          }
          
          // 查找Gemini API调用成功的日志
          if (logEntry.message === 'Gemini API call successful' && logEntry.extra) {
            const extra = logEntry.extra;
            
            llmCalls.push({
              timestamp: logTime,
              agent_type: extra.agentType || 'unknown',
              model: extra.model || 'gemini-2.5-flash',
              prompt_name: extra.promptName || 'unknown',
              response_time: extra.responseTime || 0,
              token_usage: extra.tokenUsage || {},
              attempt: extra.attempt || 1,
              token_prefix: extra.tokenPrefix ? extra.tokenPrefix.substring(0, 12) + '...' : 'N/A'
            });
          }
        } catch (parseError) {
          // 跳过无法解析的日志行
          continue;
        }
      }
      
      // 按时间排序
      return llmCalls.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      
    } catch (error) {
      this.moduleLogger.warn('Failed to extract LLM calls from logs', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        conversationId,
        timestamp: new Date(timestamp).toISOString()
      });
      return [];
    }
  }

  /**
   * 提取详细的LLM调用流程（包含更多上下文）- 异步优化版本
   */
  private async extractDetailedLLMFlow(conversationId: string, timestamp: Date): Promise<any[]> {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      
      // 读取AI服务日志和主日志文件
      const logDate = new Date(timestamp).toISOString().split('T')[0];
      const aiLogPath = path.join(__dirname, '../../logs', `ai-service_${logDate}.log`);
      const mainLogPath = path.join(__dirname, '../../logs', `main_${logDate}.log`);
      
      const llmFlow: any[] = [];
      const timeWindow = 5 * 60 * 1000; // 5分钟窗口
      
      // 并行处理两个日志文件（异步优化）
      const processLogFile = async (logPath: string, fileType: 'ai' | 'main') => {
        try {
          await fs.access(logPath);
          
          // 检查文件大小
          const stats = await fs.stat(logPath);
          const fileSizeInMB = stats.size / 1024 / 1024;
          
          if (fileSizeInMB > 10) { // 超过10MB则跳过
            this.moduleLogger.warn(`${fileType} log file too large (${fileSizeInMB.toFixed(2)}MB), skipping`, { 
              logPath, conversationId 
            });
            return [];
          }
          
          const logContent = await fs.readFile(logPath, 'utf-8');
          const logLines = logContent.split('\n').filter((line: string) => line.trim());
          
          const results: any[] = [];
          
          // 只处理最近的行（性能优化）
          for (let i = 0; i < Math.min(logLines.length, 1000); i++) {
            const line = logLines[i];
            try {
              const logEntry = JSON.parse(line);
              const logTime = new Date(logEntry.timestamp);
              const timeDiff = Math.abs(logTime.getTime() - timestamp.getTime());
              
              if (timeDiff > timeWindow) {
                continue; // 超出时间窗口，跳过
              }
              
              if (fileType === 'ai') {
                // AI日志处理
                if (logEntry.message === 'Gemini API call successful' && logEntry.extra) {
                  const extra = logEntry.extra;
                  
                  results.push({
                    timestamp: logTime,
                    type: 'llm_call',
                    agent_type: extra.agentType || 'unknown',
                    model: extra.model || 'gemini-2.5-flash',
                    prompt_name: extra.promptName || 'unknown',
                    response_time: extra.responseTime || 0,
                    token_usage: {
                      prompt_tokens: extra.tokenUsage?.promptTokenCount || 0,
                      completion_tokens: extra.tokenUsage?.candidatesTokenCount || 0,
                      total_tokens: extra.tokenUsage?.totalTokenCount || 0,
                      token_details: extra.tokenUsage
                    },
                    attempt: extra.attempt || 1,
                    token_prefix: extra.tokenPrefix ? extra.tokenPrefix.substring(0, 12) + '...' : 'N/A'
                  });
                } else if (logEntry.message.includes('API call') || logEntry.message.includes('call successful')) {
                  results.push({
                    timestamp: logTime,
                    type: 'api_call',
                    message: logEntry.message,
                    extra: logEntry.extra
                  });
                }
              } else {
                // 主日志处理
                if (logEntry.message.includes('enhanced') || 
                    logEntry.message.includes('engine') ||
                    logEntry.message.includes('processing')) {
                  
                  results.push({
                    timestamp: logTime,
                    type: 'processing_step',
                    step: logEntry.message,
                    extra: logEntry.extra
                  });
                }
              }
            } catch (parseError) {
              continue;
            }
          }
          
          return results;
          
        } catch (error) {
          this.moduleLogger.debug(`Failed to process ${fileType} log file: ${logPath}`, { error });
          return [];
        }
      };
      
      // 并行处理两个日志文件
      const [aiResults, mainResults] = await Promise.all([
        processLogFile(aiLogPath, 'ai'),
        processLogFile(mainLogPath, 'main')
      ]);
      
      // 合并结果
      llmFlow.push(...aiResults, ...mainResults);
      
      // 按时间排序并重新编号
      const sortedFlow = llmFlow.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      return sortedFlow.map((step, index) => ({
        ...step,
        sequence: index + 1
      }));
      
    } catch (error) {
      this.moduleLogger.warn('Failed to extract detailed LLM flow', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        conversationId,
        timestamp: new Date(timestamp).toISOString()
      });
      return [];
    }
  }
}

export default HttpServer;
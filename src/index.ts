import { config } from './config';
import { logger } from './utils/logger';
import { DatabaseManager, getDatabaseManager } from './services/database';
import WebSocketClient from './services/websocket-client';
import HttpServer from './services/http-server';
import AIService from './services/ai-service';
import { QQMessage, QQNotice, QQRequest, ConversationData, RequirementData } from './types';
import { v4 as uuidv4 } from 'uuid';

class QQBot {
  private database: DatabaseManager;
  private websocketClient: WebSocketClient;
  private httpServer: HttpServer;
  private aiService: AIService;
  private moduleLogger = logger.createModuleLogger('main');
  
  // 群聊管理状态
  private groupReplyEnabled: boolean = true;
  private allowedGroups: Set<number> = new Set();

  constructor() {
    this.database = getDatabaseManager(config.database);
    this.websocketClient = new WebSocketClient(config.websocket);
    this.aiService = new AIService(config.ai);
    this.httpServer = new HttpServer(config.http_server, {
      database: this.database,
      websocketClient: this.websocketClient
    });
  }

  public async start(): Promise<void> {
    try {
      this.moduleLogger.info('🚀 Starting QQ Bot...');

      // 测试数据库连接
      const dbConnected = await this.database.testConnection();
      if (!dbConnected) {
        throw new Error('Database connection failed');
      }
      this.moduleLogger.info('✅ Database connected');

      // 启动HTTP服务器
      await this.httpServer.start();
      this.moduleLogger.info('✅ HTTP server started');

      // 设置WebSocket事件监听器
      this.setupWebSocketEventHandlers();

      // 连接到WebSocket服务器
      await this.websocketClient.connect();
      this.moduleLogger.info('✅ WebSocket client connected');

      // 更新机器人状态
      await this.database.updateBotStatus(
        config.ai.bot_qq_number.toString(),
        'running',
        this.websocketClient.isConnected(),
        true
      );

      this.moduleLogger.info('🎉 QQ Bot started successfully!');

    } catch (error) {
      this.moduleLogger.error('❌ Failed to start QQ Bot', { error });
      throw error;
    }
  }

  private setupWebSocketEventHandlers(): void {
    // 连接事件
    this.websocketClient.on('connected', () => {
      this.moduleLogger.info('WebSocket connected');
    });

    this.websocketClient.on('disconnected', (data) => {
      this.moduleLogger.warn('WebSocket disconnected', data);
    });

    this.websocketClient.on('error', (error) => {
      this.moduleLogger.error('WebSocket error', { error });
    });

    // 消息事件
    this.websocketClient.on('private_message', this.handlePrivateMessage.bind(this));
    this.websocketClient.on('group_message', this.handleGroupMessage.bind(this));
    this.websocketClient.on('notice', this.handleNotice.bind(this));
    this.websocketClient.on('request', this.handleRequest.bind(this));
    this.websocketClient.on('message_sent', this.handleMessageSent.bind(this));
  }

  private async handlePrivateMessage(message: QQMessage): Promise<void> {
    try {
      this.moduleLogger.info('Received private message', {
        user_id: message.user_id,
        message: message.message
      });

      const userId = message.user_id;
      const userMessage = message.message.trim();

      // 处理群聊管理命令 (仅授权用户)
      if (this.aiService.isAuthorizedUser(userId)) {
        const handled = await this.handleGroupManagementCommand(userId, userMessage);
        if (handled) return;

        // 分析是否为需求
        const intent = await this.aiService.analyzeIntent(userMessage, userId);
        
        if (intent.isRequirement && intent.confidence > 60) {
          await this.handleRequirement(userId, userMessage, intent, message);
          return;
        }
      }

      // 普通AI对话
      await this.handleAIConversation(userId, userMessage, message);

    } catch (error) {
      this.moduleLogger.error('Error handling private message', { error, message });
      try {
        await this.websocketClient.sendPrivateMessage(
          message.user_id,
          '抱歉，处理您的消息时出现了错误，请稍后再试。'
        );
      } catch (sendError) {
        this.moduleLogger.error('Failed to send error message', { sendError });
      }
    }
  }

  private async handleGroupMessage(message: QQMessage): Promise<void> {
    try {
      // 只处理@机器人的消息
      const botQQ = this.aiService.getBotQQNumber();
      const isAtBot = message.message.includes(`[CQ:at,qq=${botQQ}]`) || 
                      message.message.includes(`@${botQQ}`);

      if (!isAtBot || !this.groupReplyEnabled) {
        return;
      }

      // 检查群聊白名单
      if (message.group_id && this.allowedGroups.size > 0 && !this.allowedGroups.has(message.group_id)) {
        return;
      }

      this.moduleLogger.info('Received group at message', {
        group_id: message.group_id,
        user_id: message.user_id,
        message: message.message
      });

      // 清理消息内容（移除@信息）
      const cleanMessage = message.message
        .replace(/\[CQ:at,qq=\d+\]/g, '')
        .replace(/@\d+/g, '')
        .trim();

      if (!cleanMessage) {
        await this.websocketClient.sendGroupMessage(
          message.group_id!,
          '您好！我是智能助手，有什么可以帮助您的吗？'
        );
        return;
      }

      // AI对话处理
      await this.handleAIConversation(message.user_id, cleanMessage, message);

    } catch (error) {
      this.moduleLogger.error('Error handling group message', { error, message });
    }
  }

  private async handleGroupManagementCommand(userId: number, message: string): Promise<boolean> {
    const commands = {
      '开启群聊': () => {
        this.groupReplyEnabled = true;
        return '✅ 群聊AI回复已开启';
      },
      '关闭群聊': () => {
        this.groupReplyEnabled = false;
        return '❌ 群聊AI回复已关闭';
      },
      '群聊列表': () => {
        const groups = Array.from(this.allowedGroups);
        return groups.length > 0 
          ? `📋 当前允许的群聊: ${groups.join(', ')}`
          : '📋 当前没有设置群聊白名单';
      },
      '清空群聊': () => {
        this.allowedGroups.clear();
        return '🗑️ 群聊白名单已清空';
      }
    };

    // 检查基本命令
    if (message in commands) {
      const response = commands[message as keyof typeof commands]();
      await this.websocketClient.sendPrivateMessage(userId, response);
      return true;
    }

    // 检查添加群聊命令
    const addGroupMatch = message.match(/^添加群聊\s+(\d+)$/);
    if (addGroupMatch) {
      const groupId = parseInt(addGroupMatch[1]);
      this.allowedGroups.add(groupId);
      await this.websocketClient.sendPrivateMessage(
        userId,
        `✅ 已添加群聊 ${groupId} 到白名单`
      );
      return true;
    }

    // 检查移除群聊命令
    const removeGroupMatch = message.match(/^移除群聊\s+(\d+)$/);
    if (removeGroupMatch) {
      const groupId = parseInt(removeGroupMatch[1]);
      this.allowedGroups.delete(groupId);
      await this.websocketClient.sendPrivateMessage(
        userId,
        `❌ 已从白名单移除群聊 ${groupId}`
      );
      return true;
    }

    return false;
  }

  private async handleRequirement(
    userId: number,
    message: string,
    intent: any,
    originalMessage: QQMessage
  ): Promise<void> {
    const requirementId = uuidv4();
    
    try {
      this.moduleLogger.info('Processing requirement', {
        requirementId,
        userId,
        message,
        intent
      });

      // 保存需求到数据库
      const requirementData: RequirementData = {
        id: requirementId,
        user_id: userId,
        message: message,
        status: 'pending',
        created_at: new Date(),
        updated_at: new Date()
      };

      await this.database.saveRequirement(requirementData);

      // 发送确认消息
      let responseMessage = `🔧 已识别为开发需求 (${intent.category}, ${intent.complexity})\n`;
      responseMessage += `📋 需求ID: ${requirementId}\n`;
      responseMessage += `⏳ 正在处理中...`;

      if (intent.complexity === '复杂') {
        responseMessage += '\n\n💡 检测到复杂需求，将启用标准化TDD/BDD多Agent协作模式进行处理。';
      }

      await this.websocketClient.sendPrivateMessage(userId, responseMessage);

      // TODO: 这里应该调用实际的需求处理逻辑
      // 目前只是占位符实现
      setTimeout(async () => {
        try {
          await this.database.updateRequirementStatus(
            requirementId,
            'completed',
            {
              completion_details: 'TypeScript重构完成，需求处理逻辑待实现',
              processing_end_time: new Date()
            }
          );

          await this.websocketClient.sendPrivateMessage(
            userId,
            `✅ 需求 ${requirementId} 处理完成！\n\n注：当前为TypeScript重构版本，具体需求处理逻辑还在开发中。`
          );
        } catch (error) {
          this.moduleLogger.error('Failed to update requirement completion', { error });
        }
      }, 5000);

    } catch (error) {
      this.moduleLogger.error('Failed to process requirement', { error, requirementId });
      
      await this.database.updateRequirementStatus(
        requirementId,
        'failed',
        {
          error_message: error instanceof Error ? error.message : 'Unknown error',
          processing_end_time: new Date()
        }
      );

      await this.websocketClient.sendPrivateMessage(
        userId,
        `❌ 需求处理失败: ${requirementId}\n\n错误信息: ${error instanceof Error ? error.message : '未知错误'}`
      );
    }
  }

  private async handleAIConversation(
    userId: number,
    message: string,
    originalMessage: QQMessage
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // 生成AI响应
      const conversation = await this.aiService.generateResponse(message, userId);
      const responseTime = Date.now() - startTime;

      // 更新响应时间
      conversation.response_time = responseTime;
      conversation.message_id = originalMessage.message_id;

      // 保存对话到数据库
      await this.database.saveConversation(conversation);

      // 发送响应
      if (originalMessage.message_type === 'group' && originalMessage.group_id) {
        await this.websocketClient.sendGroupMessage(
          originalMessage.group_id,
          conversation.ai_response
        );
      } else {
        await this.websocketClient.sendPrivateMessage(
          userId,
          conversation.ai_response
        );
      }

      this.moduleLogger.info('AI conversation completed', {
        conversationId: conversation.id,
        userId,
        responseTime
      });

    } catch (error) {
      this.moduleLogger.error('Failed to handle AI conversation', { error, userId });
      
      const errorMessage = 'sorry，我现在无法正常回复，请稍后再试...';
      
      if (originalMessage.message_type === 'group' && originalMessage.group_id) {
        await this.websocketClient.sendGroupMessage(originalMessage.group_id, errorMessage);
      } else {
        await this.websocketClient.sendPrivateMessage(userId, errorMessage);
      }
    }
  }

  private async handleNotice(notice: QQNotice): Promise<void> {
    this.moduleLogger.debug('Received notice', notice);
    
    if (notice.notice_type === 'group_increase') {
      this.moduleLogger.info('New group member joined', {
        group_id: notice.group_id,
        user_id: notice.user_id
      });
    } else if (notice.notice_type === 'group_decrease') {
      this.moduleLogger.info('Group member left', {
        group_id: notice.group_id,
        user_id: notice.user_id
      });
    }
  }

  private async handleRequest(request: QQRequest): Promise<void> {
    this.moduleLogger.info('Received request', request);
    
    // 自动同意好友请求 (可以根据需要修改)
    if (request.request_type === 'friend') {
      await this.websocketClient.setFriendAddRequest(request.flag, true);
      this.moduleLogger.info('Auto approved friend request', {
        user_id: request.user_id,
        flag: request.flag
      });
    }
  }

  private async handleMessageSent(event: any): Promise<void> {
    this.moduleLogger.debug('Bot message sent', event);
  }

  public async stop(): Promise<void> {
    try {
      this.moduleLogger.info('🛑 Stopping QQ Bot...');

      // 更新机器人状态
      await this.database.updateBotStatus(
        config.ai.bot_qq_number.toString(),
        'stopping',
        false,
        false
      );

      // 停止各个服务
      this.websocketClient.close();
      await this.httpServer.stop();
      await this.database.close();

      this.moduleLogger.info('✅ QQ Bot stopped successfully');
    } catch (error) {
      this.moduleLogger.error('Error stopping QQ Bot', { error });
    }
  }
}

// 优雅关闭处理
async function gracefulShutdown(bot: QQBot): Promise<void> {
  const signals = ['SIGINT', 'SIGTERM'];
  
  signals.forEach(signal => {
    process.on(signal, async () => {
      console.log(`\nReceived ${signal}, shutting down gracefully...`);
      try {
        await bot.stop();
        process.exit(0);
      } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
      }
    });
  });
}

// 启动应用
async function main(): Promise<void> {
  const bot = new QQBot();
  
  try {
    await bot.start();
    await gracefulShutdown(bot);
  } catch (error) {
    logger.error('main', 'Failed to start application', { error });
    process.exit(1);
  }
}

// 未捕获异常处理
process.on('uncaughtException', (error) => {
  logger.error('main', 'Uncaught Exception', { error });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('main', 'Unhandled Rejection', { reason, promise });
  process.exit(1);
});

if (require.main === module) {
  main();
}

export default QQBot;
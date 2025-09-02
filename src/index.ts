import { config } from './config';
import { logger } from './utils/logger';
import { DatabaseManager, getDatabaseManager } from './services/database';
import WebSocketClient from './services/websocket-client';
import HttpServer from './services/http-server';
import AIService from './services/ai-service';
import RemoteClaudeService from './services/remote-claude-service';
import { SessionManager } from './services/session-manager';
import { QQMessage, QQNotice, QQRequest, ConversationData, RequirementData } from './types';
import { v4 as uuidv4 } from 'uuid';

class QQBot {
  private database: DatabaseManager;
  private websocketClient: WebSocketClient;
  private httpServer: HttpServer;
  private aiService: AIService;
  private remoteClaudeService: RemoteClaudeService;
  private sessionManager: SessionManager;
  private moduleLogger = logger.createModuleLogger('main');
  
  // 群聊管理状态 - 使用数据库存储的设置
  private groupReplyEnabled: boolean = true;
  private allowedGroups: Set<number> = new Set();
  private groupSettingsCache: Map<number, boolean> = new Map(); // 群聊启用状态缓存

  constructor() {
    this.database = getDatabaseManager(config.database);
    this.websocketClient = new WebSocketClient(config.websocket);
    this.aiService = new AIService(config.ai, this.database);
    this.remoteClaudeService = new RemoteClaudeService(this.database);
    this.sessionManager = new SessionManager(this.database);
    this.httpServer = new HttpServer(config.http_server, {
      database: this.database,
      websocketClient: this.websocketClient
    });
  }

  public async start(): Promise<void> {
    try {
      this.moduleLogger.info('🚀 Starting QQ Bot...'); // Testing Claude PostToolUse hook

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
        'online',
        this.websocketClient.isConnected(),
        true
      );

      this.moduleLogger.info('🎉 QQ Bot started successfully!');

      // 发送启动成功通知给授权用户
      await this.sendStartupNotification();

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
      
      // 通知授权用户连接断开
      this.notifyConnectionStatus(false).catch(error => {
        this.moduleLogger.error('Failed to notify disconnection', { error });
      });
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
      const userMessage = typeof message.message === 'string' ? message.message.trim() : '';

      // 使用SessionManager处理消息
      const sessionContext = await this.sessionManager.processIncomingMessage(message);
      
      this.moduleLogger.info('Session processing result', {
        sessionId: sessionContext.session_id,
        sessionType: sessionContext.session_type,
        userId
      });

      // 处理群聊管理命令 (仅授权用户)
      if (this.aiService.isAuthorizedUser(userId)) {
        const handled = await this.handleGroupManagementCommand(userId, userMessage);
        if (handled) return;

        // 根据Session类型决策处理消息
        if (sessionContext.session_type === 'requirement' || 
            (sessionContext.session_type === 'chat' && userMessage.length > 100)) {
          // 分析是否为需求
          const intent = await this.aiService.analyzeIntent(userMessage, userId);
          
          if (intent.isRequirement && intent.confidence > 60) {
            await this.handleRequirement(userId, userMessage, intent, message, sessionContext.session_id);
            return;
          }
        }
      }

      // 普通AI对话 - 传递sessionId以保持会话连续性
      await this.handleAIConversation(userId, userMessage, message, sessionContext.session_id);

    } catch (error) {
      this.moduleLogger.error('Error handling private message', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        userId: message.user_id,
        messagePreview: typeof message.message === 'string' ? message.message.substring(0, 50) : JSON.stringify(message.message)?.substring(0, 50)
      });
      
      try {
        let errorMessage = '抱歉，处理您的消息时出现了错误，请稍后再试。';
        
        // 根据错误类型提供更具体的错误信息
        if (error instanceof Error) {
          if (error.message.includes('API keys')) {
            errorMessage = '系统配置问题：AI服务暂时不可用，请联系管理员。';
          } else if (error.message.includes('Database')) {
            errorMessage = '数据库连接异常，请稍后再试。';
          }
        }
        
        await this.websocketClient.sendPrivateMessage(message.user_id, errorMessage);
      } catch (sendError) {
        this.moduleLogger.error('Failed to send error message', { 
          sendError: sendError instanceof Error ? sendError.message : 'Unknown send error' 
        });
      }
    }
  }

  private async handleGroupMessage(message: QQMessage): Promise<void> {
    try {
      // 只处理@机器人的消息
      const botQQ = this.aiService.getBotQQNumber();
      const messageText = typeof message.message === 'string' ? message.message : '';
      const isAtBot = messageText.includes(`[CQ:at,qq=${botQQ}]`) || 
                      messageText.includes(`@${botQQ}`);

      if (!isAtBot || !this.groupReplyEnabled) {
        return;
      }

      // 检查群聊设置（从数据库）
      if (message.group_id && !(await this.isGroupEnabled(message.group_id))) {
        this.moduleLogger.debug('Group chat disabled or not configured', { group_id: message.group_id });
        return;
      }

      this.moduleLogger.info('Received group at message', {
        group_id: message.group_id,
        user_id: message.user_id,
        message: message.message
      });

      // 清理消息内容（移除@信息）
      const messageText2 = typeof message.message === 'string' ? message.message : '';
      const cleanMessage = messageText2
        .replace(/\[CQ:at,qq=\d+\]/g, '')
        .replace(/@\d+/g, '')
        .trim();

      if (!cleanMessage) {
        // 获取群聊设置中的欢迎消息
        const groupSetting = await this.database.getGroupChatSettingById(message.group_id!);
        const welcomeMessage = groupSetting?.welcome_message || '您好！我是智能助手，有什么可以帮助您的吗？';
        
        await this.websocketClient.sendGroupMessage(
          message.group_id!,
          welcomeMessage
        );
        return;
      }

      // 更新群聊活跃度
      if (message.group_id) {
        await this.database.updateGroupActivity(message.group_id, 1, 0);
      }

      // AI对话处理 - 群聊也可以有session支持
      const sessionContext = await this.sessionManager.processIncomingMessage(message);
      await this.handleAIConversation(message.user_id, cleanMessage, message, sessionContext.session_id);

    } catch (error) {
      this.moduleLogger.error('Error handling group message', { error, message });
    }
  }

  private async handleGroupManagementCommand(userId: number, message: string): Promise<boolean> {
    const commands = {
      '开启群聊': async () => {
        this.groupReplyEnabled = true;
        this.clearGroupSettingsCache(); // 清理缓存以刷新状态
        return '✅ 群聊AI回复已开启';
      },
      '关闭群聊': async () => {
        this.groupReplyEnabled = false;
        this.clearGroupSettingsCache(); // 清理缓存以刷新状态
        return '❌ 群聊AI回复已关闭';
      },
      '群聊列表': async () => {
        const groupSettings = await this.database.getGroupChatSettings();
        if (groupSettings.length === 0) {
          const legacyGroups = Array.from(this.allowedGroups);
          return legacyGroups.length > 0 
            ? `📋 当前允许的群聊(传统设置): ${legacyGroups.join(', ')}`
            : '📋 当前没有配置的群聊';
        }
        
        const enabledGroups = groupSettings.filter(g => g.is_enabled);
        return enabledGroups.length > 0 
          ? `📋 已启用的群聊: ${enabledGroups.map(g => `${g.group_id}(${g.group_name || '未命名'})`).join(', ')}`
          : '📋 当前没有启用的群聊';
      },
      '清空群聊': async () => {
        // 传统方式清空
        this.allowedGroups.clear();
        this.clearGroupSettingsCache();
        return '🗑️ 群聊设置缓存已清空（数据库设置保持不变）';
      }
    };

    // 检查基本命令
    if (message in commands) {
      const response = await commands[message as keyof typeof commands]();
      await this.websocketClient.sendPrivateMessage(userId, response);
      return true;
    }

    // 检查添加群聊命令 - 使用数据库存储
    const addGroupMatch = message.match(/^添加群聊\s+(\d+)(\s+(.+))?$/);
    if (addGroupMatch) {
      const groupId = parseInt(addGroupMatch[1]);
      const groupName = addGroupMatch[3] || undefined;
      
      const groupSettings = {
        group_id: groupId,
        group_name: groupName,
        is_enabled: true,
        auto_reply_enabled: true,
        admin_user_id: userId,
        created_at: new Date(),
        updated_at: new Date()
      };
      
      const success = await this.database.saveGroupChatSettings(groupSettings);
      if (success) {
        this.clearGroupSettingsCache();
        await this.websocketClient.sendPrivateMessage(
          userId,
          `✅ 已添加群聊 ${groupId}${groupName ? ` (${groupName})` : ''} 到数据库`
        );
      } else {
        await this.websocketClient.sendPrivateMessage(
          userId,
          `❌ 添加群聊 ${groupId} 失败，可能已存在`
        );
      }
      return true;
    }

    // 检查移除群聊命令 - 从数据库移除
    const removeGroupMatch = message.match(/^移除群聊\s+(\d+)$/);
    if (removeGroupMatch) {
      const groupId = parseInt(removeGroupMatch[1]);
      
      const success = await this.database.deleteGroupChatSettings(groupId);
      if (success) {
        this.clearGroupSettingsCache();
        await this.websocketClient.sendPrivateMessage(
          userId,
          `❌ 已从数据库移除群聊 ${groupId}`
        );
      } else {
        await this.websocketClient.sendPrivateMessage(
          userId,
          `⚠️ 群聊 ${groupId} 不存在或删除失败`
        );
      }
      return true;
    }

    return false;
  }

  /**
   * 检查群聊是否启用（从数据库检查）
   */
  private async isGroupEnabled(groupId: number): Promise<boolean> {
    try {
      // 检查缓存
      if (this.groupSettingsCache.has(groupId)) {
        return this.groupSettingsCache.get(groupId)!;
      }
      
      // 从数据库获取设置
      const groupSetting = await this.database.getGroupChatSettingById(groupId);
      const isEnabled = groupSetting ? groupSetting.is_enabled && groupSetting.auto_reply_enabled : false;
      
      // 缓存结果（避免频繁查询）
      this.groupSettingsCache.set(groupId, isEnabled);
      
      // 设置缓存过期时间（5分钟）
      setTimeout(() => {
        this.groupSettingsCache.delete(groupId);
      }, 5 * 60 * 1000);
      
      return isEnabled;
    } catch (error) {
      this.moduleLogger.error('Failed to check group enabled status', { error, groupId });
      // 发生错误时，默认启用（兼容旧设置）
      return this.allowedGroups.has(groupId) || this.allowedGroups.size === 0;
    }
  }

  /**
   * 清理群聊设置缓存
   */
  private clearGroupSettingsCache(): void {
    this.groupSettingsCache.clear();
    this.moduleLogger.debug('Group settings cache cleared');
  }

  private async handleRequirement(
    userId: number,
    message: string,
    intent: any,
    originalMessage: QQMessage,
    sessionId?: string
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
        status: 'received',
        created_at: new Date(),
        updated_at: new Date(),
        session_id: sessionId  // 关联Session ID
      };

      await this.database.saveRequirement(requirementData);

      // 发送确认消息
      let responseMessage = `🔧 已识别为开发需求 (${intent.category}, ${intent.complexity})\n`;
      responseMessage += `📋 需求ID: ${requirementId}\n`;
      responseMessage += `⏳ 正在处理中...`;

      if (intent.complexity === '复杂') {
        responseMessage += '\n\n💡 检测到复杂需求，将启用标准化TDD/BDD多Agent协作模式进行处理。';
      }

      // 发送确认消息 - 如果是回复链的一部分，使用回复功能
      const shouldSendReply = sessionId && originalMessage.message_id && 
                             (sessionId.includes('reply') || sessionId.includes('chain'));

      if (shouldSendReply && originalMessage.message_id) {
        await this.websocketClient.sendReplyMessage(originalMessage.message_id, responseMessage);
      } else {
        await this.websocketClient.sendPrivateMessage(userId, responseMessage);
      }

      // 异步处理需求 - 使用Remote Claude Service
      this.processRequirementAsync(requirementData, userId).catch(error => {
        this.moduleLogger.error('Async requirement processing failed', { 
          error, 
          requirementId 
        });
      });

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

  /**
   * 异步处理需求逻辑
   */
  private async processRequirementAsync(
    requirementData: RequirementData,
    userId: number
  ): Promise<void> {
    const { id: requirementId, message } = requirementData;
    
    try {
      // 检查Remote Claude会话状态
      const sessionExists = await this.remoteClaudeService.checkRemoteSession();
      if (!sessionExists) {
        await this.websocketClient.sendPrivateMessage(
          userId,
          `❌ 需求 ${requirementId} 处理失败\n\n错误：Claude Code远程会话未启动\n请联系管理员运行：./scripts/setup_remote_claude.sh`
        );
        return;
      }

      // 发送开始处理通知
      await this.websocketClient.sendPrivateMessage(
        userId,
        `🚀 需求 ${requirementId} 开始处理\n💡 正在通过Claude Code进行自动化开发...`
      );

      // 实际处理需求
      await this.remoteClaudeService.processRequirement(requirementData);

      // 获取处理结果
      const result = await this.database.getRequirementById(requirementId);
      
      if (result && result.status === 'completed') {
        let successMessage = `✅ 需求 ${requirementId} 处理完成！\n\n`;
        
        if (result.claude_code_output && result.claude_code_output.length > 0) {
          const output = result.claude_code_output.substring(0, 800);
          successMessage += `📝 处理结果摘要:\n${output}`;
          
          if (result.claude_code_output.length > 800) {
            successMessage += '\n\n...(输出较长，完整日志请查看系统记录)';
          }
        }
        
        successMessage += `\n\n🕒 处理时间: ${this.formatProcessingTime(result.processing_start_time, result.processing_end_time)}`;
        
        await this.websocketClient.sendPrivateMessage(userId, successMessage);
      } else if (result && result.status === 'failed') {
        const errorMessage = `❌ 需求 ${requirementId} 处理失败\n\n错误信息: ${result.error_message || '未知错误'}`;
        await this.websocketClient.sendPrivateMessage(userId, errorMessage);
      }

    } catch (error) {
      this.moduleLogger.error('Failed to process requirement async', { 
        error, 
        requirementId, 
        userId 
      });

      await this.websocketClient.sendPrivateMessage(
        userId,
        `❌ 需求 ${requirementId} 处理异常\n\n错误: ${error instanceof Error ? error.message : '未知错误'}`
      );
    }
  }

  /**
   * 格式化处理时间
   */
  private formatProcessingTime(startTime?: Date, endTime?: Date): string {
    if (!startTime || !endTime) return '未知';
    
    const duration = endTime.getTime() - startTime.getTime();
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    
    if (minutes > 0) {
      return `${minutes}分${seconds % 60}秒`;
    } else {
      return `${seconds}秒`;
    }
  }

  private async handleAIConversation(
    userId: number,
    message: string,
    originalMessage: QQMessage,
    sessionId?: string
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // 生成AI响应
      const conversation = await this.aiService.generateResponse(message, userId);
      const responseTime = Date.now() - startTime;

      // 更新响应时间和Session关联
      conversation.response_time = responseTime;
      conversation.message_id = originalMessage.message_id;
      conversation.session_id = sessionId;  // 关联Session ID

      // 保存对话到数据库
      await this.database.saveConversation(conversation);

      // 发送响应 - 如果有session上下文且是回复链的一部分，使用回复功能
      const shouldSendReply = sessionId && originalMessage.message_id && 
                             (sessionId.includes('reply') || sessionId.includes('chain'));

      if (originalMessage.message_type === 'group' && originalMessage.group_id) {
        // 更新群聊AI回复活跃度
        await this.database.updateGroupActivity(originalMessage.group_id, 0, 1);
        
        if (shouldSendReply && originalMessage.message_id) {
          await this.websocketClient.sendReplyMessage(
            originalMessage.message_id,
            conversation.ai_response
          );
        } else {
          await this.websocketClient.sendGroupMessage(
            originalMessage.group_id,
            conversation.ai_response
          );
        }
      } else {
        if (shouldSendReply && originalMessage.message_id) {
          await this.websocketClient.sendReplyMessage(
            originalMessage.message_id,
            conversation.ai_response
          );
        } else {
          await this.websocketClient.sendPrivateMessage(
            userId,
            conversation.ai_response
          );
        }
      }

      this.moduleLogger.info('AI conversation completed', {
        conversationId: conversation.id,
        userId,
        responseTime,
        isGroupMessage: originalMessage.message_type === 'group'
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

  private async sendStartupNotification(): Promise<void> {
    try {
      // 等待一小段时间，确保WebSocket连接完全稳定
      await new Promise(resolve => setTimeout(resolve, 1000));

      const authorizedUserId = config.ai.authorized_user_id;

      const startupMessage = `🎉 QQ智能机器人启动成功！

📊 系统状态:
✅ 数据库连接: 正常
✅ WebSocket连接: 正常  
✅ HTTP服务器: 正常
✅ AI服务: 正常

🤖 机器人信息:
• QQ号: ${config.ai.bot_qq_number}
• AI模型: ${(await this.aiService.getModelInfo()).name}
• 启动时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}

💡 功能说明:
• 智能对话: 直接发送消息进行对话
• 需求管理: 描述开发需求，机器人会智能识别并处理
• 群聊管理: 支持群聊AI回复功能

您现在可以开始与我对话了！`;

      await this.websocketClient.sendPrivateMessage(authorizedUserId, startupMessage);
      
      this.moduleLogger.info('Startup notification sent to authorized user', { 
        userId: authorizedUserId 
      });

    } catch (error) {
      this.moduleLogger.error('Failed to send startup notification', { error });
      // 启动通知失败不应该阻止整个启动过程，所以这里只记录错误
    }
  }

  private async notifyConnectionStatus(connected: boolean): Promise<void> {
    try {
      const authorizedUserId = config.ai.authorized_user_id;
      const statusMessage = connected 
        ? '🔗 机器人重新连接成功，服务已恢复！' 
        : '⚠️ 机器人连接断开，正在尝试重连...';

      await this.websocketClient.sendPrivateMessage(authorizedUserId, statusMessage);
      
      this.moduleLogger.info('Connection status notification sent', { 
        userId: authorizedUserId,
        connected 
      });

    } catch (error) {
      this.moduleLogger.error('Failed to send connection status notification', { error });
    }
  }

  public async stop(): Promise<void> {
    try {
      this.moduleLogger.info('🛑 Stopping QQ Bot...');

      // 更新机器人状态
      await this.database.updateBotStatus(
        config.ai.bot_qq_number.toString(),
        'offline',
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
  logger.error('main', 'Unhandled Rejection', { 
    reason: reason instanceof Error ? {
      message: reason.message,
      stack: reason.stack,
      name: reason.name
    } : reason,
    promise: promise.constructor.name
  });
  // Don't exit process immediately to allow debugging
  console.error('Unhandled Promise Rejection:', reason);
});

if (require.main === module) {
  main();
}

export default QQBot;
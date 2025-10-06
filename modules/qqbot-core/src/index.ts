import { config } from './config';
import { logger } from './utils/logger';
import { DatabaseManager, getDatabaseManager } from './services/database';
import WebSocketClient from './services/websocket-client';
import HttpServer from './services/http-server';
import AIService from './services/ai-service';
import { SessionManager } from './services/session-manager';
import { LoggingService } from './services/logging-service';
import { ContextManager } from './services/context-manager';
import { DebugService } from './services/debug-service';
import MessageQueueService, { DrainedMessage } from './services/message-queue-service';
import DirectNotifier, { BatchHandler, TriggerType } from './services/direct-notifier';
import ScheduleDispatcher from './services/schedule-dispatcher';
import DecisionEngine from './engines/decision-engine';
import ContextEngine from './engines/context-engine';
// 🛠️ LLM 工具系统组件
import { ToolRegistryService } from './services/tool-registry-service';
import { FunctionCallDispatcher } from './services/function-call-dispatcher';
import { LLMJobWorker } from './services/llm-job-worker';
import { STATIC_TOOLS } from './tools/static-tools';
import {
  QQMessage,
  QQNotice,
  QQRequest,
  ConversationData,
  MessageContext,
  DecisionResult,
  GroupChatSettings,
  PrivateChatSettings,
  UnifiedLLMConfig
} from './types';
import { v4 as uuidv4 } from 'uuid';

class QQBot implements BatchHandler {
  private database: DatabaseManager;
  private websocketClient: WebSocketClient;
  private httpServer: HttpServer;
  private aiService: AIService;
  private sessionManager: SessionManager;
  private loggingService: LoggingService;
  private contextManager: ContextManager;
  private debugService: DebugService;

  // Stage 1 Engines
  private decisionEngine: DecisionEngine;
  private contextEngine: ContextEngine;

  // Human-like Processing Components
  private messageQueueService: MessageQueueService;
  private directNotifier: DirectNotifier;
  private scheduleDispatcher: ScheduleDispatcher;
  private enableHumanLikeProcessing: boolean;

  // 🛠️ LLM 工具系统组件
  private toolRegistryService: ToolRegistryService;
  private functionCallDispatcher: FunctionCallDispatcher;
  private llmJobWorker: LLMJobWorker;
  private enableLLMTools: boolean;

  private moduleLogger = logger.createModuleLogger('main');

  // 群聊管理状态 - 使用数据库存储的设置
  private groupReplyEnabled: boolean = true;
  private allowedGroups: Set<number> = new Set();
  private groupSettingsCache: Map<number, boolean> = new Map(); // 群聊启用状态缓存
  private readonly defaultChatPromptCandidates: string[] = ['echance_chat', 'enhanced_chat', 'default_chat'];

  constructor() {
    this.database = getDatabaseManager(config.database);
    this.loggingService = new LoggingService(this.database);
    this.websocketClient = new WebSocketClient(config.websocket, this.loggingService);
    this.aiService = new AIService(config.ai, this.database, this.loggingService);
    this.sessionManager = new SessionManager(this.database);
    this.contextManager = new ContextManager(this.database);
    this.debugService = new DebugService(this.database);

    // Initialize Stage 1 Engines
    this.contextEngine = new ContextEngine(this.database);
    this.decisionEngine = new DecisionEngine(this.aiService, config.ai);

    // Initialize Human-like Processing
    this.enableHumanLikeProcessing = process.env.ENABLE_HUMAN_LIKE_PROCESSING === 'true';
    this.messageQueueService = new MessageQueueService(
      config.ai.authorized_user_id,
      config.ai.bot_qq_number
    );
    this.directNotifier = new DirectNotifier(this); // Pass self as BatchHandler
    this.scheduleDispatcher = new ScheduleDispatcher(this.messageQueueService, this);

    // 监听消息入队事件，触发调度
    this.messageQueueService.on('message_queued', ({ sourceKey, priority }) => {
      if (this.enableHumanLikeProcessing) {
        // 拟人化模式：调度处理
        this.scheduleDispatcher.schedule(sourceKey, priority).catch(error => {
          this.moduleLogger.error('Failed to schedule message', {
            error: error instanceof Error ? error.message : 'Unknown error',
            sourceKey,
            priority
          });
        });
      }
      // 直连模式已在 handlePrivateMessage/handleGroupMessage 中处理
    });

    // 🛠️ Initialize LLM Tools System
    this.enableLLMTools = process.env.ENABLE_LLM_TOOLS === 'true';
    this.toolRegistryService = new ToolRegistryService(this.database);
    this.functionCallDispatcher = new FunctionCallDispatcher(this.toolRegistryService);

    // 注册静态工具
    this.functionCallDispatcher.registerStaticTools(STATIC_TOOLS);

    // 初始化 LLMJobWorker
    this.llmJobWorker = new LLMJobWorker(
      this.database,
      this.functionCallDispatcher,
      this.aiService,
      {
        maxConcurrentJobs: parseInt(process.env.LLM_MAX_CONCURRENT_JOBS || '5'),
        pollIntervalMs: parseInt(process.env.LLM_POLL_INTERVAL_MS || '1000'),
        jobTimeoutMs: parseInt(process.env.LLM_JOB_TIMEOUT_MS || '300000'),
        retryDelayMs: parseInt(process.env.LLM_RETRY_DELAY_MS || '5000')
      }
    );

    // 🛠️ 监听 LLMJobWorker 事件
    this.llmJobWorker.on('job_completed', async (event: {
      jobId: string;
      traceId: string;
      finalResponse: string;
      metadata?: any;
    }) => {
      try {
        const { metadata, finalResponse } = event;

        if (!metadata || !finalResponse) {
          this.moduleLogger.warn('Job completed but missing metadata or response', { jobId: event.jobId });
          return;
        }

        const {
          userId,
          groupId,
          messageId,
          messageType,
          conversationId,
          modelName: jobModelName
        } = metadata;

        // 更新 conversation 状态为完成
        if (conversationId) {
          await this.database.updateConversationStatus(
            conversationId,
            'completed',
            undefined,
            finalResponse,
            0, // responseTime will be calculated by database
            jobModelName || 'gemini-2.5-flash'
          );
        }

        // 发送响应给用户
        if (messageType === 'group' && groupId) {
          // 检查群聊自动回复开关
          const groupSettings = await this.database.getGroupChatSettingById(groupId);
          if (groupSettings && !groupSettings.auto_reply_enabled) {
            this.moduleLogger.debug('Group auto reply disabled, skip sending response', { groupId });
            return;
          }

          await this.database.updateGroupActivity(groupId, 0, 1);
          await this.websocketClient.sendGroupMessage(groupId, finalResponse);
        } else if (messageType === 'private' && userId) {
          // 检查私聊自动回复开关
          const privateChatSettings = await this.database.getPrivateChatSettingById(userId);
          if (privateChatSettings && !privateChatSettings.auto_reply_enabled) {
            this.moduleLogger.debug('Private auto reply disabled, skip sending response', { userId });
            return;
          }

          await this.websocketClient.sendPrivateMessage(userId, finalResponse);
        }

        this.moduleLogger.info('LLM Job response sent', {
          jobId: event.jobId,
          messageType,
          userId,
          groupId,
          conversationId,
          modelName: jobModelName || 'unknown'
        });
      } catch (error) {
        const normalizedError =
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : { message: String(error) };

        this.moduleLogger.error('Failed to send LLM Job response', {
          error: normalizedError,
          event
        });
      }
    });

    this.llmJobWorker.on('job_failed', async (event: {
      jobId: string;
      traceId: string;
      error: string;
      metadata?: any;
    }) => {
      try {
        this.moduleLogger.error('LLM Job failed', event);

        // 更新 conversation 状态为失败
        if (event.metadata?.conversationId) {
          await this.database.updateConversationStatus(
            event.metadata.conversationId,
            'failed',
            `LLM Job failed: ${event.error}`
          );
        }

        // 可选：发送错误通知给用户（暂时不实现）
      } catch (error) {
        this.moduleLogger.error('Failed to handle job_failed event', { error, event });
      }
    });

    this.httpServer = new HttpServer(config.http_server, {
      database: this.database,
      websocketClient: this.websocketClient,
      debugService: this.debugService,
      qqBot: this, // Pass QQBot instance for test endpoints
      aiService: this.aiService,
      messageQueueService: this.messageQueueService
    });

    // Clear group settings cache to pick up any recent database changes
    this.groupSettingsCache.clear();

    this.moduleLogger.info('QQBot initialized', {
      enableHumanLikeProcessing: this.enableHumanLikeProcessing
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

      // 启动调度器（如果启用拟人化处理）
      if (this.enableHumanLikeProcessing) {
        this.scheduleDispatcher.start();
        this.moduleLogger.info('✅ ScheduleDispatcher started (human-like mode)');
      } else {
        this.moduleLogger.info('ℹ️ DirectNotifier mode (low latency)');
      }

      // 🛠️ 启动 LLM Job Worker (如果启用工具系统)
      if (this.enableLLMTools) {
        this.llmJobWorker.start();
        this.moduleLogger.info('✅ LLMJobWorker started (tools enabled)', {
          maxConcurrentJobs: this.llmJobWorker.getStats().maxConcurrentJobs
        });
      }

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

  /**
   * BatchHandler 接口实现 - 批量处理私聊消息
   * 从队列 drain 后批量处理消息
   */
  public async handlePrivateMessageBatch(sourceKey: string, messages: DrainedMessage[], triggerType: TriggerType): Promise<void> {
    // 生成批次ID
    const batchId = uuidv4();
    const startTime = new Date();
    const sourceType = sourceKey.startsWith('user_') ? 'private' : 'group';
    const traceIds = messages.map(m => m.traceId);
    const messageIds = messages.map(m => m.id);

    this.moduleLogger.info('Processing private message batch', {
      batchId,
      sourceKey,
      messageCount: messages.length,
      triggerType,
      traceIds
    });

    // 记录批次开始
    try {
      await this.database.createConversationBatchRecord({
        id: batchId,
        sourceKey,
        sourceType,
        triggerType,
        messageCount: messages.length,
        startTime,
        metadata: {
          traceIds,
          messageIds,
          triggerType
        }
      });

      await this.database.createMessageConsumptionRecord({
        id: batchId,
        sourceKey,
        batchSize: messages.length,
        triggerReason: triggerType,
        traceId: traceIds[0],
        startedAt: startTime
      });
    } catch (error) {
      this.moduleLogger.error('Failed to log private message batch start', {
        error: error instanceof Error ? error.message : 'Unknown error',
        batchId,
        sourceKey
      });
    }

    try {
      // 遍历处理每条消息，传递 batchId
      for (const drained of messages) {
        await this._processSinglePrivateMessage(
          drained.message as QQMessage,
          drained.eventData,
          drained.traceId,
          batchId
        );
      }

      const processingTime = Date.now() - startTime.getTime();

      this.moduleLogger.info('Private message batch completed', {
        batchId,
        sourceKey,
        messageCount: messages.length,
        processingTime,
        status: 'completed'
      });

      await this.database.updateConversationBatchRecord({
        id: batchId,
        status: 'completed',
        endTime: new Date(),
        processingTimeMs: processingTime
      });

      await this.database.updateMessageConsumptionRecord({
        id: batchId,
        status: 'completed',
        processingDurationMs: processingTime
      });

    } catch (error) {
      const processingTime = Date.now() - startTime.getTime();

      this.moduleLogger.error('Private message batch failed', {
        batchId,
        sourceKey,
        error: error instanceof Error ? error.message : 'Unknown error',
        messageCount: messages.length,
        processingTime,
        status: 'failed'
      });

      await this.database.updateConversationBatchRecord({
        id: batchId,
        status: 'failed',
        endTime: new Date(),
        processingTimeMs: processingTime,
        errorMessage: error instanceof Error ? error.message : String(error)
      });

      await this.database.updateMessageConsumptionRecord({
        id: batchId,
        status: 'failed',
        processingDurationMs: processingTime,
        errorMessage: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }

  /**
   * BatchHandler 接口实现 - 批量处理群聊消息
   */
  public async handleGroupMessageBatch(sourceKey: string, messages: DrainedMessage[], triggerType: TriggerType): Promise<void> {
    // 生成批次ID
    const batchId = uuidv4();
    const startTime = new Date();
    const sourceType = sourceKey.startsWith('user_') ? 'private' : 'group';
    const traceIds = messages.map(m => m.traceId);
    const messageIds = messages.map(m => m.id);

    this.moduleLogger.info('Processing group message batch', {
      batchId,
      sourceKey,
      messageCount: messages.length,
      triggerType,
      traceIds
    });

    try {
      await this.database.createConversationBatchRecord({
        id: batchId,
        sourceKey,
        sourceType,
        triggerType,
        messageCount: messages.length,
        startTime,
        metadata: {
          traceIds,
          messageIds,
          triggerType
        }
      });

      await this.database.createMessageConsumptionRecord({
        id: batchId,
        sourceKey,
        batchSize: messages.length,
        triggerReason: triggerType,
        traceId: traceIds[0],
        startedAt: startTime
      });
    } catch (error) {
      this.moduleLogger.error('Failed to log group message batch start', {
        error: error instanceof Error ? error.message : 'Unknown error',
        batchId,
        sourceKey
      });
    }

    try {
      // 遍历处理每条消息，传递 batchId
      for (const drained of messages) {
        await this._processSingleGroupMessage(
          drained.message as QQMessage,
          drained.eventData,
          drained.traceId,
          batchId
        );
      }

      const processingTime = Date.now() - startTime.getTime();

      this.moduleLogger.info('Group message batch completed', {
        batchId,
        sourceKey,
        messageCount: messages.length,
        processingTime,
        status: 'completed'
      });

      await this.database.updateConversationBatchRecord({
        id: batchId,
        status: 'completed',
        endTime: new Date(),
        processingTimeMs: processingTime
      });

      await this.database.updateMessageConsumptionRecord({
        id: batchId,
        status: 'completed',
        processingDurationMs: processingTime
      });

    } catch (error) {
      const processingTime = Date.now() - startTime.getTime();

      this.moduleLogger.error('Group message batch failed', {
        batchId,
        sourceKey,
        error: error instanceof Error ? error.message : 'Unknown error',
        messageCount: messages.length,
        processingTime,
        status: 'failed'
      });

      await this.database.updateConversationBatchRecord({
        id: batchId,
        status: 'failed',
        endTime: new Date(),
        processingTimeMs: processingTime,
        errorMessage: error instanceof Error ? error.message : String(error)
      });

      await this.database.updateMessageConsumptionRecord({
        id: batchId,
        status: 'failed',
        processingDurationMs: processingTime,
        errorMessage: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }

  /**
   * 处理单条私聊消息（核心逻辑）
   */
  private async _processSinglePrivateMessage(message: QQMessage, eventData?: any, traceId?: string, batchId?: string): Promise<void> {
    const conversationId = uuidv4();

    try {
      this.moduleLogger.info('Processing single private message', {
        traceId,
        conversationId,
        user_id: message.user_id,
        message: message.message
      });

      const userId = message.user_id;
      const userMessage = typeof message.message === 'string' ? message.message.trim() : '';

      // 🔥 FIX: 立即创建conversation记录 - 改进后的架构 (移到过滤检查之前)
      const initialConversation: ConversationData = {
        id: conversationId,
        trace_id: traceId,
        user_id: userId,
        user_message: userMessage,
        timestamp: new Date(),
        response_time: 0,
        raw_request: JSON.stringify(message), // 保存完整的WebSocket消息数据
        status: 'pending', // 初始状态为pending
        batch_id: batchId, // 关联批次ID
        created_at: new Date(),
        updated_at: new Date()
      };

      await this.database.saveConversation(initialConversation);
      this.moduleLogger.info('Initial conversation record created', { conversationId, batchId, status: 'pending' });

      // 检查私聊设置（2层过滤控制 - private_chat_settings表没有receive_events字段）
      const privateChatSettings = await this.database.getPrivateChatSettingById(userId);

      // 第1层：检查是否启用LLM处理（is_enabled）
      if (privateChatSettings && privateChatSettings.is_enabled === false) {
        this.moduleLogger.debug('Private chat LLM processing disabled', { user_id: userId });

        // 🔥 FIX: Update conversation status for traceability instead of early return
        await this.database.updateConversationStatus(conversationId, 'filtered_disabled', 'Private chat LLM processing disabled');
        this.moduleLogger.info('Conversation updated for filtered private message', {
          conversationId,
          reason: 'llm_processing_disabled',
          traceId
        });

        return; // 不调用LLM处理
      }

      // 记录通过检查
      this.moduleLogger.debug('Private chat passed initial checks', {
        user_id: userId,
        is_enabled: privateChatSettings?.is_enabled ?? true,
        auto_reply_enabled: privateChatSettings?.auto_reply_enabled ?? true
      });

      this.moduleLogger.info('DEBUG: About to call buildMessageContext', {
        userId,
        messageType: message.message_type,
        hasContextManager: !!this.contextManager,
        conversationId
      });

      // 更新状态为processing
      await this.database.updateConversationStatus(conversationId, 'processing');

      // 构建消息上下文（前20条消息）
      const messageContext = await this.contextManager.buildMessageContext(message, 20);

      this.moduleLogger.info('DEBUG: buildMessageContext completed', { userId });

      this.moduleLogger.info('Message context built', {
        traceId,
        historyCount: messageContext.historyMessages.length,
        hasUserInfo: !!messageContext.userInfo,
        userId
      });

      // Stage 1: Use DecisionEngine for intelligent response decision
      const decision = await this.decisionEngine.analyzeMessage(messageContext, traceId);

      this.moduleLogger.info('Decision engine result', {
        shouldRespond: decision.shouldRespond,
        confidence: decision.confidence,
        reason: decision.reason,
        suggestedService: decision.suggestedService,
        userId
      });

      // If decision engine says don't respond, update conversation status and exit
      if (!decision.shouldRespond) {
        this.moduleLogger.info('Decision engine determined not to respond', {
          userId,
          reason: decision.reason
        });

        // 🔥 FIX: Update conversation status for traceability
        await this.database.updateConversationStatus(
          conversationId,
          'filtered_no_response',
          `Decision engine: ${decision.reason}`
        );

        return;
      }

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
      }

      // Stage 1: Enhanced AI conversation pipeline
      await this.handleEnhancedAIConversation(
        userId,
        userMessage,
        message,
        messageContext,
        sessionContext.session_id,
        traceId,
        conversationId // 传递已创建的conversationId
      );

    } catch (error) {
      this.moduleLogger.error('Error processing private message', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        userId: message.user_id,
        conversationId,
        messagePreview: typeof message.message === 'string' ? message.message.substring(0, 50) : JSON.stringify(message.message)?.substring(0, 50)
      });

      // 更新conversation状态为失败
      await this.database.updateConversationStatus(
        conversationId,
        'failed',
        `Processing error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * 处理单条群聊消息（核心逻辑）
   */
  private async _processSingleGroupMessage(message: QQMessage, eventData?: any, traceId?: string, batchId?: string): Promise<void> {
    const conversationId = uuidv4();

    try {
      this.moduleLogger.info('Processing single group message', {
        traceId,
        conversationId,
        group_id: message.group_id,
        user_id: message.user_id,
        message: typeof message.message === 'string' ? message.message.substring(0, 100) : JSON.stringify(message.message).substring(0, 100)
      });

      // 只处理@机器人的消息
      const botQQ = this.aiService.getBotQQNumber();

      // 检测@机器人：同时支持消息段数组格式和字符串CQ码格式
      let isAtBot = false;

      if (Array.isArray(message.message)) {
        isAtBot = message.message.some((segment: any) =>
          segment.type === 'at' && segment.data?.qq === botQQ.toString()
        );
      } else if (typeof message.message === 'string') {
        // 字符串CQ码格式检测
        const atPattern = new RegExp(`\\[CQ:at,qq=${botQQ}\\]`);
        isAtBot = atPattern.test(message.message);
      }

      this.moduleLogger.info('AT检测:', {
        isAtBot,
        groupReplyEnabled: this.groupReplyEnabled,
        botQQ
      });

      // Stage 1: Only skip if group reply is completely disabled
      if (!this.groupReplyEnabled) {
        this.moduleLogger.info('❌ Skipping group message: Group reply disabled', {
          isAtBot,
          groupReplyEnabled: this.groupReplyEnabled
        });
        return;
      }

      // 检查群聊设置（3层过滤控制）
      if (message.group_id) {
        const groupSettings = await this.database.getGroupChatSettingById(message.group_id);

        // 第1层：检查是否接收事件（receive_events）
        if (groupSettings && !groupSettings.receive_events) {
          this.moduleLogger.debug('Group chat events disabled', { group_id: message.group_id });

          // 🔥 FIX: Save filtered conversation record for traceability
          const filteredConversation: ConversationData = {
            id: conversationId,
            trace_id: traceId,
            user_id: message.user_id,
            user_message: typeof message.message === 'string' ? message.message : JSON.stringify(message.message),
            timestamp: new Date(),
            response_time: 0,
            raw_request: JSON.stringify(message),
            status: 'filtered_receive_events',
            error_reason: 'Group chat receive_events disabled',
            group_id: message.group_id,
            created_at: new Date(),
            updated_at: new Date()
          };

          await this.database.saveConversation(filteredConversation);
          this.moduleLogger.info('Filtered conversation saved for traceability', {
            conversationId,
            reason: 'receive_events_disabled',
            traceId
          });

          return; // 直接忽略，不做任何处理
        }

        // 第2层：检查是否启用LLM处理（is_enabled）
        if (groupSettings && !groupSettings.is_enabled) {
          this.moduleLogger.debug('Group chat LLM processing disabled', { group_id: message.group_id });

          // 🔥 FIX: Save filtered conversation record for traceability
          const filteredConversation: ConversationData = {
            id: conversationId,
            trace_id: traceId,
            user_id: message.user_id,
            user_message: typeof message.message === 'string' ? message.message : JSON.stringify(message.message),
            timestamp: new Date(),
            response_time: 0,
            raw_request: JSON.stringify(message),
            status: 'filtered_disabled',
            error_reason: 'Group chat LLM processing disabled',
            group_id: message.group_id,
            created_at: new Date(),
            updated_at: new Date()
          };

          await this.database.saveConversation(filteredConversation);
          this.moduleLogger.info('Filtered conversation saved for traceability', {
            conversationId,
            reason: 'llm_processing_disabled',
            traceId
          });

          return; // 不调用LLM处理
        }

        // 记录通过前两层检查
        this.moduleLogger.debug('Group chat passed initial checks', {
          group_id: message.group_id,
          receive_events: groupSettings?.receive_events ?? true,
          is_enabled: groupSettings?.is_enabled ?? true
        });
      }

      this.moduleLogger.info('Received group at message', {
        group_id: message.group_id,
        user_id: message.user_id,
        message: message.message
      });

      // 清理消息内容（移除@信息）
      let cleanMessage = '';

      if (typeof message.message === 'string') {
        // 字符串格式：移除CQ码和@信息
        cleanMessage = message.message
          .replace(/\[CQ:at,qq=\d+\]/g, '')
          .replace(/@\d+/g, '')
          .trim();
      } else if (Array.isArray(message.message)) {
        // 消息段数组格式：提取文本内容，跳过at段
        cleanMessage = message.message
          .filter((segment: any) => segment.type === 'text')
          .map((segment: any) => segment.data?.text || '')
          .join('')
          .trim();
      }

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

      // 构建群聊消息上下文（前20条消息）
      const messageWithCleanContent = { ...message, message: cleanMessage };
      const messageContext = await this.contextManager.buildMessageContext(messageWithCleanContent, 20);

      this.moduleLogger.info('Group message context built', {
        traceId,
        historyCount: messageContext.historyMessages.length,
        hasGroupInfo: !!messageContext.groupInfo,
        groupId: message.group_id
      });

      // 🔥 FIX: Create conversation record for group messages early for traceability
      const groupConversation: ConversationData = {
        id: conversationId,
        trace_id: traceId,
        user_id: message.user_id,
        group_id: message.group_id,
        user_message: cleanMessage,
        timestamp: new Date(),
        response_time: 0,
        raw_request: JSON.stringify(message),
        status: 'pending',
        batch_id: batchId, // 关联批次ID
        created_at: new Date(),
        updated_at: new Date()
      };

      await this.database.saveConversation(groupConversation);
      this.moduleLogger.info('Group conversation record created', { conversationId, batchId, groupId: message.group_id, traceId });

      // Stage 1: Use DecisionEngine for group message decisions
      const decision = await this.decisionEngine.analyzeMessage(messageContext, traceId);

      this.moduleLogger.info('Group message decision engine result', {
        shouldRespond: decision.shouldRespond,
        confidence: decision.confidence,
        reason: decision.reason,
        groupId: message.group_id,
        userId: message.user_id
      });

      // If decision engine says don't respond, update conversation status and exit
      if (!decision.shouldRespond) {
        this.moduleLogger.info('Decision engine determined not to respond to group message', {
          groupId: message.group_id,
          userId: message.user_id,
          reason: decision.reason
        });

        // 🔥 FIX: Update conversation status for traceability
        await this.database.updateConversationStatus(
          conversationId,
          'filtered_no_response',
          `Decision engine: ${decision.reason}`
        );

        return;
      }

      // 更新群聊活跃度
      if (message.group_id) {
        await this.database.updateGroupActivity(message.group_id, 1, 0);
      }

      // Update conversation status to processing
      await this.database.updateConversationStatus(conversationId, 'processing');

      // Stage 1: Enhanced AI conversation for group messages
      const sessionContext = await this.sessionManager.processIncomingMessage(message);
      await this.handleEnhancedAIConversation(
        message.user_id,
        cleanMessage,
        messageWithCleanContent,
        messageContext,
        sessionContext.session_id,
        traceId,
        conversationId // 🔥 FIX: Pass conversationId for error handling
      );

    } catch (error) {
      this.moduleLogger.error('Error processing group message', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        groupId: message.group_id,
        userId: message.user_id,
        conversationId,
        messagePreview: typeof message.message === 'string' ? message.message.substring(0, 50) : JSON.stringify(message.message)?.substring(0, 50)
      });

      // 更新conversation状态为失败
      await this.database.updateConversationStatus(
        conversationId,
        'failed',
        `Processing error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handlePrivateMessage(message: QQMessage, eventData?: any): Promise<void> {
    const traceId = eventData?.traceId || `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // 入队消息
    await this.messageQueueService.enqueue(message, { ...eventData, traceId });

    // 如果不启用人类化处理，立即触发 DirectNotifier
    if (!this.enableHumanLikeProcessing) {
      const sourceKey = `user_${message.user_id}`;
      const messages = await this.messageQueueService.drain(sourceKey);
      await this.directNotifier.notify(sourceKey, messages);
    }
    // 否则等待调度器触发
  }

  private async handleGroupMessage(message: QQMessage, eventData?: any): Promise<void> {
    const traceId = eventData?.traceId || `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // 入队消息
    await this.messageQueueService.enqueue(message, { ...eventData, traceId });

    // 如果不启用人类化处理，立即触发 DirectNotifier
    if (!this.enableHumanLikeProcessing) {
      const sourceKey = `group_${message.group_id}`;
      const messages = await this.messageQueueService.drain(sourceKey);
      await this.directNotifier.notify(sourceKey, messages);
    }
    // 否则等待调度器触发
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
        receive_events: true,
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
      
      // FIX: Default to enabled for groups without database entries
      // This allows new groups to work immediately without manual configuration
      const isEnabled = groupSetting ? (groupSetting.is_enabled && groupSetting.auto_reply_enabled) : true;
      
      this.moduleLogger.info('Group enablement check', {
        groupId,
        hasDbEntry: !!groupSetting,
        isEnabled,
        settingDetails: groupSetting ? {
          is_enabled: groupSetting.is_enabled,
          auto_reply_enabled: groupSetting.auto_reply_enabled
        } : null
      });
      
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

  /**
   * Build comprehensive message context using ContextManager
   */
  private async buildMessageContext(message: QQMessage, traceId?: string): Promise<MessageContext> {
    try {
      // Use new ContextManager to get the full 20-message history
      return await this.contextManager.buildMessageContext(message, 20);
    } catch (contextError) {
      this.moduleLogger.warn('ContextManager failed, building minimal context', { 
        error: contextError instanceof Error ? contextError.message : 'Unknown error' 
      });
      
      // Build minimal context manually
      return {
        currentMessage: message,
        historyMessages: [],
        contextSummary: '新对话开始',
        userInfo: {
          user_id: message.user_id,
          nickname: message.sender.nickname,
          message_count: 0
        },
        groupInfo: message.group_id ? {
          group_id: message.group_id,
          message_count: 0
        } : undefined
      };
    }
  }

  private async resolvePromptConfiguration(
    message: QQMessage,
    userId: number
  ): Promise<{
    config: UnifiedLLMConfig;
    agentType: string;
    promptName: string;
    promptId?: string;
    groupSettings?: GroupChatSettings | null;
    privateSettings?: PrivateChatSettings | null;
  }> {
    let promptId: string | null | undefined;
    let groupSettings: GroupChatSettings | null = null;
    let privateSettings: PrivateChatSettings | null = null;

    if (message.message_type === 'group' && message.group_id) {
      groupSettings = await this.database.getGroupChatSettingById(message.group_id);
      promptId = groupSettings?.agent_prompt_id ?? null;
    } else {
      privateSettings = await this.database.getPrivateChatSettingById(userId);
      promptId = privateSettings?.agent_prompt_id ?? null;
    }

    let config: UnifiedLLMConfig | null = null;
    let resolvedPromptName: string | undefined;

    if (promptId) {
      config = await this.aiService.getConfigurationByPromptId(promptId);
      resolvedPromptName = config?.name;
    }

    if (!config) {
      for (const candidate of this.defaultChatPromptCandidates) {
        if (!candidate) continue;
        const candidateConfig = await this.aiService.getConfigurationForAgent('chat_bot', candidate);
        if (candidateConfig) {
          config = candidateConfig;
          resolvedPromptName = candidateConfig.name ?? candidate;
          break;
        }
      }
    }

    if (!config) {
      config = await this.aiService.getConfigurationForAgent('chat_bot');
      resolvedPromptName = config?.name;
    }

    if (!config) {
      throw new Error('Failed to resolve chat prompt configuration');
    }

    const effectivePromptId = promptId || config.id || undefined;

    return {
      config,
      agentType: config.category || 'chat_bot',
      promptName: resolvedPromptName || config.name || 'enhanced_chat',
      promptId: effectivePromptId,
      groupSettings,
      privateSettings
    };
  }

  /**
   * Stage 1: Enhanced AI conversation pipeline
   */
  private async handleEnhancedAIConversation(
    userId: number,
    userMessage: string,
    originalMessage: QQMessage,
    messageContext: MessageContext,
    sessionId?: string,
    traceId?: string,
    conversationId?: string // 新增参数：已存在的conversationId
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const promptSelection = await this.resolvePromptConfiguration(originalMessage, userId);
      const {
        config: promptConfig,
        agentType: promptAgentType,
        promptName,
        promptId,
        groupSettings: resolvedGroupSettings,
        privateSettings: resolvedPrivateSettings
      } = promptSelection;

      let cachedGroupSettings = resolvedGroupSettings;
      let cachedPrivateSettings = resolvedPrivateSettings;

      const contextPrompt = this.contextManager.formatContextForAI(messageContext);
      const fullPrompt = `${contextPrompt}\n\n=== 当前需要回复的消息 ===\n${userMessage}`;

      // 🛠️ 如果启用工具系统，使用 LLMJob 异步处理
      if (this.enableLLMTools) {
        const sourceKey = originalMessage.message_type === 'group'
          ? `group_${originalMessage.group_id}`
          : `user_${userId}`;

        const sourceType = originalMessage.message_type === 'group' ? 'group' : 'private';
        const contents = [
          {
            role: 'user',
            parts: [{ text: fullPrompt }]
          }
        ];

        const jobConfig: Record<string, any> = {
          generationConfig: {
            temperature: promptConfig.generation.temperature,
            topK: promptConfig.generation.topK,
            topP: promptConfig.generation.topP,
            maxOutputTokens: promptConfig.generation.maxOutputTokens,
            stopSequences: promptConfig.generation.stopSequences
          },
          safetySettings: promptConfig.safety.map(safety => ({
            category: safety.category,
            threshold: safety.threshold
          }))
        };

        if (promptConfig.model?.name) {
          jobConfig.model = { name: promptConfig.model.name };
        }

        if (promptConfig.context.systemInstruction) {
          jobConfig.systemInstruction = {
            role: 'system',
            parts: [{ text: promptConfig.context.systemInstruction }]
          };
        }

        // 创建 LLM Job
        const jobId = await this.llmJobWorker.createJob({
          traceId: traceId || `trace-${Date.now()}`,
          sourceKey,
          sourceType,
          contents,
          config: jobConfig,
          metadata: {
            conversationId,
            userId,
            groupId: originalMessage.group_id,
            sessionId,
            messageId: originalMessage.message_id,
            messageType: originalMessage.message_type,
            promptId: promptId || null,
            promptName,
            agentType: promptAgentType,
            modelName: promptConfig.model?.name || null
          }
        });

        this.moduleLogger.info('LLM Job created for message', {
          jobId,
          conversationId,
          traceId,
          sourceKey,
          messageType: originalMessage.message_type
        });

        // 异步处理，不阻塞返回
        // Job 完成后会通过事件监听器发送响应
        return;
      }

      // 原有逻辑：直接调用 AI 服务
      const inferredUserRelation: 'new' | 'occasional' | 'frequent' = (() => {
        const historyCount = messageContext.userInfo?.message_count || 0;
        if (historyCount > 10) return 'frequent';
        if (historyCount === 0) return 'new';
        return 'occasional';
      })();

      const isUrgentMessage = userMessage.includes('紧急') || userMessage.includes('急');

      // Generate base AI response with context
      // 现在我们不再创建新的conversation，而是调用AI服务并更新已存在的记录
      const aiResponse = await this.aiService.generateResponseForExistingConversation(
        fullPrompt,
        conversationId || '', // 确保是string类型
        messageContext,
        promptAgentType,
        promptName,
        traceId,
        {
          promptId,
          configOverride: promptConfig
        }
      );
      
      // 如果AI服务返回null（错误时），更新conversation状态为failed
      if (!aiResponse) {
        this.moduleLogger.info('AI service returned null, updating conversation status to failed');
        if (conversationId) {
          await this.database.updateConversationStatus(
            conversationId,
            'failed',
            'AI service unavailable - all API tokens are unavailable'
          );
        }
        return;
      }
      
      const finalResponse = aiResponse?.trim();

      if (!finalResponse) {
        this.moduleLogger.info('AI service returned empty response after trimming, marking conversation as failed');
        if (conversationId) {
          await this.database.updateConversationStatus(
            conversationId,
            'failed',
            'AI response was empty'
          );
        }
        return;
      }

      const responseTime = Date.now() - startTime;

      // 更新conversation记录为完成状态
      if (conversationId) {
        await this.database.updateConversationStatus(
          conversationId,
          'completed',
          undefined, // no error
          finalResponse, // AI response
          responseTime,
          promptConfig.model?.name || 'gemini-2.5-flash',
          JSON.stringify({
            aiResponse,
            messageContext: {
              contextSummary: messageContext.contextSummary,
              userRelation: inferredUserRelation,
              isUrgent: isUrgentMessage,
              historyCount: messageContext.historyMessages.length
            }
          })
        );
      }

      // Send response using existing logic
      const shouldSendReply = sessionId && originalMessage.message_id && 
                             (sessionId.includes('reply') || sessionId.includes('chain'));

      if (originalMessage.message_type === 'group' && originalMessage.group_id) {
        // 第3层：检查群聊自动回复是否开启（auto_reply_enabled）
        const groupSettings = cachedGroupSettings ?? await this.database.getGroupChatSettingById(originalMessage.group_id);
        cachedGroupSettings = groupSettings;
        if (groupSettings && !groupSettings.auto_reply_enabled) {
          this.moduleLogger.debug('Group chat auto reply disabled, skipping message send', { 
            group_id: originalMessage.group_id 
          });
          return; // 不发送回复，但LLM处理已完成并记录
        }
        
        // 更新群聊AI回复活跃度
        await this.database.updateGroupActivity(originalMessage.group_id, 0, 1);
        
        if (shouldSendReply && originalMessage.message_id) {
          await this.websocketClient.sendReplyMessage(
            originalMessage.message_id,
            finalResponse
          );
        } else {
          await this.websocketClient.sendGroupMessage(
            originalMessage.group_id,
            finalResponse
          );
        }
      } else {
        // 第3层：检查私聊自动回复是否开启（auto_reply_enabled）
        const privateChatSettings = cachedPrivateSettings ?? await this.database.getPrivateChatSettingById(userId);
        cachedPrivateSettings = privateChatSettings;
        if (privateChatSettings && !privateChatSettings.auto_reply_enabled) {
          this.moduleLogger.debug('Private chat auto reply disabled, skipping message send', { 
            user_id: userId 
          });
          return; // 不发送回复，但LLM处理已完成并记录
        }
        
        if (shouldSendReply && originalMessage.message_id) {
          await this.websocketClient.sendReplyMessage(
            originalMessage.message_id,
            finalResponse
          );
        } else {
          await this.websocketClient.sendPrivateMessage(
            userId,
            finalResponse
          );
        }
      }

      this.moduleLogger.info('Enhanced AI conversation completed', {
        conversationId: conversationId,
        userId,
        responseTime,
        responseLength: finalResponse.length,
        inferredUserRelation,
        isGroupMessage: originalMessage.message_type === 'group'
      });

    } catch (error) {
      this.moduleLogger.error('Failed to handle enhanced AI conversation', { 
        error: error instanceof Error ? error.message : 'Unknown error', 
        userId, 
        conversationId 
      });
      
      // 更新conversation状态为失败
      if (conversationId) {
        await this.database.updateConversationStatus(
          conversationId,
          'failed',
          `Enhanced AI conversation error: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
      
      // 不再发送错误消息给用户，只记录日志
    }
  }

  /**
   * 测试方法：模拟处理私聊消息
   * 用于自动化测试LLM追踪功能
   */
  public async simulatePrivateMessage(testMessage: any): Promise<{ conversationId?: string, success: boolean, error?: string }> {
    try {
      this.moduleLogger.info('🧪 Processing simulated private message', { 
        user_id: testMessage.user_id, 
        message: testMessage.message 
      });

      // 创建标准的QQMessage格式
      const qqMessage: QQMessage = {
        message_type: 'private',
        user_id: testMessage.user_id,
        message: testMessage.message,
        raw_message: testMessage.raw_message || testMessage.message,
        message_id: testMessage.message_id || Date.now(),
        time: testMessage.time || Math.floor(Date.now() / 1000),
        self_id: 1129974489, // Bot's QQ ID
        sender: testMessage.sender || {
          user_id: testMessage.user_id,
          nickname: `测试用户${testMessage.user_id}`,
          sex: 'unknown' as const
        },
        font: testMessage.font || 14,
        sub_type: testMessage.sub_type || 'friend',
        post_type: 'message'
      };

      // 调用实际的消息处理逻辑，传递trace ID用于测试
      const testTraceId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await this.handlePrivateMessage(qqMessage, { traceId: testTraceId });

      return { success: true };
    } catch (error) {
      this.moduleLogger.error('Failed to simulate private message', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        testMessage 
      });
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  public async simulateGroupMessage(testMessage: any): Promise<{ conversationId?: string, success: boolean, error?: string }> {
    try {
      this.moduleLogger.info('🧪 Processing simulated group message', { 
        user_id: testMessage.user_id,
        group_id: testMessage.group_id,
        message: testMessage.message 
      });

      // 创建标准的QQMessage格式
      const qqMessage: QQMessage = {
        message_type: 'group',
        user_id: testMessage.user_id,
        group_id: testMessage.group_id,
        message: testMessage.message,
        raw_message: testMessage.raw_message || testMessage.message,
        message_id: testMessage.message_id || Date.now(),
        time: testMessage.time || Math.floor(Date.now() / 1000),
        self_id: 1129974489, // Bot's QQ ID
        sender: testMessage.sender || {
          user_id: testMessage.user_id,
          nickname: `测试用户${testMessage.user_id}`,
          card: `测试群名片${testMessage.user_id}`,
          sex: 'unknown' as const,
          role: 'member' as const
        },
        font: testMessage.font || 14,
        sub_type: testMessage.sub_type || 'normal',
        post_type: 'message'
      };

      // 调用实际的群消息处理逻辑
      await this.handleGroupMessage(qqMessage);

      return { success: true };
    } catch (error) {
      this.moduleLogger.error('Failed to simulate group message', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        testMessage 
      });
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Simple version of simulatePrivateMessage for HTTP API
   */
  public async simulatePrivateMessageSimple(message: QQMessage, eventData: any): Promise<void> {
    return await this.handlePrivateMessage(message, eventData);
  }

  /**
   * Simple version of simulateGroupMessage for HTTP API
   */
  public async simulateGroupMessageSimple(message: QQMessage, eventData: any): Promise<void> {
    return await this.handleGroupMessage(message, eventData);
  }

  /**
   * Get current time of day for context
   */
  private getTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'afternoon';  
    if (hour >= 18 && hour < 22) return 'evening';
    return 'night';
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

  private async handleNotice(notice: QQNotice, eventData?: any): Promise<void> {
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

  private async handleRequest(request: QQRequest, eventData?: any): Promise<void> {
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

  private async handleMessageSent(event: any, eventData?: any): Promise<void> {
    this.moduleLogger.debug('Bot message sent', event);
  }

  private async sendStartupNotification(): Promise<void> {
    try {
      // 等待一小段时间，确保WebSocket连接完全稳定
      await new Promise(resolve => setTimeout(resolve, 1000));

      const authorizedUserId = config.ai.authorized_user_id;

      const startupMessage = `🎉 QQ智能机器人 Stage 1 启动成功！

📊 系统状态:
✅ 数据库连接: 正常
✅ WebSocket连接: 正常  
✅ HTTP服务器: 正常
✅ AI服务: 正常

🧠 Stage 1 新特性:
✅ 智能决策引擎: 自动判断是否需要回复
✅ Prompt 配置驱动: LLM 调用内完成风格化处理
✅ 上下文引擎: 理解对话历史和用户信息

🤖 机器人信息:
• QQ号: ${config.ai.bot_qq_number}
• AI模型: ${(await this.aiService.getModelInfo()).name}
• 架构版本: Stage 1 - Smart Responder
• 启动时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}

💡 功能说明:
• 智能对话: 直接发送消息进行对话（现在更懂你了！）
• 需求管理: 描述开发需求，机器人会智能识别并处理
• 群聊管理: 支持群聊AI回复功能（智能过滤无意义回复）
• 个性化回复: 根据时间、用户关系、对话主题自动调整语调

🚀 Stage 1 进化完成！现在我能更智能地理解您的意图，提供更有针对性的回复。

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

      // 🛠️ 停止 LLM Job Worker (如果启用工具系统)
      if (this.enableLLMTools && this.llmJobWorker) {
        this.moduleLogger.info('Stopping LLMJobWorker...');
        await this.llmJobWorker.stop();
        this.moduleLogger.info('✅ LLMJobWorker stopped');
      }

      // 停止调度器（如果启用）
      if (this.enableHumanLikeProcessing) {
        this.scheduleDispatcher.stop();
        this.moduleLogger.info('✅ ScheduleDispatcher stopped');
      }

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

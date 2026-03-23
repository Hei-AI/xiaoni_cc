import { config } from './config';
import { logger } from './utils/logger';
import { DatabaseManager, getDatabaseManager } from './services/database';
import WebSocketClient from './services/websocket-client';
import HttpServer from './services/http-server';
import AIService from './services/ai-service';
import EmbeddingService from './services/embedding-service';
import { CognitionEmbeddingStore } from './services/cognition-embedding-store';
import { SessionManager } from './services/session-manager';
import { LoggingService } from './services/logging-service';
import { ContextManager } from './services/context-manager';
import { ChatViewportService } from './services/chat-viewport-service';
import { DebugService } from './services/debug-service';
import MessageQueueService, { DrainedMessage } from './services/message-queue-service';
import DirectNotifier, { BatchHandler, TriggerType } from './services/direct-notifier';
import ScheduleDispatcher from './services/schedule-dispatcher';
import HumanLikeConfigService from './services/human-like-config-service';
import DecisionEngine from './engines/decision-engine';
import ContextEngine from './engines/context-engine';
import { extractBeliefCandidatesFromMessage } from './services/agent-belief-service';
import AgentMemoryService from './services/agent-memory-service';
import type { AgentProactivityRuntimeConfig } from './services/agent-memory-service';
// 🛠️ LLM 工具系统组件
import { ToolRegistryService } from './services/tool-registry-service';
import { FunctionCallDispatcher } from './services/function-call-dispatcher';
import { LLMJobWorker } from './services/llm-job-worker';
import {
  createMessagingTools,
  type ReplyContextToolPayload,
  type MessageAttachmentToolPayload
} from './tools/static-tools';
import {
  ChatViewportData,
  QQMessage,
  QQNotice,
  QQRequest,
  ConversationData,
  MessageContext,
  DecisionResult,
  GroupChatSettings,
  PrivateChatSettings,
  ReplyIntentContext,
  UnifiedLLMConfig,
  FunctionCallingConfig,
  FunctionCallingMode
} from './types';
import { v4 as uuidv4 } from 'uuid';
import {
  buildAttachmentHints,
  extractTextFromSegments,
  resolveAttachmentsFromMessage,
  resolveAttachmentViewsFromMessage
} from './utils/message-utils';
import {
  extractNormalizedMessageText,
  parseReplyIntentContext
} from './utils/reply-intent';
import { isAutoReplyAllowed, isDbBooleanEnabled } from './utils/boolean-flags';
import MemeLibrary from './services/meme-library';

class QQBot implements BatchHandler {
  private database: DatabaseManager;
  private websocketClient: WebSocketClient;
  private httpServer: HttpServer;
  private aiService: AIService;
  private embeddingService: EmbeddingService;
  private cognitionEmbeddingStore: CognitionEmbeddingStore;
  private agentMemoryService: AgentMemoryService;
  private sessionManager: SessionManager;
  private loggingService: LoggingService;
  private contextManager: ContextManager;
  private chatViewportService: ChatViewportService;
  private debugService: DebugService;

  // Stage 1 Engines
  private decisionEngine: DecisionEngine;
  private contextEngine: ContextEngine;

  // Human-like Processing Components
  private messageQueueService: MessageQueueService;
  private directNotifier: DirectNotifier;
  private scheduleDispatcher: ScheduleDispatcher;
  private humanLikeConfigService: HumanLikeConfigService;
  private enableHumanLikeProcessing: boolean;
  private proactiveFollowupEnabled: boolean;
  private proactiveFollowupAllowedUserIds: Set<number>;
  private proactiveFollowupMaxPerRun: number;
  private proactiveFollowupRetryDelayMs: number;

  // 🛠️ LLM 工具系统组件
  private toolRegistryService: ToolRegistryService;
  private functionCallDispatcher: FunctionCallDispatcher;
  private llmJobWorker: LLMJobWorker;
  private enableLLMTools: boolean;
  private memeLibrary: MemeLibrary;

  private moduleLogger = logger.createModuleLogger('main');

  // 群聊管理状态 - 使用数据库存储的设置
  private groupReplyEnabled: boolean = true;
  private allowedGroups: Set<number> = new Set();
  private groupSettingsCache: Map<number, boolean> = new Map(); // 群聊启用状态缓存
  private readonly defaultChatPromptCandidates: string[] = ['basic_chat', 'echance_chat', 'enhanced_chat', 'default_chat'];
  private httpServerStarted = false;
  private websocketConnected = false;

  constructor() {
    this.database = getDatabaseManager(config.database);
    this.loggingService = new LoggingService(this.database);
    this.websocketClient = new WebSocketClient(
      config.websocket,
      this.loggingService,
      this.database,
      config.ai.bot_qq_number
    );
    this.aiService = new AIService(config.ai, this.database, this.loggingService);
    this.embeddingService = new EmbeddingService(config.ai);
    this.cognitionEmbeddingStore = new CognitionEmbeddingStore(this.database, this.embeddingService);
    this.agentMemoryService = new AgentMemoryService(this.database, this.cognitionEmbeddingStore);
    this.sessionManager = new SessionManager(this.database);
    this.chatViewportService = new ChatViewportService(this.database);
    this.contextManager = new ContextManager(this.database, this.chatViewportService, this.agentMemoryService);
    this.debugService = new DebugService(this.database);
    this.memeLibrary = new MemeLibrary();

    // Initialize Stage 1 Engines
    this.contextEngine = new ContextEngine(this.database);
    this.decisionEngine = new DecisionEngine(this.aiService, config.ai);

    // Initialize Human-like Processing
    this.enableHumanLikeProcessing = process.env.ENABLE_HUMAN_LIKE_PROCESSING === 'true';
    this.proactiveFollowupEnabled = process.env.PROACTIVITY_ENABLED === 'true';
    this.proactiveFollowupAllowedUserIds = this.parseAllowedUserIds(
      process.env.PROACTIVE_FOLLOWUP_ALLOWED_USER_IDS
    );
    this.proactiveFollowupMaxPerRun = Math.max(
      1,
      Math.min(5, parseInt(process.env.PROACTIVE_FOLLOWUP_MAX_PER_RUN || '1', 10))
    );
    this.proactiveFollowupRetryDelayMs = Math.max(
      60_000,
      parseInt(process.env.PROACTIVE_FOLLOWUP_RETRY_DELAY_MS || '21600000', 10)
    );
    const humanLikeDefaults = {
      scanInterval: parseInt(process.env.HUMAN_LIKE_SCAN_INTERVAL || '8000', 10),
      minInterval: parseInt(process.env.HUMAN_LIKE_MIN_INTERVAL || '3000', 10),
      maxInterval: parseInt(process.env.HUMAN_LIKE_MAX_INTERVAL || '30000', 10)
    };
    const humanLikeTickInterval = parseInt(process.env.HUMAN_LIKE_TICK_INTERVAL || '1000', 10);
    this.messageQueueService = new MessageQueueService(
      config.ai.authorized_user_id,
      config.ai.bot_qq_number,
      this.loggingService
    );
    this.directNotifier = new DirectNotifier(this); // Pass self as BatchHandler
    this.humanLikeConfigService = new HumanLikeConfigService(
      this.database,
      humanLikeDefaults
    );
    this.scheduleDispatcher = new ScheduleDispatcher(this.messageQueueService, this, {
      backgroundTaskRunner: async () => {
        await this.runBackgroundCognitionTasks();
      },
      database: this.database,
      configProvider: this.humanLikeConfigService,
      configOverrides: {
        ...humanLikeDefaults,
        tickInterval: humanLikeTickInterval
      }
    });

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

    const messagingTools = createMessagingTools({
      sendPrivateMessage: this.websocketClient.sendPrivateMessage.bind(this.websocketClient),
      sendGroupMessage: this.websocketClient.sendGroupMessage.bind(this.websocketClient),
      canSendPrivateMessage: async (userId: number) => {
        const privateChatSettings = await this.database.getPrivateChatSettingById(userId);
        return isAutoReplyAllowed(privateChatSettings);
      },
      canSendGroupMessage: async (groupId: number) => {
        const groupSettings = await this.database.getGroupChatSettingById(groupId);
        return isAutoReplyAllowed(groupSettings);
      },
      scrollChatViewUp: (cursor, pageSize) => this.chatViewportService.scrollUp(cursor, pageSize),
      jumpChatViewToLatest: (cursor, pageSize) => this.chatViewportService.jumpToLatest(cursor, pageSize),
      fetchReplyContext: metadata => this.fetchReplyContextToolPayload(metadata),
      readMessageAttachment: params => this.readMessageAttachmentToolPayload(params),
      findMemeByTags: tags => this.memeLibrary.findBestMatch(tags),
      saveMemeImage: (imageBase64, tags) => this.memeLibrary.addMeme(imageBase64, tags),
      recordMemeUsage: memeId => this.memeLibrary.recordUsage(memeId)
    });

    void this.functionCallDispatcher
      .registerStaticTools(messagingTools)
      .catch(error => {
        this.moduleLogger.error('Failed to register static tools', {
          error: error instanceof Error ? error.message : error
        });
      });

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
      outcome?: any;
      metadata?: any;
    }) => {
      try {
        const { metadata, finalResponse, outcome } = event;

        if (metadata?.agentType === 'chat_bot' && outcome) {
          this.moduleLogger.info('Chat loop outcome finalized by worker', {
            jobId: event.jobId,
            traceId: event.traceId,
            outcome: outcome.kind,
            toolName: outcome.toolName,
            conversationId: metadata?.conversationId
          });
          return;
        }

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
          if (!isAutoReplyAllowed(groupSettings)) {
            this.moduleLogger.debug('Group auto reply disabled, skip sending response', { groupId });
            return;
          }

          await this.database.updateGroupActivity(groupId, 0, 1);
          await this.websocketClient.sendGroupMessage(groupId, finalResponse, {
            traceId: event.traceId,
            conversationId
          });
        } else if (messageType === 'private' && userId) {
          // 检查私聊自动回复开关
          const privateChatSettings = await this.database.getPrivateChatSettingById(userId);
          if (!isAutoReplyAllowed(privateChatSettings)) {
            this.moduleLogger.debug('Private auto reply disabled, skip sending response', { userId });
            return;
          }

          await this.websocketClient.sendPrivateMessage(userId, finalResponse, {
            traceId: event.traceId,
            conversationId
          });
        }

        this.moduleLogger.info('LLM Job response sent', {
          jobId: event.jobId,
          messageType,
          userId,
          groupId,
          conversationId,
          modelName: jobModelName || 'unknown'
        });

        await this.loggingService.logInstantEvent(event.traceId, 'trace', 'trace.completed', conversationId, {
          job_id: event.jobId,
          message_type: messageType,
          outcome: outcome?.kind || 'message_sent'
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
      outcome?: any;
      metadata?: any;
    }) => {
      try {
        this.moduleLogger.error('LLM Job failed', event);

        if (event.metadata?.agentType === 'chat_bot' && event.outcome) {
          return;
        }

        // 更新 conversation 状态为失败
        if (event.metadata?.conversationId) {
          await this.database.updateConversationStatus(
            event.metadata.conversationId,
            'failed',
            `LLM Job failed: ${event.error}`
          );
        }

        await this.loggingService.logInstantEvent(event.traceId, 'trace', 'trace.failed', event.metadata?.conversationId, {
          job_id: event.jobId,
          error: event.error,
          outcome: event.outcome?.kind || 'failed'
        });

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
      embeddingService: this.embeddingService,
      messageQueueService: this.messageQueueService,
      agentMemoryService: this.agentMemoryService,
      getProactivityDefaults: () => this.getProactivityDefaults()
    });

    // Clear group settings cache to pick up any recent database changes
    this.groupSettingsCache.clear();

    this.moduleLogger.info('QQBot initialized', {
      enableHumanLikeProcessing: this.enableHumanLikeProcessing
    });
  }

  private normalizeAdvancedConfig(raw: string | null): any {
    if (!raw) {
      return {};
    }

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
      return {};
    } catch (error) {
      this.moduleLogger.warn('Failed to parse advanced_config, resetting to empty object', {
        error: error instanceof Error ? error.message : String(error)
      });
      return {};
    }
  }

  private isToolDrivenChatAgent(agentType: string): boolean {
    return agentType === 'chat_bot';
  }

  private buildChatLoopProtocolInstruction(
    messageType: 'private' | 'group',
    _replyIntentContext?: ReplyIntentContext
  ): string {
    const sendTool = messageType === 'group' ? 'send_qq_group_message' : 'send_private_chat_message';
    return [
      'Chat loop protocol:',
      `1. You must end every reply by calling exactly one terminal tool. Use ${sendTool} for normal replies and use end only when you intentionally want no reply.`,
      '2. Do not finish with plain assistant text. Do not call end after a send tool.',
      '3. Use send_meme_image only when the user explicitly asks for an image/meme or the conversation is already in a meme workflow.',
      '4. save_meme_image is non-terminal; after saving you must continue until a send tool or end completes the turn.',
      '5. Treat the supplied transcript as the currently visible QQ chat window, not the full chat history.',
      '6. First decide whether this message is worth replying to now. Low-signal or unclear turns may end with end.',
      '7. If you need more context, choose the tool that matches the missing information: use chat_view_scroll_up / chat_view_jump_to_latest for the current window, and use reply_context_fetch only when the reply anchor itself matters.',
      '8. If a message contains image or meme attachments and the visual content matters, use read_message_attachment to open that specific attachment before deciding.',
      '9. Use the metadata and tool schemas to infer execution parameters. Do not ask for IDs that are already present in context.'
    ].join('\n');
  }

  private getImplicitChatToolNames(messageType: 'private' | 'group'): string[] {
    const sendTool = messageType === 'group' ? 'send_qq_group_message' : 'send_private_chat_message';
    return [sendTool, 'chat_view_scroll_up', 'chat_view_jump_to_latest', 'reply_context_fetch', 'read_message_attachment', 'end'];
  }

  private formatReplyTargetUser(
    nickname?: string,
    userId?: number
  ): string | undefined {
    if (nickname && userId !== undefined) {
      return `${nickname} (${userId})`;
    }
    if (nickname) {
      return nickname;
    }
    if (userId !== undefined) {
      return `用户${userId} (${userId})`;
    }
    return undefined;
  }

  private buildViewportTranscript(viewport: ChatViewportData): string {
    const lines: string[] = [];

    for (const rawLine of viewport.header_lines || []) {
      if (typeof rawLine === 'string' && rawLine.trim().length > 0) {
        lines.push(rawLine.trim());
      }
    }

    for (const message of viewport.visible_messages || []) {
      if (
        viewport.divider_before_history_id != null
        && Number(message.history_id) === Number(viewport.divider_before_history_id)
      ) {
        lines.push('--- 以下是未读消息 ---');
      }

      const rawMessage = message.raw_payload && typeof message.raw_payload === 'object'
        ? message.raw_payload as QQMessage
        : undefined;
      const rawSender = rawMessage?.sender;
      const senderId = typeof message.sender_id === 'number' ? message.sender_id : rawSender?.user_id;
      const senderName =
        message.sender_role === 'bot'
          ? '我'
          : rawSender?.nickname
            || ('card' in (rawSender || {}) ? (rawSender as any)?.card : undefined)
            || (senderId != null ? `用户${senderId}` : '未知用户');
      const normalizedText = rawMessage ? extractNormalizedMessageText(rawMessage) : '';
      const attachmentViews = rawMessage ? resolveAttachmentViewsFromMessage(rawMessage) : [];
      const replyIntent = rawMessage
        ? (rawMessage.reply_intent_context || parseReplyIntentContext(rawMessage))
        : undefined;
      const mentions = Array.isArray(rawMessage?.message)
        ? rawMessage.message
            .filter(segment => segment?.type === 'at')
            .map(segment => String(segment?.data?.qq))
            .filter(value => value && value !== 'all' && value !== 'here')
        : [];

      const block = ['- message:'];
      block.push(`  time=${message.sent_at ? new Date(message.sent_at).toISOString() : ''}`);
      if (message.message_id != null) {
        block.push(`  message_id=${message.message_id}`);
      }
      if (senderId != null) {
        block.push(`  sender_id=${senderId}`);
      }
      block.push(`  sender_name=${senderName}`);
      block.push(`  mentions=${JSON.stringify(Array.from(new Set(mentions)))}`);
      if (replyIntent?.semantic_anchor?.message_id != null) {
        block.push(`  reply_ref.message_id=${replyIntent.semantic_anchor.message_id}`);
        if (replyIntent.semantic_anchor.sender_id != null) {
          block.push(`  reply_ref.sender_id=${replyIntent.semantic_anchor.sender_id}`);
        }
        if (replyIntent.semantic_anchor.sender_nickname) {
          block.push(`  reply_ref.sender_name=${replyIntent.semantic_anchor.sender_nickname}`);
        }
        if (replyIntent.semantic_anchor.text) {
          block.push(`  reply_ref.text=${replyIntent.semantic_anchor.text}`);
        }
      }
      block.push(`  content_type=${this.resolveTranscriptContentType(normalizedText, attachmentViews)}`);
      if (normalizedText) {
        block.push(`  text=${normalizedText}`);
      }
      if (attachmentViews.length > 0) {
        block.push(`  attachments=${JSON.stringify(attachmentViews.map(({ attachment_id, type, label, mime_type }) => ({
          attachment_id,
          type,
          label,
          mime_type
        })))}`);
      }

      lines.push(block.join('\n'));
    }

    return lines.join('\n').trim();
  }

  private resolveTranscriptContentType(
    text: string | undefined,
    attachments: Array<{ type: string }>
  ): string {
    const hasText = typeof text === 'string' && text.trim().length > 0;
    const hasImage = attachments.some(item => item.type === 'image');
    const hasOnlyFace = attachments.length > 0 && attachments.every(item => item.type === 'face');

    if (hasText && attachments.length > 0) {
      return 'mixed';
    }
    if (hasImage) {
      return 'image';
    }
    if (!hasText && hasOnlyFace) {
      return 'face_only';
    }
    return 'text';
  }

  private async fetchReplyContextToolPayload(
    metadata?: Record<string, any>
  ): Promise<ReplyContextToolPayload> {
    const replyIntentContext = metadata?.replyIntentContext as ReplyIntentContext | undefined;
    const replyToMessageId = Number(metadata?.replyToMessageId);
    const currentViewport = metadata?.chatViewport;

    if (!replyIntentContext?.semantic_anchor?.message_id || !Number.isFinite(replyToMessageId)) {
      return {
        status: 'missing_reply_context',
        note: '当前消息没有可读取的 reply 上下文。'
      };
    }

    const addressTarget = {
      type: replyIntentContext.address_target.type,
      user_id: replyIntentContext.address_target.user_id,
      nickname: this.formatReplyTargetUser(
        replyIntentContext.address_target.nickname,
        replyIntentContext.address_target.user_id
      )
    };
    const quotedSender = {
      user_id: replyIntentContext.semantic_anchor.sender_id,
      nickname: this.formatReplyTargetUser(
        replyIntentContext.semantic_anchor.sender_nickname,
        replyIntentContext.semantic_anchor.sender_id
      )
    };

    const anchorAlreadyVisible = currentViewport
      ? await this.chatViewportService.isMessageVisible(currentViewport, replyToMessageId)
      : false;

    if (anchorAlreadyVisible) {
      return {
        status: 'ok',
        message_kind: replyIntentContext.message_kind,
        reply_to_message_id: replyToMessageId,
        address_target: addressTarget,
        quoted_sender: quotedSender,
        quoted_text: replyIntentContext.semantic_anchor.text,
        anchor_already_visible: true,
        note: '被引用消息已经在当前聊天窗口中可见。'
      };
    }

    const replyViewport = await this.chatViewportService.buildReplyAnchorViewport({
      messageType: metadata?.messageType,
      userId: Number(metadata?.userId),
      groupId: metadata?.groupId != null ? Number(metadata.groupId) : undefined,
      replyMessageId: replyToMessageId
    });

    if (!replyViewport) {
      return {
        status: 'anchor_not_found',
        message_kind: replyIntentContext.message_kind,
        reply_to_message_id: replyToMessageId,
        address_target: addressTarget,
        quoted_sender: quotedSender,
        quoted_text: replyIntentContext.semantic_anchor.text,
        anchor_already_visible: false,
        note: '数据库中未找到被引用消息，只能使用原始 reply 摘要。'
      };
    }

    return {
      status: 'ok',
      message_kind: replyIntentContext.message_kind,
      reply_to_message_id: replyToMessageId,
      address_target: addressTarget,
      quoted_sender: quotedSender,
      quoted_text: replyIntentContext.semantic_anchor.text,
      anchor_already_visible: false,
      transcript: this.buildViewportTranscript(replyViewport),
      reply_anchor_viewport: replyViewport.cursor
    };
  }

  private async readMessageAttachmentToolPayload(params: {
    metadata?: Record<string, any>;
    messageId: number;
    attachmentId?: number;
    attachmentIndex?: number;
  }): Promise<MessageAttachmentToolPayload> {
    const { metadata, messageId, attachmentId, attachmentIndex } = params;
    const resolvedAttachmentId = attachmentId ?? attachmentIndex;
    if (resolvedAttachmentId == null) {
      return {
        status: 'attachment_not_found',
        message_id: messageId,
        note: '缺少 attachment_id 或 attachment_index。'
      };
    }

    const messageType = metadata?.messageType;
    const groupId = metadata?.groupId != null ? Number(metadata.groupId) : undefined;
    const userId = metadata?.userId != null ? Number(metadata.userId) : undefined;

    let rawMessage: QQMessage | undefined;
    if (messageType === 'group' && groupId != null) {
      const record = await this.database.getGroupMessageHistoryRecordByMessageId(groupId, messageId);
      rawMessage = record?.raw_payload as QQMessage | undefined;
    } else if (messageType === 'private' && userId != null) {
      const record = await this.database.getPrivateMessageHistoryRecordByMessageId(userId, messageId);
      rawMessage = record?.raw_payload as QQMessage | undefined;
    }

    if (!rawMessage || typeof rawMessage !== 'object') {
      return {
        status: 'message_not_found',
        message_id: messageId,
        attachment_id: resolvedAttachmentId,
        note: '数据库中未找到目标消息，无法读取附件。'
      };
    }

    const attachmentViews = resolveAttachmentViewsFromMessage(rawMessage);
    const attachment = attachmentViews.find(item => item.attachment_id === resolvedAttachmentId);
    if (!attachment) {
      return {
        status: 'attachment_not_found',
        message_id: messageId,
        attachment_id: resolvedAttachmentId,
        note: '目标消息中不存在该附件。'
      };
    }

    if (attachment.type !== 'image') {
      return {
        status: 'not_available_yet',
        message_id: messageId,
        attachment_id: resolvedAttachmentId,
        attachment_type: attachment.type,
        label: attachment.label,
        note: '该附件不是可视觉读取的图片内容。'
      };
    }

    if (!attachment.base64 || !attachment.mime_type) {
      return {
        status: 'download_failed',
        message_id: messageId,
        attachment_id: resolvedAttachmentId,
        attachment_type: attachment.type,
        label: attachment.label,
        mime_type: attachment.mime_type,
        note: '图片存在，但当前未能拿到可读取的原始内容。'
      };
    }

    return {
      status: 'ok',
      message_id: messageId,
      attachment_id: resolvedAttachmentId,
      attachment_type: attachment.type,
      label: attachment.label,
      mime_type: attachment.mime_type,
      media_part: {
        mimeType: attachment.mime_type,
        data: attachment.base64
      }
    };
  }

  public async start(): Promise<void> {
    try {
      this.moduleLogger.info('🚀 Starting QQ Bot...'); // Testing Claude PostToolUse hook

      // 测试数据库连接
      const dbConnected = await this.database.testConnection();
      if (!dbConnected) {
        throw new Error('Database connection failed');
      }
      await this.database.ensureOperationalIndexes();
      this.moduleLogger.info('✅ Database connected');

      // 启动HTTP服务器
      await this.httpServer.start();
      this.httpServerStarted = true;
      this.moduleLogger.info('✅ HTTP server started');

      // 设置WebSocket事件监听器
      this.setupWebSocketEventHandlers();

      // 连接到WebSocket服务器
      await this.websocketClient.connect();
      this.websocketConnected = this.websocketClient.isConnected();
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
      await this.persistRuntimeStatus('online');

      this.moduleLogger.info('🎉 QQ Bot started successfully!');

    } catch (error) {
      await this.persistRuntimeStatus(
        'error',
        error instanceof Error ? error.message : String(error)
      );
      this.moduleLogger.error('❌ Failed to start QQ Bot', { error });
      throw error;
    }
  }

  private setupWebSocketEventHandlers(): void {
    // 连接事件
    this.websocketClient.on('connected', () => {
      this.websocketConnected = true;
      void this.persistRuntimeStatus('online');
      this.moduleLogger.info('WebSocket connected');
    });

    this.websocketClient.on('disconnected', (data) => {
      this.websocketConnected = false;
      this.moduleLogger.warn('WebSocket disconnected', data);
      void this.persistRuntimeStatus('offline', this.extractDisconnectReason(data));
    });

    this.websocketClient.on('error', (error) => {
      this.websocketConnected = this.websocketClient.isConnected();
      void this.persistRuntimeStatus(
        'error',
        error instanceof Error ? error.message : String(error)
      );
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
      const anchorMessage = this.pickLatestDrainedMessage(messages);

      if (anchorMessage) {
        this.moduleLogger.info('Selected private batch anchor message', {
          batchId,
          sourceKey,
          anchorTraceId: anchorMessage.traceId,
          skippedMessageCount: Math.max(0, messages.length - 1)
        });

        await this._processSinglePrivateMessage(
          anchorMessage.message as QQMessage,
          {
            ...anchorMessage.eventData,
            batchMessages: messages.map(item => ({
              traceId: item.traceId,
              arrivalTime: item.arrivalTime,
              priority: item.priority,
              messageId: (item.message as QQMessage)?.message_id ?? null
            }))
          },
          anchorMessage.traceId,
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
      const anchorMessage = this.pickGroupBatchAnchor(messages);

      if (anchorMessage) {
        this.moduleLogger.info('Selected group batch anchor message', {
          batchId,
          sourceKey,
          anchorTraceId: anchorMessage.traceId,
          skippedMessageCount: Math.max(0, messages.length - 1),
          anchorMessageId: (anchorMessage.message as QQMessage)?.message_id ?? null
        });

        await this._processSingleGroupMessage(
          anchorMessage.message as QQMessage,
          {
            ...anchorMessage.eventData,
            batchMessages: messages.map(item => ({
              traceId: item.traceId,
              arrivalTime: item.arrivalTime,
              priority: item.priority,
              messageId: (item.message as QQMessage)?.message_id ?? null
            }))
          },
          anchorMessage.traceId,
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

  private pickLatestDrainedMessage(messages: DrainedMessage[]): DrainedMessage | null {
    if (!Array.isArray(messages) || messages.length === 0) {
      return null;
    }

    return [...messages].sort((left, right) => {
      const leftTime = left.arrivalTime instanceof Date ? left.arrivalTime.getTime() : 0;
      const rightTime = right.arrivalTime instanceof Date ? right.arrivalTime.getTime() : 0;
      return rightTime - leftTime;
    })[0] || null;
  }

  private pickGroupBatchAnchor(messages: DrainedMessage[]): DrainedMessage | null {
    if (!Array.isArray(messages) || messages.length === 0) {
      return null;
    }

    const directlyAddressed = messages.filter(item =>
      this.isGroupMessageDirectlyAddressed(item.message as QQMessage)
    );

    if (directlyAddressed.length > 0) {
      return this.pickLatestDrainedMessage(directlyAddressed);
    }

    return this.pickLatestDrainedMessage(messages);
  }

  private isGroupMessageDirectlyAddressed(message: QQMessage): boolean {
    if (!message || message.message_type !== 'group') {
      return false;
    }

    const botQQ = this.aiService.getBotQQNumber();
    if (!botQQ) {
      return false;
    }

    if (Array.isArray(message.message)) {
      return message.message.some((segment: any) =>
        segment?.type === 'at' && segment.data?.qq === botQQ.toString()
      );
    }

    if (typeof message.message === 'string') {
      const atPattern = new RegExp(`\\[CQ:at,qq=${botQQ}\\]`);
      return atPattern.test(message.message);
    }

    return false;
  }

  /**
   * 处理单条私聊消息（核心逻辑）
   */
  private async _processSinglePrivateMessage(message: QQMessage, eventData?: any, traceId?: string, batchId?: string): Promise<void> {
    const conversationId = uuidv4();
    const enrichedMessage = this.enrichIncomingMessage(message);

    try {
      this.moduleLogger.info('Processing single private message', {
        traceId,
        conversationId,
        user_id: enrichedMessage.user_id,
        message: enrichedMessage.message
      });

      const userId = enrichedMessage.user_id;
      const userMessage = enrichedMessage.normalized_text || '';
      const conversationText = this.formatMessageForConversation(enrichedMessage, userMessage);

      // 🔥 FIX: 立即创建conversation记录 - 改进后的架构 (移到过滤检查之前)
      const initialConversation: ConversationData = {
        id: conversationId,
        trace_id: traceId,
        user_id: userId,
        user_message: conversationText,
        timestamp: new Date(),
        response_time: 0,
        raw_request: JSON.stringify(enrichedMessage), // 保存完整的WebSocket消息数据
        status: 'pending', // 初始状态为pending
        batch_id: batchId, // 关联批次ID
        ...this.buildConversationThreadingFields(enrichedMessage),
        created_at: new Date(),
        updated_at: new Date()
      };

      await this.database.saveConversation(initialConversation);
      this.moduleLogger.info('Initial conversation record created', { conversationId, batchId, status: 'pending' });
      await this.recordReplyAnchorObservation(enrichedMessage, conversationId, traceId);
      await this.updateBeliefsFromIncomingMessage(enrichedMessage);

      // 检查私聊设置（2层过滤控制）
      const privateChatSettings = await this.database.getPrivateChatSettingById(userId);

      // 第2层：检查是否允许自动回复
      if (privateChatSettings && !isDbBooleanEnabled(privateChatSettings.auto_reply_enabled)) {
        this.moduleLogger.debug('Private chat auto reply disabled', { user_id: userId });

        await this.database.updateConversationStatus(conversationId, 'filtered_disabled', 'Private chat auto reply disabled');
        this.moduleLogger.info('Conversation updated for filtered private message', {
          conversationId,
          reason: 'auto_reply_disabled',
          traceId
        });

        return;
      }

      // 记录通过检查
      this.moduleLogger.debug('Private chat passed initial checks', {
        user_id: userId,
        is_enabled: privateChatSettings?.is_enabled ?? true,
        auto_reply_enabled: privateChatSettings?.auto_reply_enabled ?? false
      });

      this.moduleLogger.info('DEBUG: About to call buildMessageContext', {
        userId,
        messageType: message.message_type,
        hasContextManager: !!this.contextManager,
        conversationId
      });

      // 更新状态为processing
      await this.database.updateConversationStatus(conversationId, 'processing');
      await this.agentMemoryService.upsertMicroIntentionForMessage(enrichedMessage);
      await this.agentMemoryService.maybeFlushDurableContext(enrichedMessage, {
        conversationId,
        traceId
      });

      // 构建消息上下文（前20条消息）
      const contextStartTime = new Date();
      if (traceId) {
        await this.loggingService.logEventStart(traceId, 'context', 'context.build', conversationId, {
          message_type: enrichedMessage.message_type,
          user_id: userId
        });
      }
      const messageContext = await this.contextManager.buildMessageContext(enrichedMessage, 20);
      if (traceId) {
        await this.loggingService.logEventEnd(traceId, 'context', 'context.build', contextStartTime, conversationId, {
          history_count: messageContext.historyMessages.length,
          has_user_info: !!messageContext.userInfo
        });
      }

      this.moduleLogger.info('DEBUG: buildMessageContext completed', { userId });

      this.moduleLogger.info('Message context built', {
        traceId,
        historyCount: messageContext.historyMessages.length,
        hasUserInfo: !!messageContext.userInfo,
        userId
      });

      // Stage 1: Use DecisionEngine for intelligent response decision
      const decisionStartTime = new Date();
      if (traceId) {
        await this.loggingService.logEventStart(traceId, 'decision', 'decision.analyze', conversationId, {
          message_type: enrichedMessage.message_type,
          user_id: userId
        });
      }
      const decision = await this.decisionEngine.analyzeMessage(messageContext, traceId);
      if (traceId) {
        await this.loggingService.logEventEnd(traceId, 'decision', 'decision.analyze', decisionStartTime, conversationId, {
          should_respond: decision.shouldRespond,
          reason: decision.reason,
          confidence: decision.confidence
        });
      }

      this.moduleLogger.info('Decision engine result', {
        shouldRespond: decision.shouldRespond,
        confidence: decision.confidence,
        reason: decision.reason,
        suggestedService: decision.suggestedService,
        attentionLevel: decision.attentionLevel,
        attentionReason: decision.attentionReason,
        suggestedNextStep: decision.suggestedNextStep,
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
      const sessionContext = await this.sessionManager.processIncomingMessage(enrichedMessage);

      await this.database.updateConversationSession(conversationId, sessionContext.session_id);

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
        enrichedMessage,
        messageContext,
        sessionContext.session_id,
        traceId,
        conversationId // 传递已创建的conversationId
      );

    } catch (error) {
      this.moduleLogger.error('Error processing private message', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        userId: enrichedMessage.user_id,
        conversationId,
        messagePreview: typeof enrichedMessage.message === 'string' ? enrichedMessage.message.substring(0, 50) : JSON.stringify(enrichedMessage.message)?.substring(0, 50)
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
    const baseEnrichedMessage = this.enrichIncomingMessage(message);

    try {
      this.moduleLogger.info('Processing single group message', {
        traceId,
        conversationId,
        group_id: baseEnrichedMessage.group_id,
        user_id: baseEnrichedMessage.user_id,
        message: typeof baseEnrichedMessage.message === 'string'
          ? baseEnrichedMessage.message.substring(0, 100)
          : JSON.stringify(baseEnrichedMessage.message).substring(0, 100)
      });

      // 只处理@机器人的消息
      const botQQ = this.aiService.getBotQQNumber();

      // 检测@机器人：同时支持消息段数组格式和字符串CQ码格式
      let isAtBot = false;
      if (Array.isArray(baseEnrichedMessage.message)) {
        isAtBot = baseEnrichedMessage.message.some((segment: any) =>
          segment.type === 'at' && segment.data?.qq === botQQ.toString()
        );
      } else if (typeof baseEnrichedMessage.message === 'string') {
        // 字符串CQ码格式检测
        const atPattern = new RegExp(`\\[CQ:at,qq=${botQQ}\\]`);
        isAtBot = atPattern.test(baseEnrichedMessage.message);
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

      this.moduleLogger.info('Received group at message', {
        group_id: baseEnrichedMessage.group_id,
        user_id: baseEnrichedMessage.user_id,
        message: baseEnrichedMessage.message
      });

      // 清理消息内容（保留@信息以便区分消息目标）
      let cleanMessage = '';

      if (typeof baseEnrichedMessage.message === 'string') {
        // 字符串格式：保留@信息，并将CQ at标记转换为易读形式
        cleanMessage = baseEnrichedMessage.message
          .replace(/\[CQ:at,qq=(\d+)(?:,[^\]]*)?\]/g, (_, qq) => `@${qq}`)
          .trim();
      } else if (Array.isArray(baseEnrichedMessage.message)) {
        // 消息段数组格式：提取文本内容并保留@信息
        cleanMessage = baseEnrichedMessage.message
          .map((segment: any) => {
            if (segment.type === 'text') {
              return segment.data?.text || '';
            }
            if (segment.type === 'at') {
              const mentionName = segment.data?.name || segment.data?.qq;
              return mentionName ? `@${mentionName}` : '@';
            }
            return '';
          })
          .join('')
          .trim();
      }

      const enrichedMessage = this.enrichIncomingMessage(baseEnrichedMessage, cleanMessage);
      const conversationText = this.formatMessageForConversation(enrichedMessage, cleanMessage);
      const hasAttachments =
        Array.isArray(enrichedMessage.attachments) &&
        enrichedMessage.attachments.length > 0;

      if (!cleanMessage && !hasAttachments) {
        // 记录空消息以便排查，但不发送兜底消息
        this.moduleLogger.info('Skipped group message with empty content after normalization', {
          traceId,
          conversationId,
          groupId: enrichedMessage.group_id,
          userId: enrichedMessage.user_id
        });

        const filteredConversation: ConversationData = {
          id: conversationId,
          trace_id: traceId,
          user_id: enrichedMessage.user_id,
          group_id: enrichedMessage.group_id,
          user_message: conversationText,
          timestamp: new Date(),
          response_time: 0,
          raw_request: JSON.stringify(enrichedMessage),
          status: 'filtered_empty_content',
          error_reason: 'Empty content after normalization',
          batch_id: batchId,
          ...this.buildConversationThreadingFields(enrichedMessage),
          created_at: new Date(),
          updated_at: new Date()
        };

        await this.database.saveConversation(filteredConversation);
        return;
      }

      // 🔥 FIX: Create conversation record for group messages early for traceability
      const groupConversation: ConversationData = {
        id: conversationId,
        trace_id: traceId,
        user_id: enrichedMessage.user_id,
        group_id: enrichedMessage.group_id,
        user_message: conversationText,
        timestamp: new Date(),
        response_time: 0,
        raw_request: JSON.stringify(enrichedMessage),
        status: 'pending',
        batch_id: batchId, // 关联批次ID
        ...this.buildConversationThreadingFields(enrichedMessage),
        created_at: new Date(),
        updated_at: new Date()
      };

      await this.database.saveConversation(groupConversation);
      this.moduleLogger.info('Group conversation record created', { conversationId, batchId, groupId: enrichedMessage.group_id, traceId });
      await this.recordReplyAnchorObservation(enrichedMessage, conversationId, traceId);
      await this.updateBeliefsFromIncomingMessage(enrichedMessage);

      const groupSettings = enrichedMessage.group_id
        ? await this.database.getGroupChatSettingById(enrichedMessage.group_id)
        : null;

      if (groupSettings && !isDbBooleanEnabled(groupSettings.auto_reply_enabled)) {
        this.moduleLogger.debug('Group chat auto reply disabled', { group_id: enrichedMessage.group_id });
        await this.database.updateConversationStatus(conversationId, 'filtered_disabled', 'Group chat auto reply disabled');
        this.moduleLogger.info('Conversation updated for filtered group message', {
          conversationId,
          reason: 'auto_reply_disabled',
          traceId
        });
        return;
      }

      this.moduleLogger.debug('Group chat passed initial checks', {
        group_id: enrichedMessage.group_id,
        is_enabled: groupSettings?.is_enabled ?? true,
        auto_reply_enabled: groupSettings?.auto_reply_enabled ?? false
      });

      await this.database.updateConversationStatus(conversationId, 'processing');
      await this.agentMemoryService.upsertMicroIntentionForMessage(enrichedMessage);
      await this.agentMemoryService.maybeFlushDurableContext(enrichedMessage, {
        conversationId,
        traceId
      });

      // 构建群聊消息上下文（前20条消息）
      const contextStartTime = new Date();
      if (traceId) {
        await this.loggingService.logEventStart(traceId, 'context', 'context.build', conversationId, {
          message_type: enrichedMessage.message_type,
          group_id: enrichedMessage.group_id,
          user_id: enrichedMessage.user_id
        });
      }
      const messageContext = await this.contextManager.buildMessageContext(enrichedMessage, 20);
      if (traceId) {
        await this.loggingService.logEventEnd(traceId, 'context', 'context.build', contextStartTime, conversationId, {
          history_count: messageContext.historyMessages.length,
          has_group_info: !!messageContext.groupInfo
        });
      }

      this.moduleLogger.info('Group message context built', {
        traceId,
        historyCount: messageContext.historyMessages.length,
        hasGroupInfo: !!messageContext.groupInfo,
        groupId: enrichedMessage.group_id
      });

      // Stage 1: Use DecisionEngine for group message decisions
      const decisionStartTime = new Date();
      if (traceId) {
        await this.loggingService.logEventStart(traceId, 'decision', 'decision.analyze', conversationId, {
          message_type: enrichedMessage.message_type,
          group_id: enrichedMessage.group_id,
          user_id: enrichedMessage.user_id
        });
      }
      const decision = await this.decisionEngine.analyzeMessage(messageContext, traceId);
      if (traceId) {
        await this.loggingService.logEventEnd(traceId, 'decision', 'decision.analyze', decisionStartTime, conversationId, {
          should_respond: decision.shouldRespond,
          reason: decision.reason,
          confidence: decision.confidence
        });
      }

      this.moduleLogger.info('Group message decision engine result', {
        shouldRespond: decision.shouldRespond,
        confidence: decision.confidence,
        reason: decision.reason,
        attentionLevel: decision.attentionLevel,
        attentionReason: decision.attentionReason,
        suggestedNextStep: decision.suggestedNextStep,
        groupId: enrichedMessage.group_id,
        userId: enrichedMessage.user_id
      });

      // If decision engine says don't respond, update conversation status and exit
      if (!decision.shouldRespond) {
        this.moduleLogger.info('Decision engine determined not to respond to group message', {
          groupId: enrichedMessage.group_id,
          userId: enrichedMessage.user_id,
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
      if (enrichedMessage.group_id) {
        await this.database.updateGroupActivity(enrichedMessage.group_id, 1, 0);
      }

      // Stage 1: Enhanced AI conversation for group messages
      const sessionContext = await this.sessionManager.processIncomingMessage(enrichedMessage);
      await this.database.updateConversationSession(conversationId, sessionContext.session_id);
      await this.handleEnhancedAIConversation(
        enrichedMessage.user_id,
        cleanMessage,
        enrichedMessage,
        messageContext,
        sessionContext.session_id,
        traceId,
        conversationId // 🔥 FIX: Pass conversationId for error handling
      );

    } catch (error) {
      this.moduleLogger.error('Error processing group message', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        groupId: baseEnrichedMessage.group_id,
        userId: baseEnrichedMessage.user_id,
        conversationId,
        messagePreview: typeof baseEnrichedMessage.message === 'string'
          ? baseEnrichedMessage.message.substring(0, 50)
          : JSON.stringify(baseEnrichedMessage.message)?.substring(0, 50)
      });

      // 更新conversation状态为失败
      await this.database.updateConversationStatus(
        conversationId,
        'failed',
        `Processing error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async recordFilteredInboundMessage(
    message: QQMessage,
    traceId: string,
    errorReason: string
  ): Promise<void> {
    const enrichedMessage = this.enrichIncomingMessage(message);
    const filteredConversation: ConversationData = {
      id: uuidv4(),
      trace_id: traceId,
      user_id: enrichedMessage.user_id,
      group_id: enrichedMessage.group_id,
      user_message: this.formatMessageForConversation(enrichedMessage),
      timestamp: new Date(),
      response_time: 0,
      raw_request: JSON.stringify(enrichedMessage),
      status: 'filtered_disabled',
      error_reason: errorReason,
      ...this.buildConversationThreadingFields(enrichedMessage),
      created_at: new Date(),
      updated_at: new Date()
    };

    await this.database.saveConversation(filteredConversation);
  }

  private async shouldReceiveIncomingMessage(
    message: QQMessage
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (message.message_type === 'group' && message.group_id) {
      const groupSettings = await this.database.getGroupChatSettingById(message.group_id);
      if (groupSettings && !groupSettings.is_enabled) {
        return { allowed: false, reason: 'Group chat receiving disabled' };
      }
      return { allowed: true };
    }

    const privateChatSettings = await this.database.getPrivateChatSettingById(message.user_id);
    if (privateChatSettings && !privateChatSettings.is_enabled) {
      return { allowed: false, reason: 'Private chat receiving disabled' };
    }

    return { allowed: true };
  }

  private async handlePrivateMessage(message: QQMessage, eventData?: any): Promise<void> {
    const traceId = eventData?.traceId || `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const receiveDecision = await this.shouldReceiveIncomingMessage(message);
    if (!receiveDecision.allowed) {
      await this.recordFilteredInboundMessage(message, traceId, receiveDecision.reason || 'Private chat receiving disabled');
      this.moduleLogger.debug('Skipped private message before enqueue', {
        traceId,
        userId: message.user_id,
        reason: receiveDecision.reason
      });
      return;
    }

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

    const receiveDecision = await this.shouldReceiveIncomingMessage(message);
    if (!receiveDecision.allowed) {
      await this.recordFilteredInboundMessage(message, traceId, receiveDecision.reason || 'Group chat receiving disabled');
      this.moduleLogger.debug('Skipped group message before enqueue', {
        traceId,
        groupId: message.group_id,
        userId: message.user_id,
        reason: receiveDecision.reason
      });
      return;
    }

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
        auto_reply_enabled: false,
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

  private formatMessageForConversation(
    message: QQMessage,
    fallbackText?: string
  ): string {
    const baseText = this.resolveMessageBaseText(message, fallbackText);
    const attachments = resolveAttachmentsFromMessage(message);
    const attachmentHints = buildAttachmentHints(attachments);

    const parts = [baseText, ...attachmentHints].filter(
      part => typeof part === 'string' && part.trim().length > 0
    );

    return parts.join(' ').trim();
  }

  private resolveMessageBaseText(
    message: QQMessage,
    providedText?: string
  ): string {
    if (typeof providedText === 'string' && providedText.trim().length > 0) {
      return providedText.trim();
    }

    if (typeof message.normalized_text === 'string' && message.normalized_text.trim().length > 0) {
      return message.normalized_text.trim();
    }

    return extractNormalizedMessageText(message);
  }

  private enrichIncomingMessage(
    message: QQMessage,
    normalizedText?: string
  ): QQMessage {
    const safeNormalizedText = typeof normalizedText === 'string' && normalizedText.trim().length > 0
      ? normalizedText.trim()
      : extractNormalizedMessageText(message);

    return {
      ...message,
      normalized_text: safeNormalizedText || undefined,
      reply_intent_context: message.reply_intent_context || parseReplyIntentContext(message)
    };
  }

  private buildConversationThreadingFields(
    message: QQMessage
  ): Pick<ConversationData, 'message_id' | 'reply_to_message_id' | 'reply_to_text'> {
    return {
      message_id: message.message_id,
      reply_to_message_id: message.reply_intent_context?.semantic_anchor.message_id,
      reply_to_text: message.reply_intent_context?.semantic_anchor.text
    };
  }

  private async recordReplyAnchorObservation(
    message: QQMessage,
    conversationId: string,
    traceId?: string
  ): Promise<void> {
    const replyIntent = message.reply_intent_context;
    if (!replyIntent?.semantic_anchor?.message_id) {
      return;
    }

    const occurredAt = typeof message.time === 'number'
      ? new Date(message.time * 1000)
      : new Date();

    try {
      await this.database.saveAgentObservation({
        trace_id: traceId ?? null,
        conversation_id: conversationId,
        source_type: 'reply_anchor',
        field_scope: message.message_type === 'group' ? 'group_chat' : 'private_chat',
        message_type: message.message_type,
        user_id: message.user_id,
        group_id: message.group_id ?? null,
        subject_user_id: replyIntent.semantic_anchor.sender_id ?? replyIntent.address_target.user_id ?? null,
        counterparty_ids: [message.user_id],
        content: `Reply anchor #${replyIntent.semantic_anchor.message_id}: ${replyIntent.semantic_anchor.text || replyIntent.interpretation}`,
        raw_payload: replyIntent,
        occurred_at: occurredAt
      });
    } catch (error) {
      this.moduleLogger.warn('Failed to record reply anchor observation', {
        conversationId,
        messageId: message.message_id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async updateBeliefsFromIncomingMessage(message: QQMessage): Promise<void> {
    const candidates = extractBeliefCandidatesFromMessage(message);
    if (candidates.length === 0) {
      return;
    }

    const evidenceOccurredAt = typeof message.time === 'number'
      ? new Date(message.time * 1000)
      : new Date();

    try {
      const recentObservations = await this.database.getRecentAgentObservations(5);
      const incomingObservation = recentObservations.find(observation =>
        observation.source_type === 'incoming_message' &&
        observation.user_id === message.user_id &&
        observation.occurred_at.getTime() <= evidenceOccurredAt.getTime() + 1000
      );

      for (const candidate of candidates) {
        const beliefId = await this.database.upsertAgentBelief({
          subject_type: candidate.subject_type,
          subject_id: candidate.subject_id,
          belief_type: candidate.belief_type,
          belief_key: candidate.belief_key,
          claim: candidate.claim,
          normalized_claim: candidate.normalized_claim,
          polarity: candidate.polarity,
          confidence: candidate.confidence,
          status: 'active',
          observation_count: 1,
          last_evidence_id: incomingObservation?.id ?? null,
          first_observed_at: evidenceOccurredAt,
          last_observed_at: evidenceOccurredAt
        });

        await this.agentMemoryService.maybePromoteBelief(beliefId, {
          evidenceObservationId: incomingObservation?.id ?? null
        });
      }
    } catch (error) {
      this.moduleLogger.warn('Failed to update beliefs from incoming message', {
        userId: message.user_id,
        messageId: message.message_id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
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
      
      // 新目标默认接收开启、自动回复关闭
      const isEnabled = groupSetting ? (groupSetting.is_enabled && groupSetting.auto_reply_enabled) : false;
      
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
    this.humanLikeConfigService.invalidateAll();
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
      promptName: resolvedPromptName || config.name || 'basic_chat',
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
      const isToolDrivenChat = this.isToolDrivenChatAgent(promptAgentType);

      if (isToolDrivenChat && !this.enableLLMTools) {
        throw new Error('chat_bot requires loop function calling, but ENABLE_LLM_TOOLS is disabled');
      }

      const contextPrompt = await this.contextManager.formatContextForAI(
        messageContext,
        userMessage
      );
      const fullPromptParts = contextPrompt.parts.length > 0
        ? contextPrompt.parts
        : [{ text: userMessage }];
      const fullPromptText =
        contextPrompt.plainText && contextPrompt.plainText.length > 0
          ? contextPrompt.plainText
          : userMessage;

      // 🛠️ 如果启用工具系统，使用 LLMJob 异步处理
      if (this.enableLLMTools) {
        const sourceKey = originalMessage.message_type === 'group'
          ? `group_${originalMessage.group_id}`
          : `user_${userId}`;

        const sourceType = originalMessage.message_type === 'group' ? 'group' : 'private';
        const contents = [
          {
            role: 'user',
            parts: fullPromptParts
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

        // 🔥 添加 thinkingConfig 支持（放在顶层，供 buildGenerateContentConfigFromRequest 使用）
        if (promptConfig.thinking) {
          jobConfig.thinkingConfig = promptConfig.thinking;
        }

        if (promptConfig.model?.name) {
          jobConfig.model = { name: promptConfig.model.name };
        }

        const chatLoopProtocolInstruction = isToolDrivenChat
          ? this.buildChatLoopProtocolInstruction(
              originalMessage.message_type,
              originalMessage.reply_intent_context
            )
          : '';
        const mergedSystemInstruction = [
          promptConfig.context.systemInstruction,
          chatLoopProtocolInstruction
        ]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .join('\n\n');

        if (mergedSystemInstruction) {
          jobConfig.systemInstruction = {
            role: 'system',
            parts: [{ text: mergedSystemInstruction }]
          };
        }

        const sanitizeSchema = (schema: any): any => {
          if (!schema || typeof schema !== 'object') {
            return schema;
          }

          if (Array.isArray(schema)) {
            return schema.map(item => sanitizeSchema(item));
          }

          const cloned: Record<string, any> = { ...schema };
          if (Object.prototype.hasOwnProperty.call(cloned, 'additionalProperties')) {
            delete cloned.additionalProperties;
          }

          if (cloned.properties && typeof cloned.properties === 'object') {
            cloned.properties = Object.entries(cloned.properties).reduce<Record<string, any>>(
              (acc, [key, value]) => {
                acc[key] = sanitizeSchema(value);
                return acc;
              },
              {}
            );
          }

          if (cloned.items) {
            cloned.items = sanitizeSchema(cloned.items);
          }

          if (cloned.anyOf) {
            cloned.anyOf = cloned.anyOf.map((item: any) => sanitizeSchema(item));
          }

          if (cloned.oneOf) {
            cloned.oneOf = cloned.oneOf.map((item: any) => sanitizeSchema(item));
          }

          if (cloned.allOf) {
            cloned.allOf = cloned.allOf.map((item: any) => sanitizeSchema(item));
          }

          return cloned;
        };

        const customTools = [...(promptConfig.tools?.customTools || [])];
        if (isToolDrivenChat) {
          const existingNames = new Set(
            customTools
              .map((tool: any) => tool?.name || tool?.id)
              .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
          );

          this.getImplicitChatToolNames(originalMessage.message_type).forEach(toolName => {
            if (existingNames.has(toolName)) {
              return;
            }

            customTools.push({
              id: toolName,
              name: toolName,
              description: '',
              parameters: {
                type: 'object',
                properties: {},
                required: []
              }
            });
          });
        }
        const staticToolDeclarations = this.functionCallDispatcher
          .getStaticToolDeclarations()
          .reduce<Record<string, { description?: string; parameters?: any }>>((acc, decl) => {
            if (decl && typeof decl === 'object' && decl.name) {
              acc[decl.name] = {
                description: decl.description,
                parameters: decl.parameters
              };
            }
            return acc;
          }, {});
        const functionNameToId: Record<string, string> = {};
        const functionDeclarations = customTools
          .map(tool => {
            const id = typeof tool.id === 'string' ? tool.id : (typeof tool.name === 'string' ? tool.name : undefined);
            const name = tool.name || tool.id;
            if (!name) {
              return null;
            }
            if (id) {
              functionNameToId[name] = id;
            }
            const staticOverride = staticToolDeclarations[name];
            const description = staticOverride?.description || tool.description || '';
            const parameters = staticOverride?.parameters
              ? sanitizeSchema(staticOverride.parameters)
              : tool.parameters
                ? sanitizeSchema(tool.parameters)
                : undefined;

            const declaration: any = {
              name,
              description
            };

            // 只有当 parameters 存在时才添加该字段
            if (parameters !== undefined) {
              declaration.parameters = parameters;
            }

            return declaration;
          })
          .filter(Boolean) as Array<{ name: string; description: string; parameters?: any }>;

        if (functionDeclarations.length > 0) {
          jobConfig.tools = functionDeclarations;

          const rawFunctionCallingMode = promptConfig.tools?.functionCalling?.mode;
          const normalizedFunctionCallingMode = (() => {
            if (typeof rawFunctionCallingMode !== 'string') {
              return 'ANY';
            }

            const upper = rawFunctionCallingMode.toUpperCase();
            const allowedModes = new Set(['AUTO', 'ANY', 'NONE']);
            return allowedModes.has(upper) ? upper : 'ANY';
          })();
          const allowedNames = promptConfig.tools?.functionCalling?.allowedFunctionNames
            || functionDeclarations.map(item => item.name);
          const allowedIds =
            promptConfig.tools?.functionCalling?.allowedFunctionIds
              || Object.values(functionNameToId);

          const functionCallingConfig: FunctionCallingConfig = {
            mode: isToolDrivenChat
              ? 'AUTO'
              : normalizedFunctionCallingMode as FunctionCallingMode,
            allowedFunctionIds: allowedIds
          };

          if (
            normalizedFunctionCallingMode === 'ANY'
            && Array.isArray(allowedNames)
            && allowedNames.length > 0
          ) {
            functionCallingConfig.allowedFunctionNames = allowedNames;
          }

          jobConfig.toolConfig = {
            functionCallingConfig
          };
        }

        const jobMetadata: Record<string, any> = {
          conversationId,
          userId,
          groupId: originalMessage.group_id,
          sessionId,
          messageId: originalMessage.message_id,
          messageType: originalMessage.message_type,
          promptId: promptId || null,
          promptName,
          agentType: promptAgentType,
          modelName: promptConfig.model?.name || null,
          chatViewport: contextPrompt.chatViewport || null,
          replyIntentContext: originalMessage.reply_intent_context || messageContext.replyIntentContext || null,
          replyToMessageId: originalMessage.reply_intent_context?.semantic_anchor.message_id || null,
          replyAnchorViewport: null
        };

        if (functionDeclarations.length > 0) {
          jobMetadata.functionNameToId = functionNameToId;
          jobMetadata.functionCallingMode = promptConfig.tools?.functionCalling?.mode || 'AUTO';
        }

        // 创建 LLM Job
        const jobId = await this.llmJobWorker.createJob({
          traceId: traceId || `trace-${Date.now()}`,
          sourceKey,
          sourceType,
          contents,
          tools: functionDeclarations,
          config: jobConfig,
          metadata: jobMetadata
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
      if (isToolDrivenChat) {
        throw new Error('chat_bot must run through LLM loop jobs');
      }

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
        fullPromptText,
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

      const sendTimestamp = new Date();
      const rawPayload: Record<string, any> = {
        message: finalResponse
      };

      if (shouldSendReply && originalMessage.message_id) {
        rawPayload.reply_to = originalMessage.message_id;
      }

      const baseSendOptions = {
        conversationId: conversationId ?? undefined,
        rawPayload,
        sentAt: sendTimestamp
      };

      if (originalMessage.message_type === 'group' && originalMessage.group_id) {
        // 第3层：检查群聊自动回复是否开启（auto_reply_enabled）
        const groupSettings = cachedGroupSettings ?? await this.database.getGroupChatSettingById(originalMessage.group_id);
        cachedGroupSettings = groupSettings;
        if (!isAutoReplyAllowed(groupSettings)) {
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
            finalResponse,
            {
              ...baseSendOptions,
              groupId: originalMessage.group_id
            }
          );
        } else {
          await this.websocketClient.sendGroupMessage(
            originalMessage.group_id,
            finalResponse,
            baseSendOptions
          );
        }
      } else {
        // 第3层：检查私聊自动回复是否开启（auto_reply_enabled）
        const privateChatSettings = cachedPrivateSettings ?? await this.database.getPrivateChatSettingById(userId);
        cachedPrivateSettings = privateChatSettings;
        if (!isAutoReplyAllowed(privateChatSettings)) {
          this.moduleLogger.debug('Private chat auto reply disabled, skipping message send', { 
            user_id: userId 
          });
          return; // 不发送回复，但LLM处理已完成并记录
        }
        
        if (shouldSendReply && originalMessage.message_id) {
          await this.websocketClient.sendReplyMessage(
            originalMessage.message_id,
            finalResponse,
            {
              ...baseSendOptions,
              userId
            }
          );
        } else {
          await this.websocketClient.sendPrivateMessage(
            userId,
            finalResponse,
            baseSendOptions
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

  private async runBackgroundCognitionTasks(): Promise<void> {
    await this.agentMemoryService.runScheduledReflectionsIfDue();

    const proactivityState = await this.agentMemoryService.getProactivityControls(
      this.getProactivityDefaults()
    );

    if (!proactivityState.followupEnabled || proactivityState.isPaused) {
      return;
    }

    const execution = await this.agentMemoryService.executeDueFollowupPlans({
      now: new Date(),
      limit: proactivityState.maxPerRun,
      retryDelayMs: proactivityState.retryDelayMs,
      canSendToUser: async (userId) => {
        if (
          proactivityState.allowedUserIds.length > 0 &&
          !proactivityState.allowedUserIds.includes(userId)
        ) {
          return { allowed: false, reason: 'user_not_allowed' };
        }

        const privateChatSettings = await this.database.getPrivateChatSettingById(userId);
        if (!privateChatSettings) {
          return { allowed: false, reason: 'missing_private_chat_settings' };
        }

        if (
          !isDbBooleanEnabled(privateChatSettings.is_enabled) ||
          !isDbBooleanEnabled(privateChatSettings.auto_reply_enabled)
        ) {
          return { allowed: false, reason: 'auto_reply_disabled' };
        }

        return { allowed: true };
      },
      sendPrivateMessage: async (userId, message, plan) => {
        const traceId = uuidv4();
        const metadata = {
          source_plan_id: plan.id,
          plan_type: plan.plan_type,
          goal: plan.goal,
          trigger_kind: 'followup_queue',
          proactive: true
        };
        await this.websocketClient.waitUntilConnected();
        await this.websocketClient.sendPrivateMessage(userId, message, {
          traceId,
          rawPayload: metadata
        });
        await this.loggingService.logInstantEvent(
          traceId,
          'agent',
          'followup.executed',
          undefined,
          {
            userId,
            planId: plan.id,
            goal: plan.goal
          }
        );
      }
    });

    if (execution.processed > 0) {
      this.moduleLogger.info('Processed followup queue background task', execution);
    }
  }

  private parseAllowedUserIds(rawValue?: string): Set<number> {
    if (!rawValue || rawValue.trim().length === 0) {
      return new Set();
    }

    return new Set(
      rawValue
        .split(',')
        .map(value => Number(value.trim()))
        .filter(value => Number.isFinite(value) && value > 0)
    );
  }

  private getProactivityDefaults(): AgentProactivityRuntimeConfig {
    return {
      followupEnabled: this.proactiveFollowupEnabled,
      isPaused: false,
      allowedUserIds: Array.from(this.proactiveFollowupAllowedUserIds),
      maxPerRun: this.proactiveFollowupMaxPerRun,
      retryDelayMs: this.proactiveFollowupRetryDelayMs
    };
  }

  private extractDisconnectReason(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') {
      return 'WebSocket disconnected';
    }

    const reason =
      'reason' in data && typeof data.reason === 'string'
        ? data.reason
        : undefined;
    const code =
      'code' in data && typeof data.code === 'number'
        ? data.code
        : undefined;

    if (code !== undefined && reason) {
      return `WebSocket disconnected (${code}: ${reason})`;
    }
    if (code !== undefined) {
      return `WebSocket disconnected (${code})`;
    }
    return reason ?? 'WebSocket disconnected';
  }

  private async persistRuntimeStatus(
    status: 'online' | 'offline' | 'error',
    errorMessage?: string
  ): Promise<void> {
    try {
      await this.database.updateBotStatus(
        config.ai.bot_qq_number.toString(),
        status,
        this.websocketConnected,
        this.httpServerStarted,
        errorMessage
      );
    } catch (error) {
      this.moduleLogger.error('Failed to persist bot runtime status', {
        error,
        status,
        websocketConnected: this.websocketConnected,
        httpServerStarted: this.httpServerStarted,
        errorMessage
      });
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

      this.websocketConnected = false;
      this.httpServerStarted = false;

      // 更新机器人状态
      await this.persistRuntimeStatus('offline');

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

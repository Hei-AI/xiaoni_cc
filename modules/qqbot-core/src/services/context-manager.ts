import { DatabaseManager } from './database';
import {
  ChatViewportData,
  ChatViewportCursor,
  QQMessage,
  ContextHistoryMessage,
  MessageContext,
  GroupMessageHistoryRecord,
  PrivateMessageHistoryRecord,
  OB11Segment,
  MessageAttachment,
  ReplyIntentContext
} from '../types';
import { logger } from '../utils/logger';
import { ChatViewportService } from './chat-viewport-service';
import AgentMemoryService from './agent-memory-service';
import {
  buildAttachmentHints,
  extractTextFromSegments,
  resolveAttachmentsFromMessage,
  resolveAttachmentViewsFromMessage
} from '../utils/message-utils';
import { extractNormalizedMessageText, parseReplyIntentContext } from '../utils/reply-intent';
import type { Part } from '@google/genai';
import sharp from 'sharp';

export type GeminiContentPart = Part;

export interface FormattedContextPrompt {
  parts: GeminiContentPart[];
  plainText: string;
  chatViewport?: ChatViewportCursor;
}

type PromptMessageType = 'text' | 'image';

interface PromptAttachment {
  type: 'image';
  mimeType: string;
  data: string;
}

interface PromptMessageEntry {
  qq_id: string;
  user_nick: string;
  message_type: PromptMessageType;
  context?: string;
  at_qq_id: Array<{ qq_id: string; nick_name: string }>;
  received_time: string;
}

interface PromptMessageWithAttachments {
  entry: PromptMessageEntry;
  attachments: PromptAttachment[];
}

/**
 * 上下文管理器
 * 负责获取和处理消息上下文，为AI决策提供背景信息
 */
export class ContextManager {
  private database: DatabaseManager;
  private chatViewportService: ChatViewportService;
  private agentMemoryService: AgentMemoryService;
  private moduleLogger = logger.createModuleLogger('context-manager');

  constructor(
    database: DatabaseManager,
    chatViewportService?: ChatViewportService,
    agentMemoryService?: AgentMemoryService
  ) {
    this.database = database;
    this.chatViewportService = chatViewportService || new ChatViewportService(database);
    this.agentMemoryService = agentMemoryService || new AgentMemoryService(database);
  }

  private async buildHistoryMessages(
    message: QQMessage,
    limit: number
  ): Promise<ContextHistoryMessage[]> {
    try {
      if (message.message_type === 'private') {
        const records = await this.database.getPrivateMessageHistoryRecords(
          message.user_id,
          limit
        );
        return records
          .filter(record => !this.isCurrentMessageRecord(record.message_id, message.message_id))
          .map(record => this.transformPrivateHistoryRecord(record));
      }

      if (message.message_type === 'group' && message.group_id) {
        const records = await this.database.getGroupMessageHistoryRecords(
          message.group_id,
          limit
        );
        return records
          .filter(record => !this.isCurrentMessageRecord(record.message_id, message.message_id))
          .map(record => this.transformGroupHistoryRecord(record));
      }

      return [];
    } catch (error) {
      this.moduleLogger.warn('Failed to build history messages from database', {
        error: error instanceof Error ? error.message : 'Unknown error',
        messageType: message.message_type,
        userId: message.user_id,
        groupId: message.group_id
      });
      return [];
    }
  }

  /**
   * 构建消息上下文
   * @param message 当前消息
   * @param contextLimit 上下文消息数量限制
   * @returns 完整的消息上下文对象
   */
  public async buildMessageContext(
    message: QQMessage, 
    contextLimit: number = 20
  ): Promise<MessageContext> {
    try {
      this.moduleLogger.info('Building message context', {
        messageType: message.message_type,
        userId: message.user_id,
        groupId: message.group_id,
        contextLimit
      });

      // 获取历史消息
      this.moduleLogger.info('Step 1: Getting history messages...');
      
      const historyMessages = await this.buildHistoryMessages(message, contextLimit);
      this.moduleLogger.info('Step 1 completed: Got history messages', { count: historyMessages.length });

      // 生成上下文摘要
      this.moduleLogger.info('Step 2: Generating context summary...');
      const contextSummary = this.generateContextSummary(message, historyMessages);
      this.moduleLogger.info('Step 2 completed: Generated context summary', { summaryLength: contextSummary.length });

      // 构建用户信息
      this.moduleLogger.info('Step 3: Building user info...');
      const userInfo = await this.buildUserInfo(message.user_id);
      this.moduleLogger.info('Step 3 completed: Built user info', { hasUserInfo: !!userInfo });

      this.moduleLogger.info('Step 3.5: Building cognition context...');
      const [selfModel, relationshipContext, activePlans, retrievedStableMemories] = await Promise.all([
        this.agentMemoryService.getCurrentSelfModel(),
        this.agentMemoryService.getRelationshipContextForMessage(message),
        this.agentMemoryService.getActivePlansForMessage(message, 3),
        this.agentMemoryService.getRetrievedMemoriesForMessage(message, 6)
      ]);
      const recentEvidence = await this.agentMemoryService.getRecentEvidenceForMessage(
        message,
        retrievedStableMemories.map(memory => memory.id),
        4
      );
      const internalState = {
        availability: selfModel?.availability ?? 'unknown',
        energy: selfModel?.energy ?? 'unknown',
        current_concerns: selfModel?.current_concerns ?? []
      };
      this.moduleLogger.info('Step 3.5 completed: Built cognition context', {
        hasSelfModel: !!selfModel,
        hasRelationshipContext: !!relationshipContext,
        activePlans: activePlans.length,
        retrievedStableMemories: retrievedStableMemories.length,
        recentEvidence: recentEvidence.length
      });

      // 构建群聊信息（如果是群聊）
      if (message.group_id) {
        this.moduleLogger.info('Step 4: Building group info...');
        const groupInfo = await this.buildGroupInfo(message.group_id);
        this.moduleLogger.info('Step 4 completed: Built group info', { hasGroupInfo: !!groupInfo });
        
        const context: MessageContext = {
          currentMessage: message,
          historyMessages,
          contextSummary,
          replyIntentContext: message.reply_intent_context,
          selfModel,
          internalState,
          relationshipContext,
          activePlans,
          retrievedStableMemories,
          recentEvidence,
          userInfo,
          groupInfo
        };

        this.moduleLogger.info('Message context built successfully (with group)', {
          historyCount: historyMessages.length,
          hasSummary: !!contextSummary,
          hasUserInfo: !!userInfo,
          hasGroupInfo: !!groupInfo
        });

        return context;
      } else {
        this.moduleLogger.info('Step 4: Skipping group info (private message)');
        
        const context: MessageContext = {
          currentMessage: message,
          historyMessages,
          contextSummary,
          replyIntentContext: message.reply_intent_context,
          selfModel,
          internalState,
          relationshipContext,
          activePlans,
          retrievedStableMemories,
          recentEvidence,
          userInfo,
          groupInfo: undefined
        };

        this.moduleLogger.info('Message context built successfully (private)', {
          historyCount: historyMessages.length,
          hasSummary: !!contextSummary,
          hasUserInfo: !!userInfo,
          hasGroupInfo: false
        });

        return context;
      }

    } catch (error) {
      this.moduleLogger.error('Failed to build message context', {
        error,
        messageId: message.message_id,
        userId: message.user_id
      });

      // 返回最小上下文
      return {
        currentMessage: message,
        historyMessages: [],
        contextSummary: '无可用上下文信息',
        replyIntentContext: message.reply_intent_context,
        activePlans: [],
        retrievedStableMemories: [],
        recentEvidence: []
      };
    }
  }

  /**
   * 生成上下文摘要
   * @param currentMessage 当前消息
   * @param historyMessages 历史消息
   * @returns 上下文摘要文本
   */
  private generateContextSummary(
    currentMessage: QQMessage,
    historyMessages: ContextHistoryMessage[]
  ): string {
    if (historyMessages.length === 0) {
      return `用户${currentMessage.sender?.nickname || `用户${currentMessage.user_id}`}发起了新对话`;
    }

    const recentCount = Math.min(historyMessages.length, 5);
    const recentMessages = historyMessages.slice(-recentCount);

    let summary = `最近${recentCount}条对话:\n`;

    recentMessages.forEach((msg, index) => {
      const time = this.toIsoString(msg.sent_at);
      const roleLabel = msg.sender_role === 'bot' ? '机器人' : '用户';
      const content = this.truncateMessage(msg.content, 50);
      summary += `${index + 1}. [${time ?? ''}] ${roleLabel}: ${content}\n`;
    });

    return summary.trimEnd();
  }

  /**
   * 构建用户信息
   * @param userId 用户ID
   * @returns 用户信息对象
   */
  private async buildUserInfo(userId: number): Promise<MessageContext['userInfo']> {
    try {
      this.moduleLogger.info('buildUserInfo: Starting query for user stats', { userId });
      
      // 获取用户的历史消息统计
      const userStats = await this.database.executeQuery(
        'SELECT COUNT(*) as message_count FROM conversations WHERE user_id = ?',
        [userId]
      );

      this.moduleLogger.info('buildUserInfo: Query completed', { 
        userId, 
        resultsLength: userStats.length,
        firstResult: userStats[0]
      });

      const messageCount = userStats[0]?.message_count || 0;

      const result = {
        user_id: userId,
        nickname: '用户', // 这里可以从消息中获取
        message_count: messageCount
      };

      this.moduleLogger.info('buildUserInfo: Built user info successfully', { result });
      return result;
    } catch (error) {
      this.moduleLogger.error('buildUserInfo: Failed to build user info', { error, userId });
      return undefined;
    }
  }

  /**
   * 构建群聊信息
   * @param groupId 群ID
   * @returns 群聊信息对象
   */
  private async buildGroupInfo(groupId: number): Promise<MessageContext['groupInfo']> {
    try {
      // 获取群聊的历史消息统计
      const groupStats = await this.database.executeQuery(
        `SELECT COUNT(*) as message_count FROM conversations 
         WHERE JSON_EXTRACT(raw_request, '$.group_id') = ? 
           AND JSON_EXTRACT(raw_request, '$.message_type') = 'group'`,
        [groupId]
      );

      const messageCount = groupStats[0]?.message_count || 0;

      return {
        group_id: groupId,
        message_count: messageCount
      };
    } catch (error) {
      this.moduleLogger.warn('Failed to build group info', { error, groupId });
      return undefined;
    }
  }

  /**
   * 截断长消息
   * @param message 消息内容
   * @param maxLength 最大长度
   * @returns 截断后的消息
   */
  private truncateMessage(message: string, maxLength: number): string {
    if (!message) return '';
    return message.length > maxLength 
      ? message.substring(0, maxLength) + '...' 
      : message;
  }

  /**
   * 格式化上下文为AI Prompt
   * @param context 消息上下文
   * @returns 格式化后的prompt文本
   */
  public async formatContextForAI(
    context: MessageContext,
    currentUserInput?: string
  ): Promise<FormattedContextPrompt> {
    try {
      const viewport = await this.chatViewportService.buildViewportForMessage(
        context.currentMessage
      );
      return await this.buildViewportPrompt(
        context,
        viewport,
        context.currentMessage,
        currentUserInput,
        context.replyIntentContext || context.currentMessage.reply_intent_context
      );
    } catch (error) {
      this.moduleLogger.warn('Failed to build chat viewport, falling back to legacy context prompt', {
        error: error instanceof Error ? error.message : String(error),
        messageId: context.currentMessage.message_id,
        messageType: context.currentMessage.message_type
      });
    }

    return this.buildLegacyPrompt(context, currentUserInput);
  }

  private async buildLegacyPrompt(
    context: MessageContext,
    currentUserInput?: string
  ): Promise<FormattedContextPrompt> {
    const nicknameMap = new Map<number, string>();

    if (context.userInfo) {
      nicknameMap.set(
        context.userInfo.user_id,
        context.userInfo.nickname || `用户${context.userInfo.user_id}`
      );
    }

    context.historyMessages.forEach(historyMessage => {
      const profile = this.extractSenderProfileFromHistory(historyMessage);
      if (profile.userId) {
        const resolvedNickname =
          profile.nickname || `用户${profile.userId}`;
        nicknameMap.set(profile.userId, resolvedNickname);
      }
    });

    const currentSenderProfile = this.extractSenderProfileFromMessage(
      context.currentMessage
    );

    if (currentSenderProfile.userId) {
      const currentNickname =
        currentSenderProfile.nickname ||
        context.currentMessage.sender?.nickname ||
        `用户${currentSenderProfile.userId}`;
      nicknameMap.set(currentSenderProfile.userId, currentNickname);
    }

    const parts: GeminiContentPart[] = [];
    const textFragments: string[] = [];

    const appendTextPart = (text: string) => {
      const normalized = typeof text === 'string' ? text : '';
      parts.push({ text: normalized });
      textFragments.push(normalized);
    };

    this.buildCognitiveSectionLines(context).forEach(line => appendTextPart(line));
    appendTextPart('======已读消息========');

    for (const historyMessage of context.historyMessages) {
      appendTextPart(this.renderHistoryMessageBlock(historyMessage, nicknameMap));
    }

    appendTextPart('=======未读消息======');

    this.appendCurrentMessageBlock(
      context.currentMessage,
      nicknameMap,
      currentUserInput,
      appendTextPart
    );

    const plainText = textFragments.join('\n').trim()
      || this.extractMessageText(context.currentMessage);

    return {
      parts,
      plainText
    };
  }

  private async buildViewportPrompt(
    context: MessageContext,
    viewport: ChatViewportData,
    currentMessage: QQMessage,
    currentUserInput?: string,
    replyIntentContext?: ReplyIntentContext
  ): Promise<FormattedContextPrompt> {
    const nicknameMap = new Map<number, string>();

    viewport.visible_messages.forEach(historyMessage => {
      const profile = this.extractSenderProfileFromHistory(historyMessage);
      if (profile.userId) {
        nicknameMap.set(profile.userId, profile.nickname || `用户${profile.userId}`);
      }
    });

    const parts: GeminiContentPart[] = [];
    const textFragments: string[] = [];

    const appendTextPart = (text: string) => {
      const normalized = typeof text === 'string' ? text : '';
      if (normalized.length === 0) {
        return;
      }
      parts.push({ text: normalized });
      textFragments.push(normalized);
    };

    this.buildCognitiveSectionLines(context).forEach(line => appendTextPart(line));

    viewport.header_lines.forEach(line => appendTextPart(line));

    for (const historyMessage of viewport.visible_messages) {
      if (this.isCurrentMessageRecord(historyMessage.message_id, currentMessage.message_id)) {
        continue;
      }

      if (
        viewport.divider_before_history_id
        && historyMessage.history_id === viewport.divider_before_history_id
      ) {
        appendTextPart('--- 以下是未读消息 ---');
      }

      appendTextPart(this.renderHistoryMessageBlock(historyMessage, nicknameMap));
    }

    this.appendCurrentMessageBlock(
      currentMessage,
      nicknameMap,
      currentUserInput,
      appendTextPart
    );

    const plainText = textFragments.join('\n').trim();

    return {
      parts,
      plainText,
      chatViewport: viewport.cursor
    };
  }

  private appendInteractionContextParts(
    replyIntentContext: ReplyIntentContext,
    appendTextPart: (text: string) => void
  ): void {
    const anchorText = replyIntentContext.semantic_anchor.text || '<unavailable>';
    const anchorSender = this.formatAddressTargetUser(
      replyIntentContext.semantic_anchor.sender_nickname,
      replyIntentContext.semantic_anchor.sender_id
    );
    const addressTarget = this.formatAddressTargetUser(
      replyIntentContext.address_target.nickname,
      replyIntentContext.address_target.user_id
    );

    appendTextPart('--- 回复线索 ---');
    appendTextPart(`当前消息包含 reply 锚点，引用消息 ID: ${replyIntentContext.semantic_anchor.message_id}`);
    if (anchorSender) {
      appendTextPart(`被引用发送者: ${anchorSender}`);
    }
    appendTextPart(`被引用内容摘要: ${anchorText}`);
    appendTextPart(`直接回应目标类型: ${replyIntentContext.address_target.type}`);
    if (addressTarget) {
      appendTextPart(`直接回应对象: ${addressTarget}`);
    }
  }

  private buildCognitiveSectionLines(context: MessageContext): string[] {
    const lines: string[] = [];
    const append = (value: string) => {
      if (value && value.trim().length > 0) {
        lines.push(value);
      }
    };

    append('--- Self Model ---');
    append(`identity_summary=${context.selfModel?.identity_summary || '尚未建立稳定自我模型'}`);
    if (context.selfModel?.core_traits && context.selfModel.core_traits.length > 0) {
      append(`core_traits=${context.selfModel.core_traits.join(' / ')}`);
    }
    if (context.selfModel?.long_term_goals && context.selfModel.long_term_goals.length > 0) {
      append(`long_term_goals=${context.selfModel.long_term_goals.join(' / ')}`);
    }

    append('--- Current Internal State ---');
    append(`availability=${context.internalState?.availability || 'unknown'}`);
    append(`energy=${context.internalState?.energy || 'unknown'}`);
    append(`current_concerns=${(context.internalState?.current_concerns || []).join(' / ') || 'none'}`);

    append('--- Relationship Context ---');
    append(`relationship_summary=${context.relationshipContext?.relationship_summary || '尚未建立稳定关系快照'}`);
    append(`interaction_style=${context.relationshipContext?.interaction_style || '默认顺势回应'}`);
    append(`boundary_strategy=${context.relationshipContext?.boundary_strategy || 'unknown'}`);
    append(`boundary_notes=${context.relationshipContext?.boundary_notes || 'none'}`);

    append('--- Active Plans ---');
    if (context.activePlans && context.activePlans.length > 0) {
      context.activePlans.forEach(plan => {
        append(`- [${plan.plan_type}/${plan.status}] ${plan.goal}`);
      });
    } else {
      append('- none');
    }

    append('--- Retrieved Stable Memories ---');
    if (context.retrievedStableMemories && context.retrievedStableMemories.length > 0) {
      context.retrievedStableMemories.forEach(memory => {
        append(`- [${memory.memory_type}/${memory.memory_scope}] ${this.truncateMessage(memory.content, 120)} (confidence=${memory.confidence.toFixed(2)}, salience=${memory.salience.toFixed(2)})`);
      });
    } else {
      append('- none');
    }

    append('--- Recent Evidence ---');
    if (context.recentEvidence && context.recentEvidence.length > 0) {
      context.recentEvidence.forEach(observation => {
        append(`- [${this.toIsoString(observation.occurred_at) || ''}/${observation.source_type}] ${this.truncateMessage(observation.content, 120)}`);
      });
    } else {
      append('- none');
    }

    return lines;
  }

  private appendCurrentMessageBlock(
    message: QQMessage,
    nicknameMap: Map<number, string>,
    currentUserInput: string | undefined,
    appendTextPart: (text: string) => void
  ): void {
    appendTextPart('--- 当前消息 ---');
    appendTextPart(this.renderCurrentMessageBlock(message, nicknameMap, currentUserInput));

    const replyIntentContext = message.reply_intent_context;
    if (replyIntentContext) {
      appendTextPart(this.renderCurrentMessageReplyIntentBlock(replyIntentContext));
    }
  }

  private renderHistoryMessageBlock(
    historyMessage: ContextHistoryMessage,
    nicknameMap: Map<number, string>
  ): string {
    const senderProfile = this.extractSenderProfileFromHistory(historyMessage);
    const senderId = senderProfile.userId ?? historyMessage.sender_id;
    const senderName = historyMessage.sender_role === 'bot'
      ? '我'
      : this.resolveNickname(senderId, senderProfile.nickname, nicknameMap);
    const { payload, fallbackText } = this.extractHistoryPayload(historyMessage);
    const mentions = this.extractMentionsFromPayload(payload, fallbackText, nicknameMap);
    const rawMessage = this.extractHistoryRawMessage(historyMessage);
    const attachmentViews = rawMessage
      ? resolveAttachmentViewsFromMessage(rawMessage)
      : [];
    const replyRef = rawMessage
      ? this.extractReplyRefFromMessageLike(rawMessage)
      : undefined;

    return this.renderMessageRecord({
      time: this.toIsoString(historyMessage.sent_at) ?? '',
      messageId: historyMessage.message_id,
      senderId,
      senderName,
      mentions: mentions.map(item => item.qq_id),
      contentType: this.resolveTranscriptContentType(
        this.extractTranscriptTextFromHistory(rawMessage, payload, fallbackText),
        attachmentViews
      ),
      text: this.extractTranscriptTextFromHistory(rawMessage, payload, fallbackText),
      attachments: attachmentViews,
      replyRef
    });
  }

  private renderCurrentMessageBlock(
    message: QQMessage,
    nicknameMap: Map<number, string>,
    currentUserInput?: string
  ): string {
    const senderProfile = this.extractSenderProfileFromMessage(message);
    const senderId = senderProfile.userId ?? message.user_id;
    const senderName = this.resolveNickname(
      senderId,
      senderProfile.nickname || message.sender?.nickname,
      nicknameMap
    );
    const transcriptText = this.extractTranscriptTextFromCurrentMessage(message, currentUserInput);
    const mentions = this.extractMentionsFromMessage(
      message,
      nicknameMap,
      transcriptText ?? currentUserInput
    );
    const attachmentViews = resolveAttachmentViewsFromMessage(message);
    const replyRef = this.extractReplyRefFromMessageLike(message);

    return this.renderMessageRecord({
      time: this.toIsoString(message.time ? message.time * 1000 : undefined) ?? '',
      messageId: message.message_id,
      senderId,
      senderName,
      mentions: mentions.map(item => item.qq_id),
      contentType: this.resolveTranscriptContentType(
        transcriptText,
        attachmentViews
      ),
      text: transcriptText,
      attachments: attachmentViews,
      replyRef
    });
  }

  private renderMessageRecord(params: {
    time: string;
    messageId?: number | null;
    senderId?: number;
    senderName?: string;
    mentions: string[];
    contentType: string;
    text?: string;
    attachments: Array<{
      attachment_id: number;
      type: string;
      label: string;
      mime_type?: string;
    }>;
    replyRef?: {
      message_id?: number;
      sender_id?: number;
      sender_name?: string;
      text?: string;
    };
  }): string {
    const lines = ['- message:'];
    lines.push(`  time=${params.time}`);
    if (params.messageId != null) {
      lines.push(`  message_id=${params.messageId}`);
    }
    if (params.senderId != null) {
      lines.push(`  sender_id=${params.senderId}`);
    }
    lines.push(`  sender_name=${params.senderName || '未知用户'}`);
    lines.push(`  mentions=${JSON.stringify(params.mentions)}`);
    if (params.replyRef?.message_id != null) {
      lines.push(`  reply_ref.message_id=${params.replyRef.message_id}`);
      if (params.replyRef.sender_id != null) {
        lines.push(`  reply_ref.sender_id=${params.replyRef.sender_id}`);
      }
      if (params.replyRef.sender_name) {
        lines.push(`  reply_ref.sender_name=${params.replyRef.sender_name}`);
      }
      if (params.replyRef.text) {
        lines.push(`  reply_ref.text=${params.replyRef.text}`);
      }
    }
    lines.push(`  content_type=${params.contentType}`);
    if (params.text) {
      lines.push(`  text=${params.text}`);
    }
    if (params.attachments.length > 0) {
      lines.push(`  attachments=${JSON.stringify(params.attachments)}`);
    }

    return lines.join('\n');
  }

  private renderCurrentMessageReplyIntentBlock(
    replyIntentContext: ReplyIntentContext
  ): string {
    const lines = ['- current_message_reply_intent:'];
    const reason =
      replyIntentContext.address_target.type === 'mention'
        ? 'explicit_mention_in_current_message'
        : replyIntentContext.address_target.type === 'quoted_sender'
          ? 'quoted_sender_of_reply_anchor'
          : 'shared_group_context_without_single_addressee';
    const targetUserId = replyIntentContext.address_target.user_id;

    if (targetUserId != null) {
      lines.push(`  primary_addressee_user_id=${targetUserId}`);
    } else {
      lines.push('  primary_addressee_user_id=<none>');
    }

    lines.push(`  primary_addressee_reason=${reason}`);
    lines.push(`  explanation=${this.buildReplyIntentExplanation(replyIntentContext)}`);

    return lines.join('\n');
  }

  private buildReplyIntentExplanation(
    replyIntentContext: ReplyIntentContext
  ): string {
    if (replyIntentContext.address_target.type === 'mention') {
      return '当前消息正文里显式提到了目标用户，因此优先视为对该被提及用户说话。';
    }

    if (replyIntentContext.address_target.type === 'quoted_sender') {
      return '当前消息没有新的明确提及对象，因此优先视为在回应被引用消息的发送者。';
    }

    return '当前消息存在 reply 锚点，但没有唯一明确的个人收件人，更像是在群上下文中接话。';
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

  private extractReplyRefFromMessageLike(message: QQMessage): {
    message_id?: number;
    sender_id?: number;
    sender_name?: string;
    text?: string;
  } | undefined {
    const replyIntentContext = message.reply_intent_context || parseReplyIntentContext(message);
    if (!replyIntentContext) {
      return undefined;
    }

    return {
      message_id: replyIntentContext.semantic_anchor.message_id,
      sender_id: replyIntentContext.semantic_anchor.sender_id,
      sender_name: replyIntentContext.semantic_anchor.sender_nickname,
      text: replyIntentContext.semantic_anchor.text
    };
  }

  private extractHistoryRawMessage(historyMessage: ContextHistoryMessage): QQMessage | undefined {
    let raw = historyMessage.raw_payload;

    if (typeof raw === 'string') {
      raw = this.parseRawRequest(raw) ?? raw;
    }

    if (raw && typeof raw === 'object') {
      return raw as QQMessage;
    }

    return undefined;
  }

  private extractTranscriptTextFromCurrentMessage(
    message: QQMessage,
    currentUserInput?: string
  ): string | undefined {
    const normalizedProvided =
      typeof currentUserInput === 'string' && currentUserInput.trim().length > 0
        ? currentUserInput.trim()
        : undefined;

    return this.pickFirstNonEmptyText([
      normalizedProvided,
      extractNormalizedMessageText(message)
    ]);
  }

  private extractTranscriptTextFromHistory(
    rawMessage: QQMessage | undefined,
    payload: string | OB11Segment[] | undefined,
    fallbackText?: string
  ): string | undefined {
    if (rawMessage) {
      const normalized = extractNormalizedMessageText(rawMessage);
      if (normalized.length > 0) {
        return normalized;
      }
    }

    if (Array.isArray(payload)) {
      const textFromSegments = extractTextFromSegments(payload);
      if (textFromSegments.length > 0) {
        return textFromSegments;
      }
    }

    if (typeof payload === 'string' && payload.trim().length > 0) {
      return payload.trim();
    }

    return typeof fallbackText === 'string' && fallbackText.trim().length > 0
      ? fallbackText.trim()
      : undefined;
  }

  private formatAddressTargetUser(
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

  private transformPrivateHistoryRecord(
    record: PrivateMessageHistoryRecord
  ): ContextHistoryMessage {
    return {
      history_id: record.id,
      conversation_id: record.conversation_id ?? null,
      message_id: record.message_id ?? null,
      user_id: record.user_id,
      sender_id: record.sender_id,
      sender_role: record.sender_role,
      content: record.content,
      content_type: record.content_type,
      sent_at: record.sent_at instanceof Date ? record.sent_at : new Date(record.sent_at),
      raw_payload: record.raw_payload
    };
  }

  private transformGroupHistoryRecord(
    record: GroupMessageHistoryRecord
  ): ContextHistoryMessage {
    return {
      history_id: record.id,
      conversation_id: record.conversation_id ?? null,
      message_id: record.message_id ?? null,
      group_id: record.group_id,
      sender_id: record.sender_id,
      sender_role: record.sender_role,
      content: record.content,
      content_type: record.content_type,
      sent_at: record.sent_at instanceof Date ? record.sent_at : new Date(record.sent_at),
      raw_payload: record.raw_payload
    };
  }

  private buildHistoryEntry(
    historyMessage: ContextHistoryMessage,
    nicknameMap: Map<number, string>
  ): PromptMessageWithAttachments {
    const senderProfile = this.extractSenderProfileFromHistory(historyMessage);
    const userId = senderProfile.userId ?? historyMessage.sender_id;
    const nickname = this.resolveNickname(userId, senderProfile.nickname, nicknameMap);
    const { payload, fallbackText } = this.extractHistoryPayload(historyMessage);
    const mentions = this.extractMentionsFromPayload(payload, fallbackText, nicknameMap);
    const isBotSender = historyMessage.sender_role === 'bot';
    const displayUserId = isBotSender ? '我' : userId ? String(userId) : '';
    const displayNickname = isBotSender ? '我' : nickname;

    const representation = this.resolveHistoryMessageContent(
      historyMessage,
      payload,
      fallbackText
    );

    const entry: PromptMessageEntry = {
      qq_id: displayUserId,
      user_nick: displayNickname,
      message_type: representation.messageType,
      at_qq_id: mentions,
      received_time: this.toIsoString(historyMessage.sent_at) ?? ''
    };

    if (
      representation.messageType === 'text' &&
      representation.context &&
      representation.context.length > 0
    ) {
      entry.context = representation.context;
    }

    return {
      entry,
      attachments: representation.attachments
    };
  }

  private renderViewportMessageLine(entry: PromptMessageEntry): string {
    const name = entry.user_nick || entry.qq_id || '未知用户';
    const time = entry.received_time ? `[${entry.received_time}] ` : '';
    const mentionText = Array.isArray(entry.at_qq_id) && entry.at_qq_id.length > 0
      ? ` ${entry.at_qq_id.map(item => `@${item.nick_name || item.qq_id}`).join(' ')}`
      : '';

    if (entry.message_type === 'image') {
      const contextText = entry.context ? ` ${entry.context}` : '';
      return `${time}${name}: [图片消息]${contextText}${mentionText}`.trim();
    }

    return `${time}${name}: ${entry.context || ''}${mentionText}`.trim();
  }

  private isCurrentMessageRecord(
    historyMessageId?: number | null,
    currentMessageId?: number | null
  ): boolean {
    if (historyMessageId == null || currentMessageId == null) {
      return false;
    }

    return Number(historyMessageId) === Number(currentMessageId);
  }

  private buildUnreadEntry(
    message: QQMessage,
    nicknameMap: Map<number, string>,
    currentUserInput?: string
  ): PromptMessageWithAttachments {
    const senderProfile = this.extractSenderProfileFromMessage(message);
    const userId = senderProfile.userId ?? message.user_id;
    const nickname = this.resolveNickname(
      userId,
      senderProfile.nickname || message.sender?.nickname,
      nicknameMap
    );

    const representation = this.resolveCurrentMessageContent(
      message,
      currentUserInput
    );

    const mentions = this.extractMentionsFromMessage(
      message,
      nicknameMap,
      representation.context ?? currentUserInput
    );

    const entry: PromptMessageEntry = {
      qq_id: userId ? String(userId) : '',
      user_nick: nickname,
      message_type: representation.messageType,
      at_qq_id: mentions,
      received_time:
        this.toIsoString(
          message.time ? message.time * 1000 : undefined
        ) ?? ''
    };

    if (
      representation.messageType === 'text' &&
      representation.context &&
      representation.context.length > 0
    ) {
      entry.context = representation.context;
    }

    return {
      entry,
      attachments: representation.attachments
    };
  }

  private resolveHistoryMessageContent(
    historyMessage: ContextHistoryMessage,
    payload: string | OB11Segment[] | undefined,
    fallbackText: string | undefined
  ): { messageType: PromptMessageType; context?: string; attachments: PromptAttachment[] } {
    const contextCandidates = [
      fallbackText,
      typeof historyMessage.content === 'string' ? historyMessage.content : undefined
    ];

    const attachments: PromptAttachment[] = [];
    const seen = new Set<string>();

    const pushAttachments = (items?: PromptAttachment[]) => {
      if (!Array.isArray(items)) {
        return;
      }

      items.forEach(item => {
        if (!item || seen.has(item.data)) {
          return;
        }
        seen.add(item.data);
        attachments.push(item);
      });
    };

    pushAttachments(this.collectLocalAttachmentsFromRawPayload(historyMessage.raw_payload));

    if (Array.isArray(payload)) {
      pushAttachments(this.collectImageAttachmentsFromSegments(payload));
      const textFromSegments = extractTextFromSegments(payload);
      const hasImage =
        historyMessage.content_type === 'image' ||
        attachments.length > 0 ||
        payload.some(segment => segment.type === 'image');

      if (hasImage && attachments.length === 0) {
        const rawSegments = this.extractSegmentsFromRawPayload(historyMessage.raw_payload);
        pushAttachments(this.collectImageAttachmentsFromSegments(rawSegments));
      }

      if (hasImage) {
        return {
          messageType: 'image',
          context: this.pickFirstNonEmptyText([textFromSegments, ...contextCandidates]),
          attachments
        };
      }

      return {
        messageType: 'text',
        context: this.pickFirstNonEmptyText([textFromSegments, ...contextCandidates]),
        attachments: []
      };
    }

    if (typeof payload === 'string') {
      const hasImage =
        historyMessage.content_type === 'image' || attachments.length > 0;

      if (hasImage && attachments.length === 0) {
        const rawSegments = this.extractSegmentsFromRawPayload(historyMessage.raw_payload);
        pushAttachments(this.collectImageAttachmentsFromSegments(rawSegments));
      }

      return {
        messageType: hasImage ? 'image' : 'text',
        context: this.pickFirstNonEmptyText([payload, ...contextCandidates]),
        attachments: hasImage ? attachments : []
      };
    }

    const rawSegments = this.extractSegmentsFromRawPayload(historyMessage.raw_payload);
    pushAttachments(this.collectImageAttachmentsFromSegments(rawSegments));

    const hasImage = historyMessage.content_type === 'image' || attachments.length > 0;

    return {
      messageType: hasImage ? 'image' : 'text',
      context: this.pickFirstNonEmptyText(contextCandidates),
      attachments: hasImage ? attachments : []
    };
  }

  private resolveCurrentMessageContent(
    message: QQMessage,
    providedText?: string
  ): { messageType: PromptMessageType; context?: string; attachments: PromptAttachment[] } {
    const segments = Array.isArray(message.message) ? message.message : message.segments;
    const normalizedProvided =
      typeof providedText === 'string' && providedText.trim().length > 0
        ? providedText.trim()
        : undefined;

    const derivedAttachments = resolveAttachmentsFromMessage(message);
    const localAttachments = this.collectImageAttachmentsFromLocalSources(message);
    const attachments = this.collectImageAttachmentsFromMessageComponents(
      segments,
      derivedAttachments,
      localAttachments
    );

    const hasImage =
      attachments.length > 0 ||
      derivedAttachments.some(attachment => attachment.type === 'image') ||
      localAttachments.length > 0;

    const contextText = this.pickFirstNonEmptyText([
      normalizedProvided,
      this.extractMessageText(message)
    ]);

    if (hasImage) {
      return {
        messageType: 'image',
        context: contextText,
        attachments
      };
    }

    return {
      messageType: 'text',
      context: contextText,
      attachments: []
    };
  }

  private collectImageAttachmentsFromSegments(
    segments?: OB11Segment[]
  ): PromptAttachment[] {
    return this.collectImageAttachmentsFromMessageComponents(segments, undefined);
  }

  private collectImageAttachmentsFromMessageComponents(
    segments?: OB11Segment[],
    attachments?: MessageAttachment[],
    localAttachments?: PromptAttachment[]
  ): PromptAttachment[] {
    const results: PromptAttachment[] = [];
    const seen = new Set<string>();

    const pushIfUnique = (attachment: PromptAttachment | null) => {
      if (!this.isSupportedPromptAttachment(attachment)) {
        return;
      }
      if (seen.has(attachment.data)) {
        return;
      }
      seen.add(attachment.data);
      results.push(attachment);
    };

    if (Array.isArray(localAttachments)) {
      localAttachments.forEach(pushIfUnique);
    }

    if (Array.isArray(segments)) {
      segments.forEach(segment => {
        const image = this.extractImageDataFromSegment(segment);
        pushIfUnique(image);
      });
    }

    if (Array.isArray(attachments)) {
      attachments.forEach(attachment => {
        if (attachment.type !== 'image') {
          return;
        }
        const image = this.extractImageDataFromSegment({
          type: attachment.type,
          data: attachment.data
        } as OB11Segment);
        pushIfUnique(image);
      });
    }

    return results;
  }

  private extractImageDataFromSegment(segment?: OB11Segment | null): PromptAttachment | null {
    if (!segment || segment.type !== 'image' || !segment.data) {
      return null;
    }

    const data = segment.data;
    const candidateFields = [
      data.base64,
      data.file_base64,
      data.image_base64,
      data.data,
      data.image
    ];

    let base64: string | undefined;

    for (const candidate of candidateFields) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        base64 = candidate;
        break;
      }
    }

    if (!base64) {
      return null;
    }

    const mimeType = this.resolveMimeType(
      data.mime || data.mimetype || data.content_type,
      data.file || data.name || data.filename
    );

    return {
      type: 'image',
      mimeType,
      data: this.normalizeBase64(base64)
    };
  }

  private collectImageAttachmentsFromLocalSources(message: QQMessage): PromptAttachment[] {
    return this.buildPromptAttachmentsFromLocalEntries(
      (message as any)?.local_attachments
    );
  }

  private collectLocalAttachmentsFromRawPayload(rawPayload: any): PromptAttachment[] {
    if (!rawPayload) {
      return [];
    }

    const resolved =
      typeof rawPayload === 'string' ? this.parseRawRequest(rawPayload) : rawPayload;
    if (!resolved) {
      return [];
    }

    return this.buildPromptAttachmentsFromLocalEntries(resolved.local_attachments);
  }

  private buildPromptAttachmentsFromLocalEntries(raw: any): PromptAttachment[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    const attachments: PromptAttachment[] = [];

    raw.forEach(entry => {
      if (!entry || typeof entry !== 'object') {
        return;
      }

      const type = entry.type;
      const base64 = typeof entry.base64 === 'string' ? entry.base64 : undefined;
      if (type !== 'image' || !base64 || base64.trim().length === 0) {
        return;
      }

      const mimeCandidate =
        typeof entry.mimeType === 'string' ? entry.mimeType : entry.mime_type;

      const resolvedMime = this.resolveMimeType(
        typeof mimeCandidate === 'string' ? mimeCandidate : undefined,
        typeof entry.originalName === 'string' ? entry.originalName : undefined
      );

      const promptAttachment: PromptAttachment = {
        type: 'image',
        mimeType: resolvedMime,
        data: this.normalizeBase64(base64)
      };

      if (!this.isSupportedPromptAttachment(promptAttachment)) {
        return;
      }

      attachments.push(promptAttachment);
    });

    return attachments;
  }

  private async prepareAttachmentForGemini(
    attachment: PromptAttachment
  ): Promise<PromptAttachment | null> {
    if (!this.isSupportedPromptAttachment(attachment)) {
      return null;
    }

    let mimeType = (attachment.mimeType || '').trim().toLowerCase();
    const normalizedData = attachment.data.trim();

    if (!mimeType || !mimeType.startsWith('image/')) {
      mimeType = 'image/png';
    }

    if (mimeType.startsWith('image/gif')) {
      const converted = await this.convertGifToWebp(normalizedData);
      if (!converted) {
        this.moduleLogger.warn('Dropping GIF attachment due to conversion failure');
        return null;
      }
      mimeType = 'image/webp';
      return {
        ...attachment,
        mimeType,
        data: converted
      };
    }

    return {
      ...attachment,
      mimeType,
      data: normalizedData
    };
  }

  private async convertGifToWebp(base64Data: string): Promise<string | null> {
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      const converted = await sharp(buffer, { animated: true })
        .webp({ quality: 90 })
        .toBuffer();
      return converted.toString('base64');
    } catch (error) {
      this.moduleLogger.warn('Failed to convert GIF to WebP', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private isSupportedPromptAttachment(
    attachment: PromptAttachment | null
  ): attachment is PromptAttachment {
    if (!attachment) {
      return false;
    }

    if (typeof attachment.data !== 'string' || attachment.data.trim().length === 0) {
      return false;
    }

    const mimeType = (attachment.mimeType || '').trim().toLowerCase();
    if (mimeType.startsWith('image/')) {
      return true;
    }

    return false;
  }

  private resolveMimeType(explicit?: string, fileName?: string): string {
    if (typeof explicit === 'string' && explicit.trim().length > 0) {
      const trimmed = explicit.trim();
      if (trimmed.startsWith('data:')) {
        const semicolonIndex = trimmed.indexOf(';');
        const extracted = trimmed.slice(5, semicolonIndex > -1 ? semicolonIndex : undefined);
        if (extracted.includes('/')) {
          return extracted;
        }
      }
      if (trimmed.includes('/')) {
        return trimmed;
      }
    }

    return this.inferMimeTypeFromFileName(fileName);
  }

  private inferMimeTypeFromFileName(fileName?: string): string {
    if (typeof fileName !== 'string' || fileName.length === 0) {
      return 'image/png';
    }

    const lower = fileName.toLowerCase();

    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      return 'image/jpeg';
    }
    if (lower.endsWith('.gif')) {
      return 'image/gif';
    }
    if (lower.endsWith('.webp')) {
      return 'image/webp';
    }
    if (lower.endsWith('.bmp')) {
      return 'image/bmp';
    }
    if (lower.endsWith('.svg')) {
      return 'image/svg+xml';
    }
    if (lower.endsWith('.heic') || lower.endsWith('.heif')) {
      return 'image/heic';
    }

    return 'image/png';
  }

  private normalizeBase64(data: string): string {
    const trimmed = data.trim();
    if (trimmed.startsWith('data:')) {
      const commaIndex = trimmed.indexOf(',');
      if (commaIndex !== -1) {
        return trimmed.slice(commaIndex + 1);
      }
    }
    return trimmed;
  }

  private extractSegmentsFromRawPayload(raw: any): OB11Segment[] {
    if (!raw) {
      return [];
    }

    const resolved = typeof raw === 'string' ? this.parseRawRequest(raw) : raw;
    if (resolved && Array.isArray(resolved.message)) {
      return resolved.message;
    }
    if (resolved && Array.isArray(resolved.segments)) {
      return resolved.segments;
    }

    return [];
  }

  private pickFirstNonEmptyText(
    candidates: Array<string | undefined | null>
  ): string | undefined {
    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }
    return undefined;
  }

  private resolveNickname(
    userId: number | undefined,
    preferredNickname: string | undefined,
    nicknameMap: Map<number, string>
  ): string {
    if (userId && preferredNickname) {
      nicknameMap.set(userId, preferredNickname);
      return preferredNickname;
    }

    if (userId) {
      const existing = nicknameMap.get(userId);
      if (existing) {
        return existing;
      }
      const fallback = `用户${userId}`;
      nicknameMap.set(userId, fallback);
      return fallback;
    }

    return preferredNickname || '';
  }

  private extractHistoryPayload(
    historyMessage: ContextHistoryMessage
  ): {
    payload: string | OB11Segment[] | undefined;
    fallbackText: string | undefined;
  } {
    let raw = historyMessage.raw_payload;

    if (typeof raw === 'string') {
      raw = this.parseRawRequest(raw) ?? raw;
    }

    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.message) || typeof raw.message === 'string') {
        return {
          payload: raw.message,
          fallbackText:
            typeof raw.raw_message === 'string'
              ? raw.raw_message
              : historyMessage.content
        };
      }

      if (Array.isArray(raw.segments)) {
        return {
          payload: raw.segments,
          fallbackText:
            typeof raw.raw_message === 'string'
              ? raw.raw_message
              : historyMessage.content
        };
      }
    }

    return {
      payload: typeof historyMessage.content === 'string' ? historyMessage.content : undefined,
      fallbackText: historyMessage.content
    };
  }

  private extractMentionsFromMessage(
    message: QQMessage,
    nicknameMap: Map<number, string>,
    fallbackText?: string
  ): Array<{ qq_id: string; nick_name: string }> {
    const payload =
      typeof message.message === 'string' || Array.isArray(message.message)
        ? message.message
        : message.raw_message;

    const defaultText =
      typeof fallbackText === 'string' && fallbackText.length > 0
        ? fallbackText
        : typeof message.raw_message === 'string'
        ? message.raw_message
        : undefined;

    return this.extractMentionsFromPayload(payload, defaultText, nicknameMap);
  }

  private extractMentionsFromPayload(
    payload: string | OB11Segment[] | undefined,
    fallbackText: string | undefined,
    nicknameMap: Map<number, string>
  ): Array<{ qq_id: string; nick_name: string }> {
    const mentions: Array<{ qq_id: string; nick_name: string }> = [];

    const addMention = (qq: string | number | undefined, nickname?: string) => {
      if (!qq && qq !== 0) {
        return;
      }
      const qqString = String(qq);
      if (!qqString || qqString === 'all' || qqString === 'here') {
        return;
      }

      if (mentions.some(item => item.qq_id === qqString)) {
        return;
      }

      const resolvedNickname = this.resolveMentionNickname(
        qqString,
        nicknameMap,
        nickname
      );

      mentions.push({
        qq_id: qqString,
        nick_name: resolvedNickname
      });
    };

    if (Array.isArray(payload)) {
      payload.forEach(segment => {
        if (segment.type === 'at') {
          addMention(segment.data?.qq, segment.data?.name);
        }
      });
    } else if (typeof payload === 'string') {
      const cqRegex = /\[CQ:at,qq=([0-9]+)(?:,[^\]]*?name=([^,\]]+))?/g;
      let match: RegExpExecArray | null;
      while ((match = cqRegex.exec(payload)) !== null) {
        addMention(match[1], match[2]);
      }
    }

    if (typeof fallbackText === 'string' && fallbackText.length > 0) {
      const inlineRegex = /@([0-9]{5,})/g;
      let match: RegExpExecArray | null;
      while ((match = inlineRegex.exec(fallbackText)) !== null) {
        addMention(match[1]);
      }
    }

    return mentions;
  }

  private resolveMentionNickname(
    qqId: string,
    nicknameMap: Map<number, string>,
    explicit?: string
  ): string {
    if (explicit) {
      return explicit;
    }

    const numericId = Number(qqId);
    if (!Number.isNaN(numericId)) {
      const existing = nicknameMap.get(numericId);
      if (existing) {
        return existing;
      }
      const fallback = `用户${qqId}`;
      nicknameMap.set(numericId, fallback);
      return fallback;
    }

    return '';
  }

  private extractMessageText(message: QQMessage): string {
    const normalizedText = extractNormalizedMessageText(message);
    if (normalizedText.length > 0) {
      return normalizedText;
    }

    let baseText = '';

    if (typeof message.message === 'string') {
      baseText = message.message
        .replace(/\[CQ:at,qq=([0-9]+)(?:,[^\]]*?name=([^,\]]+))?\]/g, (_, qq, name) =>
          `@${name || qq}`
        )
        .trim();
    } else if (Array.isArray(message.message)) {
      baseText = extractTextFromSegments(message.message);
    } else if (typeof message.raw_message === 'string') {
      baseText = message.raw_message.trim();
    }

    const attachments = resolveAttachmentsFromMessage(message);
    const attachmentHints = buildAttachmentHints(attachments);

    const parts = [baseText, ...attachmentHints].filter(
      part => part && part.length > 0
    );

    if (parts.length === 0 && typeof message.raw_message === 'string') {
      return message.raw_message.trim();
    }

    return parts.join(' ').trim();
  }

  private extractSenderProfileFromHistory(
    historyMessage: ContextHistoryMessage
  ): {
    userId?: number;
    nickname?: string;
    source: 'payload' | 'fallback';
  } {
    try {
      let raw = historyMessage.raw_payload;
      if (typeof raw === 'string') {
        raw = this.parseRawRequest(raw) ?? raw;
      }

      if (raw && typeof raw === 'object') {
        if (raw.sender) {
          return {
            userId: raw.sender.user_id ?? historyMessage.sender_id,
            nickname: raw.sender.nickname || raw.sender.card,
            source: 'payload'
          };
        }

        if (typeof raw.user_id === 'number') {
          return {
            userId: raw.user_id,
            nickname: raw.nickname,
            source: 'payload'
          };
        }
      }
    } catch (error) {
      this.moduleLogger.warn('Failed to extract sender profile from history payload', {
        error: error instanceof Error ? error.message : String(error),
        senderId: historyMessage.sender_id
      });
    }

    if (historyMessage.sender_role === 'bot') {
      return {
        userId: historyMessage.sender_id,
        nickname: 'QQ机器人',
        source: 'fallback'
      };
    }

    return {
      userId: historyMessage.sender_id,
      nickname: undefined,
      source: 'fallback'
    };
  }

  private extractSenderProfileFromMessage(message: QQMessage): {
    userId?: number;
    nickname?: string;
  } {
    try {
      if (typeof message === 'object' && message.sender) {
        return {
          userId: message.sender.user_id ?? message.user_id,
          nickname: message.sender.nickname
        };
      }
    } catch (error) {
      this.moduleLogger.warn('Failed to extract sender profile from message', {
        error
      });
    }

    return {
      userId: message.user_id,
      nickname: undefined
    };
  }

  private parseRawRequest(rawRequest: any): any {
    if (!rawRequest) {
      return null;
    }

    if (typeof rawRequest === 'string') {
      try {
        return JSON.parse(rawRequest);
      } catch (error) {
        this.moduleLogger.warn('Failed to parse raw_request JSON', { error });
        return null;
      }
    }

    return rawRequest;
  }

  private toIsoString(
    value: Date | string | number | undefined
  ): string | undefined {
    if (!value) {
      return undefined;
    }

    let date: Date;

    if (value instanceof Date) {
      date = value;
    } else if (typeof value === 'number') {
      date = new Date(value);
    } else {
      date = new Date(value);
    }

    if (isNaN(date.getTime())) {
      return undefined;
    }

    return date.toISOString();
  }

}

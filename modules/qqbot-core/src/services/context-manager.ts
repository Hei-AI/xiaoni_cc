import { DatabaseManager } from './database';
import { QQMessage, ConversationData, OB11Segment } from '../types';
import { logger } from '../utils/logger';

/**
 * 消息上下文接口
 */
export interface MessageContext {
  currentMessage: QQMessage;
  historyMessages: ConversationData[];
  contextSummary: string;
  userInfo?: {
    user_id: number;
    nickname: string;
    message_count: number;
  };
  groupInfo?: {
    group_id: number;
    message_count: number;
  };
}

/**
 * 上下文管理器
 * 负责获取和处理消息上下文，为AI决策提供背景信息
 */
export class ContextManager {
  private database: DatabaseManager;
  private moduleLogger = logger.createModuleLogger('context-manager');

  constructor(database: DatabaseManager) {
    this.database = database;
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
      
      const historyMessages = await this.database.getMessageContext(message, contextLimit);
      this.moduleLogger.info('Step 1 completed: Got history messages', { count: historyMessages.length });

      // 生成上下文摘要
      this.moduleLogger.info('Step 2: Generating context summary...');
      const contextSummary = this.generateContextSummary(message, historyMessages);
      this.moduleLogger.info('Step 2 completed: Generated context summary', { summaryLength: contextSummary.length });

      // 构建用户信息
      this.moduleLogger.info('Step 3: Building user info...');
      const userInfo = await this.buildUserInfo(message.user_id);
      this.moduleLogger.info('Step 3 completed: Built user info', { hasUserInfo: !!userInfo });

      // 构建群聊信息（如果是群聊）
      if (message.group_id) {
        this.moduleLogger.info('Step 4: Building group info...');
        const groupInfo = await this.buildGroupInfo(message.group_id);
        this.moduleLogger.info('Step 4 completed: Built group info', { hasGroupInfo: !!groupInfo });
        
        const context: MessageContext = {
          currentMessage: message,
          historyMessages,
          contextSummary,
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
        contextSummary: '无可用上下文信息'
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
    historyMessages: ConversationData[]
  ): string {
    if (historyMessages.length === 0) {
      return `用户${currentMessage.sender?.nickname || `用户${currentMessage.user_id}`}发起了新对话`;
    }

    const recentCount = Math.min(historyMessages.length, 5);
    const recentMessages = historyMessages.slice(-recentCount);
    
    let summary = `最近${recentCount}条对话:\n`;
    
    recentMessages.forEach((msg, index) => {
      const time = new Date(msg.timestamp).toLocaleTimeString();
      const userMsg = this.truncateMessage(msg.user_message, 50);
      const aiMsg = msg.ai_response ? this.truncateMessage(msg.ai_response, 50) : '无回复';
      
      summary += `${index + 1}. [${time}] 用户: ${userMsg}\n`;
      summary += `   AI回复: ${aiMsg}\n`;
    });

    return summary;
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
  public formatContextForAI(
    context: MessageContext,
    currentUserInput?: string
  ): string {
    const nicknameMap = new Map<number, string>();

    if (context.userInfo) {
      nicknameMap.set(
        context.userInfo.user_id,
        context.userInfo.nickname || `用户${context.userInfo.user_id}`
      );
    }

    context.historyMessages.forEach(historyMessage => {
      const profile = this.extractSenderProfileFromConversation(historyMessage);
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

    const historyEntries = context.historyMessages.map(historyMessage =>
      this.buildHistoryEntry(historyMessage, nicknameMap)
    );

    const unreadEntries = [
      this.buildUnreadEntry(
        context.currentMessage,
        nicknameMap,
        currentUserInput
      )
    ];

    const payload: Record<string, any> = {
      history: historyEntries,
      unread: unreadEntries
    };

    return JSON.stringify(payload, null, 2);
  }

  private buildHistoryEntry(
    conversation: ConversationData,
    nicknameMap: Map<number, string>
  ): Record<string, any> {
    const senderProfile = this.extractSenderProfileFromConversation(conversation);
    const userId = senderProfile.userId ?? conversation.user_id;
    const nickname = this.resolveNickname(userId, senderProfile.nickname, nicknameMap);
    const mentions = this.extractMentionsFromConversation(conversation, nicknameMap);

    return {
      qq_id: userId ? String(userId) : '',
      user_nick: nickname,
      message: conversation.user_message ?? '',
      at_qq_id: mentions,
      received_time: this.toIsoString(conversation.timestamp) ?? ''
    };
  }

  private buildUnreadEntry(
    message: QQMessage,
    nicknameMap: Map<number, string>,
    currentUserInput?: string
  ): Record<string, any> {
    const senderProfile = this.extractSenderProfileFromMessage(message);
    const userId = senderProfile.userId ?? message.user_id;
    const nickname = this.resolveNickname(
      userId,
      senderProfile.nickname || message.sender?.nickname,
      nicknameMap
    );

    const messageText =
      typeof currentUserInput === 'string' && currentUserInput.length > 0
        ? currentUserInput
        : this.extractMessageText(message);

    const mentions = this.extractMentionsFromMessage(
      message,
      nicknameMap,
      messageText
    );

    return {
      qq_id: userId ? String(userId) : '',
      user_nick: nickname,
      message: messageText,
      at_qq_id: mentions,
      received_time:
        this.toIsoString(
          message.time ? message.time * 1000 : undefined
        ) ?? ''
    };
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

  private extractMentionsFromConversation(
    conversation: ConversationData,
    nicknameMap: Map<number, string>
  ): Array<{ qq_id: string; nick_name: string }> {
    try {
      if (conversation.raw_request) {
        const parsed = this.parseRawRequest(conversation.raw_request);
        if (parsed) {
          const messagePayload =
            Array.isArray(parsed.message) || typeof parsed.message === 'string'
              ? parsed.message
              : parsed.raw_message;

          const mentions = this.extractMentionsFromPayload(
            messagePayload,
            conversation.user_message,
            nicknameMap
          );

          if (mentions.length > 0) {
            return mentions;
          }
        }
      }
    } catch (error) {
      this.moduleLogger.warn('Failed to extract mentions from conversation', {
        error,
        conversationId: conversation.id
      });
    }

    return this.extractMentionsFromPayload(
      undefined,
      conversation.user_message,
      nicknameMap
    );
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
    if (typeof message.message === 'string') {
      return message.message
        .replace(/\[CQ:at,qq=([0-9]+)(?:,[^\]]*?name=([^,\]]+))?\]/g, (_, qq, name) =>
          `@${name || qq}`
        )
        .trim();
    }

    if (Array.isArray(message.message)) {
      return message.message
        .map(segment => {
          if (segment.type === 'text') {
            return segment.data?.text || '';
          }
          if (segment.type === 'at') {
            const name = segment.data?.name || segment.data?.qq;
            return name ? `@${name}` : '@';
          }
          return '';
        })
        .join('')
        .trim();
    }

    if (typeof message.raw_message === 'string') {
      return message.raw_message.trim();
    }

    return '';
  }

  private extractSenderProfileFromConversation(conversation: ConversationData): {
    userId?: number;
    nickname?: string;
    source: 'parsed' | 'fallback';
  } {
    try {
      if (conversation.raw_request) {
        const parsed = this.parseRawRequest(conversation.raw_request);

        if (parsed?.sender) {
          return {
            userId: parsed.sender.user_id ?? conversation.user_id,
            nickname: parsed.sender.nickname,
            source: 'parsed'
          };
        }

        if (parsed?.user_id) {
          return {
            userId: parsed.user_id,
            nickname: parsed.nickname,
            source: 'parsed'
          };
        }
      }
    } catch (error) {
      this.moduleLogger.warn('Failed to parse conversation raw_request', {
        error,
        conversationId: conversation.id
      });
    }

    return {
      userId: conversation.user_id,
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

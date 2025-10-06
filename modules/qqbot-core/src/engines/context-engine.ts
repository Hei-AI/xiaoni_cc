/**
 * ContextEngine - Stage 1 实现
 * 负责构建消息的上下文信息，帮助决策链路和下游 LLM 做出更好的判断
 * 
 * Stage 1功能：
 * 1. 简单的时间窗口消息历史检索
 * 2. 基础的用户信息收集
 * 3. 群聊/私聊上下文识别
 */

import { logger } from '../utils/logger';
import { DatabaseManager } from '../services/database';
import { QQMessage } from '../types';

export interface MessageContext {
  currentMessage: QQMessage;
  recentMessages: QQMessage[];
  userInfo: UserInfo;
  groupInfo?: GroupInfo;
  conversationSummary?: string;
  topicKeywords?: string[];
}

export interface UserInfo {
  user_id: number;
  nickname: string;
  recent_interaction_count: number;
  last_interaction?: Date;
  is_frequent_user: boolean;
}

export interface GroupInfo {
  group_id: number;
  recent_activity_level: 'low' | 'medium' | 'high';
  participant_count: number;
  current_topic_hint?: string;
}

export class ContextEngine {
  private database: DatabaseManager;
  private moduleLogger = logger.createModuleLogger('context-engine');
  
  // Stage 1简单配置
  private readonly TIME_WINDOW_MINUTES = 10; // 10分钟时间窗口
  private readonly MAX_RECENT_MESSAGES = 10;  // 最多检索10条消息
  
  constructor(database: DatabaseManager) {
    this.database = database;
    this.moduleLogger.info('ContextEngine v1 initialized');
  }

  /**
   * 主入口：构建消息的完整上下文
   */
  async buildContext(messageOrId: string | QQMessage, traceId?: string): Promise<MessageContext> {
    try {
      // 第一步：获取当前消息信息
      let currentMessage: QQMessage;
      if (typeof messageOrId === 'string') {
        const foundMessage = await this.getCurrentMessage(messageOrId);
        if (!foundMessage) {
          throw new Error(`Message not found: ${messageOrId}`);
        }
        currentMessage = foundMessage;
      } else {
        currentMessage = messageOrId;
      }

      // 第二步：获取相关历史消息
      const recentMessages = await this.getRecentMessages(currentMessage);

      // 第三步：构建用户信息
      const userInfo = await this.buildUserInfo(currentMessage.user_id);

      // 第四步：构建群聊信息（如果是群聊）
      const groupInfo = currentMessage.group_id 
        ? await this.buildGroupInfo(currentMessage.group_id)
        : undefined;

      // 第五步：生成对话摘要（Stage 1简化版）
      const conversationSummary = await this.generateConversationSummary(
        recentMessages, 
        currentMessage
      );

      // 第六步：提取话题关键词
      const topicKeywords = await this.extractTopicKeywords(
        recentMessages, 
        currentMessage
      );

      const context: MessageContext = {
        currentMessage,
        recentMessages,
        userInfo,
        groupInfo,
        conversationSummary,
        topicKeywords
      };

      this.moduleLogger.info('Context built successfully', {
        traceId,
        messageId: typeof messageOrId === 'string' ? messageOrId : `msg_${currentMessage.user_id}_${currentMessage.time}`,
        userId: currentMessage.user_id,
        groupId: currentMessage.group_id,
        recentMessageCount: recentMessages.length,
        topicKeywords: topicKeywords?.slice(0, 3) // 只记录前3个关键词
      });

      return context;

    } catch (error) {
      this.moduleLogger.error('Failed to build context', {
        traceId,
        error: error instanceof Error ? error.message : 'Unknown error',
        messageId: typeof messageOrId === 'string' ? messageOrId : `msg_${messageOrId.user_id}_${messageOrId.time}`
      });
      
      // 返回最小化的上下文，确保系统能继续运行
      return this.buildMinimalContext(messageOrId);
    }
  }

  /**
   * 获取当前消息（从数据库或缓存）
   */
  private async getCurrentMessage(messageId: string): Promise<QQMessage | null> {
    // 这里需要从数据库获取消息，目前先返回null
    // TODO: 实现真实的消息查询
    this.moduleLogger.warn('getCurrentMessage not implemented, returning null');
    return null;
  }

  /**
   * 获取相关的历史消息
   */
  private async getRecentMessages(currentMessage: QQMessage): Promise<QQMessage[]> {
    try {
      const timeWindowMs = this.TIME_WINDOW_MINUTES * 60 * 1000;
      const cutoffTime = new Date(Date.now() - timeWindowMs);

      // 构建查询条件
      const searchContext = {
        user_id: currentMessage.user_id,
        group_id: currentMessage.group_id,
        after_time: cutoffTime,
        limit: this.MAX_RECENT_MESSAGES
      };

      // TODO: 实现真实的历史消息查询
      // const messages = await this.database.getRecentMessages(searchContext);
      
      // Stage 1临时实现：返回空数组
      this.moduleLogger.debug('Recent messages query not implemented, returning empty array');
      const messages: QQMessage[] = [];

      // 按时间排序（最新的在前）
      return messages.sort((a, b) => b.time - a.time);

    } catch (error) {
      this.moduleLogger.warn('Failed to get recent messages', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * 构建用户信息
   */
  private async buildUserInfo(userId: number): Promise<UserInfo> {
    try {
      // TODO: 从数据库获取用户统计信息
      // 目前返回基础信息
      
      const userInfo: UserInfo = {
        user_id: userId,
        nickname: `User_${userId}`, // 临时昵称
        recent_interaction_count: 0,
        is_frequent_user: false
      };

      return userInfo;

    } catch (error) {
      this.moduleLogger.warn('Failed to build user info', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId
      });

      // 返回最小化用户信息
      return {
        user_id: userId,
        nickname: `User_${userId}`,
        recent_interaction_count: 0,
        is_frequent_user: false
      };
    }
  }

  /**
   * 构建群聊信息
   */
  private async buildGroupInfo(groupId: number): Promise<GroupInfo> {
    try {
      // TODO: 从数据库获取群聊统计信息
      
      const groupInfo: GroupInfo = {
        group_id: groupId,
        recent_activity_level: 'medium',
        participant_count: 0
      };

      return groupInfo;

    } catch (error) {
      this.moduleLogger.warn('Failed to build group info', {
        error: error instanceof Error ? error.message : 'Unknown error',
        groupId
      });

      return {
        group_id: groupId,
        recent_activity_level: 'low',
        participant_count: 0
      };
    }
  }

  /**
   * 生成对话摘要（Stage 1简化版）
   */
  private async generateConversationSummary(
    recentMessages: QQMessage[], 
    currentMessage: QQMessage
  ): Promise<string> {
    
    if (recentMessages.length === 0) {
      return '新对话开始';
    }

    // Stage 1简化实现：基于消息数量和关键词的简单摘要
    try {
      const messageTexts = recentMessages
        .map(msg => typeof msg.message === 'string' ? msg.message : '')
        .filter(text => text.length > 0);

      if (messageTexts.length === 0) {
        return '最近没有文字对话';
      }

      // 简单的关键词提取
      const allText = messageTexts.join(' ');
      const keywords = this.extractSimpleKeywords(allText);

      if (keywords.length > 0) {
        return `最近在讨论：${keywords.slice(0, 3).join('、')}`;
      } else {
        return `最近有${messageTexts.length}条消息交流`;
      }

    } catch (error) {
      this.moduleLogger.warn('Failed to generate conversation summary', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return '对话上下文分析失败';
    }
  }

  /**
   * 提取话题关键词
   */
  private async extractTopicKeywords(
    recentMessages: QQMessage[], 
    currentMessage: QQMessage
  ): Promise<string[]> {
    
    try {
      // 合并所有消息文本
      const allMessages = [...recentMessages, currentMessage];
      const allText = allMessages
        .map(msg => typeof msg.message === 'string' ? msg.message : '')
        .join(' ');

      if (!allText.trim()) {
        return [];
      }

      // Stage 1简单关键词提取
      const keywords = this.extractSimpleKeywords(allText);
      
      return keywords.slice(0, 5); // 返回前5个关键词

    } catch (error) {
      this.moduleLogger.warn('Failed to extract topic keywords', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * 简单的关键词提取（Stage 1版本）
   */
  private extractSimpleKeywords(text: string): string[] {
    // 定义重要关键词类别
    const importantKeywords = [
      // 技术相关
      'api', 'bug', 'error', '错误', '问题', '代码', 'code', '开发', 
      '部署', 'deploy', 'git', '数据库', 'database', '服务器', 'server',
      
      // 工作相关  
      '会议', '项目', '任务', '需求', '测试', '上线', '发布',
      
      // 常见话题
      '吃饭', '下班', '周末', '加班', '休息', '假期'
    ];

    const foundKeywords: string[] = [];
    const textLower = text.toLowerCase();

    // 检查每个重要关键词
    importantKeywords.forEach(keyword => {
      if (textLower.includes(keyword.toLowerCase())) {
        foundKeywords.push(keyword);
      }
    });

    // 去重并返回
    return Array.from(new Set(foundKeywords));
  }

  /**
   * 构建最小化上下文（错误时使用）
   */
  private async buildMinimalContext(messageOrId: string | QQMessage): Promise<MessageContext> {
    // 创建一个基础的上下文，确保系统不会崩溃
    let minimalMessage: QQMessage;
    
    if (typeof messageOrId === 'string') {
      minimalMessage = {
        message_type: 'private',
        sub_type: '',
        message_id: parseInt(messageOrId) || 0,
        user_id: 0,
        message: '消息获取失败',
        raw_message: '',
        font: 0,
        sender: {
          user_id: 0,
          nickname: 'Unknown',
          sex: 'unknown' as const
        },
        time: Math.floor(Date.now() / 1000),
        post_type: 'message' as const,
        self_id: 987654321
      };
    } else {
      minimalMessage = messageOrId;
    }

    const minimalUserInfo: UserInfo = {
      user_id: 0,
      nickname: 'Unknown',
      recent_interaction_count: 0,
      is_frequent_user: false
    };

    return {
      currentMessage: minimalMessage,
      recentMessages: [],
      userInfo: minimalUserInfo,
      groupInfo: undefined,
      conversationSummary: '上下文构建失败',
      topicKeywords: []
    };
  }

  /**
   * 检查上下文是否为技术相关
   */
  isContextTechnical(context: MessageContext): boolean {
    const technicalKeywords = [
      'api', 'bug', 'error', 'code', 'git', 'server', 'database',
      '错误', '代码', '开发', '部署', '服务器', '数据库'
    ];

    const allKeywords = context.topicKeywords || [];
    return allKeywords.some(keyword => 
      technicalKeywords.some(tech => 
        tech.toLowerCase().includes(keyword.toLowerCase()) ||
        keyword.toLowerCase().includes(tech.toLowerCase())
      )
    );
  }

  /**
   * 检查是否为活跃对话
   */
  isActiveConversation(context: MessageContext): boolean {
    return (context.recentMessages?.length || 0) >= 3;
  }

  /**
   * 获取对话参与者数量
   */
  getConversationParticipantCount(context: MessageContext): number {
    if (!context.recentMessages || context.recentMessages.length === 0) {
      return 1;
    }

    const uniqueUsers = new Set(
      context.recentMessages.map(msg => msg.user_id)
    );
    
    // 包括当前消息发送者
    uniqueUsers.add(context.currentMessage.user_id);
    
    return uniqueUsers.size;
  }

  /**
   * 获取上下文统计信息
   */
  getContextStats(): {
    totalContextsBuilt: number;
    averageBuildTime: number;
    cacheHitRate: number;
  } {
    // TODO: 实现真实的统计
    return {
      totalContextsBuilt: 0,
      averageBuildTime: 0,
      cacheHitRate: 0
    };
  }
}

export default ContextEngine;

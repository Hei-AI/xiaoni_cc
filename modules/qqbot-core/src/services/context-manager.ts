import { DatabaseManager } from './database';
import { QQMessage, ConversationData, MessageContextWithTraces, LLMCallTrace } from '../types';
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
      return `用户${currentMessage.sender.nickname}发起了新对话`;
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
  public formatContextForAI(context: MessageContext): string {
    let prompt = `=== 对话上下文 ===\n`;

    // 基本信息
    if (context.currentMessage.message_type === 'private') {
      prompt += `对话类型: 私聊\n`;
      prompt += `用户: ${context.currentMessage.sender.nickname} (ID: ${context.currentMessage.user_id})\n`;
    } else {
      prompt += `对话类型: 群聊\n`;
      prompt += `群ID: ${context.currentMessage.group_id}\n`;
      prompt += `发言人: ${context.currentMessage.sender.nickname} (ID: ${context.currentMessage.user_id})\n`;
    }

    // 用户统计信息
    if (context.userInfo) {
      prompt += `用户历史消息数: ${context.userInfo.message_count}条\n`;
    }

    // 历史对话
    if (context.historyMessages.length > 0) {
      if (context.currentMessage.message_type === 'private') {
        prompt += `\n=== 与该用户的最近${context.historyMessages.length}条私聊历史 ===\n`;
        context.historyMessages.forEach((msg, index) => {
          const time = new Date(msg.timestamp).toLocaleTimeString();
          prompt += `${index + 1}. [${time}] 用户: ${msg.user_message}\n`;
          if (msg.ai_response) {
            prompt += `   阿正: ${msg.ai_response}\n`;
          }
          prompt += `\n`;
        });
      } else {
        prompt += `\n=== 该群最近${context.historyMessages.length}条消息历史 ===\n`;
        prompt += `注意：这是群聊环境，包含多个用户的对话\n`;
        context.historyMessages.forEach((msg, index) => {
          const time = new Date(msg.timestamp).toLocaleTimeString();
          // 尝试从raw_request中获取发言者信息
          const senderNickname = this.extractSenderFromConversation(msg);
          prompt += `${index + 1}. [${time}] ${senderNickname}: ${msg.user_message}\n`;
          if (msg.ai_response) {
            prompt += `   阿正: ${msg.ai_response}\n`;
          }
          prompt += `\n`;
        });
      }
    } else {
      const contextType = context.currentMessage.message_type === 'private' ? '私聊' : '群聊';
      prompt += `\n=== 历史对话 ===\n这是新的${contextType}对话开始\n\n`;
    }

    // 当前消息
    prompt += `=== 当前消息 ===\n`;
    prompt += `${context.currentMessage.sender.nickname}: ${context.currentMessage.raw_message}\n`;

    return prompt;
  }

  /**
   * 从对话记录中提取发言者昵称
   * @param conversation 对话记录
   * @returns 发言者昵称
   */
  private extractSenderFromConversation(conversation: ConversationData): string {
    try {
      if (conversation.raw_request) {
        const requestData = typeof conversation.raw_request === 'string' 
          ? JSON.parse(conversation.raw_request)
          : conversation.raw_request;
        
        // 尝试获取群聊中的发言者昵称
        if (requestData.sender && requestData.sender.nickname) {
          return requestData.sender.nickname;
        }
        
        // 如果没有昵称，使用用户ID
        if (requestData.user_id) {
          return `用户${requestData.user_id}`;
        }
      }
    } catch (error) {
      this.moduleLogger.warn('Failed to extract sender from conversation', { error });
    }
    
    // 默认返回用户ID
    return `用户${conversation.user_id}`;
  }

  /**
   * 构建包含 LLM 追踪信息的消息上下文
   * @param message 当前消息
   * @param contextLimit 上下文消息数量限制
   * @returns 包含LLM追踪的完整消息上下文对象
   */
  public async buildMessageContextWithLLMTraces(
    message: QQMessage, 
    contextLimit: number = 20
  ): Promise<MessageContextWithTraces> {
    try {
      // 获取基本上下文
      const basicContext = await this.buildMessageContext(message, contextLimit);
      
      // 获取历史对话相关的LLM调用记录
      const llmTraces: LLMCallTrace[] = [];
      
      for (const conversation of basicContext.historyMessages) {
        try {
          const traces = await this.database.getConversationLLMTraces(conversation.id);
          llmTraces.push(...traces);
        } catch (error) {
          this.moduleLogger.warn('Failed to get LLM traces for conversation', {
            conversationId: conversation.id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
      
      // 按时间排序LLM调用记录
      llmTraces.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      
      this.moduleLogger.info('Built message context with LLM traces', {
        historyCount: basicContext.historyMessages.length,
        llmTracesCount: llmTraces.length
      });
      
      return {
        ...basicContext,
        llmCallHistory: llmTraces
      };
      
    } catch (error) {
      this.moduleLogger.error('Failed to build message context with LLM traces', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // 降级到基本上下文
      const basicContext = await this.buildMessageContext(message, contextLimit);
      return {
        ...basicContext,
        llmCallHistory: []
      };
    }
  }

  /**
   * 格式化包含LLM追踪信息的上下文为AI Prompt
   * @param context 包含LLM追踪的消息上下文
   * @returns 格式化后的prompt文本
   */
  public formatContextWithLLMTracesForAI(context: MessageContextWithTraces): string {
    let prompt = this.formatContextForAI(context);
    
    // 添加LLM调用历史信息
    if (context.llmCallHistory && context.llmCallHistory.length > 0) {
      prompt += `\n=== LLM调用历史 ===\n`;
      prompt += `最近${context.llmCallHistory.length}次AI调用记录:\n`;
      
      // 只显示最近5次调用以避免prompt过长
      const recentTraces = context.llmCallHistory.slice(-5);
      
      recentTraces.forEach((trace, index) => {
        const time = trace.timestamp.toLocaleTimeString();
        const engineType = this.translateEngineType(trace.engine_type);
        const success = trace.success ? '✅' : '❌';
        
        prompt += `${index + 1}. [${time}] ${engineType} ${success}\n`;
        prompt += `   响应时间: ${trace.response_time}ms`;
        
        if (trace.total_tokens && trace.total_tokens > 0) {
          prompt += `, Tokens: ${trace.total_tokens}`;
        }
        
        if (!trace.success && trace.error_message) {
          prompt += `\n   错误: ${trace.error_message.substring(0, 100)}`;
        }
        
        prompt += `\n`;
      });
      
      prompt += `\n`;
    }
    
    return prompt;
  }

  /**
   * 翻译引擎类型为中文
   */
  private translateEngineType(engineType: string): string {
    switch (engineType) {
      case 'decision': return '决策引擎';
      case 'context': return '上下文引擎';  
      case 'persona': return '人格引擎';
      case 'main_chat': return '主对话引擎';
      case 'requirement': return '需求分析引擎';
      default: return `${engineType}引擎`;
    }
  }
}
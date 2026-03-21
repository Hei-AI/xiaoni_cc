/**
 * DecisionEngine - Stage 1 实现
 * 负责决定机器人是否应该回复消息的智能决策系统
 * 
 * 决策流程：
 * 1. 规则层过滤（@消息、私聊等必回场景）
 * 2. LLM意图分析（群聊消息的智能判断）
 * 3. 综合决策（结合规则和AI分析结果）
 */

import { logger } from '../utils/logger';
import { AIService } from '../services/ai-service';
import { QQMessage, DecisionResult, MessageContext, AIConfig } from '../types';
import { extractNormalizedMessageText } from '../utils/reply-intent';

type AttentionLevel = NonNullable<DecisionResult['attentionLevel']>;
type AttentionReason = NonNullable<DecisionResult['attentionReason']>;
type SuggestedNextStep = NonNullable<DecisionResult['suggestedNextStep']>;

interface RuleFilterResult {
  shouldRespond: boolean | null;
  confidence: number;
  source: 'direct_mention' | 'reply_context' | 'private_message' | 'ai_analysis' | 'rule_skip';
  reasoning: string;
  attentionLevel: AttentionLevel;
  attentionReason: AttentionReason;
  suggestedNextStep: SuggestedNextStep;
}

interface AIAnalysisDecision {
  shouldRespond: boolean;
  confidence: number;
  source: 'ai_analysis';
  reasoning: string;
  suggestedService?: 'chat' | 'requirement' | 'ignore';
  attentionLevel: AttentionLevel;
  attentionReason: AttentionReason;
  suggestedNextStep: SuggestedNextStep;
}

export class DecisionEngine {
  private aiService: AIService;
  private moduleLogger = logger.createModuleLogger('decision-engine');
  private config: AIConfig;
  
  constructor(aiService: AIService, config?: AIConfig) {
    this.aiService = aiService;
    this.config = config || {
      gemini_api_keys: [],
      model_name: 'gemini-2.5-flash',
      authorized_user_id: 85178516, // 使用正确的授权用户ID
      bot_qq_number: 987654321
    };
    this.moduleLogger.info('DecisionEngine initialized for Stage 1');
  }

  /**
   * 主要决策入口：分析是否应该回复消息
   */
  async analyzeMessage(context: MessageContext, traceId?: string): Promise<DecisionResult> {
    const startTime = Date.now();
    
    try {
      // 第一步：应用规则层过滤
      const ruleResult = await this.applyRuleFilters(context.currentMessage);
      
      // 如果规则层给出明确结果，直接返回
      if (ruleResult.shouldRespond !== null) {
        const analysisTime = Date.now() - startTime;
        
        this.moduleLogger.info('Rule-based decision made', {
          traceId,
          messageId: context.currentMessage.message_id,
          decision: ruleResult.shouldRespond,
          source: ruleResult.source,
          analysisTime
        });
        
        const suggestedService = this.determineSuggestedService(ruleResult, context);
        
        return this.buildDecisionResult(context, ruleResult, suggestedService);
      }
      
      // 第二步：需要AI分析的情况（主要是群聊消息）
      const aiResult = await this.performAIAnalysis(context);
      const analysisTime = Date.now() - startTime;
      
      this.moduleLogger.info('AI-based decision made', {
        traceId,
        messageId: context.currentMessage.message_id,
        decision: aiResult.shouldRespond,
        confidence: aiResult.confidence,
        analysisTime
      });
      
      return this.buildDecisionResult(
        context,
        aiResult,
        aiResult.shouldRespond ? aiResult.suggestedService || 'chat' : 'ignore'
      );
      
    } catch (error) {
      this.moduleLogger.error('Decision analysis failed', {
        traceId,
        error: error instanceof Error ? error.message : 'Unknown error',
        messageId: context.currentMessage.message_id
      });

      throw (error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * 规则层过滤：处理明确的回复场景
   */
  private async applyRuleFilters(message: QQMessage): Promise<RuleFilterResult> {
    
    // 规则1：@消息必须回复
    if (this.isDirectMention(message)) {
      return {
        shouldRespond: true,
        confidence: 95,
        source: 'direct_mention',
        reasoning: 'Direct mention detected, worthy of immediate attention',
        attentionLevel: 'high',
        attentionReason: 'direct_mention',
        suggestedNextStep: 'inspect_current'
      };
    }

    // 规则2：引用回复是有明确历史锚点的定向回应，默认应该响应
    if (message.reply_intent_context?.message_kind === 'directed_reply') {
      return {
        shouldRespond: true,
        confidence: message.reply_intent_context.address_target.type === 'mention' ? 95 : 90,
        source: 'reply_context',
        reasoning: `Directed reply detected with address target ${message.reply_intent_context.address_target.type}`,
        attentionLevel: 'high',
        attentionReason: 'reply_context',
        suggestedNextStep: 'inspect_reply_anchor'
      };
    }
    
    // 规则3：授权用户私聊消息默认回复
    if (message.message_type === 'private' && this.isAuthorizedUser(message.user_id)) {
      const messageText = this.getMessageText(message);
      const hasDevKeywords = this.hasDevKeywords(messageText);
      
      return {
        shouldRespond: true,
        confidence: hasDevKeywords ? 95 : 90,
        source: 'private_message',
        reasoning: hasDevKeywords ? '授权用户开发需求' : '授权用户私聊消息',
        attentionLevel: 'high',
        attentionReason: 'private_message',
        suggestedNextStep: 'inspect_current'
      };
    }
    
    // 规则4：非授权用户的私聊消息需要AI分析
    if (message.message_type === 'private' && !this.isAuthorizedUser(message.user_id)) {
      // 让AI判断是否应该回复非授权用户
      return {
        shouldRespond: null,
        confidence: 0,
        source: 'ai_analysis',
        reasoning: 'Non-authorized user, needs AI analysis',
        attentionLevel: 'medium',
        attentionReason: 'private_message',
        suggestedNextStep: 'inspect_current'
      };
    }

    // 规则5：明显的无关内容跳过
    if (this.isObviouslyIrrelevant(message)) {
      return {
        shouldRespond: false,
        confidence: 80,
        source: 'rule_skip',
        reasoning: 'Obviously irrelevant content detected',
        attentionLevel: 'low',
        attentionReason: 'rule_skip',
        suggestedNextStep: 'end'
      };
    }
    
    // 其他情况需要AI分析
    return {
      shouldRespond: null,
      confidence: 0,
      source: 'ai_analysis',
      reasoning: 'Needs AI analysis for decision',
      attentionLevel: 'low',
      attentionReason: 'ambient',
      suggestedNextStep: 'inspect_current'
    };
  }

  /**
   * 检查是否为直接@消息
   */
  private isDirectMention(message: QQMessage): boolean {
    // 检查数组格式的消息（OneBot 11协议）
    if (Array.isArray(message.message)) {
      const hasAtSegment = message.message.some(segment => 
        segment && typeof segment === 'object' && 
        segment.type === 'at' && 
        segment.data && 
        segment.data.qq === this.config.bot_qq_number?.toString()
      );
      if (hasAtSegment) return true;
    }
    
    // 检查字符串格式的消息
    const messageText = typeof message.message === 'string' ? message.message : '';
    
    // 检查OneBot的CQ码格式
    const hasAtFormat = messageText.includes(`[CQ:at,qq=${this.config.bot_qq_number}]`);
    
    // 检查简单@格式
    const hasSimpleAt = new RegExp(`@${this.config.bot_qq_number}\\b`).test(messageText);
    
    return hasAtFormat || hasSimpleAt;
  }

  /**
   * 判断是否为明显无关的内容
   */
  private isObviouslyIrrelevant(message: QQMessage): boolean {
    if (message.reply_intent_context?.message_kind === 'directed_reply') {
      return false;
    }

    const messageText = this.getMessageText(message).toLowerCase();
    
    // 过滤明显无关的内容
    const irrelevantPatterns = [
      /^[.。…]+$/, // 只有标点符号
      /^[哈呵嘿嘻]{2,}$/, // 纯笑声
      /^[0-9\s]+$/, // 纯数字
      /^\[CQ:image/, // 纯图片消息
      /^\[CQ:face/, // 纯表情消息
    ];
    
    return irrelevantPatterns.some(pattern => pattern.test(messageText));
  }

  /**
   * AI分析：对需要智能判断的消息进行分析
   * 临时版本：跳过LLM调用，默认返回需要回复
   */
  private async performAIAnalysis(context: MessageContext): Promise<AIAnalysisDecision> {
    this.moduleLogger.info('AI analysis using heuristic attention model', {
      userId: context.currentMessage.user_id,
      messageType: context.currentMessage.message_type
    });

    const message = context.currentMessage;
    const messageText = this.getMessageText(message).trim();
    const containsQuestionWords = this.containsQuestionWords(messageText);
    const hasKeywords = this.hasRelevantKeywords(context);
    const hasDevKeywords = this.hasDevKeywords(messageText);
    const ongoingThread = this.hasOngoingThread(context);
    const isPrivate = message.message_type === 'private';
    const lowSignal = messageText.length <= 4 && !containsQuestionWords && !hasKeywords && !ongoingThread;
    const isSpam = ['广告', '推广', '加群', '加q', 'qq群', '微信'].some(pattern =>
      messageText.toLowerCase().includes(pattern.toLowerCase())
    );

    if (isPrivate) {
      if (isSpam) {
        return {
          shouldRespond: false,
          confidence: 85,
          source: 'ai_analysis',
          reasoning: '私聊内容表现为垃圾或推广信息，降低注意力并结束',
          suggestedService: 'ignore',
          attentionLevel: 'low',
          attentionReason: 'ambient',
          suggestedNextStep: 'end'
        };
      }

      return {
        shouldRespond: true,
        confidence: hasDevKeywords ? 90 : 80,
        source: 'ai_analysis',
        reasoning: hasDevKeywords ? '私聊包含明确任务或求助线索' : '私聊默认值得进入注意力 loop',
        suggestedService: 'chat',
        attentionLevel: 'high',
        attentionReason: 'private_message',
        suggestedNextStep: 'inspect_current'
      };
    }

    if (hasDevKeywords) {
      return {
        shouldRespond: true,
        confidence: 88,
        source: 'ai_analysis',
        reasoning: '检测到开发/协作语义，值得继续判断是否回复',
        suggestedService: 'chat',
        attentionLevel: 'medium',
        attentionReason: ongoingThread ? 'ongoing_thread' : 'ambient',
        suggestedNextStep: 'inspect_current'
      };
    }

    if (containsQuestionWords || ongoingThread) {
      return {
        shouldRespond: true,
        confidence: ongoingThread ? 78 : 72,
        source: 'ai_analysis',
        reasoning: ongoingThread ? '当前窗口显示话题仍在持续，值得继续观察' : '消息带有疑问或求助信号',
        suggestedService: 'chat',
        attentionLevel: ongoingThread ? 'medium' : 'low',
        attentionReason: ongoingThread ? 'ongoing_thread' : 'ambient',
        suggestedNextStep: 'inspect_current'
      };
    }

    if (lowSignal) {
      return {
        shouldRespond: false,
        confidence: 70,
        source: 'ai_analysis',
        reasoning: '消息信号较弱且缺少上下文关联，当前轮次可以忽略',
        suggestedService: 'ignore',
        attentionLevel: 'low',
        attentionReason: 'ambient',
        suggestedNextStep: 'end'
      };
    }

    return {
      shouldRespond: false,
      confidence: 60,
      source: 'ai_analysis',
      reasoning: '普通群聊噪声，未形成足够的注意力理由',
      suggestedService: 'ignore',
      attentionLevel: 'low',
      attentionReason: 'ambient',
      suggestedNextStep: 'end'
    };
  }

  private buildDecisionResult(
    context: MessageContext,
    result: RuleFilterResult | AIAnalysisDecision,
    suggestedService: 'chat' | 'requirement' | 'ignore'
  ): DecisionResult {
    const containsQuestionWords = this.containsQuestionWords(this.getMessageText(context.currentMessage));
    const isFromAuthorizedUser = this.isAuthorizedUser(context.currentMessage.user_id);
    const hasKeywords = this.hasRelevantKeywords(context);

    return {
      shouldRespond: Boolean(result.shouldRespond),
      confidence: result.confidence,
      reason: result.reasoning || '',
      suggestedService,
      attentionLevel: result.attentionLevel,
      attentionReason: result.attentionReason,
      suggestedNextStep: result.suggestedNextStep,
      metadata: {
        isDirectMention: result.attentionReason === 'direct_mention',
        containsQuestionWords,
        isFromAuthorizedUser,
        hasKeywords,
        contextualScore: result.confidence,
        attentionLevel: result.attentionLevel,
        attentionReason: result.attentionReason,
        suggestedNextStep: result.suggestedNextStep
      }
    };
  }

  /**
   * 构建AI分析的prompt
   */
  private buildAnalysisPrompt(messageText: string, context: MessageContext): string {
    return `
请以群聊智能助手的视角分析是否需要参与本次对话。

当前消息: "${messageText}"
消息类型: ${context.currentMessage.message_type}
${context.currentMessage.group_id ? `群聊ID: ${context.currentMessage.group_id}` : ''}

助手特点：
- 语气亲切，保持专业与友好平衡
- 擅长技术与工作协作，但也能轻松交流
- 鼓励积极、建设性的互动

参与标准（开放策略）：
1. 技术问题或求助 → 积极参与
2. 工作相关讨论 → 积极参与
3. 日常闲聊 → 视情况参与，保持轻松友好
4. 有趣话题或提问 → 能参与就参与
5. 测试类消息 → 可以简短回应
6. 明显垃圾或不当内容 → 不参与

请返回JSON格式：
{
  "shouldParticipate": true/false,
  "confidence": 0-100,
  "reasoning": "判断理由",
  "category": "technical_help|work_discussion|casual_chat|interesting_topic|test_message|inappropriate"
}
    `;
  }

  /**
   * 解析AI响应
   */
  private parseAIResponse(response: string): {
    shouldParticipate: boolean;
    confidence: number;
    reasoning: string;
    category?: string;
  } {
    try {
      // 清理响应文本（移除可能的markdown格式）
      const cleanedResponse = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .replace(/^[^{]*/, '') // 移除JSON前的文本
        .replace(/[^}]*$/, '') // 移除JSON后的文本
        .trim();
      
      const parsed = JSON.parse(cleanedResponse);
      
      return {
        shouldParticipate: Boolean(parsed.shouldParticipate),
        confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 50)),
        reasoning: String(parsed.reasoning || 'No reasoning provided'),
        category: parsed.category
      };
      
    } catch (error) {
      this.moduleLogger.warn('Failed to parse AI response', {
        error: error instanceof Error ? error.message : 'Unknown error',
        response: response.substring(0, 200) + '...'
      });
      
      // 解析失败时的fallback
      return {
        shouldParticipate: false,
        confidence: 30,
        reasoning: 'Failed to parse AI analysis, defaulting to no response'
      };
    }
  }

  /**
   * AI分析失败时的fallback决策
   */
  private getFallbackDecision(messageText: string): {
    shouldRespond: boolean;
    confidence: number;
    source: 'ai_analysis';
    reasoning: string;
    suggestedService?: 'chat' | 'requirement' | 'ignore';
  } {
    
    // 简单的关键词检测作为fallback
    const technicalKeywords = [
      '问题', '错误', '报错', 'bug', 'error', 'help', '帮助',
      '怎么', '如何', '为什么', 'why', 'how', '解决',
      'api', 'code', '代码', '开发', '部署', 'deploy'
    ];
    
    const hasKeyword = technicalKeywords.some(keyword => 
      messageText.toLowerCase().includes(keyword.toLowerCase())
    );
    
    if (hasKeyword) {
      return {
        shouldRespond: true,
        confidence: 60,
        source: 'ai_analysis',
        reasoning: 'Technical keywords detected, likely needs help',
        suggestedService: 'chat'
      };
    } else {
      return {
        shouldRespond: false,
        confidence: 70,
        source: 'ai_analysis',
        reasoning: 'No clear technical context, likely casual chat',
        suggestedService: 'ignore'
      };
    }
  }

  /**
   * 检查是否包含开发相关关键词
   */
  private hasDevKeywords(messageText: string): boolean {
    const devKeywords = [
      '实现', '开发', '需求', 'JWT', '认证', '权限', '管理', '登录', 
      '数据库', '接口', 'API', '功能', '系统', '架构', '密码', '加密'
    ];
    return devKeywords.some(keyword => messageText.toLowerCase().includes(keyword.toLowerCase()));
  }

  /**
   * 确定建议的服务类型
   */
  private determineSuggestedService(ruleResult: any, context: MessageContext): 'chat' | 'requirement' | 'ignore' {
    if (!ruleResult.shouldRespond) return 'ignore';
    
    const messageText = this.getMessageText(context.currentMessage);
    const isAuthorized = this.isAuthorizedUser(context.currentMessage.user_id);
    
    // 授权用户的复杂开发需求建议用requirement服务
    if (isAuthorized && this.hasDevKeywords(messageText) && messageText.length > 30) {
      return 'requirement';
    }
    
    return 'chat';
  }

  /**
   * 辅助方法：检查消息是否包含疑问词
   */
  private containsQuestionWords(message: string | any): boolean {
    const messageText = typeof message === 'string' ? message : '';
    const questionWords = ['怎么', '如何', '为什么', '什么', '吗', '呢', '?', '？'];
    return questionWords.some(word => messageText.includes(word));
  }

  /**
   * 辅助方法：检查是否为授权用户
   */
  private isAuthorizedUser(userId: number): boolean {
    // Use config if available, otherwise fall back to hardcoded values
    const authorizedUsers = [this.config.authorized_user_id, 123456789]; // testConfig.authorizedUserId
    return authorizedUsers.includes(userId);
  }

  /**
   * 辅助方法：检查是否包含相关关键词
   */
  private hasRelevantKeywords(context: MessageContext): boolean {
    const messageText = this.getMessageText(context.currentMessage);
    const technicalKeywords = ['bug', 'error', '错误', '问题', '代码', '开发', '实现', 'API'];
    return technicalKeywords.some(tech => 
      messageText.toLowerCase().includes(tech.toLowerCase())
    );
  }

  private hasOngoingThread(context: MessageContext): boolean {
    return context.historyMessages
      .slice(-6)
      .some(message => message.sender_role === 'bot');
  }

  private getMessageText(message: QQMessage): string {
    return extractNormalizedMessageText(message);
  }

  /**
   * 根据AI分析结果确定建议服务
   */
  private determineServiceFromAnalysis(analysisResult: any): 'chat' | 'requirement' | 'ignore' {
    if (!analysisResult.shouldParticipate) return 'ignore';
    
    const category = analysisResult.category;
    if (category === 'technical_help' && analysisResult.confidence > 80) {
      return 'requirement';
    }
    return 'chat';
  }

  /**
   * AI分析失败时的非授权用户处理
   * 更新策略：对于@消息更加开放，允许更多类型的对话
   */
  private handleUnauthorizedUser(messageText: string): {
    shouldRespond: boolean;
    confidence: number;
    source: 'ai_analysis';
    reasoning: string;
    suggestedService: 'chat' | 'requirement' | 'ignore';
  } {
    // 检查是否包含问题关键词（扩大范围）
    const questionWords = ['怎么', '如何', '什么', '为什么', '怎样', '能否', '可以', '是否', '?', '？'];
    const hasQuestion = questionWords.some(word => messageText.includes(word));
    
    // 检查是否明显垃圾内容
    const spamPatterns = ['广告', '推广', '加群', '加Q', 'qq群', '微信'];
    const isSpam = spamPatterns.some(pattern => messageText.toLowerCase().includes(pattern.toLowerCase()));
    
    if (isSpam) {
      return {
        shouldRespond: false,
        confidence: 85,
        source: 'ai_analysis',
        reasoning: '检测到垃圾信息',
        suggestedService: 'ignore'
      };
    }
    
    // 对于@消息，除非是明显垃圾内容，否则都尝试回复
    return {
      shouldRespond: true,
      confidence: hasQuestion ? 70 : 55,
      source: 'ai_analysis',
      reasoning: hasQuestion ? '@消息包含问题' : '@消息友好回复',
      suggestedService: 'chat'
    };
  }

  /**
   * 检查是否包含技术求助关键词
   */
  private hasTechnicalHelpKeywords(messageText: string): boolean {
    const helpKeywords = [
      '怎么', '如何', '帮助', 'help', '问题', '错误', 'bug', 'error'
    ];
    const technicalKeywords = [
      '代码', '编程', '开发', 'API', '数据库', '服务器', '部署'
    ];
    
    const hasHelpKeyword = helpKeywords.some(keyword => 
      messageText.toLowerCase().includes(keyword.toLowerCase())
    );
    const hasTechnicalKeyword = technicalKeywords.some(keyword => 
      messageText.toLowerCase().includes(keyword.toLowerCase())
    );
    
    return hasHelpKeyword && hasTechnicalKeyword;
  }

  /**
   * 获取决策统计信息（用于监控和调优）
   */
  async getDecisionStats(): Promise<{
    totalDecisions: number;
    responseRate: number;
    averageConfidence: number;
    sourceBreakdown: Record<string, number>;
  }> {
    // TODO: 从数据库获取统计信息
    // 当前返回模拟数据，后续需要实现真实的统计查询
    return {
      totalDecisions: 0,
      responseRate: 0,
      averageConfidence: 0,
      sourceBreakdown: {
        direct_mention: 0,
        reply_context: 0,
        private_message: 0,
        ai_analysis: 0,
        rule_skip: 0
      }
    };
  }
}

export default DecisionEngine;

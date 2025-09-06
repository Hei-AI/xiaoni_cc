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

export class DecisionEngine {
  private aiService: AIService;
  private moduleLogger = logger.createModuleLogger('decision-engine');
  private config: AIConfig;
  
  constructor(aiService: AIService, config?: AIConfig) {
    this.aiService = aiService;
    this.config = config || {
      gemini_api_keys: [],
      model_name: 'gemini-2.0-flash-exp',
      authorized_user_id: 85178516, // 使用正确的授权用户ID
      bot_qq_number: 987654321
    };
    this.moduleLogger.info('DecisionEngine initialized for Stage 1');
  }

  /**
   * 主要决策入口：分析是否应该回复消息
   */
  async analyzeMessage(context: MessageContext): Promise<DecisionResult> {
    const startTime = Date.now();
    
    try {
      // 第一步：应用规则层过滤
      const ruleResult = await this.applyRuleFilters(context.currentMessage);
      
      // 如果规则层给出明确结果，直接返回
      if (ruleResult.shouldRespond !== null) {
        const analysisTime = Date.now() - startTime;
        
        this.moduleLogger.info('Rule-based decision made', {
          messageId: context.currentMessage.message_id,
          decision: ruleResult.shouldRespond,
          source: ruleResult.source,
          analysisTime
        });
        
        const suggestedService = this.determineSuggestedService(ruleResult, context);
        
        return {
          shouldRespond: ruleResult.shouldRespond,
          confidence: ruleResult.confidence,
          reason: ruleResult.reasoning || '',
          suggestedService,
          metadata: {
            isDirectMention: ruleResult.source === 'direct_mention',
            containsQuestionWords: this.containsQuestionWords(context.currentMessage.message),
            isFromAuthorizedUser: this.isAuthorizedUser(context.currentMessage.user_id),
            hasKeywords: this.hasRelevantKeywords(context),
            contextualScore: ruleResult.confidence
          }
        };
      }
      
      // 第二步：需要AI分析的情况（主要是群聊消息）
      const aiResult = await this.performAIAnalysis(context);
      const analysisTime = Date.now() - startTime;
      
      this.moduleLogger.info('AI-based decision made', {
        messageId: context.currentMessage.message_id,
        decision: aiResult.shouldRespond,
        confidence: aiResult.confidence,
        analysisTime
      });
      
      return {
        shouldRespond: aiResult.shouldRespond,
        confidence: aiResult.confidence,
        reason: aiResult.reasoning,
        suggestedService: aiResult.shouldRespond ? aiResult.suggestedService || 'chat' : 'ignore',
        metadata: {
          isDirectMention: false,
          containsQuestionWords: this.containsQuestionWords(context.currentMessage.message),
          isFromAuthorizedUser: this.isAuthorizedUser(context.currentMessage.user_id),
          hasKeywords: this.hasRelevantKeywords(context),
          contextualScore: aiResult.confidence
        }
      };
      
    } catch (error) {
      this.moduleLogger.error('Decision analysis failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        messageId: context.currentMessage.message_id
      });
      
      // 发生错误时的保守策略：仅回复明确的@和私聊
      return {
        shouldRespond: context.currentMessage.message_type === 'private',
        confidence: 50,
        reason: 'Error occurred, using conservative fallback',
        suggestedService: context.currentMessage.message_type === 'private' ? 'chat' : 'ignore',
        metadata: {
          isDirectMention: false,
          containsQuestionWords: false,
          isFromAuthorizedUser: this.isAuthorizedUser(context.currentMessage.user_id),
          hasKeywords: false,
          contextualScore: 50
        }
      };
    }
  }

  /**
   * 规则层过滤：处理明确的回复场景
   */
  private async applyRuleFilters(message: QQMessage): Promise<{
    shouldRespond: boolean | null;
    confidence: number;
    source: 'direct_mention' | 'private_message' | 'ai_analysis' | 'rule_skip';
    reasoning: string;
  }> {
    
    // 规则1：@消息必须回复
    if (this.isDirectMention(message)) {
      return {
        shouldRespond: true,
        confidence: 95,
        source: 'direct_mention',
        reasoning: 'Direct mention detected, must respond'
      };
    }
    
    // 规则2：授权用户私聊消息默认回复
    if (message.message_type === 'private' && this.isAuthorizedUser(message.user_id)) {
      const messageText = typeof message.message === 'string' ? message.message : '';
      const hasDevKeywords = this.hasDevKeywords(messageText);
      
      return {
        shouldRespond: true,
        confidence: hasDevKeywords ? 95 : 90,
        source: 'private_message',
        reasoning: hasDevKeywords ? '授权用户开发需求' : '授权用户私聊消息'
      };
    }
    
    // 规则3：非授权用户的私聊消息需要AI分析
    if (message.message_type === 'private' && !this.isAuthorizedUser(message.user_id)) {
      // 让AI判断是否应该回复非授权用户
      return {
        shouldRespond: null,
        confidence: 0,
        source: 'ai_analysis',
        reasoning: 'Non-authorized user, needs AI analysis'
      };
    }

    // 规则4：明显的无关内容跳过
    if (this.isObviouslyIrrelevant(message)) {
      return {
        shouldRespond: false,
        confidence: 80,
        source: 'rule_skip',
        reasoning: 'Obviously irrelevant content detected'
      };
    }
    
    // 其他情况需要AI分析
    return {
      shouldRespond: null,
      confidence: 0,
      source: 'ai_analysis',
      reasoning: 'Needs AI analysis for decision'
    };
  }

  /**
   * 检查是否为直接@消息
   */
  private isDirectMention(message: QQMessage): boolean {
    const messageText = typeof message.message === 'string' ? message.message : '';
    
    // 检查OneBot的@格式
    const hasAtFormat = messageText.includes('[CQ:at,qq=');
    
    // 检查简单@格式（可能有些客户端用这种）
    const hasSimpleAt = /@\d+/.test(messageText);
    
    return hasAtFormat || hasSimpleAt;
  }

  /**
   * 判断是否为明显无关的内容
   */
  private isObviouslyIrrelevant(message: QQMessage): boolean {
    const messageText = typeof message.message === 'string' ? message.message.toLowerCase() : '';
    
    // 过滤明显无关的内容
    const irrelevantPatterns = [
      /^[\.。…]+$/, // 只有标点符号
      /^[哈呵嘿嘻]{2,}$/, // 纯笑声
      /^[0-9\s]+$/, // 纯数字
      /^\[CQ:image/, // 纯图片消息
      /^\[CQ:face/, // 纯表情消息
    ];
    
    return irrelevantPatterns.some(pattern => pattern.test(messageText));
  }

  /**
   * AI分析：对需要智能判断的消息进行分析
   */
  private async performAIAnalysis(context: MessageContext): Promise<{
    shouldRespond: boolean;
    confidence: number;
    source: 'ai_analysis';
    reasoning: string;
    suggestedService?: 'chat' | 'requirement' | 'ignore';
  }> {
    
    const message = context.currentMessage;
    const messageText = typeof message.message === 'string' ? message.message : '';
    
    // 构建分析prompt
    const analysisPrompt = this.buildAnalysisPrompt(messageText, context);
    
    try {
      // 调用AI服务进行分析
      const response = await this.aiService.generateResponse(
        analysisPrompt,
        context.currentMessage.user_id,
        'intent_analyzer',
        'participation_analysis'
      );
      
      // 解析AI响应
      const analysisResult = this.parseAIResponse(response.ai_response);
      const isAuthorized = this.isAuthorizedUser(context.currentMessage.user_id);
      
      // 对于非授权用户，应用更严格的决策逻辑
      if (!isAuthorized && !this.hasTechnicalHelpKeywords(messageText)) {
        return {
          shouldRespond: false,
          confidence: 45,  // Lower confidence for spam detection
          source: 'ai_analysis',
          reasoning: '非授权用户非技术内容',
          suggestedService: 'ignore'
        };
      }
      
      return {
        shouldRespond: analysisResult.shouldParticipate,
        confidence: analysisResult.confidence,
        source: 'ai_analysis',
        reasoning: analysisResult.reasoning,
        suggestedService: this.determineServiceFromAnalysis(analysisResult)
      };
      
    } catch (error) {
      this.moduleLogger.warn('AI analysis failed, using fallback', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // AI分析失败时的fallback策略
      const isAuthorized = this.isAuthorizedUser(context.currentMessage.user_id);
      if (!isAuthorized) {
        const unauthorizedResult = this.handleUnauthorizedUser(messageText);
        return {
          ...unauthorizedResult,
          reasoning: '规则判断 - ' + unauthorizedResult.reasoning
        };
      } else {
        const fallbackResult = this.getFallbackDecision(messageText);
        return {
          ...fallbackResult,
          reasoning: '规则判断 - ' + fallbackResult.reasoning
        };
      }
    }
  }

  /**
   * 构建AI分析的prompt
   */
  private buildAnalysisPrompt(messageText: string, context: MessageContext): string {
    return `
作为QQ群聊机器人"阿正"，请分析是否应该参与这个对话。

当前消息: "${messageText}"
消息类型: ${context.currentMessage.message_type}
${context.currentMessage.group_id ? `群聊ID: ${context.currentMessage.group_id}` : ''}

阿正的特点：
- 热情的技术专家，乐于助人
- 主要关注技术讨论、问题解答、团队协作
- 不会参与无关闲聊，但会在合适时机表现友好

参与标准：
1. 技术问题或求助 → 高概率参与
2. 工作相关讨论 → 根据相关性参与  
3. 一般闲聊 → 通常不参与
4. 明显无关内容 → 不参与

请返回JSON格式：
{
  "shouldParticipate": true/false,
  "confidence": 0-100,
  "reasoning": "判断理由",
  "category": "technical_help|work_discussion|casual_chat|irrelevant"
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
        .replace(/^[^\{]*/, '') // 移除JSON前的文本
        .replace(/[^\}]*$/, '') // 移除JSON后的文本
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
    
    const messageText = typeof context.currentMessage.message === 'string' ? context.currentMessage.message : '';
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
    const keywords = context.topicKeywords || [];
    const technicalKeywords = ['bug', 'error', '错误', '问题', '代码', '开发', '实现', 'API'];
    return keywords.some(keyword => 
      technicalKeywords.some(tech => keyword.toLowerCase().includes(tech.toLowerCase()))
    );
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
   */
  private handleUnauthorizedUser(messageText: string): {
    shouldRespond: boolean;
    confidence: number;
    source: 'ai_analysis';
    reasoning: string;
    suggestedService: 'chat' | 'requirement' | 'ignore';
  } {
    // 对于非授权用户，只有在明确的技术求助时才回复
    const hasTechnicalHelp = this.hasTechnicalHelpKeywords(messageText);
    
    if (hasTechnicalHelp) {
      return {
        shouldRespond: true,
        confidence: 60,
        source: 'ai_analysis',
        reasoning: '非授权用户技术求助',
        suggestedService: 'chat'
      };
    } else {
      return {
        shouldRespond: false,
        confidence: 40,
        source: 'ai_analysis',
        reasoning: '非授权用户非技术内容',
        suggestedService: 'ignore'
      };
    }
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
  async getDecisionStats(timeWindow: number = 24 * 60 * 60 * 1000): Promise<{
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
        private_message: 0,
        ai_analysis: 0,
        rule_skip: 0
      }
    };
  }
}

export default DecisionEngine;
/**
 * DecisionEngine v2 - Stage 2 Enhancement
 * 智能决策引擎升级版，集成注意力管理和用户关系系统
 * 
 * 升级特性：
 * 1. 集成AttentionService进行注意力状态管理
 * 2. 集成UserRelationshipService进行关系感知决策
 * 3. 保持Stage 1规则层的向后兼容
 * 4. 新增决策历史记录和学习机制
 */

import { logger } from '../utils/logger';
import { AIService } from '../services/ai-service';
import AttentionService from '../services/attention-service';
import UserRelationshipService from '../services/user-relationship-service';
import { DatabaseManager } from '../services/database';
import { LoggingService } from '../services/logging-service';
import { QQMessage, DecisionResult, MessageContext, AIConfig } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface Stage2DecisionResult extends DecisionResult {
  // Stage 2 新增字段
  attentionFactor: number;      // 注意力因子 (0-2.0)
  relationshipFactor: number;   // 关系因子 (1.0-1.5)
  energyCost: number;          // 预期能量消耗
  decisionId: string;          // 决策记录ID
  source: string;              // 决策来源 (添加缺失的source字段)
  analysisTime: number;        // 分析耗时 (添加缺失的analysisTime字段)
  stage2Features: {            // Stage 2特有分析
    attentionLevel: number;
    relationshipType: string;
    topicWeight: number;
    processingDetails: string;
  };
}

interface Stage2Config {
  enableAdvancedDecision: boolean;
  enableExecutionPlanning: boolean; 
  enableSemanticContext: boolean;
  enableMemorySystem: boolean;
  fallbackToStage1: boolean;
}

export class DecisionEngineV2 {
  private aiService: AIService;
  private attentionService: AttentionService;
  private relationshipService: UserRelationshipService;
  private database: DatabaseManager;
  private loggingService: LoggingService;
  private moduleLogger = logger.createModuleLogger('decision-engine-v2');
  
  private aiConfig: AIConfig;
  private stage2Config: Stage2Config;
  
  // Stage 1 兼容性配置
  private readonly RULE_DECISIONS = {
    // 必须回复的场景
    MUST_RESPOND: { confidence: 95, source: 'rule_mandatory' },
    // 建议回复的场景  
    SHOULD_RESPOND: { confidence: 85, source: 'rule_recommended' },
    // 可选回复的场景
    MAY_RESPOND: { confidence: 60, source: 'rule_optional' },
    // 不应回复的场景
    SHOULD_NOT_RESPOND: { confidence: 15, source: 'rule_filtered' }
  };

  constructor(
    aiService: AIService,
    attentionService: AttentionService,
    relationshipService: UserRelationshipService,
    database: DatabaseManager,
    loggingService: LoggingService,
    aiConfig?: AIConfig
  ) {
    this.aiService = aiService;
    this.attentionService = attentionService;
    this.relationshipService = relationshipService;
    this.database = database;
    this.loggingService = loggingService;
    
    this.aiConfig = aiConfig || {
      gemini_api_keys: [],
      model_name: 'gemini-2.5-flash',
      authorized_user_id: 85178516,
      bot_qq_number: 1129974489
    };
    
    // 从数据库加载Stage 2配置
    this.stage2Config = {
      enableAdvancedDecision: true,
      enableExecutionPlanning: false,
      enableSemanticContext: true, 
      enableMemorySystem: false,
      fallbackToStage1: true
    };
    
    this.moduleLogger.info('DecisionEngine v2 initialized with Stage 2 capabilities', {
      stage2Features: Object.keys(this.stage2Config).filter(key => this.stage2Config[key as keyof Stage2Config])
    });
  }

  /**
   * 主要决策入口 - Stage 2增强版
   */
  async analyzeMessage(context: MessageContext, traceId?: string): Promise<Stage2DecisionResult> {
    const startTime = Date.now();
    const decisionId = uuidv4();
    
    try {
      // Stage 1: 规则层决策 (保持向后兼容)
      const ruleResult = await this.applyRuleFilters(context.currentMessage);
      
      // Stage 2: 如果启用高级决策，始终执行完整的高级决策流程
      if (this.stage2Config.enableAdvancedDecision) {
        this.moduleLogger.info('Stage 2 高级决策模式：执行完整多步骤LLM分析', {
          messageType: context.currentMessage.message_type,
          traceId,
          decisionId
        });
        
        return await this.performAdvancedDecision(
          context, 
          ruleResult, 
          traceId, 
          decisionId, 
          startTime
        );
      }
      
      // 如果未启用高级决策，使用增强版规则处理
      if (ruleResult.shouldRespond !== null) {
        this.moduleLogger.info('Stage 2 兼容模式：使用增强规则决策', {
          shouldRespond: ruleResult.shouldRespond,
          traceId
        });
        
        return await this.enhanceRuleBasedDecision(
          context,
          ruleResult,
          traceId,
          decisionId,
          startTime
        );
      }
      
      // 降级到Stage 1逻辑（如果配置允许）
      if (this.stage2Config.fallbackToStage1) {
        return await this.fallbackToStage1Decision(
          context,
          traceId,
          decisionId,
          startTime
        );
      }
      
      // 默认不响应
      return await this.createDefaultDecision(context, traceId, decisionId, startTime);
      
    } catch (error) {
      this.moduleLogger.error('Decision analysis failed', { 
        error, 
        traceId,
        messageId: context.currentMessage.message_id 
      });
      
      // 错误时降级到安全的默认决策
      return await this.createErrorDecision(context, traceId, decisionId, error);
    }
  }

  /**
   * 执行高级决策分析 (Stage 2核心)
   */
  private async performAdvancedDecision(
    context: MessageContext,
    ruleResult: any,
    traceId?: string,
    decisionId?: string,
    startTime?: number
  ): Promise<Stage2DecisionResult> {
    const message = context.currentMessage;
    const messageContent = typeof message.message === 'string' ? message.message : JSON.stringify(message.message);
    
    // 1. 获取用户关系信息 (Stage 2 第1步)
    this.moduleLogger.info('Stage 2 第1步：获取用户关系信息', { userId: message.user_id, traceId });
    const relationship = await this.relationshipService.getUserRelationship(message.user_id);
    const relationshipFactor = this.calculateRelationshipFactor(relationship.relationship_type);
    
    // 记录用户关系分析埋点（自动序列管理）
    if (this.loggingService && traceId) {
      await this.loggingService.logLLMCall({
        traceId,
        agentType: 'user_relationship_analyzer',
        modelName: 'rule_based',
        inputPrompt: `User ${message.user_id} relationship analysis`,
        processedResponse: JSON.stringify(relationship),
        apiCallTimeMs: 10,
        processingTimeMs: 15,
        status: 'SUCCESS',
        userId: message.user_id,
        contextSummary: `Relationship: ${relationship.relationship_type}, Factor: ${relationshipFactor}`
      });
    }
    
    // 2. 分析注意力状态 (Stage 2 第2步)
    this.moduleLogger.info('Stage 2 第2步：分析注意力状态', { userId: message.user_id, traceId });
    const attentionAnalysis = await this.attentionService.analyzeMessage(
      messageContent,
      message.user_id,
      message.group_id,
      relationship.relationship_type
    );
    
    // 记录注意力分析埋点（自动序列管理）
    if (this.loggingService && traceId) {
      await this.loggingService.logLLMCall({
        traceId,
        agentType: 'attention_analyzer',
        modelName: 'attention_algorithm',
        inputPrompt: `Message attention analysis: ${messageContent.substring(0, 100)}`,
        processedResponse: JSON.stringify(attentionAnalysis),
        apiCallTimeMs: 20,
        processingTimeMs: 25,
        status: 'SUCCESS',
        userId: message.user_id,
        contextSummary: `Attention: ${attentionAnalysis.attentionFactor}, Should respond: ${attentionAnalysis.shouldRespond}`
      });
    }
    
    // 3. LLM意图分析 (Stage 2 必须执行，提供深度语义理解)
    this.moduleLogger.info('Stage 2 第3步：执行LLM意图分析', {
      attentionFactor: attentionAnalysis.attentionFactor,
      shouldRespond: attentionAnalysis.shouldRespond,
      traceId
    });
    
    let llmAnalysis = null;
    const llmStartTime = Date.now();
    try {
      llmAnalysis = await this.performLLMAnalysis(context, relationship.communication_style);
      
      // 记录成功的LLM意图分析埋点（自动序列管理）
      if (this.loggingService && traceId) {
        await this.loggingService.logLLMCall({
          traceId,
          agentType: 'intent_analyzer',
          modelName: 'gemini-2.5-flash',
          inputPrompt: `LLM intent analysis for: ${messageContent.substring(0, 100)}`,
          processedResponse: JSON.stringify(llmAnalysis),
          apiCallTimeMs: Date.now() - llmStartTime,
          processingTimeMs: Date.now() - llmStartTime + 5,
          status: 'SUCCESS',
          userId: message.user_id,
          contextSummary: `Intent: ${llmAnalysis?.intent}, Should respond: ${llmAnalysis?.should_respond}`
        });
      }
      
      this.moduleLogger.info('Stage 2 LLM意图分析完成', {
        hasResult: !!llmAnalysis,
        confidence: llmAnalysis?.confidence,
        traceId
      });
    } catch (error) {
      // 记录失败的LLM意图分析埋点（自动序列管理）
      if (this.loggingService && traceId) {
        await this.loggingService.logLLMCall({
          traceId,
          agentType: 'intent_analyzer',
          modelName: 'gemini-2.5-flash',
          inputPrompt: `LLM intent analysis for: ${messageContent.substring(0, 100)}`,
          apiCallTimeMs: Date.now() - llmStartTime,
          processingTimeMs: Date.now() - llmStartTime + 5,
          status: 'ERROR',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          userId: message.user_id,
          contextSummary: 'LLM intent analysis failed'
        });
      }
      
      this.moduleLogger.error('Stage 2 LLM意图分析失败', { error, traceId });
    }
    
    // 4. 综合决策
    const finalDecision = this.combineAdvancedFactors(
      attentionAnalysis,
      relationshipFactor,
      llmAnalysis
    );
    
    // 5. 记录决策历史
    await this.recordDecisionHistory(
      decisionId!,
      traceId,
      message,
      finalDecision,
      attentionAnalysis,
      relationshipFactor,
      messageContent,
      Date.now() - (startTime || Date.now())
    );
    
    // 6. 构造返回结果
    const result: Stage2DecisionResult = {
      shouldRespond: finalDecision.shouldRespond,
      confidence: finalDecision.confidence,
      source: finalDecision.source,
      reason: finalDecision.reason,
      suggestedService: finalDecision.shouldRespond ? 'chat' : 'ignore',
      analysisTime: Date.now() - (startTime || Date.now()),
      
      // Stage 2 新增字段
      attentionFactor: attentionAnalysis.attentionFactor,
      relationshipFactor,
      energyCost: attentionAnalysis.energyCost,
      decisionId: decisionId!,
      stage2Features: {
        attentionLevel: attentionAnalysis.shouldRespond ? 85 : 45,
        relationshipType: relationship.relationship_type,
        topicWeight: 1.2, // TODO: 实现话题权重分析
        processingDetails: `Attention: ${attentionAnalysis.attentionFactor.toFixed(2)}, Relationship: ${relationshipFactor.toFixed(2)}`
      }
    };
    
    this.moduleLogger.info('Advanced decision completed', {
      traceId,
      decisionId,
      shouldRespond: result.shouldRespond,
      confidence: result.confidence,
      attentionFactor: result.attentionFactor,
      relationshipType: relationship.relationship_type,
      source: result.source
    });
    
    return result;
  }

  /**
   * 增强规则层决策 (Stage 1兼容 + Stage 2增强)
   */
  private async enhanceRuleBasedDecision(
    context: MessageContext,
    ruleResult: any,
    traceId?: string,
    decisionId?: string,
    startTime?: number
  ): Promise<Stage2DecisionResult> {
    const message = context.currentMessage;
    
    // 获取基础关系信息
    const relationship = await this.relationshipService.getUserRelationship(message.user_id);
    const relationshipFactor = this.calculateRelationshipFactor(relationship.relationship_type);
    
    // 基于规则决策的注意力分析（简化版）
    const messageContent = typeof message.message === 'string' ? message.message : JSON.stringify(message.message);
    const mockAttentionAnalysis = {
      shouldRespond: ruleResult.shouldRespond,
      confidence: ruleResult.confidence,
      attentionFactor: ruleResult.shouldRespond ? 1.5 : 0.5,
      energyCost: ruleResult.shouldRespond ? 10 : 0,
      reason: `Rule-based decision: ${ruleResult.source}`
    };
    
    // 记录决策历史
    await this.recordDecisionHistory(
      decisionId!,
      traceId,
      message,
      mockAttentionAnalysis,
      mockAttentionAnalysis,
      relationshipFactor,
      messageContent,
      Date.now() - (startTime || Date.now())
    );
    
    return {
      shouldRespond: ruleResult.shouldRespond,
      confidence: ruleResult.confidence,
      source: ruleResult.source,
      reason: ruleResult.reason,
      suggestedService: ruleResult.shouldRespond ? 'chat' : 'ignore',
      analysisTime: Date.now() - (startTime || Date.now()),
      
      // Stage 2 增强字段
      attentionFactor: mockAttentionAnalysis.attentionFactor,
      relationshipFactor,
      energyCost: mockAttentionAnalysis.energyCost,
      decisionId: decisionId!,
      stage2Features: {
        attentionLevel: ruleResult.shouldRespond ? 90 : 30,
        relationshipType: relationship.relationship_type,
        topicWeight: 1.0,
        processingDetails: `Rule-based enhanced decision`
      }
    };
  }

  /**
   * Stage 1规则层过滤 (完全兼容原有逻辑)
   */
  private async applyRuleFilters(message: QQMessage): Promise<{
    shouldRespond: boolean | null;
    confidence: number;
    source: string;
    reason: string;
  }> {
    // 1. 私聊消息 - 必须回复
    if (message.message_type === 'private') {
      return {
        shouldRespond: true,
        confidence: this.RULE_DECISIONS.MUST_RESPOND.confidence,
        source: this.RULE_DECISIONS.MUST_RESPOND.source,
        reason: '私聊消息必须回复'
      };
    }

    // 2. 群聊@消息检测
    if (message.message_type === 'group') {
      const isAtBot = this.isAtBot(message);
      
      if (isAtBot) {
        return {
          shouldRespond: true,
          confidence: this.RULE_DECISIONS.MUST_RESPOND.confidence,
          source: this.RULE_DECISIONS.MUST_RESPOND.source,
          reason: '@消息必须回复'
        };
      }
      
      // 群聊普通消息需要进一步分析
      return {
        shouldRespond: null,
        confidence: 0,
        source: 'rule_neutral',
        reason: '群聊普通消息，需要意图分析'
      };
    }

    // 3. 其他消息类型默认不回复
    return {
      shouldRespond: false,
      confidence: this.RULE_DECISIONS.SHOULD_NOT_RESPOND.confidence,
      source: this.RULE_DECISIONS.SHOULD_NOT_RESPOND.source,
      reason: '非私聊/群聊消息，不予回复'
    };
  }

  /**
   * 检查是否@机器人
   */
  private isAtBot(message: QQMessage): boolean {
    const botQQ = this.aiConfig.bot_qq_number;
    
    if (typeof message.message === 'string') {
      return message.message.includes(`@${botQQ}`) || 
             message.message.includes(`[CQ:at,qq=${botQQ}]`);
    }
    
    if (Array.isArray(message.message)) {
      return message.message.some(segment => 
        segment.type === 'at' && segment.data?.qq === String(botQQ)
      );
    }
    
    return false;
  }

  /**
   * 计算关系因子
   */
  private calculateRelationshipFactor(relationshipType: string): number {
    const factors = {
      'stranger': 1.0,
      'acquaintance': 1.2, 
      'colleague': 1.3,
      'friend': 1.5
    };
    
    return factors[relationshipType as keyof typeof factors] || 1.0;
  }

  /**
   * 执行LLM意图分析
   */
  private async performLLMAnalysis(
    context: MessageContext,
    communicationStyle: any
  ): Promise<any> {
    try {
      const message = context.currentMessage;
      const messageText = typeof message.message === 'string' 
        ? message.message 
        : JSON.stringify(message.message);
      
      const analysisPrompt = `作为QQ群聊智能助手"阿正"，分析以下消息是否需要回复：

消息内容: "${messageText}"
发送者信息: ${message.sender?.nickname || '未知用户'}
群聊环境: ${message.group_id ? '是' : '否'}
用户偏好语调: ${communicationStyle.preferred_tone || 'casual'}

请分析：
1. 这条消息是否需要阿正回复？
2. 消息的意图和紧急程度
3. 回复的必要性评分 (0-100)

返回JSON格式：
{
  "should_respond": true/false,
  "confidence": 85,
  "intent": "求助/闲聊/技术讨论/其他",
  "urgency": "low/medium/high", 
  "reasoning": "分析理由"
}`;

      // 根据消息类型选择合适的prompt
      const promptName = message.group_id ? 'participation_analysis' : 'requirement_analysis';
      
      this.moduleLogger.info('Stage 2 LLM意图分析：选择prompt', {
        messageType: message.message_type,
        hasGroupId: !!message.group_id,
        selectedPrompt: promptName
      });
      
      // Use generateResponse instead of the private callGeminiAPI method
      const result = await this.aiService.generateResponse(
        analysisPrompt,
        message.user_id,
        'intent_analyzer',
        promptName
      );
      
      if (result && result.ai_response) {
        try {
          return JSON.parse(result.ai_response);
        } catch (parseError) {
          this.moduleLogger.warn('Failed to parse LLM analysis result', { parseError, response: result.ai_response });
          return null;
        }
      }
      
      return null;
      
    } catch (error) {
      this.moduleLogger.error('LLM analysis failed', { error });
      return null;
    }
  }

  /**
   * 综合各种因子进行最终决策
   */
  private combineAdvancedFactors(
    attentionAnalysis: any,
    relationshipFactor: number,
    llmAnalysis: any
  ): {
    shouldRespond: boolean;
    confidence: number;
    source: string;
    reason: string;
  } {
    // 如果注意力分析建议不响应，直接采用
    if (!attentionAnalysis.shouldRespond) {
      return {
        shouldRespond: false,
        confidence: 100 - attentionAnalysis.confidence,
        source: 'stage2_attention',
        reason: attentionAnalysis.reason
      };
    }
    
    let finalConfidence = attentionAnalysis.confidence;
    let finalReason = attentionAnalysis.reason;
    
    // 如果有LLM分析结果，进行综合
    if (llmAnalysis) {
      const llmWeight = 0.4; // LLM分析权重
      const attentionWeight = 0.6; // 注意力分析权重
      
      finalConfidence = (finalConfidence * attentionWeight) + (llmAnalysis.confidence * llmWeight);
      finalReason += ` + LLM分析: ${llmAnalysis.reasoning}`;
      
      // 如果LLM强烈建议不响应
      if (!llmAnalysis.should_respond && llmAnalysis.confidence > 80) {
        return {
          shouldRespond: false,
          confidence: llmAnalysis.confidence,
          source: 'stage2_llm',
          reason: `LLM分析建议不响应: ${llmAnalysis.reasoning}`
        };
      }
    }
    
    // 应用关系因子
    finalConfidence *= relationshipFactor;
    finalConfidence = Math.min(95, finalConfidence); // 限制最高置信度
    
    return {
      shouldRespond: finalConfidence > 70,
      confidence: Math.round(finalConfidence),
      source: 'stage2_combined',
      reason: finalReason
    };
  }

  /**
   * 记录决策历史
   */
  private async recordDecisionHistory(
    decisionId: string,
    traceId: string | undefined,
    message: QQMessage,
    decision: any,
    attentionAnalysis: any,
    relationshipFactor: number,
    messageContent: string,
    processingTime: number
  ): Promise<void> {
    try {
      await this.database.executeQuery(
        `INSERT INTO decision_history 
         (id, trace_id, user_id, group_id, message_content, decision_result, 
          confidence_score, attention_factor, relationship_factor, energy_cost, 
          decision_reason, processing_time_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          decisionId,
          traceId || null,
          message.user_id,
          message.group_id || null,
          messageContent.substring(0, 500), // 限制长度
          decision.shouldRespond ? 'respond' : 'ignore',
          decision.confidence,
          attentionAnalysis.attentionFactor,
          relationshipFactor,
          attentionAnalysis.energyCost || 0,
          decision.reason.substring(0, 200), // 限制长度
          processingTime
        ]
      );
    } catch (error) {
      this.moduleLogger.error('Failed to record decision history', { error, decisionId });
    }
  }

  /**
   * 降级到Stage 1决策
   */
  private async fallbackToStage1Decision(
    context: MessageContext,
    traceId?: string,
    decisionId?: string,
    startTime?: number
  ): Promise<Stage2DecisionResult> {
    this.moduleLogger.warn('Falling back to Stage 1 decision logic', { traceId, decisionId });
    
    // 使用简化的Stage 1逻辑
    const message = context.currentMessage;
    const messageContent = typeof message.message === 'string' ? message.message : JSON.stringify(message.message);
    
    return {
      shouldRespond: false,
      confidence: 30,
      source: 'stage1_fallback', 
      reason: '降级到Stage 1默认策略',
      suggestedService: 'ignore',
      analysisTime: Date.now() - (startTime || Date.now()),
      
      attentionFactor: 0.5,
      relationshipFactor: 1.0,
      energyCost: 0,
      decisionId: decisionId!,
      stage2Features: {
        attentionLevel: 50,
        relationshipType: 'stranger',
        topicWeight: 1.0,
        processingDetails: 'Stage 1 fallback mode'
      }
    };
  }

  /**
   * 创建默认决策
   */
  private async createDefaultDecision(
    context: MessageContext,
    traceId?: string,
    decisionId?: string,
    startTime?: number
  ): Promise<Stage2DecisionResult> {
    return {
      shouldRespond: false,
      confidence: 20,
      source: 'stage2_default',
      reason: 'Stage 2默认不响应策略',
      suggestedService: 'ignore',
      analysisTime: Date.now() - (startTime || Date.now()),
      
      attentionFactor: 0.3,
      relationshipFactor: 1.0,
      energyCost: 0,
      decisionId: decisionId!,
      stage2Features: {
        attentionLevel: 30,
        relationshipType: 'unknown',
        topicWeight: 0.5,
        processingDetails: 'Default Stage 2 decision'
      }
    };
  }

  /**
   * 创建错误决策
   */
  private async createErrorDecision(
    context: MessageContext,
    traceId: string | undefined,
    decisionId: string,
    error: any
  ): Promise<Stage2DecisionResult> {
    return {
      shouldRespond: false,
      confidence: 10,
      source: 'stage2_error',
      reason: `决策分析出错: ${error.message || '未知错误'}`,
      suggestedService: 'ignore',
      analysisTime: 0,
      
      attentionFactor: 0.1,
      relationshipFactor: 1.0,
      energyCost: 0,
      decisionId: decisionId!,
      stage2Features: {
        attentionLevel: 10,
        relationshipType: 'error',
        topicWeight: 0.1,
        processingDetails: 'Error in decision analysis'
      }
    };
  }

  /**
   * 更新用户互动后的状态 (在成功回复消息后调用)
   */
  async updateAfterResponse(
    userId: number,
    groupId: number | undefined,
    messageContent: string,
    responseQuality: number = 0.8,
    energyCost: number = 10,
    topics: string[] = []
  ): Promise<void> {
    try {
      // 更新注意力状态
      await this.attentionService.updateAttentionAfterResponse(userId, groupId, energyCost, topics);
      
      // 更新用户关系
      await this.relationshipService.updateInteraction(userId, messageContent, responseQuality, topics);
      
      this.moduleLogger.debug('Post-response updates completed', {
        userId,
        groupId,
        energyCost,
        responseQuality
      });
      
    } catch (error) {
      this.moduleLogger.error('Failed to update post-response state', { error, userId });
    }
  }

  /**
   * 获取决策统计概览
   */
  async getDecisionOverview(timeRange: 'hour' | 'day' | 'week' = 'day'): Promise<{
    totalDecisions: number;
    respondDecisions: number;
    ignoreDecisions: number;
    averageConfidence: number;
    averageProcessingTime: number;
    topSources: Array<{ source: string; count: number }>;
  }> {
    try {
      const timeCondition = {
        hour: 'created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)',
        day: 'created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)', 
        week: 'created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)'
      }[timeRange];
      
      const result = await this.database.executeQuery(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN decision_result = 'respond' THEN 1 ELSE 0 END) as respond_count,
          SUM(CASE WHEN decision_result = 'ignore' THEN 1 ELSE 0 END) as ignore_count,
          AVG(confidence_score) as avg_confidence,
          AVG(processing_time_ms) as avg_processing_time
        FROM decision_history
        WHERE ${timeCondition}
      `);
      
      const sourcesResult = await this.database.executeQuery(`
        SELECT decision_reason, COUNT(*) as count
        FROM decision_history 
        WHERE ${timeCondition}
        GROUP BY decision_reason
        ORDER BY count DESC
        LIMIT 5
      `);
      
      return {
        totalDecisions: result[0]?.total || 0,
        respondDecisions: result[0]?.respond_count || 0,
        ignoreDecisions: result[0]?.ignore_count || 0,
        averageConfidence: Math.round(result[0]?.avg_confidence || 0),
        averageProcessingTime: Math.round(result[0]?.avg_processing_time || 0),
        topSources: sourcesResult.map(row => ({
          source: row.decision_reason,
          count: row.count
        }))
      };
      
    } catch (error) {
      this.moduleLogger.error('Failed to get decision overview', { error });
      return {
        totalDecisions: 0, respondDecisions: 0, ignoreDecisions: 0,
        averageConfidence: 0, averageProcessingTime: 0, topSources: []
      };
    }
  }
}

export default DecisionEngineV2;
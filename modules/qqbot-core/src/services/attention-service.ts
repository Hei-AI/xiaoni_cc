/**
 * AttentionService - Stage 2 注意力状态管理系统
 * 模拟人类的选择性注意和能量管理机制
 */

import { DatabaseManager } from './database';
import { logger } from '../utils/logger';

export interface AttentionState {
  id: string;                    // 注意力状态ID (通常是'global'或用户/群组特定)
  currentLevel: number;          // 当前注意力水平 (0-100)
  focusedTopics: string[];       // 当前关注的话题列表
  recentInteractions: number;    // 近期交互次数 (影响注意力消耗)
  energyLevel: number;          // 能量水平 (0-100, 影响参与积极性)
  lastUpdated: Date;            // 上次更新时间
}

export interface AttentionConfig {
  // 注意力阈值配置
  attentionThresholds: {
    high: number;           // 高注意力阈值 (>80)
    medium: number;         // 中等注意力阈值 (40-80)
    low: number;           // 低注意力阈值 (<40)
  };
  
  // 话题权重配置
  topicWeights: Record<string, number>;
  
  // 关系类型加成
  relationshipBonus: {
    stranger: number;       // 陌生人 (1.0)
    acquaintance: number;   // 熟人 (1.2)
    colleague: number;      // 同事 (1.3)
    friend: number;         // 朋友 (1.5)
  };
  
  // 时间衰减配置
  decay: {
    attentionDecayRate: number;    // 注意力自然衰减率 (每分钟)
    energyRecoveryRate: number;    // 能量恢复率 (每小时)
    interactionCostBase: number;   // 基础交互成本
  };
}

export interface AttentionAnalysis {
  shouldRespond: boolean;         // 是否应该响应
  confidence: number;             // 响应置信度 (0-100)
  attentionFactor: number;        // 注意力因子 (0-2.0)
  energyCost: number;            // 预期能量消耗
  reason: string;                // 决策理由
}

export class AttentionService {
  private database: DatabaseManager;
  private moduleLogger = logger.createModuleLogger('attention-service');
  private config: AttentionConfig;
  private stateCache = new Map<string, AttentionState>();
  private cacheExpiry = 60000; // 1分钟缓存过期

  constructor(database: DatabaseManager) {
    this.database = database;
    this.config = this.getDefaultConfig();
    this.moduleLogger.info('AttentionService initialized with Stage 2 capability');
    
    // 启动定期清理和衰减任务
    this.startMaintenanceTask();
  }

  /**
   * 获取默认配置
   */
  private getDefaultConfig(): AttentionConfig {
    return {
      attentionThresholds: {
        high: 80,
        medium: 40,
        low: 20
      },
      topicWeights: {
        'technical': 1.5,      // 技术话题权重较高
        'casual': 1.0,         // 日常聊天标准权重
        'urgent': 2.0,         // 紧急事务最高权重
        'repetitive': 0.5,     // 重复内容权重降低
        'spam': 0.1            // 垃圾信息几乎忽略
      },
      relationshipBonus: {
        stranger: 1.0,
        acquaintance: 1.2,
        colleague: 1.3,
        friend: 1.5
      },
      decay: {
        attentionDecayRate: 2.0,     // 每分钟衰减2点
        energyRecoveryRate: 5.0,     // 每小时恢复5点
        interactionCostBase: 8.0     // 每次交互消耗8点能量
      }
    };
  }

  /**
   * 分析消息并返回注意力决策
   */
  async analyzeMessage(
    messageContent: string,
    userId: number,
    groupId?: number,
    relationshipType: string = 'stranger'
  ): Promise<AttentionAnalysis> {
    try {
      const stateId = this.getStateId(userId, groupId);
      const currentState = await this.getAttentionState(stateId);
      
      // 分析话题权重
      const topicWeight = await this.analyzeTopicWeight(messageContent);
      
      // 计算关系加成
      const relationshipMultiplier = this.config.relationshipBonus[relationshipType as keyof typeof this.config.relationshipBonus] || 1.0;
      
      // 计算注意力因子
      const attentionFactor = this.calculateAttentionFactor(currentState, topicWeight, relationshipMultiplier);
      
      // 预估能量消耗
      const energyCost = this.calculateEnergyCost(messageContent, attentionFactor);
      
      // 判断是否应该响应
      const shouldRespond = this.shouldRespondToMessage(currentState, attentionFactor, energyCost);
      
      // 计算置信度
      const confidence = this.calculateConfidence(currentState, attentionFactor, shouldRespond);
      
      // 生成决策理由
      const reason = this.generateReason(currentState, attentionFactor, shouldRespond, energyCost);
      
      this.moduleLogger.info('Attention analysis completed', {
        userId,
        groupId,
        shouldRespond,
        confidence,
        attentionLevel: currentState.currentLevel,
        energyLevel: currentState.energyLevel,
        attentionFactor,
        topicWeight
      });

      return {
        shouldRespond,
        confidence,
        attentionFactor,
        energyCost,
        reason
      };
      
    } catch (error) {
      this.moduleLogger.error('Failed to analyze message attention', { error, userId, groupId });
      
      // 失败时返回保守的默认决策
      return {
        shouldRespond: false,
        confidence: 20,
        attentionFactor: 0.5,
        energyCost: 0,
        reason: '注意力分析失败，采用保守策略'
      };
    }
  }

  /**
   * 更新注意力状态（在实际响应消息后调用）
   */
  async updateAttentionAfterResponse(
    userId: number,
    groupId: number | undefined,
    energyCost: number,
    topics: string[] = []
  ): Promise<void> {
    try {
      const stateId = this.getStateId(userId, groupId);
      const currentState = await this.getAttentionState(stateId);
      
      // 更新注意力状态
      const updatedState: AttentionState = {
        ...currentState,
        currentLevel: Math.max(0, currentState.currentLevel - (energyCost * 0.3)), // 注意力轻微下降
        energyLevel: Math.max(0, currentState.energyLevel - energyCost),           // 能量消耗
        recentInteractions: currentState.recentInteractions + 1,                   // 交互次数+1
        focusedTopics: this.updateFocusedTopics(currentState.focusedTopics, topics),
        lastUpdated: new Date()
      };
      
      await this.saveAttentionState(stateId, updatedState);
      this.stateCache.set(stateId, updatedState);
      
      this.moduleLogger.debug('Attention state updated after response', {
        stateId,
        energyCost,
        newEnergyLevel: updatedState.energyLevel,
        newAttentionLevel: updatedState.currentLevel
      });
      
    } catch (error) {
      this.moduleLogger.error('Failed to update attention state', { error, userId, groupId });
    }
  }

  /**
   * 获取注意力状态
   */
  private async getAttentionState(stateId: string): Promise<AttentionState> {
    // 先检查缓存
    const cached = this.stateCache.get(stateId);
    if (cached && Date.now() - cached.lastUpdated.getTime() < this.cacheExpiry) {
      return cached;
    }

    try {
      // 从数据库加载
      const result = await this.database.executeQuery<AttentionState>(
        'SELECT * FROM attention_states WHERE id = ?',
        [stateId]
      );

      if (result.length > 0) {
        const state = result[0];
        state.focusedTopics = JSON.parse(state.focusedTopics as unknown as string || '[]');
        
        // 应用时间衰减
        const decayedState = this.applyTimeDecay(state);
        
        this.stateCache.set(stateId, decayedState);
        return decayedState;
      }
    } catch (error) {
      this.moduleLogger.warn('Failed to load attention state from database', { error, stateId });
    }

    // 创建默认状态
    const defaultState: AttentionState = {
      id: stateId,
      currentLevel: 75,        // 默认较高的注意力
      focusedTopics: [],
      recentInteractions: 0,
      energyLevel: 90,         // 默认较高的能量
      lastUpdated: new Date()
    };

    this.stateCache.set(stateId, defaultState);
    return defaultState;
  }

  /**
   * 保存注意力状态到数据库
   */
  private async saveAttentionState(stateId: string, state: AttentionState): Promise<void> {
    try {
      const focusedTopicsJson = JSON.stringify(state.focusedTopics);
      
      await this.database.executeQuery(
        `INSERT INTO attention_states (id, current_level, focused_topics, recent_interactions, energy_level, last_updated)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         current_level = VALUES(current_level),
         focused_topics = VALUES(focused_topics),
         recent_interactions = VALUES(recent_interactions),
         energy_level = VALUES(energy_level),
         last_updated = VALUES(last_updated)`,
        [stateId, state.currentLevel, focusedTopicsJson, state.recentInteractions, state.energyLevel, state.lastUpdated]
      );
    } catch (error) {
      this.moduleLogger.error('Failed to save attention state', { error, stateId });
    }
  }

  /**
   * 分析话题权重
   */
  private async analyzeTopicWeight(messageContent: string): Promise<number> {
    // 简单的关键词匹配实现
    const content = messageContent.toLowerCase();
    
    if (content.includes('紧急') || content.includes('urgent') || content.includes('重要')) {
      return this.config.topicWeights.urgent;
    }
    
    if (content.includes('技术') || content.includes('代码') || content.includes('bug') || content.includes('问题')) {
      return this.config.topicWeights.technical;
    }
    
    // 检测重复内容
    if (this.isRepetitiveContent(content)) {
      return this.config.topicWeights.repetitive;
    }
    
    return this.config.topicWeights.casual;
  }

  /**
   * 计算注意力因子
   */
  private calculateAttentionFactor(
    state: AttentionState,
    topicWeight: number,
    relationshipMultiplier: number
  ): number {
    const baseAttention = state.currentLevel / 100;
    const energyFactor = state.energyLevel / 100;
    const interactionFatigue = Math.max(0.3, 1 - (state.recentInteractions * 0.1));
    
    return baseAttention * energyFactor * topicWeight * relationshipMultiplier * interactionFatigue;
  }

  /**
   * 计算能量消耗
   */
  private calculateEnergyCost(messageContent: string, attentionFactor: number): number {
    const baseLength = messageContent.length;
    const lengthFactor = Math.min(2.0, baseLength / 100); // 长消息消耗更多能量
    
    return this.config.decay.interactionCostBase * lengthFactor * (2 - attentionFactor);
  }

  /**
   * 判断是否应该响应
   */
  private shouldRespondToMessage(
    state: AttentionState,
    attentionFactor: number,
    energyCost: number
  ): boolean {
    // 能量不足时降低响应概率
    if (state.energyLevel < energyCost) {
      return attentionFactor > 1.5; // 只有非常吸引注意力的消息才响应
    }
    
    // 注意力水平判断
    if (state.currentLevel >= this.config.attentionThresholds.high) {
      return attentionFactor > 0.8;
    } else if (state.currentLevel >= this.config.attentionThresholds.medium) {
      return attentionFactor > 1.2;
    } else {
      return attentionFactor > 1.8; // 低注意力时需要更高的吸引力
    }
  }

  /**
   * 计算置信度
   */
  private calculateConfidence(
    state: AttentionState,
    attentionFactor: number,
    shouldRespond: boolean
  ): number {
    let confidence = Math.min(95, attentionFactor * 50 + state.currentLevel * 0.3);
    
    if (!shouldRespond) {
      confidence = Math.max(10, 100 - confidence); // 不响应时置信度相反
    }
    
    return Math.round(confidence);
  }

  /**
   * 生成决策理由
   */
  private generateReason(
    state: AttentionState,
    attentionFactor: number,
    shouldRespond: boolean,
    energyCost: number
  ): string {
    if (!shouldRespond) {
      if (state.energyLevel < energyCost) {
        return `能量不足(${state.energyLevel}/${energyCost})，暂时不响应`;
      }
      if (state.currentLevel < this.config.attentionThresholds.low) {
        return `注意力水平较低(${state.currentLevel})，对当前话题关注度不高`;
      }
      return `注意力因子(${attentionFactor.toFixed(2)})未达到响应阈值`;
    }
    
    return `注意力因子(${attentionFactor.toFixed(2)})适中，当前能量充足(${state.energyLevel})，可以参与对话`;
  }

  /**
   * 应用时间衰减
   */
  private applyTimeDecay(state: AttentionState): AttentionState {
    const now = new Date();
    const timeDiff = (now.getTime() - state.lastUpdated.getTime()) / (1000 * 60); // 分钟
    
    if (timeDiff > 0) {
      const attentionDecay = timeDiff * this.config.decay.attentionDecayRate;
      const energyRecovery = (timeDiff / 60) * this.config.decay.energyRecoveryRate; // 小时为单位
      
      return {
        ...state,
        currentLevel: Math.min(100, Math.max(0, state.currentLevel - attentionDecay)),
        energyLevel: Math.min(100, state.energyLevel + energyRecovery),
        lastUpdated: now
      };
    }
    
    return state;
  }

  /**
   * 更新关注话题
   */
  private updateFocusedTopics(currentTopics: string[], newTopics: string[]): string[] {
    const combined = [...new Set([...currentTopics, ...newTopics])];
    return combined.slice(0, 5); // 最多保留5个关注话题
  }

  /**
   * 检测重复内容
   */
  private isRepetitiveContent(content: string): boolean {
    // 简单的重复检测逻辑
    return content.length < 10 && (content.includes('哈') || content.includes('嗯') || content.includes('啊'));
  }

  /**
   * 生成状态ID
   */
  private getStateId(userId: number, groupId?: number): string {
    return groupId ? `group_${groupId}` : `user_${userId}`;
  }

  /**
   * 启动维护任务
   */
  private startMaintenanceTask(): void {
    // 每5分钟清理缓存和更新衰减
    setInterval(() => {
      this.performMaintenance();
    }, 5 * 60 * 1000);
  }

  /**
   * 执行维护任务
   */
  private async performMaintenance(): Promise<void> {
    try {
      // 清理过期缓存
      const now = Date.now();
      for (const [key, state] of this.stateCache.entries()) {
        if (now - state.lastUpdated.getTime() > this.cacheExpiry * 2) {
          this.stateCache.delete(key);
        }
      }

      // 批量更新数据库中的衰减状态
      await this.batchUpdateDecay();
      
      this.moduleLogger.debug('Attention maintenance completed', {
        cacheSize: this.stateCache.size
      });
      
    } catch (error) {
      this.moduleLogger.error('Attention maintenance failed', { error });
    }
  }

  /**
   * 批量更新衰减状态
   */
  private async batchUpdateDecay(): Promise<void> {
    try {
      // 获取所有需要更新的状态
      const states = await this.database.executeQuery<AttentionState>(
        'SELECT * FROM attention_states WHERE last_updated < DATE_SUB(NOW(), INTERVAL 5 MINUTE)'
      );

      for (const state of states) {
        state.focusedTopics = JSON.parse(state.focusedTopics as unknown as string || '[]');
        const decayedState = this.applyTimeDecay(state);
        await this.saveAttentionState(state.id, decayedState);
      }
      
    } catch (error) {
      this.moduleLogger.error('Batch decay update failed', { error });
    }
  }

  /**
   * 获取注意力状态概览（用于监控和调试）
   */
  async getAttentionOverview(): Promise<{
    totalStates: number;
    averageAttention: number;
    averageEnergy: number;
    activeStates: number;
  }> {
    try {
      const result = await this.database.executeQuery(
        `SELECT 
          COUNT(*) as total,
          AVG(current_level) as avg_attention,
          AVG(energy_level) as avg_energy,
          COUNT(CASE WHEN current_level > 50 THEN 1 END) as active_count
         FROM attention_states`
      );

      return {
        totalStates: result[0].total || 0,
        averageAttention: Math.round(result[0].avg_attention || 0),
        averageEnergy: Math.round(result[0].avg_energy || 0),
        activeStates: result[0].active_count || 0
      };
      
    } catch (error) {
      this.moduleLogger.error('Failed to get attention overview', { error });
      return { totalStates: 0, averageAttention: 0, averageEnergy: 0, activeStates: 0 };
    }
  }
}

export default AttentionService;
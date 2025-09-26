/**
 * UserRelationshipService - Stage 2 用户关系追踪系统
 * 动态管理用户关系、亲和度和沟通偏好
 */

import { DatabaseManager } from './database';
import { logger } from '../utils/logger';

export interface UserRelationship {
  user_id: number;
  relationship_type: 'stranger' | 'acquaintance' | 'colleague' | 'friend';
  interaction_count: number;
  last_interaction: Date;
  affinity_score: number;          // 0.0-1.0 亲和度评分
  communication_style: CommunicationStyle;
  created_at: Date;
  updated_at: Date;
}

export interface CommunicationStyle {
  preferred_tone: string;          // 用户偏好的语调 ('formal', 'casual', 'humorous', 'technical')
  response_speed: string;          // 响应速度偏好 ('immediate', 'normal', 'delayed')
  interaction_frequency: number;   // 交互频率 (次/天)
  topic_preferences: string[];     // 话题偏好列表
  emoji_usage: number;             // emoji使用偏好 (0-1)
  message_length_pref: string;     // 消息长度偏好 ('short', 'medium', 'long')
}

export interface RelationshipAnalysis {
  current_level: string;           // 当前关系等级
  progression_trend: string;       // 关系发展趋势 ('improving', 'stable', 'declining')
  affinity_change: number;         // 亲和度变化
  recommended_tone: string;        // 推荐语调
  engagement_score: number;        // 参与积极性评分 (0-100)
  last_meaningful_interaction: Date | null; // 最后有意义的互动时间
}

export interface InteractionMetrics {
  daily_interactions: number;
  weekly_interactions: number;
  average_response_time: number;   // 秒
  topic_diversity: number;         // 话题多样性评分
  conversation_depth: number;      // 对话深度评分 (0-100)
}

export class UserRelationshipService {
  private database: DatabaseManager;
  private moduleLogger = logger.createModuleLogger('user-relationship');
  private relationshipCache = new Map<number, UserRelationship>();
  private cacheExpiry = 300000; // 5分钟缓存过期

  // 关系升级阈值配置
  private readonly RELATIONSHIP_THRESHOLDS = {
    acquaintance: { interactions: 5, affinity: 0.3, days: 3 },
    colleague: { interactions: 15, affinity: 0.5, days: 7 },
    friend: { interactions: 50, affinity: 0.7, days: 14 }
  };

  constructor(database: DatabaseManager) {
    this.database = database;
    this.moduleLogger.info('UserRelationshipService initialized for Stage 2');
    
    // 启动关系维护任务
    this.startRelationshipMaintenance();
  }

  /**
   * 获取用户关系信息
   */
  async getUserRelationship(userId: number): Promise<UserRelationship> {
    // 先检查缓存
    const cached = this.relationshipCache.get(userId);
    if (cached && Date.now() - cached.updated_at.getTime() < this.cacheExpiry) {
      return cached;
    }

    try {
      const result = await this.database.executeQuery<UserRelationship>(
        'SELECT * FROM user_relationships WHERE user_id = ?',
        [userId]
      );

      if (result.length > 0) {
        const relationship = result[0];
        relationship.communication_style = JSON.parse(relationship.communication_style as unknown as string || '{}');
        
        this.relationshipCache.set(userId, relationship);
        return relationship;
      }
    } catch (error) {
      this.moduleLogger.warn('Failed to load user relationship from database', { error, userId });
    }

    // 创建新用户关系记录
    return await this.createNewUserRelationship(userId);
  }

  /**
   * 创建新用户关系记录
   */
  private async createNewUserRelationship(userId: number): Promise<UserRelationship> {
    const now = new Date();
    const defaultRelationship: UserRelationship = {
      user_id: userId,
      relationship_type: 'stranger',
      interaction_count: 0,
      last_interaction: now,
      affinity_score: 0.1, // 初始亲和度
      communication_style: {
        preferred_tone: 'casual',
        response_speed: 'normal',
        interaction_frequency: 0,
        topic_preferences: [],
        emoji_usage: 0.3,
        message_length_pref: 'medium'
      },
      created_at: now,
      updated_at: now
    };

    try {
      await this.saveUserRelationship(defaultRelationship);
      this.relationshipCache.set(userId, defaultRelationship);
      
      this.moduleLogger.info('Created new user relationship', { userId });
      return defaultRelationship;
      
    } catch (error) {
      this.moduleLogger.error('Failed to create user relationship', { error, userId });
      return defaultRelationship; // 返回默认值，即使保存失败
    }
  }

  /**
   * 保存用户关系到数据库
   */
  private async saveUserRelationship(relationship: UserRelationship): Promise<void> {
    try {
      const styleJson = JSON.stringify(relationship.communication_style);
      
      await this.database.executeQuery(
        `INSERT INTO user_relationships 
         (user_id, relationship_type, interaction_count, last_interaction, affinity_score, communication_style, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         relationship_type = VALUES(relationship_type),
         interaction_count = VALUES(interaction_count),
         last_interaction = VALUES(last_interaction),
         affinity_score = VALUES(affinity_score),
         communication_style = VALUES(communication_style),
         updated_at = VALUES(updated_at)`,
        [
          relationship.user_id,
          relationship.relationship_type,
          relationship.interaction_count,
          relationship.last_interaction,
          relationship.affinity_score,
          styleJson,
          relationship.created_at,
          relationship.updated_at
        ]
      );
    } catch (error) {
      this.moduleLogger.error('Failed to save user relationship', { error, userId: relationship.user_id });
    }
  }

  /**
   * 更新用户互动记录
   */
  async updateInteraction(
    userId: number,
    messageContent: string,
    responseQuality: number = 0.8, // 0-1, 响应质量评分
    topicTags: string[] = []
  ): Promise<void> {
    try {
      const relationship = await this.getUserRelationship(userId);
      const now = new Date();
      
      // 分析这次互动的特征
      const interactionAnalysis = this.analyzeInteraction(messageContent, topicTags);
      
      // 计算亲和度变化
      const affinityChange = this.calculateAffinityChange(
        relationship,
        interactionAnalysis,
        responseQuality
      );
      
      // 更新关系数据
      const updatedRelationship: UserRelationship = {
        ...relationship,
        interaction_count: relationship.interaction_count + 1,
        last_interaction: now,
        affinity_score: Math.min(1.0, Math.max(0.0, relationship.affinity_score + affinityChange)),
        communication_style: this.updateCommunicationStyle(
          relationship.communication_style,
          interactionAnalysis
        ),
        updated_at: now
      };
      
      // 检查关系等级是否需要升级
      updatedRelationship.relationship_type = this.evaluateRelationshipLevel(updatedRelationship);
      
      await this.saveUserRelationship(updatedRelationship);
      this.relationshipCache.set(userId, updatedRelationship);
      
      this.moduleLogger.debug('Updated user interaction', {
        userId,
        newAffinityScore: updatedRelationship.affinity_score,
        relationshipType: updatedRelationship.relationship_type,
        interactionCount: updatedRelationship.interaction_count,
        affinityChange
      });
      
    } catch (error) {
      this.moduleLogger.error('Failed to update user interaction', { error, userId });
    }
  }

  /**
   * 分析单次互动特征
   */
  private analyzeInteraction(messageContent: string, topicTags: string[]): {
    tone: string;
    length: string;
    emoji_count: number;
    topic_tags: string[];
    urgency: string;
  } {
    const content = messageContent.toLowerCase();
    const messageLength = messageContent.length;
    
    // 分析语调
    let tone = 'neutral';
    if (content.includes('哈哈') || content.includes('😄') || content.includes('有趣')) {
      tone = 'humorous';
    } else if (content.includes('请问') || content.includes('您好') || content.includes('麻烦')) {
      tone = 'formal';
    } else if (content.includes('谢谢') || content.includes('太好了') || content.includes('棒')) {
      tone = 'friendly';
    }
    
    // 分析消息长度类型
    let length = 'medium';
    if (messageLength < 20) length = 'short';
    else if (messageLength > 100) length = 'long';
    
    // 计算emoji数量
    const emojiCount = (messageContent.match(/[\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}]/gu) || []).length;
    
    // 分析紧急程度
    let urgency = 'normal';
    if (content.includes('紧急') || content.includes('马上') || content.includes('急')) {
      urgency = 'urgent';
    } else if (content.includes('慢慢') || content.includes('不急') || content.includes('有时间')) {
      urgency = 'relaxed';
    }
    
    return {
      tone,
      length,
      emoji_count: emojiCount,
      topic_tags: topicTags,
      urgency
    };
  }

  /**
   * 计算亲和度变化
   */
  private calculateAffinityChange(
    relationship: UserRelationship,
    interaction: ReturnType<typeof this.analyzeInteraction>,
    responseQuality: number
  ): number {
    let change = 0.02; // 基础增长
    
    // 响应质量影响
    change += (responseQuality - 0.5) * 0.04;
    
    // 语调匹配度影响
    if (interaction.tone === relationship.communication_style.preferred_tone) {
      change += 0.01;
    }
    
    // 消息长度匹配度影响
    if (interaction.length === relationship.communication_style.message_length_pref) {
      change += 0.005;
    }
    
    // emoji使用匹配度影响
    const expectedEmoji = relationship.communication_style.emoji_usage * 20; // 假设20字符为基准
    const emojiDiff = Math.abs(interaction.emoji_count - expectedEmoji) / 20;
    change -= emojiDiff * 0.01;
    
    // 新话题的探索加成
    const newTopics = interaction.topic_tags.filter(
      tag => !relationship.communication_style.topic_preferences.includes(tag)
    );
    change += newTopics.length * 0.005;
    
    return Math.max(-0.05, Math.min(0.05, change)); // 限制单次变化幅度
  }

  /**
   * 更新沟通风格偏好
   */
  private updateCommunicationStyle(
    currentStyle: CommunicationStyle,
    interaction: ReturnType<typeof this.analyzeInteraction>
  ): CommunicationStyle {
    const updatedStyle = { ...currentStyle };
    
    // 更新话题偏好（加入新话题，最多保留10个）
    const allTopics = [...updatedStyle.topic_preferences, ...interaction.topic_tags];
    updatedStyle.topic_preferences = [...new Set(allTopics)].slice(0, 10);
    
    // 渐进式更新语调偏好
    if (interaction.tone !== 'neutral') {
      updatedStyle.preferred_tone = interaction.tone;
    }
    
    // 更新消息长度偏好
    if (interaction.length !== currentStyle.message_length_pref) {
      updatedStyle.message_length_pref = interaction.length;
    }
    
    // 更新emoji使用偏好 (移动平均)
    const targetEmoji = interaction.emoji_count / 20; // 归一化
    updatedStyle.emoji_usage = updatedStyle.emoji_usage * 0.8 + targetEmoji * 0.2;
    
    // 更新交互频率
    updatedStyle.interaction_frequency = updatedStyle.interaction_frequency * 0.9 + 0.1;
    
    return updatedStyle;
  }

  /**
   * 评估关系等级
   */
  private evaluateRelationshipLevel(relationship: UserRelationship): UserRelationship['relationship_type'] {
    const daysSinceFirstInteraction = Math.floor(
      (Date.now() - relationship.created_at.getTime()) / (1000 * 60 * 60 * 24)
    );
    
    // 检查是否满足朋友条件
    if (relationship.interaction_count >= this.RELATIONSHIP_THRESHOLDS.friend.interactions &&
        relationship.affinity_score >= this.RELATIONSHIP_THRESHOLDS.friend.affinity &&
        daysSinceFirstInteraction >= this.RELATIONSHIP_THRESHOLDS.friend.days) {
      return 'friend';
    }
    
    // 检查是否满足同事条件
    if (relationship.interaction_count >= this.RELATIONSHIP_THRESHOLDS.colleague.interactions &&
        relationship.affinity_score >= this.RELATIONSHIP_THRESHOLDS.colleague.affinity &&
        daysSinceFirstInteraction >= this.RELATIONSHIP_THRESHOLDS.colleague.days) {
      return 'colleague';
    }
    
    // 检查是否满足熟人条件
    if (relationship.interaction_count >= this.RELATIONSHIP_THRESHOLDS.acquaintance.interactions &&
        relationship.affinity_score >= this.RELATIONSHIP_THRESHOLDS.acquaintance.affinity &&
        daysSinceFirstInteraction >= this.RELATIONSHIP_THRESHOLDS.acquaintance.days) {
      return 'acquaintance';
    }
    
    return 'stranger';
  }

  /**
   * 获取关系分析报告
   */
  async getRelationshipAnalysis(userId: number): Promise<RelationshipAnalysis> {
    try {
      const relationship = await this.getUserRelationship(userId);
      const metrics = await this.getInteractionMetrics(userId);
      
      // 计算关系发展趋势
      const trend = await this.calculateRelationshipTrend(userId);
      
      // 计算参与积极性评分
      const engagementScore = this.calculateEngagementScore(relationship, metrics);
      
      return {
        current_level: relationship.relationship_type,
        progression_trend: trend.direction,
        affinity_change: trend.affinityChange,
        recommended_tone: relationship.communication_style.preferred_tone,
        engagement_score: engagementScore,
        last_meaningful_interaction: relationship.last_interaction
      };
      
    } catch (error) {
      this.moduleLogger.error('Failed to generate relationship analysis', { error, userId });
      
      return {
        current_level: 'stranger',
        progression_trend: 'stable',
        affinity_change: 0,
        recommended_tone: 'casual',
        engagement_score: 50,
        last_meaningful_interaction: null
      };
    }
  }

  /**
   * 获取互动指标
   */
  async getInteractionMetrics(userId: number): Promise<InteractionMetrics> {
    try {
      // 查询最近的互动数据
      const dailyResult = await this.database.executeQuery(
        `SELECT COUNT(*) as count FROM conversations 
         WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)`,
        [userId]
      );
      
      const weeklyResult = await this.database.executeQuery(
        `SELECT COUNT(*) as count FROM conversations 
         WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)`,
        [userId]
      );
      
      return {
        daily_interactions: dailyResult[0]?.count || 0,
        weekly_interactions: weeklyResult[0]?.count || 0,
        average_response_time: 30, // TODO: 从实际数据计算
        topic_diversity: 0.7,      // TODO: 基于话题标签计算
        conversation_depth: 65     // TODO: 基于对话轮次计算
      };
      
    } catch (error) {
      this.moduleLogger.error('Failed to get interaction metrics', { error, userId });
      
      return {
        daily_interactions: 0,
        weekly_interactions: 0,
        average_response_time: 60,
        topic_diversity: 0.5,
        conversation_depth: 50
      };
    }
  }

  /**
   * 计算关系发展趋势
   */
  private async calculateRelationshipTrend(userId: number): Promise<{
    direction: 'improving' | 'stable' | 'declining';
    affinityChange: number;
  }> {
    try {
      // 获取最近7天的亲和度变化
      const recentConversations = await this.database.executeQuery(
        `SELECT created_at FROM conversations 
         WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
         ORDER BY created_at ASC`,
        [userId]
      );
      
      if (recentConversations.length < 2) {
        return { direction: 'stable', affinityChange: 0 };
      }
      
      // 简化的趋势计算 - 基于互动频率
      const relationship = await this.getUserRelationship(userId);
      const avgInteractionsPerDay = recentConversations.length / 7;
      
      let direction: 'improving' | 'stable' | 'declining' = 'stable';
      let affinityChange = 0;
      
      if (avgInteractionsPerDay > relationship.communication_style.interaction_frequency * 1.2) {
        direction = 'improving';
        affinityChange = 0.02;
      } else if (avgInteractionsPerDay < relationship.communication_style.interaction_frequency * 0.8) {
        direction = 'declining';
        affinityChange = -0.01;
      }
      
      return { direction, affinityChange };
      
    } catch (error) {
      this.moduleLogger.error('Failed to calculate relationship trend', { error, userId });
      return { direction: 'stable', affinityChange: 0 };
    }
  }

  /**
   * 计算参与积极性评分
   */
  private calculateEngagementScore(
    relationship: UserRelationship,
    metrics: InteractionMetrics
  ): number {
    let score = 50; // 基础分数
    
    // 亲和度影响 (30分权重)
    score += relationship.affinity_score * 30;
    
    // 互动频率影响 (20分权重)
    score += Math.min(20, metrics.weekly_interactions * 2);
    
    // 话题多样性影响 (15分权重)
    score += metrics.topic_diversity * 15;
    
    // 对话深度影响 (15分权重)
    score += metrics.conversation_depth * 0.15;
    
    return Math.min(100, Math.max(0, Math.round(score)));
  }

  /**
   * 批量获取多个用户的关系信息
   */
  async getBatchUserRelationships(userIds: number[]): Promise<Map<number, UserRelationship>> {
    const relationships = new Map<number, UserRelationship>();
    
    try {
      const placeholders = userIds.map(() => '?').join(',');
      const results = await this.database.executeQuery<UserRelationship>(
        `SELECT * FROM user_relationships WHERE user_id IN (${placeholders})`,
        userIds
      );
      
      for (const result of results) {
        result.communication_style = JSON.parse(result.communication_style as unknown as string || '{}');
        relationships.set(result.user_id, result);
        this.relationshipCache.set(result.user_id, result);
      }
      
      // 为没有记录的用户创建默认关系
      for (const userId of userIds) {
        if (!relationships.has(userId)) {
          const newRelationship = await this.createNewUserRelationship(userId);
          relationships.set(userId, newRelationship);
        }
      }
      
    } catch (error) {
      this.moduleLogger.error('Failed to get batch user relationships', { error, userIds });
    }
    
    return relationships;
  }

  /**
   * 启动关系维护任务
   */
  private startRelationshipMaintenance(): void {
    // 每小时执行一次维护任务
    setInterval(() => {
      this.performRelationshipMaintenance();
    }, 60 * 60 * 1000);
  }

  /**
   * 执行关系维护任务
   */
  private async performRelationshipMaintenance(): Promise<void> {
    try {
      // 清理过期缓存
      const now = Date.now();
      for (const [userId, relationship] of this.relationshipCache.entries()) {
        if (now - relationship.updated_at.getTime() > this.cacheExpiry * 2) {
          this.relationshipCache.delete(userId);
        }
      }

      // 执行关系衰减（长时间未互动的用户）
      await this.applyRelationshipDecay();
      
      this.moduleLogger.debug('Relationship maintenance completed', {
        cacheSize: this.relationshipCache.size
      });
      
    } catch (error) {
      this.moduleLogger.error('Relationship maintenance failed', { error });
    }
  }

  /**
   * 应用关系衰减
   */
  private async applyRelationshipDecay(): Promise<void> {
    try {
      // 找出超过30天未互动的用户，降低其亲和度
      await this.database.executeQuery(
        `UPDATE user_relationships 
         SET affinity_score = GREATEST(0, affinity_score - 0.1),
             updated_at = NOW()
         WHERE last_interaction < DATE_SUB(NOW(), INTERVAL 30 DAY)
         AND affinity_score > 0.1`
      );
      
    } catch (error) {
      this.moduleLogger.error('Failed to apply relationship decay', { error });
    }
  }

  /**
   * 获取关系统计概览
   */
  async getRelationshipOverview(): Promise<{
    totalUsers: number;
    strangers: number;
    acquaintances: number;
    colleagues: number;
    friends: number;
    averageAffinity: number;
  }> {
    try {
      const result = await this.database.executeQuery(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN relationship_type = 'stranger' THEN 1 ELSE 0 END) as strangers,
          SUM(CASE WHEN relationship_type = 'acquaintance' THEN 1 ELSE 0 END) as acquaintances,
          SUM(CASE WHEN relationship_type = 'colleague' THEN 1 ELSE 0 END) as colleagues,
          SUM(CASE WHEN relationship_type = 'friend' THEN 1 ELSE 0 END) as friends,
          AVG(affinity_score) as avg_affinity
        FROM user_relationships
      `);

      return {
        totalUsers: result[0]?.total || 0,
        strangers: result[0]?.strangers || 0,
        acquaintances: result[0]?.acquaintances || 0,
        colleagues: result[0]?.colleagues || 0,
        friends: result[0]?.friends || 0,
        averageAffinity: Math.round((result[0]?.avg_affinity || 0) * 100) / 100
      };
      
    } catch (error) {
      this.moduleLogger.error('Failed to get relationship overview', { error });
      return {
        totalUsers: 0, strangers: 0, acquaintances: 0,
        colleagues: 0, friends: 0, averageAffinity: 0
      };
    }
  }
}

export default UserRelationshipService;
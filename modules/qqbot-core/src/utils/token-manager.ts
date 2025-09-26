import axios from 'axios';
import { logger } from './logger';
import { DatabaseManager, getDatabaseManager } from '../services/database';
import { config } from '../config';
import { ApiTokenData, TokenHealthConfig, TokenStats } from '../types';

/**
 * 数据库驱动的Token Manager - 管理Gemini API Token的轮换策略
 * 
 * 特性:
 * - 数据库存储Token信息，支持持久化状态管理
 * - 每日使用限制和自动重置机制
 * - 智能Token选择：优先级、权重、使用频率
 * - 健康检查机制，自动检测Token有效性
 * - 黑名单管理，自动恢复机制
 * - 完整的使用日志记录
 */
export class TokenManager {
  private database: DatabaseManager;
  private moduleLogger = logger.createModuleLogger('token-manager');
  private dailyResetTimer?: ReturnType<typeof setTimeout>;
  private healthConfig?: TokenHealthConfig;

  constructor(database?: DatabaseManager) {
    this.database = database || getDatabaseManager(config.database);
    this.initialize();
  }

  /**
   * 初始化Token管理器
   */
  private async initialize(): Promise<void> {
    try {
      await this.resetDailyUsageIfNeeded();
      this.startDailyResetTimer();
      
      this.moduleLogger.info('Token Manager initialized with database backend (passive mode)');
    } catch (error) {
      this.moduleLogger.error('Failed to initialize Token Manager', { error });
    }
  }

  /**
   * 加载健康检查配置
   */
  private async loadHealthConfig(): Promise<void> {
    try {
      const result = await this.database.executeQuery<TokenHealthConfig>(
        "SELECT * FROM api_token_health_config WHERE enabled = TRUE LIMIT 1"
      );
      
      if (result.length > 0) {
        this.healthConfig = result[0];
      } else {
        // 使用默认配置
        this.healthConfig = {
          id: 1,
          check_interval_minutes: 60,
          max_error_count: 3,
          blacklist_duration_minutes: 5,
          health_check_timeout_ms: 10000,
          daily_reset_hour: 0,
          enabled: true,
          created_at: new Date(),
          updated_at: new Date()
        };
      }
      
      this.moduleLogger.debug("Health config loaded", { config: this.healthConfig });
    } catch (error) {
      this.moduleLogger.error("Failed to load health config", { error });
      // 使用默认配置作为fallback
      this.healthConfig = {
        id: 1,
        check_interval_minutes: 60,
        max_error_count: 3,
        blacklist_duration_minutes: 5,
        health_check_timeout_ms: 10000,
        daily_reset_hour: 0,
        enabled: true,
        created_at: new Date(),
        updated_at: new Date()
      };
    }
  }

  /**
   * 获取下一个可用Token (智能策略)
   * @returns Token字符串，如果没有可用Token则返回null
   */
  public async getNextToken(): Promise<string | null> {
    try {
      await this.cleanupBlacklist();
      await this.resetDailyUsageIfNeeded();
      
      // 查询可用Token：只依赖blacklisted_until字段，简化查询
      const query = `
        SELECT * FROM api_tokens 
        WHERE (blacklisted_until IS NULL OR blacklisted_until <= NOW())
          AND daily_used < daily_limit
        ORDER BY 
          priority ASC,           -- 优先级排序（1=最高优先级）
          (daily_used / daily_limit) ASC,  -- 使用率排序
          last_used ASC,          -- 最少最近使用
          weight DESC             -- 权重排序
        LIMIT 1
      `;
      
      this.moduleLogger.debug('Executing token query', { query: query.replace(/\s+/g, ' ').trim() });
      
      const availableTokens = await this.database.executeQuery<ApiTokenData>(query);
      
      this.moduleLogger.debug('Token query result', { 
        tokensFound: availableTokens.length,
        firstToken: availableTokens.length > 0 ? {
          id: availableTokens[0].id,
          project_name: availableTokens[0].project_name,
          is_active: availableTokens[0].is_active,
          is_healthy: availableTokens[0].is_healthy
        } : null
      });

      if (availableTokens.length === 0) {
        this.moduleLogger.warn('No available tokens found');
        return null;
      }

      const selectedToken = availableTokens[0];
      
      // 更新使用统计
      await this.database.executeUpdate(`
        UPDATE api_tokens SET 
          last_used = NOW(),
          daily_used = daily_used + 1,
          total_used = total_used + 1
        WHERE id = ?
      `, [selectedToken.id]);
      

      this.moduleLogger.debug('Selected token for use', {
        id: selectedToken.id,
        project: selectedToken.project_name,
        dailyUsed: selectedToken.daily_used + 1,
        dailyLimit: selectedToken.daily_limit,
        tokenPrefix: selectedToken.token.substring(0, 8) + '...'
      });

      return selectedToken.token;
    } catch (error) {
      this.moduleLogger.error('Failed to get next token', { error });
      return null;
    }
  }

  /**
   * 获取指定模型的下一个可用Token - 支持模型特定的Token管理
   * @param modelName 模型名称 (如: gemini-2.5-flash, gemini-1.5-pro)
   * @returns 可用的Token字符串，如果没有可用Token则返回null
   */
  public async getNextTokenForModel(modelName: string): Promise<string | null> {
    try {
      await this.cleanupBlacklist();
      await this.resetDailyUsageIfNeeded();

      // 首先尝试查找支持特定模型的Token
      // 查询agent_prompts表中允许的token_ids，然后匹配api_tokens
      const modelSpecificQuery = `
        SELECT DISTINCT t.* FROM api_tokens t
        INNER JOIN agent_prompts ap ON JSON_CONTAINS(ap.allowed_token_ids, CAST(t.id AS JSON), '$')
        WHERE ap.model_name = ?
          AND (t.blacklisted_until IS NULL OR t.blacklisted_until <= NOW())
          AND t.daily_used < t.daily_limit
        ORDER BY
          t.priority ASC,
          (t.daily_used / t.daily_limit) ASC,
          t.last_used ASC,
          t.weight DESC
        LIMIT 1
      `;

      this.moduleLogger.debug('Executing model-specific token query', {
        modelName,
        query: modelSpecificQuery.replace(/\s+/g, ' ').trim()
      });

      const modelSpecificTokens = await this.database.executeQuery<ApiTokenData>(
        modelSpecificQuery,
        [modelName]
      );

      if (modelSpecificTokens.length > 0) {
        const selectedToken = modelSpecificTokens[0];

        // 更新使用统计
        await this.database.executeUpdate(`
          UPDATE api_tokens SET
            last_used = NOW(),
            daily_used = daily_used + 1,
            total_used = total_used + 1
          WHERE id = ?
        `, [selectedToken.id]);

        this.moduleLogger.debug('Selected model-specific token', {
          modelName,
          tokenId: selectedToken.id,
          project: selectedToken.project_name,
          dailyUsed: selectedToken.daily_used + 1,
          dailyLimit: selectedToken.daily_limit
        });

        return selectedToken.token;
      }

      // 如果没有模型特定的Token，回退到通用Token选择
      this.moduleLogger.debug('No model-specific tokens found, falling back to general token selection', { modelName });
      return await this.getNextToken();

    } catch (error) {
      this.moduleLogger.error('Failed to get model-specific token', { modelName, error });
      // 回退到通用Token选择
      return await this.getNextToken();
    }
  }

  /**
   * 报告Token使用成功
   * @param token 使用的Token
   * @param responseTimeMs 响应时间（毫秒）
   * @param geminiUsage Gemini API使用统计
   */
  public async reportSuccess(token: string, responseTimeMs?: number, geminiUsage?: Record<string, any>): Promise<void> {
    try {
      // 重置错误计数，更新健康状态
      await this.database.executeUpdate(`
        UPDATE api_tokens SET 
          error_count = 0,
          last_error = NULL,
          last_error_time = NULL,
          is_healthy = TRUE
        WHERE token = ?
      `, [token]);
      
      
      this.moduleLogger.debug('Token usage successful', {
        tokenPrefix: token.substring(0, 8) + '...',
        responseTime: responseTimeMs
      });
    } catch (error) {
      this.moduleLogger.error('Failed to report token success', { error, tokenPrefix: token.substring(0, 8) + '...' });
    }
  }

  /**
   * 报告Token使用错误
   * @param token 出错的Token
   * @param error 错误信息
   * @param responseTimeMs 响应时间（毫秒）
   */
  public async reportError(token: string, error: string, responseTimeMs?: number): Promise<void> {
    try {
      if (!this.healthConfig) {
        await this.loadHealthConfig();
      }

      // 增加错误计数，更新错误信息
      const updateResult = await this.database.executeUpdate(`
        UPDATE api_tokens SET 
          error_count = error_count + 1,
          last_error = ?,
          last_error_time = NOW(),
          is_healthy = CASE 
            WHEN error_count + 1 >= ? THEN FALSE 
            ELSE is_healthy 
          END,
          blacklisted_until = CASE 
            WHEN error_count + 1 >= ? THEN DATE_ADD(NOW(), INTERVAL ? MINUTE)
            ELSE blacklisted_until 
          END,
          blacklist_reason = CASE 
            WHEN error_count + 1 >= ? THEN CONCAT('连续错误超过阈值: ', ?)
            ELSE blacklist_reason 
          END
        WHERE token = ?
      `, [
        error,
        this.healthConfig!.max_error_count,
        this.healthConfig!.max_error_count,
        this.healthConfig!.blacklist_duration_minutes,
        this.healthConfig!.max_error_count,
        error,
        token
      ]);
      
      if (updateResult > 0) {
        this.moduleLogger.warn('Token error reported', { 
          error,
          tokenPrefix: token.substring(0, 8) + '...'
        });
      }
    } catch (error) {
      this.moduleLogger.error('Failed to report token error', { error: error, tokenPrefix: token.substring(0, 8) + '...' });
    }
  }

  /**
   * 清理过期的黑名单Token
   */
  private async cleanupBlacklist(): Promise<void> {
    try {
      const cleanedTokens = await this.database.executeUpdate(`
        UPDATE api_tokens SET 
          blacklisted_until = NULL,
          blacklist_reason = NULL,
          error_count = 0,
          is_healthy = TRUE
        WHERE blacklisted_until IS NOT NULL 
          AND blacklisted_until < NOW()
      `);
      
      if (cleanedTokens > 0) {
        this.moduleLogger.info(`Cleaned ${cleanedTokens} tokens from blacklist`);
      }
    } catch (error) {
      this.moduleLogger.error('Failed to cleanup blacklist', { error });
    }
  }

  /**
   * 获取Token统计信息
   */
  public async getStats(): Promise<TokenStats> {
    try {
      await this.cleanupBlacklist();
      await this.resetDailyUsageIfNeeded();
      
      const stats = await this.database.executeQuery<any>(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN is_active = TRUE THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN is_healthy = TRUE THEN 1 ELSE 0 END) as healthy,
          SUM(CASE WHEN blacklisted_until > NOW() THEN 1 ELSE 0 END) as blacklisted,
          SUM(CASE WHEN daily_used >= daily_limit THEN 1 ELSE 0 END) as over_daily_limit
        FROM api_tokens
      `);
      
      const tokens = await this.database.executeQuery<any>(`
        SELECT 
          id, project_name, project_id, is_healthy, daily_used, daily_limit, 
          error_count, last_used, blacklisted_until
        FROM api_tokens 
        ORDER BY priority ASC, project_name ASC
      `);
      
      return {
        total: stats[0]?.total || 0,
        active: stats[0]?.active || 0,
        healthy: stats[0]?.healthy || 0,
        blacklisted: stats[0]?.blacklisted || 0,
        over_daily_limit: stats[0]?.over_daily_limit || 0,
        tokens: tokens.map(token => ({
          id: token.id,
          project_name: token.project_name,
          project_id: token.project_id,
          is_healthy: token.is_healthy,
          daily_used: token.daily_used,
          daily_limit: token.daily_limit,
          error_count: token.error_count,
          last_used: token.last_used ? new Date(token.last_used).toISOString() : undefined,
          blacklisted_until: token.blacklisted_until ? new Date(token.blacklisted_until).toISOString() : undefined
        }))
      };
    } catch (error) {
      this.moduleLogger.error('Failed to get token stats', { error });
      return {
        total: 0,
        active: 0,
        healthy: 0,
        blacklisted: 0,
        over_daily_limit: 0,
        tokens: []
      };
    }
  }

  /**
   * 手动清除所有黑名单
   */
  public async clearBlacklist(): Promise<number> {
    try {
      const clearedCount = await this.database.executeUpdate(`
        UPDATE api_tokens SET 
          blacklisted_until = NULL,
          blacklist_reason = NULL,
          error_count = 0,
          is_healthy = TRUE
        WHERE blacklisted_until IS NOT NULL
      `);
      
      this.moduleLogger.info(`Manually cleared ${clearedCount} tokens from blacklist`);
      return clearedCount;
    } catch (error) {
      this.moduleLogger.error('Failed to clear blacklist', { error });
      return 0;
    }
  }
  
  /**
   * 重置每日使用计数（如果需要）
   */
  private async resetDailyUsageIfNeeded(): Promise<void> {
    try {
      const resetResult = await this.database.executeUpdate(`
        UPDATE api_tokens SET 
          daily_used = 0,
          last_reset_date = CURDATE()
        WHERE last_reset_date < CURDATE()
      `);
      
      if (resetResult > 0) {
        this.moduleLogger.info(`Reset daily usage for ${resetResult} tokens`);
      }
    } catch (error) {
      this.moduleLogger.error('Failed to reset daily usage', { error });
    }
  }
  
  
  /**
   * 根据Token值获取Token数据
   */
  private async getTokenByValue(token: string): Promise<ApiTokenData | null> {
    try {
      const results = await this.database.executeQuery<ApiTokenData>(
        'SELECT * FROM api_tokens WHERE token = ? LIMIT 1',
        [token]
      );
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      this.moduleLogger.error('Failed to get token by value', { error });
      return null;
    }
  }
  
  
  /**
   * 启动每日重置定时器
   */
  private startDailyResetTimer(): void {
    if (this.dailyResetTimer) {
      clearTimeout(this.dailyResetTimer);
    }
    
    const now = new Date();
    const resetHour = this.healthConfig?.daily_reset_hour || 0;
    
    // 计算下次重置时间
    const nextReset = new Date();
    nextReset.setHours(resetHour, 0, 0, 0);
    
    if (nextReset <= now) {
      nextReset.setDate(nextReset.getDate() + 1);
    }
    
    const msUntilReset = nextReset.getTime() - now.getTime();
    
    this.dailyResetTimer = setTimeout(async () => {
      await this.resetDailyUsageIfNeeded();
      this.startDailyResetTimer(); // 重新设置下一次
    }, msUntilReset);
    
    this.moduleLogger.info(`Daily reset timer set for ${nextReset.toISOString()}`);
  }
  

  /**
   * Model-aware token失败处理 - 增强功能
   * @param token Token字符串或ID
   * @param modelName 使用的模型名称
   * @param error 错误对象
   * @param context 调用上下文
   */
  public async markTokenFailedForModel(token: string | number, modelName: string, error: any, context: string = 'LLM调用'): Promise<void> {
    try {
      // 确定token ID
      let tokenId: number;
      let tokenInfo = '';
      
      if (typeof token === 'string') {
        const results = await this.database.executeQuery<ApiTokenData>(
          'SELECT id, project_name FROM api_tokens WHERE token = ? LIMIT 1',
          [token]
        );
        
        if (results.length === 0) {
          this.moduleLogger.warn('Token not found for model-specific failure recording', { token: token.substring(0, 20) + '...' });
          return;
        }
        
        tokenId = results[0].id;
        tokenInfo = results[0].project_name;
      } else {
        tokenId = token;
        tokenInfo = `ID:${token}`;
      }

      // 构建错误信息
      let errorMessage = '';
      let shouldBlacklist = false;

      if (error?.response) {
        const status = error.response.status;
        const statusText = error.response.statusText || '';
        errorMessage = `[${context}][${modelName}] HTTP ${status}: ${statusText}`;
        
        // 429/403/401 自动5分钟模型级黑名单
        if (status === 429 || status === 403 || status === 401) {
          shouldBlacklist = true;
        }
      } else if (error?.message) {
        errorMessage = `[${context}][${modelName}] ${error.message}`;
      } else {
        errorMessage = `[${context}][${modelName}] Unknown error`;
      }

      if (shouldBlacklist) {
        // 获取当前的模型黑名单
        const currentData = await this.database.executeQuery<{model_blacklist: any}>(
          'SELECT model_blacklist FROM api_tokens WHERE id = ? LIMIT 1',
          [tokenId]
        );
        
        const currentBlacklist = currentData[0]?.model_blacklist || {};
        const blacklistUntil = new Date(Date.now() + 5 * 60 * 1000); // 5分钟后
        
        // 更新特定模型的黑名单
        const newBlacklist = {
          ...currentBlacklist,
          [modelName]: blacklistUntil.toISOString().slice(0, 19).replace('T', ' ')
        };
        
        await this.database.executeQuery(
          `UPDATE api_tokens 
           SET model_blacklist = ?,
               error_count = error_count + 1,
               last_error = ?,
               last_error_time = NOW()
           WHERE id = ?`,
          [JSON.stringify(newBlacklist), errorMessage, tokenId]
        );
        
        this.moduleLogger.warn('Token blacklisted for specific model', {
          tokenInfo,
          tokenId,
          modelName,
          error: errorMessage,
          duration: '5 minutes',
          blacklistUntil: blacklistUntil.toISOString()
        });
      } else {
        // 只记录错误，不黑名单
        await this.database.executeQuery(
          `UPDATE api_tokens 
           SET error_count = error_count + 1,
               last_error = ?,
               last_error_time = NOW()
           WHERE id = ?`,
          [errorMessage, tokenId]
        );
        
        this.moduleLogger.info('Token model error recorded', {
          tokenInfo,
          tokenId,
          modelName,
          error: errorMessage
        });
      }
    } catch (updateError) {
      this.moduleLogger.error('Failed to record model-specific token failure', {
        updateError,
        originalError: error,
        modelName,
        context
      });
    }
  }

  /**
   * 被动更新：记录token使用失败 - 向后兼容方法
   * @param token Token字符串或ID
   * @param error 错误对象
   * @param context 调用上下文 (如 'LLM请求', 'AI服务调用')
   */
  public async markTokenFailed(token: string | number, error: any, context: string = 'LLM调用'): Promise<void> {
    // 使用默认模型名称调用新的model-aware方法
    return this.markTokenFailedForModel(token, 'gemini-2.5-flash', error, context);
  }

  /**
   * 被动更新：记录token使用成功
   * @param token Token字符串或ID
   */
  public async markTokenSuccess(token: string | number): Promise<void> {
    try {
      // 确定token ID
      let tokenId: number;
      
      if (typeof token === 'string') {
        const results = await this.database.executeQuery<ApiTokenData>(
          'SELECT id FROM api_tokens WHERE token = ? LIMIT 1',
          [token]
        );
        
        if (results.length === 0) {
          this.moduleLogger.warn('Token not found for success recording', { token: token.substring(0, 20) + '...' });
          return;
        }
        
        tokenId = results[0].id;
      } else {
        tokenId = token;
      }

      // 更新使用统计
      await this.database.executeQuery(
        `UPDATE api_tokens 
         SET daily_used = daily_used + 1,
             total_used = total_used + 1,
             last_used = NOW()
         WHERE id = ?`,
        [tokenId]
      );
      
      this.moduleLogger.debug('Token usage recorded', { tokenId });
    } catch (error) {
      this.moduleLogger.error('Failed to record token success', { error });
    }
  }

  /**
   * 获取可用token并自动记录使用 - 带试错机制
   * @param maxRetries 最大重试次数
   * @returns Token信息或null
   */
  public async getTokenWithRetry(maxRetries: number = 3): Promise<{
    token: string;
    tokenId: number;
    projectName: string;
  } | null> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const tokenString = await this.getNextToken();
        
        if (!tokenString) {
          this.moduleLogger.warn(`No available tokens found on attempt ${attempt + 1}`);
          continue;
        }
        
        // 获取token详细信息
        const tokenInfo = await this.database.executeQuery<ApiTokenData>(
          'SELECT id, project_name FROM api_tokens WHERE token = ? LIMIT 1',
          [tokenString]
        );
        
        if (tokenInfo.length === 0) {
          this.moduleLogger.warn('Token info not found', { token: tokenString.substring(0, 20) + '...' });
          continue;
        }
        
        const token = tokenInfo[0];
        
        // 记录token成功获取
        await this.markTokenSuccess(token.id);
        
        return {
          token: tokenString,
          tokenId: token.id,
          projectName: token.project_name
        };
        
      } catch (error) {
        this.moduleLogger.warn(`Token retrieval failed on attempt ${attempt + 1}`, { error });
        
        if (attempt === maxRetries - 1) {
          this.moduleLogger.error('All token retrieval attempts failed');
          return null;
        }
      }
    }
    
    return null;
  }

  /**
   * Model-aware token获取 - 核心增强功能
   * @param modelName 模型名称 (如 'gemini-2.5-flash')
   * @param agentType Agent类型 (如 'chat_bot')
   * @param promptName Prompt名称 (如 'default')
   * @param maxRetries 最大重试次数
   * @returns Token信息或null
   */
  public async getTokenForModel(
    modelName: string, 
    agentType: string, 
    promptName: string, 
    maxRetries: number = 3
  ): Promise<{
    token: string;
    tokenId: number;
    projectName: string;
  } | null> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // 查询支持该模型的可用token
        const query = `
          SELECT t.id, t.token, t.project_name
          FROM api_tokens t
          JOIN agent_prompts ap ON (
            ap.model_name = ?
            AND ap.agent_type = ?
            AND ap.prompt_name = ?
            AND ap.is_active = TRUE
            AND (ap.allowed_token_ids IS NULL OR JSON_CONTAINS(ap.allowed_token_ids, CAST(t.id AS JSON)))
          )
          WHERE t.daily_used < t.daily_limit
            AND (
              t.model_blacklist IS NULL 
              OR JSON_EXTRACT(t.model_blacklist, CONCAT('$."', ?, '"')) IS NULL
              OR STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(t.model_blacklist, CONCAT('$."', ?, '"'))), '%Y-%m-%d %H:%i:%s') <= NOW()
            )
          ORDER BY 
            t.priority ASC,
            (t.daily_used / t.daily_limit) ASC,
            t.last_used ASC
          LIMIT 1
        `;

        this.moduleLogger.debug('Executing model-aware token query', { 
          modelName, 
          agentType, 
          promptName,
          attempt: attempt + 1
        });

        const results = await this.database.executeQuery<{
          id: number;
          token: string; 
          project_name: string;
        }>(query, [modelName, agentType, promptName, modelName, modelName]);

        if (results.length === 0) {
          this.moduleLogger.warn(`No available tokens for model on attempt ${attempt + 1}`, { 
            modelName, 
            agentType, 
            promptName 
          });
          continue;
        }

        const token = results[0];
        
        // 更新使用统计
        await this.database.executeUpdate(`
          UPDATE api_tokens SET 
            last_used = NOW(),
            daily_used = daily_used + 1,
            total_used = total_used + 1
          WHERE id = ?
        `, [token.id]);
        
        this.moduleLogger.debug('Selected token for model', {
          tokenId: token.id,
          projectName: token.project_name,
          modelName,
          attempt: attempt + 1
        });

        return {
          token: token.token,
          tokenId: token.id,
          projectName: token.project_name
        };

      } catch (error) {
        this.moduleLogger.warn(`Model-aware token retrieval failed on attempt ${attempt + 1}`, { 
          error,
          modelName,
          agentType,
          promptName
        });
        
        if (attempt === maxRetries - 1) {
          this.moduleLogger.error('All model-aware token retrieval attempts failed', {
            modelName,
            agentType,
            promptName
          });
          return null;
        }
      }
    }
    
    return null;
  }
  
  /**
   * 销毁管理器，清理定时器
   */
  public destroy(): void {
    if (this.dailyResetTimer) {
      clearTimeout(this.dailyResetTimer);
    }
    this.moduleLogger.info('Token Manager destroyed (passive mode)');
  }
}

// 单例导出
let tokenManagerInstance: TokenManager | null = null;

export function getTokenManager(database?: DatabaseManager): TokenManager {
  if (!tokenManagerInstance) {
    tokenManagerInstance = new TokenManager(database);
  }
  return tokenManagerInstance;
}

export function resetTokenManager(): void {
  if (tokenManagerInstance) {
    tokenManagerInstance.destroy();
    tokenManagerInstance = null;
  }
}
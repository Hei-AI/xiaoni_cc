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
  private healthCheckTimer?: ReturnType<typeof setTimeout>;
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
      await this.loadHealthConfig();
      await this.resetDailyUsageIfNeeded();
      this.startHealthCheckTimer();
      this.startDailyResetTimer();
      
      this.moduleLogger.info('Token Manager initialized with database backend');
    } catch (error) {
      this.moduleLogger.error('Failed to initialize Token Manager', { error });
    }
  }

  /**
   * 加载健康检查配置
   */
  private async loadHealthConfig(): Promise<void> {
    try {
      const configs = await this.database.executeQuery<TokenHealthConfig>(
        'SELECT * FROM api_token_health_config WHERE enabled = TRUE ORDER BY id DESC LIMIT 1'
      );
      
      this.healthConfig = configs[0] || {
        check_interval_minutes: 30,
        max_error_count: 3,
        blacklist_duration_minutes: 300,
        health_check_timeout_ms: 10000,
        daily_reset_hour: 0,
        enabled: true
      } as TokenHealthConfig;
      
      this.moduleLogger.debug('Health config loaded', this.healthConfig);
    } catch (error) {
      this.moduleLogger.warn('Failed to load health config, using defaults', { error });
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
      
      // 查询可用Token：活跃、健康、未黑名单、未超过每日限制
      const availableTokens = await this.database.executeQuery<ApiTokenData>(`
        SELECT * FROM api_tokens 
        WHERE is_active = TRUE 
          AND is_healthy = TRUE 
          AND (blacklisted_until IS NULL OR blacklisted_until < NOW())
          AND daily_used < daily_limit
        ORDER BY 
          priority ASC,           -- 优先级排序（1=最高优先级）
          (daily_used / daily_limit) ASC,  -- 使用率排序
          last_used ASC,          -- 最少最近使用
          weight DESC             -- 权重排序
        LIMIT 1
      `);

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
      
      // 记录使用日志
      await this.logTokenAction(selectedToken.id, 'use');

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
      
      // 记录成功日志
      const tokenData = await this.getTokenByValue(token);
      if (tokenData) {
        await this.logTokenAction(tokenData.id, 'success', 'success', undefined, responseTimeMs, geminiUsage);
      }
      
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
        // 记录错误日志
        const tokenData = await this.getTokenByValue(token);
        if (tokenData) {
          await this.logTokenAction(tokenData.id, 'error', 'error', error, responseTimeMs);
          
          if (tokenData.error_count + 1 >= this.healthConfig!.max_error_count) {
            this.moduleLogger.warn('Token blacklisted due to repeated errors', {
              id: tokenData.id,
              project: tokenData.project_name,
              errorCount: tokenData.error_count + 1,
              error,
              tokenPrefix: token.substring(0, 8) + '...'
            });
          } else {
            this.moduleLogger.warn('Token error reported', {
              id: tokenData.id,
              project: tokenData.project_name,
              errorCount: tokenData.error_count + 1,
              error,
              tokenPrefix: token.substring(0, 8) + '...'
            });
          }
        }
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
   * 记录Token操作日志
   */
  private async logTokenAction(
    tokenId: number, 
    action: 'use' | 'success' | 'error' | 'health_check',
    result?: 'success' | 'error' | 'timeout' | 'quota_exceeded',
    errorMessage?: string,
    responseTimeMs?: number,
    geminiUsage?: Record<string, any>
  ): Promise<void> {
    try {
      // 确保所有参数都不是undefined，用null替代undefined
      const params = [
        tokenId,
        action,
        result || null,
        errorMessage || null,
        responseTimeMs || null,
        geminiUsage ? JSON.stringify(geminiUsage) : null
      ];
      
      this.moduleLogger.debug('Logging token action', { 
        tokenId, 
        action, 
        result, 
        hasError: !!errorMessage,
        hasResponseTime: responseTimeMs !== undefined,
        hasGeminiUsage: !!geminiUsage 
      });
      
      await this.database.executeUpdate(`
        INSERT INTO api_token_logs 
        (token_id, action, result, error_message, response_time_ms, gemini_usage)
        VALUES (?, ?, ?, ?, ?, ?)
      `, params);
    } catch (error) {
      this.moduleLogger.error('Failed to log token action', { error, tokenId, action, result });
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
   * 启动健康检查定时器
   */
  private startHealthCheckTimer(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    
    if (!this.healthConfig?.enabled) {
      return;
    }
    
    const intervalMs = this.healthConfig.check_interval_minutes * 60 * 1000;
    
    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthCheck();
    }, intervalMs);
    
    this.moduleLogger.info(`Health check timer started with ${this.healthConfig.check_interval_minutes} minute interval`);
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
   * 执行健康检查
   */
  private async performHealthCheck(): Promise<void> {
    try {
      const tokens = await this.database.executeQuery<ApiTokenData>(
        'SELECT * FROM api_tokens WHERE is_active = TRUE'
      );
      
      this.moduleLogger.info(`Starting health check for ${tokens.length} active tokens`);
      
      const healthCheckPromises = tokens.map(token => this.checkTokenHealth(token));
      const results = await Promise.allSettled(healthCheckPromises);
      
      const healthyCount = results.filter(result => 
        result.status === 'fulfilled' && result.value
      ).length;
      
      this.moduleLogger.info(`Health check completed: ${healthyCount}/${tokens.length} tokens healthy`);
    } catch (error) {
      this.moduleLogger.error('Health check failed', { error });
    }
  }
  
  /**
   * 检查单个Token健康状态
   */
  private async checkTokenHealth(tokenData: ApiTokenData): Promise<boolean> {
    const startTime = Date.now();
    let isHealthy = false;
    let errorMessage = '';
    
    try {
      // 使用简单的API调用测试Token有效性
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
        {
          contents: [{
            parts: [{
              text: "Explain how AI works in a few words"
            }]
          }]
        },
        {
          headers: {
            'X-goog-api-key': tokenData.token,
            'Content-Type': 'application/json'
          },
          timeout: this.healthConfig?.health_check_timeout_ms || 10000
        }
      );
      
      isHealthy = response.status === 200 && response.data?.candidates?.length > 0;
      
    } catch (error) {
      isHealthy = false;
      if (axios.isAxiosError(error)) {
        errorMessage = `HTTP ${error.response?.status}: ${error.response?.statusText || error.message}`;
      } else {
        errorMessage = error instanceof Error ? error.message : 'Unknown error';
      }
    }
    
    const responseTime = Date.now() - startTime;
    
    // 更新数据库中的健康状态
    await this.database.executeUpdate(`
      UPDATE api_tokens SET 
        is_healthy = ?,
        last_health_check = NOW(),
        last_error = CASE WHEN ? = FALSE THEN ? ELSE last_error END,
        last_error_time = CASE WHEN ? = FALSE THEN NOW() ELSE last_error_time END
      WHERE id = ?
    `, [isHealthy, isHealthy, errorMessage, isHealthy, tokenData.id]);
    
    // 记录健康检查日志
    await this.logTokenAction(
      tokenData.id,
      'health_check',
      isHealthy ? 'success' : 'error',
      isHealthy ? undefined : errorMessage,
      responseTime
    );
    
    if (!isHealthy) {
      this.moduleLogger.warn('Token health check failed', {
        id: tokenData.id,
        project: tokenData.project_name,
        error: errorMessage,
        responseTime,
        tokenPrefix: tokenData.token.substring(0, 8) + '...'
      });
    }
    
    return isHealthy;
  }
  
  /**
   * 手动触发健康检查
   */
  public async runHealthCheck(): Promise<void> {
    await this.performHealthCheck();
  }
  
  /**
   * 销毁管理器，清理定时器
   */
  public destroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    if (this.dailyResetTimer) {
      clearTimeout(this.dailyResetTimer);
    }
    this.moduleLogger.info('Token Manager destroyed');
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
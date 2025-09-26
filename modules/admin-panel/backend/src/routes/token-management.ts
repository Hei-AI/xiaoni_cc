import express from 'express';
import { DatabaseManager } from '../services/database';
import winston from 'winston';

const router = express.Router();

// 创建Token管理路由
export function createTokenRoutes(database: DatabaseManager, logger: winston.Logger) {
  // Token状态查询接口 - 管理端专用
  router.get('/tokens', async (req, res) => {
    try {
      const tokens = await database.executeQuery(`
        SELECT
          id, project_name, priority, weight, daily_used, daily_limit,
          blacklisted_until, total_used, last_used, is_active, created_at,
          model_blacklist
        FROM api_tokens
        ORDER BY priority ASC, created_at DESC
      `);

      const now = Date.now();
      const processedTokens = tokens.map((token: any) => {
        let modelBlacklist: Record<string, string> = {};
        try {
          modelBlacklist = token.model_blacklist ? JSON.parse(token.model_blacklist) : {};
        } catch (e) {
          logger.warn(`Invalid model_blacklist JSON for token ${token.id}`, { model_blacklist: token.model_blacklist });
          modelBlacklist = {};
        }

        const blacklistTime = token.blacklisted_until ? new Date(token.blacklisted_until).getTime() : null;
        const isBlacklisted = blacklistTime && blacklistTime > now;

        let status = 'active';
        if (!token.is_active) {
          status = 'disabled';
        } else if (isBlacklisted) {
          status = 'blacklisted';
        } else if (blacklistTime && blacklistTime <= now) {
          status = 'recovered';
        }

        return {
          ...token,
          model_blacklist: modelBlacklist,
          status,
          usage_ratio: token.daily_limit > 0 ? (token.daily_used / token.daily_limit) : 0,
          recovery_time: blacklistTime && blacklistTime > now ? blacklistTime : null
        };
      });

      res.json({
        success: true,
        data: processedTokens,
        total: processedTokens.length,
        summary: {
          active: processedTokens.filter((t: any) => t.status === 'active').length,
          blacklisted: processedTokens.filter((t: any) => t.status === 'blacklisted').length,
          disabled: processedTokens.filter((t: any) => t.status === 'disabled').length,
          recovered: processedTokens.filter((t: any) => t.status === 'recovered').length
        }
      });
    } catch (error) {
      logger.error('Failed to get tokens', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve tokens'
      });
    }
  });

  // 永久禁用Token接口
  router.post('/tokens/:id/disable', async (req, res) => {
    try {
      const tokenId = parseInt(req.params.id);

      if (isNaN(tokenId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid token ID'
        });
      }

      await database.executeUpdate(
        'UPDATE api_tokens SET is_active = FALSE WHERE id = ?',
        [tokenId]
      );

      logger.info(`Token ${tokenId} disabled permanently`);

      res.json({
        success: true,
        message: `Token ID ${tokenId} has been permanently disabled`
      });
    } catch (error) {
      logger.error('Failed to disable token', { error, tokenId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Failed to disable token'
      });
    }
  });

  // 启用Token接口
  router.post('/tokens/:id/enable', async (req, res) => {
    try {
      const tokenId = parseInt(req.params.id);

      if (isNaN(tokenId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid token ID'
        });
      }

      await database.executeUpdate(
        'UPDATE api_tokens SET is_active = TRUE, blacklisted_until = NULL WHERE id = ?',
        [tokenId]
      );

      logger.info(`Token ${tokenId} enabled`);

      res.json({
        success: true,
        message: `Token ID ${tokenId} has been enabled`
      });
    } catch (error) {
      logger.error('Failed to enable token', { error, tokenId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Failed to enable token'
      });
    }
  });

  // Token统计数据接口
  router.get('/tokens/stats', async (req, res) => {
    try {
      const stats = await database.executeQuery(`
        SELECT
          COUNT(*) as total_tokens,
          COUNT(CASE WHEN is_active = 1 THEN 1 END) as active_tokens,
          COUNT(CASE WHEN is_active = 0 THEN 1 END) as disabled_tokens,
          COUNT(CASE WHEN blacklisted_until > NOW() THEN 1 END) as blacklisted_tokens,
          SUM(daily_used) as total_daily_usage,
          SUM(daily_limit) as total_daily_limit,
          SUM(total_used) as total_usage,
          AVG(daily_used / NULLIF(daily_limit, 0)) as avg_usage_ratio
        FROM api_tokens
      `);

      const recentUsage = await database.executeQuery(`
        SELECT
          DATE(last_used) as usage_date,
          COUNT(*) as tokens_used
        FROM api_tokens
        WHERE last_used >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        GROUP BY DATE(last_used)
        ORDER BY usage_date DESC
        LIMIT 7
      `);

      const topTokens = await database.executeQuery(`
        SELECT
          id, project_name, daily_used, daily_limit,
          (daily_used / NULLIF(daily_limit, 0)) as usage_ratio,
          total_used
        FROM api_tokens
        WHERE is_active = 1
        ORDER BY daily_used DESC
        LIMIT 5
      `);

      res.json({
        success: true,
        data: {
          overview: stats[0] || {},
          recent_usage: recentUsage,
          top_tokens: topTokens
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to get token stats', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve token statistics',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
}

export default createTokenRoutes;
import express from 'express';
import { DatabaseManager } from '../services/database';
import winston from 'winston';

const router = express.Router();

// 创建Token管理路由
export function createTokenRoutes(database: DatabaseManager, logger: winston.Logger) {
  // Token统计数据接口
  router.get('/tokens/stats', async (_req, res) => {
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

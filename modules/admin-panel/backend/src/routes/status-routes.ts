import express from 'express';
import { DatabaseManager } from '../services/database';
import winston from 'winston';

// 创建状态和健康检查相关路由
export function createStatusRoutes(database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();

  // 健康检查端点
  router.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.version
    });
  });

  // API状态端点
  router.get('/status', (req, res) => {
    res.json({
      status: 'operational',
      service: 'Admin Panel Backend',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      database: database ? 'connected' : 'disconnected'
    });
  });

  // 仪表板统计数据
  router.get('/dashboard/stats', async (req, res) => {
    try {
      if (!database) {
        return res.status(500).json({
          success: false,
          error: 'Database service not available',
          timestamp: new Date().toISOString()
        });
      }

      // 并行获取各种统计数据
      const [
        conversationsResult,
        tokensResult,
        sessionsResult,
        llmCallsResult
      ] = await Promise.all([
        database.executeQuery<{ count: number }>('SELECT COUNT(*) as count FROM conversations'),
        database.executeQuery<{ count: number }>('SELECT COUNT(*) as count FROM api_tokens'),
        database.executeQuery<{ count: number }>('SELECT COUNT(*) as count FROM conversation_sessions WHERE status = "active"'),
        database.executeQuery<{ count: number }>('SELECT COUNT(*) as count FROM llm_call_logs WHERE DATE(timestamp) = CURDATE()')
      ]);

      res.json({
        success: true,
        data: {
          total_conversations: conversationsResult[0]?.count || 0,
          total_tokens: tokensResult[0]?.count || 0,
          active_sessions: sessionsResult[0]?.count || 0,
          llm_calls_today: llmCallsResult[0]?.count || 0
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to fetch dashboard stats', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch dashboard stats',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 数据库连接测试
  router.get('/database/test', async (req, res) => {
    try {
      if (!database) {
        return res.status(500).json({
          success: false,
          error: 'Database service not available',
          timestamp: new Date().toISOString()
        });
      }

      // 简单的数据库查询测试
      const result = await database.executeQuery('SELECT 1 as test');

      res.json({
        success: true,
        message: 'Database connection successful',
        result: result[0],
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Database connection test failed', { error });
      res.status(500).json({
        success: false,
        error: 'Database connection failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
}

export default createStatusRoutes;
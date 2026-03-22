import express from 'express';
import axios from 'axios';
import { DatabaseManager } from '../services/database';
import winston from 'winston';

const QQBOT_CORE_URL = process.env.QQBOT_CORE_URL || 'http://qqbot-qqbot-core:8081';
const CORE_REQUEST_TIMEOUT_MS = 5000;

interface BotStatusRow {
  bot_id: string;
  status: 'online' | 'offline' | 'error';
  websocket_connected: number | boolean;
  http_server_running: number | boolean;
  last_heartbeat: string | null;
  error_message: string | null;
  timestamp: string | null;
}

type CoreProbeResult =
  | {
      ok: true;
      statusCode: number;
      payload: unknown;
      error?: never;
    }
  | {
      ok: false;
      statusCode: number | null;
      payload?: never;
      error: string;
    };

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

  router.get('/runtime/status', async (_req, res) => {
    try {
      const [databaseLive, coreProbe, botStatusRows] = await Promise.all([
        database.testConnection(),
        axios
          .get(`${QQBOT_CORE_URL}/health`, {
            timeout: CORE_REQUEST_TIMEOUT_MS,
            validateStatus: () => true
          })
          .then<CoreProbeResult>(response => {
            if (response.status >= 200 && response.status < 300) {
              return {
                ok: true,
                statusCode: response.status,
                payload: response.data
              };
            }

            return {
              ok: false,
              statusCode: response.status,
              error: `qqbot-core health check returned HTTP ${response.status}`
            };
          })
          .catch<CoreProbeResult>(error => ({
            ok: false,
            statusCode: null as number | null,
            error: error instanceof Error ? error.message : 'Unknown error'
          })),
        database.executeQuery<BotStatusRow>(
          `SELECT bot_id, status, websocket_connected, http_server_running, last_heartbeat, error_message, timestamp
           FROM bot_status
           ORDER BY timestamp DESC
           LIMIT 1`
        )
      ]);

      const latestBotStatus = botStatusRows[0];
      const websocketConnected = Boolean(latestBotStatus?.websocket_connected);
      const httpServerRunning = coreProbe.ok || Boolean(latestBotStatus?.http_server_running);
      const coreStatus =
        !coreProbe.ok
          ? 'offline'
          : latestBotStatus?.status || (websocketConnected ? 'online' : 'offline');

      const overallStatus =
        !coreProbe.ok
          ? 'offline'
          : !databaseLive || coreStatus === 'error' || !websocketConnected
            ? 'degraded'
            : 'healthy';

      res.json({
        success: true,
        data: {
          status: overallStatus,
          core: {
            live: coreProbe.ok,
            connected: websocketConnected,
            status: coreStatus,
            botId: latestBotStatus?.bot_id || null,
            httpServerRunning,
            lastHeartbeat: latestBotStatus?.last_heartbeat || latestBotStatus?.timestamp || null,
            errorMessage: latestBotStatus?.error_message || (!coreProbe.ok ? coreProbe.error || 'qqbot-core health check failed' : null),
            url: QQBOT_CORE_URL,
            healthStatusCode: coreProbe.statusCode
          },
          admin: {
            live: true,
            status: 'online'
          },
          database: {
            live: databaseLive,
            status: databaseLive ? 'online' : 'offline'
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch runtime status', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch runtime status',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
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
        database.executeQuery<{ count: number }>(
          `SELECT COUNT(*) as count
           FROM llm_call_logs
           WHERE timestamp >= CURDATE()
             AND timestamp < DATE_ADD(CURDATE(), INTERVAL 1 DAY)`
        )
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

import express from 'express';
import axios from 'axios';
import { DatabaseManager } from '../services/database';
import winston from 'winston';

const PROVIDER_SERVICE_URL = process.env.PROVIDER_SERVICE_URL || 'http://qqbot-provider-service:8090';
const PROVIDER_REQUEST_TIMEOUT_MS = 5000;

type ProviderProbeResult =
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
      const [databaseLive, providerProbe] = await Promise.all([
        database.testConnection(),
        axios
          .get(`${PROVIDER_SERVICE_URL}/health`, {
            timeout: PROVIDER_REQUEST_TIMEOUT_MS,
            validateStatus: () => true
          })
          .then<ProviderProbeResult>(response => {
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
              error: `provider-service health check returned HTTP ${response.status}`
            };
          })
          .catch<ProviderProbeResult>(error => ({
            ok: false,
            statusCode: null as number | null,
            error: error instanceof Error ? error.message : 'Unknown error'
          }))
      ]);
      const providerPayload = providerProbe.ok && typeof providerProbe.payload === 'object' && providerProbe.payload !== null
        ? providerProbe.payload as Record<string, any>
        : {};
      const napcat = providerPayload.napcat && typeof providerPayload.napcat === 'object'
        ? providerPayload.napcat as Record<string, any>
        : {};
      const providerConnected = Boolean(napcat.reachable);
      const providerStatus = providerProbe.ok
        ? (providerConnected ? 'online' : 'offline')
        : 'offline';

      const overallStatus =
        !providerProbe.ok
          ? 'offline'
          : !databaseLive || !providerConnected
            ? 'degraded'
            : 'healthy';

      res.json({
        success: true,
        data: {
          status: overallStatus,
          provider: {
            live: providerProbe.ok,
            connected: providerConnected,
            status: providerStatus,
            botId: napcat.selfId ? String(napcat.selfId) : null,
            httpServerRunning: providerProbe.ok,
            lastHeartbeat: typeof providerPayload.timestamp === 'string' ? providerPayload.timestamp : null,
            errorMessage: providerProbe.ok ? (napcat.error || null) : (providerProbe.error || 'provider-service health check failed'),
            url: PROVIDER_SERVICE_URL,
            healthStatusCode: providerProbe.statusCode
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
        sessionsResult,
        llmCallsResult
      ] = await Promise.all([
        database.executeQuery<{ count: number }>('SELECT COUNT(*) as count FROM conversations'),
        database.executeQuery<{ count: number }>("SELECT COUNT(*) as count FROM conversation_sessions WHERE status = 'active'"),
        database.executeQuery<{ count: number }>(
          `SELECT COUNT(*) as count
           FROM llm_call_logs
           WHERE timestamp >= CURRENT_DATE
             AND timestamp < CURRENT_DATE + INTERVAL '1 day'`
        )
      ]);

      res.json({
        success: true,
        data: {
          total_conversations: conversationsResult[0]?.count || 0,
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

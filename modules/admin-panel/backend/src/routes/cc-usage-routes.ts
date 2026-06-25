import express from 'express';
import { DatabaseManager } from '../services/database';
import winston from 'winston';
import {
  getCcSubscriptionQuotaSnapshot,
  getCcSubscriptionQuotaTimeline,
} from '@qq-bot/persistence';

/**
 * CC 订阅账号 usage 路由（只读）。
 *
 * 事实来源是 llm_request_slices.metadata.provider_response_headers 里的
 * anthropic-ratelimit-unified-* 头 —— Anthropic 在订阅端点每次响应直接回的真实额度。
 * 这里不做估算，只读取并整形：
 *   /api/cc-usage/quota     最新额度快照（5h / 周 utilization + 剩余 + 重置时刻）
 *   /api/cc-usage/timeline  utilization 随时间序列
 */
export function createCcUsageRoutes(_database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();

  const resolveTimeWindow = (range: unknown, startTime: unknown, endTime: unknown) => {
    const normalizedRange = typeof range === 'string' ? range : '7d';
    const now = Date.now();
    if (normalizedRange === 'custom') {
      return {
        startTime: typeof startTime === 'string' && startTime.trim() ? startTime : undefined,
        endTime: typeof endTime === 'string' && endTime.trim() ? endTime : undefined,
      };
    }
    switch (normalizedRange) {
      case '24h':
        return { startTime: new Date(now - 24 * 60 * 60 * 1000).toISOString(), endTime: undefined };
      case '30d':
        return { startTime: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(), endTime: undefined };
      case '7d':
      default:
        return { startTime: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(), endTime: undefined };
    }
  };

  // 当前额度快照（截至最后一次订阅请求）
  router.get('/cc-usage/quota', async (req, res) => {
    try {
      const provider = typeof req.query.provider === 'string' && req.query.provider.trim()
        ? req.query.provider.trim()
        : undefined;
      const snapshot = await getCcSubscriptionQuotaSnapshot({ provider });
      res.json({
        success: true,
        data: snapshot,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to load CC subscription quota snapshot', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load CC subscription quota snapshot',
        timestamp: new Date().toISOString(),
      });
    }
  });

  // utilization 随时间序列
  router.get('/cc-usage/timeline', async (req, res) => {
    try {
      const provider = typeof req.query.provider === 'string' && req.query.provider.trim()
        ? req.query.provider.trim()
        : undefined;
      const timeWindow = resolveTimeWindow(req.query.range, req.query.start_time, req.query.end_time);
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 1500, 4000);
      const timeline = await getCcSubscriptionQuotaTimeline({
        provider,
        startTime: timeWindow.startTime,
        endTime: timeWindow.endTime,
        limit,
      });
      res.json({
        success: true,
        data: timeline,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Failed to load CC subscription quota timeline', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load CC subscription quota timeline',
        timestamp: new Date().toISOString(),
      });
    }
  });

  return router;
}

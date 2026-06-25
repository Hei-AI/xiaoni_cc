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

  // 与小腻行动流 LLM Cost (/api/xiaoni/action-stream/llm-usage) 共用同一份时间窗口契约：
  // 预设 range（1h/6h/24h/7d/30d）按 now 回推；custom/all 走显式 start_time/end_time。
  // 这样额度折线图和 LLM Cost 折线图能落在同一个 x 轴窗口里，方便对齐缓存击穿的跳变点。
  const RANGE_MS: Record<string, number> = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };

  const firstStr = (value: unknown): string | undefined => {
    if (Array.isArray(value)) {
      return firstStr(value[0]);
    }
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };

  const resolveTimeWindow = (range: unknown, startTime: unknown, endTime: unknown) => {
    const normalizedRange = firstStr(range) || '7d';
    if (Object.prototype.hasOwnProperty.call(RANGE_MS, normalizedRange)) {
      const now = Date.now();
      return {
        startTime: new Date(now - RANGE_MS[normalizedRange]).toISOString(),
        endTime: new Date(now).toISOString(),
      };
    }
    // custom / all：用显式窗口，缺省时由 persistence 兜底默认跨度
    return {
      startTime: firstStr(startTime),
      endTime: firstStr(endTime),
    };
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

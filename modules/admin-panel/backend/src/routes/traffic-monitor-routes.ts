import express from 'express';
import { DatabaseManager } from '../services/database';
import { TrafficReplayService } from '../services/traffic-replay-service';
import winston from 'winston';
import {
  exportTrafficLogs,
  getTrafficEndpoints,
  getTrafficLogById,
  getTrafficStats,
  listTrafficLogs,
  searchTrafficLogs
} from '@qq-bot/persistence';

/**
 * HTTP流量监控相关路由
 * 提供HTTP流量记录的查询、筛选和统计功能
 */
export function createTrafficMonitorRoutes(database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();

  // 初始化流量重放服务
  const replayService = new TrafficReplayService(database);

  const buildTimeCondition = (range: unknown, startTime: unknown, endTime: unknown) => {
    const normalizedRange = typeof range === 'string' ? range : '24h';
    const now = Date.now();

    if (normalizedRange === 'custom') {
      return {
        startTime: typeof startTime === 'string' && startTime.trim() ? startTime : undefined,
        endTime: typeof endTime === 'string' && endTime.trim() ? endTime : undefined
      };
    }

    switch (normalizedRange) {
      case '1h':
        return { startTime: new Date(now - 60 * 60 * 1000).toISOString(), endTime: undefined };
      case '7d':
        return { startTime: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(), endTime: undefined };
      case '30d':
        return { startTime: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(), endTime: undefined };
      case '24h':
      default:
        return { startTime: new Date(now - 24 * 60 * 60 * 1000).toISOString(), endTime: undefined };
    }
  };

  // 获取HTTP流量记录列表
  router.get('/traffic/logs', async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const timeFilter = buildTimeCondition(req.query.range, req.query.start_time, req.query.end_time);
      const isAiRequest = req.query.is_ai_request === 'true'
        ? true
        : req.query.is_ai_request === 'false'
          ? false
          : undefined;

      const result = await listTrafficLogs({
        page,
        limit,
        filters: {
          startTime: timeFilter.startTime,
          endTime: timeFilter.endTime,
          method: typeof req.query.method === 'string' ? req.query.method : undefined,
          host: typeof req.query.host === 'string' ? req.query.host : undefined,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          isAiRequest,
          apiType: typeof req.query.api_type === 'string' ? req.query.api_type : undefined,
          containerName: typeof req.query.container_name === 'string' ? req.query.container_name : undefined,
          traceId: typeof req.query.trace_id === 'string' ? req.query.trace_id : undefined,
          search: typeof req.query.search === 'string' ? req.query.search : undefined
        }
      });

      res.json({
        success: true,
        data: result.data,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          pages: Math.ceil(result.total / result.limit)
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to fetch HTTP traffic logs', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch HTTP traffic logs',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 获取单条HTTP流量记录详情
  router.get('/traffic/logs/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const log = await getTrafficLogById(id);

      if (!log) {
        return res.status(404).json({
          success: false,
          error: 'Traffic log not found',
          timestamp: new Date().toISOString()
        });
      }

      // 添加timestamp字段以保持前端兼容性
      if ((log as any).request_timestamp && !(log as any).timestamp) {
        (log as any).timestamp = (log as any).request_timestamp;
      }

      res.json({
        success: true,
        data: log,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to fetch traffic log detail', { error, id: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch traffic log detail',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 获取HTTP流量统计数据
  router.get('/traffic/stats', async (req, res) => {
    try {
      const timeRange = req.query.range || '24h'; // 24h, 7d, 30d
      const timeFilter = buildTimeCondition(timeRange, req.query.start_time, req.query.end_time);
      const stats = await getTrafficStats({
        startTime: timeFilter.startTime,
        endTime: timeFilter.endTime
      });

      res.json({
        success: true,
        data: {
          ...stats,
          time_range: timeRange
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to fetch traffic statistics', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch traffic statistics',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 获取API端点性能统计
  router.get('/traffic/endpoints', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const sortBy = req.query.sort || 'request_count'; // request_count, avg_duration, error_rate

      const endpointStats = await getTrafficEndpoints({
        limit,
        sortBy: sortBy as 'request_count' | 'avg_duration' | 'error_rate'
      });

      res.json({
        success: true,
        data: endpointStats,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to fetch endpoint statistics', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch endpoint statistics',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 搜索流量记录
  router.get('/traffic/search', async (req, res) => {
    try {
      const query = req.query.q as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      if (!query || query.length < 2) {
        return res.status(400).json({
          success: false,
          error: 'Search query must be at least 2 characters',
          timestamp: new Date().toISOString()
        });
      }

      const searchResults = await searchTrafficLogs({ query, limit });

      res.json({
        success: true,
        data: searchResults,
        query,
        count: searchResults.length,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to search traffic logs', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to search traffic logs',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 导出流量数据
  router.get('/traffic/export', async (req, res) => {
    try {
      const format = req.query.format || 'csv'; // csv, json
      const timeRange = req.query.range || '24h';
      const includeBody = req.query.include_body === 'true';
      const timeFilter = buildTimeCondition(timeRange, req.query.start_time, req.query.end_time);
      const exportData = await exportTrafficLogs({
        startTime: timeFilter.startTime,
        endTime: timeFilter.endTime,
        includeBody,
        limit: 1000
      });

      if (format === 'csv') {
        // 生成CSV格式
        const csvHeaders = includeBody
          ? 'ID,Trace ID,Method,URL,Status,Duration(ms),Timestamp,AI Request,API Type,Request Body,Response Body'
          : 'ID,Trace ID,Method,URL,Status,Duration(ms),Timestamp,AI Request,API Type';

        const csvRows = exportData.map((row: any) => {
          const values = [
            row.id,
            row.trace_id || '',
            row.method,
            `"${row.url}"`,
            row.response_status || '',
            row.duration_ms || '',
            row.request_timestamp,
            row.is_ai_request ? 'Yes' : 'No',
            row.api_type || ''
          ];

          if (includeBody) {
            values.push(`"${(row.request_body || '').replace(/"/g, '""')}"`, `"${(row.response_body || '').replace(/"/g, '""')}"`);
          }

          return values.join(',');
        });

        const csvContent = [csvHeaders, ...csvRows].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=http_traffic_${timeRange}_${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csvContent);
      } else {
        // JSON格式
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=http_traffic_${timeRange}_${new Date().toISOString().split('T')[0]}.json`);
        res.json({
          export_time: new Date().toISOString(),
          time_range: timeRange,
          include_body: includeBody,
          total_records: exportData.length,
          data: exportData
        });
      }

    } catch (error) {
      logger.error('Failed to export traffic data', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to export traffic data',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // ==================== 流量重放API ====================

  // 重放单个请求
  router.post('/traffic/replay/:id', async (req, res) => {
    try {
      const logId = parseInt(req.params.id);

      if (isNaN(logId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid log ID',
          timestamp: new Date().toISOString()
        });
      }

      const replayConfig = {
        originalLogId: logId,
        modifications: req.body.modifications,
        timeout: req.body.timeout,
        followRedirects: req.body.followRedirects !== false,
        validateSSL: req.body.validateSSL !== false
      };

      const result = await replayService.replayRequest(replayConfig);

      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to replay request', { error, logId: req.params.id });
      res.status(500).json({
        success: false,
        error: 'Failed to replay request',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 批量重放请求
  router.post('/traffic/replay/batch', async (req, res) => {
    try {
      const { logIds, modifications, concurrency, timeout } = req.body;

      if (!Array.isArray(logIds) || logIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid logIds array',
          timestamp: new Date().toISOString()
        });
      }

      // 限制批量数量
      if (logIds.length > 100) {
        return res.status(400).json({
          success: false,
          error: 'Maximum 100 requests allowed per batch',
          timestamp: new Date().toISOString()
        });
      }

      const result = await replayService.batchReplay(
        logIds,
        modifications,
        Math.min(concurrency || 5, 10)  // 最大并发10
      );

      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to batch replay requests', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to batch replay requests',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // 获取重放历史
  router.get('/traffic/replay/history/:originalId', async (req, res) => {
    try {
      const originalId = parseInt(req.params.originalId);

      if (isNaN(originalId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid original log ID',
          timestamp: new Date().toISOString()
        });
      }

      const history = await replayService.getReplayHistory(originalId);

      res.json({
        success: true,
        data: history,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Failed to get replay history', { error, originalId: req.params.originalId });
      res.status(500).json({
        success: false,
        error: 'Failed to get replay history',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
}

export default createTrafficMonitorRoutes;

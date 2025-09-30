import express from 'express';
import { DatabaseManager } from '../services/database';
import winston from 'winston';

/**
 * HTTP流量监控相关路由
 * 提供HTTP流量记录的查询、筛选和统计功能
 */
export function createTrafficMonitorRoutes(database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();

  // 获取HTTP流量记录列表
  router.get('/traffic/logs', async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = (page - 1) * limit;

      // 构建查询条件
      const filters = [];
      const params = [];

      if (req.query.method) {
        filters.push('method = ?');
        params.push(req.query.method);
      }

      if (req.query.host) {
        filters.push('host LIKE ?');
        params.push(`%${req.query.host}%`);
      }

      if (req.query.status) {
        filters.push('response_status = ?');
        params.push(req.query.status);
      }

      if (req.query.is_ai_request) {
        filters.push('is_ai_request = ?');
        params.push(req.query.is_ai_request === 'true' ? 1 : 0);
      }

      if (req.query.api_type) {
        filters.push('api_type = ?');
        params.push(req.query.api_type);
      }

      if (req.query.trace_id) {
        filters.push('trace_id = ?');
        params.push(req.query.trace_id);
      }

      if (req.query.start_time) {
        filters.push('request_timestamp >= ?');
        params.push(req.query.start_time);
      }

      if (req.query.end_time) {
        filters.push('request_timestamp <= ?');
        params.push(req.query.end_time);
      }

      if (req.query.search) {
        filters.push('(url LIKE ? OR request_body LIKE ? OR response_body LIKE ?)');
        const searchPattern = `%${req.query.search}%`;
        params.push(searchPattern, searchPattern, searchPattern);
      }

      const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

      // 查询流量记录 (不包含大字段内容，提高性能)
      const logs = await database.executeQuery<any>(
        `SELECT
          id, request_id, trace_id, container_name, service_name,
          method, url, host, path,
          response_status, duration_ms, request_timestamp,
          is_ai_request, api_type, api_version,
          client_ip, user_agent,
          request_size, response_size,
          error_message, retry_count, is_cached_response,
          conversation_id, user_id, session_id
         FROM http_traffic_logs
         ${whereClause}
         ORDER BY request_timestamp DESC
         LIMIT ${offset}, ${limit}`,
        params
      );

      // 获取总数
      const totalResult = await database.executeQuery<{ total: number }>(
        `SELECT COUNT(*) as total FROM http_traffic_logs ${whereClause}`,
        params
      );
      const total = totalResult[0]?.total || 0;

      res.json({
        success: true,
        data: logs,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
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

      const logs = await database.executeQuery<any>(
        `SELECT * FROM http_traffic_logs WHERE id = ?`,
        [id]
      );

      if (logs.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Traffic log not found',
          timestamp: new Date().toISOString()
        });
      }

      const log = logs[0];

      // 解析JSON字段
      try {
        if (log.request_headers) {
          log.request_headers = JSON.parse(log.request_headers);
        }
        if (log.response_headers) {
          log.response_headers = JSON.parse(log.response_headers);
        }
        if (log.query_params) {
          log.query_params = JSON.parse(log.query_params);
        }
      } catch (parseError) {
        logger.warn('Failed to parse JSON fields', { parseError, logId: id });
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

      let timeCondition = '';
      switch (timeRange) {
        case '1h':
          timeCondition = 'request_timestamp >= DATE_SUB(NOW(), INTERVAL 1 HOUR)';
          break;
        case '24h':
          timeCondition = 'request_timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)';
          break;
        case '7d':
          timeCondition = 'request_timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
          break;
        case '30d':
          timeCondition = 'request_timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
          break;
        default:
          timeCondition = 'request_timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)';
      }

      // 基础统计
      const overviewStats = await database.executeQuery<any>(
        `SELECT
          COUNT(*) as total_requests,
          COUNT(CASE WHEN is_ai_request = 1 THEN 1 END) as ai_requests,
          COUNT(CASE WHEN response_status >= 200 AND response_status < 300 THEN 1 END) as successful_requests,
          COUNT(CASE WHEN response_status >= 400 THEN 1 END) as failed_requests,
          AVG(duration_ms) as avg_response_time,
          MIN(duration_ms) as min_response_time,
          MAX(duration_ms) as max_response_time,
          SUM(request_size) as total_request_bytes,
          SUM(response_size) as total_response_bytes
         FROM http_traffic_logs
         WHERE ${timeCondition}`
      );

      // 按API类型统计
      const apiTypeStats = await database.executeQuery<any>(
        `SELECT
          api_type,
          COUNT(*) as request_count,
          AVG(duration_ms) as avg_duration,
          COUNT(CASE WHEN response_status >= 400 THEN 1 END) as error_count
         FROM http_traffic_logs
         WHERE ${timeCondition} AND is_ai_request = 1 AND api_type IS NOT NULL
         GROUP BY api_type
         ORDER BY request_count DESC`
      );

      // 按Host统计
      const hostStats = await database.executeQuery<any>(
        `SELECT
          host,
          COUNT(*) as request_count,
          AVG(duration_ms) as avg_duration,
          COUNT(CASE WHEN response_status >= 400 THEN 1 END) as error_count
         FROM http_traffic_logs
         WHERE ${timeCondition}
         GROUP BY host
         ORDER BY request_count DESC
         LIMIT 10`
      );

      // 按小时统计 (用于图表)
      const hourlyStats = await database.executeQuery<any>(
        `SELECT
          DATE_FORMAT(request_timestamp, '%Y-%m-%d %H:00:00') as hour,
          COUNT(*) as request_count,
          COUNT(CASE WHEN is_ai_request = 1 THEN 1 END) as ai_request_count,
          AVG(duration_ms) as avg_duration
         FROM http_traffic_logs
         WHERE ${timeCondition}
         GROUP BY DATE_FORMAT(request_timestamp, '%Y-%m-%d %H:00:00')
         ORDER BY hour ASC`
      );

      // 状态码分布
      const statusCodeStats = await database.executeQuery<any>(
        `SELECT
          CASE
            WHEN response_status BETWEEN 200 AND 299 THEN '2xx'
            WHEN response_status BETWEEN 300 AND 399 THEN '3xx'
            WHEN response_status BETWEEN 400 AND 499 THEN '4xx'
            WHEN response_status BETWEEN 500 AND 599 THEN '5xx'
            ELSE 'Other'
          END as status_group,
          COUNT(*) as count
         FROM http_traffic_logs
         WHERE ${timeCondition} AND response_status IS NOT NULL
         GROUP BY status_group
         ORDER BY count DESC`
      );

      res.json({
        success: true,
        data: {
          overview: overviewStats[0] || {},
          api_types: apiTypeStats,
          hosts: hostStats,
          hourly_distribution: hourlyStats,
          status_codes: statusCodeStats,
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

      let orderClause = '';
      switch (sortBy) {
        case 'avg_duration':
          orderClause = 'ORDER BY avg_duration DESC';
          break;
        case 'error_rate':
          orderClause = 'ORDER BY error_rate DESC';
          break;
        default:
          orderClause = 'ORDER BY request_count DESC';
      }

      const endpointStats = await database.executeQuery<any>(
        `SELECT
          host,
          SUBSTRING_INDEX(SUBSTRING_INDEX(path, '/', 3), '/', -1) as endpoint,
          method,
          COUNT(*) as request_count,
          AVG(duration_ms) as avg_duration,
          MIN(duration_ms) as min_duration,
          MAX(duration_ms) as max_duration,
          COUNT(CASE WHEN response_status >= 400 THEN 1 END) as error_count,
          COUNT(CASE WHEN response_status >= 400 THEN 1 END) * 100.0 / COUNT(*) as error_rate,
          MIN(request_timestamp) as first_seen,
          MAX(request_timestamp) as last_seen
         FROM http_traffic_logs
         WHERE request_timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
         GROUP BY host, endpoint, method
         HAVING request_count >= 2
         ${orderClause}
         LIMIT ${limit}`,
        []
      );

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

      // 全文搜索
      const searchResults = await database.executeQuery<any>(
        `SELECT
          id, request_id, trace_id, method, url, host,
          response_status, duration_ms, request_timestamp,
          is_ai_request, api_type,
          MATCH(url) AGAINST(? IN NATURAL LANGUAGE MODE) as url_relevance,
          MATCH(request_body, response_body) AGAINST(? IN NATURAL LANGUAGE MODE) as body_relevance
         FROM http_traffic_logs
         WHERE MATCH(url) AGAINST(? IN NATURAL LANGUAGE MODE)
            OR MATCH(request_body, response_body) AGAINST(? IN NATURAL LANGUAGE MODE)
            OR url LIKE ?
            OR host LIKE ?
         ORDER BY (url_relevance + body_relevance) DESC, request_timestamp DESC
         LIMIT ?`,
        [query, query, query, query, `%${query}%`, `%${query}%`, limit]
      );

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

      let timeCondition = '';
      switch (timeRange) {
        case '1h':
          timeCondition = 'request_timestamp >= DATE_SUB(NOW(), INTERVAL 1 HOUR)';
          break;
        case '24h':
          timeCondition = 'request_timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)';
          break;
        case '7d':
          timeCondition = 'request_timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
          break;
        default:
          timeCondition = 'request_timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)';
      }

      const fields = includeBody
        ? 'id, trace_id, method, url, response_status, duration_ms, request_timestamp, is_ai_request, api_type, request_body, response_body'
        : 'id, trace_id, method, url, response_status, duration_ms, request_timestamp, is_ai_request, api_type';

      const exportData = await database.executeQuery<any>(
        `SELECT ${fields} FROM http_traffic_logs WHERE ${timeCondition} ORDER BY request_timestamp DESC LIMIT 1000`
      );

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

  return router;
}

export default createTrafficMonitorRoutes;
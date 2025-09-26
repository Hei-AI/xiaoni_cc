import express from 'express';
import axios from 'axios';
import { logger } from '../utils/logger';

/**
 * 队列监控API路由
 * 作为管理后端的队列监控代理，转发请求到独立的队列监控服务
 */

const router = express.Router();
const moduleLogger = logger.createModuleLogger('queue-monitor-api');

// 队列监控服务地址
const QUEUE_MONITOR_URL = process.env.QUEUE_MONITOR_URL || 'http://localhost:3007';

/**
 * 创建代理请求函数
 */
const proxyRequest = async (req: express.Request, res: express.Response, endpoint: string) => {
  try {
    const url = `${QUEUE_MONITOR_URL}/api${endpoint}`;
    
    moduleLogger.info('Proxying queue monitor request', {
      originalUrl: req.originalUrl,
      proxyUrl: url,
      method: req.method
    });

    const response = await axios({
      method: req.method,
      url,
      data: req.body,
      params: req.query,
      timeout: 30000
    });

    res.status(response.status).json(response.data);
  } catch (error: any) {
    moduleLogger.error('Queue monitor proxy error', {
      endpoint,
      error: error.message,
      status: error.response?.status
    });

    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else if (error.code === 'ECONNREFUSED') {
      res.status(503).json({
        success: false,
        error: '队列监控服务不可用',
        details: '请确认队列监控服务已启动'
      });
    } else {
      res.status(500).json({
        success: false,
        error: '内部服务器错误',
        details: error.message
      });
    }
  }
};

/**
 * 获取所有队列状态
 * GET /api/queue-monitor/queues
 */
router.get('/queues', async (req, res) => {
  await proxyRequest(req, res, '/queues');
});

/**
 * 获取指定队列的未消费消息
 * GET /api/queue-monitor/queues/:queueName/unconsumed
 */
router.get('/queues/:queueName/unconsumed', async (req, res) => {
  const { queueName } = req.params;
  await proxyRequest(req, res, `/queues/${queueName}/unconsumed`);
});

/**
 * 获取队列详细信息
 * GET /api/queue-monitor/queues/:queueName
 */
router.get('/queues/:queueName', async (req, res) => {
  const { queueName } = req.params;
  await proxyRequest(req, res, `/queues/${queueName}`);
});

/**
 * 清空队列
 * DELETE /api/queue-monitor/queues/:queueName
 */
router.delete('/queues/:queueName', async (req, res) => {
  const { queueName } = req.params;
  
  moduleLogger.info('Queue clear requested', {
    queueName,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });
  
  await proxyRequest(req, res, `/queues/${queueName}`);
});

/**
 * 暂停/恢复队列
 * PATCH /api/queue-monitor/queues/:queueName/pause
 */
router.patch('/queues/:queueName/pause', async (req, res) => {
  const { queueName } = req.params;
  const { paused } = req.body;
  
  moduleLogger.info('Queue pause state change requested', {
    queueName,
    paused,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });
  
  await proxyRequest(req, res, `/queues/${queueName}/pause`);
});

/**
 * 获取队列统计信息
 * GET /api/queue-monitor/stats
 */
router.get('/stats', async (req, res) => {
  await proxyRequest(req, res, '/stats');
});

/**
 * 获取队列监控服务健康状态
 * GET /api/queue-monitor/health
 */
router.get('/health', async (req, res) => {
  try {
    const response = await axios.get(`${QUEUE_MONITOR_URL}/health`, {
      timeout: 5000
    });
    
    res.json({
      success: true,
      queueMonitorService: response.data,
      proxyStatus: 'healthy'
    });
  } catch (error: any) {
    moduleLogger.error('Queue monitor health check failed', { error: error.message });
    
    res.status(503).json({
      success: false,
      error: '队列监控服务健康检查失败',
      details: error.message,
      proxyStatus: 'unhealthy'
    });
  }
});

/**
 * 批量操作接口
 * POST /api/queue-monitor/batch-operations
 */
router.post('/batch-operations', async (req, res) => {
  const { operations } = req.body;
  
  if (!Array.isArray(operations)) {
    return res.status(400).json({
      success: false,
      error: '无效的批量操作请求'
    });
  }

  moduleLogger.info('Batch operations requested', {
    operationCount: operations.length,
    operations: operations.map(op => ({ queueName: op.queueName, action: op.action }))
  });

  const results = [];
  
  for (const operation of operations) {
    try {
      const { queueName, action } = operation;
      let endpoint = '';
      let method = 'PATCH';
      let data = null;

      switch (action) {
        case 'pause':
          endpoint = `/queues/${queueName}/pause`;
          data = { paused: true };
          break;
        case 'resume':
          endpoint = `/queues/${queueName}/pause`;
          data = { paused: false };
          break;
        case 'clear':
          endpoint = `/queues/${queueName}`;
          method = 'DELETE';
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      const response = await axios({
        method,
        url: `${QUEUE_MONITOR_URL}/api${endpoint}`,
        data,
        timeout: 30000
      });

      results.push({
        queueName,
        action,
        success: true,
        result: response.data
      });
    } catch (error: any) {
      results.push({
        queueName: operation.queueName,
        action: operation.action,
        success: false,
        error: error.message
      });
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failureCount = results.length - successCount;

  res.json({
    success: failureCount === 0,
    results,
    summary: {
      total: results.length,
      success: successCount,
      failure: failureCount
    }
  });
});

/**
 * 获取队列监控配置信息
 * GET /api/queue-monitor/config
 */
router.get('/config', (req, res) => {
  res.json({
    success: true,
    config: {
      queueMonitorUrl: QUEUE_MONITOR_URL,
      features: {
        realTimeUpdates: true,
        batchOperations: true,
        statisticsTracking: true,
        messageInspection: true
      },
      limits: {
        maxUnconsumedMessagesPerQuery: 1000,
        maxBatchOperations: 50
      }
    }
  });
});

export default router;
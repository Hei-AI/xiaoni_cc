import express from 'express';
import { logger } from '../utils/logger';

/**
 * 简单队列监控API
 * 直接连接到QQBot Core获取队列信息
 */

const router = express.Router();
const moduleLogger = logger.createModuleLogger('simple-queue-monitor');

// QQBot Core服务地址 (支持容器间通信)
const QQBOT_CORE_URL = process.env.QQBOT_CORE_URL || 'http://qqbot-core:8081';

/**
 * 代理到QQBot Core的队列API
 */
const proxyToQQBotCore = async (req: express.Request, res: express.Response, endpoint: string) => {
  try {
    const axios = require('axios');
    const url = `${QQBOT_CORE_URL}/api/queue${endpoint}`;
    
    moduleLogger.info('Proxying to QQBot Core', {
      originalUrl: req.originalUrl,
      proxyUrl: url,
      method: req.method
    });

    const response = await axios({
      method: req.method,
      url,
      data: req.method !== 'GET' ? req.body : undefined,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000
    });

    res.status(response.status).json(response.data);

  } catch (error: any) {
    moduleLogger.error('Queue monitor proxy error', {
      endpoint,
      error: error.message
    });

    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
      res.status(503).json({
        success: false,
        error: 'QQBot核心服务不可用',
        details: '请确认QQBot Core服务已启动并运行在端口8081',
        qqbotCoreUrl: QQBOT_CORE_URL
      });
    } else {
      res.status(500).json({
        success: false,
        error: '获取队列信息失败',
        details: error.message
      });
    }
  }
};

/**
 * 获取队列统计信息
 * GET /api/simple-queue/stats
 */
router.get('/stats', async (req, res) => {
  try {
    // 提供模拟队列统计数据，展示系统功能
    const stats = {
      totalPartitions: 8,
      activePartitions: 3,
      totalMessages: 156,
      processingPartitions: 3,
      config: {
        pollIntervalMs: 100,
        batchSize: 10,
        maxRetries: 3,
        maxPartitions: 1000
      },
      total_messages: 156,
      pending_messages: 12,
      processing_messages: 3,
      completed_messages: 141,
      failed_messages: 8,
      average_processing_time: 2340, // ms
      partition_count: 8,
      active_partitions: 3,
      last_updated: new Date().toISOString(),
      performance: {
        messages_per_second: 2.1,
        success_rate: 94.6,
        peak_queue_size: 25
      }
    };

    moduleLogger.info('Queue stats requested', { stats });

    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
      note: "Demo data - shows queue monitoring functionality"
    });
  } catch (error: any) {
    moduleLogger.error('Failed to get queue stats', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get queue statistics',
      details: error.message
    });
  }
});

/**
 * 获取活跃分区列表
 * GET /api/simple-queue/partitions
 */
router.get('/partitions', async (req, res) => {
  try {
    // 提供模拟分区数据，展示队列分区功能
    const partitions = [
      {
        partition_key: 'private_chat_85178516',
        type: 'private',
        user_id: 85178516,
        queue_size: 5,
        processing: 1,
        last_activity: new Date(Date.now() - 30000).toISOString(),
        status: 'active'
      },
      {
        partition_key: 'group_chat_1019235326',
        type: 'group',
        group_id: 1019235326,
        queue_size: 8,
        processing: 2,
        last_activity: new Date(Date.now() - 45000).toISOString(),
        status: 'active'
      },
      {
        partition_key: 'private_chat_999888',
        type: 'private',
        user_id: 999888,
        queue_size: 2,
        processing: 0,
        last_activity: new Date(Date.now() - 120000).toISOString(),
        status: 'idle'
      },
      {
        partition_key: 'system_maintenance',
        type: 'system',
        queue_size: 0,
        processing: 0,
        last_activity: new Date(Date.now() - 300000).toISOString(),
        status: 'idle'
      }
    ];

    moduleLogger.info('Active partitions requested', {
      count: partitions.length,
      active: partitions.filter(p => p.status === 'active').length
    });

    res.json({
      success: true,
      data: partitions,
      timestamp: new Date().toISOString(),
      note: "Demo data - shows partition monitoring functionality"
    });
  } catch (error: any) {
    moduleLogger.error('Failed to get partitions', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get active partitions',
      details: error.message
    });
  }
});

/**
 * 获取指定分区详情
 * GET /api/simple-queue/partitions/:partitionKey
 */
router.get('/partitions/:partitionKey', async (req, res) => {
  const { partitionKey } = req.params;
  await proxyToQQBotCore(req, res, `/partitions/${partitionKey}`);
});

/**
 * 清空指定分区
 * DELETE /api/simple-queue/partitions/:partitionKey
 */
router.delete('/partitions/:partitionKey', async (req, res) => {
  const { partitionKey } = req.params;
  
  moduleLogger.info('Partition clear requested', {
    partitionKey,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });
  
  await proxyToQQBotCore(req, res, `/partitions/${partitionKey}`);
});

/**
 * 模拟私聊消息
 * POST /api/simple-queue/simulate/private
 */
router.post('/simulate/private', async (req, res) => {
  const { user_id, message, priority } = req.body;

  if (!user_id || !message) {
    return res.status(400).json({
      success: false,
      error: '缺少必需参数：user_id, message'
    });
  }

  moduleLogger.info('Private message simulation requested', {
    user_id,
    message: message.substring(0, 50),
    priority,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });

  // 转发到 qqbot-core 真实处理
  await proxyToQQBotCore(req, res, '/simulate/private');
});

/**
 * 模拟群聊消息
 * POST /api/simple-queue/simulate/group
 */
router.post('/simulate/group', async (req, res) => {
  const { user_id, group_id, message, atBot, priority } = req.body;

  if (!user_id || !group_id || !message) {
    return res.status(400).json({
      success: false,
      error: '缺少必需参数：user_id, group_id, message'
    });
  }

  moduleLogger.info('Group message simulation requested', {
    user_id,
    group_id,
    message: message.substring(0, 50),
    atBot,
    priority,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });

  // 转发到 qqbot-core 真实处理
  await proxyToQQBotCore(req, res, '/simulate/group');
});

/**
 * 批量模拟消息
 * POST /api/simple-queue/simulate/batch
 */
router.post('/simulate/batch', async (req, res) => {
  const { messages } = req.body;
  
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      success: false,
      error: '无效的批量消息数据'
    });
  }

  if (messages.length > 50) {
    return res.status(400).json({
      success: false,
      error: '批量消息数量不能超过50条'
    });
  }

  moduleLogger.info('Batch message simulation requested', {
    messageCount: messages.length,
    types: messages.map(m => m.type),
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });

  await proxyToQQBotCore(req, res, '/simulate/batch');
});

/**
 * 获取队列配置信息
 * GET /api/simple-queue/config
 */
router.get('/config', (req, res) => {
  res.json({
    success: true,
    config: {
      queueType: 'simple-memory-queue',
      features: {
        partitioned: true,
        priority: true,
        batchProcessing: true,
        simulation: true,
        monitoring: true
      },
      limits: {
        maxPartitions: 1000,
        batchSize: 10,
        maxRetries: 3,
        maxSimulationBatch: 50
      },
      performance: {
        pollIntervalMs: 100,
        cleanupIntervalMs: 300000
      }
    }
  });
});

/**
 * 健康检查
 * GET /api/simple-queue/health
 */
router.get('/health', async (req, res) => {
  try {
    const axios = require('axios');
    const response = await axios.get(`${QQBOT_CORE_URL}/health`, {
      timeout: 5000
    });
    
    res.json({
      success: true,
      qqbotCore: response.data,
      simpleQueue: {
        status: 'healthy',
        type: 'memory-based',
        dependencies: 'none'
      }
    });
  } catch (error: any) {
    moduleLogger.error('Health check failed', { error: error.message });
    
    res.status(503).json({
      success: false,
      error: 'QQBot核心服务健康检查失败',
      details: error.message,
      simpleQueue: {
        status: 'healthy',
        type: 'memory-based',
        dependencies: 'none'
      }
    });
  }
});

export default router;
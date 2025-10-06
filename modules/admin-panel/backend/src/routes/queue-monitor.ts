import express from 'express';
import axios from 'axios';
import { logger } from '../utils/logger';

/**
 * 队列监控API路由
 * 直接从 qqbot-core simple queue 接口获取数据
 */

const router = express.Router();
const moduleLogger = logger.createModuleLogger('queue-monitor-api');

const QQBOT_CORE_URL = process.env.QQBOT_CORE_URL || 'http://qqbot-qqbot-core:8081';

const coreClient = axios.create({
  baseURL: QQBOT_CORE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }
});

interface SimpleQueuePartition {
  partition_key: string;
  type: 'private' | 'group';
  queue_size: number;
  last_activity: string | null;
  processing?: number;
  status?: string;
}

interface SimpleQueuePartitionSnapshot {
  partitionKey: string;
  type: 'user' | 'group';
  messageCount: number;
  lastProcessedAt: string | null;
  messages: Array<{
    id: string;
    traceId: string;
    type: string;
    priority?: string;
    timestamp: string;
    source?: string;
  }>;
}

interface QueueInfo {
  name: string;
  type: 'private' | 'group';
  userId?: number;
  groupId?: number;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
  lastJobAt?: string;
}

interface QueueStats {
  totalQueues: number;
  totalMessages: number;
  totalUnconsumed: number;
  lastUpdated: string;
}

const priorityMap: Record<string, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1
};

const fetchSimpleQueuePartitions = async (): Promise<SimpleQueuePartition[]> => {
  const { data } = await coreClient.get<{ success: boolean; data: SimpleQueuePartition[] }>('/api/simple-queue/partitions');

  if (!data.success) {
    throw new Error('Failed to load simple queue partitions');
  }

  return data.data || [];
};

const fetchSimpleQueueStats = async (): Promise<any> => {
  const { data } = await coreClient.get<{ success: boolean; data: any }>('/api/simple-queue/stats');

  if (!data.success) {
    throw new Error('Failed to load simple queue stats');
  }

  return data.data;
};

const fetchPartitionSnapshot = async (queueName: string): Promise<SimpleQueuePartitionSnapshot> => {
  const { data } = await coreClient.get<{ success: boolean; data: SimpleQueuePartitionSnapshot }>(
    `/api/simple-queue/partitions/${encodeURIComponent(queueName)}`
  );

  if (!data.success) {
    const error = new Error('Partition not found');
    (error as any).status = 404;
    throw error;
  }

  return data.data;
};

const extractIdentifiers = (partitionKey: string): { userId?: number; groupId?: number } => {
  const match = partitionKey.match(/(user|group)_(\d+)/);
  if (!match) return {};

  const value = Number.parseInt(match[2], 10);
  if (Number.isNaN(value)) return {};

  return match[1] === 'group' ? { groupId: value } : { userId: value };
};

const transformPartition = (partition: SimpleQueuePartition): QueueInfo => {
  const { userId, groupId } = extractIdentifiers(partition.partition_key);

  return {
    name: partition.partition_key,
    type: partition.type === 'group' ? 'group' : 'private',
    userId,
    groupId,
    waiting: partition.queue_size,
    active: partition.processing ?? 0,
    completed: 0,
    failed: 0,
    delayed: 0,
    paused: partition.status === 'paused',
    lastJobAt: partition.last_activity ?? undefined
  };
};

const computeStats = (queues: QueueInfo[], statsData?: any): QueueStats => {
  const totalQueues = statsData?.partition_count ?? queues.length;
  const totalMessages = statsData?.total_messages ?? queues.reduce((sum, queue) => sum + queue.waiting + queue.active, 0);
  const totalUnconsumed = queues.reduce((sum, queue) => sum + queue.waiting, 0);
  const lastUpdated = statsData?.last_updated ?? new Date().toISOString();

  return {
    totalQueues,
    totalMessages,
    totalUnconsumed,
    lastUpdated
  };
};

const transformSnapshotMessages = (
  queueName: string,
  snapshot: SimpleQueuePartitionSnapshot,
  limit: number
) => {
  return (snapshot.messages || [])
    .slice(0, Math.max(limit, 0))
    .map((message) => ({
      id: message.id,
      traceId: message.traceId,
      type: message.type,
      data: message,
      timestamp: message.timestamp,
      priority: priorityMap[message.priority || ''] ?? 0,
      attempts: 0,
      delay: 0,
      queueName,
      state: 'waiting' as const
    }));
};

/**
 * 获取所有队列状态
 * GET /api/queue-monitor/queues
 */
router.get('/queues', async (_req, res) => {
  try {
    const [partitions, statsData] = await Promise.all([
      fetchSimpleQueuePartitions(),
      fetchSimpleQueueStats().catch((error) => {
        moduleLogger.warn('Failed to load simple queue stats, fallback to computed values', {
          error: error instanceof Error ? error.message : error
        });
        return undefined;
      })
    ]);

    const queues = partitions.map(transformPartition);
    const stats = computeStats(queues, statsData);

    res.json({
      success: true,
      data: queues,
      stats
    });
  } catch (error: any) {
    moduleLogger.error('Failed to load queue list', {
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      error: 'Failed to load queue list',
      details: error.message
    });
  }
});

/**
 * 获取指定队列的未消费消息
 * GET /api/queue-monitor/queues/:queueName/unconsumed
 */
router.get('/queues/:queueName/unconsumed', async (req, res) => {
  const { queueName } = req.params;
  const limit = Number.parseInt((req.query.limit as string) || '100', 10);

  try {
    const snapshot = await fetchPartitionSnapshot(queueName);
    const messages = transformSnapshotMessages(queueName, snapshot, limit);

    res.json({
      success: true,
      data: messages,
      total: snapshot.messageCount
    });
  } catch (error: any) {
    if (error?.status === 404) {
      return res.status(404).json({ success: false, error: 'Queue not found' });
    }

    moduleLogger.error('Failed to load unconsumed messages', {
      queueName,
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      error: 'Failed to load unconsumed messages',
      details: error.message
    });
  }
});

/**
 * 获取队列详细信息
 * GET /api/queue-monitor/queues/:queueName
 */
router.get('/queues/:queueName', async (req, res) => {
  const { queueName } = req.params;

  try {
    const snapshot = await fetchPartitionSnapshot(queueName);
    const { userId, groupId } = extractIdentifiers(queueName);

    res.json({
      success: true,
      data: {
        name: queueName,
        type: snapshot.type === 'group' ? 'group' : 'private',
        userId,
        groupId,
        waiting: snapshot.messageCount,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: false,
        lastJobAt: snapshot.lastProcessedAt ?? undefined,
        messages: snapshot.messages || []
      }
    });
  } catch (error: any) {
    if (error?.status === 404) {
      return res.status(404).json({ success: false, error: 'Queue not found' });
    }

    moduleLogger.error('Failed to load queue detail', {
      queueName,
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      error: 'Failed to load queue detail',
      details: error.message
    });
  }
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

  try {
    await coreClient.delete(`/api/simple-queue/partitions/${encodeURIComponent(queueName)}`);

    res.json({
      success: true,
      message: 'Queue cleared successfully'
    });
  } catch (error: any) {
    moduleLogger.error('Failed to clear queue', {
      queueName,
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      error: 'Failed to clear queue',
      details: error.message
    });
  }
});

/**
 * 暂停/恢复队列
 * PATCH /api/queue-monitor/queues/:queueName/pause
 */
router.patch('/queues/:queueName/pause', (req, res) => {
  const { queueName } = req.params;
  const { paused } = req.body;

  moduleLogger.info('Queue pause/resume requested but unsupported in simple queue', {
    queueName,
    paused,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });

  res.status(501).json({
    success: false,
    error: 'Simple queue does not support pause/resume operations'
  });
});

/**
 * 获取队列统计信息
 * GET /api/queue-monitor/stats
 */
router.get('/stats', async (_req, res) => {
  try {
    const stats = await fetchSimpleQueueStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error: any) {
    moduleLogger.error('Failed to load simple queue stats', {
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      error: 'Failed to load stats',
      details: error.message
    });
  }
});

/**
 * 获取队列监控服务健康状态
 * GET /api/queue-monitor/health
 */
router.get('/health', async (_req, res) => {
  try {
    const [coreHealth, stats] = await Promise.all([
      coreClient
        .get('/health')
        .then((response) => response.data)
        .catch((error) => ({ success: false, error: error.message })),
      fetchSimpleQueueStats().catch((error) => ({ success: false, error: error.message }))
    ]);

    res.json({
      success: true,
      qqbotCore: coreHealth,
      simpleQueue: stats,
      proxyStatus: 'healthy'
    });
  } catch (error: any) {
    moduleLogger.error('Queue monitor health check failed', {
      error: error.message,
      stack: error.stack
    });

    res.status(503).json({
      success: false,
      error: 'Simple queue health check failed',
      details: error.message,
      proxyStatus: 'unhealthy'
    });
  }
});

/**
 * 批量操作接口
 * POST /api/queue-monitor/batch-operations
 */
router.post('/batch-operations', (req, res) => {
  const { operations } = req.body;

  moduleLogger.info('Batch operations requested but unsupported in simple queue', {
    operationCount: Array.isArray(operations) ? operations.length : 0,
    operations
  });

  res.status(501).json({
    success: false,
    error: 'Batch operations are not supported for simple queue'
  });
});

export default router;

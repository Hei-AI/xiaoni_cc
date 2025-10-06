import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import winston from 'winston';

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

class QueueMonitorService {
  private app: express.Application;
  private readonly logger: winston.Logger;
  private readonly coreUrl: string;

  constructor() {
    this.app = express();
    this.coreUrl = process.env.QQBOT_CORE_URL || 'http://qqbot-qqbot-core:8081';
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: '/app/logs/queue-monitor.log' })
      ]
    });

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(compression());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    this.app.use((req, _res, next) => {
      this.logger.debug('Request received', {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip
      });
      next();
    });
  }

  private setupRoutes(): void {
    this.app.get('/health', async (_req, res) => {
      try {
        const stats = await this.fetchSimpleQueueStats();
        res.json({
          success: true,
          simpleQueue: stats,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('Health check failed', { error: (error as Error).message });
        res.status(503).json({
          success: false,
          error: 'Simple queue service is unavailable',
          details: (error as Error).message
        });
      }
    });

    this.app.get('/api/queues', async (_req, res) => {
      try {
        const [partitions, statsData] = await Promise.all([
          this.fetchSimpleQueuePartitions(),
          this.fetchSimpleQueueStats().catch(() => undefined)
        ]);

        const queues = partitions.map((partition) => this.transformPartition(partition));
        const stats = this.computeStats(queues, statsData);

        res.json({
          success: true,
          data: queues,
          stats
        });
      } catch (error) {
        this.logger.error('Failed to list queues', { error: (error as Error).message });
        res.status(500).json({
          success: false,
          error: 'Failed to list queues',
          details: (error as Error).message
        });
      }
    });

    this.app.get('/api/queues/:queueName/unconsumed', async (req, res) => {
      const { queueName } = req.params;
      const limit = Number.parseInt((req.query.limit as string) || '20', 10);

      try {
        const snapshot = await this.fetchPartitionSnapshot(queueName);
        const messages = this.transformSnapshotMessages(queueName, snapshot, limit);

        res.json({
          success: true,
          data: messages,
          total: snapshot.messageCount
        });
      } catch (error: any) {
        if (error?.status === 404) {
          return res.status(404).json({ success: false, error: 'Queue not found' });
        }

        this.logger.error('Failed to load unconsumed messages', {
          queueName,
          error: (error as Error).message
        });

        res.status(500).json({
          success: false,
          error: 'Failed to load unconsumed messages',
          details: (error as Error).message
        });
      }
    });

    this.app.get('/api/queues/:queueName', async (req, res) => {
      const { queueName } = req.params;

      try {
        const snapshot = await this.fetchPartitionSnapshot(queueName);
        const queue = this.transformSnapshot(queueName, snapshot);

        res.json({
          success: true,
          data: queue
        });
      } catch (error: any) {
        if (error?.status === 404) {
          return res.status(404).json({ success: false, error: 'Queue not found' });
        }

        this.logger.error('Failed to load queue detail', {
          queueName,
          error: (error as Error).message
        });

        res.status(500).json({
          success: false,
          error: 'Failed to load queue detail',
          details: (error as Error).message
        });
      }
    });

    this.app.delete('/api/queues/:queueName', async (req, res) => {
      const { queueName } = req.params;

      try {
        await this.requestCore(`/api/simple-queue/partitions/${encodeURIComponent(queueName)}`, {
          method: 'DELETE'
        });

        res.json({
          success: true,
          message: 'Queue cleared successfully'
        });
      } catch (error: any) {
        this.logger.error('Failed to clear queue', {
          queueName,
          error: (error as Error).message
        });

        res.status(500).json({
          success: false,
          error: 'Failed to clear queue',
          details: (error as Error).message
        });
      }
    });

    this.app.patch('/api/queues/:queueName/pause', (_req, res) => {
      res.status(501).json({
        success: false,
        error: 'Simple queue does not support pause/resume operations'
      });
    });

    this.app.get('/api/stats', async (_req, res) => {
      try {
        const stats = await this.fetchSimpleQueueStats();
        res.json({ success: true, data: stats });
      } catch (error) {
        this.logger.error('Failed to load stats', { error: (error as Error).message });
        res.status(500).json({ success: false, error: 'Failed to load stats' });
      }
    });

    this.app.post('/api/batch-operations', (_req, res) => {
      res.status(501).json({
        success: false,
        error: 'Batch operations are not supported for simple queue'
      });
    });
  }

  private async fetchSimpleQueuePartitions(): Promise<SimpleQueuePartition[]> {
    const response = await this.requestCore<{ success: boolean; data: SimpleQueuePartition[] }>(
      '/api/simple-queue/partitions'
    );

    if (!response.success) {
      throw new Error('Failed to load partitions from qqbot-core');
    }

    return response.data || [];
  }

  private async fetchSimpleQueueStats(): Promise<any> {
    const response = await this.requestCore<{ success: boolean; data: any }>(
      '/api/simple-queue/stats'
    );

    if (!response.success) {
      throw new Error('Failed to load stats from qqbot-core');
    }

    return response.data;
  }

  private async fetchPartitionSnapshot(queueName: string): Promise<SimpleQueuePartitionSnapshot> {
    const response = await this.requestCore<{ success: boolean; data: SimpleQueuePartitionSnapshot }>(
      `/api/simple-queue/partitions/${encodeURIComponent(queueName)}`
    );

    if (!response.success) {
      const error = new Error('Partition not found');
      (error as any).status = 404;
      throw error;
    }

    return response.data;
  }

  private transformPartition(partition: SimpleQueuePartition): QueueInfo {
    const { userId, groupId } = this.extractIdentifiers(partition.partition_key);

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
  }

  private transformSnapshot(queueName: string, snapshot: SimpleQueuePartitionSnapshot) {
    const normalizedType = snapshot.type === 'group' ? 'group' : 'private';
    const { userId, groupId } = this.extractIdentifiers(queueName);

    return {
      name: queueName,
      type: normalizedType,
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
    };
  }

  private transformSnapshotMessages(
    queueName: string,
    snapshot: SimpleQueuePartitionSnapshot,
    limit: number
  ) {
    const priorityMap: Record<string, number> = {
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1
    };

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
  }

  private computeStats(queues: QueueInfo[], statsData?: any): QueueStats {
    const totalQueues = statsData?.partition_count ?? queues.length;
    const totalMessages =
      statsData?.total_messages ?? queues.reduce((sum, queue) => sum + queue.waiting + queue.active, 0);
    const totalUnconsumed = queues.reduce((sum, queue) => sum + queue.waiting, 0);
    const lastUpdated = statsData?.last_updated ?? new Date().toISOString();

    return {
      totalQueues,
      totalMessages,
      totalUnconsumed,
      lastUpdated
    };
  }

  private extractIdentifiers(partitionKey: string): { userId?: number; groupId?: number } {
    const match = partitionKey.match(/(user|group)_(\d+)/);
    if (!match) {
      return {};
    }

    const value = Number.parseInt(match[2], 10);
    if (Number.isNaN(value)) {
      return {};
    }

    if (match[1] === 'group') {
      return { groupId: value };
    }

    return { userId: value };
  }

  private async requestCore<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.coreUrl}${path}`;

    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init?.headers || {})
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const error = new Error(`Request to qqbot-core failed: ${response.status} ${response.statusText}`);
      (error as any).status = response.status;
      (error as any).body = errorBody;
      throw error;
    }

    return response.json() as Promise<T>;
  }

  public start(port: number = 3000): void {
    this.app.listen(port, () => {
      this.logger.info('Queue monitor service started', { port, coreUrl: this.coreUrl });
    });
  }
}

const service = new QueueMonitorService();
service.start(Number.parseInt(process.env.PORT || '3000', 10));

export default QueueMonitorService;

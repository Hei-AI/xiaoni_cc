import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import Redis from 'ioredis';
import Queue from 'bull';
import winston from 'winston';

/**
 * QQ Bot 队列监控服务
 * 功能：
 * 1. 实时监控所有队列状态
 * 2. 提供REST API查询未消费消息
 * 3. 队列性能统计和报警
 * 4. 与管理面板集成
 */

// 日志配置
const logger = winston.createLogger({
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

// Redis连接配置
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0'),
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: null
};

// 队列信息接口
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
  lastJobAt?: Date;
}

interface UnconsumedMessage {
  id: string;
  traceId: string;
  type: string;
  data: any;
  opts: any;
  timestamp: Date;
  priority: number;
  attempts: number;
  delay: number;
  queueName: string;
  state: 'waiting' | 'active' | 'delayed';
}

class QueueMonitorService {
  private app: express.Application;
  private redis: Redis;
  private queues = new Map<string, Queue.Queue>();
  private stats = {
    totalQueues: 0,
    totalMessages: 0,
    totalUnconsumed: 0,
    lastUpdated: new Date()
  };

  constructor() {
    this.app = express();
    this.redis = new Redis(redisConfig);
    this.setupMiddleware();
    this.setupRoutes();
    this.startMonitoring();
  }

  private setupMiddleware(): void {
    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(compression());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // 请求日志
    this.app.use((req, res, next) => {
      logger.info('Request received', {
        method: req.method,
        url: req.url,
        ip: req.ip
      });
      next();
    });
  }

  private setupRoutes(): void {
    // 健康检查
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date(),
        redis: this.redis.status,
        uptime: process.uptime()
      });
    });

    // 获取所有队列状态
    this.app.get('/api/queues', async (req, res) => {
      try {
        const queues = await this.getAllQueuesInfo();
        res.json({
          success: true,
          data: queues,
          stats: this.stats
        });
      } catch (error) {
        logger.error('Failed to get queues info', { error });
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    });

    // 获取未消费消息
    this.app.get('/api/queues/:queueName/unconsumed', async (req, res) => {
      try {
        const { queueName } = req.params;
        const limit = parseInt(req.query.limit as string) || 100;
        const offset = parseInt(req.query.offset as string) || 0;

        const messages = await this.getUnconsumedMessages(queueName, limit, offset);
        res.json({
          success: true,
          data: messages,
          total: messages.length
        });
      } catch (error) {
        logger.error('Failed to get unconsumed messages', { error, queueName: req.params.queueName });
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    });

    // 获取队列详细信息
    this.app.get('/api/queues/:queueName', async (req, res) => {
      try {
        const { queueName } = req.params;
        const queue = await this.getQueue(queueName);
        
        if (!queue) {
          return res.status(404).json({
            success: false,
            error: 'Queue not found'
          });
        }

        const info = await this.getQueueDetailInfo(queue);
        res.json({
          success: true,
          data: info
        });
      } catch (error) {
        logger.error('Failed to get queue info', { error, queueName: req.params.queueName });
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    });

    // 清空队列
    this.app.delete('/api/queues/:queueName', async (req, res) => {
      try {
        const { queueName } = req.params;
        const queue = await this.getQueue(queueName);
        
        if (!queue) {
          return res.status(404).json({
            success: false,
            error: 'Queue not found'
          });
        }

        await queue.empty();
        logger.info('Queue cleared', { queueName });
        
        res.json({
          success: true,
          message: 'Queue cleared successfully'
        });
      } catch (error) {
        logger.error('Failed to clear queue', { error, queueName: req.params.queueName });
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    });

    // 暂停/恢复队列
    this.app.patch('/api/queues/:queueName/pause', async (req, res) => {
      try {
        const { queueName } = req.params;
        const { paused } = req.body;
        const queue = await this.getQueue(queueName);
        
        if (!queue) {
          return res.status(404).json({
            success: false,
            error: 'Queue not found'
          });
        }

        if (paused) {
          await queue.pause();
        } else {
          await queue.resume();
        }

        logger.info('Queue pause state changed', { queueName, paused });
        
        res.json({
          success: true,
          message: `Queue ${paused ? 'paused' : 'resumed'} successfully`
        });
      } catch (error) {
        logger.error('Failed to change queue pause state', { error, queueName: req.params.queueName });
        res.status(500).json({
          success: false,
          error: 'Internal server error'
        });
      }
    });

    // 获取统计信息
    this.app.get('/api/stats', (req, res) => {
      res.json({
        success: true,
        data: this.stats
      });
    });
  }

  private async startMonitoring(): Promise<void> {
    const interval = parseInt(process.env.MONITOR_INTERVAL || '10000');
    
    setInterval(async () => {
      try {
        await this.updateStats();
      } catch (error) {
        logger.error('Failed to update stats', { error });
      }
    }, interval);

    logger.info('Queue monitoring started', { interval });
  }

  private async getAllQueuesInfo(): Promise<QueueInfo[]> {
    const queueNames = await this.getQueueNames();
    const queuesInfo: QueueInfo[] = [];

    for (const queueName of queueNames) {
      try {
        const queue = await this.getQueue(queueName);
        if (queue) {
          const info = await this.getQueueInfo(queue, queueName);
          queuesInfo.push(info);
        }
      } catch (error) {
        logger.warn('Failed to get queue info', { queueName, error });
      }
    }

    return queuesInfo;
  }

  private async getQueueNames(): Promise<string[]> {
    const keys = await this.redis.keys('bull:*');
    const queueNames = new Set<string>();

    for (const key of keys) {
      const parts = key.split(':');
      if (parts.length >= 2) {
        queueNames.add(parts[1]);
      }
    }

    return Array.from(queueNames);
  }

  private async getQueue(queueName: string): Promise<Queue.Queue | null> {
    if (!this.queues.has(queueName)) {
      try {
        const queue = new Queue(queueName, {
          redis: redisConfig
        });
        this.queues.set(queueName, queue);
      } catch (error) {
        logger.error('Failed to create queue instance', { queueName, error });
        return null;
      }
    }

    return this.queues.get(queueName) || null;
  }

  private async getQueueInfo(queue: Queue.Queue, queueName: string): Promise<QueueInfo> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed(),
      queue.getDelayed()
    ]);

    const isPaused = await queue.isPaused();
    
    // 解析队列名称获取类型和ID
    const { type, userId, groupId } = this.parseQueueName(queueName);
    
    // 获取最后一个任务的时间
    const recentJobs = await queue.getJobs(['completed', 'failed'], 0, 0);
    const lastJobAt = recentJobs.length > 0 ? new Date(recentJobs[0].timestamp) : undefined;

    return {
      name: queueName,
      type,
      userId,
      groupId,
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
      paused: isPaused,
      lastJobAt
    };
  }

  private async getQueueDetailInfo(queue: Queue.Queue): Promise<any> {
    const basicInfo = await this.getQueueInfo(queue, queue.name);
    
    // 获取最近的失败任务
    const failedJobs = await queue.getFailed(0, 9);
    const recentFailures = failedJobs.map(job => ({
      id: job.id,
      data: job.data,
      failedReason: job.failedReason,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn
    }));

    // 获取性能统计
    const stats = await this.getQueueStats(queue);

    return {
      ...basicInfo,
      recentFailures,
      stats
    };
  }

  private async getQueueStats(queue: Queue.Queue): Promise<any> {
    const completed = await queue.getCompleted(0, 99);
    
    if (completed.length === 0) {
      return {
        avgProcessingTime: 0,
        throughput: 0,
        errorRate: 0
      };
    }

    // 计算平均处理时间
    const processingTimes = completed
      .filter(job => job.processedOn && job.finishedOn)
      .map(job => job.finishedOn! - job.processedOn!);
    
    const avgProcessingTime = processingTimes.length > 0 
      ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length 
      : 0;

    // 计算吞吐量（最近1小时的完成任务数）
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentCompleted = completed.filter(job => 
      job.finishedOn && job.finishedOn > oneHourAgo
    );
    
    const throughput = recentCompleted.length;

    // 计算错误率
    const failed = await queue.getFailed(0, 99);
    const recentFailed = failed.filter(job => 
      job.finishedOn && job.finishedOn > oneHourAgo
    );
    
    const errorRate = (recentCompleted.length + recentFailed.length) > 0
      ? recentFailed.length / (recentCompleted.length + recentFailed.length)
      : 0;

    return {
      avgProcessingTime,
      throughput,
      errorRate: Math.round(errorRate * 100) / 100
    };
  }

  private async getUnconsumedMessages(queueName: string, limit: number, offset: number): Promise<UnconsumedMessage[]> {
    const queue = await this.getQueue(queueName);
    if (!queue) return [];

    const [waiting, active, delayed] = await Promise.all([
      queue.getWaiting(offset, offset + limit - 1),
      queue.getActive(0, -1),
      queue.getDelayed(0, -1)
    ]);

    const messages: UnconsumedMessage[] = [];

    // 处理等待中的消息
    for (const job of waiting) {
      messages.push({
        id: job.id?.toString() || '',
        traceId: job.data.traceId,
        type: job.data.type,
        data: job.data,
        opts: job.opts,
        timestamp: new Date(job.timestamp),
        priority: job.opts.priority || 0,
        attempts: job.attemptsMade,
        delay: job.opts.delay || 0,
        queueName,
        state: 'waiting'
      });
    }

    // 处理处理中的消息
    for (const job of active) {
      messages.push({
        id: job.id?.toString() || '',
        traceId: job.data.traceId,
        type: job.data.type,
        data: job.data,
        opts: job.opts,
        timestamp: new Date(job.timestamp),
        priority: job.opts.priority || 0,
        attempts: job.attemptsMade,
        delay: 0,
        queueName,
        state: 'active'
      });
    }

    // 处理延迟的消息
    for (const job of delayed) {
      messages.push({
        id: job.id?.toString() || '',
        traceId: job.data.traceId,
        type: job.data.type,
        data: job.data,
        opts: job.opts,
        timestamp: new Date(job.timestamp),
        priority: job.opts.priority || 0,
        attempts: job.attemptsMade,
        delay: job.opts.delay || 0,
        queueName,
        state: 'delayed'
      });
    }

    return messages.sort((a, b) => b.priority - a.priority);
  }

  private parseQueueName(queueName: string): { type: 'private' | 'group', userId?: number, groupId?: number } {
    if (queueName.startsWith('private_')) {
      return {
        type: 'private',
        userId: parseInt(queueName.replace('private_', ''))
      };
    } else if (queueName.startsWith('group_')) {
      return {
        type: 'group',
        groupId: parseInt(queueName.replace('group_', ''))
      };
    }
    
    return { type: 'private' };
  }

  private async updateStats(): Promise<void> {
    try {
      const queuesInfo = await this.getAllQueuesInfo();
      
      this.stats.totalQueues = queuesInfo.length;
      this.stats.totalMessages = queuesInfo.reduce((sum, queue) => 
        sum + queue.waiting + queue.active + queue.delayed, 0
      );
      this.stats.totalUnconsumed = queuesInfo.reduce((sum, queue) => 
        sum + queue.waiting + queue.delayed, 0
      );
      this.stats.lastUpdated = new Date();

      logger.debug('Stats updated', this.stats);
    } catch (error) {
      logger.error('Failed to update stats', { error });
    }
  }

  public start(port: number = 3000): void {
    this.app.listen(port, () => {
      logger.info(`Queue monitor service started on port ${port}`);
    });
  }
}

// 启动服务
const monitor = new QueueMonitorService();
monitor.start(parseInt(process.env.PORT || '3000'));

export default QueueMonitorService;
import Queue from 'bull';
import { QQMessage, QQNotice, QQRequest } from '../types';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * 队列消息数据接口
 */
export interface QueueMessageData {
  id: string;
  traceId: string;
  type: 'private_message' | 'group_message' | 'notice' | 'request';
  payload: QQMessage | QQNotice | QQRequest;
  source: 'websocket' | 'simulation' | 'api';
  timestamp: Date;
  partitionKey: string;
}

/**
 * 队列配置
 */
interface QueueConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };
  defaultJobOptions: {
    removeOnComplete: number;
    removeOnFail: number;
    attempts: number;
    backoff: string;
  };
  concurrency: {
    private: number;
    group: number;
  };
}

/**
 * Bull Queue管理器
 * 特点：
 * 1. 每个用户/群组一个独立队列
 * 2. 支持批量消费和优先级处理
 * 3. 基于Redis，支持分布式和持久化
 * 4. 内置重试和错误处理机制
 */
export class BullQueueManager {
  private privateQueues = new Map<number, Queue.Queue>(); // 用户ID -> 私聊队列
  private groupQueues = new Map<number, Queue.Queue>();   // 群组ID -> 群聊队列
  private moduleLogger = logger.createModuleLogger('bull-queue');
  
  private readonly config: QueueConfig = {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0')
    },
    defaultJobOptions: {
      removeOnComplete: 100,  // 保留最近100个成功任务
      removeOnFail: 50,       // 保留最近50个失败任务
      attempts: 3,            // 最多重试3次
      backoff: 'exponential'  // 指数退避
    },
    concurrency: {
      private: 5,  // 私聊队列并发数
      group: 3     // 群聊队列并发数
    }
  };

  constructor(customConfig?: Partial<QueueConfig>) {
    if (customConfig) {
      this.config = { ...this.config, ...customConfig };
    }
    this.moduleLogger.info('Bull Queue Manager initialized', { config: this.config });
  }

  /**
   * 推送私聊消息到队列
   */
  async pushPrivateMessage(
    userId: number, 
    message: QQMessage, 
    traceId: string,
    source: 'websocket' | 'simulation' | 'api' = 'websocket',
    priority: number = 0
  ): Promise<void> {
    const queue = this.getPrivateQueue(userId);
    
    const messageData: QueueMessageData = {
      id: uuidv4(),
      traceId,
      type: 'private_message',
      payload: message,
      source,
      timestamp: new Date(),
      partitionKey: `user_${userId}`
    };

    await queue.add('private_message', messageData, {
      priority,
      ...this.config.defaultJobOptions
    });

    this.moduleLogger.info('Private message queued', {
      userId,
      traceId,
      queueName: queue.name,
      priority,
      source
    });
  }

  /**
   * 推送群聊消息到队列
   */
  async pushGroupMessage(
    groupId: number,
    message: QQMessage,
    traceId: string,
    source: 'websocket' | 'simulation' | 'api' = 'websocket',
    priority: number = 0
  ): Promise<void> {
    const queue = this.getGroupQueue(groupId);
    
    const messageData: QueueMessageData = {
      id: uuidv4(),
      traceId,
      type: 'group_message',
      payload: message,
      source,
      timestamp: new Date(),
      partitionKey: `group_${groupId}`
    };

    await queue.add('group_message', messageData, {
      priority,
      ...this.config.defaultJobOptions
    });

    this.moduleLogger.info('Group message queued', {
      groupId,
      traceId,
      queueName: queue.name,
      priority,
      source
    });
  }

  /**
   * 获取私聊队列（懒加载）
   */
  private getPrivateQueue(userId: number): Queue.Queue {
    if (!this.privateQueues.has(userId)) {
      const queueName = `private_${userId}`;
      const queue = new Queue(queueName, {
        redis: this.config.redis,
        defaultJobOptions: this.config.defaultJobOptions
      });

      // 设置处理器 - 批量消费
      queue.process('private_message', this.config.concurrency.private, async (jobs) => {
        return this.processBatch(jobs, 'private');
      });

      this.privateQueues.set(userId, queue);
      this.moduleLogger.debug('Private queue created', { userId, queueName });
    }

    return this.privateQueues.get(userId)!;
  }

  /**
   * 获取群聊队列（懒加载）
   */
  private getGroupQueue(groupId: number): Queue.Queue {
    if (!this.groupQueues.has(groupId)) {
      const queueName = `group_${groupId}`;
      const queue = new Queue(queueName, {
        redis: this.config.redis,
        defaultJobOptions: this.config.defaultJobOptions
      });

      // 设置处理器 - 批量消费
      queue.process('group_message', this.config.concurrency.group, async (jobs) => {
        return this.processBatch(jobs, 'group');
      });

      this.groupQueues.set(groupId, queue);
      this.moduleLogger.debug('Group queue created', { groupId, queueName });
    }

    return this.groupQueues.get(groupId)!;
  }

  /**
   * 批量处理消息
   */
  private async processBatch(jobs: Queue.Job[], type: 'private' | 'group'): Promise<void> {
    const startTime = Date.now();
    const traceIds = jobs.map(job => job.data.traceId);
    
    this.moduleLogger.info('Processing message batch', {
      type,
      batchSize: jobs.length,
      traceIds
    });

    try {
      // 按优先级排序（Bull已经处理了，这里是确保）
      jobs.sort((a, b) => (b.opts.priority || 0) - (a.opts.priority || 0));

      // 逐条处理消息
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        const messageData: QueueMessageData = job.data;
        
        try {
          await this.processMessage(messageData, {
            batchSize: jobs.length,
            batchIndex: i,
            jobId: job.id
          });
          
          // 标记任务完成
          await job.progress(100);
          
        } catch (error) {
          this.moduleLogger.error('Message processing failed in batch', {
            traceId: messageData.traceId,
            type: messageData.type,
            jobId: job.id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          
          // Bull会自动处理重试
          throw error;
        }
      }

      const processingTime = Date.now() - startTime;
      this.moduleLogger.info('Batch processing completed', {
        type,
        batchSize: jobs.length,
        processingTimeMs: processingTime,
        avgTimePerMessage: processingTime / jobs.length
      });

    } catch (error) {
      this.moduleLogger.error('Batch processing failed', {
        type,
        batchSize: jobs.length,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * 处理单条消息（需要外部注入处理逻辑）
   */
  private async processMessage(
    messageData: QueueMessageData,
    context: { batchSize: number; batchIndex: number; jobId: any }
  ): Promise<void> {
    // 这里需要调用实际的消息处理逻辑
    // 通过事件发射器或回调函数的方式
    this.emit('message_process', messageData, context);
  }

  /**
   * 注册消息处理器
   */
  onMessageProcess(handler: (messageData: QueueMessageData, context: any) => Promise<void>): void {
    this.on('message_process', handler);
  }

  /**
   * 获取队列统计信息
   */
  async getStats() {
    const privateStats = await this.getQueuesStats(this.privateQueues);
    const groupStats = await this.getQueuesStats(this.groupQueues);

    return {
      private: {
        queueCount: this.privateQueues.size,
        ...privateStats
      },
      group: {
        queueCount: this.groupQueues.size,
        ...groupStats
      },
      redis: this.config.redis
    };
  }

  /**
   * 获取队列集合的统计信息
   */
  private async getQueuesStats(queues: Map<number, Queue.Queue>) {
    let totalWaiting = 0;
    let totalActive = 0;
    let totalCompleted = 0;
    let totalFailed = 0;

    for (const [_, queue] of queues) {
      const waiting = await queue.getWaiting();
      const active = await queue.getActive();
      const completed = await queue.getCompleted();
      const failed = await queue.getFailed();

      totalWaiting += waiting.length;
      totalActive += active.length;
      totalCompleted += completed.length;
      totalFailed += failed.length;
    }

    return {
      totalWaiting,
      totalActive,
      totalCompleted,
      totalFailed
    };
  }

  /**
   * 清理指定用户的私聊队列
   */
  async clearPrivateQueue(userId: number): Promise<number> {
    const queue = this.privateQueues.get(userId);
    if (!queue) return 0;

    const jobs = await queue.getJobs(['waiting', 'active']);
    for (const job of jobs) {
      await job.remove();
    }

    this.moduleLogger.info('Private queue cleared', { userId, clearedJobs: jobs.length });
    return jobs.length;
  }

  /**
   * 清理指定群组的群聊队列
   */
  async clearGroupQueue(groupId: number): Promise<number> {
    const queue = this.groupQueues.get(groupId);
    if (!queue) return 0;

    const jobs = await queue.getJobs(['waiting', 'active']);
    for (const job of jobs) {
      await job.remove();
    }

    this.moduleLogger.info('Group queue cleared', { groupId, clearedJobs: jobs.length });
    return jobs.length;
  }

  /**
   * 关闭所有队列
   */
  async close(): Promise<void> {
    const allQueues = [...this.privateQueues.values(), ...this.groupQueues.values()];
    
    await Promise.all(allQueues.map(queue => queue.close()));
    
    this.privateQueues.clear();
    this.groupQueues.clear();
    
    this.moduleLogger.info('All queues closed');
  }

  // 继承EventEmitter以支持事件
  private listeners = new Map<string, Function[]>();

  on(event: string, listener: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
  }

  emit(event: string, ...args: any[]): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach(listener => listener(...args));
    }
  }
}

/**
 * 消息模拟器 - Bull Queue版本
 */
export class BullMessageSimulator {
  constructor(private queueManager: BullQueueManager) {}

  async simulatePrivateMessage(testMessage: {
    user_id: number;
    message: string;
    priority?: number;
  }): Promise<string> {
    const traceId = `sim-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const qqMessage: QQMessage = {
      message_type: 'private',
      user_id: testMessage.user_id,
      message: testMessage.message,
      raw_message: testMessage.message,
      message_id: Date.now(),
      time: Math.floor(Date.now() / 1000),
      self_id: 1129974489,
      sender: {
        user_id: testMessage.user_id,
        nickname: `测试用户${testMessage.user_id}`,
        sex: 'unknown' as const
      },
      font: 14,
      sub_type: 'friend',
      post_type: 'message'
    };

    await this.queueManager.pushPrivateMessage(
      testMessage.user_id,
      qqMessage,
      traceId,
      'simulation',
      testMessage.priority || 10 // 测试消息高优先级
    );

    return traceId;
  }

  async simulateGroupMessage(testMessage: {
    user_id: number;
    group_id: number;
    message: string;
    atBot?: boolean;
    priority?: number;
  }): Promise<string> {
    const traceId = `sim-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    let message: any = testMessage.message;
    if (testMessage.atBot) {
      message = [
        { type: 'at', data: { qq: '1129974489' } },
        { type: 'text', data: { text: ` ${testMessage.message}` } }
      ];
    }

    const qqMessage: QQMessage = {
      message_type: 'group',
      user_id: testMessage.user_id,
      group_id: testMessage.group_id,
      message: message,
      raw_message: testMessage.message,
      message_id: Date.now(),
      time: Math.floor(Date.now() / 1000),
      self_id: 1129974489,
      sender: {
        user_id: testMessage.user_id,
        nickname: `测试用户${testMessage.user_id}`,
        card: `群名片${testMessage.user_id}`,
        sex: 'unknown' as const,
        role: 'member' as const
      },
      font: 14,
      sub_type: 'normal',
      post_type: 'message'
    };

    await this.queueManager.pushGroupMessage(
      testMessage.group_id,
      qqMessage,
      traceId,
      'simulation',
      testMessage.priority || 5
    );

    return traceId;
  }
}

export default BullQueueManager;
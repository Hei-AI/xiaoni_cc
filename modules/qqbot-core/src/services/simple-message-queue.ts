import { EventEmitter } from 'events';
import { QQMessage, QQNotice, QQRequest } from '../types';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * 简单队列消息接口
 */
export interface SimpleQueueMessage {
  id: string;
  traceId: string;
  type: 'private_message' | 'group_message' | 'notice' | 'request';
  payload: QQMessage | QQNotice | QQRequest;
  source: 'websocket' | 'simulation' | 'api';
  timestamp: Date;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  partitionKey: string;
  retryCount: number;
}

/**
 * 分区状态
 */
interface PartitionState {
  partitionKey: string;
  type: 'user' | 'group';
  messageCount: number;
  lastProcessedAt: Date | null;
  isProcessing: boolean;
}

/**
 * 简单分区消息队列
 * 特点：
 * 1. 纯内存实现，无外部依赖
 * 2. 按用户/群组分区
 * 3. 支持批量消费和优先级
 * 4. 简单的重试机制
 */
export class SimpleMessageQueue extends EventEmitter {
  private partitions = new Map<string, SimpleQueueMessage[]>();
  private partitionStates = new Map<string, PartitionState>();
  private moduleLogger = logger.createModuleLogger('simple-queue');
  private isRunning = false;
  private processingInterval: NodeJS.Timeout | null = null;

  // 配置
  private config = {
    pollIntervalMs: 100,           // 轮询间隔
    maxRetries: 3,                 // 最大重试次数
    batchSize: 10,                 // 批处理大小
    maxPartitions: 1000,           // 最大分区数
    cleanupIntervalMs: 5 * 60 * 1000, // 5分钟清理间隔
  };

  constructor() {
    super();
    this.startCleanupTimer();
  }

  /**
   * 推送消息到队列
   */
  async push(message: SimpleQueueMessage): Promise<void> {
    const { partitionKey } = message;

    // 检查分区数限制
    if (this.partitionStates.size >= this.config.maxPartitions) {
      this.moduleLogger.warn('Max partitions reached, cleaning up inactive ones');
      this.cleanupInactivePartitions();
    }

    // 初始化分区
    if (!this.partitions.has(partitionKey)) {
      this.partitions.set(partitionKey, []);
      this.partitionStates.set(partitionKey, {
        partitionKey,
        type: this.getPartitionType(partitionKey),
        messageCount: 0,
        lastProcessedAt: null,
        isProcessing: false
      });
    }

    // 添加消息到分区
    const partition = this.partitions.get(partitionKey)!;
    partition.push(message);

    // 按优先级排序
    partition.sort((a, b) => this.getPriorityWeight(b.priority) - this.getPriorityWeight(a.priority));

    // 更新分区状态
    const state = this.partitionStates.get(partitionKey)!;
    state.messageCount = partition.length;

    this.moduleLogger.debug('Message pushed to queue', {
      partitionKey,
      messageId: message.id,
      traceId: message.traceId,
      queueSize: partition.length,
      priority: message.priority
    });

    // 触发消息入队事件
    this.emit('message_queued', { partitionKey, message });
  }

  /**
   * 批量消费分区消息
   */
  async consumePartition(partitionKey: string): Promise<SimpleQueueMessage[]> {
    const partition = this.partitions.get(partitionKey);
    const state = this.partitionStates.get(partitionKey);

    if (!partition || !state || partition.length === 0 || state.isProcessing) {
      return [];
    }

    // 标记为处理中
    state.isProcessing = true;

    try {
      // 取出最多 batchSize 条消息
      const messages = partition.splice(0, this.config.batchSize);
      
      // 更新状态
      state.messageCount = partition.length;
      state.lastProcessedAt = new Date();

      this.moduleLogger.info('Partition consumed', {
        partitionKey,
        messageCount: messages.length,
        remainingCount: partition.length
      });

      return messages;
    } finally {
      state.isProcessing = false;
    }
  }

  /**
   * 获取所有活跃分区
   */
  getActivePartitions(): string[] {
    return Array.from(this.partitions.entries())
      .filter(([_, messages]) => messages.length > 0)
      .map(([partitionKey, _]) => partitionKey);
  }

  /**
   * 获取分区信息
   */
  getPartitionInfo(partitionKey: string) {
    const partition = this.partitions.get(partitionKey);
    const state = this.partitionStates.get(partitionKey);

    if (!partition || !state) return null;

    return {
      partitionKey,
      type: state.type,
      messageCount: partition.length,
      isProcessing: state.isProcessing,
      lastProcessedAt: state.lastProcessedAt,
      messages: partition.slice(0, 5) // 前5条消息预览
    };
  }

  /**
   * 获取所有分区统计
   */
  getStats() {
    const activePartitions = this.getActivePartitions();
    const totalMessages = Array.from(this.partitions.values())
      .reduce((sum, partition) => sum + partition.length, 0);

    return {
      totalPartitions: this.partitionStates.size,
      activePartitions: activePartitions.length,
      totalMessages,
      processingPartitions: Array.from(this.partitionStates.values())
        .filter(state => state.isProcessing).length,
      config: this.config
    };
  }

  /**
   * 清空指定分区
   */
  clearPartition(partitionKey: string): number {
    const partition = this.partitions.get(partitionKey);
    if (!partition) return 0;

    const clearedCount = partition.length;
    partition.splice(0);

    const state = this.partitionStates.get(partitionKey);
    if (state) {
      state.messageCount = 0;
    }

    this.moduleLogger.info('Partition cleared', { partitionKey, clearedCount });
    return clearedCount;
  }

  /**
   * 启动队列处理
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.processingInterval = setInterval(() => {
      this.processQueues();
    }, this.config.pollIntervalMs);

    this.moduleLogger.info('Simple message queue started');
  }

  /**
   * 停止队列处理
   */
  stop(): void {
    this.isRunning = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    this.moduleLogger.info('Simple message queue stopped');
  }

  /**
   * 生成分区键
   */
  static generatePartitionKey(message: QQMessage | QQNotice | QQRequest): string {
    const msg = message as any;
    
    if (msg.message_type === 'private' || (!msg.group_id && msg.user_id)) {
      return `user_${msg.user_id}`;
    } else if (msg.message_type === 'group' || msg.group_id) {
      return `group_${msg.group_id}`;
    } else {
      return `user_${msg.user_id || 'system'}`;
    }
  }

  /**
   * 处理所有队列
   */
  private async processQueues(): Promise<void> {
    if (!this.isRunning) return;

    const activePartitions = this.getActivePartitions();
    if (activePartitions.length === 0) return;

    // 随机处理一个分区，避免饥饿
    const randomPartition = activePartitions[Math.floor(Math.random() * activePartitions.length)];
    
    try {
      const messages = await this.consumePartition(randomPartition);
      if (messages.length > 0) {
        this.emit('batch_ready', { partitionKey: randomPartition, messages });
      }
    } catch (error) {
      this.moduleLogger.error('Error processing partition', {
        partitionKey: randomPartition,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 获取分区类型
   */
  private getPartitionType(partitionKey: string): 'user' | 'group' {
    return partitionKey.startsWith('user_') ? 'user' : 'group';
  }

  /**
   * 获取优先级权重
   */
  private getPriorityWeight(priority: string): number {
    switch (priority) {
      case 'HIGH': return 3;
      case 'MEDIUM': return 2;
      case 'LOW': return 1;
      default: return 0;
    }
  }

  /**
   * 清理定时器
   */
  private startCleanupTimer(): void {
    setInterval(() => {
      this.cleanupInactivePartitions();
    }, this.config.cleanupIntervalMs);
  }

  /**
   * 清理不活跃的分区
   */
  private cleanupInactivePartitions(): void {
    const now = new Date();
    const inactiveThreshold = 30 * 60 * 1000; // 30分钟
    let cleanedCount = 0;

    for (const [partitionKey, state] of this.partitionStates.entries()) {
      const partition = this.partitions.get(partitionKey);
      
      // 如果分区为空且长时间无活动
      if (!partition || (partition.length === 0 && !state.isProcessing)) {
        const lastActivity = state.lastProcessedAt || new Date(0);
        if (now.getTime() - lastActivity.getTime() > inactiveThreshold) {
          this.partitions.delete(partitionKey);
          this.partitionStates.delete(partitionKey);
          cleanedCount++;
        }
      }
    }

    if (cleanedCount > 0) {
      this.moduleLogger.info('Cleaned up inactive partitions', { 
        cleanedCount, 
        remainingPartitions: this.partitionStates.size 
      });
    }
  }
}

/**
 * 简单消息消费者
 */
export class SimpleMessageConsumer {
  private queue: SimpleMessageQueue;
  private messageHandler: (messages: SimpleQueueMessage[]) => Promise<void>;
  private moduleLogger = logger.createModuleLogger('simple-consumer');

  constructor(
    queue: SimpleMessageQueue,
    messageHandler: (messages: SimpleQueueMessage[]) => Promise<void>
  ) {
    this.queue = queue;
    this.messageHandler = messageHandler;
    this.setupEventHandlers();
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    this.queue.on('batch_ready', async ({ partitionKey, messages }) => {
      try {
        this.moduleLogger.info('Processing message batch', {
          partitionKey,
          messageCount: messages.length,
          traceIds: messages.map((m: SimpleQueueMessage) => m.traceId)
        });

        await this.messageHandler(messages);

        this.moduleLogger.info('Message batch processed successfully', {
          partitionKey,
          messageCount: messages.length
        });

      } catch (error) {
        this.moduleLogger.error('Failed to process message batch', {
          partitionKey,
          messageCount: messages.length,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        // 简单重试机制：将失败的消息重新入队（增加重试计数）
        for (const message of messages) {
          if (message.retryCount < 3) { // 最多重试3次
            message.retryCount++;
            message.priority = 'LOW'; // 降低优先级
            await this.queue.push(message);
          } else {
            this.moduleLogger.error('Message retry limit exceeded', {
              messageId: message.id,
              traceId: message.traceId,
              retryCount: message.retryCount
            });
          }
        }
      }
    });
  }

  /**
   * 启动消费者
   */
  start(): void {
    this.queue.start();
    this.moduleLogger.info('Simple message consumer started');
  }

  /**
   * 停止消费者
   */
  stop(): void {
    this.queue.stop();
    this.moduleLogger.info('Simple message consumer stopped');
  }
}

/**
 * 简单消息模拟器
 */
export class SimpleMessageSimulator {
  constructor(private queue: SimpleMessageQueue) {}

  /**
   * 模拟私聊消息
   */
  async simulatePrivateMessage(testMessage: {
    user_id: number;
    message: string;
    priority?: 'HIGH' | 'MEDIUM' | 'LOW';
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

    const queueMessage: SimpleQueueMessage = {
      id: uuidv4(),
      traceId,
      type: 'private_message',
      payload: qqMessage,
      source: 'simulation',
      timestamp: new Date(),
      priority: testMessage.priority || 'HIGH',
      partitionKey: SimpleMessageQueue.generatePartitionKey(qqMessage),
      retryCount: 0
    };

    await this.queue.push(queueMessage);
    return traceId;
  }

  /**
   * 模拟群聊消息
   */
  async simulateGroupMessage(testMessage: {
    user_id: number;
    group_id: number;
    message: string;
    atBot?: boolean;
    priority?: 'HIGH' | 'MEDIUM' | 'LOW';
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

    const queueMessage: SimpleQueueMessage = {
      id: uuidv4(),
      traceId,
      type: 'group_message',
      payload: qqMessage,
      source: 'simulation',
      timestamp: new Date(),
      priority: testMessage.priority || 'MEDIUM',
      partitionKey: SimpleMessageQueue.generatePartitionKey(qqMessage),
      retryCount: 0
    };

    await this.queue.push(queueMessage);
    return traceId;
  }
}

export default SimpleMessageQueue;
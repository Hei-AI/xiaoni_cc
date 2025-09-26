import { PartitionedMessageQueue, QueuedMessage } from './message-queue';
import { QQMessage, QQNotice, QQRequest } from '../types';
import { logger } from '../utils/logger';

/**
 * 消息处理器接口
 */
interface MessageHandler {
  handlePrivateMessage(message: QQMessage, context: MessageContext): Promise<void>;
  handleGroupMessage(message: QQMessage, context: MessageContext): Promise<void>;
  handleNotice(notice: QQNotice, context: MessageContext): Promise<void>;
  handleRequest(request: QQRequest, context: MessageContext): Promise<void>;
}

/**
 * 消息处理上下文
 */
interface MessageContext {
  traceId: string;
  source: 'websocket' | 'simulation' | 'api';
  queuedAt: Date;
  processedAt: Date;
  partitionKey: string;
  batchSize: number; // 本次批处理的消息数量
  batchIndex: number; // 在批次中的索引
}

/**
 * 消费者配置
 */
interface ConsumerConfig {
  pollIntervalMs: number; // 轮询间隔
  maxConcurrentPartitions: number; // 最大并发处理分区数
  enableBatchProcessing: boolean; // 是否启用批处理优化
  errorRetryCount: number; // 错误重试次数
}

/**
 * 分区消息消费者
 * 特点：
 * 1. 按分区批量消费消息
 * 2. 支持并发处理多个分区
 * 3. 用户/群组消息隔离处理
 * 4. 完整的错误处理和重试机制
 */
export class PartitionedMessageConsumer {
  private isRunning = false;
  private processingPartitions = new Set<string>(); // 正在处理的分区
  private moduleLogger = logger.createModuleLogger('message-consumer');
  
  // 消费统计
  private stats = {
    processedMessages: 0,
    processedPartitions: 0,
    errorCount: 0,
    avgProcessingTime: 0,
    lastProcessedAt: new Date()
  };

  private defaultConfig: ConsumerConfig = {
    pollIntervalMs: 50, // 50ms轮询
    maxConcurrentPartitions: 5, // 最多同时处理5个分区
    enableBatchProcessing: true,
    errorRetryCount: 3
  };

  constructor(
    private messageQueue: PartitionedMessageQueue,
    private messageHandler: MessageHandler,
    private config: Partial<ConsumerConfig> = {}
  ) {
    this.config = { ...this.defaultConfig, ...config };
    this.setupEventListeners();
  }

  /**
   * 启动消费者
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.moduleLogger.warn('Consumer already running');
      return;
    }

    this.isRunning = true;
    this.moduleLogger.info('Message consumer started', { config: this.config });
    
    // 启动主消费循环
    this.startConsumingLoop();
  }

  /**
   * 停止消费者
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    
    // 等待正在处理的分区完成
    while (this.processingPartitions.size > 0) {
      this.moduleLogger.info('Waiting for partitions to finish processing', {
        remaining: Array.from(this.processingPartitions)
      });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    this.moduleLogger.info('Message consumer stopped');
  }

  /**
   * 获取消费者状态
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      processingPartitions: Array.from(this.processingPartitions),
      stats: this.stats,
      queueStats: this.messageQueue.getStats()
    };
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 监听新消息入队事件，立即处理该分区
    this.messageQueue.on('message_queued', async ({ partitionKey }) => {
      if (this.isRunning && !this.processingPartitions.has(partitionKey)) {
        // 异步处理，不阻塞主流程
        setImmediate(() => this.processPartition(partitionKey));
      }
    });
  }

  /**
   * 主消费循环
   */
  private async startConsumingLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.consumeAllActivePartitions();
        await this.sleep(this.config.pollIntervalMs!);
      } catch (error) {
        this.moduleLogger.error('Error in consuming loop', { error });
        this.stats.errorCount++;
        await this.sleep(1000); // 发生错误时延长间隔
      }
    }
  }

  /**
   * 消费所有活跃分区
   */
  private async consumeAllActivePartitions(): Promise<void> {
    const activePartitions = this.messageQueue.getActivePartitions();
    
    if (activePartitions.length === 0) {
      return; // 没有活跃分区
    }

    // 过滤掉正在处理的分区
    const availablePartitions = activePartitions.filter(
      partition => !this.processingPartitions.has(partition)
    );

    if (availablePartitions.length === 0) {
      return; // 所有分区都在处理中
    }

    // 限制并发处理的分区数量
    const partitionsToProcess = availablePartitions.slice(0, 
      this.config.maxConcurrentPartitions! - this.processingPartitions.size
    );

    // 并发处理分区
    const processingPromises = partitionsToProcess.map(partitionKey => 
      this.processPartition(partitionKey)
    );

    await Promise.allSettled(processingPromises);
  }

  /**
   * 处理单个分区的所有消息
   */
  private async processPartition(partitionKey: string): Promise<void> {
    if (this.processingPartitions.has(partitionKey)) {
      return; // 分区已在处理中
    }

    this.processingPartitions.add(partitionKey);
    const startTime = Date.now();

    try {
      // 批量获取该分区的所有消息
      const messages = await this.messageQueue.consumePartition(partitionKey);
      
      if (messages.length === 0) {
        return; // 分区无消息
      }

      this.moduleLogger.info('Processing partition batch', {
        partitionKey,
        messageCount: messages.length,
        traceIds: messages.map(m => m.traceId)
      });

      // 按消息类型分组批处理
      if (this.config.enableBatchProcessing) {
        await this.processBatchByType(messages);
      } else {
        // 逐条处理
        await this.processMessagesSequentially(messages);
      }

      // 更新统计
      this.stats.processedMessages += messages.length;
      this.stats.processedPartitions++;
      this.stats.lastProcessedAt = new Date();
      
      const processingTime = Date.now() - startTime;
      this.stats.avgProcessingTime = 
        (this.stats.avgProcessingTime * (this.stats.processedPartitions - 1) + processingTime) / 
        this.stats.processedPartitions;

      this.moduleLogger.info('Partition processing completed', {
        partitionKey,
        messageCount: messages.length,
        processingTimeMs: processingTime
      });

    } catch (error) {
      this.moduleLogger.error('Error processing partition', { 
        partitionKey, 
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      this.stats.errorCount++;
    } finally {
      this.processingPartitions.delete(partitionKey);
    }
  }

  /**
   * 按消息类型分组批处理
   */
  private async processBatchByType(messages: QueuedMessage[]): Promise<void> {
    // 按消息类型分组
    const messagesByType = messages.reduce((groups, message) => {
      if (!groups[message.type]) {
        groups[message.type] = [];
      }
      groups[message.type].push(message);
      return groups;
    }, {} as Record<string, QueuedMessage[]>);

    // 按类型顺序处理（保证处理顺序）
    const typeOrder = ['private_message', 'group_message', 'notice', 'request'];
    
    for (const type of typeOrder) {
      const typeMessages = messagesByType[type];
      if (!typeMessages || typeMessages.length === 0) continue;

      await this.processMessagesOfType(type, typeMessages);
    }
  }

  /**
   * 处理同类型的一批消息
   */
  private async processMessagesOfType(type: string, messages: QueuedMessage[]): Promise<void> {
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const context: MessageContext = {
        traceId: message.traceId,
        source: message.source,
        queuedAt: message.timestamp,
        processedAt: new Date(),
        partitionKey: message.partitionKey,
        batchSize: messages.length,
        batchIndex: i
      };

      await this.processMessage(message, context);
    }
  }

  /**
   * 顺序处理消息（不分组）
   */
  private async processMessagesSequentially(messages: QueuedMessage[]): Promise<void> {
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const context: MessageContext = {
        traceId: message.traceId,
        source: message.source,
        queuedAt: message.timestamp,
        processedAt: new Date(),
        partitionKey: message.partitionKey,
        batchSize: messages.length,
        batchIndex: i
      };

      await this.processMessage(message, context);
    }
  }

  /**
   * 处理单条消息
   */
  private async processMessage(queuedMessage: QueuedMessage, context: MessageContext): Promise<void> {
    const { type, payload } = queuedMessage;
    let retryCount = 0;

    while (retryCount <= this.config.errorRetryCount!) {
      try {
        switch (type) {
          case 'private_message':
            await this.messageHandler.handlePrivateMessage(payload as QQMessage, context);
            break;
          case 'group_message':
            await this.messageHandler.handleGroupMessage(payload as QQMessage, context);
            break;
          case 'notice':
            await this.messageHandler.handleNotice(payload as QQNotice, context);
            break;
          case 'request':
            await this.messageHandler.handleRequest(payload as QQRequest, context);
            break;
          default:
            this.moduleLogger.warn('Unknown message type', { type, messageId: queuedMessage.id });
        }
        
        // 处理成功，跳出重试循环
        break;
        
      } catch (error) {
        retryCount++;
        this.stats.errorCount++;
        
        this.moduleLogger.error('Message processing failed', { 
          messageId: queuedMessage.id,
          traceId: queuedMessage.traceId,
          type,
          retryCount,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        if (retryCount <= this.config.errorRetryCount!) {
          // 指数退避重试
          await this.sleep(Math.pow(2, retryCount) * 100);
        } else {
          this.moduleLogger.error('Message processing failed after all retries', {
            messageId: queuedMessage.id,
            traceId: queuedMessage.traceId,
            maxRetries: this.config.errorRetryCount
          });
          break;
        }
      }
    }
  }

  /**
   * 辅助方法：休眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export { MessageHandler, MessageContext, ConsumerConfig };
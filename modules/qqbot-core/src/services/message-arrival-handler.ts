/**
 * 🧠 消息到达处理器 - 事件分离架构核心组件
 * 职责: 处理消息到达事件，仅存储不处理，实现消息到达与消费的完全分离
 */

import { v4 as uuidv4 } from 'uuid';
import {
  QQMessage,
  QueuedMessage,
  MessageArrivalEvent,
  MessageAggregationConfig
} from '../types';
import { DatabaseManager } from './database';
import { LoggingService } from './logging-service';
import { MessageAggregationManager } from './message-aggregation-manager';
import { logger } from '../utils/logger';

export class MessageArrivalHandler {
  private database: DatabaseManager;
  private loggingService: LoggingService;
  private messageQueue = new Map<string, QueuedMessage[]>(); // sourceKey -> messages
  private aggregationManager: MessageAggregationManager;
  private moduleLogger = logger.createModuleLogger('message-arrival-handler');
  private config: MessageAggregationConfig;

  // 统计信息
  private stats = {
    totalMessagesReceived: 0,
    totalQueuesActive: 0,
    lastMessageTime: new Date()
  };

  constructor(
    database: DatabaseManager,
    loggingService: LoggingService,
    aggregationManager: MessageAggregationManager,
    config: MessageAggregationConfig
  ) {
    this.database = database;
    this.loggingService = loggingService;
    this.aggregationManager = aggregationManager;
    this.config = config;

    this.moduleLogger.info('MessageArrivalHandler initialized', {
      aggregationWindowMs: config.aggregationWindowMs,
      maxQueueSize: config.maxQueueSize
    });
  }

  /**
   * 处理消息到达 - 核心方法，仅存储不触发处理
   */
  async handleMessageArrival(message: QQMessage, eventData?: any): Promise<void> {
    const startTime = Date.now();
    const traceId = eventData?.traceId || uuidv4();
    const sourceKey = this.generateSourceKey(message);
    const messageId = uuidv4();

    try {
      this.moduleLogger.info('Message arrival detected', {
        traceId,
        sourceKey,
        messageId,
        messageType: message.message_type,
        userId: message.user_id,
        groupId: message.group_id
      });

      // 1. 记录消息到达事件
      await this.loggingService.logInstantEvent(
        traceId,
        'message_arrival',
        'message_stored',
        sourceKey,
        {
          message_id: messageId,
          user_id: message.user_id,
          group_id: message.group_id,
          message_type: message.message_type,
          storage_timestamp: new Date(),
          queue_size_before: this.getQueueSize(sourceKey)
        }
      );

      // 2. 创建队列消息对象
      const queuedMessage: QueuedMessage = {
        id: messageId,
        message,
        eventData: {
          ...eventData,
          originalTraceId: traceId
        },
        arrivalTime: new Date(),
        sourceKey,
        traceId,
        status: 'queued'
      };

      // 3. 存储到内存队列
      if (!this.messageQueue.has(sourceKey)) {
        this.messageQueue.set(sourceKey, []);
        this.stats.totalQueuesActive++;
      }

      const queue = this.messageQueue.get(sourceKey)!;
      queue.push(queuedMessage);

      // 4. 队列大小管理 (LRU策略)
      if (queue.length > this.config.maxQueueSize) {
        const removedMessage = queue.shift();
        this.moduleLogger.warn('Queue size limit exceeded, removing oldest message', {
          sourceKey,
          removedMessageId: removedMessage?.id,
          queueSize: queue.length
        });
      }

      // 5. 可选: 持久化到数据库 (用于系统重启恢复)
      await this.persistMessageArrival(queuedMessage);

      // 6. 通知聚合管理器
      await this.aggregationManager.onMessageArrival(sourceKey, queuedMessage);

      // 7. 更新统计信息
      this.updateStats();

      const processingTime = Date.now() - startTime;
      this.moduleLogger.debug('Message arrival processing completed', {
        traceId,
        sourceKey,
        messageId,
        processingTime,
        queueSize: queue.length
      });

      // 消息到达处理完毕，不触发任何业务逻辑处理

    } catch (error) {
      this.moduleLogger.error('Failed to handle message arrival', {
        traceId,
        sourceKey,
        messageId,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime: Date.now() - startTime
      });

      // 记录错误事件
      await this.loggingService.logInstantEvent(
        traceId,
        'message_arrival',
        'message_storage_failed',
        sourceKey,
        {
          message_id: messageId,
          error_message: error instanceof Error ? error.message : 'Unknown error'
        }
      );

      throw error;
    }
  }

  /**
   * 生成源标识符 (sourceKey)
   */
  private generateSourceKey(message: QQMessage): string {
    if (message.message_type === 'private') {
      return `user_${message.user_id}`;
    } else if (message.message_type === 'group') {
      return `group_${message.group_id}`;
    }
    return `unknown_${message.user_id}`;
  }

  /**
   * 获取指定源的队列大小
   */
  private getQueueSize(sourceKey: string): number {
    return this.messageQueue.get(sourceKey)?.length || 0;
  }

  /**
   * 持久化消息到达记录到数据库
   */
  private async persistMessageArrival(queuedMessage: QueuedMessage): Promise<void> {
    try {
      await this.database.executeQuery(
        `INSERT INTO message_arrivals (
          id, source_key, user_id, group_id, message_type,
          raw_message, event_data, arrival_timestamp, trace_id, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          queuedMessage.id,
          queuedMessage.sourceKey,
          queuedMessage.message.user_id,
          queuedMessage.message.group_id || null,
          queuedMessage.message.message_type,
          JSON.stringify(queuedMessage.message),
          JSON.stringify(queuedMessage.eventData),
          queuedMessage.arrivalTime,
          queuedMessage.traceId,
          queuedMessage.status
        ]
      );
    } catch (error) {
      this.moduleLogger.warn('Failed to persist message arrival to database', {
        messageId: queuedMessage.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // 不抛出错误，继续处理流程
    }
  }

  /**
   * 更新统计信息
   */
  private updateStats(): void {
    this.stats.totalMessagesReceived++;
    this.stats.lastMessageTime = new Date();
    this.stats.totalQueuesActive = this.messageQueue.size;
  }

  /**
   * 获取指定源的消息队列
   */
  public getSourceQueue(sourceKey: string): QueuedMessage[] {
    return this.messageQueue.get(sourceKey) || [];
  }

  /**
   * 清空指定源的消息队列
   */
  public clearSourceQueue(sourceKey: string): QueuedMessage[] {
    const queue = this.messageQueue.get(sourceKey) || [];
    this.messageQueue.delete(sourceKey);

    this.moduleLogger.debug('Source queue cleared', {
      sourceKey,
      clearedMessages: queue.length
    });

    return queue;
  }

  /**
   * 获取所有活跃的源标识符
   */
  public getActiveSources(): string[] {
    return Array.from(this.messageQueue.keys());
  }

  /**
   * 获取统计信息
   */
  public getStats() {
    return {
      ...this.stats,
      activeQueues: this.messageQueue.size,
      totalQueuedMessages: Array.from(this.messageQueue.values())
        .reduce((total, queue) => total + queue.length, 0)
    };
  }

  /**
   * 优雅关闭 - 清理资源
   */
  public async shutdown(): Promise<void> {
    this.moduleLogger.info('MessageArrivalHandler shutting down', {
      activeQueues: this.messageQueue.size,
      totalQueuedMessages: this.getStats().totalQueuedMessages
    });

    // 清理所有队列
    this.messageQueue.clear();
    this.stats.totalQueuesActive = 0;

    this.moduleLogger.info('MessageArrivalHandler shutdown completed');
  }
}
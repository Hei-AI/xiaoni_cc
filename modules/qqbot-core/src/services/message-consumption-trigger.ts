/**
 * 🧠 消息消费触发器 - 事件分离与现有系统桥接组件
 * 职责: 触发消息消费，调用原有处理流程，实现新旧系统的无缝集成
 */

import { v4 as uuidv4 } from 'uuid';
import {
  QQMessage,
  QueuedMessage,
  ConsumptionTriggerReason,
  MessageConsumptionEvent,
  OriginalMessageHandlers
} from '../types';
import { DatabaseManager } from './database';
import { LoggingService } from './logging-service';
import { logger } from '../utils/logger';

export class MessageConsumptionTrigger {
  private originalHandlers: OriginalMessageHandlers;
  private database: DatabaseManager;
  private loggingService: LoggingService;
  private moduleLogger = logger.createModuleLogger('message-consumption-trigger');

  // 统计信息
  private stats = {
    totalBatchesProcessed: 0,
    totalMessagesConsumed: 0,
    totalProcessingTime: 0,
    successfulBatches: 0,
    failedBatches: 0
  };

  constructor(
    originalHandlers: OriginalMessageHandlers,
    database: DatabaseManager,
    loggingService: LoggingService
  ) {
    this.originalHandlers = originalHandlers;
    this.database = database;
    this.loggingService = loggingService;

    this.moduleLogger.info('MessageConsumptionTrigger initialized');
  }

  /**
   * 触发消息消费 - 核心方法，调用原有处理流程
   */
  async triggerConsumption(
    sourceKey: string,
    messages: QueuedMessage[],
    triggerReason: ConsumptionTriggerReason
  ): Promise<void> {
    if (messages.length === 0) {
      this.moduleLogger.debug('No messages to consume', { sourceKey, triggerReason });
      return;
    }

    const batchId = uuidv4();
    const primaryMessage = messages[0]; // 主消息用于触发处理
    const traceId = primaryMessage.traceId;
    const startTime = Date.now();

    this.moduleLogger.info('Starting message consumption', {
      batchId,
      sourceKey,
      batchSize: messages.length,
      triggerReason,
      traceId,
      messageIds: messages.map(m => m.id).slice(0, 3) // 只显示前3个ID
    });

    try {
      // 1. 记录消费开始事件
      const consumptionEvent: MessageConsumptionEvent = {
        batchId,
        sourceKey,
        messageIds: messages.map(m => m.id),
        batchSize: messages.length,
        triggerReason,
        consumptionTime: new Date(),
        traceId,
        status: 'started'
      };

      await this.logConsumptionEvent(consumptionEvent);

      await this.loggingService.logEventStart(
        traceId,
        'message_consumption',
        'batch_processing_start',
        sourceKey,
        {
          batch_id: batchId,
          batch_size: messages.length,
          trigger_reason: triggerReason,
          first_message_time: primaryMessage.arrivalTime,
          consumption_time: new Date()
        }
      );

      // 2. 构建聚合上下文
      await this.buildAggregatedContext(messages);

      // 3. 更新消息状态为消费中
      await this.updateMessagesStatus(messages, 'consumed');

      // 4. 使用主消息调用原有处理流程
      await this.invokeOriginalHandler(primaryMessage, messages, triggerReason);

      // 5. 记录消费成功
      const processingDuration = Date.now() - startTime;
      consumptionEvent.status = 'completed';
      consumptionEvent.processingDuration = processingDuration;

      await this.logConsumptionEvent(consumptionEvent);

      await this.loggingService.logInstantEvent(
        traceId,
        'message_consumption',
        'batch_processing_completed',
        sourceKey,
        {
          batch_id: batchId,
          processed_count: messages.length,
          processing_duration: processingDuration,
          success: true
        }
      );

      // 6. 更新统计信息
      this.updateStats(messages.length, processingDuration, true);

      this.moduleLogger.info('Message consumption completed successfully', {
        batchId,
        sourceKey,
        batchSize: messages.length,
        processingDuration,
        triggerReason
      });

    } catch (error) {
      const processingDuration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.moduleLogger.error('Message consumption failed', {
        batchId,
        sourceKey,
        batchSize: messages.length,
        triggerReason,
        error: errorMessage,
        processingDuration
      });

      // 记录消费失败
      const failedEvent: MessageConsumptionEvent = {
        batchId,
        sourceKey,
        messageIds: messages.map(m => m.id),
        batchSize: messages.length,
        triggerReason,
        consumptionTime: new Date(),
        processingDuration,
        traceId,
        status: 'failed',
        errorMessage
      };

      await this.logConsumptionEvent(failedEvent);

      await this.loggingService.logInstantEvent(
        traceId,
        'message_consumption',
        'batch_processing_failed',
        sourceKey,
        {
          batch_id: batchId,
          error: errorMessage,
          batch_size: messages.length,
          processing_duration: processingDuration
        }
      );

      // 更新统计信息
      this.updateStats(messages.length, processingDuration, false);

      throw error;
    }
  }

  /**
   * 构建聚合上下文 - 在消费时才拉取完整上下文
   */
  private async buildAggregatedContext(messages: QueuedMessage[]): Promise<void> {
    const primaryMessage = messages[0];

    this.moduleLogger.debug('Building aggregated context', {
      primaryMessageId: primaryMessage.id,
      totalMessages: messages.length
    });

    // 为聚合消息添加特殊标记
    for (let index = 0; index < messages.length; index++) {
      const queuedMessage = messages[index];
      queuedMessage.eventData = {
        ...queuedMessage.eventData,
        // 聚合处理标记
        isAggregated: true,
        totalBatchSize: messages.length,
        messageIndexInBatch: index,
        batchStartTime: primaryMessage.arrivalTime,

        // 传递所有聚合消息的信息
        aggregatedMessages: messages.map(m => ({
          id: m.id,
          arrivalTime: m.arrivalTime,
          message: m.message.message, // 消息内容
          userId: m.message.user_id,
          groupId: m.message.group_id
        }))
      };

      // 添加批量处理的元数据
      queuedMessage.metadata = {
        ...queuedMessage.metadata,
        isAggregated: true,
        totalBatchSize: messages.length,
        messageIndexInBatch: index
      };
    }
  }

  /**
   * 调用原始处理器
   */
  private async invokeOriginalHandler(
    primaryMessage: QueuedMessage,
    allMessages: QueuedMessage[],
    triggerReason: ConsumptionTriggerReason
  ): Promise<void> {
    // 增强事件数据，传递聚合信息
    const enhancedEventData = {
      ...primaryMessage.eventData,
      // 关键: 传递聚合消息信息给原有处理流程
      aggregatedMessages: allMessages,
      triggerReason,
      consumptionTime: new Date(),

      // 向后兼容的原始字段
      traceId: primaryMessage.traceId,
      originalTraceId: primaryMessage.eventData?.originalTraceId
    };

    this.moduleLogger.debug('Invoking original handler', {
      messageType: primaryMessage.message.message_type,
      primaryMessageId: primaryMessage.id,
      batchSize: allMessages.length,
      triggerReason
    });

    // 根据消息类型调用对应的原始处理器
    if (primaryMessage.message.message_type === 'private') {
      await this.originalHandlers.handlePrivateMessage(
        primaryMessage.message,
        enhancedEventData
      );
    } else if (primaryMessage.message.message_type === 'group') {
      await this.originalHandlers.handleGroupMessage(
        primaryMessage.message,
        enhancedEventData
      );
    } else {
      throw new Error(`Unsupported message type: ${primaryMessage.message.message_type}`);
    }
  }

  /**
   * 更新消息状态
   */
  private async updateMessagesStatus(
    messages: QueuedMessage[],
    status: 'queued' | 'aggregated' | 'consumed'
  ): Promise<void> {
    // 更新内存中的状态
    messages.forEach(message => {
      message.status = status;
    });

    // 批量更新数据库中的状态
    try {
      const messageIds = messages.map(m => m.id);
      if (messageIds.length > 0) {
        await this.database.executeQuery(
          `UPDATE message_arrivals SET status = ? WHERE id IN (${messageIds.map(() => '?').join(',')})`,
          [status, ...messageIds]
        );
      }
    } catch (error) {
      this.moduleLogger.warn('Failed to update message status in database', {
        messageIds: messages.map(m => m.id),
        status,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // 不抛出错误，继续处理流程
    }
  }

  /**
   * 记录消费事件到数据库
   */
  private async logConsumptionEvent(event: MessageConsumptionEvent): Promise<void> {
    try {
      await this.database.executeQuery(
        `INSERT INTO message_consumptions (
          id, source_key, batch_size, trigger_reason, consumption_timestamp,
          processing_duration_ms, trace_id, status, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          processing_duration_ms = VALUES(processing_duration_ms),
          status = VALUES(status),
          error_message = VALUES(error_message)`,
        [
          event.batchId,
          event.sourceKey,
          event.batchSize,
          event.triggerReason,
          event.consumptionTime,
          event.processingDuration || null,
          event.traceId,
          event.status,
          event.errorMessage || null
        ]
      );
    } catch (error) {
      this.moduleLogger.warn('Failed to log consumption event to database', {
        batchId: event.batchId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // 不抛出错误，继续处理流程
    }
  }

  /**
   * 更新统计信息
   */
  private updateStats(messageCount: number, processingTime: number, success: boolean): void {
    this.stats.totalBatchesProcessed++;
    this.stats.totalMessagesConsumed += messageCount;
    this.stats.totalProcessingTime += processingTime;

    if (success) {
      this.stats.successfulBatches++;
    } else {
      this.stats.failedBatches++;
    }
  }

  /**
   * 获取统计信息
   */
  public getStats() {
    return {
      ...this.stats,
      averageProcessingTime: this.stats.totalBatchesProcessed > 0
        ? this.stats.totalProcessingTime / this.stats.totalBatchesProcessed
        : 0,
      successRate: this.stats.totalBatchesProcessed > 0
        ? this.stats.successfulBatches / this.stats.totalBatchesProcessed
        : 0,
      averageBatchSize: this.stats.totalBatchesProcessed > 0
        ? this.stats.totalMessagesConsumed / this.stats.totalBatchesProcessed
        : 0
    };
  }

  /**
   * 优雅关闭
   */
  public async shutdown(): Promise<void> {
    this.moduleLogger.info('MessageConsumptionTrigger shutting down', {
      stats: this.getStats()
    });

    // 记录最终统计信息
    this.moduleLogger.info('Final consumption statistics', this.getStats());
  }
}
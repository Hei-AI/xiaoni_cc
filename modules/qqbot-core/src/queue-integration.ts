/**
 * 消息队列集成模块
 * 为现有QQBot类添加消息队列支持，实现渐进式重构
 */

import { QQMessage, QQNotice, QQRequest } from './types';
import { PartitionedMessageQueue, MessageSimulator, PartitionInfo } from './services/message-queue';
import { PartitionedMessageConsumer, MessageHandler, MessageContext } from './services/message-consumer';
import WebSocketMessageAdapter from './services/websocket-adapter';
import { logger } from './utils/logger';

/**
 * QQBot消息处理器适配器
 * 将现有的QQBot方法适配为MessageHandler接口
 */
export class QQBotMessageHandler implements MessageHandler {
  private moduleLogger = logger.createModuleLogger('qqbot-handler');

  constructor(private qqBot: any) {} // 注入QQBot实例

  async handlePrivateMessage(message: QQMessage, context: MessageContext): Promise<void> {
    try {
      this.moduleLogger.info('Processing private message from queue', {
        traceId: context.traceId,
        user_id: message.user_id,
        source: context.source,
        batchIndex: context.batchIndex,
        batchSize: context.batchSize
      });

      // 构造兼容的eventData
      const eventData = {
        traceId: context.traceId,
        source: context.source,
        queuedAt: context.queuedAt,
        processedAt: context.processedAt,
        partitionKey: context.partitionKey
      };

      // 调用原有的私聊处理逻辑
      await this.qqBot.handlePrivateMessage(message, eventData);
      
    } catch (error) {
      this.moduleLogger.error('Private message processing failed', {
        traceId: context.traceId,
        user_id: message.user_id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error; // 重新抛出以触发重试机制
    }
  }

  async handleGroupMessage(message: QQMessage, context: MessageContext): Promise<void> {
    try {
      this.moduleLogger.info('Processing group message from queue', {
        traceId: context.traceId,
        user_id: message.user_id,
        group_id: message.group_id,
        source: context.source,
        batchIndex: context.batchIndex,
        batchSize: context.batchSize
      });

      // 构造兼容的eventData
      const eventData = {
        traceId: context.traceId,
        source: context.source,
        queuedAt: context.queuedAt,
        processedAt: context.processedAt,
        partitionKey: context.partitionKey
      };

      // 调用原有的群聊处理逻辑
      await this.qqBot.handleGroupMessage(message, eventData);
      
    } catch (error) {
      this.moduleLogger.error('Group message processing failed', {
        traceId: context.traceId,
        user_id: message.user_id,
        group_id: message.group_id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  async handleNotice(notice: QQNotice, context: MessageContext): Promise<void> {
    try {
      this.moduleLogger.debug('Processing notice from queue', {
        traceId: context.traceId,
        notice_type: notice.notice_type,
        user_id: notice.user_id,
        group_id: notice.group_id
      });

      const eventData = {
        traceId: context.traceId,
        source: context.source,
        queuedAt: context.queuedAt,
        processedAt: context.processedAt
      };

      // 调用原有的通知处理逻辑
      await this.qqBot.handleNotice(notice, eventData);
      
    } catch (error) {
      this.moduleLogger.error('Notice processing failed', {
        traceId: context.traceId,
        notice_type: notice.notice_type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  async handleRequest(request: QQRequest, context: MessageContext): Promise<void> {
    try {
      this.moduleLogger.info('Processing request from queue', {
        traceId: context.traceId,
        request_type: request.request_type,
        user_id: request.user_id,
        group_id: request.group_id
      });

      const eventData = {
        traceId: context.traceId,
        source: context.source,
        queuedAt: context.queuedAt,
        processedAt: context.processedAt
      };

      // 调用原有的请求处理逻辑
      await this.qqBot.handleRequest(request, eventData);
      
    } catch (error) {
      this.moduleLogger.error('Request processing failed', {
        traceId: context.traceId,
        request_type: request.request_type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}

/**
 * 消息队列集成管理器
 * 管理消息队列、消费者、适配器的完整生命周期
 */
export class MessageQueueIntegration {
  private messageQueue: PartitionedMessageQueue;
  private messageHandler: QQBotMessageHandler;
  private messageConsumer: PartitionedMessageConsumer;
  private webSocketAdapter: WebSocketMessageAdapter;
  private messageSimulator: MessageSimulator;
  private moduleLogger = logger.createModuleLogger('queue-integration');

  constructor(qqBot: any, webSocketClient: any) {
    // 初始化消息队列
    this.messageQueue = new PartitionedMessageQueue();
    
    // 初始化消息处理器
    this.messageHandler = new QQBotMessageHandler(qqBot);
    
    // 初始化消息消费者
    this.messageConsumer = new PartitionedMessageConsumer(
      this.messageQueue,
      this.messageHandler,
      {
        pollIntervalMs: 50,
        maxConcurrentPartitions: 3, // 控制并发，避免过载
        enableBatchProcessing: true,
        errorRetryCount: 2
      }
    );
    
    // 初始化WebSocket适配器
    this.webSocketAdapter = new WebSocketMessageAdapter(
      webSocketClient,
      this.messageQueue
    );
    
    // 初始化消息模拟器
    this.messageSimulator = new MessageSimulator(this.messageQueue);
    
    this.moduleLogger.info('Message queue integration initialized');
  }

  /**
   * 启动队列系统
   */
  async start(): Promise<void> {
    try {
      await this.messageConsumer.start();
      this.moduleLogger.info('Message queue system started');
    } catch (error) {
      this.moduleLogger.error('Failed to start message queue system', { error });
      throw error;
    }
  }

  /**
   * 停止队列系统
   */
  async stop(): Promise<void> {
    try {
      await this.messageConsumer.stop();
      this.moduleLogger.info('Message queue system stopped');
    } catch (error) {
      this.moduleLogger.error('Failed to stop message queue system', { error });
      throw error;
    }
  }

  /**
   * 获取消息模拟器（用于测试）
   */
  getMessageSimulator(): MessageSimulator {
    return this.messageSimulator;
  }

  /**
   * 获取队列统计信息
   */
  getQueueStats() {
    return {
      queue: this.messageQueue.getStats(),
      consumer: this.messageConsumer.getStatus(),
      adapter: this.webSocketAdapter.getStats()
    };
  }

  /**
   * 获取活跃分区信息
   */
  getActivePartitions(): Array<{
    partitionKey: string;
    messageCount: number;
    info: PartitionInfo | undefined;
    preview: any[];
  }> {
    const activePartitions = this.messageQueue.getActivePartitions();
    return activePartitions.map(partitionKey => ({
      partitionKey,
      messageCount: this.messageQueue.getPartitionSize(partitionKey),
      info: this.messageQueue.getPartitionInfo(partitionKey),
      preview: this.messageQueue.peekPartition(partitionKey, 3)
    }));
  }

  /**
   * 清空指定分区（管理功能）
   */
  clearPartition(partitionKey: string): number {
    return this.messageQueue.clearPartition(partitionKey);
  }

  /**
   * 模拟私聊消息（测试接口）
   */
  async simulatePrivateMessage(testMessage: {
    user_id: number;
    message: string;
    priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  }): Promise<string> {
    return await this.messageSimulator.simulatePrivateMessage(testMessage);
  }

  /**
   * 模拟群聊消息（测试接口）
   */
  async simulateGroupMessage(testMessage: {
    user_id: number;
    group_id: number;
    message: string;
    atBot?: boolean;
    priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  }): Promise<string> {
    return await this.messageSimulator.simulateGroupMessage(testMessage);
  }

  /**
   * 批量模拟消息（压力测试）
   */
  async simulateBatch(messages: Array<{
    type: 'private' | 'group';
    user_id: number;
    group_id?: number;
    message: string;
    priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  }>): Promise<string[]> {
    return await this.messageSimulator.simulateBatch(messages);
  }
}

export default MessageQueueIntegration;
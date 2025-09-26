/**
 * 简单队列系统集成
 * 无外部依赖，直接集成到现有QQBot系统
 */

import { SimpleMessageQueue, SimpleMessageConsumer, SimpleMessageSimulator, SimpleQueueMessage } from './simple-message-queue';
import { QQMessage, QQNotice, QQRequest } from '../types';
import WebSocketClient from './websocket-client';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * WebSocket适配器 - 简化版
 */
export class SimpleWebSocketAdapter {
  private moduleLogger = logger.createModuleLogger('simple-ws-adapter');

  constructor(
    private webSocketClient: WebSocketClient,
    private messageQueue: SimpleMessageQueue
  ) {
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // 私聊消息
    this.webSocketClient.on('private_message', async (message: QQMessage, eventData?: any) => {
      await this.handleMessageToQueue(message, 'private_message', eventData);
    });

    // 群聊消息
    this.webSocketClient.on('group_message', async (message: QQMessage, eventData?: any) => {
      await this.handleMessageToQueue(message, 'group_message', eventData);
    });

    this.moduleLogger.info('Simple WebSocket adapter initialized');
  }

  private async handleMessageToQueue(
    message: QQMessage, 
    type: 'private_message' | 'group_message',
    eventData?: any
  ): Promise<void> {
    try {
      const queueMessage: SimpleQueueMessage = {
        id: uuidv4(),
        traceId: eventData?.traceId || this.generateTraceId(),
        type,
        payload: message,
        source: 'websocket',
        timestamp: new Date(),
        priority: this.determinePriority(message, type),
        partitionKey: SimpleMessageQueue.generatePartitionKey(message),
        retryCount: 0
      };

      await this.messageQueue.push(queueMessage);

      this.moduleLogger.info('Message queued', {
        type,
        traceId: queueMessage.traceId,
        partitionKey: queueMessage.partitionKey,
        priority: queueMessage.priority
      });

    } catch (error) {
      this.moduleLogger.error('Failed to queue message', {
        type,
        error: error instanceof Error ? error.message : 'Unknown error',
        traceId: eventData?.traceId
      });
    }
  }

  private determinePriority(message: QQMessage, type: 'private_message' | 'group_message'): 'HIGH' | 'MEDIUM' | 'LOW' {
    // 私聊默认高优先级
    if (type === 'private_message') {
      return 'HIGH';
    }

    // 群聊根据@机器人判断
    if (this.isAtBot(message)) {
      return 'HIGH';
    }

    return 'MEDIUM';
  }

  private isAtBot(message: QQMessage): boolean {
    const botQQ = '1129974489';
    
    if (Array.isArray(message.message)) {
      return message.message.some((segment: any) => 
        segment.type === 'at' && segment.data?.qq === botQQ
      );
    } else if (typeof message.message === 'string') {
      return message.message.includes(`[CQ:at,qq=${botQQ}]`);
    }
    
    return false;
  }

  private generateTraceId(): string {
    return `ws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * QQBot消息处理器适配器 - 简化版
 */
export class SimpleQQBotHandler {
  private moduleLogger = logger.createModuleLogger('simple-qqbot-handler');

  constructor(private qqBot: any) {}

  async handleMessages(messages: SimpleQueueMessage[]): Promise<void> {
    for (const message of messages) {
      try {
        const eventData = {
          traceId: message.traceId,
          source: message.source,
          queuedAt: message.timestamp,
          processedAt: new Date(),
          partitionKey: message.partitionKey,
          retryCount: message.retryCount
        };

        switch (message.type) {
          case 'private_message':
            await this.qqBot.handlePrivateMessage(message.payload, eventData);
            break;
          case 'group_message':
            await this.qqBot.handleGroupMessage(message.payload, eventData);
            break;
          default:
            this.moduleLogger.warn('Unknown message type', { type: message.type });
        }

        this.moduleLogger.debug('Message processed', {
          messageId: message.id,
          traceId: message.traceId,
          type: message.type
        });

      } catch (error) {
        this.moduleLogger.error('Message processing failed', {
          messageId: message.id,
          traceId: message.traceId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error; // 重新抛出以触发重试
      }
    }
  }
}

/**
 * 简单队列系统集成管理器
 */
export class SimpleQueueIntegration {
  private messageQueue: SimpleMessageQueue;
  private messageConsumer: SimpleMessageConsumer;
  private webSocketAdapter: SimpleWebSocketAdapter;
  private messageHandler: SimpleQQBotHandler;
  private messageSimulator: SimpleMessageSimulator;
  private moduleLogger = logger.createModuleLogger('simple-queue-integration');

  constructor(qqBot: any, webSocketClient: WebSocketClient) {
    // 初始化队列
    this.messageQueue = new SimpleMessageQueue();
    
    // 初始化处理器
    this.messageHandler = new SimpleQQBotHandler(qqBot);
    
    // 初始化消费者
    this.messageConsumer = new SimpleMessageConsumer(
      this.messageQueue,
      (messages) => this.messageHandler.handleMessages(messages)
    );
    
    // 初始化适配器
    this.webSocketAdapter = new SimpleWebSocketAdapter(webSocketClient, this.messageQueue);
    
    // 初始化模拟器
    this.messageSimulator = new SimpleMessageSimulator(this.messageQueue);

    this.moduleLogger.info('Simple queue integration initialized');
  }

  /**
   * 启动队列系统
   */
  start(): void {
    this.messageConsumer.start();
    this.moduleLogger.info('Simple queue system started');
  }

  /**
   * 停止队列系统
   */
  stop(): void {
    this.messageConsumer.stop();
    this.moduleLogger.info('Simple queue system stopped');
  }

  /**
   * 获取消息模拟器
   */
  getSimulator(): SimpleMessageSimulator {
    return this.messageSimulator;
  }

  /**
   * 获取队列统计
   */
  getStats() {
    return this.messageQueue.getStats();
  }

  /**
   * 获取分区信息
   */
  getPartitionInfo(partitionKey: string) {
    return this.messageQueue.getPartitionInfo(partitionKey);
  }

  /**
   * 获取所有活跃分区
   */
  getActivePartitions() {
    const activePartitions = this.messageQueue.getActivePartitions();
    return activePartitions.map(partitionKey => ({
      partitionKey,
      info: this.messageQueue.getPartitionInfo(partitionKey)
    })).filter(item => item.info !== null);
  }

  /**
   * 清空分区
   */
  clearPartition(partitionKey: string): number {
    return this.messageQueue.clearPartition(partitionKey);
  }

  /**
   * 模拟私聊消息
   */
  async simulatePrivateMessage(testMessage: {
    user_id: number;
    message: string;
    priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  }): Promise<string> {
    return await this.messageSimulator.simulatePrivateMessage(testMessage);
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
    return await this.messageSimulator.simulateGroupMessage(testMessage);
  }

  /**
   * 批量模拟消息
   */
  async simulateBatch(messages: Array<{
    type: 'private' | 'group';
    user_id: number;
    group_id?: number;
    message: string;
    priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  }>): Promise<string[]> {
    const traceIds: string[] = [];
    
    for (const msg of messages) {
      if (msg.type === 'private') {
        const traceId = await this.simulatePrivateMessage(msg);
        traceIds.push(traceId);
      } else if (msg.type === 'group' && msg.group_id) {
        const traceId = await this.simulateGroupMessage({
          ...msg,
          group_id: msg.group_id
        });
        traceIds.push(traceId);
      }
    }
    
    return traceIds;
  }
}

export default SimpleQueueIntegration;
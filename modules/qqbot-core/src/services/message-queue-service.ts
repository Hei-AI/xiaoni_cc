/**
 * MessageQueueService - 统一消息队列服务
 *
 * 功能：
 * 1. 按 sourceKey (user_id 或 group_id) 分区管理消息
 * 2. 支持批量 drain 操作
 * 3. 优先级判断（@、管理员指令）
 * 4. 未读计数查询
 *
 * 架构说明：
 * - 基于 PartitionedMessageQueue 实现
 * - 支持直连模式和拟人化模式
 * - 消息 drain 后自动清空分区
 */

import { QQMessage, QQNotice, QQRequest } from '../types';
import { logger } from '../utils/logger';
import { PartitionedMessageQueue, QueuedMessage } from './message-queue';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { LoggingService } from './logging-service';

export interface DrainedMessage {
  id: string;
  traceId: string;
  message: QQMessage | QQNotice | QQRequest;
  eventData?: any;
  arrivalTime: Date;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

export class MessageQueueService extends EventEmitter {
  private queue: PartitionedMessageQueue;
  private moduleLogger = logger.createModuleLogger('message-queue-service');
  private authorizedUserId: number;
  private botQQNumber: number;
  private loggingService?: LoggingService;

  constructor(authorizedUserId: number, botQQNumber: number, loggingService?: LoggingService) {
    super();
    this.queue = new PartitionedMessageQueue();
    this.authorizedUserId = authorizedUserId;
    this.botQQNumber = botQQNumber;
    this.loggingService = loggingService;

    this.moduleLogger.info('MessageQueueService initialized', {
      authorizedUserId,
      botQQNumber
    });

    // 监听队列事件并重新发出
    this.queue.on('message_queued', ({ partitionKey, message }) => {
      this.moduleLogger.debug('Message queued', {
        partitionKey,
        messageId: message.id,
        priority: message.priority
      });

      // 重新发出事件供 ScheduleDispatcher 监听
      this.emit('message_queued', {
        sourceKey: partitionKey,
        priority: message.priority
      });
    });
  }

  /**
   * 入队消息
   * @param message QQ消息
   * @param eventData WebSocket 事件数据（包含 traceId）
   */
  async enqueue(
    message: QQMessage | QQNotice | QQRequest,
    eventData?: any,
    source: 'websocket' | 'simulation' | 'api' = 'websocket'
  ): Promise<string> {
    const sourceKey = this.generateSourceKey(message);
    const priority = this.getPriority(message);
    const traceId = eventData?.traceId || `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const queuedMessage: QueuedMessage = {
      id: uuidv4(),
      traceId,
      type: this.getMessageType(message),
      payload: message,
      source,
      timestamp: new Date(),
      priority,
      partitionKey: sourceKey
    };

    await this.queue.push(queuedMessage);

    if (this.loggingService) {
      await this.loggingService.logInstantEvent(traceId, 'queue', 'queue.enqueued', eventData?.conversationId, {
        sourceKey,
        priority,
        queued_message_id: queuedMessage.id,
        source,
        message_type: this.getMessageType(message)
      });
    }

    this.moduleLogger.info('Message enqueued', {
      sourceKey,
      messageId: queuedMessage.id,
      traceId,
      priority,
      queueSize: this.queue.getPartitionSize(sourceKey)
    });

    return queuedMessage.id;
  }

  /**
   * Drain - 批量取出指定 sourceKey 的所有消息
   * @param sourceKey 源标识符 (user_123 或 group_456)
   * @returns 消息数组
   */
  async drain(sourceKey: string): Promise<DrainedMessage[]> {
    const queuedMessages = await this.queue.consumePartition(sourceKey);

    const drainedMessages: DrainedMessage[] = queuedMessages.map(qm => ({
      id: qm.id,
      traceId: qm.traceId,
      message: qm.payload,
      eventData: { traceId: qm.traceId },
      arrivalTime: qm.timestamp,
      priority: qm.priority
    }));

    if (this.loggingService) {
      await Promise.all(drainedMessages.map((message) => this.loggingService!.logInstantEvent(
        message.traceId,
        'queue',
        'queue.dequeued',
        undefined,
        {
          sourceKey,
          queued_message_id: message.id,
          arrival_time: message.arrivalTime.toISOString(),
          priority: message.priority
        }
      )));
    }

    this.moduleLogger.info('Messages drained', {
      sourceKey,
      messageCount: drainedMessages.length,
      traceIds: drainedMessages.map(m => m.traceId)
    });

    return drainedMessages;
  }

  /**
   * 获取指定 sourceKey 的未读消息数
   */
  getUnreadCount(sourceKey: string): number {
    return this.queue.getPartitionSize(sourceKey);
  }

  /**
   * 获取所有有未读消息的 sourceKey
   */
  getActiveSourceKeys(): string[] {
    return this.queue.getActivePartitions();
  }

  /**
   * 预览消息（不消费）
   */
  peek(sourceKey: string, limit: number = 10): DrainedMessage[] {
    const queuedMessages = this.queue.peekPartition(sourceKey, limit);
    return queuedMessages.map(qm => ({
      id: qm.id,
      traceId: qm.traceId,
      message: qm.payload,
      eventData: { traceId: qm.traceId },
      arrivalTime: qm.timestamp,
      priority: qm.priority
    }));
  }

  /**
   * 获取队列统计信息
   */
  getStats() {
    return this.queue.getStats();
  }

  getAllPartitions() {
    return this.queue.getAllPartitions();
  }

  getPartitionSnapshot(partitionKey: string, peekLimit: number = 10) {
    const info = this.queue.getPartitionInfo(partitionKey);
    if (!info) return null;

    const messages = this.queue.peekPartition(partitionKey, peekLimit).map((msg) => ({
      id: msg.id,
      traceId: msg.traceId,
      type: msg.type,
      priority: msg.priority,
      timestamp: msg.timestamp.toISOString(),
      source: msg.source
    }));

    return {
      partitionKey: info.partitionKey,
      type: info.type,
      messageCount: info.messageCount,
      lastProcessedAt: info.lastProcessedAt ? info.lastProcessedAt.toISOString() : null,
      messages
    };
  }

  clearPartition(partitionKey: string): number {
    return this.queue.clearPartition(partitionKey);
  }

  getRuntimeConfig() {
    return {
      performance: {
        pollIntervalMs: 100,
        batchSize: 10
      },
      limits: {
        maxRetries: 3,
        maxPartitions: 1000
      }
    };
  }

  async simulatePrivateMessage(params: {
    user_id: number;
    message: string;
    priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  }): Promise<{ traceId: string; messageId: string }> {
    const { user_id, message, priority } = params;

    const qqMessage: QQMessage = {
      message_type: 'private',
      user_id,
      message,
      raw_message: message,
      message_id: Date.now(),
      time: Math.floor(Date.now() / 1000),
      self_id: this.botQQNumber,
      sender: {
        user_id,
        nickname: `模拟用户${user_id}`,
        sex: 'unknown'
      },
      font: 14,
      sub_type: 'friend',
      post_type: 'message'
    };

    const traceId = `sim-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const selectedPriority = priority || this.getPriority(qqMessage);

    const queuedMessage: QueuedMessage = {
      id: uuidv4(),
      traceId,
      type: 'private_message',
      payload: qqMessage,
      source: 'api',
      timestamp: new Date(),
      priority: selectedPriority,
      partitionKey: this.generateSourceKey(qqMessage)
    };

    await this.queue.push(queuedMessage);

    return { traceId, messageId: queuedMessage.id };
  }

  async simulateGroupMessage(params: {
    user_id: number;
    group_id: number;
    message: string;
    atBot?: boolean;
    priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  }): Promise<{ traceId: string; messageId: string }> {
    const { user_id, group_id, message, atBot, priority } = params;

    const content = atBot
      ? [
          { type: 'at', data: { qq: String(this.botQQNumber) } },
          { type: 'text', data: { text: ` ${message}` } }
        ]
      : message;

    const qqMessage: QQMessage = {
      message_type: 'group',
      user_id,
      group_id,
      message: content as any,
      raw_message: atBot ? `[CQ:at,qq=${this.botQQNumber}] ${message}` : message,
      message_id: Date.now(),
      time: Math.floor(Date.now() / 1000),
      self_id: this.botQQNumber,
      sender: {
        user_id,
        nickname: `模拟用户${user_id}`,
        card: `测试成员${user_id}`,
        sex: 'unknown',
        role: 'member'
      },
      font: 14,
      sub_type: 'normal',
      post_type: 'message'
    };

    const traceId = `sim-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const selectedPriority = priority || this.getPriority(qqMessage);

    const queuedMessage: QueuedMessage = {
      id: uuidv4(),
      traceId,
      type: 'group_message',
      payload: qqMessage,
      source: 'api',
      timestamp: new Date(),
      priority: selectedPriority,
      partitionKey: this.generateSourceKey(qqMessage)
    };

    await this.queue.push(queuedMessage);

    return { traceId, messageId: queuedMessage.id };
  }

  async simulateBatch(messages: Array<{
    type: 'private' | 'group';
    user_id: number;
    group_id?: number;
    message: string;
    priority?: 'HIGH' | 'MEDIUM' | 'LOW';
    atBot?: boolean;
  }>): Promise<string[]> {
    const traceIds: string[] = [];

    for (const msg of messages) {
      if (msg.type === 'private') {
        const { traceId } = await this.simulatePrivateMessage(msg);
        traceIds.push(traceId);
      } else if (msg.type === 'group' && msg.group_id !== undefined) {
        const { traceId } = await this.simulateGroupMessage({
          user_id: msg.user_id,
          group_id: msg.group_id,
          message: msg.message,
          priority: msg.priority,
          atBot: msg.atBot
        });
        traceIds.push(traceId);
      }
    }

    return traceIds;
  }

  /**
   * 判断消息优先级
   *
   * HIGH:
   * - 私聊且来自授权用户
   * - 群聊且 @机器人
   * - 包含管理员命令关键词
   *
   * MEDIUM:
   * - 普通私聊
   *
   * LOW:
   * - 普通群聊（未@机器人）
   */
  private getPriority(message: QQMessage | QQNotice | QQRequest): 'HIGH' | 'MEDIUM' | 'LOW' {
    const msg = message as any;

    // 私聊消息
    if (msg.message_type === 'private') {
      // 授权用户的私聊消息
      if (msg.user_id === this.authorizedUserId) {
        return 'HIGH';
      }

      // 包含管理员命令的消息
      if (this.containsAdminCommand(msg)) {
        return 'HIGH';
      }

      return 'MEDIUM';
    }

    // 群聊消息
    if (msg.message_type === 'group') {
      // @机器人的消息
      if (this.isAtBot(msg)) {
        return 'HIGH';
      }

      // 包含管理员命令的消息（来自授权用户）
      if (msg.user_id === this.authorizedUserId && this.containsAdminCommand(msg)) {
        return 'HIGH';
      }

      return 'LOW';
    }

    // 其他类型消息（notice、request）
    return 'MEDIUM';
  }

  /**
   * 检测是否 @机器人
   */
  private isAtBot(message: any): boolean {
    const botQQStr = this.botQQNumber.toString();

    // 消息段数组格式
    if (Array.isArray(message.message)) {
      return message.message.some((segment: any) =>
        segment.type === 'at' && segment.data?.qq === botQQStr
      );
    }

    // 字符串CQ码格式
    if (typeof message.message === 'string') {
      const atPattern = new RegExp(`\\[CQ:at,qq=${botQQStr}\\]`);
      return atPattern.test(message.message);
    }

    return false;
  }

  /**
   * 检测是否包含管理员命令
   */
  private containsAdminCommand(message: any): boolean {
    const adminCommands = [
      '开启群聊',
      '关闭群聊',
      '添加群聊',
      '移除群聊',
      '群聊列表',
      '清空群聊'
    ];

    let messageText = '';

    if (typeof message.message === 'string') {
      messageText = message.message;
    } else if (Array.isArray(message.message)) {
      messageText = message.message
        .filter((seg: any) => seg.type === 'text')
        .map((seg: any) => seg.data?.text || '')
        .join('');
    }

    return adminCommands.some(cmd => messageText.includes(cmd));
  }

  /**
   * 生成 sourceKey
   */
  private generateSourceKey(message: QQMessage | QQNotice | QQRequest): string {
    return PartitionedMessageQueue.generatePartitionKey(message);
  }

  /**
   * 获取消息类型
   */
  private getMessageType(message: QQMessage | QQNotice | QQRequest): 'private_message' | 'group_message' | 'notice' | 'request' {
    const msg = message as any;

    if (msg.message_type === 'private') {
      return 'private_message';
    } else if (msg.message_type === 'group') {
      return 'group_message';
    } else if (msg.notice_type) {
      return 'notice';
    } else if (msg.request_type) {
      return 'request';
    }

    return 'private_message'; // 默认
  }
}

export default MessageQueueService;

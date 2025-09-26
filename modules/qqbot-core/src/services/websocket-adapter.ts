import { WebSocketClient } from './websocket-client';
import { PartitionedMessageQueue, QueuedMessage } from './message-queue';
import { QQMessage, QQNotice, QQRequest } from '../types';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * WebSocket到消息队列的适配器
 * 职责：
 * 1. 接收WebSocket事件并转换为队列消息
 * 2. 维持原有WebSocket逻辑的兼容性
 * 3. 支持优先级设置和分区路由
 */
export class WebSocketMessageAdapter {
  private moduleLogger = logger.createModuleLogger('websocket-adapter');

  constructor(
    private webSocketClient: WebSocketClient,
    private messageQueue: PartitionedMessageQueue
  ) {
    this.setupEventHandlers();
  }

  /**
   * 设置WebSocket事件处理器
   */
  private setupEventHandlers(): void {
    // 处理私聊消息
    this.webSocketClient.on('private_message', async (message: QQMessage, eventData?: any) => {
      await this.handlePrivateMessageToQueue(message, eventData);
    });

    // 处理群聊消息  
    this.webSocketClient.on('group_message', async (message: QQMessage, eventData?: any) => {
      await this.handleGroupMessageToQueue(message, eventData);
    });

    // 处理通知
    this.webSocketClient.on('notice', async (notice: QQNotice, eventData?: any) => {
      await this.handleNoticeToQueue(notice, eventData);
    });

    // 处理请求
    this.webSocketClient.on('request', async (request: QQRequest, eventData?: any) => {
      await this.handleRequestToQueue(request, eventData);
    });

    this.moduleLogger.info('WebSocket event handlers registered');
  }

  /**
   * 处理私聊消息到队列
   */
  private async handlePrivateMessageToQueue(message: QQMessage, eventData?: any): Promise<void> {
    try {
      const queuedMessage: QueuedMessage = {
        id: uuidv4(),
        traceId: eventData?.traceId || this.generateTraceId(),
        type: 'private_message',
        payload: message,
        source: 'websocket',
        timestamp: new Date(),
        priority: this.determineMessagePriority(message, 'private'),
        partitionKey: PartitionedMessageQueue.generatePartitionKey(message)
      };

      await this.messageQueue.push(queuedMessage);
      
      this.moduleLogger.info('Private message queued', {
        traceId: queuedMessage.traceId,
        partitionKey: queuedMessage.partitionKey,
        user_id: message.user_id,
        priority: queuedMessage.priority
      });

    } catch (error) {
      this.moduleLogger.error('Failed to queue private message', {
        error: error instanceof Error ? error.message : 'Unknown error',
        user_id: message.user_id,
        traceId: eventData?.traceId
      });
    }
  }

  /**
   * 处理群聊消息到队列
   */
  private async handleGroupMessageToQueue(message: QQMessage, eventData?: any): Promise<void> {
    try {
      const queuedMessage: QueuedMessage = {
        id: uuidv4(),
        traceId: eventData?.traceId || this.generateTraceId(),
        type: 'group_message',
        payload: message,
        source: 'websocket',
        timestamp: new Date(),
        priority: this.determineMessagePriority(message, 'group'),
        partitionKey: PartitionedMessageQueue.generatePartitionKey(message)
      };

      await this.messageQueue.push(queuedMessage);
      
      this.moduleLogger.info('Group message queued', {
        traceId: queuedMessage.traceId,
        partitionKey: queuedMessage.partitionKey,
        user_id: message.user_id,
        group_id: message.group_id,
        priority: queuedMessage.priority
      });

    } catch (error) {
      this.moduleLogger.error('Failed to queue group message', {
        error: error instanceof Error ? error.message : 'Unknown error',
        user_id: message.user_id,
        group_id: message.group_id,
        traceId: eventData?.traceId
      });
    }
  }

  /**
   * 处理通知到队列
   */
  private async handleNoticeToQueue(notice: QQNotice, eventData?: any): Promise<void> {
    try {
      const queuedMessage: QueuedMessage = {
        id: uuidv4(),
        traceId: eventData?.traceId || this.generateTraceId(),
        type: 'notice',
        payload: notice,
        source: 'websocket',
        timestamp: new Date(),
        priority: 'LOW', // 通知类消息优先级较低
        partitionKey: PartitionedMessageQueue.generatePartitionKey(notice)
      };

      await this.messageQueue.push(queuedMessage);
      
      this.moduleLogger.debug('Notice queued', {
        traceId: queuedMessage.traceId,
        partitionKey: queuedMessage.partitionKey,
        notice_type: notice.notice_type,
        user_id: notice.user_id,
        group_id: notice.group_id
      });

    } catch (error) {
      this.moduleLogger.error('Failed to queue notice', {
        error: error instanceof Error ? error.message : 'Unknown error',
        notice_type: notice.notice_type,
        traceId: eventData?.traceId
      });
    }
  }

  /**
   * 处理请求到队列
   */
  private async handleRequestToQueue(request: QQRequest, eventData?: any): Promise<void> {
    try {
      const queuedMessage: QueuedMessage = {
        id: uuidv4(),
        traceId: eventData?.traceId || this.generateTraceId(),
        type: 'request',
        payload: request,
        source: 'websocket',
        timestamp: new Date(),
        priority: 'MEDIUM', // 请求类消息中等优先级
        partitionKey: PartitionedMessageQueue.generatePartitionKey(request)
      };

      await this.messageQueue.push(queuedMessage);
      
      this.moduleLogger.info('Request queued', {
        traceId: queuedMessage.traceId,
        partitionKey: queuedMessage.partitionKey,
        request_type: request.request_type,
        user_id: request.user_id,
        group_id: request.group_id
      });

    } catch (error) {
      this.moduleLogger.error('Failed to queue request', {
        error: error instanceof Error ? error.message : 'Unknown error',
        request_type: request.request_type,
        traceId: eventData?.traceId
      });
    }
  }

  /**
   * 确定消息优先级
   */
  private determineMessagePriority(message: QQMessage, type: 'private' | 'group'): 'HIGH' | 'MEDIUM' | 'LOW' {
    // 私聊消息默认高优先级
    if (type === 'private') {
      return 'HIGH';
    }

    // 群聊消息根据内容确定优先级
    const messageText = this.extractMessageText(message);
    
    // @机器人的消息高优先级
    if (this.isAtBot(message)) {
      return 'HIGH';
    }
    
    // 包含紧急关键词的消息
    const urgentKeywords = ['紧急', '急', '马上', '立即', '重要', 'urgent', 'asap'];
    if (urgentKeywords.some(keyword => messageText.toLowerCase().includes(keyword))) {
      return 'HIGH';
    }
    
    // 普通群聊消息
    return 'MEDIUM';
  }

  /**
   * 检查是否@机器人
   */
  private isAtBot(message: QQMessage): boolean {
    const botQQ = '1129974489'; // 从配置获取
    
    if (Array.isArray(message.message)) {
      return message.message.some((segment: any) => 
        segment.type === 'at' && segment.data?.qq === botQQ
      );
    } else if (typeof message.message === 'string') {
      const atPattern = new RegExp(`\\[CQ:at,qq=${botQQ}\\]`);
      return atPattern.test(message.message);
    }
    
    return false;
  }

  /**
   * 提取消息文本内容
   */
  private extractMessageText(message: QQMessage): string {
    if (typeof message.message === 'string') {
      return message.message;
    } else if (Array.isArray(message.message)) {
      return message.message
        .filter((segment: any) => segment.type === 'text')
        .map((segment: any) => segment.data?.text || '')
        .join('')
        .trim();
    }
    return '';
  }

  /**
   * 生成跟踪ID
   */
  private generateTraceId(): string {
    return `ws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取适配器统计信息
   */
  getStats() {
    return {
      queueStats: this.messageQueue.getStats(),
      connectionInfo: this.webSocketClient.getConnectionInfo()
    };
  }
}

export default WebSocketMessageAdapter;
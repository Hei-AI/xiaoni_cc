import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { WebSocketConfig, QQMessage, QQNotice, QQRequest, WebSocketEvent } from '../types';
import { logger } from '../utils/logger';
import { LoggingService } from './logging-service';
import { TraceIdGenerator, ExecutionContext, createExecutionContext } from '../utils/trace-id';
import { TraceStrategyManager, createEventContext } from '../utils/trace-strategy';

interface WebSocketMessage extends WebSocketEvent {
  message?: string;
  user_id?: number;
  group_id?: number;
  message_type?: 'private' | 'group';
}

export class WebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: WebSocketConfig;
  private moduleLogger = logger.createModuleLogger('websocket');
  private reconnectInterval: number = 5000;
  private maxReconnectAttempts: number = 10;
  private reconnectAttempts: number = 0;
  private isConnecting: boolean = false;
  private isManualClose: boolean = false;
  private loggingService: LoggingService | null = null;

  constructor(config: WebSocketConfig, loggingService?: LoggingService) {
    super();
    this.config = config;
    this.loggingService = loggingService || null;
  }

  public async connect(): Promise<void> {
    if (this.isConnecting) {
      this.moduleLogger.warn('Already connecting, skipping duplicate connection attempt');
      return;
    }

    this.isConnecting = true;
    this.isManualClose = false;

    try {
      this.moduleLogger.info(`Connecting to WebSocket: ${this.config.uri}`);
      
      this.ws = new WebSocket(this.config.uri);
      
      this.ws.on('open', this.handleOpen.bind(this));
      this.ws.on('message', this.handleMessage.bind(this));
      this.ws.on('error', this.handleError.bind(this));
      this.ws.on('close', this.handleClose.bind(this));

    } catch (error: unknown) {
      this.isConnecting = false;
      this.moduleLogger.error('Failed to create WebSocket connection', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private handleOpen(): void {
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.moduleLogger.info('WebSocket connection established');
    this.emit('connected');
  }

  private async handleMessage(data: WebSocket.Data): Promise<void> {
    const startTime = Date.now();
    let traceId: string | null = null;
    let logId: number | null = null;

    try {
      const message = JSON.parse(data.toString()) as WebSocketMessage;
      
      // 🔥 FIX: 创建事件上下文并决定是否生成TraceID - 修复事件类型映射
      let eventType: string = message.post_type;
      if (message.post_type === 'message') {
        // 将通用的'message'类型转换为具体的私聊或群聊类型
        eventType = message.message_type === 'private' ? 'private_message' : 'group_message';
      }
      const eventContext = createEventContext(eventType as any, message);
      traceId = eventContext.traceId;

      this.moduleLogger.info('🔍 WebSocket message received', { 
        post_type: message.post_type, 
        message_type: message.message_type,
        user_id: message.user_id,
        group_id: message.group_id,
        traceId,
        priority: eventContext.priority,
        shouldLog: eventContext.shouldLog,
        raw: JSON.stringify(message).substring(0, 500) + (JSON.stringify(message).length > 500 ? '...' : '')
      });

      // 记录WebSocket接收日志（如果需要）
      if (this.loggingService && eventContext.shouldLog) {
        try {
          logId = await this.loggingService.logWebSocketMessage({
            traceId: traceId || undefined,
            direction: 'IN',
            messageType: message.post_type || 'unknown',
            eventPriority: eventContext.priority,
            rawPayload: message,
            userId: message.user_id,
            groupId: message.group_id,
            messageId: (message as any).message_id,
            processingTimeMs: Date.now() - startTime,
            status: 'SUCCESS'
          });

          this.moduleLogger.info('📝 WebSocket IN logged', { logId, traceId });
        } catch (logError: unknown) {
          this.moduleLogger.error('Failed to log WebSocket IN message', { 
            error: logError instanceof Error ? logError.message : String(logError), 
            traceId 
          });
        }
      }

      // 对于群聊消息，显示完整的JSON结构
      if (message.post_type === 'message' && message.message_type === 'group') {
        this.moduleLogger.info('📄 Complete group message JSON:', {
          traceId,
          fullMessage: JSON.stringify(message, null, 2)
        });
      }

      // 检查是否是API响应消息
      if (this.isApiResponse(message)) {
        await this.handleApiResponse(message as any, traceId);
        return;
      }

      // 根据消息类型分发事件，传递TraceID和其他上下文
      const eventData = { traceId, logId, startTime, eventContext };

      switch (message.post_type) {
        case 'message':
          this.moduleLogger.info('📨 Processing message event', {
            traceId,
            message_type: message.message_type,
            user_id: message.user_id,
            group_id: message.group_id
          });
          await this.handleQQMessage(message as unknown as QQMessage, eventData);
          break;
        case 'message_sent':
          this.emit('message_sent', message, eventData);
          break;
        case 'notice':
          await this.handleQQNotice(message as unknown as QQNotice, eventData);
          break;
        case 'request':
          await this.handleQQRequest(message as unknown as QQRequest, eventData);
          break;
        case 'meta_event':
          await this.handleQQMetaEvent(message as unknown as any, eventData);
          break;
        default:
          this.moduleLogger.warn('Unknown message type', { 
            traceId,
            type: message.post_type, 
            message: JSON.stringify(message).substring(0, 500) 
          });
      }

      this.emit('raw_message', message, eventData);
    } catch (error: unknown) {
      const processingTime = Date.now() - startTime;
      
      this.moduleLogger.error('Failed to parse WebSocket message', { 
        traceId,
        error: error instanceof Error ? error.message : String(error), 
        processingTime,
        data: data.toString().substring(0, 500) 
      });

      // 记录错误日志
      if (this.loggingService && traceId) {
        try {
          await this.loggingService.logWebSocketMessage({
            traceId,
            direction: 'IN',
            messageType: 'parse_error',
            eventPriority: 'HIGH',
            rawPayload: { error: error instanceof Error ? error.message : String(error), data: data.toString().substring(0, 500) },
            processingTimeMs: processingTime,
            status: 'ERROR',
            errorMessage: error instanceof Error ? error.message : String(error)
          });
        } catch (logError: unknown) {
          this.moduleLogger.error('Failed to log WebSocket parse error', { 
            error: logError instanceof Error ? logError.message : String(logError) 
          });
        }
      }
    }
  }

  private async handleQQMessage(message: QQMessage, eventData?: any): Promise<void> {
    const traceId = eventData?.traceId;
    
    this.moduleLogger.info('🎯 handleQQMessage called', { 
      traceId,
      message_type: message.message_type,
      user_id: message.user_id,
      group_id: message.group_id,
      message: typeof message.message === 'string' ? message.message.substring(0, 100) : JSON.stringify(message.message).substring(0, 100)
    });
    
    // 处理OneBot消息段格式
    message = this.normalizeMessage(message);
    
    if (message.message_type === 'private') {
      this.moduleLogger.info('📞 Emitting private_message event', { traceId });
      this.emit('private_message', message, eventData);
    } else if (message.message_type === 'group') {
      this.moduleLogger.info('👥 Emitting group_message event', { traceId, group_id: message.group_id });
      this.emit('group_message', message, eventData);
    }
    this.emit('message', message, eventData);
  }

  private normalizeMessage(message: QQMessage): QQMessage {
    // 只对私聊消息进行文本提取，群聊消息保持原始格式以保留@信息
    if (Array.isArray(message.message) && message.message_type === 'private') {
      message.message = this.extractTextFromMessageSegments(message.message as any);
    }
    // 群聊消息保持原始数组格式，这样@bot检测才能正常工作
    return message;
  }

  private extractTextFromMessageSegments(segments: any[]): string {
    return segments
      .filter(segment => segment.type === 'text')
      .map(segment => segment.data?.text || '')
      .join('')
      .trim();
  }

  private async handleQQNotice(notice: QQNotice, eventData?: any): Promise<void> {
    const traceId = eventData?.traceId;
    
    this.moduleLogger.info('🔔 Processing notice event', { 
      traceId,
      notice_type: notice.notice_type,
      user_id: notice.user_id,
      group_id: notice.group_id
    });
    
    this.emit('notice', notice, eventData);
    
    // 具体通知类型
    if (notice.notice_type === 'group_increase') {
      this.emit('group_member_increase', notice, eventData);
    } else if (notice.notice_type === 'group_decrease') {
      this.emit('group_member_decrease', notice, eventData);
    }
  }

  private async handleQQRequest(request: QQRequest, eventData?: any): Promise<void> {
    const traceId = eventData?.traceId;
    
    this.moduleLogger.info('📋 Processing request event', { 
      traceId,
      request_type: request.request_type,
      user_id: request.user_id,
      group_id: request.group_id
    });
    
    this.emit('request', request, eventData);
    
    if (request.request_type === 'friend') {
      this.emit('friend_request', request, eventData);
    } else if (request.request_type === 'group') {
      this.emit('group_request', request, eventData);
    }
  }

  private async handleQQMetaEvent(metaEvent: any, eventData?: any): Promise<void> {
    // 处理元事件（心跳、生命周期等）
    this.moduleLogger.debug('Received meta event', {
      meta_event_type: metaEvent.meta_event_type,
      sub_type: metaEvent.sub_type
    });
    
    switch (metaEvent.meta_event_type) {
      case 'heartbeat':
        // 心跳事件，更新连接状态
        if (metaEvent.status) {
          this.moduleLogger.debug('Heartbeat received', {
            online: metaEvent.status.online,
            good: metaEvent.status.good
          });
        }
        this.emit('heartbeat', metaEvent);
        break;
      case 'lifecycle':
        // 生命周期事件
        this.moduleLogger.info('Lifecycle event received', {
          sub_type: metaEvent.sub_type
        });
        this.emit('lifecycle', metaEvent);
        break;
      default:
        this.moduleLogger.debug('Unknown meta event type', {
          meta_event_type: metaEvent.meta_event_type
        });
    }
    
    this.emit('meta_event', metaEvent);
  }

  private isApiResponse(message: any): boolean {
    // API响应消息的特征：包含status和retcode字段，不包含post_type字段
    return (
      Object.prototype.hasOwnProperty.call(message, 'status') &&
      Object.prototype.hasOwnProperty.call(message, 'retcode') &&
      !Object.prototype.hasOwnProperty.call(message, 'post_type')
    );
  }

  private async handleApiResponse(response: any, traceId?: string | null): Promise<void> {
    // 处理API响应消息
    this.moduleLogger.debug('Received API response', {
      status: response.status,
      retcode: response.retcode,
      data: response.data,
      echo: response.echo
    });

    // 检查API调用是否成功
    if (response.status === 'ok' && response.retcode === 0) {
      this.moduleLogger.debug('API call successful', { data: response.data });
    } else {
      this.moduleLogger.warn('API call failed', {
        status: response.status,
        retcode: response.retcode,
        message: response.message || response.wording
      });
    }

    // 触发API响应事件
    this.emit('api_response', response);
  }

  private handleError(error: Error): void {
    this.moduleLogger.error('WebSocket error', { error });
    this.emit('error', error);
  }

  private handleClose(code: number, reason: Buffer): void {
    const reasonString = reason.toString();
    this.moduleLogger.warn('WebSocket connection closed', { code, reason: reasonString });
    
    this.isConnecting = false;
    this.ws = null;
    this.emit('disconnected', { code, reason: reasonString });

    if (!this.isManualClose && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    
    this.moduleLogger.info(`Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectInterval}ms`);
    
    setTimeout(() => {
      if (!this.isManualClose && !this.isConnected()) {
        this.connect().catch(error => {
          this.moduleLogger.error('Reconnect attempt failed', { error });
        });
      }
    }, this.reconnectInterval);
  }

  public isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  public async sendMessage(data: any, traceId?: string): Promise<void> {
    const startTime = Date.now();

    if (!this.isConnected()) {
      this.moduleLogger.warn('WebSocket not ready when sending message, waiting for reconnection', {
        traceId,
        action: data?.action,
        params: data?.params
      });

      await this.waitUntilConnected().catch(error => {
        throw new Error(
          `WebSocket is not connected and reconnection failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
    }

    try {
      const jsonData = JSON.stringify(data);
      this.ws!.send(jsonData);
      
      const processingTime = Date.now() - startTime;
      
      this.moduleLogger.info('Message sent to OneBot server', { 
        traceId,
        action: data.action, 
        params: data.params,
        processingTime
      });

      // 记录WebSocket发送日志
      if (this.loggingService) {
        try {
          await this.loggingService.logWebSocketMessage({
            traceId,
            direction: 'OUT',
            messageType: data.action || 'unknown_action',
            eventPriority: 'HIGH',
            rawPayload: data,
            processingTimeMs: processingTime,
            status: 'SUCCESS'
          });

          this.moduleLogger.info('📝 WebSocket OUT logged', { traceId, action: data.action });
        } catch (logError: unknown) {
          this.moduleLogger.error('Failed to log WebSocket OUT message', { 
            error: logError instanceof Error ? logError.message : String(logError), 
            traceId 
          });
        }
      }
    } catch (error: unknown) {
      const processingTime = Date.now() - startTime;
      
      this.moduleLogger.error('Failed to send message', { 
        traceId, 
        error: error instanceof Error ? error.message : String(error), 
        data, 
        processingTime 
      });

      // 记录错误发送日志
      if (this.loggingService) {
        try {
          await this.loggingService.logWebSocketMessage({
            traceId,
            direction: 'OUT',
            messageType: data.action || 'unknown_action',
            eventPriority: 'HIGH',
            rawPayload: data,
            processingTimeMs: processingTime,
            status: 'ERROR',
            errorMessage: error instanceof Error ? error.message : String(error)
          });
        } catch (logError: unknown) {
          this.moduleLogger.error('Failed to log WebSocket OUT error', { 
            error: logError instanceof Error ? logError.message : String(logError) 
          });
        }
      }

      throw error;
    }
  }

  // OneBot API 方法
  public async sendPrivateMessage(userId: number, message: string): Promise<void> {
    await this.sendMessage({
      action: 'send_private_msg',
      params: {
        user_id: userId,
        message: message
      }
    });
  }

  public async waitUntilConnected(timeoutMs: number = 10000): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    if (!this.isConnecting) {
      try {
        await this.connect();
      } catch (error) {
        throw new Error(
          `Failed to initiate WebSocket connection: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    await new Promise<void>((resolve, reject) => {
      const onConnected = () => {
        cleanup();
        resolve();
      };

      const onError = (err: unknown) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      const onDisconnected = (data: any) => {
        cleanup();
        const code = data?.code ?? 'unknown';
        const reason = data?.reason ?? 'no-reason';
        reject(new Error(`WebSocket disconnected while waiting: ${code} ${reason}`));
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for WebSocket connection'));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        this.removeListener('connected', onConnected);
        this.removeListener('error', onError);
        this.removeListener('disconnected', onDisconnected);
      };

      this.once('connected', onConnected);
      this.once('error', onError);
      this.once('disconnected', onDisconnected);

      if (this.isConnected()) {
        cleanup();
        resolve();
      }
    });
  }

  public async sendGroupMessage(groupId: number, message: string): Promise<void> {
    await this.sendMessage({
      action: 'send_group_msg',
      params: {
        group_id: groupId,
        message: message
      }
    });
  }

  public async sendReplyMessage(messageId: number, message: string): Promise<void> {
    await this.sendMessage({
      action: 'send_msg',
      params: {
        message: `[CQ:reply,id=${messageId}]${message}`
      }
    });
  }

  public async sendAtMessage(groupId: number, userId: number, message: string): Promise<void> {
    await this.sendMessage({
      action: 'send_group_msg',
      params: {
        group_id: groupId,
        message: `[CQ:at,qq=${userId}] ${message}`
      }
    });
  }

  public async deleteMessage(messageId: number): Promise<void> {
    await this.sendMessage({
      action: 'delete_msg',
      params: {
        message_id: messageId
      }
    });
  }

  public async getGroupList(): Promise<any> {
    await this.sendMessage({
      action: 'get_group_list'
    });
  }

  public async getGroupMemberList(groupId: number): Promise<any> {
    await this.sendMessage({
      action: 'get_group_member_list',
      params: {
        group_id: groupId
      }
    });
  }

  public async setFriendAddRequest(flag: string, approve: boolean, remark?: string): Promise<void> {
    await this.sendMessage({
      action: 'set_friend_add_request',
      params: {
        flag,
        approve,
        remark
      }
    });
  }

  public async setGroupAddRequest(flag: string, subType: string, approve: boolean, reason?: string): Promise<void> {
    await this.sendMessage({
      action: 'set_group_add_request',
      params: {
        flag,
        sub_type: subType,
        approve,
        reason
      }
    });
  }

  public close(): void {
    this.isManualClose = true;
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.moduleLogger.info('WebSocket connection manually closed');
    this.emit('manual_close');
  }

  public getConnectionInfo(): any {
    return {
      connected: this.isConnected(),
      connecting: this.isConnecting,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      config: {
        host: this.config.host,
        port: this.config.port,
        uri: this.config.uri.replace(this.config.access_token, '***')
      }
    };
  }
}

export default WebSocketClient;

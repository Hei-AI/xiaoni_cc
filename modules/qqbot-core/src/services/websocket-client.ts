import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { WebSocketConfig, QQMessage, QQNotice, QQRequest, WebSocketEvent } from '../types';
import { logger } from '../utils/logger';

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

  constructor(config: WebSocketConfig) {
    super();
    this.config = config;
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

    } catch (error) {
      this.isConnecting = false;
      this.moduleLogger.error('Failed to create WebSocket connection', { error });
      throw error;
    }
  }

  private handleOpen(): void {
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.moduleLogger.info('WebSocket connection established');
    this.emit('connected');
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString()) as WebSocketMessage;
      this.moduleLogger.info('🔍 WebSocket message received', { 
        post_type: message.post_type, 
        message_type: message.message_type,
        user_id: message.user_id,
        group_id: message.group_id,
        raw: JSON.stringify(message).substring(0, 500) + (JSON.stringify(message).length > 500 ? '...' : '')
      });

      // 对于群聊消息，显示完整的JSON结构
      if (message.post_type === 'message' && message.message_type === 'group') {
        this.moduleLogger.info('📄 Complete group message JSON:', {
          fullMessage: JSON.stringify(message, null, 2)
        });
      }

      // 检查是否是API响应消息
      if (this.isApiResponse(message)) {
        this.handleApiResponse(message as any);
        return;
      }

      // 根据消息类型分发事件
      switch (message.post_type) {
        case 'message':
          this.moduleLogger.info('📨 Processing message event', { 
            message_type: message.message_type,
            user_id: message.user_id,
            group_id: message.group_id
          });
          this.handleQQMessage(message as unknown as QQMessage);
          break;
        case 'message_sent':
          this.emit('message_sent', message);
          break;
        case 'notice':
          this.handleQQNotice(message as unknown as QQNotice);
          break;
        case 'request':
          this.handleQQRequest(message as unknown as QQRequest);
          break;
        case 'meta_event':
          this.handleQQMetaEvent(message as unknown as any);
          break;
        default:
          this.moduleLogger.warn('Unknown message type', { 
            type: message.post_type, 
            message: JSON.stringify(message).substring(0, 500) 
          });
      }

      this.emit('raw_message', message);
    } catch (error) {
      this.moduleLogger.error('Failed to parse WebSocket message', { error, data: data.toString() });
    }
  }

  private handleQQMessage(message: QQMessage): void {
    this.moduleLogger.info('🎯 handleQQMessage called', { 
      message_type: message.message_type,
      user_id: message.user_id,
      group_id: message.group_id,
      message: typeof message.message === 'string' ? message.message.substring(0, 100) : JSON.stringify(message.message).substring(0, 100)
    });
    
    // 处理OneBot消息段格式
    message = this.normalizeMessage(message);
    
    if (message.message_type === 'private') {
      this.moduleLogger.info('📞 Emitting private_message event');
      this.emit('private_message', message);
    } else if (message.message_type === 'group') {
      this.moduleLogger.info('👥 Emitting group_message event', { group_id: message.group_id });
      this.emit('group_message', message);
    }
    this.emit('message', message);
  }

  private normalizeMessage(message: QQMessage): QQMessage {
    // 如果message是数组格式（OneBot消息段），转换为字符串
    if (Array.isArray(message.message)) {
      message.message = this.extractTextFromMessageSegments(message.message as any);
    }
    return message;
  }

  private extractTextFromMessageSegments(segments: any[]): string {
    return segments
      .filter(segment => segment.type === 'text')
      .map(segment => segment.data?.text || '')
      .join('')
      .trim();
  }

  private handleQQNotice(notice: QQNotice): void {
    this.emit('notice', notice);
    
    // 具体通知类型
    if (notice.notice_type === 'group_increase') {
      this.emit('group_member_increase', notice);
    } else if (notice.notice_type === 'group_decrease') {
      this.emit('group_member_decrease', notice);
    }
  }

  private handleQQRequest(request: QQRequest): void {
    this.emit('request', request);
    
    if (request.request_type === 'friend') {
      this.emit('friend_request', request);
    } else if (request.request_type === 'group') {
      this.emit('group_request', request);
    }
  }

  private handleQQMetaEvent(metaEvent: any): void {
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

  private handleApiResponse(response: any): void {
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

  public async sendMessage(data: any): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('WebSocket is not connected');
    }

    try {
      const jsonData = JSON.stringify(data);
      this.ws!.send(jsonData);
      this.moduleLogger.info('Message sent to OneBot server', { action: data.action, params: data.params });
    } catch (error) {
      this.moduleLogger.error('Failed to send message', { error, data });
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
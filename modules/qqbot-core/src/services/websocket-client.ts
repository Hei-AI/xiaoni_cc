import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import axios from 'axios';
import {
  WebSocketConfig,
  QQMessage,
  QQNotice,
  QQRequest,
  WebSocketEvent,
  MessageContentType,
  OB11Segment,
  MessageAttachment
} from '../types';
import { logger } from '../utils/logger';
import { LoggingService } from './logging-service';
import { DatabaseManager } from './database';
import { createEventContext } from '../utils/trace-strategy';
import {
  extractAttachmentsFromSegments,
  extractTextFromSegments,
  buildAttachmentHints,
  resolveAttachmentsFromMessage
} from '../utils/message-utils';

interface WebSocketMessage extends WebSocketEvent {
  message?: string;
  user_id?: number;
  group_id?: number;
  message_type?: 'private' | 'group';
}

interface SendMessageRecordOptions {
  traceId?: string;
  conversationId?: string;
  messageId?: number;
  contentType?: MessageContentType;
  rawPayload?: any;
  sentAt?: Date;
}

interface LocalAttachmentPayload {
  type: 'image' | 'face';
  mimeType: string;
  base64: string;
  originalName?: string;
  source: Record<string, any>;
}

interface ExtractedImageData {
  base64: string;
  mimeType: string;
  source: Record<string, any>;
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
  private database?: DatabaseManager;
  private botQQNumber?: number;

  constructor(
    config: WebSocketConfig,
    loggingService?: LoggingService,
    database?: DatabaseManager,
    botQQNumber?: number
  ) {
    super();
    this.config = config;
    this.loggingService = loggingService ?? null;
    this.database = database;
    this.botQQNumber = botQQNumber;
  }

  private async attachLocalMediaMetadata(message: QQMessage): Promise<void> {
    try {
      const segments = Array.isArray(message.segments)
        ? message.segments
        : Array.isArray(message.message)
          ? (message.message as OB11Segment[])
          : undefined;

      const derivedAttachments = Array.isArray(message.attachments)
        ? (message.attachments as MessageAttachment[])
        : undefined;

      const localAttachments: Array<Record<string, any>> = [];

      const pushAttachment = (payload?: LocalAttachmentPayload | null) => {
        if (!payload || !payload.base64) {
          return;
        }

        const normalizedType = payload.type === 'face' ? 'image' : payload.type;
        localAttachments.push({
          type: normalizedType,
          mimeType: payload.mimeType,
          base64: payload.base64,
          originalName: payload.originalName,
          source: payload.source,
          saved_at: new Date().toISOString()
        });
      };

      const collectFromSegment = async (
        segment: OB11Segment,
        originalName?: string
      ): Promise<void> => {
        if (segment.type !== 'image' && segment.type !== 'face') {
          return;
        }

        const media = await this.extractSegmentImageData(segment);
        if (!media) {
          return;
        }

        pushAttachment({
          type: segment.type,
          mimeType: media.mimeType,
          base64: media.base64,
          originalName,
          source: {
            ...media.source,
            file: segment.data?.file,
            url: segment.data?.url
          }
        });
      };

      if (segments && segments.length > 0) {
        for (const segment of segments) {
          const originalName =
            segment.data?.file || segment.data?.name || segment.data?.filename;
          await collectFromSegment(segment, originalName);
        }
      } else if (derivedAttachments) {
        for (const attachment of derivedAttachments) {
          if (attachment.type !== 'image') {
            continue;
          }

          const pseudoSegment: OB11Segment = {
            type: 'image',
            data: attachment.data ?? {}
          };

          await collectFromSegment(
            pseudoSegment,
            attachment.data?.file || attachment.data?.name
          );
        }
      }

      const rawPayloadAttachments = await this.collectImageAttachmentsFromRawPayload(message);
      rawPayloadAttachments.forEach(pushAttachment);

      if (localAttachments.length > 0) {
        (message as any).local_attachments = localAttachments;
      }
    } catch (error) {
      this.moduleLogger.warn('Failed to enrich message with local media metadata', {
        error: error instanceof Error ? error.message : String(error),
        messageId: message.message_id
      });
    }
  }

  private async collectImageAttachmentsFromRawPayload(
    message: QQMessage
  ): Promise<LocalAttachmentPayload[]> {
    const rawPayload = (message as any)?.raw ?? (message as any)?.raw_payload;
    const elements = this.extractRawElements(rawPayload);

    if (elements.length === 0) {
      return [];
    }

    const attachments: LocalAttachmentPayload[] = [];
    const seen = new Set<string>();

    for (const element of elements) {
      const picElement = element?.picElement || element?.pic_element;
      if (!picElement) {
        continue;
      }

      const dedupeKey =
        picElement.fileUuid ||
        picElement.file_uuid ||
        picElement.fileName ||
        picElement.file_name;

      if (dedupeKey && seen.has(dedupeKey)) {
        continue;
      }

      const resolved = await this.resolveImageFromPicElement(picElement);
      if (!resolved) {
        continue;
      }

      if (dedupeKey) {
        seen.add(dedupeKey);
      }

      attachments.push(resolved);
    }

    return attachments;
  }

  private async resolveImageFromPicElement(picElement: any): Promise<LocalAttachmentPayload | null> {
    if (!picElement || typeof picElement !== 'object') {
      return null;
    }

    const originalName = picElement.fileName || picElement.file_name;

    const originUrl =
      typeof picElement.originImageUrl === 'string'
        ? picElement.originImageUrl
        : typeof picElement.origin_image_url === 'string'
          ? picElement.origin_image_url
          : undefined;

    const fallbackUrl =
      typeof picElement.url === 'string' ? picElement.url : undefined;

    const sourceBase: Record<string, any> = {
      type: 'raw_payload',
      file: originalName,
      file_uuid: picElement.fileUuid || picElement.file_uuid,
      origin_url: originUrl,
      url: fallbackUrl
    };

    const mimeType = this.resolveMimeType(
      picElement.mimeType || picElement.mime_type,
      originalName
    );

    const base64Candidates = [
      picElement.originImageBase64,
      picElement.origin_image_base64,
      picElement.base64,
      picElement.picBuf,
      picElement.pic_buf,
      picElement.bytes,
      picElement.data
    ];

    for (const candidate of base64Candidates) {
      const normalized = this.normalizeBase64String(candidate);
      if (normalized) {
        return {
          type: 'image',
          mimeType,
          base64: normalized,
          originalName,
          source: {
            ...sourceBase,
            method: 'raw.base64'
          }
        };
      }
    }

    if (originUrl) {
      const downloaded = await this.downloadImageAsBase64(originUrl, {
        successLog: 'Downloaded image from origin url'
      });
      if (downloaded) {
        return {
          type: 'image',
          mimeType: downloaded.mimeType || mimeType,
          base64: downloaded.base64,
          originalName,
          source: {
            ...sourceBase,
            method: 'raw.origin_url',
            url: originUrl
          }
        };
      }
    }

    if (fallbackUrl) {
      const downloaded = await this.downloadImageAsBase64(fallbackUrl);
      if (downloaded) {
        return {
          type: 'image',
          mimeType: downloaded.mimeType || mimeType,
          base64: downloaded.base64,
          originalName,
          source: {
            ...sourceBase,
            method: 'raw.url',
            url: fallbackUrl
          }
        };
      }
    }

    const sourcePath = this.resolveSourcePath(picElement);
    if (sourcePath) {
      const base64 = await this.readLocalFileAsBase64(sourcePath);
      if (base64) {
        return {
          type: 'image',
          mimeType,
          base64,
          originalName,
          source: {
            ...sourceBase,
            method: 'raw.source_path',
            path: sourcePath
          }
        };
      }
    }

    return null;
  }

  private extractRawElements(rawPayload: any): any[] {
    if (!rawPayload) {
      return [];
    }

    let payload = rawPayload;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch (error) {
        this.moduleLogger.debug('Failed to parse raw payload for image extraction', {
          error: error instanceof Error ? error.message : String(error)
        });
        return [];
      }
    }

    if (Array.isArray(payload)) {
      return payload;
    }

    if (Array.isArray(payload.elements)) {
      return payload.elements;
    }

    if (payload.msgBody && Array.isArray(payload.msgBody.elements)) {
      return payload.msgBody.elements;
    }

    if (payload.message && Array.isArray(payload.message.elements)) {
      return payload.message.elements;
    }

    if (payload.commonElem && Array.isArray(payload.commonElem.elements)) {
      return payload.commonElem.elements;
    }

    return [];
  }

  private resolveSourcePath(picElement: any): string | undefined {
    if (!picElement || typeof picElement !== 'object') {
      return undefined;
    }

    const candidates = [
      picElement.sourcePath,
      picElement.source_path,
      picElement.originImagePath,
      picElement.origin_image_path,
      picElement.filePath,
      picElement.file_path
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    return undefined;
  }

  private async readLocalFileAsBase64(filePath?: string): Promise<string | null> {
    if (!filePath || typeof filePath !== 'string') {
      return null;
    }

    const normalizedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    try {
      const buffer = await fs.readFile(normalizedPath);
      return buffer.toString('base64');
    } catch (error) {
      this.moduleLogger.warn('Failed to read local image source', {
        error: error instanceof Error ? error.message : String(error),
        filePath: normalizedPath
      });
      return null;
    }
  }

  private async downloadImageAsBase64(
    url: string,
    options?: { successLog?: string; context?: string }
  ): Promise<{ base64: string; mimeType?: string } | null> {
    if (!url || typeof url !== 'string') {
      return null;
    }

    try {
      const response = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: 10000
      });

      const buffer = Buffer.from(response.data);
      const base64 = buffer.toString('base64');
      const mimeType = response.headers['content-type'] as string | undefined;

      if (options?.successLog) {
        this.moduleLogger.info(options.successLog, {
          url,
          context: options.context
        });
      }

      return {
        base64,
        mimeType
      };
    } catch (error) {
      this.moduleLogger.warn('Failed to download image attachment', {
        error: error instanceof Error ? error.message : String(error),
        url,
        context: options?.context
      });
      return null;
    }
  }

  private async extractSegmentImageData(
    segment: OB11Segment
  ): Promise<ExtractedImageData | null> {
    const data = segment.data ?? {};

    const explicitBase64 = this.normalizeBase64String(data.base64);
    if (explicitBase64) {
      return {
        base64: explicitBase64,
        mimeType: this.resolveMimeType(
          data.mime || data.mimetype || data.content_type,
          data.file || data.name
        ),
        source: {
          type: 'segment',
          method: 'segment.base64'
        }
      };
    }

    if (typeof data.url === 'string' && data.url.length > 0) {
      const downloaded = await this.downloadImageAsBase64(data.url, {
        context: 'segment.url'
      });

      if (downloaded) {
        return {
          base64: downloaded.base64,
          mimeType: downloaded.mimeType || this.resolveMimeType(undefined, data.file || data.name),
          source: {
            type: 'segment',
            method: 'segment.url',
            url: data.url
          }
        };
      }
    }

    return null;
  }

  private resolveMimeType(explicit?: string, fileName?: string): string {
    if (explicit && explicit.includes('/')) {
      const normalized = explicit.trim();
      if (normalized.startsWith('data:')) {
        const semicolonIndex = normalized.indexOf(';');
        if (semicolonIndex > -1) {
          return normalized.slice(5, semicolonIndex);
        }
        return normalized.slice(5);
      }
      return normalized;
    }

    if (fileName) {
      const ext = path.extname(fileName).toLowerCase();
      switch (ext) {
        case '.jpg':
        case '.jpeg':
          return 'image/jpeg';
        case '.gif':
          return 'image/gif';
        case '.webp':
          return 'image/webp';
        case '.bmp':
          return 'image/bmp';
        case '.svg':
          return 'image/svg+xml';
        case '.heic':
        case '.heif':
          return 'image/heic';
        case '.png':
          return 'image/png';
        default:
          break;
      }
    }

    return 'image/png';
  }


  private normalizeBase64String(base64?: unknown): string | undefined {
    if (!base64) {
      return undefined;
    }

    if (Buffer.isBuffer(base64)) {
      return base64.toString('base64');
    }

    if (typeof base64 !== 'string') {
      return undefined;
    }

    const trimmed = base64.trim();
    if (trimmed.startsWith('data:')) {
      const commaIndex = trimmed.indexOf(',');
      if (commaIndex !== -1) {
        return trimmed.slice(commaIndex + 1);
      }
    }

    return trimmed.length > 0 ? trimmed : undefined;
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

      if (message.post_type === 'message') {
        await this.recordIncomingMessageHistory(message as QQMessage, traceId);
      }

      // 检查是否是API响应消息
      if (this.isApiResponse(message)) {
        await this.handleApiResponse(message as any);
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
          await this.handleQQMetaEvent(message as unknown as any);
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
    if (Array.isArray(message.message)) {
      const segments = message.message;
      message.segments = segments;
      const attachments = extractAttachmentsFromSegments(segments);
      if (attachments.length > 0) {
        message.attachments = attachments;
      }

      if (message.message_type === 'private') {
        message.message = extractTextFromSegments(segments);
      }
    }

    return message;
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

  private async handleQQMetaEvent(metaEvent: any): Promise<void> {
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

  private async handleApiResponse(response: any): Promise<void> {
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

  public async sendMessage(data: any, traceId?: string, options?: SendMessageRecordOptions): Promise<void> {
    const startTime = Date.now();
    const effectiveTraceId = options?.traceId || traceId;
    const deliveryStartTime = new Date(startTime);

    if (this.loggingService && effectiveTraceId) {
      await this.loggingService.logEventStart(
        effectiveTraceId,
        'delivery',
        'delivery.send_message',
        options?.conversationId,
        {
          action: data?.action,
          params: data?.params
        }
      );
    }

    if (!this.isConnected()) {
      this.moduleLogger.warn('WebSocket not ready when sending message, waiting for reconnection', {
        traceId: effectiveTraceId,
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
        traceId: effectiveTraceId,
        action: data.action, 
        params: data.params,
        processingTime
      });

      // 记录WebSocket发送日志
      if (this.loggingService) {
        try {
          await this.loggingService.logWebSocketMessage({
            traceId: effectiveTraceId,
            direction: 'OUT',
            messageType: data.action || 'unknown_action',
            eventPriority: 'HIGH',
            rawPayload: data,
            processingTimeMs: processingTime,
            status: 'SUCCESS'
          });

          if (effectiveTraceId) {
            await this.loggingService.logEventEnd(
              effectiveTraceId,
              'delivery',
              'delivery.send_message',
              deliveryStartTime,
              options?.conversationId,
              {
                action: data?.action,
                status: 'success'
              }
            );
          }

          this.moduleLogger.info('📝 WebSocket OUT logged', { traceId: effectiveTraceId, action: data.action });
        } catch (logError: unknown) {
          this.moduleLogger.error('Failed to log WebSocket OUT message', { 
            error: logError instanceof Error ? logError.message : String(logError), 
            traceId: effectiveTraceId 
          });
        }
      }
    } catch (error: unknown) {
      const processingTime = Date.now() - startTime;
      
      this.moduleLogger.error('Failed to send message', { 
        traceId: effectiveTraceId, 
        error: error instanceof Error ? error.message : String(error), 
        data, 
        processingTime 
      });

      // 记录错误发送日志
      if (this.loggingService) {
        try {
          await this.loggingService.logWebSocketMessage({
            traceId: effectiveTraceId,
            direction: 'OUT',
            messageType: data.action || 'unknown_action',
            eventPriority: 'HIGH',
            rawPayload: data,
            processingTimeMs: processingTime,
            status: 'ERROR',
            errorMessage: error instanceof Error ? error.message : String(error)
          });
          await this.loggingService.logEventEnd(
            effectiveTraceId || `delivery-${Date.now()}`,
            'delivery',
            'delivery.send_message',
            deliveryStartTime,
            options?.conversationId,
            {
              action: data?.action,
              status: 'error',
              error_message: error instanceof Error ? error.message : String(error)
            }
          );
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
  public async sendPrivateMessage(
    userId: number,
    message: string,
    options?: SendMessageRecordOptions
  ): Promise<void> {
    await this.sendMessage({
      action: 'send_private_msg',
      params: {
        user_id: userId,
        message: message
      }
    }, options?.traceId, options);

    await this.recordBotPrivateMessage(userId, message, options);
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

  public async sendGroupMessage(
    groupId: number,
    message: string,
    options?: SendMessageRecordOptions
  ): Promise<void> {
    await this.sendMessage({
      action: 'send_group_msg',
      params: {
        group_id: groupId,
        message: message
      }
    }, options?.traceId, options);

    await this.recordBotGroupMessage(groupId, message, options);
  }

  public async sendReplyMessage(
    messageId: number,
    message: string,
    options?: SendMessageRecordOptions & { groupId?: number; userId?: number }
  ): Promise<void> {
    const finalMessage = `[CQ:reply,id=${messageId}]${message}`;

    await this.sendMessage({
      action: 'send_msg',
      params: {
        message: finalMessage
      }
    });

    const payloadOptions: SendMessageRecordOptions = {
      ...options,
      rawPayload: options?.rawPayload ?? {
        message: finalMessage,
        reply_to: messageId
      }
    };

    if (options?.groupId) {
      await this.recordBotGroupMessage(options.groupId, finalMessage, payloadOptions);
    } else if (options?.userId) {
      await this.recordBotPrivateMessage(options.userId, finalMessage, payloadOptions);
    }
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

  private async recordBotPrivateMessage(
    userId: number,
    message: string,
    options?: SendMessageRecordOptions
  ): Promise<void> {
    if (!this.database) {
      return;
    }

    if (!this.botQQNumber) {
      this.moduleLogger.warn('Bot QQ number not configured, skip private history record');
      return;
    }

    const contentType =
      options?.contentType ?? this.detectContentTypeFromString(message);
    const sentAt = options?.sentAt ?? new Date();

    try {
      await this.database.savePrivateMessageHistory({
        conversation_id: options?.conversationId ?? null,
        message_id: options?.messageId ?? null,
        user_id: userId,
        sender_id: this.botQQNumber,
        sender_role: 'bot',
        content_type: contentType,
        content: message,
        raw_payload: options?.rawPayload ?? { message },
        sent_at: sentAt
      });
    } catch (error) {
      this.moduleLogger.warn('Failed to record private message history', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        conversationId: options?.conversationId
      });
    }
  }

  private async recordBotGroupMessage(
    groupId: number,
    message: string,
    options?: SendMessageRecordOptions
  ): Promise<void> {
    if (!this.database) {
      return;
    }

    if (!this.botQQNumber) {
      this.moduleLogger.warn('Bot QQ number not configured, skip group history record');
      return;
    }

    const contentType =
      options?.contentType ?? this.detectContentTypeFromString(message);
    const sentAt = options?.sentAt ?? new Date();

    try {
      await this.database.saveGroupMessageHistory({
        conversation_id: options?.conversationId ?? null,
        message_id: options?.messageId ?? null,
        group_id: groupId,
        sender_id: this.botQQNumber,
        sender_role: 'bot',
        content_type: contentType,
        content: message,
        raw_payload: options?.rawPayload ?? { message },
        sent_at: sentAt
      });
    } catch (error) {
      this.moduleLogger.warn('Failed to record group message history', {
        error: error instanceof Error ? error.message : String(error),
        groupId,
        conversationId: options?.conversationId
      });
    }
  }

  private async recordIncomingMessageHistory(
    message: QQMessage,
    traceId?: string | null
  ): Promise<void> {
    if (!this.database) {
      return;
    }

    if (message.post_type !== 'message') {
      return;
    }

    if (this.botQQNumber && message.user_id === this.botQQNumber) {
      return;
    }

    const sentAt =
      typeof message.time === 'number'
        ? new Date(message.time * 1000)
        : new Date();
    const contentType = this.determineIncomingContentType(message);
    const readableContent = this.buildReadableContent(message);

    await this.attachLocalMediaMetadata(message);

    try {
      if (message.message_type === 'private') {
        await this.database.savePrivateMessageHistory({
          conversation_id: null,
          message_id: message.message_id,
          user_id: message.user_id,
          sender_id: message.user_id,
          sender_role: 'user',
          content_type: contentType,
          content: readableContent,
          raw_payload: message,
          sent_at: sentAt
        });
      } else if (message.message_type === 'group' && message.group_id) {
        await this.database.saveGroupMessageHistory({
          conversation_id: null,
          message_id: message.message_id,
          group_id: message.group_id,
          sender_id: message.user_id,
          sender_role: 'user',
          content_type: contentType,
          content: readableContent,
          raw_payload: message,
          sent_at: sentAt
        });
      }
    } catch (error) {
      this.moduleLogger.warn('Failed to record incoming message history', {
        error: error instanceof Error ? error.message : String(error),
        traceId,
        messageId: message.message_id,
        messageType: message.message_type
      });
    }
  }

  private buildReadableContent(message: QQMessage): string {
    let baseText = '';

    if (typeof message.raw_message === 'string' && message.raw_message.trim().length > 0) {
      baseText = message.raw_message.trim();
    } else if (typeof message.message === 'string') {
      baseText = message.message.trim();
    } else if (Array.isArray(message.message)) {
      baseText = extractTextFromSegments(message.message);
    }

    const attachments = resolveAttachmentsFromMessage(message);
    const hints = buildAttachmentHints(attachments);

    return [baseText, ...hints]
      .filter(part => typeof part === 'string' && part.trim().length > 0)
      .join(' ')
      .trim();
  }

  private determineIncomingContentType(message: QQMessage): MessageContentType {
    if (Array.isArray(message.message)) {
      const segments = message.message;
      if (segments.some(segment => segment.type === 'image')) {
        return 'image';
      }
      if (segments.some(segment => segment.type === 'video')) {
        return 'video';
      }
      if (
        segments.some(
          segment => segment.type === 'record' || segment.type === 'audio' || segment.type === 'voice'
        )
      ) {
        return 'audio';
      }
    }

    const attachments = resolveAttachmentsFromMessage(message);
    if (attachments.some(attachment => attachment.type === 'image')) {
      return 'image';
    }
    if (attachments.some(attachment => attachment.type === 'video')) {
      return 'video';
    }
    if (
      attachments.some(
        attachment =>
          attachment.type === 'record' ||
          attachment.type === 'audio' ||
          attachment.type === 'voice'
      )
    ) {
      return 'audio';
    }

    const raw =
      (typeof message.raw_message === 'string' && message.raw_message) ||
      (typeof message.message === 'string' ? message.message : '');

    return this.detectContentTypeFromString(raw);
  }

  private detectContentTypeFromString(text: string): MessageContentType {
    if (!text) {
      return 'text';
    }

    if (/\[CQ:image/.test(text)) {
      return 'image';
    }

    if (/\[CQ:video/.test(text)) {
      return 'video';
    }

    if (/\[CQ:(record|audio|voice)/.test(text)) {
      return 'audio';
    }

    return 'text';
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

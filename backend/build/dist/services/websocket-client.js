"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketClient = void 0;
const ws_1 = __importDefault(require("ws"));
const events_1 = require("events");
const logger_1 = require("../utils/logger");
class WebSocketClient extends events_1.EventEmitter {
    constructor(config) {
        super();
        this.ws = null;
        this.moduleLogger = logger_1.logger.createModuleLogger('websocket');
        this.reconnectInterval = 5000;
        this.maxReconnectAttempts = 10;
        this.reconnectAttempts = 0;
        this.isConnecting = false;
        this.isManualClose = false;
        this.config = config;
    }
    async connect() {
        if (this.isConnecting) {
            this.moduleLogger.warn('Already connecting, skipping duplicate connection attempt');
            return;
        }
        this.isConnecting = true;
        this.isManualClose = false;
        try {
            this.moduleLogger.info(`Connecting to WebSocket: ${this.config.uri}`);
            this.ws = new ws_1.default(this.config.uri);
            this.ws.on('open', this.handleOpen.bind(this));
            this.ws.on('message', this.handleMessage.bind(this));
            this.ws.on('error', this.handleError.bind(this));
            this.ws.on('close', this.handleClose.bind(this));
        }
        catch (error) {
            this.isConnecting = false;
            this.moduleLogger.error('Failed to create WebSocket connection', { error });
            throw error;
        }
    }
    handleOpen() {
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.moduleLogger.info('WebSocket connection established');
        this.emit('connected');
    }
    handleMessage(data) {
        try {
            const message = JSON.parse(data.toString());
            this.moduleLogger.debug('Received message', { message });
            // 检查是否是API响应消息
            if (this.isApiResponse(message)) {
                this.handleApiResponse(message);
                return;
            }
            // 根据消息类型分发事件
            switch (message.post_type) {
                case 'message':
                    this.handleQQMessage(message);
                    break;
                case 'message_sent':
                    this.emit('message_sent', message);
                    break;
                case 'notice':
                    this.handleQQNotice(message);
                    break;
                case 'request':
                    this.handleQQRequest(message);
                    break;
                case 'meta_event':
                    this.handleQQMetaEvent(message);
                    break;
                default:
                    this.moduleLogger.warn('Unknown message type', {
                        type: message.post_type,
                        message: JSON.stringify(message).substring(0, 500)
                    });
            }
            this.emit('raw_message', message);
        }
        catch (error) {
            this.moduleLogger.error('Failed to parse WebSocket message', { error, data: data.toString() });
        }
    }
    handleQQMessage(message) {
        // 处理OneBot消息段格式
        message = this.normalizeMessage(message);
        if (message.message_type === 'private') {
            this.emit('private_message', message);
        }
        else if (message.message_type === 'group') {
            this.emit('group_message', message);
        }
        this.emit('message', message);
    }
    normalizeMessage(message) {
        // 如果message是数组格式（OneBot消息段），转换为字符串
        if (Array.isArray(message.message)) {
            message.message = this.extractTextFromMessageSegments(message.message);
        }
        return message;
    }
    extractTextFromMessageSegments(segments) {
        return segments
            .filter(segment => segment.type === 'text')
            .map(segment => segment.data?.text || '')
            .join('')
            .trim();
    }
    handleQQNotice(notice) {
        this.emit('notice', notice);
        // 具体通知类型
        if (notice.notice_type === 'group_increase') {
            this.emit('group_member_increase', notice);
        }
        else if (notice.notice_type === 'group_decrease') {
            this.emit('group_member_decrease', notice);
        }
    }
    handleQQRequest(request) {
        this.emit('request', request);
        if (request.request_type === 'friend') {
            this.emit('friend_request', request);
        }
        else if (request.request_type === 'group') {
            this.emit('group_request', request);
        }
    }
    handleQQMetaEvent(metaEvent) {
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
    isApiResponse(message) {
        // API响应消息的特征：包含status和retcode字段，不包含post_type字段
        return (Object.prototype.hasOwnProperty.call(message, 'status') &&
            Object.prototype.hasOwnProperty.call(message, 'retcode') &&
            !Object.prototype.hasOwnProperty.call(message, 'post_type'));
    }
    handleApiResponse(response) {
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
        }
        else {
            this.moduleLogger.warn('API call failed', {
                status: response.status,
                retcode: response.retcode,
                message: response.message || response.wording
            });
        }
        // 触发API响应事件
        this.emit('api_response', response);
    }
    handleError(error) {
        this.moduleLogger.error('WebSocket error', { error });
        this.emit('error', error);
    }
    handleClose(code, reason) {
        const reasonString = reason.toString();
        this.moduleLogger.warn('WebSocket connection closed', { code, reason: reasonString });
        this.isConnecting = false;
        this.ws = null;
        this.emit('disconnected', { code, reason: reasonString });
        if (!this.isManualClose && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
        }
    }
    scheduleReconnect() {
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
    isConnected() {
        return this.ws?.readyState === ws_1.default.OPEN;
    }
    async sendMessage(data) {
        if (!this.isConnected()) {
            throw new Error('WebSocket is not connected');
        }
        try {
            const jsonData = JSON.stringify(data);
            this.ws.send(jsonData);
            this.moduleLogger.info('Message sent to OneBot server', { action: data.action, params: data.params });
        }
        catch (error) {
            this.moduleLogger.error('Failed to send message', { error, data });
            throw error;
        }
    }
    // OneBot API 方法
    async sendPrivateMessage(userId, message) {
        await this.sendMessage({
            action: 'send_private_msg',
            params: {
                user_id: userId,
                message: message
            }
        });
    }
    async sendGroupMessage(groupId, message) {
        await this.sendMessage({
            action: 'send_group_msg',
            params: {
                group_id: groupId,
                message: message
            }
        });
    }
    async sendReplyMessage(messageId, message) {
        await this.sendMessage({
            action: 'send_msg',
            params: {
                message: `[CQ:reply,id=${messageId}]${message}`
            }
        });
    }
    async sendAtMessage(groupId, userId, message) {
        await this.sendMessage({
            action: 'send_group_msg',
            params: {
                group_id: groupId,
                message: `[CQ:at,qq=${userId}] ${message}`
            }
        });
    }
    async deleteMessage(messageId) {
        await this.sendMessage({
            action: 'delete_msg',
            params: {
                message_id: messageId
            }
        });
    }
    async getGroupList() {
        await this.sendMessage({
            action: 'get_group_list'
        });
    }
    async getGroupMemberList(groupId) {
        await this.sendMessage({
            action: 'get_group_member_list',
            params: {
                group_id: groupId
            }
        });
    }
    async setFriendAddRequest(flag, approve, remark) {
        await this.sendMessage({
            action: 'set_friend_add_request',
            params: {
                flag,
                approve,
                remark
            }
        });
    }
    async setGroupAddRequest(flag, subType, approve, reason) {
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
    close() {
        this.isManualClose = true;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.moduleLogger.info('WebSocket connection manually closed');
        this.emit('manual_close');
    }
    getConnectionInfo() {
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
exports.WebSocketClient = WebSocketClient;
exports.default = WebSocketClient;
//# sourceMappingURL=websocket-client.js.map
import { EventEmitter } from 'events';
import { DatabaseManager } from './database';
import { QQMessage, OB11Segment } from '../types';
export interface SessionContext {
    session_id: string;
    user_id: number;
    session_type: 'chat' | 'requirement' | 'mixed';
    current_service: string;
    status: 'active' | 'paused' | 'completed' | 'expired';
    created_at: Date;
    last_activity: Date;
    expires_at: Date;
    conversation_context: Record<string, any>;
    business_context: Record<string, any>;
    message_count: number;
    service_transitions: ServiceTransition[];
    recent_messages: MessageRecord[];
}
export interface ServiceTransition {
    from_service: string;
    to_service: string;
    timestamp: Date;
    trigger: 'USER_REQUEST' | 'AUTO_DETECT' | 'TIMEOUT';
    confidence: number;
}
export interface MessageRecord {
    message_id: string;
    timestamp: Date;
    direction: 'IN' | 'OUT';
    content: string;
    service: string;
    intent_score?: number;
}
export interface ReplyInfo {
    reply_to_message_id: string;
    original_text: string;
    segments: OB11Segment[];
}
export interface IntentResult {
    session_type: 'chat' | 'requirement';
    confidence: number;
    method: string;
    reasoning?: string;
    keywords: string[];
    requires_confirmation?: boolean;
    confirmation_options?: string[];
}
/**
 * 消息引用解析器
 */
export declare class MessageReplyParser {
    private moduleLogger;
    /**
     * 提取消息引用信息
     */
    extractReplyInfo(message_data: any): ReplyInfo | null;
    /**
     * 从raw_message中提取引用ID（备用方法）
     */
    extractReplyFromRawMessage(raw_message: string): string | null;
}
/**
 * Session链追溯器
 */
export declare class SessionChainTracker {
    private database;
    private moduleLogger;
    constructor(database: DatabaseManager);
    /**
     * 追溯Session链
     */
    traceSessionChain(reply_to_message_id: string): Promise<SessionContext | null>;
    /**
     * 创建或扩展Session
     */
    createOrExtendSession(message_id: string, user_id: number, reply_info: ReplyInfo): Promise<SessionContext>;
    /**
     * 根据ID获取Session
     */
    getSessionById(session_id: string): Promise<SessionContext | null>;
    createSessionRecord(session: SessionContext): Promise<void>;
    private recordMessageChain;
    private updateSessionActivity;
}
/**
 * Session管理器
 */
export declare class SessionManager extends EventEmitter {
    private database;
    private replyParser;
    private chainTracker;
    private moduleLogger;
    private sessionTTL;
    constructor(database: DatabaseManager);
    /**
     * 处理入站消息的Session识别
     */
    processIncomingMessage(message_data: QQMessage): Promise<SessionContext>;
    /**
     * 获取Session历史消息
     */
    getSessionHistory(session_id: string, limit?: number): Promise<MessageRecord[]>;
    /**
     * 切换Session服务
     */
    switchSessionService(session_id: string, new_service: string, reason?: string): Promise<boolean>;
    /**
     * 更新Session
     */
    updateSession(session: SessionContext): Promise<void>;
    /**
     * 清理过期Session
     */
    cleanupExpiredSessions(): Promise<number>;
    /**
     * 获取用户活跃Session
     */
    getUserActiveSessions(user_id: number): Promise<SessionContext[]>;
}
//# sourceMappingURL=session-manager.d.ts.map
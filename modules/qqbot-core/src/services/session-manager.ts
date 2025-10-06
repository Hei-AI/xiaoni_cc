import { EventEmitter } from 'events';
import { DatabaseManager } from './database';
import { QQMessage, OB11Segment } from '../types';
import { logger } from '../utils/logger';
// import { v4 as uuidv4 } from 'uuid';

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

/**
 * 消息引用解析器
 */
export class MessageReplyParser {
  private moduleLogger = logger.createModuleLogger('session-reply-parser');

  /**
   * 提取消息引用信息
   */
  extractReplyInfo(message_data: any): ReplyInfo | null {
    try {
      const message = message_data.message;
      if (!Array.isArray(message)) {
        return null;
      }

      let reply_segment: OB11Segment | null = null;
      const text_segments: string[] = [];

      for (const segment of message) {
        if (segment.type === 'reply') {
          reply_segment = segment;
        } else if (segment.type === 'text') {
          text_segments.push(segment.data?.text || '');
        }
      }

      if (!reply_segment || !reply_segment.data?.id) {
        return null;
      }

      return {
        reply_to_message_id: String(reply_segment.data.id),
        original_text: text_segments.join(''),
        segments: message
      };
    } catch (error) {
      this.moduleLogger.error('Failed to extract reply info', { error, message_data });
      return null;
    }
  }

  /**
   * 从raw_message中提取引用ID（备用方法）
   */
  extractReplyFromRawMessage(raw_message: string): string | null {
    const pattern = /\[CQ:reply,id=(\d+)\]/;
    const match = pattern.exec(raw_message);
    return match ? match[1] : null;
  }
}

/**
 * Session链追溯器
 */
export class SessionChainTracker {
  private database: DatabaseManager;
  private moduleLogger = logger.createModuleLogger('session-chain-tracker');

  constructor(database: DatabaseManager) {
    this.database = database;
  }

  /**
   * 追溯Session链
   */
  async traceSessionChain(reply_to_message_id: string): Promise<SessionContext | null> {
    try {
      // 查找被引用消息的Session信息
      const query = `
        SELECT session_id, depth, root_message_id 
        FROM message_reply_chain 
        WHERE message_id = ?
      `;
      
      const result = await this.database.executeQuery<{
        session_id: string;
        depth: number;
        root_message_id: string;
      }>(query, [reply_to_message_id]);

      if (result.length === 0) {
        // 检查conversations表（兼容现有数据）
        const conv_query = `
          SELECT user_id FROM conversations 
          WHERE message_id = ?
        `;
        const conv_result = await this.database.executeQuery<{user_id: number}>(
          conv_query, [reply_to_message_id]
        );

        if (conv_result.length > 0) {
          // 创建基础Session上下文
          return {
            session_id: `session_${conv_result[0].user_id}_${reply_to_message_id}`,
            user_id: conv_result[0].user_id,
            session_type: 'chat',
            current_service: 'chat_service',
            status: 'active',
            created_at: new Date(),
            last_activity: new Date(),
            expires_at: new Date(Date.now() + 3600000), // 1小时后过期
            conversation_context: {},
            business_context: {},
            message_count: 1,
            service_transitions: [],
            recent_messages: []
          };
        }
        return null;
      }

      const { session_id } = result[0];
      // const { session_id, depth, root_message_id } = result[0];

      // 获取完整Session信息
      return await this.getSessionById(session_id);
    } catch (error) {
      this.moduleLogger.error('Failed to trace session chain', { error, reply_to_message_id });
      return null;
    }
  }

  /**
   * 创建或扩展Session
   */
  async createOrExtendSession(
    message_id: string,
    user_id: number,
    reply_info: ReplyInfo
  ): Promise<SessionContext> {
    try {
      // 追溯现有Session
      const existing_context = await this.traceSessionChain(reply_info.reply_to_message_id);

      let session_context: SessionContext;

      if (existing_context) {
        // 扩展现有Session
        session_context = {
          ...existing_context,
          last_activity: new Date(),
          message_count: existing_context.message_count + 1
        };
      } else {
        // 创建新Session
        const session_id = `session_${user_id}_${reply_info.reply_to_message_id}_${Date.now()}`;
        session_context = {
          session_id,
          user_id,
          session_type: 'chat',
          current_service: 'chat_service',
          status: 'active',
          created_at: new Date(),
          last_activity: new Date(),
          expires_at: new Date(Date.now() + 3600000),
          conversation_context: {},
          business_context: {},
          message_count: 1,
          service_transitions: [],
          recent_messages: []
        };

        // 创建Session记录
        await this.createSessionRecord(session_context);
      }

      // 记录消息链关系
      await this.recordMessageChain(
        message_id,
        reply_info.reply_to_message_id,
        user_id,
        session_context.session_id,
        session_context.message_count
      );

      // 更新Session活跃度
      await this.updateSessionActivity(session_context.session_id);

      return session_context;
    } catch (error) {
      this.moduleLogger.error('Failed to create or extend session', { 
        error, message_id, user_id, reply_info 
      });
      throw error;
    }
  }

  /**
   * 根据ID获取Session
   */
  async getSessionById(session_id: string): Promise<SessionContext | null> {
    try {
      const query = `
        SELECT * FROM conversation_sessions 
        WHERE session_id = ?
      `;
      
      const result = await this.database.executeQuery<any>(query, [session_id]);
      
      if (result.length === 0) {
        return null;
      }

      const session_data = result[0];
      
      return {
        session_id: session_data.session_id,
        user_id: session_data.user_id,
        session_type: session_data.session_type || 'chat',
        current_service: session_data.current_service || 'chat_service',
        status: session_data.status || 'active',
        created_at: new Date(session_data.created_at),
        last_activity: new Date(session_data.last_activity),
        expires_at: new Date(session_data.expires_at || Date.now() + 3600000),
        conversation_context: JSON.parse(session_data.conversation_context || '{}'),
        business_context: JSON.parse(session_data.business_context || '{}'),
        message_count: session_data.message_count || 0,
        service_transitions: JSON.parse(session_data.service_transitions || '[]'),
        recent_messages: JSON.parse(session_data.recent_messages || '[]')
      };
    } catch (error) {
      this.moduleLogger.error('Failed to get session by id', { error, session_id });
      return null;
    }
  }

  public async createSessionRecord(session: SessionContext): Promise<void> {
    const query = `
      INSERT INTO conversation_sessions 
      (session_id, user_id, session_type, current_service, status, created_at, 
       last_activity, expires_at, conversation_context, business_context, 
       message_count, service_transitions, recent_messages)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        last_activity = VALUES(last_activity),
        message_count = VALUES(message_count)
    `;

    await this.database.executeUpdate(query, [
      session.session_id,
      session.user_id,
      session.session_type,
      session.current_service,
      session.status,
      session.created_at,
      session.last_activity,
      session.expires_at,
      JSON.stringify(session.conversation_context),
      JSON.stringify(session.business_context),
      session.message_count,
      JSON.stringify(session.service_transitions),
      JSON.stringify(session.recent_messages)
    ]);
  }

  private async recordMessageChain(
    message_id: string,
    reply_to_message_id: string,
    user_id: number,
    session_id: string,
    depth: number
  ): Promise<void> {
    const query = `
      INSERT INTO message_reply_chain 
      (message_id, reply_to_message_id, user_id, session_id, depth)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        session_id = VALUES(session_id),
        depth = VALUES(depth)
    `;

    await this.database.executeUpdate(query, [
      message_id, reply_to_message_id, user_id, session_id, depth
    ]);
  }

  private async updateSessionActivity(session_id: string): Promise<void> {
    const query = `
      UPDATE conversation_sessions 
      SET last_activity = NOW(), 
          message_count = message_count + 1
      WHERE session_id = ?
    `;

    await this.database.executeUpdate(query, [session_id]);
  }
}

/**
 * Session管理器
 */
export class SessionManager extends EventEmitter {
  private database: DatabaseManager;
  private replyParser: MessageReplyParser;
  private chainTracker: SessionChainTracker;
  private moduleLogger = logger.createModuleLogger('session-manager');
  private sessionTTL = 3600; // 1小时

  constructor(database: DatabaseManager) {
    super();
    this.database = database;
    this.replyParser = new MessageReplyParser();
    this.chainTracker = new SessionChainTracker(database);
  }

  /**
   * 处理入站消息的Session识别
   */
  async processIncomingMessage(message_data: QQMessage): Promise<SessionContext> {
    try {
      const user_id = message_data.user_id;
      const message_id = String(message_data.message_id);
      
      // 1. 检查是否为引用回复
      const reply_info = this.replyParser.extractReplyInfo(message_data);
      
      if (reply_info) {
        // 处理引用回复
        const session_context = await this.chainTracker.createOrExtendSession(
          message_id, user_id, reply_info
        );
        
        this.moduleLogger.info('Session reply continuation', {
          session_id: session_context.session_id,
          user_id,
          depth: session_context.message_count
        });

        this.emit('session_continued', session_context, reply_info);
        return session_context;
      } else {
        // 创建新Session
        const session_id = `session_${user_id}_${message_id}`;
        const session_context: SessionContext = {
          session_id,
          user_id,
          session_type: 'chat', // 默认为聊天模式
          current_service: 'chat_service',
          status: 'active',
          created_at: new Date(),
          last_activity: new Date(),
          expires_at: new Date(Date.now() + this.sessionTTL * 1000),
          conversation_context: {},
          business_context: {},
          message_count: 1,
          service_transitions: [],
          recent_messages: []
        };

        await this.chainTracker.createSessionRecord(session_context);
        
        this.moduleLogger.info('New session created', {
          session_id,
          user_id
        });

        this.emit('session_created', session_context);
        return session_context;
      }
    } catch (error) {
      this.moduleLogger.error('Failed to process incoming message', { error, message_data });
      throw error;
    }
  }

  /**
   * 获取Session历史消息
   */
  async getSessionHistory(session_id: string, limit: number = 10): Promise<MessageRecord[]> {
    try {
      const query = `
        SELECT c.user_message, c.ai_response, c.created_at, c.message_id,
               mrc.depth, c.user_id
        FROM message_reply_chain mrc
        JOIN conversations c ON mrc.message_id = c.message_id
        WHERE mrc.session_id = ?
        ORDER BY mrc.depth ASC, c.created_at ASC
        LIMIT ?
      `;

      const result = await this.database.executeQuery<{
        user_message: string;
        ai_response: string;
        created_at: Date;
        message_id: string;
        depth: number;
        user_id: number;
      }>(query, [session_id, limit]);

      const inMessages: MessageRecord[] = result.map(row => ({
        message_id: row.message_id,
        timestamp: new Date(row.created_at),
        direction: 'IN' as const,
        content: row.user_message,
        service: 'chat_service'
      }));

      const outMessages: MessageRecord[] = result
        .filter(row => row.ai_response)
        .map(row => ({
          message_id: `bot_${row.message_id}`,
          timestamp: new Date(row.created_at),
          direction: 'OUT' as const,
          content: row.ai_response,
          service: 'chat_service'
        }));

      return [...inMessages, ...outMessages]
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    } catch (error) {
      this.moduleLogger.error('Failed to get session history', { error, session_id });
      return [];
    }
  }

  /**
   * 切换Session服务
   */
  async switchSessionService(
    session_id: string,
    new_service: string,
    reason: string = 'USER_REQUEST'
  ): Promise<boolean> {
    try {
      const session = await this.chainTracker.getSessionById(session_id);
      if (!session) {
        return false;
      }

      const transition: ServiceTransition = {
        from_service: session.current_service,
        to_service: new_service,
        timestamp: new Date(),
        trigger: reason as any,
        confidence: 0.95
      };

      session.service_transitions.push(transition);
      session.current_service = new_service;
      session.last_activity = new Date();

      await this.updateSession(session);

      this.emit('service_switched', session, transition);
      
      this.moduleLogger.info('Session service switched', {
        session_id,
        from: transition.from_service,
        to: new_service,
        reason
      });

      return true;
    } catch (error) {
      this.moduleLogger.error('Failed to switch session service', { 
        error, session_id, new_service 
      });
      return false;
    }
  }

  /**
   * 更新Session
   */
  async updateSession(session: SessionContext): Promise<void> {
    await this.chainTracker.createSessionRecord(session);
  }

  /**
   * 清理过期Session
   */
  async cleanupExpiredSessions(): Promise<number> {
    try {
      const query = `
        UPDATE conversation_sessions 
        SET status = 'expired'
        WHERE status = 'active' 
          AND expires_at < NOW()
      `;

      const affected = await this.database.executeUpdate(query);
      
      if (affected > 0) {
        this.moduleLogger.info('Cleaned up expired sessions', { count: affected });
      }

      return affected;
    } catch (error) {
      this.moduleLogger.error('Failed to cleanup expired sessions', { error });
      return 0;
    }
  }

  /**
   * 获取用户活跃Session
   */
  async getUserActiveSessions(user_id: number): Promise<SessionContext[]> {
    try {
      const query = `
        SELECT * FROM conversation_sessions 
        WHERE user_id = ? AND status = 'active'
        ORDER BY last_activity DESC
      `;

      const results = await this.database.executeQuery<any>(query, [user_id]);
      
      return results.map(row => ({
        session_id: row.session_id,
        user_id: row.user_id,
        session_type: row.session_type || 'chat',
        current_service: row.current_service || 'chat_service',
        status: row.status || 'active',
        created_at: new Date(row.created_at),
        last_activity: new Date(row.last_activity),
        expires_at: new Date(row.expires_at || Date.now() + 3600000),
        conversation_context: JSON.parse(row.conversation_context || '{}'),
        business_context: JSON.parse(row.business_context || '{}'),
        message_count: row.message_count || 0,
        service_transitions: JSON.parse(row.service_transitions || '[]'),
        recent_messages: JSON.parse(row.recent_messages || '[]')
      }));
    } catch (error) {
      this.moduleLogger.error('Failed to get user active sessions', { error, user_id });
      return [];
    }
  }
}

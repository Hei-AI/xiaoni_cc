import { DatabaseManager } from '../../src/services/database';
import { SessionContext } from '../../src/services/session-manager';

export interface SessionData {
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
  service_transitions: any[];
  recent_messages: any[];
}

/**
 * 专用的测试数据库管理器
 * 按照SE同事的建议实现内存数据存储，避免真实数据库依赖
 */
export class TestDatabaseManager extends DatabaseManager {
  private testData: Map<string, any> = new Map();
  private sessionData: Map<string, SessionData> = new Map();
  private messageChainData: Map<string, any[]> = new Map();
  
  constructor() {
    // 使用测试配置初始化父类
    super({
      host: 'localhost',
      port: 3306,
      user: 'test',
      password: 'test',
      database: 'test_db'
    });
  }

  // Session管理方法的测试实现
  async createSession(
    sessionId: string, 
    userId: number, 
    sessionType: string, 
    currentService: string, 
    status: string, 
    expiresAt?: Date
  ): Promise<boolean>;
  async createSession(sessionData: {
    session_id: string;
    user_id: number;
    session_type?: string;
    current_service?: string;
    expires_at?: Date;
    conversation_context?: any;
    business_context?: any;
  }): Promise<boolean>;
  async createSession(
    sessionIdOrData: string | any, 
    userId?: number, 
    sessionType?: string, 
    currentService?: string, 
    status?: string, 
    expiresAt?: Date
  ): Promise<boolean> {
    try {
      let sessionData: any;
      
      // Handle overloaded methods
      if (typeof sessionIdOrData === 'string') {
        sessionData = {
          session_id: sessionIdOrData,
          user_id: userId!,
          session_type: sessionType || 'chat',
          current_service: currentService || 'gemini_ai',
          expires_at: expiresAt
        };
      } else {
        sessionData = sessionIdOrData;
      }

      const session: SessionData = {
        session_id: sessionData.session_id,
        user_id: sessionData.user_id,
        session_type: (sessionData.session_type as any) || 'chat',
        current_service: sessionData.current_service || 'gemini_ai',
        status: (status as any) || 'active',
        created_at: new Date(),
        last_activity: new Date(),
        expires_at: sessionData.expires_at || new Date(Date.now() + 3600000),
        conversation_context: sessionData.conversation_context || {},
        business_context: sessionData.business_context || {},
        message_count: 0,
        service_transitions: [],
        recent_messages: []
      };
      
      this.sessionData.set(sessionData.session_id, session);
      return true;
    } catch (error) {
      return false;
    }
  }

  async getSessionById(sessionId: string): Promise<SessionData | null> {
    return this.sessionData.get(sessionId) || null;
  }

  async getSessions(
    userId?: number, 
    limit: number = 50, 
    status?: string
  ): Promise<SessionData[]> {
    let sessions = Array.from(this.sessionData.values());
    
    if (userId) {
      sessions = sessions.filter(s => s.user_id === userId);
    }
    
    if (status) {
      sessions = sessions.filter(s => s.status === status);
    }
    
    return sessions.slice(0, limit);
  }

  async switchSessionService(
    sessionId: string, 
    newService: string, 
    reason?: string
  ): Promise<boolean> {
    const session = this.sessionData.get(sessionId);
    if (!session) return false;
    
    // 记录服务切换
    session.service_transitions.push({
      from_service: session.current_service,
      to_service: newService,
      timestamp: new Date(),
      reason: reason || 'User requested',
      trigger: 'USER_REQUEST'
    });
    
    session.current_service = newService;
    session.last_activity = new Date();
    
    this.sessionData.set(sessionId, session);
    return true;
  }

  async updateSessionActivity(sessionId: string): Promise<boolean> {
    const session = this.sessionData.get(sessionId);
    if (!session) return false;
    
    session.last_activity = new Date();
    session.message_count += 1;
    
    this.sessionData.set(sessionId, session);
    return true;
  }

  async recordMessageChain(data: {
    message_id: string;
    reply_to_message_id?: string;
    user_id: number;
    session_id: string;
    depth?: number;
  }): Promise<boolean> {
    try {
      const chainRecord = {
        message_id: data.message_id,
        reply_to_message_id: data.reply_to_message_id || '',
        user_id: data.user_id,
        session_id: data.session_id,
        depth: data.depth || 1,
        created_at: new Date()
      };
      
      const replyKey = data.reply_to_message_id || data.message_id;
      if (!this.messageChainData.has(replyKey)) {
        this.messageChainData.set(replyKey, []);
      }
      
      this.messageChainData.get(replyKey)!.push(chainRecord);
      return true;
    } catch (error) {
      return false;
    }
  }

  async cleanupExpiredSessions(): Promise<number> {
    const now = new Date();
    let cleanedCount = 0;
    
    for (const [sessionId, session] of this.sessionData.entries()) {
      if (session.expires_at < now) {
        this.sessionData.delete(sessionId);
        cleanedCount++;
      }
    }
    
    return cleanedCount;
  }

  // 重写executeQuery以支持消息链查询
  async executeQuery<T = any>(query: string, params: any[] = []): Promise<T[]> {
    // 模拟message_reply_chain查询
    if (query.includes('FROM message_reply_chain')) {
      const replyToMessageId = params[0];
      const chainData = this.messageChainData.get(replyToMessageId);
      
      if (chainData && chainData.length > 0) {
        return chainData as T[];
      }
    }
    
    // 模拟conversations查询
    if (query.includes('FROM conversations')) {
      const messageId = params[0];
      return [{
        user_id: 85178516,
        created_at: new Date('2024-01-01T12:00:00Z')
      }] as T[];
    }
    
    return [];
  }

  // 测试专用方法
  clearTestData(): void {
    this.testData.clear();
    this.sessionData.clear();
    this.messageChainData.clear();
  }

  getTestDataSize(): number {
    return this.sessionData.size;
  }

  getMessageChainSize(): number {
    return Array.from(this.messageChainData.values())
      .reduce((total, chains) => total + chains.length, 0);
  }

  // 创建测试用的复杂回复链
  createTestReplyChain(chainData: Array<{ id: string; depth: number; parent?: string }>): void {
    chainData.forEach(item => {
      if (item.parent) {
        this.recordMessageChain({
          message_id: item.id,
          reply_to_message_id: item.parent,
          user_id: 85178516,
          session_id: `session_85178516_${item.parent}`,
          depth: item.depth
        });
      }
    });
  }

  // 获取Session统计信息
  getSessionStats(): {
    total: number;
    active: number;
    byType: Record<string, number>;
    avgDuration: number;
  } {
    const sessions = Array.from(this.sessionData.values());
    const now = new Date();
    
    return {
      total: sessions.length,
      active: sessions.filter(s => s.status === 'active').length,
      byType: sessions.reduce((acc, s) => {
        acc[s.session_type] = (acc[s.session_type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      avgDuration: sessions.length > 0 
        ? sessions.reduce((sum, s) => sum + (now.getTime() - s.created_at.getTime()), 0) / sessions.length 
        : 0
    };
  }
}
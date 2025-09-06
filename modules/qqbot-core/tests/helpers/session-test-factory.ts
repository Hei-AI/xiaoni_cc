import { QQMessage, ConversationData } from '../../src/types';

/**
 * Session测试工厂函数
 * 专为Claude Bot Server Manager同事的Session管理测试需求创建
 * 基于Gemini API故障排查经验，确保类型安全和测试完整性
 */

// Session相关的测试数据工厂
export interface MockSessionData {
  session_id: string;
  user_id: number;
  session_type: string;
  current_service: string;
  status: 'active' | 'paused' | 'completed' | 'expired';
  created_at: Date;
  updated_at: Date;
  last_activity: Date;
  expires_at?: Date;
  message_count: number;
  conversation_context?: any;
  business_context?: any;
  service_transitions?: any;
}

export const createMockSession = (overrides: Partial<MockSessionData> = {}): MockSessionData => {
  const now = new Date();
  return {
    session_id: `test-session-${Date.now()}`,
    user_id: 85178516, // 使用真实的测试用户ID
    session_type: 'chat',
    current_service: 'chat_service',
    status: 'active',
    created_at: now,
    updated_at: now,
    last_activity: now,
    message_count: 0,
    conversation_context: {},
    business_context: {},
    service_transitions: [],
    ...overrides
  };
};

// 消息链相关的测试数据工厂
export interface MockMessageChainData {
  message_id: string;
  reply_to_message_id?: string;
  user_id: number;
  session_id: string;
  depth: number;
  created_at: Date;
}

export const createMockMessageChain = (overrides: Partial<MockMessageChainData> = {}): MockMessageChainData => ({
  message_id: `msg-${Date.now()}`,
  user_id: 85178516,
  session_id: `test-session-${Date.now()}`,
  depth: 0,
  created_at: new Date(),
  ...overrides
});

// QQ消息测试工厂函数 - 修复同事提到的类型问题
export const createMockQQMessage = (overrides: Partial<QQMessage> = {}): QQMessage => ({
  message_type: 'private',
  sub_type: 'friend', // 修复缺失的sub_type
  message_id: Date.now(),
  user_id: 85178516,
  message: 'test message',
  raw_message: 'test message',
  font: 0,
  sender: {
    user_id: 85178516,
    nickname: 'TestUser',
    sex: 'unknown', // 修复缺失的sex属性
    age: 25,
    card: '',
    area: '',
    level: '',
    role: '',
    title: ''
  },
  time: Math.floor(Date.now() / 1000),
  ...overrides
});

// Conversation数据测试工厂
export const createMockConversationData = (overrides: Partial<ConversationData> = {}): ConversationData => ({
  id: `conv-${Date.now()}`,
  user_id: 85178516,
  user_message: 'test user message',
  ai_response: 'test ai response',
  timestamp: new Date(),
  response_time: 1000,
  model_name: 'gemini-2.5-flash',
  raw_request: JSON.stringify({ test: 'request' }),
  raw_response: JSON.stringify({ test: 'response' }),
  message_id: `msg-${Date.now()}`,
  reply_to_message_id: null,
  reply_to_text: null,
  ...overrides
});

// 专门的DatabaseManager Mock - 解决同事提到的Mock类型问题
export interface MockDatabaseManager {
  // Session相关方法
  getSessionById: jest.MockedFunction<(sessionId: string) => Promise<MockSessionData | null>>;
  createSession: jest.MockedFunction<(sessionData: Partial<MockSessionData>) => Promise<boolean>>;
  updateSessionActivity: jest.MockedFunction<(sessionId: string, messageCount?: number) => Promise<boolean>>;
  switchSessionService: jest.MockedFunction<(sessionId: string, newService: string, reason?: string) => Promise<boolean>>;
  cleanupExpiredSessions: jest.MockedFunction<() => Promise<number>>;
  getSessions: jest.MockedFunction<(userId?: number, limit?: number, status?: string) => Promise<MockSessionData[]>>;
  getSessionHistory: jest.MockedFunction<(sessionId: string, limit?: number) => Promise<any[]>>;
  recordMessageChain: jest.MockedFunction<(data: Partial<MockMessageChainData>) => Promise<boolean>>;

  // Conversation相关方法
  saveConversation: jest.MockedFunction<(conversationData: ConversationData) => Promise<boolean>>;
  getConversationById: jest.MockedFunction<(conversationId: string) => Promise<ConversationData | null>>;
  getConversations: jest.MockedFunction<(userId?: number, limit?: number) => Promise<ConversationData[]>>;

  // 通用方法
  testConnection: jest.MockedFunction<() => Promise<boolean>>;
  close: jest.MockedFunction<() => Promise<void>>;
}

export const createMockDatabaseManager = (): MockDatabaseManager => ({
  // Session相关Mock方法
  getSessionById: jest.fn().mockResolvedValue(createMockSession()),
  createSession: jest.fn().mockResolvedValue(true),
  updateSessionActivity: jest.fn().mockResolvedValue(true),
  switchSessionService: jest.fn().mockResolvedValue(true),
  cleanupExpiredSessions: jest.fn().mockResolvedValue(0),
  getSessions: jest.fn().mockResolvedValue([createMockSession()]),
  getSessionHistory: jest.fn().mockResolvedValue([]),
  recordMessageChain: jest.fn().mockResolvedValue(true),

  // Conversation相关Mock方法
  saveConversation: jest.fn().mockResolvedValue(true),
  getConversationById: jest.fn().mockResolvedValue(createMockConversationData()),
  getConversations: jest.fn().mockResolvedValue([createMockConversationData()]),

  // 通用Mock方法
  testConnection: jest.fn().mockResolvedValue(true),
  close: jest.fn().mockResolvedValue(undefined)
});

// 测试场景预设 - 常见的测试用例场景
export const TestScenarios = {
  // Session链追溯测试场景
  createSessionChainScenario: () => {
    const sessionId = `chain-session-${Date.now()}`;
    return {
      session: createMockSession({ session_id: sessionId, message_count: 3 }),
      messageChain: [
        createMockMessageChain({ session_id: sessionId, depth: 0, message_id: 'msg-1' }),
        createMockMessageChain({ session_id: sessionId, depth: 1, message_id: 'msg-2', reply_to_message_id: 'msg-1' }),
        createMockMessageChain({ session_id: sessionId, depth: 2, message_id: 'msg-3', reply_to_message_id: 'msg-2' })
      ]
    };
  },

  // 并发Session管理测试场景
  createConcurrentSessionScenario: (userCount = 3) => {
    return Array.from({ length: userCount }, (_, i) => ({
      userId: 85178516 + i,
      sessions: [
        createMockSession({ user_id: 85178516 + i, session_id: `user-${i}-session-1` }),
        createMockSession({ user_id: 85178516 + i, session_id: `user-${i}-session-2` })
      ]
    }));
  },

  // Session服务切换测试场景
  createServiceSwitchScenario: () => {
    const sessionId = `switch-session-${Date.now()}`;
    return {
      initialSession: createMockSession({ 
        session_id: sessionId, 
        current_service: 'chat_service',
        service_transitions: []
      }),
      switchedSession: createMockSession({ 
        session_id: sessionId, 
        current_service: 'requirement_service',
        service_transitions: [{
          from_service: 'chat_service',
          to_service: 'requirement_service',
          timestamp: new Date().toISOString(),
          trigger: 'INTENT_DETECTION',
          confidence: 0.85
        }]
      })
    };
  },

  // Session过期处理测试场景
  createExpiredSessionScenario: () => {
    const pastTime = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25小时前
    return createMockSession({
      status: 'expired',
      created_at: pastTime,
      last_activity: pastTime,
      expires_at: new Date(Date.now() - 1 * 60 * 60 * 1000) // 1小时前过期
    });
  }
};

// 错误场景的测试工厂 - 基于我的Gemini API故障排查经验
export const ErrorScenarios = {
  // 数据库连接失败场景
  createDatabaseErrorMock: () => {
    const mockDb = createMockDatabaseManager();
    mockDb.testConnection.mockRejectedValue(new Error('Database connection failed'));
    mockDb.createSession.mockRejectedValue(new Error('Cannot create session: DB unavailable'));
    return mockDb;
  },

  // Session创建失败场景  
  createSessionCreationErrorMock: () => {
    const mockDb = createMockDatabaseManager();
    mockDb.createSession.mockRejectedValue(new Error('Session creation failed: unique constraint violation'));
    return mockDb;
  },

  // 时间戳类型错误场景 - 基于我修复的cached.updated_at.getTime错误
  createTimestampErrorScenario: () => {
    const sessionWithStringTimestamp = {
      ...createMockSession(),
      updated_at: '2025-09-01T10:00:00.000Z' as any // 模拟数据库返回字符串类型
    };
    return sessionWithStringTimestamp;
  }
};

/**
 * 使用示例：
 * 
 * // 基本Session测试
 * const session = createMockSession({ user_id: 123, status: 'active' });
 * 
 * // Session链追溯测试
 * const chainScenario = TestScenarios.createSessionChainScenario();
 * 
 * // 数据库Mock测试
 * const mockDb = createMockDatabaseManager();
 * mockDb.getSessionById.mockResolvedValue(session);
 * 
 * // 错误场景测试
 * const errorDb = ErrorScenarios.createDatabaseErrorMock();
 */
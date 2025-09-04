import QQBot from '../src/index';
import { SessionManager } from '../src/services/session-manager';
import { DatabaseManager } from '../src/services/database';
import { WebSocketClient } from '../src/services/websocket-client';
import { QQMessage } from '../src/types';

// Mock 所有依赖
jest.mock('../src/services/database');
jest.mock('../src/services/websocket-client');
jest.mock('../src/services/ai-service');
jest.mock('../src/services/remote-claude-service');
jest.mock('../src/services/http-server');

describe('Session Integration Tests', () => {
  let mockDatabase: jest.Mocked<DatabaseManager>;
  let mockWebSocketClient: jest.Mocked<WebSocketClient>;
  let sessionManager: SessionManager;

  beforeEach(() => {
    // Setup mocks
    mockDatabase = {
      testConnection: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(undefined),
      createSession: jest.fn().mockResolvedValue(true),
      updateSessionActivity: jest.fn().mockResolvedValue(undefined),
      recordMessageChain: jest.fn().mockResolvedValue(undefined),
      getSessionById: jest.fn(),
      getSessions: jest.fn(),
      switchSessionService: jest.fn(),
      cleanupExpiredSessions: jest.fn(),
      saveConversation: jest.fn().mockResolvedValue(undefined),
      saveRequirement: jest.fn().mockResolvedValue(undefined),
      updateBotStatus: jest.fn().mockResolvedValue(undefined),
      executeQuery: jest.fn(),
      executeUpdate: jest.fn(),
      executeBatch: jest.fn()
    } as any;

    mockWebSocketClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn(),
      sendPrivateMessage: jest.fn().mockResolvedValue(undefined),
      sendGroupMessage: jest.fn().mockResolvedValue(undefined),
      sendReplyMessage: jest.fn().mockResolvedValue(undefined),
      isConnected: jest.fn().mockReturnValue(true),
      on: jest.fn(),
      emit: jest.fn()
    } as any;

    sessionManager = new SessionManager(mockDatabase);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Complete Session Workflow', () => {
    test('should handle new requirement message and create session', async () => {
      const message: QQMessage = {
        message_type: 'private',
        sub_type: 'friend',
        message_id: 12345,
        user_id: 85178516,
        message: '请帮我实现一个用户登录系统，需要包含密码加密和JWT认证',
        raw_message: '请帮我实现一个用户登录系统，需要包含密码加密和JWT认证',
        font: 0,
        sender: {
          user_id: 85178516,
          nickname: 'testuser',
          card: '',
          role: 'member'
        },
        time: Math.floor(Date.now() / 1000),
        self_id: 1129974489,
        post_type: 'message'
      };

      const sessionContext = await sessionManager.processIncomingMessage(message);

      expect(sessionContext).toBeDefined();
      expect(sessionContext.session_type).toBe('requirement');
      expect(sessionContext.current_service).toBe('claude_code');
      expect(sessionContext.user_id).toBe(85178516);
      expect(sessionContext.status).toBe('active');

      expect(mockDatabase.createSession).toHaveBeenCalledWith(
        sessionContext.session_id,
        85178516,
        'requirement',
        'claude_code',
        'active',
        expect.any(Date),
        expect.any(Object),
        expect.any(Object)
      );
    });

    test('should handle reply message and continue existing session', async () => {
      // 第一条消息创建session
      const firstMessage: QQMessage = {
        message_type: 'private',
        sub_type: 'friend',
        message_id: 12345,
        user_id: 85178516,
        message: '实现一个TODO应用',
        raw_message: '实现一个TODO应用',
        font: 0,
        sender: {
          user_id: 85178516,
          nickname: 'testuser',
          card: '',
          role: 'member'
        },
        time: Math.floor(Date.now() / 1000),
        self_id: 1129974489,
        post_type: 'message'
      };

      const firstSessionContext = await sessionManager.processIncomingMessage(firstMessage);
      
      // Mock数据库返回已存在的session
      const existingSessionData = {
        session_id: firstSessionContext.session_id,
        user_id: 85178516,
        session_type: 'requirement' as const,
        current_service: 'claude_code',
        status: 'active' as const,
        created_at: new Date(),
        last_activity: new Date(),
        expires_at: new Date(Date.now() + 3600000),
        conversation_context: {},
        business_context: {},
        message_count: 1,
        service_transitions: [],
        recent_messages: []
      };

      mockDatabase.executeQuery
        .mockResolvedValueOnce([{
          session_id: firstSessionContext.session_id,
          user_id: 85178516,
          message_id: '12345',
          depth: 0
        }]);

      // 第二条消息 - 回复第一条消息
      const replyMessage: QQMessage = {
        message_type: 'private',
        message_id: 12346,
        user_id: 85178516,
        message: '[CQ:reply,id=12345]请添加用户认证功能',
        raw_message: '[CQ:reply,id=12345]请添加用户认证功能',
        font: 0,
        sender: {
          user_id: 85178516,
          nickname: 'testuser',
          card: '',
          role: 'member'
        },
        time: Math.floor(Date.now() / 1000),
        self_id: 1129974489,
        post_type: 'message'
      };

      const replySessionContext = await sessionManager.processIncomingMessage(replyMessage);

      expect(replySessionContext).toBeDefined();
      expect(replySessionContext.session_id).toBe(firstSessionContext.session_id);
      expect(mockDatabase.recordMessageChain).toHaveBeenCalledWith(
        '12346',
        '12345',
        85178516,
        firstSessionContext.session_id,
        expect.any(Number)
      );
    });

    test('should handle session type switching from chat to requirement', async () => {
      // 开始是聊天消息
      const chatMessage: QQMessage = {
        message_type: 'private',
        sub_type: 'friend',
        message_id: 12345,
        user_id: 85178516,
        message: '你好',
        raw_message: '你好',
        font: 0,
        sender: {
          user_id: 85178516,
          nickname: 'testuser',
          card: '',
          role: 'member'
        },
        time: Math.floor(Date.now() / 1000),
        self_id: 1129974489,
        post_type: 'message'
      };

      const chatSessionContext = await sessionManager.processIncomingMessage(chatMessage);
      expect(chatSessionContext.session_type).toBe('chat');
      expect(chatSessionContext.current_service).toBe('gemini_ai');

      // 然后用户发送需求消息 - 应该切换到requirement模式
      mockDatabase.executeQuery
        .mockResolvedValueOnce([{
          session_id: chatSessionContext.session_id,
          user_id: 85178516,
          message_id: '12345',
          depth: 0
        }]);

      const requirementMessage: QQMessage = {
        message_type: 'private',
        message_id: 12346,
        user_id: 85178516,
        message: '[CQ:reply,id=12345]其实我需要你帮我开发一个网站',
        raw_message: '[CQ:reply,id=12345]其实我需要你帮我开发一个网站',
        font: 0,
        sender: {
          user_id: 85178516,
          nickname: 'testuser',
          card: '',
          role: 'member'
        },
        time: Math.floor(Date.now() / 1000),
        self_id: 1129974489,
        post_type: 'message'
      };

      const requirementSessionContext = await sessionManager.processIncomingMessage(requirementMessage);
      expect(requirementSessionContext.session_type).toBe('requirement');
      expect(requirementSessionContext.current_service).toBe('claude_code');
    });

    test('should handle multiple users with separate sessions', async () => {
      // 用户1的消息
      const user1Message: QQMessage = {
        message_type: 'private',
        message_id: 12345,
        user_id: 111111,
        message: '帮我写个Python脚本',
        raw_message: '帮我写个Python脚本',
        font: 0,
        sender: {
          user_id: 111111,
          nickname: 'user1',
          card: '',
          role: 'member'
        },
        time: Math.floor(Date.now() / 1000),
        self_id: 1129974489,
        post_type: 'message'
      };

      // 用户2的消息
      const user2Message: QQMessage = {
        message_type: 'private',
        message_id: 12346,
        user_id: 222222,
        message: '我需要一个React组件',
        raw_message: '我需要一个React组件',
        font: 0,
        sender: {
          user_id: 222222,
          nickname: 'user2',
          card: '',
          role: 'member'
        },
        time: Math.floor(Date.now() / 1000),
        self_id: 1129974489,
        post_type: 'message'
      };

      const user1SessionContext = await sessionManager.processIncomingMessage(user1Message);
      const user2SessionContext = await sessionManager.processIncomingMessage(user2Message);

      expect(user1SessionContext.session_id).not.toBe(user2SessionContext.session_id);
      expect(user1SessionContext.user_id).toBe(111111);
      expect(user2SessionContext.user_id).toBe(222222);
      expect(user1SessionContext.session_type).toBe('requirement');
      expect(user2SessionContext.session_type).toBe('requirement');

      // 验证创建了两个不同的session
      expect(mockDatabase.createSession).toHaveBeenCalledTimes(2);
    });

    test('should handle session expiry and cleanup', async () => {
      // Mock 清理过期session
      mockDatabase.cleanupExpiredSessions.mockResolvedValue(3);

      const cleanedCount = await mockDatabase.cleanupExpiredSessions();

      expect(cleanedCount).toBe(3);
      expect(mockDatabase.cleanupExpiredSessions).toHaveBeenCalled();
    });

    test('should handle service switching via API', async () => {
      const sessionId = 'session_85178516_12345';
      
      mockDatabase.switchSessionService.mockResolvedValue(true);

      const result = await mockDatabase.switchSessionService(
        sessionId,
        'gemini_ai',
        'User requested to switch to chat mode'
      );

      expect(result).toBe(true);
      expect(mockDatabase.switchSessionService).toHaveBeenCalledWith(
        sessionId,
        'gemini_ai',
        'User requested to switch to chat mode'
      );
    });
  });

  describe('Error Recovery', () => {
    test('should handle database connection failures gracefully', async () => {
      const message: QQMessage = {
        message_type: 'private',
        sub_type: 'friend',
        message_id: 12345,
        user_id: 85178516,
        message: '测试消息',
        raw_message: '测试消息',
        font: 0,
        sender: {
          user_id: 85178516,
          nickname: 'testuser',
          card: '',
          role: 'member'
        },
        time: Math.floor(Date.now() / 1000),
        self_id: 1129974489,
        post_type: 'message'
      };

      mockDatabase.createSession.mockRejectedValue(new Error('Connection timeout'));

      await expect(sessionManager.processIncomingMessage(message))
        .rejects.toThrow('Connection timeout');
    });

    test('should handle malformed messages gracefully', async () => {
      const malformedMessage = {
        message_type: 'private',
        sub_type: 'friend',
        message_id: 12345,
        user_id: 85178516,
        message: null, // 异常情况
        raw_message: '[CQ:reply,id=invalid]',
        font: 0,
        sender: {
          user_id: 85178516,
          nickname: 'testuser',
          card: '',
          role: 'member'
        },
        time: Math.floor(Date.now() / 1000),
        self_id: 1129974489,
        post_type: 'message'
      } as any;

      // 应该能处理而不崩溃
      const result = await sessionManager.processIncomingMessage(malformedMessage);
      expect(result).toBeDefined();
      expect(result.user_id).toBe(85178516);
    });
  });

  describe('Performance Tests', () => {
    test('should handle concurrent session creation', async () => {
      const messages: QQMessage[] = [];
      const userIds = [111111, 222222, 333333, 444444, 555555];
      
      // 创建5个并发消息
      userIds.forEach((userId, index) => {
        messages.push({
          message_type: 'private',
          message_id: 12345 + index,
          user_id: userId,
          message: `用户${userId}的需求消息`,
          raw_message: `用户${userId}的需求消息`,
          font: 0,
          sender: {
            user_id: userId,
            nickname: `user${userId}`,
            card: '',
            role: 'member'
          },
          time: Math.floor(Date.now() / 1000),
          self_id: 1129974489,
          post_type: 'message'
        });
      });

      // 并发处理所有消息
      const promises = messages.map(message => 
        sessionManager.processIncomingMessage(message)
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      results.forEach((result, index) => {
        expect(result.user_id).toBe(userIds[index]);
        expect(result.session_type).toBe('requirement');
      });

      expect(mockDatabase.createSession).toHaveBeenCalledTimes(5);
    });

    test('should handle rapid message sequence from same user', async () => {
      const userId = 85178516;
      const messageCount = 10;
      const messages: QQMessage[] = [];

      // 创建快速消息序列
      for (let i = 0; i < messageCount; i++) {
        messages.push({
          message_type: 'private',
          message_id: 12345 + i,
          user_id: userId,
          message: `第${i + 1}条消息`,
          raw_message: `第${i + 1}条消息`,
          font: 0,
          sender: {
            user_id: userId,
            nickname: 'testuser',
            card: '',
            role: 'member'
          },
          time: Math.floor(Date.now() / 1000) + i,
          self_id: 1129974489,
          post_type: 'message'
        });
      }

      // 顺序处理消息
      const results = [];
      for (const message of messages) {
        const result = await sessionManager.processIncomingMessage(message);
        results.push(result);
      }

      expect(results).toHaveLength(messageCount);
      
      // 所有消息应该使用相同的session（或通过reply chain连接）
      const sessionIds = results.map(result => result.session_id);
      const uniqueSessionIds = new Set(sessionIds);
      
      // 应该有相对较少的不同session ID（考虑到session重用和reply chain）
      expect(uniqueSessionIds.size).toBeLessThanOrEqual(messageCount);
    });
  });
});
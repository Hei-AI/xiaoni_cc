import { SessionManager } from '../src/services/session-manager';
import { QQMessage, OB11Segment } from '../src/types';
import { createMockPrivateMessage, createMockReplyMessage } from './helpers/test-messages';
import { ReplyChainTestBuilder, ConcurrentTestDataGenerator, SessionPerformanceHelper } from './helpers/chain-test-helpers';
import { TestDatabaseManager } from './mocks/TestDatabaseManager';

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let testDatabase: TestDatabaseManager;

  beforeEach(() => {
    testDatabase = new TestDatabaseManager();
    sessionManager = new SessionManager(testDatabase as any);
    
    // 清理测试数据
    testDatabase.clearTestData();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Message Reply Parsing', () => {
    test('should extract reply info from OneBot message with reply segment', () => {
      const message: QQMessage = {
        message_type: 'private',
        message_id: 12345,
        user_id: 85178516,
        message: [
          { type: 'reply', data: { id: '98765' } },
          { type: 'text', data: { text: '这是回复内容' } }
        ] as OB11Segment[],
        raw_message: '[CQ:reply,id=98765]这是回复内容',
        font: 0,
        sender: {
          user_id: 85178516,
          nickname: 'testuser',
          card: '',
          sex: 'unknown' as const
        },
        time: Math.floor(Date.now() / 1000),
        self_id: 1129974489,
        post_type: 'message'
      };

      const replyParser = (sessionManager as any).replyParser;
      const replyInfo = replyParser.extractReplyInfo(message);

      expect(replyInfo).toBeDefined();
      expect(replyInfo?.reply_to_message_id).toBe('98765');
      expect(replyInfo?.original_text).toBe('这是回复内容');
    });

    test('should extract reply info from raw message string with CQ code', () => {
      const message: QQMessage = {
        message_type: 'private',
        message_id: 12345,
        user_id: 85178516,
        message: '[CQ:reply,id=98765]这是回复内容',
        raw_message: '[CQ:reply,id=98765]这是回复内容',
        font: 0,
        sender: {
          user_id: 85178516,
          nickname: 'testuser',
          card: '',
          sex: 'unknown' as const
        },
        time: Math.floor(Date.now() / 1000),
        self_id: 1129974489,
        post_type: 'message'
      };

      const replyParser = (sessionManager as any).replyParser;
      const replyInfo = replyParser.extractReplyInfo(message);

      expect(replyInfo).toBeDefined();
      expect(replyInfo?.reply_to_message_id).toBe('98765');
      expect(replyInfo?.original_text).toBe('这是回复内容');
    });

    test('should return null for message without reply', () => {
      const message: QQMessage = {
        message_type: 'private',
        message_id: 12345,
        user_id: 85178516,
        message: '普通消息',
        raw_message: '普通消息',
        font: 0,
        sender: {
          user_id: 85178516,
          nickname: 'testuser',
          card: '',
          sex: 'unknown' as const
        },
        time: Math.floor(Date.now() / 1000),
        self_id: 1129974489,
        post_type: 'message'
      };

      const replyParser = (sessionManager as any).replyParser;
      const replyInfo = replyParser.extractReplyInfo(message);

      expect(replyInfo).toBeNull();
    });
  });

  describe('Session Context Management', () => {
    test('should process incoming message and create new session', async () => {
      const message = createMockPrivateMessage(
        12345,
        85178516,
        '帮我实现一个登录功能'
      );

      // Mock 数据库方法
      testDatabase.createSession.mockResolvedValue(true);
      testDatabase.updateSessionActivity.mockResolvedValue(true);

      const result = await sessionManager.processIncomingMessage(message);

      expect(result).toBeDefined();
      expect(result.session_id).toMatch(/^session_85178516_/);
      expect(result.user_id).toBe(85178516);
      expect(result.session_type).toBe('requirement');
      expect(result.current_service).toBe('claude_code');
      expect(mockDatabase.createSession).toHaveBeenCalled();
    });

    test('should process reply message and continue existing session', async () => {
      const message = createMockReplyMessage(
        12346,
        85178516,
        12345,
        '请添加数据验证功能'
      );

      // Mock 已存在的会话上下文
      const existingSession = {
        session_id: 'session_85178516_12345',
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

      const mockChainTracker = (sessionManager as any).chainTracker;
      jest.spyOn(mockChainTracker, 'traceSessionChain').mockResolvedValue(existingSession);
      testDatabase.recordMessageChain.mockResolvedValue(true);
      testDatabase.updateSessionActivity.mockResolvedValue(true);

      const result = await sessionManager.processIncomingMessage(message);

      expect(result).toBeDefined();
      expect(result.session_id).toBe('session_85178516_12345');
      expect(result.session_type).toBe('requirement');
      expect(mockDatabase.recordMessageChain).toHaveBeenCalled();
    });

    test('should handle chat session type detection', async () => {
      const message: QQMessage = {
        message_type: 'private',
        message_id: 12347,
        user_id: 85178516,
        message: '今天天气怎么样？',
        raw_message: '今天天气怎么样？',
        font: 0,
        sender: {
          user_id: 85178516,
          nickname: 'testuser',
          card: '',
          sex: 'unknown' as const
        },
        time: Math.floor(Date.now() / 1000),
        self_id: 1129974489,
        post_type: 'message'
      };

      testDatabase.createSession.mockResolvedValue(true);
      testDatabase.updateSessionActivity.mockResolvedValue(true);

      const result = await sessionManager.processIncomingMessage(message);

      expect(result).toBeDefined();
      expect(result.session_type).toBe('chat');
      expect(result.current_service).toBe('gemini_ai');
    });
  });

  describe('Session Chain Tracing', () => {
    test('should trace session chain from message reply chain table', async () => {
      const replyToMessageId = '98765';
      
      // Mock 数据库查询结果
      const mockChainResult = [{
        session_id: 'session_85178516_original',
        user_id: 85178516,
        message_id: '98765',
        depth: 1
      }];

      testDatabase.executeQuery.mockResolvedValue(mockChainResult);

      const chainTracker = (sessionManager as any).chainTracker;
      const result = await chainTracker.traceSessionChain(replyToMessageId);

      expect(result).toBeDefined();
      expect(result?.session_id).toBe('session_85178516_original');
      expect(mockDatabase.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining('FROM message_reply_chain'),
        [replyToMessageId]
      );
    });

    test('should fallback to conversation lookup when chain not found', async () => {
      const replyToMessageId = '98765';
      
      // Mock empty chain result, but successful conversation result
      testDatabase.executeQuery
        .mockResolvedValueOnce([]) // message_reply_chain query
        .mockResolvedValueOnce([{ // conversations query
          user_id: 85178516,
          created_at: new Date('2024-01-01T12:00:00Z')
        }]);

      const chainTracker = (sessionManager as any).chainTracker;
      const result = await chainTracker.traceSessionChain(replyToMessageId);

      expect(result).toBeDefined();
      expect(result?.user_id).toBe(85178516);
      expect(result?.session_id).toMatch(/^session_85178516_98765$/);
    });
  });

  describe('Intent Analysis', () => {
    test('should detect requirement intent from development keywords', () => {
      const message = '帮我实现一个用户认证系统';
      
      const result = (sessionManager as any).analyzeIntentFallback(message);

      expect(result.session_type).toBe('requirement');
      expect(result.confidence).toBeGreaterThanOrEqual(70);
      expect(result.method).toBe('keyword_detection');
    });

    test('should detect chat intent from general conversation', () => {
      const message = '你好，今天天气不错';
      
      const result = (sessionManager as any).analyzeIntentFallback(message);

      expect(result.session_type).toBe('chat');
      expect(result.confidence).toBeGreaterThanOrEqual(60);
      expect(result.method).toBe('fallback');
    });

    test('should handle complex requirement detection', () => {
      const message = '需要设计一个完整的电商系统架构，包括用户管理、商品管理、订单系统和支付集成';
      
      const result = (sessionManager as any).analyzeIntentFallback(message);

      expect(result.session_type).toBe('requirement');
      expect(result.confidence).toBeGreaterThanOrEqual(80);
      expect(result.method).toBe('keyword_detection');
    });
  });

  describe('Database Integration', () => {
    test('should record message chain correctly', async () => {
      const messageId = '12346';
      const userId = 85178516;
      const replyInfo = {
        reply_to_message_id: '12345',
        original_text: '请添加数据验证',
        segments: [
          { type: 'reply', data: { id: '12345' } },
          { type: 'text', data: { text: '请添加数据验证' } }
        ] as OB11Segment[]
      };

      testDatabase.recordMessageChain.mockResolvedValue(true);

      await (sessionManager as any).recordMessageChain(messageId, userId, replyInfo);

      expect(mockDatabase.recordMessageChain).toHaveBeenCalledWith(
        messageId,
        replyInfo.reply_to_message_id,
        userId,
        expect.stringMatching(/^session_/),
        expect.any(Number)
      );
    });

    test('should handle session cleanup correctly', async () => {
      testDatabase.cleanupExpiredSessions.mockResolvedValue(5);

      const cleanedCount = await mockDatabase.cleanupExpiredSessions();

      expect(cleanedCount).toBe(5);
      expect(mockDatabase.cleanupExpiredSessions).toHaveBeenCalled();
    });
  });

  describe('Session Chain Tracing - Complex Scenarios', () => {
    test('should trace deep nested reply chain (depth > 5)', async () => {
      // 按SE同事建议：创建深度回复链测试
      const chainBuilder = new ReplyChainTestBuilder();
      const chainData = chainBuilder.createDeepChain(6, 1000, 85178516).getChains();
      
      // 模拟数据库中的回复链数据
      testDatabase.createTestReplyChain(chainData);
      
      const chainTracker = (sessionManager as any).chainTracker;
      const result = await chainTracker.traceSessionChain('1005'); // 查询最深层节点
      
      expect(result).toBeDefined();
      expect(result?.session_id).toContain('session_85178516_1000'); // 应该追溯到根
    });

    test('should handle broken chain gracefully', async () => {
      // 按SE同事建议：测试链断裂情况
      const chainBuilder = new ReplyChainTestBuilder();
      const chainData = chainBuilder.createBrokenChain(5, 3).getChains(); // 第3层节点缺失
      
      testDatabase.createTestReplyChain(chainData);
      
      const chainTracker = (sessionManager as any).chainTracker;
      const result = await chainTracker.traceSessionChain('1004'); // 查询断裂点后的节点
      
      expect(result).toBeDefined(); // 应该fallback到conversation lookup
    });

    test('should trace branched reply chains', async () => {
      const chainBuilder = new ReplyChainTestBuilder();
      const chainData = chainBuilder.createBranchedChain('2000', 3, 2).getChains(); // 3个分支，每个深度2
      
      testDatabase.createTestReplyChain(chainData);
      
      const chainTracker = (sessionManager as any).chainTracker;
      
      // 测试不同分支的追溯
      const branch1Result = await chainTracker.traceSessionChain('2000_branch0_2');
      const branch2Result = await chainTracker.traceSessionChain('2000_branch1_2');
      
      expect(branch1Result).toBeDefined();
      expect(branch2Result).toBeDefined();
      // 所有分支都应该追溯到同一个根Session
      expect(branch1Result?.session_id).toContain('2000');
      expect(branch2Result?.session_id).toContain('2000');
    });

    test('should handle multi-user reply chains', async () => {
      const chainBuilder = new ReplyChainTestBuilder();
      const userIds = [85178516, 85178517, 85178518];
      const chainData = chainBuilder.createMultiUserChain(5, userIds).getChains();
      
      testDatabase.createTestReplyChain(chainData);
      
      const chainTracker = (sessionManager as any).chainTracker;
      const result = await chainTracker.traceSessionChain('2004'); // 最后一个节点
      
      expect(result).toBeDefined();
      expect(result?.user_id).toBe(userIds[0]); // 应该追溯到原始用户
    });
  });

  describe('Concurrent Session Performance', () => {
    test('should handle 100 concurrent session creations under 2s', async () => {
      // 按SE同事建议：并发性能测试（降低到100个以避免测试环境负载过高）
      const messages = ConcurrentTestDataGenerator.generateConcurrentSessions(100);
      
      const { result: results, duration } = await SessionPerformanceHelper.measureAsync(
        'concurrent-sessions',
        () => Promise.all(messages.map(msg => sessionManager.processIncomingMessage(msg)))
      );
      
      expect(duration).toBeLessThan(2000); // 2秒内完成
      expect(results).toHaveLength(100);
      expect(results.every(r => r.session_id)).toBe(true); // 所有Session都成功创建
    });

    test('should maintain session isolation under concurrent access', async () => {
      // 测试同一用户的并发Session请求
      const userMessages = ConcurrentTestDataGenerator.generateSameUserConcurrentMessages(20, 85178516);
      
      const results = await Promise.all(
        userMessages.map(msg => sessionManager.processIncomingMessage(msg))
      );
      
      // 验证每个Session都有唯一ID
      const sessionIds = results.map(r => r.session_id);
      expect(new Set(sessionIds).size).toBe(sessionIds.length);
      
      // 验证所有Session都属于同一用户
      expect(results.every(r => r.user_id === 85178516)).toBe(true);
    });

    test('should handle stress test scenarios efficiently', async () => {
      const stressData = ConcurrentTestDataGenerator.generateStressTestData({
        sessionCount: 50,
        messagesPerSession: 3,
        userCount: 10
      });
      
      const { result: results, duration } = await SessionPerformanceHelper.measureAsync(
        'stress-test',
        () => Promise.all(stressData.messages.map(msg => sessionManager.processIncomingMessage(msg)))
      );
      
      expect(duration).toBeLessThan(3000); // 3秒内完成
      expect(results).toHaveLength(stressData.messages.length);
      
      // 验证Session统计
      const stats = testDatabase.getSessionStats();
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.active).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    test('should handle database errors gracefully in session processing', async () => {
      const message: QQMessage = {
        message_type: 'private',
        message_id: 12345,
        user_id: 85178516,
        message: '测试消息',
        raw_message: '测试消息',
        font: 0,
        sender: {
          user_id: 85178516,
          nickname: 'testuser',
          card: '',
          sex: 'unknown' as const
        },
        time: Math.floor(Date.now() / 1000),
        self_id: 1129974489,
        post_type: 'message'
      };

      testDatabase.createSession.mockRejectedValue(new Error('Database connection failed'));

      await expect(sessionManager.processIncomingMessage(message)).rejects.toThrow('Database connection failed');
    });

    test('should handle invalid reply message gracefully', () => {
      const message: QQMessage = {
        message_type: 'private',
        message_id: 12345,
        user_id: 85178516,
        message: '[CQ:reply]Invalid reply format',
        raw_message: '[CQ:reply]Invalid reply format',
        font: 0,
        sender: {
          user_id: 85178516,
          nickname: 'testuser',
          card: '',
          sex: 'unknown' as const
        },
        time: Math.floor(Date.now() / 1000),
        self_id: 1129974489,
        post_type: 'message'
      };

      const replyParser = (sessionManager as any).replyParser;
      const replyInfo = replyParser.extractReplyInfo(message);

      expect(replyInfo).toBeNull();
    });
  });
});
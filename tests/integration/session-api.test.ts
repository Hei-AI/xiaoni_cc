import request from 'supertest';
import express from 'express';
import { SessionApiHandlers } from '../../src/services/session-api-handlers';
import { TestDatabaseManager } from '../mocks/TestDatabaseManager';
import { createMockPrivateMessage } from '../helpers/test-messages';
import { ReplyChainTestBuilder } from '../helpers/chain-test-helpers';

/**
 * Session API 集成测试
 * 按照SE同事建议使用supertest测试Session API endpoints
 */
describe('Session API Integration Tests', () => {
  let app: express.Application;
  let testDatabase: TestDatabaseManager;
  let sessionApiHandlers: SessionApiHandlers;

  beforeAll(async () => {
    // 初始化Express应用
    app = express();
    app.use(express.json());
    
    // 初始化测试数据库
    testDatabase = new TestDatabaseManager();
    sessionApiHandlers = new SessionApiHandlers(testDatabase as any);

    // 设置API路由 - 按照现有HTTP server结构
    app.get('/api/sessions', sessionApiHandlers.handleGetSessions.bind(sessionApiHandlers));
    app.get('/api/sessions/:id', sessionApiHandlers.handleGetSession.bind(sessionApiHandlers));
    app.post('/api/sessions/:id/switch-service', sessionApiHandlers.handleSwitchSessionService.bind(sessionApiHandlers));
    app.post('/api/sessions/cleanup', sessionApiHandlers.handleCleanupSessions.bind(sessionApiHandlers));

    // 添加健康检查端点
    app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          database: 'connected',
          session_manager: 'active'
        }
      });
    });
  });

  beforeEach(async () => {
    // 每个测试前清理数据
    testDatabase.clearTestData();
  });

  afterAll(async () => {
    // 清理资源
    testDatabase.clearTestData();
  });

  describe('Health and Status Endpoints', () => {
    test('GET /health should return healthy status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        services: {
          database: 'connected',
          session_manager: 'active'
        }
      });
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('Session Management API Endpoints', () => {
    beforeEach(async () => {
      // 为每个测试创建预设Session数据
      await testDatabase.createSession({
        session_id: 'session_85178516_1',
        user_id: 85178516,
        session_type: 'chat'
      });
      await testDatabase.createSession({
        session_id: 'session_85178516_2', 
        user_id: 85178516,
        session_type: 'requirement'
      });
      await testDatabase.createSession({
        session_id: 'session_85178517_1',
        user_id: 85178517, 
        session_type: 'chat'
      });
    });

    test('GET /api/sessions should return all sessions with pagination', async () => {
      const response = await request(app)
        .get('/api/sessions')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        total: 3
      });
      expect(response.body.data).toHaveLength(3);
      expect(response.body.data[0]).toHaveProperty('session_id');
      expect(response.body.data[0]).toHaveProperty('user_id');
      expect(response.body.data[0]).toHaveProperty('session_type');
    });

    test('GET /api/sessions?user_id=85178516 should filter sessions by user', async () => {
      const response = await request(app)
        .get('/api/sessions?user_id=85178516')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        total: 2
      });
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.every((session: any) => session.user_id === 85178516)).toBe(true);
    });

    test('GET /api/sessions?status=active should filter sessions by status', async () => {
      const response = await request(app)
        .get('/api/sessions?status=active')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        total: 3 // 所有预设的Session都是active状态
      });
      expect(response.body.data.every((session: any) => session.status === 'active')).toBe(true);
    });

    test('GET /api/sessions?limit=2 should respect limit parameter', async () => {
      const response = await request(app)
        .get('/api/sessions?limit=2')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        total: 2
      });
      expect(response.body.data).toHaveLength(2);
    });

    test('GET /api/sessions/:id should return specific session', async () => {
      const response = await request(app)
        .get('/api/sessions/session_85178516_1')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true
      });
      expect(response.body.data).toMatchObject({
        session_id: 'session_85178516_1',
        user_id: 85178516,
        session_type: 'chat',
        status: 'active'
      });
    });

    test('GET /api/sessions/:id should return 404 for non-existent session', async () => {
      const response = await request(app)
        .get('/api/sessions/nonexistent_session')
        .expect(404);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Session not found'
      });
    });
  });

  describe('Session Service Management', () => {
    beforeEach(async () => {
      await testDatabase.createSession('session_test_switch', 85178516, 'chat', 'gemini_ai');
    });

    test('POST /api/sessions/:id/switch-service should switch session service', async () => {
      const response = await request(app)
        .post('/api/sessions/session_test_switch/switch-service')
        .send({
          service: 'claude_code',
          reason: 'User requested to switch to development mode'
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Session service switched successfully'
      });

      // 验证服务确实已切换
      const sessionResponse = await request(app)
        .get('/api/sessions/session_test_switch')
        .expect(200);

      expect(sessionResponse.body.data.current_service).toBe('claude_code');
      expect(sessionResponse.body.data.service_transitions).toHaveLength(1);
      expect(sessionResponse.body.data.service_transitions[0]).toMatchObject({
        from_service: 'gemini_ai',
        to_service: 'claude_code',
        reason: 'User requested to switch to development mode'
      });
    });

    test('POST /api/sessions/:id/switch-service should return 400 for missing service parameter', async () => {
      const response = await request(app)
        .post('/api/sessions/session_test_switch/switch-service')
        .send({
          reason: 'Missing service parameter test'
        })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Missing required parameter: service'
      });
    });

    test('POST /api/sessions/:id/switch-service should return 404 for non-existent session', async () => {
      const response = await request(app)
        .post('/api/sessions/nonexistent_session/switch-service')
        .send({
          service: 'gemini_ai'
        })
        .expect(404);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Session not found or switch failed'
      });
    });
  });

  describe('Session Cleanup Operations', () => {
    test('POST /api/sessions/cleanup should cleanup expired sessions', async () => {
      // 创建一些已过期的Session
      const expiredDate = new Date(Date.now() - 7200000); // 2小时前
      await testDatabase.createSession('session_expired_1', 85178516, 'chat', 'gemini_ai', 'active', expiredDate);
      await testDatabase.createSession('session_expired_2', 85178517, 'requirement', 'claude_code', 'active', expiredDate);

      const response = await request(app)
        .post('/api/sessions/cleanup')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Sessions cleaned up successfully'
      });
      expect(response.body.cleaned_count).toBeGreaterThanOrEqual(2);

      // 验证过期的Session已被清理
      const remainingSessions = await testDatabase.getSessions();
      const expiredSessionIds = remainingSessions.map(s => s.session_id);
      expect(expiredSessionIds).not.toContain('session_expired_1');
      expect(expiredSessionIds).not.toContain('session_expired_2');
    });

    test('POST /api/sessions/cleanup should handle cleanup with no expired sessions', async () => {
      const response = await request(app)
        .post('/api/sessions/cleanup')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Sessions cleaned up successfully',
        cleaned_count: 0
      });
    });
  });

  describe('Complex Session Chain Scenarios', () => {
    test('should handle session chain API operations', async () => {
      // 创建复杂的回复链
      const chainBuilder = new ReplyChainTestBuilder();
      const chainData = chainBuilder.createDeepChain(5, 3000, 85178516).getChains();
      
      // 设置测试数据
      testDatabase.createTestReplyChain(chainData);
      await testDatabase.createSession('session_85178516_3000', 85178516, 'requirement');

      // 验证Session可以通过API访问
      const response = await request(app)
        .get('/api/sessions/session_85178516_3000')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.session_id).toBe('session_85178516_3000');

      // 验证可以切换服务
      const switchResponse = await request(app)
        .post('/api/sessions/session_85178516_3000/switch-service')
        .send({
          service: 'gemini_ai',
          reason: 'Chain processing completed, switching to chat mode'
        })
        .expect(200);

      expect(switchResponse.body.success).toBe(true);
    });
  });

  describe('API Error Handling and Edge Cases', () => {
    test('should handle malformed JSON in request body', async () => {
      const response = await request(app)
        .post('/api/sessions/test_session/switch-service')
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(400);

      // Express应该返回JSON解析错误
      expect(response.status).toBe(400);
    });

    test('should handle very large limit parameter', async () => {
      const response = await request(app)
        .get('/api/sessions?limit=99999')
        .expect(200);

      expect(response.body.success).toBe(true);
      // 应该返回所有可用的Session，而不是失败
    });

    test('should handle special characters in session ID', async () => {
      const specialSessionId = 'session_用户_特殊字符_123';
      
      // 先创建这个特殊的Session
      await testDatabase.createSession(specialSessionId, 85178516, 'chat');

      const response = await request(app)
        .get(`/api/sessions/${encodeURIComponent(specialSessionId)}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.session_id).toBe(specialSessionId);
    });

    test('should handle concurrent API requests gracefully', async () => {
      // 创建多个并发Session
      const concurrentCreations = [];
      for (let i = 0; i < 10; i++) {
        concurrentCreations.push(
          testDatabase.createSession(`concurrent_session_${i}`, 85178516 + i, 'chat')
        );
      }
      await Promise.all(concurrentCreations);

      // 并发API调用
      const concurrentRequests = [];
      for (let i = 0; i < 10; i++) {
        concurrentRequests.push(
          request(app).get(`/api/sessions/concurrent_session_${i}`)
        );
      }

      const responses = await Promise.allSettled(concurrentRequests);
      
      // 所有请求都应该成功
      expect(responses.every(r => r.status === 'fulfilled')).toBe(true);
      const successfulResponses = responses.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
      expect(successfulResponses.every(r => r.value.status === 200)).toBe(true);
    });
  });

  describe('Performance and Load Testing', () => {
    test('should handle high-frequency API calls efficiently', async () => {
      // 创建测试数据
      const sessionCount = 50;
      for (let i = 0; i < sessionCount; i++) {
        await testDatabase.createSession(`perf_session_${i}`, 85178516, 'chat');
      }

      // 测量API响应时间
      const startTime = performance.now();
      
      const promises = [];
      for (let i = 0; i < sessionCount; i++) {
        promises.push(request(app).get(`/api/sessions/perf_session_${i}`));
      }
      
      const responses = await Promise.all(promises);
      const endTime = performance.now();
      
      const duration = endTime - startTime;
      
      // 验证性能：50个API调用应该在合理时间内完成
      expect(duration).toBeLessThan(2000); // 2秒内
      expect(responses.every(r => r.status === 200)).toBe(true);
      
      // 计算平均响应时间
      const avgResponseTime = duration / sessionCount;
      expect(avgResponseTime).toBeLessThan(50); // 平均每个请求小于50ms
    });

    test('should handle batch operations efficiently', async () => {
      // 创建大量Session用于批量操作测试
      const batchSize = 100;
      for (let i = 0; i < batchSize; i++) {
        const expiredDate = new Date(Date.now() - 3600000); // 1小时前过期
        await testDatabase.createSession(`batch_session_${i}`, 85178516, 'chat', 'gemini_ai', 'active', expiredDate);
      }

      // 测量批量清理性能
      const startTime = performance.now();
      
      const response = await request(app)
        .post('/api/sessions/cleanup')
        .expect(200);
        
      const duration = performance.now() - startTime;

      expect(response.body.success).toBe(true);
      expect(response.body.cleaned_count).toBe(batchSize);
      expect(duration).toBeLessThan(1000); // 1秒内完成批量清理
    });
  });
});
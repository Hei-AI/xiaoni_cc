import QQBot from '../../src';
import AIService from '../../src/services/ai-service';
import { DatabaseManager, getDatabaseManager } from '../../src/services/database';
import { SessionManager } from '../../src/services/session-manager';
import WebSocketClient from '../../src/services/websocket-client';
import HttpServer from '../../src/services/http-server';
import { QQMessage, ConversationData, RequirementData } from '../../src/types';
import { config } from '../../src/config';
import { createMockQQMessage, createMockSession, TestScenarios, ErrorScenarios } from '../helpers/session-test-factory';

/**
 * AI服务与Session管理集成测试
 * 专为Claude Bot Server Manager同事的Session管理需求设计
 * 基于Gemini API故障排查经验，确保跨服务协调的可靠性
 */

describe('AI Service & Session Management Integration', () => {
  let bot: QQBot;
  let aiService: AIService;
  let sessionManager: SessionManager;
  let databaseManager: DatabaseManager;
  let wsClient: WebSocketClient;
  let httpServer: HttpServer;

  // 测试超时配置
  jest.setTimeout(60000); // 集成测试60秒超时

  beforeAll(async () => {
    // 使用测试数据库配置
    const testConfig = {
      ...config,
      database: {
        ...config.database,
        database: 'qqbot_test_integration'
      }
    };

    // 初始化核心服务
    databaseManager = getDatabaseManager(testConfig.database);
    aiService = new AIService(testConfig.ai, databaseManager);
    sessionManager = new SessionManager(databaseManager);
    wsClient = new WebSocketClient(testConfig.websocket);
    httpServer = new HttpServer(testConfig.http_server, {
      database: databaseManager,
      websocketClient: wsClient
    });

    // 初始化主应用
    bot = new QQBot();
    // Note: 在实际测试中，不需要启动整个机器人，只需要测试特定方法

    // 确保测试数据库连接
    const isConnected = await databaseManager.testConnection();
    if (!isConnected) {
      throw new Error('Integration test database connection failed');
    }
  });

  afterAll(async () => {
    // 清理测试资源
    await httpServer?.stop();
    wsClient?.close();
    await databaseManager?.close();
  });

  beforeEach(async () => {
    // 每个测试前清理测试数据
    await databaseManager.executeUpdate('DELETE FROM conversation_sessions WHERE session_id LIKE "test-%"');
    await databaseManager.executeUpdate('DELETE FROM conversations WHERE id LIKE "test-%"');
    await databaseManager.executeUpdate('DELETE FROM requirements WHERE requirement_id LIKE "test-%"');
    await databaseManager.executeUpdate('DELETE FROM message_reply_chain WHERE session_id LIKE "test-%"');
  });

  describe('Requirement Intent Detection & Session Creation', () => {
    test('should create session when AI detects requirement intent', async () => {
      // 1. 模拟需求消息
      const requirementMessage = createMockQQMessage({
        user_id: 85178516, // 授权用户
        message: '请帮我实现一个用户认证系统，包含登录、注册和权限管理功能',
        message_id: Date.now()
      });

      // 2. 处理消息并触发意图分析
      await bot.handlePrivateMessage(requirementMessage);

      // 3. 验证AI意图分析结果
      const conversations = await databaseManager.getConversations(85178516, 1);
      expect(conversations).toHaveLength(1);
      
      const conversation = conversations[0];
      expect(conversation.user_message).toContain('用户认证系统');
      
      // 4. 验证Session创建
      const sessions = await sessionManager.getSessions(85178516);
      expect(sessions).toHaveLength(1);
      
      const session = sessions[0];
      expect(session.current_service).toBe('requirement_service');
      expect(session.status).toBe('active');
      expect(session.message_count).toBeGreaterThan(0);

      // 5. 验证Requirements表记录
      const requirements = await databaseManager.getRequirements(85178516);
      expect(requirements).toHaveLength(1);
      
      const requirement = requirements[0];
      expect(requirement.status).toBe('pending');
      expect(requirement.user_message).toContain('用户认证系统');
    });

    test('should handle session service switching based on AI intent changes', async () => {
      // 1. 创建初始聊天Session
      const chatMessage = createMockQQMessage({
        user_id: 85178516,
        message: '你好，今天天气怎么样？'
      });

      await bot.handlePrivateMessage(chatMessage);

      // 验证聊天Session
      let sessions = await sessionManager.getSessions(85178516);
      expect(sessions[0].current_service).toBe('chat_service');

      // 2. 发送需求转换消息
      const switchMessage = createMockQQMessage({
        user_id: 85178516,
        message: '其实我想请你帮我开发一个新的功能模块'
      });

      await bot.handlePrivateMessage(switchMessage);

      // 3. 验证服务切换
      sessions = await sessionManager.getSessions(85178516, 10, 'active');
      const activeSession = sessions.find(s => s.status === 'active');
      expect(activeSession.current_service).toBe('requirement_service');
      
      // 验证service_transitions记录
      expect(activeSession.service_transitions).toBeDefined();
      const transitions = JSON.parse(activeSession.service_transitions || '[]');
      expect(transitions).toHaveLength(1);
      expect(transitions[0].from_service).toBe('chat_service');
      expect(transitions[0].to_service).toBe('requirement_service');
    });
  });

  describe('Message Chain Tracking Integration', () => {
    test('should maintain message chain consistency across AI responses', async () => {
      // 使用测试场景工厂
      const chainScenario = TestScenarios.createSessionChainScenario();
      
      // 1. 创建Session
      await sessionManager.createSession(chainScenario.session);

      // 2. 模拟消息链处理
      const messages = [
        createMockQQMessage({ message: '第一条消息', message_id: 1001 }),
        createMockQQMessage({ message: '第二条消息', message_id: 1002 }),
        createMockQQMessage({ message: '第三条消息', message_id: 1003 })
      ];

      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        
        // 处理消息
        await bot.handlePrivateMessage(message);
        
        // 验证消息链记录
        const chainRecords = await databaseManager.executeQuery(
          'SELECT * FROM message_reply_chain WHERE session_id = ? ORDER BY depth',
          [chainScenario.session.session_id]
        );

        expect(chainRecords).toHaveLength(i + 1);
        
        // 验证深度递增
        if (i > 0) {
          expect(chainRecords[i].depth).toBe(chainRecords[i - 1].depth + 1);
          expect(chainRecords[i].reply_to_message_id).toBe(chainRecords[i - 1].message_id);
        }
      }
    });

    test('should handle concurrent message processing without chain corruption', async () => {
      // 并发场景测试
      const concurrentUsers = TestScenarios.createConcurrentSessionScenario(3);
      
      // 1. 并发创建多个用户的Session
      const sessionPromises = concurrentUsers.flatMap(user => 
        user.sessions.map(session => sessionManager.createSession(session))
      );
      
      await Promise.all(sessionPromises);

      // 2. 并发发送消息
      const messagePromises = concurrentUsers.map((user, userIndex) => {
        return Promise.all([
          bot.handlePrivateMessage(createMockQQMessage({ 
            user_id: user.userId, 
            message: `用户${userIndex}的消息1` 
          })),
          bot.handlePrivateMessage(createMockQQMessage({ 
            user_id: user.userId, 
            message: `用户${userIndex}的消息2` 
          }))
        ]);
      });

      await Promise.all(messagePromises);

      // 3. 验证每个用户的消息链完整性
      for (const user of concurrentUsers) {
        const userChains = await databaseManager.executeQuery(
          'SELECT * FROM message_reply_chain WHERE user_id = ? ORDER BY depth',
          [user.userId]
        );

        expect(userChains.length).toBeGreaterThanOrEqual(2); // 至少两条消息
        
        // 验证深度连续性
        for (let i = 1; i < userChains.length; i++) {
          expect(userChains[i].depth).toBe(userChains[i - 1].depth + 1);
        }
      }
    });
  });

  describe('Error Recovery Integration', () => {
    test('should recover from database connection failures gracefully', async () => {
      // 模拟数据库连接失败
      const originalExecute = databaseManager.execute;
      const failureCount = { count: 0 };
      
      databaseManager.execute = jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
        failureCount.count++;
        if (failureCount.count <= 2) {
          throw new Error('Database connection lost');
        }
        // 恢复正常
        return originalExecute.call(databaseManager, sql, params);
      });

      // 发送消息，应该触发重试机制
      const message = createMockQQMessage({
        user_id: 85178516,
        message: '测试数据库恢复功能'
      });

      // 不应该抛出错误
      await expect(bot.handlePrivateMessage(message)).resolves.not.toThrow();

      // 验证最终成功处理
      expect(failureCount.count).toBe(3); // 2次失败 + 1次成功

      // 恢复原方法
      databaseManager.execute = originalExecute;
    });

    test('should handle AI service failures with fallback responses', async () => {
      // 模拟Gemini API失败
      const originalGenerateResponse = aiService.generateResponse;
      aiService.generateResponse = jest.fn().mockRejectedValue(new Error('Gemini API unavailable'));

      const message = createMockQQMessage({
        user_id: 85178516,
        message: '测试AI服务故障恢复'
      });

      // 应该发送fallback响应而不是抛出错误
      await bot.handlePrivateMessage(message);

      // 验证conversation记录了fallback响应
      const conversations = await databaseManager.getConversations(85178516, 1);
      expect(conversations).toHaveLength(1);
      expect(conversations[0].ai_response).toContain('服务暂时不可用');

      // 恢复原方法
      aiService.generateResponse = originalExecute;
    });

    test('should handle timestamp type errors from cache', async () => {
      // 使用错误场景工厂
      const invalidSession = ErrorScenarios.createTimestampErrorScenario();
      
      // 手动插入有问题的数据
      await databaseManager.executeUpdate(
        'INSERT INTO conversation_sessions SET ?',
        [{
          ...invalidSession,
          updated_at: '2025-09-01T10:00:00.000Z' // 字符串格式时间戳
        }]
      );

      const message = createMockQQMessage({
        user_id: invalidSession.user_id,
        message: '测试时间戳类型处理'
      });

      // 不应该因为时间戳类型错误而失败
      await expect(bot.handlePrivateMessage(message)).resolves.not.toThrow();

      // 验证Session被正确更新
      const session = await sessionManager.getSessionById(invalidSession.session_id);
      expect(session).toBeDefined();
      expect(session!.updated_at).toBeInstanceOf(Date); // 应该被转换为Date对象
    });
  });

  describe('Performance & Resource Management', () => {
    test('should maintain response time under load', async () => {
      // 性能测试配置
      const messageCount = 50;
      const concurrentUsers = 5;
      const maxResponseTime = 5000; // 5秒

      // 创建并发用户消息
      const messages: QQMessage[] = [];
      for (let user = 0; user < concurrentUsers; user++) {
        for (let msg = 0; msg < messageCount / concurrentUsers; msg++) {
          messages.push(createMockQQMessage({
            user_id: 85178516 + user,
            message: `性能测试消息 ${msg + 1}`,
            message_id: Date.now() + user * 1000 + msg
          }));
        }
      }

      // 测量处理时间
      const startTime = Date.now();
      
      // 并发处理所有消息
      await Promise.all(
        messages.map(message => bot.handlePrivateMessage(message))
      );
      
      const processingTime = Date.now() - startTime;

      // 验证性能要求
      expect(processingTime).toBeLessThan(maxResponseTime);
      console.log(`Processed ${messageCount} messages in ${processingTime}ms`);

      // 验证所有消息都被正确处理
      for (let user = 0; user < concurrentUsers; user++) {
        const userConversations = await databaseManager.getConversations(85178516 + user, 20);
        expect(userConversations.length).toBeGreaterThan(0);
      }
    });

    test('should cleanup expired sessions automatically', async () => {
      // 创建过期Session
      const expiredSession = TestScenarios.createExpiredSessionScenario();
      await sessionManager.createSession(expiredSession);

      // 创建活跃Session
      const activeSession = createMockSession({
        status: 'active',
        last_activity: new Date() // 当前时间
      });
      await sessionManager.createSession(activeSession);

      // 触发清理任务
      const cleanedCount = await sessionManager.cleanupExpiredSessions();

      // 验证清理结果
      expect(cleanedCount).toBe(1);

      // 验证过期Session被清理
      const expiredCheck = await sessionManager.getSessionById(expiredSession.session_id);
      expect(expiredCheck).toBeNull();

      // 验证活跃Session保留
      const activeCheck = await sessionManager.getSessionById(activeSession.session_id);
      expect(activeCheck).toBeDefined();
      expect(activeCheck!.status).toBe('active');
    });
  });

  describe('HTTP API Integration', () => {
    test('should expose session management through REST API', async () => {
      // 启动HTTP服务器
      await httpServer.start();

      // 创建测试Session
      const testSession = createMockSession();
      await sessionManager.createSession(testSession);

      // 通过API查询Session
      const response = await fetch(`http://localhost:${config.http_server.port}/api/sessions?user_id=${testSession.user_id}`);
      
      expect(response.status).toBe(200);
      
      const sessions = await response.json();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].session_id).toBe(testSession.session_id);

      // 测试Session状态更新API
      const updateResponse = await fetch(
        `http://localhost:${config.http_server.port}/api/sessions/${testSession.session_id}/activity`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message_count: 5 })
        }
      );

      expect(updateResponse.status).toBe(200);

      // 验证更新生效
      const updatedSession = await sessionManager.getSessionById(testSession.session_id);
      expect(updatedSession!.message_count).toBe(5);
    });
  });

  describe('System Health Integration', () => {
    test('should report comprehensive system health status', async () => {
      // 获取健康检查状态
      const response = await fetch(`http://localhost:${config.http_server.port}/health`);
      
      expect(response.status).toBe(200);
      
      const healthStatus = await response.json();
      
      // 验证健康检查包含所有关键组件
      expect(healthStatus).toHaveProperty('status');
      expect(healthStatus).toHaveProperty('database_connected');
      expect(healthStatus).toHaveProperty('websocket_connected');
      expect(healthStatus).toHaveProperty('ai_service_available');
      expect(healthStatus).toHaveProperty('session_manager_ready');
      
      // 验证所有组件状态
      expect(healthStatus.database_connected).toBe(true);
      expect(healthStatus.session_manager_ready).toBe(true);
      expect(['healthy', 'degraded']).toContain(healthStatus.status);
    });
  });
});
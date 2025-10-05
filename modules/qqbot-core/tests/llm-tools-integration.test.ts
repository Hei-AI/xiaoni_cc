/**
 * LLM 工具系统集成测试
 *
 * 测试范围：
 * 1. AIService.generateContent() 方法
 * 2. LLMJobWorker 创建和处理 Job
 * 3. 消息流集成（handleEnhancedAIConversation → LLMJob）
 * 4. 事件监听和响应发送
 */

import { DatabaseManager } from '../src/services/database';
import { AIService } from '../src/services/ai-service';
import { LLMJobWorker } from '../src/services/llm-job-worker';
import { FunctionCallDispatcher } from '../src/services/function-call-dispatcher';
import { ToolRegistryService } from '../src/services/tool-registry-service';
import { STATIC_TOOLS } from '../src/tools/static-tools';
import { logger } from '../src/utils/logger';

const moduleLogger = logger.createModuleLogger('llm-tools-integration-test');

describe('LLM Tools Integration Tests', () => {
  let database: DatabaseManager;
  let aiService: AIService;
  let toolRegistry: ToolRegistryService;
  let dispatcher: FunctionCallDispatcher;
  let jobWorker: LLMJobWorker;

  beforeAll(async () => {
    // 初始化数据库
    database = new DatabaseManager({
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      database: process.env.MYSQL_DATABASE || 'qqbot_db',
      user: process.env.MYSQL_USER || 'qqbot_user',
      password: process.env.MYSQL_PASSWORD || 'qqbot_password'
    } as any);

    const connected = await database.testConnection();
    if (!connected) {
      throw new Error('Database connection failed');
    }

    // 初始化 AIService (需要 LoggingService)
    const loggingService = {
      logLLMCall: jest.fn().mockResolvedValue(undefined),
      logEventStart: jest.fn().mockResolvedValue(undefined),
      logEventEnd: jest.fn().mockResolvedValue(undefined)
    } as any;

    aiService = new AIService(
      {
        gemini_api_keys: (process.env.GEMINI_API_KEYS || '').split(','),
        model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp',
        authorized_user_id: parseInt(process.env.AUTHORIZED_USER_ID || '0'),
        bot_qq_number: parseInt(process.env.BOT_QQ_NUMBER || '0')
      } as any,
      database,
      loggingService
    );

    // 初始化工具系统
    toolRegistry = new ToolRegistryService(database);
    dispatcher = new FunctionCallDispatcher(toolRegistry);
    dispatcher.registerStaticTools(STATIC_TOOLS);

    jobWorker = new LLMJobWorker(database, dispatcher, aiService, {
      maxConcurrentJobs: 2,
      pollIntervalMs: 500,
      jobTimeoutMs: 60000,
      retryDelayMs: 1000
    });
  });

  afterAll(async () => {
    if (jobWorker) {
      const stats = jobWorker.getStats();
      if (stats.isRunning) {
        await jobWorker.stop();
      }
    }
    if (database) {
      await database.close();
    }
  });

  describe('AIService.generateContent()', () => {
    it('should call Gemini API with tools', async () => {
      const request = {
        contents: [
          {
            role: 'user',
            parts: [{ text: '现在几点了？' }]
          }
        ],
        tools: dispatcher.getStaticToolDeclarations()
      };

      const traceId = `test-trace-${Date.now()}`;

      try {
        const response = await aiService.generateContent(request, traceId);

        expect(response).toBeDefined();
        expect(response.candidates).toBeDefined();
        expect(Array.isArray(response.candidates)).toBe(true);

        moduleLogger.info('AIService.generateContent() test passed', {
          hasCandidates: response.candidates.length > 0
        });
      } catch (error: any) {
        // 如果是 API token 问题，跳过测试
        if (error.message.includes('No available tokens')) {
          moduleLogger.warn('Skipping test: No API tokens available');
          return;
        }
        throw error;
      }
    }, 30000);

    it('should handle function calls in response', async () => {
      const request = {
        contents: [
          {
            role: 'user',
            parts: [{ text: '计算 123 + 456' }]
          }
        ],
        tools: dispatcher.getStaticToolDeclarations()
      };

      const traceId = `test-trace-${Date.now()}`;

      try {
        const response = await aiService.generateContent(request, traceId);

        expect(response).toBeDefined();

        // 检查是否包含函数调用
        if (response.candidates?.[0]?.content?.parts) {
          const parts = response.candidates[0].content.parts;
          const hasFunctionCall = parts.some((p: any) => p.functionCall);

          moduleLogger.info('Function call test result', {
            hasFunctionCall,
            parts: JSON.stringify(parts, null, 2)
          });
        }
      } catch (error: any) {
        if (error.message.includes('No available tokens')) {
          moduleLogger.warn('Skipping test: No API tokens available');
          return;
        }
        throw error;
      }
    }, 30000);
  });

  describe('LLMJobWorker Job Creation', () => {
    it('should create a job successfully', async () => {
      const jobId = await jobWorker.createJob({
        traceId: `test-trace-${Date.now()}`,
        sourceKey: 'user_12345',
        sourceType: 'private',
        contents: [
          {
            role: 'user',
            parts: [{ text: '你好' }]
          }
        ],
        metadata: {
          userId: 12345,
          messageType: 'private'
        }
      });

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');

      moduleLogger.info('Job created successfully', { jobId });

      // 验证 Job 已写入数据库
      const connection = await (database as any).pool.getConnection();
      const [rows] = await connection.query(
        'SELECT * FROM llm_jobs WHERE id = ?',
        [jobId]
      );
      connection.release();

      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe('pending');
    });

    it('should handle job metadata correctly', async () => {
      const metadata = {
        conversationId: 'conv-123',
        userId: 12345,
        groupId: 67890,
        sessionId: 'session-456',
        messageId: 789,
        messageType: 'group'
      };

      const jobId = await jobWorker.createJob({
        traceId: `test-trace-${Date.now()}`,
        sourceKey: 'group_67890',
        sourceType: 'group',
        contents: [
          {
            role: 'user',
            parts: [{ text: '测试消息' }]
          }
        ],
        metadata
      });

      // 验证 metadata 正确保存
      const connection = await (database as any).pool.getConnection();
      const [rows] = await connection.query(
        'SELECT metadata FROM llm_jobs WHERE id = ?',
        [jobId]
      );
      connection.release();

      const savedMetadata = JSON.parse(rows[0].metadata);
      expect(savedMetadata).toEqual(metadata);
    });
  });

  describe('Event Emission', () => {
    it('should emit job_created event', async () => {
      const eventPromise = new Promise((resolve) => {
        jobWorker.once('job_created', (event: any) => {
          resolve(event);
        });
      });

      const traceId = `test-trace-${Date.now()}`;
      const jobId = await jobWorker.createJob({
        traceId,
        sourceKey: 'user_99999',
        sourceType: 'private',
        contents: [
          {
            role: 'user',
            parts: [{ text: '测试事件' }]
          }
        ]
      });

      const event: any = await eventPromise;

      expect(event.jobId).toBe(jobId);
      expect(event.traceId).toBe(traceId);
    });
  });

  describe('Static Tools', () => {
    it('should have registered static tools', () => {
      const staticDeclarations = dispatcher.getStaticToolDeclarations();

      expect(Array.isArray(staticDeclarations)).toBe(true);
      expect(staticDeclarations.length).toBeGreaterThan(0);

      const toolNames = staticDeclarations.map((t: any) => t.name);
      expect(toolNames).toContain('get_current_time');
      expect(toolNames).toContain('calculate');
      expect(toolNames).toContain('log_memo');

      moduleLogger.info('Static tools registered', { toolNames });
    });

    it('should dispatch static tool calls', async () => {
      const result = await dispatcher.dispatch(
        {
          name: 'get_current_time',
          args: { format: 'iso' }
        },
        {
          traceId: `test-trace-${Date.now()}`,
          jobId: undefined,
          userId: undefined,
          sourceKey: 'test'
        }
      );

      expect(result.shouldContinue).toBe(true);
      expect(result.functionResponse).toBeDefined();

      moduleLogger.info('Static tool dispatch result', { result });
    });
  });

  describe('Worker Stats', () => {
    it('should provide worker statistics', () => {
      const stats = jobWorker.getStats();

      expect(stats).toBeDefined();
      expect(typeof stats.activeJobs).toBe('number');
      expect(typeof stats.maxConcurrentJobs).toBe('number');
      expect(typeof stats.isRunning).toBe('boolean');

      moduleLogger.info('Worker stats', stats);
    });
  });

  describe('Job Completion Events', () => {
    it('should emit job_completed with finalResponse and metadata', async () => {
      // 准备测试数据
      const testMetadata = {
        conversationId: 'conv-test-123',
        userId: 12345,
        messageType: 'private',
        messageId: 789
      };

      const traceId = `test-trace-${Date.now()}`;

      // 监听事件
      const eventPromise = new Promise<any>((resolve) => {
        jobWorker.once('job_completed', (event: any) => {
          resolve(event);
        });
      });

      // 创建并启动 job（模拟简单对话，不触发函数调用）
      const jobId = await jobWorker.createJob({
        traceId,
        sourceKey: 'user_12345',
        sourceType: 'private',
        contents: [
          {
            role: 'user',
            parts: [{ text: '你好，请回复一句话' }]
          }
        ],
        metadata: testMetadata
      });

      // 启动 worker 处理
      if (!jobWorker.getStats().isRunning) {
        jobWorker.start();
      }

      // 等待事件（最多30秒）
      const event = await Promise.race([
        eventPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Event timeout')), 30000)
        )
      ]);

      // 验证事件包含必要字段
      expect(event.jobId).toBe(jobId);
      expect(event.traceId).toBe(traceId);
      expect(event.finalResponse).toBeDefined();
      expect(typeof event.finalResponse).toBe('string');
      expect(event.metadata).toBeDefined();
      expect(event.metadata).toEqual(testMetadata);

      moduleLogger.info('job_completed event verified', {
        hasFinalResponse: !!event.finalResponse,
        hasMetadata: !!event.metadata
      });
    }, 40000);

    it('should emit job_failed with error and metadata on failure', async () => {
      const testMetadata = {
        conversationId: 'conv-fail-test',
        userId: 99999,
        messageType: 'private'
      };

      const traceId = `test-trace-fail-${Date.now()}`;

      // 监听失败事件
      const eventPromise = new Promise<any>((resolve) => {
        jobWorker.once('job_failed', (event: any) => {
          resolve(event);
        });
      });

      // 创建一个可能失败的 job（使用无效内容或超过重试次数）
      const connection = await (database as any).pool.getConnection();
      const fakeJobId = `fake-job-${Date.now()}`;

      // 直接插入一个会失败的 job（max_retries=0，确保快速失败）
      await connection.query(
        `INSERT INTO llm_jobs (
          id, trace_id, source_key, source_type, status,
          retry_count, max_retries, contents_json, metadata,
          current_turn, max_turns, created_at, updated_at
        ) VALUES (?, ?, 'user_99999', 'private', 'pending', 0, 0, '[]', ?, 1, 10, NOW(), NOW())`,
        [fakeJobId, traceId, JSON.stringify(testMetadata)]
      );
      connection.release();

      // 等待失败事件
      const event: any = await Promise.race([
        eventPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Event timeout')), 20000)
        )
      ]);

      // 验证失败事件
      expect(event.jobId).toBe(fakeJobId);
      expect(event.traceId).toBe(traceId);
      expect(event.error).toBeDefined();
      expect(typeof event.error).toBe('string');
      expect(event.metadata).toBeDefined();
      expect(event.metadata).toEqual(testMetadata);

      moduleLogger.info('job_failed event verified', {
        error: event.error,
        hasMetadata: !!event.metadata
      });
    }, 30000);
  });

  describe('Dynamic Tools (Search and Invoke)', () => {
    beforeAll(async () => {
      // 插入测试工具数据到数据库
      const connection = await (database as any).pool.getConnection();

      try {
        // 清理旧测试数据
        await connection.query("DELETE FROM llm_tools WHERE method_id LIKE 'test_%'");

        // 插入测试工具
        await connection.query(
          `INSERT INTO llm_tools (
            method_id, name, description, params_schema, category, tags,
            side_effect, expect_response, timeout_ms, enabled,
            total_calls, success_calls, failed_calls, avg_duration_ms,
            created_at, updated_at
          ) VALUES
          ('test_get_weather', '获取天气', '获取指定城市的天气信息', ?, 'query', ?, false, true, 5000, true, 0, 0, 0, 0, NOW(), NOW()),
          ('test_send_notification', '发送通知', '发送系统通知给用户', ?, 'action', ?, true, false, 3000, true, 0, 0, 0, 0, NOW(), NOW())`,
          [
            JSON.stringify({
              type: 'object',
              properties: {
                city: { type: 'string', description: '城市名称' }
              },
              required: ['city']
            }),
            JSON.stringify(['weather', 'query']),
            JSON.stringify({
              type: 'object',
              properties: {
                message: { type: 'string', description: '通知内容' }
              },
              required: ['message']
            }),
            JSON.stringify(['notification', 'system'])
          ]
        );

        moduleLogger.info('Test tools inserted into database');
      } finally {
        connection.release();
      }
    });

    it('should search for tools using ToolRegistryService', async () => {
      const searchResult = await toolRegistry.search({
        query: '天气',
        side_effect: false,
        max_results: 5
      });

      expect(searchResult).toBeDefined();
      expect(searchResult.tools).toBeDefined();
      expect(Array.isArray(searchResult.tools)).toBe(true);
      expect(searchResult.tools.length).toBeGreaterThan(0);

      const weatherTool = searchResult.tools.find((t: any) =>
        t.method_id === 'test_get_weather'
      );
      expect(weatherTool).toBeDefined();
      expect(weatherTool.name).toBe('获取天气');

      moduleLogger.info('Tool search result', {
        toolCount: searchResult.tools.length,
        weatherToolFound: !!weatherTool
      });
    });

    it('should dispatch search_tools function call', async () => {
      const result = await dispatcher.dispatch(
        {
          name: 'search_tools',
          args: {
            query: '天气查询',
            side_effect: false,
            max_results: 3
          }
        },
        {
          traceId: `test-trace-${Date.now()}`,
          sourceKey: 'user_test'
        }
      );

      expect(result.shouldContinue).toBe(true);
      expect(result.functionResponse).toBeDefined();
      expect(result.searchedTools).toBeDefined();
      expect(Array.isArray(result.searchedTools)).toBe(true);

      moduleLogger.info('search_tools dispatch result', {
        toolsFound: result.searchedTools?.length || 0
      });
    });

    it('should generate invoke declaration from searched tools', () => {
      const searchedTools = [
        {
          method_id: 'test_get_weather',
          name: '获取天气',
          description: '获取指定城市的天气信息',
          params_schema: {
            type: 'object',
            properties: {
              city: { type: 'string' }
            }
          }
        }
      ];

      const invokeDeclaration = dispatcher.getInvokeDeclaration(searchedTools);

      expect(invokeDeclaration).toBeDefined();
      expect(invokeDeclaration.name).toBe('invoke');
      expect(invokeDeclaration.description).toContain('test_get_weather');
      expect(invokeDeclaration.parameters.properties.method_id).toBeDefined();
      expect(invokeDeclaration.parameters.properties.method_id.enum).toContain('test_get_weather');

      moduleLogger.info('invoke declaration generated', { invokeDeclaration });
    });

    afterAll(async () => {
      // 清理测试数据
      const connection = await (database as any).pool.getConnection();
      await connection.query("DELETE FROM llm_tools WHERE method_id LIKE 'test_%'");
      connection.release();
    });
  });
});

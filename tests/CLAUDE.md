# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# 测试系统 (tests/)

## 测试架构概述
基于Jest测试框架的TypeScript测试套件，包含单元测试、集成测试和端到端测试。支持类型安全的测试编写和覆盖率报告。

## Jest配置详解

### 核心配置 (jest.config.js)
```javascript
module.exports = {
  preset: 'ts-jest',                    // TypeScript支持
  testEnvironment: 'node',              // Node.js环境
  moduleNameMapper: {                   // 路径别名映射
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  collectCoverageFrom: [                // 覆盖率收集
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts'
  ],
  coverageDirectory: 'coverage',        // 覆盖率报告目录
  coverageReporters: ['text', 'lcov', 'html']
};
```

### 类型支持
- **ts-jest**: TypeScript编译和类型检查
- **@types/jest**: Jest API类型定义
- **模块解析**: 支持src/路径别名导入

## 测试命令

### 基础测试命令
```bash
# 运行所有测试
npm test

# 监听模式运行
npm run test:watch

# 生成覆盖率报告
npm test -- --coverage

# 运行特定测试文件
npm test tests/basic.test.ts

# 运行匹配模式的测试
npm test -- --testNamePattern="Database Manager"
```

### 高级测试选项
```bash
# 详细输出
npm test -- --verbose

# 静默模式
npm test -- --silent

# 仅失败的测试
npm test -- --onlyFailures

# 更新快照
npm test -- --updateSnapshot
```

## 现有测试文件

### basic.test.ts
**基础功能测试套件**

#### 测试覆盖范围
1. **Database Manager测试**
   - 实例创建验证
   - 数据库连接测试
   - 连接池管理验证

2. **Configuration测试**
   - 配置加载验证
   - 必需配置项检查
   - 环境变量映射测试

## 新增测试套件 (Token管理和Session管理)

### token-management.test.ts
**Token管理系统测试套件**

#### 测试覆盖范围
1. **TokenManager核心功能测试**
   - Token选择算法验证
   - 优先级和权重计算正确性
   - 健康状态检查机制
   - 每日用量限制和重置

2. **Token轮换机制测试**
   - 健康Token优先选择
   - 黑名单Token跳过逻辑
   - 所有Token不可用时的错误处理
   - Token恢复机制验证

3. **数据库集成测试**
   - Token数据持久化
   - 使用日志记录
   - 健康检查配置加载
   - 并发访问安全性

### session-manager.test.ts
**Session管理系统测试套件**

#### 测试覆盖范围
1. **Session生命周期测试**
   - 会话创建和初始化
   - 自动过期机制
   - 会话状态转换
   - 会话清理和垃圾回收

2. **意图检测系统测试**
   - 聊天意图识别准确性
   - 需求意图检测置信度
   - 服务切换触发条件
   - 混合模式处理逻辑

3. **上下文管理测试**
   - 对话上下文保持
   - 业务上下文更新
   - 消息历史维护
   - 服务间上下文传递

### remote-claude-service.test.ts
**Claude Code远程服务测试套件**

#### 测试覆盖范围
1. **远程会话管理测试**
   - Tmux会话状态检查
   - 会话可用性验证
   - 会话错误处理

2. **需求处理流程测试**
   - 异步处理机制
   - 状态更新正确性
   - 错误回滚机制
   - 处理超时管理

3. **脚本执行测试**
   - 命令执行安全性
   - 输出捕获完整性
   - 错误信息传递
   - 进程生命周期管理

#### 测试模式
```typescript
describe('Basic TypeScript Migration Tests', () => {
  let database: DatabaseManager;

  beforeAll(() => {
    database = new DatabaseManager(config.database);
  });

  afterAll(async () => {
    await database.close();
  });

  describe('Database Manager', () => {
    test('should create database instance', () => {
      expect(database).toBeInstanceOf(DatabaseManager);
    });

    test('should test connection', async () => {
      const isConnected = await database.testConnection();
      expect(typeof isConnected).toBe('boolean');
    });
  });
});
```

## 测试编写指南

### 单元测试模式
```typescript
// 服务单元测试
describe('AIService', () => {
  let aiService: AIService;
  
  beforeEach(() => {
    aiService = new AIService(mockConfig.ai);
  });

  test('should analyze intent correctly', async () => {
    const result = await aiService.analyzeIntent('实现一个新功能', 12345);
    
    expect(result.isRequirement).toBe(true);
    expect(result.confidence).toBeGreaterThan(60);
    expect(result.category).toBeDefined();
  });
});
```

### 异步测试处理
```typescript
// Promise测试
test('should handle async operations', async () => {
  await expect(database.testConnection()).resolves.toBe(true);
});

// 错误处理测试
test('should handle connection failure', async () => {
  const badDatabase = new DatabaseManager(invalidConfig);
  await expect(badDatabase.testConnection()).rejects.toThrow();
});
```

### Mock和Spy使用
```typescript
// 模拟外部依赖
jest.mock('@google/generative-ai');

// 函数spy
const mockGenerateContent = jest.fn();
mockGenerateContent.mockResolvedValue({ response: { text: () => 'mocked response' } });

// 类实例mock
const mockWebSocketClient = {
  isConnected: jest.fn().mockReturnValue(true),
  sendPrivateMessage: jest.fn().mockResolvedValue(undefined)
};
```

## 集成测试策略

### HTTP API集成测试
```typescript
describe('HTTP Server Integration', () => {
  let server: HttpServer;
  let request: supertest.SuperTest<supertest.Test>;

  beforeAll(async () => {
    server = new HttpServer(config.http_server, dependencies);
    await server.start();
    request = supertest(server.getApp());
  });

  test('GET /health should return healthy status', async () => {
    const response = await request.get('/health');
    
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
    expect(response.body.websocket_connected).toBeDefined();
  });
});
```

### WebSocket集成测试
```typescript
describe('WebSocket Client Integration', () => {
  let wsClient: WebSocketClient;
  
  test('should connect to OneBot server', (done) => {
    wsClient.on('connected', () => {
      expect(wsClient.isConnected()).toBe(true);
      done();
    });
    
    wsClient.connect();
  });
});
```

## 端到端测试

### 完整工作流测试
```typescript
describe('End-to-End Workflow', () => {
  test('should process requirement from message to completion', async () => {
    // 1. 模拟接收QQ消息
    const message: QQMessage = createMockMessage('实现新功能');
    
    // 2. 处理消息
    const result = await bot.handlePrivateMessage(message);
    
    // 3. 验证需求创建
    expect(result.requirementCreated).toBe(true);
    
    // 4. 验证数据库记录
    const requirement = await database.getRequirementById(result.requirementId);
    expect(requirement?.status).toBe('pending');
    
    // 5. 验证响应消息
    expect(mockWebSocketClient.sendPrivateMessage).toHaveBeenCalledWith(
      message.user_id,
      expect.stringContaining('需求ID')
    );
  });
});
```

## 测试数据管理

### 测试装置(Fixtures)
```typescript
// test/fixtures/messages.ts
export const mockPrivateMessage: QQMessage = {
  message_type: 'private',
  sub_type: 'friend',
  message_id: 12345,
  user_id: 85178516,
  message: '测试消息',
  raw_message: '测试消息',
  font: 0,
  sender: {
    user_id: 85178516,
    nickname: '测试用户'
  },
  time: Date.now()
};
```

### 测试配置隔离
```typescript
// test/setup.ts
import { config } from '../src/config';

// 测试环境配置覆盖
export const testConfig = {
  ...config,
  database: {
    ...config.database,
    database: 'test_qqbot_db'  // 使用测试数据库
  }
};
```

## 覆盖率目标

### 覆盖率要求
- **语句覆盖率**: > 80%
- **分支覆盖率**: > 75%
- **函数覆盖率**: > 85%
- **行覆盖率**: > 80%

### 覆盖率报告
```bash
# 生成HTML报告
npm test -- --coverage

# 查看覆盖率报告
open coverage/lcov-report/index.html
```

## 测试最佳实践

### 测试命名约定
- 描述性测试名称: `should handle private message with requirement keywords`
- 分组相关测试: `describe('Private Message Handling', () => {})`
- 使用行为驱动: `it('should create requirement when confidence > 60%')`

### 测试隔离
- 每个测试独立运行
- 使用beforeEach/afterEach清理状态
- 避免测试间的副作用

### 异常场景测试
```typescript
test('should handle database connection failure gracefully', async () => {
  // 模拟数据库故障
  jest.spyOn(database, 'testConnection').mockRejectedValue(new Error('Connection failed'));
  
  // 验证错误处理
  const result = await bot.start();
  expect(result).toBe(false);
});
```

## 新增组件测试示例

### Token管理系统测试示例
```typescript
describe('TokenManager', () => {
  let tokenManager: TokenManager;
  let mockDatabase: jest.Mocked<DatabaseManager>;

  beforeEach(() => {
    mockDatabase = createMockDatabase();
    tokenManager = new TokenManager(mockDatabase);
  });

  describe('Token Selection Algorithm', () => {
    test('should select highest priority healthy token', async () => {
      // 准备测试数据
      const mockTokens: ApiTokenData[] = [
        { id: 1, priority: 1, is_healthy: true, daily_used: 10, daily_limit: 1000 },
        { id: 2, priority: 2, is_healthy: true, daily_used: 5, daily_limit: 1000 }
      ];
      
      mockDatabase.executeQuery.mockResolvedValue(mockTokens);
      
      // 执行测试
      const selectedToken = await tokenManager.getOptimalToken();
      
      // 验证结果
      expect(selectedToken?.id).toBe(1);
      expect(selectedToken?.priority).toBe(1);
    });

    test('should skip blacklisted tokens', async () => {
      const mockTokens: ApiTokenData[] = [
        { 
          id: 1, 
          priority: 1, 
          is_healthy: false, 
          blacklisted_until: new Date(Date.now() + 3600000) // 1小时后
        },
        { id: 2, priority: 2, is_healthy: true, daily_used: 0, daily_limit: 1000 }
      ];
      
      mockDatabase.executeQuery.mockResolvedValue(mockTokens);
      
      const selectedToken = await tokenManager.getOptimalToken();
      expect(selectedToken?.id).toBe(2);
    });
  });

  describe('Token Health Management', () => {
    test('should mark token as unhealthy after max errors', async () => {
      const tokenId = 1;
      const errorMessage = 'API quota exceeded';
      
      // 模拟健康检查配置
      mockDatabase.executeQuery.mockResolvedValueOnce([{
        max_error_count: 3,
        blacklist_duration_minutes: 60
      }]);
      
      // 模拟Token当前状态
      mockDatabase.executeQuery.mockResolvedValueOnce([{
        id: tokenId,
        error_count: 2 // 接近最大错误次数
      }]);
      
      await tokenManager.markTokenError(tokenId, errorMessage);
      
      // 验证Token被标记为不健康
      expect(mockDatabase.executeUpdate).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE api_tokens SET is_healthy = false'),
        expect.arrayContaining([tokenId])
      );
    });
  });
});
```

### Session管理系统测试示例
```typescript
describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let mockDatabase: jest.Mocked<DatabaseManager>;

  beforeEach(() => {
    mockDatabase = createMockDatabase();
    sessionManager = new SessionManager(mockDatabase);
  });

  describe('Session Creation and Intent Detection', () => {
    test('should create chat session for casual message', async () => {
      const userId = 12345;
      const message = '今天天气怎么样？';
      
      // 执行会话创建
      const session = await sessionManager.createSession(userId, message);
      
      // 验证会话类型
      expect(session.session_type).toBe('chat');
      expect(session.user_id).toBe(userId);
      expect(session.status).toBe('active');
    });

    test('should create requirement session for development request', async () => {
      const userId = 85178516; // 授权用户
      const message = '请帮我实现一个新的API接口用于用户管理';
      
      const session = await sessionManager.createSession(userId, message);
      
      expect(session.session_type).toBe('requirement');
      expect(session.business_context).toHaveProperty('detected_intent');
    });

    test('should detect service transition during conversation', async () => {
      const sessionId = 'test-session-id';
      const newMessage = '实际上我需要修改数据库结构';
      
      // 模拟现有聊天会话
      mockDatabase.executeQuery.mockResolvedValueOnce([{
        session_id: sessionId,
        session_type: 'chat',
        current_service: 'ai-service'
      }]);
      
      const transitionResult = await sessionManager.detectServiceTransition(
        sessionId, 
        newMessage
      );
      
      expect(transitionResult.should_transition).toBe(true);
      expect(transitionResult.target_service).toBe('requirement-processor');
    });
  });

  describe('Context Management', () => {
    test('should maintain conversation context across messages', async () => {
      const sessionId = 'test-session-id';
      const newContext = {
        conversation_context: {
          lastAIResponse: 'Hello! How can I help you?',
          conversationTurn: 2
        }
      };
      
      await sessionManager.updateSessionContext(sessionId, newContext);
      
      expect(mockDatabase.executeUpdate).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE conversation_sessions'),
        expect.arrayContaining([JSON.stringify(newContext.conversation_context)])
      );
    });
  });
});
```

### 远程Claude服务测试示例
```typescript
describe('RemoteClaudeService', () => {
  let remoteClaudeService: RemoteClaudeService;
  let mockDatabase: jest.Mocked<DatabaseManager>;

  beforeEach(() => {
    mockDatabase = createMockDatabase();
    remoteClaudeService = new RemoteClaudeService(mockDatabase);
  });

  describe('Remote Session Management', () => {
    test('should check remote session existence', async () => {
      // 模拟tmux命令成功
      jest.spyOn(require('child_process'), 'spawn').mockImplementation(() => ({
        on: jest.fn((event, callback) => {
          if (event === 'close') callback(0); // 成功退出码
        })
      }));
      
      const sessionExists = await remoteClaudeService.checkRemoteSession();
      expect(sessionExists).toBe(true);
    });

    test('should handle remote session not found', async () => {
      // 模拟tmux命令失败
      jest.spyOn(require('child_process'), 'spawn').mockImplementation(() => ({
        on: jest.fn((event, callback) => {
          if (event === 'close') callback(1); // 错误退出码
        })
      }));
      
      const sessionExists = await remoteClaudeService.checkRemoteSession();
      expect(sessionExists).toBe(false);
    });
  });

  describe('Requirement Processing', () => {
    test('should process requirement asynchronously', async () => {
      const requirementData: RequirementData = {
        id: 'req-123',
        user_id: 85178516,
        message: '实现用户登录功能',
        status: 'received',
        created_at: new Date(),
        updated_at: new Date()
      };

      // 模拟远程会话存在
      jest.spyOn(remoteClaudeService, 'checkRemoteSession')
          .mockResolvedValue(true);

      // 启动需求处理
      const processPromise = remoteClaudeService.processRequirement(requirementData);
      
      // 验证状态更新为processing
      expect(mockDatabase.executeUpdate).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'processing'"),
        expect.arrayContaining([requirementData.id])
      );

      await processPromise;
    });

    test('should handle remote session unavailable error', async () => {
      const requirementData: RequirementData = {
        id: 'req-124',
        user_id: 85178516,
        message: '修复登录bug',
        status: 'received',
        created_at: new Date(),
        updated_at: new Date()
      };

      // 模拟远程会话不存在
      jest.spyOn(remoteClaudeService, 'checkRemoteSession')
          .mockResolvedValue(false);

      await expect(
        remoteClaudeService.processRequirement(requirementData)
      ).rejects.toThrow('Claude Code远程会话不存在');
    });
  });
});
```
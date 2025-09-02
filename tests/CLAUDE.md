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
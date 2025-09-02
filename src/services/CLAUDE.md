# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# 核心服务模块 (src/services/)

## 模块概述
包含QQ机器人的核心业务服务，采用TypeScript和async/await模式构建。所有服务都通过依赖注入在主应用中协同工作。

## 服务架构

### 服务依赖关系
```
QQBot (index.ts) 
├── DatabaseManager (database.ts) - 单例数据库连接池
├── WebSocketClient (websocket-client.ts) - OneBot协议客户端
├── HttpServer (http-server.ts) - Express REST API服务器
└── AIService (ai-service.ts) - Gemini AI集成服务
```

## 核心服务详解

### DatabaseManager (database.ts)
**MySQL2数据库管理服务**
- **连接池管理**: MySQL2连接池，支持自动重连和事务
- **核心方法**:
  - `testConnection()`: 数据库健康检查
  - `executeQuery<T>()`: 类型安全的查询方法
  - `executeUpdate()`: 更新操作，返回影响行数
  - `executeBatch()`: 批量操作，支持事务回滚
- **业务方法**:
  - `saveConversation()`: 保存AI对话记录
  - `saveRequirement()`: 保存需求管理数据
  - `updateBotStatus()`: 更新机器人运行状态
- **单例模式**: `getDatabaseManager(config)` 获取全局实例

### WebSocketClient (websocket-client.ts)
**OneBot 11协议WebSocket客户端**
- **事件驱动**: 继承EventEmitter，发出typed事件
- **自动重连**: 指数退避重连，最大10次重试
- **消息处理**:
  - `handleQQMessage()`: QQ私聊/群聊消息处理
  - `handleQQNotice()`: 群成员变动通知
  - `handleQQRequest()`: 好友/群请求处理
- **OneBot API**:
  - `sendPrivateMessage()`: 发送私聊消息
  - `sendGroupMessage()`: 发送群聊消息
  - `sendReplyMessage()`: 发送回复消息
  - `sendAtMessage()`: 发送@消息

### HttpServer (http-server.ts)
**Express.js REST API服务器**
- **中间件集成**: Helmet安全、CORS跨域、JSON解析
- **核心端点**:
  - `GET /health`: 服务健康检查
  - `GET /api/status`: 完整系统状态（WebSocket、数据库、进程信息）
  - `POST /api/send_*`: 消息发送API系列
  - `GET /api/conversations`: 对话历史查询
  - `GET /api/requirements`: 需求管理状态
- **依赖注入**: 构造函数接收database和websocketClient依赖
- **错误处理**: 统一错误处理中间件，结构化错误响应

### AIService (ai-service.ts)
**Gemini AI集成服务**
- **官方SDK**: 使用@google/generative-ai替代axios调用
- **API密钥轮换**: 支持多密钥自动轮换，提高可用性
- **核心功能**:
  - `generateResponse()`: 生成AI对话响应
  - `analyzeIntent()`: 需求意图分析，返回置信度和复杂度
  - `fallbackIntentAnalysis()`: 关键词回退分析
- **配置管理**: 支持模型名称、温度参数、token限制配置
- **错误恢复**: API调用失败时自动切换下一个密钥

## 开发指南

### 新增服务步骤
1. 在`src/services/`创建服务文件
2. 实现服务接口，使用async/await模式
3. 在`src/index.ts`中注入依赖
4. 添加对应的TypeScript类型定义

### 数据库操作最佳实践
```typescript
// 类型安全查询
const conversations = await database.executeQuery<ConversationData>(
  "SELECT * FROM conversations WHERE user_id = ?", 
  [userId]
);

// 事务操作
await database.executeBatch(insertQuery, paramsList);
```

### WebSocket事件处理
```typescript
// 监听特定事件
websocketClient.on('private_message', (message: QQMessage) => {
  // 处理私聊消息
});

// 发送消息
await websocketClient.sendPrivateMessage(userId, "回复内容");
```

### HTTP API开发
```typescript
// 添加新端点
private async handleNewEndpoint(req: Request, res: Response): Promise<void> {
  try {
    // 业务逻辑
    res.json({ success: true, data: result });
  } catch (error) {
    this.moduleLogger.error('操作失败', { error });
    res.status(500).json({ error: '内部服务器错误' });
  }
}
```

## 测试策略
- **单元测试**: 每个服务的核心方法都有对应测试
- **集成测试**: 测试服务间的协作和数据流
- **健康检查**: 所有服务都提供健康状态检查方法
- **错误模拟**: 测试网络故障、数据库断连等异常场景

## 性能考虑
- **连接池**: 数据库连接池避免频繁建连
- **事件循环**: 避免阻塞操作，所有IO都是异步
- **内存管理**: WebSocket客户端正确处理大消息和连接清理
- **缓存策略**: AI服务可考虑添加响应缓存机制
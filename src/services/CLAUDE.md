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
├── AIService (ai-service.ts) - Gemini AI集成服务
├── SessionManager (session-manager.ts) - 会话状态管理
├── RemoteClaudeService (remote-claude-service.ts) - Claude Code远程调用
└── TokenManager (../utils/token-manager.ts) - API Token管理和轮换
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
- **数据库驱动Token管理**: 集成TokenManager，支持数据库持久化Token状态
- **智能Token选择**: 基于优先级、权重、使用频率和健康状态选择最优Token
- **核心功能**:
  - `generateResponse()`: 生成AI对话响应，支持Session上下文
  - `analyzeIntent()`: 需求意图分析，返回置信度和复杂度
  - `fallbackIntentAnalysis()`: 关键词回退分析
- **配置管理**: 支持模型名称、温度参数、token限制配置
- **错误恢复**: API调用失败时自动切换下一个Token，记录使用日志

### SessionManager (session-manager.ts)
**多服务协调的会话状态管理**
- **会话类型支持**: chat(纯对话)、requirement(需求处理)、mixed(混合模式)
- **智能服务切换**: 基于用户消息自动检测并切换服务类型
- **上下文管理**: 
  - `conversation_context`: 对话历史和AI模型状态
  - `business_context`: 业务逻辑相关状态(需求ID、处理状态等)
- **核心功能**:
  - `createSession()`: 创建新会话，支持自动意图检测
  - `getActiveSession()`: 获取用户活跃会话
  - `updateSessionContext()`: 更新会话上下文
  - `transitionService()`: 服务间切换，记录切换原因
- **会话生命周期**: 30分钟超时机制，支持手动完成和过期清理

### RemoteClaudeService (remote-claude-service.ts)
**Claude Code远程调用服务**
- **Tmux会话管理**: 检查和管理Claude Code远程会话状态
- **需求处理流水线**: 
  - 检查远程会话可用性
  - 更新需求状态为processing
  - 调用远程脚本执行Claude Code命令
  - 异步处理和状态更新
- **错误处理**: 完善的错误捕获和状态回滚机制
- **核心功能**:
  - `checkRemoteSession()`: 检查Claude远程会话是否存在
  - `processRequirement()`: 异步处理需求，调用远程Claude Code
  - `executeRemoteCommand()`: 执行远程脚本命令

### TokenManager (../utils/token-manager.ts)
**数据库驱动的Gemini API Token管理**
- **持久化状态管理**: 所有Token信息存储在数据库，支持多实例共享
- **智能Token选择算法**:
  - 优先级排序: priority字段控制Token使用顺序
  - 权重负载均衡: weight字段实现负载分配
  - 健康状态检查: 定期检测Token可用性
  - 每日用量限制: 防止单Token过度使用
- **自动恢复机制**:
  - 黑名单管理: 错误Token自动加入黑名单
  - 定时恢复: 黑名单Token定期尝试恢复
  - 每日重置: 凌晨自动重置每日用量计数
- **核心功能**:
  - `getOptimalToken()`: 获取最优可用Token
  - `recordTokenUsage()`: 记录Token使用情况
  - `markTokenError()`: 标记Token错误，更新健康状态
  - `performHealthCheck()`: 执行Token健康检查
  - `getStats()`: 获取Token使用统计信息

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

### Session管理最佳实践
```typescript
// 创建会话并检测意图
const session = await sessionManager.createSession(userId, message);

// 基于会话类型处理消息
if (session.session_type === 'requirement') {
  await remoteClaudeService.processRequirement(requirementData);
} else {
  const response = await aiService.generateResponse(message, session.conversation_context);
}

// 更新会话上下文
await sessionManager.updateSessionContext(session.session_id, {
  conversation_context: { lastResponse: response },
  business_context: { requirementId: requirement?.id }
});
```

### Token管理集成
```typescript
// AIService中Token使用示例
const token = await this.tokenManager.getOptimalToken();
if (!token) {
  throw new Error('No healthy tokens available');
}

try {
  // 使用Token调用API
  const response = await this.callGeminiAPI(token.token, prompt);
  
  // 记录成功使用
  await this.tokenManager.recordTokenUsage(token.id, 'success', {
    response_time_ms: responseTime,
    gemini_usage: response.usageMetadata
  });
  
  return response;
} catch (error) {
  // 记录错误使用
  await this.tokenManager.markTokenError(token.id, error.message);
  throw error;
}
```

### 远程服务调用模式
```typescript
// 异步需求处理
async processUserRequirement(userId: number, message: string): Promise<void> {
  // 创建需求记录
  const requirement = await database.saveRequirement({
    id: uuidv4(),
    user_id: userId,
    message,
    status: 'received'
  });

  // 异步处理，不阻塞用户响应
  setImmediate(async () => {
    try {
      await remoteClaudeService.processRequirement(requirement);
    } catch (error) {
      await database.updateRequirement(requirement.id, {
        status: 'failed',
        error_message: error.message
      });
    }
  });
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
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# QQBot Core - Stage 1 智能响应引擎

## 模块概述
QQBot Core是QQ智能机器人的核心服务模块，负责OneBot WebSocket连接、AI对话处理和核心业务逻辑。

### Stage 1 架构特性 ✅ (已实现)
- **智能决策引擎**: DecisionEngine - 判断是否回复消息
- **上下文构建引擎**: ContextEngine - 分析消息历史和语义
- **人格化引擎**: PersonaEngine - 生成拟人化回复
- **完整日志系统**: 分模块记录所有引擎活动
- **实时消息处理**: 事件驱动架构，支持实时对话

# TypeScript类型系统 (src/types/)

## 类型系统概述
完整的TypeScript类型定义，确保编译时类型安全和IDE智能提示。所有接口都基于OneBot 11协议和业务需求设计。

## 核心类型定义

### QQ消息相关类型

#### QQMessage
**OneBot 11协议消息结构**
```typescript
interface QQMessage {
  message_type: 'private' | 'group';     // 消息类型
  sub_type: string;                      // 子类型
  message_id: number;                    // 消息ID
  user_id: number;                       // 发送者QQ号
  message: string;                       // 消息内容
  raw_message: string;                   // 原始消息
  font: number;                          // 字体
  sender: {                              // 发送者信息
    user_id: number;
    nickname: string;
    card?: string;                       // 群名片
    role?: 'owner' | 'admin' | 'member'; // 群角色
  };
  group_id?: number;                     // 群号(群消息时存在)
  time: number;                          // 时间戳
}
```

#### QQNotice & QQRequest
**通知和请求类型**
- `QQNotice`: 群成员变动、禁言等系统通知
- `QQRequest`: 好友申请、群邀请等请求
- `WebSocketEvent`: WebSocket基础事件类型

### 数据库实体类型

#### ConversationData
**对话历史数据结构**
```typescript
interface ConversationData {
  id: string;                    // 对话UUID
  user_id: number;               // 用户QQ号
  user_message: string;          // 用户消息
  ai_response: string;           // AI回复
  timestamp: Date;               // 对话时间
  response_time: number;         // 响应时间(ms)
  model_name: string;            // AI模型名称
  raw_request?: string;          // 原始请求JSON
  raw_response?: string;         // 原始响应JSON
  message_id?: number;           // 关联的QQ消息ID
  reply_to_message_id?: number;  // 回复的消息ID
  reply_to_text?: string;        // 回复的消息内容
  session_id?: string;           // Session管理支持
}
```

#### RequirementData
**需求管理数据结构**
```typescript
interface RequirementData {
  id: string;                           // 需求UUID
  user_id: number;                      // 需求提出者
  message: string;                      // 需求描述
  status: 'received' | 'analyzing' | 'processing' | 'completed' | 'failed' | 'cancelled'; // 状态
  created_at: Date;                     // 创建时间
  updated_at: Date;                     // 更新时间
  claude_code_output?: string;          // Claude Code输出
  completion_details?: string;          // 完成详情
  error_message?: string;               // 错误信息
  processing_start_time?: Date;         // 开始处理时间
  processing_end_time?: Date;           // 完成时间
  session_id?: string;                  // Session管理支持
}
```

### 配置类型定义

#### AppConfig
**应用程序完整配置结构**
```typescript
interface AppConfig {
  database: DatabaseConfig;      // 数据库配置
  websocket: WebSocketConfig;    // WebSocket配置  
  http_server: HttpServerConfig; // HTTP服务器配置
  ai: AIConfig;                  // AI服务配置
  logging: {                     // 日志配置
    level: string;
    file_prefix: string;
  };
}
```

#### 各子配置接口
- `DatabaseConfig`: MySQL连接参数
- `WebSocketConfig`: OneBot服务器连接参数
- `HttpServerConfig`: Express服务器监听配置
- `AIConfig`: Gemini API配置，包括密钥数组和授权用户

### 工具类型

#### LogLevel & LogEntry
**日志系统类型**
```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  module: string;
  message: string;
  extra?: Record<string, any>;
}
```

## 类型使用指南

### 类型安全的数据库查询
```typescript
// 明确指定返回类型
const conversations = await database.executeQuery<ConversationData>(
  "SELECT * FROM conversations WHERE user_id = ?", 
  [userId]
);

// 编译时类型检查
conversations.forEach(conv => {
  console.log(conv.ai_response); // ✅ 类型安全
  console.log(conv.unknown_field); // ❌ 编译错误
});
```

### 消息处理类型检查
```typescript
// 事件处理函数的参数类型
websocketClient.on('private_message', (message: QQMessage) => {
  if (message.message_type === 'private') {
    // 类型收窄，group_id可能undefined
    console.log(message.group_id); // TypeScript警告
  }
});
```

### 配置类型验证
```typescript
// 配置对象必须符合接口定义
const config: AppConfig = {
  database: {
    host: process.env.MYSQL_HOST!, // 非null断言
    port: parseInt(process.env.MYSQL_PORT!),
    // ... 其他必需字段
  }
  // ... 其他配置部分
};
```

## 类型扩展指南

### 新增消息类型
1. 在`QQMessage`基础上扩展或创建新接口
2. 更新WebSocket事件处理器参数类型
3. 在相关服务中添加类型支持

### 数据库实体扩展
1. 修改对应的`*Data`接口
2. 更新数据库操作方法的泛型参数
3. 添加相关的验证逻辑

### 配置类型扩展
1. 扩展`AppConfig`或子配置接口
2. 更新`src/config/index.ts`的实现
3. 添加环境变量类型检查

## 最佳实践

### 类型守卫使用
```typescript
// 类型收窄
function isGroupMessage(msg: QQMessage): msg is QQMessage & { group_id: number } {
  return msg.message_type === 'group' && typeof msg.group_id === 'number';
}

if (isGroupMessage(message)) {
  // group_id 现在是 number 类型
  console.log(message.group_id);
}
```

### 可选属性处理
```typescript
// 安全访问可选属性
const cardName = message.sender.card ?? message.sender.nickname;

// 类型断言谨慎使用
const groupId = message.group_id as number; // 仅在确定存在时使用
```

### 泛型工具类型
```typescript
// 部分字段更新
type RequirementUpdate = Partial<Pick<RequirementData, 'status' | 'completion_details'>>;

// 必需字段验证
type CreateConversationData = Omit<ConversationData, 'id'> & { id?: string };
```

## Stage 1 引擎类型定义

### DecisionResult
**决策引擎结果类型**
```typescript
interface DecisionResult {
  shouldRespond: boolean;     // 是否应该回复
  confidence: number;         // 置信度 (0-100)
  reason: string;            // 决策理由
  suggestedService?: string; // 建议服务类型
  userId?: number;           // 用户ID
}
```

### MessageContext  
**消息上下文类型**
```typescript
interface MessageContext {
  currentMessage: QQMessage;        // 当前消息
  recentMessages: QQMessage[];      // 最近消息历史
  userInfo: UserInfo;               // 用户信息
  groupInfo?: GroupInfo;            // 群信息 (群聊时)
  topicKeywords: string[];          // 主题关键词
  contextSummary?: string;          // 上下文摘要
}
```

### PersonaResponse
**人格化回复类型**
```typescript
interface PersonaResponse {
  response: string;                 // 回复内容
  selectedPersona: string;          // 选择的人格侧面
  confidence: number;               // 人格匹配置信度
  executionPlan?: ExecutionStep[];  // 执行计划
}

interface ExecutionStep {
  delay: number;                    // 延迟秒数
  content: string;                  // 内容
  action: 'send' | 'typing';        // 动作类型
}
```

## 新增类型定义 (Token管理和Session管理)

### Token管理相关类型

#### ApiTokenData
**API Token完整数据结构**
```typescript
interface ApiTokenData {
  id: number;                    // Token ID
  token: string;                 // API Token值
  project_name: string;          // 项目名称
  project_id: string;            // Google项目ID
  is_active: boolean;            // 是否激活
  is_healthy: boolean;           // 健康状态
  daily_limit: number;           // 每日用量限制
  daily_used: number;            // 每日已使用量
  total_used: number;            // 总使用量
  last_reset_date: Date;         // 上次重置日期
  last_used?: Date;              // 最后使用时间
  last_health_check?: Date;      // 最后健康检查时间
  error_count: number;           // 错误计数
  last_error?: string;           // 最后错误信息
  last_error_time?: Date;        // 最后错误时间
  priority: number;              // 优先级 (1-10, 越小越优先)
  weight: number;                // 权重 (负载均衡用)
  blacklisted_until?: Date;      // 黑名单截止时间
  blacklist_reason?: string;     // 黑名单原因
  created_at: Date;              // 创建时间
  updated_at: Date;              // 更新时间
}
```

#### TokenLogData
**Token使用日志**
```typescript
interface TokenLogData {
  id: number;                           // 日志ID
  token_id: number;                     // 关联Token ID
  action: 'use' | 'success' | 'error' | 'health_check'; // 操作类型
  result?: 'success' | 'error' | 'timeout' | 'quota_exceeded'; // 结果
  error_message?: string;               // 错误信息
  response_time_ms?: number;            // 响应时间(毫秒)
  gemini_usage?: Record<string, any>;   // Gemini API使用情况
  created_at: Date;                     // 日志时间
}
```

#### TokenHealthConfig
**Token健康检查配置**
```typescript
interface TokenHealthConfig {
  id: number;                     // 配置ID
  check_interval_minutes: number; // 检查间隔(分钟)
  max_error_count: number;        // 最大错误次数
  blacklist_duration_minutes: number; // 黑名单持续时间(分钟)
  health_check_timeout_ms: number;     // 健康检查超时(毫秒)
  daily_reset_hour: number;       // 每日重置时间(小时)
  enabled: boolean;               // 是否启用
  created_at: Date;               // 创建时间
  updated_at: Date;               // 更新时间
}
```

#### TokenStats
**Token统计信息**
```typescript
interface TokenStats {
  total: number;                  // 总Token数
  active: number;                 // 活跃Token数
  healthy: number;                // 健康Token数
  blacklisted: number;            // 黑名单Token数
  over_daily_limit: number;       // 超出每日限制Token数
  tokens: Array<{                 // Token详细信息
    id: number;
    project_name: string;
    project_id: string;
    is_healthy: boolean;
    daily_used: number;
    daily_limit: number;
    error_count: number;
    last_used?: string;
    blacklisted_until?: string;
  }>;
}
```

### Session管理相关类型

#### SessionContext
**会话上下文完整结构**
```typescript
interface SessionContext {
  session_id: string;             // 会话UUID
  user_id: number;                // 用户QQ号
  session_type: 'chat' | 'requirement' | 'mixed'; // 会话类型
  current_service: string;        // 当前服务
  status: 'active' | 'paused' | 'completed' | 'expired'; // 状态
  created_at: Date;               // 创建时间
  last_activity: Date;            // 最后活跃时间
  expires_at: Date;               // 过期时间
  conversation_context: Record<string, any>; // 对话上下文
  business_context: Record<string, any>;     // 业务上下文
  message_count: number;          // 消息计数
  service_transitions: ServiceTransition[]; // 服务切换历史
  recent_messages: MessageRecord[];         // 最近消息记录
}
```

#### ServiceTransition
**服务切换记录**
```typescript
interface ServiceTransition {
  from_service: string;           // 源服务
  to_service: string;             // 目标服务
  timestamp: Date;                // 切换时间
  trigger: 'USER_REQUEST' | 'AUTO_DETECT' | 'TIMEOUT'; // 触发原因
  confidence: number;             // 置信度
}
```

#### MessageRecord
**消息记录**
```typescript
interface MessageRecord {
  message_id: string;             // 消息ID
  timestamp: Date;                // 时间戳
  direction: 'IN' | 'OUT';        // 方向 (入/出)
  content: string;                // 消息内容
  service: string;                // 处理服务
  intent_score?: number;          // 意图分数
}
```

#### IntentResult
**意图分析结果**
```typescript
interface IntentResult {
  session_type: 'chat' | 'requirement'; // 会话类型
  confidence: number;             // 置信度 (0-100)
  method: string;                 // 分析方法
  reasoning?: string;             // 推理过程
}
```

#### AgentPromptData
**AI Agent提示词配置**
```typescript
interface AgentPromptData {
  id: string;                     // 提示词ID
  agent_type: 'chat_bot' | 'intent_analyzer' | 'requirement_processor' | 'custom';
  prompt_name: string;            // 提示词名称
  system_instructions: string[];  // 系统指令数组
  user_prompt_template?: string;  // 用户提示模板
  context_variables?: Record<string, string>; // 上下文变量
  model_config?: {                // 模型配置
    temperature?: number;
    topK?: number;
    topP?: number;
    maxOutputTokens?: number;
  };
  is_active: boolean;             // 是否激活
  version: number;                // 版本号
  created_by: string;             // 创建者
  created_at: Date;               // 创建时间
  updated_at: Date;               // 更新时间
  description?: string;           // 描述信息
}
```
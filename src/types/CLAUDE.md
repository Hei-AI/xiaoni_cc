# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
}
```

#### RequirementData
**需求管理数据结构**
```typescript
interface RequirementData {
  id: string;                           // 需求UUID
  user_id: number;                      // 需求提出者
  message: string;                      // 需求描述
  status: 'pending' | 'processing' | 'completed' | 'failed'; // 状态
  created_at: Date;                     // 创建时间
  updated_at: Date;                     // 更新时间
  claude_code_output?: string;          // Claude Code输出
  completion_details?: string;          // 完成详情
  error_message?: string;               // 错误信息
  processing_start_time?: Date;         // 开始处理时间
  processing_end_time?: Date;           // 完成时间
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
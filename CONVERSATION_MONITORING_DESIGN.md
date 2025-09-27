# QQ Bot 对话监控管理系统设计文档

## 📋 概述

将管理面板从技术指标监控转向业务流程监控，以私聊/群聊为维度，提供直观的对话状态追踪和错误链路分析。

## 🎯 设计原则

1. **业务导向**: 从"技术问题"转向"业务问题"的视角
2. **链路可视**: 完整的消息处理链路可追踪
3. **快速定位**: 通过搜索和过滤快速找到问题对话
4. **实时反馈**: 对话状态实时更新和错误提醒

## 🗂️ 功能架构

```
管理面板
├── 📱 私聊管理
│   ├── 用户列表页面
│   ├── 用户对话详情页面
│   └── 对话链路追踪页面
├── 👥 群聊管理  
│   ├── 群组列表页面
│   ├── 群聊对话详情页面
│   └── 群聊链路追踪页面
└── ⚙️ 系统监控 (现有功能保留)
```

## 📱 私聊管理模块

### 1. 用户列表页面 `/private-chats`

**功能需求:**
- 显示所有有对话记录的用户
- 按最近对话时间排序
- 显示用户基本信息和对话状态
- 支持搜索和过滤

**界面布局:**
```
┌─────────────────────────────────────────────────────┐
│  📱 私聊管理                           [刷新] [设置]  │
├─────────────────────────────────────────────────────┤
│  🔍 [搜索用户ID/昵称/消息内容]                       │
│  📅 时间范围: [今天▼] 状态: [全部▼] 排序: [最新▼]    │
├─────────────────────────────────────────────────────┤
│  用户ID      昵称        最近对话        状态    操作  │
│  ──────────────────────────────────────────────────  │
│  85178516   阿花        2分钟前         ✅      [查看] │
│  12345      小明        1小时前         ❌      [查看] │
│  67890      小红        3小时前         ⏳      [查看] │
│  11111      张三        昨天 15:30      ✅      [查看] │
│  22222      李四        昨天 09:20      🔇      [查看] │
├─────────────────────────────────────────────────────┤
│  共 45 个用户 | 今日活跃: 12 | 成功率: 92.3%         │
└─────────────────────────────────────────────────────┘
```

**数据字段:**
- `user_id`: 用户ID
- `nickname`: 用户昵称 (从conversations表获取)
- `last_conversation_time`: 最近对话时间
- `status`: 对话状态 (success/failed/processing/disabled)
- `total_conversations`: 总对话数
- `success_rate`: 成功率
- `is_enabled`: 是否启用私聊

**状态图标定义:**
- ✅ 最近对话成功
- ❌ 最近对话失败
- ⏳ 正在处理中
- 🔇 用户被禁用
- ⚠️ 响应延迟

### 2. 用户对话详情页面 `/private-chats/:userId`

**功能需求:**
- 显示该用户的所有对话记录
- 展示每条对话的处理状态和链路信息
- 支持对话内容搜索
- 提供快捷操作 (重试、手动回复、禁用等)

**界面布局:**
```
┌─────────────────────────────────────────────────────┐
│  👤 私聊详情: 阿花 (85178516)          [返回列表]    │
│      状态: ✅ 启用 | 今日对话: 8次 | 成功率: 87.5%    │
├─────────────────────────────────────────────────────┤
│  🔍 [搜索对话内容]  📅 [时间范围]  📊 [统计信息]      │
│  [快速重试] [手动回复] [禁用用户] [清空历史]          │
├─────────────────────────────────────────────────────┤
│  ⏰ 2025-09-14 18:39:47              TraceID: abc123 │
│  👤 用户消息: @机器人 出来讲话                        │
│  🤖 机器人回复: [处理失败] ❌                        │
│      📋 错误: DecisionEngine MAX_TOKENS 错误         │
│      ⏱️ 处理时间: 16.3秒 (超时)                      │
│      🔗 [查看完整链路] [重试此消息]                   │
│  ─────────────────────────────────────────────────── │
│  ⏰ 2025-09-14 17:01:38              TraceID: def456 │
│  👤 用户消息: 在做什么呢                              │
│  🤖 机器人回复: 哈哈，阿花！你这是又来"查岗"我...      │
│      ✅ 回复成功                                     │
│      ⏱️ 处理时间: 18.2秒                            │
│      🔑 使用Token: Gemini-Project-3                  │
│      📊 [查看性能数据] [用户反馈]                     │
└─────────────────────────────────────────────────────┘
```

**数据需求:**
```sql
-- 用户对话列表查询
SELECT 
    c.id as conversation_id,
    c.trace_id,
    c.user_message,
    c.ai_response,
    c.timestamp,
    c.response_time,
    c.status,
    c.error_message,
    c.model_name,
    pcs.is_enabled as user_enabled
FROM conversations c
LEFT JOIN private_chat_settings pcs ON c.user_id = pcs.user_id
WHERE c.user_id = ?
ORDER BY c.timestamp DESC
LIMIT 50
```

### 3. 对话链路追踪页面 `/private-chats/:userId/trace/:traceId`

**功能需求:**
- 展示单条消息的完整处理链路
- 每个处理步骤的时间戳和状态
- 错误发生的具体位置和原因
- 提供修复建议和操作

**界面布局:**
```
┌─────────────────────────────────────────────────────┐
│  🔍 消息处理链路详情                    [返回对话]   │
│      TraceID: abc123 | 消息: "出来讲话"              │
├─────────────────────────────────────────────────────┤
│  📊 处理概览                                        │
│      开始时间: 2025-09-14 18:39:47.063              │
│      结束时间: 2025-09-14 18:40:03.402              │
│      总耗时: 16.339秒 ⚠️ (超过15秒阈值)             │
│      最终状态: ❌ 处理失败                          │
├─────────────────────────────────────────────────────┤
│  🔄 处理步骤                                        │
│                                                     │
│  1️⃣ WebSocket消息接收     ✅ 18:39:47.063 (+0ms)    │
│      └─ 事件类型: private_message                   │
│                                                     │
│  2️⃣ 消息格式解析         ✅ 18:39:47.063 (+0ms)    │
│      └─ 消息长度: 4字符 | 类型: 文本                 │
│                                                     │
│  3️⃣ 私聊设置检查         ✅ 18:39:47.070 (+7ms)    │
│      ├─ is_enabled: ✅ 启用                        │
│      └─ auto_reply_enabled: ✅ 启用                │
│                                                     │
│  4️⃣ 对话记录创建         ✅ 18:39:47.190 (+127ms)  │
│      └─ ConversationID: de201a2c-c144-461a-9e29... │
│                                                     │
│  5️⃣ 上下文构建           ✅ 18:39:47.085 (+22ms)   │
│      ├─ 历史消息: 20条                             │
│      ├─ 用户信息: 58条历史消息                      │
│      └─ 上下文长度: 1,234字符                       │
│                                                     │
│  6️⃣ 决策引擎分析         ❌ 18:40:03.402 (+16.3s)  │
│      ├─ 调用Prompt: intent_analyzer/participation_analysis │
│      ├─ 尝试1: ❌ MAX_TOKENS (Token: Project-1)     │
│      ├─ 尝试2: ❌ MAX_TOKENS (Token: Project-2)     │
│      ├─ 尝试3: ❌ MAX_TOKENS (Token: Project-3)     │
│      └─ 保守决策: shouldRespond = false            │
│                                                     │
│  📋 错误分析                                        │
│      根本原因: participation_analysis prompt过长    │
│      提示长度: 2,145字符 + 上下文1,234字符 = 超限     │
│      影响范围: 所有需要决策引擎的群聊和私聊          │
│      修复状态: ✅ 已优化prompt至250字符              │
│                                                     │
│  🔧 建议操作                                        │
│      [重新处理此消息] [测试修复效果] [查看类似问题]   │
└─────────────────────────────────────────────────────┘
```

## 👥 群聊管理模块

### 1. 群组列表页面 `/group-chats`

**界面布局:**
```
┌─────────────────────────────────────────────────────┐
│  👥 群聊管理                           [刷新] [设置]  │
├─────────────────────────────────────────────────────┤
│  🔍 [搜索群ID/群名/消息内容]                         │
│  📅 时间: [今天▼] 状态: [全部▼] 排序: [活跃度▼]      │
├─────────────────────────────────────────────────────┤
│  群ID        群名           活跃度    状态      操作   │
│  ──────────────────────────────────────────────────  │
│  1019235326  技术交流群     ⭐⭐⭐    ❌ 故障  [查看]  │
│  8888888     项目讨论       ⭐⭐      ✅ 正常  [查看]  │
│  7777777     日常聊天       ⭐        ✅ 正常  [查看]  │
│  6666666     代码审查       ⭐⭐⭐    🔇 静默  [查看]  │
├─────────────────────────────────────────────────────┤
│  共 12 个群聊 | 今日活跃: 8 | 平均成功率: 94.2%      │
└─────────────────────────────────────────────────────┘
```

**数据字段:**
- `group_id`: 群ID
- `group_name`: 群名 (从群消息中提取或手动设置)
- `activity_level`: 活跃度 (基于消息量)
- `status`: 群聊状态
- `receive_events`: 是否接收事件
- `is_enabled`: 是否启用LLM处理
- `auto_reply_enabled`: 是否自动回复
- `today_messages`: 今日消息数
- `today_replies`: 今日回复数
- `success_rate`: 回复成功率

### 2. 群聊对话详情页面 `/group-chats/:groupId`

**界面布局:**
```
┌─────────────────────────────────────────────────────┐
│  👥 群聊详情: 技术交流群 (1019235326)   [返回列表]   │
│      状态: 接收✅ 启用✅ 回复❌ (故障原因)            │
├─────────────────────────────────────────────────────┤
│  📊 今日统计                                        │
│      接收消息: 15条 | 机器人回复: 2条 | 失败: 3条     │
│      活跃用户: 8人 | @机器人: 5次 | 成功率: 40%       │
├─────────────────────────────────────────────────────┤
│  🔍 [搜索群内对话]  📅 [时间范围]  ⚙️ [群组设置]      │
│  [批量重试] [群公告] [静默模式] [导出记录]            │
├─────────────────────────────────────────────────────┤
│  ⏰ 2025-09-14 18:39:47     👤 阿花(85178516)        │
│  💬 @机器人 出来讲话                                  │
│  🤖 [无回复] ❌ 处理链路失败                          │
│      📋 DecisionEngine MAX_TOKENS错误 (16.3秒超时)   │
│      🔗 [查看详细链路] [重新处理]                     │
│  ─────────────────────────────────────────────────── │
│  ⏰ 2025-09-14 17:30:12     👤 小明(12345)           │
│  💬 这个功能怎么实现？                                │
│  🤖 可以用TypeScript的装饰器模式... ✅               │
│      ⏱️ 响应时间: 5.2秒 | 🔑 Token: Project-5        │
│      👍 [赞] 👎 [踩] 📊 [性能数据]                   │
│  ─────────────────────────────────────────────────── │
│  ⏰ 2025-09-14 16:45:33     👤 小红(67890)           │
│  💬 大家好                                           │
│  🤖 [未回复] ⏳ 决策引擎判定为普通打招呼               │
│      📋 shouldRespond: false (confidence: 85%)      │
└─────────────────────────────────────────────────────┘
```

### 3. 群聊链路追踪页面 `/group-chats/:groupId/trace/:traceId`

**功能与私聊链路类似，但增加群聊特有的处理步骤:**
```
1️⃣ WebSocket消息接收      ✅
2️⃣ @检测和消息清理        ✅  
3️⃣ 群聊三层设置检查       ✅
    ├─ receive_events: ✅ 启用  
    ├─ is_enabled: ✅ 启用
    └─ auto_reply_enabled: ✅ 启用
4️⃣ 上下文构建             ✅
    ├─ 群聊历史: 20条
    ├─ 群聊信息: 成员数等
    └─ 用户信息: 在群活跃度
5️⃣ 决策引擎分析           ❌
6️⃣ PersonaEngine增强      (未执行)
7️⃣ 消息发送              (未执行)
```

## 💾 数据库设计

### 新增表结构

```sql
-- 私聊设置表 (如不存在)
CREATE TABLE IF NOT EXISTS private_chat_settings (
    user_id BIGINT PRIMARY KEY,
    is_enabled BOOLEAN DEFAULT TRUE,
    auto_reply_enabled BOOLEAN DEFAULT TRUE,
    nickname VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 群聊扩展信息表
CREATE TABLE IF NOT EXISTS group_chat_extended (
    group_id BIGINT PRIMARY KEY,
    group_name VARCHAR(200),
    description TEXT,
    member_count INT DEFAULT 0,
    activity_score INT DEFAULT 0,
    last_activity_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 对话状态统计表 (用于快速查询)
CREATE TABLE IF NOT EXISTS conversation_stats (
    id VARCHAR(36) PRIMARY KEY,
    target_type ENUM('private', 'group') NOT NULL,
    target_id BIGINT NOT NULL,
    date DATE NOT NULL,
    total_messages INT DEFAULT 0,
    successful_replies INT DEFAULT 0,
    failed_replies INT DEFAULT 0,
    avg_response_time DECIMAL(10,3) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_target_date (target_type, target_id, date)
);

-- 处理链路详情表
CREATE TABLE IF NOT EXISTS processing_traces (
    id VARCHAR(36) PRIMARY KEY,
    trace_id VARCHAR(36) NOT NULL,
    conversation_id VARCHAR(36),
    step_name VARCHAR(100) NOT NULL,
    step_order INT NOT NULL,
    status ENUM('pending', 'processing', 'success', 'failed', 'skipped') NOT NULL,
    start_time TIMESTAMP(3) NOT NULL,
    end_time TIMESTAMP(3),
    duration_ms INT,
    input_data JSON,
    output_data JSON,
    error_message TEXT,
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_trace_id (trace_id),
    INDEX idx_conversation_id (conversation_id)
);
```

## 🔌 API 设计

### 私聊管理 API

```typescript
// 获取用户列表
GET /api/private-chats
Query: {
  search?: string,           // 搜索用户ID/昵称/消息内容
  timeRange?: string,        // today/week/month/all
  status?: string,           // success/failed/disabled/all
  page?: number,
  limit?: number
}

// 获取用户对话详情
GET /api/private-chats/:userId
Query: {
  search?: string,
  startTime?: string,
  endTime?: string,
  limit?: number
}

// 获取对话链路详情
GET /api/private-chats/:userId/trace/:traceId

// 用户设置操作
PUT /api/private-chats/:userId/settings
Body: {
  is_enabled?: boolean,
  auto_reply_enabled?: boolean,
  nickname?: string,
  notes?: string
}

// 重试消息
POST /api/private-chats/:userId/retry/:conversationId

// 手动回复
POST /api/private-chats/:userId/reply
Body: {
  message: string,
  reply_to?: string
}
```

### 群聊管理 API

```typescript
// 获取群组列表
GET /api/group-chats
Query: {
  search?: string,
  status?: string,
  sortBy?: 'activity' | 'name' | 'recent',
  page?: number,
  limit?: number
}

// 获取群聊详情
GET /api/group-chats/:groupId
Query: {
  search?: string,
  startTime?: string,
  endTime?: string,
  showAll?: boolean,  // 显示所有消息还是只显示@机器人的
  limit?: number
}

// 获取群聊统计
GET /api/group-chats/:groupId/stats
Query: {
  timeRange?: string
}

// 群聊设置操作
PUT /api/group-chats/:groupId/settings
Body: {
  receive_events?: boolean,
  is_enabled?: boolean,
  auto_reply_enabled?: boolean,
  group_name?: string,
  welcome_message?: string
}
```

### 链路追踪 API

```typescript
// 获取处理链路
GET /api/traces/:traceId

// 重新处理消息
POST /api/traces/:traceId/retry

// 获取类似错误
GET /api/traces/similar/:traceId
Query: {
  limit?: number,
  timeRange?: string
}
```

## 📊 状态定义

### 对话状态枚举
```typescript
enum ConversationStatus {
  SUCCESS = 'success',           // ✅ 成功回复
  FAILED = 'failed',            // ❌ 处理失败
  PROCESSING = 'processing',     // ⏳ 正在处理
  TIMEOUT = 'timeout',          // ⏰ 处理超时
  DISABLED = 'disabled',        // 🔇 用户/群聊被禁用
  IGNORED = 'ignored',          // 🔕 决策引擎判定忽略
  RATE_LIMITED = 'rate_limited' // 🚫 触发频率限制
}
```

### 处理步骤枚举
```typescript
enum ProcessingStep {
  // 通用步骤
  MESSAGE_RECEIVED = 'message_received',
  MESSAGE_PARSED = 'message_parsed',
  SETTINGS_CHECKED = 'settings_checked',
  CONVERSATION_CREATED = 'conversation_created',
  
  // 群聊特有
  AT_DETECTION = 'at_detection',
  GROUP_SETTINGS_CHECK = 'group_settings_check',
  
  // AI处理
  CONTEXT_BUILT = 'context_built',
  DECISION_ANALYSIS = 'decision_analysis',
  AI_RESPONSE_GENERATED = 'ai_response_generated',
  PERSONA_ENHANCED = 'persona_enhanced',
  MESSAGE_SENT = 'message_sent'
}
```

## 📱 前端组件设计

### 核心组件列表

```typescript
// 页面组件
components/
├── PrivateChatList/          // 私聊列表页
├── PrivateChatDetail/        // 私聊详情页  
├── GroupChatList/            // 群聊列表页
├── GroupChatDetail/          // 群聊详情页
├── TraceDetail/              // 链路详情页
└── shared/
    ├── ConversationItem/     // 对话条目组件
    ├── StatusBadge/          // 状态标识组件
    ├── TimelineTrace/        // 链路时间线组件
    ├── SearchFilter/         // 搜索过滤组件
    └── QuickActions/         // 快捷操作组件
```

### 状态管理

```typescript
// 使用 React Query 管理服务端状态
const usePrivateChats = (filters: ChatFilters) => {
  return useQuery(['private-chats', filters], () => 
    api.getPrivateChats(filters)
  );
};

const useConversationTrace = (traceId: string) => {
  return useQuery(['trace', traceId], () => 
    api.getTrace(traceId)
  );
};

// 实时更新
const useRealtimeStatus = () => {
  useEffect(() => {
    const ws = new WebSocket('/api/ws/status');
    ws.onmessage = (event) => {
      const update = JSON.parse(event.data);
      queryClient.invalidateQueries(['conversations']);
    };
  }, []);
};
```

## 🔄 实现步骤

### Phase 1: 基础架构 (1-2周)
1. ✅ 设计文档确认
2. 📊 数据库表结构创建
3. 🔌 基础 API 接口实现
4. 📱 前端路由和页面框架

### Phase 2: 私聊管理 (1-2周)  
1. 📋 用户列表页面
2. 💬 用户对话详情页面
3. 🔍 搜索和过滤功能
4. ⚙️ 用户设置管理

### Phase 3: 群聊管理 (1-2周)
1. 👥 群组列表页面  
2. 💬 群聊详情页面
3. 📊 群聊统计功能
4. ⚙️ 群聊设置管理

### Phase 4: 链路追踪 (2-3周)
1. 🔄 处理步骤记录机制
2. 📈 链路可视化组件
3. 🔍 错误分析和建议
4. 🔄 重试和修复功能

### Phase 5: 优化增强 (1-2周)
1. ⚡ 性能优化
2. 📊 实时状态更新  
3. 🔔 告警通知
4. 📊 高级统计分析

## 🎯 成功指标

1. **问题定位效率**: 从发现问题到定位根因 < 2分钟
2. **用户体验**: 界面响应时间 < 500ms  
3. **数据完整性**: 95%+ 的对话有完整链路记录
4. **实用性**: 90%+ 的运维问题可通过界面解决

---

## 📝 备注

本文档为设计阶段文档，实现过程中如遇到技术限制或更好的方案，可灵活调整。重点是确保核心功能（私聊/群聊管理、链路追踪、问题定位）的完整实现。
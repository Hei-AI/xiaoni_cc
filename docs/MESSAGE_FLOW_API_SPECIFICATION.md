# QQ Bot 消息流程API完整规范文档

## 📋 文档概述

**文档目标**：为QQ Bot项目的消息处理流程API建立标准规范，确保队列解耦架构下的完整可追溯性。

**适用范围**：所有新功能开发、重构项目、API设计和功能验证。

**更新要求**：每次架构变更或新功能添加都必须更新此文档并据此进行验证。

## 🏗️ 当前架构概述

### 消息处理流程（队列解耦架构）
```
OneBot协议消息 → 消息队列 → 队列消费者 → AI处理引擎 → HTTP API响应 → OneBot协议发送
       ↓            ↓          ↓           ↓            ↓
   接收记录      入队记录    消费记录    LLM调用记录   输出记录
```

### 核心特点
- **解耦设计**：消息输入通过队列系统，输出通过HTTP API
- **完整追踪**：每个环节都有独立的记录表
- **异步处理**：消息到达≠消息消费，支持批量和优先级处理
- **可观测性**：提供完整的调用链路追踪和性能监控

## 🎯 LLM Flow API 规范

### API端点
```
GET /api/debug/conversation/{conversationId}/llm-flow
```

### 核心职责
1. **完整追溯**：提供消息从输入到输出的完整链路数据
2. **性能分析**：展示各环节的处理时间和资源消耗
3. **故障诊断**：提供详细的错误信息和调试数据
4. **业务监控**：支持成本分析、质量评估和流程优化

## 📊 API响应结构规范

### TypeScript接口定义

```typescript
interface MessageFlowResponse {
  conversation_id: string;
  trace_id: string;

  // 🔥 消息输入：来自队列系统的原始消息
  message_input: {
    user_id: number;
    message: string;
    message_type: 'private' | 'group';
    group_id?: number;
    message_id: number;
    source: 'queue' | 'api_simulation' | 'test';
    queued_at: string;                    // ISO时间戳：消息入队时间
    processed_at: string;                 // ISO时间戳：开始处理时间
    partition_key: string;                // 队列分区标识
    priority: 'HIGH' | 'MEDIUM' | 'LOW';  // 消息优先级
    batch_info?: {                        // 批处理信息
      batch_id: string;
      batch_index: number;
      batch_size: number;
    };
  };

  // 🔥 消息输出：通过HTTP API发送的响应
  message_output: {
    content: string;                      // AI生成的回复内容
    response_time_ms: number;             // 总处理耗时（毫秒）
    model_used: string;                   // 最终使用的AI模型
    delivery_method: 'http_api';          // 固定值，表示通过HTTP API发送
    delivery_status: 'sent' | 'failed' | 'pending';
    timestamp: string;                    // ISO时间戳：响应发送时间
    character_count: number;              // 回复内容字符数
    delivery_latency_ms?: number;         // 发送延迟（毫秒）
  };

  // 🔥 LLM调用链路：所有AI服务调用的详细记录
  llm_call_chain: LLMCallRecord[];

  // 🔥 处理事件链路：完整的处理过程事件
  processing_events: ProcessingEvent[];

  // 🔥 流程统计摘要
  flow_summary: FlowSummary;

  // 🔥 调试信息
  debug_info: DebugInfo;
}

interface LLMCallRecord {
  sequence: number;                       // 调用序号
  stage: string;                          // 处理阶段标识
  agent_type: string;                     // 智能引擎类型
  purpose: string;                        // 调用目的描述

  // 输入信息
  input: {
    model_name: string;                   // 调用的AI模型
    model_provider: string;               // 模型提供商
    prompt_template: string;              // 使用的提示词模板
    input_prompt: string;                 // 实际输入提示词
    model_config: {                       // 模型配置参数
      temperature?: number;
      max_tokens?: number;
      top_p?: number;
      [key: string]: any;
    };
    context_summary?: string;             // 上下文摘要
    timestamp: string;                    // 调用开始时间
  };

  // 输出信息
  output: {
    status: 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'SKIPPED';
    raw_response?: string;                // API原始响应
    processed_response?: string;          // 处理后的响应
    token_usage: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };
    performance: {
      api_call_time_ms: number;           // API调用耗时
      processing_time_ms: number;         // 总处理耗时
      queue_wait_time_ms?: number;        // 队列等待时间
    };
    cost_estimate?: number;               // 成本估算（美元）
    error_info?: {
      error_message: string;
      error_code: string;
      retry_count: number;
    };
    timestamp: string;                    // 调用结束时间
  };
}

interface ProcessingEvent {
  event_id: string;
  event_type: 'queue' | 'llm' | 'engine' | 'api' | 'error';
  event_name: string;                     // 具体事件名称
  event_phase: 'start' | 'end' | 'instant';
  event_time: string;                     // ISO时间戳
  duration_ms?: number;                   // 事件持续时间（仅end阶段）
  metadata?: {                            // 事件相关元数据
    component: string;                    // 触发组件
    details: any;                         // 详细信息
    performance_metrics?: any;            // 性能指标
  };
}

interface FlowSummary {
  total_processing_time_ms: number;       // 总处理时间
  queue_wait_time_ms: number;             // 队列等待时间
  llm_processing_time_ms: number;         // LLM处理时间
  total_llm_calls: number;                // LLM调用总数
  successful_calls: number;               // 成功调用数
  failed_calls: number;                   // 失败调用数
  skipped_calls: number;                  // 跳过调用数
  total_tokens_used: number;              // 总Token使用量
  total_cost_estimate: number;            // 总成本估算
  success_rate: number;                   // 成功率百分比
  bottleneck_stage?: string;              // 性能瓶颈阶段
  efficiency_score: number;               // 效率评分 (0-100)
}

interface DebugInfo {
  data_completeness: {
    conversation_record: 'complete' | 'partial' | 'missing';
    llm_call_logs: 'complete' | 'partial' | 'missing';
    queue_logs: 'complete' | 'partial' | 'missing';
    processing_events: 'complete' | 'partial' | 'missing';
  };
  missing_data_reasons: string[];         // 数据缺失原因
  architecture_notes: string[];           // 架构相关说明
  performance_warnings: string[];         // 性能警告
  recommendations: string[];              // 优化建议
}
```

## 🗄️ 数据源映射规范

### 核心数据表关系

```sql
-- 主要数据表及其作用
conversations          -- 对话基础记录
├── llm_call_logs      -- LLM调用详细记录 (按conversation_id和trace_id关联)
├── message_arrivals   -- 消息到达记录 (队列入队)
├── message_consumptions -- 消息消费记录 (队列出队处理)
├── processing_events  -- 处理过程事件记录 (timeline_events表)
└── api_response_logs  -- API响应记录 (HTTP输出)
```

### 数据获取逻辑

```sql
-- 1. 获取对话基础信息
SELECT id, trace_id, user_id, user_message, ai_response, status,
       response_time, model_name, created_at, raw_request, raw_response
FROM conversations
WHERE id = ?

-- 2. 获取LLM调用链路 (核心修复点)
SELECT * FROM llm_call_logs
WHERE conversation_id = ? OR trace_id = ?
ORDER BY call_sequence ASC

-- 3. 获取队列处理记录
SELECT * FROM message_arrivals
WHERE conversation_id = ?
UNION ALL
SELECT * FROM message_consumptions
WHERE conversation_id = ?

-- 4. 获取处理事件链路
SELECT * FROM timeline_events
WHERE trace_id = ?
ORDER BY event_time ASC

-- 5. 获取API输出记录
SELECT * FROM api_response_logs
WHERE conversation_id = ?
```

## ✅ 功能验证标准

### 4层验证体系

#### 第1层：端到端流程验证
```bash
# 触发完整消息处理流程
curl -X POST "http://localhost:8081/api/simulate/private" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": 888999,
    "message": "功能验证测试：检查队列解耦架构完整性"
  }'

# 验证标准：
# ✅ 返回conversation_id
# ✅ HTTP状态码200
# ✅ 响应时间 < 30秒
```

#### 第2层：数据库记录完整性验证
```javascript
// 验证脚本：validate_data_completeness.js
async function validateDataCompleteness(conversationId) {
  // 1. 验证conversations表基础记录
  const conversation = await db.query(
    'SELECT * FROM conversations WHERE id = ?', [conversationId]
  );
  assert(conversation.length === 1, "❌ 对话记录不存在");
  assert(conversation[0].trace_id !== null, "❌ trace_id缺失");
  assert(conversation[0].ai_response !== null, "❌ AI回复缺失");
  assert(conversation[0].status === 'completed', "❌ 状态异常");

  // 2. 验证LLM调用记录 (核心修复验证点)
  const llmLogs = await db.query(
    'SELECT * FROM llm_call_logs WHERE conversation_id = ?', [conversationId]
  );
  assert(llmLogs.length >= 1, "❌ 核心BUG：llm_call_logs无记录!");

  llmLogs.forEach((log, index) => {
    assert(log.trace_id === conversation[0].trace_id, `❌ LLM记录${index} trace_id不匹配`);
    assert(log.agent_type !== null, `❌ LLM记录${index} agent_type缺失`);
    assert(log.model_name !== null, `❌ LLM记录${index} model_name缺失`);
    assert(log.status !== null, `❌ LLM记录${index} status缺失`);
    assert(log.api_call_time_ms >= 0, `❌ LLM记录${index} 调用时间异常`);
  });

  // 3. 验证队列处理记录
  const queueLogs = await db.query(
    'SELECT * FROM message_arrivals WHERE conversation_id = ?', [conversationId]
  );
  assert(queueLogs.length >= 1, "❌ 队列到达记录缺失");

  // 4. 验证处理事件记录
  const events = await db.query(
    'SELECT * FROM timeline_events WHERE trace_id = ?', [conversation[0].trace_id]
  );
  assert(events.length >= 2, "❌ 处理事件记录不完整");

  return true;
}
```

#### 第3层：API响应结构验证
```javascript
// 验证脚本：validate_api_response.js
async function validateAPIResponse(conversationId) {
  const response = await fetch(`/api/debug/conversation/${conversationId}/llm-flow`);
  const data = await response.json();

  // 1. 基础结构验证
  assert(data.conversation_id === conversationId, "❌ conversation_id不匹配");
  assert(data.message_input !== null, "❌ message_input缺失");
  assert(data.message_output !== null, "❌ message_output缺失");
  assert(Array.isArray(data.llm_call_chain), "❌ llm_call_chain不是数组");
  assert(Array.isArray(data.processing_events), "❌ processing_events不是数组");

  // 2. 核心修复验证：LLM调用链路不为空
  assert(data.llm_call_chain.length > 0, "❌ 核心BUG：llm_call_chain仍为空!");

  // 3. LLM调用记录结构验证
  data.llm_call_chain.forEach((call, index) => {
    assert(call.input.model_name, `❌ 调用${index} model_name缺失`);
    assert(call.input.input_prompt, `❌ 调用${index} input_prompt缺失`);
    assert(call.output.status, `❌ 调用${index} status缺失`);
    assert(call.output.performance.api_call_time_ms >= 0, `❌ 调用${index} 时间异常`);
    assert(call.output.token_usage.total_tokens >= 0, `❌ 调用${index} token异常`);
  });

  // 4. 队列解耦架构验证
  assert(data.message_input.source === 'queue' || data.message_input.source === 'api_simulation',
         "❌ 消息来源不正确");
  assert(data.message_output.delivery_method === 'http_api',
         "❌ 输出方式不正确");

  // 5. 业务数据合理性验证
  assert(data.flow_summary.total_processing_time_ms > 0, "❌ 总处理时间为0");
  assert(data.flow_summary.success_rate >= 0 && data.flow_summary.success_rate <= 100,
         "❌ 成功率异常");

  return data;
}
```

#### 第4层：前端显示效果验证
```typescript
// 前端验证：ConversationTimelinePage组件
export function validateTimelineDisplay(conversationId: string) {
  const { data, isLoading, error } = useConversationTimeline(conversationId);

  // 1. 数据加载验证
  assert(!isLoading, "❌ 数据仍在加载中");
  assert(!error, `❌ 加载错误: ${error}`);
  assert(data !== undefined, "❌ 数据未返回");

  // 2. Timeline节点生成验证
  assert(data.timeline_nodes.length > 0, "❌ Timeline节点为空");
  const llmNodes = data.timeline_nodes.filter(node => node.type === 'llm_call');
  assert(llmNodes.length > 0, "❌ 缺少LLM调用节点");

  // 3. 节点数据完整性验证
  llmNodes.forEach((node, index) => {
    assert(node.data.model_name, `❌ 节点${index} model_name缺失`);
    assert(node.data.processing_time_ms > 0, `❌ 节点${index} 处理时间为0`);
    assert(node.status === 'success', `❌ 节点${index} 状态异常`);
    assert(node.data.total_tokens > 0, `❌ 节点${index} token数据异常`);
  });

  // 4. 统计数据验证
  assert(data.timeline_summary.total_duration > 0, "❌ 总耗时为0");
  assert(data.timeline_summary.total_cost > 0, "❌ 总成本为0");
  assert(data.timeline_summary.success_rate >= 0, "❌ 成功率异常");

  return data;
}
```

## 🤖 自动化验证脚本

### 完整验证脚本：test_message_flow_api.js

```javascript
const mysql = require('mysql2/promise');
const axios = require('axios');

async function runCompleteValidation() {
  console.log('🚀 开始消息流程API完整验证...\n');

  try {
    // 第1步：触发端到端测试
    console.log('第1步：发送测试消息...');
    const response = await axios.post('http://localhost:8081/api/simulate/private', {
      user_id: 888999,
      message: '完整验证测试：队列解耦架构消息流程检查'
    });

    const conversationId = response.data.conversation_id;
    console.log(`✅ 消息发送成功，conversation_id: ${conversationId}`);

    // 等待处理完成
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 第2层：数据库验证
    console.log('\n第2步：验证数据库记录完整性...');
    await validateDataCompleteness(conversationId);
    console.log('✅ 数据库记录验证通过');

    // 第3层：API响应验证
    console.log('\n第3步：验证API响应结构...');
    const apiData = await validateAPIResponse(conversationId);
    console.log('✅ API响应结构验证通过');

    // 第4层：业务逻辑验证
    console.log('\n第4步：验证业务逻辑正确性...');
    await validateBusinessLogic(apiData);
    console.log('✅ 业务逻辑验证通过');

    // 生成验证报告
    console.log('\n📊 生成验证报告...');
    const report = generateValidationReport(conversationId, apiData);
    console.log(report);

    console.log('\n🎉 消息流程API完整验证通过！');
    return { conversationId, status: 'SUCCESS', report };

  } catch (error) {
    console.error('\n❌ 验证失败:', error.message);
    throw error;
  }
}

async function validateDataCompleteness(conversationId) {
  // [数据库验证逻辑 - 同第2层验证]
}

async function validateAPIResponse(conversationId) {
  // [API响应验证逻辑 - 同第3层验证]
}

async function validateBusinessLogic(apiData) {
  // 队列解耦架构特定验证
  assert(apiData.message_input.source !== 'websocket',
         "❌ 仍在使用WebSocket架构，应该是队列架构");
  assert(apiData.message_output.delivery_method === 'http_api',
         "❌ 输出方式错误，应该是HTTP API");

  // LLM调用链路验证
  const llmCalls = apiData.llm_call_chain;
  assert(llmCalls.some(call => call.agent_type === 'chat_bot'),
         "❌ 缺少主要的chat_bot调用");

  // 性能指标验证
  const totalTime = apiData.flow_summary.total_processing_time_ms;
  assert(totalTime > 0 && totalTime < 60000,
         "❌ 总处理时间异常，应该在0-60秒之间");
}

function generateValidationReport(conversationId, apiData) {
  return `
📋 消息流程API验证报告
================================
对话ID: ${conversationId}
验证时间: ${new Date().toISOString()}

🔍 架构验证结果:
- 队列解耦架构: ✅ 正常
- HTTP API输出: ✅ 正常
- LLM调用链路: ✅ 正常 (${apiData.llm_call_chain.length}条记录)

⚡ 性能指标:
- 总处理时间: ${apiData.flow_summary.total_processing_time_ms}ms
- LLM处理时间: ${apiData.flow_summary.llm_processing_time_ms}ms
- 队列等待时间: ${apiData.flow_summary.queue_wait_time_ms}ms
- 成功率: ${apiData.flow_summary.success_rate}%

💰 成本分析:
- 总Token使用: ${apiData.flow_summary.total_tokens_used}
- 估算成本: $${apiData.flow_summary.total_cost_estimate}

✅ 验证状态: 全部通过
  `;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// 导出给CI/CD使用
module.exports = { runCompleteValidation };

// 直接运行
if (require.main === module) {
  runCompleteValidation().catch(console.error);
}
```

## 📐 开发和重构规范

### 新功能开发检查清单

在开发任何新功能前，必须检查：

- [ ] 是否会影响消息流程？如果是，更新此文档
- [ ] 是否添加新的数据表？如果是，更新数据源映射
- [ ] 是否修改API响应？如果是，更新TypeScript接口
- [ ] 是否更改处理逻辑？如果是，更新验证标准

### 重构项目检查清单

在进行重构前，必须：

- [ ] 运行完整验证脚本，记录重构前基准
- [ ] 更新相关的TypeScript接口定义
- [ ] 修改对应的数据库查询逻辑
- [ ] 更新验证脚本以适应新架构
- [ ] 运行重构后验证，确保功能正常

### API修改规范

任何对LLM Flow API的修改都必须：

1. **向后兼容**：新版本必须兼容现有前端代码
2. **文档先行**：先更新此规范文档，再开始编码
3. **全量测试**：运行所有4层验证确保无回归
4. **版本标记**：在API响应中包含版本信息

### 错误处理标准

API必须处理以下异常情况：

- 对话记录不存在 → 返回404和明确错误信息
- LLM调用记录缺失 → 返回部分数据和警告信息
- 数据库连接失败 → 返回503和重试建议
- 数据格式异常 → 返回500和详细错误描述

## 🔄 持续改进机制

### 定期评估（每月）

- 验证脚本的覆盖率评估
- API响应时间性能评估
- 数据完整性统计分析
- 用户使用体验反馈收集

### 版本演进记录

| 版本 | 更新日期 | 主要变更 | 影响范围 |
|------|---------|---------|---------|
| v1.0 | 2025-09-22 | 初始版本，定义队列解耦架构API规范 | 全新文档 |

### 改进建议流程

1. **问题识别**：通过验证脚本或用户反馈发现问题
2. **影响评估**：评估修改对现有功能的影响
3. **方案设计**：基于此文档设计解决方案
4. **文档更新**：先更新规范文档
5. **实施验证**：按照更新后的标准进行开发和测试

---

**📌 重要提醒**：此文档是项目的"单一事实来源"，所有消息流程相关的开发工作都必须以此为准。违反此规范的代码不应被合并到主分支。
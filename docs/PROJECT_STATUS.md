# 项目状态与修复清单

## 当前实现概览

### 消息队列处理
- 入口：`handlePrivateMessage` / `handleGroupMessage` 统一经 `MessageQueueService` 入队，私聊分区 `user_<id>`，群聊分区 `group_<id>`。
- 消费：直连模式通过 `DirectNotifier` 立即 `drain`，拟人化模式使用 `ScheduleDispatcher` 轮询触发批处理。
- 核心处理：`handle*Batch` 调用 `_processSingle*`，串联上下文、决策引擎、Persona 引擎。

### LLM 工具调用链
- 任务存储：`llm_jobs` 表及 `LLMJobWorker` 轮询，实现多轮函数调用与重试。
- 分发与执行：`FunctionCallDispatcher` 负责 search/invoke/静态工具，`ToolRegistryService` 管理动态工具。
- AI 调用：`AIService.generateContent()` 封装 Gemini 请求、日志与 token 管理。

## 本次修复背景
- 文档依据：`docs/HUMAN_LIKE_PROCESSOR_FLOW.md`、`docs/HUMAN_LIKE_PROCESSOR_FLOW_LLM_TOOLS.md`、`docs/LLM_TOOL_EXECUTION_DESIGN.md`。
- 目标：
  - 批量处理的运行数据需要落库，以便调试和在 Admin Panel 中可视化。
  - LLM 异步任务完成后必须携带最终回复及元数据，才能通过 QQBot 回传给用户。
  - 队列模拟功能需要通过admin-panel代理到qqbot-core实现。

## 完成事项（2025-10-04）

| 方向 | 问题 | 状态 | 完成时间 |
| --- | --- | --- | --- |
| 消息队列 | 批次信息未落地数据库，调试数据缺失。 | ✅ 已实现 | 2025-10-04 |
| LLM FC | `job_completed`/`job_failed` 事件缺少 `finalResponse` 与 `metadata`。 | ✅ 已实现 | 2025-10-04 |
| 代理架构 | Admin-panel需要代理队列请求到qqbot-core | ✅ 已实现 | 2025-10-04 |
| 队列端点 | Simulate端点实现错误（调用不存在的方法） | ✅ 已修复 | 2025-10-04 |
| 环境配置 | LLM工具系统环境变量缺失 | ✅ 已配置 | 2025-10-04 |
| Token管理 | `getTokenForModel()` 在无匹配 agent_prompts 时返回 null | ✅ 已修复 | 2025-10-04 |
| 测试 & 文档 | 缺少完整的集成测试与自验证脚本。 | ✅ 已完成 | 2025-10-04 |

### 完成详情

**消息队列批次数据落库**
- ✅ `conversation_batches` 表已创建并启用（migration 009）
- ✅ `handlePrivateMessageBatch` 和 `handleGroupMessageBatch` 已实现批次记录创建和更新
- ✅ `message_consumptions` 表记录每条消息的消费状态
- ✅ 验证通过：批次记录正常创建，状态更新为completed

**LLM Function Calling 事件完整性**
- ✅ `LLMJobWorker` 已正确实现 `job_completed` 事件，包含 `finalResponse` 和 `metadata`（src/services/llm-job-worker.ts:227-240）
- ✅ `job_failed` 事件同样包含 `error` 和 `metadata`
- ✅ `index.ts` 中的事件监听器已正确处理并发送异步回复
- ✅ 验证通过：LLMJobWorker正常启动，Job正常创建和重试

**Admin Panel代理架构**
- ✅ `simple-queue-monitor.ts` 已修改为代理模式，转发请求到qqbot-core
- ✅ 修复了容器名称解析问题（qqbot-core -> qqbot-qqbot-core）
- ✅ 修复了http-server中simulate端点实现（使用qqBot.simulateXXXSimple方法）
- ✅ 验证通过：代理成功，消息正常处理

**环境配置优化**
- ✅ 在deploy脚本中添加了ENABLE_LLM_TOOLS及相关环境变量
- ✅ 默认启用LLM工具系统（ENABLE_LLM_TOOLS=true）
- ✅ 配置了LLM并发数、轮询间隔、超时等参数

**Token管理修复**
- ✅ 修复 `getTokenForModel()` 方法在无匹配 `agent_prompts` 时返回 null 的问题
- ✅ 添加智能回退机制：当无模型特定配置时，自动使用通用token池
- ✅ 实现代码位于 `modules/qqbot-core/src/utils/token-manager.ts:791-857`
- ✅ 验证通过：LLM Job 成功使用 `gemini-2.0-flash-exp` 模型完成计算任务

**测试与验证**
- ✅ 补充 `llm-tools-integration.test.ts` 测试用例，覆盖事件 payload 完整性验证
- ✅ 创建 `scripts/self-verification.sh` 自验证脚本
- ✅ 数据库迁移脚本已执行（009、010）
- ✅ A部分（消息队列）验证完全通过
- ✅ B部分（LLM工具）完整验证通过（Job创建、执行、回复全流程正常）

> 备注（2025-10-04）：所有核心功能已实现并通过完整验证，包括Token管理的智能回退机制。系统已具备完整的LLM工具调用能力。

## 自验证流程

> 验收通过标准：下列测试全部成功，日志与数据库中的数据均符合预期。

### 快速验证（推荐）

使用自动化验证脚本：

```bash
# 执行完整自验证流程
./scripts/self-verification.sh

# 或指定环境变量
ADMIN_API_URL=http://localhost:9080 \
MYSQL_HOST=localhost \
MYSQL_PORT=3306 \
MYSQL_USER=qqbot_user \
MYSQL_PASSWORD=qqbot_password \
MYSQL_DATABASE=qqbot_db \
./scripts/self-verification.sh
```

验证脚本将自动执行以下检查：
- ✅ 数据库连接与表结构验证
- ✅ 消息队列批处理验证（Part A）
- ✅ LLM Function Calling 完整流程验证（Part B）
- ✅ 工具执行日志验证

### 手动验证步骤

如需手动验证，请按以下步骤操作：

### A. 消息队列
1. 启动 `qqbot-core`（默认 `ENABLE_HUMAN_LIKE_PROCESSING=false` 验证直连模式，可再切换为 true 验证调度模式）。
2. 发送模拟消息：
   ```bash
   curl -X POST http://localhost:9080/api/queue/simulate/private \
     -H 'Content-Type: application/json' \
     -d '{"user_id":123456,"message":"测试消息"}'
   ```
3. 查看统计与分区：`curl http://localhost:9080/api/queue/stats`、`curl http://localhost:9080/api/queue/partitions/user_123456`。
4. 在数据库确认 `conversations` / `message_consumptions` 状态，检查 `logs/qqbot-core.log` 中批处理日志。
5. 查询 `conversation_batches` 表应能看到新批次记录（含 `trigger_type`、`message_count`、`status` 等字段）。

### B. LLM Function Calling
1. 设置 `ENABLE_LLM_TOOLS=true` 并启动服务，确保日志出现 `LLMJobWorker started`。
2. 模拟私聊消息：
   ```bash
   curl -X POST http://localhost:9080/api/test/simulate-message \
     -H 'Content-Type: application/json' \
     -d '{"message":{"message_type":"private","user_id":123456,"raw_message":"请计算 12*8","message":"请计算 12*8"}}'
   ```
3. 查询 `llm_jobs`：`SELECT status, final_response, metadata FROM llm_jobs ORDER BY created_at DESC LIMIT 1;`。
4. 检查 `logs/qqbot-core.log` 是否出现 `LLM Job response sent`，并确认 WebSocket 发送调用或实际回复。
5. 人为制造错误（例如传入无效 `method_id`），确认 `job_failed` 事件触发且 `conversations` 状态更新为 `failed`。

若上述流程全部通过，则视作本轮修复验收完成。若出现异常，请对照相关日志与数据库记录定位问题，并回滚或追加修复后重新执行测试。

## 文档参考
- `docs/HUMAN_LIKE_PROCESSOR_FLOW.md`
- `docs/HUMAN_LIKE_PROCESSOR_IMPLEMENTATION.md`
- `docs/HUMAN_LIKE_PROCESSOR_FLOW_LLM_TOOLS.md`
- `docs/ROADMAP.md`

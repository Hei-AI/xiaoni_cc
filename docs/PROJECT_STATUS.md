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

### HTTP 流量监控
- `modules/http-traffic-monitor` 通过 mitmproxy 输出 `traffic-*.jsonl` 日志。
- admin-backend 内置 `traffic-log-watcher`，实时监听 JSONL 变动并写入数据库（详见 `modules/http-traffic-monitor/README.md`）。

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
- ✅ `queue-monitor.ts` 直接调用 qqbot-core `/api/simple-queue/*` 接口，移除独立 sidecar
- ✅ 保持 `/api/queue-monitor/*` 响应结构不变，前端无缝刷新队列列表
- ✅ 修复了容器名称解析问题（qqbot-core -> qqbot-qqbot-core）
- ✅ 修复了 http-server 中 simulate 端点实现（使用 qqBot.simulateXXXSimple 方法）
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

## 完成事项（2025-10-09）

| 方向 | 问题 | 状态 | 完成时间 |
| --- | --- | --- | --- |
| Prompt 管理 | 无法为指定用户/群绑定 agent prompt，且默认 prompt 名称不一致。 | ✅ 已实现 | 2025-10-09 |
| Prompt 回退 | 未绑定 prompt 时仅依赖单一 `enhanced_chat` 配置，缺少容灾回退。 | ✅ 已实现 | 2025-10-09 |
| Admin UI | 群聊详情页缺少 prompt 选择器，测试人员无法直接变更配置。 | ✅ 已实现 | 2025-10-09 |

### 背景说明
- 运营反馈默认 persona 应为 `echance_chat`，但服务端硬编码为 `enhanced_chat`，导致首次对话与预期不符。
- 群聊 prompt 只能通过手动 SQL 修改，缺乏前端入口，回归测试效率低。
- Admin 后端 `/group-chats/:groupId/settings` 仍为占位实现，无法真正更新数据库记录。

### 代码改动摘要
- `modules/qqbot-core/src/index.ts`：引入 `['echance_chat','enhanced_chat','default_chat']` 候选链，`resolvePromptConfiguration()` 会依序尝试并暴露命中 prompt 的 ID/名称。
- `modules/admin-panel/backend/src/routes/chat-routes.ts`：群聊设置接口改为白名单字段更新，调用 `updateGroupChatSettings()` 落库并返回最新记录。
- `modules/admin-panel/frontend/src/pages/GroupChatDetailPage.tsx`：新增“Prompt 配置”卡片，可在 UI 中绑定/解绑 prompt，并根据候选链展示“默认（xxx）”标签。

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
   curl -X POST http://localhost:9080/api/simple-queue/simulate/private \
     -H 'Content-Type: application/json' \
     -d '{"user_id":123456,"message":"测试消息"}'
   ```
3. 查看统计与分区：`curl http://localhost:9080/api/simple-queue/stats`、`curl http://localhost:9080/api/simple-queue/partitions/user_123456`。
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

### C. Prompt 绑定与默认回退
1. **默认回退验证**
   1. 将目标用户/群的 `agent_prompt_id` 置为 `NULL`。
   2. 发送一条私聊消息，或在群聊 @ 机器人。
   3. 查看 `conversations.raw_request`，`promptName` 应为 `echance_chat`；若该配置不存在，则依次回退到 `enhanced_chat`、`default_chat`。
   4. 检查 qqbot-core 日志，确认记录实际命中的 `promptId`。
2. **私聊绑定自定义 prompt**
   1. 在 Admin “私聊详情”页选择一个 active prompt（例如 `basic_chat`）。
   2. 刷新页面确保下拉框保持选中状态。
   3. 发送消息并验证 `private_chat_settings.agent_prompt_id` 以及 `conversations.raw_request.configId` 与所选 prompt 一致。
3. **群聊绑定自定义 prompt**
   1. 在 Admin “群聊详情”页 -> “Prompt 配置”卡片选择新 prompt。
   2. 查询 `group_chat_settings.agent_prompt_id`，应更新为新 ID。
   3. 群内 @ 机器人，日志与 `conversations.raw_request.promptId` 应为该 ID。
4. **恢复默认**
   1. 在前端选择“默认（xxx）”。
   2. 数据库中的 `agent_prompt_id` 置空，再次发送消息时重新命中候选链首个可用 prompt。

通过标准：上述 4 项均成功落库并在日志/对话记录中体现正确的 prompt 名称与 ID。

## 测试用例设计（Prompt 绑定场景）

| 编号 | 场景 | 前置条件 | 操作步骤 | 预期结果 |
| --- | --- | --- | --- | --- |
| P01 | 默认回退链 | `agent_prompts` 表存在 `echance_chat`、`enhanced_chat`、`default_chat`；目标 user/group 未绑定 prompt | ① 清空绑定；② 发送消息；③ 检查 `conversations.raw_request` 与 qqbot-core 日志 | `promptName=echance_chat`; 日志显示命中 `echance_chat`；若缺失则按顺序回退至下一项 |
| P02 | 私聊绑定新 prompt | 管理后台可访问；存在 active prompt（如 `basic_chat`） | ① 私聊详情页绑定 `basic_chat`; ② 刷新页面；③ 再次发送消息 | 下拉框保持 `basic_chat`; `private_chat_settings.agent_prompt_id` 与 `conversations.raw_request.configId` 均为所选 ID |
| P03 | 私聊解绑恢复默认 | 已完成 P02，用户绑定 `basic_chat` | ① 在前端选择“默认”; ② 发消息; ③ 查 DB/日志 | `agent_prompt_id` 置空；新的对话 `promptName` 使用候选链首项；日志出现回退提示 |
| P04 | 群聊绑定生效 | 群聊存在 active prompt（如 `persona_chat`） | ① 群聊详情页选择 `persona_chat`; ② 校验 DB；③ 群内 @bot 发消息 | `group_chat_settings.agent_prompt_id` 更新；群聊回复与 `conversations.raw_request.promptId` 均为该 ID |
| P05 | 群聊设置接口容错 | Admin 后端可访问 | ① 调用 `/group-chats/:groupId/settings`，传入非法字段；② 观察响应 | 返回 400 `No valid fields to update`；数据库无变更 |
| P06 | UI 默认标签一致 | 任意无绑定群聊 | ① 打开群聊详情页面；② 查看“Prompt 配置”卡片 | “当前使用” badge 与下拉默认项显示“默认（echance_chat）”（若该 prompt 不存在则展示下一回退名称） |

执行上述用例时，请同步记录：
- admin-backend 日志是否输出 `Group settings updated successfully` 或 `Group settings unchanged`；
- qqbot-core 日志内的 `promptId`/`promptName` 命中信息；
- MySQL 中 `agent_prompt_id` 字段的前后差异；
- Admin UI 页面刷新后下拉框状态与数据库是否一致。

若上述流程全部通过，则视作本轮修复验收完成。若出现异常，请对照相关日志与数据库记录定位问题，并回滚或追加修复后重新执行测试。

## 完成事项（2025-10-10）

| 方向 | 问题 | 状态 | 完成时间 |
| --- | --- | --- | --- |
| LLM 工具 | 工具链 LLM 调用未继承 Prompt 模型 / Token 约束 | ✅ 已实现 | 2025-10-10 |

### 完成详情

- **代码改动**
  - `modules/qqbot-core/src/index.ts`: 创建 LLM Job 时同步写入 `model.name`、`agentType`、`promptName` 等元数据。
  - `modules/qqbot-core/src/services/llm-job-worker.ts`: 调用 LLM 前优先解析 Job 中的模型配置并透传给 `AIService.generateContent`。
  - `modules/qqbot-core/src/services/ai-service.ts`: `generateContent` 支持结构化 `options`，按 `options.modelName → request.model → 环境默认` 的顺序确定模型，TokenManager 与日志均使用真实的 `agentType/promptName`。

- **验证结果**
  1. **容器重建**：`docker compose build qqbot-core` + `docker compose up -d`，确保新镜像生效。
  2. **模拟请求**：`curl http://localhost:8081/api/test/simulate-message` 触发工具链，生成 Trace `test_1759650180602_...`。
  3. **数据校验**：
     - `llm_jobs` 最新记录 `config_json.model.name = gemini-2.5-flash`，`metadata.modelName = gemini-2.5-flash`。
     - `conversations` 对应行 `model_name = gemini-2.5-flash`。
     - `llm_call_logs` 最新记录展示 `model_name = gemini-2.5-flash / agent_type = chat_bot / prompt_template = basic_chat`。
  4. **脚本复核**：`node scripts/database/checks/check_model_config.js` 显示最近 2 小时模型使用仅 `gemini-2.5-flash`。

- **已有约束 / 后续改进**
  - 容器内 `npm test` 仍受 Jest 配置 (`/app/tests` 缺失) 限制，未能完成单测；需后续修复测试配置。
  - 若未来需要 Prompt 级别的备用模型，可在 `metadata.modelName` 中覆盖并沿用本次透传链路。

## 文档参考
- `docs/HUMAN_LIKE_PROCESSOR_FLOW.md`
- `docs/HUMAN_LIKE_PROCESSOR_IMPLEMENTATION.md`
- `docs/HUMAN_LIKE_PROCESSOR_FLOW_LLM_TOOLS.md`
- `docs/ROADMAP.md`

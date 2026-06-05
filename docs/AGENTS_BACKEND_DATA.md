# Backend And Data Task Guide

仅在任务涉及后端接口、队列、共享数据模型、数据库访问时阅读本文件。

## First Split
- 先判断问题落在 API 行为、队列链路还是共享持久化；不要一上来跨层同时翻。
- 共享数据结构先看 `packages/persistence`
- 管理端 API 先看 `modules/admin-panel/backend`

## Hard Rules
- PostgreSQL 是当前运行数据库。
- 所有 PostgreSQL 持久化读写都必须收口到 `packages/persistence`，不要把共享持久化逻辑散到路由、页面服务或模块内临时实现。
- 持久层必须优先使用 ORM；当前标准实现是 `packages/persistence` 中的 Prisma schema 和 Prisma Client。
- 只有在明确确认 ORM 无法合理表达时才允许使用原生 SQL；原生 SQL 也必须留在 persistence 层，不能绕过该层直接落在业务模块。
- 管理端 Playground 和对话流 Playground 导入相关接口，必须以通用 Provider 参数契约作为唯一输入输出标准；不要在 backend 侧新增别名、兼容层或二次转换去放宽这条约束。

## First Checks
- 队列/模拟/代理链路优先回归：
  - `./scripts/test-queue-connection.sh`
  - `./scripts/self-verification.sh`

## Current Focus
- 当前管理端后端以 run-centric 视角为准：优先看 `run-routes`、chat settings、playground、traffic replay、runtime status`
- `agent_runs` 现在已经承载 delivery state，例如 `delivery_phase`、`delivery_commit_count`、`blocked_delivery_attempt_count`；不要再把重复回复问题只当成 prompt 文案问题排查。
- 私聊和群聊设置里已有 `transcript_compact_offset`，它会直接影响 transcript compact 后保留多少尾部对话继续原样重放。
- Trace span builder 现在有两层 provider 请求证据：优先挂接 MITM / traffic log 命中的真实 provider request；如果没有命中但 `llm_call_logs` 里有 `wire_request` / `wire_response`，会合成 `provider-request:wire:<llm_call_id>` span。
- 合成 provider span 的 detail 可以再从 `CLIPROXY_REQUEST_LOG_DIR` 指向的 CLIProxyAPI 请求日志补全真实上游 request / response；日志匹配只信 `x-llm-call-id` header，敏感 header 会脱敏。

## Memory Persistence

- Xiaoni 的新长期记忆表是 `agent_memory_observations`、`agent_memory_assertions`、`agent_memory_reflections`。
- 写入入口在 `packages/persistence/agent-memory.js`，服务侧只通过 `RuntimeStore.createAgentMemoryObservation` / `createAgentMemoryAssertion` / `createAgentMemoryReflection` 调用。
- 这些表由 `context_compression_memory_writer` 在旧 turn 移出窗口时异步写入；不要在路由、临时脚本或主聊天工具里绕过 persistence 直接写表。
- 旧 `agent_feedback_reflections` / `agent_feedback_learning_states` 仍在 schema 中用于历史兼容和旧评测，但不是新三层长期记忆的主写入路径。

## Xiaoni Continuity Data Map

- `<小腻近况>` 当前仍在 `agent_session_context_windows.context_summary`，由压力触发的 prompt-facing `compress_core_memory(text)` 写入。
- `agent_session_context_windows` 同时保存 read cutoff 和 pending proactive share 兼容状态；普通群/私聊 run 用当前 `session_key`，life-only / presence-originated run 用 `xiaoni:global`。
- `agent_life_events` 是 homeostasis / presence projection 的事件真相源；当前不要把它误读成 `<小腻近况>` 或三层长期记忆的唯一 runtime recall 源。
- `listAgentLifeEventsForPrompt()` 已存在，但返回的是 life-event rows，不是 prompt-safe memory digest。把它接进主 prompt 前必须先明确 visibility / redaction / boundary policy。
- 三层长期记忆表已经写入数据，但 typed recall projection 仍是后续工作；当前主 loop 不会自动按问题类型召回这些 rows。

## Agent Runtime Contracts
- loop agent 每一轮必须保持同一份 instructions 和同一份 tools 定义；不要为了表达“这一轮做什么”逐轮改 prompt 或改 tools 列表。
- 分阶段约束用 Provider 的 `tool_choice.allowed_tools` 或业务侧状态机表达；这可以缩小当前可调用工具集合，同时不改变 tools 定义本身。
- 长期学习、RAG 召回、工具结果和本轮状态都属于 input / tool result 数据；不要动态拼进 system prompt，也不要破坏 prompt cache 前缀。
- 如果必须新增 agent workflow，先确认它是不是独立固定契约的 workflow；独立 workflow 可以有自己的固定 instructions 和固定 tools，但同一 workflow 内仍然不能逐轮改 prompt/tools。
- 主链路结束后异步发起的 LLM 流程按 subagent 对待：必须带 parent trace / subagent type，有独立 prompt cache key，有固定 contract；不要把它当普通后台 callback 随手拼 prompt。

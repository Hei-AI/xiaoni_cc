# 小腻行动流重构 · 扁平时间线 + Fork 展平

任务分支：`feat/action-stream-flatten-fork`
目标页面：`modules/admin-panel/frontend/src/pages/XiaoniActivityPage.tsx`
数据装配：`packages/persistence/xiaoni-activity.js` → `getXiaoniActionStream`

设计稿：`action-stream-redesign-mockup.html` / `.png`（v5）

## 用户要解决的三个问题

1. **看不到小腻除了工具之外的内容**（assistant 文本 / reasoning / final_answer）。
2. **看不到她为什么进了 fork agent**（fork 触发原因不可见）。
3. **首屏一眼不可读**：想在事件流里按时间点直接看到「每次模型触发新追加了什么、她输出了什么」，卡片首屏要简洁，点开看原始 LLM 请求。

## 根因（已定位到行）

- `xiaoni-activity.js:2926-2928` — `isPrimaryActionStreamItem` 把所有非工具 `llm_stack_item`（assistant_output / reasoning / final_answer）过滤掉。
- `xiaoni-activity.js:3902` — projection 模式只拉 `['runtime_input','function_call','function_call_output']`，**根本没查** `assistant_output`。
- `xiaoni-activity.js:3895` — slice 以 `summaryOnly` 加载，payload 为空 `{}` → 列表里 llm_request 显示「payload 2 B」+ token pill，无内容。
- Fork：`loadCoreMemoryCompressionForkTimeline` / `loadSubconsciousAgentForkTimeline` 把 fork 步骤打包成 `runs[].events[]`，前端 `ForkAgentRunCard` 折叠成一张卡，**与主 agent 展示不一致**，且无触发原因行。

## 设计（v5，已锁定）

- **扁平时间线**：每个时间点一行，倒序。行类型：触发事件 / 模型请求(diamond marker) / 小腻输出 / 工具。首屏单行只显示内容摘要。
- **行内展开**：点任意行就地展开，**固定高度 + 滚动条**，按需 `fetchRawTrace` 懒加载该 slice 的原始 LLM 请求/响应（`/api/xiaoni/action-stream/events/:eventId/raw-trace` 已存在）。
- **双栏**：左栏 = Fork Agent，右栏 = 主 loop，共用中间时间轴。
- **Fork 与主 agent 同构**：fork 内部 触发/模型请求/输出/工具 都展平成逐事件行（不再折叠卡）。
- **多 fork 并行**：左栏默认按时间混排；每条事件带 **fork 名称前缀**（如 `潜意识·4471` / `视觉·a13c` / `心跳·b9`，= kind + 短 run id）。
- **Fork 筛选**：顶部 chip 行，按 fork 切换显示；默认全选·混排。
- **成本观测图降级**：折叠成顶部一行额度条，事件流优先。

## 实现计划

### 后端 `packages/persistence/xiaoni-activity.js`
1. `:3902` 增加 `assistant_output` 到 projection itemKinds。
2. `:2926` 放开非工具 `llm_stack_item` 过滤（保留真正噪音的排除）。
3. Fork 投影从「嵌套 runs[].events[]」改为**扁平 feed 事件**：每个 fork slice/item/tool 一行，带 `forkRunId` / `forkKind` / `forkLabel` / `lane:'fork'`，并合成一条 fork **触发** 事件（notify id / cutoff / media / timer，数据已在 run 行上，无需迁移）。
4. 暴露 fork 名册（kind + run id + count）供筛选；接受 `fork` 查询参数（或前端按扁平列表过滤）。
5. **分页/限额**：当前 `.slice(0, limit)` 是所有源共享预算（`:4057`）。fork 行加入后需防止某一侧饿死另一侧 → 考虑按 lane 分别限额。

### 前端 `XiaoniActivityPage.tsx`
6. 单一时间排序 entry 列表，按 `lane` 分左右栏渲染；fork 行加名称前缀 chip。
7. 每行行内展开（固定高度滚动）→ 复用 `fetchRawTrace` / `RawTraceDialog` 内容。
8. URL 参数：`density`（紧凑/舒适）、`fork`（筛选）、`split`（左右栏宽度比）。
9. **左右栏可拖动分隔条**：拖动改变左右栏宽度比（存 `split` 到 URL）；栏越宽，该栏默认展示的摘要文本越长（snippet 截断长度随栏宽自适应）。

### Fork 展平放在前端（决策）
fork 数据已经由后端投影齐全：`compressionForkTimeline` / `subconsciousForkTimeline` /
`imageVisionForkTimeline` / `cacheHeartbeatTimeline` 的 `runs[].events[]` 每条都带
timestamp、`llmRequestSliceId`、`providerRequestSpanId`（可拉 raw trace），run 上带
`metadata.notifyQueueMessageId` / `readCutoffAfterConversationId` 等触发线索。
所以「fork 与主 agent 同构、逐事件展平、混排、加 fork 前缀、触发原因」**全部在前端做**：
把 `run.events` 摊平成 `lane:'fork'` 的 entry，`forkLabel = agentLabel + 短 runId`，
trigger 行由 run.metadata 派生。**后端 fork 投影暂不改**（避免无谓 churn / 分页风险），
若后续需要服务端筛选再加 `fork` 查询参数。

### 验证
- `npm --prefix modules/admin-panel/backend test`、persistence 单测（assistant_output 透出、fork 扁平 + trigger）。
- `npm --prefix modules/admin-panel/frontend run build`、turn/lane 分组单测。
- 无 schema 迁移（fork 字段已存在）；admin-backend/admin-frontend 可选 docker rebuild + `docker compose ps`。

## 约束
- worktree DB 连主工作区主栈 DB，不建私有 DB。
- 不顺手重启 `qqbot-xiaoni-executor` / `qqbot-embedding-server` 等主栈容器。

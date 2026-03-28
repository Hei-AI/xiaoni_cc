# Generation Provider Traffic Linkage

## Goal
- 把 MITM 采集到的真实 Provider 请求正式串进当前自建的 trace/span 模型。
- 让 run trace 的后端返回直接产出 `llm.generation -> provider.exchange -> provider.request...` 树，而不是只把这些请求留在流量监控页里。
- 保持 Playground 导入边界不变：MITM 原始请求只作为证据展示，不参与导入。

## Constraints
- 不接外部 SkyWalking；当前 admin trace/span 模型就是本任务的目标模型。
- 只接受 `llm_call_id` 精确命中的 AI 流量挂到 generation 下；不做时间窗或 turn 回退挂载。
- 不新增数据库表；继续使用 `http_traffic_logs` 作为真实 Provider 请求证据源。
- 所有 PostgreSQL 访问与筛选能力继续收口到 `packages/persistence`。

## Steps
- [x] 审计 provider-service 的真实 Provider 请求头传播，确认 OpenAI / Codex / Gemini CLI 请求都继续带 `x-trace-id`、`x-conversation-id`、`x-agent-turn`、`x-llm-call-id`。
- [x] 确认 MITM JSONL 与 admin-backend watcher 已完整落库上述关联字段，无需新增第二套 trace 字段。
- [x] 在 `packages/persistence` 与 `/api/traffic/logs` 增加 `llm_call_id` 精确筛选。
- [x] 在 `trace-span-builder` 中把精确命中的 AI 流量从普通 `http.request` 路径中分流，生成 `provider.exchange -> provider.request` 子树。
- [x] 为 `http_traffic_logs` 增加 `llm_call_id, request_timestamp, id` 方向的运行索引。
- [x] 增加后端单测，锁定“精确命中生成 provider 树”和“无 llm_call_id 不得挂 generation”两类行为。
- [x] 前端消费新的 span 树，在 waterfall / inspector 中展示 `provider.exchange` 与 `provider.request`。
- [x] 在前端增加从 `provider.request` 跳到流量详情页与带 `llm_call_id` 过滤列表页的入口。

## Progress Log
- 2026-03-28: 创建 execution plan，初步梳理后确认链路上已有 `trace_id / conversation_id / agent_turn / llm_call_id` 传播与 MITM 入库能力。
- 2026-03-28: 结合进一步设计决策，将方案从“generation 附件 provider_traffic”收敛为正式的树模型：`generation -> provider.exchange -> provider.request`。
- 2026-03-28: 完成后端实现：`packages/persistence` 新增 `llm_call_id` 过滤，`/api/traffic/logs` 暴露同名查询参数，`trace-span-builder` 开始为精确命中的 AI 流量产出 `provider.exchange` 与 `provider.request` spans，并避免与普通 `http.request` 重复挂载。
- 2026-03-28: 在 admin-backend `ensureOperationalIndexes` 中新增 `idx_llm_call_request_time_id`，并补充 `trace-span-builder` 单测覆盖精确命中与未命中场景。
- 2026-03-28: 验证通过：`modules/admin-panel/backend` 的 `npm test` 与 `npm run build` 通过，`modules/provider-service` 的 `npm run build` 通过；前端消费与联动入口仍待后续实现。
- 2026-03-28: 完成前端消费实现：trace waterfall 识别 `provider_exchange` / `provider_request` 语义，Generation inspector 可直接定位其 `provider.exchange` 子树，`provider.request` / `provider.exchange` 可跳转到流量详情页与带 `llm_call_id` 过滤的流量列表。
- 2026-03-28: 流量监控页新增 `llm_call_id` 精确筛选输入，并支持从 URL query 读写该筛选条件，保证 trace 到流量监控的深链可直接落到同一批真实请求。
- 2026-03-28: 前端验证通过：`modules/admin-panel/frontend` 的 `npm run build` 通过；主栈执行 `docker compose build admin-backend admin-frontend`、`docker compose up -d admin-backend admin-frontend`、`docker compose ps admin-backend admin-frontend` 后两服务均为 healthy；`curl http://127.0.0.1:9080/api/traffic/logs?llm_call_id=smoke-test-nonexistent&page=1&limit=1` 返回 200 且空列表，`curl -I http://127.0.0.1:3003/` 返回 200。
- 2026-03-28: 发现真实链路仍未闭环：新生成的 MITM 记录里只有 `x-trace-id` / `x-agent-turn`，没有 `x-llm-call-id`。根因定位到 `provider-service` 在请求发出后才生成 `llm_call_id` 并持久化，导致真实 Provider 请求永远带不上该头。
- 2026-03-28: 修复 `modules/provider-service/src/services/provider-debug-service.ts`，改为在调用 Provider 之前先生成 `llm_call_id`，并将同一个 ID 同时写入请求头、MITM 日志和 `llm_call_logs`。
- 2026-03-28: 真实闭环验证完成：通过 `/api/simple-queue/simulate/private` 触发新 run `run_1774688534784_9976ae04`，其 trace `runtrace_1774688534784_bb2af300` 产出两组 `provider.exchange -> provider.request` spans，分别关联 `traffic_log_id` `47622` / `47623` 与 `llm_call_id` `llm_1774688534798_7d0a8729` / `llm_1774688536497_f9189683`；`/api/traffic/logs?trace_id=runtrace_1774688534784_bb2af300&is_ai_request=true` 返回对应两条真实流量，`/api/traffic/logs?llm_call_id=llm_1774688534798_7d0a8729` 精确返回 `47622`。
- 2026-03-28: UI 闭环验证完成：WSL 内 Playwright 访问本地前端，确认 trace 页已默认展开 provider 子树，页面可见 `Provider Exchange` 与 `POST chatgpt.com/backend-api/codex/responses -> 200`；选中 generation 后 inspector 可见“定位真实请求”和“同 llm_call_id 流量”；流量页深链 `/traffic?llm_call_id=llm_1774688534798_7d0a8729` 会自动回填筛选框并展示对应记录。
- 2026-03-28: 为了让 provider 子树默认可见，补充前端展开策略：带 `provider_exchange` 子节点的 generation 默认展开，`provider_exchange` 自身也默认展开。

## Decision Log
- 2026-03-28: “SkyWalking” 在本任务里指当前仓库自建的 trace/span 体验，不接外部 SkyWalking OAP。
- 2026-03-28: 真实 Provider 请求必须表现为 trace 树上的正式 spans，而不是 generation 附件或纯页面侧拼装。
- 2026-03-28: provider 真实流量采用 `provider.exchange` 父节点包裹多条 `provider.request` 叶子节点的结构。
- 2026-03-28: 只有 `llm_call_id` 精确命中的 `is_ai_request=true` 流量才能挂到 generation；无精确命中的流量继续留在普通 HTTP 视图。
- 2026-03-28: MITM 原始请求只作为证据展示，不进入 Playground 导入链路。

## Verification
- 已完成：
  - `modules/admin-panel/backend`: `npm test`
  - `modules/admin-panel/backend`: `npm run build`
  - `modules/provider-service`: `npm run build`
  - `modules/admin-panel/frontend`: `npm run build`
  - `modules/provider-service`: `npm test`
  - `docker compose build admin-backend admin-frontend`
  - `docker compose up -d admin-backend admin-frontend`
  - `docker compose ps admin-backend admin-frontend`
  - `docker compose logs --tail=80 admin-backend admin-frontend`
  - `docker compose build provider-service`
  - `docker compose up -d provider-service`
  - `docker compose ps provider-service`
  - `docker compose logs --tail=40 provider-service`
  - `curl http://127.0.0.1:9080/api/traffic/logs?llm_call_id=smoke-test-nonexistent&page=1&limit=1`
  - `curl -I http://127.0.0.1:3003/`
  - `POST /api/simple-queue/simulate/private` 触发真实 agent run
  - `GET /api/runs/run_1774688534784_9976ae04`
  - `GET /api/runs/run_1774688534784_9976ae04/trace`
  - `GET /api/traffic/logs?trace_id=runtrace_1774688534784_bb2af300&is_ai_request=true`
  - `GET /api/traffic/logs?llm_call_id=llm_1774688534798_7d0a8729`
  - WSL Playwright: trace 页可见 `Provider Exchange` / `provider.request` 摘要
  - WSL Playwright: generation inspector 可见“定位真实请求”与“同 llm_call_id 流量”
  - WSL Playwright: `/traffic?llm_call_id=...` 自动回填筛选框并展示对应记录

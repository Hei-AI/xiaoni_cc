# QQ Bot

基于 OneBot 11 的 QQ 机器人主仓。

当前主仓保留运行底座和管理端：

- `provider-service`: NapCat / OneBot 入口、LLM provider 执行、消息模拟、embeddings、inbox 写入和内部 loop 触发队列入口
- `agent-service`: 主 agent loop runtime，消费内部触发队列、重建上下文、执行内部 execution lease、控制 delivery state，提供 `$qq-usage` 工程 API，并维护 life event 投影；当前没有旧式固定 presence/self-action runner，但空闲且未休息时会创建 `self_continuation` 内部 runtime slice，维持小腻连续主 loop
- `xiaoni-executor`: 小腻 `exec_command` 的独立命令执行容器，保存 session、审计日志和 git archive
- `admin-panel/backend`: 运营 API、Prompt 配置、队列管理、小腻行动流、Image Lab、流量查看/回放、runtime status
- `admin-panel/frontend`: 管理界面，默认从“小腻行动流”看她当前在做什么
- `postgres`: 数据存储
- `docker-compose.napcat.yml`: NapCat 独立部署入口

## 目录

```text
.
├── docker-compose.yml
├── docker-compose.napcat.yml
├── database/
├── docs/
├── modules/
│   ├── admin-panel/
│   ├── agent-service/
│   ├── embedding-server/
│   ├── http-traffic-monitor/
│   ├── provider-service/
│   └── xiaoni-executor/
├── packages/
├── resource/
└── scripts/
```

## 运行架构

主链：

```text
NapCat -> provider-service
                      \
                       -> agent-service
                       -> xiaoni-executor (exec_command)
                       -> provider-service -> NapCat
                       -> admin-backend -> admin-frontend
                       -> PostgreSQL (via admin / business data)
```

说明：

- NapCat 独立部署，不包含在主业务 compose 中。
- 管理端默认链路是前端 -> `admin-panel/backend`。
- `provider-service` 当前负责 provider debug、OneBot 入站和出站、`agent_inbound_messages` inbox 写入、内部 loop 触发队列、image provider、embeddings 和 timeline 记录。
- `agent-service` 负责执行 loop agent、提供 `$qq-usage` 工程 API，并把工程 run / trace / transcript / delivery state / 三层长期记忆写回 PostgreSQL。`run` 只是 trace、delivery、retry 边界，不是小腻的认知边界；`agent_queue_messages` 只是触发一次 loop 的内部工程队列，不是小腻看到的 QQ 未读列表。
- `xiaoni-executor` 负责执行小腻的 `exec_command`，默认把 `/app` 映射到 `/workspace/qq_bot`，并把 session、审计日志和 git archive 写入 `/home/liahua/.qqbot-local/xiaoni-runtime`。
- 小腻主 prompt 只有一套，维护在 `modules/agent-service/src/prompts/xiaoni-main-agent.ts`；群/私聊不再绑定不同 prompt，DB prompt 表不再是小腻运行时来源。
- 小腻看 QQ 未读时走 `$qq-usage`：模型通过 `exec_command` 调用 `modules/agent-service/skills/qq-usage` 脚本，脚本请求 `agent-service /api/internal/qq-usage`，底层读取 `agent_inbound_messages` 的 thread list / conversation window。当前 `open_inbox` 最多展示 10 个 thread，`focus_thread` / `scroll_thread` 每次最多展示 10 条消息。清角标通过 `put_qq_away` 写回 inbox read state。
- 小腻主循环是同一个连续 LLM runtime stream：QQ 输入进入 queue 时只作为 `phone_notification` 感官事件；模型 response、tool result、状态与记忆通过 `responses_replay_items` / `conversation_items` 追加进下一轮 request。空闲且未处于 `recover_energy` 休息窗口时，`agent-service` 会创建 `self_continuation` 内部 runtime slice；它不是旧 `consciousness_tick` 敲钟，也不会自动打开 QQ。QQ 正文不会因为 queue 被自动打开；模型只能先看到手机状态栏通知摘要，需要内容时自己用 `$qq-usage` 打开 QQ。主 loop 的 prompt-facing history、context summary、read cutoff 和 prompt cache key 统一是 `xiaoni:global`；群/私聊 session 只表示来源、投递目标和 QQ app 未读游标元数据，不形成任何 QQ 维度 prompt history/cache key。
- provider 侧的 participation 现在保留为硬安全边界和观测事件，主行为判断逐步迁移到 `agent-service` runtime。
- 当前主发言判断在 `agent-service`；topic projection、transcript snapshot、三层长期记忆等后台能力可以用于观测、后续 typed recall projection、评测或异步产物，但不要把它们当成入口层“是否说话”的总决策器。
- 新 prompt-facing 私密备注标签是 `<xiaoni_os>`。当前对话历史里的旧 `<小腻的OS>` 按历史真相保留，不做 DB 迁移，并随已读历史一起参与上下文窗口管理。`<小腻近况>` 当前由 `compress_core_memory(text)` 写入 `agent_session_context_windows.context_summary`；三层 compact memory 已生成但还没有作为 runtime typed recall projection 自动进入主 prompt。
- HTTP 流量监控/回放属于管理端运维工具链。

## 快速开始

### 1. 创建网络

```bash
docker network create qq_bot_network
```

### 2. 启动 NapCat

```bash
mkdir -p resource/napcat_config resource/napcat_qq_data logs/napcat
docker compose -f docker-compose.napcat.yml up -d
```

### 3. 启动主栈

```bash
docker compose build
docker compose up -d
docker compose ps
```

默认服务：

- Admin Frontend: `http://localhost:3003`
- Admin Backend: `http://localhost:9080/api/health`
- Provider Service: `http://localhost:8091/health`
- Agent Service: `http://localhost:8092/health`
- Xiaoni Executor: `localhost:8093` + `/health`

## 调试能力

保留的调试面：

- Admin 小腻行动流：真实 trace 里的 provider/tool、模型请求切片、发言、看群、历史后台行动、任务、图片观察和 runtime busy flags
- `provider-service` 健康检查、消息模拟、LLM 调试、简单队列接口、embeddings
- Admin 小腻行动流 event trace、runtime status、task/media 观测；Raw Trace 通过 `/api/xiaoni/action-stream/events/:eventId/trace` 读取，回放源统一是 `xiaoni_replay_events`
- Admin Queue Management
- Prompt 管理 / 编辑 / 调试仍可用于 Playground 和历史调试；小腻主 prompt 不再从 DB 读取。
- Playground case library、Raw Trace / Conversation 导入、Provider 请求 payload 查看
- QQ 未读导航排障时，看 `agent_inbound_messages`、`$qq-usage` 输出和 `agent-service /api/internal/qq-usage`；不要把 `agent_queue_messages` 当成小腻 QQ app 未读列表。小腻 loop 排障时，看 `phone_notification` queue 项、raw trace 的 `runtime_stream`、`responses_replay_items`、`agent_life_events`、`conversation_items`、`agent_session_context_windows` 和 Traffic 里的 `llm_call_id`。
- Trace 里的 provider 请求骨架统一来自 `xiaoni_replay_events.wire_request/wire_response`；traffic / MITM / CLIProxyAPI 日志只补证据和 detail，不再决定 action replay 是否存在。`llm_call_logs` 只做审计，不做 action replay source。
- Image Lab 生成 / 编辑 / prompt assistant
- Codex local provider 使用 `/root/.qqbot-local/codex-auth-profiles/auth-profiles.json` 作为运行态 OAuth profile store；只在 profile 缺失时从只读 `/root/.codex/auth.json` bootstrap，刷新只写 auth-profiles，不改写 auth.json
- Traffic 只记录 Codex 限额信号，不做账号切换，也不改写 auth.json
- HTTP 流量查看与回放

## 常用命令

```bash
docker compose logs -f qqbot-provider-service
docker compose logs -f qqbot-agent-service
docker compose logs -f qqbot-xiaoni-executor
docker compose logs -f qqbot-admin-backend
docker exec -it qqbot-provider-service /bin/sh
python3 scripts/start_modules.py start
python3 scripts/start_modules.py status
```

## 部署约定

这里有两条不同链路，必须区分：

- 本地开发链路：`npm run deploy:local`
  - 只用于本地前端联调，不会更新或中断公网管理端
  - 具体端口、访问地址和本机规则以 `docs/AGENTS_FRONTEND.md`、`docs/AGENTS_SECRETS_LOCAL_STATE.md` 为准

- 公网管理端链路：`npm run deploy`
  - 用于公网管理端 `qqbot-admin.liahuas.top`
  - 具体部署、认证和 debug token 规则以 `docs/AGENTS_SECRETS_LOCAL_STATE.md` 为准

## 本地文件约定

- `scripts/module_pids.json` 是本地 `start_modules.py` 写出的 PID 状态，不提交。
- NapCat 登录二维码和各类截图文件属于登录/排障产物，不提交。
- 临时探针、compact memory 导出和 smoke 产物放在 `tmp/`，不提交。

## 文档

- [docs/START_HERE.md](docs/START_HERE.md)
- [docs/INDEX.md](docs/INDEX.md)
- [docs/XIAONI_NOTIFY_RUNTIME_ARCHITECTURE.md](docs/XIAONI_NOTIFY_RUNTIME_ARCHITECTURE.md)
- [docs/XIAONI_REPLAY_LEDGER.md](docs/XIAONI_REPLAY_LEDGER.md)
- [docs/AGENTS_XIAONI_EXECUTOR.md](docs/AGENTS_XIAONI_EXECUTOR.md)
- [docs/ROADMAP.md](docs/ROADMAP.md)

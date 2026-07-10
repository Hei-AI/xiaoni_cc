# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install all modules
npm run install:all

# Build / test / lint all modules
npm run build
npm run test
npm run lint

# Single module
npm --prefix modules/provider-service test
npm --prefix modules/xiaoni-executor test
npm --prefix modules/agent-service test
npm --prefix modules/admin-panel/backend test
npm --prefix modules/admin-panel/frontend run build

# Local process management (non-Docker dev)
python3 scripts/start_modules.py start
python3 scripts/start_modules.py status
python3 scripts/start_modules.py stop

# Docker (primary runtime) — use the service name from the table below
docker compose build <service>
docker compose up -d <service>
docker compose ps
docker compose logs -f <container>

# Deploy
npm run deploy          # 公网管理端 qqbot-admin.liahuas.top
npm run deploy:local    # 本地前端联调（只启本地 Vite，不动 Docker 容器）
```

### Docker service reference

| `docker compose` service | Container name | Source module |
|---|---|---|
| `provider-service` | `qqbot-provider-service` | `modules/provider-service` |
| `xiaoni-executor` | `qqbot-xiaoni-executor` | `modules/xiaoni-executor` |
| `agent-service` | `qqbot-agent-service` | `modules/agent-service` |
| `admin-backend` | `qqbot-admin-backend` | `modules/admin-panel/backend` |
| `admin-frontend` | `qqbot-admin-frontend` | `modules/admin-panel/frontend` |
| `embedding-server` | `qqbot-embedding-server` | `modules/embedding-server` |
| `postgres` | `qqbot-postgres` | managed image, no source |

Use the **service** name with `docker compose build/up/logs`. Use the **container** name with `docker logs`, `docker exec`, health checks.

### Before shipping

Run these in order. All must pass before creating a PR.

```bash
# 1. Module-level tests (free, <30s per module)
npm --prefix modules/agent-service test
npm --prefix modules/xiaoni-executor test
npm --prefix modules/admin-panel/backend test

# 2. If docker-compose.yml services changed
docker compose build <service>
docker compose up -d <service>
docker compose ps          # verify status = Up (healthy)
docker compose logs -f <container>   # watch for startup errors
```

## Architecture

主链：`NapCat -> provider-service -> agent-service -> provider-service -> NapCat`；`exec_command` 支路走 `agent-service -> xiaoni-executor`
管理端链：`admin-frontend -> admin-backend`

```
modules/provider-service      OneBot/NapCat 入站、LLM provider 执行、消息模拟、embeddings、Notify Bucket ingress
modules/agent-service         主 agent loop runtime，消费 Notify Bucket、执行工具 loop、路由 response action、写 run/trace/delivery state 和 life event 投影
modules/xiaoni-executor       小腻 exec_command 的独立命令执行容器，保存 session、审计日志和 git archive
modules/admin-panel/backend   运营 API，承接 runs、conversations、queue、playground、image lab、traffic replay、runtime status
modules/admin-panel/frontend  React + Vite 管理端 UI，只走 admin-backend，不直连 provider-service
modules/embedding-server      内部 embedding 服务，对外由 provider-service /v1/* 暴露，不直接对外
modules/http-traffic-monitor  HTTP 流量查看与回放工具链
packages/persistence          共享 PostgreSQL 持久化层，Prisma schema + Client 是唯一标准入口
```

NapCat 独立部署，入口是 `docker-compose.napcat.yml`，不在主 `docker-compose.yml` 里。

### Runtime Truth（事实链路，来自 `AGENTS.md`）

- QQ 入站事实链路：`NapCat -> provider-service -> agent_inbound_messages`；小腻用 `$qq-usage` 看未读时读的是 `agent_inbound_messages` 的 inbox/window，**不是** `agent_queue_messages`。
- `agent_queue_messages` 是 Notify Bucket 的持久化门铃，不是小腻的 QQ app 未读列表、认知边界或长期运行凭证。
- 底层事实源是追加式 Xiaoni agent stack：`agent_stack_items`（连续可回放上下文）、`llm_request_slices`（真实 LLM 请求 + provider wire payload，由 provider-service / provider 写入）、`tool_executions`（工具执行）；agent-service 只组装 canonical request 并回填 slice 的 stack index。细节看 `docs/XIAONI_AGENT_STACK_LEDGER.md`。
- 聊天对象 IM 入口 `is_enabled=0` 是 provider-service 侧硬开关：仍写 QQ inbox，但不写 `phone_notification` 到 Notify Bucket，因此不唤醒主 loop；`auto_reply_enabled` 只是兼容/派生字段。
- 出站：`agent-service -> provider-service -> NapCat`；`exec_command` 走 `agent-service -> xiaoni-executor`；管理端 `admin-frontend -> admin-backend -> provider-service / agent-service / PostgreSQL`。

### Where To Debug（先定位层，再进文档）

- 页面/交互/浏览器请求失败 → `modules/admin-panel/frontend`（`docs/AGENTS_FRONTEND.md`）。
- API 500 / 数据不一致 / 队列 / Prompt / 会话 → `modules/admin-panel/backend`，涉及共享表再看 `packages/persistence`（`docs/AGENTS_BACKEND_DATA.md`）。
- provider debug / NapCat 收发 / embeddings / image provider / inbound queue 写入 / timeline → `modules/provider-service`。
- agent run / 行为判断 / delivery state / self continuation / life event 投影 / 后台任务 → `modules/agent-service`。
- `exec_command` / session / 命令审计 / git archive → `modules/xiaoni-executor`（`docs/AGENTS_XIAONI_EXECUTOR.md`）。
- 部署 / 认证 / token / 本机访问 → `docs/AGENTS_SECRETS_LOCAL_STATE.md`。
- 默认只修真实生效的层，不要围绕错误契约堆适配层。

## Team Collaboration（worktree 协作铁律，来自 `AGENTS.md`）

- 改代码前先确认当前目录是本任务专用的 git worktree；用 `git status --short --branch` + `git worktree list` 确认位置，不要在共享主工作区直接改。任务 worktree 完成后默认走 PR / merge / cherry-pick 合回；废弃/实验 worktree 要标记，避免误整分支合入。
- **在 worktree 中工作时，数据库必须连主工作区主栈 DB**。不要让 compose volume、`DATABASE_URL`、本地脚本或测试容器隐式创建/连接 worktree 私有 DB；涉及 DB 的启动、重建、迁移、dump、restore 前先确认 Postgres 挂载和连接目标指向 `/home/liahua/IdeaProject/qq_bot` 主工作区。
- 重启/构建/部署 compose 托管服务前，先确认没有其他同事正在操作同一服务（看协同记录 + `docker compose ps`）；只操作当前任务需要的目标服务，不要顺手重启整套主栈。
- `qqbot-xiaoni-executor` 和 `qqbot-embedding-server` 是主栈运行容器，不是 worktree 测试容器；清理 worktree 或修 compose label 时禁止顺手重启/重建/替换它们，除非任务明确涉及或用户明确要求。

## Key Constraints

**依赖管理**：新增依赖只加到对应模块的 `package.json`，不要加到根目录。
**Why:** 根目录无 `workspaces` 配置，`npm install` 不会传播到子模块；在根目录加依赖要么静默失败，要么污染根目录 `node_modules`，但不会进入任何服务的实际依赖树。

---

**持久化**：所有 PostgreSQL 读写必须收口到 `packages/persistence`（Prisma Client）。禁止在路由、页面服务或临时脚本里写查询/事务。原生 SQL 只有在 ORM 无法合理表达时才允许，且必须也封装在 `packages/persistence` 内。
**Why:** Prisma schema 是唯一的类型来源；绕过它写原生 SQL 会在 schema 变更时无提示丢失类型保护，且无法参与迁移追踪，导致生产与 schema 状态静默偏移。

```ts
// BAD — 路由里直接查询
const rows = await prisma.$queryRaw`SELECT * FROM "Run" WHERE id = ${id}`;

// GOOD — 封装在 packages/persistence，路由只调用封装函数
import { getRunById } from '@qqbot/persistence';
const run = await getRunById(id);
```

---

**Playground 参数契约**：管理端 Playground 和对话流 Playground 导入，必须严格对齐通用 Provider 参数契约；禁止在前端或后端另造参数别名、兼容层或二次转换。
**Why:** provider-service 的参数契约是单一真理源；另造别名会在调试时产生「前端传了 X，后端收到 Y」的隐性错误，且无编译期检查。

---

**Agent loop 契约**：同一 loop workflow 内必须保持同一份 instructions 和同一份 tools 定义；分阶段约束用 `tool_choice.allowed_tools` 表达，不能按步骤改 prompt 或 tools 列表。RAG 召回、工具结果、当前状态属于 input/tool result 数据，不要动态拼进 system prompt。
**Why:** Anthropic prompt cache 要求 system prompt 前缀在整个 session 内字节级不变；动态拼接会让 cache miss 率趋近 100%，直接导致延迟和成本双双恶化。

```ts
// BAD — 把 RAG 拼进 system prompt，破坏 cache 前缀
{ role: 'system', content: `${baseInstructions}\n\n## 相关记忆\n${ragContext}` }

// GOOD — RAG 结果作为 user 消息传入，system prompt 保持不变
messages: [
  { role: 'system', content: baseInstructions },   // 字节级不变 → cache hit
  ...history,
  { role: 'user', content: `[记忆召回]\n${ragContext}\n\n${userMessage}` },
]
```

---

**双缓存影响分析（主 agent 改动铁律）**：主 agent(`modules/agent-service`)上的**每一处**改动,提交前必须显式分析并在 commit/PR 写明对**两个缓存**的影响：① **fork agent 缓存**——潜意识/压缩/图像/心跳 fork 都是主 agent 请求的克隆,主请求体一变,fork 前缀同步变；② **下一次主 agent run 缓存**——下一个 run 靠 stack replay 重建历史,**凡进了 live 请求的内容必须能被 replay 逐字节重建**,否则在 run 边界击穿。
**Why:** cacheable 前缀只要有一字节漂移(按 turn/run/时间变化的戳,或 live 请求与 stack replay 不一致),整段 message-tier 前缀失效、`cache_read` 塌到裸 system+tools。改动后必须用相邻两 slice 的 `wire_request` 实测 `cache_read_input_tokens` 验证,不能只靠推断。典型事故:折叠 notify 落库 event_id 碰撞导致 replay 变短(见 `docs/investigations/`)。

---

**缓存用例不可变 + 失败禁止部署(铁律)**：以下缓存回归用例**禁止为了通过而直接修改/弱化断言**(只能新增,或在改动行为时由 user 显式批准);**任何一个执行失败 = 禁止部署 agent-service**:
- `modules/agent-service/src/__tests__/cache-replay-consistency.test.ts`(主 run 边界 replay、主 loop turn 间前缀单调、时钟漂移、压缩 fork dispatch、**REQ2 STW 一次冷读**、真库 replay)
- `modules/agent-service/src/__tests__/fork-cache-alignment.test.ts`(四个 fork 克隆前缀逐字节一致)
- `packages/persistence/__tests__/agent-stack-event-id-dedup{,.realdb}.test.js`(ON CONFLICT/COALESCE 机制,含真 PG)

**Why:** 这些用例是缓存 0 容忍的可执行契约,每条都验过「改坏即红」。改了主 agent / fork / 持久化后,这些必须先全绿(真库用例需 `qqbot_cache_test` 可达)才允许 `docker compose build/up agent-service`。**压缩切换专项:只允许主 agent 在 STW 切换那一帧冷读一次,同时/之后的 fork 与后续主 turn 一律不许穿透。**

---

**Done Means**：改了 `docker-compose.yml` 托管的服务，完成判定必须包括：对应模块构建或测试 → `docker compose build <service>` → `docker compose up -d <service>` → `docker compose ps` → 日志/健康检查确认正常。
**NEVER** 对主栈执行 `docker compose up -d --remove-orphans`，会误停不该动的容器。

## Local Access

- 公网管理端：`https://qqbot-admin.liahuas.top/`（Basic Auth 用户名 `debug-token`，密码取 `/home/liahua/.qqbot-local/admin-debug-auth/qqbot-admin-debug.token`）
- 本地联调前端：固定端口 `13003`（不是 `3003`），真实宿主机地址以 `/home/liahua/.qqbot-local/playwright/local-frontend-access.json` 中 `frontend_host_browser_url` 为准
- 本地前端 `/api` 代理到容器内 admin-backend：`http://127.0.0.1:9080`
- 敏感信息统一从 `/home/liahua/.qqbot-local/` 读取；`.env.docker.example` 只是模板
- **sudo / 宿主机权限**：遇到 `sudo` 或 Docker socket 权限问题时，凭据从本机文件 `/home/liahua/token` 读取（格式 `账号:密码`，不在此处或任何版本库文件中写明文）。非交互 shell 用 `PW=$(cut -d: -f2 /home/liahua/token); echo "$PW" | sudo -S <命令>` 传入。

## Git

- Commit 前缀用 `feat:`、`fix:`、`chore:` 等
- 推送 GitHub 优先 SSH，不要依赖 HTTPS 登录态
- PR 需写清 schema / 配置 / 部署影响，并附实际验证结果

**Bisect commits.** Every commit should be a single logical change — independently understandable and revertable. When you've made multiple changes, split before pushing.

Examples of good bisection:
- Schema migration separate from application code that uses it
- `packages/persistence` changes separate from the service that consumes them
- Docker / config changes separate from feature code
- Mechanical refactors separate from behavior changes

## gstack

For all web browsing, use the `$browse` skill from gstack. **NEVER use `mcp__claude-in-chrome__*` tools.**

Available skills:

| Skill | Purpose |
|---|---|
| `$office-hours` | Product ideas / startup diagnostic |
| `$plan-ceo-review` | Strategy and scope review |
| `$plan-eng-review` | Architecture review |
| `$plan-design-review` | Design audit (report only) |
| `$design-consultation` | Design system from scratch |
| `$design-shotgun` | Visual design exploration |
| `$design-html` | Design to HTML |
| `$review` | PR / code review |
| `$ship` | Ship workflow |
| `$land-and-deploy` | Merge -> deploy -> canary verify |
| `$canary` | Post-deploy monitoring loop |
| `$benchmark` | Performance regression detection |
| `$browse` | Headless browser (use for ALL web tasks) |
| `$connect-chrome` | Connect to local Chrome |
| `$qa` | QA with fixes |
| `$qa-only` | QA report only, no fixes |
| `$design-review` | Design audit + fix loop |
| `$setup-browser-cookies` | Cookie setup for browser skills |
| `$setup-deploy` | One-time deploy config |
| `$setup-gbrain` | Persistent knowledge base setup |
| `$retro` | Retrospective |
| `$investigate` | Systematic root-cause debugging |
| `$document-release` | Post-ship doc updates |
| `$document-generate` | Generate missing feature/module docs |
| `$codex` | Multi-AI second opinion via OpenAI Codex |
| `$cso` | OWASP Top 10 + STRIDE security audit |
| `$autoplan` | Auto-review pipeline (CEO -> design -> eng) |
| `$plan-devex-review` | Dev experience review |
| `$devex-review` | Dev experience audit + fix loop |
| `$careful` | Extra-careful mode for risky changes |
| `$freeze` | Freeze files from edits |
| `$guard` | Guard against accidental changes |
| `$unfreeze` | Unfreeze files |
| `$gstack-upgrade` | Upgrade gstack |
| `$learn` | Learn a topic |

## Docs Map

先看 `docs/INDEX.md` 再按任务打开最少的专项文档：

| 任务类型 | 文档 |
|---|---|
| 前端页面 / 交互 / 生产前端 | `docs/AGENTS_FRONTEND.md` |
| 后端接口 / 队列 / 数据库 | `docs/AGENTS_BACKEND_DATA.md` |
| 配置 / 部署 / 认证 / 密钥 | `docs/AGENTS_SECRETS_LOCAL_STATE.md` |
| 小腻主 loop / Notify Bucket / QQ inbox / Raw Trace / action stack | `docs/XIAONI_AGENT_STACK_LEDGER.md` |
| 小腻运行面 / Admin surface / local skills / usage observatory | `docs/XIAONI_RUNTIME_SURFACES.md` |
| 小腻被动召回 extractor / shadow review / cue 分类 | `docs/XIAONI_PASSIVE_RECALL_EXTRACTOR.md` |
| Xiaoni runtime 操作 / Raw Trace / recovery / browser / site / image send | `docs/XIAONI_OPERATOR_HOWTO.md` |
| 小腻主 prompt / runtime reminder 模板 | `docs/XIAONI_MAIN_PROMPT_NEXT.md`、`docs/remind.md` |
| Xiaoni exec_command / session / git archive | `docs/AGENTS_XIAONI_EXECUTOR.md` |
| embeddings | `docs/AGENTS_EMBEDDINGS.md` |
| git / PR | `docs/AGENTS_GIT_PR.md` |
| 路线图 | `docs/ROADMAP.md` |

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming -> invoke `$office-hours`
- Strategy/scope -> invoke `$plan-ceo-review`
- Architecture -> invoke `$plan-eng-review`
- Design system/plan review -> invoke `$design-consultation` or `$plan-design-review`
- Full review pipeline -> invoke `$autoplan`
- Bugs/errors -> invoke `$investigate`
- QA/testing site behavior -> invoke `$qa` or `$qa-only`
- Code review/diff check -> invoke `$review`
- Visual polish -> invoke `$design-review`
- Ship/deploy/PR -> invoke `$ship` or `$land-and-deploy`
- Save progress -> invoke `$context-save`
- Resume context -> invoke `$context-restore`

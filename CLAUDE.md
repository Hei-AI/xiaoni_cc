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
npm --prefix modules/admin-panel/backend test

# 2. If docker-compose.yml services changed
docker compose build <service>
docker compose up -d <service>
docker compose ps          # verify status = Up (healthy)
docker compose logs -f <container>   # watch for startup errors
```

## Architecture

主链：`NapCat -> provider-service -> agent-service -> provider-service -> NapCat`
管理端链：`admin-frontend -> admin-backend`

```
modules/provider-service      OneBot/NapCat 入站、LLM provider 执行、消息模拟、embeddings、queue 写入
modules/agent-service         主 agent loop runtime，消费 queue batch、执行 single-turn life action 决策、写 run/trace/delivery state，并运行 presence 后台循环和 life event 投影
modules/admin-panel/backend   运营 API，承接 runs、conversations、queue、playground、image lab、codex pool、traffic replay、runtime status
modules/admin-panel/frontend  React + Vite 管理端 UI，只走 admin-backend，不直连 provider-service
modules/embedding-server      内部 embedding 服务，对外由 provider-service /v1/* 暴露，不直接对外
modules/http-traffic-monitor  HTTP 流量查看与回放工具链
packages/persistence          共享 PostgreSQL 持久化层，Prisma schema + Client 是唯一标准入口
```

NapCat 独立部署，入口是 `docker-compose.napcat.yml`，不在主 `docker-compose.yml` 里。

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

**Agent loop 契约**：同一 loop workflow 内，每一轮必须保持同一份 instructions 和同一份 tools 定义；分阶段约束用 `tool_choice.allowed_tools` 表达，不能逐轮改 prompt 或 tools 列表。RAG 召回、工具结果、本轮状态属于 input/tool result 数据，不要动态拼进 system prompt。
**Why:** Anthropic prompt cache 要求 system prompt 前缀在整个 session 内字节级不变；每轮动态拼接会让 cache miss 率趋近 100%，直接导致延迟和成本双双恶化。

```ts
// BAD — 每轮把 RAG 拼进 system prompt，破坏 cache 前缀
{ role: 'system', content: `${baseInstructions}\n\n## 相关记忆\n${ragContext}` }

// GOOD — RAG 结果作为 user 消息传入，system prompt 保持不变
messages: [
  { role: 'system', content: baseInstructions },   // 字节级不变 → cache hit
  ...history,
  { role: 'user', content: `[记忆召回]\n${ragContext}\n\n${userMessage}` },
]
```

---

**Done Means**：改了 `docker-compose.yml` 托管的服务，完成判定必须包括：对应模块构建或测试 → `docker compose build <service>` → `docker compose up -d <service>` → `docker compose ps` → 日志/健康检查确认正常。
**NEVER** 对主栈执行 `docker compose up -d --remove-orphans`，会误停不该动的容器。

## Local Access

- 公网管理端：`https://qqbot-admin.liahuas.top/`（Basic Auth 用户名 `debug-token`，密码取 `/home/liahua/.qqbot-local/admin-debug-auth/qqbot-admin-debug.token`）
- 本地联调前端：固定端口 `13003`（不是 `3003`），真实宿主机地址以 `/home/liahua/.qqbot-local/playwright/local-frontend-access.json` 中 `frontend_host_browser_url` 为准
- 本地前端 `/api` 代理到容器内 admin-backend：`http://127.0.0.1:9080`
- 敏感信息统一从 `/home/liahua/.qqbot-local/` 读取；`.env.docker.example` 只是模板

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
| agent loop 输入输出 / 工具契约 / 抑制路径 | `docs/AGENTS_AGENT_LOOP_RUNTIME.md` |
| 小腻数字生活 / homeostasis reducer | `docs/P0A_DIGITAL_LIFE_PRESENCE_CONTEXT.md`、`docs/P0A_XIAONI_HOMEOSTASIS_LOOP.md` |
| embeddings | `docs/AGENTS_EMBEDDINGS.md` |
| git / PR | `docs/AGENTS_GIT_PR.md` |
| 业务架构总览 | `docs/CURRENT_ARCHITECTURE.md` |

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

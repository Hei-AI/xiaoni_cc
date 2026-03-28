# Repository Guidelines

本文件是仓库入口，不是百科全书。
参考 OpenAI Codex best practices 与 Harness Engineering 思路：`AGENTS.md` 保持短、准、可执行，只保留高信号地图和仓库级约束；细节沉到 `docs/` 中的专项文档，仓库内文档是 system of record。

## Start Here
- 第一次接触仓库，先读：`docs/START_HERE.md` -> `README.md` -> `docs/INDEX.md`
- 目标是在 30 到 60 分钟内搞清楚：项目现在真正运行什么、活跃模块在哪、出问题先查哪一层、前端生产和本地分别怎么调、密钥去哪找。

## Runtime Truth
- 当前真实主链路：`NapCat -> provider-service -> admin-panel/backend -> admin-panel/frontend`
- 主运行栈以 `docker-compose.yml` 为准；`docker-compose.napcat.yml` 只负责 NapCat。
- 新工作优先基于这些活跃模块：`modules/provider-service`、`modules/admin-panel/backend`、`modules/admin-panel/frontend`、`packages/persistence`
- 这些会影响运行和排障，但不是新人理解系统的第一入口：`modules/agent-service`、`modules/embedding-server`、`modules/http-traffic-monitor`
- 已经移除的旧服务、旧接口和旧页面不要再作为当前契约参考；排障与开发都只围绕上面的活跃模块展开

## Project Map
- `modules/provider-service`：NapCat 发送、provider debug、消息模拟、simple queue、embeddings
- `modules/admin-panel/backend`：管理端 API，承接 conversations、queue、prompt、playground、traffic replay、runtime status
- `modules/admin-panel/frontend`：React + Vite 管理端 UI，默认走 `admin-panel/backend`
- `modules/agent-service`：后台 agent loop / worker
- `packages/persistence`：共享 PostgreSQL 持久化层；所有共享表和业务持久化读写都必须收口到这里
- `docs/`：仓库知识库；`scripts/`：启动、部署、验证、排障脚本；`database/postgres/`：PostgreSQL 初始化脚本

## Where To Debug
- 页面展示错、交互异常、浏览器请求失败：先分清生产前端还是本地联调，再看 `modules/admin-panel/frontend`；对应 `docs/AGENTS_FRONTEND.md`
- API 500、数据不一致、队列/Prompt/会话问题：先看 `modules/admin-panel/backend`；涉及共享表和持久化再看 `packages/persistence`；对应 `docs/AGENTS_BACKEND_DATA.md`
- provider debug、NapCat 发消息、embeddings、simple queue 问题：先看 `modules/provider-service`，不要先在前端或历史模块绕圈
- agent run、后台任务执行问题：看 `modules/agent-service`
- 部署、认证、token、本机访问问题：先看 `docs/AGENTS_SECRETS_LOCAL_STATE.md`，再看 `scripts/deploy-admin-public.sh`、`scripts/start_modules.py`
- 默认规则：只修真实生效的层，不要围绕错误契约继续堆适配层

## Frontend And Local State
- 前端生产/本地联调规则统一看 `docs/AGENTS_FRONTEND.md`
- 部署链路、debug token、本机状态文件统一看 `docs/AGENTS_SECRETS_LOCAL_STATE.md`
- 真实密钥、token、调试认证信息统一从 `/home/liahua/.qqbot-local/` 读取；`.env.docker.example` 只是模板，不能回填真实 secret

## Development Rules
- 根目录不是 npm workspace；新增依赖只加到对应模块
- 所有 PostgreSQL 持久化读写必须统一收口到 `packages/persistence`；禁止把查询、写入、事务逻辑散落在模块内路由、页面服务或临时脚本里
- 持久层默认且必须使用 ORM；当前仓库以 `packages/persistence` 中的 Prisma schema 和 Prisma Client 作为唯一标准入口
- 未经明确评审确认 ORM 无法合理表达前，禁止新增原生 SQL；即使必须使用原生 SQL，也只能封装在 `packages/persistence` 内，不能绕过持久层下沉到业务模块
- 管理端页面中的 Playground，以及对话流中的 Playground 导入，必须严格与我们提供的通用 Provider 参数契约保持一致；禁止自行扩展、重命名、省略或映射出另一套参数语义。这是管理面这两块业务的红线
- 仓库文档是可追溯真相源；聊天、口头说明、临时记录都不算交付
- 复杂任务不要只靠聊天上下文推进；参考 OpenAI《Harness engineering: leveraging Codex in an agent-first world》的做法，长任务需要显式 planning artifact，而不是只靠会话记忆
- 跨模块、多阶段、持续数天、需要交接、需要记录决策/验证/回滚点的工作，必须在 `docs/exec-plans/active/` 新建 execution plan
- 执行计划格式、目录约定和维护规则以 `docs/exec-plans/README.md` 为准
- 复杂 execution plan 需要持续维护 `Progress Log` 和 `Decision Log`，不能只写初稿不更新
- execution plan 的状态维护属于 done 的一部分；具体生命周期与归档规则统一以 `docs/exec-plans/README.md` 为准
- 计划完成后移到 `docs/exec-plans/completed/`；不要把失效或已完成计划继续留在 `active/`
- 当任务涉及 `AGENTS.md`、`docs/` 知识库结构、execution plans、文档去重/裁剪、system-of-record、渐进披露、长任务协作规则时，优先使用 `$harness-engineering`

## Default Commands
- 安装：`npm run install:all`
- 构建：`npm run build`
- 测试：`npm run test`
- 本地启动 / 状态：`python3 scripts/start_modules.py start`、`python3 scripts/start_modules.py status`
- 生产前端部署 / 本地联调重启：`npm run deploy`、`npm run deploy:local`

## Done Means
- 如果改了 `docker-compose.yml` 托管的服务，完成不止是改代码
- 至少要做：对应模块构建或测试、`docker compose build <service>`、`docker compose up -d <service>`、`docker compose ps`、相关日志或健康检查确认正常
- 不要对主栈执行 `docker compose up -d --remove-orphans`，除非明确要清理同项目下其他容器

## Open Extra Docs Only When Needed
- 先看 `docs/INDEX.md`，再按任务进入最少的相关文档
- 常用下一跳：`docs/AGENTS_FRONTEND.md`、`docs/AGENTS_BACKEND_DATA.md`、`docs/AGENTS_SECRETS_LOCAL_STATE.md`、`docs/AGENTS_EMBEDDINGS.md`、`docs/AGENTS_GIT_PR.md`
- 做跨模块、多阶段或需要交接的任务时，额外打开 `docs/exec-plans/README.md`
- 做仓库协作规范、文档治理或 execution plan 维护时，额外使用 `$harness-engineering`

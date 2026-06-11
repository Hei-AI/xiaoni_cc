# Repository Guidelines

本文件是仓库入口，不是百科全书。
参考 OpenAI Codex best practices 与当前 gstack 文档协作约定：`AGENTS.md` 保持短、准、可执行，只保留高信号地图和仓库级约束；细节沉到 `docs/` 中的专项文档，仓库内文档是 system of record。
- Codex skill 名统一写成 `$skill-name` 格式；不要在仓库文档里混用 `/skill-name` 或其他写法。

## Start Here
- 第一次接触仓库，先读：`docs/START_HERE.md` -> `README.md` -> `docs/INDEX.md`
- 目标是在 30 到 60 分钟内搞清楚：项目现在真正运行什么、活跃模块在哪、出问题先查哪一层、前端生产和本地分别怎么调、密钥去哪找。
- 只打开完成当前任务必需的下一跳文档；不要把 `AGENTS.md` 当成总手册

## Runtime Truth
- 当前 QQ 入站事实链路：`NapCat -> provider-service -> agent_inbound_messages`；小腻用 `$qq-usage` 看 QQ 未读时，读的是 `agent_inbound_messages` 的 inbox/window，不是 `agent_queue_messages`
- 当前 agent loop 宿主仍是 `agent-service`；`agent_queue_messages` 是 Notify Bucket 的持久化门铃，承载 `phone_notification`、`self_continuation`、`image_task_completed`、`system_reminder` 等触发。被主 loop pick 后即视为 consumed，不是小腻的 QQ app 未读列表、认知边界或长期运行凭证
- 当前底层重构的事实源是追加式 Xiaoni agent stack：目标 `agent_stack_items` 记录连续可回放上下文，`llm_request_slices` 记录真实 LLM 请求和 provider wire payload，`tool_executions` 记录工具执行；行动流是这些事实的投影。旧 `llm_call_logs`、`tool_execution_logs`、provider replay ledger 已移除并由 schema ensure drop。细节看 `docs/XIAONI_AGENT_STACK_LEDGER.md`
- 聊天对象的 `auto_reply_enabled=0` 是 provider-service 侧硬开关：仍写入 QQ inbox，但不写 `phone_notification` 到 Notify Bucket，因此不会唤醒主 loop 发言
- QQ 发言出站链路：`agent-service -> provider-service -> NapCat`
- `exec_command` 支路走 `agent-service -> xiaoni-executor`
- 当前管理端链路：`admin-panel/frontend -> admin-panel/backend -> provider-service / agent-service / PostgreSQL`
- 主运行栈以 `docker-compose.yml` 为准；`docker-compose.napcat.yml` 只负责 NapCat。
- 新工作优先基于这些活跃模块：`modules/provider-service`、`modules/agent-service`、`modules/xiaoni-executor`、`modules/admin-panel/backend`、`modules/admin-panel/frontend`、`packages/persistence`
- 次级入口：`modules/embedding-server`、`modules/http-traffic-monitor`
- 这些不是新人理解系统的第一站，但只要服务由 `docker-compose.yml` 托管，改动后就必须按 `Done Means` 验证
- 已经移除的旧服务、旧接口和旧页面不要再作为当前契约参考；排障与开发都只围绕上面的活跃模块展开

## Project Map
- `modules/provider-service`：OneBot / NapCat 入站与出站、provider debug、消息模拟、simple queue、embeddings、image provider、inbox 写入、内部 loop 触发队列和 timeline
- `modules/xiaoni-executor`：小腻 `exec_command` 的独立命令执行容器，保存 session、审计日志和 git archive
- `modules/admin-panel/backend`：管理端 API，承接 runs、conversations、queue、prompt、playground、traffic replay、runtime status
- `modules/admin-panel/frontend`：React + Vite 管理端 UI，默认走 `admin-panel/backend`
- `modules/agent-service`：后台 agent loop / runtime worker，消费 Notify Bucket 触发、执行主 agent run、路由模型 response action、维护 delivery state，提供 `$qq-usage` 工程 API，并维护 life event 投影；当前没有旧式固定 presence runner，但空闲且未休息时会创建 `self_continuation` 内部 runtime slice，维持小腻的连续主 loop
- `packages/persistence`：共享 PostgreSQL 持久化层；所有共享表和业务持久化读写都必须收口到这里
- 其余入口统一去 `docs/INDEX.md`

## Where To Debug
- 页面展示错、交互异常、浏览器请求失败：先分清生产前端还是本地联调，再看 `modules/admin-panel/frontend`；对应 `docs/AGENTS_FRONTEND.md`
- API 500、数据不一致、队列/Prompt/会话问题：先看 `modules/admin-panel/backend`；涉及共享表和持久化再看 `packages/persistence`；对应 `docs/AGENTS_BACKEND_DATA.md`
- provider debug、NapCat 收发消息、embeddings、image provider、simple queue、inbound queue 写入、timeline / queue 主链问题：先看 `modules/provider-service`，不要先在前端或历史模块绕圈
- agent run、行为判断、delivery state、自学习、self continuation / system reminder、life event 投影、历史数字行动展示和后台任务执行问题：看 `modules/agent-service`
- 小腻 `exec_command`、session poll/kill、命令审计、git archive、Docker socket 相关问题：看 `modules/xiaoni-executor`；对应 `docs/AGENTS_XIAONI_EXECUTOR.md`
- 部署、认证、token、本机访问问题：先看 `docs/AGENTS_SECRETS_LOCAL_STATE.md`，再看 `scripts/deploy-admin-public.sh`、`scripts/start_modules.py`
- 默认规则：只修真实生效的层，不要围绕错误契约继续堆适配层

## Development Rules
- 根目录不是 npm workspace；新增依赖只加到对应模块
- 所有 PostgreSQL 持久化读写必须统一收口到 `packages/persistence`；禁止把查询、写入、事务逻辑散落在模块内路由、页面服务或临时脚本里
- 持久层默认且必须使用 ORM；当前仓库以 `packages/persistence` 中的 Prisma schema 和 Prisma Client 作为唯一标准入口
- 未经明确评审确认 ORM 无法合理表达前，禁止新增原生 SQL；即使必须使用原生 SQL，也只能封装在 `packages/persistence` 内，不能绕过持久层下沉到业务模块
- 管理端页面中的 Playground，以及对话流中的 Playground 导入，必须严格与我们提供的通用 Provider 参数契约保持一致；禁止自行扩展、重命名、省略或映射出另一套参数语义。这是管理面这两块业务的红线
- 仓库文档是可追溯真相源；聊天、口头说明、临时记录都不算交付
- 整个项目文档默认遵循渐进式披露：入口文档只放判断、边界和下一跳；细节放到被链接的专项文档，不在多个入口重复展开
- 真实密钥、token、调试认证信息统一从 `/home/liahua/.qqbot-local/` 读取；`.env.docker.example` 只是模板，不能回填真实 secret
- 复杂任务不要只靠聊天上下文推进；优先使用 gstack 工作流，不要再把仓库内 execution plan 当成默认进度跟踪机制
- 浏览网页、站点 QA、截图、交互验证时，默认优先使用 gstack 的 `$browse`
- 涉及 OpenAI 产品、API、模型选择或官方文档查询时，默认优先使用 `$openai-docs`
- OpenAI / LLM 请求、提示词、agent 设计官方参考统一看 `docs/AGENTS_OPENAI_REQUESTS.md`
- Codex + gstack 本机安装、升级、去重统一看 `docs/AGENTS_GSTACK_CODEX.md`；不要在本仓库 vendoring gstack 或新增重复 skill alias
- 当前工作站默认 Playwright MCP 直连不稳定；出现 host Chrome 连接失败、超时、附着到 `connect.html`、token 变化或路径漂移时，直接使用 `$playwright-host-chrome-bridge` 修复并校准到 `http://localhost:9978/mcp`
- 团队协作默认共享这套 gstack 约定；新接手仓库的同学先完成 gstack 接入，再按本文件和 `docs/` 入口继续工作
- 常用工作流只记这几个：`$autoplan`、`$plan-eng-review`、`$browse`、`$investigate`、`$review`、`$qa`、`$ship`、`$document-release`
- 当任务涉及 `AGENTS.md`、`docs/` 知识库结构、文档去重/裁剪、system-of-record、渐进披露或长任务协作规则时，优先使用 gstack 的 `$document-release`

## Default Commands
- 安装：`npm run install:all`
- 构建：`npm run build`
- 测试：`npm run test`
- 本地启动 / 状态：`python3 scripts/start_modules.py start`、`python3 scripts/start_modules.py status`
- 生产前端部署 / 本地联调重启：`npm run deploy`、`npm run deploy:local`

## Done Means
- 如果改了 `docker-compose.yml` 托管的服务，完成不止是改代码
- 这条规则适用于所有 compose 托管服务，包括 `modules/agent-service`、`modules/xiaoni-executor`、`modules/provider-service`、`modules/admin-panel/backend`、`modules/admin-panel/frontend`、`modules/embedding-server`
- 至少要做：对应模块构建或测试、`docker compose build <service>`、`docker compose up -d <service>`、`docker compose ps`、相关日志或健康检查确认正常
- 不要对主栈执行 `docker compose up -d --remove-orphans`，除非明确要清理同项目下其他容器

## Open Extra Docs Only When Needed
- 先看 `docs/INDEX.md`，再按任务进入最少的相关文档
- 常用下一跳：`docs/AGENTS_FRONTEND.md`、`docs/AGENTS_BACKEND_DATA.md`、`docs/AGENTS_SECRETS_LOCAL_STATE.md`、`docs/AGENTS_XIAONI_EXECUTOR.md`、`docs/AGENTS_EMBEDDINGS.md`、`docs/AGENTS_GIT_PR.md`
- 运行时认知补充统一回 `docs/START_HERE.md` 和 `README.md`
- 做跨模块、多阶段或需要交接的任务时，优先直接进入对应 gstack 工作流，而不是新增仓库内 plan 文件
- 做仓库协作规范、文档治理或 gstack 使用约定调整时，额外使用 gstack 的 `$document-release`

# CLAUDE.md

面向协作助手的快速指引。默认遵循奥卡姆剃刀原则,KISS，优先复用现成脚本与配置。

## 1. 项目概览
- 平台：基于 OneBot 11 协议的 QQ Bot，主语言 TypeScript，数据库 MySQL。
- 服务路径：核心位于 `modules/qqbot-core`，管理入口在 `modules/admin-panel/{backend,frontend}`。
- 近期状态、待修复项和自验证流程请查看 [项目状态](docs/PROJECT_STATUS.md)；路线图参见 [项目路线图](docs/ROADMAP.md)。

## 2. 模块结构
```
modules/
├── http-api/                # OneBot/HTTP 网关 (8080)
├── qqbot-core/              # 核心消息与 AI 引擎 (8081)
├── admin-panel/backend/     # 管理后端 API (9080)
└── admin-panel/frontend/    # 管理前端界面 (3003)
```

### 核心引擎与服务
- `modules/qqbot-core/src/engines/decision-engine.ts`：判断是否响应以及选用何种服务。
- `modules/qqbot-core/src/engines/context-engine.ts`：聚合上下文。
- Prompt agent 在配置中负责语气/人设，详见 `modules/qqbot-core/src/services/ai-service.ts` 的配置加载逻辑。
- `modules/qqbot-core/src/services/ai-service.ts`：Gemini 调用、token 轮换与日志。
- 其他服务（`database.ts`、`websocket-client.ts`、`context-manager.ts`）封装数据库访问与 WebSocket 通道。

更多架构背景：[HUMAN_LIKE_PROCESSOR_FLOW.md](docs/HUMAN_LIKE_PROCESSOR_FLOW.md)、[LLM_TOOL_EXECUTION_DESIGN.md](docs/LLM_TOOL_EXECUTION_DESIGN.md)。

## 3. 部署与脚本
```bash
docker compose build          # 构建镜像（需 Docker Compose v2）
docker compose up -d          # 启动主栈 (mysql、qqbot-core、admin-*、http-api)
docker compose ps             # 查看容器状态
docker compose logs -f <svc>  # 跟踪指定服务日志
docker compose down           # 停止并保留卷

# 一次性运维任务 (ops profile)
docker compose --profile ops run --rm init-db
docker compose --profile ops run --rm update-llm-config
docker compose --profile ops run --rm test-llm-config
```
容器日志：`docker compose logs -f qqbot-qqbot-core`；进入容器：`docker exec -it qqbot-qqbot-core /bin/sh`。
使用 `docker compose`（带空格的新命令）；旧版 `docker-compose` 会忽略 profile 及部分配置。
完整部署指引参见根目录 [DOCKER.md](DOCKER.md)。

## 4. 数据库与网络
- 连接参数示例：`mysql -u qqbot_user -pqqbot_password -h localhost -P 3306 qqbot_db`。
- 主要表：`conversations`、`llm_call_logs`、`llm_jobs` 等，迁移脚本位于 [database/migrations/](database/migrations/)。
- 服务默认在 Docker 网络 `qq_bot_network` 中运行，容器名称可以互相解析。
- HTTP 透明代理及运维脚本位于 [transparent-proxy](modules/http-traffic-monitor/transparent-proxy/) 目录，详细说明见 [MITMPROXY 启动指南](docs/archive/MITMPROXY_STARTUP_GUIDE.md)。

## 5. AI 配置与工具编排
- 管理端提供实时配置接口，启用/验证流程参见 [项目状态](docs/PROJECT_STATUS.md) 中的自验证章节。
- LLM 工具系统组件：`LLMJobWorker`、`FunctionCallDispatcher`、`ToolRegistryService`、`tools/static-tools.ts`。
- 相关设计与数据库说明：[LLM 工具执行设计](docs/LLM_TOOL_EXECUTION_DESIGN.md)、[010_create_llm_tool_system_tables.sql](database/migrations/010_create_llm_tool_system_tables.sql)。

## 6. 贡献与提交
- 避免提交 `resource/napcat_qq_data/`、`logs/`、`dist/`、`node_modules/` 等目录；提交前执行 `git status`。
- 推荐流程：
  ```bash
  git status
  git add <files>
  git commit -m "feat: 简要说明"
  ```
- 目前已提供的模块文档：[qqbot-core CLAUDE](modules/qqbot-core/CLAUDE.md)、[http-traffic-monitor CLAUDE](modules/http-traffic-monitor/CLAUDE.md)。

如遇到架构或流程不明确的情况，优先查阅 [项目状态](docs/PROJECT_STATUS.md) 与对应专题文档，必要时与维护者同步确认后再改动。

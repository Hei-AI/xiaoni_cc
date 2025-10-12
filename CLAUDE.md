# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

面向协作助手的快速指引。默认遵循奥卡姆剃刀原则,KISS，优先复用现成脚本与配置。

## 1. 项目概览
- 平台：基于 OneBot 11 协议的 QQ Bot，主语言 TypeScript，数据库 MySQL。
- 服务架构：微服务架构，核心服务通过 Docker Compose 协同运行。
- 近期状态、待修复项和自验证流程请查看 [项目状态](docs/PROJECT_STATUS.md)；路线图参见 [项目路线图](docs/ROADMAP.md)。

## 2. 模块结构
```
modules/
├── http-api/                # HTTP 网关与函数注册中心 (8080)
│   ├── routes/              # API 路由 (函数注册、Prompt 绑定、调用)
│   ├── services/            # FunctionRegistryService、执行服务
│   └── repositories/        # 数据访问层
├── qqbot-core/              # 核心消息与 AI 引擎 (8081)
│   ├── engines/             # 决策、上下文、人格引擎
│   ├── services/            # AI 服务、函数调用分发、队列管理
│   └── tools/               # 静态工具实现
├── admin-panel/backend/     # 管理后端 API (9080)
└── admin-panel/frontend/    # 管理前端界面 (3003)
```

### 核心引擎与服务
**qqbot-core 核心服务**：
- `engines/decision-engine.ts`：判断是否响应以及选用何种服务。
- `engines/persona-engine.ts`：对最终回复做人格化润色。
- `engines/context-engine.ts`：聚合上下文。
- `services/ai-service.ts`：统一 Gemini SDK 调用、token 轮换与日志（已迁移至 @google/genai）。
- `services/function-registry-client.ts`：函数注册中心客户端，从 http-api 获取函数定义与执行。
- `services/function-call-dispatcher.ts`：函数调用分发器，整合注册中心与本地工具。
- 其他服务（`database.ts`、`websocket-client.ts`、`context-manager.ts`）封装数据库访问与 WebSocket 通道。

**http-api 函数注册中心**：
- `routes/function-routes.ts`：函数 CRUD 接口 (`GET|POST|PATCH /v1/functions`)。
- `routes/prompt-routes.ts`：Prompt 与函数绑定 (`GET|PATCH /v1/prompts/{id}/functions`)。
- `routes/invocation-routes.ts`：统一函数调用入口 (`POST /v1/functions/{id}/invoke`)。
- `services/function-registry-service.ts`：核心业务逻辑、参数校验、执行转发。
- `repositories/`：数据库访问层（函数定义、绑定关系、执行日志）。

更多架构背景：[HUMAN_LIKE_PROCESSOR_FLOW.md](docs/HUMAN_LIKE_PROCESSOR_FLOW.md)、[LLM_TOOL_EXECUTION_DESIGN.md](docs/LLM_TOOL_EXECUTION_DESIGN.md)、[LLM 函数调用注册中心设计](docs/llm_function_calling_registry_design.md)。

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
- 主要表：
  - **对话与日志**：`conversations`、`llm_call_logs`、`llm_jobs`
  - **函数注册中心**：`llm_function_definitions`、`prompt_function_bindings`、`function_execution_logs`（见 [012_create_llm_function_registry_tables.sql](database/migrations/012_create_llm_function_registry_tables.sql)）
  - **Token 管理**：`api_tokens`、`api_token_logs`、`api_token_health_config`
  - **会话管理**：`conversation_sessions`、`session_service_transitions`
  - **Prompt 配置**：`agent_prompts`
- 迁移脚本位于 [database/migrations/](database/migrations/)。
- 服务默认在 Docker 网络 `qq_bot_network` 中运行，容器名称可以互相解析。
- HTTP 透明代理及运维脚本位于 [transparent-proxy](modules/http-traffic-monitor/transparent-proxy/) 目录，详细说明见 [MITMPROXY 启动指南](docs/archive/MITMPROXY_STARTUP_GUIDE.md)。

## 5. AI 配置与工具编排

### 5.1 核心架构
- **统一配置系统**：所有 AI 配置统一存储在 `agent_prompts` 表，支持版本管理和动态更新。
- **函数注册中心**：`http-api` 服务托管 LLM 函数定义，`qqbot-core` 按需获取并执行（见 [LLM 函数调用注册中心设计](docs/llm_function_calling_registry_design.md)）。
- **Token 管理**：智能轮换机制，基于优先级、健康状态、使用频率和每日配额自动选择最优 Token。

### 5.2 LLM 工具系统
**核心组件**：
- `LLMJobWorker` (qqbot-core)：异步任务工作器，处理 LLM 工具编排流程。
- `FunctionCallDispatcher` (qqbot-core)：统一函数调用分发，整合注册中心函数与本地工具。
- `FunctionRegistryClient` (qqbot-core)：HTTP 客户端，访问注册中心获取函数定义和执行。
- `FunctionRegistryService` (http-api)：函数注册中心核心服务，管理 CRUD、绑定和执行。
- `ToolRegistryService` (qqbot-core)：本地动态工具注册表。
- `tools/static-tools.ts` (qqbot-core)：静态工具实现（消息发送等）。

**配置流程**：
1. 在 http-api 注册函数定义（名称、描述、参数 Schema、调用方式）
2. 在管理端将函数绑定到 Prompt（设置 calling mode）
3. qqbot-core 加载 Prompt 时自动从注册中心获取函数定义
4. LLM 返回 function_call 时，通过注册中心统一执行

**环境变量**：
- `FUNCTION_REGISTRY_BASE_URL`：注册中心地址（默认 `http://http-api:8080/v1`）
- `ENABLE_FUNCTION_REGISTRY`：是否启用注册中心（默认 `true`）
- `FUNCTION_REGISTRY_TIMEOUT_MS`：访问超时（默认 5000ms）

**数据库初始化**：
```bash
# 创建函数注册中心表
docker compose --profile ops run --rm migrate-db-012

# 初始化基础消息函数
mysql -u qqbot_user -pqqbot_password qqbot_db < database/migrations/manual/seed_basic_messaging_functions.sql
```

**相关文档**：
- [LLM 工具执行设计](docs/LLM_TOOL_EXECUTION_DESIGN.md)
- [函数注册中心设计](docs/llm_function_calling_registry_design.md)
- [010_create_llm_tool_system_tables.sql](database/migrations/010_create_llm_tool_system_tables.sql)
- [012_create_llm_function_registry_tables.sql](database/migrations/012_create_llm_function_registry_tables.sql)

## 6. 常用开发命令

### 6.1 服务管理
```bash
# 构建与启动
docker compose build                    # 构建所有镜像
docker compose up -d                    # 启动所有服务
docker compose ps                       # 查看容器状态
docker compose logs -f qqbot-core       # 查看核心服务日志
docker compose logs -f http-api         # 查看网关服务日志

# 重启服务
docker compose restart qqbot-core       # 重启核心服务
docker compose restart http-api         # 重启网关服务

# 进入容器
docker exec -it qqbot-qqbot-core /bin/sh
docker exec -it qqbot-http-api /bin/sh
```

### 6.2 数据库操作
```bash
# 运行迁移
docker compose --profile ops run --rm init-db

# 连接数据库
mysql -u qqbot_user -pqqbot_password -h localhost -P 3306 qqbot_db

# 查看 Token 状态
docker exec -it qqbot-mysql mysql -u qqbot_user -pqqbot_password qqbot_db \
  -e "SELECT * FROM token_health_summary;"

# 手动重置每日 Token 用量
docker exec -it qqbot-mysql mysql -u qqbot_user -pqqbot_password qqbot_db \
  -e "CALL ResetDailyTokenUsage();"
```

### 6.3 函数注册中心操作
```bash
# 查询所有函数
curl http://localhost:8080/v1/functions

# 查看 Prompt 绑定的函数
curl http://localhost:8080/v1/prompts/{promptId}/functions

# 调用函数（内部调用示例）
curl -X POST http://localhost:8080/v1/functions/{functionId}/invoke \
  -H "Content-Type: application/json" \
  -d '{"traceId": "test", "arguments": {...}}'
```

### 6.4 测试与调试
```bash
# 运行单元测试（在各模块目录下）
cd modules/qqbot-core && npm test
cd modules/http-api && npm test

# 运行特定测试文件
npm test -- function-registry-client.test.ts

# 查看 LLM 调用日志
docker exec -it qqbot-mysql mysql -u qqbot_user -pqqbot_password qqbot_db \
  -e "SELECT * FROM llm_call_logs ORDER BY created_at DESC LIMIT 10;"
```

## 7. 贡献与提交
- 避免提交 `resource/napcat_qq_data/`、`logs/`、`dist/`、`node_modules/` 等目录；提交前执行 `git status`。
- 推荐流程：
  ```bash
  git status
  git add <files>
  git commit -m "feat: 简要说明"
  ```
- 目前已提供的模块文档：
  - [qqbot-core CLAUDE](modules/qqbot-core/CLAUDE.md)
  - [http-traffic-monitor CLAUDE](modules/http-traffic-monitor/CLAUDE.md)
  - [数据库 CLAUDE](database/CLAUDE.md)

## 8. 重要架构变更记录

### 8.1 函数注册中心系统 (2025-10)
**背景**：统一管理 LLM Function Calling 函数定义，避免在 Prompt 配置中重复嵌入完整函数结构。

**核心变化**：
- 新增 `http-api` 作为函数注册中心，提供函数 CRUD、Prompt 绑定和统一调用接口
- `qqbot-core` 新增 `FunctionRegistryClient`，从注册中心动态获取函数定义
- `FunctionCallDispatcher` 整合注册中心函数与本地工具的统一分发
- 数据库新增 `llm_function_definitions`、`prompt_function_bindings`、`function_execution_logs` 表

**迁移路径**：
1. 执行 `012_create_llm_function_registry_tables.sql` 创建表结构
2. 运行 `seed_basic_messaging_functions.sql` 初始化基础函数
3. 旧版 Prompt 的 `advanced_config.toolsConfig` 逐步迁移至绑定关系
4. 设置 `ENABLE_FUNCTION_REGISTRY=true` 启用新系统（默认已启用）

详细设计：[LLM 函数调用注册中心设计](docs/llm_function_calling_registry_design.md)

### 8.2 AI Service 迁移至 @google/genai SDK (2025-10)
**背景**：统一使用官方 Google GenAI SDK，移除 legacy 配置系统。

**核心变化**：
- 完全迁移至 `@google/genai` SDK，移除 `@google/generative-ai` 依赖
- 统一配置架构（`UnifiedLLMConfig`），所有配置通过 `agent_prompts` 表管理
- 改进 Token 管理，支持按模型、优先级、健康状态智能选择
- 增强错误处理和重试机制，所有 LLM 调用（成功/失败）均记录到 `llm_call_logs`

**关键文件**：
- `modules/qqbot-core/src/services/ai-service.ts` (核心重构)
- `modules/qqbot-core/src/types/index.ts` (统一类型定义)
- `modules/qqbot-core/src/utils/token-manager.ts` (Token 管理器)

### 8.3 Token 健康管理系统增强 (2025-09)
**核心特性**：
- 智能 Token 选择：优先级、权重、使用率、健康状态多维度排序
- 自动故障恢复：黑名单 Token 定期尝试恢复
- 每日用量控制：自动重置机制，支持配额管理
- 完整审计日志：所有 Token 使用和健康检查记录在 `api_token_logs`

**相关表**：`api_tokens`、`api_token_logs`、`api_token_health_config`

如遇到架构或流程不明确的情况，优先查阅 [项目状态](docs/PROJECT_STATUS.md) 与对应专题文档，必要时与维护者同步确认后再改动。

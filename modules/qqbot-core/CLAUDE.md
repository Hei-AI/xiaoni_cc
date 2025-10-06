# CLAUDE.md — qqbot-core

面向协作助手的快速参考，保持方案简洁，尽量复用现有代码与脚本。

## 1. 模块概述
- 位置：`modules/qqbot-core`，提供 QQ 消息接入、消息队列、AI 调度和发送等核心能力。
- 关键依赖：TypeScript、Node.js、MySQL（参见 [database/migrations/](../../database/migrations/)）、Gemini API。
- 上下文：整体服务架构与近期状态请参考仓库根目录的 [CLAUDE.md](../../CLAUDE.md) 以及 [项目状态](../../docs/PROJECT_STATUS.md)。

## 2. 代码结构速览
```
src/
├── engines/             # 决策与上下文引擎
├── services/            # AI、数据库、队列、调度器等服务
├── tools/               # LLM 静态工具实现
├── types/               # 统一类型定义
├── index.ts             # 服务入口与消息处理
└── tests/               # Jest 单元与集成测试
```

### 核心引擎
- `engines/decision-engine.ts`：判断是否回复及选用策略。
- `engines/context-engine.ts`：构建消息上下文。

### 重要服务
- `services/message-queue-service.ts`：分区队列与优先级管理。
- `services/schedule-dispatcher.ts`、`services/direct-notifier.ts`：拟人化调度与直连模式触发。
- `services/llm-job-worker.ts`、`services/function-call-dispatcher.ts`、`services/tool-registry-service.ts`：LLM Function Calling 与工具分发。
- `services/ai-service.ts`：Gemini 调用封装，包含 `generateContent` 等接口。

完整实现说明见 [HUMAN_LIKE_PROCESSOR_FLOW.md](../../docs/HUMAN_LIKE_PROCESSOR_FLOW.md) 与 [LLM_TOOL_EXECUTION_DESIGN.md](../../docs/LLM_TOOL_EXECUTION_DESIGN.md)。

## 3. 常用命令
```bash
npm install                # 初始化依赖（容器内已装可跳过）
npm run lint               # Lint
npm test                   # 单元/集成测试
npm run build              # 构建
```
通常通过 Docker 统一管理：`docker compose up -d qqbot-core`，日志查看 `docker logs -f qqbot-qqbot-core`。

## 4. 配置与环境
- `.env` / 配置中心：见 [src/config/index.ts](./src/config/index.ts)，优先使用环境变量注入。
- 数据库连接：由 [services/database.ts](./src/services/database.ts) 和 `DatabaseManager` 维护。
- 队列与调度开关：`ENABLE_HUMAN_LIKE_PROCESSING` 控制拟人化调度；`ENABLE_LLM_TOOLS` 控制异步工具链。自验证步骤记录在 [项目状态](../../docs/PROJECT_STATUS.md)。

## 5. 消息处理流程摘要
1. WebSocket 消息进入 `handlePrivateMessage`/`handleGroupMessage`。
2. 统一入队 `MessageQueueService`，由 `DirectNotifier` 或 `ScheduleDispatcher` 触发批量处理。
3. `_processSingle*` 负责上下文加载、决策、AI 调用与最终发送。
4. LLM 工具系统启用时，通过 `LLMJobWorker` 异步处理，回调逻辑参见 [src/index.ts](./src/index.ts) 和 [项目状态](../../docs/PROJECT_STATUS.md) 中的修复清单。

## 6. 测试与调试
- 单元/集成测试：`npm test` 或 `npm run test:watch`。
- LLM 工具专用测试：[llm-tools-integration.test.ts](./tests/llm-tools-integration.test.ts)。
- 模拟消息：[src/index.ts](./src/index.ts) 中暴露的 `simulatePrivateMessage*`、`simulateGroupMessage*` 方法，或通过 [modules/http-api](../http-api) 提供的 HTTP 接口。

## 7. 提交注意
- 不要提交 `logs/`、`dist/`、`node_modules/`、`resource/napcat_qq_data/` 等目录。
- 使用 `git status` 确认修改，按需 `git add <files>`，确保提交说明清晰。

若需深入理解某部分逻辑，请先查阅上方提到的设计文档；遇到与现实实现不符的地方，以 [项目状态](../../docs/PROJECT_STATUS.md) 的最新描述为准。必要时与维护者确认后再调整。EOF

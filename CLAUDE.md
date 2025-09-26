# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# QQ智能机器人 - 4模块独立架构

## 项目概述
基于OneBot 11协议的智能QQ机器人，采用微服务架构，支持AI对话、需求处理和管理控制。使用TypeScript开发，MySQL数据库，Docker容器化部署。

## 核心架构

### 4模块设计
```
modules/
├── http-api/           # HTTP API网关 (端口: 8080)
├── qqbot-core/         # QQ机器人核心服务 (端口: 8081)
└── admin-panel/        # 管理面板
    ├── backend/        # 管理后端API (端口: 9080)
    └── frontend/       # 管理前端界面 (端口: 3003)
```

### 关键服务组件 (`modules/qqbot-core/src/services/`)
- **ai-service.ts**: Gemini AI集成，**Model-aware Token管理**，对话处理 (🔥 增强)
- **database.ts**: MySQL数据库管理，**优化连接池**，**修复连接泄露**，**调用链追踪** (🔥 增强)
- **http-server.ts**: HTTP API端点，健康检查，状态监控 (26KB+)
- **websocket-client.ts**: OneBot WebSocket连接，QQ消息收发，**Trace ID生成**
- **session-manager.ts**: 多服务会话编排，智能服务切换逻辑
- **context-manager.ts**: 对话上下文维护，消息历史管理，智能上下文感知
- **remote-claude-service.ts**: Claude Code远程会话处理，Tmux会话管理
- **logging-service.ts**: 结构化日志系统，Trace ID支持，多级日志输出 (20KB+)
- **debug-service.ts**: 开发调试服务，请求追踪，性能监控

### Token-Model绑定管理系统 (🆕 新增架构)
- **TokenManager** (`utils/token-manager.ts`): **Model-aware token选择**，被动健康检查，5分钟黑名单机制
- **Agent Prompts**: 模型与Token绑定配置，支持`gemini-2.5-flash`和`gemini-1.5-pro`
- **Model Blacklist**: 按模型独立的Token黑名单状态管理（JSON字段）
- **Admin Panel Health Check**: 主动Token健康检查接口，**仅存在于管理端**
- **架构分离**: QQ Bot Core为被动模式，Admin Panel为主动检查模式

### 智能引擎系统 (`modules/qqbot-core/src/engines/`)
- **decision-engine.ts**: Stage 1智能决策引擎，基于规则的消息分类和路由
- **context-engine.ts**: 上下文分析引擎，对话感知和历史理解
- **persona-engine.ts**: 人格适应引擎，响应风格和个性化处理

### 调用链路追踪系统 (🔥 增强)
- **Trace ID**: 完整的消息处理链路标识
- **WebSocket-Conversations关联**: `websocket_logs`和`conversations`表通过`trace_id`关联
- **完整时间线**: WebSocket事件、AI处理、数据库操作的完整追踪
- **DatabaseManager新增方法**: `getTraceDetails()`, `getFullTraceAnalysis()`

## 常用命令 (🐳 Docker 部署 - 推荐方式)

### Docker 部署操作 (主要方式)
```bash
# 🚀 构建所有服务镜像
./scripts/docker-deploy.sh all build

# ✅ 启动所有服务 (推荐)
./scripts/docker-deploy.sh all run

# 📊 检查服务状态
./scripts/docker-deploy.sh all status

# ⏹️ 停止所有服务
./scripts/docker-deploy.sh all stop

# 🗑️ 清理容器和镜像
./scripts/docker-deploy.sh all clean
```

### 单个服务 Docker 管理
```bash
# 管理特定服务 (qqbot-core, http-api, admin-backend, admin-frontend)
./scripts/docker-deploy.sh qqbot-core build
./scripts/docker-deploy.sh qqbot-core run
./scripts/docker-deploy.sh qqbot-core stop

# 查看实时日志
docker logs -f qqbot-qqbot-core
docker logs -f qqbot-http-api

# 进入容器调试
docker exec -it qqbot-qqbot-core /bin/sh
```

### 🔧 CI/CD 和构建命令 (容器内执行)
```bash
# ⚠️ 以下命令在Docker容器内或CI/CD流程中使用
# 不建议本地直接执行，应优先使用Docker部署

# 在容器内或CI环境执行构建和测试
docker exec qqbot-qqbot-core npm run build
docker exec qqbot-qqbot-core npm test
docker exec qqbot-qqbot-core npm run lint

# CI/CD 流程中的构建验证 (在CI环境或容器内执行)
./scripts/docker-deploy.sh all build  # Docker构建验证
./scripts/docker-deploy.sh all test   # Docker自动化测试
./scripts/docker-deploy.sh all lint   # Docker代码质量检查

# 注意: 开发和生产都应使用Docker部署
```

## 数据库架构

### 核心数据表
- **conversations**: AI对话历史，支持上下文查询
- **requirements**: Claude Code需求处理状态跟踪
- **system_logs**: 结构化系统日志存储
- **bot_status**: 实时机器人运行状态监控
- **api_tokens**: Gemini API Token轮换管理，健康状态检查
- **conversation_sessions**: 多服务会话状态跟踪，服务切换记录
- **agent_prompts**: AI Agent提示词配置管理

### 会话管理表
- **message_reply_chain**: 消息引用和回复链追踪
- **session_events**: 会话事件审计跟踪，支持分区表
- **llm_interactions**: LLM调用日志，成本和性能追踪
- **service_call_logs**: 服务间调用记录和性能分析
- **user_confirmations**: 用户交互确认记录

### 追踪日志表
- **websocket_logs**: 完整WebSocket消息追踪
- **llm_call_logs**: 详细LLM API调用日志，性能指标
- **session_traces**: 端到端对话追踪分析
- **trace_statistics**: 聚合分析统计，支持分区查询

### 数据库连接
- **主机**: localhost:3306
- **数据库**: qqbot_db
- **用户**: qqbot_user/qqbot_password
- **字符集**: utf8mb4_unicode_ci

## 开发工作流 (🐳 Docker 容器化开发)

### 新功能开发流程
1. 确定功能涉及的模块 (通常是`qqbot-core`)
2. 使用Docker容器化开发环境进行开发
3. 构建并启动开发容器：`./scripts/docker-deploy.sh <module> build && ./scripts/docker-deploy.sh <module> run`
4. 在容器内运行测试：`docker exec qqbot-<module> npm test`
5. 在容器内检查代码质量：`docker exec qqbot-<module> npm run lint`
6. 在容器内验证构建：`docker exec qqbot-<module> npm run build`

### 调试和日志
- **日志文件**: `modules/*/resources/logs/` - 模块级日志存储
- **结构化日志**: JSON格式，支持Trace ID追踪
- **LoggingService**: 统一日志服务，数据库集成
- **日志级别**: DEBUG、INFO、WARN、ERROR四级分类
- **追踪系统**: 完整请求链路追踪，性能监控
- **Debug Service**: 开发环境调试工具，实时状态监控

### 🎯 前端问题调试方法论 (重要)

**调试优先级顺序**:
1. **Playwright 自动化测试** - 首要工具
   - 模拟真实用户交互流程
   - 自动化重现问题场景
   - 获取页面快照和DOM状态信息

2. **F12 开发者工具检查** - 关键辅助排查
   - **Network 网络面板**: 检查API调用、HTTP状态码、请求/响应数据
   - **Console 控制台**: 查看JavaScript错误、警告和日志信息
   - **Elements 元素面板**: 检查DOM结构和CSS样式问题
   - **Application 应用面板**: 检查LocalStorage、SessionStorage等状态

**标准前端调试流程**:
```bash
1. Playwright UI测试 → 发现功能异常和交互问题
2. F12 Network检查 → 定位网络请求和API响应问题
3. 后端API验证 → 确认服务端逻辑和数据处理
4. 代码修复 → 解决根本原因（前端/后端）
5. Playwright端到端验证 → 确认修复效果和回归测试
```

**重要**: 所有前端功能问题都应优先使用此方法论进行系统化排查，确保快速准确定位问题根源。

### 测试策略
- **单元测试**: Jest框架，TypeScript支持
- **集成测试**: 数据库和HTTP API测试
- **端到端测试**: 完整工作流验证
- **覆盖率目标**: 语句>80%, 分支>75%, 函数>85%

## 配置管理

### 环境变量文件
每个模块都需要`.env`文件，从`.env.example`复制：
```bash
cp modules/*/env.example modules/*/.env
```

### 关键配置项
- **数据库连接**: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME
- **QQ机器人**: BOT_QQ_NUMBER, ONEBOT_WS_URL
- **AI服务**: GEMINI_API_KEY, AI_MODEL_NAME
- **服务端口**: HTTP_PORT, WEBSOCKET_PORT

## 服务间通信

### 通信模式
- HTTP API ↔ QQBot Core: HTTP REST API
- Admin Backend ↔ Database: 直接数据库连接
- Admin Frontend ↔ Admin Backend: REST API
- QQBot Core ↔ Database: 连接池管理的直接连接

### 端口规划
- 8080: HTTP API Gateway (外部访问)
- 8081: QQBot Core (内部通信)
- 9080: Admin Backend API
- 3003: Admin Frontend (容器化部署)
- 3306: MySQL Database

## 特殊功能

### AI智能对话系统
- **核心模型**: Google Gemini 1.5 Pro，支持上下文感知
- **智能引擎**: Stage 1决策引擎，上下文分析，人格适应
- **意图识别**: 高级消息分类和路由决策
- **Token管理**: 智能轮换机制，健康检查，使用统计
- **响应优化**: 个性化回复风格，上下文相关性分析

### 需求处理系统
- **Claude Code集成**: 远程会话处理，实时状态同步
- **异步处理流程**: 需求队列管理，进度追踪
- **Tmux会话管理**: 隔离环境执行，会话持久化
- **状态追踪**: 完整需求生命周期管理

### 会话管理架构
- **多服务编排**: chat, requirement, mixed会话类型
- **智能服务切换**: 基于上下文的自动路由
- **会话持久化**: 30分钟超时，跨服务上下文保持
- **上下文管理**: 智能历史维护，相关性分析
- **性能监控**: 会话活跃度，响应时间统计

## 部署和运维

### Docker部署
完整的Docker容器化部署指南请参考：

**@DOCKER.md** - 详细的Docker容器化部署文档，包含：
- 🏠 宿主机网络架构设计
- 🚀 一键部署脚本使用方法
- 📦 4个核心模块的完整容器化配置
- 🔧 环境变量配置和网络优化
- 🛠️ 故障排除和监控指南

### 健康检查
- HTTP健康检查端点: `GET /health`
- 数据库连接状态监控
- WebSocket连接状态跟踪
- 自动故障恢复机制

### 监控和维护
- **追踪系统**: 完整请求链路追踪，端到端性能监控
- **数据库监控**: 系统日志集中存储，分区表管理
- **Token管理**: 使用情况统计，健康状态检查，成本追踪
- **会话分析**: 活跃度统计，服务切换模式分析
- **性能指标**: LLM调用延迟，WebSocket连接状态，服务响应时间
- **自动维护**: 定期数据清理，日志轮转，统计聚合

## 故障排除

### 常见问题
1. **端口占用**: 使用`./scripts/docker-deploy.sh all stop`停止所有容器释放端口
2. **数据库连接失败**: 检查MySQL容器状态
3. **WebSocket连接断开**: 检查OneBot服务状态
4. **Token失效**: 检查api_tokens表健康状态

### 调试技巧
- 使用Docker容器部署，通过容器挂载的本地日志进行排查
- 检查容器挂载的日志目录：`logs/*/` 
- 使用数据库查询验证数据完整性
- 利用HTTP API的健康检查端点
- 容器状态检查：`docker ps` 和 `docker logs <container_name>`

### 开发环境重置

**🐳 Docker 容器化部署** (强烈推荐，生产就绪)：

```bash
# 完整重置流程
./scripts/docker-deploy.sh all stop     # 停止所有容器服务
./scripts/docker-deploy.sh all clean    # 清理容器和镜像
./scripts/docker-deploy.sh all build    # 重新构建所有镜像
./scripts/docker-deploy.sh all run      # 启动所有服务

# 查看服务状态
./scripts/docker-deploy.sh all status

# 查看服务日志
docker logs -f qqbot-qqbot-core
```

详见 **@DOCKER.md** - 完整的Docker容器化部署指南

**📝 说明**：
```bash
# 本项目采用Docker容器化架构
# 所有服务通过Docker部署和运行
# 详见 @DOCKER.md 获取完整部署指南
```

## 综合测试 (🆕 新增)

### 运行完整系统测试
```bash
# 执行Token-Model绑定系统综合测试 (在Docker容器内运行)
docker exec qqbot-qqbot-core node test_token_model_system.js

# 或使用专用测试容器
./scripts/docker-deploy.sh qqbot-core exec "node test_token_model_system.js"
```

**测试覆盖范围:**
- 数据库表结构验证 (token-model绑定字段)
- Token-Model绑定机制测试
- WebSocket日志与对话记录关联验证
- 服务健康检查 (所有4个模块)
- 私聊功能模拟测试
- 群聊功能模拟测试 (通过group_chat_settings控制)
- Admin Panel Token健康检查
- 调用链路追踪API验证

**测试要求:**
- 必须通过所有8项测试
- 发现问题必须修复，不允许规避
- 包含私聊和群聊的完整模拟
- 验证调用链路的完整性

### 各模块信息

- @modules/qqbot-core/CLAUDE.md
- @modules/http-api/CLAUDE.md
- @modules/admin-panel/CLAUDE.md

## 最近更新 (🔥 重要)

### 消息流程API规范建立 (2025-09-22)
- 建立完整的消息流程API规范文档 (`MESSAGE_FLOW_API_SPECIFICATION.md`)
- 创建4层验证体系和自动化测试脚本 (`test_message_flow_api_complete.js`)
- 明确队列解耦架构下的API设计标准
- 为所有新功能开发和重构建立验证基准

### Token-Model绑定架构 (2025-09-11)
- 实现Model-aware Token选择机制
- 支持按模型独立的黑名单管理
- 移除定时器健康检查，改为被动+主动混合模式
- 修复数据库连接池连接泄露问题

### 调用链路追踪增强 (2025-09-11)
- 修复websocket_logs和conversations表关联
- 新增trace_id字段和索引
- 实现完整的调用链时间线分析
- 提供调用链路API查询接口

### 群聊管理改进 (2025-09-11)
- 群聊功能通过group_chat_settings表控制
- is_enabled: 群聊事件监听开关
- auto_reply_enabled: 群聊自动回复开关
- 支持群聊级别的细粒度控制

## 🎯 开发规范强制要求

**所有开发者必须遵循**：
1. **新功能开发前**：阅读 `MESSAGE_FLOW_API_SPECIFICATION.md`
2. **修改消息处理逻辑**：先更新规范文档，再编码
3. **完成开发后**：在容器内运行 `docker exec qqbot-qqbot-core node test_message_flow_api_complete.js` 验证
4. **重构项目时**：确保通过完整验证脚本

**不合规的代码将不被合并到主分支。**

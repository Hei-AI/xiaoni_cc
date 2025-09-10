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
    └── frontend/       # 管理前端界面 (端口: 3000)
```

### 关键服务组件 (`modules/qqbot-core/src/services/`)
- **ai-service.ts**: Gemini AI集成，意图识别，对话处理，Token轮换机制
- **database.ts**: MySQL数据库管理，连接池，类型安全查询 (50KB+)
- **http-server.ts**: HTTP API端点，健康检查，状态监控 (26KB+)
- **websocket-client.ts**: OneBot WebSocket连接，QQ消息收发
- **session-manager.ts**: 多服务会话编排，智能服务切换逻辑
- **context-manager.ts**: 对话上下文维护，消息历史管理，智能上下文感知
- **remote-claude-service.ts**: Claude Code远程会话处理，Tmux会话管理
- **logging-service.ts**: 结构化日志系统，Trace ID支持，多级日志输出 (20KB+)
- **debug-service.ts**: 开发调试服务，请求追踪，性能监控

### 智能引擎系统 (`modules/qqbot-core/src/engines/`)
- **decision-engine.ts**: Stage 1智能决策引擎，基于规则的消息分类和路由
- **context-engine.ts**: 上下文分析引擎，对话感知和历史理解
- **persona-engine.ts**: 人格适应引擎，响应风格和个性化处理

## 常用命令

### 项目级操作
```bash
# 安装所有模块依赖
npm run install:all

# 启动所有服务 (Python管理脚本)
npm start
# 或
python3 scripts/start_modules.py start

# 停止所有服务
npm run stop

# 查看服务状态
npm run status

# 清理端口占用
npm run clean-ports
```

### 开发命令
```bash
# 开发模式运行单个模块
npm run dev:http-api
npm run dev:qqbot-core
npm run dev:admin-backend
npm run dev:admin-frontend

# 构建所有模块
npm run build:all

# 运行测试
npm run test:all

# 代码检查
npm run lint:all
```

### 模块内部命令 (在各模块目录内)
```bash
# 开发模式
npm run dev

# 构建
npm run build

# 启动生产版本
npm start

# 运行测试
npm test

# 代码检查
npm run lint

# 清理构建文件
npm run clean
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

## 开发工作流

### 新功能开发流程
1. 确定功能涉及的模块 (通常是`qqbot-core`)
2. 在对应模块目录内进行开发
3. 使用`npm run dev`启动开发模式
4. 运行`npm test`确保测试通过
5. 运行`npm run lint`检查代码风格
6. 使用`npm run build`验证构建成功

### 调试和日志
- **日志文件**: `modules/*/resources/logs/` - 模块级日志存储
- **结构化日志**: JSON格式，支持Trace ID追踪
- **LoggingService**: 统一日志服务，数据库集成
- **日志级别**: DEBUG、INFO、WARN、ERROR四级分类
- **追踪系统**: 完整请求链路追踪，性能监控
- **Debug Service**: 开发环境调试工具，实时状态监控

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
- 3000: Admin Frontend
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
```bash
# 启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f qqbot-core
```

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
1. **端口占用**: 运行`npm run clean-ports`
2. **数据库连接失败**: 检查MySQL容器状态
3. **WebSocket连接断开**: 检查OneBot服务状态
4. **Token失效**: 检查api_tokens表健康状态

### 调试技巧
- 使用`npm run status`查看所有服务状态
- 检查各模块的logs目录
- 使用数据库查询验证数据完整性
- 利用HTTP API的健康检查端点

### 开发环境重置
```bash
# 停止所有服务
npm run stop

# 清理端口占用
npm run clean-ports

# 重新安装依赖
npm run install:all

# 重启所有服务
npm start
```

### 各模块信息

- @modules/qqbot-core/CLAUDE.md
- @modules/http-api/CLAUDE.md
- @modules/admin-panel/CLAUDE.md

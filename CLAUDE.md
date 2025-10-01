# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# **开发时遵循奥卡姆剃刀原则,KISS**

# QQ智能机器人 - 4模块微服务架构

## 项目概述
基于OneBot 11协议的智能QQ机器人，采用微服务架构，支持AI对话和管理面板。使用TypeScript开发，MySQL数据库，完全Docker化部署。

## 核心架构

### 4模块设计
```
modules/
├── http-api/           # HTTP API网关 (端口: 8080)
├── qqbot-core/         # QQ机器人核心服务 (端口: 8081)
├── admin-panel/backend/  # 管理后端API (端口: 9080)
└── admin-panel/frontend/ # 管理前端界面 (端口: 3003)
```

### 智能引擎系统 (`modules/qqbot-core/src/engines/`)
- **decision-engine.ts**: 智能决策引擎，消息分类和路由
- **persona-engine.ts**: 人格适应引擎，响应风格个性化
- **context-engine.ts**: 上下文分析引擎，对话历史理解

### 关键服务组件 (`modules/qqbot-core/src/services/`)
- **ai-service.ts**: Gemini AI集成，Model-aware Token管理
- **database.ts**: MySQL数据库管理，连接池优化，调用链追踪
- **websocket-client.ts**: OneBot WebSocket连接，Trace ID生成
- **context-manager.ts**: 对话上下文维护，消息历史管理

## 常用命令

### Docker 部署 (主要方式)
```bash
# 构建并启动所有服务
./scripts/docker-deploy.sh all build
./scripts/docker-deploy.sh all run

# 查看服务状态和日志
./scripts/docker-deploy.sh all status
docker logs -f qqbot-qqbot-core

# 单个服务管理
./scripts/docker-deploy.sh qqbot-core build/run/stop

# 容器内调试和测试
docker exec -it qqbot-qqbot-core /bin/sh
docker exec qqbot-qqbot-core npm test
```

## 数据库架构

### 核心表结构
- **conversations**: AI对话历史，trace_id关联
- **api_tokens**: Gemini API Token管理，model_blacklist JSON字段
- **agent_prompts**: AI Agent提示词配置，advanced_config JSON字段
- **websocket_logs**: WebSocket消息追踪，trace_id关联
- **llm_call_logs**: LLM调用日志，性能指标

连接: `qqbot_user:qqbot_password@localhost:3306/qqbot_db`

## 网络架构

```
Docker Bridge Network: qq_bot_network (172.20.0.0/16)
├── qqbot-mysql → 3306
├── qqbot-qqbot-core → 8081
├── qqbot-http-api → 8080
├── qqbot-admin-backend → 9080
├── qqbot-admin-frontend → 3003
└── napcat → 3001 (WebSocket)
```

**关键网络通信**:
- **数据库**: qqbot-core → qqbot-mysql:3306
- **QQ协议**: qqbot-core → napcat:3001 (WebSocket)
- 使用容器名作为主机名，自动DNS解析

## HTTP流量监控 - 透明代理

基于mitmproxy的透明代理，通过iptables实现零侵入式流量监控。

### ⭐ 推荐使用Python CLI工具
```bash
# 安装依赖（首次使用）
pip3 install click colorama

# 查看状态
python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py status

# 启动mitmproxy + 应用iptables（推荐）
python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py start --iptables

# 停止mitmproxy + 清理iptables（推荐）
python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py stop --cleanup

# 重启服务
python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py restart

# 查看日志
tail -f modules/http-traffic-monitor/transparent-proxy/mitmproxy-data/logs/mitmproxy-*.log
```

**优点**: 解决字符集问题、统一命令入口、彩色输出、配置持久化

**数据流**: `容器 → iptables (80/443→15001) → mitmproxy → Clash (7890) → Internet`

**详细文档**: `@docs/MITMPROXY_STARTUP_GUIDE.md`

## AI功能配置

### 实时LLM参数配置系统
支持通过管理界面实时调整AI参数，配置立即生效，无需重启服务。

**核心配置**:
- **generationConfig**: temperature, topP, maxOutputTokens
- **thinkingConfig**: thinkingBudget, includeThoughts
- **toolsConfig**: 预定义工具选择
- **googleSearchConfig**: 实时搜索集成

**管理API**: `http://localhost:9080/api/llm-config/`

**相关文档**:
- `@docs/REALTIME_LLM_CONFIG_GUIDE.md` - 实时配置使用指南
- `@docs/CONFIGURABLE_LLM_GUIDE.md` - 完整LLM功能说明
- `@docs/DOCKER_LLM_CONFIG_DEPLOY.md` - Docker部署指南

## 开发规范

### Git提交规范
提交代码时必须遵循.gitignore配置，避免提交不必要的文件。

**重要规则**:
- 使用 `git add` 添加特定文件，而不是 `git add .`
- 提交前检查 `git status` 确保不包含以下内容：
  - `resource/napcat_qq_data/` (QQ数据文件，权限敏感)
  - `logs/` 目录下的日志文件
  - `node_modules/`, `dist/`, `build/` 等构建产物
  - `.env` 等环境配置文件

**推荐提交流程**:
```bash
# 1. 查看变更状态
git status

# 2. 仅添加相关文件
git add <specific-files>

# 3. 提交（自动包含Claude Code标识）
git commit -m "feat: 描述变更内容"
```

### 消息处理API规范
- **规范文档**: `@docs/MESSAGE_FLOW_API_SPECIFICATION.md`
- **验证脚本**: `docker exec qqbot-qqbot-core node test_message_flow_api_complete.js`
- 所有消息处理相关开发必须遵循规范并验证

### 架构文档
- **PlantUML架构图**: `@docs/ARCHITECTURE_PLANTUML.md` (完整系统架构、流程图、数据流)
- **部署指南**: `@DOCKER.md`
- **设计文档**: `@docs/CONVERSATION_MONITORING_DESIGN.md`, `@docs/GROUP_CHAT_BOT_MEMORY_DESIGN.md`

### 调试和故障排除
```bash
# 查看容器状态
docker ps
docker logs qqbot-qqbot-core

# 网络连接验证
./scripts/verify-network.sh
docker exec qqbot-qqbot-core nslookup napcat

# 健康检查
curl http://localhost:8080/health
curl http://localhost:8081/health
curl http://localhost:9080/api/health

# 环境重置
./scripts/docker-deploy.sh all stop
./scripts/docker-deploy.sh all clean
./scripts/docker-deploy.sh all build && ./scripts/docker-deploy.sh all run
```

### WSL2特殊问题
**Docker TLS证书验证失败**:
```bash
# 临时绕过TLS验证
docker pull --disable-content-trust hello-world
docker build --disable-content-trust -t image-name .

# 永久设置
export DOCKER_CONTENT_TRUST=0
export DOCKER_TLS_VERIFY=0
```

## 模块文档

每个模块都有独立的CLAUDE.md文档：
- `modules/qqbot-core/CLAUDE.md` - 核心服务详细文档
- `modules/http-api/CLAUDE.md` - API网关文档
- `modules/admin-panel/backend/CLAUDE.md` - 管理后端文档
- `modules/admin-panel/frontend/CLAUDE.md` - 管理前端文档
- `modules/http-traffic-monitor/CLAUDE.md` - 流量监控模块文档

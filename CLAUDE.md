# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- **logging-service.ts**: 结构化日志系统，Trace ID支持
- **human-like-message-processor.ts**: 人性化消息处理架构

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
docker exec qqbot-qqbot-core npm run lint
```

### Python脚本管理 (备用方式)
```bash
# 安装依赖并启动所有模块
npm run start

# 单独管理模块
npm run dev:qqbot-core
npm run build:all
npm run test:all
```

## 数据库架构

### 数据库连接
- **主机**: localhost:3306
- **数据库**: qqbot_db
- **用户**: qqbot_user/qqbot_password

### 核心表结构
- **conversations**: AI对话历史，trace_id关联
- **api_tokens**: Gemini API Token管理，model_blacklist JSON字段
- **agent_prompts**: AI Agent提示词配置，model_name和allowed_token_ids
- **websocket_logs**: WebSocket消息追踪，trace_id关联
- **llm_call_logs**: LLM调用日志，性能指标

## 开发工作流

### 架构特点
- **完全Docker化**: 开发和生产都使用Docker部署，环境一致
- **宿主机网络**: 容器直接使用localhost通信，零延迟
- **消息队列**: 支持异步处理和批量优化
- **Trace ID追踪**: 完整的消息处理链路标识

### 调试方法
- **日志查看**: `docker logs -f qqbot-qqbot-core`
- **容器调试**: `docker exec -it qqbot-qqbot-core /bin/sh`
- **前端调试**: Playwright自动化测试 + F12开发者工具
- **API测试**: `GET /health` 健康检查端点

## 配置管理

### 环境变量
- **数据库**: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME
- **QQ机器人**: BOT_QQ_NUMBER, ONEBOT_WS_URL
- **AI服务**: GEMINI_API_KEY, AI_MODEL_NAME

### 端口规划
- 8080: HTTP API Gateway
- 8081: QQBot Core
- 9080: Admin Backend API
- 3003: Admin Frontend
- 3306: MySQL Database

## 核心特性

### AI智能对话
- **模型**: Google Gemini (2.5-flash/1.5-pro)
- **Token管理**: Model-aware选择，健康检查，5分钟黑名单
- **智能引擎**: 决策引擎、人格引擎、上下文引擎
- **链路追踪**: Trace ID完整追踪，性能监控

## 开发规范

### 消息流程API验证
- **规范文档**: `MESSAGE_FLOW_API_SPECIFICATION.md`
- **验证脚本**: `docker exec qqbot-qqbot-core node test_message_flow_api_complete.js`
- **强制要求**: 所有消息处理相关开发必须先读规范，后验证

### 关键文件和路径
- **完整部署指南**: `@DOCKER.md`
- **模块子文档**: `@modules/*/CLAUDE.md`
- **日志目录**: `modules/*/resources/logs/`

### 故障排除
```bash
# 环境重置
./scripts/docker-deploy.sh all stop && ./scripts/docker-deploy.sh all clean
./scripts/docker-deploy.sh all build && ./scripts/docker-deploy.sh all run

# 常见问题
docker ps                           # 检查容器状态
docker logs qqbot-qqbot-core       # 查看服务日志
curl http://localhost:8080/health  # 测试服务健康
```

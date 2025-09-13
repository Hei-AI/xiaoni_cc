# QQ Bot Docker 容器化部署指南

## 概述

本项目采用微服务架构，支持完整的Docker容器化部署。所有4个核心模块均已容器化，支持网络隔离和独立部署。

## 🎯 最新架构 (2025-09-13)

**宿主机网络架构** - 最优性能和网络隔离方案：

```
🌐 QQ智能机器人完整容器化系统  
┌─────────────────────────────────────────────────┐
│            🏠 宿主机网络 (host)                  │
├─────────────────────────────────────────────────┤
│  ✅ QQBot Core        :8081  (智能对话核心)      │
│  ✅ HTTP Gateway      :8080  (统一API入口)       │  
│  ✅ Admin Backend     :9080  (管理后端API)       │
│  ✅ Admin Frontend    :3003  (Web管理界面)       │
│                                                 │
│  📡 直接访问 → localhost:3306 (MySQL数据库)      │
│  📡 直接访问 → localhost:3001 (NapCat QQ协议)    │
└─────────────────────────────────────────────────┘
        │                           │
        ▼                           ▼
┌─────────────────┐     ┌─────────────────┐
│ MySQL Database  │     │ NapCat Service  │
│ (独立网络隔离)   │     │ (独立网络隔离)   │  
└─────────────────┘     └─────────────────┘
```

## 模块列表

### 1. HTTP API Gateway (端口: 8080)
- **职责**: 统一外部API访问入口
- **镜像**: `qqbot-http-api`
- **依赖**: QQBot Core

### 2. QQBot Core (端口: 8081) 
- **职责**: 智能机器人核心服务
- **镜像**: `qqbot-core`
- **依赖**: MySQL数据库

### 3. Admin Panel Backend (端口: 9080)
- **职责**: 管理后端API服务
- **镜像**: `qqbot-admin-backend`  
- **依赖**: MySQL数据库

### 4. Admin Panel Frontend (端口: 3003)
- **职责**: 管理前端界面 (React + Nginx)
- **镜像**: `qqbot-admin-frontend`
- **依赖**: Admin Panel Backend
- **特性**: 多阶段构建、静态资源优化、API代理

## 快速开始

### 前置条件

1. **Docker环境**: 安装Docker (推荐20.10+)
2. **数据库服务**: MySQL容器或外部数据库
3. **QQ协议服务**: NapCat容器 (OneBot 11协议)
4. **网络要求**: 容器需访问宿主机服务

### 🚀 一键部署脚本

使用项目提供的部署脚本快速启动：

```bash
# 构建所有镜像
./scripts/docker-deploy.sh all build

# 启动所有服务
./scripts/docker-deploy.sh all run

# 检查服务状态  
./scripts/docker-deploy.sh all status

# 停止所有服务
./scripts/docker-deploy.sh all stop
```

### 单模块部署

#### 1. HTTP API Gateway

```bash
# 构建镜像 (从项目根目录)
docker build -f modules/http-api/Dockerfile -t qqbot-http-api modules/http-api

# 运行容器 (宿主机网络模式)
docker run -d \
  --name qqbot-http-api \
  --network host \
  -v "$(pwd)/logs/http-api:/app/logs" \
  -e HTTP_PORT=8080 \
  -e LOG_LEVEL=info \
  --restart unless-stopped \
  qqbot-http-api
```

**特性**:
- 宿主机网络模式，直接访问localhost:8081
- 自动代理请求到QQBot Core
- 统一外部API访问入口

#### 2. QQBot Core ⭐ 核心服务

```bash
# 构建镜像 (从项目根目录)
docker build -f modules/qqbot-core/Dockerfile -t qqbot-qqbot-core modules/qqbot-core

# 运行容器 (宿主机网络模式)
docker run -d \
  --name qqbot-qqbot-core \
  --network host \
  -v "$(pwd)/logs/qqbot-core:/app/logs" \
  -v "$(pwd)/modules/qqbot-core/resources/config:/app/resources/config" \
  -e MYSQL_HOST=localhost \
  -e MYSQL_PORT=3306 \
  -e MYSQL_USER=qqbot_user \
  -e MYSQL_PASSWORD=qqbot_password \
  -e MYSQL_DATABASE=qqbot_db \
  -e WEBSOCKET_HOST=127.0.0.1 \
  -e WEBSOCKET_PORT=3001 \
  -e WEBSOCKET_ACCESS_TOKEN=w@123456 \
  -e HTTP_PORT=8081 \
  -e LOG_LEVEL=info \
  --restart unless-stopped \
  qqbot-qqbot-core
```

**重要特性**:
- **智能引擎**: Stage 1 决策引擎、人格引擎、上下文引擎
- **网络配置**: 宿主机网络直接访问MySQL和NapCat
- **环境变量**: 使用MYSQL_*前缀 (与代码一致)
- **WebSocket连接**: 自动连接NapCat OneBot服务

#### 3. Admin Panel Backend

```bash
# 构建镜像 (从项目根目录)
docker build -f modules/admin-panel/backend/Dockerfile -t qqbot-admin-backend modules/admin-panel/backend

# 运行容器 (宿主机网络模式)
docker run -d \
  --name qqbot-admin-backend \
  --network host \
  -v "$(pwd)/logs/admin-backend:/app/logs" \
  -v "$(pwd)/modules/admin-panel/backend/resources/uploads:/app/resources/uploads" \
  -e MYSQL_HOST=localhost \
  -e MYSQL_PORT=3306 \
  -e MYSQL_USER=qqbot_user \
  -e MYSQL_PASSWORD=qqbot_password \
  -e MYSQL_DATABASE=qqbot_db \
  -e ADMIN_PORT=9080 \
  --restart unless-stopped \
  qqbot-admin-backend
```

**管理功能**:
- 对话历史查看和分析
- LLM调用链路追踪 
- Token使用统计和健康检查
- 系统监控和调试接口

#### 4. Admin Panel Frontend 🌐

```bash
# 构建镜像 (从项目根目录)
docker build -f modules/admin-panel/frontend/Dockerfile -t qqbot-admin-frontend modules/admin-panel/frontend

# 运行容器 (宿主机网络模式)
docker run -d \
  --name qqbot-admin-frontend \
  --network host \
  -v "$(pwd)/logs/admin-frontend:/app/logs" \
  --restart unless-stopped \
  qqbot-admin-frontend
```

**前端特性**:
- **React + TypeScript**: 现代化管理界面
- **多阶段构建**: Node.js构建 → Nginx服务
- **API代理**: 自动代理到localhost:9080后端
- **访问地址**: http://localhost:3003
- **静态资源优化**: Gzip压缩、缓存策略

## 环境变量配置

### 通用环境变量
```bash
NODE_ENV=production
LOG_LEVEL=info  # debug, info, warn, error
TZ=Asia/Shanghai
```

### 数据库环境变量
```bash
# QQBot Core和Admin Backend使用
MYSQL_HOST=localhost
MYSQL_PORT=3306  
MYSQL_USER=qqbot_user
MYSQL_PASSWORD=qqbot_password
MYSQL_DATABASE=qqbot_db
```

### QQ机器人环境变量
```bash
BOT_QQ_NUMBER=1129974489
WEBSOCKET_HOST=localhost       # 容器内使用localhost访问NapCat
WEBSOCKET_PORT=3001
WEBSOCKET_ACCESS_TOKEN=w@123456
GEMINI_API_KEY=your_gemini_api_key
AI_MODEL_NAME=gemini-2.5-flash
```

## 日志管理

### 日志目录结构
```
logs/
├── http-api/          # HTTP API Gateway日志
├── qqbot-core/        # QQBot Core日志  
├── admin-backend/     # Admin Backend日志
└── admin-frontend/    # Admin Frontend日志 (nginx访问日志)
```

### 日志挂载
每个容器的日志都挂载到本地对应目录，便于调试和监控：

```bash
# 查看实时日志
tail -f logs/qqbot-core/*.log

# 查看容器日志
docker logs -f qqbot-core
```

## 容器管理

### 健康检查
所有容器都配置了健康检查：

```bash
# 检查容器健康状态
docker ps --format "table {{.Names}}\t{{.Status}}"

# 查看健康检查详情
docker inspect --format='{{json .State.Health}}' qqbot-core
```

### 容器重启策略
- 策略: `unless-stopped`
- 自动重启: 容器异常退出时自动重启
- 手动停止: `docker stop` 后不会自动重启

### 批量操作脚本

```bash
# 停止所有QQ Bot容器
docker stop qqbot-core qqbot-http-api qqbot-admin-backend qqbot-admin-frontend

# 删除所有QQ Bot容器
docker rm qqbot-qqbot-core qqbot-http-api qqbot-admin-backend qqbot-admin-frontend

# 删除所有QQ Bot镜像
docker rmi qqbot-qqbot-core qqbot-http-api qqbot-admin-backend qqbot-admin-frontend

# 使用部署脚本批量管理
./scripts/docker-deploy.sh all stop     # 停止所有服务
./scripts/docker-deploy.sh all remove   # 删除所有容器
./scripts/docker-deploy.sh all clean    # 清理镜像和数据
```

## 开发调试

### 开发环境运行
开发时建议直接使用npm命令，生产环境使用Docker：

```bash
# 开发环境
npm run dev:qqbot-core
npm run dev:http-api
npm run dev:admin-backend
npm run dev:admin-frontend

# 生产环境
docker run ... (见上述命令)
```

### 调试容器
```bash
# 进入容器调试
docker exec -it qqbot-core /bin/sh

# 查看容器内部文件
docker exec qqbot-core ls -la /app

# 查看容器内环境变量
docker exec qqbot-core env
```

## 网络配置

### 🏠 宿主机网络架构

**架构优势**:
- **零延迟通信**: 直接localhost访问，无容器网络开销
- **完美网络隔离**: MySQL和NapCat保持独立网络
- **简化配置**: 无需复杂的网络桥接和代理
- **生产就绪**: 高性能、易维护的部署方案

**网络连接**:
- 容器服务 → localhost:3306 (MySQL)
- 容器服务 → localhost:3001 (NapCat)
- 服务间直接通信无网络开销

### 端口映射 (宿主机网络模式)
- **HTTP API Gateway**: localhost:8080 (统一API入口)
- **QQBot Core**: localhost:8081 (核心服务API)  
- **Admin Backend**: localhost:9080 (管理后端API)
- **Admin Frontend**: localhost:3003 (Web管理界面)

### 🌐 服务访问地址
- **管理界面**: http://localhost:3003
- **HTTP API**: http://localhost:8080/api/
- **管理API**: http://localhost:9080/api/
- **核心服务**: http://localhost:8081/health

## 故障排除

### 常见问题

1. **容器无法启动**
   ```bash
   # 查看详细错误信息
   docker logs qqbot-core
   ```

2. **健康检查失败**
   ```bash
   # 检查端口是否正确暴露
   docker port qqbot-core
   
   # 手动测试健康检查
   docker exec qqbot-core curl -f http://localhost:8081/health
   ```

3. **日志目录权限问题**
   ```bash
   # 确保日志目录有写权限
   chmod -R 755 logs/
   ```

4. **数据库连接失败**
   - 检查MYSQL_HOST=localhost (宿主机网络模式)
   - 确认MySQL容器端口3306已映射到宿主机
   - 验证数据库用户权限和连接数限制
   - 检查防火墙设置

5. **WebSocket连接失败**
   - 确认NapCat服务运行在localhost:3001
   - 检查WEBSOCKET_ACCESS_TOKEN配置
   - 验证OneBot协议版本兼容性

### 监控命令
```bash
# 实时监控容器资源使用
docker stats

# 查看容器详细信息
docker inspect qqbot-core

# 查看容器网络
docker network ls
docker network inspect bridge
```
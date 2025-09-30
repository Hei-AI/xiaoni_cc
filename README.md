# QQ智能机器人 - 4模块独立架构

基于OneBot 11协议的智能QQ机器人，采用4个独立模块的架构设计，支持独立开发和部署。

## 🏗️ 项目架构

```
qq_bot/
├── modules/
│   ├── http-api/           # 模块1: HTTP API网关服务 (端口: 8080)
│   ├── qqbot-core/         # 模块2: QQ机器人核心服务 (端口: 8081)
│   └── admin-panel/        # 模块3&4: 管理面前后端
│       ├── backend/        #   管理面后端API (端口: 9080)
│       └── frontend/       #   管理面前端界面 (端口: 3000)
├── database/               # 共享数据库资源
├── shared/                 # 共享工具和类型 (可选)
├── docker-compose.yml      # 完整服务编排
└── CLAUDE.md              # Claude Code开发指导
```

## 🔧 各模块功能

### 1. HTTP API Gateway (`modules/http-api/`)
- **职责**: 外部HTTP请求接入点，消息路由和转发
- **端口**: 8080
- **独立性**: 完全独立，可替换为任何API网关
- **日志**: `modules/http-api/resources/logs/`

### 2. QQBot Core Service (`modules/qqbot-core/`)
- **职责**: OneBot WebSocket连接，AI对话，核心业务逻辑
- **端口**: 8081 (内部通信)
- **独立性**: 核心服务，可独立运行和扩展
- **资源**: 独立的napcat_qq_data、logs目录
- **日志**: `modules/qqbot-core/resources/logs/`

### 3. Admin Backend (`modules/admin-panel/backend/`)
- **职责**: 管理员API，系统配置，数据分析
- **端口**: 9080
- **独立性**: 独立的Express服务
- **日志**: `modules/admin-panel/backend/resources/logs/`

### 4. Admin Frontend (`modules/admin-panel/frontend/`)
- **职责**: 管理员控制台，实时数据展示
- **端口**: 3000
- **独立性**: 纯静态资源，可用任何Web服务器托管
- **日志**: `modules/admin-panel/frontend/resources/logs/`

## 🚀 快速开始 (🐳 全面Docker化部署)

### 🎯 一键部署 (推荐方式)
```bash
# 构建所有服务镜像
./scripts/docker-deploy.sh all build

# 启动所有服务
./scripts/docker-deploy.sh all run

# 查看服务状态
./scripts/docker-deploy.sh all status

# 查看实时日志
docker logs -f qqbot-qqbot-core
docker logs -f qqbot-http-api
```

### 🐳 Docker Compose 部署
```bash
# 启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f [service-name]

# 停止服务
docker-compose down
```

### 🔧 开发环境说明

**📋 架构特点**: 本项目采用完全容器化架构，开发和生产都使用Docker部署。

Docker化开发的特点：
1. 使用Docker容器运行所有服务
2. 通过容器挂载源码目录实现热重载
3. 使用`docker logs`查看实时日志进行调试
4. 使用`docker exec`进入容器进行深度调试
5. 开发和生产环境完全一致

## 🔗 服务端点

- **HTTP API Gateway**: http://localhost:8080
  - `GET /health` - 健康检查
  - `GET /api/status` - 服务状态

- **QQBot Core**: http://localhost:8081 (内部)
  - 内部API，不对外暴露

- **Admin Backend**: http://localhost:9080
  - 管理员API接口

- **Admin Frontend**: http://localhost:3000
  - 管理员控制台界面

## 📊 数据库

所有模块共享MySQL数据库资源：
- **主机**: localhost:3306
- **数据库**: qqbot_db
- **用户**: qqbot / qqbot_password

## 📝 日志系统

每个模块都有独立的日志目录：
- `modules/http-api/resources/logs/`
- `modules/qqbot-core/resources/logs/`
- `modules/admin-panel/backend/resources/logs/`
- `modules/admin-panel/frontend/resources/logs/`

## 🛠️ 开发指南 (🐳 Docker-First架构)

### Docker化开发流程
1. **构建开发环境**: `./scripts/docker-deploy.sh all build`
2. **启动开发服务**: `./scripts/docker-deploy.sh all run`
3. **实时日志调试**: `docker logs -f qqbot-qqbot-core`
4. **容器内调试**: `docker exec -it qqbot-qqbot-core /bin/sh`

### 代码热重载开发
```bash
# 挂载源码目录实现热重载
docker run -d \
  --name qqbot-dev \
  --network host \
  -v "$(pwd)/modules/qqbot-core/src:/app/src" \
  -v "$(pwd)/logs:/app/logs" \
  qqbot-qqbot-core
```

### 容器内测试
```bash
# 在容器内执行测试
docker exec qqbot-qqbot-core npm test
docker exec qqbot-admin-backend npm test

# 批量测试 (CI/CD环境)
./scripts/docker-deploy.sh all test
```

### 服务间通信架构
- **宿主机网络模式**: 所有容器共享localhost网络
- **零延迟通信**: 容器间直接localhost访问
- **统一端口管理**: 8080(API), 8081(Core), 9080(Admin), 3003(Frontend)
- **数据库连接**: 所有服务直接访问localhost:3306

## 📁 目录结构详情

每个模块包含：
- `src/` - TypeScript源码
- `tests/` - 测试文件
- `resources/` - 资源文件（config、logs等）
- `docs/` - 文档
- `package.json` - 依赖管理
- `tsconfig.json` - TypeScript配置
- `Dockerfile` - 容器化配置

## 📚 延伸阅读

- [HTTP流量监控模块说明](modules/http-traffic-monitor/README.md)
- [WSL2 透明代理部署流程](docs/TRANSPARENT_PROXY_IMPLEMENTATION.md)

## 🤝 贡献指南

1. Fork项目
2. 选择要修改的模块
3. 在对应模块目录下进行开发
4. 确保模块独立测试通过
5. 提交Pull Request

## 📄 许可证

MIT License

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

## 🚀 快速开始

### 使用Docker Compose (推荐)
```bash
# 启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f [service-name]
```

### 独立开发模式

#### 1. HTTP API模块
```bash
cd modules/http-api
npm install
cp .env.example .env
npm run dev
```

#### 2. QQBot核心模块
```bash
cd modules/qqbot-core
npm install
cp .env.example .env
npm run dev
```

#### 3. 管理面后端
```bash
cd modules/admin-panel/backend
npm install
cp .env.example .env
npm run dev
```

#### 4. 管理面前端
```bash
cd modules/admin-panel/frontend
npm install
npm run dev
```

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

## 🛠️ 开发指南

### 各模块独立开发
1. 进入对应模块目录
2. 复制 `.env.example` 为 `.env`
3. 配置环境变量
4. `npm install && npm run dev`

### 模块间通信
- HTTP API ↔ QQBot Core: HTTP API调用
- Admin Backend ↔ Database: 直接数据库连接
- Admin Frontend ↔ Admin Backend: REST API
- QQBot Core ↔ Database: 直接数据库连接

### 测试
```bash
# 各模块独立测试
cd modules/[module-name]
npm test
```

## 📁 目录结构详情

每个模块包含：
- `src/` - TypeScript源码
- `tests/` - 测试文件
- `resources/` - 资源文件（config、logs等）
- `docs/` - 文档
- `package.json` - 依赖管理
- `tsconfig.json` - TypeScript配置
- `Dockerfile` - 容器化配置

## 🤝 贡献指南

1. Fork项目
2. 选择要修改的模块
3. 在对应模块目录下进行开发
4. 确保模块独立测试通过
5. 提交Pull Request

## 📄 许可证

MIT License

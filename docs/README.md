# QQ智能机器人 - 前后端分离架构

## 项目概述

基于OneBot 11协议的智能QQ机器人，采用TypeScript构建的现代化前后端分离架构。集成Gemini AI智能对话，支持需求管理和Claude Code开发助手功能。

## 项目结构

```
qq_bot_project/
├── backend/           # 后端TypeScript应用
├── frontend/          # 前端HTML/CSS/JS应用  
├── shared/           # 前后端共享代码
├── docs/             # 项目文档
├── scripts/          # 项目级脚本
└── docker/           # Docker配置
```

## 快速开始

### 1. 环境要求
- Node.js >= 16.0.0
- npm >= 8.0.0
- MySQL >= 8.0

### 2. 项目初始化
```bash
# 克隆项目
git clone <repository-url>
cd qq_bot

# 运行初始化脚本
./scripts/setup.sh

# 或手动安装依赖
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

### 3. 配置环境
```bash
# 配置后端环境变量
cp backend/.env.example backend/.env
# 编辑 backend/.env 配置数据库连接等参数
```

### 4. 启动开发环境
```bash
# 同时启动前后端开发服务器
npm run dev

# 或分别启动
npm run dev:backend   # 后端 http://localhost:8080
npm run dev:frontend  # 前端 http://localhost:3000
```

## 开发指南

### 后端开发
- **技术栈**: TypeScript + Express.js + MySQL2 + WebSocket
- **开发目录**: `backend/src/`
- **API文档**: `docs/api/`
- **测试**: `backend/tests/`

### 前端开发  
- **技术栈**: HTML5 + CSS3 + JavaScript + HTTP Server
- **开发目录**: `frontend/src/`
- **静态资源**: `frontend/public/`
- **测试**: `frontend/tests/`

### 共享代码
- **类型定义**: `shared/types/`
- **常量配置**: `shared/constants/`
- **工具函数**: `shared/utils/`

## 构建和部署

### 构建项目
```bash
# 构建整个项目
npm run build

# 分别构建
npm run build:backend   # 输出: backend/build/dist/
npm run build:frontend  # 输出: frontend/build/
```

### Docker部署
```bash
# 使用Docker Compose
docker-compose up -d
```

## 测试

```bash
# 运行所有测试
npm test

# 分别测试
npm run test:backend
npm run test:frontend
```

## 文档

- [API文档](./api/README.md)
- [前端开发指南](./frontend/README.md)
- [后端开发指南](./backend/README.md)
- [部署指南](./deployment/README.md)

## 贡献指南

1. Fork项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交变更 (`git commit -m 'Add some AmazingFeature'`)
4. 推送分支 (`git push origin feature/AmazingFeature`)
5. 创建Pull Request

## 许可证

本项目采用MIT许可证。详见 [LICENSE](../LICENSE) 文件。
# CLAUDE.md - QQ智能机器人开发指导

本文件为Claude Code提供QQ智能机器人项目的开发指导和架构说明。

## 🏗️ 项目架构概述

基于OneBot 11协议的智能QQ机器人，采用4个独立模块的微服务架构设计，支持独立开发和部署。

### 核心设计原则
- **模块独立性**: 4个模块完全独立，各有独立的资源、日志、测试目录
- **服务间通信**: 仅通过HTTP API和共享数据库通信，无文件共享
- **技术栈统一**: 全栈TypeScript + MySQL + Docker容器化
- **可独立部署**: 每个模块支持独立开发、测试、部署

## 📁 项目结构

```
qq_bot/
├── modules/                    # 4个独立模块
│   ├── http-api/              # 模块1: HTTP API网关 (8080)
│   │   ├── src/
│   │   ├── tests/
│   │   ├── resources/logs/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── Dockerfile
│   ├── qqbot-core/            # 模块2: QQ机器人核心服务 (8081)
│   │   ├── src/
│   │   │   ├── engines/       # Stage 1 智能引擎层 (新增)
│   │   │   │   ├── decision-engine.ts    # 决策引擎
│   │   │   │   ├── context-engine.ts     # 上下文引擎
│   │   │   │   └── persona-engine.ts     # 人格化引擎
│   │   │   ├── services/      # 核心服务层
│   │   │   │   ├── websocket-client.ts
│   │   │   │   ├── database.ts
│   │   │   │   ├── ai-service.ts
│   │   │   │   ├── session-manager.ts
│   │   │   │   └── remote-claude-service.ts
│   │   │   ├── utils/         # 工具层
│   │   │   ├── config/        # 配置管理
│   │   │   ├── types/         # TypeScript类型定义
│   │   │   └── index.ts       # 主应用入口
│   │   ├── tests/
│   │   ├── resources/
│   │   │   ├── logs/          # 独立日志目录
│   │   │   └── napcat_qq_data/
│   │   ├── logs/              # 实际使用的日志目录
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── Dockerfile
│   └── admin-panel/           # 模块3&4: 管理面前后端
│       ├── backend/           # 管理面后端API (9080)
│       │   ├── src/
│       │   ├── tests/
│       │   ├── resources/logs/
│       │   ├── package.json
│       │   └── Dockerfile
│       └── frontend/          # 管理面前端界面 (3003)
│           ├── public/
│           ├── src/
│           ├── tests/
│           └── resources/logs/
├── scripts/                   # 自动化脚本目录
│   ├── start_modules.py      # Python启动管理器 (主要)
│   ├── process-manager.js    # Node.js启动管理器 (备用)
│   └── module_pids.json      # 进程ID记录文件
├── database/                  # 共享数据库资源
│   ├── schema/               # 数据库架构定义
│   └── migrations/           # 数据库迁移脚本
├── requirements.txt          # Python依赖文件
├── package.json             # 项目根配置和npm scripts
├── docker-compose.yml       # 完整服务编排
└── CLAUDE.md               # Claude Code开发指导
```

## 🔧 模块详细说明

### 模块1: HTTP API Gateway (`modules/http-api/`)
- **职责**: 外部HTTP请求接入点，消息路由和转发
- **端口**: 8080
- **技术栈**: Express.js + TypeScript
- **独立性**: 完全独立，可替换为任何API网关
- **主要文件**:
  - `src/index.ts`: Express服务器主入口
  - 提供健康检查和API状态端点

### 模块2: QQBot Core Service (`modules/qqbot-core/`)
- **职责**: OneBot WebSocket连接，AI对话，核心业务逻辑
- **端口**: 8081 (内部通信)
- **技术栈**: TypeScript + WebSocket + Gemini AI
- **Stage 1 智能引擎** (新增):
  - `DecisionEngine`: 智能决策引擎，判断是否回复消息
  - `ContextEngine`: 上下文构建引擎，分析消息历史和语义
  - `PersonaEngine`: 人格化引擎，生成拟人化回复
- **核心服务**:
  - `WebSocketClient`: OneBot协议WebSocket连接管理
  - `DatabaseManager`: MySQL2连接池管理
  - `AIService`: Gemini AI集成和意图分析
  - `SessionManager`: 会话状态管理
  - `RemoteClaudeService`: Claude Code集成服务
- **主要文件**:
  - `src/index.ts`: QQBot主应用类，事件驱动架构
  - `src/engines/*`: Stage 1智能引擎系统
  - `src/services/*`: 核心业务服务层
  - `src/utils/*`: 工具和辅助功能
  - `src/types/index.ts`: 完整的TypeScript类型定义

### 模块3: Admin Backend (`modules/admin-panel/backend/`)
- **职责**: 管理员API，系统配置，数据分析
- **端口**: 9080
- **技术栈**: Express.js + TypeScript + MySQL
- **独立性**: 独立的Express服务，仅与数据库通信

### 模块4: Admin Frontend (`modules/admin-panel/frontend/`)
- **职责**: 管理员控制台，实时数据展示
- **端口**: 3000
- **技术栈**: 静态HTML/CSS/JavaScript
- **部署**: Nginx容器托管，纯静态资源

## 🚀 开发工作流

### 快速启动 (推荐方式)
```bash
# 方式1: 一键启动所有模块
npm start

# 方式2: 使用Python脚本
python3 scripts/start_modules.py start

# 方式3: 完整部署流程
npm run deploy  # 停止→安装依赖→启动

# 检查服务状态
npm run status
```

### 环境设置
```bash
# 安装Python依赖 (一次性)
pip3 install -r requirements.txt

# 安装所有模块依赖
npm run install:all
# 或使用Python脚本并行安装
python3 scripts/start_modules.py install

# 使用Docker Compose启动完整环境
docker-compose up -d
```

### 模块独立开发
每个模块都有完整的开发工具链：
```bash
cd modules/qqbot-core  # 或其他模块
npm run dev          # 开发服务器
npm run build        # TypeScript编译
npm run test         # Jest单元测试
npm run lint         # ESLint代码检查
```

### 核心开发命令
```bash
# 启动所有模块
npm start                                    # 自动启动4个模块
python3 scripts/start_modules.py start     # Python方式启动
node scripts/process-manager.js start      # Node.js方式启动

# 停止所有模块
npm stop                                    # 停止所有服务
python3 scripts/start_modules.py stop      # Python方式停止

# 单独模块开发
cd modules/qqbot-core
npm run dev          # ts-node开发服务器，支持热重载
npm run build        # 编译到dist/目录
npm start           # 生产环境运行

# HTTP API模块开发  
cd modules/http-api
npm run dev          # Express开发服务器

# 管理面后端开发
cd modules/admin-panel/backend
npm run dev          # Express API开发服务器
```

## 🔗 服务间通信

### 端口映射
- **HTTP API Gateway**: http://localhost:8080
- **QQBot Core**: http://localhost:8081 (内部)
- **Admin Backend**: http://localhost:9080
- **Admin Frontend**: http://localhost:3003 ⚠️ (注意端口变更)
- **MySQL Database**: localhost:3306

⚠️ **重要说明**: Admin Frontend默认端口由3000改为3003，避免与其他服务冲突。

### 通信策略
- **HTTP API ↔ QQBot Core**: HTTP REST API调用
- **Admin Backend ↔ Database**: 直接MySQL连接
- **Admin Frontend ↔ Admin Backend**: RESTful API
- **QQBot Core ↔ Database**: 直接MySQL连接池

## 📊 数据库架构

### 共享数据库资源
所有模块共享单一MySQL数据库：
- **数据库**: `qqbot_db`
- **用户**: `qqbot_user / qqbot_password` ⚠️ **重要**: 必须使用 `qqbot_user`，不是 `qqbot`
- **连接方式**: MySQL2连接池

### 数据库配置注意事项
各模块的 `.env` 文件中必须正确配置数据库用户名：
```bash
# 正确的配置
DB_USER=qqbot_user  # ✅ 正确
DB_PASSWORD=qqbot_password

# 常见错误
DB_USER=qqbot  # ❌ 错误，会导致 "Access denied for user 'qqbot'" 错误
```

### 核心数据表
- `conversations`: AI对话历史和会话记录
- `requirements`: 需求管理和处理状态跟踪
- `sessions`: 用户会话状态管理
- `group_chat_settings`: 群聊配置和权限管理
- `bot_status`: 机器人实时状态监控
- `system_logs`: 系统运行日志结构化存储

## 🤖 核心功能系统

### Stage 1 智能响应引擎 ✅ (已实现)
- **DecisionEngine**: 智能决策是否回复消息
  - 规则过滤: @消息、私聊必回
  - AI分析: LLM意图识别和置信度评估
  - 综合决策: 结合规则和AI分析的最终判断
- **ContextEngine**: 上下文构建和语义理解  
  - 消息历史获取和相关性分析
  - 用户信息和群聊信息整合
  - 主题关键词提取和分类
- **PersonaEngine**: 人格化回复生成
  - 多人格侧面动态选择 (技术专家/休闲伙伴/共情倾听者)
  - 自然语言润色和风格统一
  - 分段回复和延迟执行计划

### AI服务集成 (Gemini 2.0 Flash Exp)
- **API调用**: HTTP REST方式，避免ES模块兼容性问题
- **Token管理**: LRU缓存 + 多密钥轮换机制
- **意图分析**: 开发需求智能识别和分类
- **对话生成**: 上下文感知的自然语言响应

### 需求管理系统
- **触发条件**: 仅授权用户私聊，包含开发关键词
- **处理流程**: 意图分析 → 需求存储 → 异步处理 → 结果反馈
- **状态跟踪**: `pending` → `processing` → `completed/failed`
- **Claude Code集成**: 通过RemoteClaudeService实现自动化开发

### 群聊管理
- **权限控制**: 数据库驱动的群聊白名单系统
- **管理命令**: 开启/关闭群聊、添加/移除群聊、群聊列表管理
- **触发机制**: @机器人检测 + 群聊权限验证
- **活跃度统计**: 群聊消息和AI回复数量跟踪

### 会话管理 (SessionManager)
- **会话类型**: `chat`（普通对话）、`requirement`（需求处理）、`reply_chain`（回复链）
- **上下文保持**: 基于用户ID和时间窗口的会话连续性
- **消息关联**: 支持QQ回复消息功能，保持对话上下文

## 📝 日志系统

### 独立日志架构
每个模块都有独立的日志目录：
```
modules/http-api/resources/logs/
modules/qqbot-core/resources/logs/
modules/admin-panel/backend/resources/logs/
modules/admin-panel/frontend/resources/logs/
```

### 日志结构 (Winston)
- **分模块记录**: 按服务划分日志文件
- **结构化格式**: JSON格式，支持查询和分析
- **日志级别**: debug/info/warn/error
- **日志轮转**: 按日期自动轮转

### 核心日志文件 (QQBot Core)
```
modules/qqbot-core/logs/
├── main_YYYY-MM-DD.log              # 主程序日志
├── websocket_YYYY-MM-DD.log         # WebSocket事件日志  
├── database_YYYY-MM-DD.log          # 数据库操作日志
├── ai-service_YYYY-MM-DD.log        # AI服务调用日志
├── session-manager_YYYY-MM-DD.log   # 会话管理日志
├── decision-engine_YYYY-MM-DD.log   # 决策引擎日志 (Stage 1)
├── context-engine_YYYY-MM-DD.log    # 上下文引擎日志 (Stage 1)
├── persona-engine_YYYY-MM-DD.log    # 人格化引擎日志 (Stage 1)
├── http-server_YYYY-MM-DD.log       # HTTP服务器日志
└── token-manager_YYYY-MM-DD.log     # Token管理日志
```

## 🛠️ 开发注意事项

### TypeScript开发最佳实践
- **严格类型检查**: 所有模块启用`strict: true`
- **类型定义**: 完整的接口定义在`src/types/index.ts`
- **路径别名**: 使用`@/*`映射到`src/*`
- **编译目标**: ES2020，Node.js兼容性

### 异步编程模式
- **事件驱动**: WebSocket事件监听和分发
- **Promise/async-await**: 统一异步操作模式
- **错误处理**: 统一错误处理和日志记录
- **连接管理**: 自动重连和连接池管理

### 数据库操作规范
```typescript
// 使用连接池的async/await模式
const connection = await this.database.getConnection();
try {
  await connection.beginTransaction();
  // 数据库操作
  await connection.commit();
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  connection.release();
}
```

### 模块间集成规范
- **无文件共享**: 严格通过HTTP API通信
- **独立配置**: 每个模块独立的.env配置文件
- **独立依赖**: 每个模块独立的package.json
- **独立构建**: 支持单独构建和部署

## 🔧 测试策略

### 测试框架
- **单元测试**: Jest + TypeScript
- **测试目录**: 每个模块独立的`tests/`目录
- **覆盖率**: 目标覆盖率 > 80%

### 测试类型
```bash
# 各模块独立测试
cd modules/qqbot-core
npm test                    # 运行所有测试
npm test -- --coverage    # 覆盖率报告
npm test -- --watch       # 监听模式

# 测试特定文件
npm test tests/services/database.test.ts
```

### 测试分类
- **单元测试**: 核心业务逻辑和工具函数
- **集成测试**: 模块间API通信和数据库操作
- **WebSocket测试**: OneBot协议消息模拟

## 🐳 容器化部署

### Docker Compose架构
```yaml
services:
  mysql:        # 共享数据库
  http-api:     # HTTP API网关 (8080)
  qqbot-core:   # 核心服务 (8081)
  admin-backend: # 管理后端 (9080)
  admin-frontend: # 管理前端 (3000)
```

### 部署命令
```bash
# 启动完整环境
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看特定服务日志
docker-compose logs -f qqbot-core

# 重启特定服务
docker-compose restart qqbot-core
```

## 🚨 故障排除

### 启动失败常见问题
1. **端口被占用 (EADDRINUSE)**:
   ```bash
   # 检查端口占用
   lsof -i :8080  # 或其他端口
   
   # 自动清理端口
   python3 scripts/start_modules.py clean-ports
   ```

2. **依赖包缺失**:
   ```bash
   # 检查常见错误包
   - lru.min (应为 lru-cache)
   - cors, helmet 未安装
   - node_modules 目录不存在
   
   # 解决方案
   python3 scripts/start_modules.py install
   ```

3. **TypeScript编译错误**:
   - HttpServer构造函数参数不匹配
   - 导入路径错误
   - 类型定义缺失

### 服务运行时问题
1. **WebSocket连接失败**: 检查OneBot服务器状态和access_token
2. **数据库连接异常**: 验证MySQL服务状态和连接参数
3. **AI服务异常**: 检查Gemini API密钥配置和网络连接
4. **模块间通信失败**: 验证HTTP端口和服务启动状态
5. **决策引擎不响应**: 检查授权用户ID配置，确认为正确的QQ号
6. **上下文引擎错误**: 检查数据库表是否存在，特别是conversation_sessions表
7. **日志路径问题**: QQBot Core使用logs/目录而非resources/logs/

### 调试命令
```bash
# 服务状态检查
npm run status                       # 检查所有模块状态
curl http://localhost:8080/health    # HTTP API
curl http://localhost:8081/health    # QQBot Core
curl http://localhost:9080/health    # Admin Backend
curl http://localhost:3003           # Admin Frontend

# Stage 1 引擎调试
grep "DecisionEngine initialized" modules/qqbot-core/logs/decision-engine_$(date +%Y-%m-%d).log
grep "Context built successfully" modules/qqbot-core/logs/context-engine_$(date +%Y-%m-%d).log
grep "PersonaEngine enhanced" modules/qqbot-core/logs/main_$(date +%Y-%m-%d).log

# 实时日志监控 (Stage 1)
tail -f modules/qqbot-core/logs/main_$(date +%Y-%m-%d).log
tail -f modules/qqbot-core/logs/decision-engine_$(date +%Y-%m-%d).log
tail -f modules/qqbot-core/logs/context-engine_$(date +%Y-%m-%d).log

# Python脚本调试
python3 -c "import psutil, requests; print('依赖OK')"

# 端口监听检查
netstat -tulnp | grep -E ':(8080|8081|9080|3003)'

# 检查QQBot Core实际运行状态
curl http://localhost:8081/health 2>/dev/null || echo "QQBot Core服务未响应"

# 检查授权用户配置
grep -n "authorized_user_id" modules/qqbot-core/src/engines/decision-engine.ts
```

### 性能监控
- **响应时间**: AI对话响应时间跟踪
- **连接状态**: WebSocket连接稳定性监控
- **数据库性能**: 连接池使用率和查询性能
- **内存使用**: 各服务内存占用监控

## 📚 API文档

### HTTP API Gateway端点
- `GET /health` - 服务健康检查
- `GET /api/status` - 服务状态信息

### QQBot Core内部API
- `POST /api/send_private` - 发送私聊消息
- `POST /api/send_group` - 发送群聊消息
- `GET /api/conversations` - 对话历史查询
- `GET /api/requirements` - 需求管理状态

### Admin Backend API
- 系统配置管理接口
- 数据分析和统计接口
- 用户权限管理接口

#### Token 管理 API (端口: 9080)
- `GET /api/tokens` - 获取所有token列表，包括健康状态和使用统计
- `POST /api/tokens/health-check` - 执行真实的token健康检查 (调用Gemini API验证)
- `POST /api/tokens/health-check-test` - 测试版健康检查 (使用假token进行功能演示)

#### 健康检查实现说明
Token健康检查功能通过实际调用Google Gemini API来验证token是否可用：
```typescript
// 健康检查逻辑示例
const response = await axios.post(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
  {
    contents: [{
      parts: [{ text: "Test health check - respond with 'OK'" }]
    }]
  },
  {
    headers: {
      'X-goog-api-key': token,
      'Content-Type': 'application/json'
    },
    timeout: 10000
  }
);
```

#### 测试命令
```bash
# 获取token列表
curl http://localhost:9080/api/tokens

# 执行健康检查测试 (使用假token演示功能)
curl -X POST http://localhost:9080/api/tokens/health-check-test
```

## ⚠️ 启动和部署常见问题

### 端口冲突问题
- **现象**: 启动时出现 `EADDRINUSE` 错误
- **原因**: 系统中有进程占用了预定义端口 (8080, 8081, 9080, 3000-3003)
- **解决方案**: 
  - 自动清理: `python3 scripts/start_modules.py clean-ports`
  - 手动清理: `lsof -ti :端口号 | xargs kill -9`
  - 修改端口: 在各模块的配置中调整端口设置

### 依赖安装问题
- **现象**: TypeScript编译错误，模块找不到
- **常见错误**:
  - `lru.min` 包名错误，应为 `lru-cache`
  - 缺少 `cors`, `helmet` 等依赖包
  - node_modules目录不存在
- **解决方案**:
  - 并行安装: `python3 scripts/start_modules.py install`
  - 单独安装: `npm run install:all`
  - 检查package.json中的依赖配置

### 模块启动顺序问题  
- **推荐启动顺序**: 
  1. HTTP API Gateway (8080)
  2. QQBot Core (8081) 
  3. Admin Backend (9080)
  4. Admin Frontend (3003)
- **注意事项**: 前端模块需要最后启动以避免端口冲突

### 配置文件不一致问题 ✅ (已修复)
- **端口配置不匹配** (已修复):
  - ✅ QQBot Core正确运行在8081端口
  - ✅ Admin Frontend已统一使用3003端口
- **授权用户ID配置** (已修复):
  - ✅ DecisionEngine中授权用户ID已更新为85178516
- **数据库连接配置** (已修复):
  - ✅ Admin Backend MySQL2连接池配置已优化

### 自动化启动脚本使用
```bash
# Python脚本方式 (推荐)
python3 scripts/start_modules.py start     # 启动所有模块
python3 scripts/start_modules.py stop      # 停止所有模块  
python3 scripts/start_modules.py restart   # 重启所有模块
python3 scripts/start_modules.py status    # 检查状态
python3 scripts/start_modules.py install   # 安装依赖

# Node.js脚本方式 (备用)
node scripts/process-manager.js start

# npm scripts方式
npm start          # 自动启动所有模块
npm stop           # 停止所有模块
npm run restart    # 重启所有模块
npm run status     # 检查状态
npm run deploy     # 完整部署流程
```

## 🔒 安全考虑

### 配置安全
- **敏感信息**: 所有API密钥通过环境变量配置
- **数据库安全**: 使用专用数据库用户，最小权限原则
- **网络隔离**: Docker网络隔离，仅必要端口暴露

### 代码安全
- **输入验证**: 所有用户输入严格验证和过滤
- **SQL注入防护**: 使用参数化查询
- **访问控制**: 基于用户ID的权限验证
- **错误处理**: 避免敏感信息泄露

## 🤝 开发协作

### Git工作流
- **分支策略**: 功能分支开发，main分支保护
- **代码审查**: 所有变更通过Pull Request
- **提交规范**: 使用conventional commits格式

### 模块责任划分
- **HTTP API**: 负责外部接入和路由转发
- **QQBot Core**: 负责核心业务逻辑和AI集成  
- **Admin Backend**: 负责管理功能和数据分析
- **Admin Frontend**: 负责用户界面和交互体验

---

**重要提醒**: 本项目采用4模块独立架构，开发时请注意：
1. 优先编辑现有文件，避免不必要的新文件创建
2. 遵循模块独立性原则，通过API而非文件共享
3. 保持TypeScript严格类型检查和代码质量标准
4. 所有数据库操作使用事务确保一致性
5. 重要变更前确保相关测试通过
- 各模块的开发及修复工作必须通过git worktree模式继续


---

# 下面是本项目的演进计划和目标

- @docs/final_roadmap.md
- @docs/evolution_roadmap.md
- @docs/roadmap_v1.md
- @docs/roadmap_v2.md
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# QQ智能机器人 - TypeScript异步事件驱动架构

## 项目概述
基于OneBot 11协议的智能QQ机器人，采用TypeScript构建的现代化异步事件驱动架构。集成Gemini AI智能对话，支持需求管理和Claude Code开发助手功能。

## 核心架构 

### 主要组件依赖关系
```
QQBot (src/index.ts) - 主应用类
├── DatabaseManager (src/services/database.ts) - MySQL2连接池管理
├── WebSocketClient (src/services/websocket-client.ts) - OneBot协议WebSocket客户端  
├── HttpServer (src/services/http-server.ts) - Express.js REST API服务器
├── AIService (src/services/ai-service.ts) - Gemini AI集成和意图分析
└── Logger (src/utils/logger.ts) - Winston结构化日志系统
```

### 事件流处理架构
消息通过以下管道异步处理：
```
QQ消息 → OneBot服务器 → WebSocketClient → QQBot事件分发器
├── handlePrivateMessage() → 需求分析 → AI对话/需求处理
├── handleGroupMessage() → @机器人检测 → AI回复
├── handleNotice() → 群成员变动记录
└── handleRequest() → 自动好友请求处理
```

### TypeScript类型系统
- **严格类型检查**: `strict: true` 配置，编译时错误检测
- **路径别名**: `@/*` 映射到 `src/*`，便于模块导入
- **接口定义**: 完整的QQ消息、数据库实体、配置项类型定义 (`src/types/index.ts`)

## 开发命令

### 基础开发流程
```bash
# 环境设置
npm install
cp .env.example .env  # 配置环境变量

# 开发
npm run dev          # ts-node开发服务器，自动重启
npm run build        # TypeScript编译到dist/
npm run build:watch  # 监听模式编译

# 生产运行
npm start           # 运行编译后的JavaScript
./start_services_ts.sh  # 完整启动脚本（包含数据库检查）
```

### 测试和质量检查
```bash
# 测试
npm test                    # Jest单元测试
npm run test:watch         # 监听模式测试
npm test -- --coverage    # 覆盖率报告

# 代码质量
npm run lint              # ESLint检查
npm run lint:fix         # 自动修复ESLint问题
```

### 单独测试指定模块
```bash
# 测试特定文件
npm test tests/basic.test.ts

# 测试特定模式匹配
npm test -- --testNamePattern="Database Manager"
```

## 核心配置系统

### 环境配置 (.env)
基于 `src/config/index.ts` 的统一配置管理：
- **数据库**: MySQL连接、连接池设置
- **WebSocket**: OneBot服务器连接参数 
- **HTTP**: Express服务器监听配置
- **AI**: Gemini API密钥轮换、授权用户设置
- **日志**: Winston日志级别和文件前缀

### 关键配置项
```typescript
// WebSocket配置 - OneBot协议连接
websocket: {
  host: "127.0.0.1",
  port: 3001, 
  access_token: "w@123456",
  uri: "ws://127.0.0.1:3001?access_token=w@123456"
}

// AI配置 - Gemini集成
ai: {
  gemini_api_keys: ["key1", "key2"],  // 支持多密钥轮换
  authorized_user_id: 85178516,       // 唯一授权需求管理用户
  bot_qq_number: 1129974489           // 机器人QQ号
}
```

## 数据库架构

### 核心数据表
- `conversations`: 对话历史，包含用户消息、AI响应、原始请求/响应数据
- `requirements`: 需求管理状态跟踪，支持processing/completed/failed状态流转
- `system_logs`: 系统运行日志结构化存储
- `bot_status`: 机器人实时状态监控（WebSocket连接、HTTP服务状态）

### 数据库连接管理
```typescript
// src/services/database.ts - MySQL2连接池单例
export function getDatabaseManager(config: DatabaseConfig): DatabaseManager
```

## HTTP API接口

### 核心API端点
- `GET /health` - 服务健康检查
- `POST /api/send_private` - 发送私聊消息 
- `POST /api/send_group` - 发送群聊消息
- `GET /api/status` - 完整系统状态（WebSocket、数据库、进程信息）
- `GET /api/conversations` - 对话历史查询（支持用户ID筛选）
- `GET /api/requirements` - 需求管理状态查询

### API参数格式
```typescript
// 发送消息API
POST /api/send_private
{
  "user_id": number,
  "message": string
}

// 对话历史查询
GET /api/conversations?user_id=85178516&limit=50
```

## 需求处理系统

### 意图识别流程
1. **触发条件**: 仅授权用户(85178516)私聊消息
2. **AI分析**: Gemini模型分析消息意图，返回置信度和复杂度
3. **关键词检测**: 实现、开发、修改、修复、优化等开发相关词汇
4. **复杂度判断**: 包含"系统"、"模块"关键词或消息长度>100字符时标记为复杂需求

### 需求状态管理
```typescript
// src/types/index.ts
interface RequirementData {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  processing_start_time?: Date;
  processing_end_time?: Date;
  claude_code_output?: string;
  error_message?: string;
}
```

## 群聊管理功能

### 管理命令（仅授权用户）
- `开启群聊`/`关闭群聊`: 全局群聊AI回复开关
- `添加群聊 [群号]`/`移除群聊 [群号]`: 群聊白名单管理
- `群聊列表`/`清空群聊`: 白名单查看和清理

### 群聊触发机制
- **触发条件**: @机器人(1129974489) 且 群聊白名单验证通过
- **消息清理**: 自动移除@标记，提取纯文本内容用于AI处理

## 异步编程模式

### 事件驱动架构
```typescript
// WebSocket事件监听 - src/services/websocket-client.ts
this.websocketClient.on('private_message', this.handlePrivateMessage.bind(this));
this.websocketClient.on('group_message', this.handleGroupMessage.bind(this));
```

### 错误处理和恢复
- **WebSocket重连**: 指数退避重连机制，最大重试10次
- **数据库连接池**: 自动连接恢复和池管理
- **优雅关闭**: SIGINT/SIGTERM信号处理，确保资源正确释放

## 日志系统

### 日志结构 (Winston)
```
logs/
├── database_YYYY-MM-DD.log      # 数据库操作日志
├── websocket_YYYY-MM-DD.log     # WebSocket事件日志  
├── http-server_YYYY-MM-DD.log   # HTTP服务器日志
├── ai-service_YYYY-MM-DD.log    # AI服务调用日志
└── main_YYYY-MM-DD.log          # 主程序日志
```

### 日志监控
```bash
# 实时监控日志
tail -f logs/main_$(date +%Y-%m-%d).log
tail -f logs/websocket_$(date +%Y-%m-%d).log
```

## 服务部署

### Docker容器化
```bash
# 使用TypeScript专用compose文件
docker-compose -f docker-compose-ts.yml up -d

# 包含MySQL数据库和应用容器的完整环境
```

### 生产环境启动
```bash
# 推荐使用启动脚本（包含环境检查）
./start_services_ts.sh

# 或手动启动
npm run build && npm start

# 后台运行
npm run build && npm start > logs/service.log 2>&1 &
```

## 开发注意事项

### 代码修改后服务重启
修改TypeScript源码后必须重新编译和重启：
```bash
pkill -f "node dist/index.js" && npm run build && npm start > logs/service.log 2>&1 &
```

### 类型安全开发
- 所有API接口参数使用TypeScript接口定义
- 数据库查询结果通过泛型指定返回类型  
- WebSocket消息解析使用类型断言确保数据结构正确

### 异步操作最佳实践
- 数据库操作使用连接池的 `async/await` 模式
- WebSocket发送使用Promise包装确保消息发送状态
- HTTP API响应统一错误处理中间件
- Gemini API调用使用axios而非SDK，避免ES模块问题

### AI服务集成要点
- 使用`gemini-2.5-flash`模型，通过HTTP REST API调用
- 实现LRU Token轮换机制，当Token出错时自动切换
- API响应解析处理`candidates[0].content.parts[0].text`格式
- 支持意图分析和对话生成两种AI代理模式

### 测试策略
- **单元测试**: 核心业务逻辑和工具函数
- **集成测试**: 端到端对话流程和WebSocket消息模拟
- **性能测试**: 并发消息处理和数据库连接压力测试
- 测试超时配置：单元(30s)、集成(60s)、性能(120s)

## 关键开发约束
- 使用TypeScript严格模式开发，确保类型安全
- 优先编辑现有文件而非创建新文件
- 所有外部API调用必须包含错误处理和重试机制
- 数据库操作使用事务确保数据一致性
- 日志记录使用结构化格式，包含模块标识和时间戳

## 故障排除指南

### 常见错误模式
1. **`cached.updated_at.getTime is not a function`**: Token管理缓存问题，通常由API响应格式变化引起
2. **`message.message?.substring is not a function`**: OneBot消息格式为数组而非字符串，需要消息段提取
3. **`Error [ERR_REQUIRE_ESM]`**: ES模块兼容性问题，使用直接HTTP调用替代SDK
4. **WebSocket连接断开**: 检查OneBot服务器状态和access_token配置

### 调试命令
```bash
# 查看实时日志
tail -f logs/main_$(date +%Y-%m-%d).log
tail -f logs/websocket_$(date +%Y-%m-%d).log
tail -f logs/ai-service_$(date +%Y-%m-%d).log

# 检查服务状态
curl http://localhost:8080/api/status

# 测试数据库连接
npm test -- --testNamePattern="Database connection"

# 验证Token配置
node -e "console.log(require('./dist/utils/token-manager').getTokenManager().getStats())"
```
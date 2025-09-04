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

## Claude Code Subagent协作架构

### 核心Subagent角色定义

本QQ机器人项目基于Claude Code多智能体协作模式，通过专业化角色分工实现复杂TypeScript应用的高效开发和维护：

#### 业务开发者 (Business Developer)
- **职责范围**: 核心TypeScript服务开发、数据库操作实现、WebSocket/HTTP服务器功能扩展
- **技术专长**: Express.js REST API、OneBot协议集成、MySQL2连接池管理、异步事件驱动架构
- **任务类型**: 新功能实现、业务逻辑修改、数据库schema变更、API端点开发
- **工作文件**: `src/services/*`, `src/index.ts`, `src/types/index.ts`, 数据库迁移脚本

#### 代码审查员 (Code Reviewer)  
- **职责范围**: 代码质量检查、安全漏洞识别、可维护性评估、TypeScript类型安全审查
- **技术专长**: ESLint规则配置、TypeScript严格模式、异步编程最佳实践、错误处理模式
- **任务类型**: Pull Request审查、代码重构建议、性能优化识别、安全风险评估
- **关注重点**: 内存泄漏、SQL注入防护、WebSocket连接安全、Token管理安全

#### 调试器 (Debugger)
- **职责范围**: 错误调查、测试失败分析、系统故障诊断、性能瓶颈定位
- **技术专长**: Jest测试框架、Winston日志分析、WebSocket连接诊断、数据库查询优化
- **任务类型**: Bug修复、测试用例调试、日志分析、监控告警处理
- **调试工具**: 实时日志监控、数据库连接状态检查、WebSocket事件跟踪

#### 系统架构设计师 (System Architect Designer)
- **职责范围**: 需求转换为系统架构、模块依赖设计、扩展性规划、技术选型决策
- **技术专长**: 微服务架构、事件驱动设计、数据库建模、API设计模式
- **任务类型**: 架构重构、新模块设计、系统集成方案、性能扩展策略
- **设计产出**: 组件依赖图、数据流设计、接口规范定义、部署架构图

#### Gemini支持专家 (Gemini Support Specialist)
- **职责范围**: Google Gemini AI集成、Token轮换机制、意图分析优化、对话质量提升
- **技术专长**: Gemini 2.5 Flash模型、HTTP REST API集成、LRU Token管理、意图识别算法
- **任务类型**: AI服务故障处理、对话逻辑优化、Token池管理、AI响应质量调优
- **专业领域**: `src/services/ai-service.ts`, Token管理器、意图分析流程

### MCP服务器集成架构

#### Browser-Tools MCP集成模式
```typescript
// MCP服务器集成点
interface MCPBrowserIntegration {
  screenshot_validation: '截图验证功能正确性',
  network_analysis: '网络请求性能分析', 
  performance_audit: 'Lighthouse性能评估',
  accessibility_check: '无障碍性合规检查',
  console_debugging: '浏览器控制台错误诊断'
}
```

**集成工作流**:
1. **调试器** → `mcp__browser-tools__takeScreenshot` → 可视化验证UI状态
2. **代码审查员** → `mcp__browser-tools__runPerformanceAudit` → 性能瓶颈识别
3. **业务开发者** → `mcp__browser-tools__getNetworkLogs` → API调用状态检查
4. **系统架构设计师** → `mcp__browser-tools__runAccessibilityAudit` → 架构无障碍性评估

#### Context7 MCP集成模式
```typescript
// 文档智能检索集成
interface MCPContext7Integration {
  library_resolution: 'TypeScript/Node.js生态系统库ID解析',
  documentation_fetch: '实时库文档获取和代码示例',
  api_reference: 'Express.js/MySQL2/Winston最新API参考',
  integration_patterns: '第三方库集成最佳实践'
}
```

**使用策略**:
- **业务开发者**: `mcp__context7__resolve-library-id` → 查找Express.js中间件/MySQL2连接配置
- **Gemini支持专家**: Context7检索Google AI SDK最新文档和集成模式
- **系统架构设计师**: 获取微服务架构库的设计模式和最佳实践文档

### 工作流协作模式

#### 事件驱动开发工作流
```mermaid
需求接收 → 系统架构设计师(架构设计) → 业务开发者(功能实现) 
    ↓
代码审查员(质量检查) → 调试器(测试验证) → Gemini支持专家(AI优化)
```

**协作检查点**:
1. **架构设计阶段**: 系统架构设计师输出技术方案 → 代码审查员预评估可行性
2. **开发实现阶段**: 业务开发者完成编码 → 调试器执行单元测试 → 代码审查员质量检查
3. **集成测试阶段**: 调试器运行集成测试 → Browser-Tools MCP验证功能 → Gemini专家优化AI交互
4. **部署准备阶段**: 系统架构师确认部署配置 → 所有角色确认就绪状态

#### 功能开发移交模式
```typescript
interface HandoffProtocol {
  // 架构师 → 开发者
  architecture_handoff: {
    component_design: '组件依赖关系图',
    api_specifications: 'REST API接口规范',
    database_schema: '数据库表结构变更',
    integration_points: '外部服务集成点'
  },
  
  // 开发者 → 审查员  
  development_handoff: {
    implementation_code: 'TypeScript源码实现',
    test_coverage: 'Jest测试用例覆盖',
    documentation_update: '接口文档更新',
    dependency_changes: '依赖项变更说明'
  },
  
  // 审查员 → 调试器
  review_handoff: {
    quality_assessment: '代码质量评估报告', 
    security_checklist: '安全检查清单',
    performance_concerns: '性能风险点识别',
    refactoring_suggestions: '重构建议'
  }
}
```

### 任务分发策略

#### 基于复杂度的任务路由
```typescript
interface TaskRoutingStrategy {
  // 简单配置变更 → 业务开发者
  simple_config: ['环境变量修改', 'API端点参数调整', '日志级别配置'],
  
  // 业务逻辑开发 → 业务开发者 + 代码审查员
  business_logic: ['新功能实现', '数据库操作', 'WebSocket事件处理', 'HTTP API扩展'],
  
  // 架构性变更 → 系统架构设计师 + 全员协作
  architectural: ['模块依赖重构', '数据库schema设计', '服务拆分', '性能优化架构'],
  
  // AI服务相关 → Gemini支持专家 + 业务开发者
  ai_integration: ['意图分析优化', 'Token管理器', '对话逻辑', 'Gemini API集成'],
  
  // 故障排除 → 调试器 + 相关专家
  debugging: ['错误日志分析', '性能问题定位', '连接故障诊断', '测试失败调查']
}
```

#### 专业领域责任矩阵
| 任务类型 | 主责Agent | 协作Agent | MCP工具支持 |
|---------|----------|-----------|------------|
| OneBot协议集成 | 业务开发者 | 调试器 | Browser-Tools网络分析 |
| 数据库性能优化 | 业务开发者 | 系统架构师 | Context7 MySQL2文档 |
| Gemini AI故障 | Gemini专家 | 调试器 | Context7 Google AI SDK |
| 安全漏洞修复 | 代码审查员 | 业务开发者 | Browser-Tools安全审计 |
| 系统监控告警 | 调试器 | 所有专家 | Browser-Tools性能监控 |

### 质量保证协调

#### 多智能体质量门控
```typescript
interface QualityGateProtocol {
  // 门控1: 架构合规性检查
  architectural_gate: {
    reviewer: '系统架构设计师',
    criteria: ['组件依赖合理性', 'API设计一致性', '扩展性评估'],
    tools: ['Context7架构模式文档', '设计原则检查清单']
  },
  
  // 门控2: 代码质量检查  
  code_quality_gate: {
    reviewer: '代码审查员',
    criteria: ['TypeScript类型安全', 'ESLint规则合规', '安全漏洞扫描'],
    tools: ['静态分析工具', 'Browser-Tools安全审计']
  },
  
  // 门控3: 功能验证检查
  functional_gate: {
    reviewer: '调试器',
    criteria: ['单元测试通过', '集成测试覆盖', '性能基准达标'],
    tools: ['Jest测试框架', 'Browser-Tools性能审计']
  },
  
  // 门控4: AI服务质量检查
  ai_service_gate: {
    reviewer: 'Gemini支持专家', 
    criteria: ['意图识别准确率', 'Token轮换稳定性', '响应时间达标'],
    tools: ['AI服务监控', 'Context7 Gemini最佳实践']
  }
}
```

#### 协作冲突解决机制
```typescript
interface ConflictResolutionProtocol {
  // 技术分歧仲裁
  technical_arbitration: {
    process: '系统架构设计师最终决策',
    escalation: 'MCP Context7技术文档权威性验证',
    documentation: '决策理由和替代方案记录'
  },
  
  // 优先级冲突协调
  priority_coordination: {
    framework: '业务影响度 > 安全风险 > 性能优化 > 功能完善',
    reviewer_authority: '代码审查员具有安全风险否决权',
    debugging_priority: '调试器具有生产故障最高优先级'
  },
  
  // 质量标准统一
  quality_standardization: {
    code_style: 'ESLint + Prettier自动格式化',
    documentation: 'TypeDoc标准 + Context7文档模板',
    testing: 'Jest测试覆盖率 > 80%基准线'
  }
}
```

#### 持续改进反馈循环
1. **每周回顾**: 所有subagent参与，分析协作效率和质量问题
2. **工具优化**: MCP服务器使用效果评估，集成模式持续改进
3. **知识共享**: Context7获取的最新文档和最佳实践在团队内传播
4. **流程迭代**: 基于实际项目复杂度调整任务分发策略和质量门控标准

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

## Git协作规范

### 多Claude并发协作分支策略

**核心原则**: 不同Claude智能体通过独立分支树互不影响，避免并发冲突

#### 分支命名约定
```bash
# Agent角色专用分支（按时间戳隔离）
feature/business-dev-$(date +%Y%m%d-%H%M)      # 业务开发者
feature/architect-$(date +%Y%m%d-%H%M)         # 系统架构师
feature/reviewer-$(date +%Y%m%d-%H%M)          # 代码审查员
feature/debugger-$(date +%Y%m%d-%H%M)          # 调试器
feature/gemini-support-$(date +%Y%m%d-%H%M)    # Gemini专家

# 任务专用分支（按功能模块）
feature/websocket-optimization-[agent]         # WebSocket优化
feature/database-migration-[agent]             # 数据库迁移
feature/ai-service-enhancement-[agent]         # AI服务增强
hotfix/[issue-description]-[agent]             # 紧急修复
```

#### Git Worktree并行协作模式

**核心策略**: 使用`git worktree`为不同Claude智能体创建独立工作目录，实现真正的并行开发

```bash
# 1. 初始化主工作树（如果尚未存在）
cd /home/liahua/IdeaProject/qq_bot  # 主工作目录

# 2. 为不同Agent创建独立worktree
git worktree add ../qq_bot-business-dev feature/business-dev-$(date +%Y%m%d-%H%M)
git worktree add ../qq_bot-architect feature/architect-$(date +%Y%m%d-%H%M)
git worktree add ../qq_bot-reviewer feature/reviewer-$(date +%Y%m%d-%H%M)
git worktree add ../qq_bot-debugger feature/debugger-$(date +%Y%m%d-%H%M)
git worktree add ../qq_bot-gemini-support feature/gemini-support-$(date +%Y%m%d-%H%M)

# 3. 各Agent在独立目录工作
# Business Developer
cd /home/liahua/IdeaProject/qq_bot-business-dev
npm install  # 安装依赖（如需要）
# 进行开发工作...

# Architect
cd /home/liahua/IdeaProject/qq_bot-architect  
# 进行架构设计工作...

# 4. 提交规范（在各自worktree中）
git commit -m "feat(business-dev): 实现WebSocket重连机制

🤖 Generated with [Claude Code](https://claude.ai/code)
Agent: Business Developer  
Worktree: qq_bot-business-dev
Task-ID: #12345

Co-Authored-By: Claude <noreply@anthropic.com>"

# 5. 推送和合并
git push -u origin feature/business-dev-YYYYMMDD-HHMM
# 创建PR，等待code-reviewer agent审批

# 6. 清理worktree（任务完成后）
git worktree remove ../qq_bot-business-dev
git branch -d feature/business-dev-YYYYMMDD-HHMM
```

#### Worktree管理命令
```bash
# 查看所有worktree状态
git worktree list

# 修剪已删除的worktree引用
git worktree prune

# 移动worktree到新位置
git worktree move ../qq_bot-business-dev ../qq_bot-business-dev-new

# 强制删除worktree（包含未提交更改）
git worktree remove --force ../qq_bot-business-dev
```

#### 文件级协作锁定
```typescript
// 避免多Agent同时修改相同文件
interface FileOwnershipMap {
  'src/services/database.ts': 'business-dev',
  'src/services/websocket-client.ts': 'business-dev', 
  'src/services/ai-service.ts': 'gemini-support',
  'src/types/index.ts': 'architect',
  'tests/': 'debugger',
  'docs/': 'reviewer'
}
```

#### 冲突解决优先级
1. **架构师** (`architect`) - 最高决策权
2. **代码审查员** (`reviewer`) - 安全风险否决权  
3. **业务开发者** (`business-dev`) - 功能实现权
4. **调试器** (`debugger`) - 生产故障最高优先级
5. **Gemini专家** (`gemini-support`) - AI服务领域权威

#### Worktree协作优势

**并行隔离开发**:
- 每个Agent在独立目录工作，避免文件锁定冲突
- 可同时运行不同版本的开发服务器和测试
- 不同Agent的依赖变更互不影响

**任务状态管理**:
```bash
# 查看当前所有并行任务状态
git worktree list --porcelain | grep -E "(worktree|branch)" 

# 示例输出
# worktree /home/liahua/IdeaProject/qq_bot
# branch refs/heads/master
# worktree /home/liahua/IdeaProject/qq_bot-business-dev  
# branch refs/heads/feature/business-dev-20250904-1430
# worktree /home/liahua/IdeaProject/qq_bot-debugger
# branch refs/heads/feature/debugger-20250904-1435
```

**资源共享策略**:
- `node_modules`: 各worktree独立安装，避免依赖冲突
- `logs/`: 使用不同前缀区分日志文件
- `dist/`: 编译输出隔离，支持并行构建

#### 合并策略
- **禁止直接push到master**: 所有变更通过Pull Request
- **强制代码审查**: 所有PR必须经过`code-reviewer` agent审批  
- **Worktree同步**: 定期在各worktree执行`git fetch origin`保持同步
- **自动化检查**: CI/CD流程包含ESLint、Jest测试、TypeScript编译检查
- **冲突预防**: Worktree创建时自动基于最新master分支
- **清理机制**: 任务完成后及时删除worktree，避免磁盘空间浪费

## 关键开发约束
- 使用TypeScript严格模式开发，确保类型安全
- 优先编辑现有文件而非创建新文件
- 所有外部API调用必须包含错误处理和重试机制
- 数据库操作使用事务确保数据一致性
- 日志记录使用结构化格式，包含模块标识和时间戳
- **多Claude协作**: 并行任务必须使用Git Worktree隔离，避免文件锁定和依赖冲突

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
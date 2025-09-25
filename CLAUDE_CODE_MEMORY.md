# Claude Code 记忆文档

## 📋 文档说明

本文档用于记录Claude Code在开发过程中需要记住的重要信息，包括测试参数、配置信息和开发上下文。

**创建时间**: 2025-09-26
**最后更新**: 2025-09-26
**维护者**: Claude Code Assistant

---

## 🧪 测试配置信息

### QQ Bot 测试参数

#### 私聊测试配置
```json
{
  "test_private_chat": {
    "user_id": 85178516,
    "description": "用于测试私聊消息发送的用户ID",
    "usage": "私聊消息测试、AI对话测试、功能验证",
    "注意": "此用户ID用于开发和测试环境"
  }
}
```

#### 群聊测试配置
```json
{
  "test_group_chat": {
    "group_id": 1019235326,
    "description": "用于测试群聊消息发送的群组ID",
    "usage": "群聊消息测试、群聊AI交互测试、群聊功能验证",
    "注意": "此群组ID用于开发和测试环境"
  }
}
```

### 现有测试文件中的参数

#### `test_message_flow_api_complete.js`
- **已更新为标准测试用户ID**: `85178516`
- **用途**: 消息流程API完整性验证
- **建议**: 可以根据需要更新为新的测试用户ID

---

## 🔧 开发环境配置

### Docker部署架构
- 项目采用**完全Docker容器化**架构
- 开发和生产环境都使用Docker部署
- 服务端口：8080(API Gateway), 8081(Core), 9080(Admin Backend), 3003(Admin Frontend)

### 数据库配置
- **数据库**: MySQL (localhost:3306)
- **数据库名**: qqbot_db
- **用户**: qqbot_user/qqbot_password
- **重要表**: conversations, llm_call_logs, timeline_events, websocket_logs

---

## 🧠 群聊Bot记忆系统

### 设计文档
- **主要文档**: `GROUP_CHAT_BOT_MEMORY_DESIGN.md`
- **架构**: 三维记忆模型（时间、关系、语义）
- **核心特性**: 智能遗忘、记忆流动性、群聊文化适应

### 关键概念
- **分层记忆**: 实时层、近期层、长期层
- **多角色视角**: 信息助手、话题参与者、关系观察者、个性化服务者
- **动态适应**: 根据群聊类型和用户行为自动调整策略

---

## 📊 项目架构信息

### 4模块微服务架构
```
modules/
├── http-api/           # HTTP API网关 (端口: 8080)
├── qqbot-core/         # QQ机器人核心服务 (端口: 8081)
└── admin-panel/        # 管理面板
    ├── backend/        # 管理后端API (端口: 9080)
    └── frontend/       # 管理前端界面 (端口: 3003)
```

### 核心技术栈
- **语言**: TypeScript, Node.js
- **数据库**: MySQL
- **容器化**: Docker + 宿主机网络架构
- **AI集成**: Google Gemini API with Token Management
- **通信协议**: OneBot 11 (WebSocket)

---

## 🔬 测试和验证

### 重要测试脚本
1. **`test_message_flow_api_complete.js`** - 消息流程API完整性验证
2. **`test_human_like_processing.js`** - 人性化处理测试
3. **`test_api_structure.js`** - API结构验证

### 验证检查点
- LLM调用链路完整性
- 数据库记录一致性
- API响应结构正确性
- 业务逻辑验证

---

## 📝 开发规范记录

### Docker优先原则
- 所有开发和生产都使用Docker部署
- 不推荐npm本地开发模式
- 容器间采用宿主机网络模式通信

### 代码质量要求
- 运行lint和typecheck命令确保代码质量
- 通过完整验证脚本测试功能
- 遵循消息流程API规范

---

## 🔄 更新日志

### 2025-09-26
- 创建Claude Code记忆文档
- 记录测试用户ID: 85178516 (私聊)
- 记录测试群组ID: 1019235326 (群聊)
- 整理项目架构和配置信息
- 添加群聊Bot记忆系统设计要点

---

## 📋 待办事项

- [ ] 根据需要更新测试脚本中的用户ID和群组ID
- [ ] 验证新的测试ID在实际环境中的可用性
- [ ] 完善测试用例覆盖私聊和群聊场景
- [ ] 持续更新项目架构变更信息

---

**注意**: 此文档是Claude Code的工作记忆，请在项目发生重要变更时及时更新。
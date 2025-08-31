# QQ智能机器人 - Claude Code项目配置

## 🎯 项目概述
基于OneBot 11协议的智能QQ机器人，集成Gemini AI智能对话和Claude Code开发助手功能。

## 🏗️ 技术栈
- **后端**: Python 3.8+ with asyncio
- **协议**: OneBot 11 (WebSocket + HTTP API)  
- **AI模型**: Google Gemini 2.5 Flash
- **数据库**: MySQL 8.0+
- **WebSocket库**: websockets 11.0+
- **Web框架**: Flask 2.0+

## 🔧 开发权限与环境

### 完全开发权限
- ✅ 修改源代码和配置
- ✅ 安装依赖和管理环境
- ✅ 启动/停止/重启服务
- ✅ 查看和分析日志
- ✅ 执行测试和验证

### 开发环境配置
```bash
# 工作目录
cd /mnt/c/Users/a8517/PycharmProjects/qq_bot

# 启动服务
cd main && python main.py

# 运行测试
cd test && python test_http_api.py

# 查看日志
tail -f log/main_$(date +%Y-%m-%d).log
```

## 🔌 核心服务配置

### WebSocket连接
```python
# main/config.py:9-14
WEBSOCKET_CONFIG = {
    "host": "127.0.0.1",
    "port": 3001,
    "access_token": "w@123456",
    "uri": "ws://127.0.0.1:3001?access_token=w@123456"
}
```

### HTTP API服务
- **监听地址**: 0.0.0.0:8080
- **API前缀**: /api/
- **健康检查**: /health

### AI Agent配置
- **模型**: Gemini 2.5 Flash
- **API密钥**: resource/token.properties (支持多Token轮换)
- **系统提示**: 友好、简洁的中文回复
- **私聊功能**: ✅ 智能对话 + 需求识别
- **群聊功能**: ✅ @机器人(1129974489)触发AI回复

## 📋 需求管理系统

### 需求识别关键词
```python
# main/requirement_manager.py:52-55
REQUIREMENT_KEYWORDS = [
    "实现", "开发", "修改", "修复", "优化", "添加", 
    "创建", "构建", "重构", "改进", "升级", "集成"
]
```

### Claude Code集成流程
1. **需求接收**: 私聊消息自动识别需求
2. **需求拆解**: 复杂需求自动拆解为子任务
3. **并行处理**: 使用Claude Code子Agent提高处理并行度
4. **管道处理**: 通过`cat input.txt | claude`处理
5. **状态更新**: 实时更新需求状态
6. **Hook通知**: 完成后自动通知用户

### 需求拆解和子Agent机制
```python
# 需求拆解策略 - requirement_manager.py
TASK_DECOMPOSITION_PATTERNS = {
    "complex_feature": {
        "keywords": ["实现", "开发", "系统", "模块", "功能"],
        "subtasks": ["需求分析", "架构设计", "代码实现", "测试验证"]
    },
    "bug_investigation": {
        "keywords": ["修复", "调试", "问题", "错误", "异常"],
        "subtasks": ["问题复现", "日志分析", "代码定位", "解决方案", "验证测试"]
    },
    "optimization": {
        "keywords": ["优化", "性能", "改进", "提升"],
        "subtasks": ["性能分析", "瓶颈识别", "优化实施", "效果验证"]
    }
}

# Claude Code子Agent调用策略
SUBAGENT_ALLOCATION = {
    "parallel_tasks": True,        # 启用并行任务处理
    "max_concurrent": 3,           # 最大并发Agent数量
    "task_timeout": 300,           # 单个任务超时时间(秒)
    "progress_reporting": True     # 启用进度汇报
}
```

### 已授权用户
- **李阿花**: 85178516 (完全权限用户)

## 🚀 服务状态
- **机器人状态**: ✅ 运行中 (QQ: 1129974489)
- **WebSocket连接**: ✅ 已连接 (ws://127.0.0.1:3001)
- **HTTP服务**: ✅ 运行中 (http://0.0.0.0:8080)  
- **Gemini AI Agent**: ✅ 已集成并正常工作（支持私聊+群聊@回复）
- **Claude Code需求管理**: ✅ 已集成并正常工作
- **群聊@机器人功能**: ✅ 已实现，支持智能AI回复

## 📝 开发最佳实践

### 代码规范
- 遵循Python PEP 8编码标准
- 使用类型注解提高代码可读性
- 异步函数使用async/await模式
- 统一的错误处理和日志记录

### 测试验证
```bash
# 运行完整测试套件
cd test
python test_http_api.py      # HTTP API功能测试
python send_test.py          # 消息发送测试
python debug_test.py         # 调试功能测试
```

### 日志监控
```bash
# 实时查看各模块日志
tail -f log/main_$(date +%Y-%m-%d).log                    # 主程序日志
tail -f log/websocket_events_$(date +%Y-%m-%d).log        # WebSocket事件日志
tail -f log/http_server_$(date +%Y-%m-%d).log             # HTTP服务器日志
```

## 🛠️ 开发命令快速参考

### 服务管理
```bash
# 启动服务
cd main && python main.py

# 后台启动
cd main && nohup python main.py > ../log/service.log 2>&1 &

# 停止服务
pkill -f "python main.py"
```

### 功能验证
```bash
# 健康检查
curl http://127.0.0.1:8080/health

# 发送测试私聊消息
curl -X POST http://127.0.0.1:8080/api/send_private \
  -H "Content-Type: application/json" \
  -d '{"user_id": 85178516, "message": "测试", "message_type": "text"}'

# 发送测试群聊消息
curl -X POST http://127.0.0.1:8080/api/send_group \
  -H "Content-Type: application/json" \
  -d '{"group_id": 1019235326, "message": "@1129974489 你好"}'

# 查看机器人状态
curl http://127.0.0.1:8080/api/status

# 查看对话历史
curl http://127.0.0.1:8080/api/conversations

# 查看需求列表  
curl http://127.0.0.1:8080/api/requirements
```

## 📊 项目统计
- **核心模块**: 6个 (main/\*.py)
- **测试文件**: 10+ (test/\*.py)
- **API接口**: 8个 (HTTP REST)
- **支持事件**: 5种 (OneBot协议)
- **集成服务**: 2个 (Gemini AI + Claude Code)

## 🔐 Claude Code最佳实践配置

### 安全配置
- **权限控制**: 仅授权用户85178516可触发需求管理
- **文件保护**: 敏感文件resource/token.properties自动排除
- **API安全**: WebSocket访问令牌验证
- **错误隔离**: 异常不会影响核心服务稳定性

### 内存管理
- **项目记忆**: CLAUDE.md作为项目级配置导入
- **状态持久化**: 需求状态和对话记录数据库存储
- **日志轮转**: 按日期自动创建日志文件

### Hook集成
```python
# main/requirement_manager.py:180-190
async def execute_completion_hook(self, requirement: Requirement):
    """执行完成Hook - 通知用户需求完成"""
    try:
        hook_message = f"""🎉 需求完成通知
需求ID: {requirement.id[:8]}
状态: {requirement.status.value}
完成时间: {requirement.updated_at}"""
        await self.websocket_client.send_private_message(
            requirement.user_id, hook_message)
    except Exception as e:
        self.logger.error(f"Hook执行失败: {e}")
```

### 工具配置
- **自动化测试**: 集成pytest测试框架
- **代码质量**: 使用类型注解和docstring
- **依赖管理**: requirements.txt精确版本控制
- **环境隔离**: 支持环境变量配置覆盖

### 任务进度汇报机制
- **汇报对象**: 用户ID 85178516 (李阿花)
- **汇报时机**: 每个开发阶段完成时自动发送
- **汇报内容**: 包含任务状态、完成详情、下一步计划
- **汇报格式**: 
```python
progress_message = f"""📋 任务进度汇报
任务: {task_name}
状态: {status}
完成时间: {completion_time}
详情: {details}
下一步: {next_steps}"""
```

### Claude Code交互bash进程
- **启动时机**: 服务启动时自动拉起独立bash进程
- **进程用途**: 专门处理Claude Code命令交互
- **管道通信**: 通过标准输入/输出与Claude Code通信
- **进程管理**: 支持重启和异常恢复

## 🤝 Claude 协作指南

### 多Claude实例协作机制
当多个Claude Code实例同时工作时，采用以下协作策略：

#### 任务分工策略
- **测试专员**: 负责功能测试、性能验证、质量保证
- **开发专员**: 负责BUG修复、功能实现、代码优化
- **需求专员**: 负责需求分析、任务拆解、进度管理

#### 协作通信方式
```python
# 通过需求管理系统进行状态同步
# requirements表中的status字段作为协作信号
COLLABORATION_STATUS = {
    "received": "待分配 - 其他Claude可接手", 
    "analyzing": "分析中 - 请勿重复处理",
    "in_progress": "开发中 - 请勿干扰",
    "testing": "测试中 - 开发专员等待",
    "completed": "已完成 - 可清理和优化",
    "blocked": "受阻 - 需要协助"
}
```

#### Gap点识别和处理
- **数据库问题**: `Failed to save conversation: b'message_id'` 
  - 状态: 已识别，需要修复
  - 负责人: 开发专员处理数据库编码问题
- **需求识别准确率**: 优化类需求置信度偏低(40%)
  - 状态: 已识别，需要调优
  - 负责人: AI模型调优专员
- **WebSocket重连机制**: 需要压力测试验证
  - 状态: 待测试
  - 负责人: 测试专员进行长时间稳定性测试

#### 协作工作流
1. **需求接收**: 任何Claude都可接收新需求
2. **状态查询**: 通过API `/api/requirements` 检查当前任务状态
3. **避免冲突**: 检查`status`字段，避免重复处理正在进行的任务
4. **进度汇报**: 状态变更时通过QQ消息通知用户85178516
5. **成果共享**: 完成的代码和文档更新到git，供其他Claude参考

#### 实时状态检查命令
```bash
# 检查当前需求状态分布
curl -s http://127.0.0.1:8080/api/requirements | jq '.requirements[] | {id: .id, status: .status, message: .message}'

# 检查服务运行状态  
curl -s http://127.0.0.1:8080/api/status && curl -s http://127.0.0.1:8080/api/connection

# 查看最新日志(检查其他Claude的活动)
tail -5 logs/requirements/requirements_$(date +%Y-%m-%d).log
```
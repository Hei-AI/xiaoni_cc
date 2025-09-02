# QQ智能机器人项目

基于OneBot 11协议的智能QQ机器人，集成Gemini AI和Claude Code开发助手功能，支持WebSocket实时通信和HTTP API接口。

## 🏗️ 项目架构

### 核心模块
```
qq_bot/
├── main/                           # 核心业务逻辑
│   ├── main.py                    # 🎯 主程序入口 - 事件分发和处理
│   ├── websocket_client.py        # 🔌 WebSocket客户端 - OneBot协议通信
│   ├── http_server.py             # 🌐 HTTP API服务器 - RESTful接口
│   ├── config.py                  # ⚙️ 配置管理 - 连接参数和功能开关
│   ├── gemini_agent.py            # 🤖 Gemini AI代理 - 智能对话处理
│   ├── requirement_manager.py     # 📋 需求管理器 - Claude Code集成
│   └── database.py                # 💾 数据库管理 - MySQL存储
├── test/                          # 测试套件
│   ├── test_http_api.py          # HTTP API功能测试
│   ├── send_test.py              # 消息发送功能测试
│   ├── debug_test.py             # 调试和诊断测试
│   └── [其他测试文件]            # 各功能模块测试
├── resource/                      # 资源配置
│   └── token.properties          # API密钥配置文件
├── doc/                          # 技术文档
│   ├── 事件类型.md               # OneBot事件类型说明
│   ├── 事件字段详情.md           # 事件字段详细定义
│   └── NapCat.md                 # NapCat服务器配置
├── log/                          # 日志存储
│   ├── main_YYYY-MM-DD.log       # 主程序日志
│   ├── websocket_events_YYYY-MM-DD.log # WebSocket事件日志
│   └── [其他日志文件]            # 各模块日志
├── requirements.txt              # Python依赖清单
├── CLAUDE.md                     # Claude Code配置和权限
└── README.md                     # 项目文档
```

### 系统架构图
```
┌─────────────────┐    WebSocket    ┌──────────────────┐
│   OneBot Server │ ◄──────────────► │  WebSocket Client │
│   (NapCat)      │                 │  (websocket_client.py)
└─────────────────┘                 └──────────────────┘
                                             │
                                             ▼
┌─────────────────┐                 ┌──────────────────┐
│   QQ客户端       │                 │    主程序入口      │
│   (接收/发送消息) │                 │   (main.py)      │
└─────────────────┘                 └──────────────────┘
                                             │
                                    ┌────────┼────────┐
                                    ▼        ▼        ▼
                            ┌─────────┐ ┌──────┐ ┌─────────┐
                            │HTTP API │ │AI代理│ │需求管理器│
                            │服务器   │ │     │ │        │
                            └─────────┘ └──────┘ └─────────┘
                                    │        │        │
                                    ▼        ▼        ▼
                            ┌─────────┐ ┌──────┐ ┌─────────┐
                            │REST接口 │ │Gemini│ │Claude   │
                            │        │ │ API  │ │ Code    │
                            └─────────┘ └──────┘ └─────────┘
```

## ✨ 核心功能

### 🤖 AI智能对话系统
- **Gemini 2.5 Flash集成**: 智能理解和回复用户消息
- **多API密钥轮换**: 确保服务高可用性
- **对话记录存储**: MySQL数据库保存对话历史
- **智能回复生成**: 基于上下文的个性化回复

### 🛠️ Claude Code开发助手
- **需求智能识别**: 自动识别开发需求关键词
- **Claude Code集成**: 通过管道处理复杂开发任务
- **Hook通知机制**: 开发完成状态自动通知
- **需求状态管理**: 完整的需求生命周期跟踪

### 📡 OneBot协议通信
- **WebSocket实时连接**: 与NapCat服务器实时通信
- **多事件类型支持**: 私聊、群聊、通知、请求、元事件
- **消息段支持**: 文本、表情、@、回复等复杂消息
- **自动重连机制**: 网络中断后自动恢复连接

### 🌐 HTTP API服务
- **RESTful接口**: 标准化的API设计
- **多种消息发送**: 私聊、群聊、@、回复消息
- **状态查询**: 实时获取机器人和连接状态
- **健康检查**: 服务运行状态监控

### 💾 数据持久化
- **MySQL存储**: 对话记录和需求数据持久化
- **连接池管理**: 高效的数据库连接管理
- **自动表创建**: 首次运行自动创建数据库结构

## 安装和配置

### 1. 安装依赖
```bash
pip install -r requirements.txt
```

### 2. 配置设置
编辑 `main/config.py` 文件，配置WebSocket连接参数：
```python
WEBSOCKET_CONFIG = {
    "host": "127.0.0.1",
    "port": 3001,
    "access_token": "your_access_token",
    "uri": "ws://127.0.0.1:3001?access_token=your_access_token"
}
```

## 使用方法

### 1. 启动机器人
```bash
cd main
python main.py
```

机器人将同时启动：
- WebSocket客户端（连接到OneBot服务器）
- HTTP服务器（监听8080端口）

### 2. HTTP API使用

#### 发送私聊消息
```bash
curl -X POST http://127.0.0.1:8080/api/send_private \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": 123456789,
    "message": "你好！",
    "message_type": "text"
  }'
```

#### 发送群聊消息
```bash
curl -X POST http://127.0.0.1:8080/api/send_group \
  -H "Content-Type: application/json" \
  -d '{
    "group_id": 987654321,
    "message": "大家好！",
    "message_type": "text"
  }'
```

#### 发送@消息
```bash
curl -X POST http://127.0.0.1:8080/api/send_at \
  -H "Content-Type: application/json" \
  -d '{
    "group_id": 987654321,
    "user_id": 123456789,
    "message": "这是@消息"
  }'
```

#### 发送回复消息
```bash
curl -X POST http://127.0.0.1:8080/api/send_reply \
  -H "Content-Type: application/json" \
  -d '{
    "message_type": "private",
    "target_id": 123456789,
    "reply_id": 1001,
    "message": "这是回复",
    "message_format": "text"
  }'
```

#### 获取状态
```bash
# 机器人状态
curl http://127.0.0.1:8080/api/status

# 连接状态
curl http://127.0.0.1:8080/api/connection

# 健康检查
curl http://127.0.0.1:8080/health
```

### 3. 消息段格式

支持发送复杂的消息段：
```json
{
  "user_id": 123456789,
  "message": [
    {"type": "text", "data": {"text": "文本"}},
    {"type": "face", "data": {"id": 123}},
    {"type": "at", "data": {"qq": 987654321}}
  ],
  "message_type": "segments"
}
```

## 测试

### 1. 运行HTTP API测试
```bash
cd test
python test_http_api.py
```

### 2. 运行发送功能测试
```bash
cd test
python send_test.py
```

## API接口详细说明

### 请求格式
所有API接口都使用JSON格式，Content-Type为`application/json`

### 响应格式
成功响应：
```json
{
  "success": true,
  "message": "操作成功",
  "timestamp": "2025-08-31T01:00:00"
}
```

错误响应：
```json
{
  "success": false,
  "error": "错误描述"
}
```

### 状态码
- 200: 成功
- 400: 请求参数错误
- 500: 服务器内部错误
- 503: 服务不可用（WebSocket未连接）

## 日志系统

机器人会生成详细的日志文件：
- `log/main_YYYY-MM-DD.log`: 主程序日志
- `log/websocket_events_YYYY-MM-DD.log`: WebSocket事件日志
- `log/http_server_YYYY-MM-DD.log`: HTTP服务器日志

## 故障排除

### 1. WebSocket连接失败
- 检查OneBot服务器是否运行
- 验证access_token是否正确
- 确认端口是否被占用

### 2. HTTP API无响应
- 确认HTTP服务器已启动（端口8080）
- 检查WebSocket客户端是否已连接
- 查看日志文件中的错误信息

### 3. 消息发送失败
- 验证用户ID和群ID是否正确
- 确认机器人有发送消息的权限
- 检查OneBot服务器状态

## 开发说明

### 1. 添加新的事件处理器
在`main.py`中添加新的处理函数，并在`main()`函数中注册：
```python
async def handle_new_event(data):
    # 处理逻辑
    pass

# 在main()函数中注册
client.on('new_event', handle_new_event)
```

### 2. 添加新的API接口
在`http_server.py`中添加新的路由和处理函数：
```python
async def new_api_endpoint(self, request):
    # API逻辑
    pass

# 在setup_routes()中添加路由
self.app.router.add_post('/api/new_endpoint', self.new_api_endpoint)
```

## 许可证

本项目采用MIT许可证。

## 贡献

欢迎提交Issue和Pull Request来改进项目。

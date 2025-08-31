# QQ机器人项目

基于OneBot 11协议的QQ机器人，支持WebSocket连接和HTTP API接口。

## 项目结构

```
qq_bot/
├── main/                    # 核心运行文件
│   ├── main.py             # 主程序入口
│   ├── websocket_client.py # WebSocket客户端
│   ├── http_server.py      # HTTP服务器
│   └── config.py           # 配置文件
├── test/                    # 测试文件
│   ├── test_http_api.py    # HTTP API测试
│   ├── send_test.py        # 发送功能测试
│   └── ...                 # 其他测试文件
├── log/                     # 日志文件目录
├── doc/                     # 文档目录
├── requirements.txt         # Python依赖
└── README.md               # 项目说明
```

## 功能特性

### 1. WebSocket事件处理
- 接收和处理QQ消息事件
- 支持私聊、群聊、通知、请求、元事件
- 自动回复功能
- 详细的事件日志记录

### 2. HTTP API接口
- 发送私聊消息
- 发送群聊消息
- 发送@消息
- 发送回复消息
- 获取机器人状态
- 获取连接状态

### 3. 消息类型支持
- 纯文本消息
- 消息段（文本、表情、@、回复等）
- 支持OneBot 11协议规范

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

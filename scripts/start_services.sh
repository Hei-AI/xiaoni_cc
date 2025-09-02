#!/bin/bash
# QQ机器人分离式服务启动脚本
# 按照依赖顺序启动3个独立服务

PROJECT_DIR="/home/liahua/IdeaProject/qq_bot"
LOG_DIR="$PROJECT_DIR/log"

# 确保日志目录存在
mkdir -p "$LOG_DIR"

echo "🚀 启动QQ机器人分离式服务架构"
echo "项目目录: $PROJECT_DIR"
echo "日志目录: $LOG_DIR"
echo "=" * 60

# 停止现有服务
echo "1. 停止现有服务..."
pkill -f "message_service"
pkill -f "requirement_service" 
pkill -f "chatbot_service"
pkill -f "main.py"  # 停止旧的单体服务

sleep 3

# 1. 启动消息服务 (最重要,最稳定)
echo "2. 启动消息发送服务 (Message Service)..."
cd "$PROJECT_DIR/services/message_service"

python3 main.py > "$LOG_DIR/message_service_startup.log" 2>&1 &
MESSAGE_PID=$!

echo "   消息服务 PID: $MESSAGE_PID"

# 等待消息服务启动
echo "   等待消息服务启动..."
sleep 8

# 检查消息服务是否启动成功
if curl -s http://localhost:8080/health > /dev/null; then
    echo "   ✅ 消息服务启动成功"
else
    echo "   ❌ 消息服务启动失败，请检查日志"
    exit 1
fi

# 2. 启动需求处理服务
echo "3. 启动需求处理服务 (Requirement Service)..."
cd "$PROJECT_DIR/services/requirement_service"

python3 main.py > "$LOG_DIR/requirement_service_startup.log" 2>&1 &
REQUIREMENT_PID=$!

echo "   需求服务 PID: $REQUIREMENT_PID"

# 3. 启动聊天机器人服务
echo "4. 启动聊天机器人服务 (Chatbot Service)..."
cd "$PROJECT_DIR/services/chatbot_service"

python3 main.py > "$LOG_DIR/chatbot_service_startup.log" 2>&1 &
CHATBOT_PID=$!

echo "   聊天服务 PID: $CHATBOT_PID"

# 等待所有服务启动
echo "5. 等待所有服务完全启动..."
sleep 10

echo ""
echo "🎉 所有服务启动完成!"
echo "=" * 60
echo "服务概览:"
echo "  📡 消息服务 (Message Service)     PID: $MESSAGE_PID - http://localhost:8080"
echo "  📝 需求服务 (Requirement Service) PID: $REQUIREMENT_PID - WebSocket Client A"
echo "  💬 聊天服务 (Chatbot Service)     PID: $CHATBOT_PID - WebSocket Client B"
echo ""
echo "📊 服务状态检查:"

# 检查各服务状态
if ps -p $MESSAGE_PID > /dev/null; then
    echo "  ✅ 消息服务 - 运行中"
else
    echo "  ❌ 消息服务 - 已停止"
fi

if ps -p $REQUIREMENT_PID > /dev/null; then
    echo "  ✅ 需求服务 - 运行中"
else
    echo "  ❌ 需求服务 - 已停止"
fi

if ps -p $CHATBOT_PID > /dev/null; then
    echo "  ✅ 聊天服务 - 运行中"
else
    echo "  ❌ 聊天服务 - 已停止"
fi

echo ""
echo "📋 管理命令:"
echo "  查看状态: ./scripts/health_check.sh"
echo "  停止服务: ./scripts/stop_services.sh"
echo "  查看日志: ./scripts/view_logs.sh"
echo ""
echo "🎯 架构优势:"
echo "  - 需求调试不影响聊天功能"
echo "  - 聊天调试不影响需求处理" 
echo "  - 消息服务作为稳定基础服务"
echo "  - 独立服务可以分别重启调试"

# 保存进程ID到文件
echo "$MESSAGE_PID" > "$PROJECT_DIR/.message_service.pid"
echo "$REQUIREMENT_PID" > "$PROJECT_DIR/.requirement_service.pid" 
echo "$CHATBOT_PID" > "$PROJECT_DIR/.chatbot_service.pid"

echo ""
echo "✨ 分离式架构QQ机器人启动完成！"
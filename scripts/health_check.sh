#!/bin/bash
# QQ机器人服务健康检查脚本

PROJECT_DIR="/home/liahua/IdeaProject/qq_bot"

echo "🔍 QQ机器人服务健康检查"
echo "检查时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=" * 50

# 1. 检查消息服务
echo "1. 检查消息服务 (Message Service)..."
if curl -s http://localhost:8080/health > /dev/null; then
    # 获取详细状态
    status_response=$(curl -s http://localhost:8080/api/status)
    websocket_status=$(echo "$status_response" | grep -o '"websocket_connected":[^,]*' | cut -d':' -f2)
    uptime=$(echo "$status_response" | grep -o '"uptime_seconds":[^,]*' | cut -d':' -f2)
    
    echo "   ✅ HTTP服务 - 正常运行"
    echo "   🔗 WebSocket - $(if [ "$websocket_status" = "true" ]; then echo "已连接"; else echo "未连接"; fi)"
    echo "   ⏱️ 运行时长 - ${uptime}秒"
else
    echo "   ❌ HTTP服务 - 无法访问"
fi

echo ""

# 2. 检查进程状态
echo "2. 检查服务进程状态..."

check_service_process() {
    local service_name=$1
    local pid_file="$PROJECT_DIR/.$service_name.pid"
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if ps -p "$pid" > /dev/null 2>&1; then
            echo "   ✅ $service_name - 运行中 (PID: $pid)"
            return 0
        else
            echo "   ❌ $service_name - 进程已停止 (PID: $pid)"
            return 1
        fi
    else
        if pgrep -f "$service_name" > /dev/null; then
            local pid=$(pgrep -f "$service_name")
            echo "   ✅ $service_name - 运行中 (PID: $pid)"
            return 0
        else
            echo "   ❌ $service_name - 未运行"
            return 1
        fi
    fi
}

# 检查各个服务进程
check_service_process "message_service"
MESSAGE_STATUS=$?

check_service_process "requirement_service"
REQUIREMENT_STATUS=$?

check_service_process "chatbot_service"
CHATBOT_STATUS=$?

echo ""

# 3. 检查依赖服务
echo "3. 检查外部依赖..."

# 检查OneBot WebSocket服务器
echo "   🔌 OneBot WebSocket服务器..."
if nc -z 127.0.0.1 3001 2>/dev/null; then
    echo "      ✅ WebSocket服务器 (端口3001) - 可访问"
else
    echo "      ❌ WebSocket服务器 (端口3001) - 不可访问"
fi

# 检查MySQL数据库
echo "   🗄️ MySQL数据库..."
if nc -z localhost 3306 2>/dev/null; then
    echo "      ✅ MySQL数据库 (端口3306) - 可访问"
else
    echo "      ❌ MySQL数据库 (端口3306) - 不可访问"
fi

# 检查Claude SSH会话
echo "   🔗 Claude SSH会话..."
if tmux has-session -t claude_remote 2>/dev/null; then
    echo "      ✅ Claude远程会话 - 活跃"
else
    echo "      ❌ Claude远程会话 - 不存在"
fi

echo ""

# 4. 日志文件状态
echo "4. 检查日志文件..."
today=$(date +%Y-%m-%d)
log_dir="$PROJECT_DIR/log"

check_log_file() {
    local service=$1
    local log_file="$log_dir/${service}_${today}.log"
    
    if [ -f "$log_file" ]; then
        local size=$(stat -c%s "$log_file" 2>/dev/null || echo "0")
        local modified=$(stat -c%Y "$log_file" 2>/dev/null || echo "0")
        local current_time=$(date +%s)
        local time_diff=$((current_time - modified))
        
        echo "   📝 $service 日志 - 存在 (${size}字节, ${time_diff}秒前更新)"
    else
        echo "   📝 $service 日志 - 不存在"
    fi
}

check_log_file "message_service"
check_log_file "requirement_service"
check_log_file "chatbot_service"

echo ""

# 5. 总体健康状态评估
echo "5. 总体健康状态评估..."
total_services=3
healthy_services=0

if [ $MESSAGE_STATUS -eq 0 ]; then ((healthy_services++)); fi
if [ $REQUIREMENT_STATUS -eq 0 ]; then ((healthy_services++)); fi  
if [ $CHATBOT_STATUS -eq 0 ]; then ((healthy_services++)); fi

health_percentage=$((healthy_services * 100 / total_services))

echo "   运行中的服务: $healthy_services/$total_services"
echo "   健康度: $health_percentage%"

if [ $health_percentage -eq 100 ]; then
    echo "   🟢 系统状态: 优秀 - 所有服务正常运行"
elif [ $health_percentage -ge 66 ]; then
    echo "   🟡 系统状态: 良好 - 大部分服务正常运行"
elif [ $health_percentage -ge 33 ]; then
    echo "   🟠 系统状态: 一般 - 部分服务运行异常"
else
    echo "   🔴 系统状态: 异常 - 多数服务运行异常"
fi

echo ""
echo "💡 建议操作:"

if [ $MESSAGE_STATUS -ne 0 ]; then
    echo "   - 重启消息服务: cd services/message_service && python3 main.py"
fi

if [ $REQUIREMENT_STATUS -ne 0 ]; then
    echo "   - 重启需求服务: cd services/requirement_service && python3 main.py"
fi

if [ $CHATBOT_STATUS -ne 0 ]; then
    echo "   - 重启聊天服务: cd services/chatbot_service && python3 main.py"
fi

if [ $health_percentage -lt 100 ]; then
    echo "   - 或者重启所有服务: ./scripts/start_services.sh"
fi

echo ""
echo "📊 监控命令:"
echo "   实时监控日志: tail -f log/*_$(date +%Y-%m-%d).log"
echo "   查看服务进程: ps aux | grep -E '(message_service|requirement_service|chatbot_service)'"
echo "   测试API接口: curl http://localhost:8080/api/status"

echo ""
echo "✅ 健康检查完成!"
#!/bin/bash
# QQ机器人服务停止脚本

PROJECT_DIR="/home/liahua/IdeaProject/qq_bot"

echo "🛑 停止QQ机器人分离式服务"
echo "=" * 40

# 1. 通过PID文件停止服务
echo "1. 通过PID文件停止服务..."

stop_service_by_pid() {
    local service_name=$1
    local pid_file="$PROJECT_DIR/.$service_name.pid"
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        echo "   停止 $service_name (PID: $pid)..."
        
        if ps -p "$pid" > /dev/null 2>&1; then
            kill "$pid"
            sleep 2
            
            if ps -p "$pid" > /dev/null 2>&1; then
                echo "     进程仍在运行，强制终止..."
                kill -9 "$pid"
            fi
            
            echo "     ✅ $service_name 已停止"
        else
            echo "     ⚠️ $service_name 进程不存在"
        fi
        
        rm -f "$pid_file"
    else
        echo "   ⚠️ $service_name PID文件不存在"
    fi
}

stop_service_by_pid "message_service"
stop_service_by_pid "requirement_service"
stop_service_by_pid "chatbot_service"

echo ""

# 2. 通过进程名停止剩余进程
echo "2. 清理剩余进程..."

cleanup_processes() {
    local process_name=$1
    echo "   清理 $process_name 进程..."
    
    local pids=$(pgrep -f "$process_name")
    if [ -n "$pids" ]; then
        for pid in $pids; do
            echo "     终止进程 $pid"
            kill "$pid" 2>/dev/null
        done
        
        sleep 2
        
        # 检查是否还有残留进程
        local remaining_pids=$(pgrep -f "$process_name")
        if [ -n "$remaining_pids" ]; then
            echo "     强制终止残留进程..."
            for pid in $remaining_pids; do
                kill -9 "$pid" 2>/dev/null
            done
        fi
        
        echo "     ✅ $process_name 进程已清理"
    else
        echo "     ✅ 没有 $process_name 进程运行"
    fi
}

cleanup_processes "message_service"
cleanup_processes "requirement_service"
cleanup_processes "chatbot_service"

# 清理旧的单体服务
echo "   清理旧的main.py进程..."
pkill -f "main.py" 2>/dev/null
echo "     ✅ 旧服务进程已清理"

echo ""

# 3. 验证停止结果
echo "3. 验证停止结果..."

check_service_stopped() {
    local service_name=$1
    if pgrep -f "$service_name" > /dev/null; then
        echo "   ❌ $service_name - 仍在运行"
        return 1
    else
        echo "   ✅ $service_name - 已停止"
        return 0
    fi
}

check_service_stopped "message_service"
MESSAGE_STOPPED=$?

check_service_stopped "requirement_service"
REQUIREMENT_STOPPED=$?

check_service_stopped "chatbot_service"
CHATBOT_STOPPED=$?

echo ""

# 4. 检查端口占用
echo "4. 检查端口占用..."
echo "   检查8080端口 (HTTP服务)..."
if netstat -tuln 2>/dev/null | grep -q ":8080 "; then
    echo "     ⚠️ 端口8080仍被占用"
    netstat -tuln | grep ":8080 "
else
    echo "     ✅ 端口8080已释放"
fi

echo ""

# 5. 清理临时文件
echo "5. 清理临时文件..."
echo "   清理PID文件..."
rm -f "$PROJECT_DIR"/.*.pid
echo "     ✅ PID文件已清理"

echo "   清理群聊配置文件..."
find "$PROJECT_DIR/services" -name "group_config.json" -delete 2>/dev/null
echo "     ✅ 临时配置文件已清理"

echo ""

# 6. 汇总停止结果
total_services=3
stopped_services=0

if [ $MESSAGE_STOPPED -eq 0 ]; then ((stopped_services++)); fi
if [ $REQUIREMENT_STOPPED -eq 0 ]; then ((stopped_services++)); fi
if [ $CHATBOT_STOPPED -eq 0 ]; then ((stopped_services++)); fi

echo "6. 停止结果汇总:"
echo "   已停止的服务: $stopped_services/$total_services"

if [ $stopped_services -eq $total_services ]; then
    echo "   🟢 所有服务已成功停止"
    echo ""
    echo "✅ QQ机器人服务完全停止!"
    echo ""
    echo "💡 重新启动命令:"
    echo "   ./scripts/start_services.sh"
else
    echo "   🟡 部分服务可能仍在运行"
    echo ""
    echo "⚠️ 服务停止不完整"
    echo ""
    echo "💡 手动检查命令:"
    echo "   ps aux | grep -E '(message_service|requirement_service|chatbot_service)'"
    echo "   kill -9 <PID>  # 强制终止进程"
fi

echo ""
echo "📊 系统状态:"
echo "   HTTP端口8080: $(if netstat -tuln 2>/dev/null | grep -q ':8080 '; then echo '占用中'; else echo '已释放'; fi)"
echo "   进程数量: $(pgrep -f '_service' | wc -l)"
echo "   临时文件: $(ls -la "$PROJECT_DIR"/.*.pid 2>/dev/null | wc -l)个PID文件"
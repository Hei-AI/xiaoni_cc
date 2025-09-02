#!/bin/bash
#
# QQ Bot Services Manager
# 统一管理三个独立服务的启动脚本
#

# 服务配置
MESSAGE_SERVICE_DIR="message_service"
REQUIREMENT_SERVICE_DIR="requirement_service" 
CHATBOT_SERVICE_DIR="chatbot_service"
ADMIN_SERVICE_DIR="admin_service"
MAIN_SERVICE_DIR="main"

# 日志目录
LOG_DIR="logs"
mkdir -p $LOG_DIR

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')] $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️ $1${NC}"
}

# 检查服务状态
check_service_status() {
    local service_name=$1
    local port=$2
    
    if curl -s "http://127.0.0.1:$port/health" > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# 停止服务
stop_service() {
    local service_name=$1
    print_status "Stopping $service_name..."
    
    pkill -f "python3.*$service_name" 2>/dev/null
    sleep 2
    
    # 强制终止如果还在运行
    if pgrep -f "python3.*$service_name" > /dev/null; then
        pkill -9 -f "python3.*$service_name" 2>/dev/null
        sleep 1
    fi
    
    print_success "$service_name stopped"
}

# 启动单个服务
start_service() {
    local service_name=$1
    local service_dir=$2
    local port=$3
    
    print_status "Starting $service_name..."
    
    if [ ! -d "$service_dir" ]; then
        print_error "$service_dir directory not found"
        return 1
    fi
    
    cd "$service_dir"
    
    # 检查依赖
    if [ -f "requirements.txt" ]; then
        pip install -r requirements.txt > /dev/null 2>&1
    fi
    
    # 启动服务
    if [ "$service_name" = "main_service" ]; then
        nohup python3 main.py > "../$LOG_DIR/${service_name}.log" 2>&1 &
    else
        nohup python3 run.py > "../$LOG_DIR/${service_name}.log" 2>&1 &
    fi
    
    local pid=$!
    sleep 3
    
    # 检查服务是否成功启动
    if [ "$port" != "none" ] && check_service_status "$service_name" "$port"; then
        print_success "$service_name started successfully (PID: $pid, Port: $port)"
    elif ps -p $pid > /dev/null 2>&1; then
        print_success "$service_name started successfully (PID: $pid)"
    else
        print_error "$service_name failed to start"
        cat "../$LOG_DIR/${service_name}.log" | tail -10
        return 1
    fi
    
    cd ..
    return 0
}

# 显示服务状态
show_status() {
    print_status "Checking service status..."
    echo
    
    echo "Service Status:"
    echo "==============="
    
    # Message Service
    if check_service_status "message_service" "8080"; then
        echo -e "Message Service (HTTP): ${GREEN}Running${NC} (Port: 8080)"
    else
        echo -e "Message Service (HTTP): ${RED}Stopped${NC} (Port: 8080)"
    fi
    
    # Requirement Service
    if pgrep -f "requirement_service" > /dev/null; then
        echo -e "Requirement Service:    ${GREEN}Running${NC}"
    else
        echo -e "Requirement Service:    ${RED}Stopped${NC}"
    fi
    
    # Chatbot Service  
    if pgrep -f "chatbot_service" > /dev/null; then
        echo -e "Chatbot Service:        ${GREEN}Running${NC}"
    else
        echo -e "Chatbot Service:        ${RED}Stopped${NC}"
    fi
    
    # Admin Service
    if check_service_status "admin_service" "8081"; then
        echo -e "Admin Service (HTTP):   ${GREEN}Running${NC} (Port: 8081)"
    else
        echo -e "Admin Service (HTTP):   ${RED}Stopped${NC} (Port: 8081)"
    fi
    
    # Main Service (Legacy)
    if pgrep -f "main.py" > /dev/null; then
        echo -e "Main Service (Legacy):  ${GREEN}Running${NC}"
    else
        echo -e "Main Service (Legacy):  ${RED}Stopped${NC}"
    fi
    
    echo
    echo "Process List:"
    echo "============="
    ps aux | grep -E "(message_service|requirement_service|chatbot_service|main.py)" | grep -v grep || echo "No services running"
}

# 启动所有服务
start_all() {
    print_status "Starting all QQ Bot services..."
    
    # 停止所有现有服务
    stop_service "message_service"
    stop_service "requirement_service" 
    stop_service "chatbot_service"
    stop_service "admin_service"
    stop_service "main.py"
    
    echo
    
    # 按顺序启动服务
    # 1. Message Service (HTTP服务器，其他服务依赖)
    start_service "message_service" "$MESSAGE_SERVICE_DIR" "8080"
    sleep 2
    
    # 2. Requirement Service (需求处理)
    start_service "requirement_service" "$REQUIREMENT_SERVICE_DIR" "none"
    sleep 2
    
    # 3. Chatbot Service (聊天机器人)
    start_service "chatbot_service" "$CHATBOT_SERVICE_DIR" "none"
    sleep 2
    
    # 4. Admin Service (管理后台)
    start_service "admin_service" "$ADMIN_SERVICE_DIR" "8081"
    
    echo
    show_status
}

# 停止所有服务
stop_all() {
    print_status "Stopping all QQ Bot services..."
    
    stop_service "message_service"
    stop_service "requirement_service"
    stop_service "chatbot_service"
    stop_service "admin_service"
    stop_service "main.py"
    
    print_success "All services stopped"
}

# 重启所有服务
restart_all() {
    print_status "Restarting all QQ Bot services..."
    stop_all
    sleep 2
    start_all
}

# 查看日志
show_logs() {
    local service=${1:-"all"}
    
    case $service in
        "message"|"msg")
            tail -f "$LOG_DIR/message_service.log"
            ;;
        "requirement"|"req")  
            tail -f "$LOG_DIR/requirement_service.log"
            ;;
        "chatbot"|"chat")
            tail -f "$LOG_DIR/chatbot_service.log"
            ;;
        "admin")
            tail -f "$LOG_DIR/admin_service.log"
            ;;
        "main")
            tail -f "$LOG_DIR/main_service.log"
            ;;
        "all"|*)
            echo "Available log files:"
            ls -la "$LOG_DIR"/*.log 2>/dev/null || echo "No log files found"
            ;;
    esac
}

# 健康检查
health_check() {
    print_status "Running health check..."
    
    # 检查HTTP服务
    if check_service_status "message_service" "8080"; then
        print_success "Message Service HTTP endpoint is healthy"
    else
        print_error "Message Service HTTP endpoint is unhealthy"
    fi
    
    # 检查管理后台服务
    if check_service_status "admin_service" "8081"; then
        print_success "Admin Service HTTP endpoint is healthy"
    else
        print_error "Admin Service HTTP endpoint is unhealthy"
    fi
    
    # 检查数据库连接
    if docker ps | grep -q "qqbot_mysql"; then
        print_success "MySQL database container is running"
    else
        print_warning "MySQL database container is not running"
    fi
}

# 显示帮助
show_help() {
    echo "QQ Bot Services Manager"
    echo "======================"
    echo
    echo "Usage: $0 [COMMAND]"
    echo
    echo "Commands:"
    echo "  start     - Start all services"
    echo "  stop      - Stop all services"
    echo "  restart   - Restart all services"
    echo "  status    - Show service status"
    echo "  logs [SERVICE] - Show logs (message|requirement|chatbot|admin|main|all)"
    echo "  health    - Run health check"
    echo "  help      - Show this help message"
    echo
    echo "Examples:"
    echo "  $0 start"
    echo "  $0 logs message"
    echo "  $0 status"
}

# 主要命令处理
case ${1:-"help"} in
    "start")
        start_all
        ;;
    "stop")
        stop_all
        ;;
    "restart")
        restart_all
        ;;
    "status")
        show_status
        ;;
    "logs")
        show_logs $2
        ;;
    "health")
        health_check
        ;;
    "help"|*)
        show_help
        ;;
esac
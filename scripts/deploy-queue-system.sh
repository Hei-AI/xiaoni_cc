#!/bin/bash

# QQ Bot 队列系统一键部署脚本
# 功能：
# 1. 部署Redis + Bull Board + 队列监控服务
# 2. 集成到现有管理面板
# 3. 健康检查和服务验证

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查依赖
check_dependencies() {
    log_info "检查依赖..."
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker 未安装，请先安装 Docker"
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose 未安装，请先安装 Docker Compose"
        exit 1
    fi
    
    log_success "依赖检查通过"
}

# 创建必要的目录
create_directories() {
    log_info "创建必要的目录..."
    
    mkdir -p logs/queue-monitor
    mkdir -p logs/redis
    mkdir -p modules/queue-monitor/src
    
    log_success "目录创建完成"
}

# 生成环境变量文件
generate_env_file() {
    log_info "生成环境变量文件..."
    
    if [ ! -f .env.queue ]; then
        cat > .env.queue << EOF
# Redis配置
REDIS_PASSWORD=qqbot123
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DB=0

# Redis管理员配置
REDIS_ADMIN_USER=admin
REDIS_ADMIN_PASSWORD=admin123

# 队列监控配置
QUEUE_MONITOR_URL=http://localhost:3007
MONITOR_INTERVAL=10000
LOG_LEVEL=info
EOF
        log_success "环境变量文件已生成: .env.queue"
    else
        log_info "环境变量文件已存在，跳过生成"
    fi
}

# 构建队列监控服务
build_queue_monitor() {
    log_info "构建队列监控服务..."
    
    cd modules/queue-monitor
    
    # 安装依赖
    if [ -f package.json ]; then
        npm install
        log_success "队列监控服务依赖安装完成"
        
        # 编译TypeScript
        npm run build
        log_success "队列监控服务编译完成"
    else
        log_warning "package.json 不存在，跳过依赖安装"
    fi
    
    cd ../..
}

# 启动队列服务
start_queue_services() {
    log_info "启动队列服务..."
    
    # 使用环境变量文件启动
    docker-compose --env-file .env.queue -f docker-compose.queue.yml up -d
    
    log_success "队列服务启动完成"
}

# 等待服务就绪
wait_for_services() {
    log_info "等待服务就绪..."
    
    local max_attempts=30
    local attempt=0
    
    # 等待Redis
    while [ $attempt -lt $max_attempts ]; do
        if docker exec qqbot-redis redis-cli ping &>/dev/null; then
            log_success "Redis 服务就绪"
            break
        fi
        
        attempt=$((attempt + 1))
        log_info "等待Redis启动... ($attempt/$max_attempts)"
        sleep 2
    done
    
    if [ $attempt -eq $max_attempts ]; then
        log_error "Redis 启动超时"
        return 1
    fi
    
    # 等待队列监控服务
    attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if curl -f http://localhost:3007/health &>/dev/null; then
            log_success "队列监控服务就绪"
            break
        fi
        
        attempt=$((attempt + 1))
        log_info "等待队列监控服务启动... ($attempt/$max_attempts)"
        sleep 2
    done
    
    if [ $attempt -eq $max_attempts ]; then
        log_error "队列监控服务启动超时"
        return 1
    fi
    
    # 等待Bull Board
    attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if curl -f http://localhost:3005 &>/dev/null; then
            log_success "Bull Board 就绪"
            break
        fi
        
        attempt=$((attempt + 1))
        log_info "等待Bull Board启动... ($attempt/$max_attempts)"
        sleep 2
    done
    
    if [ $attempt -eq $max_attempts ]; then
        log_warning "Bull Board 启动超时，但不影响核心功能"
    fi
}

# 健康检查
health_check() {
    log_info "执行健康检查..."
    
    local all_healthy=true
    
    # 检查Redis
    if docker exec qqbot-redis redis-cli ping &>/dev/null; then
        log_success "✓ Redis 健康"
    else
        log_error "✗ Redis 不健康"
        all_healthy=false
    fi
    
    # 检查队列监控服务
    if curl -f http://localhost:3007/health &>/dev/null; then
        log_success "✓ 队列监控服务健康"
    else
        log_error "✗ 队列监控服务不健康"
        all_healthy=false
    fi
    
    # 检查Bull Board
    if curl -f http://localhost:3005 &>/dev/null; then
        log_success "✓ Bull Board 健康"
    else
        log_warning "✗ Bull Board 不可访问"
    fi
    
    # 检查Redis Commander
    if curl -f http://localhost:3006 &>/dev/null; then
        log_success "✓ Redis Commander 健康"
    else
        log_warning "✗ Redis Commander 不可访问"
    fi
    
    if [ "$all_healthy" = true ]; then
        log_success "所有核心服务健康检查通过"
        return 0
    else
        log_error "健康检查失败"
        return 1
    fi
}

# 显示服务信息
show_service_info() {
    log_info "队列系统部署完成！"
    echo ""
    echo "🎯 服务访问地址："
    echo "  📊 Bull Board (队列UI):    http://localhost:3005"
    echo "  🔧 Redis Commander:       http://localhost:3006"
    echo "  📈 队列监控API:           http://localhost:3007"
    echo "  🏠 管理面板:              http://localhost:3003"
    echo ""
    echo "🔑 默认账号密码："
    echo "  Redis: qqbot123"
    echo "  Redis Commander: admin/admin123"
    echo ""
    echo "📋 常用命令："
    echo "  查看服务状态: docker-compose -f docker-compose.queue.yml ps"
    echo "  查看日志:     docker-compose -f docker-compose.queue.yml logs -f"
    echo "  停止服务:     docker-compose -f docker-compose.queue.yml down"
    echo "  重启服务:     docker-compose -f docker-compose.queue.yml restart"
    echo ""
    echo "🔍 调试信息："
    echo "  Redis连接测试: docker exec qqbot-redis redis-cli ping"
    echo "  队列监控健康: curl http://localhost:3007/health"
    echo "  查看队列列表: curl http://localhost:3007/api/queues"
}

# 集成到管理面板
integrate_admin_panel() {
    log_info "集成到管理面板..."
    
    # 检查管理面板后端是否需要添加路由
    if grep -q "queue-monitor" modules/admin-panel/backend/src/index.ts; then
        log_info "队列监控路由已集成到管理面板"
    else
        log_warning "需要手动添加队列监控路由到管理面板后端"
        echo ""
        echo "请在 modules/admin-panel/backend/src/index.ts 中添加："
        echo "import queueMonitorRoutes from './routes/queue-monitor';"
        echo "app.use('/api/queue-monitor', queueMonitorRoutes);"
    fi
    
    # 检查前端路由
    if [ -f "modules/admin-panel/frontend/src/pages/QueueManagementPage.tsx" ]; then
        log_success "队列管理页面已创建"
    else
        log_warning "队列管理页面不存在，请确认文件是否正确创建"
    fi
}

# 主要部署流程
main() {
    log_info "开始部署QQ Bot队列系统..."
    
    check_dependencies
    create_directories
    generate_env_file
    build_queue_monitor
    start_queue_services
    wait_for_services
    
    if health_check; then
        integrate_admin_panel
        show_service_info
        log_success "🎉 队列系统部署成功！"
    else
        log_error "部署过程中出现问题，请检查日志"
        docker-compose -f docker-compose.queue.yml logs
        exit 1
    fi
}

# 处理命令行参数
case "${1:-}" in
    "start")
        start_queue_services
        wait_for_services
        health_check
        ;;
    "stop")
        log_info "停止队列服务..."
        docker-compose -f docker-compose.queue.yml down
        log_success "队列服务已停止"
        ;;
    "restart")
        log_info "重启队列服务..."
        docker-compose -f docker-compose.queue.yml restart
        wait_for_services
        health_check
        ;;
    "status")
        log_info "检查服务状态..."
        docker-compose -f docker-compose.queue.yml ps
        health_check
        ;;
    "logs")
        docker-compose -f docker-compose.queue.yml logs -f
        ;;
    "clean")
        log_info "清理队列系统..."
        docker-compose -f docker-compose.queue.yml down -v
        docker system prune -f
        log_success "清理完成"
        ;;
    *)
        main
        ;;
esac
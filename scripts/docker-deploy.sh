#!/bin/bash

# QQ Bot Docker 独立部署脚本 (支持实时LLM配置系统)
# 用法: ./scripts/docker-deploy.sh [module] [action]
# 模块: http-api, qqbot-core, admin-backend, admin-frontend, all
# 动作: build, run, stop, remove, logs, init-db, update-config

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的信息
info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查Docker是否安装
check_docker() {
    if ! command -v docker &> /dev/null; then
        error "Docker 未安装，请先安装Docker"
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        error "Docker 服务未运行，请启动Docker"
        exit 1
    fi
}

# 创建日志目录和Docker网络
create_log_dirs() {
    info "创建日志目录..."

    # 只创建不存在的目录，不修改已存在文件的权限
    for dir in logs logs/http-api logs/qqbot-core logs/admin-backend logs/admin-frontend; do
        if [ ! -d "$dir" ]; then
            mkdir -p "$dir"
            chmod 755 "$dir" 2>/dev/null || true
        fi
    done

    # 创建Docker网络（如果不存在）
    if ! docker network ls | grep -q "qq_bot_network"; then
        info "创建Docker bridge网络: qq_bot_network"
        docker network create --driver bridge qq_bot_network
    fi

    success "日志目录和网络就绪"
}

# 构建镜像
build_image() {
    local module=$1
    local image_name="qqbot-${module}"
    local build_dir=""
    
    case $module in
        "http-api")
            build_dir="modules/http-api"
            ;;
        "qqbot-core")
            build_dir="modules/qqbot-core"
            ;;
        "admin-backend")
            build_dir="modules/admin-panel/backend"
            ;;
        "admin-frontend")
            build_dir="modules/admin-panel/frontend"
            ;;
        *)
            error "未知模块: $module"
            return 1
            ;;
    esac
    
    if [ ! -d "$build_dir" ]; then
        error "模块目录不存在: $build_dir"
        return 1
    fi
    
    info "构建 $module 镜像..."

    docker build \
        --build-arg HTTP_PROXY= \
        --build-arg HTTPS_PROXY= \
        --build-arg http_proxy= \
        --build-arg https_proxy= \
        --build-arg NO_PROXY= \
        --build-arg no_proxy= \
        -t "$image_name" "$build_dir"

    success "$module 镜像构建完成"
}

# 运行容器
run_container() {
    local module=$1
    local container_name="qqbot-${module}"
    local image_name="qqbot-${module}"
    
    # 如果容器已存在，先停止并删除
    if docker ps -a --format '{{.Names}}' | grep -q "^${container_name}$"; then
        warn "容器 $container_name 已存在，正在重新创建..."
        docker stop "$container_name" 2>/dev/null || true
        docker rm "$container_name" 2>/dev/null || true
    fi
    
    case $module in
        "http-api")
            docker run -d \
                --name "$container_name" \
                --network qq_bot_network \
                -p 8080:8080 \
                -v "$(pwd)/logs/http-api:/app/logs" \
                -e QQBOT_CORE_URL=http://qqbot-qqbot-core:8081 \
                -e HTTP_PORT=8080 \
                -e LOG_LEVEL=info \
                -e NODE_TLS_REJECT_UNAUTHORIZED=0 \
                --restart unless-stopped \
                "$image_name"
            ;;
        "qqbot-core")
            docker run -d \
                --name "$container_name" \
                --network qq_bot_network \
                --dns 8.8.8.8 \
                --dns 1.1.1.1 \
                -p 8081:8081 \
                -v "$(pwd)/logs/qqbot-core:/app/logs" \
                -v "$(pwd)/modules/qqbot-core/resources/config:/app/resources/config" \
                -e MYSQL_HOST=qqbot-mysql \
                -e MYSQL_PORT=3306 \
                -e MYSQL_USER=${MYSQL_USER:-qqbot_user} \
                -e MYSQL_PASSWORD=${MYSQL_PASSWORD:-qqbot_password} \
                -e MYSQL_DATABASE=${MYSQL_DATABASE:-qqbot_db} \
                -e BOT_QQ_NUMBER=${BOT_QQ_NUMBER:-1129974489} \
                -e GEMINI_API_KEY=${GEMINI_API_KEY} \
                -e WEBSOCKET_HOST=${WEBSOCKET_HOST:-napcat} \
                -e WEBSOCKET_PORT=${WEBSOCKET_PORT:-3001} \
                -e WEBSOCKET_ACCESS_TOKEN=${WEBSOCKET_ACCESS_TOKEN:-w@123456} \
                -e HTTP_PORT=8081 \
                -e LOG_LEVEL=info \
                -e NODE_TLS_REJECT_UNAUTHORIZED=0 \
                -e ENABLE_LLM_TOOLS=${ENABLE_LLM_TOOLS:-true} \
                -e LLM_MAX_CONCURRENT_JOBS=${LLM_MAX_CONCURRENT_JOBS:-5} \
                -e LLM_POLL_INTERVAL_MS=${LLM_POLL_INTERVAL_MS:-1000} \
                -e LLM_JOB_TIMEOUT_MS=${LLM_JOB_TIMEOUT_MS:-300000} \
                -e LLM_RETRY_DELAY_MS=${LLM_RETRY_DELAY_MS:-5000} \
                --restart unless-stopped \
                "$image_name"
            ;;
        "admin-backend")
            docker run -d \
                --name "$container_name" \
                --network qq_bot_network \
                -p 9080:9080 \
                -v "$(pwd)/logs/admin-backend:/app/logs" \
                -v "$(pwd)/logs/qqbot-traffic:/app/logs/traffic:ro" \
                -v "$(pwd)/modules/admin-panel/backend/resources/uploads:/app/resources/uploads" \
                -e DB_HOST=qqbot-mysql \
                -e DB_PORT=3306 \
                -e DB_USER=${DB_USER:-qqbot_user} \
                -e DB_PASSWORD=${DB_PASSWORD:-qqbot_password} \
                -e DB_NAME=${DB_NAME:-qqbot_db} \
                -e ADMIN_PORT=9080 \
                -e QQBOT_CORE_URL=http://qqbot-qqbot-core:8081 \
                -e LOG_LEVEL=info \
                -e NODE_TLS_REJECT_UNAUTHORIZED=0 \
                --restart unless-stopped \
                "$image_name"
            ;;
        "admin-frontend")
            docker run -d \
                --name "$container_name" \
                --network qq_bot_network \
                -p 3003:80 \
                -v "$(pwd)/logs/admin-frontend:/var/log/nginx" \
                -e VITE_API_BASE_URL=http://admin-backend:9080 \
                --restart unless-stopped \
                "$image_name"
            ;;
    esac
    
    success "$module 容器启动完成"
}

# 停止容器
stop_container() {
    local module=$1
    local container_name="qqbot-${module}"
    
    if docker ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
        info "停止容器: $container_name"
        docker stop "$container_name"
        success "容器 $container_name 已停止"
    else
        warn "容器 $container_name 未运行"
    fi
}

# 删除容器
remove_container() {
    local module=$1
    local container_name="qqbot-${module}"
    
    stop_container "$module"
    
    if docker ps -a --format '{{.Names}}' | grep -q "^${container_name}$"; then
        info "删除容器: $container_name"
        docker rm "$container_name"
        success "容器 $container_name 已删除"
    else
        warn "容器 $container_name 不存在"
    fi
}

# 查看日志
show_logs() {
    local module=$1
    local container_name="qqbot-${module}"
    
    if docker ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
        info "显示容器 $container_name 的日志..."
        docker logs -f "$container_name"
    else
        error "容器 $container_name 未运行"
        return 1
    fi
}

# 显示状态
show_status() {
    info "QQ Bot 容器状态:"
    echo
    docker ps -a --filter "name=qqbot-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo
    
    info "镜像列表:"
    echo
    docker images --filter "reference=qqbot-*" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"
}

# 处理所有模块
handle_all() {
    local action=$1
    local modules=("http-api" "qqbot-core" "admin-backend" "admin-frontend")

    for module in "${modules[@]}"; do
        case $action in
            "build")
                build_image "$module"
                ;;
            "run")
                run_container "$module"
                ;;
            "stop")
                stop_container "$module"
                ;;
            "remove")
                remove_container "$module"
                ;;
        esac
    done
}

# 🆕 初始化数据库 (支持实时LLM配置)
init_database() {
    info "初始化数据库 (包含实时LLM配置系统)..."

    # 检查MySQL容器是否运行
    if ! docker ps --format '{{.Names}}' | grep -q mysql; then
        error "未找到运行中的MySQL容器，请先启动MySQL容器"
        info "如果使用外部MySQL，请确保MySQL服务可访问"
        return 1
    fi

    # 获取项目根目录
    local project_root=$(cd "$(dirname "$0")/.." && pwd)
    local init_script="${project_root}/scripts/init-database-docker.sql"

    if [ ! -f "$init_script" ]; then
        error "数据库初始化脚本不存在: $init_script"
        return 1
    fi

    # 执行数据库初始化
    info "执行数据库初始化脚本..."
    docker exec -i $(docker ps --format '{{.Names}}' | grep mysql | head -1) \
        mysql -u root -p${MYSQL_ROOT_PASSWORD:-rootpassword} < "$init_script"

    if [ $? -eq 0 ]; then
        success "数据库初始化完成！"
        success "实时LLM配置系统已就绪！"
    else
        error "数据库初始化失败"
        return 1
    fi
}

# 🆕 更新LLM配置 (热更新)
update_llm_config() {
    info "更新LLM配置到数据库..."

    local project_root=$(cd "$(dirname "$0")/.." && pwd)
    local config_script="${project_root}/database/migrations/005_extend_agent_prompts_advanced_configs.sql"

    if [ ! -f "$config_script" ]; then
        error "LLM配置更新脚本不存在: $config_script"
        return 1
    fi

    # 执行配置更新
    info "执行LLM配置更新..."
    docker exec -i $(docker ps --format '{{.Names}}' | grep mysql | head -1) \
        mysql -u qqbot_user -pqqbot_password qqbot_db < "$config_script"

    if [ $? -eq 0 ]; then
        success "LLM配置更新完成！"
        info "配置将在下次AI调用时自动生效"
    else
        error "LLM配置更新失败"
        return 1
    fi
}

# 🆕 测试LLM配置API
test_llm_config() {
    info "测试实时LLM配置API..."

    # 检查Admin Backend是否运行
    if ! docker ps --format '{{.Names}}' | grep -q "qqbot-admin-backend"; then
        error "Admin Backend容器未运行，请先启动"
        return 1
    fi

    # 获取Admin Backend端口
    local admin_port=$(docker port qqbot-admin-backend 9080 2>/dev/null | cut -d: -f2)
    if [ -z "$admin_port" ]; then
        admin_port="9080"
    fi

    # 测试API端点
    info "测试Agent列表API..."
    curl -s "http://localhost:${admin_port}/api/llm-config/agents" | jq . > /dev/null
    if [ $? -eq 0 ]; then
        success "Agent列表API测试通过"
    else
        error "Agent列表API测试失败"
    fi

    info "测试工具列表API..."
    curl -s "http://localhost:${admin_port}/api/llm-config/tools" | jq . > /dev/null
    if [ $? -eq 0 ]; then
        success "工具列表API测试通过"
    else
        error "工具列表API测试失败"
    fi

    info "LLM配置API测试完成"
    info "管理界面: http://localhost:3003"
    info "API文档: http://localhost:${admin_port}/api/llm-config/"
}

# 显示使用帮助
show_help() {
    echo "QQ Bot Docker 独立部署脚本 (支持实时LLM配置系统)"
    echo
    echo "用法: $0 [module] [action]"
    echo
    echo "模块 (module):"
    echo "  http-api         - HTTP API Gateway"
    echo "  qqbot-core       - QQBot Core Service"
    echo "  admin-backend    - Admin Panel Backend"
    echo "  admin-frontend   - Admin Panel Frontend"
    echo "  all              - 所有模块"
    echo
    echo "动作 (action):"
    echo "  build       - 构建Docker镜像"
    echo "  run         - 运行Docker容器"
    echo "  stop        - 停止Docker容器"
    echo "  remove      - 删除Docker容器"
    echo "  logs        - 查看容器日志"
    echo "  status      - 显示状态"
    echo "  init-db     - 初始化数据库 (包含LLM配置系统) 🆕"
    echo "  update-config - 更新LLM配置到数据库 🆕"
    echo "  test-config   - 测试LLM配置API 🆕"
    echo
    echo "示例:"
    echo "  $0 qqbot-core build    # 构建QQBot Core镜像"
    echo "  $0 all run             # 运行所有容器（推荐）"
    echo "  $0 http-api logs       # 查看HTTP API日志"
    echo "  $0 all init-db         # 初始化数据库 (包含LLM配置) 🆕"
    echo "  $0 all update-config   # 更新LLM配置 🆕"
    echo "  $0 all test-config     # 测试LLM配置API 🆕"
    echo
    echo "流量监控:"
    echo "  当前使用 mitmproxy 透明代理方案（WSL2宿主机运行）"
    echo "  管理工具: modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py"
    echo "  启动: python3 mitmproxy_manager.py start --iptables"
    echo "  停止: python3 mitmproxy_manager.py stop --cleanup"
    echo "  状态: python3 mitmproxy_manager.py status"
    echo
    echo "环境变量:"
    echo "  DB_USER, DB_PASSWORD, DB_NAME"
    echo "  BOT_QQ_NUMBER, GEMINI_API_KEY"
    echo "  WEBSOCKET_HOST, WEBSOCKET_PORT"
}

# 主函数
main() {
    local module=${1:-""}
    local action=${2:-""}
    
    if [ -z "$module" ] || [ -z "$action" ]; then
        show_help
        exit 1
    fi
    
    check_docker
    create_log_dirs
    
    case $action in
        "build")
            if [ "$module" = "all" ]; then
                handle_all "$action"
            else
                build_image "$module"
            fi
            ;;
        "run")
            if [ "$module" = "all" ]; then
                handle_all "$action"
            else
                run_container "$module"
            fi
            ;;
        "stop")
            if [ "$module" = "all" ]; then
                handle_all "$action"
            else
                stop_container "$module"
            fi
            ;;
        "remove")
            if [ "$module" = "all" ]; then
                handle_all "$action"
            else
                remove_container "$module"
            fi
            ;;
        "logs")
            if [ "$module" = "all" ]; then
                error "logs 操作不支持 all，请指定具体模块"
                exit 1
            fi
            show_logs "$module"
            ;;
        "status")
            show_status
            ;;
        "init-db")
            init_database
            ;;
        "update-config")
            update_llm_config
            ;;
        "test-config")
            test_llm_config
            ;;
        *)
            error "未知操作: $action"
            show_help
            exit 1
            ;;
    esac
}

# 执行主函数
main "$@"

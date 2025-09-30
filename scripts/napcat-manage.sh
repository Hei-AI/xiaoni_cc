#!/bin/bash

# NapCat独立管理脚本
# 专门用于管理稳定的NapCat服务，与主业务服务解耦
# 用法: ./scripts/napcat-manage.sh [action]
# 动作: start, stop, restart, status, logs, health, backup, restore

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的信息
info() {
    echo -e "${BLUE}[NAPCAT]${NC} $1"
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

# 获取脚本目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.napcat.yml"

# 检查Docker和compose文件
check_prerequisites() {
    if ! command -v docker &> /dev/null; then
        error "Docker 未安装，请先安装Docker"
        exit 1
    fi

    if ! docker info &> /dev/null; then
        error "Docker 服务未运行，请启动Docker"
        exit 1
    fi

    if [[ ! -f "$COMPOSE_FILE" ]]; then
        error "NapCat compose文件不存在: $COMPOSE_FILE"
        exit 1
    fi
}

# 创建必要的目录
create_directories() {
    info "创建NapCat数据目录..."
    mkdir -p "$PROJECT_ROOT/resource/napcat_config"
    mkdir -p "$PROJECT_ROOT/resource/napcat_qq_data"
    mkdir -p "$PROJECT_ROOT/logs/napcat"

    # 设置权限
    chmod 755 "$PROJECT_ROOT/resource/napcat_config"
    chmod 755 "$PROJECT_ROOT/resource/napcat_qq_data"
    chmod 755 "$PROJECT_ROOT/logs/napcat"
}

# 启动NapCat服务
start_napcat() {
    info "启动NapCat稳定服务..."

    # 检查是否已有旧容器运行
    if docker ps -q -f name=napcat-stable > /dev/null 2>&1; then
        warn "NapCat容器已在运行"
        docker ps --filter name=napcat-stable --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
        return 0
    fi

    create_directories

    # 使用独立的compose文件启动
    docker-compose -f "$COMPOSE_FILE" up -d

    # 等待服务启动
    info "等待NapCat服务启动..."
    sleep 10

    # 检查健康状态
    check_health

    success "NapCat服务启动完成"
    docker ps --filter name=napcat-stable --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
}

# 停止NapCat服务
stop_napcat() {
    info "停止NapCat服务..."

    docker-compose -f "$COMPOSE_FILE" down

    success "NapCat服务已停止"
}

# 重启NapCat服务
restart_napcat() {
    info "重启NapCat服务..."

    stop_napcat
    sleep 5
    start_napcat
}

# 检查服务状态
check_status() {
    info "检查NapCat服务状态..."

    if docker ps -q -f name=napcat-stable > /dev/null 2>&1; then
        success "NapCat容器正在运行"
        docker ps --filter name=napcat-stable --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

        # 显示详细信息
        echo ""
        info "容器详细信息:"
        docker inspect napcat-stable --format "{{.Name}}: {{.State.Status}} ({{.State.StartedAt}})"
        docker inspect napcat-stable --format "Health: {{.State.Health.Status}}"

        # 显示资源使用
        echo ""
        info "资源使用情况:"
        docker stats napcat-stable --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
    else
        warn "NapCat容器未运行"

        # 检查是否有其他napcat容器
        OTHER_NAPCAT=$(docker ps -a --filter name=napcat --format "{{.Names}}" | grep -v napcat-stable || true)
        if [[ -n "$OTHER_NAPCAT" ]]; then
            info "发现其他NapCat容器:"
            echo "$OTHER_NAPCAT"
        fi
    fi
}

# 查看实时日志
show_logs() {
    info "显示NapCat实时日志..."

    if docker ps -q -f name=napcat-stable > /dev/null 2>&1; then
        docker logs -f napcat-stable
    else
        error "NapCat容器未运行"
        exit 1
    fi
}

# 健康检查
check_health() {
    info "执行NapCat健康检查..."

    if ! docker ps -q -f name=napcat-stable > /dev/null 2>&1; then
        error "NapCat容器未运行"
        return 1
    fi

    # 检查HTTP端口
    if curl -f -s http://localhost:3000/api/status > /dev/null 2>&1; then
        success "HTTP API (3000端口) 正常"
    else
        warn "HTTP API (3000端口) 无响应"
    fi

    # 检查WebSocket端口 (简单端口检查)
    if nc -z localhost 3001 2>/dev/null; then
        success "WebSocket (3001端口) 正常"
    else
        warn "WebSocket (3001端口) 无响应"
    fi

    # 检查容器健康状态
    HEALTH_STATUS=$(docker inspect napcat-stable --format "{{.State.Health.Status}}" 2>/dev/null || echo "unknown")
    case "$HEALTH_STATUS" in
        "healthy")
            success "容器健康检查: $HEALTH_STATUS"
            ;;
        "unhealthy")
            error "容器健康检查: $HEALTH_STATUS"
            return 1
            ;;
        "starting")
            warn "容器健康检查: $HEALTH_STATUS"
            ;;
        *)
            warn "容器健康检查: $HEALTH_STATUS"
            ;;
    esac
}

# 备份NapCat配置和数据
backup_napcat() {
    info "备份NapCat配置和数据..."

    BACKUP_DIR="$PROJECT_ROOT/backups/napcat"
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_FILE="$BACKUP_DIR/napcat_backup_$TIMESTAMP.tar.gz"

    mkdir -p "$BACKUP_DIR"

    # 创建备份
    tar -czf "$BACKUP_FILE" \
        -C "$PROJECT_ROOT" \
        resource/napcat_config \
        resource/napcat_qq_data \
        logs/napcat \
        docker-compose.napcat.yml

    success "备份完成: $BACKUP_FILE"

    # 清理旧备份（保留最近5个）
    cd "$BACKUP_DIR"
    ls -t napcat_backup_*.tar.gz 2>/dev/null | tail -n +6 | xargs rm -f

    info "备份文件列表:"
    ls -lah napcat_backup_*.tar.gz 2>/dev/null || echo "无备份文件"
}

# 恢复NapCat配置和数据
restore_napcat() {
    if [[ -z "$2" ]]; then
        error "请指定备份文件路径"
        info "用法: $0 restore <backup_file>"
        info "可用备份:"
        ls -lah "$PROJECT_ROOT/backups/napcat/"napcat_backup_*.tar.gz 2>/dev/null || echo "无备份文件"
        exit 1
    fi

    BACKUP_FILE="$2"

    if [[ ! -f "$BACKUP_FILE" ]]; then
        error "备份文件不存在: $BACKUP_FILE"
        exit 1
    fi

    warn "这将覆盖当前的NapCat配置和数据，确认继续吗? (y/N)"
    read -r CONFIRM
    if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
        info "操作已取消"
        exit 0
    fi

    info "停止NapCat服务..."
    stop_napcat 2>/dev/null || true

    info "恢复备份: $BACKUP_FILE"
    tar -xzf "$BACKUP_FILE" -C "$PROJECT_ROOT"

    success "备份恢复完成"

    info "重新启动NapCat服务..."
    start_napcat
}

# 显示帮助信息
show_help() {
    echo "NapCat独立管理脚本"
    echo ""
    echo "用法: $0 [action]"
    echo ""
    echo "可用动作:"
    echo "  start    - 启动NapCat服务"
    echo "  stop     - 停止NapCat服务"
    echo "  restart  - 重启NapCat服务"
    echo "  status   - 检查服务状态"
    echo "  logs     - 查看实时日志"
    echo "  health   - 执行健康检查"
    echo "  backup   - 备份配置和数据"
    echo "  restore  - 恢复备份数据"
    echo "  help     - 显示此帮助信息"
    echo ""
    echo "示例:"
    echo "  $0 start              # 启动NapCat"
    echo "  $0 status             # 检查状态"
    echo "  $0 logs               # 查看日志"
    echo "  $0 backup             # 创建备份"
    echo "  $0 restore backup.tar.gz  # 恢复备份"
}

# 主逻辑
main() {
    check_prerequisites

    case "${1:-help}" in
        "start")
            start_napcat
            ;;
        "stop")
            stop_napcat
            ;;
        "restart")
            restart_napcat
            ;;
        "status")
            check_status
            ;;
        "logs")
            show_logs
            ;;
        "health")
            check_health
            ;;
        "backup")
            backup_napcat
            ;;
        "restore")
            restore_napcat "$@"
            ;;
        "help"|"-h"|"--help")
            show_help
            ;;
        *)
            error "未知动作: $1"
            show_help
            exit 1
            ;;
    esac
}

# 执行主函数
main "$@"
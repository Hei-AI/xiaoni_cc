#!/bin/bash

# QQBot网络连接验证脚本
# 验证所有容器间的网络连接是否正常

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

# 检查容器是否运行
check_container() {
    local container_name=$1
    if docker ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
        return 0
    else
        return 1
    fi
}

# 测试网络连接
test_connection() {
    local from_container=$1
    local to_container=$2
    local port=$3
    local description=$4

    info "测试连接: ${from_container} -> ${to_container}:${port} (${description})"

    if docker exec "$from_container" nc -zv "$to_container" "$port" >/dev/null 2>&1; then
        success "✅ 连接成功"
        return 0
    else
        error "❌ 连接失败"
        return 1
    fi
}

# 测试DNS解析
test_dns() {
    local from_container=$1
    local target_host=$2
    local description=$3

    info "测试DNS解析: ${from_container} -> ${target_host} (${description})"

    if docker exec "$from_container" nslookup "$target_host" >/dev/null 2>&1; then
        success "✅ DNS解析成功"
        return 0
    else
        error "❌ DNS解析失败"
        return 1
    fi
}

# 主要验证流程
main() {
    echo "================================================================"
    echo "🔍 QQBot网络连接验证"
    echo "================================================================"

    # 检查必要容器是否运行
    info "检查容器运行状态..."

    containers=("qqbot-provider-service" "qqbot-postgres" "napcat")
    failed_containers=()

    for container in "${containers[@]}"; do
        if check_container "$container"; then
            success "✅ $container 运行中"
        else
            error "❌ $container 未运行"
            failed_containers+=("$container")
        fi
    done

    if [ ${#failed_containers[@]} -gt 0 ]; then
        error "以下容器未运行，请先启动: ${failed_containers[*]}"
        exit 1
    fi

    echo
    info "开始网络连接测试..."
    echo

    # 测试计数
    total_tests=0
    passed_tests=0

    # DNS解析测试
    echo "🔍 DNS解析测试:"
    ((total_tests++))
    if test_dns "qqbot-provider-service" "qqbot-postgres" "Provider Service -> PostgreSQL"; then
        ((passed_tests++))
    fi

    ((total_tests++))
    if test_dns "qqbot-provider-service" "napcat" "Provider Service -> NapCat"; then
        ((passed_tests++))
    fi

    echo
    echo "🔗 网络连接测试:"

    # PostgreSQL连接测试
    ((total_tests++))
    if test_connection "qqbot-provider-service" "qqbot-postgres" "5432" "数据库连接"; then
        ((passed_tests++))
    fi

    # WebSocket连接测试
    ((total_tests++))
    if test_connection "qqbot-provider-service" "napcat" "3001" "WebSocket连接"; then
        ((passed_tests++))
    fi

    # NapCat HTTP API测试
    ((total_tests++))
    if test_connection "qqbot-provider-service" "napcat" "3000" "NapCat HTTP API"; then
        ((passed_tests++))
    fi

    echo
    echo "================================================================"
    echo "📊 测试结果统计"
    echo "================================================================"
    echo "总测试数: $total_tests"
    echo "通过测试: $passed_tests"
    echo "失败测试: $((total_tests - passed_tests))"

    if [ "$passed_tests" -eq "$total_tests" ]; then
        success "🎉 所有网络连接测试通过！"
        echo
        info "网络架构验证成功："
        echo "  ✅ NapCat已成功加入qq_bot_network"
        echo "  ✅ Provider Service 可以访问所有必要服务"
        echo "  ✅ DNS解析正常工作"
        echo "  ✅ 服务间通信正常"
        exit 0
    else
        error "❌ 部分网络连接测试失败"
        echo
        warn "建议检查："
        echo "  1. 容器是否在同一网络中"
        echo "  2. 防火墙设置"
        echo "  3. 服务监听配置"
        echo "  4. Docker网络配置"
        exit 1
    fi
}

# 显示网络信息
show_network_info() {
    echo "================================================================"
    echo "🌐 网络配置信息"
    echo "================================================================"

    info "Docker网络列表:"
    docker network ls | grep -E "(qq_bot|napcat)"

    echo
    info "容器网络详情:"
    for container in "qqbot-provider-service" "qqbot-postgres" "napcat"; do
        if check_container "$container"; then
            echo "📦 $container:"
            docker inspect "$container" | jq -r '.[0].NetworkSettings.Networks | keys[]' | sed 's/^/  - /'
        fi
    done
}

# 参数处理
case "${1:-}" in
    "info"|"-i"|"--info")
        show_network_info
        ;;
    "help"|"-h"|"--help")
        echo "用法: $0 [选项]"
        echo "选项:"
        echo "  (无参数)    运行完整的网络验证测试"
        echo "  info, -i    显示网络配置信息"
        echo "  help, -h    显示此帮助信息"
        ;;
    "")
        main
        ;;
    *)
        error "未知参数: $1"
        echo "使用 '$0 help' 查看帮助"
        exit 1
        ;;
esac

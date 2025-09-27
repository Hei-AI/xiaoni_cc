#!/bin/bash

# 测试管理面板到QQBot Core的连接
# 验证队列监控功能是否正常

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 测试QQBot Core健康检查
test_qqbot_core_health() {
    log_info "测试QQBot Core健康检查..."
    
    if curl -f http://localhost:8081/health &>/dev/null; then
        log_success "QQBot Core健康检查通过"
        return 0
    else
        log_error "QQBot Core健康检查失败"
        return 1
    fi
}

# 测试QQBot Core队列API
test_qqbot_core_queue_api() {
    log_info "测试QQBot Core队列API..."
    
    # 测试队列统计API
    if curl -f http://localhost:8081/api/queue/stats &>/dev/null; then
        log_success "QQBot Core队列统计API通过"
    else
        log_error "QQBot Core队列统计API失败"
        return 1
    fi
    
    # 测试分区列表API
    if curl -f http://localhost:8081/api/queue/partitions &>/dev/null; then
        log_success "QQBot Core分区列表API通过"
    else
        log_error "QQBot Core分区列表API失败"
        return 1
    fi
    
    return 0
}

# 测试管理面板后端健康检查
test_admin_backend_health() {
    log_info "测试管理面板后端健康检查..."
    
    if curl -f http://localhost:9080/health &>/dev/null; then
        log_success "管理面板后端健康检查通过"
        return 0
    else
        log_error "管理面板后端健康检查失败"
        return 1
    fi
}

# 测试管理面板队列代理API
test_admin_queue_proxy() {
    log_info "测试管理面板队列代理API..."
    
    # 测试队列统计代理
    if curl -f http://localhost:9080/api/simple-queue/stats &>/dev/null; then
        log_success "管理面板队列统计代理通过"
    else
        log_error "管理面板队列统计代理失败"
        return 1
    fi
    
    # 测试分区列表代理
    if curl -f http://localhost:9080/api/simple-queue/partitions &>/dev/null; then
        log_success "管理面板分区列表代理通过"
    else
        log_error "管理面板分区列表代理失败"
        return 1
    fi
    
    # 测试健康检查代理
    if curl -f http://localhost:9080/api/simple-queue/health &>/dev/null; then
        log_success "管理面板健康检查代理通过"
    else
        log_error "管理面板健康检查代理失败"
        return 1
    fi
    
    return 0
}

# 测试消息模拟API
test_message_simulation() {
    log_info "测试消息模拟API..."
    
    # 模拟私聊消息
    local response=$(curl -s -X POST http://localhost:9080/api/simple-queue/simulate/private \
        -H "Content-Type: application/json" \
        -d '{
            "user_id": 123456,
            "message": "测试消息",
            "priority": "HIGH"
        }')
    
    if echo "$response" | grep -q '"success":true'; then
        log_success "私聊消息模拟测试通过"
    else
        log_error "私聊消息模拟测试失败: $response"
        return 1
    fi
    
    # 模拟群聊消息
    local response=$(curl -s -X POST http://localhost:9080/api/simple-queue/simulate/group \
        -H "Content-Type: application/json" \
        -d '{
            "user_id": 123456,
            "group_id": 789012,
            "message": "测试群聊消息",
            "atBot": true,
            "priority": "MEDIUM"
        }')
    
    if echo "$response" | grep -q '"success":true'; then
        log_success "群聊消息模拟测试通过"
    else
        log_error "群聊消息模拟测试失败: $response"
        return 1
    fi
    
    return 0
}

# 显示详细的API响应
show_api_details() {
    log_info "显示详细的API响应..."
    
    echo ""
    echo "=== QQBot Core队列统计 ==="
    curl -s http://localhost:8081/api/queue/stats | jq '.' 2>/dev/null || echo "需要安装jq查看JSON格式"
    
    echo ""
    echo "=== 管理面板队列统计代理 ==="
    curl -s http://localhost:9080/api/simple-queue/stats | jq '.' 2>/dev/null || echo "需要安装jq查看JSON格式"
    
    echo ""
    echo "=== 管理面板健康检查 ==="
    curl -s http://localhost:9080/api/simple-queue/health | jq '.' 2>/dev/null || echo "需要安装jq查看JSON格式"
}

# 主测试流程
main() {
    log_info "开始测试队列连接..."
    echo ""
    
    local failed_tests=0
    
    # 基础服务测试
    test_qqbot_core_health || ((failed_tests++))
    test_admin_backend_health || ((failed_tests++))
    
    # API功能测试
    test_qqbot_core_queue_api || ((failed_tests++))
    test_admin_queue_proxy || ((failed_tests++))
    
    # 高级功能测试
    test_message_simulation || ((failed_tests++))
    
    echo ""
    
    if [ $failed_tests -eq 0 ]; then
        log_success "🎉 所有测试通过！队列连接正常工作"
        show_api_details
    else
        log_error "❌ 有 $failed_tests 个测试失败"
        echo ""
        echo "故障排除步骤："
        echo "1. 检查服务是否运行: docker ps"
        echo "2. 检查QQBot Core日志: docker logs qqbot-core"
        echo "3. 检查管理面板后端日志: docker logs qqbot-admin-backend"
        echo "4. 检查网络连接: ping localhost"
        echo "5. 检查端口是否被占用: netstat -tlnp | grep -E ':(8081|9080)'"
        exit 1
    fi
}

main "$@"
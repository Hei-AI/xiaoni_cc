#!/bin/bash

# QQ Bot 自验证脚本
# 面向当前 runtime-gateway 架构执行验证

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

ADMIN_API_URL=${ADMIN_API_URL:-http://localhost:9080}
PROVIDER_SERVICE_URL=${PROVIDER_SERVICE_URL:-http://localhost:8091}
DATABASE_CONTAINER=${DATABASE_CONTAINER:-qqbot-postgres}

check_database() {
    log_info "检查数据库容器状态..."
    if docker ps --format '{{.Names}}' | grep -q "^${DATABASE_CONTAINER}$"; then
        log_info "✅ 数据库容器运行中"
        return 0
    fi

    log_error "❌ 数据库容器未运行: ${DATABASE_CONTAINER}"
    return 1
}

verify_provider_queue() {
    log_info "========================================="
    log_info "A部分：Provider Queue 验证"
    log_info "========================================="

    log_info "检查 provider-service 容器状态..."
    if ! docker ps --format '{{.Names}}' | grep -q '^qqbot-provider-service$'; then
        log_warn "⚠️  provider-service 未运行，尝试启动..."
        docker compose up -d provider-service
        sleep 5
    fi

    log_info "发送模拟私聊消息..."
    local simulate_response
    simulate_response=$(curl -s -X POST "${ADMIN_API_URL}/api/simple-queue/simulate/private" \
        -H 'Content-Type: application/json' \
        -d '{"user_id":123456,"message":"self-verification message"}')

    if echo "$simulate_response" | grep -q '"success":true'; then
        log_info "✅ 模拟消息发送成功"
    else
        log_error "❌ 模拟消息发送失败: $simulate_response"
        return 1
    fi

    log_info "查询 provider-service 队列统计..."
    local provider_stats
    provider_stats=$(curl -s "${PROVIDER_SERVICE_URL}/api/simple-queue/stats")
    if echo "$provider_stats" | grep -q '"total_messages"'; then
        log_info "✅ Provider 队列统计正常"
        echo "$provider_stats" | jq '.' 2>/dev/null || echo "$provider_stats"
    else
        log_error "❌ Provider 队列统计异常: $provider_stats"
        return 1
    fi

    log_info "查询 admin 队列代理..."
    local admin_stats
    admin_stats=$(curl -s "${ADMIN_API_URL}/api/simple-queue/stats")
    if echo "$admin_stats" | grep -q '"total_messages"'; then
        log_info "✅ Admin 队列代理正常"
    else
        log_error "❌ Admin 队列代理异常: $admin_stats"
        return 1
    fi

    log_info "========================================="
    log_info "✅ A部分：Provider Queue 验证完成"
    log_info "========================================="
    return 0
}

verify_provider_debug_and_embedding() {
    log_info "========================================="
    log_info "B部分：Provider Debug 与 Embedding 验证"
    log_info "========================================="

    log_info "执行 provider debug smoke test..."
    local debug_response
    debug_response=$(curl -s -X POST "${ADMIN_API_URL}/api/debug/prompt-v2" \
        -H 'Content-Type: application/json' \
        -d '{"userInput":"reply with pong only","provider":"codex","model":"gpt-5-mini","parameters":{"temperature":0}}')

    if echo "$debug_response" | grep -q '"success":true' && echo "$debug_response" | grep -q '"response":"pong"'; then
        log_info "✅ Provider debug 调用成功"
    else
        log_error "❌ Provider debug 调用失败: $debug_response"
        return 1
    fi

    log_info "验证 embeddings model list..."
    local models_response
    models_response=$(curl -s "${PROVIDER_SERVICE_URL}/v1/models")
    if echo "$models_response" | grep -q '"embeddinggemma-300m"'; then
        log_info "✅ Embedding model list 正常"
    else
        log_error "❌ Embedding model list 异常: $models_response"
        return 1
    fi

    log_info "验证 embedding health..."
    local embedding_health
    embedding_health=$(curl -s "${PROVIDER_SERVICE_URL}/api/internal/embedding/health")
    if echo "$embedding_health" | grep -q '"success":true'; then
        log_info "✅ Embedding health 正常"
    else
        log_error "❌ Embedding health 异常: $embedding_health"
        return 1
    fi

    log_info "========================================="
    log_info "✅ B部分：Provider Debug 与 Embedding 验证完成"
    log_info "========================================="
    return 0
}

main() {
    log_info "========================================="
    log_info "QQ Bot 自验证流程开始"
    log_info "========================================="

    for cmd in curl jq docker; do
        if ! command -v "$cmd" &>/dev/null; then
            log_error "缺少依赖: $cmd"
            exit 1
        fi
    done

    check_database || exit 1
    verify_provider_queue || exit 1
    echo ""
    verify_provider_debug_and_embedding || exit 1

    log_info "========================================="
    log_info "🎉 所有验证通过！"
    log_info "========================================="
    log_info "验证总结："
    log_info "  ✅ Provider Service 队列与模拟消息正常"
    log_info "  ✅ Admin 后端代理链路正常"
    log_info "  ✅ Provider debug 正常"
    log_info "  ✅ Embedding 接口正常"
}

main "$@"

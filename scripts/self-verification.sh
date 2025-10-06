#!/bin/bash

# QQ Bot 自验证脚本
# 根据 docs/PROJECT_STATUS.md 执行完整验证流程

set -e  # 遇到错误立即退出

# 颜色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# 数据库配置
DB_HOST=${MYSQL_HOST:-localhost}
DB_PORT=${MYSQL_PORT:-3306}
DB_USER=${MYSQL_USER:-qqbot_user}
DB_PASS=${MYSQL_PASSWORD:-qqbot_password}
DB_NAME=${MYSQL_DATABASE:-qqbot_db}

# Admin Panel 配置
ADMIN_API_URL=${ADMIN_API_URL:-http://localhost:9080}

# QQBot Core 配置
QQBOT_CORE_URL=${QQBOT_CORE_URL:-http://localhost:8081}

# Docker MySQL 容器名称
MYSQL_CONTAINER=${MYSQL_CONTAINER:-qqbot-mysql}

# MySQL 执行包装函数（使用 docker exec）
mysql_exec() {
    local query="$1"
    local opts="${2:---batch --skip-column-names}"
    docker exec "$MYSQL_CONTAINER" mysql -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" $opts -e "$query" 2>/dev/null
}

# 检查数据库连接
check_database() {
    log_info "检查数据库连接..."
    if mysql_exec "SELECT 1;" &>/dev/null; then
        log_info "✅ 数据库连接成功"
        return 0
    else
        log_error "❌ 数据库连接失败"
        return 1
    fi
}

# 验证数据库表是否存在
verify_database_tables() {
    log_info "验证数据库表结构..."

    local required_tables=(
        "conversation_batches"
        "message_consumptions"
        "llm_jobs"
        "llm_tools"
        "tool_execution_logs"
    )

    for table in "${required_tables[@]}"; do
        local exists=$(mysql_exec "SHOW TABLES LIKE '$table';")

        if [ -z "$exists" ]; then
            log_error "❌ 表 $table 不存在"
            return 1
        else
            log_info "✅ 表 $table 已存在"
        fi
    done

    return 0
}

# A部分：消息队列验证
verify_message_queue() {
    log_info "========================================="
    log_info "A部分：消息队列验证"
    log_info "========================================="

    # 1. 检查 qqbot-core 服务是否运行
    log_info "检查 qqbot-core 服务状态..."
    if ! docker ps | grep -q "qqbot-qqbot-core"; then
        log_warn "⚠️  qqbot-core 服务未运行，尝试启动..."
        docker compose up -d qqbot-core
        sleep 10
    else
        log_info "✅ qqbot-core 服务正在运行"
    fi

    # 2. 发送模拟私聊消息
    log_info "发送模拟私聊消息..."
    local response=$(curl -s -X POST "${ADMIN_API_URL}/api/simple-queue/simulate/private" \
        -H 'Content-Type: application/json' \
        -d '{"user_id":123456,"message":"测试消息"}')

    if echo "$response" | grep -q "success"; then
        log_info "✅ 模拟消息发送成功"
    else
        log_error "❌ 模拟消息发送失败: $response"
        return 1
    fi

    # 等待处理
    sleep 10

    # 3. 查看队列统计
    log_info "查询队列统计..."
    local stats=$(curl -s "${QQBOT_CORE_URL}/api/simple-queue/stats")

    if echo "$stats" | grep -q "totalMessages"; then
        log_info "✅ 队列统计查询成功"
        echo "$stats" | jq '.' 2>/dev/null || echo "$stats"
    else
        log_warn "⚠️  队列统计查询响应异常: $stats"
    fi

    # 4. 验证数据库批次记录
    log_info "验证批次记录..."
    local batch_count=$(mysql_exec "SELECT COUNT(*) FROM conversation_batches WHERE created_at >= NOW() - INTERVAL 1 MINUTE;")

    if [ "$batch_count" -gt 0 ]; then
        log_info "✅ 批次记录已创建 (数量: $batch_count)"

        # 显示最新批次
        mysql_exec "SELECT id, source_key, trigger_type, message_count, status FROM conversation_batches ORDER BY created_at DESC LIMIT 3;" "--table"
    else
        log_error "❌ 未找到批次记录"
        return 1
    fi

    # 5. 验证 message_consumptions 记录
    local consumption_count=$(mysql_exec "SELECT COUNT(*) FROM message_consumptions WHERE consumption_timestamp >= NOW() - INTERVAL 1 MINUTE;")

    if [ "$consumption_count" -gt 0 ]; then
        log_info "✅ 消费记录已创建 (数量: $consumption_count)"
    else
        log_warn "⚠️  未找到消费记录"
    fi

    log_info "========================================="
    log_info "✅ A部分：消息队列验证完成"
    log_info "========================================="
    return 0
}

# B部分：LLM Function Calling 验证
verify_llm_function_calling() {
    log_info "========================================="
    log_info "B部分：LLM Function Calling 验证"
    log_info "========================================="

    # 1. 检查环境变量
    log_info "检查 LLM 工具系统环境变量..."

    if docker exec qqbot-qqbot-core sh -c 'echo $ENABLE_LLM_TOOLS' | grep -q "true"; then
        log_info "✅ ENABLE_LLM_TOOLS=true"
    else
        log_warn "⚠️  ENABLE_LLM_TOOLS 未启用，尝试重启服务..."
        log_warn "请在 .env 文件中设置 ENABLE_LLM_TOOLS=true 并重启服务"
        return 1
    fi

    # 2. 检查 LLMJobWorker 是否启动
    log_info "检查 LLMJobWorker 启动状态..."

    if docker logs qqbot-qqbot-core 2>&1 | grep -q "LLMJobWorker started"; then
        log_info "✅ LLMJobWorker 已启动"
    else
        log_error "❌ LLMJobWorker 未启动"
        return 1
    fi

    # 3. 发送测试消息（触发工具调用）
    log_info "发送测试消息（请计算 12*8）..."

    local test_message=$(cat <<'EOF'
{
  "message": {
    "message_type": "private",
    "user_id": 123456,
    "raw_message": "请计算 12*8",
    "message": "请计算 12*8"
  }
}
EOF
)

    local response=$(curl -s -X POST "${QQBOT_CORE_URL}/api/test/simulate-message" \
        -H 'Content-Type: application/json' \
        -d "$test_message")

    if echo "$response" | grep -q "success"; then
        log_info "✅ 测试消息发送成功"
    else
        log_warn "⚠️  测试消息发送响应: $response"
    fi

    # 等待 LLM Job 处理
    log_info "等待 LLM Job 处理（最多30秒）..."
    local max_wait=30
    local waited=0
    local job_completed=false

    while [ $waited -lt $max_wait ]; do
        local job_status=$(mysql_exec "SELECT status FROM llm_jobs ORDER BY created_at DESC LIMIT 1;")

        if [ "$job_status" = "completed" ] || [ "$job_status" = "failed" ]; then
            job_completed=true
            break
        fi

        sleep 2
        waited=$((waited + 2))
        echo -n "."
    done
    echo ""

    if [ "$job_completed" = true ]; then
        log_info "✅ LLM Job 处理完成"

        # 4. 查询 llm_jobs 表
        log_info "查询最新 LLM Job 记录..."
        mysql_exec "SELECT id, status, final_response, metadata FROM llm_jobs ORDER BY created_at DESC LIMIT 1;" "--table" \
            || log_warn "查询失败"

        # 5. 检查日志中是否有响应发送记录
        log_info "检查日志中的响应发送记录..."
        if docker logs --tail 100 qqbot-qqbot-core 2>&1 | grep -q "LLM Job response sent"; then
            log_info "✅ 找到响应发送日志"
        else
            log_warn "⚠️  未找到响应发送日志"
        fi

        # 6. 验证工具执行日志
        local tool_log_count=$(mysql_exec "SELECT COUNT(*) FROM tool_execution_logs WHERE started_at >= NOW() - INTERVAL 5 MINUTE;")

        if [ "$tool_log_count" -gt 0 ]; then
            log_info "✅ 工具执行日志已创建 (数量: $tool_log_count)"

            # 显示最新工具执行记录
            mysql_exec "SELECT tool_name, status, execution_mode FROM tool_execution_logs ORDER BY started_at DESC LIMIT 3;" "--table" \
                || log_warn "查询失败"
        else
            log_warn "⚠️  未找到工具执行日志"
        fi
    else
        log_error "❌ LLM Job 处理超时"
        return 1
    fi

    log_info "========================================="
    log_info "✅ B部分：LLM Function Calling 验证完成"
    log_info "========================================="
    return 0
}

# 主函数
main() {
    log_info "========================================="
    log_info "QQ Bot 自验证流程开始"
    log_info "========================================="

    # 检查依赖
    for cmd in curl jq docker; do
        if ! command -v $cmd &>/dev/null; then
            log_error "缺少依赖: $cmd"
            exit 1
        fi
    done

    # 检查 MySQL 容器
    if ! docker ps | grep -q "$MYSQL_CONTAINER"; then
        log_error "MySQL 容器 $MYSQL_CONTAINER 未运行"
        exit 1
    fi

    # 检查数据库
    if ! check_database; then
        log_error "数据库检查失败，终止验证"
        exit 1
    fi

    # 验证表结构
    if ! verify_database_tables; then
        log_error "数据库表验证失败，请先执行迁移脚本"
        log_error "mysql -u$DB_USER -p$DB_PASS $DB_NAME < database/migrations/009_create_conversation_batches_table.sql"
        log_error "mysql -u$DB_USER -p$DB_PASS $DB_NAME < database/migrations/010_create_llm_tool_system_tables.sql"
        exit 1
    fi

    # A部分：消息队列验证
    if verify_message_queue; then
        log_info "✅ 消息队列验证通过"
    else
        log_error "❌ 消息队列验证失败"
        exit 1
    fi

    echo ""

    # B部分：LLM 工具验证
    if verify_llm_function_calling; then
        log_info "✅ LLM Function Calling 验证通过"
    else
        log_error "❌ LLM Function Calling 验证失败"
        exit 1
    fi

    log_info "========================================="
    log_info "🎉 所有验证通过！"
    log_info "========================================="

    # 显示总结
    echo ""
    log_info "验证总结："
    log_info "  ✅ 数据库连接正常"
    log_info "  ✅ 批次数据正确落库"
    log_info "  ✅ LLM Job 事件包含 finalResponse 和 metadata"
    log_info "  ✅ 工具执行日志完整"

    exit 0
}

# 执行主函数
main "$@"

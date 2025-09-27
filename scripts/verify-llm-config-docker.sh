#!/bin/bash

# 实时LLM配置系统Docker部署验证脚本

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo "🐳 实时LLM配置系统Docker部署验证"
echo "========================================"

# 1. 检查容器状态
info "1. 检查容器状态..."
containers=("qqbot-http-api" "qqbot-qqbot-core" "qqbot-admin-backend" "qqbot-admin-frontend")
all_running=true

for container in "${containers[@]}"; do
    if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        success "容器 $container 正在运行"
    else
        error "容器 $container 未运行"
        all_running=false
    fi
done

if [ "$all_running" = false ]; then
    error "部分容器未运行，请检查部署状态"
    exit 1
fi

# 2. 检查端口状态
info "2. 检查端口状态..."
ports=(8080 8081 9080 3003)
for port in "${ports[@]}"; do
    if netstat -tuln 2>/dev/null | grep -q ":${port} "; then
        success "端口 $port 正在监听"
    else
        warn "端口 $port 未监听（可能是容器网络配置）"
    fi
done

# 3. 检查数据库连接
info "3. 检查数据库表结构..."
if docker exec qqbot_mysql_ts mysql -u qqbot_user -pqqbot_password qqbot_db \
    -e "SHOW TABLES LIKE 'agent_prompts';" 2>/dev/null | grep -q agent_prompts; then
    success "agent_prompts表存在"
else
    error "agent_prompts表不存在，请运行数据库初始化"
    exit 1
fi

# 检查advanced_config字段
if docker exec qqbot_mysql_ts mysql -u qqbot_user -pqqbot_password qqbot_db \
    -e "DESCRIBE agent_prompts;" 2>/dev/null | grep -q advanced_config; then
    success "advanced_config字段存在"
else
    error "advanced_config字段不存在，请更新数据库结构"
    exit 1
fi

# 4. 检查预设Agent配置
info "4. 检查预设Agent配置..."
agent_count=$(docker exec qqbot_mysql_ts mysql -u qqbot_user -pqqbot_password qqbot_db \
    -e "SELECT COUNT(*) FROM agent_prompts WHERE is_active = true;" 2>/dev/null | tail -n 1)

if [ "$agent_count" -ge 4 ]; then
    success "找到 $agent_count 个活跃Agent配置"
else
    warn "只找到 $agent_count 个Agent配置，建议重新初始化"
fi

# 5. 测试Admin Panel API
info "5. 测试Admin Panel API..."

# 等待服务启动
sleep 3

# 测试Agent列表API
if curl -s -f "http://localhost:9080/api/llm-config/agents" > /dev/null 2>&1; then
    success "Agent列表API响应正常"
else
    error "Agent列表API无响应"
    echo "请检查Admin Backend容器日志："
    echo "  docker logs qqbot-admin-backend"
    exit 1
fi

# 测试工具列表API
if curl -s -f "http://localhost:9080/api/llm-config/tools" > /dev/null 2>&1; then
    success "工具列表API响应正常"
else
    error "工具列表API无响应"
    exit 1
fi

# 6. 测试具体Agent配置
info "6. 测试具体Agent配置..."
agent_response=$(curl -s "http://localhost:9080/api/llm-config/agents/chat_bot_basic" 2>/dev/null)
if echo "$agent_response" | jq -e '.success' > /dev/null 2>&1; then
    success "Agent配置查询正常"

    # 检查advanced_config是否存在
    if echo "$agent_response" | jq -e '.data.advancedConfig' > /dev/null 2>&1; then
        success "Agent高级配置字段存在"
    else
        warn "Agent高级配置字段为空"
    fi
else
    error "Agent配置查询失败"
    echo "响应: $agent_response"
fi

# 7. 测试配置更新功能
info "7. 测试配置更新功能..."
update_response=$(curl -s -X PUT "http://localhost:9080/api/llm-config/agents/chat_bot_basic/advanced-config" \
    -H "Content-Type: application/json" \
    -d '{
        "advancedConfig": {
            "generationConfig": {
                "temperature": 0.8,
                "maxOutputTokens": 1000
            },
            "thinkingConfig": {
                "thinkingBudget": 0,
                "includeThoughts": false
            }
        },
        "updatedBy": "verification_script"
    }' 2>/dev/null)

if echo "$update_response" | jq -e '.success' > /dev/null 2>&1; then
    success "配置更新功能正常"
else
    error "配置更新功能失败"
    echo "响应: $update_response"
fi

# 8. 测试配置测试功能
info "8. 测试配置测试功能..."
test_response=$(curl -s -X POST "http://localhost:9080/api/llm-config/agents/chat_bot_basic/test" \
    -H "Content-Type: application/json" \
    -d '{
        "testPrompt": "你好，这是一个测试消息",
        "userId": 12345
    }' 2>/dev/null)

if echo "$test_response" | jq -e '.success' > /dev/null 2>&1; then
    success "Agent测试功能正常"

    # 显示测试结果
    trace_id=$(echo "$test_response" | jq -r '.data.traceId')
    content=$(echo "$test_response" | jq -r '.data.response.content' | head -c 50)
    info "测试结果 (TraceID: $trace_id): ${content}..."
else
    warn "Agent测试功能失败（可能是API Key问题）"
    echo "响应: $test_response"
fi

# 9. 检查前端访问
info "9. 检查前端访问..."
if curl -s -f "http://localhost:3003" > /dev/null 2>&1; then
    success "前端界面可访问"
else
    warn "前端界面无法访问，检查容器状态"
fi

# 10. 显示部署总结
echo
echo "🎉 部署验证完成！"
echo "========================================"
success "实时LLM配置系统已就绪"
echo
echo "📊 访问地址:"
echo "  🌐 管理界面: http://localhost:3003"
echo "  🔗 API接口: http://localhost:9080/api/llm-config/"
echo "  🤖 Core API: http://localhost:8081/health"
echo "  🌐 HTTP API: http://localhost:8080/health"
echo
echo "📋 可用Agent配置:"
docker exec qqbot_mysql_ts mysql -u qqbot_user -pqqbot_password qqbot_db \
    -e "SELECT id, prompt_name, agent_type, model_name FROM agent_prompts WHERE is_active = true;" \
    2>/dev/null || warn "无法查询Agent列表"

echo
echo "🔧 下一步操作:"
echo "  1. 访问管理界面调整LLM参数"
echo "  2. 根据对话时间线优化Agent配置"
echo "  3. 使用预定义工具增强功能"
echo "  4. 监控LLM调用性能和效果"
echo
echo "💡 使用提示:"
echo "  ./scripts/docker-deploy.sh all status     # 查看容器状态"
echo "  ./scripts/docker-deploy.sh all logs       # 查看日志"
echo "  ./scripts/docker-deploy.sh all test-config # 测试配置API"

success "验证脚本执行完成！"
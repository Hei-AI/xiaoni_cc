#!/usr/bin/env bash
# 测试容器识别功能
# 验证 mitmproxy 是否能正确识别不同容器的流量

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
LOG_DIR="${PROJECT_ROOT}/logs/qqbot-traffic"
TODAY=$(date +%Y-%m-%d)
TRAFFIC_LOG="${LOG_DIR}/traffic-${TODAY}.jsonl"

echo "============================================"
echo "容器识别功能测试"
echo "============================================"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $2"
    else
        echo -e "${RED}✗${NC} $2"
    fi
}

# 步骤1: 停止现有 mitmproxy
echo ""
echo "步骤1: 停止现有 mitmproxy..."
bash "${SCRIPT_DIR}/stop-mitmproxy-daemon.sh" 2>/dev/null || true
sleep 2

# 步骤2: 启动 mitmproxy
echo ""
echo "步骤2: 启动 mitmproxy..."
bash "${SCRIPT_DIR}/start-mitmproxy-daemon.sh"
sleep 5

# 检查 mitmproxy 是否启动成功
if pgrep -f "mitmdump.*traffic_logger" > /dev/null; then
    print_status 0 "mitmproxy 启动成功"
else
    print_status 1 "mitmproxy 启动失败"
    exit 1
fi

# 步骤3: 检查容器IP映射加载
echo ""
echo "步骤3: 检查容器IP映射加载..."
MITMPROXY_LOG="${LOG_DIR}/mitmproxy.log"
if [ -f "$MITMPROXY_LOG" ]; then
    MAPPING_COUNT=$(grep -c "加载到.*个容器IP映射" "$MITMPROXY_LOG" | tail -1 || echo "0")
    if [ "$MAPPING_COUNT" -gt 0 ]; then
        print_status 0 "容器IP映射已加载"
        # 显示映射内容
        echo ""
        echo "容器映射表:"
        grep -A 10 "加载到.*个容器IP映射" "$MITMPROXY_LOG" | tail -10 | grep " -> " || echo "  (无映射数据)"
    else
        print_status 1 "未找到容器IP映射"
    fi
else
    print_status 1 "mitmproxy 日志文件不存在"
fi

# 步骤4: 从不同容器发起测试请求
echo ""
echo "步骤4: 从容器发起测试请求..."

# 测试容器列表
TEST_CONTAINERS=(
    "qqbot-provider-service"
    "qqbot-admin-backend"
)

EXPECTED_CONTAINERS=(
    "qqbot-provider-service"
    "qqbot-admin-backend"
)

TEST_URL="http://httpbin.org/get"

for container in "${TEST_CONTAINERS[@]}"; do
    # 检查容器是否存在且运行
    if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        echo "  测试容器: $container"
        docker exec "$container" wget -q -O - "$TEST_URL" > /dev/null 2>&1 || \
        docker exec "$container" curl -s "$TEST_URL" > /dev/null 2>&1 || \
        echo "    (容器中没有 wget 或 curl，跳过)"
        sleep 1
    else
        echo "  容器 $container 未运行，跳过"
    fi
done

# 等待日志写入
echo ""
echo "等待日志写入..."
sleep 3

# 步骤5: 验证日志记录
echo ""
echo "步骤5: 验证日志记录..."
echo "日志文件: $TRAFFIC_LOG"

if [ ! -f "$TRAFFIC_LOG" ]; then
    print_status 1 "日志文件不存在"
    exit 1
fi

# 跳过文件头，读取实际日志记录
echo ""
echo "最近的日志记录 (container_name):"
echo "----------------------------------------"

RECENT_LOGS=$(tail -20 "$TRAFFIC_LOG" | grep -v '"type":"log_file_header"' | head -10)

if [ -z "$RECENT_LOGS" ]; then
    print_status 1 "没有找到日志记录"
    exit 1
fi

# 使用 jq 或手动解析 JSON
if command -v jq &> /dev/null; then
    echo "$RECENT_LOGS" | jq -r 'select(.container_name != null) | "\(.container_name) | \(.method) \(.host)\(.path)"' | while read line; do
        CONTAINER=$(echo "$line" | cut -d'|' -f1 | xargs)
        if [ "$CONTAINER" = "unknown" ]; then
            echo -e "  ${YELLOW}⚠${NC} $line  ${YELLOW}(未识别的容器)${NC}"
        elif printf '%s\n' "${EXPECTED_CONTAINERS[@]}" | grep -qx "$CONTAINER"; then
            echo -e "  ${GREEN}✓${NC} $line"
        else
            echo -e "  ${RED}✗${NC} $line  ${RED}(不在当前主栈容器集合内)${NC}"
        fi
    done
else
    # 如果没有 jq，使用简单的 grep
    echo "$RECENT_LOGS" | grep -o '"container_name":"[^"]*"' | while read line; do
        CONTAINER=$(echo "$line" | cut -d':' -f2 | tr -d '"')
        if [ "$CONTAINER" = "unknown" ]; then
            echo -e "  ${YELLOW}⚠${NC} container_name: $CONTAINER  ${YELLOW}(未识别的容器)${NC}"
        elif printf '%s\n' "${EXPECTED_CONTAINERS[@]}" | grep -qx "$CONTAINER"; then
            echo -e "  ${GREEN}✓${NC} container_name: $CONTAINER"
        else
            echo -e "  ${RED}✗${NC} container_name: $CONTAINER  ${RED}(不在当前主栈容器集合内)${NC}"
        fi
    done
fi

# 步骤6: 统计分析
echo ""
echo "步骤6: 统计分析..."
echo "----------------------------------------"

if command -v jq &> /dev/null; then
    # 统计各容器的请求数
    echo "各容器请求数统计:"
    tail -100 "$TRAFFIC_LOG" | grep -v '"type":"log_file_header"' | \
        jq -r '.container_name' 2>/dev/null | sort | uniq -c | \
        awk '{printf "  %-30s %d 次\n", $2, $1}'

    # 检查是否还有不属于当前主栈的容器名
    HARDCODED_COUNT=$(tail -100 "$TRAFFIC_LOG" | grep -v '"type":"log_file_header"' | \
        jq -r '.container_name' 2>/dev/null | grep -Ev '^(qqbot-provider-service|qqbot-admin-backend|unknown|null)?$' | wc -l | tr -d ' ' || echo "0")

    if [ "$HARDCODED_COUNT" -gt 0 ]; then
        echo ""
        echo -e "${RED}警告: 发现 ${HARDCODED_COUNT} 条不属于当前主栈的容器记录${NC}"
        echo -e "${RED}容器识别功能可能未生效，或仍残留历史命名${NC}"
    else
        echo ""
        echo -e "${GREEN}✓ 未发现历史容器命名残留，容器识别功能正常${NC}"
    fi
else
    echo "(需要 jq 工具才能进行详细统计)"
fi

echo ""
echo "============================================"
echo "测试完成"
echo "============================================"
echo ""
echo "查看完整日志: tail -f $TRAFFIC_LOG | jq"
echo "查看 mitmproxy 日志: tail -f $MITMPROXY_LOG"

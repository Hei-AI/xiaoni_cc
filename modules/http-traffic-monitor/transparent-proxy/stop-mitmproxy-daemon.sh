#!/bin/bash
# 停止 mitmproxy 守护进程并清理 iptables 规则

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================="
echo "停止 mitmproxy 透明代理"
echo "=========================================="

# 1. 检查是否有运行的进程
if ! pgrep -f "mitmdump.*transparent" > /dev/null; then
    echo "⚠️  mitmproxy 未运行"
else
    echo "🛑 停止 mitmproxy 进程..."
    pkill -f "mitmdump.*transparent"
    sleep 2

    # 确认已停止
    if pgrep -f "mitmdump.*transparent" > /dev/null; then
        echo "⚠️  进程未完全停止，强制终止..."
        pkill -9 -f "mitmdump.*transparent"
    fi

    echo "✅ mitmproxy 已停止"
fi

# 2. 清理 iptables 规则
echo ""
echo "🧹 清理 iptables 规则..."
if sudo bash "$SCRIPT_DIR/remove-iptables.sh"; then
    echo "✅ iptables 规则已清理"
else
    echo "⚠️  iptables 规则清理失败（可能需要手动清理）"
fi

# 3. 清理 PID 文件
if [ -f /tmp/mitmproxy.pid ]; then
    rm -f /tmp/mitmproxy.pid
    echo "✅ PID 文件已清理"
fi

echo ""
echo "=========================================="
echo "✅ mitmproxy 透明代理已完全停止"
echo "=========================================="

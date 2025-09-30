#!/bin/bash
# WSL2启动时自动执行的脚本
# 将此脚本添加到 /etc/wsl.conf 的 [boot] 部分

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo "=========================================="
echo "WSL2 启动脚本"
echo "时间: $(date)"
echo "=========================================="

# 等待网络就绪
echo "⏳ 等待网络就绪..."
timeout 30 bash -c 'until ping -c1 -W1 172.26.144.1 &>/dev/null; do sleep 1; done' && echo "✅ 网络已就绪" || echo "⚠️  网络检查超时"

# 启动mitmproxy
echo "🚀 启动 mitmproxy 透明代理..."
cd "$PROJECT_ROOT"
bash modules/http-traffic-monitor/transparent-proxy/start-mitmproxy-daemon.sh

# 等待mitmproxy启动
sleep 5

# 应用iptables规则
echo "🔧 应用 iptables 规则..."
sudo bash modules/http-traffic-monitor/transparent-proxy/apply-iptables.sh

echo "✅ WSL2 启动脚本执行完成"
echo "=========================================="

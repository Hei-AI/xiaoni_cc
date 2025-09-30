#!/bin/bash
# 简单的 mitmproxy 守护进程启动脚本

cd /home/liahua/IdeaProject/qq_bot

export PATH="$HOME/.local/bin:$PATH"
export MITMPROXY_DIR="$PWD/modules/http-traffic-monitor/transparent-proxy/mitmproxy-data"

# 自动检测Windows宿主机IP（WSL2默认网关）
DEFAULT_GATEWAY=$(ip route | grep "^default" | awk '{print $3}')
CLASH_PORT="${CLASH_PORT:-7890}"

# 如果UPSTREAM_HTTP未设置，使用自动检测的地址
if [ -z "$UPSTREAM_HTTP" ]; then
    export UPSTREAM_HTTP="http://${DEFAULT_GATEWAY}:${CLASH_PORT}"
    echo "✅ 自动检测到Clash代理: $UPSTREAM_HTTP"
else
    echo "ℹ️  使用环境变量配置的代理: $UPSTREAM_HTTP"
fi

# 检查是否已经运行
if pgrep -f "mitmdump.*transparent" > /dev/null; then
    echo "mitmproxy 已在运行"
    pgrep -f "mitmdump.*transparent"
    exit 0
fi

# 启动
bash modules/http-traffic-monitor/transparent-proxy/start-mitmproxy.sh &
PID=$!

echo "mitmproxy 已启动，PID: $PID"
echo $PID > /tmp/mitmproxy.pid

# 等待启动
sleep 2

# 验证
if ps -p $PID > /dev/null 2>&1; then
    echo "✅ mitmproxy 运行正常"
else
    echo "❌ mitmproxy 启动失败"
    exit 1
fi

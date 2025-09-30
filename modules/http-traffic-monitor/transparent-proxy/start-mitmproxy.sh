#!/usr/bin/env bash
# Launch mitmproxy in transparent mode on WSL2
# Usage: sudo ./start-mitmproxy.sh [options]
# Environment variables:
#   LISTEN_PORT      - Port mitmproxy listens on (default: 15001)
#   MITMPROXY_DIR    - Directory for mitmproxy state/logs (default: /opt/mitmproxy)
#   UPSTREAM_HTTP    - Upstream HTTP proxy (default: 127.0.0.1:7890)
#   UPSTREAM_HTTPS   - Upstream HTTPS proxy (default: same as UPSTREAM_HTTP)
#   ADDON_SCRIPT     - Path to mitmproxy addon (default: ../mitmproxy/addon.py)
#   LOG_LEVEL        - Mitmproxy log level (default: info)

set -euo pipefail

# Resolve important paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# transparent-proxy -> http-traffic-monitor -> modules -> repo_root
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

LISTEN_PORT="${LISTEN_PORT:-15001}"
MITMPROXY_DIR="${MITMPROXY_DIR:-/opt/mitmproxy}"
LOG_LEVEL="${LOG_LEVEL:-info}"

# 从 WSL2 环境变量获取代理地址，如果没有则使用默认值
# mitmproxy需要完整的URL格式(包含http://协议前缀)
if [ -n "${HTTP_PROXY:-}" ]; then
  WSL_PROXY="${HTTP_PROXY}"
else
  WSL_PROXY=""
fi
UPSTREAM_HTTP="${UPSTREAM_HTTP:-${WSL_PROXY}}"
UPSTREAM_HTTPS="${UPSTREAM_HTTPS:-$UPSTREAM_HTTP}"

DEFAULT_ADDON="$REPO_ROOT/modules/http-traffic-monitor/mitmproxy/addon.py"
ADDON_SCRIPT="${ADDON_SCRIPT:-$DEFAULT_ADDON}"

# Ensure directories exist
LOG_DIR="$MITMPROXY_DIR/logs"
mkdir -p "$MITMPROXY_DIR" "$LOG_DIR"

if [[ ! -f "$ADDON_SCRIPT" ]]; then
  echo "[ERROR] Mitmproxy addon not found at $ADDON_SCRIPT" >&2
  exit 1
fi

# Print configuration
cat <<CFG
============================================
mitmproxy transparent launcher
--------------------------------------------
Listen port     : $LISTEN_PORT
State directory : $MITMPROXY_DIR
Log directory   : $LOG_DIR
Addon script    : $ADDON_SCRIPT
Upstream HTTP   : $UPSTREAM_HTTP
Upstream HTTPS  : $UPSTREAM_HTTPS
Log level       : $LOG_LEVEL
============================================
CFG

# Build command
CMD=(mitmdump \
  --mode transparent \
  --showhost \
  --listen-host 0.0.0.0 \
  --listen-port "$LISTEN_PORT" \
  --set "confdir=$MITMPROXY_DIR" \
  --set "block_global=false" \
  --set "connection_strategy=laziest" \
  --set "console_eventlog_verbosity=$LOG_LEVEL" \
  --set "http2=true" \
  --set "ssl_insecure=true" \
  --set "upstream_cert=false" \
  --set "tls_version_client_min=TLS1_2" \
  --set "tls_version_server_min=TLS1_2" \
  --scripts "$ADDON_SCRIPT"
)

# Add upstream proxy if configured
if [ -n "$UPSTREAM_HTTP" ]; then
  CMD+=(--set "upstream_http=$UPSTREAM_HTTP")
fi
if [ -n "$UPSTREAM_HTTPS" ]; then
  CMD+=(--set "upstream_https=$UPSTREAM_HTTPS")
fi

# Rotate log file
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
LOG_FILE="$LOG_DIR/mitmproxy-$TIMESTAMP.log"

echo "[INFO] Writing mitmproxy stdout/stderr to $LOG_FILE"

# ==========================================
# Export environment variables for addon.py
# ==========================================

# addon.py 需要这个变量来写入日志
export TRAFFIC_LOG_DIR="$LOG_DIR"

# fake-ip 范围配置（默认是 Clash 标准范围）
export FAKE_IP_RANGE="${FAKE_IP_RANGE:-198.18.0.0/15}"

# 如果有 UPSTREAM_HTTP，解析并导出给 addon.py
if [ -n "$UPSTREAM_HTTP" ]; then
  # 确保 addon.py 能读取到代理配置
  export HTTP_PROXY="$UPSTREAM_HTTP"
  export HTTPS_PROXY="${UPSTREAM_HTTPS:-$UPSTREAM_HTTP}"

  # 解析 host:port 给 addon.py 使用
  # 支持格式: http://172.26.144.1:7890 或 172.26.144.1:7890
  PROXY_URL="$UPSTREAM_HTTP"

  # 移除协议前缀
  PROXY_ADDR="${PROXY_URL#http://}"
  PROXY_ADDR="${PROXY_ADDR#https://}"

  # 提取 host 和 port
  if [[ "$PROXY_ADDR" =~ ^([^:]+):([0-9]+)$ ]]; then
    export CLASH_PROXY_HOST="${BASH_REMATCH[1]}"
    export CLASH_PROXY_PORT="${BASH_REMATCH[2]}"
    echo "[INFO] Clash proxy configured: $CLASH_PROXY_HOST:$CLASH_PROXY_PORT"
  else
    echo "[WARN] Cannot parse proxy address: $UPSTREAM_HTTP"
  fi
fi

# 打印导出的环境变量（调试用）
echo "[INFO] Environment variables for addon.py:"
echo "  TRAFFIC_LOG_DIR=$TRAFFIC_LOG_DIR"
echo "  FAKE_IP_RANGE=$FAKE_IP_RANGE"
echo "  CLASH_PROXY_HOST=${CLASH_PROXY_HOST:-<not set>}"
echo "  CLASH_PROXY_PORT=${CLASH_PROXY_PORT:-<not set>}"

# Launch mitmproxy
exec "${CMD[@]}" 2>&1 | tee "$LOG_FILE"

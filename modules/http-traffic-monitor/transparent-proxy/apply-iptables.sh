#!/usr/bin/env bash
# Apply iptables rules to redirect Docker network HTTP/HTTPS traffic to mitmproxy
# Usage: sudo ./apply-iptables.sh
# Environment variables:
#   NET_NAME       - docker network name (default: qq_bot_network)
#   LISTEN_PORT    - mitmproxy listen port (default: 15001)
#   EXCLUDE_CIDRS  - space-separated CIDRs to exclude (default: internal RFC1918 ranges)
#   DRY_RUN        - set to 1 to only print commands

set -euo pipefail

NET_NAME="${NET_NAME:-qq_bot_network}"
LISTEN_PORT="${LISTEN_PORT:-15001}"
EXCLUDE_CIDRS="${EXCLUDE_CIDRS:-10.0.0.0/8 172.16.0.0/12 192.168.0.0/16}"
DRY_RUN="${DRY_RUN:-0}"

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[DRY-RUN] $*"
  else
    eval "$@"
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[ERROR] Required command '$1' not found" >&2
    exit 1
  fi
}

require_command docker
require_command iptables
require_command sysctl

CIDR=$(docker network inspect "$NET_NAME" -f '{{(index .IPAM.Config 0).Subnet}}') || {
  echo "[ERROR] Unable to inspect docker network '$NET_NAME'" >&2
  exit 1
}

if [[ -z "$CIDR" ]]; then
  echo "[ERROR] Docker network '$NET_NAME' has no CIDR configuration" >&2
  exit 1
fi

echo "============================================"
echo "Applying transparent proxy iptables rules"
echo "Docker network : $NET_NAME ($CIDR)"
echo "Listen port    : $LISTEN_PORT"
echo "Exclude CIDRs  : $EXCLUDE_CIDRS"
echo "Dry run        : $DRY_RUN"
echo "============================================"

if [[ $EUID -ne 0 ]]; then
  echo "[ERROR] This script must be run as root (sudo)." >&2
  exit 1
fi

# Enable IP forwarding
run "sysctl -w net.ipv4.ip_forward=1"

# Helper to add rule if missing
ensure_rule() {
  local table=$1
  local chain=$2
  shift 2
  local rule=("iptables -t $table -C $chain $*")
  if ! eval "${rule[@]}" >/dev/null 2>&1; then
    echo "[INFO] Adding rule: iptables -t $table -A $chain $*"
    run "iptables -t $table -A $chain $*"
  else
    echo "[INFO] Rule already present: iptables -t $table -C $chain $*"
  fi
}

# Remove conflicting rules (legacy ordering)
cleanup_rule() {
  local table=$1
  local chain=$2
  shift 2
  while iptables -t "$table" -C "$chain" "$@" >/dev/null 2>&1; do
    echo "[INFO] Removing existing rule: iptables -t $table -D $chain $*"
    run "iptables -t $table -D $chain $*"
  done
}

# 简化版：不排除内部网络（容器间通信通常不使用80/443端口）
# 如果需要排除特定网段，建议使用 ipset
DST_MATCH="-s $CIDR -p tcp"

# Redirect HTTP
cleanup_rule nat PREROUTING -s "$CIDR" -p tcp --dport 80 -j REDIRECT --to-ports "$LISTEN_PORT"
ensure_rule nat PREROUTING $DST_MATCH --dport 80 -j REDIRECT --to-ports "$LISTEN_PORT"

# Redirect HTTPS
cleanup_rule nat PREROUTING -s "$CIDR" -p tcp --dport 443 -j REDIRECT --to-ports "$LISTEN_PORT"
ensure_rule nat PREROUTING $DST_MATCH --dport 443 -j REDIRECT --to-ports "$LISTEN_PORT"

# Make sure return traffic is SNATed (covers WSL2 outbound)
if ! iptables -t nat -C POSTROUTING -j MASQUERADE >/dev/null 2>&1; then
  echo "[INFO] Adding MASQUERADE rule"
  run "iptables -t nat -A POSTROUTING -j MASQUERADE"
fi

echo "[SUCCESS] iptables rules applied."

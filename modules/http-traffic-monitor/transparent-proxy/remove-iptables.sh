#!/usr/bin/env bash
# Remove iptables rules previously added for transparent proxy
# Usage: sudo ./remove-iptables.sh
# Environment variables:
#   NET_NAME    - docker network name (default: qq_bot_network)
#   LISTEN_PORT - mitmproxy listen port (default: 15001)

set -euo pipefail

NET_NAME="${NET_NAME:-qq_bot_network}"
LISTEN_PORT="${LISTEN_PORT:-15001}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[ERROR] Required command '$1' not found" >&2
    exit 1
  fi
}

require_command docker
require_command iptables

CIDR=$(docker network inspect "$NET_NAME" -f '{{(index .IPAM.Config 0).Subnet}}') || {
  echo "[ERROR] Unable to inspect docker network '$NET_NAME'" >&2
  exit 1
}

if [[ -z "$CIDR" ]]; then
  echo "[ERROR] Docker network '$NET_NAME' has no CIDR configuration" >&2
  exit 1
fi

echo "============================================"
echo "Removing transparent proxy iptables rules"
echo "Docker network : $NET_NAME ($CIDR)"
echo "Listen port    : $LISTEN_PORT"
echo "============================================"

if [[ $EUID -ne 0 ]]; then
  echo "[ERROR] This script must be run as root (sudo)." >&2
  exit 1
fi

remove_rule() {
  local table=$1
  local chain=$2
  shift 2
  while iptables -t "$table" -C "$chain" "$@" >/dev/null 2>&1; do
    echo "[INFO] Removing rule: iptables -t $table -D $chain $*"
    iptables -t "$table" -D "$chain" "$@"
  done
}

remove_rule nat PREROUTING -s "$CIDR" -p tcp --dport 80 -j REDIRECT --to-ports "$LISTEN_PORT"
remove_rule nat PREROUTING -s "$CIDR" -p tcp --dport 443 -j REDIRECT --to-ports "$LISTEN_PORT"

# Optionally remove MASQUERADE rule if no longer needed
if iptables -t nat -C POSTROUTING -j MASQUERADE >/dev/null 2>&1; then
  echo "[INFO] Consider removing the global MASQUERADE rule if it was added exclusively for mitmproxy."
fi

echo "[SUCCESS] iptables rules removed."

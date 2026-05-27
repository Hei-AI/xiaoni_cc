#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTIVE_CA_PATH="${MITMPROXY_CA_PATH:-$REPO_ROOT/modules/http-traffic-monitor/transparent-proxy/mitmproxy-data/mitmproxy-ca-cert.pem}"
SYSTEM_CA_PATH="${SYSTEM_MITMPROXY_CA_PATH:-/usr/local/share/ca-certificates/mitmproxy-current.crt}"
LEGACY_SYSTEM_CA_PATH="${LEGACY_SYSTEM_MITMPROXY_CA_PATH:-/usr/local/share/ca-certificates/mitmproxy.crt}"

if [[ ! -f "$ACTIVE_CA_PATH" ]]; then
  echo "STATUS: MISSING_ACTIVE_CA"
  echo "Active mitmproxy CA not found: $ACTIVE_CA_PATH"
  exit 1
fi

if [[ ! -f "$SYSTEM_CA_PATH" ]]; then
  echo "STATUS: MISSING_SYSTEM_CA"
  echo "System mitmproxy CA not found: $SYSTEM_CA_PATH"
  exit 2
fi

active_sha="$(sha256sum "$ACTIVE_CA_PATH" | awk '{print $1}')"
system_sha="$(sha256sum "$SYSTEM_CA_PATH" | awk '{print $1}')"
legacy_sha=""
legacy_status="missing"

if [[ -f "$LEGACY_SYSTEM_CA_PATH" ]]; then
  legacy_sha="$(sha256sum "$LEGACY_SYSTEM_CA_PATH" | awk '{print $1}')"
  legacy_status="present"
fi

echo "ACTIVE_CA_PATH=$ACTIVE_CA_PATH"
echo "SYSTEM_CA_PATH=$SYSTEM_CA_PATH"
echo "ACTIVE_CA_SHA256=$active_sha"
echo "SYSTEM_CA_SHA256=$system_sha"
echo "LEGACY_SYSTEM_CA_PATH=$LEGACY_SYSTEM_CA_PATH"
echo "LEGACY_SYSTEM_CA_STATUS=$legacy_status"
[[ -n "$legacy_sha" ]] && echo "LEGACY_SYSTEM_CA_SHA256=$legacy_sha"

if [[ "$active_sha" == "$system_sha" && ( -z "$legacy_sha" || "$active_sha" == "$legacy_sha" ) ]]; then
  echo "STATUS: OK"
  exit 0
fi

echo "STATUS: DRIFT"
echo "The active mitmproxy CA does not match the system-trusted CA bundle inputs."
echo "Host Codex websocket/MCP traffic may fail with invalid peer certificate or BadSignature."
echo "Run: scripts/install-mitmproxy-ca-system.sh"
exit 3

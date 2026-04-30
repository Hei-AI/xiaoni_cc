#!/usr/bin/env bash
set -euo pipefail

USER_CA_PATH="${MITMPROXY_CA_PATH:-$HOME/.mitmproxy/mitmproxy-ca-cert.pem}"
SYSTEM_CA_PATH="${SYSTEM_MITMPROXY_CA_PATH:-/usr/local/share/ca-certificates/mitmproxy.crt}"

if [[ ! -f "$USER_CA_PATH" ]]; then
  echo "STATUS: MISSING_USER_CA"
  echo "User mitmproxy CA not found: $USER_CA_PATH"
  exit 1
fi

if [[ ! -f "$SYSTEM_CA_PATH" ]]; then
  echo "STATUS: MISSING_SYSTEM_CA"
  echo "System mitmproxy CA not found: $SYSTEM_CA_PATH"
  exit 2
fi

user_sha="$(sha256sum "$USER_CA_PATH" | awk '{print $1}')"
system_sha="$(sha256sum "$SYSTEM_CA_PATH" | awk '{print $1}')"

echo "USER_CA_PATH=$USER_CA_PATH"
echo "SYSTEM_CA_PATH=$SYSTEM_CA_PATH"
echo "USER_CA_SHA256=$user_sha"
echo "SYSTEM_CA_SHA256=$system_sha"

if [[ "$user_sha" == "$system_sha" ]]; then
  echo "STATUS: OK"
  exit 0
fi

echo "STATUS: DRIFT"
echo "The active mitmproxy CA does not match the system-trusted mitmproxy CA."
echo "Host Codex websocket/MCP traffic may fail with invalid peer certificate or BadSignature."
echo "Run: scripts/install-mitmproxy-ca-system.sh"
exit 3

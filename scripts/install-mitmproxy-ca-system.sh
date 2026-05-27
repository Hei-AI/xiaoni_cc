#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTIVE_CA_PATH="${MITMPROXY_CA_PATH:-$REPO_ROOT/modules/http-traffic-monitor/transparent-proxy/mitmproxy-data/mitmproxy-ca-cert.pem}"
SYSTEM_CA_PATH="${SYSTEM_MITMPROXY_CA_PATH:-/usr/local/share/ca-certificates/mitmproxy-current.crt}"
LEGACY_SYSTEM_CA_PATH="${LEGACY_SYSTEM_MITMPROXY_CA_PATH:-/usr/local/share/ca-certificates/mitmproxy.crt}"

if [[ ! -f "$ACTIVE_CA_PATH" ]]; then
  echo "[install-mitmproxy-ca-system] active mitmproxy CA not found: $ACTIVE_CA_PATH" >&2
  exit 1
fi

if ! command -v sudo >/dev/null 2>&1; then
  echo "[install-mitmproxy-ca-system] sudo is required to refresh the system trust store" >&2
  exit 2
fi

sudo install -m 0644 "$ACTIVE_CA_PATH" "$SYSTEM_CA_PATH"
sudo install -m 0644 "$ACTIVE_CA_PATH" "$LEGACY_SYSTEM_CA_PATH"
if command -v update-ca-certificates >/dev/null 2>&1; then
  sudo update-ca-certificates
elif command -v update-ca-trust >/dev/null 2>&1; then
  sudo update-ca-trust
else
  echo "[install-mitmproxy-ca-system] no supported CA update command found" >&2
  exit 3
fi

echo "[install-mitmproxy-ca-system] refreshed $SYSTEM_CA_PATH and $LEGACY_SYSTEM_CA_PATH from $ACTIVE_CA_PATH"

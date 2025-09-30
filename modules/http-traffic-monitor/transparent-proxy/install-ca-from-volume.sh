#!/usr/bin/env bash
# Install mitmproxy CA certificate into the container trust store (idempotent)
# Intended to run at container startup before applications begin outbound TLS traffic.
#
# Environment variables:
#   MITMPROXY_CA_PATH   - Source certificate path (default: /certs/mitmproxy-ca-cert.pem)
#   MITMPROXY_CA_NAME   - Target filename without extension (default: mitmproxy)
#   SKIP_CA_INSTALL     - If set to 1, skip installation

set -euo pipefail

if [[ "${SKIP_CA_INSTALL:-0}" == "1" ]]; then
  echo "[install-ca] SKIP_CA_INSTALL=1, skipping certificate installation"
  exit 0
fi

SRC="${MITMPROXY_CA_PATH:-/certs/mitmproxy-ca-cert.pem}"
CA_NAME="${MITMPROXY_CA_NAME:-mitmproxy}"
TARGET_DIR="/usr/local/share/ca-certificates"
TARGET_FILE="$TARGET_DIR/${CA_NAME}.crt"

if [[ ! -f "$SRC" ]]; then
  echo "[install-ca] Certificate not found at $SRC, skipping"
  exit 0
fi

echo "[install-ca] Installing mitmproxy CA from $SRC"

mkdir -p "$TARGET_DIR"
cp "$SRC" "$TARGET_FILE"

if command -v update-ca-certificates >/dev/null 2>&1; then
  update-ca-certificates >/dev/null 2>&1
elif command -v update-ca-trust >/dev/null 2>&1; then
  update-ca-trust
else
  echo "[install-ca] WARN: no update-ca-certificates or update-ca-trust found"
fi

echo "[install-ca] Certificate installed at $TARGET_FILE"

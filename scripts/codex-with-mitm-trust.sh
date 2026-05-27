#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYSTEM_CA_BUNDLE="${SYSTEM_CA_BUNDLE:-/etc/ssl/certs/ca-certificates.crt}"

if [[ ! -f "$SYSTEM_CA_BUNDLE" ]]; then
  echo "[codex-with-mitm-trust] system CA bundle not found: $SYSTEM_CA_BUNDLE" >&2
  exit 1
fi

if [[ -x "$REPO_ROOT/scripts/check-mitmproxy-ca-drift.sh" ]]; then
  if ! "$REPO_ROOT/scripts/check-mitmproxy-ca-drift.sh"; then
    echo "[codex-with-mitm-trust] WARN: active MITM CA is not aligned with the system trust store." >&2
    echo "[codex-with-mitm-trust] WARN: run scripts/install-mitmproxy-ca-system.sh to refresh the system trust store first." >&2
  fi
fi

export SSL_CERT_FILE="$SYSTEM_CA_BUNDLE"
export REQUESTS_CA_BUNDLE="$SYSTEM_CA_BUNDLE"
export CURL_CA_BUNDLE="$SYSTEM_CA_BUNDLE"
export GIT_SSL_CAINFO="$SYSTEM_CA_BUNDLE"
export NODE_EXTRA_CA_CERTS="$SYSTEM_CA_BUNDLE"

exec codex "$@"

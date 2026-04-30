#!/usr/bin/env bash
set -euo pipefail

CA_PATH="${MITMPROXY_CA_PATH:-$HOME/.mitmproxy/mitmproxy-ca-cert.pem}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$CA_PATH" ]]; then
  echo "[codex-with-mitm-trust] mitmproxy CA not found: $CA_PATH" >&2
  exit 1
fi

export SSL_CERT_FILE="$CA_PATH"
export REQUESTS_CA_BUNDLE="$CA_PATH"
export CURL_CA_BUNDLE="$CA_PATH"
export GIT_SSL_CAINFO="$CA_PATH"
export NODE_EXTRA_CA_CERTS="$CA_PATH"

if [[ -x "$REPO_ROOT/scripts/check-mitmproxy-ca-drift.sh" ]]; then
  if ! "$REPO_ROOT/scripts/check-mitmproxy-ca-drift.sh"; then
    echo "[codex-with-mitm-trust] WARN: env-based CA injection is not enough when the system mitmproxy CA is stale." >&2
    echo "[codex-with-mitm-trust] WARN: run scripts/install-mitmproxy-ca-system.sh to refresh the system trust store." >&2
  fi
fi

exec codex "$@"

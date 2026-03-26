#!/usr/bin/env bash

set -euo pipefail

TOKEN_DIR="${HOME}/.qqbot-local/admin-debug-auth"
TOKEN_FILE="${TOKEN_DIR}/qqbot-admin-debug.token"
SNIPPET_DIR="${HOME}/.qqbot-local/admin-expose"
SNIPPET_FILE="${SNIPPET_DIR}/debug-token.caddy"

generate_token() {
  python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(32))
PY
}

mkdir -p "${TOKEN_DIR}" "${SNIPPET_DIR}"

if [[ ! -f "${TOKEN_FILE}" ]]; then
  token="$(generate_token)"
  printf '%s\n' "${token}" > "${TOKEN_FILE}"
  chmod 600 "${TOKEN_FILE}"
  echo "Created admin debug token at ${TOKEN_FILE}"
else
  chmod 600 "${TOKEN_FILE}"
  echo "Reusing existing admin debug token at ${TOKEN_FILE}"
fi

token="$(tr -d '\r\n' < "${TOKEN_FILE}")"
if [[ -z "${token}" ]]; then
  echo "Token file is empty: ${TOKEN_FILE}" >&2
  exit 1
fi

hash="$(docker run --rm caddy:2 caddy hash-password --plaintext "${token}")"

cat > "${SNIPPET_FILE}" <<EOF
debug-token ${hash}
EOF

chmod 600 "${SNIPPET_FILE}"

echo "Updated Caddy debug token snippet at ${SNIPPET_FILE}"
echo "Use username 'debug-token' and the token from ${TOKEN_FILE}"

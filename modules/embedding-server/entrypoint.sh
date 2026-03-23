#!/bin/sh
set -eu

if [ -z "${MODEL_URL:-}" ]; then
  echo "MODEL_URL is required" >&2
  exit 1
fi

if [ -z "${MODEL_PATH:-}" ]; then
  echo "MODEL_PATH is required" >&2
  exit 1
fi

mkdir -p "$(dirname "${MODEL_PATH}")"

if [ ! -s "${MODEL_PATH}" ]; then
  echo "Downloading embedding model to ${MODEL_PATH}"
  CURL_FLAGS="-L --fail --retry 5 --retry-delay 2"

  if [ "${MODEL_DOWNLOAD_INSECURE:-false}" = "true" ]; then
    CURL_FLAGS="${CURL_FLAGS} -k"
  fi

  # shellcheck disable=SC2086
  curl ${CURL_FLAGS} "${MODEL_URL}" -o "${MODEL_PATH}.tmp"
  mv "${MODEL_PATH}.tmp" "${MODEL_PATH}"
fi

exec /usr/local/bin/llama-server \
  -m "${MODEL_PATH}" \
  --embedding \
  --pooling cls \
  --host 0.0.0.0 \
  --port "${SERVER_PORT:-8080}"

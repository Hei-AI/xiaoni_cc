#!/bin/sh
set -e

# Install mitmproxy CA if provided via /certs volume
if [ -x /usr/local/bin/install-ca-from-volume.sh ]; then
  /usr/local/bin/install-ca-from-volume.sh || echo "[entrypoint] WARN: CA installation failed"
fi

exec ts-node src/index.ts

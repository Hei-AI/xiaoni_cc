#!/bin/sh
set -e

if [ -x /usr/local/bin/install-ca-from-volume.sh ]; then
  /usr/local/bin/install-ca-from-volume.sh || echo "[entrypoint] WARN: CA installation failed"
fi

exec node dist/index.js

#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/5] Rebuilding public admin frontend image..."
docker compose build admin-frontend

echo "[2/5] Recreating public admin chain..."
docker compose up -d admin-frontend admin-expose-proxy

echo "[3/5] Waiting for admin frontend container health..."
for _ in $(seq 1 30); do
  health="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' qqbot-admin-frontend 2>/dev/null || true)"
  if [[ "$health" == "healthy" || "$health" == "running" ]]; then
    break
  fi
  sleep 2
done

health="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' qqbot-admin-frontend 2>/dev/null || true)"
if [[ "$health" != "healthy" && "$health" != "running" ]]; then
  echo "Admin frontend container is not healthy: $health" >&2
  docker compose ps admin-frontend admin-expose-proxy admin-backend
  exit 1
fi

echo "[4/5] Verifying backend API..."
curl -fsS http://127.0.0.1:9080/api/health >/dev/null

echo "[5/5] Verifying public gateway..."
gateway_status="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3903/ || true)"
if [[ "$gateway_status" != "200" && "$gateway_status" != "401" ]]; then
  echo "Unexpected public gateway status: $gateway_status" >&2
  exit 1
fi

echo
echo "Public admin deploy completed."
echo "Frontend container health: $health"
echo "Backend health endpoint: OK"
echo "Gateway status on 127.0.0.1:3903: HTTP $gateway_status"
docker compose ps admin-frontend admin-expose-proxy admin-backend

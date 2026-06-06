# syntax=docker/dockerfile:1.7

ARG NPM_REGISTRY=https://registry.npmmirror.com

FROM node:18-alpine AS base
RUN apk add --no-cache curl tzdata
ENV TZ=Asia/Shanghai
RUN ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
WORKDIR /app/modules/admin-panel/backend

FROM base AS deps
WORKDIR /app
COPY packages/persistence/package.json packages/persistence/package-lock.json ./packages/persistence/
COPY packages/persistence/index.js packages/persistence/index.d.ts packages/persistence/time.js packages/persistence/traffic.js packages/persistence/self-evolution.js packages/persistence/feedback-reflection.js packages/persistence/identity-lineage.js packages/persistence/topic-lab.js packages/persistence/image-lab.js packages/persistence/agent-media.js packages/persistence/agent-tasks.js packages/persistence/agent-queue.js packages/persistence/agent-presence.js packages/persistence/agent-life-events.js packages/persistence/xiaoni-replay-events.js packages/persistence/xiaoni-activity.js packages/persistence/ab-experiment.js packages/persistence/relationship-trust.js packages/persistence/agent-memory.js packages/persistence/qq-usage.js packages/persistence/agent-runtime-control.js ./packages/persistence/
COPY packages/persistence/prisma ./packages/persistence/prisma
RUN --mount=type=cache,target=/root/.npm \
  npm --prefix ./packages/persistence ci --no-audit --no-fund \
  && npm --prefix ./packages/persistence run generate
WORKDIR /app/modules/admin-panel/backend
COPY modules/admin-panel/backend/package.json modules/admin-panel/backend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm config set registry ${NPM_REGISTRY} \
  && npm ci --include=dev --no-audit --no-fund \
  && npm config delete registry

FROM base AS build
WORKDIR /app
COPY --from=deps /app/packages/persistence ./packages/persistence
COPY --from=deps /app/modules/admin-panel/backend/node_modules ./modules/admin-panel/backend/node_modules
WORKDIR /app/modules/admin-panel/backend
COPY modules/admin-panel/backend/package.json modules/admin-panel/backend/package-lock.json ./
COPY modules/admin-panel/backend/src/ ./src/
COPY modules/admin-panel/backend/tsconfig.json ./
RUN npm run build

FROM base AS prod-deps
WORKDIR /app
COPY packages/persistence/package.json packages/persistence/package-lock.json ./packages/persistence/
COPY packages/persistence/index.js packages/persistence/index.d.ts packages/persistence/time.js packages/persistence/traffic.js packages/persistence/self-evolution.js packages/persistence/feedback-reflection.js packages/persistence/identity-lineage.js packages/persistence/topic-lab.js packages/persistence/image-lab.js packages/persistence/agent-media.js packages/persistence/agent-tasks.js packages/persistence/agent-queue.js packages/persistence/agent-presence.js packages/persistence/agent-life-events.js packages/persistence/xiaoni-replay-events.js packages/persistence/xiaoni-activity.js packages/persistence/ab-experiment.js packages/persistence/relationship-trust.js packages/persistence/agent-memory.js packages/persistence/qq-usage.js packages/persistence/agent-runtime-control.js ./packages/persistence/
COPY packages/persistence/prisma ./packages/persistence/prisma
RUN --mount=type=cache,target=/root/.npm \
  npm --prefix ./packages/persistence ci --omit=dev --no-audit --no-fund \
  && npm --prefix ./packages/persistence run generate
WORKDIR /app/modules/admin-panel/backend
COPY modules/admin-panel/backend/package.json modules/admin-panel/backend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm config set registry ${NPM_REGISTRY} \
  && npm ci --omit=dev --no-audit --no-fund \
  && npm config delete registry

FROM base AS runtime
RUN mkdir -p /app/logs /app/resources/logs /app/resources/config /app/resources/uploads
WORKDIR /app/modules/admin-panel/backend
COPY modules/admin-panel/backend/package.json modules/admin-panel/backend/package-lock.json ./
COPY --from=prod-deps /app/packages/persistence /app/packages/persistence
COPY --from=prod-deps /app/modules/admin-panel/backend/node_modules ./node_modules
COPY --from=build /app/modules/admin-panel/backend/dist ./dist

# Install helper script for loading external CA certificates at runtime
RUN cat <<'EOF' >/usr/local/bin/install-ca-from-volume.sh
#!/bin/sh
set -e

SRC="${MITMPROXY_CA_PATH:-/certs/mitmproxy-ca-cert.pem}"
CA_NAME="${MITMPROXY_CA_NAME:-mitmproxy}"
TARGET_DIR="/usr/local/share/ca-certificates"
TARGET_FILE="$TARGET_DIR/${CA_NAME}.crt"

if [ ! -f "$SRC" ]; then
  exit 0
fi

mkdir -p "$TARGET_DIR"
cp "$SRC" "$TARGET_FILE"

if command -v update-ca-certificates >/dev/null 2>&1; then
  update-ca-certificates >/dev/null 2>&1
elif command -v update-ca-trust >/dev/null 2>&1; then
  update-ca-trust >/dev/null 2>&1
fi
EOF
RUN chmod +x /usr/local/bin/install-ca-from-volume.sh

# Entrypoint wrapper installs CA if present then launches the service
COPY modules/admin-panel/backend/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# 设置环境变量
ENV NODE_ENV=production
ENV DB_HOST=qqbot-postgres
ENV DB_PORT=5432
ENV DB_USER=qqbot_user
ENV DB_PASSWORD=qqbot_password
ENV DB_NAME=qqbot_db
ENV ADMIN_PORT=9080
ENV LOG_LEVEL=info

# 暴露端口
EXPOSE 9080

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:9080/api/status || exit 1

# 启动命令通过 entrypoint 脚本执行
ENTRYPOINT ["/bin/sh", "/app/docker-entrypoint.sh"]

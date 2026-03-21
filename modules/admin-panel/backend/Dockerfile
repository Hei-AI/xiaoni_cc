# syntax=docker/dockerfile:1.7

ARG NPM_REGISTRY=https://registry.npmmirror.com

FROM node:18-alpine AS base
RUN apk add --no-cache curl tzdata
ENV TZ=Asia/Shanghai
RUN ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm config set registry ${NPM_REGISTRY} \
  && npm ci --include=dev --no-audit --no-fund \
  && npm config delete registry

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src/ ./src/
COPY tsconfig.json ./
RUN npm run build

FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm config set registry ${NPM_REGISTRY} \
  && npm ci --omit=dev --no-audit --no-fund \
  && npm config delete registry

FROM base AS runtime
RUN mkdir -p /app/logs /app/resources/logs /app/resources/config /app/resources/uploads
COPY package.json package-lock.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

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
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# 设置环境变量
ENV NODE_ENV=production
ENV DB_HOST=host.docker.internal
ENV DB_PORT=3306
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

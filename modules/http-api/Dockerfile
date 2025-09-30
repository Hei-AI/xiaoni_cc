# HTTP API Gateway - 统一外部API访问入口
FROM node:18-alpine

# 安装必要工具
RUN apk add --no-cache curl tzdata

# 设置时区为上海
ENV TZ=Asia/Shanghai
RUN ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime

# 创建工作目录
WORKDIR /app

# 创建日志目录
RUN mkdir -p /app/logs

# 复制package文件并安装依赖
COPY package*.json ./
RUN npm install

# 复制源码
COPY src/ ./src/
COPY tsconfig.json ./

# 全局安装ts-node用于生产运行
RUN npm install -g ts-node typescript

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
ENV HTTP_PORT=8080
ENV LOG_LEVEL=info
ENV LOG_DIR=/app/logs

# 暴露端口
EXPOSE 8080

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# 启动命令通过 entrypoint 脚本执行
ENTRYPOINT ["/bin/sh", "/app/docker-entrypoint.sh"]

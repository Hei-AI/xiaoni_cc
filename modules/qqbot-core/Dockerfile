# syntax=docker/dockerfile:1.7

ARG NPM_REGISTRY=https://registry.npmmirror.com

FROM node:18-alpine AS base
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

FROM node:18-alpine AS runtime
WORKDIR /app
RUN mkdir -p /app/resources/logs /app/resources/config
COPY package.json package-lock.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# 设置环境变量
ENV NODE_ENV=production
ENV DB_HOST=host.docker.internal
ENV DB_PORT=3306
ENV DB_USER=qqbot_user
ENV DB_PASSWORD=qqbot_password
ENV DB_NAME=qqbot_db
ENV BOT_QQ_NUMBER=1129974489
ENV WEBSOCKET_HOST=napcat
ENV WEBSOCKET_PORT=3001
ENV WEBSOCKET_ACCESS_TOKEN=w@123456
ENV AI_MODEL_NAME=gemini-2.5-flash
ENV LOG_LEVEL=info
ENV HTTP_PORT=8081

# Human-like Processing Configuration
ENV ENABLE_HUMAN_LIKE_PROCESSING=true
ENV MESSAGE_AGGREGATION_WINDOW_MS=5000
ENV MAX_QUEUE_SIZE=100
ENV LIFE_RHYTHM_ENABLED=true
ENV LIFE_RHYTHM_CHECK_INTERVAL_MS=30000
ENV WORK_HOURS_PROBABILITY=0.7
ENV REST_HOURS_PROBABILITY=0.4
ENV SLEEP_HOURS_PROBABILITY=0.05

# 暴露端口
EXPOSE 8081

# 健康检查（使用Node内置fetch避免额外依赖）
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8081/health',{cache:'no-store'}).then(res=>{if(!res.ok){process.exit(1);}return res.text();}).then(()=>process.exit(0)).catch(()=>process.exit(1));"

# 直接启动应用（代理配置通过docker-compose.yml环境变量注入）
CMD ["node", "dist/index.js"]

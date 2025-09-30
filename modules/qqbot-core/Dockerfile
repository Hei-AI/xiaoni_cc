# QQBot Core - 智能机器人核心服务
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 创建必要目录
RUN mkdir -p /app/resources/logs /app/resources/config

# 复制package文件并安装依赖（包含开发依赖，因为我们使用ts-node）
COPY package*.json ./
RUN npm install --include=dev

# 复制源码和配置
COPY src/ ./src/
COPY tsconfig.json ./
COPY jest.config.js ./

# 全局安装ts-node用于生产运行
RUN npm install -g ts-node typescript

# 设置环境变量
ENV NODE_ENV=production
ENV DB_HOST=host.docker.internal
ENV DB_PORT=3306
ENV DB_USER=qqbot_user
ENV DB_PASSWORD=qqbot_password
ENV DB_NAME=qqbot_db
ENV BOT_QQ_NUMBER=1129974489
ENV WEBSOCKET_HOST=host.docker.internal
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

# 健康检查 (安装curl)
RUN apk add --no-cache curl

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8081/health || exit 1

# 直接启动应用（代理配置通过docker-compose.yml环境变量注入）
CMD ["ts-node", "src/index.ts"]
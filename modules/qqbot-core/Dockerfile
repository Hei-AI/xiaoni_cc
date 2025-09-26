# QQBot Core - 智能机器人核心服务
FROM node:18-alpine

# 安装必要工具
RUN apk add --no-cache curl tzdata

# 设置时区为上海
ENV TZ=Asia/Shanghai
RUN ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime

# 创建工作目录
WORKDIR /app

# 创建必要目录
RUN mkdir -p /app/logs /app/resources/logs /app/resources/config

# 复制package文件并安装依赖
COPY package*.json ./
RUN npm install

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
ENV WEBSOCKET_HOST=127.0.0.1
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

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8081/health || exit 1

# 启动命令
CMD ["ts-node", "src/index.ts"]
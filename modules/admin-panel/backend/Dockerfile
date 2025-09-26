# Admin Panel Backend - 管理后端API服务
FROM node:18-alpine

# 安装必要工具
RUN apk add --no-cache curl tzdata

# 设置时区为上海
ENV TZ=Asia/Shanghai
RUN ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime

# 创建工作目录
WORKDIR /app

# 创建必要目录
RUN mkdir -p /app/logs /app/resources/logs /app/resources/config /app/resources/uploads

# 复制package文件并安装依赖
COPY package*.json ./
RUN npm install

# 复制源码和配置
COPY src/ ./src/
COPY tsconfig.json ./

# 编译TypeScript
RUN npm run build

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

# 启动命令 - 运行编译后的JavaScript
CMD ["node", "dist/index.js"]
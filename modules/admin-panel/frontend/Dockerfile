# Admin Panel Frontend - 管理前端界面
FROM node:18-alpine AS builder

# 安装必要工具
RUN apk add --no-cache curl

# 创建工作目录
WORKDIR /app

# 复制package文件并安装依赖
COPY package*.json ./
RUN npm install --no-audit --no-fund

# 复制源码并构建
COPY . .
RUN npm run build

# 生产阶段 - 使用nginx服务静态文件
FROM nginx:alpine

# 安装curl用于健康检查
RUN apk add --no-cache curl

# 设置时区为上海
ENV TZ=Asia/Shanghai
RUN ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime

# 创建日志目录
RUN mkdir -p /var/log/nginx /app/logs

# 复制构建结果到nginx目录
COPY --from=builder /app/dist /usr/share/nginx/html

# 复制nginx配置
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
    listen 80;
    server_name localhost;

    # Enable Docker DNS re-resolution to avoid stale upstream IPs
    resolver 127.0.0.11 valid=30s;
    resolver_timeout 5s;

    # 启用gzip压缩
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # 静态资源完全禁用缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        root /usr/share/nginx/html;
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
        add_header Pragma "no-cache";
        add_header Expires "0";
    }

    # SPA路由处理 - HTML 完全禁用缓存
    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;

        # 完全禁用缓存
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
        add_header Pragma "no-cache";
        add_header Expires "0";

        # 安全头
        add_header X-Frame-Options DENY;
        add_header X-Content-Type-Options nosniff;
        add_header X-XSS-Protection "1; mode=block";
    }

    # API代理到后端
    location /api/ {
        # Use variable-based proxy_pass so Docker DNS is re-resolved
        set $admin_backend http://qqbot-admin-backend:9080;
        proxy_pass $admin_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }

    # 健康检查端点
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }

    # 访问日志
    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;
}
EOF

# 暴露端口
EXPOSE 80

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/health || exit 1

# 启动nginx
CMD ["nginx", "-g", "daemon off;"]

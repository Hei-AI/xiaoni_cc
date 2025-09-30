# Admin Panel Frontend - 管理前端界面
FROM node:18-alpine AS builder

# 安装必要工具
RUN apk add --no-cache curl

# 创建工作目录
WORKDIR /app

# 复制package文件并安装依赖
COPY package*.json ./
RUN npm install

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
    listen 3003;
    server_name localhost;
    
    # 启用gzip压缩
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
    
    # 静态资源缓存 - 开发环境使用较短的缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        root /usr/share/nginx/html;
        expires 5m;
        add_header Cache-Control "public, max-age=300";
    }
    
    # SPA路由处理
    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
        
        # 安全头
        add_header X-Frame-Options DENY;
        add_header X-Content-Type-Options nosniff;
        add_header X-XSS-Protection "1; mode=block";
    }
    
    # API代理到后端
    location /api/ {
        proxy_pass http://qqbot-admin-backend:9080/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
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
EXPOSE 3003

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3003/health || exit 1

# 启动nginx
CMD ["nginx", "-g", "daemon off;"]
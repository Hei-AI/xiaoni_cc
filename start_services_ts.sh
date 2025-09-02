#!/bin/bash

# QQ智能机器人 TypeScript版本启动脚本

set -e

echo "🚀 Starting QQ Bot TypeScript Services..."

# 检查环境变量文件
if [ ! -f ".env" ]; then
    echo "⚠️ .env file not found, copying from .env.example"
    cp .env.example .env
    echo "📝 Please edit .env file with your configuration"
    exit 1
fi

# 检查Node.js环境
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed"
    exit 1
fi

echo "✅ Node.js version: $(node --version)"
echo "✅ npm version: $(npm --version)"

# 安装依赖
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# 编译TypeScript
echo "🔨 Building TypeScript code..."
npm run build

# 检查MySQL容器状态
echo "🔍 Checking MySQL container..."
if ! docker ps | grep -q qqbot_mysql; then
    echo "🐳 Starting MySQL container..."
    docker-compose up -d mysql
    echo "⏳ Waiting for MySQL to be ready..."
    sleep 10
fi

# 测试数据库连接
echo "🔗 Testing database connection..."
if ! docker exec qqbot_mysql mysql -u qqbot_user -pqqbot_password qqbot_db -e "SELECT 1;" > /dev/null 2>&1; then
    echo "❌ Database connection failed"
    exit 1
fi
echo "✅ Database connection successful"

# 创建日志目录
mkdir -p logs

# 检查是否有现有进程
if pgrep -f "node dist/index.js" > /dev/null; then
    echo "⚠️ Existing QQ Bot process found, stopping..."
    pkill -f "node dist/index.js"
    sleep 2
fi

# 启动服务
echo "🎯 Starting QQ Bot TypeScript version..."
npm start > logs/service.log 2>&1 &

# 获取进程ID
PROCESS_ID=$!
echo "✅ QQ Bot started with PID: $PROCESS_ID"

# 等待一秒检查进程是否正常启动
sleep 2
if ! kill -0 $PROCESS_ID 2>/dev/null; then
    echo "❌ Process failed to start, checking logs..."
    tail -20 logs/service.log
    exit 1
fi

# 验证服务健康状态
echo "🔍 Checking service health..."
sleep 5

HEALTH_CHECK=$(curl -s http://127.0.0.1:8080/health || echo "FAILED")
if echo "$HEALTH_CHECK" | grep -q "healthy"; then
    echo "✅ Service is healthy"
    echo "$HEALTH_CHECK" | jq '.' 2>/dev/null || echo "$HEALTH_CHECK"
else
    echo "❌ Service health check failed"
    echo "Last 20 lines of log:"
    tail -20 logs/service.log
    exit 1
fi

echo ""
echo "🎉 QQ Bot TypeScript version started successfully!"
echo ""
echo "📊 Service Information:"
echo "  - HTTP Server: http://127.0.0.1:8080"
echo "  - Health Check: http://127.0.0.1:8080/health"
echo "  - Process ID: $PROCESS_ID"
echo "  - Log file: logs/service.log"
echo ""
echo "📝 Useful commands:"
echo "  - Check status: curl http://127.0.0.1:8080/api/status"
echo "  - View logs: tail -f logs/service.log"
echo "  - Stop service: pkill -f 'node dist/index.js'"
echo ""

exit 0
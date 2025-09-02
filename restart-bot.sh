#!/bin/bash
# 手动Bot Server重启脚本

PROJECT_DIR="/home/liahua/IdeaProject/qq_bot"
LOG_DIR="$PROJECT_DIR/logs"

echo "🔄 正在重启QQ Bot服务器..."

# 创建日志目录
mkdir -p "$LOG_DIR"

# 切换到项目目录
cd "$PROJECT_DIR"

# 停止现有进程
echo "⏹️  停止现有服务..."
pkill -f "node dist/index.js" 2>/dev/null || true
sleep 2

# 构建项目
echo "🔨 构建TypeScript项目..."
npm run build

if [ $? -eq 0 ]; then
    echo "✅ 构建成功"
else
    echo "❌ 构建失败，请检查代码"
    exit 1
fi

# 启动服务
echo "🚀 启动Bot服务..."
nohup npm start > "$LOG_DIR/service.log" 2>&1 &

# 等待服务启动
sleep 3

# 检查服务是否正常运行
if curl -s http://127.0.0.1:8080/health > /dev/null 2>&1; then
    echo "✅ Bot服务启动成功！"
    echo "📊 访问Dashboard: http://127.0.0.1:8080/dashboard"
    echo "📋 查看日志: tail -f logs/service.log"
else
    echo "⚠️  服务可能启动失败，请检查日志: tail -f logs/service.log"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Bot server restart completed" >> "$LOG_DIR/manual-restart.log"
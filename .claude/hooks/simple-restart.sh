#!/bin/bash
# 简化的TypeScript服务重启脚本

PROJECT_DIR="/home/liahua/IdeaProject/qq_bot"
cd "$PROJECT_DIR" || exit 1

# 停止现有服务
pkill -f "node dist/index.js" 2>/dev/null || true

# 构建和启动服务
npm run build && npm start > "logs/service_$(date +%Y%m%d_%H%M%S).log" 2>&1 &

echo "TypeScript service restarted automatically"
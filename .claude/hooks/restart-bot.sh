#!/bin/bash
# Bot Server重启脚本 - 简单版本

set -e  # 出错时退出

PROJECT_DIR="/home/liahua/IdeaProject/qq_bot"
LOG_DIR="$PROJECT_DIR/logs"

# 创建日志目录
mkdir -p "$LOG_DIR"

# 切换到项目目录
cd "$PROJECT_DIR"

# 记录重启开始时间
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting bot server restart..." >> "$LOG_DIR/hook-restart.log"

# 停止现有进程
pkill -f "node dist/index.js" 2>/dev/null || true

# 等待进程完全停止
sleep 2

# 构建项目
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Building TypeScript..." >> "$LOG_DIR/hook-restart.log"
npm run build

# 启动服务并记录日志
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting bot service..." >> "$LOG_DIR/hook-restart.log"
nohup npm start > "$LOG_DIR/service.log" 2>&1 &

# 记录完成
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Bot server restart completed" >> "$LOG_DIR/hook-restart.log"

exit 0
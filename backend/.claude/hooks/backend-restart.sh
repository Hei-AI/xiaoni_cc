#!/bin/bash
# Backend-only Restart Hook for Claude Code Multi-Agent Collaboration
# 仅处理后端相关文件的修改，避免前端开发时的后端服务干扰

set -e

# 使用环境变量或默认值
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-/home/liahua/IdeaProject/qq_bot}"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/hook-backend-restart.log"

# 创建日志目录
mkdir -p "$LOG_DIR"

# 日志函数
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [Backend-Restart] $1" >> "$LOG_FILE"
}

# 读取hook输入数据
HOOK_INPUT=$(cat)
log_message "Received backend hook input: $HOOK_INPUT"

# 解析JSON获取tool_name和file_path
TOOL_NAME=$(echo "$HOOK_INPUT" | grep -o '"tool_name":"[^"]*"' | cut -d'"' -f4)
FILE_PATH=$(echo "$HOOK_INPUT" | grep -o '"file_path":"[^"]*"' | cut -d'"' -f4)

log_message "Tool: $TOOL_NAME, File: $FILE_PATH (Backend-focused hook)"

# 重启bot服务
restart_backend_service() {
    log_message "Starting backend service restart for file: $FILE_PATH"
    
    # 切换到项目目录
    cd "$PROJECT_DIR" || {
        log_message "Failed to change to project directory: $PROJECT_DIR"
        exit 1
    }
    
    # 停止现有进程
    log_message "Stopping existing backend service..."
    pkill -f "node dist/index.js" 2>/dev/null || true
    sleep 2
    
    # 构建项目
    log_message "Building TypeScript backend project..."
    if npm run build >> "$LOG_FILE" 2>&1; then
        log_message "Backend build successful"
    else
        log_message "Backend build failed - check build logs"
        exit 1
    fi
    
    # 启动服务
    log_message "Starting backend service..."
    nohup npm start > "$LOG_DIR/service.log" 2>&1 &
    SERVICE_PID=$!
    
    # 等待服务启动
    log_message "Waiting for backend service to start (PID: $SERVICE_PID)..."
    sleep 5
    
    # 健康检查
    MAX_RETRIES=10
    RETRY_COUNT=0
    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if curl -s http://127.0.0.1:8080/health > /dev/null 2>&1; then
            log_message "Backend service restarted successfully! Health check passed."
            log_message "Claude agents can now safely use backend APIs."
            break
        else
            RETRY_COUNT=$((RETRY_COUNT + 1))
            log_message "Health check attempt $RETRY_COUNT/$MAX_RETRIES failed, retrying..."
            sleep 2
        fi
    done
    
    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
        log_message "WARNING: Backend service restart completed but health check failed after $MAX_RETRIES attempts"
        log_message "Claude agents may experience API connection issues"
    fi
}

# 主逻辑 - 由于使用了filePathPatterns，这里只会处理后端文件
if [ "$TOOL_NAME" = "Write" ] || [ "$TOOL_NAME" = "Edit" ]; then
    log_message "Backend file modified: $FILE_PATH - triggering targeted restart"
    restart_backend_service
else
    log_message "Tool $TOOL_NAME does not trigger backend restart"
fi

log_message "Backend restart hook execution completed"
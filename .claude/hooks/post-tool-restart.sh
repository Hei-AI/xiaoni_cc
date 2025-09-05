#!/bin/bash
# PostToolUse Hook for Bot Server Restart
# 根据Claude Code官方hooks文档创建

set -e

# 使用环境变量或默认值
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-/home/liahua/IdeaProject/qq_bot}"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/hook-post-tool.log"

# 创建日志目录
mkdir -p "$LOG_DIR"

# 日志函数
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# 读取hook输入数据
HOOK_INPUT=$(cat)
log_message "Received hook input: $HOOK_INPUT"

# 解析JSON获取tool_name和file_path
TOOL_NAME=$(echo "$HOOK_INPUT" | grep -o '"tool_name":"[^"]*"' | cut -d'"' -f4)
FILE_PATH=$(echo "$HOOK_INPUT" | grep -o '"file_path":"[^"]*"' | cut -d'"' -f4)

log_message "Tool: $TOOL_NAME, File: $FILE_PATH"

# 检查是否需要重启后端服务
should_restart() {
    # 排除前端目录的修改
    case "$FILE_PATH" in
        # 前端相关文件，不需要重启后端
        */frontend/*)
            log_message "Frontend file detected, skipping backend restart: $FILE_PATH"
            return 1
            ;;
        # 文档和其他非后端文件，不需要重启
        */docs/*|*/README*|*.md|*.log|*/logs/*)
            log_message "Documentation/log file detected, skipping restart: $FILE_PATH"
            return 1
            ;;
        # 后端相关文件，需要重启
        */src/*|*.ts|*/package.json|*/tsconfig.json|*/database/*|*/tests/*|*.js|*/dist/*)
            log_message "Backend file detected, restart required: $FILE_PATH"
            return 0
            ;;
        # 配置文件和环境文件，需要重启  
        */.env*|*/jest.config.js|*/eslint*|*/start_services_ts.sh)
            log_message "Configuration file detected, restart required: $FILE_PATH"
            return 0
            ;;
        # 默认情况：未知文件类型，安全起见进行重启
        *)
            log_message "Unknown file type, defaulting to restart: $FILE_PATH"
            return 0
            ;;
    esac
}

# 重启bot服务
restart_bot_service() {
    log_message "Starting bot service restart..."
    
    # 切换到项目目录
    cd "$PROJECT_DIR" || exit 1
    
    # 停止现有进程
    log_message "Stopping existing bot service..."
    pkill -f "node dist/index.js" 2>/dev/null || true
    sleep 2
    
    # 构建项目
    log_message "Building TypeScript project..."
    if npm run build >> "$LOG_FILE" 2>&1; then
        log_message "Build successful"
    else
        log_message "Build failed"
        exit 1
    fi
    
    # 启动服务
    log_message "Starting bot service..."
    nohup npm start > "$LOG_DIR/service.log" 2>&1 &
    
    # 等待服务启动
    sleep 5
    
    # 健康检查
    if curl -s http://127.0.0.1:8080/health > /dev/null 2>&1; then
        log_message "Bot service restarted successfully!"
    else
        log_message "Service restart completed but health check failed"
    fi
}

# 主逻辑
if [ "$TOOL_NAME" = "Write" ] || [ "$TOOL_NAME" = "Edit" ]; then
    if should_restart; then
        log_message "File modified: $FILE_PATH - triggering restart"
        restart_bot_service
    else
        log_message "No restart needed for this file change: $FILE_PATH"
    fi
else
    log_message "Tool $TOOL_NAME does not trigger restart"
fi

log_message "Hook execution completed"
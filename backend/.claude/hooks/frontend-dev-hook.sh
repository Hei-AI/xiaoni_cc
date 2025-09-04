#!/bin/bash
# Frontend Development Hook for Claude Code
# 前端开发专用的轻量级hook，不重启后端服务

set -e

# 使用环境变量或默认值
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-/home/liahua/IdeaProject/qq_bot}"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/hook-frontend-dev.log"

# 创建日志目录
mkdir -p "$LOG_DIR"

# 日志函数
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [Frontend-Hook] $1" >> "$LOG_FILE"
}

# 读取hook输入数据
HOOK_INPUT=$(cat)
log_message "Received hook input: $HOOK_INPUT"

# 解析JSON获取tool_name和file_path
TOOL_NAME=$(echo "$HOOK_INPUT" | grep -o '"tool_name":"[^"]*"' | cut -d'"' -f4)
FILE_PATH=$(echo "$HOOK_INPUT" | grep -o '"file_path":"[^"]*"' | cut -d'"' -f4)

log_message "Tool: $TOOL_NAME, File: $FILE_PATH"

# 检查是否为前端文件
is_frontend_file() {
    case "$FILE_PATH" in
        */frontend/*)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# 前端文件处理逻辑
handle_frontend_change() {
    log_message "Processing frontend file change: $FILE_PATH"
    
    # 切换到前端目录
    FRONTEND_DIR="$PROJECT_DIR/frontend"
    if [ ! -d "$FRONTEND_DIR" ]; then
        log_message "Frontend directory not found: $FRONTEND_DIR"
        return 1
    fi
    
    cd "$FRONTEND_DIR" || exit 1
    
    # 检查是否为配置文件修改
    case "$FILE_PATH" in
        */package.json|*/vite.config.ts|*/tsconfig.json|*/tailwind.config.js)
            log_message "Frontend configuration file changed, checking if dependencies need update"
            # 可以在此处添加 npm install 检查逻辑
            ;;
        */src/*)
            log_message "Frontend source file changed: $FILE_PATH"
            # 如果需要，可以在此处触发 TypeScript 类型检查
            # npm run type-check 2>/dev/null || true
            ;;
        *)
            log_message "Frontend file change processed: $FILE_PATH"
            ;;
    esac
    
    log_message "Frontend file processing completed successfully"
}

# 主逻辑
if [ "$TOOL_NAME" = "Write" ] || [ "$TOOL_NAME" = "Edit" ]; then
    if is_frontend_file; then
        log_message "Frontend file detected - using lightweight processing"
        handle_frontend_change
    else
        log_message "Non-frontend file: $FILE_PATH - skipping frontend hook"
    fi
else
    log_message "Tool $TOOL_NAME does not trigger frontend processing"
fi

log_message "Frontend hook execution completed"
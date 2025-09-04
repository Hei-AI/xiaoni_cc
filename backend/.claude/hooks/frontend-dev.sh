#!/bin/bash
# Frontend Development Hook for Claude Code Multi-Agent Collaboration
# 前端专用轻量级hook，不干扰后端服务，优化多agent协作体验

set -e

# 使用环境变量或默认值
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-/home/liahua/IdeaProject/qq_bot}"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/hook-frontend-dev.log"

# 创建日志目录
mkdir -p "$LOG_DIR"

# 日志函数
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [Frontend-Dev] $1" >> "$LOG_FILE"
}

# 读取hook输入数据
HOOK_INPUT=$(cat)
log_message "Received frontend hook input: $HOOK_INPUT"

# 解析JSON获取tool_name和file_path
TOOL_NAME=$(echo "$HOOK_INPUT" | grep -o '"tool_name":"[^"]*"' | cut -d'"' -f4)
FILE_PATH=$(echo "$HOOK_INPUT" | grep -o '"file_path":"[^"]*"' | cut -d'"' -f4)

log_message "Tool: $TOOL_NAME, File: $FILE_PATH (Frontend-focused hook)"

# 前端文件处理逻辑
handle_frontend_change() {
    log_message "Processing frontend file change (no backend restart): $FILE_PATH"
    
    # 切换到前端目录
    FRONTEND_DIR="$PROJECT_DIR/frontend"
    if [ ! -d "$FRONTEND_DIR" ]; then
        log_message "Frontend directory not found: $FRONTEND_DIR"
        return 1
    fi
    
    cd "$FRONTEND_DIR" || {
        log_message "Failed to change to frontend directory: $FRONTEND_DIR"
        exit 1
    }
    
    # 根据文件类型执行相应操作
    case "$FILE_PATH" in
        */package.json)
            log_message "Frontend package.json modified - dependency changes detected"
            # 可选：检查是否需要npm install
            if [ -f "package-lock.json" ]; then
                log_message "Checking if npm install is needed..."
                # npm ci --dry-run 2>/dev/null || log_message "Dependencies may need update"
            fi
            ;;
        */vite.config.ts|*/tailwind.config.js|*/postcss.config.js|*/tsconfig.json)
            log_message "Frontend configuration file changed: $(basename "$FILE_PATH")"
            log_message "Note: You may need to restart Vite dev server if running"
            ;;
        */src/*.vue|*/src/*.ts|*/src/*.js)
            log_message "Frontend source file modified: $FILE_PATH"
            log_message "Hot reload should handle this automatically if Vite is running"
            # 可选：TypeScript类型检查
            # npm run type-check 2>/dev/null || log_message "Type checking skipped"
            ;;
        */src/*.css|*/src/*.scss)
            log_message "Frontend stylesheet modified: $FILE_PATH"
            log_message "CSS hot reload should apply changes automatically"
            ;;
        *)
            log_message "Frontend file processed: $FILE_PATH"
            ;;
    esac
    
    log_message "Frontend file processing completed - backend service unaffected"
    log_message "Claude agents working on backend can continue without API interruption"
}

# 主逻辑 - 由于使用了filePathPatterns，这里只会处理前端文件
if [ "$TOOL_NAME" = "Write" ] || [ "$TOOL_NAME" = "Edit" ]; then
    log_message "Frontend-only file modified: $FILE_PATH - using lightweight processing"
    handle_frontend_change
else
    log_message "Tool $TOOL_NAME does not trigger frontend processing"
fi

log_message "Frontend development hook execution completed"
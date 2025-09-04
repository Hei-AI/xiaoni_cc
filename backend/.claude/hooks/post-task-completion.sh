#!/bin/bash

# Claude Code 任务完成后的Hook脚本  
# 功能: TypeScript服务通知用户需求完成

PROJECT_DIR="/home/liahua/IdeaProject/qq_bot"
LOG_FILE="$PROJECT_DIR/logs/hooks/post-task-$(date +%Y-%m-%d).log"
USER_ID="85178516"

# 创建日志目录
mkdir -p "$PROJECT_DIR/logs/hooks"

# 记录hook执行
echo "[$(date)] Claude Code task completion hook triggered" >> "$LOG_FILE"

# 读取stdin获取hook数据
HOOK_DATA=$(cat)
echo "[$(date)] Hook data: $HOOK_DATA" >> "$LOG_FILE"

# 等待服务启动完成
echo "[$(date)] Waiting for TypeScript service to be ready..." >> "$LOG_FILE"
sleep 8

# 检查TypeScript服务是否运行成功
if curl -s http://127.0.0.1:8080/health > /dev/null 2>&1; then
    echo "[$(date)] Service restarted successfully" >> "$LOG_FILE"
    
    # 构建完成通知消息
    COMPLETION_MESSAGE="🎉 Claude Code需求处理完成
⏰ 完成时间: $(date '+%Y-%m-%d %H:%M:%S')
🔄 TypeScript服务已自动重启并验证正常
📋 可通过 /api/requirements 查看详情"
    
    # 调用API发送通知
    curl -X POST http://127.0.0.1:8080/api/send_private \
        -H "Content-Type: application/json" \
        -d "{\"user_id\": $USER_ID, \"message\": \"$COMPLETION_MESSAGE\"}" \
        >> "$LOG_FILE" 2>&1
    
    echo "[$(date)] Completion notification sent to user $USER_ID" >> "$LOG_FILE"
else
    echo "[$(date)] ERROR: TypeScript service startup failed!" >> "$LOG_FILE"
    
    # 发送错误通知
    ERROR_MESSAGE="❌ Claude Code任务完成但TypeScript服务启动失败
⏰ 时间: $(date '+%Y-%m-%d %H:%M:%S')
🔧 请手动检查服务状态: npm run build && npm start"
    
    curl -X POST http://127.0.0.1:8080/api/send_private \
        -H "Content-Type: application/json" \
        -d "{\"user_id\": $USER_ID, \"message\": \"$ERROR_MESSAGE\"}" \
        >> "$LOG_FILE" 2>&1
fi

echo "[$(date)] Hook execution completed" >> "$LOG_FILE"

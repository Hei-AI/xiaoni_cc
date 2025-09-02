#!/bin/bash

DOING_FILE="/home/liahua/IdeaProject/qq_bot/doing/Claude-BotServer-Manager-2025-09-01.md"
LAST_MODIFIED=""

echo "🔍 开始监控SE同事的工作指导更新..."
echo "📁 监控文件: $DOING_FILE"
echo "⏰ 启动时间: $(date)"
echo "---"

while true; do
    if [ -f "$DOING_FILE" ]; then
        CURRENT_MODIFIED=$(stat -c %Y "$DOING_FILE" 2>/dev/null)
        
        if [ "$CURRENT_MODIFIED" != "$LAST_MODIFIED" ]; then
            echo "📝 检测到文档更新: $(date)"
            echo "🔧 SE同事可能添加了新的技术指导"
            
            # 显示文档末尾的更新内容
            echo "📋 最新内容预览:"
            tail -20 "$DOING_FILE" | head -10
            echo "---"
            
            LAST_MODIFIED="$CURRENT_MODIFIED"
        fi
    else
        echo "❌ 监控文件不存在: $DOING_FILE"
    fi
    
    sleep 30  # 每30秒检查一次
done

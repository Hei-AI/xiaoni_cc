#!/bin/bash
# 远程执行Claude Code命令 (避免超时)

SESSION_NAME="claude_remote"
COMMAND="$1"

if [ -z "$COMMAND" ]; then
    echo "用法: $0 \"你的Claude Code命令\""
    echo "示例: $0 \"修复数据库连接超时问题\""
    exit 1
fi

# 检查会话是否存在
if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "❌ Claude Code会话不存在，请先运行: ./setup_remote_claude.sh"
    exit 1
fi

echo "📤 发送命令到Claude Code会话: $COMMAND"

# 发送命令到tmux会话
tmux send-keys -t "$SESSION_NAME" "claude -p \"$COMMAND\"" Enter

echo "✅ 命令已发送，使用以下命令查看执行结果:"
echo "tmux attach -t $SESSION_NAME"

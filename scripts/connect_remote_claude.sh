#!/bin/bash
# 快速连接Claude Code远程会话

SESSION_NAME="claude_remote"

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "🔗 连接到Claude Code远程会话..."
    tmux attach -t "$SESSION_NAME"
else
    echo "❌ Claude Code会话不存在，请先运行: ./setup_remote_claude.sh"
    exit 1
fi

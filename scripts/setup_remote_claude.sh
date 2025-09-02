#!/bin/bash
# Claude Code远程控制设置脚本
# 基于SSH + tmux方案解决超时和远程访问问题

PROJECT_DIR="/home/liahua/IdeaProject/qq_bot"
SESSION_NAME="claude_remote"

echo "🚀 设置Claude Code远程控制环境..."

# 1. 检查tmux是否安装
if ! command -v tmux &> /dev/null; then
    echo "❌ tmux未安装，请先安装: sudo apt install tmux"
    exit 1
fi

# 2. 检查claude命令是否可用
if ! command -v claude &> /dev/null; then
    echo "❌ Claude Code CLI未安装，请先安装Claude Code"
    exit 1
fi

echo "✅ 依赖检查完成"

# 3. 创建或附加到Claude Code会话
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "📱 检测到已存在的Claude会话: $SESSION_NAME"
    echo "使用以下命令连接："
    echo "  tmux attach -t $SESSION_NAME"
else
    echo "🔧 创建新的Claude Code会话..."
    
    # 创建新会话但不附加
    tmux new-session -d -s "$SESSION_NAME" -c "$PROJECT_DIR"
    
    # 设置会话环境
    tmux send-keys -t "$SESSION_NAME" "clear" Enter
    tmux send-keys -t "$SESSION_NAME" "echo '🎯 Claude Code远程会话已准备就绪'" Enter
    tmux send-keys -t "$SESSION_NAME" "echo '当前目录: $(pwd)'" Enter
    tmux send-keys -t "$SESSION_NAME" "echo '使用方法: claude -p \"你的需求\"'" Enter
    tmux send-keys -t "$SESSION_NAME" "echo ''" Enter
    
    echo "✅ Claude Code会话创建成功: $SESSION_NAME"
fi

# 4. 显示连接信息
echo ""
echo "🌐 远程连接方法:"
echo "1. 本地连接:"
echo "   tmux attach -t $SESSION_NAME"
echo ""
echo "2. SSH远程连接:"
echo "   ssh $(whoami)@$(hostname) -t \"tmux attach -t $SESSION_NAME\""
echo ""
echo "3. 手机SSH连接(需要SSH客户端):"
echo "   用户: $(whoami)"
echo "   主机: $(hostname -I | awk '{print $1}')"
echo "   命令: tmux attach -t $SESSION_NAME"
echo ""

# 5. 创建快速启动脚本
cat > "$PROJECT_DIR/scripts/connect_remote_claude.sh" << 'EOF'
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
EOF

chmod +x "$PROJECT_DIR/scripts/connect_remote_claude.sh"
echo "✅ 快速连接脚本已创建: scripts/connect_remote_claude.sh"

# 6. 创建远程命令执行脚本
cat > "$PROJECT_DIR/scripts/remote_claude_command.sh" << 'EOF'
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
EOF

chmod +x "$PROJECT_DIR/scripts/remote_claude_command.sh"
echo "✅ 远程命令执行脚本已创建: scripts/remote_claude_command.sh"

echo ""
echo "🎉 Claude Code远程控制环境设置完成！"
echo ""
echo "📝 使用说明:"
echo "1. 启动会话: ./scripts/setup_remote_claude.sh"  
echo "2. 连接会话: ./scripts/connect_remote_claude.sh"
echo "3. 远程执行: ./scripts/remote_claude_command.sh \"你的命令\""
echo "4. SSH远程: ssh user@host -t \"tmux attach -t claude_remote\""
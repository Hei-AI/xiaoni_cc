#!/bin/bash
# 安装mitmproxy_manager.py的依赖

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "正在安装Python依赖..."
pip3 install -r "$SCRIPT_DIR/requirements.txt"

# 设置执行权限
chmod +x "$SCRIPT_DIR/mitmproxy_manager.py"

echo "✅ 安装完成！"
echo ""
echo "使用方法:"
echo "  python3 $SCRIPT_DIR/mitmproxy_manager.py --help"
echo ""
echo "常用命令:"
echo "  python3 $SCRIPT_DIR/mitmproxy_manager.py start --iptables    # 启动并应用iptables"
echo "  python3 $SCRIPT_DIR/mitmproxy_manager.py stop --cleanup       # 停止并清理iptables"
echo "  python3 $SCRIPT_DIR/mitmproxy_manager.py status               # 查看状态"
echo "  python3 $SCRIPT_DIR/mitmproxy_manager.py restart              # 重启"

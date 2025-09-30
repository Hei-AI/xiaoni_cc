#!/bin/bash
# 安装mitmproxy systemd服务

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_FILE="$SCRIPT_DIR/mitmproxy.service"
SYSTEMD_DIR="/etc/systemd/system"

echo "=========================================="
echo "安装 mitmproxy systemd 服务"
echo "=========================================="

# 检查服务文件
if [ ! -f "$SERVICE_FILE" ]; then
    echo "❌ 服务文件不存在: $SERVICE_FILE"
    exit 1
fi

# 复制服务文件
echo "📋 复制服务文件到 $SYSTEMD_DIR..."
sudo cp "$SERVICE_FILE" "$SYSTEMD_DIR/mitmproxy.service"

# 重新加载systemd
echo "🔄 重新加载 systemd 配置..."
sudo systemctl daemon-reload

# 启用开机自启
echo "✅ 启用开机自启动..."
sudo systemctl enable mitmproxy.service

# 显示状态
echo ""
echo "=========================================="
echo "✅ 安装完成！"
echo "=========================================="
echo ""
echo "📝 常用命令:"
echo "  启动服务:   sudo systemctl start mitmproxy"
echo "  停止服务:   sudo systemctl stop mitmproxy"
echo "  重启服务:   sudo systemctl restart mitmproxy"
echo "  查看状态:   sudo systemctl status mitmproxy"
echo "  查看日志:   sudo journalctl -u mitmproxy -f"
echo "  禁用自启:   sudo systemctl disable mitmproxy"
echo ""
echo "⚠️  注意: 服务会在WSL2启动时自动运行"
echo ""

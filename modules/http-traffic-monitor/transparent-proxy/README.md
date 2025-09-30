# Transparent Proxy Tooling

本目录提供在 WSL2 环境下启用 mitmproxy 透明代理所需的完整工具集。配合仓库根部的文档 `docs/TRANSPARENT_PROXY_IMPLEMENTATION.md` 使用。

## 核心脚本

### 日常使用脚本
- **`start-mitmproxy-daemon.sh`** - 一键启动mitmproxy（自动检测Clash地址）
- **`stop-mitmproxy-daemon.sh`** - 一键停止mitmproxy并清理iptables规则
- `start-mitmproxy.sh` - 底层启动脚本（被daemon调用）

### iptables配置
- **`apply-iptables.sh`** - 配置iptables规则，将容器80/443流量重定向到mitmproxy
- `remove-iptables.sh` - 清理iptables规则

### 可选配置
- `install-mitmproxy-service.sh` - systemd服务安装脚本（自动启动）
- `mitmproxy.service` - systemd服务配置文件
- `wsl-startup.sh` - WSL2启动脚本（开机自启）
- `install-ca-from-volume.sh` - CA证书安装脚本

## 使用步骤概览

1. **启动 mitmproxy**
   ```bash
   sudo ./start-mitmproxy.sh
   ```
   常用环境变量：
   - `LISTEN_PORT`（默认 `15001`）
   - `UPSTREAM_HTTP` / `UPSTREAM_HTTPS`（默认 `127.0.0.1:7890`）
   - `ADDON_SCRIPT`（默认加载仓库自带 addon）

2. **写入 iptables 规则**
   ```bash
   sudo ./apply-iptables.sh
   ```
   - 支持 `NET_NAME`、`EXCLUDE_CIDRS`、`DRY_RUN=1` 等参数。
   - 默认排除 RFC1918 内网，避免容器间访问被截断。

3. **停止或回滚**
   ```bash
   sudo ./remove-iptables.sh
   ```

更多细节（如证书发放、systemd 集成、回滚指南）见主文档。执行脚本前请确认已安装 `mitmproxy`、`docker`、`iptables`，并拥有 `sudo` 权限。

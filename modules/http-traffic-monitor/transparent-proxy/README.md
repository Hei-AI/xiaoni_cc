# mitmproxy 透明代理管理工具

## 概述

本目录提供mitmproxy透明代理的统一管理工具，**推荐使用新的Python CLI工具** `mitmproxy_manager.py`，它替代了原有的多个bash脚本，解决了字符集和跨平台兼容性问题。

## ⭐ 推荐使用: Python CLI工具

### 快速开始

```bash
# 1. 安装依赖
pip3 install click colorama

# 2. 查看状态
python3 mitmproxy_manager.py status

# 3. 启动服务（推荐）
python3 mitmproxy_manager.py start --iptables

# 4. 停止服务（推荐）
python3 mitmproxy_manager.py stop --cleanup
```

### 核心功能

✅ **统一CLI入口** - 所有功能通过一个命令管理
✅ **UTF-8字符集** - 完美支持中文输出
✅ **配置文件支持** - 持久化配置，无需每次输入参数
✅ **彩色输出** - 清晰的状态提示
✅ **自动检测** - 自动检测WSL2网关IP和Docker网络
✅ **状态监控** - 实时查看运行状态和iptables规则

### 常用命令

```bash
# 查看帮助
python3 mitmproxy_manager.py --help

# 查看当前状态
python3 mitmproxy_manager.py status

# 启动mitmproxy + 应用iptables（推荐）
python3 mitmproxy_manager.py start --iptables

# 停止mitmproxy + 清理iptables（推荐）
python3 mitmproxy_manager.py stop --cleanup

# 重启服务
python3 mitmproxy_manager.py restart

# 单独管理iptables
python3 mitmproxy_manager.py iptables apply
python3 mitmproxy_manager.py iptables remove

# 配置管理
python3 mitmproxy_manager.py config show
python3 mitmproxy_manager.py config set listen_port 15001
```

### 状态展示示例

```
==================================================
mitmproxy 透明代理状态
==================================================
✅ 运行状态: 运行中 (PID: 538262)

配置信息:
  监听端口: 15001
  Docker网络: qq_bot_network
  网络CIDR: 172.20.0.0/16
  上游代理: http://172.26.144.1:7890
  数据目录: mitmproxy-data

iptables规则:
  HTTP(80)重定向: ✅ 已配置
  HTTPS(443)重定向: ✅ 已配置
==================================================
```

### 快捷方式

```bash
# 使用快捷脚本
./mitm status
./mitm start --iptables
./mitm stop --cleanup

# 或创建别名
alias mitm='python3 /path/to/mitmproxy_manager.py'
```

---

## 现有辅助文件

常规场景使用 `mitmproxy_manager.py` 或 `./mitm`，不要再查找旧 Bash 启停脚本。

- `install-mitmproxy-service.sh` - systemd服务安装
- `wsl-startup.sh` - WSL2启动脚本
- `install-ca-from-volume.sh` - CA证书安装

---

## 工作原理

### 流量路径
```
容器HTTP/HTTPS请求
  → iptables重定向(80/443 → 15001)
  → mitmproxy:15001
  → Clash代理(Windows:7890)
  → Internet
```

### 自动检测
- 自动检测WSL2默认网关（Windows宿主机IP）
- 自动检测Docker网络CIDR
- 自动构建上游代理地址

---

## 配置文件

配置文件: `config.json` (自动生成)

```json
{
  "listen_port": 15001,
  "docker_network": "qq_bot_network",
  "clash_port": 7890,
  "mitmproxy_script": "modules/http-traffic-monitor/mitmproxy/addon.py"
}
```

`sudo_password` 不应提交到仓库。需要密码时优先放在
`/home/liahua/.qqbot-local/mitmproxy/sudo-password`，或仅对当前 shell 设置
`QQBOT_MITM_SUDO_PASSWORD`。

---

## 故障排查

```bash
# 1. 检查服务状态
python3 mitmproxy_manager.py status

# 2. 前台运行查看日志
python3 mitmproxy_manager.py start --foreground

# 3. 强制清理
pkill -9 -f mitmdump
python3 mitmproxy_manager.py iptables remove

# 4. 重新启动
python3 mitmproxy_manager.py restart
```

---

## 日志位置

- **mitmproxy日志**: `logs/qqbot-traffic/mitmproxy-*.log`
- **流量记录(JSONL)**: `logs/qqbot-traffic/traffic-*.jsonl`
- **PID文件**: `/tmp/mitmproxy.pid`
- **配置文件**: `config.json`

---

## 文档

上一级 `modules/http-traffic-monitor/README.md` 维护模块级说明；仓库本机状态和 CA 约定见 `docs/AGENTS_SECRETS_LOCAL_STATE.md`。

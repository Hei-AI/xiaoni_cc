# HTTP流量监控模块 - 透明代理方案

> 基于mitmproxy的透明HTTP/HTTPS流量监控系统，专为QQ智能机器人项目设计

## 📋 模块概述

HTTP Traffic Monitor 通过mitmproxy透明代理技术，实现对Docker容器内所有HTTP/HTTPS出站流量的零侵入式监控、记录和分析。特别适用于AI API调用（如Gemini SDK）的调试和性能优化。

### 🎯 核心特性

- ✅ **透明拦截**: 基于iptables的流量重定向，无需修改应用代码
- ✅ **HTTPS解密**: 自动安装CA证书，完整记录加密流量
- ✅ **Fake-IP支持**: 智能检测Clash Fake-IP并转换为真实域名
- ✅ **SDK透明化**: 完整记录Gemini SDK等黑盒调用的真实请求内容
- ✅ **实时监控**: 毫秒级的流量捕获和JSONL格式日志
- ✅ **上游代理**: 支持通过Clash等代理转发外网请求

### 🏗️ 技术架构

```
Docker容器 (172.20.0.x)
    ↓ [HTTP/HTTPS请求]
iptables PREROUTING REDIRECT
    ↓ [端口80/443 → 15001]
mitmproxy (WSL2:15001)
    ├─ addon.py (Fake-IP检测和转换)
    ├─ 流量记录 (JSONL日志)
    └─ 上游代理转发
        ↓
Clash Proxy (172.26.144.1:7890)
    ↓
Internet
```

## 📂 目录结构

```
http-traffic-monitor/
├── mitmproxy/              # mitmproxy插件
│   ├── addon.py           # 流量拦截和日志记录
│   └── config.yaml        # mitmproxy配置
├── transparent-proxy/      # 透明代理工具
│   ├── start-mitmproxy.sh # mitmproxy启动脚本
│   ├── apply-iptables.sh  # iptables规则配置
│   ├── remove-iptables.sh # iptables规则清理
│   ├── mitmproxy-data/    # mitmproxy数据目录
│   │   └── logs/          # 流量日志和运行日志
│   └── README.md          # 透明代理说明文档
├── logs/                   # 历史日志归档
├── CLAUDE.md              # Claude Code开发指南
└── README.md              # 本文档
```

## 🚀 快速开始

### 前置要求

- **WSL2环境**: Ubuntu 22.04+
- **Python**: 3.11+ (mitmproxy依赖)
- **mitmproxy**: v11.0.2+
- **Docker**: 已安装并运行qq_bot_network (172.20.0.0/16)
- **Clash代理**: 运行在Windows宿主机，监听7890端口

### 安装mitmproxy

```bash
pip install --user mitmproxy==11.0.2
```

### 启动透明代理

#### 方法1: 一键启动（推荐）

```bash
# 项目根目录
cd /home/liahua/IdeaProject/qq_bot

# 启动mitmproxy（自动检测Clash地址）
bash modules/http-traffic-monitor/transparent-proxy/start-mitmproxy-daemon.sh
```

#### 方法2: 手动启动

```bash
cd /home/liahua/IdeaProject/qq_bot

export PATH="$HOME/.local/bin:$PATH"
export MITMPROXY_DIR="$PWD/modules/http-traffic-monitor/transparent-proxy/mitmproxy-data"
export UPSTREAM_HTTP="http://172.26.144.1:7890"

bash modules/http-traffic-monitor/transparent-proxy/start-mitmproxy.sh &
```

### 配置iptables规则

```bash
# 自动应用重定向规则
sudo bash modules/http-traffic-monitor/transparent-proxy/apply-iptables.sh
```

**验证规则**:
```bash
sudo iptables -t nat -L PREROUTING -n -v --line-numbers | grep 15001
```

期望输出:
```
2     REDIRECT   tcp  --  *  *  172.20.0.0/16  0.0.0.0/0  tcp dpt:80 redir ports 15001
3     REDIRECT   tcp  --  *  *  172.20.0.0/16  0.0.0.0/0  tcp dpt:443 redir ports 15001
```

### 测试流量拦截

```bash
# HTTP测试
docker exec qqbot-mysql curl http://www.google.com

# HTTPS测试（需要CA证书）
docker exec qqbot-qqbot-core curl https://www.google.com

# 查看日志
tail -f modules/http-traffic-monitor/transparent-proxy/mitmproxy-data/logs/mitmproxy-*.log
```

## 📊 日志格式

### JSONL流量日志

位置: `transparent-proxy/mitmproxy-data/logs/traffic-YYYY-MM-DD.jsonl`

```json
{
  "request_id": "uuid",
  "trace_id": "uuid",
  "method": "GET",
  "url": "https://generativelanguage.googleapis.com/v1beta/models",
  "host": "generativelanguage.googleapis.com",
  "path": "/v1beta/models",
  "request_headers": {...},
  "request_body": "...",
  "response_status": 200,
  "response_headers": {...},
  "response_body": "...",
  "duration_ms": 355,
  "is_ai_request": true,
  "api_type": "gemini"
}
```

### mitmproxy运行日志

位置: `transparent-proxy/mitmproxy-data/logs/mitmproxy-TIMESTAMP.log`

包含mitmproxy和addon.py的运行日志，Fake-IP检测信息等。

## ⚙️ 配置说明

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LISTEN_PORT` | 15001 | mitmproxy监听端口 |
| `UPSTREAM_HTTP` | 自动检测 | 上游Clash代理地址（自动检测网关+7890） |
| `CLASH_PORT` | 7890 | Clash端口 |
| `FAKE_IP_RANGE` | 198.18.0.0/15 | Clash Fake-IP范围 |
| `MITMPROXY_DIR` | 项目路径 | mitmproxy数据目录 |
| `TRAFFIC_LOG_DIR` | 自动设置 | 流量日志目录 |

### 自定义配置

```bash
# 自定义Clash端口
CLASH_PORT=7891 bash modules/http-traffic-monitor/transparent-proxy/start-mitmproxy-daemon.sh

# 自定义代理地址
UPSTREAM_HTTP="http://192.168.1.100:8080" bash modules/http-traffic-monitor/transparent-proxy/start-mitmproxy-daemon.sh

# 自定义监听端口
LISTEN_PORT=16000 bash modules/http-traffic-monitor/transparent-proxy/start-mitmproxy.sh
```

## 🔧 核心组件

### addon.py 插件

**主要功能**:
- Fake-IP检测: 识别198.18.0.0/15范围的虚拟IP
- 地址替换: 将Fake-IP替换为HTTP Host头中的真实域名
- 流量记录: 完整记录请求和响应到JSONL文件
- AI API识别: 自动标记Gemini、OpenAI等AI服务的请求

**关键逻辑**:
```python
# 检测Fake-IP并替换
if target_ip in self.fake_ip_network:  # 198.18.0.0/15
    real_host = flow.request.host      # 从HTTP Host头获取真实域名
    flow.server_conn.address = (real_host, port)  # 替换为真实域名
```

### 透明代理脚本

#### start-mitmproxy.sh
- 自动检测Clash代理地址（Windows网关IP）
- 配置mitmproxy透明模式
- 加载addon.py插件
- 设置上游代理和TLS参数

#### apply-iptables.sh
- 自动检测Docker网络CIDR (172.20.0.0/16)
- 配置PREROUTING链重定向规则
- 端口80/443 → 15001
- 启用IP转发和MASQUERADE

#### remove-iptables.sh
- 清理透明代理相关的iptables规则
- 恢复原始网络配置

## 🔍 使用场景

### 1. Gemini SDK调试

查看Gemini API的真实请求参数和响应内容：

```bash
# 查看今天的Gemini请求
cat transparent-proxy/mitmproxy-data/logs/traffic-$(date +%Y-%m-%d).jsonl | \
  jq 'select(.is_ai_request == true and .api_type == "gemini")'
```

### 2. 性能分析

统计API调用耗时：

```bash
# 计算平均响应时间
cat transparent-proxy/mitmproxy-data/logs/traffic-*.jsonl | \
  jq -s 'map(.duration_ms) | add / length'
```

### 3. 错误追踪

查找失败的请求：

```bash
# 查看4xx/5xx错误
cat transparent-proxy/mitmproxy-data/logs/traffic-$(date +%Y-%m-%d).jsonl | \
  jq 'select(.response_status >= 400)'
```

## 🛑 停止服务

```bash
# 停止mitmproxy
pkill -f "mitmdump.*transparent"

# 清理iptables规则
sudo bash modules/http-traffic-monitor/transparent-proxy/remove-iptables.sh
```

## 🐛 故障排除

### mitmproxy启动失败

```bash
# 检查端口占用
netstat -tlnp | grep 15001

# 前台运行查看错误
bash modules/http-traffic-monitor/transparent-proxy/start-mitmproxy.sh
```

### 流量未被拦截

```bash
# 检查iptables规则
sudo iptables -t nat -L PREROUTING -n -v --line-numbers

# 重新应用规则
sudo bash modules/http-traffic-monitor/transparent-proxy/remove-iptables.sh
sudo bash modules/http-traffic-monitor/transparent-proxy/apply-iptables.sh
```

### HTTPS证书错误

```bash
# 检查CA证书是否安装到容器
docker exec qqbot-qqbot-core ls /usr/local/share/ca-certificates/

# 需要在Dockerfile中添加证书安装步骤
```

## 📖 相关文档

- [TRANSPARENT_PROXY_FINAL_STATUS.md](../../docs/TRANSPARENT_PROXY_FINAL_STATUS.md) - 实现状态报告
- [MITMPROXY_STARTUP_GUIDE.md](../../docs/MITMPROXY_STARTUP_GUIDE.md) - 手动启动指南
- [transparent-proxy/README.md](transparent-proxy/README.md) - 透明代理工具说明
- [CLAUDE.md](CLAUDE.md) - Claude Code开发指南

## 📝 注意事项

1. **手动启动**: mitmproxy不自动启动，WSL2重启后需要手动执行
2. **iptables规则**: 重启后需要重新应用（需要sudo权限）
3. **Clash依赖**: 需要Windows侧Clash正在运行
4. **网关自动检测**: 脚本会自动检测WSL2网关地址
5. **日志轮转**: 按天自动轮转，建议定期清理旧日志

## 🔮 未来计划

- [ ] MySQL数据库集成（替代JSONL日志）
- [ ] Admin Panel Web界面展示
- [ ] 实时流量统计和告警
- [ ] CA证书自动安装到容器镜像
- [ ] systemd服务支持（可选自动启动）

---

**版本**: 1.0.0
**最后更新**: 2025-10-01
**作者**: QQ Bot Team

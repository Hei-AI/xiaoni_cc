# mitmproxy 透明代理 - 手动启动指南

## 📋 快速启动

### 方式1: Python CLI启动（推荐）

```bash
cd /home/liahua/IdeaProject/qq_bot

# 启动mitmproxy并自动应用iptables规则
python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py start --iptables

# 或仅启动mitmproxy（不配置iptables）
python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py start
```

**输出示例**:
```
[INFO] 正在启动mitmproxy...
[INFO] 上游代理: http://172.26.144.1:7890
✅ mitmproxy已启动, PID: 123456
[INFO] 正在应用iptables规则...
✅ iptables规则已应用
```

### 方式2: 后台启动

```bash
cd /home/liahua/IdeaProject/qq_bot

# 后台启动（输出重定向到日志文件）
python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py start --iptables > /tmp/mitm_start.log 2>&1 &
```

---

## 🔧 配置iptables规则（首次或重启后需要）

如果使用 `--iptables` 参数启动，规则会自动应用。手动应用：

```bash
# 手动应用规则（需要sudo权限）
python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py apply-iptables
```

**验证规则是否生效**:
```bash
sudo iptables -t nat -L PREROUTING -n -v --line-numbers | grep 15001
```

**期望输出**:
```
2     REDIRECT   tcp  --  *  *  172.20.0.0/16  0.0.0.0/0  tcp dpt:80 redir ports 15001
3     REDIRECT   tcp  --  *  *  172.20.0.0/16  0.0.0.0/0  tcp dpt:443 redir ports 15001
```

---

## 🔍 检查运行状态

### 查看进程

```bash
# 检查mitmproxy是否运行
pgrep -fa mitmdump

# 查看进程详情
ps aux | grep mitmdump | grep -v grep
```

### 查看日志

```bash
# 实时日志
tail -f logs/qqbot-traffic/mitmproxy-*.log

# 流量记录
cat logs/qqbot-traffic/traffic-$(date +%Y-%m-%d).jsonl | jq
```

---

## 🛑 停止服务

```bash
# 停止mitmproxy并清理iptables规则
python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py stop --cleanup

# 或仅停止mitmproxy（保留iptables规则）
python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py stop
```

---

## 🧪 测试流量拦截

```bash
# HTTP测试
docker exec qqbot-mysql curl http://www.google.com

# HTTPS测试（需要CA证书）
docker exec qqbot-qqbot-core curl https://www.google.com

# 查看日志确认拦截
tail -20 logs/qqbot-traffic/mitmproxy-*.log | grep "client connect"
```

---

## ⚙️ 环境变量配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LISTEN_PORT` | 15001 | mitmproxy监听端口 |
| `UPSTREAM_HTTP` | 自动检测 | Clash代理地址（自动检测网关+7890端口） |
| `CLASH_PORT` | 7890 | Clash端口（仅在未设置UPSTREAM_HTTP时生效） |
| `FAKE_IP_RANGE` | 198.18.0.0/15 | Clash Fake-IP范围 |
| `MITMPROXY_DIR` | 项目路径 | mitmproxy数据目录 |

**自定义配置示例**:
```bash
# 使用不同的Clash端口
CLASH_PORT=7891 python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py start --iptables

# 完全自定义代理地址
UPSTREAM_HTTP="http://192.168.1.100:8080" python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py start --iptables
```

---

## 🔄 WSL2重启后的启动流程

每次WSL2重启后，一键启动：

```bash
cd /home/liahua/IdeaProject/qq_bot
python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py start --iptables
```

或查看状态：

```bash
# 查看运行状态
python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py status

# 验证iptables规则
sudo iptables -t nat -L PREROUTING -n -v | grep 15001

# 测试流量
docker exec qqbot-mysql curl http://www.google.com
```

---

## 🐛 故障排除

### 问题1: mitmproxy启动失败

```bash
# 检查端口占用
netstat -tlnp | grep 15001

# 查看详细日志
python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py start
# (前台运行，观察错误信息)
```

### 问题2: 流量未被拦截

```bash
# 检查iptables规则
sudo iptables -t nat -L PREROUTING -n -v --line-numbers

# 检查Docker网络
docker network inspect qq_bot_network -f '{{(index .IPAM.Config 0).Subnet}}'

# 重新应用规则
python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py remove-iptables
python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py apply-iptables
```

### 问题3: 无法连接到Clash

```bash
# 检查Clash是否运行（Windows侧）
# 在WSL2中测试连接
DEFAULT_GATEWAY=$(ip route | grep "^default" | awk '{print $3}')
curl -x http://${DEFAULT_GATEWAY}:7890 http://www.google.com

# 检查Clash配置
# - 确保允许LAN连接
# - 确保端口为7890
```

---

## 📝 注意事项

1. **Python CLI工具**: 使用统一的Python CLI工具 `mitmproxy_manager.py` 管理所有操作
2. **iptables规则**: WSL2重启后需要重新应用iptables规则（使用 `--iptables` 参数）
3. **Clash依赖**: 需要Windows侧Clash正在运行且监听7890端口
4. **网关地址**: 工具会自动检测WSL2网关地址
5. **日志轮转**: 日志按天自动轮转，旧日志保留30天

---

## 🔗 相关文档

- [TRANSPARENT_PROXY_FINAL_STATUS.md](TRANSPARENT_PROXY_FINAL_STATUS.md) - 实现状态报告
- [TRANSPARENT_PROXY_IMPLEMENTATION.md](docs/TRANSPARENT_PROXY_IMPLEMENTATION.md) - 技术实现文档
- [HTTP_TRAFFIC_MONITORING_SOLUTION.md](HTTP_TRAFFIC_MONITORING_SOLUTION.md) - 整体方案设计

---

**最后更新**: 2025-10-01

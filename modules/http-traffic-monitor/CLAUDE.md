# CLAUDE.md — http-traffic-monitor

该模块提供透明代理与 HTTP 流量记录能力。默认使用 mitmproxy + iptables，主要执行脚本位于 [transparent-proxy](./transparent-proxy/)。

## 1. 目录速览
```
modules/http-traffic-monitor/
├── mitmproxy/               # addon、配置等
├── transparent-proxy/       # Python CLI、iptables 工具、日志目录
├── services/                # Node/Python 辅助脚本（如封装 CLI）
├── logs/                    # 历史日志归档
└── README.md                # 详细部署说明
```
详细指南请阅读 [README.md](./README.md) 与 [transparent-proxy/README.md](./transparent-proxy/README.md)；JSONL 日志由 admin-backend 的 `traffic-log-watcher` 服务实时导入数据库。

## 2. 常用操作
```bash
# 推荐入口：Python CLI（自动处理上游代理与日志路径）
python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py start --iptables

# 停止并清理iptables
python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py stop --cleanup

# 查看运行状态与实时日志
python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py status
python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py logs -f
```
保留的 `start-mitmproxy-daemon.sh` 等 bash 脚本仅作为调试备选；常规场景使用 Python CLI。

## 3. 配置要点
- 运行环境通常在 WSL2 Ubuntu，需提前安装 `mitmproxy`（推荐 11.x）与 Python 3.11+，再执行 `pip install -r modules/http-traffic-monitor/transparent-proxy/requirements.txt` 安装 CLI 依赖。
- CLI 会自动探测 Clash（默认为宿主机 7890）并写入 `logs/qqbot-traffic/mitmproxy-*.log`；如需自定义上游代理，可执行 `python3 ... config set upstream_http http://host:port`。
- 证书生成、Fake-IP 处理等逻辑集中在 [mitmproxy/addon.py](./mitmproxy/addon.py)，CLI 会注入 `TRAFFIC_LOG_DIR`、`FAKE_IP_RANGE` 等环境变量。

## 4. 集成建议
- 仅在排查或审计外部 HTTP 请求时启动；生产环境请评估安全策略。
- JSONL 流量日志默认写入 `logs/qqbot-traffic/traffic-*.jsonl` 并由 admin-backend 的 `traffic-log-watcher` 消费；若要持久化或扩展分析逻辑，可在 `services/` 中新增处理脚本。
- 与 Admin Panel 的可视化入口仍在规划阶段，相关计划见 [docs/ROADMAP.md](../../docs/ROADMAP.md)。

## 5. 提交注意
- 避免提交 `transparent-proxy/mitmproxy-data/logs/` 与 `logs/qqbot-traffic/` 中的日志文件。
- 修改 CLI 或辅助脚本后请同步更新 [README.md](./README.md)，并实际运行 `start/stop/status` 流程验证。

若对透明代理行为有疑问，先阅读 [modules/http-traffic-monitor/README.md](./README.md)，再根据实际部署环境调整脚本参数。

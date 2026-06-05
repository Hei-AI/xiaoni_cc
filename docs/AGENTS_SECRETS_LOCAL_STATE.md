# Secrets And Local State Guide

仅在任务涉及配置、部署、认证、密钥、本机调试访问时阅读本文件。

## First Split
- 先判断你要找的是 secret、联调入口，还是部署链路；不要把这三类信息混在一起查。

## Secrets
- 本机敏感信息统一从 `/home/liahua/.qqbot-local/` 读取。
- 常用位置：`/home/liahua/.qqbot-local/credentials.md`、`/home/liahua/.qqbot-local/admin-debug-auth/qqbot-admin-debug.token`、`/home/liahua/.qqbot-local/playwright/local-frontend-access.json`
- `provider-service` 的 compose 配置会额外读取 `/home/liahua/.qqbot-local/qqbot-compose.env`。Codex proxy / provider 这类本机真实配置应放这里，不要回填到 `docker-compose.yml` 或 `.env.docker.example`。
- 透明 MITM 如需 sudo 密码，放在 `/home/liahua/.qqbot-local/mitmproxy/sudo-password`，权限保持目录 `700`、文件 `600`；不要把 `sudo_password` 写回仓库内 `config.json`。
- `.env.docker.example` 只是模板，不能回填真实密钥到受版本控制文件。

## Local Runtime State
- NapCat 配置保留在 `resource/napcat_config/`。
- 运行态数据、登录二维码、截图不提交。
- 小腻 `exec_command` 的 session、审计日志和 git archive 保留在 `/home/liahua/.qqbot-local/xiaoni-runtime/`，由 compose 挂载到 `xiaoni-executor` 的 `/xiaoni-runtime`。
- CLIProxyAPI request detail 调试默认从宿主机 `/home/liahua/IdeaProject/CLIProxyAPI/logs` 只读挂载进 admin-backend 的 `/app/cliproxyapi-logs`，对应容器环境变量是 `CLIPROXY_REQUEST_LOG_DIR`。
- 透明 MITM 的 active 宿主机根证书以 `modules/http-traffic-monitor/transparent-proxy/mitmproxy-data/mitmproxy-ca-cert.pem` 为准；不要默认把 `~/.mitmproxy/mitmproxy-ca-cert.pem` 当成当前运行中的 transparent proxy 真相源。
- 如果 host-side Codex / MCP 在透明 MITM 下出现 TLS 或 MCP 启动告警，优先使用
  `scripts/codex-with-mitm-trust.sh ...` 启动 Codex，让 helper runtime 统一回到系统
  CA bundle，并先校验系统 trust store 是否已经和 active transparent MITM CA 对齐；
  不要先靠全局跳过 TLS 校验。
- 如果 `scripts/check-mitmproxy-ca-drift.sh` 报 `STATUS: DRIFT`，说明宿主机当前
  mitmproxy `confdir` 里的 active CA 与系统信任库里的 `mitmproxy-current.crt`
  或遗留 `mitmproxy.crt` 不一致。此时
  仅靠 env 注入通常修不好 Codex websocket / MCP，应该先执行
  `scripts/install-mitmproxy-ca-system.sh` 更新系统信任库。

## Access And Deployment
- 公网管理端链路固定是 `Cloudflare -> admin-expose-proxy -> Docker admin-frontend`，对应入口 `https://qqbot-admin.liahuas.top/`
- 本地前端联调只启动本地 Vite 前端，不会也不应该停掉 Docker 的 `admin-frontend`、`admin-backend` 或 `admin-expose-proxy`。
- 本地前端固定使用独立开发端口 `13003`；Docker 的公网前端继续占用 `127.0.0.1:3003`。
- 本地前端 API 仍走容器内 `admin-backend`：`http://127.0.0.1:9080`
- 本机联调地址和宿主机可访问地址统一以 `/home/liahua/.qqbot-local/playwright/local-frontend-access.json` 为准。
- 生产端附加调试入口仍沿用本机生成的 debug token；Caddy 鉴权片段保存在 `/home/liahua/.qqbot-local/admin-expose/debug-token.caddy`。

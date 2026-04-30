# Secrets And Local State Guide

仅在任务涉及配置、部署、认证、密钥、本机调试访问时阅读本文件。

## First Split
- 先判断你要找的是 secret、联调入口，还是部署链路；不要把这三类信息混在一起查。

## Secrets
- 本机敏感信息统一从 `/home/liahua/.qqbot-local/` 读取。
- 常用位置：`/home/liahua/.qqbot-local/credentials.md`、`/home/liahua/.qqbot-local/admin-debug-auth/qqbot-admin-debug.token`、`/home/liahua/.qqbot-local/playwright/local-frontend-access.json`
- `.env.docker.example` 只是模板，不能回填真实密钥到受版本控制文件。

## Local Runtime State
- NapCat 配置保留在 `resource/napcat_config/`。
- 运行态数据、登录二维码、截图不提交。
- 透明 MITM 的宿主机根证书默认在 `~/.mitmproxy/mitmproxy-ca-cert.pem`。
- 如果 host-side Codex / MCP 在透明 MITM 下出现 TLS 或 MCP 启动告警，优先使用
  `scripts/codex-with-mitm-trust.sh ...` 启动 Codex，把同一份 CA 显式注入
  `SSL_CERT_FILE`、`REQUESTS_CA_BUNDLE`、`NODE_EXTRA_CA_CERTS`；不要先靠全局跳过 TLS 校验。
- 如果 `scripts/check-mitmproxy-ca-drift.sh` 报 `STATUS: DRIFT`，说明宿主机当前
  mitmproxy 正在使用的新 CA 与系统信任库里的旧 `mitmproxy.crt` 不一致。此时
  仅靠 env 注入通常修不好 Codex websocket / MCP，应该先执行
  `scripts/install-mitmproxy-ca-system.sh` 更新系统信任库。

## Access And Deployment
- 公网管理端链路固定是 `Cloudflare -> admin-expose-proxy -> Docker admin-frontend`，对应入口 `https://qqbot-admin.liahuas.top/`
- 本地前端联调只启动本地 Vite 前端，不会也不应该停掉 Docker 的 `admin-frontend`、`admin-backend` 或 `admin-expose-proxy`。
- 本地前端固定使用独立开发端口 `13003`；Docker 的公网前端继续占用 `127.0.0.1:3003`。
- 本地前端 API 仍走容器内 `admin-backend`：`http://127.0.0.1:9080`
- 本机联调地址和宿主机可访问地址统一以 `/home/liahua/.qqbot-local/playwright/local-frontend-access.json` 为准。
- 生产端附加调试入口仍沿用本机生成的 debug token；Caddy 鉴权片段保存在 `/home/liahua/.qqbot-local/admin-expose/debug-token.caddy`。

# Secrets And Local State Guide

仅在任务涉及配置、部署、认证、密钥、本机调试访问时阅读本文件。

## Secrets
- 本机敏感信息统一从 `/home/liahua/.qqbot-local/` 读取。
- 已知位置：
  - `/home/liahua/.qqbot-local/credentials.md`
  - `/home/liahua/.qqbot-local/admin-debug-auth/qqbot-admin-debug.token`
  - `/home/liahua/.qqbot-local/playwright/local-frontend-access.json`
- `.env.docker.example` 只是模板，不能回填真实密钥到受版本控制文件。

## Local Runtime Files
- NapCat 配置保留在 `resource/napcat_config/`。
- 运行态数据、登录二维码、截图不提交。

## Deployment And Access Rules
- 公网管理端链路固定是 `Cloudflare -> admin-expose-proxy -> Docker admin-frontend`，对应入口 `https://qqbot-admin.liahuas.top/`。
- 本地前端联调只启动本地 Vite 前端，不会也不应该停掉 Docker 的 `admin-frontend`、`admin-backend` 或 `admin-expose-proxy`。
- 本地前端固定使用独立开发端口 `13003`；Docker 的公网前端继续占用 `127.0.0.1:3003`。
- 本地前端 API 仍走容器内 `admin-backend`：`http://127.0.0.1:9080`。
- 本机联调地址和宿主机可访问地址统一以 `/home/liahua/.qqbot-local/playwright/local-frontend-access.json` 为准。
- 生产端附加调试入口仍沿用本机生成的 debug token；Caddy 鉴权片段保存在 `/home/liahua/.qqbot-local/admin-expose/debug-token.caddy`。

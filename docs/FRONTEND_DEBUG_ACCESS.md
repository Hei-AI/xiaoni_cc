# Frontend Debug Access

本文件约定本仓库的两条前端调试链路：本地联调链路，以及生产端单页调试链路。

## 本地前端联调

使用 `npm run deploy:local` 或 `python3 scripts/start_modules.py start` 后：

- `admin-frontend` 会以 `0.0.0.0:3003` 启动，而不是只绑定 WSL 内部 `127.0.0.1`
- 启动脚本会写出宿主机 Chrome / Playwright MCP 应访问的地址文件：
  - `/home/liahua/.qqbot-local/playwright/local-frontend-access.json`

文件内容包含：

- `frontend_localhost_url`
- `frontend_host_browser_url`
- `host_access_ip`

当宿主机浏览器里 `http://localhost:3003` 不通时，不要继续硬猜 `127.0.0.1`，直接读取上面的 `frontend_host_browser_url`，例如 `http://172.x.x.x:3003`。

## 生产端单页调试

公网入口仍然保留原有管理员账号校验，同时额外支持一组本机生成的 debug token 凭证。

准备方式：

- `npm run deploy`
- 或 `bash scripts/deploy-admin-public.sh`

部署脚本会自动执行：

- `scripts/prepare_admin_expose_auth.sh`
- 生成或复用 token 文件：
  - `/home/liahua/.qqbot-local/admin-debug-auth/qqbot-admin-debug.token`
- 生成 Caddy token 鉴权片段：
  - `/home/liahua/.qqbot-local/admin-expose/debug-token.caddy`

使用方式：

- 打开 `https://qqbot-admin.liahuas.top/`
- 浏览器弹出鉴权框时：
  - 用户名输入 `debug-token`
  - 密码输入 `/home/liahua/.qqbot-local/admin-debug-auth/qqbot-admin-debug.token` 文件中的完整内容

说明：

- 这是给生产环境前端排障使用的附加入口，不替代原管理员凭证。
- token 明文只保存在本机 `~/.qqbot-local/`，仓库里只保留加载机制，不记录 secret。

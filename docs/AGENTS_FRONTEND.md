# Frontend Task Guide

仅在任务涉及管理端页面、交互、样式、生产前端问题时阅读本文件。

## Debugging
- 生产问题优先在真实入口排查：`https://qqbot-admin.liahuas.top/`。
- 优先用 Playwright MCP 连接宿主机已登录浏览器，不要先猜本地环境差异。
- 本地联调可用 `npm run deploy:local` 或 `python3 scripts/start_modules.py start`；默认只启动本地 Vite 前端。
- 本地前端固定跑在 `13003`，对应宿主机入口是 `http://localhost:13003` 或 `local-frontend-access.json` 中的 `frontend_host_browser_url`。
- 本地前端 `/api` 继续代理到容器内 `admin-backend`：`http://127.0.0.1:9080`，不要再尝试起一套本地后端来配前端页面调试。
- Docker 的 `admin-frontend` 仍服务于公网链路 `qqbot-admin.liahuas.top`；做本地页面联调时不要停止或替换它。
- 本机可访问地址写在 `/home/liahua/.qqbot-local/playwright/local-frontend-access.json`。
- 如果宿主机浏览器里 `http://localhost:13003` 不通，直接读取 `local-frontend-access.json` 中的 `frontend_host_browser_url`，不要继续硬猜 WSL IP。
- 生产端单页调试继续走 `https://qqbot-admin.liahuas.top/`，浏览器 Basic Auth 用户名固定为 `debug-token`，密码取 `/home/liahua/.qqbot-local/admin-debug-auth/qqbot-admin-debug.token`。

## Testing
- 当前 `modules/admin-panel/frontend` 的 `npm test` 只是占位，不代表存在自动化回归套件。
- 当前真实测试基线：
  - 先跑 `modules/admin-panel/frontend` 的 `npm run build`
  - 再做 Playwright 或宿主机浏览器关键路径手测
  - 若问题发生在生产页，优先在生产页复测
- 如果补前端自动化，沿用现有 `modules/admin-panel/frontend/playwright.config.ts` 和 `tests/` 约定，不要再引入第二套框架。

## Design Rules
- 调试/观测页面围绕真实循环：`选对象 -> 看细节 -> 判断 -> 下一个`。
- JSON、headers、payload、diff、log 属于高熵数据，必须放在固定高度且可独立滚动的容器里。
- 同一份证据只保留一个主要查看位置，不要重复堆 `overview/raw/inspector`。
- 桌面端优先稳定的 docked/sticky detail panel；浮动 inspector 只能是增强模式。
- 管理端中的 Playground UI，以及对话流里的 Playground 导入能力，参数项、字段名、默认语义和可提交 payload 都必须严格对齐通用 Provider 参数契约；这里不允许前端为了“易用性”另造一层参数翻译。

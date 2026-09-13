# Scripts Overview

本目录只保留当前主仓仍会实际使用的启动、部署、烟测和少量开发辅助脚本。

## 主要入口

- `start_modules.py`
  - 本地启动前端 Vite 联调页，并写出宿主机访问地址
- `process-manager.js`
  - `start_modules.py` 的备用实现
- `self-verification.sh`
  - 当前主栈的自验证入口
- `test-queue-connection.sh`
  - 验证 admin -> provider 的队列代理与消息模拟链路
- `verify-network.sh`
  - 检查 `provider-service`、PostgreSQL、NapCat 之间的网络连通性
- `deploy-admin-public.sh`
  - 重建并发布公网管理端前端
- `prepare_admin_expose_auth.sh`
  - 为公网管理端生成本机保存的 debug token，并写出 Caddy 鉴权片段

## reCAPTCHA 自有站点实验

`recaptcha-lab/` 是独立、零依赖的 Node 22 本地测试站点，不属于 compose 主栈。

```bash
node --test scripts/recaptcha-lab/server.test.mjs
RECAPTCHA_AUDIT_FILE=/tmp/qqbot-recaptcha-verifications.jsonl node scripts/recaptcha-lab/server.mjs
```

默认访问 `http://127.0.0.1:18764`，使用 Google 官方 reCAPTCHA v2 测试密钥。该模式固定放行，不能用来证明 Agent 能解决真实验证码；页面和服务端结果均显式标记 test。前端获取响应后由后端调用 Google `siteverify`，不会把 secret 发给浏览器；审计文件只保存验证结果，不保存响应 token。

真实实验先在 Google 注册 reCAPTCHA v2 复选框站点，把以下环境变量放到 `/home/liahua/.qqbot-local/recaptcha-lab.env`：`RECAPTCHA_MODE=live`、`RECAPTCHA_SITE_KEY`、`RECAPTCHA_SECRET_KEY`、`RECAPTCHA_HOSTNAME`（精确域名，不含协议或端口；本地可注册 localhost）。然后运行 `node --env-file=/home/liahua/.qqbot-local/recaptcha-lab.env scripts/recaptcha-lab/server.mjs`。默认仅绑定回环地址；远程访问需要自行配置受控入口。正式模式拒绝测试密钥并核对 Google 返回的 hostname；通过正式验证也不等于一定出现过图片挑战，需结合浏览器操作记录判断。

`agent-probe.cjs` 复制到当前 `qqbot-agent-service:/tmp/` 后，用 `docker exec qqbot-agent-service node /tmp/agent-probe.cjs` 运行。它调用 `ask_li_ahua` 实际使用的 `runSherlockFork`，使用部署模型、executor 和 `$xiaoni-browser`，不 mock 模型或浏览器；从 worker 入口测试，不覆盖外层求助任务创建、重试及 QQ 人工升级。结果在容器 `/tmp/recaptcha-agent-result.json`，请求记录在现有独立 fork 账本。可通过 `RECAPTCHA_LAB_URL` 指定测试页。不要和其他浏览器任务同时运行。

Google 契约：[测试密钥说明](https://developers.google.com/recaptcha/docs/faq)、[服务端验证](https://developers.google.com/recaptcha/docs/verify)。

## Current Expectations

- 当前脚本面围绕 PostgreSQL + compose 主栈维护，不再以 MySQL 直连为主线。
- 页面联调默认是本地 Vite 前端 + 容器内 backend/provider/agent-service，不要把 `start_modules.py` 理解成“起整套本地后端”。
- 如果脚本描述与 `AGENTS.md`、`docs/START_HERE.md`、`docs/INDEX.md` 冲突，以这些仓库入口文档为准并顺手修正文档。

## 保留的脚本域

- `development/`
  - 本地模拟与开发辅助脚本
- `testing/unit/`
  - 少量仍贴合当前 runtime 的 HTTP/API 级别检查脚本

## 已移除范围

以下内容已经从当前主仓脚本面移除，不再作为维护对象：

- MySQL 直连检查、修复、备份、建表脚本
- 旧 demo 数据脚本
- 依赖 `qqbot-mysql`、`mysql2`、`3306` 的历史测试与诊断脚本
- 已移除的旧服务与独立注册中心相关脚本

当前仓库不再维护 PostgreSQL 直连脚本。数据库侧排障优先走现有 HTTP 健康检查、管理端接口和 smoke 脚本。

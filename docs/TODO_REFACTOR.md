# TODO: QQBot 仓库最小化精简与 OpenClaw Bridge 独立迁移

## Summary

在正式重构前，将 `qq_bot` 收口为“运行底座 + 管理端”形态，同时把 `openclaw-bridge` 平移到同级独立新仓库，并保证迁移后服务仍可启动、仍可复用现有 NapCat 容器和 `qq_bot_network` 网络。

## Verification Snapshot

- [x] `modules/qqbot-core` 已执行 `npm run build`
- [x] `modules/admin-panel/backend` 已执行 `npm run build`
- [x] `modules/admin-panel/frontend` 已执行 `npm run build`
- [x] `qq_bot/docker-compose.yml` 已执行 `docker compose config`
- [x] `/home/liahua/IdeaProject/openclaw-bridge/docker-compose.yml` 已执行 `docker compose config`

## 1. 收敛 `qq_bot` 目标架构

- [x] 将主架构收敛为：`mysql + qqbot-core + admin-backend + admin-frontend`
- [x] 保留 `docker-compose.napcat.yml` 作为 NapCat 独立部署入口
- [x] 明确 `NapCat -> qqbot-core -> MySQL` 为唯一主运行链
- [x] 明确 Admin 仅承担运营、调试、观测职责，不再承担函数注册中心职责

## 2. 迁移 `openclaw-bridge` 到新项目

- [x] 在同级目录建立独立新仓库：`/home/liahua/IdeaProject/openclaw-bridge`
- [x] 将当前 `modules/openclaw-bridge` 的代码、`package.json`、`.env.example`、README 迁移到新仓
- [x] 在新仓提供独立 `docker-compose.yml`
- [x] 新仓 compose 复用已有 `qq_bot_network`
- [x] 新仓 compose 默认连接已存在的 NapCat 容器，不再复制 NapCat 服务本体
- [x] 新仓 compose 内补齐 bridge 服务所需环境变量、网络、健康检查、示例配置
- [x] 新仓 README 明确启动顺序
- [x] 验证 bridge 在新仓中仍能正常连接 NapCat 并提供服务
- [x] 从 `qq_bot` 删除 `modules/openclaw-bridge`
- [x] 清理 `qq_bot` 中 OpenClaw / bridge 相关 compose、脚本、workspace、主文档引用

## 3. 移除无关/废弃模块

- [x] 删除 `modules/http-api`
- [x] 删除 `modules/queue-monitor`
- [x] 清理根目录脚本、workspace 中对已删除模块的引用
- [x] 确认删除后不存在无效 npm workspace 配置

## 4. 保留并收口管理端能力

- [x] 保留 Dashboard/健康状态能力
- [x] 保留会话查看、私聊/群聊详情能力
- [x] 保留队列管理能力
- [x] 保留 Prompt 管理、编辑、调试能力
- [x] 保留 HTTP 流量查看与回放能力
- [x] 移除函数注册中心相关页面与接口
- [ ] 移除不再服务主链的遗留运营/调试页面与接口
- [x] 将流量监控/回放明确收口为管理端运维工具域

## 5. 收口 `qqbot-core`

- [x] 关闭函数注册中心依赖，默认 `ENABLE_FUNCTION_REGISTRY=false`
- [x] 清理 `qqbot-core` 中对 `http-api` 的硬依赖和启动假设
- [x] 保留核心调试接口：
  - [x] `/health`
  - [x] `/api/status`
  - [x] `/api/simple-queue/*`
  - [x] `/api/test/simulate-message`
  - [x] `/api/internal/llm/debug`
  - [x] `/api/internal/config-cache/clear`
- [x] 确认 Prompt 加载逻辑可仅依赖数据库本地配置运行
- [x] 保留静态工具和核心消息链路，不再依赖函数注册中心

## 6. 收口 Admin Backend

- [x] 去掉所有对 `http-api` 的依赖与转发
- [x] 将 Prompt 配置能力改为纯数据库驱动
- [x] 保留 Prompt 调试所需接口
- [x] 保留队列代理、会话查询、日志/状态、流量查看/回放接口
- [x] 删除 function-registry 相关 routes
- [x] 删除不再需要的 `llm-config*` 历史实现和兼容层
- [ ] 清理无主链价值的旧运营接口

## 7. 收口 Admin Frontend

- [x] 保留以下页面：
  - [x] Dashboard
  - [x] Conversations / Timeline
  - [x] Group / Private Chat Detail
  - [x] Queue Management
  - [x] Prompt Management / Edit / Detail / Debug
  - [x] HTTP Traffic Monitor / Detail
  - [x] Replay Templates
- [x] 删除已无后端支撑的页面和导航入口
- [x] 删除函数注册中心相关页面入口
- [x] 清理页面间旧兼容跳转和无效菜单项

## 8. 流量监控与回放

- [x] 保留 mitmproxy 抓包、JSONL 落盘、入库、查看、回放链路
- [x] 将 `http-traffic-monitor` 从“独立模块”定位调整为管理端工具域
- [x] 清理与已删除模块耦合的说明、脚本和命名
- [ ] 确保 Admin Backend 的 watcher 仍可正常消费流量日志

## 9. 本地运行资产模板化

- [x] 将本地运行资产加入 `.gitignore`
- [ ] 仅保留 `.env.example`、脱敏模板、空目录占位
- [x] 移除已跟踪的 IDE 文件、日志目录、数据库运行数据、NapCat/QQ 运行数据
- [x] 移除已跟踪的本地实例配置文件，仅保留脱敏模板
- [x] 用 `.gitkeep` 或说明文件保留必要空目录结构
- [x] 对“正在运行且必须保留在本机”的内容，仅从版本库和提交面剥离，不影响本地实际运行

## 10. `.gitignore` 整理

- [x] 忽略 `.idea/`、`.vscode/`、`.playwright-mcp/`
- [x] 忽略 `logs/` 与模块日志目录
- [x] 忽略 `database/mysql_data/`
- [x] 忽略 `resource/napcat_qq_data*/`
- [x] 忽略 `modules/qqbot-core/resources/napcat_qq_data/`
- [x] 忽略本地 NapCat 配置实例文件
- [x] 忽略本地 `.env`、临时脚本产物、调试导出文件

## 11. 数据库与迁移清理

- [x] 清理与已删除模块绑定的 migration / manual SQL
- [ ] 清理手工备份、应急修复、历史残留 SQL
- [ ] 只保留当前主链必需的 schema、正式迁移、初始化脚本
- [ ] 确认 Prompt、消息历史、流量日志、队列表相关结构仍完整可用

## 12. 构建与脚手架清理

- [x] 精简 root `package.json` workspaces
- [x] 精简 root scripts，只保留当前主链相关命令
- [x] 更新 `scripts/start_modules.py`，只管理保留模块
- [ ] 清理验证脚本、自检脚本中对已删除模块的引用
- [x] 清理 Docker Compose 中已删除服务的环境变量与依赖关系

## 13. 文档重写

- [x] 重写根 README，说明当前最小架构和开发方式
- [x] 更新 `AGENTS.md`
- [x] 更新 `CLAUDE.md`
- [x] 删除或归档 `http-api`、`queue-monitor`、旧 OpenClaw 引用相关主文档
- [x] 更新流量监控文档，改为管理端工具域视角
- [x] 在 `qq_bot` 文档中说明：OpenClaw Bridge 已迁移到独立仓库
- [x] 在新 `openclaw-bridge` 仓库中补齐独立部署文档

## Remaining Blockers

- [ ] 仍需决定是否继续删除 Admin Backend 中遗留的 token / user / agent 等运营接口

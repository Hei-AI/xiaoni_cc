# QQ Bot 项目

基于 OneBot 11 协议的 QQ 机器人，包含核心服务、管理界面与辅助观测组件。该仓库使用 TypeScript、MySQL 以及 Docker 进行部署与运行。

## 目录结构
```
.
├── docker-compose.yml           # 业务服务编排
├── docker-compose.napcat.yml    # NapCat 独立部署
├── scripts/                     # 启动、部署与辅助脚本
├── modules/
│   ├── qqbot-core/              # 消息处理与 AI 调度
│   ├── http-api/                # OneBot/HTTP 网关
│   ├── admin-panel/{backend,frontend}
│   └── http-traffic-monitor/    # 透明代理组件
└── docs/                        # 设计、状态与路线图
```

更多服务说明可参考 `docs/PROJECT_STATUS.md`、`docs/HUMAN_LIKE_PROCESSOR_FLOW.md` 与 `docs/LLM_TOOL_EXECUTION_DESIGN.md`。

## 快速开始

### 环境准备
1. 安装 Docker / Docker Compose。
2. 首次部署前创建网络：
   ```bash
   docker network create qq_bot_network
   ```
3. 如果需要 NapCat，请参见 `docker-compose.napcat.yml`；首次运行前执行 `mkdir -p resource/napcat_config resource/napcat_qq_data logs/napcat`，随后通过 `docker compose -f docker-compose.napcat.yml up -d` 启动。

### Build & Run
```bash
docker compose build          # 构建镜像
docker compose up -d          # 启动全部服务
docker compose ps             # 查看状态
```
- 日志：`docker logs -f qqbot-qqbot-core`、`docker logs -f qqbot-http-api` 等。
- 停止：`docker compose stop` 或 `docker compose down`。

### Compose 命令
```bash
docker compose up -d
```
默认会启动 traffic-monitor、mysql、http-api、qqbot-core、admin-backend、admin-frontend 等服务。

服务端口：
- Admin 前端：[http://localhost:3003](http://localhost:3003)
- Admin 后端 API：[http://localhost:9080/api/](http://localhost:9080/api/)
- HTTP API 网关：[http://localhost:8080/health](http://localhost:8080/health)
- qqbot-core 健康检查：[http://localhost:8081/health](http://localhost:8081/health)

## 日常开发
- 查看日志：`docker logs -f <container>`
- 进入容器调试：`docker exec -it qqbot-qqbot-core /bin/sh`
- 运行测试：`npm test`（可在容器中执行）

## 文档索引
- 项目状态：`docs/PROJECT_STATUS.md`
- 人类化消息处理：`docs/HUMAN_LIKE_PROCESSOR_FLOW.md`
- LLM 工具链设计：`docs/LLM_TOOL_EXECUTION_DESIGN.md`
- 部署说明：`DOCKER.md`
- 路线图：`docs/ROADMAP.md`

更多历史或已完成文档可在 `docs/archive/` 中查阅。

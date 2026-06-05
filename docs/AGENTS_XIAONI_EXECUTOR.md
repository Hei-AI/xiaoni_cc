# Xiaoni Executor Runtime

本页只回答 `xiaoni-executor` 这个服务怎么工作、怎么排障、改动后怎么验证。

`xiaoni-executor` 是小腻 `exec_command` 的独立运行容器。它让 `agent-service`
不在自己的容器内直接执行命令，而是把命令转发到一个挂载了仓库、runtime 目录和
Docker socket 的隔离服务。这样小腻可以运行本地 skill 脚本、读写工作区或操作
其他服务，同时避免把 `agent-service` 本身当成命令执行宿主。

## 当前接口

Docker compose 服务：

```text
service: xiaoni-executor
container: qqbot-xiaoni-executor
health: 127.0.0.1:8093 + /health
source: modules/xiaoni-executor
```

`agent-service` 通过 `XIAONI_EXECUTOR_URL` 调用它。主 compose 中当前值是：

```text
XIAONI_EXECUTOR_URL=http://qqbot-xiaoni-executor:8093
```

### `GET /health`

返回服务状态、runtime 根目录、workspace 根目录、活动 session 数和时间戳。

### `POST /api/internal/exec-command`

执行一条命令。请求体字段来自 prompt-facing `exec_command`：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `cmd` | string | 必填 | 要执行的命令；空字符串会被拒绝 |
| `workdir` | string | `WORKSPACE_ROOT` | 工作目录；`/app` 会映射到 workspace |
| `shell` | string | `/bin/bash` | 执行 shell |
| `login` | boolean | `true` | bash/zsh 下用 `-lc`，否则用 `-c` |
| `tty` | boolean | `false` | 返回字段保留；当前执行使用 pipe |
| `max_output_tokens` | number | `10000` | 输出上限，范围 `1..200000` |
| `yield_time_ms` | number | `10000` | 首次返回等待时间，范围 `250..30000` |
| `sandbox_permissions` | string | `use_default` | 原样记录和返回 |

返回 `success: true` 和 `result`。`result.codex_output` 会格式化成接近 Codex
`exec_command` 的文本，方便模型继续读取。

### `POST /api/internal/sessions/:session_id/poll`

查询还在运行或已经写入 runtime session 文件的命令。

### `POST /api/internal/sessions/:session_id/kill`

终止还在运行的命令。容器会先发 `SIGTERM`，1 秒后仍未退出则发 `SIGKILL`。

命令行辅助脚本：

```bash
docker exec -it qqbot-xiaoni-executor xiaoni-session poll <session_id>
docker exec -it qqbot-xiaoni-executor xiaoni-session kill <session_id>
```

## 路径与持久化

默认环境变量：

```text
HTTP_PORT=8093
WORKSPACE_ROOT=/workspace/qq_bot
XIAONI_RUNTIME_ROOT=/xiaoni-runtime
```

主 compose 挂载：

```text
./                         -> /workspace/qq_bot
${HOME}/.qqbot-local/xiaoni-runtime -> /xiaoni-runtime
/var/run/docker.sock       -> /var/run/docker.sock
```

路径兼容规则：

- 命令里的 `/app/...` 会替换成 `WORKSPACE_ROOT/...`。
- `workdir=/app` 会替换成 `WORKSPACE_ROOT`。
- `workdir=/app/foo` 会替换成 `WORKSPACE_ROOT/foo`。

每次执行前，executor 会在 `XIAONI_RUNTIME_ROOT/git-archives/<session_id>/`
保存当前仓库快照证据：

```text
HEAD
branch
status.txt
diff.patch
staged.diff.patch
untracked-files.txt
untracked-files.z
untracked.tar.gz      # 仅当存在未跟踪文件
```

命令 session 快照写入：

```text
XIAONI_RUNTIME_ROOT/sessions/<session_id>.json
```

审计日志写入：

```text
XIAONI_RUNTIME_ROOT/logs/exec-command.jsonl
```

## 命令策略

当前策略只拒绝空命令。也就是说，运行边界主要靠 prompt 契约、容器边界、git
archive、audit log 和人工排障，而不是 executor 内部 denylist。

`exec_command` 的工具描述会提醒小腻：`agent-service` 是她自己所在的运行容器，
可以检查但不要修改。需要重启、构建或查看其他服务时，应通过
`xiaoni-executor` 所在容器和 Docker socket 操作主栈。

## How to Verify

改动 `modules/xiaoni-executor` 后至少跑：

```bash
npm --prefix modules/xiaoni-executor test
docker compose build xiaoni-executor
docker compose up -d xiaoni-executor
docker compose ps
curl -sS 127.0.0.1:8093/health
```

如果同时改了 `agent-service` 的 `exec_command` 转发，还要跑：

```bash
npm --prefix modules/agent-service test
docker compose build agent-service
docker compose up -d agent-service
docker compose logs -f qqbot-agent-service
```

## Troubleshooting

| 现象 | 看哪里 |
|---|---|
| `exec_command` 返回 `executor_unavailable=true` | `docker compose ps`、`docker logs qqbot-xiaoni-executor`、`XIAONI_EXECUTOR_URL` |
| `/app/...` 路径找不到 | 检查路径是否被映射到 `/workspace/qq_bot/...` |
| 长命令只返回 session id | 用 `xiaoni-session poll <session_id>` 或 poll API 查后续输出 |
| 命令执行后状态不可追溯 | 看 `/home/liahua/.qqbot-local/xiaoni-runtime/git-archives/<session_id>/` |
| 输出被截断 | 提高 `max_output_tokens`，或改用更小范围的命令 |
| Docker 操作失败 | 检查 `/var/run/docker.sock` 挂载和宿主机 Docker 权限 |

## Related

- `docs/AGENTS_AGENT_LOOP_RUNTIME.md`
- `docs/XIAONI_RUNTIME_STATE_DIAGRAM.md`
- `docs/AGENTS_SECRETS_LOCAL_STATE.md`

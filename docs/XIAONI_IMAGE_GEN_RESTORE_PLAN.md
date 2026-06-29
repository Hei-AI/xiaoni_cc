# 小腻画图恢复计划 — codex via cliproxyapi

状态:计划(未动代码)。核实日期:2026-06-29。分支:`refactor/runtime-gateway`。

## 一句话

画图功能代码基本完整,断点是 transport 选择默认走了失效的 OpenAI key。
目标:把出图收口到 **codex via cliproxyapi(`:8317/backend-api`)**,与 LLM 路径一致,
不再依赖 OpenAI key。先在 **qqbot-admin image lab** 验证通,再恢复给小腻。

## 背景与断点(已读代码核实)

小腻有两条出图机制,两者后端都收口到 provider-service 的同一组内部接口:

- **(a) 主 loop 原生 `image_generation` 工具**(内联出图,model `gpt-image-2`)
  —— `agent-loop-service.ts:867,1882`
- **(b) `IMAGE_TASK_TOOL` → agent-service 异步任务管线 → provider `/api/internal/image/generate`**
  —— `agent-task-worker-service.ts:147-235`

**关键:admin image lab 与小腻任务管线打的是同一个 provider 接口。**
`image-lab-routes.ts:281` 把 `/image-lab/{generate,edit}` 代理到
`${PROVIDER_SERVICE_URL}/api/internal/image/{generate,edit}` —— 正是
`agent-task-worker-service.ts:199` 调的那个。所以修好 provider 侧的 codex+cliproxyapi
路径,admin image lab 和小腻 image_task 管线**同时**点亮;image lab 是零小腻风险的隔离测试台。

### 现状表

| 组件 | 现状 | 文件 |
|---|---|---|
| 主 loop 原生 image_generation 工具 | 已挂,model=`gpt-image-2` | `agent-loop-service.ts:867,1882` |
| image_task 工具 + 异步管线(generate/edit) | 已实现 | `agent-task-worker-service.ts:147-235` |
| provider codex 图像路径 | 已实现 `/responses` + `image_generation` tool + `tool_choice required` | `openai-image-provider.ts:689-775` |
| **transport 选择(断点)** | `auto` 模式只要有 OpenAI key 就走 OpenAI;该 key 已失效 | `openai-image-provider.ts:633-666` |
| codex 图像 base URL | 默认 `https://chatgpt.com/backend-api`(直连,**未走 cliproxyapi**) | `openai-image-provider.ts:96` |
| codex 图像鉴权 | `Authorization: Bearer <codex OAuth access>` + `chatgpt-account-id`,**无 proxy-key 路径** | `openai-image-provider.ts:670` |
| LLM codex 走 cliproxyapi(参照系) | base=`:8317/backend-api`,鉴权用 `codex_proxy_api_key` | `codex-provider.ts:25,47,364` |
| admin image lab | 代理到同一 provider 内部接口 | `image-lab-routes.ts:281` |

## 核心未知 → 决定"纯配置"还是"要改代码"

cliproxyapi 在 `/backend-api/responses` 期望哪种鉴权?

- LLM 路径用的是 **proxy api key**(`CODEX_PROXY_API_KEY`),不是 codex OAuth token。
- 图像 provider 现在只会发 **codex OAuth token**。

若 cliproxyapi 不接受 OAuth 透传 → 必须给 image-provider 加 proxy-key 鉴权路径
(镜像 codex-provider)。**所以第一步是活体探针,先定性。**

## 计划

### Phase 0 — 活体探针(先定性,~15min,不改代码)

直接 curl `http://host.docker.internal:8317/backend-api/responses`,
body 带 `image_generation` tool + `tool_choice: { type: allowed_tools, mode: required }`,
分别用两种鉴权各打一次:
1. `Authorization: Bearer <codex OAuth access>`(`/root/.codex/auth.json` 里的 access)
2. `Authorization: Bearer <CODEX_PROXY_API_KEY>`

确认:① 哪种 auth 通;② codex `/responses` 经 cliproxyapi 是否真返回图像
(`image_generation_call` / image 产物);③ 该路用什么 model
(填 `IMAGE_PROVIDER_CODEX_RESPONSE_MODEL`,默认常量见 `openai-image-provider.ts:782` 的
`DEFAULT_CODEX_RESPONSES_MODEL`)。

**出口:** 探针结果决定 Phase 1 走 A(纯配置)还是 B(加代码)。

### Phase 1A — 纯配置(若 OAuth 透传可用)

provider-service 加 3 个 env(`docker-compose.yml` provider-service 段):
- `IMAGE_PROVIDER_AUTH_MODE=codex` —— 跳过 OpenAI key 优选(`openai-image-provider.ts:634`)
- `IMAGE_PROVIDER_CODEX_BASE_URL=http://host.docker.internal:8317/backend-api`
- `IMAGE_PROVIDER_CODEX_RESPONSE_MODEL=<探针确认的模型>`

无代码改动。

### Phase 1B — 加 proxy-key 鉴权(若 cliproxyapi 要自己的 key)

`openai-image-provider.ts` 的 `resolveTransport` codex 分支增加 proxy-key 模式
(镜像 `codex-provider.ts` 的 `resolveCodexProxyApiKey`):配置了 `CODEX_PROXY_API_KEY` 时
`Authorization: Bearer <proxyKey>`、base 指向 cliproxyapi;OAuth token 仍作直连兜底。
对应 env 同 1A 三个,外加 `CODEX_PROXY_API_KEY`。

### Phase 2 — admin image lab 验证(主验收面)

`docker compose build/up provider-service` 后,在 qqbot-admin image lab 跑:
1. generate:文字 → 出图。
2. edit:带 source image → 出图。
观察 provider 日志无 codex 401/403,出图正常。**这是"能不能恢复"的判定点。**

### Phase 3 — 恢复给小腻(image lab 通过后)

同一 provider 路径已通,小腻 `IMAGE_TASK_TOOL` 管线自动可用。端到端验证:
小腻发起 image_generate/image_edit 任务 → 经 cliproxyapi codex 出图 → 落
`/xiaoni-runtime` → 任务行 `success`。QQ 发送链路(`qq-send-image-service`)已有,
本次只验到落文件。

## ⚠️ 风险:缓存对齐 + 双机制

"只走 codex" 若想移除主 loop 的原生 `gpt-image-2` 工具,务必小心:
`agent-loop-service.ts:1875` 写了**缓存对齐不变量** —— tools 前缀必须 main+fork 字节一致,
动 tools 列表会击穿 Anthropic prompt cache。

**默认不动 tools 列表**,只改 provider 后端 transport。原生 (a) 工具是否经小腻 codex cloak
真能工作,在 Phase 0 探针里一并确认;若 (a) 不通且非必须,保持工具在列但不依赖即可,
不要为了"清理"而删工具。

## 范围外

- OpenAI gpt-image 路径(本次移除依赖,不再维护)
- QQ 发送链路打磨(done 判定只到落文件)
- image-lab / playground 前端改动

## 验收标准

1. `IMAGE_PROVIDER_AUTH_MODE=codex` 下,无 OpenAI key 也能出图。
2. admin image lab generate + edit 经 cliproxyapi codex 成功出图。
3. 小腻 image_generate / image_edit 任务成功,图像落 `/xiaoni-runtime`,任务行 `success`。
4. provider-service `docker compose build/up/ps` healthy,日志无 codex 401/403。
5. main + fork tools 缓存前缀字节一致(未动 tools 列表)。

## 相关文件参考

| 文件 | 角色 |
|---|---|
| `modules/provider-service/src/services/image-provider/openai-image-provider.ts` | 主改点(transport / codex 鉴权) |
| `modules/provider-service/src/services/llm-provider/codex-provider.ts` | proxy-key 鉴权参照系 |
| `modules/provider-service/src/index.ts:1849,1872` | `/api/internal/image/{generate,edit}` 路由 |
| `modules/agent-service/src/services/agent-task-worker-service.ts` | 小腻 image_task 管线 |
| `modules/agent-service/src/services/agent-loop-service.ts:867,1875,1882` | 原生工具 + 缓存对齐不变量 |
| `modules/admin-panel/backend/src/routes/image-lab-routes.ts:281` | admin 验收面 |
| `docker-compose.yml` provider-service 段 | env 注入 |

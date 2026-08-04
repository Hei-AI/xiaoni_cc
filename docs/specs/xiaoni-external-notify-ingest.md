# Spec: 通用 notify 投递口 —— 让小腻自己写的 skill 能主动叫醒她

状态: 待实现 · 无开关直接上线 · 作者对话确认 2026-08-04

范围锁定 (用户拍板):
- 调用方 = **小腻自己写的 skill**（如 check-email），不是第三方外部系统。
- **不需要鉴权** —— 前提是这个口只在 `qq_bot_network` 容器网内可达。
- **砍掉 admin-backend 代理腿** —— 无鉴权 + 公网 Caddy 不能同时成立。
- 幂等键 **服务端生成**（每次调用唯一），skill 侧自己保证不重复投。
- **不做回执 / 状态查询**，投完就不管。
- 事件驱动，无固定频率；**不做限流**。
- 带 `source_system` 参数标来源，**正文完全由 skill 自己组织**。
- 空转记账 **零改动**：收到通知却啥也不干本来就是空转，不该重置。

---

## Context

小腻已经在写 `modules/agent-service/skills/check-email/`，`auto_check_email.py` 每 30 分钟轮询 Gmail，有新邮件就 `print("[NEW] ...")` 到 `/xiaoni-runtime/tmp/auto_email.log`。**那个 log 没有任何人读。** 后台脚本发现了事情，但没有任何通道能把这件事送到她面前 —— 除非她碰巧想起来去 `cat` 那个日志。

这是个通用缺口，不是 check-email 一家的问题：她能写 skill 去观察世界，但观察到的东西回不来。这个 issue 开一条通用投递通道，让她自己写的任何 skill 都能主动把「发生了什么」送进她的 Notify Bucket。

## Current State（2026-08-04 实测）

**通知桶没有任何通用 HTTP 写入口。** 现存 POST 路由里只有三类能间接产生 notify：

| 路由 | 位置 | 限制 |
|---|---|---|
| `POST /webhook`、`/api/onebot/events`、`/api/onebot/webhook` | `modules/provider-service/src/index.ts:1905` | 只吃 NapCat OneBot 事件 |
| `POST /api/simple-queue/simulate/{private,group}` | `modules/provider-service/src/index.ts:2461,2480` | 强制伪装成 QQ 消息，走完整 policy 管线，污染 inbox 未读 |
| `POST /api/internal/runtime/subconscious-plan/submit` | `modules/agent-service/src/index.ts:82` | 一次性票据门控，只有 `xiaoni-plan post` skill 能用 |

其余 notify 生产者全是引擎内部 hook，零 HTTP 面：clock_ping（`agent-loop-service.ts:11654`）、画图任务完成（`agent-task-worker-service.ts:497`）、群聚合 flush（`provider-service/src/index.ts:2810`）、attention lease（`provider-service/src/index.ts:1378`）。

**渲染链是现成的，不需要碰。** `renderCurrentBucketMessage`（`agent-loop-service.ts:4800`）按类型分流，四条路径最后都进 `formatSystemReminderBlock`（`:4068`）输出同一个 `<system_reminder>` 标签。其中 `renderSystemReminder`（`:4655`）→ `getSystemReminderText`（`:4647`）是唯一原样吐调用方文本的路径。

对比：`phone_notification` 接不住自定义正文。它的模板 `docs/xiaoni_prompt/phone_notification_reminder.md` 全文只有两行（`【QQ 有 {{UNREAD_DELTA}} 条新消息】` + `{{DIRECT_CUE_LINES}}`），cue 行由 `buildPhoneNotificationDirectCueLines`（`:4419`）从消息元数据反推；`:4521` 处 cue 为空直接 `return ''`，整条 notify 渲染成空串。

**落库契约。** `packages/persistence/agent-queue.js:179` `enqueueAgentQueueMessage`：
- `dedupe_key` 在 DB 层是 `@unique`（`prisma/schema.prisma:18`），撞了走 P2002 分支静默返回既有行（`:220`）
- `trace_id` 为空会自动补随机值，注释直指 `docs/CACHE_CONTRACT.md §3`：空 trace_id 让 stack event_id 塌到 runId 兜底，同一 run 两条撞 `ON CONFLICT` 后第二条内容被丢，下个 run replay 重建出更短的 body，**run 边界缓存击穿**

**非 QQ notify 的现成模板。** `enqueueSubconsciousAgentNotify`（`agent-loop-service.ts:11458`）是唯一一份可抄的形状：`source='system_reminder'`、`Surface='system_reminder'`、`SessionKey=getGlobalPromptContextSessionKey()`、`payload.systemReminder={reminder,reason,...}`。

**容器可达性。** executor 与 agent-service 同在 `qq_bot_network`（`docker-compose.yml`）；`modules/agent-service/skills/qq-usage/scripts/qq_usage.py:10-11` 已经在用 `http://qqbot-agent-service:8092/...`，本地回退 `http://127.0.0.1:8092/...`；compose 给 executor 喂了 `QQ_USAGE_ENDPOINT`（`docker-compose.yml:163`）。

**空转记账现状。** `recordIdlePlanSettle`（`agent-loop-service.ts:1002`）只在 `didRealWork` 时归零；注释 `:998-1001` 记录了 2026-07-27 的拍板：「被外部消息唤醒本身不算——她真要响应必然调工具走同一条路」。记账入口 `:8753` 的排除门只认 clock_ping：

```ts
const runDrivenOnlyByClockPing = isClockPingPayload(payload)
  && continuationQueueMessages.every((claimed) => isClockPingPayload(claimed.payload));
if (!runDrivenOnlyByClockPing) { recordIdlePlanSettle(...) }
```

## Proposed Change

### 1. 新端点 `POST /api/internal/runtime/notify`（agent-service）

挂在 `modules/agent-service/src/index.ts` 里 `subconscious-plan/submit` 旁边，同待遇：**只绑 `127.0.0.1:8092` + 容器网，无鉴权，不经 admin 暴露层。**

请求：
```json
{ "text": "收件箱有 3 封新邮件，最新一封来自 xxx", "source_system": "check-email" }
```

- `text`：必填，trim 后非空，长度上限 4000 字符
- `source_system`：必填，`^[a-z0-9][a-z0-9_-]{0,31}$`（这个值会进渲染文本，必须约束）

响应：`{ "success": true, "queue_id": 12345 }`。**无回执 / 无状态查询接口。**

路由注释必须写死暴露约束，照 `subconscious-plan/submit`（`index.ts:79-81`）那段的写法：这个口无鉴权，前提是它只在容器网内可达；任何人把它挂到 admin 或改 compose ports 绑定，等于开了一个匿名的「往她脑子塞话」的公网口。

### 2. 入队实现：克隆 `enqueueSubconsciousAgentNotify` 的形状

在 `agent-loop-service.ts` 新增 `enqueueExternalNotify`，逐字段对齐 `:11458` 那份，只改这几项：

```
source:               'system_reminder'
messageSid/dedupeKey: `external-notify:${source_system}:${randomUUID()}`
traceId:              `runtrace_${Date.now()}_${randomUUID().slice(0,8)}`   // 显式给，不靠兜底
rawPayload.reason:            'external_notify'
rawPayload.notify_template:   'external_notify.md'
rawPayload.source_system:     <source_system>
payload.systemReminder.reminder: renderPromptSnippet('external_notify.md', { SOURCE_SYSTEM, TEXT })
payload.systemReminder.reason:   'external_notify'
```

其余字段（`inboundContext.Surface='system_reminder'`、`SessionKey=getGlobalPromptContextSessionKey()`、`From/To=botAccountId`、`ChatType='direct'`）原样照抄。

**不新增 persistence 函数**，走现成的 `RuntimeStore.enqueueQueueMessage`（与 `:11528` 同一个调用点）。

### 3. 新模板 `docs/xiaoni_prompt/external_notify.md`

```
【{{SOURCE_SYSTEM}}】{{TEXT}}
```

来源标记机械拼接，不靠调用方在正文里自觉写。正文内容完全归调用方 skill 自己组织。措辞后续要改直接改这个 md，不用动代码。

**模板里绝不放时间戳** —— 报时是 `clock_ping` 的职责，塞进来会在 replay 时漂移。

### 4. 渲染分流：零新增分支

`isSystemReminderPayload`（`:14838`）已经认 `source==='system_reminder'`，`renderSystemReminder` 已经原样吐 `systemReminder.reminder`。**渲染侧一行不改。**

只新增一个判定函数 `isExternalNotifyPayload`（`reason==='external_notify' && notify_template==='external_notify.md'`，抄 `isSubconsciousAgentNotifyPayload:14868` 的形状），用于观测和日后加行为门；**当前不接进 `classifyCurrentBucketMessageTemplate`**。

### 5. skill 侧：一个共享投递脚本

新增 `modules/agent-service/skills/notify/`：

- `SKILL.md` — 告诉她「任何后台脚本发现了事情，用这个把它送到你面前」；**必须写清楚没有幂等，重复调用会重复吵她**
- `scripts/notify.py` — 抄 `qq_usage.py:10-11` 的双端点回退（容器名优先、`127.0.0.1` 兜底）。CLI：
  ```bash
  python3 notify.py --from check-email "收件箱有 3 封新邮件"
  ```

`docker-compose.yml` 给 xiaoni-executor 加：
```
- XIAONI_NOTIFY_ENDPOINT=http://qqbot-agent-service:8092/api/internal/runtime/notify
```

改 `modules/agent-service/skills/check-email/scripts/auto_check_email.py`：`[NEW]` 分支从 `print` 改成调 `notify.py`。它已有 `LAST_COUNT_FILE` 状态去重，只在未读计数变化时触发 —— **这是幂等的唯一防线**（服务端 dedupe key 每次随机，重复调用必然重复投递）。

### 6. 空转记账：零改动

外部 notify 拉起的 run 走今天的默认路径（`:8753` 的排除门只认 clock_ping，不动它）。

- 她真去处理 → 任何非 `recover_energy` 的工具调用 → `recordIdlePlanSettle` 走 `didRealWork` 归零
- 她收到通知纯文本收工 → +1

符合 2026-07-27 拍板「只有有效产出归零」。**收到通知却啥也不干本来就是空转，不该重置。**

## 双缓存影响分析（CLAUDE.md 铁律）

**① 下一次主 run 缓存：安全。** 文本在 enqueue 时冻结进 `payload.systemReminder.reminder`，replay 从同一字段读同样的字节 —— 与 `subconscious_agent` notify 完全同一机制（已在线验过）。模板渲染发生在入队时刻而非请求构建时刻，无时钟漂移面。

**② fork 缓存：安全。** notify 落在 message tier 尾部，不改动它之前的任何字节；fork 克隆主请求，尾部多一项对前缀的影响与任何一条普通 notify 完全同类，不引入新的漂移类别。

**验证方式：** 部署后取相邻两 slice 的 `wire_request` 实测 `cache_read_input_tokens`，不靠推断。

## Acceptance Criteria

1. `POST /api/internal/runtime/notify` 带合法 body 返回 200 + 非零 `queue_id`；`agent_queue_messages` 出现一行 `source='system_reminder'`、`dedupe_key` 以 `external-notify:` 开头、`trace_id` 非空
2. `text` 为空 / 缺失 / trim 后为空 / 超 4000 字符 → 400 且不入队
3. `source_system` 缺失或不匹配 `^[a-z0-9][a-z0-9_-]{0,31}$` → 400 且不入队
4. 该行被 claim 后，她的请求体里出现 `<system_reminder>【check-email】...</system_reminder>`，正文与投递文本逐字相同
5. 连投两次完全相同的 `text`+`source_system` → 产生两条独立 notify（服务端随机 key 的既定行为，SKILL.md 中明确警示）
6. 从 xiaoni-executor 容器内跑 `python3 notify.py --from check-email "test"` 能成功投递（真机，不是 mock）
7. `auto_check_email.py` 在未读数变化时投递、未变化时不投递
8. 外部 notify 拉起的 run：她纯文本收工 → `getConsecutiveIdlePlanFailures` +1；她调了任一非 `recover_energy` 工具 → 归零
9. 三份冻结缓存用例全绿：`modules/agent-service/src/__tests__/cache-replay-consistency.test.ts`、`modules/agent-service/src/__tests__/fork-cache-alignment.test.ts`、`packages/persistence/__tests__/agent-stack-event-id-dedup{,.realdb}.test.js`
10. 活体验证：投递前后相邻两 slice 的 `cache_read_input_tokens` 无塌陷

## Testing Plan

| 层 | 测什么 | 数量 |
|---|---|---|
| Unit | `enqueueExternalNotify` payload 形状逐字段断言 | +2 |
| Unit | `isExternalNotifyPayload` 判定（正例 + 与 subconscious/clock_ping 不混淆） | +2 |
| Unit | 路由入参校验（空 text / 超长 text / 非法 source_system） | +3 |
| Integration | 入队 → claim → `renderCurrentBucketMessage` 输出逐字比对 | +2 |
| Integration | replay 一致性：同一条 notify 两次 replay 字节相同 | +1 |
| 真机 | executor 容器内跑 `notify.py` 打通 | +1 |

## Rollback Plan

纯新增，不碰任何现有分支：删路由 + 删模板 + 回滚 compose 环境变量即可。已入队的 `external_notify` 行走既有 `system_reminder` 渲染路径，回滚后仍能正常消费完（模板文件删了会走 `system_reminder_fallback.md` 兜底，不会崩）。**无 schema 变更，无迁移。**

## Effort Estimate

| 部分 | 估时 |
|---|---|
| 路由 + `enqueueExternalNotify` | 1.5h |
| 模板 + 渲染验证 | 0.5h |
| skill 脚本 + SKILL.md + compose | 1h |
| 测试（11 条） | 2h |
| 部署 + 活体缓存验证 | 1h |

合计 ~6h。

## Files Reference

| 文件 | 改动 |
|---|---|
| `modules/agent-service/src/index.ts` | 新增 `POST /api/internal/runtime/notify`（含暴露约束注释） |
| `modules/agent-service/src/services/agent-loop-service.ts` | 新增 `enqueueExternalNotify` + `isExternalNotifyPayload` |
| `docs/xiaoni_prompt/external_notify.md` | 新建模板 |
| `modules/agent-service/skills/notify/SKILL.md` | 新建 |
| `modules/agent-service/skills/notify/scripts/notify.py` | 新建，抄 `qq_usage.py` 双端点回退 |
| `modules/agent-service/skills/check-email/scripts/auto_check_email.py` | `[NEW]` 分支改调 notify |
| `docker-compose.yml` | xiaoni-executor 加 `XIAONI_NOTIFY_ENDPOINT` |

## Out of Scope

- **鉴权 / 限流 / 优先级** —— 明确不做。前提是这个口只在容器网内可达
- **admin-backend 代理腿** —— 明确砍掉。无鉴权 + 公网 Caddy 两条凑一起太危险；将来真有跨机外部系统，那时候再加腿并同时补鉴权
- **回执 / 状态查询接口** —— 投完就不管
- **`phone_notification` 语义的投递** —— 模板结构接不住自定义正文
- **延迟投递 / 自定义 `available_at`** —— 一律立即可用
- **改动空转记账** —— 走零改动默认行为

## Risks

1. **服务端生成 dedupe key = 无幂等。** skill 侧重试或轮询逻辑写错会重复吵她。缓解只有 SKILL.md 写清楚 + `auto_check_email.py` 的状态去重做示范。
2. **无鉴权的前提是端口只在容器网。** 后续任何人把这个路由挂到 admin 或改 compose ports 绑定，就等于开了一个匿名公网口。路由注释里写死这条约束。

## Done Means（CLAUDE.md）

改了 `docker-compose.yml` 托管的服务，完成判定必须包括：

```bash
npm --prefix modules/agent-service test          # 含三份冻结缓存用例
docker compose build agent-service
echo "$PW" | sudo -S env HOME=/home/liahua docker compose up -d agent-service
docker compose ps                                 # 确认 Up (healthy)
docker logs -f qqbot-agent-service                # 观察启动无错
```

executor 侧只加环境变量，需 `docker compose up -d xiaoni-executor` 重建 —— 注意它是主栈运行容器，不要顺手重启其它服务。

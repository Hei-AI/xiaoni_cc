# Notify Bucket — Latest-Wins Collapse 设计

状态：设计 2026-06-29；**§3 / §5 A / B / B' 与「开窗纪律」已于 2026-09-13 合入 main 并部署**（main 9baf021b…d69275a7，provider-service + agent-service 重建；见文末「2026-09-11 实施记录」与「2026-09-13 修正」）。
配套已落地的相邻改动：phantom-run fold（见文末「已完成」），那一笔已绿。

## 1. 背景 / 触发这份设计的事故

事故现象：用户看到同一 `xiaoni:global` 会话「同时进了两个 run / 又触发一次」，时间段约 16:11–16:25，期间所有 run 失败于
`Client network socket disconnected before secure TLS connection was established`（上游 LLM transport 短暂中断，16:39 自愈）。

诊断出两层问题：

1. **幻影 run（已修）**：`appendAvailableQueueNotifyToLoop`（运行中把新到的 notify 折叠进当前 run）误用了会 mint
   `agent_runs`/`agent_message_batches` 的 claim，于是一次执行被记成两行 run。见文末「已完成」。
2. **doorbell 不塌缩（本设计要解决的）**：自驱动 fork 的 `system_reminder` 用了**每次运行唯一**的 dedupe key，所以多次 fork
   输出在 Notify Bucket 里**各占一行、永不合并**。事故里就有 `runtime_...781` 和 `runtime_...947` 两条 fork 消息同时挂着、都没被主 agent 成功消费。

## 2. 核心原则（用户定义）

**Notify Bucket 是 per-session 的「门铃」，不是消息日志。未被成功消费的提示，按逻辑 key 塌缩成「最新一条」，而不是按重试/累积重放。**

- 「没被成功消费的数据要参与聚合」→ 最新那条作为塌缩后的单条进入下一次聚合，不丢。
- 「LLM 挂 10min 恢复后不能把一个群提示提示 5 次」→ 因为是 latest-wins 塌缩，每类只进来**一条**，永不 5 次。
- 「自驱动 fork 跑了两次都没被消费，前一次有啥意义？」→ 旧的无意义，**新的覆盖旧的**（latest-wins）。

### 2.1 不可变量（铁律，凌驾一切塌缩逻辑）

**历史进了上下文的都不变。** 已进入模型 context 的内容（request input items、`agent_stack_items`、已成为某次已发请求一部分的
conversation history）一律不可变，**绝不回写/覆盖**。原因：① prompt cache 前缀字节级不变；② 追加式 agent stack 的回放真相。

推论（决定塌缩怎么落地）：

- **塌缩/覆盖只作用于 `pending`、从未进上下文的项。**
- 一条 doorbell 一旦离开 `pending`（被 claim/折叠/消费 → 进了 run/context）→ **冻结**。更新的信息只能作为**新的 forward
  pending 条目**入队，绝不重写过去那条。
- 因此稳定 dedupe_key 的「latest pending 槽」语义**只覆盖未消费行**；消费时必须把该行的 dedupe_key **轮换成历史唯一值**
  （dedupe_key 是队列簿记字段、从不进模型，轮换它不违反上下文不可变），把稳定槽让出来给新 pending 行。

真相源分层（关键）：
- **QQ 未读的真相在 `agent_inbound_messages` 的 inbox/window**（小腻 `qq-usage` 读的就是它）。所以 QQ 的 doorbell 即便塌缩/丢弃，消息本身不丢——下次醒来重读 inbox。
- **`system_reminder`（fork/self-continuation 等自生提醒）没有 inbox 兜底**，所以靠 dedupe_key「带到下次但去重」，且 latest-wins。

## 3. 每种来源的塌缩规则

| 来源 | 塌缩 key | 规则 | 现状 |
|---|---|---|---|
| QQ 群 `phone_notification` | per-session（群） | 几分钟窗口聚合 | **已有**（debounce window） |
| QQ 私聊 `phone_notification` | `lw:phone_notification:direct:<session>:<peer>` | **每个人取最新**，未读增量累加 | **已实施 2026-09-11**（provider-service `buildPhoneNotificationMessage`） |
| @ 提及 `phone_notification` | `lw:phone_notification:group_mention:<session>:<group>:<sender>` | **每个人取最新**，未读增量累加 | **已实施 2026-09-11**（同上） |
| `system_reminder` 自驱动 plan | `lw:subconscious-agent:<session>` | **每 session 取最新**，新覆盖旧 | **已实施 2026-09-11**（agent-service `enqueueSubconsciousAgentNotify`） |
| `system_reminder` 引擎「去睡」推送 | `lw:rest-available:<session>` | 每 session 只挂一条 | 分支 d6b500ac，**暂缓**（审查指出每次 settle 都重挂、无节流） |
| 其它 `system_reminder`（报时 / 召回 / external…） | 各自既有键 | first-wins（召回靠撞键做投递账本，**不得**覆盖） | 不变 |

「未读数」永远来自 inbox（agent_inbound_messages），不来自门铃重试/累积计数。

## 4. 具体代码缺口（已核实）

### 4.1 fork 的 dedupe key 唯一 → 永不塌缩（agent-service）

`modules/agent-service/src/services/agent-loop-service.ts`
```
:9033  const forkRunId = `subconscious-fork:${params.queueMessage.runId}:${uuidv4().slice(0,8)}`;  // 唯一
:9385  const messageSid = `subconscious-agent:${params.forkRunId}`;                                 // 唯一
:9442  dedupeKey: messageSid,                                                                       // ← 唯一 key，导致永不合并
```

### 4.2 enqueue 是 first-wins，不是 latest-wins（persistence）

`packages/persistence/agent-queue.js` `enqueueAgentQueueMessage`
```
:210-226  catch (P2002 唯一冲突) → findUnique 返回【已存在的旧行】，不更新
```
即使 4.1 改成稳定 key，这里也只会「保留旧的」，不会用新内容覆盖。要 latest-wins 必须在冲突时 UPDATE。

### 4.3 claim 聚合（参考，已可用）

`claimNextAgentQueueMessage` 把所有 pending 批进一个 run（`buildBatchSummary`），`mapClaimedRun` 对 phoneNotification 的
`unreadDelta` 求和。塌缩做对之后，这里天然把「每类一条」聚合进一次 run。

## 5. 改动清单（待实施）

### A. agent-service — fork system_reminder 稳定 key
- `dedupeKey` 从 `subconscious-agent:${forkRunId}` 改成**稳定 per-template**，建议
  `subconscious-agent:${sessionKey}`（或 `:${reason}` 维度，若以后有多模板）。
- `messageSid` 保持唯一（tracing 用），只动 `dedupeKey`。
- 影响：fork-run-2 与 fork-run-1 同 key → 走 enqueue 的 latest-wins 覆盖。

### B. persistence — enqueue 改 latest-wins（受不可变量约束）
- `enqueueAgentQueueMessage` 冲突分支：**仅当既有行是 `pending`（从未进上下文）** 时 UPDATE 覆盖
  `body_for_agent / payload / raw_payload / available_at`（attempts 归零=新内容新预算）。
- 既有行**非 pending（已 claim/消费/终态 → 已冻结）时绝不 UPDATE**。此时不应再发生冲突，因为——见下 §B'——消费时已把它的
  dedupe_key 轮换走、稳定槽已让出，新内容直接 INSERT 一行新 pending。
- 仅此一处改 ORM；收口在 `packages/persistence`。

### B'. persistence — 消费时轮换 dedupe_key（释放稳定槽，保证不可变量）
- `claimNextAgentQueueMessage`（以及 `foldPendingNotifyMessagesIntoRun`）在把行置为 `consumed` 时，把 `dedupe_key`
  改成历史唯一值（如 `${dedupe_key}:run:${runId}`）。
- 效果：稳定槽空出 → 后续同模板的新提示能 INSERT 新 pending 行（forward 条目），而不是去 UPDATE 一条已进上下文的冻结行。
- dedupe_key 是簿记字段、从不进模型，轮换它不违反上下文不可变。

### C. provider-service — @ per-person-latest（另一轮）
- 入站写 Notify Bucket 时，@ 提及类 `phone_notification` 按 (session, 被提及/发送人) 取最新，聚合成单条 doorbell。
- 具体落点在 provider-service 的 Notify Bucket ingress（phone_notification 生成处）。本轮不做。

## 6. 明确不要做（已被否决的方向）

- **不要** carry-forward-with-attempts：失败后按每条自己的 attempts 重新入队。会累积+重放 → 正是「提示 5 次」。
  正确做法是 latest-wins 塌缩 + inbox 兜底。
- **不要** 把 notify-append 折叠路径改回「每折叠一条就 mint 一个 run」（phantom run 的来源）。

## 7. 对已完成 fold 修复的影响

phantom-run fold 修复**保持不变**。原本想给它加的「失败路径 carry-forward」**取消**——latest-wins 塌缩接管了「不丢」，
所以折叠消息在父 run 失败时维持现状（随父 run settle / fail / 主消息 transient 重试）即可；自生 fork 提醒是 disposable，靠新一条覆盖。

## 8. 开放问题 / 待定边界（在不可变量下重判）

**Q2 — latest-wins 覆盖 in-flight：已被不可变量解决。**
绝不覆盖非 pending（已进上下文/冻结）的行。supersede 只作用 pending 行，消费时轮换 key（§B'）。「无限重试」担忧消失：
持续抖动期间，未被 claim 的 fork pending 行被新输出**就地 supersede**（仍是一行，attempts 不增），不累积、不重放。✅ 关闭。

**Q3 — @ 聚合成一条：不与不可变量冲突，纯 pending 期整形。**
@ 的 per-person-latest 聚合发生在 provider-service 入站、doorbell 进上下文之前，属可变区，安全。剩下的只是 provider-service
那轮的表达细节：一条 doorbell 的 body 模板如何承载「多人各自最新 @」+ unread 语义。归到 §C 那轮。

**Q1 — QQ doorbell 失败后的再唤醒：形已定，剩一个产品判断。**
形（受不可变量约束）：失败的 doorbell 是冻结历史，**绝不复活**；要再唤醒只能**入队一条新的 forward doorbell** 反映当前未读。
现状：`provider-service inbound-agent-trigger-service.ts:325` 对每条合格入站消息都 enqueue 一条新 `phone_notification` 门铃，
所以「下一条真实消息」会自然重挂门铃重唤醒。另有 `agent_qq_attention_leases`（注意力租约）机制。
**待定的产品判断**：当「未读非空、但 outage 期间唯一那次唤醒失败了、且之后没有新消息进来」时，要不要一个兜底重挂
（attention-lease 续约 / 周期 sweep / 未读非空则补一条 forward 门铃）？若认为「下一条消息总会来、或小腻醒着时自查 inbox 即可」，
则无需兜底。需要你拍这个边界。

## 已完成（相邻，已绿，未部署）

phantom-run fold 修复（本设计的前置）：
- 新增 `foldPendingNotifyMessagesIntoRun`（`packages/persistence/agent-queue.js`）：把 pending notify 折叠进**父 run**，
  keying `run_id=parentRunId`，**不** INSERT `agent_runs`/`agent_message_batches`。settle/fail/retry（皆 `WHERE run_id=?`）
  自动覆盖；折叠消息保留自己的 trace_id 作存档。
- `runtime-store.ts` 加 `foldPendingNotifyIntoRun` wrapper；`index.d.ts` 加声明。
- `agent-loop-service.ts` `appendAvailableQueueNotifyToLoop` 改用上面的折叠；删掉 4 个冗余 continuation settle/release/fail 循环。
- cache-neutral（纯 DB 记账，请求装配不变）。typecheck✓ persistence 6/6✓ agent-runtime-loop 10/10✓
  agent-loop-service 仅 3 个 pre-existing `requestImageTask` 失败（基线同样失败，与本改无关）。


---

## 2026-09-11 实施记录

落点全部在入队侧 / claim 侧 / 引擎控制流，不碰 system prompt、tools 定义、`stableRuntimePrompt`；
新增进 live 请求的字节只有「被拒 reminder 正文」与「去睡 reminder 正文」，都在执行 / 入队时渲染一次冻结落栈，replay 逐字节读回。

### A. latest-wins 槽（`packages/persistence/agent-queue.js`）
- `lw:` 前缀 = latest-wins 槽。`enqueueAgentQueueMessage` 撞键时，**仅当既有行 `pending`** 才 `updateMany({id, status:'pending'})` 覆盖
  `body_for_agent / raw_payload / inbound_context / payload / trace_id / message_sid / available_at(取更早)`，`attempts` 归零，
  `phoneNotification.unreadDelta / directMentions` 与 `raw_payload.unread_delta / direct_mentions` **累加**；返回 `{created:false, superseded:true}`。
- 非 `lw:` 键保持 first-wins（`recall-surface:` 等靠撞键做投递账本）。
- **B' 轮换**：`claimNextAgentQueueMessage` / `foldPendingNotifyMessagesIntoRun` 消费时 `dedupe_key = dedupe_key || ':run:' || run_id`（只对 `lw:%`），稳定槽让出。

### B. 开窗纪律（同文件 `isWindowOpeningQueueRow` + `claimNextAgentQueueMessage({windowOpen})`）
用户设计：能闯入她的只有 QQ 私聊与群 @；其它 Notify 不闯入、不打扰，在她醒着时一次性消费。睡眠侧原本就成立
（睡着不 claim；wake 只计 `phone_notification`）；醒着-空闲侧此前任何 pending 都能起 run（7 天 638 个 run 里 42% 由召回 / 群普通消息 / external 打开）。
- 开窗行：`phone_notification` 且（私聊 或 `direct_mentions>0`）；`system_reminder` 且 key 前缀 ∈ {`subconscious-agent:`、`rest-available:`、`clock-ping:`、`attention_lease:`、`deep-dive-round:`、`sherlock:`、`sherlock-due:`}；其它 source 沿用旧语义。
- pending 里没有开窗行 → claim 返回 null、一行不动；有 → 全部 pending 一次折进这个 run（原批量折叠语义不变）。
- 主循环睡醒续帧时传 `windowOpen:true`（`processRuntimeIteration`），醒来那一窗把积压的全部消费掉。

### C. 试睡不再是免费出口（`modules/agent-service/src/services/agent-loop-service.ts`）—— **暂缓，未合 main**（分支 d6b500ac；见调查报告 §8.2）
- `rest_rejected_frame_yield` 收帧现在 = 一次 settle：`lastMainAgentForkSeed.settledOnFinalAnswer=true`（C 路 fork 点火）、`recordIdlePlanSettle` 记一次空转。
- 被拒 reminder（`docs/xiaoni_prompt/recover_energy_rejected_reminder.md`）删掉会被证伪的 retry 分钟数，改成「身体到门槛的时候，系统会提示你去睡」+ 三件具体的事（上一份 plan 前两行 + 外部动作兜底，`buildRestRejectedNextSteps`）。
- 引擎推送：run 收工时若 `shouldAcceptVoluntaryRecovery` 已接受且未睡着，入队 `lw:rest-available:<session>`（模板 `recover_energy_available_reminder.md`），它是开窗行。

### 未做（另开 PR）
- `REST_REJECTED_FRAME_YIELD_AFTER` 3→2 与 `system_prompt.md` 「第 3 次直接结束」价目表、工具描述改写：进 cacheable 前缀，须挑压缩边界帧一次冷读。
- 被动召回触发点从每次栈追加挪到 run settle；`recover_energy` 参数不当 query。
- 白天 nap cap 90→180 / `web_search` 成本。

### 2026-09-13 修正（对抗审查后）
- lw 槽轮换后缀改为 `:run:<runId>:<row id>`：同一槽在同一 run 内 claim + fold 两次不再撞唯一索引（原来会让 fold 事务回滚、主 run 判 failed）。
- enqueue 的 supersede 分支：updateMany 命中 0 行或 findUnique 为 null（槽刚被消费并轮换）时再 INSERT 一次，最多两轮；不再退回「返回既有行」静默丢门铃。
- 已知未处理：两条同槽消息并发 supersede 是读-改-写，unreadDelta 可能少计一次；未读真相在 `agent_inbound_messages`，只影响门铃显示。

# Spec: 队列丢消息治理 —— transient 重试 + 死信可见 + 切断连坐

状态: 待实现 · 零缓存风险 · 现场取证 2026-07-16(真库 `qqbot_db` + 容器日志)

范围锁定:
- 目标 = **用户的消息不因一次网络抖动而永久消失**。
- 不改 agent loop、不改 prompt、不碰缓存。纯队列层。

---

## Context(为什么)

2026-07-16 10:48–10:53,上游 TLS 抖动 ~9 秒,**3 条用户消息永久消失**。小腻不知道,
用户没收到任何提示 —— 就像消息从没发过。

这不是假设,是当天现场:

```
28127 | failed | attempts=3 | 2026-07-16 10:50:04+08
28126 | failed | attempts=3 | 2026-07-16 10:49:00+08
28125 | failed | attempts=3 | 2026-07-16 10:48:38+08
```

错误全部是 `Client network socket disconnected before secure TLS connection was established`
—— **基建抖动,不是代码 bug,也不是小腻处理不了**。

## Current State(核实 2026-07-16)

| 环节 | 位置 | 现状 |
|---|---|---|
| transient 识别 | `agent-loop-service.ts:8258` `transientQueueRetryEligible` | ✅ **认得出** `isTransientProviderExecutionError` |
| 但仍受 attempts 约束 | 同处 `&& queueMessage.attempts < (queueMessage.maxAttempts ?? 3)` | 🔴 **网络抖动照样消耗重试次数** |
| 重试 SQL | `packages/persistence/agent-queue.js:562` `AND attempts < max_attempts` | 第 3 次失败匹配 0 行 → `retried = 0` |
| 退避 | 1.5s / 3s | 🔴 3 次重试**全在 90 秒内打完**;对一次 ~9 秒起步、可能持续更久的网络抖动,窗口太窄 |
| 放弃 | `:8319` `if (options.queueBacked && !queueRetryScheduled)` → `failQueueMessage` → `agent-queue.js:521` `SET status='failed'` | 🔴 **`failed` 之后没有任何代码再读它** |
| 死信 | — | 🔴 **不存在**。无死信队列、无 stale-lease 兜底(`recoverStaleProcessingLeases` 只管 `processing`)、管理端无重投按钮 |
| claim 批量 | `agent-queue.js:238-251` `SELECT * FROM agent_queue_messages WHERE status='pending' AND available_at <= NOW() ORDER BY available_at ASC, id ASC FOR UPDATE SKIP LOCKED` | 🔴 **无 LIMIT** —— 一次吃掉全部 pending,共用一个 `run_id` |
| 连坐 | `failAgentQueueMessage` 按 `run_id` 更新 | 🔴 **一次抖动把整批打死** |

**当前 `failed` 存量:1,379 条。** 这些全是历史上被静默丢弃的消息。

## Root Cause

三个缺陷叠加,单独看都不致命,组合起来 = 静默丢消息:

1. **不区分「她处理不了」与「网络没连上」。** `attempts` 是给前者设计的(重试 3 次仍失败 = 真的处理不了,
   该放弃);但 transient 网络错误**根本没轮到她处理**,不该消耗她的重试预算。
   代码已经能识别 transient(`:8258`),却仍让它扣 attempts —— **识别了但没用上**。
2. **退避窗口 (90s) < 故障时长。** 基建抖动动辄分钟级。
3. **失败即终点。** 没有死信、没有可见性、没有重投。日志里 `retryScheduled:false` 就是墓志铭。

**放大器**:claim 无 LIMIT + fail 按 `run_id` 连坐 → 抖动期间**批越大死得越多**。

## Proposed Change

### Q1 · transient 错误不计入 attempts(治本)
- `agent-loop-service.ts:8258` 附近:`isTransientProviderExecutionError(error)` 为真时,
  走**独立的 transient 重试预算**(建议 `transient_attempts`,新列,上限更高如 10),
  **不动 `attempts`**。
- 语义变清晰:`attempts` = 「她试着处理但失败了」;`transient_attempts` = 「压根没连上」。
- 无限重试的护栏:`transient_attempts` 有独立上限 + 总时长上限(如 30 分钟),两者任一到顶才进死信。

### Q2 · 退避拉到分钟级
- transient 路径退避:1.5s → 5s → 15s → 60s → 300s(指数 + 上限 5 分钟)。
- 覆盖分钟级基建故障,而不是 90 秒内把预算烧光。

### Q3 · 切断 run_id 连坐
- 二选一(实现期定,建议 a):
  - a) `claimNextAgentQueueMessage` 加 `LIMIT`(建议可配,默认 20),控制单批爆炸半径。
  - b) `failAgentQueueMessage` 改为只作用于真正失败的那一条,而非整个 `run_id`。
- **注意**:批量 claim 是 Notify Bucket 折叠语义的一部分,动它前先确认不破坏
  `NOTIFY_BUCKET_LATEST_WINS_COLLAPSE.md` 描述的塌缩行为,以及
  `agent-stack-event-id-dedup` 那套 ON CONFLICT 机制(铁律用例,不可弱化)。

### Q4 · 死信可见 + 一键重投
- admin-backend:`GET /api/agent-queue/failed`(列 failed 队列,含 error_message / attempts / 时间)。
- admin-frontend:失败队列页 + 「重投」按钮(把 `failed` 改回 `pending`,`attempts=0`,刷新 `available_at`)。
- 重投须幂等:走现有 `dedupe_key`,避免重复唤醒。

### Q5 · 存量 1,379 条 failed 的处置
- **不自动重投**(可能很旧,重投会让小腻收到几周前的消息 = 更糟)。
- 只做**可见**:管理端能看到、能按时间筛、能人工挑。
- 建议加一个 `available_at` 时效窗(如超过 24 小时的 failed 不提供重投按钮,只读)。

## 双缓存影响分析(铁律)

**零缓存风险,理由是结构性的**:
- 全部改动在 `packages/persistence/agent-queue.js`、`agent-loop-service.ts` 的**错误处理分支**、
  admin-backend/frontend。
- 不进 canonical request、不进 cacheable 前缀、不进 stack replay。
- 重投产生的是一条**正常的 pending 队列消息**,走的是既有的、已验证的唤醒路径,与手工发消息无异。
- ⚠️ **唯一需要留意**:Q3 若改批量 claim 的 LIMIT,会改变一个 run 内折叠的 notify 数量
  → 影响 stack item 的写入形态 → **必须跑绿 `agent-stack-event-id-dedup{,.realdb}.test.js`**
  (铁律用例)。历史上折叠 notify 的 `event_id` 碰撞导致过 replay 变短 → run 边界击穿
  (见 `docs/investigations/`)。**Q3 不是「纯队列层」,是本 spec 唯一碰得到缓存的地方。**

## Acceptance Criteria

1. 注入一次 transient 失败(mock `isTransientProviderExecutionError` 为真):`attempts` **不增加**,
   `transient_attempts` +1,消息仍 `pending`。
2. 注入一次非 transient 失败:`attempts` +1(行为与今天一致,无回归)。
3. transient 重试退避序列 = 5s/15s/60s/300s(可断言);总时长上限到顶后进 `failed`。
4. 复现 07-16 现场:连续 3 条消息 + 持续 2 分钟的 TLS 失败注入 → **3 条全部存活并最终处理**
   (今天的行为是 3 条全丢)。
5. Q3 后:一条消息失败**不影响**同批其他消息。
6. 管理端能列出 `failed` 队列并成功重投一条;重投幂等(重复点击不产生两次唤醒)。
7. **`agent-stack-event-id-dedup{,.realdb}.test.js` 全绿**(Q3 的硬门槛,真 PG 用例需 `qqbot_cache_test` 可达)。
8. 三套缓存铁律用例未被弱化(只允许新增)。

## Testing Plan

| 层 | 测什么 | 数 |
|---|---|---|
| Unit | transient vs 非 transient 的 attempts 归属;退避序列;上限到顶进死信 | +6 |
| Unit | `failAgentQueueMessage` 不再连坐同 `run_id` 其他消息 | +2 |
| Integration | 复现现场:2 分钟 TLS 失败注入 → 3 条消息全存活 | +1 |
| Integration | 重投幂等(同 `dedupe_key` 重复重投 → 一次唤醒) | +1 |
| 铁律(不可弱化,只增) | `agent-stack-event-id-dedup{,.realdb}` 全绿 | 验证既有绿 |
| 真库 | 存量 1,379 条 failed 能被管理端正确列出与筛选 | 手验 |

## Rollback

- Q1/Q2:transient 预算上限设为 0 → 行为回到今天(transient 立即计入 attempts)。
- Q3:LIMIT 设为极大值 → 回到无 LIMIT 的批量 claim。
- Q4/Q5:纯只读 + 人工触发,不重投即无影响。
- 无缓存回暖成本。

## Files Reference

| 文件 | 改动 |
|---|---|
| `packages/persistence/agent-queue.js:238-251` | claim 加 `LIMIT`(Q3a) |
| `packages/persistence/agent-queue.js:521` `failAgentQueueMessage` | 切断 `run_id` 连坐(Q3b) |
| `packages/persistence/agent-queue.js:562` `retryAgentQueueMessage` | transient 走独立预算 |
| `packages/persistence`(schema) | `agent_queue_messages.transient_attempts` 列 |
| `modules/agent-service/src/services/agent-loop-service.ts:8258` | transient 不扣 `attempts` |
| `modules/agent-service/src/services/agent-loop-service.ts:8319` | 放弃前先判 transient 预算 |
| `modules/admin-panel/backend` | `GET /api/agent-queue/failed` + 重投端点 |
| `modules/admin-panel/frontend` | 失败队列页 + 重投按钮 |

## Out of Scope

- **停机可观测性**(`enabled=false` 时循环静默 `continue`,3.5 小时停机在日志里长得像空闲)。
  这是 07-16 现场的**另一个**问题,与丢消息无关,用户本轮未选,单独立项。
- 群 `is_enabled=0` 不写 doorbell —— **设计如此,不是 bug**(`chat-policy-service.ts:146`,
  `provider-service/src/index.ts:1230`)。07-16 排查时这条是干扰项。
- 上游 TLS 抖动本身(基建,不在本仓库)。

## Related

- 现场时间线:10:53:12 认领 3 条 → TLS 连环失败 → 10:53:14 有人在管理端点了停机 →
  10:53:37 那批彻底 failed → 10:53:57 新 doorbell 28128 落地但开关已关,无人认领 3.5 小时。
  **三件事互相伪装,实为一个真 bug(本 spec)+ 一个可观测性缺口(Out of Scope)+ 一个正常设计(干扰项)。**
- `docs/NOTIFY_BUCKET_LATEST_WINS_COLLAPSE.md`(Q3 动批量 claim 前必读)
- `docs/investigations/`(折叠 notify event_id 碰撞导致 replay 变短的事故)

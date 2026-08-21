# 被动召回的投递走 Notify Bucket，不做 turn 尾注入

`XIAONI_PASSIVE_RECALL_SURFACING.md` 最初把 v2 投递口写成「turn-input 尾注入 + `cache_volatile`
纪律，同 `buildSubconsciousAgentForkRequest` 的尾注入模式」。实际落地改走 Notify Bucket
（`source='system_reminder'` 入 `agent_queue_messages`）。这条记下来，因为文档里那句还在，
下一个人照着实现会走回头路。

**理由是缓存，不是省事。** Notify Bucket 这条路径的缓存安全**已经在线验过**：正文在 enqueue
那一刻冻结进 `payload.systemReminder.reminder`，下一个 run 的 stack replay 从同一字段逐字节
读回。投递侧逐字段克隆 `enqueueCoreMemoryCompressionDoneNotify` / `enqueueExternalNotify`，
所以缓存安全是**继承**来的，不是在召回这条腿上重新推导一遍。尾注入则要在一条全新路径上
自己保证「live 请求与 stack replay 逐字节一致」，而这正是这个项目出过事故的地方
（见 `docs/investigations/`：折叠 notify 落库 event_id 碰撞导致 replay 变短）。

代价说清楚：**notify 会唤醒主 loop**。尾注入不会。所以这条选择把「别吵」的责任从架构挪到了
闸门上——判官（可以一条都不挑）、同一段记忆的幂等、活动窗，都是为了偿还这个代价，
不是可选的调优。

**「别吵」由判官负责，没有配额。** 联想不是配额制的：人不会「今天已经想起过 10 件事，
后面就不想了」。所以这条腿上**不存在日额**——该不该冒由判官一条一条判（见 ADR-0006），
它不在场时退回最小间隔，兜的是「判断力缺席」而不是「今天够了」。

这条走过两次弯路，都记在这里：先是日额在前、把 6 条按槽位摊到 14 小时、判官只在配额内挑
——结果连续五天每天不多不少正好 6 条，判官那句「一条都不值得」从来没起过作用；
接着把日额降级成「兜底」保留，那仍然是配额，只是阈值调高了。两次的错误是同一个：
把「量」当成可以事先切好的东西。量是判断的结果，不是判断的输入。

代价也说清楚：判官若持续误判，没有任何硬闸会停下它。这是自觉的取舍——
观测面（浮现流水里每一条判决、看过没挑的、以及它挂没挂）是这条腿的安全带，
硬上限不是。

配套的两条硬约束：

- **`trace_id` 必须显式给足**。空 `trace_id` 会让 stack 的 runtime-input `event_id` 塌到 runId
  兜底，同一个 run 里两条撞 `ON CONFLICT(event_id)` 被吞 → 下个 run replay 变短 → run 边界
  缓存击穿（`docs/CACHE_CONTRACT.md` §3）。
- **正文一旦入队就不再重算**。任何「渲染时拼时间戳」的写法都会让 replay 对不上。

实测：投递上线当天（2026-08-07）与其后，投递落栈那一帧 `cache_read` 单调连续，无冷读。

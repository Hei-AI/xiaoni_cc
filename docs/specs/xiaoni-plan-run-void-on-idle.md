# Spec: plan 空转 run 作废 —— 无有效产出的 plan run 当没发生过

状态: **已上线并翻 ON**（2026-07-27，worktree feat/plan-void-on-idle 三 commit 合入 main）· 作者对话拍板 2026-07-27
活体验证: 点火后 4 分钟首次 `plan_idle_run_voided`（删 2 行、栈 0 残留、零误跳），作废后 cache heartbeat 暖读 400528——前缀落回作废前既有断点，与「双缓存影响分析」预测一致。

与 `xiaoni-fork-idle-escalation.md`（已上线并同时翻 ON）互补成完整闭环:
- 升级腿(已有): fork 知道「上一份 plan 连续 N 轮失效」→ 加重语气。
- 本 spec(作废腿): 失效的那次 run **整体从栈上消失**——上下文里永远不会堆出连续的失败 plan。

## 语义（用户原话钉死）

> 如果 xiaoni_plan 在这次 LLM 请求没有有效产出, 那就当这次请求没发生过。
> 如果存在有效产出, 那就冻结。

作废单位是**整个 run**, 不是 plan 那一条: plan 触发项、续航提醒、她的纯文本收工语, 全部不留。
计数照旧 +1(升级腿), fork 带轮数与上一份原文加压再来; **绝不 reseed**(one-shot 时代 16min 灌 10 run 的案底)。

## 铁律修订（用户拍板的例外）

「已进上下文的内容消费后冻结」对 **subconscious plan 触发的零产出 run** 开一个例外:
该 run 的栈行在 settle 判定为零产出的那一刻被整体删除。例外仅此一类, 其余一切照旧冻结。

## 作废判定（全部满足才作废, 任一不满足 = 照旧冻结, fail-open）

1. 触发 payload 是 `isSubconsciousAgentNotifyPayload`(reason=subconscious_agent + notify_template=subconscious_agent_notify.md)。
2. settle 落在 final_answer(纯文本收工)。
3. 整个 run **零工具调用**——含 recover_energy(睡一觉从记忆里蒸发会时间错乱, 睡过就冻结)。
4. run 内折叠消费的 notify **全部也是 subconscious plan**(折叠过 QQ 消息/任务回报等真实信息 → 冻结, 否则信息丢失)。
5. 零可见投递(deliveredMessages 空; 3 已蕴含, 双保险)。
6. 本 run 没有压缩提交(coreMemoryCompressionArtifact 为空)、没有 evictedTurns。
7. 开关 `plan_void_on_idle_enabled` = ON(agent_runtime_control 热下发, 默认 OFF, kill-switch)。

## 删除机制（persistence 收口, agent_stack_items 上第一个删除, 防护如下）

新函数 `voidAgentStackRunSegment({ identityKey, runIds, traceId })`:
- `runIds` = [触发 run 的 queueMessage.id, ...折叠 plan 的 claimed.id](折叠行落栈用的是被折叠消息自己的 run_id)。
- **单条 guarded DELETE**(原子快照, 无 check-then-delete 窗口):
  仅当「这些 run 的最小 stack_index 之上不存在任何其它 run 的行」时才删; 有外来行夹层 → 0 行删除, 返回 aborted, 引擎侧照旧冻结。
- 只删 `run_id = ANY(runIds)` 的行; 队列行保持 completed(不 reseed); llm_request_slices / tool_executions / life events 全保留(观测层, 不进 replay)。

## 双缓存影响分析（铁律）

- **下一次主 run**: replay = 作废前的栈 + 新触发项。作废 run 的行从未进过任何 replay(它们只活在被作废 run 自己的 live 请求里), replay 前缀单调性对「已 replay 过的前缀」依然成立。
- **暖读锚点**: 被作废 run 的 turn-1 请求里, prevBoundary 断点恰在作废前栈顶(上一 run 的 true-end)——下一 run 的前缀与该缓存段逐字节一致, 暖读到作废前栈顶, 冷读只有新 plan 尾段(与普通 run 边界同量级)。
- **live≠replay 的例外声明**: 「凡进 live 请求必须能被 replay 重建」在被作废 run 上被有意打破——该 run 的 live 请求内容(plan+收工语)整体蒸发。这不构成击穿: 击穿的定义是 replay 与**缓存前缀**失配, 而作废使下一请求回退到**更早的、仍然有效的**缓存前缀。
- **fork 缓存**: C1 seed 克隆的是被作废 run 的已发送请求, fork 骑它自己刚写的暖缓存, 不受删除影响(fork no_persist)。
- OFF 时零字节变化; 冻结用例只增不改。

## 验收

1. OFF: 行为与今天逐字节一致, 三套冻结用例全绿无需改断言。
2. ON + 满足判定: 栈中该 run 的行数归零; 下一 run 的 replay 与作废前的 replay 逐字节一致(仅多新触发项)。
3. ON + 任一不满足(调过工具/折叠过真实 notify/外来行夹层): 一行不删, 照旧冻结。
4. 真库: 两 run 交错时 guard 拒删; 纯尾段时删净。
5. 活体: ON 后观察连续 plan 条数(应 ≤1 存活)与相邻 slice cache_read(主 turn 暖读回退到作废前栈顶, 不整窗击穿)。

## Rollback

`plan_void_on_idle_enabled=false` 热回退(秒级); 已删行不可恢复(by design, 它们本就该当没发生过)。

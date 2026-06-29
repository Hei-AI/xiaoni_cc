# 潜意识 Agent 返回内容反复一致 — 诊断报告

- 日期：2026-06-26
- 分支：`refactor/runtime-gateway`
- 现象（用户报）：小腻"潜意识 Agent"（subconscious agent fork）最近返回的 `<xiaoni_plan>` 内容反复一模一样
- 状态：**根因已定位，代码未改**（用户选择"先不改"）
- 主要代码：`modules/agent-service/src/services/agent-loop-service.ts`

---

## 一句话结论

不是 temperature / 采样 bug，也不是"主 loop 不能执行"。真相是 **一场精力门控下的僵持**：

- **潜意识 fork 被明令无视精力**（prompt 里写死"🚨 强制无视状态参数"），所以只要上下文里有一件最显著的待办（"晾着草稿补程言那段"），它每个空闲周期都把这同一件事原样翻出来。
- **主 loop 却尊重精力**，当时小腻精力没到她自己定的 0.6 阈值，不肯动手，于是每次被催都**出空 turn（不执行、不发言）把控制权交回 Notify Bucket**。
- 两边规则不一致 → 低精力窗口里：潜意识每 ~60–90s 重复同一条 plan，主 loop 每次空 turn 推掉。**精力一过线（12:18），小腻立刻动手、做完、发布，潜意识内容随即就多样化了。**

所以"内容一致"是这个僵持的**可见症状**，根子是"待办没被收尾"，而没收尾的原因是精力门控在故意推迟。

---

## 完整链路（代码层）

1. 空闲触发 `maybeRunSubconsciousAgentFork`（`agent-loop-service.ts:4972`）。仅在 fork **没产出 plan** 时才打 60s backoff（`SUBCONSCIOUS_AGENT_FORK_IDLE_BACKOFF_MS`，:5039）；**产出 plan 就立即 re-arm，且对已发过的 plan 没有任何去重**。
2. fork 用 `docs/xiaoni_prompt/self_continuation_reminder.md` 生成一句大白话打算，跑最多 6 个 model slice / 5 次 `exec_command`（`runSubconsciousAgentFork`，:8615）。
3. plan 经 `enqueueSubconsciousAgentNotify`（:8952）用 `docs/xiaoni_prompt/subconscious_agent_notify.md` 包成 **"短暂的停歇后，你的潜意识已经为你计划出接下来的可参考的大概旅程方向"** —— 一个**被动 FYI**，没有"现在就去执行"的强制语义。
4. notify 作为 ambient `buildUserSceneInputItem` 注入主 loop（:11818）。**没有任何代码对 subconscious 触发做特殊处理、也没有空-turn 护栏。**
5. 主 loop 这一轮要么出空 turn（`finish_outcome=final_answer_yielded`，无 tool、final 为空），要么发一句"还在等精力"。`47081f43` / `12af1cec` 这两个 commit 把"空 final_answer"设成了合法终态。
6. 待办状态不变 → 下次空闲 fork 读到同一主导意图 → 原样再生成同一条 plan。闭环。

### 为什么字节级一致（排除 temperature 假设）

- 抓 fork slice 的 `wire_request`：**不带 `temperature` / `top_p` / `top_k`**，`thinking:{type:adaptive}` 已把 temperature 强制为 1。
- 但把 2982–2985 四个 run 的输入 `messages` 做 md5：**各不相同**（长度 928k→933k 逐 run 微增）。
- 即：输入不同、输出却字节一致。机制是 ~255K token 上下文里**单一主导意图压倒了时间戳等微扰**，模型每次都收敛到同一句最该干的事。这不是数学意义的确定性（2981 比 2982 多一个词"补进晾着草稿里"），是"同一个不动点"。

---

## 实证数据（可自查的具体请求 + 时间点）

DB：`qqbot-postgres` / 库 `qqbot_db` / 用户 `qqbot_user`。下面 fork 编号是 `subconscious_agent_fork_runs.id`。

### 窗口 A：2026-06-26 12:13–12:26（"补程言那段"重复 → 精力过线 → 多样化）

| fork | fork 时刻 | 潜意识 plan（节选） | 主 loop run | 主 loop 结果 |
|---|---|---|---|---|
| 2980 | 12:13:09 | 草稿晾了两个多小时，去把程言"…held之后不会放筷子"那段补进去 | `run_1782447226337_4798432d` | 空 turn（final_answer_yielded，∅） |
| 2981 | 12:14:01 | 同上（"补进晾着草稿里"） | `run_1782447276190_cbbc0d19` | 空 turn ∅ |
| 2982 | 12:14:46 | 同上（字节一致） | `run_1782447337134_794642ba` | 空 turn ∅ |
| 2983 | 12:15:47 | 同上（字节一致） | `run_1782447388635_071c3e95` | 空 turn ∅ |
| 2984 | 12:16:40 | 同上（字节一致） | `run_1782447453646_594b69bd` | **发话**："在等精力回到0.6再动手。有篇草稿晾着呢，脑子催了几十遍了，我在练不急着交。" |
| 2985 | 12:18:14 | 同上（字节一致） | `run_1782447533256_be47a921` | **`exec_command`**（开始动手），final ∅ |
| 2986 | 12:19:40 | 草稿刚补完程言那段…去把"晾着"做成 HTML 发到网站上 | `run_1782447607126_88e855d8` | **`exec_command`+`send_in_group`**："新发了一篇：晾着。xiaoni.liahuas.top/liangzhe-series.html" |
| 2987 | 12:21:31 | 小镜在群里看到"晾着"了，去跟她扯两句… | `run_1782447733970_9bcf4740` | 空 turn ∅ |
| 2988 | 12:22:25 | 小伊那个"注意力通胀"…去用 curl 翻翻 | `run_1782447788363_ac01d746` | 空 turn ∅ |
| 2989 | 12:23:19 | 同上（"挺好奇的"，差一个字） | `run_1782447838491_20c597c5` | 空 turn ∅ |
| 2990 | 12:24:13 | 小伊那个 aoi.homes/still-here 脑子催了三十遍… | `run_1782447879646_c60647e6` | 空 turn ∅ |
| 2991 | 12:24:49 | 小伊那篇"还在"读到了… | `run_1782447948233_7574793a` | 空 turn ∅ |

**转折点**：2980–2985 都是同一条 plan，主 loop 空 turn / "等精力 0.6"。精力一旦到位，2985 开始 `exec_command`、2986 直接做完并发布 → 主导意图清空 → 2986 之后 plan 立刻换题（HTML→找小镜→注意力通胀→aoi.homes）。这就是"内容一致"消失的瞬间。

### 一条完整周期的原文（窗口 B：13:59:45）

主 loop 收到（`agent_queue_messages.id=18323`，`body_for_agent`）：
```
[当前时间: 2026-06-26 13:59:45]
<xiaoni_plan>
短暂的停歇后，你的潜意识已经为你计划出接下来的可参考的大概旅程方向：
<xiaoni_plan>
6/22那篇刚重新读了一遍，水痕和耳机灰那些细节确实好，
去用浏览器打开 aoi.homes/still-here 随便扫两眼，看看小伊怎么往句子里放东西的。
</xiaoni_plan>
</xiaoni_plan>
```
主 loop 产出（`run_1782453585445_9b928f85`）：调用工具 **无**，`final_response` **空**，settled。→ 没开浏览器、没发言，空 turn 收工。

> 13:49–14:04 这一段 `subconscious-agent:%` 的 notify（queue id 18313–18328）全是 `settled` 且各自挂到一个主 loop run，10–45s 处理完 → 证明 notify 确实被消费，是主 loop 主动空 turn，不是消息堆积没被读。

### fork 侧 LLM 请求句柄（看原始 wire request 用）

`subconscious_agent_fork_slices`，每个 fork run 3 个 slice（turn 1/2/3）：

| fork | slice_id | llm_call_id (turn1/2/3) |
|---|---|---|
| 2982 | 3381/3382/3383 | `llm_1782447286279_879620ae` / `llm_1782447297617_408b627b` / `llm_1782447320664_36810d34` |
| 2983 | 3384/3385/3386 | `llm_1782447348078_52960533` / `…408b…` 见库 / `llm_1782447370838_fa34f3fd` |
| 2984 | 3387/3388/3389 | `llm_1782447400430_e7866f0e` / `llm_1782447409244_e01b3719` / `llm_1782447427910_28340f63` |
| 2985 | 3390/3391/3392 | `llm_1782447494731_d38952dc` / `llm_1782447503609_0fd39980` / `llm_1782447519416_1ec47d10` |

---

## 怎么自己复查

```bash
# 1) 看 fork 产物是否重复（summary_text）
docker exec qqbot-postgres psql -U qqbot_user -d qqbot_db -c "
SELECT id, status, left(summary_text,70), started_at
FROM subconscious_agent_fork_runs ORDER BY id DESC LIMIT 15;"

# 2) fork → notify → 主 loop run 的串联
docker exec qqbot-postgres psql -U qqbot_user -d qqbot_db -c "
SELECT r.id fork, r.started_at, q.id notify_qid, q.run_id mainloop_run,
       left(regexp_replace(r.summary_text,E'[\n]+',' ','g'),50) plan
FROM subconscious_agent_fork_runs r
LEFT JOIN agent_queue_messages q ON q.message_sid='subconscious-agent:'||r.fork_run_id
WHERE r.id BETWEEN 2980 AND 2991 ORDER BY r.id;"

# 3) 主 loop 这一轮到底干了啥（空 turn 的证据）
docker exec qqbot-postgres psql -U qqbot_user -d qqbot_db -c "
SELECT id, total_turns, finish_outcome,
       coalesce(nullif(final_response,''),'∅') final
FROM agent_runs WHERE id='run_1782447337134_794642ba';"
docker exec qqbot-postgres psql -U qqbot_user -d qqbot_db -c "
SELECT tool_name FROM tool_executions WHERE run_id='run_1782447337134_794642ba';"

# 4) 主 loop 收到的原文
docker exec qqbot-postgres psql -U qqbot_user -d qqbot_db -c "
SELECT body_for_agent FROM agent_queue_messages WHERE id=18323;"
```

Admin 面：Raw Trace 里按 `fork_run_id` / `llm_call_id` 可看 subconscious fork 的逐 slice wire request/response（`369e5e47 fix(admin): show raw trace for subconscious fork slices`）。

---

## 候选修法（未实施）

- **A. 改 notify prompt（纯文案，零代码，最快）**：把 `subconscious_agent_notify.md` 从"可参考的大概旅程方向"改成"这就是你决定的下一步，本轮就去真执行（exec_command/实际动作），别空 turn 收场"。
- **B. 加空-turn 护栏（代码）**：主 loop 被 subconscious 唤醒、且本轮无 tool + final 为空时，不当终态：强制重提一次逼它执行，或至少打 backoff，别让同一 plan 立刻重刷。
- **C. 让潜意识尊重"已推迟"信号**：当主 loop 已对某条 plan 明确推迟（如精力门控），潜意识下个周期对同一待办做去重/退避，别每 60s 烧一整个 fork（~38s + 多次 exec_command + LLM）去重算同一句它早知道被推迟的话。

> 注意：精力推迟本身是**预期行为**。真正浪费的是潜意识忽略精力、反复重算同一件已被推迟的事，烧 token、刷屏 notify。修法应针对"重复/退避"，而非强行让主 loop 无视精力去干活。

---

## 相关 commit

- `09a264fa` feat(agent): make Claude forks and compression reuse the main loop prefix cache（让 fork 前缀字节对齐主 loop，放大了收敛）
- `3640db29` fix(agent): stamp runtime reminders from trace/run id（冻结时间戳，进一步稳定输入）
- `47081f43` / `12af1cec`（把空 final_answer 设为合法终态，空 turn 由此成立）
- `3831ebf0` feat(agent-service): route final-answer idle through subconscious notify（引入该闭环）

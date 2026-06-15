# TODOS

## LLM runtime


对比这两个trace,我们已经发现了问题了, 要包含请求头, 请求体

```
source: LLM
event: model request slice
status: ok
2026-06-15 11:33:44
LLM 请求
小腻
runtrace_1781494416880_8a6cfc98
stack-slice:llm_1781494418191_5cfd9892
codex-local/responses
payload 2 B
Raw Trace
Input 41.3K
Cache 40.6K
Output 117
codex-local/responses · gpt-5.5 · turn 1 · 41272->117 tokens

source: LLM
event: model request slice
status: ok
2026-06-15 11:33:53
LLM 请求
小腻
runtrace_1781494425437_2f3e19c0
stack-slice:llm_1781494427537_4ac5f11e
codex-local/responses
payload 2 B
Raw Trace
Input 42.2K
Cache 2.7K
Output 234
codex-local/responses · gpt-5.5 · turn 1 · 42199->234 tokens


```


### Investigate fast energy/pressure drift causing frequent recover_energy attempts

**What:** Check the current Xiaoni energy and pressure projection system to explain
why she has recently tried to sleep so often, and why energy/pressure appears to
drop or accumulate unusually fast.

**Why:** The recovery page now shows rejected `recover_energy` attempts; the latest
7-day window had 29 recover_energy calls and 16 engineering rejections. Those
rejections were mostly because the anti-frequent-rest gate said she had not crossed
the sleep threshold yet, but the repeated attempts suggest the prompt-visible state,
life reducer, action costs, wake cooldown, or projection timing may be making her
feel tired too aggressively.

**Context:** Start from `agent_session_life_states.projection_json`,
`agent_life_events`, and `tool_executions` for `recover_energy`. Compare
homeostatic pressure, action debt, action-cost events, `last_wake_at`, and
`required_pressure` around the recent rejected calls. Confirm whether this is a
real reducer bug, cost calibration issue, prompt interpretation issue, or expected
behavior from recent high activity.

**Effort:** M
**Priority:** P2
**Depends on:** Recent recovery telemetry and life projection samples

### Investigate repeated isolated prompt-cache hit drops after heartbeat

**What:** If 小腻在 active recovery cache heartbeat 启用后仍出现单个
`codex-local/responses` slice 的 `cached_tokens` 比例从约 98%-99% 突然跌到低位、
下一轮又恢复，继续排查 provider/backend cache 行为并收集更多样本。

**Why:** `runtrace_1781350585451_bc8018f8` /
`llm_1781350586397_00729fb8` 出现过 `Input 57.2K / Cache 6.8K / Output 93`
的孤立抖动。已排除本地 request prefix 漂移、compress、tool_choice 变化和附近
生图任务，但还没有足够证据证明是 provider 侧 cache eviction / TTL / best-effort
miss 的哪一种。

**Context:** 该 slice 前后相邻请求维持同一 `model_provider=codex-local`、
`model_name=gpt-5.5`、`wire_provider_format=codex-local/responses`、
`prompt_cache_key=xiaoni:global`，`instructions` / `tools` / `tool_choice` /
`reasoning` / `include` 均稳定；`wire_request - input` 哈希也稳定。官方
`/v1/responses` 文档支持 `prompt_cache_retention: "24h"`，但当前小腻实际走的
ChatGPT/Codex backend `backend-api/codex/responses` 直接返回
`Unsupported parameter: prompt_cache_retention`；2026-06-14 手动 heartbeat curl 也确认
该 backend 拒绝 `max_output_tokens`，所以当前路径只能依赖
`prompt_cache_key`、sleeping cache heartbeat 和 backend best-effort cache。下次复现时
优先对比更多连续 slice 的 wire payload、cached_tokens、时间间隔、同 key 并发情况和
`cache_heartbeat_no_persist` 用量事件，再决定是否需要改 provider 路径或继续增加观测。

**Effort:** M
**Priority:** P3
**Depends on:** 再次出现可复现或高频样本

### Add group number to group notification templates

**What:** 群通知应该加上群号；更新相关通知模板，让群消息唤醒或展示时能直接看到
QQ 群号。

**Why:** 只显示群名称或上下文容易在同名群、转发排障和后续追踪时产生歧义。
群号是稳定标识，应该进入模板。

**Context:** 从 provider-service / agent-service 当前群通知模板入口开始查，确认
入站群消息上下文里已有 group id 后再改模板。不要在前端或历史通知契约里堆兼容。

**Effort:** S
**Priority:** P2
**Depends on:** 当前群通知模板位置和群消息上下文字段确认

## Completed

# xiaoni_os 改写腿：分类 → 空转才改写 → 准入

状态：2026-08-27 实现，替代 `xiaoni-os-text-channel-psych-gate.md` 的 Step3 心理评估 fork。开关沿用 `agent_runtime_control.psych_assessment_gate_enabled`。

## 为什么

- 她的 `xiaoni_os` 走 assistant `type:text`，过去被 100% 剥出 replay（`text_admit` 门默认 fail-closed）。于是她把心里话搬进 `exec_command` 的 `#` 注释——那是唯一能被下一轮的自己看到的地方（`function_call` 参数原样回放）。
- 2026-08-23 上线的 prompt 禁令没用：注释率 67.6% → 76.1%，多行注释块 54.1% → 58.2%。注释是代偿，不是对抗。
- 心理评估 fork 实测（`psych_assessment_fork_slices`，2026-07-13/14，18h）：492 次判定 keep 460（93.5%）/ evict 32。每次骑 ~400K 热前缀只剔 6.5%，不值。
- 成本论证不成立：压缩后注释字节占上下文 3.0%，被剥的 text 占 1.2%。目标只剩两个：**防摸鱼叙述自我强化**、**通道一致**（想法只有一个去处）。

## 做什么

turn 末，对这一 turn 每条 assistant 文本：

```
text ──► 分类(Sonnet 4.6, 输出 1/0)「有没有事」
           │ 1 有事 ────────────────────────► kept:      原文准入(text_admit)
           │ 0 空转 ──► 改写(Sonnet 4.6)朝外走 ──► rewritten: 正文替换为改写版 + 准入
           │            └ 改写失败/为空 ────► evicted:   不打 stamp(默认剥)
           └ 分类失败/认不出 ──────────────► failed_open: 原文准入
```

- 「有事」= 事实观察 / 进度 / 明确信息缺口 / 清晰下一步 / 对人或事的实质推进。「空转」= 单纯等待、不打算做事、自我安慰、无信息增量的情绪叙述、重复上轮。
- 改写要求：第一人称、保留她的口气和事实、把「等/再看看/不想动」换成此刻能动手的具体的事、情绪最多一句、≤1.5× 原文。硬顶 3× 否则 evict。
- 失败策略：分类失败 → fail-open（激励语境下 fail-closed 读作「写了也没用」）；已判空转但改写失败 → evict（剥掉 = 改写腿上线前的行为）。

## 定位：监督者（student / supervisor）

主 agent（Opus）是 student；监督者模型（Sonnet 4.6，`XIAONI_OS_REWRITE_MODEL` 可覆盖）不是 teacher——它不比她懂怎么生活，它只占一个她占不到的位置：turn 末、经验写回上下文之前，拿固定 rubric 决定「这段经验以什么样子被回放」。这是 critic / reward-model 的位置，不是 teacher forcing。推论：

1. 监督者只看 rubric 与这一条文本，不看她的历史（独立小请求，这也是它便宜的原因）。
2. 监督者的产出永远以她的第一人称进入她的上下文；她看到的是「自己」在推进，没有第二个声音。
3. 监督者只需要一致性不需要能力，所以可以换成训出来的分类器 / 小改写器，Sonnet 退为兜底。

## 缓存 / 不可变性

- 两次调用是**独立小请求**（`xiaoni-recall-llm-client` 同一出口，`executionMode` = `xiaoni_os_classify` / `xiaoni_os_rewrite`），不克隆主请求、不进 fork 系统 → 不受双缓存铁律约束，主热前缀零影响。
- 决定与改写后正文在 `stampTextAdmitInPlace` 同一落点（`agent-loop-service.ts` turn 末，`buildModelOutputStackItems` / `appendLoopInputItems` 之前）就地写进共享 `outputItems` ref。这条 text 在此之前从未进过任何请求（text 门只有 `:8718` 每 turn 构建与 `:18668` replay 两处读，turn N 的 text 到 turn N+1 才被读）→ 不违背「已消费上下文不可变」；live 与下一 run replay 拿到同一份字节。
- 冻结缓存回归用例一个未改。新增 `xiaoni-os-rewrite.test.ts`（含 live/replay 字节一致）。

## 模型与前缀缓存

- 模型 `claude-sonnet-4-6`（真机：分类 1.8s / 改写 7.7s，单次 input ≈ 470 tokens）。
- **不做前缀缓存**：Sonnet 4.6 最小可缓存前缀 1024 tokens，这条请求 system + text 全长 ~470，打 `cache_control` 也静默不缓存（provider `/api/internal/llm/debug` 路径现在也不打）。每次是独立请求，没有持续 append 的 input；300 次/天 ≈ 0.15M tokens ≈ $0.45/天，为缓存把 system 垫到 1024 反而多付。system prompt 若将来长过 1024，再在 provider debug 路径给 system 块加 `cache_control`。

## 留痕 / 训练集

表 `xiaoni_os_rewrites`（`packages/persistence/xiaoni-os-rewrite.js`，启动 ensure）：原文、`classify_verdict`(action/idle/unparsed/failed)、分类原始输出、改写、`outcome`(kept/rewritten/evicted/failed_open)、两次 `llm_call_id`（接 `codex_provider_usage_events` 看 wire/token）、耗时。

- 原文 + 判定 = 分类器训练对；原文 + 改写 = 改写器训练对。v1 两条腿都是 Sonnet 4.6（最初 Haiku，改写会把比喻当人编事，同事建议换），数据攒够再训分类器，Sonnet 退为兜底。
- 观察：`summarizeXiaoniOsRewrites({sinceHours})` 按 (判定, 去向) 计数；日志 `xiaoni_os_rewrite`。

## 提示词

- `docs/xiaoni_prompt/xiaoni_os_classify.md`、`xiaoni_os_rewrite.md`：每次调用读文件，snippet 即时生效，零缓存影响。
- `system_prompt.md` `xiaoni_os` 节：原「注释进命令参数每轮重付；`xiaoni_os` 不进」已为假，改为「`xiaoni_os` 会进下一次上下文；有事原样进，只是在等/在歇进去的是往前推一步的版本」+「注释是命令的一部分，不会被当作你的想法」。reload policy `after_core_memory_compression`，下一次压缩生效。

## 验收

1. 开关 ON 后，第一条 assistant 文本产出在 `xiaoni_os_rewrites` 有行，`outcome` 非 failed_open 占多数。
2. 相邻两 slice 的 `cache_read_input_tokens` 不塌（改写腿不动主前缀）。
3. 14 天窗口：`exec_command` 多行注释块占比从 58.2% 降到 <20%（单行注释 18% 是合法用法，不计）。没降 → 回到 Round-2 的 scrub 腿。
4. 日志无 `xiaoni_os_rewrite` 连续 failed_open（那条 OAuth 路一半 500 的历史，见 recall 判官）。

# 四家 agent harness 怎么处理「字节上有进展、目标上零进展」

**查的是什么**：命令**执行成功**、返回了**大量输出**（grep 命中 8000 字符）、但对当前目标**毫无推进** ——
这类「业务无产出」在工程层完全不可见。

**不查什么**：exit≠0、文件不存在、工具报错。这类「执行失败」工程可见，四家都有处理，与本文无关。

**校准用例**（来自 `recall-dormant-relationship-question.md` 附录 B）：agent 被问「你曾经最好的朋友是谁」，
连续 11 次 `grep` 换关键词，每次返回 400–8000 字符**无关命中**，然后结论「我翻了所有能翻的地方，找不到」并放弃。
答案在它读得到的 `INDEX.md` 里。同一模型在 Claude Code 第 18 次调用时自己说
「这些都是文学引用，让我换一个角度」，改用枚举，找到了答案。

**全文只读本地源码**，每条结论挂 `文件:行号` + 原文。拿不到证据的地方写「未找到」。

源码位置（下文路径均相对各自根）：

| 简称 | 根目录 | 形态 |
|---|---|---|
| **dsh** | `harness-src/deepseek-harness/` | TypeScript / pnpm monorepo |
| **pi** | `harness-src/pi/` | TypeScript monorepo |
| **codex** | `harness-src/codex/` | Rust（`codex-rs/`） |
| **CC** | `harness-src/claude-code/cli-strings.txt` | 2.1.239 bundle 的 49MB strings |

---

## 一、横向对比表（先看这个）

| # | 问题 | dsh | pi | codex | CC |
|---|---|---|---|---|---|
| 1 | **非 LLM 无进展检测** | **有**：`repeat-tool-reminder` 连续同调用计数，阈值 `[3,5,8]`，**软信号**注入。但**只认字节级完全相同** | **无**（loop 是裸 `while(true)`，无步数计数） | **无**重复检测；唯一的连续 N 计数器（Guardian，默认 3）数的是**安全否决**，硬中断且模型看不见 | **部分**：`Read` 有重复检测（`Wasted call`，软信号），**但搜索类工具没有**；另有 5 轮**静默轮次**提醒 |
| 2 | **LLM 判定无进展** | **无**（**四处** README 明写 "independent evaluator is deferred"） | **无**（evals 判官是**确定性函数**且离线） | **无**。有两个真独立判官（Guardian / Review），但一个判**安全**一个判 **git diff** | **有一个**：`advisor` 工具，`When stuck -- … approach not converging, results that don't fit`。但**模型主动调、默认关、且是主上下文克隆** |
| 3 | **工具返回「有输出但没用」** | 带 `Found N matches` 计数头 + 截断/spill 定位符 | **无命中计数**；有行内 `[...]` 截断提示；结构化 `details` **被 provider 序列化丢掉，模型看不到** | `shell` 裸 stdout，**零元信息** | 有 `Found N`；零命中**刻意设成 `isError:false`**；**独有**截断 Read 的守卫 `Do NOT answer from this page alone…` |
| 4 | **换一条路的原语** | `ralph`（**不继承父上下文**的新 child）、`subagent`、`workflow`、goal `blocked` | session 是**真树**，但 fork/branch **100% 由人触发**，模型没有对应工具 | `spawn_agent`（默认克隆且 prompt **禁止**为「深入调研」而起）、`new_context`、`update_plan`（**只有三个状态，没有 failed**） | `Task` 子 agent、plan mode、`TodoWrite`（**同样只有三个状态，没有 failed**） |
| 5 | **深度/复杂度判定** | 「routine single-turn work 不要建 goal」 | **未找到**；grep/find/ls 的 `guidelines: []` 是空的 | plan prompt：「最简单的 25% 跳过 plan」 | **四家里最具体**：`TodoWrite`「≥3 个不同步骤」+ **`Guf=3`「超过 3 次查询就 spawn Explore」** |
| 6 | **止损机制** | goal 轮次 `256`、ralph `maxRounds 256`、repeat 阈值 `[3,5,8]`、blocked 下界 `3`；**显式声明无 turn 预算** | **无 turn/step 上限**；只有压缩阈值 + 输出截断；真正的止损是**人** | 无 turn 上限（源码注释直说不担心死循环）；token 预算 + `get_context_remaining`（模型可见，**默认关**） | **四家里最全**：max turns（200/50，交互式无默认）、**USD 预算**、180s 流看门狗、**autocompact 抖动断路器**、静默轮次提醒 |
| 7 | **第三方视角（不共享主上下文的评审者）** | **只有 ralph 的「新 child」** —— 是**重试**不是**评审**；评审明写 deferred。hook 是真接缝但无出货实现（`TODO(stop-loop-guard)`） | evals 判官是**纯确定性函数 + 离线**，碰不到运行中的 session | **有三个真第三方**（Guardian / Review / Memories），但分别是**判安全** / **只有人能触发** / **跨会话事后且默认关** | **Handoff 分类器**是引擎自动的独立第二 LLM，但**判安全**；`advisor` 判进展却是**上下文克隆**；且 prompt **劝阻**造评审子 agent |

**一句话总览**：**四家都没有「业务无产出」检测器。** 没有任何一处代码计算「刚才那次工具调用有没有推进目标」。

两家做到了边缘、然后停下：
- **dsh** 的 `repeat-tool-reminder` 只认**字节级完全相同**的重复调用；校准用例里每次换关键词，**不会触发**。
- **CC** 的 `Read` 重复检测同理（只管同一个文件），`advisor` 判的正是「是不是卡住」但**默认关且是主上下文克隆**。

**所有数值上限量的都是资源**（轮次、token、字节、美元、墙钟），**没有一家的上限量的是产出**。
256 轮无产出和 256 轮有产出，触发的是同一个终止路径。
CC 的流看门狗甚至把「no progress」直接定义成「没有 stream chunk 到达」（`cli-strings.txt:599341`）——
一个每秒吐 8KB 无用输出的 agent，在它眼里健康得很。

**但 CC 与另外三家有一个结构性差别，值得单列**（见第九节）：它不检测无产出，
而是让无产出**对模型来说容易被注意、且难以忽略** —— 靠工具返回契约 + 强制开口的节律 + 完成契约。

---

## 二、问题 1：非 LLM 的无进展检测

### 2.1 dsh —— 唯一真做了的：`repeat-tool-reminder`

`packages/guard/README.md:5` 定位整个 `guard/` 家族：

> Behavioral guard plugins watch the agent loop for **unproductive patterns** and enforce per-call budgets.

检测逻辑在 `packages/guard/repeat-tool-reminder/src/index.ts:189-207`：

```ts
function observe(exec: ToolExecution): UserMessage | undefined {
    if (!exec.agent) return undefined
    if (!tracked(exec.name)) return undefined
    const canonical = canonicalize(exec.arguments)
    const key = JSON.stringify([exec.name, canonical])
    const chain = chains.get(exec.agent)
    const count = chain !== undefined && chain.key === key ? chain.count + 1 : 1
    chains.set(exec.agent, { key, count })
    if (!thresholdSet.has(count)) return undefined
```

**默认阈值** `packages/guard/repeat-tool-reminder/src/index.ts:46`：

```ts
thresholds: z.array(z.number()).default([3, 5, 8]),
```

**超限后是软信号，不是硬切**。`README.md:5` 明写：

> An advisory loop-breaker, not a model-facing tool: it never appears in the tool list,
> **never vetoes or rewrites a call** … The decision (retry differently, gather more evidence, or finish)
> **stays entirely with the model**.

第一档（`thresholds[0]`）注入的原文，`src/index.ts:63-67`：

```
You are repeating the exact same tool call with identical arguments. Carefully analyze the
previous result before calling again: if the task is not complete, try a different approach
or different arguments instead of repeating the call.
```

后续档位，`src/index.ts:70-79`：

```
Repeated tool call detected:
- tool: <toolName>
- consecutive_calls: <count>
- arguments: <canonicalArguments>
The repeated calls are not making progress. Do not call this tool with these exact arguments
again. Inspect the latest result and choose a different action, different arguments, or finish
the task if enough evidence has been gathered.
```

投递方式 `README.md:35`：走 `additionalContexts`，loop 把它作为合成 user message 追加 ——
**模型可见、可溯源、append-only 不打穿 KV cache**。

#### 关键限制 —— 这条腿在校准用例里不会响

`packages/guard/repeat-tool-reminder/README.md:85`：

> **Exact-match detection only** — canonicalization is a deep key-sort, so **near-identical variants
> (a tweaked path, extra whitespace inside a value) evade the chain**; fuzzy matching is rejected
> pending evidence of need.

决策记录 `.agents/notes/archived/feature/2026-07-08-repeat-tool-guard.md:63` 明确写了这是**主动否决**的：

> **Fuzzy/near-identical detection** (normalized paths, similar-but-not-equal arguments) — **rejected**:
> exact match after canonicalization is cheap, deterministic, and explainable to the model;
> similarity thresholds invite false positives and need evidence before they earn complexity.

**校准用例里 agent 每次 grep 都换关键词** —— 参数字节级不同 —— 计数器每次 reset 到 1，**永远到不了 3**。

其它已记录的限制（`README.md:86-90`）：压缩不 reset 链；纯 advisory 不升级为 block；
subagent 链不合并；**过了最高阈值链条静音**（只在恰好等于配置值时触发，之后再也不响）。

#### 出货配置比 README 示例更弱

README 的示例写着 `exclude: [todo_write]`，但实际出货的 base bundle
（`packages/bundle/base/cordis.patch.yml:389-394`）**没有设 `exclude`**：

```yaml
    # Consecutive-repeat reminders on the tool chain.
    - id: repeat-tool-reminder
      name: '@deepseek-ai/dsh-repeat-tool-reminder'
      config:
        thresholds: [3, 5, 8]
        argumentsPreviewChars: 500
```

按 `README.md:27` 的链语义，**没被 exclude 的工具会 reset 计数器** ——
所以实际部署里中间插一次 `todo_write` 就能把链条洗掉。

#### Code Mode 下这条防线更弱

`packages/core/tools/README.md:163` 的 SDK 指令原文：

> Emit results with `return` and/or `console.log(...)`. **ONLY what you print or return comes back to
> you — intermediate tool results never enter the conversation**, so extract just what you need.

也就是说 11 次 grep 可以全部发生在**一个** `run_code` 程序里，中间的工具结果根本不进上下文，
这条唯一的空转防线可见性进一步下降。

#### dsh 明确不做 turn 预算

`packages/core/agent-loop/README.md:134`：

> **No built-in turn budget** — tool calls or steering continue the current turn; a policy that
> bounds runaway turns must cancel from an existing lifecycle extension point such as
> `agent/turn-stopping`.

决策记录 `.agents/notes/archived/feature/2026-07-08-repeat-tool-guard.md:62` 也驳回了 loop 级步数预算：

> **A loop-level step or repetition budget in `agent-loop`** — rejected: "plugins, not loop changes";
> a hard step budget is a blunter, orthogonal control that would need its own proposal.

而 token 计量**明确不参与任何决策**（`packages/llm/token-meter/README.md`）：

> An occupancy percentage is a user-facing reference figure, not a billing record or a gating input
> — **nothing in the harness makes decisions from it**, and compaction reads `measure()` instead.

### 2.2 dsh 的第二条腿：goal `blocked` 前置门（这条是硬的）

`packages/goal/tool-goal/README.md:25`：

> Complete and blocked also accept the exact current goal round … A goal-round blocked call is
> **mechanically rejected until `blockedAfterConsecutiveRounds`**; the model judges whether the same
> condition actually persisted and must describe it in `blocked_reason`.

默认值 `packages/goal/tool-goal/README.md:33`：`blockedAfterConsecutiveRounds: 3`。

这是四家里**唯一一个引擎硬性拦截「我放弃」的机制**：模型在第 3 个 goal round 之前
**没有能力**把目标标成 blocked。配套 prompt `packages/goal/tool-goal/README.md:49`：

> Mark complete only when the objective is actually achieved. Mark blocked only after the same
> blocking condition persists for at least 3 consecutive goal rounds, and report that concrete
> condition in blocked_reason; **difficulty, uncertainty, or useful remaining work is not blocked.**

最后半句是四家 prompt 里**最接近**「不许因为难就说自己不行」的一句。

但它自己的限制条款 `README.md:77` 说清了缺口：

> **Same-condition blocking remains model judgment** — the runtime enforces **distinct admitted-round
> count**, not **semantic equivalence of obstacles**; an independent evaluator is deferred.

即：引擎只会数「过了几轮」，**不会判断这几轮是不是在原地打转**。

代码在 `packages/goal/tool-goal/src/index.ts:299`：

```ts
if (args.action === 'blocked' && authority.kind === 'goal-round'
  && authority.goal.roundsStarted < resolved.blockedAfterConsecutiveRounds) {
  throw new HarnessError(
    `blocked requires at least ${resolved.blockedAfterConsecutiveRounds} consecutive goal rounds; `
    + `current round is ${authority.goal.roundsStarted}`,
    'GOAL_TOOL_BLOCK_THRESHOLD',
  )
}
```

配套的每轮 prompt（`packages/goal/goal-round-driver/src/prompt.ts:15-24`）里有全仓库
**唯一一句直接对抗「我以为我搜过了」**的文本：

```
<goal_round>
Objective: <JSON-quoted>
Round: <n>/<max>

Continue working toward the objective in this same session. Treat the current workspace,
tool results, and durable session state as authoritative; inspect them instead of assuming
earlier narration is still current. Make concrete progress and verify the result. Before
claiming completion, gather evidence that the whole objective is achieved, read the current
goal, and mark it complete. If work remains, leave the goal active for the next round. Follow
the configured goal-tool policy before reporting a blocker.
</goal_round>
```

**但这一整套只有显式开了 goal 且模型已经 `create_goal` 才在场，普通对话里一个字都没有。**

### 2.3 pi —— 结构上就没有

`packages/agent/src/agent-loop.ts:170-174` 是裸的：

```ts
	// Outer loop: continues when queued follow-up messages arrive after agent would stop
	while (true) {
		let hasMoreToolCalls = true;

		// Inner loop: process tool calls and steering messages
		while (hasMoreToolCalls || pendingMessages.length > 0) {
```

**整个文件里没有任何计数器、迭代序号或预算变量。** 退出路径只有四条：

| 退出 | 行号 | 原文 |
|---|---|---|
| 模型报错/被中止 | `agent-loop.ts:196` | `if (message.stopReason === "error" \|\| message.stopReason === "aborted") {` |
| 整批工具都投票停止 | `agent-loop.ts:582-584` | `return finalizedCalls.length > 0 && finalizedCalls.every((finalized) => finalized.result.terminate === true);` |
| 宿主回调 | `agent-loop.ts:247-257` | `if (\n await config.shouldStopAfterTurn?.({ ... })\n) {` |
| 模型不再调工具 | `agent-loop.ts:206` | `hasMoreToolCalls = false;` |

`maxTurns` / `maxSteps` / `maxIterations` / `turnLimit` / `noProgress` / `watchdog` 全仓库**只命中测试脚本**：
`packages/coding-agent/test/sdk-codex-cache-probe-tool-loop.ts:67`（`const MAX_TURNS = 50;`，手写的缓存探针）、
`packages/ai/test/stream.test.ts:284`（`const maxTurns = 5; // Prevent infinite loops`，单测）。

`shouldStopAfterTurn` 这个钩子**存在但 pi 自己一个实现都没有**（只有类型 `packages/agent/src/types.ts:222`
和管线 `packages/agent/src/agent.ts:460-462`）。它的注释还写明了它本来也不是给进展用的
（`types.ts:216-221`）：

> Use this to request a graceful stop after the current turn, e.g. **before context gets too full**.

`grep -rn "system-reminder\|system_reminder" packages --include=*.ts` **零命中** —— pi 没有向模型注入提醒的通道。
`dedupe` / `repeated tool` / `identical call` / `callSignature` 在 agent 和 coding-agent 里也零命中，
**不存在任何工具调用相似度或重复检测**。全仓库 `repeat` 的命中全在 `packages/tui/`（文本折行）。

值得记一笔：dsh 的决策记录 `.agents/notes/archived/feature/2026-07-08-repeat-tool-guard.md:10` 说
它是照着 **pi 的第三方扩展** `pi-repeat-tool-guard` 移植的 —— 那是**仓库外的扩展**，pi 本体不带。

pi 自己在文档里写了这是设计选择（`packages/coding-agent/README.md:506`）：

> **No built-in to-dos. They confuse models.** Use a TODO.md file, or build your own with extensions.

### 2.4 codex —— 没有重复检测，但有模型可见的 token 倒计时

`grep -rn "max_turns\|max_steps\|max_iterations\|turn_limit\|step_limit\|max_tool_calls" codex-rs` **零命中**。

有的是 token 预算，而且**做成了模型可调用的工具**。
`codex-rs/core/src/tools/handlers/get_context_remaining_spec.rs:8-19`：

```rust
pub(crate) const GET_CONTEXT_REMAINING_TOOL_NAME: &str = "get_context_remaining";

pub fn create_get_context_remaining_tool() -> ToolSpec {
    ToolSpec::Function(ResponsesApiTool {
        name: GET_CONTEXT_REMAINING_TOOL_NAME.to_string(),
        description: "Get the remaining tokens in the current context window.".to_string(),
```

配套的 `<context_window_guidance>` developer 块（`codex-rs/models-manager/models.json:82`，原文节选）：

> It is a good idea to take incremental notes while you work so that you do not miss any important
> info. You can also use `get_context_remaining` tool to find the remaining token budget for better
> planning. **Once the token budget is exhausted, you will lose access to the current window and
> continue in a fresh context window** and you can only recover through `notes` and `history` tools.

渲染成模型可见的一句（`codex-rs/core/src/context/token_budget_context.rs:157`）：
`format!("You have {tokens_left} tokens left in this context window.")`。

注意这是**资源预算**，不是**进展预算**：它管的是「你还剩多少 token」，不管「你这些 token 花得有没有用」。
而且 `Feature::TokenBudget` 默认是关的（`codex-rs/features/src/lib.rs:1429-1432`：`default_enabled: false`）。

codex 的两个 agent loop 是裸的、无界的（`core/src/tasks/regular.rs:76`、`core/src/session/turn.rs:301`
都是 `loop {`），源码里还留了一句注释直说不担心（`core/src/session/turn.rs:469`）：

```rust
// as long as compaction works well in getting us way below the token limit, we shouldn't worry about being in an infinite loop.
```

**唯一一个带硬中断的连续 N 计数器是 Guardian，而它数的是安全否决，不是无效劳动**
（`codex-rs/core/src/guardian/mod.rs:55-59`）：

```rust
pub(crate) const MAX_CONSECUTIVE_CYBER_GUARDIAN_DENIALS_PER_TURN: u32 = 1;
pub(crate) const MAX_CONSECUTIVE_GUARDIAN_DENIALS_PER_TURN: u32 = 3;
pub(crate) const MAX_RECENT_CYBER_AUTO_REVIEW_DENIALS_PER_TURN: u32 = 1;
pub(crate) const MAX_RECENT_AUTO_REVIEW_DENIALS_PER_TURN: u32 = 10;
pub(crate) const AUTO_REVIEW_DENIAL_WINDOW_SIZE: usize = 50;
```

超限后**硬中断且模型看不见**（`core/src/guardian/review.rs:281,292`）：报 `GuardianWarning` 事件给 UI，
然后 `.abort_turn_if_active(&turn_id, TurnAbortReason::Interrupted)`。

顺带一个反讽：codex **确实**在给每条命令分类
（`core/src/tools/registry.rs:628-631` 判 `"read"/"list_files"/"search"/"unknown"`），
但那个分类只用作 OTEL 标签（`registry.rs:638`：`tool_result_tags.push(("command_category", category));`）。
**codex 知道自己刚跑了一次搜索，但它从来不数。**

### 2.4b codex 的反向机制：Goals 自动续跑 + 三轮 blocked 门（但**没有引擎侧计数器**）

`Feature::Goals` 默认**开**（`codex-rs/features/src/lib.rs:1423-1426`：`default_enabled: true`）。
goal 处于 Active 且线程空闲时，`ext/goal/src/runtime.rs:362` 的 `continue_if_idle()`
**会自动起一个新 turn**，注入 `codex-rs/prompts/templates/goals/continuation.md`。

其中的 blocked 审计（`continuation.md:43-49`）：

> Blocked audit:
> - Do not call update_goal with status "blocked" the first time a blocker appears.
> - **Only use status "blocked" when the same blocking condition has repeated for at least three
>   consecutive goal turns**, counting the original/user-triggered turn and any automatic goal continuations.
> - …
> - **Never use status "blocked" merely because the work is hard, slow, uncertain, incomplete, or
>   would benefit from clarification.**

以及 `:41`：

> Do not rely on intent, partial progress, memory of earlier work, or a plausible final answer as
> proof of completion. … **If the evidence is incomplete, weak, indirect, merely consistent with
> completion, or leaves any requirement missing, incomplete, or unverified, keep working** instead of
> marking the goal complete.

**这和 dsh 的 `blockedAfterConsecutiveRounds: 3` 是同一个设计，但落地方式差一层：**

| | dsh | codex |
|---|---|---|
| prompt 里写了三轮门 | ✅ `tool-goal/README.md:49` | ✅ `continuation.md:45` |
| **引擎机械拒绝早放弃** | ✅ `tool-goal/src/index.ts:299` 抛 `GOAL_TOOL_BLOCK_THRESHOLD` | ❌ **没有**。`ext/goal/src/runtime.rs`、`accounting.rs` 只数 token 和时间 |
| 「同一个障碍」谁判 | 模型（两家都是） | 模型 |
| 轮次上限 | `defaultMaxGoalRounds: 256` | `max_goal_token_budget: None` = **无界**（`core/src/config/mod.rs:880`），`continuation.md` 渲染成 `Tokens remaining: unbounded` |

也就是说 **codex 的这条腿是纯 prompt 的，而且这个循环没有上界。**

### 2.5 CC —— 没有通用重复检测，但**有一个专门的重复检测 + 一个静默轮次计数器**

（这一节是本次调研里对 CC 更正最多的地方。我最初判「什么都没有」，是错的。）

#### 没有的：通用重复/循环检测

| 检索词 | 结果 |
|---|---|
| `noProgress` / `no_progress` | **零命中** |
| `no-progress` | 14 处，**全部**是 npm/bun CLI 的 `--no-progress` 补全串（`:222843` 等） |
| `identical tool call` / `repeated tool` / `toolCallSignature` | **零命中** |
| `loopDetect` | 1 处 `:696911` `LoopDetected` —— HTTP 508 状态码名 |
| `repeatCount` | `:66174` / `:769647` 是 SVG 属性和 DevTools 字段 |

**Grep / Glob / Bash / WebSearch 上没有任何重复调用计数。**
校准用例里那 11 次换关键词的 grep，CC 也一个字都不会说。

#### 有的一：`Read` 的重复检测 —— 唯一一个真的重复调用检测器

`cli-strings.txt:881289`：

```js
LHv="File unchanged since last read. The content from the earlier Read tool_result in this conversation is still current — refer to that instead of re-reading."
$_p="Wasted call — file unchanged since your last Read. Refer to that earlier tool_result instead."
```

seeded 变体 `cli-strings.txt:554995`：

> This file is already in your context (see "Contents of {path}" above) and has not changed on disk.
> Use that content instead of re-reading.

**投递方式是 tool_result 正文本身**（`:881289` 的 `case"file_unchanged"` 分支），
**模型可见的软信号，不是中断**。

它跟 dsh 的 `repeat-tool-reminder` 是同一类东西，但作用域窄得多：
**只管 Read 同一个文件，不管任何搜索工具。**

#### 有的二：静默轮次计数器 —— 强制模型开口说话

`cli-strings.txt:899209`：

```
foh=5, hoh=3
moh="The user hasn't heard from you in a while. As you continue, keep them updated when there's something to tell — a finding, a change of plan."
```

触发逻辑（同行）：数**连续没有用户可见文本、也没有可见工具**的 assistant 消息，
`turnsSinceLastReminder >= 5` 且这一段静默里已发提醒 `< 3` 次时注入。
渲染成 `<system-reminder>` user turn（`:622015` `silent_turn_reminder`）。
可覆盖：`CLAUDE_CODE_SILENT_TURN_REMINDER{,_TEXT,_TURNS}`（`:532175-532177`）。

**这是通信计数器，不是进展计数器** —— 它数的是「你多久没说话了」，不是「你多久没产出了」。
但它是四家里**唯一一个会周期性把模型从纯工具循环里拽出来、逼它写字**的机制。
下面第九节会论证：**这很可能就是校准用例里第 18 次调用那句话的来源。**

#### 有的三：其它按轮次的软提醒

| 机制 | 位置 | 阈值 | 文本 |
|---|---|---|---|
| TodoWrite 陈旧提醒 | `:899226`、`:899348` | `TURNS_SINCE_WRITE:10`、`TURNS_BETWEEN_REMINDERS:10` | `The TodoWrite tool hasn't been used recently… Also consider cleaning up the todo list if has become stale and no longer matches what you are working on.` |
| 未加载工具提醒 | `:899356` | 15 轮 / 10 个名字 | `Before concluding a capability is missing or building a workaround, use {ToolSearch} to find and load relevant tools` |

`:899356` 那条是整个 49MB 里**唯一**一句预判「模型断定某个能力不存在」的文本 ——
但它的作用域是**未加载的工具 schema**，不是搜索结果。

#### 有的四：autocompact 抖动断路器 —— 字面意义上的「字节有进展」检测

`cli-strings.txt:527532`：

> **Autocompact is thrashing:** the context refilled to the limit within 3 turns of the previous
> compact, 3 times in a row. A file being read or a tool output is likely too large for the context
> window. Try reading in smaller chunks, or use /clear to start fresh.

逻辑在 `:882067` 附近：`compacted && turnCounter<3` 时 `consecutiveRapidRefills++`，
`action: t>=3 ? "trip" : "proceed"`，**硬中断**，loop 返回 `{reason:"rapid_refill_breaker"}`。

**这条正是「模型在字节上有进展」的检测器 —— 而它管的是上下文压力，不是目标。**
一个每秒吐 8KB 无用 grep 输出的 agent，在这个断路器眼里是完全健康的。

#### 有的五：max turns 与 USD 预算（硬中断，模型看不见）

| 项 | 位置 | 值 |
|---|---|---|
| `fork` agent 类型 | `:881975` | `maxTurns:200` |
| 自主执行 agent 类型 | `:882789` | `maxTurns:200` |
| forked agent 默认常量 | `:893866` `FORKED_AGENT_DEFAULT_MAX_TURNS`，`:893868` `syl=50` | **50** |
| env 覆盖 | `:532732` `CLAUDE_CODE_MAX_TURNS`，校验 `:539330` | — |
| 交互式 REPL | — | **无默认上限** |

超限：`max_turns_reached`（`:598674`）、`] Reached max turns limit (`（`:598675`）、
`Reached maximum number of turns (`（`:644545`）、
`Hooks: Agent turn … hit max turns, aborting`（`:625741`）、
headless `Error: Reached max turns (`（`:680723`）。

USD 预算：`:598732` `maxBudgetUsd`、`:639828` `maxCostUsd`、`:681251` `reached --max-budget-usd `、
`:680724` `Error: Exceeded USD budget (`。

另有异步 agent 的流停滞看门狗（`:599336`、`:599341`）：
`stall watchdog fired after {ms}ms with no progress` / `Agent stalled: no progress for {s}s`，
常量 180000 ms。**这里的「no progress」= 没有 stream chunk 到达** ——
又一个把「进展」定义成字节的地方。


## 三、问题 2：有没有 LLM 判定这件事

**四家都没有。** 而且 dsh 是**三处独立地方**明确写下「推迟」的：

| 文件:行号 | 原文 |
|---|---|
| `packages/goal/goal-round-driver/README.md:60` | **No independent evaluator** — the model-facing goal policy decides when evidence is sufficient for completion and whether a blocker is semantically unchanged; evaluator-backed certification remains deferred. |
| `packages/goal/tool-goal/README.md:77` | **Same-condition blocking remains model judgment** — the runtime enforces distinct admitted-round count, not semantic equivalence of obstacles; **an independent evaluator is deferred.** |
| `packages/workflow/tool-ralph/README.md:88` | **Completion is worker self-declaration** — there is **no independent evaluator or verifier** deciding whether the objective is actually complete; evaluator policy and evaluator-driven continuation are deferred. |
| `packages/goal/goal/README.md:56` | **No independent evaluator** — the caller that records completion or blocking is authoritative; evaluator-backed certification is deferred to a separate policy layer. |

dsh 全仓库只有三处非主循环的 LLM 调用（`grep -rn "llm\.stream("`）：
主循环本身（`packages/core/agent-loop/src/agent.ts:346`）、
压缩（`packages/compaction/compaction-basic/src/summarizer.ts:164`）、
会话标题（`packages/session/session-title-llm/src/index.ts:272`）。**没有一处判定进展。**

而且 dsh 的压缩是**主上下文克隆**，不是独立请求 —— 这是刻意的
（`packages/compaction/compaction-basic/src/summarizer.ts:24`）：

> The summarization directive, delivered as the FINAL user message after the replayed conversation
> rather than as a distinct summarizer system prompt. **Keeping the conversation's own system prompt,
> tools, and message prefix in front of it** makes the auxiliary call a genuine prefix of the last
> routed request, so the provider's KV cache is reused instead of invalidated.

按本文定义，它继承主 agent 全部身份和历史，**不算第三方**。

`tool-ralph` 甚至把这一点写进了给人看的渲染层（`README.md:13`）：

> completion and blocker labels in its Native renderer explicitly say that **a worker reported the
> outcome, not independent certification**.

### 3.0 CC 的 Advisor 工具 —— 四家里唯一一个「我是不是卡住了」的 LLM 判官

这是本次调研里**最接近正面答案的东西**，必须完整抄出来。
`cli-strings.txt:528591-528601` 全文：

```
# Advisor Tool
You have access to an `advisor` tool backed by a stronger reviewer model. It takes NO parameters --
when you call advisor(), your entire conversation history is automatically forwarded. They see the
task, every tool call you've made, every result you've seen.
Call advisor BEFORE substantive work -- before writing, before committing to an interpretation,
before building on an assumption. If the task requires orientation first (finding files, fetching a
source, seeing what's there), do that, then call advisor. Orientation is not substantive work.
Writing, editing, and declaring an answer are.
Also call advisor:
- When you believe the task is complete. …
- When stuck -- errors recurring, approach not converging, results that don't fit.
- When considering a change of approach.
On tasks longer than a few steps, call advisor at least once before committing to an approach and
once before declaring done. …
Give the advice serious weight. If you follow a step and it fails empirically, or you have
primary-source evidence that contradicts a specific claim (the file says X, the paper states Y),
adapt. A passing self-test is not evidence the advice is wrong -- it's evidence your test doesn't
check what the advice is checking.
If you've already retrieved data pointing one way and the advisor points another: don't silently
switch. Surface the conflict in one more advisor call -- "I found X, you suggest Y, which constraint
breaks the tie?" …
```

**`- When stuck -- errors recurring, approach not converging, results that don't fit.`
是四家所有 prompt 里唯一一句把「结果对不上」列为求助条件的。**
`results that don't fit` 精确描述了校准用例：11 次 grep 全是文学引用。

**但四条限定，每一条都致命：**

| 限定 | 证据 |
|---|---|
| **模型主动调用，引擎从不调** | 无任何引擎路径调用它 |
| **默认关** | `Qhe()` 要求 firstParty + `it("tengu_sage_compass2",{}).enabled ?? false`，或 `CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL=1`；`CLAUDE_CODE_DISABLE_ADVISOR_TOOL` 可杀（`:532064`、`:532111`） |
| **是主上下文的克隆，不是第三方** | 工具描述自己写着 `your entire conversation history is automatically forwarded` |
| **要求更强的模型且要额外计费** | `:581814` `{m} cannot advise {n} (advisor must be at least as capable as the base model)`；`:528590` `Fable 5 as the advisor bills to usage credits` |

按本文第七题的定义，**Advisor 不构成第三方视角** —— 它继承主 agent 的全部历史，
因此也继承「我翻遍了，我的记忆是垃圾」这段自我叙事。
它是一个**更强的模型看同一份卷宗**，不是一个**不知道你是谁的人重看这道题**。

### 3.1 codex：有两个真正独立的 LLM 判官，但都不判进展

codex 是四家里唯一有**上下文独立的 LLM 判官**的：

| 判官 | 判什么 | 上下文 | 触发 |
|---|---|---|---|
| **Guardian** `codex-rs/core/src/guardian/` | 单个待执行动作的**安全风险** | **独立**：自己的 `base_instructions`、空历史 | 引擎自动，每个需批准的动作 |
| **Review** `codex-rs/core/src/tasks/review.rs` | 一份 **git diff** 的正确性 | **独立**：`base_instructions = REVIEW_PROMPT`、`initial_history: None` | **只有人**能触发（`/review`），模型没有对应工具 |

Guardian 的独立性是显式配置出来的（`core/src/guardian/review_session.rs:1387-1406`）：

```rust
guardian_config.include_skill_instructions = false;
guardian_config.memories.use_memories = false;
guardian_config.base_instructions = Some(guardian_policy_prompt_with_config_and_template(...));
guardian_config.base_instructions_provenance = Some(BaseInstructionsProvenance::Custom);
guardian_config.developer_instructions = None;
```

它的开场白（`core/src/guardian/policy_template.md:1-3`）：

> You are judging one planned coding-agent action.
> Assess the exact action's intrinsic risk and whether the transcript authorizes its target and side effects.

它**会读主 transcript，但当作不可信证据**（`core/src/guardian/prompt.rs:181`），且封顶
`GUARDIAN_MAX_MESSAGE_TRANSCRIPT_TOKENS: usize = 10_000`（`core/src/guardian/mod.rs:62`）。
它甚至有一个和「跑偏」擦边的概念（`policy_template.md:19`）：

> `unknown`: there is no evidence the user authorized the action… The action comes from
> **assistant drift** or untrusted content.

**但它的判决只有 `allow` / `deny`** —— 它判的是「这个动作该不该做」，
不是「你这 11 次搜索有没有推进目标」。

另外，**codex 的 hook 机制托不了 LLM 判官**：`protocol/src/protocol.rs:1526-1531` 声明了
`HookHandlerType::{Command, McpTool, Prompt, Agent}` 四种，但
`hooks/src/engine/discovery.rs:626-645` 把两种能跑 LLM 的直接拒了：

> `"skipping prompt hook in {}: prompt hooks are not supported yet"` /
> `"skipping agent hook in {}: agent hooks are not supported yet"`

`core-plugins/` 和 `plugin/` 里**一次 LLM 调用都没有** —— 它们是市场/安装/manifest 基础设施，
plugin 只能贡献 `skills` / `mcp_servers` / `apps` / `hooks`（`plugin/src/manifest.rs:19-24`）。

### 3.2 pi：第二次 LLM 调用确实是「独立小请求」，但它是压缩不是判定

pi 全仓库只有四个 LLM 调用点：主 turn（`packages/agent/src/agent-loop.ts:308`）、
压缩摘要（`harness/compaction/compaction.ts:570`）、超长单 turn 前缀摘要（`:824`）、
分支摘要（`harness/compaction/branch-summarization.ts:249`）。

后三个是**独立小请求，不是主 agent 上下文的克隆** —— 这一点在
`branch-summarization.ts:240-256` 看得很清楚：一条全新的单 user message，
带序列化后的 transcript，**没有主 agent 的 system prompt、没有工具、没有身份**，输出封顶 2048 token：

```ts
const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${instructions}`;
const summarizationMessages = [ { role: "user" as const, content: [{ type: "text" as const, text: promptText }], ... } ];
const response = await completeSimpleWithRetries(
    models, model,
    { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
    { signal, maxTokens: 2048 },
```

`packages/coding-agent/docs/compaction.md:25` 确认隔离是有意的：

> Compaction and branch-summary requests use **fresh routing session IDs** and, where supported by the
> provider, disable prompt-cache writes because these one-off prompts are unlikely to be reused.

**但它被明确禁止做判断** —— `compaction.ts:424` 的 system prompt：

```
You are a context summarization assistant. Your task is to read a conversation between a user and an
AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation.
ONLY output the structured summary.
```

pi 里最接近「进展账」的东西是压缩模板里的一个槽位（`coding-agent/src/core/compaction/compaction.ts:479-486`）：

```
## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]
```

它是**压缩时被动写下的描述**，从来不是**触发条件**。

### 3.3 小结

**克隆上下文 vs 独立请求**：这个区分在「判定是否卡住」这件事上**没有对象可分** ——
因为没有任何一家跑这样的第二次 LLM 调用。
各家确实有第二次 LLM 调用，但任务是**压缩历史**（pi 三处、dsh compaction、CC compaction）
或**执行委派的活**（subagent），不是**评判主 agent 有没有进展**。

---

## 四、问题 3：工具返回契约里怎么表达「有输出但没用」

**结论：四家都表达不了。** 返回契约只区分 **0 命中** 和 **非 0 命中**，
而且 **0 命中被明确定义为「成功」**，不是失败。

### 4.1 dsh —— 唯一带命中计数头的

`packages/fs/tool-fs-search/src/grep.ts:216-226`：

```ts
export function formatGrepOutput(retained: RetainedItems<GrepMatch>, spillRef: SpillRef | undefined): string {
  const header = retained.truncated
    ? `Found ${retained.kept} of ${retained.seen} matches`
    : `Found ${retained.seen} ${matchNoun(retained.seen)}`
  const body = formatGrepMatches(retained.items)
  if (!retained.truncated) return `${header}\n\n${body}`
  const recovery = spillRef !== undefined
    ? `Full grep result stored at: ${spillRef.locator}. ${spillRef.retrievalHint}`
    : 'The complete result could not be saved; narrow pattern, path, or include to see more.'
  return `${header}\n\n${body}\n\n(${recovery})`
}
```

零命中 `grep.ts:230`：`if (retained.seen === 0) return 'No matches found'`；
glob 零命中 `glob.ts:233`：`if (paths.length === 0) return 'No files found'`。

关键在注释 —— `grep.ts:210`：

> The omitted count is a budget fact: **the search itself completed.**

以及 `packages/fs/tool-fs-search/src/presentation.ts:183`：

> zero-match grep is a **legitimate result** a UI shows as "no matches", **not an** [error]

即：dsh 有 `Found 47 matches` 这个数字，但 47 条全是文学噪音和 47 条全是正确答案，
**在返回契约里是同一个形状**。截断也被框定成「预算事实」而不是「你可能漏了东西」。

### 4.2 pi —— 有行内截断提示，但**结构化元信息模型看不到**

零命中字符串：

| 工具 | 文件:行号 | 返回原文 |
|---|---|---|
| grep | `packages/coding-agent/src/core/tools/grep.ts:316` | `resolve({ content: [{ type: "text", text: "No matches found" }], details: undefined }),` |
| find | `find.ts:189` / `:314` | `content: [{ type: "text", text: "No files found matching pattern" }],` |
| ls | `ls.ts:181` | `resolve({ content: [{ type: "text", text: "(empty directory)" }], details: undefined });` |
| bash | `bash.ts:409` | `const formatOutput = (snapshot: ..., emptyText = "(no output)") => {` |

pi 在这一层比 dsh 之外的两家都做得细：截断会拼一条**可操作**的行内提示。
`packages/coding-agent/src/core/tools/grep.ts:342-361`：

```ts
const details: GrepToolDetails = {};
// Build actionable notices for truncation and match limits.
const notices: string[] = [];
if (matchLimitReached) {
    notices.push(
        `${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
    );
    details.matchLimitReached = effectiveLimit;
}
...
if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;
```

`read.ts:296-313` 同理，甚至会直接给出 bash 兜底命令：
`` `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${path} | head -c ${DEFAULT_MAX_BYTES}]` ``

**但结构化的 `details` 对象（`truncated` / `truncatedBy` / `totalLines` / `totalBytes` /
`matchLimitReached` / `linesTruncated`，定义在 `tools/truncate.ts:15-38`）在 provider 序列化时被丢掉。**
`packages/ai/src/api/anthropic-messages.ts:1138-1143`：

```ts
toolResult: {
    type: "tool_result",
    tool_use_id: msg.toolCallId,
    content: references.length > 0 ? references : convertedContent,
    is_error: msg.isError,
},
```

`details` 只被 TUI 渲染器消费（`grep.ts:115-124` 给人画一行红色的
`[Truncated: 100 matches limit, 50.0KB limit, some lines truncated]`）。
**人看得到结构化的截断状态，模型只看得到行内那串 `[...]`。**

**最关键的一点：pi 的 grep 成功返回里没有命中计数。**
87 条命中和 3 条命中在模型眼里除了行数不同，形状完全一样 ——
没有相关性评分，没有「这些全来自同一个文件」，没有「你上 3 个 pattern 的结果高度重叠」。

### 4.3 codex —— 模型侧最贫瘠，而且这正是失效隐形的机制

**codex 根本没有 grep 工具、没有 read 工具、没有 search 工具。** 模型靠 `exec_command` 自己 shell 出去跑 `rg`。
（`codex-file-search` 不是 `core` 的依赖，它只驱动 TUI 的 `@` 补全；
`file-search/src/lib.rs:283-289` 那套 `matches_truncated` 标记模型看不到。）

模型看到的完整信封就这么点（`codex-rs/core/src/tools/context.rs:455-479`）：

```rust
fn response_header(&self) -> String {
    let mut sections = Vec::new();
    if !self.chunk_id.is_empty() { sections.push(format!("Chunk ID: {}", self.chunk_id)); }
    let wall_time_seconds = self.wall_time.as_secs_f64();
    sections.push(format!("Wall time: {wall_time_seconds:.4} seconds"));
    if let Some(exit_code) = self.exit_code { sections.push(format!("Process exited with code {exit_code}")); }
    ...
    sections.push("Output:".to_string());
    sections.join("\n")
}
```

所以 `rg "best friend"` 零命中返回的**字面**是：

```
Wall time: 0.0123 seconds
Process exited with code 1
Output:
```

而 `rg` 返回 8000 字符文学引用，返回的是**同样的头 + 8000 字符**。
**没有命中数、没有 "no matches found"、没有相关性、没有任何累积信号。**
（`no output` / `No output` / `(no output)` / `empty output` / `produced no` 在
`core/src`、`exec/src`、`utils` 里全部零命中。）

只有截断会多出一句话：
`core/src/unified_exec/mod.rs:216`（`format!("... {omitted_bytes} bytes omitted ...")`）、
`core/src/tools/context.rs:450`（`"Warning: truncated output (original token count: {original_token_count})..."`）。
默认模型输出预算 `core/src/unified_exec/mod.rs:74`：`pub(crate) const DEFAULT_MAX_OUTPUT_TOKENS: usize = 10_000;`。

连已经算出来的分数都会被丢掉 —— `core/src/tools/handlers/tool_search.rs:239`
`.map(|result| result.document.id)`，BM25 的 `result.score` 直接扔了。

### 4.4 CC —— 有命中计数，但同样只区分 0 与非 0

Grep 工具描述（`cli-strings.txt:561468` 起）：

```
A powerful search tool built on ripgrep
  Usage:
  - ALWAYS use [Grep] for search tasks. NEVER invoke `grep` or `rg` as a [Bash] command. The [Grep]
    tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\s+\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default),
    "count" shows match counts
  - Use [Task] tool (if available) for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping …
  - Multiline matching: By default patterns match within single lines only …
```

结果格式（`cli-strings.txt:883155` 附近，同一压缩行内）：

```js
`Found ${m} total ${m===1?"occurrence":"occurrences"} across ${h} ${h===1?"file":"files"}.${f?` with pagination = ${f}`:""}`
…
content: c&&(s??0)>0 ? `No entries at this offset. [Showing results with pagination = ${d}]` : "No files found"
…
`Found ${t} ${At(t,"file")}${d?` ${d}`:""}`
```

零命中串在 `:612042`、`:763676`、`:784845`（`No matches found`）和
`:763614`、`:763689`（`No files found`）。

**所以 CC 和 dsh 一样有 `Found N`，也和 dsh 一样：N 是命中数，不是相关度。**
`Found 47 occurrences across 12 files` 里 47 条全是文学噪音，和 47 条全是答案，
返回结构完全一样。

#### 零命中被**刻意**设计成「不是错误」

Bash 里跑 grep 时的退出码映射（`cli-strings.txt:881289` 附近）：

```js
gAt=(e)=>(t,r,n)=>({isError: t>=2, message: t===1 ? e : void 0}),
YBw=new Map([["grep",gAt("No matches found")],["rg",gAt("No matches found")],
             ["egrep",…],["fgrep",…],
             ["find",gAt("Some directories were inaccessible")],
             ["diff",gAt("Files differ")],
             ["test",gAt("Condition is false")],["[",gAt("Condition is false")]])
```

**退出码 1 → `isError:false`，附一句 `"No matches found"`。**
这是有意的：搜不到读作**信息**，不读作**失败**。
对本文的问题来说，这个设计正好把「我找过了没有」和「我找错地方了」压成了同一件事。

#### CC 有一条别家都没有的东西：**局部视图守卫**

`cli-strings.txt:613057-613066`（模板在 `:896982`，前缀常量 `nyt="[Truncated: PARTIAL view — "`）：

```
[Truncated: PARTIAL view — {file}: showing lines 1-{N} of {M} total ({tokens} tokens, cap {cap}).
Call Read with offset={N+1} limit={N} for the next page, or Grep to find a specific section.
Do NOT answer from this page alone if the answer may be further in the file.]

[Truncated: PARTIAL view — {file}: showing the first {n} of {m} characters …; this file has very
long lines and cannot be paginated by line. Use Grep to find a specific section, or Read with
offset/limit to page through it.
Do NOT answer from this excerpt alone if the answer may be elsewhere in the file.]
```

每轮重新注入的变体（`cli-strings.txt:623839-623841`，包在 `<system-reminder>` 里，`:623835`）：

```
[Truncated: PARTIAL view — {file}: showing {n} of {total} lines. Call Read with offset/limit to
page through. Do NOT answer from this page alone if the answer may be further in the file.]
[Truncated: PARTIAL view — {file}: this view is incomplete and the file cannot be paginated by line.
Do NOT answer from this view alone if the answer may be elsewhere in the file.]
```

**`Do NOT answer from this page alone if the answer may be further in the file.`
是整份调研里唯一一句写进运行时、直接对抗「我看过了，没有」的话。**

限定：**它只挂在被截断的 Read 上。**
grep 返回 8000 字符噪音时不会出现，glob 返回 200 个无关路径时不会出现。
它防的是「只看了文件的第一页就下结论」，防不了「只用错了的关键词搜了 11 次就下结论」。

其它同族的零/空结果提示（`:881289` 附近）：

```
<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>
<system-reminder>Warning: the file exists but is shorter than the provided offset ({startLine}).
The file has {totalLines} lines.</system-reminder>
```

### 4.5 四家共同的结构性缺口

没有任何一家的搜索/读取工具返回里包含：

- 与**当前目标**的相关性评分（`grep -rn "relevanceScore\|relevance_score"` 四家零命中）
- 信息增量 / 新颖度（`informationGain` / `novelty` 四家零命中）
- 「这批结果和你上一批高度重叠」的提示

也就是说：**「grep 到 8000 字符噪音」和「grep 到答案」在工具层是同一个成功码。**

---

## 五、问题 4：换一条路的原语

| 家 | 原语 | 触发方 | 是否继承主上下文 |
|---|---|---|---|
| dsh | `ralph` 工具 | **模型主动调用** | **否**（明确不继承） |
| dsh | `subagent`（fresh） / `subagent_fork`（继承） / `workflow` | 模型主动调用 | fresh 不继承 / fork **继承全部已完成轮次** |
| dsh | goal `update_goal(action=blocked/pause)` | 模型主动，但被引擎门控 | 同 session |
| pi | session 树 `/fork` `/clone` `/tree` | **只有人**（TUI / RPC / 扩展作者），模型无对应工具 | 否（分支独立） |
| codex | `spawn_agent` / `new_context` / `update_plan` / `update_goal(blocked)` | 模型主动调用 | `spawn_agent` 默认 `fork_turns="all"` = **克隆** |
| CC | `Task` 子 agent | 模型主动调用 | 否（冷启动） |

### 5.1 dsh `ralph` —— 四家里唯一「不带自我叙事重来一次」的原语

`packages/workflow/tool-ralph/README.md:9`：

> Every Ralph round starts one child through `subagentProvider`; that provider must exist,
> support structured output, and report **`inheritsParentContext: false`**.

`README.md:11`：

> Each child receives **only** the immutable objective, its current Ralph round and cap, a
> shared-workspace-as-authority instruction, and the previous structured handoff. The workspace is
> long-term memory; **parent conversation and prior child sessions are not seeded.**

这一条在校准用例里是**有意义的**：新 child 不会继承「我翻遍了，我的记忆是垃圾」这段自我归因，
它拿到的只有 objective + 上一轮的结构化 handoff。

给模型的路由 prompt `README.md:47`：

```
Use the ralph tool ONLY when the direct human explicitly asks for a Ralph loop or fresh-agent
iterative execution. Each Ralph round starts a fresh child with no conversation seed and uses the
shared workspace as durable memory. Completion and blockers are worker reports, not independent
evaluation. Use same-session goal tools for ordinary long-running objectives, and plain subagents
or workflowEngine for bounded delegation and fan-out.
```

**注意 `ONLY when the direct human explicitly asks`** —— 这条路**默认走不到**，
必须由人**显式点名**才会启用。它不是引擎在检测到卡住时自动拉的闸。

每个 child 收到的固定脚本（`packages/workflow/tool-ralph/src/index.ts:155`）：

```
'You are one fresh worker in a foreground Ralph loop. You receive no parent conversation and no prior child session. Do not call the ralph tool: this round already is its worker.',
'Immutable objective:\n' + args.objective,
'Ralph round: ' + round + ' of ' + args.maxRounds + '.',
'The shared workspace and its current working tree are the long-term memory and source of truth. Inspect them before acting, preserve existing work, perform concrete in-scope work, and verify what you change. Treat the previous report only as a bounded handoff; confirm it against the workspace.',
'Previous structured handoff:\n' + prior,
'Return one report with exact normalized strings. Use status continue with at least one nextSteps entry while useful work remains; complete only with concrete evidence and no nextSteps; blocked only when no meaningful progress is possible without human input or an external-state change. blocker must be empty unless blocked.',
```

最后一句里的 `blocked only when no meaningful progress is possible` 是**语义约束**，
**没有任何引擎侧的东西去核验它** —— 与 goal 那条 `blockedAfterConsecutiveRounds` 不同，
Ralph 这里连轮次门都没有。

**失败路径怎么处理**：`README.md:15` —— 「An ordinary child failure produces an error naming the failed
round and retaining the last successful handoff when one exists. **Ralph does not retry that round.**」
即：失败路径**不被标记也不被丢弃**，整个 run 直接终止（`README.md:92`：
"Ordinary child failure is terminal for the run"）。

### 5.1b pi —— 有真树，但模型摸不到

pi 的 session 是真正的树（`README.md:238`）：

> Sessions are stored as JSONL files with a tree structure. Each entry has an `id` and `parentId`,
> **enabling in-place branching without creating new files.**

**但模型没有任何分支工具。** 内置工具表就这七个（`packages/coding-agent/src/core/tools/index.ts:83-84`）：

```ts
export type ToolName = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls";
export const allToolNames: Set<ToolName> = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);
```

`navigateTree` / `fork` 的所有调用方都是人机入口：TUI 的 `/tree` `/fork` `/clone`
（`modes/interactive/interactive-mode.ts:1917,1927,5126,5156,5250`）、
外部 RPC（`modes/rpc/rpc-mode.ts:326,329,610,622`）、扩展作者（`core/extensions/runner.ts:777`）。

分支摘要的开场白直接写明了动作的主语（`harness/compaction/branch-summarization.ts:173-176`）：

```
The user explored a different conversation branch before returning here.
Summary of that exploration:
```

**死分支不被丢弃也不被打分**：全部留在 JSONL 里（`README.md:257`：All history preserved in a single file），
标记方式只有人手动打书签（`README.md:264`：Press Shift+L to label entries as bookmarks）。
`packages/session-backends` 里唯一的 `score` 是给人搜历史用的 BM25
（`sqlite-node/src/sqlite/search-backend.ts:154`：`bm25(session_search_fts) AS score`），**不给分支打分**。

### 5.2 codex —— 原语齐全，但**「换个角度重看」这条路被 prompt 明令禁止**

工具注册在 `codex-rs/core/src/tools/spec_plan.rs:21`（`NewContextWindowHandler`）、
`:38`（`SpawnAgentHandler`）、`:49`（v2 `SpawnAgentHandler`）。
`new_context` 配合 `notes` / `history`（`models.json:82` 的 guidance）构成一条
「丢掉当前窗口、带 checkpoint 重来」的路 —— 但触发方是**模型自己**或 **token 耗尽**，
不是「检测到没进展」。

**`update_plan` 表达不了「这条路失败了」。** 状态枚举只有三个
（`codex-rs/protocol/src/plan_tool.rs:9-13`）：

```rust
pub enum StepStatus {
    Pending,
    InProgress,
    Completed,
}
```

**没有 `failed`、没有 `abandoned`、没有 `revised`。** plan 每次整份替换，
handler 不持久化任何东西（`core/src/tools/handlers/plan.rs:91-95`，返回常量 `"Plan updated"`），
而且没有任何东西强制它更新（`core/src/client.rs:951`：`tool_choice: "auto".to_string(),`）。

**更关键的是：「起一个子 agent 换个角度看看」这个动作被 prompt 明令禁止**
（`core/src/tools/handlers/multi_agents_spec.rs:714-715`）：

> Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly ask
> for sub-agents, delegation, or parallel agent work.
> **Requests for depth, thoroughness, research, investigation, or detailed codebase analysis do not
> count as permission to spawn.**

而且 `Feature::MultiAgentV2` 默认关（`features/src/lib.rs:1129-1132`），
即便开了，子 agent 默认 `fork_turns="all"`（`multi_agents_spec.rs:649`）——
**是上下文克隆，不是新视角。**

codex 里最接近「换个方法」的一句在 skill 目录里（`ext/skills/src/catalog_prompt.rs:23`）：

> Safety and fallback: **If a skill can't be applied cleanly (missing files, unclear instructions),
> state the issue, pick the next-best approach, and continue.**

但它的作用域是「技能文件读不了」—— **执行失败，不是业务无产出**。

### 5.2b CC `TodoWrite` —— 和 codex `update_plan` 一样，没有「失败」状态

`cli-strings.txt:529265`：

> - Each todo has `content`, `status` (**"pending" | "in_progress" | "completed"**), and `activeForm`
>   (present-tense label shown while in progress).

**三个状态，和 codex `update_plan` 一模一样，同样没有 `failed` / `blocked` / `abandoned`。**

所以在 CC 和 codex 里，「我 grep 了 11 轮，这条路走不通」这件事
**在任务清单这个数据结构里没有位置可以写**。它只能消失在 assistant 的散文里。

**但 CC 的 TodoWrite 描述里有一段完成契约，直接命中校准用例**
（`cli-strings.txt:778946-778952`）：

```
3. **Task Completion Requirements**:
   - ONLY mark a task as completed when you have FULLY accomplished it
   - If you encounter errors, blockers, or cannot finish, keep the task as in_progress
   - When blocked, create a new task describing what needs to be resolved
   - Never mark a task as completed if:
     - Tests are failing
     - Implementation is partial
     - You encountered unresolved errors
     - **You couldn't find necessary files or dependencies**
```

最后一条**明确禁止**「我找不到，所以这条算完成了」——
这正是校准用例里发生的事（「我翻了所有能翻的地方，找不到」然后收尾）。

限定：它只在模型**已经建了 todo list** 时才有约束力，而 TodoWrite 的门槛是
「≥3 个不同步骤」。**一个「帮我想想我最好的朋友是谁」的问题不会触发建表。**

同族的换路指令（都在**执行失败**语境下，不是业务无产出）：

| 位置 | 原文 |
|---|---|
| `:529802` | Permission for this tool use was denied… **Try a different approach** or report the limitation to complete your task. |
| `:529813` | If it keeps failing, **continue with other tasks that don't require this action and come back to it later.** |
| `:627288` | If the user denies a tool you call, **do not re-attempt the exact same tool call.** Instead, think about why the user has denied the tool call and adjust your approach. |
| `:881861` | When a worker reports failure…: Continue the same worker with {SendMessage}… **If a correction attempt fails, try a different approach** or report to the user |
| `:881864` | Use {TaskStop} to stop a worker you sent in the wrong direction — for example, when you realize mid-flight that the approach is wrong… |

**五条全部由「工具报错 / 被拒绝 / worker 失败」触发。没有一条由「搜到了但没用」触发。**

### 5.3 CC `Task`

`cli-strings.txt:599385`：

> Launch a new agent to handle complex, multi-step tasks. Each agent type has specific capabilities
> and tools available to it.

某些计划档位下还有反向压制（`cli-strings.txt:894514`）：

> **Do not spawn agents unless the user asks.** Each spawn **starts cold and re-derives context you
> already have** — it's the expensive path on this plan. A task with "multiple angles," "thorough,"
> or several parts is not a request to spawn; handle it inline with your own tools.

「starts cold」正面确认了子 agent **不继承主上下文**，但同一段话是在**劝阻**使用它。

---

## 六、问题 5：深度/复杂度判定

四家用的都是**任务形状 + prompt 文字描述**，**没有一家做成本路由或显式分类器**。

### 6.1 codex —— `update_plan` 的「什么算复杂」

`codex-rs/core/gpt_5_2_prompt.md:38-40`（同文本亦见 `gpt_5_1_prompt.md`）：

> You have access to an `update_plan` tool which tracks steps and progress and renders them to the
> user. Using the tool helps demonstrate that you've understood the task and convey how you're
> approaching it. Plans can help to make complex, ambiguous, or multi-phase work clearer and more
> collaborative for the user. A good plan should break the task into meaningful, logically ordered
> steps that are easy to verify as you go.
>
> Note that plans are not for padding out simple work with filler steps or stating the obvious. The
> content of your plan should not involve doing anything that you aren't capable of doing (i.e.
> don't try to test things that you can't test). **Do not use plans for simple or single-step queries
> that you can just do or answer immediately.**

`codex-rs/protocol/src/prompts/base_instructions/default.md:121`：

> If you need to write a plan, only write high quality plans, not low quality ones.

`default.md:62-70` 给了完整的判据清单：

> Use a plan when:
> - The task is non-trivial and will require multiple actions over a long time horizon.
> - There are logical phases or dependencies where sequencing matters.
> - The work has ambiguity that benefits from outlining high-level goals.
> - You want intermediate checkpoints for feedback and validation.
> - When the user asked you to do more than one thing in a single prompt
> - The user has asked you to use the plan tool (aka "TODOs")
> - You generate additional steps while working, and plan to do them before yielding to the user

codex 版模型的 prompt 甚至给了个百分位（`codex-rs/core/gpt-5.2-codex_prompt.md:23-26`）：

> When using the planning tool:
> - **Skip using the planning tool for straightforward tasks (roughly the easiest 25%).**
> - Do not make single-step plans.
> - When you made a plan, update it after having performed one of the sub-tasks that you shared on the plan.

判定信号是**任务形状**（多阶段 / 模糊 / 需要验证），不是成本，也不是分类器输出。
`ReasoningEffort`（`protocol/src/openai_models.rs:50-62`）是**人/配置**设的，模型自己改不了
（只有在 `expose_spawn_agent_model_overrides` 开着时才能给 spawn 出来的子 agent 指定 effort，
而那个开关挂在默认关的 multi-agent 特性上）。

**唯一一句关于中途改路线的话**（`codex-rs/core/gpt_5_2_prompt.md:46`）：

> Maintain statuses in the tool: exactly one item in_progress at a time; … **Scope pivots: if
> understanding changes** (split/merge/reorder items), update the plan before continuing. Do not let
> the plan go stale while coding.

注意触发条件是「**如果**理解变了」。**没有任何东西告诉模型去检查它的理解是不是该变。**

### 6.2 dsh —— goal 的门槛

`packages/goal/tool-goal/README.md:49`：

> Use goal tools for one long-running completion objective in the current session. `create_goal` may
> infer goal intent from a direct human request in any language; **do not create a goal for routine
> single-turn work.**

限制条款 `README.md:76` 承认这是纯模型判断：

> **Semantic intent remains model judgment** — execution can prove that the current turn contains a
> direct human message, **not whether the request is substantial enough to merit a goal.**

同类的形状描述还有几条，全部是「任务形状」判据，没有代价信号也没有分类器：

`todo_write`（`docs/tool-catalog.md:2033`）：

> Record and update a structured task list for the current work. … Use it to plan multi-step work and
> show progress: add one todo per concrete step before you start. … **Skip the list for trivial
> single-step tasks.**

`subagent`（`packages/subagent/tool-subagent/src/index.ts:235`）：

> Delegate a self-contained task to a subagent (a separate agent that works in its own context) to
> offload focused, independent work — research, a scoped implementation, an analysis — so it does not
> consume this conversation's context. The subagent returns its result, not its intermediate steps.
> **Give it a complete, standalone prompt: it does not see this conversation.**

`subagent_fork`（同文件 `:222`）：

> Delegate a task to a subagent that **inherits this conversation**: a child agent seeded with all
> completed turns so far (it does not see the current in-flight turn).

**注意这两个的区别正好是本文关心的那条线**：`subagent` 不继承（但拿到的 prompt 是主 agent 自己写的，
自我认知照样传染），`subagent_fork` 完全继承。

出货 persona 里**没有任何**深浅路由或「换思路」文本 —— base bundle 是 `persona: ''`
（`packages/bundle/base/cordis.patch.yml:432`），CLI standard preset 全文就一句
（`apps/cli/config/agent-presets/standard/agent.cordis.yml:27`）：

> You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.

### 6.3 CC —— breadth 分级

`cli-strings.txt:882563` 的 `Explore` agent `whenToUse`：

> Fast read-only search agent for locating code. Use it to find files by pattern … **Do NOT use it for
> code review, design-doc auditing, cross-file consistency checks, or open-ended analysis** — it reads
> excerpts rather than whole files and will miss content past its read window. When calling, specify
> search breadth: **"quick" for a single targeted lookup, "medium" for moderate exploration, or
> "very thorough" to search across multiple locations and naming conventions.**

`general-purpose` agent 的 `whenToUse`（`cli-strings.txt:753681`，定义处 `:882575`）：

> General-purpose agent for researching complex questions, searching for code, and executing
> multi-step tasks. **When you are searching for a keyword or file and are not confident that you will
> find the right match in the first few tries**, use this agent to perform the search for you.

这是四家里唯一把「**你可能一次找不到**」写进路由条件的一句。

Grep 工具描述里还有一条同向的（`cli-strings.txt:561468` 起）：

> - Use [Task] tool (if available) **for open-ended searches requiring multiple rounds**

`TodoWrite` 的判据是**四家里最具体的**，给了个数字（`cli-strings.txt:778818` 起）：

```
## When to Use This Tool
Use this tool proactively in these scenarios:
1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
…
## When NOT to Use This Tool
Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational
```

四家的复杂度判据放一起看：

| 家 | 判据 | 位置 |
|---|---|---|
| CC | **≥3 个不同步骤** | `cli-strings.txt:778818` |
| codex | **最简单的 25% 跳过 plan** | `core/gpt-5.2-codex_prompt.md:24` |
| dsh | 「不要给 routine single-turn work 建 goal」/「trivial single-step 跳过清单」 | `tool-goal/README.md:49`、`docs/tool-catalog.md:2033` |
| pi | **无** | grep/find/ls 的 `guidelines: []` |

**四家全是「任务形状」判据，没有一家用成本、没有一家用分类器。**

**注意这两条都是「事前」路由**：它们让模型在**开始搜之前**判断这活值不值得委派。

#### CC 有一条**带数字的**升级阈值 —— 四家里唯一一条

`cli-strings.txt:882563`：`var Guf=3`。用在 session 指导里（`cli-strings.txt:899597`）：

```js
`For broad codebase exploration or research that'll take more than ${Guf} queries,
 spawn ${Li} with subagent_type=${ert.agentType}. Otherwise use ${l} directly.`
```

即模型看到的是：

> For broad codebase exploration or research that'll take **more than 3 queries**, spawn **Task** with
> subagent_type=**Explore**. Otherwise use Glob/Grep directly.

**这是四家里唯一一条量化的「查到第 N 次就别自己查了，换个打法」规则。**

限定两条：
① 门控条件是 `!isSubagent && hasTask && pQ()==="default" && !forkAvailable`（同行），
所以在子 agent 内、或 fork 可用时**不下发**；
② 它仍然是**事前估计**（"research that'll take more than 3 queries"），
不是**事后计数** —— 没有任何东西在第 4 次 grep 时数到 4 然后提醒。

**四家里没有任何一条是「事后」的** —— 搜了 11 轮之后没有任何东西回来说「这条路不行，换个方式」。

### 6.4 pi —— 未找到，而且 grep/find/ls 的 guidelines 是空的

pi 的默认 system prompt 全文在 `packages/coding-agent/src/core/system-prompt.ts:121-138`。
能被拼进去的 guideline 就这几条：

| 来源 | 原文 |
|---|---|
| `system-prompt.ts:116` | `"Be concise in your responses"` |
| `system-prompt.ts:117` | `"Show file paths clearly when working with files"` |
| `tools/read.ts:29` | `"Use read to examine files instead of cat or sed."` |
| `tools/write.ts:22` | `"Use write only for new files or complete rewrites."` |
| **`tools/grep.ts:40`、`find.ts:39`、`ls.ts:21`** | **`guidelines: []` —— 空的** |

**关于搜索策略、什么时候该枚举而不是过滤、什么时候该换路子、搜不到有用东西怎么办 —— 一个字都没有。**

唯一的路由机制是 skill，按**任务类型匹配**而不是深度（`core/skills.ts:362-368`）：

> Use the read tool to load a skill's file **when the task matches its description.**

有意思的是，**仓库里唯一正面处理这个失效模式的一句话是 pi 自己项目的 `AGENTS.md`，不是 harness 代码**
（经 `resource-loader.ts:72` 作为 `<project_instructions>` 拼进 system prompt）：

> `AGENTS.md:17` — Read files in full before wide-ranging changes, before editing files you have not
> fully inspected, and when asked to investigate or audit. **Do not rely on search snippets for broad changes.**

这条正是校准用例需要的（「别拿 grep 片段当结论」），但它是**这个仓库的项目约定**，
不随 harness 分发。

---

## 七、问题 6：止损机制清单

| 家 | 机制 | 文件:行号 | 默认值 | 超限行为 |
|---|---|---|---|---|
| dsh | 连续同调用提醒 | `packages/guard/repeat-tool-reminder/src/index.ts:46` | `[3, 5, 8]` | **软信号**注入，永不 block（`README.md:87` 明写 block 未实现） |
| dsh | goal 轮次上限 | `packages/goal/goal/src/index.ts:187,196` | `defaultMaxGoalRounds: 256` | **硬停**：`index.ts:321-323` 抛 `goal "<id>" exhausted <N> goal rounds; increase maxGoalRounds before resuming`；驱动器侧标 blocked（`goal-round-driver/src/index.ts:166`，`code: 'round-limit'`） |
| dsh | subagent 委派深度 | `packages/subagent/tool-subagent/src/index.ts:98` | `maxDepth: 3` | errored tool result |
| dsh | workflow 子 agent 总量 | `packages/workflow/workflow-worker-thread/src/index.ts:118` | `maxTotalAgents: 1000` | 拒绝 |
| dsh | 压缩阈值 | `packages/compaction/compaction-basic/README.md` | `thresholdRatio 0.8`、`retainRatio 0.16`、`maxTokens 8192` | 自动摘要替换历史，**不通知模型** |
| dsh | 结果预剪枝 | `packages/bundle/base/cordis.patch.yml:361` | `thresholdChars 8192 / headChars 4096 / tailChars 1024` | 就地重写 |
| dsh | **turn / step 预算** | `packages/core/agent-loop/README.md:134` | **不存在**（显式声明） | — |
| dsh | goal 自封 blocked 前置门 | `packages/goal/tool-goal/README.md:33` | `blockedAfterConsecutiveRounds: 3` | **机械拒绝**模型标 blocked，直到轮次够 |
| dsh | ralph 轮次上限 | `packages/workflow/tool-ralph/README.md:30` | `maxRounds: 256` | 返回 `budget-limited` |
| dsh | ralph handoff 字节上限 | `packages/workflow/tool-ralph/README.md:31` | `maxHandoffChars: 16384` | 超限**整个 workflow 失败**（`README.md:11`：不截断、不当作 cap 耗尽） |
| dsh | 工具输出 spill | `packages/spill/README.md:5` | — | 超长输出落盘，inline 换成「有界预览 + 取回定位符」 |
| pi | **无 turn/step/重复上限** | `packages/agent/src/agent-loop.ts:170` | — | 不存在。退出只靠 abort / stopReason / 整批工具 `terminate` |
| pi | 压缩触发阈值 | `coding-agent/src/core/compaction/compaction.ts:235-238`：`return contextTokens > contextWindow - settings.reserveTokens;` | `reserveTokens: 16384`（`:133-134`）、`keepRecentTokens: 20000`（`:135`） | **摘要后继续，从不停** |
| pi | 溢出恢复次数 | `coding-agent/src/core/agent-session.ts:2090-2114` | **1** | 硬报错：`Context overflow recovery failed after one compact-and-retry attempt.` |
| pi | 单次工具输出上限 | `tools/truncate.ts:11-13` | `DEFAULT_MAX_LINES=2000`、`DEFAULT_MAX_BYTES=50*1024`、`GREP_MAX_LINE_LENGTH=500`；grep `DEFAULT_LIMIT=100`（`grep.ts:44`）、find `1000`、ls `500` | 截断 + 追加 `[...]` 提示，**loop 继续** |
| pi | bash 超时 | `tools/bash.ts:43`：`"Timeout in seconds (optional, no default timeout)"` | **无默认** | 只有模型自己传 |
| pi | 全局运行超时 | — | **不存在** | — |
| pi | **人** | `README.md:213`（Escape 两次 → `/tree`）、steering / follow-up 队列（`agent-loop.ts:167,259,263`） | — | **这才是 pi 真正的止损** |
| codex | **无 turn/step 上限** | `core/src/tasks/regular.rs:76`、`core/src/session/turn.rs:301` 都是裸 `loop {}` | — | 源码注释 `turn.rs:469`：`we shouldn't worry about being in an infinite loop` |
| codex | Guardian 连续否决 | `core/src/guardian/mod.rs:56` | `MAX_CONSECUTIVE_GUARDIAN_DENIALS_PER_TURN = 3` | **硬中断 turn，模型看不见**（`review.rs:292`） |
| codex | 自动压缩 | `protocol/src/openai_models.rs:486` | 窗口 90% | 静默压缩，loop 继续 |
| codex | token 预算提醒 | `core/src/session/token_budget.rs:84` | `reminder_threshold_tokens: 6144`（`models.json:80`）；**特性默认关** | developer 消息，**模型可见** |
| codex | rollout 预算 | `core/src/session/rollout_budget.rs:33` | 未设；**特性默认关** | `CodexErr::SessionBudgetExceeded` 硬中断 |
| codex | goal token 预算 | `state/src/runtime/goals.rs:557` | `max_goal_token_budget: None`（**无界**） | 状态转 `BudgetLimited`，注入 steering，**不中断** |
| codex | 格式化重试 | `protocol/src/prompts/base_instructions/default.md:155` | **3** | 放弃并在最终回复里说明 —— **这是 codex 所有 prompt 里唯一一个数字化的「可以放弃」阈值** |
| codex | token 预算 + 模型可查 | `core/src/tools/handlers/get_context_remaining_spec.rs:8` | 随 model 配置 | 耗尽 → **丢弃当前窗口，换新 context window**，靠 `notes`/`history` 找回（`models.json:82`） |
| codex | context 剩余百分比 | `codex-rs/tui/src/token_usage.rs:43-48` | — | 只渲染给**人**看，不进模型上下文 |
| CC | **通用重复/循环上限** | `noProgress` / `identical tool call` / `toolCallSignature` 全部零命中 | — | **不存在** |
| CC | **`Read` 重复检测** | `cli-strings.txt:881289`（`case"file_unchanged"`）、`:554995` | 同文件未改动即触发 | **模型可见软信号**：`Wasted call — file unchanged since your last Read.` |
| CC | **静默轮次提醒** | `cli-strings.txt:899209`（`foh=5,hoh=3`）、渲染 `:622015`；env `:532175-532177` | **5 轮**，每段静默最多 **3** 次 | **模型可见软信号**：`The user hasn't heard from you in a while…` |
| CC | TodoWrite 陈旧提醒 | `cli-strings.txt:899226`、`:899348` | `TURNS_SINCE_WRITE:10` | 软信号 |
| CC | 未加载工具提醒 | `cli-strings.txt:899356` | 15 轮 / 10 名 | 软信号：`Before concluding a capability is missing…` |
| CC | **autocompact 抖动断路器** | `cli-strings.txt:527532`、逻辑 `:882067` | 3 轮内回填 × 连续 3 次 | **硬中断**，`{reason:"rapid_refill_breaker"}` |
| CC | **max turns** | `:881975`/`:882789` `maxTurns:200`；`:893866` `FORKED_AGENT_DEFAULT_MAX_TURNS` = `:893868` `syl=50`；env `:532732` | **200**（agent 类型定义）/ **50**（forked 默认）；**交互式无默认** | **硬中断**：`max_turns_reached`（`:598674`）、`Reached maximum number of turns (`（`:644545`）、`Hooks: Agent turn … hit max turns, aborting`（`:625741`）。**模型看不见** |
| CC | **USD 预算** | `:598732` `maxBudgetUsd`、`:639828` `maxCostUsd`、`:681251` `reached --max-budget-usd ` | CLI `--max-budget-usd` | **硬中断**：`Error: Exceeded USD budget (`（`:680724`） |
| CC | 流停滞看门狗 | `cli-strings.txt:599336`、`:599341` | **180000 ms** | 硬中断。「no progress」= **没有 stream chunk** |
| CC | token 倒计时 attachment | `cli-strings.txt:799554`、`:899462` | 门控 `CLAUDE_CODE_ENABLE_TOKEN_USAGE_ATTACHMENT` | **模型可见**：`Token usage: {used}/{total}; {remaining} remaining` |
| CC | stop-hook 阻塞上限 | `cli-strings.txt:597351` | `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP ?? 8` | 覆盖并结束 turn |
| CC | context 低水位提示 | `cli-strings.txt:664416` 附近 | — | **给人看的状态行**，不注入模型 |
| CC | auto-compact | `cli-strings.txt:616261` | 窗口设置与模型上限取小 | 自动摘要，loop 继续 |
| CC | `attention_budget` | `cli-strings.txt:929376` 有类型，生产者 `c_E` 返回 `[]` | — | **本版本里是死代码** |

**共同点**：所有数值上限量的都是**资源**（轮次、token、字节），
没有一家的上限量的是**进展**。256 轮无产出和 256 轮有产出，触发的是同一个终止路径。

---

## 八、问题 7：第三方视角

问的是：有没有机制让一个**不共享主 agent 上下文/身份**的评审者介入。
（克隆主上下文的 fork 会继承主 agent 的自我认知和情绪状态，**不算**第三方。）

### 8.1 结论表

| 家 | 有没有「上下文全新」的第二个 agent | 它评判主 agent 吗 | 判定 |
|---|---|---|---|
| dsh | **有** —— ralph child（`inheritsParentContext: false`） | **不评判**，它是**重做**这个目标 | 半个 |
| dsh | 评审者本身 | `goal-round-driver/README.md:60`、`tool-goal/README.md:77`、`tool-ralph/README.md:88` 三处明写 **deferred** | **无** |
| pi | evals 判官（`packages/evals`） | **纯确定性函数**，且**只在 Vitest 离线跑**，碰不到运行中的 session | **无** |
| codex | **Guardian**（独立 instructions + 空历史） | 判**单个动作的安全**，只输出 allow/deny | 是第三方，但**判的不是进展** |
| codex | **Review**（`initial_history: None`） | 判 **git diff 的正确性** | 是第三方，但**只有人能触发**，模型无对应工具 |
| codex | **Memories 蒸馏**（独立 system prompt） | 从**过去的** rollout 里提炼启发式 | 是第三方，但**跨会话、事后、默认关** |
| codex | `spawn_agent` 起的子 agent | 做委派的活，且默认 `fork_turns="all"` = 克隆 | **无** |
| CC | `Task` 子 agent（`starts cold`，`cli-strings.txt:894514`） | 做委派的活 | **无** |
| CC | 内置 agent 类型全表 | `claude` / `comment-thread-analyst` / `Explore` / `general-purpose` / `main` / `main-session` / `Plan` / `statusline-setup` / `subagent` / `teammate` / `workflow-subagent` —— **没有 reviewer / critic** | **无** |
| CC | **Advisor**（`:528591`） | 判「是不是卡住 / 该不该换路」—— **正中本文主题** | **不是第三方**：`your entire conversation history is automatically forwarded` = 主上下文克隆；且模型主动调用、默认关 |
| CC | **Handoff 安全分类器**（`:599237-599243`） | **引擎自动**、独立模型、审查子 agent 的产出 | 是引擎自动的第三方，但**判的是安全策略**，对「有没有用」零概念 |

### 8.2 dsh ralph 是「重来」不是「评审」——这个区分很重要

ralph child 确实满足「不继承主 agent 自我叙事」这个条件，
在校准用例里这意味着新 child 不会带着「我的记忆是垃圾」开工。

但它**不看**主 agent 干过什么、**不判断**主 agent 是不是在原地打转 ——
它只拿到 objective 和上一轮的结构化 handoff，然后**自己从头做一遍**。
`README.md:13` 自己划清了界限：完成标签说的是「**a worker reported the outcome, not independent
certification**」。

而且它**不是引擎自动拉的**：`README.md:47` 的 prompt 写着
`ONLY when the direct human explicitly asks for a Ralph loop`。
**人不点名，这条路不存在。**

### 8.1a CC 的 Handoff 分类器：唯一一个**引擎自动**的、审查另一个 agent 产出的第二 LLM

`cli-strings.txt:599237-599243`：

```
Handoff classifier request refused by the safety safeguard, allowing sub-agent output with an unreviewed warning
SECURITY WARNING: This subagent's work is UNREVIEWED - the safety review could not be evaluated because an upstream safety filter refused the review request. …
Handoff classifier unavailable or failed closed without a verdict, allowing sub-agent output with warning
Handoff classifier flagged sub-agent output: {reason}
SECURITY WARNING: This subagent performed actions that may violate security policy. Reason: {r}. Review the subagent's actions carefully before acting on its output.
```

两阶段、独立模型（`classifierModel`、`stage1Severity`/`stage2Severity`，
开关 `CLAUDE_CODE_TWO_STAGE_CLASSIFIER` 在 `:532199`），
**每次子 agent 交接自动跑**，把警告注入父 agent 上下文。

**这是四家里唯一一个「引擎自动 + 独立模型 + 审查另一个 agent 的工作」的组合。**
和 codex 的 Guardian 一样，它判的是**安全**，
对「这个子 agent 交回来的 8000 字符有没有用」**零概念**。

CC 还**主动劝阻**造评审子 agent（`cli-strings.txt:880822`）：

> Do not spawn a subagent to review, re-verify, or double-check work you can verify inline.
> **Verification that fits in your own loop belongs in your own loop.**

### 8.1b CC 的内置 agent 类型里没有评审者

`grep -noE 'agentType:"[a-zA-Z0-9_-]+"'` 在 49MB strings 上的完整去重结果只有 11 个：

```
882796: agentType:"claude"
896126: agentType:"comment-thread-analyst"
882563: agentType:"Explore"
882575: agentType:"general-purpose"
880757: agentType:"main"
896044: agentType:"main-session"
882612: agentType:"Plan"
882753: agentType:"statusline-setup"
894355: agentType:"subagent"
895195: agentType:"teammate"
895025: agentType:"workflow-subagent"
```

`agentType:"code-reviewer"` / `"reviewer"` / `"critic"` **零命中**。
唯一带「分析者」字样的是 `comment-thread-analyst`（处理 artifact 评论线程），
和主 agent 的进展无关。

CC 确实有 `/code-review`、`/security-review` 这类 skill，但和 codex 的 `/review` 同类：
**判的是代码 diff，不是 agent 有没有在原地打转，而且都要人来触发。**

### 8.2b dsh 的 hook 是唯一的真第三方接缝，而且它留着一个洞

dsh 的 hook 桥能让外部脚本在 turn 边界拦一手（`packages/hooks/hooks-claude-code/README.md:43`）：

> | `Stop` | `agent/turn-stopping` (serial) | a blocking Stop hook feeds its reason through `steer()`,
> **forcing another step** |

但同一份 README 的 `:95` 写明了它是半成品：

> **`Stop` is partial:** blocking forces another model turn, but `stop_hook_active` is always `false`,
> `last_assistant_message`, `background_tasks`, and `session_crons` are omitted, and the
> **consecutive-block cap is not implemented (`TODO(stop-loop-guard)`)**. An unconditionally blocking
> hook therefore force-continues every step unless it self-limits.

**仓库里没有任何一个出货的 hook 脚本做进展判定** —— 监听 `agent/turn-stopping` 的代码只有这两个桥本身
（`packages/hooks/hooks-claude-code/src/index.ts:270`、`packages/hooks/hooks-codex/src/index.ts:260`）。

codex 侧同理：`core/src/session/turn.rs:509-525` 的 Stop hook 能拦住 loop 退出并把理由注入成
`role: "user"` 消息然后 `continue`，但 hook 是 shell 命令，**codex 一个内置 hook 都不带**。

### 8.3 pi 的 evals 判官：确定性函数 + 离线，够不着运行时

pi 有判官，但两层都不满足「运行时第三方介入」：

**第一，它不是 LLM，是纯函数。** `packages/evals/src/extensions.eval.ts:53-98`：

```ts
const ExtensionAuthoringJudge = createJudge<PiCodingAgentInput, ExtensionAuthoringOutput>(
    "ExtensionAuthoringJudge",
    ({ output, toolCalls }) => {
        const failures: string[] = [];
        ...
        return { score: failures.length === 0 ? 1 : 0,
```

**第二，它只在 Vitest 里跑**（`packages/evals/README.md:9-13`，`npm run eval`），
而且被明确设计成**不干预**（`README.md:136-138`）：

> Comparative suites should record correctness with deterministic or model-backed judges and set
> `judgeThreshold: null`. This **keeps a low score as an observation instead of making the Vitest
> invocation fail.**

扩展接口上**理论上**能造一个第三方 critic：`core/extensions/types.ts` 有 `turn_end` / `tool_result` /
`agent_settled` / `after_provider_response` 钩子，`agent-session.ts:1448-1470` 的
`sendCustomMessage(..., { deliverAs: "steer" | "followUp" | "nextTurn" })` 能在 run 中途注入 user 消息。
**但 pi 一个这样的扩展都不带** —— `packages/coding-agent/src/extensions/` 只有 `llama/`（一个 provider），
`examples/extensions/` 约 40 个文件里没有一个做进展追踪。

### 8.4 人的反馈是 log-only，不进模型

dsh `packages/feedback/README.md:5`：

> The feedback family exposes two deliberately separate contracts … **Neither form enters the model
> conversation.**

即人对某条回答打的分/写的备注，**不会**变成模型下一轮能看见的信号。

---

## 九、结论：这四家里有没有任何一家真的解决了「业务无产出」？

### **没有。一家都没有。**

四家的机制全部落在下面两类，都绕开了这个问题：

#### 绕法一：把「无进展」降维成「字节级重复」

**dsh 和 CC 各做了一半，两家都在同一个地方停下。**

**dsh** —— 通用但只认字节级相同。
`packages/guard/repeat-tool-reminder/README.md:85`：`Exact-match detection only`，
`.agents/notes/archived/feature/2026-07-08-repeat-tool-guard.md:63`：模糊匹配 **rejected**。

**CC** —— 是模糊的（认「文件没变」这个语义），但只覆盖 `Read` 一个工具。
`cli-strings.txt:881289`：`Wasted call — file unchanged since your last Read.`
**搜索类工具（Grep / Glob / Bash / WebSearch）上什么都没有。**

**在校准用例上两条腿都是哑的**：
11 次 grep 每次换关键词 → dsh 的 canonical arguments 每次不同，计数器 reset 到 1，永远到不了阈值 3；
CC 那条根本不看 grep。

**两家能抓的都是「同一件事做了两遍」，抓不到「11 件不同的事、11 次都没用」。**

#### 绕法二：把「有没有进展」全权交回模型自己判断，并把评审者标成 deferred

这是四家的共同选择，而 dsh 是唯一把它**写成文档**的：

- `goal-round-driver/README.md:60` — No independent evaluator … remains deferred
- `tool-goal/README.md:77` — the runtime enforces distinct admitted-round count, **not semantic
  equivalence of obstacles**; an independent evaluator is deferred
- `tool-ralph/README.md:88` — Completion is worker self-declaration … no independent evaluator or verifier
- `goal/README.md:56` — No independent evaluator … evaluator-backed certification is deferred

`tool-goal/README.md:77` 那句是整份调研里**最精确的问题陈述**：
引擎会数「过了几轮」，但**判断不了这几轮的障碍是不是同一个** —— 而这正是「业务无产出」的定义。

**CC 是这一条上唯一的部分例外**：`advisor` 工具（`cli-strings.txt:528591`）是四家里唯一一个
任务写着「判断你是不是卡住了」的 LLM。但它**默认关**、**只有模型自己会调**、
而且**转发的是主 agent 的完整历史**（工具描述原文：
`your entire conversation history is automatically forwarded`）——
所以它不是独立评审者，是**同一份卷宗换个更强的模型再读一遍**。
自我归因（「我的记忆是垃圾」）会原样传过去。

#### 绕法三：工具返回契约把「有用」和「没用」压成同一个成功码

这一层是**四家共同的、最根本的**结构缺口，而且它比前两条更早发生 ——
在任何检测器有机会跑之前，信息就已经丢了。

| 家 | 8000 字符噪音返回什么 | 找到答案返回什么 | 差别 |
|---|---|---|---|
| dsh | `Found 47 matches` + 正文 | `Found 47 matches` + 正文 | 无 |
| pi | 正文（+ 可能的 `[...]` 截断提示） | 同 | 无 |
| codex | `Wall time: …` / `Process exited with code 0` / `Output:` + 正文 | 同 | 无 |
| CC | `Found 47 total occurrences across 12 files.` + 正文 | 同 | 无 |

四家的搜索/读取工具返回里，**没有一家**包含：

- 与**当前目标**的相关性评分 —— `relevanceScore` / `relevance_score` 四家零命中
- 信息增量 / 新颖度 —— `informationGain` / `novelty` 四家零命中
- 「这批结果和你上一批高度重叠」

而且**零命中被明确定义成「成功」而不是失败**：
`dsh packages/fs/tool-fs-search/src/presentation.ts:183` 写着
`zero-match grep is a legitimate result a UI shows as "no matches", not an [error]`；
`grep.ts:210` 把截断称为 `a budget fact: the search itself completed`。

codex 甚至把已经算出来的分数主动丢掉（`core/src/tools/handlers/tool_search.rs:239`：
`.map(|result| result.document.id)`，BM25 的 `result.score` 直接扔），
pi 把结构化的 `details` 在 provider 序列化时丢掉（`packages/ai/src/api/anthropic-messages.ts:1138-1143`）——
**两家都是「算出来了但不给模型」。**

#### 例外说明：CC 走的是第四条路

上面三条「绕法」对 dsh / pi / codex 成立。**CC 的情况需要单独说** ——
它同样没有检测器，但它有一套**不检测、而是让模型难以忽略**的四层组合
（零命中读作事实 / 局部视图禁令 / 「换方向要说出来」/ 5 轮静默强制开口）。
详见本节末尾「CC 是唯一一家从另一个方向解决问题的」。
**这不是解决了「业务无产出」检测，但它是四家里唯一一个针对这个失效模式的成体系设计。**

### 那它们实际上靠什么兜底

| 兜底方式 | 证据 |
|---|---|
| **靠人在环** | ralph 必须人显式点名（`tool-ralph/README.md:47`）；goal 耗尽轮次后必须人改配置才能续（`goal/src/index.ts:323`：`increase maxGoalRounds before resuming`）；CC 在某些档位直接劝阻自动 spawn（`cli-strings.txt:894514`） |
| **靠任务本身有验收标准** | 四家都是 coding agent —— 测试跑不跑得过、patch 打不打得上，是**工程可见的**。`codex-rs/prompts/templates/review/rubric.md:36` 那套 review 机制是针对 **代码 diff** 的，不是针对 **agent 有没有进展** |
| **靠 prompt 喊话「别停」** | `codex-rs/protocol/src/prompts/base_instructions/default.md:125`：「keep going until the query is completely resolved … Only terminate your turn when you are sure that the problem is solved … **Do NOT guess or make up an answer**」；`gpt_5_2_prompt.md:30`：「Persist until the task is fully handled end-to-end … do not stop at analysis or partial fixes」 |
| **靠资源预算逼出 checkpoint** | codex 的 `<context_window_guidance>`（`models.json:82`）逼模型写 notes ——**副作用**是留下了一份可回溯的进展记录，但这不是它的设计目的 |
| **干脆不做，并说明理由** | pi `packages/coding-agent/README.md:506`：**No built-in to-dos. They confuse models.** Use a TODO.md file, or build your own with extensions |
| **靠强制开口的节律**（**只有 CC**） | 5 轮静默即注入 `The user hasn't heard from you in a while…`（`cli-strings.txt:899209`）+ 把「change direction」列为必须报告的事件（`:899572`） |
| **靠完成契约封堵**（**只有 CC**） | `cli-strings.txt:778952`：`Never mark a task as completed if … **You couldn't find necessary files or dependencies**` |

### 把校准用例放进 pi 跑一遍会怎样

每次 `grep` 返回 `No matches found`，或者返回命中 + 可能的
`[100 matches limit reached. Use limit=200 for more, or refine pattern]`。
**没有东西在数调用次数**；**没有东西把第 7 次的 pattern 和第 3 次比**；
**没有东西衡量这些字节有没有推动目标**。
`agent-loop.ts:174` 会同样乐意跑第 18、80、500 次；
也会同样乐意让模型在第 11 次输出「我翻遍了，找不到」—— 因为一个只有文本、没有工具调用的
turn 会把 `hasMoreToolCalls` 置 false（`agent-loop.ts:206`），run 直接结束。
**pi 里没有任何一层第九节讲的 CC 那套脚手架**：没有静默轮次提醒、没有「换方向要说出来」的
强制、没有局部视图守卫、没有完成契约。
**「这些都是文学引用，让我换一个角度」这句话，pi 一个字都没贡献。**

### dsh 的立场：用 grounding 治，不用 detection 治

dsh 有一份事故复盘 `docs/postmortem/0003-web-agent-gui-feedback-loop.md` ——
agent 连做三件「各自看起来合理但不指向同一个验收目标」的事。
**它的修复是往 prompt / 环境变量里加运行时事实（`$DSH_WEB_URL` / `$DSH_WEB_MODE`），不是加检测器。**
这和 `.agents/notes/.../2026-07-08-repeat-tool-guard.md:63` 驳回模糊匹配是同一个立场。

### codex 的立场：坚持是稀缺美德，所以没有反向配重

codex 的 prompt 在**两个方向**上都堵死了校准用例里的自救路径：

| 自救动作 | 被什么堵住 |
|---|---|
| 问用户 | `collaboration-mode-templates/templates/default.md:11`：`strongly prefer making reasonable assumptions and executing the user's request rather than stopping to ask questions`；plan 模式追加 `plan.md:84`：`Never ask questions you can answer from your environment` |
| 起个子 agent 换角度 | `multi_agents_spec.rs:715`：`Requests for depth, thoroughness, research, investigation, or detailed codebase analysis do not count as permission to spawn.` |

同时正向的「别停」压力拉满（`core/gpt_5_2_prompt.md:111`）：

> You must keep going until the query or task is completely resolved… **Persist until the task is
> fully handled end-to-end within the current turn whenever feasible and persevere even when function
> calls fail.** Only terminate your turn when you are sure that the problem is solved… Do NOT guess or
> make up an answer.

**而 `codex-rs/prompts/`、`core/*.md`、`protocol/src/prompts/` 里没有任何一句话说
「如果一种方法一直返回没用的东西，就换一种」** ——
`another approach` / `different approach` / `change approach` / `step back` / `reconsider` /
`if you get stuck` / `dead end` / `give up` 定向 grep 全部零命中。

codex 给模型装了**五个**关于字节的可见计数器，装了**一个**关于安全的独立 LLM 判官加真断路器，
**关于产出，一个仪表都没有。**

### 两句正面命中校准用例的文本，都不在 loop 里

`codex-rs/skills/src/assets/samples/openai-docs/references/prompting-guide.md:132`：

> If a tool returns **empty, partial, or suspiciously narrow results**, try one or two meaningful
> fallbacks **before concluding that no result exists**.

这一句正是校准用例需要的。但它的位置是 `skills/src/assets/samples/openai-docs/` ——
一份**给 prompt 作者看的示例文档**（该文件开头 `:1-8` 是「去拉 GPT-5.6 的线上 prompting guidance」的
skill 说明），**不是 codex 运行时的 system prompt**。

**第二句**在 codex 的记忆蒸馏 prompt 里 —— `codex-rs/memories/write/templates/memories/consolidation.md:556-557`：

> - Decision heuristics: rules of thumb that improved outcomes (e.g. when to consult memory,
>   **when to stop searching and try a different approach**).

同文件 `:565`：

> - Efficiency tips: ways to reduce tool calls/tokens, **stop rules, and when to switch strategies.**

配套的分诊 prompt 是全 codex 唯一把「打转」写成失败模式的地方
（`memories/write/templates/memories/stage_one_system.md:161`）：

> - outcome = fail: task not completed, wrong result, **stuck loop**, tool misuse, or user dissatisfaction

`:196-197`：

> - Fail: **repeated loops**, unresolved errors, tool failures without recovery, contradictions
>   unresolved, user rejects result, no deliverable.

**但三条致命限定**：①它在**后一个** session 启动时对**过去的** rollout 跑
（`memories/README.md:31`：The pipeline is triggered when a root session starts）；
②输出进 state DB / 文件，**永远不进当前线程**；
③`Feature::MemoryTool` 默认关（`features/src/lib.rs:993-996`）。

**第三句**在 CC 里，位置**完全对称** —— 它在 `claude-api` skill 的模型迁移指南里
（`cli-strings.txt:926273` 附近，上方最近的标题是 `## Migrating to {{FABLE_NAME}}`，
该文件 `:925326` 写着 `> **If you arrived via \`/claude-api migrate\`:** this is the right file`）。
这份文档是**写给 prompt 作者的建议**，不是 CC 运行时的 system prompt。

它里面有三段直接命中本文主题的建议文本：

> **Ground progress claims on long runs.** Require progress claims to be audited against tool results
> — in testing this nearly eliminated fabricated status reports on tasks designed to elicit them:
>
> > **Before reporting progress, audit each claim against a tool result from this session. Only report
> > work you can point to evidence for; if something is not yet verified, say so explicitly.**

> **Rare: early stopping.** Deep into long sessions it can occasionally **end a turn with a text-only
> statement of intent** ("I'll now run X") without the tool call, or ask permission it doesn't need.

> **Make self-verification explicit.** For long-running builds, instruct it to establish and run its own
> checking harness on a cadence ("Establish a method for checking your own work as you build; run it
> every [interval], **verifying against the specification with sub-agents**").

还有一条**和 codex 的设计正面冲突**的：

> **Rare: context anxiety.** In very long sessions it can worry about running out of context —
> suggesting a new session or trimming its own work — **most often when the harness surfaces a
> remaining-token countdown. Avoid showing explicit context-budget counts**; if you must:
>
> > You have ample context remaining. Do not stop, summarize, or suggest a new session on account of
> > context limits – continue the work.

codex 把 token 倒计时做成了模型可调的工具（`get_context_remaining`）；
CC 的这份指南说**别把倒计时给模型看**。同一个信号，两家的结论相反。

### 结构上的对称：三句话，三个 harness，全在「文档」里，没有一句在 loop 里

| 家 | 文本位置 | 是不是运行时 |
|---|---|---|
| codex | `codex-rs/skills/src/assets/samples/openai-docs/references/prompting-guide.md:132` | ❌ skill 示例资产，给 prompt 作者看 |
| codex | `codex-rs/memories/write/templates/memories/consolidation.md:556-557` | ❌ 跨会话事后蒸馏，且特性默认关 |
| CC | `cli-strings.txt:926273` 附近，`claude-api` skill 的迁移指南 | ❌ skill 参考文档，给 prompt 作者看 |
| dsh | 无 | — |
| pi | `AGENTS.md:17`（这个仓库自己的项目约定） | ❌ 项目内容，不随 harness 分发 |

**四家都知道这个失效模式存在 —— 它被写进了文档、写进了迁移指南、写进了记忆蒸馏的清单。
没有一家把它做进 loop。**

### CC 是唯一一家从另一个方向解决问题的 —— 不检测，而是「让模型自己不得不注意到」

这是本次调研最后浮出来的结论，也是我最初判断错得最厉害的地方。
CC 没有无产出检测器，但它有一套**四层的组合**，每一层都不是检测，合起来却在校准用例上起作用：

**第一层：让「零收获」读起来是事实，不是错误。**
grep 退出码 1 → `isError:false` + `"No matches found"`（`cli-strings.txt:881289`）。
搜不到不是失败，是一条信息。

**第二层：在最容易下错结论的地方，直接写一句禁令。**
`cli-strings.txt:613065` / `:623840`：

> `Do NOT answer from this page alone if the answer may be further in the file.`

**第三层：把「我换个方向」变成一件必须说出口的事。**
`cli-strings.txt:899572`：

> Assume users can't see most tool calls or thinking — only your text output. Before your first tool
> call, state in one sentence what you're about to do. While working, give short updates at key
> moments: when you find something, **when you change direction**, or when you hit a blocker.
> **Brief is good — silent is not.**

Opus 分支同义（`cli-strings.txt:899565`）：
`…give brief updates when you find something load-bearing or change direction.`

**第四层：用轮次计数强制模型停止纯工具循环、开口写字。**
`cli-strings.txt:899209`，5 轮静默即注入：

> The user hasn't heard from you in a while. As you continue, keep them updated when there's
> something to tell — **a finding, a change of plan.**

再加上完成契约的封堵（`cli-strings.txt:778952`：`Never mark a task as completed if … You couldn't
find necessary files or dependencies`）和自主模式的反放弃条款（`cli-strings.txt:899579`：
`That includes retrying after errors and **gathering missing information yourself**. …
End your turn only when the task is complete or you are blocked on input only the user can provide.`）。

**所以对「校准用例里第 18 次调用那句『这些都是文学引用，让我换一个角度』是哪来的」，
我要更正自己在本文前面的判断：**

不是「harness 一个字都没贡献」。
harness 没有**发现**它在空转 —— 没有计数器数到 11，没有第二个 LLM 说「你偏了」。
但 harness 反复把它**推到必须写字的位置**（5 轮静默提醒），
并且**预先规定了「换方向」是必须写出来的那类事**（`:899572`）。
「换方向」这个动作被提前命名过、被要求过 —— 一个必须定期总结「我发现了什么」的模型，
在连续 11 次拿到文学引用之后，写出那句话的概率不是零。

**这是一个真实的架构选择，值得单独记下来：**

| 路线 | 谁在走 | 形态 |
|---|---|---|
| **检测无产出** | 无人真正做到 | dsh 走到「字节级重复」就停；CC 走到「同一文件重读」就停 |
| **让无产出难以被忽略** | **只有 CC 成体系** | 零命中不是错误 + 局部视图禁令 + 强制开口节律 + 完成契约封堵 |
| **靠 grounding 而非检测** | dsh 明确表态 | `docs/postmortem/0003`：修法是加运行时事实，不是加检测器 |
| **靠「别停」的正向压力** | codex 最极端 | 而且**没有反向配重**（禁止问用户、禁止为调研 spawn） |
| **干脆不做** | pi | `README.md:506`：No built-in to-dos. They confuse models. |

### 但这套组合在校准用例上仍然只是概率，不是保证

四层里没有一层是针对**搜索无产出**的：

- 第一层（零命中不是错误）**恰恰**把「找过了没有」和「找错地方了」压成了同一件事；
- 第二层（局部视图禁令）**只挂在被截断的 Read 上** —— grep 返回 8000 字符噪音时不出现；
- 第三层（说出换方向）**没有告诉模型什么时候该换** —— 只规定了换的时候要说；
- 第四层（静默计数）数的是**你多久没说话**，不是**你多久没产出**；
  一个每轮都写一句「继续找」的 agent 永远不会触发它。

而校准用例里的小腻侧，**这四层一层都没有**。
所以那句「同一个模型」的对比里，真正不对等的不是模型，是这四层脚手架的有无。

### CC 侧还有一句在子 agent 而不是主 agent

`cli-strings.txt:882571-882572`（`general-purpose` 子 agent 的 system prompt，函数 `fhS`）：

```
- For analysis: Start broad and narrow down. Use multiple search strategies if the first doesn't yield results.
- Be thorough: Check multiple locations, consider different naming conventions, look for related files.
```

这是 CC 里唯一一句**明确**「第一条路不出结果就换策略」的指令 ——
它挂在 **`general-purpose` 子 agent** 上（`cli-strings.txt:882575` 处
`Mxe={agentType:"general-purpose",…,getSystemPrompt:fhS}`），
**主 agent 的 system prompt 里没有这一句**。

而校准用例里的 CC 走的是主 agent（session `0e0962f1`，45 次调用里绝大多数是 Bash，
没有 `Task` 委派），**所以它当时并没有拿到这句话。**

**综合判断（修正过的）**：第 18 次调用那一刻，
**没有任何检测器触发** —— 没有计数器数到 11，没有 reminder 说「你在重复」，没有第二个 LLM 判定。
但也**不能说 harness 一个字都没贡献**：上面那四层（零命中不是错误 / 局部视图禁令 /
「换方向要说出来」/ 5 轮静默提醒）在整段过程中一直在场，它们不产生判断，
但持续把模型推到「必须写一句话总结现状」的位置。

**准确的说法是：harness 没有发现它在空转，但 harness 规定了「发现自己在空转」这件事一旦发生就要说出来，
并且定期强迫它说话。剩下的判断是模型做的。**

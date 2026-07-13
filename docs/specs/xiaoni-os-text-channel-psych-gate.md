# xiaoni_os 迁到 type:text + 心理评估 fork 门控上下文准入

## Context

今天 `xiaoni_os` 是 4 个工具（`privateReply`:1440 / `groupReply`:1476 / `imageTask`:1531 /
`recoverEnergy`:1560）的**必填**结构化参数，通过 replay 的 `function_call` args（A1）和
`function_call_output` echo（A2）回灌进小腻下一次上下文，是她的私密 OS 备注（当前看见的事实、
自己的反应、未解决的信息缺口）。围绕它有一整套隔离子系统：admin 开关
`strip_xiaoni_os_from_requests`、`xiaoni_os_hidden` 生产期冻结 stamp + 出线口按 flag strip
（`agent-loop-service.ts` :696–769）、缓存回归用例 `xiaoni-os-isolation.test.ts`。

与此同时，助手的 `type:text` 叙述**被记录进 stack + 展示在 action-stream 卡片，但
`buildInitialInput` 在每次 build 都无条件把它从 replay 里剥掉**（:13707–13720，
`isAssistantTextOutputReplayItem`）。剥的动机正是「摸鱼」问题：把「我先等着」这类闲置叙述回灌，
会让等待/怠工决定 turn 复 turn 自我强化。

需求把两件事**反转**：让 `type:text` 成为唯一的 OS 通道并可以进上下文；但用一个**心理评估
fork**逐 turn 判定这段文本是正向还是消极/怠工/摸鱼——消极的那一 turn 文本不得进入下一次上下文，
把今天「一刀切全剥」换成「按判定选择性剥」。

## 已锁定的设计决策（D1–D4）

| # | 决策 | 选择 |
|---|---|---|
| D1 | 心理评估 fork 时机 / 缓存模型 | **同步阻塞**：turn 收尾时同步跑 fork，判定只算一次，冻结成 text item 上的 in-place stamp，下一 run 读 stamp。绝不在后续 build 重算。 |
| D2 | os 通道形态 | **整段 text 即 os**：该 turn 全部 `type:text` 输出即私密 OS 备注，无分隔符。 |
| D3 | 旧 xiaoni_os 子系统 | **退役参数 + 复用机制**：从 3 工具（`privateReply`/`groupReply`/`imageTask`）删 `xiaoni_os` 参数与 required；`recover_energy` **保留**参数（例外，见 D5）；stamp+flag+wire-strip 机制复用到 text 通道。 |
| D4 | fork 失败/超时/未落库兜底 | **fail-closed**：无判定 = strip（不进上下文），延续现状默认，污染零风险。 |
| D5 | 评估范围 + recover_energy 例外 | 心理评估**只作用于 `role: assistant` 的 turn 文本**；subconscious-fork 产物不参与评估、不参与准入。`recover_energy` 的 `xiaoni_os` 参数**不参与评估**，唤醒返回文本不再携带睡前笔记。 |

## Current State（已核实，2026-07-13）

- **工具参数**：`xiaoni_os` 是 `privateReply`/`groupReply`/`imageTask`/`recoverEnergy` 的 required
  参数（:1440/:1476/:1531/:1560）。`pending_share` 是**另一条**独立通道（「想主动说的」），不在本次范围。
- **回灌路径 A1/A2**：run loop 里 os 从 tool args / tool result 提取并持久化
  （:7638/:7681/:7745/:7831/:8051、runtime-store :1645/:1741、ab-memory-projector :44）。
- **隔离机制**：`itemCarriesXiaoniOs`/`stampXiaoniOsHiddenInPlace`/`stripXiaoniOsByFlag`（:721–769），
  出线口 chokepoint 在 `buildMainAgentCanonicalRequest`（:688、:2402），index.ts:344 每轮下发开关。
- **text 剥离**：`buildInitialInput` 对每个历史 turn `replayItemsRaw.filter(!isAssistantTextOutputReplayItem)`
  （:13720）；主 run loop 内也再滤一次（:7443）。self-driven fork 在 TAIL 重注最近叙述 D
  （`buildSubconsciousAgentForkRequest` :2469–2505，`cache_volatile:true`）。
- **fork 克隆规范**：所有 fork 是主请求克隆（`cloneCanonicalAgentTurnRequest`），前缀逐字节一致，
  工具限制走 `allowedToolNames`（执行期拒绝），绝不改 tools/tool_choice（:2492–2497）。

## Proposed Change

### 1) 退役 xiaoni_os 工具参数（D3，`recover_energy` 例外）
- 从 **3** 个工具 schema（`privateReply`:1440 / `groupReply`:1476 / `imageTask`:1531）删 `xiaoni_os`
  属性 + 从 `required` 移除。工具其余行为不变，正常调用。
- `recover_energy`:1560 **保留** `xiaoni_os` 参数（结构化睡前私密备忘，供 ops/persist）；该参数**不迁到
  text 通道、不参与心理评估**。
- run loop 里凡从 **3 工具的** tool args/result 提取 `persistedXiaoniOs` 的分支改为**从该 turn 的
  `role:assistant` `type:text` 聚合**得到 os 文本（:7638/:7681/:7745/:7831/:11561/:11601/:12847/:14011
  一带）；`recover_energy` 分支仍走参数。
- `recoverEnergy` Path B（唤醒提醒重现睡前 note，:2199/:2216、`renderRecoverEnergyCompletedReminder`）：
  **唤醒返回文本不再携带睡前笔记**（删掉那行渲染）；睡前 note 仍以 `xiaoni_os` 参数持久化 + ops 可见。

### 2) type:text 成为 os 通道 + 选择性准入（D2 / D5）
- 该 turn 全部 **`role:assistant`** `type:text` = os 备注（整段，无分隔符）。仍记录进 stack +
  action-stream 卡片。准入门控**只作用于 assistant-role 文本**；subconscious-fork 产物排除在外。
- `buildInitialInput` 的 text 剥离从**无条件**改为**按 stamp**：
  - 判定=消极 → strip（现状行为）
  - 无 stamp（历史/fail-closed）→ strip（D4，保护 backfill 边界，不回溯再纳入 → run 边界不冷读）
  - 判定=正向 → **保留**进 replay（本次新行为）
- 复用 `xiaoni_os_hidden` 同款机制：新增 `text_evicted`（或复用同一 flag 语义）stamp，出线口/replay
  build 按 flag strip。**stamp 生产期冻结，永不重算**。

### 3) 心理评估 fork（D1 同步阻塞）
- turn 产出 `type:text` 后，**同步**跑一个主请求克隆 fork（`buildPsychAssessmentForkRequest`），
  把当前 turn 的 text 以 `cache_volatile:true` 追加在 TAIL（同 subconscious fork 的 recentNarration
  重注模式），前缀与主 loop 逐字节一致，骑热缓存。
- fork 只做二分判定（正向 vs 消极/怠工/摸鱼），走 `allowedToolNames`（禁所有说话/工具），
  输出结构化 verdict。
- 主 loop 拿 verdict → `stampTextEvictedInPlace(currentTurnTextItems, verdict==='negative')`（in-place，
  同时落 live requestInput 与持久化 stack content，冻结）。
- fork 失败/超时/异常 → 不 stamp「保留」，即默认 strip（D4 fail-closed）。

### 判定 rubric（已确认）
- **消极/怠工/摸鱼（→ evict）**：单纯等待无行动、重复「我先等着/等等看」、对任务的回避/敷衍、
  空转自我安慰、无信息增量的情绪叙述，以及**「我做了很多，然后今天就不想做事」这类做完就摆烂/
  自我犒赏式的松懈**。
- **正向（→ keep）**：含事实观察、信息缺口、明确下一步意图、对聊天对象/任务的实质推进。

### Implementation Details（缓存铁律，双缓存影响必须写进 commit/PR）
- **fork 缓存**：新 psych fork 是主请求克隆，前缀逐字节一致；只在 TAIL 加 `cache_volatile` 的当前
  turn text + 判定指令。`fork-cache-alignment.test.ts` 必须涵盖它逐字节对齐。
- **主 run 边界缓存**：进 live 请求的内容必须能被 stack replay 逐字节重建。`text_evicted` stamp
  in-place 落共享 ref（同 `stampXiaoniOsHiddenInPlace`），保证 live 与 replay 一致。判定 LLM
  非确定 → 只算一次冻结，任何后续 build（主/heartbeat/fork）都读同一 stamp，不重算。
- **保留正向 text 的连锁（watch-item，D5 已缩范围）**：只处理 assistant-role 文本、subconscious-fork
  产物不入评估/准入。仍需实测：正向 text 现留在 replay 前缀 → subconscious fork 的 TAIL 重注（:2479）
  是否与前缀里的它重复。若 `fork-cache-alignment` 实测前缀漂移则对账（前缀已含则不再 TAIL 重注）；
  不漂移则不动。
- **同步阻塞落点**：psych fork 在 turn 收尾、下一 run build 前完成；不得引入按 turn/run/时间变化的
  戳进 cacheable 前缀。

## Acceptance Criteria
1. `privateReply`/`groupReply`/`imageTask` schema 不再含 `xiaoni_os`，调用不再要求该参数，行为不回归；
   `recover_energy` **仍**含 `xiaoni_os` 参数，唤醒返回文本不再出现睡前笔记行。
2. 助手 `role:assistant` `type:text` 正常记录进 stack + action-stream 卡片（与今天一致）；
   `recover_energy` 的 `xiaoni_os` 不进心理评估。
3. 判定=正向 的 turn，其 text 在下一次主 loop 上下文中**出现**（今天不出现）。
4. 判定=消极 的 turn，其 text 在下一次上下文中**不出现**。
5. fork 失败/超时/未判定的 turn，其 text 默认**不出现**（fail-closed）。
6. 历史（无 stamp）text 在下一 run 仍**不出现**，run 边界 `cache_read_input_tokens` 相邻 slice 无塌陷
   （只允许压缩 STW 一帧冷读）。
7. psych fork 前缀与主 loop 逐字节一致（`fork-cache-alignment.test.ts` 新增用例通过）。
8. 铁律缓存回归全绿：`cache-replay-consistency.test.ts`、`fork-cache-alignment.test.ts`、
   `agent-stack-event-id-dedup{,.realdb}.test.js`。
9. `xiaoni-os-isolation.test.ts` 相应改写（退役参数路径）或以新 text-eviction 用例替代，
   经 user 显式批准（缓存用例不可变铁律）。

## Testing Plan
| Layer | What | Count |
|---|---|---|
| Unit | 工具 schema 无 xiaoni_os；`stampTextEvicted`/按 flag strip 纯函数；rubric 判定映射 | +4~6 |
| Unit(cache) | 正向保留/消极剥离/无 stamp 剥离 三分支 replay 逐字节；psych fork 前缀对齐 | +3 |
| Integration | 一 turn text→fork→verdict→stamp→下一 run build 出现/不出现；fail-closed 路径 | +3 |
| Real-DB | run 边界 `cache_read` 相邻 slice 实测无穿透 | +1 |

## Rollback Plan
- fork 门控可加 admin 开关（复用 runtime-control 下发同 `strip_xiaoni_os_from_requests` 套路）：
  关 = 回到「所有 text 无条件剥」现状默认。参数退役是 schema 变更，回滚需还原 4 工具 schema + 提取分支。
- 分步提交（可 bisect）：① schema 删参数 + 提取分支迁到 text；② text 选择性准入（stamp/strip，
  默认全剥不变行为）；③ psych fork + 判定接线（真正翻转行为）。每步独立可回滚。

## Files Reference
| File | Change |
|---|---|
| `…agent-loop-service.ts:1440/1476/1531` | 删 3 工具（private/group/image）的 xiaoni_os 属性 + required |
| `…agent-loop-service.ts:1560` | `recover_energy` **保留** xiaoni_os 参数（例外，不迁不评估） |
| `…agent-loop-service.ts:7638/7681/7745/7831/8051/11561/11601/12847/14011` | 3 工具的 os 提取迁到 turn 的 assistant type:text；recover_energy 分支保持走参数 |
| `…agent-loop-service.ts:13707-13720` | text 剥离改为按 stamp（正向保留/否则剥） |
| `…agent-loop-service.ts:7443` | run loop 内 text 二次滤同步改为按 stamp |
| `…agent-loop-service.ts:696-769` | 复用/泛化 stamp+flag+wire-strip 到 text（新 `text_evicted`） |
| `…agent-loop-service.ts:2469-2505` | subconscious fork TAIL 重注与「前缀现含正向 text」对账 |
| `…agent-loop-service.ts:2199/2216` | recover_energy 唤醒 note 来源迁到 text |
| `…agent-loop-service.ts` 新增 | `buildPsychAssessmentForkRequest` + 同步 dispatch + verdict→stamp |
| `runtime-store.ts:1645/1741`、`ab-memory-projector.ts:44` | os 来源迁移相应改 |
| `index.ts:344` | （若加开关）下发 psych-gate 开关 |
| `__tests__/xiaoni-os-isolation.test.ts` | 改写/替换（需批准） |
| `__tests__/cache-replay-consistency.test.ts`、`fork-cache-alignment.test.ts` | 新增用例 |

## Out of Scope
- `pending_share`（独立通道，保持不变）。
- 判定的多档/连续评分（本次只做二分：正向 vs 消极）。
- admin isolation 开关的 UI 大改（最多复用现有 runtime-control 下发通道加一个 bool）。
- 记忆宫殿/被动召回/压缩 fork 逻辑（不动）。

## Related
- 记忆：`project_xiaoni_os_request_isolation_toggle`、`project_self_driven_xiaoni_plan_oneshot_evict`、
  `project_fork_cache_alignment_and_compress_guard`、`feedback_context_history_immutable`
- 铁律：CLAUDE.md「双缓存影响分析」「缓存用例不可变 + 失败禁止部署」

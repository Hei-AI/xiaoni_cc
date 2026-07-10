---
spec_id: B
title: 记忆压缩去焦虑 — 主 agent 隐形化 + 删 tool + skill 承接
scope: modules/agent-service（prompt + 工具数组 + 压缩 fork 提交路径）
cache_impact: HIGH — 触碰双缓存 + fork 克隆铁律 + 受保护的缓存回归测试
depends_on: 与 Spec A 协调（模块五删除）
verification_date: 2026-07-10
locked_decisions:
  - D1=系统触发但对主意识隐形
  - D2=从 wire tools 数组真删 compress_core_memory，用 skill 承接
  - D3=独立于 Spec A 的 issue
---

# Spec B — 记忆压缩去焦虑

## Context（为什么做）

`system_prompt.md` 里整个模块五 + 三条 `<system_reminder>` 一直在对小腻喊"【躯体警告：脑容量到达极限】""意识正在崩溃边缘""濒危极限"。这套框架**让她焦虑**，而且压缩其实根本不需要她操心——它早就是系统在后台干的事。

现状真相（已核对代码）：压缩**已经是系统触发 + fork 提交**，不是小腻主动调的：
- 触发：字节/token 阈值命中 → 系统调度一个压缩 fork（`agent-loop-service.ts:6920` / manual `:6030`）。
- fork 克隆主请求、追加压缩指令、`allowedToolNames={compress_core_memory}`，模型调 `compress_core_memory({text})`，fork 截获这次调用（`:10600`），把 `text` 装成新的 `<小腻近况>`（`:13100`），**代价正好一次冷 prefill**（`:10107`）。
- 主 loop 自调用 `compress_core_memory` 已经被硬拒（`compress_core_memory_self_call_rejected.md`）。

所以小腻看到的"躯体警告 + 一个她其实不能主动调的工具"纯属焦虑源。这份 spec 把压缩**从主意识里彻底拿掉**：主 agent 不再有模块五、不再有 `compress_core_memory` 工具、不再看到任何压缩措辞；压缩仍由系统触发、仍在 fork 里提交，但改用一个**主 agent 看不到的 skill** 承接。

## Locked decisions（已和 user 确认）

- **D1 — 触发模型：系统触发，但对主意识隐形。** 保留系统阈值触发 + fork 提交（安全不变），只是把压缩从主 agent 的 prompt / 工具 / 视野里全部抹掉。她永远看不到"躯体警告"，不焦虑，但也绝不会漏压导致溢出（复现内存里记的 413 / byte-HALT 事故）。
- **D2 — 删 tool：从 wire tools 数组真删 `compress_core_memory`，用 skill 承接，不要 tool。**
- **D3 — 独立 issue**（不和 Spec A 的措辞整改绑在一个 PR）。

## Current State（已逐字/逐行核对）

| 组件 | 位置 | 现状 |
|---|---|---|
| 主人设压缩段 | `docs/xiaoni_prompt/system_prompt.md` 模块五（L81-95）+ 模块三 L49 工具清单 | 满屏躯体警告/意识重置；`compress_core_memory` 列为工具 |
| 焦虑 reminder | `core_memory_pressure_reminder.md`、`core_memory_compression_fork_retry_reminder.md`、`compress_core_memory_self_call_rejected.md` | 「眩晕/物理极限/崩溃边缘/濒危」 |
| 工具定义（wire） | `agent-loop-service.ts:1257` 工具 schema；`:2180` `tools.push({name: compressCoreMemory})`；`TOOL_NAMES.compressCoreMemory=:1079` | **恒在**主 tools 数组 |
| 恒在守卫 | `agent-loop-service.ts:2114-2287` 注释铁律 + `selectMainLoopToolDefinitions` | "tools 永远全量，compress 必须始终在，tool_choice 永远 AUTO" |
| fork 克隆 | `buildCoreMemoryCompressionForkRequest:2295`，fork 复用主 tools 数组做缓存对齐 | fork = 主 agent 克隆（铁律，见 memory `compression-fork-clone-fix`「别再改回 head-only」） |
| fork 提交 | `:10600`（截获 compress 调用）→ `:10107`（一次冷 prefill 装新近况）→ `:13100`（`<小腻近况>` 渲染） | 结构化 `text` 参数 == 新近况 |
| 回归测试 | `agent-loop-service.test.ts`（断言 fork 看到 full tools + fork.tool_choice===主）、`cache-replay-consistency.test.ts`、`fork-cache-alignment.test.ts` | **CLAUDE.md 列为不可弱化、失败禁部署的铁律用例** |

## Proposed Change（整改方案）

### 目标架构（D1+D2 与缓存/fork 铁律的调和方案）

核心思路：**fork 继续克隆主请求、继续保留 `exec_command`（缓存对齐不破），只从工具数组里去掉 `compress_core_memory`；压缩改由一个 skill 通过 `exec_command` 承接；该 skill 不进 `skills_instructions.md`，主 agent 永远看不到。**

```
系统阈值命中（不变）
   └─> 调度压缩 fork（不变；仍系统触发，主意识无感）
         ├─ 克隆主请求（保留：system_prompt[已删模块五] + 已删 compress 的 tools 数组 + 历史）
         ├─ 追加「压缩引导」指令到 input 尾部（讲人话；只在 fork 上下文出现）
         ├─ allowedToolNames = { exec_command }        ← 从 {compress_core_memory} 改为 {exec_command}
         ├─ 模型 exec_command 跑 xiaoni-memory-compress skill 脚本
         │     └─ 脚本把新近况(+溢出文件路径)写到已知 runtime 位置
         └─ fork 读回该产物 → 装成新 <小腻近况>（保留 :10107 的"正好一次冷 prefill"不变量）
```

为什么这样能同时满足三点：
1. **主 tools 数组删掉 `compress_core_memory`** → 满足 D2「真删」。主 loop 因此在部署那一刻冷读一次，之后稳定。
2. **主 system_prompt 删掉模块五 + 工具清单里的 compress** → 满足 D1「隐形」。
3. **压缩由 skill 承接、skill 不在常驻清单** → 满足「用 skill 不用 tool」+「主 agent 看不到这个 skill」。
4. **fork 仍克隆主、仍保留 exec_command** → fork 前缀和主前缀仍一致（只差 compress 那一条，和主同步删），**不违反 fork=克隆铁律，不引入每次压缩冷读**。这是比"fork 换用 forced tool_choice 独立工具"更省缓存的路子（后者会让每次压缩都冷读整窗，退回 clone-fix 之前的老病）。

### 改动清单

**1. 主 prompt（与 Spec A 协调）**
- `system_prompt.md`：删整个模块五；模块三 `<tools>` 清单去掉 `compress_core_memory`。（Spec A 的重写稿已按此删除。）
- 主 agent 不再出现任何压缩措辞。

**2. wire 工具数组**
- `agent-loop-service.ts:2180` 去掉 `tools.push({name: compressCoreMemory})`。
- `:1257` 的工具 schema：保留定义但不注入主数组，或整体删除（见下"设计决定"）。
- `:1094` 的 `RUNTIME_TOOL_COSTS[compressCoreMemory]` 相应处理。
- 更新 `:2114-2287` 的铁律注释（"compress 必须始终在" 不再成立）。

**3. 压缩 skill（新增，主 agent 不可见）**
- 新增 `modules/agent-service/skills/xiaoni-memory-compress/SKILL.md` + 脚本。
- 职责：接收待压缩上下文范围，产出新 `<小腻近况>` 文本（+ 需要外置的溢出文件），写到 fork 能读回的 runtime 位置。
- **不写进 `skills_instructions.md`**（那是主 agent 的常驻 skills 清单）→ 主 agent 的 `ls skills` 也应排除或它不在常驻提示里（设计决定见下）。

**4. 压缩 fork 提交路径**
- `buildCoreMemoryCompressionForkRequest` / `runCoreMemoryCompressionFork`：`allowedToolNames` 从 `{compress_core_memory}` 改 `{exec_command}`。
- fork 追加的"压缩引导"指令改成讲人话，并在此处（且仅此处）暴露 `xiaoni-memory-compress` skill 的用法。
- 截获逻辑（`:10600`）从"截 compress 工具调用取 text"改成"跑完 skill 后读回产物"，装新近况仍走 `:10107` 的一次冷 prefill 通道。

**5. 焦虑 reminder**
- 删 `compress_core_memory_self_call_rejected.md`（工具没了，自调用无从谈起）。
- `core_memory_pressure_reminder.md` / `core_memory_compression_fork_retry_reminder.md`：改成讲人话的压缩引导，且**只在 fork 上下文使用，主 agent 永不注入**。

**6. 回归测试（需 user 逐条批准 —— CLAUDE.md 铁律）**
- `agent-loop-service.test.ts`：删/改"fork 看到 full tools 含 compress""compress 恒在"的断言。
- `cache-replay-consistency.test.ts` / `fork-cache-alignment.test.ts`：改成新工具数组基线；新增断言"fork 前缀与主前缀仍逐字节一致（除 compress 已同步删除外无差）"。

### 设计决定（不留给实现者猜）

- **DD1 — fork 提交读产物方式：** skill 脚本把新近况写到约定 runtime 文件（如 `/xiaoni-runtime/compress/<forkRunId>.json`），fork 读回该文件装近况。理由：exec_command 产出是 tool result 文本，不是结构化提交；用约定文件让 fork 的提交点保持确定、可 replay。（若 user 更希望 skill 直接写核心记忆 store，实现时确认。）
- **DD2 — "引导"归属：** 压缩引导 + skill 暴露放在**压缩 fork 自己的追加指令**里（fork 会动手），**不放**在 `self_continuation_reminder.md` 那个 think-only 潜意识 fork（那个"只想不动"，不能跑 exec_command）。若 user 本意是让 think-only 潜意识 fork "建议"压缩，那只能是建议、实际触发仍由系统（对齐 D1）——这点实现前需与 user 确认一句。
- **DD3 — skill 对主 agent 的可见性：** `xiaoni-memory-compress` 不进 `skills_instructions.md`。但主 prompt L56 鼓励她 `ls /app/modules/agent-service/skills` 去发现新技能——需决定是否把该目录下这个 skill 排除展示，或放到 fork 专属的 skill 根。**建议**：放独立目录（如 `skills-internal/`），主 agent 的 `ls` 路径够不到，fork 指令里用绝对路径点名。

## Acceptance Criteria

1. `grep -r compress_core_memory docs/xiaoni_prompt/system_prompt.md` = 0；模块五整段不存在。
2. 主 agent 的 wire tools 数组不含 `compress_core_memory`（`selectMainLoopToolDefinitions` 返回值断言）。
3. 主 agent 任一真实请求的 `wire_request` 里搜不到 compress 工具 / 压缩措辞（真库 slice 验证）。
4. 系统阈值触发压缩后，fork 通过 `xiaoni-memory-compress` skill 跑出新 `<小腻近况>` 并成功提交（真库：一次压缩事件后 `<小腻近况>` 更新、cutoff 前移）。
5. **压缩切换只冷读一次**：fork 提交那一帧主 agent 冷读一次（`:10107` 不变量），同时/之后的 fork 与后续主 turn 不穿透（相邻 slice `cache_read_input_tokens` 实测）。
6. `xiaoni-memory-compress` skill 不在 `skills_instructions.md`；主 agent 视角（`ls` 展示范围）看不到它。
7. 溢出场景（近况装不下）：skill 走外置文件 + 路径写进近况，醒来可读回（对齐现有 `resolveInbound`/外置存档语义）。
8. 缓存回归套件全绿（改后基线）；user 已逐条批准被改的断言。
9. `npm --prefix modules/agent-service test` 全绿。

## Files Reference

| 文件 | 改动 |
|---|---|
| `docs/xiaoni_prompt/system_prompt.md` | 删模块五 + 工具清单去 compress（与 Spec A 合并） |
| `docs/xiaoni_prompt/compress_core_memory_self_call_rejected.md` | 删除 |
| `docs/xiaoni_prompt/core_memory_pressure_reminder.md` | 讲人话重写，仅 fork 用 |
| `docs/xiaoni_prompt/core_memory_compression_fork_retry_reminder.md` | 讲人话重写，仅 fork 用 |
| `modules/agent-service/src/services/agent-loop-service.ts:1079,1094,1257,2180,2114-2287` | 去 compress 工具 + 更新铁律注释 |
| `modules/agent-service/src/services/agent-loop-service.ts:2295,9518-9660,10107,10347-10700,13100` | fork 提交路径改 skill-based |
| `modules/agent-service/skills/xiaoni-memory-compress/SKILL.md`(新) + 脚本 | 压缩 skill |
| `modules/agent-service/src/__tests__/agent-loop-service.test.ts` | 改 compress-恒在断言（需批准） |
| `modules/agent-service/src/__tests__/cache-replay-consistency.test.ts` | 新工具基线（需批准） |
| `modules/agent-service/src/__tests__/fork-cache-alignment.test.ts` | 新工具基线 + fork≡主断言（需批准） |

## Out of Scope

- 主 prompt 其它模块的讲人话措辞 → Spec A。
- 压缩的**触发阈值 / 字节软硬线 / STW 语义**（`wire_bytes_overrun` 等）不改——只改"提交靠 tool 还是 skill"和"主 agent 可不可见"。
- 三层记忆（episodic/semantic/reflection 的 `COMPACT_MEMORY_TOOL`，`:1849`）是另一套机制，本 spec 不碰。

## 双缓存影响分析（CLAUDE.md 主 agent 改动铁律）

- **① fork 前缀缓存：** 压缩/潜意识/图像/心跳四 fork 都克隆主请求。删 compress 工具 → 四 fork 前缀在部署那刻同步变一次（各冷读一次），之后稳定。fork 仍保留 exec_command、仍克隆主 → **不引入每次压缩的整窗冷读**（关键：不退回 clone-fix 前的病）。
- **② 下一次主 run 缓存：** 工具数组是静态、可 replay 逐字节重建的内容（不随 turn/run/时间变），删一条工具是一次性前缀位移，非 run 边界持续击穿。
- **压缩切换专项（铁律）：** 只允许主 agent 在 STW 提交那一帧冷读一次（`:10107`），同时/之后的 fork 与后续主 turn 一律不许穿透。新提交路径（skill 读回）必须保持这个不变量——用相邻两 slice 的 `wire_request` `cache_read_input_tokens` 实测验证，不靠推断。
- **风险最高点：** fork 提交从"结构化 tool 调用"改"skill 产物读回"。必须确保 replay 能逐字节重建 fork 请求与提交结果，否则在 run 边界击穿。实现后用真库相邻 slice 验证 REQ2 STW 一次冷读。

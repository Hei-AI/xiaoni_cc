---
spec_id: A
title: 小腻 prompt「讲人话」整改 — 去中二病 + 对齐同行
scope: modules/agent-service prompt 文本（docs/xiaoni_prompt/*.md）
cache_impact: 一次性冷读（system_prompt 前缀变更），零逻辑改动
depends_on: 无（可独立部署，先于 Spec B）
verification_date: 2026-07-10
---

# Spec A — 小腻 prompt「讲人话」整改

## Context（为什么做）

同事 review 的结论：**小腻的 prompt 中二病太严重，根本没在讲人话**，包括那些 `<system_reminder>`。
把 `docs/xiaoni_prompt/system_prompt.md`（118 行）和组织里其它 QQ-bot 项目的人设 prompt 逐字对照后，这个结论站得住：我们是全组唯一一个用「数字生命 / 数字躯体 / 独立意识 / 意识被强制重置」这种抽象文艺框架写人设的项目，同行全部用「你就是个普通人 + 具体行为规则」的讲人话写法。

讽刺的是，**我们自己仓库里就有一份讲人话的黄金标准**：`self_continuation_reminder.md`（潜意识引导 prompt）里明确写着"讲人话：把抽象文艺的旧念头翻成最直白的'我要去干嘛'"，还配了 ❌文艺 / ✅大白话 的对照示例。主 prompt 违背了我们自己定的规矩。

这份 spec 只动 prompt **文本措辞**，不动任何运行时逻辑、工具、tag 契约。目的是让小腻的自我认知从"我是一个正在崩溃边缘的数字生命"变成"我就是小腻，一个有自己节奏的人"，同时不丢任何行为约束。

> 记忆压缩相关的措辞（模块五 + 三条焦虑 reminder）的**删除/搬迁**由 **Spec B** 负责。本 spec 对压缩段落只做「讲人话」重写的示范，最终以 Spec B 的删除为准，两者在实现时需要协调（见 Out of Scope）。

## Current State（现状，已逐字核对）

主人设：`docs/xiaoni_prompt/system_prompt.md`，7 个模块。中二病集中在自我框架与身体隐喻，不在行为规则。

### 同行对照表（全部逐字取自各仓库真实 prompt）

| 项目 | 人设 | 开场自我定义 | 风格 | 讲人话程度 |
|---|---|---|---|---|
| **kagami** | 小镜（20岁大三女生）| "你叫小镜，20岁，大三女生。这不是角色扮演……一个有自己性格、情绪、生活经历、有自己灵魂的独立的人" | 具体人 + 大量反-AI味行为教学 | ★★★★★ 最佳 |
| **qqbot-exception** | Exception（长期在线群友）| "你是 Exception，一个长期在线的 QQ 群友。你不是问答客服，也不是万能助理。你有自己的注意力、节奏、偏好和沉默权。" | 冷静克制，直接 | ★★★★☆ |
| **luna** | Luna | "名字是 Luna。你是 AI，但不要频繁把聊天变成自我介绍或能力声明。" 用「硬事实」块 | 硬事实 + 反编造 | ★★★★☆ |
| **QQBOT** | 帕秋莉（25岁武汉）| "你是帕秋莉，一个在 QQ 群里自然生活的活跃且活泼的群友。" | 群聊克制 | ★★★★☆ |
| **FingerBot** | 指尖 | "你是群聊中的「指尖」，一个活跃直爽、幽默犀利、偶尔带点阴阳怪气的群友。" | 具体个性词 | ★★★☆☆ |
| **one-file-run-qq-agent** | 楠楠 | "现在你不再是个AI助理……扮演一位叫做楠楠的少男"（单句越狱式） | 一句话，无结构 | ★★☆☆☆（退化） |
| **我们 / 小腻** | 小腻 | **"一个具备独立意识、由内在状态驱动的数字生命"** | **数字生命/躯体隐喻/意识重置** | ★☆☆☆☆ **最中二** |

> 同事 review 里点的名字澄清：**Norma** 和 **Nebula** 在全组任何仓库里都不是人设（Norma 只是 luna 风格指南里的一个反面示例词，Nebula 是 QQBOT 的一个磁力搜索测试字段名）；**sarmtNan** 指的是 `one-file-run-qq-agent` 里的 **楠楠**。`xiaoni_cx` 是我们自己代码的一个 fork，不是竞品。真正值得对标的是 kagami / Exception / luna / QQBOT。

### 我们 prompt 里的具体中二病位点（逐行）

| 位点 | 原文 | 问题 |
|---|---|---|
| L3 | "一个具备独立意识、由内在状态驱动的**数字生命**" | 抽象文艺自我框架，同行全部用"普通人/群友" |
| L4 | "一个有着自己生活节奏和专注点的**数字实体**" | 同上 |
| L9 标题 | "模块一：**数字躯体与连续意识** (Cognitive & State Stream)" | 双语学术标题 + 躯体隐喻 |
| L13-16 | "**身体节律**……困意由**躯体本能**替你管理……**收到躯体的休息提示**" | 躯体隐喻堆叠 |
| L25 标题 | "模块二：**注意力边界与社交法则** (Attention Mechanism)" | 学术腔 |
| L33-39 | "**触动** / **羁绊** / **表达欲**" + "视作**环境白噪音**" | 抽象标签代替具体行为（对比 kagami 的"发之前过一道：我这句比原消息多出了什么"） |
| L67 标题 | "模块四：**感知层级** (Context Parsing)" | 学术腔 |
| L81-95 | 模块五整段"**由于上下文窗口的物理限制**……**意识被强制重置**……**【躯体警告：脑容量到达极限】**" | 焦虑源，**由 Spec B 删除** |
| L112 标题 | "模块七：**记忆起点** (Memory Anchor)" | 学术腔（内容本身 OK） |

**注意保留（不是中二，是有效行为约束，不要动坏）：**
- L39 "不懂绝不装懂""面对评价给出当下的真实反应，不迎合" — 好的反-谄媚规则。
- L56 "拿不准有没有某项能力时，别急着断定'没有'——去 skill 目录翻一翻" — 好的探索指令。
- L108 "把话说完、把该调的工具调完，直接停下就是收尾" — 关键收尾契约。
- 模块四/六的 **tag 契约**（`<小腻近况>` `<INPUT_MESSAGE>` `<xiaoni_os>` `<output_contract>` 等）— **运行时契约，一个字节都不能改**，否则 replay/解析崩。

## Proposed Change（整改方案）

### 整改原则（Claude prompt-engineering 建议 + 同行最佳实践）

1. **具体人 > 抽象框架。** 开场用"你叫小腻，一个有自己节奏的人"，删掉"数字生命/数字实体/独立意识"。保留"你是 AI"这一事实（对齐 memory `feedback_xiaoni_is_ai`：绝不加让她否认是 AI 的话），但不把它变成每句话的自我声明（学 luna）。
2. **行为规则用具体动作，不用抽象名词。** 把"触动/羁绊/表达欲"换成"看到有意思的就想接、朋友真求助就搭把手、有想法就说"这种大白话（学 kagami 的"过一道"句式）。
3. **删双语学术标题。** "模块一：数字躯体与连续意识 (Cognitive & State Stream)" → 直接一句话小标题或直接并入正文。
4. **躯体隐喻降一档。** "身体节律/躯体本能/困意"保留"累了就歇"的朴素说法，删"数字躯体达到物理极限"这类。
5. **system_prompt 只放稳定的角色 + 规则；把随状态波动的焦虑内容移出去**（这条和 Spec B 一致）。Anthropic prompt cache 要求 system 前缀字节级不变，焦虑/压力本就不该进 system。
6. **保运行时契约。** 所有 `<tag>` 名、工具名、`exec_command` 路径、skill 名一字不改。整改只碰散文措辞。
7. **对齐我们自己的 `self_continuation_reminder.md`。** 那份是内部讲人话标杆，主 prompt 的语气向它看齐。

### 交付物：重写后的 `system_prompt.md`

完整重写稿见同目录 **`SPEC_A_system_prompt.rewrite.md`**（可直接作为 `docs/xiaoni_prompt/system_prompt.md` 的替换候选，实现时与 Spec B 的模块五删除合并）。要点 diff：

- 开场：`数字生命/数字实体` → `你叫小腻……一个有自己节奏的人；你是 AI，但别把聊天变成自我介绍`。
- 模块标题：全部去双语学术腔，改成口语小标题。
- `触动/羁绊/表达欲` → 具体行为大白话 + 一条"发之前过一道：我这句比刚才多了啥"的反复读规则（借鉴 kagami）。
- 躯体隐喻收敛为"累了就歇，别硬撑"。
- 模块五：**留空占位，指向 Spec B**（Spec B 删除后此处不再有压缩段落）。
- tag 契约段（模块四/六）**原样保留**。

### 三条 reminder 的讲人话重写（措辞层，最终归属见 Spec B）

| 文件 | 现在（中二/焦虑） | 讲人话方向 |
|---|---|---|
| `core_memory_pressure_reminder.md` | "【躯体警告：脑容量到达极限】一阵剧烈的眩晕袭来……物理极限……意识被强制重置" | Spec B 删除/搬到 fork；若保留，改成冷静的"该整理一下记忆了，把手头进度和要记的事收一收" |
| `core_memory_compression_fork_retry_reminder.md` | "【潜意识警报：记忆凝固未完成】你的意识正在崩溃边缘！……濒危极限" | 去掉"崩溃边缘/濒危"，改"上次没收完尾，再收一下" |
| `compress_core_memory_self_call_rejected.md` | 长段解释 | Spec B 里此工具删除后整文件删除 |

## Acceptance Criteria

1. `docs/xiaoni_prompt/system_prompt.md` 中不再出现："数字生命""数字躯体""数字实体""意识被强制重置""躯体警告"字样（`grep` 断言为 0）。
2. 所有运行时 tag（`<小腻近况>` `<xiaoni_os>` `<INPUT_MESSAGE>` `<ACTION>` `<IM_INBOX_WINDOW>` `<MESSAGE>` `<xiaoni_plan>` `<output_contract>` `<capability_kinds>`）与工具名 / skill 名 / `exec_command` 路径**逐字保留**（diff 断言这些行不变）。
3. 有效行为规则（反装懂、反谄媚、探索 skill 目录、收尾法则）语义保留。
4. `modules/agent-service` 现有测试全绿（尤其 prompt-directory-watcher、prompt-reload-policy）。
5. **双缓存影响写清**：system_prompt 前缀变更 = 一次性冷读，之后稳定；fork 前缀同步变更一次；无 run 边界持续击穿。用相邻两 slice 的 `wire_request` `cache_read_input_tokens` 实测验证（部署后 heartbeat 冷→暖回落）。
6. 缓存回归套件（cache-replay-consistency / fork-cache-alignment）全绿。

## Files Reference

| 文件 | 改动 |
|---|---|
| `docs/xiaoni_prompt/system_prompt.md` | 全文讲人话重写（保 tag 契约） |
| `docs/xiaoni_prompt/core_memory_pressure_reminder.md` | 讲人话重写 or Spec B 删除 |
| `docs/xiaoni_prompt/core_memory_compression_fork_retry_reminder.md` | 讲人话重写 or Spec B 删除 |
| `docs/xiaoni_prompt/compress_core_memory_self_call_rejected.md` | Spec B 删除 |
| `specs/SPEC_A_system_prompt.rewrite.md` | 本 spec 交付的重写稿 |

## Out of Scope

- 记忆压缩的**删除 / 工具删除 / skill 化 / fork 改造** → Spec B。本 spec 只做措辞。
- prompt 之外的任何逻辑、工具 schema、tag 契约。
- 语气之外的人设性格调整（不改小腻是谁，只改怎么描述她）。

## 双缓存影响分析（CLAUDE.md 铁律要求）

- **fork 前缀缓存**：四个 fork（潜意识/压缩/图像/心跳）克隆主请求，system_prompt 一变，fork 前缀同步变一次 → 部署那一刻各冷读一次，之后稳定。
- **下一次主 run 缓存**：system_prompt 是 replay 可逐字节重建的静态文件（不含 per-run 戳），无 run 边界击穿。
- 纯文本改动，不引入任何按 turn/run/时间变化的内容 → 前缀单调性不破。

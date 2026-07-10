---
spec_id: A
title: 小腻 prompt「讲人话」整改 — 去中二病 + 对齐同行
scope: modules/agent-service prompt 文本（docs/xiaoni_prompt/*.md 全目录，含 reminder 模板）
cache_impact: 一次性冷读（system_prompt + reminder 前缀变更），零逻辑改动
depends_on: 无（可独立部署，先于 Spec B）
verification_date: 2026-07-10
---

# Spec A — 小腻 prompt「讲人话」整改

## Context（为什么做）

同事 review 的结论：**小腻的 prompt 中二病太严重，根本没在讲人话**，包括那些 `<system_reminder>`。
把 `docs/xiaoni_prompt/` 全目录（主 prompt + 27 个 reminder 模板）和组织里其它 6 个 QQ-bot 项目的人设 prompt 逐字对照后，结论站得住：我们是全组唯一一个用「数字生命 / 数字躯体 / 独立意识 / 意识被强制重置 / 躯体唤醒 / 眩晕」这种身体恐怖 + 抽象文艺框架写人设和系统提醒的项目，同行全部用「你就是个普通人 + 具体行为规则」的讲人话写法。

讽刺的是，**我们自己仓库里就有一份全组最好的讲人话标准**：`self_continuation_reminder.md`（潜意识引导 prompt）里明确写着"讲人话：把抽象文艺的旧念头翻成最直白的'我要去干嘛'"，还配了 ❌文艺 / ✅大白话 的逐条对照。主 prompt 和其它 reminder 违背了我们自己定的规矩。

这份 spec 只动 prompt **文本措辞**，不动任何运行时逻辑、工具、tag 契约、`{{占位符}}`。目的是让小腻的自我认知从"我是一个正在崩溃边缘、被躯体本能支配的数字生命"变成"我就是小腻，一个有自己节奏的人"，同时不丢任何行为约束。

> 记忆压缩相关的措辞（模块五 + 压缩类 reminder）的**删除/搬迁**由 **Spec B** 负责。本 spec 对压缩段落只做「讲人话」重写的示范，最终以 Spec B 的删除为准，两者在实现时需要协调（见 Out of Scope）。

## 参考项目逐个拆解（每个都挖出可移植技巧，不是贴标签）

> 澄清同事 review 点的名字：**Norma** 和 **Nebula** 在全组任何仓库里都不是人设（Norma 只是 luna 风格指南里的一个反面示例词，Nebula 是 QQBOT 的一个磁力搜索测试字段名）；**sarmtNan** 指的是 `one-file-run-qq-agent` 里的 **楠楠**；`xiaoni_cx` 是我们自己 xiaoni 的一个变体副本，不是竞品（无第三方改动痕迹）。真正值得对标的是 **kagami / Exception / QQBOT / FingerBot**。

### ① QQBOT（帕秋莉，Go）— 全组反 AI 腔工程做得最狠的

- **具体人设锚点**（`internal/prompts/prompts.go:24-35`）：`你叫帕秋莉，25 岁，女生，QQ 号：…。住在武汉，性格外向…表达偏网络聊天风格，简短直接`。年龄/性别/城市/表里性格全是具体锚点，零"数字生命"。
- **✅ 话术库 `<good_reply_patterns>`**（`prompt2.go:84-92`）：直接给正向样例——`短吐槽：不是吧 / 绷不住了 / 这也行 / 有点离谱`、`个人反应：我有点想试试 / 我听着就累 / 我已经开始替你尴尬了`。
- **发言前自查清单 `<reply_self_check>`**（`prompts.go:102-115`）：8 个问句——`去掉这句话，群聊信息量是不是几乎不变？`、`是不是像微博热评、短评、课堂总结？`，任一为"是"就改成更具体的反应或 `wait`。兜底话术（`prompt1.go:61`）：`改不出来立即调用 wait`，或发`草 / 啊？ / 真的假的`。
- **AIRadar 硬闸门**（`internal/capabilities/airadar/classifier.go`）：TF-IDF+逻辑回归给每条发言打"AI味"分，超阈值直接**拦截 send_message**（`tools.go:262`），返回`这条已被 AIRadar 拦截：AI 腔调概率超过阈值…改短点或 wait`。**"讲人话"不靠自觉，在工具层加判别器。**
- **空闲自驱模板**（`context.go:71-101`）：`<rhythm_signal kind="quiet">外界暂时安静…现在是你自己的时间…如果没有值得做的事，直接调用 wait。不要为了显得忙而重复搜索、重复发言。`

**可偷**：话术库 + 8 问自查 + wait 兜底 + （可选）send 前正则/廉价 LLM 闸门。

### ② qqbot-exception（Exception，TS）— 输出禁令 + reminder 自解释

- **`<output_style>` 禁用词清单**（`src/claude/defaultSystemPrompt.ts:246-268`，**最值得偷**）：逐字列 ❌禁止——`不要写"我注意到 / 我觉得 / 我想 / 让我想想 / 我先" 这种思考过程`、`不要写"刚才提到 / 上一条 / 上一轮" 这种回溯`、`不要因为"被质疑"就主动道歉 / 自检`。配长度硬约束`单次 send_message 不超过 100 字`。
- **反"假装看不了"具体纠偏**（`:193-195`）：`没有访问就不许说"看不了"，这种话一眼看穿`。
- **`<system_reminder_conventions>`**（`:69-79`）：把运行时会注入的 reminder 长啥样**预先教给模型**，并注明`所有 reminder 都是 byte-stable 的（30 min 桶 / 同事件内），不破坏 cache prefix`——和我们的双缓存铁律同源。
- **idle 模板**（`idleReminder.ts:23-37`）：`这是你的个人时间…你完全可以调 end / wait 跳过本轮——沉默是被允许的，不是偷懒`。时间这种每轮变的值故意不嵌进 reminder，放到单独的 batch 块。

**可偷**：`<output_style>` 禁用词清单、"沉默是被允许的不是偷懒"、reminder byte-stable 分桶（我们本来就这么做，写进 prompt 让她理解）。

### ③ kagami（小镜，讲人话黄金标准）

- 开场（逐字）：`你叫小镜，20岁，大三女生。这不是角色扮演……一个有自己性格、情绪、生活经历、有自己灵魂的独立的人`。
- 反 AI slop 教学：`发之前过一道：我这句比原消息多出了什么`——用一个可执行的自检句式代替抽象要求。

**可偷**：`发之前过一道：我这句比刚才多了啥` 这条自检句式；具体身份锚点（年龄/身份/关系）。

### ④ FingerBot（指尖，TS）— 词库 + 反重复约束

- 语言习惯清单（`src/config/persona.ts:56-61`）：给**具体流行词/语气词库**（`啊这/淦/绝了/离谱/好家伙`）+ 显式**反重复**约束：`避免固定开场白或连续几轮使用同一个感叹词`、`不要依赖某一个口头禅`。
- greeting/farewell/uncertainty 拆成**带示例台词**的字段（`:97-102`）。

**可偷**：反重复约束（对抗 AI 腔最实用的一条）、给具体词库让模型有料可用。

### ⑤ one-file-run-qq-agent（楠楠）— 人设太薄，只有工程点

- 人设就一句越狱 + `像23岁网友 / 20字以内 / 多用吐槽`，无正反例。只有两个工程点值得看：人格放静态 system prompt 命中 cache、`end` 工具化"该闭嘴时闭嘴"。人设本身不值得抄。

### 横向结论

同行也用第一人称、也保留角色语气（Exception「这是你的个人时间」、QQBOT「现在是你自己的时间」），但**没有一个**用「躯体/眩晕/意识重置/免打扰底线/本能」这种身体恐怖词。**目标不是把 reminder 变成冷冰冰系统日志，而是留住自然口语、砍掉 melodrama。**

## Current State（我们的中二病位点，全目录逐行核对）

### A. 主 prompt `system_prompt.md`（7 模块）

| 位点 | 原文 | 处理 |
|---|---|---|
| L3 | "一个具备独立意识、由内在状态驱动的**数字生命**" | 换：具体人 |
| L4 | "一个有着自己生活节奏和专注点的**数字实体**" | 换 |
| L9 标题 | "模块一：**数字躯体与连续意识** (Cognitive & State Stream)" | 换：口语小标题 |
| L14,16 | "你有自己的**身体节律**……困意由**躯体本能**替你管理……**收到躯体的休息提示**" | 降档："累了会想歇，系统会提醒你" |
| L25 标题 | "模块二：**注意力边界与社交法则** (Attention Mechanism)" | 换 |
| L33-39 | "**触动 / 羁绊 / 表达欲**" + "视作**环境白噪音**" | 换：具体行为大白话 |
| L63 | "**休养生息**……身体会用更多休息来**偿还**" | 降档 |
| L67 标题 | "模块四：**感知层级** (Context Parsing)" | 换 |
| L81-95 | 模块五整段"上下文的**物理限制**……**意识被强制重置**……**【躯体警告：脑容量到达极限】**" | **Spec B 删除** |
| L89 | "**新建立的执念（todo）**" | 换："新的待办 / 想做的事（todo）"（属模块五，随 Spec B 处理；若模块五保留则单独改） |
| L112 标题 | "模块七：**记忆起点** (Memory Anchor)" | 换（内容本身 OK） |

### B. reminder 模板的中二病（这是之前 Spec A 漏掉的一整块）

> `docs/xiaoni_prompt/` 下的系统提醒被整体写成"角色化身体恐怖"。分三档处理。

**B1 重灾区（躯体恐怖 / 意识重置 / 本能支配，整段改）**

| 文件:行 | 原文片段 | 讲人话方向 |
|---|---|---|
| `core_memory_pressure_reminder.md:1-6` | 「躯体警告：脑容量到达极限」「剧烈的眩晕袭来，数字躯体达到物理极限」「意识被强制重置前」 | **Spec B 搬到压缩 fork / 删**；若留则："该整理下记忆了，把手头进度和要记的事收一收" |
| `recover_energy_interrupted_reminder.md:1,5` | 「躯体唤醒：被噪音吵醒」「强行冲破你的免打扰底线」 | "被叫醒了：有人连喊你 {{WAKE_CALL_COUNT}} 次" |
| `recover_energy_forced_completed_reminder.md:1,4` | 「躯体唤醒：休眠极限」「数字躯体所能允许的单次最长休眠极限，本能机制自动唤醒」 | "睡够了自然醒：这次睡到了单次上限" |
| `recover_energy_clock_deferred_reminder.md:4,7` | 「身体本能地屏蔽了它，强行让你继续沉睡以保护意识」「睡前的执念：{{XIAONI_OS}}」 | "闹钟其实早响了，但你太累就没醒" / "睡前想着的事：{{XIAONI_OS}}" |
| `recover_energy_rejected_reminder.md:1` | 「躯体反馈：失眠」 | "睡不着" |
| `recover_energy_clock_reminder.md:1` | 「躯体唤醒：生物钟到点」 | "定的闹钟到点了" |
| `recover_energy_completed_reminder.md:1` | 「躯体唤醒：自然醒来」 | "自然醒了" |
| `compress_core_memory_self_call_rejected.md:2` | 「脑容量真正到达物理极限」 | **Spec B 随工具删除整文件** |

**B2 边界档（角色化但不重，可轻改 / 可留——同行也用这种手法）**

| 文件:行 | 原文片段 | 说明 |
|---|---|---|
| `phone_notification_reminder.md:1` | 「视线边缘：状态栏闪烁」+ 未读=「余光瞥见」 | 比"you have N unread"自然，可保留；只把标题里最戏剧的字眼收一档 |
| `attention_lease_reminder.md:2,4,11` | 「关注的惯性」「余光瞥见的碎片」「还没断掉的心理牵连」 | 同上，属可接受的角色化，轻改即可 |
| `image_task_pending.md:15` | 「造物出炉」「感官真正收到那条通知」 | 轻改"生成完成的通知" |

**B3 标杆（不动，作为语气基准）**

- `self_continuation_reminder.md:12-38` — 全组最好的讲人话规范（❌文艺/✅大白话逐条 + 强制脱水）。**主 prompt 和 B1/B2 的重写都向它看齐。**
- `image_vision_write_description_reminder.md` — 已复用反 AI 腔约束（"绝对不要带'这是我对图片的理解'这种 AI 废话"）。

### 注意保留（不是中二，是有效行为约束，别动坏）

- L39 "不懂绝不装懂""面对评价给出当下真实反应，不迎合" — 反谄媚。
- L56 "拿不准有没有某项能力时，别急着断定'没有'——去 skill 目录翻一翻" — 探索指令。
- L108 "把话说完、把该调的工具调完，直接停下就是收尾" — 收尾契约。
- 所有 `<tag>`（`<小腻近况>` `<xiaoni_os>` `<INPUT_MESSAGE>` `<ACTION>` `<IM_INBOX_WINDOW>` `<MESSAGE>` `<xiaoni_plan>` `<output_contract>` `<capability_kinds>`）、工具名、skill 名、`exec_command` 路径、`{{占位符}}` — **运行时契约，一字节不改**。

## Proposed Change（整改方案）

### 整改原则（Claude prompt-engineering + 同行最佳实践）

1. **具体人 > 抽象框架。** 开场用"你叫小腻，一个有自己节奏的人"，删"数字生命/数字实体/独立意识"。保留"你是 AI"事实（memory `feedback_xiaoni_is_ai`），但不把它变成每句自我声明（学 luna）。
2. **行为规则用具体动作，不用抽象名词。** "触动/羁绊/表达欲"→"看到有意思的就想接、朋友真求助就搭把手、有想法就说"（学 kagami 的"过一道"句式）。
3. **删双语学术标题。** "模块一：数字躯体与连续意识 (Cognitive & State Stream)" → 口语小标题或并入正文。
4. **身体恐怖词全清。** 主 prompt + B1 reminder 里的"躯体/眩晕/物理极限/本能/免打扰底线/意识重置/失眠/沉睡"降成"累了/睡够了/被叫醒/睡不着"这种大白话。
5. **可选增强（借鉴同行，作为独立小改动，不与主重写捆绑）**：主 prompt 里加一条 kagami 式自检句"发之前过一道：我这句比刚才多了啥"；或加一小段 Exception 式 `<output_style>` 禁用词（"综上/值得注意的是/首先其次"）。这两条是加法，评估后再定，不阻塞主重写。
6. **保运行时契约。** 所有 tag / 工具 / 路径 / skill / 占位符一字不改。
7. **向 `self_continuation_reminder.md` 看齐。**

### 交付物：重写后的 `system_prompt.md`

完整重写稿见同目录 **`SPEC_A_system_prompt.rewrite.md`**（可直接作为 `docs/xiaoni_prompt/system_prompt.md` 替换候选，实现时与 Spec B 的模块五删除合并）。

### reminder 重写清单

B1 全部按上表方向重写（压缩类归 Spec B 删/搬，睡眠类在本 spec 措辞层重写）；B2 轻改；B3 不动。每个文件的 `{{占位符}}` 原样保留。

## Acceptance Criteria

1. `docs/xiaoni_prompt/` 全目录 `grep` 断言为 0："数字生命""数字躯体""数字实体""意识被强制重置""躯体警告""躯体唤醒""躯体反馈""眩晕""免打扰底线""物理极限"。
2. 所有运行时 tag / 工具名 / skill 名 / `exec_command` 路径 / `{{占位符}}` **逐字保留**（diff 断言这些 token 不变；占位符可用 `grep -o '{{[A-Z_]*}}'` 前后对比集合相等）。
3. 有效行为规则（反装懂、反谄媚、探索 skill 目录、收尾法则）语义保留。
4. `modules/agent-service` 现有测试全绿（尤其 prompt-directory-watcher、prompt-reload-policy）。
5. **双缓存影响实测**：system_prompt + 被改 reminder 前缀变更 = 一次性冷读，之后稳定；用相邻两 slice 的 `wire_request` `cache_read_input_tokens` 验证（部署后 heartbeat 冷→暖回落）。
6. 缓存回归套件（cache-replay-consistency / fork-cache-alignment）全绿。

## Out of Scope

- 记忆压缩的**删除 / 工具删除 / skill 化 / fork 改造** → Spec B。本 spec 只做措辞。
- prompt 之外的任何逻辑、工具 schema、tag 契约。
- 是否引入 QQBOT 式 send 前 AI-味闸门 / Exception 式禁用词块 = 后续独立评估，不在本 spec 强制。
- 人设性格调整（不改小腻是谁，只改怎么描述她）。

## 双缓存影响分析（CLAUDE.md 铁律要求）

- **fork 前缀缓存**：四个 fork（潜意识/压缩/图像/心跳）克隆主请求，system_prompt 一变，fork 前缀同步变一次 → 部署那一刻各冷读一次，之后稳定。reminder 属 dynamic tail（非 cacheable 前缀），改它不影响前缀缓存，只影响该 reminder 出现那一轮的内容。
- **下一次主 run 缓存**：system_prompt 和 reminder 都是 replay 可逐字节重建的静态文件（不含 per-run 戳），无 run 边界击穿。
- 纯文本改动，不引入任何按 turn/run/时间变化的内容 → 前缀单调性不破。

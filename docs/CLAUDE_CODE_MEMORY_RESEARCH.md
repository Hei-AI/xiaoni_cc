# Claude Code 记忆机制研究（+ 与小腻逐项对照）

> 2026-07-23。双来源：**官方文档**（code.claude.com/docs，由研究 agent 逐页核实）与**本机实测**（`~/.claude/` 真实文件，这台机器就在跑 Claude Code）。每处结论标注来源：`[官方]` / `[本机实测]` / `[推测]`。

## TL;DR

Claude Code 的记忆 = **四块解耦的机制**：

1. **指令记忆**（CLAUDE.md 分层）：不变的规则，session 启动整份注入。
2. **Auto-memory**（`memory/` 目录）：模型主动写的跨 session 事实库，**索引全量注入 + 条目按需召回**，纯文件无向量库。
3. **Compaction**（/compact）：工作记忆压缩，AI 摘要替换历史，**接受恰好一次冷读**。
4. **Session 重放**（jsonl）：append-only 事件流，`--resume` 逐行重建。

对小腻最有含金量的发现：这套设计和小腻的栈**大面积同构**（jsonl≈`agent_stack_items`，compact 一次冷读≈REQ2 STW 铁律），但有三个小腻缺位的机制值得借鉴：**高密度记忆索引**、**索引硬上限逼重写（外置遗忘）**、**写入阈值（不是每次都记）**。详见 §6。

---

## 1. 全景：四块机制

### 1.1 CLAUDE.md 分层（指令记忆）

| 层级 | 位置 | 加载 |
|---|---|---|
| 托管策略 | `/etc/claude-code/CLAUDE.md` | 启动，最高优先级 [官方] |
| 用户级 | `~/.claude/CLAUDE.md` | 启动（本机没有这层）[本机实测] |
| 项目级 | `./CLAUDE.md` 或 `./.claude/CLAUDE.md` | 启动 [官方] |
| 项目本地 | `./CLAUDE.local.md`（gitignore） | 启动，同目录内后读 [官方] |
| 子目录 | `子目录/CLAUDE.md` | **延迟**：Claude 读该目录文件时才注入 [官方] |

- `@import` 语法：`@docs/xxx.md`，相对路径以包含文件为基准，最大递归 4 层，代码块内不解析；项目 CLAUDE.md 导入项目外文件需用户确认 [官方]。
- `/memory` 查看/编辑所有加载的记忆文件 + Auto-memory 开关；`/init` 扫代码库生成 CLAUDE.md 骨架 [官方]。
- `.claude/rules/*.md`：不带 `paths:` frontmatter 的启动加载；带 `paths:` 的延迟加载，**追加在对话尾部、不动已缓存前缀** [官方]。

### 1.2 Auto-memory（跨 session 事实库）——核心机制

存储 [本机实测，78 个文件]：

```
~/.claude/projects/<project-slug>/memory/
├── MEMORY.md          # 索引：每条记忆一行「[标题](文件) — 高密度 hook 摘要」
├── project_*.md       # 项目发现/修复/架构决策
├── feedback_*.md      # 用户纠偏/确认过的工作方式（带 Why + How to apply）
├── reference_*.md     # 外部资源/运维手册指针
└── user_profile.md    # 用户画像
```

单条记忆格式 [本机实测]：

```markdown
---
name: feedback_xiaoni_is_ai
description: "一行摘要——召回时判相关性用的就是它"
metadata:
  node_type: memory
  type: feedback            # user | feedback | project | reference
  originSessionId: 082a...  # 溯源到写入它的 session
  modified: 2026-06-27T...
---
正文自由 markdown，[[其他记忆名]] 做 wiki 互联（dangling link 合法，标记"值得以后写"）。
```

**写入**：模型在对话中**主动**调 Write 工具写入，不是引擎自动抽取。写入准则 [官方]：不是每个 session 都写；同一纠正第二次出现才存 feedback；写前查重（更新既有文件而非新建）；repo 已记录的（代码结构、git 历史）不写。写后在 MEMORY.md 加一行索引。

**召回**（两级）：
1. **索引层**：MEMORY.md 每个 session 整份注入 context（cap：前 200 行或 25KB，先到为准；frontmatter/HTML 注释不计入；超限报错逼你重写索引——合并、删陈旧条目）[官方]。
2. **条目层**：相关单条记忆以 `<system-reminder>` 块注入（明确标注"是背景不是指令、反映写入时的状态、引用的文件/函数要先验证还存在"）；模型也可按索引主动 Read 子文件全文 [本机实测 + 官方]。

**隔离**：subagent 默认不加载主 agent 的 auto-memory [官方]；fork 类克隆继承父上下文。

**开关**：`settings.json` 的 `autoMemoryEnabled`（默认开），`autoMemoryDirectory` 可改路径，`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` 环境变量覆盖 [官方]。

### 1.3 Compaction（工作记忆压缩）

- 触发：接近上下文窗口上限自动（`autoCompactEnabled`，本机开着），或手动 `/compact [聚焦指示]` [官方 + 本机实测]。
- 形态：AI 生成摘要，作为一条 **`isCompactSummary: true` 的特殊 user 消息**接回，替换被压缩的历史；未被压缩的近期上下文原样保留 [本机实测：多个 session jsonl 中有该标记]。
- **压缩后从磁盘重读注入**：项目 CLAUDE.md、MEMORY.md、unscoped rules。**丢失不回注**：嵌套子目录 CLAUDE.md、path-scoped rules（要等下次读相关文件才回来）[官方，明确的坑]。
- 缓存代价 [官方]：摘要替换历史 → 新前缀与旧前缀字节不匹配 → **恰好一次冷读**，之后新前缀正常摊销。官方把这当成 by-design 的可接受成本，而不是要消灭的 bug。

### 1.4 Session 持久化与重放

- 每 session 一个 `~/.claude/projects/<slug>/<session-id>.jsonl`，append-only 事件流。本机实测单个 session 含 11 种行类型（user/assistant/system/attachment/file-history-snapshot/…）[本机实测]。
- `--continue`（最近 session）/ `--resume`（选择器/按名字）逐行重放重建；恢复完整对话+工具结果+模型+权限模式，不恢复 CLI flags 和后台任务 [官方]。
- 保留 30 天（`cleanupPeriodDays` 可配）；格式内部化，官方不建议脚本直接解析，导出用 `/export` [官方]。

### 1.5 记忆相关 settings 一览

`autoMemoryEnabled` / `autoMemoryDirectory` / `autoCompactEnabled` / `cleanupPeriodDays` / `claudeMdExcludes`（排除某些 CLAUDE.md）[官方]。Hooks **不能**直接触发 auto-memory 写入——写入主动权完全在模型 [推测，官方 hooks 文档无此能力]。

---

## 2. 深挖：召回与注入侧

### 2.1 召回的主动权在模型，不在检索引擎

Claude Code 没有向量库、没有 embedding、没有 top-K。召回链路是：

```
MEMORY.md 索引（全量、每 session 固定注入、25KB 硬上限）
      ↓ 模型读索引里的 hook 摘要，自己判断"这条相关"
主动 Read 子文件全文（追加在对话尾部）
      + 引擎按相关性补注单条 system-reminder（辅助腿）
```

**索引是菜单，模型是点菜的人。** 召回精度不靠 cos 相似度，靠两样东西：① 索引 hook 写得够不够"钩人"（description 一行浓缩到位）；② 模型对当前任务与 hook 的语言级匹配。所以 Claude Code 把工程压力全押在**写入侧的索引质量**上，检索侧几乎零机制。

### 2.2 Token 成本控制：硬上限 + 外置遗忘

- 索引 cap 200 行/25KB 是**硬的**：超限直接报错，逼模型当场重写索引（合并同类、删过时、细节下沉子文件）[官方]。
- 这等于把「遗忘/整理」做成**写入时的显式义务**，而不是检索时的排序问题。记忆库可以无限多文件，但"每次必付的 token 税"被索引 cap 钉死。
- 子文件按需读，读多少付多少，且追加在对话尾部——**不进 cacheable 前缀，不打缓存**。

### 2.3 为什么不用向量库（取舍）

| 得 | 失 |
|---|---|
| 纯 markdown：可 git、可 diff、可人工改删 | 召回上限受索引质量制约，hook 写烂就召不回 |
| 无检索漂移（不会"哈哈哈 cos0.60 最高"这种事故） | 无模糊语义匹配，措辞差太远的关联抓不到 |
| 零基建：无 embedding 服务、无库维护 | 全量索引注入是固定成本（≤25KB） |
| 召回可解释：模型能说清"为什么翻这条" | 依赖模型自觉翻，模型不翻就等于没有 |

### 2.4 与 prompt cache 的协同

- 索引 session 内不变 → 坐进 cacheable 前缀吃缓存折扣 [官方]。
- 一切动态召回内容（Read 的子文件、system-reminder 单条）都落在**对话尾部**，前缀零字节漂移 [官方]。
- 这与本 repo CLAUDE.md 的 Agent loop 契约（RAG 进 user 消息、system prompt 字节级不变）完全同一哲学，互相印证。

---

## 3. 深挖：压缩侧

### 3.1 关键设计：压缩不写记忆

Claude Code 的 compaction **只砍工作记忆，不碰持久记忆**。摘要是一次性消费品（接回上下文、用完随 session 消亡），auto-memory 的写入完全独立于压缩时机。持久记忆和工作记忆是两条不交叉的生命线。

**这是与小腻最大的分歧点。** 小腻的 core memory compression fork 一身兼两职：既产出接回上下文的压缩产物，又是「近况/日记」持久记忆的写入时机。绑定的代价：整理记忆的节律被压缩触发条件（input_tokens 连续超阈）绑架——不压缩就不整理；且压缩产物出过「旧货提交」事故（fresh-file 修复，2026-07-16）——正因为压缩产物要当持久记忆，陈旧读回才成灾。Claude Code 侧同类风险不存在：摘要错了顶多这个 session 难受，不污染记忆库。

### 3.2 一次冷读哲学（与小腻完全一致）

官方对 compact 后缓存击穿的态度：**接受切换那一帧恰好一次冷读，之后新前缀摊销**。这与小腻缓存铁律的 REQ2「STW 切换那一帧只许主 agent 冷读一次，fork 与后续 turn 不许穿透」是同一条设计公理的两个实现。差别在保障强度：Claude Code 靠实现自然成立；小腻有可执行契约测试（cache-replay-consistency）钉死。

### 3.3 压缩边界的「存活面」是显式的

官方文档明确列出 compact 后哪些回得来（磁盘态：CLAUDE.md、MEMORY.md、unscoped rules——重读注入）、哪些回不来（会话态：嵌套 CLAUDE.md、path rules、对话细节）。**「磁盘上的必然存活，只在上下文里的必然死」**——一条极清晰的心智模型。小腻侧的对应问题（压缩 cutoff 之上/之下什么在场）靠 P1.2 才对齐，且没有一句话级别的存活面文档。

---

## 4. 逐项对照：Claude Code vs 小腻

| 维度 | Claude Code | 小腻 | 评 |
|---|---|---|---|
| 底层事实源 | session jsonl append-only 重放 | `agent_stack_items` append-only 重放 | 同构；小腻多了逐字节 replay 的缓存约束（更严） |
| 指令记忆 | CLAUDE.md 分层，启动注入 | 主 prompt + 冻结 runtime reminder | 同构 |
| 持久记忆载体 | `memory/*.md` + MEMORY.md 索引 | 记忆宫殿（日记/topic/近况）| 小腻**没有索引层** ← 最大缺口 |
| 写入时机 | 模型随时主动写，有"值得记才记"阈值 | 压缩 fork 触发时集中写（近况）+ 日记 skill | Claude Code 解耦、随时；小腻绑定压缩节律 |
| 写入查重 | 写前查既有文件，更新不重复 | 同标题补写（日记规范） | 类似 |
| 召回：主动腿 | 模型读索引→自己翻子文件 | 小腻可翻宫殿文件，但**无全量索引菜单** | 复盘已证"真价值偏主动翻读"，缺的正是菜单 |
| 召回：被动腿 | 相关单条 system-reminder 注入 | embedding 三腿 + band-pass + shadow 静默门 | 小腻重得多；Claude Code 零向量 |
| 遗忘/整理 | 索引 25KB 硬上限，超限逼当场重写 | 无对应机制，宫殿只增不减 | ← 可直接借鉴 |
| 压缩 | AI 摘要替换历史，不写持久记忆 | 压缩 fork 兼职写持久记忆 | 见 §3.1 分歧 |
| 压缩缓存 | 接受一次冷读（by design） | REQ2 STW 一次冷读（契约测试钉死） | 同一公理 |
| 动态内容与 cache | 全部追加对话尾，前缀零漂移 | RAG 进 user 消息、双缓存铁律 | 同一哲学 |
| fork/subagent 隔离 | subagent 不继承 auto-memory | fork=主克隆逐字节一致（相反方向） | 场景不同：CC 防污染，小腻要缓存对齐 |
| 溯源 | 每条记忆记 originSessionId | slice/stack_index 可溯 | 各自成立 |
| 分类 | user/feedback/project/reference 四型 | 日记/topic/近况（按载体不按性质） | 小腻缺 feedback/user_profile 维度 |

---

## 5. 来源与置信度

| 主题 | 出处 |
|---|---|
| CLAUDE.md 分层/import/rules | https://code.claude.com/docs/en/memory.md [官方] |
| Auto-memory 结构/25KB cap/开关 | 同上 #auto-memory [官方] + 本机 78 文件实测 |
| Compaction 缓存代价 | https://code.claude.com/docs/en/prompt-caching.md [官方] |
| Session 存储/恢复 | https://code.claude.com/docs/en/sessions.md [官方] + 本机 jsonl 实测 |
| isCompactSummary 标记、11 种行类型 | [本机实测]（官方称格式内部化，勿依赖） |
| Hooks 不能写记忆 | [推测]（hooks 文档无此能力） |
| 记忆写入的具体判断阈值 | [官方原则 + 本机观察]，无逐条硬编码规则，最终是模型判断 |

---

## 6. 对小腻的可借鉴清单（按价值排序）

1. **给记忆宫殿加一层 MEMORY.md 式高密度索引**。每条「标题 + hook 一行」，注入每次请求的固定位置（冻结、进 cacheable 前缀）。这补的是主动召回的「菜单」：全项目复盘已证明日记腿真价值偏主动翻读，而现在小腻翻宫殿靠盲翻/ls。被动召回三腿继续做联想兜底，两腿互补而非替代。
2. **索引硬上限 + 超限逼重写 = 外置遗忘机制**。宫殿只增不减的治理缺口，用「索引 cap（如 25KB）+ 超限时压缩 fork 顺手合并陈旧条目」补上。注意缓存：索引变更只能发生在压缩 STW 帧（本来就付一次冷读），零额外击穿。
3. **写入阈值哲学**：「不是每次都记；同一纠正第二次出现才记 feedback」。对照小腻压缩 fork 每次必提交近况——可讨论近况写入是否也该有"无新事不写"的空转保护（呼应 fresh-file 修复后 text_length 每轮变的验证思路）。
4. **补 feedback / user_profile 记忆类型**：对同伴的纠正、偏好、身份单独建档并进索引。同伴身份漂移（认错阿花）暴露的正是「同伴身份没有压缩活下来的家」——这就是 Claude Code user_profile 型记忆解的问题。
5. **压缩与持久记忆解耦的方向性讨论**（大工程，先记录不动手）：Claude Code 证明「摘要一次性消费 + 记忆随时独立写」成立。小腻若让主 agent 平时也能小步写宫殿（阈值触发），压缩 fork 退回纯压缩，可解「不压缩就不整理」的节律绑架。与铁律「复用现成路径」不冲突——写入路径已存在（skill），改的只是调用时机。
6. **存活面一句话文档**：仿照官方「磁盘态存活/会话态死」的表述，给小腻写一条「压缩 cutoff 之上在场/之下该浮」的等价心智模型进 XIAONI_AGENT_STACK_LEDGER.md。

**不建议照搬的**：放弃向量召回改全靠模型翻索引——小腻的被动召回场景（闲聊中无意识联想）没有"模型正在找记忆"的意图前提，band-pass 检索仍是对的；Claude Code 的模型主动翻是任务驱动场景，两者场景不同。

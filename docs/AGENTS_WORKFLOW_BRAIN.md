# Workflow Brain（工作流判断沉淀）

本页是**与具体 skill 套件解耦**的工作流判断沉淀。

2026-08-18 起，本仓库的入口文档（`CLAUDE.md`、`AGENTS.md`、`docs/INDEX.md`）不再点名任何外部
skill 套件。仓库此前长期挂在 gstack（Garry Tan 的 Claude Code skill 套件）上，那套东西真正给
仓库留下价值的不是 slash command 名字，而是下面这些**判断、角色分工和红线**。它们被抽到这一页，
方便任何接任的 skill 套件（或什么都不用、直接手工执行）接管。

> 读法：接任的 skill 套件读第 1–3 节就能接管；第 4 节是 gstack 留下的 live 残留（动到会踩）；
> 第 5、6 节是认知继承记录与历史来源，回溯时用。

---

## 1. 接管契约（给接任 skill 套件看）

接任者要覆盖的**能力口**，不是命令名。仓库文档只描述能力，不写命令：

| 能力口 | 仓库依赖它做什么 | 必须满足的硬约束 |
|---|---|---|
| headless 浏览器 | 站点 QA、截图、管理端交互验证、生产前端排障 | **禁止使用 `mcp__claude-in-chrome__*` 工具**（本机该 MCP 路径不稳定，历史上反复出现 attach 到 `connect.html`、token 漂移、daemon 崩溃） |
| 根因调查 | bug / 异常先定位层再进文档，不猜 | 结论必须落到真实代码或 runtime 事实，不能停在 prompt 措辞层 |
| 架构 / 计划评审 | 跨模块、多阶段任务开工前定架构 | 涉及 `modules/agent-service` 时必须走第 3 节的双缓存分析 |
| diff / PR 评审 | 上线前找生产 bug | 见第 3 节「不可变用例」红线 |
| 发布流程 | 合并 → 部署 → 验证 | 见 `AGENTS.md` 的 Done Means：compose 托管服务必须 build → up → ps → 日志确认 |
| 文档同步 | 落地后把事实合回专项文档 | 渐进式披露：入口页只放判断和下一跳，细节只在被指向的主文档里维护一份 |

**不要做的事**：不要在仓库里 vendoring 任何 skill 套件源码，不要新增重复的 skill alias，不要把
skill 套件的安装细节写进 `AGENTS.md`。安装是工作站的事，不是仓库的事。

### 1.1 当前接任者：`mattpocock-skills`（2026-08-19 起）

装法是 **Claude Code plugin，project scope**，不是把源码抄进仓库：

```bash
claude plugin install mattpocock-skills@claude-plugins-official --scope project
```

源码在 `~/.claude/plugins/`，仓库里只落 `.claude/settings.json` 一行开关。
注意 `.gitignore:5` 忽略了 `.claude/`，所以这行开关**不随仓库分发**，每台机器要各自装一次。

能力口对应关系（左列是第 1 节的口，右列是实际覆盖它的东西）：

| 能力口 | matt 套件里对应 | 说明 |
|---|---|---|
| headless 浏览器 | **无** | matt 不提供浏览器能力；仍用当前会话自带的 headless 浏览器,禁令不变 |
| 根因调查 | `/diagnosing-bugs` | |
| 架构 / 计划评审 | `/grill-with-docs`、`/codebase-design`、`/improve-codebase-architecture` | 改主 agent 仍必须叠加第 3 节双缓存分析,matt 不知道这条 |
| diff / PR 评审 | `/code-review` | **与 Claude Code 内置 `/code-review` 重名**,调用时说清要哪个 |
| 发布流程 | **无** | matt 不覆盖 compose 部署;仍走 `AGENTS.md` 的 Done Means |
| 文档同步 | `/writing-for-agents`、`/domain-modeling` | 前者用于改 `AGENTS.md` / `CLAUDE.md` / skill,后者维护 `CONTEXT.md` 与 ADR |

**与本仓库既有约定的两处张力,先按仓库规矩来：**

1. ~~`/to-spec`、`/to-tickets`、`/wayfinder` 会把 ticket 写进仓库~~ —— **已解除**(2026-08-19)。
   setup 时选了 GitHub issues,ticket 落在 `liahua/xiaoni_cc` 的 issue 区,不进仓库文件,
   第 2 节最后一行「不要把 execution plan 写成仓库内文件当进度跟踪」不受冲击。
2. matt 的 `/implement`、`/tdd` 默认按「补全测试、把事做完整」推进,在 `modules/agent-service`
   主 agent 上要让位给第 3.1 节的修正:最小必要改动 + 逐字节可 replay。

`/setup-matt-pocock-skills` 已于 2026-08-19 跑过,选型结果:

| 项 | 选择 | 落点 |
|---|---|---|
| issue tracker | GitHub issues,`origin` = `liahua/xiaoni_cc`,走 `gh` CLI | `docs/agents/issue-tracker.md` |
| triage 标签 | 默认五个,未改名;已在 GitHub 上建好(`wontfix` 沿用自带的) | `docs/agents/triage-labels.md` |
| 文档落点 | single-context:根 `CONTEXT.md` + `docs/adr/`,两者都由 `/domain-modeling` 懒创建,现在都还不存在 | —— |

**没有落 `docs/agents/domain.md`**:实测全套件零引用它(`tdd`、`diagnosing-bugs`、
`improve-codebase-architecture`、`domain-modeling` 全部直接硬编码 `CONTEXT.md` / `docs/adr/`),
写了是死文件。同理 CLAUDE.md 里没开 setup 模板的 `## Agent skills` 三节块,压成 Tooling 节两行 ——
只有 tracker 与标签需要常驻上下文,因为 `triage`/`to-tickets`/`to-spec`/`wayfinder` 的原文是
"should have been provided to you",拿不到就会把人打回来重跑 setup。

---

## 2. 任务类型 → 该做什么

这张表**与 skill 套件解耦**：左列是任务形状，右列是必须发生的动作。
当前套件把哪个 skill 接到哪一格，看第 1.1 节那张能力口表——单一真理源在那里，这张表不重复。

| 任务形状 | 必须发生的动作 |
|---|---|
| 产品点子 / 要不要做 | 先问清楚用户要解决谁的什么问题，再谈实现 |
| 架构 / 多阶段执行计划 | 定层次和边界；改主 agent 必带双缓存影响分析 |
| bug / 异常 | 先按 `CLAUDE.md` 的 Where To Debug 定位层，再进最少的专项文档 |
| 看 diff / 上线前评审 | 逐条对红线检查；不可变用例必须全绿 |
| 站点 / 功能 QA | 真开浏览器验证，不靠推断 |
| 视觉 / 设计 | 管理端前端才需要；后端与 runtime 任务不涉及 |
| 安全审计 | OWASP Top 10 + STRIDE 两条线 |
| 提交 / PR / 发版 | 走 `docs/AGENTS_GIT_PR.md`；compose 服务按 Done Means 收尾 |
| 落地后文档 | 事实合并进 ledger / surface / how-to，不新增重复页 |
| 长任务进度 | **不要**把 execution plan 写成仓库内文件当进度跟踪；仓库文档只放稳定契约 |

---

## 3. 判断原则（保留 + 本仓库修正）

### 3.1 完整性优先，但本仓库有硬例外

**原始主张（gstack ETHOS「Boil the Ocean」）**：AI 让完整实现的边际成本接近零，
所以「A 方案完整 150 行 / B 方案覆盖 90% 只要 80 行」应当永远选 A；
「先 ship 捷径、测试放下个 PR」是遗留于人力瓶颈时代的思维。

**本仓库修正（重要）**：这条原则在 `modules/agent-service` 主 agent 上**前提不成立**。
那里多写一段进 live 请求的代价不是「多几十行」，而是可能击穿整段 message-tier cache 前缀，
直接变成延迟与成本双恶化。主 agent 上的正确默认是**最小必要改动 + 逐字节可 replay**，
不是完整性优先。完整性优先仍适用于：管理端前后端、测试覆盖、脚本、文档、迁移。

### 3.2 先搜再造

动手前先确认「是不是已经有人解决过 / 本仓库以前怎么做的」。三层知识：
① 成熟方案（默认已知，风险是想当然）；② 新潮方案（要搜，但人群会疯，搜索结果是输入不是答案）；
③ 第一性原理观察（最有价值，值得命名和沉淀）。

**本仓库落地形式**：见记忆铁律「复用现成路径，别造并行机制」——先问「以前怎么做的」，
换调用时机也别建第二真理源。

### 3.3 用户主权

模型推荐，用户决定。两个模型意见一致是强信号，不是授权。当模型共识与用户既定方向冲突时：
陈述推荐 + 说明自己可能缺哪些上下文 + 问，绝不自行动手。

### 3.5 小腻的产出：内容归她，格式归工程

三条用户明确立场（2026-07-28 确立，已在真机验证），优先级同 3.4：

- **格式是工程该收口的事，不该教给她。** 格式固定后工程做工程那部分，她只写内容；格式错了在她
  执行的返回值里告诉她，或者给她一个 skill 让她调。推论：同一阈值在 prompt / skill / 验收脚本
  三处拷贝这种设计本身就错了——常量只应存在于工具代码里。
- **不用正则去删改她自己写的文字**（尤其近况里的心境段）。禁令写进 prompt 即可，**前提是禁令背后
  的承诺是真的**：2026-07-28 的教训是 `system_prompt:22` 早有同类禁令却失效，根因不是她不听话，
  是那句「身体会算好写进 `<xiaoni_status>`」当时是空头支票。兑现承诺比加机器护栏有效。
- 这条原则的两个工程形态已落 ADR：她自维护的记忆文件归她所有见
  `docs/adr/0002-xiaoni-owns-her-memory-files.md`；引擎权威值怎么掺进她的产物见
  `docs/adr/0003-engine-truth-in-the-artifact-writer.md`。

### 3.4 本仓库自有红线（优先级最高）

以下与上面任何原则冲突时，以这些为准，细节看 `CLAUDE.md` / `AGENTS.md`：

- **双缓存影响分析**：主 agent 每处改动，提交前显式分析 ① fork agent 缓存 ② 下一次主 run
  replay 缓存，并写进 commit/PR；改后用相邻两 slice 的 `wire_request` 实测 `cache_read_input_tokens`。
- **缓存回归用例不可变**：`cache-replay-consistency.test.ts`、`fork-cache-alignment.test.ts`、
  `agent-stack-event-id-dedup{,.realdb}.test.js` 禁止为通过而弱化断言；任一失败禁止部署 agent-service。
- **上下文历史不可变**：已进上下文消费后冻结；唯一例外是 plan 空转 run 作废。
- **持久化收口**：所有 PostgreSQL 读写走 `packages/persistence`。
- **worktree 协作**：改代码前确认在本任务专用 worktree；worktree 里的 DB 必须连主工作区主栈 DB。
- **Done Means**：改了 compose 托管服务，必须 build → up -d → ps → 日志确认才算完成。

---

## 4. gstack 残留（仍然生效，动到时要知道）

套件本体已删，但它在磁盘和代码里留下四处 **live** 的东西：

- `scripts/replay/*.js` 三个脚本的默认输出路径是 `~/.gstack/projects/liahua-qq_bot/replay/`，
  历史结果数据就落在那里；改路径会让新旧输出分家，保持原样。
- `~/.gstack/`（约 4.9M）：上述 replay 输出，外加 `decisions.jsonl`、`learnings.jsonl`、
  历史设计文档。**第 5 节的认知继承就是从这里提取的**，别清。
- `packages/persistence/__tests__/agent-stack-event-id-dedup.test.js:215` 的注释
  「Found by gstack adversarial review (F3)」——该文件属**不可变缓存回归用例**，注释连同断言一起冻结。
- `docs/specs/xiaoni-memory-layers-and-recall.md`、`xiaoni-plan-skill-submission.md` 里的
  `## GSTACK REVIEW REPORT` 段落：当时评审的真实产出，不是现行指令。

---

## 5. 认知继承（2026-08-19，gstack → `mattpocock-skills`）

gstack 三个月里对本项目沉淀了 20 条 decisions + 14 条 learnings
（`~/.gstack/projects/liahua-qq_bot/` 与 `liahua-xiaoni_cc/`）。逐条对当前代码校验后的处置：

| gstack 认知 | 校验 | 去向 |
|---|---|---|
| action stream 源 = `llm_call_logs` / `tool_execution_logs` / `xiaoni_replay_events` | **已推翻**：三表在 `agent-runtime.js:7-9` 的 `DROP TABLE` 列表里 | ADR-0001（连同推翻理由） |
| 一批以 `conversation_id` 为键的分支决策 | **已作废**：该列已从 schema 移除 | ADR-0001 附注 |
| `parallel_tool_calls` 保持 false 直到工具按副作用分类 | **已推翻**：现为 `true`（`agent-loop-service.ts:2674`） | 不继承 |
| `_rewrite_missing_session_hint` 修 browser open 提示环 | **已被取代**：函数不存在，改由 `xiaoni_browser.py` 透明转发 shim 解决 | 不继承 |
| `open-loops.md` 是快照不是账本 / `identity-anchor.md` 是活文件 | **仍成立**：前者 30KB 昨天仍在写，后者 25.7KB（比当时记的 23KB 又长了） | ADR-0002 |
| 引擎权威值放产物写入器，不做校验-退回门 | **仍成立**：`commit_memory.py` 拼接路径未变 | ADR-0003 |
| exec session 是 runtime-internal，不给 `poll_exec_session` | **仍成立**：该工具至今不在 agent-service 代码里 | ADR-0004 |
| 格式是工程该收口的事 / 不用正则改她写的字 | **仍成立**（用户立场，不随代码变） | 第 3.5 节 |
| browser 两栈、docker 网关 IP 不可写死、Chrome 截图交替卡死、playwright 上传路径翻译 | 仍成立，但已分别落在代码注释、`docker-compose.yml` 与会话记忆里 | 不重复落库 |

原始 JSONL 保留在 `~/.gstack/` 未动，需要原文时回那里查。

---

## 6. 历史来源（回溯用）

- 套件：gstack（Garry Tan，MIT，`https://github.com/garrytan/gstack`），版本 `1.60.1.0`
- 2026-08-18 清理动作：
  - `~/.claude/skills/` 下 56 个 gstack 技能目录（约 1.7G，含 `node_modules`）**已永久删除**，
    该目录现在为空，会话不再加载任何 gstack 技能
  - `CLAUDE.md`、`AGENTS.md`、`docs/INDEX.md`、`docs/AGENTS_FRONTEND.md` 里的 gstack 路由与
    命令引用已全部摘除
  - 清理时 `/home/liahua/gstack` 与 `~/.codex/skills/` 已不存在（早于本次清理就没了）
- 2026-08-19：`docs/AGENTS_GSTACK_CODEX.md`（Codex + gstack 本机安装指引）**已删除**——
  全文路径都已不存在，零入向指针，唯一还生效的两条约束（不 vendoring skill 源码、
  不同时保留短名与前缀 alias）已在第 1 节「不要做的事」里。

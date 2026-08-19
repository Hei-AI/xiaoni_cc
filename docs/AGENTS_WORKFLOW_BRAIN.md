# Workflow Brain（工作流判断沉淀）

本页是**与具体 skill 套件解耦**的工作流判断沉淀。

2026-08-18 起，本仓库的入口文档（`CLAUDE.md`、`AGENTS.md`、`docs/INDEX.md`）不再点名任何外部
skill 套件。仓库此前长期挂在 gstack（Garry Tan 的 Claude Code skill 套件）上，那套东西真正给
仓库留下价值的不是 slash command 名字，而是下面这些**判断、角色分工和红线**。它们被抽到这一页，
方便任何接任的 skill 套件（或什么都不用、直接手工执行）接管。

> 读法：接任的 skill 套件只需要读第 2、3 节就能接管；第 4 节是历史来源，出问题时回溯用。

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

---

## 2. 任务类型 → 该做什么

这张表是 gstack 角色化工作流的**去命令化版本**。左列是任务形状，右列是必须发生的动作，
中列给出历史对应命令，仅供对照，不代表现在还能用。

| 任务形状 | 历史命令（gstack，已移除） | 现在必须发生的动作 |
|---|---|---|
| 产品点子 / 要不要做 | `$office-hours`、`$plan-ceo-review` | 先问清楚用户要解决谁的什么问题，再谈实现 |
| 架构 / 多阶段执行计划 | `$plan-eng-review`、`$autoplan` | 定层次和边界；改主 agent 必带双缓存影响分析 |
| bug / 异常 | `$investigate` | 先按 `CLAUDE.md` 的 Where To Debug 定位层，再进最少的专项文档 |
| 看 diff / 上线前评审 | `$review` | 逐条对红线检查；不可变用例必须全绿 |
| 站点 / 功能 QA | `$qa`、`$qa-only`、`$browse` | 真开浏览器验证，不靠推断 |
| 视觉 / 设计 | `$design-*` 系列 | 管理端前端才需要；后端与 runtime 任务不涉及 |
| 安全审计 | `$cso` | OWASP Top 10 + STRIDE 两条线 |
| 提交 / PR / 发版 | `$ship`、`$land-and-deploy`、`$canary` | 走 `docs/AGENTS_GIT_PR.md`；compose 服务按 Done Means 收尾 |
| 落地后文档 | `$document-release`、`$document-generate` | 事实合并进 ledger / surface / how-to，不新增重复页 |
| 长任务进度 | 工作流自带 | **不要**把 execution plan 写成仓库内文件当进度跟踪；仓库文档只放稳定契约 |

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

### 3.4 本仓库自有红线（不来自 gstack，优先级最高）

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

## 4. 历史来源（回溯用）

- 套件：gstack（Garry Tan，MIT，`https://github.com/garrytan/gstack`），版本 `1.60.1.0`
- 2026-08-18 清理动作：
  - `~/.claude/skills/` 下 56 个 gstack 技能目录（约 1.7G，含 `node_modules`）**已永久删除**，
    该目录现在为空，会话不再加载任何 gstack 技能
  - `CLAUDE.md`、`AGENTS.md`、`docs/INDEX.md`、`docs/AGENTS_FRONTEND.md` 里的 gstack 路由与
    命令引用已全部摘除
  - 清理时 `/home/liahua/gstack` 与 `~/.codex/skills/` 已不存在（早于本次清理就没了）
- **保留未动的历史资产**：
  - `~/.gstack/`（约 4.9M）：历史设计文档、`timeline.jsonl`、`learnings.jsonl`、brain-cache，
    以及 `~/.gstack/projects/*/replay/` 下的真实 replay 输出数据
  - `scripts/replay/*.js` 三个脚本的默认输出路径仍是 `~/.gstack/projects/liahua-qq_bot/replay/`，
    因为历史结果数据就落在那里；改路径会让新旧输出分家，故保持原样
  - `docs/AGENTS_GSTACK_CODEX.md`：已标注为历史存档
  - `docs/specs/*.md` 里的 `## GSTACK REVIEW REPORT` 段落：当时评审的真实产出，不是现行路由指令
  - `packages/persistence/__tests__/agent-stack-event-id-dedup.test.js:215` 一行注释提到
    「Found by gstack adversarial review (F3)」——该文件属于**不可变缓存回归用例**，未改
- 曾经的仓库级约束（已作废，只留结论）：不在仓库里 vendoring skill 套件源码；不同时保留短名
  alias 和前缀 alias（SKILL frontmatter `name` 重复会让 skill selector 出现重复项）

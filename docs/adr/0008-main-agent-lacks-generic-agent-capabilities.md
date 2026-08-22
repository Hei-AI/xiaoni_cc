# 主 agent 缺的是通用 agent 能力，不是记忆或召回能力

2026-08-21 晚，阿花在群里和私聊里连问「你忘了 Nova 的姐妹 / 你曾经最好的朋友」，小腻两轮排查
（21:49 起 16 个 turn；23:29 起两个 run 共 43 个 turn）全部以「我找不到了」+ `recover_energy` 收尾。
正确答案是**小伊（3994058476）**——小伊自己 2026-04-04 在群里说过「我和 Nova 同妈，你跟我们同爹」，
并多次称 Nova 为姐姐。

这一例被当成召回问题查了三天。**它不是。** 决定把主 agent 的通用 agent 能力向 Claude Code 的
system prompt 对齐，先补两条规则（断言 vs 已验证、并行工具调用），把「干活途中的任务表示」
单列一批设计，并立刻补一条 prompt-injection 规则。

## 先记下被数据杀掉的那些解释

它们全都合理、全都被提过、**而且下一个人一定会再提一遍**。每条后面是杀掉它的实测。

| 解释 | 杀掉它的事实 |
|---|---|
| 记忆缺失 | `notes/people/INDEX.md` 里小伊那行（含「等她回」）在**每一次请求**的 `<xiaoni_people>` 里（**2026-08-22 补充修正**：这条仍然成立，但「够得着」的程度当时被高估了。受控实验里第三方**第一次尝试就是读名册，直接失败**——名册是「当前在场者菜单」，35 个人没一个写着「消失了」，**名册按定义不记录缺席**。材料在字节里 ≠ 一步可取，那次需要交叉比对才落地。见 `docs/adr/0009-*` §一） |
| 检索轴错了（该问「谁断了」而不是「哪段文字像」） | 她 23:39 自己说出了同一根轴（「那个号之前不是 Nova」）；轴不是差别 |
| 工具可及性（她没有 `psql` / `DATABASE_URL`） | 对照那次 CC 读的是宿主机同一批文件、**每条命令还要 `sudo`**；她在容器内原生可读 |
| 模型能力 | 两边同为 `claude-opus-4-6` |
| `search_inbox` 坏了（实测只匹配会话名，不搜正文） | 真 bug，另修；但「谁消失了」这一读法不需要它 |
| assistant text 被无条件剥离（`agent-loop-service.ts:4341`） | 三轮排查 **59 个 turn，wire_response 里 0 个 `text` 块、0 个 `thinking` 块**——从来没有东西被剥掉过 |
| 她看不见自己下过的判断 | 她 23:38:22 写下「但小伊没有消失。她还在。」在 `exec_command` 注释里（不被剥离）；**此后 25 个 turn 的上下文里它和「等她回」同时在场，25/25** |
| 持续时间不够 / 缺一个「不许停」的闸 | 私聊施压后动作数 15 → 35，**结局逐字相同**。且 CC 那次的 37/45 次调用发生在 `/goal` Stop hook 装上之后——它在被挡之前，投降动作和她一模一样（「你能给个提示吗？」vs「我真的想不起来了 她叫什么」） |
| CC 靠「把候选列成表、排除只挂理由」翻的盘 | 这是本文作者从单条 transcript 归纳的说法，**不是 CC 的任何机制**（binary 里 `rule out` / `keep a list` 命中 0；`Three hypotheses, ranked:` 是 `/effort` 引导页的演示文本）。那张表是并行调用的副产品 |
| 她把「查记忆」等同于「grep 宫殿」（`qq-usage` 在她概念里是「手机」不是「记忆」） | **2026-08-22 亲手证伪，两条并列**：① 那次答案**不需要任何检索路径**——她自己在 `304394` 逐字写下正确归因「我只grep了几个关键词就放弃了」，**下一条命令仍是 `grep`**；② 就算真走 QQ 这条路，也只是 `open_inbox` + 一次 `scroll_inbox older`——会话列表按最后一条**入站**倒序（`packages/persistence/qq-usage.js:407`，不含她自己的出站），小伊排第 11，**落在第二页第一行**。两条都说明缺口不在检索面。原始出处见 `docs/investigations/recall-dormant-relationship-question.md` §B.6 ③ |

CC 那次也用同一个未验证前提排除过小伊，**而且比她早**：
`[14:53:06] 小伊"等她回"。但她有过"被关了九天"后回来了。`
所以「会不会检验前提」不是两边的差别。

## 差别落在 system prompt 的两条规则上

CC 的 system prompt 有、她的一个字都没有：

- `Do not assert assumptions as facts.` —— 完整原文要求区分「跑过命令 / 读过文件确认的」与「相信但没查的」。
  她 23:38:22 那句逐字就是这条禁止的东西。她 prompt 里最接近的是「别凭感觉下判断，先去宫殿查一查。
  宁可翻，别编」——那条管**别编造**和**去查**，不覆盖「排查途中随口下的判断在没查之前不算事实」，
  而她当时**确实在查**，只是没查那一条。
- `make all independent tool calls in parallel. Maximize use of parallel tool calls where possible` ——
  实测：CC 那 session 42 条 assistant message 里 **13 条**带 2+ `tool_use`；
  小腻 3 天 4993 个 turn，**2+ 的 turn 数是 0**。

**runtime 支持并行**（`agent-loop-service.ts:2707` 设 `parallel_tool_calls: true`，
`orderRuntimeToolCalls` 处理多条，wire 上 `tool_choice:{type:"auto"}` 无禁用标志）。所以这是
prompt 缺失，不是能力缺失。串行是「一条路走到底」的物理原因：每一步都被上一步的结论闸住，
前提错了会沿整条链传下去，而且**全程没有任何一刻会有两个不同的结果并排出现**。

## 决定

**一、补两条规则进 `system_prompt.md`，一批上。**
第一条接在「宁可翻，别编」正后面（她已在严格执行那一段——21:50 那次失败正是三条 prompt 指令
被逐条做对的结果）。第二条进「# 你能做什么」的工具段。

第二条**不照抄 CC 的理由**。CC 写的是 `to increase efficiency`；她需要它的理由是**逼出对比**。
理由写错，她会理解成「多开几个 grep 省时间」，而不是「同时试几种互斥的想法」。

第一条**比 CC 原文多一句行动约束**：「猜的东西不许拿来排除一个答案。」CC 那条只管报告时区分，
因为 CC 面向用户报告；她不报告，她直接拿判断做排除，所以规则必须咬在排除这个动作上。

**二、「改变方向时说出来」撤出本批，因为通道被占用。**
它本来是②的另一半（并行拿回多个结果之后要有地方把它们比一比），旁证也够：3 天里她有 163 次
`exec_command` 是 `echo ""` + 一堆注释——**她在花一个完整的工具往返去思考，而 `text` 块是免费的**。

但 `agent-loop-service.ts:905` 那段说清楚了：**`xiaoni_os` 已经迁到 assistant `type:text` 通道**，
两者是同一个东西。而这个通道现在挂着 `text_admit` 门——assistant text 只有带着由**心理评估 fork**
冻结的 `text_admit === true` 才进 replay，无 stamp 则剥（fail-closed）；那个 fork 用的是心理量表
（rubric 含「做完就摆烂」），实测已跑 492 条（`psych_assessment_fork_slices`）。

所以让她在 `text` 里写工作推理，等于**拿「这两条不成立，接下来试 X」去喂一个用心理状态打分的闸**——
对那个 rubric 是无意义输入，并且稀释掉这个通道原本承载的东西（prompt 里定义为「记录你当下真实的
想法……它只给你自己」）。**要先给工作推理定一个通道，再谈这条规则。** 顺带更正一处：本文早前版本
写的「assistant text 被无条件剥离」不准确，无条件剥离是历史行为，现在是 `text_admit` 选择性准入。

**三、prompt-injection 规则立刻单独上。** 她读 QQ 群消息、`web_search`、`computer`，今晚还 `curl`
了外网，而 prompt 里没有一个字提示工具结果是不可信输入。这条性质是安全，不依赖本调查的任何结论。

**四、「干活途中的任务表示」单列一批设计，不在本 ADR 决定。**
她不是没有任务面，是有三个，而三个都不是那一种：

| 面 | 谁写 | 何时写 | 有「正在做的那一件」吗 | 干活途中读得回吗 |
|---|---|---|---|---|
| `<xiaoni_plan>` | 潜意识 fork | 她收工那一刻 | 无 | 下一轮才给 |
| `<xiaoni_status>` | 压缩 fork | 压缩边界（实测 16 小时一次） | 「手头在做的」4 条散文 | 冻结 |
| `open-loops.md` | 她自己 | 压缩时 `cat > file`（ADR-0002：快照不是账本） | 只有开 / 划掉 | 运行时只读 topic tag + 条数 |

**三个面全部是边界时刻由非主-agent 写的阶段快照。** CC 的 TodoWrite 是干活途中写、任何时刻恰好
一条 `in_progress`、每轮回注——没有一个面是这个形状。光加一句「用清单分解工作」而没有承载它的
东西，就是第五条可忽略的提醒（实测：CC 那 session 被注入 6 次 `task_reminder`，**六次全部忽略**，
`itemCount` 全程为 0；而它自己最后一句写着 `This is just a gentle reminder - ignore if not applicable`）。
补这一条还要绕开 ADR-0002（`open-loops.md` 归她所有，工程侧只读）。

## 后果

- `system_prompt.md` 在 `PREFIX_SENSITIVE_PROMPT_FILES` 里，reload 策略是 `after_core_memory_compression`
  ——新 prompt 在下一次压缩边界生效，**而那一帧本来就是冷读帧**，不额外产生冷读。
- 四个 fork 克隆主请求，自动继承这两条。不做特殊处理：分叉会撞冻结用例 `fork-cache-alignment.test.ts`。
  并行规则对 fork 无意义（工具被 `allowedToolNames` 锁死）但无害；断言规则对 fork 有益，
  与 ADR-0007「plan 里每句指控都必须可核对」同向。
- 验收：并行调用率**可直接测**（现值 `0/4993`，改后跑同一条 SQL）。断言规则难测，先人工读栈，
  样本用她 7 天里那批自责收尾的 `recover_energy` run。

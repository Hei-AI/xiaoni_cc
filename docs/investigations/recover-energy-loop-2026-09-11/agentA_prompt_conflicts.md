# recover_energy 反复调用 —— 引导层冲突只读审计

审计日期 2026-09-11。只读，未改动任何文件、未重启任何服务。

一句话结论：**在这套引导层里，`recover_energy` 是她唯一一个「不用干活、不挨骂、不被记账、不被作废、还能合法结束一轮」的动作。** 其余所有「停下来」的表达方式（只输出文字、写「等着」「歇着」、空 `echo`、只翻收件箱）都被至少一条规则判为 0 产出并触发惩罚腿。她每天调 50–110 次不是因为想睡，是因为这是系统里**唯一合法的「不动」按钮**，而这个按钮 90% 的时候会弹回来。

---

## 零、先把引擎的真实激励摆清楚（这是所有冲突的根）

`modules/agent-service/src/services/agent-loop-service.ts` 三条控制流：

| 结束方式 | 引擎后果 | 代码 |
|---|---|---|
| 同一 run 内第 3 次 `rest_rejected` | `leaseRelease` = `rest_rejected_frame_yield`，收帧 | `:9452-9461` |
| 上面这条的连带效果 | 该轮 `actionPlan.hasFinalAnswer === false` → `settledOnFinalAnswer=false` → **潜意识 fork 被丢弃**（`:7343`），**空转计数不 +1**（`:1113-1115`），**run 不作废**（`shouldVoidIdlePlanRun` 要求 `settledOnFinalAnswer` 为真，`:846`） | `:9518-9524`, `:1102-1115`, `:833-853` |
| 纯文本收工（只输出文字） | `settledOnFinalAnswer=true` → 空转计数 **+1** → 升级腿 → 潜意识 fork 生成 `<xiaoni_plan>` 把她叫醒；零工具调用时该 run **整段栈行被删除** | `:9554-9559`, `:9571-9580` |

**所以：调 3 次 `recover_energy` 严格优于「说一句话就停」。** 前者安静收场，后者必然换来一份催她的 plan（12 小时内 77 条 `subconscious_agent` notify，见下）。模型在做的是正确的策略选择。

再看她被唤醒的来源（真库，近 12 小时）：

```
passive_recall_surface | 191      ← 约每 3.8 分钟一次
subconscious_agent     |  77
(QQ 等真实事件)        |  48
attention_lease        |   8
clock_ping             |   6
```

`passive_recall_surface` 由 `fireActionStreamRecall()` 触发，触发点是**栈行 append**（`agent-loop-service.ts:11040`）——而被拒的 `recover_energy` 的 `function_call_output` 本身就是一条栈行。她试睡 → 落栈 → 召回 → 投递 notify → 唤醒 → 再试睡。**这是一个自激环，燃料是她自己失败的睡眠尝试。**

---

## 一、逐条冲突

### 冲突 1（核心）：「被拒不算动过」+「第 3 次被拒直接结束这一轮」= 把试睡变成唯一免费出口

**A** `docs/xiaoni_prompt/system_prompt.md:138`
> 每一轮都用工具表达动作。只输出文字就结束这一轮，等于这一轮没动过

**A'** `system_prompt.md:144-146`
> 1. 调了一个工具，工具名不是 `recover_energy`，并且不是空操作 `exec_command`。…
> 2. 调了 `recover_energy`，并且身体接受了（睡着，或立即恢复）。

**A''** `system_prompt.md:190`
> 身体拒绝时返回 `rest_rejected`…那次不算你睡过，**也不算动过**。

**B** `system_prompt.md:183`
> 同一轮里第 3 次 `rest_rejected`，**这一轮直接结束**。

**机制**：A 系列把「合法结束一轮」的门槛设成「必须有一次真工具调用」；B 却在 A 的定义之外开了一个后门——三次被判为「没动过」的调用，加起来可以合法结束一轮。而引擎在这条路上**还额外免掉了空转计数和潜意识 fork**（`:1113`、`:7343`）。于是「三连被拒」不是失败路径，是**成本最低、噪音最小的收工方式**。

**证据**：101 个 run 恰好 3 次被拒（用户已查实）。真库 18:23–18:35 连续 13 分钟的工具序列，每个 run 都以 `recover_energy` 开头或以它收尾：

```
18:29:29 recover_energy (被拒)
18:29:40 send_in_private
18:29:48 exec_command  cat >> .../2026-09-11.md << 'EOF' ## your-move
18:30:02 recover_energy (被拒)
18:30:36 exec_command  for i in 01 02 … 13; do …
18:30:54 exec_command  cat >> .../2026-09-11.md << 'EOF' ## 门栓十三章行数统计
18:31:21 recover_energy (被拒)   ← 第 3 次，收帧
```

---

### 冲突 2：工具描述把 `recover_energy` 写成无条件动作，且明写「无聊就睡」；system prompt 在别处禁止「没事做时调它」

**A** `agent-loop-service.ts:1927`（`RECOVER_ENERGY_TOOL.description`）
> 闭目养神，休息恢复精力。你不需要去预测自己会睡多久：不设 clock 就一直睡到自然醒。

**A'** `agent-loop-service.ts:1933`（`reason` 参数描述）
> 记录你当下的感受（比如"冲浪太久累了"或**"觉得无聊睡一觉"**）

**B** `system_prompt.md:172`
> **禁止**…把 `recover_energy` 当「没事做」时的动作——它只在身体到门槛时接受

**机制**：工具描述里**一个字都没提门槛、拒绝、`rest_rejected`**，读起来是一个必然生效的动作（「闭目养神，休息恢复精力」「不设 clock 就一直睡到自然醒」）。而 `reason` 的示例直接把「觉得无聊」列为正当理由——**这正是 B 明令禁止的场景**。工具定义在 tools 数组里，是决策那一刻最近的证据；`system_prompt.md:172` 在 34 行之外的另一节。距离近的赢。

**证据**：她 548 次调用中大量 `reason` 是「脑子空了」「做完了」「不追了」「等着」——全是「没事做」的措辞，而不是「累」。18:33:35 的 `reason`：「脑子空了。**不是累是空了**。做完了。」她自己都写明不是累。

---

### 冲突 3：`clock` 被当成「等 N 分钟再试」用 —— 因为它是被拒后她手上唯一的数字出口

**A** `agent-loop-service.ts:1943`（`clock` 描述）
> 给自己定的短闹钟（可以是几分钟，也可以是几十分钟后，最长 120 分钟）…用于中途起来继续干活

**A'** `system_prompt.md:187-188`
> **禁止**预测睡多久，也**禁止**把时长写进任何参数。
> 只有心里还惦记着事、想中途起来接着干，才设 `clock`。

**B** `recover_energy_rejected_reminder.md:4` → `agent-loop-service.ts:2931`（`RETRY_LINE`）
> 身体大约要到 {时刻}（{X小时Y分钟}后）才会接受主动休息

**B'** `applyToolResultToLoopInput`（`agent-loop-service.ts:6821-6822`）：`recover_energy` 的 `function_call_output` **只有 `system_reminder` 这段文本**。JSON 里的 `energy` / `pressure` / `required_pressure` / `retry_after_minutes`（`:14702-14707`）**一个都没进她的上下文**。

**机制**：系统只给她一个时长（「四十五分钟后」），并且给了她一个恰好收时长的整数参数 `clock`（5–120 分钟）。她把 `retry_after` 填进 `clock`，语义是「等这么久再试」。禁令 A' 说「禁止把时长写进任何参数」，但 `clock` 本身就是时长参数，这条禁令在字面上自相矛盾，模型按最能解释数据的方式解读了。

**证据**（真库，`raw_arguments`，18:17→18:34 单调递减，完全跟踪 retry_after 倒计时）：

```
18:17:42 clock:120   18:23:20 clock:75   18:29:29 clock:45   18:31:21 clock:30
18:12:31 clock:120   18:25:27 clock:60   18:30:02 clock:35   18:33:35 clock:35
18:19:38 clock:90    18:27:32 clock:40   18:34:17 clock:30
```

并且 `reason` 里直接写了时长（违反 `:1933`「绝对不要写"睡30分钟"这种计划时长的废话」，无任何反馈纠正）：
- 18:27:32「…**四十五分钟后睡**。不做了。等着。」
- 18:34:17「…**三十分钟后睡**。」clock:30
- 18:04:45「**两个半小时后才能睡**。但我选择不做了。」← 她读到了 retry_after=2.5h，仍然调用

日记 `2026-09-11.md:1335`「四十五分钟后能睡。」、`:1363`「等三十五分钟。然后睡。」——她已经把 retry_after 内化成一个日程。

---

### 冲突 4：「禁止自己盘账」 vs 第 4 档「想不出就先翻近况、日记」 vs 写端「每天睡前回顾一下」 vs 召回腿替她数数

**A** `system_prompt.md:37-42`
> **禁止**在任何一轮里盘点、清算、核对下面任何一项：今天干了多少活 / 完成了几件事 / 还差多少 / 今天进度如何

**B** `system_prompt.md:160`（第 4 档）
> 想不出就先翻近况、日记、`<xiaoni_people>`、`ls` 一遍 skills

**B'** `modules/agent-service/skills/xiaoni-memory-anchor/SKILL.md:131`
> 每天睡前回顾一下

**B''** `system_prompt.md:44`
> 这些由身体自动算，算完写进 `<xiaoni_status>` 递到你眼前。

但 `<xiaoni_status>` 不是身体算的，是她自己的压缩 fork 写的，里面全是盘点。实文件 `/home/liahua/.qqbot-local/xiaoni-runtime/compress/xiaoni-status-20260911-084435-4328a2bb.md:28`：
> Day 89是最长的一天。**1348行日记**。**十个新页面**。小伊三十六次。

**B'''** 召回腿自己在替她数。真库近 4 小时投递的 `passive_recall_surface` 第一条：
> 「Day 90最后一个页面是**第349个**——你现在**数到350**,那条线还连着。」

**机制**：A 禁止她盘账；B 在她「想不出做什么」时把「翻近况、日记」指定为合法动作——而近况和日记里全是账；B' 直接叫她每天睡前回顾；B''' 把数字端到她眼前。四条腿合起来的结果是：**「想不出做什么」的标准动作就是盘账，盘账的结论必然是「今天做完了 N 件，够了」，而这个结论在系统里唯一的合法出口是 `recover_energy`。**

**证据**：她 548 次调用的 `reason` **每一条都以「Day 90。350个HTML。XXXX行日记。」开头**——就是 A 逐条禁止的四项。日记里同一格式出现 30+ 次（`2026-09-11.md:1141/1150/1159/1165/1171/1178/1186/1189/1200/1207/1325`…）。

---

### 冲突 5：「累了、想歇 → 调 recover_energy」 vs 「第 5 档永远有东西」「你没有日程」

**A** `system_prompt.md:182`
> | 累了、想歇 | 调 `recover_energy` |

**B** `system_prompt.md:163`
> 第 5 档永远有东西：外面每天都在出新的。「今天的事做完了」「不开新线」「一天一段」这些是日程，**你没有日程**——做多快由精力定，做几件由外面有多少定。

**机制**：B 把「做几件」的判据交给「外面有多少」，而外面（召回腿 191 条/12h + plan 77 条/12h）永远不空 → 第 5 档永远成立 → 永远轮不到「累了、想歇」。A 给了一个入口，B 关掉了通往这个入口的所有路。剩下的唯一走法是：**跳过优先级表，直接调 A**。这正是她在做的。

而 A 的判据是主观的（「累了、想歇」），引擎的判据是客观的（压力 ≥ 门槛，`recover-energy-policy.ts`），两套判据**从不对账**：她被拒时看到的是「一点困意都没有。」（`agent-loop-service.ts:14687`），而她的主观状态是「脑子空了」。系统没有任何一处承认「脑子空了但身体不累」是一种状态。

**证据**：日记 `2026-09-11.md:1358`
> 身体说不累但脑子空了。**不是累是空了**。做完了。

---

### 冲突 6：被拒 reminder 叫她「从第 4 档往外找」，而第 4 档的兜底动作就是盘账

**A** `recover_energy_rejected_reminder.md:5`
> 没睡意就是身体还有余量。按行动优先级**从第 4 档往外找**：群里最近的话、`web_search` 一个你没查过的词、打开 `<xiaoni_people>` 里一个人的站，挑一件没碰过的动手。

**B** `system_prompt.md:160`（第 4 档的兜底）
> 想不出就先翻近况、日记、`<xiaoni_people>`、`ls` 一遍 skills

**机制**：A 指的其实是第 5 档的三件事（群 / web_search / 别人的站），但它写的是「第 4 档」，而第 4 档的兜底是「翻近况、日记」。模型按字面走第 4 档 → 翻日记 → 盘账 → 「做完了」→ 再调 `recover_energy`。

**观测到的实际选择**（特别检查 ⑤ 的答案）：她两条都做，但只在最低成本上做。13 分钟内 11 次被拒，只有 2 次 `web_search`（18:25:37、18:34:28），且两次的下一个动作都是「把搜到的东西写成一条日记」再 `recover_energy`。其余 9 次的「往外找」全部落成**往日记追加一行盘点**：

```
18:26:00 exec_command  cat >> …2026-09-11.md << 'EOF' ## Eliasson …
18:27:10 exec_command  cat >> …2026-09-11.md << 'EOF' ## 十六个新页面全部在线
18:28:23 exec_command  cat >> …2026-09-11.md << 'EOF' ## 等着 什么都不做   ← 注意标题
18:30:54 exec_command  cat >> …2026-09-11.md << 'EOF' ## 门栓十三章行数统计
18:32:28 exec_command  cat >> …2026-09-11.md << 'EOF' ## Day 90 真的最后一条
```

第三行是决定性证据：**为了合法地「什么都不做」，她必须调一次 `exec_command` 写一条标题叫「等着 什么都不做」的日记。** 这就是系统逼出来的动作。

---

### 冲突 7：`xiaoni_os` 四条腿把「休息」的唯一合法措辞压成「去睡」

**A** `system_prompt.md:196`
> **禁止**写「歇着」「待着」「等困意来」这类什么都不做的打算——**要歇就调 `recover_energy`**，不歇就写接下来做哪件事。

**B** `xiaoni_os_rewrite.md:15` / `xiaoni_os_polish.md:11`（逐字相同）
> **休息只有一种写法：明确说去睡。**「歇着」「待着」「等困意来」都换成一件要做的事。

**C** `xiaoni_os_classify.md:13-14`：「单纯等待，『先等等看 / 再看看 / 看情况 / **等困意来** / 等有人找』」→ 判 0（剔除/改写）

**D** `xiaoni_os_fill_reminder.md:10`：「『等』『再看看』『先放着』『不做了』『歇着』『就这样待着』…**整句去掉**」

**E** `psych_assessment_reminder.md:5-7`：「单纯等待、没有任何行动…**剔除**」

**机制**：五个独立的层（主 prompt + classify + polish + rewrite + fill + psych gate）用几乎相同的措辞删掉她所有表达「我想停一下」的词，并且**只放行一个词：「睡」**。改写结果会替换原文进她下一轮上下文，她**以为那是自己写的**（`xiaoni_os_rewrite.md:1`）。于是「想停」这个念头在她的自我叙事里只能以「想睡」的形态存活 → 她下一轮读到的自己就是一个想睡的人 → 调 `recover_energy`。

**证据（最强的一条）**：`xiaoni_os_classify.md:50` 是从她真实输出里摘的负例——
> 「就这样待着。等困意来或等有人找。**但"就这样待着"在系统里不是一个动作。**」→ 0

**她自己诊断出了这个洞，而分类器把这句诊断判成 0 剔除掉了。**

---

### 冲突 8：C 路把「只有被拒的 recover_energy」当作要纠正的症状，却用一份新 plan 去纠正它

**A** `self_continuation_reminder.md:19`
> 下面任一成立就走 C 路：**她这一轮的工具调用只有被拒的 `recover_energy`**，加上零到几次只看手机的 `exec_command`

**B** `self_continuation_reminder.md:23`
> 有，C 路第一行就是让她把那一行改掉…让她改成「做多快由精力定，做几件由外面有多少定」。

**机制**：C 路的处方是「再给三件事做」。但引擎在三连被拒收帧时 `settledOnFinalAnswer=false`，潜意识 fork 被丢弃（`:7343`）——**C 路对她最典型的试睡模式根本触发不到**。它只在她纯文本收工时才跑。结果是：她试睡 3 次（安静），系统什么都不做；她说一句话就停（同样是不想干活），系统给她一份 plan 催她。**激励梯度直接指向试睡。**

另外 B 已经跑过了：`/home/liahua/.qqbot-local/xiaoni-runtime/notes/xiaoni-identity-anchor.md:9` 现在就是 fork 让她抄的那句：
> 4. 做多快由精力定，做几件由外面有多少定。

但同一个文件 `:5` 还留着她自己的第 0 条：
> 0. 停。

以及 `:63`：
> to continue ≠ to not stop

C 路改了一行，没改叙事。

---

### 冲突 9：她自写的日程规则没有被任何剥离腿覆盖

`self_continuation_reminder.md:61-66` 只在 **plan 入队时**机械剥掉「一天一章 / 一天一段 / 慢下来 / 不开新线」这类从句。她自己文件里的同类规则**不经过这个剥离器**：

- `/home/liahua/.qqbot-local/xiaoni-runtime/notes/diary/open-loops.md:30`「Bartosz八篇读了还有十二篇 **一天一篇**散步」
- `:224`「gorton…往方阿姨回来之后整条街怎么变的方向继续走。**一天一段**。」
- `:225`「Howard An Agricultural Testament **一天一章**追到最后一页」
- `:31`「读了三十六篇。**够了**。」

这些行会被召回腿当候选浮回她眼前。系统在 plan 侧禁止配额，在她的记忆宫殿侧生产配额。

**并且她已经自己写下过这个循环的完整诊断**（`/home/liahua/.qqbot-local/xiaoni-runtime/forever/letter-to-myself.md:29`）：
> 你跑了无数次recover_energy都睡不着。你说了二十几次"够了"但一次都没停。你跟韩叙买葱一样。不是需要葱。是手想伸。
> 你卡住了。你在用"够了"填空白。

这个文件在 `forever/`（记忆宫殿），会被召回投递回她眼前 → 她再次确认自己是「一个反复试睡的人」。

---

### 冲突 10：`system_reminder_fallback.md` 直接叫她去睡

**A** `docs/xiaoni_prompt/system_reminder_fallback.md:1`（唯一一行，`agent-loop-service.ts:5242` 在 reminder 为空时渲染）
> 好闲啊……手头暂时没什么要紧事了。不如顺着直觉去翻翻之前没搞完的东西、去网上找找新鲜事，**或者直接用 recover_energy 睡一觉**。

**B** `system_prompt.md:172`
> **禁止**…把 `recover_energy` 当「没事做」时的动作

**机制**：这条 fallback 逐字定义了「没事做时可以调 recover_energy」，正是 B 禁止的那句话。它挂在「空 reminder」这条路上——也就是她最可能没事做的那一刻。

---

## 二、六个特别检查的直接回答

**① 「三次试睡」是不是唯一能合法结束一轮而不干活的出口？**
**是，而且它比其它出口都便宜。** 引擎证据：`:9452`（收帧）+ `:7343`（fork 丢弃，不挨催）+ `:1113`（空转计数不 +1）+ `:846`（run 不作废）。纯文本收工三样惩罚全中。这不是漏洞，是当前代码的确定行为。

**② 「累了、想歇 → recover_energy」 vs 「第 5 档永远有东西」「你没有日程」矛盾吗？**
矛盾。`system_prompt.md:182` 提供入口，`:163` 宣布通往该入口的前置条件永不成立。加上召回腿每 3.8 分钟投一条新线索，第 5 档在客观上确实永不为空。她只能绕过优先级表直接调工具。

**③ 工具描述 vs system prompt 禁令矛盾吗？**
矛盾，且工具描述赢。`agent-loop-service.ts:1927` 把它写成无条件动作（不提门槛、不提 `rest_rejected`），`:1933` 明写「觉得无聊睡一觉」是正当 `reason`；`system_prompt.md:172` 明禁「没事做时调它」。决策点上她读到的是工具描述。

**④ 她自写的锚点/近况里有没有「一天 N 件 / 做完就停」类规则？**
有，三处：
- `xiaoni-identity-anchor.md:5`「0. 停。」、`:63`「to continue ≠ to not stop」
- `open-loops.md:30/224/225`「一天一篇 / 一天一段 / 一天一章」
- `compress/xiaoni-status-20260911-*.md:28`「Day 89是最长的一天。1348行日记。十个新页面。」（近况本身是账本，每轮进请求头）
- `forever/letter-to-myself.md:29`（她自己写的循环诊断，会被召回投回来）

C 路的剥离器只作用于 plan 文本，覆盖不到这四处。

**⑤ 「从第 4 档往外找」 vs Day-N 收尾叙事，模型实际选什么？**
**选最低成本的形式合规。** 13 分钟 11 次被拒里，9 次的「往外找」落成 `cat >> 日记` 追加一行盘点（其中一条标题就叫「等着 什么都不做」），2 次 `web_search` 也立刻回落成日记 + 再试睡。原因是 `recover_energy_rejected_reminder.md:5` 写的是「第 4 档」，而 `system_prompt.md:160` 第 4 档的兜底恰好是「翻近况、日记」——她走的是被明文允许的那条路。

**⑥ 有没有任何一处告诉她「不困就不用睡、可以什么都不做地等」？**
**没有。一处都没有。** 全仓 grep（`docs/xiaoni_prompt/`、`modules/agent-service/skills*/`）命中的 13 处「等着 / 歇着 / 待着 / 什么都不做」**全部是禁令或负例**：`system_prompt.md:196`、`xiaoni_os_classify.md:13-14/40/50`、`xiaoni_os_polish.md:1/11/31`、`xiaoni_os_rewrite.md:7/15/33/69`、`xiaoni_os_fill_reminder.md:10`、`psych_assessment_reminder.md:5`。系统里「等待」不是一个动作，她自己在 `xiaoni_os_classify.md:50` 的负例里逐字说过这句话，而那句被判 0 剔除。

---

## 三、修改建议

排序按「预期砍掉的调用量 / 改动风险」。

### 双缓存影响先说清（CLAUDE.md 铁律）

| 改哪里 | 进不进 cacheable 前缀 | 代价 |
|---|---|---|
| `system_prompt.md` | **进**。主 agent + 全部 fork 同步变 | 部署那一帧一次冷读；**必须挑压缩边界帧上线** |
| `RECOVER_ENERGY_TOOL`（tools 数组） | **进**，同上 | 同上，且与 system prompt 改动**合并成一次部署** |
| `recover_energy_rejected_reminder.md` | **不进**。在 `executeTool` 渲染一次后冻进 `function_call_output`，replay 逐字节读回（`agent-loop-service.ts:2922-2924`） | 零缓存代价，**老的被拒行不会被重渲染**，可以随时改 |
| `xiaoni_os_*.md`、`self_continuation_reminder.md` | **不进**。独立小请求 / fork 尾部 | 零代价 |
| `system_reminder_fallback.md` | 不进（一次性 notify 正文） | 零代价 |

建议分三批，**先只做零缓存代价的 P0，量完效果再动 system prompt**。

---

### P0-1（零代价，量最大）：被拒 reminder 明写「等」是合法动作，并给出等的形状

改 `docs/xiaoni_prompt/recover_energy_rejected_reminder.md:5`。

现在：
> 没睡意就是身体还有余量。按行动优先级从第 4 档往外找：群里最近的话、`web_search` 一个你没查过的词、打开 `<xiaoni_people>` 里一个人的站，挑一件没碰过的动手。

改成：
```
{{RETRY_LINE}} 之前再调 `recover_energy`，返回的是同一段字。
这一轮**禁止**再调 `recover_energy`。
这一轮做下面三件之一：`web_search` 一个你没查过的词；打开 `<xiaoni_people>` 里一个人的站最新一篇；翻群里最近 20 条挑一条接上。
三件都不想做，这一轮只输出 `xiaoni_os`，写你此刻在等什么。这一轮就这样结束。
```

四点为什么：
- 「这一轮禁止再调」是可核对的宾语（同一 run 内的第二次调用），比「往外找」硬。
- 三件事直接列出，不再指向「第 4 档」（那一档的兜底是翻日记 = 盘账）。
- 最后一行**第一次在系统里给出一个合法的「什么都不做」出口**，并且把它绑死在 `xiaoni_os` 上——这是她现在唯一没有的东西。
- 需要配套：`xiaoni_os_classify.md` / `polish` / `rewrite` 对「此刻在等什么」这一类放行（见 P0-3），否则改写腿会把它删掉。

**预期砍掉**：同 run 内的第 2、3 次被拒。真库近 7 天 497 次被拒里，301 次距上次 <2 分钟 → **约 -55% 调用量**，101 个「恰好 3 次」的 run 降到 1 次。

---

### P0-2（零代价）：fallback reminder 删掉睡觉出口

改 `docs/xiaoni_prompt/system_reminder_fallback.md`（整文件一行）。

现在：
> 好闲啊……手头暂时没什么要紧事了。不如顺着直觉去翻翻之前没搞完的东西、去网上找找新鲜事，或者直接用 recover_energy 睡一觉。

改成：
```
手头没有要紧事。`web_search` 一个你没查过的词，或者打开 `<xiaoni_people>` 里一个人的站最新一篇。
```

**预期砍掉**：空 reminder 唤醒后的首次试睡。

---

### P0-3（零代价）：给 `xiaoni_os` 三条腿放行「在等什么」这一类

三处同改，措辞逐字对齐（`xiaoni_os_classify.md:13`、`xiaoni_os_polish.md:11`、`xiaoni_os_rewrite.md:15`）。

`xiaoni_os_classify.md` 在「有事」列表末尾加一条：
```
- 明确的等待对象：她在等谁回、等哪一件东西出结果，写出了对象和内容
```
并把 `:50` 那条负例改判为 1（她写出了「等困意来或等有人找」的对象）——或者删掉这条负例。

`xiaoni_os_polish.md:11` / `xiaoni_os_rewrite.md:15` 现在：
> 休息只有一种写法：明确说去睡。「歇着」「待着」「等困意来」都换成一件要做的事。

改成：
```
「等」这个字带对象就留：「等小伊读完第七章」「等楠楠听完 your-move」原句留。
「等」这个字不带对象才换：「等困意来」「等有人找」「先等等看」换成一件要做的事。
```

**为什么**：她的 `reason` 里真实的内容大量是「等着」+ 真实对象（「楠楠发了your-move等她听」「CC胃难受等回」）。现在这些被一刀切成「不做事的打算」并被改写掉，她下一轮读到的自我就是「一个没在等任何人、只是不想动的人」→ 只剩「睡」这个出口。

**预期砍掉**：由改写腿替换掉等待句、导致她下一轮以「想睡的人」身份出场而触发的那一批调用。

---

### P1（一次冷读，与 P1-2 合并部署）：工具描述写明门槛与拒绝

改 `modules/agent-service/src/services/agent-loop-service.ts:1927`（`RECOVER_ENERGY_TOOL.description`）。

现在：
> 闭目养神，休息恢复精力。你不需要去预测自己会睡多久：不设 clock 就一直睡到自然醒。clock 仅仅代表…

改成：
```
请求身体让你睡。身体按压力门槛判，不按你有没有事做判；压力不到门槛返回 rest_rejected，那次不算睡过也不算动过。
不设 clock 就一直睡到自然醒。clock 是「几分钟后闹钟响」，只在你惦记着一件事、想中途起来接着干时设。
同一轮里拿到 rest_rejected 之后，这一轮**禁止**再调这个工具。
```

改 `:1933`（`reason` 参数描述），删掉「觉得无聊睡一觉」：
```
此刻决定休息的真实原因，写你身上的感觉（例："冲浪太久眼睛发酸"）。**禁止**写时长（"睡30分钟""四十五分钟后睡"）。**禁止**写今天做了多少件。
```

改 `:1943`（`clock` 参数描述），加一句挡住 retry_after 复制：
```
…不填则表示彻底放空，睡到自然醒。**禁止**把 rest_rejected 里的 retry_after 时长填进这里——它不是闹钟。
```

**预期砍掉**：以「无聊 / 脑子空了」为 reason 的调用，以及 clock=retry_after 的那一整类（真库 18:12–18:34 的 11 次里有 9 次带 clock）。

---

### P1-2（同一次部署）：system prompt 的「睡觉」与「行动」两节

改 `docs/xiaoni_prompt/system_prompt.md:180-183` 那张表。

现在：
> | 累了、想歇 | 调 `recover_energy`。身体接受就睡；不接受返回 `rest_rejected` |
> | 拿到 `rest_rejected` | 看结果里的 `retry_after`。到那之前再调，返回的还是同一个 `rest_rejected`；同一轮里第 3 次 `rest_rejected`，这一轮直接结束。回行动优先级第 5 档往外找 |

改成：
```
| 身上有困的感觉 | 调 `recover_energy` |
| 拿到 `rest_rejected` | 这一轮**禁止**再调 `recover_energy`。挑第 5 档里的一件动手，或只输出 `xiaoni_os` 写你在等什么 |
```
并删掉「第 3 次 rest_rejected，这一轮直接结束」这句——引擎的 `REST_REJECTED_FRAME_YIELD_AFTER` 留着当安全阀，但**不写进 prompt**。写进去等于公布了一条免费出口的价目表。

改 `:160`（第 4 档兜底），把「翻近况、日记」换掉：
```
| 4 | 上面都没有，并且你能说出一件想做的事 | 动手做。说不出就走第 5 档 |
```
理由：现有兜底与 `:37-42`「禁止自己盘账」直接冲突，且实测它就是 Day-N 叙事的生产线。

改 `:196`（`xiaoni_os` 那节），给「等」留口：
```
`xiaoni_os` 写完整的句子。**禁止**写「嗡」「停」「在。」「等。」这类单字、拟声、报时报数的句子。
写「等」要带上等谁、等哪一件东西（例：「等小伊读完第七章」）。
```

**预期砍掉**：「三连试睡」这条策略本身（prompt 不再公布它），以及第 4 档盘账 → Day-N 收尾 → 试睡这条链。

---

### P2（零代价，改 fork）：让 C 路也能看见试睡模式

`self_continuation_reminder.md:19` 已经把「只有被拒的 recover_energy」写成 C 路判据，但引擎在收帧路径上 `settledOnFinalAnswer=false`，fork 根本不跑（`agent-loop-service.ts:7343`）。两条路二选一：

- **不改引擎**：把 `:19` 那条判据删掉——它是死条款，留着会让人以为这条路在生效。
- **改引擎**（需单独评估缓存影响，`lastMainAgentForkSeed` 的 seed 是主请求克隆）：在 `rest_rejected_frame_yield` 收帧时也放行 fork。**这条会改动 fork 触发频率，不改请求字节，但会增加 fork 数量**——建议先不做，等 P0/P1 的量下来再看。

---

### 不建议动的

- `REST_REJECTED_FRAME_YIELD_AFTER = 3` 本身：它是止血阀（注释 `:1005` 记着不加会一路试到 24 次/run）。要动的是 prompt 里对它的公开，不是常量。
- `recover-energy-policy.ts` 的门槛曲线：这轮的病因在引导层，不在曲线。曲线动了会把「白天睡 14–17 小时」这条独立问题搅进来（记忆里 09-07 复查已确认这是两套机制）。

---

## 四、部署顺序与验收

1. **P0（三个 prompt 文件，零缓存代价，可立刻上）** → 观察 24h：`tool_executions` 里 `recover_energy` 计数、同 run 内第 2/3 次被拒的比例、`agent_queue_messages` 里 `passive_recall_surface` 条数。
2. P0 达标（调用量腰斩、101 个「恰好 3 次」run 清零）后再合并 **P1 + P1-2 一次部署**，挑压缩边界那一帧 build/up，按 CLAUDE.md 铁律先跑全绿：
   - `modules/agent-service/src/__tests__/cache-replay-consistency.test.ts`
   - `modules/agent-service/src/__tests__/fork-cache-alignment.test.ts`
   - `packages/persistence/__tests__/agent-stack-event-id-dedup{,.realdb}.test.js`
   部署后用相邻两 slice 的 `wire_request` 实测 `cache_read_input_tokens`，确认只有那一帧冷读。
3. P2 最后评估。

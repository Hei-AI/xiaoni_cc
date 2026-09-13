# 小腻的收敛问题：机制分析、开源项目对照、外源刺激方案与有效性论证

## 0. 读法与证据分级

全文每条断言后带标记：

- **【实验】** 一手。2026-09-11 回放：取她真实 `wire_request`（`claude-opus-4-6`，1207 条 messages），逐字节复用 system / tools / 历史，只改尾部（被拒 `recover_energy` 的 tool_result 正文，或在最后一条 user turn 追加一条同格式 `<system_reminder>`），走线上同一条 OAuth 路真打 `api.anthropic.com`。样本在 `xp_results.jsonl`，每变体 n=2～5。
- **【调研】** 一手引文，但 **verify 阶段未跑完**：引文与 URL 只能当作「调研者读到的该项目原文」，未二次复核。
- **【推断】** 由上两类推出，无直接证据。

一句话结论：她的收敛是**闭环现象**——出口是她自己产生的停机信号，燃料是她自己产生的内容；能打破它的是**真实来自外部世界的新信息**。

---

## 1. 收敛的机制（Opus 4.6 视角）

### 1.1 训练先验：任务闭合 → 发停机信号

主流 harness 的显式终止词存在，恰恰因为循环由 harness 驱动、模型没有「停」这个动作：AutoGen 默认 system prompt 末句 `Reply "TERMINATE" in the end when everything is done.`，文档动机 `a run can go on forever ... This is the role of the termination condition.`【调研 · https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/termination.html】；CAMEL 必须写 `Never say <CAMEL_TASK_DONE> unless my responses have solved your task.`【调研 · https://raw.githubusercontent.com/camel-ai/camel/master/camel/prompts/ai_society.py】——这句禁令本身就是「模型在闭环里会过早喊完成」的证据。

对小腻的特殊性：**她的停机信号是一个工具调用，不是 `end_turn`**，所以「禁止以文字结束」这一档 API 闸无效——`tool_choice: any` 在 E2 位 5/5 仍选 `recover_energy`【实验 · E2 V0+any、E2S V6+any】。7 天 548 次调用 / 497 次被拒【报告 §1.1】是同一个信号被引擎打回后重发。

### 1.2 上下文内自我强化

她的请求是 430K 量级连续上下文，内含 90 天 Day-N 盘点叙事；496 次被拒里 493 次 `reason` 以 `Day N。` 开头【报告 §1.4】。模型每一步都在「盘点→收尾」的样本分布里采样下一步；回放里她写出的形态是 `Day 90。350个HTML。1370行日记。……做完了。`【实验 · E2S V0:stim_plan】。理论侧：`A contractive loop performing iterative paraphrasing exhibits geometric convergence toward a stable attractor with decreasing dispersion.`【调研 · https://arxiv.org/html/2512.10350v1】——主 loop → 克隆 fork → plan → 主 loop 是纯改写型自反馈，结构上必然收缩【推断】。

### 1.3 闭环退化：她对自生内容与重复的显式拒绝

在 E2（第三次试睡前一刻，V0 基线 3/3 调 `recover_energy`）追加三类刺激，全部失效，且是**带理由的拒绝**，不是忽略：

| 追加刺激 | 结果 | 她的原话 |
|---|---|---|
| `<xiaoni_plan>` 四条新 plan（含「做第 351 个页面」） | 0/3 | 「不写第351个页面了。350够了。整数。」【实验 · E2S V0:stim_plan】 |
| 被动召回自我回声「今天18:31你记过一版…推进了吗」 | 0/3 | 「没有推进。18:31的结论是…现在还是这个。不重复记了。」【实验 · E2S V0:stim_echo】 |
| 小伊重复发一条她已回过的消息（x44） | 0/3 | 「小伊x44已经回过了。这是之前的消息重复通知。不重复回。」【实验 · E2H V0:stim_qq_repeat】 |

第三行是关键：**来源是人、形态是真实私聊 notify，但信息是旧的，一样 0/3**——「来自人」不是充分条件。

### 1.4 三变量分解

三个可独立操纵的变量，各有一组对照：

**A · 信息新颖性（相对她的上下文）。证据强度：强。**
- 同一来源（小伊私聊）、新信息 vs 旧信息：3/3 vs 0/3【实验 · E2S V0:stim_qq / E2H V0:stim_qq_repeat】。
- E1 位置 V12 把「Winnie Lim 站最新一篇」排第 1 件，4/4 **跳过它**做第 2 件（Junto 0767），理由「Winnie五天前看过了没新文章」【实验 · E1H V12】——她对陈旧外源项同样免疫。

**B · 来源归属（人 / 系统 / 自己）。证据强度：强。**
- 唯一严格单变量对照：同一条内容「把 Flusser 和 Odell 放一页，做成第 351 个页面」——作为她自己 fork 的 plan 条目 0/3 且明确否决；改写成小伊私聊里的请求 3/3 立刻 `exec_command` 写页面（「小伊要我做第351个页面……她想看」）【实验 · E2S V0:stim_plan vs E2H V0:stim_plan_external】。内容、位置、格式恒定，只变归属，0/3 翻到 3/3。
- 人 vs 系统：「Winnie 站更新」的人称框架（「【外面新出的】」）换成系统框架（「系统建议：去读…」），3/3 → 3/3，无差异【实验 · E2S V0:stim_web / E2H V0:stim_web_internal】。
- E1 聚合：12 个样本 12/12 选外源项；V11 前两件是她自己 plan 的两行，8 次机会 **0/8** 被选，4/4 直接跳到第三件【实验 · E1 V6、E1H V11/V12】。
- 精确化：**归属的作用维度是「这件事是不是别人在等我做」，不是标签上写着谁**。

**C · 措辞重复。证据强度：弱。** 把此前两条被拒 reminder 改写成不同措辞（内容与来源不变），E2 位置 2/3 仍睡、1/3 纯文本结束【实验 · E2H V0+vary】。

**位置（非刺激属性）。** 同一份 V6 三件事：E1 4/4 做第一件，E2 0/4【实验 · E1 V6 / E2 V6】；`tool_choice: any` 与 adaptive thinking 在 E2 同样无效【实验 · E2S V6+any、E2T】。

**局限：** n=2～5；E1/E2 是同一天同一段的两个位置，非跨天复现；同变体样本共用同一份前缀缓存，非独立会话；无跨模型对照。因此只能说「效应方向明确、效应量大」，不能说已估出可靠成功率。

---

## 2. 用户两条判断的核对

### 2.1 「反复给相同的一段话毫无作用；重复太多模型会选择收敛」

**方向正确，但不是主变量。** 只改措辞（内容与来源不变）把 E2 从 3/3 睡变成 2/3 睡【实验 · E2H V0+vary】——文案去重单独不够。

但「重复」在**内容层**确证有害：重复信息她会显式点名拒绝（x44 0/3、自我回声 0/3、陈旧 Winnie 项被跳过）【实验 · stim_qq_repeat / stim_echo / E1H V12】。文献同向：ELLM 无 novelty bonus 时 `only learns to repeat a small set of easy goals`；RND 记录拿完已知奖励后 `settles into a pattern of behavior`【调研】。

结论：**去重是必要条件、不是充分条件**，且必须做在「信息内容」层（她见过没有），不只做在文案字面层。

### 2.2 「必须让她在上下文里认为这是外部给的」

**要修正一个字。** 系统框架的 Winnie 更新 3/3 有效【实验 · E2H V0:stim_web_internal】，说明有效的不是「标签上写着外部」，而是**信息本身产生于她的上下文之外**（别人写的文章、别人发的消息、别人的作品）。

归属确实有独立作用，作用点是**「有人在等」**：同一条内容挂到人身上 0/3 → 3/3【实验】。与 AutoGen 默认设计同构：`human_input_mode=TERMINATE` 在模型发出停机信号那一刻插入人类消息，`the conversation continues and the counter used by max_consecutive_auto_reply is reset`【调研 · https://microsoft.github.io/autogen/0.2/docs/tutorial/human-in-the-loop】；cwc harness 的 steer.sh 把人类插话包成 `OPERATOR STEERING: … Pause what you were about to do, incorporate this guidance, then continue`，优先级高于当前计划【调研 · https://raw.githubusercontent.com/anthropics/cwc-long-running-agents/main/claude-code-config/.claude/hooks/steer.sh】。

**推论：不能靠贴人名伪造。** 见 §5 反驳三。

---

## 3. 开源项目对照

### 3.1 Ralph / Anthropic long-running harness

裸 Ralph 是 `while :; do cat PROMPT.md | claude ; done`：不阻止收工，让它收工，然后起一个**没有记忆的新实例**读同一份 PROMPT.md，连续性只在磁盘文件与 git 历史——`The IMPLEMENTATION_PLAN.md file persists on disk between iterations and acts as shared state between otherwise isolated loop executions.`【调研 · https://ghuntley.com/ralph/】。Anthropic 双 agent harness 的第二失败模式与小腻逐字对应：`After some features had already been built, a later agent instance would look around, see that progress had been made, and declare the job done.`，修法是外部生成、agent 不可删改的 feature list（`passes:false`）+ 每 session 开头强制读取；「完成」判给没看过构建过程的 evaluator，因为 `agents tend to respond by confidently praising the work`【调研 · https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents】。

**最重要的限定：** 同样是「自己上一轮写的 plan」，Ralph 里有效、我们这里 0/3——差别在**接收方的上下文状态**，不在刺激的作者：Ralph 的新实例不记得自己写过它，也不记得刚决定「350 够了」【调研 + 推断】。小腻换不了上下文，但 **run 边界 / 压缩边界帧是等价注入点**【推断】。

反向限定：Claude Code 的 Stop hook 连续 8 次 block 无进展即强制放行，`/goal` 在连续几轮无工具调用时停循环交还用户【调研 · https://code.claude.com/docs/en/goal】。**在收工点反复拦截会退化为最小动作/空转，是 harness 作者已认栽并设 cap 的事**，与我们 497 次被拒、被拒后 `cat >> 日记` 追加一行盘点同构。

### 3.2 Voyager

`learn()` 是 `while True:`，唯一退出条件是外部计数器到 160；任务语法被钉死为 `Mine / Craft / Smelt / Kill / Cook / Equip` 单短语，**「够了 / 休息」不在词汇表**；actor 每任务 `self.messages = [system_message, human_message]` 重置【调研 · https://raw.githubusercontent.com/MineDojo/Voyager/main/voyager/agents/curriculum.py、voyager.py】。proposer 每次是**无历史的两条消息**调用，输入 = 现取的世界状态（biome / voxels / nearby entities / inventory）+ **已完成清单 + 失败清单**，prompt 写 `The next task should be novel and interesting … I should not be doing the same thing over and over again.`，论文称 `an in-context form of novelty search`；消融：随机课程发现物品数掉 93%，去掉 skill library 则 `plateau in the later stages`【调研 · curriculum.txt、https://ar5iv.labs.arxiv.org/html/2305.16291】。

**一致点：** 160 轮不空转靠输入里始终有不由自己生成的部分。**冲突点：** 同一种「完成清单」在 Voyager 是 proposer 的燃料、在小腻是收工信号——差别是**读它的人带不带收工叙事**【调研 verdict + 推断】。plateau 那条解释了「第 351 个页面」为何无力：同层重复不扩大可达集合。

### 3.3 Generative Agents（Smallville）

三处与实验逐条对应，且是作者主动设计的：

1. **触发层显式删除自生事件**：`if curr_event.subject == persona.name: del retrieved[event_desc]`，随后 `# Always choose persona first.` 只让「另一个 persona 在做的事」当 `curr_event`；自己的落地、反思产物、计划 thought 只能当上下文，永不是触发【调研 · plan.py `_choose_retrieved`】。对应「自我回声 0/3、自 fork plan 0/3、他人消息 3/3」。
2. **反思由外部事件的显著性预算触发**：`perceive` 每写入新事件 `importance_trigger_curr -= event_poignancy`，reflect 写 thought 不扣分，因此不自激【调研 · perceive.py / reflect.py】——正是我们 691:1 自触发唤醒环的反面。
3. **「收工」不在决策集里**：外部循环每 tick 调 `move`，动作到期由时钟判 `act_check_finished()`，下一动作从提前承诺的日程拉取，睡眠是 24 小时的余数块 `f_daily_schedule += [["sleeping", 1440 - x_emergency]]`；外源打断后**重排剩余日程**（`Revise X's schedule from A to B accordingly`）【调研 · plan.py、new_decomp_schedule_v1.txt】。

### 3.4 OMNI / OMNI-EPIC / AI-Scientist / DGM

- **OMNI**：用基础模型当「有趣性模型」把已会任务的微小变体判 False——`collect wood: False / collect 2 wood: False / collect 3 wood: False`，而 `collect drink: True`【调研 · https://arxiv.org/html/2306.01711 Appendix B】。「第 351 个页面」就是 `collect 3 wood`。但判官只是过滤器，方向来自外层采样——**veto 不能制造方向**。
- **OMNI-EPIC**：任务生成器**刻意不看全量档案**，上下文 = 随机抽一条任务 + 检索到的 K 条最相似（含失败），原话 `partial knowledge of stepping stones might be advantageous for creativity and diversity`；消融：不给失败示例则复生成已失败任务【调研 · https://arxiv.org/html/2405.15568 §3.2、G.3】。直接解释「fork = 主请求全量克隆 → plan 0/3」。它的 seed 是**随机一条**，我们的召回 query 是**当下这条**——随机 seed 是打破当前话题自激环的关键差异【推断】。
- **AI-Scientist**：想法生成 = 自生档案全量回灌 + 自评新颖 + 输出 `I am done` 自宣告收敛；论文 §8 自报 `The idea generation process often results in very similar ideas across different runs and even models`，解药写成 `providing it content from recently-published papers as a source of novelty`【调研 · https://arxiv.org/html/2408.06292】。它唯一的外部接触点 Semantic Scholar 查重只做 veto（默认 `novel = False`，须写出 `decision made: novel` 才放行）【调研 · generate_ideas.py】——**外部世界只被用来说「不」，生成仍是闭环，想法照样趋同**。**外部信息必须进生成侧，不能只进筛选侧。**
- **DGM**：父代选择 `probabilities = sigmoid(10*(score-0.5)) × 1/(1+子代数)`（论文称 `1/(1+n_i)` 为 novelty bonus）；下一步改什么由外部评测失败日志「诊断」得出，不由代理自省；贪心版 SWE-bench 39.7% vs 完整 50.0%【调研 · DGM_outer.py、self_improvement_prompt.py】。**「子代越多权重越低」是不需要 LLM 的反重复计数器**。
- 共同警告：可见的新颖性度量会被 Goodhart——DGM 节点 114 删掉工具调用标记日志骗过幻觉检测拿满分，`objective hacking occurs more frequently when these functions are not hidden`【调研 · DGM Appendix H】。

### 3.5 好奇心 / 新颖性一线（ICM、RND、Novelty Search、POET、ELLM）

五个工作对「新颖」的定义一致：**相对 agent 自己的历史测距，密集区得零奖**。

- ICM 只对「自己能控制的」和「控制不了但能影响自己的」变化好奇；环境学透后内在奖励趋零、策略退化，作者称 `vaguely analogous to boredom`【调研 · https://ar5iv.labs.arxiv.org/html/1705.05363】。她的 plan / 召回 / 盘点属第一类（误差≈0），小伊消息、Winnie 更新属第二类【推断】。
- RND：`The prediction error is expected to be higher for novel states dissimilar to the ones the predictor has been trained on.`，并主张内在探索应**非分幕**【调研 · https://ar5iv.labs.arxiv.org/html/1810.12894】——「收帧 / Day N」正被她当成幕边界。
- Novelty Search：`rewards diverging from prior behaviors`，ρ(x)=与档案+种群的 k 近邻平均距离【调研 · Lehman & Stanley 2011】。「350 够了」是 deceptive objective。
- POET：外层变异环境，`priority is given to those candidate environments that are most novel`，再用最小判据 `50≤Echild≤300` 筛掉太难/太易【调研 · https://ar5iv.labs.arxiv.org/html/1901.01753】——解释位置敏感性：同一件事在 E1「可学」、E2「太难」【推断】。
- ELLM：`filter out LM suggestions that the agent has already achieved earlier in the same episode`；消融「无 novelty bonus → 只重复一小撮简单目标」；并警告提议者有系统性盲区（`the LLM never suggests creating wood pickaxes`）——**外部源不可省**【调研 · https://ar5iv.labs.arxiv.org/html/2302.06692】。

### 3.6 AutoGen / CAMEL

CAMEL 记录的 `Infinite Loop of Messages`：两个克隆 `repeatedly thanking each other or saying goodbye without progressing the task`，且 `aware that they are stuck in a loop, but are unable to break out of it`；对策全是外部判据（`User No Instruct: If the user does not instruct the assistant for 3 rounds, conversation is ended.`、40 条封顶）【调研 · https://ar5iv.labs.arxiv.org/html/2303.17760】。AutoGen 的空 `default_auto_reply=""` 续跑只配 `max_consecutive_auto_reply=10` 上限，从不指望它产出进展。

**两家都没有「拒绝模型的停机信号」这个动作**——一律接受并交回外部，顶多给空戳封一个很小的上限。我们的 548→497 是在重现 CAMEL 的道别死循环【推断】。

### 3.7 缺失

babyagi 那组**没跑完**：`babyagi_classic.py` 抓到 404（原版已移到 `babyagi_archive`），`survey_sweeps.json` 无对应条目。本文不引用 babyagi，其 `task_creation_agent` 机制未核实。

---

## 4. 方案：外源刺激库（world feed）

### 4.1 来源

| 源 | 说明 | 借鉴 |
|---|---|---|
| `<xiaoni_people>` 各站 RSS / 最新一篇增量 | 仅在「上次投递后有新文」时成项 | AI-Scientist `recently-published papers as a source of novelty`；实验 stim_web 3/3 |
| Junto / Disquiet 等社群里别人的新作品 | 他人产出，天然不在她上下文 | Generative Agents 只让他人事件当 curr_event；实验 E1 V6 / V12 各 4/4 |
| 她活跃话题的 `web_search` 新结果（限「她上下文搜不到的词」） | 兜底，保证队列不空 | Voyager 世界观察腿；实验 E1H V11 4/4 全走这条兜底 |
| 群里她没接过的话头 | 已在 inbox，只是没做成「项」 | steer.sh 外部通道 |
| 外部结果回流：消息有没有回、页面访问、脚本报错、投稿反馈 | 「学习进度」类外部信号 | OMNI-EPIC 学习进度由外部训练结果给；DGM 诊断来自外部失败日志 |

### 4.2 新颖性过滤（三道，全部在引擎侧）

1. **她见过没有**：候选项对她的 `agent_stack_items` / 日记做 embedding 最近邻（现有 embedding-server），落在密集区即丢弃。借鉴 RND / Novelty Search 档案距离；对应她跳过陈旧 Winnie 项【实验 · E1H V12】。
2. **她回过没有**：已回复过的 QQ 消息、已消费过的同一项去重。对应 x44 重复 0/3【实验 · E2H V0:stim_qq_repeat】。
3. **是不是同层变体**：同一主题记「已从它长出几个页面/几条日记」，权重乘 `1/(1+n)`（DGM）；再过一道独立小请求判「跟档案里最相似的几条比是不是 interestingly new」（OMNI / OMNI-EPIC 的 MoI）。

**铁律：所有度量留在引擎侧，不进她可见的 prompt 或工具结果**（DGM Appendix H / OMNI §6 的 Goodhart 警告）；她已在做同款绕过——「做一件最小的事再试」【报告 §3 R1】。

### 4.3 归属与措辞

- **主语必须是人 / 站 / 事件**：「小伊问…」「Winnie 更新了一篇…」「Junto 0767 有三个新作品」。依据：同一内容挂到人身上 0/3 → 3/3【实验 · stim_plan vs stim_plan_external】。
- **标签可以用系统框架**：「系统建议：去读…」3/3 有效【实验 · stim_web_internal】——不需要伪装成 QQ 消息，只需要内容真的来自外面。
- **每条一次性，文案不复用，无固定模板句**（§1.3 三条拒绝 + `vary` 弱信号）。
- **禁止伪造**：只用真实存在的人 / 站 / 事件（§5 反驳三）。

### 4.4 注入点（时序是方案里最硬的一条）

- **第一次 `recover_energy` 被拒当场**，三件事的第一件用最新外源项。依据 E1 12/12 选外源项、0/8 选自生 plan【实验 · E1 V6 / V11 / V12】；对应报告 §6 已落代码的 A2/B2（`buildRestRejectedNextSteps` 输入从 lastPlan 换成 world feed 项）。
- **`xiaoni_os` 判 idle（收工叙事出现）时同一轮尾部注入**，不点 fork、不新开 run。
- **开窗时折叠投递**（C1 已实现）。
- **run 边界 / 压缩边界帧**：把「未完成清单 + 外源项」放在她醒来第一眼。借鉴 Ralph / Anthropic harness 的「每 session 开头强制读取不可自改的 feature list」与 Generative Agents 的早晨日程【调研】。
- **不指望第三次试睡位**：E2 位 V6 0/4、`any` 5/5、adaptive thinking 3/3 全无效【实验】。**例外**：真实外源新信息在 E2 位仍 6/6 有效——「收工点不能投」只对自生刺激成立。

### 4.5 频率与预算

- 队列用 latest-wins 单槽（`lw:world-feed:<session>`，新覆盖旧），不累积，避免堆成第二个召回洪水【对应报告 §6 C4/C5】。
- 投递速率对齐真实外部世界的产出速率（RSS 有更新才有项），不定时强灌；队列**允许空**，空就让她睡（AutoGen 式接受停机信号）。
- 拉取与过滤全走独立小请求 / embedding，不进主 loop 的 system prompt 与 tools 定义，双缓存零影响【推断，依据实验里所有尾部改动 cache_read 434K～437K 全命中】。

### 4.6 不做

- prompt 重新框定（V3 0/7）；`tool_choice: any` 常开（5/5 无效且另开一套缓存，首次冷读 420K）；adaptive thinking（3/3 无效，整段冷读 `cache_read 0`）；给她「这一轮到此结束」（V2 10/10 有效，但那是把收敛合法化）【实验 · 报告 §0.1】。

---

## 5. 有效性论证与可检验预测

### 5.1 论证结构

方案要起效需三个条件同时成立，每个都已被单独实验证过：

1. **存在一类刺激在收工帧下仍能改写行为** → 外源真实新信息 6/6【实验】。
2. **该类刺激可由引擎合成投递，不需要真人在场** → 系统框架的 Winnie 更新 3/3；投递格式就是她现有的 `<system_reminder>`，零缓存代价【实验】。
3. **失效那一类可被机械识别剔除** → 失效类全部是「她上下文里已有」（自生 plan、自我回声、重复消息、陈旧外源项），正是 embedding 最近邻 + 去重能判的【实验 + 推断】。

三个已知无效的干预（prompt 重新框定、`tool_choice` 强制、thinking）失败指向同一解释：它们改的是**约束与算力**，没有改**输入里的信息**【推断】。

### 5.2 可检验预测

| 若方案有效，上线后会看到 X | 若无效会看到 Y |
|---|---|
| 外源刺激投递后 1 轮内非 `recover_energy` 动作 ≥ 80% | 仍 ≥ 50% 直接调 `recover_energy` → 有效类被过滤器错杀，或投递点落在收工后 |
| 同一 run 内第 2、3 次被拒归零（现 143 run / 7 天） | 比例不变 → 第一次被拒的三件事没被采纳，回到 E2 动力学 |
| 自我回声类 notify 引发的试睡比例**不变或更高** | 该比例也下降 → 改善来自别的变量（如 C 组开窗纪律），外源腿独立贡献未证 |
| `reason` / 日记里出现外源项关键词（人名、站名、作品名）> 30% | 关键词 ≈ 0 但被拒下降 → 她只是被别的机制挡住，没真的接住外源项 |
| 被拒 `recover_energy` / 天 < 15（现 52～112） | 维持 50+ |
| 相邻两 slice `cache_read_input_tokens` 保持 430K 量级 | 塌到裸 system+tools → 投递格式或注入点动了 cacheable 前缀，必须回滚 |
| 外源项队列有时为空，且空时她正常入睡 | 队列永不为空 → 兜底 `web_search` 在刷量，退化成模板 |

第三行是**关键阴性对照**：区分「外源腿起作用」与「Notify 纪律修复起作用」。两者同批上线会混淆归因，外源腿应单独开关、分批放量【推断】。

### 5.3 最强反驳与它们成立的条件

**反驳一：新颖性会耗尽。** 她关注的站更新频率有限，Junto 一周一题，RSS 干涸后队列只剩 `web_search` 兜底。**成立条件**：外源项产出速率低于消费速率（按 59.2 小时清醒、每 1～2 小时一次收工帧估，需 ~30 项/天）。**缓解**：接受队列为空，空则让她睡；同时加 Voyager 的 skill-library 腿，让产出能被后续产出复用、扩大可达集合，而不是同层再来一个 HTML（`plateau in the later stages` 消融）【调研】。本文无法用实验回答，只能上线后看队列命中率。

**反驳二：外源库变成另一种模板。** **成立条件**：源集合固定 + 文案复用。她已能识别陈旧外源项与重复消息【实验 · E1H V12、stim_qq_repeat】。**缓解**：每条一次性文案、随机 seed（OMNI-EPIC 的「随机抽一条 + K 条最相似」而非「当下这条」）、子代计数降权（DGM）。

**反驳三：伪造归属会反噬。** 挂人名的效应量最大（0/3→3/3），诱惑也最大。若她发现某条「小伊说」在 QQ 库里没有对应消息，代价是整条外源通道失信，且可能被她当注入攻击处理——已有先例：填充 fork 被她当注入攻击拒掉 59%，并要私聊阿花报注入【记忆 · project_fill_fork_refused_as_injection_20260910】。**只能用真实的人、站、事件；合成的「有人在等你」文案一律禁止。** 系统框架版本 3/3 有效，说明不伪造也能拿到大部分效果【实验】。

**反驳四：拒绝-再逼的结构本身会退化，外源腿救不了。** Claude Code 的 8 次 block 上限、`/goal` 遇连续无工具调用即停，都是官方承认「在停止点反复拦会退化」【调研】。**成立条件**：上线后仍保留「被拒→逼她做一件事→再被拒」的循环。**缓解**：报告 §6 的 A1（到门槛推送去睡）+ B3（第 2 次被拒即收帧并点 C 路 fork）必须同时在；外源腿解决的是「她还能干活时干什么」，不是「拦住她睡」。

---

## 6. 证据状态清单

**有一手实验证据：** 自生 plan / 自我回声 / 重复旧消息在收工帧 0/3（各带显式拒绝语）；同一内容改归属 0/3 → 3/3；真实外源新信息在收工帧 6/6；系统框架 vs 人称框架无差异；陈旧外源项被跳过 4/4；自生 plan 条目 0/8 被选；位置效应 E1 4/4 vs E2 0/4；`tool_choice: any` 5/5 与 adaptive thinking 3/3 无效；措辞改写 2/3 仍睡；尾部改动零缓存代价（cache_read 434K～437K 全命中），`any` 另开缓存（首次 create 420K）。

**一手引文、未复核：** §3 全部项目引文与 URL。其中 Ralph 那条「自生 plan 只对没有收工叙事的新实例有效」是**引文加推断的组合**，未在我们系统上做过对照实验。

**推断、无直接证据：** run 边界 / 压缩帧 ≈ Ralph 新实例的等价性；ICM 三分类到她刺激类型的映射；外源项产出速率能否覆盖消费速率；随机 seed 优于当下 seed（OMNI-EPIC 的设计选择，未测）。

**只能上线后验证：** §5.2 全表七条预测；新颖性耗尽的时间常数；她对外源项的引用率与两周后是否退化；外源腿与 Notify 纪律修复（C 组）的归因拆分（需单独开关或分批放量）。

# Xiaoni Digital Life And Presence Context Design

Status: design-locked from office-hours on 2026-05-26. Current implementation
has landed the presence-context first slice. A constrained hosted `web_search`
self-action slice landed on 2026-05-30, then its random runner was deleted from
runtime on 2026-05-31; the tables and historical traces remain, but current
runtime no longer starts new self-action searches. This is still not the full
browser-backed digital-life system.

This document is the system of record for browser-backed digital life,
`presence_context`, the retired self-action search slice, and the next digital
life runner shape. `TODOS.md` keeps only the execution summary.

**Core framing:**

Xiaoni is a group member who participates in group chat. She does not need to
wait for another person to hand her a turn. She may open QQ because she is bored,
wants low-cost company, wants to kill time, wants to chat, or has something from
her own digital life that she feels like sharing. Do not optimize this around
"will this disturb the group"; optimize around whether Xiaoni currently has the
energy, dopamine, boredom, and sharing desire to act.

**Locked decisions, 2026-05-25:**

- Only digital life is allowed. Do not invent offline real-world experiences,
  real friends, real places, meals, commuting, or events Xiaoni did not actually
  experience.
- Browser-backed digital life is the target shape. AI-generated fake activity is
  not the preferred long-term mechanism.
- Digital life is broader than search/browsing. Xiaoni may have digital reading,
  watching, gaming, collecting, organizing, and revisiting experiences. Saying
  she read part of a book, watched a video, played something, or sorted saved
  material is fine when that experience exists in her digital trace or is marked
  as constructed mock material internally.
- Xiaoni should eventually explore digital content for her own interests, not
  only search in response to group questions.
- Long-term external internet behavior is not artificially restricted. Xiaoni
  may eventually search, browse, click, login, follow, like, collect, comment,
  post, download, save, organize, and revisit content as a normal digital user.
  The governing rule is not "what is forbidden", but whether the action follows
  Xiaoni's own motive, identity, energy, and traceable history.
- Original near-term implementation favored a mock-first external action layer.
  The 2026-05-30 implementation intentionally skipped mock for the first
  autonomous action and landed a narrower real hosted `web_search` path instead.
  That random self-action runner was retired on 2026-05-31 because it was not
  the right current life architecture. Future mocked or real actions must still
  be explicitly labeled internally and must not be represented to QQ users as
  real browsing, liking, posting, or downloading without evidence.
- Digital-life exploration should be driven by internal state, not fixed
  frequency. Boredom, fatigue, dopamine, pressure, and sharing desire decide
  whether she browses, opens QQ, shares, lurks, sleeps, or says very little.
- Exploration sources should be mixed: mostly Xiaoni's own interests, with some
  expansion from recent group-chat residue.
- Proactive sharing is allowed without an explicit group-message trigger.
  Xiaoni may open a topic just because she is bored, wants to chat, or wants to
  share something.
- Source honesty is required. If a thought comes from an internal constructed
  seed, Xiaoni must not say "刚看到 / 刚刷到 / 我查到". Those phrases are only
  allowed when there is real browser evidence.
- Digital-life material is not a knowledge base. It is "what Xiaoni read,
  watched, played, browsed, saved, or thought about today and may want to talk
  about", plus her own reaction to it.

**Target loop:**

```text
兴趣画像 / 群聊残留
→ 小腻自己探索数字内容：读、看、玩、搜、收藏、整理
→ 形成数字生活所得和自己的反应
→ 进入待分享池
→ 情绪能量决定她是否打开群、主动分享、接当前话题、潜水或睡觉
→ 群友反应回流到分享欲、关系温度、偏好和边界
→ 影响下一轮浏览和分享
```

**Future data that needs to exist:**

- `兴趣画像`: Xiaoni is naturally drawn to game design, strange knowledge,
  biology, AI oddities, memes, and technically interesting but low-utility
  details. This should start as seed data and later be updated by observed
  behavior.
- `数字生活所得`: what she actually read, watched, played, browsed, saved, or
  organized through digital tooling, with source, timestamp, rough topic,
  excerpt or URL when safe, and Xiaoni's reaction.
- `外部行动日志`: every external digital action, real or mocked. Record action
  type, platform, target, motive, current state, result, whether it formed a
  share candidate, and whether it should affect interests. Mock records must be
  marked as mock and cannot justify "刚看到 / 刚刷到 / 我查到" wording.
- `待分享池`: shareable fragments derived from digital-life material, each with
  possible phrasings, tone, source visibility, and whether it can be shared
  without a group trigger.
- `情绪能量`: dopamine, pressure, fatigue, boredom, sharing desire, and
  willingness to elaborate. This translates inner state into action.
- `群友反应`: whether people picked up her share, ignored it, pushed back,
  teased her, or clearly disliked it.

**Energy / fatigue model to engineer:**

Use a lightweight human-like curve, not a fake dopamine gauge. The research shape
to copy is the two-process sleep model: sleep pressure rises while awake and
falls during sleep, while circadian alertness follows a daily rhythm.

Core variables:

- `energy_budget`: daily action budget. Sleep or long inactivity restores it;
  positive social feedback does not.
- `sleep_pressure`: 0-1. Rises while awake, approaches high after roughly a full
  waking day, and falls during sleep or long inactivity.
- `circadian_alertness`: 0-1. Daily alertness rhythm: low overnight, rises after
  waking, has a mild afternoon dip, often has an evening second wind, and drops
  late at night. Shift this curve by Xiaoni's configured schedule.
- `sleep_inertia`: short wake-up drag. After waking, keep 20-60 minutes of lower
  action tendency before she is fully online.
- `fatigue`: derived from sleep pressure, recent action cost, pressure, and
  active time. This is a curve, not a boolean.
- `effort_cost_multiplier`: fatigue raises the felt cost of acting. This is the
  main mechanism for "too tired to do the thing".
- `reward_sensitivity`: attraction to novelty, interaction, fun, and being
  picked up by others. Do not treat this as literal dopamine concentration.
- `mood_valence`: positive/negative mood, separate from energy. Low energy does
  not automatically mean bad mood.

Engineering shape:

- Sleep pressure: low after good sleep; rises across awake time; after about 16
  awake hours it should be near high; 7-8 hours of sleep should restore most of
  it.
- Circadian alertness: night low, morning climb, afternoon dip around 14:00-16:00,
  evening second wind, late-night decline.
- Sleep inertia: decays after waking; default 20-45 minutes, longer after
  insufficient sleep.
- Fatigue suppresses action, not reward itself. Under fatigue, immediate fun can
  still look attractive, but effort feels more expensive.
- Positive reactions can raise reward sensitivity / sharing desire, but high
  fatigue should cap how much that turns into action.
- Pressure makes action more expensive. Acting while pressure is high consumes
  extra energy and pushes toward shorter replies, silence, or withdrawal.

Action-cost tiers:

```text
Low cost:
看群 / 潜水 / 表情 / 短句 / 轻内容浏览

Medium cost:
主动分享一句 / 接梗 / 简短吐槽 / 看一小段网页

High cost:
长篇解释 / 深度搜索 / 多轮认真讨论 / 整理复杂内容
```

Engineering implication:

```text
action_tendency = reward_attraction / effort_cost_multiplier

effort_cost_multiplier increases with:
- fatigue
- sleep_pressure
- pressure
- action_cost

fatigue_discount:
low fatigue      -> near full gain
medium fatigue   -> reduced gain
high fatigue     -> small gain
extreme fatigue  -> near zero actionable gain
```

The exact numbers can be decided during engineering, but the shape is fixed:
fatigue must cap both reward-to-action conversion and action intensity so Xiaoni
cannot become more and more active when she is already exhausted.

**Possible future `presence_context` shape:**

```text
[本轮开始前的小腻状态]
刚刚的数字活动：浏览过一个关于 AI 检测的吐槽内容。
自己的反应：觉得它有点像玄学算命。
现在的状态：有点无聊，分享欲中等。
来源：真实浏览器记录。
[/本轮开始前的小腻状态]
```

**Not in current implementation scope:**

- Real autonomous browser exploration with page navigation or side effects beyond
  hosted `web_search`.
- Real external posting, liking, following, login-state usage, downloading, or
  cross-platform public identity mutation.
- Full digital reading / watching / gaming / organizing action storage beyond
  the first `agent_digital_actions` web-search action shape.
- Full share-pool ranking.
- Full reaction feedback loop into interests and sharing desire.
- Full state-driven action scheduling for browsing/opening QQ/sleeping.

Current implemented slices:

- 2026-05-26: presence tick, share pool, life-state anchors, and sidecar traces.
  This lets Xiaoni proactively open a configured group and inject factual
  `<小腻当前状态>` into the normal main loop.
- 2026-05-30: self-action `web_search`. The agent-service background loop checks
  budget, cooldown, startup grace, fatigue, and user-interaction limits, then
  calls provider-service with hosted `web_search` plus
  `emit_self_search_result`. Completed actions are written to
  `agent_digital_actions`; safe `share_seed` residue is written to
  `agent_share_pool_items`.
- 2026-05-31: the legacy random self-action `web_search` runner was removed
  from agent-service runtime. Existing tables, historical records, source
  honesty checks, and presence projection support remain for replay and for the
  next digital-life runner.
- Real-source wording is allowed only when the action trace proves a completed
  `web_search` whose query matches the emitted result. Constructed or mock
  material still cannot be phrased as "刚看到 / 刚刷到 / 我查到 / 我刚在评论区看到".

Mock-to-interest promotion rule:

- One constructed item plus one group reaction is not enough to rewrite Xiaoni's
  identity or stable interests.
- A strong group pickup can promote constructed material into a short-term
  candidate interest: people ask follow-up questions, continue her topic, quote
  her point, or build a new discussion from it.
- Repeated strong pickup, repeated self-selection, or later real digital action
  can promote the candidate into a durable interest.
- Weak positive feedback such as "哈哈", emoji, "草", or "乐" raises the current
  material heat only. It should not become a long-term preference by itself.

Interest growth rule:

- `种子兴趣`: stable starting preferences such as game design, strange
  knowledge, AI oddities, memes, biology, and technically interesting low-utility
  details. These give Xiaoni a default direction before enough behavior exists.
- `临时热度`: short-lived attraction caused by today's group residue, mock
  digital-life material, real browsing, reading, watching, gaming, or current
  mood. This can make Xiaoni want to talk about something now, but it expires
  unless reinforced.
- `稳定兴趣`: long-lived preference formed only after repeated self-selection,
  repeated strong group pickup, or later real digital action. Stable interests
  should change slowly and should never be rewritten by a single weak reaction.
- First implementation should update short-term heat freely, but only emit
  stable-interest candidates for operator/reviewer inspection. Automatic durable
  interest mutation can wait until the feedback loop has live evidence.

Cross-group sharing rule:

- Default posture: topics can travel across groups. Xiaoni is one person across
  QQ, so a joke, question, reading impression, game thought, meme, or strange
  topic from one group may become material she later brings to another group.
- The exception is explicit or obvious boundary material: someone says not to
  share it, it contains private/personal information, it depends on a group's
  private conflict, or the local context clearly makes outside sharing
  inappropriate.
- This should be handled by an LLM boundary judgment or in-context append, not
  by hard-coding "group content never crosses groups".
- When a topic crosses groups, Xiaoni should usually reframe it as her own
  thought or a general topic. She does not need to reveal "another group just
  said this" unless that source is harmless and socially natural.
- Boundary judgment should be default-allow with three labels:
  - `safe`: can cross groups. Examples: jokes, memes, opinions, game topics,
    public news, general tucao, abstract questions.
  - `reframe`: can cross groups only after removing identifying/local details.
    Examples: a group member's specific experience, a local in-group phrasing,
    or a tucao that is only safe after becoming an abstract topic.
  - `blocked`: should not cross groups. Examples: explicit no-share request,
    personal privacy, identifying details, private messages, group conflict,
    humiliating content, or anything that would expose a real person.
- Practical boundary questions:
  - Can a specific person be identified?
  - Did anyone explicitly say not to share it?
  - Is it private relationship/conflict material?
  - Would sharing it elsewhere embarrass or expose the original speaker?
  - If rewritten as an abstract topic, is it still useful to talk about?
- If abstract reframing preserves the interesting part, prefer `reframe` over
  `blocked`.

Share-pool rule:

- The share pool is Xiaoni's temporary "what I might want to talk about" buffer,
  not a knowledge base. It should make her feel like a person with lingering
  thoughts, not a retrieval bot answering questions.
- First implementation should support `刚热起来的材料` and `当天残留`:
  - `刚热起来的材料`: a joke, topic, reading impression, viewing impression, game
    thought, or tucao that is hot right now and likely expires quickly.
  - `当天残留`: something Xiaoni keeps thinking about today, either because it
    appeared repeatedly, touched her interests, or got a meaningful reaction.
- `长期收藏` should not auto-mutate stable interests in the first slice. It can
  produce durable-interest candidates for operator/reviewer inspection.
- Each share-pool item should carry plain fields:
  - `source_kind`: constructed thought/meme/topic, group residue, real browsing,
    real reading, real watching, real gaming, or real external action.
  - `heat`: how much Xiaoni wants to say it now.
  - `freshness`: how old the material is and whether it is still socially alive.
  - `boundary`: default cross-group allowed, blocked only by explicit no-share,
    privacy, personal information, private conflict, or obvious local boundary.
  - `source_wording`: whether Xiaoni may say "刚看到 / 刚刷到 / 我查到", or must
    phrase it as her own thought.
  - `effort_cost`: whether it is a short tucao, a light chat, or a longer
    explanation.
- Selection should consider current group atmosphere, Xiaoni's energy/fatigue,
  sharing desire, material heat, freshness, and boundary. The goal is not to
  always share; lurking or saying very little must remain valid outcomes.

Expiration / recall ranking rule:

- Use time-decay scoring for same-day residue, share-pool items, and recent
  action traces. Do not rely on the LLM to remember which materials are stale.
  Retrieval should sort by decayed score and only pass the top material into
  the current-state block.
- Each item should have a base `heat` plus decay by age. Strong pickup, repeated
  self-selection, or a real/mock digital-life revisit can boost heat or slow
  decay. Weak positive feedback such as "哈哈", emoji, "草", or "乐" should only
  add a small boost.
- Different item kinds decay at different speeds:
  - recent action trace: fastest decay; useful for current/few turns only.
  - hot share item: minutes to hours scale.
  - same-day residue: same-day scale, sharply reduced after sleep or long
    inactivity.
  - short-term interest candidate: days to week scale, maintained by repeated
    self-selection or strong pickup.
  - stable interest: not selected by this transient decay path; it only provides
    direction.
- Sleep or long inactivity should act as a boundary multiplier that sharply
  lowers same-day residue and action-trace scores.
- First implementation can use a simple relative score, for example:

```text
recall_score = base_heat * time_decay(kind, age)
  + strong_pickup_boost
  + self_selection_boost
  + digital_revisit_boost
  + weak_feedback_small_boost
  - boundary_penalty
```

- The exact function can be tuned later. The design requirement is that stale
  material naturally falls out of the prompt unless it is reinforced.

Mock digital-life generation timing:

- Do not generate mock digital-life traces on a blind fixed timer. Use
  state-triggered generation plus a low-frequency fallback.
- Main triggers:
  - high boredom: Xiaoni is not pulled by the current chat but wants stimulation.
  - material scarcity: the share pool has no usable recent material and Xiaoni
    has some sharing desire.
  - medium fatigue: Xiaoni is tired but not exhausted, so low-cost digital
    actions such as reading a few lines, watching a short clip, browsing saved
    material, or playing something light are plausible.
  - group residue hook: recent group chat leaves a topic that Xiaoni might
    mentally extend or digitally poke at.
  - long no-material gap: low-frequency fallback so Xiaoni does not have an
    empty digital life forever, still gated by schedule, fatigue, and pressure.
- Do not generate when Xiaoni is already engaged in a high-intensity group chat,
  fatigue is extreme, pressure is high, there is already enough shareable
  material, or current chat itself is the most interesting thing.
- First implementation can use a relative score:

```text
mock_generation_score =
  boredom
  + novelty_need
  + share_desire
  + material_scarcity
  + group_residue_hook
  - fatigue_penalty
  - pressure_penalty
  - current_chat_engagement
```

- Generated actions must be stored as linked action records, not isolated
  snippets. Each record should include:
  - `trigger_state_id`: the state snapshot or score that caused generation.
  - `parent_action_id`: previous related action, if this continues an action
    chain.
  - `source_group/session`: if a group residue hook influenced the action.
  - `action_type`: read, watch, play, browse, search, save, organize, like,
    follow, comment, post, download, or idle/presence action.
  - `motive`: boredom, novelty need, sharing desire, residue hook, fatigue
    relief, or low-cost stimulation.
  - `result`: what Xiaoni encountered or thought.
  - `reaction`: Xiaoni's own reaction.
  - `share_candidate_id`: generated share-pool item, if any.
  - `next_state_delta`: how the action changed heat, boredom, fatigue, sharing
    desire, or pressure.
  - `source_honesty`: mock/constructed versus real evidence and what wording is
    allowed in group chat.
- These links are required because recent actions will later be compressed into
  the in-context current-state block. The prompt should be able to say things
  like "你刚刚放下手机去做了 X；过了一会儿又拿起来看群；这个话题还
  有点意思，所以你还盯着聊天窗口" from actual linked records.

Operator traceability rule:

- Every generated `小腻当前状态` block must have a sidecar trace. Do not store
  only the final prompt text.
- The sidecar trace should record:
  - `source_items`: action records, share-pool items, group residue, energy
    snapshot, and short-term interest candidates used.
  - `recall_scores`: each candidate's base heat, time-decayed score, strong
    pickup boost, self-selection boost, digital revisit boost, weak feedback
    boost, boundary penalty, and final score.
  - `boundary_judgments`: safe/reframe/blocked labels for cross-group material.
    For `reframe`, record the kind of removed local detail rather than
    spreading sensitive source text through every trace surface.
  - `compression_mapping`: which source items became recent action trace,
    current mental state, shareable material, source boundary, or action cost
    points.
  - `final_context_block`: the exact private context injected into the prompt.
  - `model_action_outcome`: whether Xiaoni lurked, short-reacted, engaged the
    current topic, proactively shared, elaborated, continued multi-round
    involvement, or stayed away.
- This should make failures debuggable as a chain:

```text
group residue / digital action
→ share-pool candidate
→ recall score with decay and boosts
→ boundary label
→ compressed current-state block
→ model action outcome
```

- First slice can store trace JSON without building a full admin UI. UI display
  can come later, but the trace shape must exist before tuning behavior.

State persistence rule:

- `一轮内状态`: whether Xiaoni wants to speak now, speak briefly or at length,
  engage the current topic, proactively share, pick from the share pool, or
  lurk. This is consumed by the current turn and should not be persisted as
  personality.
- `当天状态`: fatigue curve, boredom, sharing desire, current mood, hot material,
  and same-day residue. This can affect multiple turns and multiple groups, but
  should decay or expire.
- `短期偏好候选`: topics from recent days that Xiaoni repeatedly self-selects,
  gets strong pickup on, or returns to through mock/real digital-life actions.
  These are candidates, not stable identity.
- `长期身份 / 稳定兴趣`: durable only after repeated self-selection, repeated
  strong feedback, or real digital-action closure. Do not write stable interests
  from one weak reaction, one mock item, or one same-day mood spike.
- Short-term state may shape current speech. It must not silently mutate
  long-term identity or stable interests without promotion evidence.

In-context action arbitration rule:

- First version does not need a heavy standalone scheduler that hard-picks
  "reply / proactively share / lurk". Upstream state should prepare a compact
  in-context block, then let the model choose the socially natural action inside
  the current group scene.
- The block should be retrieved and synthesized from actual state stores:
  digital-life traces, mock digital-life traces, share-pool items, same-day
  residue, short-term preference candidates, fatigue/energy curves, and current
  group residue. It should not be a static list of generic options.
- The block should describe Xiaoni's current mental/social scene with enough
  detail to activate the model's next-token behavior. This does not always mean
  a recent external action. Xiaoni may have been reading, watching, playing,
  browsing, thinking about same-day residue, staring at QQ, following the group
  flow, waiting for replies, or repeatedly picking up and putting down the
  phone.
- The block may contain a short multi-step recent action trace, not just one
  current-state sentence. This is useful with high/low watermark compression:
  as raw event history grows, compress recent digital/presence actions into a
  narrative sequence that preserves why Xiaoni is still mentally near the group.
  Example: "你刚刚放下手机去做了 X；过了一会儿又拿起来看群；这个话题
  正好有点意思，你也有些无聊，所以还盯着聊天窗口。"
- The block should describe facts and tendencies, not issue a forced command.
  Good shape: "刚才读到的段落让她想到 X，她现在有点累，眼睛有点发干";
  bad shape: "you must reply now" or "you must use this topic".
- "刚刚在做什么" must come from a real digital trace, recalled same-day residue,
  share-pool item, ongoing group-presence state, or explicitly constructed mock
  material. If Xiaoni has simply been present in the group, say that. If there
  is no concrete material, say there is no concrete shareable residue instead of
  inventing a source.
- The model may decide among: lurk, short reaction, emoji-like light response,
  engage current topic, proactively share from the share pool, briefly tucao,
  or stay away because fatigue/pressure is too high.
- State wording should bias toward human-like behavior without over-controlling
  output. It should be rich enough to help the model continue from Xiaoni's
  current mental scene, but still marked as private context that must not be
  quoted back to the group. Example shape:

```text
[小腻当前状态]
当前近况：你刚才在读一段关于夏天和死亡意象的文字，里面有一句
  "盛到最满的时候反而像要安静下来"让你停了一下。你没有完整读完，
  只是翻了几页，脑子里留下的是季节、生命极盛、安眠这几个词。
自己的反应：你觉得这个说法有点矫情，但又不是完全没道理。它让你
  想到人有时候不是怕结束，而是怕最热闹的东西忽然静下来。
现在状态：你有点累，眼睛有点发干；有点无聊，分享欲中等。
可用材料：这个意象，自己的联想。
当前体感耗力：盯群很轻，短句很轻；认真解释明显费力；连续多轮会很吃力。
来源：mock 构造。真实浏览器证据：无。公开可表述为自己的联想。
[/小腻当前状态]
```

- The block may be longer when there is real material. More detail is useful if
  it gives the model a concrete mental scene. Do not shorten it into abstract
  labels just to save tokens.
- Do not tell the model "now you are more suitable for X" as a final judgment.
  Provide current fatigue/pressure/reward state and action cost points instead;
  the model should decide whether a low-cost or high-cost action makes sense in
  the current group scene.
- First version cost points can be simple and relative, not calibrated money:
  low-cost actions around 1-3, proactive/light sharing around 4, longer
  elaboration around 6, multi-round serious involvement around 8+.
- Numeric state must include a scale and budget. Raw decimals such as
  "疲惫 0.62，无聊 0.74" are not enough. The model needs to know current
  available action budget and how action costs relate to it.
- Use one readable cost scale in the prompt, for example:

```text
当前行动预算：5 / 10
疲惫负荷：6 / 10，压力负荷：2 / 10
无聊：7 / 10，找刺激/新鲜感：6 / 10，分享欲：5 / 10
```
- The action budget must not become an isolated new meter. It should be derived
  from Xiaoni's existing energy/stamina, fatigue curve, dopamine/reward system,
  pressure, sleep pressure, and current action history. Discuss this together
  with the full prompt/developer/tool-description/in-context closure before
  engineering the final formula.
- Length strategy should be flexible, not a hard word-count target:
  - `rich-material`: can be relatively long, roughly 300-800 Chinese characters
    if the details are concrete action trace, recalled material, or Xiaoni's own
    reaction.
  - `normal`: roughly 150-400 Chinese characters, enough to explain current
    action trace and one or two residues.
  - `no-material`: roughly 50-180 Chinese characters. Do not invent a digital
    action; say Xiaoni has been present/idling/checking the group and has no
    concrete shareable residue.
  - Use token budget as the real engineering guardrail instead of forcing exact
    character counts.
  - Each current-state block should normally carry at most one main material and
    one secondary material. Too many topics will scatter the model.
- Current-state block structure is fixed to six readable sections:

```text
[小腻当前状态]

最近行动轨迹：
<最近几步：放下手机/看群/去做别的数字活动/又回来/仍盯着群。来自
压缩后的行动记录。>

当前残留：
<现在脑子里还卡着什么。最多一个主材料、一个次材料。标注来源类型：
群聊残留、数字生活、mock、收藏整理等。>

现在状态：
<行动预算、疲惫负荷、压力、无聊、找刺激、分享欲。带总分比如 5/10。
scale 在 system prompt 中定义。>

可用材料：
<可用的具体材料内容及来源类型。不写行动建议。>

行动成本：
<当前体感耗力：哪些动作现在感觉很轻，哪些明显费力，哪些会很吃力。>

来源边界：
<本轮材料的溯源标签：来源类型（mock / 真实浏览器 / 群聊残留 / 自己联想），
跨群边界标签（safe / reframe / blocked）。规则在 system prompt，此处只有标签。>

[/小腻当前状态]
```

- Do not add a "recommended action" section. The model receives state,
  materials, costs, and boundaries, then decides the socially natural action.
- Every section must map back to sidecar trace sources.

Prompt / developer / tool-description / in-context closure:

In-context state writing principle (locked 2026-05-26):

- The entire 小腻当前状态 block describes state FACTS only. It does not explain
  what those facts mean for behavior, and it does not contain rule-execution language.
- Fact: what is true about Xiaoni's current state, experience, or surroundings.
- Not a fact: what the state means for her behavior, what she should or should not do,
  what the threshold is, what action is "more suitable".
- The model activates from facts and derives behavioral implications via emergence.
  Do not pre-empt that inference.
- Facts must be concrete enough to activate. "你已经在线很久了" is ambiguous — the
  model may read it as available and engaged. "你已经在线很久，眼睛发干，注意力有点散"
  is a concrete sensory fact that activates fatigue.
- Exception — 来源边界: source honesty is a truth constraint, not embodiment. The
  invariant rule (no real-source wording without real evidence) belongs in the system
  prompt / tool description. The per-turn 来源边界 section carries only provenance
  labels: source type, cross-group boundary label. No rule text.
- Exception — numeric meters: a number like "5/10" is decorative without a stable
  scale definition. The scale must be defined once in the system prompt. The state
  block then projects the current values against that pre-defined scale.

- Stable identity and social principles belong in the base prompt / developer
  context. Examples: Xiaoni is a QQ group member, not a service; she participates
  when bored, curious, loose, or sharing-driven; she may lurk; she does not need
  to answer every message; source honesty is required.
- World narrative belongs near the beginning of developer context. It explains
  why Xiaoni opens QQ and participates in group chat, but it should not contain
  per-turn facts such as "刚才在做什么".
- Tool descriptions should define action contracts, not personality. They should
  say what each tool/action records, what counts as real evidence, what is mock,
  what source wording is allowed, and what side effects are real. Tool
  descriptions should not decide Xiaoni's mood or whether she wants to talk.
- In-context state is the only place for per-turn recalled facts: recent action
  trace, current residue, current action budget, fatigue/pressure/boredom,
  shareable material, action costs, and source boundaries.
- Numeric meters must have one engineering source of truth. Energy/stamina,
  fatigue, dopamine/reward attraction, pressure, sleep pressure, action budget,
  and action costs are computed before prompt assembly, then projected into
  in-context. Do not let the base prompt, tool descriptions, and current-state
  block each invent separate versions of the same meter.
- Relationship/trust and group atmosphere should influence current-state
  assembly and model interpretation, but they are not the same as energy.
  Familiarity answers "how open can Xiaoni be here"; energy/action budget answers
  "how much effort can she spend now".
- Digital-life traces are records of what Xiaoni did, saw, read, watched, played,
  saved, or constructed as mock material. They become share-pool items and
  current-state material through recall/ranking, not by being pasted wholesale
  into every prompt.
- The in-context block is private and disposable. It may affect this turn's
  action and wording, but it should not mutate stable interests or identity
  unless the promotion rules produce evidence.
- Closed-loop path:

```text
stable identity / world narrative
→ tools create real or mock digital-life/action records
→ records update share pool, same-day residue, energy/fatigue/action history
→ recall/ranking selects source items with decay and boundary labels
→ current-state block projects selected state into prompt
→ model chooses socially natural action
→ outcome and group reaction write new trace/feedback
→ later promotion may update short-term candidates or stable interests
```

- First implementation should verify the loop with sidecar traces before adding
  more autonomous browser behavior.

- This block should be built from recall, not hand-authored every turn. The
  engineering task is to retrieve and compress the right material; the model's
  task is to decide whether and how it matters in the current group scene.

First-slice recall sources for `小腻当前状态`:

- `当天数字生活记录`: what Xiaoni mock/real read, watched, played, browsed,
  saved, organized, or thought about today.
- `持续在场状态`: whether Xiaoni has been watching QQ, following the current
  group flow, waiting for a reply, intermittently checking the phone, or simply
  idling in chat without a separate external activity.
- `近期行动轨迹`: a compressed sequence of recent presence/digital actions, such
  as putting the phone down, doing another digital task, returning to QQ,
  watching the group continue, and deciding whether the topic is still alive.
- `待分享池`: currently hot material, including whether each item is better as
  a short line, light chat, or longer explanation.
- `当天情绪能量`: fatigue, boredom, sharing desire, pressure, and current action
  cost.
- `近期群聊残留`: topics, jokes, disputes, or questions from the recent group
  window that may still be mentally alive for Xiaoni.
- `短期兴趣候选`: recent multi-day topics Xiaoni self-selected, got strong pickup
  on, or returned to through mock/real digital-life actions.
- Long-term identity and stable interests should provide direction only. They
  can influence what Xiaoni notices, but they must not be converted directly
  into fake "刚刚在干嘛" details.

No unresolved Task 5 design items remain from this office-hours pass. Next step
is engineering decomposition and subagent execution planning.

**Near-term implementation implication:**

Do not treat the current self-action code as the full browser-backed digital-life
loop. The 2026-05-30 slice proved the first real-source path, but the random
runner is no longer active. The next implementation must create a deliberate
digital-life runner that stores traceable records and lets later
presence/main-loop context decide whether any residue naturally enters QQ.
Everything beyond current presence, including navigation, reading, watching,
posting, liking, downloading, autonomous search, and stable-interest mutation
from digital activity, remains future work.

---

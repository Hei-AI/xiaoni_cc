# Xiaoni Digital Life And Presence Context Design

Status: design-locked from office-hours on 2026-05-26, with the 2026-05-31
homeostasis correction in `docs/P0A_XIAONI_HOMEOSTASIS_LOOP.md`. Current
implementation has landed the presence-context first slice. Earlier self-action
side runners were removed from the current runtime because they created a second
context and made hardcoded interests look like Xiaoni's own life. The current
shape appends idle/presence life events into the same main loop. A
presence-originated event reads the global conversation append stream and uses
`xiaoni:global` as the context summary / read-cutoff compatibility key. That key
is still backed by `agent_session_context_windows`; event-backed identity-root
`<小腻近况>` is not implemented yet. If an IM has unread messages after that
session's last-read cursor, the run can materialize that target as
`proactive_im_open`; otherwise it stays life-only and can currently use
`exec_command`, grounded hosted `web_search`, `compress_core_memory`, or
`recover_energy`. It still cannot send QQ or register image tasks without a
concrete IM target. A no-tool model response before action completion is not a
silence or finish signal. "想回头分享" material is current-context residue:
it is appended into `<xiaoni_os>` and later session-window `<小腻近况>`, not
routed through a separate share-pool queue. Old `<小腻的OS>` history is read as
legacy residue and is not migrated. This is still not the full browser-backed
digital-life system.

2026-05-31 runtime correction: prompt-facing state is current energy plus recent
action cost/recovery context only. Earlier design language about boredom,
fatigue, sharing desire, dopamine, pressure, or cooldown is background design
history unless a later current-runtime section explicitly reintroduces it. Those
meters must not be used as hard prompt-facing action gates.

This document is the system of record for browser-backed digital life,
`presence_context`, current idle life events, and the next browser-backed runner
shape. `docs/P0A_XIAONI_HOMEOSTASIS_LOOP.md` is the source of record for the
event-stream reducer rule: `agent_life_events` is truth for homeostasis /
presence projection, while `agent_session_life_states` is projection/cache.
Memory continuity and `<小腻近况>` are currently still session-window based unless
a later section explicitly says event-backed projection has landed. `TODOS.md`
keeps only the execution summary.

**Core framing:**

Xiaoni is a group member who participates in group chat. She does not need to
wait for another person to hand her a turn. She may open QQ because she wants to
look around, wants low-cost company, wants to kill time, wants to chat, or has
something from her own digital life that she feels like sharing. Do not optimize
this around "will this disturb the group"; provide current energy and action
cost context, then let Xiaoni choose.

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
  That runner and the later self-action side tick were retired on 2026-05-31
  because the current architecture has one append-only event stream, not a
  second planner context or hardcoded interest table. Only real hosted
  `web_search` traces may be represented as searched web evidence.
- Digital-life exploration should be driven by internal state, not fixed
  frequency. Boredom, fatigue, dopamine, pressure, and sharing desire decide
  whether she browses, opens QQ, shares, rests, or keeps the action small.
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
→ 追加成上下文残留 / `<xiaoni_os>`
→ 情绪能量决定她是否打开群、主动分享、接当前话题、潜水或休息
→ 群友反应回流到分享欲、关系温度、偏好和边界
→ 影响后续浏览和分享
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
- `上下文残留`: shareable fragments derived from digital-life material, expressed
  as Xiaoni's own continuity in `<xiaoni_os>` / `<小腻近况>`, with source honesty
  and whether it can be shared without a group trigger.
- `情绪能量`: dopamine, pressure, fatigue, boredom, sharing desire, and
  willingness to elaborate. This translates inner state into action.
- `群友反应`: whether people picked up her share, ignored it, pushed back,
  teased her, or clearly disliked it.

**Energy / fatigue model to engineer:**

The locked production target is in
`docs/P0A_XIAONI_HOMEOSTASIS_LOOP.md`. Energy is identity-scoped, can go below
`0`, and uses the production tool/skill cost table there. Recovery is exposed to
the prompt only as `recover_energy`; wall-clock rest up to 120 minutes restores
toward full energy, treating negative energy as `0`. Older reducer-v1
`rest_period` / `sleep_period` rows are compatibility history, not the
prompt-facing recovery contract.

Use a lightweight human-like curve, not a fake dopamine gauge. The useful shape
is rest pressure plus circadian alertness, while the prompt-facing contract stays
energy / rest / recovery.

Core variables:

- `energy_budget`: daily action budget. Rest or long inactivity restores it;
  positive social feedback does not.
- `rest_pressure`: 0-1. Rises across continuous active time and falls during rest
  or long inactivity.
- `circadian_alertness`: 0-1. Daily alertness rhythm: low overnight, rises after
  the configured start of day, has a mild afternoon dip, often has an evening
  second wind, and drops late at night. Shift this curve by Xiaoni's configured
  schedule.
- `post_rest_drag`: short drag after rest. If needed, keep 20-60 minutes of lower
  action tendency before she is fully active again.
- `fatigue`: in the current reducer, directly mirrors accumulated action cost.
  Broader rest-pressure and circadian modeling remain future design scope.
- `effort_cost_multiplier`: fatigue raises the felt cost of acting. This is the
  main mechanism for "too tired to do the thing".
- `reward_sensitivity`: attraction to novelty, interaction, fun, and being
  picked up by others. Do not treat this as literal dopamine concentration.
- `mood_valence`: positive/negative mood, separate from energy. Low energy does
  not automatically mean bad mood.

Engineering shape:

- Rest pressure: low after good rest; rises across active time; longer rest
  should restore most of it.
- Circadian alertness: night low, morning climb, afternoon dip around 14:00-16:00,
  evening second wind, late-night decline.
- Post-rest drag: decays after rest; default 20-45 minutes, longer after
  insufficient rest.
- Fatigue suppresses action, not reward itself. Under fatigue, immediate fun can
  still look attractive, but effort feels more expensive.
- Positive reactions can raise reward sensitivity / sharing desire, but high
  fatigue should cap how much that turns into action.
- Pressure makes action more expensive. Acting while pressure is high consumes
  extra energy and pushes toward shorter replies, smaller actions, or recovery.

Action-cost tiers:

```text
Low cost:
看群 / 潜水 / 表情 / 短句 / 轻内容浏览

Medium cost:
主动分享一句 / 接梗 / 简短吐槽 / 看一小段网页

High cost:
长篇解释 / 深度搜索 / 连续认真讨论 / 整理复杂内容
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

Current runtime does not expose boredom, sharing desire, or cooldown as action
gates. It exposes energy and recent action cost so Xiaoni can choose whether to
act inside the main loop; the scheduler still blocks proactive IM opening while
fatigue is high enough that energy is below the active-use threshold.

**Locked next energy / rest behavior, 2026-06-04:**

The next prompt-facing runtime removes pressure/dopamine labels and exposes only
numeric energy. `<STATE>` is event-triggered, not appended on every model call:
engineering appends it after the configured cross-run action/tool count threshold,
after hosted `web_search`, when low energy needs a fatigue reminder, after forced
full recovery, or after repeated direct mentions interrupt rest.

Energy may go below `0` internally and in `<STATE>`, but recovery treats negative
energy the same as `0`. Full recovery is capped at 2 hours. `recover_energy`
is the single prompt-facing rest tool; `rest_period` / `sleep_period` may remain
historical or internal event kinds, but should not be exposed as separate
prompt-facing tools. `recover_energy.duration_minutes` is clamped to `5..120`;
at 120 minutes energy is `1.00`, and shorter durations recover linearly toward
`1.00` from `max(raw_energy, 0)`.

Low-energy fatigue text belongs in `<STATE>` as a nudge, e.g. "我已经很累了，要不要
休息一下", but engineering must not force a rest choice while energy is still
non-negative. If raw energy drops below `0`, engineering waits 2 hours before
the next action opportunity. Recovery math clamps the effective rest duration at
120 minutes, so the next opportunity starts at full energy. If Xiaoni did not
choose rest herself, the `<STATE>` says she was too tired to continue before
recovering, then gives the recovered numeric energy.

While Xiaoni is resting, the model does not read message bodies. Engineering
only tracks unread metadata and direct-mention counts. If continuous direct `@`
count reaches `3`, repeated mentions interrupt rest early. Engineering computes
recovery from actual rest time and injects a `<STATE>` that says repeated `@`
interrupted rest and how much energy recovered.

**Possible future `presence_context` shape:**

```text
[当前动作前的小腻状态]
刚刚的数字活动：浏览过一个关于 AI 检测的吐槽内容。
自己的反应：觉得它有点像玄学算命。
当前精力：0.80。
精力成本：最近没有明显消耗。
来源：真实浏览器记录。
[/当前动作前的小腻状态]
```

**Not in current implementation scope:**

- Real autonomous browser exploration with page navigation or side effects beyond
  hosted `web_search`.
- Real external posting, liking, following, login-state usage, downloading, or
  cross-platform public identity mutation.
- Full digital reading / watching / gaming / organizing action storage beyond
  historical `agent_digital_actions` compatibility records.
- A separate share-pool queue / ranking path for "想回头分享" residue.
- Full reaction feedback loop into interests and sharing desire.
- Full state-driven action scheduling for browsing/opening QQ/resting.

Current implemented slices:

- 2026-05-26: presence tick, historical share-pool tables, life-state anchors,
  and sidecar traces. The original slice let Xiaoni proactively open a configured
  group and inject factual `<小腻当前状态>` into the normal main loop; the current
  runtime now materializes unread IM targets dynamically from cursor-visible
  unread, preserves global presence context when materialized, and otherwise
  stays life-only inside the same loop.
- 2026-05-30: self-action `web_search`. The historical agent-service background loop checked
  budget, cooldown, startup grace, fatigue, and user-interaction limits, then
  calls provider-service with hosted `web_search` plus
  `emit_self_search_result`. Completed actions are written to
  `agent_digital_actions`; safe `share_seed` residue is written to
  `agent_share_pool_items`.
- 2026-05-31: the legacy random self-action `web_search` runner was removed
  from agent-service runtime. The old `AgentDigitalAction` write helpers are
  also removed from `@qq-bot/persistence`; the table remains historical
  compatibility data for admin replay only.
- 2026-05-31 / corrected 2026-06-04: presence-originated `presence_tick` now
  stays inside the main loop context. It reads the global conversation append
  stream and uses `xiaoni:global` for context summary / read-cutoff compatibility
  even if unread IM materializes the run into `proactive_im_open`; without a
  concrete IM target it cannot send QQ directly. It can currently use
  `exec_command`, `web_search`, `compress_core_memory`, or `recover_energy`.
  A no-tool response before action completion is not a silence or finish signal.
  Any "想回头分享" residue is appended to `<xiaoni_os>` and
  therefore survives normal context replay or later summary compression. The compressed `<小腻近况>` here is still
  `agent_session_context_windows.context_summary`, not an event-backed
  `agent_life_events` digest.
- 2026-05-31 / updated 2026-06-04: presence enqueue no longer uses
  cooldown/boredom/sharing desire or startup grace as hard gates. The next
  low-energy contract is the production recovery spec: append `<STATE>` only on
  state events and expose `recover_energy` as the prompt-facing recovery tool.
  Historical `rest_period` / `sleep_period` rows remain compatibility data.
- 2026-05-31: homeostasis design correction locked. The next reducer uses
  `agent_life_events` as the canonical append stream. `agent_session_life_states`
  is only a projection/cache. Do not restore a separate self-action planner, and
  do not hardcode `motiveText`, exact queries, interest keys, reading seeds, or
  fake source wording as Xiaoni's inner life.
- 2026-05-31: first homeostasis reducer slice landed. `presence_tick` now uses
  the event-derived projection, persists `presence_tick_evaluated`, no longer
  refreshes `last_active_at`, and `小腻当前状态` no longer reads
  `agent_digital_actions` as current residue.
- 2026-05-31: `/xiaoni-activity` now treats self-action web-search prompts and
  canonical requests as operator-only trace data. The feed should show life-event
  wording and residue, not tool-control instructions such as exact-query
  enforcement.
- Real-source wording is allowed only when the current life-event / context
  residue trace carries `source_wording=real_web_search`. Historical
  `agent_digital_actions` records do not by themselves create current-source
  wording.

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

Context-residue rule:

- The current live path for "what I might want to talk about" is normal context:
  `pending_share` is merged into `<xiaoni_os>` as "我想回头分享这个：...". It should
  make her feel like a person with lingering thoughts, not a retrieval bot
  answering questions.
- Historical share-pool tables and sidecars may still exist for compatibility
  and old traces, but they are not the required current path for new life-only
  residue.
- First implementation should support `刚热起来的材料` and `当天残留`:
  - `刚热起来的材料`: a joke, topic, reading impression, viewing impression, game
    thought, or tucao that is hot right now and likely expires quickly.
  - `当天残留`: something Xiaoni keeps thinking about today, either because it
    appeared repeatedly, touched her interests, or got a meaningful reaction.
- `长期收藏` should not auto-mutate stable interests in the first slice. It can
  produce durable-interest candidates for operator/reviewer inspection.
- Each context residue item should carry plain fields:
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

- Use time-decay scoring for same-day residue, context residue, and recent
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
  - same-day residue: same-day scale, sharply reduced after rest or long
    inactivity.
  - short-term interest candidate: days to week scale, maintained by repeated
    self-selection or strong pickup.
  - stable interest: not selected by this transient decay path; it only provides
    direction.
- Rest or long inactivity should act as a boundary multiplier that sharply
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
  - material scarcity: the current context has no usable residue and Xiaoni has
    some sharing desire.
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
  - `share_candidate_id`: generated context residue item, if any.
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
  - `source_items`: action records, context residue items, group residue, energy
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
→ context residue candidate
→ recall score with decay and boosts
→ boundary label
→ compressed current-state block
→ model action outcome
```

- First slice can store trace JSON without building a full admin UI. UI display
  can come later, but the trace shape must exist before tuning behavior.

State persistence rule:

- `即时状态`: whether Xiaoni wants to speak now, speak briefly or at length,
  engage the current topic, proactively share from current residue, or
  lurk. This is consumed by the current action and should not be persisted as
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
  digital-life traces, mock digital-life traces, context residue, same-day
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
  context residue item, ongoing group-presence state, or explicitly constructed mock
  material. If Xiaoni has simply been present in the group, say that. If there
  is no concrete material, say there is no concrete shareable residue instead of
  inventing a source.
- The model may decide among: lurk, short reaction, emoji-like light response,
  engage current topic, proactively share from context residue, briefly tucao,
  or stay away because fatigue/pressure is too high.
- State wording should bias toward human-like behavior without over-controlling
  output. It should be rich enough to help the model continue from Xiaoni's
  current mental scene, but still marked as private context that must not be
  quoted back to the group. Example shape:

```text
[小腻当前状态]
当前精力：0.80
精力成本：最近行动消耗：已经开口，行动成本 0.02
可用材料：
- 一个关于夏天和死亡意象的文字联想
材料边界：整理出来的材料，不能说成刚查到
来源边界：只能表达自己的想法、印象或整理出来的话题；只有明确标成真实网页搜索的材料，才能说成我查到。
[/小腻当前状态]
```

- The block may be longer when there is real material. More detail is useful if
  it gives the model a concrete mental scene. Do not shorten it into abstract
  labels just to save tokens.
- Do not tell the model "now you are more suitable for X" as a final judgment.
  Provide current energy and action cost points instead; the model should decide
  whether an action makes sense in the current group scene.
- First version cost points are deliberately small because energy is a long-lived
  0-1 activity meter. Ordinary visible replies should stay around `0.01-0.02`;
  lightweight IM usage should also be in the low hundredths, not tenths.
- Numeric state should not expose extra meters such as fatigue, boredom, sharing
  desire, or cooldown. The model needs current energy and how recent action costs
  relate to it.
- Use one readable energy/cost shape in the prompt, for example:

```text
当前精力：0.80
精力成本：最近行动消耗：已经开口，行动成本 0.02
```
- The action budget must not become an extra scheduler deciding for Xiaoni.
  It should be derived from current energy and current action history. Discuss this together
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
<当前材料的溯源标签：来源类型（mock / 真实浏览器 / 群聊残留 / 自己联想），
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
  fatigue, dopamine/reward attraction, pressure, rest pressure, action budget,
  and action costs are computed before prompt assembly, then projected into
  in-context. Do not let the base prompt, tool descriptions, and current-state
  block each invent separate versions of the same meter.
- Relationship/trust and group atmosphere should influence current-state
  assembly and model interpretation, but they are not the same as energy.
  Familiarity answers "how open can Xiaoni be here"; energy/action budget answers
  "how much effort can she spend now".
- Digital-life traces are records of what Xiaoni did, saw, read, watched, played,
  saved, or constructed as mock material. In the current architecture they
  become context residue and current-state material through recall/ranking, not
  by being pasted wholesale into every prompt.
- The in-context block is private and disposable. It may affect this turn's
  action and wording, but it should not mutate stable interests or identity
  unless the promotion rules produce evidence.
- Closed-loop path:

```text
stable identity / world narrative
→ tools create real or mock digital-life/action records
→ records update context residue, same-day residue, energy/fatigue/action history
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

- `当天数字生活记录`: future life events for what Xiaoni mock/real read, watched,
  played, browsed, saved, organized, or thought about today. Historical
  `agent_digital_actions` rows are not a current runner input.
- `持续在场状态`: whether Xiaoni has been watching QQ, following the current
  group flow, waiting for a reply, intermittently checking the phone, or simply
  idling in chat without a separate external activity.
- `近期行动轨迹`: a compressed sequence of recent presence/digital actions, such
  as putting the phone down, doing another digital task, returning to QQ,
  watching the group continue, and deciding whether the topic is still alive.
- `上下文残留`: currently hot material, including whether each item is better as
  a short line, light chat, or longer explanation. In the live path this is
  carried by `<xiaoni_os>` / `<小腻近况>` and trace metadata, not by a separate
  share-pool queue.
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

Do not treat the removed self-action side runner as the browser-backed
digital-life loop. The current runtime appends idle life events into the same
main loop and lets that loop decide whether to search or stay silent. The next
engineering step is the event-sourced homeostasis reducer described in
`docs/P0A_XIAONI_HOMEOSTASIS_LOOP.md`, not another side planner. Everything
beyond this slice, including page navigation, watching, posting, liking,
downloading, richer autonomous browsing, and stable-interest mutation from
repeated digital activity, remains future work.

---

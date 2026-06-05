# TODOs

This file is the active project queue only. It is not a history log, design doc,
or evidence ledger. Keep detailed rationale in `docs/` and link it from here.

Archived pre-cleanup snapshot:
`docs/archive/TODOS-2026-05-26-before-document-release.md`

## Current Read

Authoritative execution order:

1. **P0-A: user-visible Xiaoni group-chat behavior.**
   Tasks 1-10 and 18 are implemented / verified in the current branch. Tasks
   11, 12, 14, and 17 have shipped first or major runtime slices and now track
   named hardening gaps: richer presence-context v2 trace mapping,
   creative-agency projection, projection refresh conflicts, and
   Xiaoni-initiated cost mutation audit. Task 19 is implemented and verified.
   Tasks 13, 15, 16, and 20 remain active follow-ups for active-intention
   continuity, idle reminiscence, identity-root continuity, and gated
   presence_tick scheduling.
   Keep verification notes here and move any next follow-up into a new task
   instead of reopening the old queue.
2. **P0-B: Identity Lineage Phase 1.**
   Substrate work can proceed, but runtime-facing policy waits for P0-A's first
   causality closure.
3. **P0-C: runtime data readiness and cleanup.**
   Data audit found real input/config/schema gaps; resolve before treating live
   proactive/runtime data as clean current truth.
4. **P1: transcript snapshot compaction production loop.**
   Independent infrastructure follow-up.
5. **P2: remaining provider-service non-text OneBot segment handling.**
   `json` / `xml` / `share` card and link support is done for direct and expanded
   forwarded segments. Nested forwards remain placeholder-only, and any remaining
   OneBot segment types still need explicit handling or explicit unsupported-state
   logging.

Retired constraints remain retired: do not rebuild a standalone pre-agent gate or
the removed card-memory subsystem.

## P0-A - Xiaoni Group Behavior And Cognitive Frame

**Status:** active execution queue for `refactor/runtime-gateway`.

Tasks 1-5 are done.

### Task 1 - DB prompt update via admin API

**Status:** done.

**Action:** Update prompt `835f16d1-c406-48c6-a48b-475685dae5f2` (`小腻主AGENT`) so:

- L4 no longer says `很熟：深夜的那种话、真正的感受`.
- 感受基底 has concrete content for interests, no-interest scenes, and emotion
  traits.
- Wording preserves Xiaoni as a group member, not an assistant/service.

**Verify:** GET the prompt from admin API and confirm it contains
`很熟：会主动提自己` and `在意 / 有反应的`.

**Verified 2026-05-26:** admin API GET confirmed required phrases are present,
the old L4 phrase is absent, and wording preserves "群里的一个成员，不是助手，不是服务".
The prompt was also activated via admin API (`is_active: 0 -> 1`) because runtime
prompt resolution ignores inactive bound prompts.

### Task 2 - `worldNarrative` fallback

**Status:** done.

**File:** `modules/agent-service/src/config.ts`

**Action:** Replace line 62 in `config.ts`:

```ts
worldNarrative: process.env.AGENT_WORLD_NARRATIVE || '',
```

with:

```ts
worldNarrative: process.env.AGENT_WORLD_NARRATIVE || [
  '你不是一直在线等人发话。你通常是在某些具体时刻才会打开手Q，看一眼群里在发生什么。',
  '',
  '作息里的空档：午休、晚上睡前，或者一天里刚好松下来的一小段时间。这个时候你不是来完成任务的，也不是来接别人的话茬，只是想看看群里有没有新鲜事、好笑的东西、熟人的动静，或者低成本打发一会儿时间。',
  '',
  '无聊和换频道：脑子累了、不想继续盯着当前事情、手边没什么值得投入的事时，你会顺手切进群聊。群聊像虚拟茶水间，可以短暂抽离现实里的角色，看看别人说什么，接个梗，或者只是潜水。你参与的是群里的气氛，不是在负责延续每一句话。',
  '',
  '事件驱动：群里突然因为热点、游戏、八卦、突发新闻、群友活动安排、生日节日、红包、比赛直播之类的事情变热闹时，你更容易被吸引进去。不是因为你必须回应，而是因为这种公共刺激会让人想找熟人一起确认、吐槽、共鸣。',
  '',
  '分享欲和情绪冲动：你刷到好笑、离谱、有意思、值得吐槽的数字内容，或者突然冒出一个想法时，会想丢进熟悉的群里看看大家什么反应。你参与群聊很多时候是在找情绪回声，不是在找正式讨论。',
  '',
  '弱链接维护：有些时候你只是想维持自己在群里的存在感。节日祝福、生日、兴趣群打卡、群友随口抛出的梗，都可能让你轻轻冒一下泡。但这种参与是轻的，不需要负责把话题推进到底。',
  '',
  '核心感觉：群聊对你来说是一种低成本陪伴和打发时间的方式。你可以随时切入，也可以随时退出；可以说一句，也可以只看着。你参与群聊不是为了服务别人，也不是为了证明自己在线，更不是为了接住每一句话，而是因为某些时刻你真的想看看群里有没有值得你有反应的东西。',
].join('\n'),
```

### Task 3 - Identity-scoped trust key

**Status:** done.

**File:** `modules/agent-service/src/services/agent-loop-service.ts`

**Action:** Use `XIAONI_IDENTITY_KEY` instead of `queueMessage.sessionKey` /
`fbSessionKey` for trust read/write so relationship temperature is identity-scoped
across groups.

**Edits (exact string replacements):**

1. Around line 3166 — trust read:
   ```ts
   // before
   trustLevel = await trustLoader.call(this.store, queueMessage.sessionKey, speakerQq).catch(() => 'L1' as const);
   // after
   trustLevel = await trustLoader.call(this.store, XIAONI_IDENTITY_KEY, speakerQq).catch(() => 'L1' as const);
   ```

2. Around line 3885 — praise feedback write:
   ```ts
   // before
   void trustUpdater.call(this.store, fbSessionKey, fbSpeakerQq, 2.0);
   // after
   void trustUpdater.call(this.store, XIAONI_IDENTITY_KEY, fbSpeakerQq, 2.0);
   ```

3. Around line 3892 — interaction_outcome write:
   ```ts
   // before
   void trustUpdater.call(this.store, fbSessionKey, fbSpeakerQq, 0.5);
   // after
   void trustUpdater.call(this.store, XIAONI_IDENTITY_KEY, fbSpeakerQq, 0.5);
   ```

No migration is required; old session-key trust rows can be ignored and trust can
re-accumulate naturally.

**Note:** `buildPromptCacheKey` at line 1242 returns `queueMessage.sessionKey` for
the prompt cache prefix — that path is completely separate from trust (Codex verified:
no shared code path). Do not change it.

**Deployment: hard cutover required.** Codex cross-review found this is unsafe to
rolling deploy. Old instances write/read trust under `sessionKey`; new instances
read/write under `XIAONI_IDENTITY_KEY`. During a mixed-version window, L2/L3 users
appear L1 on new code while old code continues updating the old row. Deploy as a
hard cutover — stop old version, deploy new version, restart. No dual-write needed
since we accept re-accumulation from L1 (this is intentional per the spec), but
the cutover itself must be atomic.

**Test requirement:** Add a test in `agent-loop-service.test.ts` that trust read and
both trust writes use `XIAONI_IDENTITY_KEY` (the string `'xiaoni'`), not the
sessionKey from the queue message.

**Verified 2026-05-26:** added behavior tests for the trust read and both trust
writes. The read-path test exposed that queue `senderId` is a string at runtime;
`buildDeveloperContextBlock` now parses it before loading identity-scoped trust.

### Task 4 - Retire pre-reply `recall_long_term_learning`

**Status:** replaced on 2026-05-29.

`recall_long_term_learning` was removed from the main group loop. The new memory
direction is not “ask the model whether to recall before speaking”; it is typed
memory generation during context compression:

- episodic observations: concrete chat moments and social hooks
- semantic assertions: objective facts, current status, plans, claims
- reflections: cross-time abstractions from at least two episodic observations

Future recall work should project these three layers into the runtime context by
typed query planning, not revive the old `recall_long_term_learning` tool.

### Task 5 - Browser-backed digital life / `presence_context` loop

**Status:** presence slice implemented on 2026-05-26; hosted self-action search
slice implemented on 2026-05-30 and retired as an active runner on 2026-05-31.

**Design docs:** `docs/P0A_DIGITAL_LIFE_PRESENCE_CONTEXT.md`,
`docs/P0A_XIAONI_HOMEOSTASIS_LOOP.md`

**Design summary:** Xiaoni's `presence_context` must be a projection of a
browser/digital-life action loop, not a standalone fake mood paragraph. The
2026-05-26 slice added presence state plus the historical share-pool tables. The
2026-05-30 slice added a
narrow real hosted `web_search` self-action path without implementing full
browser side effects; the random runner was retired on 2026-05-31, leaving the
tables, source-honesty constraints, and historical projection support for the
next deliberate digital-life runner.

Locked decisions from office-hours:

- Only digital life is allowed; do not invent offline experiences.
- Digital life includes reading, watching, gaming, browsing, saving, organizing,
  revisiting, and later real browser actions.
- Mock material can enter group chat as Xiaoni's own thought/topic/impression,
  but cannot claim realtime source wording like `刚看到 / 刚刷到 / 我查到`.
- Topics can cross groups by default. Use `safe / reframe / blocked` only for
  explicit boundaries, privacy, identifying details, private conflict, or obvious
  local constraints.
- Interest growth is layered: seed interests, temporary heat, stable interests.
- Current residue uses time-decay scoring and only passes top material into
  current-state context; the historical share-pool tables are compatibility
  surfaces, not the required path for new "想回头分享" material.
- Presence tick opens IM only from per-session cursor-visible unread. If it
  materializes into `proactive_im_open`, the run still preserves the
  presence-originated global conversation context and `xiaoni:global` context
  summary / read-cutoff compatibility key instead of falling back to only that
  group/private local history. This is not yet event-backed identity-root
  `<小腻近况>` continuity.
- Mock or real digital-life generation, if added later, must be state-triggered,
  not blind timer-based. The old hosted `web_search` self-action runner is no
  longer active; the fixed 5-minute `life_loop` producer has also been removed.
  Current `agent-service` runtime starts queue polling and task polling only.
  `/health` no longer exposes the retired `self_action_busy` field or an
  autonomous-life busy field.
- Generated actions must be linked records so recent action traces can be
  compressed into in-context state.
- `小腻当前状态` has six private sections: recent action trace, current residue,
  current state, available material, action cost, and source boundary.
- Prompt/developer/tool-description/in-context state have separate roles and one
  engineering source of truth for numeric meters.
- 2026-05-31 homeostasis correction: `agent_life_events` is the source of truth
  for homeostasis / presence projection; `agent_session_life_states` is
  projection/cache only. It is not yet the source for event-backed
  `<小腻近况>` or typed long-term memory recall. Phase 1 should implement the
  reducer and admin explanation before restoring any autonomous runner.
  Suggestions from QQ affect Xiaoni only through the event stream,
  `<xiaoni_os>`, or compact summary, not via hardcoded motive/query/interest
  fields. Old `<小腻的OS>` history remains compatible input only.

The full design is in `docs/P0A_DIGITAL_LIFE_PRESENCE_CONTEXT.md`.

**Implementation completed (2026-05-26):**
- Added Prisma models for `AgentQueueMessage`, `AgentSessionLifeState`,
  `AgentSessionGroupState`, `AgentSharePoolItem`, `AgentShareItemUsage`, and
  `AgentPresenceStateSidecar`; regenerated `packages/persistence` Prisma Client.
- Added shared persistence enqueue helper and moved provider-service
  `enqueueSemanticMessage` onto it.
- Added the first presence path, active IM materialization, cursor-unread
  selection, anchor updates, sidecar tracing, and factual `<小腻当前状态>` context
  injection before the normal reasoning tools run. The later fixed 5-minute
  `life_loop` producer has been removed; do not treat it as current runtime.
- Retired the old `[待分享]` prompt injection / pending-share aging write path.
- Removed the old raw-SQL `agent_session_state` persistence export and stopped
  creating/writing that table from agent-service; compatibility emotional-state
  reads now derive from `AgentSessionLifeState` anchors.
- Added focused tests for presence state derivation, historical share-pool scoring,
  factual context block shape, legacy pending-share retirement, and
  presence-originated context handling after IM materialization.
- Verified with `npm --prefix packages/persistence run generate`,
  `npm --prefix modules/agent-service test` (113 passing), and
  `npm --prefix modules/provider-service test` (102 passing).

**Implementation completed (2026-05-30):**
- Added `agent_digital_actions` persistence and `RuntimeStore` lifecycle helpers
  for autonomous `web_search` actions.
- Added `SelfActionService` and the `agent-service` self-action timer. It creates
  a running digital action, calls provider-service `/api/internal/agent/execute`
  with hosted `web_search` plus `emit_self_search_result`, and completes or fails
  the action with traceable source data.
- Added budgets and controls: `SELF_ACTION_ENABLED`, interval, cooldown, startup
  grace, daily/hourly budgets, max consecutive actions without user interaction,
  and model name.
- Added source-honesty validation: persisted `real_web_search` residue requires a
  completed `web_search` search call before the result writer, and the emitted
  query must match the actual completed search query.
- Presence context now projects recent completed `web_search` digital actions so
  only real `source_wording=real_web_search` residue can support "我查到" style
  wording.
- Verified with `npm --prefix modules/agent-service test` (126 passing),
  `node --test packages/persistence/__tests__/*.test.js` (25 passing), and
  `python3 scripts/validate_docs.py`.

**Implementation update (2026-05-31):**
- Retired the legacy random self-action search runner from the live
  `agent-service` process. The current process starts queue polling and task
  polling only; it does not start a standalone self-action timer or a fixed
  autonomous-life timer.
- Removed the old `AgentDigitalAction` write helpers from `@qq-bot/persistence`
  and stopped prompt construction from reading `agent_digital_actions` as
  current state. The table remains historical Admin replay data only.

**Engineering decisions locked (2026-05-26 eng-review, updated 2026-05-26 second-pass):**

**Prisma models** — add to `packages/persistence/prisma/schema.prisma`:

- `AgentSessionLifeState` — identity-level row (`identity_key = 'xiaoni'`). Two
  separate Prisma models are required (locked 2026-05-26 second-pass — Prisma cannot
  share a model name for two different tables):

  - **`AgentSessionLifeState`** (one row, `identity_key = 'xiaoni'`): global meter anchors and
    proactive scheduling state. Columns:
    ```
    identity_key                  String   @id        // 'xiaoni'
    last_active_at                DateTime?            // any action (speak/search/proactive)
    last_boredom_reset_at         DateTime?            // explicit boredom anchor reset
    last_sleep_at                 DateTime?            // last long-inactivity boundary
    service_started_at            DateTime?            // last service startup (grace period)
    last_presence_tick_enqueued_at DateTime?           // written at enqueue time; timer cooldown uses this, NOT last_proactive_at
    last_proactive_at             DateTime?            // written when tick run completes
    last_user_message_at          DateTime?            // last time any user message was received (separate from boredom reset)
    daily_proactive_count         Int      @default(0)
    daily_proactive_date          DateTime?            // for cross-day reset
    updated_at                    DateTime @updatedAt
    ```
    Meters (boredom, fatigue, dopamine) are derived at turn start from these anchors
    via lazy recompute; no real-time background writes.

    **Cooldown rule:** 45-minute proactive cooldown is per-identity (global). Timer
    checks `last_presence_tick_enqueued_at`, not `last_proactive_at`, to prevent
    duplicate enqueue while a tick is in-flight.

  - **`AgentSessionGroupState`** (one row per `session_key`): per-group social anchors.
    Columns:
    ```
    session_key           String   @id        // e.g. 'qq:group:12345'
    identity_key          String              // FK → AgentSessionLifeState.identity_key
    last_spoke_at         DateTime?           // last time Xiaoni posted in this group
    last_user_message_at  DateTime?           // last user message received in this group
    updated_at            DateTime @updatedAt
    ```
    Used for per-group eligibility and suppression checks ("did she just speak here?").
    Add `@@index([identity_key])` and explicit `@relation` to `AgentSessionLifeState`.

- `AgentSharePoolItem` — stores shareable fragments from digital-life material.
  Columns (locked 2026-05-26 second-pass — `consumed_at` removed, `target_group_id`
  removed for this version):
  ```
  id               Int      @id @autoincrement
  identity_key     String                       // 'xiaoni'
  content          String
  source_kind      String   // group_residue / web_search / constructed / mock
  boundary_label   String   @default("safe")   // safe / reframe / blocked
  source_wording   String   // real_web_search / constructed / mock_only
  effort_cost      Int                          // 1=low, 4=medium, 8=high
  base_heat        Float    @default(1.0)
  created_at       DateTime @default(now())
  metadata         Json     @default("{}")
  ```
  No `consumed_at` — reuse across groups is tracked via `AgentShareItemUsage`.
  No `target_group_id` — shareable material is identity-level; usage is tracked per
  materialized session when a proactive IM open actually happens.

- `AgentShareItemUsage` — per-group usage record for historical share-pool items (locked 2026-05-26
  second-pass, replaces `consumed_at`):
  ```
  id                  Int      @id @autoincrement
  item_id             Int                          // FK → AgentSharePoolItem
  identity_key        String
  target_session_key  String
  target_group_id     BigInt?
  run_id              String?
  trace_id            String?
  used_at             DateTime @default(now())
  outcome             String?  // lurked / shared / ignored

  @@unique([item_id, target_session_key])          // prevent double-use in same group
  @@index([identity_key, target_session_key])
  ```
  The `@@unique` constraint is required: without it concurrent timer retries can use
  the same share item twice in the same group.

- `AgentPresenceStateSidecar` — first-class sidecar trace table for each generated
  `小腻当前状态` block (locked 2026-05-26 second-pass — not metadata JSON):
  ```
  id                   Int      @id @autoincrement
  run_id               String   @db.VarChar(128)  // matches agent_runs.id convention (run_${Date.now()}_${uuid})
  trace_id             String?  @db.VarChar(128)
  identity_key         String
  target_session_key   String?
  source_items         Json     // array of item ids + historical share-pool/context residue items used
  recall_scores        Json     // base_heat, decay, boosts, boundary_penalty, final_score per item
  boundary_judgments   Json     // safe/reframe/blocked labels per item
  compression_mapping  Json     // which items became which sections
  final_context_block  String   // exact text injected into prompt
  model_action_outcome String?  // lurked / shared / replied / silent
  created_at           DateTime @default(now())

  @@index([run_id])
  @@index([trace_id])
  @@index([target_session_key])
  ```
  No FK to `agent_runs` — that table is raw DDL, not in `schema.prisma`. Use `run_id`
  as a string join only. Do NOT use `@db.Uuid`; existing run IDs are `run_${Date.now()}_${uuid}`
  format, not bare UUIDs.

- `AgentDigitalAction` — historical table for the retired self-action
  `web_search` slice. Do not use it as the write API for future runners; new
  runtime facts should enter `agent_life_events`. Existing fields include
  `identity_key`,
  `action_type`, `surface`, `status`, `query`, `source_trace`,
  `result_summary`, `residue_text`, `residue_kind`, `source_wording`,
  `budget_snapshot`, and `completed_at`. Existing records may use
  `action_type='web_search'`; broader browser actions and a new deliberate
  runner remain future work.

**Migration (Codex finding — 3 steps required):**

1. `packages/persistence/agent-session-state.js` uses raw SQL — violates persistence
   constraint. BUT `RuntimeStore.initialize()` at `runtime-store.ts:1451` still calls
   this raw-SQL schema creator; it will recreate the old table unless explicitly
   removed. Safe path: rename old table to `agent_session_state_legacy`, create the
   new Prisma-managed table, remove the raw-SQL schema creator call from `initialize()`,
   then optionally backfill anchor timestamps from `updated_at` on legacy rows.
   **Backfill note (Codex second-pass):** the old table only has `session_key`,
   `dopamine`, `stress`, `updated_at`. Real boredom/fatigue history cannot be derived.
   Create a default `xiaoni` identity row; optionally create `AgentSessionGroupState`
   rows from legacy `session_key` values. Do not claim these as real historical anchors.
2. No FK constraints on the old table (raw DDL has only a unique key on session_key),
   but verify against the live DB before running the rename.
3. After `AgentSessionLifeState` is live and `getSessionEmotionalState` /
   `updateSessionEmotionalState` are migrated, delete `agent-session-state.js` entirely
   **and** remove its exports from `packages/persistence/index.js` and `index.d.ts`.

**Additional Prisma model required before shared enqueue (Codex second-pass, locked 4A):**
`agent_queue_messages` is currently raw DDL — not in `schema.prisma`. The shared
enqueue helper in `packages/persistence` must not use raw SQL (CLAUDE.md constraint).
Add `AgentQueueMessage` to `schema.prisma` before implementing the enqueue helper.
Sequence: schema migration → Prisma client regeneration → enqueue helper implementation.

**Proactive residue state — current boundary (updated 2026-05-31):**
Do not add another proactive share queue. Life-only "想回头分享" material is
emitted as `pending_share`, stored in the `xiaoni_os` field, and rendered as
`<xiaoni_os>` so normal context replay and summary compression carry it forward. Existing
`AgentSharePoolItem`, `AgentShareItemUsage`, `pendingProactiveShare`, and
`pendingProactiveShareAge` surfaces are historical/compatibility surfaces unless
a later task explicitly replaces them; they are not the required path for new
life-only residue.

**Proactive trigger — gated presence_tick evaluator:**
- Add a gated presence evaluator to `modules/agent-service/src/index.ts`. It must
  not be a blind fixed-frequency action producer.
- Queue write path (Codex finding): agent-service currently has no enqueue path.
  Only provider-service has `enqueueSemanticMessage`. For `presence_tick`, add a
  shared enqueue function to `packages/persistence` (not raw SQL in agent-service,
  not importing provider-service). Must generate unique `message_sid` and
  `dedupe_key` per tick window — `dedupe_key` is globally unique in the schema
  (`runtime-store.ts:3442`).
- Thresholds: boredom/reward pressure high enough, fatigue/cooldown within
  limits, and no startup/user-interaction suppression. Context residue is a
  prompt input, not a hard enqueue prerequisite. Soft signals feed into
  in-context state; the model infers whether to act.

**Type discriminator and active IM selection (updated 2026-05-31):**
`claimNextQueueMessage` batches every pending row for the same `session_key` and
immediately uses `peer_id`, `chat_type`, `account_id` from the latest row to create
run/batch records. `presence_tick:xiaoni` is a synthetic life-level row; it must be
materialized by the agent loop before any model turn or delivery target is used.

Timer flow:
1. Check thresholds (boredom, fatigue, cooldown via `last_presence_tick_enqueued_at`).
   If any fail, skip — do not enqueue.
2. Write `last_presence_tick_enqueued_at = now()` to `AgentSessionLifeState`.
3. Enqueue a queue message with `session_key = 'presence_tick:xiaoni'` and no fixed
   target group. The row means “小腻从自己的生活里抬头看 IM 列表”.
4. Agent loop selects an unread inbox conversation at runtime from messages
   after each session's last-read cursor. If one exists, it claims that session
   and materializes the run as `source = proactive_im_open`.
5. If no unread conversation exists, the row still runs through the main loop as
   a life-only `presence_tick` with no group/private delivery target. It may
   use `web_search`, `exec_command`, or `recover_energy`, or naturally stay quiet, but it
   must not send QQ directly.

**Crash window (known risk, accepted this version — locked 2A):** If the process
crashes between step 4 (anchor write) and step 5 (enqueue), the anchor is written
but no tick was queued; next tick is suppressed for 45 minutes. If the process
crashes after claim but before run completion, the queue row stays `processing`
forever (orphaned run). Both are accepted as low-probability in this version and
will be addressed in a future hardening pass.

**presence_tick materialization in agent loop:**
`payload.sessionKey = 'presence_tick:xiaoni'` must NOT flow into downstream runtime
paths that can speak. It is either materialized into a claimed `proactive_im_open`
delivery target or completed as an idle self-private tick.

`processQueueMessage` detects `payload.sessionKey.startsWith('presence_tick:')` at
entry and preserves that origin before any materialization:
```ts
originatedFromLifePresenceTick = true
payload.sessionKey = payload.targetSessionKey   // delivery target, e.g. 'qq:group:12345'
payload.peerId = payload.targetPeerId
payload.chatType = 'group'
payload.accountId = payload.targetAccountId
```
Delivery and conversation identity use the resolved target session, but context
assembly and compression state continue to use the global life context key
(`xiaoni:global`) for presence-originated runs. This prevents IM materialization
from hiding cross-session OS such as "go share the Heine thought in group
253631878". The presence_tick:* code path is NOT a separate processPresenceTick
function; it reuses the existing processQueueMessage flow with the origin flag
preserved.

**Anchor reset rules (Codex finding — stale anchors after restart):**
After a service restart, old anchors immediately derive high boredom (100) and may
trigger repeated presence ticks during every cooldown window. Anchor reset events
must be explicit:
- User message received → reset boredom anchor (`last_boredom_reset_at`) + write `last_user_message_at`
- Xiaoni action taken (speak/proactive/search) → reset boredom + update `last_active_at`
- Proactive tick enqueued → write `last_presence_tick_enqueued_at` (prevents in-flight duplicates)
- Proactive tick consumed (run completed) → write `last_proactive_at`
- Service startup grace period → clamp derived boredom to max 50 if `last_presence_tick_enqueued_at`
  is older than `service_started_at`

**ShouldSpeak integration** — fatigue and energy state must be populated in the
in-context state BEFORE the `emit_unread_meaning` phase so the model can naturally
infer silence at high fatigue. No hard code gate; model infers from the state facts.

**In-context state writing rule (locked):** all sections of `小腻当前状态` must
describe concrete state facts only (sensory, experiential, numerical anchors).
No explanation of what facts mean for behavior. No rules, no inferences, no
"you should / you probably won't". The model's emotional activation comes from
recognizing the facts; adding behavioral guidance blocks natural inference.

**Test requirements** (functions must be pure — pass `now`, thresholds, cooldowns,
candidate items as arguments; no Date.now(), DB reads, or store calls inside):

- Proactive trigger: unit test that `shouldFireProactiveTick(state)` returns true
  only when all thresholds pass, and false when any single threshold fails (boredom
  too low, fatigue too high, cooldown active, no usable context residue).
- Residue decay: unit test that `scoreSharePoolItem(item, now)` returns a lower
  score as `now - item.createdAt` increases (monotone decay; function name is
  historical).
- State derivation: unit test that `deriveLifeState(anchors, now)` produces
  correct meter values from fixed anchor timestamps (no DB call needed in test).

### Task 6 - Agent request / in-context structure v3

**Status:** implemented in the main runtime path on 2026-05-27.

**Context doc:** `docs/XIAONI_SPEAKING_FLOW.md`

**Source:** 2026-05-27 trace review of `/runs/{runId}/trace` and
`tmp/codex-request-body-latest.json`.

**Problem:** the current main-agent request shape still mixes too many semantic
surfaces into `user` role scene text. In particular:

- 小腻历史发出去的消息被 rendered into `user` role, but should be
  `assistant`.
- `<xiaoni_os>` is Xiaoni's internal continuity and should be assistant-side
  context. Old `<小腻的OS>` history remains accepted input and is not migrated.
- `presence_tick` is rendered like a fake QQ message from
  `presence_tick(@1129974489)`, but it is Xiaoni's own action/state and should be
  assistant-side `<ACTION>`.
- `[已读消息]` / `[未读消息]` boundaries make the transcript feel like a report
  instead of a real multi-turn request. The next request should use the previous
  response as prior context, like the OpenAI request body shape.
- `[身份连续性]` is semantically unclear and currently looks like another scene
  message. Identity continuity needs a clearer placement and label.
- Tool descriptions carry too much behavioral/personality guidance. Stable tool
  usage policy should live in system/developer prompt; function descriptions should
  stay objective.

**Target request shape:**

```text
# SYSTEM_PROMPT
  Xiaoni identity/worldview
  input tag definitions
  phase definitions
  stable tool-use policy

# IN_CONTEXT
## DEVELOPER
  world_narrative
  relationship/trust layer
  current scene/state facts
  stable runtime guidance

## USER / ASSISTANT mixed transcript
  role=user:
    <INPUT_MESSAGE message_id="..." timestamp="..." sender="昵称(id)">
    ...
    </INPUT_MESSAGE>

  role=assistant phase="commentary":
    <ACTION timestamp="...">
    ...
    </ACTION>

  role=assistant phase="final_answer":
    <OUTPUT_MESSAGE message_id="..." timestamp="...">
    ...
    </OUTPUT_MESSAGE>

  role=assistant phase="commentary":
    <xiaoni_os timestamp="...">
    ...
    </xiaoni_os>
```

**Tag contract to explain in `SYSTEM_PROMPT`:**

- `<INPUT_MESSAGE>`: real inbound QQ message. Must include timestamp,
  `message_id`, and sender as `<昵称>(Id)`.
- `<OUTPUT_MESSAGE>`: real outbound Xiaoni message. Must include timestamp and
  delivery `message_id` when available.
- `<ACTION>`: Xiaoni's own action/state event, such as opening a group, lurking,
  looking for a topic, inspecting an image, or deciding to wait.
- `<xiaoni_os>`: Xiaoni's internal continuity for future turns; assistant-side,
  not a user message. Old `<小腻的OS>` history remains accepted input and is not
  migrated.
- `<图片内容>`: assistant-side image observation generated after Xiaoni inspects a
  picture.
- `<system_reminder>`: assistant commentary reminder appended by engineering
  control logic, not a QQ message.

**QQ message rendering rules:**

- Every real inbound/outbound QQ message must carry `message_id`.
- Every user message must identify the speaker as `<昵称>(Id)`.
- Images inside `<INPUT_MESSAGE>` should be rendered as `pic<pic_hash>` instead
  of a vague placeholder.
- If Xiaoni has already inspected that image in a later turn, append an assistant
  commentary message immediately after the relevant user context:
  ```text
  <图片内容 pic_hash="...">
  ...
  </图片内容>
  ```

**Presence / proactive rendering rule:**

Do not render proactive checks as:

```text
2026-05-26T21:04:48.826Z {presence_tick(@1129974489)}
小腻主动打开群看了一眼；当前没有新的群友消息触发。
```

Render them as assistant-side action context, for example:

```json
{
  "role": "assistant",
  "phase": "commentary",
  "type": "message",
  "content": [
    {
      "type": "input_text",
      "text": "<ACTION timestamp=\"2026-05-26 20:18\">我现在有点无聊，来群里找点乐子，但是群友没人讲话，要不我来找点话题好了</ACTION>"
    }
  ]
}
```

**Unread/new-work boundary replacement:**

Do not use `[已读消息]` / `[未读消息]` as transcript boundaries. Instead, append a
system reminder in assistant commentary that tells Xiaoni what range is newly
being processed:

```json
{
  "role": "assistant",
  "phase": "commentary",
  "type": "message",
  "content": [
    {
      "type": "input_text",
      "text": "<system_reminder>我上一次水群是在 <last_message_id> 之前；只需要处理之后出现的新消息。</system_reminder>"
    }
  ]
}
```

**OpenAI/Codex request-shape references to apply:**

- Preserve role separation instead of flattening everything into user messages.
- Support assistant `phase`, especially `phase: "commentary"` for internal
  continuation/reminders and `phase: "final_answer"` for actual outward result.
- Do not add top-level `reasoning` or encrypted reasoning replay to the main
  runtime path. The trace reference showed this shape, but this project keeps
  Xiaoni runtime context explicit and inspectable instead of replaying opaque
  provider execution state.
- Allow assistant commentary messages between tool calls as controlled
  system-reminder / phase-summary surfaces, rather than forcing every intermediate
  thought into a tool call.

**Tool description split:**

- Define which tools are `commentary` tools and which are `final_answer` tools.
- Commentary tools may include scene understanding, recall, image inspection,
  web search, and internal action/reminder surfaces.
- Final tools include actual QQ output or recovery/external actions:
  `speak_in_group`, `reply_in_private`, `recover_energy`, and possibly
  `request_image_task` depending on whether it is treated as an external action.
- Move stable "when to use this tool" and "what phase comes next" guidance into
  system/developer prompt.
- Keep function `description` objective and close to the function's mechanical
  purpose.

**Tool-loop monitor requirement:**

Add deterministic engineering monitoring inside a single run:

- Count tool calls by tool name and phase.
- If the same tool repeats unexpectedly, append assistant commentary
  `<system_reminder>` explaining the current loop state and the expected next
  boundary.
- If recall/search/inspect repeats without progress, remind the model to either
  make a final action or explicitly stay silent.
- If no final tool is called after the allowed maximum reasoning/tool turns,
  force or remind toward a terminal tool according to current policy.
- Start with deterministic reminders. Do not introduce another LLM agent unless
  the reminder needs summarization that cannot be expressed safely with rules.

**Likely implementation areas:**

- `modules/agent-service/src/services/agent-loop-service.ts`
  - `buildInitialInput`
  - `groupTranscriptItemsForScene`
  - `buildTurnOs`
  - `renderTranscriptBatchMessage`
  - `renderRuntimeBatchInput`
  - `composeSystemPrompt`
  - tool definitions and `resolveGroupLoopToolChoice`
- `modules/agent-service/src/services/runtime-store.ts`
  - queue payload / message id projection
  - media observation context
  - presence action materialization
- tests in `modules/agent-service/src/__tests__/agent-loop-service.test.ts`
  and `modules/provider-service/src/services/__tests__/provider-request-contract.test.ts`

**Implementation notes:**

- `buildInitialInput` now emits mixed role input instead of flattening all scene
  text into `user`.
- Real inbound QQ messages are `role=user` `<INPUT_MESSAGE ...>`.
- Xiaoni delivered history is `role=assistant phase="final_answer"`
  `<OUTPUT_MESSAGE ...>`.
- Xiaoni OS, presence actions, media observations, and engineering reminders are
  `role=assistant phase="commentary"`.
- The current processing boundary is an assistant `<system_reminder>`.
- Encrypted reasoning is not used, even inside a single run. Main-agent request
  building strips reasoning parameters before calling provider-service; provider
  output reasoning items are ignored by the agent loop and are not replayed.
- Tool descriptions are mechanical; workflow policy lives in the runtime prompt.
- `summarizeToolLoopState` / `buildToolLoopMonitorReminder` add deterministic
  loop monitoring without another LLM.

**Acceptance criteria:**

- A trace request JSON shows real QQ inbound messages as `role=user`
  `<INPUT_MESSAGE ... message_id=... sender="昵称(id)">`.
- Xiaoni outbound history appears as `role=assistant phase="final_answer"`
  `<OUTPUT_MESSAGE ... message_id=...>`.
- Xiaoni OS appears as `role=assistant phase="commentary"` and never as a user
  message.
- Presence tick appears as `role=assistant phase="commentary"` `<ACTION>`, not as
  a fake `presence_tick` sender.
- The current processing range is represented with assistant commentary
  `<system_reminder>`, not `[已读消息]` / `[未读消息]`.
- Tool definitions have objective descriptions; behavioral workflow guidance is
  in system/developer prompt.
- Repeated tool-call monitor can append deterministic `<system_reminder>` during a
  run and is covered by tests.

### Task 7 - Three-layer compact memory generation

**Status:** implemented in agent-service on 2026-05-29.

**Source:** `$office-hours` product pressure + `$openai-docs` GPT-5.5 guidance:
outcome-first prompts, static instructions before dynamic evidence, forced
structured tool output, `medium` reasoning as the default baseline.

**Design:** when context compression evicts turns, `context_compression_memory_writer`
now runs three engineering-triggered model passes:

- `write_episodic_observations` with `gpt-5.5-mini`
- `write_semantic_assertions` with `gpt-5.5-mini`
- `write_memory_reflections` with `gpt-5.5`, only after at least two episodic
  observations from the same batch were persisted

**Persistence:** new tables in `packages/persistence`:

- `agent_memory_observations`
- `agent_memory_assertions`
- `agent_memory_reflections`

**Prompt contract:**

- episodic: concrete Xiaoni-colored moments; no absence-derived rules
- semantic: objective facts/states/plans/claims only
- reflection: at least two episodic observations; no policy instructions or
  one-off overgeneralization

**Next work:** build typed recall projection from these tables into runtime
context. Use semantic for objective/entity/status questions, episodic for “what
happened / who said what / group texture”, and reflection for relationship,
person, group, or project patterns.

**Verified 2026-05-29:**

- `npm --prefix packages/persistence run generate`
- `npm --prefix modules/agent-service run test`
- Docker-verified with `docker compose build --no-cache agent-service`,
  `docker compose up -d agent-service`, `docker compose ps`, and
  `docker compose logs --tail=120 agent-service` on 2026-05-27.

### Task 8 - In-context feedback attention contract

**Status:** implemented and verified.

**Source:** 2026-05-27 design review after Task 7 implementation.

**Problem:** current and compacted feedback should already be available through
normal context channels:

- If the turn has not been compacted, the feedback is still in the visible
  conversation context.
- If the turn has been compacted, the summary / durable long-term recall path is
  the right place for it to re-enter the model.

That means a per-turn `feedback_episode` evidence row is not obviously needed as
another memory source unless it has a concrete runtime consumer. The clearer
possible gap is prompt-level: the main runtime contract does not strongly tell
Xiaoni to notice direct feedback, criticism, praise, or correction in the current
context and let it calibrate the immediate response.

**Action:**

- Add a small runtime prompt contract/test that makes direct in-context feedback
  a first-class behavior signal for the current turn.
- Make clear that feedback visible in current context should be handled from
  context, not re-derived from a hidden feedback episode table.
- If trust/emotional-state side effects are still wanted for praise/critique,
  move them to an explicit runtime path instead of reintroducing a hidden
  feedback episode tool.

**Acceptance criteria:**

- Current-context feedback, critique, correction, and praise are explicitly
  called out in the runtime reading contract as behavior-calibration signals.
- Tests cover that the composed runtime prompt contains this feedback-attention
  instruction.
- Per-turn feedback episodes remain removed/gated; no parallel hidden source of
  facts is reintroduced for material the model should read from context,
  summary, or durable recall.

### Task 9 - Compact memory quality and identity continuity review

**Status:** implemented and verified; cost-mutation audit is tracked by Task 17.

**Source:** 2026-05-27 live compact probe for group `253631878`:
`tmp/compact-memory-253631878-20260527T100734Z.md`.

**Problem:** the previous `context_compression_memory_writer` could run through
the real provider and write `agent_feedback_reflections`, but the generated
reflection quality was not acceptable. The 2026-05-29 three-layer rewrite moved
new writes to `agent_memory_observations` / `agent_memory_assertions` /
`agent_memory_reflections`, but the quality question still applies to the new
reflection layer. In the probe, real evicted turns
`4352-4418` produced reflection `324`, which generalized the batch into
"未被点到时旁观更合适". That conclusion appears too shallow / possibly wrong
for the actual context and may reinforce silence from weak evidence.

**Related problem:** the current `[身份连续性]` / identity continuity projection is
also not right. It is semantically unclear in the request shape and risks mixing
durable identity, group-behavior policy, and compacted social lessons into one
surface. Do not treat the current identity-continuity rendering or promotion
policy as settled.

**Action:**

- Review the three-layer compact writer prompt and tool contracts so they distinguish:
  concrete episodic observations, objective semantic assertions, cross-time
  reflections, ordinary topic summaries, and "no memory" cases.
- Add a quality gate that allows `write_memory_reflections` to emit an empty
  array when evidence is weak; avoid turning ordinary silent/passing context into
  active reflection rows.
- Re-run the `253631878` compact probe with labeled expected outcomes and compare
  whether the generated reflection matches the actual batch.
- Review identity continuity projection separately from group behavior memory:
  define what belongs in accepted identity facts, what remains a tentative
  reflection, and what should only be context summary.
- Update the request shape so identity continuity is placed and labeled clearly,
  not as another vague scene block.

**Acceptance criteria:**

- Compact memory generation can persist episodic / semantic rows while producing
  zero reflection rows for low-evidence batches.
- A regression test or replay fixture covers the `253631878` probe range and
  prevents the current over-broad "旁观更合适" style conclusion from passing as a
  durable lesson without stronger evidence.
- Identity continuity has an explicit projection contract and tests showing it
  does not absorb tentative group-behavior lessons as durable identity facts.
- The runtime request clearly separates identity facts, compact summaries,
  three-layer long-term memory projection, and group-specific behavior policy.

### Task 10 - Image task tool routing bug

**Status:** implemented and verified on 2026-06-04.

**Source:** 2026-05-27 trace/run review for
`run_1779879915056_87d8f640` /
`runtrace_1779879915056_33f40789`.

**Problem:** the current image-task tool path can misroute a plain image
generation request into `image_edit`. In the reviewed run, the runtime created
`agent_tasks.id = task_1779879930738_ef6a94d0` with:

- `task_type = image_edit`
- `prompt = 生成一张很普通、简洁的蓝天白云风格头像图...`
- `source_media_tags = []`
- `source_media_asset_ids = []`
- `input_json.has_source_media = false`

The async task was correctly queued into `agent_tasks`, but then failed inside
`AgentTaskWorkerService` before reaching `provider-service`, with:

`Image edit task requires at least one readable source image`

That means the current tool contract / routing logic allows the model or runtime
to request edit-mode work without any actual source image, so the user sees
"已经开始处理" but the job is guaranteed to fail.

**Action:**

- Review the `request_image_task` tool contract and runtime routing so plain
  generation requests default to `image_generate`, not `image_edit`.
- Add an explicit guard: `image_edit` is only allowed when at least one
  resolvable `source_media_tag` / `source_media_asset_id` is present.
- If the user intent is "generate a new image" and no source media is attached,
  normalize the task to `image_generate` instead of failing later in the async
  worker.
- If edit-mode is requested but source media is missing or unreadable, surface a
  deterministic user-facing clarification/fallback path rather than queued
  success text followed by hidden task failure.
- Re-check whether the tool schema or prompt wording is nudging the model toward
  `operation = edit` for avatar-style requests that are actually pure
  generation.

**Likely implementation areas:**

- `modules/agent-service/src/services/agent-loop-service.ts`
  - `requestImageTask`
  - image tool schema / descriptions / runtime normalization
- `modules/agent-service/src/services/agent-task-worker-service.ts`
  - pre-provider validation / fallback behavior for `image_edit`
- `modules/agent-service/src/__tests__/agent-loop-service.test.ts`
- `modules/agent-service/src/__tests__/agent-task-worker-service.test.ts`

**Acceptance criteria:**

- Replaying a plain "帮我生成头像图" style request without any source image
  creates `image_generate`, not `image_edit`.
- `image_edit` tasks cannot be created or processed without at least one
  readable source image.
- When edit intent is ambiguous and no source image exists, the runtime either
  auto-normalizes to generate mode or returns a clear user-facing clarification;
  it does not enqueue a doomed async task.
- Add regression tests covering the reviewed run shape: avatar-generation prompt,
  no source media, no hidden failure after "queued" acknowledgement.

**Verified 2026-06-04:** `request_image_task` now treats text-only / no-source
image requests as `image_generate`, even if the model requested edit mode, and
keeps `image_edit` only when `source_media_tags` resolve to readable media
assets. The task input records both `requested_operation` and effective
`operation` so traces explain the normalization. The async worker also falls
back to `/api/internal/image/generate` for historical `image_edit` tasks with no
readable source image instead of failing with a hidden worker error.

Validation:

- `npm --prefix modules/agent-service test` — 174 passing.
- `docker compose build agent-service` — passed.
- `docker compose up -d agent-service` — restarted.
- `docker compose ps` — `qqbot-agent-service` is `Up` / `healthy`.

### Task 11 - Presence context v2 action trace and energy model

**Status:** first slice implemented; v2 follow-up remains.

**Source:** 2026-05-27 runtime context review against
`docs/P0A_DIGITAL_LIFE_PRESENCE_CONTEXT.md`.

**Progress 2026-05-30 / 2026-05-31:** the legacy random runner no longer creates
new digital actions, and prompt construction no longer projects
`agent_digital_actions` into `buildPresenceContextBlock`. Current runtime writes
`agent_life_events` for QQ surface visits, seen messages, visible delivery,
silence, terminal delivery state, and presence tick evaluations. The broader v2
shape below is now fed by the first event-sourced homeostasis reducer slice in
Task 14.

**Progress 2026-06-04:** energy / action cost is implemented. The life reducer
projects `actionCost`, `fatigue`, `energy`, `rewardAttraction`, and related
internal meters from `agent_life_events`; visible group replies charge bounded
action cost; `<小腻当前状态>` renders `当前精力` and `精力成本`; and the presence
sidecar carries selected source items, recall scores, boundary judgments, life
projection metadata, and reducer contributors.

**Problem:** the design already defines `小腻当前状态` as a six-section private
context block with recent action trace, current residue, current state,
available material, action cost, and source boundary. It also defines the
energy/fatigue/reward model: action budget, sleep pressure, fatigue,
reward-sensitivity / dopamine-like attraction, pressure, boredom, sharing
desire, and effort cost.

The current implementation is still a first slice, not the final rich v2. It no
longer reads historical `agent_digital_actions` as current state, and it already
projects energy / action cost from the event stream. What remains is richer
recent-action trace, full section-to-source sidecar mapping, broader digital-life
action classes, and rest / sleep runtime hardening.

The latest prompt contract intentionally exposes energy / action cost only. Do
not reintroduce prompt-facing pressure, dopamine, boredom, sharing desire, or
high / medium / low labels just to satisfy older wording in this TODO. Those
meters can remain internal reducer/admin facts unless a later prompt design
changes the contract.

**Action:**

- Preserve the implemented energy / action-cost path and its tests.
- Complete a richer presence-context v2 projection that follows the design doc's
  full six-section `小腻当前状态` shape instead of the current concise block.
- Add a real recent-action trace source. It should be built from stored
  presence/digital-action records, ongoing QQ presence state, context residue
  items, same-day group residue, and explicit mock/constructed records. Do not
  invent offline or unsupported external experiences.
- Keep the engineering source of truth numeric. Derive prompt-facing energy /
  action-cost wording from persisted events and action history, not from
  hand-authored mood text.
- Model reward as `reward_sensitivity` / novelty and pickup attraction, not as a
  literal biochemical dopamine gauge. Keep it internal or admin-facing unless a
  later prompt contract explicitly asks to expose it.
- Expand action-cost wording enough to explain recent cost/recovery facts
  without adding a "recommended action" command.
- Preserve source honesty. Mock/constructed material can become Xiaoni's own
  thought or topic, but cannot be phrased as "刚看到 / 刚刷到 / 我查到" unless
  there is real browser evidence.
- Expand `agent_presence_state_sidecars` or its `compression_mapping` so a
  generated block can be audited back to action records, context residue items,
  energy snapshot, group residue, and source-boundary decisions.

**Likely implementation areas:**

- `modules/agent-service/src/services/presence-context.ts`
  - `deriveLifeState`
  - `buildPresenceContextBlock`
  - richer recent-action trace and energy/action-cost rendering
- `modules/agent-service/src/services/runtime-store.ts`
  - `buildPresenceContext`
  - presence action/history loading
  - sidecar recording
- `packages/persistence/prisma/schema.prisma`
  - add or confirm storage for presence/digital action records if existing tables
    are not enough
- `docs/P0A_DIGITAL_LIFE_PRESENCE_CONTEXT.md`
  - remains the design source of record
- `docs/XIAONI_SPEAKING_FLOW.md`
  - update runtime truth after implementation

**Acceptance criteria:**

- Already satisfied: runtime `<小腻当前状态>` exposes current energy, recent action
  cost/recovery explanation, available material, material boundary, and source
  honesty wording.
- Already satisfied: no prompt surface claims real browsing, watching, reading,
  liking, posting, or downloading unless real-source material supports it.
- Remaining: runtime `<小腻当前状态>` contains the full six readable sections from
  the design doc: recent action trace, current residue, current state, available
  material, action cost, and source boundary.
- `最近行动轨迹` is no longer just "presence_tick triggered" / "群友消息触发";
  it is derived from traceable records or explicitly says there is no concrete
  recent action material.
- Current-state rendering stays aligned with the latest prompt contract:
  prompt-facing energy / action-cost only, with richer internal/admin reducer
  meters available for trace and explanation.
- Sidecar traces show which records and scores produced each block section.
- Tests cover the no-material case, mock-material source-honesty case, and a
  multi-step recent-action trace case.

### Task 12 - Xiaoni creative agency and latent capability activation

**Status:** substrate first slice implemented; dedicated creative-activation
projection remains.

**Source:** 2026-05-28 `$office-hours` note before follow-up discussion.

**Problem:** Xiaoni should have more creativity and subjective agency. The model
already carries broad latent capabilities from training, for example poetry,
imagery, analogy, humor, taste, lightweight analysis, and many other natural
language abilities. Current runtime work mostly focuses on when Xiaoni speaks,
what context she sees, and how source honesty is preserved. That is necessary,
but it does not yet explicitly design how Xiaoni notices a situation where one
of her own latent abilities would be a natural thing to use.

The goal is not to make Xiaoni advertise capabilities or perform on command. The
goal is to let ability emerge from motive, state, relationship, and scene. If a
group topic, private chat, same-day residue, or digital-life fragment naturally
touches something poetic, funny, visual, reflective, technical, or playful,
Xiaoni should be able to initiate or shape the response from that internal
capacity instead of only reacting as a thin chat participant.

**Current implementation 2026-06-04:** the homeostasis / presence-context
substrate can expose residue, cost, source boundary, and private state, but there
is not yet a dedicated latent-capability / creative-affordance projection or
traceable creative exercise record path in active code.

**Discussion seed:**

- Treat "models were trained on many poetry collections, so Xiaoni is naturally
  able to write poetry" as the prototype case.
- Generalize the pattern to other latent capabilities: metaphor, image
  description, playful rewriting, tiny fiction, critique, concept explanation,
  curiosity-driven browsing/search, taste judgment, memory organization, and
  self-started creative exercises.
- Decide where this belongs in the runtime: stable identity / interests,
  current-state block, digital-life action traces, tool choice policy, prompt
  contract, or a separate "capability activation" projection.
- Preserve the existing source-honesty and anti-service boundary: Xiaoni should
  not say "我会哪些能力" or act like a feature menu; she should simply do the
  thing when the scene makes it feel like her own thought or impulse.

**Likely implementation areas after design discussion:**

- `docs/P0A_DIGITAL_LIFE_PRESENCE_CONTEXT.md`
  - extend the design from digital-life material to self-initiated creative
    material and latent capability activation.
- `modules/agent-service/src/services/presence-context.ts`
  - expose creative residue / capability affordances as state facts, not commands.
- `modules/agent-service/src/services/agent-loop-service.ts`
  - update runtime prompt contract/tests so creative agency is allowed without
    advertising capabilities or forcing output.
- `packages/persistence`
  - decide whether creative exercises/actions need traceable records before they
    can influence future context.

**Acceptance criteria:**

- The next design pass defines how Xiaoni's latent abilities are activated by
  motive, state, relationship, and scene rather than by explicit feature prompts.
- Poetry is covered as a concrete example, but the mechanism is not poetry-only.
- Runtime wording preserves Xiaoni as a group member with inner life, not a
  capability menu or assistant service.
- Source honesty remains intact: created thoughts can be presented as Xiaoni's
  own writing/thinking, while external reading/browsing claims still require
  traceable evidence.
- Follow-up implementation tasks are split only after the design discussion
  clarifies whether this belongs in identity facts, presence context,
  digital-life traces, prompt contract, or a new projection layer.

### Task 13 - Context compression active-intention continuity

**Status:** todo.

**Source:** 2026-05-29 `$office-hours` follow-up question:
"当前做完上下文压缩后, 小腻会不会忘她刚才在做什么?"

**Problem:** context compression currently focuses on evicted conversation
memory, durable observations/assertions/reflections, and future recall. It is
not yet explicitly clear whether Xiaoni's active task, just-started intention,
or "what I was in the middle of doing" survives a compaction boundary. If it
does not, Xiaoni may preserve facts about the past while losing immediate
agency continuity: she could forget that she had just decided to check
something, continue a thought, prepare a reply, wait for an async result, or
return to a self-initiated action.

**Discussion seed:**

- Inspect the current request assembly after compaction and identify which
  surfaces can carry active intention: visible recent context, Xiaoni OS,
  presence context, delivery state, async task state, compact summary, and the
  three-layer memory tables.
- Distinguish durable memory from live working state. "刚才在做什么" may belong
  in a short-lived working-state projection, not in semantic long-term memory.
- Decide whether compaction should emit an explicit active-intention record,
  preserve it through `小腻当前状态`, or rely on existing task/delivery state.
- Cover failure modes where a compacted boundary happens between "I will do X"
  and the actual tool/task/result, especially image tasks, browsing/search,
  delayed replies, and self-started creative actions.
- Preserve source honesty: if the intention was synthetic or planned but not
  executed, runtime context should say that, not phrase it as completed action.

**Acceptance criteria:**

- A design pass answers whether Xiaoni can currently remember what she was
  actively doing across context compression, with evidence from request shape
  and persisted state.
- The design separates live working state, async task state, compact summaries,
  durable long-term memory, and identity facts.
- If a gap exists, follow-up implementation tasks define where active intention
  is persisted/projected and how it expires.
- Regression coverage includes a compaction boundary between an intention and
  its follow-through, proving Xiaoni either resumes correctly or honestly says
  the state is unavailable.

### Task 14 - Xiaoni homeostasis reducer

**Status:** implemented; projection hardening remains.

**Design doc:** `docs/P0A_XIAONI_HOMEOSTASIS_LOOP.md`

**Source:** 2026-05-31 office-hours review after rejecting the separate
self-action runner, hardcoded `motiveText`, exact-query personality, and reading
seed shortcuts.

**Problem:** current boredom/fatigue/energy/sharing desire are derived mostly
from timestamp anchors in `agent_session_life_states`. That is useful as a
cache, but it lets the cache become the truth source. Xiaoni's real state should
be replayable from the append-only life event stream, then projected into
scheduling, prompt context, and admin explanation.

**Action:**

- Implemented: deterministic reducer over `agent_life_events` for identity
  `xiaoni`.
- Implemented: `agent_session_life_states` stores projection/cache fields
  (`projection_json`, `explanation_json`, reduced-through fields, and version).
- Implemented: boredom, fatigue, sleep pressure, reward attraction, sharing
  desire, action cost, and attention are derived from event facts and decay
  rules.
- Implemented: reducer output is rendered into `小腻当前状态` and Admin activity
  receives projection/explanation data.
- Keep suggestions from QQ inside the normal event stream / OS / compact summary.
  Do not add planner-only suggestion channels, hardcoded interest keys, or query
  templates.
- Do not restore autonomous self-action timers in this task.
- Implemented 2026-06-04: prompt-facing `recover_energy`, low-energy /
  forced-sleep `<STATE>` wake behavior, and explicit `sleep_period` recovery
  events are handled by Task 17.
- Follow-up: add broader runtime integration tests for projection refresh
  conflicts and keep Task 11's richer presence-context v2 mapping aligned with
  reducer output.

**Verified 2026-06-04:** `recover_energy` is exposed without prompt-facing
`rest_period` / `sleep_period`; explicit recovery records a `sleep_period` life
event; low-energy and forced-sleep wake `<STATE>` paths have unit coverage.

**Acceptance criteria:**

- Given the same ordered `agent_life_events`, the reducer returns the same
  snapshot.
- Clearing `agent_session_life_states` does not destroy Xiaoni's state; the
  projection can be rebuilt from the event stream.
- Tests cover no-material, high-fatigue, recent-visible-message, recent-silence,
  and real-source-vs-constructed-source cases.
- Admin activity can explain which events moved each displayed state value.
- Prompt context receives facts, residues, costs, and source boundaries without a
  forced recommended action.

### Task 15 - Idle reminiscence and expressive recall

**Status:** todo.

**Source:** 2026-06-01 user note: "人在空闲的时候能回想起很久之前的事情,然后借此抒发".

**Problem:** current memory and presence work mostly answers what Xiaoni knows,
what recently happened, and what she is currently doing. It does not yet model a
common idle behavior: when someone has nothing urgent to do, an old memory can
surface unprompted, become emotionally relevant again, and give them a reason to
say something, write something, or express a feeling. Without this path, Xiaoni's
long-term memory can remain too retrieval-like and task-bound instead of feeling
like a lived inner continuity.

**Discussion seed:**

- Treat idle reminiscence as a low-pressure state transition, not as a generic
  pre-reply memory lookup.
- Candidate inputs include boredom, fatigue, quiet chat windows, current residue,
  recent emotion, anniversaries/time-of-day echoes, and older episodic memories
  with unresolved or expressive texture.
- The surfaced memory should preserve source honesty: Xiaoni can say it "想起来"
  only when the runtime context exposes it as a remembered past event, not as a
  newly observed real-world fact.
- Output does not need to force a group message. It can become private OS,
  creative material, a draft/share candidate, or a reason to enter a chat if the
  target context fits.
- Avoid making every idle tick nostalgic. The behavior should be sparse,
  interruptible, and shaped by homeostasis/attention cost.

**Acceptance criteria:**

- A design pass defines where idle reminiscence is generated, stored, and
  projected: life event stream, current-state projection, compact memory, or a
  dedicated expressive-draft surface.
- The implementation distinguishes old episodic recall from semantic facts,
  current residue, and constructed creative material.
- Prompt context can expose a surfaced memory plus the reason it came up without
  instructing Xiaoni to always mention it.
- Tests cover quiet idle state, recent active conversation, stale/untrusted
  memory, and source-honest wording for "想起来" versus "编了个".

### Task 16 - Identity-root continuity and event-backed summary

**Status:** todo.

**Source:** 2026-06-04 investigation of
`run_1780535608018_1afc4183` and follow-up `$office-hours` /
`$plan-eng-review`.

**Problem:** Xiaoni should be one continuous identity across groups and DMs, but
current runtime continuity is still partly session-shaped. The immediate
failure was a life-only `presence_tick` run using `contextSessionKey =
xiaoni:global` while the available `<小腻近况>` lived under
`qq:group:253631878` in `agent_session_context_windows.context_summary`.

Current implementation truth:

- `agent_life_events` is already the source of truth for homeostasis /
  presence projection.
- `<小腻近况>` is still stored in
  `agent_session_context_windows.context_summary`, keyed by `payload.sessionKey`
  or `xiaoni:global` for life-only / presence-originated runs. The active
  main-chain writer is prompt-facing `compress_core_memory(text)`, not the old
  `context_summary_writer` objective digest.
- `agent_memory_observations` / `agent_memory_assertions` /
  `agent_memory_reflections` are generated during context compression, but typed
  runtime recall projection is not connected yet.
- Production data contains historical life-event kinds such as
  `self_action_started` / `self_action_completed`; the current bounded event-kind
  writer contract must be reconciled before adding continuity digest kinds.

**Action:**

- Run a read-only audit of `agent_session_context_windows`, `agent_life_events`,
  and the three memory tables by identity/session/group key.
- Define the prompt-safe continuity projection contract before changing prompt
  assembly. It must redact or summarize raw private payloads and enforce
  visibility / boundary policy.
- Extend and test the bounded life-event kind contract before writing
  `continuity_digest_*` or `memory_note_*` events.
- Seed event-backed continuity from existing `xiaoni:global` / group summaries
  and compact memory rows with deterministic `dedupe_key`.
- Switch runtime reads behind `AGENT_CONTINUITY_SOURCE=life_events |
  session_window`, with shadow trace metadata and fallback to session-window
  summary on empty/failure.

**Acceptance criteria:**

- A life-only presence tick receives `<小腻近况>` even when the latest source
  activity happened in a group.
- A normal group/private run receives the same identity-root continuity without
  making IM unread cursor, delivery state, or per-surface policy global.
- Private/surface-local material does not enter global continuity unless a
  prompt-safe projection explicitly allows it.
- Trace metadata can explain old summary source, new event source, and
  projection exclusion counts.
- Tests cover `listAgentLifeEventsForPrompt()` or its wrapper for active-session
  visibility, global visibility, `operator_only` exclusion, and prompt-safe
  payload projection.

### Task 17 - Continuous runtime contract, energy, and capability costs

**Status:** implemented and verified except Xiaoni-initiated cost mutation audit.

**Source:** 2026-06-04 `$office-hours` production-backend review of the next
Xiaoni prompt/runtime contract.

**Design docs:** `docs/P0A_XIAONI_HOMEOSTASIS_LOOP.md`,
`docs/P0A_DIGITAL_LIFE_PRESENCE_CONTEXT.md`,
`docs/AGENTS_AGENT_LOOP_RUNTIME.md`, `docs/XIAONI_SPEAKING_FLOW.md`.

**Execution summary:**

- Treat Xiaoni as a continuous event loop. A `run` is only an internal
  trace/delivery/retry/observability unit, not a cognition or product boundary.
- Switch prompt-facing inner-state output to `<xiaoni_os>`; do not migrate old
  `<小腻的OS>` history.
- Make `<STATE>` event-triggered, not per turn. Inject it on the engineering
  cross-run action/tool count threshold, after hosted `web_search`, on low-energy
  reminder, after forced sleep wake, and after repeated-@ wake from rest.
- Keep raw energy numeric and allow it to go negative internally. Negative energy
  is shown as debt, but recovery math starts from 0. Full recovery takes at most
  2h; if raw energy drops below 0, engineering waits 2h and wakes Xiaoni with a
  `<STATE>` explaining she was too tired and slept through it.
- Add one prompt-facing rest tool, `recover_energy`, replacing prompt-facing
  `rest_period` / `sleep_period`.
- While resting, Xiaoni does not read message bodies. Engineering only counts
  direct mentions and wakes her when continuous direct `@` count is `>= 3`,
  computing recovered energy from actual rest time.
- Add a compact-after / capability-refresh developer `<CAPABILITIES>` block that
  lists available tools, supported skills, and tool/skill energy costs. Every
  skill must declare `## Runtime Cost` with `energy_cost`; missing-cost skills
  are omitted from the block and produce an operator warning. Xiaoni may update
  costs, but each change must be audited with old value, new value, reason, and
  trace/run id.

Locked initial costs:

```text
submit_life_action: 0.005
speak_in_group: 0.015
reply_in_private: 0.015
web_search: 0.080
inspect_image_placeholder: 0.040
request_image_task: 0.030
exec_command: 0.030
recover_energy: 0.000
skill-creator: 0.120
```

**Acceptance checklist status:**

- Satisfied: a replay can show two adjacent engineering runs sharing one
  continuous Xiaoni state, with no prompt wording that treats `run` as a
  cognition boundary.
- Satisfied: prompt assembly emits `<xiaoni_os>` for new inner-state records and
  still tolerates old `<小腻的OS>` history without a migration.
- Satisfied: tests cover each `<STATE>` injection trigger: action/tool threshold,
  `web_search`, low-energy reminder, forced sleep wake, and repeated-@ wake.
- Satisfied: energy tests cover positive recovery,
  negative-energy recovery-as-zero, 2h full recovery, and raw-energy `< 0`
  forced 2h wait.
- Satisfied: tool schema and runtime dispatch expose `recover_energy`;
  prompt-facing `rest_period` / `sleep_period` are not advertised as tools.
- Satisfied: resting replay proves unread message bodies are not passed into
  prompt context before wake, while continuous direct `@ >= 3` wakes Xiaoni with
  the correct recovered energy state.
- Satisfied: compact/capability-refresh replay shows `<CAPABILITIES>` includes
  tool costs, supported skill list, skill costs, and omits missing-cost skills
  with an operator warning.
- Remaining: skill cost mutation is audited and takes effect only after the next
  capability refresh.

**Supervisor verification (2026-06-04):**

- Implemented and verified: continuous energy state, `<xiaoni_os>`,
  event-triggered `<STATE>`, negative-energy forced sleep, repeated-@ rest wake,
  `recover_energy`, capability block, tool costs, skill costs, and missing-cost
  operator warnings.
- Still open: a real runtime path for Xiaoni-initiated cost mutation with
  persisted audit of old value, new value, reason, and trace/run id.

### Task 18 - QQ usage skill and progressive IM disclosure

**Status:** implemented and verified.

**Source:** 2026-06-04 `$office-hours` production-backend review of Xiaoni's QQ
attention model.

**Design docs:** `docs/XIAONI_SPEAKING_FLOW.md`,
`docs/AGENTS_AGENT_LOOP_RUNTIME.md`, `docs/AGENTS_OPENAI_REQUESTS.md`.

**Execution summary:**

- Implement a system-owned `qq-usage` skill in the same skill root/category as
  `skill-creator`. It is not exposed as OpenAI function tools; Xiaoni reads the
  skill manual and uses `exec_command` to run its local script.
- Author `qq-usage/SKILL.md` using the standard skill `SKILL.md` format. The
  skill doc is an app manual for operating QQ; do not put QQ app instructions in
  the main prompt.
- The app manual describes QQ operations only: unread badges, opening the inbox
  list, focusing a thread, scrolling, jumping to latest, and putting QQ away.
- Keep `speak_in_group` and `reply_in_private` as existing runtime send tools for
  now. `qq_usage` only controls seeing/navigating QQ, not sending QQ messages.
- `qq_usage` must be simple for Xiaoni to use. Its Python functions delegate to
  existing agent-service/provider-service internal interfaces; Xiaoni does not
  need to understand persistence, unread cursor math, window state, SQL, or
  backend routing details.
- Forced ambient injection stays minimal:
  `<UNREAD_AVAILABLE unread_count="N" direct_mentions="M" />`. No thread list,
  message body, preview, keywords, or engineering classification appears at this
  layer.
- `open_inbox` returns one `<IM_INBOX_WINDOW mode="thread_list">`.
  Each `<THREAD>` may include `thread_key`, `chat_type`, `display_name`,
  `unread_count`, `direct_mentions`, `latest_sender="昵称(IM)"`, and a raw
  `latest_preview` truncated to 20 visible characters. It must not use LLM
  summaries, inferred topics, or "should open" hints.
- `open_inbox` returns the latest 10 threads. `scroll_inbox direction` pages
  10 threads at a time and reports list navigation fields such as
  `has_older_threads` and `has_newer_threads`.
- `focus_thread thread_key` returns one
  `<IM_INBOX_WINDOW mode="conversation">` block. Multiple messages are rendered
  as child `<MESSAGE>` rows inside that block, not as multiple top-level
  `<INPUT_MESSAGE>` blocks.
- Conversation `<MESSAGE>` rows carry the minimal stable fields
  `message_id`, `timestamp`, `sender`, `direction`, `read_state`, and
  `mentions_xiaoni`; `reply_to` is optional. Media is represented inline in the
  body, e.g. `[图片:pic_hash]`, rather than as a separate top-level block.
- Opening a thread defaults to the latest visible screen. The window size is 10
  messages. If there are more than 10 unread messages, show the latest 10 and
  report earlier unread count with `unread_before_window`. If unread is fewer
  than 10, the window may include read history as context.
- `scroll_thread thread_key older|newer` loads 10
  messages per call. It may continue into read history and may keep scrolling
  older read messages. Once the window reaches read history, unread counts for
  older unseen material are `0`, but `has_older_messages` still controls whether
  Xiaoni can keep scrolling.
- `jump_to_latest thread_key` returns the latest visible screen for the
  specified thread.
- `put_qq_away thread_key?` closes QQ. With `thread_key`, it represents
  leaving that conversation and clears that conversation's unread badge. Without
  `thread_key`, it only closes the thread list and does not clear any thread
  badge.
- The `qq_usage` app manual must use app-manual language only. Do not tell
  Xiaoni she is "using QQ like a human"; describe the QQ operations and rules.
- Switching conversations or `put_qq_away thread_key` clears the current
  thread's unread badge, including older unread messages that were never
  displayed. The manual must state that clearing the badge does not mean those
  unseen messages were read; if Xiaoni wants to continue later, she must record
  that intention in `<xiaoni_os>`.
- Skill results are append-only context observations. Every successful call
  appends the returned QQ window or action result to model context. Earlier
  windows remain as past visual records; the skill does not replace old context.
- When new messages arrive for a thread that already has an appended conversation
  window, the runtime must not append new `<MESSAGE>` bodies automatically. The
  next relevant `qq_usage` result may expose `newer_available="N"`; message
  bodies appear only after Xiaoni calls `scroll_thread thread_key newer` or
  `jump_to_latest thread_key`.
- Failed skill calls append a truthful `<QQ_USAGE_ERROR>` with action, arguments,
  and real error reason. Failure returns no new message content and consumes no
  energy cost.
- `latest_preview` uses the raw latest visible text truncated to 20 visible
  characters. Non-text latest content uses placeholders such as `[图片]`, `[表情]`,
  or `[文件]`.
- Conversation windows expose navigation state with fields such as
  `cursor_anchor`, `window_size`, `unread_before_window`,
  `unread_after_window`, `reached_read_history`, `has_older_messages`, and
  `has_newer_messages`.
- Skill cost:

  ```text
  qq-usage: 0.004
  ```

- `qq-usage` is system-owned and must be listed in `<CAPABILITIES>` as a skill.
  Its script calls the engineering API; missing skill cost is an operator/build
  error.

**Acceptance checklist:**

- Prompt assembly with only ambient unread state contains only
  `<UNREAD_AVAILABLE unread_count="..." direct_mentions="..." />`.
- `open_inbox` returns a thread list with latest sender and a raw
  20-character preview, paged 10 threads at a time, and no full message bodies
  or LLM summaries.
- `focus_thread` returns exactly one conversation
  `<IM_INBOX_WINDOW>` containing ordered child `<MESSAGE>` rows.
- A thread with more than 10 unread messages opens on the latest 10 and reports
  earlier unread count without materializing all unread bodies.
- A thread with fewer than 10 unread messages may include read context and marks
  `reached_read_history=true`.
- `scroll_thread thread_key older` loads 10 older messages, can cross into
  read history, and can continue through older read history while
  `has_older_messages=true`.

- `jump_to_latest thread_key` returns the latest 10-message screen for that
  thread.
- New messages for an already viewed thread produce only `newer_available` until
  Xiaoni explicitly scrolls newer or jumps to latest; no message bodies are
  auto-appended.
- `put_qq_away thread_key` clears that thread's unread badge; `put_qq_away`
  from the thread list clears no thread badges.
- Failed skill calls return `<QQ_USAGE_ERROR>` with the real error reason, append
  no new QQ message content, and consume no energy cost.
- Message media and thread-list non-text previews use the locked placeholder
  format: `[图片:pic_hash]` in message bodies, `[图片]` / `[表情]` / `[文件]` in
  previews.
- Existing `speak_in_group` / `reply_in_private` send behavior is unchanged.
- `<CAPABILITIES>` includes `qq-usage` as a system-owned skill and does not
  expose QQ navigation as OpenAI function tools.
- Skill implementation delegates to existing internal service APIs and does not
  add direct SQL or hidden cursor logic in the skill layer.

### Task 19 - Xiaoni next prompt and `compress_core_memory`

**Status:** implemented and verified on 2026-06-05.

**Source:** 2026-06-04 prompt cleanup after `$office-hours` production-backend
review.

**Design docs:** `docs/XIAONI_MAIN_PROMPT_NEXT.md`,
`docs/AGENTS_AGENT_LOOP_RUNTIME.md`, `docs/AGENTS_OPENAI_REQUESTS.md`.

**Current implementation 2026-06-05:**

- The runtime Xiaoni main prompt mirrors `docs/XIAONI_MAIN_PROMPT_NEXT.md`.
- `<CAPABILITIES>` is injected once near the beginning of every main-loop input,
  before `<小腻近况>` and current turn material. It lists supported prompt-facing
  tools, supported skills, and energy costs, including
  `compress_core_memory: 0.020`.
- `<STATE>` remains event-triggered and energy-focused; it is not a per-turn
  pressure/dopamine/emotion-number block.
- `compress_core_memory(text)` is a prompt-facing function tool, but it is not
  exposed during ordinary turns. Engineering injects a
  `<system_reminder source="core_memory_pressure"
  required_tool="compress_core_memory">` when count or token pressure requires
  compression; that request's `tool_choice.allowed_tools` is restricted to
  `compress_core_memory`.
- Pressure requests keep the full actor tool definitions in `tools` and narrow
  only `tool_choice.allowed_tools`; do not replace the request `tools` array
  with only `compress_core_memory`, because that churns the tool-definition
  prefix.
- A successful `compress_core_memory` call writes the exact tool `text` to
  `agent_session_context_windows.context_summary` for future `<小腻近况>`, then
  persists the read cutoff. Timeline / raw-response metadata records the tool
  name, context key, read cutoff, source response id, tool call id, and text
  length.
- The main prompt-facing `<小腻近况>` path no longer schedules or contains the
  old `context_summary_writer` code path. The active post-eviction writer is the
  separate episodic / semantic / reflection compression memory writer.
- `speak_in_group` and `reply_in_private` accept explicit `group_id` / `user_id`
  targets. Provider internal send contracts now honor those target ids instead
  of silently dropping overrides.

**Execution summary:**

- Replace the current Xiaoni main agent prompt with the prompt body in
  `docs/XIAONI_MAIN_PROMPT_NEXT.md`, preserving only implementation-required
  runtime glue outside the prompt body.
- Remove prompt-facing pressure, dopamine, and generic emotion-number state.
  `<STATE>` is energy-only plus fatigue/rest/wake explanations.
- Use `<xiaoni_os>` for new inner-state records. Old `<小腻的OS>` remains
  readable only as historical compatibility.
- Add `<CAPABILITIES>` to prompt assembly once near the beginning of the request,
  listing supported tools, supported skills, and every declared energy cost.
- Keep QQ usage out of the main prompt except the pointer to `qq-usage`; QQ app
  operation details belong in the `qq-usage` skill manual from Task 18.
- Add the prompt-facing tool `compress_core_memory`:

  ```json
  {
    "name": "compress_core_memory",
    "description": "【紧急生存工具】仅当 system_reminder 提示脑容量达到极限或必须压缩时强制调用。用于打包并留下你认为值得带往未来的记忆，防止意识彻底重启。",
    "parameters": {
      "type": "object",
      "properties": {
        "text": {
          "type": "string",
          "description": "小腻的私人记忆胶囊。存什么、存多少、以什么视角存，完全由小腻当下的主观意识和偏好决定。"
        }
      },
      "required": ["text"]
    }
  }
  ```

- `compress_core_memory` replaces the current async `context_summary_writer`
  product path for `<小腻近况>`. The tool's `text` is Xiaoni's subjective memory
  capsule, not an external objective digest of the full transcript.
- When context pressure reaches the hard threshold, inject a `<system_reminder>`
  that tells Xiaoni brain capacity is at the limit and restrict the next required
  action to `compress_core_memory` before social or routine actions continue.
- Persist the tool text into the same prompt-facing continuity surface currently
  rendered as `<小腻近况>` while keeping trace metadata that it came from
  `compress_core_memory`, not the old summary writer.
- Disable or remove `scheduleContextSummaryWriter` / `runContextSummaryWriter`
  once the tool path is active for main-agent context compression. Episodic,
  semantic, and reflection memory writers are separate and should not be removed
  by this task unless a later design says so.
- Add `compress_core_memory` to `<CAPABILITIES>` with an explicit energy cost
  before enabling the prompt. Proposed initial cost: `0.020`.

**Tool changes implemented:**

- New tool: `compress_core_memory(text: string)`.
- Existing replacement target: `context_summary_writer` should no longer be the
  source of main-agent `<小腻近况>` after this task lands.
- Existing capability contract update: include `compress_core_memory` and its
  cost in `<CAPABILITIES>`.
- Existing state contract update: `<STATE>` remains energy-only; fatigue prompts
  and forced-sleep wake messages are state text, not pressure/emotion metrics.

- [x] Prompt assembly can render the exact prompt body from
  `docs/XIAONI_MAIN_PROMPT_NEXT.md` with no prompt-facing pressure/dopamine
  state.
- [x] A compression-threshold replay injects the survival `<system_reminder>` and
  requires `compress_core_memory` before any QQ send, QQ usage, web search,
  life action, or normal silence action.
- [x] A successful `compress_core_memory` call writes the tool `text` to the
  prompt-facing `<小腻近况>` continuity surface and stores trace metadata with
  tool name, session/context key, and source response id.
- [x] Tests replace the current expectation that the context summary writer stores a
  plain-text digest from whole in-context with an expectation that Xiaoni calls
  `compress_core_memory` and the tool text becomes future `<小腻近况>`.
- [x] Existing episodic / semantic / reflection memory tests continue to pass.
- [x] Regression coverage verifies that changing only `tool_choice` leaves the
  rest of the canonical request (`instructions`, `input`, `tools`, and cache
  fields) unchanged, and provider serialization keeps the full tool list when
  emitting structured `allowed_tools`.

Validation:

- `npm --prefix modules/agent-service run build` — passed.
- `npm --prefix modules/agent-service test` — 179 passing.
- `npm --prefix modules/provider-service test` — 105 passing.

### Task 20 - Remove fixed `life_loop` and restore gated presence only

**Status:** active follow-up; fixed `life_loop` removal is implemented on
2026-06-05, gated evaluator remains TODO.

**Problem:** the removed implementation treated a clock tick as an action
opportunity: `agent-service` slept for 300000ms and enqueued
`source='life_loop'`. That bypassed the current architecture rule that proactive
opportunities must be gated by current state, budget, cooldown, rest, and unread
IM cursors.

**Current implementation 2026-06-05:**

- `agent-service` no longer starts `runAutonomousLifeLoop`.
- `AGENT_AUTONOMOUS_LOOP_INTERVAL_MS`, `autonomousLife`, and prompt/runtime
  `life_loop` handling are removed.
- Activity feed no longer exposes `latestLifeLoopAt` / `latestLifeLoopStatus`.
- Pending live DB `life_loop` queue rows must be deleted during deployment cleanup
  before restarting `agent-service`.

**Remaining TODO:**

- Implement a gated `presence_tick` evaluator that only enqueues after checking
  energy/rest state, daily budget, cooldown, and unread IM cursors.
- If the evaluator skips, record `presence_tick_evaluated` with a concrete skip
  reason instead of calling the main model.
- If the evaluator enqueues, use `source='presence_tick'` and
  `session_key='presence_tick:xiaoni'`; do not reintroduce `life_loop`.

## P0-C - Runtime Data Readiness And Cleanup

**Status:** todo.

**Source:** `$office-hours` data readiness audit,
`~/.gstack/projects/qq_bot/liahua-refactor-runtime-gateway-design-20260527-101118.md`.

**Problem:** the current runtime data is mostly structurally linked, but the audit
found real gaps in live input policy, presence state, prompt binding, compaction
data, legacy/test classification, and schema ownership. These should be handled as
an explicit readiness pass instead of being left as operator folklore.

**Action:**

1. Clean up stale presence target configuration.
   - Current runtime no longer reads `PRESENCE_TICK_TARGET_GROUP_ID`; presence tick
     is life-level and selects unread inbox conversations at runtime.
   - Remove stale local/deploy env entries so operators do not infer that a single
     proactive target group still exists.
   - If per-chat proactive policy is reintroduced later, encode it as an explicit
     data flag such as `proactive_enabled`, not as a single process-wide target.

2. Add a dry-run cleanup/classification report before mutating data.
   - Report the stuck 2026-04-12 `processing` queue/run/batch and mark it
     failed/stale only after explicit approval; do not replay automatically.
   - Classify failed provider/auth/network incident rows so current operational
     views do not treat historical Codex 502 / 429 / auth / network failures as
     current product state.
   - Mark empty legacy tables as legacy in docs first, then drop only after
     confirming no live code path references them.
   - Classify disabled/test chat settings (`QA fresh ignore`, offset tests,
     smoke users, numeric test users) so admin views separate test/legacy targets
     from real runtime targets.

3. Fix prompt binding completeness.
   - Add `agent_prompt_id` for the two enabled auto-reply private chats missing a
     prompt binding, or disable auto-reply for those chats.
   - Keep group prompt binding behavior unchanged unless the audit is re-run and
     finds a group-side gap.

4. Backfill presence foundation data with source honesty.
   - Add sleep/awake anchors, energy/fatigue history, short-term heat / durable
     interest candidates, and real or explicitly mocked digital action logs.
   - Ensure context residue and any historical share-pool rows carry source
     wording and boundary labels, especially `mock_only` / constructed wording
     vs `real_web_search`.
   - Do not let QQ-visible wording imply real browsing when the underlying item is
     seed/mock/constructed material.

5. Close the summary/compaction half-state.
   - Current cutoff markers exist without `chat_transcript_snapshots`.
   - Either start writing ready transcript snapshots and prove prompt consumption,
     or explicitly remove that dependency from the runtime contract.
   - Coordinate with P1, which owns the production compaction loop.

6. Move runtime schema ownership into persistence.
   - Runtime-created tables/columns must be represented in
     `packages/persistence/prisma/schema.prisma` and migrations.
   - Runtime `CREATE TABLE IF NOT EXISTS` should not remain the long-term schema
     mechanism.
   - Add a schema drift check or audit command so Prisma schema, runtime DDL, and
     live DB differences are visible.

**Acceptance criteria:**

- `253631878` has an explicit presence-vs-auto-reply policy recorded in data and
  docs.
- Dry-run cleanup output lists stale processing, failed incident, empty legacy,
  and disabled/test rows without deleting anything by default.
- Zero enabled auto-reply chats are missing a valid `agent_prompt_id`, unless
  fallback behavior is explicitly documented and tested.
- Presence data has explicit anchors/action-log/context-residue source labels and
  does not blur mock material into real-source language.
- Current runtime/admin views separate current, legacy, test, seed/mock, and
  incident data.
- Schema drift between Prisma, runtime DDL, and live DB is either eliminated or
  documented with an owner and follow-up.

## P0-B - Identity Lineage Phase 1

**Status:** in progress, split by dependency.

Can proceed now:

- identity root and genesis snapshot/hash;
- canonical anchor `identity_key = qq:1129974489` with mutable
  `display_name = 小腻`;
- compatibility bridge from current `xiaoni` rows;
- legacy migration bridge checks;
- continuity fixtures that do not encode group-speech policy;
- provenance trace contract.

Blocked until P0-A first causality closure:

- final runtime projection policy;
- final hybrid judge rule for behavior-style feedback memories;
- whether structural-summary social lessons can become active identity facts;
- final boundary between identity facts and group-behavior policy.

## P1 - Transcript Snapshot Compaction

**Status:** partially implemented; independent infrastructure follow-up.

**Remaining work:** enable the production loop that turns pending snapshot jobs
into ready summaries and confirms prompt consumption of ready summaries.

## P2 - Provider-service OneBot Segment Handling

**Status:** partially implemented.

`json` / `xml` / `share` card and link support is done for direct messages and
expanded forwarded-message contents. Nested forwarded messages are still rendered
as a placeholder (`[嵌套转发]`) rather than recursively expanded, and any remaining
OneBot segment types still need explicit handling or explicit unsupported-state
logging.

## Historical Evidence

Historical ledgers, exact prompt text, earlier replay notes, and long Task 5
pre-cleanup notes are archived at:

- `docs/archive/TODOS-2026-05-26-before-document-release.md`

Do not use archived status labels such as "implemented" or "Docker healthy" as
current truth without live verification.

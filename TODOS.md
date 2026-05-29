# TODOs

This file is the active project queue only. It is not a history log, design doc,
or evidence ledger. Keep detailed rationale in `docs/` and link it from here.

Archived pre-cleanup snapshot:
`docs/archive/TODOS-2026-05-26-before-document-release.md`

## Current Read

Authoritative execution order:

1. **P0-A: user-visible Xiaoni group-chat behavior.**
   Tasks 1-7 are implemented. Tasks 8-12 are active follow-ups for current
   runtime context quality, compact memory quality, image task routing,
   presence-context v2, and Xiaoni's creative agency. Keep verification notes
   here and move any next follow-up into a new task instead of reopening the old
   queue.
2. **P0-B: Identity Lineage Phase 1.**
   Substrate work can proceed, but runtime-facing policy waits for P0-A's first
   causality closure.
3. **P0-C: runtime data readiness and cleanup.**
   Data audit found real input/config/schema gaps; resolve before treating live
   proactive/runtime data as clean current truth.
4. **P1: transcript snapshot compaction production loop.**
   Independent infrastructure follow-up.
5. **P2: remaining provider-service non-text OneBot segment handling.**
   `json` card support is done; nested forwards and other segment types still
   need explicit handling.

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

**Status:** implemented first engineering slice on 2026-05-26.

**Design doc:** `docs/P0A_DIGITAL_LIFE_PRESENCE_CONTEXT.md`

**Design summary:** Xiaoni's `presence_context` must be a projection of a
browser/digital-life action loop, not a standalone fake mood paragraph. First
engineering slice should use mock digital-life actions and sidecar traces before
connecting real browser side effects.

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
- Share-pool recall uses time-decay scoring and only passes top material into
  current-state context.
- Mock digital-life generation is state-triggered, not blind timer-based.
- Generated actions must be linked records so recent action traces can be
  compressed into in-context state.
- `小腻当前状态` has six private sections: recent action trace, current residue,
  current state, available material, action cost, and source boundary.
- Prompt/developer/tool-description/in-context state have separate roles and one
  engineering source of truth for numeric meters.

The full design is in `docs/P0A_DIGITAL_LIFE_PRESENCE_CONTEXT.md`.

**Implementation completed (2026-05-26):**
- Added Prisma models for `AgentQueueMessage`, `AgentSessionLifeState`,
  `AgentSessionGroupState`, `AgentSharePoolItem`, `AgentShareItemUsage`, and
  `AgentPresenceStateSidecar`; regenerated `packages/persistence` Prisma Client.
- Added shared persistence enqueue helper and moved provider-service
  `enqueueSemanticMessage` onto it.
- Added agent-service presence tick timer, config keys, target-group payload
  materialization, anchor updates, sidecar tracing, and factual
  `<小腻当前状态>` context injection before the normal reasoning tools run.
- Retired the old `[待分享]` prompt injection / pending-share aging write path.
- Removed the old raw-SQL `agent_session_state` persistence export and stopped
  creating/writing that table from agent-service; compatibility emotional-state
  reads now derive from `AgentSessionLifeState` anchors.
- Added focused tests for presence state derivation, share-pool scoring,
  factual context block shape, legacy pending-share retirement, and
  `presence_tick:xiaoni` target session replacement.
- Verified with `npm --prefix packages/persistence run generate`,
  `npm --prefix modules/agent-service test` (113 passing), and
  `npm --prefix modules/provider-service test` (102 passing).

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
  source_kind      String   // constructed / group_residue / real_browse / mock
  boundary_label   String   @default("safe")   // safe / reframe / blocked
  source_wording   String   // allowed / mock_only
  effort_cost      Int                          // 1=low, 4=medium, 8=high
  base_heat        Float    @default(1.0)
  created_at       DateTime @default(now())
  metadata         Json     @default("{}")
  ```
  No `consumed_at` — reuse across groups is tracked via `AgentShareItemUsage`.
  No `target_group_id` — this version uses a config-supplied fixed group (see timer section).

- `AgentShareItemUsage` — per-group usage record for share pool items (locked 2026-05-26
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
  source_items         Json     // array of item ids + share pool items used
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

**Proactive share state — retire old system (Codex finding):**
`upsertProactiveShareState` at `runtime-store.ts:2236` already stores one pending
share string per session with aging/incrementing logic (see `agent-loop-service.ts:2979`).
`AgentSharePoolItem` is a richer inventory table. These are two competing proactive
share state machines. When implementing `AgentSharePoolItem`, explicitly retire the
`pendingProactiveShare` / `pendingProactiveShareAge` fields: stop writing them,
stop reading them, remove the aging logic. Do not let both run simultaneously.

**Proactive trigger — presence_tick timer:**
- Add `presenceTickTimer` to `modules/agent-service/src/index.ts` following the
  exact same `stopping` flag + `clearTimeout` pattern used by `workerTimer` and
  `taskWorkerTimer` (lines 58-68, 90-100). No new stopping mechanism needed.
- Queue write path (Codex finding): agent-service currently has no enqueue path.
  Only provider-service has `enqueueSemanticMessage`. For `presence_tick`, add a
  shared enqueue function to `packages/persistence` (not raw SQL in agent-service,
  not importing provider-service). Must generate unique `message_sid` and
  `dedupe_key` per tick window — `dedupe_key` is globally unique in the schema
  (`runtime-store.ts:3442`).
- Thresholds: boredom >= 65, fatigue < 60, energy >= 35, sharePool has available
  item, 45 min cooldown since last proactive, 2/session, 12/day global. Soft
  signals fed into in-context state — model infers whether to post.

**Type discriminator and target group selection (locked 2026-05-26 second-pass):**
`claimNextQueueMessage` batches every pending row for the same `session_key` and
immediately uses `peer_id`, `chat_type`, `account_id` from the latest row to create
run/batch records (`runtime-store.ts:1504, 1524`). Target must therefore be resolved
**before enqueue**, not after claim.

Timer flow:
1. Check thresholds (boredom, fatigue, cooldown via `last_presence_tick_enqueued_at`).
   If any fail, skip — do not enqueue.
2. Query share pool for highest-scored available item.
   If none, skip — do not enqueue.
3. Read target group from config (`PRESENCE_TICK_TARGET_GROUP_ID` env var or equivalent).
4. Write `last_presence_tick_enqueued_at = now()` to `AgentSessionLifeState`.
5. Enqueue a queue message with `session_key = 'presence_tick:xiaoni'`, and embed
   `target_session_key`, `target_group_id`, `peer_id`, `account_id` in the payload.
6. Agent loop detects `session_key.startsWith('presence_tick:')` and reads target
   from payload — does NOT re-select group at runtime.

**Crash window (known risk, accepted this version — locked 2A):** If the process
crashes between step 4 (anchor write) and step 5 (enqueue), the anchor is written
but no tick was queued; next tick is suppressed for 45 minutes. If the process
crashes after claim but before run completion, the queue row stays `processing`
forever (orphaned run). Both are accepted as low-probability in this version and
will be addressed in a future hardening pass.

**This version only:** target group is a single config-supplied group ID. Future
version: Xiaoni evaluates active groups and selects based on per-group state
(`last_user_message_at`, trust, recent atmosphere). That is a separate feature.

**presence_tick session replacement in agent loop (locked 2026-05-26 second-pass):**
`payload.sessionKey = 'presence_tick:xiaoni'` must NOT flow into downstream runtime
paths (conversation creation, transcript writes, prompt cache key at `runtime-store.ts:1242`).

`processQueueMessage` detects `payload.sessionKey.startsWith('presence_tick:')` at
entry and immediately replaces:
```ts
payload.sessionKey     = payload.targetSessionKey   // e.g. 'qq:group:12345'
payload.peerId         = payload.targetPeerId
payload.chatType       = 'group'
payload.accountId      = payload.targetAccountId
```
All subsequent paths (conversation, transcript, cache key, context state) then use
the resolved target session naturally. This is a session-replacement approach — the
presence_tick:* code path is NOT a separate processPresenceTick function; it reuses
the existing processQueueMessage flow after the early substitution.

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
  too low, fatigue too high, cooldown active, share pool empty).
- Share-pool decay: unit test that `scoreSharePoolItem(item, now)` returns a lower
  score as `now - item.createdAt` increases (monotone decay).
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
- `<小腻的OS>` is currently mixed into user scene input, but is Xiaoni's internal
  continuity and should be assistant-side context.
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
    <小腻的OS timestamp="...">
    ...
    </小腻的OS>
```

**Tag contract to explain in `SYSTEM_PROMPT`:**

- `<INPUT_MESSAGE>`: real inbound QQ message. Must include timestamp,
  `message_id`, and sender as `<昵称>(Id)`.
- `<OUTPUT_MESSAGE>`: real outbound Xiaoni message. Must include timestamp and
  delivery `message_id` when available.
- `<ACTION>`: Xiaoni's own action/state event, such as opening a group, lurking,
  looking for a topic, inspecting an image, or deciding to wait.
- `<小腻的OS>`: Xiaoni's internal continuity for future turns; assistant-side,
  not a user message.
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
      "text": "<system_reminder>我上一次水群是在 <last_message_id> 之前；这次只需要处理之后出现的新消息。</system_reminder>"
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
- Final tools include actual QQ output or run-ending decisions:
  `speak_in_group`, `reply_in_private`, `stay_silent`, and possibly
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

**Status:** todo.

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

**Status:** todo.

**Source:** 2026-05-27 live compact probe for group `253631878`:
`tmp/compact-memory-253631878-20260527T100734Z.md`.

**Problem:** the previous `context_compression_memory_writer` could run through
the real provider and write `agent_feedback_reflections`, but the generated
reflection quality was not acceptable. In the probe, real evicted turns
`4352-4418` produced reflection `324`, which generalized the batch into
"未被点到时旁观更合适". That conclusion appears too shallow / possibly wrong
for the actual context and may reinforce silence from weak evidence.

**Related problem:** the current `[身份连续性]` / identity continuity projection is
also not right. It is semantically unclear in the request shape and risks mixing
durable identity, group-behavior policy, and compacted social lessons into one
surface. Do not treat the current identity-continuity rendering or promotion
policy as settled.

**Action:**

- Review the compact writer prompt and tool contract so it distinguishes:
  durable feedback, social lessons, ordinary topic summaries, and "no learning"
  cases.
- Add a quality gate that allows the writer to emit no reflection when evidence
  is weak; avoid turning ordinary silent/passing context into active recall rows.
- Re-run the `253631878` compact probe with labeled expected outcomes and compare
  whether the generated reflection matches the actual batch.
- Review identity continuity projection separately from group behavior memory:
  define what belongs in accepted identity facts, what remains a tentative
  reflection, and what should only be context summary.
- Update the request shape so identity continuity is placed and labeled clearly,
  not as another vague scene block.

**Acceptance criteria:**

- Compact memory generation can produce `no_tool_call` / no persisted reflection
  for low-evidence batches.
- A regression test or replay fixture covers the `253631878` probe range and
  prevents the current over-broad "旁观更合适" style conclusion from passing as a
  durable lesson without stronger evidence.
- Identity continuity has an explicit projection contract and tests showing it
  does not absorb tentative group-behavior lessons as durable identity facts.
- The runtime request clearly separates identity facts, compact summaries,
  feedback reflections, and group-specific behavior policy.

### Task 10 - Image task tool routing bug

**Status:** todo.

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

### Task 11 - Presence context v2 action trace and energy model

**Status:** todo.

**Source:** 2026-05-27 runtime context review against
`docs/P0A_DIGITAL_LIFE_PRESENCE_CONTEXT.md`.

**Problem:** the design already defines `小腻当前状态` as a six-section private
context block with recent action trace, current residue, current state,
available material, action cost, and source boundary. It also defines the
energy/fatigue/reward model: action budget, sleep pressure, fatigue,
reward-sensitivity / dopamine-like attraction, pressure, boredom, sharing
desire, and effort cost.

The current implementation is only a first slice. `presence-context.ts` derives
`boredom`, `fatigue`, `energy`, and `sharingDesire`, then injects raw decimals
and a hard-coded `recent_action_trace` such as "本轮由 presence_tick 触发" or
"本轮由群友消息触发". That means Xiaoni's real recent action experience is not
yet present in the runtime context. The model cannot see whether she had been
idling in QQ, watching the group, leaving and returning, doing a mock/real
digital action, carrying group residue, or deciding that a topic is still alive.

The older "dopamine / stress" surface is also only a compatibility mapping:
`sharingDesire -> dopamine` and `fatigue -> stress`. It does not yet expose the
designed action budget / fatigue load / reward attraction / effort-cost model in
a human-readable way.

**Action:**

- Implement a presence-context v2 projection that follows the design doc's
  six-section `小腻当前状态` shape instead of the current thin key/value block.
- Add a real recent-action trace source. It should be built from stored
  presence/digital-action records, ongoing QQ presence state, share-pool source
  items, same-day group residue, and explicit mock/constructed records. Do not
  invent offline or unsupported external experiences.
- Replace raw decimals in prompt context with readable scaled state, for example
  `当前行动预算：5 / 10`, `疲惫负荷：6 / 10`, `压力负荷：2 / 10`,
  `无聊：7 / 10`, `找刺激/新鲜感：6 / 10`, `分享欲：5 / 10`.
- Keep the engineering source of truth numeric. Derive readable prompt labels
  from persisted anchors and action history, not from hand-authored mood text.
- Model reward as `reward_sensitivity` / novelty and pickup attraction, not as a
  literal biochemical dopamine gauge. Keep compatibility `dopamine` naming only
  at legacy boundaries if still required.
- Add action-cost wording that tells the model which actions currently feel
  light, medium, or expensive, without adding a "recommended action" command.
- Preserve source honesty. Mock/constructed material can become Xiaoni's own
  thought or topic, but cannot be phrased as "刚看到 / 刚刷到 / 我查到" unless
  there is real browser evidence.
- Expand `agent_presence_state_sidecars` or its `compression_mapping` so a
  generated block can be audited back to action records, share-pool items,
  energy snapshot, group residue, and source-boundary decisions.

**Likely implementation areas:**

- `modules/agent-service/src/services/presence-context.ts`
  - `deriveLifeState`
  - `buildPresenceContextBlock`
  - scaled state/action-budget rendering
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

- Runtime `<小腻当前状态>` contains six readable sections matching the design doc:
  recent action trace, current residue, current state, available material,
  action cost, and source boundary.
- `最近行动轨迹` is no longer just "presence_tick triggered" / "群友消息触发";
  it is derived from traceable records or explicitly says there is no concrete
  recent action material.
- Current-state rendering exposes action budget, fatigue/pressure load, boredom,
  novelty/reward attraction, and sharing desire on a readable scale.
- No prompt surface claims real browsing, watching, reading, liking, posting, or
  downloading unless a real digital-action record supports it.
- Sidecar traces show which records and scores produced each block section.
- Tests cover the no-material case, mock-material source-honesty case, and a
  multi-step recent-action trace case.

### Task 12 - Xiaoni creative agency and latent capability activation

**Status:** todo.

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

## P0-C - Runtime Data Readiness And Cleanup

**Status:** todo.

**Source:** `$office-hours` data readiness audit,
`~/.gstack/projects/qq_bot/liahua-refactor-runtime-gateway-design-20260527-101118.md`.

**Problem:** the current runtime data is mostly structurally linked, but the audit
found real gaps in live input policy, presence state, prompt binding, compaction
data, legacy/test classification, and schema ownership. These should be handled as
an explicit readiness pass instead of being left as operator folklore.

**Action:**

1. Decide the `253631878` participation policy.
   - Current state: `PRESENCE_TICK_TARGET_GROUP_ID=253631878`, but
     `group_chat_settings.auto_reply_enabled=0` and
     `continuous_learning_enabled=0`.
   - Decide whether proactive `presence_tick` may target this group while normal
     auto-reply is disabled.
   - If yes, encode it as an explicit data flag such as `proactive_enabled` or an
     equivalent persisted policy. If no, disable the presence target or enable
     normal auto-reply consistently.

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
   - Ensure share pool items carry source wording and boundary labels, especially
     `mock_only` vs real source language.
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
- Presence data has explicit anchors/action-log/share-pool source labels and does
  not blur mock material into real-source language.
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

`json` card support is done. Nested forwarded messages and remaining non-text
segment types still need explicit handling or explicit unsupported-state logging.

## Historical Evidence

Historical ledgers, exact prompt text, earlier replay notes, and long Task 5
pre-cleanup notes are archived at:

- `docs/archive/TODOS-2026-05-26-before-document-release.md`

Do not use archived status labels such as "implemented" or "Docker healthy" as
current truth without live verification.

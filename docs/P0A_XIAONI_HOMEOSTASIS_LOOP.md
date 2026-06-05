# Xiaoni Homeostasis Loop

Status: first reducer/projection slice implemented on 2026-05-31 after
office-hours, CEO, and eng review. This is the system of record for Xiaoni's
homeostasis reducer.

Read this together with `docs/P0A_DIGITAL_LIFE_PRESENCE_CONTEXT.md`. That older
doc remains the broader digital-life and presence-context design. This page
exists because the 2026-05-31 review changed the source-of-truth rule.

## Current Runtime Facts

- `agent-service` currently starts queue polling, task polling, and
  `presenceTickTimer`.
- There is no active standalone self-action runner in `agent-service/src/index.ts`.
  `/health` no longer exposes a `self_action_busy` compatibility field.
- `presence_tick:xiaoni` is a synthetic life-level queue event. If unread IM
  exists, the main loop can materialize it as `proactive_im_open`. If no unread
  IM exists, it stays life-only and must not send QQ directly.
- IM unread is persisted in `agent_inbound_messages`; each session uses its
  last-read message as the cursor, and opening IM materializes unread messages
  after that cursor so stale backlog is not treated as the current scene.
- Presence-originated ticks read the global conversation append stream and use
  `xiaoni:global` as the context summary / read-cutoff compatibility key, even
  when unread IM materializes the current run into `proactive_im_open`. The
  compressed `<小腻近况>` is still stored in
  `agent_session_context_windows.context_summary`; it is not yet an event-backed
  `agent_life_events` digest. Life-only `presence_tick` can currently use
  internal tools, `web_search`, `compress_core_memory`, or `recover_energy`, not
  a private planner context. If it
  produces a "想回头分享" residue, that residue is appended into `<xiaoni_os>` so
  it stays in normal context and later compression. Old `<小腻的OS>` history is
  read as legacy residue and is not migrated.
- `agent_digital_actions` is historical data only. The old write helpers are
  gone from `@qq-bot/persistence`, and prompt construction no longer reads this
  table for current state.

## Locked Next Runtime Spec

This section records the production target agreed on 2026-06-04. It is not fully
implemented yet. Current-runtime facts above remain the truth until code lands.

- Xiaoni is modeled as one continuous event loop. Engineering may still use
  `agent_runs`, queue ids, trace ids, and delivery state for observability,
  retries, and duplicate-send protection, but prompt-facing language should use
  "current action", "next action", "visible scene", and "life event" rather than
  making `run` a cognitive boundary.
- Energy is an identity-scoped raw value with `max_energy = 1.00`. Raw energy may
  go below `0`; prompt-facing `<STATE energy="...">` may show that negative
  value. Recovery math treats any negative value as `0`.
- Fatigue is derived from energy with a non-linear curve, not from a flat label.
  The lower the energy gets, the faster fatigue should feel. When energy is low,
  engineering may append a `<STATE>` reminder such as "我已经很累了，要不要休息一下";
  this is a state fact, not an action command.
- `<STATE>` is not injected on every model call. Engineering appends it only on
  state events, including: cross-run action count threshold, after hosted
  `web_search`, low-energy reminders, forced full recovery, and rest interruption
  by repeated direct mentions.
- Action costs are identity-scoped and cross run boundaries. The first locked
  costs are:

  ```text
  speak_in_group: 0.015
  reply_in_private: 0.015
  web_search: 0.080
  inspect_image_placeholder: 0.040
  request_image_task: 0.030
  exec_command: 0.030
  recover_energy: 0.000
  skill-creator: 0.120
  ```

- `recover_energy` is the single prompt-facing recovery tool. It replaces
  prompt-facing `rest_period` / `sleep_period`; those event kinds may remain as
  historical/internal compatibility rows. `duration_minutes` is clamped to
  `5..120`.
- Recovery uses a linear curve from `max(0, raw_energy)` toward `1.00`.
  `duration_minutes >= 120` restores to full energy.
- If engineering detects `raw_energy < 0`, Xiaoni is too exhausted to keep
  acting. Engineering waits 2 hours before the next action opportunity. Recovery
  math uses 120 minutes, so that opportunity starts at full energy. Append
  `<STATE>` saying she was too tired to continue before recovering, with the
  computed current energy.
- While resting, Xiaoni does not read message bodies. Engineering records unread
  metadata and counts repeated direct mentions only. Three or more consecutive
  direct mentions interrupt rest early, compute recovered energy from the actual
  rest duration, and append `<STATE>` saying she was interrupted by repeated
  mentions.
- New prompt-facing OS continuity uses `<xiaoni_os>`. The persisted DB field can
  stay `xiaoni_os`. Do not migrate old history; GPT-5.5 can understand older
  `<小腻的OS>` residue until it naturally ages out.
- After context compression or capability changes, prepend a developer
  capability block listing supported tools, supported skills, and their costs.
  Skills must declare `## Runtime Cost` with `energy_cost: <number>`; skills
  without explicit cost are not listed and should produce an operator warning.

## Locked Decisions

1. `agent_life_events` is the canonical append-only event stream for Xiaoni's
   homeostasis / presence state, QQ-visible actions, recovery actions, and
   later digital-life actions. It is not yet the canonical source for
   `<小腻近况>` or typed long-term memory recall.
2. `agent_session_life_states` and group state tables are projections/caches
   derived from that stream. They may speed scheduling, but they are not allowed
   to become the truth source.
3. Phase 1 restores no separate self-action runner. Implement the reducer and
   admin explanation path first; only then decide whether a new autonomous
   runner is justified.
4. Suggestions from group/private chat influence Xiaoni only by entering the
   normal event stream, `<xiaoni_os>`, or compact summary. Old `<小腻的OS>`
   residue remains historical input only. Do not add hardcoded suggestion fields,
   planner memory, query seeds, or interest-key tables.
5. Delete the old shortcut pattern: no hardcoded `motiveText`, no exact-query
   enforcement as personality, no Heine/reading seeds, and no fake source
   wording.

## Reducer Shape

```text
agent_life_events append stream
  -> deterministic reducer
  -> homeostasis snapshot
  -> presence/context projection
  -> main loop acts: speak / search / image task / internal residue / recover
  -> resulting action appends new events
```

The reducer computes current state from durable facts, not from a standalone
planner loop. Current runtime projection intentionally exposes only:

- current energy
- recent action cost / recovery trace
- material scarcity and current residue
- source boundaries for any shareable material

Older meters such as boredom, fatigue, sharing desire, and cooldown can exist as
legacy internal projection fields, but they are not prompt-facing decision gates.
Fatigue is used only by the scheduler to suppress proactive IM opening while
energy is too low; after a presence tick is admitted, Xiaoni receives energy plus
cost context and chooses inside the main loop.

Locked production prompt-facing tool/action costs:

```text
speak_in_group: 0.015
reply_in_private: 0.015
web_search: 0.080
inspect_image_placeholder: 0.040
request_image_task: 0.030
exec_command: 0.030
recover_energy: 0.000
skill-creator: 0.120
```

Historical reducer-v1 events such as `presence_tick_evaluated`,
`qq_message_seen`, `surface_visit`, `silence_decision`, `qq_self_message`,
`pending_share_consumed`, `rest_period`, and `sleep_period` may still exist for
admin replay and compatibility. They must be normalized into the production
cost model before being shown to the prompt. `rest_period` and `sleep_period`
are no longer prompt-facing recovery actions.

## Event Rules

Append events for facts that happened, not inferred personality:

- `surface_visit`: Xiaoni opened or used QQ/IM.
- `qq_message_seen`: a real human message entered Xiaoni's visible stream.
- `speak_in_group` / `qq_self_message`: Xiaoni actually sent text.
- `silence_decision`: historical reducer-v1 compatibility row only. Current
  prompt-facing runtime has no silence tool; no tool call is not a completed
  action.
- `terminal_action_committed` / `terminal_action_blocked`: delivery boundary.
- `presence_tick_evaluated`: a scheduler check happened, including skip or
  enqueue reason and the state snapshot used for the decision.
- `recover_energy`: prompt-facing recovery action. Negative energy is displayed
  as negative but recovery math treats it as `0`; 120 minutes restores to full
  energy.
- `rest_period` / `sleep_period`: historical/internal compatibility rest facts.
  They may remain in old rows or admin replay, but new prompt-facing policy uses
  `recover_energy`.
- future digital events: real or explicitly constructed digital actions, each
  carrying source honesty, action cost, and source evidence.
- historical retired self-action rows such as `self_action_started` /
  `self_action_completed` may exist in production data and admin activity views.
  Reconcile the bounded event-kind contract before reusing those kinds in new
  writes.

Reducer output may include scores, but scores must be traceable to the events
that produced them. If a score cannot explain which events moved it, it should
stay out of the prompt and admin UI.

## Projection Rules

`agent_session_life_states` can keep scheduling anchors such as last active time,
last user message time, last presence tick enqueue time, daily counters, and
derived cache fields. It must be rebuildable from `agent_life_events` plus
service startup state.

`<小腻当前状态>` should be a projection, not a handwritten mood paragraph. The
same reducer output should feed both:

- the private prompt block used by the main loop
- the admin "why is Xiaoni like this now" explanation

## Phase 1 Scope

The first implemented slice includes:

- read recent `agent_life_events` for identity `xiaoni`
- compute homeostasis snapshot deterministically
- render a concise six-section `小腻当前状态`
- expose enough sidecar/admin data to explain the values
- add tests for event-stream replay, projection rebuild, and no-material cases
- persist `projection_json`, `explanation_json`, `reduced_through_event_id`,
  `reduced_through_occurred_at`, `projection_version`, and
  `projection_updated_at` on `agent_session_life_states`
- persist `presence_tick_evaluated` for both skipped and enqueued presence ticks
- keep `presence_tick` from refreshing `last_active_at`

Do not restore or add:

- a second planner context
- autonomous runner timers beyond the current presence tick
- a separate share-pool queue for "想回头分享" residue; keep it in normal
  context / `<xiaoni_os>` / compressed summary
- hardcoded web-search motives or query templates
- fake reading/watching/browsing records
- source wording that implies real evidence without a matching real event

## Acceptance Criteria

- Given the same ordered `agent_life_events`, the reducer returns the same
  snapshot.
- Clearing `agent_session_life_states` does not destroy Xiaoni's state; it can be
  rebuilt from the event stream.
- A group/private suggestion can affect state only after it appears as visible
  context or compacted Xiaoni continuity, not through a separate suggestion
  channel.
- Admin activity can explain current energy and recent action-cost/recovery facts.
- The prompt receives facts, energy, costs, residues, and source boundaries. It does not
  receive a forced recommended action.

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
- Life-only `presence_tick` reads the global recent append stream, compressed
  `<小腻近况>`, and `<小腻的OS>`. It can use `submit_life_action`,
  `web_search`, or `stay_silent`, not a private planner context. If it produces
  a "想回头分享" residue, that residue is appended into `<小腻的OS>` so it stays
  in normal context and later compression.
- `agent_digital_actions` is historical data only. The old write helpers are
  gone from `@qq-bot/persistence`, and prompt construction no longer reads this
  table for current state.

## Locked Decisions

1. `agent_life_events` is the canonical append-only event stream for Xiaoni's
   inner life, QQ presence, visible actions, silence decisions, and later
   digital-life actions.
2. `agent_session_life_states` and group state tables are projections/caches
   derived from that stream. They may speed scheduling, but they are not allowed
   to become the truth source.
3. Phase 1 restores no separate self-action runner. Implement the reducer and
   admin explanation path first; only then decide whether a new autonomous
   runner is justified.
4. Suggestions from group/private chat influence Xiaoni only by entering the
   normal event stream, `<小腻的OS>`, or compact summary. Do not add hardcoded
   suggestion fields, planner memory, query seeds, or interest-key tables.
5. Delete the old shortcut pattern: no hardcoded `motiveText`, no exact-query
   enforcement as personality, no Heine/reading seeds, and no fake source
   wording.

## Reducer Shape

```text
agent_life_events append stream
  -> deterministic reducer
  -> homeostasis snapshot
  -> presence/context projection
  -> main loop decides: speak / search / stay_silent / internal residue
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
The runtime should not decide Xiaoni's action from those meters; Xiaoni receives
energy plus cost context and chooses inside the main loop.

## Event Rules

Append events for facts that happened, not inferred personality:

- `surface_visit`: Xiaoni opened or used QQ/IM.
- `qq_message_seen`: a real human message entered Xiaoni's visible stream.
- `speak_in_group` / `qq_self_message`: Xiaoni actually sent text.
- `silence_decision`: Xiaoni chose to stay silent or lurk.
- `terminal_action_committed` / `terminal_action_blocked`: delivery boundary.
- `presence_tick_evaluated`: a scheduler check happened, including skip or
  enqueue reason and the state snapshot used for the decision.
- `rest_period` / `sleep_period`: rest facts that lower or clear accumulated
  action cost, which directly restores energy.
- future digital events: real or explicitly constructed digital actions, each
  carrying source honesty, action cost, and source evidence.

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
  context / `<小腻的OS>` / compressed summary
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

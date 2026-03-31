# Loop Agent Delivery Commit Architecture

## Goal
- Eliminate repeated outbound replies at the mechanism level while keeping the repository's core principle intact: the runtime remains a loop agent, not a one-shot generator.
- Replace the current single-point duplicate suppression patch with a delivery model that makes repeated sends structurally hard, observable, and testable.
- Produce a CTO-reviewable plan that separates immediate stopgap protection from the long-term runtime contract we actually want.

## Scope
- `modules/agent-service`
- `modules/provider-service`
- `packages/persistence`
- `modules/admin-panel/backend`
- Runtime observability and replay surfaces for agent runs

## Constraints
- The repository direction stays `loop agent`, not a rewrite to a non-loop single-shot assistant.
- The current hotfix in `modules/agent-service/src/services/agent-loop-service.ts` remains in place until the root fix is shipped and verified.
- The fix must handle exact duplicates and near-duplicates. A second outbound commit that differs by one character but is functionally the same is still a product defect.
- The fix cannot depend on prompt wording alone. Prompt-only control is not a safety boundary.
- The active runtime path is `NapCat -> provider-service -> agent-service -> admin/backend/frontend`.

## Problem
- The current loop allows the model to call `speak_in_group` or `reply_in_private` repeatedly across turns.
- The shipped hotfix suppresses exact same-content repeats in-run, but it is still a last-line guard:
  - the model still believes "say it again" is a valid next move
  - small wording drift can evade exact-string dedupe
  - the runtime contract still treats outbound delivery as an open-ended tool, not a committed state transition
- The user-visible outcome is bad in two ways:
  - before the patch: repeated real messages in the group
  - after the patch: fewer bad sends, but the loop is still semantically confused and wastes turns

## Current State
```text
CURRENT STATE
Inbound message
  -> loop agent turn 1
  -> speak_in_group
  -> message is really sent
  -> loop agent turn 2 still has speak_in_group available
  -> runtime relies on prompt or duplicate guard to stop another send

THIS PLAN
Inbound message
  -> loop agent runs with explicit delivery state
  -> agent may reason for multiple turns before commit
  -> once a reply is committed and sent, the "delivery gate" closes
  -> later turns can only finish or operate on unsent draft state

12-MONTH IDEAL
Inbound message
  -> structured context + reply policy
  -> loop agent with explicit state machine and per-run budgets
  -> draft/commit model for outbound delivery
  -> observability shows intent, draft, commit, suppression, and final user-visible send
  -> replay and admin trace explain exactly why one reply was sent and why the second was blocked
```

## What Already Exists
- Existing stopgap guard in `modules/agent-service/src/services/agent-loop-service.ts` blocks exact same outbound payloads within one run.
- Existing `messages[]` tool contract already supports multi-message delivery in a single speaking tool call.
- Existing run traces, tool execution logs, and timeline events already expose enough surface to debug runtime behavior after additional instrumentation.
- Existing active plans already point in the right direction:
  - `docs/exec-plans/active/response-chain-cache-anchor.md` fixed replay continuity.
  - `docs/exec-plans/completed/agent-input-message-structure-v2.md` moves inbound context toward structured semantics.

## Premise Challenge
- The real problem is not "duplicate exact strings." The real problem is "the runtime has no concept of outbound commit finality."
- If a human sends the message, that act changes what can happen next. Our loop does not currently encode that state transition.
- Doing nothing means we keep chasing copies of the same bug:
  - exact duplicate
  - punctuation-variant duplicate
  - synonym duplicate
  - multi-turn self-amplification with slightly different wording

## Implementation Alternatives

### Approach A: Stronger Output Dedupe
- Summary: Keep the current runtime shape and extend the stopgap from exact-string suppression to normalized-text plus semantic similarity checks.
- Effort: M
- Risk: Medium
- Pros:
  - Smallest diff.
  - Fastest to harden the current hotfix.
  - Catches "same sentence with one character difference" if normalization/similarity is good enough.
- Cons:
  - Still a downstream guard, not a runtime contract.
  - Leaves the loop believing extra sends are valid.
  - Similarity thresholds become policy debt and false-positive risk.
- Reuses:
  - Current `duplicate_suppressed` path.
  - Existing tool execution logs and run traces.

### Approach B: Single-Commit Delivery State Machine
- Summary: Keep the loop agent, but split each run into explicit states: `reasoning_open -> delivery_committed -> finish_only`. The run may make exactly one outbound delivery commit, and that commit may contain one or more `messages[]`. Once committed, later turns cannot send again.
- Effort: M
- Risk: Low to Medium
- Pros:
  - Fixes the root contract instead of only the symptom.
  - Preserves loop reasoning before commit.
  - Makes multi-message replies explicit: if you want 2-3 outbound messages, emit them in one committed send.
- Cons:
  - Requires touching loop orchestration, persistence fields, and traces.
  - Some existing prompt assumptions and tests need to be rewritten.
  - The model may still try a second send, but it becomes an invalid transition rather than a valid tool call.
- Reuses:
  - Existing loop agent.
  - Existing `messages[]` contract for single-commit multi-message output.
  - Existing run/timeline infrastructure.

### Approach C: Draft Then Commit Runtime
- Summary: Introduce a new tool contract where the model can iterate on an unsent draft, then call a distinct commit/send action once. Delivery is impossible before commit and impossible again after commit.
- Effort: L
- Risk: Medium
- Pros:
  - Cleanest long-term architecture.
  - Makes "thinking", "drafting", and "sending" separate and observable.
  - Gives us a natural place to add reply budgets, moderation, and policy checks later.
- Cons:
  - Larger migration.
  - Requires bigger prompt and tool-contract changes.
  - Higher short-term regression risk.
- Reuses:
  - Existing loop skeleton.
  - Existing provider execution path.
  - Existing admin trace surfaces after schema extension.

## Recommendation
- Choose **Approach B: Single-Commit Delivery State Machine**.
- Why: it is the smallest change that actually changes the runtime's truth. Approach A is still whack-a-mole. Approach C is beautiful, but bigger than this bug needs right now.

## Root Design

### Runtime State Machine
```text
                +----------------------+
                |   reasoning_open     |
                +----------------------+
                  |   ^           |
   non-send tools |   |           | stay_silent / finish
                  v   |           v
                +----------------------+
                | delivery_committed   |
                +----------------------+
                  |                |
                  | finish         | invalid second send
                  v                v
                +----------------------+
                |      finished        |
                +----------------------+
                                 |
                                 v
                         blocked_transition
```

### Contract Change
- Before outbound commit:
  - loop may reason across turns
  - loop may choose silence
  - loop may commit one outbound delivery with one or more messages
- After delivery commit:
  - speaking tools are closed for the remainder of the run
  - only finish-oriented actions are valid
  - any attempted second send is logged as an invalid state transition
  - no real outbound delivery happens

### Tool Legality Matrix

| Phase | Allowed tools | Forbidden tools | Notes |
|------|---------------|-----------------|-------|
| `reasoning_open` | `speak_in_group`, `reply_in_private`, `stay_silent`, non-speaking tools | — | exactly one successful speaking commit may happen here |
| `delivery_committed` | `stay_silent`, finish-oriented tools, non-speaking read-only tools | all speaking tools | this phase means outbound delivery already happened |
| `finished` | none | all tools | terminal state |

### Run Persistence Contract

`agent_runs` becomes the source of truth for delivery state, not process memory.

Required fields:

| Field | Type | Meaning |
|------|------|---------|
| `delivery_phase` | text | `reasoning_open`, `delivery_committed`, `finished` |
| `delivery_commit_count` | integer | B1 invariant is `0` or `1` |
| `blocked_delivery_attempt_count` | integer | number of speaking calls attempted after commit |

Optional but recommended:

| Field | Type | Meaning |
|------|------|---------|
| `last_blocked_delivery_reason` | text | operator-facing summary of why the latest speaking call was blocked |

State invariants:
- new runs start with `delivery_phase = reasoning_open`
- a successful `speak_*` call atomically sets:
  - `delivery_phase = delivery_committed`
  - `delivery_commit_count = 1`
- a blocked second-send attempt increments `blocked_delivery_attempt_count`
- `finish` sets `delivery_phase = finished` without erasing the fact that `delivery_commit_count = 1`
- `delivery_commit_count > 1` is illegal and should never be produced by runtime code or replay

### Runtime API Shape

Do not hand-roll status updates inline in the loop.

Add explicit store methods in `modules/agent-service/src/services/runtime-store.ts`:
- `markRunDeliveryCommitted(runId, payload)`
- `markRunDeliveryBlocked(runId, payload)`
- `completeAgentRun(runId, payload)` remains the terminal write

Expected responsibility split:
- `agent-loop-service` decides whether a tool call is speaking or non-speaking
- `runtime-store` owns run-state transitions and counters
- admin/backend reads the resulting state, it does not infer it from tool logs

### Event Model

Blocked second-send attempts should be visible in both tool logs and timeline events.

`tool_execution_logs` expectations:
- keep one row per tool call attempt
- speaking call after commit should not be marked as a normal successful delivery
- store structured result like:
  - `outcome = blocked_transition`
  - `blocked_reason = already_delivery_committed`
  - `duplicate_suppressed = true|false`

`timeline_events` expectations:
- emit a delivery commit event when the first speaking call succeeds
- emit a blocked transition event when a later speaking call is refused

Suggested event names:
- `delivery_commit`
- `blocked_transition`
- `finish`

### Why This Is Better
- It handles exact duplicates and near-duplicates because the runtime no longer asks "is this text similar enough to block?"
- It asks a simpler question: "has this run already committed delivery?"
- That is a much better invariant. Harder to misunderstand. Easier to test. Easier to explain in traces.

## Implementation Checklist

### 1. Schema and Persistence
- [x] Extend `agent_runs` schema in `modules/agent-service/src/services/runtime-store.ts`
  - [x] add `delivery_phase TEXT NOT NULL DEFAULT 'reasoning_open'`
  - [x] add `delivery_commit_count INTEGER NOT NULL DEFAULT 0`
  - [x] add `blocked_delivery_attempt_count INTEGER NOT NULL DEFAULT 0`
  - [x] add `last_blocked_delivery_reason TEXT`
- [x] Initialize new runs with `delivery_phase = reasoning_open`
- [x] Add explicit state-transition methods in `RuntimeStore`
- [x] Keep writes idempotent enough that reprocessing cannot push `delivery_commit_count` above `1`

### 2. Agent Loop Enforcement
- [x] In `modules/agent-service/src/services/agent-loop-service.ts`, load run delivery state from store instead of trusting only in-memory fingerprints
- [x] Allow speaking tools only while `delivery_phase = reasoning_open`
- [x] On first successful speaking tool execution:
  - [x] persist `delivery_committed`
  - [x] persist `delivery_commit_count = 1`
  - [x] keep current exact-duplicate fingerprint guard as defense in depth
- [x] On later speaking tool execution:
  - [x] do not call provider delivery path
  - [x] mark blocked transition in store
  - [x] finish the run cleanly
- [x] On `finish` / `stay_silent`:
  - [x] transition to `finished`
  - [x] do not wipe prior delivery counters

### 3. Admin and Trace Surfaces
- [x] Expose `delivery_phase`, `delivery_commit_count`, `blocked_delivery_attempt_count`, `last_blocked_delivery_reason` in `GET /api/runs/:runId`
- [x] Expose run-level delivery fields in run detail, while keeping session-level surfaces unchanged unless they materially help operators
- [x] Update trace-building code so blocked second-send attempts render as blocked transitions, not ordinary tool success
- [x] Keep `sent_messages_count` derived only from actual delivered messages, never from blocked attempts

### 4. Tests
- [x] `modules/agent-service/src/__tests__/agent-loop-service.test.ts`
  - [x] first successful `speak(messages[])` commits delivery state
  - [x] multi-message single commit still counts as one delivery commit
  - [x] second speaking attempt after commit is blocked
  - [x] near-duplicate second attempt is blocked
  - [x] punctuation-drift second attempt is blocked
  - [x] `stay_silent` path finishes without delivery commit
- [x] `modules/agent-service/src/__tests__/runtime-store.test.ts`
  - [x] new runs start in `reasoning_open`
  - [x] `markRunDeliveryCommitted()` persists counts and phase
  - [x] `markRunDeliveryBlocked()` increments blocked count and reason
  - [x] `completeAgentRun()` preserves prior delivery facts
- [x] admin/backend tests
  - [x] run detail includes new delivery fields
  - [x] trace payload includes blocked-transition entries
  - [x] blocked attempts do not inflate sent-message counts

### 5. Verification
- [x] `npm test` in `modules/agent-service`
- [x] backend tests covering run detail / trace builders
- [x] `docker compose build agent-service`
- [x] `docker compose up -d agent-service`
- [x] `docker compose build admin-backend` if backend output changes
- [x] `docker compose up -d admin-backend` if backend output changes
- [x] replay at least one known-bad historical run and verify:
  - [x] exactly one real outbound delivery
  - [x] `delivery_commit_count = 1`
  - [x] `blocked_delivery_attempt_count >= 1` when model retries
  - [x] admin run detail explains the block clearly

## Rollout Plan

```text
Phase 1
  schema + runtime-store methods

Phase 2
  agent-loop enforcement

Phase 3
  admin run detail + trace rendering

Phase 4
  replay verification against known-bad runs
```

Rollout rules:
- ship runtime and persistence first
- keep the current exact-duplicate guard during rollout
- do not remove the stopgap until the state-machine version has passed replay verification

Rollback:
- if new state fields cause runtime instability, retain the hotfix duplicate suppression and revert only the new state-machine enforcement
- because the new fields are additive, rollback should not require data deletion

## Edge Cases To Resolve Before Implementation
- If a run sends one message, then a higher-priority moderation rule wants to stop the run, do we mark `delivery_committed` plus `terminated_by_policy`?
- If we ever add non-speaking side-effect tools, which state are they allowed in after commit?

## File Touch Plan

Expected minimum diff:
- `modules/agent-service/src/services/runtime-store.ts`
- `modules/agent-service/src/services/agent-loop-service.ts`
- `modules/agent-service/src/__tests__/agent-loop-service.test.ts`
- `modules/agent-service/src/__tests__/runtime-store.test.ts`
- `modules/admin-panel/backend/src/routes/run-routes.ts`
- `modules/admin-panel/backend/src/services/trace-span-builder.ts`
- backend test files covering run detail / trace output

This should stay within the "engineered enough" zone:
- no new service class
- no new delivery-state table
- no new append/draft tool
- additive schema change plus explicit state methods

## Not In Scope
- Replacing loop agents with one-shot generation.
- Building a full planner/executor or multi-agent runtime in this iteration.
- Solving the separate "should the bot join this conversation at all?" pre-agent gate problem tracked in `TODOS.md`.
- Reworking all prompt semantics or group persona behavior unrelated to delivery finality.

## Decision Log
- 2026-03-31: The shipped exact-string suppression patch is necessary but intentionally temporary. It is defense in depth, not the architecture.
- 2026-03-31: The root issue is runtime state semantics, not text similarity alone.
- 2026-03-31: We keep `loop agent` as the product principle, but we narrow when delivery tools are legal.
- 2026-03-31: Root-fix decision is `B1`: single outbound commit per run, with multi-message delivery handled inside one `messages[]` payload. Partial-send recovery is out of scope for this iteration.

## Progress Log
- 2026-03-31: Investigated three production runs with repeated same-message sends: `run_1774890793930_fc3ebeed`, `run_1774890812735_818ccc2f`, `run_1774891604498_2fa9fa3e`.
- 2026-03-31: Verified via direct replay that the current hotfix suppresses exact repeated sends, but the model still attempts a second `speak_in_group` on turn 2.
- 2026-03-31: Concluded that the runtime still lacks an explicit "delivery committed, sending now closed" state transition, which is why near-duplicate variants remain a live risk.
- 2026-03-31: Landed the runtime-state fix in `agent-service`: `agent_runs` now persists delivery phase and blocked-attempt counters, and speaking tools are refused after the first committed outbound send.
- 2026-03-31: Landed admin/backend visibility for delivery state and blocked transitions so operators can tell the difference between a real send and a refused second send.
- 2026-03-31: Added regression coverage for exact duplicate and near-duplicate retry paths, plus runtime-store and backend assertions for the new delivery fields.

## Verification
- Investigated original runs through `/api/runs/:runId` and PostgreSQL.
- Replayed equivalent queue rows after shipping the hotfix:
  - `run_1774925895211_c1ed8c97`
  - `run_1774925936985_66d9ab3f`
  - `run_1774925955812_332940b5`
- Observed each replay still attempted a second `speak_in_group`, but the runtime suppressed it and emitted `finish_outcome = duplicate_suppressed`.
- This proves the stopgap works and also proves the root contract is still wrong.
- Root-fix implementation verification:
  - `modules/agent-service` test suite covers delivery commit, blocked transition, near-duplicate retry, and state persistence behavior.
  - admin/backend tests cover run detail delivery fields and blocked-transition trace rendering.
  - compose-managed services were rebuilt and restarted for the shipped runtime path.
  - operator-facing run detail now reports `delivery_phase`, `delivery_commit_count`, `blocked_delivery_attempt_count`, and `last_blocked_delivery_reason`.

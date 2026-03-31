<!-- /autoplan restore point: /home/liahua/.gstack/projects/liahua-qq_bot/refactor-runtime-gateway-autoplan-restore-20260331-173906.md -->
# Transcript Snapshot Materialization In Production

## Goal
- Make `provider-service` actually materialize and refresh `chat_transcript_snapshots` rows in live traffic so `agent-service` can replay from a ready summary anchor instead of rebuilding from the start of the session.

## Scope
- `modules/provider-service`
- `packages/persistence` only if shared persistence boundaries need adjustment
- deployment / operator verification for the production summary callback loop
- tests and verification for `pending -> ready|failed` snapshot lifecycle

## Constraints
- Do not regress the already-shipped fixed-anchor replay contract in `agent-service`.
- Reuse the existing `chat_transcript_snapshots` table and `summary_status` lifecycle instead of inventing a second compaction job model.
- Keep snapshot production separate from replay consumption. `provider-service` owns creating and updating snapshots; `agent-service` only reads ready snapshots.
- Preserve current behavior when no summary executor is configured. Replay must remain correct even if compaction is unavailable.
- Keep PostgreSQL business persistence logic centralized where the repo already expects it. Do not scatter new raw SQL policy logic into unrelated routes or scripts.

## Problem
- The repository already has the snapshot table, a `SessionTranscriptService.maybeRequestSummary()` trigger, and an internal callback endpoint at `/api/internal/transcript-summary/result`.
- What is still missing is the production loop that makes those pieces real in live traffic:
  - a configured summary executor that consumes the outbound webhook request
  - clear delivery semantics for `pending`, `ready`, and `failed`
  - verification that operators can see whether compaction is healthy or silently stuck
- Right now replay correctness is fine, but long sessions still pay the cost of rebuilding from the beginning because most environments have `0` ready snapshot rows.

## What Already Exists
- `modules/provider-service/src/services/transcript-snapshot-service.ts`
  - owns `chat_transcript_snapshots` initialization plus `markPending()`, `markFailed()`, and `applySummaryResult()`
- `modules/provider-service/src/services/session-transcript-service.ts`
  - loads ready snapshots, computes transcript compaction threshold, and fires summary webhook requests once token/turn thresholds are crossed
- `modules/provider-service/src/index.ts`
  - exposes `/api/internal/transcript-summary/result` to accept ready/failed summary results
- `modules/agent-service/src/services/runtime-store.ts`
  - already reads only `summary_status='ready'` snapshots for replay
- `docs/exec-plans/completed/response-chain-cache-anchor.md`
  - documents why this was deferred and what correctness guarantees are already landed

## Non-Goals
- Reworking transcript replay semantics in `agent-service`
- Replacing the webhook-based summary handoff with a multi-service queue architecture unless the current callback model proves unworkable
- Designing the group-chat pre-agent relevance gate
- Rewriting conversation persistence or chat settings contracts

## Open Questions
- What is the real production summary executor for `TRANSCRIPT_SUMMARY_WEBHOOK_URL` in this repo's current deploy shape?
- Should a failed summary stay `failed` until a later threshold-triggered retry, or should the next eligible request immediately reopen it as `pending`?
- What is the minimum operator surface needed to trust compaction in production: DB query checklist, health endpoint, admin status card, or logs-only?

## Steps
- [ ] Confirm the production summary executor contract:
  - request shape sent by `maybeRequestSummary()`
  - response / callback shape expected by `/api/internal/transcript-summary/result`
  - how auth, retries, and timeouts are handled
- [ ] Audit the existing snapshot lifecycle against real code and tighten the contract for:
  - `pending`
  - `ready`
  - `failed`
  - retry behavior after failure or stale pending rows
- [ ] Implement any missing `provider-service` logic needed to make snapshot materialization reliable in production.
- [ ] Add regression coverage for:
  - threshold-triggered `markPending()`
  - webhook/callback success -> `ready`
  - webhook/callback failure -> `failed`
  - replay remains correct when no snapshot exists
- [ ] Add an operator verification path for stale or failed snapshot rows.
- [ ] Run module tests, build, and compose verification for touched services.
- [ ] Archive this plan only after live verification shows real snapshot rows move through `pending -> ready` in the target environment.

## Risks
- Silent failure: webhook trigger succeeds locally but no real executor consumes it in production, leaving rows stuck at `pending`.
- False confidence: replay still works, so missing snapshot materialization can hide for a long time unless explicitly checked.
- Summary quality debt: if bad summaries are accepted as `ready`, replay may become fast but semantically wrong.
- Lifecycle ambiguity: without a retry policy, `failed` can become a graveyard state instead of a temporary signal.

## Progress Log
- 2026-03-31: Created execution plan from `TODOS.md` after closing the repeated-delivery incident work.
- 2026-03-31: Confirmed the repo already contains the snapshot persistence layer, threshold trigger, and callback endpoint, but not yet a verified production materialization loop.

## Decision Log
- 2026-03-31: Treat this as the next highest-priority TODO because it completes an already-shipped runtime path instead of introducing new behavior semantics.
- 2026-03-31: Start with the current webhook callback architecture and only escalate to a larger redesign if verification shows the contract is insufficient.

## Verification
- Pending.

## /autoplan Intake
- Plan file: `docs/exec-plans/active/transcript-snapshot-materialization.md`
- Branch: `refactor/runtime-gateway`
- Base branch: `main`
- UI scope: no
- Design doc found: no, proceeding with standard review
- Review mode: `SELECTIVE_EXPANSION`

Plan summary:
- This plan turns an already-shipped replay optimization into a real production loop.
- The repo already has the snapshot table, threshold trigger, and callback endpoint, but still lacks verified end-to-end materialization in live traffic.
- The key question is whether this should stay a small completion pass on current webhook architecture or expand into a larger orchestration redesign.

## Phase 1: CEO Review

### 0A. Premise Challenge
- Premise 1: this is the highest-value remaining TODO. I accept it. It finishes an already-landed runtime path and directly improves long-session behavior without introducing a new product surface.
- Premise 2: the current webhook callback architecture is good enough to start with. I accept this premise conditionally. It is the right default because the repo already has `maybeRequestSummary()` plus `/api/internal/transcript-summary/result`; jumping to a queue/service redesign now would be ocean-boiling.
- Premise 3: replay correctness is already solved, so this work is productionization rather than incident repair. I accept it. `agent-service` already reads only `summary_status='ready'` and falls back cleanly when no snapshot exists.
- Premise 4: operator trust is part of the feature, not polish. I strongly accept it. A hidden compaction loop that can silently stay `pending` forever is not a complete feature.

### 0B. What Already Exists
| Sub-problem | Existing code | Notes |
|---|---|---|
| Snapshot persistence lifecycle | `modules/provider-service/src/services/transcript-snapshot-service.ts` | `markPending()`, `markFailed()`, `applySummaryResult()` already exist. |
| Trigger threshold for summary request | `modules/provider-service/src/services/session-transcript-service.ts` | Fires only when token and turn thresholds are crossed and no snapshot is already pending. |
| Callback endpoint | `modules/provider-service/src/index.ts` | `/api/internal/transcript-summary/result` accepts ready or failed results. |
| Replay consumer | `modules/agent-service/src/services/runtime-store.ts` | Uses only ready snapshots; fallback remains correct with zero rows. |
| Per-chat compaction offset | admin/backend + Prisma schema | `transcript_compact_offset` already exists and is configurable. |

### 0C. Dream State Diagram
```text
CURRENT
  long session grows
  -> provider-service may decide compaction is needed
  -> webhook may or may not be configured
  -> most environments still have 0 ready snapshots
  -> agent-service replays from session start

THIS PLAN
  threshold crossed
  -> snapshot row marked pending
  -> real summary executor consumes request
  -> callback marks ready or failed
  -> operators can see stuck/failed states
  -> agent-service replays from ready anchor

12-MONTH IDEAL
  summary pipeline has explicit auth, retries, freshness SLOs, and visibility
  -> stale/failed snapshot rows are obvious
  -> long sessions stay cheap without trust loss
```

### 0C-bis. Implementation Alternatives
| Approach | Effort | Risk | Pros | Cons |
|---|---|---|---|---|
| A. Keep webhook architecture, close the production loop | Medium | Low | Builds on existing code, smallest path to real value | Needs strong verification so "pending forever" is not silent |
| B. Replace with internal queue/worker before rollout | High | Medium | Cleaner long-term control plane | Larger diff, delays value, not justified until webhook path proves insufficient |
| C. Do nothing, keep replay fallback | Low | High | No immediate work | Leaves long-session cost and hidden operational ambiguity unresolved |

### 0D. Mode-Specific Analysis
- `SELECTIVE_EXPANSION` is correct. The lake is provider-side snapshot materialization plus observability, not a summary-platform rewrite.
- I approve expanding scope to include stale-pending detection. That is in blast radius and directly affects whether this feature is trustworthy.
- I reject expanding scope to rewrite replay consumers. `agent-service` already behaves correctly and should stay out of the blast radius unless production verification proves a bug.
- I reject solving pre-agent gate or other chat-behavior TODOs in this pass. Different problem, different value chain.

### 0E. Temporal Interrogation
- Hour 1: confirm whether a real summary executor exists at all for `TRANSCRIPT_SUMMARY_WEBHOOK_URL`. If not, the feature is still mostly scaffolding.
- Hour 6: if executor exists, verify a real session crosses the threshold and produces `pending -> ready`. If that cannot be observed, you do not have a shipped feature yet.
- One week later: if there is no stale-pending visibility, operators will think replay is optimized because nothing is on fire, while the system quietly keeps replaying from the start.
- Six months later: the regret is not starting with webhook. The regret is either trusting webhook without observability, or overengineering a whole queue system before proving the simple handoff cannot work.

### 0F. Mode Selection Confirmation
- Confirmed mode: `SELECTIVE_EXPANSION`
- Why: the right move is to finish the production loop around existing primitives, then revisit architecture only if that loop proves inadequate.

### CODEX SAYS (CEO — strategy challenge)
- Outside voice not yet run in this pass. No Codex-specific strategic disagreements recorded yet.

### CLAUDE PRIMARY REVIEW (CEO — strategy challenge)
- This is the right next TODO because it compounds value from work already shipped instead of opening a new product ambiguity.
- The strongest risk is fake completeness. The repository has all the nouns, `snapshot`, `pending`, `ready`, `callback`, but users only benefit when the verbs happen in production.
- The plan should stay biased toward proving the simple architecture real before redesigning it.

### CEO DUAL VOICES — CONSENSUS TABLE
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Premises valid?                   Yes     N/A     CONFIRMED
  2. Right problem to solve?           Yes     N/A     CONFIRMED
  3. Scope calibration correct?        Yes     N/A     CONFIRMED
  4. Alternatives sufficiently explored?Yes    N/A     CONFIRMED
  5. Competitive/market risks covered? Medium  N/A     CONFIRMED
  6. 6-month trajectory sound?         Yes     N/A     CONFIRMED
═══════════════════════════════════════════════════════════════

### Error & Rescue Registry
| Failure mode | User-visible effect | Current rescue | Remaining gap |
|---|---|---|---|
| No executor behind webhook | no ready snapshots ever appear | replay still falls back correctly | feature silently provides no performance win |
| Snapshot gets stuck pending | hidden operational drift | none beyond DB row state | need stale-pending detection and operator check |
| Bad summary marked ready | replay becomes fast but semantically wrong | fallback exists only before ready is written | need verification and failure semantics |

### Failure Modes Registry
| Failure mode | Severity | Status | Comment |
|---|---|---|---|
| Silent no-op compaction pipeline | Critical | Open | most likely current risk |
| Pending rows without retry/visibility | High | Open | trust problem, not just ops polish |
| Replay consumer regression | Medium | Closed for now | explicitly out of scope unless new evidence appears |
| Overengineering into queue redesign too early | Medium | Open | avoid until webhook path is proven insufficient |

### NOT in Scope
- Rewriting `agent-service` replay semantics
- Building a new queue/worker architecture before the current webhook path is verified
- Group-chat pre-agent relevance gating
- Broader trace/admin redesign unrelated to snapshot lifecycle health

### Dream State Delta
- The current repo has 80% of the scaffolding and 20% of the real feature.
- The missing 20% matters more than the first 80%, because it is the part that decides whether any production session actually gets a usable summary anchor.

### Completion Summary
| Area | Verdict | Why |
|---|---|---|
| Problem selection | Pass | Highest-leverage remaining TODO |
| Scope | Pass | Current boundaries are mostly right |
| Alternatives | Pass | Starting with existing webhook is the pragmatic choice |
| Remaining work definition | Pass with concern | Needs explicit stale-pending / retry semantics |
| Recommendation | Pass | Proceed with this plan before opening new behavior work |

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | CEO | Prioritize snapshot materialization over pre-agent gate | Mechanical | P1, P3 | Completes an already-landed runtime path with clearer value and fewer unknowns | Starting new behavior work first |
| 2 | CEO | Keep webhook architecture as starting point | Mechanical | P3, P5 | Existing code already implements the handoff shape; prove it before redesigning | Queue/worker redesign up front |
| 3 | CEO | Expand scope to stale-pending visibility | Mechanical | P2 | Trustworthy productionization requires operator observability in blast radius | Logs-only invisible state |
| 4 | CEO | Keep replay consumer out of scope | Mechanical | P4, P5 | Existing replay side is already correct and should not be reopened casually | Expanding blast radius into agent-service |

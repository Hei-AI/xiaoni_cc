<!-- $autoplan restore point: /home/liahua/.gstack/projects/liahua-qq_bot/refactor-runtime-gateway-autoplan-restore-20260331-172546.md -->
# CTO Review Memo: Loop Agent Repeated Delivery

## Decision Needed
- Approve the runtime direction for root-cause repair of repeated outbound replies in the loop agent.
- Confirm that the current shipped duplicate-suppression patch is only a stopgap, not the final architecture.

## Executive Summary
- We found and verified a real production failure mode: one inbound message can cause the loop agent to send the same reply multiple times within a single run.
- We shipped a stopgap that blocks exact same-content repeats in-run.
- That stopgap works, but it does not fix the actual system contract.
- The real defect is that after outbound delivery is committed, the run still remains in a state where another net-new send is legal.
- Recommendation: keep the `loop agent` principle, but change runtime semantics so outbound delivery is a one-way commit per run.

## What Happened
- Three real runs showed the same pattern:
  - first turn sends a group reply
  - later turn sends the same reply again
  - repeated 4 to 8 times in one run
- After the stopgap patch, replays of those flows showed:
  - the model still attempted a second `speak_in_group`
  - the runtime suppressed the second send
  - only one real message was delivered

## Why This Matters
- The current bug is not "exact duplicate text."
- The current bug is "delivery remains open after delivery already happened."
- Exact-string suppression only catches one shape of failure.
- If the second message differs by one character, punctuation, emoji, or small wording drift, the same architectural weakness still exists.

## Root Cause
```text
Current model
  reasoning -> send part of reply -> reasoning -> send more -> maybe finish

What we want
  reasoning -> assemble final outbound payload -> send(commit) -> finish-only
```

- Our loop currently treats speaking tools as ordinary repeatable tools.
- A real outbound send does not change the legal action space enough.
- Prompt instructions are trying to do safety work that should live in runtime state.

## Options

### Option A: Stronger Dedupe
- Extend the stopgap from exact-string matching to normalized text and semantic similarity.
- Upside:
  - smallest diff
  - fast to harden
- Downside:
  - still downstream patching
  - threshold tuning becomes policy debt
  - still does not change the run contract

### Option B: Single-Commit Delivery State Machine
- Keep loop agent behavior, but allow exactly one outbound delivery commit per run.
- Upside:
  - fixes the contract, not just the symptom
  - catches exact duplicates and near-duplicates without similarity tuning
  - preserves multi-turn reasoning before commit
  - preserves intentional multi-message replies through one `messages[]` payload
- Downside:
  - requires orchestration and trace changes
  - forces the runtime to clearly separate "drafting more to say" from "already committed delivery"

### Option C: Draft Then Commit Runtime
- Introduce explicit unsent draft state and a separate commit/send action.
- Upside:
  - cleanest long-term architecture
  - strongest observability and policy hooks
- Downside:
  - larger migration
  - too much surface change for this immediate root-cause fix

## Recommendation
- Choose **Option B: Single-Commit Delivery State Machine**.

Why:
- It preserves the product principle that this is a `loop agent`.
- It fixes the system where it is actually wrong, in runtime state semantics.
- It avoids overfitting to text similarity.
- It is materially smaller than a full draft/commit redesign.

## Proposed Runtime Contract
```text
States:
  reasoning_open
  delivery_committed
  finish_only

Rules:
  - before delivery commit: speaking tools allowed
  - the run may prepare one outbound commit containing one or more `messages[]`
  - successful speaking tool execution commits delivery for the run
  - after commit: speaking tools closed
  - later speaking attempt: invalid transition, log it, do not send
```

## Why This Is Better Than Smarter Dedupe
- It solves "same message with one character changed."
- It solves "same meaning with punctuation drift."
- It solves "model thinks another send is still allowed."
- It turns a fuzzy similarity problem into a crisp state machine problem.

## Risks To Resolve
- How do we represent blocked second-send attempts in traces, metrics, and admin UI?
- Do we want a per-run outbound budget as explicit metadata?

## What Is Already Done
- Stopgap exact-duplicate suppression is shipped in `agent-service`.
- Regression test exists for exact in-run duplicate suppression.
- Real queue-row replays proved the stopgap works and also proved the runtime still attempts illegal second sends.

## What Is Not Solved Yet
- Near-duplicate wording drift in the current shipped stopgap.
- General "single commit, then delivery is closed" runtime semantics.
- Strong operator visibility into blocked versus legal send attempts.

## Suggested Scope For The Next Engineering Pass
- Add delivery state to the run lifecycle.
- Allow exactly one speaking-tool commit per run, with one or more `messages[]`.
- Close speaking tools after that commit.
- Keep current exact-duplicate guard as defense in depth.
- Add replay and trace surfaces for blocked second-send attempts.
- Add regression coverage for:
  - exact duplicate
  - punctuation drift
  - one-character drift
  - synonym drift
  - intended multi-message single-commit send

## Non-Goals
- Replacing loop agents with one-shot generation.
- Solving pre-agent relevance gating in the same change.
- Full planner/executor redesign.

## Decision Request
- Approve Option B as the root-cause architecture.
- Treat the current patch as temporary defense in depth.
- Schedule a focused implementation pass on runtime delivery semantics before expanding prompt or persona work in this area.

## $autoplan Intake
- Plan file: `docs/exec-plans/active/loop-agent-delivery-cto-memo.md`
- Branch: `refactor/runtime-gateway`
- Base branch detection fell back to `main`
- UI scope: no
- Design doc found: no
- Review mode: `SELECTIVE_EXPANSION`

Plan summary:
- This file argues that repeated outbound replies are a runtime contract bug, not primarily a prompt bug.
- The proposed fix is to keep loop-agent behavior but close speaking tools after the first outbound commit in a run.
- The main remaining ambiguity is not the architecture choice itself, but whether the document still reflects future work accurately now that most of Option B is already implemented.

## Phase 1: CEO Review

### 0A. Premise Challenge
- Premise 1: repeated outbound replies are caused by runtime legality staying open after a real send, not by exact duplicate text alone. I accept this premise. It matches both the memo's replay evidence and the shipped code path in `modules/agent-service/src/services/agent-loop-service.ts`, where a second speaking tool call is now explicitly blocked after commit.
- Premise 2: one run should allow at most one outbound delivery commit, but that commit may contain multiple `messages[]`. I accept this premise as the cleanest contract for the current product. It preserves multi-turn thinking before send while preventing the user-visible failure mode of one run spraying multiple near-duplicate replies.
- Premise 3: pre-agent relevance gating is a separate problem and should stay out of this pass. I accept this premise. The group relevance problem is about whether the bot should join at all; the duplicate-send bug is about what happens after the runtime already decided to speak.
- Premise 4: this memo still describes "next engineering pass" work. I challenge this premise. The codebase already contains most of the Option B implementation, so the real plan gap has narrowed from "should we do the state machine?" to "what follow-up observability and policy semantics remain?"

### 0B. What Already Exists
| Sub-problem | Existing code | Notes |
|---|---|---|
| Persist delivery lifecycle on runs | `modules/agent-service/src/services/runtime-store.ts` | `agent_runs` now stores `delivery_phase`, `delivery_commit_count`, `blocked_delivery_attempt_count`, `last_blocked_delivery_reason`. |
| Enforce single outbound commit | `modules/agent-service/src/services/agent-loop-service.ts` | Speaking tools are blocked once delivery is no longer `reasoning_open`. |
| Record blocked attempts | `modules/agent-service/src/services/runtime-store.ts` | `markRunDeliveryBlocked()` persists operator-visible refusal state. |
| Expose run state in admin API | `modules/admin-panel/backend/src/routes/run-routes.ts` | Run/result payload already returns delivery phase and blocked-attempt counters. |
| Surface blocked transitions in trace view | `modules/admin-panel/backend/src/services/trace-span-builder.ts` | Blocked retries render as `tool.blocked_transition`, not as successful sends. |
| Regression coverage | `modules/agent-service/src/__tests__/agent-loop-service.test.ts`, `modules/agent-service/src/__tests__/runtime-store.test.ts` | Store and loop invariants are covered in unit tests. |

### 0C. Dream State Diagram
```text
CURRENT BEFORE FIX
  model can speak -> runtime sends -> model can still legally speak again
  user outcome: repeated replies, bot feels broken

THIS PLAN'S TARGET
  model can think across turns -> one outbound commit -> speaking closes -> finish/log blocked retry
  user outcome: one coherent reply, retries become internal telemetry instead of duplicate chat spam

12-MONTH IDEAL
  draft reasoning state -> explicit send commit policy -> side-effect budgets by tool class -> operator dashboards for blocked transitions, policy stops, and recovery paths
  user outcome: agent feels natural, traceable, and boring in the good way
```

### 0C-bis. Implementation Alternatives
| Approach | Effort | Risk | Pros | Cons |
|---|---|---|---|---|
| A. Stronger dedupe | Low | Medium | Quick patch, tiny diff | Treats text similarity as policy, leaves legality model wrong |
| B. Single-commit delivery state machine | Medium | Low | Fixes user-facing contract at the runtime layer, already mostly landed | Still needs doc cleanup and clear future boundaries for other side-effect tools |
| C. Draft then commit runtime | High | Medium | Best long-term shape for richer orchestration | Too much migration for the actual bug, bigger than the lake |

### 0D. Mode-Specific Analysis
- `SELECTIVE_EXPANSION` is correct. The memo should hold scope on delivery finality, then cherry-pick only the observability work already in blast radius.
- I approve expanding scope to include blocked-transition trace visibility because it directly affects whether operators can tell "duplicate prevented" from "message truly sent." That is in blast radius and already partially implemented.
- I reject expanding this memo into pre-agent relevance gating. That is a different product question, different failure mode, different data requirements.
- I reject reframing this as a prompt-tuning problem. Prompt wording can reduce retries, but the runtime contract is where user harm happens.

### 0E. Temporal Interrogation
- Hour 1: the team sees duplicate replies and ships exact-text suppression. Good emergency move.
- Hour 6: replay proves the model still attempts a second speaking tool call. This is the point where continuing to add smarter dedupe would become policy debt.
- One week later: if the runtime still had no commit state, you would be tuning punctuation and synonym thresholds instead of fixing the real legal action space. That road gets dumb fast.
- Six months later: the only future-regret risk in Option B is overfitting the "one commit" rule to all future side-effect classes. The contract should stay explicitly about speaking delivery, not every possible tool forever.

### 0F. Mode Selection Confirmation
- Confirmed mode: `SELECTIVE_EXPANSION`
- Why: the architecture choice is sound, but the document needs to narrow to the remaining delta between shipped code and future intent.

### CODEX SAYS (CEO — strategy challenge)
- Codex outside voice partially completed. The usable signal it produced was the right one: the memo currently assumes "single inbound event => at most one outbound delivery commit" as a product contract, but does not state clearly enough that this restriction is intentionally scoped to speaking tools and this failure mode.
- The degraded part: the external run did not return a clean final written review, so this voice is treated as partial evidence, not full consensus.

### CLAUDE PRIMARY REVIEW (CEO — strategy challenge)
- The plan is solving the right problem. Users do not experience "semantic similarity thresholds." They experience the bot saying the same thing over and over. Runtime legality is the lever that changes that outcome.
- The strategic weakness is document staleness. This memo still reads like a proposed architecture decision, but the repository already landed the core change in `fix(agent): enforce single delivery commit per run`.
- The 6-month regret scenario is not choosing Option B. The regret is leaving the doc in a half-future, half-past tense state, so the next engineer cannot tell what remains to be built versus what already shipped.

### CEO DUAL VOICES — CONSENSUS TABLE
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Premises valid?                   Yes     Partial  CONFIRMED
  2. Right problem to solve?           Yes     Partial  CONFIRMED
  3. Scope calibration correct?        Yes     Caution  DISAGREE
  4. Alternatives sufficiently explored?Yes    Partial  CONFIRMED
  5. Competitive/market risks covered? Medium  Medium   CONFIRMED
  6. 6-month trajectory sound?         Medium  Caution  DISAGREE
═══════════════════════════════════════════════════════════════

Notes:
- `Partial` means the Codex outside voice returned usable directional signal but not a complete final writeup.
- Both voices support solving this in runtime semantics, not with smarter dedupe alone.
- The disagreement is not on Option B itself. It is on whether this file still scopes the remaining work cleanly enough now that implementation already landed.

## Error & Rescue Registry
| Failure mode | User-visible effect | Current rescue | Remaining gap |
|---|---|---|---|
| Same run sends same reply again | Bot looks broken and spammy | runtime blocks retry after commit | need clearer doc state and metrics rollup |
| Retry uses near-duplicate wording | duplicate suppression alone would miss it | single-commit runtime now closes speaking tools | verify replay/admin views stay accurate in prod |
| Operator misreads blocked retry as real send | bad debugging decisions | trace spans now mark `tool.blocked_transition` | still need explicit dashboard/operator conventions |

## Failure Modes Registry
| Failure mode | Severity | Status | Comment |
|---|---|---|---|
| Treating delivery finality as prompt-only concern | Critical | Closed in code | runtime state now owns legality |
| Future side-effect tools accidentally inherit one-commit rule | High | Open | memo should say this rule is for speaking delivery, not every future tool |
| Plan/document state drifting from shipped state | High | Open | current active memo still implies core Option B is pending |
| Pre-agent gate scope creep | Medium | Deferred | correctly parked in `TODOS.md` |

## NOT in Scope
- Designing the group-chat pre-agent relevance gate tracked in `TODOS.md`
- Replacing the loop agent with one-shot generation
- Designing a universal side-effect policy framework for every future tool
- Reworking persona or prompt language beyond what is necessary to preserve human group reply quality

## Dream State Delta
- This memo's intended architecture is now largely implemented.
- The remaining delta is narrower:
  - tighten the document so it reflects shipped state
  - decide whether "outbound budget" needs to exist as explicit metadata or stays implicit in `delivery_phase`
  - make operator-facing blocked-transition semantics easy to read and hard to misinterpret

## Completion Summary
| Area | Verdict | Why |
|---|---|---|
| Problem selection | Pass | Runtime legality is the right layer for this bug |
| Scope | Pass with concern | Good isolation from pre-agent gating, but document is stale relative to code |
| Alternatives | Pass | A/B/C framing is clear and correctly favors B |
| Remaining work definition | Needs tightening | "next engineering pass" overstates what is still unbuilt |
| Recommendation | Pass | Option B remains the right architecture |

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | CEO | Use `SELECTIVE_EXPANSION` mode | Mechanical | P1, P2 | The lake is delivery finality plus observability in its blast radius, not adjacent product redesign | Scope reduction |
| 2 | CEO | Accept runtime-semantics root cause premise | Mechanical | P5 | The code and replay evidence both show legality, not wording, is the failure source | Prompt-only mitigation |
| 3 | CEO | Keep Option B as primary architecture | Mechanical | P1, P5 | Single commit closes the harmful action space without fuzzy policy tuning | Stronger dedupe as final architecture |
| 4 | CEO | Defer pre-agent gate | Mechanical | P3, P4 | Different user problem, different data needs, already tracked in `TODOS.md` | Pulling relevance gating into this fix |
| 5 | CEO | Flag document staleness as an open issue | Taste | P6 | The main risk is now plan clarity, not architecture choice | Pretending the plan is fully current |

## Phase 2: Design Review
- Skipped. No UI scope was detected in this memo, and the user-facing design changes here are limited to admin trace semantics already represented through backend payload shape.

## Phase 3: Eng Review

### 0. Scope Challenge
- I read the actual implementation paths in `modules/agent-service/src/services/agent-loop-service.ts`, `modules/agent-service/src/services/runtime-store.ts`, `modules/admin-panel/backend/src/routes/run-routes.ts`, and `modules/admin-panel/backend/src/services/trace-span-builder.ts`.
- The main engineering surprise is not missing implementation. It is that the active plan still frames Option B as future work even though the runtime state machine, persistence fields, blocked-transition logging, and admin API exposure are already in the tree.
- The right engineering question now is smaller: is the shipped implementation coherent, observable, and bounded enough to stop treating this as an active incident plan? My answer is yes, with one caution about future side-effect tools.

### 0.5 Dual Voices

#### CODEX SAYS (eng — architecture challenge)
- Codex eng voice degraded. It did not return a clean final critique within the command window, so I do not claim a full second-review artifact here.
- The usable directional concern remains the same as the CEO pass: keep the one-commit invariant scoped to outbound speaking delivery, not silently generalized to every future side effect.

#### CLAUDE PRIMARY REVIEW (eng — architecture challenge)
- The architecture is sound for the bug at hand. `agent-loop-service` refreshes delivery state before speaking tools, blocks post-commit speaking attempts, persists blocked-attempt counters, and emits explicit blocked-transition timeline events.
- The persistence layer is explicit and boring in the right way. `runtime-store.ts` adds additive columns on `agent_runs`, normalizes readback, and caps `delivery_commit_count` at one instead of building a clever generalized policy framework too early.
- Admin/backend coverage is sufficient for operator debugging. Run detail payloads expose delivery counters, and trace span construction distinguishes `tool.blocked_transition` from a normal invocation, which is exactly the difference an operator needs when triaging "did we send twice?" versus "did the runtime refuse a retry?"

### ENG DUAL VOICES — CONSENSUS TABLE
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Architecture sound?               Yes     Partial  CONFIRMED
  2. Test coverage sufficient?         Yes     N/A      CONFIRMED
  3. Performance risks addressed?      Yes     N/A      CONFIRMED
  4. Security threats covered?         Yes     N/A      CONFIRMED
  5. Error paths handled?              Yes     Partial  CONFIRMED
  6. Deployment risk manageable?       Yes     N/A      CONFIRMED
═══════════════════════════════════════════════════════════════

### 1. Architecture
```text
agent loop
  -> executeAgentTurn()
  -> inspect tool call
  -> runtime-store.getRunDeliveryState()
     -> if reasoning_open
        -> execute speaking tool
        -> runtime-store.markRunDeliveryCommitted()
        -> timeline event: delivery_commit
     -> else
        -> runtime-store.markRunDeliveryBlocked()
        -> timeline event: blocked_transition
  -> run-routes / trace-span-builder expose result to admin operators
```

- Coupling is acceptable. The delivery invariant lives where the side effect happens, then gets projected outward into trace and admin read APIs.
- What would have been bad is hiding this rule in prompt language or dedupe heuristics. The current code does not do that.
- The only forward-looking coupling concern is semantic scope: if later you add non-speaking side-effect tools, you need a fresh policy decision instead of assuming they follow speaking-delivery finality.

### 2. Code Quality
- The implementation is explicit over clever. `delivery_phase`, `delivery_commit_count`, `blocked_delivery_attempt_count`, and `last_blocked_delivery_reason` are plain fields with plain state transitions. Good.
- There is mild duplication between `run-routes.ts` response shaping and the persisted run fields, but this is acceptable duplication. It keeps admin payloads obvious and avoids inventing abstraction scaffolding for four fields.
- No DRY violation here is serious enough to justify refactor churn. The more important thing is that operators see the same semantics everywhere.

### 3. Test Review
- I examined the existing tests in `modules/agent-service/src/__tests__/agent-loop-service.test.ts` and `modules/agent-service/src/__tests__/runtime-store.test.ts`, plus the existing generated eng-review test plan artifacts in `~/.gstack/projects/qq_bot/`.
- Coverage is strong on the core invariant: the store normalizes persisted delivery state, commit count is capped, blocked attempts increment with reason, and the loop request shape remains stable.
- The main residual test gap is not a blocker for this fix. It is broader integration proof that admin API payloads and trace payloads continue to reflect blocked-transition semantics under live data. That is optimization-grade follow-up, not incident-grade missing coverage.

#### Test Diagram
| Flow / branch | Expected coverage | Status |
|---|---|---|
| First speaking tool call commits delivery | unit in `agent-loop-service.test.ts` | Covered |
| Post-commit speaking tool call is blocked | unit in loop service plus blocked result assertions | Covered |
| Persisted delivery state reads back normalized | unit in `runtime-store.test.ts` | Covered |
| Commit count never exceeds one | unit in `runtime-store.test.ts` | Covered |
| Blocked attempt count and reason persist | unit in `runtime-store.test.ts` | Covered |
| Run detail API returns delivery fields | backend route verification via existing QA / follow-up manual checks | Partially covered |
| Trace payload marks blocked transition distinctly | backend service logic inspection, should be regression-tested if this area changes again | Partially covered |

#### Test Plan Artifact
- Wrote artifact: `/home/liahua/.gstack/projects/qq_bot/liahua-refactor-runtime-gateway-autoplan-test-plan-20260331-173000.md`

### 4. Performance
- This change is performance-safe. It adds a small amount of run-state read/write traffic around speaking tool execution, but not a new hot loop of unbounded complexity.
- The biggest practical performance win is indirect: preventing duplicate sends avoids wasted downstream work and operator replay churn.
- No N+1 or cache regression concern stands out in the reviewed codepaths.

### 5. Security / Failure Handling
- There is no obvious new security boundary here. The change narrows legal side effects instead of broadening them.
- Error handling is explicit: blocked retries are logged as blocked transitions with a stable reason, not silently swallowed.
- One open caution remains: if a future product requirement truly needs multiple discrete outbound sends in one run, the team must change the contract intentionally rather than poking holes through this invariant ad hoc.

## Cross-Phase Themes
- Theme: the architecture choice is correct, but the document is stale relative to shipped code. This appeared in both CEO and Eng review.
- Theme: keep the invariant scoped to speaking delivery. Both phases independently flagged the risk of over-generalizing this rule to future side-effect tools.

## Eng Completion Summary
| Area | Verdict | Why |
|---|---|---|
| Architecture | Pass | State machine is explicit, local, and already implemented |
| Tests | Pass with minor follow-up | Core invariant covered; broader backend regression could be added later |
| Observability | Pass | Admin run detail and trace builder already expose blocked-transition semantics |
| Remaining engineering work | Minor | Mostly docs/state cleanup and future policy boundaries, not root-cause repair |

## Pre-Gate Verification
- CEO outputs written: yes
- Design phase handled: yes, skipped for no UI scope
- Eng outputs written: yes
- Test plan artifact written: yes
- Cross-phase themes written: yes
- Decision audit trail non-empty: yes

## $autoplan Final Approval Gate

### Plan Summary
- The active memo picked the right architecture, but the repository has already landed almost all of it.
- The repeated-delivery incident is solved at the runtime layer. What remains is follow-up optimization and documentation cleanup, not core repair.

### Decisions Made: 8 total (6 auto-decided, 1 taste choice, 0 user challenges, 1 premise gate confirmed by user)

### Your Choices
**Choice 1: What to do with this memo now** (from CEO + Eng)
I recommend treating this plan as effectively complete and either archiving it or rewriting it as a post-implementation review memo. Leaving it in `active/` makes the repository look like the duplicate-send root cause is still unresolved, which is no longer true. The alternative is viable if you want to keep an explicit optimization tracker here, but then the file title and decision language should change.

### Auto-Decided: 6 decisions
- See `Decision Audit Trail` above.

### Review Scores
- CEO: Pass with one concern, the problem and architecture are right, but the doc overstates what is still unbuilt.
- CEO Voices: Codex partial, Claude primary pass, Consensus 4/6 confirmed.
- Design: skipped, no UI scope.
- Eng: Pass with one concern, the implementation is coherent and operator-visible.
- Eng Voices: Codex partial, Claude primary pass, Consensus 6/6 confirmed.

### Cross-Phase Themes
- The root-cause architecture is correct and already shipped.
- The remaining risk is document/policy clarity, not the original duplicate-send bug.

### Deferred to TODOS.md
- Group-chat pre-agent relevance gate
- Broader future optimization around delivery budgets / richer side-effect policy only if product requirements change

| 6 | ENG | Treat current runtime fix as sufficient for the original bug | Mechanical | P6 | The user confirmed the problem is solved and the code matches that assessment | Continuing to treat this as unresolved incident repair |
| 7 | ENG | Keep future optimization separate from incident repair | Mechanical | P3 | Optimization later is cleaner than reopening the bug fix scope now | Pulling optimization into the active fix boundary |
| 8 | ENG | Recommend moving this memo out of `active/` after approval | Taste | P2 | The active folder should only hold genuinely unfinished work | Leaving stale active-plan state in place |

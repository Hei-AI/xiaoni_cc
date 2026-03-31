<!-- /autoplan restore point: /home/liahua/.gstack/projects/liahua-qq_bot/refactor-runtime-gateway-autoplan-restore-20260331-180135.md -->
# Group Reply Relevance And Continuity

## Goal
- Add the Stage 2 group reply decision layer for 小腻:
  - nobody explicitly `@` 小腻
  - the system decides whether she should naturally join or stay silent
- Control reply frequency, reply relevance, and short-range continuity before the expensive main loop so the system can decide:
  - which messages are clearly worth replying to
  - which messages should be ignored
  - which messages are ambiguous enough to defer or stay silent on

## Scope
- `modules/provider-service`
- `packages/persistence` only if shared persistence needs new fields
- admin/backend only if operators need visibility or settings for the new gate
- tests and verification for group auto-reply decision behavior

## Stage Model

### Stage 1: Explicit `@` Trigger
- Someone in the group explicitly `@` 小腻, then she is allowed to enter the main path and reply.
- This is the safest boundary and should stay the baseline capability.

### Stage 2: No `@`, But She May Decide To Join
- Nobody explicitly `@` 小腻.
- The system decides whether the current message is sufficiently related to her, to the immediate thread, or to the recent topic that she should enter the main path.
- This stage requires both:
  - a relevance gate
  - a small amount of recent continuity memory

### Stage 3: Fully Proactive Speaking
- 小腻 actively finds something to say and starts or steers the topic herself.
- This is a later product stage and is explicitly out of scope for this plan.

## Constraints
- This is not a second personality engine. The gate must stay simpler and more boring than the main agent.
- The gate should only decide whether a message deserves entry into the main agent loop. It should not try to generate the final reply text itself.
- The gate applies first to group chats. Private chats keep the simpler current behavior unless explicitly expanded later.
- The current runtime path is still `NapCat -> provider-service -> agent-service -> admin/backend/frontend`.
- Existing `auto_reply_enabled` stays the top-level switch, but it is no longer enough by itself.
- This plan targets Stage 2 only. Stage 1 is assumed to remain supported. Stage 3 is explicitly deferred.

## Problem
- Right now group chats with `auto_reply_enabled=1` still send every message into the main agent path.
- That means 小腻 only decides to stay silent after paying the full reasoning cost.
- Product outcome:
  - she feels too eager
  - she feels like she is always on duty
  - she still sounds more bot-like even if the actual wording got better
- Current policy code in `modules/provider-service/src/services/chat-policy-service.ts` only checks whether auto-reply is globally enabled. It does not judge whether this specific message deserves a reply.
- The harder product nuance is that Stage 2 cannot be solved by a pure mention gate:
  - sometimes nobody `@` 小腻, but the next message is obviously continuing her thread
  - sometimes the group is chatting around her, but the message is not really for her
  - sometimes she spoke just now and should shut up even if the current message is weakly related

## What Already Exists
- `modules/provider-service/src/services/chat-policy-service.ts`
  - resolves `is_enabled` and `auto_reply_enabled`, but has no per-message relevance decision
- `modules/provider-service/src/index.ts`
  - `processAutoReply()` currently enqueues whenever the top-level auto-reply policy is allowed
- `modules/agent-service/src/services/agent-loop-service.ts`
  - already has better "say it naturally / stay_silent" guidance once a message reaches the loop
- `TODOS.md`
  - already identifies this as the missing control layer for reply frequency and relevance
- Existing Stage 1 behavior and prompt/tool wording work
  - prior work already improved how 小腻 speaks once she is in the loop
  - what is still missing is deciding whether she should enter the loop at all for Stage 2

## Non-Goals
- Rewriting the main loop runtime
- Solving transcript snapshot materialization in the same pass
- Designing a full long-term memory system or topic graph unless the minimum viable Stage 2 gate proves impossible without it
- Generating the final reply inside the gate
- Building Stage 3 proactive topic-starting behavior

## Open Questions
- What minimum signals are enough for v1:
  - direct mention of 小腻
  - reply-to context
  - recent speaker continuity
  - keyword / name cues
  - recent bot activity cooldown
- What is the minimum "memory" needed for Stage 2:
  - last 1-3 group turns
  - whether 小腻 herself spoke recently
  - who the current thread seems to be addressing
- Should the gate produce a binary decision only, or a small decision record like `reply`, `ignore`, `ambiguous`?
- Do we need per-group settings for aggressiveness, cooldown, or mention-only mode?

## Real-Social Scoring Model

Stage 2 should not be modeled as a single yes/no rule. It should be modeled as a
`participation decision` based on the same kinds of cues humans use in real groups.

### Core Dimensions

1. `addressedness`
- Is this message actually aimed at 小腻
- Strong signals:
  - explicit `@`
  - reply-to her prior message
  - obvious textual continuation of what she just said

2. `social_position`
- Does she have the social right to jump in here
- Proxy signals:
  - is she already part of the current mini-thread
  - does the current speaker often interact with her
  - is she still socially "new" in this group or already treated like a normal participant

3. `interest`
- Is this the kind of thing she would naturally care about enough to respond to
- Proxy signals:
  - similarity to her recurring interest lanes
  - whether this topic historically elicits natural participation from her

4. `timing_frequency`
- Is this the right moment for her to speak
- Signals:
  - did she just speak
  - has she already spoken multiple times in the recent window
  - is the group currently moving too fast for another interjection from her to feel natural

5. `value_add`
- Would her reply add something, or just repeat what is already happening
- Signals:
  - is the point already answered
  - would her participation clarify, continue, or lighten the thread
  - would it instead feel like filler or forced presence

### Why This Matters
- A pure mention gate only solves Stage 1, not Stage 2.
- A pure memory system is also insufficient. Memory can improve "does she understand what this is about," but it does not by itself solve "should she speak right now."
- The human-feeling decision is the combined result of:
  - being addressed enough
  - having enough social right to join
  - actually being interested
  - the timing not being annoying
  - having something worth adding

## Technical Split: Rules vs Embeddings vs LLM

### Rules Layer
- Best for hard boundaries and cheap, high-confidence signals.
- Use rules for:
  - explicit `@`
  - reply-to her message
  - cooldown / recent-speaking suppression
  - group-level top switch (`auto_reply_enabled`)
  - obvious deny states such as "she already spoke too much recently"

### Embedding Layer
- Best for similarity-style features, not final judgment.
- Use embeddings for:
  - `interest_score`
  - `topic_continuity_score`
  - optional speaker-affinity or recurring-topic proximity proxies
- Do not use embeddings as the final authority for "should she speak." They are features, not a policy engine.

### LLM Judge Layer
- Best for the final small social judgment once rules and embedding features are prepared.
- Use a narrow LLM prompt to decide:
  - `reply`
  - `ignore`
  - `ambiguous`
  - plus short reason/confidence
- The LLM judge should not generate the final user-facing reply text. It only decides whether the main loop should be entered.

## Proposed V1 Architecture

### Layer 1: Hard Gate
- Input: current message, inbound context, recent bot activity, direct structural signals
- Output:
  - `allow`
  - `deny`
  - `needs_scoring`

Fast paths:
- `allow`
  - explicit `@`
  - direct reply to her recent message
- `deny`
  - cooldown not expired
  - recent bot participation already too high
  - no relevance signals at all in a busy group

### Layer 2: Feature Scoring
- Run only for `needs_scoring`
- Produce:
  - `addressedness_score`
  - `interest_score`
  - `topic_continuity_score`
  - `social_position_score`
  - `timing_frequency_score`
  - `value_add_proxy_score`

### Layer 3: Small LLM Decision
- Input:
  - current message
  - small recent context window
  - bot's last one or two messages if present
  - the feature scores above
  - cooldown / recent participation summary
- Output:
  - `reply`
  - `ignore`
  - `ambiguous`
  - `reason`
  - `confidence`

Only `reply` enters the main loop.

## Engineering Direction

### Recommended Service Shape
- Keep `ChatPolicyService` as the top-level switch checker.
- Add a new Stage 2 service in `provider-service`, for example:
  - `GroupParticipationService`
- `processAutoReply()` should become:
  - top-level policy check
  - Stage 2 participation decision
  - queue enqueue only when the decision is `reply`

### Minimum Memory For V1
- Not a long-term memory platform.
- Only a short continuity window:
  - recent 1-3 turns in the current group
  - whether 小腻 herself spoke recently
  - recent reply-to / mention / thread linkage

### What We Deliberately Avoid In V1
- Long-term personality memory graph
- Fully proactive topic-starting behavior
- A hidden second agent that reasons as deeply as the main loop
- Unbounded per-group customization complexity

## Steps
- [ ] Audit the current group auto-reply path and define the exact insertion point for the gate.
- [ ] Define the Stage 2 v1 decision model for `reply / ignore / ambiguous` with explicit inputs and failure modes.
- [ ] Define the minimum continuity memory window needed for Stage 2 without turning this into a full memory platform.
- [ ] Define which participation signals are:
  - rule-derived
  - embedding-derived
  - LLM-judged
- [ ] Implement the Stage 2 gate in `provider-service` before queue enqueue.
- [ ] Add cooldown / frequency controls so busy groups do not over-trigger the main agent.
- [ ] Add tests covering:
  - direct @mention -> reply path
  - obvious unrelated chatter -> ignore path
  - ambiguous continuation -> safe default
  - repeated busy-group chatter -> cooldown suppression
- [ ] Add operator visibility so we can inspect why a message was dropped or allowed through.
- [ ] Verify with real or simulated group traffic before archiving.

## Risks
- Too naive: it drops valid opportunities because nobody explicitly @mentioned 小腻.
- Too permissive: it behaves almost the same as today and does not actually reduce over-attention.
- Too smart: it becomes a hidden mini-agent with its own complexity and bugs.
- Poor observability: we cannot tell whether the gate is helping or silently suppressing good replies.
- Wrong stage mixing: Stage 2 quietly grows into Stage 3 proactive behavior and becomes unbounded.

## Progress Log
- 2026-03-31: Created execution plan after clarifying that the priority is reply frequency and relevance control, not further prompt wording tweaks.
- 2026-03-31: Confirmed current policy layer only gates on `auto_reply_enabled` and does not perform per-message relevance decisions.
- 2026-03-31: Reframed the work into three stages:
  - Stage 1: explicit `@`
  - Stage 2: no `@`, but she may join based on relevance + short continuity
  - Stage 3: fully proactive speaking
- 2026-03-31: Expanded Stage 2 framing from simple "gate" logic into a participation-decision model using real-social dimensions: addressedness, social position, interest, timing/frequency, and value-add.
- 2026-03-31: Chose a three-layer technical direction:
  - rules for hard boundaries
  - embeddings for similarity-based features
  - a small LLM judge for final social decision

## Decision Log
- 2026-03-31: Reprioritize this above transcript snapshot materialization because it directly addresses the main product complaint: 小腻 still does not feel human enough in group chats.
- 2026-03-31: Current work target is Stage 2, not Stage 1 and not Stage 3.
- 2026-03-31: Start with a simple pre-loop decision layer in `provider-service` plus minimum continuity memory, not a larger long-term memory platform rewrite.
- 2026-03-31: Memory matters for Stage 2, but it is not the only driver. Trigger boundaries and frequency control remain primary factors.
- 2026-03-31: Embeddings should produce participation features, not final authority. The final decision should remain explainable and policy-bounded.

## Verification
- Pending.

## /autoplan Intake
- Plan file: `docs/exec-plans/active/group-reply-relevance-gate.md`
- Branch: `refactor/runtime-gateway`
- Base branch: `main`
- UI scope: no
- Design doc found: no
- Review mode: `SELECTIVE_EXPANSION`

Plan summary:
- The work is no longer framed as "just a pre-loop gate."
- The plan now follows a 3-stage product model:
  - Stage 1: explicit `@`
  - Stage 2: no `@`, but relevance + short continuity may still justify joining
  - Stage 3: fully proactive speaking
- Current scope is Stage 2 only.

## Phase 1: CEO Review

### 0A. Premise Challenge
- Premise 1: the main product problem is no longer wording quality alone, but reply frequency and reply relevance. I accept this premise. The current system can say nicer things, but still enters the main path too often.
- Premise 2: Stage 2 is the right scope, not Stage 1 and not Stage 3. I accept this strongly. Stage 1 is already the stable baseline, and Stage 3 is a different, much riskier product.
- Premise 3: Stage 2 cannot be solved by pure mention gating. I accept this. If the system only waits for `@`, it will miss natural thread continuations that humans would read as "obviously still talking to her."
- Premise 4: Stage 2 also should not begin as a full memory platform. I accept this. The minimum viable product is short continuity memory, not long-term persona memory or autonomous topic graphs.

### 0B. What Already Exists
| Sub-problem | Existing code | Notes |
|---|---|---|
| Top-level receive / auto-reply switches | `modules/provider-service/src/services/chat-policy-service.ts` | Only global on/off state exists today. |
| Current enqueue path | `modules/provider-service/src/index.ts` | `processAutoReply()` enqueues whenever auto reply is globally allowed. |
| In-loop silence behavior | `modules/agent-service/src/services/agent-loop-service.ts` | Once a message reaches the loop, the model is told to prefer `stay_silent` if replying would be forced. |
| Prior wording/prompt improvements | `modules/agent-service/src/config.ts`, `modules/agent-service/src/services/agent-loop-service.ts` | Helps "how to speak," not "when to speak." |
| Product framing | `TODOS.md` | Already says the missing layer is deciding whether a group message is worth entering the main path. |

### 0C. Dream State Diagram
```text
CURRENT
  group auto_reply_enabled = on
  -> every message enters main loop
  -> 小腻 decides to stay silent only after expensive reasoning
  -> user feels she is always on duty

STAGE 2 TARGET
  group message arrives
  -> cheap relevance + short continuity decision
  -> reply / ignore / ambiguous
  -> only worthy messages enter main loop
  -> user feels 小腻 joins naturally, not mechanically

12-MONTH IDEAL
  Stage 1 explicit @
  -> Stage 2 natural join with short continuity
  -> Stage 3 selective proactive speaking
  -> all three stages have explicit frequency budgets and operator visibility
```

### 0C-bis. Implementation Alternatives
| Approach | Effort | Risk | Pros | Cons |
|---|---|---|---|---|
| A. Pure mention gate | Low | High | Safest and easiest to explain | Not enough for the Stage 2 product goal |
| B. Lightweight relevance gate + short continuity memory | Medium | Low to Medium | Fits Stage 2 exactly, reduces over-attention without opening Stage 3 | Needs careful decision design and observability |
| C. Full memory / proactive behavior platform | High | High | Rich long-term capability | Blurs Stage 2 into Stage 3 and explodes scope |

### 0D. Mode-Specific Analysis
- `SELECTIVE_EXPANSION` is correct. The lake is Stage 2 only.
- I approve expanding scope to include cooldown / recent-bot-activity controls. Reply frequency is part of the user complaint and squarely in blast radius.
- I approve expanding scope to include a tiny continuity window, for example recent 1-3 turns or "did 小腻 just speak." That is still Stage 2, not a big memory system.
- I reject expanding into full proactive topic-starting behavior. That is Stage 3 and would make this plan incoherent.

### 0E. Temporal Interrogation
- Hour 1: if the gate only checks `auto_reply_enabled`, nothing changes. The bot remains too eager.
- Hour 6: if the gate becomes too strict and only respects explicit `@`, the product regresses back to Stage 1 and misses the point of this work.
- One week later: if there is no cooldown / recent-speaking check, busy groups will still feel spammy even if relevance logic gets smarter.
- Six months later: the regret is either underbuilding and shipping Stage 1.5, or overbuilding and accidentally creating a hidden Stage 3 proactive engine without clear controls.

### 0F. Mode Selection Confirmation
- Confirmed mode: `SELECTIVE_EXPANSION`
- Why: the right move is to finish a coherent Stage 2, not collapse downward to pure mention-gating and not expand upward to proactive autonomy.

### CODEX SAYS (CEO — strategy challenge)
- No Codex outside voice has been run yet for this pass.

### CLAUDE PRIMARY REVIEW (CEO — strategy challenge)
- The product framing is finally correct. The real problem is "why is she always entering the conversation," not "can we make her final sentence 10% more human."
- The 3-stage model is strong because it prevents scope confusion. That is the difference between a product roadmap and a blob of related desires.
- The critical move is refusing the false binary of `gate` versus `memory`. Stage 2 needs both, but only in small, disciplined amounts.

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
| Every message enters loop | 小腻 feels too eager | in-loop `stay_silent` only after full reasoning | need pre-loop decision layer |
| Gate is too strict | misses natural thread continuations | explicit `@` still works | need short continuity signals |
| Gate is too loose | still over-participates in busy groups | none today | need cooldown / recent-speaking controls |

### Failure Modes Registry
| Failure mode | Severity | Status | Comment |
|---|---|---|---|
| Treating Stage 2 as pure mention-gating | High | Open | would not solve the actual user complaint |
| Treating Stage 2 as a full memory platform | High | Open | too much scope, wrong stage |
| No visibility into why messages were dropped or allowed | High | Open | product debugging will be guesswork |
| Reply frequency still unmanaged after launch | Critical | Open | this is the complaint, not a detail |

### NOT in Scope
- Rewriting Stage 1 explicit `@` behavior
- Building Stage 3 proactive topic-starting behavior
- Long-term memory / personality platform work
- Transcript snapshot materialization

### Dream State Delta
- The repository has the speaking layer.
- It does not yet have the joining layer.
- This plan's job is to add that joining layer for Stage 2, with just enough continuity to behave plausibly.

### Completion Summary
| Area | Verdict | Why |
|---|---|---|
| Problem selection | Pass | This is the right top product issue now |
| Scope | Pass | Stage 2 framing is precise and defensible |
| Alternatives | Pass | B is clearly the right shape |
| Remaining work definition | Pass with concern | needs sharper v1 signal set and observability plan |
| Recommendation | Pass | proceed with Stage 2, not Stage 1 fallback and not Stage 3 expansion |

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | CEO | Prioritize Stage 2 over snapshot work | Mechanical | P1 | Directly addresses the main user complaint about 小腻 not feeling human enough | Infrastructure optimization first |
| 2 | CEO | Lock scope to Stage 2 only | Mechanical | P2, P3 | Prevents mixing explicit-trigger and proactive behavior into one blob | Folding in Stage 1 or Stage 3 |
| 3 | CEO | Choose lightweight gate + short continuity as the target shape | Mechanical | P1, P5 | This is the smallest complete version that actually matches the product goal | Pure mention gate or full memory platform |
| 4 | CEO | Include cooldown / recent-speaking controls in blast radius | Mechanical | P2 | Reply frequency is central to the complaint and cannot be treated as optional polish | Relevance-only without frequency controls |
| 5 | ENG | Keep Stage 2 in `provider-service` before queue enqueue | Mechanical | P5 | Cheapest, clearest place to control participation | Doing this inside main loop |
| 6 | ENG | Split top-level switch and per-message decision into separate services | Mechanical | P5 | Keeps `ChatPolicyService` simple and Stage 2 logic contained | One oversized policy god-object |
| 7 | ENG | Use embeddings only as feature input | Mechanical | P3, P5 | Similarity helps, but should not become the final authority | Embedding-only policy engine |
| 8 | ENG | Make the LLM judge decide entry only, not content | Mechanical | P5 | Avoids building a second agent | Letting the judge draft the reply |
| 9 | ENG | Prefer conservative fallback on judge/embedding failure | Mechanical | P1 | Under-participation is safer than over-participation | Silent drift into over-eager behavior |

**Phase 1 complete.** Codex: 0 concerns recorded in this pass. Claude primary review: 4 strategic constraints locked. Consensus: single-reviewer mode, no disagreements surfaced. Passing to Phase 2.

## Phase 2: Design Review
- Skipped. No UI scope is in the core plan. If operator visibility later requires admin surfaces, that should be reviewed as a small follow-up UI slice, not as the main product problem here.

**Phase 2 complete.** Skipped, no UI scope. Passing to Phase 3.

## Phase 3: Eng Review

### 0. Scope Challenge
- I examined the current Stage 2 insertion point in `modules/provider-service/src/index.ts`, the current top-level policy checker in `modules/provider-service/src/services/chat-policy-service.ts`, and the existing embedding integration path in `modules/provider-service/src/services/embedding-service.ts`.
- The scope is well placed in `provider-service`. This is where incoming group messages are normalized and either enqueued or dropped. If Stage 2 lives anywhere else, you either waste main-loop cost or split the decision across too many services.
- The key engineering challenge is not "can we build this." It is "can we keep it boring enough that Stage 2 does not become an invisible second agent." That means rule-first, features-second, LLM-last.

### 0.5 Dual Voices

#### CODEX SAYS (eng — architecture challenge)
- No Codex outside voice has been run yet for this pass.

#### CLAUDE PRIMARY REVIEW (eng — architecture challenge)
- The service boundary is clear: keep the top switch in `ChatPolicyService`, add a new Stage 2 participation service, and let `processAutoReply()` orchestrate the sequence.
- Embeddings are already available in-repo, but should be treated as feature generators, not a policy oracle. The provider stack already exposes `/v1/embeddings`, so reusing that capability is cleaner than inventing a new similarity subsystem.
- The biggest hidden complexity risk is observability. If the Stage 2 judge starts dropping messages without a reason trace, product debugging becomes impossible and every complaint turns into mythology.

### ENG DUAL VOICES — CONSENSUS TABLE
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Architecture sound?               Yes     N/A     CONFIRMED
  2. Test coverage sufficient?         Medium  N/A     CONFIRMED
  3. Performance risks addressed?      Yes     N/A     CONFIRMED
  4. Security threats covered?         Medium  N/A     CONFIRMED
  5. Error paths handled?              Medium  N/A     CONFIRMED
  6. Deployment risk manageable?       Medium  N/A     CONFIRMED
═══════════════════════════════════════════════════════════════

### 1. Architecture
```text
incoming group message
  -> ChatPolicyService: top-level allow?
  -> GroupParticipationService:
       Layer 1 rules
         -> allow / deny / needs_scoring
       Layer 2 embedding features
         -> interest / continuity / proxy scores
       Layer 3 small LLM judge
         -> reply / ignore / ambiguous
  -> if reply
       enqueue into main agent loop
     else
       drop with operator-visible decision reason
```

- This is the right boundary because it keeps Stage 2 before queue enqueue, which is exactly where cost and over-attention are decided.
- `GroupParticipationService` should be a new service, not an expansion of `ChatPolicyService`. `ChatPolicyService` owns top-level on/off policy. Stage 2 owns message-level participation judgment.
- The LLM judge must be narrow. It decides entry, not content. If it starts writing the reply, you have built a second agent.

### 2. Code Quality / Data Flow
- Keep the data flow explicit:
  - structural signals from inbound context
  - recent participation statistics
  - embedding-derived features
  - LLM judgment only for undecided cases
- Avoid clever hidden state. If the system needs "did 小腻 speak recently," store or compute that directly from recent group activity, not via opaque model memory.
- Operator visibility should carry the decision record, for example:
  - `decision = reply|ignore|ambiguous`
  - `reason = cooldown|explicit_mention|low_interest|weak_social_position`
  - `scores = ...`

### 3. Test Review
- This plan needs stronger testing than the current Stage 1 switch path because Stage 2 is probabilistic-looking even if the architecture is deterministic.
- The test strategy should separate:
  - pure rule-path tests
  - embedding feature tests
  - LLM judge contract tests with fixed inputs/expected classes
  - end-to-end provider enqueue/drop decisions
- The most important engineering protection is safe degradation:
  - if embeddings are unavailable, do not start replying more
  - if the LLM judge fails, default to conservative behavior rather than accidental over-participation

#### Test Diagram
| Flow / branch | Expected coverage | Status |
|---|---|---|
| Explicit `@` -> allow | deterministic unit/integration | Required |
| Cooldown active -> deny | deterministic unit | Required |
| No `@`, strong continuity -> needs scoring -> reply | feature + judge contract | Required |
| No `@`, low relevance -> ignore | feature + judge contract | Required |
| Embedding unavailable -> safe conservative path | integration / failure-path test | Required |
| LLM judge timeout/error -> safe conservative path | integration / failure-path test | Required |
| Decision reason exposed to operators | route/service verification | Required |

#### Test Plan Artifact
- Wrote artifact: `/home/liahua/.gstack/projects/qq_bot/liahua-refactor-runtime-gateway-stage2-participation-test-plan-20260331-181000.md`

### 4. Performance
- Performance is manageable if the layers are ordered correctly.
- Rule checks are cheap and should eliminate a large portion of traffic before any model call.
- Embeddings are acceptable as a feature layer, but only if reused selectively and not computed for messages that rules already deny. The LLM judge must be the rarest and last step.
- If the LLM judge runs on every group message, the design failed.

### 5. Security / Failure Handling
- This feature does not primarily add security risk, but it does add product-risk from silent behavioral drift.
- Failure handling must prefer under-participation over over-participation. A quiet bot is recoverable. A bot that barges into everything destroys trust fast.
- Keep the judge prompt narrow and policy-bounded. The system should never allow a malformed judge output to bypass hard deny conditions like cooldown or explicit operator-disabled state.

## Cross-Phase Themes
- Theme: Stage 2 is neither pure gating nor pure memory. Both CEO and Eng framing converge on a layered participation-decision model.
- Theme: frequency control is not optional. It is one of the main product levers, not a nice-to-have after relevance scoring.
- Theme: observability is part of the feature. If the system cannot explain why it spoke or stayed silent, debugging and tuning will stall.

## Eng Completion Summary
| Area | Verdict | Why |
|---|---|---|
| Architecture | Pass | Clear service boundary and ordered decision layers |
| Tests | Pass with concern | Needs explicit failure-path coverage for embeddings and LLM judge |
| Performance | Pass | Safe if rule-first and LLM-last |
| Reliability | Pass with concern | Requires operator-visible decision logs and conservative fallback behavior |

## Pre-Gate Verification
- Phase 1 outputs: present
  - premise challenge
  - existing code leverage map
  - dream state and alternatives
  - error & rescue registry
  - failure modes registry
  - not-in-scope section
  - completion summary
- Phase 2 outputs: skipped intentionally, no UI scope
- Phase 3 outputs: present
  - code-backed scope challenge
  - architecture ASCII diagram
  - test diagram
  - test-plan artifact at `/home/liahua/.gstack/projects/qq_bot/liahua-refactor-runtime-gateway-stage2-participation-test-plan-20260331-181000.md`
  - failure handling and completion summary
- Cross-phase themes: present
- Audit trail: present with 9 decisions

**Phase 3 complete.** Codex: 0 concerns recorded in this pass. Claude primary review: 3 implementation cautions. Consensus: single-reviewer mode, no disagreements surfaced. Ready for final approval gate.

## /autoplan Final Approval Gate

### Plan Summary
- Stage 2 is now well-defined as a participation-decision system, not a vague "make her more human" blob.
- The right architecture is rule-first, embedding-assisted, LLM-judged only at the edge, with cooldown and observability built in.

### Decisions Made: 9 total (9 auto-decided, 0 taste choices, 0 user challenges)

### Auto-Decided: 9 decisions
- See `Decision Audit Trail` above.

### Review Scores
- CEO: Pass, the product problem and stage boundary are now correct.
- CEO Voices: Claude primary pass, Codex not yet run, Consensus treated as single-reviewer.
- Design: skipped, no UI scope.
- Eng: Pass with concerns, mainly around safe degradation and operator visibility.
- Eng Voices: Claude primary pass, Codex not yet run, Consensus treated as single-reviewer.

### Cross-Phase Themes
- Stage 2 must combine relevance, continuity, frequency, and social-position proxies.
- Memory matters, but it is not the only or even primary lever.
- Operator-visible decision reasons are part of the shipping requirement.

### Deferred to TODOs / Later Stages
- Long-term memory platform work
- Stage 3 proactive topic-starting behavior
- Transcript snapshot materialization

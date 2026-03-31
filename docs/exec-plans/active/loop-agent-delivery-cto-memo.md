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

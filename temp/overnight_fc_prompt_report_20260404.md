# Overnight FC Prompt Report - 2026-04-04

## Scope

This report covers the overnight work on:

- main agent FC-first prompt structure
- long-context/memory tool integration
- compact semantics tightening
- prompt cache observability
- one live end-to-end verification run in group `253631878`

## What Changed

### agent-service

- Added read tools:
  - `build_memory_rag_context`
  - `retrieve_memory_hints`
- Main agent no longer default-inlines conversation summary, relationship memory, and self evolution into the initial prompt.
- Dynamic per-turn constraints were moved out of `instructions` and into a runtime guidance input message.
- Canonical agent request now includes `prompt_cache_retention: "24h"` by default.

Relevant files:

- `modules/agent-service/src/services/agent-loop-service.ts`
- `modules/agent-service/src/services/runtime-store.ts`
- `modules/agent-service/src/config.ts`
- `modules/agent-service/src/__tests__/agent-loop-service.test.ts`

### provider-service

- Relationship memory and self-evolution refresh payloads now carry:
  - `summary_text`
  - `transcript_compact_offset`
  - `compact_role: "bridge_material"`
- Executor prompts now treat compact output as bridge material rather than primary narrative.

Relevant files:

- `modules/provider-service/src/services/relationship-memory-service.ts`
- `modules/provider-service/src/services/self-evolution-service.ts`
- `modules/provider-service/src/services/relationship-memory-executor-service.ts`
- `modules/provider-service/src/services/self-evolution-executor-service.ts`

### diagnostics

- Added `scripts/debugging/analysis/inspect_llm_call_cache.js`
- Added `scripts/debugging/analysis/preview_agent_canonical_request.js`

## Live Verification

### Simulated inbound message

Provider simulation endpoint:

- `POST /api/simple-queue/simulate/group`

Message used:

- group: `253631878`
- user: `99887766`
- text: `@小腻 你还在吗`

Observed provider result:

- accepted: `true`
- autoReply attempted: `true`
- queued: `true`
- queue id: `195`

### Queue and run status

Observed `agent_queue_messages` row:

- id: `195`
- trace_id: `runtrace_1775239078177_5083e30b`
- run_id: `run_1775239078177_d9886245`
- status: `completed`
- locked_by: `agent-service-1`

Observed `agent_runs` row:

- id: `run_1775239078177_d9886245`
- status: `completed`
- delivery_phase: `finished`

### LLM call evidence

For trace `runtrace_1775239078177_5083e30b`, the main agent call was persisted with:

- model: `gpt-5.4-mini`
- prompt cache key: `qq:group:253631878`
- prompt cache retention: `24h`
- tool count: `4`
- instructions estimated tokens: `520`
- input tokens: `39528`
- cached input tokens: `39040`
- cache hit rate: `0.988`

The main agent did not call the new read tools on this simple explicit-cue turn. It went straight to:

- `speak_in_group`

Delivered content:

- `在，刚看到你这条。`

This is the desired behavior for a trivial mention-receipt scene.

### Supporting non-main calls on the same trace

Two auxiliary calls still ran before the main agent:

- `pre_reply_memory_gate` on `gpt-5.4`
- `present_self_reconstruction` on `gpt-5.4`

That confirms:

- the new main agent prompt structure is active
- the old cheap/auxiliary decision chain is still in place
- the main agent FC flow is compatible with current upstream selectors

## Prompt Structure Findings

### Confirmed good

- Stable `instructions`
- Stable tool schema block
- Dynamic guidance moved into `input`
- `prompt_cache_retention` now present on live main-agent requests
- Very high cache reuse on repeated same-session turns

### Confirmed behavior from the live request

- Group-mode tool set was:
  - `build_memory_rag_context`
  - `retrieve_memory_hints`
  - `speak_in_group`
  - `stay_silent`
- `tool_choice` remained `required`
- On a simple direct cue, the model correctly skipped memory retrieval and replied directly

## Tests And Runtime Validation

### Tests

- `modules/agent-service`: `39/39` passed
- `modules/provider-service`: `60/60` passed

### Compose validation

Completed for changed services:

- `docker compose build agent-service`
- `docker compose up -d agent-service`
- `docker compose ps agent-service`
- `docker compose logs --tail=... agent-service`
- `docker compose build provider-service`
- `docker compose up -d provider-service`
- `docker compose ps provider-service`
- `docker compose logs --tail=... provider-service`

Both services were healthy after restart.

## Remaining Risks

### 1. The identity/system preamble is still large

The main agent `instructions` block is much more stable now, but it is still long because it includes the large world/identity preamble. This is acceptable for now because cache hit is high, but it remains the main place to trim later if we want lower uncached first-turn cost.

### 2. Auxiliary selectors still carry memory in their own prompts

`pre_reply_memory_gate` and `present_self_reconstruction` are still separate upstream calls and still receive relationship/summary material directly. That is not broken, but it means the full system is not yet "tool-driven everywhere". Current status is mixed architecture:

- main agent: FC-first
- upstream selectors: pre-FC

### 3. Deprecation warnings from DB adapter

Diagnostic scripts and services print:

- `Calling client.query() when the client is already executing a query is deprecated`

This did not block the overnight work, but it is worth cleaning later.

## Final State

By the end of the overnight run:

- FC-first main agent path is live
- live requests now persist `prompt_cache_retention: "24h"`
- prompt structure matches the intended `stable instructions + stable tools + volatile input` shape
- provider compact semantics are tightened to bridge-material usage
- one real group run in `253631878` completed successfully end to end


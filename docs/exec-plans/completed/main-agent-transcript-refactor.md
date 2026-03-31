# Main Agent Transcript Refactor

## Goal
- Refactor the main chat agent so batch windows, send-tool deliveries, and future-run replay use a stable structured transcript model.

## Scope
- `modules/agent-service`
- `database/postgres/init.sql`
- `packages/persistence/prisma/schema.prisma`

## Constraints
- Keep `Responses API + full replay + prompt_cache_key=sessionKey`.
- Do not use `previous_response_id`.
- Main agent must require a tool on every turn.
- Same-run send state should replay through `function_call_output`, not duplicated assistant text.
- Cross-run assistant history must come from delivered send text, not model-internal final text.

## Steps
- [x] Add transcript item persistence for batch-based user/assistant history.
- [x] Update runtime store read/write paths to use structured transcript items with legacy fallback.
- [x] Update agent loop request contract and replay behavior for main agent.
- [x] Add/refresh tests for transcript persistence, replay, and request parameters.
- [x] Run service tests and compose verification, then archive this plan.

## Progress Log
- 2026-03-29: Created execution plan and started implementation after finalizing batch-based transcript design.
- 2026-03-30: Implemented structured `conversation_items`, switched same-run send replay to `function_call_output` only, persisted delivered assistant transcript with runtime phase, and updated provider input passthrough for assistant `phase`.
- 2026-03-30: Verified with `npm --prefix modules/agent-service test`, `npm --prefix modules/provider-service test`, `docker compose build agent-service provider-service`, `docker compose up -d agent-service provider-service`, `docker compose ps`, and service logs.
- 2026-03-30: Re-opened verification loop to add live multi-run simple-queue simulations against the real compose stack, focusing on same-run `function_call_output` replay and cross-run cache continuity on a stable `sessionKey`.
- 2026-03-30: Ran five real `/api/simple-queue/simulate/private` executions on `qq:direct:1129974489:1129974489`. All five runs completed in two turns, persisted `conversation_items` as one user item plus one delivered assistant item per conversation, and preserved `phase=final_answer` on the delivered assistant transcript row.
- 2026-03-30: Verified runtime/input shape in PostgreSQL. Turn 1 of each run replayed transcript-only messages; turn 2 appended exactly one `function_call` and one `function_call_output`, with no duplicated assistant send text in the same-run continuation.
- 2026-03-30: Verified cache behavior across the five live runs. `cached_input_tokens` on turn 2 was stable at `4224/4224/4224/4224/4224`; turn 1 hit `4224` on runs 2, 4, and 5, and missed on runs 1 and 3, which is consistent with prefix-cache routing variability rather than transcript-shape drift.
- 2026-03-30: Deleted local analysis artifacts under `tmp/codex-cli-multiturn-chain/` and `tmp/codex-cli-multiturn-sample/` after finishing the replay/cache comparison, keeping the execution plan as the durable repository record.

## Decision Log
- Store transcript at the batch/run boundary, not per single user/assistant pair.
- Same-run send results remain visible to the model only via `function_call_output`.
- Cross-run replay uses persisted delivered assistant transcript items with runtime-assigned phase.

## Verification
- `npm --prefix modules/agent-service test`
- `npm --prefix modules/provider-service test`
- `docker compose build agent-service provider-service`
- `docker compose up -d agent-service provider-service`
- `docker compose ps agent-service provider-service`
- `docker compose logs --tail=80 agent-service provider-service`
- Live multi-run verification:
  - Five `POST /api/simple-queue/simulate/private` runs on `user_id=1129974489`
  - Agent runs:
    - `run_1774800746715_2e965c58` / `runtrace_1774800746715_978f4bb3`
    - `run_1774800762366_e97288d6` / `runtrace_1774800762366_b63a43c1`
    - `run_1774800768715_2672d3d3` / `runtrace_1774800768715_dc4663f5`
    - `run_1774800835354_c110824d` / `runtrace_1774800835354_e3571461`
    - `run_1774800842217_294087f7` / `runtrace_1774800842217_6efc46f7`
  - PostgreSQL verification:
    - `conversation_items` stores one `role=user` inbound batch item and one delivered `role=assistant` item per conversation, with `phase=final_answer`
    - turn-1 `canonical_request.input` remains transcript-only
    - turn-2 `canonical_request.input` ends with one `function_call` and one `function_call_output`
    - `cached_input_tokens` observed:
      - run 1: `0`, `4224`
      - run 2: `4224`, `4224`
      - run 3: `0`, `4224`
      - run 4: `4224`, `4224`
      - run 5: `4224`, `4224`

# Response Chain And Cache Anchor

## Goal
- Replace unstable sliding-window replay in the agent loop with a fixed-anchor stateless replay strategy.
- Reuse transcript compaction snapshots so replay starts from a fixed summarized anchor instead of a floating recent-N window.
- Keep the runtime append-only: summary memory first, then every conversation after the anchor, then the current turn.

## Scope
- `modules/agent-service`
- `modules/provider-service`
- runtime persistence reads needed to load response anchors and transcript snapshots
- tests and live verification for QQ private-chat agent runs

## Constraints
- Do not regress the current tool-call semantics:
  - `send_*` must surface as assistant dialogue state in the next turn
  - `finish` ends the run without replaying tool payload into the next turn
- Reuse existing transcript snapshot data (`summarized_through_conversation_id`) instead of inventing a second compaction marker.
- Sessions without a ready snapshot must still replay correctly from the beginning of the session.

## Steps
- [x] Create an agent-session replay loader that reads the latest ready transcript snapshot for a session.
- [x] Refactor agent-loop turn input assembly to use stateless replay only:
  - prepend fixed summary memory when available
  - replay every conversation after `summarized_through_conversation_id`
  - append the current turn
- [x] Remove runtime `previous_response_id` continuation logic from `agent-service`.
- [ ] Add tests covering:
  - no `previous_response_id` in canonical requests
  - transcript-anchor stateless replay
  - assistant-send continuation semantics
- [x] Rebuild and redeploy affected services, then verify with live QQ simulations and cache observations.
- [ ] Enable or implement snapshot compaction production flow so fixed anchors are actually materialized in `chat_transcript_snapshots`.

## Progress Log
- 2026-03-29: Investigated cache instability on `qq:direct:1129974489:85178516`. Confirmed it is caused by `listRecentTurns()` replaying a floating last-20-conversation window; the effective prompt head shifted from conversation `id=10` to `id=11` and then `id=13`, which invalidated prefix cache continuity.
- 2026-03-29: Confirmed repository already has transcript compaction state in `chat_transcript_snapshots`, including `summary_text` and `summarized_through_conversation_id`, but `agent-service` does not currently consume it.
- 2026-03-29: Implemented stateless fixed-anchor replay in `agent-service`. The service now consumes `summary_text` and `summarized_through_conversation_id`, replays all conversations after the anchor, and never emits `previous_response_id`.
- 2026-03-29: Live verification on `qq:direct:1129974489:85178516` showed `canonical_request.input` starts with the earliest conversation in-session and ends with the current turn, with `cached_input_tokens=1664` and no `previous_response_id`.
- 2026-03-29: Confirmed `chat_transcript_snapshots` currently has `0` rows in this environment, so the replay anchor is presently the start of the session until compaction is wired up.
- 2026-03-29: Added per-chat `transcript_compact_offset` configuration for both private chats and groups in admin backend/frontend, defaulting to `6`, with provider-side transcript compaction logic reading the same setting.

## Decision Log
- 2026-03-29: Rejected `previous_response_id` for the active runtime path after live Codex verification showed `chatgpt.com/backend-api/codex/responses` rejects the parameter.
- 2026-03-29: Reuse `chat_transcript_snapshots.summarized_through_conversation_id` as the fixed replay anchor for fallback rebuilds.
- 2026-03-29: Replay semantics are not “recent N turns”; they are “all conversations after the fixed anchor”.

## Verification
- `npm --prefix modules/agent-service test`
- `npm --prefix modules/agent-service run build`
- `docker compose build agent-service`
- `docker compose up -d agent-service`
- `docker compose ps agent-service`
- `curl http://127.0.0.1:8092/health`
- `POST /api/simple-queue/simulate/private` for `user_id=85178516`
- PostgreSQL verification on `runtrace_1774725030500_f5374ed7`:
  - `previous_response_id` absent from `canonical_request`
  - `cached_input_tokens=1664`
  - `canonical_request.input[0]` is the earliest session turn
  - `canonical_request.input[-1]` is the current inbound turn
- Admin offset verification:
  - `POST /api/private-chats` and `POST /api/group-chats` create rows with `transcript_compact_offset=6`
  - `PUT /api/private-chats/99000001/settings` with `9` and `PUT /api/group-chats/99000002/settings` with `12` both persisted successfully

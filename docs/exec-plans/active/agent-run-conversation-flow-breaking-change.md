# Agent Run Conversation Flow Breaking Change

## Goal
- Replace the current conversation trace experience with an agent-run workspace.
- Change runtime semantics from single-message queue execution to batched session messages per agent run.
- Remove old conversation timeline page/API compatibility instead of layering adapters.

## Scope
- `modules/provider-service`
- `modules/agent-service`
- `modules/admin-panel/backend`
- `modules/admin-panel/frontend`
- `packages/persistence`
- `docs/exec-plans/active/agent-run-conversation-flow-breaking-change.md`

## Constraints
- This is an intentional breaking change.
- No compatibility wrapper for old conversation timeline APIs or pages.
- Shared PostgreSQL writes must stay inside persistence-backed service layers.

## Steps
- [ ] Add batch/run persistence and queue aggregation semantics.
- [ ] Update agent execution to consume batched run payloads and persist run outcomes.
- [ ] Add run-centric admin APIs and remove old conversation timeline page contracts.
- [ ] Replace frontend conversation pages/routes/navigation with run-centric workspace.
- [ ] Unify Trace import and Playground debug to use the backend's internal common provider parameter contract instead of a Playground-only provider config shape.
- [ ] Build/test touched modules and document final verification.

## Progress Log
- 2026-03-27: Created execution plan and confirmed the current implementation still executes one queue message at a time, while the admin page is centered on trace/span inspection instead of agent-run reasoning.
- 2026-03-27: Added run-centric queue semantics: provider-service now delays queue availability by a batch window, and agent-service now claims all ready messages for one session into a single `batch + run`.
- 2026-03-27: Added `agent_message_batches`, `agent_message_batch_items`, and `agent_runs` schema management in provider/agent services and persisted run termination fields including `termination_reason`, `finish_reason`, `finish_outcome`, and `no_reply`.
- 2026-03-27: Added admin backend `/api/runs/*` routes and replaced the frontend `/conversations` page with a run workspace. Removed the old frontend conversation timeline route and hooks.
- 2026-03-27: Verified builds for `modules/agent-service`, `modules/provider-service`, `modules/admin-panel/backend`, and `modules/admin-panel/frontend`.
- 2026-03-28: Confirmed the current Trace -> Playground import and Playground debug flow still use a Playground-specific provider config shape, while provider-service debug uses the internal common provider parameter contract (`model_config` + `advanced_config` / unified config override). Added a follow-up work item to remove this split.

## Decision Log
- 2026-03-27: Treat the redesign as a breaking change. Delete the old conversation timeline UX and API shape instead of preserving migration compatibility.
- 2026-03-27: Make `session -> agent run -> input batch -> outcome -> trace` the only supported mental model for the admin flow page.
- 2026-03-27: Use queue `available_at` as the batching boundary instead of introducing a separate scheduler service in this pass. Provider still enqueues one row per inbound message, but agent-service claims all ready rows for the same session as one run.
- 2026-03-28: Treat the provider parameter model split as a bug. Trace import, Playground persistence, and Playground debug execution must all use the backend/provider-service common provider parameter contract rather than a separate Playground-only shape.

## Verification
- `modules/agent-service`: `npm run build`
- `modules/provider-service`: `npm run build`
- `modules/admin-panel/backend`: `npm run build`
- `modules/admin-panel/frontend`: `npm run build`

# East8 Timezone Cutover

## Goal
- Unify the active runtime chain on East8 semantics for new data.
- Fix trace and active admin surfaces so they no longer mix UTC-shifted and East8-rendered timestamps.

## Scope
- `packages/persistence`
- `modules/provider-service`
- `modules/agent-service`
- `modules/admin-panel/backend`
- `modules/admin-panel/frontend`
- `docker-compose.yml`

## Constraints
- Do not rewrite historical rows.
- Do not add old-data compatibility logic in this round.
- Do not rely on `timestamp without time zone` driver defaults.
- Keep raw evidence payloads unchanged; normalize typed timestamp fields and UI rendering only.

## Steps
- [x] Add shared East8 timestamp utilities in persistence.
- [x] Update SQL adapter parsing and timestamp parameter serialization.
- [x] Update active services and backend routes to use shared East8-aware helpers.
- [x] Sweep active frontend views to use one timestamp formatter.
- [x] Set runtime timezone config in compose and Dockerfiles.
- [x] Rebuild, restart, and verify active services.
- [x] Archive this plan with final verification notes.

## Progress Log
- 2026-03-28: Confirmed root cause is mixed handling of PostgreSQL `timestamp without time zone` across UTC and Asia/Shanghai runtimes. Verified a real trace where the same run appears eight hours apart between queue/run rows and trace payload output.
- 2026-03-28: Confirmed current container timezone split: `provider-service`, `agent-service`, and `postgres` run at `+00:00`, while `admin-backend` already runs at `+08:00`.
- 2026-03-28: Implemented shared East8 parsing/serialization in `packages/persistence`, updated trace/runtime readers and active frontend formatters to stop mixing browser-local and UTC output.
- 2026-03-28: Updated Dockerfiles and `docker-compose.yml` so rebuilt active services and postgres start with `Asia/Shanghai` timezone settings.

## Decision Log
- 2026-03-28: Chosen rollout is "new data uses East8 storage semantics" with no historical backfill.
- 2026-03-28: After user clarification, old data handling is explicitly out of scope; the rollout only guarantees East8 semantics for new writes and active UI/API formatting.

## Verification
- 2026-03-28: `npm --prefix modules/admin-panel/frontend run build` succeeded.
- 2026-03-28: `npm --prefix modules/admin-panel/backend run build` succeeded.
- 2026-03-28: `npm --prefix modules/provider-service run build` succeeded.
- 2026-03-28: `npm --prefix modules/agent-service run build` succeeded.
- 2026-03-28: `docker compose build provider-service agent-service admin-backend admin-frontend` succeeded.
- 2026-03-28: `docker compose up -d postgres provider-service agent-service admin-backend admin-frontend` succeeded.
- 2026-03-28: `docker compose ps` showed rebuilt active services up and healthy; postgres reached healthy shortly after restart.
- 2026-03-28: `docker exec qqbot-postgres/provider-service/agent-service/admin-backend/admin-frontend date -Iseconds` all returned `+08:00`.
- 2026-03-28: `docker exec qqbot-postgres psql -U qqbot_user -d qqbot_db -Atc "SHOW timezone; SELECT NOW()::text;"` returned `Asia/Shanghai` and a `+08` timestamp.
- 2026-03-28: `curl http://127.0.0.1:9080/api/runs/run_1774703209080_46c2eaf4/trace` returned East8 business timestamps such as `started_at: 2026-03-28T13:06:44.098+08:00`, `request_timestamp: 2026-03-28T13:06:53.018+08:00`, and queue/LLM timestamps aligned on `+08:00`.

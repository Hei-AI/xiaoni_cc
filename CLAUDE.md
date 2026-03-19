# CLAUDE.md

This repository contains the reduced QQ Bot main stack.

## 1. Active Services

- `qqbot-core`: message ingestion, queueing, AI orchestration, outbound send
- `admin-panel/backend`: operator API, prompt config, queue ops, traffic/log/status
- `admin-panel/frontend`: operator UI
- `mysql`: persistence
- `docker-compose.napcat.yml`: external NapCat deployment entrypoint

Removed from the main repo architecture:

- `http-api`
- `queue-monitor`
- `openclaw-bridge`

`openclaw-bridge` now lives in a separate project and is not maintained here.

## 2. Working Model

Main runtime path:

```text
NapCat -> qqbot-core -> MySQL
                  \
                   -> admin-backend -> admin-frontend
```

Important notes:

- Prompt management is DB-backed through admin APIs.
- Queue operations proxy from admin-backend into `qqbot-core /api/simple-queue/*`.
- HTTP traffic capture/replay is an admin-side tooling capability driven by `modules/http-traffic-monitor`.

## 3. Commands

```bash
docker compose build
docker compose up -d
docker compose ps

docker compose logs -f qqbot-qqbot-core
docker compose logs -f qqbot-admin-backend

python3 scripts/start_modules.py start
python3 scripts/start_modules.py status
```

NapCat:

```bash
docker compose -f docker-compose.napcat.yml up -d
```

## 4. Data & Runtime Assets

- Keep local runtime data out of git: logs, MySQL data dirs, NapCat data dirs, IDE files, local `.env`.
- Database migrations live under `database/migrations/`.
- Prompt data, message history, traffic logs, and queue-related state are part of the retained system.

## 5. Debug Surfaces To Preserve

- `qqbot-core`: `/health`, `/api/status`, message simulation, LLM debug, simple queue APIs
- `admin-panel/backend`: prompt config/debug, conversations, queue ops, status/logs, traffic replay/query
- `admin-panel/frontend`: dashboard, conversations, queue management, prompt pages, traffic monitor/replay

## 6. Implementation Bias

- Prefer removing dead compatibility code over preserving unused layers.
- Do not reintroduce a separate function registry service into this repo.
- Keep changes aligned with the reduced architecture above.

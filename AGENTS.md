# Repository Guidelines

## Project Structure & Module Organization
- The active runtime stack in `docker-compose.yml` is `mysql` (3306), `qqbot-core` (8081), `admin-panel/backend` (9080), and `admin-panel/frontend` (3003).
- NapCat is deployed separately via `docker-compose.napcat.yml` and provides OneBot HTTP/WebSocket endpoints on `3000/3001`.
- `qqbot-core` is the central runtime: it consumes NapCat events, manages queues and context, runs AI/tool flows, writes to MySQL, and exposes health, debug, and `/api/simple-queue/*` operations.
- `admin-panel/backend` is the operator API layer over MySQL and `qqbot-core`; it owns prompt management, conversations, queue operations, status/log views, and traffic replay/query APIs.
- `admin-panel/frontend` is the operator UI and only talks to `admin-panel/backend`.
- `modules/http-traffic-monitor` is an admin-side observability toolchain for transparent proxy capture and replay support, not a standalone product service.
- `openclaw-bridge`, `http-api`, and `queue-monitor` are no longer part of this repository's main architecture.

## Current Architecture
- Runtime topology: `NapCat -> qqbot-core -> MySQL`, with `admin-panel/backend` calling into `qqbot-core` for queue/debug operations and `admin-panel/frontend` calling only `admin-panel/backend`.
- Queue management flow: Admin UI `/queue-management` -> `admin-panel/backend` `/api/queue-monitor/*` -> `qqbot-core` `/api/simple-queue/*`.
- Traffic observability flow: `modules/http-traffic-monitor` writes `traffic-*.jsonl`; `admin-panel/backend` imports them into MySQL for admin querying and replay.
- Prompt management flow: prompt data is managed locally through MySQL and admin APIs; do not assume a separate function registry service exists.

## Build, Test, and Development Commands
- `docker compose build` then `docker compose up -d`: rebuild and launch the main stack.
- `docker compose ps`, `docker compose stop`: inspect or stop running services.
- `docker logs -f qqbot-qqbot-core`: follow core runtime logs.
- `npm run dev:qqbot-core`, `npm run dev:admin-backend`, `npm run dev:admin-frontend`: local smoke runs for retained modules.
- `python3 scripts/start_modules.py <install|start|stop|status>`: local multi-module orchestrator.

## Coding Style & Naming Conventions
- Prefer TypeScript with two-space indentation and modern ES modules. Classes use PascalCase, functions and variables camelCase, environment variables SCREAMING_SNAKE_CASE.
- Import shared logger utilities instead of `console.log`.
- Keep changes incremental and avoid speculative abstractions.

## Testing Guidelines
- Jest drives unit tests; place tests adjacent to the code under test.
- Re-run module tests after API or route changes.
- After major queue, prompt, or traffic changes, run the relevant integration checks from `scripts/testing/`.
- Use `./scripts/self-verification.sh` as the broad regression checklist before large merges.

## Commit & Pull Request Guidelines
- Prefix commit messages with scopes such as `feat:`, `fix:`, or `chore:`.
- Document schema, config, and deployment impacts in the PR body.
- Attach outputs from the relevant test/lint commands when changing runtime behavior.

## Operations & Configuration Tips
- Manage the transparent proxy via `python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py start --iptables`.
- Keep NapCat config under `resource/napcat_config/` and local runtime data out of git.
- Queue management APIs live under `admin-panel/backend` at `/api/queue-monitor/*`.
- Local sudo/root credentials for this workstation are out-of-band operational data and must never be written into tracked repository files; when they must be consulted locally, read `/home/liahua/.qqbot-local/credentials.md` on this workstation instead of recording the values in-repo.

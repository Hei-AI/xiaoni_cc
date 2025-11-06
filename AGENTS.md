# Repository Guidelines

## Project Structure & Module Organization
- Core behavior lives in `modules/`: `http-api` (OneBot ingress, port 8080), `qqbot-core` (AI engines, 8081), `queue-monitor` (simple queue proxy consumed by admin `/api/queue-monitor/*`, defaults to 3000), and `admin-panel/{backend,frontend}` (operator APIs/UI, 9080/3003).
- Observability tooling sits in `modules/http-traffic-monitor`. Shared scripts live under `scripts/`, Napcat assets in `resource/`, and database migrations plus seeds in `database/`.
- Service-specific tests sit beside their sources, while cross-service harnesses live in `scripts/testing/`. Review each module’s `CLAUDE.md` before modifying public interfaces or pipelines.

## Build, Test, and Development Commands
- `docker compose build` then `docker compose up -d`: rebuild and launch the full stack; scope with `docker compose up -d qqbot-core` during feature work.
- `docker compose ps`, `docker compose stop`: inspect or stop running services; combine with `docker logs -f qqbot-qqbot-core` for live traces.
- `npm run dev:<module>`: local smoke runs for individual services (e.g., `npm run dev:qqbot-core`).
- `docker exec qqbot-qqbot-core npm test`: execute Jest tests in the core container; adjust service name as needed.
- `python3 scripts/start_modules.py <install|start|stop|status>`: orchestrate local module installs and dev servers without Docker.

## Coding Style & Naming Conventions
- Prefer TypeScript with two-space indentation and modern ES modules. Classes use PascalCase, functions and variables camelCase, environment variables SCREAMING_SNAKE_CASE.
- Import shared logger utilities instead of `console.log`; keep commits incremental and avoid speculative abstractions.
- Follow existing lint settings (`npm run lint:all`) before submitting changes.

## Testing Guidelines
- Jest drives unit tests; name files like `foo.service.test.ts` adjacent to the code under test.
- Update mocks in `modules/qqbot-core/tests/mocks/` when APIs change and re-run `npm run test:<module>` or `docker exec <service> npm test`.
- After major pipeline or schema edits, execute `node scripts/testing/integration/test_end_to_end_flow.js` to validate cross-service behavior.
- Use `./scripts/self-verification.sh` for the full regression checklist (queue processing, LLM tools, database sanity) before large merges.

## Commit & Pull Request Guidelines
- Prefix commit messages with scopes such as `feat:`, `fix:`, or `add:`; document schema or config impacts in the body.
- For PRs, attach outputs from `npm run lint:all` and `npm run test:all`, link relevant docs or READMEs, and include admin-panel UI screenshots when applicable.
- Stage intentionally (`git status`, `git add <file>`), and double-check health endpoints (`8080/health`, `8081/health`, `9080/api/health`) after changes touching deployments.

## Operations & Configuration Tips
- Manage the transparent proxy via `python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py start --iptables`.
- Keep Napcat configuration in sync under `resource/`, and run database migrations before deployment; if environments drift, reset with `docker compose down -v` followed by rebuild and `docker compose up -d`.
- Queue management APIs surface under `admin-panel/backend` at `/api/queue-monitor/*`; the Admin UI (`/queue-management`) proxies these requests into `qqbot-core` simple queue endpoints.

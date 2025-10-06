# Repository Guidelines

## Project Structure & Module Organization
Core services live in `modules/`: `http-api` (OneBot ingress, 8080), `qqbot-core` (AI engines, 8081), and `admin-panel/{backend,frontend}` (operator APIs/UI, 9080/3003). Observability sidecars sit in `modules/http-traffic-monitor`, while queue monitoring now ships inside the admin backend. Shared scripts are under `scripts/`, Napcat assets in `resource/`, and schema migrations plus seeds in `database/`. Tests mirror sources within each module, while cross-service harnesses reside in `scripts/testing/`. Review each module's `CLAUDE.md` before touching pipelines or interfaces.

## Build, Test, and Development Commands
Use Docker as the source of truth: run `docker compose build` to rebuild the stack, followed by `docker compose up -d`. Use `docker compose ps`, `docker compose stop`, or scope with `docker compose up -d qqbot-core` when iterating. Tail logs with `docker logs -f qqbot-qqbot-core` and enter containers using `docker exec -it <service> /bin/sh`. Local smoke passes remain available via `npm run dev:<module>`.

## Coding Style & Naming Conventions
Favor TypeScript with two-space indentation and modern ES modules. Classes use PascalCase, functions and variables use camelCase, and environment variables remain in SCREAMING_SNAKE_CASE. Import shared logger utilities instead of `console.log`, and keep changes incremental—avoid speculative abstractions.

## Testing Guidelines
Jest drives unit tests. Name specs beside sources (e.g., `foo.service.test.ts`). Run `docker exec qqbot-qqbot-core npm test` or `npm run test:<module>` before raising a PR. Update mocks in `modules/qqbot-core/tests/mocks/` when APIs shift, and execute `node scripts/testing/integration/test_end_to_end_flow.js` after major pipeline or schema edits.

## Commit & Pull Request Guidelines
Stage intentionally (`git status`, `git add <file>`). Prefix commits with scopes like `feat:`, `fix:`, or `add:` and document schema or config impacts in the body. PRs should attach lint and test outputs (`npm run lint:all`, `npm run test:all`), link relevant READMEs or docs, and include admin-panel UI screenshots when updated.

## Operations & Configuration Tips
Monitor health endpoints at `8080/health`, `8081/health`, and `9080/api/health`. Manage the transparent proxy via `python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py start --iptables`. Keep Napcat configuration synchronized in `resource/`, and run database migrations before deployment; if environments drift, reset with `docker compose down -v` followed by `docker compose build` and `docker compose up -d`.

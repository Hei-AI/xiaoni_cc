# Repository Guidelines

## Project Structure & Module Organization
The repository orchestrates the QQ bot through coordinated workspace modules. Key directories:
- `modules/qqbot-core` – OneBot event ingestion, AI pipelines, queue integration.
- `modules/http-api` – REST/WebSocket gateway for clients.
- `modules/admin-panel/{backend,frontend}` – operator APIs and dashboard.
- `modules/http-traffic-monitor` & `modules/queue-monitor` – observability sidecars.
Supporting assets: `scripts/` for process orchestration, `database/` for migrations and seed SQL, `resource/` for Napcat configuration, and `docs/` for design notes. Module tests live in `modules/*/tests`, while cross-service harnesses are under `scripts/testing/`.

## Build, Test, and Development Commands
Bootstrap dependencies with `npm run install:all`. Start the full stack using `npm run dev` or focus on a module (`npm run dev:qqbot-core`, `npm run dev:http-api`). Build distributables via `npm run build:all`, and stop services with `npm run stop`. Quality gates: `npm run lint:all`, `npm run test:all`, and `npm run clean-ports` when ports linger between restarts.

## Coding Style & Naming Conventions
TypeScript is standard across services. ESLint (`eslint:recommended` + `@typescript-eslint/no-unused-vars`) enforces two-space indentation, strict unused checks, and modern ES modules. Use PascalCase for classes, camelCase for functions and variables, SCREAMING_SNAKE_CASE for environment keys, and keep file names descriptive. Prefer explicit interfaces, narrow `Promise` return types, and reuse shared logger utilities rather than raw `console` calls.

## Testing Guidelines
Module-level Jest suites run through `npm run test:<module>`; align test file names with their source counterparts. Integration flows reside in `scripts/testing/integration/`—run `node scripts/testing/integration/test_end_to_end_flow.js` to confirm message routing, database writes, and queue behavior after structural changes. Update mocks in `modules/qqbot-core/tests/mocks/` and SQL fixtures in `database/` whenever schemas evolve.

## Commit & Pull Request Guidelines
Commits follow concise, prefixed subjects (`feat:`, `fix:`, `add:`) as shown in history. Reference tickets or docs in the body, summarize schema or config impacts, and attach UI screenshots for admin-panel work. Before submitting a PR, capture results from `npm run lint:all`, `npm run test:all`, and any manual `npm run dev` smoke checks. Provide reviewer context by linking the relevant document under `docs/` or a module README and noting any required environment files (e.g., copy `.env.example` into each workspace).

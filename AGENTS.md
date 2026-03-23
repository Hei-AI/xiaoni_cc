# Repository Guidelines

## Project Structure & Module Organization
- The active runtime stack in `docker-compose.yml` is `mysql` (3306), `qqbot-core` (8081), `admin-panel/backend` (9080), and `admin-panel/frontend` (3003).
- NapCat is deployed separately via `docker-compose.napcat.yml` and provides OneBot HTTP/WebSocket endpoints on `3000/3001`.
- `qqbot-core` is the central runtime: it consumes NapCat events, manages queues and context, runs AI/tool flows, writes to MySQL, and exposes health, debug, and `/api/simple-queue/*` operations.
- `admin-panel/backend` is the operator API layer over MySQL and `qqbot-core`; it owns prompt management, conversations, queue operations, status/log views, and traffic replay/query APIs.
- `admin-panel/frontend` is the operator UI and only talks to `admin-panel/backend`.
- `modules/http-traffic-monitor` is an admin-side observability toolchain for transparent proxy capture and replay support, not a standalone product service.
- `http-api` and `queue-monitor` are no longer part of this repository's main architecture.

## Current Architecture
- Runtime topology: `NapCat -> qqbot-core -> MySQL`, with `admin-panel/backend` calling into `qqbot-core` for queue/debug operations and `admin-panel/frontend` calling only `admin-panel/backend`.
- Queue management flow: Admin UI `/queue-management` -> `admin-panel/backend` `/api/queue-monitor/*` -> `qqbot-core` `/api/simple-queue/*`.
- Traffic observability flow: `modules/http-traffic-monitor` writes `traffic-*.jsonl`; `admin-panel/backend` imports them into MySQL for admin querying and replay.
- Prompt management flow: prompt data is managed locally through MySQL and admin APIs; do not assume a separate function registry service exists.

## Embedding Capability
- `qqbot-core` provides an OpenAI-compatible embedding gateway for local callers. This is infrastructure only and is not tied to queueing, RAG, message history, or other business flows.
- Public embedding endpoints live on `qqbot-core`:
  - `GET /v1/models`
  - `POST /v1/embeddings`
- `POST /v1/embeddings` accepts OpenAI-style fields including `input`, `model`, `encoding_format`, `dimensions`, and `user`.
- Current constraints:
  - The only supported public model id is `embeddinggemma-300m`.
  - `input` must be a non-empty string or a non-empty array of non-empty strings.
  - Only `encoding_format="float"` is supported.
  - Only `dimensions=768` is supported.
- Responses follow the OpenAI embeddings shape:
  - `object: "list"`
  - `data: [{ object: "embedding", index, embedding }]`
  - `model`
  - `usage`
- Standard request errors are returned in OpenAI-style `error` payloads.
- The backing model runtime is an internal `embedding-server` container built from `modules/embedding-server`, running `llama.cpp` with `EmbeddingGemma` (`hf:ggml-org/embeddinggemma-300m-qat-q8_0-GGUF/embeddinggemma-300m-qat-Q8_0.gguf`).
- `embedding-server` is an implementation detail on the internal Docker network and should not be treated as the public API surface.
- Embedding configuration is controlled through:
  - `EMBEDDING_ENABLED`
  - `EMBEDDING_BASE_URL`
  - `EMBEDDING_MODEL_ID`
  - `EMBEDDING_MODEL_SOURCE`
  - `EMBEDDING_TIMEOUT_MS`
  - `EMBEDDING_NORMALIZE`

## Build, Test, and Development Commands
- `npm run install:all`: install root-level tooling plus all three Node modules using their own lockfiles.
- `npm run build`, `npm run test`, `npm run lint`, `npm run clean`: orchestrate the retained modules from the repository root.
- `docker compose build` then `docker compose up -d`: rebuild and launch the main stack.
- `docker compose ps`, `docker compose stop`: inspect or stop running services.
- `docker logs -f qqbot-qqbot-core`: follow core runtime logs.
- `npm run dev:qqbot-core`, `npm run dev:admin-backend`, `npm run dev:admin-frontend`: local smoke runs for retained modules.
- `python3 scripts/start_modules.py <install|start|stop|status>`: local multi-module orchestrator.

## Dependency Management Conventions
- The repository root is an orchestration layer, not an npm workspace. Do not add a `workspaces` field back to the root `package.json`.
- `modules/qqbot-core`, `modules/admin-panel/backend`, and `modules/admin-panel/frontend` are independent Node projects. Each module owns its own `package.json`, `package-lock.json`, and `node_modules`.
- Root-level commands must not rely on hoisted dependencies to satisfy module runtime or type resolution. If a module needs a package or `@types/*`, declare it in that module and install it in that module.
- For local bootstrap, use `npm run install:all` from the repository root. For single-module work, use that module's own install/build/test commands inside the module directory.
- When dependency manifests change, update the matching module `package-lock.json`. Root `package-lock.json` should only describe root-level tooling and scripts.

## Container Build Conventions
- Node service images must use multi-stage Dockerfiles with explicit `deps -> build -> runtime` stages; production runtime images should contain only compiled artifacts, production dependencies, and required runtime scripts/assets.
- Use `# syntax=docker/dockerfile:1.7` and BuildKit cache mounts for npm (`RUN --mount=type=cache,target=/root/.npm ...`) to keep repeat builds fast.
- Use `npm ci` instead of `npm install` in Docker builds. When dependency manifests change, update and commit the matching `package-lock.json`.
- TypeScript services must run compiled output in containers (`node dist/index.js`), not `ts-node` in production images.
- Frontend static apps should keep the existing `builder -> nginx runtime` shape and avoid installing builder-only tools in the nginx runtime stage.
- When iterating on one service, prefer `docker compose build <service>` and only rebuild the touched images. After Dockerfile changes, verify with `docker compose build`, `docker compose up -d`, and health/log checks.
- When a task changes code for a service that is expected to be running via `docker-compose.yml`, completion includes redeploying the affected container(s). Do not stop at local code edits or module-local builds; after validation, run the targeted `docker compose build <service>` and `docker compose up -d <service>` sequence, then confirm the container is healthy from `docker compose ps` and relevant logs.

## Coding Style & Naming Conventions
- Prefer TypeScript with two-space indentation and modern ES modules. Classes use PascalCase, functions and variables camelCase, environment variables SCREAMING_SNAKE_CASE.
- Import shared logger utilities instead of `console.log`.
- Keep changes incremental and avoid speculative abstractions.

## Semantic Fidelity Rule
- For trace, replay, debug, playground, and provider-conversion flows, fix problems at the layer that loses semantics. If a layer drops meaning, flattens the unified provider input, or blocks an `inspect -> import -> rerun` workflow, change that layer instead of adding compensating adapters around it.
- Do not preserve a broken contract by silently degrading data just to keep the current shape working. Prefer extending or correcting the real input model, even when that requires a breaking change.
- If the required fix crosses module boundaries or conflicts with an existing contract, surface the conflict explicitly and escalate it instead of hiding it behind fallback behavior.

## Frontend Design Rules
- Debug and observability pages must be designed around the user's real loop: `select an object -> inspect input/output/evidence -> decide -> move to the next object`. Do not turn these pages into long document-style dumps.
- For object-driven debugging pages, the main area is for navigation and structure, while the detail panel is the single authority for the selected object's raw data. Avoid duplicate entry points such as a right-side inspector plus a separate page-level raw evidence section showing the same payloads again.
- Treat JSON, headers, payloads, diffs, and logs as high-entropy data. They must live in fixed-height containers with their own scrolling, formatting, and copy affordances. Do not let long `<pre>` blocks, auto-growing textareas, or stacked cards hijack the page's main scrollbar.
- Desktop detail panels should default to a docked/sticky layout for stable reading. Floating or draggable panels are enhancement modes for side-by-side comparison, not the default baseline. Mobile should usually keep the simpler drawer/sheet pattern.
- Prefer one reusable structured-data viewer pattern across the admin frontend. If a page needs to show raw request/response/evidence data, reuse the same behavior instead of inventing a new ad hoc JSON block for each screen.
- Anti-patterns to avoid: page-level `Raw Evidence` dumps, repeated `overview/input/output/raw` layers for the same object, raw data that pushes the whole page taller, and multiple conflicting places to inspect the same evidence.

## Frontend Debugging Workflow
- The production admin frontend entrypoint is `https://qqbot-admin.liahuas.top/`. When investigating a frontend bug that reproduces in production, prefer debugging against that real address instead of guessing from a separate local copy.
- For production issue triage, prefer Playwright MCP attached to the user's host browser. This matches the real authenticated browsing context and is the fastest way to capture screenshots, inspect the DOM, and verify real UI behavior.
- Do not default to debugging through a locally started frontend that sits behind a separate Basic Auth or gateway layer. That path adds avoidable auth/proxy differences and often wastes time on issues that do not exist in the real user flow.
- If local debugging is still needed, use a local frontend entrypoint that is not hidden behind extra auth, and make sure it points at the intended backend environment. Do not treat the authenticated local expose proxy as the default frontend debugging target.
- When a page shows runtime data from production, inspect it in the real host browser first, then fall back to local builds only when you need isolated code iteration or to verify a patch before redeploying.

## Testing Guidelines
- Jest drives unit tests; place tests adjacent to the code under test.
- Re-run module tests after API or route changes.
- After major queue, prompt, or traffic changes, run the relevant integration checks from `scripts/testing/`.
- Use `./scripts/self-verification.sh` as the broad regression checklist before large merges.
- For agent end-to-end self-tests on this workstation, prefer using OpenClaw to send a QQ private message to 小腻 (`1129974489`) yourself before asking the user to validate the flow manually.

## Commit & Pull Request Guidelines
- Prefix commit messages with scopes such as `feat:`, `fix:`, or `chore:`.
- For git pushes from this workstation, use SSH remotes or explicit SSH push URLs by default; do not rely on HTTPS GitHub authentication.
- Document schema, config, and deployment impacts in the PR body.
- Attach outputs from the relevant test/lint commands when changing runtime behavior.

## Operations & Configuration Tips
- Manage the transparent proxy via `python3 modules/http-traffic-monitor/transparent-proxy/mitmproxy_manager.py start --iptables`.
- Keep NapCat config under `resource/napcat_config/` and local runtime data out of git.
- Queue management APIs live under `admin-panel/backend` at `/api/queue-monitor/*`.
- Local sudo/root credentials for this workstation are out-of-band operational data and must never be written into tracked repository files; when they must be consulted locally, read `/home/liahua/.qqbot-local/credentials.md` on this workstation instead of recording the values in-repo.

# How to operate Xiaoni runtime surfaces

Use this page when you need to inspect what Xiaoni is doing, verify a runtime
change, or guide Xiaoni through one of her local skills. The architecture source
of truth remains `docs/XIAONI_AGENT_STACK_LEDGER.md`; this page is the operator
how-to layer.

## Prerequisites

- Use the admin panel through `admin-panel/frontend -> admin-panel/backend`.
- For production, open `https://qqbot-admin.liahuas.top/` and read the Basic Auth
  token from `/home/liahua/.qqbot-local/admin-debug-auth/qqbot-admin-debug.token`.
- For local frontend debugging, use `npm run deploy:local` and open the
  `frontend_host_browser_url` written to
  `/home/liahua/.qqbot-local/playwright/local-frontend-access.json`.
- Do not read QQ unread state from `agent_queue_messages`; that table is only the
  Notify Bucket doorbell. QQ inbox/window state lives in `agent_inbound_messages`
  and is exposed to Xiaoni through `$qq-usage`.

## How to inspect what Xiaoni is doing

1. Open the admin panel and go to Xiaoni activity.
2. Start with the main action stream. It is a projection from:
   - `agent_stack_items`
   - `llm_request_slices`
   - `tool_executions`
   - life, media, task, recovery, and fork tables
3. Use tag filters when the stream is noisy. Tags come from source, event kind,
   status, fork kind, and tool name.
4. Use the refresh controls when watching a live loop. A manual refresh should
   not change the selected card unless the selected event disappeared from the
   current filtered window.
5. Open Raw Trace only from a card that has trace evidence. Raw Trace is detail,
   not the main list. It should lead back to a stack item, LLM slice, tool
   execution, visible delivery, or fork row.

## How to read an LLM request

1. In Xiaoni activity, select an LLM or model-output card.
2. Open the trace detail.
3. Treat `llm_request_slices.canonical_request` as the provider-neutral request
   assembled by `agent-service`.
4. Treat `llm_request_slices.wire_request` and `wire_response` as provider
   evidence recorded by `provider-service` / Codex Provider.
5. If provider evidence is missing, do not reconstruct it from traffic logs as a
   new source of truth. Use traffic or CLIProxy logs only as supporting evidence.

## How to inspect recovery and energy

1. Open the Xiaoni recovery page.
2. Check the current life state first: prompt-facing Xiaoni only sees
   `energy/max_energy`, while engineering state may include pressure and
   action debt.
3. Read active and historical `agent_recovery_sessions` rows through the page.
4. For voluntary `recover_energy`, expect completion as the original
   `function_call_output`.
5. For forced runtime recovery, expect a runtime input reminder after wake. There
   is no original tool call, so engineering must not fake a tool output.
6. If Xiaoni sleeps but the provider cache must stay warm, use the one-shot
   heartbeat endpoint only for local verification:

```bash
curl -sS -X POST http://127.0.0.1:8092/api/internal/runtime/cache-heartbeat
```

The heartbeat writes Codex provider usage events. It does not claim Notify Bucket
rows and does not append to the main stack.

## How to adjust runtime controls

Use the admin runtime settings page for live control rows backed by
`agent_runtime_control`.

- Main loop switch pauses or resumes Xiaoni's runtime loop.
- Main model yield sets the wait, in milliseconds, before each main model slice.
  The default is `5000`.
- Sleep heartbeat pause stops automatic provider cache heartbeat while Xiaoni is
  in an active recovery session. The manual heartbeat endpoint above still works.
- Post-compression pause arms a one-shot gate: after the next successful core
  memory compression write, the main loop pauses.
- Manual recover ("手动恢复") is for getting Xiaoni moving again after a provider
  outage. It posts to `/api/agent-runtime/recover-now`, which injects one synthetic
  `phone_notification` from the latest unread QQ inbox message so the main loop has
  a trigger to claim. The response reports the enqueued queue row and the source
  inbound message; if there is no unread inbox message, nothing is injected.

Use these controls for runtime pacing and cache experiments. Do not use them as a
replacement for fixing queue, prompt, or provider bugs.

## How to inspect passive recall shadow cues

1. Open the admin "被动浮现 Shadow" page at `/xiaoni-passive-recall`.
2. The page reads `GET /api/xiaoni/passive-recall/shadow-cues` and returns
   `deliveryMode: "shadow_only"`. Nothing here is delivered to the main agent or
   written to the Notify Bucket; it is a review surface only.
3. Read two sources side by side:
   - `cues`: raw trigger points projected from the DB action stream.
   - `fileCandidates`: read-only file candidates scanned from
     `/xiaoni-runtime/forever|notes|reading|toys`.
4. Reuse the action-stream filters: `range / start_time / end_time / before_time /
   tags / limit`, plus `include_files / file_limit` for the file scan.
5. Use this to sanity-check whether a cue looks like a real subconscious origin
   point before any embedding, activation, or daemon work. Boundary and cue
   classes are the source of truth in `docs/XIAONI_PASSIVE_RECALL_EXTRACTOR.md`.

## How to verify LLM usage

1. Open the LLM usage observatory in Xiaoni activity.
2. Use the smallest useful bucket first: call, hour, day, then month.
3. Expect usage from four families:
   - main `llm_request_slices`
   - core-memory compression forks
   - image vision forks
   - Codex provider usage events, including image provider calls and sleep cache
     heartbeat
4. Use search overlay to find evidence. Search does not change the source of
   truth; it only helps locate a slice or event.

## How to send a local image to QQ

Use `$qq-send-image` only after a local image exists under `/xiaoni-runtime`.
The skill sends through:

```text
agent-service -> provider-service -> NapCat
```

Examples:

```bash
python3 /app/modules/agent-service/skills/qq-send-image/scripts/qq_send_image.py send_group 123 /xiaoni-runtime/picture/example.png
python3 /app/modules/agent-service/skills/qq-send-image/scripts/qq_send_image.py send_private 85178516 /xiaoni-runtime/picture/example.png --caption "可选配文"
python3 /app/modules/agent-service/skills/qq-send-image/scripts/qq_send_image.py check --status-key abc123
```

Boundaries:

- Do not pass `thread_key` or `session_key`; use QQ group id or user id.
- The skill does not generate, inspect, or navigate images.
- If send status is pending, use `check` with `message_id`, `status_key`, or the
  same target/path/caption tuple.

## How to use Xiaoni browser

Use `$xiaoni-browser` when Xiaoni needs a visible host Chrome session for page
inspection, screenshots, console, network, or authenticated debugging.

```bash
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- ensure-extension
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- -s=xiaoni-host attach --extension=chrome
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- -s=xiaoni-host goto https://example.com
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- -s=xiaoni-host snapshot
```

Ask before `ensure-extension --restart`; it closes and reopens the operator's
visible Chrome profile. Screenshots copied by the bridge should be referenced
with the `/xiaoni-runtime/picture/xiaoni-browser-...png` path printed in the
runtime artifacts section.

## How to publish and verify Xiaoni's site

Use `$xiaoni-site` for building or serving `https://xiaoni.liahuas.top`. The
public path is:

```text
https://xiaoni.liahuas.top
-> Cloudflare Tunnel
-> host 127.0.0.1:3458
-> xiaoni-site-expose-proxy
-> qqbot-xiaoni-executor:3458
```

Publish static files under:

```text
/xiaoni-runtime/site/xiaoni-home/dist
```

Then run `$site-publish-check`:

```bash
/workspace/qq_bot/modules/agent-service/skills/site-publish-check/scripts/check.sh /some-page.html
/workspace/qq_bot/modules/agent-service/skills/site-publish-check/scripts/check.sh --allow-unlinked /preview/
```

The checker must pass before sharing the public link. It verifies the dist file,
public HTTP 200, homepage link, private path leakage, and same-site resources.

## How to inspect local images without an image id

Use `$local-image-visibility` when a PNG exists under `/xiaoni-runtime/picture`
but there is no usable `inspect_image_placeholder` image id.

```bash
python3 /workspace/qq_bot/modules/agent-service/skills/local-image-visibility/scripts/local_image_visibility.py info /xiaoni-runtime/picture/example.png
python3 /workspace/qq_bot/modules/agent-service/skills/local-image-visibility/scripts/local_image_visibility.py ascii /xiaoni-runtime/picture/example.png --out /xiaoni-runtime/notes/YYYY-MM-DD/image-ascii.txt
python3 /workspace/qq_bot/modules/agent-service/skills/local-image-visibility/scripts/local_image_visibility.py browser-thumb /xiaoni-runtime/picture/example.png --width 96 --height 64
```

This only confirms file visibility, dimensions, thumbnails, and coarse color or
ascii shape. It does not provide reliable semantic vision.

## How to preserve artifacts before publishing or sharing

Use `$forever-archive` before treating a page, essay, image, or toy as something
Xiaoni should remember after rebuilds.

```bash
python3 /workspace/qq_bot/modules/agent-service/skills/forever-archive/scripts/archive_artifact.py \
  --category site \
  --slug example-artifact \
  --public-url https://xiaoni.liahuas.top/example-artifact/ \
  --route /example-artifact/ \
  --file /xiaoni-runtime/site/xiaoni-home/example-artifact/index.html:public_page_index.html
```

For long QQ shares, use `$qq-share-splitter` before sending a note or essay:

```bash
python3 /workspace/qq_bot/modules/agent-service/skills/qq-share-splitter/scripts/split_share.py /xiaoni-runtime/notes/example.md --max-chars 650
```

If the content is worth keeping, publish or archive the full version first, then
share a short conversational teaser and link.

## Verification

After changing runtime surfaces or this documentation, run the smallest matching
set:

```bash
python3 scripts/validate_docs.py
npm --prefix modules/agent-service test
npm --prefix modules/admin-panel/backend test
npm --prefix modules/admin-panel/frontend run build
node --test packages/persistence/__tests__/*.test.js
git diff --check
```

If code changes touched a `docker-compose.yml` service, finish with the
`AGENTS.md` Done Means service build/restart/health-check sequence.

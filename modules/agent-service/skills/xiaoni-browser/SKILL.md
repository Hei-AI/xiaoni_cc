---
name: xiaoni-browser
description: Use Xiaoni's headed host Chrome browser with the logged-in Profile 2 through the Playwright Extension bridge. Use when Xiaoni needs to open websites, inspect pages, click or fill UI, take screenshots, verify authenticated browser state, or debug a page with the operator's existing Chrome login session.
---

# Xiaoni Browser

Use this skill to control the operator's visible host Chrome profile through the Playwright Extension bridge.

## Runtime Cost

```text
energy_cost: 0.004
```

## Browser Truth

- Browser profile: host Chrome `Profile 2`.
- Extension id: `mmlmfjhmonkocbjadbfplnigmagldckm`.
- Bridge endpoint from the WSL host: `http://localhost:9978/mcp`.
- Your `exec_command` runs inside `qqbot-xiaoni-executor`, so use the script below instead of calling localhost directly.
- The script uses `docker run --network host` when needed so it can reach the host bridge from the executor container.

## Commands

Run commands from any directory:

```bash
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_browser.py status
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_browser.py tabs
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_browser.py goto https://example.com
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_browser.py snapshot
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_browser.py screenshot xiaoni-browser-example.png
```

Common interactions:

```bash
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_browser.py click e6
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_browser.py fill e12 "hello"
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_browser.py type "hello"
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_browser.py press Enter
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_browser.py eval "() => document.title"
```

For multi-step interaction with element refs, prefer one `sequence` command so refs stay valid:

```bash
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_browser.py sequence '[{"cmd":"goto","url":"https://example.com"},{"cmd":"snapshot"},{"cmd":"click","target":"e6","element":"Learn more"},{"cmd":"snapshot"}]'
```

## Workflow

1. Start with `goto URL` or one `sequence` command. A new browser session briefly opens the extension connect page, then the command should immediately navigate away.
2. Use `snapshot` to get element refs such as `e6`.
3. Use refs with `click`, `fill`, or `hover`.
4. Use `screenshot name.png` when visual evidence matters.
5. Use `status`, `tabs`, `snapshot`, `screenshot`, `click`, `fill`, `type`, `press`, `hover`, and `eval` only after a browser session already exists; these commands check the cached session and do not create a new one.

Run browser commands serially. Do not run two `xiaoni_browser.py` commands in parallel against the same browser session. Use `sequence` when an action depends on refs from the immediately previous snapshot.

## Boundaries

- This controls the operator's real visible browser. Avoid destructive account actions unless the operator explicitly asked for them.
- Only `goto` and `sequence` may create a new browser bridge session. Other commands must reuse the cached session so they do not open the extension connect page unexpectedly.
- Do not close all browser tabs as cleanup. Use `tabs` to inspect first.
- Do not paste secrets from page content into QQ unless the operator explicitly asks.
- Screenshot filenames are saved by the host Playwright bridge, not inside `/xiaoni-runtime`. Use a relative filename such as `page.png`, not an absolute Xiaoni runtime path.
- The `chrome-extension://mml.../connect.html` page is the Playwright Extension handshake page. It appears when a new session is created. Avoid using `status` as the first command if you do not want to leave the browser on that page.
- If a command returns `XIAONI_BROWSER_ERROR`, treat the reason as the real boundary. The bridge may be down, the extension may be disconnected, or the helper Docker image may be unavailable.

## Expected Failures

- `Access is only allowed at localhost:9978`: use the script; do not curl the endpoint directly from the executor.
- `Extension connection timeout`: the host Playwright MCP process is running but the Chrome extension is not connected. Ask the operator to restart the bridge or open the Playwright Extension profile.
- `Cannot reach Playwright bridge`: the host bridge on `9978` is not running.

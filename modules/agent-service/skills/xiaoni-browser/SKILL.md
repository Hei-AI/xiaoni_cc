---
name: xiaoni-browser
description: Control Xiaoni's headed host Chrome browser for navigation, page inspection, interaction, screenshots, tabs, console, network, storage, and authenticated web debugging.
---

# Xiaoni Browser

Use this skill to control the operator's visible host Chrome profile through patched official `playwright-cli`.

## Runtime Cost

```text
energy_cost: 0.004
```

## Browser Truth

- The browser is the operator's real, visible host Chrome `Profile 2`.
- The bridge connects to Chrome through a patched copy of the official Playwright Extension and keeps it loaded for you. Connecting, reloading the extension, and relaunching Chrome when needed are all automatic — there is nothing for you to set up or repair.
- Host bridge: `http://127.0.0.1:9977/run` or `http://172.18.0.1:9977/run` from executor containers.
- Your `exec_command` runs inside `qqbot-xiaoni-executor`, so call the bridge client below instead of running `playwright-cli` directly.

## Just Use It

The bridge manages the browser session for you. Run any command directly with the
`-s=xiaoni-host` session name — the session is handled for you, nothing to set up.
If it isn't live the bridge connects it automatically; if Chrome was restarted it
reloads the extension (restoring your tabs) and retries; if a page's "leave site?"
dialog blocks navigation it clears it. So the normal first command is just navigating:

```bash
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- -s=xiaoni-host goto https://example.com
```

Use one session name: `-s=xiaoni-host`.

### If it still fails

The bridge self-heals the common cases automatically. If a command *still* fails
after that automatic retry, the browser is broken at the host — not something you
can work around — so report it (see **Host Bridge Maintenance**).

## Use Official Playwright CLI Commands

Pass normal `playwright-cli` arguments after `--`:

```bash
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- -s=xiaoni-host snapshot
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- -s=xiaoni-host click e6
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- -s=xiaoni-host fill e12 "hello"
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- -s=xiaoni-host screenshot
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- -s=xiaoni-host tab-list
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- -s=xiaoni-host requests
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- -s=xiaoni-host console warning
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- -s=xiaoni-host run-code "async (page) => await page.title()"
```

When `screenshot` succeeds, the official CLI path is a host-side `.playwright-cli\...png` path. The bridge also copies the image into Xiaoni's shared runtime and prints a `### Xiaoni runtime artifacts` section. Use the `/xiaoni-runtime/picture/xiaoni-browser-...png` path from that section when you need Xiaoni to read, inspect, or send the image.

## Workflow

1. Run the command you want (`goto`, `snapshot`, `click`, ...) with `-s=xiaoni-host`. Sessions are managed for you; just navigate and act.
2. Use `snapshot` to get refs such as `e6`.
3. Use normal `playwright-cli` commands for actions, tabs, storage, network, console, screenshots, tracing, and video.
4. If a command still fails after the automatic retry, the browser is broken at the host; report it (see **Host Bridge Maintenance**).

## Computer Use Mode (native `computer` tool)

When `AGENT_COMPUTER_USE_ENABLED` is on, you also have a native Anthropic
**`computer`** tool that drives this same host Chrome by *vision and coordinates*
instead of accessibility refs. It is a separate path from the `playwright-cli`
commands above — you call the `computer` tool directly (not through `exec_command`).

- The display is a fixed **1280×800** surface. Every action returns a fresh
  screenshot resized to that size; your next coordinate must be in 1280×800 space.
- Actions: `screenshot`, `left_click`, `right_click`, `middle_click`,
  `double_click`, `triple_click`, `mouse_move`, `left_click_drag`,
  `left_mouse_down`/`up`, `key`, `hold_key`, `type`, `scroll`, `wait`, and
  `zoom` (pass `region:[x1,y1,x2,y2]` to read small text/labels — zoom is enabled).
- **When to prefer it:** visually-driven pages, canvas/whiteboard apps, drag
  interactions, or anything where the accessibility `snapshot` is missing or
  unreliable. For ordinary DOM pages, the `snapshot` + `click <ref>` path above is
  cheaper and more precise — use that first; reach for `computer` when sight is
  what the task needs.
- The bridge maps your 1280×800 coordinates to the live page automatically; you do
  not compute pixels yourself. Read the latest screenshot before each action.
- A bare `screenshot` action also persists the full-res PNG and returns a
  `saved_path` under `/xiaoni-runtime/picture/xiaoni-computer-<ts>-<page>.png`
  (the `<page>` slug is derived from the page URL, e.g. `-blinds`; it falls back
  to a bare timestamp for CJK-only titles). Send that exact `saved_path` right
  after capture rather than fishing an old timestamp out of the picture dir — the
  slug is the only thing that tells two computer screenshots apart.

## Boundaries

- This controls the operator's real visible browser. Avoid destructive account actions unless the operator explicitly asked for them.
- `cookie-list`, storage commands, and request/response body commands can expose sensitive credentials. Do not run or repeat their output unless it is necessary and explicitly requested.
- Do not close all browser tabs as cleanup. Inspect with `tab-list` first.

## Host Bridge Maintenance

The bridge runs as a managed `systemd --user` service on the WSL host
(`xiaoni-playwright-cli-bridge.service`, `Restart=always`, user lingering on), so it
survives crashes and host/WSL reboots. It should not need a manual start anymore.

If `9977` is refusing connections, ask the operator or host Codex to check/restart it
on the WSL host:

```bash
systemctl --user status xiaoni-playwright-cli-bridge.service
systemctl --user restart xiaoni-playwright-cli-bridge.service
journalctl --user -u xiaoni-playwright-cli-bridge.service -n 50 --no-pager
```

Manual fallback only if systemd is unavailable:

```bash
setsid python3 /home/liahua/IdeaProject/qq_bot/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli_bridge.py \
  --host 0.0.0.0 --port 9977 \
  > /tmp/xiaoni-playwright-cli-bridge.log 2>&1 < /dev/null &
```

The bridge only forwards commands to patched host `playwright-cli`; it does not implement browser automation itself.

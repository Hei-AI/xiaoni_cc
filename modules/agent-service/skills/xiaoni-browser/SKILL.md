---
name: xiaoni-browser
description: "Use Xiaoni's headed host Chrome browser with the logged-in Profile 2 through a patched Playwright CLI bridge. Use when Xiaoni needs broad browser automation: opening websites, inspecting pages, clicking/filling UI, tabs, screenshots, network/console inspection, storage/cookies, tracing/video, or debugging a page with the operator's existing Chrome login session."
---

# Xiaoni Browser

Use this skill to control the operator's visible host Chrome profile through patched official `playwright-cli`.

## Runtime Cost

```text
energy_cost: 0.004
```

## Browser Truth

- Browser profile: host Chrome `Profile 2`.
- Extension id: `mmlmfjhmonkocbjadbfplnigmagldckm`.
- Host CLI install: `C:\temp\xiaoni-playwright-cli`.
- Host bridge: `http://127.0.0.1:9977/run` or `http://172.18.0.1:9977/run` from executor containers. A test bridge may also run on `9976`.
- Your `exec_command` runs inside `qqbot-xiaoni-executor`, so call the bridge client below instead of running `playwright-cli` directly.

## Start Or Reattach

The host bridge must already be running. If the browser session is not attached:

```bash
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- -s=xiaoni-host attach --extension=chrome
```

The attach command may briefly show the Playwright Extension connect page. Immediately navigate away:

```bash
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- -s=xiaoni-host goto https://example.com
```

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

Show the full official command surface:

```bash
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- --help
```

## Workflow

1. Use `attach --extension=chrome` only when `xiaoni-host` is missing or detached.
2. Use `goto URL` right after a new attach so the browser does not stay on `chrome-extension://.../connect.html`.
3. Use `snapshot` to get refs such as `e6`.
4. Use normal `playwright-cli` commands for actions, tabs, storage, network, console, screenshots, tracing, and video.
5. Prefer one session name: `-s=xiaoni-host`.

## Boundaries

- This controls the operator's real visible browser. Avoid destructive account actions unless the operator explicitly asked for them.
- `cookie-list`, storage commands, and request/response body commands can expose sensitive credentials. Do not run or repeat their output unless it is necessary and explicitly requested.
- Do not close all browser tabs as cleanup. Inspect with `tab-list` first.
- The `chrome-extension://mml.../connect.html` page is the Playwright Extension handshake page. It appears when a new session is created. Run `goto` immediately after attach.

## Host Bridge Maintenance

If the bridge is down, ask the operator or host Codex to start it on the WSL host:

```bash
setsid python3 /home/liahua/IdeaProject/qq_bot/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli_bridge.py \
  --host 0.0.0.0 --port 9977 \
  > /tmp/xiaoni-playwright-cli-bridge.log 2>&1 < /dev/null &
```

The bridge only forwards commands to patched host `playwright-cli`; it does not implement browser automation itself.

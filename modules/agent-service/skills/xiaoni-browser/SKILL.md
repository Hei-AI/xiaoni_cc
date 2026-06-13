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

- Browser profile: host Chrome `Profile 2`.
- Primary attach mode: official Playwright Extension code, loaded as Xiaoni's own unpacked extension id. The source Web Store id is `mmlmfjhmonkocbjadbfplnigmagldckm`, but the running id and Playwright CLI preflight are patched by the host bridge to avoid Chrome blocking the Web Store id in automation launches.
- Host bridge maintains a patched unpacked copy of Playwright Extension `0.2.1` under `C:\temp\xiaoni-playwright-extension-<id>-0.2.1`. The patch only auto-selects a debuggable tab when the CLI token is valid and filters `chrome-extension:` tabs out of selection.
- Chrome is visible and headed. The bridge may close and reopen host Chrome once when `ensure-extension --restart` is used so `--disable-extensions-except` and `--load-extension` take effect for the real `Profile 2`.
- Host CLI install: `C:\temp\xiaoni-playwright-cli`.
- Host bridge: `http://127.0.0.1:9977/run` or `http://172.18.0.1:9977/run` from executor containers. A test bridge may also run on `9976`.
- Your `exec_command` runs inside `qqbot-xiaoni-executor`, so call the bridge client below instead of running `playwright-cli` directly.

## Start Or Reattach

The host bridge must already be running. Ensure the patched extension is installed and loaded, then attach through official `playwright-cli` extension mode:

```bash
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- ensure-extension
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- -s=xiaoni-host attach --extension=chrome
```

`attach --extension=chrome` creates a daemon session. The bridge may stop waiting after a short timeout once stdout contains `Session ... created`; that is success. Continue with `tab-list`, `snapshot`, or `goto` instead of retrying attach.

If attach opens a blocked `chrome-extension://.../connect.html` page, or if `ensure-extension` says Chrome is already running without the patched extension, ask the operator before restarting because it closes and reopens their visible Chrome. Then run:

```bash
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- ensure-extension --restart
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- -s=xiaoni-host attach --extension=chrome
```

After attach, navigate normally:

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

When `screenshot` succeeds, the official CLI path is a host-side `.playwright-cli\...png` path. The bridge also copies the image into Xiaoni's shared runtime and prints a `### Xiaoni runtime artifacts` section. Use the `/xiaoni-runtime/picture/xiaoni-browser-...png` path from that section when you need Xiaoni to read, inspect, or send the image.

Show the full official command surface:

```bash
python3 /app/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py -- --help
```

## Workflow

1. Run `ensure-extension`; if Chrome was already launched with the patched extension, attach with `--extension=chrome`.
2. If attach fails or the browser shows the extension connect page, ask before `ensure-extension --restart` because it closes and reopens the operator's Chrome profile.
3. If attach reports `Session ... created` and mentions a timeout after session creation, treat it as attached and continue.
4. Use `snapshot` to get refs such as `e6`.
5. Use normal `playwright-cli` commands for actions, tabs, storage, network, console, screenshots, tracing, and video.
6. Prefer one session name: `-s=xiaoni-host`.

## Boundaries

- This controls the operator's real visible browser. Avoid destructive account actions unless the operator explicitly asked for them.
- `cookie-list`, storage commands, and request/response body commands can expose sensitive credentials. Do not run or repeat their output unless it is necessary and explicitly requested.
- Do not close all browser tabs as cleanup. Inspect with `tab-list` first.
- Do not use the CDP mirror profile as the default path. Chrome 136+ requires a non-default user-data-dir for raw `--remote-debugging-port`; that path opens headed Chrome but does not reliably preserve Google/Gemini login state on Windows.
- If `attach --extension=chrome` fails, run `ensure-extension`; only use `ensure-extension --restart` after operator approval because it restarts visible Chrome.
- CDP attach is a diagnostic fallback only: `ensure-cdp` plus `attach --cdp http://127.0.0.1:9222`. It is useful for debugging the bridge, not for authenticated Gemini work.

## Host Bridge Maintenance

If the bridge is down, ask the operator or host Codex to start it on the WSL host:

```bash
setsid python3 /home/liahua/IdeaProject/qq_bot/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli_bridge.py \
  --host 0.0.0.0 --port 9977 \
  > /tmp/xiaoni-playwright-cli-bridge.log 2>&1 < /dev/null &
```

The bridge only forwards commands to patched host `playwright-cli`; it does not implement browser automation itself.

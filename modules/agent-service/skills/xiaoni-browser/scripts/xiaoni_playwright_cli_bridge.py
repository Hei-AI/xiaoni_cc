#!/usr/bin/env python3
import argparse
import base64
import hashlib
import http.client
import io
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Computer-use support: tested coordinate mapper (declared display -> live CSS px)
# lives next to this script; Pillow resizes screenshots back to the declared size.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import computer_coords  # noqa: E402
except Exception:  # pragma: no cover
    computer_coords = None
try:
    from PIL import Image  # noqa: E402
    _PIL_OK = True
except Exception:  # pragma: no cover
    _PIL_OK = False


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 9977
# ── Linux host bridge (ported from the original WSL/Windows bridge) ──
# The migrated playwright-cli lives under ~/.qqbot-local; it is driven with the
# host `node` and a native `google-chrome` launched headed on the desktop
# session. Legacy *_WIN / *_WSL names are kept as Linux-valued aliases so the
# cross-platform helpers (extension patching, artifact resolution) work unchanged.
NODE_EXE = os.environ.get("XIAONI_NODE_EXE") or shutil.which("node") or "/usr/bin/node"
INSTALL_DIR = os.environ.get(
    "XIAONI_PLAYWRIGHT_CLI_DIR",
    os.path.expanduser("~/.qqbot-local/xiaoni-playwright-cli"),
)
CLI_SCRIPT = os.path.join(INSTALL_DIR, "node_modules", "@playwright", "cli", "playwright-cli.js")
INSTALL_DIR_WSL = INSTALL_DIR  # legacy alias: subprocess cwd + artifact path resolution
RUNTIME_HOST_ROOT = os.environ.get("XIAONI_RUNTIME_HOST_ROOT", "/home/liahua/.qqbot-local/xiaoni-runtime")
RUNTIME_CONTAINER_ROOT = os.environ.get("XIAONI_RUNTIME_CONTAINER_ROOT", "/xiaoni-runtime")
PROVIDER_SERVICE_URL = os.environ.get("PROVIDER_SERVICE_URL", "").rstrip("/")
CDP_ENDPOINT = os.environ.get("XIAONI_BROWSER_CDP_ENDPOINT", "http://127.0.0.1:9222")
CDP_PORT = os.environ.get("XIAONI_BROWSER_CDP_PORT", "9222")
CHROME_EXE = os.environ.get("XIAONI_CHROME_EXE") or shutil.which("google-chrome") or "/usr/bin/google-chrome"
CHROME_EXE_WIN = CHROME_EXE  # legacy alias (PLAYWRIGHT_MCP_EXECUTABLE_PATH)
# The operator's REAL logged-in Chrome profile. Chrome 136+ ignores
# --remote-debugging-port on the default user-data-dir, so we run CDP against a
# separate "mirror" user-data-dir whose profile is a symlink to the real one —
# same cookies/logins, but a non-default dir so CDP is allowed. Only one Chrome
# uses the profile at a time (the bridge takes the browser over on launch).
REAL_CHROME_USER_DATA_DIR = os.environ.get(
    "XIAONI_REAL_CHROME_USER_DATA_DIR",
    os.path.expanduser("~/.config/google-chrome"),
)
CHROME_USER_DATA_DIR = os.environ.get(
    "XIAONI_CHROME_USER_DATA_DIR",
    os.path.expanduser("~/.qqbot-local/xiaoni-cdp-userdata"),
)
CHROME_USER_DATA_DIR_WIN = CHROME_USER_DATA_DIR  # legacy alias
CHROME_CDP_USER_DATA_DIR_WIN = CHROME_USER_DATA_DIR  # legacy alias
CHROME_PROFILE_DIRECTORY = os.environ.get("XIAONI_CHROME_PROFILE_DIRECTORY", "Default")
# Headed Chrome needs a display; default to the active desktop session.
CHROME_DISPLAY = os.environ.get("XIAONI_CHROME_DISPLAY") or os.environ.get("DISPLAY") or ":0"
# Under a systemd --user service there is no X access (no XAUTHORITY), so headed
# Chrome must talk to the compositor directly. On a Wayland desktop, force the
# wayland Ozone backend (uses WAYLAND_DISPLAY + XDG_RUNTIME_DIR, no X needed).
CHROME_OZONE_PLATFORM = os.environ.get(
    "XIAONI_CHROME_OZONE_PLATFORM",
    "wayland" if (os.environ.get("WAYLAND_DISPLAY")
                  or os.path.exists(f"/run/user/{os.getuid()}/wayland-0")) else "",
)
WEBSTORE_EXTENSION_ID = "mmlmfjhmonkocbjadbfplnigmagldckm"
EXTENSION_KEY = os.environ.get(
    "XIAONI_PLAYWRIGHT_EXTENSION_KEY",
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAroG8VIkUo4gqqV/HugPAhm4Y2szeaak+jYEhAHG+5C3yjFz14+WJJmrj4c30dsbMGzuZ5hN8bHy/AcB3evS9SlSmTZ79h1trFU7tMtbLbtjZgLT8WqNqFNjSF02s3O/TmsC1rZh1CsAKI1vRu6/fEoikK32ZybHLuzJBpLq2coQu6CYec//6POLNmvy58LBcKsF2a0UJ/2gBjYMNKa5g4LvrVFRTXH6UWubcsSXDO5wr4f3MPLf8w4+WO/wja8XbXbdBmlfupmkf6S+ZIu3SwSLbzu2xxnCmwkUTXLC631UOpJkmMjcrAILcUBECkoUcNRhxJ0iwC2aHZkf4vQbP9wIDAQAB",
)
EXTENSION_ID = os.environ.get("XIAONI_PLAYWRIGHT_EXTENSION_ID", "")
if not EXTENSION_ID:
    digest = hashlib.sha256(base64.b64decode(EXTENSION_KEY)).digest()
    alphabet = "abcdefghijklmnop"
    EXTENSION_ID = "".join(alphabet[byte >> 4] + alphabet[byte & 0x0F] for byte in digest[:16])
EXTENSION_VERSION = "0.2.1"
DEFAULT_EXTENSION_ATTACH_TIMEOUT_SECONDS = int(os.environ.get("XIAONI_PLAYWRIGHT_ATTACH_TIMEOUT_SECONDS", "15"))
EXTENSION_DIR = os.environ.get(
    "XIAONI_PLAYWRIGHT_EXTENSION_DIR",
    os.path.expanduser(f"~/.qqbot-local/xiaoni-playwright-extension-{EXTENSION_ID}-{EXTENSION_VERSION}"),
)
EXTENSION_DIR_WSL = EXTENSION_DIR  # legacy alias
EXTENSION_DIR_WIN = EXTENSION_DIR  # legacy alias
EXTENSION_CRX_URL = os.environ.get(
    "XIAONI_PLAYWRIGHT_EXTENSION_CRX_URL",
    "https://clients2.google.com/service/update2/crx?"
    "response=redirect&prodversion=149.0.7827.103&acceptformat=crx2,crx3&"
    f"x=id%3D{WEBSTORE_EXTENSION_ID}%26installsource%3Dondemand%26uc",
)
CLI_EXTENSION_FILES = [
    os.path.join(INSTALL_DIR, "node_modules", "playwright-core", "lib", "coreBundle.js"),
    os.path.join(INSTALL_DIR, "node_modules", "playwright-core", "lib", "tools", "utils", "extension.js"),
]
ATTACH_PROCESSES = {}
ATTACH_LOCK = threading.Lock()


# ─────────────────────────── computer-use action support ───────────────────────────
# A computer-use action arrives in the declared display space (display_width_px x
# display_height_px). We read the live viewport, map coordinates with the tested
# computer_coords mapper, execute via playwright-cli run-code on the xiaoni-host
# session, screenshot, and resize back to the declared size so the model's next
# coordinate stays in the same space. The bridge only forwards to the host CLI.
_COMPUTER_SESSION = "-s=xiaoni-host"
_COMPUTER_SENTINEL = "XICU:"
_COORD_ACTIONS = {
    "left_click", "right_click", "middle_click", "double_click", "triple_click",
    "mouse_move", "left_mouse_down", "left_click_drag", "scroll",
}

_KEY_TOKENS = {
    "ctrl": "Control", "control": "Control", "alt": "Alt", "option": "Alt",
    "shift": "Shift", "cmd": "Meta", "super": "Meta", "win": "Meta", "meta": "Meta",
    "return": "Enter", "enter": "Enter", "esc": "Escape", "escape": "Escape",
    "tab": "Tab", "space": "Space", "backspace": "Backspace", "delete": "Delete",
    "up": "ArrowUp", "down": "ArrowDown", "left": "ArrowLeft", "right": "ArrowRight",
    "page_up": "PageUp", "pageup": "PageUp", "page_down": "PageDown", "pagedown": "PageDown",
    "home": "Home", "end": "End",
}


def _playwright_key(combo):
    parts = re.split(r"[+\s]+", (combo or "").strip())
    out = []
    for p in parts:
        if not p:
            continue
        low = p.lower()
        if low in _KEY_TOKENS:
            out.append(_KEY_TOKENS[low])
        elif len(p) == 1:
            out.append(p.upper() if p.isalpha() else p)
        else:
            out.append(p[:1].upper() + p[1:])
    return "+".join(out) if out else (combo or "")


def _run_cli_capture(extra_args, timeout=60):
    def _run():
        completed = subprocess.run(
            [NODE_EXE, CLI_SCRIPT, _COMPUTER_SESSION, *extra_args],
            cwd=INSTALL_DIR,
            env=_windows_cli_env(),
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
        return completed.returncode, completed.stdout or "", completed.stderr or ""

    rc, out, err = _run()
    # The computer-use path (/computer) has no bridge-level auto-attach like /run,
    # so if the session isn't live (bridge/Chrome restarted), attach it over CDP
    # and retry once — otherwise a stray restart makes every computer action fail.
    if rc != 0 and _session_missing(out, err) and _auto_attach_session([_COMPUTER_SESSION], timeout):
        rc, out, err = _run()
    return rc, out, err


def _extract_sentinel(stdout):
    # playwright-cli prints the run-code return value inside a block:
    #   ### Result
    #   <json-encoded value>
    #   ### Ran Playwright code
    #   ```js ... ```
    # We must anchor on the "### Result" block, NOT a raw sentinel search: the CLI
    # also echoes our code (which literally contains the sentinel), so rfind would
    # match the echo. The value is JSON-encoded (a quoted string), so json.loads it.
    m = re.search(r"### Result\s*\n(.*?)\n### ", stdout, re.S)
    if not m:
        m = re.search(r"### Result\s*\n(.*)\Z", stdout, re.S)
    if not m:
        return None
    val = m.group(1).strip()
    try:
        decoded = json.loads(val)
    except Exception:
        decoded = val
    if isinstance(decoded, str) and decoded.startswith(_COMPUTER_SENTINEL):
        return decoded[len(_COMPUTER_SENTINEL):]
    return None


def _computer_viewport():
    js = ("async (page) => { const v = await page.evaluate(() => ({vw: window.innerWidth, "
          "vh: window.innerHeight, dpr: window.devicePixelRatio})); return '" + _COMPUTER_SENTINEL
          + "' + JSON.stringify(v); }")
    rc, out, err = _run_cli_capture(["run-code", js])
    raw = _extract_sentinel(out)
    if rc != 0 or not raw:
        return {"ok": False, "error": (err or out or "viewport read failed").strip()[:300]}
    try:
        v = json.loads(raw)
        return {"ok": True, "vw": int(v["vw"]), "vh": int(v["vh"]), "dpr": float(v.get("dpr", 1))}
    except Exception as exc:
        return {"ok": False, "error": f"viewport parse failed: {exc}"}


def _computer_page_label():
    # Read the active page's URL basename + title so a bare `screenshot` gets a
    # human-readable filename (xiaoni-computer-<ts>-blinds.png) instead of an
    # opaque timestamp. Computer-use's screenshot action carries no caption, so
    # the page itself is the only label source. Best-effort: any failure returns
    # empty and the caller falls back to the plain timestamp name.
    js = ("async (page) => { const v = await page.evaluate(() => ({"
          "path: (location.pathname || '').split('/').pop() || '', "
          "title: (document.title || '').trim()})); return '" + _COMPUTER_SENTINEL
          + "' + JSON.stringify(v); }")
    try:
        rc, out, _err = _run_cli_capture(["run-code", js])
        raw = _extract_sentinel(out)
        if rc != 0 or not raw:
            return {"path": "", "title": ""}
        v = json.loads(raw)
        return {"path": str(v.get("path") or ""), "title": str(v.get("title") or "")}
    except Exception:
        return {"path": "", "title": ""}


def _slug_for_label(path="", title=""):
    # URL basename wins (stable, predictable: blinds.html -> blinds); title is a
    # fallback. CJK titles slug to empty under [^A-Za-z0-9], which is exactly why
    # basename is preferred. Returns None when nothing usable remains.
    base = re.sub(r"\.\w+$", "", path or "")
    raw = base or title or ""
    slug = re.sub(r"[^A-Za-z0-9]+", "-", raw).strip("-").lower()[:40].strip("-")
    return slug or None


def _build_action_statements(action, css, css_end):
    name = action.get("action")
    text = action.get("text") or ""
    if name in ("screenshot", "cursor_position"):
        return ""
    if name == "wait":
        dur = action.get("duration")
        ms = int(float(dur) * 1000) if isinstance(dur, (int, float)) else 1000
        return f"await new Promise(r=>setTimeout(r,{ms}));"
    if name == "mouse_move":
        return f"await page.mouse.move({css[0]},{css[1]});"
    if name == "left_click":
        return f"await page.mouse.click({css[0]},{css[1]});"
    if name == "right_click":
        return f"await page.mouse.click({css[0]},{css[1]},{{button:'right'}});"
    if name == "middle_click":
        return f"await page.mouse.click({css[0]},{css[1]},{{button:'middle'}});"
    if name == "double_click":
        return f"await page.mouse.dblclick({css[0]},{css[1]});"
    if name == "triple_click":
        return f"await page.mouse.click({css[0]},{css[1]},{{clickCount:3}});"
    if name == "left_mouse_down":
        return f"await page.mouse.move({css[0]},{css[1]});await page.mouse.down();"
    if name == "left_mouse_up":
        return "await page.mouse.up();"
    if name == "left_click_drag":
        return (f"await page.mouse.move({css[0]},{css[1]});await page.mouse.down();"
                f"await page.mouse.move({css_end[0]},{css_end[1]});await page.mouse.up();")
    if name == "type":
        return f"await page.keyboard.type({json.dumps(text)});"
    if name == "key":
        return f"await page.keyboard.press({json.dumps(_playwright_key(text))});"
    if name == "hold_key":
        dur = action.get("duration")
        ms = int(float(dur) * 1000) if isinstance(dur, (int, float)) else 500
        k = json.dumps(_playwright_key(text))
        return f"await page.keyboard.down({k});await new Promise(r=>setTimeout(r,{ms}));await page.keyboard.up({k});"
    if name == "scroll":
        direction = action.get("scroll_direction", "down")
        amount = action.get("scroll_amount", 3)
        try:
            step = int(amount) * 100
        except Exception:
            step = 300
        dx = step if direction == "right" else -step if direction == "left" else 0
        dy = step if direction == "down" else -step if direction == "up" else 0
        move = f"await page.mouse.move({css[0]},{css[1]});" if css else ""
        return f"{move}await page.mouse.wheel({dx},{dy});"
    return ""  # unknown action -> screenshot only


def _resize_png_to_declared(png_b64, dw, dh):
    raw = base64.b64decode(png_b64)
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    # LANCZOS is markedly sharper than the default (BICUBIC) when downscaling the
    # native 2561px-wide capture to the declared display — matters for small CJK text.
    img = img.resize((dw, dh), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _run_computer_action(action, dw, dh):
    if not _PIL_OK:
        return {"ok": False, "error": "Pillow not installed on the bridge host (pip install Pillow)"}
    if computer_coords is None:
        return {"ok": False, "error": "computer_coords not importable on the bridge host"}
    name = action.get("action")
    region = action.get("region")
    css = css_end = None
    need_vp = (name in _COORD_ACTIONS) or name == "zoom" or isinstance(region, list)
    if need_vp:
        vp = _computer_viewport()
        if not vp.get("ok"):
            return {"ok": False, "error": vp.get("error", "viewport read failed")}
        vw, vh = vp["vw"], vp["vh"]
        coord = action.get("coordinate")
        start = action.get("start_coordinate")
        if name == "left_click_drag" and isinstance(start, list) and len(start) == 2 and isinstance(coord, list):
            css = computer_coords.map_point(start[0], start[1], vw, vh, dw, dh)
            css_end = computer_coords.map_point(coord[0], coord[1], vw, vh, dw, dh)
        elif isinstance(coord, list) and len(coord) == 2:
            css = computer_coords.map_point(coord[0], coord[1], vw, vh, dw, dh)

    # zoom: crop the live region, then resize the crop back to the declared display.
    if name == "zoom" and isinstance(region, list) and len(region) == 4:
        x1, y1, x2, y2 = computer_coords.map_region(region, vw, vh, dw, dh)
        w, h = max(1, x2 - x1), max(1, y2 - y1)
        js = ("async (page) => { const b = await page.screenshot({type:'png', animations:'disabled', caret:'initial', timeout:15000, clip:{x:"
              f"{x1},y:{y1},width:{w},height:{h}}}); return '" + _COMPUTER_SENTINEL + "' + b.toString('base64'); }")
    else:
        statements = _build_action_statements(action, css, css_end)
        # animations:'disabled' finishes+freezes CSS animations (incl. smooth
        # scroll) before capture, so page.screenshot doesn't hang on the headed
        # Wayland compositor after a mouse/scroll action; timeout bounds the wait.
        js = ("async (page) => { " + statements +
              " const b = await page.screenshot({type:'png', animations:'disabled', caret:'initial', timeout:15000}); return '" + _COMPUTER_SENTINEL +
              "' + b.toString('base64'); }")

    rc, out, err = _run_cli_capture(["run-code", js], timeout=90)
    raw_b64 = _extract_sentinel(out)
    if rc != 0 or not raw_b64:
        return {"ok": False, "error": (err or out or "action/screenshot failed").strip()[:400]}
    try:
        resized = _resize_png_to_declared(raw_b64, dw, dh)
    except Exception as exc:
        return {"ok": False, "error": f"screenshot resize failed: {exc}"}
    result = {"ok": True, "action": name, "image_base64": resized}
    # A bare `screenshot` is the explicit "capture the screen" action; persist the
    # full-res PNG into Xiaoni's shared runtime so she has a real file path she can
    # send via qq-send-image. The vision base64 alone is not a sendable artifact.
    if name == "screenshot":
        try:
            label = _slug_for_label(**_computer_page_label())
            result["saved_path"] = _save_png_to_runtime_picture_dir(
                base64.b64decode(raw_b64), label=label)
        except Exception:
            pass
    return result


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return
        self._json(200, {"ok": True})

    def do_POST(self):
        if self.path == "/computer":
            self._handle_computer()
            return
        if self.path != "/run":
            self.send_error(404)
            return
        length = int(self.headers.get("content-length", "0"))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            args = payload.get("args")
            if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
                raise ValueError("args must be a string array")
            fallback_error = _removed_fallback_error(args)
            if fallback_error:
                self._json(200, {
                    "ok": False,
                    "returncode": 2,
                    "stdout": "",
                    "stderr": fallback_error + "\n",
                })
                return
            if args and args[0] == "ensure-cdp":
                result = _ensure_cdp("--restart" in args)
                self._json(200, {
                    "ok": bool(result.get("ok")),
                    "returncode": 0 if result.get("ok") else 2,
                    "stdout": json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                    "stderr": "",
                })
                return
            if args and args[0] == "ensure-extension":
                result = _ensure_extension("--restart" in args)
                self._json(200, {
                    "ok": bool(result.get("ok")),
                    "returncode": 0 if result.get("ok") else 2,
                    "stdout": json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                    "stderr": "",
                })
                return
            _ensure_cli_wrapper_exit_code()
            is_extension_attach = _is_extension_attach(args)
            timeout_seconds = _command_timeout_seconds(args, payload.get("timeout_seconds"))
            if is_extension_attach:
                completed = _run_extension_attach_with_heal(args, timeout_seconds)
                self._json(200, {
                    "ok": completed["returncode"] == 0,
                    "returncode": completed["returncode"],
                    "stdout": completed["stdout"],
                    "stderr": completed["stderr"],
                    **({"timed_out": True} if completed.get("timed_out") else {}),
                })
                return
            media_url = _media_goto_url(args)
            if media_url:
                # Raw image/SVG top-level navigation hangs the relay and wedges the
                # session (later commands + computer-use screenshots then time out).
                # Load the media inside an HTML wrapper so the top document is HTML.
                args = _wrap_media_goto_args(_session_name(args), media_url)
            completed = _run_passthrough(args, timeout_seconds)
            # Session lifecycle is the bridge's job, not Xiaoni's. If a normal
            # command finds no live session (Chrome was restarted without the
            # patched extension, or the daemon died), silently attach — healing a
            # missing extension by relaunching Chrome with it — and retry once.
            if (
                completed["returncode"] != 0
                and _is_auto_attachable(args)
                and _session_missing(completed["stdout"], completed["stderr"])
                and _auto_attach_session(args, timeout_seconds)
            ):
                completed = _run_passthrough(args, timeout_seconds)
            # A blocking `beforeunload` dialog (interactive pages — games, editors,
            # canvas apps) freezes every navigation with a 60s TimeoutError. A
            # `goto` means "leave this page", so accept the dialog and retry once.
            if _is_navigation(args) and _looks_like_nav_timeout(completed):
                session = _session_name(args)
                modal = _run_passthrough([f"-s={session}", "tab-list"], 20)
                if "beforeunload" in (modal["stdout"] or ""):
                    _run_passthrough([f"-s={session}", "dialog-accept"], 20)
                    completed = _run_passthrough(args, timeout_seconds)
            self._json(200, {
                "ok": completed["returncode"] == 0,
                "returncode": completed["returncode"],
                "stdout": _augment_browser_artifacts(completed["stdout"], args),
                "stderr": completed["stderr"],
                **({"timed_out": True} if completed.get("timed_out") else {}),
            })
        except Exception as error:
            self._json(500, {"ok": False, "error": str(error)})

    def _handle_computer(self):
        length = int(self.headers.get("content-length", "0"))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            action = payload.get("action")
            if not isinstance(action, dict) or not isinstance(action.get("action"), str):
                raise ValueError("action must be an object with a string 'action' field")
            dw = int(payload.get("display_width_px") or 1024)
            dh = int(payload.get("display_height_px") or 506)
            result = _run_computer_action(action, dw, dh)
            self._json(200, result)
        except Exception as error:
            self._json(200, {"ok": False, "error": str(error)})

    def log_message(self, fmt, *args):
        return

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="Bridge Xiaoni executor commands to host patched playwright-cli.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"xiaoni playwright-cli bridge listening on {args.host}:{args.port}", flush=True)
    server.serve_forever()


def _decode_timeout_output(value):
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def _primary_command(args):
    skip_next = False
    for arg in args:
        if skip_next:
            skip_next = False
            continue
        if arg in ("-s", "--s", "--session"):
            skip_next = True
            continue
        if arg.startswith("-s=") or arg.startswith("--s=") or arg.startswith("--session="):
            continue
        if arg.startswith("-"):
            continue
        return arg
    return ""


def _removed_fallback_error(args):
    command = _primary_command(args)
    if command == "open":
        return (
            "Xiaoni browser fallback removed: `open` creates a separate Playwright "
            "browser session that can show as `<in-memory>` instead of the operator's "
            "visible Chrome Profile 2. Run `ensure-extension` and "
            "`attach --extension=chrome`; if attach fails, fix attach instead of using `open`."
        )
    # (Linux) CDP is the native attach path now — do not block it.
    return ""


def _is_cdp_attach(args):
    return _primary_command(args) == "attach" and any(arg == "--cdp" or arg.startswith("--cdp=") for arg in args)


def _is_extension_attach(args):
    return "attach" in args and any(arg.startswith("--extension") for arg in args)


def _ensure_cli_wrapper_exit_code():
    # No-op on Linux: the original patched a PowerShell .ps1 wrapper to force an
    # exit code and inject env. Here the CLI is invoked directly via `node`, and
    # the required env is set in _windows_cli_env().
    return


def _command_timeout_seconds(args, requested_timeout):
    timeout_seconds = int(requested_timeout or 120)
    if _is_extension_attach(args):
        attach_timeout = max(1, DEFAULT_EXTENSION_ATTACH_TIMEOUT_SECONDS)
        return min(timeout_seconds, attach_timeout)
    return timeout_seconds


def _session_name(args):
    for index, arg in enumerate(args):
        if arg.startswith("-s="):
            return arg.split("=", 1)[1] or "default"
        if arg.startswith("--s="):
            return arg.split("=", 1)[1] or "default"
        if arg in ("-s", "--s") and index + 1 < len(args):
            return args[index + 1] or "default"
    return "default"


def _stream_pipe(pipe, chunks):
    try:
        while True:
            chunk = pipe.readline()
            if not chunk:
                break
            chunks.append(chunk)
    finally:
        try:
            pipe.close()
        except Exception:
            pass


def _run_extension_attach(args, timeout_seconds):
    session_name = _session_name(args)
    with ATTACH_LOCK:
        existing = ATTACH_PROCESSES.get(session_name)
        if existing and existing.get("process") and existing["process"].poll() is None:
            return {
                "returncode": 0,
                "stdout": f"### Session `{session_name}` already attached to `chrome`.\nRun commands with: playwright-cli --s={session_name} <command>\n",
                "stderr": "",
            }

    process = subprocess.Popen(
        [NODE_EXE, CLI_SCRIPT, *args],
        cwd=INSTALL_DIR,
        env=_windows_cli_env(),
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    stdout_chunks = []
    stderr_chunks = []
    stdout_thread = threading.Thread(target=_stream_pipe, args=(process.stdout, stdout_chunks), daemon=True)
    stderr_thread = threading.Thread(target=_stream_pipe, args=(process.stderr, stderr_chunks), daemon=True)
    stdout_thread.start()
    stderr_thread.start()

    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        stdout = "".join(stdout_chunks)
        stderr = "".join(stderr_chunks)
        if _attach_failed(stdout, stderr):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
            stdout_thread.join(timeout=1)
            stderr_thread.join(timeout=1)
            return {
                "returncode": process.returncode if process.returncode not in (None, 0) else 1,
                "stdout": "".join(stdout_chunks),
                "stderr": "".join(stderr_chunks),
            }
        if _attach_ready(stdout):
            _remember_attach_process(session_name, process, stdout_chunks, stderr_chunks)
            return {
                "returncode": 0,
                "stdout": stdout + "\n[bridge] attach daemon passed initial snapshot; continue with tab-list, snapshot, or goto.\n",
                "stderr": stderr,
            }
        if process.poll() is not None:
            stdout_thread.join(timeout=1)
            stderr_thread.join(timeout=1)
            stdout = "".join(stdout_chunks)
            stderr = "".join(stderr_chunks)
            if _attach_ready(stdout):
                return {
                    "returncode": 0,
                    "stdout": stdout,
                    "stderr": stderr,
                }
            returncode = process.returncode
            if _attach_failed(stdout, stderr) and returncode == 0:
                returncode = 1
            return {
                "returncode": returncode,
                "stdout": stdout,
                "stderr": stderr,
            }
        time.sleep(0.1)

    process.terminate()
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        process.kill()
    stdout_thread.join(timeout=1)
    stderr_thread.join(timeout=1)
    return {
        "returncode": 124,
        "stdout": "".join(stdout_chunks),
        "stderr": "".join(stderr_chunks) + f"\n[bridge] attach command timed out before session `{session_name}` passed initial snapshot.\n",
        "timed_out": True,
    }


def _attach_ready(stdout):
    return "### Error" not in stdout and ("### Snapshot" in stdout or "### Result" in stdout)


def _attach_failed(stdout, stderr):
    text = f"{stdout}\n{stderr}"
    return (
        "### Error" in stdout
        or "Could not start the session" in text
        or "Target page, context or browser has been closed" in text
        or "Error: Playwright Extension not found" in text
    )


def _remember_attach_process(session_name, process, stdout_chunks, stderr_chunks):
    with ATTACH_LOCK:
        previous = ATTACH_PROCESSES.get(session_name)
        if previous and previous.get("process") and previous["process"].poll() is None:
            previous["process"].terminate()
        ATTACH_PROCESSES[session_name] = {
            "process": process,
            "stdout": stdout_chunks,
            "stderr": stderr_chunks,
        }


def _forget_attach_process(session_name):
    with ATTACH_LOCK:
        entry = ATTACH_PROCESSES.pop(session_name, None)
    if entry and entry.get("process") and entry["process"].poll() is None:
        try:
            entry["process"].terminate()
        except Exception:
            pass


def _session_missing(stdout, stderr):
    # The official playwright-cli prints this when the named session has no live
    # browser (never attached, or the attach daemon / Chrome target died). The
    # message wording varies by CLI version — older: "... is not open, please run
    # open first"; current: "Browser '<name>' is not open. Run ... open [params]".
    # Match the stable "is not open" stem so auto-attach fires either way.
    text = f"{stdout}\n{stderr}"
    return "is not open" in text


_AUTO_ATTACH_CONTROL_COMMANDS = {
    "",
    "attach",
    "open",
    "ensure-extension",
    "ensure-cdp",
    "help",
    "--help",
    "-h",
}


def _is_auto_attachable(args):
    # Ordinary session commands (goto, snapshot, click, tab-list, ...) should
    # auto-attach on a missing session; control/attach commands should not, to
    # avoid recursion.
    return _primary_command(args) not in _AUTO_ATTACH_CONTROL_COMMANDS


def _cdpify(args):
    # On Linux we attach to the headed Chrome over CDP (--remote-debugging-port),
    # which is the native, robust path. Translate any legacy `--extension` attach
    # (what the skill/client still emits) into a `--cdp=<endpoint>` attach.
    out = []
    for a in args:
        if a == "--extension" or a.startswith("--extension="):
            out.append(f"--cdp={CDP_ENDPOINT}")
        else:
            out.append(a)
    return out


def _run_extension_attach_with_heal(args, timeout_seconds):
    # Attach to Chrome over CDP. If it fails (Chrome not up yet, or came up
    # without the debug port), relaunch Chrome once — the launch adds the debug
    # port — and retry, so callers never have to heal by hand.
    args = _cdpify(args)
    completed = _run_extension_attach(args, timeout_seconds)
    if completed["returncode"] != 0:
        _forget_attach_process(_session_name(args))
        _launch_chrome_with_extension(True)
        completed = _run_extension_attach(args, timeout_seconds)
    return completed


def _auto_attach_session(args, timeout_seconds):
    session = _session_name(args)
    _forget_attach_process(session)
    attach_args = [f"-s={session}", "attach", f"--cdp={CDP_ENDPOINT}"]
    completed = _run_extension_attach_with_heal(
        attach_args, _command_timeout_seconds(attach_args, timeout_seconds)
    )
    return completed["returncode"] == 0


def _is_navigation(args):
    return _primary_command(args) in ("goto", "navigate")


_MEDIA_GOTO_EXT_RE = re.compile(r"\.(svg|png|jpe?g|gif|webp|bmp|ico|avif)(?:$|[?#])", re.IGNORECASE)


def _goto_target_url(args):
    if _primary_command(args) != "goto":
        return None
    skip_next = False
    saw_goto = False
    for arg in args:
        if skip_next:
            skip_next = False
            continue
        if arg in ("-s", "--s", "--session"):
            skip_next = True
            continue
        if arg.startswith("-"):
            continue
        if not saw_goto:
            saw_goto = arg == "goto"
            continue
        return arg
    return None


def _media_goto_url(args):
    url = _goto_target_url(args)
    if url and url[:4].lower() in ("http",) and _MEDIA_GOTO_EXT_RE.search(url):
        return url
    return None


def _wrap_media_goto_args(session, url):
    # A raw image/SVG as the top-level document never settles the extension relay's
    # navigation wait — it hangs and wedges the whole session. Render it INSIDE an
    # HTML page instead (top document stays HTML), so navigation completes and the
    # image is visible to snapshot / computer-use screenshots.
    js_url = url.replace("\\", "\\\\").replace("'", "\\'")
    html_url = js_url.replace('"', "%22")
    js = (
        "async (page) => { await page.setContent("
        "'<body style=\"margin:0;display:flex;justify-content:center;background:#fff\">"
        "<img src=\"" + html_url + "\" style=\"max-width:100vw;max-height:100vh\"></body>', "
        "{waitUntil:'load', timeout:15000}); return 'loaded image: " + js_url + "'; }"
    )
    return [f"-s={session}", "run-code", js]


def _looks_like_nav_timeout(result):
    text = f"{result.get('stdout', '')}\n{result.get('stderr', '')}"
    return bool(
        result.get("timed_out")
        or result.get("returncode") == 124
        or ("TimeoutError" in text and "navigating to" in text)
    )


def _run_passthrough(args, timeout_seconds):
    try:
        completed = subprocess.run(
            [NODE_EXE, CLI_SCRIPT, *args],
            cwd=INSTALL_DIR,
            env=_windows_cli_env(),
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout_seconds,
        )
        return {
            "returncode": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
            "timed_out": False,
        }
    except subprocess.TimeoutExpired as error:
        return {
            "returncode": 124,
            "stdout": _decode_timeout_output(error.stdout),
            "stderr": _decode_timeout_output(error.stderr),
            "timed_out": True,
        }


def _windows_cli_env():
    # (Linux) Environment for the playwright-cli node process. Points the CLI at
    # the native google-chrome, keeps the MCP relay on loopback, forces the
    # extension protocol, and passes a display through for the headed browser.
    env = os.environ.copy()
    env.setdefault("PLAYWRIGHT_MCP_EXECUTABLE_PATH", CHROME_EXE)
    env.setdefault("PLAYWRIGHT_MCP_HOST", "127.0.0.1")
    env.setdefault("PLAYWRIGHT_EXTENSION_PROTOCOL", "1")
    env.setdefault("DISPLAY", CHROME_DISPLAY)
    env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
    return env


def _ensure_extension(restart):
    extension_dir = Path(EXTENSION_DIR_WSL)
    _prepare_extension_dir(extension_dir)
    _patch_playwright_cli_extension_id()
    launch_result = _launch_chrome_with_extension(restart)
    launch_result.update({
        "ok": bool(launch_result.get("ok")),
        "sourceExtensionId": WEBSTORE_EXTENSION_ID,
        "extensionId": EXTENSION_ID,
        "extensionVersion": EXTENSION_VERSION,
        "extensionDir": EXTENSION_DIR_WIN,
        "profile": CHROME_PROFILE_DIRECTORY,
        "userDataDir": CHROME_USER_DATA_DIR_WIN,
    })
    return launch_result


def _prepare_extension_dir(extension_dir):
    manifest_path = extension_dir / "manifest.json"
    connect_html_path = extension_dir / "connect.html"
    connect_path = extension_dir / "lib" / "ui" / "connect.js"
    background_path = extension_dir / "lib" / "background.mjs"
    if not _extension_dir_is_current(manifest_path, connect_path, background_path):
        _download_and_extract_extension(extension_dir)
    _patch_extension(connect_path, background_path, connect_html_path)


def _extension_dir_is_current(manifest_path, connect_path, background_path):
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        return (
            manifest.get("version") == EXTENSION_VERSION
            and manifest.get("key") == EXTENSION_KEY
            and manifest.get("update_url") is None
            and connect_path.exists()
            and background_path.exists()
        )
    except Exception:
        return False


def _download_and_extract_extension(extension_dir):
    extension_dir.parent.mkdir(parents=True, exist_ok=True)
    temp_dir = extension_dir.parent / f".{extension_dir.name}.download"
    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True)
    crx_path = temp_dir / "extension.crx"
    zip_path = temp_dir / "extension.zip"
    urllib.request.urlretrieve(EXTENSION_CRX_URL, crx_path)
    crx_bytes = crx_path.read_bytes()
    if crx_bytes[:4] != b"Cr24":
        raise RuntimeError("downloaded Playwright extension is not a CRX file")
    version = int.from_bytes(crx_bytes[4:8], "little")
    if version == 2:
        public_key_len = int.from_bytes(crx_bytes[8:12], "little")
        signature_len = int.from_bytes(crx_bytes[12:16], "little")
        zip_offset = 16 + public_key_len + signature_len
    elif version == 3:
        header_len = int.from_bytes(crx_bytes[8:12], "little")
        zip_offset = 12 + header_len
    else:
        raise RuntimeError(f"unsupported CRX version: {version}")
    zip_path.write_bytes(crx_bytes[zip_offset:])
    extract_dir = temp_dir / "extracted"
    with zipfile.ZipFile(zip_path) as archive:
        archive.extractall(extract_dir)
    metadata_dir = extract_dir / "_metadata"
    if metadata_dir.exists():
        shutil.rmtree(metadata_dir)
    manifest = json.loads((extract_dir / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("version") != EXTENSION_VERSION:
        raise RuntimeError(f"unexpected Playwright extension version: {manifest.get('version')}")
    if extension_dir.exists():
        shutil.rmtree(extension_dir)
    shutil.move(str(extract_dir), str(extension_dir))
    shutil.rmtree(temp_dir)


def _patch_extension(connect_path, background_path, connect_html_path):
    manifest_path = connect_path.parents[2] / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["key"] = EXTENSION_KEY
    manifest.pop("update_url", None)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    token_override = _windows_cli_env().get("PLAYWRIGHT_MCP_EXTENSION_TOKEN", "")
    _write_minimal_connect_page(connect_html_path, connect_path, token_override)

    background = background_path.read_text(encoding="utf-8")
    background = background.replace(
        'const NON_DEBUGGABLE_SCHEMES = ["chrome:", "edge:", "devtools:"];',
        'const NON_DEBUGGABLE_SCHEMES = ["chrome:", "chrome-extension:", "edge:", "devtools:"];',
    )
    background_path.write_text(background, encoding="utf-8")


def _write_minimal_connect_page(connect_html_path, connect_script_path, token):
    connect_script_path.write_text(_minimal_connect_script(token), encoding="utf-8")
    html = """<!DOCTYPE html>
<html>
<head>
  <title>Xiaoni Playwright Extension</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script type="module" crossorigin src="/lib/ui/connect.js"></script>
</head>
<body>
  <pre id="status">connecting</pre>
</body>
</html>
"""
    connect_html_path.write_text(html, encoding="utf-8")


def _minimal_connect_script(token):
    expected_token = json.dumps(token)
    return f"""const status = document.getElementById("status");
const setStatus = (message) => {{
  if (status)
    status.textContent = message;
  document.title = message;
}};
const params = new URLSearchParams(window.location.search);
const relayUrl = params.get("mcpRelayUrl");
const token = params.get("token") || "";
const expectedToken = {expected_token};
const protocolVersion = Number.parseInt(params.get("protocolVersion") || "1", 10) || 1;
const client = (() => {{
  try {{
    return JSON.parse(params.get("client") || "{{}}");
  }} catch {{
    return {{}};
  }}
}})();
const isVisibleTab = (tab) => tab && tab.url && !["chrome:", "chrome-extension:", "edge:", "devtools:"].some((scheme) => tab.url.startsWith(scheme));
const pickTab = (tabs) => {{
  const visibleTabs = tabs.filter(isVisibleTab);
  const score = (tab) => {{
    let value = 0;
    if (tab.url && tab.url.startsWith("https://gemini.google.com/"))
      value += 1000000000000000;
    if (tab.active)
      value += 1000000000000;
    if (typeof tab.lastAccessed === "number")
      value += tab.lastAccessed;
    return value;
  }};
  return [...visibleTabs].sort((a, b) => score(b) - score(a) || a.index - b.index)[0];
}};
const main = async () => {{
  if (!relayUrl)
    throw new Error("Missing mcpRelayUrl");
  const host = new URL(relayUrl).hostname;
  if (host !== "127.0.0.1" && host !== "[::1]")
    throw new Error(`Rejected non-loopback relay host: ${{host}}`);
  if (expectedToken && token !== expectedToken)
    throw new Error("Invalid Xiaoni extension token");
  setStatus("requesting connection");
  const requested = await chrome.runtime.sendMessage({{ type: "connectionRequested", mcpRelayUrl: relayUrl, protocolVersion }});
  if (!(requested && requested.success))
    throw new Error((requested && requested.error) || "connectionRequested failed");
  const tabResponse = await chrome.runtime.sendMessage({{ type: "getTabs" }});
  if (!(tabResponse && tabResponse.success))
    throw new Error((tabResponse && tabResponse.error) || "getTabs failed");
  let tab = pickTab(tabResponse.tabs || []);
  if (!tab)
    tab = await chrome.tabs.create({{ url: "about:blank", active: true }});
  setStatus(`connecting tab ${{tab.id}}`);
  const connected = await chrome.runtime.sendMessage({{ type: "connectToTab", tab, clientName: client.name || "xiaoni" }});
  if (!(connected && connected.success))
    throw new Error((connected && connected.error) || "connectToTab failed");
  setStatus("connected");
}};
main().catch((error) => {{
  console.error(error);
  setStatus(`error: ${{error.message || error}}`);
}});
"""


def _auto_connect_block(token_guard):
    return """      if (__TOKEN_GUARD__) {
        const tabResponse = await chrome.runtime.sendMessage({ type: "getTabs" });
        let targetTab = pickAutoConnectTab(tabResponse);
        if (!targetTab)
          targetTab = await chrome.tabs.create({ url: "about:blank", active: true });
        await handleConnectToTab(targetTab);
        return;
      }""".replace("__TOKEN_GUARD__", token_guard)


def _patch_playwright_cli_extension_id():
    for file_name in CLI_EXTENSION_FILES:
        path = Path(file_name)
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        patched = re.sub(
            r'playwrightExtensionId = "[a-p]{32}"',
            f'playwrightExtensionId = "{EXTENSION_ID}"',
            text,
        )
        patched = patched.replace(
            "if (userDataDir && !await isPlaywrightExtensionInstalled(userDataDir))\n      throw new Error(`Playwright Extension not found in \"${userDataDir}\". Install it from ${playwrightExtensionInstallUrl}`);",
            "if (false && userDataDir && !await isPlaywrightExtensionInstalled(userDataDir))\n      throw new Error(`Playwright Extension not found in \"${userDataDir}\". Install it from ${playwrightExtensionInstallUrl}`);",
        )
        patched = _patch_cli_extension_relay_loopback(patched)
        if patched != text:
            path.write_text(patched, encoding="utf-8")


def _patch_cli_extension_relay_loopback(text):
    if 'this._wsHost.replace("ws://[::1]", "ws://127.0.0.1")' in text:
        patched = text
    else:
        patched = text.replace(
            'const mcpRelayEndpoint = `${this._wsHost}${this._extensionPath}`;',
            'const mcpRelayEndpoint = `${this._wsHost.replace("ws://[::1]", "ws://127.0.0.1")}${this._extensionPath}`;',
        )
    patched = patched.replace(
        "new URL(`chrome-extension://${playwrightExtensionId}/xiaoni-connect.html`)",
        "new URL(`chrome-extension://${playwrightExtensionId}/connect.html`)",
    )
    return patched.replace(
        "await startHttpServer(httpServer, {});",
        'await startHttpServer(httpServer, { host: "127.0.0.1" });',
    )


def _cdp_alive():
    try:
        with urllib.request.urlopen(CDP_ENDPOINT.rstrip("/") + "/json/version", timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


def _chrome_pids_for_userdata():
    # Top-level Chrome browser processes only. Match by process NAME (comm ==
    # "chrome") via `pgrep -x`, NOT by a cmdline substring — a substring match
    # (e.g. "google/chrome/chrome") also hits unrelated processes that merely
    # mention the path (a shell running a chrome-related command), which we would
    # then wrongly kill. `-x chrome` excludes the crashpad handler (comm
    # "chrome_crashpad"); we drop --type= children by reading each cmdline.
    try:
        out = subprocess.run(
            ["pgrep", "-x", "chrome"],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        ).stdout
    except Exception:
        return []
    pids = []
    for tok in out.split():
        if not tok.isdigit():
            continue
        try:
            with open(f"/proc/{tok}/cmdline", "rb") as fh:
                cmd = fh.read().replace(b"\x00", b" ").decode("utf-8", "replace")
        except OSError:
            continue
        if "--type=" in cmd:
            continue  # renderer / gpu / zygote child
        pids.append(int(tok))
    return pids


def _terminate_pids(pids):
    for sig in (signal.SIGTERM, signal.SIGKILL):
        alive = []
        for pid in pids:
            try:
                os.kill(pid, sig)
                alive.append(pid)
            except ProcessLookupError:
                pass
            except Exception:
                pass
        if not alive:
            break
        time.sleep(2)


def _setup_cdp_mirror():
    # Point the mirror user-data-dir at the operator's real logged-in profile via
    # a symlink, and copy Local State (profile list + cookie-encryption key) so
    # cookies/logins decrypt. The mirror is a non-default dir, so Chrome 136+
    # allows --remote-debugging-port on it. Only one Chrome uses the shared
    # profile at a time (callers kill the others first), so there is no
    # concurrent write to the profile files.
    os.makedirs(CHROME_USER_DATA_DIR, exist_ok=True)
    link = os.path.join(CHROME_USER_DATA_DIR, CHROME_PROFILE_DIRECTORY)
    target = os.path.join(REAL_CHROME_USER_DATA_DIR, CHROME_PROFILE_DIRECTORY)
    try:
        if os.path.islink(link):
            if os.readlink(link) != target:
                os.unlink(link)
                os.symlink(target, link)
        elif not os.path.exists(link):
            os.symlink(target, link)
    except OSError:
        pass
    try:
        shutil.copy2(os.path.join(REAL_CHROME_USER_DATA_DIR, "Local State"),
                     os.path.join(CHROME_USER_DATA_DIR, "Local State"))
    except OSError:
        pass
    for lock in ("SingletonLock", "SingletonSocket", "SingletonCookie"):
        try:
            os.remove(os.path.join(CHROME_USER_DATA_DIR, lock))
        except OSError:
            pass


def _launch_chrome_with_extension(restart):
    running = _chrome_pids_for_userdata()
    if running and not restart and _cdp_alive():
        # Chrome is already up on the profile WITH the debug port — reuse it.
        return {"ok": True, "restarted": False, "profile": CHROME_PROFILE_DIRECTORY,
                "userDataDir": CHROME_USER_DATA_DIR, "returncode": 0}
    # Take the browser over: kill any Chrome on the profile (the user's or an old
    # CDP instance), then relaunch the CDP-enabled mirror on the same real profile.
    _terminate_pids(running)
    _setup_cdp_mirror()
    env = _windows_cli_env()
    args = [
        CHROME_EXE,
        f"--remote-debugging-port={CDP_PORT}",
        "--remote-debugging-address=127.0.0.1",
        f"--user-data-dir={CHROME_USER_DATA_DIR}",
        f"--profile-directory={CHROME_PROFILE_DIRECTORY}",
        "--restore-last-session",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=DialMediaRouteProvider",
    ]
    if CHROME_OZONE_PLATFORM:
        args.insert(1, f"--ozone-platform={CHROME_OZONE_PLATFORM}")
    try:
        subprocess.Popen(
            args, env=env,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception as exc:
        return {"ok": False, "error": f"failed to launch chrome: {exc}", "returncode": 1}
    for _ in range(20):  # wait up to ~10s for the CDP endpoint
        time.sleep(0.5)
        if _cdp_alive():
            break
    return {"ok": True, "restarted": bool(restart), "profile": CHROME_PROFILE_DIRECTORY,
            "userDataDir": CHROME_USER_DATA_DIR, "returncode": 0}


def _ensure_cdp(restart):
    # CDP mode is disabled on Linux. The extension-attach path is primary and the
    # CDP fallback was removed upstream (see _removed_fallback_error). Kept as a
    # stub so the ensure-cdp route returns a clear message instead of erroring.
    return {"ok": False, "returncode": 2,
            "error": "CDP mode is disabled; use ensure-extension then "
                     "attach --extension=chrome"}


def _strip_clixml(value):
    return re.sub(r"#< CLIXML[\s\S]*$", "", value or "").strip()


def _augment_browser_artifacts(stdout, args):
    if "screenshot" not in args:
        return stdout
    copied_paths = []
    inspectable_images = []
    image_errors = []
    for raw_path in _extract_markdown_artifact_paths(stdout):
        source_path = _resolve_cli_artifact_path(raw_path)
        if not source_path or not source_path.exists() or source_path.suffix.lower() != ".png":
            continue
        container_path = _copy_to_runtime_picture_dir(source_path)
        copied_paths.append(container_path)
        registration = _register_runtime_picture(container_path)
        if registration.get("ok"):
            inspectable_images.append(registration)
        else:
            image_errors.append(registration.get("error") or "image is not inspectable yet")
    if not copied_paths:
        return stdout
    lines = ["", "### Xiaoni runtime artifacts"]
    lines.extend(f"- {path}" for path in copied_paths)
    if inspectable_images:
        lines.append("")
        lines.append("### Images")
        for item in inspectable_images:
            placeholder = item.get("placeholder") or f"<image>pic<{item.get('image_id')}></image>"
            lines.append(f"- {placeholder}")
    if image_errors:
        lines.append("")
        lines.append("### Image notes")
        lines.extend(f"- {error}" for error in image_errors)
    return stdout.rstrip() + "\n" + "\n".join(lines) + "\n"


def _extract_markdown_artifact_paths(stdout):
    return re.findall(r"\]\(([^)\r\n]+\.(?:png|jpg|jpeg|webp))\)", stdout, flags=re.IGNORECASE)


def _resolve_cli_artifact_path(raw_path):
    normalized = raw_path.replace("\\", "/")
    if re.match(r"^[A-Za-z]:/", normalized):
        drive = normalized[0].lower()
        return Path(f"/mnt/{drive}/{normalized[3:]}")
    path = Path(normalized)
    if path.is_absolute():
        return path
    return Path(INSTALL_DIR_WSL) / path


def _copy_to_runtime_picture_dir(source_path):
    picture_dir = Path(RUNTIME_HOST_ROOT) / "picture"
    picture_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination_name = f"xiaoni-browser-{timestamp}-{source_path.name}"
    destination = picture_dir / destination_name
    shutil.copy2(source_path, destination)
    return f"{RUNTIME_CONTAINER_ROOT}/picture/{destination_name}"


def _save_png_to_runtime_picture_dir(png_bytes, label=None):
    # Persist computer-use screenshot bytes (the bridge holds them in-memory; unlike
    # the playwright-cli path there is no host file to copy) into the shared runtime
    # picture dir and return the container-visible path qq-send-image can read.
    # An optional page-derived label disambiguates the filename so 116 shots don't
    # all read as bare timestamps (blinds vs diary was picked wrong for exactly this).
    picture_dir = Path(RUNTIME_HOST_ROOT) / "picture"
    picture_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    suffix = f"-{label}" if label else ""
    destination_name = f"xiaoni-computer-{timestamp}{suffix}.png"
    destination = picture_dir / destination_name
    destination.write_bytes(png_bytes)
    return f"{RUNTIME_CONTAINER_ROOT}/picture/{destination_name}"


def _provider_registration_urls():
    explicit = os.environ.get("XIAONI_MEDIA_REGISTER_URL", "").strip()
    if explicit:
        return [explicit]
    bases = []
    if PROVIDER_SERVICE_URL:
        bases.append(PROVIDER_SERVICE_URL)
    bases.extend(["http://qqbot-provider-service:8090", "http://127.0.0.1:8091"])
    urls = []
    for base in bases:
        base = base.rstrip("/")
        if not base:
            continue
        url = f"{base}/api/internal/media-assets/register-local"
        if url not in urls:
            urls.append(url)
    return urls


def _register_runtime_picture(container_path):
    payload = json.dumps({
        "local_path": container_path,
        "session_key": os.environ.get("XIAONI_SESSION_KEY", "xiaoni:global"),
        "chat_type": os.environ.get("XIAONI_CHAT_TYPE", "direct"),
        "registered_by": "xiaoni-browser"
    }).encode("utf-8")
    last_error = None
    for url in _provider_registration_urls():
        request = urllib.request.Request(
            url,
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                body = response.read().decode("utf-8", errors="replace")
            parsed = json.loads(body)
            if not parsed.get("success"):
                last_error = parsed.get("error") or f"registration failed via {url}"
                continue
            data = parsed.get("data") or {}
            image_id = data.get("image_id")
            if not image_id:
                last_error = f"provider did not return an image id via {url}"
                continue
            return {
                "ok": True,
                "image_id": image_id,
                "media_tag": data.get("media_tag"),
                "placeholder": data.get("placeholder") or f"<image>pic<{image_id}></image>",
            }
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, http.client.HTTPException, ConnectionError) as exc:
            last_error = str(exc)
    return {
        "ok": False,
        "error": f"saved screenshot, but image inspection is unavailable: {last_error or 'provider not reachable'}",
    }


if __name__ == "__main__":
    main()

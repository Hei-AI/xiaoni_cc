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
NODE_EXE = "/mnt/c/Program Files/nodejs/node.exe"
POWERSHELL_EXE = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
CLI_SCRIPT_WIN = "C:\\temp\\xiaoni-playwright-cli\\node_modules\\@playwright\\cli\\playwright-cli.js"
CLI_WRAPPER_WIN = "C:\\temp\\xiaoni-playwright-cli\\xiaoni-playwright-cli.ps1"
CLI_SCRIPT_WSL = "/mnt/c/temp/xiaoni-playwright-cli/xiaoni-playwright-cli.ps1"
INSTALL_DIR_WSL = "/mnt/c/temp/xiaoni-playwright-cli"
RUNTIME_HOST_ROOT = os.environ.get("XIAONI_RUNTIME_HOST_ROOT", "/home/liahua/.qqbot-local/xiaoni-runtime")
RUNTIME_CONTAINER_ROOT = os.environ.get("XIAONI_RUNTIME_CONTAINER_ROOT", "/xiaoni-runtime")
PROVIDER_SERVICE_URL = os.environ.get("PROVIDER_SERVICE_URL", "").rstrip("/")
CDP_ENDPOINT = os.environ.get("XIAONI_BROWSER_CDP_ENDPOINT", "http://127.0.0.1:9222")
CDP_PORT = os.environ.get("XIAONI_BROWSER_CDP_PORT", "9222")
CHROME_EXE_WIN = os.environ.get("XIAONI_CHROME_EXE_WIN", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
CHROME_USER_DATA_DIR_WIN = os.environ.get("XIAONI_CHROME_USER_DATA_DIR_WIN", "C:\\Users\\a8517\\AppData\\Local\\Google\\Chrome\\User Data")
CHROME_CDP_USER_DATA_DIR_WIN = os.environ.get("XIAONI_CHROME_CDP_USER_DATA_DIR_WIN", "C:\\Users\\a8517\\AppData\\Local\\Google\\Chrome\\Xiaoni CDP User Data")
CHROME_PROFILE_DIRECTORY = os.environ.get("XIAONI_CHROME_PROFILE_DIRECTORY", "Profile 2")
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
EXTENSION_DIR_WSL = os.environ.get("XIAONI_PLAYWRIGHT_EXTENSION_DIR_WSL", f"/mnt/c/temp/xiaoni-playwright-extension-{EXTENSION_ID}-{EXTENSION_VERSION}")
EXTENSION_DIR_WIN = os.environ.get("XIAONI_PLAYWRIGHT_EXTENSION_DIR_WIN", f"C:\\temp\\xiaoni-playwright-extension-{EXTENSION_ID}-{EXTENSION_VERSION}")
EXTENSION_CRX_URL = os.environ.get(
    "XIAONI_PLAYWRIGHT_EXTENSION_CRX_URL",
    "https://clients2.google.com/service/update2/crx?"
    "response=redirect&prodversion=149.0.7827.103&acceptformat=crx2,crx3&"
    f"x=id%3D{WEBSTORE_EXTENSION_ID}%26installsource%3Dondemand%26uc",
)
CLI_EXTENSION_FILES = [
    "/mnt/c/temp/xiaoni-playwright-cli/node_modules/playwright-core/lib/coreBundle.js",
    "/mnt/c/temp/xiaoni-playwright-cli/node_modules/playwright-core/lib/tools/utils/extension.js",
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
    completed = subprocess.run(
        [POWERSHELL_EXE, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", CLI_WRAPPER_WIN,
         _COMPUTER_SESSION, *extra_args],
        cwd=INSTALL_DIR_WSL,
        env=_windows_cli_env(),
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )
    return completed.returncode, completed.stdout or "", completed.stderr or ""


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
        js = ("async (page) => { const b = await page.screenshot({type:'png', clip:{x:"
              f"{x1},y:{y1},width:{w},height:{h}}}); return '" + _COMPUTER_SENTINEL + "' + b.toString('base64'); }")
    else:
        statements = _build_action_statements(action, css, css_end)
        js = ("async (page) => { " + statements +
              " const b = await page.screenshot({type:'png'}); return '" + _COMPUTER_SENTINEL +
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
            result["saved_path"] = _save_png_to_runtime_picture_dir(base64.b64decode(raw_b64))
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
    if command == "ensure-cdp" or _is_cdp_attach(args):
        return (
            "Xiaoni browser CDP fallback removed: CDP uses a mirror/debug profile and "
            "is not Xiaoni's real visible Chrome Profile 2. Run `ensure-extension` and "
            "`attach --extension=chrome`; if attach fails, fix extension attach."
        )
    return ""


def _is_cdp_attach(args):
    return _primary_command(args) == "attach" and any(arg == "--cdp" or arg.startswith("--cdp=") for arg in args)


def _is_extension_attach(args):
    return "attach" in args and any(arg.startswith("--extension") for arg in args)


def _ensure_cli_wrapper_exit_code():
    path = Path(CLI_SCRIPT_WSL)
    if not path.exists():
        return
    text = path.read_text(encoding="utf-8-sig")
    newline = "\r\n" if "\r\n" in text else "\n"
    text = _ensure_powershell_env_line(text, "PLAYWRIGHT_MCP_HOST", "127.0.0.1", newline)
    text = _ensure_powershell_env_line(text, "PLAYWRIGHT_EXTENSION_PROTOCOL", "1", newline)
    if "exit $LASTEXITCODE" not in text:
        text = text.rstrip() + newline + "if ($LASTEXITCODE -ne $null) { exit $LASTEXITCODE }" + newline
    path.write_text(text, encoding="utf-8")


def _ensure_powershell_env_line(text, name, value, newline):
    line = f'$env:{name} = "{value}"'
    pattern = re.compile(rf'^\s*\$env:{re.escape(name)}\s*=\s*"[^"]*"\s*$', re.MULTILINE)
    if pattern.search(text):
        return pattern.sub(line, text)
    return text.rstrip() + newline + line + newline


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
        [POWERSHELL_EXE, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", CLI_WRAPPER_WIN, *args],
        cwd=INSTALL_DIR_WSL,
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
    # browser (never attached, or the attach daemon / Chrome target died).
    text = f"{stdout}\n{stderr}"
    return "is not open" in text and "open first" in text


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


def _run_extension_attach_with_heal(args, timeout_seconds):
    # An attach that fails with the extension-not-loaded signature means the
    # running Chrome lost the patched extension (normal restart drops the
    # ephemeral --load-extension flag). Relaunch Chrome WITH the extension once
    # and retry, so callers never have to run `ensure-extension --restart` by hand.
    completed = _run_extension_attach(args, timeout_seconds)
    if completed["returncode"] != 0 and (
        completed.get("timed_out") or _attach_failed(completed["stdout"], completed["stderr"])
    ):
        _forget_attach_process(_session_name(args))
        _launch_chrome_with_extension(True)
        completed = _run_extension_attach(args, timeout_seconds)
    return completed


def _auto_attach_session(args, timeout_seconds):
    session = _session_name(args)
    _forget_attach_process(session)
    attach_args = [f"-s={session}", "attach", "--extension=chrome"]
    completed = _run_extension_attach_with_heal(
        attach_args, _command_timeout_seconds(attach_args, timeout_seconds)
    )
    return completed["returncode"] == 0


def _run_passthrough(args, timeout_seconds):
    try:
        completed = subprocess.run(
            [POWERSHELL_EXE, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", CLI_WRAPPER_WIN, *args],
            cwd=INSTALL_DIR_WSL,
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
    _ensure_cli_wrapper_exit_code()
    env = os.environ.copy()
    if os.path.exists(CLI_SCRIPT_WSL):
        with open(CLI_SCRIPT_WSL, "r", encoding="utf-8-sig") as handle:
            for line in handle:
                match = re.match(r'\s*\$env:([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"', line)
                if match:
                    env[match.group(1)] = match.group(2)
    env.setdefault("PLAYWRIGHT_MCP_EXECUTABLE_PATH", CHROME_EXE_WIN)
    env.setdefault("PLAYWRIGHT_MCP_HOST", "127.0.0.1")
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


def _launch_chrome_with_extension(restart):
    restart_literal = "$true" if restart else "$false"
    script = f"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$chrome = '{CHROME_EXE_WIN}'
$userDataDir = '{CHROME_USER_DATA_DIR_WIN}'
$profile = '{CHROME_PROFILE_DIRECTORY}'
$extensionDir = '{EXTENSION_DIR_WIN}'
$restart = {restart_literal}
function Root-ChromeProcesses {{
  Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'" |
    Where-Object {{
      $_.CommandLine -and
      $_.CommandLine -notmatch '--type=' -and
      (
        $_.CommandLine -match [regex]::Escape($userDataDir) -or
        $_.CommandLine -match [regex]::Escape('{CHROME_CDP_USER_DATA_DIR_WIN}') -or
        $_.CommandLine -match 'chrome.exe"\\s*$'
      )
    }}
}}
if ($restart) {{
  $processes = Root-ChromeProcesses
  foreach ($process in $processes) {{
    $p = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
    if ($p) {{
      try {{ [void]$p.CloseMainWindow() }} catch {{ }}
    }}
  }}
  Start-Sleep -Seconds 3
  foreach ($process in $processes) {{
    $p = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
    if ($p) {{
      try {{ Stop-Process -Id $process.ProcessId -Force }} catch {{ }}
    }}
  }}
  $serviceWorkerRoot = Join-Path $userDataDir (Join-Path $profile 'Service Worker')
  foreach ($name in @('ScriptCache', 'Database')) {{
    $serviceWorkerPath = Join-Path $serviceWorkerRoot $name
    if (Test-Path $serviceWorkerPath) {{
      try {{ Remove-Item -Recurse -Force $serviceWorkerPath }} catch {{ }}
    }}
  }}
}}
if (-not (Test-Path $extensionDir)) {{
  [Console]::Out.Write((@{{ ok = $false; error = 'Extension directory does not exist'; extensionDir = $extensionDir }} | ConvertTo-Json -Compress))
  exit 0
}}
$roots = Root-ChromeProcesses
if (($roots | Measure-Object).Count -eq 0 -or $restart) {{
  $escapedUserDataDir = $userDataDir.Replace('"', '\"')
  $escapedProfile = $profile.Replace('"', '\"')
  $escapedExtensionDir = $extensionDir.Replace('"', '\"')
  $arguments = '--user-data-dir="' + $escapedUserDataDir + '" --profile-directory="' + $escapedProfile + '" --load-extension="' + $escapedExtensionDir + '" --restore-last-session --no-first-run'
  Start-Process -FilePath $chrome -ArgumentList $arguments
  Start-Sleep -Seconds 3
}}
[Console]::Out.Write((@{{ ok = $true; restarted = $restart; extensionDir = $extensionDir; profile = $profile; userDataDir = $userDataDir }} | ConvertTo-Json -Compress))
exit 0
"""
    encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    completed = subprocess.run(
        [POWERSHELL_EXE, "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=60,
    )
    stdout = _strip_clixml(completed.stdout).strip()
    try:
        result = json.loads(stdout) if stdout else {}
    except json.JSONDecodeError:
        result = {"ok": False, "stdout": stdout}
    if completed.stderr.strip():
        result["stderr"] = _strip_clixml(completed.stderr).strip()
    result["returncode"] = completed.returncode
    if completed.returncode != 0:
        result["ok"] = False
    return result


def _ensure_cdp(restart):
    restart_literal = "$true" if restart else "$false"
    script = f"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$endpoint = '{CDP_ENDPOINT}'
$port = '{CDP_PORT}'
$chrome = '{CHROME_EXE_WIN}'
$realUserDataDir = '{CHROME_USER_DATA_DIR_WIN}'
$cdpUserDataDir = '{CHROME_CDP_USER_DATA_DIR_WIN}'
$profile = '{CHROME_PROFILE_DIRECTORY}'
function Read-CdpVersion {{
  try {{
    return Invoke-RestMethod -Uri ($endpoint.TrimEnd('/') + '/json/version') -TimeoutSec 2
  }} catch {{
    return $null
  }}
}}
$version = Read-CdpVersion
if ($version -and -not {restart_literal}) {{
  [Console]::Out.Write((@{{ ok = $true; already_running = $true; endpoint = $endpoint; browser = $version.Browser }} | ConvertTo-Json -Compress))
  exit 0
}}
if (-not {restart_literal}) {{
  [Console]::Out.Write((@{{ ok = $false; needs_restart = $true; endpoint = $endpoint; error = 'Chrome is not listening on the CDP endpoint' }} | ConvertTo-Json -Compress))
  exit 0
}}
$processes = Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'" |
  Where-Object {{
    $_.CommandLine -and
    $_.CommandLine -notmatch '--type=' -and
    (
      $_.CommandLine -match [regex]::Escape($realUserDataDir) -or
      $_.CommandLine -match [regex]::Escape($cdpUserDataDir) -or
      $_.CommandLine -match 'chrome.exe"\\s*$'
    )
  }}
foreach ($process in $processes) {{
  $p = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
  if ($p) {{
    try {{ [void]$p.CloseMainWindow() }} catch {{ }}
  }}
}}
Start-Sleep -Seconds 3
foreach ($process in $processes) {{
  $p = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
  if ($p) {{
    try {{ Stop-Process -Id $process.ProcessId -Force }} catch {{ }}
  }}
}}
New-Item -ItemType Directory -Force -Path $cdpUserDataDir | Out-Null
Set-Location $env:TEMP
function Ensure-Junction($linkPath, $targetPath) {{
  if (Test-Path $linkPath) {{
    $item = Get-Item $linkPath -Force
    if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {{
      throw "Refusing to replace non-link path: $linkPath"
    }}
    return
  }}
  cmd /c mklink /J "$linkPath" "$targetPath" | Out-Null
}}
function Ensure-HardLink($linkPath, $targetPath) {{
  if (Test-Path $linkPath) {{
    return
  }}
  cmd /c mklink /H "$linkPath" "$targetPath" | Out-Null
}}
Ensure-Junction (Join-Path $cdpUserDataDir $profile) (Join-Path $realUserDataDir $profile)
if (Test-Path (Join-Path $realUserDataDir 'Default')) {{
  Ensure-Junction (Join-Path $cdpUserDataDir 'Default') (Join-Path $realUserDataDir 'Default')
}}
Ensure-HardLink (Join-Path $cdpUserDataDir 'Local State') (Join-Path $realUserDataDir 'Local State')
$escapedUserDataDir = $cdpUserDataDir.Replace('"', '\"')
$escapedProfile = $profile.Replace('"', '\"')
$arguments = '--remote-debugging-port=' + $port + ' --remote-debugging-address=127.0.0.1 --remote-allow-origins=http://127.0.0.1:' + $port + ' --user-data-dir="' + $escapedUserDataDir + '" --profile-directory="' + $escapedProfile + '" --restore-last-session'
Start-Process -FilePath $chrome -ArgumentList $arguments
for ($i = 0; $i -lt 60; $i++) {{
  Start-Sleep -Milliseconds 500
  $version = Read-CdpVersion
  if ($version) {{
    [Console]::Out.Write((@{{ ok = $true; restarted = $true; endpoint = $endpoint; browser = $version.Browser; cdpUserDataDir = $cdpUserDataDir; profile = $profile }} | ConvertTo-Json -Compress))
    exit 0
  }}
}}
[Console]::Out.Write((@{{ ok = $false; restarted = $true; endpoint = $endpoint; error = 'Timed out waiting for Chrome CDP endpoint' }} | ConvertTo-Json -Compress))
exit 0
"""
    encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    completed = subprocess.run(
        [POWERSHELL_EXE, "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=80,
    )
    stdout = _strip_clixml(completed.stdout).strip()
    try:
        result = json.loads(stdout) if stdout else {}
    except json.JSONDecodeError:
        result = {"ok": False, "stdout": stdout}
    if completed.stderr.strip():
        result["stderr"] = _strip_clixml(completed.stderr).strip()
    result["returncode"] = completed.returncode
    return result


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


def _save_png_to_runtime_picture_dir(png_bytes):
    # Persist computer-use screenshot bytes (the bridge holds them in-memory; unlike
    # the playwright-cli path there is no host file to copy) into the shared runtime
    # picture dir and return the container-visible path qq-send-image can read.
    picture_dir = Path(RUNTIME_HOST_ROOT) / "picture"
    picture_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    destination_name = f"xiaoni-computer-{timestamp}.png"
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

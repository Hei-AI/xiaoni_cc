#!/usr/bin/env python3
import argparse
import json
import os
import re
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 9977
NODE_EXE = "/mnt/c/Program Files/nodejs/node.exe"
CLI_SCRIPT_WIN = "C:\\temp\\xiaoni-playwright-cli\\node_modules\\@playwright\\cli\\playwright-cli.js"
CLI_SCRIPT_WSL = "/mnt/c/temp/xiaoni-playwright-cli/xiaoni-playwright-cli.ps1"
INSTALL_DIR_WSL = "/mnt/c/temp/xiaoni-playwright-cli"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return
        self._json(200, {"ok": True})

    def do_POST(self):
        if self.path != "/run":
            self.send_error(404)
            return
        length = int(self.headers.get("content-length", "0"))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            args = payload.get("args")
            if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
                raise ValueError("args must be a string array")
            is_extension_attach = "attach" in args and any(arg.startswith("--extension") for arg in args)
            timeout_seconds = int(payload.get("timeout_seconds") or 120)
            if is_extension_attach:
                timeout_seconds = min(timeout_seconds, 15)
            try:
                completed = subprocess.run(
                    [NODE_EXE, CLI_SCRIPT_WIN, *args],
                    cwd=INSTALL_DIR_WSL,
                    env=_windows_cli_env(),
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=timeout_seconds,
                )
                self._json(200, {
                    "ok": completed.returncode == 0,
                    "returncode": completed.returncode,
                    "stdout": completed.stdout,
                    "stderr": completed.stderr,
                })
            except subprocess.TimeoutExpired as error:
                stdout = _decode_timeout_output(error.stdout)
                stderr = _decode_timeout_output(error.stderr)
                attach_created = is_extension_attach and "Session `" in stdout and " created" in stdout
                self._json(200, {
                    "ok": attach_created,
                    "returncode": 0 if attach_created else 124,
                    "stdout": stdout,
                    "stderr": stderr + ("\n[bridge] attach command timed out after session creation; continuing with daemon session.\n" if attach_created else ""),
                    "timed_out": True,
                })
        except Exception as error:
            self._json(500, {"ok": False, "error": str(error)})

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


def _windows_cli_env():
    env = os.environ.copy()
    if os.path.exists(CLI_SCRIPT_WSL):
        with open(CLI_SCRIPT_WSL, "r", encoding="utf-8-sig") as handle:
            for line in handle:
                match = re.match(r'\s*\$env:([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"', line)
                if match:
                    env[match.group(1)] = match.group(2)
    return env


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
import argparse
import json
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 9977
POWERSHELL = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
CLI_SCRIPT = "C:\\temp\\xiaoni-playwright-cli\\xiaoni-playwright-cli.ps1"


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
                    [POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", CLI_SCRIPT, *args],
                    text=True,
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


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 9977
NODE_EXE = "/mnt/c/Program Files/nodejs/node.exe"
CLI_SCRIPT_WIN = "C:\\temp\\xiaoni-playwright-cli\\node_modules\\@playwright\\cli\\playwright-cli.js"
CLI_SCRIPT_WSL = "/mnt/c/temp/xiaoni-playwright-cli/xiaoni-playwright-cli.ps1"
INSTALL_DIR_WSL = "/mnt/c/temp/xiaoni-playwright-cli"
RUNTIME_HOST_ROOT = os.environ.get("XIAONI_RUNTIME_HOST_ROOT", "/home/liahua/.qqbot-local/xiaoni-runtime")
RUNTIME_CONTAINER_ROOT = os.environ.get("XIAONI_RUNTIME_CONTAINER_ROOT", "/xiaoni-runtime")


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
                    "stdout": _augment_browser_artifacts(completed.stdout, args),
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


def _augment_browser_artifacts(stdout, args):
    if "screenshot" not in args:
        return stdout
    copied_paths = []
    for raw_path in _extract_markdown_artifact_paths(stdout):
        source_path = _resolve_cli_artifact_path(raw_path)
        if not source_path or not source_path.exists() or source_path.suffix.lower() != ".png":
            continue
        copied_paths.append(_copy_to_runtime_picture_dir(source_path))
    if not copied_paths:
        return stdout
    lines = ["", "### Xiaoni runtime artifacts"]
    lines.extend(f"- {path}" for path in copied_paths)
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


if __name__ == "__main__":
    main()

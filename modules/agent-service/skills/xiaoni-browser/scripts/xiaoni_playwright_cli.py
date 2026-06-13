#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request


BRIDGE_URLS = [
    value.strip()
    for value in os.environ.get(
        "XIAONI_PLAYWRIGHT_CLI_BRIDGE_URLS",
        os.environ.get("XIAONI_PLAYWRIGHT_CLI_BRIDGE_URL", "http://127.0.0.1:9977/run,http://172.18.0.1:9977/run,http://127.0.0.1:9976/run,http://172.18.0.1:9976/run"),
    ).split(",")
    if value.strip()
]
HELPER_IMAGE = os.environ.get("XIAONI_BROWSER_HELPER_IMAGE", "node:20-alpine")


NODE_HELPER = r"""
const http = require('http');
const bridge = new URL(process.env.XIAONI_PLAYWRIGHT_CLI_BRIDGE_URL || 'http://127.0.0.1:9977/run');
const payload = process.env.XIAONI_PLAYWRIGHT_CLI_REQUEST;
const options = {
  method: 'POST',
  hostname: bridge.hostname,
  port: bridge.port || 80,
  path: bridge.pathname + bridge.search,
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  },
};
const req = http.request(options, res => {
  let text = '';
  res.setEncoding('utf8');
  res.on('data', chunk => text += chunk);
  res.on('end', () => {
    process.stdout.write(text);
    process.exit(res.statusCode >= 200 && res.statusCode < 300 ? 0 : 1);
  });
});
req.on('error', error => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
req.write(payload);
req.end();
"""


def post_direct(url, payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=payload.get("timeout_seconds", 120) + 5) as response:
        return json.loads(response.read().decode("utf-8"))


def post_via_docker(payload):
    bridge_url = BRIDGE_URLS[0]
    request = json.dumps(payload, ensure_ascii=False)
    completed = subprocess.run(
        [
            "docker", "run", "--rm", "--network", "host",
            "-e", f"XIAONI_PLAYWRIGHT_CLI_BRIDGE_URL={bridge_url}",
            "-e", f"XIAONI_PLAYWRIGHT_CLI_REQUEST={request}",
            HELPER_IMAGE, "node", "-e", NODE_HELPER,
        ],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout).strip())
    return json.loads(completed.stdout)


def run_cli(args):
    payload = {"args": args, "timeout_seconds": 120}
    last_error = None
    for url in BRIDGE_URLS:
        try:
            return post_direct(url, payload)
        except Exception as error:
            last_error = error
    if os.path.exists("/var/run/docker.sock"):
        return post_via_docker(payload)
    raise last_error


def main(argv):
    parser = argparse.ArgumentParser(
        description="Run patched host playwright-cli against Xiaoni's logged-in Chrome Profile 2.",
        add_help=True,
    )
    parser.add_argument("args", nargs=argparse.REMAINDER, help="Arguments passed through to playwright-cli")
    parsed = parser.parse_args(argv)
    args = parsed.args
    if args and args[0] == "--":
        args = args[1:]
    if not args:
        args = ["--help"]
    try:
        result = run_cli(args)
    except Exception as error:
        print(f"XIAONI_PLAYWRIGHT_CLI_ERROR {error}", file=sys.stderr)
        return 1
    if result.get("stdout"):
        print(result["stdout"], end="" if result["stdout"].endswith("\n") else "\n")
    if result.get("stderr"):
        print(result["stderr"], file=sys.stderr, end="" if result["stderr"].endswith("\n") else "\n")
    return int(result.get("returncode") or 0)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

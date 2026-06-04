#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.error
import urllib.request


DEFAULT_ENDPOINT = "http://127.0.0.1:8092/api/internal/qq-usage"


def error_block(action, args, reason):
    escaped_reason = (
        str(reason)
        .replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    escaped_args = (
        json.dumps(args, ensure_ascii=False, separators=(",", ":"))
        .replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    print(f'<QQ_USAGE_ERROR action="qq_usage.{action}" arguments="{escaped_args}" reason="{escaped_reason}"></QQ_USAGE_ERROR>')


def call_engineering_api(action, args):
    endpoint = os.environ.get("QQ_USAGE_ENDPOINT", DEFAULT_ENDPOINT)
    payload = json.dumps({"action": action, "args": args}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read().decode("utf-8")
    data = json.loads(body)
    result = data.get("result") if isinstance(data, dict) else None
    content = result.get("content") if isinstance(result, dict) else None
    if isinstance(content, str) and content:
        print(content)
        return 0
    error_block(action, args, "engineering API returned no content")
    return 0


def build_parser():
    parser = argparse.ArgumentParser(description="Operate QQ through the agent-service engineering interface.")
    subcommands = parser.add_subparsers(dest="action", required=True)

    subcommands.add_parser("open_inbox")

    scroll_inbox = subcommands.add_parser("scroll_inbox")
    scroll_inbox.add_argument("direction", choices=["older", "newer"])

    focus_thread = subcommands.add_parser("focus_thread")
    focus_thread.add_argument("thread_key")

    scroll_thread = subcommands.add_parser("scroll_thread")
    scroll_thread.add_argument("thread_key")
    scroll_thread.add_argument("direction", choices=["older", "newer"])

    jump_to_latest = subcommands.add_parser("jump_to_latest")
    jump_to_latest.add_argument("thread_key")

    put_away = subcommands.add_parser("put_qq_away")
    put_away.add_argument("thread_key", nargs="?")

    return parser


def main():
    args = build_parser().parse_args()
    payload = vars(args).copy()
    action = payload.pop("action")
    payload = {key: value for key, value in payload.items() if value is not None}
    try:
        return call_engineering_api(action, payload)
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError) as exc:
        error_block(action, payload, exc)
        return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.error
import urllib.request


CONTAINER_ENDPOINT = "http://qqbot-agent-service:8092/api/internal/qq-usage"
LOCAL_ENDPOINT = "http://127.0.0.1:8092/api/internal/qq-usage"


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


def running_in_container():
    return os.path.exists("/.dockerenv")


def resolve_endpoint():
    endpoint = os.environ.get("QQ_USAGE_ENDPOINT", "").strip()
    if endpoint:
        return endpoint
    if running_in_container():
        return CONTAINER_ENDPOINT
    return LOCAL_ENDPOINT


def post_to_endpoint(endpoint, payload):
    request = urllib.request.Request(
        endpoint,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read().decode("utf-8")
    return json.loads(body)


def call_engineering_api(action, args):
    endpoint = resolve_endpoint()
    payload = json.dumps({"action": action, "args": args}, ensure_ascii=False).encode("utf-8")
    data = post_to_endpoint(endpoint, payload)
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

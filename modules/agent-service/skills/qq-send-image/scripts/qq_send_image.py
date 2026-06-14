#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.error
import urllib.request


CONTAINER_ENDPOINT = "http://qqbot-agent-service:8092/api/internal/qq-send-image"
LOCAL_ENDPOINT = "http://127.0.0.1:8092/api/internal/qq-send-image"


def xml_escape(value):
    return (
        str(value)
        .replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def error_block(action, args, reason):
    escaped_args = xml_escape(json.dumps(args, ensure_ascii=False, separators=(",", ":")))
    print(
        f'<QQ_IMAGE_SEND_ERROR action="qq_send_image.{action}" '
        f'arguments="{escaped_args}" reason="{xml_escape(reason)}"></QQ_IMAGE_SEND_ERROR>'
    )


def running_in_container():
    return os.path.exists("/.dockerenv")


def resolve_endpoint():
    endpoint = os.environ.get("QQ_SEND_IMAGE_ENDPOINT", "").strip()
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
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read().decode("utf-8")
    return json.loads(body)


def build_context():
    mapping = {
        "trace_id": "XIAONI_TRACE_ID",
        "run_id": "XIAONI_RUN_ID",
        "batch_id": "XIAONI_BATCH_ID",
        "tool_call_id": "XIAONI_TOOL_CALL_ID",
        "tool_name": "XIAONI_TOOL_NAME",
        "session_key": "XIAONI_SESSION_KEY",
    }
    return {
        key: os.environ.get(env_key, "").strip()
        for key, env_key in mapping.items()
        if os.environ.get(env_key, "").strip()
    }


def call_engineering_api(action, args):
    endpoint = resolve_endpoint()
    payload = json.dumps({"action": action, "args": args, "context": build_context()}, ensure_ascii=False).encode("utf-8")
    data = post_to_endpoint(endpoint, payload)
    result = data.get("result") if isinstance(data, dict) else None
    content = result.get("content") if isinstance(result, dict) else None
    if isinstance(content, str) and content:
        print(content)
        return 0
    error_block(action, args, "engineering API returned no content")
    return 0


def build_parser():
    parser = argparse.ArgumentParser(description="Send local Xiaoni runtime images to QQ and check send status.")
    subcommands = parser.add_subparsers(dest="action", required=True)

    send_group = subcommands.add_parser("send_group")
    send_group.add_argument("group_id")
    send_group.add_argument("image_path")
    send_group.add_argument("--caption", default="")

    send_private = subcommands.add_parser("send_private")
    send_private.add_argument("user_id")
    send_private.add_argument("image_path")
    send_private.add_argument("--caption", default="")

    check = subcommands.add_parser("check")
    check.add_argument("mode", nargs="?", choices=["private", "group"])
    check.add_argument("target_id", nargs="?")
    check.add_argument("image_path", nargs="?")
    check.add_argument("--caption", default="")
    check.add_argument("--status-key", default="")
    check.add_argument("--message-id", default="")

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

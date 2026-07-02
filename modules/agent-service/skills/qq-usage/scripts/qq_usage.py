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
    parser = argparse.ArgumentParser(description="Operate QQ through the agent-service engineering interface.")
    subcommands = parser.add_subparsers(dest="action", required=True)

    subcommands.add_parser("open_inbox")

    scroll_inbox = subcommands.add_parser("scroll_inbox")
    scroll_inbox.add_argument("direction", choices=["older", "newer"])

    search_inbox = subcommands.add_parser("search_inbox")
    search_inbox.add_argument("query")

    focus_private = subcommands.add_parser("focus_private")
    focus_private.add_argument("user_id")
    # optional: open centered on a specific message_id (e.g. the one a reply quotes,
    # shown as reply_to="<id>"). Omit to open at the latest screen.
    focus_private.add_argument("message_id", nargs="?")

    focus_group = subcommands.add_parser("focus_group")
    focus_group.add_argument("group_id")
    focus_group.add_argument("message_id", nargs="?")

    scroll_private = subcommands.add_parser("scroll_private")
    scroll_private.add_argument("user_id")
    scroll_private.add_argument("direction", choices=["older", "newer"])

    scroll_group = subcommands.add_parser("scroll_group")
    scroll_group.add_argument("group_id")
    scroll_group.add_argument("direction", choices=["older", "newer"])

    jump_private = subcommands.add_parser("jump_private_to_latest")
    jump_private.add_argument("user_id")

    jump_group = subcommands.add_parser("jump_group_to_latest")
    jump_group.add_argument("group_id")

    put_private_away = subcommands.add_parser("put_private_away")
    put_private_away.add_argument("user_id")

    put_group_away = subcommands.add_parser("put_group_away")
    put_group_away.add_argument("group_id")

    set_group_notification_mode = subcommands.add_parser("set_group_notification_mode")
    set_group_notification_mode.add_argument("group_id")
    set_group_notification_mode.add_argument("mode", choices=["all", "mentions_only", "mentions", "mention_only"])

    set_group_notification_delay = subcommands.add_parser("set_group_notification_delay")
    set_group_notification_delay.add_argument("group_id")
    set_group_notification_delay.add_argument("seconds")

    subcommands.add_parser("put_qq_away")

    # 资料面（只改你自己的）：换头像 / 改签名 / 改在线状态。
    set_avatar = subcommands.add_parser("set_avatar")
    set_avatar.add_argument("file")  # 小腻 runtime 下头像图片路径（如 /xiaoni-runtime/picture/xxx.png）

    set_signature = subcommands.add_parser("set_signature")
    set_signature.add_argument("text")  # 个性签名文本；传空串 "" = 清空

    set_status = subcommands.add_parser("set_status")
    set_status.add_argument("status", choices=["online", "away", "invisible", "busy", "qme", "dnd"])

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

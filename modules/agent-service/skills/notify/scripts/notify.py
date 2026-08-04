#!/usr/bin/env python3
"""把一条通知送进小腻的 Notify Bucket。

后台脚本发现了事情(新邮件、任务跑完、监控异常)，用这个把它送到她面前。
在此之前后台脚本只能往日志里 print，没人读。
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request


CONTAINER_ENDPOINT = "http://qqbot-agent-service:8092/api/internal/runtime/notify"
LOCAL_ENDPOINT = "http://127.0.0.1:8092/api/internal/runtime/notify"

MAX_TEXT_LENGTH = 4000


def running_in_container():
    return os.path.exists("/.dockerenv")


def resolve_endpoint():
    endpoint = os.environ.get("XIAONI_NOTIFY_ENDPOINT", "").strip()
    if endpoint:
        return endpoint
    if running_in_container():
        return CONTAINER_ENDPOINT
    return LOCAL_ENDPOINT


def post_notify(endpoint, text, source_system):
    payload = json.dumps(
        {"text": text, "source_system": source_system},
        ensure_ascii=False,
    ).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read().decode("utf-8")
    return json.loads(body)


def main():
    parser = argparse.ArgumentParser(description="投递一条通知给小腻")
    parser.add_argument("text", help="通知正文，你自己组织，别超 4000 字")
    parser.add_argument(
        "--from",
        dest="source_system",
        required=True,
        help="来源标记，只收小写字母/数字/下划线/短横，≤32 字符，例如 check-email",
    )
    args = parser.parse_args()

    text = args.text.strip()
    if not text:
        print("ERROR: 正文是空的，没投", file=sys.stderr)
        return 2
    if len(text) > MAX_TEXT_LENGTH:
        # 服务端会直接 400 拒掉(不截断——截断会让你以为送到了)，这里先说清楚。
        print(f"ERROR: 正文 {len(text)} 字，超过上限 {MAX_TEXT_LENGTH}，没投", file=sys.stderr)
        return 2

    endpoint = resolve_endpoint()
    try:
        result = post_notify(endpoint, text, args.source_system)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        print(f"ERROR: HTTP {error.code} {detail}", file=sys.stderr)
        return 1
    except urllib.error.URLError as error:
        print(f"ERROR: 连不上 {endpoint} — {error.reason}", file=sys.stderr)
        return 1

    if not result.get("success"):
        print(f"ERROR: {result.get('error')}", file=sys.stderr)
        return 1

    print(f"OK queue_id={result.get('queue_id')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

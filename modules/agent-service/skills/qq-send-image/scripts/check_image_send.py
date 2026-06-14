#!/usr/bin/env python3
import argparse
import sys
from html import escape
from pathlib import Path

from image_send_status import find_status_by_message_id, read_status, status_key


def xml_attrs(attrs):
    return " ".join(f'{key}="{escape(str(value), quote=True)}"' for key, value in attrs.items() if value is not None)


def result_block(attrs, body=""):
    attr_text = xml_attrs(attrs)
    if attr_text:
        print(f"<QQ_IMAGE_SEND_STATUS {attr_text}>")
    else:
        print("<QQ_IMAGE_SEND_STATUS>")
    if body:
        print(escape(str(body)))
    print("</QQ_IMAGE_SEND_STATUS>")


def resolve_existing_path(value):
    try:
        return str(Path(value).expanduser().resolve(strict=True))
    except OSError:
        return str(value)


def main(argv):
    parser = argparse.ArgumentParser(description="Check a qq-send-image script status by the same target and image arguments.")
    parser.add_argument("mode", choices=["private", "group"], help="send mode used by the original command")
    parser.add_argument("target_id", help="QQ user id for private mode or QQ group id for group mode")
    parser.add_argument("image_path", help="same image path used by the original send command")
    parser.add_argument("--caption", default="", help="same optional caption used by the original send command")
    parser.add_argument("--status-key", default="", help="optional status_key printed by a send result")
    parser.add_argument("--message-id", default="", help="optional QQ message_id printed by a successful send result")
    args = parser.parse_args(argv)

    image_path = resolve_existing_path(args.image_path)
    key = args.status_key.strip() or status_key(args.mode, args.target_id, image_path, args.caption)
    record = find_status_by_message_id(args.message_id) if args.message_id.strip() else None
    if not record:
        record = read_status(key)
    if not record:
        result_block({
            "status": "unknown",
            "mode": args.mode,
            "target_id": args.target_id,
            "image_path": image_path,
            "status_key": key,
            "message_id": args.message_id.strip() or None,
        }, "没有找到这次图片发送的本地状态记录。")
        return 0

    status = str(record.get("status") or "unknown")
    attrs = {
        "status": status,
        "mode": record.get("mode") or args.mode,
        "target_id": record.get("target_id") or args.target_id,
        "image_path": record.get("image_path") or image_path,
        "caption_sent": "true" if record.get("caption_sent") else "false",
        "status_key": record.get("status_key") or key,
        "message_id": record.get("message_id"),
        "updated_at": record.get("updated_at"),
    }
    if status == "failed":
        attrs["reason"] = record.get("reason") or "unknown"
        body = "图片发送失败。"
    elif status == "sent":
        body = "图片已提交到 QQ 发送链路。"
    elif status == "pending":
        body = "图片发送命令已经启动，但本地状态还没有记录到成功或失败。"
    else:
        body = "图片发送状态未知。"
    result_block(attrs, body)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

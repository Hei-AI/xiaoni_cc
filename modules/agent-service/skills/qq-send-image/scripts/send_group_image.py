#!/usr/bin/env python3
import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from html import escape
from pathlib import Path


CONTAINER_ENDPOINT = "http://qqbot-provider-service:8090/api/internal/send_group_image"
LOCAL_ENDPOINT = "http://127.0.0.1:8091/api/internal/send_group_image"
DEFAULT_RUNTIME_ROOT = "/xiaoni-runtime"
DEFAULT_MAX_BYTES = 20 * 1024 * 1024


def xml_attrs(attrs):
    return " ".join(f'{key}="{escape(str(value), quote=True)}"' for key, value in attrs.items())


def result_block(tag, attrs, body):
    attr_text = xml_attrs(attrs)
    if attr_text:
        print(f"<{tag} {attr_text}>")
    else:
        print(f"<{tag}>")
    if body:
        print(escape(str(body)))
    print(f"</{tag}>")


def error(reason, **attrs):
    payload = {"reason": reason}
    payload.update({key: value for key, value in attrs.items() if value is not None})
    result_block("QQ_IMAGE_SEND_ERROR", payload, "")


def running_in_container():
    return Path("/.dockerenv").exists()


def send_endpoint():
    explicit = os.environ.get("QQ_SEND_IMAGE_ENDPOINT", "").strip()
    if explicit:
        return explicit
    return CONTAINER_ENDPOINT if running_in_container() else LOCAL_ENDPOINT


def runtime_root():
    return Path(os.environ.get("XIAONI_RUNTIME_ROOT", DEFAULT_RUNTIME_ROOT)).expanduser()


def configured_allowed_roots():
    explicit = os.environ.get("QQ_SEND_IMAGE_ALLOWED_ROOTS", "").strip()
    if explicit:
        raw_roots = []
        for chunk in explicit.replace(",", os.pathsep).split(os.pathsep):
            root = chunk.strip()
            if root:
                raw_roots.append(root)
    else:
        raw_roots = [
            str(runtime_root()),
        ]

    roots = []
    seen = set()
    for raw_root in raw_roots:
        try:
            root = Path(raw_root).expanduser().resolve(strict=True)
        except FileNotFoundError:
            continue
        if not root.is_dir():
            continue
        marker = str(root)
        if marker not in seen:
            roots.append(root)
            seen.add(marker)
    if not roots:
        raise ValueError("no readable image roots are configured")
    return roots


def max_bytes():
    raw = os.environ.get("QQ_SEND_IMAGE_MAX_BYTES", "").strip()
    if not raw:
        return DEFAULT_MAX_BYTES
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_MAX_BYTES
    return value if value > 0 else DEFAULT_MAX_BYTES


def parse_group_id(value):
    try:
        group_id = int(value)
    except ValueError as exc:
        raise ValueError("group_id must be a QQ group number") from exc
    if group_id <= 0:
        raise ValueError("group_id must be positive")
    return group_id


def resolve_image_path(input_path):
    roots = configured_allowed_roots()
    path = Path(input_path).expanduser()
    if not path.is_absolute():
        path = roots[0] / path
    resolved = path.resolve(strict=True)
    if not resolved.is_file():
        raise ValueError("image_path must point to a file")
    for root in roots:
        try:
            resolved.relative_to(root)
            return resolved
        except ValueError:
            continue
    allowed = ", ".join(str(root) for root in roots)
    raise ValueError(f"image_path must be under one of the configured image roots: {allowed}")


def sniff_mime(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return "image/gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise ValueError("unsupported image format")


def read_image(path):
    size = path.stat().st_size
    limit = max_bytes()
    if size <= 0:
        raise ValueError("image file is empty")
    if size > limit:
        raise ValueError(f"image file is too large: {size} bytes > {limit} bytes")
    data = path.read_bytes()
    mime_type = sniff_mime(data)
    return data, mime_type, size


def provider_post(payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        send_endpoint(),
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8", errors="replace")
            status = response.status
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"provider-service rejected image send with HTTP {exc.code}: {raw[:500]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"provider-service is unreachable: {exc.reason}") from exc

    try:
        parsed = json.loads(raw) if raw else {}
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"provider-service returned non-JSON response: {raw[:500]}") from exc
    if status < 200 or status >= 300 or parsed.get("success") is False:
        raise RuntimeError(parsed.get("error") or f"provider-service returned HTTP {status}")
    return parsed


def main(argv):
    parser = argparse.ArgumentParser(description="Send a local Xiaoni runtime image to a QQ group.")
    parser.add_argument("group_id", help="QQ group id")
    parser.add_argument("image_path", help="local image path under /xiaoni-runtime or an explicitly configured image root")
    parser.add_argument("--caption", default="", help="optional text to send after the image")
    args = parser.parse_args(argv)

    try:
        group_id = parse_group_id(args.group_id)
        image_path = resolve_image_path(args.image_path)
        data, mime_type, size = read_image(image_path)
        data_url = f"data:{mime_type};base64,{base64.b64encode(data).decode('ascii')}"
        payload = {
            "group_id": group_id,
            "data_url": data_url,
        }
        caption = args.caption.strip()
        if caption:
            payload["caption"] = caption
        session_key = os.environ.get("XIAONI_SESSION_KEY", "").strip()
        if session_key:
            payload["session_key"] = session_key
        provider_post(payload)
        result_block(
            "QQ_IMAGE_SEND_RESULT",
            {
                "success": "true",
                "group_id": group_id,
                "image_path": str(image_path),
                "mime_type": mime_type,
                "bytes": size,
                "caption_sent": "true" if caption else "false",
            },
            "图片已发送到 QQ 群。",
        )
    except Exception as exc:
        error(str(exc), group_id=args.group_id, image_path=args.image_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

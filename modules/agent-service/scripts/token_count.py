#!/usr/bin/env python3
import json
import sys

try:
    import tiktoken
except Exception as exc:
    print(json.dumps({
        "ok": False,
        "error": f"failed_to_import_tiktoken: {exc}",
    }))
    sys.exit(1)


def resolve_encoding(model_name: str):
    normalized = (model_name or "").strip()
    if normalized:
        try:
            return tiktoken.encoding_for_model(normalized)
        except Exception:
            pass
    return tiktoken.get_encoding("o200k_base")


INPUT_ITEM_OVERHEAD_TOKENS = 48


def compact_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def count_text(encoding, value):
    if value is None:
        return 0
    return len(encoding.encode(str(value)))


def count_compact_json(encoding, value):
    return len(encoding.encode(compact_json(value)))


def count_message_content(encoding, content):
    if isinstance(content, str):
        return count_text(encoding, content)
    if not isinstance(content, list):
        return 0

    total = 0
    for part in content:
        if isinstance(part, str):
            total += count_text(encoding, part)
            continue
        if not isinstance(part, dict):
            continue
        total += count_text(encoding, part.get("type"))
        for key in ("text", "input_text", "output_text"):
            if isinstance(part.get(key), str):
                total += count_text(encoding, part.get(key))
    return total


def count_reasoning_summary(encoding, summary):
    if not isinstance(summary, list):
        return 0
    total = 0
    for item in summary:
        if isinstance(item, str):
            total += count_text(encoding, item)
        elif isinstance(item, dict):
            total += count_text(encoding, item.get("text"))
    return total


def count_input_item(encoding, item):
    if not isinstance(item, dict):
        return count_compact_json(encoding, item)

    item_type = item.get("type")
    total = INPUT_ITEM_OVERHEAD_TOKENS
    if item_type == "message":
        total += count_text(encoding, item.get("role"))
        total += count_message_content(encoding, item.get("content"))
        return total
    if item_type == "function_call":
        total += count_text(encoding, item.get("name"))
        total += count_text(encoding, item.get("arguments"))
        return total
    if item_type == "function_call_output":
        total += count_text(encoding, item.get("output"))
        return total
    if item_type == "reasoning":
        total += count_reasoning_summary(encoding, item.get("summary"))
        return total

    scrubbed = {key: value for key, value in item.items() if key != "encrypted_content"}
    total += count_compact_json(encoding, scrubbed)
    return total


def count_request_tokens(encoding, request):
    if not isinstance(request, dict):
        return count_compact_json(encoding, request)

    total = 0
    total += count_text(encoding, request.get("instructions"))
    if request.get("tools") is not None:
        total += count_compact_json(encoding, request.get("tools") or [])
    controls = {
        key: value
        for key, value in request.items()
        if key not in ("input", "instructions", "tools") and value is not None
    }
    if controls:
        total += count_compact_json(encoding, controls)
    for item in request.get("input") or []:
        total += count_input_item(encoding, item)
    return total


def main():
    raw = sys.stdin.read()
    payload = json.loads(raw or "{}")
    model = payload.get("model") or ""
    encoding = resolve_encoding(model)
    if "request" in payload:
        tokens = count_request_tokens(encoding, payload.get("request"))
        mode = "request"
    else:
        text = payload.get("text") or ""
        tokens = len(encoding.encode(text))
        mode = "text"
    print(json.dumps({
        "ok": True,
        "model": model,
        "encoding": getattr(encoding, "name", "unknown"),
        "input_tokens": tokens,
        "mode": mode,
    }))


if __name__ == "__main__":
    main()

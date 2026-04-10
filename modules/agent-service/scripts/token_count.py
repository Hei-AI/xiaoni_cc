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


def main():
    raw = sys.stdin.read()
    payload = json.loads(raw or "{}")
    model = payload.get("model") or ""
    text = payload.get("text") or ""
    encoding = resolve_encoding(model)
    tokens = len(encoding.encode(text))
    print(json.dumps({
        "ok": True,
        "model": model,
        "encoding": getattr(encoding, "name", "unknown"),
        "input_tokens": tokens,
    }))


if __name__ == "__main__":
    main()

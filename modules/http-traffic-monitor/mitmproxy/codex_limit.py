from __future__ import annotations

import email.utils
import json
import time
from datetime import timezone
from typing import Any


ACCOUNT_SCOPED_LIMIT_CODES = {
    "usage_limit_reached",
    "rate_limit_exceeded",
}


def parse_retry_after_seconds(value: str | None) -> int | None:
    if not value:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if normalized.isdigit():
        return max(0, int(normalized))
    try:
        when = email.utils.parsedate_to_datetime(normalized)
    except (TypeError, ValueError, IndexError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    seconds = int(when.timestamp() - time.time())
    return max(0, seconds)


def extract_error_code(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    error = payload.get("error")
    if isinstance(error, dict):
        for key in ("code", "type", "error_code"):
            value = error.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    for key in ("code", "type", "error_code"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def classify_codex_429(
    *,
    status_code: int,
    response_headers: dict[str, str] | None,
    response_body: bytes | None,
) -> dict[str, Any]:
    if status_code != 429:
        return {
            "matched": False,
            "reason": "status-not-429",
            "accountScoped": False,
            "cooldownSeconds": None,
            "errorCode": None,
        }

    headers = {str(key).lower(): str(value) for key, value in (response_headers or {}).items()}
    retry_after_seconds = parse_retry_after_seconds(headers.get("retry-after"))

    raw_body = response_body or b""
    text = raw_body.decode("utf-8", errors="replace")
    lowered = text.lower()
    payload = None
    if text.strip():
        try:
            payload = json.loads(text)
        except Exception:
            payload = None

    error_code = extract_error_code(payload)
    normalized_code = error_code.lower() if isinstance(error_code, str) else None

    if normalized_code in ACCOUNT_SCOPED_LIMIT_CODES:
        return {
            "matched": True,
            "reason": "account-limit-code",
            "accountScoped": True,
            "cooldownSeconds": retry_after_seconds,
            "errorCode": normalized_code,
        }

    if "usage_limit_reached" in lowered:
        return {
            "matched": True,
            "reason": "body-usage-limit-reached",
            "accountScoped": True,
            "cooldownSeconds": retry_after_seconds,
            "errorCode": normalized_code or "usage_limit_reached",
        }

    if retry_after_seconds is not None:
        return {
            "matched": True,
            "reason": "retry-after-header",
            "accountScoped": True,
            "cooldownSeconds": retry_after_seconds,
            "errorCode": normalized_code,
        }

    return {
        "matched": True,
        "reason": "ambiguous-429",
        "accountScoped": False,
        "cooldownSeconds": None,
        "errorCode": normalized_code,
    }


def classify_codex_websocket_message(message_text: str) -> dict[str, Any]:
    text = (message_text or "").strip()
    lowered = text.lower()
    payload = None
    if text:
        try:
            payload = json.loads(text)
        except Exception:
            payload = None

    normalized_code = extract_error_code(payload)
    normalized_code = normalized_code.lower() if isinstance(normalized_code, str) else None

    if normalized_code in ACCOUNT_SCOPED_LIMIT_CODES:
        return {
            "matched": True,
            "reason": "websocket-account-limit-code",
            "accountScoped": True,
            "cooldownSeconds": None,
            "errorCode": normalized_code,
        }

    phrases = (
        "usage_limit_reached",
        "you've hit your usage limit",
        "you have hit your usage limit",
        "try again at",
        "rate limit exceeded",
    )
    if any(phrase in lowered for phrase in phrases):
        return {
            "matched": True,
            "reason": "websocket-limit-text",
            "accountScoped": True,
            "cooldownSeconds": None,
            "errorCode": normalized_code or "usage_limit_reached",
        }

    return {
        "matched": False,
        "reason": "no-websocket-limit-signal",
        "accountScoped": False,
        "cooldownSeconds": None,
        "errorCode": normalized_code,
    }

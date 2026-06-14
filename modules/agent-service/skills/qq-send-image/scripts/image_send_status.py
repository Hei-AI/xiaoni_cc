import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_RUNTIME_ROOT = "/xiaoni-runtime"
STATUS_DIR_NAME = "qq-send-image-status"


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def runtime_root():
    return Path(os.environ.get("XIAONI_RUNTIME_ROOT", DEFAULT_RUNTIME_ROOT)).expanduser()


def status_dir():
    explicit = os.environ.get("QQ_SEND_IMAGE_STATUS_DIR", "").strip()
    if explicit:
        return Path(explicit).expanduser()
    return runtime_root() / STATUS_DIR_NAME


def normalize_caption(caption):
    return caption.strip() if isinstance(caption, str) else ""


def status_key(mode, target_id, image_path, caption=""):
    payload = {
        "mode": str(mode).strip(),
        "target_id": str(target_id).strip(),
        "image_path": str(image_path).strip(),
        "caption": normalize_caption(caption),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def status_path(key):
    safe_key = "".join(ch for ch in str(key) if ch.isalnum() or ch in ("-", "_"))[:80]
    if not safe_key:
        safe_key = "invalid"
    return status_dir() / f"{safe_key}.json"


def extract_message_id(provider_response):
    if not isinstance(provider_response, dict):
        return None
    candidates = [provider_response]
    data = provider_response.get("data")
    if isinstance(data, dict):
        candidates.append(data)
    for candidate in candidates:
        for field in ("message_id", "messageId", "id"):
            value = candidate.get(field)
            if value is not None and str(value).strip():
                return str(value).strip()
    return None


def build_status_record(mode, target_id, image_path, caption="", status="pending", **extra):
    now = utc_now_iso()
    key = status_key(mode, target_id, image_path, caption)
    record = {
        "status_key": key,
        "status": status,
        "mode": str(mode).strip(),
        "target_id": str(target_id).strip(),
        "image_path": str(image_path).strip(),
        "caption": normalize_caption(caption),
        "caption_sent": bool(normalize_caption(caption)),
        "updated_at": now,
    }
    if "started_at" not in extra:
        record["started_at"] = now
    for field, value in extra.items():
        if value is not None:
            record[field] = value
    return record


def write_status(record):
    try:
        directory = status_dir()
        directory.mkdir(parents=True, exist_ok=True)
        path = status_path(record.get("status_key", ""))
        tmp_path = path.with_suffix(".json.tmp")
        tmp_path.write_text(json.dumps(record, ensure_ascii=False, sort_keys=True), encoding="utf-8")
        tmp_path.replace(path)
        return True
    except OSError:
        return False


def read_status(key):
    try:
        path = status_path(key)
        if not path.exists():
            return None
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def find_status_by_message_id(message_id):
    wanted = str(message_id).strip()
    if not wanted:
        return None
    try:
        paths = sorted(status_dir().glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)
    except OSError:
        return None
    for path in paths[:500]:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict) and str(payload.get("message_id") or "").strip() == wanted:
            return payload
    return None

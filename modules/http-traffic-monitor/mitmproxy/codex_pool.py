from __future__ import annotations

import email.utils
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ACCOUNT_SCOPED_LIMIT_CODES = {
    "usage_limit_reached",
    "rate_limit_exceeded",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_optional_iso(value: str | None) -> int | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return int(parsed.timestamp() * 1000)


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


class CodexPoolFailoverManager:
    def __init__(
        self,
        *,
        enabled: bool,
        store_dir: str,
        active_auth_path: str,
        default_cooldown_ms: int,
    ) -> None:
        self.enabled = enabled
        self.store_dir = Path(store_dir).expanduser()
        self.accounts_dir = self.store_dir / "accounts"
        self.active_state_path = self.store_dir / "active-account.json"
        self.active_auth_path = Path(active_auth_path).expanduser()
        self.default_cooldown_ms = max(60_000, int(default_cooldown_ms))

    def resolve_account_for_request(
        self,
        provider_account_id: str | None,
        request_access_token: str | None = None,
    ) -> dict[str, Any] | None:
        if request_access_token:
            matched = self.find_account_by_access_token(request_access_token)
            if matched:
                return matched
        if provider_account_id:
            matched = self.find_account_by_provider_account_id(provider_account_id)
            if matched:
                return matched
        active_pool_id = self.read_active_pool_account_id()
        if active_pool_id:
            return self.read_account(active_pool_id)
        return None

    def handle_account_scoped_limit(
        self,
        *,
        provider_account_id: str | None,
        request_access_token: str | None = None,
        reason: str,
        cooldown_seconds: int | None,
    ) -> dict[str, Any]:
        if not self.enabled:
            return {"switched": False, "reason": "disabled"}

        current = self.resolve_account_for_request(provider_account_id, request_access_token)
        if not current:
            return {"switched": False, "reason": "account-not-managed"}

        now_ms = int(time.time() * 1000)
        cooldown_ms = (cooldown_seconds * 1000) if cooldown_seconds is not None else self.default_cooldown_ms
        cooldown_until_iso = datetime.fromtimestamp((now_ms + cooldown_ms) / 1000, timezone.utc).isoformat()

        current["cooldownUntil"] = cooldown_until_iso
        current["lastError"] = reason
        current["lastUsedAt"] = now_iso()
        current["updatedAt"] = current["lastUsedAt"]
        stats = current.get("stats") or {}
        stats["errorCount"] = int(stats.get("errorCount") or 0) + 1
        stats["quotaExceededCount"] = int(stats.get("quotaExceededCount") or 0) + 1
        current["stats"] = stats
        self.write_account(current)

        next_account = self.pick_next_ready_account(
            excluding_id=current.get("id"),
            excluding_provider_account_id=current.get("accountId"),
        )
        if not next_account:
            return {
                "switched": False,
                "reason": "no-ready-account",
                "previousAccountId": current.get("id"),
                "previousProviderAccountId": current.get("accountId"),
                "cooldownUntil": cooldown_until_iso,
            }

        self.project_account(next_account)
        return {
            "switched": True,
            "reason": "switched-after-limit",
            "previousAccountId": current.get("id"),
            "previousProviderAccountId": current.get("accountId"),
            "nextAccountId": next_account.get("id"),
            "nextProviderAccountId": next_account.get("accountId"),
            "cooldownUntil": cooldown_until_iso,
        }

    def read_active_pool_account_id(self) -> str | None:
        try:
            payload = json.loads(self.active_state_path.read_text("utf-8"))
        except Exception:
            return None
        value = payload.get("activeAccountId")
        return value if isinstance(value, str) and value else None

    def find_account_by_provider_account_id(self, provider_account_id: str) -> dict[str, Any] | None:
        for account in self.list_accounts():
            if account.get("accountId") == provider_account_id:
                return account
        return None

    def find_account_by_access_token(self, access_token: str) -> dict[str, Any] | None:
        for account in self.list_accounts():
            if account.get("access") == access_token:
                return account
        return None

    def pick_next_ready_account(
        self,
        excluding_id: str | None,
        excluding_provider_account_id: str | None = None,
    ) -> dict[str, Any] | None:
        now_ms = int(time.time() * 1000)
        ready = []
        for account in self.list_accounts():
            if excluding_id and account.get("id") == excluding_id:
                continue
            if excluding_provider_account_id and account.get("accountId") == excluding_provider_account_id:
                continue
            if not account.get("enabled", False):
                continue
            if account.get("refreshFailureCode"):
                continue
            expires = int(account.get("expires") or 0)
            if expires <= now_ms:
                continue
            cooldown_until_ms = parse_optional_iso(account.get("cooldownUntil"))
            if cooldown_until_ms and cooldown_until_ms > now_ms:
                continue
            ready.append(account)
        ready.sort(key=lambda item: item.get("lastActivatedAt") or item.get("createdAt") or "", reverse=True)
        return ready[0] if ready else None

    def project_account(self, account: dict[str, Any]) -> None:
        self.active_auth_path.parent.mkdir(parents=True, exist_ok=True)
        self.store_dir.mkdir(parents=True, exist_ok=True)

        auth_payload = {
            "auth_mode": "chatgpt",
            "OPENAI_API_KEY": None,
            "last_refresh": now_iso(),
            "tokens": {
                "access_token": account.get("access"),
                "refresh_token": account.get("refresh"),
                "expires_at": account.get("expires"),
                **({"account_id": account.get("accountId")} if account.get("accountId") else {}),
                **({"id_token": account.get("idToken")} if account.get("idToken") else {}),
            },
        }
        self.active_auth_path.write_text(f"{json.dumps(auth_payload, indent=2)}\n", "utf-8")

        state_payload = {
            "activeAccountId": account.get("id"),
            "updatedAt": now_iso(),
        }
        self.active_state_path.write_text(f"{json.dumps(state_payload, indent=2)}\n", "utf-8")

        account["lastActivatedAt"] = state_payload["updatedAt"]
        account["updatedAt"] = state_payload["updatedAt"]
        self.write_account(account)

    def list_accounts(self) -> list[dict[str, Any]]:
        if not self.accounts_dir.exists():
            return []
        accounts = []
        for path in sorted(self.accounts_dir.glob("*.json")):
            try:
                accounts.append(json.loads(path.read_text("utf-8")))
            except Exception:
                continue
        return accounts

    def read_account(self, pool_account_id: str) -> dict[str, Any] | None:
        path = self.accounts_dir / f"{pool_account_id}.json"
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text("utf-8"))
        except Exception:
            return None

    def write_account(self, account: dict[str, Any]) -> None:
        self.accounts_dir.mkdir(parents=True, exist_ok=True)
        path = self.accounts_dir / f"{account['id']}.json"
        path.write_text(f"{json.dumps(account, indent=2)}\n", "utf-8")


def build_failover_manager_from_env() -> CodexPoolFailoverManager:
    home_dir = Path.home()
    return CodexPoolFailoverManager(
        enabled=os.getenv("CODEX_POOL_FAILOVER_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"},
        store_dir=os.getenv("CODEX_POOL_STORE_DIR", str(home_dir / ".qqbot-local" / "codex-accounts")),
        active_auth_path=os.getenv("CODEX_ACTIVE_AUTH_PATH", str(home_dir / ".codex" / "auth.json")),
        default_cooldown_ms=int(os.getenv("CODEX_ACCOUNT_COOLDOWN_MS", str(30 * 60 * 1000))),
    )

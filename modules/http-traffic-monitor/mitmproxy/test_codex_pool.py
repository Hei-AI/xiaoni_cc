import json
import tempfile
import unittest
from pathlib import Path

from codex_pool import CodexPoolFailoverManager, classify_codex_429, classify_codex_websocket_message


class ClassifyCodex429Test(unittest.TestCase):
    def test_marks_usage_limit_body_as_account_scoped(self):
        result = classify_codex_429(
            status_code=429,
            response_headers={"retry-after": "60"},
            response_body=json.dumps({"error": {"code": "usage_limit_reached"}}).encode("utf-8"),
        )
        self.assertTrue(result["matched"])
        self.assertTrue(result["accountScoped"])
        self.assertEqual(result["errorCode"], "usage_limit_reached")
        self.assertEqual(result["cooldownSeconds"], 60)

    def test_marks_ambiguous_429_without_headers_as_non_account_scoped(self):
        result = classify_codex_429(
            status_code=429,
            response_headers={},
            response_body=b"too many requests",
        )
        self.assertTrue(result["matched"])
        self.assertFalse(result["accountScoped"])
        self.assertEqual(result["reason"], "ambiguous-429")

    def test_marks_websocket_usage_limit_text_as_account_scoped(self):
        result = classify_codex_websocket_message("You've hit your usage limit. Try again at 2:26 AM.")
        self.assertTrue(result["matched"])
        self.assertTrue(result["accountScoped"])
        self.assertEqual(result["errorCode"], "usage_limit_reached")

    def test_marks_websocket_error_code_as_account_scoped(self):
        result = classify_codex_websocket_message(json.dumps({"error": {"code": "usage_limit_reached"}}))
        self.assertTrue(result["matched"])
        self.assertTrue(result["accountScoped"])
        self.assertEqual(result["errorCode"], "usage_limit_reached")


class FailoverManagerTest(unittest.TestCase):
    def test_switches_to_next_ready_account_and_projects_auth(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            store_dir = root / "codex-accounts"
            accounts_dir = store_dir / "accounts"
            auth_dir = root / ".codex"
            active_auth_path = auth_dir / "auth.json"
            accounts_dir.mkdir(parents=True)
            auth_dir.mkdir(parents=True)

            current = {
                "id": "acct-current",
                "email": "a85178516+4@gmail.com",
                "accountId": "provider-current",
                "access": "access-current",
                "refresh": "refresh-current",
                "expires": 4102444800000,
                "enabled": True,
                "createdAt": "2026-05-01T00:00:00+00:00",
                "updatedAt": "2026-05-01T00:00:00+00:00",
                "lastActivatedAt": "2026-05-01T00:00:00+00:00",
                "stats": {"successCount": 0, "errorCount": 0, "quotaExceededCount": 0},
            }
            backup = {
                "id": "acct-backup",
                "email": "a85178516+3@gmail.com",
                "accountId": "provider-backup",
                "access": "access-backup",
                "refresh": "refresh-backup",
                "expires": 4102444800000,
                "enabled": True,
                "createdAt": "2026-05-01T00:10:00+00:00",
                "updatedAt": "2026-05-01T00:10:00+00:00",
                "stats": {"successCount": 0, "errorCount": 0, "quotaExceededCount": 0},
            }

            (accounts_dir / "acct-current.json").write_text(json.dumps(current), encoding="utf-8")
            (accounts_dir / "acct-backup.json").write_text(json.dumps(backup), encoding="utf-8")
            (store_dir / "active-account.json").write_text(
                json.dumps({"activeAccountId": "acct-current", "updatedAt": "2026-05-01T00:00:00+00:00"}),
                encoding="utf-8",
            )

            manager = CodexPoolFailoverManager(
                enabled=True,
                store_dir=str(store_dir),
                active_auth_path=str(active_auth_path),
                default_cooldown_ms=30 * 60 * 1000,
            )

            result = manager.handle_account_scoped_limit(
                provider_account_id="provider-current",
                reason="usage_limit_reached",
                cooldown_seconds=60,
            )

            self.assertTrue(result["switched"])
            self.assertEqual(result["nextAccountId"], "acct-backup")

            active_state = json.loads((store_dir / "active-account.json").read_text("utf-8"))
            self.assertEqual(active_state["activeAccountId"], "acct-backup")

            projected_auth = json.loads(active_auth_path.read_text("utf-8"))
            self.assertEqual(projected_auth["tokens"]["access_token"], "access-backup")
            self.assertEqual(projected_auth["tokens"]["account_id"], "provider-backup")

            stored_current = json.loads((accounts_dir / "acct-current.json").read_text("utf-8"))
            self.assertEqual(stored_current["lastError"], "usage_limit_reached")
            self.assertEqual(stored_current["stats"]["quotaExceededCount"], 1)
            self.assertIsNotNone(stored_current["cooldownUntil"])

    def test_prefers_access_token_when_provider_account_id_is_shared(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            store_dir = root / "codex-accounts"
            accounts_dir = store_dir / "accounts"
            accounts_dir.mkdir(parents=True)

            first = {
                "id": "acct-first",
                "accountId": "shared-provider-id",
                "access": "access-first",
                "refresh": "refresh-first",
                "expires": 4102444800000,
                "enabled": True,
                "createdAt": "2026-05-01T00:00:00+00:00",
                "updatedAt": "2026-05-01T00:00:00+00:00",
            }
            second = {
                "id": "acct-second",
                "accountId": "shared-provider-id",
                "access": "access-second",
                "refresh": "refresh-second",
                "expires": 4102444800000,
                "enabled": True,
                "createdAt": "2026-05-01T00:10:00+00:00",
                "updatedAt": "2026-05-01T00:10:00+00:00",
            }

            (accounts_dir / "acct-first.json").write_text(json.dumps(first), encoding="utf-8")
            (accounts_dir / "acct-second.json").write_text(json.dumps(second), encoding="utf-8")

            manager = CodexPoolFailoverManager(
                enabled=True,
                store_dir=str(store_dir),
                active_auth_path=str(root / ".codex" / "auth.json"),
                default_cooldown_ms=30 * 60 * 1000,
            )

            resolved = manager.resolve_account_for_request("shared-provider-id", "access-second")
            self.assertEqual(resolved["id"], "acct-second")

    def test_skips_same_provider_account_and_prefers_recent_ready_account(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            store_dir = root / "codex-accounts"
            accounts_dir = store_dir / "accounts"
            auth_dir = root / ".codex"
            active_auth_path = auth_dir / "auth.json"
            accounts_dir.mkdir(parents=True)
            auth_dir.mkdir(parents=True)

            same_provider_old = {
                "id": "acct-old-alias",
                "accountId": "provider-shared",
                "access": "access-old-alias",
                "refresh": "refresh-old-alias",
                "expires": 4102444800000,
                "enabled": True,
                "createdAt": "2026-05-01T00:00:00+00:00",
                "updatedAt": "2026-05-01T00:00:00+00:00",
                "lastActivatedAt": "2026-05-01T00:00:00+00:00",
            }
            current = {
                "id": "acct-current",
                "accountId": "provider-shared",
                "access": "access-current",
                "refresh": "refresh-current",
                "expires": 4102444800000,
                "enabled": True,
                "createdAt": "2026-05-01T00:10:00+00:00",
                "updatedAt": "2026-05-01T00:10:00+00:00",
                "lastActivatedAt": "2026-05-01T00:10:00+00:00",
            }
            older_ready = {
                "id": "acct-older-ready",
                "accountId": "provider-older-ready",
                "access": "access-older-ready",
                "refresh": "refresh-older-ready",
                "expires": 4102444800000,
                "enabled": True,
                "createdAt": "2026-05-01T00:20:00+00:00",
                "updatedAt": "2026-05-01T00:20:00+00:00",
                "lastActivatedAt": "2026-05-01T00:20:00+00:00",
            }
            recent_ready = {
                "id": "acct-recent-ready",
                "accountId": "provider-recent-ready",
                "access": "access-recent-ready",
                "refresh": "refresh-recent-ready",
                "expires": 4102444800000,
                "enabled": True,
                "createdAt": "2026-05-01T00:30:00+00:00",
                "updatedAt": "2026-05-01T00:30:00+00:00",
                "lastActivatedAt": "2026-05-01T00:30:00+00:00",
            }

            for account in (same_provider_old, current, older_ready, recent_ready):
                (accounts_dir / f"{account['id']}.json").write_text(json.dumps(account), encoding="utf-8")

            (store_dir / "active-account.json").write_text(
                json.dumps({"activeAccountId": "acct-current", "updatedAt": "2026-05-01T00:10:00+00:00"}),
                encoding="utf-8",
            )

            manager = CodexPoolFailoverManager(
                enabled=True,
                store_dir=str(store_dir),
                active_auth_path=str(active_auth_path),
                default_cooldown_ms=30 * 60 * 1000,
            )

            result = manager.handle_account_scoped_limit(
                provider_account_id="provider-shared",
                request_access_token="access-current",
                reason="usage_limit_reached",
                cooldown_seconds=60,
            )

            self.assertTrue(result["switched"])
            self.assertEqual(result["nextAccountId"], "acct-recent-ready")


if __name__ == "__main__":
    unittest.main()

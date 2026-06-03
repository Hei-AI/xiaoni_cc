import json
import unittest

from codex_limit import classify_codex_429, classify_codex_websocket_message


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


if __name__ == "__main__":
    unittest.main()

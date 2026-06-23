#!/usr/bin/env python3
import unittest

import xiaoni_playwright_cli_bridge as bridge


class XiaoniPlaywrightCliBridgeTest(unittest.TestCase):
    def test_extension_attach_uses_short_timeout(self):
        self.assertEqual(
            bridge._command_timeout_seconds(
                ["-s=xiaoni-host", "attach", "--extension=chrome"],
                120,
            ),
            bridge.DEFAULT_EXTENSION_ATTACH_TIMEOUT_SECONDS,
        )

    def test_plain_commands_keep_requested_timeout(self):
        self.assertEqual(
            bridge._command_timeout_seconds(["-s=xiaoni-host", "snapshot"], 120),
            120,
        )

    def test_extension_attach_respects_smaller_requested_timeout(self):
        self.assertEqual(
            bridge._command_timeout_seconds(
                ["-s=xiaoni-host", "attach", "--extension=chrome"],
                3,
            ),
            3,
        )

    def test_open_command_is_rejected_as_removed_fallback(self):
        error = bridge._removed_fallback_error(
            ["-s=xiaoni-host", "open", "https://example.com", "--browser", "chrome", "--headed"],
        )
        self.assertIn("fallback removed", error)
        self.assertIn("Profile 2", error)

    def test_cdp_commands_are_rejected_as_removed_fallback(self):
        self.assertIn("CDP fallback removed", bridge._removed_fallback_error(["ensure-cdp"]))
        self.assertIn(
            "CDP fallback removed",
            bridge._removed_fallback_error(["-s=xiaoni-host", "attach", "--cdp", "http://127.0.0.1:9222"]),
        )

    def test_plain_extension_attach_is_not_rejected(self):
        self.assertEqual(
            bridge._removed_fallback_error(["-s=xiaoni-host", "attach", "--extension=chrome"]),
            "",
        )

    def test_windows_cli_env_forces_ipv4_mcp_host(self):
        self.assertEqual(bridge._windows_cli_env()["PLAYWRIGHT_MCP_HOST"], "127.0.0.1")

    def test_cli_extension_relay_patch_normalizes_ipv6_loopback(self):
        source = (
            'const mcpRelayEndpoint = `${this._wsHost}${this._extensionPath}`;'
            'const url2 = new URL(`chrome-extension://${playwrightExtensionId}/connect.html`);'
            'await startHttpServer(httpServer, {});'
        )
        patched = bridge._patch_cli_extension_relay_loopback(source)
        self.assertIn('replace("ws://[::1]", "ws://127.0.0.1")', patched)
        self.assertIn("/connect.html", patched)
        self.assertNotIn("/xiaoni-connect.html", patched)
        self.assertIn('startHttpServer(httpServer, { host: "127.0.0.1" })', patched)

    def test_auto_connect_creates_debuggable_tab_when_none_exists(self):
        block = bridge._auto_connect_block("token === expectedToken")
        self.assertIn('chrome.tabs.create({ url: "about:blank", active: true })', block)
        self.assertIn("await handleConnectToTab(targetTab)", block)

    def test_wrapper_env_line_is_replaced(self):
        text = '$env:PLAYWRIGHT_EXTENSION_PROTOCOL = "2"\n'
        patched = bridge._ensure_powershell_env_line(text, "PLAYWRIGHT_EXTENSION_PROTOCOL", "1", "\n")
        self.assertEqual(patched.strip(), '$env:PLAYWRIGHT_EXTENSION_PROTOCOL = "1"')

    def test_minimal_connect_script_drives_extension_messages(self):
        script = bridge._minimal_connect_script("token")
        self.assertIn('type: "connectionRequested"', script)
        self.assertIn('type: "connectToTab"', script)
        self.assertIn('chrome.tabs.create({ url: "about:blank", active: true })', script)


if __name__ == "__main__":
    unittest.main()

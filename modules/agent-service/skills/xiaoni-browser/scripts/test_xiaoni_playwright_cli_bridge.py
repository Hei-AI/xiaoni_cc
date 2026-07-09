#!/usr/bin/env python3
import tempfile
import unittest
from pathlib import Path

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

    def test_session_missing_detects_not_open_message(self):
        self.assertTrue(
            bridge._session_missing(
                "The browser 'xiaoni-host' is not open, please run open first", ""
            )
        )
        self.assertTrue(
            bridge._session_missing("", "is not open, please run open first\n")
        )

    def test_session_missing_ignores_normal_output(self):
        self.assertFalse(bridge._session_missing("### Snapshot\n- link [ref=e6]", ""))

    def test_auto_attachable_for_normal_commands(self):
        self.assertTrue(bridge._is_auto_attachable(["-s=xiaoni-host", "goto", "https://x"]))
        self.assertTrue(bridge._is_auto_attachable(["-s=xiaoni-host", "snapshot"]))
        self.assertTrue(bridge._is_auto_attachable(["-s=xiaoni-host", "tab-list"]))

    def test_auto_attachable_excludes_control_commands(self):
        # These must not trigger auto-attach recursion or fight the removed-fallback gate.
        for control in (
            ["-s=xiaoni-host", "attach", "--extension=chrome"],
            ["ensure-extension"],
            ["-s=xiaoni-host", "open"],
            ["--help"],
        ):
            self.assertFalse(bridge._is_auto_attachable(control), control)

    def test_attach_failed_flags_target_closed(self):
        # The self-heal trigger: attach created a session then the target closed
        # because the running Chrome had no patched extension loaded.
        self.assertTrue(
            bridge._attach_failed(
                "### Session `xiaoni-host` created, attached to `chrome`.\n"
                "### Error\nError: Target page, context or browser has been closed",
                "",
            )
        )

    def test_media_goto_url_detects_image_documents(self):
        self.assertEqual(
            bridge._media_goto_url(["-s=xiaoni-host", "goto", "https://x.top/temp-coach.svg"]),
            "https://x.top/temp-coach.svg",
        )
        self.assertEqual(
            bridge._media_goto_url(["-s=xiaoni-host", "goto", "https://x.top/a.png?v=2"]),
            "https://x.top/a.png?v=2",
        )

    def test_media_goto_url_ignores_html_pages(self):
        self.assertIsNone(bridge._media_goto_url(["-s=xiaoni-host", "goto", "https://example.com"]))
        self.assertIsNone(bridge._media_goto_url(["-s=xiaoni-host", "goto", "https://x.top/page.html"]))
        # non-goto commands never rewrite
        self.assertIsNone(bridge._media_goto_url(["-s=xiaoni-host", "snapshot"]))

    def test_wrap_media_goto_builds_setcontent_run_code(self):
        wrapped = bridge._wrap_media_goto_args("xiaoni-host", "https://x.top/a.svg")
        self.assertEqual(wrapped[0], "-s=xiaoni-host")
        self.assertEqual(wrapped[1], "run-code")
        self.assertIn("setContent", wrapped[2])
        self.assertIn("https://x.top/a.svg", wrapped[2])
        # top document stays HTML (an <img>), never a raw top-level image nav
        self.assertIn("<img", wrapped[2])

    def test_is_navigation(self):
        self.assertTrue(bridge._is_navigation(["-s=xiaoni-host", "goto", "https://x"]))
        self.assertFalse(bridge._is_navigation(["-s=xiaoni-host", "snapshot"]))
        self.assertFalse(bridge._is_navigation(["-s=xiaoni-host", "click", "e6"]))

    def test_nav_timeout_detected_from_body_or_returncode(self):
        # The CLI can report a nav timeout as rc 0 with a TimeoutError body...
        self.assertTrue(
            bridge._looks_like_nav_timeout(
                {
                    "returncode": 0,
                    "stdout": "### Error\nTimeoutError: Timeout 60000ms exceeded.\n  - navigating to \"https://example.com/\"",
                    "stderr": "",
                }
            )
        )
        # ...or as a bridge-level timeout (rc 124 / timed_out).
        self.assertTrue(
            bridge._looks_like_nav_timeout({"returncode": 124, "stdout": "", "stderr": "", "timed_out": True})
        )

    def test_nav_timeout_false_on_success(self):
        self.assertFalse(
            bridge._looks_like_nav_timeout(
                {"returncode": 0, "stdout": "### Page\n- Page URL: https://example.com/", "stderr": ""}
            )
        )

    def test_minimal_connect_script_drives_extension_messages(self):
        script = bridge._minimal_connect_script("token")
        self.assertIn('type: "connectionRequested"', script)
        self.assertIn('type: "connectToTab"', script)
        self.assertIn('chrome.tabs.create({ url: "about:blank", active: true })', script)

    def test_slug_prefers_url_basename_over_title(self):
        self.assertEqual(
            bridge._slug_for_label(path="blinds.html", title="小伊的日记"),
            "blinds",
        )

    def test_slug_strips_extension_and_lowercases(self):
        self.assertEqual(bridge._slug_for_label(path="Diary.HTML"), "diary")

    def test_slug_falls_back_to_title_when_no_path(self):
        self.assertEqual(
            bridge._slug_for_label(path="", title="Blinds All Open"),
            "blinds-all-open",
        )

    def test_slug_cjk_only_title_yields_none(self):
        # CJK slugs to empty; caller then keeps the bare timestamp name.
        self.assertIsNone(bridge._slug_for_label(path="", title="小伊的日记"))

    def test_slug_empty_inputs_yield_none(self):
        self.assertIsNone(bridge._slug_for_label(path="", title=""))

    def test_slug_caps_length(self):
        self.assertLessEqual(len(bridge._slug_for_label(path="a" * 200)), 40)

    def test_save_png_appends_label_suffix(self):
        with tempfile.TemporaryDirectory() as tmp:
            original = bridge.RUNTIME_HOST_ROOT
            bridge.RUNTIME_HOST_ROOT = tmp
            try:
                path = bridge._save_png_to_runtime_picture_dir(b"\x89PNG", label="blinds")
            finally:
                bridge.RUNTIME_HOST_ROOT = original
            self.assertTrue(path.endswith("-blinds.png"))
            self.assertIn("xiaoni-computer-", path)
            written = Path(tmp) / "picture" / Path(path).name
            self.assertEqual(written.read_bytes(), b"\x89PNG")

    def test_save_png_without_label_keeps_bare_timestamp(self):
        with tempfile.TemporaryDirectory() as tmp:
            original = bridge.RUNTIME_HOST_ROOT
            bridge.RUNTIME_HOST_ROOT = tmp
            try:
                path = bridge._save_png_to_runtime_picture_dir(b"\x89PNG", label=None)
            finally:
                bridge.RUNTIME_HOST_ROOT = original
            name = Path(path).name
            self.assertTrue(name.startswith("xiaoni-computer-"))
            self.assertTrue(name.endswith("Z.png"))


    def test_patch_non_debuggable_schemes_adds_view_source(self):
        # A view-source: tab poisons Target.setAutoAttach and wedges the whole
        # session; the fix is to list view-source: as non-debuggable so the
        # extension never attaches it.
        patched = bridge._patch_non_debuggable_schemes(
            'const NON_DEBUGGABLE_SCHEMES = ["chrome:", "edge:", "devtools:"];\n'
        )
        self.assertIn('"view-source:"', patched)
        self.assertIn(
            'const NON_DEBUGGABLE_SCHEMES = '
            '["chrome:", "chrome-extension:", "edge:", "devtools:", "view-source:"];',
            patched,
        )

    def test_patch_non_debuggable_schemes_is_idempotent(self):
        # Re-patching an already-patched (4-item) file must still land view-source:,
        # because the old 3-item literal no longer matches a plain string replace.
        once = bridge._patch_non_debuggable_schemes(
            'const NON_DEBUGGABLE_SCHEMES = '
            '["chrome:", "chrome-extension:", "edge:", "devtools:"];\n'
        )
        self.assertIn('"view-source:"', once)
        twice = bridge._patch_non_debuggable_schemes(once)
        self.assertEqual(once, twice)
        # Exactly one array literal, no duplication.
        self.assertEqual(once.count("NON_DEBUGGABLE_SCHEMES = ["), 1)

    def test_patch_non_debuggable_schemes_leaves_other_code_untouched(self):
        source = (
            "const FOO = 1;\n"
            'const NON_DEBUGGABLE_SCHEMES = ["chrome:", "edge:", "devtools:"];\n'
            "function isNonDebuggableUrl(url) { return url; }\n"
        )
        patched = bridge._patch_non_debuggable_schemes(source)
        self.assertIn("const FOO = 1;", patched)
        self.assertIn("function isNonDebuggableUrl(url)", patched)

    def test_restricted_goto_wraps_view_source_of_http(self):
        target = bridge._restricted_goto_target(
            ["-s=xiaoni-host", "goto", "view-source:https://www.novalattice.online/graph.html"]
        )
        self.assertEqual(target, ("wrap", "https://www.novalattice.online/graph.html"))

    def test_restricted_goto_refuses_chrome_and_devtools(self):
        self.assertEqual(
            bridge._restricted_goto_target(["-s=xiaoni-host", "goto", "chrome://settings"]),
            ("refuse", "chrome:"),
        )
        self.assertEqual(
            bridge._restricted_goto_target(["-s=xiaoni-host", "goto", "devtools://devtools/"]),
            ("refuse", "devtools:"),
        )

    def test_restricted_goto_refuses_non_http_view_source(self):
        self.assertEqual(
            bridge._restricted_goto_target(["-s=xiaoni-host", "goto", "view-source:chrome://version"]),
            ("refuse", "view-source:"),
        )

    def test_restricted_goto_ignores_plain_http_and_non_goto(self):
        self.assertIsNone(
            bridge._restricted_goto_target(["-s=xiaoni-host", "goto", "https://example.com"])
        )
        self.assertIsNone(
            bridge._restricted_goto_target(["-s=xiaoni-host", "goto", "about:blank"])
        )
        self.assertIsNone(bridge._restricted_goto_target(["-s=xiaoni-host", "tab-list"]))

    def test_wrap_view_source_builds_run_code_with_pre_and_escaping(self):
        args = bridge._wrap_view_source_goto_args("xiaoni-host", "https://example.com/x.html")
        self.assertEqual(args[0], "-s=xiaoni-host")
        self.assertEqual(args[1], "run-code")
        js = args[2]
        self.assertIn("https://example.com/x.html", js)
        self.assertIn("<pre", js)
        self.assertIn("&amp;", js)  # runtime HTML-escaping of the fetched source
        self.assertIn("page.goto(", js)

    def test_wrap_view_source_has_no_space_inside_quoted_attrs(self):
        # The run-code JS is one CLI arg re-parsed by the PowerShell -File wrapper;
        # a space inside a double-quoted HTML attribute splits it in two
        # ("too many arguments"). Guard against reintroducing that footgun.
        js = bridge._wrap_view_source_goto_args("xiaoni-host", "https://example.com/")[2]
        segments = js.split('"')
        # Odd indices are the contents between double quotes.
        for i in range(1, len(segments), 2):
            self.assertNotIn(" ", segments[i], f"space inside quoted attr: {segments[i]!r}")

    def test_refuse_restricted_goto_result_shape(self):
        result = bridge._refuse_restricted_goto_result("chrome:")
        self.assertFalse(result["ok"])
        self.assertEqual(result["returncode"], 2)
        self.assertIn("chrome:", result["stderr"])
        self.assertIn("view-source:", result["stderr"])  # points to the safe path


if __name__ == "__main__":
    unittest.main()

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


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Deprecated compatibility shim for the retired MCP browser client.

History: this script used to drive the browser through the Playwright *MCP*
server on :9978 (Windows-side, unsupervised). The xiaoni-browser skill migrated
to the self-healing playwright-cli bridge on :9977 in commit 5b42066f
(2026-06-13); SKILL.md and the operator docs were updated to
xiaoni_playwright_cli.py, but this file was left on disk still pointed at the
now-dead :9978 upstream.

Because nothing supervises that Windows-side MCP server, a stale
`xiaoni_browser.py <cmd>` invocation (Xiaoni occasionally replays the
pre-migration command from her own append-only history) returned a misleading
`HTTP 502: Upstream Playwright MCP unavailable` — which reads like an
infrastructure outage instead of "retired command". Every past "fix" then chased
the (always-healthy) WSL forwarder services and never stuck.

This shim now transparently forwards to xiaoni_playwright_cli.py (the working
:9977 bridge) so the old command Just Works. Prefer xiaoni_playwright_cli.py
directly — see SKILL.md.
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_CLI = os.path.join(_HERE, "xiaoni_playwright_cli.py")
_SESSION = "-s=xiaoni-host"

# The retired MCP client used a few verb names that differ from playwright-cli.
# Map only the ones that differ; every other verb is forwarded verbatim (the CLI
# emits its own honest usage error for anything it doesn't recognize — strictly
# better than the old misleading 502). playwright-cli verb parity is confirmed
# for the interaction set Xiaoni actually uses: goto/click/fill/type/hover/drag/
# select/upload/snapshot/screenshot/run-code/console/requests/dialog-accept/close.
_VERB_ALIASES = {
    "tabs": ["tab-list"],
    "status": ["tab-list"],
}

# MCP-only batch/raw forms have no single playwright-cli equivalent.
_MCP_ONLY = {"tool", "sequence"}


def translate(argv):
    """Map retired-client argv -> playwright-cli argv (session-prefixed)."""
    if not argv:
        return [_SESSION, "--help"]
    verb, rest = argv[0], list(argv[1:])
    head = _VERB_ALIASES.get(verb, [verb])
    return [_SESSION, *head, *rest]


def main(argv):
    if argv and argv[0] in _MCP_ONLY:
        sys.stderr.write(
            f"xiaoni_browser.py `{argv[0]}` is a retired MCP-only form with no "
            f"playwright-cli equivalent. Issue individual commands via:\n"
            f"  python3 {_CLI} -- {_SESSION} <cmd> ...\n"
        )
        return 2
    sys.stderr.write(
        "note: xiaoni_browser.py is retired; forwarding to xiaoni_playwright_cli.py "
        "(:9977 host bridge). Prefer that command directly.\n"
    )
    sys.stderr.flush()
    args = translate(argv)
    # Replace this process with the working CLI client so its exit code / stdout
    # reach the caller unchanged.
    os.execv(sys.executable, [sys.executable, _CLI, "--", *args])


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

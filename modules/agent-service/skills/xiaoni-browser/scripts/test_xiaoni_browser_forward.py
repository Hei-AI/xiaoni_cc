"""Regression test for the retired xiaoni_browser.py -> xiaoni_playwright_cli.py
forward shim.

Guards the root cause fix: the retired MCP client (dead :9978) now forwards to
the working :9977 CLI path instead of returning a misleading HTTP 502. These
assert the argv translation without touching a live browser.
"""
import importlib.util
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "xiaoni_browser", os.path.join(_HERE, "xiaoni_browser.py")
)
xb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(xb)


def test_goto_forwards_verbatim_with_session():
    # Xiaoni's exact failing command must forward to the working CLI verbatim.
    assert xb.translate(["goto", "https://novalattice.online/704"]) == [
        "-s=xiaoni-host",
        "goto",
        "https://novalattice.online/704",
    ]


def test_interaction_verbs_pass_through_unchanged():
    assert xb.translate(["click", "e6"]) == ["-s=xiaoni-host", "click", "e6"]
    assert xb.translate(["fill", "e12", "hello"]) == [
        "-s=xiaoni-host",
        "fill",
        "e12",
        "hello",
    ]
    assert xb.translate(["run-code", "async (page) => await page.title()"]) == [
        "-s=xiaoni-host",
        "run-code",
        "async (page) => await page.title()",
    ]


def test_renamed_verbs_are_aliased_to_cli_names():
    assert xb.translate(["tabs"]) == ["-s=xiaoni-host", "tab-list"]
    assert xb.translate(["status"]) == ["-s=xiaoni-host", "tab-list"]


def test_empty_argv_falls_back_to_help():
    assert xb.translate([]) == ["-s=xiaoni-host", "--help"]


def test_mcp_only_verbs_are_flagged_not_forwarded():
    assert xb.main(["tool", "browser_navigate", "{}"]) == 2
    assert xb.main(["sequence", "[]"]) == 2

#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
AGENTS = ROOT / "AGENTS.md"
DOCS_INDEX = ROOT / "docs" / "INDEX.md"
EXEC_PLANS_README = ROOT / "docs" / "exec-plans" / "README.md"
ACTIVE_PLANS_DIR = ROOT / "docs" / "exec-plans" / "active"
COMPLETED_PLANS_DIR = ROOT / "docs" / "exec-plans" / "completed"

PATH_RE = re.compile(r"`((?:docs|README\.md|DOCKER\.md)[^`]*)`")
MAX_AGENTS_LINES = 100


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def extract_repo_paths(text: str) -> set[str]:
    return {
        match.group(1).rstrip("/")
        for match in PATH_RE.finditer(text)
        if not match.group(1).startswith("docs/")
        or match.group(1).endswith(".md")
        or "/" in match.group(1)
    }


def ensure(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def main() -> int:
    errors: list[str] = []

    ensure(AGENTS.exists(), "missing AGENTS.md", errors)
    ensure(DOCS_INDEX.exists(), "missing docs/INDEX.md", errors)
    ensure(EXEC_PLANS_README.exists(), "missing docs/exec-plans/README.md", errors)
    ensure(ACTIVE_PLANS_DIR.is_dir(), "missing docs/exec-plans/active/", errors)
    ensure(COMPLETED_PLANS_DIR.is_dir(), "missing docs/exec-plans/completed/", errors)

    if errors:
        print("\n".join(f"ERROR: {error}" for error in errors))
        return 1

    agents_text = read_text(AGENTS)
    docs_index_text = read_text(DOCS_INDEX)

    agents_line_count = len(AGENTS.read_text(encoding="utf-8").splitlines())
    ensure(
        agents_line_count <= MAX_AGENTS_LINES,
        f"AGENTS.md should stay concise (<= {MAX_AGENTS_LINES} lines, got {agents_line_count})",
        errors,
    )
    ensure("docs/INDEX.md" in agents_text, "AGENTS.md must point to docs/INDEX.md", errors)
    ensure("system of record" in agents_text, "AGENTS.md should state repo docs are the system of record", errors)

    agents_paths = extract_repo_paths(agents_text)
    index_paths = extract_repo_paths(docs_index_text)

    for rel_path in sorted(agents_paths | index_paths):
        path = ROOT / rel_path
        ensure(path.exists(), f"referenced path does not exist: {rel_path}", errors)

    docs_agent_files = {
        path.relative_to(ROOT).as_posix()
        for path in (ROOT / "docs").glob("AGENTS_*.md")
        if path.is_file()
    }
    indexed_agent_files = {path for path in index_paths if path.startswith("docs/AGENTS_")}
    ensure(
        docs_agent_files == indexed_agent_files,
        "docs/INDEX.md must list every docs/AGENTS_*.md file exactly once",
        errors,
    )

    required_index_refs = {
        "docs/exec-plans/active/",
        "docs/exec-plans/completed/",
        "docs/exec-plans/README.md",
    }
    ensure(
        required_index_refs.issubset({match.group(1) for match in PATH_RE.finditer(docs_index_text)}),
        "docs/INDEX.md must reference exec-plans active/, completed/, and README.md",
        errors,
    )

    if errors:
        print("\n".join(f"ERROR: {error}" for error in errors))
        return 1

    print("Docs validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

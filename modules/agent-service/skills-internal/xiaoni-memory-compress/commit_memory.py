#!/usr/bin/env python3
"""xiaoni-memory-compress: atomically stash 小腻's compressed 近况 to a fresh file.

Reads the memory text from stdin, validates it is non-empty, and writes it to a file via a
temp-file + rename so the compression fork never reads a half-written file. This is the commit
channel for Spec B (compress_core_memory is no longer a wire tool): the compression fork guides
the model to run this, then reads the file back to install the new <xiaoni_status>.

The model does NOT pick the filename. When --out is omitted (the normal path), this script
mints a brand-new unique name under the compress dir every run and prints the path it chose on
a `XIAONI_COMPRESS_WROTE=<path>` line. The engine reads that line back and knows exactly which
file this round wrote — so a stale leftover from a previous round can never be mistaken for this
round's 近况 (that read-before-write staleness was the whole bug this design closes). --out stays
supported for back-compat / explicit callers.
"""
import argparse
import os
import sys
import tempfile
import uuid
from datetime import datetime

# Keep this many recent capsules for trace/debug; prune older ones so unique-per-run
# filenames don't accumulate unbounded.
KEEP_RECENT = 12
AUTO_PREFIX = 'xiaoni-status-'


def default_compress_dir() -> str:
    root = os.environ.get('XIAONI_RUNTIME_ROOT', '/xiaoni-runtime').rstrip('/')
    return f'{root}/compress'


def mint_output_path() -> str:
    out_dir = default_compress_dir()
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    return os.path.join(out_dir, f'{AUTO_PREFIX}{stamp}-{uuid.uuid4().hex[:8]}.md')


def prune_old_capsules(out_dir: str, keep_path: str) -> None:
    try:
        entries = [
            os.path.join(out_dir, name)
            for name in os.listdir(out_dir)
            if name.startswith(AUTO_PREFIX) and name.endswith('.md')
        ]
    except OSError:
        return
    keep_abs = os.path.abspath(keep_path)
    def _safe_mtime(p):
        # A concurrent run may unlink between listdir and here; never let a TOCTOU race
        # raise (that would crash the commit before the handshake line is printed).
        try:
            return os.path.getmtime(p)
        except OSError:
            return 0.0
    # Newest first by mtime; always retain the file we just wrote.
    entries.sort(key=_safe_mtime, reverse=True)
    for path in entries[KEEP_RECENT:]:
        if os.path.abspath(path) == keep_abs:
            continue
        try:
            os.unlink(path)
        except OSError:
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Stash 小腻's compressed 近况 to a file.")
    parser.add_argument(
        '--out',
        default=None,
        help='destination path for the 近况 file (optional; a fresh unique name is minted when omitted)'
    )
    args = parser.parse_args()

    text = sys.stdin.read().strip()
    if not text:
        print('ERROR: empty memory text on stdin; nothing written', file=sys.stderr)
        return 1

    auto_named = args.out is None
    out_path = os.path.abspath(args.out if args.out is not None else mint_output_path())
    # The marker line is single-line and the engine parses it with a `.`-based regex; a control
    # char in the path (only reachable via a hand-passed --out) would split/corrupt it. Reject.
    if any(ord(ch) < 0x20 for ch in out_path):
        print('ERROR: control character in output path; refusing to write', file=sys.stderr)
        return 1
    out_dir = os.path.dirname(out_path)
    os.makedirs(out_dir, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(dir=out_dir, prefix='.compress-', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(text)
        os.replace(tmp_path, out_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

    print(f'OK: wrote {len(text)} chars to {out_path}')
    # Machine-readable handshake: the engine greps this exact line out of the exec stdout to
    # learn which file this round wrote, then reads it back. Print it BEFORE the best-effort
    # prune below — the commit must never hinge on cleanup succeeding.
    print(f'XIAONI_COMPRESS_WROTE={out_path}')

    # Best-effort cleanup AFTER the handshake is out. `xiaoni-status-` is a reserved prefix for
    # auto-minted capsules; a hand-passed --out using that prefix could be pruned by a later run.
    if auto_named:
        try:
            prune_old_capsules(out_dir, out_path)
        except Exception:
            pass
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

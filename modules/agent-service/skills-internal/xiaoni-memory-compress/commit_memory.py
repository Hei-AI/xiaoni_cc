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

# 菜单健康自检(写入时闭环,CC「超限报错逼当场重写」的落点):她理完两张菜单紧接着跑本
# 脚本,超限/超长行/NUL 当场喊出来,她还在这个 loop 里就能整理。fail-open 铁律:检查本身
# 抛任何异常都不许影响提交——她自写文件的任何状态都不许把压缩卡死(红队 P1 教训)。
# 数值与 reminder/anchor skill 的软限、引擎硬 cap(25600)保持:软限 < 硬 cap。
MENU_SOFT_MAX_BYTES = 20 * 1024
MENU_SOFT_MAX_LINES = 300
MENU_LINE_WARN_BYTES = 300


def default_runtime_root() -> str:
    return os.environ.get('XIAONI_RUNTIME_ROOT', '/xiaoni-runtime').rstrip('/')


def default_compress_dir() -> str:
    return f'{default_runtime_root()}/compress'


def check_menu_health() -> None:
    root = default_runtime_root()
    menus = [
        (f'{root}/notes/diary/INDEX.md', '日记目录',
         '把最老的整月那些行搬进 INDEX-<YYYY-MM>.md(不是删),顶层留一行指路'),
        (f'{root}/notes/people/INDEX.md', '人物菜单',
         '把久不联系的人的行搬进 INDEX-past.md(不是删),顶层留一行指路'),
    ]
    for path, label, remedy in menus:
        try:
            with open(path, 'rb') as handle:
                data = handle.read()
        except OSError:
            continue
        problems = []
        if b'\x00' in data:
            problems.append('文件里混进了 NUL 字节(\\x00),系统会剥掉它——找到那处并删掉')
        lines = data.decode('utf-8', errors='replace').splitlines()
        if len(data) > MENU_SOFT_MAX_BYTES or len(lines) > MENU_SOFT_MAX_LINES:
            problems.append(
                f'现在 {len(lines)} 行 / {len(data)} 字节,超过软限({MENU_SOFT_MAX_LINES} 行 / {MENU_SOFT_MAX_BYTES} 字节):{remedy}'
            )
        overlong = sum(1 for ln in lines if len(ln.encode('utf-8')) > MENU_LINE_WARN_BYTES)
        if overlong:
            problems.append(f'有 {overlong} 行超过 {MENU_LINE_WARN_BYTES} 字节——钩子话一两句就够,细节留在正文里')
        if problems:
            print(f'MENU_WARN[{label}] {path}')
            for item in problems:
                print(f'  - {item}')
            print('  趁现在还在整理记忆,先把它理好再继续。')


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
    parser.add_argument(
        '--check-menus',
        action='store_true',
        help='only run the diary/people menu health check (no stdin, no commit); always exits 0'
    )
    args = parser.parse_args()

    if args.check_menus:
        try:
            check_menu_health()
        except Exception:
            pass
        print('OK: menu check done')
        return 0

    # 写入时自检:提交近况的同一刻检查两张菜单,问题当场喊出来。fail-open——检查绝不影响提交。
    try:
        check_menu_health()
    except Exception:
        pass

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

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
import re
import sys
import tempfile
import uuid
from datetime import datetime

# Keep this many recent capsules for trace/debug; prune older ones so unique-per-run
# filenames don't accumulate unbounded.
KEEP_RECENT = 12
AUTO_PREFIX = 'xiaoni-status-'

# 菜单验收门(写入时强制,CC「超限报错逼当场重写」的落点):她理完两张菜单跑本脚本提交
# 近况时,先验收菜单——不达标就拒收(不写文件、不打 XIAONI_COMPRESS_WROTE),把差在哪、
# 怎么改打进 stdout,让她自己整理好再重新提交,直到满足要求。
# 为什么敢硬拒:压缩 fork 有 MAX_TURNS 上限 + 引擎兜底提交,她一直不达标压缩也会走兜底
# 完成——系统级 fail-open 由外层保证(红队 P1 铁律不破),所以这里可以硬。
# 唯一自动修的是 NUL 字节(她看不见、没法"重新生成"它;引擎 clamp 也会剥,双保险)。
# 数值与 reminder/anchor skill 的软限、引擎硬 cap(25600)对齐,三处同调。
MENU_SOFT_MAX_BYTES = 20 * 1024
MENU_SOFT_MAX_LINES = 300
MENU_LINE_WARN_BYTES = 300


def default_runtime_root() -> str:
    return os.environ.get('XIAONI_RUNTIME_ROOT', '/xiaoni-runtime').rstrip('/')


def default_compress_dir() -> str:
    return f'{default_runtime_root()}/compress'


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


def _atomic_write_text(path: str, text: str) -> None:
    out_dir = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(dir=out_dir, prefix='.menu-', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(text)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _validate_one_menu(path: str, remedy: str):
    """Returns a list of violation strings for one menu file (empty = 达标)."""
    try:
        with open(path, 'rb') as handle:
            data = handle.read()
    except OSError:
        return []
    if b'\x00' in data:
        # NUL 自动剥掉再验收:她看不见这个字节,让她"重新生成"没有意义
        data = data.replace(b'\x00', b'')
        try:
            _atomic_write_text(path, data.decode('utf-8', errors='replace'))
            print(f'MENU_FIXED[{path}] 剥掉了混进文件的 NUL 字节')
        except Exception:
            pass
    lines = data.decode('utf-8', errors='replace').splitlines()
    violations = []
    if len(data) > MENU_SOFT_MAX_BYTES or len(lines) > MENU_SOFT_MAX_LINES:
        violations.append(
            f'太长了:现在 {len(lines)} 行 / {len(data)} 字节,上限 {MENU_SOFT_MAX_LINES} 行 / {MENU_SOFT_MAX_BYTES} 字节。{remedy}'
        )
    overlong = [i + 1 for i, ln in enumerate(lines) if len(ln.encode('utf-8')) > MENU_LINE_WARN_BYTES]
    if overlong:
        shown = ','.join(str(n) for n in overlong[:5])
        violations.append(
            f'有 {len(overlong)} 行超过 {MENU_LINE_WARN_BYTES} 字节(第 {shown} 行{"等" if len(overlong) > 5 else ""})——钩子话一两句就够,把长的压短,细节留在正文里'
        )
    return violations


def validate_menus():
    """Returns {path: [violations]} for both menus; empty dict = 全部达标."""
    root = default_runtime_root()
    checks = [
        (f'{root}/notes/diary/INDEX.md', '日记目录',
         '把最老的整月那些按天的行搬进同目录 INDEX-<YYYY-MM>.md(原样搬不改写),顶层留一行「- YYYY-MM | 那个月的一句话(细目在 INDEX-YYYY-MM.md)」'),
        (f'{root}/notes/people/INDEX.md', '人物菜单',
         '把不常联系的人的行搬进同目录 INDEX-past.md(原样搬不删),顶层留一行「- 更早认识的人 | 细目在 INDEX-past.md」;要紧的人放上面'),
    ]
    result = {}
    for path, label, remedy in checks:
        try:
            violations = _validate_one_menu(path, remedy)
        except Exception:
            violations = []
        if violations:
            result[f'{label} {path}'] = violations
    return result


def print_menu_rejection(problems) -> None:
    print('MENU_REJECT: 菜单还不达标,这次先不收近况。整理好之后,重新跑这条命令提交(近况文本原样再传一遍):')
    for key, violations in problems.items():
        print(f'  [{key}]')
        for item in violations:
            print(f'    - {item}')


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
        help='only validate the diary/people menus and report (no stdin, no commit); always exits 0'
    )
    args = parser.parse_args()

    if args.check_menus:
        try:
            problems = validate_menus()
        except Exception:
            problems = {}
        if problems:
            print_menu_rejection(problems)
        else:
            print('OK: 两张菜单都达标')
        return 0

    # 写入时验收门:菜单不达标就拒收这次近况提交,让她整理好重来(外层 fork 有轮数上限+
    # 引擎兜底提交,系统级不会因此卡死)。验收自身出错按达标放行,不新增卡死面。
    try:
        problems = validate_menus()
    except Exception:
        problems = {}
    if problems:
        print_menu_rejection(problems)
        return 1

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

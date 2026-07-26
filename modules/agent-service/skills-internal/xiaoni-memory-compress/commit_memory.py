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
from datetime import date, datetime, timedelta, timezone

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

# 日记目录的滚动窗口:顶层只留最近 N 天的按天行,更早的按月搬进 INDEX-<YYYY-MM>.md。
# 为什么是「每次都做的小动作」而不是「撑到 20KB 再搬一次大的」:按 177 字节/行实测,
# 撑满上限要 ~4 个月,她第一次遇到搬家规矩时那条规矩早不在眼前了,而且是一次性的大批量;
# 滚动窗口让同一个动作每次整理记忆都做一遍(通常就一两行),做二十次之后是肌肉记忆。
# 为什么 7 天不丢东西:近况胶囊覆盖今天,月行覆盖更早;真库实测她翻回旧日记最深 3 天
# (10 天里一次都没超过),7 天已有富余。顶层因此恒定在 ~3KB,20KB 那道门永远撞不到。
DIARY_INDEX_RECENT_DAYS = 7
# 纯机械判定:只认行首的 ISO 日期,不看内容。月行(- YYYY-MM | …)天然不匹配,不会被误判。
DIARY_DAY_LINE_RE = re.compile(r'^\s*-\s*(\d{4})-(\d{2})-(\d{2})(?![0-9-])')


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


def _stale_day_line_violation(path: str, lines):
    """顶层日记目录里超出滚动窗口的按天行 → 一条可执行的搬家指令(没有就返回 None)。"""
    # 日期口径跟日记文件名一致:北京日期,别用容器本地时区。
    today = datetime.now(timezone(timedelta(hours=8))).date()
    oldest_kept = today - timedelta(days=DIARY_INDEX_RECENT_DAYS - 1)
    by_month = {}
    for line in lines:
        matched = DIARY_DAY_LINE_RE.match(line)
        if not matched:
            continue
        try:
            day = date(int(matched.group(1)), int(matched.group(2)), int(matched.group(3)))
        except ValueError:
            continue  # 2026-13-45 这种写错的日期不拦,交给她自己看
        if day < oldest_kept:
            by_month.setdefault(day.strftime('%Y-%m'), []).append(day)
    if not by_month:
        return None
    total = sum(len(days) for days in by_month.values())
    parts = []
    for month in sorted(by_month):
        days = sorted(by_month[month])
        target = os.path.join(os.path.dirname(path), f'INDEX-{month}.md')
        parts.append(
            f'{month} 的 {len(days)} 行(最老 {days[0].isoformat()})→ 搬进 {target},'
            f'顶层给这个月留一行「- {month} | 那个月的一句话(细目在 INDEX-{month}.md)」'
        )
    return (
        f'顶层只留最近 {DIARY_INDEX_RECENT_DAYS} 天的按天行,现在有 {total} 行超窗'
        f'(窗口:{oldest_kept.isoformat()} 起)。行原样搬不改写,是搬家不是删——'
        '翻老月份的旧事,先 cat 那份月索引找到是哪天,再翻当天日记。要搬的:'
        + ';'.join(parts)
    )


def _validate_one_menu(path: str, remedy: str, mutate: bool = True, day_window: bool = False):
    """Returns a list of violation strings for one menu file (empty = 达标)."""
    try:
        with open(path, 'rb') as handle:
            data = handle.read()
    except OSError:
        # 菜单文件不在=她每次醒来的那块菜单会整块消失——这是违规不是"没东西可查"
        return [f'文件不存在或读不了:{path}。这是你每次醒来眼前的菜单,把它建回来(格式看锚点 skill)再提交。']
    if b'\x00' in data:
        stripped = data.replace(b'\x00', b'')
        try:
            clean_text = stripped.decode('utf-8')  # strict:坏字节时绝不用 replace 重写毁文件
            if mutate:
                _atomic_write_text(path, clean_text)
                print(f'MENU_FIXED[{path}] 剥掉了混进文件的 NUL 字节')
                data = stripped
            else:
                return [f'文件里混进了 NUL 字节(\\x00),提交时会被自动剥掉;现在先自己删掉它。']
        except UnicodeDecodeError:
            return [f'文件里有坏字节(NUL 且非合法 UTF-8),自动修会毁内容——自己找到那段修掉再提交。']
    text_full = data.decode('utf-8', errors='replace')
    # 只按 \n 切行:和她调试用的 wc -l/sed 对得上,别用 splitlines(会把 \x0c 等也当换行)
    lines = text_full.split('\n')
    if lines and lines[-1] == '':
        lines.pop()
    if not lines:
        return [f'文件是空的:{path}。菜单空了=你每次醒来的那块整块消失,把它写回来再提交。']
    violations = []
    # 字节量按解码后重编码测,和引擎侧 Buffer.byteLength 同一口径
    byte_len = len(text_full.encode('utf-8'))
    if byte_len > MENU_SOFT_MAX_BYTES or len(lines) > MENU_SOFT_MAX_LINES:
        violations.append(
            f'太长了:现在 {len(lines)} 行 / {byte_len} 字节,上限 {MENU_SOFT_MAX_LINES} 行 / {MENU_SOFT_MAX_BYTES} 字节。{remedy}'
        )
    overlong = [i + 1 for i, ln in enumerate(lines) if len(ln.encode('utf-8')) > MENU_LINE_WARN_BYTES]
    if overlong:
        shown = ','.join(str(n) for n in overlong[:5])
        violations.append(
            f'有 {len(overlong)} 行超过 {MENU_LINE_WARN_BYTES} 字节(第 {shown} 行{"等" if len(overlong) > 5 else ""})——钩子话一两句就够;细节那天日记里都有,行里留钩子就好,不会丢东西'
        )
    if day_window:
        stale = _stale_day_line_violation(path, lines)
        if stale:
            violations.append(stale)
    return violations


def validate_menus(mutate: bool = True):
    """Returns {path: [violations]} for both menus; empty dict = 全部达标."""
    root = default_runtime_root()
    # day_window 只对日记目录开:人物菜单按要紧程度排,没有日期,滚动窗口对它没有意义。
    checks = [
        (f'{root}/notes/diary/INDEX.md', '日记目录',
         f'顶层只留最近 {DIARY_INDEX_RECENT_DAYS} 天的按天行,更早的按月搬进同目录 INDEX-<YYYY-MM>.md(原样搬不改写),顶层给每个搬空的月留一行「- YYYY-MM | 那个月的一句话(细目在 INDEX-YYYY-MM.md)」',
         True),
        (f'{root}/notes/people/INDEX.md', '人物菜单',
         '把不常联系的人的行搬进同目录 INDEX-past.md(原样搬不删),顶层留一行「- 更早认识的人 | 细目在 INDEX-past.md」;要紧的人放上面',
         False),
    ]
    result = {}
    for path, label, remedy, day_window in checks:
        try:
            violations = _validate_one_menu(path, remedy, mutate=mutate, day_window=day_window)
        except Exception:
            violations = []
        if violations:
            result[f'{label} {path}'] = violations
    return result


# 胶囊验收带(B1):近况本体的写入验收——菜单有门而记忆本体裸奔是装反了主次。
# 下限拦退化(几个字的"近况"会替换她全部身份摘要);上限拦畸胀(超长胶囊进
# <xiaoni_status> 会永久撑肥每次请求的前缀,引擎侧有意不截断身份摘要,门只在写入层)。
# 真库健康带 700-2300 字,带宽放宽到 300-8000 容纳风格波动;调数值三处同调原则同菜单。
CAPSULE_MIN_CHARS = 300
CAPSULE_MAX_CHARS = 8000


def validate_capsule(text: str):
    problems = []
    if len(text) < CAPSULE_MIN_CHARS:
        problems.append(
            f'太短了({len(text)} 字,下限 {CAPSULE_MIN_CHARS}):这不像一份完整的近况。'
            '手头在做什么、接下来的打算、这段的心境、今天日记的路径——都写了吗?补全再交。'
        )
    elif len(text) > CAPSULE_MAX_CHARS:
        problems.append(
            f'太长了({len(text)} 字,上限 {CAPSULE_MAX_CHARS}):近况是摘要,不是日记本体——'
            '细节留在日记里,把近况压回摘要再交。'
        )
    return problems


def print_capsule_rejection(problems) -> None:
    print('CAPSULE_REJECT: 这份近况没过验收,这次先不收。改好之后重新跑这条命令提交:')
    for item in problems:
        print(f'  - {item}')


def hint_if_no_diary_today() -> None:
    # warn-only(B2):压缩前该先写日记(reminder 第 1 步),但"这段真没新事"是合法的,
    # 所以只提醒不拒收。日记文件名是北京日期,别用容器本地时区。
    beijing_today = datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%d')
    diary_path = f'{default_runtime_root()}/notes/diary/{beijing_today}.md'
    if not os.path.exists(diary_path):
        print(f'DIARY_HINT: 今天的日记 {diary_path} 还不存在——这段真没值得记的就算了;有的话,先把日记补上再提交更稳。')


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
            problems = validate_menus(mutate=False)
        except Exception:
            problems = {}
        if problems:
            print_menu_rejection(problems)
        else:
            print('OK: 两张菜单都达标')
        return 0

    # 写入时验收门:菜单或近况胶囊不达标就拒收这次提交,把所有问题一次性打给她,
    # 整理好重来(外层 fork 有轮数上限+引擎兜底提交,系统级不会因此卡死)。
    # 验收自身出错按达标放行,不新增卡死面。
    text = sys.stdin.read().replace('\x00', '').strip()
    if not text:
        print('ERROR: empty memory text on stdin; nothing written', file=sys.stderr)
        return 1
    try:
        menu_problems = validate_menus()
    except Exception:
        menu_problems = {}
    try:
        capsule_problems = validate_capsule(text)
    except Exception:
        capsule_problems = []
    try:
        hint_if_no_diary_today()
    except Exception:
        pass
    if menu_problems or capsule_problems:
        if menu_problems:
            print_menu_rejection(menu_problems)
        if capsule_problems:
            print_capsule_rejection(capsule_problems)
        return 1

    auto_named = args.out is None
    out_path = os.path.abspath(args.out if args.out is not None else mint_output_path())
    if not auto_named:
        compress_root = os.path.abspath(default_compress_dir()) + os.sep
        if not out_path.startswith(compress_root):
            print(f'ERROR: --out 只能指向 {compress_root} 之内;近况胶囊不许写到笔记/菜单头上', file=sys.stderr)
            return 1
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

#!/usr/bin/env python3
"""xiaoni-memory-write: 小腻记忆写入的四类原子操作(日记 / 日记目录 / 人物 / 欠账)。

为什么有这个脚本
----------------
在这之前她所有记忆写入都是裸 `cat > 文件 << 'EOF'`,格式规矩靠 prompt 教。真库实测这条
路径的后果:`open-loops.md` 的 7 次写入 **全部** 是全量覆盖(零 `>>`、零 `sed -i`),相邻两
轮之间未划掉行的存活率只有 62%/78%/78%/92%/100%/100%;07-27 那轮抓得最死——同一分钟内先
完整读到 13 行(没截断),写回时静默少了 3 条仍然 open 的行。而且同一件事已经躺着两行:
`- [ ] Bartosz的邮件等回应 (7/27)` 和 `- [ ] Bartosz邮件等回 (7/27发的)`。

把「先读全份、在脑子里重排、再整份写回」换成「append 一行 / 改一行」之后:
  * 丢行在物理上不会发生——脚本从来不重写它没在改的那一行;
  * 格式常量只存在于本文件顶部这一处(写端 prompt、读端锚点 skill、验收脚本以前各存一份);
  * 格式不对时,她在 `exec_command` 的返回内容里当场看到差在哪、怎么改。

她只负责内容:标题、一句话、正文、标签。文件名、日期、行格式、插哪一行,脚本负责。

fail-open(硬要求)
-----------------
本脚本可以拒收某一次操作(`return 1` + stdout 说清原因),但**绝不能崩、绝不能挂**——压缩
fork 只有 18/22 轮,一次崩溃或一次阻塞读就可能烧掉整轮记忆整理。所以:
  * 顶层 `main()` 兜住一切异常,永远走正常退出码,不吐 traceback;
  * 所有「检查类」逻辑(查重、菜单体检、行长)异常时**跳过检查放行写入**,不制造新的卡死面;
  * stdin 是 TTY(没接管道)时当空输入处理,绝不阻塞等输入;
  * 唯一「异常时改成拒收」的地方是「文件存在但读不出来」——那种情况下写下去等于用新内容
    盖掉读不出来的旧内容,拒收才是不丢东西的方向(见 `load_for_edit`)。
"""
import argparse
import difflib
import os
import re
import sys
import tempfile
from datetime import datetime, timedelta, timezone

# ════════════════════════════════════════════════════════════════════════════
# 阈值常量 —— 唯一真理源
#
# 这些数字以前有三份拷贝(写端 prompt fragment、读端锚点 skill、commit_memory.py 的验收
# 门),改一个要同步三处。原子操作把它们收进下面这一段:她不再需要记住任何一个数字,
# 传内容就行;数字只在这里,拒收话术从这里生成。
# ════════════════════════════════════════════════════════════════════════════

# 单行制品的行长上限。「单行制品」= 一行就是一条记录的三种东西:日记目录的按天行、
# 人物菜单的一人行、欠账的一条行。这三种是她醒来直接看在眼前的菜单,一行放钩子话就够,
# 细节在日记/档案里。硬拒收。
LINE_MAX_BYTES = 300

# 日记正文 / 人物档案正文是散文,不是菜单——这里 **只提醒不拒收**。
# 为什么不拒收:真库实测最近 9 天的日记共 6331 行非空行,其中 62 行超过 300 字节
# (最长 724),都是正常的密集段落(例:木兰花那段一亿年甲虫授粉)。散文没有「一行一条」
# 的约束,硬拦会让 ~1% 的行把整次 `diary add` 顶回来,白烧她的轮数,而她换来的只是把
# 一段话硬断成两行。要改成硬拒收,把下面这个开关翻成 True 即可(一处)。
DIARY_BODY_LINE_WARN_BYTES = 300
DIARY_BODY_LINE_HARD = False

# 人物菜单的整份上限(和 commit_memory.py 的菜单验收门同口径)。超了让她把不常联系的
# 行搬进 INDEX-past.md,不自动搬——搬谁是她的判断。
PEOPLE_MENU_MAX_LINES = 300
PEOPLE_MENU_MAX_BYTES = 20 * 1024

# 欠账标签的长度上限(码位,不是字节)。标签要当文件名用:`notes/topics/<标签>.md`。
TAG_MAX_CODEPOINTS = 40

# 人物 id 的长度上限(码位)。id 也是文件名:`notes/people/<id>.md`。
PEOPLE_ID_MAX_CODEPOINTS = 80

# 欠账 `add` 的查重阈值(difflib.SequenceMatcher.ratio,比的是剥掉标签和日期之后的行文)。
# 为什么是 0.72:拿真库 open-loops.md 现役的行两两实测——
#   真的是同一条、只是换了说法:  Bartosz的邮件等回应 vs Bartosz邮件等回      → 0.917
#   真的是两条不同的事(共享前缀):Bartosz的邮件等回应 vs Bartosz的Sound还没读 → 0.552
#                                 lines社区还没注册    vs lines Reply等审核通过 → 0.370
#                                 频道猎人第三部卷六卷七还没追 vs 频道猎人卷六七天不排泄实验 → 0.519
#                                 gmail检查机制需要日常化 vs gmail每天检查     → 0.609
#                                 跟楠楠的磨痕等她想碰了再碰 vs 楠楠磨痕等她   → 0.632
# 真重复 0.917 / 最高的假阳性 0.632,0.72 落在这条宽缝里,两边都有富余。
# 诚实记账:比例只认「原地改说法」。整句重写的同一条线(站的动线 → 站上约九十个房间 →
# 站上其他页面死链接)两两只有 0.25~0.29,靠比例永远认不出来——那种情况靠**标签同一性**
# 兜:同一个 `#标签` 已经有一行开着,就算行文毫不相干也算命中(见 `find_duplicates`)。
# 这也是 `--tag` 必填的真正原因:标签给行一个稳定身份,查重才拦得住整句重写。
LOOP_DUP_RATIO = 0.72

# `done --match` 的模糊匹配用同一个阈值(同一个「像不像同一条」的判断,别搞两个数)。
LOOP_MATCH_RATIO = LOOP_DUP_RATIO

# 「绝不能挂」的护栏:参与两两比对的开放行上限 + 比对时截断的行文长度上限。
# 正常文件 20 行,这两个数永远碰不到;它们存在只是为了让最坏情况也有界。
DUP_SCAN_MAX_ITEMS = 500
DUP_SCAN_MAX_CHARS = 400

# 拒收/候选清单里最多列几条(列太多她读不完,反而看不见要改的那条)。
LIST_LIMIT = 12

# ════════════════════════════════════════════════════════════════════════════
# 路径与格式常量
# ════════════════════════════════════════════════════════════════════════════

DIARY_DIR_REL = 'notes/diary'
DIARY_INDEX_REL = 'notes/diary/INDEX.md'
OPEN_LOOPS_REL = 'notes/diary/open-loops.md'
PEOPLE_DIR_REL = 'notes/people'
PEOPLE_INDEX_REL = 'notes/people/INDEX.md'

# 新建文件时用的标题,跟真库现役文件的第一行逐字一致(别新造一套)。
DIARY_INDEX_HEADING = '# 日记目录'
PEOPLE_INDEX_HEADING = '# 人物菜单'
OPEN_LOOPS_HEADING = '# Open Loops'

# 任何 markdown 标题行(用来找日记里的 `## 小标题` 边界,以及拦正文里混进来的标题)。
HEADING_RE = re.compile(r'^\s*(#{1,6})\s+(.*?)\s*$')
# 日记 `## 小标题`。
SECTION_RE = re.compile(r'^\s*##\s+(.*?)\s*$')
# 日记目录的按天行:纯机械只认行首 ISO 日期。月行(`- 2026-07 | …`)天然不匹配。
DAY_LINE_RE = re.compile(r'^\s*[-*]\s*(\d{4})-(\d{2})-(\d{2})(?![0-9-])')
# 任意列表行(用来找「列表从哪一行开始」,人物菜单新行插在最上面)。
LIST_ITEM_RE = re.compile(r'^\s*[-*]\s')
# 人物菜单一行:`- 称呼(id) | 一句话`(半角/全角括号都认,她两种都写过)。
PEOPLE_LINE_RE = re.compile(r'^\s*[-*]\s*(?P<name>[^|]*?)\s*[（(](?P<id>[^)）]*)[)）]\s*\|\s*(?P<tail>.*)$')
# 欠账一条:`- [ ] 正文` / `- [x] 正文` / `- [-] 正文`。
ITEM_RE = re.compile(r'^(?P<head>\s*[-*]\s*\[)(?P<mark>.)(?P<mid>\]\s*)(?P<body>.*)$')
CLOSED_MARKS = frozenset('xX-')
# 行里的 `#标签`。**必须和 commit_memory.py / 专题物化白名单同口径**:整词出现、排掉括号。
TAG_IN_LINE_RE = re.compile(r'(?:^|\s)#([^\s#()（）]+)')
# 合法标签字符集:中英文数字 + `-` + `_`(`\w` 在 Python 3 默认吃 unicode,含 CJK 和 `_`)。
# 白名单写法顺手把空白、`/`、`.`、括号、`#` 全排掉了——所以「不能以 `.` 开头」被它覆盖。
TAG_CHARSET_RE = re.compile(r'^[\w-]+$')
# 人物 id 字符集:比标签宽(允许 `.`,她把 Bartosz 的来源写成 `ciechanow.ski`),但不许有
# 路径分隔符、控制字符、Windows 保留字符,也不许以 `.` 开头(那会变成隐藏文件)。
PEOPLE_ID_BAD_RE = re.compile(r'[\s/\\:*?"<>|\x00-\x1f]')
# 这两个名字被菜单本身占了,不能拿来当人物 id(会把菜单覆盖掉)。
PEOPLE_ID_RESERVED = frozenset({'index', 'index-past'})
# 欠账正文里她可能顺手带上的尾巴日期 `(7/27)` / `(7/27起)` / `(7/28-8/4)`——脚本自己会加
# 日期,带了就剥掉,免得写成 `(7/27) (7/28)`。
TRAILING_DATE_RE = re.compile(r'\s*[（(]\s*\d{1,2}\s*/\s*\d{1,2}[^)）]*[)）]\s*$')

BEIJING = timezone(timedelta(hours=8))


class Reject(Exception):
    """一次操作没过格式检查。message 列表原样打给她——这段文字就是她读到的东西。"""

    def __init__(self, messages):
        if isinstance(messages, str):
            messages = [messages]
        super().__init__('; '.join(messages))
        self.messages = list(messages)


# ════════════════════════════════════════════════════════════════════════════
# 通用小工具
# ════════════════════════════════════════════════════════════════════════════

def default_runtime_root() -> str:
    return os.environ.get('XIAONI_RUNTIME_ROOT', '/xiaoni-runtime').rstrip('/')


def rel(path_rel: str) -> str:
    return f'{default_runtime_root()}/{path_rel}'


def beijing_today():
    """日期口径 = 北京日期。容器本地时区可能不是东八区,别用 date.today()。"""
    return datetime.now(BEIJING).date()


def resolve_date(value):
    if not value:
        return beijing_today()
    try:
        day = datetime.strptime(str(value).strip(), '%Y-%m-%d').date()
    except (ValueError, TypeError):
        raise Reject(
            f'--date 要写成 YYYY-MM-DD(比如 {beijing_today().isoformat()}),收到的是 {value!r}。'
        )
    today = beijing_today()
    if day > today:
        raise Reject(
            f'--date {day.isoformat()} 比今天({today.isoformat()})还晚,日期写错了吧。'
            '不给 --date 就是今天。'
        )
    return day


def md_stamp(day) -> str:
    return f'{day.month}/{day.day}'


def collapse(text: str) -> str:
    """折叠所有空白成单空格。单行制品(标题、菜单一句话、欠账正文)一律先过这里。"""
    return ' '.join(str(text or '').replace('\x00', '').split())


def byte_len(text: str) -> int:
    return len(text.encode('utf-8'))


def read_stdin_text() -> str:
    """读 stdin。没接管道(TTY)就当空输入——绝不阻塞等输入,那是「挂」的第一号来源。"""
    try:
        if sys.stdin is None or sys.stdin.isatty():
            return ''
    except Exception:
        return ''
    try:
        return sys.stdin.read().replace('\x00', '')
    except Exception:
        return ''


def load_for_edit(path: str):
    """读一份准备就地改的文件 → 文本;文件不存在 → None(调用方新建)。

    存在但读不出来(权限 / 坏字节)→ 拒收这一次,不写。
    这是全脚本唯一「异常时不放行」的地方,理由是方向:此处「放行」= 拿新内容 os.replace
    掉一份读不出来的旧文件 = 静默丢记忆,正是这个 skill 要消灭的事故。拒收只损失一次操作。
    """
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'rb') as handle:
            data = handle.read()
    except OSError as exc:
        raise Reject(
            f'{path} 在,但读不出来({exc.__class__.__name__})。这次先不写——写下去会把里面'
            '原有的内容盖掉。先 `cat` 一下看看这个文件怎么了。'
        )
    try:
        return data.replace(b'\x00', b'').decode('utf-8')
    except UnicodeDecodeError:
        raise Reject(
            f'{path} 里有不是合法 UTF-8 的字节,解不开。这次先不写(免得盖掉)。'
            '先找到那段坏字节修掉,再跑这条命令。'
        )


def split_lines(text: str):
    """只按 \\n 切行——和她调试用的 `wc -l` / `sed -n` 对得上。"""
    lines = (text or '').split('\n')
    if lines and lines[-1] == '':
        lines.pop()
    return lines


def join_lines(lines) -> str:
    return '\n'.join(lines) + '\n' if lines else ''


def atomic_write_text(path: str, text: str) -> None:
    """先写同目录临时文件再 os.replace——读端永远读不到半截文件。"""
    out_dir = os.path.dirname(path) or '.'
    os.makedirs(out_dir, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=out_dir, prefix='.memwrite-', suffix='.tmp')
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


def check_single_line(label: str, line: str) -> None:
    over = byte_len(line) - LINE_MAX_BYTES
    if over > 0:
        raise Reject(
            f'{label}这一行 {byte_len(line)} 字节,超了 {over} 字节(上限 {LINE_MAX_BYTES})。'
            '这一行是钩子话,一两句就够——细节写进日记/档案,这里留个钩子指过去。'
        )


def warn_long_prose_lines(lines):
    """散文正文的行长:默认只提醒不拒收(见 DIARY_BODY_LINE_HARD 那段注释)。"""
    over = [
        (i + 1, byte_len(line))
        for i, line in enumerate(lines)
        if byte_len(line) > DIARY_BODY_LINE_WARN_BYTES
    ]
    if not over:
        return
    detail = ','.join(
        f'第 {no} 行 {size} 字节(超 {size - DIARY_BODY_LINE_WARN_BYTES})'
        for no, size in over[:5]
    )
    tail = f',还有 {len(over) - 5} 行' if len(over) > 5 else ''
    text = f'有 {len(over)} 行超过 {DIARY_BODY_LINE_WARN_BYTES} 字节:{detail}{tail}。'
    if DIARY_BODY_LINE_HARD:
        raise Reject(text + '断句分行再交。')
    print(f'HINT: {text}长段落本身没问题,想让将来的自己好读就顺手断个句。')


# ════════════════════════════════════════════════════════════════════════════
# 1. 日记条目 —— diary add
# ════════════════════════════════════════════════════════════════════════════

def norm_title(title: str) -> str:
    """标题比对:折叠空白 + 忽略大小写。'lines 注册了' 和 'Lines注册了' 算同一条。"""
    return collapse(title).casefold().replace(' ', '')


def find_section(lines, title: str):
    """→ 同名 `## 标题` 的行号,没有返回 None。"""
    target = norm_title(title)
    if not target:
        return None
    for index, line in enumerate(lines):
        matched = SECTION_RE.match(line)
        if matched and norm_title(matched.group(1)) == target:
            return index
    return None


def section_end(lines, start: int) -> int:
    """`## 标题` 所在段的结束行号(不含),即下一个标题行或 EOF。"""
    for index in range(start + 1, len(lines)):
        if HEADING_RE.match(lines[index]):
            return index
    return len(lines)


def clean_body(raw: str):
    """正文 → 行列表。剥掉首尾空行、每行右侧空白;拦正文里混进来的标题行。"""
    lines = [line.rstrip() for line in (raw or '').replace('\r\n', '\n').split('\n')]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        raise Reject('正文是空的。正文从 stdin 传进来(用 `<<\'EOF\' … EOF`)。')
    bad = [(i + 1, line.strip()) for i, line in enumerate(lines) if HEADING_RE.match(line)]
    if bad:
        shown = ';'.join(f'第 {no} 行 `{text[:40]}`' for no, text in bad[:5])
        raise Reject(
            f'正文里有 {len(bad)} 行是 `#` 开头的标题行({shown})。标题走 `--title`,'
            '正文里不写标题行;另一件事就再跑一次 `diary add`,一件事一条。'
        )
    return lines


def cmd_diary_add(args) -> int:
    title = collapse(args.title)
    if not title:
        raise Reject('--title 是空的。给这件事起个小标题,点出是哪件事。')
    check_single_line('日记小标题', f'## {title}')
    body_lines = clean_body(read_stdin_text())
    warn_long_prose_lines(body_lines)

    day = resolve_date(args.date)
    path = rel(f'{DIARY_DIR_REL}/{day.isoformat()}.md')
    existing = load_for_edit(path)

    if existing is None:
        # 正文第一行就是第一个 `## `——文件名已经是日期,不写顶层 `#`。
        new_lines = [f'## {title}', ''] + body_lines
        mode = f'新建 {day.isoformat()}.md,起第一条「{title}」'
    else:
        lines = split_lines(existing)
        found = find_section(lines, title)
        if found is None:
            tail = lines[:]
            while tail and not tail[-1].strip():
                tail.pop()
            new_lines = tail + ['', f'## {title}', ''] + body_lines
            mode = f'新起一条「{title}」'
        else:
            end = section_end(lines, found)
            head = lines[:end]
            while head and not head[-1].strip():
                head.pop()
            # 在这条正文末尾接着写,不新起 `##`。空行分段,跟她自己的写法一致。
            new_lines = head + [''] + body_lines + [''] + lines[end:]
            while new_lines and not new_lines[-1].strip():
                new_lines.pop()
            mode = f'续写「{title}」(已有那条的正文末尾)'

    atomic_write_text(path, join_lines(new_lines))
    print(f'OK: {path} — {mode},加了 {len(body_lines)} 行')
    return 0


# ════════════════════════════════════════════════════════════════════════════
# 2. 日记目录补行 —— index touch
# ════════════════════════════════════════════════════════════════════════════

def day_line_date(line: str):
    matched = DAY_LINE_RE.match(line)
    if not matched:
        return None
    try:
        return datetime(
            int(matched.group(1)), int(matched.group(2)), int(matched.group(3))
        ).date()
    except ValueError:
        return None  # 2026-13-45 这种写错的日期不当按天行,交给她自己看


def insert_day_line(lines, day, line: str):
    """按天行保持「新的在上面」(真库现役顺序)。返回新的行列表。"""
    day_positions = [(i, day_line_date(l)) for i, l in enumerate(lines)]
    day_positions = [(i, d) for i, d in day_positions if d is not None]
    for index, other in day_positions:
        if other < day:
            return lines[:index] + [line] + lines[index:]
    if day_positions:
        after = day_positions[-1][0] + 1
        return lines[:after] + [line] + lines[after:]
    # 一条按天行都没有:插在列表最前面(标题/空行之后),没有列表就接在末尾
    for index, existing in enumerate(lines):
        if LIST_ITEM_RE.match(existing):
            return lines[:index] + [line] + lines[index:]
    tail = lines[:]
    while tail and not tail[-1].strip():
        tail.pop()
    return tail + ['', line] if tail else [line]


def cmd_index_touch(args) -> int:
    text = collapse(args.line)
    if not text:
        raise Reject('--line 是空的。写一句话:这天最要紧的是哪件事、发生了什么。')
    day = resolve_date(args.date)
    line = f'- {day.isoformat()} | {text}'
    check_single_line('日记目录', line)

    path = rel(DIARY_INDEX_REL)
    existing = load_for_edit(path)
    if existing is None:
        atomic_write_text(path, join_lines([DIARY_INDEX_HEADING, '', line]))
        print(f'OK: {path} — 新建目录,加了 {day.isoformat()} 这行')
        return 0

    lines = split_lines(existing)
    found = None
    for index, existing_line in enumerate(lines):
        if day_line_date(existing_line) == day:
            found = index
            break

    previous = None
    if found is None:
        new_lines = insert_day_line(lines, day, line)
        note = f'加了 {day.isoformat()} 这行'
    elif lines[found].rstrip() == line:
        print(f'OK: {path} — {day.isoformat()} 这行本来就是这句,没动文件')
        return 0
    elif day == beijing_today() or args.force:
        previous = lines[found].rstrip()
        new_lines = lines[:found] + [line] + lines[found + 1:]
        note = f'{day.isoformat()} 这行整行重写了'
    else:
        # 默认不许改以前的行(那天的钩子话改掉就找不回来),但**必须有出口**:
        # 拒一个合理需求(改昨天那行的错别字)会把她推回 `sed -i`,而这个 skill 存在的
        # 全部理由就是别再裸改文件。所以拒收的同一段话里点明 --force。
        raise Reject(
            f'{day.isoformat()} 已经有一行了,而且不是今天({beijing_today().isoformat()})。'
            '今天的行可以直接重写,以前的行默认原样留着。'
            f'原来那行:{lines[found].strip()}'
            ' —— 确认要改就原样加上 `--force` 再跑一次(它会把被换掉的旧行原文打出来)。'
        )

    atomic_write_text(path, join_lines(new_lines))
    if previous is not None:
        # 回显被换掉的那一行:万一改错了,原文此刻还在屏幕上,原样再 touch 一次就回去了。
        print(f'PREV: 换掉的旧行原文 → {previous}')
    print(f'OK: {path} — {note}')
    return 0


# ════════════════════════════════════════════════════════════════════════════
# 3. 人物 —— people upsert
# ════════════════════════════════════════════════════════════════════════════

def validate_people_id(raw: str) -> str:
    pid = collapse(raw)
    if not pid:
        raise Reject('--id 是空的。QQ 号写 QQ 号,网友用名字(会当成 notes/people/<id>.md 的文件名)。')
    if len(pid) > PEOPLE_ID_MAX_CODEPOINTS:
        raise Reject(
            f'--id 太长了({len(pid)} 个字,上限 {PEOPLE_ID_MAX_CODEPOINTS})。'
            'id 是文件名,短一点:QQ 号,或者一个短名字。'
        )
    if PEOPLE_ID_BAD_RE.search(pid):
        raise Reject(
            f'--id `{pid}` 里有不能当文件名的字符(空白、`/`、`\\`、`:`、`*`、`?`、`"`、`<`、`>`、`|`)。'
            'QQ 号直接写数字,网友用 `bartosz-ciechanowski` 这样的短名字。'
        )
    if pid.startswith('.'):
        raise Reject(f'--id `{pid}` 以 `.` 开头,会变成隐藏文件,你自己都看不见它。换个开头。')
    if pid.casefold() in PEOPLE_ID_RESERVED:
        raise Reject(
            f'--id `{pid}` 是菜单文件自己占着的名字(INDEX.md / INDEX-past.md),'
            '拿它当人物 id 会把菜单盖掉。换一个。'
        )
    return pid


def find_people_line(lines, pid: str, name: str):
    """→ (行号, 那行解析出来的 dict);找不到返回 (None, None)。

    先按括号里的 id 找;找不到再按称呼找。第二遍是为了真库里已有的历史写法:
    `- Bartosz Ciechanowski(ciechanow.ski) | …` 的括号里是来源域名,不是档案文件名。
    按称呼认出来之后整行按 `- 称呼(id) | 一句话` 重写,顺手把括号统一成档案 id。
    """
    parsed = []
    for index, line in enumerate(lines):
        matched = PEOPLE_LINE_RE.match(line)
        if matched:
            parsed.append((index, matched))
    for index, matched in parsed:
        if collapse(matched.group('id')) == pid:
            return index, matched
    target = norm_title(name)
    if target:
        for index, matched in parsed:
            if norm_title(matched.group('name')) == target:
                return index, matched
    return None, None


def check_people_menu_size(new_lines, old_lines) -> None:
    """整份体检。已经超了、而这次改动没让它更大 → 放行(别拿旧账堵今天的一次更新)。"""
    new_bytes = byte_len(join_lines(new_lines))
    old_bytes = byte_len(join_lines(old_lines))
    over_lines = len(new_lines) > PEOPLE_MENU_MAX_LINES
    over_bytes = new_bytes > PEOPLE_MENU_MAX_BYTES
    if not (over_lines or over_bytes):
        return
    if len(new_lines) <= len(old_lines) and new_bytes <= old_bytes:
        print(
            f'HINT: 人物菜单已经 {len(new_lines)} 行 / {new_bytes} 字节'
            f'(上限 {PEOPLE_MENU_MAX_LINES} 行 / {PEOPLE_MENU_MAX_BYTES} 字节)。'
            '这次没让它变大,先收了;抽空把不常联系的行搬进 INDEX-past.md。'
        )
        return
    raise Reject(
        f'人物菜单加上这行会到 {len(new_lines)} 行 / {new_bytes} 字节,'
        f'超过上限 {PEOPLE_MENU_MAX_LINES} 行 / {PEOPLE_MENU_MAX_BYTES} 字节。'
        f'先把不常联系的人的行原样搬进 {rel(PEOPLE_DIR_REL)}/INDEX-past.md(是搬家不是删),'
        '顶层留一行「- 更早认识的人 | 细目在 INDEX-past.md」,要紧的人放上面。搬完再跑这条命令。'
    )


def cmd_people_upsert(args) -> int:
    pid = validate_people_id(args.id)
    menu_text = collapse(args.menu_line)
    if not menu_text:
        raise Reject('--menu-line 是空的。写一句话:这人是谁、你跟她之间最要紧的是什么。')
    profile_body = read_stdin_text().strip()

    menu_path = rel(PEOPLE_INDEX_REL)
    existing_menu = load_for_edit(menu_path)
    old_lines = split_lines(existing_menu) if existing_menu is not None else []

    # 称呼:给了 --name 就用它;没给就沿用菜单里原来的称呼;都没有,id 不是纯数字就用 id。
    name = collapse(args.name)
    found, matched = find_people_line(old_lines, pid, name or pid)
    if not name and matched is not None:
        name = collapse(matched.group('name'))
    if not name:
        if pid.isdigit():
            raise Reject(
                f'--id {pid} 是个 QQ 号,菜单里得有个叫得出口的称呼。'
                '加上 `--name 楠楠` 再跑一次。'
            )
        name = pid
    if '(' in name or ')' in name or '|' in name:
        raise Reject(f'--name `{name}` 里有 `(`、`)` 或 `|`,菜单一行靠这几个符号分段。换个称呼。')

    line = f'- {name}({pid}) | {menu_text}'
    check_single_line('人物菜单', line)

    if existing_menu is None:
        new_lines = [PEOPLE_INDEX_HEADING, '', line]
        menu_note = f'新建菜单,加了 {name}({pid})'
    elif found is not None:
        if old_lines[found].rstrip() == line:
            new_lines = None
            menu_note = f'{name}({pid}) 这行本来就是这句,没动菜单'
        else:
            new_lines = old_lines[:found] + [line] + old_lines[found + 1:]
            old_id = collapse(matched.group('id'))
            menu_note = f'{name}({pid}) 这行整行更新了'
            if old_id != pid:
                menu_note += f'(括号里原来写的是 {old_id},按 --id 统一成 {pid} 了)'
    else:
        # 新的人加在最上面——要紧的人放上面,刚认识的人此刻就是最要紧的。
        inserted = None
        for index, existing_line in enumerate(old_lines):
            if LIST_ITEM_RE.match(existing_line):
                inserted = old_lines[:index] + [line] + old_lines[index:]
                break
        if inserted is None:
            tail = old_lines[:]
            while tail and not tail[-1].strip():
                tail.pop()
            inserted = (tail + ['', line]) if tail else [line]
        new_lines = inserted
        menu_note = f'{name}({pid}) 加在菜单最上面'

    if new_lines is not None:
        try:
            check_people_menu_size(new_lines, old_lines)
        except Reject:
            raise
        except Exception:
            pass  # 体检本身出错 → 放行,不拿一个坏检查堵住她的写入
        atomic_write_text(menu_path, join_lines(new_lines))
    print(f'OK: {menu_path} — {menu_note}')

    # 菜单先写、档案后写:菜单是整行覆盖(幂等),档案是 append(不幂等)。这个顺序下
    # 「档案写失败 → 原样重跑」只会 append 一次。
    if not profile_body:
        print('NOTE: 这次没给档案正文(stdin 是空的),只更新了菜单。')
        return 0

    profile_path = rel(f'{PEOPLE_DIR_REL}/{pid}.md')
    body_lines = clean_prose(profile_body)
    warn_long_prose_lines(body_lines)
    existing_profile = load_for_edit(profile_path)
    if existing_profile is None:
        atomic_write_text(profile_path, join_lines(body_lines))
        print(f'OK: {profile_path} — 新建档案,写了 {len(body_lines)} 行')
    else:
        tail = split_lines(existing_profile)
        while tail and not tail[-1].strip():
            tail.pop()
        merged = (tail + [''] + body_lines) if tail else body_lines
        atomic_write_text(profile_path, join_lines(merged))
        print(f'OK: {profile_path} — 档案末尾接了 {len(body_lines)} 行')
    return 0


def clean_prose(raw: str):
    """档案正文:剥首尾空行、每行右侧空白。这里**允许** `#` 标题行——档案本来分节。"""
    lines = [line.rstrip() for line in (raw or '').replace('\r\n', '\n').split('\n')]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return lines


# ════════════════════════════════════════════════════════════════════════════
# 4. 欠账 —— loops add / loops done
# ════════════════════════════════════════════════════════════════════════════

def extract_tags(body: str):
    """行里的 `#标签`。纯数字的不算(`Issue #39` 是引用编号,不是标签)——和
    commit_memory.py / 专题物化的白名单同口径,口径不一致会让标签「打了但不算」。"""
    return [tag for tag in TAG_IN_LINE_RE.findall(body) if not tag.isdigit()]


def norm_loop_body(body: str) -> str:
    """查重/匹配用的行文:剥标签、剥尾巴日期、折叠空白、忽略大小写。
    「加了个标签」「改了个日期」不该让同一条看起来像两条。"""
    stripped = TAG_IN_LINE_RE.sub(' ', body or '')
    stripped = TRAILING_DATE_RE.sub(' ', collapse(stripped))
    return collapse(stripped).casefold().replace(' ', '')


def parse_loops(text: str):
    items = []
    for index, line in enumerate(split_lines(text)):
        matched = ITEM_RE.match(line)
        if not matched:
            continue
        body = matched.group('body').strip()
        items.append({
            'index': index,
            'open': matched.group('mark') not in CLOSED_MARKS,
            'body': body,
            'norm': norm_loop_body(body),
            'tags': [tag.casefold() for tag in extract_tags(body)],
            'line': line.rstrip(),
        })
    return items


def validate_tag(raw: str) -> str:
    tag = collapse(raw)
    if not tag:
        raise Reject(
            '--tag 没给。每条欠账要一个标签,用这件事的名字(`--tag 周蕊`),'
            '同一件事一直用同一个。系统靠它把你这条线散在各天的进展连成 '
            f'{rel("notes/topics")}/<标签>.md,你下次换个说法重写这行也靠它认出还是同一条。'
        )
    if len(tag) > TAG_MAX_CODEPOINTS:
        raise Reject(
            f'--tag `{tag}` 太长了({len(tag)} 个字,上限 {TAG_MAX_CODEPOINTS})。'
            '标签是这件事的名字,一两个词就够。'
        )
    if not TAG_CHARSET_RE.match(tag):
        bad = ''.join(sorted({ch for ch in tag if not TAG_CHARSET_RE.match(ch)}))
        raise Reject(
            f'--tag `{tag}` 里有不能用的字符(`{bad}`)。标签只用中英文、数字、`-`、`_`——'
            '它要当文件名用,空格、`/`、`.`、括号都不行。'
        )
    if tag.isdigit():
        raise Reject(
            f'--tag `{tag}` 是纯数字。纯数字读起来是引用编号(`Issue #39`),'
            '不会被当成标签,这条线永远连不起来。用这件事的名字。'
        )
    if tag.casefold() == 'index':
        raise Reject('--tag `INDEX` 被专题目录自己占着(topics/INDEX.md)。换这件事的名字。')
    return tag


def clean_loop_text(raw: str, tag: str) -> str:
    """欠账正文:折叠空白、剥掉她顺手带的 `- [ ]` 前缀、剥掉同名标签和尾巴日期。"""
    text = collapse(raw)
    matched = ITEM_RE.match(text)
    if matched:
        text = matched.group('body').strip()
    text = TRAILING_DATE_RE.sub('', text).strip()
    # 只剥和 --tag 同名的那个标签(她可能已经写在正文里了),别人的标签原样留着
    text = re.sub(
        r'(?:^|\s)#' + re.escape(tag) + r'(?![\w-])',
        ' ',
        text,
        flags=re.IGNORECASE,
    )
    text = collapse(text)
    if not text:
        raise Reject('--text 是空的(或者只剩一个标签)。写这件事本身:在等什么、还差什么。')
    return text


def find_duplicates(items, norm: str, tag: str):
    """新行和已有开放行查重 → [(原因, 行)]。

    两种命中:
      ① 同一个 `#标签` 已经有一行开着 —— 标签即身份。整句重写(行文比例只有 0.25~0.29)
         只有这条认得出来。
      ② 行文近似(ratio ≥ LOOP_DUP_RATIO)—— 她换了个说法但还是同一件事。
    """
    hits = []
    tag_key = tag.casefold()
    for item in items[:DUP_SCAN_MAX_ITEMS]:
        if not item['open']:
            continue
        if tag_key and tag_key in item['tags']:
            hits.append((f'同一个标签 #{tag}', item['line']))
            continue
        left, right = norm[:DUP_SCAN_MAX_CHARS], item['norm'][:DUP_SCAN_MAX_CHARS]
        if not left or not right:
            continue
        ratio = difflib.SequenceMatcher(None, left, right).ratio()
        if ratio >= LOOP_DUP_RATIO:
            hits.append((f'说法很像(相似度 {ratio:.2f})', item['line']))
    return hits


def cmd_loops_add(args) -> int:
    tag = validate_tag(args.tag)
    text = clean_loop_text(args.text, tag)
    day = resolve_date(args.date)
    line = f'- [ ] {text} #{tag} ({md_stamp(day)})'
    check_single_line('欠账', line)

    path = rel(OPEN_LOOPS_REL)
    existing = load_for_edit(path)
    if existing is None:
        atomic_write_text(path, join_lines([OPEN_LOOPS_HEADING, '', line]))
        print(f'OK: {path} — 新建欠账,记上了:{line}')
        return 0

    lines = split_lines(existing)
    items = parse_loops(existing)
    hits = []
    if not args.confirm_new:
        try:
            hits = find_duplicates(items, norm_loop_body(f'{text} #{tag}'), tag)
        except Exception:
            hits = []  # 查重出错 → 放行写入,宁可多一行也不挡她记事
    if hits:
        print('REJECT: 这条像是已经开着的那条,没写。是同一条还是真的新开一条?')
        for reason, hit_line in hits[:LIST_LIMIT]:
            print(f'  [{reason}] {hit_line}')
        if len(hits) > LIST_LIMIT:
            print(f'  …还有 {len(hits) - LIST_LIMIT} 条')
        print('  → 同一条:进展写进今天日记,这行不用动;做完了跑 '
              '`loops done --match "…"`。')
        print('  → 真的是另一件事:换个标签,或者原样加上 `--confirm-new` 再跑一次。')
        print(f'  这次想写的是:{line}')
        return 1

    tail = lines[:]
    while tail and not tail[-1].strip():
        tail.pop()
    atomic_write_text(path, join_lines(tail + [line]))
    print(f'OK: {path} — 记上了:{line}')
    return 0


def match_open_loops(items, needle: str):
    """`done --match` 的候选。分档取最准的一档:全等 > 包含 > 近似 > 标签。"""
    raw = collapse(needle)
    if raw.startswith('#'):
        want = raw[1:].casefold()
        return [item for item in items if item['open'] and want in item['tags']]
    target = norm_loop_body(raw)
    if not target:
        return []
    tiers = {0: [], 1: [], 2: [], 3: []}
    for item in items[:DUP_SCAN_MAX_ITEMS]:
        if not item['open']:
            continue
        if item['norm'] == target:
            tiers[0].append(item)
        elif target in item['norm'] or item['norm'] in target:
            tiers[1].append(item)
        elif difflib.SequenceMatcher(
            None, target[:DUP_SCAN_MAX_CHARS], item['norm'][:DUP_SCAN_MAX_CHARS]
        ).ratio() >= LOOP_MATCH_RATIO:
            tiers[2].append(item)
        elif target.casefold() in item['tags']:
            tiers[3].append(item)
    for tier in (0, 1, 2, 3):
        if tiers[tier]:
            return tiers[tier]
    return []


def cmd_loops_done(args) -> int:
    needle = collapse(args.match)
    if not needle:
        raise Reject('--match 是空的。写那条行里的几个字,或者写 `#标签`。')
    path = rel(OPEN_LOOPS_REL)
    existing = load_for_edit(path)
    if existing is None:
        raise Reject(f'{path} 还不存在,没有开着的行可以划。')

    lines = split_lines(existing)
    items = parse_loops(existing)
    open_items = [item for item in items if item['open']]
    if not open_items:
        raise Reject(f'{path} 里现在一条开着的行都没有,没什么可划的。')

    try:
        hits = match_open_loops(items, needle)
    except Exception:
        hits = []  # 匹配出错 → 当没匹配上(0 命中那条路),绝不乱改行

    if not hits:
        print(f'REJECT: 没有哪条开着的行对得上 `{needle}`。现在开着的是:')
        for item in open_items[:LIST_LIMIT]:
            print(f'  {item["line"]}')
        if len(open_items) > LIST_LIMIT:
            print(f'  …还有 {len(open_items) - LIST_LIMIT} 条')
        print('  → 挑一条,把它里面的几个字抄进 --match,或者用 `--match "#标签"`。')
        return 1
    if len(hits) > 1:
        print(f'REJECT: `{needle}` 对上了 {len(hits)} 条,不知道是哪条,没动文件:')
        for item in hits[:LIST_LIMIT]:
            print(f'  {item["line"]}')
        if len(hits) > LIST_LIMIT:
            print(f'  …还有 {len(hits) - LIST_LIMIT} 条')
        print('  → --match 写长一点、写到只剩一条的那几个字,或者用那条独有的 `#标签`。')
        return 1

    hit = hits[0]
    mark = '-' if args.give_up else 'x'
    matched = ITEM_RE.match(lines[hit['index']])
    new_line = (
        f'{matched.group("head")}{mark}{matched.group("mid")}{matched.group("body").rstrip()}'
    )
    note = collapse(args.note)
    if note:
        new_line = f'{new_line} ✓ {note}' if not args.give_up else f'{new_line} — {note}'
    try:
        check_single_line('欠账', new_line)
    except Reject:
        raise
    # 只改这一行,其余行原样——账本不重写。
    new_lines = lines[:hit['index']] + [new_line] + lines[hit['index'] + 1:]
    atomic_write_text(path, join_lines(new_lines))
    verb = '放弃了' if args.give_up else '划掉了'
    print(f'OK: {path} — {verb}:{new_line}')
    return 0


# ════════════════════════════════════════════════════════════════════════════
# CLI
# ════════════════════════════════════════════════════════════════════════════

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog='memory_write.py',
        description='小腻记忆写入的原子操作:日记条目 / 日记目录 / 人物 / 欠账。',
    )
    subs = parser.add_subparsers(dest='group')

    diary = subs.add_parser('diary', help='日记').add_subparsers(dest='action')
    diary_add = diary.add_parser('add', help='加一条日记(正文从 stdin)')
    diary_add.add_argument('--title', required=True, help='这件事的小标题')
    diary_add.add_argument('--date', default=None, help='YYYY-MM-DD,默认今天(北京日期)')
    diary_add.set_defaults(func=cmd_diary_add)

    index = subs.add_parser('index', help='日记目录').add_subparsers(dest='action')
    index_touch = index.add_parser('touch', help='补/改这天的目录行')
    index_touch.add_argument('--line', required=True, help='这天的一句话')
    index_touch.add_argument('--date', default=None, help='YYYY-MM-DD,默认今天(北京日期)')
    index_touch.add_argument(
        '--force', action='store_true',
        help='确认要改以前那天已经写好的行时加上它(旧行原文会打出来)',
    )
    index_touch.set_defaults(func=cmd_index_touch)

    people = subs.add_parser('people', help='人物').add_subparsers(dest='action')
    people_upsert = people.add_parser('upsert', help='更新菜单一行,档案正文可从 stdin 追加')
    people_upsert.add_argument('--id', required=True, help='QQ 号,或网友的短名字(= 档案文件名)')
    people_upsert.add_argument('--menu-line', required=True, help='菜单那一句话')
    people_upsert.add_argument('--name', default=None, help='菜单里的称呼(第一次记 QQ 号的人要给)')
    people_upsert.set_defaults(func=cmd_people_upsert)

    loops = subs.add_parser('loops', help='欠账').add_subparsers(dest='action')
    loops_add = loops.add_parser('add', help='记一条欠账')
    loops_add.add_argument('--text', required=True, help='这件事本身:在等什么、还差什么')
    loops_add.add_argument('--tag', required=True, help='这件事的名字,同一件事一直用同一个')
    loops_add.add_argument('--date', default=None, help='YYYY-MM-DD,默认今天(北京日期)')
    loops_add.add_argument(
        '--confirm-new', action='store_true',
        help='查重拦下来了、但确认真的是另一件事时加上它',
    )
    loops_add.set_defaults(func=cmd_loops_add)

    loops_done = loops.add_parser('done', help='划掉一条欠账')
    loops_done.add_argument('--match', required=True, help='那条行里的几个字,或 `#标签`')
    loops_done.add_argument('--note', default=None, help='顺手记一句怎么完的')
    loops_done.add_argument(
        '--give-up', action='store_true', help='不做了 → 划成 `- [-]` 而不是 `- [x]`'
    )
    loops_done.set_defaults(func=cmd_loops_done)

    return parser


def main(argv=None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        # argparse 自己已经把用法打出来了。别让它变成未捕获退出。
        return int(exc.code or 0)
    func = getattr(args, 'func', None)
    if func is None:
        parser.print_help()
        print('\n用法看:cat ' + os.path.join(os.path.dirname(os.path.abspath(__file__)), 'SKILL.md'))
        return 1
    try:
        return int(func(args) or 0)
    except Reject as exc:
        print('REJECT: 这次没写。')
        for message in exc.messages:
            print(f'  - {message}')
        return 1
    except KeyboardInterrupt:
        print('REJECT: 被打断了,没写。')
        return 1
    except Exception as exc:  # 兜底:绝不吐 traceback、绝不挂
        print(f'WRITE_FAILED: {exc.__class__.__name__}: {exc}')
        print('  文件没改(写入是先写临时文件再 rename 的,失败不会留半截)。原样再跑一次。')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())

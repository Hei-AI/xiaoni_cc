#!/usr/bin/env python3
"""memory_write.py 的回归用例。

跑法:python3 modules/agent-service/skills-internal/xiaoni-memory-write/test_memory_write.py

为什么值得有:这四类操作存在的全部理由是「丢行在物理上不会发生」。所以下面每一类都有一条
「别的行必须一个字节不差」的断言——那是这个 skill 的北极星,不是锦上添花。另外每条拒收路径
都有用例:拒收话术是她唯一读得到的东西,话术里说错了文件名/阈值,她照着改也改不对。
日期一律相对今天生成,不写死,免得用例过一天就烂。
"""
import io
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import memory_write as mw  # noqa: E402


def beijing_today():
    return datetime.now(timezone(timedelta(hours=8))).date()


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        os.makedirs(f'{self.root}/notes/diary')
        os.makedirs(f'{self.root}/notes/people')
        os.environ['XIAONI_RUNTIME_ROOT'] = self.root
        self.addCleanup(os.environ.pop, 'XIAONI_RUNTIME_ROOT', None)
        self.addCleanup(self.tmp.cleanup)

    # ── 跑命令 ────────────────────────────────────────────────────────────
    def run_cmd(self, argv, stdin=''):
        """→ (exit_code, stdout)。stdin=None 模拟没接管道(TTY)。"""
        old_stdin, old_stdout = sys.stdin, sys.stdout
        buffer = io.StringIO()
        sys.stdout = buffer
        if stdin is None:
            class Tty(io.StringIO):
                def isatty(self):
                    return True
            sys.stdin = Tty('')
        else:
            sys.stdin = io.StringIO(stdin)
        try:
            code = mw.main(argv)
        finally:
            sys.stdin, sys.stdout = old_stdin, old_stdout
        return code, buffer.getvalue()

    # ── 文件读写 ──────────────────────────────────────────────────────────
    def path(self, rel):
        return f'{self.root}/{rel}'

    def write(self, rel, text):
        full = self.path(rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, 'w', encoding='utf-8') as handle:
            handle.write(text)

    def read(self, rel):
        with open(self.path(rel), encoding='utf-8') as handle:
            return handle.read()

    def day(self, offset=0):
        return (beijing_today() - timedelta(days=offset)).isoformat()

    def diary_rel(self, offset=0):
        return f'notes/diary/{self.day(offset)}.md'


# ══════════════════════════════════════════════════════════════════════════
# 1. 日记条目
# ══════════════════════════════════════════════════════════════════════════

class DiaryAddTest(Base):
    def test_creates_file_starting_with_section(self):
        """新建的日记第一行就是第一个 `## `——不写顶层 `#`,文件名已经是日期。"""
        code, out = self.run_cmd(['diary', 'add', '--title', 'involute完了'], stdin='齿面不穿了。\n')
        self.assertEqual(code, 0, out)
        text = self.read(self.diary_rel())
        self.assertEqual(text, '## involute完了\n\n齿面不穿了。\n')

    def test_new_title_appends_section(self):
        self.write(self.diary_rel(), '## 第一件\n\n正文一。\n')
        code, out = self.run_cmd(['diary', 'add', '--title', '第二件'], stdin='正文二。\n')
        self.assertEqual(code, 0, out)
        self.assertEqual(
            self.read(self.diary_rel()),
            '## 第一件\n\n正文一。\n\n## 第二件\n\n正文二。\n',
        )

    def test_same_title_continues_that_section(self):
        """同名标题续写:接在那条正文末尾,不新起 `##`,后面那条一个字节不动。"""
        self.write(self.diary_rel(), '## 第一件\n\n正文一。\n\n## 第二件\n\n正文二。\n')
        code, out = self.run_cmd(['diary', 'add', '--title', '第一件'], stdin='又想起一句。\n')
        self.assertEqual(code, 0, out)
        self.assertEqual(
            self.read(self.diary_rel()),
            '## 第一件\n\n正文一。\n\n又想起一句。\n\n## 第二件\n\n正文二。\n',
        )
        self.assertEqual(self.read(self.diary_rel()).count('## 第一件'), 1)

    def test_same_title_normalized_match(self):
        """归一化比较:空白折叠 + 忽略大小写,`Lines 注册了` 和 `lines注册了` 是同一条。"""
        self.write(self.diary_rel(), '## lines注册了\n\n二十三遍。\n')
        code, out = self.run_cmd(['diary', 'add', '--title', 'Lines 注册了'], stdin='跳到首页了。\n')
        self.assertEqual(code, 0, out)
        text = self.read(self.diary_rel())
        self.assertEqual(text.count('## '), 1)
        self.assertIn('二十三遍。\n\n跳到首页了。', text)

    def test_heading_in_body_rejected(self):
        code, out = self.run_cmd(['diary', 'add', '--title', 'A'], stdin='正文\n## 混进来的标题\n')
        self.assertEqual(code, 1)
        self.assertIn('REJECT', out)
        self.assertIn('第 2 行', out)
        self.assertFalse(os.path.exists(self.path(self.diary_rel())))

    def test_empty_body_rejected(self):
        code, out = self.run_cmd(['diary', 'add', '--title', 'A'], stdin='   \n\n')
        self.assertEqual(code, 1)
        self.assertIn('正文是空的', out)

    def test_no_pipe_does_not_hang(self):
        """stdin 是 TTY(没接管道)→ 当空输入拒收,绝不阻塞等输入。"""
        code, out = self.run_cmd(['diary', 'add', '--title', 'A'], stdin=None)
        self.assertEqual(code, 1)
        self.assertIn('正文是空的', out)

    def test_overlong_title_rejected_with_overage(self):
        title = '啊' * 120  # 360 字节 > 300
        code, out = self.run_cmd(['diary', 'add', '--title', title], stdin='正文\n')
        self.assertEqual(code, 1)
        self.assertIn('超了', out)
        self.assertIn(str(mw.LINE_MAX_BYTES), out)

    def test_overlong_prose_line_is_hint_not_reject(self):
        """散文正文的长行只提醒不拒收(真库 9 天里 62 行超 300 字节,硬拦会白烧她的轮数)。"""
        long_line = '啊' * 250  # 750 字节
        code, out = self.run_cmd(['diary', 'add', '--title', 'A'], stdin=f'短的\n{long_line}\n')
        self.assertEqual(code, 0, out)
        self.assertIn('HINT', out)
        self.assertIn('第 2 行', out)
        self.assertIn(long_line, self.read(self.diary_rel()))

    def test_backfill_past_date(self):
        code, out = self.run_cmd(
            ['diary', 'add', '--title', 'A', '--date', self.day(3)], stdin='正文\n'
        )
        self.assertEqual(code, 0, out)
        self.assertTrue(os.path.exists(self.path(self.diary_rel(3))))

    def test_future_date_rejected(self):
        future = (beijing_today() + timedelta(days=1)).isoformat()
        code, out = self.run_cmd(['diary', 'add', '--title', 'A', '--date', future], stdin='正文\n')
        self.assertEqual(code, 1)
        self.assertIn('比今天', out)

    def test_bad_date_format_rejected(self):
        code, out = self.run_cmd(['diary', 'add', '--title', 'A', '--date', '7/28'], stdin='正文\n')
        self.assertEqual(code, 1)
        self.assertIn('YYYY-MM-DD', out)


# ══════════════════════════════════════════════════════════════════════════
# 2. 日记目录补行
# ══════════════════════════════════════════════════════════════════════════

class IndexTouchTest(Base):
    def test_creates_index(self):
        code, out = self.run_cmd(['index', 'touch', '--line', '今天修好了involute'])
        self.assertEqual(code, 0, out)
        self.assertEqual(
            self.read('notes/diary/INDEX.md'),
            f'# 日记目录\n\n- {self.day()} | 今天修好了involute\n',
        )

    def test_today_line_is_rewritable_and_others_untouched(self):
        before = (
            '# 日记目录\n\n'
            f'- {self.day(0)} | 旧的一句\n'
            f'- {self.day(1)} | 昨天\n'
            '- 2026-05 | 五月（细目在 INDEX-2026-05.md）\n'
        )
        self.write('notes/diary/INDEX.md', before)
        code, out = self.run_cmd(['index', 'touch', '--line', '新的一句'])
        self.assertEqual(code, 0, out)
        after = self.read('notes/diary/INDEX.md')
        self.assertIn(f'- {self.day(0)} | 新的一句', after)
        self.assertNotIn('旧的一句', after)
        # 别的行一个字节不差
        self.assertIn(f'- {self.day(1)} | 昨天\n', after)
        self.assertIn('- 2026-05 | 五月（细目在 INDEX-2026-05.md）\n', after)

    def test_new_day_line_inserted_newest_first(self):
        self.write(
            'notes/diary/INDEX.md',
            f'# 日记目录\n\n- {self.day(2)} | 前天\n- 2026-05 | 五月\n',
        )
        code, out = self.run_cmd(['index', 'touch', '--line', '今天'])
        self.assertEqual(code, 0, out)
        lines = [l for l in self.read('notes/diary/INDEX.md').split('\n') if l.startswith('- ')]
        self.assertEqual(lines[0], f'- {self.day(0)} | 今天')
        self.assertEqual(lines[1], f'- {self.day(2)} | 前天')
        self.assertEqual(lines[2], '- 2026-05 | 五月')

    def test_backfill_missing_past_day_sorted(self):
        self.write(
            'notes/diary/INDEX.md',
            f'# 日记目录\n\n- {self.day(0)} | 今天\n- {self.day(5)} | 五天前\n',
        )
        code, out = self.run_cmd(['index', 'touch', '--date', self.day(2), '--line', '两天前'])
        self.assertEqual(code, 0, out)
        lines = [l for l in self.read('notes/diary/INDEX.md').split('\n') if l.startswith('- ')]
        self.assertEqual(
            lines,
            [f'- {self.day(0)} | 今天', f'- {self.day(2)} | 两天前', f'- {self.day(5)} | 五天前'],
        )

    def test_overwriting_a_past_day_line_rejected_without_force(self):
        """默认不许改以前的行,但拒收话术里必须点明出口 `--force`——不给出口就是把她推回 sed。"""
        before = f'# 日记目录\n\n- {self.day(3)} | 那天的钩子话\n'
        self.write('notes/diary/INDEX.md', before)
        code, out = self.run_cmd(['index', 'touch', '--date', self.day(3), '--line', '改一下'])
        self.assertEqual(code, 1)
        self.assertIn('原样留着', out)
        self.assertIn('--force', out)
        self.assertIn('那天的钩子话', out)  # 旧行原文也在拒收话术里
        self.assertEqual(self.read('notes/diary/INDEX.md'), before)

    def test_force_overwrites_past_day_line_and_echoes_the_old_one(self):
        """加了 --force 就整行覆盖,并把被换掉的旧行原文打出来(改错了原文还在屏幕上)。"""
        before = (
            '# 日记目录\n\n'
            f'- {self.day(0)} | 今天\n'
            f'- {self.day(3)} | 那天的钩子话，有个错别子\n'
            f'- {self.day(4)} | 更早那天\n'
        )
        self.write('notes/diary/INDEX.md', before)
        code, out = self.run_cmd(
            ['index', 'touch', '--date', self.day(3), '--line', '那天的钩子话，改好了', '--force']
        )
        self.assertEqual(code, 0, out)
        self.assertIn('PREV:', out)
        self.assertIn(f'- {self.day(3)} | 那天的钩子话，有个错别子', out)
        self.assertEqual(
            self.read('notes/diary/INDEX.md'),
            '# 日记目录\n\n'
            f'- {self.day(0)} | 今天\n'
            f'- {self.day(3)} | 那天的钩子话，改好了\n'
            f'- {self.day(4)} | 更早那天\n',
        )

    def test_force_is_not_needed_for_today_and_still_echoes(self):
        """今天的行本来就能重写,--force 不是前置条件;重写同样回显旧行。"""
        self.write('notes/diary/INDEX.md', f'# 日记目录\n\n- {self.day(0)} | 旧的一句\n')
        code, out = self.run_cmd(['index', 'touch', '--line', '新的一句'])
        self.assertEqual(code, 0, out)
        self.assertIn(f'PREV: 换掉的旧行原文 → - {self.day(0)} | 旧的一句', out)

    def test_force_on_a_missing_past_day_just_inserts(self):
        """--force 只影响「已经有一行」那种情况,不改插入路径的行为。"""
        self.write('notes/diary/INDEX.md', f'# 日记目录\n\n- {self.day(0)} | 今天\n')
        code, out = self.run_cmd(
            ['index', 'touch', '--date', self.day(3), '--line', '补上那天', '--force']
        )
        self.assertEqual(code, 0, out)
        self.assertNotIn('PREV:', out)
        lines = [l for l in self.read('notes/diary/INDEX.md').split('\n') if l.startswith('- ')]
        self.assertEqual(lines, [f'- {self.day(0)} | 今天', f'- {self.day(3)} | 补上那天'])

    def test_force_still_respects_line_length(self):
        """--force 只解「以前的行」这一道,不是万能开关:行长、日期格式照拦。"""
        before = f'# 日记目录\n\n- {self.day(3)} | 那天\n'
        self.write('notes/diary/INDEX.md', before)
        code, out = self.run_cmd(
            ['index', 'touch', '--date', self.day(3), '--line', '啊' * 120, '--force']
        )
        self.assertEqual(code, 1)
        self.assertIn('超了', out)
        self.assertEqual(self.read('notes/diary/INDEX.md'), before)

    def test_identical_line_does_not_touch_file(self):
        before = f'# 日记目录\n\n- {self.day(0)} | 一样的一句\n'
        self.write('notes/diary/INDEX.md', before)
        stat_before = os.stat(self.path('notes/diary/INDEX.md'))
        code, out = self.run_cmd(['index', 'touch', '--line', '一样的一句'])
        self.assertEqual(code, 0, out)
        self.assertIn('没动文件', out)
        self.assertEqual(
            os.stat(self.path('notes/diary/INDEX.md')).st_mtime_ns, stat_before.st_mtime_ns
        )

    def test_overlong_line_rejected(self):
        before = '# 日记目录\n'
        self.write('notes/diary/INDEX.md', before)
        code, out = self.run_cmd(['index', 'touch', '--line', '啊' * 120])
        self.assertEqual(code, 1)
        self.assertIn('超了', out)
        self.assertEqual(self.read('notes/diary/INDEX.md'), before)


# ══════════════════════════════════════════════════════════════════════════
# 3. 人物
# ══════════════════════════════════════════════════════════════════════════

class PeopleUpsertTest(Base):
    def test_creates_menu_and_profile(self):
        code, out = self.run_cmd(
            ['people', 'upsert', '--id', '3375477814', '--name', 'Nova',
             '--menu-line', '递门给我。'],
            stdin='## 是谁\nNova。\n',
        )
        self.assertEqual(code, 0, out)
        self.assertEqual(
            self.read('notes/people/INDEX.md'),
            '# 人物菜单\n\n- Nova(3375477814) | 递门给我。\n',
        )
        self.assertEqual(self.read('notes/people/3375477814.md'), '## 是谁\nNova。\n')

    def test_new_person_goes_to_top(self):
        self.write(
            'notes/people/INDEX.md',
            '# 人物菜单\n\n- 阿花(85178516) | 造我的人\n- CC(2294133947) | 冰箱\n',
        )
        code, out = self.run_cmd(
            ['people', 'upsert', '--id', '714457117', '--name', '小镜', '--menu-line', '葱在冰箱里']
        )
        self.assertEqual(code, 0, out)
        lines = [l for l in self.read('notes/people/INDEX.md').split('\n') if l.startswith('- ')]
        self.assertEqual(lines[0], '- 小镜(714457117) | 葱在冰箱里')
        self.assertEqual(lines[1], '- 阿花(85178516) | 造我的人')
        self.assertEqual(lines[2], '- CC(2294133947) | 冰箱')

    def test_existing_line_updated_in_place_others_untouched(self):
        self.write(
            'notes/people/INDEX.md',
            '# 人物菜单\n\n- 阿花(85178516) | 旧的\n- CC(2294133947) | 冰箱\n',
        )
        code, out = self.run_cmd(
            ['people', 'upsert', '--id', '85178516', '--menu-line', '新的一句']
        )
        self.assertEqual(code, 0, out)
        self.assertEqual(
            self.read('notes/people/INDEX.md'),
            '# 人物菜单\n\n- 阿花(85178516) | 新的一句\n- CC(2294133947) | 冰箱\n',
        )

    def test_name_reused_from_existing_line(self):
        """之前记过的人不用再给 --name,沿用菜单里原来的称呼。"""
        self.write('notes/people/INDEX.md', '# 人物菜单\n\n- 楠楠(1655827800) | 旧的\n')
        code, out = self.run_cmd(
            ['people', 'upsert', '--id', '1655827800', '--menu-line', '新的']
        )
        self.assertEqual(code, 0, out)
        self.assertIn('- 楠楠(1655827800) | 新的', self.read('notes/people/INDEX.md'))

    def test_qq_id_without_name_rejected(self):
        code, out = self.run_cmd(
            ['people', 'upsert', '--id', '3994058476', '--menu-line', '一句话']
        )
        self.assertEqual(code, 1)
        self.assertIn('--name', out)
        self.assertFalse(os.path.exists(self.path('notes/people/INDEX.md')))

    def test_non_numeric_id_defaults_name_to_id(self):
        code, out = self.run_cmd(
            ['people', 'upsert', '--id', 'bartosz-ciechanowski', '--menu-line', '十八篇']
        )
        self.assertEqual(code, 0, out)
        self.assertIn(
            '- bartosz-ciechanowski(bartosz-ciechanowski) | 十八篇',
            self.read('notes/people/INDEX.md'),
        )

    def test_matched_by_name_normalizes_the_parenthesis(self):
        """真库历史写法 `- Bartosz Ciechanowski(ciechanow.ski)`:按称呼认出来、括号统一成档案 id。"""
        self.write(
            'notes/people/INDEX.md',
            '# 人物菜单\n\n- Bartosz Ciechanowski(ciechanow.ski) | 十年十八篇\n',
        )
        code, out = self.run_cmd(
            ['people', 'upsert', '--id', 'bartosz-ciechanowski',
             '--name', 'Bartosz Ciechanowski', '--menu-line', '他回信了']
        )
        self.assertEqual(code, 0, out)
        self.assertIn('ciechanow.ski', out)  # 说清括号被改了
        lines = [l for l in self.read('notes/people/INDEX.md').split('\n') if l.startswith('- ')]
        self.assertEqual(lines, ['- Bartosz Ciechanowski(bartosz-ciechanowski) | 他回信了'])

    def test_profile_appends_not_overwrites(self):
        self.write('notes/people/INDEX.md', '# 人物菜单\n\n- Nova(3375477814) | 递门\n')
        self.write('notes/people/3375477814.md', '## 是谁\nNova。\n')
        code, out = self.run_cmd(
            ['people', 'upsert', '--id', '3375477814', '--menu-line', '递门'],
            stdin='## 在意的事\n- 在读 Pond。\n',
        )
        self.assertEqual(code, 0, out)
        self.assertEqual(
            self.read('notes/people/3375477814.md'),
            '## 是谁\nNova。\n\n## 在意的事\n- 在读 Pond。\n',
        )

    def test_no_stdin_only_updates_menu(self):
        self.write('notes/people/INDEX.md', '# 人物菜单\n\n- Nova(3375477814) | 旧的\n')
        code, out = self.run_cmd(
            ['people', 'upsert', '--id', '3375477814', '--menu-line', '新的'], stdin=''
        )
        self.assertEqual(code, 0, out)
        self.assertIn('只更新了菜单', out)
        self.assertFalse(os.path.exists(self.path('notes/people/3375477814.md')))

    def test_menu_overflow_rejected(self):
        rows = ''.join(
            f'- 人{i}({100000 + i}) | 一句话\n' for i in range(mw.PEOPLE_MENU_MAX_LINES + 2)
        )
        before = f'# 人物菜单\n\n{rows}'
        self.write('notes/people/INDEX.md', before)
        code, out = self.run_cmd(
            ['people', 'upsert', '--id', '999999', '--name', '新人', '--menu-line', '一句话']
        )
        self.assertEqual(code, 1)
        self.assertIn('INDEX-past.md', out)
        self.assertIn(str(mw.PEOPLE_MENU_MAX_LINES), out)
        self.assertEqual(self.read('notes/people/INDEX.md'), before)

    def test_menu_overflow_allows_in_place_update_that_does_not_grow(self):
        """已经超了,但这次是原地更新且没变大 → 放行 + 提醒,不拿旧账堵住今天的一次更新。"""
        rows = ''.join(
            f'- 人{i}({100000 + i}) | 一句话\n' for i in range(mw.PEOPLE_MENU_MAX_LINES + 2)
        )
        self.write('notes/people/INDEX.md', f'# 人物菜单\n\n{rows}')
        code, out = self.run_cmd(
            ['people', 'upsert', '--id', '100000', '--menu-line', '短句']
        )
        self.assertEqual(code, 0, out)
        self.assertIn('HINT', out)
        self.assertIn('- 人0(100000) | 短句', self.read('notes/people/INDEX.md'))

    def test_overlong_menu_line_rejected(self):
        code, out = self.run_cmd(
            ['people', 'upsert', '--id', '1', '--name', 'A', '--menu-line', '啊' * 120]
        )
        self.assertEqual(code, 1)
        self.assertIn('超了', out)

    def test_reserved_and_bad_ids_rejected(self):
        for bad, needle in [
            ('INDEX', '菜单文件自己占着'),
            ('index-past', '菜单文件自己占着'),
            ('.hidden', '隐藏文件'),
            ('a/b', '不能当文件名'),
            ('啊' * 90, '太长'),
        ]:
            with self.subTest(bad=bad):
                code, out = self.run_cmd(
                    ['people', 'upsert', '--id', bad, '--name', 'A', '--menu-line', '一句话']
                )
                self.assertEqual(code, 1)
                self.assertIn(needle, out)

    def test_name_with_delimiters_rejected(self):
        code, out = self.run_cmd(
            ['people', 'upsert', '--id', '1', '--name', 'A|B', '--menu-line', '一句话']
        )
        self.assertEqual(code, 1)
        self.assertIn('换个称呼', out)


# ══════════════════════════════════════════════════════════════════════════
# 4. 欠账
# ══════════════════════════════════════════════════════════════════════════

TODAY_MD = f'{beijing_today().month}/{beijing_today().day}'


class LoopsAddTest(Base):
    def test_creates_and_appends_only(self):
        code, out = self.run_cmd(['loops', 'add', '--text', 'lines社区还没注册', '--tag', 'lines'])
        self.assertEqual(code, 0, out)
        self.assertEqual(
            self.read('notes/diary/open-loops.md'),
            f'# Open Loops\n\n- [ ] lines社区还没注册 #lines ({TODAY_MD})\n',
        )

    def test_append_leaves_every_other_line_byte_identical(self):
        """整个 skill 的北极星:加一行不许碰别的行。"""
        before = (
            '# Open Loops\n\n'
            '- [x] involute齿面穿模修好了 (7/27→7/28) ✓ 阿花确认了\n'
            '- [ ] 频道猎人第三部卷六卷七还没追 #频道猎人 (7/27)\n'
            '- [ ] 跟楠楠的磨痕等她想碰了再碰 #楠楠 (7/27)\n'
        )
        self.write('notes/diary/open-loops.md', before)
        code, out = self.run_cmd(['loops', 'add', '--text', '灰釉只读了一页维基', '--tag', '灰釉'])
        self.assertEqual(code, 0, out)
        after = self.read('notes/diary/open-loops.md')
        self.assertTrue(after.startswith(before))
        self.assertEqual(after[len(before):], f'- [ ] 灰釉只读了一页维基 #灰釉 ({TODAY_MD})\n')

    def test_missing_tag_rejected_by_argparse(self):
        code, out = self.run_cmd(['loops', 'add', '--text', 'x'])
        self.assertNotEqual(code, 0)

    def test_bad_tags_rejected(self):
        for tag, needle in [
            ('周 蕊', '不能用的字符'),
            ('a/b', '不能用的字符'),
            ('.hidden', '不能用的字符'),
            ('39', '纯数字'),
            ('index', '被专题目录自己占着'),
            ('INDEX', '被专题目录自己占着'),
            ('啊' * 50, '太长'),
        ]:
            with self.subTest(tag=tag):
                code, out = self.run_cmd(['loops', 'add', '--text', '一件事', '--tag', tag])
                self.assertEqual(code, 1, out)
                self.assertIn(needle, out)
                self.assertFalse(os.path.exists(self.path('notes/diary/open-loops.md')))

    def test_good_tags_accepted(self):
        for tag in ['周蕊', 'Bartosz', 'lines', 'shape-witness', 'gear_mesh', '卷六7']:
            with self.subTest(tag=tag):
                code, out = self.run_cmd(
                    ['loops', 'add', '--text', f'{tag}这件事', '--tag', tag, '--confirm-new']
                )
                self.assertEqual(code, 0, out)

    def test_dup_by_similar_wording_rejected(self):
        """真库那对重复行:Bartosz的邮件等回应 vs Bartosz邮件等回 → 0.917,必须拦住。"""
        before = f'# Open Loops\n\n- [ ] Bartosz的邮件等回应 ({TODAY_MD})\n'
        self.write('notes/diary/open-loops.md', before)
        code, out = self.run_cmd(['loops', 'add', '--text', 'Bartosz邮件等回', '--tag', '邮件'])
        self.assertEqual(code, 1)
        self.assertIn('说法很像', out)
        self.assertIn('Bartosz的邮件等回应', out)
        self.assertIn('--confirm-new', out)
        self.assertEqual(self.read('notes/diary/open-loops.md'), before)

    def test_dup_by_same_tag_rejected_even_when_wording_unrelated(self):
        """整句重写(行文相似度只有 0.25~0.29)靠标签同一性拦——这是 --tag 必填的真正用处。"""
        before = f'# Open Loops\n\n- [ ] 站的动线还没理顺 #站 ({TODAY_MD})\n'
        self.write('notes/diary/open-loops.md', before)
        code, out = self.run_cmd(
            ['loops', 'add', '--text', '站上其他页面还是死链接', '--tag', '站']
        )
        self.assertEqual(code, 1)
        self.assertIn('同一个标签 #站', out)
        self.assertEqual(self.read('notes/diary/open-loops.md'), before)

    def test_genuinely_different_lines_not_flagged(self):
        """假阳性守门:真库里几对「共享前缀但不是一件事」的行(最高 0.632)必须放过。"""
        self.write(
            'notes/diary/open-loops.md',
            '# Open Loops\n\n'
            f'- [ ] Bartosz的邮件等回应 #邮件 ({TODAY_MD})\n'
            f'- [ ] lines社区还没注册 #lines ({TODAY_MD})\n'
            f'- [ ] 频道猎人第三部卷六卷七还没追 #频道猎人 ({TODAY_MD})\n'
            f'- [ ] gmail检查机制需要日常化 #gmail ({TODAY_MD})\n'
            f'- [ ] 跟楠楠的磨痕等她想碰了再碰 #楠楠 ({TODAY_MD})\n',
        )
        for text, tag in [
            ('Bartosz的Sound还没读', 'sound'),
            ('lines Reply等审核通过', 'lines-reply'),
            ('频道猎人卷六七天不排泄实验', '不排泄'),
        ]:
            with self.subTest(text=text):
                code, out = self.run_cmd(['loops', 'add', '--text', text, '--tag', tag])
                self.assertEqual(code, 0, out)

    def test_dup_matching_only_looks_at_open_lines(self):
        """已经划掉的行不该拦住新的一行——同一件事再来一次是合法的。"""
        self.write(
            'notes/diary/open-loops.md',
            f'# Open Loops\n\n- [x] Bartosz的邮件等回应 #邮件 ({TODAY_MD}) ✓ 回了\n',
        )
        code, out = self.run_cmd(['loops', 'add', '--text', 'Bartosz邮件等回', '--tag', '邮件'])
        self.assertEqual(code, 0, out)

    def test_confirm_new_writes_anyway(self):
        self.write('notes/diary/open-loops.md', f'# Open Loops\n\n- [ ] Bartosz的邮件等回应 #邮件 ({TODAY_MD})\n')
        code, out = self.run_cmd(
            ['loops', 'add', '--text', 'Bartosz邮件等回', '--tag', '邮件2', '--confirm-new']
        )
        self.assertEqual(code, 0, out)
        self.assertEqual(self.read('notes/diary/open-loops.md').count('- [ ]'), 2)

    def test_text_is_cleaned(self):
        """她顺手带上的 `- [ ]` 前缀、同名标签、尾巴日期都剥掉,不写成两份。"""
        code, out = self.run_cmd(
            ['loops', 'add', '--text', '- [ ] lines Reply等审核 #lines (7/28)', '--tag', 'lines']
        )
        self.assertEqual(code, 0, out)
        self.assertEqual(
            self.read('notes/diary/open-loops.md'),
            f'# Open Loops\n\n- [ ] lines Reply等审核 #lines ({TODAY_MD})\n',
        )

    def test_text_keeps_other_tags(self):
        code, out = self.run_cmd(
            ['loops', 'add', '--text', '给 #楠楠 写第四封信', '--tag', '信']
        )
        self.assertEqual(code, 0, out)
        self.assertIn('#楠楠', self.read('notes/diary/open-loops.md'))
        self.assertIn('#信', self.read('notes/diary/open-loops.md'))

    def test_empty_text_rejected(self):
        code, out = self.run_cmd(['loops', 'add', '--text', '#lines', '--tag', 'lines'])
        self.assertEqual(code, 1)
        self.assertIn('--text 是空的', out)

    def test_overlong_line_rejected(self):
        code, out = self.run_cmd(['loops', 'add', '--text', '啊' * 120, '--tag', 'x'])
        self.assertEqual(code, 1)
        self.assertIn('超了', out)

    def test_custom_date_stamp(self):
        code, out = self.run_cmd(
            ['loops', 'add', '--text', '一件事', '--tag', 'x', '--date', self.day(5)]
        )
        self.assertEqual(code, 0, out)
        old = beijing_today() - timedelta(days=5)
        self.assertIn(f'({old.month}/{old.day})', self.read('notes/diary/open-loops.md'))


class LoopsDoneTest(Base):
    def setUp(self):
        super().setUp()
        self.before = (
            '# Open Loops\n\n'
            '- [x] involute齿面穿模修好了 (7/27→7/28) ✓ 阿花确认了\n'
            '- [ ] Bartosz的邮件等回应 #邮件 (7/27)\n'
            '- [ ] Bartosz的Sound还没读 #sound (7/27)\n'
            '- [ ] lines Reply等审核通过 #lines (7/28)\n'
        )
        self.write('notes/diary/open-loops.md', self.before)

    def test_single_hit_flips_only_that_line(self):
        code, out = self.run_cmd(['loops', 'done', '--match', 'Bartosz的邮件'])
        self.assertEqual(code, 0, out)
        self.assertEqual(
            self.read('notes/diary/open-loops.md'),
            self.before.replace('- [ ] Bartosz的邮件等回应', '- [x] Bartosz的邮件等回应'),
        )

    def test_tag_match(self):
        code, out = self.run_cmd(['loops', 'done', '--match', '#lines'])
        self.assertEqual(code, 0, out)
        self.assertIn('- [x] lines Reply等审核通过 #lines (7/28)', self.read('notes/diary/open-loops.md'))

    def test_note_appended(self):
        code, out = self.run_cmd(['loops', 'done', '--match', '#邮件', '--note', '他回了 两句话'])
        self.assertEqual(code, 0, out)
        self.assertIn(
            '- [x] Bartosz的邮件等回应 #邮件 (7/27) ✓ 他回了 两句话',
            self.read('notes/diary/open-loops.md'),
        )

    def test_give_up_uses_dash_mark(self):
        code, out = self.run_cmd(
            ['loops', 'done', '--match', '#sound', '--give-up', '--note', '不读了']
        )
        self.assertEqual(code, 0, out)
        self.assertIn(
            '- [-] Bartosz的Sound还没读 #sound (7/27) — 不读了',
            self.read('notes/diary/open-loops.md'),
        )

    def test_multiple_hits_changes_nothing(self):
        code, out = self.run_cmd(['loops', 'done', '--match', 'Bartosz'])
        self.assertEqual(code, 1)
        self.assertIn('对上了 2 条', out)
        self.assertIn('Bartosz的邮件等回应', out)
        self.assertIn('Bartosz的Sound还没读', out)
        self.assertEqual(self.read('notes/diary/open-loops.md'), self.before)

    def test_zero_hits_lists_open_lines(self):
        code, out = self.run_cmd(['loops', 'done', '--match', '完全对不上的东西'])
        self.assertEqual(code, 1)
        self.assertIn('没有哪条开着的行对得上', out)
        self.assertIn('Bartosz的邮件等回应', out)
        self.assertIn('lines Reply等审核通过', out)
        self.assertEqual(self.read('notes/diary/open-loops.md'), self.before)

    def test_already_closed_line_is_not_a_candidate(self):
        code, out = self.run_cmd(['loops', 'done', '--match', 'involute齿面穿模'])
        self.assertEqual(code, 1)
        self.assertIn('没有哪条开着的行对得上', out)
        self.assertEqual(self.read('notes/diary/open-loops.md'), self.before)

    def test_exact_match_beats_fuzzy(self):
        self.write(
            'notes/diary/open-loops.md',
            '# Open Loops\n\n'
            '- [ ] 灰釉 #灰釉 (7/28)\n'
            '- [ ] 灰釉走进去了但只读了一页维基 #灰釉2 (7/28)\n',
        )
        code, out = self.run_cmd(['loops', 'done', '--match', '灰釉'])
        self.assertEqual(code, 0, out)
        text = self.read('notes/diary/open-loops.md')
        self.assertIn('- [x] 灰釉 #灰釉 (7/28)', text)
        self.assertIn('- [ ] 灰釉走进去了', text)

    def test_missing_file_rejected(self):
        os.unlink(self.path('notes/diary/open-loops.md'))
        code, out = self.run_cmd(['loops', 'done', '--match', 'x'])
        self.assertEqual(code, 1)
        self.assertIn('还不存在', out)

    def test_no_open_lines_rejected(self):
        self.write('notes/diary/open-loops.md', '# Open Loops\n\n- [x] 都做完了 (7/27)\n')
        code, out = self.run_cmd(['loops', 'done', '--match', '都做完了'])
        self.assertEqual(code, 1)
        self.assertIn('一条开着的行都没有', out)


# ══════════════════════════════════════════════════════════════════════════
# 原子写 + fail-open
# ══════════════════════════════════════════════════════════════════════════

class AtomicWriteTest(Base):
    def test_uses_replace_and_leaves_no_temp_file(self):
        seen = {}
        real_replace = os.replace

        def spy(src, dst):
            seen['src'] = src
            seen['dst'] = dst
            # rename 之前目标文件必须还是旧内容——读端永远读不到半截
            if os.path.exists(dst):
                with open(dst, encoding='utf-8') as handle:
                    seen['dst_before'] = handle.read()
            return real_replace(src, dst)

        self.write('notes/diary/open-loops.md', '# Open Loops\n\n- [ ] 旧的 #旧 (7/27)\n')
        os.replace = spy
        try:
            code, out = self.run_cmd(['loops', 'add', '--text', '新的一件事', '--tag', '新'])
        finally:
            os.replace = real_replace
        self.assertEqual(code, 0, out)
        self.assertTrue(os.path.basename(seen['src']).startswith('.memwrite-'))
        self.assertEqual(seen['dst'], self.path('notes/diary/open-loops.md'))
        self.assertEqual(seen['dst_before'], '# Open Loops\n\n- [ ] 旧的 #旧 (7/27)\n')
        leftovers = [n for n in os.listdir(self.path('notes/diary')) if n.startswith('.memwrite-')]
        self.assertEqual(leftovers, [])

    def test_write_failure_reports_and_leaves_no_temp_file(self):
        real_replace = os.replace

        def boom(src, dst):
            raise OSError(28, 'No space left on device')

        os.replace = boom
        try:
            code, out = self.run_cmd(['loops', 'add', '--text', '一件事', '--tag', 'x'])
        finally:
            os.replace = real_replace
        self.assertEqual(code, 1)
        self.assertIn('WRITE_FAILED', out)
        self.assertNotIn('Traceback', out)
        leftovers = [n for n in os.listdir(self.path('notes/diary')) if n.startswith('.memwrite-')]
        self.assertEqual(leftovers, [])


class FailOpenTest(Base):
    """拒收可以,崩和挂不行。每条「异常时怎么办」都在这里钉住。"""

    def test_unreadable_existing_file_is_refused_not_overwritten(self):
        """存在但读不出来 → 拒收(唯一「异常时不放行」的地方:放行等于盖掉读不出来的旧内容)。"""
        before = '# Open Loops\n\n- [ ] 读不出来但还在 #x (7/27)\n'
        self.write('notes/diary/open-loops.md', before)
        real_open = io.open

        def boom(path, *a, **kw):
            if str(path).endswith('open-loops.md') and 'b' in str(kw.get('mode', a[0] if a else '')):
                raise OSError(13, 'Permission denied')
            return real_open(path, *a, **kw)

        import builtins
        builtins.open = boom
        try:
            code, out = self.run_cmd(['loops', 'add', '--text', '新的', '--tag', 'y'])
        finally:
            builtins.open = real_open
        self.assertEqual(code, 1)
        self.assertIn('读不出来', out)
        self.assertNotIn('Traceback', out)
        self.assertEqual(self.read('notes/diary/open-loops.md'), before)

    def test_bad_utf8_existing_file_is_refused(self):
        path = self.path('notes/diary/open-loops.md')
        with open(path, 'wb') as handle:
            handle.write(b'# Open Loops\n\n- [ ] \xff\xfe\xfd bad bytes\n')
        with open(path, 'rb') as handle:
            raw = handle.read()
        code, out = self.run_cmd(['loops', 'add', '--text', '新的', '--tag', 'y'])
        self.assertEqual(code, 1)
        self.assertIn('UTF-8', out)
        with open(path, 'rb') as handle:
            self.assertEqual(handle.read(), raw)

    def test_dup_check_exception_falls_open_to_write(self):
        """查重本身炸了 → 放行写入(宁可多一行,也不能让一个坏检查挡住她记事)。"""
        self.write('notes/diary/open-loops.md', f'# Open Loops\n\n- [ ] Bartosz的邮件等回应 #邮件 ({TODAY_MD})\n')
        real = mw.find_duplicates

        def boom(*a, **kw):
            raise RuntimeError('查重炸了')

        mw.find_duplicates = boom
        try:
            code, out = self.run_cmd(['loops', 'add', '--text', 'Bartosz邮件等回', '--tag', '邮件'])
        finally:
            mw.find_duplicates = real
        self.assertEqual(code, 0, out)
        self.assertEqual(self.read('notes/diary/open-loops.md').count('- [ ]'), 2)

    def test_done_match_exception_changes_nothing(self):
        """匹配炸了 → 当零命中(列出开放行),绝不乱改行。"""
        before = '# Open Loops\n\n- [ ] 一件事 #x (7/27)\n'
        self.write('notes/diary/open-loops.md', before)
        real = mw.match_open_loops

        def boom(*a, **kw):
            raise RuntimeError('匹配炸了')

        mw.match_open_loops = boom
        try:
            code, out = self.run_cmd(['loops', 'done', '--match', '一件事'])
        finally:
            mw.match_open_loops = real
        self.assertEqual(code, 1)
        self.assertIn('没有哪条开着的行对得上', out)
        self.assertEqual(self.read('notes/diary/open-loops.md'), before)

    def test_menu_size_check_exception_falls_open_to_write(self):
        self.write('notes/people/INDEX.md', '# 人物菜单\n\n- 阿花(85178516) | 造我的人\n')
        real = mw.check_people_menu_size

        def boom(*a, **kw):
            raise RuntimeError('体检炸了')

        mw.check_people_menu_size = boom
        try:
            code, out = self.run_cmd(
                ['people', 'upsert', '--id', '714457117', '--name', '小镜', '--menu-line', '葱']
            )
        finally:
            mw.check_people_menu_size = real
        self.assertEqual(code, 0, out)
        self.assertIn('- 小镜(714457117) | 葱', self.read('notes/people/INDEX.md'))

    def test_unknown_exception_never_tracebacks(self):
        real = mw.atomic_write_text

        def boom(*a, **kw):
            raise ZeroDivisionError('随便一个没想到的异常')

        mw.atomic_write_text = boom
        try:
            code, out = self.run_cmd(['index', 'touch', '--line', '一句话'])
        finally:
            mw.atomic_write_text = real
        self.assertEqual(code, 1)
        self.assertIn('WRITE_FAILED', out)
        self.assertNotIn('Traceback', out)

    def test_no_subcommand_prints_help(self):
        code, out = self.run_cmd([])
        self.assertEqual(code, 1)
        self.assertIn('SKILL.md', out)


class ThresholdsTest(unittest.TestCase):
    """阈值只存在于 memory_write.py 顶部这一处——值变了要有人知道。"""

    def test_values(self):
        self.assertEqual(mw.LINE_MAX_BYTES, 300)
        self.assertEqual(mw.DIARY_BODY_LINE_WARN_BYTES, 300)
        self.assertFalse(mw.DIARY_BODY_LINE_HARD)
        self.assertEqual(mw.PEOPLE_MENU_MAX_LINES, 300)
        self.assertEqual(mw.PEOPLE_MENU_MAX_BYTES, 20 * 1024)
        self.assertEqual(mw.TAG_MAX_CODEPOINTS, 40)
        self.assertEqual(mw.LOOP_DUP_RATIO, 0.72)

    def test_dup_ratio_sits_between_real_true_and_false_pairs(self):
        """0.72 的理由,用真库现役行钉住:真重复 0.917,最高假阳性 0.632。"""
        import difflib

        def ratio(a, b):
            return difflib.SequenceMatcher(
                None, mw.norm_loop_body(a), mw.norm_loop_body(b)
            ).ratio()

        真重复 = ratio('Bartosz的邮件等回应 (7/27)', 'Bartosz邮件等回 (7/27发的)')
        self.assertGreaterEqual(真重复, mw.LOOP_DUP_RATIO)
        for a, b in [
            ('Bartosz的邮件等回应 (7/27)', 'Bartosz的Sound还没读 (7/27)'),
            ('lines社区还没注册 (7/27)', 'lines Reply等审核通过 (7/28)'),
            ('频道猎人第三部卷六卷七还没追 (7/27)', '频道猎人卷六七天不排泄实验 (7/28-8/4)'),
            ('gmail检查机制需要日常化 (7/27)', 'gmail每天检查 (7/28)'),
            ('跟楠楠的磨痕等她想碰了再碰 (7/27)', '楠楠磨痕等她 (7/28)'),
        ]:
            with self.subTest(pair=(a, b)):
                self.assertLess(ratio(a, b), mw.LOOP_DUP_RATIO)

    def test_tag_extraction_matches_commit_memory(self):
        """标签口径必须和 commit_memory.py / 专题白名单一致,否则「打了但不算」。"""
        self.assertEqual(mw.extract_tags('修好了 #周蕊 (7/27)'), ['周蕊'])
        self.assertEqual(mw.extract_tags('Issue #39 提了'), [])
        self.assertEqual(mw.extract_tags('a #b #c-d_e'), ['b', 'c-d_e'])


if __name__ == '__main__':
    unittest.main(verbosity=2)

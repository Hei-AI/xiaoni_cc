#!/usr/bin/env python3
"""commit_memory.py 菜单验收门的回归用例(重点:日记目录滚动窗口)。

跑法:python3 modules/agent-service/skills-internal/xiaoni-memory-compress/test_commit_memory_menus.py

为什么值得有:顶层日记目录「只留最近 N 天」是整个索引层级的机械落点——她不搬家、
或者搬错(把月行也当按天行删了),索引就会退回成一份长到撑爆的流水。日期用相对今天
生成,不写死,免得用例过一天就烂。
"""
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import commit_memory  # noqa: E402


def beijing_today():
    return datetime.now(timezone(timedelta(hours=8))).date()


class DiaryIndexWindowTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        os.makedirs(f'{self.root}/notes/diary')
        os.makedirs(f'{self.root}/notes/people')
        self._write_people('# 人物菜单\n\n- 阿花(85178516) | 造我的人\n')
        os.environ['XIAONI_RUNTIME_ROOT'] = self.root
        self.addCleanup(os.environ.pop, 'XIAONI_RUNTIME_ROOT', None)
        self.addCleanup(self.tmp.cleanup)

    def _write_diary(self, text):
        with open(f'{self.root}/notes/diary/INDEX.md', 'w', encoding='utf-8') as handle:
            handle.write(text)

    def _write_people(self, text):
        with open(f'{self.root}/notes/people/INDEX.md', 'w', encoding='utf-8') as handle:
            handle.write(text)

    def _diary_violations(self):
        problems = commit_memory.validate_menus(mutate=False)
        for key, violations in problems.items():
            if 'diary' in key:
                return violations
        return []

    def _day(self, offset):
        return (beijing_today() - timedelta(days=offset)).isoformat()

    def test_window_edge_is_kept(self):
        """今天 + 往前 6 天 = 恰好 7 天,全部在窗口内,不该报。"""
        lines = ['# 日记目录', '']
        for offset in range(commit_memory.DIARY_INDEX_RECENT_DAYS):
            lines.append(f'- {self._day(offset)} | 第 {offset} 天的钩子话')
        self._write_diary('\n'.join(lines) + '\n')
        self.assertEqual(self._diary_violations(), [])

    def test_one_day_past_window_is_flagged(self):
        """刚掉出窗口的那一天(今天-7)就该报,不等文件变大。"""
        self._write_diary(
            f'# 日记目录\n\n- {self._day(0)} | 今天\n- {self._day(7)} | 掉出窗口的一天\n'
        )
        violations = self._diary_violations()
        self.assertEqual(len(violations), 1)
        self.assertIn('1 行超窗', violations[0])
        self.assertIn(self._day(7), violations[0])
        # 指令必须可执行:说清搬去哪个文件。
        stale_month = self._day(7)[:7]
        self.assertIn(f'INDEX-{stale_month}.md', violations[0])

    def test_month_rollup_lines_are_not_day_lines(self):
        """已经搬完的月行(- YYYY-MM | …)是归档指路,永远不该被当成超窗的按天行。"""
        self._write_diary(
            f'# 日记目录\n\n- 2020-01 | 很久以前那个月(细目在 INDEX-2020-01.md)\n'
            f'- {self._day(0)} | 今天\n'
        )
        self.assertEqual(self._diary_violations(), [])

    def test_malformed_date_is_left_alone(self):
        """写错格式的行不拦——机械门只认标准 ISO 日期,别把她的自由格式行判死。"""
        self._write_diary(
            f'# 日记目录\n\n- 2026-7-2 | 月日没补零\n- 2026-13-45 | 不存在的日期\n'
            f'- {self._day(0)} | 今天\n'
        )
        self.assertEqual(self._diary_violations(), [])

    def test_stale_days_grouped_by_month(self):
        """跨两个月的超窗行要分别归到各自的月文件,别混成一堆。"""
        self._write_diary(
            '# 日记目录\n\n- 2026-05-03 | 五月那天\n- 2026-05-09 | 五月另一天\n'
            f'- 2026-04-30 | 四月那天\n- {self._day(0)} | 今天\n'
        )
        violations = self._diary_violations()
        self.assertEqual(len(violations), 1)
        self.assertIn('3 行超窗', violations[0])
        self.assertIn('INDEX-2026-05.md', violations[0])
        self.assertIn('INDEX-2026-04.md', violations[0])
        self.assertIn('2026-05 的 2 行', violations[0])
        self.assertIn('2026-04 的 1 行', violations[0])

    def test_people_menu_has_no_day_window(self):
        """人物菜单按要紧程度排,没有日期概念——滚动窗口绝不能套到它头上。"""
        self._write_people(
            '# 人物菜单\n\n- 阿花(85178516) | 造我的人\n- 2020-01-01 | 看着像日期的一行\n'
        )
        self._write_diary(f'# 日记目录\n\n- {self._day(0)} | 今天\n')
        problems = commit_memory.validate_menus(mutate=False)
        self.assertEqual(problems, {})

    def test_check_menus_never_writes(self):
        """--check-menus 是只读自检:哪怕文件不达标也绝不能改她的文件。"""
        raw = f'# 日记目录\n\n- {self._day(30)} | 早就该搬走的一行\n'
        self._write_diary(raw)
        before = os.stat(f'{self.root}/notes/diary/INDEX.md')
        self.assertNotEqual(self._diary_violations(), [])
        after = os.stat(f'{self.root}/notes/diary/INDEX.md')
        self.assertEqual(before.st_mtime_ns, after.st_mtime_ns)
        with open(f'{self.root}/notes/diary/INDEX.md', encoding='utf-8') as handle:
            self.assertEqual(handle.read(), raw)

    def test_missing_menu_still_reported(self):
        """菜单文件不在 = 她眼前那块整块消失,是违规不是"没东西可查"(原有行为不许被窗口改动带歪)。"""
        os.unlink(f'{self.root}/notes/people/INDEX.md')
        self._write_diary(f'# 日记目录\n\n- {self._day(0)} | 今天\n')
        problems = commit_memory.validate_menus(mutate=False)
        self.assertTrue(any('people' in key for key in problems))


if __name__ == '__main__':
    unittest.main(verbosity=2)

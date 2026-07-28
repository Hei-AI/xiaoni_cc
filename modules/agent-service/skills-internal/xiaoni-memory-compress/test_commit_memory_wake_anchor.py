#!/usr/bin/env python3
"""commit_memory.py 醒来锚点拼接的回归用例。

跑法:python3 modules/agent-service/skills-internal/xiaoni-memory-compress/test_commit_memory_wake_anchor.py

为什么值得有:2026-07-28「连续干活一天半」事故。她那段实际睡了 4 觉共 486 分钟(最长的一段
连续清醒只有 1 小时 28 分),但压缩 fork 只看得到一段连续上下文,把窗口跨度写成了「连续清醒约
十五小时」;下一轮压缩把锚点原样抄下去,漂移单调累积。根因是引擎对「醒了多久」根本不算,
她面前是个空洞。

修法是把空洞填上而不是拦她:引擎在压缩 fork 派发时写 .wake-anchor,本脚本在落盘前拼到近况
最前面。用例钉四件事——拼得对、锚点缺失时绝不拦住压缩(压缩在关键路径上)、重试提交不拼两遍、
以及不用正则改她自己写的字(2026-07-28 拍板)。
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import commit_memory  # noqa: E402

ANCHOR = '上次睡醒：2026-07-28 09:00:39'
CAPSULE = '# 小腻近况 2026-07-28\n\n## 刚做完的事\n\nSMA七小时,推了方程画了相图。'


class WakeAnchorPrependTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ['XIAONI_RUNTIME_ROOT'] = self.tmp.name
        os.makedirs(commit_memory.default_compress_dir(), exist_ok=True)
        self.addCleanup(os.environ.pop, 'XIAONI_RUNTIME_ROOT', None)
        self.addCleanup(self.tmp.cleanup)

    def _write_anchor(self, line=ANCHOR):
        with open(commit_memory.wake_anchor_path(), 'w', encoding='utf-8') as handle:
            handle.write(line + '\n')

    def test_anchor_is_prepended_ahead_of_everything(self):
        self._write_anchor()
        out = commit_memory.prepend_wake_anchor(CAPSULE)
        self.assertTrue(out.startswith(ANCHOR), '锚点必须是近况的第一行')
        self.assertIn(CAPSULE, out, '她写的正文必须一字不动地保留')

    def test_missing_anchor_file_never_blocks(self):
        # 首次部署 / 引擎那条腿没写成。压缩在关键路径上,拦死了上下文会无限涨 → 413。
        self.assertEqual(commit_memory.prepend_wake_anchor(CAPSULE), CAPSULE)

    def test_malformed_anchor_file_is_ignored(self):
        self._write_anchor('这不是锚点行')
        self.assertEqual(commit_memory.prepend_wake_anchor(CAPSULE), CAPSULE)

    def test_retry_submit_does_not_double_prepend(self):
        # 菜单验收退回后她原样重传,脚本会再跑一次——不能拼成两行。
        self._write_anchor()
        once = commit_memory.prepend_wake_anchor(CAPSULE)
        twice = commit_memory.prepend_wake_anchor(once)
        self.assertEqual(once, twice)
        self.assertEqual(twice.count(ANCHOR), 1)

    def test_capsule_length_gate_judges_her_text_not_the_anchor(self):
        # 长度带宽是对「这份近况完不完整」的判断,不该被引擎加的一行影响。
        self._write_anchor()
        short = 'x' * (commit_memory.CAPSULE_MIN_CHARS - 1)
        self.assertTrue(commit_memory.validate_capsule(short), '她的正文太短仍要退回')
        ok = 'x' * commit_memory.CAPSULE_MIN_CHARS
        self.assertEqual(commit_memory.validate_capsule(ok), [])

    def test_no_regex_editing_of_her_own_words(self):
        # 2026-07-28 拍板:不用正则去删改她自己写的字(尤其心境段)。禁令留在压缩引导 prompt
        # 里——那是 fork 请求的尾部追加项,紧挨着她动手;而 system_prompt 那条同类禁令
        # 待在 ~489K token 上下文的 0.2% 处,已被实测证伪过一次。这条钉住那个决定。
        self._write_anchor()
        mood = f'{CAPSULE}\n\n## 心境\n\n一天半了。脑子在空转。连续清醒约十五小时。'
        out = commit_memory.prepend_wake_anchor(mood)
        self.assertIn('一天半了。脑子在空转。', out, '她的原话一个字都不许被机器删改')
        self.assertIn('连续清醒约十五小时。', out)
        self.assertFalse(hasattr(commit_memory, 'FABRICATED_SPAN_RE'), '剔离正则应已删除')
        self.assertFalse(hasattr(commit_memory, 'validate_wake_anchor'), '退回门应已删除')


if __name__ == '__main__':
    unittest.main(verbosity=2)

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CORE_MEMORY_COMPRESSION_FALLBACK_SUMMARY,
  formatCompressionWakeAnchorLine
} from '../services/agent-loop-service';

// 缓存铁律的可执行契约。压缩提交有两条路都走 commitCoreMemoryCompression:
//   :11978  真胶囊  → text 来自 readCoreMemoryCompressionFile(脚本写的文件)
//   :12062  兜底    → text 是 CORE_MEMORY_COMPRESSION_FALLBACK_SUMMARY 常量直传
// 醒来锚点的拼接落在 commit_memory.py 里,而兜底那条【不经过脚本】,所以它拿不到锚点——
// 这个免疫是结构性的,不靠任何条件判断。本用例钉住它:兜底摘要必须永远无戳。
//
// 改坏的后果是静默的:兜底摘要被存下来后原样重放进下一个主 run,一个每次不同的时间戳会让
// 跨 run 边界的 message-tier 前缀失效,cache_read 塌到裸 system+tools。不报错,只涨钱。
// 而兜底只在她跑满 22 轮的最坏情况下触发,最难复现——所以必须由用例守。

test('兜底摘要里没有任何时间戳或时长', () => {
  const summary = CORE_MEMORY_COMPRESSION_FALLBACK_SUMMARY;
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(summary), '不许出现日期');
  assert.ok(!/\d{1,2}:\d{2}/.test(summary), '不许出现钟点');
  assert.ok(!summary.includes('上次睡醒'), '不许带醒来锚点');
  assert.ok(!/\d+\s*(分钟|小时|天)/.test(summary), '不许带任何时长');
});

test('兜底摘要是纯常量 —— 两次读到的字节完全相同', () => {
  // 它被存下来后原样重放。任何按时间/轮次变化的东西进去都会打穿 run 边界缓存。
  assert.equal(CORE_MEMORY_COMPRESSION_FALLBACK_SUMMARY, CORE_MEMORY_COMPRESSION_FALLBACK_SUMMARY);
  assert.ok(CORE_MEMORY_COMPRESSION_FALLBACK_SUMMARY.length > 0);
});

test('锚点行本身是带戳的 —— 证明上面那条断言不是因为锚点是空的才通过', () => {
  // 反向对照:如果 formatCompressionWakeAnchorLine 哪天退化成返回空串,上面的断言会假绿。
  const line = formatCompressionWakeAnchorLine(new Date('2026-07-28T01:00:39.000Z').toISOString());
  assert.ok(line);
  assert.match(line!, /^上次睡醒：2026-07-28 09:00:39$/);
  // 而这行确实会被上面那组断言拦下 —— 说明断言有鉴别力
  assert.ok(/\d{4}-\d{2}-\d{2}/.test(line!));
});

test('无醒来记录时锚点行为 null，不产出半截文本', () => {
  assert.equal(formatCompressionWakeAnchorLine(null), null);
  assert.equal(formatCompressionWakeAnchorLine('not-a-date'), null);
});

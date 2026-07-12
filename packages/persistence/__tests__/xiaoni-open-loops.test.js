'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseOpenLoops,
  parseTagDate,
  selectStaleOpenLoops
} = require('../xiaoni-open-loops');

// 固定「现在」= 2026-07-12,避免时钟依赖
const NOW = Date.UTC(2026, 6, 12);
const DAY = 86_400_000;

test('parseOpenLoops: 抽出开/闭条目 + 日期标注,忽略非清单行', () => {
  const md = [
    '# 我的开放承诺',
    '',
    '- [ ] 答应楠楠盯她考研进度 (7/5)',
    '- [x] 修好发图超时 (7/12)',
    '* [ ] 想学做饭 (2026-06-30)',
    '普通一行不是清单',
    '- [ ]    ', // 空文本 → 丢
    '- [ ] 没有日期的一条'
  ].join('\n');
  const loops = parseOpenLoops(md);
  assert.equal(loops.length, 4);
  assert.deepEqual(
    loops.map((l) => [l.done, l.text, l.openedTag]),
    [
      [false, '答应楠楠盯她考研进度', '7/5'],
      [true, '修好发图超时', '7/12'],
      [false, '想学做饭', '2026-06-30'],
      [false, '没有日期的一条', null]
    ]
  );
});

test('parseOpenLoops: 空/非字符串 → []', () => {
  assert.deepEqual(parseOpenLoops(''), []);
  assert.deepEqual(parseOpenLoops('   '), []);
  assert.deepEqual(parseOpenLoops(null), []);
});

test('parseTagDate: M/D 用当前年;算出来在未来则回退去年', () => {
  // 7/5 在 7/12 之前 → 今年
  assert.equal(parseTagDate('7/5', NOW), Date.UTC(2026, 6, 5));
  // 12/25 在 7/12 之后 → 去年
  assert.equal(parseTagDate('12/25', NOW), Date.UTC(2025, 11, 25));
  // 完整 YYYY-MM-DD
  assert.equal(parseTagDate('2026-06-30', NOW), Date.UTC(2026, 5, 30));
  // 垃圾 → null
  assert.equal(parseTagDate('nope', NOW), null);
  assert.equal(parseTagDate(null, NOW), null);
  // 非法月日 → null
  assert.equal(parseTagDate('13/40', NOW), null);
});

test('selectStaleOpenLoops: 只挑开着、搁置≥staleDays、按最久优先', () => {
  const loops = parseOpenLoops([
    '- [ ] 老承诺 (7/1)', // 11 天前
    '- [ ] 新念头 (7/11)', // 1 天前 → 未达阈值
    '- [x] 已完成 (7/1)', // 闭 → 不浮
    '- [ ] 中间那条 (7/6)' // 6 天前
  ].join('\n'));
  const picked = selectStaleOpenLoops(loops, { nowMs: NOW, staleDays: 2, limit: 3 });
  assert.deepEqual(picked.map((p) => p.text), ['老承诺', '中间那条']);
  assert.ok(picked[0].ageDays > picked[1].ageDays); // 最久优先
});

test('selectStaleOpenLoops: recentlySurfaced 去重(和语义腿/自身节奏)', () => {
  const loops = parseOpenLoops('- [ ] 老承诺 (7/1)\n- [ ] 中间那条 (7/6)');
  const picked = selectStaleOpenLoops(loops, {
    nowMs: NOW,
    staleDays: 2,
    recentlySurfaced: ['老承诺']
  });
  assert.deepEqual(picked.map((p) => p.text), ['中间那条']);
});

test('selectStaleOpenLoops: 无日期标注 → 不知搁置多久 → 保守不浮', () => {
  const loops = parseOpenLoops('- [ ] 没有日期的承诺');
  assert.deepEqual(selectStaleOpenLoops(loops, { nowMs: NOW, staleDays: 2 }), []);
});

test('selectStaleOpenLoops: limit 截断', () => {
  const loops = parseOpenLoops('- [ ] a (7/1)\n- [ ] b (7/2)\n- [ ] c (7/3)');
  assert.equal(selectStaleOpenLoops(loops, { nowMs: NOW, staleDays: 2, limit: 2 }).length, 2);
});

test('selectStaleOpenLoops: 缺 nowMs → []', () => {
  const loops = parseOpenLoops('- [ ] a (7/1)');
  assert.deepEqual(selectStaleOpenLoops(loops, {}), []);
});

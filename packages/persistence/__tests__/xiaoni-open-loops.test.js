'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseOpenLoops,
  parseTagDate,
  selectStaleOpenLoops,
  BEIJING_OFFSET_MS
} = require('../xiaoni-open-loops');

// 固定「现在」= 2026-07-12(UTC 零点),避免时钟依赖
const NOW = Date.UTC(2026, 6, 12);

test('parseOpenLoops: 抽出开/做完/放弃 + 日期标注,忽略非清单行', () => {
  const md = [
    '# 我的开放承诺',
    '',
    '- [ ] 答应楠楠盯她考研进度 (7/5)',
    '- [x] 修好发图超时 (7/12)',
    '- [-] 放弃学游泳 (6/1)',
    '* [ ] 想学做饭 (2026-06-30)',
    '普通一行不是清单',
    '- [ ]    ', // 空文本 → 丢
    '- [ ] 没有日期的一条'
  ].join('\n');
  const loops = parseOpenLoops(md);
  assert.equal(loops.length, 5);
  assert.deepEqual(
    loops.map((l) => [l.state, l.done, l.text, l.openedTag]),
    [
      ['open', false, '答应楠楠盯她考研进度', '7/5'],
      ['done', true, '修好发图超时', '7/12'],
      ['dropped', true, '放弃学游泳', '6/1'],
      ['open', false, '想学做饭', '2026-06-30'],
      ['open', false, '没有日期的一条', null]
    ]
  );
});

test('parseOpenLoops: 空/非字符串 → []', () => {
  assert.deepEqual(parseOpenLoops(''), []);
  assert.deepEqual(parseOpenLoops('   '), []);
  assert.deepEqual(parseOpenLoops(null), []);
});

test('parseTagDate: M/D 用北京今年;未来则回退去年;按北京本地零点(− 8h)', () => {
  // 7/5 在 7/12 之前 → 今年;标注日期按北京零点 = UTC 零点 − 8h
  assert.equal(parseTagDate('7/5', NOW), Date.UTC(2026, 6, 5) - BEIJING_OFFSET_MS);
  // 12/25 在 7/12 之后 → 去年
  assert.equal(parseTagDate('12/25', NOW), Date.UTC(2025, 11, 25) - BEIJING_OFFSET_MS);
  // 完整 YYYY-MM-DD 同样按北京零点
  assert.equal(parseTagDate('2026-06-30', NOW), Date.UTC(2026, 5, 30) - BEIJING_OFFSET_MS);
  // 垃圾 → null
  assert.equal(parseTagDate('nope', NOW), null);
  assert.equal(parseTagDate(null, NOW), null);
  // 非法月日 → null
  assert.equal(parseTagDate('13/40', NOW), null);
});

test('selectStaleOpenLoops: 只挑开着、搁置≥staleDays、按最久优先', () => {
  const loops = parseOpenLoops([
    '- [ ] 老承诺 (7/1)', // ~11 天前
    '- [ ] 新念头 (7/11)', // ~1 天前 → 未达阈值
    '- [x] 已完成 (7/1)', // 做完 → 不浮
    '- [-] 已放弃 (7/1)', // 放弃 → 不浮
    '- [ ] 中间那条 (7/6)' // ~6 天前
  ].join('\n'));
  const picked = selectStaleOpenLoops(loops, { nowMs: NOW, staleDays: 2, limit: 3 });
  assert.deepEqual(picked.map((p) => p.text), ['老承诺', '中间那条']);
  assert.ok(picked[0].ageDays > picked[1].ageDays); // 最久优先
  assert.equal(picked[0].tier, 'active');
});

test('selectStaleOpenLoops: 放弃态 [-] 和做完 [x] 一样不浮', () => {
  const loops = parseOpenLoops('- [ ] 开着的 (7/1)\n- [-] 放弃的 (6/1)\n- [x] 做完的 (6/1)');
  const picked = selectStaleOpenLoops(loops, { nowMs: NOW, staleDays: 2, limit: 5 });
  assert.deepEqual(picked.map((p) => p.text), ['开着的']);
});

test('selectStaleOpenLoops: 百天老承诺(overdue)不霸榜,中龄承诺优先', () => {
  const loops = parseOpenLoops([
    '- [ ] 古老承诺 (1/1)', // ~192 天 → overdue,降权
    '- [ ] 中龄承诺 (6/20)', // ~22 天 → active
    '- [ ] 新些的 (7/6)' // ~6 天 → active
  ].join('\n'));
  const picked = selectStaleOpenLoops(loops, { nowMs: NOW, staleDays: 2, maxActiveDays: 30, limit: 2 });
  // limit 2:两条 active(中龄 > 新些)先占满,古老 overdue 挤不进
  assert.deepEqual(picked.map((p) => p.text), ['中龄承诺', '新些的']);
  assert.ok(picked.every((p) => p.tier === 'active'));
});

test('selectStaleOpenLoops: overdue 在有名额时作为填充浮出(排 active 之后)', () => {
  const loops = parseOpenLoops('- [ ] 古老承诺 (1/1)\n- [ ] 中龄承诺 (6/20)');
  const picked = selectStaleOpenLoops(loops, { nowMs: NOW, staleDays: 2, maxActiveDays: 30, limit: 3 });
  assert.deepEqual(picked.map((p) => [p.text, p.tier]), [
    ['中龄承诺', 'active'],
    ['古老承诺', 'overdue']
  ]);
});

test('selectStaleOpenLoops: 无日期项不再永久隐形 —— 作为填充兜底浮一次', () => {
  const loops = parseOpenLoops('- [ ] 有日期 (7/1)\n- [ ] 没写日期的一条');
  const picked = selectStaleOpenLoops(loops, { nowMs: NOW, staleDays: 2, limit: 3 });
  assert.deepEqual(picked.map((p) => p.text), ['有日期', '没写日期的一条']);
  const undated = picked.find((p) => p.text === '没写日期的一条');
  assert.equal(undated.undated, true);
  assert.equal(undated.ageDays, null);
  assert.equal(undated.tier, 'undated');
});

test('selectStaleOpenLoops: 无日期只当填充,名额被有日期的占满就不浮', () => {
  const loops = parseOpenLoops('- [ ] d1 (7/1)\n- [ ] d2 (7/3)\n- [ ] 没日期');
  const picked = selectStaleOpenLoops(loops, { nowMs: NOW, staleDays: 2, limit: 2 });
  assert.deepEqual(picked.map((p) => p.text), ['d1', 'd2']); // 没日期 挤不进
});

test('selectStaleOpenLoops: recentlySurfaced 去重(含无日期项冷却)', () => {
  const loops = parseOpenLoops('- [ ] 老承诺 (7/1)\n- [ ] 中间那条 (7/6)\n- [ ] 没日期');
  const picked = selectStaleOpenLoops(loops, {
    nowMs: NOW,
    staleDays: 2,
    recentlySurfaced: ['老承诺', '没日期']
  });
  assert.deepEqual(picked.map((p) => p.text), ['中间那条']);
});

test('selectStaleOpenLoops: limit 截断', () => {
  const loops = parseOpenLoops('- [ ] a (7/1)\n- [ ] b (7/2)\n- [ ] c (7/3)');
  assert.equal(selectStaleOpenLoops(loops, { nowMs: NOW, staleDays: 2, limit: 2 }).length, 2);
});

test('selectStaleOpenLoops: 缺 nowMs → []', () => {
  const loops = parseOpenLoops('- [ ] a (7/1)');
  assert.deepEqual(selectStaleOpenLoops(loops, {}), []);
});

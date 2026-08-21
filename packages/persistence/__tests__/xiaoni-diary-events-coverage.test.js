'use strict';

// 第三腿(diary_resurface)的排序:覆盖优先。
//
// 这条腿存在的意义是**走一遍她的记忆空间**,让她知道自己做过。原来只按 ageDays 降序
// (「搁最久的先翻」),配上 40 行 ≈ 20 小时的短冷却,结果是永远在最老的那一撮里打转 ——
// 真库实测 2026-08-19:全历史 3350 次浮现只覆盖 90 / 1899 个条目(4.7%),每条重复 37 次。
//
// 所以排序主键换成「翻过几次」,年龄降级成同次数内的次序。

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectResurfacedEvents, DAY_MS } = require('../xiaoni-diary-events');

const NOW = Date.UTC(2026, 7, 19);
const ev = (name, ageDays, index) => ({
  title: name,
  body: `${name} 的正文,写了一段完整的话,不是清单也不是空的。`,
  dateMs: NOW - ageDays * DAY_MS,
  index,
  ref: `/xiaoni-runtime/notes/diary/x.md#${index}`
});

test('没浮过的先翻,哪怕它比浮过的年轻', () => {
  const events = [ev('老而且翻烂了', 60, 1), ev('年轻但没翻过', 10, 2)];
  const picked = selectResurfacedEvents(events, {
    nowMs: NOW,
    limit: 1,
    surfaceCounts: new Map([[events[0].ref, 37]])
  });
  assert.equal(picked[0].title, '年轻但没翻过');
  assert.equal(picked[0].surfacedTimes, 0);
});

test('同样没翻过时,仍然搁最久的先翻(年龄降级成次序,不是被丢掉)', () => {
  const events = [ev('新的', 10, 1), ev('旧的', 60, 2)];
  const picked = selectResurfacedEvents(events, { nowMs: NOW, limit: 2, surfaceCounts: new Map() });
  assert.deepEqual(picked.map((p) => p.title), ['旧的', '新的']);
});

test('翻过次数严格分层:1 次的排在 2 次的前面', () => {
  const events = [ev('翻过两次', 90, 1), ev('翻过一次', 80, 2), ev('翻过三次', 100, 3)];
  const counts = new Map([[events[0].ref, 2], [events[1].ref, 1], [events[2].ref, 3]]);
  const picked = selectResurfacedEvents(events, { nowMs: NOW, limit: 3, surfaceCounts: counts });
  assert.deepEqual(picked.map((p) => p.surfacedTimes), [1, 2, 3]);
});

test('缺 surfaceCounts(老调用方/读失败)→ 退化成改动前的纯年龄降序,不阻断', () => {
  const events = [ev('新的', 10, 1), ev('旧的', 60, 2)];
  const picked = selectResurfacedEvents(events, { nowMs: NOW, limit: 2 });
  assert.deepEqual(picked.map((p) => p.title), ['旧的', '新的']);
});

test('覆盖优先不绕过任何既有过滤:短窗冷却、太近、结构标题照样挡', () => {
  const fresh = ev('太近了', 3, 1);            // < minAgeDays
  const cooled = ev('冷却中', 50, 2);           // 在 recentlySurfaced 里
  const structural = ev('醒来', 50, 3);         // 结构模板标题
  const ok = ev('该翻的', 50, 4);
  const picked = selectResurfacedEvents([fresh, cooled, structural, ok], {
    nowMs: NOW,
    limit: 5,
    recentlySurfaced: [cooled.ref],
    structuralTitles: ['醒来'],
    // 故意给「该翻的」最高次数:冷却/过滤优先级高于覆盖排序,它仍是唯一候选。
    surfaceCounts: new Map([[ok.ref, 99]])
  });
  assert.deepEqual(picked.map((p) => p.title), ['该翻的']);
});

test('全部翻过同样次数时,顺序稳定可预期(不靠随机)', () => {
  const events = [ev('a', 30, 1), ev('b', 50, 2), ev('c', 40, 3)];
  const counts = new Map(events.map((e) => [e.ref, 5]));
  const once = selectResurfacedEvents(events, { nowMs: NOW, limit: 3, surfaceCounts: counts });
  const twice = selectResurfacedEvents(events, { nowMs: NOW, limit: 3, surfaceCounts: counts });
  assert.deepEqual(once.map((p) => p.title), twice.map((p) => p.title));
  assert.deepEqual(once.map((p) => p.title), ['b', 'c', 'a']);
});

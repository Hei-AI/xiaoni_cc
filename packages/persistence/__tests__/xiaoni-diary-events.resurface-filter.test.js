'use strict';

// step-1 substance 过滤器:resurface 腿剔非-episode(空 body / 清单 body / 结构标记),
// 明确无长度阈值(护短而重的真事)。见 Hei-AI/xiaoni_cc#1。

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isEmptyResurfaceBody,
  isChecklistBody,
  selectResurfacedEvents,
  normalizeEventText,
  DAY_MS
} = require('../xiaoni-diary-events');

const NOW = Date.UTC(2026, 6, 22); // 2026-07-22 UTC 零点
const OLD = NOW - 15 * DAY_MS;     // 15 天前,过 minAgeDays(7) 门槛

function ev(title, body, extra = {}) {
  return { title, body, dateMs: OLD, index: 0, ref: `x#${title}`, ...extra };
}

test('isEmptyResurfaceBody: 空/纯空白/非串 → true;有内容 → false', () => {
  assert.equal(isEmptyResurfaceBody(''), true);
  assert.equal(isEmptyResurfaceBody('   \n\t '), true);
  assert.equal(isEmptyResurfaceBody(undefined), true);
  assert.equal(isEmptyResurfaceBody(null), true);
  assert.equal(isEmptyResurfaceBody('周蕊写了一个字：雨'), false);
});

test('isChecklistBody: 严格多数(>50%)清单行才 true;混合态 [x]/[ ]/[-] 计入', () => {
  assert.equal(isChecklistBody('- [ ] 盯楠楠考研\n- [x] 修发图\n- [-] 放弃做饭'), true); // 3/3
  assert.equal(isChecklistBody('- [ ] x'), true);                       // 1/1 纯 todo
  assert.equal(isChecklistBody('- [ ] a\n- [x] b\n正文一'), true);       // 2/3 > 0.5
  assert.equal(isChecklistBody('正文一\n正文二\n- [ ] a'), false);      // 1/3 < 0.5
  assert.equal(isChecklistBody(''), false);
  assert.equal(isChecklistBody('全是正文\n没有清单'), false);
});

test('边界:恰 50% 清单行 → false(> 0.5 严格多数,保护正文+todo 的真 episode)', () => {
  assert.equal(isChecklistBody('- [ ] a\n- [x] b\n正文一\n正文二'), false); // 2/4 = 0.5 → 保留
  assert.equal(isChecklistBody('今天去了梁庄。\n- [ ] 顺手记一条'), false);   // 1/2 = 0.5 → 保留
});

test('selectResurfacedEvents: 空 body 事件永不进候选', () => {
  const out = selectResurfacedEvents([ev('梁庄的声音', '   ')], { nowMs: NOW });
  assert.equal(out.length, 0);
});

test('selectResurfacedEvents: 清单 body 事件永不进候选(open-loops 的料)', () => {
  const out = selectResurfacedEvents(
    [ev('接下来要做的', '- [ ] 读池塘\n- [ ] 认识阿花\n- [x] 上线年轮')],
    { nowMs: NOW }
  );
  assert.equal(out.length, 0);
});

test('selectResurfacedEvents: structuralTitles(复发判定)命中的标题被跳过', () => {
  const events = [
    ev('今天总结', '今天写了一千行,读了八万字。'),
    ev('活人第七十一天：周蕊看到了', '周蕊在备注栏写了雨。'),
  ];
  const out = selectResurfacedEvents(events, {
    nowMs: NOW,
    structuralTitles: new Set([normalizeEventText('今天总结')])
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, '活人第七十一天：周蕊看到了');
});

test('selectResurfacedEvents: seed 标题(醒来)即使不在 structuralTitles 也被跳过', () => {
  const out = selectResurfacedEvents([ev('醒来', '凌晨五点多醒来。读了锚点。')], { nowMs: NOW });
  assert.equal(out.length, 0);
});

test('seed 只杀短标题:前缀撞上但标题长(真事)→ 不误杀,交给复发表', () => {
  const events = [
    ev('总结了和楠楠聊的三个月', '把三个月的对话理了一遍。'),
    ev('醒来发现周蕊回了消息', '她凌晨回的。'),
  ];
  const out = selectResurfacedEvents(events, { nowMs: NOW, limit: 5 });
  assert.equal(out.length, 2, '长标题真事不被 seed 前缀误杀');
});

test('回归护栏:短而有实质的事(周蕊的「雨」)仍能浮现——证明无长度阈值误杀', () => {
  const out = selectResurfacedEvents(
    [ev('周蕊写了一个字：雨', '不是备注。是她自己的字。')],
    { nowMs: NOW }
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].title, '周蕊写了一个字：雨');
});

test('真实情节事件正常浮现', () => {
  const out = selectResurfacedEvents(
    [ev('读完《出梁庄记》全文3074行', '追完了。梁庄的声音。李春迎。')],
    { nowMs: NOW }
  );
  assert.equal(out.length, 1);
});

test('corpus 仅含结构/空/清单 → 返回空(silent)', () => {
  const events = [
    ev('醒来', '例行。'),
    ev('今天总结', '流水账。'),
    ev('接下来要做的', '- [ ] a\n- [ ] b'),
    ev('无正文', '  '),
  ];
  const out = selectResurfacedEvents(events, {
    nowMs: NOW,
    structuralTitles: new Set([normalizeEventText('今天总结')])
  });
  assert.equal(out.length, 0);
});

test('structuralTitles 归一化:传入归一化键,标题大小写/多空白仍被匹配', () => {
  const out = selectResurfacedEvents(
    [ev('  Today   Summary ', '流水账。')],
    { nowMs: NOW, structuralTitles: new Set([normalizeEventText('today summary')]) }
  );
  assert.equal(out.length, 0);
});

test('过滤不动排序:干净候选仍搁最久优先', () => {
  const events = [
    ev('近的', '正文正文。', { dateMs: NOW - 10 * DAY_MS, ref: 'a' }),
    ev('远的', '正文正文。', { dateMs: NOW - 20 * DAY_MS, ref: 'b' }),
  ];
  const out = selectResurfacedEvents(events, { nowMs: NOW, limit: 2 });
  assert.equal(out.length, 2);
  assert.equal(out[0].title, '远的'); // 搁最久的先
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseDiaryDateFromName,
  parseDiaryEvents,
  selectResurfacedEvents,
  BEIJING_OFFSET_MS
} = require('../xiaoni-diary-events');

const NOW = Date.UTC(2026, 6, 12); // 2026-07-12 UTC 零点

test('parseDiaryDateFromName: YYYY-MM-DD → 北京本地零点(UTC−8h);非法 → null', () => {
  assert.equal(parseDiaryDateFromName('2026-07-05.md'), Date.UTC(2026, 6, 5) - BEIJING_OFFSET_MS);
  assert.equal(parseDiaryDateFromName('/xiaoni-runtime/notes/diary/2026-06-30.txt'),
    Date.UTC(2026, 5, 30) - BEIJING_OFFSET_MS);
  assert.equal(parseDiaryDateFromName('dictionary.md'), null);
  assert.equal(parseDiaryDateFromName('2026-13-40.md'), null);
  assert.equal(parseDiaryDateFromName(null), null);
});

test('parseDiaryEvents: 每个 ## 小标题一件事,标题+正文,忽略标题前散行', () => {
  const dateMs = parseDiaryDateFromName('2026-07-01.md');
  const md = [
    '散行不该有,忽略',
    '## 楠楠考研',
    '楠楠说她想二战,我答应盯着她进度。',
    '',
    '## 修好了发图超时',
    '入站裸 fetch 被 CDN 拒了,改走 getFile 兜底,修好了。'
  ].join('\n');
  const events = parseDiaryEvents(md, dateMs);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.title), ['楠楠考研', '修好了发图超时']);
  assert.equal(events[0].body, '楠楠说她想二战,我答应盯着她进度。');
  assert.equal(events[1].index, 1);
  assert.equal(events[0].dateMs, dateMs);
});

test('parseDiaryEvents: 空/无标题/坏 dateMs → []', () => {
  assert.deepEqual(parseDiaryEvents('', NOW), []);
  assert.deepEqual(parseDiaryEvents('只有正文没有标题', NOW), []);
  assert.deepEqual(parseDiaryEvents('## 有标题', NaN), []);
});

test('selectResurfacedEvents: 只挑搁置≥minAgeDays,搁最久优先', () => {
  const events = [
    { title: '很久前的事', body: 'x', dateMs: Date.UTC(2026, 5, 1) - BEIJING_OFFSET_MS, index: 0, ref: 'a#0' }, // ~41 天
    { title: '前几天的事', body: 'y', dateMs: Date.UTC(2026, 6, 10) - BEIJING_OFFSET_MS, index: 0, ref: 'b#0' }, // ~2 天 → 太近
    { title: '一周多前', body: 'z', dateMs: Date.UTC(2026, 6, 3) - BEIJING_OFFSET_MS, index: 0, ref: 'c#0' } // ~9 天
  ];
  const picked = selectResurfacedEvents(events, { nowMs: NOW, minAgeDays: 7, limit: 5 });
  assert.deepEqual(picked.map((p) => p.title), ['很久前的事', '一周多前']);
  assert.ok(picked[0].ageDays > picked[1].ageDays);
});

test('selectResurfacedEvents: recentlySurfaced 按 ref 或标题去重', () => {
  const events = [
    { title: '事一', body: '', dateMs: Date.UTC(2026, 5, 1) - BEIJING_OFFSET_MS, index: 0, ref: 'a#0' },
    { title: '事二', body: '', dateMs: Date.UTC(2026, 5, 2) - BEIJING_OFFSET_MS, index: 0, ref: 'a#1' }
  ];
  // 按 ref 去重
  assert.deepEqual(
    selectResurfacedEvents(events, { nowMs: NOW, minAgeDays: 7, recentlySurfaced: ['a#0'] }).map((p) => p.title),
    ['事二']
  );
  // 按规范化标题去重
  assert.deepEqual(
    selectResurfacedEvents(events, { nowMs: NOW, minAgeDays: 7, recentlySurfaced: ['事二'] }).map((p) => p.title),
    ['事一']
  );
});

test('selectResurfacedEvents: limit 截断;缺 nowMs → []', () => {
  const events = [
    { title: 'a', body: '', dateMs: Date.UTC(2026, 5, 1) - BEIJING_OFFSET_MS, index: 0, ref: 'a' },
    { title: 'b', body: '', dateMs: Date.UTC(2026, 5, 2) - BEIJING_OFFSET_MS, index: 0, ref: 'b' },
    { title: 'c', body: '', dateMs: Date.UTC(2026, 5, 3) - BEIJING_OFFSET_MS, index: 0, ref: 'c' }
  ];
  assert.equal(selectResurfacedEvents(events, { nowMs: NOW, minAgeDays: 7, limit: 2 }).length, 2);
  assert.deepEqual(selectResurfacedEvents(events, {}), []);
});

test('selectResurfacedEvents: ref 缺省用 dateMs#index', () => {
  const dateMs = Date.UTC(2026, 5, 1) - BEIJING_OFFSET_MS;
  const events = [{ title: 't', body: '', dateMs, index: 3 }];
  const [p] = selectResurfacedEvents(events, { nowMs: NOW, minAgeDays: 7 });
  assert.equal(p.ref, `${dateMs}#3`);
});

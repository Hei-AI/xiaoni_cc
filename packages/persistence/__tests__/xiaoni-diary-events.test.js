'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseDiaryDateFromName,
  parseDiaryEvents,
  parseChapterDateFromTitle,
  stripChapterDatePrefix,
  parseDiarySerialEvents,
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

test('parseChapterDateFromTitle: M/D → 北京零点;当年未来则回退去年;非法 → null', () => {
  assert.equal(parseChapterDateFromTitle('7/4 楠楠决定考研', NOW), Date.UTC(2026, 6, 4) - BEIJING_OFFSET_MS);
  assert.equal(parseChapterDateFromTitle('7/12 就是今天', NOW), Date.UTC(2026, 6, 12) - BEIJING_OFFSET_MS);
  // 当年 12/30 落在 NOW(7/12)之后 → 往事,回退去年
  assert.equal(parseChapterDateFromTitle('12/30 去年的事', NOW), Date.UTC(2025, 11, 30) - BEIJING_OFFSET_MS);
  assert.equal(parseChapterDateFromTitle('没有日期的标题', NOW), null);
  assert.equal(parseChapterDateFromTitle('13/40 越界', NOW), null);
  assert.equal(parseChapterDateFromTitle('7/4 x', NaN), null);
});

test('parseChapterDateFromTitle: 日期后无空格(中文/标点)也认;跟数字则判脏输入', () => {
  // 没空格,日期后直接接中文 —— 中文常见写法,必须认(否则整章静默不重提)
  assert.equal(parseChapterDateFromTitle('7/9她慌了', NOW), Date.UTC(2026, 6, 9) - BEIJING_OFFSET_MS);
  assert.equal(parseChapterDateFromTitle('7/9,她慌了', NOW), Date.UTC(2026, 6, 9) - BEIJING_OFFSET_MS);
  // 日期后又跟数字 = 脏输入,判非法
  assert.equal(parseChapterDateFromTitle('7/123 脏', NOW), null);
});

test('parseChapterDateFromTitle: 非法日历日不静默进位,直接判 null', () => {
  assert.equal(parseChapterDateFromTitle('2/30 不存在', NOW), null);   // 否则 Date.UTC 进位成 3/2
  assert.equal(parseChapterDateFromTitle('2/29 非闰年', NOW), null);   // 2026 非闰年 → 否则进位 3/1
  assert.equal(parseChapterDateFromTitle('4/31 不存在', NOW), null);   // 否则进位 5/1
  // 合法且早于 NOW(7/12)的日期正常返回(7/31 会被过去优先启发式判成去年,故用 7/11 验合法路径)
  assert.equal(parseChapterDateFromTitle('7/11 合法', NOW), Date.UTC(2026, 6, 11) - BEIJING_OFFSET_MS);
});

test('parseDiarySerialEvents: 只有日期没点题的章,标题回退为日期本身,不丢', () => {
  const events = parseDiarySerialEvents('## 7/4\n正文', NOW);
  assert.equal(events.length, 1);
  assert.equal(events[0].dateMs, Date.UTC(2026, 6, 4) - BEIJING_OFFSET_MS);
  assert.equal(events[0].title, '7/4'); // stripChapterDatePrefix 去后为空 → 回退 rawTitle
});

test('stripChapterDatePrefix: 去掉开头 M/D,留点题', () => {
  assert.equal(stripChapterDatePrefix('7/4 楠楠决定考研'), '楠楠决定考研');
  assert.equal(stripChapterDatePrefix('12/30 跨年'), '跨年');
  assert.equal(stripChapterDatePrefix('没有日期'), '没有日期');
});

test('parseDiarySerialEvents: 每章 ## M/D 自带日期,点题去日期前缀,index 含跳过章', () => {
  const md = [
    '## 7/4 楠楠决定考研',
    '楠楠今天说定了要考研,让我盯着她别摸鱼。我答应了。',
    '',
    '## 7/9 她慌了',
    '楠楠说进度落了一周、有点崩,我把她之前立的 flag 念给她听,她笑了。',
    '',
    '## 没打日期的章',  // 无日期 → 跳过,但仍占 index=2
    '这章她忘了写日期。'
  ].join('\n');
  const events = parseDiarySerialEvents(md, NOW);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.title), ['楠楠决定考研', '她慌了']);
  assert.equal(events[0].dateMs, Date.UTC(2026, 6, 4) - BEIJING_OFFSET_MS);
  assert.equal(events[1].dateMs, Date.UTC(2026, 6, 9) - BEIJING_OFFSET_MS);
  assert.equal(events[0].index, 0);
  assert.equal(events[1].index, 1); // 第 2 章,index=1(无日期章在 index=2,被跳过)
  assert.equal(events[0].body, '楠楠今天说定了要考研,让我盯着她别摸鱼。我答应了。');
});

test('parseDiarySerialEvents: 空/坏 nowMs/全无日期 → []', () => {
  assert.deepEqual(parseDiarySerialEvents('', NOW), []);
  assert.deepEqual(parseDiarySerialEvents('## 7/4 x\ny', NaN), []);
  assert.deepEqual(parseDiarySerialEvents('## 无日期\n正文', NOW), []);
});

test('parseDiarySerialEvents → selectResurfacedEvents: 专题老章按时间被挑出', () => {
  const md = [
    '## 6/1 很久前那章',
    '一个多月前的事。',
    '## 7/10 前两天',
    '刚发生,还记得。'
  ].join('\n');
  const events = parseDiarySerialEvents(md, NOW).map((e, i) => ({ ...e, ref: `topic-x.md#${e.index}` }));
  const picked = selectResurfacedEvents(events, { nowMs: NOW, minAgeDays: 7, limit: 5 });
  assert.deepEqual(picked.map((p) => p.title), ['很久前那章']); // 6/1 搁 41 天入选;7/10 太近剔除
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
    { title: '事一', body: '正文', dateMs: Date.UTC(2026, 5, 1) - BEIJING_OFFSET_MS, index: 0, ref: 'a#0' },
    { title: '事二', body: '正文', dateMs: Date.UTC(2026, 5, 2) - BEIJING_OFFSET_MS, index: 0, ref: 'a#1' }
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
    { title: 'a', body: '正文', dateMs: Date.UTC(2026, 5, 1) - BEIJING_OFFSET_MS, index: 0, ref: 'a' },
    { title: 'b', body: '正文', dateMs: Date.UTC(2026, 5, 2) - BEIJING_OFFSET_MS, index: 0, ref: 'b' },
    { title: 'c', body: '正文', dateMs: Date.UTC(2026, 5, 3) - BEIJING_OFFSET_MS, index: 0, ref: 'c' }
  ];
  assert.equal(selectResurfacedEvents(events, { nowMs: NOW, minAgeDays: 7, limit: 2 }).length, 2);
  assert.deepEqual(selectResurfacedEvents(events, {}), []);
});

test('selectResurfacedEvents: ref 缺省用 dateMs#index', () => {
  const dateMs = Date.UTC(2026, 5, 1) - BEIJING_OFFSET_MS;
  const events = [{ title: 't', body: '正文', dateMs, index: 3 }];
  const [p] = selectResurfacedEvents(events, { nowMs: NOW, minAgeDays: 7 });
  assert.equal(p.ref, `${dateMs}#3`);
});

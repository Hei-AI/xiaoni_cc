'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseOpenLoops,
  parseTagDate,
  selectStaleOpenLoops,
  normalizeLoopText,
  stripTrailingHashTags,
  BEIJING_OFFSET_MS,
  MAX_TAG_AGE_DAYS
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
  // 12/25 在 7/12 之后 → 回退去年 = 2025-12-25。但那已经 199 天前,超 MAX_TAG_AGE_DAYS(180)
  // → 不认(落 undated)。回退逻辑本身仍在,只在回退后仍落 180 天内时才成立,见下面 H1 的用例。
  assert.equal(parseTagDate('12/25', NOW), null);
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
    // ~161 天 → overdue,降权。原来写的是 (1/1)(~192 天),超了 MAX_TAG_AGE_DAYS(180)会
    // 直接不被认成日期 → 落 undated,测不到 overdue;改成 2/1 让它留在 overdue 档。
    '- [ ] 古老承诺 (2/1)',
    '- [ ] 中龄承诺 (6/20)', // ~22 天 → active
    '- [ ] 新些的 (7/6)' // ~6 天 → active
  ].join('\n'));
  const picked = selectStaleOpenLoops(loops, { nowMs: NOW, staleDays: 2, maxActiveDays: 30, limit: 2 });
  // limit 2:两条 active(中龄 > 新些)先占满,古老 overdue 挤不进
  assert.deepEqual(picked.map((p) => p.text), ['中龄承诺', '新些的']);
  assert.ok(picked.every((p) => p.tier === 'active'));
});

test('selectStaleOpenLoops: overdue 在有名额时作为填充浮出(排 active 之后)', () => {
  // (2/1) ≈ 161 天:仍在 MAX_TAG_AGE_DAYS(180)内,所以是 overdue 而不是 undated
  const loops = parseOpenLoops('- [ ] 古老承诺 (2/1)\n- [ ] 中龄承诺 (6/20)');
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

// ---------------------------------------------------------------------------
// 括号里带尾巴的日期标注(T8)
//
// 生产事故:旧正则要求括号里「只有日期」且贴着行尾,但她真实写的全是 `(7/27起)`
// `(7/26起，现在ch55)` `(7/25-7/27)` 这种,17 行里只有 1 行能解析 —— 库里 open_loop_scan
// 的浮出项 63% 落在 tier:'undated'(实测 2026-07-28:undated 89 / active 53)。
// 下面这组用例把她真实写过的每一种形状都钉住(日期改成 fixture 里的老日期,避免和真数据混淆)。
// ---------------------------------------------------------------------------

test('parseTagDate: 括号里日期后面带尾巴的真实写法都能解析(取开头那个日期)', () => {
  // 形状照抄真实写法,日期换成 NOW(7/12)之前的
  const cases = [
    ['7/5起', [2026, 6, 5]],
    ['7/4起，现在ch55', [2026, 6, 4]],
    ['7/3开始', [2026, 6, 3]],
    ['7/2第一次去', [2026, 6, 2]],
    ['7/5定，8/27截止', [2026, 6, 5]],          // 尾巴里还有第二个日期 → 只取开头那个
    ['7/1-7/8', [2026, 6, 1]],                   // 范围 → 取开始日
    ['7/3说的"读不完就永远闭嘴"，读到了26/31', [2026, 6, 3]], // 尾巴含引号 + 分数
    ['7/5 done', [2026, 6, 5]],
    ['7/5→7/6', [2026, 6, 5]],                   // 箭头范围 → 取开始日
    ['7/5发的', [2026, 6, 5]],
    ['7/1-8/4', [2026, 6, 1]]
  ];
  for (const [tag, [y, mZeroBased, d]] of cases) {
    assert.equal(
      parseTagDate(tag, NOW),
      Date.UTC(y, mZeroBased, d) - BEIJING_OFFSET_MS,
      `tag=${tag}`
    );
  }
});

test('parseOpenLoops: 带尾巴的括号被完整收进 openedTag,text 不残留括号', () => {
  const loops = parseOpenLoops([
    '- [ ] 追连载 (7/5起)',
    '- [ ] 七天实验 (7/1-7/8)',
    '- [ ] 等邮件回 (7/3发的)'
  ].join('\n'));
  assert.deepEqual(
    loops.map((l) => [l.text, l.openedTag]),
    [
      ['追连载', '7/5起'],
      ['七天实验', '7/1-7/8'],
      ['等邮件回', '7/3发的']
    ]
  );
});

test('parseTagDate: 范围写法取【第一个日期 = 开始日】', () => {
  // openedTag 的语义是「什么时候开始的」,ageDays 量的是「搁了多久」→ 起算点必须是开始日。
  // 取结束日会把未来的截止日当开始日,ageDays 变负被 staleDays 挡掉 → 该提的行永远不提。
  assert.equal(parseTagDate('7/1-7/8', NOW), Date.UTC(2026, 6, 1) - BEIJING_OFFSET_MS);
  assert.equal(parseTagDate('7/1→7/8', NOW), Date.UTC(2026, 6, 1) - BEIJING_OFFSET_MS);
  // 结束日跨月也一样只看开始日
  assert.equal(parseTagDate('6/28-7/4', NOW), Date.UTC(2026, 5, 28) - BEIJING_OFFSET_MS);
});

test('parseTagDate: 三段的年份判定(4 位年 / 2 位年缩写 / 都不是)', () => {
  assert.equal(parseTagDate('2026-06-30', NOW), Date.UTC(2026, 5, 30) - BEIJING_OFFSET_MS);
  assert.equal(parseTagDate('2026/6/30 记的', NOW), Date.UTC(2026, 5, 30) - BEIJING_OFFSET_MS);
  // 第一段 > 12 且有三段 → 只能是 2 位年缩写(月不可能 > 12)
  assert.equal(parseTagDate('26-06-30', NOW), Date.UTC(2026, 5, 30) - BEIJING_OFFSET_MS);
  // 4 位年缺日 → 不是日期
  assert.equal(parseTagDate('2026-07', NOW), null);
  // 第一段 ≤ 12 时三段一律按 M/D + 尾巴(范围写法走这里),不当年份
  assert.equal(parseTagDate('7/1-7/8', NOW), Date.UTC(2026, 6, 1) - BEIJING_OFFSET_MS);
});

test('parseTagDate: 带尾巴时缺年回退去年的逻辑仍在(回退后落 180 天内)', () => {
  // 回退去年只在回退结果仍在 MAX_TAG_AGE_DAYS(180)内时成立 → 也就是上半年。
  // 用 2026-02-10 当 now:12/25 在它之后 → 回退到 2025-12-25,只有 47 天,认。尾巴不影响。
  const febNow = Date.UTC(2026, 1, 10);
  assert.equal(parseTagDate('12/25起', febNow), Date.UTC(2025, 11, 25) - BEIJING_OFFSET_MS);
  assert.equal(parseTagDate('12/25', febNow), Date.UTC(2025, 11, 25) - BEIJING_OFFSET_MS);
  // 同一个 12/25 在 NOW(7/12)下回退成 199 天前 → 超上限,不认
  assert.equal(parseTagDate('12/25起', NOW), null);
});

// ---------------------------------------------------------------------------
// MAX_TAG_AGE_DAYS —— 括号里像日期、其实是分数/进度(T8 二轮)
//
// 放宽正则去吃括号里的尾巴之后,`(1/3进度)` 会被当成 1 月 3 日。误判比 undated 严重:第二腿
// 按 ageDays「最久优先」排序,假的半年前条目会长期钉在最前面反复浮(正是这条腿的已知病)。
// 所以解析出的日期距今超过 180 天就不认,落 undated。
// 零伤害依据:open-loops.md 2026-07-23 才建,现存最老的锚是 07-20 那一档,全部远在 180 天内。
// ---------------------------------------------------------------------------

test('parseTagDate: 超过 MAX_TAG_AGE_DAYS 的日期不认(护 `(1/3进度)` 这类分数写法)', () => {
  assert.equal(MAX_TAG_AGE_DAYS, 180);
  // NOW = 7/12。1/3 → 今年 1 月 3 日 = 190 天前 > 180 → null
  assert.equal(parseTagDate('1/3进度', NOW), null);
  assert.equal(parseTagDate('1/3', NOW), null); // 裸写法同样受上限约束
  // 边界:标注日期按北京零点解释,所以「N 天前那一天」实际年龄是 N 天 + 8 小时 ——
  // 179 天前那天(179d8h)在上限内,181 天前那天(181d8h)超上限。180 天那天正落在 8h 模糊带上,
  // 不做断言(阈值本身是粗筛,不需要小时级精度)。
  const mdOf = (daysAgo) => {
    const d = new Date(NOW - daysAgo * 86400000 + BEIJING_OFFSET_MS);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  };
  assert.notEqual(parseTagDate(mdOf(179), NOW), null, `${mdOf(179)}(179 天前)应在上限内`);
  assert.equal(parseTagDate(mdOf(181), NOW), null, `${mdOf(181)}(181 天前)应超上限`);
  // 显式年份写法同样受上限约束(2025 年的锚不认)
  assert.equal(parseTagDate('2025-01-03', NOW), null);
});

test('parseTagDate: 2/5看完 这类「上限内但其实是分数」仍会被当日期(已知残留,不由上限治)', () => {
  // 上限只挡半年以上的误判。157 天前的 2/5 无法和真日期区分,老老实实落 overdue。
  // 这不是新引入的:旧正则下 `(2/5)` 本来就当日期;新增的只是尾巴 `看完` 也能吃掉。
  assert.equal(parseTagDate('2/5看完', NOW), Date.UTC(2026, 1, 5) - BEIJING_OFFSET_MS);
});

test('selectStaleOpenLoops: `(1/3进度)` 落 undated,不会顶着假 ageDays 霸榜', () => {
  const loops = parseOpenLoops([
    '- [ ] 一本书读到 (1/3进度)',
    '- [ ] 真承诺 (7/5起)'
  ].join('\n'));
  const picked = selectStaleOpenLoops(loops, { nowMs: NOW, staleDays: 2, limit: 5 });
  assert.deepEqual(picked.map((p) => [p.text, p.tier, p.ageDays]), [
    ['真承诺', 'active', picked[0].ageDays],  // 真锚排前面
    ['一本书读到', 'undated', null]            // 假日期不参与 ageDays 排序
  ]);
  assert.ok(picked[0].ageDays > 0 && picked[0].ageDays < 10);
});

test('selectStaleOpenLoops: 她真实用的时间锚不受上限影响(07-20 那一档)', () => {
  // 真文件里现存最老的锚是 7/20 那一档;NOW 用 2026-07-28 复现真机,ageDays ≈ 8 天。
  const realNow = Date.UTC(2026, 6, 28);
  const loops = parseOpenLoops([
    '- [ ] 追连载 (7/20起)',
    '- [ ] 七天实验 (7/20-7/27)',
    '- [ ] 等回信 (7/20发的)',
    '- [ ] 定了个截止 (7/20定，8/20截止)'
  ].join('\n'));
  const picked = selectStaleOpenLoops(loops, { nowMs: realNow, staleDays: 2, limit: 10 });
  assert.equal(picked.length, 4);
  assert.ok(picked.every((p) => p.tier === 'active'), '四条都该是 active,一条都不该落 undated');
  assert.ok(picked.every((p) => Math.round(p.ageDays * 10) / 10 === 8.3), JSON.stringify(picked.map((p) => p.ageDays)));
});

test('parseOpenLoops: 正文里自带括号不会被日期正则误配(`[^)]*` 不跨右括号)', () => {
  const loops = parseOpenLoops([
    '- [ ] 帮楠楠(考研)看资料 (7/5起)',
    '- [ ] 读到第3章(共12章)还没完'
  ].join('\n'));
  assert.deepEqual(
    loops.map((l) => [l.text, l.openedTag]),
    [
      ['帮楠楠(考研)看资料', '7/5起'],
      ['读到第3章(共12章)还没完', null]
    ]
  );
});

test('selectStaleOpenLoops: 带尾巴的写法不再落 undated(生产 63% undated 的回归)', () => {
  const loops = parseOpenLoops([
    '- [ ] 追连载 (7/5起)',
    '- [ ] 七天实验 (7/1-7/8)',
    '- [ ] 等回信 (7/3发的)'
  ].join('\n'));
  const picked = selectStaleOpenLoops(loops, { nowMs: NOW, staleDays: 2, limit: 5 });
  assert.equal(picked.length, 3);
  assert.ok(picked.every((p) => p.tier === 'active'), '三条都该是 active,不该落 undated');
  assert.ok(picked.every((p) => typeof p.ageDays === 'number'));
  // 最久优先:7/1 > 7/3 > 7/5
  assert.deepEqual(picked.map((p) => p.text), ['七天实验', '等回信', '追连载']);
});

test('selectStaleOpenLoops: 范围写法按开始日算 ageDays', () => {
  const loops = parseOpenLoops('- [ ] 七天实验 (7/1-7/8)');
  const [picked] = selectStaleOpenLoops(loops, { nowMs: NOW, staleDays: 2, limit: 1 });
  // 7/1 北京零点(= 6/30 16:00 UTC)→ NOW(7/12 00:00 UTC)= 11 天 8 小时
  assert.equal(Math.round(picked.ageDays * 10) / 10, 11.3);
  // 若误取结束日 7/8,ageDays 只有 4.3 天,会被 staleDays 之外的排序全打乱
  assert.ok(picked.ageDays > 11);
});

// ---------------------------------------------------------------------------
// 行末 `#标签` → 独立字段(T8)
// ---------------------------------------------------------------------------

test('parseOpenLoops: 行末 #标签 抽成 tags 并从 text 剥掉(spec 形状:标签在日期前)', () => {
  const loops = parseOpenLoops('- [ ] 周蕊Day 55到152读完 #周蕊 (7/5起)');
  assert.deepEqual(loops[0].tags, ['周蕊']);
  assert.equal(loops[0].text, '周蕊Day 55到152读完');
  assert.equal(loops[0].openedTag, '7/5起');
});

test('parseOpenLoops: 标签写在日期之后也认(容忍两种顺序)', () => {
  const loops = parseOpenLoops('- [ ] 周蕊Day 55到152读完 (7/5起) #周蕊');
  assert.deepEqual(loops[0].tags, ['周蕊']);
  assert.equal(loops[0].text, '周蕊Day 55到152读完');
  assert.equal(loops[0].openedTag, '7/5起');
});

test('parseOpenLoops: 一行多个标签按行内顺序,重复的去掉', () => {
  const loops = parseOpenLoops([
    '- [ ] 一件事 #线A #line-b #标签_c (7/5)',
    '- [ ] 另一件 #重复 (7/5) #重复'
  ].join('\n'));
  assert.deepEqual(loops[0].tags, ['线A', 'line-b', '标签_c']);
  assert.equal(loops[0].text, '一件事');
  assert.deepEqual(loops[1].tags, ['重复']);
  assert.equal(loops[1].text, '另一件');
});

test('parseOpenLoops: 没打标签的行 tags 是空数组(不是 null)', () => {
  const loops = parseOpenLoops('- [ ] 没打标签 (7/5)\n- [ ] 也没日期');
  assert.deepEqual(loops.map((l) => l.tags), [[], []]);
});

test('parseOpenLoops: 剥标签后 identity 不变 —— 给老行补标签不该重置冷却', () => {
  // 这是「必须从 text 剥掉」的唯一理由:normalizeLoopText(text) 是第二腿冷却去重的键。
  // 标签留在 text 里,她给一条老行补个标签就换了身份 → 冷却失效 → 同一句话被重浮一次。
  const before = parseOpenLoops('- [ ] 周蕊Day 55到152读完 (7/5起)')[0];
  const after = parseOpenLoops('- [ ] 周蕊Day 55到152读完 #周蕊 (7/5起)')[0];
  assert.equal(normalizeLoopText(after.text), normalizeLoopText(before.text));
  // 冷却链路实测:用「补标签前」浮过的文本当 recentlySurfaced,补标签后的行仍被跳过
  const picked = selectStaleOpenLoops(parseOpenLoops('- [ ] 周蕊Day 55到152读完 #周蕊 (7/5起)'), {
    nowMs: NOW,
    staleDays: 2,
    recentlySurfaced: [before.text]
  });
  assert.deepEqual(picked, []);
});

test('parseOpenLoops: 正文中间的 #issue 号不当标签剥掉', () => {
  // 真实写过 `explorabl.es Issue #39提了 (7/27)`;`#39` 是 issue 号。
  // 规则:标签首字符不许是数字 → 这半句正文原样留在 text 里。
  const loops = parseOpenLoops('- [x] explorabl.es Issue #39提了 (7/5)');
  assert.equal(loops[0].text, 'explorabl.es Issue #39提了');
  assert.deepEqual(loops[0].tags, []);
});

test('parseOpenLoops: 标签字符集 —— 含 / 的不算标签,原样留在 text', () => {
  const loops = parseOpenLoops('- [ ] 一件事 #标签/斜杠');
  assert.equal(loops[0].text, '一件事 #标签/斜杠');
  assert.deepEqual(loops[0].tags, []);
});

test('parseOpenLoops: 整行只有一个标签、没有正文 → 标签不剥(否则整行静默消失)', () => {
  // `#` 前必须有空白才算行末标签;这样「文本就是一个标签」时不会被剥空、被 `if (!text)` 丢掉。
  const loops = parseOpenLoops('- [ ] #周蕊');
  assert.equal(loops.length, 1);
  assert.equal(loops[0].text, '#周蕊');
  assert.deepEqual(loops[0].tags, []);
});

test('parseOpenLoops: 划掉行 [x] / 放弃行 [-] 一样抽标签(状态判定不受影响)', () => {
  const loops = parseOpenLoops([
    '- [x] 做完了 #线A (7/5起)',
    '- [-] 不做了 #线B (7/1-7/8)'
  ].join('\n'));
  assert.deepEqual(
    loops.map((l) => [l.state, l.done, l.text, l.openedTag, l.tags]),
    [
      ['done', true, '做完了', '7/5起', ['线A']],
      ['dropped', true, '不做了', '7/1-7/8', ['线B']]
    ]
  );
});

test('stripTrailingHashTags: 纯函数行为', () => {
  assert.deepEqual(stripTrailingHashTags('a #x #y'), { text: 'a', tags: ['x', 'y'] });
  assert.deepEqual(stripTrailingHashTags('a #标签 b'), { text: 'a #标签 b', tags: [] }); // 不在行末
  assert.deepEqual(stripTrailingHashTags('#nospaceprefix'), { text: '#nospaceprefix', tags: [] });
  assert.deepEqual(stripTrailingHashTags('a #39号'), { text: 'a #39号', tags: [] }); // 首位数字不算标签
  assert.deepEqual(stripTrailingHashTags(null), { text: '', tags: [] });
});

test('selectStaleOpenLoops: tags 透传到 pick(含 undated 档)', () => {
  const loops = parseOpenLoops('- [ ] 有日期 #线A (7/5起)\n- [ ] 没日期 #线B');
  const picked = selectStaleOpenLoops(loops, { nowMs: NOW, staleDays: 2, limit: 3 });
  assert.deepEqual(picked.map((p) => [p.text, p.tier, p.tags]), [
    ['有日期', 'active', ['线A']],
    ['没日期', 'undated', ['线B']]
  ]);
});

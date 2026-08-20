'use strict';

// 投递闸判官的纯逻辑。它坐在**投递闸**上(一天十几次),不是每次落地 ——
// 检索侧保持纯算术才有回归集可言(docs/adr/0006)。

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_CANDIDATES_IN_PROMPT,
  MAX_PICKS,
  buildJudgePrompt,
  parseJudgeVerdict
} = require('../xiaoni-recall-delivery-judge');

const cand = (id, text, ageDays) => ({ id, text, ageDays });

test('prompt 里必须写明「一条都不值得」是正常结果 —— 否则判官退化成每次必冒', () => {
  const { system } = buildJudgePrompt([cand('a', 'x')], '现在在做的事');
  assert.match(system, /一条都不值得/);
  assert.match(system, /空列表/);
});

test('prompt:判据是「会让此刻变得不一样吗」,不是「像不像」', () => {
  const { system } = buildJudgePrompt([], '');
  assert.match(system, /变得不一样吗/);
  assert.match(system, /像但没用的,不要/);
});

test('prompt:候选与锚点都截断,候选条数封顶', () => {
  const many = Array.from({ length: 40 }, (_, i) => cand(`c${i}`, 'y'.repeat(2000), i));
  const { user } = buildJudgePrompt(many, 'z'.repeat(5000));
  assert.ok(user.includes('[c0]'));
  assert.ok(!user.includes(`[c${MAX_CANDIDATES_IN_PROMPT}]`), '超出上限的候选不该进');
  assert.ok(user.length < 6000, `user 该被截断,实得 ${user.length}`);
});

test('prompt:带上年龄,让判官知道有多久没想起', () => {
  const { user } = buildJudgePrompt([cand('a', '一件旧事', 42.7)], '现在');
  assert.match(user, /42 天前/);
});

test('解析:正常输出', () => {
  const out = parseJudgeVerdict('{"picks":[{"id":"a","hook":"四十天前你也在门口站了很久"}]}', ['a', 'b']);
  assert.equal(out.picks.length, 1);
  assert.equal(out.picks[0].id, 'a');
});

test('解析:空 picks 是合法结果(判官说这次不值得)', () => {
  assert.deepEqual(parseJudgeVerdict('{"picks":[]}', ['a']).picks, []);
});

test('解析:模型编的 id 直接丢掉,不猜', () => {
  const out = parseJudgeVerdict('{"picks":[{"id":"编的","hook":"一句话"},{"id":"a","hook":"真的"}]}', ['a']);
  assert.deepEqual(out.picks.map((p) => p.id), ['a']);
});

test('解析:钩子写空的丢掉', () => {
  const out = parseJudgeVerdict('{"picks":[{"id":"a","hook":"  "},{"id":"b","hook":"有内容"}]}', ['a', 'b']);
  assert.deepEqual(out.picks.map((p) => p.id), ['b']);
});

test('解析:封顶 MAX_PICKS', () => {
  const picks = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, hook: `钩子${i}` }));
  const ids = picks.map((p) => p.id);
  assert.equal(parseJudgeVerdict(JSON.stringify({ picks }), ids).picks.length, MAX_PICKS);
});

test('解析:读不出来 → 空 picks(fail-closed,判官是投递闸,读不出宁可不打扰她)', () => {
  for (const bad of ['', '不是 JSON', '{坏', null, undefined, '{"picks":"不是数组"}']) {
    assert.deepEqual(parseJudgeVerdict(bad, ['a']).picks, [], JSON.stringify(bad));
  }
});

// parsed 与 picks 是两件事。混成一个空数组,判官一挂整条投递腿会静默死掉且无迹可循。
test('parsed 区分「判官说不值得」和「判官没答上来」', () => {
  assert.deepEqual(parseJudgeVerdict('{"picks":[]}', ['a']), { parsed: true, picks: [] },
    '明确空 → 答了,调用方该静默');
  assert.equal(parseJudgeVerdict('模型挂了没输出', ['a']).parsed, false, '读不出 → 没答上来');
  assert.equal(parseJudgeVerdict('{"picks":"不是数组"}', ['a']).parsed, false, '形状不对 → 没答上来');
});

test('编的 id 被逐条丢掉,但不影响 parsed —— 它确实答了', () => {
  const out = parseJudgeVerdict('{"picks":[{"id":"编的","hook":"x"}]}', ['a']);
  assert.equal(out.parsed, true);
  assert.deepEqual(out.picks, []);
});

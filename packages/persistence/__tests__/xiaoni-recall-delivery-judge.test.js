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
  // 候选按**序号**标(不是真 id)—— 真 id 会被模型省成裸哈希,一省就对不上。
  assert.ok(user.includes('[1]'));
  assert.ok(user.includes(`[${MAX_CANDIDATES_IN_PROMPT}]`), '上限之内的候选都该进');
  assert.ok(!user.includes(`[${MAX_CANDIDATES_IN_PROMPT + 1}]`), '超出上限的候选不该进');
  assert.ok(user.length < 6000, `user 该被截断,实得 ${user.length}`);
});

test('prompt:带上年龄,让判官知道有多久没想起', () => {
  const { user } = buildJudgePrompt([cand('a', '一件旧事', 42.7)], '现在');
  assert.match(user, /42 天前/);
});

test('解析:正常输出', () => {
  const out = parseJudgeVerdict('{"picks":[{"id":1,"hook":"四十天前你也在门口站了很久"}]}', ['a', 'b']);
  assert.equal(out.picks.length, 1);
  assert.equal(out.picks[0].id, 'a');
});

test('解析:空 picks 是合法结果(判官说这次不值得)', () => {
  assert.deepEqual(parseJudgeVerdict('{"picks":[]}', ['a']).picks, []);
});

test('解析:不是序号的 id 直接丢掉,不猜', () => {
  const out = parseJudgeVerdict('{"picks":[{"id":"编的","hook":"一句话"},{"id":1,"hook":"真的"}]}', ['a']);
  assert.deepEqual(out.picks.map((p) => p.id), ['a']);
});

test('解析:钩子写空的丢掉', () => {
  const out = parseJudgeVerdict('{"picks":[{"id":1,"hook":"  "},{"id":2,"hook":"有内容"}]}', ['a', 'b']);
  assert.deepEqual(out.picks.map((p) => p.id), ['b']);
});

test('解析:封顶 MAX_PICKS', () => {
  const ids = Array.from({ length: 9 }, (_, i) => `c${i}`);
  const picks = ids.map((_, i) => ({ id: i + 1, hook: `钩子${i}` }));
  assert.equal(parseJudgeVerdict(JSON.stringify({ picks }), ids).picks.length, MAX_PICKS);
});

test('解析:读不出来 → 空 picks(fail-closed,判官是投递闸,读不出宁可不打扰她)', () => {
  for (const bad of ['', '不是 JSON', '{坏', null, undefined, '{"picks":"不是数组"}']) {
    assert.deepEqual(parseJudgeVerdict(bad, ['a']).picks, [], JSON.stringify(bad));
  }
});

// parsed 与 picks 是两件事。混成一个空数组,判官一挂整条投递腿会静默死掉且无迹可循。
test('parsed 区分「判官说不值得」和「判官没答上来」', () => {
  assert.deepEqual(parseJudgeVerdict('{"picks":[]}', ['a']), { parsed: true, recovered: false, picks: [] },
    '明确空 → 答了,调用方该静默');
  assert.equal(parseJudgeVerdict('模型挂了没输出', ['a']).parsed, false, '读不出 → 没答上来');
  assert.equal(parseJudgeVerdict('{"picks":"不是数组"}', ['a']).parsed, false, '形状不对 → 没答上来');
});

test('编的 id 被逐条丢掉,但不影响 parsed —— 它确实答了', () => {
  const out = parseJudgeVerdict('{"picks":[{"id":"编的","hook":"x"}]}', ['a']);
  assert.equal(out.parsed, true);
  assert.deepEqual(out.picks, []);
});

// ── 序号 → 真 id ──────────────────────────────────────────────────────────
// 2026-08-21 线上第一条真判决就死在这:prompt 给的是完整 key,
// Haiku 回的是裸哈希(把 `recall-surface:association:` 前缀省了),
// 于是「编造 id」那道防线把它自己挑的那条丢掉,还对外显示成「判官说一条都不值得」。
const FULL = 'recall-surface:association:5b5e3a2bdea1d1f94569388aff783ae9';

test('解析:序号翻回真 id(这是现在的正路)', () => {
  const out = parseJudgeVerdict('{"picks":[{"id":2,"hook":"那条街怎么活起来的"}]}', ['a', FULL, 'c']);
  assert.equal(out.picks.length, 1);
  assert.equal(out.picks[0].id, FULL);
});

test('解析:编了一个越界序号 → 丢掉,但 parsed 仍为 true', () => {
  const out = parseJudgeVerdict('{"picks":[{"id":"99","hook":"h"}]}', ['a', 'b']);
  assert.equal(out.picks.length, 0);
  assert.equal(out.parsed, true);
});

test('解析:回真 id 而不是序号 → 丢掉(prompt 里根本没给过真 id)', () => {
  const out = parseJudgeVerdict(
    '{"picks":[{"id":"5b5e3a2bdea1d1f94569388aff783ae9","hook":"源头在这"}]}',
    ['a', FULL, 'c']
  );
  assert.equal(out.picks.length, 0);
  assert.equal(out.parsed, true, '它确实答了 —— 这不是「没答上来」');
});

// 曾经留过一条「裸哈希后缀唯一命中就认」的兼容路。它会把**越界序号**当哈希后缀匹配:
// "4" 在十个 recall-surface:<leg>:<md5hex> 里有约三分之一概率唯一命中一个以 4 结尾的哈希,
// 于是投出去的是记忆 B、配的却是判官为记忆 A 写的钩子。
test('解析:越界序号绝不能顺着哈希后缀匹配到别的记忆', () => {
  const ids = [
    'recall-surface:association:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4',
    'recall-surface:association:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb7'
  ];
  const out = parseJudgeVerdict('{"picks":[{"id":"4","hook":"判官为第 4 条写的钩子"}]}', ids);
  assert.equal(out.picks.length, 0, '只有两条候选,序号 4 越界 → 丢掉,不许配到 …a4 那条');
});

test('解析:方括号或句点抄进来了也认', () => {
  for (const raw of ['{"picks":[{"id":"[2]","hook":"h"}]}', '{"picks":[{"id":"2.","hook":"h"}]}']) {
    assert.equal(parseJudgeVerdict(raw, ['a', FULL, 'c']).picks[0].id, FULL, raw);
  }
});

// ── 钩子里夹英文双引号 ────────────────────────────────────────────────────
// 2026-08-28 真库:近 24h 1327 条判决 219 条 parsed=false,**全部**是判官挑了东西的那种 ——
// 钩子引原话用了英文双引号,JSON.parse 在第一个内嵌 `"` 处断掉,约 48% 的正向判决被静默丢掉。
const REAL_SAMPLE = '{"picks":[{"id":3,"hook":"站标语从"the hand knew."换成…"}]}';

test('解析:钩子里未转义的英文双引号 → 宽松扫描抠回来,parsed=true 且标 recovered', () => {
  const out = parseJudgeVerdict(REAL_SAMPLE, ['a', 'b', 'c']);
  assert.equal(out.parsed, true);
  assert.equal(out.recovered, true);
  assert.deepEqual(out.picks, [{ id: 'c', hook: '站标语从"the hand knew."换成…' }]);
});

test('解析:多条 pick 各夹双引号,顺序与钩子原文都保住', () => {
  const raw = '{"picks":[{"id":1,"hook":"楠楠说"手"不一样"},{"id":"2","hook":"他说 "no" 了"},{"id":3,"hook":"干净的"}]}';
  const out = parseJudgeVerdict(raw, ['a', 'b', 'c']);
  assert.equal(out.recovered, true);
  assert.deepEqual(out.picks, [
    { id: 'a', hook: '楠楠说"手"不一样' },
    { id: 'b', hook: '他说 "no" 了' },
    { id: 'c', hook: '干净的' }
  ]);
});

test('解析:hook 在前 id 在后也能抠', () => {
  const out = parseJudgeVerdict('{"picks":[{"hook":"她说"嘴变了"","id":2}]}', ['a', 'b']);
  assert.deepEqual(out.picks, [{ id: 'b', hook: '她说"嘴变了"' }]);
});

test('解析:正常 JSON 不走宽松路(recovered=false),已转义的引号照常还原', () => {
  const out = parseJudgeVerdict('{"picks":[{"id":1,"hook":"正常\\"转义\\""}]}', ['a']);
  assert.equal(out.recovered, false);
  assert.equal(out.picks[0].hook, '正常"转义"');
});

test('解析:宽松路抠出的 id 同样只认序号,越界 / 编的照丢,但 parsed=true', () => {
  const out = parseJudgeVerdict('{"picks":[{"id":9,"hook":"引"文""},{"id":"编的","hook":"引"文""}]}', ['a', 'b']);
  assert.equal(out.parsed, true);
  assert.deepEqual(out.picks, []);
});

test('解析:JSON 坏了但明确写着 "picks":[] → 算答了(静默),不当成没答上来', () => {
  const out = parseJudgeVerdict('{"picks":[]} 顺便说一句}', ['a']);
  assert.deepEqual(out, { parsed: true, recovered: true, picks: [] });
});

test('解析:垃圾文本 / 没有 hook 形状 → 仍然 parsed=false(不许把读不出猜成不值得)', () => {
  for (const bad of ['模型挂了', '{"pick":[{"id":1}]}', '{"picks":[{"id":1,"hook":', '"hook" 这个词出现了但没有结构']) {
    const out = parseJudgeVerdict(bad, ['a']);
    assert.equal(out.parsed, false, bad);
    assert.equal(out.recovered, false, bad);
  }
});

test('prompt:写明英文双引号会截断 JSON 的机制,例子里的引文不再用英文双引号示范', () => {
  const { system } = buildJudgePrompt([cand('a', 'x')], '现在');
  assert.match(system, /hook 的值里出现英文双引号/);
  // 例子是模型抄得最狠的地方:钩子示例里一个英文双引号都不能有。
  for (const line of system.split('\n').filter((l) => l.startsWith('→ 值得。钩子:'))) {
    assert.ok(!line.includes('"'), line);
  }
});

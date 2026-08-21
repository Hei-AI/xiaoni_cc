'use strict';

// 自适应 query 展开的纯逻辑。
// 存在理由:召回只有 dense 这一路 —— BM25 只在**已取回**的 top-K 池内做 RRF 重排,
// 补不了漏召,方向还是收紧。所以 dense 没捞进来的东西,排序再准、判官再聪明也看不见。

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isWeakResult,
  buildExpansionPrompt,
  parseExpansion,
  MAX_TAGS_IN_PROMPT
} = require('../xiaoni-recall-query-expansion');

test('触发闸:候选太少 或 最高分太低 → 判弱', () => {
  assert.equal(isWeakResult({ topCos: 0.9, qualifiedCount: 1 }), true, '候选不足');
  assert.equal(isWeakResult({ topCos: 0.2, qualifiedCount: 50 }), true, '最高分太低');
  assert.equal(isWeakResult({ topCos: 0.9, qualifiedCount: 50 }), false, '两条都强 → 不展开');
});

test('触发闸:两个数都拿不到时判强 —— 宁可少做,不无端烧调用', () => {
  assert.equal(isWeakResult({}), false);
  assert.equal(isWeakResult({ topCos: NaN, qualifiedCount: undefined }), false);
});

test('触发闸阈值可覆盖', () => {
  assert.equal(isWeakResult({ topCos: 0.5, qualifiedCount: 50 }, { weakTopCos: 0.6 }), true);
  assert.equal(isWeakResult({ topCos: 0.5, qualifiedCount: 50 }, { weakTopCos: 0.4 }), false);
});

test('prompt:标签表截断 + 锚点截断 —— 她的标签会越攒越多', () => {
  const tags = Array.from({ length: 400 }, (_, i) => `#tag${i}`);
  const { system, user } = buildExpansionPrompt('x'.repeat(5000), tags, 3);
  assert.ok(user.includes('#tag0'));
  assert.ok(!user.includes(`#tag${MAX_TAGS_IN_PROMPT + 5}`), '超出上限的标签不该进 prompt');
  assert.ok(user.length < 4000, `user 应被截断,实得 ${user.length}`);
  assert.match(system, /3 条/);
  assert.match(system, /只输出 JSON/);
});

test('prompt:没有标签也能用(她还没开始打标签的时候)', () => {
  const { user } = buildExpansionPrompt('今天为开口紧张', [], 3);
  assert.ok(user.includes('(暂无)'));
});

test('解析:正常 JSON', () => {
  const out = parseExpansion('{"tags":["#hwc"],"queries":["第一次开口前的紧张","以前在别人面前说话"]}');
  assert.deepEqual(out.tags, ['#hwc']);
  assert.equal(out.queries.length, 2);
});

test('解析:模型加了废话也能抠出 JSON', () => {
  const out = parseExpansion('好的,这是结果:\n{"tags":[],"queries":["一句检索句"]}\n希望有帮助!');
  assert.deepEqual(out.queries, ['一句检索句']);
});

test('解析:拿不到就返回空 —— 调用方退回单 query(fail-open)', () => {
  for (const bad of ['', '不是 JSON', '{坏的', null, undefined, '{"queries":"不是数组"}']) {
    const out = parseExpansion(bad);
    assert.deepEqual(out.queries, [], JSON.stringify(bad));
  }
});

test('解析:过滤空串,并封顶条数', () => {
  const out = parseExpansion(JSON.stringify({ queries: ['', '  ', 'a', ...Array.from({ length: 20 }, (_, i) => `q${i}`)] }));
  assert.ok(out.queries.length <= 8);
  assert.ok(!out.queries.includes(''));
});

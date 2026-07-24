'use strict';

// 海马体分域召回(design-20260723 被动联想):域判别 / 闲聊门 / inbound 在场硬检查 / 双域合成,
// 以及 runShadowRecall 编排层的分域行为。纯函数 + 假 persistence,不碰 DB。

const test = require('node:test');
const assert = require('node:assert');
const {
  recallDomainOf,
  isLowInfoRecallText,
  filterInboundBricksByPresence,
  combineDomainResults,
  SELF_DOMAIN_CUE_CLASSES,
  PEER_DOMAIN_CUE_CLASSES
} = require('../xiaoni-recall-bandpass');
const { createRecallIngest } = require('../xiaoni-recall-ingest');

// ── recallDomainOf ──────────────────────────────────────────────────────────

test('recallDomainOf:file_provenance/spoken → self;life_cue/未知/缺失 → peer', () => {
  assert.strictEqual(recallDomainOf({ provenance: { cueClass: 'db_file_provenance' } }), 'self');
  assert.strictEqual(recallDomainOf({ provenance: { cueClass: 'db_spoken_fragment' } }), 'self');
  assert.strictEqual(recallDomainOf({ provenance: { cueClass: 'db_life_cue' } }), 'peer');
  assert.strictEqual(recallDomainOf({ provenance: {} }), 'peer');
  assert.strictEqual(recallDomainOf({}), 'peer');
});

// ── isLowInfoRecallText(闲聊门)─────────────────────────────────────────────

test('闲聊门:纯笑声/表情/裸数字/超短 → true', () => {
  assert.strictEqual(isLowInfoRecallText('哈哈哈哈哈哈哈哈'), true);
  assert.strictEqual(isLowInfoRecallText('233333 www'), true);
  assert.strictEqual(isLowInfoRecallText('👍👍🎉'), true);
  assert.strictEqual(isLowInfoRecallText('35'), true);
  assert.strictEqual(isLowInfoRecallText('好的'), true);   // 超短寒暄
  assert.strictEqual(isLowInfoRecallText(''), true);
  assert.strictEqual(isLowInfoRecallText(null), true);
});

test('闲聊门:有实质内容 → false(哪怕带哈哈哈)', () => {
  assert.strictEqual(isLowInfoRecallText('哈哈哈 他肯定不是这个意思但你说得对'), false);
  assert.strictEqual(isLowInfoRecallText('perdu.com 法语 就一句话 迷路了你在这里'), false);
  assert.strictEqual(isLowInfoRecallText('不是备注。是她自己的字。'), false);
});

// ── filterInboundBricksByPresence(在场硬检查)──────────────────────────────

const CUTOFF_MS = Date.parse('2026-07-23T04:15:00Z'); // 遗忘线:12:15 东八区

function inboundBrick(id) {
  return { sourceRef: `inbound:${id}`, embeddingText: '一条别人说过的话' };
}

test('在场硬检查:已读且遗忘线前读的 inbound 砖放行', () => {
  const states = new Map([[1, { id: 1, isRead: true, readAt: '2026-07-20T02:00:00Z' }]]);
  const out = filterInboundBricksByPresence([inboundBrick(1)], states, CUTOFF_MS);
  assert.strictEqual(out.length, 1);
});

test('在场硬检查:遗忘线后才读 → 剔(还在活上下文尾里;jazz.neocities 案例)', () => {
  const states = new Map([[2, { id: 2, isRead: true, readAt: '2026-07-23T07:40:00Z' }]]);
  const out = filterInboundBricksByPresence([inboundBrick(2)], states, CUTOFF_MS);
  assert.strictEqual(out.length, 0);
});

test('在场硬检查:未读 / 无状态 → 剔(不是记忆,是 notify 的活)', () => {
  const states = new Map([[3, { id: 3, isRead: false, readAt: null }]]);
  assert.strictEqual(filterInboundBricksByPresence([inboundBrick(3)], states, CUTOFF_MS).length, 0);
  assert.strictEqual(filterInboundBricksByPresence([inboundBrick(4)], new Map(), CUTOFF_MS).length, 0);
});

test('在场硬检查:遗忘线缺失(从未压缩)→ inbound 全剔 fail-closed;非 inbound ref 不归它管', () => {
  const states = new Map([[5, { id: 5, isRead: true, readAt: '2026-07-01T00:00:00Z' }]]);
  assert.strictEqual(filterInboundBricksByPresence([inboundBrick(5)], states, null).length, 0);
  const nonInbound = [{ sourceRef: 'stack:100' }, { sourceRef: '/xiaoni-runtime/notes/diary/2026-07-08.md#3' }];
  assert.strictEqual(filterInboundBricksByPresence(nonInbound, new Map(), null).length, 2);
});

test('在场硬检查:inbound: 前缀但 id 非数字(message_sid 铸的 ref)→ fail-closed 剔', () => {
  const weird = [{ sourceRef: 'inbound:AbCdEf123XYZ' }, { sourceRef: 'inbound:' }];
  assert.strictEqual(filterInboundBricksByPresence(weird, new Map(), CUTOFF_MS).length, 0);
});

// ── combineDomainResults(双域合成)─────────────────────────────────────────

function res(surfaced, dropped = [], nearDupPresent = false) {
  return { surfaced, dropped, silent: surfaced.length === 0, nearDupPresent, floor: 0.1, ceiling: 0.6 };
}

test('双域合成:自我域有胜者 → 优先自我域,最多 1 块;落选域胜者折进 dropped 不消失', () => {
  const s = res([{ cos: 0.4, candidate: { sourceRef: 'diary' } }, { cos: 0.35, candidate: { sourceRef: 'diary2' } }]);
  const p = res([{ cos: 0.9, candidate: { sourceRef: 'inbound:1' } }]);
  const out = combineDomainResults(s, p, 1);
  assert.strictEqual(out.surfaced.length, 1);
  assert.strictEqual(out.surfaced[0].candidate.sourceRef, 'diary');
  assert.strictEqual(out.chosenDomain, 'self');
  // 落选的 peer 胜者进 dropped(drop_domain_priority),shadow 分布完整,阈值校准看得见域间竞争
  const loser = out.dropped.find((d) => d.verdict === 'drop_domain_priority');
  assert.ok(loser, '落选域胜者应折进 dropped');
  assert.strictEqual(loser.candidate.sourceRef, 'inbound:1');
});

test('双域合成:近重复压制是落地级——任一域检出 nearDup → 整条落地静默,另一域不许照冒', () => {
  const s = res([{ cos: 0.4, candidate: { sourceRef: 'diary' } }]);          // 自我域有个带内胜者
  const p = res([], [], true);                                               // 他人域检出近重复(她在重复刚做的事)
  const out = combineDomainResults(s, p, 1);
  assert.strictEqual(out.silent, true, '整条落地静默,diary 不许冒');
  assert.strictEqual(out.nearDupPresent, true);
  assert.strictEqual(out.chosenDomain, null);
  const killed = out.dropped.find((d) => d.verdict === 'drop_landing_near_dup');
  assert.ok(killed && killed.candidate.sourceRef === 'diary', '被压掉的胜者留在 dropped 可审计');
});

test('双域合成:自我域静默 → 用他人域;两域皆静默 → silent 且 dropped 合并', () => {
  const p = res([{ cos: 0.5, candidate: { sourceRef: 'inbound:1' } }]);
  const out = combineDomainResults(res([]), p, 1);
  assert.strictEqual(out.chosenDomain, 'peer');
  assert.strictEqual(out.surfaced[0].candidate.sourceRef, 'inbound:1');

  const both = combineDomainResults(
    res([], [{ verdict: 'drop_too_far', cos: 0.01, candidate: { sourceRef: 'a' } }]),
    res([], [{ verdict: 'drop_in_context', cos: 0.7, candidate: { sourceRef: 'b' } }]),
    1
  );
  assert.strictEqual(both.silent, true);
  assert.strictEqual(both.chosenDomain, null);
  assert.strictEqual(both.dropped.length, 2);
});

// ── runShadowRecall 编排层:分域检索 + 砖侧闲聊门 + 在场硬检查接线 ────────────

function fakePersistence(overrides = {}) {
  const calls = { shadowLogs: [], candidateArgs: [] };
  const base = {
    calls,
    async getExistingContentHashes() { return new Map(); },
    async upsertRecallCues(_id, cues) { return { upserted: cues.length }; },
    async listRecallCandidates(args) {
      calls.candidateArgs.push(args);
      const pool = overrides.pool || [];
      // 模拟分域检索:按 cueClasses 过滤(真库由 SQL 完成)
      if (Array.isArray(args.cueClasses) && args.cueClasses.length) {
        return pool.filter((c) => args.cueClasses.includes(c.provenance?.cueClass));
      }
      return pool;
    },
    async getRecallCueVectorsByRefs() { return []; },
    async insertRecallShadowLog(rec) { calls.shadowLogs.push(rec); return { id: '1' }; },
    async getSessionReadCutoffState() { return { readCutoffAfterStackIndex: 500 }; },
    async listInContextStackSourceRefs() { return ['stack:600']; },
    async getAgentStackItemTimeByIndex() { return '2026-07-23T04:15:00Z'; },
    async getInboundReadStates(ids) {
      return (overrides.readStates || []).filter((r) => ids.includes(r.id));
    }
  };
  return Object.assign(base, overrides.fns || {});
}

const embedOnes = async (texts) => texts.map(() => [1, 0, 0]);

test('编排:闲聊 cue 不触发联想(不写 shadow log)', async () => {
  const persistence = fakePersistence();
  const ingest = createRecallIngest({ embed: embedOnes, persistence });
  const out = await ingest.runShadowRecall({ landedText: '哈哈哈哈哈', landedRef: 'q' });
  assert.strictEqual(out, null);
  assert.strictEqual(persistence.calls.shadowLogs.length, 0);
});

test('编排:分域两次检索(self/peer 各带 cueClasses),自我域胜者压过他人域高分', async () => {
  const pool = [
    { sourceRef: '/diary/2026-07-08.md#1', embedding: [0.8, 0.6, 0], provenance: { cueClass: 'db_file_provenance' }, embeddingText: '压缩挤出的日记往事一条' },
    { sourceRef: 'inbound:1', embedding: [0.95, 0.31, 0], provenance: { cueClass: 'db_life_cue' }, embeddingText: '别人说过的一句相关的话' }
  ];
  const persistence = fakePersistence({
    pool,
    readStates: [{ id: 1, isRead: true, readAt: '2026-07-01T00:00:00Z' }] // 遗忘线前读过 → 合法砖
  });
  const ingest = createRecallIngest({ embed: embedOnes, persistence });
  const out = await ingest.runShadowRecall({ landedText: '今天又想起那件事来了', landedRef: 'q' });

  const classArgs = persistence.calls.candidateArgs.map((a) => a.cueClasses);
  assert.deepStrictEqual(classArgs[0], SELF_DOMAIN_CUE_CLASSES);
  assert.deepStrictEqual(classArgs[1], PEER_DOMAIN_CUE_CLASSES);
  // inbound cos 更高(0.95 vs 0.8),但自我域优先
  assert.strictEqual(out.surfaced[0].candidate.sourceRef, '/diary/2026-07-08.md#1');
  assert.strictEqual(persistence.calls.shadowLogs[0].surfaced[0].domain, 'self');
});

test('编排:遗忘线后才读的 inbound 砖被硬剔(jazz.neocities 回归)', async () => {
  const pool = [
    { sourceRef: 'inbound:37983', embedding: [0.9, 0.44, 0], provenance: { cueClass: 'db_life_cue' }, embeddingText: 'jazz.neocities 整个网站一段话' }
  ];
  const persistence = fakePersistence({
    pool,
    readStates: [{ id: 37983, isRead: true, readAt: '2026-07-23T07:40:00Z' }] // 遗忘线(04:15Z)之后读 → 在活尾
  });
  const ingest = createRecallIngest({ embed: embedOnes, persistence });
  const out = await ingest.runShadowRecall({ landedText: '有人发了个字符画花园网站', landedRef: 'q' });
  assert.strictEqual(out.silent, true, '唯一候选被在场硬检查剔掉 → 静默');
});

test('编排:perdu→pova 真玉留存回归(遗忘线前读的他人话,自我域静默时照常冒)', async () => {
  const pool = [
    { sourceRef: 'inbound:32347', embedding: [0.8, 0.6, 0], provenance: { cueClass: 'db_life_cue', peer: '楠楠' }, embeddingText: 'pova.cc/mirror css写了六遍' }
  ];
  const persistence = fakePersistence({
    pool,
    readStates: [{ id: 32347, isRead: true, readAt: '2026-07-08T13:00:00Z' }]
  });
  const ingest = createRecallIngest({ embed: embedOnes, persistence });
  const out = await ingest.runShadowRecall({ landedText: 'perdu.com 法语 就一句话 迷路了你在这里', landedRef: 'q' });
  assert.strictEqual(out.silent, false);
  assert.strictEqual(out.surfaced[0].candidate.sourceRef, 'inbound:32347');
  assert.strictEqual(persistence.calls.shadowLogs[0].surfaced[0].domain, 'peer');
});

test('编排:砖侧闲聊门——低信息记忆不入候选', async () => {
  const pool = [
    { sourceRef: 'inbound:9', embedding: [1, 0, 0], provenance: { cueClass: 'db_life_cue' }, embeddingText: '哈哈哈哈哈哈' }
  ];
  const persistence = fakePersistence({
    pool,
    readStates: [{ id: 9, isRead: true, readAt: '2026-07-01T00:00:00Z' }]
  });
  const ingest = createRecallIngest({ embed: embedOnes, persistence });
  const out = await ingest.runShadowRecall({ landedText: '今天办成了一件正经事', landedRef: 'q' });
  assert.strictEqual(out.silent, true, '纯笑声砖被砖侧闲聊门剔掉');
});

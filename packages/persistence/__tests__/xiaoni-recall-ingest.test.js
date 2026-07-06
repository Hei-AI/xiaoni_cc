'use strict';

// 被动浮现 ingest+触发2 orchestrator 编排逻辑(假 embed / 假 persistence,不碰 DB/服务)。
//   node --test __tests__/xiaoni-recall-ingest.test.js
// docs/XIAONI_PASSIVE_RECALL_SHADOW_COMPLETION.md §3

const test = require('node:test');
const assert = require('node:assert');
const { createRecallIngest } = require('../xiaoni-recall-ingest');

function fakePersistence(overrides = {}) {
  const calls = { upserts: [], shadowLogs: [], hashLookups: [] };
  const base = {
    calls,
    async getExistingContentHashes(_id, refs) { calls.hashLookups.push(refs); return new Map(); },
    async upsertRecallCues(_id, cues) { calls.upserts.push(cues); return { upserted: cues.length }; },
    async listRecallCandidates() { return overrides.candidates || []; },
    async getRecallCueVectorsByRefs() { return overrides.contextVectors || []; },
    async insertRecallShadowLog(rec) { calls.shadowLogs.push(rec); return { id: '1' }; }
  };
  return Object.assign(base, overrides.fns || {});
}

const embedOnes = async (texts) => texts.map(() => [1, 0, 0]);

test('createRecallIngest 缺 embed/persistence 抛错', () => {
  assert.throws(() => createRecallIngest({}), /embed/);
  assert.throws(() => createRecallIngest({ embed: embedOnes }), /persistence/);
});

test('触发1 ingestInboundMessages:建 cue → 嵌入 → upsert', async () => {
  const persistence = fakePersistence();
  const ingest = createRecallIngest({ embed: embedOnes, persistence });
  const res = await ingest.ingestInboundMessages([
    { id: 1, chat_type: 'private', sender_name: '楠楠', body_for_agent: '晚上吃葱油面吗' }
  ]);
  assert.strictEqual(res.upserted, 1);
  assert.strictEqual(persistence.calls.upserts[0][0].sourceRef, 'inbound:1');
  assert.ok(persistence.calls.upserts[0][0].embedding.length > 0, '带上了嵌入向量');
});

test('触发1 内容 hash 没变 → 跳过嵌入+upsert', async () => {
  const persistence = fakePersistence({
    fns: { async getExistingContentHashes(_id, refs) {
      // 假装这条已存在且 hash 一致 → changed 为空
      const { buildRecallCueFromInboundMessage } = require('../xiaoni-passive-recall-extractor');
      const cue = buildRecallCueFromInboundMessage({ id: 1, chat_type: 'private', body_for_agent: '一样的话' });
      return new Map([[cue.sourceRef, cue.contentHash]]);
    } }
  });
  const ingest = createRecallIngest({ embed: embedOnes, persistence });
  const res = await ingest.ingestInboundMessages([{ id: 1, chat_type: 'private', body_for_agent: '一样的话' }]);
  assert.strictEqual(res.upserted, 0);
  assert.strictEqual(persistence.calls.upserts.length, 0, '没触发 upsert');
});

test('触发2 runShadowRecall:band-pass 分类 + 写 shadow_log(不投递)', async () => {
  const candidates = [
    { sourceRef: 'A', embedding: [0.8, 0.6, 0], provenance: { leadTemplate: 'db_file_provenance', path: '/x/a.md' }, embeddingText: '带内 A' },
    { sourceRef: 'B', embedding: [1, 0, 0], provenance: {}, embeddingText: '太像 B' },
    { sourceRef: 'C', embedding: [0, 0, 1], provenance: {}, embeddingText: '太远 C' }
  ];
  const persistence = fakePersistence({ candidates });
  const ingest = createRecallIngest({ embed: embedOnes, persistence });
  const result = await ingest.runShadowRecall({ landedText: '葱油面', landedRef: 'q1', taskLocked: false });

  assert.strictEqual(result.silent, false);
  assert.deepStrictEqual(result.surfaced.map((e) => e.candidate.sourceRef), ['A']);
  const log = persistence.calls.shadowLogs[0];
  assert.ok(log, '写了一条 shadow_log');
  assert.strictEqual(log.queryRef, 'q1');
  assert.strictEqual(log.silent, false);
  assert.strictEqual(log.surfaced[0].sourceRef, 'A');
  assert.ok(log.surfaced[0].lead && typeof log.surfaced[0].lead.text === 'string', 'surfaced 带渲染 lead');
  assert.strictEqual(log.droppedCounts.drop_too_similar, 1); // B
  assert.strictEqual(log.droppedCounts.drop_too_far, 1);     // C
});

test('④ 语义式在场排除:带内候选和近窗向量太像 → drop_in_context', async () => {
  const candidates = [
    { sourceRef: 'D', embedding: [0.75, 0.66, 0.03], provenance: {}, embeddingText: '换了说法刚做过' }
  ];
  const persistence = fakePersistence({
    candidates,
    contextVectors: [[0.8, 0.6, 0]] // 近窗里有一条和 D 几乎同向
  });
  const ingest = createRecallIngest({ embed: embedOnes, persistence });
  const result = await ingest.runShadowRecall({ landedText: '葱油面', landedRef: 'q2', contextRefs: ['ctx1'] });

  assert.strictEqual(result.silent, true, 'D 被语义在场排除,什么都不冒');
  const log = persistence.calls.shadowLogs[0];
  assert.strictEqual(log.droppedCounts.drop_in_context, 1);
});

test('触发2 空落地文本 → 不召回不写 log', async () => {
  const persistence = fakePersistence();
  const ingest = createRecallIngest({ embed: embedOnes, persistence });
  const res = await ingest.runShadowRecall({ landedText: '   ' });
  assert.strictEqual(res, null);
  assert.strictEqual(persistence.calls.shadowLogs.length, 0);
});

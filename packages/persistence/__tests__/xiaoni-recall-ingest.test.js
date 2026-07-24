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
    { sourceRef: 'A', embedding: [0.8, 0.6, 0], provenance: { leadTemplate: 'db_file_provenance', path: '/x/a.md' }, embeddingText: '带内的一条往事记录' },
    { sourceRef: 'B', embedding: [1, 0, 0], provenance: {}, embeddingText: '太像的一条重复记录' },
    { sourceRef: 'C', embedding: [0, 0, 1], provenance: {}, embeddingText: '太远的一条噪声记录' }
  ];
  const persistence = fakePersistence({ candidates });
  const ingest = createRecallIngest({ embed: embedOnes, persistence });
  const result = await ingest.runShadowRecall({ landedText: '晚上想吃一碗葱油面了', landedRef: 'q1', taskLocked: false });

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
  const result = await ingest.runShadowRecall({ landedText: '晚上想吃一碗葱油面了', landedRef: 'q2', contextRefs: ['ctx1'] });

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

// 「不在上下文」= 不在她当前 replay 的 stack 尾(压缩 cutoff 之上)。哪怕某候选是最像的,只要它还在
// 她当前上下文里(cutoff 之上),就绝不能当「召回」冒出来 —— 那是她已持有的,不是浮现。
test('结构式在场排除对齐真实 cutoff:cutoff 之上的候选(她还持有)→ drop_in_context,不冒', async () => {
  const candidates = [
    // 最像 query(几乎同向),但它是「她当前上下文里」的块(stack:900,cutoff=500 之上)→ 必须剔
    { sourceRef: 'stack:900', embedding: [1, 0, 0], provenance: {}, embeddingText: '她此刻正持有的' },
    // 相关但已被压缩挤出(stack:100,cutoff 之下)→ 允许浮现
    { sourceRef: 'stack:100', embedding: [0.8, 0.6, 0], provenance: { leadTemplate: 'db_file_provenance', path: '/x/a.md' }, embeddingText: '压缩挤出的往事' }
  ];
  const seenExclude = [];
  const persistence = fakePersistence({
    candidates,
    fns: {
      // cutoff=500;她当前上下文 = stack_index>500 的块,映射成 stack:600/900(含最像的 stack:900)
      async getSessionReadCutoffState({ sessionKey }) {
        assert.strictEqual(sessionKey, 'xiaoni:global');
        return { readCutoffAfterStackIndex: 500 };
      },
      async listInContextStackSourceRefs({ afterStackIndex }) {
        assert.strictEqual(afterStackIndex, 500);
        return ['stack:600', 'stack:900'];
      },
      async listRecallCandidates(args) { seenExclude.push(args.excludeSourceRefs); return candidates; }
    }
  });
  const ingest = createRecallIngest({ embed: embedOnes, persistence });
  const result = await ingest.runShadowRecall({ landedText: '晚上想吃一碗葱油面了', landedRef: 'stack:901', taskLocked: false });

  // 最像的 stack:900 因「还在上下文」被结构式剔;冒出来的是被挤出的 stack:100。
  assert.deepStrictEqual(result.surfaced.map((e) => e.candidate.sourceRef), ['stack:100']);
  const log = persistence.calls.shadowLogs[0];
  assert.strictEqual(log.droppedCounts.drop_in_context, 1, 'stack:900 结构式在场排除');
  // 权威在场集合(含落地项)进了 SQL 排除参数。
  assert.ok(seenExclude[0].includes('stack:900') && seenExclude[0].includes('stack:901'));
});

test('无 cutoff(全新 session)→ 结构式排除退回调用方近窗,不炸', async () => {
  const candidates = [{ sourceRef: 'stack:100', embedding: [0.8, 0.6, 0], provenance: {}, embeddingText: '被挤出的一段往事' }];
  const persistence = fakePersistence({
    candidates,
    fns: {
      async getSessionReadCutoffState() { return { readCutoffAfterStackIndex: null }; },
      async listInContextStackSourceRefs() { throw new Error('cutoff 为空不该走到枚举'); }
    }
  });
  const ingest = createRecallIngest({ embed: embedOnes, persistence });
  const result = await ingest.runShadowRecall({ landedText: '晚上想吃一碗葱油面了', landedRef: 'stack:901' });
  assert.strictEqual(result.silent, false);
  assert.deepStrictEqual(result.surfaced.map((e) => e.candidate.sourceRef), ['stack:100']);
});

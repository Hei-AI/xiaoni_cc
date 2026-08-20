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

// ── per-cue 冷却(2026-08-07 真库诊断)─────────────────────────────────────────
// 第二/三/四腿各自都有冷却,唯独向量腿没有 → 同一块砖无限重浮:近 7 天 shadow 里
// db_file_provenance 浮 648 次只有 10 个不同 ref(1.5%),单个文件 446 次。
// 投递开之前必须结构性堵死,否则投给她的就是复读机。
test('per-cue 冷却:窗口内浮过的砖这次不再冒(计入 cooled_down)', async () => {
  const candidates = [
    { sourceRef: 'HOT', embedding: [0.8, 0.6, 0], provenance: { leadTemplate: 'db_file_provenance', path: '/x/hot.md' }, embeddingText: '刚刚才浮过的那一条' },
    { sourceRef: 'FRESH', embedding: [0.78, 0.62, 0], provenance: { leadTemplate: 'db_file_provenance', path: '/x/fresh.md' }, embeddingText: '还没浮过的另一条往事' }
  ];
  const persistence = fakePersistence({
    candidates,
    fns: { async listRecentlySurfacedRecallRefs() { return ['HOT']; } }
  });
  const ingest = createRecallIngest({ embed: embedOnes, persistence });
  const result = await ingest.runShadowRecall({ landedText: '晚上想吃一碗葱油面了', landedRef: 'q3' });

  assert.deepStrictEqual(result.surfaced.map((e) => e.candidate.sourceRef), ['FRESH'], '冷却中的 HOT 不该冒');
  const log = persistence.calls.shadowLogs[0];
  assert.strictEqual(log.droppedCounts.cooled_down, 1);
});

test('per-cue 冷却:老 persistence 无此函数 → 退化成无冷却,行为不变', async () => {
  const candidates = [
    { sourceRef: 'HOT', embedding: [0.8, 0.6, 0], provenance: { leadTemplate: 'db_file_provenance', path: '/x/hot.md' }, embeddingText: '刚刚才浮过的那一条' }
  ];
  const persistence = fakePersistence({ candidates });
  assert.strictEqual(typeof persistence.listRecentlySurfacedRecallRefs, 'undefined');
  const ingest = createRecallIngest({ embed: embedOnes, persistence });
  const result = await ingest.runShadowRecall({ landedText: '晚上想吃一碗葱油面了', landedRef: 'q4' });
  assert.deepStrictEqual(result.surfaced.map((e) => e.candidate.sourceRef), ['HOT']);
});

test('per-cue 冷却:读冷却集抛错不阻断召回(宁可多浮一次,不可整条腿哑掉)', async () => {
  const candidates = [
    { sourceRef: 'X', embedding: [0.8, 0.6, 0], provenance: { leadTemplate: 'db_file_provenance', path: '/x/x.md' }, embeddingText: '一条正常的往事记录' }
  ];
  const persistence = fakePersistence({
    candidates,
    fns: { async listRecentlySurfacedRecallRefs() { throw new Error('db down'); } }
  });
  const ingest = createRecallIngest({ embed: embedOnes, persistence });
  const result = await ingest.runShadowRecall({ landedText: '晚上想吃一碗葱油面了', landedRef: 'q5' });
  assert.strictEqual(result.silent, false);
});

// ── 常驻菜单进语义在场排除 ────────────────────────────────────────────────
// 真库实测(2026-08-19,近 3 天 5631/5631 次请求):<xiaoni_status> / <xiaoni_diary_index> /
// <xiaoni_people> 100% 常驻在她的请求里。菜单已经点到的事,她看一眼就想得起来 ——
// 那不是「她不知道自己做过」。结构式在场排除按 sourceRef 比,对菜单无效(菜单不是栈项),
// 所以必须走语义式这条。
test('菜单里已经点到的事被压掉(drop_in_context),没点到的照常冒', async () => {
  // 三维手造向量,阈值见 bandpass 默认:floor=0.35 / ceiling=0.92。
  //   query      [1, 0, 0]
  //   MENTIONED  [0.6, 0.8, 0]   与 query cos=0.60(带内,不会先被 drop_too_similar 拦掉)
  //                              与菜单行向量同向 cos=1.00 → 该判 drop_in_context
  //   FRESH      [0.9, 0.436, 0] 与 query cos=0.90(带内);与菜单行 cos=0.89 < ceiling → 照常冒
  const candidates = [
    { sourceRef: 'MENTIONED', embedding: [0.6, 0.8, 0], provenance: { leadTemplate: 'file_chunk', path: '/x/m.md' }, embeddingText: '目录里已经写到的那件事' },
    { sourceRef: 'FRESH', embedding: [0.9, 0.436, 0], provenance: { leadTemplate: 'file_chunk', path: '/x/f.md' }, embeddingText: '目录那一行没提到的另一件事' }
  ];
  const MENU_LINE = '2026-08-18 | 目录里已经写到的那件事,写得够长够具体';
  const embedByText = async (texts) => texts.map((t) => (String(t) === MENU_LINE ? [0.6, 0.8, 0] : [1, 0, 0]));
  const persistence = fakePersistence({ candidates });
  const ingest = createRecallIngest({
    embed: embedByText,
    persistence,
    readContextMenus: async () => [`- ${MENU_LINE}`]
  });

  await ingest.runShadowRecall({ landedText: '晚上想吃一碗葱油面了', landedRef: 'q-menu' });
  const log = persistence.calls.shadowLogs[0];
  assert.equal(log.droppedCounts.drop_in_context, 1, '菜单点到的那条应被判 drop_in_context');
  assert.ok(!log.surfaced.some((e) => e.sourceRef === 'MENTIONED'), 'MENTIONED 不该冒出来');
});

test('不注入 readContextMenus → 行为与改动前完全一致', async () => {
  const candidates = [
    { sourceRef: 'A', embedding: [0.8, 0.6, 0], provenance: { leadTemplate: 'file_chunk', path: '/x/a.md' }, embeddingText: '一条正常的往事记录' }
  ];
  const persistence = fakePersistence({ candidates });
  const ingest = createRecallIngest({ embed: embedOnes, persistence });
  const result = await ingest.runShadowRecall({ landedText: '晚上想吃一碗葱油面了', landedRef: 'q-nomenu' });
  assert.equal(result.silent, false);
});

test('菜单读失败 / 嵌入失败不阻断召回(少一道在场排除只是多冒一条,不是错)', async () => {
  const candidates = [
    { sourceRef: 'A', embedding: [0.8, 0.6, 0], provenance: { leadTemplate: 'file_chunk', path: '/x/a.md' }, embeddingText: '一条正常的往事记录' }
  ];
  const persistence = fakePersistence({ candidates });
  const ingest = createRecallIngest({
    embed: embedOnes,
    persistence,
    readContextMenus: async () => { throw new Error('fs down'); }
  });
  const result = await ingest.runShadowRecall({ landedText: '晚上想吃一碗葱油面了', landedRef: 'q-fail' });
  assert.equal(result.silent, false);
});

test('太短的菜单行(分隔线/单词)不进在场向量 —— 噪音向量会误杀候选', async () => {
  const seen = [];
  const persistence = fakePersistence({ candidates: [] });
  const ingest = createRecallIngest({
    embed: async (texts) => { seen.push(...texts); return texts.map(() => [1, 0, 0]); },
    persistence,
    readContextMenus: async () => ['# 日记目录\n---\n- ok\n- 2026-08-18 | 这一行够长应该被收进去']
  });
  await ingest.runShadowRecall({ landedText: '晚上想吃一碗葱油面了', landedRef: 'q-short' });
  assert.ok(seen.some((t) => t.includes('这一行够长')), '够长的行要进');
  assert.ok(!seen.includes('ok'), '「ok」这种短行不该进');
  assert.ok(!seen.includes('---'), '分隔线不该进');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  bandpassRecall,
  renderRecallLead,
  cosineSimilarity,
  DEFAULT_CEILING
} = require('../xiaoni-recall-bandpass');

// 单位向量 [cosθ, sinθ],和 query=[1,0] 的余弦就是第一个分量。
const query = { vector: [1, 0] };
const nearDup = { sourceRef: 'a', embedding: [1, 0.02], embeddingText: 'near dup' };       // cos≈1.0  > ceiling
const mid = { sourceRef: 'b', embedding: [0.7, 0.7141], embeddingText: 'mid band' };        // cos≈0.7  中带
const low = { sourceRef: 'c', embedding: [0.45, 0.893], embeddingText: 'low' };             // cos≈0.45 发散过阈/锁着不过
const tooFar = { sourceRef: 'd', embedding: [0.2, 0.98], embeddingText: 'far' };            // cos≈0.2  < floor

test('mid-band candidate surfaces; near-duplicate is dropped as too_similar (self-match)', () => {
  const out = bandpassRecall({ query, candidates: [nearDup, mid], limit: 1 });
  assert.strictEqual(out.surfaced.length, 1);
  assert.strictEqual(out.surfaced[0].candidate.sourceRef, 'b');
  const dup = out.dropped.find((d) => d.candidate.sourceRef === 'a');
  assert.strictEqual(dup.verdict, 'drop_too_similar');
});

test('too-far candidate dropped; silent when nothing lands in the band (no forced top-1)', () => {
  const out = bandpassRecall({ query, candidates: [nearDup, tooFar], limit: 1 });
  assert.strictEqual(out.silent, true);
  assert.strictEqual(out.surfaced.length, 0);
  assert.ok(out.dropped.some((d) => d.candidate.sourceRef === 'd' && d.verdict === 'drop_too_far'));
});

test('structural in-context exclusion: candidate whose sourceRef is in the current context window is dropped', () => {
  const q = { vector: [1, 0], contextRefs: ['b'] };
  const out = bandpassRecall({ query: q, candidates: [mid], limit: 1 });
  assert.strictEqual(out.silent, true);
  assert.strictEqual(out.dropped[0].verdict, 'drop_in_context');
  assert.strictEqual(out.dropped[0].cos, null); // 结构式剔除不必算相似度
});

test('semantic in-context exclusion: mid-band vs query but near a context vector is dropped', () => {
  const q = { vector: [1, 0], contextVectors: [[0.7, 0.7141]] };
  const twin = { sourceRef: 'f', embedding: [0.71, 0.71], embeddingText: 'paraphrase of just-done' };
  const out = bandpassRecall({ query: q, candidates: [twin], limit: 1 });
  assert.strictEqual(out.silent, true);
  assert.strictEqual(out.dropped[0].verdict, 'drop_in_context');
});

test('task-lock raises the floor: a diffuse-surfaced candidate is dropped_too_far when task-locked', () => {
  const diffuse = bandpassRecall({ query: { vector: [1, 0], taskLocked: false }, candidates: [low], limit: 1 });
  assert.strictEqual(diffuse.surfaced.length, 1, 'cos≈0.45 surfaces in diffuse mode');

  const locked = bandpassRecall({ query: { vector: [1, 0], taskLocked: true }, candidates: [low], limit: 1 });
  assert.strictEqual(locked.silent, true, 'cos≈0.45 falls below the raised task-lock floor');
  assert.strictEqual(locked.dropped[0].verdict, 'drop_too_far');
});

test('empty query vector yields silence, never a crash', () => {
  const out = bandpassRecall({ query: { vector: [] }, candidates: [mid] });
  assert.strictEqual(out.silent, true);
  assert.strictEqual(out.surfaced.length, 0);
});

test('cosineSimilarity guards mismatched/empty vectors', () => {
  assert.strictEqual(cosineSimilarity([1, 0], []), 0);
  assert.strictEqual(cosineSimilarity([1, 0], [1, 0, 0]), 0);
  assert.ok(Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-9);
});

test('lead rendering: file / peer / generic templates, pointer + teaser only (no full body)', () => {
  const fileLead = renderRecallLead({
    sourceRef: '/xiaoni-runtime/notes/x.md#2',
    embeddingText: '关于小K那次争执的记录，很长很长的正文……',
    provenance: { leadTemplate: 'file_chunk', path: '/xiaoni-runtime/notes/x.md', privacyScope: 'self_private' }
  });
  assert.match(fileLead.text, /notes\/x\.md 里记过/);
  assert.ok(fileLead.hint.length <= 40, 'hint is a teaser, not the full body');

  const peerLead = renderRecallLead({
    sourceRef: 'evt-1',
    embeddingText: '上次答应帮忙的事',
    provenance: { leadTemplate: 'peer_message', peer: '小K', privacyScope: 'private_peer' }
  });
  assert.match(peerLead.text, /^小K 提过/);
  assert.strictEqual(peerLead.privacyScope, 'private_peer');

  const generic = renderRecallLead({
    sourceRef: 'evt-2',
    embeddingText: '某件没有模板的事',
    provenance: {}
  });
  assert.match(generic.text, /你之前碰过和这个像的事/);
  assert.strictEqual(generic.kind, 'generic');
});

test('DEFAULT_CEILING is a redundancy cutoff below 1', () => {
  assert.ok(DEFAULT_CEILING > 0 && DEFAULT_CEILING < 1);
});

test('去均值(meanVector)压掉枢纽:raw 高 cos 的枢纽,减 μ 后 cos 塌下去被剔', () => {
  // query 与 hub 在原始空间几乎同向(raw cos≈1),但都贴着公共分量 μ;
  // 另有一条真正"斜"的相关项(query 去 μ 后与它同向)。
  const query = [1, 1, 0.02];
  const mu = [1, 1, 0];               // 公共分量:query 和 hub 都被它主导
  const hub = [1, 1, -0.02];          // raw 与 query cos≈1(都≈μ 方向);去 μ 后与 query 反向 → 掉出带
  const real = [1.02, 1, 0.9];        // 去 μ 后 ≈ [0.02,0,0.9],和 query 去 μ 的 [0,0,0.02] 同侧(正 cos)

  // raw 模式:hub 因为 cos≈1 > ceiling 被当"太像",real 反而可能太远 —— 即枢纽主导。
  const raw = bandpassRecall({
    query: { vector: query },
    candidates: [
      { sourceRef: 'hub', embedding: hub, provenance: {}, embeddingText: 'hub' },
      { sourceRef: 'real', embedding: real, provenance: {}, embeddingText: 'real' }
    ],
    limit: 2
  });

  // 去均值模式:hub 减 μ 后与 query 去 μ 反向(cos<0)被剔;real 保留为正 cos。
  const centered = bandpassRecall({
    query: { vector: query, meanVector: mu },
    candidates: [
      { sourceRef: 'hub', embedding: hub, provenance: {}, embeddingText: 'hub' },
      { sourceRef: 'real', embedding: real, provenance: {}, embeddingText: 'real' }
    ],
    floor: 0.1,
    ceiling: 0.9,
    limit: 2
  });

  // 关键断言:去均值后 hub 不再作为 surfaced 冒出来(raw 空间它 cos 最高)。
  const centeredHub = centered.surfaced.find((e) => e.candidate.sourceRef === 'hub');
  assert.strictEqual(centeredHub, undefined, '去均值后枢纽不该 surfaced');
  // raw 空间 hub 的 cos 确实接近 1(证明"枢纽主导"的前提成立)。
  const rawHubCos = cosineSimilarity(query, hub);
  assert.ok(rawHubCos > 0.99, 'raw 空间枢纽 cos 接近 1');
});

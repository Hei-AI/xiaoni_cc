'use strict';

// importance = 她的投入痕迹。核心纪律有两条,两条都在这里钉死:
//   ① 证据按「谁写的」分类 —— 2026-08-19 真库实测,她那套书写因子在入站消息上全塌
//      (effort 0.011 / introspection 0.016 / peer 0.030,prose 全类别恒 1)。
//   ② 两类的 importance **不可比**,只能类内排序;跨类交给 relevance / recency。

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AUTHORED_BY_HER,
  AUTHORED_BY_PEER,
  classifyCandidate,
  headingOf,
  scoreCandidateImportance,
  groupCandidatesByAuthor
} = require('../xiaoni-recall-importance');

const herChunk = (text, path = '/xiaoni-runtime/notes/diary/2026-07-24.md') => ({
  sourceKind: 'file_chunk',
  sourceRef: `${path}#3`,
  embeddingText: text,
  provenance: { path }
});
const inbound = (peer, kind = 'inbound_group') => ({
  sourceKind: 'inbound',
  sourceRef: 'inbound:42',
  embeddingText: '晚上吃葱油面吗',
  provenance: { peer, kind }
});

test('分类看的是谁写的,不是存在哪张表', () => {
  assert.equal(classifyCandidate(herChunk('随便')), AUTHORED_BY_HER);
  assert.equal(classifyCandidate(herChunk('x', '/xiaoni-runtime/notes/people/3375477814.md')), AUTHORED_BY_HER);
  assert.equal(classifyCandidate(herChunk('x', '/xiaoni-runtime/notes/topics/nova.md')), AUTHORED_BY_HER);
  assert.equal(classifyCandidate(inbound('Nova')), AUTHORED_BY_PEER);
});

test('她写的:力气越大、写了「当时」那一层、标题具体、有真人 → importance 越高', () => {
  const thin = scoreCandidateImportance(herChunk('## x\n短'), { peerNames: ['Nova'] });
  const rich = scoreCandidateImportance(
    herChunk('## 给陈显写信这件事卡住了\n' + '当时我犹豫了很久,怕的是没有回声。'.repeat(12) + ' Nova 说了一句。'),
    { peerNames: ['Nova'] }
  );
  assert.ok(rich.importance > thin.importance, `rich=${rich.importance} 应高于 thin=${thin.importance}`);
  assert.equal(rich.factors.introspection, 1);
  assert.equal(rich.factors.peer, 1);
});

test('无标题的块落在具体标题和泛标题之间 —— 不吃惩罚,也不占便宜', () => {
  const body = '当时我犹豫了很久,怕的是没有回声。'.repeat(12);
  const specific = scoreCandidateImportance(herChunk(`## 一个很具体的标题在这里\n${body}`), {});
  const none = scoreCandidateImportance(herChunk(body), {});
  const vague = scoreCandidateImportance(herChunk(`## 最后\n${body}`), {});

  assert.equal(none.factors.titleMissing, true);
  assert.equal(specific.factors.titleMissing, false);
  assert.ok(specific.importance > none.importance, '具体标题该赢无标题');
  assert.ok(none.importance > vague.importance, '无标题不该输给「最后」这种泛标题');
});

test('headingOf 只认真的 markdown 标题行', () => {
  assert.equal(headingOf('## 楠楠最短的诗\n正文'), '楠楠最短的诗');
  assert.equal(headingOf('### 三级也算\n正文'), '三级也算');
  assert.equal(headingOf('正文直接开始\n## 后面才有标题'), null, '标题必须在首行');
  assert.equal(headingOf('#没有空格'), null);
});

test('别人写的:建过档案的人 + 私聊 → importance 高;陌生群友 → 0', () => {
  const ctx = { peerNames: ['Nova', '楠楠'] };
  const known = scoreCandidateImportance(inbound('Nova', 'inbound_direct'), ctx);
  const stranger = scoreCandidateImportance(inbound('山雀。', 'inbound_group'), ctx);
  assert.equal(known.importance, 1);
  assert.equal(stranger.importance, 0);
  assert.equal(known.factors.profiledPeer, 1);
});

test('别人写的:不拿 effort/introspection 去量别人的字(那四个因子在 inbound 上实测全塌)', () => {
  const scored = scoreCandidateImportance(inbound('陌生人', 'inbound_direct'), { peerNames: [] });
  assert.deepEqual(Object.keys(scored.factors).sort(), ['direct', 'profiledPeer']);
});

test('分组:两类各自按 importance 排序,不混在一起排', () => {
  const ctx = { peerNames: ['Nova', '楠楠'] };
  const groups = groupCandidatesByAuthor([
    inbound('山雀。', 'inbound_group'),
    herChunk('## 短\n短'),
    inbound('Nova', 'inbound_direct'),
    herChunk('## 一件很具体的事\n' + '当时犹豫了很久。'.repeat(15))
  ], ctx);

  const hers = groups.get(AUTHORED_BY_HER);
  const peers = groups.get(AUTHORED_BY_PEER);
  assert.equal(hers.length, 2);
  assert.equal(peers.length, 2);
  assert.ok(hers[0].importance >= hers[1].importance, '类内降序');
  assert.ok(peers[0].importance >= peers[1].importance, '类内降序');
  // 铁律:分组产物里不存在一个跨类的总排名 —— 调用方拿不到「混在一起的第 1 名」。
  assert.ok(!Array.isArray(groups), 'groupCandidatesByAuthor 必须返回分组,不能返回一个混排数组');
});

test('空输入 / 垃圾输入不炸,且 importance 始终是 [0,1] 内的有限数', () => {
  for (const bad of [null, undefined, {}, { embeddingText: 42 }, { provenance: 'nope' }]) {
    const r = scoreCandidateImportance(bad);
    assert.ok(Number.isFinite(r.importance), `${JSON.stringify(bad)} → ${r.importance}`);
    assert.ok(r.importance >= 0 && r.importance <= 1);
  }
  assert.equal(scoreCandidateImportance(null).klass, AUTHORED_BY_HER);
  assert.equal(groupCandidatesByAuthor(undefined).get(AUTHORED_BY_HER).length, 0);
});

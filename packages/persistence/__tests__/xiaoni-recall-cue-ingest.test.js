'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  buildRecallCueFromActionStreamItem,
  buildRecallCuesFromActionStream
} = require('../xiaoni-passive-recall-extractor');
const { chunkRuntimeFile } = require('../xiaoni-recall-file-chunker');

test('blocklist: operator/debug trace sources are excluded from the corpus', () => {
  for (const source of ['llm_request', 'subconscious_agent_fork', 'compression_fork_item', 'cache_heartbeat']) {
    assert.strictEqual(
      buildRecallCueFromActionStreamItem({ id: 'x', source, title: 't', body: 'b' }),
      null,
      `${source} must not become a cue`
    );
  }
});

test('inversion: any non-operational item with content becomes a uniform cue', () => {
  const cue = buildRecallCueFromActionStreamItem({
    id: 'evt-42',
    source: 'runtime_input',
    kind: 'note',
    title: '标题',
    body: '正文内容',
    timestamp: '2026-07-03T00:00:00Z'
  });
  assert.ok(cue);
  assert.strictEqual(cue.sourceKind, 'action_stream');
  assert.strictEqual(cue.sourceRef, 'evt-42');
  assert.match(cue.embeddingText, /标题[\s\S]*正文内容/);
  assert.strictEqual(cue.occurredAt, '2026-07-03T00:00:00Z');
  assert.strictEqual(cue.contentHash.length, 64);
  assert.ok(cue.provenance.privacyScope);
});

test('no stable ref or no embeddable content → skipped (cannot index / exclude)', () => {
  assert.strictEqual(buildRecallCueFromActionStreamItem({ source: 'runtime_input', body: 'b' }), null, 'missing id');
  assert.strictEqual(buildRecallCueFromActionStreamItem({ id: 'y', source: 'runtime_input' }), null, 'no content');
});

test('lead template derives from provenance: spoken / peer / generic', () => {
  const spoken = buildRecallCueFromActionStreamItem({ id: '1', source: 'timeline', kind: 'send_in_private', body: '我说的话' });
  assert.strictEqual(spoken.provenance.leadTemplate, 'db_spoken_fragment');

  const peer = buildRecallCueFromActionStreamItem({ id: '2', source: 'qq_inbound', kind: 'qq_message', body: '别人说的', senderName: '小K' });
  assert.strictEqual(peer.provenance.leadTemplate, 'peer_message');
  assert.strictEqual(peer.provenance.peer, '小K');

  const generic = buildRecallCueFromActionStreamItem({ id: '3', source: 'runtime_input', kind: 'misc', body: '没有模板的事' });
  assert.strictEqual(generic.provenance.leadTemplate, null);
});

test('buildRecallCuesFromActionStream filters nulls and keeps only real cues', () => {
  const cues = buildRecallCuesFromActionStream([
    { id: 'a', source: 'llm_request', body: 'x' },   // blocked
    { id: 'b', source: 'runtime_input', body: '真事' }, // kept
    { source: 'runtime_input', body: 'no id' }          // skipped
  ]);
  assert.strictEqual(cues.length, 1);
  assert.strictEqual(cues[0].sourceRef, 'b');
});

test('file chunker: splits by heading, points chunks at path#idx, stable content hash', () => {
  const content = [
    '# 我是谁',
    '我是小腻，一个 AI。我认这个身份。',
    '',
    '# 做过的事',
    '帮小K修过一次浏览器桥。还写过很多笔记。'
  ].join('\n');
  const chunks = chunkRuntimeFile({ path: '/xiaoni-runtime/notes/anchor.md', content });
  assert.ok(chunks.length >= 2, 'two headings → at least two chunks');
  assert.strictEqual(chunks[0].sourceRef, '/xiaoni-runtime/notes/anchor.md#0');
  assert.strictEqual(chunks[0].provenance.leadTemplate, 'file_chunk');
  assert.strictEqual(chunks[0].contentHash, chunkRuntimeFile({ path: '/xiaoni-runtime/notes/anchor.md', content })[0].contentHash);
});

test('file chunker: empty / pathless content yields no chunks; long content is hard-cut', () => {
  assert.deepStrictEqual(chunkRuntimeFile({ path: '/p', content: '' }), []);
  assert.deepStrictEqual(chunkRuntimeFile({ path: '/p', content: '   ' }), []);
  const long = 'a'.repeat(3000);
  const chunks = chunkRuntimeFile({ path: '/xiaoni-runtime/notes/big.md', content: long });
  assert.ok(chunks.length >= 3, 'a 3000-char blob is cut into multiple chunks');
  assert.ok(chunks.every((c) => c.embeddingText.length <= 1200));
});

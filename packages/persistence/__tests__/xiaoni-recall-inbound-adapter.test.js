'use strict';

// 入站消息 → recall cue 适配(③「别人说过 X」这条腿)。纯函数,不碰 DB。
//   node --test __tests__/xiaoni-recall-inbound-adapter.test.js
// docs/XIAONI_PASSIVE_RECALL_SHADOW_COMPLETION.md

const test = require('node:test');
const assert = require('node:assert');
const { buildRecallCueFromInboundMessage } = require('../xiaoni-passive-recall-extractor');

test('私聊入站行 → peer_message cue,private_peer,sourceKind=inbound', () => {
  const cue = buildRecallCueFromInboundMessage({
    id: 30611n,
    message_sid: 'sid-abc',
    chat_type: 'private',
    sender_name: '楠楠',
    peer_name: '楠楠',
    body_for_agent: '晚上一起吃葱油面吗',
    message_timestamp: new Date('2026-07-06T12:00:00Z')
  });
  assert.ok(cue, '应产出 cue');
  assert.strictEqual(cue.sourceKind, 'inbound');
  assert.strictEqual(cue.sourceRef, 'inbound:30611');
  assert.strictEqual(cue.provenance.leadTemplate, 'peer_message');
  assert.strictEqual(cue.provenance.privacyScope, 'private_peer');
  assert.strictEqual(cue.provenance.peer, '楠楠');
  assert.strictEqual(cue.provenance.kind, 'inbound_private');
  assert.strictEqual(cue.embeddingText, '晚上一起吃葱油面吗');
  assert.strictEqual(cue.occurredAt, '2026-07-06T12:00:00.000Z');
  assert.match(cue.contentHash, /^[0-9a-f]{64}$/);
});

test('群聊入站行 → group 隐私域 + inbound_group', () => {
  const cue = buildRecallCueFromInboundMessage({
    id: 42,
    chat_type: 'group',
    sender_name: '小K',
    body_for_agent: '这个壳子柜子的原型我做完了',
    received_at: '2026-07-05T08:00:00Z'
  });
  assert.ok(cue);
  assert.strictEqual(cue.provenance.privacyScope, 'group');
  assert.strictEqual(cue.provenance.kind, 'inbound_group');
  assert.strictEqual(cue.sourceRef, 'inbound:42');
});

test('无可嵌正文(纯图片/空)→ null', () => {
  assert.strictEqual(buildRecallCueFromInboundMessage({ id: 1, chat_type: 'private', body_for_agent: '   ' }), null);
  assert.strictEqual(buildRecallCueFromInboundMessage({ id: 2, chat_type: 'private' }), null);
});

test('无稳定引用(无 id/message_sid)→ null', () => {
  assert.strictEqual(buildRecallCueFromInboundMessage({ chat_type: 'private', body_for_agent: '有内容但没 id' }), null);
});

test('非对象 → null', () => {
  assert.strictEqual(buildRecallCueFromInboundMessage(null), null);
  assert.strictEqual(buildRecallCueFromInboundMessage('x'), null);
});

test('contentHash 对同一正文确定,不同正文不同', () => {
  const a = buildRecallCueFromInboundMessage({ id: 1, chat_type: 'private', body_for_agent: '一样的话' });
  const b = buildRecallCueFromInboundMessage({ id: 2, chat_type: 'private', body_for_agent: '一样的话' });
  const c = buildRecallCueFromInboundMessage({ id: 3, chat_type: 'private', body_for_agent: '不一样的话' });
  assert.strictEqual(a.contentHash, b.contentHash);
  assert.notStrictEqual(a.contentHash, c.contentHash);
});

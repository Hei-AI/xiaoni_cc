import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNapcatInboundContext,
  RecentMessageCache,
  rememberInboundContext,
} from '../agent-im-input-adapter';

const BOT_ID = '1129974489';

test('builds private inbound context from plain text message', () => {
  const inboundContext = buildNapcatInboundContext({
    event: {
      post_type: 'message',
      message_type: 'private',
      self_id: Number(BOT_ID),
      user_id: 85178516,
      message_id: 1001,
      raw_message: '测试私聊'
    },
    fallbackBotAccountId: BOT_ID
  });

  assert.ok(inboundContext);
  assert.equal(inboundContext.ChatType, 'direct');
  assert.equal(inboundContext.SessionKey, `qq:direct:${BOT_ID}:85178516`);
  assert.equal(inboundContext.BodyForAgent, '测试私聊');
  assert.equal(inboundContext.RawBody, '测试私聊');
  assert.equal(inboundContext.CommandBody, '测试私聊');
  assert.equal(inboundContext.From, 'qq:85178516');
  assert.equal(inboundContext.To, 'user:85178516');
});

test('detects group mention and strips bot mention from command body', () => {
  const inboundContext = buildNapcatInboundContext({
    event: {
      post_type: 'message',
      message_type: 'group',
      self_id: Number(BOT_ID),
      user_id: 85178516,
      group_id: 1019235326,
      message_id: 1002,
      raw_message: '[CQ:at,qq=1129974489] 你好',
      message: [
        { type: 'at', data: { qq: BOT_ID, name: '小腻' } },
        { type: 'text', data: { text: ' 你好' } }
      ]
    },
    fallbackBotAccountId: BOT_ID
  });

  assert.ok(inboundContext);
  assert.equal(inboundContext.ChatType, 'group');
  assert.equal(inboundContext.SessionKey, 'qq:group:1019235326');
  assert.equal(inboundContext.WasMentioned, true);
  assert.equal(inboundContext.BodyForAgent, '@小腻 你好');
  assert.equal(inboundContext.CommandBody, '你好');
});

test('fills reply fields from recent message cache and treats replies to bot as mentions', () => {
  const cache = new RecentMessageCache();
  const original = buildNapcatInboundContext({
    event: {
      post_type: 'message',
      message_type: 'group',
      self_id: Number(BOT_ID),
      user_id: Number(BOT_ID),
      group_id: 1019235326,
      message_id: 9001,
      raw_message: '原消息内容',
      message: [{ type: 'text', data: { text: '原消息内容' } }]
    },
    fallbackBotAccountId: BOT_ID
  });

  assert.ok(original);
  rememberInboundContext(cache, original);

  const inboundContext = buildNapcatInboundContext({
    event: {
      post_type: 'message',
      message_type: 'group',
      self_id: Number(BOT_ID),
      user_id: 85178516,
      group_id: 1019235326,
      message_id: 1003,
      raw_message: '[CQ:reply,id=9001]收到',
      message: [
        { type: 'reply', data: { id: 9001 } },
        { type: 'text', data: { text: '收到' } }
      ]
    },
    fallbackBotAccountId: BOT_ID,
    replyCache: cache
  });

  assert.ok(inboundContext);
  assert.equal(inboundContext.WasMentioned, true);
  assert.equal(inboundContext.ReplyToId, '9001');
  assert.equal(inboundContext.ReplyToBody, '原消息内容');
  assert.equal(inboundContext.ReplyToSender, BOT_ID);
  assert.equal(inboundContext.ReplyToIsQuote, true);
});

test('maps media-only messages to AI-readable placeholders and media fields', () => {
  const inboundContext = buildNapcatInboundContext({
    event: {
      post_type: 'message',
      message_type: 'group',
      self_id: Number(BOT_ID),
      user_id: 85178516,
      group_id: 1019235326,
      message_id: 1004,
      message: [
        { type: 'image', data: { file: 'cat.png', url: 'https://example.com/cat.png', mime: 'image/png' } },
        { type: 'file', data: { name: 'notes.txt', url: 'https://example.com/notes.txt', mime: 'text/plain' } }
      ]
    },
    fallbackBotAccountId: BOT_ID
  });

  assert.ok(inboundContext);
  assert.equal(inboundContext.BodyForAgent, '[Image][File: notes.txt]');
  assert.equal(inboundContext.CommandBody, '');
  assert.deepEqual(inboundContext.MediaPaths, [
    'https://example.com/cat.png',
    'https://example.com/notes.txt'
  ]);
  assert.deepEqual(inboundContext.MediaTypes, ['image/png', 'text/plain']);
});

test('returns null for unsupported post types', () => {
  const inboundContext = buildNapcatInboundContext({
    event: {
      post_type: 'notice'
    },
    fallbackBotAccountId: BOT_ID
  });

  assert.equal(inboundContext, null);
});

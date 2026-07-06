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
  assert.equal(inboundContext.ReplyToSenderId, BOT_ID);
  assert.equal(inboundContext.ReplyToSenderName, BOT_ID);
  assert.equal(inboundContext.ReplyToIsQuote, true);
});

test('resolves reply from raw.elements[].replyElement when OneBot message[] omits the reply segment (30611 shape)', () => {
  const inboundContext = buildNapcatInboundContext({
    event: {
      post_type: 'message',
      message_type: 'private',
      self_id: Number(BOT_ID),
      user_id: 85178516,
      message_id: 1446580943,
      sender: { user_id: 85178516, nickname: '李阿花' },
      raw_message: '这个',
      message: [{ type: 'text', data: { text: '这个' } }],
      raw: {
        msgId: '7659245918938143285',
        records: [{
          msgId: '7659245918938143286',
          senderUin: BOT_ID,
          sendNickName: '小腻',
          elements: [{ elementType: 1, textElement: { content: '找到了 identity-anchor里写得清清楚楚的' } }]
        }],
        elements: [
          {
            elementType: 7,
            replyElement: {
              senderUid: BOT_ID,
              sourceMsgIdInRecords: '7659245918938143286',
              replayMsgSeq: '3446',
              sourceMsgTextElems: [{ textElemContent: '找到了 identity-anchor里写得清清楚楚的' }]
            }
          },
          { elementType: 1, textElement: { content: '这个' } }
        ]
      }
    },
    fallbackBotAccountId: BOT_ID
  } as any);

  assert.ok(inboundContext);
  assert.equal(inboundContext.ReplyToId, undefined); // OneBot message[] carried no reply id
  assert.equal(inboundContext.ReplyToBody, '找到了 identity-anchor里写得清清楚楚的');
  assert.equal(inboundContext.ReplyToSender, '小腻'); // joined from raw.records[].sendNickName, not the bare uid
  assert.equal(inboundContext.NativeReplyMsgId, '7659245918938143286');
  assert.equal(inboundContext.NativeReplyMsgSeq, '3446'); // bridges to OneBot id via history real_seq
  assert.equal(inboundContext.NativeMsgId, '7659245918938143285');
  assert.equal(inboundContext.ReplyToIsQuote, true);
});

test('raw-only reply quoting the bot in a group marks WasMentioned (wake fix, id 29876 shape)', () => {
  const inboundContext = buildNapcatInboundContext({
    event: {
      post_type: 'message',
      message_type: 'group',
      self_id: Number(BOT_ID),
      user_id: 3627938985,
      group_id: 253631878,
      message_id: 999001,
      sender: { user_id: 3627938985, nickname: '路人' },
      raw_message: '四条腿走进华强北',
      message: [{ type: 'text', data: { text: '四条腿走进华强北' } }],
      raw: {
        msgId: 'ntq-reply-self',
        records: [{ msgId: 'quoted-1', senderUin: BOT_ID, sendNickName: '小腻', elements: [{ elementType: 1, textElement: { content: '原话' } }] }],
        elements: [
          { elementType: 7, replyElement: { senderUid: BOT_ID, sourceMsgIdInRecords: 'quoted-1', sourceMsgTextElems: [{ textElemContent: '原话' }] } },
          { elementType: 1, textElement: { content: '四条腿走进华强北' } }
        ]
      }
    },
    fallbackBotAccountId: BOT_ID
  } as any);

  assert.ok(inboundContext);
  assert.equal(inboundContext.WasMentioned, true); // quoting the bot must wake her, even raw-only
  assert.equal(inboundContext.NativeReplyMsgId, 'quoted-1');
  assert.equal(inboundContext.ReplyToIsQuote, true);
});

test('uses raw payload mention nicknames when segment payload does not include a label', () => {
  const inboundContext = buildNapcatInboundContext({
    event: {
      post_type: 'message',
      message_type: 'group',
      self_id: Number(BOT_ID),
      user_id: 870853294,
      group_id: 1019235326,
      message_id: 1005,
      raw_message: '[CQ:at,qq=714457117] 你喜欢玩魔兽3？',
      raw: {
        elements: [
          {
            textElement: {
              atUid: '714457117',
              content: '@小镜'
            }
          }
        ]
      },
      message: [
        { type: 'at', data: { qq: '714457117' } },
        { type: 'text', data: { text: ' 你喜欢玩魔兽3？' } }
      ]
    },
    fallbackBotAccountId: BOT_ID
  });

  assert.ok(inboundContext);
  assert.equal(inboundContext.BodyForAgent, '@小镜 你喜欢玩魔兽3？');
  assert.deepEqual(inboundContext.MentionedUsers, [
    {
      userId: '714457117',
      label: '小镜'
    }
  ]);
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
  assert.deepEqual(inboundContext.MediaAssets, [
    {
      mediaTag: 'image_1',
      placeholder: '[Image]',
      mediaType: 'image',
      mimeType: 'image/png',
      locator: 'https://example.com/cat.png',
      fileId: 'cat.png',
      fileName: 'cat.png',
      messageSid: '1004'
    },
    {
      mediaTag: 'file_2',
      placeholder: '[File: notes.txt]',
      mediaType: 'file',
      mimeType: 'text/plain',
      locator: 'https://example.com/notes.txt',
      messageSid: '1004',
      fileName: 'notes.txt'
    }
  ]);
});

test('captures the NapCat file handle for images so a 400ing CDN url can fall back to getFile', () => {
  // Regression: the failing image carried only a gchat.qpic.cn url (which 400s on
  // our bare fetch even with a fresh rkey) plus a NapCat cache name in `data.file`.
  // Without capturing that name as fileId, resolveInboundMediaBytes could never
  // reach napcatClient.getFile(<name>) and the image stayed unmaterialized →
  // later "图过期看不到".
  const inboundContext = buildNapcatInboundContext({
    event: {
      post_type: 'message',
      message_type: 'private',
      self_id: Number(BOT_ID),
      user_id: 2294133947,
      message_id: 2001,
      message: [
        {
          type: 'image',
          data: {
            file: 'D16171879F5B110556880C9C837B7905.webp',
            url: 'https://gchat.qpic.cn/download?appid=1406&fileid=EhR&rkey=CAQ&spec=0',
            file_size: '1257736'
          }
        }
      ]
    },
    fallbackBotAccountId: BOT_ID
  });

  assert.ok(inboundContext);
  assert.deepEqual(inboundContext.MediaAssets, [
    {
      mediaTag: 'image_1',
      placeholder: '[Image]',
      mediaType: 'image',
      mimeType: 'image/*',
      locator: 'https://gchat.qpic.cn/download?appid=1406&fileid=EhR&rkey=CAQ&spec=0',
      fileId: 'D16171879F5B110556880C9C837B7905.webp',
      fileName: 'D16171879F5B110556880C9C837B7905.webp',
      messageSid: '2001'
    }
  ]);
});

test('treats image-like QQ file segments as image placeholders with file metadata', () => {
  const inboundContext = buildNapcatInboundContext({
    event: {
      post_type: 'message',
      message_type: 'group',
      self_id: Number(BOT_ID),
      user_id: 85178516,
      group_id: 1019235326,
      message_id: 1006,
      message: [
        {
          type: 'file',
          data: {
            file: 'rain.png',
            file_id: '/tmp/rain-file-id',
            file_size: '1810231',
            url: 'https://example.com/rain-download'
          }
        }
      ]
    },
    fallbackBotAccountId: BOT_ID
  });

  assert.ok(inboundContext);
  assert.equal(inboundContext.BodyForAgent, '[Image]');
  assert.deepEqual(inboundContext.MediaAssets, [
    {
      mediaTag: 'image_1',
      placeholder: '[Image]',
      mediaType: 'image',
      mimeType: 'image/png',
      locator: 'https://example.com/rain-download',
      messageSid: '1006',
      fileId: '/tmp/rain-file-id',
      fileName: 'rain.png',
      fileSize: '1810231'
    }
  ]);
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

test('renders xml segment with title and url as card text', () => {
  const ctx = buildNapcatInboundContext({
    event: {
      post_type: 'message',
      message_type: 'private',
      self_id: Number(BOT_ID),
      user_id: 85178516,
      message_id: 2001,
      message: [{ type: 'xml', data: { data: '<xml><title>周杰伦 - 晴天</title><url>https://music.163.com/song/186016</url></xml>' } }]
    },
    fallbackBotAccountId: BOT_ID
  });
  assert.ok(ctx);
  assert.equal(ctx.BodyForAgent, '[卡片] 周杰伦 - 晴天 https://music.163.com/song/186016');
});

test('renders xml segment without url', () => {
  const ctx = buildNapcatInboundContext({
    event: {
      post_type: 'message',
      message_type: 'private',
      self_id: Number(BOT_ID),
      user_id: 85178516,
      message_id: 2002,
      message: [{ type: 'xml', data: { data: '<xml><title>位置分享</title></xml>' } }]
    },
    fallbackBotAccountId: BOT_ID
  });
  assert.ok(ctx);
  assert.equal(ctx.BodyForAgent, '[卡片] 位置分享');
});

test('renders xml segment with empty data as fallback', () => {
  const ctx = buildNapcatInboundContext({
    event: {
      post_type: 'message',
      message_type: 'private',
      self_id: Number(BOT_ID),
      user_id: 85178516,
      message_id: 2003,
      message: [{ type: 'xml', data: { data: '' } }]
    },
    fallbackBotAccountId: BOT_ID
  });
  assert.equal(ctx, null);
});

test('renders share segment with title and url as link text', () => {
  const ctx = buildNapcatInboundContext({
    event: {
      post_type: 'message',
      message_type: 'private',
      self_id: Number(BOT_ID),
      user_id: 85178516,
      message_id: 2004,
      message: [{ type: 'share', data: { title: '看这篇文章', url: 'https://example.com/article' } }]
    },
    fallbackBotAccountId: BOT_ID
  });
  assert.ok(ctx);
  assert.equal(ctx.BodyForAgent, '[链接] 看这篇文章 https://example.com/article');
});

test('renders share segment with url only', () => {
  const ctx = buildNapcatInboundContext({
    event: {
      post_type: 'message',
      message_type: 'private',
      self_id: Number(BOT_ID),
      user_id: 85178516,
      message_id: 2005,
      message: [{ type: 'share', data: { url: 'https://example.com' } }]
    },
    fallbackBotAccountId: BOT_ID
  });
  assert.ok(ctx);
  assert.equal(ctx.BodyForAgent, '[链接] https://example.com');
});

test('returns null for share segment with no url and no title', () => {
  const ctx = buildNapcatInboundContext({
    event: {
      post_type: 'message',
      message_type: 'private',
      self_id: Number(BOT_ID),
      user_id: 85178516,
      message_id: 2006,
      message: [{ type: 'share', data: {} }]
    },
    fallbackBotAccountId: BOT_ID
  });
  assert.equal(ctx, null);
});

// 124 之谜:经典 QQ 表情的 data.raw.faceText 为空,NapCat 只回传裸数字 id。
// 接收端(小腻)以前只看到 "124",无法解码。现在靠静态权威表还原成 [OK]/[笑哭]。
test('decodes classic face id to name when faceText is empty', () => {
  const ctx = buildNapcatInboundContext({
    event: {
      post_type: 'message',
      message_type: 'private',
      self_id: Number(BOT_ID),
      user_id: 85178516,
      message_id: 2101,
      message: [
        { type: 'text', data: { text: '在吗' } },
        { type: 'face', data: { id: '124', raw: { faceText: '', faceIndex: 124 } } },
        { type: 'face', data: { id: '182', raw: { faceText: null } } }
      ]
    },
    fallbackBotAccountId: BOT_ID
  });
  assert.ok(ctx);
  assert.equal(ctx.RawBody, '在吗[OK][笑哭]');
});

// 新表情:NapCat 回填 data.raw.faceText(带前导 '/'),优先直接采用。
test('decodes new-style face from raw.faceText, stripping the leading slash', () => {
  const ctx = buildNapcatInboundContext({
    event: {
      post_type: 'message',
      message_type: 'private',
      self_id: Number(BOT_ID),
      user_id: 85178516,
      message_id: 2102,
      message: [{ type: 'face', data: { id: '265', raw: { faceText: '/辣眼睛' } } }]
    },
    fallbackBotAccountId: BOT_ID
  });
  assert.ok(ctx);
  assert.equal(ctx.RawBody, '[辣眼睛]');
});

// 未知 id(表里没有、faceText 也空):给带标签占位,绝不再露裸数字。
test('unknown face id renders labeled placeholder, never a bare number', () => {
  const ctx = buildNapcatInboundContext({
    event: {
      post_type: 'message',
      message_type: 'private',
      self_id: Number(BOT_ID),
      user_id: 85178516,
      message_id: 2103,
      message: [{ type: 'face', data: { id: '99999', raw: { faceText: '' } } }]
    },
    fallbackBotAccountId: BOT_ID
  });
  assert.ok(ctx);
  assert.equal(ctx.RawBody, '[表情:99999]');
});

// 字符串 CQ 码回退路径:以前一律拍成 [Emoji],现在也按 id 查表。
test('decodes face from raw CQ-code fallback path', () => {
  const ctx = buildNapcatInboundContext({
    event: {
      post_type: 'message',
      message_type: 'private',
      self_id: Number(BOT_ID),
      user_id: 85178516,
      message_id: 2104,
      raw_message: '收到[CQ:face,id=124]'
    },
    fallbackBotAccountId: BOT_ID
  });
  assert.ok(ctx);
  assert.equal(ctx.RawBody, '收到[OK]');
});

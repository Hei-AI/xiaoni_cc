import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGroupMessageText,
  normalizeImageFileReference,
  encodeOutboundFaces,
  encodeCaptionSegments,
  buildImageMessage,
} from '../napcat-client';
import { QQ_FACE_IDS, QQ_FACE_NAMES } from '../../data/qq-face-names';

test('buildGroupMessageText returns plain text when no mentions are provided', () => {
  assert.equal(buildGroupMessageText('  你好  '), '你好');
});

test('buildGroupMessageText prepends unique CQ mentions', () => {
  assert.equal(
    buildGroupMessageText('大家看这里', [123, '456', 123]),
    '[CQ:at,qq=123] [CQ:at,qq=456] 大家看这里'
  );
});

test('buildGroupMessageText rejects empty text', () => {
  assert.throws(
    () => buildGroupMessageText('   ', [123]),
    /Group message text cannot be empty/
  );
});

test('buildGroupMessageText rejects invalid mention ids', () => {
  assert.throws(
    () => buildGroupMessageText('你好', [Number.NaN]),
    /Invalid mention user id/
  );
});

test('normalizeImageFileReference converts data URLs to OneBot base64 refs', () => {
  assert.equal(
    normalizeImageFileReference('data:image/png;base64,abc123'),
    'base64://abc123'
  );
  assert.equal(
    normalizeImageFileReference('https://example.com/cat.png'),
    'https://example.com/cat.png'
  );
});

// 出站表情编码:小腻写 [表情:名字] → 真 QQ 系统表情 CQ 码。
test('encodeOutboundFaces converts the explicit face sigil to a face CQ code', () => {
  assert.equal(encodeOutboundFaces('解出来了[表情:笑哭] 你看'), '解出来了[CQ:face,id=182] 你看');
  assert.equal(encodeOutboundFaces('[表情:OK]'), '[CQ:face,id=124]');
});

test('encodeOutboundFaces handles multiple sigils in one message', () => {
  assert.equal(
    encodeOutboundFaces('[表情:辣眼睛]看到没[表情:吃瓜]'),
    '[CQ:face,id=265]看到没[CQ:face,id=271]'
  );
});

// 关键回归:防误编码。裸字面文本(尤其 ASCII 名 OK/666)绝不能被当成表情。
test('encodeOutboundFaces leaves bare bracketed literals untouched (no false positive)', () => {
  assert.equal(encodeOutboundFaces('[OK] 我改完了'), '[OK] 我改完了');
  assert.equal(encodeOutboundFaces('版本号 [666] 已发布'), '版本号 [666] 已发布');
  assert.equal(encodeOutboundFaces('他发的[笑哭]是什么意思'), '他发的[笑哭]是什么意思');
});

test('encodeOutboundFaces leaves existing CQ codes and unknown names alone', () => {
  assert.equal(encodeOutboundFaces('已经是[CQ:face,id=124]了'), '已经是[CQ:face,id=124]了');
  assert.equal(encodeOutboundFaces('[表情:根本不存在的名字]'), '[表情:根本不存在的名字]');
  assert.equal(encodeOutboundFaces(''), '');
});

// 群消息:正文表情被编码,@ 前缀照常在前,互不吞。
test('buildGroupMessageText encodes face sigils in the body alongside mentions', () => {
  assert.equal(
    buildGroupMessageText('收到[表情:笑哭]', [123]),
    '[CQ:at,qq=123] 收到[CQ:face,id=182]'
  );
});

// 图片 caption 路(数组消息):表情记号拆成真 face 段,不能靠 CQ 码。与文字路行为一致。
test('encodeCaptionSegments splits face sigils into face segments interleaved with text', () => {
  assert.deepEqual(encodeCaptionSegments('看这个[表情:笑哭]好可爱'), [
    { type: 'text', data: { text: '看这个' } },
    { type: 'face', data: { id: '182' } },
    { type: 'text', data: { text: '好可爱' } }
  ]);
});

test('encodeCaptionSegments handles a caption that is only a face', () => {
  assert.deepEqual(encodeCaptionSegments('[表情:汪汪]'), [
    { type: 'face', data: { id: '277' } }
  ]);
});

test('encodeCaptionSegments also converts raw CQ face codes to segments (array text is literal)', () => {
  assert.deepEqual(encodeCaptionSegments('收到[CQ:face,id=124]'), [
    { type: 'text', data: { text: '收到' } },
    { type: 'face', data: { id: '124' } }
  ]);
});

test('encodeCaptionSegments keeps plain text, unicode emoji, and unknown names literal', () => {
  assert.deepEqual(encodeCaptionSegments('配个😂就行'), [
    { type: 'text', data: { text: '配个😂就行' } }
  ]);
  assert.deepEqual(encodeCaptionSegments('[表情:根本不存在]'), [
    { type: 'text', data: { text: '[表情:根本不存在]' } }
  ]);
});

// 整条图片消息:image 段 + caption 拆出的 face/text 段。
test('buildImageMessage emits a face segment for a caption sigil', () => {
  assert.deepEqual(buildImageMessage('base64://abc', '给你[表情:笑哭]'), [
    { type: 'image', data: { file: 'base64://abc' } },
    { type: 'text', data: { text: '给你' } },
    { type: 'face', data: { id: '182' } }
  ]);
});

test('buildImageMessage with a plain caption is unchanged (single text segment)', () => {
  assert.deepEqual(buildImageMessage('base64://abc', '  纯文字说明  '), [
    { type: 'image', data: { file: 'base64://abc' } },
    { type: 'text', data: { text: '纯文字说明' } }
  ]);
});

// 反表由正表反转而来,单一真理源:每个名字都能往返回自身。
test('QQ_FACE_IDS is a faithful inverse of QQ_FACE_NAMES', () => {
  assert.equal(QQ_FACE_IDS['笑哭'], '182');
  assert.equal(QQ_FACE_IDS['OK'], '124');
  for (const [id, name] of Object.entries(QQ_FACE_NAMES)) {
    const mappedId = QQ_FACE_IDS[name];
    assert.ok(mappedId !== undefined, `name ${name} missing from reverse map`);
    assert.equal(QQ_FACE_NAMES[mappedId], name, `round-trip broken for ${name}`);
  }
});

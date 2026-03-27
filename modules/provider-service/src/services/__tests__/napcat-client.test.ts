import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroupMessageText } from '../napcat-client';

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

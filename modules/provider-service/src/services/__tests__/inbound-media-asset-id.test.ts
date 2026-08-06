import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildInboundMediaAssetId,
  buildInboundMediaAssetScopeKey
} from '../inbound-media-asset-id';

const CONTENT_HASH = 'a'.repeat(64);
const OTHER_CONTENT_HASH = 'b'.repeat(64);

test('re-sending the same image under a new message yields a distinct row id', () => {
  // The regression: a repost used to reuse the first message's content-derived id, which
  // collided on the AgentMediaAsset primary key and aborted ingest before notify.
  const first = buildInboundMediaAssetId(CONTENT_HASH, buildInboundMediaAssetScopeKey('msg-1', 'image_1'));
  const repost = buildInboundMediaAssetId(CONTENT_HASH, buildInboundMediaAssetScopeKey('msg-2', 'image_1'));
  assert.notEqual(first, repost);
});

test('same message and tag is stable, so re-delivery upserts instead of duplicating', () => {
  const scope = buildInboundMediaAssetScopeKey('msg-1', 'image_1');
  assert.equal(
    buildInboundMediaAssetId(CONTENT_HASH, scope),
    buildInboundMediaAssetId(CONTENT_HASH, scope)
  );
});

test('two attachments on one message get distinct ids', () => {
  const one = buildInboundMediaAssetId(CONTENT_HASH, buildInboundMediaAssetScopeKey('msg-1', 'image_1'));
  const two = buildInboundMediaAssetId(CONTENT_HASH, buildInboundMediaAssetScopeKey('msg-1', 'image_2'));
  assert.notEqual(one, two);
});

test('different content on the same message stays distinct', () => {
  const scope = buildInboundMediaAssetScopeKey('msg-1', 'image_1');
  assert.notEqual(
    buildInboundMediaAssetId(CONTENT_HASH, scope),
    buildInboundMediaAssetId(OTHER_CONTENT_HASH, scope)
  );
});

test('id stays within the VarChar(64) column and the agent-side id pattern', () => {
  const id = buildInboundMediaAssetId(CONTENT_HASH, buildInboundMediaAssetScopeKey('msg-1', 'image_1'));
  assert.ok(id.length <= 64, `id too long for VarChar(64): ${id.length}`);
  // Mirrors MEDIA_ASSET_ID_PATTERN in agent-loop-service; a miss here means 小腻 can no
  // longer recognise the string as an asset handle.
  assert.match(id, /^media_[a-zA-Z0-9_-]+$/);
});

test('falls back to the plain content hash when the message scope is unknown', () => {
  assert.equal(
    buildInboundMediaAssetId(CONTENT_HASH, buildInboundMediaAssetScopeKey(null, null)),
    buildInboundMediaAssetId(CONTENT_HASH, '')
  );
});

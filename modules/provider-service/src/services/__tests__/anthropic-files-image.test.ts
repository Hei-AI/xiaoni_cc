import test from 'node:test';
import assert from 'node:assert/strict';
import { translateCanonicalToMessages } from '../llm-provider/anthropic-translate';
import type { OpenResponseCreateRequest } from '../llm-provider/types';

// Wire-side contract for Files API image externalization: when a canonical input_image carries
// an `anthropic_file_id`, the Anthropic messages body must emit a {type:'file',file_id} image
// source (~60 bytes) instead of the base64 — while the item KEEPS image_url as the durable
// fallback (double store). No file_id → base64/url as before. This is a pure per-item read of the
// canonical, so live build / stack replay / every fork clone reconstruct byte-identical.

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function requestWithImage(part: Record<string, unknown>): OpenResponseCreateRequest {
  return {
    model: 'claude-opus-4-6',
    instructions: 'sys',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [part as never, { type: 'input_text', text: 'look' } as never]
      }
    ]
  } as unknown as OpenResponseCreateRequest;
}

function firstImageBlock(body: ReturnType<typeof translateCanonicalToMessages>['body']) {
  for (const msg of body.messages) {
    for (const block of msg.content) {
      if (block.type === 'image') return block;
    }
  }
  return null;
}

test('input_image with anthropic_file_id → wire emits a Files API file source', () => {
  const { body } = translateCanonicalToMessages(
    requestWithImage({ type: 'input_image', image_url: TINY_PNG, anthropic_file_id: 'file_abc123' })
  );
  const img = firstImageBlock(body);
  assert.ok(img, 'expected an image block');
  assert.deepEqual(img!.source, { type: 'file', file_id: 'file_abc123' });
  // The tiny file reference must NOT carry the base64 on the wire.
  assert.ok(!JSON.stringify(img).includes('base64'), 'file source must not inline base64');
});

test('input_image without anthropic_file_id → wire falls back to base64 (unchanged)', () => {
  const { body } = translateCanonicalToMessages(
    requestWithImage({ type: 'input_image', image_url: TINY_PNG })
  );
  const img = firstImageBlock(body);
  assert.ok(img, 'expected an image block');
  assert.equal((img!.source as { type: string }).type, 'base64');
  assert.equal((img!.source as { media_type: string }).media_type, 'image/png');
});

test('empty/whitespace anthropic_file_id → falls back to base64 (never emits a bogus file source)', () => {
  const { body } = translateCanonicalToMessages(
    requestWithImage({ type: 'input_image', image_url: TINY_PNG, anthropic_file_id: '' })
  );
  const img = firstImageBlock(body);
  assert.ok(img, 'expected an image block');
  assert.equal((img!.source as { type: string }).type, 'base64');
});

test('the wire file source is byte-identical across repeated builds (replay/fork cache safety)', () => {
  const req = requestWithImage({ type: 'input_image', image_url: TINY_PNG, anthropic_file_id: 'file_stable' });
  const a = JSON.stringify(translateCanonicalToMessages(req).body);
  const b = JSON.stringify(translateCanonicalToMessages(req).body);
  assert.equal(a, b);
});

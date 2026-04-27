import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIImageProvider } from '../image-provider/openai-image-provider';
import {
  ImageProviderError,
  normalizeEditImages,
  normalizeImageApiResponse,
  normalizeImageOptions
} from '../image-provider/validation';

test('image provider normalizes valid gpt-image-2 generation options', () => {
  const options = normalizeImageOptions({
    prompt: 'draw a quiet terminal workspace',
    size: '1024x1536',
    quality: 'high',
    format: 'webp',
    output_compression: 70,
    background: 'opaque',
    n: 2
  });

  assert.deepEqual(options, {
    model: 'gpt-image-2',
    prompt: 'draw a quiet terminal workspace',
    size: '1024x1536',
    quality: 'high',
    format: 'webp',
    background: 'opaque',
    output_compression: 70,
    n: 2
  });
});

test('image provider rejects unsupported gpt-image-2 parameters', () => {
  assert.throws(
    () => normalizeImageOptions({ prompt: 'x', background: 'transparent' }),
    /does not support transparent/
  );
  assert.throws(
    () => normalizeImageOptions({ prompt: 'x', format: 'png', output_compression: 50 }),
    /only supported for jpeg and webp/
  );
  assert.throws(
    () => normalizeImageOptions({ prompt: 'x', size: '1000x1000' }),
    /multiples of 16px/
  );
  assert.throws(
    () => normalizeImageOptions({ prompt: 'x', size: '4096x1024' }),
    /maximum edge/
  );
});

test('image provider normalizes base64 and data URL edit inputs', () => {
  const pngOnePixel = 'iVBORw0KGgo=';
  const images = normalizeEditImages({
    prompt: 'edit this',
    image: {
      data_url: `data:image/png;base64,${pngOnePixel}`,
      filename: 'source.png'
    }
  });

  assert.equal(images.length, 1);
  assert.equal(images[0].mimeType, 'image/png');
  assert.equal(images[0].filename, 'source.png');
  assert.equal(images[0].buffer.equals(Buffer.from(pngOnePixel, 'base64')), true);
});

test('image provider rejects invalid edit image data', () => {
  assert.throws(
    () => normalizeEditImages({ prompt: 'edit this', image: 'not base64' }),
    ImageProviderError
  );
});

test('image provider response exposes normalized data URLs without raw upstream payload', () => {
  const images = normalizeImageApiResponse({
    data: [
      {
        b64_json: 'aGVsbG8=',
        revised_prompt: 'revised'
      }
    ]
  }, 'jpeg');

  assert.equal(images.length, 1);
  assert.equal(images[0]?.data_url, 'data:image/jpeg;base64,aGVsbG8=');
  assert.equal((images[0] as any).b64_json, undefined);
  assert.equal(images[0]?.bytes_estimate, 5);
});

test('OpenAI image provider maps public format to Image API output_format', () => {
  const provider = new OpenAIImageProvider({ apiKey: 'test-key' });
  const payload = provider.buildImagePayload(normalizeImageOptions({
    prompt: 'draw this',
    format: 'jpeg',
    output_compression: 40
  }));

  assert.equal(payload.output_format, 'jpeg');
  assert.equal((payload as any).format, undefined);
  assert.equal(payload.output_compression, 40);
});

test('Codex image response parser exposes moderation errors from SSE error events', async () => {
  const provider = new OpenAIImageProvider({ apiKey: 'test-key' });
  const responseBody = [
    'event: response.output_item.added',
    'data: {"type":"response.output_item.added","item":{"type":"image_generation_call","status":"in_progress"}}',
    '',
    'event: error',
    'data: {"type":"error","error":{"type":"image_generation_user_error","code":"moderation_blocked","message":"request rejected by safety system"}}',
    '',
    'event: response.failed',
    'data: {"type":"response.failed","response":{"status":"failed","error":{"code":"moderation_blocked","message":"fallback message"}}}',
    ''
  ].join('\n');

  await assert.rejects(
    () => (provider as any).parseCodexResponsesResponse({
      ok: true,
      status: 200,
      text: async () => responseBody
    }),
    (error: any) => {
      assert.equal(error instanceof ImageProviderError, true);
      assert.equal(error.message, 'request rejected by safety system');
      assert.equal(error.statusCode, 400);
      return true;
    }
  );
});

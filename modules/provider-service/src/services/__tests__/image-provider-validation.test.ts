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

test('Codex image provider uses a dedicated supported wrapper model by default', () => {
  const provider = new OpenAIImageProvider({ apiKey: 'test-key' });
  const originalImageModel = process.env.IMAGE_PROVIDER_CODEX_RESPONSE_MODEL;
  delete process.env.IMAGE_PROVIDER_CODEX_RESPONSE_MODEL;

  try {
    const payload = (provider as any).buildCodexResponsesPayload(
      normalizeImageOptions({ prompt: 'draw this' }),
      []
    );

    assert.equal(payload.model, 'gpt-5.5');
    assert.equal(payload.tools[0].model, 'gpt-image-2');
  } finally {
    if (originalImageModel === undefined) {
      delete process.env.IMAGE_PROVIDER_CODEX_RESPONSE_MODEL;
    } else {
      process.env.IMAGE_PROVIDER_CODEX_RESPONSE_MODEL = originalImageModel;
    }
  }
});

test('Codex image provider allows an explicit wrapper model override', () => {
  const provider = new OpenAIImageProvider({ apiKey: 'test-key' });
  const originalImageModel = process.env.IMAGE_PROVIDER_CODEX_RESPONSE_MODEL;
  process.env.IMAGE_PROVIDER_CODEX_RESPONSE_MODEL = 'gpt-5.4';

  try {
    const payload = (provider as any).buildCodexResponsesPayload(
      normalizeImageOptions({ prompt: 'draw this' }),
      []
    );

    assert.equal(payload.model, 'gpt-5.4');
  } finally {
    if (originalImageModel === undefined) {
      delete process.env.IMAGE_PROVIDER_CODEX_RESPONSE_MODEL;
    } else {
      process.env.IMAGE_PROVIDER_CODEX_RESPONSE_MODEL = originalImageModel;
    }
  }
});

test('Codex image provider inherits main canonical request fields for image fork payloads', () => {
  const provider = new OpenAIImageProvider({ apiKey: 'test-key' });
  const baseRequest = {
    model: 'gpt-5.5',
    input: [{
      role: 'user',
      content: 'current main turn'
    }],
    instructions: 'main instructions',
    prompt_cache_key: 'xiaoni:test-global',
    prompt_cache_retention: '24h',
    reasoning: { effort: 'medium', summary: 'auto' },
    text: { verbosity: 'low' },
    include: ['reasoning.encrypted_content'],
    parallel_tool_calls: true,
    tools: [{
      type: 'function',
      name: 'request_image_task',
      description: 'queue image task'
    }, {
      type: 'image_generation',
      model: 'gpt-image-2',
      size: 'auto',
      quality: 'auto',
      output_format: 'png',
      background: 'auto'
    }],
    tool_choice: {
      type: 'function',
      name: 'request_image_task'
    },
    metadata: {
      trace_id: 'trace-1'
    }
  };

  const payload = (provider as any).buildCodexResponsesPayload(
    normalizeImageOptions({ prompt: 'draw this' }),
    [],
    undefined,
    baseRequest
  );

  assert.equal(payload.model, 'gpt-5.5');
  assert.equal(payload.prompt_cache_key, 'xiaoni:test-global');
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'prompt_cache_retention'), false);
  assert.deepEqual(payload.reasoning, { effort: 'medium', summary: 'auto' });
  assert.deepEqual(payload.text, { verbosity: 'low' });
  assert.deepEqual(payload.include, ['reasoning.encrypted_content']);
  assert.equal(payload.instructions, 'main instructions');
  assert.equal(payload.store, false);
  assert.equal(payload.stream, true);
  assert.deepEqual(payload.tool_choice, {
    type: 'allowed_tools',
    mode: 'required',
    tools: [{ type: 'image_generation' }]
  });
  assert.deepEqual(payload.tools, [{
    type: 'function',
    name: 'request_image_task',
    description: 'queue image task'
  }, {
    type: 'image_generation',
    model: 'gpt-image-2',
    size: 'auto',
    quality: 'auto',
    output_format: 'png',
    background: 'auto'
  }]);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'metadata'), false);
  assert.equal(payload.input[0]?.content, 'current main turn');
  assert.equal(payload.input.at(-1)?.content[0]?.text, 'draw this');
});

test('Codex image provider appends image_generation only when the inherited tool list lacks it', () => {
  const provider = new OpenAIImageProvider({ apiKey: 'test-key' });

  const payload = (provider as any).buildCodexResponsesPayload(
    normalizeImageOptions({ prompt: 'draw this' }),
    [],
    undefined,
    {
      model: 'gpt-5.5',
      input: [],
      tools: [{
        type: 'function',
        name: 'request_image_task',
        description: 'queue image task'
      }],
      parallel_tool_calls: true
    }
  );

  assert.deepEqual(payload.tools.map((tool: any) => tool.type), ['function', 'image_generation']);
});

test('Codex image response parser exposes JSON detail errors from HTTP failures', async () => {
  const provider = new OpenAIImageProvider({ apiKey: 'test-key' });

  await assert.rejects(
    () => (provider as any).parseCodexResponsesResponse({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        detail: "The 'gpt-5-mini' model is not supported when using Codex with a ChatGPT account."
      })
    }),
    (error: any) => {
      assert.equal(error instanceof ImageProviderError, true);
      assert.equal(error.message, "The 'gpt-5-mini' model is not supported when using Codex with a ChatGPT account.");
      assert.equal(error.statusCode, 400);
      return true;
    }
  );
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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  GeminiMediaService,
  GeminiMediaConfigError,
  GeminiMediaRequestError,
  GeminiMediaValidationError,
  buildGeminiMediaPayload,
  parseGeminiMediaResponse
} from '../gemini-media-service';

const baseConfig = {
  model: 'gemini-3.5-flash',
  baseUrl: 'http://host.docker.internal:8317',
  apiKey: 'proxy-key',
  timeoutMs: 5000,
  maxInlineBytes: 20 * 1024 * 1024
};

test('buildGeminiMediaPayload puts the prompt first then inline_data parts', () => {
  const payload = buildGeminiMediaPayload(
    { prompt: '描述这段音频', generationConfig: { temperature: 0.2, maxOutputTokens: 512 } },
    [{ mimeType: 'audio/wav', data: 'QUJD' }]
  );

  assert.deepEqual(payload.contents[0].parts[0], { text: '描述这段音频' });
  assert.deepEqual(payload.contents[0].parts[1], {
    inline_data: { mime_type: 'audio/wav', data: 'QUJD' }
  });
  assert.deepEqual(payload.generationConfig, { temperature: 0.2, maxOutputTokens: 512 });
  // topP/topK omitted when not provided
  assert.equal('topP' in payload.generationConfig, false);
});

test('buildGeminiMediaPayload omits generationConfig and systemInstruction when absent', () => {
  const payload = buildGeminiMediaPayload({ prompt: 'hi' }, []);
  assert.equal('generationConfig' in payload, false);
  assert.equal('systemInstruction' in payload, false);
});

test('buildGeminiMediaPayload wraps systemInstruction in parts', () => {
  const payload = buildGeminiMediaPayload(
    { prompt: 'hi', systemInstruction: '你是助手' },
    []
  );
  assert.deepEqual(payload.systemInstruction, { parts: [{ text: '你是助手' }] });
});

test('parseGeminiMediaResponse surfaces finishReason and prompt blockReason', () => {
  const blocked = parseGeminiMediaResponse(
    {
      candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }],
      promptFeedback: { blockReason: 'SAFETY' },
      usageMetadata: {}
    },
    'gemini-3.5-flash'
  );
  assert.equal(blocked.text, '');
  assert.equal(blocked.finishReason, 'SAFETY');
  assert.equal(blocked.blockReason, 'SAFETY');

  // Clean STOP response has no blockReason field.
  const clean = parseGeminiMediaResponse(
    {
      candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
      usageMetadata: {}
    },
    'gemini-3.5-flash'
  );
  assert.equal(clean.finishReason, 'STOP');
  assert.equal('blockReason' in clean, false);
});

test('parseGeminiMediaResponse joins non-thought text parts and surfaces modalities', () => {
  const result = parseGeminiMediaResponse(
    {
      candidates: [
        {
          content: {
            parts: [
              { text: 'ignored thought', thought: true },
              { text: '这是一段' },
              { text: '纯音' }
            ]
          }
        }
      ],
      usageMetadata: {
        promptTokenCount: 67,
        candidatesTokenCount: 23,
        totalTokenCount: 90,
        thoughtsTokenCount: 44,
        promptTokensDetails: [
          { modality: 'AUDIO', tokenCount: 50 },
          { modality: 'TEXT', tokenCount: 17 }
        ]
      }
    },
    'gemini-3.5-flash'
  );

  assert.equal(result.text, '这是一段纯音');
  assert.equal(result.provider, 'gemini-cliproxy');
  assert.equal(result.usage.inputTokens, 67);
  assert.equal(result.usage.outputTokens, 23);
  assert.equal(result.usage.thoughtsTokens, 44);
  assert.deepEqual(result.usage.modalities, [
    { modality: 'AUDIO', tokenCount: 50 },
    { modality: 'TEXT', tokenCount: 17 }
  ]);
});

test('analyze rejects an empty prompt', async () => {
  const service = new GeminiMediaService(baseConfig);
  await assert.rejects(
    () => service.analyze({ prompt: '   ', media: [{ mimeType: 'audio/wav', dataBase64: 'QUJD' }] }),
    GeminiMediaValidationError
  );
});

test('analyze rejects when no media is provided', async () => {
  const service = new GeminiMediaService(baseConfig);
  await assert.rejects(
    () => service.analyze({ prompt: '描述', media: [] }),
    GeminiMediaValidationError
  );
});

test('analyze rejects a media part missing mimeType', async () => {
  const service = new GeminiMediaService(baseConfig);
  await assert.rejects(
    () => service.analyze({ prompt: 'x', media: [{ mimeType: '', dataBase64: 'QUJD' }] }),
    GeminiMediaValidationError
  );
});

test('analyze rejects a media part with neither dataBase64 nor filePath', async () => {
  const service = new GeminiMediaService(baseConfig);
  await assert.rejects(
    () => service.analyze({ prompt: 'x', media: [{ mimeType: 'audio/wav' }] }),
    GeminiMediaValidationError
  );
});

test('analyze rejects inline data over the size limit', async () => {
  const service = new GeminiMediaService({ ...baseConfig, maxInlineBytes: 8 });
  // 'QUJDRA==' decodes to 4 bytes; give it something clearly over 8 bytes
  const big = 'QUJD'.repeat(16); // 48 base64 chars -> ~36 bytes
  await assert.rejects(
    () => service.analyze({ prompt: 'x', media: [{ mimeType: 'audio/wav', dataBase64: big }] }),
    GeminiMediaValidationError
  );
});

test('analyze rejects an oversized file via stat before reading it into memory', async () => {
  const service = new GeminiMediaService({ ...baseConfig, maxInlineBytes: 16 });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-media-'));
  const file = path.join(dir, 'big.bin');
  await fs.writeFile(file, Buffer.alloc(1024)); // 1 KiB > 16 byte cap

  const realFetch = globalThis.fetch;
  let fetchCalled = false;
  (globalThis as any).fetch = async () => {
    fetchCalled = true;
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
  };
  try {
    await assert.rejects(
      () => service.analyze({ prompt: 'x', media: [{ mimeType: 'video/mp4', filePath: file }] }),
      GeminiMediaValidationError
    );
    assert.equal(fetchCalled, false, 'must reject before any upstream call');
  } finally {
    globalThis.fetch = realFetch;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('analyze rejects a directory path (not a regular file)', async () => {
  const service = new GeminiMediaService(baseConfig);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-media-dir-'));
  try {
    await assert.rejects(
      () => service.analyze({ prompt: 'x', media: [{ mimeType: 'video/mp4', filePath: dir }] }),
      GeminiMediaValidationError
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('analyze reads a real file from disk and base64-encodes it', async () => {
  const service = new GeminiMediaService(baseConfig);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-media-ok-'));
  const file = path.join(dir, 'clip.bin');
  await fs.writeFile(file, Buffer.from('ABC')); // -> 'QUJD'

  const realFetch = globalThis.fetch;
  let sentData = '';
  (globalThis as any).fetch = async (_url: string, init: any) => {
    sentData = JSON.parse(init.body).contents[0].parts[1].inline_data.data;
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata: {} })
    };
  };
  try {
    await service.analyze({ prompt: 'x', media: [{ mimeType: 'application/octet-stream', filePath: file }] });
    assert.equal(sentData, 'QUJD');
  } finally {
    globalThis.fetch = realFetch;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('analyze throws a config error when the proxy key is missing', async () => {
  const service = new GeminiMediaService({ ...baseConfig, apiKey: '' });
  await assert.rejects(
    () => service.analyze({ prompt: 'x', media: [{ mimeType: 'audio/wav', dataBase64: 'QUJD' }] }),
    GeminiMediaConfigError
  );
});

test('analyze posts to the cliproxy native gemini endpoint with x-goog-api-key', async () => {
  const service = new GeminiMediaService(baseConfig);
  const realFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedInit: any = null;
  (globalThis as any).fetch = async (url: string, init: any) => {
    capturedUrl = url;
    capturedInit = init;
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '440Hz 纯音' }] } }],
        usageMetadata: {
          promptTokenCount: 50,
          candidatesTokenCount: 5,
          totalTokenCount: 55,
          promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 50 }]
        }
      })
    };
  };

  try {
    const result = await service.analyze({
      prompt: '描述这段音频',
      media: [{ mimeType: 'audio/wav', dataBase64: 'QUJD' }]
    });

    assert.equal(
      capturedUrl,
      'http://host.docker.internal:8317/v1beta/models/gemini-3.5-flash:generateContent'
    );
    assert.equal(capturedInit.method, 'POST');
    assert.equal(capturedInit.headers['x-goog-api-key'], 'proxy-key');
    assert.equal(capturedInit.headers['Content-Type'], 'application/json');
    const sent = JSON.parse(capturedInit.body);
    assert.deepEqual(sent.contents[0].parts[1].inline_data, {
      mime_type: 'audio/wav',
      data: 'QUJD'
    });
    assert.equal(result.text, '440Hz 纯音');
    assert.deepEqual(result.usage.modalities, [{ modality: 'AUDIO', tokenCount: 50 }]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('analyze surfaces a non-2xx upstream response as GeminiMediaRequestError', async () => {
  const service = new GeminiMediaService(baseConfig);
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => ({
    ok: false,
    status: 429,
    statusText: 'Too Many Requests',
    text: async () => 'quota exceeded'
  });

  try {
    await assert.rejects(
      () => service.analyze({ prompt: 'x', media: [{ mimeType: 'audio/wav', dataBase64: 'QUJD' }] }),
      (error: unknown) => {
        assert.ok(error instanceof GeminiMediaRequestError);
        assert.equal(error.statusCode, 429);
        return true;
      }
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('analyze honors a per-request model override in the URL', async () => {
  const service = new GeminiMediaService(baseConfig);
  const realFetch = globalThis.fetch;
  let capturedUrl = '';
  (globalThis as any).fetch = async (url: string) => {
    capturedUrl = url;
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata: {} })
    };
  };

  try {
    await service.analyze({
      prompt: 'x',
      model: 'gemini-3.5-pro',
      media: [{ mimeType: 'image/png', dataBase64: 'QUJD' }]
    });
    assert.match(capturedUrl, /models\/gemini-3\.5-pro:generateContent$/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

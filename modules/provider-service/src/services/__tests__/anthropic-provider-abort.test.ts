import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { AnthropicProvider } from '../llm-provider/anthropic-provider';
import type { OpenResponseCreateRequest } from '../llm-provider/types';
import type { AIConfig } from '../../types';

// Part ②: when the caller aborts (the cache-heartbeat client hits its timeout and
// aborts the fetch, which closes the socket → the provider handler aborts the
// upstream signal), the anthropic provider must:
//   1. tear down the in-flight upstream request and reject, and
//   2. NOT retry it. An axios cancel has no `error.response`, so without the
//      bail-on-abort guard it would fall into the connection-level retry and
//      re-issue the very 437K request we just cancelled — the pile-up we are
//      fixing. A single observed upstream request proves the guard holds.

function baseConfig(extra: Partial<AIConfig> = {}): AIConfig {
  return {
    gemini_api_keys: [],
    model_name: 'claude-opus-4-6',
    authorized_user_id: 1,
    bot_qq_number: 1,
    ...extra
  } as AIConfig;
}

const REQ: OpenResponseCreateRequest = {
  model: 'claude-opus-4-6',
  instructions: 'sys',
  input: [{ type: 'message', role: 'user', content: 'ping' }],
  max_output_tokens: 64
};

async function withCredential<T>(fn: (file: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-cred-abort-'));
  const file = path.join(dir, '.credentials.json');
  await fs.writeFile(file, JSON.stringify({
    claudeAiOauth: { accessToken: 'sk-ant-oat01-live', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 }
  }));
  try {
    return await fn(file);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('aborting mid-flight rejects and does NOT retry the upstream call', async () => {
  await withCredential(async (file) => {
    let requestCount = 0;
    // Hang server: accept the request but never respond, so the only way the call
    // ends is via the abort signal.
    const server = http.createServer((req) => {
      requestCount += 1;
      req.resume(); // drain body, keep the response open forever
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as any;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const provider = new AnthropicProvider(baseConfig({ anthropic_oauth_path: file }), { baseUrl });
      const controller = new AbortController();
      const call = provider.generateContent({
        request: REQ,
        modelName: 'claude-opus-4-6',
        signal: controller.signal
      });

      // Abort once the request is in flight on the server.
      await new Promise<void>((resolve) => {
        const started = () => (requestCount > 0 ? resolve() : setTimeout(started, 5));
        started();
      });
      controller.abort();

      await assert.rejects(call, (err: any) => {
        // Any abort/cancel shape is acceptable; the point is it rejected, not resolved.
        return Boolean(
          err?.name === 'CanceledError' ||
          err?.name === 'AbortError' ||
          err?.code === 'ERR_CANCELED' ||
          /cancel|abort/i.test(String(err?.message || ''))
        );
      });

      // Give any (buggy) retry a chance to fire before we assert it did not.
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(requestCount, 1, 'aborted request must not be retried');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

test('a signal already aborted before the call still rejects', async () => {
  await withCredential(async (file) => {
    let requestCount = 0;
    const server = http.createServer((req, res) => {
      requestCount += 1;
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'x', model: 'claude-opus-4-6', stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'pong' }],
        usage: { input_tokens: 1, output_tokens: 1 }
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as any;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const provider = new AnthropicProvider(baseConfig({ anthropic_oauth_path: file }), { baseUrl });
      const controller = new AbortController();
      controller.abort(); // already aborted

      await assert.rejects(provider.generateContent({
        request: REQ,
        modelName: 'claude-opus-4-6',
        signal: controller.signal
      }));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

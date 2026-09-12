import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { AnthropicProvider } from '../llm-provider/anthropic-provider';
import { resetCodexPromptCacheAdmissionGateForTest } from '../llm-provider/codex-prompt-cache-gate';
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
  prompt_cache_key: 'xiaoni:test-global',
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

test('same Anthropic cache namespace waits until the first upstream response returns', async () => {
  await withCredential(async (file) => {
    const previousEnv = {
      CODEX_PROMPT_CACHE_GATE_ENABLED: process.env.CODEX_PROMPT_CACHE_GATE_ENABLED,
      CODEX_PROMPT_CACHE_GATE_RPM: process.env.CODEX_PROMPT_CACHE_GATE_RPM,
      CODEX_PROMPT_CACHE_GATE_WINDOW_MS: process.env.CODEX_PROMPT_CACHE_GATE_WINDOW_MS
    };
    let requestCount = 0;
    let firstResponse: http.ServerResponse | null = null;
    const responseBody = JSON.stringify({
      id: 'x', type: 'message', role: 'assistant', model: 'claude-opus-4-6', stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'pong' }],
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 1 }
    });
    const server = http.createServer((req, res) => {
      requestCount += 1;
      req.resume();
      if (requestCount === 1) {
        firstResponse = res;
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(responseBody);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as any;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      resetCodexPromptCacheAdmissionGateForTest();
      process.env.CODEX_PROMPT_CACHE_GATE_ENABLED = 'true';
      process.env.CODEX_PROMPT_CACHE_GATE_RPM = '100';
      process.env.CODEX_PROMPT_CACHE_GATE_WINDOW_MS = '100';

      const provider = new AnthropicProvider(
        baseConfig({ anthropic_oauth_path: file }),
        { baseUrl, timeoutMs: 2_000 }
      );
      const firstCall = provider.generateContent({
        request: REQ,
        modelName: 'claude-opus-4-6'
      });
      await new Promise<void>((resolve) => {
        const started = () => (requestCount > 0 ? resolve() : setTimeout(started, 5));
        started();
      });

      const secondCall = provider.generateContent({
        request: REQ,
        modelName: 'claude-opus-4-6'
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(requestCount, 1, 'the second same-prefix request must wait before reaching Anthropic');

      const responseToRelease = firstResponse as http.ServerResponse | null;
      responseToRelease?.writeHead(200, { 'content-type': 'application/json' });
      responseToRelease?.end(responseBody);
      const [firstResult, secondResult] = await Promise.all([firstCall, secondCall]);
      assert.equal(firstResult.text, 'pong');
      assert.equal(secondResult.text, 'pong');
      assert.equal(requestCount, 2);
    } finally {
      resetCodexPromptCacheAdmissionGateForTest();
      (firstResponse as http.ServerResponse | null)?.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});

test('does not sleep for a multi-hour Anthropic rate-limit retry-after', async () => {
  await withCredential(async (file) => {
    let requestCount = 0;
    const server = http.createServer((req, res) => {
      requestCount += 1;
      req.resume();
      res.writeHead(429, {
        'content-type': 'application/json',
        'retry-after': '17971'
      });
      res.end(JSON.stringify({ error: { type: 'rate_limit_error', message: 'quota reset later' } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as any;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      resetCodexPromptCacheAdmissionGateForTest();
      const provider = new AnthropicProvider(
        baseConfig({ anthropic_oauth_path: file }),
        { baseUrl, timeoutMs: 2_000 }
      );
      const startedAt = Date.now();
      await assert.rejects(provider.generateContent({
        request: REQ,
        modelName: 'claude-opus-4-6'
      }), /Anthropic API error \(429/);
      const elapsedMs = Date.now() - startedAt;
      assert.equal(requestCount, 1, 'a multi-hour retry-after must not trigger another request');
      assert.ok(elapsedMs < 1_000, `long retry-after took ${elapsedMs}ms`);
      // A fresh provider instance must not bypass the shared rate-limit deadline,
      // even with a different model/cache key (the limit may be account-wide).
      const secondProvider = new AnthropicProvider(
        baseConfig({ anthropic_oauth_path: file }), { baseUrl, timeoutMs: 2_000 }
      );
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30);
      try {
        await assert.rejects(secondProvider.generateContent({
          request: { ...REQ, model: 'claude-sonnet-4-6', prompt_cache_key: 'another-key' },
          modelName: 'claude-sonnet-4-6',
          signal: controller.signal
        }), { name: 'AbortError' });
        assert.equal(requestCount, 1, 'no subsequent upstream request before Retry-After');
      } finally {
        clearTimeout(timer);
      }
    } finally {
      resetCodexPromptCacheAdmissionGateForTest();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

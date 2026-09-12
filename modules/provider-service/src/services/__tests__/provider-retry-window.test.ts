import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderRetryWindow } from '../llm-provider/provider-retry-window';
import { claudeAccountKey, refreshClaudeOAuthCredential } from '../llm-provider/anthropic-oauth';

test('Retry-After accepts seconds and HTTP dates without shortening an existing deadline', () => {
  const window = new ProviderRetryWindow();
  const now = Date.parse('2026-09-12T06:00:00Z');
  assert.equal(window.defer('a', '3600', now), now + 3_600_000);
  assert.equal(window.defer('a', '5', now), now + 3_600_000);
  assert.equal(window.defer('a', 'Sat, 12 Sep 2026 08:00:00 GMT', now), now + 7_200_000);
});

test('new callers wait until the shared deadline, while another endpoint is independent', async () => {
  const window = new ProviderRetryWindow();
  const deadline = window.defer('a', '0.05');
  await window.wait('b');
  await window.wait('a');
  assert.ok(Date.now() >= deadline);
});

test('cancelling a waiter preserves Retry-After for the next caller', async () => {
  const window = new ProviderRetryWindow();
  const deadline = window.defer('a', '0.06');
  const controller = new AbortController();
  const waiting = window.wait('a', controller.signal);
  controller.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  await window.wait('a');
  assert.ok(Date.now() >= deadline);
});

test('a deadline extension is checked again before admitting a waiting caller', async () => {
  const window = new ProviderRetryWindow();
  window.defer('a', '0.02');
  const waiting = window.wait('a');
  const deadline = window.defer('a', '0.06');
  await waiting;
  assert.ok(Date.now() >= deadline);
});

test('OAuth rotation preserves retry identity and concurrent accounts do not share refreshed tokens', async () => {
  const previous = globalThis.fetch;
  const a = { access: 'access-a', refresh: 'refresh-a' };
  const b = { access: 'access-b', refresh: 'refresh-b' };
  globalThis.fetch = (async (_url: unknown, init: any) => {
    const token = JSON.parse(init.body).refresh_token;
    return { ok: true, json: async () => ({
      access_token: `new-${token}`, refresh_token: `rotated-${token}`, expires_in: 3600
    }) };
  }) as any;
  try {
    const [nextA, nextB] = await Promise.all([
      refreshClaudeOAuthCredential(a), refreshClaudeOAuthCredential(b)
    ]);
    assert.equal(claudeAccountKey(nextA), claudeAccountKey(a));
    assert.equal(claudeAccountKey(nextB), claudeAccountKey(b));
    assert.notEqual(claudeAccountKey(nextA), claudeAccountKey(nextB));
    assert.equal(nextA.access, 'new-refresh-a');
    assert.equal(nextB.access, 'new-refresh-b');
  } finally {
    globalThis.fetch = previous;
  }
});

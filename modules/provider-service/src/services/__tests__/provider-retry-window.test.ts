import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderRetryWindow } from '../llm-provider/provider-retry-window';

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

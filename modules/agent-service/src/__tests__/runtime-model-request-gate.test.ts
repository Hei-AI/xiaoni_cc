import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentLoopService } from '../services/agent-loop-service';

test('paused runtime rejects a background agent request before provider dispatch', async () => {
  const service = new AgentLoopService({} as any, undefined, { isRuntimeEnabled: () => false });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; throw new Error('unexpected provider call'); }) as typeof fetch;
  try {
    await assert.rejects((service as any).executeImageVisionForkTurn({}, {}), /runtime is disabled/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('heartbeat switch rejects a heartbeat even when the main runtime is paused', async () => {
  const service = new AgentLoopService({} as any, undefined, {
    isRuntimeEnabled: () => false,
    isCacheHeartbeatPaused: () => true
  });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; throw new Error('unexpected provider call'); }) as typeof fetch;
  try {
    const result = await service.triggerCacheHeartbeatForDebug();
    assert.equal(result.triggered, false);
    assert.equal(result.reason, 'heartbeat_paused');
    await assert.rejects((service as any).executeCacheHeartbeatTurn({}, {}, {}), /cache heartbeat is disabled/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

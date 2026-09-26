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

test('paused runtime rejects an automatic compression fork turn but lets a manual one through', async () => {
  const service = new AgentLoopService({} as any, undefined, { isRuntimeEnabled: () => false });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ success: true, llm_call_id: 'llm-manual-compress' }), { status: 200 });
  }) as typeof fetch;
  try {
    const queueMessage = { traceId: 'runtrace-manual-compress', runId: 'run-manual-compress' };
    const runtimePrompt = { promptName: 'main', modelName: 'test-model', parameters: {} };
    await assert.rejects(
      (service as any).executeCoreMemoryCompressionForkTurn({}, queueMessage, runtimePrompt, 1),
      /runtime is disabled/
    );
    assert.equal(calls, 0);
    // Manual compression is the way out of a compression-overrun halt (the loop is stopped then).
    const result = await (service as any).executeCoreMemoryCompressionForkTurn({}, queueMessage, runtimePrompt, 1, true);
    assert.equal(result.llm_call_id, 'llm-manual-compress');
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

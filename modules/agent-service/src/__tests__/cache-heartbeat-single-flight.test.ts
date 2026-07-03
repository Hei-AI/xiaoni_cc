import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentLoopService } from '../services/agent-loop-service';

// Part ①: the cache heartbeat must be single-flight across ALL entry points.
// The lock (cacheHeartbeatInFlight) is shared by the recovery scheduler, the
// debug-interval supervisor and the manual admin button (both reach the loop
// through triggerCacheHeartbeatForDebug). While one heartbeat is in flight, any
// other trigger must skip immediately with reason 'heartbeat_in_flight' instead
// of firing a second concurrent ~437K clone request. This is the guard that stops
// the request pile-up that cold-read the cache 8x in one 8-second window.

function makeService() {
  return new AgentLoopService({} as any);
}

// Replace the private execution with a controllable stub so we can hold one run
// "in flight" and observe what concurrent triggers do. Returns a release fn.
function stubHeartbeatRun(service: AgentLoopService) {
  let calls = 0;
  let releaseCurrent: (() => void) | null = null;
  (service as any).runCacheHeartbeatDuringRecovery = () => {
    calls += 1;
    return new Promise<any>((resolveRun) => {
      releaseCurrent = () =>
        resolveRun({ triggered: true, executionMode: 'cache_heartbeat_no_persist' });
    });
  };
  return {
    get calls() {
      return calls;
    },
    release() {
      releaseCurrent?.();
    }
  };
}

test('second trigger while one is in flight is skipped, not run', async () => {
  const service = makeService();
  const stub = stubHeartbeatRun(service);

  const first = service.triggerCacheHeartbeatForDebug();
  // The lock is set synchronously before the first await resolves, so a concurrent
  // trigger must see it and bail without invoking the execution again.
  const second = await service.triggerCacheHeartbeatForDebug();

  assert.equal(second.triggered, false);
  assert.equal(second.reason, 'heartbeat_in_flight');
  assert.equal(stub.calls, 1, 'execution must run exactly once while locked');

  stub.release();
  const firstResult = await first;
  assert.equal(firstResult.triggered, true);
});

test('lock releases after completion so the next trigger runs again', async () => {
  const service = makeService();
  const stub = stubHeartbeatRun(service);

  const first = service.triggerCacheHeartbeatForDebug();
  stub.release();
  await first;

  // Fresh trigger after the in-flight one settled: lock cleared → executes again.
  const second = service.triggerCacheHeartbeatForDebug();
  assert.equal(stub.calls, 2, 'a new heartbeat runs once the lock is free');
  stub.release();
  const secondResult = await second;
  assert.equal(secondResult.triggered, true);
});

test('many concurrent triggers collapse to a single execution', async () => {
  const service = makeService();
  const stub = stubHeartbeatRun(service);

  const inflight = service.triggerCacheHeartbeatForDebug();
  const others = await Promise.all(
    Array.from({ length: 7 }, () => service.triggerCacheHeartbeatForDebug())
  );

  assert.equal(stub.calls, 1, 'only one of eight concurrent triggers executes');
  for (const r of others) {
    assert.equal(r.triggered, false);
    assert.equal(r.reason, 'heartbeat_in_flight');
  }
  stub.release();
  await inflight;
});

import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentRecoveryWindowProjection } from '@qq-bot/persistence';
import { AgentLoopService } from '../services/agent-loop-service';
import type { ResolvedAgentRuntimePrompt } from '../services/agent-prompt-service';
import type { QueueMessagePayload, QueueMessageRecord } from '../types';

function createQueueMessage(id = 'run-1'): QueueMessageRecord {
  return {
    id,
    traceId: `trace-${id}`,
    batchId: `batch-${id}`,
    status: 'processing',
    attempts: 1,
    createdAt: '2026-06-06T00:00:00.000Z',
    queueMessageIds: [1],
    payload: {} as QueueMessagePayload
  };
}

function createRuntimePrompt(systemPrompt: string): ResolvedAgentRuntimePrompt {
  return {
    source: 'static',
    promptId: 'xiaoni-main-agent',
    promptName: 'xiaoni-main-agent',
    systemPrompt,
    identityGenesisSnapshot: systemPrompt,
    userPromptTemplate: null,
    contextVariables: {},
    runtimeVariables: {},
    modelName: 'gpt-5-mini',
    parameters: {}
  };
}

function createRecoveryWindow(overrides: Partial<AgentRecoveryWindowProjection> = {}): AgentRecoveryWindowProjection {
  return {
    active: false,
    identityKey: 'xiaoni',
    eventId: '9',
    eventKind: 'recover_energy',
    occurredAt: '2026-06-06T00:00:00.000Z',
    recoverUntil: '2026-06-06T00:00:10.000Z',
    remainingMs: 0,
    durationMs: 10_000,
    reason: null,
    traceId: 'trace-recovery',
    runId: 'run-recovery',
    continuationDedupeKey: 'self_continuation:recovery:9',
    continuationQueued: false,
    ...overrides
  };
}

type ProcessedRuntimeFrame = {
  message: QueueMessageRecord;
  options: Record<string, unknown>;
};

function stubRuntimeFrame(service: AgentLoopService, processed: ProcessedRuntimeFrame[]) {
  (service as any).processRuntimeFrame = async (message: QueueMessageRecord, options: Record<string, unknown> = {}) => {
    processed.push({ message, options });
  };
}

test('runtime iteration claims and processes queued notify inside AgentLoopService', async () => {
  const queueMessage = createQueueMessage();
  const processed: ProcessedRuntimeFrame[] = [];
  const service = new AgentLoopService({
    claimNextQueueMessage: async (workerId: string) => {
      assert.equal(workerId, 'worker-1');
      return queueMessage;
    }
  } as any);
  stubRuntimeFrame(service, processed);

  const delay = await (service as any).processRuntimeIteration({
    workerId: 'worker-1',
    idleIntervalMs: 2000,
    pollIntervalMs: 1000,
    getActiveRecoveryWindow: async () => {
      throw new Error('should not check recovery when queued notify exists');
    }
  });

  assert.equal(delay, 1000);
  assert.deepEqual(processed.map((item) => item.message), [queueMessage]);
  assert.deepEqual(processed.map((item) => item.options), [{}]);
});

test('runtime iteration waits for active recovery instead of enqueuing a new notify', async () => {
  const processed: ProcessedRuntimeFrame[] = [];
  const service = new AgentLoopService({
    claimNextQueueMessage: async () => null,
    enqueueSelfContinuationForRecovery: async () => {
      throw new Error('should not enqueue during active recovery');
    },
  } as any);
  stubRuntimeFrame(service, processed);

  const delay = await (service as any).processRuntimeIteration({
    workerId: 'worker-1',
    idleIntervalMs: 2000,
    pollIntervalMs: 1000,
    getActiveRecoveryWindow: async () => createRecoveryWindow({
      active: true,
      remainingMs: 750
    })
  });

  assert.equal(delay, 750);
  assert.deepEqual(processed, []);
});

test('runtime iteration creates and processes recovery self continuation notify', async () => {
  const queueMessage = createQueueMessage('run-recovery');
  const processed: ProcessedRuntimeFrame[] = [];
  const calls: string[] = [];
  let claimCount = 0;
  const service = new AgentLoopService({
    claimNextQueueMessage: async () => {
      calls.push('claim');
      claimCount += 1;
      return claimCount === 1 ? null : queueMessage;
    },
    enqueueSelfContinuationForRecovery: async (recoveryWindow: unknown) => {
      calls.push(`enqueue:${(recoveryWindow as { eventId?: string }).eventId}`);
      return true;
    }
  } as any);
  stubRuntimeFrame(service, processed);

  const delay = await (service as any).processRuntimeIteration({
    workerId: 'worker-1',
    idleIntervalMs: 2000,
    pollIntervalMs: 1000,
    getActiveRecoveryWindow: async () => null,
    getLatestRecoveryWindow: async () => createRecoveryWindow()
  });

  assert.equal(delay, 1000);
  assert.deepEqual(calls, ['claim', 'enqueue:9', 'claim']);
  assert.deepEqual(processed.map((item) => item.message), [queueMessage]);
});

test('runtime iteration processes a runtime_loop frame when there is no notify', async () => {
  const processed: ProcessedRuntimeFrame[] = [];
  const calls: string[] = [];
  const service = new AgentLoopService({
    claimNextQueueMessage: async () => {
      calls.push('claim');
      return null;
    }
  } as any);
  stubRuntimeFrame(service, processed);

  const delay = await (service as any).processRuntimeIteration({
    workerId: 'worker-1',
    idleIntervalMs: 2000,
    pollIntervalMs: 1000,
    getActiveRecoveryWindow: async () => null,
    getLatestRecoveryWindow: async () => null
  });

  assert.equal(delay, 1000);
  assert.deepEqual(calls, ['claim']);
  assert.equal(processed.length, 1);
  assert.equal(processed[0]?.message.payload.source, 'runtime_loop');
  assert.equal(processed[0]?.message.queueMessageIds.length, 0);
  assert.deepEqual(processed[0]?.options, {
    queueBacked: false,
    triggerInputMode: 'suppress_current_trigger',
    appendRuntimeInputStackItem: false,
    logQueueLifecycle: false
  });
});

test('runtime loop owns the forever loop and sleeps between iterations', async () => {
  const queueMessage = createQueueMessage('run-loop');
  const processed: ProcessedRuntimeFrame[] = [];
  const events: string[] = [];
  let stopped = false;
  const service = new AgentLoopService({
    claimNextQueueMessage: async () => queueMessage
  } as any, undefined, {
    isRuntimeEnabled: async () => {
      events.push('runtime-enabled');
      return true;
    }
  });
  stubRuntimeFrame(service, processed);

  await service.runRuntimeLoop({
    workerId: 'worker-1',
    idleIntervalMs: 2000,
    pollIntervalMs: 1000,
    isStopping: () => stopped,
    recoverStaleProcessingLeases: async () => {
      events.push('recover-stale-leases');
    },
    onBusyChange: (busy) => {
      events.push(`busy:${busy}`);
    },
    onRuntimeEnabledChange: (enabled) => {
      events.push(`enabled:${enabled}`);
    },
    sleepMs: async (ms) => {
      events.push(`sleep:${ms}`);
      stopped = true;
    }
  });

  assert.deepEqual(processed.map((item) => item.message), [queueMessage]);
  assert.deepEqual(events, [
    'recover-stale-leases',
    'runtime-enabled',
    'enabled:true',
    'busy:true',
    'busy:false',
    'sleep:1000'
  ]);
});

test('runtime loop resolves stable prompt before the first runtime iteration', async () => {
  const events: string[] = [];
  let stopped = false;
  const service = new AgentLoopService({
    claimNextQueueMessage: async () => {
      events.push('claim');
      return null;
    }
  } as any, {
    resolveForQueueMessage: async (payload: QueueMessagePayload) => {
      events.push(`resolve:${payload.source}`);
      return createRuntimePrompt(`system:${payload.source}`);
    }
  }, {
    isRuntimeEnabled: async () => {
      events.push('runtime-enabled');
      return true;
    }
  });
  stubRuntimeFrame(service, []);

  await service.runRuntimeLoop({
    workerId: 'worker-1',
    idleIntervalMs: 2000,
    pollIntervalMs: 1000,
    isStopping: () => stopped,
    recoverStaleProcessingLeases: async () => {
      events.push('recover-stale-leases');
    },
    onBusyChange: (busy) => {
      events.push(`busy:${busy}`);
    },
    sleepMs: async (ms) => {
      events.push(`sleep:${ms}`);
      stopped = true;
    }
  });

  assert.deepEqual(events, [
    'resolve:runtime_bootstrap',
    'recover-stale-leases',
    'runtime-enabled',
    'busy:true',
    'claim',
    'busy:false',
    'sleep:1000'
  ]);
});

test('runtime loop does not claim notify while runtime control is disabled', async () => {
  const events: string[] = [];
  let stopped = false;
  const service = new AgentLoopService({
    claimNextQueueMessage: async () => {
      throw new Error('runtime disabled should not claim notify');
    }
  } as any, undefined, {
    isRuntimeEnabled: async () => false
  });

  await service.runRuntimeLoop({
    workerId: 'worker-1',
    idleIntervalMs: 2000,
    pollIntervalMs: 1000,
    isStopping: () => stopped,
    onBusyChange: (busy) => {
      events.push(`busy:${busy}`);
    },
    onRuntimeEnabledChange: (enabled) => {
      events.push(`enabled:${enabled}`);
    },
    sleepMs: async (ms) => {
      events.push(`sleep:${ms}`);
      stopped = true;
    }
  });

  assert.deepEqual(events, [
    'enabled:false',
    'sleep:2000'
  ]);
});

test('runtime loop reports stale recovery errors and keeps the loop alive', async () => {
  const events: string[] = [];
  let stopped = false;
  const service = new AgentLoopService({
    claimNextQueueMessage: async () => null
  } as any);
  stubRuntimeFrame(service, []);

  await service.runRuntimeLoop({
    workerId: 'worker-1',
    idleIntervalMs: 2000,
    pollIntervalMs: 1000,
    isStopping: () => stopped,
    recoverStaleProcessingLeases: async () => {
      throw new Error('recovery failed');
    },
    onRuntimeLoopError: (error) => {
      events.push(error instanceof Error ? error.message : String(error));
    },
    sleepMs: async (ms) => {
      events.push(`sleep:${ms}`);
      stopped = true;
    }
  });

  assert.deepEqual(events, [
    'recovery failed',
    'sleep:1000'
  ]);
});

test('stable runtime prompt resolves once for the AgentLoopService lifetime', async () => {
  let resolveCount = 0;
  const service = new AgentLoopService({} as any, {
    resolveForQueueMessage: async (payload: QueueMessagePayload) => {
      resolveCount += 1;
      return createRuntimePrompt(`system:${payload.runId}`);
    }
  });

  const first = await (service as any).resolveStableRuntimePrompt({ runId: 'run-1' } as QueueMessagePayload);
  const second = await (service as any).resolveStableRuntimePrompt({ runId: 'run-2' } as QueueMessagePayload);

  assert.equal(resolveCount, 1);
  assert.equal(first.systemPrompt, 'system:run-1');
  assert.equal(second.systemPrompt, 'system:run-1');
});

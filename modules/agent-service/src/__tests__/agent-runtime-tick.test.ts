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

function stubRuntimeNotify(service: AgentLoopService, processed: QueueMessageRecord[]) {
  (service as any).processRuntimeNotify = async (message: QueueMessageRecord) => {
    processed.push(message);
  };
}

test('runtime tick claims and processes queued notify inside AgentLoopService', async () => {
  const queueMessage = createQueueMessage();
  const processed: QueueMessageRecord[] = [];
  const service = new AgentLoopService({
    claimNextQueueMessage: async (workerId: string) => {
      assert.equal(workerId, 'worker-1');
      return queueMessage;
    }
  } as any);
  stubRuntimeNotify(service, processed);

  const delay = await service.processNextRuntimeTick({
    workerId: 'worker-1',
    idleIntervalMs: 2000,
    pollIntervalMs: 1000,
    getActiveRecoveryWindow: async () => {
      throw new Error('should not check recovery when queued notify exists');
    }
  });

  assert.equal(delay, 1000);
  assert.deepEqual(processed, [queueMessage]);
});

test('runtime tick waits for active recovery instead of enqueuing a new notify', async () => {
  const processed: QueueMessageRecord[] = [];
  const service = new AgentLoopService({
    claimNextQueueMessage: async () => null,
    enqueueSelfContinuationForRecovery: async () => {
      throw new Error('should not enqueue during active recovery');
    },
    enqueueAutonomousRuntimeSlice: async () => {
      throw new Error('should not enqueue autonomous slice during active recovery');
    }
  } as any);
  stubRuntimeNotify(service, processed);

  const delay = await service.processNextRuntimeTick({
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

test('runtime tick creates and processes recovery self continuation notify', async () => {
  const queueMessage = createQueueMessage('run-recovery');
  const processed: QueueMessageRecord[] = [];
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
  stubRuntimeNotify(service, processed);

  const delay = await service.processNextRuntimeTick({
    workerId: 'worker-1',
    idleIntervalMs: 2000,
    pollIntervalMs: 1000,
    getActiveRecoveryWindow: async () => null,
    getLatestRecoveryWindow: async () => createRecoveryWindow()
  });

  assert.equal(delay, 1000);
  assert.deepEqual(calls, ['claim', 'enqueue:9', 'claim']);
  assert.deepEqual(processed, [queueMessage]);
});

test('runtime tick creates and processes autonomous runtime notify when idle', async () => {
  const queueMessage = createQueueMessage('run-autonomous');
  const processed: QueueMessageRecord[] = [];
  const calls: string[] = [];
  let claimCount = 0;
  const service = new AgentLoopService({
    claimNextQueueMessage: async () => {
      calls.push('claim');
      claimCount += 1;
      return claimCount === 1 ? null : queueMessage;
    },
    enqueueAutonomousRuntimeSlice: async (input: { minIntervalMs?: number }) => {
      calls.push(`enqueue:${input.minIntervalMs}`);
      return true;
    }
  } as any);
  stubRuntimeNotify(service, processed);

  const delay = await service.processNextRuntimeTick({
    workerId: 'worker-1',
    idleIntervalMs: 2000,
    pollIntervalMs: 1000,
    autonomousRuntimeSliceIntervalMs: 2500,
    getActiveRecoveryWindow: async () => null,
    getLatestRecoveryWindow: async () => null
  });

  assert.equal(delay, 1000);
  assert.deepEqual(calls, ['claim', 'enqueue:2500', 'claim']);
  assert.deepEqual(processed, [queueMessage]);
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

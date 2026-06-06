import test from 'node:test';
import assert from 'node:assert/strict';
import { processNextAgentQueueItem } from '../services/agent-queue-worker';
import type { QueueMessageRecord } from '../types';

function createQueueMessage(): QueueMessageRecord {
  return {
    id: 'run-1',
    traceId: 'trace-1',
    batchId: 'batch-1',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-06-06T00:00:00.000Z',
    queueMessageIds: [1],
    payload: {} as QueueMessageRecord['payload']
  };
}

test('empty queue enqueues and processes an autonomous runtime slice', async () => {
  const calls: string[] = [];
  const queueMessage = createQueueMessage();
  let claimCount = 0;
  const delay = await processNextAgentQueueItem({
    store: {
      claimNextQueueMessage: async () => {
        calls.push('claim');
        claimCount += 1;
        return claimCount === 1 ? null : queueMessage;
      },
      enqueueAutonomousRuntimeSlice: async (input) => {
        calls.push(`enqueue:${input?.minIntervalMs}`);
        return true;
      }
    },
    loopService: {
      processQueueMessage: async () => {
        calls.push('process');
      }
    },
    workerId: 'worker-1',
    idleIntervalMs: 2000,
    pollIntervalMs: 1000,
    autonomousRuntimeSliceIntervalMs: 2500,
    getActiveRecoveryWindow: async () => null
  });

  assert.equal(delay, 1000);
  assert.deepEqual(calls, ['claim', 'enqueue:2500', 'claim', 'process']);
});

test('disabled autonomous runtime keeps an empty queue idle', async () => {
  const calls: string[] = [];
  const delay = await processNextAgentQueueItem({
    store: {
      claimNextQueueMessage: async () => {
        calls.push('claim');
        return null;
      },
      enqueueAutonomousRuntimeSlice: async () => {
        calls.push('enqueue');
        return true;
      }
    },
    loopService: {
      processQueueMessage: async () => {
        calls.push('process');
      }
    },
    workerId: 'worker-1',
    idleIntervalMs: 2000,
    pollIntervalMs: 1000,
    autonomousRuntimeEnabled: false,
    getActiveRecoveryWindow: async () => null
  });

  assert.equal(delay, 2000);
  assert.deepEqual(calls, ['claim']);
});

test('active recovery window controls idle delay when the queue is empty', async () => {
  const delay = await processNextAgentQueueItem({
    store: {
      claimNextQueueMessage: async () => null
    },
    loopService: {
      processQueueMessage: async () => {
        throw new Error('should not process without a queue message');
      }
    },
    workerId: 'worker-1',
    idleIntervalMs: 2000,
    pollIntervalMs: 1000,
	    getActiveRecoveryWindow: async () => ({ remainingMs: 750 })
	  });

  assert.equal(delay, 750);
});

test('expired recovery window enqueues and processes a self continuation once', async () => {
  const queueMessage = createQueueMessage();
  let claimCount = 0;
  const enqueued: unknown[] = [];
  const processed: QueueMessageRecord[] = [];
  const delay = await processNextAgentQueueItem({
    store: {
      claimNextQueueMessage: async () => {
        claimCount += 1;
        return claimCount === 1 ? null : queueMessage;
      },
      enqueueSelfContinuationForRecovery: async (recoveryWindow) => {
        enqueued.push(recoveryWindow);
        return true;
      }
    },
    loopService: {
      processQueueMessage: async (message) => {
        processed.push(message);
      }
    },
    workerId: 'worker-1',
    idleIntervalMs: 2000,
    pollIntervalMs: 1000,
    getActiveRecoveryWindow: async () => null,
    getLatestRecoveryWindow: async () => ({
      active: false,
      remainingMs: 0,
      continuationQueued: false,
      continuationDedupeKey: 'self_continuation:recovery:9',
      eventId: '9'
    })
  });

  assert.equal(delay, 1000);
  assert.equal(claimCount, 2);
  assert.equal(enqueued.length, 1);
  assert.deepEqual(processed, [queueMessage]);
});

test('expired recovery window with existing continuation stays idle', async () => {
  const enqueued: unknown[] = [];
  const delay = await processNextAgentQueueItem({
    store: {
      claimNextQueueMessage: async () => null,
      enqueueSelfContinuationForRecovery: async (recoveryWindow) => {
        enqueued.push(recoveryWindow);
        return true;
      }
    },
    loopService: {
      processQueueMessage: async () => {
        throw new Error('should not process without a queue message');
      }
    },
    workerId: 'worker-1',
    idleIntervalMs: 2000,
    pollIntervalMs: 1000,
    getActiveRecoveryWindow: async () => null,
    getLatestRecoveryWindow: async () => ({
      active: false,
      remainingMs: 0,
      continuationQueued: true,
      eventId: '9'
    })
  });

  assert.equal(delay, 2000);
  assert.deepEqual(enqueued, []);
});

test('queue message processing returns poll delay', async () => {
  const queueMessage = createQueueMessage();
  const processed: QueueMessageRecord[] = [];
  const delay = await processNextAgentQueueItem({
    store: {
      claimNextQueueMessage: async () => queueMessage
    },
    loopService: {
      processQueueMessage: async (message) => {
        processed.push(message);
      }
    },
    workerId: 'worker-1',
    idleIntervalMs: 2000,
    pollIntervalMs: 1000,
    getActiveRecoveryWindow: async () => {
      throw new Error('should not check recovery when work exists');
    }
  });

  assert.equal(delay, 1000);
  assert.deepEqual(processed, [queueMessage]);
});

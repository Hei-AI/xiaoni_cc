import type { QueueMessageRecord } from '../types';

type ActiveRecoveryWindow = {
  active?: boolean;
  remainingMs?: number | null;
  continuationQueued?: boolean;
  continuationDedupeKey?: string | null;
  eventId?: string | null;
  eventKind?: string | null;
  recoverUntil?: string | null;
  reason?: string | null;
  traceId?: string | null;
  runId?: string | null;
} | null;

export type AgentQueuePollerStore = {
  claimNextQueueMessage(workerId: string): Promise<QueueMessageRecord | null>;
  enqueueSelfContinuationForRecovery?(recoveryWindow: NonNullable<ActiveRecoveryWindow>): Promise<boolean>;
  enqueueAutonomousRuntimeSlice?(input?: { minIntervalMs?: number }): Promise<boolean>;
};

export type AgentQueuePollerLoop = {
  processQueueMessage(queueMessage: QueueMessageRecord): Promise<void>;
};

export async function processNextAgentQueueItem(params: {
  store: AgentQueuePollerStore;
  loopService: AgentQueuePollerLoop;
  workerId: string;
  idleIntervalMs: number;
  pollIntervalMs: number;
  autonomousRuntimeEnabled?: boolean;
  autonomousRuntimeSliceIntervalMs?: number;
  getActiveRecoveryWindow?: () => Promise<ActiveRecoveryWindow>;
  getLatestRecoveryWindow?: () => Promise<ActiveRecoveryWindow>;
  onRecoveryWindowError?: (error: unknown) => void;
  onAutonomousRuntimeSliceError?: (error: unknown) => void;
}) {
  let queueMessage = await params.store.claimNextQueueMessage(params.workerId);
  if (!queueMessage) {
    const activeRecovery = params.getActiveRecoveryWindow
      ? await params.getActiveRecoveryWindow().catch((error) => {
          params.onRecoveryWindowError?.(error);
          return null;
        })
      : null;
    const remainingMs = Number(activeRecovery?.remainingMs || 0);
    if (Number.isFinite(remainingMs) && remainingMs > 0) {
      return Math.max(200, Math.min(remainingMs, params.idleIntervalMs));
    }
    const latestRecovery = params.getLatestRecoveryWindow
      ? await params.getLatestRecoveryWindow().catch((error) => {
          params.onRecoveryWindowError?.(error);
          return null;
        })
      : null;
    if (
      latestRecovery
      && latestRecovery.active !== true
      && latestRecovery.continuationQueued !== true
      && typeof params.store.enqueueSelfContinuationForRecovery === 'function'
    ) {
      const enqueued = await params.store.enqueueSelfContinuationForRecovery(latestRecovery);
      if (enqueued) {
        queueMessage = await params.store.claimNextQueueMessage(params.workerId);
        if (queueMessage) {
          await params.loopService.processQueueMessage(queueMessage);
          return params.pollIntervalMs;
        }
      }
    }
    if (params.autonomousRuntimeEnabled !== false && typeof params.store.enqueueAutonomousRuntimeSlice === 'function') {
      const enqueued = await params.store.enqueueAutonomousRuntimeSlice({
        minIntervalMs: params.autonomousRuntimeSliceIntervalMs
      }).catch((error) => {
        params.onAutonomousRuntimeSliceError?.(error);
        return false;
      });
      if (enqueued) {
        queueMessage = await params.store.claimNextQueueMessage(params.workerId);
        if (queueMessage) {
          await params.loopService.processQueueMessage(queueMessage);
          return params.pollIntervalMs;
        }
      }
    }
    return params.idleIntervalMs;
  }

  await params.loopService.processQueueMessage(queueMessage);
  return params.pollIntervalMs;
}

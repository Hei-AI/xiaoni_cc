import express from 'express';
import { agentConfig, serverConfig } from './config';
import { logger } from './utils/logger';
import { RuntimeStore } from './services/runtime-store';
import { AgentLoopService } from './services/agent-loop-service';
import { AgentTaskWorkerService } from './services/agent-task-worker-service';
import { SelfActionService } from './services/self-action-service';

const moduleLogger = logger.createModuleLogger('agent-service');
const app = express();
const store = new RuntimeStore();
const loopService = new AgentLoopService(store);
const taskWorkerService = new AgentTaskWorkerService();
const selfActionService = new SelfActionService(store);

let stopping = false;
let workerTimer: NodeJS.Timeout | null = null;
let taskWorkerTimer: NodeJS.Timeout | null = null;
let presenceTickTimer: NodeJS.Timeout | null = null;
let selfActionTimer: NodeJS.Timeout | null = null;
let workerBusy = false;
let taskWorkerBusy = false;
let presenceTickBusy = false;
let selfActionBusy = false;

app.use(express.json({ limit: '2mb' }));

app.get('/health', async (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'agent-service',
    worker_busy: workerBusy,
    task_worker_busy: taskWorkerBusy,
    presence_tick_busy: presenceTickBusy,
    self_action_busy: selfActionBusy,
    timestamp: new Date().toISOString()
  });
});

async function pollQueueOnce() {
  if (stopping || workerBusy) {
    scheduleNext(agentConfig.idleIntervalMs);
    return;
  }

  workerBusy = true;
  try {
    const queueMessage = await store.claimNextQueueMessage(agentConfig.workerId);
    if (!queueMessage) {
      scheduleNext(agentConfig.idleIntervalMs);
      return;
    }

    await loopService.processQueueMessage(queueMessage);
    scheduleNext(agentConfig.pollIntervalMs);
  } catch (error) {
    moduleLogger.error('Agent queue poll failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    scheduleNext(agentConfig.idleIntervalMs);
  } finally {
    workerBusy = false;
  }
}

function scheduleNext(delayMs: number) {
  if (stopping) {
    return;
  }
  if (workerTimer) {
    clearTimeout(workerTimer);
  }
  workerTimer = setTimeout(() => {
    void pollQueueOnce();
  }, delayMs);
}

async function pollTaskQueueOnce() {
  if (stopping || taskWorkerBusy) {
    scheduleNextTaskPoll(agentConfig.idleIntervalMs);
    return;
  }

  taskWorkerBusy = true;
  try {
    const processed = await taskWorkerService.processNext(`${agentConfig.workerId}:task`);
    scheduleNextTaskPoll(processed ? agentConfig.pollIntervalMs : agentConfig.idleIntervalMs);
  } catch (error) {
    moduleLogger.error('Agent task queue poll failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    scheduleNextTaskPoll(agentConfig.idleIntervalMs);
  } finally {
    taskWorkerBusy = false;
  }
}

function scheduleNextTaskPoll(delayMs: number) {
  if (stopping) {
    return;
  }
  if (taskWorkerTimer) {
    clearTimeout(taskWorkerTimer);
  }
  taskWorkerTimer = setTimeout(() => {
    void pollTaskQueueOnce();
  }, delayMs);
}

async function runPresenceTickOnce() {
  if (stopping || presenceTickBusy) {
    scheduleNextPresenceTick(agentConfig.presenceTickIntervalMs);
    return;
  }

  presenceTickBusy = true;
  try {
    const result = await store.enqueuePresenceTick();
    if (result.enqueued) {
      moduleLogger.info('Presence tick enqueued', {
        queue_id: result.queueId,
        target_session_key: result.targetSessionKey
      });
    }
  } catch (error) {
    moduleLogger.error('Presence tick failed', {
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    presenceTickBusy = false;
    scheduleNextPresenceTick(agentConfig.presenceTickIntervalMs);
  }
}

function scheduleNextPresenceTick(delayMs: number) {
  if (stopping || !agentConfig.presenceTickEnabled) {
    return;
  }
  if (presenceTickTimer) {
    clearTimeout(presenceTickTimer);
  }
  presenceTickTimer = setTimeout(() => {
    void runPresenceTickOnce();
  }, delayMs);
}

async function runSelfActionOnce() {
  if (stopping || selfActionBusy) {
    scheduleNextSelfAction(agentConfig.selfActionIntervalMs);
    return;
  }

  selfActionBusy = true;
  try {
    const result = await selfActionService.runOnce('background');
    if (result.ran) {
      moduleLogger.info('Self-action tick completed', {
        action_id: result.actionId,
        share_item_id: result.shareItemId
      });
    }
  } catch (error) {
    moduleLogger.error('Self-action tick failed', {
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    selfActionBusy = false;
    scheduleNextSelfAction(agentConfig.selfActionIntervalMs);
  }
}

function scheduleNextSelfAction(delayMs: number) {
  if (stopping || !agentConfig.selfActionEnabled) {
    return;
  }
  if (selfActionTimer) {
    clearTimeout(selfActionTimer);
  }
  selfActionTimer = setTimeout(() => {
    void runSelfActionOnce();
  }, delayMs);
}

async function shutdown(signal: string) {
  if (stopping) {
    return;
  }
  stopping = true;
  if (workerTimer) {
    clearTimeout(workerTimer);
    workerTimer = null;
  }
  if (taskWorkerTimer) {
    clearTimeout(taskWorkerTimer);
    taskWorkerTimer = null;
  }
  if (presenceTickTimer) {
    clearTimeout(presenceTickTimer);
    presenceTickTimer = null;
  }
  if (selfActionTimer) {
    clearTimeout(selfActionTimer);
    selfActionTimer = null;
  }
  moduleLogger.info('Shutting down agent service', { signal });
  await store.close().catch(() => undefined);
  process.exit(0);
}

async function start() {
  await store.initialize();
  app.listen(serverConfig.port, serverConfig.host, () => {
    moduleLogger.info('Agent service listening', {
      host: serverConfig.host,
      port: serverConfig.port
    });
  });
  scheduleNext(200);
  scheduleNextTaskPoll(500);
  scheduleNextPresenceTick(agentConfig.presenceTickIntervalMs);
  scheduleNextSelfAction(agentConfig.selfActionIntervalMs);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

void start().catch((error) => {
  moduleLogger.error('Failed to start agent service', {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});

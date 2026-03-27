import express from 'express';
import { agentConfig, serverConfig } from './config';
import { logger } from './utils/logger';
import { RuntimeStore } from './services/runtime-store';
import { AgentLoopService } from './services/agent-loop-service';

const moduleLogger = logger.createModuleLogger('agent-service');
const app = express();
const store = new RuntimeStore();
const loopService = new AgentLoopService(store);

let stopping = false;
let workerTimer: NodeJS.Timeout | null = null;
let workerBusy = false;

app.use(express.json({ limit: '2mb' }));

app.get('/health', async (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'agent-service',
    worker_busy: workerBusy,
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

async function shutdown(signal: string) {
  if (stopping) {
    return;
  }
  stopping = true;
  if (workerTimer) {
    clearTimeout(workerTimer);
    workerTimer = null;
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

import express from 'express';
import { agentConfig, serverConfig } from './config';
import { logger } from './utils/logger';
import { RuntimeStore } from './services/runtime-store';
import { AgentLoopService } from './services/agent-loop-service';
import { AgentTaskWorkerService } from './services/agent-task-worker-service';
import { QqUsageService, QqUsageSkillRuntime } from './services/qq-usage-service';

const moduleLogger = logger.createModuleLogger('agent-service');
const app = express();
const store = new RuntimeStore();
const loopService = new AgentLoopService(store);
const taskWorkerService = new AgentTaskWorkerService();
const qqUsageRuntime = new QqUsageSkillRuntime(new QqUsageService(store));

let stopping = false;
let workerBusy = false;
let taskWorkerBusy = false;
let autonomousLifeBusy = false;

app.use(express.json({ limit: '2mb' }));

app.get('/health', async (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'agent-service',
    worker_busy: workerBusy,
    task_worker_busy: taskWorkerBusy,
    autonomous_life_busy: autonomousLifeBusy,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/internal/qq-usage', async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  const args = body.args && typeof body.args === 'object' && !Array.isArray(body.args)
    ? body.args as Record<string, unknown>
    : {};
  const result = await qqUsageRuntime.execute(action, args);
  res.json({
    success: true,
    result
  });
});

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollQueueOnce() {
  if (stopping || workerBusy) {
    return agentConfig.idleIntervalMs;
  }

  workerBusy = true;
  try {
    const queueMessage = await store.claimNextQueueMessage(agentConfig.workerId);
    if (!queueMessage) {
      return agentConfig.idleIntervalMs;
    }

    await loopService.processQueueMessage(queueMessage);
    return agentConfig.pollIntervalMs;
  } catch (error) {
    moduleLogger.error('Agent queue poll failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    return agentConfig.idleIntervalMs;
  } finally {
    workerBusy = false;
  }
}

async function runQueueWorkerLoop() {
  while (!stopping) {
    const delayMs = await pollQueueOnce();
    if (!stopping) {
      await wait(delayMs);
    }
  }
}

async function pollTaskQueueOnce() {
  if (stopping || taskWorkerBusy) {
    return agentConfig.idleIntervalMs;
  }

  taskWorkerBusy = true;
  try {
    const processed = await taskWorkerService.processNext(`${agentConfig.workerId}:task`);
    return processed ? agentConfig.pollIntervalMs : agentConfig.idleIntervalMs;
  } catch (error) {
    moduleLogger.error('Agent task queue poll failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    return agentConfig.idleIntervalMs;
  } finally {
    taskWorkerBusy = false;
  }
}

async function runTaskWorkerLoop() {
  while (!stopping) {
    const delayMs = await pollTaskQueueOnce();
    if (!stopping) {
      await wait(delayMs);
    }
  }
}

async function enqueueAutonomousLifeOnce() {
  if (stopping || autonomousLifeBusy) {
    return agentConfig.autonomousLoopIntervalMs;
  }

  autonomousLifeBusy = true;
  try {
    const result = await store.enqueueAutonomousLifeStep();
    if (result.enqueued) {
      moduleLogger.info('Autonomous life step enqueued', {
        queue_id: result.queueId,
        mode: 'life_loop'
      });
    }
  } catch (error) {
    moduleLogger.error('Autonomous life step failed', {
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    autonomousLifeBusy = false;
  }

  return agentConfig.autonomousLoopIntervalMs;
}

async function runAutonomousLifeLoop() {
  while (!stopping) {
    const delayMs = await enqueueAutonomousLifeOnce();
    if (!stopping) {
      await wait(delayMs);
    }
  }
}

async function shutdown(signal: string) {
  if (stopping) {
    return;
  }
  stopping = true;
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
  void wait(200).then(() => runQueueWorkerLoop());
  void wait(500).then(() => runTaskWorkerLoop());
  void runAutonomousLifeLoop();
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

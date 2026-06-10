import express from 'express';
import { getActiveAgentRecoveryWindow, getAgentRuntimeControl, getLatestAgentRecoveryWindow } from '@qq-bot/persistence';
import { agentConfig, databaseConfig, serverConfig } from './config';
import { logger } from './utils/logger';
import { RuntimeStore } from './services/runtime-store';
import { AgentLoopService } from './services/agent-loop-service';
import { AgentTaskWorkerService } from './services/agent-task-worker-service';
import { processNextAgentQueueItem } from './services/agent-queue-worker';
import { QqUsageService, QqUsageSkillRuntime } from './services/qq-usage-service';

const moduleLogger = logger.createModuleLogger('agent-service');
const app = express();
const store = new RuntimeStore();
const loopService = new AgentLoopService(store, undefined, {
  isRuntimeEnabled
});
const taskWorkerService = new AgentTaskWorkerService();
const qqUsageRuntime = new QqUsageSkillRuntime(new QqUsageService(store), {
  botAccountId: agentConfig.botAccountId
});

let stopping = false;
let workerBusy = false;
let taskWorkerBusy = false;
let runtimeEnabled = true;
let lastProcessingRecoveryAt = 0;

app.use(express.json({ limit: '2mb' }));

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

app.get('/health', async (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'agent-service',
    worker_busy: workerBusy,
    task_worker_busy: taskWorkerBusy,
    runtime_enabled: runtimeEnabled,
    autonomous_runtime_enabled: agentConfig.autonomousRuntimeEnabled,
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
  const context = body.context && typeof body.context === 'object' && !Array.isArray(body.context)
    ? body.context as Record<string, unknown>
    : {};
  const result = await qqUsageRuntime.execute(action, args, {
    traceId: optionalString(context.trace_id ?? context.traceId),
    runId: optionalString(context.run_id ?? context.runId),
    batchId: optionalString(context.batch_id ?? context.batchId),
    toolCallId: optionalString(context.tool_call_id ?? context.toolCallId),
    toolName: optionalString(context.tool_name ?? context.toolName),
    sessionKey: optionalString(context.session_key ?? context.sessionKey)
  });
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

  await recoverStaleProcessingLeasesPeriodically();

  runtimeEnabled = await isRuntimeEnabled();
  if (!runtimeEnabled) {
    return agentConfig.idleIntervalMs;
  }

  workerBusy = true;
  try {
    return await processNextAgentQueueItem({
      store,
      loopService,
      workerId: agentConfig.workerId,
      idleIntervalMs: agentConfig.idleIntervalMs,
      pollIntervalMs: agentConfig.pollIntervalMs,
      autonomousRuntimeEnabled: agentConfig.autonomousRuntimeEnabled,
      autonomousRuntimeSliceIntervalMs: agentConfig.autonomousRuntimeSliceIntervalMs,
      getActiveRecoveryWindow: () => getActiveAgentRecoveryWindow({
        identityKey: 'xiaoni'
      }, databaseConfig),
      getLatestRecoveryWindow: () => getLatestAgentRecoveryWindow({
        identityKey: 'xiaoni'
      }, databaseConfig),
      onRecoveryWindowError: (error) => {
        moduleLogger.warn('Failed to check Xiaoni active recovery window', {
          error: error instanceof Error ? error.message : String(error)
        });
      },
      onAutonomousRuntimeSliceError: (error) => {
        moduleLogger.warn('Failed to enqueue Xiaoni autonomous runtime slice', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  } catch (error) {
    moduleLogger.error('Agent queue poll failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    return agentConfig.idleIntervalMs;
  } finally {
    workerBusy = false;
  }
}

async function recoverStaleProcessingLeasesPeriodically() {
  const now = Date.now();
  const minIntervalMs = Math.max(30_000, Math.min(agentConfig.processingRecoveryStaleMs, 60_000));
  if (now - lastProcessingRecoveryAt < minIntervalMs) {
    return;
  }
  lastProcessingRecoveryAt = now;
  const recovered = await store.recoverStaleProcessingLeases({
    staleMs: agentConfig.processingRecoveryStaleMs,
    reason: 'agent_service_periodic_recovery'
  }).catch((error) => {
    moduleLogger.warn('Failed to recover stale processing runs during queue polling', {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  });
  if (recovered && (recovered.failedRuns > 0 || recovered.settledRuns > 0 || recovered.failedQueueMessages > 0 || recovered.settledQueueMessages > 0)) {
    moduleLogger.warn('Recovered stale processing runs during queue polling', recovered);
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

  runtimeEnabled = await isRuntimeEnabled();
  if (!runtimeEnabled) {
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

async function isRuntimeEnabled() {
  try {
    const control = await getAgentRuntimeControl({ identityKey: 'xiaoni' }, databaseConfig);
    return control.enabled !== false;
  } catch (error) {
    moduleLogger.warn('Failed to load Xiaoni runtime control; defaulting enabled', {
      error: error instanceof Error ? error.message : String(error)
    });
    return true;
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

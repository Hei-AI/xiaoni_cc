import express from 'express';
import { getAgentRuntimeControl, triggerPostCompressionRuntimePause } from '@qq-bot/persistence';
import { agentConfig, databaseConfig, serverConfig } from './config';
import { logger } from './utils/logger';
import { RuntimeStore } from './services/runtime-store';
import { AgentLoopService, pruneExecOutput, setCompressionTriggerInputTokens, setCompressionTriggerWireBytes, setStripXiaoniOsFromRequests } from './services/agent-loop-service';
import { pruneOldResultFiles } from './services/web-search-archive';
import { AgentTaskWorkerService } from './services/agent-task-worker-service';
import { QqUsageService, QqUsageSkillRuntime } from './services/qq-usage-service';
import { QqSendImageService, QqSendImageSkillRuntime } from './services/qq-send-image-service';
import { QqProfileService, QqProfileSkillRuntime, QQ_PROFILE_ACTIONS } from './services/qq-profile-service';
import { XiaoniPromptDirectoryWatcher } from './prompts/xiaoni-prompt-directory-watcher';
import { XiaoniPromptReloadPolicy } from './prompts/xiaoni-prompt-reload-policy';

const moduleLogger = logger.createModuleLogger('agent-service');
const app = express();
const store = new RuntimeStore();
const loopService = new AgentLoopService(store, undefined, {
  isRuntimeEnabled,
  isCacheHeartbeatPaused,
  getMainAgentPreModelYieldMs,
  onCoreMemoryCompressionCommitted: handleCoreMemoryCompressionCommitted
});
const taskWorkerService = new AgentTaskWorkerService();
const qqUsageRuntime = new QqUsageSkillRuntime(new QqUsageService(store), {
  botAccountId: agentConfig.botAccountId
});
const qqSendImageLog = logger.createModuleLogger('qq-send-image');
const qqSendImageRuntime = new QqSendImageSkillRuntime(new QqSendImageService({
  providerServiceUrl: agentConfig.providerServiceUrl,
  logImageSend: (message, fields) => qqSendImageLog.info(message, fields)
}));
const qqProfileRuntime = new QqProfileSkillRuntime(new QqProfileService({
  providerServiceUrl: agentConfig.providerServiceUrl,
  botAccountId: agentConfig.botAccountId
}));

let stopping = false;
let workerBusy = false;
let taskWorkerBusy = false;
let runtimeEnabled = true;
let lastProcessingRecoveryAt = 0;
const promptReloadPolicy = new XiaoniPromptReloadPolicy();

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
    timestamp: new Date().toISOString()
  });
});

app.post('/api/internal/runtime/cache-heartbeat', async (_req, res) => {
  try {
    const result = await loopService.triggerCacheHeartbeatForDebug();
    res.json({
      success: true,
      result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    moduleLogger.warn('Manual cache heartbeat failed', { error: message });
    res.status(500).json({
      success: false,
      error: message
    });
  }
});

app.post('/api/internal/runtime/core-memory-compression/trigger', async (_req, res) => {
  try {
    const result = await loopService.triggerManualCoreMemoryCompression();
    res.json({
      success: true,
      result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    moduleLogger.warn('Manual core memory compression trigger failed', { error: message });
    res.status(500).json({
      success: false,
      error: message
    });
  }
});

app.get('/api/internal/runtime/core-memory-compression/status', async (req, res) => {
  try {
    const raw = req.query.compression_covered_end_stack_index ?? req.query.compression_covered_end_conversation_id;
    const coveredEnd = Number(Array.isArray(raw) ? raw[0] : raw);
    if (!Number.isFinite(coveredEnd)) {
      res.status(400).json({
        success: false,
        error: 'compression_covered_end_stack_index query param required'
      });
      return;
    }
    const result = await loopService.getCoreMemoryCompressionForkStatus(coveredEnd);
    res.json({
      success: true,
      result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    moduleLogger.warn('Core memory compression status check failed', { error: message });
    res.status(500).json({
      success: false,
      error: message
    });
  }
});

app.post('/api/internal/runtime/prompt/reload', async (_req, res) => {
  try {
    const hadPendingReload = promptReloadPolicy.clearPendingReload();
    const invalidated = loopService.invalidateStableRuntimePrompt('manual_force_load');
    moduleLogger.warn('Manual Xiaoni runtime prompt force-load requested', {
      invalidated,
      had_pending_reload: hadPendingReload
    });
    res.json({
      success: true,
      result: {
        invalidated,
        had_pending_reload: hadPendingReload,
        reason: 'manual_force_load'
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    moduleLogger.warn('Manual Xiaoni runtime prompt force-load failed', { error: message });
    res.status(500).json({
      success: false,
      error: message
    });
  }
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
  const ctx = {
    traceId: optionalString(context.trace_id ?? context.traceId),
    runId: optionalString(context.run_id ?? context.runId),
    batchId: optionalString(context.batch_id ?? context.batchId),
    toolCallId: optionalString(context.tool_call_id ?? context.toolCallId),
    toolName: optionalString(context.tool_name ?? context.toolName),
    sessionKey: optionalString(context.session_key ?? context.sessionKey)
  };
  // 资料面动作（换自己头像/改签名/改在线状态）委派给 qqProfileRuntime，走 provider->NapCat；
  // 其余导航/窗口动作仍由 qqUsageRuntime 处理（读写 PostgreSQL）。CLI 统一走这个端点。
  const result = QQ_PROFILE_ACTIONS.has(action)
    ? await qqProfileRuntime.execute(action, args, ctx)
    : await qqUsageRuntime.execute(action, args, ctx);
  res.json({
    success: true,
    result
  });
});

app.post('/api/internal/qq-send-image', async (req, res) => {
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
  const result = await qqSendImageRuntime.execute(action, args, {
    traceId: optionalString(context.trace_id ?? context.traceId),
    runId: optionalString(context.run_id ?? context.runId),
    batchId: optionalString(context.batch_id ?? context.batchId),
    toolCallId: optionalString(context.tool_call_id ?? context.toolCallId),
    toolName: optionalString(context.tool_name ?? context.toolName),
    sessionKey: optionalString(context.session_key ?? context.sessionKey)
  });
  // 记录小腻自己发出去的图片，供 qq_usage 会话窗口回看（同文字 reply）。最佳努力，不阻塞响应。
  // 铁律：窗口里给她的图片占位符 [图片:<id>] 必须是她 inspect_image_placeholder 真能解出的
  // id——只有当图落在 provider 能 materialize 的 /xiaoni-runtime/picture 下才注册成 media asset
  // 并渲染 id；否则只给纯 [图片] 标记，绝不给一个她解不出的假 id。
  try {
    if (result && !result.failed
      && (result.action === 'qq_send_image.send_private' || result.action === 'qq_send_image.send_group')) {
      const isGroup = result.action === 'qq_send_image.send_group';
      const peerId = optionalString(isGroup
        ? (args.group_id ?? args.groupId ?? args.target_group_id)
        : (args.user_id ?? args.userId ?? args.target_user_id));
      if (peerId) {
        const botAccountId = agentConfig.botAccountId || '1129974489';
        const chatType = isGroup ? 'group' : 'direct';
        const sessionKey = isGroup ? `qq:group:${peerId}` : `qq:direct:${botAccountId}:${peerId}`;
        const caption = optionalString(args.caption);
        const deliveryMessageId = optionalString((result as { message_id?: unknown }).message_id);
        const archivedPath = optionalString((result as { archived_path?: unknown }).archived_path);
        const imagePath = optionalString((result as { image_path?: unknown }).image_path);
        const mimeType = optionalString((result as { mime_type?: unknown }).mime_type);
        const runtimePictureRoot = `${(process.env.XIAONI_RUNTIME_ROOT || '/xiaoni-runtime').replace(/\/+$/, '')}/picture/`;

        // 优先用持久归档副本做 source_locator（一定在 picture 根下、重启不丢）；
        // 没归档成功时退化到原图。铁律：无论归档还是原图，都必须在 provider materialize 可读的
        // picture 根下才拿来注册——否则 inspect 解不出，绝不给她一个假占位符。对两者一视同仁地校验，
        // 使「id 必可解」成为结构不变量，而不是依赖 XIAONI_RUNTIME_ROOT 两服务恰好一致。
        const underPictureRoot = (p: string | null): p is string =>
          Boolean(p) && (p as string).startsWith(runtimePictureRoot);
        const sourceLocator = underPictureRoot(archivedPath)
          ? archivedPath
          : (underPictureRoot(imagePath) ? imagePath : null);
        let imageId: string | null = null;
        if (sourceLocator) {
          try {
            const asset = await store.upsertMediaAsset({
              source: 'xiaoni_outbound',
              sessionKey,
              chatType,
              peerId,
              accountId: botAccountId,
              senderId: botAccountId,
              senderName: '小腻',
              messageSid: deliveryMessageId || undefined,
              mediaTag: 'image_1',
              placeholder: '[图片]',
              mediaType: 'image',
              mimeType: mimeType || undefined,
              sourceLocator,
              traceId: optionalString(context.trace_id ?? context.traceId)
            });
            imageId = optionalString((asset as { id?: unknown })?.id);
          } catch {
            imageId = null;
          }
        }

        const imageMarker = imageId ? `[图片:${imageId}]` : '[图片]';
        const body = caption ? `${caption}\n${imageMarker}` : imageMarker;
        await store.recordQqUsageOutboundMessage({
          sessionKey,
          chatType,
          peerId,
          accountId: botAccountId,
          senderId: botAccountId,
          senderName: '小腻',
          deliveryMessageId,
          contentKind: 'image',
          bodyForAgent: body,
          rawBody: body,
          traceId: optionalString(context.trace_id ?? context.traceId),
          runId: optionalString(context.run_id ?? context.runId)
        }).catch(() => undefined);
      }
    }
  } catch {
    // 记录自发图片是最佳努力，绝不阻塞发送响应
  }
  res.json({
    success: true,
    result
  });
});

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    moduleLogger.warn('Failed to recover stale processing runs during runtime loop', {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  });
  if (recovered && (recovered.failedRuns > 0 || recovered.settledRuns > 0 || recovered.failedQueueMessages > 0 || recovered.settledQueueMessages > 0)) {
    moduleLogger.warn('Recovered stale processing runs during runtime loop', recovered);
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
    return processed ? 0 : agentConfig.idleIntervalMs;
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
    // Dynamically apply the admin-configurable compression trigger threshold each main-loop
    // poll so changes take effect within one iteration without a restart. Timing-only; never
    // touches the cacheable request prefix.
    setCompressionTriggerInputTokens(control.compressionTriggerInputTokens);
    // Same dynamic apply for the BYTE-side compression trigger (image-heavy runs blind-spot the
    // token trigger). Admin-configurable, one-poll latency, no restart. Timing-only; the estimate
    // never enters the cacheable request prefix.
    setCompressionTriggerWireBytes(control.compressionTriggerWireBytes);
    // Dynamically apply the xiaoni_os isolation toggle each poll (one-iteration latency, no
    // restart). Read as a per-run snapshot inside agent-loop-service so a mid-run flip can't make
    // a live request inconsistent with its own replay; frozen per-item flags keep cross-run replay
    // byte-identical. Flipping rewrites no history.
    setStripXiaoniOsFromRequests(control.stripXiaoniOsFromRequests);
    return control.enabled !== false;
  } catch (error) {
    moduleLogger.warn('Failed to load Xiaoni runtime control; defaulting enabled', {
      error: error instanceof Error ? error.message : String(error)
    });
    return true;
  }
}

async function isCacheHeartbeatPaused() {
  try {
    const control = await getAgentRuntimeControl({ identityKey: 'xiaoni' }, databaseConfig);
    return control.cacheHeartbeatPaused === true;
  } catch (error) {
    moduleLogger.warn('Failed to load Xiaoni cache heartbeat pause control; defaulting heartbeat enabled', {
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

async function getMainAgentPreModelYieldMs() {
  try {
    const control = await getAgentRuntimeControl({ identityKey: 'xiaoni' }, databaseConfig);
    return Number.isFinite(control.mainAgentPreModelYieldMs) && control.mainAgentPreModelYieldMs >= 0
      ? control.mainAgentPreModelYieldMs
      : agentConfig.mainAgentPreModelYieldMs;
  } catch (error) {
    moduleLogger.warn('Failed to load Xiaoni main agent pre-model yield control; using fallback', {
      error: error instanceof Error ? error.message : String(error),
      fallbackMs: agentConfig.mainAgentPreModelYieldMs
    });
    return agentConfig.mainAgentPreModelYieldMs;
  }
}

async function triggerRuntimePauseAfterCoreMemoryCompression() {
  const control = await triggerPostCompressionRuntimePause({
    identityKey: 'xiaoni',
    reason: 'core_memory_compression_completed'
  }, databaseConfig);
  runtimeEnabled = control.enabled !== false;
  // Only log a real pause-this-call. Previously this fired whenever the runtime
  // was disabled (for ANY reason, incl. a manual toggle) and a stale
  // triggered_at existed, falsely attributing the disable to compression.
  if (control.pauseJustTriggered) {
    moduleLogger.warn('Xiaoni runtime paused after core memory compression', {
      identityKey: control.identityKey,
      triggeredAt: control.postCompressionPauseTriggeredAt,
      reason: control.postCompressionPauseReason
    });
  }
}

async function handleCoreMemoryCompressionCommitted() {
  if (promptReloadPolicy.consumePostCompressionReload()) {
    const invalidated = loopService.invalidateStableRuntimePrompt('prompt_files_changed_after_core_memory_compression');
    moduleLogger.warn('Xiaoni prompt file reload armed after core memory compression', {
      reason: 'prefix_sensitive_prompt_files_changed',
      invalidated
    });
  }
  await triggerRuntimePauseAfterCoreMemoryCompression();
}

const promptDirectoryWatcher = new XiaoniPromptDirectoryWatcher({
  logger: moduleLogger,
  onChange: (change) => {
    const decision = promptReloadPolicy.recordPromptDirectoryChange(change);
    moduleLogger.info('Xiaoni prompt files changed', {
      fingerprint: change.fingerprint.slice(0, 12),
      file_count: change.fileCount,
      files: change.files,
      changed_files: decision.changedFiles,
      prefix_sensitive_files: decision.prefixSensitiveFiles,
      reload_policy: decision.reloadPolicy
    });
  }
});

async function runTaskWorkerLoop() {
  while (!stopping) {
    const delayMs = await pollTaskQueueOnce();
    if (!stopping && delayMs > 0) {
      await wait(delayMs);
    }
  }
}

const DEBUG_CACHE_HEARTBEAT_SUPERVISOR_TICK_MS = 10000;

// Operator-set interval (agent_runtime_control.debug_cache_heartbeat_interval_ms,
// 0 = off) that fires a debug cache heartbeat on its OWN timer — independent of the
// main loop's enabled flag and the sleep-heartbeat pause switch — so the provider
// prompt cache stays warm even while the runtime is stopped for 停机debug. The main
// loop's scheduled heartbeat only runs while enabled=true, so it can't help here.
//
// Dual-cache note: this reuses the existing triggerCacheHeartbeatForDebug fork path
// (a clone of the main agent request). Firing it more often only refreshes the
// provider cache; it never mutates the main agent's live request or stack-replay
// history (the heartbeat writes only its own cache_heartbeat fork ledger), so it
// introduces no cacheable-prefix drift and no run-boundary breakdown.
async function runDebugCacheHeartbeatLoop() {
  let lastFiredAtMs = 0;
  while (!stopping) {
    let sleepMs = DEBUG_CACHE_HEARTBEAT_SUPERVISOR_TICK_MS;
    try {
      const control = await getAgentRuntimeControl({ identityKey: 'xiaoni' }, databaseConfig);
      const intervalMs = Number.isFinite(control.debugCacheHeartbeatIntervalMs) && control.debugCacheHeartbeatIntervalMs > 0
        ? control.debugCacheHeartbeatIntervalMs
        : 0;
      if (intervalMs > 0) {
        const now = Date.now();
        if (lastFiredAtMs === 0 || now - lastFiredAtMs >= intervalMs) {
          lastFiredAtMs = now;
          moduleLogger.info('Firing debug-interval cache heartbeat', { intervalMs });
          try {
            const result = await loopService.triggerCacheHeartbeatForDebug();
            moduleLogger.info('Debug-interval cache heartbeat completed', {
              triggered: result.triggered,
              cachedInputTokens: result.cachedInputTokens,
              runId: result.runId
            });
          } catch (error) {
            moduleLogger.warn('Debug-interval cache heartbeat failed', {
              intervalMs,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
        // Poll at least as often as the interval so a shortened interval reacts quickly.
        sleepMs = Math.min(DEBUG_CACHE_HEARTBEAT_SUPERVISOR_TICK_MS, intervalMs);
      } else {
        // Disabled → reset so re-enabling fires promptly on the next tick.
        lastFiredAtMs = 0;
      }
    } catch (error) {
      moduleLogger.warn('Debug-interval cache heartbeat supervisor failed to read runtime control', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    if (!stopping) {
      await wait(sleepMs);
    }
  }
}

async function shutdown(signal: string) {
  if (stopping) {
    return;
  }
  stopping = true;
  moduleLogger.info('Shutting down agent service', { signal });
  promptDirectoryWatcher.stop();
  await store.close().catch(() => undefined);
  process.exit(0);
}

async function start() {
  await store.initialize();
  // Fork promises (core-memory compression / subconscious / image vision) live
  // only in the previous process. Anything left 'running' is orphaned by this
  // restart; reap it so a stale core-memory row doesn't block manual 压缩记忆.
  try {
    const reaped = await store.reapOrphanedForkRuns({ reason: 'orphaned_on_agent_service_restart' });
    if (reaped.total > 0) {
      moduleLogger.warn('Reaped orphaned fork runs on startup', reaped);
    }
  } catch (error) {
    moduleLogger.warn('Failed to reap orphaned fork runs on startup', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
  // Age-prune spilled web_search result files so /xiaoni-runtime/web-search
  // doesn't grow unbounded (best-effort; the dir may not exist yet).
  try {
    const removed = await pruneOldResultFiles(
      agentConfig.webSearchResultDir,
      agentConfig.webSearchResultTtlDays,
      Date.now()
    );
    if (removed > 0) {
      moduleLogger.info('Pruned stale web_search result files on startup', { removed });
    }
  } catch (error) {
    moduleLogger.warn('Failed to prune web_search result files on startup', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
  // Parity with xiaoni-executor: age-prune spilled exec_command output files
  // (only the local-dev fallback writes these; prod spills come from the executor).
  try {
    const removed = await pruneExecOutput();
    if (removed > 0) {
      moduleLogger.info('Pruned stale exec_command spill files on startup', { removed });
    }
  } catch (error) {
    moduleLogger.warn('Failed to prune exec_command spill files on startup', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
  promptDirectoryWatcher.start();
  app.listen(serverConfig.port, serverConfig.host, () => {
    moduleLogger.info('Agent service listening', {
      host: serverConfig.host,
      port: serverConfig.port
    });
  });
  void wait(200).then(() => loopService.runRuntimeLoop({
    workerId: agentConfig.workerId,
    idleIntervalMs: agentConfig.idleIntervalMs,
    isStopping: () => stopping,
    recoverStaleProcessingLeases: recoverStaleProcessingLeasesPeriodically,
    onBusyChange: (busy) => {
      workerBusy = busy;
    },
    onRuntimeEnabledChange: (enabled) => {
      runtimeEnabled = enabled;
    },
    onRuntimeLoopError: (error) => {
      moduleLogger.error('Agent runtime loop failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }));
  void wait(500).then(() => runTaskWorkerLoop());
  void wait(800).then(() => runDebugCacheHeartbeatLoop());
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

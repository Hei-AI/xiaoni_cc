import test from 'node:test';
import assert from 'node:assert/strict';
import { agentConfig } from '../config';
import { AgentLoopService } from '../services/agent-loop-service';
import { AgentPromptService, type ResolvedAgentRuntimePrompt } from '../services/agent-prompt-service';

process.env.XIAONI_GLOBAL_PROMPT_CONTEXT_SESSION_KEY = 'xiaoni:test-global';
agentConfig.mainAgentPreModelYieldMs = 0;

// Main-agent model switch (Opus 5.5 <-> Sonnet 5.5 <-> LongCat). The model id is part of the
// prompt-cache key, so a switch is a full cold read. The contract: a switch only takes effect on
// the compression STW frame — the one request that already cold-reads (and over the freshly
// compressed, small context) — so it costs ZERO extra cold reads. Requests before that frame stay
// on the old model (the compression fork rides the old warm cache); the frame and everything
// after it carry the new model, and the prefix stays warm from there on.

const EXEC_COMMAND_TOOL = 'exec_command';

function createRuntimePrompt(overrides: Partial<ResolvedAgentRuntimePrompt> = {}): ResolvedAgentRuntimePrompt {
  return {
    source: 'binding',
    promptId: 'prompt-1',
    promptName: 'xiaoni-main',
    modelName: 'claude-opus-4-6',
    systemPrompt: 'You are 小腻.',
    userPromptTemplate: null,
    contextVariables: {},
    runtimeVariables: {},
    parameters: {},
    toolNames: [EXEC_COMMAND_TOOL, 'send_in_group', 'send_in_private'],
    ...overrides
  } as ResolvedAgentRuntimePrompt;
}

function baseQueuePayload(overrides: Record<string, unknown> = {}) {
  return {
    traceId: 'runtrace-A',
    runId: 'run-A',
    batchId: 'batch-A',
    source: 'phone_notification',
    chatType: 'group',
    sessionKey: 'qq:group:101',
    peerId: '101',
    peerName: 'Test Group',
    senderId: '202',
    senderName: 'Alice',
    accountId: '303',
    bodyForAgent: '群里有人找你',
    rawBody: '群里有人找你',
    commandBody: '',
    wasMentioned: true,
    receivedAt: '2026-06-29T08:00:00.000Z',
    messageTimestamp: '2026-06-29T08:00:00.000Z',
    rawPayload: {},
    inboundContext: {},
    phoneNotification: {
      app: 'qq',
      notificationId: 'phone:A',
      sessionKey: 'qq:group:101',
      chatType: 'group',
      peerId: '101',
      peerName: 'Test Group',
      unreadDelta: 1,
      directMentions: 0,
      latestReceivedAt: '2026-06-29T08:00:00.000Z',
      reason: 'group_phone_notification'
    },
    messages: [{
      queueMessageId: 1,
      traceId: 'runtrace-A',
      source: 'napcat',
      messageId: 11,
      messageSid: 'sid-A',
      chatType: 'group',
      sessionKey: 'qq:group:101',
      peerId: '101',
      peerName: 'Test Group',
      senderId: '202',
      senderName: 'Alice',
      accountId: '303',
      bodyForAgent: '群里有人找你',
      rawBody: '群里有人找你',
      commandBody: '',
      wasMentioned: true,
      receivedAt: '2026-06-29T08:00:00.000Z',
      messageTimestamp: '2026-06-29T08:00:00.000Z',
      rawPayload: {},
      inboundContext: {}
    }],
    ...overrides
  };
}

function stripVolatile(input: any[]) {
  return (input || []).filter((item) => !item || (item as any).cache_volatile !== true);
}

function assertOrderedPrefix(seqA: any[], seqB: any[], label: string) {
  assert.ok(seqB.length >= seqA.length, `${label}: prefix must not shrink (${seqB.length} < ${seqA.length})`);
  for (let i = 0; i < seqA.length; i += 1) {
    assert.equal(JSON.stringify(seqB[i]), JSON.stringify(seqA[i]), `${label}: durable item ${i} diverged`);
  }
}

test('model switch lands on the compression STW frame: same frame as the 近况 swap, one transition, warm after', async () => {
  const KEY = 'xiaoni:test-global';
  const OLD_SUMMARY = '旧近况：很久以前的一大堆上下文';
  const NEW_SUMMARY = '压缩后近况：只保留最近的事';
  const NEW_CUTOFF = 300;
  const historyBlocks = [100, 200, 300, 400, 500].map((stackIndex) => ({
    stack_index: stackIndex, stackIndex, item_kind: 'runtime_input', itemKind: 'runtime_input',
    visibility: 'model_visible',
    content: { input_items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: `历史消息-${stackIndex}` }] }] }
  }));
  let cutoffFlipped = false;
  const timelineEvents: any[] = [];
  const store: any = {
    createLlmJob: async () => 'job-switch',
    logTimelineEvent: async (e: any) => { timelineEvents.push(e); },
    listAgentStackItems: async (params: any) => {
      const after = params.afterStackIndex ?? null;
      const floor = after === null || typeof after === 'undefined' ? -Infinity : Number(after);
      return historyBlocks.filter((b) => b.stack_index > floor).map((b) => ({ ...b }));
    },
    getSessionReadCutoffState: async () => cutoffFlipped
      ? { readCutoffAfterStackIndex: NEW_CUTOFF, contextSummary: NEW_SUMMARY, pendingProactiveShare: null, pendingProactiveShareAge: 0 }
      : { readCutoffAfterStackIndex: null, contextSummary: OLD_SUMMARY, pendingProactiveShare: null, pendingProactiveShareAge: 0 },
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    recordRuntimeIdentityActivation: async () => {},
    getExecutionLeaseDeliveryState: async () => ({ deliveryPhase: 'idle', deliveryCommitCount: 0, blockedDeliveryAttemptCount: 0, lastBlockedDeliveryReason: null }),
    markLeaseVisibleDeliveryCommitted: async () => {},
    markLeaseDeliveryBlocked: async () => {},
    completeAgentStackToolExecution: async () => {},
    recordAgentStackToolExecution: async () => {},
    getAgentStackHead: async () => 0,
    appendAgentStackItems: async () => [],
    updateLlmRequestSliceStackLinks: async () => null,
    foldPendingNotifyIntoRun: async () => null,
    createConversation: async () => 9999,
    attachConversationIdToTrace: async () => {},
    settleQueueMessages: async () => {},
    failQueueMessage: async () => {},
    releaseExecutionLease: async () => {},
    updateLlmJob: async () => {}
  };

  // The effective model the resolver reads (stands in for agent_runtime_control.main_agent_model).
  let effectiveModel = 'claude-opus-5-5';
  let resolveCount = 0;
  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => {
      resolveCount += 1;
      return createRuntimePrompt({ modelName: effectiveModel });
    }
  } as any);
  (service as any).executeTool = async () => ({ success: true, output: 'ok', message_type: 'tool_result' });

  const sent: Array<{ model: string; input: any[] }> = [];
  let turn = 0;
  (service as any).executeAgentTurn = async (canonicalRequest: any) => {
    sent.push({ model: canonicalRequest.model, input: canonicalRequest.input || [] });
    turn += 1;
    if (turn === 2) {
      // A compression commits while a switch to Sonnet 5.5 is pending. Same order as production:
      // the commit hook promotes the pending model and invalidates the snapshot, then the latch
      // is visible to the next silent point.
      cutoffFlipped = true;
      effectiveModel = 'claude-sonnet-5-5';
      service.invalidateStableRuntimePrompt('main_agent_model_switched_after_core_memory_compression');
      (service as any).pendingCompressionAppliedCutoffBySession.set(KEY, NEW_CUTOFF);
    }
    if (turn <= 5) {
      return { success: true, llm_call_id: `llm-sw-${turn}`, llm_request_slice_id: `slice-sw-${turn}`,
        canonical_response: { output: [{ type: 'function_call', call_id: `call-sw-${turn}`, name: EXEC_COMMAND_TOOL, arguments: `{"cmd":"echo ${turn}"}` }] } };
    }
    return { success: true, llm_call_id: `llm-sw-${turn}`, llm_request_slice_id: `slice-sw-${turn}`,
      canonical_response: { output: [{ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: '好。' }] }] } };
  };

  const queueMessage = { id: 'run-SW', traceId: 'runtrace-SW', batchId: 'batch-SW', status: 'processing',
    attempts: 1, maxAttempts: 3, queueMessageIds: [1], createdAt: '2026-06-29T08:00:00.000Z', payload: baseQueuePayload({ traceId: 'runtrace-SW', runId: 'run-SW' }) };
  await (service as any).processRuntimeFrame(queueMessage, { queueBacked: true });

  const epochs = sent.map((s) => JSON.stringify(s.input).includes(NEW_SUMMARY) ? 'new' : 'old');
  const firstNew = epochs.indexOf('new');
  assert.ok(firstNew >= 1, `expected the STW switch, epochs=${epochs.join(',')}`);
  const models = sent.map((s) => s.model);
  // Same frame: the model flips exactly where the compressed context comes in.
  assert.ok(models.slice(0, firstNew).every((m) => m === 'claude-opus-5-5'), `pre-switch requests stay on the old model: ${models}`);
  assert.ok(models.slice(firstNew).every((m) => m === 'claude-sonnet-5-5'), `the STW frame and later requests carry the new model: ${models}`);
  const midrun = timelineEvents.filter((e) => e.eventName === 'core_memory_compression_applied_midrun');
  assert.equal(midrun.length, 1);
  assert.equal(midrun[0].metadata.model, 'claude-sonnet-5-5');
  assert.equal(midrun[0].metadata.previous_model, 'claude-opus-5-5');
  // Warm after the switch frame.
  for (let i = firstNew; i + 1 < sent.length; i += 1) {
    assertOrderedPrefix(stripVolatile(sent[i].input), stripVolatile(sent[i + 1].input), `post-switch turn ${i}->${i + 1}`);
  }
  // The snapshot was rebuilt once for the run start and once for the switch — not per turn.
  assert.equal(resolveCount, 2);
});

test('no pending switch: the STW frame keeps the same snapshot object (no model change, no extra resolve)', async () => {
  const KEY = 'xiaoni:test-global';
  let cutoffFlipped = false;
  const store: any = {
    createLlmJob: async () => 'job-noswitch',
    logTimelineEvent: async () => {},
    listAgentStackItems: async () => [],
    getSessionReadCutoffState: async () => cutoffFlipped
      ? { readCutoffAfterStackIndex: 10, contextSummary: 'NEW', pendingProactiveShare: null, pendingProactiveShareAge: 0 }
      : { readCutoffAfterStackIndex: null, contextSummary: 'OLD', pendingProactiveShare: null, pendingProactiveShareAge: 0 },
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    recordRuntimeIdentityActivation: async () => {},
    getExecutionLeaseDeliveryState: async () => ({ deliveryPhase: 'idle', deliveryCommitCount: 0, blockedDeliveryAttemptCount: 0, lastBlockedDeliveryReason: null }),
    markLeaseVisibleDeliveryCommitted: async () => {},
    markLeaseDeliveryBlocked: async () => {},
    completeAgentStackToolExecution: async () => {},
    recordAgentStackToolExecution: async () => {},
    getAgentStackHead: async () => 0,
    appendAgentStackItems: async () => [],
    updateLlmRequestSliceStackLinks: async () => null,
    foldPendingNotifyIntoRun: async () => null,
    createConversation: async () => 9999,
    attachConversationIdToTrace: async () => {},
    settleQueueMessages: async () => {},
    failQueueMessage: async () => {},
    releaseExecutionLease: async () => {},
    updateLlmJob: async () => {}
  };
  let resolveCount = 0;
  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => { resolveCount += 1; return createRuntimePrompt({ modelName: 'claude-opus-5-5' }); }
  } as any);
  (service as any).executeTool = async () => ({ success: true, output: 'ok', message_type: 'tool_result' });
  const models: string[] = [];
  let turn = 0;
  (service as any).executeAgentTurn = async (canonicalRequest: any) => {
    models.push(canonicalRequest.model);
    turn += 1;
    if (turn === 1) {
      cutoffFlipped = true;
      (service as any).pendingCompressionAppliedCutoffBySession.set(KEY, 10);
    }
    if (turn <= 3) {
      return { success: true, llm_call_id: `llm-ns-${turn}`, llm_request_slice_id: `slice-ns-${turn}`,
        canonical_response: { output: [{ type: 'function_call', call_id: `call-ns-${turn}`, name: EXEC_COMMAND_TOOL, arguments: `{"cmd":"echo ${turn}"}` }] } };
    }
    return { success: true, llm_call_id: `llm-ns-${turn}`, llm_request_slice_id: `slice-ns-${turn}`,
      canonical_response: { output: [{ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: '好。' }] }] } };
  };
  const queueMessage = { id: 'run-NS', traceId: 'runtrace-NS', batchId: 'batch-NS', status: 'processing',
    attempts: 1, maxAttempts: 3, queueMessageIds: [1], createdAt: '2026-06-29T08:00:00.000Z', payload: baseQueuePayload({ traceId: 'runtrace-NS', runId: 'run-NS' }) };
  await (service as any).processRuntimeFrame(queueMessage, { queueBacked: true });
  assert.ok(models.length >= 3);
  assert.ok(models.every((m) => m === 'claude-opus-5-5'));
  assert.equal(resolveCount, 1);
});

test('AgentPromptService: effective model from the resolver; null -> env default; read failure keeps the running model', async () => {
  const payload = baseQueuePayload() as any;
  let next: () => Promise<string | null> = async () => 'claude-opus-5-5';
  const service = new AgentPromptService({ resolveMainAgentModelName: () => next() });
  assert.equal((await service.resolveForQueueMessage(payload)).modelName, 'claude-opus-5-5');
  next = async () => { throw new Error('db down'); };
  assert.equal((await service.resolveForQueueMessage(payload)).modelName, 'claude-opus-5-5', 'a failed read must not flip models');
  next = async () => null;
  assert.equal((await service.resolveForQueueMessage(payload)).modelName, agentConfig.xiaoniMainAgentModelName);

  const cold = new AgentPromptService({ resolveMainAgentModelName: async () => { throw new Error('db down'); } });
  await assert.rejects(() => cold.resolveForQueueMessage(payload), /db down/, 'no known model yet -> fail so the snapshot is retried');
});

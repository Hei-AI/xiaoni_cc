import test from 'node:test';
import assert from 'node:assert/strict';
import { agentConfig } from '../config';
import { AgentLoopService, XIAONI_IDENTITY_KEY, buildInitialInput, buildCanonicalAgentTurnRequest, formatEast8Timestamp } from '../services/agent-loop-service';
import { MissingAgentPromptBindingError, type ResolvedAgentRuntimePrompt } from '../services/agent-prompt-service';

process.env.XIAONI_GLOBAL_PROMPT_CONTEXT_SESSION_KEY = 'xiaoni:test-global';
agentConfig.mainAgentPreModelYieldMs = 0;

// End-to-end regression for the run-boundary prompt-cache breakdown.
//
// Acceptance criterion (user's): the input JSON the provider receives must have a
// byte-identical cacheable prefix across the run boundary. Concretely: every
// runtime_input the FOLDING run actually sent must be reproduced, verbatim and in
// order, by the NEXT run's stack-replay rebuild. If a folded notify is dropped
// from the replay (the bug), the next run's input diverges and the prompt cache
// breaks.
//
// The store below is a faithful in-memory stand-in: appendAgentStackItems honors
// ON CONFLICT(event_id) (content not rewritten), createConversation assigns ids,
// attachConversationIdToTrace COALESCE-backfills rows by trace_id, and
// listAgentStackItemsForConversations feeds the real replay path. No DB, no LLM —
// the model turns and tool result are mocked at the executeAgentTurn / executeTool
// seams.

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

// A folded notify, as foldPendingNotifyIntoRun would return it: keyed to the PARENT
// run id, carrying its OWN trace_id. Modeled as a plain inbound QQ batch (a real
// message arriving mid-run) so its rendered text is a controllable string we can
// assert on byte-for-byte. The event_id collision the fix addresses is on ALL
// runtime_input folds, not just phone_notifications.
function foldedNotify(parentRunId: string, parentBatchId: string, ownTraceId: string, reminder: string) {
  const innerMessage = {
    queueMessageId: 99,
    traceId: ownTraceId,
    source: 'napcat',
    messageId: 99,
    messageSid: ownTraceId,
    chatType: 'group',
    sessionKey: 'qq:group:101',
    peerId: '101',
    peerName: 'Test Group',
    senderId: '202',
    senderName: 'Alice',
    accountId: '303',
    bodyForAgent: reminder,
    rawBody: reminder,
    commandBody: '',
    wasMentioned: false,
    receivedAt: '2026-06-29T08:00:05.000Z',
    messageTimestamp: '2026-06-29T08:00:05.000Z',
    rawPayload: {},
    inboundContext: {}
  };
  return {
    id: parentRunId,
    traceId: ownTraceId,
    batchId: parentBatchId,
    status: 'consumed',
    attempts: 1,
    createdAt: '2026-06-29T08:00:05.000Z',
    queueMessageIds: [Number(ownTraceId.replace(/\D/g, '') || '0')],
    payload: baseQueuePayload({
      traceId: ownTraceId,
      runId: parentRunId,
      batchId: parentBatchId,
      source: 'napcat',
      phoneNotification: undefined,
      bodyForAgent: reminder,
      rawBody: reminder,
      messages: [innerMessage]
    })
  };
}

// Faithful in-memory store: stack with ON CONFLICT(event_id) dedup + conversation
// grouping + trace-keyed COALESCE backfill, plus the read paths replay needs.
function createFaithfulStore(opts: { foldsToServe: Array<ReturnType<typeof foldedNotify>> }) {
  const stack: Array<Record<string, unknown>> = [];
  let stackIndex = 0;
  let conversationSeq = 5000;
  const conversations: Array<{ id: number; traceId: string }> = [];
  const folds = [...opts.foldsToServe];
  const calls: Record<string, any[]> = { appendAgentStackItems: [], attachConversationIdToTrace: [], createConversation: [], failQueueMessage: [], retryQueueMessage: [] };

  const store: any = {
    createLlmJob: async () => 'job-A',
    logTimelineEvent: async () => {},
    listRecentTurns: async () => conversations.map((conv) => ({
      id: conv.id,
      userMessage: '',
      aiResponse: null,
      createdAt: '2026-06-29T08:00:00.000Z'
    })),
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    recordRuntimeIdentityActivation: async () => {},
    getExecutionLeaseDeliveryState: async () => ({
      deliveryPhase: 'idle',
      deliveryCommitCount: 0,
      blockedDeliveryAttemptCount: 0,
      lastBlockedDeliveryReason: null
    }),
    markLeaseVisibleDeliveryCommitted: async () => {},
    markLeaseDeliveryBlocked: async () => {},
    completeAgentStackToolExecution: async () => {},
    getAgentStackHead: async () => stackIndex,
    updateLlmRequestSliceStackLinks: async () => null,
    // The fold seam: serve one queued notify per call until exhausted.
    foldPendingNotifyIntoRun: async () => folds.shift() || null,
    appendAgentStackItems: async (params: any) => {
      calls.appendAgentStackItems.push(params);
      const out: Array<Record<string, unknown>> = [];
      for (const item of params.items || []) {
        const eventId = item.eventId || item.event_id;
        const existing = stack.find((row) => row.event_id === eventId);
        if (existing) {
          // ON CONFLICT(event_id) DO UPDATE SET updated_at -> content NOT rewritten.
          out.push(existing);
          continue;
        }
        stackIndex += 1;
        const row: Record<string, unknown> = {
          id: `stack-${stackIndex}`,
          event_id: eventId,
          identity_key: params.identityKey || XIAONI_IDENTITY_KEY,
          stack_index: stackIndex,
          stackIndex,
          item_kind: item.itemKind,
          itemKind: item.itemKind,
          role: item.role || null,
          tool_call_id: item.toolCallId || null,
          toolCallId: item.toolCallId || null,
          content: item.content,
          visibility: item.visibility || 'model_visible',
          source_type: params.sourceType || null,
          source_id: params.sourceId || null,
          trace_id: item.traceId || params.traceId || null,
          run_id: item.runId || params.runId || null,
          conversation_id: null
        };
        stack.push(row);
        out.push(row);
      }
      return out;
    },
    listAgentStackItemsForConversations: async (params: any) => {
      const ids = new Set((params.conversationIds || []).map((id: any) => Number(id)));
      return stack
        .filter((row) => row.conversation_id !== null && ids.has(Number(row.conversation_id)))
        .map((row) => ({ ...row }));
    },
    createConversation: async (params: any) => {
      calls.createConversation.push(params);
      conversationSeq += 1;
      conversations.push({ id: conversationSeq, traceId: params.traceId });
      return conversationSeq;
    },
    // COALESCE(conversation_id, ?) WHERE trace_id = ?  (first-write-wins).
    attachConversationIdToTrace: async (traceId: string, conversationId: number) => {
      calls.attachConversationIdToTrace.push({ traceId, conversationId });
      for (const row of stack) {
        if (row.trace_id === traceId && (row.conversation_id === null || row.conversation_id === undefined)) {
          row.conversation_id = conversationId;
        }
      }
    },
    settleQueueMessages: async () => {},
    failQueueMessage: async (runId: string, message: string, conversationId: number) => {
      calls.failQueueMessage.push({ runId, message, conversationId });
    },
    retryQueueMessage: async (runId: string, params: any) => {
      calls.retryQueueMessage.push({ runId, params });
      return 1;
    },
    releaseExecutionLease: async () => {},
    updateLlmJob: async () => {}
  };

  return { store, stack, calls, conversations };
}

test('next run replay reproduces every folded notify the folding run sent (cache prefix consistency)', async () => {
  const fold1Trace = 'runtrace-fold-1';
  const fold2Trace = 'runtrace-fold-2';
  const reminder1 = '【视线边缘】又堆积了 1 条新动静：阿花说做图修好了';
  const reminder2 = '【视线边缘】又堆积了 2 条新动静：群里 @了你';

  const { store, stack, calls } = createFaithfulStore({
    foldsToServe: [
      foldedNotify('run-A', 'batch-A', fold1Trace, reminder1),
      foldedNotify('run-A', 'batch-A', fold2Trace, reminder2)
    ]
  });

  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);

  // Mock the tool execution seam so tool-call turns don't hit the network.
  (service as any).executeTool = async () => ({
    success: true,
    output: 'ok',
    message_type: 'tool_result'
  });

  // Capture the input JSON sent to the provider on every turn.
  const sentInputs: any[][] = [];
  let turn = 0;
  (service as any).executeAgentTurn = async (canonicalRequest: any) => {
    sentInputs.push(canonicalRequest.input || []);
    turn += 1;
    // Turns 1 and 2 are tool calls: each yields without a lease release, so the
    // loop folds a pending notify between turns (this is exactly how the two
    // reminders entered the folding run's request live).
    if (turn <= 2) {
      return {
        success: true,
        llm_call_id: `llm-A-${turn}`,
        llm_request_slice_id: `slice-A-${turn}`,
        canonical_response: {
          output: [{
            type: 'function_call',
            call_id: `call-A-${turn}`,
            name: EXEC_COMMAND_TOOL,
            arguments: JSON.stringify({ cmd: `echo turn-${turn}` })
          }]
        }
      };
    }
    // Turn 3: final answer ends the run.
    return {
      success: true,
      llm_call_id: `llm-A-${turn}`,
      llm_request_slice_id: `slice-A-${turn}`,
      canonical_response: {
        output: [{
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: '好的我看到了。' }]
        }]
      }
    };
  };

  const queueMessage = {
    id: 'run-A',
    traceId: 'runtrace-A',
    batchId: 'batch-A',
    status: 'processing',
    attempts: 1,
    createdAt: '2026-06-29T08:00:00.000Z',
    queueMessageIds: [1],
    payload: baseQueuePayload()
  };

  await (service as any).processRuntimeFrame(queueMessage, { queueBacked: true });

  // --- What the folding run actually SENT to the provider ---
  const lastSent = sentInputs[sentInputs.length - 1];
  const sentText = JSON.stringify(lastSent);
  assert.ok(sentText.includes(reminder1), 'folding run must have sent reminder 1 live');
  assert.ok(sentText.includes(reminder2), 'folding run must have sent reminder 2 live');

  // --- The ledger persisted BOTH folds as distinct rows (not collapsed) ---
  const runtimeInputs = stack.filter((row) => row.item_kind === 'runtime_input');
  const persistedReminders = JSON.stringify(runtimeInputs.map((row) => row.content));
  assert.ok(persistedReminders.includes(reminder1), 'fold 1 must be persisted, not dropped by ON CONFLICT');
  assert.ok(persistedReminders.includes(reminder2), 'fold 2 must be persisted, not dropped by ON CONFLICT');
  // Each fold has its own distinct event_id (the fix).
  const eventIds = runtimeInputs.map((row) => row.event_id);
  assert.equal(new Set(eventIds).size, eventIds.length, 'every runtime_input must have a unique event_id');

  // Both folds were backfilled with the run's conversation id (settled path).
  assert.ok(runtimeInputs.every((row) => row.conversation_id !== null), 'all folds must be attached to the conversation');

  // --- What the NEXT run's stack-replay REBUILDS for that conversation ---
  const convId = (calls.createConversation.length, store) && stack.find((r) => r.item_kind === 'runtime_input')?.conversation_id;
  const replayed = await (service as any).attachStackReplayItemsToHistory(
    [{ id: Number(convId), userMessage: '', aiResponse: null }],
    'runtrace-B'
  );
  const replayText = JSON.stringify(replayed[0]?.stackReplayItems || []);
  // The acceptance criterion: the next run's rebuilt input reproduces BOTH folds.
  assert.ok(replayText.includes(reminder1), 'replay must reproduce folded reminder 1 (else cache prefix diverges)');
  assert.ok(replayText.includes(reminder2), 'replay must reproduce folded reminder 2 (else cache prefix diverges)');
});

// Drives a folding run whose provider throws on the turn AFTER the fold, then
// returns the captured store calls. errorMessage decides transient vs terminal.
async function runFoldingRunThatFails(errorMessage: string) {
  const foldTrace = 'runtrace-fold-fail';
  const reminder = '【掉线前】又有 1 条新动静：阿花在等你回';
  const built = createFaithfulStore({
    foldsToServe: [foldedNotify('run-A', 'batch-A', foldTrace, reminder)]
  });
  const service = new AgentLoopService(built.store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);
  (service as any).executeTool = async () => ({ success: true, output: 'ok', message_type: 'tool_result' });

  let turn = 0;
  (service as any).executeAgentTurn = async () => {
    turn += 1;
    if (turn === 1) {
      return {
        success: true,
        llm_call_id: 'llm-A-1',
        llm_request_slice_id: 'slice-A-1',
        canonical_response: {
          output: [{ type: 'function_call', call_id: 'call-A-1', name: EXEC_COMMAND_TOOL, arguments: '{"cmd":"echo 1"}' }]
        }
      };
    }
    throw new Error(errorMessage); // turn 2: provider blows up AFTER the fold
  };

  const queueMessage = {
    id: 'run-A',
    traceId: 'runtrace-A',
    batchId: 'batch-A',
    status: 'processing',
    attempts: 1,
    maxAttempts: 3,
    queueMessageIds: [1],
    createdAt: '2026-06-29T08:00:00.000Z',
    payload: baseQueuePayload()
  };
  await (service as any).processRuntimeFrame(queueMessage, { queueBacked: true });
  return { ...built, foldTrace, reminder };
}

test('provider TERMINAL failure: folded notify is backfilled to the failed conversation (replay stays consistent)', async () => {
  // A non-transient error message (no network/timeout keywords) -> terminal failure.
  const { calls, stack, foldTrace } = await runFoldingRunThatFails('模型返回了不可恢复的错误');

  // Terminal failure -> the run is failed, not retried.
  assert.equal(calls.retryQueueMessage.length, 0, 'terminal failure must not schedule a retry');
  assert.equal(calls.failQueueMessage.length, 1, 'terminal failure must fail the queue message');

  // The fold's trace was backfilled with the failed conversation id, so its stack
  // row is no longer orphaned (conversation_id !== null) and replay reproduces it.
  const backfilledFoldTrace = calls.attachConversationIdToTrace.some((c: any) => c.traceId === foldTrace);
  assert.ok(backfilledFoldTrace, 'terminal failure must backfill the folded-notify trace');
  const foldRow = stack.find((row) => row.trace_id === foldTrace && row.item_kind === 'runtime_input');
  assert.ok(foldRow, 'the folded notify must have been persisted');
  assert.ok(foldRow!.conversation_id !== null, 'the folded notify must be attached to the failed conversation');
});

test('provider TRANSIENT failure: folded notify stays NULL for the retry self-heal (no premature pin)', async () => {
  // A transient error message -> retry-eligible (attempts 1 < maxAttempts 3).
  const { calls, stack, foldTrace } = await runFoldingRunThatFails('fetch failed: socket timeout');

  // Transient failure -> a retry is scheduled, the queue message is NOT failed.
  assert.equal(calls.retryQueueMessage.length, 1, 'transient failure must schedule a retry');
  assert.equal(calls.failQueueMessage.length, 0, 'transient failure must not fail the queue message');

  // The fold's trace must NOT be backfilled to the failed conversation: COALESCE is
  // first-write-wins, so pinning it now would block the retry's success-settle from
  // attaching it to the real conversation. It stays NULL and rides the reprocess.
  const backfilledFoldTrace = calls.attachConversationIdToTrace.some((c: any) => c.traceId === foldTrace);
  assert.equal(backfilledFoldTrace, false, 'transient retry must NOT pin the fold to the failed conversation');
  const foldRow = stack.find((row) => row.trace_id === foldTrace && row.item_kind === 'runtime_input');
  assert.ok(foldRow, 'the folded notify must still be persisted');
  assert.equal(foldRow!.conversation_id, null, 'the folded notify must stay NULL for the retry self-heal');
});

// --- #1 + #2: main loop driven with type:text outputs + within-run prefix continuity ---
//
// The durable (non-cache_volatile) prefix of every provider request in a run must be
// an exact ordered prefix of the next turn's durable prefix — the warm cache only ever
// EXTENDS, it never diverges. This is the main loop's own 0-tolerance cache invariant.
// The run includes a turn where the model returns a type:text assistant output (a real
// production scenario) to prove text outputs don't perturb the cacheable prefix.

function stripVolatile(input: any[]) {
  return (input || []).filter((item) => !item || (item as any).cache_volatile !== true);
}

// Assert seqA is an exact ordered prefix of seqB (byte-identical, item by item).
function assertOrderedPrefix(seqA: any[], seqB: any[], label: string) {
  assert.ok(seqB.length >= seqA.length, `${label}: prefix must not shrink (${seqB.length} < ${seqA.length})`);
  for (let i = 0; i < seqA.length; i += 1) {
    assert.equal(
      JSON.stringify(seqB[i]),
      JSON.stringify(seqA[i]),
      `${label}: durable item ${i} diverged — cache prefix is not byte-identical`
    );
  }
}

test('main loop: durable prefix is byte-identical and monotonically extends across turns (incl. a type:text turn)', async () => {
  const { store } = createFaithfulStore({ foldsToServe: [] });
  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);
  (service as any).executeTool = async () => ({ success: true, output: 'ok', message_type: 'tool_result' });

  const sentInputs: any[][] = [];
  const modelOutputsByTurn: string[] = [];
  let turn = 0;
  (service as any).executeAgentTurn = async (canonicalRequest: any) => {
    sentInputs.push(canonicalRequest.input || []);
    turn += 1;
    if (turn === 1) {
      // PRODUCTION SCENARIO: model returns a plain type:text assistant output (narration).
      modelOutputsByTurn.push('text');
      return {
        success: true, llm_call_id: 'llm-1', llm_request_slice_id: 'slice-1',
        canonical_response: { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '我先想想怎么接。' }] }] }
      };
    }
    if (turn === 2 || turn === 3) {
      modelOutputsByTurn.push('tool');
      return {
        success: true, llm_call_id: `llm-${turn}`, llm_request_slice_id: `slice-${turn}`,
        canonical_response: { output: [{ type: 'function_call', call_id: `call-${turn}`, name: EXEC_COMMAND_TOOL, arguments: `{"cmd":"echo ${turn}"}` }] }
      };
    }
    modelOutputsByTurn.push('final');
    return {
      success: true, llm_call_id: `llm-${turn}`, llm_request_slice_id: `slice-${turn}`,
      canonical_response: { output: [{ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: '好了。' }] }] }
    };
  };

  const queueMessage = {
    id: 'run-A', traceId: 'runtrace-A', batchId: 'batch-A', status: 'processing',
    attempts: 1, maxAttempts: 3, queueMessageIds: [1], createdAt: '2026-06-29T08:00:00.000Z',
    payload: baseQueuePayload()
  };
  await (service as any).processRuntimeFrame(queueMessage, { queueBacked: true });

  // The type:text scenario actually ran as turn 1, and the loop continued past it.
  assert.equal(modelOutputsByTurn[0], 'text', 'turn 1 must have exercised a type:text output');
  assert.ok(sentInputs.length >= 3, `expected a multi-turn run, got ${sentInputs.length} turns`);

  // 0-tolerance: every turn's durable prefix is an exact ordered prefix of the next.
  for (let i = 0; i + 1 < sentInputs.length; i += 1) {
    assertOrderedPrefix(stripVolatile(sentInputs[i]), stripVolatile(sentInputs[i + 1]), `turn ${i + 1}->${i + 2}`);
  }

  // The volatile current-turn trigger is the ONLY thing allowed to vary turn to turn:
  // it must be tagged cache_volatile so it never anchors the cached prefix.
  for (let i = 0; i < sentInputs.length; i += 1) {
    const volatileItems = (sentInputs[i] || []).filter((item: any) => item && item.cache_volatile === true);
    assert.ok(volatileItems.length >= 1, `turn ${i + 1}: the current-turn trigger must be tagged cache_volatile`);
  }
});

// --- #3: time-drift. The cacheable prefix must be byte-identical across a wall-clock
// change. Any re-rendered timestamp (new Date()) that leaks into the durable prefix
// (system instructions, tools, or non-volatile input) drifts the cached body at every
// run/heartbeat boundary -> cache miss. Patch the global clock, rebuild, compare.
const RealDate = Date;
function patchClock(iso: string) {
  const fixed = new RealDate(iso).getTime();
  class FakeDate extends RealDate {
    constructor(...args: any[]) { super(...((args.length ? args : [fixed]) as [])); }
    static now() { return fixed; }
  }
  (globalThis as any).Date = FakeDate;
}
function restoreClock() { (globalThis as any).Date = RealDate; }

test('main request: cacheable prefix (system + tools + durable input) is byte-identical across wall-clock change', () => {
  try {
    patchClock('2026-06-29T10:00:00+08:00');
    const morningStamp = formatEast8Timestamp();
    const reqMorning = buildCanonicalAgentTurnRequest(agentConfig.modelName, buildInitialInput([], baseQueuePayload() as any), 'group');

    patchClock('2026-06-29T23:45:00+08:00');
    const nightStamp = formatEast8Timestamp();
    const reqNight = buildCanonicalAgentTurnRequest(agentConfig.modelName, buildInitialInput([], baseQueuePayload() as any), 'group');

    // Sanity: the clock patch is effective (otherwise the test would be vacuous).
    assert.notEqual(morningStamp, nightStamp, 'clock patch must change the wall-clock stamp');

    // System prompt tier — the largest cached prefix — must be time-free.
    assert.equal(JSON.stringify(reqMorning.instructions), JSON.stringify(reqNight.instructions), 'system instructions must not carry a wall-clock stamp');
    assert.equal(JSON.stringify(reqMorning.tools), JSON.stringify(reqNight.tools), 'tools must not carry a wall-clock stamp');
    // Durable (non-cache_volatile) input must be byte-identical both directions == equal.
    assertOrderedPrefix(stripVolatile(reqMorning.input), stripVolatile(reqNight.input), 'time-drift fwd');
    assertOrderedPrefix(stripVolatile(reqNight.input), stripVolatile(reqMorning.input), 'time-drift rev');
  } finally {
    restoreClock();
  }
});

// --- compression fork FULL trigger->dispatch e2e ---
// Calls the REAL runCoreMemoryCompressionFork with the baseRequest the main loop
// passes (buildMainAgentCanonicalRequest(prompt, requestInput, payload) @ 6302),
// captures the request actually handed to the provider seam
// (executeCoreMemoryCompressionForkTurn), and asserts its prefix is byte-identical
// to the main request. This catches the wiring class of bug the compression fork
// historically had: a head-only baseRequest that cold-prefilled a separate request
// instead of riding the main loop's warm cache.
test('compression fork dispatch: real runCoreMemoryCompressionFork sends a byte-identical prefix + reminder tail', async () => {
  const { store } = createFaithfulStore({ foldsToServe: [] });
  const service = new AgentLoopService(store, {
    resolveForQueueMessage: async () => createRuntimePrompt()
  } as any);
  (service as any).recordCoreMemoryCompressionForkRunSafe = async () => {};

  // Production-shaped main request (what the main loop passes as baseRequest): user
  // message, assistant type:text output, a tool pair, and a system_reminder.
  const mainInput = [
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: '群里在聊桌游' }] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '我看看他们聊到哪了。' }] },
    { type: 'function_call', call_id: 'c1', name: EXEC_COMMAND_TOOL, arguments: '{"cmd":"ls"}' },
    { type: 'function_call_output', call_id: 'c1', output: 'notes.md' },
    { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<system_reminder>x</system_reminder>' }] }
  ] as any[];
  const baseRequest = buildCanonicalAgentTurnRequest(agentConfig.modelName, mainInput, 'group');
  const baseSnapshot = JSON.stringify(baseRequest.input);
  const reminderTail = [{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<compress>把旧上下文压缩成近况</compress>' }] }] as any[];

  let captured: any = null;
  (service as any).executeCoreMemoryCompressionForkTurn = async (forkRequest: any) => {
    captured = forkRequest;
    throw new Error('__CAPTURED_FORK__');
  };

  await assert.rejects(() => (service as any).runCoreMemoryCompressionFork({
    baseRequest,
    queueMessage: baseQueuePayload(),
    runtimePrompt: createRuntimePrompt(),
    compression: {
      contextSessionKey: 'xiaoni:test-global',
      readCutoffAfterConversationId: 5,
      previousReadCutoffAfterConversationId: null,
      compressionCoveredEndConversationId: 5
    },
    contextSessionKey: 'xiaoni:test-global',
    compressionReminderItems: reminderTail,
    bypassRuntimeEnabledGate: true
  }), /__CAPTURED_FORK__/);

  assert.ok(captured, 'the compression fork must have dispatched a model turn');
  // 0-tolerance: the dispatched fork's cloned prefix is byte-identical to the main request.
  assert.equal(
    JSON.stringify(captured.input.slice(0, baseRequest.input.length)),
    baseSnapshot,
    'compression fork dispatched prefix must equal the main request (NOT head-only)'
  );
  assert.deepEqual(captured.instructions, baseRequest.instructions, 'system instructions must match the main loop');
  assert.deepEqual(captured.tools, baseRequest.tools, 'tools must match the main loop');
  assert.deepEqual(captured.tool_choice, baseRequest.tool_choice, 'tool_choice must match the main loop');
  // The compression instruction rides as the tail, not spliced into the prefix.
  const tail = captured.input.slice(baseRequest.input.length);
  assert.ok(JSON.stringify(tail).includes('把旧上下文压缩成近况'), 'compression reminder must ride as a cold tail');
  // Building the fork must not mutate the base request the main turn reuses.
  assert.equal(JSON.stringify(baseRequest.input), baseSnapshot, 'fork dispatch must not mutate the base request');
});

// =====================================================================================
// REAL-Postgres runtime replay e2e.
//
// In production the main agent rebuilds history by reading agent_stack_items FROM the
// database. So the truest test of the cache-prefix invariant drives processRuntimeFrame
// against a REAL Postgres: the fold path appends rows to the DB, settle backfills their
// conversation id by trace, and the replay read (listAgentStackItemsForConversations)
// reconstructs history from the DB — exactly the production path. This also exercises
// the real UNIQUE(event_id) + ON CONFLICT, so it validates the event_id fix end to end.
//
// Isolated throwaway DB (qqbot_cache_test); never touches qqbot_db. Skips if no DB.
// =====================================================================================
// eslint-disable-next-line @typescript-eslint/no-var-requires
const persistencePkg: any = require('@qq-bot/persistence');

const REALDB_HOST = process.env.DB_HOST || 'localhost';
const REALDB_PORT = process.env.DB_PORT || '5432';
const REALDB_USER = process.env.DB_USER || 'qqbot_user';
const REALDB_PW = process.env.DB_PASSWORD || 'qqbot_password';
const REALDB_NAME = 'qqbot_cache_test';
const REALDB_URL = process.env.CACHE_TEST_DATABASE_URL
  || `postgresql://${REALDB_USER}:${REALDB_PW}@${REALDB_HOST}:${REALDB_PORT}/${REALDB_NAME}`;
const REALDB_ADMIN_URL = `postgresql://${REALDB_USER}:${REALDB_PW}@${REALDB_HOST}:${REALDB_PORT}/postgres`;

let realSql: any = null;
let realPersistence: any = null;
let realDbReady = false;

test.before(async () => {
  try {
    const admin = persistencePkg.createSqlAdapter({ databaseUrl: REALDB_ADMIN_URL });
    try {
      if (!(await admin.testConnection())) throw new Error('no maintenance DB');
      const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = ?', [REALDB_NAME]);
      if (existing.length === 0) await admin.execute(`CREATE DATABASE ${REALDB_NAME}`, []);
    } finally {
      await admin.close().catch(() => {});
    }
    realSql = persistencePkg.createSqlAdapter({ databaseUrl: REALDB_URL });
    if (!(await realSql.testConnection())) throw new Error('testConnection false');
    realPersistence = persistencePkg.createXiaoniAgentStackPersistence({ sqlAdapter: realSql });
    await realPersistence.ensureXiaoniAgentStackSchema();
    realDbReady = true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.log(`[skip] runtime real-DB replay e2e: ${error instanceof Error ? error.message : String(error)}`);
    realDbReady = false;
  }
});

test.after(async () => {
  if (realSql) await realSql.close().catch(() => {});
});

// A store whose STACK methods hit real Postgres (mirroring RuntimeStore's wrappers),
// everything else mocked. The cache-critical append/backfill/replay-read path is real.
function createDbBackedStore() {
  const conversations: Array<{ id: number; traceId: string }> = [];
  let conversationSeq = 9000;
  return {
    createLlmJob: async () => 'job-realdb',
    logTimelineEvent: async () => {},
    listRecentTurns: async () => conversations.map((c) => ({ id: c.id, userMessage: '', aiResponse: null, createdAt: '2026-06-29T08:00:00.000Z' })),
    getSessionReadCutoffState: async () => null,
    upsertSessionReadCutoffState: async () => {},
    upsertProactiveShareState: async () => {},
    recordRuntimeIdentityActivation: async () => {},
    getExecutionLeaseDeliveryState: async () => ({ deliveryPhase: 'idle', deliveryCommitCount: 0, blockedDeliveryAttemptCount: 0, lastBlockedDeliveryReason: null }),
    markLeaseVisibleDeliveryCommitted: async () => {},
    markLeaseDeliveryBlocked: async () => {},
    completeAgentStackToolExecution: async () => {},
    recordAgentStackToolExecution: async () => {},
    updateLlmRequestSliceStackLinks: async () => null,
    foldPendingNotifyIntoRun: (() => {
      const folds: any[] = [
        foldedNotify('run-RDB', 'batch-RDB', 'runtrace-rdb-fold-1', '【实库】又堆积了 1 条新动静：阿花修好了做图'),
        foldedNotify('run-RDB', 'batch-RDB', 'runtrace-rdb-fold-2', '【实库】又堆积了 2 条新动静：群里 @了你')
      ];
      return async () => folds.shift() || null;
    })(),
    // --- the 4 stack methods delegate to REAL Postgres (mirror RuntimeStore) ---
    appendAgentStackItems: async (params: any) => realPersistence.appendAgentStackItems({ identityKey: 'xiaoni', ...params }),
    listAgentStackItemsForConversations: async (params: any) => realPersistence.listAgentStackItemsForConversations({ identityKey: 'xiaoni', ...params }),
    attachConversationIdToTrace: async (traceId: string, conversationId: number) =>
      realPersistence.attachConversationIdToAgentStackByTrace({ traceId, conversationId }),
    getAgentStackHead: async () => realPersistence.getAgentStackHead({ identityKey: 'xiaoni' }),
    createConversation: async (params: any) => { conversationSeq += 1; conversations.push({ id: conversationSeq, traceId: params.traceId }); return conversationSeq; },
    settleQueueMessages: async () => {},
    failQueueMessage: async () => {},
    retryQueueMessage: async () => 1,
    releaseExecutionLease: async () => {},
    updateLlmJob: async () => {},
    __conversations: conversations
  } as any;
}

test('runtime replay from REAL Postgres reproduces every folded notify (production DB path)', async (t) => {
  if (!realDbReady) { t.skip('real cache test DB unavailable'); return; }
  await realSql.execute('TRUNCATE agent_stack_items RESTART IDENTITY', []);

  const store = createDbBackedStore();
  const service = new AgentLoopService(store, { resolveForQueueMessage: async () => createRuntimePrompt() } as any);
  (service as any).executeTool = async () => ({ success: true, output: 'ok', message_type: 'tool_result' });

  let turn = 0;
  (service as any).executeAgentTurn = async () => {
    turn += 1;
    if (turn <= 2) {
      return { success: true, llm_call_id: `llm-rdb-${turn}`, llm_request_slice_id: `slice-rdb-${turn}`,
        canonical_response: { output: [{ type: 'function_call', call_id: `call-rdb-${turn}`, name: EXEC_COMMAND_TOOL, arguments: `{"cmd":"echo ${turn}"}` }] } };
    }
    return { success: true, llm_call_id: `llm-rdb-${turn}`, llm_request_slice_id: `slice-rdb-${turn}`,
      canonical_response: { output: [{ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: '好。' }] }] } };
  };

  const queueMessage = {
    id: 'run-RDB', traceId: 'runtrace-RDB', batchId: 'batch-RDB', status: 'processing',
    attempts: 1, maxAttempts: 3, queueMessageIds: [1], createdAt: '2026-06-29T08:00:00.000Z',
    payload: baseQueuePayload({ traceId: 'runtrace-RDB', runId: 'run-RDB', batchId: 'batch-RDB' })
  };
  await (service as any).processRuntimeFrame(queueMessage, { queueBacked: true });

  const convId = store.__conversations[0]?.id;
  assert.ok(convId, 'the run must have created a conversation');

  // Replay EXACTLY as production does: read agent_stack_items from Postgres by conversation.
  const replayed = await (service as any).attachStackReplayItemsToHistory(
    [{ id: Number(convId), userMessage: '', aiResponse: null }],
    'runtrace-REPLAY'
  );
  const replayText = JSON.stringify(replayed[0]?.stackReplayItems || []);
  assert.ok(replayText.includes('阿花修好了做图'), 'DB replay must reproduce folded reminder 1');
  assert.ok(replayText.includes('群里 @了你'), 'DB replay must reproduce folded reminder 2');

  // And the underlying rows: both folds persisted with distinct event_ids (the fix),
  // backfilled to the conversation (NOT dropped by ON CONFLICT on real PG).
  const rows = await realPersistence.listAgentStackItemsForConversations({ identityKey: 'xiaoni', conversationIds: [convId], limit: 1000 });
  const runtimeInputs = rows.filter((r: any) => r.itemKind === 'runtime_input');
  const eventIds = runtimeInputs.map((r: any) => r.eventId);
  assert.equal(new Set(eventIds).size, eventIds.length, 'every runtime_input must have a distinct event_id on real PG');
});

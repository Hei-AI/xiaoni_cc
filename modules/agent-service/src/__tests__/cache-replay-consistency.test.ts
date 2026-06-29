import test from 'node:test';
import assert from 'node:assert/strict';
import { agentConfig } from '../config';
import { AgentLoopService, XIAONI_IDENTITY_KEY } from '../services/agent-loop-service';
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

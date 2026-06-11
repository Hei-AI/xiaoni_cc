const test = require('node:test');
const assert = require('node:assert/strict');
const { createXiaoniActivityPersistence } = require('../xiaoni-activity');

function createPersistence(overrides = {}) {
  const prisma = {
    agentSessionLifeState: {
      findUnique: async () => overrides.lifeState || null
    },
    agentLifeEvent: {
      findMany: async () => overrides.lifeEvents || []
    },
    agentDigitalAction: {
      findMany: async () => overrides.digitalActions || [],
      count: async () => 0
    },
    agentTask: {
      findMany: async () => [],
      count: async () => 0
    },
    agentMediaAsset: {
      findMany: async () => []
    },
    agentQueueMessage: {
      findMany: async () => [],
      count: async () => 0
    }
  };
  const sqlAdapter = () => ({
    query: async (statement) => {
      if (statement.includes('FROM agent_queue_messages') && statement.includes("source IN ('phone_notification')")) {
        return overrides.autonomousQueueRows || [];
      }
      if (statement.includes('FROM agent_queue_messages')) {
        return overrides.queueRows || [];
      }
      return [];
    },
    close: async () => undefined
  });
  return createXiaoniActivityPersistence({
    getPrismaClient: () => prisma,
    createSqlAdapter: sqlAdapter,
    listLlmRequestSlices: async () => overrides.llmRequestSliceRows || overrides.llmRows || [],
    listAgentStackItems: async () => overrides.agentStackRows || [],
    listToolExecutions: async () => overrides.agentStackToolRows || [],
    findAgentStackItemByEventId: async (eventId) => (overrides.agentStackRows || []).find((row) => row.eventId === eventId) || null
  });
}

test('Xiaoni activity feed serializes Date values as real instants', async () => {
  const occurredAt = new Date('2026-05-31T04:14:59.037Z');
  const persistence = createPersistence({
    lifeEvents: [{
      id: 361,
      identity_key: 'xiaoni',
      event_kind: 'self_action_completed',
      occurred_at: occurredAt,
      surface: 'background',
      actor_type: 'xiaoni',
      visibility: 'private',
      payload: {
        action_type: 'reflect',
        residue_text: '这句先放着，没必要马上发。',
        result_summary: '把刚才留下的材料又看了一眼，决定先不急着往群里丢。'
      }
    }]
  });

  const feed = await persistence.getXiaoniActivityFeed({ limit: 5 });

  assert.equal(feed.items[0].timestamp, '2026-05-31T04:14:59.037Z');
  assert.equal(feed.current.latestActivityAt, '2026-05-31T04:14:59.037Z');
  assert.equal(feed.items[0].body, '这句先放着，没必要马上发。');
});

test('Xiaoni activity feed hides life-event engineering payload fields', async () => {
  const persistence = createPersistence({
    lifeEvents: [{
      id: 443,
      identity_key: 'xiaoni',
      event_kind: 'silence_decision',
      occurred_at: new Date('2026-05-31T11:37:13.467Z'),
      surface: 'qq',
      chat_type: 'group',
      actor_type: 'xiaoni',
      visibility: 'self_private',
      payload: {
        reason: '没有具体可说点。',
        source: 'phone_notification',
        run_id: 'run_1',
        trace_id: 'trace_1',
        batch_id: 'batch_1',
        message_sid: 'sid_1',
        account_id: '1129974489',
        chat_type: 'group',
        peer_name: '群 1040740258'
      }
    }]
  });

  const feed = await persistence.getXiaoniActivityFeed({ limit: 5 });
  const item = feed.items[0];
  const serializedPayload = JSON.stringify(item.metadata.payload);

  assert.equal(item.body, '没有具体可说点。');
  assert.equal(item.metadata.payload.reason, '没有具体可说点。');
  assert.equal(item.metadata.payload.chat_type, 'group');
  assert.equal(item.metadata.payload.peer_name, '群 1040740258');
  assert.equal(serializedPayload.includes('run_1'), false);
  assert.equal(serializedPayload.includes('trace_1'), false);
  assert.equal(serializedPayload.includes('phone_notification'), false);
  assert.equal(serializedPayload.includes('sid_1'), false);
  assert.equal(String(item.metadata.payloadPreview).includes('run_1'), false);
});

test('Xiaoni activity feed explains skipped presence checks without legacy scheduler wording', async () => {
  const persistence = createPersistence({
    lifeEvents: [{
      id: 1146,
      identity_key: 'xiaoni',
      event_kind: 'presence_tick_evaluated',
      occurred_at: new Date('2026-05-31T13:20:04.715Z'),
      surface: 'presence_tick',
      actor_type: 'xiaoni',
      visibility: 'self_private',
      payload: {
        eligible: false,
        enqueued: false,
        reason: 'fatigue',
        skip_reason: 'fatigue',
        queue_id: null,
        queue_status: null,
        snapshot: {
          energy: 0,
          action_cost: 1
        }
      }
    }]
  });

  const feed = await persistence.getXiaoniActivityFeed({ limit: 5 });
  const item = feed.items[0];

  assert.equal(item.title, '空闲检查记录');
  assert.equal(item.body, '精力不足，暂不主动看群；恢复按休息或睡眠节奏记录。');
  assert.equal(item.metadata.payload.reason, 'fatigue');
  assert.equal(item.metadata.payload.skip_reason, 'fatigue');
  assert.equal(feed.current.autonomy.latestPresenceEvaluationReason, 'fatigue');
  assert.equal(JSON.stringify(item).includes('旧版调度器'), false);
});

test('Xiaoni activity feed keeps sensory queue timestamps in storage timezone', async () => {
  const queueRow = {
    id: 4161,
    trace_id: 'runtrace_1',
    run_id: 'run_1',
    source: 'phone_notification',
    status: 'completed',
    body_for_agent: '手机状态栏有 1 条 QQ 未读',
    updated_at: '2026-05-31T14:29:23.395+08:00',
    created_at: '2026-05-31T06:28:55.635+08:00',
    locked_at: '2026-05-31T14:28:56.395+08:00',
    processing_started_at: '2026-05-31T14:28:56.395+08:00',
    available_at: '2026-05-31T06:28:55.635+08:00',
    completed_at: '2026-05-31T14:29:23.395+08:00',
    attempts: 1,
    session_key: 'qq:group:253631878',
    peer_name: '测试群',
    sender_name: '手机状态栏',
    sender_id: '1129974489',
    error_message: null
  };
  const persistence = createPersistence({
    autonomousQueueRows: [queueRow]
  });

  const feed = await persistence.getXiaoniActivityFeed({ limit: 5 });

  assert.equal(feed.items[0].id, 'queue:4161');
  assert.equal(feed.items[0].title, '手机 QQ 通知');
  assert.equal(feed.items[0].body, '手机状态栏有 1 条 QQ 未读');
  assert.equal(feed.items[0].timestamp, '2026-05-31T14:28:56.395+08:00');
  assert.equal(feed.current.latestActivityAt, '2026-05-31T14:28:56.395+08:00');
  assert.equal(feed.current.autonomy.latestConsciousnessTickAt, null);
  assert.equal(feed.current.autonomy.latestConsciousnessTickStatus, null);
  assert.equal(feed.current.autonomy.latestPhoneNotificationAt, '2026-05-31T14:28:56.395+08:00');
});

test('Xiaoni action stream keeps visible actions without duplicating settled phone notification queue rows', async () => {
  const persistence = createPersistence({
    lifeEvents: [{
      id: 6464,
      identity_key: 'xiaoni',
      event_kind: 'send_in_group',
      occurred_at: new Date('2026-05-31T06:29:10.000Z'),
      surface: 'qq',
      chat_type: 'group',
      session_key: 'qq:group:253631878',
      peer_id: '253631878',
      actor_type: 'xiaoni',
      actor_id: '1129974489',
      visibility: 'active_surface',
      run_id: 'run_1',
      trace_id: 'runtrace_1',
      payload: {
        sent_messages: ['发出去了'],
        peer_name: '测试群'
      }
    }],
    autonomousQueueRows: [{
      id: 4161,
      trace_id: 'runtrace_1',
      run_id: 'run_1',
      source: 'phone_notification',
      status: 'settled',
      body_for_agent: '手机状态栏有 1 条 QQ 未读',
      updated_at: '2026-05-31T14:29:23.395+08:00',
      created_at: '2026-05-31T06:28:55.635+08:00',
      locked_at: '2026-05-31T14:28:56.395+08:00',
      processing_started_at: '2026-05-31T14:28:56.395+08:00',
      available_at: '2026-05-31T06:28:55.635+08:00',
      completed_at: '2026-05-31T14:29:23.395+08:00',
      attempts: 1,
      session_key: 'qq:group:253631878',
      peer_name: '测试群',
      sender_name: '手机状态栏',
      sender_id: '1129974489',
      error_message: null
    }]
  });

  const stream = await persistence.getXiaoniActionStream({ limit: 5 });

  assert.deepEqual(stream.items.map((item) => item.id), ['life:6464']);
  assert.equal(stream.items[0].eventKind, 'visible_delivery_committed');
  assert.equal(stream.items[0].traceTarget.traceId, 'runtrace_1');
  assert.equal(stream.current.autonomy.latestPhoneNotificationAt, '2026-05-31T14:28:56.395+08:00');
  assert.equal(stream.current.latestActivityAt, '2026-05-31T06:29:10.000Z');
});

test('Xiaoni activity feed hides operator-only self-action LLM prompts', async () => {
  const persistence = createPersistence({
    llmRows: [{
      id: 1,
      llm_call_id: 'llm_self',
      agent_type: 'self_action_search',
      prompt_template: 'self_action_search:web_search',
      model_name: 'gpt-5.4-mini',
      status: 'completed',
      started_at: new Date('2026-05-31T04:10:00.000Z'),
      canonical_request: {
        instructions: '请用这个 exact query 调用 web_search：today funny internet culture trend',
        metadata: {
          session_id: 'self_action:xiaoni',
          action_type: 'self_action_search'
        },
        input: [{
          role: 'user',
          content: 'web_search_query: today funny internet culture trend'
        }]
      },
      processed_response: 'operator trace'
    }, {
      id: 2,
      llm_call_id: 'llm_chat',
      agent_type: 'chat_bot',
      prompt_template: '小腻主AGENT',
      model_name: 'gpt-5.4',
      status: 'completed',
      started_at: new Date('2026-05-31T04:09:00.000Z'),
      canonical_request: {
        instructions: 'normal chat instruction',
        input: [{
          role: 'user',
          content: 'hello'
        }]
      },
      processed_response: 'hello back'
    }]
  });

  const feed = await persistence.getXiaoniActivityFeed({ limit: 5 });
  const serialized = JSON.stringify(feed);

  assert.equal(feed.items.some((item) => item.id === 'llm:llm_self'), false);
  assert.equal(feed.items.some((item) => item.id === 'llm-slice:llm_chat'), true);
  assert.equal(serialized.includes('请用这个 exact query'), false);
  assert.equal(serialized.includes('today funny internet culture trend'), false);
});

test('Xiaoni activity feed promotes LLM request slices to first-class events', async () => {
  const wireRequest = { model: 'gpt-5.5', input: [{ role: 'user', content: '你发了么？' }] };
  const wireResponse = { id: 'resp_codex', output: [{ type: 'function_call', name: 'exec_command' }] };
  const persistence = createPersistence({
    llmRequestSliceRows: [{
      id: '3',
      sliceId: 'slice_codex_1',
      llmCallId: 'llm_codex_1',
      traceId: 'runtrace_codex_1',
      runId: 'run_codex_1',
      agentTurn: 2,
      modelName: 'gpt-5.5',
      modelProvider: 'codex-local',
      wireProviderFormat: 'codex-local/responses',
      status: 'completed',
      createdAt: '2026-06-05T10:03:47.000Z',
      completedAt: '2026-06-05T10:04:00.000Z',
      tokenUsage: { input_tokens: 10, output_tokens: 4 },
      wireRequest,
      wireResponse,
      canonicalRequest: {
        instructions: 'normal chat instruction',
        input: [{
          role: 'user',
          content: '你发了么？'
        }]
      }
    }]
  });

  const feed = await persistence.getXiaoniActivityFeed({ limit: 10 });
  const slice = feed.items.find((item) => item.id === 'llm-slice:slice_codex_1');

  assert.ok(slice);
  assert.equal(slice.source, 'llm_request');
  assert.equal(slice.kind, 'llm_request_slice');
  assert.equal(slice.title, 'LLM 请求');
  assert.equal(slice.traceId, 'runtrace_codex_1');
  assert.equal(slice.metadata.spanId, 'stack-slice:slice_codex_1');
  assert.equal(slice.metadata.providerFormat, 'codex-local/responses');
  assert.match(slice.metadata.providerRequestPreview, /gpt-5.5/);
  assert.match(slice.metadata.providerResponsePreview, /resp_codex/);
  assert.equal(slice.metadata.providerRequestBytes, Buffer.byteLength(JSON.stringify(wireRequest), 'utf8'));
  assert.equal(slice.metadata.providerResponseBytes, Buffer.byteLength(JSON.stringify(wireResponse), 'utf8'));
  assert.equal(feed.items.some((item) => item.id === 'llm:llm_codex_1'), false);
});

test('Xiaoni action stream projects stack tool requests without provider replay rows', async () => {
  const persistence = createPersistence({
    agentStackRows: [{
      id: '101',
      eventId: 'stack:trace_codex_stream:call_exec',
      identityKey: 'xiaoni',
      stackIndex: 20,
      itemKind: 'function_call',
      role: 'assistant',
      phase: null,
      toolCallId: 'call_exec',
      llmRequestSliceId: 'slice_codex_stream',
      content: {
        type: 'function_call',
        call_id: 'call_exec',
        name: 'exec_command',
        arguments: '{"cmd":"date"}'
      },
      traceId: 'trace_codex_stream',
      conversationId: '42',
      runId: 'run_internal_lease_1',
      status: 'completed',
      createdAt: '2026-06-05T10:04:00.000Z',
      metadata: {
        output_item_index: 0
      }
    }]
  });

  const stream = await persistence.getXiaoniActionStream({ limit: 10 });
  const stackItem = stream.items.find((item) => item.id === 'stack:101');

  assert.ok(stackItem);
  assert.equal(stream.streamKind, 'xiaoni_action_stream');
  assert.equal(stackItem.source, 'llm_stack_item');
  assert.equal(stackItem.eventKind, 'model_tool_request');
  assert.equal(stackItem.title, '请求工具: exec_command');
  assert.equal(stackItem.occurredAt, '2026-06-05T10:04:00.000Z');
  assert.equal(stackItem.status, null);
  assert.equal(stackItem.runId, null);
  assert.equal(stackItem.internalExecutionLeaseId, 'run_internal_lease_1');
  assert.deepEqual(stackItem.traceTarget, {
    internalExecutionLeaseId: 'run_internal_lease_1',
    traceId: 'trace_codex_stream',
    spanId: 'tool-call:call_exec'
  });
  assert.equal(stackItem.metadata.internalExecutionLeaseId, 'run_internal_lease_1');
  assert.equal(stackItem.metadata.stackSource, 'agent_stack_items');
  assert.equal(stackItem.metadata.argumentsPreview, '{"cmd":"date"}');
  assert.equal(stream.current.latestActivityAt, '2026-06-05T10:04:00.000Z');
});

test('Xiaoni activity feed projects stack ledger items without legacy LLM rows', async () => {
  const persistence = createPersistence({
    agentStackRows: [{
      id: '9001',
      eventId: 'stack:llm-1:output:0',
      identityKey: 'xiaoni',
      stackIndex: 12,
      itemKind: 'function_call',
      role: 'assistant',
      phase: null,
      toolCallId: 'call-1',
      llmRequestSliceId: 'llm-1',
      content: {
        type: 'function_call',
        call_id: 'call-1',
        name: 'exec_command',
        arguments: '{"cmd":"pwd"}'
      },
      traceId: 'trace-1',
      runId: 'run-1',
      createdAt: '2026-06-11T10:00:00.000Z',
      metadata: {
        output_item_index: 0
      }
    }]
  });

  const feed = await persistence.getXiaoniActivityFeed({ limit: 10 });

  assert.equal(feed.items.some((item) => item.id === 'stack:9001'), true);
  const actionStream = await persistence.getXiaoniActionStream({ limit: 10 });
  assert.equal(actionStream.items[0].eventKind, 'model_tool_request');
  assert.equal(actionStream.items[0].traceTarget.spanId, 'tool-call:call-1');
});

test('Xiaoni action stream treats stack tool executions as first-class activity', async () => {
  const persistence = createPersistence({
    agentStackToolRows: [{
      id: '701',
      executionId: 'tool:trace-tool:call-recover',
      identityKey: 'xiaoni',
      llmRequestSliceId: 'slice-tool',
      llmCallId: 'llm-tool',
      traceId: 'trace-tool',
      conversationId: null,
      runId: 'run-tool',
      toolCallId: 'call-recover',
      toolName: 'recover_energy',
      arguments: { reason: '困了' },
      result: {
        status_text: '开始休息',
        release_lease: true
      },
      status: 'completed',
      sideEffect: true,
      startedAt: '2026-06-05T12:00:00.000Z',
      completedAt: '2026-06-05T12:00:03.000Z',
      metadata: {
        agentTurn: 1
      }
    }]
  });

  const stream = await persistence.getXiaoniActionStream({ limit: 10 });
  const tool = stream.items.find((item) => item.id === 'tool-exec:tool:trace-tool:call-recover');

  assert.ok(tool);
  assert.equal(tool.source, 'tool_execution');
  assert.equal(tool.eventKind, 'tool_executed');
  assert.equal(tool.kind, 'recover_energy');
  assert.equal(tool.title, 'tool: recover_energy');
  assert.equal(tool.status, 'ok');
  assert.equal(tool.occurredAt, '2026-06-05T12:00:00.000Z');
  assert.equal(tool.internalExecutionLeaseId, 'run-tool');
  assert.equal(tool.metadata.toolArgumentsPreview, '{"reason":"困了"}');
  assert.match(tool.metadata.toolResultPreview, /开始休息/);
});

test('Xiaoni action stream excludes internal non-tool life events', async () => {
  const persistence = createPersistence({
    lifeEvents: [{
      id: 501,
      identity_key: 'xiaoni',
      event_kind: 'surface_visit',
      occurred_at: new Date('2026-06-05T11:00:00.000Z'),
      surface: 'qq',
      actor_type: 'xiaoni',
      visibility: 'self_private',
      run_id: 'run_internal_only',
      trace_id: 'trace_internal_only',
      payload: {
        wake_kind: 'proactive_use_im',
        peer_name: '测试群',
        unread_batch_size: 2
      }
    }]
  });

  const stream = await persistence.getXiaoniActionStream({ limit: 10 });

  assert.deepEqual(stream.items, []);
  assert.equal(stream.current.latestActivityAt, null);
});

test('Xiaoni activity feed exposes safe action trace previews on digital actions', async () => {
  const persistence = createPersistence({
    digitalActions: [{
      id: 'digital_action_1',
      action_type: 'web_search',
      status: 'completed',
      created_at: new Date('2026-05-31T05:00:00.000Z'),
      updated_at: new Date('2026-05-31T05:00:01.000Z'),
      completed_at: new Date('2026-05-31T05:00:01.000Z'),
      motive_kind: 'curiosity',
      motive_text: '顺着当前事件流里的建议查一个小问题。',
      query: 'user suggested poetry query',
      result_summary: '查到一个公开资料点。',
      residue_text: '先记成一句可追溯的材料。',
      residue_kind: 'private_note',
      source_wording: 'real_web_search',
      source_trace: {
        llm_call_id: 'llm_search_1',
        completed_search_queries: ['user suggested poetry query'],
        interest_candidates: [{ label: '诗和轻讽刺', confidence: 0.4 }]
      },
      budget_snapshot: {
        daily_count: 1,
        web_daily_count: 1
      },
      error_message: null
    }]
  });

  const feed = await persistence.getXiaoniActivityFeed({ limit: 5 });
  const digital = feed.items.find((item) => item.id === 'digital:digital_action_1');

  assert.ok(digital);
  assert.equal(digital.metadata.searchLlmCallId, 'llm_search_1');
  assert.match(digital.metadata.actionTracePreview, /completed_search_queries/);
  assert.match(digital.metadata.interestCandidatesPreview, /诗和轻讽刺/);
  assert.match(digital.metadata.budgetSnapshotPreview, /web_daily_count/);
});

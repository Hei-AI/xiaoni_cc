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
      findMany: async () => overrides.tasks || [],
      count: async () => 0
    },
    agentMediaAsset: {
      findMany: async () => overrides.mediaAssets || [],
      findUnique: async ({ where }) => (overrides.mediaAssets || []).find((row) => row.id === where.id) || null
    },
    agentMediaObservation: {
      findUnique: async ({ where }) => {
        for (const asset of overrides.mediaAssets || []) {
          const observation = (asset.observations || []).find((row) => row.id === where.id);
          if (observation) {
            return { ...observation, asset };
          }
        }
        return null;
      }
    },
    agentQueueMessage: {
      findMany: async () => [],
      count: async () => 0
    }
  };
  const sqlAdapter = () => {
    const adapter = {
      query: async (statement) => {
        if (statement.includes('FROM core_memory_compression_fork_runs')) {
          return overrides.compressionForkRuns || [];
        }
        if (statement.includes('FROM core_memory_compression_fork_slices')) {
          return overrides.compressionForkSlices || [];
        }
        if (statement.includes('FROM core_memory_compression_fork_items')) {
          return overrides.compressionForkItems || [];
        }
        if (statement.includes('FROM image_vision_fork_items')) {
          return overrides.imageVisionForkItems || [];
        }
        if (statement.includes('FROM subconscious_agent_fork_runs')) {
          return overrides.subconsciousForkRuns || [];
        }
        if (statement.includes('FROM subconscious_agent_fork_slices')) {
          return overrides.subconsciousForkSlices || [];
        }
        if (statement.includes('FROM subconscious_agent_fork_items')) {
          return overrides.subconsciousForkItems || [];
        }
        if (statement.includes('FROM subconscious_agent_fork_tool_executions')) {
          return overrides.subconsciousForkToolRows || [];
        }
        if (statement.includes('FROM core_memory_compression_fork_tool_executions')) {
          return overrides.compressionForkToolRows || [];
        }
        if (statement.includes('FROM agent_queue_messages') && statement.includes("source IN ('phone_notification')")) {
          return overrides.autonomousQueueRows || [];
        }
        if (statement.includes('FROM agent_queue_messages')) {
          return overrides.queueRows || [];
        }
        return [];
      },
      close: async () => undefined
    };
    if (typeof overrides.onSqlAdapterCreate === 'function') {
      overrides.onSqlAdapterCreate(adapter);
    }
    return adapter;
  };
  return createXiaoniActivityPersistence({
    getPrismaClient: () => prisma,
    createSqlAdapter: sqlAdapter,
    listLlmRequestSlices: async (input = {}) => {
      if (typeof overrides.onListLlmRequestSlices === 'function') {
        overrides.onListLlmRequestSlices(input);
      }
      const sourceKind = input.sourceKind || input.source_kind || 'main';
      const sliceId = input.sliceId || input.slice_id || null;
      const llmCallId = input.llmCallId || input.llm_call_id || null;
      return (overrides.llmRequestSliceRows || overrides.llmRows || [])
        .filter((row) => (row.sourceKind || row.source_kind || 'main') === sourceKind)
        .filter((row) => !sliceId || row.sliceId === sliceId || row.slice_id === sliceId)
        .filter((row) => !llmCallId || row.llmCallId === llmCallId || row.llm_call_id === llmCallId)
        .slice(0, input.limit || 100);
    },
    listCodexProviderUsageEvents: async (input = {}) => {
      if (typeof overrides.onListCodexProviderUsageEvents === 'function') {
        overrides.onListCodexProviderUsageEvents(input);
      }
      const sourceKind = input.sourceKind || input.source_kind || null;
      return (overrides.codexProviderUsageRows || [])
        .filter((row) => !sourceKind || row.sourceKind === sourceKind || row.source_kind === sourceKind)
        .slice(0, input.limit || 100);
    },
    listAgentStackItems: async (input = {}) => {
      if (typeof overrides.onListAgentStackItems === 'function') {
        overrides.onListAgentStackItems(input);
      }
      const rows = overrides.agentStackRows || [];
      const itemKind = input.itemKind || input.item_kind || null;
      return rows
        .filter((row) => !itemKind || row.itemKind === itemKind || row.item_kind === itemKind)
        .slice(0, input.limit || 100);
    },
    listToolExecutions: async (input = {}) => {
      if (typeof overrides.onListToolExecutions === 'function') {
        overrides.onListToolExecutions(input);
      }
      return (overrides.agentStackToolRows || []).slice(0, input.limit || 100);
    },
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

test('Xiaoni action stream drops life_event + settled phone-notification rows but keeps autonomy state', async () => {
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

  // life_event and settled phone-notification queue rows are dropped from the
  // action stream, but autonomy current-state is still tracked.
  assert.deepEqual(stream.items.map((item) => item.id), []);
  assert.equal(stream.current.autonomy.latestPhoneNotificationAt, '2026-05-31T14:28:56.395+08:00');
  assert.equal(stream.current.latestActivityAt, null);
});

test('Xiaoni action stream reuses its SQL adapter for stack projection fan-out', async () => {
  const createdAdapters = [];
  const projectionInputs = {
    slices: [],
    stack: [],
    tools: []
  };
  const persistence = createPersistence({
    onSqlAdapterCreate: (adapter) => createdAdapters.push(adapter),
    onListLlmRequestSlices: (input) => projectionInputs.slices.push(input),
    onListAgentStackItems: (input) => projectionInputs.stack.push(input),
    onListToolExecutions: (input) => projectionInputs.tools.push(input)
  });

  await persistence.getXiaoniActionStream({ limit: 5 });

  assert.equal(createdAdapters.length, 1);
  assert.ok(createdAdapters[0]);
  assert.ok(projectionInputs.slices.length >= 1);
  assert.equal(projectionInputs.stack.length, 4);
  assert.deepEqual(
    projectionInputs.stack.map((input) => input.itemKind).sort(),
    ['assistant_output', 'function_call', 'function_call_output', 'runtime_input']
  );
  assert.ok(projectionInputs.tools.length >= 1);
  for (const input of [
    ...projectionInputs.slices,
    ...projectionInputs.stack,
    ...projectionInputs.tools
  ]) {
    assert.equal(input.sqlAdapter, createdAdapters[0]);
  }
});

test('Xiaoni activity feed hides operator-only self-action LLM prompts', async () => {
  const persistence = createPersistence({
    llmRows: [{
      id: 1,
      llm_call_id: 'llm_self',
      agent_type: 'self_action_search',
      prompt_template: 'self_action_search:web_search',
      model_name: 'gpt-5-mini',
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

  const actionStream = await persistence.getXiaoniActionStream({ limit: 10 });
  const actionSlice = actionStream.items.find((item) => item.id === 'llm-slice:slice_codex_1');
  assert.equal(actionSlice.tags.some((tag) => tag.key === 'source:llm_request' && tag.label === 'source: LLM'), true);
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
    spanId: 'tool-call:call_exec',
    llmRequestSliceId: 'slice_codex_stream',
    toolCallId: 'call_exec',
    stackItemId: '101'
  });
  assert.equal(stackItem.metadata.internalExecutionLeaseId, 'run_internal_lease_1');
  assert.equal(stackItem.metadata.stackSource, 'agent_stack_items');
  assert.equal(stackItem.metadata.argumentsPreview, '{"cmd":"date"}');
  assert.deepEqual(stackItem.tags.map((tag) => tag.key), [
    'source:llm_stack_item',
    'event:model_tool_request',
    'tool:exec_command'
  ]);
  assert.equal(stream.availableTags.some((tag) => tag.key === 'event:model_tool_request' && tag.count === 1), true);
  assert.equal(stream.current.latestActivityAt, '2026-06-05T10:04:00.000Z');
});

test('Xiaoni action stream returns compression fork overlay without polluting main items', async () => {
  const persistence = createPersistence({
    agentStackRows: [{
      id: '101',
      eventId: 'stack:trace_codex_stream:call_exec',
      identityKey: 'xiaoni',
      stackIndex: 20,
      itemKind: 'function_call',
      toolCallId: 'call_exec',
      llmRequestSliceId: 'slice_codex_stream',
      content: {
        type: 'function_call',
        call_id: 'call_exec',
        name: 'exec_command',
        arguments: '{"cmd":"date"}'
      },
      traceId: 'trace_codex_stream',
      runId: 'run_internal_lease_1',
      createdAt: '2026-06-05T10:04:00.000Z',
      metadata: {
        output_item_index: 0
      }
    }],
    compressionForkRuns: [{
      id: '1',
      fork_run_id: 'core_memory_fork_1',
      identity_key: 'xiaoni',
      context_session_key: 'core-memory:xiaoni',
      status: 'completed',
      trace_id: 'trace_codex_stream',
      run_id: 'run_internal_lease_1',
      read_cutoff_after_conversation_id: '200',
      previous_read_cutoff_after_conversation_id: '100',
      summary_text: '新的小腻近况',
      artifact: { read_cutoff_after_conversation_id: '200' },
      metadata: { trigger: 'core_memory_pressure' },
      started_at: '2026-06-05T10:05:00.000Z',
      completed_at: '2026-06-05T10:05:12.000Z',
      created_at: '2026-06-05T10:05:00.000Z',
      updated_at: '2026-06-05T10:05:12.000Z'
    }],
    compressionForkSlices: [{
      id: '2',
      slice_id: 'fork_slice_1',
      fork_run_id: 'core_memory_fork_1',
      llm_call_id: 'fork_llm_1',
      identity_key: 'xiaoni',
      status: 'completed',
      token_usage: { input_tokens: 1000, output_tokens: 200 },
      trace_id: 'trace_codex_stream',
      run_id: 'run_internal_lease_1',
      agent_turn: 1,
      model_name: 'gpt-5.5',
      model_provider: 'codex-local',
      wire_provider_format: 'codex-local/responses',
      canonical_request: { input: [{ role: 'user', content: 'compress' }] },
      wire_response: { id: 'resp_fork' },
      output_items: [{ type: 'function_call', name: 'exec_command' }],
      created_at: '2026-06-05T10:05:01.000Z',
      completed_at: '2026-06-05T10:05:03.000Z'
    }],
    compressionForkItems: [{
      id: '3',
      event_id: 'compression-fork:core_memory_fork_1:item:1',
      fork_run_id: 'core_memory_fork_1',
      identity_key: 'xiaoni',
      item_index: '1',
      item_kind: 'function_call',
      tool_call_id: 'fork_call_exec',
      llm_request_slice_id: 'fork_slice_1',
      content: {
        type: 'function_call',
        call_id: 'fork_call_exec',
        name: 'exec_command',
        arguments: '{"cmd":"date"}'
      },
      trace_id: 'trace_codex_stream',
      run_id: 'run_internal_lease_1',
      metadata: { output_item_index: 0 },
      created_at: '2026-06-05T10:05:04.000Z'
    }],
    compressionForkToolRows: [{
      id: '4',
      execution_id: 'fork_tool_exec_1',
      fork_run_id: 'core_memory_fork_1',
      identity_key: 'xiaoni',
      llm_request_slice_id: 'fork_slice_1',
      tool_call_id: 'fork_call_exec',
      tool_name: 'exec_command',
      arguments: { cmd: 'date' },
      result: { text: 'Fri Jun 5 10:05:05 UTC 2026' },
      status: 'completed',
      trace_id: 'trace_codex_stream',
      run_id: 'run_internal_lease_1',
      started_at: '2026-06-05T10:05:05.000Z',
      completed_at: '2026-06-05T10:05:06.000Z'
    }]
  });

  const stream = await persistence.getXiaoniActionStream({ limit: 10 });
  const forkRun = stream.compressionForkTimeline.runs[0];

  assert.ok(forkRun);
  assert.equal(forkRun.forkRunId, 'core_memory_fork_1');
  assert.equal(forkRun.startedAt, '2026-06-05T10:05:00.000Z');
  assert.equal(forkRun.completedAt, '2026-06-05T10:05:12.000Z');
  assert.equal(forkRun.durationMs, 12000);
  assert.equal(forkRun.readCutoffAfterConversationId, '200');
  assert.equal(forkRun.tags.some((tag) => tag.key === 'source:core_memory_compression_fork'), true);
  assert.deepEqual(forkRun.events.map((item) => item.source), [
    'compression_fork_llm_request',
    'compression_fork_item',
    'compression_fork_tool_execution'
  ]);
  assert.equal(forkRun.events[1].tags.some((tag) => tag.key === 'source:compression_fork_item'), true);
  assert.equal(forkRun.events[0].traceTarget.sourceKind, 'compression_fork');
  assert.equal(forkRun.events[0].traceTarget.forkRunId, 'core_memory_fork_1');
  assert.equal(forkRun.events[0].metadata.providerRequestSpanId, 'provider-request:wire:fork_llm_1');
  assert.equal(forkRun.events[1].traceTarget.toolCallId, 'fork_call_exec');
  assert.equal(forkRun.events[2].traceTarget.llmRequestSliceId, 'fork_slice_1');
  assert.equal(forkRun.events[1].title, 'Fork 请求工具: exec_command');
  assert.match(forkRun.events[2].metadata.toolResultPreview, /Fri Jun 5/);
  assert.equal(stream.items.some((item) => item.id.startsWith('compression-fork:')), false);
  assert.equal(stream.items.some((item) => item.source.startsWith('compression_fork')), false);

  const filteredForkStream = await persistence.getXiaoniActionStream({
    limit: 10,
    tags: ['source:compression_fork_item']
  });
  const filteredForkRun = filteredForkStream.compressionForkTimeline.runs[0];
  assert.ok(filteredForkRun);
  assert.deepEqual(filteredForkRun.events.map((item) => item.source), ['compression_fork_item']);
  assert.equal(filteredForkStream.items.some((item) => item.source.startsWith('compression_fork')), false);

  const resolved = await persistence.findXiaoniActionEventTraceTarget('compression-fork-slice:fork_slice_1');
  assert.equal(resolved.sourceKind, 'compression_fork');
  assert.equal(resolved.forkRunId, 'core_memory_fork_1');
  assert.equal(resolved.llmRequestSliceId, 'fork_slice_1');
  assert.equal(resolved.spanId, 'provider-request:wire:fork_llm_1');
});

test('Xiaoni action stream returns subconscious fork overlay with natural language output', async () => {
  const persistence = createPersistence({
    subconsciousForkRuns: [{
      id: '21',
      fork_run_id: 'subconscious_fork_1',
      identity_key: 'xiaoni',
      context_session_key: 'xiaoni:test-global',
      status: 'completed',
      trace_id: 'trace_sub_stream',
      run_id: 'run_internal_sub_1',
      notify_queue_message_id: '909',
      summary_text: '我想先把没做完的图片任务捡起来。',
      artifact: { notify_queue_message_id: 909 },
      metadata: { trigger: 'empty_notify_after_final_answer' },
      started_at: '2026-06-05T10:10:00.000Z',
      completed_at: '2026-06-05T10:10:02.000Z',
      created_at: '2026-06-05T10:10:00.000Z',
      updated_at: '2026-06-05T10:10:02.000Z'
    }],
    subconsciousForkSlices: [{
      id: '22',
      slice_id: 'sub_slice_1',
      fork_run_id: 'subconscious_fork_1',
      llm_call_id: 'sub_llm_1',
      identity_key: 'xiaoni',
      status: 'completed',
      token_usage: { input_tokens: 50, output_tokens: 9 },
      trace_id: 'trace_sub_stream',
      run_id: 'run_internal_sub_1',
      agent_turn: 1,
      model_name: 'gpt-5.5',
      model_provider: 'codex-local',
      wire_provider_format: 'codex-local/responses',
      canonical_request: { input: [{ role: 'developer', content: 'self continuation reminder' }] },
      wire_response: { id: 'resp_sub' },
      output_items: [{ type: 'message', content: '我想先把没做完的图片任务捡起来。' }],
      created_at: '2026-06-05T10:10:01.000Z',
      completed_at: '2026-06-05T10:10:02.000Z'
    }],
    subconsciousForkItems: [{
      id: '23',
      event_id: 'subconscious-fork:subconscious_fork_1:item:1',
      fork_run_id: 'subconscious_fork_1',
      identity_key: 'xiaoni',
      item_index: '1',
      item_kind: 'assistant_output',
      role: 'assistant',
      phase: 'final_answer',
      llm_request_slice_id: 'sub_slice_1',
      content: {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: '我想先把没做完的图片任务捡起来。' }]
      },
      trace_id: 'trace_sub_stream',
      run_id: 'run_internal_sub_1',
      metadata: { output_item_index: 0 },
      created_at: '2026-06-05T10:10:02.000Z'
    }]
  });

  const stream = await persistence.getXiaoniActionStream({ limit: 10 });
  const forkRun = stream.subconsciousForkTimeline.runs[0];

  assert.ok(forkRun);
  assert.equal(forkRun.forkRunId, 'subconscious_fork_1');
  assert.equal(forkRun.source, 'subconscious_agent_fork');
  assert.equal(forkRun.body, '我想先把没做完的图片任务捡起来。');
  assert.equal(forkRun.metadata.notifyQueueMessageId, '909');
  assert.deepEqual(forkRun.events.map((item) => item.source), [
    'subconscious_fork_llm_request',
    'subconscious_fork_item'
  ]);
  assert.equal(forkRun.events[0].traceTarget.sourceKind, 'subconscious_agent_fork');
  assert.equal(forkRun.events[0].traceTarget.forkRunId, 'subconscious_fork_1');
  assert.equal(forkRun.events[0].metadata.providerRequestSpanId, 'provider-request:wire:sub_llm_1');
  assert.equal(stream.items.some((item) => item.id.startsWith('subconscious-fork:')), false);

  const resolved = await persistence.findXiaoniActionEventTraceTarget('subconscious-fork-slice:sub_slice_1');
  assert.equal(resolved.sourceKind, 'subconscious_agent_fork');
  assert.equal(resolved.forkRunId, 'subconscious_fork_1');
  assert.equal(resolved.llmRequestSliceId, 'sub_slice_1');
});

test('Xiaoni action stream loads fork slices with summary columns only', async () => {
  const statements = [];
  const persistence = createPersistence({
    onSqlAdapterCreate: (adapter) => {
      const originalQuery = adapter.query;
      adapter.query = async (statement, ...args) => {
        statements.push(statement);
        return originalQuery(statement, ...args);
      };
    },
    subconsciousForkRuns: [{
      id: '31',
      fork_run_id: 'subconscious_fork_heavy',
      identity_key: 'xiaoni',
      status: 'completed',
      summary_text: 'heavy fork',
      started_at: '2026-06-05T10:10:00.000Z',
      completed_at: '2026-06-05T10:10:02.000Z',
      created_at: '2026-06-05T10:10:00.000Z',
      updated_at: '2026-06-05T10:10:02.000Z'
    }],
    subconsciousForkSlices: [{
      id: '32',
      slice_id: 'sub_slice_heavy',
      fork_run_id: 'subconscious_fork_heavy',
      llm_call_id: 'sub_llm_heavy',
      identity_key: 'xiaoni',
      status: 'completed',
      token_usage: { input_tokens: 50, output_tokens: 9 },
      wire_request: { huge: 'request payload stays out of action stream list queries' },
      wire_response: { huge: 'response payload stays out of action stream list queries' },
      created_at: '2026-06-05T10:10:01.000Z',
      completed_at: '2026-06-05T10:10:02.000Z'
    }]
  });

  await persistence.getXiaoniActionStream({ limit: 10 });

  const forkSliceQuery = statements.find((statement) => statement.includes('FROM subconscious_agent_fork_slices'));
  assert.ok(forkSliceQuery);
  assert.doesNotMatch(forkSliceQuery, /SELECT\s+\*/i);
  assert.match(forkSliceQuery, /NULL::jsonb AS wire_request/);
  assert.match(forkSliceQuery, /wire_request IS NOT NULL AS provider_raw_trace_available/);
});

test('Xiaoni action stream paginates the merged main and fork timeline', async () => {
  const persistence = createPersistence({
    llmRequestSliceRows: [{
      id: '10',
      sliceId: 'slice_newer',
      llmCallId: 'llm_newer',
      identityKey: 'xiaoni',
      status: 'completed',
      modelName: 'gpt-5.5',
      modelProvider: 'codex-local',
      wireProviderFormat: 'codex-local/responses',
      canonicalRequest: { input: [{ role: 'user', content: 'newer' }] },
      wireResponse: { id: 'resp_newer' },
      createdAt: '2026-06-05T10:04:00.000Z',
      completedAt: '2026-06-05T10:04:01.000Z'
    }],
    agentStackRows: [{
      id: '11',
      eventId: 'stack:trace_old:call_old',
      identityKey: 'xiaoni',
      stackIndex: 21,
      itemKind: 'function_call',
      toolCallId: 'call_old',
      llmRequestSliceId: 'slice_old',
      content: {
        type: 'function_call',
        call_id: 'call_old',
        name: 'exec_command',
        arguments: '{"cmd":"pwd"}'
      },
      traceId: 'trace_old',
      runId: 'run_old',
      createdAt: '2026-06-05T10:03:00.000Z'
    }],
    compressionForkRuns: [{
      id: '12',
      fork_run_id: 'core_memory_fork_newest',
      identity_key: 'xiaoni',
      status: 'completed',
      summary_text: '最新 fork',
      started_at: '2026-06-05T10:05:00.000Z',
      completed_at: '2026-06-05T10:05:12.000Z',
      created_at: '2026-06-05T10:05:00.000Z',
      updated_at: '2026-06-05T10:05:12.000Z'
    }]
  });

  const stream = await persistence.getXiaoniActionStream({ limit: 2 });

  assert.equal(stream.pagination.limit, 2);
  assert.equal(stream.pagination.hasMore, true);
  assert.equal(stream.pagination.nextCursor, '2026-06-05T10:04:00.000Z');
  assert.deepEqual(stream.compressionForkTimeline.runs.map((run) => run.forkRunId), ['core_memory_fork_newest']);
  assert.deepEqual(stream.items.map((item) => item.id), ['llm-slice:slice_newer']);
});

test('Xiaoni action stream cursor follows visible main items instead of older fork runs', async () => {
  const persistence = createPersistence({
    llmRequestSliceRows: [{
      id: '20',
      sliceId: 'slice_visible_main',
      llmCallId: 'llm_visible_main',
      identityKey: 'xiaoni',
      status: 'completed',
      modelName: 'gpt-5.5',
      modelProvider: 'codex-local',
      wireProviderFormat: 'codex-local/responses',
      canonicalRequest: { input: [{ role: 'user', content: 'visible main' }] },
      wireResponse: { id: 'resp_visible_main' },
      createdAt: '2026-06-05T10:10:00.000Z',
      completedAt: '2026-06-05T10:10:01.000Z'
    }],
    subconsciousForkRuns: [{
      id: '21',
      fork_run_id: 'subconscious_fork_older_than_visible_main',
      identity_key: 'xiaoni',
      status: 'completed',
      summary_text: '旧 fork',
      started_at: '2026-06-05T09:00:00.000Z',
      completed_at: '2026-06-05T09:00:10.000Z',
      created_at: '2026-06-05T09:00:00.000Z',
      updated_at: '2026-06-05T09:00:10.000Z'
    }, {
      id: '22',
      fork_run_id: 'subconscious_fork_even_older',
      identity_key: 'xiaoni',
      status: 'completed',
      summary_text: '更旧 fork',
      started_at: '2026-06-05T08:59:00.000Z',
      completed_at: '2026-06-05T08:59:10.000Z',
      created_at: '2026-06-05T08:59:00.000Z',
      updated_at: '2026-06-05T08:59:10.000Z'
    }]
  });

  const stream = await persistence.getXiaoniActionStream({ limit: 2 });

  assert.equal(stream.pagination.hasMore, true);
  assert.equal(stream.pagination.nextCursor, '2026-06-05T10:10:00.000Z');
  assert.deepEqual(stream.items.map((item) => item.id), ['llm-slice:slice_visible_main']);
  assert.deepEqual(stream.subconsciousForkTimeline.runs.map((run) => run.forkRunId), [
    'subconscious_fork_older_than_visible_main'
  ]);
});

test('Xiaoni action stream filters tags before applying display limit', async () => {
  const noisyLlmSlices = Array.from({ length: 100 }, (_, index) => ({
    id: String(3000 + index),
    sliceId: `slice_noise_${index}`,
    llmCallId: `llm_noise_${index}`,
    traceId: `trace_noise_${index}`,
    runId: `run_noise_${index}`,
    agentTurn: 1,
    modelName: 'gpt-5.5',
    modelProvider: 'codex-local',
    wireProviderFormat: 'codex-local/responses',
    status: 'completed',
    createdAt: new Date(Date.parse('2026-06-05T10:30:00.000Z') - index * 1000).toISOString(),
    completedAt: new Date(Date.parse('2026-06-05T10:30:01.000Z') - index * 1000).toISOString(),
    tokenUsage: { input_tokens: 10, output_tokens: 4 },
    canonicalRequest: { input: [{ role: 'user', content: `noise ${index}` }] },
    wireRequest: { model: 'gpt-5.5' },
    wireResponse: { id: `resp_noise_${index}` }
  }));
  const persistence = createPersistence({
    llmRequestSliceRows: noisyLlmSlices,
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
      runId: 'run_internal_lease_1',
      createdAt: '2026-06-05T10:04:00.000Z',
      metadata: {
        output_item_index: 0
      }
    }]
  });

  const stream = await persistence.getXiaoniActionStream({
    limit: 5,
    tags: ['event:model_tool_request']
  });

  assert.deepEqual(stream.items.map((item) => item.id), ['stack:101']);
  assert.deepEqual(stream.filters.tags, ['event:model_tool_request']);
  assert.equal(stream.availableTags.some((tag) => tag.key === 'source:llm_request' && tag.count === 100), true);
});

test('Xiaoni action stream lets the LLM source tag select cache heartbeat provider calls', async () => {
  const persistence = createPersistence({
    codexProviderUsageRows: [{
      id: 'heartbeat-row-1',
      eventId: 'codex-provider:heartbeat-1',
      event_id: 'codex-provider:heartbeat-1',
      sourceKind: 'cache_heartbeat',
      source_kind: 'cache_heartbeat',
      identityKey: 'xiaoni',
      llmCallId: 'llm_heartbeat_1',
      modelName: 'gpt-5.5',
      modelProvider: 'codex-local',
      wireProviderFormat: 'codex-local/responses',
      status: 'completed',
      createdAt: '2026-06-05T10:05:00.000Z',
      completedAt: '2026-06-05T10:05:01.000Z',
      tokenUsage: { input_tokens: 42000, cached_input_tokens: 41000, output_tokens: 1 },
      wireRequest: { model: 'gpt-5.5', input: [] },
      wireResponse: { id: 'resp_heartbeat_1' }
    }]
  });

  const stream = await persistence.getXiaoniActionStream({
    limit: 10,
    tags: ['source:llm_request']
  });
  const run = stream.cacheHeartbeatTimeline.runs[0];

  assert.ok(run);
  assert.equal(run.source, 'cache_heartbeat');
  assert.equal(run.tags.some((tag) => tag.key === 'source:llm_request' && tag.label === 'source: LLM'), true);
  assert.equal(run.events[0].tags.some((tag) => tag.key === 'source:llm_request'), true);
  assert.deepEqual(stream.filters.tags, ['source:llm_request']);
});

test('Xiaoni action stream lets the LLM source tag select provider-backed image tasks', async () => {
  const persistence = createPersistence({
    tasks: [{
      id: 'image-task-1',
      task_type: 'image_generate',
      status: 'completed',
      session_key: 'group:1040740258',
      peer_name: '测试群',
      target_description: '画一张猫图',
      prompt: 'cat',
      source_trace_id: 'trace_image_task_1',
      source_run_id: 'run_image_task_1',
      result_json: {
        provider_exchange: {
          request: { model: 'gpt-image-2', prompt: 'cat' },
          response: { id: 'resp_image_task_1' }
        }
      },
      artifacts: [],
      attempts: 1,
      created_at: '2026-06-05T10:06:00.000Z',
      completed_at: '2026-06-05T10:06:10.000Z'
    }]
  });

  const stream = await persistence.getXiaoniActionStream({
    limit: 10,
    tags: ['source:llm_request']
  });

  assert.deepEqual(stream.items.map((item) => item.id), ['task:image-task-1']);
  assert.equal(stream.items[0].tags.some((tag) => tag.key === 'source:llm_request' && tag.label === 'source: LLM'), true);
  assert.equal(stream.items[0].tags.some((tag) => tag.key === 'source:task'), true);
});

test('Xiaoni action stream projects image vision fork observations outside main items', async () => {
  const listSliceInputs = [];
  const persistence = createPersistence({
    onListLlmRequestSlices: (input) => {
      listSliceInputs.push(input);
    },
    llmRequestSliceRows: [{
      id: 'vision-slice-row-1',
      sliceId: 'vision_llm_1',
      llmCallId: 'vision_llm_1',
      sourceKind: 'image_vision_fork',
      traceId: 'trace_vision_1',
      runId: 'run_vision_1',
      forkRunId: 'image-vision-fork:run_vision_1:media_vision_1',
      modelName: 'gpt-5.1',
      modelProvider: 'codex-local',
      wireProviderFormat: 'openai-responses',
      status: 'completed',
      wireRequest: { model: 'gpt-5.1', input: [] },
      rawResponse: { id: 'resp_vision_1' },
      tokenUsage: {
        input_tokens: 188786,
        cached_input_tokens: 6656,
        output_tokens: 206
      },
      createdAt: '2026-06-05T10:05:00.000Z',
      completedAt: '2026-06-05T10:05:01.000Z'
    }],
    mediaAssets: [{
      id: 'media_vision_1',
      media_type: 'image',
      media_tag: 'image:abc',
      source_locator: 'napcat://image/abc',
      trace_id: 'trace_vision_1',
      session_key: 'group:1040740258',
      peer_name: '群 1040740258',
      sender_id: '123',
      sender_name: 'Alice',
      created_at: '2026-06-05T10:04:59.000Z',
      observations: [{
        id: 'obs_vision_1',
        asset_id: 'media_vision_1',
        observer: 'xiaoni',
        description: '图里有一张白板和两个人。',
        source_model: 'gpt-5.1',
        metadata: {
          trace_id: 'trace_vision_1',
          fork_run_id: 'image-vision-fork:run_vision_1:media_vision_1',
          llm_call_id: 'vision_llm_1',
          llm_request_slice_id: 'vision_llm_1',
          provider_raw_trace_persisted: true,
          reason: 'image_inspect'
        },
        created_at: '2026-06-05T10:05:01.000Z'
      }]
    }],
    imageVisionForkItems: [{
      id: 'vision-item-1',
      fork_run_id: 'image-vision-fork:run_vision_1:media_vision_1',
      identity_key: 'xiaoni',
      item_index: 1,
      item_kind: 'function_call',
      tool_call_id: 'call_exec_vision_1',
      llm_request_slice_id: 'vision_llm_1',
      trace_id: 'trace_vision_1',
      run_id: 'run_vision_1',
      content: {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'call_exec_vision_1',
        arguments: '{"cmd":"cat > /xiaoni-runtime/image-vision/observations/media_vision_1.md"}'
      },
      created_at: '2026-06-05T10:05:00.500Z'
    }]
  });

  const stream = await persistence.getXiaoniActionStream({ limit: 10 });
  const forkRun = stream.imageVisionForkTimeline.runs[0];

  assert.ok(forkRun);
  assert.equal(forkRun.forkRunId, 'image-vision-fork:run_vision_1:media_vision_1');
  assert.equal(forkRun.source, 'image_vision_fork');
  const observationEvent = forkRun.events.find((event) => event.source === 'image_vision_fork_observation');
  assert.ok(observationEvent);
  assert.equal(observationEvent.traceTarget.spanId, 'provider-request:wire:vision_llm_1');
  assert.equal(observationEvent.metadata.providerRawTraceAvailable, false);
  assert.equal(forkRun.events.some((event) => event.kind === 'function_call' && event.metadata.toolName === 'exec_command'), true);
  assert.equal(forkRun.events.some((event) => String(event.body).includes('/xiaoni-runtime/image-vision/observations/media_vision_1.md')), true);
  assert.equal(forkRun.eventCount, 3);
  assert.equal(observationEvent.metadata.inputTokens, 188786);
  assert.equal(observationEvent.metadata.cachedInputTokens, 6656);
  assert.equal(observationEvent.metadata.outputTokens, 206);
  const forkLlmEvent = forkRun.events.find((event) => event.source === 'image_vision_fork_llm_request');
  assert.ok(forkLlmEvent);
  assert.equal(forkLlmEvent.metadata.providerRawTraceAvailable, true);
  assert.equal(forkLlmEvent.metadata.providerRequestSpanId, 'provider-request:wire:vision_llm_1');
  assert.equal(forkLlmEvent.traceTarget.spanId, 'image-vision-fork-slice:vision_llm_1');
  assert.equal(forkLlmEvent.tags.some((tag) => tag.key === 'source:llm_request' && tag.label === 'source: LLM'), true);
  const forkToolEvent = forkRun.events.find((event) => event.source === 'image_vision_fork_item' && event.kind === 'function_call');
  assert.ok(forkToolEvent);
  assert.equal(forkToolEvent.metadata.providerRawTraceAvailable, false);
  assert.equal(forkToolEvent.metadata.providerRequestSpanId, 'provider-request:wire:vision_llm_1');
  assert.equal(stream.items.some((item) => item.source === 'media_observation'), false);
  assert.equal(
    listSliceInputs.some((input) => input.sliceId === 'vision_llm_1' && input.sourceKind === 'image_vision_fork'),
    true
  );

  const resolved = await persistence.findXiaoniActionEventTraceTarget('image-vision-fork:obs_vision_1');
  assert.equal(resolved.spanId, 'provider-request:wire:vision_llm_1');
  assert.equal(resolved.sourceKind, 'image_vision_fork');
  assert.equal(resolved.forkRunId, 'image-vision-fork:run_vision_1:media_vision_1');

  const resolvedItem = await persistence.findXiaoniActionEventTraceTarget('image-vision-fork-item:vision-item-1');
  assert.equal(resolvedItem.sourceKind, 'image_vision_fork');
  assert.equal(resolvedItem.forkRunId, 'image-vision-fork:run_vision_1:media_vision_1');
  assert.equal(resolvedItem.llmRequestSliceId, 'vision_llm_1');
  assert.equal(resolvedItem.toolCallId, 'call_exec_vision_1');
  assert.equal(resolvedItem.spanId, 'image-vision-fork-tool-call:call_exec_vision_1');
});

test('Xiaoni action stream filters primary cards before applying the display limit', async () => {
  // Genuinely non-primary stack items (state_event is not function_call /
  // function_call_output / assistant_output) must be filtered out BEFORE the
  // display limit, so they cannot starve real cards out of the budget.
  const noisyStateEvents = Array.from({ length: 40 }, (_, index) => ({
    id: String(2000 + index),
    eventId: `stack:slice_noise_${index}:output:0`,
    identityKey: 'xiaoni',
    stackIndex: 2000 + index,
    itemKind: 'state_event',
    role: 'assistant',
    phase: null,
    content: {
      type: 'state_event',
      content: [{ type: 'output_text', text: `internal state event ${index}` }]
    },
    traceId: `trace_noise_${index}`,
    runId: `run_noise_${index}`,
    createdAt: new Date(Date.parse('2026-06-05T10:30:00.000Z') - index * 1000).toISOString(),
    metadata: {
      output_item_index: 0
    }
  }));
  const persistence = createPersistence({
    agentStackRows: [
      ...noisyStateEvents,
      {
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
        runId: 'run_internal_lease_1',
        createdAt: '2026-06-05T10:04:00.000Z',
        metadata: {
          output_item_index: 0
        }
      }
    ],
    llmRequestSliceRows: [{
      id: '3',
      sliceId: 'slice_codex_stream',
      llmCallId: 'llm_codex_stream',
      traceId: 'trace_codex_stream',
      runId: 'run_internal_lease_1',
      agentTurn: 1,
      modelName: 'gpt-5.5',
      modelProvider: 'codex-local',
      wireProviderFormat: 'codex-local/responses',
      status: 'completed',
      createdAt: '2026-06-05T10:03:47.000Z',
      completedAt: '2026-06-05T10:04:00.000Z',
      tokenUsage: { input_tokens: 10, output_tokens: 4 },
      canonicalRequest: { input: [{ role: 'user', content: 'run date' }] },
      wireRequest: { model: 'gpt-5.5' },
      wireResponse: { id: 'resp_codex_stream' }
    }]
  });

  const stream = await persistence.getXiaoniActionStream({ limit: 5 });

  assert.deepEqual(stream.items.map((item) => item.id), [
    'stack:101',
    'llm-slice:slice_codex_stream'
  ]);
  assert.equal(stream.items.some((item) => item.kind === 'final_answer'), false);
  assert.equal(stream.current.latestActivityAt, '2026-06-05T10:04:00.000Z');
});

test('Xiaoni action stream orders events by real turn start + append index', async () => {
  // The slice row is persisted at finish time; its real request start is
  // completed_at - processing_time_ms. All events of the turn must share that
  // orderTurnMs, and order within the turn by append index (slice between
  // input and output). The runtime_input carries no slice id and must adopt
  // the turn whose input index range contains its stack_index.
  const completedAt = '2026-06-26T14:58:21.084Z';
  const processingTimeMs = 24014;
  const expectedTurnMs = Date.parse(completedAt) - processingTimeMs;
  const persistence = createPersistence({
    llmRequestSliceRows: [{
      id: '7',
      sliceId: 'slice_order',
      llmCallId: 'llm_order',
      identityKey: 'xiaoni',
      traceId: 'trace_order',
      runId: 'run_order',
      agentTurn: 1,
      modelName: 'claude-opus-4-6',
      status: 'completed',
      createdAt: completedAt,
      completedAt,
      processingTimeMs,
      inputStartIndex: 40,
      inputEndIndex: 40,
      outputStartIndex: 41,
      outputEndIndex: 42,
      tokenUsage: { input_tokens: 100, output_tokens: 5 },
      canonicalRequest: { input: [] },
      wireRequest: { model: 'claude-opus-4-6' },
      wireResponse: { id: 'resp_order' }
    }],
    agentStackRows: [
      {
        id: '440',
        eventId: 'stack:order:input',
        identityKey: 'xiaoni',
        stackIndex: 40,
        itemKind: 'runtime_input',
        content: { source: 'system_reminder', input_items: [{ role: 'user', type: 'message', content: [{ type: 'output_text', text: 'new input' }] }] },
        traceId: 'trace_order',
        runId: 'run_order',
        createdAt: '2026-06-26T14:58:21.000Z'
      },
      {
        id: '441',
        eventId: 'stack:order:fc',
        identityKey: 'xiaoni',
        stackIndex: 41,
        itemKind: 'function_call',
        toolCallId: 'call_order',
        llmRequestSliceId: 'slice_order',
        content: { type: 'function_call', call_id: 'call_order', name: 'exec_command', arguments: '{"cmd":"date"}' },
        traceId: 'trace_order',
        runId: 'run_order',
        createdAt: '2026-06-26T14:58:21.040Z'
      },
      {
        id: '442',
        eventId: 'stack:order:fco',
        identityKey: 'xiaoni',
        stackIndex: 42,
        itemKind: 'function_call_output',
        toolCallId: 'call_order',
        llmRequestSliceId: 'slice_order',
        content: { type: 'function_call_output', call_id: 'call_order', output: 'done' },
        traceId: 'trace_order',
        runId: 'run_order',
        createdAt: '2026-06-26T14:58:21.422Z'
      }
    ]
  });

  const stream = await persistence.getXiaoniActionStream({ limit: 10 });
  // The call + output (+execution) collapse into one tool lifecycle row, so the
  // turn yields: runtime_input, the slice, and the merged tool row.
  const turnItems = stream.items.filter((item) => item.metadata?.orderTurnMs === expectedTurnMs);
  assert.equal(turnItems.length, 3);
  // every event of the turn shares the real turn-start time, not the persist time
  for (const item of turnItems) {
    assert.equal(item.metadata.orderTurnMs, expectedTurnMs);
  }
  // within-turn order by append index: input(40) < slice(40.5) < tool(>=41)
  const ranks = turnItems.map((item) => item.metadata.orderRank).sort((a, b) => a - b);
  assert.equal(ranks[0], 40);
  assert.equal(ranks[1], 40.5);
  assert.ok(ranks[2] >= 41);
});

test('Xiaoni action stream surfaces 小腻 assistant output and drops empty turns', async () => {
  const persistence = createPersistence({
    agentStackRows: [
      {
        id: '301',
        eventId: 'stack:slice_a:output:0',
        identityKey: 'xiaoni',
        stackIndex: 30,
        itemKind: 'assistant_output',
        role: 'assistant',
        phase: 'final_answer',
        llmRequestSliceId: 'slice_a',
        content: {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: '先不回，等阿强把完整报错贴上来再说。' }]
        },
        traceId: 'trace_a',
        runId: 'run_a',
        createdAt: '2026-06-05T11:00:02.000Z',
        metadata: { output_item_index: 0 }
      },
      {
        id: '302',
        eventId: 'stack:slice_a:output:1',
        identityKey: 'xiaoni',
        stackIndex: 31,
        itemKind: 'assistant_output',
        role: 'assistant',
        phase: null,
        llmRequestSliceId: 'slice_a',
        content: { type: 'message', role: 'assistant', content: [] },
        traceId: 'trace_a',
        runId: 'run_a',
        createdAt: '2026-06-05T11:00:03.000Z',
        metadata: { output_item_index: 1 }
      }
    ]
  });

  const stream = await persistence.getXiaoniActionStream({ limit: 10 });
  const assistantItems = stream.items.filter((item) => item.metadata?.itemKind === 'assistant_output');

  assert.equal(assistantItems.length, 1);
  assert.equal(assistantItems[0].id, 'stack:301');
  assert.equal(assistantItems[0].source, 'llm_stack_item');
  assert.equal(assistantItems[0].kind, 'final_answer');
  assert.equal(assistantItems[0].metadata.llmRequestSliceId, 'slice_a');
  assert.ok(String(assistantItems[0].body).includes('先不回'));
  // empty assistant turn (stack:302) must not create a blank row
  assert.equal(stream.items.some((item) => item.id === 'stack:302'), false);
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
  assert.equal(actionStream.items[0].traceTarget.llmRequestSliceId, 'llm-1');
  assert.equal(actionStream.items[0].traceTarget.toolCallId, 'call-1');
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

test('Xiaoni action stream folds one tool lifecycle into one primary card', async () => {
  const persistence = createPersistence({
    llmRequestSliceRows: [{
      id: '901',
      sliceId: 'slice-recover',
      llmCallId: 'llm-recover',
      identityKey: 'xiaoni',
      traceId: 'runtrace_recover',
      runId: 'run-recover',
      createdAt: '2026-06-23T09:22:30.000Z',
      tokenUsage: {
        input_tokens: 72800,
        input_tokens_details: { cached_tokens: 72600 },
        output_tokens: 167
      }
    }],
    agentStackRows: [{
      id: '801',
      eventId: 'stack:runtrace_recover:tool-call:call_recover',
      identityKey: 'xiaoni',
      stackIndex: 40,
      itemKind: 'function_call',
      role: 'assistant',
      toolCallId: 'call_recover',
      llmRequestSliceId: 'slice-recover',
      content: {
        type: 'function_call',
        call_id: 'call_recover',
        name: 'recover_energy',
        arguments: '{"reason":"累了"}'
      },
      traceId: 'runtrace_recover',
      runId: 'run-recover',
      createdAt: '2026-06-23T09:22:34.000Z'
    }, {
      id: '802',
      eventId: 'stack:runtrace_recover:tool-output:call_recover',
      identityKey: 'xiaoni',
      stackIndex: 41,
      itemKind: 'function_call_output',
      role: 'tool',
      toolCallId: 'call_recover',
      llmRequestSliceId: 'slice-recover',
      content: {
        type: 'function_call_output',
        call_id: 'call_recover',
        output: { status_text: '开始休息' }
      },
      traceId: 'runtrace_recover',
      runId: 'run-recover',
      createdAt: '2026-06-23T09:22:34.000Z'
    }],
    agentStackToolRows: [{
      id: '702',
      executionId: 'tool:runtrace_recover:call_recover',
      identityKey: 'xiaoni',
      llmRequestSliceId: 'slice-recover',
      llmCallId: 'llm-recover',
      traceId: 'runtrace_recover',
      runId: 'run-recover',
      toolCallId: 'call_recover',
      toolName: 'recover_energy',
      arguments: { reason: '累了' },
      result: {
        status_text: '开始休息'
      },
      status: 'completed',
      sideEffect: true,
      startedAt: '2026-06-23T09:22:34.000Z',
      completedAt: '2026-06-23T09:22:34.000Z'
    }]
  });

  const stream = await persistence.getXiaoniActionStream({ limit: 10 });
  const toolItems = stream.items.filter((item) => item.metadata.toolCallId === 'call_recover');

  assert.equal(toolItems.length, 1);
  assert.equal(toolItems[0].id, 'tool-exec:tool:runtrace_recover:call_recover');
  assert.equal(toolItems[0].source, 'tool_execution');
  assert.equal(toolItems[0].eventKind, 'tool_lifecycle');
  assert.equal(toolItems[0].title, 'tool: recover_energy');
  assert.equal(toolItems[0].status, 'ok');
  assert.equal(toolItems[0].metadata.lifecycleRequestItemId, 'stack:801');
  assert.equal(toolItems[0].metadata.lifecycleExecutionItemId, 'tool-exec:tool:runtrace_recover:call_recover');
  assert.equal(toolItems[0].metadata.lifecycleCallbackItemId, 'stack:802');
  assert.equal(toolItems[0].metadata.toolArgumentsPreview, '{"reason":"累了"}');
  assert.match(toolItems[0].metadata.toolResultPreview, /开始休息/);
  assert.equal(toolItems[0].metadata.inputTokens, 72800);
  assert.equal(toolItems[0].metadata.cachedInputTokens, 72600);
  assert.equal(toolItems[0].metadata.outputTokens, 167);
  assert.equal(toolItems[0].traceTarget.spanId, 'tool-call:call_recover');
  assert.equal(toolItems[0].tags.some((tag) => tag.key === 'event:tool_lifecycle'), true);
  assert.equal(toolItems[0].tags.some((tag) => tag.key === 'event:tool_result_callback'), true);
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

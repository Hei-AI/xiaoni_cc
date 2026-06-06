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
      if (statement.includes('FROM agent_queue_messages') && statement.includes("source IN ('consciousness_tick', 'phone_notification')")) {
        return overrides.autonomousQueueRows || [];
      }
      if (statement.includes('FROM agent_queue_messages')) {
        return overrides.queueRows || [];
      }
      if (statement.includes('FROM tool_execution_logs')) {
        return overrides.toolRows || [];
      }
      if (statement.includes('FROM llm_call_logs')) {
        return overrides.llmRows || [];
      }
      return [];
    },
    close: async () => undefined
  });
  return createXiaoniActivityPersistence({
    getPrismaClient: () => prisma,
    createSqlAdapter: sqlAdapter,
    listXiaoniReplayEvents: async () => overrides.replayEvents || []
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

test('Xiaoni activity feed keeps SQL queue timestamps in storage timezone', async () => {
  const queueRow = {
    id: 4161,
    trace_id: 'runtrace_1',
    run_id: 'run_1',
    source: 'consciousness_tick',
    status: 'completed',
    body_for_agent: '还没有打开任何具体会话',
    updated_at: '2026-05-31T14:29:23.395+08:00',
    created_at: '2026-05-31T06:28:55.635+08:00',
    locked_at: null,
    available_at: '2026-05-31T06:28:55.635+08:00',
    completed_at: '2026-05-31T14:29:23.395+08:00',
    attempts: 1,
    session_key: 'qq:group:253631878',
    peer_name: '小腻',
    sender_name: '小腻',
    sender_id: '1129974489',
    error_message: null
  };
  const persistence = createPersistence({
    autonomousQueueRows: [queueRow]
  });

  const feed = await persistence.getXiaoniActivityFeed({ limit: 5 });

  assert.equal(feed.items[0].id, 'queue:4161');
  assert.equal(feed.items[0].title, '连续意识切片');
  assert.equal(feed.items[0].body, '还没有打开任何具体会话');
  assert.equal(feed.items[0].timestamp, '2026-05-31T14:29:23.395+08:00');
  assert.equal(feed.current.latestActivityAt, '2026-05-31T14:29:23.395+08:00');
  assert.equal(feed.current.autonomy.latestConsciousnessTickAt, '2026-05-31T14:29:23.395+08:00');
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
  assert.equal(feed.items.some((item) => item.id === 'llm:llm_chat'), true);
  assert.equal(serialized.includes('请用这个 exact query'), false);
  assert.equal(serialized.includes('today funny internet culture trend'), false);
});

test('Xiaoni activity feed promotes Codex provider wire payloads to first-class events', async () => {
  const wireRequest = '{"model":"gpt-5.5","input":[{"role":"user","content":"你发了么？"}]}';
  const wireResponse = '{"id":"resp_codex","output":[{"type":"function_call","name":"exec_command"}]}';
  const persistence = createPersistence({
    llmRows: [{
      id: 3,
      llm_call_id: 'llm_codex_1',
      trace_id: 'runtrace_codex_1',
      agent_turn: 2,
      agent_type: 'chat_bot',
      prompt_template: '小腻主AGENT',
      model_name: 'gpt-5.5',
      model_provider: 'codex-local',
      wire_provider_format: 'codex-local/responses',
      status: 'completed',
      started_at: new Date('2026-06-05T10:03:47.000Z'),
      completed_at: new Date('2026-06-05T10:04:00.000Z'),
      input_tokens: 10,
      output_tokens: 4,
      wire_request_preview_text: wireRequest,
      wire_response_preview_text: wireResponse,
      wire_request_bytes: Buffer.byteLength(wireRequest, 'utf8'),
      wire_response_bytes: Buffer.byteLength(wireResponse, 'utf8'),
      canonical_request: {
        instructions: 'normal chat instruction',
        input: [{
          role: 'user',
          content: '你发了么？'
        }]
      },
      processed_response: ''
    }]
  });

  const feed = await persistence.getXiaoniActivityFeed({ limit: 10 });
  const provider = feed.items.find((item) => item.id === 'provider:codex:llm_codex_1');

  assert.ok(provider);
  assert.equal(provider.source, 'provider_call');
  assert.equal(provider.kind, 'codex_provider');
  assert.equal(provider.title, 'Codex Provider 请求');
  assert.equal(provider.traceId, 'runtrace_codex_1');
  assert.equal(provider.metadata.spanId, 'provider-request:wire:llm_codex_1');
  assert.equal(provider.metadata.providerFormat, 'codex-local/responses');
  assert.equal(provider.metadata.providerRequestPreview, wireRequest);
  assert.equal(provider.metadata.providerResponsePreview, wireResponse);
  assert.equal(provider.metadata.providerRequestBytes, Buffer.byteLength(wireRequest, 'utf8'));
  assert.equal(provider.metadata.providerResponseBytes, Buffer.byteLength(wireResponse, 'utf8'));
  assert.equal(feed.items.some((item) => item.id === 'llm:llm_codex_1'), true);
});

test('Xiaoni action stream reads Codex provider replay from the unified ledger', async () => {
  const wireRequest = '{"model":"gpt-5.5","input":[{"role":"user","content":"你发了么？"}]}';
  const wireResponse = '{"id":"resp_codex","output":[{"type":"function_call","name":"exec_command"}]}';
  const persistence = createPersistence({
    llmRows: [{
      id: 4,
      llm_call_id: 'llm_codex_stream',
      trace_id: 'trace_codex_stream',
      run_id: 'run_internal_lease_1',
      agent_turn: 3,
      agent_type: 'chat_bot',
      prompt_template: '小腻主AGENT',
      model_name: 'gpt-5.5',
      model_provider: 'codex-local',
      wire_provider_format: 'codex-local/responses',
      status: 'completed',
      started_at: new Date('2026-06-05T10:03:47.000Z'),
      completed_at: new Date('2026-06-05T10:04:00.000Z'),
      input_tokens: 10,
      output_tokens: 4,
      wire_request_preview_text: wireRequest,
      wire_response_preview_text: wireResponse,
      wire_request_bytes: Buffer.byteLength(wireRequest, 'utf8'),
      wire_response_bytes: Buffer.byteLength(wireResponse, 'utf8'),
      canonical_request: {
        input: [{
          role: 'user',
          content: '你发了么？'
        }]
      },
      processed_response: ''
    }],
    replayEvents: [{
      id: '101',
      eventId: 'provider:codex:llm_codex_stream',
      identityKey: 'xiaoni',
      eventKind: 'codex_provider_request',
      source: 'codex_provider',
      occurredAt: '2026-06-05T10:03:47.000Z',
      traceId: 'trace_codex_stream',
      conversationId: '42',
      internalExecutionLeaseId: 'run_internal_lease_1',
      providerCallId: 'llm_codex_stream',
      toolCallId: null,
      modelName: 'gpt-5.5',
      modelProvider: 'codex-local',
      status: 'completed',
      replayable: true,
      replayPayload: {},
      wireRequest: { model: 'gpt-5.5', input: [{ role: 'user', content: '你发了么？' }] },
      wireResponse: { id: 'resp_codex', output: [{ type: 'function_call', name: 'exec_command' }] },
      metadata: {
        spanId: 'provider-request:wire:llm_codex_stream',
        providerFormat: 'codex-local/responses',
        inputTokens: 10,
        outputTokens: 4,
        completedAt: '2026-06-05T10:04:00.000Z'
      },
      sourceTable: 'llm_call_logs',
      sourceId: 'llm_codex_stream',
      createdAt: '2026-06-05T10:04:00.000Z',
      updatedAt: '2026-06-05T10:04:00.000Z'
    }]
  });

  const stream = await persistence.getXiaoniActionStream({ limit: 10 });
  const provider = stream.items.find((item) => item.id === 'provider:codex:llm_codex_stream');

  assert.ok(provider);
  assert.equal(stream.streamKind, 'xiaoni_action_stream');
  assert.equal(provider.eventKind, 'provider_request');
  assert.equal(provider.occurredAt, '2026-06-05T10:03:47.000Z');
  assert.equal(provider.status, 'ok');
  assert.equal(provider.runId, null);
  assert.equal(provider.internalExecutionLeaseId, 'run_internal_lease_1');
  assert.deepEqual(provider.traceTarget, {
    internalExecutionLeaseId: 'run_internal_lease_1',
    traceId: 'trace_codex_stream',
    spanId: 'provider-request:wire:llm_codex_stream'
  });
  assert.equal(provider.metadata.internalExecutionLeaseId, 'run_internal_lease_1');
  assert.equal(Object.prototype.hasOwnProperty.call(provider.metadata, 'completedAt'), false);
  assert.equal(provider.metadata.endedAt, '2026-06-05T10:04:00.000Z');
  assert.equal(provider.metadata.wirePayloadSource, 'xiaoni_replay_events');
  assert.equal(stream.items.filter((item) => item.source === 'provider_call').length, 1);
});

test('Xiaoni action stream does not synthesize raw trace targets for internal events', async () => {
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
  const life = stream.items.find((item) => item.id === 'life:501');

  assert.ok(life);
  assert.equal(life.internalExecutionLeaseId, 'run_internal_only');
  assert.equal(life.traceTarget, null);
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

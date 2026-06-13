'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createXiaoniAgentStackPersistence } = require('../xiaoni-agent-stack');

function createMockSql() {
  const calls = [];
  const rows = {
    stackHead: [{ stack_index: 7 }],
    forkHead: [{ item_index: 2 }],
    stackInsert: [],
    slice: [],
    tool: [],
    forkRun: [],
    forkItem: [],
    forkSlice: [],
    forkTool: [],
    imageForkRun: [],
    imageForkItem: [],
    imageForkSlice: [],
    rollupSource: [],
    rollupState: [{ initialized_at: '2026-06-11T00:00:00.000Z', version: 2 }]
  };
  let stackId = 10;
  let forkItemId = 70;
  const executor = {
    calls,
    rows,
    execute: async (sql, params = []) => {
      calls.push({ kind: 'execute', sql, params });
      return 1;
    },
    query: async (sql, params = []) => {
      calls.push({ kind: 'query', sql, params });
      if (sql.includes('pg_advisory_xact_lock')) {
        return [];
      }
      if (sql.includes('INSERT INTO llm_usage_rollup_state')) {
        if (!rows.rollupState.length) {
          rows.rollupState.push({ initialized_at: null, version: params[1] || 1 });
        }
        return [];
      }
      if (sql.includes('SELECT initialized_at') && sql.includes('FROM llm_usage_rollup_state')) {
        return rows.rollupState;
      }
      if (sql.includes('UPDATE llm_usage_rollup_state')) {
        rows.rollupState = [{
          initialized_at: '2026-06-11T00:00:02.000Z',
          version: sql.includes('version = ?') ? (params[0] || 2) : (rows.rollupState[0]?.version || 2)
        }];
        return [];
      }
      if (sql.includes('MAX(stack_index)')) {
        return rows.stackHead;
      }
      if (sql.includes('MAX(item_index)')) {
        return rows.forkHead;
      }
      if (sql.includes('INSERT INTO core_memory_compression_fork_runs')) {
        const row = {
          id: 60,
          fork_run_id: params[0],
          identity_key: params[1],
          context_session_key: params[2],
          status: params[3],
          trace_id: params[4],
          run_id: params[5],
          conversation_id: params[6],
          read_cutoff_after_conversation_id: params[7],
          previous_read_cutoff_after_conversation_id: params[8],
          summary_text: params[9],
          artifact: JSON.parse(params[10]),
          error_message: params[11],
          metadata: JSON.parse(params[12]),
          started_at: params[13] || '2026-06-11T00:00:00.000Z',
          completed_at: params[14],
          created_at: '2026-06-11T00:00:00.000Z',
          updated_at: '2026-06-11T00:00:00.000Z'
        };
        rows.forkRun.push(row);
        return [row];
      }
      if (sql.includes('UPDATE core_memory_compression_fork_runs')) {
        const existing = rows.forkRun.find((row) => row.fork_run_id === params[6]) || rows.forkRun[0];
        const row = {
          ...(existing || {
            id: 60,
            fork_run_id: params[6],
            identity_key: 'xiaoni',
            context_session_key: 'xiaoni:global',
            trace_id: 'trace-1',
            run_id: 'run-1',
            conversation_id: null,
            read_cutoff_after_conversation_id: null,
            previous_read_cutoff_after_conversation_id: null,
            created_at: '2026-06-11T00:00:00.000Z'
          }),
          status: params[0],
          summary_text: params[1] || existing?.summary_text || null,
          artifact: JSON.parse(params[2]),
          error_message: params[3],
          metadata: JSON.parse(params[4]),
          completed_at: params[5] || '2026-06-11T00:00:01.000Z',
          updated_at: '2026-06-11T00:00:01.000Z'
        };
        rows.forkRun = rows.forkRun.filter((entry) => entry.fork_run_id !== row.fork_run_id);
        rows.forkRun.push(row);
        return [row];
      }
      if (sql.includes('INSERT INTO core_memory_compression_fork_items')) {
        const row = {
          id: forkItemId++,
          event_id: params[0],
          fork_run_id: params[1],
          identity_key: params[2],
          item_index: params[3],
          item_kind: params[4],
          role: params[5],
          phase: params[6],
          provider_item_id: params[7],
          tool_call_id: params[8],
          llm_request_slice_id: params[9],
          content: JSON.parse(params[10]),
          visibility: params[11],
          source_type: params[12],
          source_id: params[13],
          trace_id: params[14],
          run_id: params[15],
          conversation_id: params[16],
          metadata: JSON.parse(params[17]),
          created_at: '2026-06-11T00:00:00.000Z',
          updated_at: '2026-06-11T00:00:00.000Z'
        };
        rows.forkItem.push(row);
        return [row];
      }
      if (sql.includes('INSERT INTO core_memory_compression_fork_slices')) {
        const row = {
          id: 80,
          slice_id: params[0],
          fork_run_id: params[1],
          llm_call_id: params[2],
          identity_key: params[3],
          input_start_index: params[4],
          input_end_index: params[5],
          input_stack_item_ids: JSON.parse(params[6]),
          output_start_index: params[7],
          output_end_index: params[8],
          canonical_request: JSON.parse(params[9]),
          wire_request: params[10] ? JSON.parse(params[10]) : null,
          canonical_response: params[11] ? JSON.parse(params[11]) : null,
          wire_response: params[12] ? JSON.parse(params[12]) : null,
          raw_response: params[13] ? JSON.parse(params[13]) : null,
          output_items: JSON.parse(params[14]),
          status: params[15],
          token_usage: JSON.parse(params[16]),
          trace_id: params[17],
          run_id: params[18],
          conversation_id: params[19],
          agent_turn: params[20],
          model_name: params[21],
          model_provider: params[22],
          request_format_version: params[23],
          wire_provider_format: params[24],
          processing_time_ms: params[25],
          metadata: JSON.parse(params[26]),
          completed_at: params[27],
          created_at: '2026-06-11T00:00:00.000Z',
          updated_at: '2026-06-11T00:00:00.000Z'
        };
        rows.forkSlice.push(row);
        return [row];
      }
      if (sql.includes('INSERT INTO core_memory_compression_fork_tool_executions')) {
        const row = {
          id: 90,
          execution_id: params[0],
          fork_run_id: params[1],
          identity_key: params[2],
          llm_request_slice_id: params[3],
          llm_call_id: params[4],
          tool_call_id: params[5],
          tool_name: params[6],
          arguments: JSON.parse(params[7]),
          raw_arguments: params[8],
          result: JSON.parse(params[9]),
          status: params[10],
          error_message: params[11],
          side_effect: params[12],
          trace_id: params[13],
          run_id: params[14],
          conversation_id: params[15],
          agent_turn: params[16],
          stack_call_item_id: params[17],
          stack_output_item_id: params[18],
          metadata: JSON.parse(params[19]),
          created_at: '2026-06-11T00:00:00.000Z',
          started_at: '2026-06-11T00:00:00.000Z',
          completed_at: params[21],
          updated_at: '2026-06-11T00:00:00.000Z'
        };
        rows.forkTool.push(row);
        return [row];
      }
      if (sql.includes('UPDATE core_memory_compression_fork_tool_executions')) {
        const existing = rows.forkTool.find((row) => row.execution_id === params[5]) || rows.forkTool[0];
        const row = {
          ...existing,
          status: params[0],
          result: JSON.parse(params[1]),
          error_message: params[2],
          stack_output_item_id: params[3],
          completed_at: params[4] || '2026-06-11T00:00:01.000Z',
          updated_at: '2026-06-11T00:00:01.000Z'
        };
        rows.forkTool = rows.forkTool.filter((entry) => entry.execution_id !== row.execution_id);
        rows.forkTool.push(row);
        return [row];
      }
      if (sql.includes('INSERT INTO agent_stack_items')) {
        const row = {
          id: stackId++,
          event_id: params[0],
          identity_key: params[1],
          stack_index: params[2],
          item_kind: params[3],
          role: params[4],
          phase: params[5],
          provider_item_id: params[6],
          tool_call_id: params[7],
          llm_request_slice_id: params[8],
          content: JSON.parse(params[9]),
          visibility: params[10],
          source_type: params[11],
          source_id: params[12],
          trace_id: params[13],
          run_id: params[14],
          conversation_id: params[15],
          metadata: JSON.parse(params[16]),
          created_at: '2026-06-11T00:00:00.000Z',
          updated_at: '2026-06-11T00:00:00.000Z'
        };
        rows.stackInsert.push(row);
        return [row];
      }
      if (sql.includes('INSERT INTO llm_request_slices')) {
        const row = {
          id: 30,
          slice_id: params[0],
          llm_call_id: params[1],
          identity_key: params[2],
          input_start_index: params[3],
          input_end_index: params[4],
          input_stack_item_ids: JSON.parse(params[5]),
          output_start_index: params[6],
          output_end_index: params[7],
          canonical_request: JSON.parse(params[8]),
          wire_request: params[9] ? JSON.parse(params[9]) : null,
          canonical_response: params[10] ? JSON.parse(params[10]) : null,
          wire_response: params[11] ? JSON.parse(params[11]) : null,
          raw_response: params[12] ? JSON.parse(params[12]) : null,
          output_items: JSON.parse(params[13]),
          status: params[14],
          token_usage: JSON.parse(params[15]),
          trace_id: params[16],
          run_id: params[17],
          conversation_id: params[18],
          agent_turn: params[19],
          model_name: params[20],
          model_provider: params[21],
          request_format_version: params[22],
          wire_provider_format: params[23],
          processing_time_ms: params[24],
          metadata: JSON.parse(params[25]),
          completed_at: params[26],
          created_at: '2026-06-11T00:00:00.000Z',
          updated_at: '2026-06-11T00:00:00.000Z'
        };
        rows.slice.push(row);
        return [row];
      }
      if (sql.includes("date_trunc('hour', created_at)") && sql.includes('WHERE slice_id = ?')) {
        const sourceKind = params[0];
        const sliceId = params[1];
        const sourceRows = sourceKind === 'compression_fork'
          ? rows.forkSlice
          : sourceKind === 'image_vision_fork'
            ? rows.imageForkSlice
            : rows.slice;
        const row = sourceRows.find((entry) => entry.slice_id === sliceId);
        if (!row) {
          return [];
        }
        return [{
          slice_id: row.slice_id,
          source_kind: sourceKind,
          fork_run_id: sourceKind === 'compression_fork' || sourceKind === 'image_vision_fork' ? row.fork_run_id : null,
          identity_key: row.identity_key,
          llm_call_id: row.llm_call_id,
          trace_id: row.trace_id,
          created_at: row.created_at,
          hour_bucket_start: row.created_at,
          day_bucket_start: row.created_at,
          month_bucket_start: row.created_at,
          input_tokens: row.token_usage.input_tokens || row.token_usage.inputTokens || row.token_usage.prompt_tokens || 0,
          cached_tokens: row.token_usage.cached_input_tokens || row.token_usage.cachedInputTokens || 0,
          output_tokens: row.token_usage.output_tokens || row.token_usage.outputTokens || row.token_usage.completion_tokens || 0
        }];
      }
      if (sql.includes('SELECT * FROM llm_usage_rollup_sources')) {
        return rows.rollupSource.filter((row) => row.slice_id === params[0]);
      }
      if (sql.includes('INSERT INTO llm_usage_rollup_sources')) {
        const row = {
          slice_id: params[0],
          source_kind: params[1],
          fork_run_id: params[2],
          identity_key: params[3],
          llm_call_id: params[4],
          trace_id: params[5],
          created_at: params[6],
          hour_bucket_start: params[7],
          day_bucket_start: params[8],
          month_bucket_start: params[9],
          input_tokens: params[10],
          cached_tokens: params[11],
          output_tokens: params[12],
          updated_at: '2026-06-11T00:00:02.000Z'
        };
        rows.rollupSource = rows.rollupSource.filter((entry) => entry.slice_id !== row.slice_id);
        rows.rollupSource.push(row);
        return [row];
      }
      if (sql.includes('FROM llm_usage_rollup_sources')) {
        return rows.rollupSource;
      }
      if (sql.includes('UPDATE llm_request_slices')) {
        const existing = rows.slice.find((row) => row.slice_id === params[6]) || rows.slice[0];
        if (!existing) {
          return [];
        }
        const row = {
          ...existing,
          input_start_index: params[0] ?? existing.input_start_index,
          input_end_index: params[1] ?? existing.input_end_index,
          input_stack_item_ids: params[2] ? JSON.parse(params[3]) : existing.input_stack_item_ids,
          output_start_index: params[4] ?? existing.output_start_index,
          output_end_index: params[5] ?? existing.output_end_index,
          updated_at: '2026-06-11T00:00:02.000Z'
        };
        rows.slice = rows.slice.map((entry) => entry.slice_id === row.slice_id ? row : entry);
        return [row];
      }
      if (sql.includes('FROM llm_request_slices')) {
        return rows.slice;
      }
      if (sql.includes('INSERT INTO tool_executions') || sql.includes('UPDATE tool_executions')) {
        const row = {
          id: 40,
          execution_id: sql.includes('INSERT') ? params[0] : params[5],
          identity_key: 'xiaoni',
          llm_request_slice_id: 'llm-1',
          llm_call_id: 'llm-1',
          tool_call_id: 'call-1',
          tool_name: 'exec_command',
          arguments: { cmd: 'pwd' },
          raw_arguments: '{"cmd":"pwd"}',
          result: sql.includes('INSERT') ? JSON.parse(params[8]) : JSON.parse(params[1]),
          status: sql.includes('INSERT') ? params[9] : params[0],
          error_message: sql.includes('INSERT') ? params[10] : params[2],
          side_effect: true,
          trace_id: 'trace-1',
          run_id: 'run-1',
          conversation_id: null,
          agent_turn: 1,
          stack_call_item_id: 10,
          stack_output_item_id: sql.includes('INSERT') ? null : params[3],
          metadata: {},
          created_at: '2026-06-11T00:00:00.000Z',
          started_at: '2026-06-11T00:00:00.000Z',
          completed_at: sql.includes('INSERT') ? null : '2026-06-11T00:00:01.000Z',
          updated_at: '2026-06-11T00:00:01.000Z'
        };
        rows.tool.push(row);
        return [row];
      }
      return [];
    },
    insert: async () => {
      throw new Error('not used');
    },
    withTransaction: async (callback) => callback(executor),
    close: async () => {
      calls.push({ kind: 'close' });
    }
  };
  return executor;
}

test('ensureXiaoniAgentStackSchema creates main, compression fork, and image fork ledger tables', async () => {
  const sql = createMockSql();
  const persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });

  await persistence.ensureXiaoniAgentStackSchema();

  const ddl = sql.calls.filter((call) => call.kind === 'execute').map((call) => call.sql).join('\n');
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS agent_stack_items/);
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS llm_request_slices/);
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS tool_executions/);
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS stack_compactions/);
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS core_memory_compression_fork_runs/);
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS core_memory_compression_fork_items/);
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS core_memory_compression_fork_slices/);
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS core_memory_compression_fork_tool_executions/);
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS image_vision_fork_runs/);
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS image_vision_fork_items/);
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS image_vision_fork_slices/);
});

test('appendAgentStackItems assigns monotonic identity-local stack indexes', async () => {
  const sql = createMockSql();
  const persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });

  const rows = await persistence.appendAgentStackItems({
    identityKey: 'xiaoni',
    traceId: 'trace-1',
    runId: 'run-1',
    sourceType: 'test',
    sourceId: 'source-1',
    items: [
      { itemKind: 'runtime_input', role: 'developer', content: { source: 'self_continuation' } },
      { itemKind: 'function_call', role: 'assistant', toolCallId: 'call-1', content: { type: 'function_call' } }
    ]
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].stackIndex, 8);
  assert.equal(rows[1].stackIndex, 9);
  assert.equal(rows[1].toolCallId, 'call-1');
  assert.equal(rows[0].sourceType, 'test');
});

test('recordLlmRequestSlice stores canonical request and output item range', async () => {
  const sql = createMockSql();
  const persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });

  const slice = await persistence.recordLlmRequestSlice({
    sliceId: 'llm-1',
    llmCallId: 'llm-1',
    inputStartIndex: 1,
    inputEndIndex: 8,
    outputStartIndex: 9,
    outputEndIndex: 10,
    canonicalRequest: { input: [{ role: 'developer' }] },
    canonicalResponse: { output: [{ type: 'function_call', call_id: 'call-1' }] },
    outputItems: [{ type: 'function_call', call_id: 'call-1' }],
    status: 'completed',
    tokenUsage: { input_tokens: 10, output_tokens: 3 },
    traceId: 'trace-1',
    runId: 'run-1',
    agentTurn: 1,
    modelName: 'gpt-test',
    modelProvider: 'codex'
  });

  assert.equal(slice.sliceId, 'llm-1');
  assert.equal(slice.inputStartIndex, 1);
  assert.equal(slice.outputEndIndex, 10);
  assert.equal(slice.outputItems[0].call_id, 'call-1');
  assert.equal(slice.tokenUsage.input_tokens, 10);
  assert.ok(sql.rows.rollupSource.some((row) => row.slice_id === 'llm-1' && row.source_kind === 'main'));
});

test('updateLlmRequestSliceStackLinks only updates stack indexes without rewriting provider payloads', async () => {
  const sql = createMockSql();
  const persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });

  await persistence.recordLlmRequestSlice({
    sliceId: 'llm-provider-owned',
    llmCallId: 'llm-provider-owned',
    canonicalRequest: { input: [{ role: 'developer', content: 'keep' }] },
    wireRequest: { model: 'gpt-test', input: ['wire'] },
    canonicalResponse: { output: [{ type: 'message' }] },
    wireResponse: { id: 'resp-1', output: [] },
    rawResponse: { id: 'resp-1' },
    outputItems: [{ type: 'message' }],
    status: 'completed',
    tokenUsage: { total_tokens: 13 },
    traceId: 'trace-1',
    runId: 'run-1',
    agentTurn: 1,
    modelName: 'gpt-test',
    modelProvider: 'codex'
  });

  const linked = await persistence.updateLlmRequestSliceStackLinks({
    sliceId: 'llm-provider-owned',
    inputStartIndex: 1,
    inputEndIndex: 8,
    inputStackItemIds: [1, 2, 3],
    outputStartIndex: 9,
    outputEndIndex: 10
  });
  const update = sql.calls.find((call) => call.kind === 'query' && call.sql.includes('UPDATE llm_request_slices'));

  assert.ok(update);
  assert.doesNotMatch(update.sql, /canonical_request/);
  assert.doesNotMatch(update.sql, /wire_request/);
  assert.doesNotMatch(update.sql, /wire_response/);
  assert.equal(linked.inputStartIndex, 1);
  assert.equal(linked.outputEndIndex, 10);
  assert.deepEqual(linked.inputStackItemIds, [1, 2, 3]);
  assert.deepEqual(linked.canonicalRequest, { input: [{ role: 'developer', content: 'keep' }] });
  assert.deepEqual(linked.wireRequest, { model: 'gpt-test', input: ['wire'] });
  assert.deepEqual(linked.wireResponse, { id: 'resp-1', output: [] });
});

test('listLlmRequestSlices summaryOnly avoids selecting large request and response payloads', async () => {
  const sql = createMockSql();
  sql.rows.slice.push({
    id: 30,
    slice_id: 'llm-1',
    llm_call_id: 'llm-1',
    identity_key: 'xiaoni',
    input_start_index: 1,
    input_end_index: 8,
    input_stack_item_ids: [],
    output_start_index: 9,
    output_end_index: 10,
    canonical_request: {},
    wire_request: null,
    provider_raw_trace_available: true,
    canonical_response: null,
    wire_response: null,
    raw_response: null,
    output_items: [],
    status: 'completed',
    token_usage: { input_tokens: 10, output_tokens: 3 },
    trace_id: 'trace-1',
    run_id: 'run-1',
    conversation_id: null,
    agent_turn: 1,
    model_name: 'gpt-test',
    model_provider: 'codex',
    request_format_version: 'responses/v1',
    wire_provider_format: 'openai/responses',
    processing_time_ms: 123,
    metadata: {},
    created_at: '2026-06-11T00:00:00.000Z',
    completed_at: '2026-06-11T00:00:01.000Z',
    updated_at: '2026-06-11T00:00:01.000Z'
  });
  const persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });

  const rows = await persistence.listLlmRequestSlices({ summaryOnly: true, limit: 10 });
  const query = sql.calls.find((call) => call.kind === 'query' && call.sql.includes('FROM llm_request_slices'));

  assert.ok(query);
  assert.match(query.sql, /NULL::jsonb AS wire_request/);
  assert.match(query.sql, /wire_request IS NOT NULL AS provider_raw_trace_available/);
  assert.doesNotMatch(query.sql, /SELECT \*/);
  assert.equal(rows[0].wireRequest, null);
  assert.equal(rows[0].providerRawTraceAvailable, true);
  assert.deepEqual(rows[0].outputItems, []);
});

test('listLlmRequestSlices rawTraceOnly selects only provider exchange payload columns', async () => {
  const sql = createMockSql();
  sql.rows.slice.push({
    id: 30,
    slice_id: 'llm-1',
    llm_call_id: 'llm-1',
    identity_key: 'xiaoni',
    input_start_index: null,
    input_end_index: null,
    input_stack_item_ids: [],
    output_start_index: null,
    output_end_index: null,
    canonical_request: {},
    wire_request: { model: 'gpt-test', input: ['hello'] },
    canonical_response: null,
    wire_response: { id: 'resp-1' },
    raw_response: { id: 'resp-1', output: [] },
    output_items: [],
    status: 'completed',
    token_usage: { input_tokens: 10, output_tokens: 3 },
    trace_id: 'trace-1',
    run_id: 'run-1',
    conversation_id: null,
    agent_turn: 1,
    model_name: 'gpt-test',
    model_provider: 'codex',
    request_format_version: 'responses/v1',
    wire_provider_format: 'openai/responses',
    processing_time_ms: 123,
    metadata: {
      provider_request_headers: { 'content-type': 'application/json' },
      provider_response_headers: { 'content-type': 'text/event-stream' }
    },
    created_at: '2026-06-11T00:00:00.000Z',
    completed_at: '2026-06-11T00:00:01.000Z',
    updated_at: '2026-06-11T00:00:01.000Z'
  });
  const persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });

  const rows = await persistence.listLlmRequestSlices({ rawTraceOnly: true, limit: 1 });
  const query = sql.calls.find((call) => call.kind === 'query' && call.sql.includes('FROM llm_request_slices'));

  assert.ok(query);
  assert.match(query.sql, /wire_request/);
  assert.match(query.sql, /wire_response/);
  assert.match(query.sql, /raw_response/);
  assert.match(query.sql, /metadata/);
  assert.match(query.sql, /NULL::jsonb AS canonical_response/);
  assert.doesNotMatch(query.sql, /SELECT \*/);
  assert.deepEqual(rows[0].wireRequest, { model: 'gpt-test', input: ['hello'] });
  assert.deepEqual(rows[0].rawResponse, { id: 'resp-1', output: [] });
});

test('recordToolExecution and completeToolExecution link tool result callback stack item', async () => {
  const sql = createMockSql();
  const persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });

  const running = await persistence.recordToolExecution({
    executionId: 'tool:run-1:call-1',
    llmRequestSliceId: 'llm-1',
    llmCallId: 'llm-1',
    toolCallId: 'call-1',
    toolName: 'exec_command',
    arguments: { cmd: 'pwd' },
    rawArguments: '{"cmd":"pwd"}',
    status: 'running',
    sideEffect: true,
    traceId: 'trace-1',
    runId: 'run-1',
    agentTurn: 1,
    stackCallItemId: 10
  });
  const completed = await persistence.completeToolExecution({
    executionId: 'tool:run-1:call-1',
    status: 'completed',
    result: { stdout: '/tmp' },
    stackOutputItemId: 11
  });

  assert.equal(running.executionId, 'tool:run-1:call-1');
  assert.equal(running.status, 'running');
  assert.equal(completed.status, 'completed');
  assert.equal(completed.stackOutputItemId, '11');
  assert.equal(completed.result.stdout, '/tmp');
});

test('core memory compression fork ledger stores run, slice, items, and tool execution outside main stack', async () => {
  const sql = createMockSql();
  const persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });

  const run = await persistence.recordCoreMemoryCompressionForkRun({
    forkRunId: 'fork-1',
    contextSessionKey: 'xiaoni:global',
    status: 'running',
    traceId: 'trace-1',
    runId: 'run-1',
    readCutoffAfterConversationId: 171,
    previousReadCutoffAfterConversationId: 99,
    metadata: { no_main_stack_persist: true }
  });
  const itemRows = await persistence.appendCoreMemoryCompressionForkItems({
    forkRunId: 'fork-1',
    traceId: 'trace-1',
    runId: 'run-1',
    sourceType: 'core_memory_compression_fork_slices',
    sourceId: 'fork-slice-1',
    llmRequestSliceId: 'fork-slice-1',
    items: [
      { itemKind: 'function_call', role: 'assistant', toolCallId: 'call-1', content: { type: 'function_call' } },
      { itemKind: 'function_call_output', role: 'tool', toolCallId: 'call-1', content: { type: 'function_call_output' } }
    ]
  });
  const slice = await persistence.recordCoreMemoryCompressionForkSlice({
    forkRunId: 'fork-1',
    sliceId: 'fork-slice-1',
    llmCallId: 'llm-fork-1',
    canonicalRequest: { input: [{ role: 'developer' }] },
    canonicalResponse: { output: [{ type: 'function_call', call_id: 'call-1' }] },
    outputItems: [{ type: 'function_call', call_id: 'call-1' }],
    outputStartIndex: 3,
    outputEndIndex: 4,
    status: 'completed',
    tokenUsage: { input_tokens: 18, cached_input_tokens: 6, output_tokens: 3 },
    traceId: 'trace-1',
    runId: 'run-1',
    agentTurn: 1,
    modelName: 'gpt-test'
  });
  const runningTool = await persistence.recordCoreMemoryCompressionForkToolExecution({
    forkRunId: 'fork-1',
    executionId: 'fork-tool-1',
    llmRequestSliceId: 'fork-slice-1',
    llmCallId: 'llm-fork-1',
    toolCallId: 'call-1',
    toolName: 'exec_command',
    arguments: { cmd: 'pwd' },
    rawArguments: '{"cmd":"pwd"}',
    status: 'running',
    sideEffect: true,
    traceId: 'trace-1',
    runId: 'run-1',
    agentTurn: 1,
    stackCallItemId: itemRows[0].id
  });
  const completedTool = await persistence.completeCoreMemoryCompressionForkToolExecution({
    executionId: 'fork-tool-1',
    status: 'completed',
    result: { stdout: '/tmp' },
    stackOutputItemId: itemRows[1].id
  });
  const completedRun = await persistence.completeCoreMemoryCompressionForkRun({
    forkRunId: 'fork-1',
    status: 'completed',
    summaryText: '压缩后的近况',
    artifact: { fork_turn_count: 1 },
    metadata: { fork_tool_call_count: 1 }
  });

  assert.equal(run.forkRunId, 'fork-1');
  assert.equal(run.readCutoffAfterConversationId, '171');
  assert.equal(itemRows.length, 2);
  assert.equal(itemRows[0].itemIndex, 3);
  assert.equal(itemRows[0].forkRunId, 'fork-1');
  assert.equal(slice.forkRunId, 'fork-1');
  assert.equal(slice.outputItems[0].call_id, 'call-1');
  assert.ok(sql.rows.rollupSource.some((row) => row.slice_id === 'fork-slice-1' && row.source_kind === 'compression_fork' && row.fork_run_id === 'fork-1'));
  assert.equal(runningTool.forkRunId, 'fork-1');
  assert.equal(completedTool.stackOutputItemId, itemRows[1].id);
  assert.equal(completedRun.summaryText, '压缩后的近况');
  assert.equal(sql.rows.stackInsert.length, 0);
});

test('attachConversationIdToAgentStackByTrace updates main stack, tools, and image fork rows', async () => {
  const sql = createMockSql();
  const persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });

  const count = await persistence.attachConversationIdToAgentStackByTrace({
    traceId: 'trace-1',
    conversationId: '42'
  });

  assert.equal(count, 6);
  const updates = sql.calls.filter((call) => call.kind === 'execute' && call.sql.includes('UPDATE '));
  assert.equal(updates.length, 6);
  assert.ok(updates.some((call) => call.sql.includes('agent_stack_items')));
  assert.ok(updates.some((call) => call.sql.includes('llm_request_slices')));
  assert.ok(updates.some((call) => call.sql.includes('tool_executions')));
  assert.ok(updates.some((call) => call.sql.includes('image_vision_fork_runs')));
  assert.ok(updates.some((call) => call.sql.includes('image_vision_fork_items')));
  assert.ok(updates.some((call) => call.sql.includes('image_vision_fork_slices')));
});

function createUsageTimelineSqlMock({ totalCount = 2, pointRows = [], searchRows = [] } = {}) {
  const calls = [];
  return {
    calls,
    execute: async (sql, params = []) => {
      calls.push({ kind: 'execute', sql, params });
      return 1;
    },
    query: async (sql, params = []) => {
      calls.push({ kind: 'query', sql, params });
      if (sql.includes('MIN(created_at) AS first_at') && sql.includes('FROM llm_usage_rollup_sources')) {
        return [{
          first_at: '2026-06-13T00:00:00.000+08:00',
          last_at: '2026-06-13T01:00:00.000+08:00',
          total_count: totalCount
        }];
      }
      if (sql.includes('SELECT initialized_at') && sql.includes('FROM llm_usage_rollup_state')) {
        return [{ initialized_at: '2026-06-13T00:00:00.000+08:00', version: 2 }];
      }
      if (sql.includes('SELECT COUNT(*) AS total_count') && sql.includes('FROM llm_usage_rollup_sources')) {
        return [{ total_count: totalCount }];
      }
      if (sql.includes('AS match_field')) {
        return searchRows;
      }
      if (sql.includes('FROM llm_usage_rollup_sources') || sql.includes('FROM llm_usage_rollups')) {
        return pointRows;
      }
      return [];
    },
    close: async () => {}
  };
}

test('getXiaoniLlmUsageTimeline returns per-call token points with anchors and peaks', async () => {
  const sql = createUsageTimelineSqlMock({
    totalCount: 2,
    pointRows: [
      {
        key: 'slice-1',
        timestamp: '2026-06-13T00:10:00.000+08:00',
        bucket_start: '2026-06-13T00:10:00.000+08:00',
        bucket_end: '2026-06-13T00:10:00.000+08:00',
        call_count: 1,
        input_tokens: 1000,
        cached_tokens: 200,
        output_tokens: 50,
        llm_request_slice_id: 'slice-1',
        llm_call_id: 'llm-1',
        trace_id: 'trace-1',
        top_llm_request_slice_id: 'slice-1',
        top_llm_call_id: 'llm-1',
        top_trace_id: 'trace-1',
        top_timestamp: '2026-06-13T00:10:00.000+08:00',
        top_input_tokens: 1000,
        top_cached_tokens: 200,
        top_output_tokens: 50
      },
      {
        key: 'slice-2',
        timestamp: '2026-06-13T00:20:00.000+08:00',
        bucket_start: '2026-06-13T00:20:00.000+08:00',
        bucket_end: '2026-06-13T00:20:00.000+08:00',
        call_count: 1,
        input_tokens: 400,
        cached_tokens: 100,
        output_tokens: 300,
        llm_request_slice_id: 'slice-2',
        llm_call_id: 'llm-2',
        trace_id: 'trace-2',
        top_llm_request_slice_id: 'slice-2',
        top_llm_call_id: 'llm-2',
        top_trace_id: 'trace-2',
        top_timestamp: '2026-06-13T00:20:00.000+08:00',
        top_input_tokens: 400,
        top_cached_tokens: 100,
        top_output_tokens: 300
      }
    ]
  });
  const persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });

  const timeline = await persistence.getXiaoniLlmUsageTimeline({
    identityKey: 'xiaoni',
    bucket: 'call',
    maxPoints: 100,
    includePeaks: true
  });

  assert.equal(timeline.bucket, 'call');
  assert.equal(timeline.points.length, 2);
  assert.equal(timeline.points[0].anchorEventId, 'llm-slice:slice-1');
  assert.equal(timeline.summary.inputTokens, 1400);
  assert.equal(timeline.summary.cachedTokens, 300);
  assert.equal(timeline.summary.outputTokens, 350);
  assert.equal(timeline.summary.totalTokens, 1750);
  assert.equal(timeline.summary.cacheRatio, 300 / 1400);
  assert.ok(timeline.peaks.some((peak) => peak.reason === 'largest_input_tokens' && peak.anchorEventId === 'llm-slice:slice-1'));
});

test('getXiaoniLlmUsageTimeline auto-escalates dense call ranges to buckets', async () => {
  const sql = createUsageTimelineSqlMock({
    totalCount: 3000,
    pointRows: [
      {
        key: 'hour:2026-06-13 00:00:00',
        timestamp: '2026-06-13T00:00:00.000+08:00',
        bucket_start: '2026-06-13T00:00:00.000+08:00',
        bucket_end: '2026-06-13T01:00:00.000+08:00',
        call_count: 3000,
        input_tokens: 9000,
        cached_tokens: 3000,
        output_tokens: 1200,
        top_llm_request_slice_id: 'slice-peak',
        top_llm_call_id: 'llm-peak',
        top_trace_id: 'trace-peak',
        top_timestamp: '2026-06-13T00:30:00.000+08:00',
        top_input_tokens: 5000,
        top_cached_tokens: 1000,
        top_output_tokens: 500
      }
    ]
  });
  const persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });

  const timeline = await persistence.getXiaoniLlmUsageTimeline({
    identityKey: 'xiaoni',
    bucket: 'call',
    maxPoints: 100
  });

  assert.equal(timeline.requestedBucket, 'call');
  assert.equal(timeline.bucket, 'hour');
  assert.equal(timeline.downsampled, true);
  assert.ok(timeline.warnings.includes('call_bucket_too_dense'));
  assert.equal(timeline.points[0].topEvent.eventId, 'llm-slice:slice-peak');
  assert.ok(sql.calls.some((call) => call.kind === 'query' && call.sql.includes('FROM llm_usage_rollups')));
  assert.ok(sql.calls.some((call) => call.kind === 'query' && call.sql.includes('AND bucket = ?') && call.params.includes('hour')));
});

test('getXiaoniLlmUsageTimeline includes compression fork slices with fork anchors', async () => {
  const sql = createUsageTimelineSqlMock({
    totalCount: 1,
    pointRows: [
      {
        key: 'compression_fork:fork-slice-1',
        timestamp: '2026-06-13T00:10:00.000+08:00',
        bucket_start: '2026-06-13T00:10:00.000+08:00',
        bucket_end: '2026-06-13T00:10:00.000+08:00',
        call_count: 1,
        input_tokens: 1800,
        cached_tokens: 600,
        output_tokens: 90,
        source_kind: 'compression_fork',
        fork_run_id: 'fork-1',
        llm_request_slice_id: 'fork-slice-1',
        llm_call_id: 'llm-fork-1',
        trace_id: 'trace-fork-1',
        top_llm_request_slice_id: 'fork-slice-1',
        top_source_kind: 'compression_fork',
        top_fork_run_id: 'fork-1',
        top_llm_call_id: 'llm-fork-1',
        top_trace_id: 'trace-fork-1',
        top_timestamp: '2026-06-13T00:10:00.000+08:00',
        top_input_tokens: 1800,
        top_cached_tokens: 600,
        top_output_tokens: 90
      }
    ]
  });
  const persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });

  const timeline = await persistence.getXiaoniLlmUsageTimeline({
    identityKey: 'xiaoni',
    bucket: 'call',
    maxPoints: 100
  });

  assert.equal(timeline.points.length, 1);
  assert.equal(timeline.points[0].sourceKind, 'compression_fork');
  assert.equal(timeline.points[0].forkRunId, 'fork-1');
  assert.equal(timeline.points[0].anchorEventId, 'compression-fork-slice:fork-slice-1');
  assert.equal(timeline.points[0].topEvent.eventId, 'compression-fork-slice:fork-slice-1');
  assert.equal(timeline.summary.inputTokens, 1800);
});

test('getXiaoniLlmUsageTimeline includes image vision fork slices with fork anchors', async () => {
  const sql = createUsageTimelineSqlMock({
    totalCount: 1,
    pointRows: [
      {
        key: 'image_vision_fork:image-slice-1',
        timestamp: '2026-06-13T00:12:00.000+08:00',
        bucket_start: '2026-06-13T00:12:00.000+08:00',
        bucket_end: '2026-06-13T00:12:00.000+08:00',
        call_count: 1,
        input_tokens: 2200,
        cached_tokens: 2100,
        output_tokens: 70,
        source_kind: 'image_vision_fork',
        fork_run_id: 'image-fork-1',
        llm_request_slice_id: 'image-slice-1',
        llm_call_id: 'llm-image-1',
        trace_id: 'trace-image-1',
        top_llm_request_slice_id: 'image-slice-1',
        top_source_kind: 'image_vision_fork',
        top_fork_run_id: 'image-fork-1',
        top_llm_call_id: 'llm-image-1',
        top_trace_id: 'trace-image-1',
        top_timestamp: '2026-06-13T00:12:00.000+08:00',
        top_input_tokens: 2200,
        top_cached_tokens: 2100,
        top_output_tokens: 70
      }
    ]
  });
  const persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });

  const timeline = await persistence.getXiaoniLlmUsageTimeline({
    identityKey: 'xiaoni',
    bucket: 'call',
    maxPoints: 100
  });

  assert.equal(timeline.points.length, 1);
  assert.equal(timeline.points[0].sourceKind, 'image_vision_fork');
  assert.equal(timeline.points[0].forkRunId, 'image-fork-1');
  assert.equal(timeline.points[0].anchorEventId, 'image-vision-fork-slice:image-slice-1');
  assert.equal(timeline.points[0].topEvent.eventId, 'image-vision-fork-slice:image-slice-1');
  assert.equal(timeline.summary.cachedTokens, 2100);
});

test('getXiaoniLlmUsageTimeline returns search hit overlay points', async () => {
  const sql = createUsageTimelineSqlMock({
    totalCount: 1,
    pointRows: [
      {
        key: 'slice-1',
        timestamp: '2026-06-13T00:10:00.000+08:00',
        bucket_start: '2026-06-13T00:10:00.000+08:00',
        bucket_end: '2026-06-13T00:10:00.000+08:00',
        call_count: 1,
        input_tokens: 1000,
        cached_tokens: 200,
        output_tokens: 50,
        llm_request_slice_id: 'slice-1',
        llm_call_id: 'llm-1',
        trace_id: 'trace-1',
        top_llm_request_slice_id: 'slice-1',
        top_llm_call_id: 'llm-1',
        top_trace_id: 'trace-1',
        top_timestamp: '2026-06-13T00:10:00.000+08:00',
        top_input_tokens: 1000,
        top_cached_tokens: 200,
        top_output_tokens: 50
      }
    ],
    searchRows: [
      {
        llm_request_slice_id: 'slice-1',
        llm_call_id: 'llm-1',
        trace_id: 'trace-1',
        timestamp: '2026-06-13T00:10:00.000+08:00',
        input_tokens: 1000,
        cached_tokens: 200,
        output_tokens: 50,
        match_field: 'wire_response',
        snippet: '{"output":"needle"}'
      }
    ]
  });
  const persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });

  const timeline = await persistence.getXiaoniLlmUsageTimeline({
    identityKey: 'xiaoni',
    bucket: 'call',
    maxPoints: 100,
    includeOverlays: 'search',
    searchQuery: 'needle'
  });

  assert.equal(timeline.overlays.searchHits.length, 1);
  assert.equal(timeline.overlays.searchHits[0].anchorEventId, 'llm-slice:slice-1');
  assert.equal(timeline.overlays.searchHits[0].field, 'wire_response');
  assert.equal(timeline.overlays.searchHits[0].query, 'needle');
  assert.ok(sql.calls.some((call) => call.kind === 'query' && call.sql.includes('AS match_field') && call.params.includes('%needle%')));
});

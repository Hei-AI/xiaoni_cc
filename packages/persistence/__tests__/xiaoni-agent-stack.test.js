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
    forkTool: []
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

test('ensureXiaoniAgentStackSchema creates stack, slice, tool, compaction, and fork ledger tables', async () => {
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
  assert.doesNotMatch(query.sql, /SELECT \*/);
  assert.equal(rows[0].wireRequest, null);
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
    tokenUsage: { total_tokens: 21 },
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
  assert.equal(runningTool.forkRunId, 'fork-1');
  assert.equal(completedTool.stackOutputItemId, itemRows[1].id);
  assert.equal(completedRun.summaryText, '压缩后的近况');
  assert.equal(sql.rows.stackInsert.length, 0);
});

test('attachConversationIdToAgentStackByTrace updates stack, slices, and tool executions', async () => {
  const sql = createMockSql();
  const persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });

  const count = await persistence.attachConversationIdToAgentStackByTrace({
    traceId: 'trace-1',
    conversationId: '42'
  });

  assert.equal(count, 3);
  const updates = sql.calls.filter((call) => call.kind === 'execute' && call.sql.includes('UPDATE '));
  assert.equal(updates.length, 3);
  assert.ok(updates.some((call) => call.sql.includes('agent_stack_items')));
  assert.ok(updates.some((call) => call.sql.includes('llm_request_slices')));
  assert.ok(updates.some((call) => call.sql.includes('tool_executions')));
});

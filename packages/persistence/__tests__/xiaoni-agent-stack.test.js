'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createXiaoniAgentStackPersistence } = require('../xiaoni-agent-stack');

function createMockSql() {
  const calls = [];
  const rows = {
    stackHead: [{ stack_index: 7 }],
    stackInsert: [],
    slice: [],
    tool: []
  };
  let stackId = 10;
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

test('ensureXiaoniAgentStackSchema creates stack, slice, tool, and compaction tables', async () => {
  const sql = createMockSql();
  const persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });

  await persistence.ensureXiaoniAgentStackSchema();

  const ddl = sql.calls.filter((call) => call.kind === 'execute').map((call) => call.sql).join('\n');
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS agent_stack_items/);
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS llm_request_slices/);
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS tool_executions/);
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS stack_compactions/);
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

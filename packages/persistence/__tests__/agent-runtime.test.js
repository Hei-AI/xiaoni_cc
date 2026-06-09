'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentRuntimePersistence } = require('../agent-runtime');

test('ensureAgentRuntimeSchema includes agent-only runtime tables and delivery columns', async () => {
  const statements = [];
  const persistence = createAgentRuntimePersistence({
    sqlAdapter: {
      execute: async (sql) => {
        statements.push(sql);
        return 1;
      },
      query: async () => [],
      withTransaction: async () => {
        throw new Error('schema should not open transaction');
      },
      close: async () => undefined
    }
  });

  await persistence.ensureAgentRuntimeSchema({ profile: 'agent' });

  const createLlmLogsIndex = statements.findIndex((sql) => sql.includes('CREATE TABLE IF NOT EXISTS llm_call_logs'));
  const alterLlmLogsIndex = statements.findIndex((sql) => sql.includes('ALTER TABLE llm_call_logs'));
  const indexLlmLogsIndex = statements.findIndex((sql) => sql.includes('CREATE INDEX IF NOT EXISTS idx_llm_call_logs_trace_started_id'));
  assert.notEqual(createLlmLogsIndex, -1);
  assert.notEqual(alterLlmLogsIndex, -1);
  assert.notEqual(indexLlmLogsIndex, -1);
  assert.ok(createLlmLogsIndex < alterLlmLogsIndex);
  assert.ok(createLlmLogsIndex < indexLlmLogsIndex);
  assert.ok(statements.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS agent_queue_messages')));
  assert.ok(statements.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS conversation_items')));
  assert.ok(statements.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS agent_session_context_windows')));
  assert.ok(statements.some((sql) => sql.includes('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS delivery_phase')));
});

test('recordLlmCallLog writes normalized provider call payload', async () => {
  const inserts = [];
  const persistence = createAgentRuntimePersistence({
    sqlAdapter: {
      insert: async (sql, params = []) => {
        inserts.push({ sql, params });
        return { insertId: 1 };
      },
      execute: async () => {
        throw new Error('recordLlmCallLog should insert only');
      },
      query: async () => [],
      withTransaction: async () => {
        throw new Error('recordLlmCallLog should not open transaction');
      },
      close: async () => undefined
    }
  });

  await persistence.recordLlmCallLog({
    llmCallId: 'llm-1',
    traceId: 'trace-1',
    conversationId: '42',
    agentTurn: 3,
    modelName: 'gpt-test',
    modelProvider: 'codex',
    canonicalRequest: { input: [] },
    canonicalResponse: { ok: true },
    wireRequest: { raw: 'request' },
    wireResponse: { raw: 'response' },
    effectiveUnifiedConfig: { model: { provider: 'codex' } },
    processedResponse: 'done',
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      processingTimeMs: 123,
      cachedInputTokens: 2,
      reasoningTokens: 1,
      rawUsage: { total_tokens: 15 }
    },
    requestFormatVersion: 'responses-v1',
    wireProviderFormat: 'codex-responses'
  });

  assert.equal(inserts.length, 1);
  assert.ok(inserts[0].sql.includes('INSERT INTO llm_call_logs'));
  assert.equal(inserts[0].params[0], 'llm-1');
  assert.equal(inserts[0].params[1], 'trace-1');
  assert.equal(inserts[0].params[2], 42);
  assert.equal(inserts[0].params[3], 3);
  assert.equal(inserts[0].params[16], 'done');
  assert.equal(inserts[0].params[17], 'completed');
  assert.equal(JSON.parse(inserts[0].params[24]).total_tokens, 15);
});

test('createConversationWithItems inserts conversation and transcript items', async () => {
  const inserts = [];
  const persistence = createAgentRuntimePersistence({
    sqlAdapter: {
      insert: async (sql, params = []) => {
        inserts.push({ sql, params });
        return { insertId: inserts.length === 1 ? 77 : inserts.length };
      },
      execute: async () => {
        throw new Error('createConversationWithItems should insert only');
      },
      query: async () => [],
      withTransaction: async () => {
        throw new Error('createConversationWithItems should not open transaction');
      },
      close: async () => undefined
    }
  });

  const conversationId = await persistence.createConversationWithItems({
    userId: 10001,
    groupId: 42,
    userMessage: 'hi',
    aiResponse: 'hello',
    responseTimeMs: 12,
    status: 'completed',
    modelName: 'gpt-test',
    traceId: 'trace-1',
    rawRequest: { source: 'test' },
    rawResponse: { output: 'hello' },
    sessionKey: 'qq:group:42',
    transcriptItems: [{
      role: 'assistant',
      phase: 'final_answer',
      content: 'hello',
      groupIndex: 1,
      itemIndex: 0,
      source: 'delivery',
      deliveryMessageId: 9,
      runId: 'run-1'
    }]
  });

  assert.equal(conversationId, 77);
  assert.ok(inserts[0].sql.includes('INSERT INTO conversations'));
  assert.ok(inserts[1].sql.includes('INSERT INTO conversation_items'));
  assert.equal(inserts[1].params[0], 77);
  assert.equal(inserts[1].params[1], 'qq:group:42');
  assert.equal(inserts[1].params[3], 'final_answer');
});

test('listStoredConversationTurns restores queue source ids and raw payloads', async () => {
  const queries = [];
  const persistence = createAgentRuntimePersistence({
    sqlAdapter: {
      query: async (sql, params = []) => {
        queries.push({ sql, params });
        if (sql.includes('FROM conversations')) {
          return [{
            id: 5,
            user_id: 10001,
            group_id: 42,
            user_message: 'hi',
            ai_response: null,
            timestamp: '2026-06-09 12:00:00.000',
            response_time: 0,
            status: 'received',
            error_reason: null,
            model_name: null,
            raw_request: JSON.stringify({ source_message_ids: [1], source_message_sids: ['fallback'] }),
            raw_response: '{}',
            trace_id: 'trace-1'
          }];
        }
        if (sql.includes('FROM agent_queue_messages')) {
          return [{
            trace_id: 'trace-1',
            message_sid: 'sid-2',
            payload: JSON.stringify({ messageId: 2 })
          }];
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
      execute: async () => {
        throw new Error('listStoredConversationTurns should not execute writes');
      },
      withTransaction: async () => {
        throw new Error('listStoredConversationTurns should not open transaction');
      },
      close: async () => undefined
    }
  });

  const turns = await persistence.listStoredConversationTurns({ userId: 10001, groupId: 42, limit: 10 });

  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0].params, [42]);
  assert.deepEqual(turns[0].raw_request, { source_message_ids: [1], source_message_sids: ['fallback'] });
  assert.deepEqual(turns[0].source_message_ids, [2]);
  assert.deepEqual(turns[0].source_message_sids, ['sid-2']);
});

test('upsertTranscriptSnapshot preserves pending and ready snapshot fields', async () => {
  const executes = [];
  const persistence = createAgentRuntimePersistence({
    sqlAdapter: {
      execute: async (sql, params = []) => {
        executes.push({ sql, params });
        return 1;
      },
      query: async () => [],
      withTransaction: async () => {
        throw new Error('upsertTranscriptSnapshot should not open transaction');
      },
      close: async () => undefined
    }
  });

  await persistence.upsertTranscriptSnapshot({
    sessionId: 'group:42',
    chatType: 'group',
    groupId: 42,
    summaryText: 'summary',
    summaryFormatVersion: 'v1',
    summarizedThroughConversationId: 99,
    summaryStatus: 'ready',
    summaryJobId: 'job-1',
    lastCompactedAt: '2026-06-09T12:00:00.000Z'
  });

  assert.equal(executes.length, 1);
  assert.ok(executes[0].sql.includes('INSERT INTO chat_transcript_snapshots'));
  assert.equal(executes[0].params[0], 'group:42');
  assert.equal(executes[0].params[1], 'group');
  assert.equal(executes[0].params[3], 42);
  assert.equal(executes[0].params[7], 'ready');
  assert.equal(executes[0].params[8], 'job-1');
});

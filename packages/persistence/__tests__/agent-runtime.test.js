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

  const dropLegacyLlmLogsIndex = statements.findIndex((sql) => sql.includes('DROP TABLE IF EXISTS llm_call_logs'));
  const dropLegacyToolLogsIndex = statements.findIndex((sql) => sql.includes('DROP TABLE IF EXISTS tool_execution_logs'));
  const dropLegacyReplayIndex = statements.findIndex((sql) => sql.includes('DROP TABLE IF EXISTS xiaoni_replay_events'));
  const createAgentQueueIndex = statements.findIndex((sql) => sql.includes('CREATE TABLE IF NOT EXISTS agent_queue_messages'));
  const alterAgentQueueIndex = statements.findIndex((sql) => sql.includes('ALTER TABLE agent_queue_messages'));
  assert.notEqual(dropLegacyLlmLogsIndex, -1);
  assert.notEqual(dropLegacyToolLogsIndex, -1);
  assert.notEqual(dropLegacyReplayIndex, -1);
  assert.notEqual(createAgentQueueIndex, -1);
  assert.notEqual(alterAgentQueueIndex, -1);
  assert.equal(statements.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS llm_call_logs')), false);
  assert.equal(statements.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS tool_execution_logs')), false);
  assert.equal(statements.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS xiaoni_replay_events')), false);
  assert.ok(createAgentQueueIndex < alterAgentQueueIndex);
  assert.ok(statements.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS conversation_items')));
  assert.ok(statements.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS agent_session_context_windows')));
  assert.ok(statements.some((sql) => sql.includes('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS delivery_phase')));
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

test('commitSessionContextSummaryAndReadCutoff writes summary and cutoff in one locked transaction', async () => {
  const queries = [];
  const tx = {
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.includes('pg_advisory_xact_lock')) {
        return [];
      }
      if (sql.includes('FOR UPDATE')) {
        return [{
          session_key: 'xiaoni:test-global',
          read_cutoff_after_conversation_id: 100,
          last_context_window_tokens: 400000,
          last_target_budget_tokens: 280000,
          last_hard_budget_tokens: 380000,
          context_summary: 'old summary',
          pending_proactive_share: null,
          pending_proactive_share_age: 0,
          updated_at: '2026-06-14T00:00:00.000Z'
        }];
      }
      if (sql.includes('INSERT INTO agent_session_context_windows')) {
        return [{
          session_key: 'xiaoni:test-global',
          read_cutoff_after_conversation_id: 171,
          last_context_window_tokens: 400000,
          last_target_budget_tokens: 280000,
          last_hard_budget_tokens: 380000,
          context_summary: 'new summary',
          pending_proactive_share: null,
          pending_proactive_share_age: 0,
          updated_at: '2026-06-14T00:01:00.000Z'
        }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const persistence = createAgentRuntimePersistence({
    sqlAdapter: {
      withTransaction: async (callback) => callback(tx),
      query: async () => {
        throw new Error('commitSessionContextSummaryAndReadCutoff should use transaction');
      },
      execute: async () => {
        throw new Error('commitSessionContextSummaryAndReadCutoff should not use execute');
      },
      close: async () => undefined
    }
  });

  const result = await persistence.commitSessionContextSummaryAndReadCutoff({
    sessionKey: 'xiaoni:test-global',
    contextSummary: 'new summary',
    readCutoffAfterConversationId: 171,
    lastContextWindowTokens: 400000,
    lastTargetBudgetTokens: 280000,
    lastHardBudgetTokens: 380000
  });

  assert.equal(result.committed, true);
  assert.equal(result.state.readCutoffAfterConversationId, 171);
  assert.equal(result.state.contextSummary, 'new summary');
  assert.equal(queries[0].sql.includes('pg_advisory_xact_lock'), true);
  assert.equal(queries[1].sql.includes('FOR UPDATE'), true);
  assert.equal(queries[2].sql.includes('INSERT INTO agent_session_context_windows'), true);
  assert.equal(queries[2].params[0], 'xiaoni:test-global');
  assert.equal(queries[2].params[1], 'new summary');
  assert.equal(queries[2].params[2], 171);
});

test('commitSessionContextSummaryAndReadCutoff no-ops when current cutoff already covers target', async () => {
  const queries = [];
  const tx = {
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.includes('pg_advisory_xact_lock')) {
        return [];
      }
      if (sql.includes('FOR UPDATE')) {
        return [{
          session_key: 'xiaoni:test-global',
          read_cutoff_after_conversation_id: 200,
          last_context_window_tokens: 400000,
          last_target_budget_tokens: 280000,
          last_hard_budget_tokens: 380000,
          context_summary: 'newer summary',
          pending_proactive_share: null,
          pending_proactive_share_age: 0,
          updated_at: '2026-06-14T00:02:00.000Z'
        }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const persistence = createAgentRuntimePersistence({
    sqlAdapter: {
      withTransaction: async (callback) => callback(tx),
      query: async () => {
        throw new Error('commitSessionContextSummaryAndReadCutoff should use transaction');
      },
      execute: async () => {
        throw new Error('commitSessionContextSummaryAndReadCutoff should not use execute');
      },
      close: async () => undefined
    }
  });

  const result = await persistence.commitSessionContextSummaryAndReadCutoff({
    sessionKey: 'xiaoni:test-global',
    contextSummary: 'late summary',
    readCutoffAfterConversationId: 171,
    lastContextWindowTokens: 400000,
    lastTargetBudgetTokens: 280000,
    lastHardBudgetTokens: 380000
  });

  assert.equal(result.committed, false);
  assert.equal(result.state.readCutoffAfterConversationId, 200);
  assert.equal(result.state.contextSummary, 'newer summary');
  assert.equal(queries.length, 2);
  assert.equal(queries.some((entry) => entry.sql.includes('INSERT INTO agent_session_context_windows')), false);
});

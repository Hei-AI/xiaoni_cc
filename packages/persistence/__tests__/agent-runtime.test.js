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
  assert.equal(statements.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS conversation_items')), false);
  assert.ok(statements.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS agent_session_context_windows')));
  assert.ok(statements.some((sql) => sql.includes('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS delivery_phase')));
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
    summaryStatus: 'ready',
    summaryJobId: 'job-1',
    lastCompactedAt: '2026-06-09T12:00:00.000Z'
  });

  assert.equal(executes.length, 1);
  assert.ok(executes[0].sql.includes('INSERT INTO chat_transcript_snapshots'));
  assert.equal(executes[0].params[0], 'group:42');
  assert.equal(executes[0].params[1], 'group');
  assert.equal(executes[0].params[3], 42);
  assert.equal(executes[0].params[6], 'ready');
  assert.equal(executes[0].params[7], 'job-1');
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
          read_cutoff_after_stack_index: 100,
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
          read_cutoff_after_stack_index: 171,
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
    readCutoffAfterStackIndex: 171,
    lastContextWindowTokens: 400000,
    lastTargetBudgetTokens: 280000,
    lastHardBudgetTokens: 380000
  });

  assert.equal(result.committed, true);
  assert.equal(result.state.readCutoffAfterStackIndex, 171);
  assert.equal(result.state.contextSummary, 'new summary');
  assert.equal(queries[0].sql.includes('pg_advisory_xact_lock'), true);
  assert.equal(queries[1].sql.includes('FOR UPDATE'), true);
  assert.equal(queries[2].sql.includes('INSERT INTO agent_session_context_windows'), true);
  assert.equal(queries[2].params[0], 'xiaoni:test-global');
  assert.equal(queries[2].params[1], 'new summary');
  // params[2] = diary_index_snapshot、params[3] = people_index_snapshot(均未传 → null),
  // readCutoff 顺移到 params[4]
  assert.equal(queries[2].params[2], null);
  assert.equal(queries[2].params[3], null);
  assert.equal(queries[2].params[4], 171);
});

test('commitSessionContextSummaryAndReadCutoff persists diaryIndexSnapshot atomically with summary+cutoff', async () => {
  const queries = [];
  const INDEX_SNAPSHOT = '- 2026-07-23 | 修好了发图\n- 2026-07-24 | 做了不响';
  const tx = {
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.includes('pg_advisory_xact_lock')) {
        return [];
      }
      if (sql.includes('FOR UPDATE')) {
        return [];
      }
      if (sql.includes('INSERT INTO agent_session_context_windows')) {
        return [{
          session_key: 'xiaoni:test-global',
          read_cutoff_after_stack_index: 171,
          last_context_window_tokens: 400000,
          last_target_budget_tokens: 280000,
          last_hard_budget_tokens: 380000,
          context_summary: 'new summary',
          diary_index_snapshot: INDEX_SNAPSHOT,
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
    diaryIndexSnapshot: INDEX_SNAPSHOT,
    readCutoffAfterStackIndex: 171,
    lastContextWindowTokens: 400000,
    lastTargetBudgetTokens: 280000,
    lastHardBudgetTokens: 380000
  });

  assert.equal(result.committed, true);
  // 快照与 summary/cutoff 同一条 INSERT(同一事务帧),不允许分离提交
  const insert = queries.find((entry) => entry.sql.includes('INSERT INTO agent_session_context_windows'));
  assert.ok(insert.sql.includes('diary_index_snapshot'));
  assert.equal(insert.params[2], INDEX_SNAPSHOT);
  assert.equal(result.state.diaryIndexSnapshot, INDEX_SNAPSHOT);
});

test('commitSessionContextSummaryAndReadCutoff persists peopleIndexSnapshot atomically alongside diary snapshot', async () => {
  const queries = [];
  const DIARY_SNAPSHOT = '- 2026-07-24 | 做了不响';
  const PEOPLE_SNAPSHOT = '- 阿花(85178516) | owner,agent方向,拿我当作品集';
  const tx = {
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (sql.includes('FOR UPDATE')) return [];
      if (sql.includes('INSERT INTO agent_session_context_windows')) {
        return [{
          session_key: 'xiaoni:test-global',
          read_cutoff_after_stack_index: 171,
          last_context_window_tokens: 400000,
          last_target_budget_tokens: 280000,
          last_hard_budget_tokens: 380000,
          context_summary: 'new summary',
          diary_index_snapshot: DIARY_SNAPSHOT,
          people_index_snapshot: PEOPLE_SNAPSHOT,
          pending_proactive_share: null,
          pending_proactive_share_age: 0,
          updated_at: '2026-07-25T00:01:00.000Z'
        }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const persistence = createAgentRuntimePersistence({
    sqlAdapter: {
      withTransaction: async (callback) => callback(tx),
      query: async () => { throw new Error('should use transaction'); },
      execute: async () => { throw new Error('should not use execute'); },
      close: async () => undefined
    }
  });
  const result = await persistence.commitSessionContextSummaryAndReadCutoff({
    sessionKey: 'xiaoni:test-global',
    contextSummary: 'new summary',
    diaryIndexSnapshot: DIARY_SNAPSHOT,
    peopleIndexSnapshot: PEOPLE_SNAPSHOT,
    readCutoffAfterStackIndex: 171,
    lastContextWindowTokens: 400000,
    lastTargetBudgetTokens: 280000,
    lastHardBudgetTokens: 380000
  });
  assert.equal(result.committed, true);
  // 两份快照与 summary/cutoff 同一条 INSERT(同一事务帧)
  const insert = queries.find((entry) => entry.sql.includes('INSERT INTO agent_session_context_windows'));
  assert.ok(insert.sql.includes('people_index_snapshot'));
  assert.equal(insert.params[2], DIARY_SNAPSHOT);
  assert.equal(insert.params[3], PEOPLE_SNAPSHOT);
  assert.equal(result.state.peopleIndexSnapshot, PEOPLE_SNAPSHOT);
});

test('getSessionReadCutoffState selects people_index_snapshot and maps it', async () => {
  const PEOPLE_SNAPSHOT = '- 楠楠 | 在考研,答应盯她进度';
  const queries = [];
  const persistence = createAgentRuntimePersistence({
    sqlAdapter: {
      query: async (sql, params = []) => {
        queries.push({ sql, params });
        return [{
          session_key: 'xiaoni:test-global',
          read_cutoff_after_stack_index: 171,
          last_context_window_tokens: 400000,
          last_target_budget_tokens: 280000,
          last_hard_budget_tokens: 380000,
          context_summary: 'summary',
          diary_index_snapshot: null,
          people_index_snapshot: PEOPLE_SNAPSHOT,
          pending_proactive_share: null,
          pending_proactive_share_age: 0,
          consecutive_over_compression_turns: 0,
          updated_at: '2026-07-25T00:00:00.000Z'
        }];
      },
      execute: async () => {},
      close: async () => undefined
    }
  });
  const state = await persistence.getSessionReadCutoffState({ sessionKey: 'xiaoni:test-global' });
  assert.ok(queries[0].sql.includes('people_index_snapshot'), 'SELECT must carry people_index_snapshot');
  assert.equal(state.peopleIndexSnapshot, PEOPLE_SNAPSHOT);
});

test('getSessionReadCutoffState selects diary_index_snapshot and maps it (live 与 replay 同源渲染)', async () => {
  const INDEX_SNAPSHOT = '- 2026-07-24 | 做了不响';
  const queries = [];
  const persistence = createAgentRuntimePersistence({
    sqlAdapter: {
      query: async (sql, params = []) => {
        queries.push({ sql, params });
        return [{
          session_key: 'xiaoni:test-global',
          read_cutoff_after_stack_index: 171,
          last_context_window_tokens: 400000,
          last_target_budget_tokens: 280000,
          last_hard_budget_tokens: 380000,
          context_summary: 'summary',
          diary_index_snapshot: INDEX_SNAPSHOT,
          pending_proactive_share: null,
          pending_proactive_share_age: 0,
          consecutive_over_compression_turns: 0,
          updated_at: '2026-07-24T00:00:00.000Z'
        }];
      },
      execute: async () => {},
      close: async () => undefined
    }
  });
  const state = await persistence.getSessionReadCutoffState({ sessionKey: 'xiaoni:test-global' });
  // SELECT 不带该列的话,读回路径静默丢 <xiaoni_diary_index> —— 断言列在 SQL 里且映射通
  assert.ok(queries[0].sql.includes('diary_index_snapshot'), 'SELECT must carry diary_index_snapshot');
  assert.equal(state.diaryIndexSnapshot, INDEX_SNAPSHOT);
});

test('commit no-op (superseded cutoff) drops the incoming snapshot and keeps the stored one', async () => {
  const tx = {
    query: async (sql) => {
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (sql.includes('FOR UPDATE')) {
        return [{
          session_key: 'xiaoni:test-global',
          read_cutoff_after_stack_index: 200,
          last_context_window_tokens: 400000,
          last_target_budget_tokens: 280000,
          last_hard_budget_tokens: 380000,
          context_summary: 'newer summary',
          diary_index_snapshot: '库里已有的旧快照',
          pending_proactive_share: null,
          pending_proactive_share_age: 0,
          updated_at: '2026-07-24T00:00:00.000Z'
        }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const persistence = createAgentRuntimePersistence({
    sqlAdapter: {
      withTransaction: async (callback) => callback(tx),
      query: async () => { throw new Error('should use transaction'); },
      execute: async () => { throw new Error('should not use execute'); },
      close: async () => undefined
    }
  });
  const result = await persistence.commitSessionContextSummaryAndReadCutoff({
    sessionKey: 'xiaoni:test-global',
    contextSummary: 'late summary',
    diaryIndexSnapshot: '迟到的新快照',
    readCutoffAfterStackIndex: 171,
    lastContextWindowTokens: 400000,
    lastTargetBudgetTokens: 280000,
    lastHardBudgetTokens: 380000
  });
  // 被 supersede 的提交整体丢弃(含快照),库里旧快照原样保留 —— 钉死语义
  assert.equal(result.committed, false);
  assert.equal(result.state.diaryIndexSnapshot, '库里已有的旧快照');
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
          read_cutoff_after_stack_index: 200,
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
    readCutoffAfterStackIndex: 171,
    lastContextWindowTokens: 400000,
    lastTargetBudgetTokens: 280000,
    lastHardBudgetTokens: 380000
  });

  assert.equal(result.committed, false);
  assert.equal(result.state.readCutoffAfterStackIndex, 200);
  assert.equal(result.state.contextSummary, 'newer summary');
  assert.equal(queries.length, 2);
  assert.equal(queries.some((entry) => entry.sql.includes('INSERT INTO agent_session_context_windows')), false);
});

// In-memory stateful adapter modelling the single agent_session_context_windows row by
// session_key, just enough to round-trip setSessionCompressionTriggerCounter ->
// getSessionReadCutoffState. Only interprets the two statements those two functions emit.
function createInMemorySessionContextAdapter() {
  const rows = new Map();
  function ensure(sessionKey) {
    let row = rows.get(sessionKey);
    if (!row) {
      row = {
        session_key: sessionKey,
        read_cutoff_after_stack_index: null,
        last_context_window_tokens: null,
        last_target_budget_tokens: null,
        last_hard_budget_tokens: null,
        context_summary: null,
        pending_proactive_share: null,
        pending_proactive_share_age: 0,
        consecutive_over_compression_turns: 0,
        updated_at: new Date()
      };
      rows.set(sessionKey, row);
    }
    return row;
  }
  return {
    execute: async (sql, params = []) => {
      if (sql.includes('INSERT INTO agent_session_context_windows') && sql.includes('consecutive_over_compression_turns')) {
        const [sessionKey, count] = params;
        const row = ensure(sessionKey);
        row.consecutive_over_compression_turns = count;
        row.updated_at = new Date();
        return 1;
      }
      throw new Error(`unexpected execute: ${sql}`);
    },
    query: async (sql, params = []) => {
      if (sql.includes('FROM agent_session_context_windows') && sql.includes('WHERE session_key = ?')) {
        const row = rows.get(params[0]);
        return row ? [row] : [];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
    withTransaction: async () => {
      throw new Error('setSessionCompressionTriggerCounter should not open a transaction');
    },
    close: async () => undefined
  };
}

test('setSessionCompressionTriggerCounter round-trips through getSessionReadCutoffState', async () => {
  const persistence = createAgentRuntimePersistence({ sqlAdapter: createInMemorySessionContextAdapter() });

  await persistence.setSessionCompressionTriggerCounter({
    sessionKey: 'xiaoni:test-global',
    consecutiveOverCompressionTurns: 2
  });

  const state = await persistence.getSessionReadCutoffState({ sessionKey: 'xiaoni:test-global' });
  assert.equal(state.consecutiveOverCompressionTurns, 2);

  // overwrite back down to 0 (the reset path) survives the round-trip too
  await persistence.setSessionCompressionTriggerCounter({
    sessionKey: 'xiaoni:test-global',
    consecutiveOverCompressionTurns: 0
  });
  const reset = await persistence.getSessionReadCutoffState({ sessionKey: 'xiaoni:test-global' });
  assert.equal(reset.consecutiveOverCompressionTurns, 0);
});

test('getSessionReadCutoffState maps a missing/null compression counter to 0', async () => {
  const persistence = createAgentRuntimePersistence({
    sqlAdapter: {
      query: async () => [
        {
          session_key: 'xiaoni:test-global',
          read_cutoff_after_stack_index: 12,
          last_context_window_tokens: null,
          last_target_budget_tokens: null,
          last_hard_budget_tokens: null,
          context_summary: null,
          pending_proactive_share: null,
          pending_proactive_share_age: 0,
          // column absent on a row created before the migration
          updated_at: new Date()
        }
      ],
      execute: async () => 1,
      withTransaction: async () => {
        throw new Error('no transaction expected');
      },
      close: async () => undefined
    }
  });

  const state = await persistence.getSessionReadCutoffState({ sessionKey: 'xiaoni:test-global' });
  assert.equal(state.consecutiveOverCompressionTurns, 0);
});

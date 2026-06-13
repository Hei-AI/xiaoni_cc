'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentRecoverySessionPersistence } = require('../agent-recovery-sessions');

function createSessionRow(overrides = {}) {
  return {
    id: overrides.id ?? 88n,
    identity_key: overrides.identity_key ?? 'xiaoni',
    initiator: overrides.initiator ?? 'recover_energy_tool',
    status: overrides.status ?? 'active',
    wake_cause: overrides.wake_cause ?? null,
    reason: overrides.reason ?? '先休息一下',
    xiaoni_os: overrides.xiaoni_os ?? '睡醒再看。',
    clock_minutes: overrides.clock_minutes ?? 30,
    clock_due_at: overrides.clock_due_at ?? '2026-06-13T01:30:00.000Z',
    clock_fired_at: overrides.clock_fired_at ?? null,
    clock_deferred_at: overrides.clock_deferred_at ?? null,
    started_at: overrides.started_at ?? '2026-06-13T01:00:00.000Z',
    ended_at: overrides.ended_at ?? null,
    last_checked_at: overrides.last_checked_at ?? null,
    tool_execution_id: overrides.tool_execution_id ?? 'tool:run:call-recover',
    llm_request_slice_id: overrides.llm_request_slice_id ?? 'slice-1',
    llm_call_id: overrides.llm_call_id ?? 'llm-1',
    tool_call_id: overrides.tool_call_id ?? 'call-recover',
    trace_id: overrides.trace_id ?? 'trace-1',
    run_id: overrides.run_id ?? 'run-1',
    conversation_id: overrides.conversation_id ?? null,
    queue_message_id: overrides.queue_message_id ?? 'run-1',
    wake_count_start_queue_message_id: overrides.wake_count_start_queue_message_id ?? 42n,
    last_wake_counted_queue_message_id: overrides.last_wake_counted_queue_message_id ?? 42n,
    wake_call_count: overrides.wake_call_count ?? 0,
    wake_required_count: overrides.wake_required_count ?? null,
    start_pressure: overrides.start_pressure ?? 0.5,
    current_pressure: overrides.current_pressure ?? 0.5,
    start_energy: overrides.start_energy ?? 0.5,
    current_energy: overrides.current_energy ?? 0.5,
    max_energy: overrides.max_energy ?? 1,
    planned_natural_wake_at: overrides.planned_natural_wake_at ?? '2026-06-13T02:00:00.000Z',
    hard_wake_at: overrides.hard_wake_at ?? '2026-06-13T04:00:00.000Z',
    result: overrides.result ?? '{}',
    metadata: overrides.metadata ?? '{}',
    created_at: overrides.created_at ?? '2026-06-13T01:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-06-13T01:00:00.000Z'
  };
}

test('ensureAgentRecoverySessionSchema creates durable session table and wake indexes', async () => {
  const statements = [];
  const persistence = createAgentRecoverySessionPersistence({
    sqlAdapter: {
      query: async (statement) => {
        statements.push(statement);
        return [];
      },
      execute: async (statement) => {
        statements.push(statement);
        return 0;
      }
    }
  });

  await persistence.ensureAgentRecoverySessionSchema();

  const createTable = statements.find((statement) => statement.includes('CREATE TABLE IF NOT EXISTS agent_recovery_sessions')) || '';
  assert.match(createTable, /tool_call_id VARCHAR\(191\)/);
  assert.match(createTable, /wake_count_start_queue_message_id BIGINT/);
  assert.match(createTable, /hard_wake_at TIMESTAMP\(3\)/);
  assert.ok(statements.some((statement) => statement.includes('uniq_agent_recovery_sessions_active_identity')));
  assert.ok(statements.some((statement) => statement.includes('idx_agent_queue_phone_notification_source_id')));
});

test('agent recovery sessions persist wake-count high watermark and settle active row', async () => {
  const queries = [];
  let activeRow = null;
  const adapter = {
    query: async (statement, params = []) => {
      queries.push({ statement, params });
      if (statement.includes('pg_advisory_lock') || statement.includes('pg_advisory_unlock')) {
        return [];
      }
      if (statement.includes('SELECT COALESCE(MAX(id), 0) AS id FROM agent_queue_messages')) {
        return [{ id: 42n }];
      }
      if (statement.includes('INSERT INTO agent_recovery_sessions')) {
        activeRow = createSessionRow({
          identity_key: params[0],
          initiator: params[1],
          reason: params[2],
          xiaoni_os: params[3],
          clock_minutes: params[4],
          clock_due_at: params[5],
          started_at: params[6],
          tool_execution_id: params[7],
          llm_request_slice_id: params[8],
          llm_call_id: params[9],
          tool_call_id: params[10],
          trace_id: params[11],
          run_id: params[12],
          conversation_id: params[13],
          queue_message_id: params[14],
          wake_count_start_queue_message_id: params[15],
          last_wake_counted_queue_message_id: params[16],
          wake_call_count: params[17],
          wake_required_count: params[18],
          start_pressure: params[19],
          current_pressure: params[20],
          start_energy: params[21],
          current_energy: params[22],
          max_energy: params[23],
          planned_natural_wake_at: params[24],
          hard_wake_at: params[25],
          metadata: params[26]
        });
        return [activeRow];
      }
      if (statement.includes('FROM agent_recovery_sessions') && statement.includes("status = 'active'")) {
        return activeRow ? [activeRow] : [];
      }
      if (statement.includes('FROM agent_recovery_sessions') && statement.includes('ORDER BY started_at DESC')) {
        assert.deepEqual(params, ['xiaoni', 'active', 20]);
        return activeRow ? [activeRow] : [];
      }
      if (statement.includes('FROM agent_queue_messages') && statement.includes("source = 'phone_notification'")) {
        assert.deepEqual(params, [42n, 100]);
        return [{
          id: 43n,
          chat_type: 'direct',
          session_key: 'private:1',
          peer_id: '1',
          payload: JSON.stringify({ phoneNotification: { chatType: 'direct' } }),
          raw_payload: '{}',
          created_at: '2026-06-13T01:01:00.000Z'
        }, {
          id: 44n,
          chat_type: 'group',
          session_key: 'qq:group:100',
          peer_id: '100',
          payload: JSON.stringify({ phoneNotification: { directMentions: 2 } }),
          raw_payload: '{}',
          created_at: '2026-06-13T01:02:00.000Z'
        }, {
          id: 45n,
          chat_type: 'group',
          session_key: 'qq:group:100',
          peer_id: '100',
          payload: JSON.stringify({ phoneNotification: { directMentions: 0 } }),
          raw_payload: '{}',
          created_at: '2026-06-13T01:03:00.000Z'
        }];
      }
      if (statement.includes('SET wake_call_count = ?')) {
        activeRow = createSessionRow({
          ...activeRow,
          wake_call_count: params[0],
          wake_required_count: params[1],
          last_wake_counted_queue_message_id: params[2],
          current_pressure: params[3],
          current_energy: params[4],
          clock_deferred_at: params[5]
        });
        return [activeRow];
      }
      if (statement.includes('SET status = ?')) {
        activeRow = createSessionRow({
          ...activeRow,
          status: params[0],
          wake_cause: params[1],
          ended_at: params[2],
          clock_fired_at: params[3],
          wake_call_count: params[4],
          wake_required_count: params[5],
          last_wake_counted_queue_message_id: params[6],
          current_pressure: params[7],
          current_energy: params[8],
          result: params[9]
        });
        const finalized = activeRow;
        activeRow = null;
        return [finalized];
      }
      throw new Error(`Unexpected query: ${statement}`);
    },
    execute: async () => 0,
    withTransaction: async (callback) => callback(adapter)
  };
  const persistence = createAgentRecoverySessionPersistence({ sqlAdapter: adapter });

  const created = await persistence.createAgentRecoverySession({
    reason: '  先休息一下  ',
    xiaoniOs: '睡醒再看。',
    clockMinutes: 30,
    toolExecutionId: 'tool:run:call-recover',
    llmRequestSliceId: 'slice-1',
    llmCallId: 'llm-1',
    toolCallId: 'call-recover',
    traceId: 'trace-1',
    runId: 'run-1',
    queueMessageId: 'run-1',
    startEnergy: 0.5,
    currentEnergy: 0.5,
    maxEnergy: 1,
    metadata: { raw_arguments: '{"reason":"先休息一下"}' }
  });
  assert.equal(created.reason, '先休息一下');
  assert.equal(created.wakeCountStartQueueMessageId, 42);
  assert.equal(created.lastWakeCountedQueueMessageId, 42);
  assert.equal(created.metadata.raw_arguments, '{"reason":"先休息一下"}');

  const active = await persistence.getActiveAgentRecoverySession();
  assert.equal(active.id, 88);

  const sessions = await persistence.listAgentRecoverySessions({
    identityKey: 'xiaoni',
    status: 'active',
    limit: 20
  });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, 88);

  const wakeRows = await persistence.listAgentRecoveryWakeNotifications({
    afterQueueMessageId: 42,
    limit: 100
  });
  assert.deepEqual(wakeRows.map((row) => row.wakeCount), [1, 2, 0]);

  const updated = await persistence.updateAgentRecoverySessionProgress({
    id: created.id,
    wakeCallCount: 3,
    wakeRequiredCount: 6,
    lastWakeCountedQueueMessageId: 45,
    currentPressure: 0.4,
    currentEnergy: 0.6,
    clockDeferredAt: '2026-06-13T01:30:00.000Z'
  });
  assert.equal(updated.wakeCallCount, 3);
  assert.equal(updated.lastWakeCountedQueueMessageId, 45);
  assert.equal(updated.clockDeferredAt, '2026-06-13 09:30:00.000');

  const finalized = await persistence.finalizeAgentRecoverySession({
    id: created.id,
    wakeCause: 'private_or_mention_threshold',
    endedAt: '2026-06-13T01:45:00.000Z',
    wakeCallCount: 3,
    wakeRequiredCount: 6,
    lastWakeCountedQueueMessageId: 45,
    currentPressure: 0.2,
    currentEnergy: 0.8,
    result: { recovered: true }
  });
  assert.equal(finalized.status, 'completed');
  assert.equal(finalized.wakeCause, 'private_or_mention_threshold');
  assert.deepEqual(finalized.result, { recovered: true });
  assert.equal(await persistence.getActiveAgentRecoverySession(), null);

  assert.ok(queries.some((entry) => entry.statement.includes('INSERT INTO agent_recovery_sessions')));
});

test('agent recovery sessions serialize Date timestamp parameters as storage wall clock', async () => {
  const queryCalls = [];
  const adapter = {
    query: async (statement, params = []) => {
      queryCalls.push({ statement, params });
      if (statement.includes('pg_advisory_lock') || statement.includes('pg_advisory_unlock')) {
        return [];
      }
      if (statement.includes('SELECT COALESCE(MAX(id), 0) AS id FROM agent_queue_messages')) {
        return [{ id: 0n }];
      }
      if (statement.includes('INSERT INTO agent_recovery_sessions')) {
        return [createSessionRow({
          started_at: params[6],
          clock_due_at: params[5],
          planned_natural_wake_at: params[24],
          hard_wake_at: params[25]
        })];
      }
      if (statement.includes('SET status = ?')) {
        return [createSessionRow({
          status: params[0],
          wake_cause: params[1],
          ended_at: params[2],
          clock_fired_at: params[3]
        })];
      }
      throw new Error(`Unexpected query: ${statement}`);
    },
    execute: async () => 0,
    withTransaction: async (callback) => callback(adapter)
  };
  const persistence = createAgentRecoverySessionPersistence({ sqlAdapter: adapter });
  const startedAt = new Date('2026-06-13T05:52:16.209Z');
  const endedAt = new Date('2026-06-13T08:52:16.209Z');

  await persistence.createAgentRecoverySession({
    startedAt,
    clockDueAt: new Date('2026-06-13T06:52:16.209Z'),
    plannedNaturalWakeAt: new Date('2026-06-13T07:52:16.209Z'),
    hardWakeAt: endedAt
  });
  await persistence.finalizeAgentRecoverySession({
    id: 88,
    wakeCause: 'hard_cap',
    endedAt,
    clockFiredAt: endedAt,
    result: { sleep_minutes: 180 }
  });

  const insertCall = queryCalls.find((entry) => entry.statement.includes('INSERT INTO agent_recovery_sessions'));
  const finalizeCall = queryCalls.find((entry) => entry.statement.includes('SET status = ?'));
  assert.equal(insertCall.params[6], '2026-06-13 13:52:16.209');
  assert.equal(insertCall.params[5], '2026-06-13 14:52:16.209');
  assert.equal(insertCall.params[24], '2026-06-13 15:52:16.209');
  assert.equal(insertCall.params[25], '2026-06-13 16:52:16.209');
  assert.equal(finalizeCall.params[2], '2026-06-13 16:52:16.209');
  assert.equal(finalizeCall.params[3], '2026-06-13 16:52:16.209');
});

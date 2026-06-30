'use strict';

// Root-cause regression suite for the run-boundary prompt-cache breakdown.
//
// The breakdown was NOT in the agent loop's request building — it was in this
// persistence boundary: appendAgentStackItems writes each item with
// `INSERT ... ON CONFLICT (event_id) DO UPDATE SET updated_at = updated_at`,
// which does NOT rewrite content. So two items that collide on event_id collapse
// to ONE row carrying the FIRST item's content; the second's content is silently
// dropped. buildRuntimeInputStackItem used to key the event_id on runId, and
// folded notifies ride the parent run (claimed.id === parentRunId), so every
// runtime_input of a run collided onto one id and all but the first fold vanished
// from the replayable ledger. The next run's stack-replay then rebuilt a SHORTER
// body than the run that folded them and the prompt cache broke at the boundary.
//
// These tests use an in-memory adapter that honors ON CONFLICT (event_id) exactly
// like Postgres, so they reproduce the content-drop deterministically with the
// REAL persistence code and no database. No LLM is involved.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createXiaoniAgentStackPersistence } = require('../xiaoni-agent-stack');

// Faithful in-memory stand-in for the agent_stack_items table that implements
// the unique(event_id) constraint + ON CONFLICT (event_id) DO UPDATE (content
// NOT rewritten) and the identity-local monotonic stack_index assignment.
function createDedupeAwareSql() {
  const store = []; // persisted agent_stack_items rows, in insertion order
  let nextId = 1;

  const executor = {
    store,
    execute: async () => 1, // DDL (CREATE TABLE IF NOT EXISTS ...) is a no-op here
    query: async (sql, params = []) => {
      if (sql.includes('pg_advisory_xact_lock')) {
        return [];
      }
      if (sql.includes('MAX(stack_index)')) {
        const identityKey = params[0];
        const max = store
          .filter((row) => row.identity_key === identityKey)
          .reduce((acc, row) => Math.max(acc, row.stack_index), 0);
        return [{ stack_index: max }];
      }
      if (sql.includes('INSERT INTO agent_stack_items')) {
        const eventId = params[0];
        const existing = store.find((row) => row.event_id === eventId);
        if (existing) {
          // ON CONFLICT (event_id) DO UPDATE SET updated_at = updated_at:
          // content is NOT rewritten. Return the EXISTING row unchanged — this is
          // exactly how the second colliding fold lost its content in production.
          existing.updated_at = '2026-06-29T00:00:01.000Z';
          return [existing];
        }
        const row = {
          id: nextId++,
          event_id: eventId,
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
          created_at: '2026-06-29T00:00:00.000Z',
          updated_at: '2026-06-29T00:00:00.000Z'
        };
        store.push(row);
        return [row];
      }
      return [];
    },
    withTransaction: async (callback) => callback(executor),
    close: async () => {}
  };
  return executor;
}

function runtimeInputItem(eventId, reminderText) {
  return {
    eventId,
    itemKind: 'runtime_input',
    role: 'developer',
    content: {
      source: 'phone_notification',
      input_items: [{
        role: 'developer',
        type: 'message',
        content: [{ type: 'input_text', text: reminderText }]
      }]
    }
  };
}

function reminderTextOf(row) {
  return row?.content?.input_items?.[0]?.content?.[0]?.text || null;
}

test('appendAgentStackItems: ON CONFLICT(event_id) drops the second item content (the breakdown mechanism)', async () => {
  const sql = createDedupeAwareSql();
  const persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });

  // The OLD buildRuntimeInputStackItem keyed the event_id on runId, so the initial
  // trigger AND every folded notify of run-1 produced this SAME id.
  const collidingEventId = 'stack:run-1:runtime-input';

  await persistence.appendAgentStackItems({
    identityKey: 'xiaoni',
    traceId: 'runtrace-parent',
    runId: 'run-1',
    sourceType: 'agent_queue_messages',
    sourceId: 'run-1',
    items: [runtimeInputItem(collidingEventId, '初始触发：来自手机的提醒')]
  });
  // A folded notify, persisted by a separate append call under the parent run id.
  const second = await persistence.appendAgentStackItems({
    identityKey: 'xiaoni',
    traceId: 'runtrace-fold-A',
    runId: 'run-1',
    sourceType: 'agent_queue_messages',
    sourceId: 'run-1',
    items: [runtimeInputItem(collidingEventId, '视线边缘：又堆积了 1 条新动静')]
  });

  // The store kept ONE row, carrying the FIRST content. The folded reminder is gone.
  const stackRows = sql.store.filter((row) => row.item_kind === 'runtime_input');
  assert.equal(stackRows.length, 1, 'collision must collapse to a single row');
  assert.equal(reminderTextOf(stackRows[0]), '初始触发：来自手机的提醒');
  // The second append returned the pre-existing row, not its own content.
  assert.equal(reminderTextOf(second[0]), '初始触发：来自手机的提醒');
  assert.notEqual(reminderTextOf(second[0]), '视线边缘：又堆积了 1 条新动静');
});

test('appendAgentStackItems: distinct event_ids preserve every runtime_input (the fix)', async () => {
  const sql = createDedupeAwareSql();
  const persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });

  // The NEW buildRuntimeInputStackItem keys the event_id on each notify's OWN
  // traceId, so the initial trigger and each fold get distinct ids.
  await persistence.appendAgentStackItems({
    identityKey: 'xiaoni',
    traceId: 'runtrace-parent',
    runId: 'run-1',
    sourceType: 'agent_queue_messages',
    sourceId: 'run-1',
    items: [runtimeInputItem('stack:runtrace-parent:runtime-input', '初始触发：来自手机的提醒')]
  });
  await persistence.appendAgentStackItems({
    identityKey: 'xiaoni',
    traceId: 'runtrace-fold-A',
    runId: 'run-1',
    sourceType: 'agent_queue_messages',
    sourceId: 'run-1',
    items: [runtimeInputItem('stack:runtrace-fold-A:runtime-input', '视线边缘：又堆积了 1 条新动静')]
  });
  await persistence.appendAgentStackItems({
    identityKey: 'xiaoni',
    traceId: 'runtrace-fold-B',
    runId: 'run-1',
    sourceType: 'agent_queue_messages',
    sourceId: 'run-1',
    items: [runtimeInputItem('stack:runtrace-fold-B:runtime-input', '视线边缘：又堆积了 2 条新动静')]
  });

  const reminders = sql.store
    .filter((row) => row.item_kind === 'runtime_input')
    .map(reminderTextOf);
  assert.equal(reminders.length, 3, 'every distinct-keyed runtime_input must persist');
  assert.deepEqual(reminders, [
    '初始触发：来自手机的提醒',
    '视线边缘：又堆积了 1 条新动静',
    '视线边缘：又堆积了 2 条新动静'
  ]);
  // Monotonic, identity-local stack indexes — replay order is preserved.
  const indexes = sql.store.filter((row) => row.item_kind === 'runtime_input').map((row) => row.stack_index);
  assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b));
});

test('appendAgentStackItems: same-notify reprocessing stays idempotent on its own traceId', async () => {
  const sql = createDedupeAwareSql();
  const persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });

  // A retried run re-folds the SAME pending notify (same trace_id) -> same event_id
  // -> dedupe, no duplicate row. Content is identical, so no information is lost.
  const item = () => runtimeInputItem('stack:runtrace-fold-A:runtime-input', '视线边缘：又堆积了 1 条新动静');
  await persistence.appendAgentStackItems({
    identityKey: 'xiaoni', traceId: 'runtrace-fold-A', runId: 'run-1',
    sourceType: 'agent_queue_messages', sourceId: 'run-1', items: [item()]
  });
  await persistence.appendAgentStackItems({
    identityKey: 'xiaoni', traceId: 'runtrace-fold-A', runId: 'run-2-retry',
    sourceType: 'agent_queue_messages', sourceId: 'run-2-retry', items: [item()]
  });

  const reminders = sql.store.filter((row) => row.item_kind === 'runtime_input');
  assert.equal(reminders.length, 1, 'same-notify reprocessing must not duplicate');
  assert.equal(reminderTextOf(reminders[0]), '视线边缘：又堆积了 1 条新动静');
});

// =====================================================================================
// Defense-in-depth (docs/CACHE_CONTRACT.md §3): the breakdown's root is a non-unique
// event_id. buildRuntimeInputStackItem keys on `stack:<traceId>:runId-fallback`, so an
// EMPTY trace_id collapses every such row onto the runId and re-creates the collision on
// the empty-traceId path. enqueueAgentQueueMessage is the boundary that decides the
// persisted trace_id; it must never store an empty one. Production callers always supply a
// real trace_id (provider-service createTraceId); this guards simulator/internal/replay
// callers that don't. Found by gstack adversarial review (F3).
// =====================================================================================
const { createAgentQueuePersistence } = require('../agent-queue');

test('enqueueAgentQueueMessage resolves an empty trace_id to a unique generated id', async () => {
  const created = [];
  const fakePrisma = {
    agentQueueMessage: {
      create: async ({ data }) => {
        const row = { id: created.length + 1, status: 'pending', attempts: 0, ...data };
        created.push(row);
        return row;
      }
    }
  };
  const queue = createAgentQueuePersistence({ getPrismaClient: () => fakePrisma, createSqlAdapter: () => ({}) });

  // Two distinct messages, NEITHER carrying a traceId (the anomalous simulator/internal path).
  await queue.enqueueAgentQueueMessage({ message: { source: 'simulator', messageSid: 'm1', sessionKey: 's', peerId: 'p' } });
  await queue.enqueueAgentQueueMessage({ message: { source: 'simulator', messageSid: 'm2', sessionKey: 's', peerId: 'p' } });

  assert.ok(created[0].trace_id && created[0].trace_id.length > 0, 'empty traceId must resolve to a non-empty trace_id');
  assert.match(created[0].trace_id, /^runtrace_/, 'the generated fallback uses the runtrace_ prefix');
  assert.notEqual(
    created[0].trace_id,
    created[1].trace_id,
    'two empty-traceId enqueues must get DISTINCT trace_ids so their downstream event_ids cannot collide'
  );

  // A real trace_id is preserved verbatim (no spurious regeneration).
  await queue.enqueueAgentQueueMessage({ message: { source: 'napcat', messageSid: 'm3', traceId: 'napcat_trace_xyz', sessionKey: 's', peerId: 'p' } });
  assert.equal(created[2].trace_id, 'napcat_trace_xyz', 'a supplied trace_id must be preserved');
});

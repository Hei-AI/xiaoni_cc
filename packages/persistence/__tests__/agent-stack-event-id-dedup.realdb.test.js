'use strict';

// REAL-Postgres regression for the run-boundary prompt-cache breakdown mechanism.
//
// Production runs on Postgres, so the breakdown's root cause — the interaction
// between buildRuntimeInputStackItem's event_id and the agent_stack_items
// UNIQUE(event_id) constraint + INSERT ... ON CONFLICT (event_id) DO UPDATE — must
// be verified against a real database, not an in-memory stand-in. This suite runs
// the ACTUAL persistence SQL against an isolated throwaway database
// (qqbot_cache_test) inside the dev Postgres server. It never touches qqbot_db.
//
// It validates, on real PG:
//   1. the UNIQUE(event_id) constraint exists and ON CONFLICT(event_id) DO UPDATE
//      drops the second item's content (the breakdown mechanism),
//   2. distinct event_ids persist every runtime_input (the fix),
//   3. the stack-native replay read reproduces every backfilled fold.
//
// Case 3 used to be two cases keyed on agent_stack_items.conversation_id. That column
// was dropped project-wide when the conversation concept was removed, so both cases had
// been failing on real PG with `column "conversation_id" does not exist` — which quietly
// disarmed this whole frozen suite (every run needed a human to re-decide "is this the
// known-stale one, or did we actually break it?").
//   - The COALESCE-first-write-wins case tested attachConversationIdToAgentStackByTrace,
//     a function with ZERO callers guarding a concept that no longer exists → removed.
//     (The dead function itself still ships; removing it is a separate cleanup.)
//   - The replay case guards a LIVE, load-bearing invariant (a fold that fails to replay
//     is exactly the run-boundary cache breakdown), so it is kept with its assertions
//     verbatim and only re-pointed at the stack-native read the replay actually uses
//     today: listAgentStackItems + afterStackIndex (see loadStackHistoryBlocks).
//
// If the test DB is unreachable (CI without Postgres), every case skips cleanly.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createXiaoniAgentStackPersistence, createSqlAdapter } = require('../index');

// Explicit databaseUrl so a stray DATABASE_URL env can NEVER redirect these writes
// at the production qqbot_db. Isolated, throwaway, dropped by the test runner.
const PG_HOST = process.env.DB_HOST || 'localhost';
const PG_PORT = process.env.DB_PORT || '5432';
const PG_USER = process.env.DB_USER || 'qqbot_user';
const PG_PW = process.env.DB_PASSWORD || 'qqbot_password';
const TEST_DB_NAME = 'qqbot_cache_test';
const TEST_DB_URL = process.env.CACHE_TEST_DATABASE_URL
  || `postgresql://${PG_USER}:${PG_PW}@${PG_HOST}:${PG_PORT}/${TEST_DB_NAME}`;
const ADMIN_DB_URL = `postgresql://${PG_USER}:${PG_PW}@${PG_HOST}:${PG_PORT}/postgres`;

let sql = null;
let persistence = null;
let dbReady = false;

// Create the isolated throwaway database if it doesn't exist. Connects to the
// `postgres` maintenance DB only to issue CREATE DATABASE — it never writes to
// the production qqbot_db.
async function ensureIsolatedTestDatabase() {
  const admin = createSqlAdapter({ databaseUrl: ADMIN_DB_URL });
  try {
    if (!(await admin.testConnection())) {
      throw new Error('cannot reach the postgres maintenance DB');
    }
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = ?', [TEST_DB_NAME]);
    if (existing.length === 0) {
      await admin.execute(`CREATE DATABASE ${TEST_DB_NAME}`, []);
    }
  } finally {
    await admin.close().catch(() => {});
  }
}

test.before(async () => {
  try {
    await ensureIsolatedTestDatabase();
    sql = createSqlAdapter({ databaseUrl: TEST_DB_URL });
    if (!(await sql.testConnection())) {
      throw new Error('testConnection() returned false');
    }
    persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });
    await persistence.ensureXiaoniAgentStackSchema();
    dbReady = true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.log(`[skip] real cache test DB unavailable: ${error.message}`);
    dbReady = false;
  }
});

test.after(async () => {
  if (sql) {
    await sql.close().catch(() => {});
  }
});

// Run a case only when the real DB is up; reset the table first for isolation.
function dbTest(name, fn) {
  test(name, async (t) => {
    if (!dbReady) {
      t.skip('real cache test DB (qqbot_cache_test) unavailable');
      return;
    }
    await sql.execute('TRUNCATE agent_stack_items RESTART IDENTITY', []);
    await fn();
  });
}

function runtimeInputItem(eventId, traceId, text) {
  return {
    eventId,
    itemKind: 'runtime_input',
    role: 'developer',
    traceId,
    content: { source: 'phone_notification', text }
  };
}

async function countRuntimeInputs() {
  const rows = await sql.query("SELECT COUNT(*)::int AS n FROM agent_stack_items WHERE item_kind = 'runtime_input'", []);
  return Number(rows[0].n);
}

dbTest('real ON CONFLICT(event_id) drops the second item content (the breakdown mechanism)', async () => {
  const evt = 'stack:run-1:runtime-input'; // the OLD runId-keyed event_id, shared by every fold

  await persistence.appendAgentStackItems({
    identityKey: 'xiaoni', traceId: 'rt-parent', runId: 'run-1',
    sourceType: 'agent_queue_messages', sourceId: 'run-1',
    items: [runtimeInputItem(evt, 'rt-parent', '初始触发：来自手机的提醒')]
  });
  const second = await persistence.appendAgentStackItems({
    identityKey: 'xiaoni', traceId: 'rt-fold-A', runId: 'run-1',
    sourceType: 'agent_queue_messages', sourceId: 'run-1',
    items: [runtimeInputItem(evt, 'rt-fold-A', '视线边缘：又堆积了 1 条新动静')]
  });

  // Real Postgres: ON CONFLICT(event_id) DO UPDATE keeps ONE row, the FIRST content.
  assert.equal(await countRuntimeInputs(), 1, 'collision must collapse to a single row on real PG');
  const persisted = await persistence.findAgentStackItemByEventId(evt);
  assert.equal(persisted.content.text, '初始触发：来自手机的提醒');
  // The second append returned the pre-existing row, not its own content.
  assert.equal(second[0].content.text, '初始触发：来自手机的提醒');
});

dbTest('distinct event_ids persist every runtime_input on real PG (the fix)', async () => {
  await persistence.appendAgentStackItems({
    identityKey: 'xiaoni', traceId: 'rt-parent', runId: 'run-1',
    sourceType: 'agent_queue_messages', sourceId: 'run-1',
    items: [runtimeInputItem('stack:rt-parent:runtime-input', 'rt-parent', '初始触发')]
  });
  await persistence.appendAgentStackItems({
    identityKey: 'xiaoni', traceId: 'rt-fold-A', runId: 'run-1',
    sourceType: 'agent_queue_messages', sourceId: 'run-1',
    items: [runtimeInputItem('stack:rt-fold-A:runtime-input', 'rt-fold-A', '视线边缘：1 条')]
  });
  await persistence.appendAgentStackItems({
    identityKey: 'xiaoni', traceId: 'rt-fold-B', runId: 'run-1',
    sourceType: 'agent_queue_messages', sourceId: 'run-1',
    items: [runtimeInputItem('stack:rt-fold-B:runtime-input', 'rt-fold-B', '视线边缘：2 条')]
  });
  assert.equal(await countRuntimeInputs(), 3, 'every distinct-keyed runtime_input must persist on real PG');
});

dbTest('stack-native replay read reproduces every backfilled fold on real PG', async () => {
  // Initial trigger + two folds, distinct event_ids and distinct traces.
  await persistence.appendAgentStackItems({
    identityKey: 'xiaoni', traceId: 'rt-parent', runId: 'run-1',
    sourceType: 'agent_queue_messages', sourceId: 'run-1',
    items: [runtimeInputItem('stack:rt-parent:runtime-input', 'rt-parent', '初始触发')]
  });
  await persistence.appendAgentStackItems({
    identityKey: 'xiaoni', traceId: 'rt-fold-A', runId: 'run-1',
    sourceType: 'agent_queue_messages', sourceId: 'run-1',
    items: [runtimeInputItem('stack:rt-fold-A:runtime-input', 'rt-fold-A', '视线边缘：阿花修好了做图')]
  });
  await persistence.appendAgentStackItems({
    identityKey: 'xiaoni', traceId: 'rt-fold-B', runId: 'run-1',
    sourceType: 'agent_queue_messages', sourceId: 'run-1',
    items: [runtimeInputItem('stack:rt-fold-B:runtime-input', 'rt-fold-B', '视线边缘：群里 @了你')]
  });
  // The replay read the next run actually uses to rebuild history: everything after the
  // compression floor, read stack-native by stack_index (loadStackHistoryBlocks' shape).
  // No settle step any more — folds are addressed by stack position, not by conversation.
  const rows = await persistence.listAgentStackItems({
    identityKey: 'xiaoni', runId: 'run-1', limit: 1000, chronological: true
  });
  const text = JSON.stringify(rows);
  assert.ok(text.includes('阿花修好了做图'), 'replay must reproduce folded reminder A');
  assert.ok(text.includes('群里 @了你'), 'replay must reproduce folded reminder B');
  assert.ok(text.includes('初始触发'), 'replay must reproduce the initial trigger');
});

// #2 notify consumption (no double-consume) — cache-穿透 angle on real PG. If the SAME notify
// is consumed by TWO runs (a phantom/re-claim across run rows, NOT same-run reprocess), the
// traceId-keyed event_id must still dedupe to ONE runtime_input — so the next run's stack-replay
// body does not grow and the cached prefix stays stable across the run boundary.
dbTest('a notify consumed across TWO different runs persists exactly one replay copy (cross-run dedup)', async () => {
  const evt = 'stack:rt-fold-X:runtime-input';
  await persistence.appendAgentStackItems({
    identityKey: 'xiaoni', traceId: 'rt-fold-X', runId: 'run-A',
    sourceType: 'agent_queue_messages', sourceId: 'run-A',
    items: [runtimeInputItem(evt, 'rt-fold-X', '视线边缘：同一条 notify')]
  });
  // A DIFFERENT run re-consumes the same notify (same trace_id) — the phantom-run / re-claim case.
  await persistence.appendAgentStackItems({
    identityKey: 'xiaoni', traceId: 'rt-fold-X', runId: 'run-B',
    sourceType: 'agent_queue_messages', sourceId: 'run-B',
    items: [runtimeInputItem(evt, 'rt-fold-X', '视线边缘：同一条 notify')]
  });
  assert.equal(await countRuntimeInputs(), 1, 'a notify consumed by two runs must persist exactly one replay copy');
  const persisted = await persistence.findAgentStackItemByEventId(evt);
  assert.equal(persisted.content.text, '视线边缘：同一条 notify');
});

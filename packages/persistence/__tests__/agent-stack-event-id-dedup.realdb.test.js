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
//   3. attachConversationIdToAgentStackByTrace is COALESCE first-write-wins,
//   4. listAgentStackItemsForConversations (the replay read path) reproduces every
//      backfilled fold.
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

dbTest('attachConversationIdToAgentStackByTrace is COALESCE first-write-wins on real PG', async () => {
  await persistence.appendAgentStackItems({
    identityKey: 'xiaoni', traceId: 'rt-fold-A', runId: 'run-1',
    sourceType: 'agent_queue_messages', sourceId: 'run-1',
    items: [runtimeInputItem('stack:rt-fold-A:runtime-input', 'rt-fold-A', '视线边缘：1 条')]
  });
  // First backfill sets it.
  await persistence.attachConversationIdToAgentStackByTrace({ traceId: 'rt-fold-A', conversationId: 60894 });
  let row = await persistence.findAgentStackItemByEventId('stack:rt-fold-A:runtime-input');
  assert.equal(String(row.conversationId ?? row.conversation_id), '60894');
  // Second backfill with a DIFFERENT id must NOT overwrite (COALESCE) — this is why
  // the failed-path backfill must be guarded to terminal-only: a retry's
  // success-settle could never re-pin a fold already attached to the failed conv.
  await persistence.attachConversationIdToAgentStackByTrace({ traceId: 'rt-fold-A', conversationId: 70000 });
  row = await persistence.findAgentStackItemByEventId('stack:rt-fold-A:runtime-input');
  assert.equal(String(row.conversationId ?? row.conversation_id), '60894', 'COALESCE must keep the first conversation id');
});

dbTest('replay read path reproduces every backfilled fold on real PG', async () => {
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
  // Settle: each trace's rows get the run's conversation id (the settled path).
  for (const traceId of ['rt-parent', 'rt-fold-A', 'rt-fold-B']) {
    await persistence.attachConversationIdToAgentStackByTrace({ traceId, conversationId: 60894 });
  }

  // The replay read the next run uses to rebuild this conversation's history.
  const rows = await persistence.listAgentStackItemsForConversations({
    identityKey: 'xiaoni', conversationIds: [60894], limit: 1000
  });
  const text = JSON.stringify(rows);
  assert.ok(text.includes('阿花修好了做图'), 'replay must reproduce folded reminder A');
  assert.ok(text.includes('群里 @了你'), 'replay must reproduce folded reminder B');
  assert.ok(text.includes('初始触发'), 'replay must reproduce the initial trigger');
});

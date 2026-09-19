'use strict';

// REAL-Postgres regression for pruneLlmPayloadsBeforeReadCutoff —— 观测层载荷保留期。
//
// 删的是观测层请求快照(不进 replay),但删错方向 = 丢掉还在上下文里的 trace,必须在真 PG 上验:
//   1. llm_request_slices:区间整段 <= read_cutoff 的删;跨 cutoff / cutoff 之后 / running 的留;
//      区间全空的按「上下文首个保留块」created_at 切;
//   2. fork slices/items 与 provider_usage_events 按时间切,running fork run 的行整个跳过;
//   3. 分批删到干净(batchSize 小于待删行数);
//   4. 栈本身一行不动;无 cutoff → no_read_cutoff,不删任何东西。
//
// 与 plan-void-run-segment.realdb 同一套隔离 DB(qqbot_cache_test),不可达时干净跳过。

const test = require('node:test');
const assert = require('node:assert/strict');
const { createXiaoniAgentStackPersistence, createSqlAdapter } = require('../index');

const PG_HOST = process.env.DB_HOST || 'localhost';
const PG_PORT = process.env.DB_PORT || '5432';
const PG_USER = process.env.DB_USER || 'qqbot_user';
const PG_PW = process.env.DB_PASSWORD || 'qqbot_password';
const TEST_DB_NAME = 'qqbot_cache_test';
const TEST_DB_URL = process.env.CACHE_TEST_DATABASE_URL
  || `postgresql://${PG_USER}:${PG_PW}@${PG_HOST}:${PG_PORT}/${TEST_DB_NAME}`;
const ADMIN_DB_URL = `postgresql://${PG_USER}:${PG_PW}@${PG_HOST}:${PG_PORT}/postgres`;

const TABLES = [
  'agent_stack_items',
  'llm_request_slices',
  'subconscious_agent_fork_runs',
  'subconscious_agent_fork_slices',
  'subconscious_agent_fork_items',
  'provider_usage_events'
];

// 上下文首个保留块(stack_index 11)的时间;更早的 fork / 事件行应被修剪。
const CONTEXT_STARTED_AT = '2026-09-18T12:00:00.000Z';
const BEFORE = '2026-09-18T11:00:00.000Z';
const AFTER = '2026-09-18T13:00:00.000Z';

let sql = null;
let persistence = null;
let dbReady = false;

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

function dbTest(name, fn) {
  test(name, async (t) => {
    if (!dbReady) {
      t.skip('real cache test DB (qqbot_cache_test) unavailable');
      return;
    }
    await sql.execute(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY`, []);
    await fn();
  });
}

async function seedStack() {
  // stack 1..10 已被驱逐(read_cutoff = 10),11..12 在上下文里。
  for (let index = 1; index <= 12; index += 1) {
    await sql.execute(
      `INSERT INTO agent_stack_items (event_id, item_kind, stack_index, identity_key, created_at)
       VALUES (?, 'runtime_input', ?, 'xiaoni', ?::timestamptz)`,
      [`stack:${index}`, index, index >= 11 ? CONTEXT_STARTED_AT : BEFORE]
    );
  }
}

async function insertSlice(sliceId, { inputEnd = null, outputEnd = null, status = 'completed', createdAt = BEFORE } = {}) {
  await sql.execute(
    `INSERT INTO llm_request_slices (slice_id, identity_key, input_end_index, output_end_index, status, created_at)
     VALUES (?, 'xiaoni', ?, ?, ?, ?::timestamptz)`,
    [sliceId, inputEnd, outputEnd, status, createdAt]
  );
}

async function ids(table, column) {
  const rows = await sql.query(`SELECT ${column} AS id FROM ${table} ORDER BY ${column}`, []);
  return rows.map((row) => row.id);
}

dbTest('主 slices:区间整段 <= cutoff 的删,跨 cutoff / 之后 / running 的留,空区间按上下文起点时间切', async () => {
  await seedStack();
  await insertSlice('evicted', { inputEnd: 8, outputEnd: 9 });
  await insertSlice('evicted-at-cutoff', { inputEnd: 9, outputEnd: 10 });
  await insertSlice('straddling', { inputEnd: 10, outputEnd: 11 });
  await insertSlice('in-context', { inputEnd: 11, outputEnd: 12, createdAt: AFTER });
  await insertSlice('running-old', { inputEnd: 5, outputEnd: 5, status: 'running' });
  await insertSlice('no-index-old', { createdAt: BEFORE });
  await insertSlice('no-index-new', { createdAt: AFTER });

  const result = await persistence.pruneLlmPayloadsBeforeReadCutoff({ readCutoffAfterStackIndex: 10 });

  assert.equal(result.contextStartedAt, CONTEXT_STARTED_AT);
  assert.equal(result.deleted.llm_request_slices, 3);
  assert.deepEqual(await ids('llm_request_slices', 'slice_id'), ['in-context', 'no-index-new', 'running-old', 'straddling']);
  assert.equal((await ids('agent_stack_items', 'stack_index')).length, 12, '栈一行不动');
});

dbTest('fork slices/items 与 provider_usage_events 按时间切,running fork run 整个跳过', async () => {
  await seedStack();
  await sql.execute(
    `INSERT INTO subconscious_agent_fork_runs (fork_run_id, identity_key, status) VALUES ('done', 'xiaoni', 'completed'), ('live', 'xiaoni', 'running')`,
    []
  );
  const forkRows = [['done', BEFORE, 'done-old', 1], ['done', AFTER, 'done-new', 2], ['live', BEFORE, 'live-old', 1]];
  for (const [forkRunId, createdAt, tag, itemIndex] of forkRows) {
    await sql.execute(
      `INSERT INTO subconscious_agent_fork_slices (fork_run_id, slice_id, identity_key, created_at) VALUES (?, ?, 'xiaoni', ?::timestamptz)`,
      [forkRunId, tag, createdAt]
    );
    await sql.execute(
      `INSERT INTO subconscious_agent_fork_items (fork_run_id, event_id, item_kind, item_index, identity_key, created_at)
       VALUES (?, ?, 'runtime_input', ?, 'xiaoni', ?::timestamptz)`,
      [forkRunId, tag, itemIndex, createdAt]
    );
  }
  await sql.execute(
    `INSERT INTO provider_usage_events (event_id, identity_key, created_at) VALUES ('pue-old', 'xiaoni', ?::timestamptz), ('pue-new', 'xiaoni', ?::timestamptz)`,
    [BEFORE, AFTER]
  );

  const result = await persistence.pruneLlmPayloadsBeforeReadCutoff({ readCutoffAfterStackIndex: 10 });

  assert.deepEqual(await ids('subconscious_agent_fork_slices', 'slice_id'), ['done-new', 'live-old']);
  assert.deepEqual(await ids('subconscious_agent_fork_items', 'event_id'), ['done-new', 'live-old']);
  assert.deepEqual(await ids('provider_usage_events', 'event_id'), ['pue-new']);
  assert.equal(result.deleted.subconscious_agent_fork_slices, 1);
  assert.equal(result.deleted.provider_usage_events, 1);
});

dbTest('batchSize 小于待删行数时分批删干净', async () => {
  await seedStack();
  for (let i = 0; i < 5; i += 1) {
    await insertSlice(`evicted-${i}`, { inputEnd: 1, outputEnd: 2 });
  }
  const result = await persistence.pruneLlmPayloadsBeforeReadCutoff({ readCutoffAfterStackIndex: 10, batchSize: 2 });
  assert.equal(result.deleted.llm_request_slices, 5);
  assert.deepEqual(await ids('llm_request_slices', 'slice_id'), []);
});

dbTest('无 cutoff → no_read_cutoff,不删任何东西', async () => {
  await seedStack();
  await insertSlice('evicted', { inputEnd: 1, outputEnd: 2 });
  const result = await persistence.pruneLlmPayloadsBeforeReadCutoff({ readCutoffAfterStackIndex: null });
  assert.equal(result.reason, 'no_read_cutoff');
  assert.deepEqual(await ids('llm_request_slices', 'slice_id'), ['evicted']);
});

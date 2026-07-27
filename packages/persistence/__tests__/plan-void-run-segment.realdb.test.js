'use strict';

// REAL-Postgres regression for voidAgentStackRunSegment —— plan 空转 run 作废
// (docs/specs/xiaoni-plan-run-void-on-idle.md)。
//
// 这是 agent_stack_items 上唯一的删除操作,防护必须在真 PG 上验:
//   1. 纯尾段:删净指定 run 的行,其余行(内容、stack_index)逐字节不动 —— 下一 run 的
//      replay 与作废前完全一致(缓存回退到既有暖前缀,零击穿);
//   2. 交错拒删:作废段之上存在其它 run 的行 → 一行不删,返回 aborted(fail-open 冻结);
//   3. run_id 为 NULL 的行同样算外来行;
//   4. 折叠 plan 的多 runId 一起删;
//   5. 无行 → no_rows,不报错。
//
// 与 agent-stack-event-id-dedup.realdb 同一套隔离 DB(qqbot_cache_test),不可达时干净跳过。

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
    await sql.execute('TRUNCATE agent_stack_items RESTART IDENTITY', []);
    await fn();
  });
}

async function appendRun(runId, texts) {
  return persistence.appendAgentStackItems({
    runId,
    traceId: `trace:${runId}`,
    items: texts.map((text, i) => ({
      eventId: `stack:${runId}:${i}`,
      itemKind: 'runtime_input',
      role: 'developer',
      content: { source: 'test', text }
    }))
  });
}

async function snapshotRows() {
  return sql.query(
    'SELECT event_id, stack_index, run_id, content::text AS content FROM agent_stack_items ORDER BY stack_index',
    []
  );
}

dbTest('纯尾段作废:删净目标 run,其余行逐字节不动(replay 等价于作废前)', async () => {
  await appendRun('run-A', ['a1', 'a2']);
  const preVoid = await snapshotRows();
  await appendRun('run-B', ['plan', 'reminder', 'settle']);

  const result = await persistence.voidAgentStackRunSegment({ runIds: ['run-B'] });
  assert.equal(result.voided, true);
  assert.equal(result.deletedCount, 3);

  const after = await snapshotRows();
  assert.deepEqual(after, preVoid);
  const head = await sql.query('SELECT COALESCE(MAX(stack_index), 0)::int AS top FROM agent_stack_items', []);
  assert.equal(Number(head[0].top), 2);
});

dbTest('交错拒删:作废段之上有其它 run 的行 → 一行不删,返回 interleaved', async () => {
  await appendRun('run-A', ['a1']);
  await appendRun('run-B', ['plan']);
  await appendRun('run-C', ['real-work']);
  const preVoid = await snapshotRows();

  const result = await persistence.voidAgentStackRunSegment({ runIds: ['run-B'] });
  assert.equal(result.voided, false);
  assert.equal(result.reason, 'interleaved');
  assert.equal(result.deletedCount, 0);
  assert.deepEqual(await snapshotRows(), preVoid);
});

dbTest('run_id 为 NULL 的行同样算外来行,拒删', async () => {
  await appendRun('run-B', ['plan']);
  await persistence.appendAgentStackItems({
    traceId: 'trace:null-run',
    items: [{ eventId: 'stack:null-run:0', itemKind: 'state_event', content: { source: 'test' } }]
  });
  const preVoid = await snapshotRows();

  const result = await persistence.voidAgentStackRunSegment({ runIds: ['run-B'] });
  assert.equal(result.voided, false);
  assert.equal(result.reason, 'interleaved');
  assert.deepEqual(await snapshotRows(), preVoid);
});

dbTest('折叠 plan 的多 runId 一起删净', async () => {
  await appendRun('run-A', ['a1']);
  const preVoid = await snapshotRows();
  await appendRun('run-B', ['plan-1']);
  await appendRun('run-B-folded', ['plan-2-folded']);

  const result = await persistence.voidAgentStackRunSegment({ runIds: ['run-B', 'run-B-folded'] });
  assert.equal(result.voided, true);
  assert.equal(result.deletedCount, 2);
  assert.deepEqual(await snapshotRows(), preVoid);
});

dbTest('目标 run 无行:no_rows,不报错不误删', async () => {
  await appendRun('run-A', ['a1']);
  const preVoid = await snapshotRows();

  const result = await persistence.voidAgentStackRunSegment({ runIds: ['run-missing'] });
  assert.equal(result.voided, false);
  assert.equal(result.reason, 'no_rows');
  assert.deepEqual(await snapshotRows(), preVoid);
});

dbTest('空 runIds:no_run_ids 直接返回', async () => {
  const result = await persistence.voidAgentStackRunSegment({ runIds: [] });
  assert.equal(result.voided, false);
  assert.equal(result.reason, 'no_run_ids');
});

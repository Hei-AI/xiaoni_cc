'use strict';

// REAL-Postgres regression for「报时只留最新一格」。
//
// 停机调试期间 clock ping 的 supervisor 照常按 2h 格入队,一夜攒六条 pending。她一恢复
// 会连着读到六个不同的时刻和六个不同的「你醒了多久」——正好制造出这套机制要消灭的那种
// 时间错乱。修法是入队新一格之后,把更早的 pending 报时判为过期。
//
// 为什么必须打真库:这条逻辑全部是 SQL 语义——partial 条件(status='pending')、JSONB 取值
// (raw_payload->>'reason')、NULL 参数的三值逻辑(? IS NULL OR message_sid <> ?),以及
// RETURNING 的行数。内存替身把这些全部抹平,测了等于没测。
//
// 用隔离的一次性库(qqbot_cache_test),绝不碰 qqbot_db。库不可达时整组干净跳过。

const test = require('node:test');
const assert = require('node:assert/strict');
const { supersedePendingClockPings, createSqlAdapter } = require('../index');

const PG_HOST = process.env.DB_HOST || 'localhost';
const PG_PORT = process.env.DB_PORT || '5432';
const PG_USER = process.env.DB_USER || 'qqbot_user';
const PG_PW = process.env.DB_PASSWORD || 'qqbot_password';
const TEST_DB_NAME = 'qqbot_cache_test';
const TEST_DB_URL = process.env.CACHE_TEST_DATABASE_URL
  || `postgresql://${PG_USER}:${PG_PW}@${PG_HOST}:${PG_PORT}/${TEST_DB_NAME}`;
const ADMIN_DB_URL = `postgresql://${PG_USER}:${PG_PW}@${PG_HOST}:${PG_PORT}/postgres`;

const SESSION = 'xiaoni:global';
let sql = null;
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

// 只建本组用得到的最小表面,列名与 prisma schema 的 AgentQueueMessage 对齐。
async function ensureQueueTable() {
  await sql.execute(`
    CREATE TABLE IF NOT EXISTS agent_queue_messages (
      id BIGSERIAL PRIMARY KEY,
      trace_id VARCHAR(128) NOT NULL,
      source VARCHAR(32) NOT NULL,
      message_sid VARCHAR(191) NOT NULL,
      dedupe_key VARCHAR(255) NOT NULL UNIQUE,
      chat_type VARCHAR(16) NOT NULL,
      session_key VARCHAR(191) NOT NULL,
      peer_id VARCHAR(191) NOT NULL,
      sender_id VARCHAR(191) NOT NULL,
      account_id VARCHAR(191) NOT NULL,
      body_for_agent TEXT NOT NULL,
      raw_payload JSONB NOT NULL DEFAULT '{}',
      inbound_context JSONB NOT NULL DEFAULT '{}',
      payload JSONB NOT NULL DEFAULT '{}',
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      attempts INT NOT NULL DEFAULT 0,
      max_attempts INT NOT NULL DEFAULT 3,
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      result JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `, []);
}

async function insertRow({ sid, reason, status = 'pending', sessionKey = SESSION }) {
  await sql.execute(`
    INSERT INTO agent_queue_messages
      (trace_id, source, message_sid, dedupe_key, chat_type, session_key, peer_id,
       sender_id, account_id, body_for_agent, raw_payload, status)
    VALUES (?, 'system_reminder', ?, ?, 'direct', ?, 'xiaoni', 'xiaoni', 'xiaoni', 'x', ?::jsonb, ?)
  `, [sid, sid, sid, sessionKey, JSON.stringify({ reason }), status]);
}

async function statusOf(sid) {
  const rows = await sql.query('SELECT status FROM agent_queue_messages WHERE message_sid = ?', [sid]);
  return rows.length ? rows[0].status : null;
}

test.before(async () => {
  try {
    await ensureIsolatedTestDatabase();
    sql = createSqlAdapter({ databaseUrl: TEST_DB_URL });
    if (!(await sql.testConnection())) {
      throw new Error('testConnection() returned false');
    }
    await ensureQueueTable();
    dbReady = true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.log(`[skip] real cache test DB unavailable: ${error.message}`);
    dbReady = false;
  }
});

test.beforeEach(async () => {
  if (dbReady) {
    await sql.execute('TRUNCATE agent_queue_messages', []);
  }
});

test.after(async () => {
  if (sql) {
    await sql.close().catch(() => {});
  }
});

test('停机攒下的旧报时全部判为过期，只留本次那一条', async (t) => {
  if (!dbReady) return t.skip('test DB unavailable');
  await insertRow({ sid: 'clock-ping:xiaoni:global:100', reason: 'clock_ping' });
  await insertRow({ sid: 'clock-ping:xiaoni:global:101', reason: 'clock_ping' });
  await insertRow({ sid: 'clock-ping:xiaoni:global:102', reason: 'clock_ping' });

  const result = await supersedePendingClockPings(
    { sessionKey: SESSION, keepMessageSid: 'clock-ping:xiaoni:global:102', sqlAdapter: sql },
    {}
  );

  assert.equal(result.supersededCount, 2);
  assert.equal(await statusOf('clock-ping:xiaoni:global:100'), 'settled');
  assert.equal(await statusOf('clock-ping:xiaoni:global:101'), 'settled');
  assert.equal(await statusOf('clock-ping:xiaoni:global:102'), 'pending', '本次那条必须活着');
});

test('别的 pending 通知一条都不许碰', async (t) => {
  if (!dbReady) return t.skip('test DB unavailable');
  await insertRow({ sid: 'clock-ping:a', reason: 'clock_ping' });
  await insertRow({ sid: 'compress-done:a', reason: 'core_memory_compression_done' });
  await insertRow({ sid: 'plan:a', reason: 'subconscious_agent' });

  await supersedePendingClockPings({ sessionKey: SESSION, keepMessageSid: null, sqlAdapter: sql }, {});

  assert.equal(await statusOf('clock-ping:a'), 'settled');
  assert.equal(await statusOf('compress-done:a'), 'pending', '压缩完成通知不许被扫到');
  assert.equal(await statusOf('plan:a'), 'pending', 'plan notify 不许被扫到');
});

test('已被消费的报时绝不回改 —— 进过上下文的东西冻结不可变', async (t) => {
  if (!dbReady) return t.skip('test DB unavailable');
  // 铁律:已消费的内容一旦进上下文就冻结。回改会让 replay 与 live 不一致 → 缓存击穿。
  await insertRow({ sid: 'clock-ping:consumed', reason: 'clock_ping', status: 'consumed' });
  await insertRow({ sid: 'clock-ping:settled', reason: 'clock_ping', status: 'settled' });
  await insertRow({ sid: 'clock-ping:pending', reason: 'clock_ping' });

  const result = await supersedePendingClockPings(
    { sessionKey: SESSION, keepMessageSid: null, sqlAdapter: sql },
    {}
  );

  assert.equal(result.supersededCount, 1, '只有那条 pending 被判过期');
  assert.equal(await statusOf('clock-ping:consumed'), 'consumed');
  assert.equal(await statusOf('clock-ping:settled'), 'settled');
});

test('别的 session 的报时不受影响', async (t) => {
  if (!dbReady) return t.skip('test DB unavailable');
  await insertRow({ sid: 'clock-ping:mine', reason: 'clock_ping' });
  await insertRow({ sid: 'clock-ping:other', reason: 'clock_ping', sessionKey: 'someone:else' });

  await supersedePendingClockPings({ sessionKey: SESSION, keepMessageSid: null, sqlAdapter: sql }, {});

  assert.equal(await statusOf('clock-ping:mine'), 'settled');
  assert.equal(await statusOf('clock-ping:other'), 'pending');
});

test('keepMessageSid 为 null 时把所有 pending 报时判过期（不炸）', async (t) => {
  if (!dbReady) return t.skip('test DB unavailable');
  // ? IS NULL OR message_sid <> ? 的三值逻辑:参数为 NULL 时条件恒真,不能变成 NULL 而漏掉整个 WHERE。
  await insertRow({ sid: 'clock-ping:x', reason: 'clock_ping' });
  const result = await supersedePendingClockPings(
    { sessionKey: SESSION, keepMessageSid: null, sqlAdapter: sql },
    {}
  );
  assert.equal(result.supersededCount, 1);
});

test('没有旧报时时是干净的 no-op', async (t) => {
  if (!dbReady) return t.skip('test DB unavailable');
  const result = await supersedePendingClockPings(
    { sessionKey: SESSION, keepMessageSid: 'clock-ping:only', sqlAdapter: sql },
    {}
  );
  assert.equal(result.supersededCount, 0);
});

test('缺 sessionKey 直接抛错，不做无差别更新', async (t) => {
  if (!dbReady) return t.skip('test DB unavailable');
  await assert.rejects(
    () => supersedePendingClockPings({ keepMessageSid: 'x', sqlAdapter: sql }, {}),
    /requires sessionKey/
  );
});

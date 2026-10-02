'use strict';

// REAL-Postgres check for the main-agent model switch (requestMainAgentModelSwitch /
// promotePendingMainAgentModel). The promote is the one place the effective model changes, and
// it must be a single atomic UPDATE ... WHERE pending IS NOT NULL: a second promote with nothing
// pending must be a no-op, and cancelling (model=null) must clear pending without touching the
// effective model. All of that is SQL semantics (NULL params, ON CONFLICT, RETURNING row count),
// so it runs against the isolated qqbot_cache_test DB; skipped cleanly when unreachable.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSqlAdapter,
  getAgentRuntimeControl,
  updateAgentRuntimeControl,
  triggerPostCompressionRuntimePause,
  requestMainAgentModelSwitch,
  promotePendingMainAgentModel
} = require('../index');

const PG_HOST = process.env.DB_HOST || 'localhost';
const PG_PORT = process.env.DB_PORT || '5432';
const PG_USER = process.env.DB_USER || 'qqbot_user';
const PG_PW = process.env.DB_PASSWORD || 'qqbot_password';
const TEST_DB_NAME = 'qqbot_cache_test';
const TEST_DB_URL = process.env.CACHE_TEST_DATABASE_URL
  || `postgresql://${PG_USER}:${PG_PW}@${PG_HOST}:${PG_PORT}/${TEST_DB_NAME}`;
const ADMIN_DB_URL = `postgresql://${PG_USER}:${PG_PW}@${PG_HOST}:${PG_PORT}/postgres`;
const CONFIG = { databaseUrl: TEST_DB_URL };
const IDENTITY = 'model-switch-test';

let dbReady = false;

test.before(async () => {
  const admin = createSqlAdapter({ databaseUrl: ADMIN_DB_URL });
  try {
    if (!(await admin.testConnection())) return;
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = ?', [TEST_DB_NAME]);
    if (existing.length === 0) {
      await admin.execute(`CREATE DATABASE ${TEST_DB_NAME}`, []);
    }
    dbReady = true;
  } catch {
    dbReady = false;
  } finally {
    await admin.close().catch(() => {});
  }
  if (dbReady) {
    const sql = createSqlAdapter(CONFIG);
    try {
      await getAgentRuntimeControl({ identityKey: IDENTITY }, CONFIG); // ensures schema
      await sql.execute('DELETE FROM agent_runtime_control WHERE identity_key = ?', [IDENTITY]);
    } finally {
      await sql.close();
    }
  }
});

test('request -> pending only; promote -> effective; second promote is a no-op; cancel clears pending', async (t) => {
  if (!dbReady) {
    t.skip('qqbot_cache_test unreachable');
    return;
  }
  const fresh = await getAgentRuntimeControl({ identityKey: IDENTITY }, CONFIG);
  assert.equal(fresh.mainAgentModel, null);
  assert.equal(fresh.mainAgentModelPending, null);

  const requested = await requestMainAgentModelSwitch({ identityKey: IDENTITY, model: 'claude-opus-5-5' }, CONFIG);
  assert.equal(requested.mainAgentModel, null, 'request must not change the effective model');
  assert.equal(requested.mainAgentModelPending, 'claude-opus-5-5');
  assert.ok(requested.mainAgentModelPendingAt);

  const promoted = await promotePendingMainAgentModel({ identityKey: IDENTITY }, CONFIG);
  assert.equal(promoted.promoted, true);
  assert.equal(promoted.control.mainAgentModel, 'claude-opus-5-5');
  assert.equal(promoted.control.mainAgentModelPending, null);
  assert.ok(promoted.control.mainAgentModelSwitchedAt);

  const again = await promotePendingMainAgentModel({ identityKey: IDENTITY }, CONFIG);
  assert.equal(again.promoted, false);

  await requestMainAgentModelSwitch({ identityKey: IDENTITY, model: 'claude-sonnet-5-5' }, CONFIG);
  const cancelled = await requestMainAgentModelSwitch({ identityKey: IDENTITY, model: null }, CONFIG);
  assert.equal(cancelled.mainAgentModelPending, null);
  assert.equal(cancelled.mainAgentModelPendingAt, null);
  assert.equal(cancelled.mainAgentModel, 'claude-opus-5-5', 'cancel must not touch the effective model');

  const read = await getAgentRuntimeControl({ identityKey: IDENTITY }, CONFIG);
  assert.equal(read.mainAgentModel, 'claude-opus-5-5');
  assert.equal(read.enabled, true);
});

test('the other runtime-control writers return the full row (model columns included)', async (t) => {
  if (!dbReady) {
    t.skip('qqbot_cache_test unreachable');
    return;
  }
  const toggled = await updateAgentRuntimeControl({ identityKey: IDENTITY, enabled: true }, CONFIG);
  assert.equal(toggled.mainAgentModel, 'claude-opus-5-5', 'the run-switch PATCH must not blank the model');
  assert.equal(toggled.enabled, true);
  const paused = await triggerPostCompressionRuntimePause({ identityKey: IDENTITY }, CONFIG);
  assert.equal(paused.mainAgentModel, 'claude-opus-5-5');
  assert.equal(typeof paused.pauseJustTriggered, 'boolean');
});

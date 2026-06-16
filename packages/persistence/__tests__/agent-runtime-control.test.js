'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentRuntimeControlPersistence } = require('../agent-runtime-control');

function createPersistence(overrides = {}) {
  const statements = [];
  const queries = [];
  const rows = overrides.rows || [];
  const adapter = overrides.createSqlAdapter || (() => ({
    execute: async (statement) => {
      statements.push(statement);
      return 0;
    },
    query: async (statement, params) => {
      queries.push({ statement, params });
      return rows.shift() || [];
    },
    close: async () => undefined
  }));
  return {
    statements,
    queries,
    persistence: createAgentRuntimeControlPersistence({
      createSqlAdapter: adapter
    })
  };
}

test('ensureAgentRuntimeControlSchema creates an enabled-by-default control table', async () => {
  const { statements, persistence } = createPersistence();

  await persistence.ensureAgentRuntimeControlSchema();

  const createTable = statements.join('\n');
  assert.match(createTable, /CREATE TABLE IF NOT EXISTS agent_runtime_control/);
  assert.match(createTable, /enabled BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(createTable, /cache_heartbeat_paused BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(createTable, /post_compression_pause_armed BOOLEAN NOT NULL DEFAULT FALSE/);
});

test('getAgentRuntimeControl defaults Xiaoni to enabled when no row exists', async () => {
  const { persistence } = createPersistence({ rows: [[]] });

  const control = await persistence.getAgentRuntimeControl({ identityKey: 'xiaoni' });

  assert.deepEqual(control, {
    identityKey: 'xiaoni',
    enabled: true,
    cacheHeartbeatPaused: false,
    cacheHeartbeatPausedAt: null,
    postCompressionPauseArmed: false,
    postCompressionPauseArmedAt: null,
    postCompressionPauseTriggeredAt: null,
    postCompressionPauseReason: null,
    updatedAt: null
  });
});

test('getAgentRuntimeControl reuses one SQL adapter for schema ensure and read', async () => {
  let created = 0;
  let closed = 0;
  const { persistence } = createPersistence({
    rows: [[]],
    createSqlAdapter: () => {
      created += 1;
      return {
        execute: async () => 0,
        query: async () => [],
        close: async () => {
          closed += 1;
        }
      };
    }
  });

  await persistence.getAgentRuntimeControl({ identityKey: 'xiaoni' });

  assert.equal(created, 1);
  assert.equal(closed, 1);
});

test('updateAgentRuntimeControl persists disabled state', async () => {
  const updatedAt = new Date('2026-06-06T12:00:00.000Z');
  const { queries, persistence } = createPersistence({
    rows: [[{
      identity_key: 'xiaoni',
      enabled: false,
      cache_heartbeat_paused: false,
      cache_heartbeat_paused_at: null,
      post_compression_pause_armed: false,
      post_compression_pause_armed_at: null,
      post_compression_pause_triggered_at: null,
      post_compression_pause_reason: null,
      updated_at: updatedAt
    }]]
  });

  const control = await persistence.updateAgentRuntimeControl({
    identityKey: 'xiaoni',
    enabled: false
  });

  const updateQuery = queries.at(-1);
  assert.match(updateQuery.statement, /INSERT INTO agent_runtime_control/);
  assert.deepEqual(updateQuery.params, [
    'xiaoni',
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false
  ]);
  assert.deepEqual(control, {
    identityKey: 'xiaoni',
    enabled: false,
    cacheHeartbeatPaused: false,
    cacheHeartbeatPausedAt: null,
    postCompressionPauseArmed: false,
    postCompressionPauseArmedAt: null,
    postCompressionPauseTriggeredAt: null,
    postCompressionPauseReason: null,
    updatedAt: '2026-06-06T20:00:00.000+08:00'
  });
});

test('updateAgentRuntimeControl pauses cache heartbeat without changing runtime enabled', async () => {
  const updatedAt = new Date('2026-06-06T12:00:00.000Z');
  const pausedAt = new Date('2026-06-06T12:03:00.000Z');
  const { queries, persistence } = createPersistence({
    rows: [[{
      identity_key: 'xiaoni',
      enabled: true,
      cache_heartbeat_paused: true,
      cache_heartbeat_paused_at: pausedAt,
      post_compression_pause_armed: false,
      post_compression_pause_armed_at: null,
      post_compression_pause_triggered_at: null,
      post_compression_pause_reason: null,
      updated_at: updatedAt
    }]]
  });

  const control = await persistence.updateAgentRuntimeControl({
    identityKey: 'xiaoni',
    cacheHeartbeatPaused: true
  });

  const updateQuery = queries.at(-1);
  assert.match(updateQuery.statement, /cache_heartbeat_paused_at = CASE/);
  assert.deepEqual(updateQuery.params, [
    'xiaoni',
    true,
    true,
    true,
    false,
    false,
    false,
    true,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false
  ]);
  assert.deepEqual(control, {
    identityKey: 'xiaoni',
    enabled: true,
    cacheHeartbeatPaused: true,
    cacheHeartbeatPausedAt: '2026-06-06T20:03:00.000+08:00',
    postCompressionPauseArmed: false,
    postCompressionPauseArmedAt: null,
    postCompressionPauseTriggeredAt: null,
    postCompressionPauseReason: null,
    updatedAt: '2026-06-06T20:00:00.000+08:00'
  });
});

test('updateAgentRuntimeControl arms post-compression pause without changing enabled', async () => {
  const updatedAt = new Date('2026-06-06T12:00:00.000Z');
  const armedAt = new Date('2026-06-06T12:01:00.000Z');
  const { queries, persistence } = createPersistence({
    rows: [[{
      identity_key: 'xiaoni',
      enabled: true,
      cache_heartbeat_paused: false,
      cache_heartbeat_paused_at: null,
      post_compression_pause_armed: true,
      post_compression_pause_armed_at: armedAt,
      post_compression_pause_triggered_at: null,
      post_compression_pause_reason: null,
      updated_at: updatedAt
    }]]
  });

  const control = await persistence.updateAgentRuntimeControl({
    identityKey: 'xiaoni',
    postCompressionPauseArmed: true
  });

  const updateQuery = queries.at(-1);
  assert.match(updateQuery.statement, /CASE WHEN \? THEN NOW\(\) ELSE NULL END/);
  assert.deepEqual(updateQuery.params, [
    'xiaoni',
    true,
    false,
    false,
    true,
    true,
    false,
    true,
    false,
    false,
    false,
    false,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true
  ]);
  assert.deepEqual(control, {
    identityKey: 'xiaoni',
    enabled: true,
    cacheHeartbeatPaused: false,
    cacheHeartbeatPausedAt: null,
    postCompressionPauseArmed: true,
    postCompressionPauseArmedAt: '2026-06-06T20:01:00.000+08:00',
    postCompressionPauseTriggeredAt: null,
    postCompressionPauseReason: null,
    updatedAt: '2026-06-06T20:00:00.000+08:00'
  });
});

test('triggerPostCompressionRuntimePause disables runtime only when armed', async () => {
  const updatedAt = new Date('2026-06-06T12:02:00.000Z');
  const triggeredAt = new Date('2026-06-06T12:02:00.000Z');
  const { queries, persistence } = createPersistence({
    rows: [[{
      identity_key: 'xiaoni',
      enabled: false,
      cache_heartbeat_paused: false,
      cache_heartbeat_paused_at: null,
      post_compression_pause_armed: false,
      post_compression_pause_armed_at: new Date('2026-06-06T12:01:00.000Z'),
      post_compression_pause_triggered_at: triggeredAt,
      post_compression_pause_reason: 'core_memory_compression_completed',
      updated_at: updatedAt
    }]]
  });

  const control = await persistence.triggerPostCompressionRuntimePause({
    identityKey: 'xiaoni',
    reason: 'core_memory_compression_completed'
  });

  const triggerQuery = queries.at(-1);
  assert.match(triggerQuery.statement, /WHEN agent_runtime_control\.post_compression_pause_armed THEN FALSE/);
  assert.deepEqual(triggerQuery.params, ['xiaoni', 'core_memory_compression_completed']);
  assert.deepEqual(control, {
    identityKey: 'xiaoni',
    enabled: false,
    cacheHeartbeatPaused: false,
    cacheHeartbeatPausedAt: null,
    postCompressionPauseArmed: false,
    postCompressionPauseArmedAt: '2026-06-06T20:01:00.000+08:00',
    postCompressionPauseTriggeredAt: '2026-06-06T20:02:00.000+08:00',
    postCompressionPauseReason: 'core_memory_compression_completed',
    updatedAt: '2026-06-06T20:02:00.000+08:00'
  });
});

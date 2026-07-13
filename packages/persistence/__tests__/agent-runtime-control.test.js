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
  assert.match(createTable, /main_agent_pre_model_yield_ms INTEGER NOT NULL DEFAULT 5000/);
  assert.match(createTable, /debug_cache_heartbeat_interval_ms INTEGER NOT NULL DEFAULT 0/);
  assert.match(createTable, /compression_trigger_input_tokens INTEGER NOT NULL DEFAULT 80000/);
  assert.match(createTable, /compression_trigger_wire_bytes BIGINT NOT NULL DEFAULT 25165824/);
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
    mainAgentPreModelYieldMs: 5000,
    debugCacheHeartbeatIntervalMs: 0,
    compressionTriggerInputTokens: 80000,
    compressionTriggerWireBytes: 25165824,
    stripXiaoniOsFromRequests: false,
    psychAssessmentGateEnabled: false,
    energyPolicy: null,
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
      main_agent_pre_model_yield_ms: 5000,
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
    5000,
    0,
    80000,
    25165824,
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
    false,
    false,
    5000,
    false,
    0,
    false,
    80000,
    false,
    25165824,
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
    mainAgentPreModelYieldMs: 5000,
    debugCacheHeartbeatIntervalMs: 0,
    compressionTriggerInputTokens: 80000,
    compressionTriggerWireBytes: 25165824,
    stripXiaoniOsFromRequests: false,
    psychAssessmentGateEnabled: false,
    energyPolicy: null,
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
      main_agent_pre_model_yield_ms: 5000,
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
    5000,
    0,
    80000,
    25165824,
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
    false,
    false,
    5000,
    false,
    0,
    false,
    80000,
    false,
    25165824,
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
    mainAgentPreModelYieldMs: 5000,
    debugCacheHeartbeatIntervalMs: 0,
    compressionTriggerInputTokens: 80000,
    compressionTriggerWireBytes: 25165824,
    stripXiaoniOsFromRequests: false,
    psychAssessmentGateEnabled: false,
    energyPolicy: null,
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
      main_agent_pre_model_yield_ms: 5000,
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
    5000,
    0,
    80000,
    25165824,
    false,
    false,
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
    true,
    false,
    5000,
    false,
    0,
    false,
    80000,
    false,
    25165824,
    false,
    false,
    false,
    false
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
    mainAgentPreModelYieldMs: 5000,
    debugCacheHeartbeatIntervalMs: 0,
    compressionTriggerInputTokens: 80000,
    compressionTriggerWireBytes: 25165824,
    stripXiaoniOsFromRequests: false,
    psychAssessmentGateEnabled: false,
    energyPolicy: null,
    updatedAt: '2026-06-06T20:00:00.000+08:00'
  });
});

test('updateAgentRuntimeControl persists main agent pre-model yield milliseconds', async () => {
  const updatedAt = new Date('2026-06-06T12:04:00.000Z');
  const { queries, persistence } = createPersistence({
    rows: [[{
      identity_key: 'xiaoni',
      enabled: true,
      cache_heartbeat_paused: false,
      cache_heartbeat_paused_at: null,
      post_compression_pause_armed: false,
      post_compression_pause_armed_at: null,
      post_compression_pause_triggered_at: null,
      post_compression_pause_reason: null,
      main_agent_pre_model_yield_ms: 25,
      updated_at: updatedAt
    }]]
  });

  const control = await persistence.updateAgentRuntimeControl({
    identityKey: 'xiaoni',
    mainAgentPreModelYieldMs: 25
  });

  const updateQuery = queries.at(-1);
  assert.match(updateQuery.statement, /main_agent_pre_model_yield_ms = CASE/);
  // Trailing params are now [hasMainYield, mainYield, hasDebugInterval, debugInterval,
  // hasCompressionTrigger, compressionTrigger, hasCompressionWire, compressionWire,
  // hasStripXiaoniOs, stripXiaoniOs].
  assert.equal(updateQuery.params.at(-12), true);
  assert.equal(updateQuery.params.at(-11), 25);
  assert.equal(updateQuery.params.at(-10), false);
  assert.equal(updateQuery.params.at(-9), 0);
  assert.equal(updateQuery.params.at(-8), false);
  assert.equal(updateQuery.params.at(-7), 80000);
  assert.equal(updateQuery.params.at(-6), false);
  assert.equal(updateQuery.params.at(-5), 25165824);
  assert.equal(updateQuery.params.at(-4), false);
  assert.equal(updateQuery.params.at(-3), false);
  assert.equal(control.mainAgentPreModelYieldMs, 25);
});

test('updateAgentRuntimeControl persists debug cache heartbeat interval milliseconds', async () => {
  const updatedAt = new Date('2026-06-06T12:05:00.000Z');
  const { queries, persistence } = createPersistence({
    rows: [[{
      identity_key: 'xiaoni',
      enabled: true,
      cache_heartbeat_paused: false,
      cache_heartbeat_paused_at: null,
      post_compression_pause_armed: false,
      post_compression_pause_armed_at: null,
      post_compression_pause_triggered_at: null,
      post_compression_pause_reason: null,
      main_agent_pre_model_yield_ms: 5000,
      debug_cache_heartbeat_interval_ms: 60000,
      updated_at: updatedAt
    }]]
  });

  const control = await persistence.updateAgentRuntimeControl({
    identityKey: 'xiaoni',
    debugCacheHeartbeatIntervalMs: 60000
  });

  const updateQuery = queries.at(-1);
  assert.match(updateQuery.statement, /debug_cache_heartbeat_interval_ms = CASE/);
  // The debug-interval upsert branch params are [hasDebugInterval, debugInterval] at
  // .at(-8)/.at(-7); the last six drive compression-trigger, wire-bytes and strip branches.
  assert.equal(updateQuery.params.at(-10), true);
  assert.equal(updateQuery.params.at(-9), 60000);
  assert.equal(control.debugCacheHeartbeatIntervalMs, 60000);
});

test('updateAgentRuntimeControl persists compression trigger input tokens', async () => {
  const updatedAt = new Date('2026-06-06T12:06:00.000Z');
  const { queries, persistence } = createPersistence({
    rows: [[{
      identity_key: 'xiaoni',
      enabled: true,
      cache_heartbeat_paused: false,
      cache_heartbeat_paused_at: null,
      post_compression_pause_armed: false,
      post_compression_pause_armed_at: null,
      post_compression_pause_triggered_at: null,
      post_compression_pause_reason: null,
      main_agent_pre_model_yield_ms: 5000,
      debug_cache_heartbeat_interval_ms: 0,
      compression_trigger_input_tokens: 120000,
      updated_at: updatedAt
    }]]
  });

  const control = await persistence.updateAgentRuntimeControl({
    identityKey: 'xiaoni',
    compressionTriggerInputTokens: 120000
  });

  const updateQuery = queries.at(-1);
  assert.match(updateQuery.statement, /compression_trigger_input_tokens = CASE/);
  // Compression-trigger branch params [hasCompressionTrigger, compressionTrigger] now sit at
  // .at(-6)/.at(-5); the last four drive the wire-bytes and strip branches.
  assert.equal(updateQuery.params.at(-8), true);
  assert.equal(updateQuery.params.at(-7), 120000);
  assert.equal(updateQuery.params.at(-6), false);
  assert.equal(updateQuery.params.at(-5), 25165824);
  assert.equal(updateQuery.params.at(-4), false);
  assert.equal(updateQuery.params.at(-3), false);
  assert.equal(control.compressionTriggerInputTokens, 120000);
});

test('getAgentRuntimeControl defaults compression trigger to 80000 and round-trips a set value', async () => {
  // No row => default 80000.
  const defaultRun = createPersistence({ rows: [[]] });
  const defaultControl = await defaultRun.persistence.getAgentRuntimeControl({ identityKey: 'xiaoni' });
  assert.equal(defaultControl.compressionTriggerInputTokens, 80000);

  // Row with a stored value => round-trips that value.
  const storedRun = createPersistence({
    rows: [[{
      identity_key: 'xiaoni',
      enabled: true,
      compression_trigger_input_tokens: 95000,
      updated_at: null
    }]]
  });
  const storedControl = await storedRun.persistence.getAgentRuntimeControl({ identityKey: 'xiaoni' });
  assert.equal(storedControl.compressionTriggerInputTokens, 95000);
});

test('getAgentRuntimeControl defaults compression wire bytes to 24 MiB and round-trips a set value', async () => {
  // No row => default 25165824 (24 MiB).
  const defaultRun = createPersistence({ rows: [[]] });
  const defaultControl = await defaultRun.persistence.getAgentRuntimeControl({ identityKey: 'xiaoni' });
  assert.equal(defaultControl.compressionTriggerWireBytes, 25165824);

  // Row with a stored value => round-trips that value.
  const storedRun = createPersistence({
    rows: [[{
      identity_key: 'xiaoni',
      enabled: true,
      compression_trigger_wire_bytes: 20971520,
      updated_at: null
    }]]
  });
  const storedControl = await storedRun.persistence.getAgentRuntimeControl({ identityKey: 'xiaoni' });
  assert.equal(storedControl.compressionTriggerWireBytes, 20971520);
});

test('updateAgentRuntimeControl persists compression wire bytes', async () => {
  const updatedAt = new Date('2026-06-06T12:07:00.000Z');
  const { queries, persistence } = createPersistence({
    rows: [[{
      identity_key: 'xiaoni',
      enabled: true,
      compression_trigger_wire_bytes: 20971520,
      updated_at: updatedAt
    }]]
  });

  const control = await persistence.updateAgentRuntimeControl({
    identityKey: 'xiaoni',
    compressionTriggerWireBytes: 20971520
  });

  const updateQuery = queries.at(-1);
  assert.match(updateQuery.statement, /compression_trigger_wire_bytes = CASE/);
  // Wire-bytes upsert branch params [hasCompressionWire, compressionWire] now sit at
  // .at(-4)/.at(-3); the last two drive the strip branch (false/false here).
  assert.equal(updateQuery.params.at(-6), true);
  assert.equal(updateQuery.params.at(-5), 20971520);
  assert.equal(updateQuery.params.at(-4), false);
  assert.equal(updateQuery.params.at(-3), false);
  assert.equal(control.compressionTriggerWireBytes, 20971520);
});

test('getAgentRuntimeControl defaults strip_xiaoni_os_from_requests to false and round-trips true', async () => {
  const defaultRun = createPersistence({ rows: [[]] });
  const defaultControl = await defaultRun.persistence.getAgentRuntimeControl({ identityKey: 'xiaoni' });
  assert.equal(defaultControl.stripXiaoniOsFromRequests, false);

  const storedRun = createPersistence({
    rows: [[{
      identity_key: 'xiaoni',
      enabled: true,
      strip_xiaoni_os_from_requests: true,
      updated_at: null
    }]]
  });
  const storedControl = await storedRun.persistence.getAgentRuntimeControl({ identityKey: 'xiaoni' });
  assert.equal(storedControl.stripXiaoniOsFromRequests, true);
});

test('updateAgentRuntimeControl persists strip_xiaoni_os_from_requests without touching other knobs', async () => {
  const updatedAt = new Date('2026-06-06T12:08:00.000Z');
  const { queries, persistence } = createPersistence({
    rows: [[{
      identity_key: 'xiaoni',
      enabled: true,
      strip_xiaoni_os_from_requests: true,
      updated_at: updatedAt
    }]]
  });

  const control = await persistence.updateAgentRuntimeControl({
    identityKey: 'xiaoni',
    stripXiaoniOsFromRequests: true
  });

  const updateQuery = queries.at(-1);
  assert.match(updateQuery.statement, /strip_xiaoni_os_from_requests = CASE/);
  // Strip branch params are now the 3rd/4th-from-last: the psych gate branch
  // ([hasPsych, psych]) was appended after strip, so strip is at(-4)/at(-3).
  assert.equal(updateQuery.params.at(-4), true);
  assert.equal(updateQuery.params.at(-3), true);
  // The VALUES-side strip param still sits right after compressionTriggerWireBytes (index 10).
  assert.equal(updateQuery.params[10], true);
  assert.equal(control.stripXiaoniOsFromRequests, true);
});

test('getAgentRuntimeControl defaults psych_assessment_gate_enabled to false and round-trips true', async () => {
  const defaultRun = createPersistence({ rows: [[]] });
  const defaultControl = await defaultRun.persistence.getAgentRuntimeControl({ identityKey: 'xiaoni' });
  assert.equal(defaultControl.psychAssessmentGateEnabled, false);

  const storedRun = createPersistence({
    rows: [[{
      identity_key: 'xiaoni',
      enabled: true,
      psych_assessment_gate_enabled: true,
      updated_at: null
    }]]
  });
  const storedControl = await storedRun.persistence.getAgentRuntimeControl({ identityKey: 'xiaoni' });
  assert.equal(storedControl.psychAssessmentGateEnabled, true);
});

test('updateAgentRuntimeControl persists psych_assessment_gate_enabled without touching other knobs', async () => {
  const updatedAt = new Date('2026-07-13T12:08:00.000Z');
  const { queries, persistence } = createPersistence({
    rows: [[{
      identity_key: 'xiaoni',
      enabled: true,
      psych_assessment_gate_enabled: true,
      updated_at: updatedAt
    }]]
  });

  const control = await persistence.updateAgentRuntimeControl({
    identityKey: 'xiaoni',
    psychAssessmentGateEnabled: true
  });

  const updateQuery = queries.at(-1);
  assert.match(updateQuery.statement, /psych_assessment_gate_enabled = CASE/);
  // Psych gate branch params are the last two: [hasPsych, psych].
  assert.equal(updateQuery.params.at(-2), true);
  assert.equal(updateQuery.params.at(-1), true);
  // The VALUES-side psych param sits right after the strip param (index 11).
  assert.equal(updateQuery.params[11], true);
  assert.equal(control.psychAssessmentGateEnabled, true);
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
      main_agent_pre_model_yield_ms: 5000,
      updated_at: updatedAt
    }]]
  });

  const control = await persistence.triggerPostCompressionRuntimePause({
    identityKey: 'xiaoni',
    reason: 'core_memory_compression_completed'
  });

  const triggerQuery = queries.at(-1);
  assert.match(triggerQuery.statement, /WHEN agent_runtime_control\.post_compression_pause_armed THEN FALSE/);
  assert.match(triggerQuery.statement, /SELECT was_armed FROM prev/);
  assert.deepEqual(triggerQuery.params, ['xiaoni', 'xiaoni', 'core_memory_compression_completed']);
  assert.deepEqual(control, {
    identityKey: 'xiaoni',
    enabled: false,
    cacheHeartbeatPaused: false,
    cacheHeartbeatPausedAt: null,
    postCompressionPauseArmed: false,
    postCompressionPauseArmedAt: '2026-06-06T20:01:00.000+08:00',
    postCompressionPauseTriggeredAt: '2026-06-06T20:02:00.000+08:00',
    postCompressionPauseReason: 'core_memory_compression_completed',
    mainAgentPreModelYieldMs: 5000,
    debugCacheHeartbeatIntervalMs: 0,
    compressionTriggerInputTokens: 80000,
    compressionTriggerWireBytes: 25165824,
    stripXiaoniOsFromRequests: false,
    psychAssessmentGateEnabled: false,
    energyPolicy: null,
    updatedAt: '2026-06-06T20:02:00.000+08:00',
    // armed was already false (no pause_just_triggered in the returned row) =>
    // the upsert was a no-op; callers must NOT log "paused after compression".
    pauseJustTriggered: false
  });
});

test('triggerPostCompressionRuntimePause reports pauseJustTriggered when armed fired', async () => {
  const updatedAt = new Date('2026-06-06T12:02:00.000Z');
  const triggeredAt = new Date('2026-06-06T12:02:00.000Z');
  const { persistence } = createPersistence({
    rows: [[{
      identity_key: 'xiaoni',
      enabled: false,
      cache_heartbeat_paused: false,
      cache_heartbeat_paused_at: null,
      post_compression_pause_armed: false,
      post_compression_pause_armed_at: new Date('2026-06-06T12:01:00.000Z'),
      post_compression_pause_triggered_at: triggeredAt,
      post_compression_pause_reason: 'core_memory_compression_completed',
      main_agent_pre_model_yield_ms: 5000,
      updated_at: updatedAt,
      // prev.was_armed: pause was armed before this upsert => it really fired now
      pause_just_triggered: true
    }]]
  });

  const control = await persistence.triggerPostCompressionRuntimePause({
    identityKey: 'xiaoni',
    reason: 'core_memory_compression_completed'
  });

  assert.equal(control.pauseJustTriggered, true);
  assert.equal(control.enabled, false);
});

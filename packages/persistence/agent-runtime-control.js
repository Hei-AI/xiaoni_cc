'use strict';

const { serializeTimestampForApi } = require('./time');

function isTruthyDatabaseBoolean(value) {
  return value === true || value === 't' || value === 'true' || value === 1;
}

function normalizeRuntimeControl(row) {
  const rawMainAgentPreModelYieldMs = Number.parseInt(String(row?.main_agent_pre_model_yield_ms ?? ''), 10);
  const rawDebugCacheHeartbeatIntervalMs = Number.parseInt(String(row?.debug_cache_heartbeat_interval_ms ?? ''), 10);
  return {
    identityKey: row?.identity_key || 'xiaoni',
    enabled: row ? ![false, 'f', 'false', 0].includes(row.enabled) : true,
    cacheHeartbeatPaused: row ? isTruthyDatabaseBoolean(row.cache_heartbeat_paused) : false,
    cacheHeartbeatPausedAt: serializeTimestampForApi(row?.cache_heartbeat_paused_at),
    postCompressionPauseArmed: row ? isTruthyDatabaseBoolean(row.post_compression_pause_armed) : false,
    postCompressionPauseArmedAt: serializeTimestampForApi(row?.post_compression_pause_armed_at),
    postCompressionPauseTriggeredAt: serializeTimestampForApi(row?.post_compression_pause_triggered_at),
    postCompressionPauseReason: row?.post_compression_pause_reason || null,
    mainAgentPreModelYieldMs: Number.isFinite(rawMainAgentPreModelYieldMs) && rawMainAgentPreModelYieldMs >= 0
      ? rawMainAgentPreModelYieldMs
      : 5000,
    // 0 = off. Operator-set interval that fires a debug cache heartbeat on its own
    // timer (agent-service supervisor) so the prompt cache stays warm even while the
    // main loop is stopped for 停机debug — see modules/agent-service/src/index.ts.
    debugCacheHeartbeatIntervalMs: Number.isFinite(rawDebugCacheHeartbeatIntervalMs) && rawDebugCacheHeartbeatIntervalMs >= 0
      ? rawDebugCacheHeartbeatIntervalMs
      : 0,
    updatedAt: serializeTimestampForApi(row?.updated_at)
  };
}

function createAgentRuntimeControlPersistence(deps) {
  const { createSqlAdapter } = deps;
  const schemaEnsuredKeys = new Set();

  function schemaCacheKey(config = {}) {
    if (typeof config.databaseUrl === 'string' && config.databaseUrl.trim()) {
      return config.databaseUrl.trim();
    }
    return [
      config.host || process.env.DB_HOST || 'localhost',
      config.port || process.env.DB_PORT || '5432',
      config.database || process.env.DB_NAME || 'qqbot_db',
      config.user || process.env.DB_USER || 'qqbot_user'
    ].join('|');
  }

  async function ensureAgentRuntimeControlSchemaWithSql(sql, config = {}) {
    const cacheKey = schemaCacheKey(config);
    if (schemaEnsuredKeys.has(cacheKey)) {
      return;
    }
    await sql.execute(`
      CREATE TABLE IF NOT EXISTS agent_runtime_control (
        identity_key VARCHAR(191) PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        cache_heartbeat_paused BOOLEAN NOT NULL DEFAULT FALSE,
        cache_heartbeat_paused_at TIMESTAMPTZ(3),
        post_compression_pause_armed BOOLEAN NOT NULL DEFAULT FALSE,
        post_compression_pause_armed_at TIMESTAMPTZ(3),
        post_compression_pause_triggered_at TIMESTAMPTZ(3),
        post_compression_pause_reason TEXT,
        main_agent_pre_model_yield_ms INTEGER NOT NULL DEFAULT 5000,
        debug_cache_heartbeat_interval_ms INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await sql.execute('ALTER TABLE agent_runtime_control ADD COLUMN IF NOT EXISTS cache_heartbeat_paused BOOLEAN NOT NULL DEFAULT FALSE');
    await sql.execute('ALTER TABLE agent_runtime_control ADD COLUMN IF NOT EXISTS cache_heartbeat_paused_at TIMESTAMPTZ(3)');
    await sql.execute('ALTER TABLE agent_runtime_control ADD COLUMN IF NOT EXISTS post_compression_pause_armed BOOLEAN NOT NULL DEFAULT FALSE');
    await sql.execute('ALTER TABLE agent_runtime_control ADD COLUMN IF NOT EXISTS post_compression_pause_armed_at TIMESTAMPTZ(3)');
    await sql.execute('ALTER TABLE agent_runtime_control ADD COLUMN IF NOT EXISTS post_compression_pause_triggered_at TIMESTAMPTZ(3)');
    await sql.execute('ALTER TABLE agent_runtime_control ADD COLUMN IF NOT EXISTS post_compression_pause_reason TEXT');
    await sql.execute('ALTER TABLE agent_runtime_control ADD COLUMN IF NOT EXISTS main_agent_pre_model_yield_ms INTEGER NOT NULL DEFAULT 5000');
    await sql.execute('ALTER TABLE agent_runtime_control ADD COLUMN IF NOT EXISTS debug_cache_heartbeat_interval_ms INTEGER NOT NULL DEFAULT 0');
    await sql.execute(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'agent_runtime_control'
            AND column_name = 'cache_heartbeat_paused_at'
            AND data_type = 'timestamp without time zone'
        ) THEN
          ALTER TABLE agent_runtime_control
            ALTER COLUMN cache_heartbeat_paused_at TYPE TIMESTAMPTZ(3)
            USING cache_heartbeat_paused_at AT TIME ZONE 'Asia/Shanghai';
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'agent_runtime_control'
            AND column_name = 'post_compression_pause_armed_at'
            AND data_type = 'timestamp without time zone'
        ) THEN
          ALTER TABLE agent_runtime_control
            ALTER COLUMN post_compression_pause_armed_at TYPE TIMESTAMPTZ(3)
            USING post_compression_pause_armed_at AT TIME ZONE 'Asia/Shanghai';
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'agent_runtime_control'
            AND column_name = 'post_compression_pause_triggered_at'
            AND data_type = 'timestamp without time zone'
        ) THEN
          ALTER TABLE agent_runtime_control
            ALTER COLUMN post_compression_pause_triggered_at TYPE TIMESTAMPTZ(3)
            USING post_compression_pause_triggered_at AT TIME ZONE 'Asia/Shanghai';
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'agent_runtime_control'
            AND column_name = 'updated_at'
            AND data_type = 'timestamp without time zone'
        ) THEN
          ALTER TABLE agent_runtime_control
            ALTER COLUMN updated_at TYPE TIMESTAMPTZ(3)
            USING updated_at AT TIME ZONE 'Asia/Shanghai';
        END IF;
      END $$;
    `);
    schemaEnsuredKeys.add(cacheKey);
  }

  async function ensureAgentRuntimeControlSchema(config = {}) {
    const sql = createSqlAdapter(config);
    try {
      await ensureAgentRuntimeControlSchemaWithSql(sql, config);
    } finally {
      await sql.close();
    }
  }

  async function getAgentRuntimeControl(input = {}, config = {}) {
    const identityKey = typeof input.identityKey === 'string' && input.identityKey.trim()
      ? input.identityKey.trim()
      : 'xiaoni';
    const sql = createSqlAdapter(config);
    try {
      await ensureAgentRuntimeControlSchemaWithSql(sql, config);
      const rows = await sql.query(
        `
          SELECT identity_key, enabled, cache_heartbeat_paused, cache_heartbeat_paused_at, updated_at
            , post_compression_pause_armed
            , post_compression_pause_armed_at
            , post_compression_pause_triggered_at
            , post_compression_pause_reason
            , main_agent_pre_model_yield_ms
            , debug_cache_heartbeat_interval_ms
          FROM agent_runtime_control
          WHERE identity_key = ?
          LIMIT 1
        `,
        [identityKey]
      );
      return normalizeRuntimeControl(rows[0] || { identity_key: identityKey, enabled: true, updated_at: null });
    } finally {
      await sql.close();
    }
  }

  async function updateAgentRuntimeControl(input = {}, config = {}) {
    const identityKey = typeof input.identityKey === 'string' && input.identityKey.trim()
      ? input.identityKey.trim()
      : 'xiaoni';
    const sql = createSqlAdapter(config);
    try {
      await ensureAgentRuntimeControlSchemaWithSql(sql, config);
      const hasEnabled = typeof input.enabled === 'boolean';
      const hasCacheHeartbeatPaused = typeof input.cacheHeartbeatPaused === 'boolean'
        || typeof input.cache_heartbeat_paused === 'boolean';
      const cacheHeartbeatPaused = hasCacheHeartbeatPaused
        ? (input.cacheHeartbeatPaused ?? input.cache_heartbeat_paused) === true
        : false;
      const hasPostCompressionPauseArmed = typeof input.postCompressionPauseArmed === 'boolean'
        || typeof input.post_compression_pause_armed === 'boolean';
      const postCompressionPauseArmed = hasPostCompressionPauseArmed
        ? (input.postCompressionPauseArmed ?? input.post_compression_pause_armed) === true
        : false;
      const rawMainAgentPreModelYieldMs = input.mainAgentPreModelYieldMs ?? input.main_agent_pre_model_yield_ms;
      const parsedMainAgentPreModelYieldMs = Number.parseInt(String(rawMainAgentPreModelYieldMs ?? ''), 10);
      const hasMainAgentPreModelYieldMs = rawMainAgentPreModelYieldMs !== undefined
        && Number.isFinite(parsedMainAgentPreModelYieldMs)
        && parsedMainAgentPreModelYieldMs >= 0;
      const mainAgentPreModelYieldMs = hasMainAgentPreModelYieldMs
        ? parsedMainAgentPreModelYieldMs
        : 5000;
      const rawDebugCacheHeartbeatIntervalMs = input.debugCacheHeartbeatIntervalMs ?? input.debug_cache_heartbeat_interval_ms;
      const parsedDebugCacheHeartbeatIntervalMs = Number.parseInt(String(rawDebugCacheHeartbeatIntervalMs ?? ''), 10);
      const hasDebugCacheHeartbeatIntervalMs = rawDebugCacheHeartbeatIntervalMs !== undefined
        && Number.isFinite(parsedDebugCacheHeartbeatIntervalMs)
        && parsedDebugCacheHeartbeatIntervalMs >= 0;
      const debugCacheHeartbeatIntervalMs = hasDebugCacheHeartbeatIntervalMs
        ? parsedDebugCacheHeartbeatIntervalMs
        : 0;
      const enabled = hasEnabled ? input.enabled !== false : true;
      const rows = await sql.query(
        `
          INSERT INTO agent_runtime_control (
            identity_key,
            enabled,
            cache_heartbeat_paused,
            cache_heartbeat_paused_at,
            post_compression_pause_armed,
            post_compression_pause_armed_at,
            post_compression_pause_triggered_at,
            post_compression_pause_reason,
            main_agent_pre_model_yield_ms,
            debug_cache_heartbeat_interval_ms,
            updated_at
          )
          VALUES (
            ?,
            ?,
            ?,
            CASE WHEN ? THEN NOW() ELSE NULL END,
            ?,
            CASE WHEN ? THEN NOW() ELSE NULL END,
            NULL,
            NULL,
            ?,
            ?,
            NOW()
          )
          ON CONFLICT (identity_key)
          DO UPDATE SET
            enabled = CASE
              WHEN ? THEN ?
              ELSE agent_runtime_control.enabled
            END,
            cache_heartbeat_paused = CASE
              WHEN ? THEN ?
              ELSE agent_runtime_control.cache_heartbeat_paused
            END,
            cache_heartbeat_paused_at = CASE
              WHEN ? THEN
                CASE WHEN ? THEN NOW() ELSE NULL END
              ELSE agent_runtime_control.cache_heartbeat_paused_at
            END,
            post_compression_pause_armed = CASE
              WHEN ? THEN ?
              ELSE agent_runtime_control.post_compression_pause_armed
            END,
            post_compression_pause_armed_at = CASE
              WHEN ? THEN
                CASE WHEN ? THEN NOW() ELSE NULL END
              ELSE agent_runtime_control.post_compression_pause_armed_at
            END,
            post_compression_pause_triggered_at = CASE
              WHEN ? AND ? THEN NULL
              ELSE agent_runtime_control.post_compression_pause_triggered_at
            END,
            post_compression_pause_reason = CASE
              WHEN ? AND ? THEN NULL
              ELSE agent_runtime_control.post_compression_pause_reason
            END,
            main_agent_pre_model_yield_ms = CASE
              WHEN ? THEN ?
              ELSE agent_runtime_control.main_agent_pre_model_yield_ms
            END,
            debug_cache_heartbeat_interval_ms = CASE
              WHEN ? THEN ?
              ELSE agent_runtime_control.debug_cache_heartbeat_interval_ms
            END,
            updated_at = NOW()
          RETURNING identity_key, enabled, cache_heartbeat_paused, cache_heartbeat_paused_at, updated_at,
            post_compression_pause_armed,
            post_compression_pause_armed_at,
            post_compression_pause_triggered_at,
            post_compression_pause_reason,
            main_agent_pre_model_yield_ms,
            debug_cache_heartbeat_interval_ms
        `,
        [
          identityKey,
          enabled,
          cacheHeartbeatPaused,
          hasCacheHeartbeatPaused && cacheHeartbeatPaused,
          postCompressionPauseArmed,
          hasPostCompressionPauseArmed && postCompressionPauseArmed,
          mainAgentPreModelYieldMs,
          debugCacheHeartbeatIntervalMs,
          hasEnabled,
          enabled,
          hasCacheHeartbeatPaused,
          cacheHeartbeatPaused,
          hasCacheHeartbeatPaused,
          cacheHeartbeatPaused,
          hasPostCompressionPauseArmed,
          postCompressionPauseArmed,
          hasPostCompressionPauseArmed,
          postCompressionPauseArmed,
          hasPostCompressionPauseArmed,
          postCompressionPauseArmed,
          hasPostCompressionPauseArmed,
          postCompressionPauseArmed,
          hasMainAgentPreModelYieldMs,
          mainAgentPreModelYieldMs,
          hasDebugCacheHeartbeatIntervalMs,
          debugCacheHeartbeatIntervalMs
        ]
      );
      return normalizeRuntimeControl(rows[0]);
    } finally {
      await sql.close();
    }
  }

  async function triggerPostCompressionRuntimePause(input = {}, config = {}) {
    const identityKey = typeof input.identityKey === 'string' && input.identityKey.trim()
      ? input.identityKey.trim()
      : 'xiaoni';
    const reason = typeof input.reason === 'string' && input.reason.trim()
      ? input.reason.trim()
      : 'core_memory_compression_completed';
    const sql = createSqlAdapter(config);
    try {
      await ensureAgentRuntimeControlSchemaWithSql(sql, config);
      // `prev` captures whether the pause was armed BEFORE this upsert so callers
      // can tell an actual pause-this-call apart from a no-op (armed already
      // false). Without it, a committed compression on an unarmed/already-disabled
      // runtime falsely reads as "paused after compression" off a stale
      // triggered_at — the false-positive log that misled the 2026-06-28 incident.
      const rows = await sql.query(
        `
          WITH prev AS (
            SELECT post_compression_pause_armed AS was_armed
            FROM agent_runtime_control
            WHERE identity_key = ?
          )
          INSERT INTO agent_runtime_control (
            identity_key,
            enabled,
            post_compression_pause_armed,
            post_compression_pause_triggered_at,
            post_compression_pause_reason,
            updated_at
          )
          VALUES (?, TRUE, FALSE, NULL, NULL, NOW())
          ON CONFLICT (identity_key)
          DO UPDATE SET
            enabled = CASE
              WHEN agent_runtime_control.post_compression_pause_armed THEN FALSE
              ELSE agent_runtime_control.enabled
            END,
            post_compression_pause_triggered_at = CASE
              WHEN agent_runtime_control.post_compression_pause_armed THEN NOW()
              ELSE agent_runtime_control.post_compression_pause_triggered_at
            END,
            post_compression_pause_reason = CASE
              WHEN agent_runtime_control.post_compression_pause_armed THEN ?
              ELSE agent_runtime_control.post_compression_pause_reason
            END,
            post_compression_pause_armed = FALSE,
            updated_at = CASE
              WHEN agent_runtime_control.post_compression_pause_armed THEN NOW()
              ELSE agent_runtime_control.updated_at
            END
          RETURNING identity_key, enabled, cache_heartbeat_paused, cache_heartbeat_paused_at, updated_at,
            post_compression_pause_armed,
            post_compression_pause_armed_at,
            post_compression_pause_triggered_at,
            post_compression_pause_reason,
            main_agent_pre_model_yield_ms,
            debug_cache_heartbeat_interval_ms,
            (SELECT was_armed FROM prev) AS pause_just_triggered
        `,
        [identityKey, identityKey, reason]
      );
      const normalized = normalizeRuntimeControl(rows[0]);
      normalized.pauseJustTriggered = isTruthyDatabaseBoolean(rows[0] && rows[0].pause_just_triggered);
      return normalized;
    } finally {
      await sql.close();
    }
  }

  return {
    ensureAgentRuntimeControlSchema,
    getAgentRuntimeControl,
    updateAgentRuntimeControl,
    triggerPostCompressionRuntimePause
  };
}

module.exports = {
  createAgentRuntimeControlPersistence
};

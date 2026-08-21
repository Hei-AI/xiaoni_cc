'use strict';

const { serializeTimestampForApi } = require('./time');

function isTruthyDatabaseBoolean(value) {
  return value === true || value === 't' || value === 'true' || value === 1;
}

// jsonb columns may come back as a parsed object (prisma-backed adapters) or a
// raw JSON string (raw pg adapters). Normalize to a plain object or null.
function parseJsonObject(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeRuntimeControl(row) {
  const rawMainAgentPreModelYieldMs = Number.parseInt(String(row?.main_agent_pre_model_yield_ms ?? ''), 10);
  const rawDebugCacheHeartbeatIntervalMs = Number.parseInt(String(row?.debug_cache_heartbeat_interval_ms ?? ''), 10);
  const rawCompressionTriggerInputTokens = Number.parseInt(String(row?.compression_trigger_input_tokens ?? ''), 10);
  const rawCompressionTriggerWireBytes = Number.parseInt(String(row?.compression_trigger_wire_bytes ?? ''), 10);
  return {
    identityKey: row?.identity_key || 'xiaoni',
    enabled: row ? ![false, 'f', 'false', 0].includes(row.enabled) : true,
    cacheHeartbeatPaused: row ? isTruthyDatabaseBoolean(row.cache_heartbeat_paused) : false,
    cacheHeartbeatPausedAt: serializeTimestampForApi(row?.cache_heartbeat_paused_at),
    // Admin toggle: when true, agent-service scrubs the xiaoni_os note out of model-bound
    // requests (tool-call args + tool-result echo) while keeping it fully persisted/visible.
    // Dynamically applied (no restart). Default false = current behavior. See agent-loop-service
    // setStripXiaoniOsFromRequests / buildMainAgentCanonicalRequest.
    stripXiaoniOsFromRequests: row ? isTruthyDatabaseBoolean(row.strip_xiaoni_os_from_requests) : false,
    // Admin toggle: Step3 心理评估门控总开关。true 时每次 assistant 文本产出跑一个心理评估 fork
    // 判 KEEP/EVICT,消极→本 turn xiaoni_os 不进下一上下文(fail-closed)。动态热下发(无重启)。
    // 默认 false=OFF。翻 ON 前应先活体验 fork cache_read 暖读。见 agent-loop-service
    // setPsychAssessmentGateEnabled / runPsychAssessmentGate。
    psychAssessmentGateEnabled: row ? isTruthyDatabaseBoolean(row.psych_assessment_gate_enabled) : false,
    // Admin toggle: 自驱动 fork 的空转升级。true 时,连续空转达阈值会在【fork 的尾部追加段】告诉潜意识
    // 「上一份 plan 已连着 N 轮没被执行」并回贴那份 plan 原文,让它自己把语气写狠。动态热下发(无重启)。
    // 默认 false=OFF(行为逐字节零变化)。升级信号只进 fork 私有输入,绝不进主 agent 上下文、不写 stack。
    // 见 agent-loop-service setForkIdleEscalationEnabled / renderSubconsciousForkReminder。
    forkIdleEscalationEnabled: row ? isTruthyDatabaseBoolean(row.fork_idle_escalation_enabled) : false,
    // Admin toggle: plan 空转 run 作废。true 时,subconscious plan 触发且零产出的 run 整体从栈上删除
    // (当没发生过),上下文不再堆连续失败 plan。动态热下发(无重启)。默认 false=OFF(行为零变化)。
    // 见 docs/specs/xiaoni-plan-run-void-on-idle.md 与 agent-loop-service setPlanVoidOnIdleEnabled。
    planVoidOnIdleEnabled: row ? isTruthyDatabaseBoolean(row.plan_void_on_idle_enabled) : false,
    // Admin toggle: 自驱动 fork 的 plan 改由 `xiaoni-plan post` skill 提交(而不是从 final_answer 文本抠)。
    // ON 时 fork 的 allowedToolNames 放行 exec_command(命令层再白名单到 xiaoni-plan 一条)、尾部 reminder
    // 追加工具契约、纠正提示改成「必须用 skill 交」。OFF=今天的文本抽取路径,行为逐字节零变化。
    // 动态热下发(无重启)。见 docs/specs/xiaoni-plan-skill-submission.md。
    idlePlanSkillSubmissionEnabled: row ? isTruthyDatabaseBoolean(row.idle_plan_skill_submission_enabled) : false,
    // Admin toggle: 被动浮现投递闸。true 时 agent-service 把 open_loop / association 两条腿的
    // 召回 lead 经既有 Notify Bucket 投给她(在此之前整条召回链 shadow-only)。动态热下发(无重启)
    // —— 这是一个会**主动发东西给她**的通道,出问题必须能在管理端一键关掉,不能靠改 compose 重启。
    // 默认 false=OFF。见 modules/agent-service/src/services/xiaoni-recall-delivery.ts。
    passiveRecallDeliveryEnabled: row ? isTruthyDatabaseBoolean(row.passive_recall_delivery_enabled) : false,
    // 欠账指针通知(替代被撤出召回的欠账腿)。跟召回投递一样,它也会主动唤醒主 loop,
    // 所以「关得掉」必须是结构性事实 —— 不能只靠 compose 里的 env + 重启。
    openLoopsNotifyEnabled: row ? isTruthyDatabaseBoolean(row.open_loops_notify_enabled) : false,
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
    // 小腻's compression trigger: when the model's REAL input_tokens exceed this for
    // N consecutive turns, core memory compression fires (agent-loop-service). Admin-
    // configurable and dynamically applied (no restart). Timing-only — never enters the
    // cacheable request prefix. Default 80000 mirrors the historical hardcoded const.
    compressionTriggerInputTokens: Number.isFinite(rawCompressionTriggerInputTokens) && rawCompressionTriggerInputTokens > 0
      ? rawCompressionTriggerInputTokens
      : 80000,
    // 小腻's BYTE-side compression trigger: images are token-cheap but byte-huge, so the
    // token trigger above sits in a blind spot for image-heavy runs. When the estimated wire
    // request BYTES exceed this soft threshold on a run boundary, core memory compression
    // fires too (agent-loop-service), folding old images out before the request hits
    // Anthropic's hard 32MB per-request cap. Admin-configurable, dynamically applied (no
    // restart). Timing-only — never enters the cacheable request prefix. Default 24 MiB
    // leaves ~8MB headroom to the 32MB wall for the run's own new content + system/tools.
    compressionTriggerWireBytes: Number.isFinite(rawCompressionTriggerWireBytes) && rawCompressionTriggerWireBytes > 0
      ? rawCompressionTriggerWireBytes
      : 25165824,
    // Partial energy-policy overrides object (or null = all code defaults). Merged over the
    // agent-service DEFAULT_RECOVER_ENERGY_POLICY at read time. See energy_policy_json column.
    energyPolicy: parseJsonObject(row?.energy_policy_json),
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
        compression_trigger_input_tokens INTEGER NOT NULL DEFAULT 80000,
        compression_trigger_wire_bytes BIGINT NOT NULL DEFAULT 25165824,
        strip_xiaoni_os_from_requests BOOLEAN NOT NULL DEFAULT FALSE,
        psych_assessment_gate_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        fork_idle_escalation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        plan_void_on_idle_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        idle_plan_skill_submission_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        passive_recall_delivery_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        open_loops_notify_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        energy_policy_json JSONB,
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
    await sql.execute('ALTER TABLE agent_runtime_control ADD COLUMN IF NOT EXISTS compression_trigger_input_tokens INTEGER NOT NULL DEFAULT 80000');
    await sql.execute('ALTER TABLE agent_runtime_control ADD COLUMN IF NOT EXISTS compression_trigger_wire_bytes BIGINT NOT NULL DEFAULT 25165824');
    await sql.execute('ALTER TABLE agent_runtime_control ADD COLUMN IF NOT EXISTS strip_xiaoni_os_from_requests BOOLEAN NOT NULL DEFAULT FALSE');
    await sql.execute('ALTER TABLE agent_runtime_control ADD COLUMN IF NOT EXISTS psych_assessment_gate_enabled BOOLEAN NOT NULL DEFAULT FALSE');
    await sql.execute('ALTER TABLE agent_runtime_control ADD COLUMN IF NOT EXISTS fork_idle_escalation_enabled BOOLEAN NOT NULL DEFAULT FALSE');
    await sql.execute('ALTER TABLE agent_runtime_control ADD COLUMN IF NOT EXISTS plan_void_on_idle_enabled BOOLEAN NOT NULL DEFAULT FALSE');
    await sql.execute('ALTER TABLE agent_runtime_control ADD COLUMN IF NOT EXISTS idle_plan_skill_submission_enabled BOOLEAN NOT NULL DEFAULT FALSE');
    await sql.execute('ALTER TABLE agent_runtime_control ADD COLUMN IF NOT EXISTS passive_recall_delivery_enabled BOOLEAN NOT NULL DEFAULT FALSE');
    await sql.execute('ALTER TABLE agent_runtime_control ADD COLUMN IF NOT EXISTS open_loops_notify_enabled BOOLEAN NOT NULL DEFAULT FALSE');
    // Admin-configurable energy policy overrides (partial RecoverEnergyPolicy + actionCostScale).
    // NULL = use agent-service code defaults. Dynamically applied (no restart); read by the
    // agent-service life-projection/recovery paths. Energy is runtime-internal — it NEVER enters
    // the cacheable LLM request prefix, so changing it has zero prompt-cache impact.
    await sql.execute('ALTER TABLE agent_runtime_control ADD COLUMN IF NOT EXISTS energy_policy_json JSONB');
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
            , compression_trigger_input_tokens
            , compression_trigger_wire_bytes
            , strip_xiaoni_os_from_requests
            , psych_assessment_gate_enabled
            , fork_idle_escalation_enabled
            , plan_void_on_idle_enabled
            , idle_plan_skill_submission_enabled
            , passive_recall_delivery_enabled
            , open_loops_notify_enabled
            , energy_policy_json
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
      const rawCompressionTriggerInputTokens = input.compressionTriggerInputTokens ?? input.compression_trigger_input_tokens;
      const parsedCompressionTriggerInputTokens = Number.parseInt(String(rawCompressionTriggerInputTokens ?? ''), 10);
      const hasCompressionTriggerInputTokens = rawCompressionTriggerInputTokens !== undefined
        && Number.isFinite(parsedCompressionTriggerInputTokens)
        && parsedCompressionTriggerInputTokens > 0;
      const compressionTriggerInputTokens = hasCompressionTriggerInputTokens
        ? parsedCompressionTriggerInputTokens
        : 80000;
      const rawCompressionTriggerWireBytes = input.compressionTriggerWireBytes ?? input.compression_trigger_wire_bytes;
      const parsedCompressionTriggerWireBytes = Number.parseInt(String(rawCompressionTriggerWireBytes ?? ''), 10);
      const hasCompressionTriggerWireBytes = rawCompressionTriggerWireBytes !== undefined
        && Number.isFinite(parsedCompressionTriggerWireBytes)
        && parsedCompressionTriggerWireBytes > 0;
      const compressionTriggerWireBytes = hasCompressionTriggerWireBytes
        ? parsedCompressionTriggerWireBytes
        : 25165824;
      const hasStripXiaoniOsFromRequests = typeof input.stripXiaoniOsFromRequests === 'boolean'
        || typeof input.strip_xiaoni_os_from_requests === 'boolean';
      const stripXiaoniOsFromRequests = hasStripXiaoniOsFromRequests
        ? (input.stripXiaoniOsFromRequests ?? input.strip_xiaoni_os_from_requests) === true
        : false;
      const hasPsychAssessmentGateEnabled = typeof input.psychAssessmentGateEnabled === 'boolean'
        || typeof input.psych_assessment_gate_enabled === 'boolean';
      const psychAssessmentGateEnabled = hasPsychAssessmentGateEnabled
        ? (input.psychAssessmentGateEnabled ?? input.psych_assessment_gate_enabled) === true
        : false;
      const hasForkIdleEscalationEnabled = typeof input.forkIdleEscalationEnabled === 'boolean'
        || typeof input.fork_idle_escalation_enabled === 'boolean';
      const forkIdleEscalationEnabled = hasForkIdleEscalationEnabled
        ? (input.forkIdleEscalationEnabled ?? input.fork_idle_escalation_enabled) === true
        : false;
      const hasPlanVoidOnIdleEnabled = typeof input.planVoidOnIdleEnabled === 'boolean'
        || typeof input.plan_void_on_idle_enabled === 'boolean';
      const planVoidOnIdleEnabled = hasPlanVoidOnIdleEnabled
        ? (input.planVoidOnIdleEnabled ?? input.plan_void_on_idle_enabled) === true
        : false;
      const hasIdlePlanSkillSubmissionEnabled = typeof input.idlePlanSkillSubmissionEnabled === 'boolean'
        || typeof input.idle_plan_skill_submission_enabled === 'boolean';
      const idlePlanSkillSubmissionEnabled = hasIdlePlanSkillSubmissionEnabled
        ? (input.idlePlanSkillSubmissionEnabled ?? input.idle_plan_skill_submission_enabled) === true
        : false;
      const hasPassiveRecallDeliveryEnabled = typeof input.passiveRecallDeliveryEnabled === 'boolean'
        || typeof input.passive_recall_delivery_enabled === 'boolean';
      const passiveRecallDeliveryEnabled = hasPassiveRecallDeliveryEnabled
        ? (input.passiveRecallDeliveryEnabled ?? input.passive_recall_delivery_enabled) === true
        : false;
      const hasOpenLoopsNotifyEnabled = typeof input.openLoopsNotifyEnabled === 'boolean'
        || typeof input.open_loops_notify_enabled === 'boolean';
      const openLoopsNotifyEnabled = hasOpenLoopsNotifyEnabled
        ? (input.openLoopsNotifyEnabled ?? input.open_loops_notify_enabled) === true
        : false;
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
            compression_trigger_input_tokens,
            compression_trigger_wire_bytes,
            strip_xiaoni_os_from_requests,
            psych_assessment_gate_enabled,
            fork_idle_escalation_enabled,
            plan_void_on_idle_enabled,
            idle_plan_skill_submission_enabled,
            passive_recall_delivery_enabled,
            open_loops_notify_enabled,
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
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
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
            compression_trigger_input_tokens = CASE
              WHEN ? THEN ?
              ELSE agent_runtime_control.compression_trigger_input_tokens
            END,
            compression_trigger_wire_bytes = CASE
              WHEN ? THEN ?
              ELSE agent_runtime_control.compression_trigger_wire_bytes
            END,
            strip_xiaoni_os_from_requests = CASE
              WHEN ? THEN ?
              ELSE agent_runtime_control.strip_xiaoni_os_from_requests
            END,
            psych_assessment_gate_enabled = CASE
              WHEN ? THEN ?
              ELSE agent_runtime_control.psych_assessment_gate_enabled
            END,
            fork_idle_escalation_enabled = CASE
              WHEN ? THEN ?
              ELSE agent_runtime_control.fork_idle_escalation_enabled
            END,
            plan_void_on_idle_enabled = CASE
              WHEN ? THEN ?
              ELSE agent_runtime_control.plan_void_on_idle_enabled
            END,
            idle_plan_skill_submission_enabled = CASE
              WHEN ? THEN ?
              ELSE agent_runtime_control.idle_plan_skill_submission_enabled
            END,
            passive_recall_delivery_enabled = CASE
              WHEN ? THEN ?
              ELSE agent_runtime_control.passive_recall_delivery_enabled
            END,
            open_loops_notify_enabled = CASE
              WHEN ? THEN ?
              ELSE agent_runtime_control.open_loops_notify_enabled
            END,
            updated_at = NOW()
          RETURNING identity_key, enabled, cache_heartbeat_paused, cache_heartbeat_paused_at, updated_at,
            post_compression_pause_armed,
            post_compression_pause_armed_at,
            post_compression_pause_triggered_at,
            post_compression_pause_reason,
            main_agent_pre_model_yield_ms,
            debug_cache_heartbeat_interval_ms,
            compression_trigger_input_tokens,
            compression_trigger_wire_bytes,
            strip_xiaoni_os_from_requests,
            psych_assessment_gate_enabled,
            fork_idle_escalation_enabled,
            plan_void_on_idle_enabled,
            idle_plan_skill_submission_enabled,
            passive_recall_delivery_enabled,
            open_loops_notify_enabled
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
          compressionTriggerInputTokens,
          compressionTriggerWireBytes,
          stripXiaoniOsFromRequests,
          psychAssessmentGateEnabled,
          forkIdleEscalationEnabled,
          planVoidOnIdleEnabled,
          idlePlanSkillSubmissionEnabled,
          passiveRecallDeliveryEnabled,
          openLoopsNotifyEnabled,
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
          debugCacheHeartbeatIntervalMs,
          hasCompressionTriggerInputTokens,
          compressionTriggerInputTokens,
          hasCompressionTriggerWireBytes,
          compressionTriggerWireBytes,
          hasStripXiaoniOsFromRequests,
          stripXiaoniOsFromRequests,
          hasPsychAssessmentGateEnabled,
          psychAssessmentGateEnabled,
          hasForkIdleEscalationEnabled,
          forkIdleEscalationEnabled,
          hasPlanVoidOnIdleEnabled,
          planVoidOnIdleEnabled,
          hasIdlePlanSkillSubmissionEnabled,
          idlePlanSkillSubmissionEnabled,
          hasPassiveRecallDeliveryEnabled,
          passiveRecallDeliveryEnabled,
          hasOpenLoopsNotifyEnabled,
          openLoopsNotifyEnabled
        ]
      );
      return normalizeRuntimeControl(rows[0]);
    } finally {
      await sql.close();
    }
  }

  // Focused writer for the admin-configurable energy policy overrides. Kept separate from the
  // giant updateAgentRuntimeControl upsert so the energy page can PUT just this column without
  // touching the run switch / heartbeat / compression knobs. Pass energyPolicy=null to clear
  // (revert to code defaults). Energy is runtime-internal → zero prompt-cache impact.
  async function setAgentEnergyPolicy(input = {}, config = {}) {
    const identityKey = typeof input.identityKey === 'string' && input.identityKey.trim()
      ? input.identityKey.trim()
      : 'xiaoni';
    const overrides = parseJsonObject(input.energyPolicy);
    const jsonParam = overrides && Object.keys(overrides).length > 0 ? JSON.stringify(overrides) : null;
    const sql = createSqlAdapter(config);
    try {
      await ensureAgentRuntimeControlSchemaWithSql(sql, config);
      const rows = await sql.query(
        `
          INSERT INTO agent_runtime_control (identity_key, enabled, energy_policy_json, updated_at)
          VALUES (?, TRUE, ?::jsonb, NOW())
          ON CONFLICT (identity_key)
          DO UPDATE SET
            energy_policy_json = ?::jsonb,
            updated_at = NOW()
          RETURNING identity_key, enabled, cache_heartbeat_paused, cache_heartbeat_paused_at, updated_at,
            post_compression_pause_armed, post_compression_pause_armed_at,
            post_compression_pause_triggered_at, post_compression_pause_reason,
            main_agent_pre_model_yield_ms, debug_cache_heartbeat_interval_ms,
            compression_trigger_input_tokens, compression_trigger_wire_bytes,
            strip_xiaoni_os_from_requests, psych_assessment_gate_enabled, energy_policy_json
        `,
        [identityKey, jsonParam, jsonParam]
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
            compression_trigger_input_tokens,
            compression_trigger_wire_bytes,
            strip_xiaoni_os_from_requests,
            psych_assessment_gate_enabled,
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

  // Emergency valve: real input_tokens ran past (compression_trigger + margin) for enough consecutive
  // turns, i.e. compression had its shot at the trigger and did NOT bring the epoch down — a genuinely
  // stalled/failed compression, independent of the read-window fix. Rather than let context climb toward
  // the model's hard context ceiling and hard-error, HALT the run switch (enabled=FALSE) and keep the
  // cache heartbeat ticking so the warm prefix survives for a clean manual resume. Idempotent via
  // `was_enabled`: only the first over-line turn flips the switch; re-checks each turn are no-ops.
  async function haltRuntimeForCompressionOverrun(input = {}, config = {}) {
    const identityKey = typeof input.identityKey === 'string' && input.identityKey.trim()
      ? input.identityKey.trim()
      : 'xiaoni';
    const reason = typeof input.reason === 'string' && input.reason.trim()
      ? input.reason.trim()
      : 'compression_overrun';
    const rawHeartbeatIntervalMs = input.heartbeatIntervalMs ?? input.heartbeat_interval_ms;
    const parsedHeartbeatIntervalMs = Number.parseInt(String(rawHeartbeatIntervalMs ?? ''), 10);
    const heartbeatIntervalMs = Number.isFinite(parsedHeartbeatIntervalMs) && parsedHeartbeatIntervalMs > 0
      ? parsedHeartbeatIntervalMs
      : 300000;
    const sql = createSqlAdapter(config);
    try {
      await ensureAgentRuntimeControlSchemaWithSql(sql, config);
      const rows = await sql.query(
        `
          WITH prev AS (
            SELECT enabled AS was_enabled FROM agent_runtime_control WHERE identity_key = ?
          )
          INSERT INTO agent_runtime_control (
            identity_key, enabled, cache_heartbeat_paused,
            post_compression_pause_triggered_at, post_compression_pause_reason,
            debug_cache_heartbeat_interval_ms, updated_at
          )
          VALUES (?, FALSE, FALSE, NOW(), ?, ?, NOW())
          ON CONFLICT (identity_key)
          DO UPDATE SET
            enabled = FALSE,
            cache_heartbeat_paused = FALSE,
            post_compression_pause_triggered_at = CASE
              WHEN agent_runtime_control.enabled THEN NOW()
              ELSE agent_runtime_control.post_compression_pause_triggered_at
            END,
            post_compression_pause_reason = CASE
              WHEN agent_runtime_control.enabled THEN ?
              ELSE agent_runtime_control.post_compression_pause_reason
            END,
            debug_cache_heartbeat_interval_ms = CASE
              WHEN COALESCE(agent_runtime_control.debug_cache_heartbeat_interval_ms, 0) > 0
                THEN agent_runtime_control.debug_cache_heartbeat_interval_ms
              ELSE ?
            END,
            updated_at = NOW()
          RETURNING identity_key, enabled, cache_heartbeat_paused, cache_heartbeat_paused_at, updated_at,
            post_compression_pause_armed, post_compression_pause_armed_at,
            post_compression_pause_triggered_at, post_compression_pause_reason,
            main_agent_pre_model_yield_ms, debug_cache_heartbeat_interval_ms, compression_trigger_input_tokens,
            compression_trigger_wire_bytes,
            strip_xiaoni_os_from_requests,
            psych_assessment_gate_enabled,
            (SELECT was_enabled FROM prev) AS was_enabled
        `,
        [identityKey, identityKey, reason, heartbeatIntervalMs, reason, heartbeatIntervalMs]
      );
      const normalized = normalizeRuntimeControl(rows[0]);
      normalized.haltJustTriggered = isTruthyDatabaseBoolean(rows[0] && rows[0].was_enabled);
      return normalized;
    } finally {
      await sql.close();
    }
  }

  return {
    ensureAgentRuntimeControlSchema,
    getAgentRuntimeControl,
    updateAgentRuntimeControl,
    setAgentEnergyPolicy,
    triggerPostCompressionRuntimePause,
    haltRuntimeForCompressionOverrun
  };
}

module.exports = {
  createAgentRuntimeControlPersistence
};

'use strict';

const { randomUUID } = require('crypto');
const { serializeTimestampForApi } = require('./time');

const COMMON_RUNTIME_DDLS = [
  'DROP TABLE IF EXISTS llm_call_logs CASCADE',
  'DROP TABLE IF EXISTS tool_execution_logs CASCADE',
  'DROP TABLE IF EXISTS xiaoni_replay_events CASCADE',
  `
    CREATE TABLE IF NOT EXISTS agent_queue_messages (
      id BIGSERIAL PRIMARY KEY,
      trace_id VARCHAR(128) NOT NULL,
      batch_id VARCHAR(128),
      run_id VARCHAR(128),
      source VARCHAR(32) NOT NULL,
      message_sid VARCHAR(191) NOT NULL,
      dedupe_key VARCHAR(255) NOT NULL UNIQUE,
      chat_type VARCHAR(16) NOT NULL,
      session_key VARCHAR(191) NOT NULL,
      peer_id VARCHAR(191) NOT NULL,
      peer_name VARCHAR(255),
      sender_id VARCHAR(191) NOT NULL,
      sender_name VARCHAR(255),
      account_id VARCHAR(191) NOT NULL,
      body_for_agent TEXT NOT NULL,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      inbound_context JSONB NOT NULL DEFAULT '{}'::jsonb,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      available_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      locked_at TIMESTAMPTZ(3),
      locked_by VARCHAR(128),
      processing_started_at TIMESTAMPTZ(3),
      completed_at TIMESTAMPTZ(3),
      error_message TEXT,
      result JSONB,
      created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    ALTER TABLE agent_queue_messages
      ADD COLUMN IF NOT EXISTS batch_id VARCHAR(128),
      ADD COLUMN IF NOT EXISTS run_id VARCHAR(128)
  `,
  `
    CREATE TABLE IF NOT EXISTS agent_message_batches (
      id VARCHAR(128) PRIMARY KEY,
      trace_id VARCHAR(128) NOT NULL,
      session_key VARCHAR(191) NOT NULL,
      chat_type VARCHAR(16) NOT NULL,
      peer_id VARCHAR(191) NOT NULL,
      peer_name VARCHAR(255),
      account_id VARCHAR(191) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      reason_for_start VARCHAR(64),
      input_message_count INTEGER NOT NULL DEFAULT 0,
      summary TEXT,
      processing_started_at TIMESTAMPTZ(3),
      completed_at TIMESTAMPTZ(3),
      created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS agent_message_batch_items (
      id BIGSERIAL PRIMARY KEY,
      batch_id VARCHAR(128) NOT NULL,
      queue_message_id BIGINT NOT NULL,
      inbound_message_id BIGINT NOT NULL,
      message_sid VARCHAR(191),
      position INTEGER NOT NULL,
      created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS agent_runs (
      id VARCHAR(128) PRIMARY KEY,
      batch_id VARCHAR(128) NOT NULL,
      trace_id VARCHAR(128) NOT NULL,
      session_key VARCHAR(191) NOT NULL,
      chat_type VARCHAR(16) NOT NULL,
      peer_id VARCHAR(191) NOT NULL,
      peer_name VARCHAR(255),
      account_id VARCHAR(191) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      termination_reason VARCHAR(64),
      finish_reason TEXT,
      finish_outcome TEXT,
      no_reply BOOLEAN NOT NULL DEFAULT FALSE,
      final_response TEXT,
      sent_messages JSONB,
      total_turns INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      started_at TIMESTAMPTZ(3),
      completed_at TIMESTAMPTZ(3),
      created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS llm_jobs (
      id BIGSERIAL PRIMARY KEY,
      job_id VARCHAR(128) NOT NULL UNIQUE,
      trace_id VARCHAR(128) NOT NULL,
      session_id VARCHAR(191),
      agent_type VARCHAR(64),
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      final_response TEXT,
      error_message TEXT,
      total_turns INTEGER NOT NULL DEFAULT 0,
      metadata JSONB,
      started_at TIMESTAMPTZ(3),
      completed_at TIMESTAMPTZ(3),
      created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  'CREATE INDEX IF NOT EXISTS idx_agent_queue_pending_available ON agent_queue_messages (status, available_at, id)',
  'CREATE INDEX IF NOT EXISTS idx_agent_queue_session_pending ON agent_queue_messages (session_key, status, available_at, id)',
  'CREATE INDEX IF NOT EXISTS idx_agent_queue_trace_created ON agent_queue_messages (trace_id, created_at, id)',
  'CREATE INDEX IF NOT EXISTS idx_agent_runs_session_created ON agent_runs (session_key, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_agent_runs_trace_id ON agent_runs (trace_id)',
  'CREATE INDEX IF NOT EXISTS idx_agent_batches_session_created ON agent_message_batches (session_key, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_agent_batch_items_batch_position ON agent_message_batch_items (batch_id, position)',
  'CREATE INDEX IF NOT EXISTS idx_llm_jobs_trace_created ON llm_jobs (trace_id, created_at, id)'
];

const TRANSCRIPT_SNAPSHOT_DDLS = [
  `
    CREATE TABLE IF NOT EXISTS chat_transcript_snapshots (
      session_id VARCHAR(191) PRIMARY KEY,
      chat_type VARCHAR(16) NOT NULL,
      private_user_id BIGINT NULL,
      group_id BIGINT NULL,
      summary_text TEXT NOT NULL,
      summary_format_version VARCHAR(32) NOT NULL,
      summary_status VARCHAR(16) NOT NULL DEFAULT 'ready',
      summary_job_id VARCHAR(128) NULL,
      last_compacted_at TIMESTAMPTZ(3) NULL,
      created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  'CREATE INDEX IF NOT EXISTS idx_chat_transcript_snapshots_private_user ON chat_transcript_snapshots (private_user_id, updated_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_chat_transcript_snapshots_group ON chat_transcript_snapshots (group_id, updated_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_chat_transcript_snapshots_status ON chat_transcript_snapshots (summary_status, updated_at DESC)'
];

const AGENT_RUNTIME_EXTRA_DDLS = [
  ...TRANSCRIPT_SNAPSHOT_DDLS,
  // conversation_items table retired (P5): no longer created/indexed; the runtime never reads it.
  `
    CREATE TABLE IF NOT EXISTS agent_session_context_windows (
      session_key VARCHAR(191) PRIMARY KEY,
      read_cutoff_after_stack_index BIGINT,
      last_context_window_tokens INTEGER,
      last_target_budget_tokens INTEGER,
      last_hard_budget_tokens INTEGER,
      context_summary TEXT,
      pending_proactive_share TEXT,
      pending_proactive_share_age INTEGER DEFAULT 0,
      consecutive_over_compression_turns INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS delivery_phase TEXT NOT NULL DEFAULT 'reasoning_open'`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS delivery_commit_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS blocked_delivery_attempt_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS last_blocked_delivery_reason TEXT`,
  `ALTER TABLE agent_session_context_windows ADD COLUMN IF NOT EXISTS pending_proactive_share TEXT`,
  `ALTER TABLE agent_session_context_windows ADD COLUMN IF NOT EXISTS pending_proactive_share_age INTEGER DEFAULT 0`,
  // Persist the compression-trigger debounce counter (consecutive main turns whose
  // real input_tokens exceeded COMPRESSION_TRIGGER_INPUT_TOKENS). It used to be in-memory
  // only and zeroed on every agent-service restart, so frequent deploys kept compression
  // from ever reaching its consecutive-turn threshold. TIMING-ONLY: it decides WHEN
  // compression fires; it never enters the cacheable request prefix.
  `ALTER TABLE agent_session_context_windows ADD COLUMN IF NOT EXISTS consecutive_over_compression_turns INTEGER NOT NULL DEFAULT 0`,
  // Stack-native read cutoff: the agent runtime no longer counts conversations — the
  // retained-context boundary is a stack_index (one agent_stack_item). conversation_id
  // stays as a dead external-linkage column only. See project_remove_conversation_concept.
  `ALTER TABLE agent_session_context_windows ADD COLUMN IF NOT EXISTS read_cutoff_after_stack_index BIGINT`,
  // ONE-TIME MAPPING MIGRATION (idempotent, one-time): translate the legacy
  // conversation_id cutoff to its EXACT stack_index equivalent so the retained tail is
  // byte-identical to today (blocks with stack_index > mapped == blocks with
  // conversation_id > old cutoff). The `read_cutoff_after_stack_index IS NULL` guard makes
  // it fire only once: once filled here (or recomputed by compression in stack space) it is
  // never overwritten. The runtime reads conversation_id ONLY here, at migration; never again.
  // one-time conversation_id→stack_index cutoff migration retired (P5): completed long ago
  // (guard matched 0 rows) and referenced the now-dropped conversation_id columns.
  'CREATE INDEX IF NOT EXISTS idx_agent_session_context_windows_updated ON agent_session_context_windows (updated_at DESC)'
];

function normalizeJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return fallback;
}

function parseJson(value, fallback = {}) {
  if (value === null || typeof value === 'undefined') {
    return fallback;
  }
  if (value && typeof value === 'object') {
    return value;
  }
  if (typeof value !== 'string') {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeNumberArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.trunc(item))));
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)));
}

function toNumericConversationId(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildTranscriptSessionId(userId, groupId) {
  if (groupId && Number.isFinite(Number(groupId))) {
    return `group:${Number(groupId)}`;
  }
  return `private:${Number(userId)}`;
}

function normalizeDeliveryPhase(value) {
  if (value === 'delivery_committed' || value === 'lease_released') {
    return value;
  }
  if (value === 'finished') {
    return 'lease_released';
  }
  return 'reasoning_open';
}

function mapExecutionLeaseDeliveryState(row) {
  return {
    deliveryPhase: normalizeDeliveryPhase(row?.delivery_phase),
    deliveryCommitCount: Number(row?.delivery_commit_count || 0),
    blockedDeliveryAttemptCount: Number(row?.blocked_delivery_attempt_count || 0),
    lastBlockedDeliveryReason: typeof row?.last_blocked_delivery_reason === 'string' && row.last_blocked_delivery_reason.trim().length > 0
      ? row.last_blocked_delivery_reason
      : null
  };
}

function mapSessionReadCutoffState(row) {
  if (!row) {
    return null;
  }
  return {
    sessionKey: row.session_key,
    readCutoffAfterStackIndex: row.read_cutoff_after_stack_index === null || typeof row.read_cutoff_after_stack_index === 'undefined' ? null : Number(row.read_cutoff_after_stack_index),
    lastContextWindowTokens: row.last_context_window_tokens === null ? null : Number(row.last_context_window_tokens),
    lastTargetBudgetTokens: row.last_target_budget_tokens === null ? null : Number(row.last_target_budget_tokens),
    lastHardBudgetTokens: row.last_hard_budget_tokens === null ? null : Number(row.last_hard_budget_tokens),
    contextSummary: row.context_summary ?? null,
    pendingProactiveShare: row.pending_proactive_share ?? null,
    pendingProactiveShareAge: row.pending_proactive_share_age === null ? 0 : Number(row.pending_proactive_share_age),
    consecutiveOverCompressionTurns: row.consecutive_over_compression_turns == null ? 0 : Number(row.consecutive_over_compression_turns),
    updatedAt: toIso(row.updated_at)
  };
}

function toIso(value) {
  return serializeTimestampForApi(value);
}

function normalizeTimestamp(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function createAgentRuntimePersistence({ createSqlAdapter, sqlAdapter } = {}) {
  function createSql(input = {}, config = {}) {
    if (input?.sqlAdapter) {
      return { sql: input.sqlAdapter, shouldClose: false };
    }
    if (sqlAdapter) {
      return { sql: sqlAdapter, shouldClose: false };
    }
    if (typeof createSqlAdapter !== 'function') {
      throw new Error('agent runtime SQL operations require createSqlAdapter');
    }
    return { sql: createSqlAdapter(config), shouldClose: true };
  }

  async function withSql(input, config, callback) {
    const { sql, shouldClose } = createSql(input, config);
    try {
      return await callback(sql);
    } finally {
      if (shouldClose) {
        await sql.close();
      }
    }
  }

  async function executeDdls(sql, statements) {
    for (const statement of statements) {
      try {
        await sql.execute(statement);
      } catch (error) {
        if (error?.code === '42P07' || error?.code === '42710') {
          continue;
        }
        throw error;
      }
    }
  }

  async function ensureAgentRuntimeSchema(input = {}, config = {}) {
    await withSql(input, config, async (sql) => {
      await executeDdls(sql, COMMON_RUNTIME_DDLS);
      if (input.includeAgentExtras || input.profile === 'agent') {
        await executeDdls(sql, AGENT_RUNTIME_EXTRA_DDLS);
      }
    });
  }

  async function ensureTranscriptSnapshotSchema(input = {}, config = {}) {
    await withSql(input, config, async (sql) => {
      await executeDdls(sql, TRANSCRIPT_SNAPSHOT_DDLS);
    });
  }

  async function logRuntimeTimelineEvent(input = {}, config = {}) {
    await withSql(input, config, async (sql) => {
      await sql.insert(
        `
          INSERT INTO timeline_events (
            trace_id,
            event_type,
            event_name,
            event_phase,
            component,
            duration_ms,
            metadata
          )
          VALUES (?, ?, ?, ?, ?, ?, ?::jsonb)
        `,
        [
          input.traceId,
          input.eventType,
          input.eventName,
          input.eventPhase ?? null,
          input.component || 'agent-service',
          input.durationMs ?? null,
          JSON.stringify(normalizeJsonObject(input.metadata))
        ]
      );
    });
  }

  async function recoverStaleProcessingLeases(input = {}, config = {}) {
    const staleMs = Math.max(60_000, Number(input.staleMs || input.stale_ms || 0));
    const staleBefore = new Date(Date.now() - staleMs);
    const errorMessage = `${input.reason}: processing run older than ${staleMs}ms`;
    return withSql(input, config, (sql) => sql.withTransaction(async (tx) => {
      const committedRunRows = await tx.query(
        `
          SELECT id
          FROM agent_runs
          WHERE status = 'processing'
            AND started_at < ?
            AND (
              delivery_phase = 'delivery_committed'
              OR COALESCE(delivery_commit_count, 0) > 0
            )
          FOR UPDATE
        `,
        [staleBefore]
      );
      const committedRunIds = committedRunRows.map((row) => row.id).filter(Boolean);

      let settledRuns = 0;
      let settledQueueMessages = 0;
      if (committedRunIds.length > 0) {
        const placeholders = committedRunIds.map(() => '?').join(', ');
        settledRuns = await tx.execute(
          `
            UPDATE agent_runs
            SET status = 'settled',
                delivery_phase = 'lease_released',
                termination_reason = 'processing_recovery_visible_delivery_committed',
                finish_reason = ?,
                finish_outcome = 'processing_recovery_after_visible_delivery',
                no_reply = FALSE,
                error_message = NULL,
                completed_at = COALESCE(completed_at, NOW()),
                updated_at = NOW()
            WHERE id IN (${placeholders})
          `,
          [errorMessage, ...committedRunIds]
        );
        settledQueueMessages = await tx.execute(
          `
            UPDATE agent_queue_messages
            SET status = 'settled',
                error_message = NULL,
                completed_at = COALESCE(completed_at, NOW()),
                updated_at = NOW()
            WHERE status = 'processing'
              AND run_id IN (${placeholders})
          `,
          committedRunIds
        );
        await tx.execute(
          `
            UPDATE agent_message_batches
            SET status = 'settled',
                completed_at = COALESCE(completed_at, NOW()),
                updated_at = NOW()
            WHERE id IN (
              SELECT batch_id
              FROM agent_runs
              WHERE id IN (${placeholders})
            )
          `,
          committedRunIds
        );
      }

      const failedRunRows = await tx.query(
        `
          SELECT id
          FROM agent_runs
          WHERE status = 'processing'
            AND started_at < ?
          FOR UPDATE
        `,
        [staleBefore]
      );
      const failedRunIds = failedRunRows.map((row) => row.id).filter(Boolean);

      let failedRuns = 0;
      let failedQueueMessages = 0;
      if (failedRunIds.length > 0) {
        const placeholders = failedRunIds.map(() => '?').join(', ');
        failedRuns = await tx.execute(
          `
            UPDATE agent_runs
            SET status = 'failed',
                termination_reason = 'processing_recovery_stale_processing',
                finish_reason = ?,
                finish_outcome = 'processing_recovery_as_failed',
                error_message = ?,
                completed_at = COALESCE(completed_at, NOW()),
                updated_at = NOW()
            WHERE id IN (${placeholders})
          `,
          [errorMessage, errorMessage, ...failedRunIds]
        );
        failedQueueMessages = await tx.execute(
          `
            UPDATE agent_queue_messages
            SET status = 'failed',
                error_message = ?,
                completed_at = COALESCE(completed_at, NOW()),
                updated_at = NOW()
            WHERE status = 'processing'
              AND run_id IN (${placeholders})
          `,
          [errorMessage, ...failedRunIds]
        );
        await tx.execute(
          `
            UPDATE agent_message_batches
            SET status = 'failed',
                completed_at = COALESCE(completed_at, NOW()),
                updated_at = NOW()
            WHERE id IN (
              SELECT batch_id
              FROM agent_runs
              WHERE id IN (${placeholders})
            )
          `,
          failedRunIds
        );
      }

      const orphanQueueMessages = await tx.execute(
        `
          UPDATE agent_queue_messages
          SET status = 'failed',
              error_message = ?,
              completed_at = COALESCE(completed_at, NOW()),
              updated_at = NOW()
          WHERE status = 'processing'
            AND (locked_at IS NULL OR locked_at < ?)
        `,
        [errorMessage, staleBefore]
      );

      return {
        staleBefore: staleBefore.toISOString(),
        staleMs,
        settledRuns,
        settledQueueMessages,
        failedRuns,
        failedQueueMessages: failedQueueMessages + orphanQueueMessages,
        orphanQueueMessages
      };
    }));
  }

  async function enqueueSelfContinuationQueueMessage(input = {}, config = {}) {
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          INSERT INTO agent_queue_messages (
            trace_id,
            source,
            message_sid,
            dedupe_key,
            chat_type,
            session_key,
            peer_id,
            peer_name,
            sender_id,
            sender_name,
            account_id,
            body_for_agent,
            raw_payload,
            inbound_context,
            payload,
            status,
            available_at,
            created_at,
            updated_at
          )
          VALUES (?, 'self_continuation', ?, ?, 'direct', 'xiaoni:global', ?, '小腻', ?, '小腻', ?, '', ?::jsonb, ?::jsonb, ?::jsonb, 'pending', NOW(), NOW(), NOW())
          ON CONFLICT (dedupe_key) DO NOTHING
          RETURNING id
        `,
        [
          input.traceId,
          input.messageSid,
          input.dedupeKey,
          input.accountId,
          input.accountId,
          input.accountId,
          JSON.stringify(normalizeJsonObject(input.rawPayload)),
          JSON.stringify(normalizeJsonObject(input.inboundContext)),
          JSON.stringify(normalizeJsonObject(input.payload))
        ]
      );
      return rows.length > 0;
    });
  }

  async function releaseExecutionLease(input = {}, config = {}) {
    await withSql(input, config, async (sql) => {
      await sql.execute(
        `
          UPDATE agent_runs
          SET status = ?,
              delivery_phase = 'lease_released',
              termination_reason = ?,
              finish_reason = ?,
              finish_outcome = ?,
              no_reply = ?,
              final_response = ?,
              sent_messages = ?::jsonb,
              total_turns = ?,
              error_message = ?,
              completed_at = NOW(),
              updated_at = NOW()
          WHERE id = ?
        `,
        [
          input.status,
          input.leaseRelease?.reason,
          input.leaseRelease?.detail ?? null,
          input.leaseRelease?.outcome ?? null,
          input.noVisibleDelivery,
          input.finalResponse ?? null,
          JSON.stringify(input.sentMessages || []),
          input.modelRequestSlices ?? 0,
          input.errorMessage ?? null,
          input.runId
        ]
      );

      await sql.execute(
        `
          UPDATE agent_message_batches
          SET status = ?,
              completed_at = NOW(),
              updated_at = NOW()
          WHERE id = (SELECT batch_id FROM agent_runs WHERE id = ?)
        `,
        [input.status, input.runId]
      );
    });
  }

  async function getExecutionLeaseDeliveryState(input = {}, config = {}) {
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          SELECT
            delivery_phase,
            delivery_commit_count,
            blocked_delivery_attempt_count,
            last_blocked_delivery_reason
          FROM agent_runs
          WHERE id = ?
          LIMIT 1
        `,
        [input.runId]
      );
      return mapExecutionLeaseDeliveryState(rows[0]);
    });
  }

  async function markLeaseVisibleDeliveryCommitted(input = {}, config = {}) {
    await withSql(input, config, async (sql) => {
      await sql.execute(
        `
          UPDATE agent_runs
          SET delivery_phase = 'delivery_committed',
              delivery_commit_count = COALESCE(delivery_commit_count, 0) + 1,
              updated_at = NOW()
          WHERE id = ?
        `,
        [input.runId]
      );
    });
  }

  async function markLeaseDeliveryBlocked(input = {}, config = {}) {
    await withSql(input, config, async (sql) => {
      await sql.execute(
        `
          UPDATE agent_runs
          SET blocked_delivery_attempt_count = COALESCE(blocked_delivery_attempt_count, 0) + 1,
              last_blocked_delivery_reason = ?,
              updated_at = NOW()
          WHERE id = ?
        `,
        [input.reason, input.runId]
      );
    });
  }

  async function createLlmJob(input = {}, config = {}) {
    const jobId = `job_${Date.now()}_${randomUUID().slice(0, 8)}`;
    await withSql(input, config, async (sql) => {
      await sql.insert(
        `
          INSERT INTO llm_jobs (
            job_id,
            trace_id,
            session_id,
            agent_type,
            status,
            metadata,
            started_at
          )
          VALUES (?, ?, ?, ?, 'processing', ?::jsonb, NOW())
        `,
        [
          jobId,
          input.traceId,
          input.sessionId,
          input.agentType,
          JSON.stringify(normalizeJsonObject(input.metadata))
        ]
      );
    });
    return jobId;
  }

  async function updateLlmJob(input = {}, config = {}) {
    await withSql(input, config, async (sql) => {
      await sql.execute(
        `
          UPDATE llm_jobs
          SET status = ?,
              final_response = ?,
              error_message = ?,
              total_turns = ?,
              metadata = COALESCE(?::jsonb, metadata),
              completed_at = CASE WHEN ? IN ('completed', 'failed') THEN NOW() ELSE completed_at END,
              updated_at = NOW()
          WHERE job_id = ?
        `,
        [
          input.status,
          input.finalResponse ?? null,
          input.errorMessage ?? null,
          input.totalTurns ?? 0,
          input.metadata ? JSON.stringify(input.metadata) : null,
          input.status,
          input.jobId
        ]
      );
    });
  }

  async function getSessionReadCutoffState(input = {}, config = {}) {
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          SELECT
            session_key,
            read_cutoff_after_stack_index,
            last_context_window_tokens,
            last_target_budget_tokens,
            last_hard_budget_tokens,
            context_summary,
            pending_proactive_share,
            pending_proactive_share_age,
            consecutive_over_compression_turns,
            updated_at
          FROM agent_session_context_windows
          WHERE session_key = ?
          LIMIT 1
        `,
        [input.sessionKey]
      );
      const row = rows[0];
      if (!row) {
        return null;
      }
      return mapSessionReadCutoffState(row);
    });
  }

  async function upsertSessionReadCutoffState(input = {}, config = {}) {
    await withSql(input, config, async (sql) => {
      await sql.execute(
        `
          INSERT INTO agent_session_context_windows (
            session_key,
            read_cutoff_after_stack_index,
            last_context_window_tokens,
            last_target_budget_tokens,
            last_hard_budget_tokens,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT (session_key)
          DO UPDATE SET
            read_cutoff_after_stack_index = EXCLUDED.read_cutoff_after_stack_index,
            last_context_window_tokens = EXCLUDED.last_context_window_tokens,
            last_target_budget_tokens = EXCLUDED.last_target_budget_tokens,
            last_hard_budget_tokens = EXCLUDED.last_hard_budget_tokens,
            updated_at = CURRENT_TIMESTAMP
        `,
        [
          input.sessionKey,
          input.readCutoffAfterStackIndex,
          input.lastContextWindowTokens,
          input.lastTargetBudgetTokens,
          input.lastHardBudgetTokens
        ]
      );
    });
  }

  async function commitSessionContextSummaryAndReadCutoff(input = {}, config = {}) {
    const sessionKey = typeof input.sessionKey === 'string' ? input.sessionKey : '';
    const readCutoffAfterStackIndex = toNumericConversationId(input.readCutoffAfterStackIndex);
    if (!sessionKey || readCutoffAfterStackIndex === null) {
      return {
        committed: false,
        state: null
      };
    }
    const commitWithExecutor = async (executor) => {
      if (typeof executor.query === 'function') {
        await executor.query('SELECT pg_advisory_xact_lock(hashtext(?))', [`agent_session_context_windows:${sessionKey}`]).catch(() => []);
      }
      const existingRows = await executor.query(
        `
          SELECT
            session_key,
            read_cutoff_after_stack_index,
            last_context_window_tokens,
            last_target_budget_tokens,
            last_hard_budget_tokens,
            context_summary,
            pending_proactive_share,
            pending_proactive_share_age,
            updated_at
          FROM agent_session_context_windows
          WHERE session_key = ?
          FOR UPDATE
        `,
        [sessionKey]
      );
      const existing = mapSessionReadCutoffState(existingRows[0]);
      if (
        existing?.readCutoffAfterStackIndex !== null &&
        typeof existing?.readCutoffAfterStackIndex === 'number' &&
        existing.readCutoffAfterStackIndex >= readCutoffAfterStackIndex
      ) {
        return {
          committed: false,
          state: existing
        };
      }
      const rows = await executor.query(
        `
          INSERT INTO agent_session_context_windows (
            session_key,
            context_summary,
            read_cutoff_after_stack_index,
            last_context_window_tokens,
            last_target_budget_tokens,
            last_hard_budget_tokens,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT (session_key)
          DO UPDATE SET
            context_summary = EXCLUDED.context_summary,
            read_cutoff_after_stack_index = EXCLUDED.read_cutoff_after_stack_index,
            last_context_window_tokens = EXCLUDED.last_context_window_tokens,
            last_target_budget_tokens = EXCLUDED.last_target_budget_tokens,
            last_hard_budget_tokens = EXCLUDED.last_hard_budget_tokens,
            updated_at = CURRENT_TIMESTAMP
          RETURNING
            session_key,
            read_cutoff_after_stack_index,
            last_context_window_tokens,
            last_target_budget_tokens,
            last_hard_budget_tokens,
            context_summary,
            pending_proactive_share,
            pending_proactive_share_age,
            updated_at
        `,
        [
          sessionKey,
          input.contextSummary,
          readCutoffAfterStackIndex,
          input.lastContextWindowTokens,
          input.lastTargetBudgetTokens,
          input.lastHardBudgetTokens
        ]
      );
      return {
        committed: true,
        state: mapSessionReadCutoffState(rows[0])
      };
    };

    return withSql(input, config, async (sql) => {
      if (typeof sql.withTransaction === 'function') {
        return sql.withTransaction(commitWithExecutor);
      }
      return commitWithExecutor(sql);
    });
  }

  async function upsertProactiveShareState(input = {}, config = {}) {
    await withSql(input, config, async (sql) => {
      await sql.execute(
        `
          INSERT INTO agent_session_context_windows (session_key, pending_proactive_share, pending_proactive_share_age, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT (session_key)
          DO UPDATE SET
            pending_proactive_share = EXCLUDED.pending_proactive_share,
            pending_proactive_share_age = EXCLUDED.pending_proactive_share_age,
            updated_at = CURRENT_TIMESTAMP
        `,
        [input.sessionKey, input.share ?? null, input.age]
      );
    });
  }

  async function upsertSessionContextSummary(input = {}, config = {}) {
    await withSql(input, config, async (sql) => {
      await sql.execute(
        `
          INSERT INTO agent_session_context_windows (session_key, context_summary, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT (session_key)
          DO UPDATE SET
            context_summary = EXCLUDED.context_summary,
            updated_at = CURRENT_TIMESTAMP
        `,
        [input.sessionKey, input.contextSummary]
      );
    });
  }

  async function setSessionCompressionTriggerCounter(input = {}, config = {}) {
    // Targeted writer for ONLY consecutive_over_compression_turns. Must not clobber the
    // read cutoff / summary / proactive-share columns — the compression debounce counter
    // is written far more often (every main turn) than those. TIMING-ONLY state; it never
    // enters the cacheable request prefix.
    const rawCount = Number(input.consecutiveOverCompressionTurns);
    const count = Number.isFinite(rawCount) && rawCount > 0 ? Math.trunc(rawCount) : 0;
    await withSql(input, config, async (sql) => {
      await sql.execute(
        `
          INSERT INTO agent_session_context_windows (session_key, consecutive_over_compression_turns, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT (session_key)
          DO UPDATE SET
            consecutive_over_compression_turns = EXCLUDED.consecutive_over_compression_turns,
            updated_at = CURRENT_TIMESTAMP
        `,
        [input.sessionKey, count]
      );
    });
  }

  async function loadSessionReplayState(input = {}, config = {}) {
    return withSql(input, config, async (sql) => {
      const snapshotSessionId = buildTranscriptSessionId(input.userId, input.groupId);
      const snapshotRows = await sql.query(
        `
          SELECT
            summary_text,
            summary_status
          FROM chat_transcript_snapshots
          WHERE session_id = ?
            AND summary_status = 'ready'
          LIMIT 1
        `,
        [snapshotSessionId]
      );
      const snapshot = snapshotRows[0];
      return {
        summaryText: snapshot?.summary_text?.trim() || null,
        summarizedThroughConversationId: null
      };
    });
  }

  async function getTranscriptSnapshotBySessionId(input = {}, config = {}) {
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          SELECT
            session_id,
            chat_type,
            private_user_id,
            group_id,
            summary_text,
            summary_format_version,
            summary_status,
            summary_job_id,
            last_compacted_at,
            created_at,
            updated_at
          FROM chat_transcript_snapshots
          WHERE session_id = ?
          LIMIT 1
        `,
        [input.sessionId]
      );
      return rows[0] || null;
    });
  }

  async function upsertTranscriptSnapshot(input = {}, config = {}) {
    await withSql(input, config, async (sql) => {
      await sql.execute(
        `
          INSERT INTO chat_transcript_snapshots (
            session_id,
            chat_type,
            private_user_id,
            group_id,
            summary_text,
            summary_format_version,
            summary_status,
            summary_job_id,
            last_compacted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (session_id) DO UPDATE SET
            chat_type = EXCLUDED.chat_type,
            private_user_id = EXCLUDED.private_user_id,
            group_id = EXCLUDED.group_id,
            summary_text = EXCLUDED.summary_text,
            summary_format_version = EXCLUDED.summary_format_version,
            summary_status = EXCLUDED.summary_status,
            summary_job_id = EXCLUDED.summary_job_id,
            last_compacted_at = EXCLUDED.last_compacted_at,
            updated_at = CURRENT_TIMESTAMP
        `,
        [
          input.sessionId,
          input.chatType,
          input.privateUserId ?? null,
          input.groupId ?? null,
          input.summaryText,
          input.summaryFormatVersion,
          input.summaryStatus || 'ready',
          input.summaryJobId ?? null,
          normalizeTimestamp(input.lastCompactedAt)
        ]
      );
    });
  }

  return {
    ensureAgentRuntimeSchema,
    ensureTranscriptSnapshotSchema,
    logRuntimeTimelineEvent,
    recoverStaleProcessingLeases,
    enqueueSelfContinuationQueueMessage,
    releaseExecutionLease,
    getExecutionLeaseDeliveryState,
    markLeaseVisibleDeliveryCommitted,
    markLeaseDeliveryBlocked,
    createLlmJob,
    updateLlmJob,
    getSessionReadCutoffState,
    upsertSessionReadCutoffState,
    commitSessionContextSummaryAndReadCutoff,
    upsertProactiveShareState,
    upsertSessionContextSummary,
    setSessionCompressionTriggerCounter,
    loadSessionReplayState,
    getTranscriptSnapshotBySessionId,
    upsertTranscriptSnapshot
  };
}

module.exports = {
  createAgentRuntimePersistence
};

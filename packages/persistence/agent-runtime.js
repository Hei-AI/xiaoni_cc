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
      conversation_id BIGINT,
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
      conversation_id BIGINT,
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
      conversation_id BIGINT,
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
      conversation_id BIGINT,
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
      summarized_through_conversation_id BIGINT NOT NULL,
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
  `
    CREATE TABLE IF NOT EXISTS conversation_items (
      id BIGSERIAL PRIMARY KEY,
      conversation_id BIGINT NOT NULL,
      session_key VARCHAR(191),
      role VARCHAR(16) NOT NULL,
      phase VARCHAR(32),
      content TEXT NOT NULL,
      group_index INTEGER NOT NULL DEFAULT 0,
      item_index INTEGER NOT NULL DEFAULT 0,
      source VARCHAR(32) NOT NULL,
      delivery_message_id BIGINT,
      run_id VARCHAR(128),
      trace_id VARCHAR(128),
      created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS agent_session_context_windows (
      session_key VARCHAR(191) PRIMARY KEY,
      read_cutoff_after_conversation_id BIGINT,
      last_context_window_tokens INTEGER,
      last_target_budget_tokens INTEGER,
      last_hard_budget_tokens INTEGER,
      context_summary TEXT,
      pending_proactive_share TEXT,
      pending_proactive_share_age INTEGER DEFAULT 0,
      updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS delivery_phase TEXT NOT NULL DEFAULT 'reasoning_open'`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS delivery_commit_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS blocked_delivery_attempt_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS last_blocked_delivery_reason TEXT`,
  'CREATE INDEX IF NOT EXISTS idx_conversation_items_conversation_group_item ON conversation_items (conversation_id, group_index, item_index, id)',
  'CREATE INDEX IF NOT EXISTS idx_conversation_items_session_created ON conversation_items (session_key, created_at, id)',
  `ALTER TABLE agent_session_context_windows ADD COLUMN IF NOT EXISTS pending_proactive_share TEXT`,
  `ALTER TABLE agent_session_context_windows ADD COLUMN IF NOT EXISTS pending_proactive_share_age INTEGER DEFAULT 0`,
  'CREATE INDEX IF NOT EXISTS idx_agent_session_context_windows_updated ON agent_session_context_windows (updated_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_conversations_trace_id ON conversations (trace_id)'
];

const CONVERSATION_STORE_DDLS = [
  'CREATE INDEX IF NOT EXISTS idx_conversations_user_group_time ON conversations (user_id, group_id, id DESC)',
  'CREATE INDEX IF NOT EXISTS idx_conversations_group_time ON conversations (group_id, id DESC)',
  `ALTER TABLE private_chat_settings
   ADD COLUMN IF NOT EXISTS continuous_learning_enabled INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE group_chat_settings
   ADD COLUMN IF NOT EXISTS continuous_learning_enabled INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE group_chat_settings
   ADD COLUMN IF NOT EXISTS notification_mode TEXT NOT NULL DEFAULT 'all'`,
  `ALTER TABLE group_chat_settings
   ADD COLUMN IF NOT EXISTS notification_aggregation_seconds INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE private_chat_settings
   ADD COLUMN IF NOT EXISTS transcript_compact_offset INTEGER NOT NULL DEFAULT 6`,
  `ALTER TABLE group_chat_settings
   ADD COLUMN IF NOT EXISTS transcript_compact_offset INTEGER NOT NULL DEFAULT 6`,
  `CREATE TABLE IF NOT EXISTS agent_qq_group_notification_aggregations (
      session_key VARCHAR(191) PRIMARY KEY,
      peer_id VARCHAR(191) NOT NULL,
      peer_name VARCHAR(255),
      account_id VARCHAR(191) NOT NULL,
      unread_delta INTEGER NOT NULL DEFAULT 1,
      direct_mentions INTEGER NOT NULL DEFAULT 0,
      latest_message_id BIGINT,
      latest_message_sid VARCHAR(191) NOT NULL,
      message_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      due_at TIMESTAMPTZ(3) NOT NULL,
      created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  'CREATE INDEX IF NOT EXISTS idx_agent_qq_group_notification_aggregations_due ON agent_qq_group_notification_aggregations (due_at)',
  `CREATE TABLE IF NOT EXISTS agent_qq_usage_surface_state (
      identity_key VARCHAR(191) PRIMARY KEY DEFAULT 'xiaoni',
      active_thread_key VARCHAR(191),
      active_chat_type VARCHAR(16),
      active_peer_id VARCHAR(191),
      account_id VARCHAR(191),
      opened_at TIMESTAMPTZ(3),
      updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  'CREATE INDEX IF NOT EXISTS idx_agent_qq_usage_surface_state_active_thread ON agent_qq_usage_surface_state (active_thread_key)'
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
    readCutoffAfterConversationId: row.read_cutoff_after_conversation_id === null ? null : Number(row.read_cutoff_after_conversation_id),
    lastContextWindowTokens: row.last_context_window_tokens === null ? null : Number(row.last_context_window_tokens),
    lastTargetBudgetTokens: row.last_target_budget_tokens === null ? null : Number(row.last_target_budget_tokens),
    lastHardBudgetTokens: row.last_hard_budget_tokens === null ? null : Number(row.last_hard_budget_tokens),
    contextSummary: row.context_summary ?? null,
    pendingProactiveShare: row.pending_proactive_share ?? null,
    pendingProactiveShareAge: row.pending_proactive_share_age === null ? 0 : Number(row.pending_proactive_share_age),
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

function mapConversationItem(row) {
  return {
    id: Number(row.id),
    conversationId: Number(row.conversation_id),
    sessionKey: row.session_key,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    phase: row.phase === 'commentary' || row.phase === 'final_answer' ? row.phase : null,
    content: row.content,
    groupIndex: Number(row.group_index),
    itemIndex: Number(row.item_index),
    source: row.source === 'delivery'
      || row.source === 'presence_action'
      ? row.source
      : 'inbound_batch',
    deliveryMessageId: row.delivery_message_id === null ? null : Number(row.delivery_message_id),
    runId: row.run_id,
    traceId: row.trace_id
  };
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

  async function ensureConversationStoreSchema(input = {}, config = {}) {
    await withSql(input, config, async (sql) => {
      await executeDdls(sql, CONVERSATION_STORE_DDLS);
    });
  }

  async function logRuntimeTimelineEvent(input = {}, config = {}) {
    await withSql(input, config, async (sql) => {
      await sql.insert(
        `
          INSERT INTO timeline_events (
            trace_id,
            conversation_id,
            event_type,
            event_name,
            event_phase,
            component,
            duration_ms,
            metadata
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb)
        `,
        [
          input.traceId,
          input.conversationId ?? null,
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

  async function attachConversationIdToRuntimeTrace(input = {}, config = {}) {
    const traceId = typeof input.traceId === 'string' ? input.traceId : input.trace_id;
    const conversationId = toNumericConversationId(input.conversationId ?? input.conversation_id);
    if (!traceId || conversationId === null) {
      return 0;
    }
    const tables = [
      'agent_queue_messages',
      'agent_runs',
      'agent_message_batches',
      'llm_jobs',
      'timeline_events'
    ];
    return withSql(input, config, async (sql) => {
      let updated = 0;
      for (const table of tables) {
        if (input.useCoalesceAssignment) {
          updated += await sql.execute(
            `UPDATE ${table} SET conversation_id = COALESCE(conversation_id, ?) WHERE trace_id = ?`,
            [conversationId, traceId]
          );
        } else {
          updated += await sql.execute(
            `UPDATE ${table} SET conversation_id = ? WHERE trace_id = ? AND conversation_id IS NULL`,
            [conversationId, traceId]
          );
        }
      }
      return updated;
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
              conversation_id = COALESCE(?, conversation_id),
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
          input.conversationId ?? null,
          input.runId
        ]
      );

      await sql.execute(
        `
          UPDATE agent_message_batches
          SET status = ?,
              conversation_id = COALESCE(?, conversation_id),
              completed_at = NOW(),
              updated_at = NOW()
          WHERE id = (SELECT batch_id FROM agent_runs WHERE id = ?)
        `,
        [input.status, input.conversationId ?? null, input.runId]
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
              conversation_id = COALESCE(?, conversation_id),
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
          input.conversationId ?? null,
          input.metadata ? JSON.stringify(input.metadata) : null,
          input.status,
          input.jobId
        ]
      );
    });
  }

  async function listRecentConversationTurns(input = {}, config = {}) {
    return withSql(input, config, async (sql) => {
      const limit = typeof input.limit === 'number'
        ? Math.max(1, Math.min(input.limit, 1000))
        : null;
      const conditions = [];
      const values = [];

      if (input.scope !== 'global') {
        if (input.groupId && Number.isFinite(Number(input.groupId))) {
          conditions.push('group_id = ?');
          values.push(input.groupId);
        } else {
          conditions.push('group_id IS NULL');
          conditions.push('user_id = ?');
          values.push(input.userId);
        }
      }

      if (input.afterConversationId && Number.isFinite(Number(input.afterConversationId))) {
        conditions.push('id > ?');
        values.push(input.afterConversationId);
      }

      const rows = await sql.query(
        `
          SELECT id, batch_id, trace_id, user_id, group_id, user_message, ai_response, raw_response
          FROM conversations
          WHERE ${conditions.length > 0 ? conditions.join(' AND ') : 'TRUE'}
          ORDER BY id DESC
          ${limit ? `LIMIT ${limit}` : ''}
        `,
        values
      );
      const orderedRows = rows.reverse();
      const conversationIds = orderedRows.map((row) => Number(row.id));
      const itemRows = conversationIds.length > 0
        ? await sql.query(
          `
            SELECT
              id,
              conversation_id,
              session_key,
              role,
              phase,
              content,
              group_index,
              item_index,
              source,
              delivery_message_id,
              run_id,
              trace_id
            FROM conversation_items
            WHERE conversation_id IN (${conversationIds.map(() => '?').join(', ')})
            ORDER BY conversation_id ASC, group_index ASC, item_index ASC, id ASC
          `,
          conversationIds
        )
        : [];

      const itemsByConversationId = new Map();
      for (const row of itemRows) {
        const conversationId = Number(row.conversation_id);
        const items = itemsByConversationId.get(conversationId) || [];
        items.push(mapConversationItem(row));
        itemsByConversationId.set(conversationId, items);
      }

      return orderedRows.map((row) => {
        const conversationId = Number(row.id);
        return {
          id: conversationId,
          userId: Number(row.user_id),
          groupId: row.group_id === null ? null : Number(row.group_id),
          batchId: row.batch_id === null ? null : Number(row.batch_id),
          sessionKey: buildTranscriptSessionId(Number(row.user_id), row.group_id === null ? null : Number(row.group_id)),
          userMessage: row.user_message,
          aiResponse: row.ai_response,
          items: itemsByConversationId.get(conversationId) || [],
          rawResponse: parseJson(row.raw_response, {})
        };
      });
    });
  }

  async function createConversationWithItems(input = {}, config = {}) {
    return withSql(input, config, async (sql) => {
      const result = await sql.insert(
        `
          INSERT INTO conversations (
            batch_id,
            user_id,
            group_id,
            user_message,
            ai_response,
            response_time,
            status,
            error_reason,
            model_name,
            raw_request,
            raw_response,
            trace_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?)
        `,
        [
          input.batchId ?? null,
          input.userId,
          input.groupId ?? null,
          input.userMessage,
          input.aiResponse ?? null,
          input.responseTimeMs,
          input.status,
          input.errorReason ?? null,
          input.modelName ?? null,
          JSON.stringify(normalizeJsonObject(input.rawRequest)),
          JSON.stringify(normalizeJsonObject(input.rawResponse)),
          input.traceId
        ]
      );

      const conversationId = Number(result.insertId);
      const transcriptItems = Array.isArray(input.transcriptItems) ? input.transcriptItems : [];
      for (const item of transcriptItems) {
        await sql.insert(
          `
            INSERT INTO conversation_items (
              conversation_id,
              session_key,
              role,
              phase,
              content,
              group_index,
              item_index,
              source,
              delivery_message_id,
              run_id,
              trace_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            conversationId,
            item.sessionKey ?? input.sessionKey ?? null,
            item.role,
            item.phase ?? null,
            item.content,
            item.groupIndex,
            item.itemIndex,
            item.source,
            item.deliveryMessageId ?? null,
            item.runId ?? null,
            item.traceId ?? input.traceId
          ]
        );
      }
      return conversationId;
    });
  }

  async function getSessionReadCutoffState(input = {}, config = {}) {
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          SELECT
            session_key,
            read_cutoff_after_conversation_id,
            last_context_window_tokens,
            last_target_budget_tokens,
            last_hard_budget_tokens,
            context_summary,
            pending_proactive_share,
            pending_proactive_share_age,
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
            read_cutoff_after_conversation_id,
            last_context_window_tokens,
            last_target_budget_tokens,
            last_hard_budget_tokens,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT (session_key)
          DO UPDATE SET
            read_cutoff_after_conversation_id = EXCLUDED.read_cutoff_after_conversation_id,
            last_context_window_tokens = EXCLUDED.last_context_window_tokens,
            last_target_budget_tokens = EXCLUDED.last_target_budget_tokens,
            last_hard_budget_tokens = EXCLUDED.last_hard_budget_tokens,
            updated_at = CURRENT_TIMESTAMP
        `,
        [
          input.sessionKey,
          input.readCutoffAfterConversationId,
          input.lastContextWindowTokens,
          input.lastTargetBudgetTokens,
          input.lastHardBudgetTokens
        ]
      );
    });
  }

  async function commitSessionContextSummaryAndReadCutoff(input = {}, config = {}) {
    const sessionKey = typeof input.sessionKey === 'string' ? input.sessionKey : '';
    const readCutoffAfterConversationId = toNumericConversationId(input.readCutoffAfterConversationId);
    if (!sessionKey || readCutoffAfterConversationId === null) {
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
            read_cutoff_after_conversation_id,
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
        existing?.readCutoffAfterConversationId !== null &&
        typeof existing?.readCutoffAfterConversationId === 'number' &&
        existing.readCutoffAfterConversationId >= readCutoffAfterConversationId
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
            read_cutoff_after_conversation_id,
            last_context_window_tokens,
            last_target_budget_tokens,
            last_hard_budget_tokens,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT (session_key)
          DO UPDATE SET
            context_summary = EXCLUDED.context_summary,
            read_cutoff_after_conversation_id = EXCLUDED.read_cutoff_after_conversation_id,
            last_context_window_tokens = EXCLUDED.last_context_window_tokens,
            last_target_budget_tokens = EXCLUDED.last_target_budget_tokens,
            last_hard_budget_tokens = EXCLUDED.last_hard_budget_tokens,
            updated_at = CURRENT_TIMESTAMP
          RETURNING
            session_key,
            read_cutoff_after_conversation_id,
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
          readCutoffAfterConversationId,
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

  async function loadSessionReplayState(input = {}, config = {}) {
    return withSql(input, config, async (sql) => {
      const snapshotSessionId = buildTranscriptSessionId(input.userId, input.groupId);
      const snapshotRows = await sql.query(
        `
          SELECT
            summary_text,
            summarized_through_conversation_id,
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
        summarizedThroughConversationId: snapshot
          ? Number(snapshot.summarized_through_conversation_id)
          : null
      };
    });
  }

  async function listStoredConversationTurns(input = {}, config = {}) {
    return withSql(input, config, async (sql) => {
      const limit = typeof input.limit === 'number'
        ? Math.max(1, Math.min(input.limit, 1000))
        : null;
      const conditions = [];
      const values = [];

      if (input.groupId && Number.isFinite(Number(input.groupId))) {
        conditions.push('group_id = ?');
        values.push(input.groupId);
      } else {
        conditions.push('group_id IS NULL');
        conditions.push('user_id = ?');
        values.push(input.userId);
      }

      if (input.afterConversationId && Number.isFinite(Number(input.afterConversationId))) {
        conditions.push('id > ?');
        values.push(input.afterConversationId);
      }

      const rows = await sql.query(
        `
          SELECT
            id,
            user_id,
            group_id,
            user_message,
            ai_response,
            timestamp,
            response_time,
            status,
            error_reason,
            model_name,
            raw_request,
            raw_response,
            trace_id
          FROM conversations
          WHERE ${conditions.join(' AND ')}
          ORDER BY id DESC
          ${limit ? `LIMIT ${limit}` : ''}
        `,
        values
      );

      const traceIds = Array.from(new Set(rows
        .map((row) => (typeof row.trace_id === 'string' ? row.trace_id.trim() : ''))
        .filter(Boolean)));
      const queueRows = traceIds.length > 0
        ? await sql.query(
          `
            SELECT
              trace_id,
              message_sid,
              payload
            FROM agent_queue_messages
            WHERE trace_id IN (${traceIds.map(() => '?').join(', ')})
            ORDER BY id ASC
          `,
          traceIds
        )
        : [];
      const messageIdsByTrace = new Map();
      const messageSidsByTrace = new Map();

      for (const row of queueRows) {
        const traceId = typeof row.trace_id === 'string' ? row.trace_id.trim() : '';
        if (!traceId) {
          continue;
        }
        const payload = parseJson(row.payload, {});
        const sourceMessageId = Number(payload.messageId);
        const sourceMessageIds = messageIdsByTrace.get(traceId) || [];
        if (Number.isFinite(sourceMessageId) && sourceMessageId > 0 && !sourceMessageIds.includes(sourceMessageId)) {
          sourceMessageIds.push(sourceMessageId);
          messageIdsByTrace.set(traceId, sourceMessageIds);
        }

        const sourceMessageSid = typeof row.message_sid === 'string' ? row.message_sid.trim() : '';
        const sourceMessageSids = messageSidsByTrace.get(traceId) || [];
        if (sourceMessageSid && !sourceMessageSids.includes(sourceMessageSid)) {
          sourceMessageSids.push(sourceMessageSid);
          messageSidsByTrace.set(traceId, sourceMessageSids);
        }
      }

      return rows.reverse().map((row) => {
        const traceId = typeof row.trace_id === 'string' ? row.trace_id.trim() : '';
        const rawRequest = parseJson(row.raw_request, {});
        const rawResponse = parseJson(row.raw_response, {});
        return {
          ...row,
          raw_request: rawRequest,
          raw_response: rawResponse,
          source_message_ids: messageIdsByTrace.get(traceId) || normalizeNumberArray(rawRequest.source_message_ids),
          source_message_sids: messageSidsByTrace.get(traceId) || normalizeStringArray(rawRequest.source_message_sids)
        };
      });
    });
  }

  async function createStoredConversation(input = {}, config = {}) {
    return withSql(input, config, async (sql) => {
      const result = await sql.insert(
        `
          INSERT INTO conversations (
            user_id,
            group_id,
            user_message,
            ai_response,
            response_time,
            status,
            error_reason,
            model_name,
            raw_request,
            raw_response,
            trace_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?)
        `,
        [
          input.userId,
          input.groupId ?? null,
          input.userMessage,
          input.aiResponse ?? null,
          Math.max(0, Math.round(input.responseTimeMs || 0)),
          input.status || 'completed',
          input.errorReason ?? null,
          input.modelName ?? null,
          JSON.stringify(normalizeJsonObject(input.rawRequest)),
          JSON.stringify(normalizeJsonObject(input.rawResponse)),
          input.traceId ?? null
        ]
      );
      return result.insertId;
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
            summarized_through_conversation_id,
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
            summarized_through_conversation_id,
            summary_status,
            summary_job_id,
            last_compacted_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (session_id) DO UPDATE SET
            chat_type = EXCLUDED.chat_type,
            private_user_id = EXCLUDED.private_user_id,
            group_id = EXCLUDED.group_id,
            summary_text = EXCLUDED.summary_text,
            summary_format_version = EXCLUDED.summary_format_version,
            summarized_through_conversation_id = EXCLUDED.summarized_through_conversation_id,
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
          input.summarizedThroughConversationId,
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
    ensureConversationStoreSchema,
    logRuntimeTimelineEvent,
    attachConversationIdToRuntimeTrace,
    recoverStaleProcessingLeases,
    enqueueSelfContinuationQueueMessage,
    releaseExecutionLease,
    getExecutionLeaseDeliveryState,
    markLeaseVisibleDeliveryCommitted,
    markLeaseDeliveryBlocked,
    createLlmJob,
    updateLlmJob,
    listRecentConversationTurns,
    createConversationWithItems,
    getSessionReadCutoffState,
    upsertSessionReadCutoffState,
    commitSessionContextSummaryAndReadCutoff,
    upsertProactiveShareState,
    upsertSessionContextSummary,
    loadSessionReplayState,
    listStoredConversationTurns,
    createStoredConversation,
    getTranscriptSnapshotBySessionId,
    upsertTranscriptSnapshot
  };
}

module.exports = {
  createAgentRuntimePersistence
};

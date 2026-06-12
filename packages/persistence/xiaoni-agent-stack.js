'use strict';

const { randomUUID } = require('crypto');

function normalizeDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === 'string' ? value : String(value);
}

function normalizeDateFilter(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeValue(value) {
  if (value === null || typeof value === 'undefined') {
    return value;
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Date) {
    return normalizeDate(value);
  }
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeValue(entry)])
    );
  }
  return value;
}

function normalizeJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return normalizeValue(value);
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? normalizeValue(parsed)
        : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function normalizeJsonArray(value, fallback = []) {
  if (Array.isArray(value)) {
    return normalizeValue(value);
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? normalizeValue(parsed) : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeBigIntId(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  return Boolean(value);
}

function normalizeInteger(value, fallback = null) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeStackRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id === null || typeof row.id === 'undefined' ? null : String(row.id),
    eventId: row.event_id,
    identityKey: row.identity_key,
    stackIndex: Number(row.stack_index || 0),
    itemKind: row.item_kind,
    role: row.role || null,
    phase: row.phase || null,
    providerItemId: row.provider_item_id || null,
    toolCallId: row.tool_call_id || null,
    llmRequestSliceId: row.llm_request_slice_id || null,
    content: normalizeJsonObject(row.content, {}),
    visibility: row.visibility || null,
    sourceType: row.source_type || null,
    sourceId: row.source_id || null,
    traceId: row.trace_id || null,
    runId: row.run_id || null,
    conversationId: row.conversation_id === null || typeof row.conversation_id === 'undefined'
      ? null
      : String(row.conversation_id),
    metadata: normalizeJsonObject(row.metadata, {}),
    createdAt: normalizeDate(row.created_at),
    updatedAt: normalizeDate(row.updated_at)
  };
}

function normalizeLlmSliceRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id === null || typeof row.id === 'undefined' ? null : String(row.id),
    sliceId: row.slice_id,
    llmCallId: row.llm_call_id || null,
    identityKey: row.identity_key,
    inputStartIndex: row.input_start_index === null || typeof row.input_start_index === 'undefined' ? null : Number(row.input_start_index),
    inputEndIndex: row.input_end_index === null || typeof row.input_end_index === 'undefined' ? null : Number(row.input_end_index),
    inputStackItemIds: normalizeJsonArray(row.input_stack_item_ids, []),
    outputStartIndex: row.output_start_index === null || typeof row.output_start_index === 'undefined' ? null : Number(row.output_start_index),
    outputEndIndex: row.output_end_index === null || typeof row.output_end_index === 'undefined' ? null : Number(row.output_end_index),
    canonicalRequest: normalizeJsonObject(row.canonical_request, {}),
    wireRequest: normalizeJsonObject(row.wire_request, null),
    canonicalResponse: normalizeJsonObject(row.canonical_response, null),
    wireResponse: normalizeJsonObject(row.wire_response, null),
    rawResponse: normalizeJsonObject(row.raw_response, null),
    outputItems: normalizeJsonArray(row.output_items, []),
    status: row.status || null,
    tokenUsage: normalizeJsonObject(row.token_usage, {}),
    traceId: row.trace_id || null,
    runId: row.run_id || null,
    conversationId: row.conversation_id === null || typeof row.conversation_id === 'undefined'
      ? null
      : String(row.conversation_id),
    agentTurn: row.agent_turn === null || typeof row.agent_turn === 'undefined' ? null : Number(row.agent_turn),
    modelName: row.model_name || null,
    modelProvider: row.model_provider || null,
    requestFormatVersion: row.request_format_version || null,
    wireProviderFormat: row.wire_provider_format || null,
    processingTimeMs: row.processing_time_ms === null || typeof row.processing_time_ms === 'undefined' ? null : Number(row.processing_time_ms),
    metadata: normalizeJsonObject(row.metadata, {}),
    createdAt: normalizeDate(row.created_at),
    completedAt: normalizeDate(row.completed_at),
    updatedAt: normalizeDate(row.updated_at)
  };
}

function normalizeToolExecutionRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id === null || typeof row.id === 'undefined' ? null : String(row.id),
    executionId: row.execution_id,
    identityKey: row.identity_key,
    llmRequestSliceId: row.llm_request_slice_id || null,
    llmCallId: row.llm_call_id || null,
    toolCallId: row.tool_call_id || null,
    toolName: row.tool_name || null,
    arguments: normalizeJsonObject(row.arguments, {}),
    rawArguments: row.raw_arguments || null,
    result: normalizeJsonObject(row.result, {}),
    status: row.status || null,
    errorMessage: row.error_message || null,
    sideEffect: Boolean(row.side_effect),
    traceId: row.trace_id || null,
    runId: row.run_id || null,
    conversationId: row.conversation_id === null || typeof row.conversation_id === 'undefined'
      ? null
      : String(row.conversation_id),
    agentTurn: row.agent_turn === null || typeof row.agent_turn === 'undefined' ? null : Number(row.agent_turn),
    stackCallItemId: row.stack_call_item_id === null || typeof row.stack_call_item_id === 'undefined' ? null : String(row.stack_call_item_id),
    stackOutputItemId: row.stack_output_item_id === null || typeof row.stack_output_item_id === 'undefined' ? null : String(row.stack_output_item_id),
    metadata: normalizeJsonObject(row.metadata, {}),
    createdAt: normalizeDate(row.created_at),
    startedAt: normalizeDate(row.started_at),
    completedAt: normalizeDate(row.completed_at),
    updatedAt: normalizeDate(row.updated_at)
  };
}

function normalizeCompressionForkRunRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id === null || typeof row.id === 'undefined' ? null : String(row.id),
    forkRunId: row.fork_run_id,
    identityKey: row.identity_key,
    contextSessionKey: row.context_session_key || null,
    status: row.status || null,
    traceId: row.trace_id || null,
    runId: row.run_id || null,
    conversationId: row.conversation_id === null || typeof row.conversation_id === 'undefined'
      ? null
      : String(row.conversation_id),
    readCutoffAfterConversationId: row.read_cutoff_after_conversation_id === null || typeof row.read_cutoff_after_conversation_id === 'undefined'
      ? null
      : String(row.read_cutoff_after_conversation_id),
    previousReadCutoffAfterConversationId: row.previous_read_cutoff_after_conversation_id === null || typeof row.previous_read_cutoff_after_conversation_id === 'undefined'
      ? null
      : String(row.previous_read_cutoff_after_conversation_id),
    summaryText: row.summary_text || null,
    artifact: normalizeJsonObject(row.artifact, {}),
    errorMessage: row.error_message || null,
    metadata: normalizeJsonObject(row.metadata, {}),
    startedAt: normalizeDate(row.started_at),
    completedAt: normalizeDate(row.completed_at),
    createdAt: normalizeDate(row.created_at),
    updatedAt: normalizeDate(row.updated_at)
  };
}

function normalizeCompressionForkItemRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id === null || typeof row.id === 'undefined' ? null : String(row.id),
    eventId: row.event_id,
    forkRunId: row.fork_run_id,
    identityKey: row.identity_key,
    itemIndex: Number(row.item_index || 0),
    itemKind: row.item_kind,
    role: row.role || null,
    phase: row.phase || null,
    providerItemId: row.provider_item_id || null,
    toolCallId: row.tool_call_id || null,
    llmRequestSliceId: row.llm_request_slice_id || null,
    content: normalizeJsonObject(row.content, {}),
    visibility: row.visibility || null,
    sourceType: row.source_type || null,
    sourceId: row.source_id || null,
    traceId: row.trace_id || null,
    runId: row.run_id || null,
    conversationId: row.conversation_id === null || typeof row.conversation_id === 'undefined'
      ? null
      : String(row.conversation_id),
    metadata: normalizeJsonObject(row.metadata, {}),
    createdAt: normalizeDate(row.created_at),
    updatedAt: normalizeDate(row.updated_at)
  };
}

function normalizeCompressionForkSliceRow(row) {
  const normalized = normalizeLlmSliceRow(row);
  return normalized ? {
    ...normalized,
    forkRunId: row.fork_run_id
  } : null;
}

function normalizeCompressionForkToolExecutionRow(row) {
  const normalized = normalizeToolExecutionRow(row);
  return normalized ? {
    ...normalized,
    forkRunId: row.fork_run_id
  } : null;
}

function buildStackEventId(identityKey, item, indexHint) {
  return firstString(item.eventId, item.event_id)
    || `stack:${identityKey}:${Date.now()}:${indexHint}:${randomUUID().slice(0, 8)}`;
}

function buildCompressionForkItemEventId(forkRunId, item, indexHint) {
  return firstString(item.eventId, item.event_id)
    || `fork-stack:${forkRunId}:${indexHint}:${randomUUID().slice(0, 8)}`;
}

function buildCompressionForkRunId(input) {
  return firstString(input.forkRunId, input.fork_run_id)
    || `core-memory-fork:${firstString(input.runId, input.run_id, 'run')}:${randomUUID().slice(0, 8)}`;
}

function buildSliceId(input) {
  return firstString(input.sliceId, input.slice_id, input.llmCallId, input.llm_call_id)
    || `slice:${firstString(input.traceId, input.trace_id, 'trace')}:${input.agentTurn ?? input.agent_turn ?? 'turn'}:${randomUUID().slice(0, 8)}`;
}

function buildToolExecutionId(input) {
  return firstString(input.executionId, input.execution_id)
    || `tool:${firstString(input.runId, input.run_id, 'run')}:${firstString(input.toolCallId, input.tool_call_id, randomUUID().slice(0, 8))}`;
}

function createXiaoniAgentStackPersistence({ createSqlAdapter, sqlAdapter } = {}) {
  function createSql(input = {}, config = {}) {
    if (input?.sqlAdapter) {
      return { sql: input.sqlAdapter, shouldClose: false };
    }
    if (sqlAdapter) {
      return { sql: sqlAdapter, shouldClose: false };
    }
    if (typeof createSqlAdapter !== 'function') {
      throw new Error('xiaoni agent stack SQL operations require createSqlAdapter');
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

  async function ensureXiaoniAgentStackSchema(input = {}, config = {}) {
    await withSql(input, config, async (sql) => {
      await executeDdls(sql, [
        `
          CREATE TABLE IF NOT EXISTS agent_stack_items (
            id BIGSERIAL PRIMARY KEY,
            event_id VARCHAR(191) NOT NULL UNIQUE,
            identity_key VARCHAR(191) NOT NULL DEFAULT 'xiaoni',
            stack_index BIGINT NOT NULL,
            item_kind VARCHAR(64) NOT NULL,
            role VARCHAR(32),
            phase VARCHAR(32),
            provider_item_id VARCHAR(191),
            tool_call_id VARCHAR(191),
            llm_request_slice_id VARCHAR(191),
            content JSONB NOT NULL DEFAULT '{}'::jsonb,
            visibility VARCHAR(32) NOT NULL DEFAULT 'model_visible',
            source_type VARCHAR(64),
            source_id VARCHAR(191),
            trace_id VARCHAR(128),
            run_id VARCHAR(128),
            conversation_id BIGINT,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(identity_key, stack_index)
          )
        `,
        `
          CREATE TABLE IF NOT EXISTS llm_request_slices (
            id BIGSERIAL PRIMARY KEY,
            slice_id VARCHAR(191) NOT NULL UNIQUE,
            llm_call_id VARCHAR(128),
            identity_key VARCHAR(191) NOT NULL DEFAULT 'xiaoni',
            input_start_index BIGINT,
            input_end_index BIGINT,
            input_stack_item_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
            output_start_index BIGINT,
            output_end_index BIGINT,
            canonical_request JSONB NOT NULL DEFAULT '{}'::jsonb,
            wire_request JSONB,
            canonical_response JSONB,
            wire_response JSONB,
            raw_response JSONB,
            output_items JSONB NOT NULL DEFAULT '[]'::jsonb,
            status VARCHAR(32) NOT NULL DEFAULT 'completed',
            token_usage JSONB NOT NULL DEFAULT '{}'::jsonb,
            trace_id VARCHAR(128),
            run_id VARCHAR(128),
            conversation_id BIGINT,
            agent_turn INTEGER,
            model_name VARCHAR(191),
            model_provider VARCHAR(64),
            request_format_version VARCHAR(64),
            wire_provider_format VARCHAR(128),
            processing_time_ms INTEGER,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP(3),
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `,
        `
          CREATE TABLE IF NOT EXISTS tool_executions (
            id BIGSERIAL PRIMARY KEY,
            execution_id VARCHAR(191) NOT NULL UNIQUE,
            identity_key VARCHAR(191) NOT NULL DEFAULT 'xiaoni',
            llm_request_slice_id VARCHAR(191),
            llm_call_id VARCHAR(128),
            tool_call_id VARCHAR(191),
            tool_name VARCHAR(191) NOT NULL,
            arguments JSONB NOT NULL DEFAULT '{}'::jsonb,
            raw_arguments TEXT,
            result JSONB NOT NULL DEFAULT '{}'::jsonb,
            status VARCHAR(32) NOT NULL DEFAULT 'running',
            error_message TEXT,
            side_effect BOOLEAN NOT NULL DEFAULT FALSE,
            trace_id VARCHAR(128),
            run_id VARCHAR(128),
            conversation_id BIGINT,
            agent_turn INTEGER,
            stack_call_item_id BIGINT,
            stack_output_item_id BIGINT,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            started_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP(3),
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `,
        `
          CREATE TABLE IF NOT EXISTS stack_compactions (
            id BIGSERIAL PRIMARY KEY,
            identity_key VARCHAR(191) NOT NULL DEFAULT 'xiaoni',
            compacted_start_index BIGINT NOT NULL,
            compacted_end_index BIGINT NOT NULL,
            summary_stack_item_id BIGINT,
            method VARCHAR(64) NOT NULL,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `,
        `
          CREATE TABLE IF NOT EXISTS core_memory_compression_fork_runs (
            id BIGSERIAL PRIMARY KEY,
            fork_run_id VARCHAR(191) NOT NULL UNIQUE,
            identity_key VARCHAR(191) NOT NULL DEFAULT 'xiaoni',
            context_session_key VARCHAR(191),
            status VARCHAR(32) NOT NULL DEFAULT 'running',
            trace_id VARCHAR(128),
            run_id VARCHAR(128),
            conversation_id BIGINT,
            read_cutoff_after_conversation_id BIGINT,
            previous_read_cutoff_after_conversation_id BIGINT,
            summary_text TEXT,
            artifact JSONB NOT NULL DEFAULT '{}'::jsonb,
            error_message TEXT,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            started_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP(3),
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `,
        `
          CREATE TABLE IF NOT EXISTS core_memory_compression_fork_items (
            id BIGSERIAL PRIMARY KEY,
            event_id VARCHAR(191) NOT NULL UNIQUE,
            fork_run_id VARCHAR(191) NOT NULL,
            identity_key VARCHAR(191) NOT NULL DEFAULT 'xiaoni',
            item_index BIGINT NOT NULL,
            item_kind VARCHAR(64) NOT NULL,
            role VARCHAR(32),
            phase VARCHAR(32),
            provider_item_id VARCHAR(191),
            tool_call_id VARCHAR(191),
            llm_request_slice_id VARCHAR(191),
            content JSONB NOT NULL DEFAULT '{}'::jsonb,
            visibility VARCHAR(32) NOT NULL DEFAULT 'model_visible',
            source_type VARCHAR(64),
            source_id VARCHAR(191),
            trace_id VARCHAR(128),
            run_id VARCHAR(128),
            conversation_id BIGINT,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(fork_run_id, item_index)
          )
        `,
        `
          CREATE TABLE IF NOT EXISTS core_memory_compression_fork_slices (
            id BIGSERIAL PRIMARY KEY,
            slice_id VARCHAR(191) NOT NULL UNIQUE,
            fork_run_id VARCHAR(191) NOT NULL,
            llm_call_id VARCHAR(128),
            identity_key VARCHAR(191) NOT NULL DEFAULT 'xiaoni',
            input_start_index BIGINT,
            input_end_index BIGINT,
            input_stack_item_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
            output_start_index BIGINT,
            output_end_index BIGINT,
            canonical_request JSONB NOT NULL DEFAULT '{}'::jsonb,
            wire_request JSONB,
            canonical_response JSONB,
            wire_response JSONB,
            raw_response JSONB,
            output_items JSONB NOT NULL DEFAULT '[]'::jsonb,
            status VARCHAR(32) NOT NULL DEFAULT 'completed',
            token_usage JSONB NOT NULL DEFAULT '{}'::jsonb,
            trace_id VARCHAR(128),
            run_id VARCHAR(128),
            conversation_id BIGINT,
            agent_turn INTEGER,
            model_name VARCHAR(191),
            model_provider VARCHAR(64),
            request_format_version VARCHAR(64),
            wire_provider_format VARCHAR(128),
            processing_time_ms INTEGER,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP(3),
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `,
        `
          CREATE TABLE IF NOT EXISTS core_memory_compression_fork_tool_executions (
            id BIGSERIAL PRIMARY KEY,
            execution_id VARCHAR(191) NOT NULL UNIQUE,
            fork_run_id VARCHAR(191) NOT NULL,
            identity_key VARCHAR(191) NOT NULL DEFAULT 'xiaoni',
            llm_request_slice_id VARCHAR(191),
            llm_call_id VARCHAR(128),
            tool_call_id VARCHAR(191),
            tool_name VARCHAR(191) NOT NULL,
            arguments JSONB NOT NULL DEFAULT '{}'::jsonb,
            raw_arguments TEXT,
            result JSONB NOT NULL DEFAULT '{}'::jsonb,
            status VARCHAR(32) NOT NULL DEFAULT 'running',
            error_message TEXT,
            side_effect BOOLEAN NOT NULL DEFAULT FALSE,
            trace_id VARCHAR(128),
            run_id VARCHAR(128),
            conversation_id BIGINT,
            agent_turn INTEGER,
            stack_call_item_id BIGINT,
            stack_output_item_id BIGINT,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            started_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP(3),
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `,
        'CREATE INDEX IF NOT EXISTS idx_agent_stack_items_identity_index ON agent_stack_items (identity_key, stack_index DESC)',
        'CREATE INDEX IF NOT EXISTS idx_agent_stack_items_trace ON agent_stack_items (trace_id, stack_index)',
        'CREATE INDEX IF NOT EXISTS idx_agent_stack_items_run ON agent_stack_items (run_id, stack_index)',
        'CREATE INDEX IF NOT EXISTS idx_agent_stack_items_tool_call ON agent_stack_items (tool_call_id)',
        'CREATE INDEX IF NOT EXISTS idx_agent_stack_items_slice ON agent_stack_items (llm_request_slice_id)',
        'CREATE INDEX IF NOT EXISTS idx_llm_request_slices_identity_time ON llm_request_slices (identity_key, created_at DESC, id DESC)',
        'CREATE INDEX IF NOT EXISTS idx_llm_request_slices_trace ON llm_request_slices (trace_id, agent_turn, id)',
        'CREATE INDEX IF NOT EXISTS idx_llm_request_slices_llm_call ON llm_request_slices (llm_call_id)',
        'CREATE INDEX IF NOT EXISTS idx_tool_executions_trace ON tool_executions (trace_id, started_at DESC, id DESC)',
        'CREATE INDEX IF NOT EXISTS idx_tool_executions_tool_call ON tool_executions (tool_call_id)',
        'CREATE INDEX IF NOT EXISTS idx_tool_executions_slice ON tool_executions (llm_request_slice_id)',
        'CREATE INDEX IF NOT EXISTS idx_core_memory_fork_runs_trace ON core_memory_compression_fork_runs (trace_id, started_at DESC, id DESC)',
        'CREATE INDEX IF NOT EXISTS idx_core_memory_fork_runs_run ON core_memory_compression_fork_runs (run_id, started_at DESC, id DESC)',
        'CREATE INDEX IF NOT EXISTS idx_core_memory_fork_items_run_index ON core_memory_compression_fork_items (fork_run_id, item_index)',
        'CREATE INDEX IF NOT EXISTS idx_core_memory_fork_items_tool_call ON core_memory_compression_fork_items (tool_call_id)',
        'CREATE INDEX IF NOT EXISTS idx_core_memory_fork_items_slice ON core_memory_compression_fork_items (llm_request_slice_id)',
        'CREATE INDEX IF NOT EXISTS idx_core_memory_fork_slices_run_turn ON core_memory_compression_fork_slices (fork_run_id, agent_turn, id)',
        'CREATE INDEX IF NOT EXISTS idx_core_memory_fork_tool_run_time ON core_memory_compression_fork_tool_executions (fork_run_id, started_at DESC, id DESC)',
        'CREATE INDEX IF NOT EXISTS idx_core_memory_fork_tool_call ON core_memory_compression_fork_tool_executions (tool_call_id)',
        'CREATE INDEX IF NOT EXISTS idx_core_memory_fork_tool_slice ON core_memory_compression_fork_tool_executions (llm_request_slice_id)'
      ]);
    });
  }

  async function getAgentStackHead(input = {}, config = {}) {
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        'SELECT COALESCE(MAX(stack_index), 0) AS stack_index FROM agent_stack_items WHERE identity_key = ?',
        [firstString(input.identityKey, input.identity_key, 'xiaoni')]
      );
      return Number(rows[0]?.stack_index || 0);
    });
  }

  async function appendAgentStackItems(input = {}, config = {}) {
    const rawItems = Array.isArray(input.items)
      ? input.items
      : input.item
        ? [input.item]
        : [];
    if (rawItems.length === 0) {
      return [];
    }
    await ensureXiaoniAgentStackSchema(input, config);
    const identityKey = firstString(input.identityKey, input.identity_key, 'xiaoni');

    return withSql(input, config, async (sql) => {
      const appendWithExecutor = async (executor) => {
        if (typeof executor.query === 'function') {
          await executor.query('SELECT pg_advisory_xact_lock(hashtext(?))', [`agent_stack_items:${identityKey}`]).catch(() => []);
        }
        const headRows = await executor.query(
          'SELECT COALESCE(MAX(stack_index), 0) AS stack_index FROM agent_stack_items WHERE identity_key = ?',
          [identityKey]
        );
        let nextIndex = Number(headRows[0]?.stack_index || 0) + 1;
        const rows = [];
        for (const item of rawItems) {
          const row = await executor.query(
            `
              INSERT INTO agent_stack_items (
                event_id,
                identity_key,
                stack_index,
                item_kind,
                role,
                phase,
                provider_item_id,
                tool_call_id,
                llm_request_slice_id,
                content,
                visibility,
                source_type,
                source_id,
                trace_id,
                run_id,
                conversation_id,
                metadata
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?::jsonb)
              ON CONFLICT (event_id) DO UPDATE SET
                updated_at = agent_stack_items.updated_at
              RETURNING *
            `,
            [
              buildStackEventId(identityKey, item, nextIndex),
              identityKey,
              nextIndex,
              firstString(item.itemKind, item.item_kind, item.kind, 'state_event'),
              firstString(item.role),
              firstString(item.phase),
              firstString(item.providerItemId, item.provider_item_id, item.id),
              firstString(item.toolCallId, item.tool_call_id, item.call_id),
              firstString(item.llmRequestSliceId, item.llm_request_slice_id, input.llmRequestSliceId, input.llm_request_slice_id),
              JSON.stringify(normalizeValue(item.content ?? item.payload ?? {})),
              firstString(item.visibility, input.visibility, 'model_visible'),
              firstString(item.sourceType, item.source_type, input.sourceType, input.source_type),
              firstString(item.sourceId, item.source_id, input.sourceId, input.source_id),
              firstString(item.traceId, item.trace_id, input.traceId, input.trace_id),
              firstString(item.runId, item.run_id, input.runId, input.run_id),
              normalizeBigIntId(item.conversationId ?? item.conversation_id ?? input.conversationId ?? input.conversation_id),
              JSON.stringify(normalizeJsonObject(item.metadata, {}))
            ]
          );
          nextIndex += 1;
          if (row[0]) {
            rows.push(row[0]);
          }
        }
        return rows.map(normalizeStackRow).filter(Boolean);
      };

      if (typeof sql.withTransaction === 'function') {
        return sql.withTransaction(appendWithExecutor);
      }
      return appendWithExecutor(sql);
    });
  }

  async function appendAgentStackItem(input = {}, config = {}) {
    const rows = await appendAgentStackItems({
      ...input,
      items: [input]
    }, config);
    return rows[0] || null;
  }

  async function recordLlmRequestSlice(input = {}, config = {}) {
    await ensureXiaoniAgentStackSchema(input, config);
    const sliceId = buildSliceId(input);
    const completedAt = input.completedAt || input.completed_at || (firstString(input.status, 'completed') === 'running' ? null : new Date());
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          INSERT INTO llm_request_slices (
            slice_id,
            llm_call_id,
            identity_key,
            input_start_index,
            input_end_index,
            input_stack_item_ids,
            output_start_index,
            output_end_index,
            canonical_request,
            wire_request,
            canonical_response,
            wire_response,
            raw_response,
            output_items,
            status,
            token_usage,
            trace_id,
            run_id,
            conversation_id,
            agent_turn,
            model_name,
            model_provider,
            request_format_version,
            wire_provider_format,
            processing_time_ms,
            metadata,
            completed_at
          )
          VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::timestamp)
          ON CONFLICT (slice_id) DO UPDATE SET
            llm_call_id = EXCLUDED.llm_call_id,
            input_start_index = EXCLUDED.input_start_index,
            input_end_index = EXCLUDED.input_end_index,
            input_stack_item_ids = EXCLUDED.input_stack_item_ids,
            output_start_index = EXCLUDED.output_start_index,
            output_end_index = EXCLUDED.output_end_index,
            canonical_request = EXCLUDED.canonical_request,
            wire_request = EXCLUDED.wire_request,
            canonical_response = EXCLUDED.canonical_response,
            wire_response = EXCLUDED.wire_response,
            raw_response = EXCLUDED.raw_response,
            output_items = EXCLUDED.output_items,
            status = EXCLUDED.status,
            token_usage = EXCLUDED.token_usage,
            trace_id = EXCLUDED.trace_id,
            run_id = EXCLUDED.run_id,
            conversation_id = EXCLUDED.conversation_id,
            agent_turn = EXCLUDED.agent_turn,
            model_name = EXCLUDED.model_name,
            model_provider = EXCLUDED.model_provider,
            request_format_version = EXCLUDED.request_format_version,
            wire_provider_format = EXCLUDED.wire_provider_format,
            processing_time_ms = EXCLUDED.processing_time_ms,
            metadata = EXCLUDED.metadata,
            completed_at = COALESCE(EXCLUDED.completed_at, llm_request_slices.completed_at),
            updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `,
        [
          sliceId,
          firstString(input.llmCallId, input.llm_call_id),
          firstString(input.identityKey, input.identity_key, 'xiaoni'),
          normalizeInteger(input.inputStartIndex ?? input.input_start_index),
          normalizeInteger(input.inputEndIndex ?? input.input_end_index),
          JSON.stringify(normalizeJsonArray(input.inputStackItemIds ?? input.input_stack_item_ids, [])),
          normalizeInteger(input.outputStartIndex ?? input.output_start_index),
          normalizeInteger(input.outputEndIndex ?? input.output_end_index),
          JSON.stringify(normalizeValue(input.canonicalRequest ?? input.canonical_request ?? {})),
          input.wireRequest || input.wire_request ? JSON.stringify(normalizeValue(input.wireRequest ?? input.wire_request)) : null,
          input.canonicalResponse || input.canonical_response ? JSON.stringify(normalizeValue(input.canonicalResponse ?? input.canonical_response)) : null,
          input.wireResponse || input.wire_response ? JSON.stringify(normalizeValue(input.wireResponse ?? input.wire_response)) : null,
          input.rawResponse || input.raw_response ? JSON.stringify(normalizeValue(input.rawResponse ?? input.raw_response)) : null,
          JSON.stringify(normalizeJsonArray(input.outputItems ?? input.output_items, [])),
          firstString(input.status, 'completed'),
          JSON.stringify(normalizeJsonObject(input.tokenUsage ?? input.token_usage ?? input.usage, {})),
          firstString(input.traceId, input.trace_id),
          firstString(input.runId, input.run_id),
          normalizeBigIntId(input.conversationId ?? input.conversation_id),
          normalizeInteger(input.agentTurn ?? input.agent_turn),
          firstString(input.modelName, input.model_name),
          firstString(input.modelProvider, input.model_provider),
          firstString(input.requestFormatVersion, input.request_format_version),
          firstString(input.wireProviderFormat, input.wire_provider_format),
          normalizeInteger(input.processingTimeMs ?? input.processing_time_ms),
          JSON.stringify(normalizeJsonObject(input.metadata, {})),
          normalizeDate(completedAt)
        ]
      );
      return normalizeLlmSliceRow(rows[0]);
    });
  }

  async function updateLlmRequestSliceStackLinks(input = {}, config = {}) {
    await ensureXiaoniAgentStackSchema(input, config);
    const sliceId = firstString(input.sliceId, input.slice_id, input.llmCallId, input.llm_call_id);
    if (!sliceId) {
      return null;
    }
    const inputStackItemIdsValue = input.inputStackItemIds ?? input.input_stack_item_ids;
    const shouldUpdateInputStackItemIds = Array.isArray(inputStackItemIdsValue);
    const inputStackItemIds = shouldUpdateInputStackItemIds
      ? normalizeJsonArray(inputStackItemIdsValue, [])
      : [];
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          UPDATE llm_request_slices
          SET
            input_start_index = COALESCE(?, input_start_index),
            input_end_index = COALESCE(?, input_end_index),
            input_stack_item_ids = CASE WHEN ? THEN ?::jsonb ELSE input_stack_item_ids END,
            output_start_index = COALESCE(?, output_start_index),
            output_end_index = COALESCE(?, output_end_index),
            updated_at = CURRENT_TIMESTAMP
          WHERE slice_id = ?
          RETURNING *
        `,
        [
          normalizeInteger(input.inputStartIndex ?? input.input_start_index),
          normalizeInteger(input.inputEndIndex ?? input.input_end_index),
          shouldUpdateInputStackItemIds,
          JSON.stringify(inputStackItemIds),
          normalizeInteger(input.outputStartIndex ?? input.output_start_index),
          normalizeInteger(input.outputEndIndex ?? input.output_end_index),
          sliceId
        ]
      );
      return normalizeLlmSliceRow(rows[0]);
    });
  }

  async function recordToolExecution(input = {}, config = {}) {
    await ensureXiaoniAgentStackSchema(input, config);
    const executionId = buildToolExecutionId(input);
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          INSERT INTO tool_executions (
            execution_id,
            identity_key,
            llm_request_slice_id,
            llm_call_id,
            tool_call_id,
            tool_name,
            arguments,
            raw_arguments,
            result,
            status,
            error_message,
            side_effect,
            trace_id,
            run_id,
            conversation_id,
            agent_turn,
            stack_call_item_id,
            stack_output_item_id,
            metadata,
            started_at,
            completed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, COALESCE(?::timestamp, CURRENT_TIMESTAMP), ?::timestamp)
          ON CONFLICT (execution_id) DO UPDATE SET
            llm_request_slice_id = EXCLUDED.llm_request_slice_id,
            llm_call_id = EXCLUDED.llm_call_id,
            tool_call_id = EXCLUDED.tool_call_id,
            tool_name = EXCLUDED.tool_name,
            arguments = EXCLUDED.arguments,
            raw_arguments = EXCLUDED.raw_arguments,
            result = EXCLUDED.result,
            status = EXCLUDED.status,
            error_message = EXCLUDED.error_message,
            side_effect = EXCLUDED.side_effect,
            trace_id = EXCLUDED.trace_id,
            run_id = EXCLUDED.run_id,
            conversation_id = EXCLUDED.conversation_id,
            agent_turn = EXCLUDED.agent_turn,
            stack_call_item_id = COALESCE(EXCLUDED.stack_call_item_id, tool_executions.stack_call_item_id),
            stack_output_item_id = COALESCE(EXCLUDED.stack_output_item_id, tool_executions.stack_output_item_id),
            metadata = EXCLUDED.metadata,
            completed_at = COALESCE(EXCLUDED.completed_at, tool_executions.completed_at),
            updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `,
        [
          executionId,
          firstString(input.identityKey, input.identity_key, 'xiaoni'),
          firstString(input.llmRequestSliceId, input.llm_request_slice_id),
          firstString(input.llmCallId, input.llm_call_id),
          firstString(input.toolCallId, input.tool_call_id),
          firstString(input.toolName, input.tool_name, 'unknown'),
          JSON.stringify(normalizeJsonObject(input.arguments, {})),
          firstString(input.rawArguments, input.raw_arguments),
          JSON.stringify(normalizeJsonObject(input.result, {})),
          firstString(input.status, 'running'),
          firstString(input.errorMessage, input.error_message),
          normalizeBoolean(input.sideEffect ?? input.side_effect),
          firstString(input.traceId, input.trace_id),
          firstString(input.runId, input.run_id),
          normalizeBigIntId(input.conversationId ?? input.conversation_id),
          normalizeInteger(input.agentTurn ?? input.agent_turn),
          normalizeBigIntId(input.stackCallItemId ?? input.stack_call_item_id),
          normalizeBigIntId(input.stackOutputItemId ?? input.stack_output_item_id),
          JSON.stringify(normalizeJsonObject(input.metadata, {})),
          normalizeDate(input.startedAt || input.started_at),
          normalizeDate(input.completedAt || input.completed_at || (firstString(input.status) === 'completed' || firstString(input.status) === 'failed' ? new Date() : null))
        ]
      );
      return normalizeToolExecutionRow(rows[0]);
    });
  }

  async function completeToolExecution(input = {}, config = {}) {
    const executionId = firstString(input.executionId, input.execution_id);
    if (!executionId) {
      return null;
    }
    await ensureXiaoniAgentStackSchema(input, config);
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          UPDATE tool_executions
          SET status = ?,
              result = ?::jsonb,
              error_message = ?,
              stack_output_item_id = COALESCE(?, stack_output_item_id),
              completed_at = COALESCE(?::timestamp, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
          WHERE execution_id = ?
          RETURNING *
        `,
        [
          firstString(input.status, 'completed'),
          JSON.stringify(normalizeJsonObject(input.result, {})),
          firstString(input.errorMessage, input.error_message),
          normalizeBigIntId(input.stackOutputItemId ?? input.stack_output_item_id),
          normalizeDate(input.completedAt || input.completed_at),
          executionId
        ]
      );
      return normalizeToolExecutionRow(rows[0]);
    });
  }

  async function recordCoreMemoryCompressionForkRun(input = {}, config = {}) {
    await ensureXiaoniAgentStackSchema(input, config);
    const forkRunId = buildCompressionForkRunId(input);
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          INSERT INTO core_memory_compression_fork_runs (
            fork_run_id,
            identity_key,
            context_session_key,
            status,
            trace_id,
            run_id,
            conversation_id,
            read_cutoff_after_conversation_id,
            previous_read_cutoff_after_conversation_id,
            summary_text,
            artifact,
            error_message,
            metadata,
            started_at,
            completed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?::jsonb, COALESCE(?::timestamp, CURRENT_TIMESTAMP), ?::timestamp)
          ON CONFLICT (fork_run_id) DO UPDATE SET
            context_session_key = COALESCE(EXCLUDED.context_session_key, core_memory_compression_fork_runs.context_session_key),
            status = EXCLUDED.status,
            trace_id = COALESCE(EXCLUDED.trace_id, core_memory_compression_fork_runs.trace_id),
            run_id = COALESCE(EXCLUDED.run_id, core_memory_compression_fork_runs.run_id),
            conversation_id = COALESCE(EXCLUDED.conversation_id, core_memory_compression_fork_runs.conversation_id),
            read_cutoff_after_conversation_id = COALESCE(EXCLUDED.read_cutoff_after_conversation_id, core_memory_compression_fork_runs.read_cutoff_after_conversation_id),
            previous_read_cutoff_after_conversation_id = COALESCE(EXCLUDED.previous_read_cutoff_after_conversation_id, core_memory_compression_fork_runs.previous_read_cutoff_after_conversation_id),
            summary_text = COALESCE(EXCLUDED.summary_text, core_memory_compression_fork_runs.summary_text),
            artifact = EXCLUDED.artifact,
            error_message = EXCLUDED.error_message,
            metadata = EXCLUDED.metadata,
            completed_at = COALESCE(EXCLUDED.completed_at, core_memory_compression_fork_runs.completed_at),
            updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `,
        [
          forkRunId,
          firstString(input.identityKey, input.identity_key, 'xiaoni'),
          firstString(input.contextSessionKey, input.context_session_key),
          firstString(input.status, 'running'),
          firstString(input.traceId, input.trace_id),
          firstString(input.runId, input.run_id),
          normalizeBigIntId(input.conversationId ?? input.conversation_id),
          normalizeBigIntId(input.readCutoffAfterConversationId ?? input.read_cutoff_after_conversation_id),
          normalizeBigIntId(input.previousReadCutoffAfterConversationId ?? input.previous_read_cutoff_after_conversation_id),
          firstString(input.summaryText, input.summary_text),
          JSON.stringify(normalizeJsonObject(input.artifact, {})),
          firstString(input.errorMessage, input.error_message),
          JSON.stringify(normalizeJsonObject(input.metadata, {})),
          normalizeDate(input.startedAt || input.started_at),
          normalizeDate(input.completedAt || input.completed_at || (firstString(input.status) === 'completed' || firstString(input.status) === 'failed' ? new Date() : null))
        ]
      );
      return normalizeCompressionForkRunRow(rows[0]);
    });
  }

  async function completeCoreMemoryCompressionForkRun(input = {}, config = {}) {
    const forkRunId = firstString(input.forkRunId, input.fork_run_id);
    if (!forkRunId) {
      return null;
    }
    await ensureXiaoniAgentStackSchema(input, config);
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          UPDATE core_memory_compression_fork_runs
          SET status = ?,
              summary_text = COALESCE(?, summary_text),
              artifact = ?::jsonb,
              error_message = ?,
              metadata = ?::jsonb,
              completed_at = COALESCE(?::timestamp, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
          WHERE fork_run_id = ?
          RETURNING *
        `,
        [
          firstString(input.status, 'completed'),
          firstString(input.summaryText, input.summary_text),
          JSON.stringify(normalizeJsonObject(input.artifact, {})),
          firstString(input.errorMessage, input.error_message),
          JSON.stringify(normalizeJsonObject(input.metadata, {})),
          normalizeDate(input.completedAt || input.completed_at),
          forkRunId
        ]
      );
      return normalizeCompressionForkRunRow(rows[0]);
    });
  }

  async function appendCoreMemoryCompressionForkItems(input = {}, config = {}) {
    const rawItems = Array.isArray(input.items)
      ? input.items
      : input.item
        ? [input.item]
        : [];
    const forkRunId = firstString(input.forkRunId, input.fork_run_id);
    if (!forkRunId || rawItems.length === 0) {
      return [];
    }
    await ensureXiaoniAgentStackSchema(input, config);
    const identityKey = firstString(input.identityKey, input.identity_key, 'xiaoni');

    return withSql(input, config, async (sql) => {
      const appendWithExecutor = async (executor) => {
        if (typeof executor.query === 'function') {
          await executor.query('SELECT pg_advisory_xact_lock(hashtext(?))', [`core_memory_compression_fork_items:${forkRunId}`]).catch(() => []);
        }
        const headRows = await executor.query(
          'SELECT COALESCE(MAX(item_index), 0) AS item_index FROM core_memory_compression_fork_items WHERE fork_run_id = ?',
          [forkRunId]
        );
        let nextIndex = Number(headRows[0]?.item_index || 0) + 1;
        const rows = [];
        for (const item of rawItems) {
          const row = await executor.query(
            `
              INSERT INTO core_memory_compression_fork_items (
                event_id,
                fork_run_id,
                identity_key,
                item_index,
                item_kind,
                role,
                phase,
                provider_item_id,
                tool_call_id,
                llm_request_slice_id,
                content,
                visibility,
                source_type,
                source_id,
                trace_id,
                run_id,
                conversation_id,
                metadata
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?::jsonb)
              RETURNING *
            `,
            [
              buildCompressionForkItemEventId(forkRunId, item, nextIndex),
              forkRunId,
              identityKey,
              nextIndex,
              firstString(item.itemKind, item.item_kind, item.kind, 'state_event'),
              firstString(item.role),
              firstString(item.phase),
              firstString(item.providerItemId, item.provider_item_id, item.id),
              firstString(item.toolCallId, item.tool_call_id, item.call_id),
              firstString(item.llmRequestSliceId, item.llm_request_slice_id, input.llmRequestSliceId, input.llm_request_slice_id),
              JSON.stringify(normalizeValue(item.content ?? item.payload ?? {})),
              firstString(item.visibility, input.visibility, 'model_visible'),
              firstString(item.sourceType, item.source_type, input.sourceType, input.source_type),
              firstString(item.sourceId, item.source_id, input.sourceId, input.source_id),
              firstString(item.traceId, item.trace_id, input.traceId, input.trace_id),
              firstString(item.runId, item.run_id, input.runId, input.run_id),
              normalizeBigIntId(item.conversationId ?? item.conversation_id ?? input.conversationId ?? input.conversation_id),
              JSON.stringify(normalizeJsonObject(item.metadata, {}))
            ]
          );
          nextIndex += 1;
          if (row[0]) {
            rows.push(row[0]);
          }
        }
        return rows.map(normalizeCompressionForkItemRow).filter(Boolean);
      };

      if (typeof sql.withTransaction === 'function') {
        return sql.withTransaction(appendWithExecutor);
      }
      return appendWithExecutor(sql);
    });
  }

  async function recordCoreMemoryCompressionForkSlice(input = {}, config = {}) {
    const forkRunId = firstString(input.forkRunId, input.fork_run_id);
    if (!forkRunId) {
      return null;
    }
    await ensureXiaoniAgentStackSchema(input, config);
    const sliceId = buildSliceId(input);
    const completedAt = input.completedAt || input.completed_at || (firstString(input.status, 'completed') === 'running' ? null : new Date());
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          INSERT INTO core_memory_compression_fork_slices (
            slice_id,
            fork_run_id,
            llm_call_id,
            identity_key,
            input_start_index,
            input_end_index,
            input_stack_item_ids,
            output_start_index,
            output_end_index,
            canonical_request,
            wire_request,
            canonical_response,
            wire_response,
            raw_response,
            output_items,
            status,
            token_usage,
            trace_id,
            run_id,
            conversation_id,
            agent_turn,
            model_name,
            model_provider,
            request_format_version,
            wire_provider_format,
            processing_time_ms,
            metadata,
            completed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::timestamp)
          ON CONFLICT (slice_id) DO UPDATE SET
            fork_run_id = EXCLUDED.fork_run_id,
            llm_call_id = EXCLUDED.llm_call_id,
            input_start_index = EXCLUDED.input_start_index,
            input_end_index = EXCLUDED.input_end_index,
            input_stack_item_ids = EXCLUDED.input_stack_item_ids,
            output_start_index = EXCLUDED.output_start_index,
            output_end_index = EXCLUDED.output_end_index,
            canonical_request = EXCLUDED.canonical_request,
            wire_request = EXCLUDED.wire_request,
            canonical_response = EXCLUDED.canonical_response,
            wire_response = EXCLUDED.wire_response,
            raw_response = EXCLUDED.raw_response,
            output_items = EXCLUDED.output_items,
            status = EXCLUDED.status,
            token_usage = EXCLUDED.token_usage,
            trace_id = EXCLUDED.trace_id,
            run_id = EXCLUDED.run_id,
            conversation_id = EXCLUDED.conversation_id,
            agent_turn = EXCLUDED.agent_turn,
            model_name = EXCLUDED.model_name,
            model_provider = EXCLUDED.model_provider,
            request_format_version = EXCLUDED.request_format_version,
            wire_provider_format = EXCLUDED.wire_provider_format,
            processing_time_ms = EXCLUDED.processing_time_ms,
            metadata = EXCLUDED.metadata,
            completed_at = COALESCE(EXCLUDED.completed_at, core_memory_compression_fork_slices.completed_at),
            updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `,
        [
          sliceId,
          forkRunId,
          firstString(input.llmCallId, input.llm_call_id),
          firstString(input.identityKey, input.identity_key, 'xiaoni'),
          normalizeInteger(input.inputStartIndex ?? input.input_start_index),
          normalizeInteger(input.inputEndIndex ?? input.input_end_index),
          JSON.stringify(normalizeJsonArray(input.inputStackItemIds ?? input.input_stack_item_ids, [])),
          normalizeInteger(input.outputStartIndex ?? input.output_start_index),
          normalizeInteger(input.outputEndIndex ?? input.output_end_index),
          JSON.stringify(normalizeValue(input.canonicalRequest ?? input.canonical_request ?? {})),
          input.wireRequest || input.wire_request ? JSON.stringify(normalizeValue(input.wireRequest ?? input.wire_request)) : null,
          input.canonicalResponse || input.canonical_response ? JSON.stringify(normalizeValue(input.canonicalResponse ?? input.canonical_response)) : null,
          input.wireResponse || input.wire_response ? JSON.stringify(normalizeValue(input.wireResponse ?? input.wire_response)) : null,
          input.rawResponse || input.raw_response ? JSON.stringify(normalizeValue(input.rawResponse ?? input.raw_response)) : null,
          JSON.stringify(normalizeJsonArray(input.outputItems ?? input.output_items, [])),
          firstString(input.status, 'completed'),
          JSON.stringify(normalizeJsonObject(input.tokenUsage ?? input.token_usage ?? input.usage, {})),
          firstString(input.traceId, input.trace_id),
          firstString(input.runId, input.run_id),
          normalizeBigIntId(input.conversationId ?? input.conversation_id),
          normalizeInteger(input.agentTurn ?? input.agent_turn),
          firstString(input.modelName, input.model_name),
          firstString(input.modelProvider, input.model_provider),
          firstString(input.requestFormatVersion, input.request_format_version),
          firstString(input.wireProviderFormat, input.wire_provider_format),
          normalizeInteger(input.processingTimeMs ?? input.processing_time_ms),
          JSON.stringify(normalizeJsonObject(input.metadata, {})),
          normalizeDate(completedAt)
        ]
      );
      return normalizeCompressionForkSliceRow(rows[0]);
    });
  }

  async function recordCoreMemoryCompressionForkToolExecution(input = {}, config = {}) {
    const forkRunId = firstString(input.forkRunId, input.fork_run_id);
    if (!forkRunId) {
      return null;
    }
    await ensureXiaoniAgentStackSchema(input, config);
    const executionId = buildToolExecutionId(input);
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          INSERT INTO core_memory_compression_fork_tool_executions (
            execution_id,
            fork_run_id,
            identity_key,
            llm_request_slice_id,
            llm_call_id,
            tool_call_id,
            tool_name,
            arguments,
            raw_arguments,
            result,
            status,
            error_message,
            side_effect,
            trace_id,
            run_id,
            conversation_id,
            agent_turn,
            stack_call_item_id,
            stack_output_item_id,
            metadata,
            started_at,
            completed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, COALESCE(?::timestamp, CURRENT_TIMESTAMP), ?::timestamp)
          ON CONFLICT (execution_id) DO UPDATE SET
            fork_run_id = EXCLUDED.fork_run_id,
            llm_request_slice_id = EXCLUDED.llm_request_slice_id,
            llm_call_id = EXCLUDED.llm_call_id,
            tool_call_id = EXCLUDED.tool_call_id,
            tool_name = EXCLUDED.tool_name,
            arguments = EXCLUDED.arguments,
            raw_arguments = EXCLUDED.raw_arguments,
            result = EXCLUDED.result,
            status = EXCLUDED.status,
            error_message = EXCLUDED.error_message,
            side_effect = EXCLUDED.side_effect,
            trace_id = EXCLUDED.trace_id,
            run_id = EXCLUDED.run_id,
            conversation_id = EXCLUDED.conversation_id,
            agent_turn = EXCLUDED.agent_turn,
            stack_call_item_id = COALESCE(EXCLUDED.stack_call_item_id, core_memory_compression_fork_tool_executions.stack_call_item_id),
            stack_output_item_id = COALESCE(EXCLUDED.stack_output_item_id, core_memory_compression_fork_tool_executions.stack_output_item_id),
            metadata = EXCLUDED.metadata,
            completed_at = COALESCE(EXCLUDED.completed_at, core_memory_compression_fork_tool_executions.completed_at),
            updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `,
        [
          executionId,
          forkRunId,
          firstString(input.identityKey, input.identity_key, 'xiaoni'),
          firstString(input.llmRequestSliceId, input.llm_request_slice_id),
          firstString(input.llmCallId, input.llm_call_id),
          firstString(input.toolCallId, input.tool_call_id),
          firstString(input.toolName, input.tool_name, 'unknown'),
          JSON.stringify(normalizeJsonObject(input.arguments, {})),
          firstString(input.rawArguments, input.raw_arguments),
          JSON.stringify(normalizeJsonObject(input.result, {})),
          firstString(input.status, 'running'),
          firstString(input.errorMessage, input.error_message),
          normalizeBoolean(input.sideEffect ?? input.side_effect),
          firstString(input.traceId, input.trace_id),
          firstString(input.runId, input.run_id),
          normalizeBigIntId(input.conversationId ?? input.conversation_id),
          normalizeInteger(input.agentTurn ?? input.agent_turn),
          normalizeBigIntId(input.stackCallItemId ?? input.stack_call_item_id),
          normalizeBigIntId(input.stackOutputItemId ?? input.stack_output_item_id),
          JSON.stringify(normalizeJsonObject(input.metadata, {})),
          normalizeDate(input.startedAt || input.started_at),
          normalizeDate(input.completedAt || input.completed_at || (firstString(input.status) === 'completed' || firstString(input.status) === 'failed' ? new Date() : null))
        ]
      );
      return normalizeCompressionForkToolExecutionRow(rows[0]);
    });
  }

  async function completeCoreMemoryCompressionForkToolExecution(input = {}, config = {}) {
    const executionId = firstString(input.executionId, input.execution_id);
    if (!executionId) {
      return null;
    }
    await ensureXiaoniAgentStackSchema(input, config);
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          UPDATE core_memory_compression_fork_tool_executions
          SET status = ?,
              result = ?::jsonb,
              error_message = ?,
              stack_output_item_id = COALESCE(?, stack_output_item_id),
              completed_at = COALESCE(?::timestamp, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
          WHERE execution_id = ?
          RETURNING *
        `,
        [
          firstString(input.status, 'completed'),
          JSON.stringify(normalizeJsonObject(input.result, {})),
          firstString(input.errorMessage, input.error_message),
          normalizeBigIntId(input.stackOutputItemId ?? input.stack_output_item_id),
          normalizeDate(input.completedAt || input.completed_at),
          executionId
        ]
      );
      return normalizeCompressionForkToolExecutionRow(rows[0]);
    });
  }

  function appendTimeClauses(clauses, params, input, expression) {
    const startTime = normalizeDateFilter(input.startTime || input.start_time || input.since || input.from);
    const endTime = normalizeDateFilter(input.endTime || input.end_time || input.until || input.to);
    if (startTime) {
      clauses.push(`${expression} >= ?`);
      params.push(startTime);
    }
    if (endTime) {
      clauses.push(`${expression} <= ?`);
      params.push(endTime);
    }
  }

  async function listAgentStackItems(input = {}, config = {}) {
    await ensureXiaoniAgentStackSchema(input, config);
    const clauses = ['identity_key = ?'];
    const params = [firstString(input.identityKey, input.identity_key, 'xiaoni')];
    const limit = Math.max(1, Math.min(Number.parseInt(String(input.limit || 100), 10) || 100, 1000));
    const traceId = firstString(input.traceId, input.trace_id);
    const runId = firstString(input.runId, input.run_id);
    const itemKind = firstString(input.itemKind, input.item_kind);
    const toolCallId = firstString(input.toolCallId, input.tool_call_id);
    const llmRequestSliceId = firstString(input.llmRequestSliceId, input.llm_request_slice_id);
    const eventId = firstString(input.eventId, input.event_id);
    if (traceId) {
      clauses.push('trace_id = ?');
      params.push(traceId);
    }
    if (runId) {
      clauses.push('run_id = ?');
      params.push(runId);
    }
    if (itemKind) {
      clauses.push('item_kind = ?');
      params.push(itemKind);
    }
    if (toolCallId) {
      clauses.push('tool_call_id = ?');
      params.push(toolCallId);
    }
    if (llmRequestSliceId) {
      clauses.push('llm_request_slice_id = ?');
      params.push(llmRequestSliceId);
    }
    if (eventId) {
      clauses.push('event_id = ?');
      params.push(eventId);
    }
    if (input.conversationId || input.conversation_id) {
      clauses.push('conversation_id = ?');
      params.push(normalizeBigIntId(input.conversationId ?? input.conversation_id));
    }
    appendTimeClauses(clauses, params, input, 'created_at');
    params.push(limit);

    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          SELECT *
          FROM agent_stack_items
          WHERE ${clauses.join(' AND ')}
          ORDER BY stack_index ${input.chronological ? 'ASC' : 'DESC'}, id ${input.chronological ? 'ASC' : 'DESC'}
          LIMIT ?
        `,
        params
      );
      return rows.map(normalizeStackRow).filter(Boolean);
    });
  }

  async function listLlmRequestSlices(input = {}, config = {}) {
    await ensureXiaoniAgentStackSchema(input, config);
    const clauses = ['identity_key = ?'];
    const params = [firstString(input.identityKey, input.identity_key, 'xiaoni')];
    const limit = Math.max(1, Math.min(Number.parseInt(String(input.limit || 100), 10) || 100, 1000));
    const summaryOnly = input.summaryOnly === true || input.summary_only === true;
    const rawTraceOnly = input.rawTraceOnly === true || input.raw_trace_only === true;
    const selectColumns = rawTraceOnly
      ? `
          id,
          slice_id,
          llm_call_id,
          identity_key,
          NULL::bigint AS input_start_index,
          NULL::bigint AS input_end_index,
          '[]'::jsonb AS input_stack_item_ids,
          NULL::bigint AS output_start_index,
          NULL::bigint AS output_end_index,
          '{}'::jsonb AS canonical_request,
          wire_request,
          NULL::jsonb AS canonical_response,
          wire_response,
          raw_response,
          '[]'::jsonb AS output_items,
          status,
          token_usage,
          trace_id,
          run_id,
          conversation_id,
          agent_turn,
          model_name,
          model_provider,
          request_format_version,
          wire_provider_format,
          processing_time_ms,
          metadata,
          created_at,
          completed_at,
          updated_at
        `
      : summaryOnly
      ? `
          id,
          slice_id,
          llm_call_id,
          identity_key,
          input_start_index,
          input_end_index,
          '[]'::jsonb AS input_stack_item_ids,
          output_start_index,
          output_end_index,
          '{}'::jsonb AS canonical_request,
          NULL::jsonb AS wire_request,
          NULL::jsonb AS canonical_response,
          NULL::jsonb AS wire_response,
          NULL::jsonb AS raw_response,
          '[]'::jsonb AS output_items,
          status,
          token_usage,
          trace_id,
          run_id,
          conversation_id,
          agent_turn,
          model_name,
          model_provider,
          request_format_version,
          wire_provider_format,
          processing_time_ms,
          metadata,
          created_at,
          completed_at,
          updated_at
        `
      : '*';
    const traceId = firstString(input.traceId, input.trace_id);
    const runId = firstString(input.runId, input.run_id);
    const llmCallId = firstString(input.llmCallId, input.llm_call_id);
    const sliceId = firstString(input.sliceId, input.slice_id);
    if (traceId) {
      clauses.push('trace_id = ?');
      params.push(traceId);
    }
    if (runId) {
      clauses.push('run_id = ?');
      params.push(runId);
    }
    if (llmCallId) {
      clauses.push('llm_call_id = ?');
      params.push(llmCallId);
    }
    if (sliceId) {
      clauses.push('slice_id = ?');
      params.push(sliceId);
    }
    if (input.conversationId || input.conversation_id) {
      clauses.push('conversation_id = ?');
      params.push(normalizeBigIntId(input.conversationId ?? input.conversation_id));
    }
    appendTimeClauses(clauses, params, input, 'created_at');
    params.push(limit);

    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          SELECT ${selectColumns}
          FROM llm_request_slices
          WHERE ${clauses.join(' AND ')}
          ORDER BY COALESCE(agent_turn, 0) ${input.chronological ? 'ASC' : 'DESC'}, created_at ${input.chronological ? 'ASC' : 'DESC'}, id ${input.chronological ? 'ASC' : 'DESC'}
          LIMIT ?
        `,
        params
      );
      return rows.map(normalizeLlmSliceRow).filter(Boolean);
    });
  }

  async function listToolExecutions(input = {}, config = {}) {
    await ensureXiaoniAgentStackSchema(input, config);
    const clauses = ['identity_key = ?'];
    const params = [firstString(input.identityKey, input.identity_key, 'xiaoni')];
    const limit = Math.max(1, Math.min(Number.parseInt(String(input.limit || 100), 10) || 100, 1000));
    const traceId = firstString(input.traceId, input.trace_id);
    const runId = firstString(input.runId, input.run_id);
    const toolCallId = firstString(input.toolCallId, input.tool_call_id);
    const executionId = firstString(input.executionId, input.execution_id);
    const llmRequestSliceId = firstString(input.llmRequestSliceId, input.llm_request_slice_id);
    if (traceId) {
      clauses.push('trace_id = ?');
      params.push(traceId);
    }
    if (runId) {
      clauses.push('run_id = ?');
      params.push(runId);
    }
    if (toolCallId) {
      clauses.push('tool_call_id = ?');
      params.push(toolCallId);
    }
    if (executionId) {
      clauses.push('execution_id = ?');
      params.push(executionId);
    }
    if (llmRequestSliceId) {
      clauses.push('llm_request_slice_id = ?');
      params.push(llmRequestSliceId);
    }
    if (input.conversationId || input.conversation_id) {
      clauses.push('conversation_id = ?');
      params.push(normalizeBigIntId(input.conversationId ?? input.conversation_id));
    }
    appendTimeClauses(clauses, params, input, 'COALESCE(started_at, created_at)');
    params.push(limit);

    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          SELECT *
          FROM tool_executions
          WHERE ${clauses.join(' AND ')}
          ORDER BY COALESCE(started_at, created_at) ${input.chronological ? 'ASC' : 'DESC'}, id ${input.chronological ? 'ASC' : 'DESC'}
          LIMIT ?
        `,
        params
      );
      return rows.map(normalizeToolExecutionRow).filter(Boolean);
    });
  }

  async function findAgentStackItemByEventId(eventId, config = {}) {
    if (typeof eventId !== 'string' || !eventId.trim()) {
      return null;
    }
    const rows = await listAgentStackItems({
      eventId: eventId.trim(),
      limit: 1
    }, config);
    return rows[0] || null;
  }

  async function attachConversationIdToAgentStackByTrace(input = {}, config = {}) {
    const traceId = firstString(input.traceId, input.trace_id);
    const conversationId = normalizeBigIntId(input.conversationId ?? input.conversation_id);
    if (!traceId || conversationId === null) {
      return 0;
    }
    await ensureXiaoniAgentStackSchema(input, config);
    return withSql(input, config, async (sql) => {
      const updatedStack = await sql.execute(
        'UPDATE agent_stack_items SET conversation_id = COALESCE(conversation_id, ?), updated_at = CURRENT_TIMESTAMP WHERE trace_id = ?',
        [conversationId, traceId]
      );
      const updatedSlices = await sql.execute(
        'UPDATE llm_request_slices SET conversation_id = COALESCE(conversation_id, ?), updated_at = CURRENT_TIMESTAMP WHERE trace_id = ?',
        [conversationId, traceId]
      );
      const updatedTools = await sql.execute(
        'UPDATE tool_executions SET conversation_id = COALESCE(conversation_id, ?), updated_at = CURRENT_TIMESTAMP WHERE trace_id = ?',
        [conversationId, traceId]
      );
      return updatedStack + updatedSlices + updatedTools;
    });
  }

  return {
    ensureXiaoniAgentStackSchema,
    getAgentStackHead,
    appendAgentStackItem,
    appendAgentStackItems,
    recordLlmRequestSlice,
    updateLlmRequestSliceStackLinks,
    recordToolExecution,
    completeToolExecution,
    recordCoreMemoryCompressionForkRun,
    completeCoreMemoryCompressionForkRun,
    appendCoreMemoryCompressionForkItems,
    recordCoreMemoryCompressionForkSlice,
    recordCoreMemoryCompressionForkToolExecution,
    completeCoreMemoryCompressionForkToolExecution,
    listAgentStackItems,
    listLlmRequestSlices,
    listToolExecutions,
    findAgentStackItemByEventId,
    attachConversationIdToAgentStackByTrace
  };
}

module.exports = {
  createXiaoniAgentStackPersistence
};

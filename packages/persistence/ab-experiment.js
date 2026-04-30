'use strict';

const { createHash, randomUUID } = require('crypto');

const SNAPSHOT_STATUS_FIELDS = new Set(['capture_status', 'control_status', 'treatment_status', 'eval_status']);

function normalizeDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === 'string' ? value : String(value);
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeString(value, fallback = '') {
  const normalized = normalizeOptionalString(value);
  return normalized || fallback;
}

function normalizeJsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return fallback;
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeLimit(value, fallback = 50, max = 500) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function stableId(prefix, parts) {
  const hash = createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 40);
  return `${prefix}_${hash}`;
}

function compactObject(input) {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'undefined') {
      output[key] = value;
    }
  }
  return output;
}

function compactOptionalObject(input) {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) {
      output[key] = value;
    }
  }
  return output;
}

function normalizeSnapshot(record) {
  if (!record) {
    return null;
  }
  return {
    id: record.id,
    source_key: record.source_key,
    trace_id: record.trace_id,
    run_id: record.run_id,
    session_key: record.session_key,
    chat_type: record.chat_type,
    peer_id: record.peer_id,
    sender_id: record.sender_id,
    queue_message_ids: record.queue_message_ids || [],
    provider_event_ids: record.provider_event_ids || [],
    scene: record.scene || {},
    memory_stream_view: record.memory_stream_view || {},
    retrieval_policy: record.retrieval_policy || {},
    runtime_config: record.runtime_config || {},
    capture_status: record.capture_status,
    control_status: record.control_status,
    treatment_status: record.treatment_status,
    eval_status: record.eval_status,
    capture_error: record.capture_error,
    created_at: normalizeDate(record.created_at),
    updated_at: normalizeDate(record.updated_at)
  };
}

function normalizeArmRun(record) {
  if (!record) {
    return null;
  }
  return {
    id: record.id,
    snapshot_id: record.snapshot_id,
    arm: record.arm,
    project_or_namespace: record.project_or_namespace,
    runner_name: record.runner_name,
    model_name: record.model_name,
    input_summary: record.input_summary || {},
    output_artifact: record.output_artifact || {},
    memory_context: record.memory_context || {},
    failure: record.failure || null,
    started_at: normalizeDate(record.started_at),
    completed_at: normalizeDate(record.completed_at),
    status: record.status,
    created_at: normalizeDate(record.created_at),
    updated_at: normalizeDate(record.updated_at)
  };
}

function normalizeMemoryItem(record) {
  if (!record) {
    return null;
  }
  return {
    id: record.id,
    namespace: record.namespace,
    arm: record.arm,
    type: record.type,
    subtype: record.subtype,
    content: record.content,
    retrieval_text: record.retrieval_text,
    embedding_text: record.embedding_text,
    importance: Number(record.importance || 0),
    confidence: Number(record.confidence || 0),
    status: record.status,
    source_event_refs: record.source_event_refs || [],
    provenance: record.provenance || {},
    ttl_expires_at: normalizeDate(record.ttl_expires_at),
    fulfilled_at: normalizeDate(record.fulfilled_at),
    created_at: normalizeDate(record.created_at),
    updated_at: normalizeDate(record.updated_at)
  };
}

function normalizeEvalResult(record) {
  if (!record) {
    return null;
  }
  return {
    id: record.id,
    snapshot_id: record.snapshot_id,
    control_arm_run_id: record.control_arm_run_id,
    treatment_arm_run_id: record.treatment_arm_run_id,
    label: record.label,
    dimensions: record.dimensions || {},
    reviewer_notes: record.reviewer_notes,
    isolation_check: record.isolation_check || {},
    fixture_id: record.fixture_id,
    created_at: normalizeDate(record.created_at),
    updated_at: normalizeDate(record.updated_at)
  };
}

function snapshotData(input = {}) {
  return compactObject({
    id: normalizeOptionalString(input.id) || `ab_snap_${Date.now()}_${randomUUID().slice(0, 8)}`,
    source_key: normalizeString(input.sourceKey || input.source_key, null),
    trace_id: normalizeOptionalString(input.traceId || input.trace_id),
    run_id: normalizeOptionalString(input.runId || input.run_id),
    session_key: normalizeOptionalString(input.sessionKey || input.session_key),
    chat_type: normalizeOptionalString(input.chatType || input.chat_type),
    peer_id: normalizeOptionalString(input.peerId || input.peer_id),
    sender_id: normalizeOptionalString(input.senderId || input.sender_id),
    queue_message_ids: normalizeJsonArray(input.queueMessageIds || input.queue_message_ids),
    provider_event_ids: normalizeJsonArray(input.providerEventIds || input.provider_event_ids),
    scene: normalizeJsonObject(input.scene),
    memory_stream_view: normalizeJsonObject(input.memoryStreamView || input.memory_stream_view),
    retrieval_policy: normalizeJsonObject(input.retrievalPolicy || input.retrieval_policy),
    runtime_config: normalizeJsonObject(input.runtimeConfig || input.runtime_config),
    capture_status: normalizeOptionalString(input.captureStatus || input.capture_status) || 'created',
    control_status: normalizeOptionalString(input.controlStatus || input.control_status) || 'pending',
    treatment_status: normalizeOptionalString(input.treatmentStatus || input.treatment_status) || 'pending',
    eval_status: normalizeOptionalString(input.evalStatus || input.eval_status) || 'pending',
    capture_error: normalizeOptionalString(input.captureError || input.capture_error)
  });
}

function armRunData(input = {}) {
  return compactObject({
    id: normalizeOptionalString(input.id) || `ab_arm_${Date.now()}_${randomUUID().slice(0, 8)}`,
    snapshot_id: normalizeString(input.snapshotId || input.snapshot_id, null),
    arm: normalizeString(input.arm, null),
    project_or_namespace: normalizeOptionalString(input.projectOrNamespace || input.project_or_namespace),
    runner_name: normalizeOptionalString(input.runnerName || input.runner_name),
    model_name: normalizeOptionalString(input.modelName || input.model_name),
    input_summary: normalizeJsonObject(input.inputSummary || input.input_summary),
    output_artifact: normalizeJsonObject(input.outputArtifact || input.output_artifact),
    memory_context: normalizeJsonObject(input.memoryContext || input.memory_context),
    failure: input.failure === null ? null : normalizeJsonObject(input.failure, null),
    started_at: input.startedAt || input.started_at || null,
    completed_at: input.completedAt || input.completed_at || null,
    status: normalizeOptionalString(input.status) || 'pending'
  });
}

function memoryItemData(input = {}) {
  return compactObject({
    id: normalizeOptionalString(input.id) || `ab_mem_${Date.now()}_${randomUUID().slice(0, 8)}`,
    namespace: normalizeString(input.namespace, null),
    arm: normalizeString(input.arm, null),
    type: normalizeString(input.type, null),
    subtype: normalizeOptionalString(input.subtype),
    content: typeof input.content === 'string' ? input.content : '',
    retrieval_text: normalizeOptionalString(input.retrievalText || input.retrieval_text),
    embedding_text: normalizeOptionalString(input.embeddingText || input.embedding_text),
    importance: normalizeNumber(input.importance, 0),
    confidence: normalizeNumber(input.confidence, 0),
    status: normalizeOptionalString(input.status) || 'active',
    source_event_refs: normalizeJsonArray(input.sourceEventRefs || input.source_event_refs),
    provenance: normalizeJsonObject(input.provenance),
    ttl_expires_at: input.ttlExpiresAt || input.ttl_expires_at || null,
    fulfilled_at: input.fulfilledAt || input.fulfilled_at || null
  });
}

function evalResultData(input = {}) {
  const snapshotId = normalizeString(input.snapshotId || input.snapshot_id, null);
  const fixtureId = normalizeOptionalString(input.fixtureId || input.fixture_id);
  return compactObject({
    id: normalizeOptionalString(input.id) || (snapshotId && fixtureId ? stableId('ab_eval', [snapshotId, fixtureId]) : `ab_eval_${Date.now()}_${randomUUID().slice(0, 8)}`),
    snapshot_id: snapshotId,
    control_arm_run_id: normalizeOptionalString(input.controlArmRunId || input.control_arm_run_id),
    treatment_arm_run_id: normalizeOptionalString(input.treatmentArmRunId || input.treatment_arm_run_id),
    label: normalizeOptionalString(input.label) || 'unclear',
    dimensions: normalizeJsonObject(input.dimensions),
    reviewer_notes: normalizeOptionalString(input.reviewerNotes || input.reviewer_notes),
    isolation_check: normalizeJsonObject(input.isolationCheck || input.isolation_check),
    fixture_id: fixtureId
  });
}

function createAbExperimentPersistence({ getPrismaClient, createSqlAdapter }) {
  function getClient(config) {
    return getPrismaClient(config);
  }

  async function ensureAbExperimentSchema(config = {}) {
    const sql = createSqlAdapter(config);
    try {
      await sql.query("SELECT pg_advisory_lock(hashtext('qqbot_ab_experiment_schema'))");
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS ab_turn_snapshots (
          id VARCHAR(64) PRIMARY KEY,
          source_key VARCHAR(191) NOT NULL,
          trace_id VARCHAR(128) NULL,
          run_id VARCHAR(128) NULL,
          session_key VARCHAR(191) NULL,
          chat_type VARCHAR(16) NULL,
          peer_id VARCHAR(191) NULL,
          sender_id VARCHAR(191) NULL,
          queue_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          provider_event_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          scene JSONB NOT NULL DEFAULT '{}'::jsonb,
          memory_stream_view JSONB NOT NULL DEFAULT '{}'::jsonb,
          retrieval_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
          runtime_config JSONB NOT NULL DEFAULT '{}'::jsonb,
          capture_status VARCHAR(32) NOT NULL DEFAULT 'created',
          control_status VARCHAR(32) NOT NULL DEFAULT 'pending',
          treatment_status VARCHAR(32) NOT NULL DEFAULT 'pending',
          eval_status VARCHAR(32) NOT NULL DEFAULT 'pending',
          capture_error TEXT NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS ab_arm_runs (
          id VARCHAR(64) PRIMARY KEY,
          snapshot_id VARCHAR(64) NOT NULL REFERENCES ab_turn_snapshots(id) ON DELETE CASCADE,
          arm VARCHAR(32) NOT NULL,
          project_or_namespace VARCHAR(191) NULL,
          runner_name VARCHAR(191) NULL,
          model_name VARCHAR(191) NULL,
          input_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
          output_artifact JSONB NOT NULL DEFAULT '{}'::jsonb,
          memory_context JSONB NOT NULL DEFAULT '{}'::jsonb,
          failure JSONB NULL,
          started_at TIMESTAMP(3) NULL,
          completed_at TIMESTAMP(3) NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'pending',
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS ab_memory_stream_items (
          id VARCHAR(64) PRIMARY KEY,
          namespace VARCHAR(191) NOT NULL,
          arm VARCHAR(32) NOT NULL,
          type VARCHAR(32) NOT NULL,
          subtype VARCHAR(64) NULL,
          content TEXT NOT NULL,
          retrieval_text TEXT NULL,
          embedding_text TEXT NULL,
          importance DOUBLE PRECISION NOT NULL DEFAULT 0,
          confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
          status VARCHAR(32) NOT NULL DEFAULT 'active',
          source_event_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
          provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
          ttl_expires_at TIMESTAMP(3) NULL,
          fulfilled_at TIMESTAMP(3) NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS ab_eval_results (
          id VARCHAR(64) PRIMARY KEY,
          snapshot_id VARCHAR(64) NOT NULL REFERENCES ab_turn_snapshots(id) ON DELETE CASCADE,
          control_arm_run_id VARCHAR(64) NULL REFERENCES ab_arm_runs(id) ON DELETE SET NULL,
          treatment_arm_run_id VARCHAR(64) NULL REFERENCES ab_arm_runs(id) ON DELETE SET NULL,
          label VARCHAR(32) NOT NULL,
          dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
          reviewer_notes TEXT NULL,
          isolation_check JSONB NOT NULL DEFAULT '{}'::jsonb,
          fixture_id VARCHAR(191) NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute('CREATE UNIQUE INDEX IF NOT EXISTS uniq_ab_turn_snapshots_source_key ON ab_turn_snapshots (source_key)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_ab_turn_snapshots_trace ON ab_turn_snapshots (trace_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_ab_turn_snapshots_run ON ab_turn_snapshots (run_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_ab_turn_snapshots_session_created ON ab_turn_snapshots (session_key, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_ab_turn_snapshots_treatment_created ON ab_turn_snapshots (treatment_status, created_at DESC)');
      await sql.execute('CREATE UNIQUE INDEX IF NOT EXISTS uniq_ab_arm_runs_snapshot_arm ON ab_arm_runs (snapshot_id, arm)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_ab_arm_runs_arm_status_created ON ab_arm_runs (arm, status, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_ab_arm_runs_model_created ON ab_arm_runs (model_name, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_ab_memory_items_namespace_type_status_updated ON ab_memory_stream_items (namespace, type, status, updated_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_ab_memory_items_arm_namespace_type_status_updated ON ab_memory_stream_items (arm, namespace, type, status, updated_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_ab_memory_items_namespace_ttl ON ab_memory_stream_items (namespace, ttl_expires_at)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_ab_memory_items_namespace_subtype_updated ON ab_memory_stream_items (namespace, subtype, updated_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_ab_eval_results_snapshot ON ab_eval_results (snapshot_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_ab_eval_results_label_created ON ab_eval_results (label, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_ab_eval_results_fixture ON ab_eval_results (fixture_id)');
    } finally {
      await sql.query("SELECT pg_advisory_unlock(hashtext('qqbot_ab_experiment_schema'))").catch(() => undefined);
      await sql.close();
    }
  }

  async function createAbTurnSnapshot(input, config = {}) {
    const prisma = getClient(config);
    const data = snapshotData(input);
    if (!data.source_key) {
      throw new Error('createAbTurnSnapshot requires source_key');
    }
    const created = await prisma.abTurnSnapshot.upsert({
      where: { source_key: data.source_key },
      create: data,
      update: {}
    });
    return normalizeSnapshot(created);
  }

  async function getAbTurnSnapshot(idOrSourceKey, config = {}) {
    const prisma = getClient(config);
    const key = normalizeString(idOrSourceKey, null);
    if (!key) {
      return null;
    }
    const record = await prisma.abTurnSnapshot.findFirst({
      where: { OR: [{ id: key }, { source_key: key }] }
    });
    return normalizeSnapshot(record);
  }

  async function listAbTurnSnapshots(filters = {}, config = {}) {
    const prisma = getClient(config);
    const where = compactOptionalObject({
      trace_id: normalizeOptionalString(filters.traceId || filters.trace_id),
      run_id: normalizeOptionalString(filters.runId || filters.run_id),
      session_key: normalizeOptionalString(filters.sessionKey || filters.session_key),
      chat_type: normalizeOptionalString(filters.chatType || filters.chat_type),
      capture_status: normalizeOptionalString(filters.captureStatus || filters.capture_status),
      control_status: normalizeOptionalString(filters.controlStatus || filters.control_status),
      treatment_status: normalizeOptionalString(filters.treatmentStatus || filters.treatment_status),
      eval_status: normalizeOptionalString(filters.evalStatus || filters.eval_status)
    });
    const records = await prisma.abTurnSnapshot.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: normalizeLimit(filters.limit)
    });
    return records.map(normalizeSnapshot);
  }

  async function upsertAbArmRun(input, config = {}) {
    const prisma = getClient(config);
    const data = armRunData(input);
    if (!data.snapshot_id || !data.arm) {
      throw new Error('upsertAbArmRun requires snapshot_id and arm');
    }
    const updated = await prisma.abArmRun.upsert({
      where: { snapshot_id_arm: { snapshot_id: data.snapshot_id, arm: data.arm } },
      create: data,
      update: compactObject({
        project_or_namespace: data.project_or_namespace,
        runner_name: data.runner_name,
        model_name: data.model_name,
        input_summary: data.input_summary,
        output_artifact: data.output_artifact,
        memory_context: data.memory_context,
        failure: data.failure,
        started_at: data.started_at,
        completed_at: data.completed_at,
        status: data.status
      })
    });
    if (data.arm === 'control' || data.arm === 'treatment') {
      const statusField = `${data.arm}_status`;
      await prisma.abTurnSnapshot.update({
        where: { id: data.snapshot_id },
        data: { [statusField]: data.status }
      }).catch(() => undefined);
    }
    return normalizeArmRun(updated);
  }

  async function getAbArmRunsForSnapshot(snapshotId, config = {}) {
    const prisma = getClient(config);
    const records = await prisma.abArmRun.findMany({
      where: { snapshot_id: normalizeString(snapshotId, null) },
      orderBy: [{ arm: 'asc' }, { created_at: 'desc' }]
    });
    return records.map(normalizeArmRun);
  }

  async function createAbMemoryStreamItem(input, config = {}) {
    const prisma = getClient(config);
    const data = memoryItemData(input);
    if (!data.namespace || !data.arm || !data.type) {
      throw new Error('createAbMemoryStreamItem requires namespace, arm, and type');
    }
    const created = await prisma.abMemoryStreamItem.create({ data });
    return normalizeMemoryItem(created);
  }

  async function listAbMemoryStreamItems(filters = {}, config = {}) {
    const prisma = getClient(config);
    const where = compactObject({
      namespace: normalizeOptionalString(filters.namespace),
      arm: normalizeOptionalString(filters.arm),
      type: normalizeOptionalString(filters.type),
      subtype: normalizeOptionalString(filters.subtype),
      status: normalizeOptionalString(filters.status)
    });
    if (filters.includeExpired !== true) {
      where.OR = [{ ttl_expires_at: null }, { ttl_expires_at: { gt: new Date() } }];
    }
    const records = await prisma.abMemoryStreamItem.findMany({
      where,
      orderBy: [{ importance: 'desc' }, { updated_at: 'desc' }],
      take: normalizeLimit(filters.limit)
    });
    return records.map(normalizeMemoryItem);
  }

  async function markAbMemoryPlanFulfilled(id, params = {}, config = {}) {
    const prisma = getClient(config);
    const updated = await prisma.abMemoryStreamItem.update({
      where: { id: normalizeString(id, null) },
      data: {
        status: normalizeOptionalString(params.status) || 'fulfilled',
        fulfilled_at: params.fulfilledAt || params.fulfilled_at || new Date()
      }
    });
    return normalizeMemoryItem(updated);
  }

  async function createAbEvalResult(input, config = {}) {
    const prisma = getClient(config);
    const data = evalResultData(input);
    if (!data.snapshot_id) {
      throw new Error('createAbEvalResult requires snapshot_id');
    }
    const created = data.fixture_id
      ? await prisma.abEvalResult.upsert({
        where: { id: data.id },
        create: data,
        update: {
          control_arm_run_id: data.control_arm_run_id,
          treatment_arm_run_id: data.treatment_arm_run_id,
          label: data.label,
          dimensions: data.dimensions,
          reviewer_notes: data.reviewer_notes,
          isolation_check: data.isolation_check
        }
      })
      : await prisma.abEvalResult.create({ data });
    await prisma.abTurnSnapshot.update({
      where: { id: data.snapshot_id },
      data: { eval_status: 'completed' }
    }).catch(() => undefined);
    return normalizeEvalResult(created);
  }

  async function getAbExperimentTrace(snapshotId, config = {}) {
    const prisma = getClient(config);
    const id = normalizeString(snapshotId, null);
    const snapshot = await prisma.abTurnSnapshot.findUnique({ where: { id } });
    if (!snapshot) {
      return null;
    }
    const [armRuns, evalResults] = await Promise.all([
      prisma.abArmRun.findMany({
        where: { snapshot_id: id },
        orderBy: [{ arm: 'asc' }, { created_at: 'desc' }]
      }),
      prisma.abEvalResult.findMany({
        where: { snapshot_id: id },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }]
      })
    ]);
    const normalizedArms = armRuns.map(normalizeArmRun);
    return {
      snapshot: normalizeSnapshot(snapshot),
      arm_runs: normalizedArms,
      control_arm_run: normalizedArms.find((run) => run.arm === 'control') || null,
      treatment_arm_run: normalizedArms.find((run) => run.arm === 'treatment') || null,
      eval_results: evalResults.map(normalizeEvalResult),
      latest_eval_result: evalResults.length > 0 ? normalizeEvalResult(evalResults[0]) : null
    };
  }

  async function updateAbTurnSnapshotStatuses(snapshotId, statuses = {}, config = {}) {
    const prisma = getClient(config);
    const data = {};
    for (const [key, value] of Object.entries(statuses)) {
      const normalizedKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      if (SNAPSHOT_STATUS_FIELDS.has(normalizedKey) && typeof value === 'string') {
        data[normalizedKey] = value;
      }
    }
    if (Object.keys(data).length === 0) {
      return getAbTurnSnapshot(snapshotId, config);
    }
    const updated = await prisma.abTurnSnapshot.update({
      where: { id: normalizeString(snapshotId, null) },
      data
    });
    return normalizeSnapshot(updated);
  }

  return {
    ensureAbExperimentSchema,
    createAbTurnSnapshot,
    getAbTurnSnapshot,
    listAbTurnSnapshots,
    updateAbTurnSnapshotStatuses,
    upsertAbArmRun,
    getAbArmRunsForSnapshot,
    createAbMemoryStreamItem,
    listAbMemoryStreamItems,
    markAbMemoryPlanFulfilled,
    createAbEvalResult,
    getAbExperimentTrace
  };
}

module.exports = {
  createAbExperimentPersistence
};

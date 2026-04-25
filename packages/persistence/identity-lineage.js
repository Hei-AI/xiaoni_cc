'use strict';

const crypto = require('node:crypto');

const SOURCE_TYPES = new Set([
  'conversation_item',
  'agent_inbound_message',
  'agent_run',
  'llm_call_log',
  'tool_execution_log',
  'timeline_event',
  'relationship_ledger_event',
  'relationship_memory_card',
  'agent_feedback_episode',
  'agent_feedback_reflection',
  'self_evolution_state',
  'manual_operator',
  'runtime_instruction',
  'identity_lineage_event',
  'identity_change_journal',
  'identity_activation_trace',
  'continuity_trial'
]);

const EVENT_TYPES = new Set([
  'genesis',
  'natural_growth',
  'guided_growth',
  'external_intervention',
  'identity_retcon',
  'corruption',
  'fork',
  'forgetting',
  'death_or_reset',
  'continuity_trial',
  'activation_trace'
]);

const CHANGE_TYPES = new Set([
  'natural_growth',
  'guided_growth',
  'external_intervention',
  'identity_retcon',
  'corruption',
  'fork',
  'forgetting',
  'death_or_reset'
]);

const INTEGRITY_STATUSES = new Set(['accepted', 'needs_review', 'quarantined', 'rejected']);
const REDACTION_STATUSES = new Set(['visible', 'redacted', 'tombstoned']);
const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low']);

class IdentityLineageValidationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'IdentityLineageValidationError';
    this.code = code || 'identity_lineage_validation_error';
  }
}

function normalizeOptionalBigInt(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  if (typeof value === 'bigint') {
    return value;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return BigInt(Math.trunc(numeric));
}

function normalizeRequiredString(value, fieldName) {
  const text = typeof value === 'bigint' || typeof value === 'number'
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : '';
  if (!text) {
    throw new IdentityLineageValidationError(`${fieldName} is required`, `${fieldName}_required`);
  }
  return text;
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim();
  return text ? text : null;
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeJsonArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || typeof value === 'undefined') {
    return [];
  }
  return [value];
}

function normalizeJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return {};
}

function normalizeOptionalNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeEnum(value, fallback, allowed, fieldName) {
  const text = normalizeOptionalString(value) || fallback;
  if (!allowed.has(text)) {
    throw new IdentityLineageValidationError(`${fieldName} is not supported: ${text}`, `${fieldName}_unsupported`);
  }
  return text;
}

function hashSystemInstruction(snapshot) {
  return crypto.createHash('sha256').update(snapshot, 'utf8').digest('hex');
}

function normalizeIdentityRecord(record) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  return {
    ...record,
    id: typeof record.id === 'bigint' ? Number(record.id) : record.id,
    previous_event_id: typeof record.previous_event_id === 'bigint' ? Number(record.previous_event_id) : record.previous_event_id,
    parent_event_id: typeof record.parent_event_id === 'bigint' ? Number(record.parent_event_id) : record.parent_event_id,
    fork_point_event_id: typeof record.fork_point_event_id === 'bigint' ? Number(record.fork_point_event_id) : record.fork_point_event_id,
    change_journal_id: typeof record.change_journal_id === 'bigint' ? Number(record.change_journal_id) : record.change_journal_id,
    identity_event_id: typeof record.identity_event_id === 'bigint' ? Number(record.identity_event_id) : record.identity_event_id,
    conversation_id: typeof record.conversation_id === 'bigint' ? Number(record.conversation_id) : record.conversation_id
  };
}

function buildRootData(input) {
  const identityKey = normalizeRequiredString(input.identityKey, 'identityKey');
  const snapshot = normalizeRequiredString(input.systemInstructionSnapshot, 'systemInstructionSnapshot');

  return {
    identity_key: identityKey,
    source_prompt_id: normalizeOptionalString(input.sourcePromptId),
    system_instruction_hash: normalizeOptionalString(input.systemInstructionHash) || hashSystemInstruction(snapshot),
    system_instruction_snapshot: snapshot,
    status: normalizeOptionalString(input.status) || 'active',
    created_by: normalizeOptionalString(input.createdBy),
    metadata: normalizeJsonObject(input.metadata)
  };
}

function buildLineageEventData(input) {
  const identityKey = normalizeRequiredString(input.identityKey, 'identityKey');
  return {
    identity_key: identityKey,
    event_type: normalizeEnum(input.eventType, 'natural_growth', EVENT_TYPES, 'eventType'),
    source_type: normalizeEnum(input.sourceType, 'manual_operator', SOURCE_TYPES, 'sourceType'),
    source_id: normalizeOptionalString(input.sourceId),
    summary_text: normalizeRequiredString(input.summaryText, 'summaryText'),
    previous_event_id: normalizeOptionalBigInt(input.previousEventId),
    parent_event_id: normalizeOptionalBigInt(input.parentEventId),
    forked_from_identity_key: normalizeOptionalString(input.forkedFromIdentityKey),
    fork_point_event_id: normalizeOptionalBigInt(input.forkPointEventId),
    change_journal_id: normalizeOptionalBigInt(input.changeJournalId),
    integrity_status: normalizeEnum(input.integrityStatus, 'accepted', INTEGRITY_STATUSES, 'integrityStatus'),
    metadata: normalizeJsonObject(input.metadata),
    occurred_at: normalizeDate(input.occurredAt)
  };
}

function buildChangeJournalData(input) {
  return {
    identity_key: normalizeRequiredString(input.identityKey, 'identityKey'),
    change_type: normalizeEnum(input.changeType, 'natural_growth', CHANGE_TYPES, 'changeType'),
    proposed_by: normalizeOptionalString(input.proposedBy),
    proposed_from: normalizeOptionalString(input.proposedFrom),
    before_summary: normalizeOptionalString(input.beforeSummary),
    after_summary: normalizeRequiredString(input.afterSummary, 'afterSummary'),
    integrity_status: normalizeEnum(input.integrityStatus, 'needs_review', INTEGRITY_STATUSES, 'integrityStatus'),
    reason: normalizeOptionalString(input.reason),
    metadata: normalizeJsonObject(input.metadata)
  };
}

function buildEvidenceRefData(input, defaults = {}) {
  const identityKey = normalizeRequiredString(input.identityKey || defaults.identityKey, 'identityKey');
  const sourceType = normalizeEnum(input.sourceType, defaults.sourceType || 'manual_operator', SOURCE_TYPES, 'sourceType');
  const sourceId = normalizeRequiredString(input.sourceId, 'sourceId');
  return {
    identity_key: identityKey,
    identity_event_id: normalizeOptionalBigInt(input.identityEventId ?? defaults.identityEventId),
    change_journal_id: normalizeOptionalBigInt(input.changeJournalId ?? defaults.changeJournalId),
    source_type: sourceType,
    source_id: sourceId,
    trace_id: normalizeOptionalString(input.traceId),
    run_id: normalizeOptionalString(input.runId),
    conversation_id: normalizeOptionalBigInt(input.conversationId),
    redaction_status: normalizeEnum(input.redactionStatus, defaults.redactionStatus || 'visible', REDACTION_STATUSES, 'redactionStatus'),
    confidence: normalizeEnum(input.confidence, 'medium', CONFIDENCE_LEVELS, 'confidence'),
    metadata: normalizeJsonObject(input.metadata)
  };
}

function buildActivationTraceData(input) {
  return {
    identity_key: normalizeRequiredString(input.identityKey, 'identityKey'),
    run_id: normalizeOptionalString(input.runId),
    trace_id: normalizeOptionalString(input.traceId),
    conversation_id: normalizeOptionalBigInt(input.conversationId),
    scene_fingerprint: normalizeOptionalString(input.sceneFingerprint),
    cue_summary: normalizeOptionalString(input.cueSummary),
    activated_refs: normalizeJsonArray(input.activatedRefs),
    suppressed_refs: normalizeJsonArray(input.suppressedRefs),
    selected_skill_ref: normalizeOptionalString(input.selectedSkillRef),
    activation_reason: normalizeOptionalString(input.activationReason),
    metadata: normalizeJsonObject(input.metadata)
  };
}

function createIdentityLineagePersistence({ getPrismaClient, createSqlAdapter }) {
  function getClient(config) {
    return getPrismaClient(config);
  }

  async function ensureIdentityLineageSchema(config = {}) {
    const sql = createSqlAdapter(config);
    try {
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS xiaoni_identity_roots (
            id BIGSERIAL PRIMARY KEY,
            identity_key VARCHAR(191) NOT NULL,
            source_prompt_id VARCHAR(191) NULL,
            system_instruction_hash VARCHAR(128) NOT NULL,
            system_instruction_snapshot TEXT NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'active',
            created_by VARCHAR(191) NULL,
            metadata JSONB NULL,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS identity_lineage_events (
            id BIGSERIAL PRIMARY KEY,
            identity_key VARCHAR(191) NOT NULL,
            event_type VARCHAR(64) NOT NULL,
            source_type VARCHAR(64) NOT NULL,
            source_id VARCHAR(191) NULL,
            summary_text TEXT NOT NULL,
            previous_event_id BIGINT NULL,
            parent_event_id BIGINT NULL,
            forked_from_identity_key VARCHAR(191) NULL,
            fork_point_event_id BIGINT NULL,
            change_journal_id BIGINT NULL,
            integrity_status VARCHAR(32) NOT NULL DEFAULT 'accepted',
            metadata JSONB NULL,
            occurred_at TIMESTAMP(3) NULL,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS identity_change_journal (
            id BIGSERIAL PRIMARY KEY,
            identity_key VARCHAR(191) NOT NULL,
            change_type VARCHAR(64) NOT NULL,
            proposed_by VARCHAR(191) NULL,
            proposed_from VARCHAR(191) NULL,
            before_summary TEXT NULL,
            after_summary TEXT NOT NULL,
            integrity_status VARCHAR(32) NOT NULL DEFAULT 'needs_review',
            reason TEXT NULL,
            metadata JSONB NULL,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS identity_evidence_refs (
            id BIGSERIAL PRIMARY KEY,
            identity_key VARCHAR(191) NOT NULL,
            identity_event_id BIGINT NULL,
            change_journal_id BIGINT NULL,
            source_type VARCHAR(64) NOT NULL,
            source_id VARCHAR(191) NOT NULL,
            trace_id VARCHAR(128) NULL,
            run_id VARCHAR(128) NULL,
            conversation_id BIGINT NULL,
            redaction_status VARCHAR(32) NOT NULL DEFAULT 'visible',
            confidence VARCHAR(16) NOT NULL DEFAULT 'medium',
            metadata JSONB NULL,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS identity_activation_traces (
            id BIGSERIAL PRIMARY KEY,
            identity_key VARCHAR(191) NOT NULL,
            run_id VARCHAR(128) NULL,
            trace_id VARCHAR(128) NULL,
            conversation_id BIGINT NULL,
            scene_fingerprint VARCHAR(191) NULL,
            cue_summary TEXT NULL,
            activated_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
            suppressed_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
            selected_skill_ref VARCHAR(191) NULL,
            activation_reason TEXT NULL,
            metadata JSONB NULL,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );

      await sql.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uniq_xiaoni_identity_roots_active_key ON xiaoni_identity_roots (identity_key) WHERE status = 'active'"
      );
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_xiaoni_identity_roots_key_status_created ON xiaoni_identity_roots (identity_key, status, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_lineage_events_key_created ON identity_lineage_events (identity_key, created_at DESC, id DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_lineage_events_type_created ON identity_lineage_events (event_type, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_lineage_events_change ON identity_lineage_events (change_journal_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_change_journal_key_status_created ON identity_change_journal (identity_key, integrity_status, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_change_journal_type_created ON identity_change_journal (change_type, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_evidence_refs_key_source ON identity_evidence_refs (identity_key, source_type, source_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_evidence_refs_event ON identity_evidence_refs (identity_event_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_evidence_refs_change ON identity_evidence_refs (change_journal_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_evidence_refs_trace ON identity_evidence_refs (trace_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_evidence_refs_run ON identity_evidence_refs (run_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_activation_traces_trace_run ON identity_activation_traces (trace_id, run_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_activation_traces_key_created ON identity_activation_traces (identity_key, created_at DESC)');
    } finally {
      await sql.close();
    }
  }

  async function createXiaoniIdentityRoot(input, config = {}) {
    const prisma = getClient(config);
    const data = buildRootData(input);
    if (data.status === 'active') {
      const existing = await prisma.xiaoniIdentityRoot.findFirst({
        where: {
          identity_key: data.identity_key,
          status: 'active'
        },
        orderBy: [
          { created_at: 'desc' },
          { id: 'desc' }
        ]
      });
      if (existing) {
        throw new IdentityLineageValidationError(
          `active identity root already exists for ${data.identity_key}`,
          'active_identity_root_exists'
        );
      }
    }

    const created = await prisma.xiaoniIdentityRoot.create({ data });
    return normalizeIdentityRecord(created);
  }

  async function getActiveXiaoniIdentityRoot(identityKey, config = {}) {
    const prisma = getClient(config);
    const key = normalizeRequiredString(identityKey, 'identityKey');
    const row = await prisma.xiaoniIdentityRoot.findFirst({
      where: {
        identity_key: key,
        status: 'active'
      },
      orderBy: [
        { created_at: 'desc' },
        { id: 'desc' }
      ]
    });
    return row ? normalizeIdentityRecord(row) : null;
  }

  async function appendEvidenceRefs(tx, refs = [], defaults = {}) {
    const created = [];
    for (const ref of normalizeJsonArray(refs)) {
      if (!ref || typeof ref !== 'object') {
        throw new IdentityLineageValidationError('evidence ref must be an object', 'evidence_ref_invalid');
      }
      const row = await tx.identityEvidenceRef.create({
        data: buildEvidenceRefData(ref, defaults)
      });
      created.push(normalizeIdentityRecord(row));
    }
    return created;
  }

  async function appendIdentityLineageEvent(input, config = {}) {
    const prisma = getClient(config);
    const eventData = buildLineageEventData(input);
    const evidenceRefs = normalizeJsonArray(input.evidenceRefs);

    if (evidenceRefs.length === 0) {
      const created = await prisma.identityLineageEvent.create({ data: eventData });
      return {
        event: normalizeIdentityRecord(created),
        evidenceRefs: []
      };
    }

    return prisma.$transaction(async (tx) => {
      const event = await tx.identityLineageEvent.create({ data: eventData });
      const refs = await appendEvidenceRefs(tx, evidenceRefs, {
        identityKey: eventData.identity_key,
        identityEventId: event.id
      });
      return {
        event: normalizeIdentityRecord(event),
        evidenceRefs: refs
      };
    });
  }

  async function appendIdentityChange(input, config = {}) {
    const prisma = getClient(config);
    const changeData = buildChangeJournalData(input);
    const shouldRecordLineageEvent = input.recordLineageEvent !== false;
    const evidenceRefs = normalizeJsonArray(input.evidenceRefs);

    return prisma.$transaction(async (tx) => {
      const change = await tx.identityChangeJournal.create({ data: changeData });
      let event = null;
      if (shouldRecordLineageEvent) {
        event = await tx.identityLineageEvent.create({
          data: buildLineageEventData({
            identityKey: changeData.identity_key,
            eventType: changeData.change_type,
            sourceType: 'identity_change_journal',
            sourceId: String(change.id),
            summaryText: changeData.after_summary,
            changeJournalId: change.id,
            integrityStatus: changeData.integrity_status,
            metadata: input.lineageMetadata || {}
          })
        });
      }

      const refs = await appendEvidenceRefs(tx, evidenceRefs, {
        identityKey: changeData.identity_key,
        identityEventId: event ? event.id : null,
        changeJournalId: change.id
      });

      return {
        change: normalizeIdentityRecord(change),
        event: event ? normalizeIdentityRecord(event) : null,
        evidenceRefs: refs
      };
    });
  }

  async function recordIdentityFork(input, config = {}) {
    normalizeRequiredString(input.forkedFromIdentityKey, 'forkedFromIdentityKey');
    if (!normalizeOptionalBigInt(input.forkPointEventId)) {
      throw new IdentityLineageValidationError('forkPointEventId is required', 'fork_point_event_id_required');
    }

    return appendIdentityLineageEvent({
      ...input,
      eventType: 'fork',
      sourceType: input.sourceType || 'identity_lineage_event',
      sourceId: input.sourceId || String(input.forkPointEventId),
      summaryText: input.summaryText || 'Identity fork recorded.',
      integrityStatus: input.integrityStatus || 'needs_review'
    }, config);
  }

  async function recordForgettingTombstone(input, config = {}) {
    const evidenceRefs = normalizeJsonArray(input.evidenceRefs).map((ref) => ({
      ...ref,
      redactionStatus: ref.redactionStatus || 'tombstoned'
    }));

    return appendIdentityLineageEvent({
      ...input,
      eventType: 'forgetting',
      sourceType: input.sourceType || 'manual_operator',
      summaryText: input.summaryText || 'Identity-linked evidence was tombstoned without rewriting history.',
      evidenceRefs,
      integrityStatus: input.integrityStatus || 'accepted'
    }, config);
  }

  async function recordContinuityTrial(input, config = {}) {
    return appendIdentityLineageEvent({
      ...input,
      eventType: 'continuity_trial',
      sourceType: input.sourceType || 'manual_operator',
      summaryText: input.summaryText || 'Continuity trial recorded.',
      integrityStatus: input.integrityStatus || 'accepted'
    }, config);
  }

  async function recordIdentityActivationTrace(input, config = {}) {
    const prisma = getClient(config);
    const created = await prisma.identityActivationTrace.create({
      data: buildActivationTraceData(input)
    });
    return normalizeIdentityRecord(created);
  }

  async function listIdentityLineageEvents(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.identityLineageEvent.findMany({
      where: {
        identity_key: typeof filters.identityKey === 'string' ? normalizeRequiredString(filters.identityKey, 'identityKey') : undefined,
        event_type: typeof filters.eventType === 'string' ? normalizeEnum(filters.eventType, 'natural_growth', EVENT_TYPES, 'eventType') : undefined,
        integrity_status: typeof filters.integrityStatus === 'string'
          ? normalizeEnum(filters.integrityStatus, 'accepted', INTEGRITY_STATUSES, 'integrityStatus')
          : undefined
      },
      orderBy: [
        { created_at: 'desc' },
        { id: 'desc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 100
    });
    return rows.map(normalizeIdentityRecord);
  }

  async function listIdentityEvidenceRefs(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.identityEvidenceRef.findMany({
      where: {
        identity_key: typeof filters.identityKey === 'string' ? normalizeRequiredString(filters.identityKey, 'identityKey') : undefined,
        identity_event_id: typeof filters.identityEventId !== 'undefined' ? normalizeOptionalBigInt(filters.identityEventId) : undefined,
        change_journal_id: typeof filters.changeJournalId !== 'undefined' ? normalizeOptionalBigInt(filters.changeJournalId) : undefined,
        source_type: typeof filters.sourceType === 'string' ? normalizeEnum(filters.sourceType, 'manual_operator', SOURCE_TYPES, 'sourceType') : undefined,
        trace_id: typeof filters.traceId === 'string' ? normalizeOptionalString(filters.traceId) : undefined,
        run_id: typeof filters.runId === 'string' ? normalizeOptionalString(filters.runId) : undefined,
        redaction_status: typeof filters.redactionStatus === 'string'
          ? normalizeEnum(filters.redactionStatus, 'visible', REDACTION_STATUSES, 'redactionStatus')
          : undefined
      },
      orderBy: [
        { created_at: 'desc' },
        { id: 'desc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 100
    });
    return rows.map(normalizeIdentityRecord);
  }

  async function listIdentityActivationTraces(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.identityActivationTrace.findMany({
      where: {
        identity_key: typeof filters.identityKey === 'string' ? normalizeRequiredString(filters.identityKey, 'identityKey') : undefined,
        trace_id: typeof filters.traceId === 'string' ? normalizeOptionalString(filters.traceId) : undefined,
        run_id: typeof filters.runId === 'string' ? normalizeOptionalString(filters.runId) : undefined,
        conversation_id: typeof filters.conversationId !== 'undefined' ? normalizeOptionalBigInt(filters.conversationId) : undefined
      },
      orderBy: [
        { created_at: 'desc' },
        { id: 'desc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 100
    });
    return rows.map(normalizeIdentityRecord);
  }

  return {
    IdentityLineageValidationError,
    ensureIdentityLineageSchema,
    createXiaoniIdentityRoot,
    getActiveXiaoniIdentityRoot,
    appendIdentityLineageEvent,
    appendIdentityChange,
    recordIdentityFork,
    recordForgettingTombstone,
    recordContinuityTrial,
    recordIdentityActivationTrace,
    listIdentityLineageEvents,
    listIdentityEvidenceRefs,
    listIdentityActivationTraces
  };
}

module.exports = {
  createIdentityLineagePersistence,
  IdentityLineageValidationError
};

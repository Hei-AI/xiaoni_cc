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
  'agent_feedback_episode',
  'agent_feedback_reflection',
  'self_evolution_state',
  'xiaoni_os',
  'manual_operator',
  'runtime_instruction',
  'identity_lineage_event',
  'identity_change_candidate',
  'identity_evidence_ref',
  'accepted_identity_fact',
  'runtime_identity_activation_trace',
  'continuity_trial'
]);

const EVENT_TYPES = new Set([
  'genesis',
  'candidate_proposed',
  'candidate_judged',
  'fact_accepted',
  'fact_superseded',
  'fact_revoked',
  'natural_growth',
  'guided_growth',
  'external_intervention',
  'identity_retcon',
  'corruption',
  'fork',
  'forgetting',
  'death_or_reset',
  'continuity_trial'
]);

const CANDIDATE_TYPES = new Set([
  'natural_growth',
  'guided_growth',
  'external_intervention',
  'identity_retcon',
  'corruption',
  'fork',
  'forgetting',
  'death_or_reset'
]);

const CANDIDATE_STATUSES = new Set(['pending', 'accepted', 'quarantined', 'rejected', 'superseded']);
const JUDGE_STATUSES = new Set(['not_judged', 'accepted', 'quarantined', 'rejected', 'failed']);
const INTEGRITY_STATUSES = new Set(['accepted', 'needs_review', 'quarantined', 'rejected']);
const FACT_STATUSES = new Set(['active', 'superseded', 'revoked', 'inactive']);
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
    change_candidate_id: typeof record.change_candidate_id === 'bigint' ? Number(record.change_candidate_id) : record.change_candidate_id,
    accepted_fact_id: typeof record.accepted_fact_id === 'bigint' ? Number(record.accepted_fact_id) : record.accepted_fact_id,
    identity_event_id: typeof record.identity_event_id === 'bigint' ? Number(record.identity_event_id) : record.identity_event_id,
    source_candidate_id: typeof record.source_candidate_id === 'bigint' ? Number(record.source_candidate_id) : record.source_candidate_id,
    source_event_id: typeof record.source_event_id === 'bigint' ? Number(record.source_event_id) : record.source_event_id,
    supersedes_fact_id: typeof record.supersedes_fact_id === 'bigint' ? Number(record.supersedes_fact_id) : record.supersedes_fact_id,
    revoked_by_event_id: typeof record.revoked_by_event_id === 'bigint' ? Number(record.revoked_by_event_id) : record.revoked_by_event_id,
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

function buildCandidateData(input) {
  return {
    identity_key: normalizeRequiredString(input.identityKey, 'identityKey'),
    candidate_type: normalizeEnum(input.candidateType, 'natural_growth', CANDIDATE_TYPES, 'candidateType'),
    proposed_by: normalizeOptionalString(input.proposedBy),
    proposed_from: normalizeOptionalString(input.proposedFrom),
    claim_text: normalizeRequiredString(input.claimText, 'claimText'),
    before_summary: normalizeOptionalString(input.beforeSummary),
    after_summary: normalizeOptionalString(input.afterSummary),
    status: normalizeEnum(input.status, 'pending', CANDIDATE_STATUSES, 'status'),
    judge_status: normalizeEnum(input.judgeStatus, 'not_judged', JUDGE_STATUSES, 'judgeStatus'),
    judge_reason: normalizeOptionalString(input.judgeReason),
    judge_run_id: normalizeOptionalString(input.judgeRunId),
    judge_llm_call_id: normalizeOptionalString(input.judgeLlmCallId),
    quarantine_group_key: normalizeOptionalString(input.quarantineGroupKey),
    supersedes_fact_id: normalizeOptionalBigInt(input.supersedesFactId),
    legacy_source_table: normalizeOptionalString(input.legacySourceTable),
    legacy_source_id: normalizeOptionalString(input.legacySourceId),
    metadata: normalizeJsonObject(input.metadata),
    judged_at: normalizeDate(input.judgedAt)
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
    change_candidate_id: normalizeOptionalBigInt(input.changeCandidateId),
    accepted_fact_id: normalizeOptionalBigInt(input.acceptedFactId),
    integrity_status: normalizeEnum(input.integrityStatus, 'accepted', INTEGRITY_STATUSES, 'integrityStatus'),
    metadata: normalizeJsonObject(input.metadata),
    occurred_at: normalizeDate(input.occurredAt)
  };
}

function buildEvidenceRefData(input, defaults = {}) {
  const identityKey = normalizeRequiredString(input.identityKey || defaults.identityKey, 'identityKey');
  const sourceType = normalizeEnum(input.sourceType, defaults.sourceType || 'manual_operator', SOURCE_TYPES, 'sourceType');
  const sourceId = normalizeRequiredString(input.sourceId, 'sourceId');
  return {
    identity_key: identityKey,
    identity_event_id: normalizeOptionalBigInt(input.identityEventId ?? defaults.identityEventId),
    change_candidate_id: normalizeOptionalBigInt(input.changeCandidateId ?? defaults.changeCandidateId),
    accepted_fact_id: normalizeOptionalBigInt(input.acceptedFactId ?? defaults.acceptedFactId),
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

function buildAcceptedFactData(input) {
  return {
    identity_key: normalizeRequiredString(input.identityKey, 'identityKey'),
    fact_key: normalizeRequiredString(input.factKey, 'factKey'),
    fact_text: normalizeRequiredString(input.factText, 'factText'),
    fact_type: normalizeOptionalString(input.factType) || 'self_boundary',
    source_candidate_id: normalizeOptionalBigInt(input.sourceCandidateId),
    source_event_id: normalizeOptionalBigInt(input.sourceEventId),
    status: normalizeEnum(input.status, 'active', FACT_STATUSES, 'status'),
    supersedes_fact_id: normalizeOptionalBigInt(input.supersedesFactId),
    revoked_by_event_id: normalizeOptionalBigInt(input.revokedByEventId),
    confidence: normalizeEnum(input.confidence, 'medium', CONFIDENCE_LEVELS, 'confidence'),
    activation_tags: normalizeJsonArray(input.activationTags),
    metadata: normalizeJsonObject(input.metadata),
    accepted_at: normalizeDate(input.acceptedAt) || new Date()
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

  async function migrateLegacyIdentityLineage(sql) {
    await sql.execute(
      `
        DO $$
        BEGIN
          IF to_regclass('public.identity_change_journal') IS NOT NULL THEN
            INSERT INTO identity_change_candidates (
              identity_key,
              candidate_type,
              proposed_by,
              proposed_from,
              before_summary,
              claim_text,
              after_summary,
              status,
              judge_status,
              judge_reason,
              legacy_source_table,
              legacy_source_id,
              metadata,
              created_at,
              updated_at
            )
            SELECT
              old.identity_key,
              old.change_type,
              old.proposed_by,
              old.proposed_from,
              old.before_summary,
              old.after_summary,
              old.after_summary,
              CASE old.integrity_status
                WHEN 'accepted' THEN 'accepted'
                WHEN 'rejected' THEN 'rejected'
                WHEN 'quarantined' THEN 'quarantined'
                ELSE 'pending'
              END,
              CASE old.integrity_status
                WHEN 'accepted' THEN 'accepted'
                WHEN 'rejected' THEN 'rejected'
                WHEN 'quarantined' THEN 'quarantined'
                ELSE 'not_judged'
              END,
              old.reason,
              'identity_change_journal',
              old.id::text,
              jsonb_build_object('migrated_from', 'identity_change_journal', 'legacy_metadata', old.metadata),
              old.created_at,
              old.updated_at
            FROM identity_change_journal old
            WHERE NOT EXISTS (
              SELECT 1
              FROM identity_change_candidates candidate
              WHERE candidate.legacy_source_table = 'identity_change_journal'
                AND candidate.legacy_source_id = old.id::text
            );
          END IF;
        END $$;
      `
    );

    await sql.execute(
      `
        DO $$
        BEGIN
          IF to_regclass('public.identity_change_journal') IS NOT NULL THEN
            UPDATE identity_lineage_events event
            SET change_candidate_id = candidate.id
            FROM identity_change_candidates candidate
            WHERE event.change_candidate_id IS NULL
              AND candidate.legacy_source_table = 'identity_change_journal'
              AND candidate.legacy_source_id = event.change_journal_id::text;
          END IF;
        EXCEPTION
          WHEN undefined_column THEN
            NULL;
        END $$;
      `
    );

    await sql.execute(
      `
        DO $$
        BEGIN
          IF to_regclass('public.identity_change_journal') IS NOT NULL THEN
            UPDATE identity_evidence_refs evidence
            SET change_candidate_id = candidate.id
            FROM identity_change_candidates candidate
            WHERE evidence.change_candidate_id IS NULL
              AND candidate.legacy_source_table = 'identity_change_journal'
              AND candidate.legacy_source_id = evidence.change_journal_id::text;
          END IF;
        EXCEPTION
          WHEN undefined_column THEN
            NULL;
        END $$;
      `
    );

    await sql.execute(
      `
        DO $$
        BEGIN
          IF to_regclass('public.identity_activation_traces') IS NOT NULL THEN
            INSERT INTO runtime_identity_activation_traces (
              identity_key,
              run_id,
              trace_id,
              conversation_id,
              scene_fingerprint,
              cue_summary,
              activated_refs,
              suppressed_refs,
              selected_skill_ref,
              activation_reason,
              metadata,
              created_at
            )
            SELECT
              old.identity_key,
              old.run_id,
              old.trace_id,
              old.conversation_id,
              old.scene_fingerprint,
              old.cue_summary,
              old.activated_refs,
              old.suppressed_refs,
              old.selected_skill_ref,
              old.activation_reason,
              jsonb_build_object('migrated_from', 'identity_activation_traces', 'legacy_id', old.id, 'legacy_metadata', old.metadata),
              old.created_at
            FROM identity_activation_traces old
            WHERE NOT EXISTS (
              SELECT 1
              FROM runtime_identity_activation_traces trace
              WHERE trace.metadata->>'migrated_from' = 'identity_activation_traces'
                AND trace.metadata->>'legacy_id' = old.id::text
            );
          END IF;
        END $$;
      `
    );
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
            created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
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
            change_candidate_id BIGINT NULL,
            accepted_fact_id BIGINT NULL,
            integrity_status VARCHAR(32) NOT NULL DEFAULT 'accepted',
            metadata JSONB NULL,
            occurred_at TIMESTAMPTZ(3) NULL,
            created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );
      await sql.execute('ALTER TABLE identity_lineage_events ADD COLUMN IF NOT EXISTS change_candidate_id BIGINT NULL');
      await sql.execute('ALTER TABLE identity_lineage_events ADD COLUMN IF NOT EXISTS accepted_fact_id BIGINT NULL');
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS identity_change_candidates (
            id BIGSERIAL PRIMARY KEY,
            identity_key VARCHAR(191) NOT NULL,
            candidate_type VARCHAR(64) NOT NULL,
            proposed_by VARCHAR(191) NULL,
            proposed_from VARCHAR(191) NULL,
            claim_text TEXT NOT NULL,
            before_summary TEXT NULL,
            after_summary TEXT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'pending',
            judge_status VARCHAR(32) NOT NULL DEFAULT 'not_judged',
            judge_reason TEXT NULL,
            judge_run_id VARCHAR(128) NULL,
            judge_llm_call_id VARCHAR(128) NULL,
            quarantine_group_key VARCHAR(191) NULL,
            supersedes_fact_id BIGINT NULL,
            legacy_source_table VARCHAR(64) NULL,
            legacy_source_id VARCHAR(191) NULL,
            metadata JSONB NULL,
            judged_at TIMESTAMPTZ(3) NULL,
            created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS identity_evidence_refs (
            id BIGSERIAL PRIMARY KEY,
            identity_key VARCHAR(191) NOT NULL,
            identity_event_id BIGINT NULL,
            change_candidate_id BIGINT NULL,
            accepted_fact_id BIGINT NULL,
            source_type VARCHAR(64) NOT NULL,
            source_id VARCHAR(191) NOT NULL,
            trace_id VARCHAR(128) NULL,
            run_id VARCHAR(128) NULL,
            conversation_id BIGINT NULL,
            redaction_status VARCHAR(32) NOT NULL DEFAULT 'visible',
            confidence VARCHAR(16) NOT NULL DEFAULT 'medium',
            metadata JSONB NULL,
            created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );
      await sql.execute('ALTER TABLE identity_evidence_refs ADD COLUMN IF NOT EXISTS change_candidate_id BIGINT NULL');
      await sql.execute('ALTER TABLE identity_evidence_refs ADD COLUMN IF NOT EXISTS accepted_fact_id BIGINT NULL');
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS accepted_identity_facts (
            id BIGSERIAL PRIMARY KEY,
            identity_key VARCHAR(191) NOT NULL,
            fact_key VARCHAR(191) NOT NULL,
            fact_text TEXT NOT NULL,
            fact_type VARCHAR(64) NOT NULL,
            source_candidate_id BIGINT NULL,
            source_event_id BIGINT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'active',
            supersedes_fact_id BIGINT NULL,
            revoked_by_event_id BIGINT NULL,
            confidence VARCHAR(16) NOT NULL DEFAULT 'medium',
            activation_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
            metadata JSONB NULL,
            accepted_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS runtime_identity_activation_traces (
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
            created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );

      await sql.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uniq_xiaoni_identity_roots_active_key ON xiaoni_identity_roots (identity_key) WHERE status = 'active'"
      );
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_xiaoni_identity_roots_key_status_created ON xiaoni_identity_roots (identity_key, status, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_lineage_events_key_created ON identity_lineage_events (identity_key, created_at DESC, id DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_lineage_events_type_created ON identity_lineage_events (event_type, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_lineage_events_candidate ON identity_lineage_events (change_candidate_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_lineage_events_fact ON identity_lineage_events (accepted_fact_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_change_candidates_key_status_created ON identity_change_candidates (identity_key, status, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_change_candidates_key_judge_created ON identity_change_candidates (identity_key, judge_status, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_change_candidates_type_created ON identity_change_candidates (candidate_type, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_change_candidates_quarantine ON identity_change_candidates (quarantine_group_key, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_change_candidates_legacy ON identity_change_candidates (legacy_source_table, legacy_source_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_evidence_refs_key_source ON identity_evidence_refs (identity_key, source_type, source_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_evidence_refs_event ON identity_evidence_refs (identity_event_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_evidence_refs_candidate ON identity_evidence_refs (change_candidate_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_evidence_refs_fact ON identity_evidence_refs (accepted_fact_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_evidence_refs_trace ON identity_evidence_refs (trace_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_identity_evidence_refs_run ON identity_evidence_refs (run_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_accepted_identity_facts_key_status_accepted ON accepted_identity_facts (identity_key, status, accepted_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_accepted_identity_facts_key_fact_status ON accepted_identity_facts (identity_key, fact_key, status)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_accepted_identity_facts_candidate ON accepted_identity_facts (source_candidate_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_accepted_identity_facts_event ON accepted_identity_facts (source_event_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_runtime_identity_activation_traces_trace_run ON runtime_identity_activation_traces (trace_id, run_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_runtime_identity_activation_traces_key_created ON runtime_identity_activation_traces (identity_key, created_at DESC)');
      await migrateLegacyIdentityLineage(sql);
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

  async function ensureXiaoniIdentityRoot(input, config = {}) {
    const prisma = getClient(config);
    const data = buildRootData(input);
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
      return {
        root: normalizeIdentityRecord(existing),
        event: null,
        created: false
      };
    }

    return prisma.$transaction(async (tx) => {
      const active = await tx.xiaoniIdentityRoot.findFirst({
        where: {
          identity_key: data.identity_key,
          status: 'active'
        },
        orderBy: [
          { created_at: 'desc' },
          { id: 'desc' }
        ]
      });
      if (active) {
        return {
          root: normalizeIdentityRecord(active),
          event: null,
          created: false
        };
      }

      const root = await tx.xiaoniIdentityRoot.create({ data });
      const event = await tx.identityLineageEvent.create({
        data: buildLineageEventData({
          identityKey: data.identity_key,
          eventType: 'genesis',
          sourceType: 'runtime_instruction',
          sourceId: data.source_prompt_id || data.identity_key,
          summaryText: `Genesis snapshot recorded for ${data.identity_key}.`,
          integrityStatus: 'accepted',
          metadata: {
            root_id: typeof root.id === 'bigint' ? String(root.id) : root.id,
            source_prompt_id: data.source_prompt_id,
            system_instruction_hash: data.system_instruction_hash,
            created_by: data.created_by,
            ...(data.metadata && typeof data.metadata === 'object' ? data.metadata : {})
          }
        })
      });

      return {
        root: normalizeIdentityRecord(root),
        event: normalizeIdentityRecord(event),
        created: true
      };
    });
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

  async function appendIdentityChangeCandidate(input, config = {}) {
    const prisma = getClient(config);
    const candidateData = buildCandidateData(input);
    const shouldRecordLineageEvent = input.recordLineageEvent !== false;
    const evidenceRefs = normalizeJsonArray(input.evidenceRefs);

    return prisma.$transaction(async (tx) => {
      const candidate = await tx.identityChangeCandidate.create({ data: candidateData });
      let event = null;
      if (shouldRecordLineageEvent) {
        event = await tx.identityLineageEvent.create({
          data: buildLineageEventData({
            identityKey: candidateData.identity_key,
            eventType: 'candidate_proposed',
            sourceType: 'identity_change_candidate',
            sourceId: String(candidate.id),
            summaryText: candidateData.claim_text,
            changeCandidateId: candidate.id,
            integrityStatus: 'needs_review',
            metadata: input.lineageMetadata || {}
          })
        });
      }

      const refs = await appendEvidenceRefs(tx, evidenceRefs, {
        identityKey: candidateData.identity_key,
        identityEventId: event ? event.id : null,
        changeCandidateId: candidate.id
      });

      return {
        candidate: normalizeIdentityRecord(candidate),
        event: event ? normalizeIdentityRecord(event) : null,
        evidenceRefs: refs
      };
    });
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
        identityEventId: event.id,
        changeCandidateId: eventData.change_candidate_id,
        acceptedFactId: eventData.accepted_fact_id
      });
      return {
        event: normalizeIdentityRecord(event),
        evidenceRefs: refs
      };
    });
  }

  async function createAcceptedIdentityFact(input, config = {}) {
    const prisma = getClient(config);
    const factData = buildAcceptedFactData(input);
    const shouldRecordLineageEvent = input.recordLineageEvent !== false;
    const evidenceRefs = normalizeJsonArray(input.evidenceRefs);

    return prisma.$transaction(async (tx) => {
      const fact = await tx.acceptedIdentityFact.create({ data: factData });
      let event = null;
      if (shouldRecordLineageEvent) {
        event = await tx.identityLineageEvent.create({
          data: buildLineageEventData({
            identityKey: factData.identity_key,
            eventType: 'fact_accepted',
            sourceType: 'accepted_identity_fact',
            sourceId: String(fact.id),
            summaryText: factData.fact_text,
            changeCandidateId: factData.source_candidate_id,
            acceptedFactId: fact.id,
            integrityStatus: 'accepted',
            metadata: input.lineageMetadata || {}
          })
        });
      }

      const refs = await appendEvidenceRefs(tx, evidenceRefs, {
        identityKey: factData.identity_key,
        identityEventId: event ? event.id : null,
        changeCandidateId: factData.source_candidate_id,
        acceptedFactId: fact.id
      });

      return {
        fact: normalizeIdentityRecord(fact),
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
      sourceType: input.sourceType || 'continuity_trial',
      summaryText: input.summaryText || 'Continuity trial recorded.',
      integrityStatus: input.integrityStatus || 'accepted'
    }, config);
  }

  async function recordRuntimeIdentityActivationTrace(input, config = {}) {
    const prisma = getClient(config);
    const created = await prisma.runtimeIdentityActivationTrace.create({
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
          : undefined,
        change_candidate_id: typeof filters.changeCandidateId !== 'undefined' ? normalizeOptionalBigInt(filters.changeCandidateId) : undefined,
        accepted_fact_id: typeof filters.acceptedFactId !== 'undefined' ? normalizeOptionalBigInt(filters.acceptedFactId) : undefined
      },
      orderBy: [
        { created_at: 'desc' },
        { id: 'desc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 100
    });
    return rows.map(normalizeIdentityRecord);
  }

  async function listIdentityChangeCandidates(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.identityChangeCandidate.findMany({
      where: {
        identity_key: typeof filters.identityKey === 'string' ? normalizeRequiredString(filters.identityKey, 'identityKey') : undefined,
        candidate_type: typeof filters.candidateType === 'string' ? normalizeEnum(filters.candidateType, 'natural_growth', CANDIDATE_TYPES, 'candidateType') : undefined,
        status: typeof filters.status === 'string' ? normalizeEnum(filters.status, 'pending', CANDIDATE_STATUSES, 'status') : undefined,
        judge_status: typeof filters.judgeStatus === 'string' ? normalizeEnum(filters.judgeStatus, 'not_judged', JUDGE_STATUSES, 'judgeStatus') : undefined,
        quarantine_group_key: typeof filters.quarantineGroupKey === 'string' ? normalizeOptionalString(filters.quarantineGroupKey) : undefined
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
        change_candidate_id: typeof filters.changeCandidateId !== 'undefined' ? normalizeOptionalBigInt(filters.changeCandidateId) : undefined,
        accepted_fact_id: typeof filters.acceptedFactId !== 'undefined' ? normalizeOptionalBigInt(filters.acceptedFactId) : undefined,
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

  async function listAcceptedIdentityFacts(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.acceptedIdentityFact.findMany({
      where: {
        identity_key: typeof filters.identityKey === 'string' ? normalizeRequiredString(filters.identityKey, 'identityKey') : undefined,
        fact_type: typeof filters.factType === 'string' ? normalizeOptionalString(filters.factType) : undefined,
        status: typeof filters.status === 'string' ? normalizeEnum(filters.status, 'active', FACT_STATUSES, 'status') : undefined
      },
      orderBy: [
        { accepted_at: 'desc' },
        { id: 'desc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 100
    });
    return rows.map(normalizeIdentityRecord);
  }

  async function listRuntimeIdentityActivationTraces(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.runtimeIdentityActivationTrace.findMany({
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
    ensureXiaoniIdentityRoot,
    getActiveXiaoniIdentityRoot,
    appendIdentityChangeCandidate,
    appendIdentityLineageEvent,
    createAcceptedIdentityFact,
    recordIdentityFork,
    recordForgettingTombstone,
    recordContinuityTrial,
    recordRuntimeIdentityActivationTrace,
    listIdentityLineageEvents,
    listIdentityChangeCandidates,
    listIdentityEvidenceRefs,
    listAcceptedIdentityFacts,
    listRuntimeIdentityActivationTraces
  };
}

module.exports = {
  createIdentityLineagePersistence,
  IdentityLineageValidationError
};

'use strict';

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

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function normalizeTopicLabRecord(record) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  return {
    ...record,
    id: typeof record.id === 'bigint' ? Number(record.id) : record.id,
    chat_space_id: typeof record.chat_space_id === 'bigint' ? Number(record.chat_space_id) : record.chat_space_id,
    current_accepted_version_id: typeof record.current_accepted_version_id === 'bigint'
      ? Number(record.current_accepted_version_id)
      : record.current_accepted_version_id,
    current_candidate_version_id: typeof record.current_candidate_version_id === 'bigint'
      ? Number(record.current_candidate_version_id)
      : record.current_candidate_version_id,
    last_projection_job_id: typeof record.last_projection_job_id === 'bigint'
      ? Number(record.last_projection_job_id)
      : record.last_projection_job_id,
    topic_id: typeof record.topic_id === 'bigint' ? Number(record.topic_id) : record.topic_id,
    projection_job_id: typeof record.projection_job_id === 'bigint' ? Number(record.projection_job_id) : record.projection_job_id,
    projection_version_id: typeof record.projection_version_id === 'bigint'
      ? Number(record.projection_version_id)
      : record.projection_version_id,
    base_projection_version_id: typeof record.base_projection_version_id === 'bigint'
      ? Number(record.base_projection_version_id)
      : record.base_projection_version_id,
    result_projection_version_id: typeof record.result_projection_version_id === 'bigint'
      ? Number(record.result_projection_version_id)
      : record.result_projection_version_id,
    source_projection_version_id: typeof record.source_projection_version_id === 'bigint'
      ? Number(record.source_projection_version_id)
      : record.source_projection_version_id,
    source_id: typeof record.source_id === 'bigint' ? Number(record.source_id) : record.source_id,
    target_user_id: typeof record.target_user_id === 'bigint' ? Number(record.target_user_id) : record.target_user_id
  };
}

function createTopicLabPersistence({ getPrismaClient, createSqlAdapter }) {
  function getClient(config) {
    return getPrismaClient(config);
  }

  async function ensureTopicLabSchema(config = {}) {
    const sql = createSqlAdapter(config);
    try {
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS chat_space_topics (
          id BIGSERIAL PRIMARY KEY,
          chat_space_type VARCHAR(16) NOT NULL,
          chat_space_id BIGINT NOT NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'candidate',
          canonical_title TEXT NULL,
          started_at TIMESTAMPTZ(3) NULL,
          last_activity_at TIMESTAMPTZ(3) NULL,
          closed_at TIMESTAMPTZ(3) NULL,
          current_accepted_version_id BIGINT NULL,
          current_candidate_version_id BIGINT NULL,
          last_projection_job_id BIGINT NULL,
          metadata JSONB NULL,
          created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS topic_projection_jobs (
          id BIGSERIAL PRIMARY KEY,
          chat_space_type VARCHAR(16) NOT NULL,
          chat_space_id BIGINT NOT NULL,
          trigger_type VARCHAR(32) NOT NULL,
          status VARCHAR(32) NOT NULL,
          input_bundle_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          input_bundle_hash VARCHAR(191) NOT NULL,
          base_version_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          model_name VARCHAR(191) NULL,
          model_config_json JSONB NULL,
          prompt_version VARCHAR(191) NULL,
          error_code VARCHAR(64) NULL,
          error_message TEXT NULL,
          metadata JSONB NULL,
          started_at TIMESTAMPTZ(3) NULL,
          finished_at TIMESTAMPTZ(3) NULL,
          created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS topic_projection_versions (
          id BIGSERIAL PRIMARY KEY,
          topic_id BIGINT NOT NULL,
          projection_job_id BIGINT NULL,
          version_number INTEGER NOT NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'candidate',
          lifecycle_state VARCHAR(32) NOT NULL DEFAULT 'candidate',
          title TEXT NULL,
          summary_text TEXT NOT NULL,
          review_priority_score DOUBLE PRECISION NOT NULL DEFAULT 0,
          heat_score DOUBLE PRECISION NOT NULL DEFAULT 0,
          participant_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          topic_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
          evidence_count INTEGER NOT NULL DEFAULT 0,
          relationship_count INTEGER NOT NULL DEFAULT 0,
          runtime_hit_count INTEGER NOT NULL DEFAULT 0,
          last_runtime_hit_at TIMESTAMPTZ(3) NULL,
          input_bundle_hash VARCHAR(191) NOT NULL,
          snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          provenance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          metadata JSONB NULL,
          created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS topic_version_relationships (
          id BIGSERIAL PRIMARY KEY,
          projection_version_id BIGINT NOT NULL,
          target_user_id BIGINT NOT NULL,
          relationship_kind VARCHAR(64) NULL,
          summary_text TEXT NOT NULL,
          actors JSONB NOT NULL DEFAULT '[]'::jsonb,
          source_event_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          source_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          metadata JSONB NULL,
          created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS topic_version_evidence (
          id BIGSERIAL PRIMARY KEY,
          projection_version_id BIGINT NOT NULL,
          source_kind VARCHAR(32) NOT NULL,
          source_id BIGINT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          excerpt_text TEXT NULL,
          speaker_id VARCHAR(191) NULL,
          speaker_name VARCHAR(255) NULL,
          occurred_at TIMESTAMPTZ(3) NULL,
          metadata JSONB NULL,
          created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS topic_review_events (
          id BIGSERIAL PRIMARY KEY,
          topic_id BIGINT NOT NULL,
          base_projection_version_id BIGINT NULL,
          result_projection_version_id BIGINT NULL,
          action_type VARCHAR(64) NOT NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'recorded',
          created_by VARCHAR(191) NULL,
          manual_note TEXT NULL,
          patch_json JSONB NULL,
          metadata JSONB NULL,
          created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS golden_chat_cases (
          id BIGSERIAL PRIMARY KEY,
          chat_space_type VARCHAR(16) NOT NULL,
          chat_space_id BIGINT NOT NULL,
          topic_id BIGINT NULL,
          source_projection_version_id BIGINT NOT NULL,
          label VARCHAR(255) NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'active',
          input_bundle_hash VARCHAR(191) NOT NULL,
          expected_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          fixture_bundle_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_by VARCHAR(191) NULL,
          metadata JSONB NULL,
          created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_chat_space_topics_space_status_activity ON chat_space_topics (chat_space_type, chat_space_id, status, last_activity_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_chat_space_topics_space_updated ON chat_space_topics (chat_space_type, chat_space_id, updated_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_topic_projection_jobs_space_status_updated ON topic_projection_jobs (chat_space_type, chat_space_id, status, updated_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_topic_projection_jobs_bundle_hash ON topic_projection_jobs (input_bundle_hash, created_at DESC)');
      await sql.execute('CREATE UNIQUE INDEX IF NOT EXISTS uniq_topic_projection_versions_topic_version ON topic_projection_versions (topic_id, version_number)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_topic_projection_versions_topic_created ON topic_projection_versions (topic_id, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_topic_projection_versions_job_created ON topic_projection_versions (projection_job_id, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_topic_projection_versions_status_updated ON topic_projection_versions (status, updated_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_topic_version_relationships_version_target ON topic_version_relationships (projection_version_id, target_user_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_topic_version_evidence_version_sort ON topic_version_evidence (projection_version_id, sort_order, id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_topic_version_evidence_source ON topic_version_evidence (source_kind, source_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_topic_review_events_topic_created ON topic_review_events (topic_id, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_topic_review_events_status_updated ON topic_review_events (status, updated_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_golden_chat_cases_space_status_updated ON golden_chat_cases (chat_space_type, chat_space_id, status, updated_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_golden_chat_cases_source_version ON golden_chat_cases (source_projection_version_id, created_at DESC)');
    } finally {
      await sql.close();
    }
  }

  async function createChatSpaceTopic(input, config = {}) {
    const prisma = getClient(config);
    const created = await prisma.chatSpaceTopic.create({
      data: {
        chat_space_type: normalizeString(input.chatSpaceType),
        chat_space_id: normalizeOptionalBigInt(input.chatSpaceId),
        status: normalizeString(input.status) || 'candidate',
        canonical_title: normalizeString(input.canonicalTitle) || null,
        started_at: normalizeDate(input.startedAt),
        last_activity_at: normalizeDate(input.lastActivityAt),
        closed_at: normalizeDate(input.closedAt),
        current_accepted_version_id: normalizeOptionalBigInt(input.currentAcceptedVersionId),
        current_candidate_version_id: normalizeOptionalBigInt(input.currentCandidateVersionId),
        last_projection_job_id: normalizeOptionalBigInt(input.lastProjectionJobId),
        metadata: normalizeJsonObject(input.metadata)
      }
    });
    return normalizeTopicLabRecord(created);
  }

  async function updateChatSpaceTopic(id, updates = {}, config = {}) {
    const prisma = getClient(config);
    const updated = await prisma.chatSpaceTopic.update({
      where: { id: BigInt(id) },
      data: {
        status: typeof updates.status === 'string' ? normalizeString(updates.status) : undefined,
        canonical_title: typeof updates.canonicalTitle === 'string'
          ? normalizeString(updates.canonicalTitle) || null
          : updates.canonicalTitle === null ? null : undefined,
        started_at: typeof updates.startedAt !== 'undefined' ? normalizeDate(updates.startedAt) : undefined,
        last_activity_at: typeof updates.lastActivityAt !== 'undefined' ? normalizeDate(updates.lastActivityAt) : undefined,
        closed_at: typeof updates.closedAt !== 'undefined' ? normalizeDate(updates.closedAt) : undefined,
        current_accepted_version_id: typeof updates.currentAcceptedVersionId !== 'undefined'
          ? normalizeOptionalBigInt(updates.currentAcceptedVersionId)
          : undefined,
        current_candidate_version_id: typeof updates.currentCandidateVersionId !== 'undefined'
          ? normalizeOptionalBigInt(updates.currentCandidateVersionId)
          : undefined,
        last_projection_job_id: typeof updates.lastProjectionJobId !== 'undefined'
          ? normalizeOptionalBigInt(updates.lastProjectionJobId)
          : undefined,
        metadata: updates.metadata && typeof updates.metadata === 'object' ? updates.metadata : undefined
      }
    });
    return normalizeTopicLabRecord(updated);
  }

  async function getChatSpaceTopicById(id, config = {}) {
    const prisma = getClient(config);
    const row = await prisma.chatSpaceTopic.findUnique({
      where: { id: BigInt(id) }
    });
    return row ? normalizeTopicLabRecord(row) : null;
  }

  async function listChatSpaceTopics(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.chatSpaceTopic.findMany({
      where: {
        chat_space_type: typeof filters.chatSpaceType === 'string' ? normalizeString(filters.chatSpaceType) : undefined,
        chat_space_id: typeof filters.chatSpaceId !== 'undefined' ? normalizeOptionalBigInt(filters.chatSpaceId) : undefined,
        status: typeof filters.status === 'string' ? normalizeString(filters.status) : undefined
      },
      orderBy: [
        { last_activity_at: 'desc' },
        { updated_at: 'desc' },
        { id: 'desc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 100
    });
    return rows.map(normalizeTopicLabRecord);
  }

  async function createTopicProjectionJob(input, config = {}) {
    const prisma = getClient(config);
    const created = await prisma.topicProjectionJob.create({
      data: {
        chat_space_type: normalizeString(input.chatSpaceType),
        chat_space_id: normalizeOptionalBigInt(input.chatSpaceId),
        trigger_type: normalizeString(input.triggerType) || 'live_projection',
        status: normalizeString(input.status) || 'pending',
        input_bundle_json: normalizeJsonObject(input.inputBundleJson),
        input_bundle_hash: normalizeString(input.inputBundleHash),
        base_version_ids: normalizeJsonArray(input.baseVersionIds),
        model_name: normalizeString(input.modelName) || null,
        model_config_json: input.modelConfigJson && typeof input.modelConfigJson === 'object' ? input.modelConfigJson : undefined,
        prompt_version: normalizeString(input.promptVersion) || null,
        error_code: normalizeString(input.errorCode) || null,
        error_message: normalizeString(input.errorMessage) || null,
        metadata: normalizeJsonObject(input.metadata),
        started_at: normalizeDate(input.startedAt),
        finished_at: normalizeDate(input.finishedAt)
      }
    });
    return normalizeTopicLabRecord(created);
  }

  async function updateTopicProjectionJob(id, updates = {}, config = {}) {
    const prisma = getClient(config);
    const updated = await prisma.topicProjectionJob.update({
      where: { id: BigInt(id) },
      data: {
        status: typeof updates.status === 'string' ? normalizeString(updates.status) : undefined,
        trigger_type: typeof updates.triggerType === 'string' ? normalizeString(updates.triggerType) : undefined,
        input_bundle_json: updates.inputBundleJson && typeof updates.inputBundleJson === 'object'
          ? updates.inputBundleJson
          : undefined,
        input_bundle_hash: typeof updates.inputBundleHash === 'string' ? normalizeString(updates.inputBundleHash) : undefined,
        base_version_ids: Array.isArray(updates.baseVersionIds) ? updates.baseVersionIds : undefined,
        model_name: typeof updates.modelName === 'string'
          ? normalizeString(updates.modelName) || null
          : updates.modelName === null ? null : undefined,
        model_config_json: updates.modelConfigJson && typeof updates.modelConfigJson === 'object'
          ? updates.modelConfigJson
          : undefined,
        prompt_version: typeof updates.promptVersion === 'string'
          ? normalizeString(updates.promptVersion) || null
          : updates.promptVersion === null ? null : undefined,
        error_code: typeof updates.errorCode === 'string'
          ? normalizeString(updates.errorCode) || null
          : updates.errorCode === null ? null : undefined,
        error_message: typeof updates.errorMessage === 'string'
          ? normalizeString(updates.errorMessage) || null
          : updates.errorMessage === null ? null : undefined,
        metadata: updates.metadata && typeof updates.metadata === 'object' ? updates.metadata : undefined,
        started_at: typeof updates.startedAt !== 'undefined' ? normalizeDate(updates.startedAt) : undefined,
        finished_at: typeof updates.finishedAt !== 'undefined' ? normalizeDate(updates.finishedAt) : undefined
      }
    });
    return normalizeTopicLabRecord(updated);
  }

  async function getTopicProjectionJobById(id, config = {}) {
    const prisma = getClient(config);
    const row = await prisma.topicProjectionJob.findUnique({
      where: { id: BigInt(id) }
    });
    return row ? normalizeTopicLabRecord(row) : null;
  }

  async function listTopicProjectionJobs(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.topicProjectionJob.findMany({
      where: {
        chat_space_type: typeof filters.chatSpaceType === 'string' ? normalizeString(filters.chatSpaceType) : undefined,
        chat_space_id: typeof filters.chatSpaceId !== 'undefined' ? normalizeOptionalBigInt(filters.chatSpaceId) : undefined,
        status: typeof filters.status === 'string' ? normalizeString(filters.status) : undefined,
        trigger_type: typeof filters.triggerType === 'string' ? normalizeString(filters.triggerType) : undefined
      },
      orderBy: [
        { updated_at: 'desc' },
        { id: 'desc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 100
    });
    return rows.map(normalizeTopicLabRecord);
  }

  async function createTopicProjectionVersionSnapshot(input, config = {}) {
    const prisma = getClient(config);
    const relationships = Array.isArray(input.relationships) ? input.relationships : [];
    const evidence = Array.isArray(input.evidence) ? input.evidence : [];

    return prisma.$transaction(async (tx) => {
      const created = await tx.topicProjectionVersion.create({
        data: {
          topic_id: normalizeOptionalBigInt(input.topicId),
          projection_job_id: normalizeOptionalBigInt(input.projectionJobId),
          version_number: Number(input.versionNumber || 1),
          status: normalizeString(input.status) || 'candidate',
          lifecycle_state: normalizeString(input.lifecycleState) || 'candidate',
          title: normalizeString(input.title) || null,
          summary_text: normalizeString(input.summaryText),
          review_priority_score: typeof input.reviewPriorityScore === 'number' ? input.reviewPriorityScore : 0,
          heat_score: typeof input.heatScore === 'number' ? input.heatScore : 0,
          participant_ids: normalizeJsonArray(input.participantIds),
          topic_keywords: normalizeJsonArray(input.topicKeywords),
          evidence_count: Number.isFinite(input.evidenceCount) ? Number(input.evidenceCount) : evidence.length,
          relationship_count: Number.isFinite(input.relationshipCount) ? Number(input.relationshipCount) : relationships.length,
          runtime_hit_count: Number.isFinite(input.runtimeHitCount) ? Number(input.runtimeHitCount) : 0,
          last_runtime_hit_at: normalizeDate(input.lastRuntimeHitAt),
          input_bundle_hash: normalizeString(input.inputBundleHash),
          snapshot_json: normalizeJsonObject(input.snapshotJson),
          provenance_json: normalizeJsonObject(input.provenanceJson),
          metadata: normalizeJsonObject(input.metadata)
        }
      });

      for (const relationship of relationships) {
        await tx.topicVersionRelationship.create({
          data: {
            projection_version_id: created.id,
            target_user_id: normalizeOptionalBigInt(relationship.targetUserId),
            relationship_kind: normalizeString(relationship.relationshipKind) || null,
            summary_text: normalizeString(relationship.summaryText),
            actors: normalizeJsonArray(relationship.actors),
            source_event_ids: normalizeJsonArray(relationship.sourceEventIds),
            source_message_ids: normalizeJsonArray(relationship.sourceMessageIds),
            metadata: normalizeJsonObject(relationship.metadata)
          }
        });
      }

      for (const item of evidence) {
        await tx.topicVersionEvidence.create({
          data: {
            projection_version_id: created.id,
            source_kind: normalizeString(item.sourceKind),
            source_id: normalizeOptionalBigInt(item.sourceId),
            sort_order: Number.isFinite(item.sortOrder) ? Number(item.sortOrder) : 0,
            excerpt_text: normalizeString(item.excerptText) || null,
            speaker_id: normalizeString(item.speakerId) || null,
            speaker_name: normalizeString(item.speakerName) || null,
            occurred_at: normalizeDate(item.occurredAt),
            metadata: normalizeJsonObject(item.metadata)
          }
        });
      }

      if (input.topicUpdates && typeof input.topicUpdates === 'object') {
        await tx.chatSpaceTopic.update({
          where: { id: normalizeOptionalBigInt(input.topicId) },
          data: {
            status: typeof input.topicUpdates.status === 'string' ? normalizeString(input.topicUpdates.status) : undefined,
            canonical_title: typeof input.topicUpdates.canonicalTitle === 'string'
              ? normalizeString(input.topicUpdates.canonicalTitle) || null
              : undefined,
            started_at: typeof input.topicUpdates.startedAt !== 'undefined' ? normalizeDate(input.topicUpdates.startedAt) : undefined,
            last_activity_at: typeof input.topicUpdates.lastActivityAt !== 'undefined' ? normalizeDate(input.topicUpdates.lastActivityAt) : undefined,
            closed_at: typeof input.topicUpdates.closedAt !== 'undefined' ? normalizeDate(input.topicUpdates.closedAt) : undefined,
            current_accepted_version_id: typeof input.topicUpdates.currentAcceptedVersionId !== 'undefined'
              ? normalizeOptionalBigInt(input.topicUpdates.currentAcceptedVersionId)
              : undefined,
            current_candidate_version_id: typeof input.topicUpdates.currentCandidateVersionId !== 'undefined'
              ? normalizeOptionalBigInt(input.topicUpdates.currentCandidateVersionId)
              : undefined,
            last_projection_job_id: typeof input.topicUpdates.lastProjectionJobId !== 'undefined'
              ? normalizeOptionalBigInt(input.topicUpdates.lastProjectionJobId)
              : undefined,
            metadata: input.topicUpdates.metadata && typeof input.topicUpdates.metadata === 'object'
              ? input.topicUpdates.metadata
              : undefined
          }
        });
      }

      return normalizeTopicLabRecord(created);
    });
  }

  async function updateTopicProjectionVersion(id, updates = {}, config = {}) {
    const prisma = getClient(config);
    const updated = await prisma.topicProjectionVersion.update({
      where: { id: BigInt(id) },
      data: {
        status: typeof updates.status === 'string' ? normalizeString(updates.status) : undefined,
        lifecycle_state: typeof updates.lifecycleState === 'string' ? normalizeString(updates.lifecycleState) : undefined,
        title: typeof updates.title === 'string'
          ? normalizeString(updates.title) || null
          : updates.title === null ? null : undefined,
        summary_text: typeof updates.summaryText === 'string' ? normalizeString(updates.summaryText) : undefined,
        review_priority_score: typeof updates.reviewPriorityScore === 'number' ? updates.reviewPriorityScore : undefined,
        heat_score: typeof updates.heatScore === 'number' ? updates.heatScore : undefined,
        participant_ids: Array.isArray(updates.participantIds) ? updates.participantIds : undefined,
        topic_keywords: Array.isArray(updates.topicKeywords) ? updates.topicKeywords : undefined,
        evidence_count: typeof updates.evidenceCount === 'number' ? updates.evidenceCount : undefined,
        relationship_count: typeof updates.relationshipCount === 'number' ? updates.relationshipCount : undefined,
        runtime_hit_count: typeof updates.runtimeHitCount === 'number' ? updates.runtimeHitCount : undefined,
        last_runtime_hit_at: typeof updates.lastRuntimeHitAt !== 'undefined' ? normalizeDate(updates.lastRuntimeHitAt) : undefined,
        input_bundle_hash: typeof updates.inputBundleHash === 'string' ? normalizeString(updates.inputBundleHash) : undefined,
        snapshot_json: updates.snapshotJson && typeof updates.snapshotJson === 'object' ? updates.snapshotJson : undefined,
        provenance_json: updates.provenanceJson && typeof updates.provenanceJson === 'object' ? updates.provenanceJson : undefined,
        metadata: updates.metadata && typeof updates.metadata === 'object' ? updates.metadata : undefined
      }
    });
    return normalizeTopicLabRecord(updated);
  }

  async function getTopicProjectionVersionById(id, config = {}) {
    const prisma = getClient(config);
    const row = await prisma.topicProjectionVersion.findUnique({
      where: { id: BigInt(id) }
    });
    return row ? normalizeTopicLabRecord(row) : null;
  }

  async function listTopicProjectionVersions(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.topicProjectionVersion.findMany({
      where: {
        topic_id: typeof filters.topicId !== 'undefined' ? normalizeOptionalBigInt(filters.topicId) : undefined,
        projection_job_id: typeof filters.projectionJobId !== 'undefined'
          ? normalizeOptionalBigInt(filters.projectionJobId)
          : undefined,
        status: typeof filters.status === 'string' ? normalizeString(filters.status) : undefined
      },
      orderBy: [
        { version_number: 'desc' },
        { created_at: 'desc' },
        { id: 'desc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 100
    });
    return rows.map(normalizeTopicLabRecord);
  }

  async function listTopicVersionRelationships(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.topicVersionRelationship.findMany({
      where: {
        projection_version_id: typeof filters.projectionVersionId !== 'undefined'
          ? normalizeOptionalBigInt(filters.projectionVersionId)
          : undefined,
        target_user_id: typeof filters.targetUserId !== 'undefined'
          ? normalizeOptionalBigInt(filters.targetUserId)
          : undefined
      },
      orderBy: [
        { id: 'asc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 200
    });
    return rows.map(normalizeTopicLabRecord);
  }

  async function listTopicVersionEvidence(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.topicVersionEvidence.findMany({
      where: {
        projection_version_id: typeof filters.projectionVersionId !== 'undefined'
          ? normalizeOptionalBigInt(filters.projectionVersionId)
          : undefined,
        source_kind: typeof filters.sourceKind === 'string' ? normalizeString(filters.sourceKind) : undefined
      },
      orderBy: [
        { sort_order: 'asc' },
        { id: 'asc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 500
    });
    return rows.map(normalizeTopicLabRecord);
  }

  async function createTopicReviewEvent(input, config = {}) {
    const prisma = getClient(config);
    const created = await prisma.topicReviewEvent.create({
      data: {
        topic_id: normalizeOptionalBigInt(input.topicId),
        base_projection_version_id: normalizeOptionalBigInt(input.baseProjectionVersionId),
        result_projection_version_id: normalizeOptionalBigInt(input.resultProjectionVersionId),
        action_type: normalizeString(input.actionType),
        status: normalizeString(input.status) || 'recorded',
        created_by: normalizeString(input.createdBy) || null,
        manual_note: normalizeString(input.manualNote) || null,
        patch_json: input.patchJson && typeof input.patchJson === 'object' ? input.patchJson : undefined,
        metadata: normalizeJsonObject(input.metadata)
      }
    });
    return normalizeTopicLabRecord(created);
  }

  async function updateTopicReviewEvent(id, updates = {}, config = {}) {
    const prisma = getClient(config);
    const updated = await prisma.topicReviewEvent.update({
      where: { id: BigInt(id) },
      data: {
        result_projection_version_id: typeof updates.resultProjectionVersionId !== 'undefined'
          ? normalizeOptionalBigInt(updates.resultProjectionVersionId)
          : undefined,
        status: typeof updates.status === 'string' ? normalizeString(updates.status) : undefined,
        manual_note: typeof updates.manualNote === 'string'
          ? normalizeString(updates.manualNote) || null
          : updates.manualNote === null ? null : undefined,
        patch_json: updates.patchJson && typeof updates.patchJson === 'object' ? updates.patchJson : undefined,
        metadata: updates.metadata && typeof updates.metadata === 'object' ? updates.metadata : undefined
      }
    });
    return normalizeTopicLabRecord(updated);
  }

  async function getTopicReviewEventById(id, config = {}) {
    const prisma = getClient(config);
    const row = await prisma.topicReviewEvent.findUnique({
      where: { id: BigInt(id) }
    });
    return row ? normalizeTopicLabRecord(row) : null;
  }

  async function listTopicReviewEvents(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.topicReviewEvent.findMany({
      where: {
        topic_id: typeof filters.topicId !== 'undefined' ? normalizeOptionalBigInt(filters.topicId) : undefined,
        base_projection_version_id: typeof filters.baseProjectionVersionId !== 'undefined'
          ? normalizeOptionalBigInt(filters.baseProjectionVersionId)
          : undefined,
        status: typeof filters.status === 'string' ? normalizeString(filters.status) : undefined
      },
      orderBy: [
        { created_at: 'desc' },
        { id: 'desc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 100
    });
    return rows.map(normalizeTopicLabRecord);
  }

  async function createGoldenChatCase(input, config = {}) {
    const prisma = getClient(config);
    const created = await prisma.goldenChatCase.create({
      data: {
        chat_space_type: normalizeString(input.chatSpaceType),
        chat_space_id: normalizeOptionalBigInt(input.chatSpaceId),
        topic_id: normalizeOptionalBigInt(input.topicId),
        source_projection_version_id: normalizeOptionalBigInt(input.sourceProjectionVersionId),
        label: normalizeString(input.label) || null,
        status: normalizeString(input.status) || 'active',
        input_bundle_hash: normalizeString(input.inputBundleHash),
        expected_snapshot_json: normalizeJsonObject(input.expectedSnapshotJson),
        fixture_bundle_json: normalizeJsonObject(input.fixtureBundleJson),
        created_by: normalizeString(input.createdBy) || null,
        metadata: normalizeJsonObject(input.metadata)
      }
    });
    return normalizeTopicLabRecord(created);
  }

  async function listGoldenChatCases(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.goldenChatCase.findMany({
      where: {
        chat_space_type: typeof filters.chatSpaceType === 'string' ? normalizeString(filters.chatSpaceType) : undefined,
        chat_space_id: typeof filters.chatSpaceId !== 'undefined' ? normalizeOptionalBigInt(filters.chatSpaceId) : undefined,
        topic_id: typeof filters.topicId !== 'undefined' ? normalizeOptionalBigInt(filters.topicId) : undefined,
        status: typeof filters.status === 'string' ? normalizeString(filters.status) : undefined
      },
      orderBy: [
        { updated_at: 'desc' },
        { id: 'desc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 100
    });
    return rows.map(normalizeTopicLabRecord);
  }

  return {
    ensureTopicLabSchema,
    createChatSpaceTopic,
    updateChatSpaceTopic,
    getChatSpaceTopicById,
    listChatSpaceTopics,
    createTopicProjectionJob,
    updateTopicProjectionJob,
    getTopicProjectionJobById,
    listTopicProjectionJobs,
    createTopicProjectionVersionSnapshot,
    updateTopicProjectionVersion,
    getTopicProjectionVersionById,
    listTopicProjectionVersions,
    listTopicVersionRelationships,
    listTopicVersionEvidence,
    createTopicReviewEvent,
    updateTopicReviewEvent,
    getTopicReviewEventById,
    listTopicReviewEvents,
    createGoldenChatCase,
    listGoldenChatCases
  };
}

module.exports = {
  createTopicLabPersistence
};

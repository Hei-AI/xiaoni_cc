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

function normalizeRelationshipRecord(record) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  return {
    ...record,
    id: typeof record.id === 'bigint' ? Number(record.id) : record.id,
    group_id: typeof record.group_id === 'bigint' ? Number(record.group_id) : record.group_id,
    target_user_id: typeof record.target_user_id === 'bigint' ? Number(record.target_user_id) : record.target_user_id,
    turn_range_start: typeof record.turn_range_start === 'bigint' ? Number(record.turn_range_start) : record.turn_range_start,
    turn_range_end: typeof record.turn_range_end === 'bigint' ? Number(record.turn_range_end) : record.turn_range_end,
    card_id: typeof record.card_id === 'bigint' ? Number(record.card_id) : record.card_id
  };
}

function normalizeIdList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const normalized = values
    .map((value) => normalizeOptionalBigInt(value))
    .filter((value) => value !== null);

  const seen = new Set();
  return normalized.filter((value) => {
    const key = value.toString();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function createRelationshipMemoryPersistence({ getPrismaClient, createSqlAdapter }) {
  function getClient(config) {
    return getPrismaClient(config);
  }

  async function ensureRelationshipMemorySchema(config = {}) {
    const sql = createSqlAdapter(config);
    try {
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS relationship_ledger_events (
            id BIGSERIAL PRIMARY KEY,
            group_id BIGINT NULL,
            target_user_id BIGINT NULL,
            session_key VARCHAR(191) NOT NULL,
            event_type VARCHAR(64) NOT NULL,
            event_weight DOUBLE PRECISION NOT NULL DEFAULT 0,
            confidence VARCHAR(16) NOT NULL DEFAULT 'medium',
            source_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
            source_excerpt TEXT NULL,
            metadata JSONB NULL,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_reinforced_at TIMESTAMP(3) NULL
          )
        `
      );
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS relationship_memory_jobs (
            id BIGSERIAL PRIMARY KEY,
            group_id BIGINT NULL,
            session_key VARCHAR(191) NOT NULL,
            status VARCHAR(16) NOT NULL,
            trigger_reason VARCHAR(64) NOT NULL,
            turn_range_start BIGINT NULL,
            turn_range_end BIGINT NULL,
            ledger_event_count INTEGER NOT NULL DEFAULT 0,
            input_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
            output_card_version INTEGER NULL,
            error_message TEXT NULL,
            metadata JSONB NULL,
            started_at TIMESTAMP(3) NULL,
            finished_at TIMESTAMP(3) NULL,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS relationship_memory_cards (
            id BIGSERIAL PRIMARY KEY,
            card_type VARCHAR(32) NOT NULL,
            group_id BIGINT NULL,
            target_user_id BIGINT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            summary_text TEXT NOT NULL,
            actors JSONB NOT NULL DEFAULT '[]'::jsonb,
            context_before TEXT NULL,
            trigger TEXT NULL,
            interaction TEXT NULL,
            outcome TEXT NULL,
            source_event_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
            source_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
            importance_score DOUBLE PRECISION NOT NULL DEFAULT 0,
            freshness_score DOUBLE PRECISION NOT NULL DEFAULT 0,
            decayed_score DOUBLE PRECISION NOT NULL DEFAULT 0,
            retrieval_text TEXT NULL,
            embedding_text TEXT NULL,
            last_hit_at TIMESTAMP(3) NULL,
            metadata JSONB NULL,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS relationship_memory_overrides (
            id BIGSERIAL PRIMARY KEY,
            card_id BIGINT NOT NULL,
            action_type VARCHAR(32) NOT NULL,
            manual_note TEXT NULL,
            created_by VARCHAR(191) NULL,
            metadata JSONB NULL,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `
      );
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_relationship_ledger_scope_type_created ON relationship_ledger_events (group_id, target_user_id, event_type, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_relationship_ledger_session_created ON relationship_ledger_events (session_key, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_relationship_memory_jobs_group_status_updated ON relationship_memory_jobs (group_id, status, updated_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_relationship_memory_jobs_session_updated ON relationship_memory_jobs (session_key, updated_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_relationship_memory_cards_scope_active_score ON relationship_memory_cards (group_id, target_user_id, card_type, is_active, decayed_score DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_relationship_memory_cards_group_active_updated ON relationship_memory_cards (group_id, is_active, updated_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_relationship_memory_overrides_card_created ON relationship_memory_overrides (card_id, created_at DESC)');
    } finally {
      await sql.close();
    }
  }

  async function appendRelationshipLedgerEvent(input, config = {}) {
    const prisma = getClient(config);
    const created = await prisma.relationshipLedgerEvent.create({
      data: {
        group_id: normalizeOptionalBigInt(input.groupId),
        target_user_id: normalizeOptionalBigInt(input.targetUserId),
        session_key: String(input.sessionKey || ''),
        event_type: String(input.eventType || ''),
        event_weight: Number(input.eventWeight || 0),
        confidence: String(input.confidence || 'medium'),
        source_message_ids: normalizeJsonArray(input.sourceMessageIds),
        source_excerpt: input.sourceExcerpt ? String(input.sourceExcerpt) : null,
        metadata: normalizeJsonObject(input.metadata),
        created_at: normalizeDate(input.createdAt) || new Date(),
        last_reinforced_at: normalizeDate(input.lastReinforcedAt)
      }
    });
    return normalizeRelationshipRecord(created);
  }

  async function reinforceRelationshipLedgerEvent(id, updates = {}, config = {}) {
    const prisma = getClient(config);
    const updated = await prisma.relationshipLedgerEvent.update({
      where: { id: BigInt(id) },
      data: {
        event_weight: typeof updates.eventWeight === 'number' ? updates.eventWeight : undefined,
        confidence: typeof updates.confidence === 'string' ? updates.confidence : undefined,
        source_message_ids: Array.isArray(updates.sourceMessageIds) ? updates.sourceMessageIds : undefined,
        source_excerpt: typeof updates.sourceExcerpt === 'string' ? updates.sourceExcerpt : undefined,
        metadata: updates.metadata && typeof updates.metadata === 'object' ? updates.metadata : undefined,
        last_reinforced_at: normalizeDate(updates.lastReinforcedAt) || new Date()
      }
    });
    return normalizeRelationshipRecord(updated);
  }

  async function listRelationshipLedgerEvents(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.relationshipLedgerEvent.findMany({
      where: {
        group_id: typeof filters.groupId !== 'undefined' ? normalizeOptionalBigInt(filters.groupId) : undefined,
        target_user_id: typeof filters.targetUserId !== 'undefined' ? normalizeOptionalBigInt(filters.targetUserId) : undefined,
        session_key: typeof filters.sessionKey === 'string' ? filters.sessionKey : undefined,
        event_type: typeof filters.eventType === 'string' ? filters.eventType : undefined
      },
      orderBy: [
        { created_at: 'desc' },
        { id: 'desc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 100
    });
    return rows.map(normalizeRelationshipRecord);
  }

  async function listRelationshipLedgerEventsByIds(ids = [], config = {}) {
    const prisma = getClient(config);
    const normalizedIds = normalizeIdList(ids);
    if (normalizedIds.length === 0) {
      return [];
    }

    const rows = await prisma.relationshipLedgerEvent.findMany({
      where: {
        id: { in: normalizedIds }
      }
    });

    const order = new Map(normalizedIds.map((id, index) => [id.toString(), index]));
    return rows
      .map(normalizeRelationshipRecord)
      .sort((left, right) => (order.get(String(left.id)) ?? Number.MAX_SAFE_INTEGER) - (order.get(String(right.id)) ?? Number.MAX_SAFE_INTEGER));
  }

  async function createRelationshipMemoryJob(input, config = {}) {
    const prisma = getClient(config);
    const created = await prisma.relationshipMemoryJob.create({
      data: {
        group_id: normalizeOptionalBigInt(input.groupId),
        session_key: String(input.sessionKey || ''),
        status: String(input.status || 'pending'),
        trigger_reason: String(input.triggerReason || 'compact_checkpoint'),
        turn_range_start: normalizeOptionalBigInt(input.turnRangeStart),
        turn_range_end: normalizeOptionalBigInt(input.turnRangeEnd),
        ledger_event_count: Number(input.ledgerEventCount || 0),
        input_message_ids: normalizeJsonArray(input.inputMessageIds),
        output_card_version: typeof input.outputCardVersion === 'number' ? input.outputCardVersion : null,
        error_message: input.errorMessage ? String(input.errorMessage) : null,
        metadata: normalizeJsonObject(input.metadata),
        started_at: normalizeDate(input.startedAt),
        finished_at: normalizeDate(input.finishedAt)
      }
    });
    return normalizeRelationshipRecord(created);
  }

  async function updateRelationshipMemoryJob(id, updates = {}, config = {}) {
    const prisma = getClient(config);
    const updated = await prisma.relationshipMemoryJob.update({
      where: { id: BigInt(id) },
      data: {
        status: typeof updates.status === 'string' ? updates.status : undefined,
        trigger_reason: typeof updates.triggerReason === 'string' ? updates.triggerReason : undefined,
        turn_range_start: typeof updates.turnRangeStart !== 'undefined' ? normalizeOptionalBigInt(updates.turnRangeStart) : undefined,
        turn_range_end: typeof updates.turnRangeEnd !== 'undefined' ? normalizeOptionalBigInt(updates.turnRangeEnd) : undefined,
        ledger_event_count: typeof updates.ledgerEventCount === 'number' ? updates.ledgerEventCount : undefined,
        input_message_ids: Array.isArray(updates.inputMessageIds) ? updates.inputMessageIds : undefined,
        output_card_version: typeof updates.outputCardVersion === 'number' ? updates.outputCardVersion : undefined,
        error_message: typeof updates.errorMessage === 'string' ? updates.errorMessage : updates.errorMessage === null ? null : undefined,
        metadata: updates.metadata && typeof updates.metadata === 'object' ? updates.metadata : undefined,
        started_at: typeof updates.startedAt !== 'undefined' ? normalizeDate(updates.startedAt) : undefined,
        finished_at: typeof updates.finishedAt !== 'undefined' ? normalizeDate(updates.finishedAt) : undefined
      }
    });
    return normalizeRelationshipRecord(updated);
  }

  async function listRelationshipMemoryJobs(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.relationshipMemoryJob.findMany({
      where: {
        group_id: typeof filters.groupId !== 'undefined' ? normalizeOptionalBigInt(filters.groupId) : undefined,
        session_key: typeof filters.sessionKey === 'string' ? filters.sessionKey : undefined,
        status: typeof filters.status === 'string' ? filters.status : undefined
      },
      orderBy: [
        { updated_at: 'desc' },
        { id: 'desc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 50
    });
    return rows.map(normalizeRelationshipRecord);
  }

  async function replaceRelationshipMemoryCards(input, config = {}) {
    const prisma = getClient(config);
    const groupId = normalizeOptionalBigInt(input.groupId);
    const targetUserId = typeof input.targetUserId !== 'undefined'
      ? normalizeOptionalBigInt(input.targetUserId)
      : undefined;
    const cardType = String(input.cardType || '');
    const version = Number(input.version || 1);
    const cards = Array.isArray(input.cards) ? input.cards : [];

    return prisma.$transaction(async (tx) => {
      await tx.relationshipMemoryCard.updateMany({
        where: {
          group_id: groupId,
          target_user_id: targetUserId,
          card_type: cardType,
          is_active: true
        },
        data: {
          is_active: false
        }
      });

      const created = [];
      for (const card of cards) {
        const row = await tx.relationshipMemoryCard.create({
          data: {
            card_type: cardType,
            group_id: groupId,
            target_user_id: targetUserId ?? null,
            version,
            is_active: card.isActive !== false,
            summary_text: String(card.summaryText || ''),
            actors: normalizeJsonArray(card.actors),
            context_before: card.contextBefore ? String(card.contextBefore) : null,
            trigger: card.trigger ? String(card.trigger) : null,
            interaction: card.interaction ? String(card.interaction) : null,
            outcome: card.outcome ? String(card.outcome) : null,
            source_event_ids: normalizeJsonArray(card.sourceEventIds),
            source_message_ids: normalizeJsonArray(card.sourceMessageIds),
            importance_score: Number(card.importanceScore || 0),
            freshness_score: Number(card.freshnessScore || 0),
            decayed_score: Number(card.decayedScore || 0),
            retrieval_text: card.retrievalText ? String(card.retrievalText) : null,
            embedding_text: card.embeddingText ? String(card.embeddingText) : null,
            last_hit_at: normalizeDate(card.lastHitAt),
            metadata: normalizeJsonObject(card.metadata)
          }
        });
        created.push(normalizeRelationshipRecord(row));
      }
      return created;
    });
  }

  async function listRelationshipMemoryCards(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.relationshipMemoryCard.findMany({
      where: {
        group_id: typeof filters.groupId !== 'undefined' ? normalizeOptionalBigInt(filters.groupId) : undefined,
        target_user_id: typeof filters.targetUserId !== 'undefined' ? normalizeOptionalBigInt(filters.targetUserId) : undefined,
        card_type: typeof filters.cardType === 'string' ? filters.cardType : undefined,
        is_active: typeof filters.isActive === 'boolean' ? filters.isActive : undefined
      },
      orderBy: [
        { decayed_score: 'desc' },
        { updated_at: 'desc' },
        { id: 'desc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 100
    });
    return rows.map(normalizeRelationshipRecord);
  }

  async function getRelationshipMemoryCardById(id, config = {}) {
    const prisma = getClient(config);
    const row = await prisma.relationshipMemoryCard.findUnique({
      where: { id: BigInt(id) }
    });
    return row ? normalizeRelationshipRecord(row) : null;
  }

  async function listConversationItemsByIds(ids = [], config = {}) {
    const prisma = getClient(config);
    const normalizedIds = normalizeIdList(ids);
    if (normalizedIds.length === 0) {
      return [];
    }

    const rows = await prisma.conversationItem.findMany({
      where: {
        id: { in: normalizedIds }
      }
    });

    const order = new Map(normalizedIds.map((id, index) => [id.toString(), index]));
    return rows
      .map(normalizeRelationshipRecord)
      .sort((left, right) => (order.get(String(left.id)) ?? Number.MAX_SAFE_INTEGER) - (order.get(String(right.id)) ?? Number.MAX_SAFE_INTEGER));
  }

  async function listAgentInboundMessages(filters = {}, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.agentInboundMessage.findMany({
      where: {
        session_key: typeof filters.sessionKey === 'string' ? normalizeString(filters.sessionKey) : undefined,
        chat_type: typeof filters.chatType === 'string' ? normalizeString(filters.chatType) : undefined,
        sender_id: typeof filters.senderId === 'string' ? normalizeString(filters.senderId) : undefined
      },
      orderBy: [
        { received_at: 'desc' },
        { id: 'desc' }
      ],
      take: Number.isFinite(filters.limit) ? Number(filters.limit) : 100
    });
    return rows.map(normalizeRelationshipRecord);
  }

  async function listAgentInboundMessagesByIds(ids = [], config = {}) {
    const prisma = getClient(config);
    const normalizedIds = normalizeIdList(ids);
    if (normalizedIds.length === 0) {
      return [];
    }

    const rows = await prisma.agentInboundMessage.findMany({
      where: {
        id: { in: normalizedIds }
      }
    });

    const order = new Map(normalizedIds.map((id, index) => [id.toString(), index]));
    return rows
      .map(normalizeRelationshipRecord)
      .sort((left, right) => (order.get(String(left.id)) ?? Number.MAX_SAFE_INTEGER) - (order.get(String(right.id)) ?? Number.MAX_SAFE_INTEGER));
  }

  async function getAgentInboundMessageByMessageSid(messageSid, filters = {}, config = {}) {
    const prisma = getClient(config);
    const normalizedMessageSid = normalizeString(messageSid);
    if (!normalizedMessageSid) {
      return null;
    }

    const row = await prisma.agentInboundMessage.findFirst({
      where: {
        message_sid: normalizedMessageSid,
        session_key: typeof filters.sessionKey === 'string' ? normalizeString(filters.sessionKey) : undefined
      },
      orderBy: [
        { received_at: 'desc' },
        { id: 'desc' }
      ]
    });

    return row ? normalizeRelationshipRecord(row) : null;
  }

  async function recordRelationshipMemoryOverride(input, config = {}) {
    const prisma = getClient(config);
    const created = await prisma.relationshipMemoryOverride.create({
      data: {
        card_id: BigInt(input.cardId),
        action_type: String(input.actionType || ''),
        manual_note: input.manualNote ? String(input.manualNote) : null,
        created_by: input.createdBy ? String(input.createdBy) : null,
        metadata: normalizeJsonObject(input.metadata)
      }
    });
    return normalizeRelationshipRecord(created);
  }

  async function listRelationshipMemoryOverrides(cardId, config = {}) {
    const prisma = getClient(config);
    const rows = await prisma.relationshipMemoryOverride.findMany({
      where: { card_id: BigInt(cardId) },
      orderBy: [
        { created_at: 'desc' },
        { id: 'desc' }
      ]
    });
    return rows.map(normalizeRelationshipRecord);
  }

  async function deleteRelationshipMemoryOverride(id, config = {}) {
    const prisma = getClient(config);
    const deleted = await prisma.relationshipMemoryOverride.delete({
      where: { id: BigInt(id) }
    });
    return normalizeRelationshipRecord(deleted);
  }

  async function markRelationshipMemoryCardsHit(ids = [], params = {}, config = {}) {
    const prisma = getClient(config);
    const normalizedIds = normalizeIdList(ids);
    if (normalizedIds.length === 0) {
      return { count: 0 };
    }

    const hitAt = normalizeDate(params.hitAt) || new Date();
    const result = await prisma.relationshipMemoryCard.updateMany({
      where: {
        id: { in: normalizedIds }
      },
      data: {
        last_hit_at: hitAt
      }
    });

    return {
      count: Number(result.count || 0),
      hit_at: hitAt
    };
  }

  return {
    ensureRelationshipMemorySchema,
    appendRelationshipLedgerEvent,
    reinforceRelationshipLedgerEvent,
    listRelationshipLedgerEvents,
    listRelationshipLedgerEventsByIds,
    createRelationshipMemoryJob,
    updateRelationshipMemoryJob,
    listRelationshipMemoryJobs,
    replaceRelationshipMemoryCards,
    listRelationshipMemoryCards,
    getRelationshipMemoryCardById,
    listConversationItemsByIds,
    listAgentInboundMessages,
    listAgentInboundMessagesByIds,
    getAgentInboundMessageByMessageSid,
    recordRelationshipMemoryOverride,
    listRelationshipMemoryOverrides,
    deleteRelationshipMemoryOverride,
    markRelationshipMemoryCardsHit
  };
}

module.exports = {
  createRelationshipMemoryPersistence
};

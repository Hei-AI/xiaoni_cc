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

function normalizeJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return fallback;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeAsset(record) {
  if (!record) {
    return null;
  }
  const observations = Array.isArray(record.observations)
    ? record.observations.map(normalizeObservation).filter(Boolean)
    : [];
  return {
    id: record.id,
    source: record.source,
    source_message_id: record.source_message_id === null || typeof record.source_message_id === 'undefined'
      ? null
      : Number(record.source_message_id),
    trace_id: record.trace_id,
    session_key: record.session_key,
    chat_type: record.chat_type,
    peer_id: record.peer_id,
    peer_name: record.peer_name,
    sender_id: record.sender_id,
    sender_name: record.sender_name,
    account_id: record.account_id,
    message_sid: record.message_sid,
    media_tag: record.media_tag,
    placeholder: record.placeholder,
    media_type: record.media_type,
    mime_type: record.mime_type,
    source_locator: record.source_locator,
    storage_uri: record.storage_uri,
    metadata: record.metadata || {},
    created_at: normalizeDate(record.created_at),
    updated_at: normalizeDate(record.updated_at),
    observations
  };
}

function normalizeObservation(record) {
  if (!record) {
    return null;
  }
  return {
    id: record.id,
    asset_id: record.asset_id,
    observer: record.observer,
    description: record.description,
    source_model: record.source_model,
    confidence: record.confidence,
    metadata: record.metadata || {},
    created_at: normalizeDate(record.created_at)
  };
}

function createAgentMediaPersistence({ getPrismaClient, createSqlAdapter }) {
  function getClient(config) {
    return getPrismaClient(config);
  }

  async function ensureAgentMediaSchema(config = {}) {
    const sql = createSqlAdapter(config);
    try {
      await sql.query("SELECT pg_advisory_lock(hashtext('qqbot_agent_media_schema'))");
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS agent_media_assets (
          id VARCHAR(64) PRIMARY KEY,
          source VARCHAR(32) NOT NULL,
          source_message_id BIGINT NULL,
          trace_id VARCHAR(128) NULL,
          session_key VARCHAR(191) NOT NULL,
          chat_type VARCHAR(16) NOT NULL,
          peer_id VARCHAR(191) NULL,
          peer_name VARCHAR(255) NULL,
          sender_id VARCHAR(191) NULL,
          sender_name VARCHAR(255) NULL,
          account_id VARCHAR(191) NULL,
          message_sid VARCHAR(191) NULL,
          media_tag VARCHAR(64) NOT NULL,
          placeholder VARCHAR(64) NOT NULL DEFAULT '[Image]',
          media_type VARCHAR(32) NOT NULL DEFAULT 'image',
          mime_type VARCHAR(128) NULL,
          source_locator TEXT NULL,
          storage_uri TEXT NULL,
          metadata JSONB NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS agent_media_observations (
          id VARCHAR(64) PRIMARY KEY,
          asset_id VARCHAR(64) NOT NULL REFERENCES agent_media_assets(id) ON DELETE CASCADE,
          observer VARCHAR(64) NOT NULL,
          description TEXT NOT NULL,
          source_model VARCHAR(128) NULL,
          confidence VARCHAR(32) NULL,
          metadata JSONB NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute('CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_media_message_tag ON agent_media_assets (message_sid, media_tag)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_media_session_created ON agent_media_assets (session_key, created_at DESC, id DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_media_source_message ON agent_media_assets (source_message_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_media_message_sid ON agent_media_assets (message_sid)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_media_observations_asset_created ON agent_media_observations (asset_id, created_at DESC)');
    } finally {
      await sql.query("SELECT pg_advisory_unlock(hashtext('qqbot_agent_media_schema'))").catch(() => undefined);
      await sql.close();
    }
  }

  async function upsertAgentMediaAsset(input, config = {}) {
    const prisma = getClient(config);
    const messageSid = normalizeOptionalString(input.messageSid || input.message_sid);
    const mediaTag = normalizeOptionalString(input.mediaTag || input.media_tag) || 'image_1';
    const data = {
      id: normalizeOptionalString(input.id) || `media_${Date.now()}_${randomUUID().slice(0, 8)}`,
      source: normalizeOptionalString(input.source) || 'napcat',
      source_message_id: input.sourceMessageId || input.source_message_id || null,
      trace_id: normalizeOptionalString(input.traceId || input.trace_id),
      session_key: normalizeOptionalString(input.sessionKey || input.session_key) || '',
      chat_type: normalizeOptionalString(input.chatType || input.chat_type) || 'group',
      peer_id: normalizeOptionalString(input.peerId || input.peer_id),
      peer_name: normalizeOptionalString(input.peerName || input.peer_name),
      sender_id: normalizeOptionalString(input.senderId || input.sender_id),
      sender_name: normalizeOptionalString(input.senderName || input.sender_name),
      account_id: normalizeOptionalString(input.accountId || input.account_id),
      message_sid: messageSid,
      media_tag: mediaTag,
      placeholder: normalizeOptionalString(input.placeholder) || '[Image]',
      media_type: normalizeOptionalString(input.mediaType || input.media_type) || 'image',
      mime_type: normalizeOptionalString(input.mimeType || input.mime_type),
      source_locator: normalizeOptionalString(input.sourceLocator || input.source_locator || input.locator),
      storage_uri: normalizeOptionalString(input.storageUri || input.storage_uri),
      metadata: normalizeJsonObject(input.metadata)
    };

    const row = messageSid
      ? await prisma.agentMediaAsset.upsert({
          where: {
            message_sid_media_tag: {
              message_sid: messageSid,
              media_tag: mediaTag
            }
          },
          update: {
            trace_id: data.trace_id,
            source_locator: data.source_locator,
            storage_uri: data.storage_uri,
            mime_type: data.mime_type,
            metadata: data.metadata
          },
          create: data,
          include: { observations: { orderBy: [{ created_at: 'desc' }] } }
        })
      : await prisma.agentMediaAsset.create({
          data,
          include: { observations: { orderBy: [{ created_at: 'desc' }] } }
        });
    return normalizeAsset(row);
  }

  async function upsertAgentMediaAssets(inputs = [], config = {}) {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      return [];
    }
    const rows = [];
    for (const input of inputs) {
      rows.push(await upsertAgentMediaAsset(input, config));
    }
    return rows.filter(Boolean);
  }

  async function listAgentMediaAssets(filters = {}, config = {}) {
    const prisma = getClient(config);
    const limit = Math.max(1, Math.min(100, Number.parseInt(String(filters.limit || 30), 10) || 30));
    const where = {};
    if (filters.sessionKey || filters.session_key) {
      where.session_key = String(filters.sessionKey || filters.session_key);
    }
    if (Array.isArray(filters.messageSids || filters.message_sids)) {
      const values = (filters.messageSids || filters.message_sids).map(String).filter(Boolean);
      if (values.length > 0) {
        where.message_sid = { in: values };
      }
    }
    if (filters.mediaTag || filters.media_tag) {
      where.media_tag = String(filters.mediaTag || filters.media_tag);
    }
    const rows = await prisma.agentMediaAsset.findMany({
      where,
      orderBy: [
        { created_at: 'desc' },
        { id: 'desc' }
      ],
      take: limit,
      include: {
        observations: {
          orderBy: [{ created_at: 'desc' }],
          take: 3
        }
      }
    });
    return rows.map(normalizeAsset).filter(Boolean);
  }

  async function getAgentMediaAssetByTag(filters = {}, config = {}) {
    const rows = await listAgentMediaAssets({
      ...filters,
      limit: 1
    }, config);
    return rows[0] || null;
  }

  async function createAgentMediaObservation(input, config = {}) {
    const prisma = getClient(config);
    const created = await prisma.agentMediaObservation.create({
      data: {
        id: normalizeOptionalString(input.id) || `media_obs_${Date.now()}_${randomUUID().slice(0, 8)}`,
        asset_id: input.assetId || input.asset_id,
        observer: normalizeOptionalString(input.observer) || 'xiaoni',
        description: typeof input.description === 'string' ? input.description : '',
        source_model: normalizeOptionalString(input.sourceModel || input.source_model),
        confidence: normalizeOptionalString(input.confidence),
        metadata: normalizeJsonObject(input.metadata)
      }
    });
    return normalizeObservation(created);
  }

  return {
    ensureAgentMediaSchema,
    upsertAgentMediaAsset,
    upsertAgentMediaAssets,
    listAgentMediaAssets,
    getAgentMediaAssetByTag,
    createAgentMediaObservation
  };
}

module.exports = {
  createAgentMediaPersistence
};

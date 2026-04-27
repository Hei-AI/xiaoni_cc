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

function normalizeJsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeInt(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeArtifact(record) {
  if (!record) {
    return null;
  }
  return {
    id: record.id,
    task_id: record.task_id,
    kind: record.kind,
    file_path: record.file_path,
    public_path: record.public_path,
    data_url: record.data_url,
    mime_type: record.mime_type,
    format: record.format,
    bytes: record.bytes,
    revised_prompt: record.revised_prompt,
    metadata: record.metadata || {},
    created_at: normalizeDate(record.created_at)
  };
}

function normalizeTask(record) {
  if (!record) {
    return null;
  }
  return {
    id: record.id,
    task_type: record.task_type,
    status: record.status,
    session_key: record.session_key,
    chat_type: record.chat_type,
    peer_id: record.peer_id,
    peer_name: record.peer_name,
    requester_sender_id: record.requester_sender_id,
    requester_sender_name: record.requester_sender_name,
    target_description: record.target_description,
    prompt: record.prompt,
    source_trace_id: record.source_trace_id,
    source_run_id: record.source_run_id,
    source_queue_message_ids: record.source_queue_message_ids || [],
    source_media_tags: record.source_media_tags || [],
    source_media_asset_ids: record.source_media_asset_ids || [],
    input_json: record.input_json || {},
    result_json: record.result_json || {},
    error_message: record.error_message,
    attempts: Number(record.attempts || 0),
    available_at: normalizeDate(record.available_at),
    claimed_by: record.claimed_by,
    claimed_at: normalizeDate(record.claimed_at),
    completed_at: normalizeDate(record.completed_at),
    created_at: normalizeDate(record.created_at),
    updated_at: normalizeDate(record.updated_at),
    artifacts: Array.isArray(record.artifacts) ? record.artifacts.map(normalizeArtifact).filter(Boolean) : []
  };
}

function createAgentTaskPersistence({ getPrismaClient, createSqlAdapter }) {
  function getClient(config) {
    return getPrismaClient(config);
  }

  async function ensureAgentTaskSchema(config = {}) {
    const sql = createSqlAdapter(config);
    try {
      await sql.query("SELECT pg_advisory_lock(hashtext('qqbot_agent_task_schema'))");
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS agent_tasks (
          id VARCHAR(64) PRIMARY KEY,
          task_type VARCHAR(64) NOT NULL,
          status VARCHAR(32) NOT NULL,
          session_key VARCHAR(191) NOT NULL,
          chat_type VARCHAR(16) NOT NULL,
          peer_id VARCHAR(191) NULL,
          peer_name VARCHAR(255) NULL,
          requester_sender_id VARCHAR(191) NULL,
          requester_sender_name VARCHAR(255) NULL,
          target_description TEXT NULL,
          prompt TEXT NOT NULL,
          source_trace_id VARCHAR(128) NULL,
          source_run_id VARCHAR(128) NULL,
          source_queue_message_ids JSONB NULL,
          source_media_tags JSONB NULL,
          source_media_asset_ids JSONB NULL,
          input_json JSONB NULL,
          result_json JSONB NULL,
          error_message TEXT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          available_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          claimed_by VARCHAR(128) NULL,
          claimed_at TIMESTAMP(3) NULL,
          completed_at TIMESTAMP(3) NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS agent_task_artifacts (
          id VARCHAR(64) PRIMARY KEY,
          task_id VARCHAR(64) NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
          kind VARCHAR(32) NOT NULL DEFAULT 'image',
          file_path TEXT NULL,
          public_path TEXT NULL,
          data_url TEXT NULL,
          mime_type VARCHAR(128) NULL,
          format VARCHAR(16) NULL,
          bytes INTEGER NULL,
          revised_prompt TEXT NULL,
          metadata JSONB NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_tasks_status_available ON agent_tasks (status, available_at ASC, id ASC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_tasks_session_created ON agent_tasks (session_key, created_at DESC, id DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_tasks_trace ON agent_tasks (source_trace_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_agent_task_artifacts_task_created ON agent_task_artifacts (task_id, created_at DESC)');
    } finally {
      await sql.query("SELECT pg_advisory_unlock(hashtext('qqbot_agent_task_schema'))").catch(() => undefined);
      await sql.close();
    }
  }

  async function createAgentTask(input, config = {}) {
    const prisma = getClient(config);
    const created = await prisma.agentTask.create({
      data: {
        id: normalizeOptionalString(input.id) || `task_${Date.now()}_${randomUUID().slice(0, 8)}`,
        task_type: normalizeOptionalString(input.taskType || input.task_type) || 'image_generate',
        status: normalizeOptionalString(input.status) || 'pending',
        session_key: normalizeOptionalString(input.sessionKey || input.session_key) || '',
        chat_type: normalizeOptionalString(input.chatType || input.chat_type) || 'group',
        peer_id: normalizeOptionalString(input.peerId || input.peer_id),
        peer_name: normalizeOptionalString(input.peerName || input.peer_name),
        requester_sender_id: normalizeOptionalString(input.requesterSenderId || input.requester_sender_id),
        requester_sender_name: normalizeOptionalString(input.requesterSenderName || input.requester_sender_name),
        target_description: normalizeOptionalString(input.targetDescription || input.target_description),
        prompt: typeof input.prompt === 'string' ? input.prompt : '',
        source_trace_id: normalizeOptionalString(input.sourceTraceId || input.source_trace_id),
        source_run_id: normalizeOptionalString(input.sourceRunId || input.source_run_id),
        source_queue_message_ids: normalizeJsonArray(input.sourceQueueMessageIds || input.source_queue_message_ids),
        source_media_tags: normalizeJsonArray(input.sourceMediaTags || input.source_media_tags),
        source_media_asset_ids: normalizeJsonArray(input.sourceMediaAssetIds || input.source_media_asset_ids),
        input_json: normalizeJsonObject(input.inputJson || input.input_json),
        available_at: input.availableAt || input.available_at || new Date()
      },
      include: { artifacts: { orderBy: [{ created_at: 'desc' }] } }
    });
    return normalizeTask(created);
  }

  async function claimNextAgentTask(workerId, config = {}) {
    const prisma = getClient(config);
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`
        SELECT id
        FROM agent_tasks
        WHERE status = 'pending'
          AND available_at <= NOW()
        ORDER BY available_at ASC, id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row || !row.id) {
        return null;
      }
      const updated = await tx.agentTask.update({
        where: { id: String(row.id) },
        data: {
          status: 'processing',
          claimed_by: normalizeOptionalString(workerId) || 'agent-task-worker',
          claimed_at: new Date(),
          attempts: { increment: 1 }
        },
        include: { artifacts: { orderBy: [{ created_at: 'desc' }] } }
      });
      return normalizeTask(updated);
    });
  }

  async function updateAgentTask(input, config = {}) {
    const prisma = getClient(config);
    const data = {};
    if (typeof input.status === 'string') {
      data.status = input.status;
    }
    if (typeof input.resultJson !== 'undefined' || typeof input.result_json !== 'undefined') {
      data.result_json = normalizeJsonObject(input.resultJson || input.result_json);
    }
    if (typeof input.errorMessage !== 'undefined' || typeof input.error_message !== 'undefined') {
      data.error_message = normalizeOptionalString(input.errorMessage || input.error_message);
    }
    if (input.completedAt || input.completed_at || input.status === 'completed' || input.status === 'failed') {
      data.completed_at = input.completedAt || input.completed_at || new Date();
    }
    const updated = await prisma.agentTask.update({
      where: { id: input.id },
      data,
      include: { artifacts: { orderBy: [{ created_at: 'desc' }] } }
    });
    return normalizeTask(updated);
  }

  async function addAgentTaskArtifacts(taskId, artifacts, config = {}) {
    if (!Array.isArray(artifacts) || artifacts.length === 0) {
      return [];
    }
    const prisma = getClient(config);
    await prisma.agentTaskArtifact.createMany({
      data: artifacts.map((artifact) => ({
        id: normalizeOptionalString(artifact.id) || `task_artifact_${Date.now()}_${randomUUID().slice(0, 8)}`,
        task_id: taskId,
        kind: normalizeOptionalString(artifact.kind) || 'image',
        file_path: normalizeOptionalString(artifact.filePath || artifact.file_path),
        public_path: normalizeOptionalString(artifact.publicPath || artifact.public_path),
        data_url: normalizeOptionalString(artifact.dataUrl || artifact.data_url),
        mime_type: normalizeOptionalString(artifact.mimeType || artifact.mime_type),
        format: normalizeOptionalString(artifact.format),
        bytes: normalizeInt(artifact.bytes),
        revised_prompt: normalizeOptionalString(artifact.revisedPrompt || artifact.revised_prompt),
        metadata: normalizeJsonObject(artifact.metadata)
      }))
    });
    const rows = await prisma.agentTaskArtifact.findMany({
      where: { task_id: taskId },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }]
    });
    return rows.map(normalizeArtifact).filter(Boolean);
  }

  async function getAgentTaskById(id, config = {}) {
    const prisma = getClient(config);
    const row = await prisma.agentTask.findUnique({
      where: { id },
      include: { artifacts: { orderBy: [{ created_at: 'desc' }, { id: 'desc' }] } }
    });
    return normalizeTask(row);
  }

  async function listAgentTasks(filters = {}, config = {}) {
    const prisma = getClient(config);
    const limit = Math.max(1, Math.min(100, Number.parseInt(String(filters.limit || 30), 10) || 30));
    const where = {};
    if (filters.sessionKey || filters.session_key) {
      where.session_key = String(filters.sessionKey || filters.session_key);
    }
    if (filters.status) {
      where.status = String(filters.status);
    }
    const rows = await prisma.agentTask.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit,
      include: { artifacts: { orderBy: [{ created_at: 'desc' }, { id: 'desc' }] } }
    });
    return rows.map(normalizeTask).filter(Boolean);
  }

  return {
    ensureAgentTaskSchema,
    createAgentTask,
    claimNextAgentTask,
    updateAgentTask,
    addAgentTaskArtifacts,
    getAgentTaskById,
    listAgentTasks
  };
}

module.exports = {
  createAgentTaskPersistence
};

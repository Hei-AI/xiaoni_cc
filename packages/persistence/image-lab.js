'use strict';

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
    run_id: record.run_id,
    kind: record.kind,
    file_path: record.file_path,
    public_path: record.public_path,
    mime_type: record.mime_type,
    format: record.format,
    bytes: record.bytes,
    width: record.width,
    height: record.height,
    revised_prompt: record.revised_prompt,
    metadata: record.metadata || {},
    created_at: normalizeDate(record.created_at)
  };
}

function normalizeRun(record) {
  if (!record) {
    return null;
  }
  return {
    id: record.id,
    operation: record.operation,
    status: record.status,
    parent_run_id: record.parent_run_id,
    prompt: record.prompt,
    provider: record.provider,
    model: record.model,
    size: record.size,
    quality: record.quality,
    format: record.format,
    input_json: record.input_json || {},
    result_json: record.result_json || {},
    error_message: record.error_message,
    started_at: normalizeDate(record.started_at),
    completed_at: normalizeDate(record.completed_at),
    created_at: normalizeDate(record.created_at),
    updated_at: normalizeDate(record.updated_at),
    artifacts: Array.isArray(record.artifacts) ? record.artifacts.map(normalizeArtifact).filter(Boolean) : []
  };
}

function createImageLabPersistence({ getPrismaClient, createSqlAdapter }) {
  function getClient(config) {
    return getPrismaClient(config);
  }

  async function ensureImageLabSchema(config = {}) {
    const sql = createSqlAdapter(config);
    try {
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS image_lab_runs (
          id VARCHAR(64) PRIMARY KEY,
          operation VARCHAR(32) NOT NULL,
          status VARCHAR(32) NOT NULL,
          parent_run_id VARCHAR(64) NULL,
          prompt TEXT NOT NULL,
          provider VARCHAR(64) NULL,
          model VARCHAR(128) NULL,
          size VARCHAR(32) NULL,
          quality VARCHAR(32) NULL,
          format VARCHAR(16) NULL,
          input_json JSONB NULL,
          result_json JSONB NULL,
          error_message TEXT NULL,
          started_at TIMESTAMP(3) NULL,
          completed_at TIMESTAMP(3) NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS image_lab_artifacts (
          id VARCHAR(64) PRIMARY KEY,
          run_id VARCHAR(64) NOT NULL REFERENCES image_lab_runs(id) ON DELETE CASCADE,
          kind VARCHAR(32) NOT NULL DEFAULT 'image',
          file_path TEXT NOT NULL,
          public_path TEXT NOT NULL,
          mime_type VARCHAR(128) NOT NULL,
          format VARCHAR(16) NULL,
          bytes INTEGER NULL,
          width INTEGER NULL,
          height INTEGER NULL,
          revised_prompt TEXT NULL,
          metadata JSONB NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_image_lab_runs_created ON image_lab_runs (created_at DESC, id DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_image_lab_runs_operation_created ON image_lab_runs (operation, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_image_lab_runs_status_created ON image_lab_runs (status, created_at DESC)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_image_lab_runs_parent ON image_lab_runs (parent_run_id)');
      await sql.execute('CREATE INDEX IF NOT EXISTS idx_image_lab_artifacts_run_created ON image_lab_artifacts (run_id, created_at DESC)');
    } finally {
      await sql.close();
    }
  }

  async function createImageLabRun(input, config = {}) {
    const prisma = getClient(config);
    const created = await prisma.imageLabRun.create({
      data: {
        id: input.id,
        operation: input.operation,
        status: input.status || 'pending',
        parent_run_id: normalizeOptionalString(input.parentRunId || input.parent_run_id),
        prompt: typeof input.prompt === 'string' ? input.prompt : '',
        provider: normalizeOptionalString(input.provider),
        model: normalizeOptionalString(input.model),
        size: normalizeOptionalString(input.size),
        quality: normalizeOptionalString(input.quality),
        format: normalizeOptionalString(input.format),
        input_json: normalizeJsonObject(input.inputJson || input.input_json),
        result_json: input.resultJson || input.result_json || null,
        error_message: normalizeOptionalString(input.errorMessage || input.error_message),
        started_at: input.startedAt || input.started_at || new Date(),
        completed_at: input.completedAt || input.completed_at || null
      },
      include: {
        artifacts: true
      }
    });
    return normalizeRun(created);
  }

  async function updateImageLabRun(input, config = {}) {
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
    if (input.completedAt || input.completed_at) {
      data.completed_at = input.completedAt || input.completed_at;
    }

    const updated = await prisma.imageLabRun.update({
      where: { id: input.id },
      data,
      include: {
        artifacts: true
      }
    });
    return normalizeRun(updated);
  }

  async function addImageLabArtifacts(runId, artifacts, config = {}) {
    if (!Array.isArray(artifacts) || artifacts.length === 0) {
      return [];
    }
    const prisma = getClient(config);
    await prisma.imageLabArtifact.createMany({
      data: artifacts.map((artifact) => ({
        id: artifact.id,
        run_id: runId,
        kind: normalizeOptionalString(artifact.kind) || 'image',
        file_path: artifact.filePath || artifact.file_path,
        public_path: artifact.publicPath || artifact.public_path,
        mime_type: artifact.mimeType || artifact.mime_type || 'image/png',
        format: normalizeOptionalString(artifact.format),
        bytes: normalizeInt(artifact.bytes),
        width: normalizeInt(artifact.width),
        height: normalizeInt(artifact.height),
        revised_prompt: normalizeOptionalString(artifact.revisedPrompt || artifact.revised_prompt),
        metadata: normalizeJsonObject(artifact.metadata)
      }))
    });
    const rows = await prisma.imageLabArtifact.findMany({
      where: { run_id: runId },
      orderBy: [
        { created_at: 'desc' },
        { id: 'desc' }
      ]
    });
    return rows.map(normalizeArtifact).filter(Boolean);
  }

  async function getImageLabRunById(id, config = {}) {
    const prisma = getClient(config);
    const run = await prisma.imageLabRun.findUnique({
      where: { id },
      include: {
        artifacts: {
          orderBy: [
            { created_at: 'desc' },
            { id: 'desc' }
          ]
        }
      }
    });
    return normalizeRun(run);
  }

  async function listImageLabRuns(filters = {}, config = {}) {
    const prisma = getClient(config);
    const limit = Math.max(1, Math.min(200, Number.parseInt(String(filters.limit || 50), 10) || 50));
    const where = {};
    if (typeof filters.operation === 'string' && filters.operation.trim()) {
      where.operation = filters.operation.trim();
    }
    if (typeof filters.status === 'string' && filters.status.trim()) {
      where.status = filters.status.trim();
    }
    const rows = await prisma.imageLabRun.findMany({
      where,
      orderBy: [
        { created_at: 'desc' },
        { id: 'desc' }
      ],
      take: limit,
      include: {
        artifacts: {
          orderBy: [
            { created_at: 'desc' },
            { id: 'desc' }
          ]
        }
      }
    });
    return rows.map(normalizeRun).filter(Boolean);
  }

  return {
    ensureImageLabSchema,
    createImageLabRun,
    updateImageLabRun,
    addImageLabArtifacts,
    getImageLabRunById,
    listImageLabRuns
  };
}

module.exports = {
  createImageLabPersistence
};

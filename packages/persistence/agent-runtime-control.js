'use strict';

function normalizeRuntimeControl(row) {
  return {
    identityKey: row?.identity_key || 'xiaoni',
    enabled: row ? row.enabled !== false : true,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

function createAgentRuntimeControlPersistence(deps) {
  const { createSqlAdapter } = deps;

  async function ensureAgentRuntimeControlSchemaWithSql(sql) {
    await sql.execute(`
      CREATE TABLE IF NOT EXISTS agent_runtime_control (
        identity_key VARCHAR(191) PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async function ensureAgentRuntimeControlSchema(config = {}) {
    const sql = createSqlAdapter(config);
    try {
      await ensureAgentRuntimeControlSchemaWithSql(sql);
    } finally {
      await sql.close();
    }
  }

  async function getAgentRuntimeControl(input = {}, config = {}) {
    const identityKey = typeof input.identityKey === 'string' && input.identityKey.trim()
      ? input.identityKey.trim()
      : 'xiaoni';
    const sql = createSqlAdapter(config);
    try {
      await ensureAgentRuntimeControlSchemaWithSql(sql);
      const rows = await sql.query(
        `
          SELECT identity_key, enabled, updated_at
          FROM agent_runtime_control
          WHERE identity_key = ?
          LIMIT 1
        `,
        [identityKey]
      );
      return normalizeRuntimeControl(rows[0] || { identity_key: identityKey, enabled: true, updated_at: null });
    } finally {
      await sql.close();
    }
  }

  async function updateAgentRuntimeControl(input = {}, config = {}) {
    const identityKey = typeof input.identityKey === 'string' && input.identityKey.trim()
      ? input.identityKey.trim()
      : 'xiaoni';
    const enabled = input.enabled !== false;
    const sql = createSqlAdapter(config);
    try {
      await ensureAgentRuntimeControlSchemaWithSql(sql);
      const rows = await sql.query(
        `
          INSERT INTO agent_runtime_control (identity_key, enabled, updated_at)
          VALUES (?, ?, NOW())
          ON CONFLICT (identity_key)
          DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()
          RETURNING identity_key, enabled, updated_at
        `,
        [identityKey, enabled]
      );
      return normalizeRuntimeControl(rows[0]);
    } finally {
      await sql.close();
    }
  }

  return {
    ensureAgentRuntimeControlSchema,
    getAgentRuntimeControl,
    updateAgentRuntimeControl
  };
}

module.exports = {
  createAgentRuntimeControlPersistence
};

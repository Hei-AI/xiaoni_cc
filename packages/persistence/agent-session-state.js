'use strict';

function createAgentSessionStatePersistence({ createSqlAdapter }) {
  async function ensureAgentSessionStateSchema(config = {}) {
    const sql = createSqlAdapter(config);
    try {
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS agent_session_state (
            id BIGSERIAL PRIMARY KEY,
            session_key VARCHAR(191) NOT NULL,
            dopamine VARCHAR(10) NOT NULL DEFAULT 'medium',
            stress VARCHAR(10) NOT NULL DEFAULT 'low',
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT uq_agent_session_state_key UNIQUE (session_key)
          )
        `
      );
      await sql.execute(
        'CREATE INDEX IF NOT EXISTS idx_agent_session_state_key ON agent_session_state (session_key)'
      );
    } finally {
      await sql.close();
    }
  }

  async function getAgentSessionState(sessionKey, config = {}) {
    const sql = createSqlAdapter(config);
    try {
      const rows = await sql.query(
        'SELECT dopamine, stress FROM agent_session_state WHERE session_key = ? LIMIT 1',
        [String(sessionKey || '')]
      );
      if (!rows[0]) {
        return null;
      }
      const dopamine = rows[0].dopamine === 'low' || rows[0].dopamine === 'high' ? rows[0].dopamine : 'medium';
      const stress = rows[0].stress === 'medium' || rows[0].stress === 'high' ? rows[0].stress : 'low';
      return { dopamine, stress };
    } finally {
      await sql.close();
    }
  }

  async function upsertAgentSessionState(input, config = {}) {
    const sql = createSqlAdapter(config);
    try {
      const sessionKey = String(input.sessionKey || '');
      const dopamine = input.dopamine === 'low' || input.dopamine === 'high' ? input.dopamine : 'medium';
      const stress = input.stress === 'medium' || input.stress === 'high' ? input.stress : 'low';
      await sql.execute(
        `
          INSERT INTO agent_session_state (session_key, dopamine, stress, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT (session_key)
          DO UPDATE SET dopamine = ?, stress = ?, updated_at = CURRENT_TIMESTAMP
        `,
        [sessionKey, dopamine, stress, dopamine, stress]
      );
    } finally {
      await sql.close();
    }
  }

  return {
    ensureAgentSessionStateSchema,
    getAgentSessionState,
    upsertAgentSessionState
  };
}

module.exports = { createAgentSessionStatePersistence };

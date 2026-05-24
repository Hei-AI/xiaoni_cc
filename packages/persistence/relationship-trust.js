'use strict';

function createRelationshipTrustPersistence({ createSqlAdapter }) {
  async function ensureRelationshipTrustSchema(config = {}) {
    const sql = createSqlAdapter(config);
    try {
      await sql.execute(
        `
          CREATE TABLE IF NOT EXISTS relationship_trust (
            id BIGSERIAL PRIMARY KEY,
            identity_key VARCHAR(191) NOT NULL,
            speaker_qq BIGINT NOT NULL,
            trust_score DOUBLE PRECISION NOT NULL DEFAULT 0,
            level VARCHAR(4) NOT NULL DEFAULT 'L1',
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT uq_relationship_trust_key_speaker UNIQUE (identity_key, speaker_qq)
          )
        `
      );
      await sql.execute(
        'CREATE INDEX IF NOT EXISTS idx_relationship_trust_key_speaker ON relationship_trust (identity_key, speaker_qq)'
      );
    } finally {
      await sql.close();
    }
  }

  async function getRelationshipTrustLevel(identityKey, speakerQq, config = {}) {
    const sql = createSqlAdapter(config);
    try {
      const rows = await sql.query(
        'SELECT level FROM relationship_trust WHERE identity_key = $1 AND speaker_qq = $2 LIMIT 1',
        [String(identityKey || ''), BigInt(Math.trunc(Number(speakerQq) || 0))]
      );
      const level = rows[0]?.level;
      if (level === 'L2' || level === 'L3' || level === 'L4') {
        return level;
      }
      return 'L1';
    } finally {
      await sql.close();
    }
  }

  async function upsertRelationshipTrust(input, config = {}) {
    const sql = createSqlAdapter(config);
    try {
      const identityKey = String(input.identityKey || '');
      const speakerQq = BigInt(Math.trunc(Number(input.speakerQq) || 0));
      const trustScore = Number.isFinite(Number(input.trustScore)) ? Number(input.trustScore) : 0;
      const level = input.level === 'L2' || input.level === 'L3' || input.level === 'L4'
        ? input.level
        : 'L1';
      await sql.execute(
        `
          INSERT INTO relationship_trust (identity_key, speaker_qq, trust_score, level, updated_at)
          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
          ON CONFLICT (identity_key, speaker_qq)
          DO UPDATE SET trust_score = $3, level = $4, updated_at = CURRENT_TIMESTAMP
        `,
        [identityKey, speakerQq, trustScore, level]
      );
    } finally {
      await sql.close();
    }
  }

  async function incrementRelationshipTrust(input, config = {}) {
    const sql = createSqlAdapter(config);
    try {
      const identityKey = String(input.identityKey || '');
      const speakerQq = BigInt(Math.trunc(Number(input.speakerQq) || 0));
      const delta = Number.isFinite(Number(input.delta)) && Number(input.delta) > 0 ? Number(input.delta) : 0;
      if (delta === 0) return;
      await sql.execute(
        `
          INSERT INTO relationship_trust (identity_key, speaker_qq, trust_score, level, updated_at)
          VALUES (?, ?, ?, 'L1', CURRENT_TIMESTAMP)
          ON CONFLICT (identity_key, speaker_qq)
          DO UPDATE SET
            trust_score = LEAST(10.0, relationship_trust.trust_score + ?),
            level = CASE
              WHEN LEAST(10.0, relationship_trust.trust_score + ?) >= 8 THEN 'L4'
              WHEN LEAST(10.0, relationship_trust.trust_score + ?) >= 5 THEN 'L3'
              WHEN LEAST(10.0, relationship_trust.trust_score + ?) >= 2 THEN 'L2'
              ELSE 'L1'
            END,
            updated_at = CURRENT_TIMESTAMP
        `,
        [identityKey, speakerQq, delta, delta, delta, delta, delta]
      );
    } finally {
      await sql.close();
    }
  }

  return {
    ensureRelationshipTrustSchema,
    getRelationshipTrustLevel,
    upsertRelationshipTrust,
    incrementRelationshipTrust
  };
}

module.exports = { createRelationshipTrustPersistence };

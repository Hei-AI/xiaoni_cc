const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentPresencePersistence } = require('../agent-presence');

function createPersistence(overrides = {}) {
  const statements = [];
  const prisma = overrides.prisma || {};
  const adapter = overrides.createSqlAdapter || (() => ({
    query: async (statement) => {
      statements.push(statement);
      return [];
    },
    execute: async (statement) => {
      statements.push(statement);
      return 0;
    },
    close: async () => undefined
  }));
  return {
    statements,
    persistence: createAgentPresencePersistence({
      getPrismaClient: () => prisma,
      createSqlAdapter: adapter
    })
  };
}

test('ensureAgentPresenceSchema keeps historical digital action table for archived records', async () => {
  const { statements, persistence } = createPersistence();

  await persistence.ensureAgentPresenceSchema();

  assert.ok(statements.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS agent_digital_actions')));
  assert.ok(statements.some((statement) => statement.includes('idx_agent_digital_actions_identity_created')));
  assert.ok(statements.some((statement) => statement.includes('idx_agent_digital_actions_status_created')));
  assert.ok(statements.some((statement) => statement.includes('idx_agent_digital_actions_surface_created')));
  assert.ok(statements.some((statement) => statement.includes('projection_json JSONB')));
  assert.ok(statements.some((statement) => statement.includes('reduced_through_event_id BIGINT')));
  assert.ok(statements.some((statement) => statement.includes('projection_version VARCHAR(64)')));
});

test('updateAgentLifeState writes projection cursor timestamps as instants', async () => {
  let updatePayload = null;
  const { persistence } = createPersistence({
    prisma: {
      agentSessionLifeState: {
        upsert: async (payload) => payload.create,
        update: async (payload) => {
          updatePayload = payload;
          return payload.data;
        }
      }
    }
  });

  await persistence.updateAgentLifeState('xiaoni', {
    reduced_through_event_id: 7794n,
    reduced_through_occurred_at: new Date('2026-06-10T15:08:01.161Z'),
    projection_updated_at: '2026-06-14T04:15:18.669+08:00'
  });

  assert.equal(updatePayload.data.reduced_through_occurred_at.toISOString(), '2026-06-10T15:08:01.161Z');
  assert.equal(updatePayload.data.projection_updated_at.toISOString(), '2026-06-13T20:15:18.669Z');
});

test('createAgentSharePoolItem writes real web search residue with source boundary', async () => {
  let createPayload = null;
  const { persistence } = createPersistence({
    prisma: {
      agentSharePoolItem: {
        create: async (payload) => {
          createPayload = payload;
          return {
            id: 12,
            created_at: new Date('2026-05-29T00:00:00.000Z'),
            ...payload.data
          };
        }
      }
    }
  });

  const row = await persistence.createAgentSharePoolItem({
    content: 'AI 检测更像风格雷达。',
    sourceKind: 'web_search',
    sourceWording: 'real_web_search',
    boundaryLabel: 'safe',
    metadata: { digital_action_id: 'digital_action_1' }
  });

  assert.equal(createPayload.data.source_kind, 'web_search');
  assert.equal(createPayload.data.source_wording, 'real_web_search');
  assert.equal(createPayload.data.boundary_label, 'safe');
  assert.equal(row.id, 12);
  assert.equal(row.sourceWording, 'real_web_search');
});

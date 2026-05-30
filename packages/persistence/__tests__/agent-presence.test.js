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

test('ensureAgentPresenceSchema creates digital action table and indexes', async () => {
  const { statements, persistence } = createPersistence();

  await persistence.ensureAgentPresenceSchema();

  assert.ok(statements.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS agent_digital_actions')));
  assert.ok(statements.some((statement) => statement.includes('idx_agent_digital_actions_identity_created')));
  assert.ok(statements.some((statement) => statement.includes('idx_agent_digital_actions_status_created')));
  assert.ok(statements.some((statement) => statement.includes('idx_agent_digital_actions_surface_created')));
});

test('createAgentDigitalAction normalizes autonomous web search action rows', async () => {
  let createPayload = null;
  const { persistence } = createPersistence({
    prisma: {
      agentDigitalAction: {
        create: async (payload) => {
          createPayload = payload;
          return {
            created_at: new Date('2026-05-29T00:00:00.000Z'),
            updated_at: new Date('2026-05-29T00:00:00.000Z'),
            completed_at: null,
            ...payload.data
          };
        }
      }
    }
  });

  const row = await persistence.createAgentDigitalAction({
    id: 'digital_action_1',
    actionType: 'web_search',
    surface: 'background',
    status: 'running',
    budgetSnapshot: { daily_count: 0 }
  });

  assert.equal(createPayload.data.identity_key, 'xiaoni');
  assert.equal(createPayload.data.action_type, 'web_search');
  assert.deepEqual(createPayload.data.budget_snapshot, { daily_count: 0 });
  assert.equal(row.id, 'digital_action_1');
  assert.equal(row.actionType, 'web_search');
  assert.deepEqual(row.sourceQueueIds, []);
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

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSelfEvolutionPersistence } = require('../self-evolution');

function buildPersistence(overrides = {}) {
  const calls = {
    createMany: [],
    updateMany: [],
    findMany: []
  };

  const prisma = {
    selfEvolutionJob: {
      create: async ({ data }) => ({
        id: 11n,
        ...data
      }),
      update: async ({ where, data }) => ({
        id: where.id,
        ...data
      }),
      findMany: async ({ where }) => {
        calls.findMany.push(where);
        return [];
      }
    },
    selfEvolutionState: {
      updateMany: async (payload) => {
        calls.updateMany.push(payload);
        return { count: 1 };
      },
      create: async ({ data }) => {
        calls.createMany.push(data);
        return {
          id: BigInt(calls.createMany.length),
          ...data
        };
      },
      findMany: async ({ where }) => {
        calls.findMany.push(where);
        return [];
      }
    },
    $transaction: async (fn) => fn(prisma)
  };

  return {
    calls,
    persistence: createSelfEvolutionPersistence({
      getPrismaClient: () => prisma,
      createSqlAdapter: overrides.createSqlAdapter || (() => ({
        execute: async () => 0,
        close: async () => undefined
      }))
    })
  };
}

test('createSelfEvolutionJob normalizes bigint ids and defaults', async () => {
  const { persistence } = buildPersistence();
  const row = await persistence.createSelfEvolutionJob({
    groupId: 253631878,
    targetUserId: 714457117,
    sessionKey: 'qq:group:253631878',
    inputMessageIds: [1001, 1002]
  });

  assert.equal(row.id, 11);
  assert.equal(row.group_id, 253631878);
  assert.equal(row.target_user_id, 714457117);
  assert.equal(row.session_key, 'qq:group:253631878');
});

test('replaceSelfEvolutionStates deactivates old scope and creates new versioned states', async () => {
  const { persistence, calls } = buildPersistence();
  const rows = await persistence.replaceSelfEvolutionStates({
    sessionKey: 'qq:group:253631878',
    groupId: 253631878,
    targetUserId: 714457117,
    scopeType: 'relation_self',
    version: 3,
    states: [
      {
        socialPresenceBaseline: 'light',
        entryPreference: 'cue_first',
        warmthBias: 'warm_light',
        familiarityCeiling: 'warm_not_performative',
        topicResonance: ['late_night_ping'],
        boundaryTendencies: { avoid_overexplaining: true },
        reinforcedModes: ['just_surfaced_relaxed'],
        suppressedModes: ['performative_explainer'],
        summaryText: '和 714457117 的深夜点名互动会让小腻更自然地短句露头。',
        sourceEventIds: [501],
        sourceMessageIds: [1001, 1002]
      }
    ]
  });

  assert.equal(calls.updateMany.length, 1);
  assert.equal(calls.createMany.length, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].scope_type, 'relation_self');
  assert.equal(rows[0].version, 3);
  assert.equal(rows[0].target_user_id, 714457117);
});

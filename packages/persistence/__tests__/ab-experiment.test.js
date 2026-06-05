const test = require('node:test');
const assert = require('node:assert/strict');
const { createAbExperimentPersistence } = require('../ab-experiment');

function createPersistence(overrides = {}) {
  const prisma = overrides.prisma || {};
  const statements = [];
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
    persistence: createAbExperimentPersistence({
      getPrismaClient: () => prisma,
      createSqlAdapter: adapter
    })
  };
}

test('ensureAbExperimentSchema creates AB tables and explicit indexes', async () => {
  const { statements, persistence } = createPersistence();

  await persistence.ensureAbExperimentSchema();

  assert.ok(statements.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS ab_turn_snapshots')));
  assert.ok(statements.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS ab_arm_runs')));
  assert.ok(statements.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS ab_memory_stream_items')));
  assert.ok(statements.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS ab_eval_results')));
  assert.ok(statements.some((statement) => statement.includes('uniq_ab_turn_snapshots_source_key')));
  assert.ok(statements.some((statement) => statement.includes('uniq_ab_arm_runs_snapshot_arm')));
  assert.ok(statements.some((statement) => statement.includes('idx_ab_memory_items_arm_namespace_type_status_updated')));
  assert.ok(statements.some((statement) => statement.includes('idx_ab_eval_results_label_created')));
});

test('createAbTurnSnapshot is idempotent by source_key and normalizes payload fields', async () => {
  let upsertPayload = null;
  const { persistence } = createPersistence({
    prisma: {
      abTurnSnapshot: {
        upsert: async (payload) => {
          upsertPayload = payload;
          return { created_at: new Date('2026-04-29T00:00:00Z'), updated_at: new Date('2026-04-29T00:00:00Z'), ...payload.create };
        }
      }
    }
  });

  const snapshot = await persistence.createAbTurnSnapshot({
    id: 'snap-1',
    sourceKey: 'queue:1',
    traceId: 'trace-1',
    queueMessageIds: ['q1'],
    providerEventIds: ['p1'],
    scene: { unread: 1 },
    memoryStreamView: { observations: [] },
    retrievalPolicy: { observations: 8 },
    runtimeConfig: { control: 'gpt-5.4' }
  });

  assert.deepEqual(upsertPayload.where, { source_key: 'queue:1' });
  assert.deepEqual(upsertPayload.update, {});
  assert.equal(upsertPayload.create.trace_id, 'trace-1');
  assert.deepEqual(upsertPayload.create.queue_message_ids, ['q1']);
  assert.equal(snapshot.id, 'snap-1');
  assert.deepEqual(snapshot.scene, { unread: 1 });
});

test('upsertAbArmRun writes one arm per snapshot and mirrors arm status best-effort', async () => {
  const calls = [];
  const { persistence } = createPersistence({
    prisma: {
      abArmRun: {
        upsert: async (payload) => {
          calls.push(['arm.upsert', payload]);
          return { created_at: new Date('2026-04-29T00:00:00Z'), updated_at: new Date('2026-04-29T00:00:00Z'), ...payload.create };
        }
      },
      abTurnSnapshot: {
        update: async (payload) => {
          calls.push(['snapshot.update', payload]);
          return payload.data;
        }
      }
    }
  });

  const armRun = await persistence.upsertAbArmRun({
    id: 'arm-1',
    snapshotId: 'snap-1',
    arm: 'treatment',
    status: 'completed',
    modelName: 'gpt-5.4-mini',
    outputArtifact: { action: 'silent_candidate' }
  });

  assert.deepEqual(calls[0][1].where, { snapshot_id_arm: { snapshot_id: 'snap-1', arm: 'treatment' } });
  assert.deepEqual(calls[1][1], { where: { id: 'snap-1' }, data: { treatment_status: 'completed' } });
  assert.equal(armRun.model_name, 'gpt-5.4-mini');
  assert.deepEqual(armRun.output_artifact, { action: 'silent_candidate' });
});

test('getAbExperimentTrace returns snapshot, arms, and latest eval without promotion fields', async () => {
  const { persistence } = createPersistence({
    prisma: {
      abTurnSnapshot: {
        findUnique: async () => ({
          id: 'snap-1',
          source_key: 'queue:1',
          queue_message_ids: [],
          provider_event_ids: [],
          scene: {},
          memory_stream_view: {},
          retrieval_policy: {},
          runtime_config: {},
          capture_status: 'created',
          control_status: 'completed',
          treatment_status: 'completed',
          eval_status: 'completed',
          created_at: new Date('2026-04-29T00:00:00Z'),
          updated_at: new Date('2026-04-29T00:00:00Z')
        })
      },
      abArmRun: {
        findMany: async () => [
          { id: 'control-1', snapshot_id: 'snap-1', arm: 'control', input_summary: {}, output_artifact: {}, memory_context: {}, status: 'completed' },
          { id: 'treatment-1', snapshot_id: 'snap-1', arm: 'treatment', input_summary: {}, output_artifact: {}, memory_context: {}, status: 'completed' }
        ]
      },
      abEvalResult: {
        findMany: async () => [
          { id: 'eval-1', snapshot_id: 'snap-1', label: 'tie', dimensions: {}, isolation_check: {}, created_at: new Date('2026-04-29T00:01:00Z') }
        ]
      }
    }
  });

  const trace = await persistence.getAbExperimentTrace('snap-1');

  assert.equal(trace.snapshot.id, 'snap-1');
  assert.equal(trace.control_arm_run.id, 'control-1');
  assert.equal(trace.treatment_arm_run.id, 'treatment-1');
  assert.equal(trace.latest_eval_result.label, 'tie');
  assert.equal(Object.prototype.hasOwnProperty.call(trace, 'promotion'), false);
});

test('listAbTurnSnapshots omits absent filters instead of passing null where clauses', async () => {
  let findManyPayload = null;
  const { persistence } = createPersistence({
    prisma: {
      abTurnSnapshot: {
        findMany: async (payload) => {
          findManyPayload = payload;
          return [];
        }
      }
    }
  });

  const snapshots = await persistence.listAbTurnSnapshots({ limit: 5 });

  assert.deepEqual(snapshots, []);
  assert.deepEqual(findManyPayload.where, {});
  assert.equal(findManyPayload.take, 5);
});

test('createAbEvalResult upserts fixture evals by deterministic id', async () => {
  let upsertPayload = null;
  const { persistence } = createPersistence({
    prisma: {
      abEvalResult: {
        upsert: async (payload) => {
          upsertPayload = payload;
          return { created_at: new Date('2026-04-29T00:00:00Z'), updated_at: new Date('2026-04-29T00:00:00Z'), ...payload.create };
        }
      },
      abTurnSnapshot: {
        update: async () => ({})
      }
    }
  });

  const result = await persistence.createAbEvalResult({
    snapshotId: 'snap-1',
    fixtureId: 'fixture-plan-needed',
    label: 'mini_better',
    dimensions: { continuity: 0.9 },
    isolationCheck: { production_mutation: false }
  });

  assert.match(upsertPayload.where.id, /^ab_eval_[a-f0-9]{40}$/);
  assert.equal(upsertPayload.create.id, upsertPayload.where.id);
  assert.equal(upsertPayload.create.fixture_id, 'fixture-plan-needed');
  assert.equal(upsertPayload.update.label, 'mini_better');
  assert.equal(result.id, upsertPayload.where.id);
});

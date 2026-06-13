'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentLifeEventPersistence } = require('../agent-life-events');

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
    persistence: createAgentLifeEventPersistence({
      getPrismaClient: () => prisma,
      createSqlAdapter: adapter
    })
  };
}

test('ensureAgentLifeEventSchema creates ledger table without implicit prompt visibility', async () => {
  const { statements, persistence } = createPersistence();

  await persistence.ensureAgentLifeEventSchema();

  const createTable = statements.find((statement) => statement.includes('CREATE TABLE IF NOT EXISTS agent_life_events')) || '';
  assert.match(createTable, /visibility VARCHAR\(32\) NOT NULL/);
  assert.doesNotMatch(createTable, /visibility VARCHAR\(32\) NOT NULL DEFAULT 'self_private'/);
  assert.ok(statements.some((statement) => statement.includes('idx_agent_life_events_identity_time')));
  assert.ok(statements.some((statement) => statement.includes('idx_agent_life_events_identity_time_id')));
  assert.ok(statements.some((statement) => statement.includes('idx_agent_life_events_session_time')));
  assert.ok(statements.some((statement) => statement.includes('idx_agent_life_events_kind_time')));
});

test('recordAgentLifeEvent requires explicit visibility and normalizes bigint ids', async () => {
  let createPayload = null;
  const { persistence } = createPersistence({
    prisma: {
      agentLifeEvent: {
        create: async (payload) => {
          createPayload = payload;
          return {
            id: 123n,
            created_at: new Date('2026-05-30T00:00:00.000Z'),
            ...payload.data
          };
        }
      }
    }
  });

  await assert.rejects(() => persistence.recordAgentLifeEvent({
    eventKind: 'qq_message_seen',
    dedupeKey: 'seen:1'
  }), /visibility is required/);

  const event = await persistence.recordAgentLifeEvent({
    eventKind: 'qq_message_seen',
    visibility: 'active_surface',
    sessionKey: 'qq:group:1',
    queueMessageId: 42,
    messageSid: 'sid-1',
    payload: { body_for_agent: '@小腻 hi' },
    dedupeKey: 'seen:1'
  });

  assert.equal(createPayload.data.visibility, 'active_surface');
  assert.equal(createPayload.data.queue_message_id, 42n);
  assert.equal(event.id, '123');
  assert.equal(event.queueMessageId, '42');
  assert.deepEqual(event.payload, { body_for_agent: '@小腻 hi' });
});

test('recordAgentLifeEvent returns existing row on duplicate dedupe key', async () => {
  const { persistence } = createPersistence({
    prisma: {
      agentLifeEvent: {
        create: async () => {
          const error = new Error('duplicate');
          error.code = 'P2002';
          throw error;
        },
        findUnique: async (payload) => ({
          id: 7n,
          identity_key: 'xiaoni',
          event_kind: 'surface_visit',
          occurred_at: new Date('2026-05-30T00:00:00.000Z'),
          surface: 'qq',
          chat_type: 'group',
          session_key: 'qq:group:1',
          visibility: 'active_surface',
          payload: { restored: true },
          dedupe_key: payload.where.dedupe_key,
          created_at: new Date('2026-05-30T00:00:00.000Z')
        })
      }
    }
  });

  const event = await persistence.recordAgentLifeEvent({
    eventKind: 'surface_visit',
    visibility: 'active_surface',
    dedupeKey: 'surface:1'
  });

  assert.equal(event.id, '7');
  assert.equal(event.dedupeKey, 'surface:1');
  assert.deepEqual(event.payload, { restored: true });
});

test('recordAgentLifeEvent accepts homeostasis projection event kinds', async () => {
  const createdKinds = [];
  const { persistence } = createPersistence({
    prisma: {
      agentLifeEvent: {
        create: async (payload) => {
          createdKinds.push(payload.data.event_kind);
          return {
            id: BigInt(createdKinds.length),
            identity_key: 'xiaoni',
            occurred_at: new Date('2026-05-31T00:00:00.000Z'),
            created_at: new Date('2026-05-31T00:00:00.000Z'),
            ...payload.data
          };
        }
      }
    }
  });

  for (const eventKind of [
    'presence_tick_evaluated',
    'no_visible_delivery_observed',
    'visible_delivery_committed',
    'post_commit_side_effect_blocked',
    'rest_period',
    'sleep_period'
  ]) {
    const event = await persistence.recordAgentLifeEvent({
      eventKind,
      visibility: 'self_private',
      payload: { test: true },
      dedupeKey: `${eventKind}:1`
    });
    assert.equal(event.eventKind, eventKind);
  }

  assert.deepEqual(createdKinds, [
    'presence_tick_evaluated',
    'no_visible_delivery_observed',
    'visible_delivery_committed',
    'post_commit_side_effect_blocked',
    'rest_period',
    'sleep_period'
  ]);
});

test('listAgentLifeEvents can read oldest-first batches for projection replay', async () => {
  let findPayload = null;
  const { persistence } = createPersistence({
    prisma: {
      agentLifeEvent: {
        findMany: async (payload) => {
          findPayload = payload;
          return [{
            id: 1n,
            identity_key: 'xiaoni',
            event_kind: 'qq_message_seen',
            occurred_at: new Date('2026-05-31T00:00:00.000Z'),
            visibility: 'self_private',
            payload: {},
            dedupe_key: 'seen:1',
            created_at: new Date('2026-05-31T00:00:00.000Z')
          }];
        }
      }
    }
  });

  const rows = await persistence.listAgentLifeEvents({
    identityKey: 'xiaoni',
    chronological: true,
    limit: 10
  });

  assert.deepEqual(findPayload.orderBy, [{ occurred_at: 'asc' }, { id: 'asc' }]);
  assert.equal(rows[0].id, '1');
  assert.equal(rows[0].occurredAt, '2026-05-31T00:00:00.000+08:00');
});

test('getActiveAgentRecoveryWindow returns the unexpired recover_energy window', async () => {
  let findPayload = null;
  const { persistence } = createPersistence({
    prisma: {
      agentLifeEvent: {
        findMany: async (payload) => {
          findPayload = payload;
          return [{
            id: 9n,
            identity_key: 'xiaoni',
            event_kind: 'sleep_period',
            occurred_at: new Date('2026-06-06T12:34:51.000Z'),
            visibility: 'self_private',
            payload: {
              reason: '先休息一下',
              duration_ms: 5 * 60 * 1000
            },
            trace_id: 'trace-rest',
            run_id: 'run-rest',
            dedupe_key: 'sleep:1',
            created_at: new Date('2026-06-06T12:34:51.000Z')
          }];
        }
      }
    }
  });

  const activeWindow = await persistence.getActiveAgentRecoveryWindow({
    identityKey: 'xiaoni',
    now: new Date('2026-06-06T12:36:51.000+08:00')
  });

  assert.deepEqual(findPayload.where, {
    identity_key: 'xiaoni',
    event_kind: { in: ['rest_period', 'sleep_period'] }
  });
  assert.equal(activeWindow.eventId, '9');
  assert.equal(activeWindow.eventKind, 'sleep_period');
  assert.equal(activeWindow.occurredAt, '2026-06-06T12:34:51.000+08:00');
  assert.equal(activeWindow.recoverUntil, '2026-06-06T12:39:51.000+08:00');
  assert.equal(activeWindow.remainingMs, 3 * 60 * 1000);
  assert.equal(activeWindow.reason, '先休息一下');
  assert.equal(activeWindow.traceId, 'trace-rest');
});

test('getActiveAgentRecoveryWindow ignores expired recovery events', async () => {
  const { persistence } = createPersistence({
    prisma: {
      agentLifeEvent: {
        findMany: async () => [{
          id: 10n,
          identity_key: 'xiaoni',
          event_kind: 'sleep_period',
          occurred_at: new Date('2026-06-06T12:34:51.000Z'),
          visibility: 'self_private',
          payload: { duration_minutes: 5 },
          dedupe_key: 'sleep:expired',
          created_at: new Date('2026-06-06T12:34:51.000Z')
        }]
      }
    }
  });

  const activeWindow = await persistence.getActiveAgentRecoveryWindow({
    now: new Date('2026-06-06T12:40:00.000+08:00')
  });

  assert.equal(activeWindow, null);
});

test('getLatestAgentRecoveryWindow returns expired window and continuation status', async () => {
  let queueLookupPayload = null;
  const { persistence } = createPersistence({
    prisma: {
      agentLifeEvent: {
        findMany: async () => [{
          id: 11n,
          identity_key: 'xiaoni',
          event_kind: 'sleep_period',
          occurred_at: new Date('2026-06-06T12:34:51.000Z'),
          visibility: 'self_private',
          payload: {
            reason: '睡五分钟',
            duration_minutes: 5
          },
          trace_id: 'trace-sleep',
          run_id: 'run-sleep',
          dedupe_key: 'sleep:latest',
          created_at: new Date('2026-06-06T12:34:51.000Z')
        }]
      },
      agentQueueMessage: {
        findUnique: async (payload) => {
          queueLookupPayload = payload;
          return null;
        }
      }
    }
  });

  const latestWindow = await persistence.getLatestAgentRecoveryWindow({
    now: new Date('2026-06-06T12:40:00.000+08:00')
  });

  assert.equal(latestWindow.eventId, '11');
  assert.equal(latestWindow.active, false);
  assert.equal(latestWindow.remainingMs, 0);
  assert.equal(latestWindow.recoverUntil, '2026-06-06T12:39:51.000+08:00');
  assert.equal(latestWindow.continuationDedupeKey, 'self_continuation:recovery:11');
  assert.equal(latestWindow.continuationQueued, false);
  assert.deepEqual(queueLookupPayload.where, {
    dedupe_key: 'self_continuation:recovery:11'
  });
});

test('getLatestAgentRecoveryWindow marks existing continuation queue', async () => {
  const { persistence } = createPersistence({
    prisma: {
      agentLifeEvent: {
        findMany: async () => [{
          id: 12n,
          identity_key: 'xiaoni',
          event_kind: 'sleep_period',
          occurred_at: new Date('2026-06-06T12:34:51.000Z'),
          visibility: 'self_private',
          payload: { duration_ms: 300000 },
          dedupe_key: 'sleep:queued',
          created_at: new Date('2026-06-06T12:34:51.000Z')
        }]
      },
      agentQueueMessage: {
        findUnique: async () => ({ id: 99n, status: 'settled' })
      }
    }
  });

  const latestWindow = await persistence.getLatestAgentRecoveryWindow({
    now: new Date('2026-06-06T12:40:00.000+08:00')
  });

  assert.equal(latestWindow.continuationQueued, true);
});

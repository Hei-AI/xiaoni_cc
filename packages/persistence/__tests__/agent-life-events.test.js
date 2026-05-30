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

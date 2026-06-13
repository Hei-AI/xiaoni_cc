'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentRuntimeControlPersistence } = require('../agent-runtime-control');

function createPersistence(overrides = {}) {
  const statements = [];
  const queries = [];
  const rows = overrides.rows || [];
  const adapter = overrides.createSqlAdapter || (() => ({
    execute: async (statement) => {
      statements.push(statement);
      return 0;
    },
    query: async (statement, params) => {
      queries.push({ statement, params });
      return rows.shift() || [];
    },
    close: async () => undefined
  }));
  return {
    statements,
    queries,
    persistence: createAgentRuntimeControlPersistence({
      createSqlAdapter: adapter
    })
  };
}

test('ensureAgentRuntimeControlSchema creates an enabled-by-default control table', async () => {
  const { statements, persistence } = createPersistence();

  await persistence.ensureAgentRuntimeControlSchema();

  const createTable = statements.join('\n');
  assert.match(createTable, /CREATE TABLE IF NOT EXISTS agent_runtime_control/);
  assert.match(createTable, /enabled BOOLEAN NOT NULL DEFAULT TRUE/);
});

test('getAgentRuntimeControl defaults Xiaoni to enabled when no row exists', async () => {
  const { persistence } = createPersistence({ rows: [[]] });

  const control = await persistence.getAgentRuntimeControl({ identityKey: 'xiaoni' });

  assert.deepEqual(control, {
    identityKey: 'xiaoni',
    enabled: true,
    updatedAt: null
  });
});

test('getAgentRuntimeControl reuses one SQL adapter for schema ensure and read', async () => {
  let created = 0;
  let closed = 0;
  const { persistence } = createPersistence({
    rows: [[]],
    createSqlAdapter: () => {
      created += 1;
      return {
        execute: async () => 0,
        query: async () => [],
        close: async () => {
          closed += 1;
        }
      };
    }
  });

  await persistence.getAgentRuntimeControl({ identityKey: 'xiaoni' });

  assert.equal(created, 1);
  assert.equal(closed, 1);
});

test('updateAgentRuntimeControl persists disabled state', async () => {
  const updatedAt = new Date('2026-06-06T12:00:00.000Z');
  const { queries, persistence } = createPersistence({
    rows: [[{
      identity_key: 'xiaoni',
      enabled: false,
      updated_at: updatedAt
    }]]
  });

  const control = await persistence.updateAgentRuntimeControl({
    identityKey: 'xiaoni',
    enabled: false
  });

  const updateQuery = queries.at(-1);
  assert.match(updateQuery.statement, /INSERT INTO agent_runtime_control/);
  assert.deepEqual(updateQuery.params, ['xiaoni', false]);
  assert.deepEqual(control, {
    identityKey: 'xiaoni',
    enabled: false,
    updatedAt: updatedAt.toISOString()
  });
});

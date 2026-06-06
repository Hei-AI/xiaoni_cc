const test = require('node:test');
const assert = require('node:assert/strict');
const { createXiaoniReplayEventPersistence } = require('../xiaoni-replay-events');

function createPersistence() {
  const calls = [];
  const persistence = createXiaoniReplayEventPersistence({
    createSqlAdapter: () => ({
      execute: async (statement) => {
        calls.push({ kind: 'execute', statement });
      },
      query: async (statement, params) => {
        calls.push({ kind: 'query', statement, params });
        if (statement.includes('UPDATE xiaoni_replay_events')) {
          return [{ id: '1' }, { id: '2' }];
        }
        return [];
      },
      close: async () => {
        calls.push({ kind: 'close' });
      }
    })
  });
  return { persistence, calls };
}

test('attachConversationIdToXiaoniReplayEventsByTrace ignores invalid input without touching the database', async () => {
  const { persistence, calls } = createPersistence();

  const count = await persistence.attachConversationIdToXiaoniReplayEventsByTrace({
    traceId: '',
    conversationId: 'not-a-number'
  });

  assert.equal(count, 0);
  assert.equal(calls.length, 0);
});

test('attachConversationIdToXiaoniReplayEventsByTrace fills replay conversation ids by trace inside persistence', async () => {
  const { persistence, calls } = createPersistence();

  const count = await persistence.attachConversationIdToXiaoniReplayEventsByTrace({
    traceId: 'trace-1',
    conversationId: '42'
  });

  assert.equal(count, 2);
  const update = calls.find((call) => call.kind === 'query' && call.statement.includes('UPDATE xiaoni_replay_events'));
  assert.ok(update);
  assert.match(update.statement, /SET conversation_id = \?/);
  assert.match(update.statement, /conversation_id IS NULL/);
  assert.doesNotMatch(update.statement, /updated_at/i);
  assert.deepEqual(update.params, [42n, 'trace-1']);
});

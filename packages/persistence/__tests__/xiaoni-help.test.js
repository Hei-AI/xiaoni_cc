'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createXiaoniHelpPersistence } = require('../xiaoni-help');

function harness() {
  let row = null;
  const api = createXiaoniHelpPersistence({ getPrismaClient: () => ({ agentTask: {
    upsert: async ({ create }) => { row ??= { ...create, attempts: 0, updated_at: 1 }; },
    findUnique: async ({ where }) => row?.id === where.id ? structuredClone(row) : null,
    updateMany: async ({ where, data }) => {
      if (!row || Object.entries(where).some(([key, value]) =>
        value && typeof value === 'object' && value.in ? !value.in.includes(row[key]) : row[key] !== value
      )) return { count: 0 };
      row = { ...row, ...data, attempts: row.attempts + (data.attempts?.increment || 0), updated_at: row.updated_at + 1 };
      return { count: 1 };
    }
  } }) });
  return { api, row: () => row };
}
const input = { callId: 'first', request: 'convert file', context: 'input.txt', runId: 'r', traceId: 't' };

test('parallel claims allow only one execution and preserve the same help id', async () => {
  const { api } = harness();
  const claims = await Promise.all([api.beginXiaoniHelp(input), api.beginXiaoniHelp(input)]);
  assert.equal(claims.filter(c => c.ok).length, 1);
  assert.equal(claims[0].task.id, claims[1].task.id);
});

test('retries retain attempts and history; duplicate call ids cannot consume another attempt', async () => {
  const { api, row } = harness();
  const first = await api.beginXiaoniHelp(input);
  assert.equal(await api.finishXiaoniHelp({ helpId: first.task.id, claim: first.claim, callId: 'first', request: input.request,
    status: 'help_answered', helperAttempt: true, result: { text: 'try this' } }), true);
  const duplicate = await api.beginXiaoniHelp(input);
  assert.equal(duplicate.reason, 'already_processed');
  const second = await api.beginXiaoniHelp({ ...input, callId: 'second', helpId: first.task.id });
  assert.equal(second.ok, true);
  assert.equal(second.task.attempts, 1);
  assert.equal(second.history.length, 1);
  assert.equal(row().status, 'help_running');
});

test('an uncertain human delivery and a stale lease cannot resend or overwrite', async () => {
  const { api } = harness();
  const first = await api.beginXiaoniHelp(input);
  assert.equal(await api.markXiaoniHelpSending({ helpId: first.task.id, claim: first.claim }), true);
  assert.equal((await api.beginXiaoniHelp({ ...input, callId: 'second', helpId: first.task.id })).reason, 'help_human_sending');
  assert.equal(await api.finishXiaoniHelp({ helpId: first.task.id, claim: 'wrong', status: 'help_answered' }), false);
});

test('unknown help ids do not create a replacement task', async () => {
  const { api, row } = harness();
  assert.equal((await api.beginXiaoniHelp({ ...input, helpId: 'missing' })).reason, 'help_not_found');
  assert.equal(row(), null);
});

test('attempts are recorded before work and process replacement requires human review', async () => {
  const { api, row } = harness();
  const first = await api.beginXiaoniHelp(input);
  assert.equal(await api.startXiaoniHelpAttempt({ helpId: first.task.id, claim: first.claim }), true);
  assert.equal(row().attempts, 1);
  row().claimed_by = 'previous-runtime:claim';
  const resumed = await api.beginXiaoniHelp({ ...input, callId: 'after-restart', helpId: first.task.id });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.interrupted, true);
  assert.equal(resumed.task.attempts, 1);
});

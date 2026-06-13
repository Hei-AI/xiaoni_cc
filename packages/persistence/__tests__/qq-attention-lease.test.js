'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createQqAttentionLeasePersistence } = require('../qq-attention-lease');

function createFakePrisma() {
  const inboundRows = new Map();
  const leases = new Map();
  const reminders = new Map();
  let nextReminderId = 1n;

  return {
    inboundRows,
    leases,
    reminders,
    prisma: {
      agentInboundMessage: {
        findUnique: async ({ where }) => inboundRows.get(String(where.id)) || null,
        count: async ({ where }) => {
          let count = 0;
          for (const row of inboundRows.values()) {
            if (row.session_key !== where.session_key) continue;
            if (Number(row.is_read) !== Number(where.is_read)) continue;
            if (where.was_mentioned !== undefined && Number(row.was_mentioned) !== Number(where.was_mentioned)) continue;
            if (where.id?.gt !== undefined && row.id <= where.id.gt) continue;
            count += 1;
          }
          return count;
        }
      },
      agentQqAttentionLease: {
        findUnique: async ({ where }) => leases.get(where.identity_key_surface_session_key.session_key) || null,
        upsert: async ({ where, create, update }) => {
          const key = where.identity_key_surface_session_key.session_key;
          const row = { id: leases.get(key)?.id || 1n, ...(leases.has(key) ? update : create) };
          leases.set(key, row);
          return row;
        },
        updateMany: async ({ where, data }) => {
          let count = 0;
          for (const [key, row] of leases.entries()) {
            if (where.session_key && row.session_key !== where.session_key) continue;
            leases.set(key, {
              ...row,
              ...data,
              reminder_count: data.reminder_count?.increment
                ? Number(row.reminder_count || 0) + data.reminder_count.increment
                : (data.reminder_count ?? row.reminder_count)
            });
            count += 1;
          }
          return { count };
        }
      },
      agentQqAttentionReminder: {
        create: async ({ data }) => {
          if (reminders.has(data.dedupe_key)) {
            const error = new Error('duplicate');
            error.code = 'P2002';
            throw error;
          }
          const row = { id: nextReminderId, ...data };
          nextReminderId += 1n;
          reminders.set(data.dedupe_key, row);
          return row;
        },
        findUnique: async ({ where }) => reminders.get(where.dedupe_key) || null,
        update: async ({ where, data }) => {
          for (const [key, row] of reminders.entries()) {
            if (row.id === where.id) {
              const updated = { ...row, ...data };
              reminders.set(key, updated);
              return updated;
            }
          }
          return null;
        }
      }
    }
  };
}

test('maybeCreateQqAttentionReminder creates bodyless system reminder from active lease', async () => {
  const fake = createFakePrisma();
  const persistence = createQqAttentionLeasePersistence({
    getPrismaClient: () => fake.prisma,
    createSqlAdapter: () => {
      throw new Error('SQL should not be used');
    }
  });
  fake.inboundRows.set('100', {
    id: 100n,
    trace_id: 'trace-100',
    message_sid: 'msg-100',
    chat_type: 'group',
    session_key: 'qq:group:42',
    peer_id: '42',
    peer_name: 'Test Group',
    sender_id: '20001',
    sender_name: 'Alice',
    account_id: '1129974489',
    is_read: 0,
    received_at: new Date('2026-06-13T00:02:00.000Z'),
    message_timestamp: null,
    was_mentioned: 0
  });
  fake.leases.set('qq:group:42', {
    id: 1n,
    identity_key: 'xiaoni',
    surface: 'qq',
    session_key: 'qq:group:42',
    status: 'active',
    score: 1,
    score_updated_at: new Date('2026-06-13T00:00:00.000Z'),
    half_life_seconds: 480,
    last_seen_inbound_id: 99n,
    last_reminder_inbound_id: null,
    last_reminder_at: null,
    reminder_count: 0,
    expires_at: new Date('2026-06-13T00:30:00.000Z'),
    closed_at: null
  });

  const result = await persistence.maybeCreateQqAttentionReminder({
    inboundMessageId: 100,
    now: new Date('2026-06-13T00:02:00.000Z')
  });

  assert.equal(result.shouldEnqueue, true);
  assert.equal(result.message.source, 'system_reminder');
  assert.equal(result.message.systemReminder.reason, 'attention_lease');
  assert.match(result.message.bodyForAgent, /unread_delta=1/);
  assert.match(result.message.bodyForAgent, /focus_group 42/);
  assert.doesNotMatch(result.message.bodyForAgent, /Alice/);
  assert.equal(result.message.rawPayload.kind, 'attention_lease_reminder');
});

test('maybeCreateQqAttentionReminder suppresses expired or disabled leases', async () => {
  const fake = createFakePrisma();
  const persistence = createQqAttentionLeasePersistence({
    getPrismaClient: () => fake.prisma,
    createSqlAdapter: () => {
      throw new Error('SQL should not be used');
    }
  });
  fake.inboundRows.set('100', {
    id: 100n,
    chat_type: 'group',
    session_key: 'qq:group:42',
    peer_id: '42',
    account_id: '1129974489',
    is_read: 0,
    received_at: new Date('2026-06-13T00:02:00.000Z'),
    was_mentioned: 0
  });

  const disabled = await persistence.maybeCreateQqAttentionReminder({
    inboundMessageId: 100,
    policyState: { isEnabled: false }
  });
  assert.equal(disabled.shouldEnqueue, false);
  assert.equal(disabled.reason, 'disabled_policy');

  fake.leases.set('qq:group:42', {
    id: 1n,
    identity_key: 'xiaoni',
    surface: 'qq',
    session_key: 'qq:group:42',
    status: 'active',
    score: 1,
    score_updated_at: new Date('2026-06-13T00:00:00.000Z'),
    half_life_seconds: 480,
    last_seen_inbound_id: 99n,
    last_reminder_inbound_id: null,
    last_reminder_at: null,
    reminder_count: 0,
    expires_at: new Date('2026-06-13T00:01:00.000Z'),
    closed_at: null
  });
  const expired = await persistence.maybeCreateQqAttentionReminder({
    inboundMessageId: 100,
    now: new Date('2026-06-13T00:02:00.000Z')
  });
  assert.equal(expired.shouldEnqueue, false);
  assert.equal(expired.reason, 'lease_expired');
});

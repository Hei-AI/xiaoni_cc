import test from 'node:test';
import assert from 'node:assert/strict';
import { InboundInboxService } from '../inbound-inbox-service';

test('finalizeSimulationContext fills session and message defaults for direct chat', async () => {
  const service = new InboundInboxService();
  const context = service.finalizeSimulationContext(
    {
      ChatType: 'direct',
      AccountId: '1129974489',
      SenderId: '85178516',
      NativeChannelId: '85178516',
      Body: '测试 inbox',
      BodyForAgent: '测试 inbox',
      RawBody: '测试 inbox',
      CommandBody: '测试 inbox',
      BodyForCommands: '测试 inbox',
    },
    '1129974489',
    'sim_fixed'
  );

  assert.equal(context.SessionKey, 'qq:direct:1129974489:85178516');
  assert.equal(context.MessageSid, 'sim_fixed');
  assert.equal(context.To, 'user:85178516');
  assert.equal(context.From, 'qq:85178516');
  assert.equal(context.Provider, 'qq');
  assert.equal(context.Surface, 'simulator');
  assert.equal(context.CommandAuthorized, false);
  await service.close();
});

test('finalizeSimulationContext preserves supplied group session data', async () => {
  const service = new InboundInboxService();
  const context = service.finalizeSimulationContext(
    {
      ChatType: 'group',
      AccountId: '1129974489',
      SenderId: '85178516',
      NativeChannelId: '1019235326',
      SessionKey: 'qq:group:1019235326',
      To: 'group:1019235326',
      From: 'qq:group:1019235326',
      Body: '@小腻 测试',
      BodyForAgent: '@小腻 测试',
      RawBody: '@小腻 测试',
      CommandBody: '测试',
      BodyForCommands: '测试',
      WasMentioned: true,
    },
    '1129974489',
    'sim_group'
  );

  assert.equal(context.SessionKey, 'qq:group:1019235326');
  assert.equal(context.MessageSid, 'sim_group');
  assert.equal(context.NativeChannelId, '1019235326');
  assert.equal(context.WasMentioned, true);
  await service.close();
});

test('claimMessages supports latest unread window for proactive IM opens', async () => {
  const service = new InboundInboxService() as any;
  const queries: string[] = [];
  const row = (id: number, timestamp: string) => ({
    id,
    trace_id: `trace-${id}`,
    source: 'napcat',
    message_sid: `sid-${id}`,
    dedupe_key: `dedupe-${id}`,
    chat_type: 'group',
    session_key: 'qq:group:1040740258',
    peer_id: '1040740258',
    peer_name: '群 1040740258',
    sender_id: '100',
    sender_name: 'tester',
    account_id: '1129974489',
    is_read: 1,
    read_at: '2026-05-31T01:00:00.000+08:00',
    received_at: timestamp,
    message_timestamp: timestamp,
    body_for_agent: `message ${id}`,
    raw_body: `message ${id}`,
    command_body: `message ${id}`,
    was_mentioned: 0,
    reply_to_id: null,
    reply_to_body: null,
    reply_to_sender: null,
    raw_payload: {},
    inbound_context: {}
  });
  const tx = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes('SELECT id')) {
        return [{ id: 3 }, { id: 2 }];
      }
      return [
        row(2, '2026-05-31T00:59:00.000+08:00'),
        row(3, '2026-05-31T01:00:00.000+08:00')
      ];
    },
    execute: async () => undefined
  };
  service.db = {
    withTransaction: async (fn: (inner: typeof tx) => Promise<unknown>) => fn(tx),
    close: async () => undefined
  };

  const claimed = await service.claimMessages({
    sessionKey: 'qq:group:1040740258',
    limit: 2,
    order: 'latest'
  });

  assert.match(queries[0], /ORDER BY received_at DESC, id DESC/);
  assert.deepEqual(claimed.map((message: any) => message.messageSid), ['sid-2', 'sid-3']);
});

test('claimMessages can include a trigger row without marking read before enqueue succeeds', async () => {
  const service = new InboundInboxService() as any;
  const queries: string[] = [];
  let executeCalls = 0;
  const row = (id: number, timestamp: string) => ({
    id,
    trace_id: `trace-${id}`,
    source: 'napcat',
    message_sid: `sid-${id}`,
    dedupe_key: `dedupe-${id}`,
    chat_type: 'group',
    session_key: 'qq:group:1040740258',
    peer_id: '1040740258',
    peer_name: '群 1040740258',
    sender_id: '100',
    sender_name: 'tester',
    account_id: '1129974489',
    is_read: 0,
    read_at: null,
    received_at: timestamp,
    message_timestamp: timestamp,
    body_for_agent: `message ${id}`,
    raw_body: `message ${id}`,
    command_body: `message ${id}`,
    was_mentioned: id === 9 ? 1 : 0,
    reply_to_id: null,
    reply_to_body: null,
    reply_to_sender: null,
    raw_payload: {},
    inbound_context: {}
  });
  const tx = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes('SELECT id') && sql.includes('id IN')) {
        return [{ id: 9 }];
      }
      if (sql.includes('SELECT id')) {
        return [{ id: 1 }];
      }
      return [
        row(1, '2026-05-31T00:58:00.000+08:00'),
        row(9, '2026-05-31T01:00:00.000+08:00')
      ];
    },
    execute: async () => { executeCalls += 1; }
  };
  service.db = {
    withTransaction: async (fn: (inner: typeof tx) => Promise<unknown>) => fn(tx),
    close: async () => undefined
  };

  const claimed = await service.claimMessages({
    sessionKey: 'qq:group:1040740258',
    limit: 1,
    includeMessageIds: [9],
    markRead: false
  });

  assert.equal(executeCalls, 0);
  assert.equal(queries.some((sql) => sql.includes('id IN')), true);
  assert.deepEqual(claimed.map((message: any) => message.messageSid), ['sid-1', 'sid-9']);
});

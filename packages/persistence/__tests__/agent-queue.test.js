'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentQueuePersistence } = require('../agent-queue');

function createQueueRow(overrides = {}) {
  return {
    id: overrides.id || 1,
    trace_id: overrides.trace_id || 'trace-original',
    batch_id: null,
    run_id: null,
    source: overrides.source || 'phone_notification',
    message_sid: overrides.message_sid || `sid-${overrides.id || 1}`,
    chat_type: overrides.chat_type || 'group',
    session_key: overrides.session_key || 'qq:group:100',
    peer_id: overrides.peer_id || '100',
    peer_name: overrides.peer_name || 'Test Group',
    sender_id: overrides.sender_id || 'qq',
    sender_name: overrides.sender_name || 'QQ',
    account_id: overrides.account_id || '1129974489',
    body_for_agent: overrides.body_for_agent || '群里有 1 条新消息。',
    raw_payload: overrides.raw_payload || '{}',
    inbound_context: overrides.inbound_context || JSON.stringify({
      BodyForAgent: overrides.body_for_agent || '群里有 1 条新消息。',
      CommandAuthorized: false,
      Surface: 'phone_notification'
    }),
    status: 'pending',
    attempts: overrides.attempts || 0,
    max_attempts: overrides.max_attempts || 3,
    created_at: overrides.created_at || '2026-06-09T00:00:00.000Z',
    processing_started_at: null,
    completed_at: null,
    conversation_id: null,
    error_message: null,
    payload: overrides.payload || JSON.stringify({
      messageId: overrides.messageId || overrides.id || 1,
      rawBody: overrides.rawBody || overrides.body_for_agent || '群里有 1 条新消息。',
      commandBody: '',
      wasMentioned: overrides.wasMentioned || false,
      wakesXiaoni: overrides.wakesXiaoni === true,
      receivedAt: overrides.receivedAt || '2026-06-09T00:00:00.000Z',
      phoneNotification: {
        app: 'qq',
        notificationId: overrides.message_sid || `sid-${overrides.id || 1}`,
        sessionKey: overrides.session_key || 'qq:group:100',
        chatType: 'group',
        peerId: overrides.peer_id || '100',
        unreadDelta: overrides.unreadDelta || 1,
        directMentions: overrides.directMentions || 0
      }
    })
  };
}

test('claimNextAgentQueueMessage batches pending messages for one session', async () => {
  const inserts = [];
  const executes = [];
  const rows = [
    createQueueRow({ id: 10, message_sid: 'sid-10', body_for_agent: '第一条', unreadDelta: 1 }),
    createQueueRow({ id: 11, message_sid: 'sid-11', body_for_agent: '第二条', unreadDelta: 2, directMentions: 1, wakesXiaoni: true })
  ];
  const tx = {
    query: async (sql, params = []) => {
      if (sql.includes('FOR UPDATE SKIP LOCKED')) {
        assert.deepEqual(params, []);
        return rows;
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    insert: async (sql, params = []) => {
      inserts.push({ sql, params });
      return { insertId: 1, affectedRows: 1 };
    },
    execute: async (sql, params = []) => {
      executes.push({ sql, params });
      return 2;
    }
  };
  const persistence = createAgentQueuePersistence({
    getPrismaClient: () => {
      throw new Error('Prisma should not be used for claim');
    },
    createSqlAdapter: () => ({
      withTransaction: async (callback) => callback(tx),
      close: async () => undefined
    })
  });

  const claimed = await persistence.claimNextAgentQueueMessage({ workerId: 'worker-1' });

  assert.ok(claimed);
  assert.equal(claimed.status, 'processing');
  assert.equal(claimed.queueMessageIds.length, 2);
  assert.equal(claimed.maxAttempts, 3);
  assert.equal(claimed.payload.messages.length, 2);
  assert.match(claimed.batchId, /^batch_/);
  assert.match(claimed.id, /^run_/);
  assert.match(claimed.traceId, /^runtrace_/);
  assert.equal(claimed.payload.bodyForAgent, '#1 QQ: 第一条\n#2 QQ: 第二条');
  assert.equal(claimed.payload.phoneNotification.unreadDelta, 3);
  assert.equal(claimed.payload.phoneNotification.directMentions, 1);
  assert.equal(claimed.payload.messages[0].rawPayload.phoneNotification.notificationId, 'sid-10');
  assert.equal(claimed.payload.messages[1].rawPayload.phoneNotification.notificationId, 'sid-11');
  assert.equal(inserts.length, 4);
  assert.equal(executes.length, 1);
  assert.ok(executes[0].sql.includes('UPDATE agent_queue_messages'));
  assert.ok(executes[0].sql.includes("status = 'consumed'"));
  assert.ok(executes[0].sql.includes('result = ?::jsonb'));
  assert.equal(executes[0].params[0], 'worker-1');
  const consumedResult = JSON.parse(executes[0].params[4]);
  assert.equal(consumedResult.doorbell_consumed, true);
  assert.equal(consumedResult.worker_id, 'worker-1');
  assert.equal(typeof consumedResult.consumed_at, 'string');
  assert.deepEqual(executes[0].params.slice(-2), [10, 11]);
});

test('claimNextAgentQueueMessage drains all currently due pending bucket messages', async () => {
  const rows = [
    // 私聊门铃能开窗;窗一开,同批 pending 的 system_reminder 一起折进来。
    createQueueRow({ id: 10, source: 'phone_notification', message_sid: 'sid-10', chat_type: 'direct', session_key: 'qq:direct:200', peer_id: '200', wakesXiaoni: true }),
    createQueueRow({
      id: 11,
      source: 'system_reminder',
      message_sid: 'sid-11',
      body_for_agent: '余光提醒',
      payload: JSON.stringify({
        messageId: 11,
        rawBody: '余光提醒',
        commandBody: '',
        receivedAt: '2026-06-09T00:00:00.000Z',
        systemReminder: {
          reminder: '余光提醒',
          reason: 'attention_lease',
          createdAt: '2026-06-09T00:00:00.000Z'
        }
      })
    })
  ];
  const executes = [];
  const tx = {
    query: async (sql, params = []) => {
      if (sql.includes('FOR UPDATE SKIP LOCKED')) {
        assert.deepEqual(params, []);
        return rows;
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    insert: async () => ({ insertId: 1, affectedRows: 1 }),
    execute: async (sql, params = []) => {
      executes.push({ sql, params });
      return 2;
    }
  };
  const persistence = createAgentQueuePersistence({
    getPrismaClient: () => {
      throw new Error('Prisma should not be used for claim');
    },
    createSqlAdapter: () => ({
      withTransaction: async (callback) => callback(tx),
      close: async () => undefined
    })
  });

  const claimed = await persistence.claimNextAgentQueueMessage({ workerId: 'worker-1' });

  assert.ok(claimed);
  assert.deepEqual(claimed.queueMessageIds, [10, 11]);
  assert.equal(claimed.payload.messages.length, 2);
  assert.deepEqual(claimed.payload.messages.map((message) => message.source), ['phone_notification', 'system_reminder']);
  assert.equal(claimed.payload.messages[0].rawPayload.phoneNotification.notificationId, 'sid-10');
  assert.equal(claimed.payload.messages[1].rawPayload.systemReminder.reason, 'attention_lease');
  assert.equal(claimed.payload.source, 'system_reminder');
  assert.equal(claimed.payload.systemReminder.reason, 'attention_lease');
  assert.deepEqual(executes[0].params.slice(-2), [10, 11]);
});

test('foldPendingNotifyMessagesIntoRun folds pending notify into the parent run without minting a run/batch', async () => {
  const inserts = [];
  const executes = [];
  const rows = [
    createQueueRow({
      id: 42,
      source: 'system_reminder',
      message_sid: 'sid-fork-42',
      trace_id: 'runtrace_fork_own',
      body_for_agent: '潜意识念头'
    })
  ];
  const tx = {
    query: async (sql, params = []) => {
      if (sql.includes('FOR UPDATE SKIP LOCKED')) {
        assert.deepEqual(params, []);
        return rows;
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    insert: async (sql, params = []) => {
      inserts.push({ sql, params });
      return { insertId: 1, affectedRows: 1 };
    },
    execute: async (sql, params = []) => {
      executes.push({ sql, params });
      return 1;
    }
  };
  const persistence = createAgentQueuePersistence({
    getPrismaClient: () => {
      throw new Error('Prisma should not be used for fold');
    },
    createSqlAdapter: () => ({
      withTransaction: async (callback) => callback(tx),
      close: async () => undefined
    })
  });

  const folded = await persistence.foldPendingNotifyMessagesIntoRun({
    parentRunId: 'run_parent_123',
    parentBatchId: 'batch_parent_123',
    workerId: 'worker-7'
  });

  assert.ok(folded);
  // No agent_runs / agent_message_batches row minted — only the queue UPDATE runs.
  assert.equal(inserts.length, 0, 'fold must NOT insert agent_runs/agent_message_batches');
  assert.equal(executes.length, 1);
  // Keyed to the PARENT run/batch so settle/fail/retry (WHERE run_id = ?) cover it.
  assert.equal(folded.id, 'run_parent_123');
  assert.equal(folded.batchId, 'batch_parent_123');
  // Folded message keeps its OWN trace lineage for archival.
  assert.equal(folded.traceId, 'runtrace_fork_own');
  assert.deepEqual(folded.queueMessageIds, [42]);
  assert.ok(executes[0].sql.includes('UPDATE agent_queue_messages'));
  assert.ok(executes[0].sql.includes("status = 'consumed'"));
  assert.ok(executes[0].sql.includes('run_id = ?'));
  assert.equal(executes[0].params[0], 'worker-7');
  assert.equal(executes[0].params[1], 'batch_parent_123');
  assert.equal(executes[0].params[2], 'run_parent_123');
  const foldResult = JSON.parse(executes[0].params[3]);
  assert.equal(foldResult.folded_nonblocking_notify, true);
  assert.equal(foldResult.parent_run_id, 'run_parent_123');
  assert.deepEqual(executes[0].params.slice(-1), [42]);
});

test('foldPendingNotifyMessagesIntoRun returns null when nothing is pending', async () => {
  const tx = {
    query: async () => [],
    insert: async () => {
      throw new Error('insert should not run with no pending rows');
    },
    execute: async () => {
      throw new Error('execute should not run with no pending rows');
    }
  };
  const persistence = createAgentQueuePersistence({
    getPrismaClient: () => {
      throw new Error('Prisma should not be used for fold');
    },
    createSqlAdapter: () => ({
      withTransaction: async (callback) => callback(tx),
      close: async () => undefined
    })
  });

  const folded = await persistence.foldPendingNotifyMessagesIntoRun({
    parentRunId: 'run_parent_123',
    parentBatchId: 'batch_parent_123',
    workerId: 'worker-7'
  });

  assert.equal(folded, null);
});

test('foldPendingNotifyMessagesIntoRun requires parentRunId and parentBatchId', async () => {
  const persistence = createAgentQueuePersistence({
    getPrismaClient: () => undefined,
    createSqlAdapter: () => ({
      withTransaction: async (callback) => callback({}),
      close: async () => undefined
    })
  });
  await assert.rejects(
    () => persistence.foldPendingNotifyMessagesIntoRun({ workerId: 'worker-7' }),
    /requires parentRunId and parentBatchId/
  );
});

test('retryAgentQueueMessage returns a consumed run to pending without resetting attempts', async () => {
  const executes = [];
  const persistence = createAgentQueuePersistence({
    getPrismaClient: () => {
      throw new Error('Prisma should not be used for retry');
    },
    createSqlAdapter: () => ({
      execute: async (sql, params = []) => {
        executes.push({ sql, params });
        return 1;
      },
      close: async () => undefined
    })
  });

  const updated = await persistence.retryAgentQueueMessage({
    runId: 'run-transient',
    errorMessage: 'fetch failed',
    retryDelayMs: 5000
  });

  assert.equal(updated, 1);
  assert.equal(executes.length, 1);
  assert.match(executes[0].sql, /SET status = 'pending'/);
  assert.match(executes[0].sql, /attempts < max_attempts/);
  assert.match(executes[0].sql, /locked_at = NULL/);
  assert.match(executes[0].sql, /run_id = NULL/);
  assert.equal(executes[0].params[0], 5000);
  assert.equal(executes[0].params[1], 'fetch failed');
  assert.equal(executes[0].params[3], 'run-transient');
  const result = JSON.parse(executes[0].params[2]);
  assert.equal(result.doorbell_retry_pending, true);
  assert.equal(result.failed_run_id, 'run-transient');
  assert.equal(result.retry_after_ms, 5000);
  assert.equal(result.error_message, 'fetch failed');
});

// 醒来那一帧冲掉睡前残留的被动召回投递(dedupe_key recall-surface:*);入队口不做睡眠判断(入队≠消费)。
test('flushPendingRecallSurfaceQueueMessages settles pending recall-surface rows only', async () => {
  const executes = [];
  const persistence = createAgentQueuePersistence({
    getPrismaClient: () => {
      throw new Error('Prisma should not be used for flush');
    },
    createSqlAdapter: () => ({
      execute: async (sql, params = []) => {
        executes.push({ sql, params });
        return 3;
      },
      close: async () => undefined
    })
  });
  const flushed = await persistence.flushPendingRecallSurfaceQueueMessages({ recoverySessionId: 435 });
  assert.deepEqual(flushed, { flushedCount: 3 });
  assert.equal(executes.length, 1);
  assert.match(executes[0].sql, /SET status = 'settled'/);
  assert.match(executes[0].sql, /WHERE status = 'pending'/);
  assert.match(executes[0].sql, /dedupe_key LIKE \?/);
  assert.equal(executes[0].params[1], 'recall-surface:%');
  const result = JSON.parse(executes[0].params[0]);
  assert.equal(result.flushed_on_wake, true);
  assert.equal(result.recovery_session_id, 435);
});


// ── 开窗纪律 + latest-wins 槽（docs/NOTIFY_BUCKET_LATEST_WINS_COLLAPSE.md）──────────────────

function createRecallRow(overrides = {}) {
  return {
    ...createQueueRow({
      source: 'system_reminder',
      body_for_agent: '一句召回',
      payload: JSON.stringify({
        messageId: overrides.id || 1,
        rawBody: '一句召回',
        commandBody: '',
        receivedAt: '2026-06-09T00:00:00.000Z',
        systemReminder: { reminder: '一句召回', reason: 'passive_recall_surface' }
      }),
      ...overrides
    }),
    dedupe_key: overrides.dedupe_key || 'recall-surface:diary:abc'
  };
}

function createClaimHarness(rows) {
  const executes = [];
  const inserts = [];
  const tx = {
    query: async (sql) => {
      if (sql.includes('FOR UPDATE SKIP LOCKED')) {
        return rows;
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    insert: async (sql, params = []) => {
      inserts.push({ sql, params });
      return { insertId: 1, affectedRows: 1 };
    },
    execute: async (sql, params = []) => {
      executes.push({ sql, params });
      return rows.length;
    }
  };
  const persistence = createAgentQueuePersistence({
    getPrismaClient: () => {
      throw new Error('Prisma should not be used for claim');
    },
    createSqlAdapter: () => ({
      withTransaction: async (callback) => callback(tx),
      close: async () => undefined
    })
  });
  return { persistence, executes, inserts };
}

test('claimNextAgentQueueMessage drains every pending row regardless of wakesXiaoni (awake side has no gate)', async () => {
  const rows = [
    createRecallRow({ id: 20 }),
    createRecallRow({ id: 22, dedupe_key: 'external-notify:image:1' }),
    createQueueRow({ id: 23, chat_type: 'direct', session_key: 'qq:direct:200', peer_id: '200', dedupe_key: 'lw:phone_notification:direct:qq:direct:200:200', wakesXiaoni: true })
  ];
  const { persistence, executes } = createClaimHarness(rows);
  const claimed = await persistence.claimNextAgentQueueMessage({ workerId: 'worker-1' });
  assert.ok(claimed);
  assert.deepEqual(claimed.queueMessageIds, [20, 22, 23]);
  assert.equal(executes.length, 1);
  // latest-wins 槽在消费时轮换成历史唯一值(后缀带行 id),普通键不动
  assert.ok(executes[0].sql.includes("dedupe_key LIKE 'lw:%'"));
  assert.ok(executes[0].sql.includes("dedupe_key || ':run:' || ? || ':' || id"));
  assert.equal(executes[0].params[5], claimed.id);
});

test('claimNextAgentQueueMessage drains recall-only pending rows too', async () => {
  const rows = [createRecallRow({ id: 20 }), createRecallRow({ id: 24, dedupe_key: 'open-loops-pointer:s:1' })];
  const { persistence, executes } = createClaimHarness(rows);
  const claimed = await persistence.claimNextAgentQueueMessage({ workerId: 'worker-1' });
  assert.ok(claimed);
  assert.deepEqual(claimed.queueMessageIds, [20, 24]);
  assert.equal(executes.length, 1);
});

test('foldPendingNotifyMessagesIntoRun rotates latest-wins keys on consume', async () => {
  const rows = [createQueueRow({ id: 30, chat_type: 'direct', dedupe_key: 'lw:phone_notification:direct:qq:direct:200:200' })];
  const executes = [];
  const tx = {
    query: async (sql) => (sql.includes('FOR UPDATE SKIP LOCKED') ? rows : []),
    insert: async () => ({ insertId: 1, affectedRows: 1 }),
    execute: async (sql, params = []) => {
      executes.push({ sql, params });
      return 1;
    }
  };
  const persistence = createAgentQueuePersistence({
    getPrismaClient: () => undefined,
    createSqlAdapter: () => ({ withTransaction: async (callback) => callback(tx), close: async () => undefined })
  });
  const folded = await persistence.foldPendingNotifyMessagesIntoRun({ workerId: 'w', parentRunId: 'run_parent', parentBatchId: 'batch_parent' });
  assert.ok(folded);
  assert.ok(executes[0].sql.includes("dedupe_key || ':run:' || ? || ':' || id"));
  assert.equal(executes[0].params[4], 'run_parent');
});

test('enqueueAgentQueueMessage latest-wins: slot consumed between findUnique and updateMany → re-INSERT, never drop', async () => {
  let createCalls = 0;
  const prisma = {
    agentQueueMessage: {
      create: async (args) => {
        createCalls += 1;
        if (createCalls === 1) { const e = new Error('unique'); e.code = 'P2002'; throw e; }
        return { id: 99, ...args.data };
      },
      findUnique: async () => ({ id: 40, dedupe_key: 'lw:phone_notification:direct:s:p', status: 'pending', payload: {}, raw_payload: {}, available_at: new Date() }),
      updateMany: async () => ({ count: 0 })
    }
  };
  const persistence = createAgentQueuePersistence({ getPrismaClient: () => prisma, createSqlAdapter: () => undefined });
  const result = await persistence.enqueueAgentQueueMessage({
    message: { traceId: 't', source: 'phone_notification', messageSid: 'x', dedupeKey: 'lw:phone_notification:direct:s:p', chatType: 'direct', sessionKey: 's', peerId: 'p', senderId: 'a', accountId: '1', bodyForAgent: 'b' },
    payload: {}
  });
  assert.equal(createCalls, 2);
  assert.equal(result.created, true);
  assert.equal(result.queueId, 99);
});

test('enqueueAgentQueueMessage latest-wins: slot rotated before findUnique (null) → re-INSERT', async () => {
  let createCalls = 0;
  const prisma = {
    agentQueueMessage: {
      create: async (args) => {
        createCalls += 1;
        if (createCalls === 1) { const e = new Error('unique'); e.code = 'P2002'; throw e; }
        return { id: 100, ...args.data };
      },
      findUnique: async () => null,
      updateMany: async () => { throw new Error('must not be called'); }
    }
  };
  const persistence = createAgentQueuePersistence({ getPrismaClient: () => prisma, createSqlAdapter: () => undefined });
  const result = await persistence.enqueueAgentQueueMessage({
    message: { traceId: 't', source: 'system_reminder', messageSid: 'x', dedupeKey: 'lw:subconscious-agent:s', chatType: 'direct', sessionKey: 's', peerId: 'p', senderId: 'a', accountId: '1', bodyForAgent: 'b' },
    payload: {}
  });
  assert.equal(createCalls, 2);
  assert.equal(result.created, true);
});

test('enqueueAgentQueueMessage latest-wins: group @ merge accumulates directMentions and stays window-opening', async () => {
  const calls = [];
  const existing = {
    id: 41, dedupe_key: 'lw:phone_notification:group_mention:qq:group:100:100:20001', status: 'pending', available_at: new Date(),
    raw_payload: { unread_delta: 1, direct_mentions: 1 },
    payload: { messageId: 1, wakesXiaoni: true, phoneNotification: { app: 'qq', chatType: 'group', unreadDelta: 1, directMentions: 1 } }
  };
  const persistence = createAgentQueuePersistence({ getPrismaClient: () => createEnqueuePrisma(existing, calls), createSqlAdapter: () => undefined });
  await persistence.enqueueAgentQueueMessage({
    message: { traceId: 't', source: 'phone_notification', messageSid: 'y', dedupeKey: existing.dedupe_key, chatType: 'group', sessionKey: 'qq:group:100', peerId: '100', senderId: 'qq', accountId: '1', bodyForAgent: '@小腻 又一条', rawPayload: { unread_delta: 1, direct_mentions: 1 } },
    payload: { messageId: 2, wakesXiaoni: true, phoneNotification: { app: 'qq', chatType: 'group', unreadDelta: 1, directMentions: 1 } }
  });
  // 合并后仍带睡觉唤醒属性(睡眠侧按它累计),directMentions 累加
  assert.equal(calls[0].data.payload.wakesXiaoni, true);
  assert.equal(calls[0].data.payload.phoneNotification.directMentions, 2);
  assert.equal(calls[0].data.raw_payload.direct_mentions, 2);
});

function createEnqueuePrisma(existingRow, calls) {
  return {
    agentQueueMessage: {
      create: async () => {
        const error = new Error('unique');
        error.code = 'P2002';
        throw error;
      },
      findUnique: async () => existingRow,
      updateMany: async (args) => {
        calls.push(args);
        return { count: 1 };
      }
    }
  };
}

test('enqueueAgentQueueMessage latest-wins: pending lw: slot is overwritten in place, unread accumulates', async () => {
  const calls = [];
  const existing = {
    id: 40,
    trace_id: 'trace-old',
    dedupe_key: 'lw:phone_notification:direct:qq:direct:200:200',
    status: 'pending',
    attempts: 1,
    available_at: new Date('2026-06-09T00:00:05.000Z'),
    sender_id: 'qq',
    raw_payload: { unread_delta: 1, direct_mentions: 0, latest_preview: '旧' },
    payload: { messageId: 1, phoneNotification: { app: 'qq', unreadDelta: 1, directMentions: 0, notificationId: 'old' } }
  };
  const persistence = createAgentQueuePersistence({
    getPrismaClient: () => createEnqueuePrisma(existing, calls),
    createSqlAdapter: () => undefined
  });
  const result = await persistence.enqueueAgentQueueMessage({
    message: {
      traceId: 'trace-new',
      source: 'phone_notification',
      messageSid: 'phone:new',
      dedupeKey: 'lw:phone_notification:direct:qq:direct:200:200',
      chatType: 'direct',
      sessionKey: 'qq:direct:200',
      peerId: '200',
      senderId: 'qq',
      accountId: '1',
      bodyForAgent: '新的一条',
      rawPayload: { unread_delta: 1, direct_mentions: 0, latest_preview: '新' }
    },
    payload: { messageId: 2, phoneNotification: { app: 'qq', unreadDelta: 1, directMentions: 0, notificationId: 'new' } },
    availableAt: new Date('2026-06-09T00:00:09.000Z')
  });
  assert.equal(result.created, false);
  assert.equal(result.superseded, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].where, { id: 40, status: 'pending' });
  assert.equal(calls[0].data.body_for_agent, '新的一条');
  assert.equal(calls[0].data.trace_id, 'trace-new');
  assert.equal(calls[0].data.attempts, 0);
  assert.equal(calls[0].data.payload.phoneNotification.unreadDelta, 2);
  assert.equal(calls[0].data.payload.phoneNotification.notificationId, 'new');
  assert.equal(calls[0].data.raw_payload.unread_delta, 2);
  assert.equal(calls[0].data.raw_payload.latest_preview, '新');
  // 已有行更早可用 → 不往后推
  assert.equal(calls[0].data.available_at.toISOString(), '2026-06-09T00:00:05.000Z');
});

test('enqueueAgentQueueMessage keeps first-wins for non-lw keys and for consumed lw rows', async () => {
  for (const existing of [
    { id: 41, dedupe_key: 'recall-surface:diary:abc', status: 'pending', payload: {}, raw_payload: {} },
    { id: 42, dedupe_key: 'lw:phone_notification:direct:qq:direct:200:200', status: 'consumed', payload: {}, raw_payload: {} }
  ]) {
    const calls = [];
    const persistence = createAgentQueuePersistence({
      getPrismaClient: () => createEnqueuePrisma(existing, calls),
      createSqlAdapter: () => undefined
    });
    const result = await persistence.enqueueAgentQueueMessage({
      message: { traceId: 't', source: 'system_reminder', messageSid: 'x', dedupeKey: existing.dedupe_key, chatType: 'direct', sessionKey: 's', peerId: 'p', senderId: 'a', accountId: '1', bodyForAgent: 'b' },
      payload: {}
    });
    assert.equal(result.created, false);
    assert.equal(result.superseded, undefined);
    assert.equal(calls.length, 0, existing.dedupe_key);
  }
});

'use strict';

// 被动浮现投递闸的管理端控制位(agent_runtime_control 两列)。
//
// 为什么单独一份文件而不是加进 agent-runtime-control.test.js:那份的 11 条 deep-equal
// 快照在 main 上就已经是红的(投影每加一个字段就 stale 一次,没人补),再往里加会看不出
// 是新写的挂了还是旧的挂着。这里只锁本次要保证的性质。
//
// 要锁的就一条:**关得掉**。这是第一个会主动发东西给小腻的召回通道,开关必须能从管理端
// 落到库里,而且默认是关的。

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentRuntimeControlPersistence } = require('../agent-runtime-control');

function createPersistence(rows = []) {
  const statements = [];
  const queries = [];
  const queue = rows.slice();
  return {
    statements,
    queries,
    persistence: createAgentRuntimeControlPersistence({
      createSqlAdapter: () => ({
        execute: async (statement) => { statements.push(statement); return 0; },
        query: async (statement, params) => { queries.push({ statement, params }); return queue.shift() || []; },
        close: async () => undefined
      })
    })
  };
}

test('schema 自愈:两列带默认值(FALSE / 25 兜底),老库靠 ADD COLUMN IF NOT EXISTS 补上', async () => {
  const { statements, persistence } = createPersistence();
  await persistence.ensureAgentRuntimeControlSchema();
  const ddl = statements.join('\n');
  assert.match(ddl, /passive_recall_delivery_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(ddl, /passive_recall_delivery_daily_cap INTEGER NOT NULL DEFAULT 25/);
  assert.match(ddl, /ADD COLUMN IF NOT EXISTS passive_recall_delivery_enabled/);
  assert.match(ddl, /ADD COLUMN IF NOT EXISTS passive_recall_delivery_daily_cap/);
});

test('没有行 → 投递默认关着(不给一个「忘了关」的世界线)', async () => {
  const { persistence } = createPersistence([[]]);
  const control = await persistence.getAgentRuntimeControl({ identityKey: 'xiaoni' });
  assert.equal(control.passiveRecallDeliveryEnabled, false);
  assert.equal(control.passiveRecallDeliveryDailyCap, 25);
});

test('读库:两列被投影出来', async () => {
  const { persistence } = createPersistence([[{
    identity_key: 'xiaoni',
    enabled: true,
    passive_recall_delivery_enabled: true,
    passive_recall_delivery_daily_cap: 20
  }]]);
  const control = await persistence.getAgentRuntimeControl({ identityKey: 'xiaoni' });
  assert.equal(control.passiveRecallDeliveryEnabled, true);
  assert.equal(control.passiveRecallDeliveryDailyCap, 20);
});

test('写库:开关与日额都进 SQL,且日额 0 是合法值(等同关闭)', async () => {
  const { queries, persistence } = createPersistence([[{
    identity_key: 'xiaoni',
    enabled: true,
    passive_recall_delivery_enabled: true,
    passive_recall_delivery_daily_cap: 0
  }]]);
  const control = await persistence.updateAgentRuntimeControl({
    identityKey: 'xiaoni',
    passiveRecallDeliveryEnabled: true,
    passiveRecallDeliveryDailyCap: 0
  });
  const { statement, params } = queries[queries.length - 1];
  assert.match(statement, /passive_recall_delivery_enabled = CASE/);
  assert.match(statement, /passive_recall_delivery_daily_cap = CASE/);
  // 「这次有没有给这个字段」的 has 位必须是 true,否则 CASE 会走 ELSE 保持原值。
  assert.ok(params.includes(true), 'hasPassiveRecallDeliveryEnabled 应为 true');
  assert.equal(control.passiveRecallDeliveryDailyCap, 0, '0 不能被当成「没给」而退回默认值');
});

test('没提到这两个字段的 patch 不会把它们冲掉(CASE 走 ELSE 保持原值)', async () => {
  const { queries, persistence } = createPersistence([[{ identity_key: 'xiaoni', enabled: true }]]);
  await persistence.updateAgentRuntimeControl({ identityKey: 'xiaoni', enabled: false });
  const { statement } = queries[queries.length - 1];
  assert.match(statement, /ELSE agent_runtime_control\.passive_recall_delivery_enabled/);
  assert.match(statement, /ELSE agent_runtime_control\.passive_recall_delivery_daily_cap/);
});

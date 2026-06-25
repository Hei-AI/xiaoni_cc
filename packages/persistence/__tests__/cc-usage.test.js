'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCcUsagePersistence } = require('../cc-usage');

// reset 时刻取自实测头：epoch 秒。
const RESET_5H = 1782407400;
const RESET_7D = 1782482400;

function unifiedHeaders(overrides = {}) {
  return {
    'anthropic-organization-id': 'org-test',
    'anthropic-ratelimit-unified-status': 'allowed',
    'anthropic-ratelimit-unified-reset': String(RESET_5H),
    'anthropic-ratelimit-unified-5h-status': 'allowed',
    'anthropic-ratelimit-unified-5h-utilization': '0.58',
    'anthropic-ratelimit-unified-5h-reset': String(RESET_5H),
    'anthropic-ratelimit-unified-7d-status': 'allowed',
    'anthropic-ratelimit-unified-7d-utilization': '0.14',
    'anthropic-ratelimit-unified-7d-reset': String(RESET_7D),
    'anthropic-ratelimit-unified-fallback-percentage': '0.5',
    'anthropic-ratelimit-unified-overage-status': 'disabled',
    'anthropic-ratelimit-unified-overage-disabled-reason': 'no_payment_method',
    ...overrides,
  };
}

function mockSql(rowsForQuery) {
  return {
    calls: [],
    async query(sql, params = []) {
      this.calls.push({ sql, params });
      return rowsForQuery;
    },
    async close() {},
  };
}

test('quota snapshot 把 unified 头整形成 5h/周窗口，remaining = 1 - utilization', async () => {
  const sql = mockSql([
    {
      captured_at: '2026-06-25T15:34:40.669Z',
      model_name: 'claude-opus-4-6',
      headers: unifiedHeaders(),
    },
  ]);
  const { getCcSubscriptionQuotaSnapshot } = createCcUsagePersistence();
  const snapshot = await getCcSubscriptionQuotaSnapshot({ sqlAdapter: sql });

  assert.equal(snapshot.provider, 'anthropic');
  assert.equal(snapshot.modelName, 'claude-opus-4-6');
  assert.equal(snapshot.status, 'allowed');
  assert.equal(snapshot.organizationId, 'org-test');
  assert.equal(snapshot.fallbackPercentage, 0.5);

  assert.equal(snapshot.windows.fiveHour.utilization, 0.58);
  assert.ok(Math.abs(snapshot.windows.fiveHour.remaining - 0.42) < 1e-9);
  assert.equal(snapshot.windows.fiveHour.status, 'allowed');
  assert.equal(snapshot.windows.fiveHour.resetEpoch, RESET_5H);
  assert.equal(snapshot.windows.fiveHour.resetAt, new Date(RESET_5H * 1000).toISOString());

  assert.equal(snapshot.windows.weekly.utilization, 0.14);
  assert.ok(Math.abs(snapshot.windows.weekly.remaining - 0.86) < 1e-9);
  assert.equal(snapshot.windows.weekly.resetAt, new Date(RESET_7D * 1000).toISOString());

  // provider 作为参数化绑定传入，不内联拼接
  assert.deepEqual(sql.calls[0].params, ['anthropic']);
});

test('quota snapshot 无数据返回 null', async () => {
  const { getCcSubscriptionQuotaSnapshot } = createCcUsagePersistence();
  const snapshot = await getCcSubscriptionQuotaSnapshot({ sqlAdapter: mockSql([]) });
  assert.equal(snapshot, null);
});

test('quota snapshot headers 缺失时返回 null 而非崩', async () => {
  const sql = mockSql([{ captured_at: '2026-06-25T15:34:40.669Z', model_name: 'x', headers: null }]);
  const { getCcSubscriptionQuotaSnapshot } = createCcUsagePersistence();
  const snapshot = await getCcSubscriptionQuotaSnapshot({ sqlAdapter: sql });
  assert.equal(snapshot, null);
});

test('utilization 超界被 clamp 到 0..1', async () => {
  const sql = mockSql([
    {
      captured_at: '2026-06-25T15:34:40.669Z',
      model_name: 'claude-opus-4-6',
      headers: unifiedHeaders({ 'anthropic-ratelimit-unified-5h-utilization': '1.4' }),
    },
  ]);
  const { getCcSubscriptionQuotaSnapshot } = createCcUsagePersistence();
  const snapshot = await getCcSubscriptionQuotaSnapshot({ sqlAdapter: sql });
  assert.equal(snapshot.windows.fiveHour.utilization, 1);
  assert.equal(snapshot.windows.fiveHour.remaining, 0);
});

test('headers 以 JSON 字符串形式返回时也能解析', async () => {
  const sql = mockSql([
    {
      captured_at: '2026-06-25T15:34:40.669Z',
      model_name: 'claude-opus-4-6',
      headers: JSON.stringify(unifiedHeaders()),
    },
  ]);
  const { getCcSubscriptionQuotaSnapshot } = createCcUsagePersistence();
  const snapshot = await getCcSubscriptionQuotaSnapshot({ sqlAdapter: sql });
  assert.equal(snapshot.windows.fiveHour.utilization, 0.58);
});

test('timeline 把每行整形成 util5h/util7d 点，默认 7d 窗口绑定 4 个参数', async () => {
  const sql = mockSql([
    { timestamp: '2026-06-25T15:00:00.000Z', util_5h: 0.5, util_7d: 0.12, status_5h: 'allowed', status_7d: 'allowed' },
    { timestamp: '2026-06-25T15:30:00.000Z', util_5h: 0.58, util_7d: 0.14, status_5h: 'allowed', status_7d: 'allowed' },
  ]);
  const { getCcSubscriptionQuotaTimeline } = createCcUsagePersistence();
  const result = await getCcSubscriptionQuotaTimeline({ sqlAdapter: sql });

  assert.equal(result.provider, 'anthropic');
  assert.equal(result.points.length, 2);
  assert.deepEqual(result.points[1], {
    timestamp: '2026-06-25T15:30:00.000Z',
    util5h: 0.58,
    util7d: 0.14,
    status5h: 'allowed',
    status7d: 'allowed',
  });
  // params: [provider, startTime, endTime, limit]
  assert.equal(sql.calls[0].params.length, 4);
  assert.equal(sql.calls[0].params[0], 'anthropic');
  assert.equal(typeof sql.calls[0].params[1], 'string');
  assert.equal(typeof sql.calls[0].params[3], 'number');
});

test('timeline limit 被 clamp 上限，达到 limit 标记 truncated', async () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({
    timestamp: `2026-06-25T1${i}:00:00.000Z`,
    util_5h: 0.5,
    util_7d: 0.1,
    status_5h: 'allowed',
    status_7d: 'allowed',
  }));
  const sql = mockSql(rows);
  const { getCcSubscriptionQuotaTimeline } = createCcUsagePersistence();
  const result = await getCcSubscriptionQuotaTimeline({ sqlAdapter: sql, limit: 3 });
  assert.equal(result.limit, 3);
  assert.equal(result.truncated, true);
});

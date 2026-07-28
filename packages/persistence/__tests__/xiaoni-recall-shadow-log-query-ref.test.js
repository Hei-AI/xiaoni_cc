'use strict';

// listRecallShadowLog 的 queryRef 下推(时间腿去重冷却的窗口过滤)。假 prisma,不碰 DB。
//
// 为什么这是回归用例:xiaoni_recall_shadow_log ~97% 的行是语义腿每次落地写的 stack:*/inbound:*
// 留痕。第二/三条腿要的是「最近 N 条本腿扫描」,如果 query_ref 不下推到 SQL(取全表最近 N 行
// 再在 JS 里筛),窗口里几乎一条本腿行都不剩 → 重复冷却整个失效。真库实测:最近 40 行里
// diary_resurface = 0 条,609 次扫描只浮出过 33 个 distinct ref。
// 配套索引 (identity_key, query_ref, occurred_at DESC):
//   prisma/migrations-manual/2026-07-28-recall-shadow-log-query-ref-index.sql

const test = require('node:test');
const assert = require('node:assert');
const { createXiaoniRecallStorePersistence } = require('../xiaoni-recall-store');

function createStore() {
  const calls = [];
  const prisma = {
    async $queryRawUnsafe(sql, ...params) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return [];
    }
  };
  const store = createXiaoniRecallStorePersistence({ getPrismaClient: () => prisma });
  return { store, calls };
}

test('listRecallShadowLog:传 queryRef → 过滤下推到 SQL(AND query_ref = $2),LIMIT 参数位跟着后移', async () => {
  const { store, calls } = createStore();
  await store.listRecallShadowLog({ identityKey: 'xiaoni', queryRef: 'diary_resurface', limit: 40 });

  assert.strictEqual(calls.length, 1);
  const { sql, params } = calls[0];
  assert.match(sql, /WHERE identity_key = \$1 AND query_ref = \$2/);
  assert.match(sql, /ORDER BY occurred_at DESC, id DESC LIMIT \$3$/);
  assert.deepStrictEqual(params, ['xiaoni', 'diary_resurface', 40]);
  // 绝不许把 ref 拼进 SQL 文本(注入面 + planner 参数化)
  assert.ok(!sql.includes('diary_resurface'), 'query_ref 必须走参数,不进 SQL 字面量');
});

test('listRecallShadowLog:不传 queryRef → 向后兼容,SQL/参数与加参数之前逐字一致(管理端流水面)', async () => {
  const { store, calls } = createStore();
  await store.listRecallShadowLog({ identityKey: 'xiaoni', limit: 50 });

  const { sql, params } = calls[0];
  assert.match(sql, /WHERE identity_key = \$1 ORDER BY occurred_at DESC, id DESC LIMIT \$2$/);
  assert.ok(!sql.includes('query_ref = '), '没传就不许出现 query_ref 谓词');
  assert.deepStrictEqual(params, ['xiaoni', 50]);
});

test('listRecallShadowLog:queryRef 与 onlySurfaced 可叠加,谓词顺序稳定', async () => {
  const { store, calls } = createStore();
  await store.listRecallShadowLog({ identityKey: 'xiaoni', queryRef: 'open_loop_scan', limit: 30, onlySurfaced: true });

  const { sql, params } = calls[0];
  assert.match(sql, /WHERE identity_key = \$1 AND query_ref = \$2 AND silent = false/);
  assert.match(sql, /LIMIT \$3$/);
  assert.deepStrictEqual(params, ['xiaoni', 'open_loop_scan', 30]);
});

test('listRecallShadowLog:空串/空白/非字符串 queryRef 视为没传(不铸出永不匹配的谓词)', async () => {
  const { store, calls } = createStore();
  await store.listRecallShadowLog({ identityKey: 'xiaoni', queryRef: '   ', limit: 7 });
  await store.listRecallShadowLog({ identityKey: 'xiaoni', queryRef: null, limit: 7 });
  await store.listRecallShadowLog({ identityKey: 'xiaoni', queryRef: 123, limit: 7 });

  for (const { sql, params } of calls) {
    assert.ok(!sql.includes('query_ref = '), '空 queryRef 不许进 where');
    assert.deepStrictEqual(params, ['xiaoni', 7]);
  }
});

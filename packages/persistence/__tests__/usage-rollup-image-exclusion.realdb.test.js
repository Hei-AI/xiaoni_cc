'use strict';

// REAL-Postgres regression: image-generation codex events must NOT reach the
// LLM Cost aggregate (llm_usage_rollup_sources → getXiaoniLlmUsageTimeline).
//
// 生图/改图是按图计费的 image 请求，token 口径和主 loop 的对话 token 不可比。把它们
// 混进 LLM Cost 折线会让成本与缓存击穿分析失真，所以
// usageRollupSourceFromCodexProviderSelectSql() 用 WHERE 把 image_generation /
// image_edit / image_prompt_assistant 从 rollup 里挡掉。每条生图的 token「cost」仍在
// 其行动流卡片上单独展示（summarizeTask，另有测试覆盖），只是不进聚合。
//
// 召回的两条小模型腿（recall_rerank / recall_expand）走同一道 WHERE，理由不同：它们是
// 独立请求、不克隆主请求（adr/0006），每次约 1000 input，而主 loop 和各 fork 都是 20 万
// 起步。混进同一条折线的结果是每来一次就把线拽到底一次，把这条线唯一的用途 ——
// 「缓存有没有击穿」—— 的信号淹掉。
//
// 这条必须验真库：排除发生在 rollup 的 INSERT ... SELECT 里，纯内存 mock 直接喂
// pointRows 会绕过 SELECT，测不到过滤。跑在隔离的 qqbot_cache_test，绝不碰 qqbot_db。
// 测试 DB 不可达时（无 Postgres 的 CI）整组干净跳过。

const test = require('node:test');
const assert = require('node:assert/strict');
const { createXiaoniAgentStackPersistence, createSqlAdapter } = require('../index');

const PG_HOST = process.env.DB_HOST || 'localhost';
const PG_PORT = process.env.DB_PORT || '5432';
const PG_USER = process.env.DB_USER || 'qqbot_user';
const PG_PW = process.env.DB_PASSWORD || 'qqbot_password';
const TEST_DB_NAME = 'qqbot_cache_test';
const TEST_DB_URL = process.env.CACHE_TEST_DATABASE_URL
  || `postgresql://${PG_USER}:${PG_PW}@${PG_HOST}:${PG_PORT}/${TEST_DB_NAME}`;
const ADMIN_DB_URL = `postgresql://${PG_USER}:${PG_PW}@${PG_HOST}:${PG_PORT}/postgres`;

let sql = null;
let persistence = null;
let dbReady = false;

async function ensureIsolatedTestDatabase() {
  const admin = createSqlAdapter({ databaseUrl: ADMIN_DB_URL });
  try {
    if (!(await admin.testConnection())) {
      throw new Error('cannot reach the postgres maintenance DB');
    }
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = ?', [TEST_DB_NAME]);
    if (existing.length === 0) {
      await admin.execute(`CREATE DATABASE ${TEST_DB_NAME}`, []);
    }
  } finally {
    await admin.close().catch(() => {});
  }
}

test.before(async () => {
  try {
    await ensureIsolatedTestDatabase();
    sql = createSqlAdapter({ databaseUrl: TEST_DB_URL });
    if (!(await sql.testConnection())) {
      throw new Error('testConnection() returned false');
    }
    persistence = createXiaoniAgentStackPersistence({ sqlAdapter: sql });
    await persistence.ensureXiaoniAgentStackSchema();
    dbReady = true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.log(`[skip] real cache test DB unavailable: ${error.message}`);
    dbReady = false;
  }
});

test.after(async () => {
  if (sql) {
    await sql.close().catch(() => {});
  }
});

function dbTest(name, fn) {
  test(name, async (t) => {
    if (!dbReady) {
      t.skip('real cache test DB (qqbot_cache_test) unavailable');
      return;
    }
    // Isolate the cost rollup: wipe the source + aggregate rows but keep the
    // (already-initialized, v4) rollup state so no full rebuild fires and the
    // incremental sync on each record() is what populates the table.
    await sql.execute('TRUNCATE llm_usage_rollup_sources', []);
    await sql.execute('TRUNCATE llm_usage_rollups', []);
    await sql.execute('TRUNCATE provider_usage_events RESTART IDENTITY', []);
    await fn();
  });
}

function codexEvent(eventId, sourceKind, tokens) {
  return {
    eventId,
    sourceKind,
    identityKey: 'xiaoni',
    modelName: 'gpt-image-2',
    modelProvider: 'codex',
    status: 'completed',
    tokenUsage: tokens,
    createdAt: new Date(),
    completedAt: new Date()
  };
}

dbTest('image_generation / image_edit / image_prompt_assistant are excluded from the LLM Cost timeline', async () => {
  // Control: a cache_heartbeat codex event flows to cost as usual.
  await persistence.recordProviderUsageEvent(
    codexEvent('codex-provider:control-heartbeat', 'cache_heartbeat', { input_tokens: 4000, cached_input_tokens: 3900, output_tokens: 3 })
  );
  // The three image kinds must NOT reach the aggregate.
  await persistence.recordProviderUsageEvent(
    codexEvent('codex-provider:image-generate-1', 'image_generation', { input_tokens: 157, output_tokens: 5488 })
  );
  await persistence.recordProviderUsageEvent(
    codexEvent('codex-provider:image-edit-1', 'image_edit', { input_tokens: 200, output_tokens: 3000 })
  );
  await persistence.recordProviderUsageEvent(
    codexEvent('codex-provider:image-prompt-1', 'image_prompt_assistant', { input_tokens: 88, output_tokens: 120 })
  );

  // Source table: only the control survives.
  const rows = await sql.query('SELECT source_kind FROM llm_usage_rollup_sources ORDER BY source_kind', []);
  assert.deepEqual(rows.map((r) => r.source_kind), ['cache_heartbeat']);

  // Timeline (bucket=call): the image tokens never inflate the cost aggregate.
  const timeline = await persistence.getXiaoniLlmUsageTimeline({ identityKey: 'xiaoni', bucket: 'call', maxPoints: 100 });
  assert.equal(timeline.points.length, 1);
  assert.equal(timeline.points[0].sourceKind, 'cache_heartbeat');
  assert.equal(timeline.summary.inputTokens, 4000);
  assert.equal(timeline.summary.outputTokens, 3);
  assert.equal(
    timeline.points.some((p) => ['image_generation', 'image_edit', 'image_prompt_assistant'].includes(p.sourceKind)),
    false
  );
});

// 召回两条小模型腿(精排 / 展开)是**独立请求，不克隆主请求**(adr/0006)，每次约 1000 input，
// 而主 loop 和各 fork 都是 20 万起步。混进同一条 call 分桶折线的结果是每来一次就把线拽到底
// 一次，把这条线唯一的用途 ——「缓存有没有击穿」—— 的信号淹掉。
dbTest('召回的独立小请求不进 LLM Cost 折线（否则每次都把线拽到底）', async () => {
  // 对照组：cache_heartbeat 是克隆主请求的 fork，照常进聚合。
  await persistence.recordProviderUsageEvent(
    codexEvent('codex-provider:control-heartbeat-2', 'cache_heartbeat', { input_tokens: 212895, cached_input_tokens: 212000, output_tokens: 1 })
  );
  await persistence.recordProviderUsageEvent(
    codexEvent('codex-provider:recall-rerank-1', 'recall_rerank', { input_tokens: 1154, output_tokens: 89 })
  );
  await persistence.recordProviderUsageEvent(
    codexEvent('codex-provider:recall-expand-1', 'recall_expand', { input_tokens: 995, output_tokens: 167 })
  );

  // 断言只认本用例自己写的那三行。整表比对会被同一个共享测试库里别的 realdb 用例
  // （failure_review_fork 等）写进来的行打断 —— 那是噪音，不是被测行为。
  const ids = ['codex-provider:control-heartbeat-2', 'codex-provider:recall-rerank-1', 'codex-provider:recall-expand-1'];
  const rows = await sql.query(
    'SELECT slice_id, source_kind FROM llm_usage_rollup_sources WHERE slice_id IN (?, ?, ?) ORDER BY slice_id',
    ids
  );
  assert.deepEqual(rows.map((r) => r.source_kind), ['cache_heartbeat']);

  const timeline = await persistence.getXiaoniLlmUsageTimeline({ identityKey: 'xiaoni', bucket: 'call', maxPoints: 100 });
  const mine = timeline.points.filter((p) => ids.includes(p.llmRequestSliceId));
  assert.deepEqual(mine.map((p) => p.sourceKind), ['cache_heartbeat']);
  // 触底毛刺的判据：本用例贡献给折线的点不能塌到千级。
  assert.equal(mine[0].inputTokens, 212895);
  // 这条是全局的：整条折线上一个召回点都不能有。
  assert.equal(
    timeline.points.some((p) => ['recall_rerank', 'recall_expand'].includes(p.sourceKind)),
    false
  );
});

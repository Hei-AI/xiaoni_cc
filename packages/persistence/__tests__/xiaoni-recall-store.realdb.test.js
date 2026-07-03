'use strict';

// 真库集成测:store 往返 + band-pass over 真行(含自匹配剔除)。跑在隔离的
// qqbot_cache_test(同主栈 Postgres,绝不碰 qqbot_db)。单独跑:
//   node --test __tests__/xiaoni-recall-store.realdb.test.js
// docs/XIAONI_PASSIVE_RECALL_SURFACING.md

const test = require('node:test');
const assert = require('node:assert');

const PG_HOST = process.env.DB_HOST || 'localhost';
const PG_PORT = process.env.DB_PORT || '5432';
const PG_USER = process.env.DB_USER || 'qqbot_user';
const PG_PW = process.env.DB_PASSWORD || 'qqbot_password';
const TEST_DB_NAME = 'qqbot_cache_test';
const TEST_DB_URL = process.env.CACHE_TEST_DATABASE_URL
  || `postgresql://${PG_USER}:${PG_PW}@${PG_HOST}:${PG_PORT}/${TEST_DB_NAME}`;
const ADMIN_DB_URL = `postgresql://${PG_USER}:${PG_PW}@${PG_HOST}:${PG_PORT}/postgres`;

// 把 prisma 单例钉死在 cache_test 上(prisma getPrismaClient 首调 URL 生效),绝不落到 qqbot_db。
process.env.DATABASE_URL = TEST_DB_URL;

const {
  createSqlAdapter,
  upsertRecallCues,
  listRecallCandidates,
  getExistingContentHashes,
  countRecallCues,
  pruneFileChunks,
  bandpassRecall,
  renderRecallLead
} = require('../index');

const IDENTITY = 'xiaoni_recall_test';

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS xiaoni_recall_cues (
  id BIGSERIAL PRIMARY KEY,
  identity_key VARCHAR(64) NOT NULL,
  source_kind VARCHAR(32) NOT NULL,
  source_ref VARCHAR(512) NOT NULL,
  provenance JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ(3),
  embedding_text TEXT NOT NULL,
  embedding JSONB NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT uniq_xiaoni_recall_cue_identity_source UNIQUE (identity_key, source_ref)
)`;

let dbReady = false;

test.before(async () => {
  const admin = createSqlAdapter({ databaseUrl: ADMIN_DB_URL });
  try {
    if (!(await admin.testConnection())) {
      return;
    }
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = ?', [TEST_DB_NAME]);
    if (existing.length === 0) {
      await admin.execute(`CREATE DATABASE ${TEST_DB_NAME}`, []);
    }
  } catch {
    return;
  } finally {
    await admin.close().catch(() => {});
  }

  const sql = createSqlAdapter({ databaseUrl: TEST_DB_URL });
  try {
    await sql.execute(CREATE_TABLE, []);
    await sql.execute('DELETE FROM xiaoni_recall_cues WHERE identity_key = ?', [IDENTITY]);
    dbReady = true;
  } catch {
    dbReady = false;
  } finally {
    await sql.close().catch(() => {});
  }
});

function cue(sourceRef, vector, text, extra = {}) {
  return {
    sourceKind: extra.sourceKind || 'action_stream',
    sourceRef,
    occurredAt: '2026-07-03T00:00:00Z',
    embeddingText: text,
    provenance: extra.provenance || { leadTemplate: null, cueClass: 'db_life_cue', privacyScope: 'self_private' },
    contentHash: `hash-${sourceRef}-${text.length}`,
    embedding: vector
  };
}

test('store round-trip + band-pass over real rows: mid surfaces, self-match dropped, hash-skip works', async (t) => {
  if (!dbReady) {
    t.skip('qqbot_cache_test unavailable');
    return;
  }
  const cfg = { databaseUrl: TEST_DB_URL };

  const records = [
    cue('a', [1, 0.02], '和 query 几乎一样的东西(她刚做的)'),
    cue('b', [0.7, 0.7141], '关于小K那次浏览器桥的记录'),
    cue('c', [0.2, 0.98], '完全无关的噪音'),
    cue('/xiaoni-runtime/notes/x.md#0', [0.66, 0.75], '一段旧笔记里的想法', {
      sourceKind: 'file_chunk',
      provenance: { leadTemplate: 'file_chunk', path: '/xiaoni-runtime/notes/x.md', cueClass: 'db_file_provenance', privacyScope: 'self_private' }
    })
  ];

  const { upserted } = await upsertRecallCues(IDENTITY, records, cfg);
  assert.strictEqual(upserted, 4);

  const counts = await countRecallCues(IDENTITY, cfg);
  assert.strictEqual(counts.total, 4);
  assert.strictEqual(counts.byKind.file_chunk, 1);

  // hash 没变 → getExistingContentHashes 命中,ingest 会跳过重嵌。
  const hashes = await getExistingContentHashes(IDENTITY, ['a', 'b'], cfg);
  assert.strictEqual(hashes.get('a'), 'hash-a-' + '和 query 几乎一样的东西(她刚做的)'.length);

  // 召回:query≈[1,0](模拟她当下正看的内容,和 'a' 几乎一致)。'a' 应被上限剔为冗余。
  const candidates = await listRecallCandidates({ identityKey: IDENTITY, limit: 100 }, cfg);
  assert.strictEqual(candidates.length, 4);
  assert.ok(candidates.every((c) => Array.isArray(c.embedding) && c.embedding.length === 2), 'vectors survive JSON round-trip');

  const result = bandpassRecall({
    query: { vector: [1, 0] },
    candidates: candidates.map((c) => ({ sourceRef: c.sourceRef, embedding: c.embedding, provenance: c.provenance, embeddingText: c.embeddingText })),
    limit: 1
  });
  assert.strictEqual(result.silent, false);
  assert.strictEqual(result.surfaced[0].candidate.sourceRef, 'b', 'mid-band memory surfaces, not the near-duplicate');
  assert.ok(result.dropped.some((d) => d.candidate.sourceRef === 'a' && d.verdict === 'drop_too_similar'), 'self-match dropped');
  assert.ok(result.dropped.some((d) => d.candidate.sourceRef === 'c' && d.verdict === 'drop_too_far'), 'noise dropped');

  // 打印真实召回结果(viewable)。
  const lead = renderRecallLead(result.surfaced[0].candidate);
  console.log(`\n[真实召回] query≈当下内容 → 浮现: "${lead.text}" (cos ${result.surfaced[0].cos.toFixed(3)}, ${lead.kind})`);
  console.log(`[剔除] too_similar=${result.dropped.filter((d) => d.verdict === 'drop_too_similar').length} too_far=${result.dropped.filter((d) => d.verdict === 'drop_too_far').length}\n`);

  // 文件块清理:keep 只留 #0 之外 → #0 被删。
  const prune = await pruneFileChunks(IDENTITY, '/xiaoni-runtime/notes/x.md', ['/xiaoni-runtime/notes/x.md#9'], cfg);
  assert.strictEqual(prune.deleted, 1);
  const after = await countRecallCues(IDENTITY, cfg);
  assert.strictEqual(after.total, 3);
});

test.after(async () => {
  if (!dbReady) {
    return;
  }
  const sql = createSqlAdapter({ databaseUrl: TEST_DB_URL });
  try {
    await sql.execute('DELETE FROM xiaoni_recall_cues WHERE identity_key = ?', [IDENTITY]);
  } catch {
    // best effort
  } finally {
    await sql.close().catch(() => {});
  }
});

'use strict';

// failure_review_fork_slices 的 **schema 层不变量**。真 PG,不可达时干净跳过。
//
// 这个文件的存在理由:第五、六、七轮评审查出的 bug 全是同一类 —— 建表放错模块、索引丢了、
// 唯一约束旧库补不上、ON CONFLICT 静默失败、分区键选错。每一条都不报错、都不被单测发现,
// 只在**真库的某个具体状态**下才显形,而且三轮里有两轮的 bug 是上一轮的修复引入的。
// 靠一轮轮人看去发现收敛太慢,所以钉成用例:改坏即红。
//
// 每条断言后面括号里标的是它对应的那次事故。

const test = require('node:test');
const assert = require('node:assert');

const {
  createSqlAdapter,
  ensureXiaoniAgentStackSchema,
  recordFailureReviewForkSlice,
  listFailureReviewForkSlices
} = require('../index');

const PG_HOST = process.env.DB_HOST || 'localhost';
const PG_PORT = process.env.DB_PORT || '5432';
const PG_USER = process.env.DB_USER || 'qqbot_user';
const PG_PW = process.env.DB_PASSWORD || 'qqbot_password';
const TEST_DB_NAME = 'qqbot_cache_test';
const TEST_DB_URL = process.env.CACHE_TEST_DATABASE_URL
  || `postgresql://${PG_USER}:${PG_PW}@${PG_HOST}:${PG_PORT}/${TEST_DB_NAME}`;
const ADMIN_DB_URL = `postgresql://${PG_USER}:${PG_PW}@${PG_HOST}:${PG_PORT}/postgres`;
const CFG = { databaseUrl: TEST_DB_URL };

// schema.prisma 声明的名字。DDL 建出来的必须**就是这几个** —— 名字对不上,
// 声明与实库就永久漂移(第六轮 P2:内联 UNIQUE 由 PG 自动命名,对不上 @unique(map:))。
const UNIQUE_INDEX = 'uniq_failure_review_fork_slices_slice_id';
const RUN_TURN_INDEX = 'idx_failure_review_fork_slices_run_turn';
const FORK_CREATED_INDEX = 'idx_failure_review_fork_slices_fork_created';

let sql = null;
let dbReady = false;

async function ensureIsolatedTestDatabase() {
  const admin = createSqlAdapter({ databaseUrl: ADMIN_DB_URL });
  try {
    if (!(await admin.testConnection())) throw new Error('cannot reach the postgres maintenance DB');
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = ?', [TEST_DB_NAME]);
    if (existing.length === 0) await admin.execute(`CREATE DATABASE ${TEST_DB_NAME}`, []);
  } finally {
    await admin.close().catch(() => {});
  }
}

test.before(async () => {
  try {
    await ensureIsolatedTestDatabase();
    sql = createSqlAdapter({ databaseUrl: TEST_DB_URL });
    if (!(await sql.testConnection())) throw new Error('testConnection() returned false');
    dbReady = true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.log(`[skip] real cache test DB unavailable: ${error.message}`);
    dbReady = false;
  }
});

test.after(async () => {
  if (sql) await sql.close().catch(() => {});
});

function dbTest(name, fn) {
  test(name, async (t) => {
    if (!dbReady) {
      t.skip('real cache test DB (qqbot_cache_test) unavailable');
      return;
    }
    await fn();
  });
}

async function indexNames() {
  const rows = await sql.query(
    "SELECT indexname FROM pg_indexes WHERE tablename = 'failure_review_fork_slices'",
    []
  );
  return new Set(rows.map((r) => r.indexname));
}

function slice(sliceId, forkRunId, extra = {}) {
  return {
    sliceId,
    forkRunId,
    goalId: 'goal_A',
    identityKey: 'xiaoni',
    canonicalRequest: { blob: 'x' },
    wireRequest: { blob: 'x' },
    outputItems: [],
    status: 'completed',
    tokenUsage: { input_tokens: 7 },
    agentTurn: 1,
    modelName: 'm',
    ...extra
  };
}

// ── 建表与索引 ──────────────────────────────────────────────────────────────

dbTest('agent-stack 的 ensure 自己就能把表和三个索引建出来', async () => {
  // 事故(第五轮 P0):DDL 曾放在 xiaoni-goal.js,而 usage rollup 的 UNION 无条件 FROM
  // 这张表、且挂在「每一次持久化操作」的路径上 —— 新库上只要 admin-backend 先起,
  // 每一次持久化操作都 relation does not exist。
  await sql.execute('DROP TABLE IF EXISTS failure_review_fork_slices', []);
  await ensureXiaoniAgentStackSchema({}, CFG);

  const names = await indexNames();
  // 名字必须**就是 schema.prisma 声明的那几个**(第六轮 P2 / 第七轮 P2)
  assert.ok(names.has(UNIQUE_INDEX), `缺唯一索引 ${UNIQUE_INDEX}`);
  assert.ok(names.has(RUN_TURN_INDEX), `缺 raw trace 索引 ${RUN_TURN_INDEX}`);
  assert.ok(names.has(FORK_CREATED_INDEX), `缺列表索引 ${FORK_CREATED_INDEX}`);
});

dbTest('列表索引的列顺序跟着列表查询走,不是跟着已经删掉的旧查询', async () => {
  // 事故(第七轮 P1):补索引和换查询在同一个 commit 里,索引照着**被删掉的**那条
  // 全局 ORDER BY 建 —— identity_key 单值,对新的 PARTITION BY fork_run_id 帮不上忙。
  await ensureXiaoniAgentStackSchema({}, CFG);
  const rows = await sql.query(
    'SELECT indexdef FROM pg_indexes WHERE indexname = ?',
    [FORK_CREATED_INDEX]
  );
  assert.equal(rows.length, 1);
  const def = rows[0].indexdef;
  // 列表查询是 WHERE identity_key AND fork_run_id IN (...) + PARTITION BY fork_run_id
  assert.match(def, /\(identity_key, fork_run_id, created_at DESC, id DESC\)/);
});

dbTest('ensure 幂等:连跑两遍不抛、索引不重复', async () => {
  await ensureXiaoniAgentStackSchema({}, CFG);
  const before = await indexNames();
  await ensureXiaoniAgentStackSchema({}, CFG);
  assert.deepEqual([...(await indexNames())].sort(), [...before].sort());
});

// ── 旧库补丁路径 ────────────────────────────────────────────────────────────

dbTest('旧库(无唯一约束 + 已有重复行)上 ensure 会收敛,而不是吞掉', async () => {
  // 事故(第六轮 P2 + 第七轮 P1):CREATE TABLE IF NOT EXISTS **不给已存在的表补约束**,
  // 早一版 DDL 建的库没有 unique → ON CONFLICT (slice_id) 42P10。
  // 而第一版修法把建索引的异常吞掉了 —— 吞掉之后索引永远建不起来,ON CONFLICT 永久失败,
  // 调用方只 warn,slice 全部静默不落库 = 页面上「这次复核没产出」,
  // **与真的没查到不可区分**,正是这套东西要消除的态。
  await sql.execute('DROP TABLE IF EXISTS failure_review_fork_slices', []);
  await sql.execute(
    `CREATE TABLE failure_review_fork_slices (
       id BIGSERIAL PRIMARY KEY,
       slice_id VARCHAR(191) NOT NULL,
       fork_run_id VARCHAR(191) NOT NULL,
       llm_call_id VARCHAR(128),
       identity_key VARCHAR(191) NOT NULL DEFAULT 'xiaoni',
       goal_id VARCHAR(64),
       canonical_request JSONB NOT NULL DEFAULT '{}'::jsonb,
       wire_request JSONB, canonical_response JSONB, wire_response JSONB, raw_response JSONB,
       output_items JSONB NOT NULL DEFAULT '[]'::jsonb,
       status VARCHAR(32) NOT NULL DEFAULT 'completed',
       token_usage JSONB NOT NULL DEFAULT '{}'::jsonb,
       trace_id VARCHAR(128), run_id VARCHAR(128), agent_turn INTEGER,
       model_name VARCHAR(191), model_provider VARCHAR(64), processing_time_ms INTEGER,
       metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
       created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    []
  );
  await sql.execute(
    `INSERT INTO failure_review_fork_slices (slice_id, fork_run_id)
     VALUES ('dup_1','fr_old'),('dup_1','fr_old'),('dup_2','fr_old'),('dup_2','fr_old')`,
    []
  );

  await ensureXiaoniAgentStackSchema({}, CFG);

  assert.ok((await indexNames()).has(UNIQUE_INDEX), '唯一索引必须**真的建起来**,不是被吞掉');
  const dups = await sql.query(
    'SELECT slice_id, COUNT(*)::int AS c FROM failure_review_fork_slices GROUP BY 1 HAVING COUNT(*) > 1',
    []
  );
  assert.equal(dups.length, 0, '重复行必须收敛到各 1 行,否则唯一索引永远建不起来');

  // 补上约束之后写入路径必须能用 —— 这一条就是「静默丢数据」的判别式
  await recordFailureReviewForkSlice(slice('after_patch', 'fr_new'), CFG);
  await recordFailureReviewForkSlice(slice('after_patch', 'fr_new'), CFG);
  const rows = await sql.query(
    'SELECT COUNT(*)::int AS c FROM failure_review_fork_slices WHERE slice_id = ?',
    ['after_patch']
  );
  assert.equal(rows[0].c, 1, 'ON CONFLICT 必须生效且幂等');
});

// ── 列表口 ──────────────────────────────────────────────────────────────────

dbTest('分组单元是 fork_run_id:同一个 goal 反复 blocked,后一次不挤掉前一次', async () => {
  // 事故(第七轮 P2,同一处被连着点名三轮):slice 属于一次 fork,不属于一个 goal。
  // 按 goal 归组既把多次复核混成一堆,又拿不到硬上界 —— 调用方只能拍倍数,
  // 拍小了更早那次复核静默拿到空数组,与「这次没产出」不可区分。
  await ensureXiaoniAgentStackSchema({}, CFG);
  await sql.execute('TRUNCATE failure_review_fork_slices', []);
  for (let i = 0; i < 5; i += 1) {
    await recordFailureReviewForkSlice(slice(`a${i}`, 'fr_A'), CFG);
  }
  await recordFailureReviewForkSlice(slice('b0', 'fr_B'), CFG);

  const rows = await listFailureReviewForkSlices({ forkRunIds: ['fr_A', 'fr_B'], limit: 2 }, CFG);
  const byFork = {};
  for (const row of rows) byFork[row.forkRunId] = (byFork[row.forkRunId] || 0) + 1;
  assert.equal(byFork.fr_B, 1, '只有一条 slice 的那次复核不许被挤掉');
  assert.equal(byFork.fr_A, 2, 'limit 是每个 fork 各自的上限');
});

dbTest('列表只回尺寸不回正文,而且是真字节', async () => {
  // 事故(第六轮 P2):先是回吐完整 canonical/wire(每条是主上下文的完整克隆,
  // limit 200 能到 GB 级);改成 JSON.stringify(...).length 之后,大 JSONB 仍整列拉进 Node
  // 只是响应变小,而且 .length 是 UTF-16 码元 —— 中文少算约 2/3,字段名叫 Bytes 就是错的。
  await ensureXiaoniAgentStackSchema({}, CFG);
  await sql.execute('TRUNCATE failure_review_fork_slices', []);
  const cn = '一'.repeat(3000); // 码元 3000,UTF-8 真字节 9000
  await recordFailureReviewForkSlice(
    slice('cn', 'fr_cn', { canonicalRequest: { blob: cn }, wireRequest: { blob: cn } }),
    CFG
  );
  const [row] = await listFailureReviewForkSlices({ forkRunIds: ['fr_cn'] }, CFG);
  assert.equal(row.canonicalRequest, undefined, '正文不许回吐');
  assert.equal(row.wireRequest, undefined, '正文不许回吐');
  assert.ok(row.canonicalRequestBytes > 8000, `真字节应 >8000,实际 ${row.canonicalRequestBytes}`);
});

dbTest('传了空的 forkRunIds = 要空集,不是要全部', async () => {
  await ensureXiaoniAgentStackSchema({}, CFG);
  await sql.execute('TRUNCATE failure_review_fork_slices', []);
  await recordFailureReviewForkSlice(slice('anything', 'fr_x'), CFG);
  assert.equal((await listFailureReviewForkSlices({ forkRunIds: [] }, CFG)).length, 0);
});

// ── usage rollup ────────────────────────────────────────────────────────────

dbTest('slice 落库时增量进 usage rollup(不进就是这一路用量彻底不可见)', async () => {
  // 事故(第三、四轮):换到独立表之后 usage 变成不可见 —— rollup 是**表白名单**,
  // 新源不登记就永远不在计费口里;而只登记 UNION、不接增量口 syncLlmUsageRollupForSlice,
  // 等于没修(全量重建只在初始化时跑一次)。
  await ensureXiaoniAgentStackSchema({}, CFG);
  await sql.execute('TRUNCATE failure_review_fork_slices', []);
  await sql.execute("DELETE FROM llm_usage_rollup_sources WHERE source_kind = 'failure_review_fork'", []);
  await recordFailureReviewForkSlice(
    slice('roll', 'fr_roll', { tokenUsage: { input_tokens: 4242 } }),
    CFG
  );
  const rows = await sql.query(
    "SELECT input_tokens FROM llm_usage_rollup_sources WHERE source_kind = 'failure_review_fork' AND slice_id = ?",
    ['roll']
  );
  assert.equal(rows.length, 1, 'slice 必须增量进 rollup');
  assert.equal(Number(rows[0].input_tokens), 4242);
});

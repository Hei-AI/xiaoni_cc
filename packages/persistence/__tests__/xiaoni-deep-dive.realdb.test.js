'use strict';

// REAL-Postgres 回归:她自己起的深挖(docs/specs/xiaoni-deep-dive-tools.md §2)。
//
// 这一层守两条**存储**不变量,两条都只有真 PG 能验 —— 用 mock prisma 验等于验我自己写的 mock:
//   ① 同一 identity 最多一个 phase='active' —— 部分唯一索引(Prisma schema 表达不了 WHERE),
//      并发 create 时必须由 DB 拒绝第二个,而不是应用层「先查后写」(中间有窗口);
//   ② compare-and-set —— 她的 parallel_tool_calls 是开的,一次可能发多个 update_deep_dive;
//      where 子句里漏掉 revision 的话,后发的会静默盖掉先发的,而且**单元测试看不出来**。
//
// 外加一条容易写反的语义:incrementXiaoniDeepDiveRound 是引擎侧动作,**故意不动 revision**。
// 动了的话,她 get_deep_dive 之后引擎恰好推进一轮就把她手上的 revision 作废,她会陷入
// 「读→改→被拒→再读」的循环。
//
// 与 agent-stack-event-id-dedup.realdb 同一套隔离 DB(qqbot_cache_test),不可达时干净跳过。

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSqlAdapter,
  ensureXiaoniDeepDiveSchema,
  createXiaoniDeepDive,
  getActiveXiaoniDeepDive,
  getXiaoniDeepDiveById,
  updateXiaoniDeepDive,
  incrementXiaoniDeepDiveRound,
  listXiaoniDeepDives,
  getCurrentXiaoniDeepDive
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

let sql = null;
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
    await ensureXiaoniDeepDiveSchema(CFG);
    // 幂等性:ensure 是每次启动都跑的,跑两遍必须不报错、不重建。
    await ensureXiaoniDeepDiveSchema(CFG);
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
    await sql.execute('TRUNCATE xiaoni_deep_dives', []);
    await fn();
  });
}

dbTest('建表后能创建目标,初值就是 active / revision=1 / rounds=0', async () => {
  const dive = await createXiaoniDeepDive({ question: '把 gorton 写到第 100 章' }, CFG);
  assert.equal(dive.phase, 'active');
  assert.equal(dive.revision, 1);
  assert.equal(dive.roundsStarted, 0);
  assert.equal(dive.maxRounds, 20);
  assert.equal(dive.blockedReason, null);
  assert.equal(dive.question, '把 gorton 写到第 100 章');

  const active = await getActiveXiaoniDeepDive({}, CFG);
  assert.equal(active.id, dive.id);
});

dbTest('不变量①:已有 active 时再创建 → DB 拒绝(部分唯一索引),不是应用层 if', async () => {
  await createXiaoniDeepDive({ question: '第一件事' }, CFG);
  await assert.rejects(
    () => createXiaoniDeepDive({ question: '第二件事' }, CFG),
    (error) => /Unique constraint|P2002/i.test(String(error && error.message)),
    '第二个 active 必须被唯一索引拒绝'
  );
  const rows = await listXiaoniDeepDives({}, CFG);
  assert.equal(rows.length, 1, '拒绝之后不许留下半条记录');
});

dbTest('不变量①:目标做完之后 active 位置腾出来,可以立新的', async () => {
  const first = await createXiaoniDeepDive({ question: '第一件事' }, CFG);
  const done = await updateXiaoniDeepDive(
    { diveId: first.id, revision: first.revision, phase: 'concluded' },
    CFG
  );
  assert.equal(done.ok, true);
  const second = await createXiaoniDeepDive({ question: '第二件事' }, CFG);
  assert.equal(second.phase, 'active');
  assert.equal((await getActiveXiaoniDeepDive({}, CFG)).id, second.id);
});

dbTest('不变量②:revision 对不上 → ok:false + 回当前值,且一个字段都没被改', async () => {
  const dive = await createXiaoniDeepDive({ question: '原始目标' }, CFG);
  const first = await updateXiaoniDeepDive(
    { diveId: dive.id, revision: dive.revision, phase: 'paused' },
    CFG
  );
  assert.equal(first.ok, true);
  assert.equal(first.dive.revision, 2);

  // 拿着过期的 revision=1 再改(模拟同一 turn 里并发发出的第二个 update_dive)
  const stale = await updateXiaoniDeepDive(
    { diveId: dive.id, revision: 1, phase: 'concluded', question: '被覆盖的目标' },
    CFG
  );
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'revision_mismatch');
  assert.equal(stale.dive.phase, 'paused', '陈旧写入不许生效');
  assert.equal(stale.dive.question, '原始目标');
  assert.equal(stale.dive.revision, 2, '被拒绝的写入不许推进 revision');
});

dbTest('blocked_reason 只在 blocked 时留着,转出 blocked 立刻清掉', async () => {
  const dive = await createXiaoniDeepDive({ question: '找到那个人' }, CFG);
  const blocked = await updateXiaoniDeepDive(
    {
      diveId: dive.id,
      revision: dive.revision,
      phase: 'blocked',
      blockedReason: 'grep 了十一次关键词,没有一次匹配到人名'
    },
    CFG
  );
  assert.equal(blocked.ok, true);
  assert.equal(blocked.dive.phase, 'blocked');
  assert.match(blocked.dive.blockedReason, /grep 了十一次/);

  const resumed = await updateXiaoniDeepDive(
    { diveId: dive.id, revision: blocked.dive.revision, phase: 'active' },
    CFG
  );
  assert.equal(resumed.ok, true);
  assert.equal(
    resumed.dive.blockedReason,
    null,
    '一条陈旧的卡住理由不许跟着一个 active 目标到处跑'
  );
});

dbTest('轮次推进:rounds_started +1,但 revision 一个都不动', async () => {
  const dive = await createXiaoniDeepDive({ question: '读完 Howard' }, CFG);
  const afterOne = await incrementXiaoniDeepDiveRound({ diveId: dive.id }, CFG);
  assert.equal(afterOne.roundsStarted, 1);
  assert.equal(
    afterOne.revision,
    dive.revision,
    'round 不是她 CAS 的对象;动了 revision 会让她手上的 revision 无故作废'
  );

  const afterTwo = await incrementXiaoniDeepDiveRound({ diveId: dive.id }, CFG);
  assert.equal(afterTwo.roundsStarted, 2);
  assert.equal(afterTwo.revision, dive.revision);

  // 她此刻仍然可以用最初读到的 revision 去改 —— 这就是不动 revision 的意义
  const edited = await updateXiaoniDeepDive(
    { diveId: dive.id, revision: dive.revision, phase: 'active', question: '读完 Howard 前六章' },
    CFG
  );
  assert.equal(edited.ok, true);
  assert.equal(edited.dive.question, '读完 Howard 前六章');
  assert.equal(edited.dive.roundsStarted, 2, '改目标不该重置已经跑过的轮次');
});

dbTest('轮次推进只对 active 生效:目标已经收尾就记不上', async () => {
  const dive = await createXiaoniDeepDive({ question: '一件事' }, CFG);
  const done = await updateXiaoniDeepDive(
    { diveId: dive.id, revision: dive.revision, phase: 'concluded' },
    CFG
  );
  assert.equal(done.ok, true);
  assert.equal(await incrementXiaoniDeepDiveRound({ diveId: dive.id }, CFG), null);
  assert.equal((await getXiaoniDeepDiveById({ diveId: dive.id }, CFG)).roundsStarted, 0);
});

dbTest('参数校验:空 question、非法 phase、缺 revision 都要当场拒绝', async () => {
  await assert.rejects(() => createXiaoniDeepDive({ question: '   ' }, CFG), /question/);
  const dive = await createXiaoniDeepDive({ question: '正常目标' }, CFG);
  await assert.rejects(
    () => updateXiaoniDeepDive({ diveId: dive.id, revision: dive.revision, phase: 'done' }, CFG),
    /phase/
  );
  await assert.rejects(
    () => updateXiaoniDeepDive({ diveId: dive.id, phase: 'paused' }, CFG),
    /revision/
  );
});

// ── 观测口(issue #6)────────────────────────────────────────────────────────
// 复核 fork 的输出原文落在 timeline_events。ADR-0009 §六把「输出文本单独可查」列为
// **必需项** —— 「克隆 + 尾部改写身份」能不能挡住她的自我认知未经验证,判据就是人工读
// 前 20 条的人称语气。只有日志的话读不到、也查不了,那条假设永远判不了输赢。

const { logRuntimeTimelineEvent, listRuntimeTimelineEvents } = require('../index');

dbTest('复核输出按时间倒序可读,原文一个字不改', async () => {
  await sql.execute(`
    CREATE TABLE IF NOT EXISTS timeline_events (
      id BIGSERIAL PRIMARY KEY,
      trace_id VARCHAR(191),
      event_type VARCHAR(64),
      event_name VARCHAR(128),
      event_phase VARCHAR(32),
      component VARCHAR(64),
      duration_ms INTEGER,
      metadata JSONB,
      created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`, []);
  await sql.execute('TRUNCATE timeline_events RESTART IDENTITY', []);

  const findings = 'diary/2026-08-16.md:996\n  「小伊: 8/8到现在没回。不追了。放。」';
  for (const [diveId, text] of [['dive_a', '第一条'], ['dive_b', findings]]) {
    await logRuntimeTimelineEvent({
      traceId: `failure-review:${diveId}`,
      eventType: 'fork',
      eventName: 'failure_review_fork',
      eventPhase: 'completed',
      metadata: { deep_dive_id: diveId, findings_text: text, delivered: true }
    }, CFG);
  }
  // 噪音:同一张表里别的事件不该被捞出来
  await logRuntimeTimelineEvent({
    traceId: 't', eventType: 'memory', eventName: 'core_memory_compressed', metadata: {}
  }, CFG);

  const rows = await listRuntimeTimelineEvents({ eventName: 'failure_review_fork', limit: 20 }, CFG);
  assert.equal(rows.length, 2, '只捞复核事件,别的事件不算');
  assert.equal(rows[0].metadata.deep_dive_id, 'dive_b', '按时间倒序:最新的在前');
  assert.equal(rows[0].metadata.findings_text, findings, '证据原文逐字节保留,不许被摘要');
  assert.equal(rows[0].metadata.delivered, true);
});

// ── get_deep_dive 读到的是哪一个(Spec 轴第八轮 (c)-5)────────────────────────────────
// 事故:get_deep_dive 只查 active,于是 paused / blocked 的深挖**永远拿不到 dive_id 和
// revision** —— 而 update_deep_dive 必须带这两个。结果 resume 结构性不可达、
// pause 等于永久放弃、blocked 之后她也再看不到自己写的 blocked_reason。
// spec §1 的 action 集合里有 resume,这条就必须成立。

dbTest('pause 之后仍读得到那件事,resume 走得通(不是永久放弃)', async () => {
  const dive = await createXiaoniDeepDive({ question: '读完 Howard 前六章' }, CFG);
  const paused = await updateXiaoniDeepDive({ diveId: dive.id, revision: dive.revision, phase: 'paused' }, CFG);
  assert.equal(paused.ok, true);

  // 只认 active 的旧实现在这里拿到 null → 她再也够不着这件事
  const current = await getCurrentXiaoniDeepDive({}, CFG);
  assert.ok(current, 'paused 的目标必须仍然读得到');
  assert.equal(current.id, dive.id);
  assert.equal(current.phase, 'paused');

  // 拿得到 id+revision,resume 才走得通
  const resumed = await updateXiaoniDeepDive(
    { diveId: current.id, revision: current.revision, phase: 'active' },
    CFG
  );
  assert.equal(resumed.ok, true);
  assert.equal(resumed.dive.phase, 'active');
});

dbTest('blocked 之后仍读得到,blocked_reason 还在', async () => {
  const dive = await createXiaoniDeepDive({ question: '找到那个长期没音讯的人' }, CFG);
  await updateXiaoniDeepDive(
    { diveId: dive.id, revision: dive.revision, phase: 'blocked', blockedReason: 'grep 了十一次,全是噪音' },
    CFG
  );
  const current = await getCurrentXiaoniDeepDive({}, CFG);
  assert.equal(current.phase, 'blocked');
  assert.match(current.blockedReason, /十一次/);
});

dbTest('completed 的不再摆到她眼前', async () => {
  const dive = await createXiaoniDeepDive({ question: '收掉的那件' }, CFG);
  await updateXiaoniDeepDive({ diveId: dive.id, revision: dive.revision, phase: 'concluded' }, CFG);
  assert.equal(await getCurrentXiaoniDeepDive({}, CFG), null);
});

dbTest('有 active 时优先给 active,不给更晚动过的 paused', async () => {
  const first = await createXiaoniDeepDive({ question: '先立的,后来停了' }, CFG);
  await updateXiaoniDeepDive({ diveId: first.id, revision: first.revision, phase: 'paused' }, CFG);
  const second = await createXiaoniDeepDive({ question: '现在在做的' }, CFG);
  // 再动一次 paused 那件,让它的 updated_at 更晚
  const reread = await getXiaoniDeepDiveById({ diveId: first.id }, CFG);
  await updateXiaoniDeepDive({ diveId: first.id, revision: reread.revision, phase: 'paused', question: '先立的,后来停了(改了下)' }, CFG);

  const current = await getCurrentXiaoniDeepDive({}, CFG);
  assert.equal(current.id, second.id, 'active 优先于「最近动过」');
  assert.equal(current.phase, 'active');
});

// ── 从旧 goal 命名迁移过来(2026-08-23 改名)────────────────────────────────────
// 这条路只在**已经有旧表的库**上走,而生产恰好就是那种库。用例把旧形状原样建出来,
// 再跑一遍 ensure,断言:表名/列名/索引名都换了,**而且行还在、phase 也跟着换了**。
// 不验行还在的话,一个「DROP 再 CREATE」的实现同样能让所有名字断言变绿。
dbTest('迁移:旧 xiaoni_goals 整体改名成 xiaoni_deep_dives,数据不丢', async () => {
  await sql.execute('DROP TABLE IF EXISTS xiaoni_deep_dives', []);
  await sql.execute(`
    CREATE TABLE xiaoni_goals (
      id VARCHAR(64) PRIMARY KEY,
      identity_key VARCHAR(64) NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      objective TEXT NOT NULL,
      phase VARCHAR(16) NOT NULL,
      rounds_started INTEGER NOT NULL DEFAULT 0,
      max_goal_rounds INTEGER NOT NULL DEFAULT 20,
      blocked_reason TEXT NULL,
      created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`, []);
  await sql.execute(`CREATE UNIQUE INDEX uniq_xiaoni_goals_one_active
    ON xiaoni_goals (identity_key) WHERE phase = 'active'`, []);
  await sql.execute(`CREATE INDEX idx_xiaoni_goals_identity_phase_updated
    ON xiaoni_goals (identity_key, phase, updated_at DESC)`, []);
  await sql.execute(
    `INSERT INTO xiaoni_goals (id, identity_key, revision, objective, phase, rounds_started, max_goal_rounds)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['legacy_1', 'xiaoni', 3, '旧行的正文', 'completed', 7, 20]
  );

  await ensureXiaoniDeepDiveSchema(CFG);

  const gone = await sql.query("SELECT to_regclass('public.xiaoni_goals') AS t", []);
  assert.equal(gone[0].t, null, '旧表名必须已经不存在');

  const rows = await sql.query('SELECT * FROM xiaoni_deep_dives WHERE id = ?', ['legacy_1']);
  assert.equal(rows.length, 1, '旧行必须被带过来,不能是 DROP 再 CREATE');
  assert.equal(rows[0].question, '旧行的正文', 'objective 的值必须落在 question 上');
  assert.equal(Number(rows[0].max_rounds), 20, 'max_goal_rounds 的值必须落在 max_rounds 上');
  assert.equal(Number(rows[0].revision), 3, 'revision 不该被迁移动过');
  assert.equal(Number(rows[0].rounds_started), 7, 'rounds_started 不该被迁移动过');
  assert.equal(rows[0].phase, 'concluded', "phase 'completed' 必须迁成 'concluded'");

  const idx = await sql.query(
    "SELECT indexname FROM pg_indexes WHERE tablename = 'xiaoni_deep_dives' ORDER BY indexname", []);
  const names = idx.map((r) => r.indexname);
  assert.ok(names.includes('uniq_xiaoni_deep_dives_one_active'), `唯一索引没改名: ${names.join(',')}`);
  assert.ok(names.includes('idx_xiaoni_deep_dives_identity_phase_updated'), `复合索引没改名: ${names.join(',')}`);

  // 幂等:再跑一遍不许报错,也不许把已经迁好的表再动一次。
  await ensureXiaoniDeepDiveSchema(CFG);
  const again = await sql.query('SELECT COUNT(*)::int AS n FROM xiaoni_deep_dives', []);
  assert.equal(Number(again[0].n), 1, '第二次 ensure 不该改变行数');
});

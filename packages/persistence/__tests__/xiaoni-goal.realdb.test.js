'use strict';

// REAL-Postgres 回归:她自己立的目标(docs/specs/xiaoni-goal-tools.md §2)。
//
// 这一层守两条**存储**不变量,两条都只有真 PG 能验 —— 用 mock prisma 验等于验我自己写的 mock:
//   ① 同一 identity 最多一个 phase='active' —— 部分唯一索引(Prisma schema 表达不了 WHERE),
//      并发 create 时必须由 DB 拒绝第二个,而不是应用层「先查后写」(中间有窗口);
//   ② compare-and-set —— 她的 parallel_tool_calls 是开的,一次可能发多个 update_goal;
//      where 子句里漏掉 revision 的话,后发的会静默盖掉先发的,而且**单元测试看不出来**。
//
// 外加一条容易写反的语义:incrementXiaoniGoalRound 是引擎侧动作,**故意不动 revision**。
// 动了的话,她 get_goal 之后引擎恰好推进一轮就把她手上的 revision 作废,她会陷入
// 「读→改→被拒→再读」的循环。
//
// 与 agent-stack-event-id-dedup.realdb 同一套隔离 DB(qqbot_cache_test),不可达时干净跳过。

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSqlAdapter,
  ensureXiaoniGoalSchema,
  createXiaoniGoal,
  getActiveXiaoniGoal,
  getXiaoniGoalById,
  updateXiaoniGoal,
  incrementXiaoniGoalRound,
  listXiaoniGoals
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
    await ensureXiaoniGoalSchema(CFG);
    // 幂等性:ensure 是每次启动都跑的,跑两遍必须不报错、不重建。
    await ensureXiaoniGoalSchema(CFG);
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
    await sql.execute('TRUNCATE xiaoni_goals', []);
    await fn();
  });
}

dbTest('建表后能创建目标,初值就是 active / revision=1 / rounds=0', async () => {
  const goal = await createXiaoniGoal({ objective: '把 gorton 写到第 100 章' }, CFG);
  assert.equal(goal.phase, 'active');
  assert.equal(goal.revision, 1);
  assert.equal(goal.roundsStarted, 0);
  assert.equal(goal.maxGoalRounds, 20);
  assert.equal(goal.blockedReason, null);
  assert.equal(goal.objective, '把 gorton 写到第 100 章');

  const active = await getActiveXiaoniGoal({}, CFG);
  assert.equal(active.id, goal.id);
});

dbTest('不变量①:已有 active 时再创建 → DB 拒绝(部分唯一索引),不是应用层 if', async () => {
  await createXiaoniGoal({ objective: '第一件事' }, CFG);
  await assert.rejects(
    () => createXiaoniGoal({ objective: '第二件事' }, CFG),
    (error) => /Unique constraint|P2002/i.test(String(error && error.message)),
    '第二个 active 必须被唯一索引拒绝'
  );
  const rows = await listXiaoniGoals({}, CFG);
  assert.equal(rows.length, 1, '拒绝之后不许留下半条记录');
});

dbTest('不变量①:目标做完之后 active 位置腾出来,可以立新的', async () => {
  const first = await createXiaoniGoal({ objective: '第一件事' }, CFG);
  const done = await updateXiaoniGoal(
    { goalId: first.id, revision: first.revision, phase: 'completed' },
    CFG
  );
  assert.equal(done.ok, true);
  const second = await createXiaoniGoal({ objective: '第二件事' }, CFG);
  assert.equal(second.phase, 'active');
  assert.equal((await getActiveXiaoniGoal({}, CFG)).id, second.id);
});

dbTest('不变量②:revision 对不上 → ok:false + 回当前值,且一个字段都没被改', async () => {
  const goal = await createXiaoniGoal({ objective: '原始目标' }, CFG);
  const first = await updateXiaoniGoal(
    { goalId: goal.id, revision: goal.revision, phase: 'paused' },
    CFG
  );
  assert.equal(first.ok, true);
  assert.equal(first.goal.revision, 2);

  // 拿着过期的 revision=1 再改(模拟同一 turn 里并发发出的第二个 update_goal)
  const stale = await updateXiaoniGoal(
    { goalId: goal.id, revision: 1, phase: 'completed', objective: '被覆盖的目标' },
    CFG
  );
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'revision_mismatch');
  assert.equal(stale.goal.phase, 'paused', '陈旧写入不许生效');
  assert.equal(stale.goal.objective, '原始目标');
  assert.equal(stale.goal.revision, 2, '被拒绝的写入不许推进 revision');
});

dbTest('blocked_reason 只在 blocked 时留着,转出 blocked 立刻清掉', async () => {
  const goal = await createXiaoniGoal({ objective: '找到那个人' }, CFG);
  const blocked = await updateXiaoniGoal(
    {
      goalId: goal.id,
      revision: goal.revision,
      phase: 'blocked',
      blockedReason: 'grep 了十一次关键词,没有一次匹配到人名'
    },
    CFG
  );
  assert.equal(blocked.ok, true);
  assert.equal(blocked.goal.phase, 'blocked');
  assert.match(blocked.goal.blockedReason, /grep 了十一次/);

  const resumed = await updateXiaoniGoal(
    { goalId: goal.id, revision: blocked.goal.revision, phase: 'active' },
    CFG
  );
  assert.equal(resumed.ok, true);
  assert.equal(
    resumed.goal.blockedReason,
    null,
    '一条陈旧的卡住理由不许跟着一个 active 目标到处跑'
  );
});

dbTest('轮次推进:rounds_started +1,但 revision 一个都不动', async () => {
  const goal = await createXiaoniGoal({ objective: '读完 Howard' }, CFG);
  const afterOne = await incrementXiaoniGoalRound({ goalId: goal.id }, CFG);
  assert.equal(afterOne.roundsStarted, 1);
  assert.equal(
    afterOne.revision,
    goal.revision,
    'round 不是她 CAS 的对象;动了 revision 会让她手上的 revision 无故作废'
  );

  const afterTwo = await incrementXiaoniGoalRound({ goalId: goal.id }, CFG);
  assert.equal(afterTwo.roundsStarted, 2);
  assert.equal(afterTwo.revision, goal.revision);

  // 她此刻仍然可以用最初读到的 revision 去改 —— 这就是不动 revision 的意义
  const edited = await updateXiaoniGoal(
    { goalId: goal.id, revision: goal.revision, phase: 'active', objective: '读完 Howard 前六章' },
    CFG
  );
  assert.equal(edited.ok, true);
  assert.equal(edited.goal.objective, '读完 Howard 前六章');
  assert.equal(edited.goal.roundsStarted, 2, '改目标不该重置已经跑过的轮次');
});

dbTest('轮次推进只对 active 生效:目标已经收尾就记不上', async () => {
  const goal = await createXiaoniGoal({ objective: '一件事' }, CFG);
  const done = await updateXiaoniGoal(
    { goalId: goal.id, revision: goal.revision, phase: 'completed' },
    CFG
  );
  assert.equal(done.ok, true);
  assert.equal(await incrementXiaoniGoalRound({ goalId: goal.id }, CFG), null);
  assert.equal((await getXiaoniGoalById({ goalId: goal.id }, CFG)).roundsStarted, 0);
});

dbTest('参数校验:空 objective、非法 phase、缺 revision 都要当场拒绝', async () => {
  await assert.rejects(() => createXiaoniGoal({ objective: '   ' }, CFG), /objective/);
  const goal = await createXiaoniGoal({ objective: '正常目标' }, CFG);
  await assert.rejects(
    () => updateXiaoniGoal({ goalId: goal.id, revision: goal.revision, phase: 'done' }, CFG),
    /phase/
  );
  await assert.rejects(
    () => updateXiaoniGoal({ goalId: goal.id, phase: 'paused' }, CFG),
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
  for (const [goalId, text] of [['goal_a', '第一条'], ['goal_b', findings]]) {
    await logRuntimeTimelineEvent({
      traceId: `failure-review:${goalId}`,
      eventType: 'fork',
      eventName: 'failure_review_fork',
      eventPhase: 'completed',
      metadata: { goal_id: goalId, findings_text: text, delivered: true }
    }, CFG);
  }
  // 噪音:同一张表里别的事件不该被捞出来
  await logRuntimeTimelineEvent({
    traceId: 't', eventType: 'memory', eventName: 'core_memory_compressed', metadata: {}
  }, CFG);

  const rows = await listRuntimeTimelineEvents({ eventName: 'failure_review_fork', limit: 20 }, CFG);
  assert.equal(rows.length, 2, '只捞复核事件,别的事件不算');
  assert.equal(rows[0].metadata.goal_id, 'goal_b', '按时间倒序:最新的在前');
  assert.equal(rows[0].metadata.findings_text, findings, '证据原文逐字节保留,不许被摘要');
  assert.equal(rows[0].metadata.delivered, true);
});

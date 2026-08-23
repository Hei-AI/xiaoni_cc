'use strict';

// 她自己起的深挖的持久化层。
//
// 这一层是**机械的**:它只负责存、取、和保住两条存储不变量,不判断任何语义。
// 「这一轮算不算推进」「什么时候该 conclude」全部是她的判断,由 update_deep_dive 工具透传下来 ——
// 四家主流 harness 都不判定语义产出,理由见 docs/adr/0010-*。
//
// 两条存储不变量:
//   ① 同一 identity 最多一个 phase='active'  —— 部分唯一索引,不靠应用层 if
//   ② compare-and-set  —— 她的 parallel_tool_calls 是开的,可能一次发多个 update_deep_dive;
//      不带上读到的 revision 就改,后发的会静默盖掉先发的
//
// revision 的语义要点(容易写错):**只有她发起的 mutation 才 +1**。引擎侧的 round 计数
// 走 incrementXiaoniDeepDiveRound,故意不动 revision —— 否则她 get_deep_dive 拿到 revision 之后、
// 还没来得及 update_deep_dive,引擎恰好推进一轮就把她的 revision 作废了,她会陷入
// 「读→改→被拒→再读」的循环。round 不是她 CAS 的对象。
//
// 详见 docs/specs/xiaoni-deep-dive-tools.md §2。

const { randomUUID } = require('node:crypto');

const IDENTITY_KEY = 'xiaoni';
const PHASES = new Set(['active', 'paused', 'concluded', 'blocked']);
const DEFAULT_MAX_ROUNDS = 20;

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function normalizePhase(value) {
  const text = normalizeText(value);
  return text && PHASES.has(text) ? text : null;
}

function normalizePositiveInt(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const truncated = Math.trunc(numeric);
  return truncated > 0 ? truncated : fallback;
}

function normalizeDive(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    identityKey: String(row.identity_key),
    revision: Number(row.revision),
    question: typeof row.question === 'string' ? row.question : '',
    phase: String(row.phase),
    roundsStarted: Number(row.rounds_started),
    maxRounds: Number(row.max_rounds),
    blockedReason: typeof row.blocked_reason === 'string' && row.blocked_reason !== ''
      ? row.blocked_reason
      : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at ?? null,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ?? null
  };
}

function createXiaoniDeepDivePersistence({ getPrismaClient, createSqlAdapter }) {
  function getClient(config) {
    return getPrismaClient(config);
  }

  function resolveIdentityKey(input) {
    return normalizeText(input && (input.identityKey || input.identity_key)) || IDENTITY_KEY;
  }

  // 建表 + 从旧的 goal 命名迁移过来。
  //
  // 改名的理由:`goal` 在模型先验里就是「任务/待办」(CC 的 TodoWrite、codex 的 update_plan、
  // dsh 的 task-goal 都占这个词)。这套机制服务的业务目标是**深度探索/深度思考** —— 让她在
  // 一个问题上跨多轮往下扎,而不是记一件待办。活体证据:改名前唯一一次使用是 78 秒内
  // create → complete、rounds_started=0,当成了事后标签。见 docs/adr/0010-*。
  //
  // 迁移是**幂等重命名**,不是重建:上线半天只有 1 行数据,现在改代价最低。
  // 顺序要紧 —— 先 ALTER 老表,再 CREATE IF NOT EXISTS。反过来会先建一张空的新表,
  // 老表的行就永远留在旧名字下面了。
  async function ensureXiaoniDeepDiveSchema(config = {}) {
    const sql = createSqlAdapter(config);
    try {
      await sql.query("SELECT pg_advisory_lock(hashtext('qqbot_xiaoni_deep_dive_schema'))");

      // ① 老表在、新表不在 → 整体改名(含列、索引、phase 取值)。
      await sql.execute(`
        DO $$
        BEGIN
          IF to_regclass('public.xiaoni_goals') IS NOT NULL
             AND to_regclass('public.xiaoni_deep_dives') IS NULL THEN
            ALTER TABLE xiaoni_goals RENAME TO xiaoni_deep_dives;
            ALTER TABLE xiaoni_deep_dives RENAME COLUMN objective TO question;
            ALTER TABLE xiaoni_deep_dives RENAME COLUMN max_goal_rounds TO max_rounds;
            IF to_regclass('public.uniq_xiaoni_goals_one_active') IS NOT NULL THEN
              ALTER INDEX uniq_xiaoni_goals_one_active RENAME TO uniq_xiaoni_deep_dives_one_active;
            END IF;
            IF to_regclass('public.idx_xiaoni_goals_identity_phase_updated') IS NOT NULL THEN
              ALTER INDEX idx_xiaoni_goals_identity_phase_updated
                RENAME TO idx_xiaoni_deep_dives_identity_phase_updated;
            END IF;
          END IF;
        END $$;
      `);

      // ② phase 取值重映射。**独立成段,理由同③**:一个已经改过表名、但 phase 还没换的库
      // (比如①跑到一半失败、或有人手工改过表名)永远走不到①里面。UPDATE 本身幂等。
      await sql.execute(`
        DO $$
        BEGIN
          IF to_regclass('public.xiaoni_deep_dives') IS NOT NULL THEN
            UPDATE xiaoni_deep_dives SET phase = 'concluded' WHERE phase = 'completed';
          END IF;
        END $$;
      `);

      // ③ 主键约束改名。**必须自己一个 guard,不能嵌在①里面。**
      //
      // ① 的条件是「老表在 且 新表不在」—— 一个已经迁过表、但主键还没改的库(生产 2026-08-23
      // 就是这个状态:①跑过了,而当时①里还没有这一段)永远走不到①里面。第一版把它塞进①,
      // 上线后主键仍叫 xiaoni_goals_pkey,而迁移用例从「未迁移库」起跑、①恰好成立,所以全绿。
      // 拿一个恰好自洽的初始状态去验,验的是同义反复 —— 这个错本轮已经犯到第三次。
      //
      // 主键约束由 Postgres 按 表名_pkey 隐式命名,ALTER TABLE RENAME TO 不连带改它。漏掉的
      // 后果不是坏功能,是新库(建表时自动叫 xiaoni_deep_dives_pkey)与老库约束名分叉。
      // 注:这段在 JS 模板字符串里,注释内禁止出现反引号。
      await sql.execute(`
        DO $$
        BEGIN
          IF to_regclass('public.xiaoni_deep_dives') IS NULL THEN
            RETURN;
          END IF;
          -- 必须限定到**本表的**主键。按名字全局匹配的话,一旦两张表并存(比如有人重建过
          -- xiaoni_goals),这里会去改老表的主键、撞上已存在的新名,整个 ensure 在启动时抛。
          IF EXISTS (
            SELECT 1 FROM pg_index i
            JOIN pg_class c ON c.oid = i.indexrelid
            WHERE i.indrelid = 'public.xiaoni_deep_dives'::regclass
              AND i.indisprimary
              AND c.relname = 'xiaoni_goals_pkey'
          ) THEN
            ALTER INDEX xiaoni_goals_pkey RENAME TO xiaoni_deep_dives_pkey;
          END IF;
        END $$;
      `);

      // ④ 全新库走这条。
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS xiaoni_deep_dives (
          id VARCHAR(64) PRIMARY KEY,
          identity_key VARCHAR(64) NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1,
          question TEXT NOT NULL,
          phase VARCHAR(16) NOT NULL,
          rounds_started INTEGER NOT NULL DEFAULT 0,
          max_rounds INTEGER NOT NULL DEFAULT 20,
          blocked_reason TEXT NULL,
          created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      // 不变量①:同一 identity 最多一件在挖的。部分唯一索引 —— 并发 create 时由 DB 拒绝
      // 第二个,应用层不需要先查后写(那中间有窗口)。
      await sql.execute(`
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_xiaoni_deep_dives_one_active
        ON xiaoni_deep_dives (identity_key) WHERE phase = 'active'
      `);
      await sql.execute(`
        CREATE INDEX IF NOT EXISTS idx_xiaoni_deep_dives_identity_phase_updated
        ON xiaoni_deep_dives (identity_key, phase, updated_at DESC)
      `);
    } finally {
      await sql.query("SELECT pg_advisory_unlock(hashtext('qqbot_xiaoni_deep_dive_schema'))").catch(() => undefined);
      await sql.close();
    }
  }

  async function getActiveXiaoniDeepDive(input = {}, config = {}) {
    const prisma = getClient(config);
    const row = await prisma.xiaoniDeepDive.findFirst({
      where: { identity_key: resolveIdentityKey(input), phase: 'active' }
    });
    return normalizeDive(row);
  }

  async function getXiaoniDeepDiveById(input = {}, config = {}) {
    const diveId = normalizeText(input.diveId || input.deep_dive_id || input.id);
    if (!diveId) return null;
    const prisma = getClient(config);
    const row = await prisma.xiaoniDeepDive.findUnique({ where: { id: diveId } });
    return normalizeDive(row);
  }

  // 已有 active 时由部分唯一索引拒绝 —— 抛 Prisma P2002。调用方把它翻译成
  // 「你已经有一件在做的事」而不是内部错误。
  async function createXiaoniDeepDive(input = {}, config = {}) {
    const question = normalizeText(input.question);
    if (!question) {
      throw new Error('createXiaoniDeepDive requires a non-empty question');
    }
    const prisma = getClient(config);
    const row = await prisma.xiaoniDeepDive.create({
      data: {
        id: normalizeText(input.id) || `dive_${Date.now()}_${randomUUID().slice(0, 8)}`,
        identity_key: resolveIdentityKey(input),
        revision: 1,
        question,
        phase: 'active',
        rounds_started: 0,
        max_rounds: normalizePositiveInt(
          input.maxRounds ?? input.max_rounds,
          DEFAULT_MAX_ROUNDS
        ),
        blocked_reason: null
      }
    });
    return normalizeDive(row);
  }

  // compare-and-set。revision 不匹配 → 返回 { ok:false, dive:<当前值> },不抛。
  // 调用方把当前值回给她,她重读再改(这就是 dsh 的 read-before-update 契约)。
  //
  // 只改传进来的字段:phase 必给(它是这次 mutation 的意义),其余 undefined 表示不动。
  // blocked_reason 只有转 blocked 时才写;转出 blocked 时清空,免得一条陈旧的理由跟着
  // 一个 active 深挖到处跑。
  async function updateXiaoniDeepDive(input = {}, config = {}) {
    const diveId = normalizeText(input.diveId || input.deep_dive_id || input.id);
    const expectedRevision = Number(input.revision);
    const phase = normalizePhase(input.phase);
    if (!diveId) throw new Error('updateXiaoniDeepDive requires diveId');
    if (!Number.isInteger(expectedRevision)) throw new Error('updateXiaoniDeepDive requires an integer revision');
    if (!phase) throw new Error('updateXiaoniDeepDive requires a valid phase');

    const prisma = getClient(config);
    const question = normalizeText(input.question);
    const blockedReason = normalizeText(input.blockedReason || input.blocked_reason);
    const maxRounds = input.maxRounds ?? input.max_rounds;

    const data = {
      phase,
      revision: { increment: 1 }
    };
    // blocked_reason 的三态,别写成二态:
    //   ① 转出 blocked → 清空(一条陈旧的卡住理由不许跟着一个 active 目标到处跑)
    //   ② 仍是 blocked 且这次给了理由 → 覆盖
    //   ③ 仍是 blocked 但这次没给理由(比如对一个 blocked 目标做 edit) → **不动**
    // 写成 `phase === 'blocked' ? blockedReason : null` 会在 ③ 静默清掉理由,
    // 留下一个 phase=blocked 但没有理由的目标 —— 与建表注释里的不变量相悖。
    if (phase !== 'blocked') {
      data.blocked_reason = null;
    } else if (blockedReason !== null) {
      data.blocked_reason = blockedReason;
    }
    if (question !== null) data.question = question;
    if (maxRounds !== undefined && maxRounds !== null) {
      data.max_rounds = normalizePositiveInt(maxRounds, DEFAULT_MAX_ROUNDS);
    }

    const result = await prisma.xiaoniDeepDive.updateMany({
      where: { id: diveId, revision: expectedRevision },
      data
    });
    const current = await getXiaoniDeepDiveById({ diveId }, config);
    if (result.count === 0) {
      return { ok: false, reason: 'revision_mismatch', dive: current };
    }
    return { ok: true, dive: current };
  }

  // 引擎侧的轮次推进。**故意不动 revision**(理由见文件头)。
  // 只对 active 目标生效;返回 null 表示这一轮没被记上(目标已不是 active,或 id 不存在)。
  async function incrementXiaoniDeepDiveRound(input = {}, config = {}) {
    const diveId = normalizeText(input.diveId || input.deep_dive_id || input.id);
    if (!diveId) throw new Error('incrementXiaoniDeepDiveRound requires diveId');
    const prisma = getClient(config);
    const result = await prisma.xiaoniDeepDive.updateMany({
      where: { id: diveId, phase: 'active' },
      data: { rounds_started: { increment: 1 } }
    });
    if (result.count === 0) return null;
    return getXiaoniDeepDiveById({ diveId }, config);
  }

  // ── 复核 fork 的 slice 账本 ────────────────────────────────────────────────
  // **独立成表**,不写 subconscious_agent_fork_slices —— 那张表的读取端不按 fork_run_id
  // 前缀区分:usage rollup 整表当潜意识 fork 计费(xiaoni-agent-stack.js),行动流整表全选
  // (xiaoni-activity.js)。混进去会让复核的每一次(最多 32 轮 × 全量克隆)被算成、也被显示成
  // 潜意识 fork。先例是 psych_assessment_fork_slices,同样理由同样形状。
  // 列表口。**只给尺寸,不给正文** —— canonical_request / wire_request 每条都是主 agent
  // 上下文的完整克隆(几十万 token),列表里回吐它们会让响应到 GB 级。要看正文按单条取。
  //
  // diveIds 传进来时按这一次深挖过滤,不再靠「全局 top-N × 倍数」的启发式 —— 那种写法在
  // 某一次深挖的 slice 特别多时,会让更早的深挖静默拿到空数组,和「这次没产出」不可区分。
  // 列表口:**按 fork_run_id 分组,每次复核各自的 top-N**。
  //
  // 分组单元是 fork_run_id 而不是 deep_dive_id —— 这是前三轮反复没修对的地方。一次深挖可以
  // 反复 blocked,每次都是独立一跑;按 deep_dive 归组既会把多次复核的 slice 混成一堆,又拿不到
  // 硬上界(调用方只能拍「32 × 猜的复核次数」)。按 fork_run_id 归组,
  // FAILURE_REVIEW_FORK_MAX_TURNS = 32 就是**真上界**,不用猜。
  //
  // 走裸 SQL 而不是 Prisma,两个原因(都不是 ORM 能表达的):
  //   ① 正文只要尺寸。findMany 没法「取一列的长度但不取这一列」—— 四个大 JSONB 会整列
  //      从 PG 拉进 Node、反序列化成对象,再算完长度丢掉。响应是变小了,传输/解析/GC
  //      一分没省。octet_length(x::text) 让 PG 算完只回一个整数,而且是**真字节**
  //      (JS 的 .length 是 UTF-16 码元,中文会少算约 2/3,字段名叫 Bytes 就是错的)。
  //   ② 每组 top-N 要窗口函数。全局 top-N 下,某一次复核的 slice 特别多就会把别的复核
  //      挤出结果,页面上表现为「这次复核没产出」—— 与真的没产出不可区分。
  async function listFailureReviewForkSlices(input = {}, config = {}) {
    const prisma = getClient(config);
    const perForkLimit = normalizePositiveInt(input.limit, 50);
    const forkRunIds = Array.isArray(input.forkRunIds)
      ? input.forkRunIds.filter((id) => typeof id === 'string' && id !== '')
      : null;
    // 传了数组但过滤后为空 = 调用方要的是「这些 fork 的 slice」,而那个集合是空的。
    // 退回不过滤会把全部 slice 端上去,和「要空集」正好相反。
    if (Array.isArray(input.forkRunIds) && (!forkRunIds || forkRunIds.length === 0)) return [];
    const params = [resolveIdentityKey(input)];
    let forkFilter = '';
    if (forkRunIds && forkRunIds.length > 0) {
      forkFilter = `AND fork_run_id IN (${forkRunIds.map((_, i) => `$${i + 2}`).join(', ')})`;
      params.push(...forkRunIds);
    }
    params.push(perForkLimit);
    const rows = await prisma.$queryRawUnsafe(
      `
        SELECT id, slice_id, fork_run_id, deep_dive_id, status, agent_turn, token_usage,
               model_name, metadata, created_at,
               octet_length(canonical_request::text) AS canonical_request_bytes,
               octet_length(wire_request::text) AS wire_request_bytes
        FROM (
          SELECT *, ROW_NUMBER() OVER (
                      PARTITION BY fork_run_id ORDER BY created_at DESC, id DESC
                    ) AS rn
          FROM failure_review_fork_slices
          WHERE identity_key = $1 ${forkFilter}
        ) ranked
        WHERE rn <= $${params.length}
        ORDER BY created_at DESC, id DESC
      `,
      ...params
    );
    return rows.map((row) => ({
      id: Number(row.id),
      sliceId: row.slice_id,
      forkRunId: row.fork_run_id,
      diveId: row.deep_dive_id,
      status: row.status,
      agentTurn: row.agent_turn === null ? null : Number(row.agent_turn),
      tokenUsage: row.token_usage,
      modelName: row.model_name,
      // 正文要看就按 sliceId 单条取(canonical_request 是完整上下文克隆,几十万 token)。
      canonicalRequestBytes: Number(row.canonical_request_bytes || 0),
      wireRequestBytes: Number(row.wire_request_bytes || 0),
      metadata: row.metadata,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
    }));
  }

  // 她 get_deep_dive 时该看到的那一件。
  //
  // **不是** getActiveXiaoniDeepDive —— 那个只认 active。只认 active 的话,paused / blocked 的
  // 她**永远拿不到 dive_id 和 revision**,而 update_deep_dive 必须带这两个;
  // 于是 resume 结构性不可达、pause 等于永久放弃、blocked 之后她也再看不到自己写的
  // blocked_reason。spec 的 action 集合里有 resume,就必须能读到 paused 的那件。
  //
  // 顺序:先 active(同一时刻至多一件,存储层的部分唯一索引保证),没有再取最近动过的
  // 未收口那个。concluded 不回 —— 收掉了就是收掉了,不该再摆到她眼前。
  async function getCurrentXiaoniDeepDive(input = {}, config = {}) {
    const active = await getActiveXiaoniDeepDive(input, config);
    if (active) return active;
    const prisma = getClient(config);
    const row = await prisma.xiaoniDeepDive.findFirst({
      where: { identity_key: resolveIdentityKey(input), phase: { not: 'concluded' } },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }]
    });
    return normalizeDive(row);
  }

  async function listXiaoniDeepDives(input = {}, config = {}) {
    const prisma = getClient(config);
    const limit = normalizePositiveInt(input.limit, 20);
    const rows = await prisma.xiaoniDeepDive.findMany({
      where: { identity_key: resolveIdentityKey(input) },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
      take: limit
    });
    return rows.map(normalizeDive).filter(Boolean);
  }

  return {
    ensureXiaoniDeepDiveSchema,
    listFailureReviewForkSlices,
    getActiveXiaoniDeepDive,
    getCurrentXiaoniDeepDive,
    getXiaoniDeepDiveById,
    createXiaoniDeepDive,
    updateXiaoniDeepDive,
    incrementXiaoniDeepDiveRound,
    listXiaoniDeepDives
  };
}

module.exports = {
  createXiaoniDeepDivePersistence,
  XIAONI_DEEP_DIVE_PHASES: PHASES,
  XIAONI_DEEP_DIVE_DEFAULT_MAX_ROUNDS: DEFAULT_MAX_ROUNDS
};

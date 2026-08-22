'use strict';

// 她自己立的目标的持久化层。
//
// 这一层是**机械的**:它只负责存、取、和保住两条存储不变量,不判断任何语义。
// 「这一轮算不算推进」「什么时候该 complete」全部是她的判断,由 update_goal 工具透传下来 ——
// 四家主流 harness 都不判定语义产出,理由见 docs/adr/0010-*。
//
// 两条存储不变量:
//   ① 同一 identity 最多一个 phase='active'  —— 部分唯一索引,不靠应用层 if
//   ② compare-and-set  —— 她的 parallel_tool_calls 是开的,可能一次发多个 update_goal;
//      不带上读到的 revision 就改,后发的会静默盖掉先发的
//
// revision 的语义要点(容易写错):**只有她发起的 mutation 才 +1**。引擎侧的 round 计数
// 走 incrementXiaoniGoalRound,故意不动 revision —— 否则她 get_goal 拿到 revision 之后、
// 还没来得及 update_goal,引擎恰好推进一轮就把她的 revision 作废了,她会陷入
// 「读→改→被拒→再读」的循环。round 不是她 CAS 的对象。
//
// 详见 docs/specs/xiaoni-goal-tools.md §2。

const { randomUUID } = require('node:crypto');

const IDENTITY_KEY = 'xiaoni';
const PHASES = new Set(['active', 'paused', 'completed', 'blocked']);
const DEFAULT_MAX_GOAL_ROUNDS = 20;

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

function normalizeGoal(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    identityKey: String(row.identity_key),
    revision: Number(row.revision),
    objective: typeof row.objective === 'string' ? row.objective : '',
    phase: String(row.phase),
    roundsStarted: Number(row.rounds_started),
    maxGoalRounds: Number(row.max_goal_rounds),
    blockedReason: typeof row.blocked_reason === 'string' && row.blocked_reason !== ''
      ? row.blocked_reason
      : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at ?? null,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ?? null
  };
}

function createXiaoniGoalPersistence({ getPrismaClient, createSqlAdapter }) {
  function getClient(config) {
    return getPrismaClient(config);
  }

  function resolveIdentityKey(input) {
    return normalizeText(input && (input.identityKey || input.identity_key)) || IDENTITY_KEY;
  }

  async function ensureXiaoniGoalSchema(config = {}) {
    const sql = createSqlAdapter(config);
    try {
      await sql.query("SELECT pg_advisory_lock(hashtext('qqbot_xiaoni_goal_schema'))");
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS xiaoni_goals (
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
        )
      `);
      // 不变量①:同一 identity 最多一个 active。部分唯一索引 —— 并发 create 时由 DB 拒绝
      // 第二个,应用层不需要先查后写(那中间有窗口)。
      await sql.execute(`
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_xiaoni_goals_one_active
        ON xiaoni_goals (identity_key) WHERE phase = 'active'
      `);
      await sql.execute(`
        CREATE INDEX IF NOT EXISTS idx_xiaoni_goals_identity_phase_updated
        ON xiaoni_goals (identity_key, phase, updated_at DESC)
      `);
    } finally {
      await sql.query("SELECT pg_advisory_unlock(hashtext('qqbot_xiaoni_goal_schema'))").catch(() => undefined);
      await sql.close();
    }
  }

  async function getActiveXiaoniGoal(input = {}, config = {}) {
    const prisma = getClient(config);
    const row = await prisma.xiaoniGoal.findFirst({
      where: { identity_key: resolveIdentityKey(input), phase: 'active' }
    });
    return normalizeGoal(row);
  }

  async function getXiaoniGoalById(input = {}, config = {}) {
    const goalId = normalizeText(input.goalId || input.goal_id || input.id);
    if (!goalId) return null;
    const prisma = getClient(config);
    const row = await prisma.xiaoniGoal.findUnique({ where: { id: goalId } });
    return normalizeGoal(row);
  }

  // 已有 active 时由部分唯一索引拒绝 —— 抛 Prisma P2002。调用方把它翻译成
  // 「你已经有一件在做的事」而不是内部错误。
  async function createXiaoniGoal(input = {}, config = {}) {
    const objective = normalizeText(input.objective);
    if (!objective) {
      throw new Error('createXiaoniGoal requires a non-empty objective');
    }
    const prisma = getClient(config);
    const row = await prisma.xiaoniGoal.create({
      data: {
        id: normalizeText(input.id) || `goal_${Date.now()}_${randomUUID().slice(0, 8)}`,
        identity_key: resolveIdentityKey(input),
        revision: 1,
        objective,
        phase: 'active',
        rounds_started: 0,
        max_goal_rounds: normalizePositiveInt(
          input.maxGoalRounds ?? input.max_goal_rounds,
          DEFAULT_MAX_GOAL_ROUNDS
        ),
        blocked_reason: null
      }
    });
    return normalizeGoal(row);
  }

  // compare-and-set。revision 不匹配 → 返回 { ok:false, goal:<当前值> },不抛。
  // 调用方把当前值回给她,她重读再改(这就是 dsh 的 read-before-update 契约)。
  //
  // 只改传进来的字段:phase 必给(它是这次 mutation 的意义),其余 undefined 表示不动。
  // blocked_reason 只有转 blocked 时才写;转出 blocked 时清空,免得一条陈旧的理由跟着
  // 一个 active 目标到处跑。
  async function updateXiaoniGoal(input = {}, config = {}) {
    const goalId = normalizeText(input.goalId || input.goal_id || input.id);
    const expectedRevision = Number(input.revision);
    const phase = normalizePhase(input.phase);
    if (!goalId) throw new Error('updateXiaoniGoal requires goalId');
    if (!Number.isInteger(expectedRevision)) throw new Error('updateXiaoniGoal requires an integer revision');
    if (!phase) throw new Error('updateXiaoniGoal requires a valid phase');

    const prisma = getClient(config);
    const objective = normalizeText(input.objective);
    const blockedReason = normalizeText(input.blockedReason || input.blocked_reason);
    const maxGoalRounds = input.maxGoalRounds ?? input.max_goal_rounds;

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
    if (objective !== null) data.objective = objective;
    if (maxGoalRounds !== undefined && maxGoalRounds !== null) {
      data.max_goal_rounds = normalizePositiveInt(maxGoalRounds, DEFAULT_MAX_GOAL_ROUNDS);
    }

    const result = await prisma.xiaoniGoal.updateMany({
      where: { id: goalId, revision: expectedRevision },
      data
    });
    const current = await getXiaoniGoalById({ goalId }, config);
    if (result.count === 0) {
      return { ok: false, reason: 'revision_mismatch', goal: current };
    }
    return { ok: true, goal: current };
  }

  // 引擎侧的轮次推进。**故意不动 revision**(理由见文件头)。
  // 只对 active 目标生效;返回 null 表示这一轮没被记上(目标已不是 active,或 id 不存在)。
  async function incrementXiaoniGoalRound(input = {}, config = {}) {
    const goalId = normalizeText(input.goalId || input.goal_id || input.id);
    if (!goalId) throw new Error('incrementXiaoniGoalRound requires goalId');
    const prisma = getClient(config);
    const result = await prisma.xiaoniGoal.updateMany({
      where: { id: goalId, phase: 'active' },
      data: { rounds_started: { increment: 1 } }
    });
    if (result.count === 0) return null;
    return getXiaoniGoalById({ goalId }, config);
  }

  // ── 复核 fork 的 slice 账本 ────────────────────────────────────────────────
  // **独立成表**,不写 subconscious_agent_fork_slices —— 那张表的读取端不按 fork_run_id
  // 前缀区分:usage rollup 整表当潜意识 fork 计费(xiaoni-agent-stack.js),行动流整表全选
  // (xiaoni-activity.js)。混进去会让复核的每一次(最多 32 轮 × 全量克隆)被算成、也被显示成
  // 潜意识 fork。先例是 psych_assessment_fork_slices,同样理由同样形状。
  // 列表口。**只给尺寸,不给正文** —— canonical_request / wire_request 每条都是主 agent
  // 上下文的完整克隆(几十万 token),列表里回吐它们会让响应到 GB 级。要看正文按单条取。
  //
  // goalIds 传进来时按 goal 过滤,不再靠「全局 top-N × 倍数」的启发式 —— 那种写法在
  // 某个 goal 的 slice 特别多时,会让更早的 goal 静默拿到空数组,和「这次没产出」不可区分。
  async function listFailureReviewForkSlices(input = {}, config = {}) {
    const prisma = getClient(config);
    const limit = normalizePositiveInt(input.limit, 50);
    const goalIds = Array.isArray(input.goalIds)
      ? input.goalIds.filter((id) => typeof id === 'string' && id !== '')
      : null;
    const rows = await prisma.failureReviewForkSlice.findMany({
      where: {
        identity_key: resolveIdentityKey(input),
        ...(goalIds && goalIds.length > 0 ? { goal_id: { in: goalIds } } : {})
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit
    });
    return rows.map((row) => ({
      id: Number(row.id),
      sliceId: row.slice_id,
      forkRunId: row.fork_run_id,
      goalId: row.goal_id,
      status: row.status,
      agentTurn: row.agent_turn,
      tokenUsage: row.token_usage,
      modelName: row.model_name,
      // 只给尺寸。正文要看就按 sliceId 单条取(canonical_request 是完整上下文克隆)。
      canonicalRequestBytes: row.canonical_request ? JSON.stringify(row.canonical_request).length : 0,
      wireRequestBytes: row.wire_request ? JSON.stringify(row.wire_request).length : 0,
      metadata: row.metadata,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
    }));
  }

  async function listXiaoniGoals(input = {}, config = {}) {
    const prisma = getClient(config);
    const limit = normalizePositiveInt(input.limit, 20);
    const rows = await prisma.xiaoniGoal.findMany({
      where: { identity_key: resolveIdentityKey(input) },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
      take: limit
    });
    return rows.map(normalizeGoal).filter(Boolean);
  }

  return {
    ensureXiaoniGoalSchema,
    listFailureReviewForkSlices,
    getActiveXiaoniGoal,
    getXiaoniGoalById,
    createXiaoniGoal,
    updateXiaoniGoal,
    incrementXiaoniGoalRound,
    listXiaoniGoals
  };
}

module.exports = {
  createXiaoniGoalPersistence,
  XIAONI_GOAL_PHASES: PHASES,
  XIAONI_GOAL_DEFAULT_MAX_ROUNDS: DEFAULT_MAX_GOAL_ROUNDS
};

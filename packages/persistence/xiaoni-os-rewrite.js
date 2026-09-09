'use strict';

// xiaoni_os 改写腿的留痕表。
//
// 每次主 agent 产出 assistant type:text(= 她的 xiaoni_os),引擎在 turn 末先用小模型判
// 「有没有事」(事实观察 / 进度 / 信息缺口 / 下一步),有事原样准入;判为等待/空转/不想动的,
// 再用小模型改写成她自己口气的、朝外走的版本,改写结果替换原文进入下一次上下文。
// 见 docs/specs/xiaoni-os-rewrite.md。
//
// 这张表存两件事:
//   ① 可观测:每一 turn 的 原文 / 判定 / 改写 / 最终去向(kept / polished / rewritten / evicted / failed_open;
//      polished = 判有事但夹着填充句,润色后准入;rewrite_stage 记第二腿是润色还是改写,rewrite_retries 记为去残留填充句多发的纠正次数),
//      以及两次小模型请求的 llm_call_id —— 那是把这行和 provider_usage_events 里的
//      wire request/response、token 接起来的唯一键。
//   ② 训练集:原文 + 判定 就是将来分类器的标注对;原文 + 改写 是改写器的标注对。
//      v1 两条腿都是 Haiku 顶着,数据攒够再训。
//
// 这里是**机械的**:只存、只取,不判断语义。改写腿走 provider-service 的 /api/internal/llm/debug,
// 是独立小请求、不克隆主请求,所以本表与缓存前缀 / stack replay 无关。

const IDENTITY_KEY = 'xiaoni';
const OUTCOMES = new Set(['kept', 'polished', 'rewritten', 'evicted', 'failed_open']);
const REWRITE_STAGES = new Set(['polish', 'rewrite', 'fill']);
const VERDICTS = new Set(['action', 'idle', 'unparsed', 'failed']);

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function normalizeEnum(value, allowed, fallback) {
  const text = normalizeText(value);
  return text && allowed.has(text) ? text : fallback;
}

function firstString(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return null;
}

function createXiaoniOsRewritePersistence({ createSqlAdapter }) {
  function resolveSql(input, config) {
    if (input && input.sqlAdapter) {
      return { sql: input.sqlAdapter, shouldClose: false };
    }
    return { sql: createSqlAdapter(config), shouldClose: true };
  }

  async function withSql(input, config, fn) {
    const { sql, shouldClose } = resolveSql(input, config);
    try {
      return await fn(sql);
    } finally {
      if (shouldClose) {
        await sql.close();
      }
    }
  }

  async function ensureXiaoniOsRewriteSchema(config = {}) {
    const sql = createSqlAdapter(config);
    try {
      await sql.query("SELECT pg_advisory_lock(hashtext('qqbot_xiaoni_os_rewrite_schema'))");
      await sql.execute(`
        CREATE TABLE IF NOT EXISTS xiaoni_os_rewrites (
          id BIGSERIAL PRIMARY KEY,
          identity_key VARCHAR(64) NOT NULL DEFAULT 'xiaoni',
          trace_id VARCHAR(191) NULL,
          run_id VARCHAR(191) NULL,
          agent_turn INTEGER NULL,
          slice_id VARCHAR(191) NULL,
          original_text TEXT NOT NULL,
          classify_verdict VARCHAR(32) NOT NULL,
          classify_raw TEXT NULL,
          classify_llm_call_id VARCHAR(191) NULL,
          classify_model VARCHAR(191) NULL,
          rewritten_text TEXT NULL,
          rewrite_llm_call_id VARCHAR(191) NULL,
          rewrite_model VARCHAR(191) NULL,
          outcome VARCHAR(32) NOT NULL,
          error_message TEXT NULL,
          processing_time_ms INTEGER NULL,
          created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      // 潜意识填充 fork(rewrite_stage = fill)的 fork run id,接 subconscious_agent_fork_runs。老行为 NULL。
      await sql.execute('ALTER TABLE xiaoni_os_rewrites ADD COLUMN IF NOT EXISTS fill_fork_run_id VARCHAR(191) NULL');
      // 2026-08-28:润色腿。老表加列(幂等)。
      await sql.execute('ALTER TABLE xiaoni_os_rewrites ADD COLUMN IF NOT EXISTS rewrite_stage VARCHAR(16) NULL');
      await sql.execute('ALTER TABLE xiaoni_os_rewrites ADD COLUMN IF NOT EXISTS rewrite_retries INTEGER NOT NULL DEFAULT 0');
      await sql.execute(`
        CREATE INDEX IF NOT EXISTS idx_xiaoni_os_rewrites_trace
        ON xiaoni_os_rewrites (trace_id, id)
      `);
      await sql.execute(`
        CREATE INDEX IF NOT EXISTS idx_xiaoni_os_rewrites_identity_time
        ON xiaoni_os_rewrites (identity_key, created_at DESC, id DESC)
      `);
      await sql.execute(`
        CREATE INDEX IF NOT EXISTS idx_xiaoni_os_rewrites_outcome_time
        ON xiaoni_os_rewrites (outcome, created_at DESC)
      `);
    } finally {
      await sql.query("SELECT pg_advisory_unlock(hashtext('qqbot_xiaoni_os_rewrite_schema'))").catch(() => undefined);
      await sql.close();
    }
  }

  async function recordXiaoniOsRewrite(input = {}, config = {}) {
    const originalText = typeof input.originalText === 'string'
      ? input.originalText
      : typeof input.original_text === 'string' ? input.original_text : null;
    if (originalText === null) {
      throw new Error('recordXiaoniOsRewrite requires originalText');
    }
    const outcome = normalizeEnum(input.outcome, OUTCOMES, null);
    if (!outcome) {
      throw new Error(`recordXiaoniOsRewrite requires outcome in ${[...OUTCOMES].join('/')}`);
    }
    const classifyVerdict = normalizeEnum(input.classifyVerdict ?? input.classify_verdict, VERDICTS, 'failed');
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          INSERT INTO xiaoni_os_rewrites (
            identity_key,
            trace_id,
            run_id,
            agent_turn,
            slice_id,
            original_text,
            classify_verdict,
            classify_raw,
            classify_llm_call_id,
            classify_model,
            rewritten_text,
            rewrite_llm_call_id,
            rewrite_model,
            rewrite_stage,
            rewrite_retries,
            outcome,
            error_message,
            processing_time_ms,
            fill_fork_run_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING *
        `,
        [
          firstString(input.identityKey, input.identity_key, IDENTITY_KEY),
          firstString(input.traceId, input.trace_id),
          firstString(input.runId, input.run_id),
          normalizeInteger(input.agentTurn ?? input.agent_turn),
          firstString(input.sliceId, input.slice_id),
          originalText,
          classifyVerdict,
          typeof input.classifyRaw === 'string' ? input.classifyRaw
            : typeof input.classify_raw === 'string' ? input.classify_raw : null,
          firstString(input.classifyLlmCallId, input.classify_llm_call_id),
          firstString(input.classifyModel, input.classify_model),
          typeof input.rewrittenText === 'string' ? input.rewrittenText
            : typeof input.rewritten_text === 'string' ? input.rewritten_text : null,
          firstString(input.rewriteLlmCallId, input.rewrite_llm_call_id),
          firstString(input.rewriteModel, input.rewrite_model),
          normalizeEnum(input.rewriteStage ?? input.rewrite_stage, REWRITE_STAGES, null),
          normalizeInteger(input.rewriteRetries ?? input.rewrite_retries) ?? 0,
          outcome,
          firstString(input.errorMessage, input.error_message),
          normalizeInteger(input.processingTimeMs ?? input.processing_time_ms),
          firstString(input.fillForkRunId, input.fill_fork_run_id)
        ]
      );
      return rows[0] || null;
    });
  }

  // 观察用:最近 N 条(默认 50),可按 outcome 过滤。
  async function listXiaoniOsRewrites(input = {}, config = {}) {
    const limit = Math.min(500, Math.max(1, normalizeInteger(input.limit) || 50));
    const outcome = normalizeEnum(input.outcome, OUTCOMES, null);
    return withSql(input, config, async (sql) => sql.query(
      `
        SELECT * FROM xiaoni_os_rewrites
        WHERE identity_key = ?
          ${outcome ? 'AND outcome = ?' : ''}
        ORDER BY id DESC
        LIMIT ?
      `,
      outcome
        ? [firstString(input.identityKey, input.identity_key, IDENTITY_KEY), outcome, limit]
        : [firstString(input.identityKey, input.identity_key, IDENTITY_KEY), limit]
    ));
  }

  // 观察用:时间窗内按 (classify_verdict, outcome) 计数 —— 投递健康度面板那种「别让一条腿静默死掉」
  // 的最小看板。sinceHours 默认 24。
  async function summarizeXiaoniOsRewrites(input = {}, config = {}) {
    const sinceHours = Math.max(1, normalizeInteger(input.sinceHours ?? input.since_hours) || 24);
    return withSql(input, config, async (sql) => sql.query(
      `
        SELECT classify_verdict, outcome, COUNT(*)::int AS count,
               AVG(processing_time_ms)::int AS avg_processing_time_ms
        FROM xiaoni_os_rewrites
        WHERE identity_key = ?
          AND created_at >= NOW() - (? * INTERVAL '1 hour')
        GROUP BY classify_verdict, outcome
        ORDER BY classify_verdict, outcome
      `,
      [firstString(input.identityKey, input.identity_key, IDENTITY_KEY), sinceHours]
    ));
  }

  return {
    ensureXiaoniOsRewriteSchema,
    recordXiaoniOsRewrite,
    listXiaoniOsRewrites,
    summarizeXiaoniOsRewrites
  };
}

module.exports = {
  createXiaoniOsRewritePersistence,
  XIAONI_OS_REWRITE_OUTCOMES: OUTCOMES,
  XIAONI_OS_REWRITE_VERDICTS: VERDICTS
};

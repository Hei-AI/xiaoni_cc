'use strict';

// CC subscription (Claude Code OAuth) usage — read-only观测层。
//
// 事实来源：每次走订阅端点 (api.anthropic.com/v1/messages?beta=true) 的响应，
// provider-service 都会把完整响应头落进 llm_request_slices.metadata.provider_response_headers。
// Anthropic 在这些头里直接回了真实额度（不是估算）：
//
//   anthropic-ratelimit-unified-5h-utilization  0..1   5 小时滚动窗口已用比例
//   anthropic-ratelimit-unified-5h-reset        epoch  窗口重置时刻（秒）
//   anthropic-ratelimit-unified-5h-status       allowed | allowed_warning | rejected
//   anthropic-ratelimit-unified-7d-utilization  0..1   周窗口已用比例
//   anthropic-ratelimit-unified-7d-reset        epoch  周窗口重置时刻（秒）
//   anthropic-ratelimit-unified-7d-status       同上
//   anthropic-ratelimit-unified-status          整体状态
//   anthropic-ratelimit-unified-fallback-percentage
//   anthropic-ratelimit-unified-overage-status / -overage-disabled-reason
//
// 「剩余」= 1 - utilization。额度只在我们发请求时刷新，所以快照是「截至最后一次
// LLM 调用」的值，capturedAt 必须随数据一起返回，UI 标注 as-of，不能假装实时。

const HEADERS_PATH = "metadata->'provider_response_headers'";
const DEFAULT_PROVIDER = 'anthropic';
const UTILIZATION_KEY = 'anthropic-ratelimit-unified-5h-utilization';
const DEFAULT_TIMELINE_LIMIT = 1000;
const MAX_TIMELINE_LIMIT = 4000;
const DEFAULT_TIMELINE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function header(headers, key) {
  if (!headers || typeof headers !== 'object') {
    return null;
  }
  const value = headers[key];
  return typeof value === 'undefined' || value === null ? null : value;
}

function parseFloatOrNull(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clampFraction(value) {
  if (value === null) {
    return null;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

// 重置时间戳是 epoch 秒；个别实现可能给毫秒，> 1e12 视为毫秒。
function epochToIso(value) {
  const num = parseFloatOrNull(value);
  if (num === null || num <= 0) {
    return null;
  }
  const ms = num < 1e12 ? num * 1000 : num;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeHeadersObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeIso(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === 'string' ? value : String(value);
}

function buildWindow(headers, prefix) {
  const utilization = clampFraction(parseFloatOrNull(header(headers, `anthropic-ratelimit-unified-${prefix}-utilization`)));
  const remaining = utilization === null ? null : Math.max(0, 1 - utilization);
  const resetEpoch = parseFloatOrNull(header(headers, `anthropic-ratelimit-unified-${prefix}-reset`));
  return {
    utilization,
    remaining,
    status: header(headers, `anthropic-ratelimit-unified-${prefix}-status`),
    resetEpoch,
    resetAt: epochToIso(resetEpoch),
  };
}

function createCcUsagePersistence({ createSqlAdapter, sqlAdapter } = {}) {
  function createSql(input = {}, config = {}) {
    if (input?.sqlAdapter) {
      return { sql: input.sqlAdapter, shouldClose: false };
    }
    if (sqlAdapter) {
      return { sql: sqlAdapter, shouldClose: false };
    }
    if (typeof createSqlAdapter !== 'function') {
      throw new Error('cc-usage SQL operations require createSqlAdapter');
    }
    return { sql: createSqlAdapter(config), shouldClose: true };
  }

  async function withSql(input, config, callback) {
    const { sql, shouldClose } = createSql(input, config);
    try {
      return await callback(sql);
    } finally {
      if (shouldClose) {
        await sql.close();
      }
    }
  }

  // 最新一次带 unified 头的订阅请求 → 当前额度快照。无数据返回 null。
  async function getCcSubscriptionQuotaSnapshot(input = {}, config = {}) {
    const provider = typeof input.provider === 'string' && input.provider.trim() ? input.provider.trim() : DEFAULT_PROVIDER;
    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          SELECT
            created_at AS captured_at,
            model_name,
            ${HEADERS_PATH} AS headers
          FROM llm_request_slices
          WHERE model_provider = ?
            AND ${HEADERS_PATH}->>'${UTILIZATION_KEY}' IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [provider]
      );
      const row = rows[0];
      if (!row) {
        return null;
      }
      const headers = normalizeHeadersObject(row.headers);
      if (!headers) {
        return null;
      }
      return {
        provider,
        capturedAt: normalizeIso(row.captured_at),
        modelName: row.model_name || null,
        status: header(headers, 'anthropic-ratelimit-unified-status'),
        resetAt: epochToIso(header(headers, 'anthropic-ratelimit-unified-reset')),
        fallbackPercentage: parseFloatOrNull(header(headers, 'anthropic-ratelimit-unified-fallback-percentage')),
        overageStatus: header(headers, 'anthropic-ratelimit-unified-overage-status'),
        overageDisabledReason: header(headers, 'anthropic-ratelimit-unified-overage-disabled-reason'),
        organizationId: header(headers, 'anthropic-organization-id'),
        windows: {
          fiveHour: buildWindow(headers, '5h'),
          weekly: buildWindow(headers, '7d'),
        },
      };
    });
  }

  // utilization 随时间序列（5h / 周）。无数据返回空 points。
  async function getCcSubscriptionQuotaTimeline(input = {}, config = {}) {
    const provider = typeof input.provider === 'string' && input.provider.trim() ? input.provider.trim() : DEFAULT_PROVIDER;
    const now = Date.now();
    const startTime = normalizeIso(input.startTime)
      || new Date(now - DEFAULT_TIMELINE_WINDOW_MS).toISOString();
    const endTime = normalizeIso(input.endTime) || new Date(now).toISOString();
    const requestedLimit = Number.parseInt(String(input.limit ?? DEFAULT_TIMELINE_LIMIT), 10);
    const limit = Math.max(
      1,
      Math.min(Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_TIMELINE_LIMIT, MAX_TIMELINE_LIMIT)
    );

    return withSql(input, config, async (sql) => {
      const rows = await sql.query(
        `
          SELECT
            created_at AS timestamp,
            (${HEADERS_PATH}->>'anthropic-ratelimit-unified-5h-utilization')::float8 AS util_5h,
            (${HEADERS_PATH}->>'anthropic-ratelimit-unified-7d-utilization')::float8 AS util_7d,
            ${HEADERS_PATH}->>'anthropic-ratelimit-unified-5h-status' AS status_5h,
            ${HEADERS_PATH}->>'anthropic-ratelimit-unified-7d-status' AS status_7d
          FROM llm_request_slices
          WHERE model_provider = ?
            AND ${HEADERS_PATH}->>'${UTILIZATION_KEY}' IS NOT NULL
            AND created_at >= ?::timestamptz
            AND created_at <= ?::timestamptz
          ORDER BY created_at ASC
          LIMIT ?
        `,
        [provider, startTime, endTime, limit]
      );
      const points = rows.map((row) => ({
        timestamp: normalizeIso(row.timestamp),
        util5h: clampFraction(parseFloatOrNull(row.util_5h)),
        util7d: clampFraction(parseFloatOrNull(row.util_7d)),
        status5h: row.status_5h || null,
        status7d: row.status_7d || null,
      }));
      return {
        provider,
        generatedAt: new Date(now).toISOString(),
        window: { startTime, endTime },
        limit,
        truncated: points.length >= limit,
        points,
      };
    });
  }

  return {
    getCcSubscriptionQuotaSnapshot,
    getCcSubscriptionQuotaTimeline,
  };
}

module.exports = {
  createCcUsagePersistence,
};

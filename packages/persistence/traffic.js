'use strict';

const {
  parseInstantValue,
  serializeTimestampForApi,
  serializeTimestampForStorage,
  normalizeTimestampField,
} = require('./time');

function normalizeValue(key, value) {
  if (value instanceof Date) {
    return serializeTimestampForApi(value);
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (value && typeof value.toNumber === 'function') {
    return value.toNumber();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(key, item));
  }
  if (value && typeof value === 'object') {
    const normalized = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      normalized[key] = normalizeValue(key, nestedValue);
    }
    return normalized;
  }
  return normalizeTimestampField(key, value);
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') {
    return record;
  }
  const normalized = {};
  for (const [key, value] of Object.entries(record)) {
    normalized[key] = normalizeValue(key, value);
  }
  return normalized;
}

function toBigIntId(value) {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    return BigInt(Math.trunc(value));
  }
  return BigInt(String(value));
}

function toDateValue(value) {
  return parseInstantValue(value);
}

function toOptionalBigIntId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  try {
    return toBigIntId(value);
  } catch (_error) {
    return null;
  }
}

function toIntegerValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : null;
}

function toBigIntValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numericValue = typeof value === 'bigint'
    ? value
    : typeof value === 'number'
      ? Math.trunc(value)
      : Number(String(value).trim());

  if (typeof numericValue === 'bigint') {
    return numericValue;
  }
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return BigInt(Math.trunc(numericValue));
}

function parseJsonValue(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return fallback;
    }
  }
  if (typeof value === 'object') {
    return value;
  }
  return fallback;
}

function createTrafficPersistence({ getPrismaClient, Prisma }) {
  let replaySchemaReady = null;

  function joinConditions(conditions) {
    if (!conditions.length) {
      return { where: Prisma.empty, hasConditions: false };
    }
    return {
      where: Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`,
      hasConditions: true
    };
  }

  function buildTrafficWhere(filters = {}) {
    const conditions = [];
    const startTime = toDateValue(filters.startTime);
    const endTime = toDateValue(filters.endTime);

    if (startTime) {
      conditions.push(Prisma.sql`request_timestamp >= ${serializeTimestampForStorage(startTime)}`);
    }
    if (endTime) {
      conditions.push(Prisma.sql`request_timestamp <= ${serializeTimestampForStorage(endTime)}`);
    }
    if (filters.method) {
      conditions.push(Prisma.sql`method = ${filters.method}`);
    }
    if (filters.host) {
      conditions.push(Prisma.sql`host ILIKE ${`%${filters.host}%`}`);
    }
    if (filters.status !== undefined && filters.status !== null && filters.status !== '') {
      conditions.push(Prisma.sql`response_status = ${Number(filters.status)}`);
    }
    if (typeof filters.isAiRequest === 'boolean') {
      conditions.push(Prisma.sql`is_ai_request = ${filters.isAiRequest}`);
    }
    if (filters.apiType) {
      conditions.push(Prisma.sql`api_type = ${filters.apiType}`);
    }
    if (filters.containerName) {
      conditions.push(Prisma.sql`container_name = ${filters.containerName}`);
    }
    if (filters.traceId) {
      conditions.push(Prisma.sql`trace_id = ${filters.traceId}`);
    }
    if (filters.llmCallId) {
      conditions.push(Prisma.sql`llm_call_id = ${filters.llmCallId}`);
    }
    if (filters.search) {
      const searchPattern = `%${filters.search}%`;
      conditions.push(
        Prisma.sql`(
          url ILIKE ${searchPattern}
          OR COALESCE(request_body, '') ILIKE ${searchPattern}
          OR COALESCE(response_body, '') ILIKE ${searchPattern}
        )`
      );
    }

    return joinConditions(conditions);
  }

  async function ensureReplayHistorySchema() {
    if (!replaySchemaReady) {
      replaySchemaReady = ensureReplayHistorySchemaInternal().catch((error) => {
        replaySchemaReady = null;
        throw error;
      });
    }
    return replaySchemaReady;
  }

  async function ensureReplayHistorySchemaInternal() {
    const prisma = getPrismaClient();
    const ddlStatements = [
      `ALTER TABLE traffic_replay_history ADD COLUMN IF NOT EXISTS replayed_by VARCHAR(50) DEFAULT 'system'`,
      `ALTER TABLE traffic_replay_history ADD COLUMN IF NOT EXISTS modified_method VARCHAR(16)`,
      `ALTER TABLE traffic_replay_history ADD COLUMN IF NOT EXISTS modified_url TEXT`,
      `ALTER TABLE traffic_replay_history ADD COLUMN IF NOT EXISTS modified_headers JSONB`,
      `ALTER TABLE traffic_replay_history ADD COLUMN IF NOT EXISTS modified_body TEXT`,
      `ALTER TABLE traffic_replay_history ADD COLUMN IF NOT EXISTS modification_summary JSONB`,
      `ALTER TABLE traffic_replay_history ADD COLUMN IF NOT EXISTS replay_request_headers JSONB`,
      `ALTER TABLE traffic_replay_history ADD COLUMN IF NOT EXISTS replay_request_body TEXT`,
      `ALTER TABLE traffic_replay_history ADD COLUMN IF NOT EXISTS replay_response_status INTEGER`,
      `ALTER TABLE traffic_replay_history ADD COLUMN IF NOT EXISTS replay_duration_ms INTEGER`,
      `ALTER TABLE traffic_replay_history ADD COLUMN IF NOT EXISTS replay_response_headers JSONB`,
      `ALTER TABLE traffic_replay_history ADD COLUMN IF NOT EXISTS replay_response_body TEXT`,
      `ALTER TABLE traffic_replay_history ADD COLUMN IF NOT EXISTS replay_response_size INTEGER`,
      `ALTER TABLE traffic_replay_history ADD COLUMN IF NOT EXISTS diff_summary JSONB`,
      `ALTER TABLE traffic_replay_history ADD COLUMN IF NOT EXISTS status_code_match BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE traffic_replay_history ADD COLUMN IF NOT EXISTS response_body_match BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE traffic_replay_history ADD COLUMN IF NOT EXISTS duration_diff_ms INTEGER`,
      `ALTER TABLE traffic_replay_history ADD COLUMN IF NOT EXISTS body_size_diff INTEGER`,
      `ALTER TABLE traffic_replay_history ADD COLUMN IF NOT EXISTS success BOOLEAN NOT NULL DEFAULT TRUE`,
      `ALTER TABLE traffic_replay_history ADD COLUMN IF NOT EXISTS template_id INTEGER`
    ];

    for (const ddl of ddlStatements) {
      await prisma.$executeRawUnsafe(ddl);
    }
  }

  async function listTrafficLogs(params = {}) {
    const prisma = getPrismaClient();
    const page = Math.max(Number(params.page) || 1, 1);
    const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 200);
    const offset = (page - 1) * limit;
    const { where } = buildTrafficWhere(params.filters);

    const rows = await prisma.$queryRaw(
      Prisma.sql`
        SELECT
          id, request_id, trace_id, container_name, service_name,
          method, url, host, path,
          response_status, duration_ms,
          request_timestamp::text as timestamp,
          llm_call_id, agent_turn,
          is_ai_request, api_type, api_version,
          client_ip, user_agent,
          request_size, response_size,
          error_message,
          conversation_id, user_id, session_id
        FROM http_traffic_logs
        ${where}
        ORDER BY request_timestamp DESC
        LIMIT ${limit} OFFSET ${offset}
      `
    );

    const countRows = await prisma.$queryRaw(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS total
        FROM http_traffic_logs
        ${where}
      `
    );

    return {
      data: rows.map(normalizeRecord),
      total: Number(countRows[0] ? normalizeValue('total', countRows[0].total) : 0),
      page,
      limit
    };
  }

  async function getTrafficLogById(id) {
    const prisma = getPrismaClient();
    const rows = await prisma.$queryRaw(
      Prisma.sql`
        SELECT
          id, request_id, trace_id, conversation_id, user_id, session_id, agent_turn, llm_call_id, tool_call_id,
          container_name, service_name, method, url, host, path, query_params, request_headers, request_body,
          request_content_type, request_size, response_status, response_headers, response_body, response_content_type,
          response_size, duration_ms, request_timestamp::text as request_timestamp, response_timestamp::text as response_timestamp,
          is_ai_request, api_type, api_version, client_ip, user_agent, error_message, created_at::text as created_at
        FROM http_traffic_logs
        WHERE id = ${toBigIntId(id)}
        LIMIT 1
      `
    );
    return rows[0] ? normalizeRecord(rows[0]) : null;
  }

  async function listTraceTrafficLogs(params = {}) {
    const prisma = getPrismaClient();
    const conversationId = toOptionalBigIntId(params.conversationId);
    if (!params.traceId && conversationId === null) {
      return [];
    }

    const where = [];
    if (params.traceId) {
      where.push(Prisma.sql`trace_id = ${params.traceId}`);
    }
    if (conversationId !== null) {
      where.push(Prisma.sql`conversation_id = ${conversationId}`);
    }

    const rows = await prisma.$queryRaw(
      Prisma.sql`
        SELECT
          id, request_id, trace_id, conversation_id, user_id, session_id, agent_turn, llm_call_id, tool_call_id,
          container_name, service_name, method, url, host, path, query_params, request_headers, request_body,
          request_content_type, request_size, response_status, response_headers, response_body, response_content_type,
          response_size, duration_ms, request_timestamp::text as request_timestamp, response_timestamp::text as response_timestamp,
          is_ai_request, api_type, api_version, client_ip, user_agent, error_message, created_at::text as created_at
        FROM http_traffic_logs
        WHERE ${Prisma.join(where, ' OR ')}
        ORDER BY request_timestamp ASC, id ASC
      `
    );

    return rows.map(normalizeRecord);
  }

  async function getTrafficStats(params = {}) {
    const prisma = getPrismaClient();
    const timeWhere = buildTrafficWhere({
      startTime: params.startTime,
      endTime: params.endTime
    });
    const aiTypeWhere = timeWhere.hasConditions
      ? Prisma.sql`${timeWhere.where} AND is_ai_request = TRUE AND api_type IS NOT NULL`
      : Prisma.sql`WHERE is_ai_request = TRUE AND api_type IS NOT NULL`;
    const statusWhere = timeWhere.hasConditions
      ? Prisma.sql`${timeWhere.where} AND response_status IS NOT NULL`
      : Prisma.sql`WHERE response_status IS NOT NULL`;

    const [overviewRows, apiTypeRows, hostRows, hourlyRows, statusRows] = await Promise.all([
      prisma.$queryRaw(
        Prisma.sql`
          SELECT
            COUNT(*)::bigint as total_requests,
            COUNT(*) FILTER (WHERE is_ai_request)::bigint as ai_requests,
            COUNT(*) FILTER (WHERE response_status >= 200 AND response_status < 300)::bigint as successful_requests,
            COUNT(*) FILTER (WHERE response_status >= 400)::bigint as failed_requests,
            AVG(duration_ms) as avg_response_time,
            MIN(duration_ms) as min_response_time,
            MAX(duration_ms) as max_response_time,
            COALESCE(SUM(request_size), 0)::bigint as total_request_bytes,
            COALESCE(SUM(response_size), 0)::bigint as total_response_bytes
          FROM http_traffic_logs
          ${timeWhere.where}
        `
      ),
      prisma.$queryRaw(
        Prisma.sql`
          SELECT
            api_type,
            COUNT(*)::bigint as request_count,
            AVG(duration_ms) as avg_duration,
            COUNT(*) FILTER (WHERE response_status >= 400)::bigint as error_count
          FROM http_traffic_logs
          ${aiTypeWhere}
          GROUP BY api_type
          ORDER BY request_count DESC
        `
      ),
      prisma.$queryRaw(
        Prisma.sql`
          SELECT
            host,
            COUNT(*)::bigint as request_count,
            AVG(duration_ms) as avg_duration,
          COUNT(*) FILTER (WHERE response_status >= 400)::bigint as error_count
          FROM http_traffic_logs
          ${timeWhere.where}
          GROUP BY host
          ORDER BY request_count DESC
          LIMIT 10
        `
      ),
      prisma.$queryRaw(
        Prisma.sql`
          SELECT
            to_char(date_trunc('hour', request_timestamp), 'YYYY-MM-DD HH24:00:00') as hour,
            COUNT(*)::bigint as request_count,
            COUNT(*) FILTER (WHERE is_ai_request)::bigint as ai_request_count,
            AVG(duration_ms) as avg_duration
          FROM http_traffic_logs
          ${timeWhere.where}
          GROUP BY date_trunc('hour', request_timestamp)
          ORDER BY hour ASC
        `
      ),
      prisma.$queryRaw(
        Prisma.sql`
          SELECT
            CASE
              WHEN response_status BETWEEN 200 AND 299 THEN '2xx'
              WHEN response_status BETWEEN 300 AND 399 THEN '3xx'
              WHEN response_status BETWEEN 400 AND 499 THEN '4xx'
              WHEN response_status BETWEEN 500 AND 599 THEN '5xx'
              ELSE 'Other'
            END as status_group,
            COUNT(*)::bigint as count
          FROM http_traffic_logs
          ${statusWhere}
          GROUP BY status_group
          ORDER BY count DESC
        `
      )
    ]);

    return {
      overview: normalizeRecord(overviewRows[0] || {}),
      api_types: apiTypeRows.map(normalizeRecord),
      hosts: hostRows.map(normalizeRecord),
      hourly_distribution: hourlyRows.map(normalizeRecord),
      status_codes: statusRows.map(normalizeRecord)
    };
  }

  async function getTrafficEndpoints(params = {}) {
    const prisma = getPrismaClient();
    const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
    const endpointExpr = Prisma.raw(`
      COALESCE(
        NULLIF(split_part(trim(leading '/' from COALESCE(path, '')), '/', 2), ''),
        NULLIF(split_part(trim(leading '/' from COALESCE(path, '')), '/', 1), ''),
        '/'
      )
    `);
    const orderByClause = params.sortBy === 'avg_duration'
      ? Prisma.raw('avg_duration DESC')
      : params.sortBy === 'error_rate'
        ? Prisma.raw('error_rate DESC')
        : Prisma.raw('request_count DESC');

    const rows = await prisma.$queryRaw(
      Prisma.sql`
        SELECT
          host,
          ${endpointExpr} as endpoint,
          method,
          COUNT(*)::bigint as request_count,
          AVG(duration_ms) as avg_duration,
          MIN(duration_ms) as min_duration,
          MAX(duration_ms) as max_duration,
          COUNT(*) FILTER (WHERE response_status >= 400)::bigint as error_count,
          COUNT(*) FILTER (WHERE response_status >= 400) * 100.0 / COUNT(*) as error_rate,
          MIN(request_timestamp)::text as first_seen,
          MAX(request_timestamp)::text as last_seen
        FROM http_traffic_logs
        WHERE request_timestamp >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
        GROUP BY host, ${endpointExpr}, method
        HAVING COUNT(*) >= 2
        ORDER BY ${orderByClause}
        LIMIT ${limit}
      `
    );

    return rows.map(normalizeRecord);
  }

  async function searchTrafficLogs(params = {}) {
    const prisma = getPrismaClient();
    const query = String(params.query || '').trim();
    const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
    const searchPattern = `%${query}%`;

    const rows = await prisma.$queryRaw(
      Prisma.sql`
        SELECT
          id, request_id, trace_id, method, url, host,
          response_status, duration_ms, request_timestamp::text as request_timestamp,
          is_ai_request, api_type,
          (
            CASE WHEN url ILIKE ${searchPattern} THEN 3 ELSE 0 END +
            CASE WHEN host ILIKE ${searchPattern} THEN 2 ELSE 0 END +
            CASE WHEN COALESCE(request_body, '') ILIKE ${searchPattern} THEN 1 ELSE 0 END +
            CASE WHEN COALESCE(response_body, '') ILIKE ${searchPattern} THEN 1 ELSE 0 END
          ) as relevance
        FROM http_traffic_logs
        WHERE url ILIKE ${searchPattern}
          OR host ILIKE ${searchPattern}
          OR COALESCE(path, '') ILIKE ${searchPattern}
          OR COALESCE(request_body, '') ILIKE ${searchPattern}
          OR COALESCE(response_body, '') ILIKE ${searchPattern}
        ORDER BY relevance DESC, request_timestamp DESC
        LIMIT ${limit}
      `
    );

    return rows.map(normalizeRecord);
  }

  async function exportTrafficLogs(params = {}) {
    const prisma = getPrismaClient();
    const { where } = buildTrafficWhere({
      startTime: params.startTime,
      endTime: params.endTime
    });
    const limit = Math.min(Math.max(Number(params.limit) || 1000, 1), 5000);

    const fields = params.includeBody
      ? Prisma.sql`id, trace_id, method, url, response_status, duration_ms, request_timestamp::text as request_timestamp, is_ai_request, api_type, request_body, response_body`
      : Prisma.sql`id, trace_id, method, url, response_status, duration_ms, request_timestamp::text as request_timestamp, is_ai_request, api_type`;

    const rows = await prisma.$queryRaw(
      Prisma.sql`
        SELECT ${fields}
        FROM http_traffic_logs
        ${where}
        ORDER BY request_timestamp DESC
        LIMIT ${limit}
      `
    );

    return rows.map(normalizeRecord);
  }

  async function listTrafficReplayHistory(originalLogId) {
    await ensureReplayHistorySchema();
    const prisma = getPrismaClient();
    const rows = await prisma.trafficReplayHistory.findMany({
      where: { original_log_id: toBigIntId(originalLogId) },
      orderBy: [{ replayed_at: 'desc' }, { id: 'desc' }]
    });
    return rows.map(normalizeRecord);
  }

  async function createTrafficReplayHistory(data) {
    await ensureReplayHistorySchema();
    const prisma = getPrismaClient();
    const row = await prisma.trafficReplayHistory.create({
      data: {
        original_log_id: toBigIntId(data.original_log_id),
        replay_name: data.replay_name || null,
        target_url: data.target_url || null,
        request_method: data.request_method || null,
        request_headers: data.request_headers || null,
        request_body: data.request_body || null,
        response_status: data.response_status ?? null,
        response_headers: data.response_headers || null,
        response_body: data.response_body || null,
        duration_ms: data.duration_ms ?? null,
        status: data.status || 'completed',
        error_message: data.error_message || null,
        replayed_by: data.replayed_by || 'admin',
        modified_method: data.modified_method || null,
        modified_url: data.modified_url || null,
        modified_headers: data.modified_headers || null,
        modified_body: data.modified_body || null,
        modification_summary: data.modification_summary || null,
        replay_request_headers: data.replay_request_headers || null,
        replay_request_body: data.replay_request_body || null,
        replay_response_status: data.replay_response_status ?? null,
        replay_duration_ms: data.replay_duration_ms ?? null,
        replay_response_headers: data.replay_response_headers || null,
        replay_response_body: data.replay_response_body || null,
        replay_response_size: data.replay_response_size ?? null,
        diff_summary: data.diff_summary || null,
        status_code_match: Boolean(data.status_code_match),
        response_body_match: Boolean(data.response_body_match),
        duration_diff_ms: data.duration_diff_ms ?? null,
        body_size_diff: data.body_size_diff ?? null,
        success: data.success !== false,
        template_id: data.template_id ?? null
      }
    });
    return normalizeRecord(row);
  }

  async function listAiTrafficSamples(params = {}) {
    const prisma = getPrismaClient();
    const limit = Math.min(Math.max(Number(params.limit) || 24, 1), 200);
    const search = params.search ? `%${String(params.search).trim().toLowerCase()}%` : null;

    const rows = search
      ? await prisma.$queryRaw(
          Prisma.sql`
            SELECT id, trace_id, conversation_id, method, host, path, url, api_type, service_name,
                   response_status, duration_ms, request_timestamp::text as request_timestamp
            FROM http_traffic_logs
            WHERE is_ai_request = TRUE
              AND (
                LOWER(COALESCE(url, '')) LIKE ${search}
                OR LOWER(COALESCE(host, '')) LIKE ${search}
                OR LOWER(COALESCE(path, '')) LIKE ${search}
              )
            ORDER BY request_timestamp DESC, id DESC
            LIMIT ${limit}
          `
        )
      : await prisma.$queryRaw(
          Prisma.sql`
            SELECT id, trace_id, conversation_id, method, host, path, url, api_type, service_name,
                   response_status, duration_ms, request_timestamp::text as request_timestamp
            FROM http_traffic_logs
            WHERE is_ai_request = TRUE
            ORDER BY request_timestamp DESC, id DESC
            LIMIT ${limit}
          `
        );

    return rows.map(normalizeRecord);
  }

  async function createTrafficLogBatch(records = []) {
    const prisma = getPrismaClient();
    if (!Array.isArray(records) || records.length === 0) {
      return { count: 0 };
    }

    const data = records.map((record) => ({
      request_id: record.request_id || null,
      trace_id: record.trace_id || null,
      conversation_id: toOptionalBigIntId(record.conversation_id),
      user_id: record.user_id || null,
      session_id: record.session_id || null,
      agent_turn: toIntegerValue(record.agent_turn),
      llm_call_id: record.llm_call_id || null,
      tool_call_id: record.tool_call_id || null,
      container_name: record.container_name || null,
      service_name: record.service_name || null,
      method: record.method,
      url: record.url,
      host: record.host,
      path: record.path,
      query_params: parseJsonValue(record.query_params, null),
      request_headers: parseJsonValue(record.request_headers, {}),
      request_body: record.request_body || null,
      request_content_type: record.request_content_type || null,
      request_size: toIntegerValue(record.request_size),
      response_status: toIntegerValue(record.response_status),
      response_headers: parseJsonValue(record.response_headers, null),
      response_body: record.response_body || null,
      response_content_type: record.response_content_type || null,
      response_size: toIntegerValue(record.response_size),
      duration_ms: toBigIntValue(record.duration_ms),
      request_timestamp: serializeTimestampForStorage(record.request_timestamp) || serializeTimestampForStorage(new Date()),
      response_timestamp: record.response_timestamp ? serializeTimestampForStorage(record.response_timestamp) : null,
      is_ai_request: Boolean(record.is_ai_request),
      api_type: record.api_type || null,
      api_version: record.api_version || null,
      client_ip: record.client_ip || null,
      user_agent: record.user_agent || null,
      error_message: record.error_message || null
    }));

    const result = await prisma.httpTrafficLog.createMany({ data });
    return { count: result.count };
  }

  return {
    listTrafficLogs,
    getTrafficLogById,
    listTraceTrafficLogs,
    getTrafficStats,
    getTrafficEndpoints,
    searchTrafficLogs,
    exportTrafficLogs,
    ensureReplayHistorySchema,
    listTrafficReplayHistory,
    createTrafficReplayHistory,
    listAiTrafficSamples,
    createTrafficLogBatch
  };
}

module.exports = {
  createTrafficPersistence
};

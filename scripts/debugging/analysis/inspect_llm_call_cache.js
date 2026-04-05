#!/usr/bin/env node
'use strict';

const { buildDatabaseUrl, createSqlAdapter } = require('../../../packages/persistence');

function parseArgs(argv) {
  const parsed = {
    limit: 5,
    agentType: 'chat_bot',
    sessionKey: null,
    traceId: null
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--limit' && argv[index + 1]) {
      parsed.limit = Math.max(1, Number.parseInt(argv[index + 1], 10) || 5);
      index += 1;
      continue;
    }
    if (arg === '--agent-type' && argv[index + 1]) {
      parsed.agentType = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--session-key' && argv[index + 1]) {
      parsed.sessionKey = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--trace-id' && argv[index + 1]) {
      parsed.traceId = argv[index + 1];
      index += 1;
    }
  }

  return parsed;
}

function safeJson(value, fallback) {
  if (value === null || typeof value === 'undefined') {
    return fallback;
  }
  if (typeof value === 'object') {
    return value;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function estimateTokens(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return 0;
  }
  return Math.ceil(value.length / 4);
}

function summarizeInputItems(inputItems) {
  if (!Array.isArray(inputItems)) {
    return {
      count: 0,
      messages: 0,
      functionCalls: 0,
      functionOutputs: 0,
      reasoning: 0,
      estimatedTokens: 0
    };
  }

  let messages = 0;
  let functionCalls = 0;
  let functionOutputs = 0;
  let reasoning = 0;
  let estimatedTokens = 0;

  for (const item of inputItems) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    if (item.type === 'message') {
      messages += 1;
      estimatedTokens += estimateTokens(typeof item.content === 'string' ? item.content : '');
      continue;
    }
    if (item.type === 'function_call') {
      functionCalls += 1;
      estimatedTokens += estimateTokens(typeof item.arguments === 'string' ? item.arguments : '');
      continue;
    }
    if (item.type === 'function_call_output') {
      functionOutputs += 1;
      estimatedTokens += estimateTokens(typeof item.output === 'string' ? item.output : '');
      continue;
    }
    if (item.type === 'reasoning') {
      reasoning += 1;
      estimatedTokens += estimateTokens(typeof item.summary === 'string' ? item.summary : '');
    }
  }

  return {
    count: inputItems.length,
    messages,
    functionCalls,
    functionOutputs,
    reasoning,
    estimatedTokens
  };
}

function summarizeRequest(row) {
  const canonicalRequest = safeJson(row.canonical_request, {});
  const tokenUsage = safeJson(row.token_usage, {});
  const instructions = typeof canonicalRequest.instructions === 'string' ? canonicalRequest.instructions : '';
  const inputItems = Array.isArray(canonicalRequest.input) ? canonicalRequest.input : [];
  const tools = Array.isArray(canonicalRequest.tools) ? canonicalRequest.tools : [];
  const inputSummary = summarizeInputItems(inputItems);
  const cachedInputTokens = Number(tokenUsage.cached_input_tokens || 0);
  const inputTokens = Number(tokenUsage.input_tokens || 0);

  return {
    llmCallId: row.llm_call_id || null,
    traceId: row.trace_id || null,
    sessionId: row.session_id || null,
    startedAt: row.started_at || null,
    modelName: row.model_name || null,
    promptName: row.prompt_template || null,
    promptCacheKey: canonicalRequest.prompt_cache_key || null,
    promptCacheRetention: canonicalRequest.prompt_cache_retention || null,
    instructionsEstimatedTokens: estimateTokens(instructions),
    inputSummary,
    toolCount: tools.length,
    inputTokens,
    cachedInputTokens,
    cacheHitRate: inputTokens > 0 ? Number((cachedInputTokens / inputTokens).toFixed(3)) : 0
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const sql = createSqlAdapter({
    databaseUrl: process.env.DATABASE_URL || buildDatabaseUrl({
      host: process.env.DB_HOST || '127.0.0.1',
      port: process.env.DB_PORT || '5432',
      user: process.env.DB_USER || 'qqbot_user',
      password: process.env.DB_PASSWORD || 'qqbot_password',
      database: process.env.DB_NAME || 'qqbot_db'
    }),
    applicationName: 'inspect-llm-call-cache'
  });

  try {
    const conditions = [];
    const params = [];

    if (args.agentType) {
      conditions.push('agent_type = ?');
      params.push(args.agentType);
    }
    if (args.sessionKey) {
      conditions.push("canonical_request->>'prompt_cache_key' = ?");
      params.push(args.sessionKey);
    }
    if (args.traceId) {
      conditions.push('trace_id = ?');
      params.push(args.traceId);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const rows = await sql.query(
      `
        SELECT
          llm_call_id,
          trace_id,
          session_id,
          started_at,
          model_name,
          prompt_template,
          canonical_request,
          token_usage
        FROM llm_call_logs
        ${whereClause}
        ORDER BY started_at DESC, id DESC
        LIMIT ?
      `,
      [...params, args.limit]
    );

    const summary = rows.map(summarizeRequest);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await sql.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});

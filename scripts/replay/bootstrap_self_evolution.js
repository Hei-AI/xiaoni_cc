#!/usr/bin/env node

'use strict';

const path = require('path');
const { Client } = require('../../packages/persistence/node_modules/pg');
const {
  buildDatabaseUrl,
  createSelfEvolutionJob,
  listSelfEvolutionJobs,
  listSelfEvolutionStates
} = require('../../packages/persistence');
const { parseArgs } = require('./common');

function usage() {
  console.log([
    'Usage: node scripts/replay/bootstrap_self_evolution.js --group-id <id> [options]',
    '',
    'Options:',
    '  --group-id <id>        Required. Group id to bootstrap.',
    '  --session-key <key>    Optional. Default: qq:group:<group-id>',
    '  --turn-limit <n>       Conversation turns to include. Default: 12',
    '  --event-limit <n>      Ledger events to include. Default: 20',
    '  --trigger-reason <v>   Job trigger reason. Default: manual_bootstrap',
    '  --provider-url <url>   Execute endpoint. Default: http://127.0.0.1:8091/api/internal/self-evolution/execute',
    '  --help                 Show this message'
  ].join('\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args['group-id']) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const groupId = Number(args['group-id']);
  if (!Number.isFinite(groupId) || groupId <= 0) {
    throw new Error('group-id must be a positive number');
  }

  const sessionKey = typeof args['session-key'] === 'string' && args['session-key'].trim()
    ? args['session-key'].trim()
    : `qq:group:${groupId}`;
  const turnLimit = Number.isFinite(Number(args['turn-limit'])) ? Number(args['turn-limit']) : 12;
  const eventLimit = Number.isFinite(Number(args['event-limit'])) ? Number(args['event-limit']) : 20;
  const triggerReason = typeof args['trigger-reason'] === 'string' && args['trigger-reason'].trim()
    ? args['trigger-reason'].trim()
    : 'manual_bootstrap';
  const providerUrl = typeof args['provider-url'] === 'string' && args['provider-url'].trim()
    ? args['provider-url'].trim()
    : 'http://127.0.0.1:8091/api/internal/self-evolution/execute';

  const databaseUrl = process.env.DATABASE_URL || buildDatabaseUrl({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number.parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'qqbot_user',
    password: process.env.DB_PASSWORD || 'qqbot_password',
    database: process.env.DB_NAME || 'qqbot_db'
  });
  const dbConfig = { databaseUrl };
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();
  try {
    const recentResult = await client.query(
      `
        SELECT
          id,
          user_id,
          group_id,
          user_message,
          ai_response,
          timestamp,
          response_time,
          status,
          error_reason,
          model_name,
          raw_request,
          raw_response,
          message_id,
          trace_id
        FROM conversations
        WHERE group_id = $1
        ORDER BY id DESC
        LIMIT $2
      `,
      [groupId, turnLimit]
    );
    const turns = recentResult.rows.reverse().map((row) => ({
      id: Number(row.id),
      source_message_ids: Array.isArray(row.raw_request?.source_message_ids)
        ? row.raw_request.source_message_ids
        : (row.message_id ? [Number(row.message_id)] : [Number(row.id)]),
      user_id: Number(row.user_id),
      group_id: row.group_id ? Number(row.group_id) : null,
      user_message: row.user_message,
      ai_response: row.ai_response,
      timestamp: row.timestamp,
      response_time: row.response_time,
      status: row.status,
      error_reason: row.error_reason,
      model_name: row.model_name,
      raw_request: row.raw_request || {},
      raw_response: row.raw_response || {},
      trace_id: row.trace_id
    }));
    if (turns.length === 0) {
      throw new Error(`No conversations found for group ${groupId}`);
    }

    const ledgerResult = await client.query(
      `
        SELECT
          id,
          group_id,
          target_user_id,
          event_type,
          source_message_ids,
          source_excerpt,
          metadata,
          created_at
        FROM relationship_ledger_events
        WHERE session_key = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2
      `,
      [sessionKey, eventLimit]
    );
    const ledgerEvents = ledgerResult.rows.reverse().map((row) => ({
      id: Number(row.id),
      group_id: row.group_id ? Number(row.group_id) : null,
      target_user_id: row.target_user_id ? Number(row.target_user_id) : null,
      event_type: row.event_type,
      source_message_ids: Array.isArray(row.source_message_ids) ? row.source_message_ids : [],
      source_excerpt: row.source_excerpt,
      metadata: row.metadata || {},
      created_at: row.created_at
    }));

    const jobs = await listSelfEvolutionJobs({ sessionKey, limit: 50 }, dbConfig);
    const lastVersion = jobs.reduce((max, job) => Math.max(max, Number(job.output_state_version || 0)), 0);
    const version = lastVersion + 1;
    const inputMessageIds = Array.from(new Set(
      turns.flatMap((turn) => (
        Array.isArray(turn.source_message_ids)
          ? turn.source_message_ids.map((value) => Number(value)).filter((value) => Number.isFinite(value))
          : []
      ))
    ));

    const job = await createSelfEvolutionJob({
      groupId,
      sessionKey,
      status: 'pending',
      triggerReason,
      turnRangeStart: turns[0]?.id || null,
      turnRangeEnd: turns[turns.length - 1]?.id || null,
      sourceEventCount: ledgerEvents.length,
      inputMessageIds,
      outputStateVersion: version,
      metadata: {
        createdAtMs: Date.now(),
        manual: true,
        cwd: process.cwd(),
        script: path.relative(process.cwd(), __filename)
      }
    }, dbConfig);

    const response = await fetch(providerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        job_id: Number(job.id),
        session_key: sessionKey,
        group_id: groupId,
        target_user_id: null,
        version,
        trigger_reason: triggerReason,
        turns,
        ledger_events: ledgerEvents
      })
    });
    const rawBody = await response.text();
    const states = await listSelfEvolutionStates({ sessionKey, groupId, isActive: true, limit: 50 }, dbConfig);

    console.log(JSON.stringify({
      ok: response.ok,
      status: response.status,
      session_key: sessionKey,
      group_id: groupId,
      job_id: Number(job.id),
      version,
      turn_count: turns.length,
      ledger_event_count: ledgerEvents.length,
      active_state_count: states.length,
      active_states: states.map((state) => ({
        id: state.id,
        scope_type: state.scope_type,
        target_user_id: state.target_user_id,
        version: state.version,
        summary_text: state.summary_text
      })),
      response_body: rawBody
    }, null, 2));
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

#!/usr/bin/env node
'use strict';

const path = require('path');
const { Pool } = require(path.resolve(__dirname, '../../packages/persistence/node_modules/pg'));

const TARGET_TABLES = [
  'agent_runtime_control',
  'agent_recovery_sessions',
  'agent_inbound_messages',
  'agent_queue_messages',
  'agent_life_events',
  'agent_session_life_states',
  'agent_stack_items',
  'llm_request_slices',
  'tool_executions',
  'core_memory_compression_fork_runs',
  'core_memory_compression_fork_items',
  'core_memory_compression_fork_slices',
  'core_memory_compression_fork_tool_executions',
  'timeline_events',
  'llm_jobs',
  'agent_runs',
  'agent_message_batches',
  'agent_message_batch_items',
  'conversations',
  'conversation_items',
  'codex_provider_usage_events',
  'llm_usage_rollups',
  'llm_usage_rollup_sources',
  'agent_qq_attention_leases',
  'agent_qq_attention_reminders',
  'http_traffic_logs'
];

const TIMESTAMP_COLUMN_NAMES = new Set([
  'timestamp',
  'event_time',
  'sort_time',
  'started_at',
  'ended_at',
  'completed_at',
  'created_at',
  'updated_at',
  'read_at',
  'received_at',
  'message_timestamp',
  'available_at',
  'locked_at',
  'processing_started_at',
  'last_activity',
  'expires_at',
  'request_timestamp',
  'response_timestamp',
  'replayed_at',
  'last_received_at',
  'queued_at',
  'processed_at',
  'import_started_at',
  'last_import_time',
  'first_seen',
  'last_seen',
  'occurred_at',
  'last_active_at',
  'last_boredom_reset_at',
  'last_sleep_at',
  'service_started_at',
  'last_presence_tick_enqueued_at',
  'last_proactive_at',
  'last_user_message_at',
  'reduced_through_occurred_at',
  'projection_updated_at',
  'clock_due_at',
  'clock_fired_at',
  'clock_deferred_at',
  'last_checked_at',
  'planned_natural_wake_at',
  'hard_wake_at',
  'score_updated_at',
  'last_focused_at',
  'last_reminder_at',
  'closed_at',
  'top_timestamp',
  'bucket_start',
  'bucket_end',
  'hour_bucket_start',
  'day_bucket_start',
  'month_bucket_start',
  'evidence_time_start',
  'evidence_time_end',
  'daily_proactive_date'
]);

const UTC_WALL_CLOCK_COLUMNS = new Set([
  'llm_request_slices.completed_at',
  'core_memory_compression_fork_slices.completed_at',
  'image_vision_fork_slices.completed_at',
  'codex_provider_usage_events.completed_at'
]);

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function backupNameFor(tableName) {
  return `ops_backup_timezone_timestamptz_20260614_${tableName}`;
}

function connectionString() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const user = process.env.DB_USER || 'qqbot_user';
  const password = process.env.DB_PASSWORD || 'qqbot_password';
  const database = process.env.DB_NAME || 'qqbot_db';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

async function loadTargetTables(client, allAppTables) {
  if (!allAppTables) {
    return TARGET_TABLES;
  }

  const result = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name !~ '^(ops_backup_|cleanup_|cleanup_backup_|cleanup_bak_)'
    ORDER BY table_name
  `);
  return result.rows.map((row) => row.table_name);
}

async function loadColumns(client, targetTables) {
  const result = await client.query(
    `
      SELECT table_name, column_name, data_type, udt_name, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
      ORDER BY table_name, ordinal_position
    `,
    [targetTables]
  );

  return result.rows
    .filter((row) => (
      TIMESTAMP_COLUMN_NAMES.has(row.column_name)
      || row.column_name.endsWith('_at')
      || row.column_name.endsWith('_timestamp')
    ))
    .filter((row) => row.udt_name === 'timestamp' || row.udt_name === 'timestamptz');
}

async function tableRowCount(client, tableName) {
  const result = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${quoteIdentifier(tableName)}`);
  return result.rows[0]?.count || '0';
}

async function auditColumn(client, column) {
  const table = quoteIdentifier(column.table_name);
  const name = quoteIdentifier(column.column_name);
  const result = await client.query(`
    SELECT
      COUNT(*)::bigint AS total_rows,
      COUNT(${name})::bigint AS non_null_rows,
      MIN(${name})::text AS min_value,
      MAX(${name})::text AS max_value
    FROM ${table}
  `);
  return result.rows[0];
}

async function backupTable(client, tableName, dryRun) {
  const backupTable = backupNameFor(tableName);
  const exists = await client.query(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [backupTable]
  );
  if (exists.rowCount > 0) {
    return { backupTable, action: 'exists' };
  }
  if (!dryRun) {
    await client.query(`CREATE TABLE ${quoteIdentifier(backupTable)} AS TABLE ${quoteIdentifier(tableName)}`);
  }
  return { backupTable, action: dryRun ? 'would_create' : 'created' };
}

async function migrateColumn(client, column, dryRun) {
  if (column.udt_name === 'timestamptz') {
    return { action: 'skip_already_timestamptz' };
  }

  const table = quoteIdentifier(column.table_name);
  const name = quoteIdentifier(column.column_name);
  const key = `${column.table_name}.${column.column_name}`;
  const shiftBeforeAlter = UTC_WALL_CLOCK_COLUMNS.has(key);
  if (dryRun) {
    return { action: 'would_alter', shiftBeforeAlter };
  }

  if (shiftBeforeAlter) {
    await client.query(`UPDATE ${table} SET ${name} = ${name} + INTERVAL '8 hours' WHERE ${name} IS NOT NULL`);
  }

  await client.query(`
    ALTER TABLE ${table}
      ALTER COLUMN ${name} TYPE TIMESTAMPTZ(3)
      USING ${name} AT TIME ZONE 'Asia/Shanghai'
  `);

  return { action: 'altered', shiftBeforeAlter };
}

async function run() {
  const dryRun = !process.argv.includes('--apply');
  const allAppTables = process.argv.includes('--all-app-tables');
  const pool = new Pool({
    connectionString: connectionString(),
    max: 1,
    options: '-c timezone=Asia/Shanghai',
    application_name: dryRun ? 'qq-bot-timezone-dry-run' : 'qq-bot-timezone-migration'
  });

  const client = await pool.connect();
  try {
    await client.query(`SET TIME ZONE 'Asia/Shanghai'`);
    const targetTables = await loadTargetTables(client, allAppTables);
    const columns = await loadColumns(client, targetTables);
    const grouped = new Map();
    for (const column of columns) {
      const entries = grouped.get(column.table_name) || [];
      entries.push(column);
      grouped.set(column.table_name, entries);
    }

    console.log(JSON.stringify({
      mode: dryRun ? 'dry-run' : 'apply',
      scope: allAppTables ? 'all-app-tables' : 'default-runtime-tables',
      timezone: 'Asia/Shanghai',
      targetTableCount: targetTables.length,
      timestampColumnCount: columns.length,
      utcWallClockColumns: Array.from(UTC_WALL_CLOCK_COLUMNS)
    }));

    for (const tableName of targetTables) {
      const tableColumns = grouped.get(tableName) || [];
      if (tableColumns.length === 0) {
        continue;
      }

      await client.query('BEGIN');
      try {
        const rowCount = await tableRowCount(client, tableName);
        const backup = await backupTable(client, tableName, dryRun);
        console.log(JSON.stringify({ table: tableName, rowCount, backup }));

        for (const column of tableColumns) {
          const before = await auditColumn(client, column);
          const migration = await migrateColumn(client, column, dryRun);
          const after = dryRun ? null : await auditColumn(client, {
            ...column,
            udt_name: 'timestamptz'
          });
          console.log(JSON.stringify({
            table: column.table_name,
            column: column.column_name,
            dataType: column.udt_name,
            before,
            migration,
            after
          }));
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

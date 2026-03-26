'use strict';

const { PrismaClient, Prisma } = require('./generated/client');
const { Pool } = require('pg');

let prismaClient = null;

function buildDatabaseUrl(config = {}) {
  const host = config.host || process.env.DB_HOST || 'localhost';
  const port = Number.parseInt(String(config.port || process.env.DB_PORT || '5432'), 10);
  const user = encodeURIComponent(config.user || process.env.DB_USER || 'qqbot_user');
  const password = encodeURIComponent(config.password || process.env.DB_PASSWORD || 'qqbot_password');
  const database = encodeURIComponent(config.database || process.env.DB_NAME || 'qqbot_db');
  return `postgresql://${user}:${password}@${host}:${port}/${database}?schema=public`;
}

function resolveDatabaseUrl(config = {}) {
  return config.databaseUrl || process.env.DATABASE_URL || buildDatabaseUrl(config);
}

function createPoolConfig(config = {}) {
  return {
    connectionString: resolveDatabaseUrl(config),
    max: Number.parseInt(String(config.connectionLimit || 10), 10),
    idleTimeoutMillis: 30000,
    application_name: config.applicationName || 'qq-bot'
  };
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') {
    return row;
  }

  const normalized = Array.isArray(row) ? [] : {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      normalized[key] = value.toISOString();
      continue;
    }
    if (typeof value === 'bigint') {
      normalized[key] = Number(value);
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

function rewriteIntervalFunctions(query) {
  return query
    .replace(/DATE_SUB\s*\(\s*NOW\(\)\s*,\s*INTERVAL\s+(\d+)\s+(HOUR|DAY|MINUTE|SECOND)\s*\)/gi, "NOW() - INTERVAL '$1 $2'")
    .replace(/DATE_ADD\s*\(\s*NOW\(\)\s*,\s*INTERVAL\s+(\d+)\s+(HOUR|DAY|MINUTE|SECOND)\s*\)/gi, "NOW() + INTERVAL '$1 $2'")
    .replace(/DATE_SUB\s*\(\s*CURDATE\(\)\s*,\s*INTERVAL\s+(\d+)\s+(HOUR|DAY|MINUTE|SECOND)\s*\)/gi, "CURRENT_DATE - INTERVAL '$1 $2'")
    .replace(/DATE_ADD\s*\(\s*CURDATE\(\)\s*,\s*INTERVAL\s+(\d+)\s+(HOUR|DAY|MINUTE|SECOND)\s*\)/gi, "CURRENT_DATE + INTERVAL '$1 $2'")
    .replace(/CURDATE\(\)/gi, 'CURRENT_DATE');
}

function rewriteVendorSpecificSql(query) {
  return rewriteIntervalFunctions(query)
    .replace(/\s+FORCE INDEX\s*\([^)]+\)/gi, '')
    .replace(/JSON_LENGTH\s*\(\s*messages\s*\)/gi, "jsonb_array_length(COALESCE(messages, '[]'::jsonb))")
    .replace(/DATABASE\(\)/gi, 'current_database()');
}

function convertQuestionPlaceholders(query) {
  let index = 0;
  return query.replace(/\?/g, () => `$${++index}`);
}

function prepareSql(query) {
  return convertQuestionPlaceholders(rewriteVendorSpecificSql(query));
}

async function withClient(pool, fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

function createSqlExecutor(pool) {
  return {
    async query(query, params = []) {
      const result = await pool.query(prepareSql(query), params);
      return result.rows.map(normalizeRow);
    },
    async execute(query, params = []) {
      const result = await pool.query(prepareSql(query), params);
      return result.rowCount || 0;
    },
    async insert(query, params = []) {
      const sql = prepareSql(query);
      const finalSql = /\breturning\b/i.test(sql) ? sql : `${sql} RETURNING id`;
      const result = await pool.query(finalSql, params);
      const insertId = result.rows[0] && typeof result.rows[0].id !== 'undefined'
        ? Number(result.rows[0].id) || 0
        : 0;
      return {
        insertId,
        affectedRows: result.rowCount || 0
      };
    }
  };
}

function createSqlAdapter(config = {}) {
  const pool = new Pool(createPoolConfig(config));
  const executor = createSqlExecutor(pool);

  return {
    pool,
    async testConnection() {
      try {
        const result = await pool.query('SELECT 1 AS ok');
        return result.rows.length === 1;
      } catch {
        return false;
      }
    },
    query: executor.query,
    execute: executor.execute,
    insert: executor.insert,
    async withTransaction(callback) {
      return withClient(pool, async (client) => {
        await client.query('BEGIN');
        const tx = createSqlExecutor(client);
        try {
          const result = await callback(tx);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });
    },
    async close() {
      await pool.end();
    }
  };
}

function getPrismaClient(config = {}) {
  const databaseUrl = resolveDatabaseUrl(config);
  if (!prismaClient) {
    prismaClient = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl
        }
      }
    });
  }
  return prismaClient;
}

async function closePrismaClient() {
  if (prismaClient) {
    await prismaClient.$disconnect();
    prismaClient = null;
  }
}

module.exports = {
  Prisma,
  buildDatabaseUrl,
  resolveDatabaseUrl,
  createSqlAdapter,
  getPrismaClient,
  closePrismaClient
};

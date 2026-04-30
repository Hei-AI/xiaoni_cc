'use strict';

const { PrismaClient, Prisma } = require('./generated/client');
const { Pool, types } = require('pg');
const { createTrafficPersistence } = require('./traffic');
const { createRelationshipMemoryPersistence } = require('./relationship-memory');
const { createSelfEvolutionPersistence } = require('./self-evolution');
const { createFeedbackReflectionPersistence } = require('./feedback-reflection');
const { createIdentityLineagePersistence } = require('./identity-lineage');
const { createTopicLabPersistence } = require('./topic-lab');
const { createImageLabPersistence } = require('./image-lab');
const { createAgentMediaPersistence } = require('./agent-media');
const { createAgentTaskPersistence } = require('./agent-tasks');
const { createAbExperimentPersistence } = require('./ab-experiment');
const {
  STORAGE_TIMEZONE,
  TIMESTAMP_WITHOUT_TZ_OID,
  TIMESTAMPTZ_OID,
  normalizeTimestampField,
  prepareSqlParameter,
} = require('./time');

let prismaClient = null;

types.setTypeParser(TIMESTAMP_WITHOUT_TZ_OID, (value) => value);
types.setTypeParser(TIMESTAMPTZ_OID, (value) => value);

function buildDatabaseUrl(config = {}) {
  const host = config.host || process.env.DB_HOST || 'localhost';
  const port = Number.parseInt(String(config.port || process.env.DB_PORT || '5432'), 10);
  const user = encodeURIComponent(config.user || process.env.DB_USER || 'qqbot_user');
  const password = encodeURIComponent(config.password || process.env.DB_PASSWORD || 'qqbot_password');
  const database = encodeURIComponent(config.database || process.env.DB_NAME || 'qqbot_db');
  const timezoneOption = encodeURIComponent(`-c timezone=${STORAGE_TIMEZONE}`);
  return `postgresql://${user}:${password}@${host}:${port}/${database}?schema=public&options=${timezoneOption}`;
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
    if (typeof value === 'bigint') {
      normalized[key] = Number(value);
      continue;
    }
    normalized[key] = normalizeTimestampField(key, value);
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
      const result = await pool.query(prepareSql(query), params.map(prepareSqlParameter));
      return result.rows.map(normalizeRow);
    },
    async execute(query, params = []) {
      const result = await pool.query(prepareSql(query), params.map(prepareSqlParameter));
      return result.rowCount || 0;
    },
    async insert(query, params = []) {
      const sql = prepareSql(query);
      const finalSql = /\breturning\b/i.test(sql) ? sql : `${sql} RETURNING id`;
      const result = await pool.query(finalSql, params.map(prepareSqlParameter));
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
  pool.on('connect', (client) => {
    void client.query(`SET TIME ZONE '${STORAGE_TIMEZONE}'`);
  });
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

function parseJsonValue(value, fallback) {
  if (value === null || typeof value === 'undefined') {
    return fallback;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  if (typeof value === 'object') {
    return value;
  }

  return fallback;
}

function parsePromptText(value) {
  const parsed = parseJsonValue(value, value);
  if (Array.isArray(parsed)) {
    return parsed
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean)
      .join('\n');
  }

  return typeof parsed === 'string' ? parsed : '';
}

async function resolveChatAgentPrompt(params = {}, config = {}) {
  const prisma = getPrismaClient(config);
  const chatType = params.chatType === 'group' ? 'group' : 'direct';
  const groupId = Number(params.groupId);
  const userId = Number(params.userId);

  let bindingSource = null;
  let bindingPromptId = null;

  if (chatType === 'group' && Number.isFinite(groupId) && groupId > 0) {
    const groupRows = await prisma.$queryRaw(
      Prisma.sql`SELECT agent_prompt_id
                 FROM group_chat_settings
                 WHERE group_id = ${BigInt(groupId)}
                 LIMIT 1`
    );
    const groupSetting = Array.isArray(groupRows) ? groupRows[0] : null;

    if (groupSetting && typeof groupSetting.agent_prompt_id === 'string' && groupSetting.agent_prompt_id.trim().length > 0) {
      bindingSource = 'group';
      bindingPromptId = groupSetting.agent_prompt_id.trim();
    }
  } else if (chatType !== 'group' && Number.isFinite(userId) && userId > 0) {
    const privateRows = await prisma.$queryRaw(
      Prisma.sql`SELECT agent_prompt_id
                 FROM private_chat_settings
                 WHERE user_id = ${BigInt(userId)}
                 LIMIT 1`
    );
    const privateSetting = Array.isArray(privateRows) ? privateRows[0] : null;

    if (privateSetting && typeof privateSetting.agent_prompt_id === 'string' && privateSetting.agent_prompt_id.trim().length > 0) {
      bindingSource = 'private';
      bindingPromptId = privateSetting.agent_prompt_id.trim();
    }
  }

  if (!bindingSource || !bindingPromptId) {
    return null;
  }

  const promptRows = await prisma.$queryRaw(
    Prisma.sql`SELECT id,
                      prompt_name,
                      agent_type,
                      system_instructions,
                      user_prompt_template,
                      context_variables,
                      model_name,
                      model_config,
                      advanced_config
               FROM agent_prompts
               WHERE id = ${bindingPromptId}
                 AND is_active = 1
               LIMIT 1`
  );
  const prompt = Array.isArray(promptRows) ? promptRows[0] : null;

  if (!prompt) {
    return {
      bindingSource,
      bindingPromptId,
      prompt: null
    };
  }

  return {
    bindingSource,
    bindingPromptId,
    prompt: {
      id: prompt.id,
      promptName: prompt.prompt_name,
      agentType: prompt.agent_type,
      systemInstruction: parsePromptText(prompt.system_instructions),
      userPromptTemplate: typeof prompt.user_prompt_template === 'string' ? prompt.user_prompt_template : null,
      contextVariables: parseJsonValue(prompt.context_variables, {}),
      modelName: typeof prompt.model_name === 'string' && prompt.model_name.trim().length > 0 ? prompt.model_name.trim() : null,
      modelConfig: parseJsonValue(prompt.model_config, {}),
      advancedConfig: parseJsonValue(prompt.advanced_config, {})
    }
  };
}

const trafficPersistence = createTrafficPersistence({
  getPrismaClient,
  Prisma
});

const relationshipMemoryPersistence = createRelationshipMemoryPersistence({
  getPrismaClient,
  createSqlAdapter
});

const selfEvolutionPersistence = createSelfEvolutionPersistence({
  getPrismaClient,
  createSqlAdapter
});

const feedbackReflectionPersistence = createFeedbackReflectionPersistence({
  getPrismaClient,
  createSqlAdapter
});

const identityLineagePersistence = createIdentityLineagePersistence({
  getPrismaClient,
  createSqlAdapter
});

const topicLabPersistence = createTopicLabPersistence({
  getPrismaClient,
  createSqlAdapter
});

const imageLabPersistence = createImageLabPersistence({
  getPrismaClient,
  createSqlAdapter
});

const agentMediaPersistence = createAgentMediaPersistence({
  getPrismaClient,
  createSqlAdapter
});

const agentTaskPersistence = createAgentTaskPersistence({
  getPrismaClient,
  createSqlAdapter
});

const abExperimentPersistence = createAbExperimentPersistence({
  getPrismaClient,
  createSqlAdapter
});

module.exports = {
  Prisma,
  buildDatabaseUrl,
  resolveDatabaseUrl,
  createSqlAdapter,
  getPrismaClient,
  closePrismaClient,
  resolveChatAgentPrompt,
  ...require('./time'),
  ...trafficPersistence,
  ...relationshipMemoryPersistence,
  ...selfEvolutionPersistence,
  ...feedbackReflectionPersistence,
  ...identityLineagePersistence,
  ...topicLabPersistence,
  ...imageLabPersistence,
  ...agentMediaPersistence,
  ...agentTaskPersistence,
  ...abExperimentPersistence
};

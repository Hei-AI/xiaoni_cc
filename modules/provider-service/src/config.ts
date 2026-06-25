import dotenv from 'dotenv';
import { buildDatabaseUrl, STORAGE_TIMEZONE } from '@qq-bot/persistence';
import { AIConfig } from './types';

dotenv.config();

export const serverConfig = {
  host: process.env.HTTP_HOST || '0.0.0.0',
  port: Number.parseInt(process.env.HTTP_PORT || '8091', 10)
};

export const aiConfig: AIConfig = {
  gemini_api_keys: (process.env.GEMINI_API_KEYS || '').split(',').filter(key => key.trim()),
  model_name: process.env.AI_MODEL_NAME || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  gemini_cli_access_token: process.env.GEMINI_CLI_ACCESS_TOKEN || undefined,
  gemini_cli_refresh_token: process.env.GEMINI_CLI_REFRESH_TOKEN || undefined,
  gemini_cli_project_id: process.env.GEMINI_CLI_PROJECT_ID || undefined,
  gemini_cli_expires_at: process.env.GEMINI_CLI_EXPIRES_AT || undefined,
  gemini_cli_oauth_path: process.env.GEMINI_CLI_OAUTH_PATH || undefined,
  gemini_cli_base_url: process.env.GEMINI_CLI_BASE_URL || undefined,
  gemini_cli_stream_path: process.env.GEMINI_CLI_STREAM_PATH || undefined,
  openai_api_key: process.env.OPENAI_API_KEY || undefined,
  openai_base_url: process.env.OPENAI_BASE_URL || undefined,
  embedding_enabled: process.env.EMBEDDING_ENABLED === 'true',
  embedding_base_url: process.env.EMBEDDING_BASE_URL || undefined,
  embedding_model_id: process.env.EMBEDDING_MODEL_ID || 'embeddinggemma-300m',
  embedding_model_source: process.env.EMBEDDING_MODEL_SOURCE || undefined,
  embedding_timeout_ms: Number.parseInt(process.env.EMBEDDING_TIMEOUT_MS || '30000', 10),
  embedding_normalize: Number.parseInt(process.env.EMBEDDING_NORMALIZE || '2', 10),
  codex_access_token: process.env.CODEX_OAUTH_ACCESS_TOKEN || undefined,
  codex_refresh_token: process.env.CODEX_OAUTH_REFRESH_TOKEN || undefined,
  codex_expires_at: process.env.CODEX_OAUTH_EXPIRES_AT || undefined,
  codex_account_id: process.env.CODEX_ACCOUNT_ID || undefined,
  codex_base_url: process.env.CODEX_BASE_URL || undefined,
  codex_oauth_path: process.env.CODEX_OAUTH_PATH || undefined,
  codex_responses_path: process.env.CODEX_RESPONSES_PATH || undefined,
  codex_proxy_api_key: process.env.CODEX_PROXY_API_KEY || undefined,
  anthropic_access_token: process.env.ANTHROPIC_OAUTH_ACCESS_TOKEN || undefined,
  anthropic_refresh_token: process.env.ANTHROPIC_OAUTH_REFRESH_TOKEN || undefined,
  anthropic_expires_at: process.env.ANTHROPIC_OAUTH_EXPIRES_AT || undefined,
  anthropic_oauth_path: process.env.ANTHROPIC_OAUTH_PATH || undefined,
  anthropic_base_url: process.env.ANTHROPIC_BASE_URL || undefined,
  anthropic_client_version: process.env.ANTHROPIC_CLIENT_VERSION || undefined,
  anthropic_beta: process.env.ANTHROPIC_BETA || undefined,
  anthropic_billing_header: process.env.ANTHROPIC_BILLING_HEADER || undefined,
  authorized_user_id: Number.parseInt(process.env.AUTHORIZED_USER_ID || '85178516', 10),
  bot_qq_number: Number.parseInt(process.env.BOT_QQ_NUMBER || '1129974489', 10)
};

export const napcatConfig = {
  baseUrl: (process.env.NAPCAT_HTTP_BASE_URL || 'http://napcat:3000').replace(/\/$/, ''),
  accessToken: process.env.NAPCAT_HTTP_ACCESS_TOKEN || process.env.WEBSOCKET_ACCESS_TOKEN || '',
  timeoutMs: Number.parseInt(process.env.NAPCAT_HTTP_TIMEOUT_MS || '10000', 10),
  webUiBaseUrl: (process.env.NAPCAT_WEBUI_BASE_URL || 'http://napcat:6099').replace(/\/$/, ''),
  webUiToken: process.env.NAPCAT_WEBUI_TOKEN || process.env.NAPCAT_HTTP_ACCESS_TOKEN || process.env.WEBSOCKET_ACCESS_TOKEN || '',
  webUiTimeoutMs: Number.parseInt(process.env.NAPCAT_WEBUI_TIMEOUT_MS || '10000', 10)
};

export const databaseConfig = {
  url: process.env.DATABASE_URL || buildDatabaseUrl({
    host: process.env.DB_HOST || 'qqbot-postgres',
    port: Number.parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'qqbot_user',
    password: process.env.DB_PASSWORD || 'qqbot_password',
    database: process.env.DB_NAME || 'qqbot_db',
    connectionLimit: Number.parseInt(process.env.DB_CONNECTION_LIMIT || '5', 10)
  }),
  host: process.env.DB_HOST || 'qqbot-postgres',
  port: Number.parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'qqbot_user',
  password: process.env.DB_PASSWORD || 'qqbot_password',
  database: process.env.DB_NAME || 'qqbot_db',
  connectionLimit: Number.parseInt(process.env.DB_CONNECTION_LIMIT || '5', 10),
  timezone: process.env.DB_TIMEZONE || STORAGE_TIMEZONE
};

export const agentRunConfig = {
  batchWindowMs: Math.max(200, Number.parseInt(process.env.AGENT_RUN_BATCH_WINDOW_MS || '4000', 10))
};

export const selfEvolutionConfig = {
  enabled: process.env.SELF_EVOLUTION_ENABLED !== 'false',
  webhookUrl: process.env.SELF_EVOLUTION_WEBHOOK_URL || `http://127.0.0.1:${serverConfig.port}/api/internal/self-evolution/execute`,
  minNewTurns: Math.max(1, Number.parseInt(process.env.SELF_EVOLUTION_MIN_NEW_TURNS || '6', 10)),
  minNewLedgerEvents: Math.max(1, Number.parseInt(process.env.SELF_EVOLUTION_MIN_NEW_LEDGER_EVENTS || '2', 10)),
  modelName: process.env.SELF_EVOLUTION_MODEL_NAME || process.env.AI_MODEL_NAME || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  timeoutMs: Math.max(1000, Number.parseInt(process.env.SELF_EVOLUTION_TIMEOUT_MS || '90000', 10))
};

export const topicProjectionConfig = {
  enabled: process.env.TOPIC_PROJECTION_ENABLED !== 'false',
  webhookUrl: process.env.TOPIC_PROJECTION_WEBHOOK_URL || `http://127.0.0.1:${serverConfig.port}/api/internal/topic-projection/execute`,
  minNewTurns: Math.max(1, Number.parseInt(process.env.TOPIC_PROJECTION_MIN_NEW_TURNS || '6', 10)),
  minNewLedgerEvents: Math.max(1, Number.parseInt(process.env.TOPIC_PROJECTION_MIN_NEW_LEDGER_EVENTS || '2', 10))
};

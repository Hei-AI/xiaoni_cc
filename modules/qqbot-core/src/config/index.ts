import dotenv from 'dotenv';
import { AppConfig } from '../types';

dotenv.config();

export const config: AppConfig = {
  database: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    database: process.env.MYSQL_DATABASE || 'qqbot_db',
    user: process.env.MYSQL_USER || 'qqbot_user',
    password: process.env.MYSQL_PASSWORD || 'qqbot_password',
    charset: 'utf8mb4',
    timezone: '+08:00'
  },
  
  websocket: {
    host: process.env.WEBSOCKET_HOST || 'host.docker.internal',
    port: parseInt(process.env.WEBSOCKET_PORT || '3001', 10),
    access_token: process.env.WEBSOCKET_ACCESS_TOKEN || 'w@123456',
    get uri() {
      return `ws://${this.host}:${this.port}?access_token=${this.access_token}`;
    }
  },
  
  http_server: {
    host: process.env.HTTP_HOST || '0.0.0.0',
    port: parseInt(process.env.HTTP_PORT || '8080', 10)
  },
  
  ai: {
    gemini_api_keys: (process.env.GEMINI_API_KEYS || '').split(',').filter(key => key.trim()),
    model_name: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
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
    embedding_timeout_ms: parseInt(process.env.EMBEDDING_TIMEOUT_MS || '30000', 10),
    embedding_normalize: parseInt(process.env.EMBEDDING_NORMALIZE || '2', 10),
    codex_access_token: process.env.CODEX_OAUTH_ACCESS_TOKEN || undefined,
    codex_refresh_token: process.env.CODEX_OAUTH_REFRESH_TOKEN || undefined,
    codex_expires_at: process.env.CODEX_OAUTH_EXPIRES_AT || undefined,
    codex_account_id: process.env.CODEX_ACCOUNT_ID || undefined,
    codex_base_url: process.env.CODEX_BASE_URL || undefined,
    codex_oauth_path: process.env.CODEX_OAUTH_PATH || undefined,
    codex_responses_path: process.env.CODEX_RESPONSES_PATH || undefined,
    authorized_user_id: parseInt(process.env.AUTHORIZED_USER_ID || '85178516', 10),
    bot_qq_number: parseInt(process.env.BOT_QQ_NUMBER || '1129974489', 10)
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file_prefix: process.env.LOG_FILE_PREFIX || 'qqbot'
  }
};

export default config;

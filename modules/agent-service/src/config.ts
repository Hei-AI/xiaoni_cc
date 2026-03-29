import dotenv from 'dotenv';
import { buildDatabaseUrl } from '@qq-bot/persistence';

dotenv.config();

export const serverConfig = {
  host: process.env.HTTP_HOST || '0.0.0.0',
  port: Number.parseInt(process.env.HTTP_PORT || '8092', 10)
};

export const databaseConfig = {
  url: process.env.DATABASE_URL || buildDatabaseUrl({
    host: process.env.DB_HOST || 'qqbot-postgres',
    port: Number.parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'qqbot_user',
    password: process.env.DB_PASSWORD || 'qqbot_password',
    database: process.env.DB_NAME || 'qqbot_db'
  }),
  host: process.env.DB_HOST || 'qqbot-postgres',
  port: Number.parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'qqbot_user',
  password: process.env.DB_PASSWORD || 'qqbot_password',
  database: process.env.DB_NAME || 'qqbot_db'
};

export const agentConfig = {
  providerServiceUrl: (process.env.PROVIDER_SERVICE_URL || 'http://127.0.0.1:8091').replace(/\/$/, ''),
  modelName: process.env.AI_MODEL_NAME || 'gpt-5.4-mini',
  maxTurns: Math.max(1, Number.parseInt(process.env.AGENT_MAX_TURNS || '8', 10)),
  pollIntervalMs: Math.max(200, Number.parseInt(process.env.AGENT_QUEUE_POLL_INTERVAL_MS || '1000', 10)),
  idleIntervalMs: Math.max(200, Number.parseInt(process.env.AGENT_QUEUE_IDLE_INTERVAL_MS || '2000', 10)),
  workerId: process.env.AGENT_WORKER_ID || `agent-service-${process.pid}`,
  systemPrompt: process.env.AGENT_LOOP_SYSTEM_PROMPT || [
    'You are the main QQ chat agent.',
    'You must use tools to act. Plain text is not enough to finish a turn.',
    'Available tools are send_private_message, send_group_message, and finish.',
    'Both send tools accept either message or messages. Use messages when you need to split a reply into multiple outbound messages.',
    'send_group_message also accepts optional mention_user_ids for @mentions. If mentions are provided with multiple messages, they apply only to the first outbound message.',
    'You may send multiple messages before finishing.',
    'Call finish only when you are certain no more messages should be sent in this run.',
    'If no reply should be sent, call finish without any send tool first and explain the reason.'
  ].join('\n')
};

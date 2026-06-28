import dotenv from 'dotenv';
import { buildDatabaseUrl } from '@qq-bot/persistence';
import {
  XIAONI_MAIN_AGENT_DEFAULT_MODEL,
  getXiaoniMainAgentSystemPrompt
} from './prompts/xiaoni-main-agent';

dotenv.config();

function readBooleanEnv(name: string, defaultValue: boolean) {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function readReasoningEffortEnv(name: string, defaultValue: string) {
  const value = process.env[name]?.trim().toLowerCase();
  return value === 'none'
    || value === 'minimal'
    || value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh'
    ? value
    : defaultValue;
}

function readTextVerbosityEnv(name: string, defaultValue: 'low' | 'medium' | 'high'): 'low' | 'medium' | 'high' {
  const value = process.env[name]?.trim().toLowerCase();
  return value === 'low' || value === 'medium' || value === 'high' ? value : defaultValue;
}

function readIntegerEnv(name: string, defaultValue: number) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) ? value : defaultValue;
}

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
    database: process.env.DB_NAME || 'qqbot_db',
    connectionLimit: Number.parseInt(process.env.DB_CONNECTION_LIMIT || '5', 10)
  }),
  host: process.env.DB_HOST || 'qqbot-postgres',
  port: Number.parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'qqbot_user',
  password: process.env.DB_PASSWORD || 'qqbot_password',
  database: process.env.DB_NAME || 'qqbot_db',
  connectionLimit: Number.parseInt(process.env.DB_CONNECTION_LIMIT || '5', 10)
};

const mainAgentTurnTimeoutMs = Math.max(1000, Number.parseInt(process.env.AGENT_MAIN_TURN_TIMEOUT_MS || '300000', 10));
const mainAgentPreModelYieldMs = Math.max(0, readIntegerEnv('AGENT_MAIN_PRE_MODEL_YIELD_MS', 5000));
const queueIdleIntervalMs = Math.max(200, Number.parseInt(process.env.AGENT_QUEUE_IDLE_INTERVAL_MS || '2000', 10));
const providerExecutionRetryAttempts = Math.max(1, readIntegerEnv('AGENT_PROVIDER_EXECUTION_RETRY_ATTEMPTS', 3));
const providerExecutionRetryBaseDelayMs = Math.max(0, readIntegerEnv('AGENT_PROVIDER_EXECUTION_RETRY_BASE_DELAY_MS', 1500));
const queueTransientRetryBaseDelayMs = Math.max(0, readIntegerEnv('AGENT_QUEUE_TRANSIENT_RETRY_BASE_DELAY_MS', 5000));
const queueTransientRetryMaxDelayMs = Math.max(
  queueTransientRetryBaseDelayMs,
  readIntegerEnv('AGENT_QUEUE_TRANSIENT_RETRY_MAX_DELAY_MS', 60_000)
);
const DEFAULT_GLOBAL_PROMPT_CONTEXT_SESSION_KEY = 'xiaoni:global';

export function getGlobalPromptContextSessionKey() {
  const value = process.env.XIAONI_GLOBAL_PROMPT_CONTEXT_SESSION_KEY;
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : DEFAULT_GLOBAL_PROMPT_CONTEXT_SESSION_KEY;
}

export const agentConfig = {
  providerServiceUrl: (process.env.PROVIDER_SERVICE_URL || 'http://127.0.0.1:8091').replace(/\/$/, ''),
  xiaoniExecutorUrl: (process.env.XIAONI_EXECUTOR_URL || '').replace(/\/$/, ''),
  modelName: process.env.AI_MODEL_NAME || 'gpt-5-mini',
  xiaoniMainAgentModelName: process.env.XIAONI_MAIN_AGENT_MODEL || XIAONI_MAIN_AGENT_DEFAULT_MODEL,
  activeImClaimLimit: Math.max(1, Number.parseInt(process.env.AGENT_IM_TRIGGER_CLAIM_LIMIT || '200', 10) || 200),
  compactMemoryModelName: process.env.AGENT_COMPACT_MEMORY_MODEL || 'gpt-5.5',
  compactMemoryReflectionModelName: process.env.AGENT_COMPACT_MEMORY_REFLECTION_MODEL || process.env.AGENT_COMPACT_MEMORY_MODEL || 'gpt-5.5',
  compactMemoryReasoningEffort: readReasoningEffortEnv('AGENT_COMPACT_MEMORY_REASONING_EFFORT', 'high'),
  compactMemoryReflectionReasoningEffort: readReasoningEffortEnv('AGENT_COMPACT_MEMORY_REFLECTION_REASONING_EFFORT', 'high'),
  compactMemoryTextVerbosity: readTextVerbosityEnv('AGENT_COMPACT_MEMORY_TEXT_VERBOSITY', 'medium'),
  mainAgentTurnTimeoutMs,
  mainAgentPreModelYieldMs,
  providerExecutionRetryAttempts,
  providerExecutionRetryBaseDelayMs,
  queueTransientRetryBaseDelayMs,
  queueTransientRetryMaxDelayMs,
  compactMemoryTimeoutMs: Math.max(1000, Number.parseInt(process.env.AGENT_COMPACT_MEMORY_TIMEOUT_MS || '300000', 10)),
  promptCacheRetention: process.env.AGENT_PROMPT_CACHE_RETENTION || '',
  cacheHeartbeatEnabled: readBooleanEnv('AGENT_CACHE_HEARTBEAT_ENABLED', true),
  cacheHeartbeatIntervalMs: Math.max(
    60 * 1000,
    readIntegerEnv('AGENT_CACHE_HEARTBEAT_INTERVAL_MS', 30 * 60 * 1000)
  ),
  cacheHeartbeatMaxOutputTokens: Math.max(
    1,
    Math.min(16, readIntegerEnv('AGENT_CACHE_HEARTBEAT_MAX_OUTPUT_TOKENS', 1))
  ),
  cacheHeartbeatTimeoutMs: Math.max(
    1000,
    readIntegerEnv('AGENT_CACHE_HEARTBEAT_TIMEOUT_MS', 10_000)
  ),
  preReplyMemoryReasonerEnabled: false,
  preReplyMemoryReasonerModelName: process.env.AGENT_PRE_REPLY_MEMORY_REASONER_MODEL || 'gpt-5.4',
  presentSelfReconstructionEnabled: false,
  presentSelfReconstructionModelName: process.env.AGENT_PRESENT_SELF_RECONSTRUCTION_MODEL || 'gpt-5.4',
  // Custom web_search (client-executed in agent-service → Tavily/Google CSE,
  // never through the Anthropic cloak). Static per process so the cached tools
  // prefix stays byte-stable across the main loop and its forks.
  webSearchEnabled: readBooleanEnv('AGENT_WEB_SEARCH_ENABLED', true),
  webSearchDefaultSource: (process.env.AGENT_WEB_SEARCH_DEFAULT_SOURCE === 'searxng' ? 'searxng' : 'tavily') as 'tavily' | 'searxng',
  webSearchMaxResults: readIntegerEnv('AGENT_WEB_SEARCH_MAX_RESULTS', 6),
  webSearchTimeoutMs: readIntegerEnv('AGENT_WEB_SEARCH_TIMEOUT_MS', 15000),
  // Oversized results spill here; both agent-service and xiaoni-executor mount
  // this host dir RW, so 小腻's exec_command can grep/cat the same file.
  webSearchResultDir: process.env.AGENT_WEB_SEARCH_RESULT_DIR
    || `${process.env.XIAONI_RUNTIME_ROOT || '/xiaoni-runtime'}/web-search`,
  webSearchResultPageChars: readIntegerEnv('AGENT_WEB_SEARCH_PAGE_CHARS', 6000),
  webSearchResultTtlDays: readIntegerEnv('AGENT_WEB_SEARCH_RESULT_TTL_DAYS', 7),
  webSearchDailyLimit: readIntegerEnv('AGENT_WEB_SEARCH_DAILY_LIMIT', 200),
  // Tavily (default source): hosted, one call returns content. Key in agent-service.env.
  tavilyApiKey: process.env.AGENT_WEB_SEARCH_TAVILY_API_KEY || '',
  tavilyApiUrl: process.env.AGENT_WEB_SEARCH_TAVILY_URL || 'https://api.tavily.com/search',
  // SearXNG (source=searxng): self-hosted OSS metasearch, no key/quota. Internal
  // container; JSON output + limiter:false must be enabled in its settings.yml.
  searxngUrl: process.env.AGENT_WEB_SEARCH_SEARXNG_URL || 'http://qqbot-searxng:8080/search',
  // Anthropic computer-use browser tool (Claude models only). Static per process so
  // the cached tools prefix stays byte-stable across the main loop and its forks.
  computerUseEnabled: readBooleanEnv('AGENT_COMPUTER_USE_ENABLED', false),
  // Host Playwright bridge for executing computer-use actions (same bridge the
  // xiaoni-browser skill drives). From containers the host is 172.18.0.1.
  computerUseBridgeUrl: process.env.XIAONI_BROWSER_BRIDGE_URL || 'http://172.18.0.1:9977',
  maxTurns: Math.max(1, Number.parseInt(process.env.AGENT_MAX_TURNS || '8', 10)),
  idleIntervalMs: queueIdleIntervalMs,
  processingRecoveryStaleMs: Math.max(
    5 * 60 * 1000,
    Number.parseInt(process.env.AGENT_PROCESSING_RECOVERY_STALE_MS || '', 10) || (mainAgentTurnTimeoutMs * 2)
  ),
  workerId: process.env.AGENT_WORKER_ID || `agent-service-${process.pid}`,
  botAccountId: process.env.BOT_QQ_NUMBER || '1129974489',
  get systemPrompt() {
    return getXiaoniMainAgentSystemPrompt();
  }
};

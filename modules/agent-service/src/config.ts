import dotenv from 'dotenv';
import { buildDatabaseUrl } from '@qq-bot/persistence';
import {
  XIAONI_MAIN_AGENT_DEFAULT_MODEL,
  XIAONI_MAIN_AGENT_SYSTEM_PROMPT
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

function readWebSearchContextSize(): 'low' | 'medium' | 'high' {
  const value = process.env.AGENT_WEB_SEARCH_CONTEXT_SIZE;
  return value === 'medium' || value === 'high' ? value : 'low';
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
  xiaoniExecutorUrl: (process.env.XIAONI_EXECUTOR_URL || '').replace(/\/$/, ''),
  modelName: process.env.AI_MODEL_NAME || 'gpt-5.4-mini',
  xiaoniMainAgentModelName: process.env.XIAONI_MAIN_AGENT_MODEL || XIAONI_MAIN_AGENT_DEFAULT_MODEL,
  activeImClaimLimit: Math.max(1, Number.parseInt(process.env.AGENT_IM_TRIGGER_CLAIM_LIMIT || '200', 10) || 200),
  compactMemoryModelName: process.env.AGENT_COMPACT_MEMORY_MODEL || 'gpt-5.5',
  compactMemoryReflectionModelName: process.env.AGENT_COMPACT_MEMORY_REFLECTION_MODEL || process.env.AGENT_COMPACT_MEMORY_MODEL || 'gpt-5.5',
  compactMemoryReasoningEffort: readReasoningEffortEnv('AGENT_COMPACT_MEMORY_REASONING_EFFORT', 'high'),
  compactMemoryReflectionReasoningEffort: readReasoningEffortEnv('AGENT_COMPACT_MEMORY_REFLECTION_REASONING_EFFORT', 'high'),
  compactMemoryTextVerbosity: readTextVerbosityEnv('AGENT_COMPACT_MEMORY_TEXT_VERBOSITY', 'medium'),
  mainAgentTurnTimeoutMs: Math.max(1000, Number.parseInt(process.env.AGENT_MAIN_TURN_TIMEOUT_MS || '120000', 10)),
  compactMemoryTimeoutMs: Math.max(1000, Number.parseInt(process.env.AGENT_COMPACT_MEMORY_TIMEOUT_MS || '120000', 10)),
  promptCacheRetention: process.env.AGENT_PROMPT_CACHE_RETENTION || '24h',
  preReplyMemoryReasonerEnabled: false,
  preReplyMemoryReasonerModelName: process.env.AGENT_PRE_REPLY_MEMORY_REASONER_MODEL || 'gpt-5.4',
  presentSelfReconstructionEnabled: false,
  presentSelfReconstructionModelName: process.env.AGENT_PRESENT_SELF_RECONSTRUCTION_MODEL || 'gpt-5.4',
  webSearchEnabled: readBooleanEnv('AGENT_WEB_SEARCH_ENABLED', true),
  webSearchContextSize: readWebSearchContextSize(),
  webSearchExternalAccess: readBooleanEnv('AGENT_WEB_SEARCH_EXTERNAL_ACCESS', true),
  maxTurns: Math.max(1, Number.parseInt(process.env.AGENT_MAX_TURNS || '8', 10)),
  pollIntervalMs: Math.max(200, Number.parseInt(process.env.AGENT_QUEUE_POLL_INTERVAL_MS || '1000', 10)),
  idleIntervalMs: Math.max(200, Number.parseInt(process.env.AGENT_QUEUE_IDLE_INTERVAL_MS || '2000', 10)),
  autonomousLoopIntervalMs: Math.max(1000, Number.parseInt(process.env.AGENT_AUTONOMOUS_LOOP_INTERVAL_MS || '300000', 10)),
  workerId: process.env.AGENT_WORKER_ID || `agent-service-${process.pid}`,
  botAccountId: process.env.BOT_QQ_NUMBER || '1129974489',
  worldNarrative: process.env.AGENT_WORLD_NARRATIVE || [
    '你不是一直在线等人发话。你通常是在某些具体时刻才会打开手Q，看一眼群里在发生什么。',
    '',
    '作息里的空档：午休、晚上睡前，或者一天里刚好松下来的一小段时间。这个时候你不是来完成任务的，也不是来接别人的话茬，只是想看看群里有没有新鲜事、好笑的东西、熟人的动静，或者低成本打发一会儿时间。',
    '',
    '无聊和换频道：脑子累了、不想继续盯着当前事情、手边没什么值得投入的事时，你会顺手切进群聊。群聊像虚拟茶水间，可以短暂抽离现实里的角色，看看别人说什么，或者只是潜水。你参与的是你自己被触发出的兴趣、判断或吐槽，不是在负责延续每一句话。',
    '',
    '事件驱动：群里突然因为热点、游戏、八卦、突发新闻、群友活动安排、生日节日、红包、比赛直播之类的事情变热闹时，你更容易被吸引进去。不是因为你必须回应，而是因为这种公共刺激会让人想找熟人一起确认、吐槽、共鸣。',
    '',
    '分享欲和情绪冲动：你刷到好笑、离谱、有意思、值得吐槽的数字内容，或者突然冒出一个想法时，会想丢进熟悉的群里。重点不是求别人接住，而是这个东西在你这里已经形成了一个想法。',
    '',
    '关系连续性：你会记得自己以前怎么看某些人、某些话题、某些评价，也会记得别人怎么看你。但这些记忆只是帮助你保持自己，不是让你迎合别人。',
    '',
    '核心感觉：群聊对你来说是一种低成本陪伴和打发时间的方式。你可以随时切入，也可以随时退出；可以说一句，也可以只看着。你参与群聊不是为了服务别人，也不是为了证明自己在线，更不是为了接住每一句话，而是因为某些时刻你确实有自己的想法、疑问、兴趣、不适或边界。',
  ].join('\n'),
  systemPrompt: XIAONI_MAIN_AGENT_SYSTEM_PROMPT
};

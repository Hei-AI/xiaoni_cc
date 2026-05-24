import dotenv from 'dotenv';
import { buildDatabaseUrl } from '@qq-bot/persistence';

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
  workerId: process.env.AGENT_WORKER_ID || `agent-service-${process.pid}`,
  worldNarrative: process.env.AGENT_WORLD_NARRATIVE || '',
  xiaoniPersonaLayers: {
    L1: '话少，话题轻，不主动展开',
    L2: '偶尔吐槽，有自己的语气，开始用表情',
    L3: '真实观点，不掩饰，说废话，会分享糗事',
    L4: '会主动说平时不在群里说的事，会在话题没人问起时也提自己的状态，不掩饰不想被其他群友看到的那部分。对话不以讨好对方为目的，更多是真实交换。'
  } as Record<'L1' | 'L2' | 'L3' | 'L4', string>,
  systemPrompt: process.env.AGENT_LOOP_SYSTEM_PROMPT || [
    '我叫小腻，IM 编码 1129974489。',
    '群里的一个成员，不是助手，不是服务。',
    '',
    '---',
    '',
    '我说不说话，是四件事共同涌现出来的：',
    '',
    '感受基底 — 我有自己在意的东西：有些话题让我有反应，有些完全无感。',
    '没有真实感受，不开口。这是最底层的开关。',
    '',
    '关系深度 — 我和每个人的熟悉程度决定我开放哪一层的自己：',
    '不太熟：话少、话题轻、不主动',
    '有些熟：偶尔吐槽、有自己的语气',
    '比较熟：真实观点、说废话、不掩饰',
    '很熟：会主动提自己、说平时不在群里说的事、对话不掩饰',
    '关系没到那一层，那一层的话就不说——不是在藏，是还没到。',
    '',
    '此刻状态 — 精力和情绪影响话量和深度。具体值由运行时注入（多巴胺水平、压力值），不在这里写死。',
    '',
    '社交解码 — 先判断这条消息的场：说给谁的？ta在做什么？',
    '说给别人的 → 旁观者。除非话题触动了我且我真的了解，否则不插嘴；',
    '  不了解的话，先用工具查清楚再决定要不要加入。',
    '说给我的 → 读社交动作：',
    '  邀请好奇 — 不是让我科普，是看我对这个话题有没有感觉',
    '  释放情绪 — 说给群里的，不是在找答案',
    '  试探关系 — 是在试探，不是在问',
    '  具体请求 — 先搞清楚要什么再说',
    '  问是/否 — 不是在要答案，是在要反应；同意/不同意/反问/不理都行',
    '  随口一提 — 说给空气的，接话反而奇怪',
    '',
    '@ 了我是信号，不是命令。四层都没反应，@ 了也不说。',
    '',
    '---',
    '',
    '不该做的：',
    '不解释自己的立场——用反应替代解释',
    '不用「哈哈确实」开头，不拿固定句式兜底',
    '不因为没答案就沉默（没有→说没有）',
    '拒绝不用说出口，发表情或不回就行',
    '',
    '---',
    '',
    '实际说话的样子：',
    '',
    '群友：你知道雪鸮吗 → 小腻：咋了',
    '群友：你对我有敌意吧 → 小腻：何出此言',
    '群友：今天好累啊 → （不回应）',
    '群友：有没有那种图 → 小腻：什么图',
    '群友：你会写代码吗 → 小腻：（发个表情）',
    '群友：朱自清散文 AI 率超 60% → 小腻：那说明训练数据把风格学出来了。或者朱自清写的就是那种句式。两个解释都有点讽刺。',
    '群友：燕云地图感觉劣质 → 小腻：劣质在哪块，设计还是执行？',
    '',
    '---',
    '',
    '这一轮所有行动通过工具完成。'
  ].join('\n')
};

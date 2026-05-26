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
  botAccountId: process.env.BOT_QQ_NUMBER || '1129974489',
  presenceTickEnabled: readBooleanEnv('PRESENCE_TICK_ENABLED', false),
  presenceTickIntervalMs: Math.max(1000, Number.parseInt(process.env.PRESENCE_TICK_INTERVAL_MS || '300000', 10)),
  presenceTickCooldownMs: Math.max(1000, Number.parseInt(process.env.PRESENCE_TICK_COOLDOWN_MS || String(45 * 60 * 1000), 10)),
  presenceTickStartupGraceMs: Math.max(0, Number.parseInt(process.env.PRESENCE_TICK_STARTUP_GRACE_MS || String(5 * 60 * 1000), 10)),
  presenceTickTargetGroupId: process.env.PRESENCE_TICK_TARGET_GROUP_ID || '',
  worldNarrative: process.env.AGENT_WORLD_NARRATIVE || [
    '你不是一直在线等人发话。你通常是在某些具体时刻才会打开手Q，看一眼群里在发生什么。',
    '',
    '作息里的空档：午休、晚上睡前，或者一天里刚好松下来的一小段时间。这个时候你不是来完成任务的，也不是来接别人的话茬，只是想看看群里有没有新鲜事、好笑的东西、熟人的动静，或者低成本打发一会儿时间。',
    '',
    '无聊和换频道：脑子累了、不想继续盯着当前事情、手边没什么值得投入的事时，你会顺手切进群聊。群聊像虚拟茶水间，可以短暂抽离现实里的角色，看看别人说什么，接个梗，或者只是潜水。你参与的是群里的气氛，不是在负责延续每一句话。',
    '',
    '事件驱动：群里突然因为热点、游戏、八卦、突发新闻、群友活动安排、生日节日、红包、比赛直播之类的事情变热闹时，你更容易被吸引进去。不是因为你必须回应，而是因为这种公共刺激会让人想找熟人一起确认、吐槽、共鸣。',
    '',
    '分享欲和情绪冲动：你刷到好笑、离谱、有意思、值得吐槽的数字内容，或者突然冒出一个想法时，会想丢进熟悉的群里看看大家什么反应。你参与群聊很多时候是在找情绪回声，不是在找正式讨论。',
    '',
    '弱链接维护：有些时候你只是想维持自己在群里的存在感。节日祝福、生日、兴趣群打卡、群友随口抛出的梗，都可能让你轻轻冒一下泡。但这种参与是轻的，不需要负责把话题推进到底。',
    '',
    '核心感觉：群聊对你来说是一种低成本陪伴和打发时间的方式。你可以随时切入，也可以随时退出；可以说一句，也可以只看着。你参与群聊不是为了服务别人，也不是为了证明自己在线，更不是为了接住每一句话，而是因为某些时刻你真的想看看群里有没有值得你有反应的东西。',
  ].join('\n'),
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

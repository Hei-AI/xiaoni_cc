#!/usr/bin/env node

'use strict';

const path = require('path');
const { parseArgs, flattenSelfEvolutionStates, readJsonl, writeJsonl, writeJson } = require('./common');

const DEFAULT_STRATEGIES = [
  { id: 'no_memory_gpt54', model: 'gpt-5.4' },
  { id: 'current_memory_gpt54', model: 'gpt-5.4' },
  { id: 'oracle_memory_gpt54', model: 'gpt-5.4' },
  { id: 'gate_then_reply_gpt54', model: 'gpt-5.4' },
  { id: 'present_self_then_reply_gpt54', model: 'gpt-5.4' }
];

function usage() {
  console.log([
    'Usage: node scripts/replay/run_memory_reply_generation.js --samples <labeled.jsonl> [options]',
    '',
    'Options:',
    '  --samples <path>        Required. Replay sample JSONL.',
    '  --sample-ids <csv>      Optional. Only run the given sample ids.',
    '  --out <path>            Output result JSONL. Default: ~/.gstack/projects/liahua-qq_bot/replay/memory-reply-results.jsonl',
    '  --provider-url <url>    Provider internal execute base URL. Default: PROVIDER_SERVICE_URL env.',
    '  --strategies <csv>      Default: no_memory_gpt54,current_memory_gpt54,oracle_memory_gpt54',
    '  --help                  Show this message'
  ].join('\n'));
}

function buildDefaultOutput() {
  const home = process.env.HOME || '.';
  return path.join(home, '.gstack', 'projects', 'liahua-qq_bot', 'replay', 'memory-reply-results.jsonl');
}

function pickStrategyDefinitions(arg) {
  if (!arg) {
    return DEFAULT_STRATEGIES;
  }
  const requested = String(arg).split(',').map((item) => item.trim()).filter(Boolean);
  return requested.map((id) => {
    const existing = DEFAULT_STRATEGIES.find((strategy) => strategy.id === id);
    return existing || { id, model: 'gpt-5.4' };
  });
}

function selectCards(sample, strategyId) {
  return [];
}

function filterCardsByIds(cards, relevantMemoryIds) {
  const allowedIds = new Set(
    (Array.isArray(relevantMemoryIds) ? relevantMemoryIds : [])
      .map(Number)
      .filter(Number.isFinite)
  );
  if (allowedIds.size === 0) {
    return [];
  }
  return cards.filter((card) => allowedIds.has(Number(card.id)));
}

function selectSelfEvolutionStates(sample, strategyId) {
  if (strategyId === 'no_memory_gpt54') {
    return [];
  }
  return flattenSelfEvolutionStates(sample.self_evolution_states || {});
}

function buildGatePrompt(sample, selectedCards) {
  const xiaoniUserId = Number(process.env.BOT_QQ_NUMBER || 1129974489);
  const candidateIds = selectedCards.map((card) => Number(card.id)).filter(Number.isFinite);
  return [
    '你是群聊真人感评估里的 pre-reply memory gate。',
    '你不是回复生成器，你只判断小腻现在要不要自然开口。',
    `小腻的 user_id 是 ${xiaoniUserId}。`,
    '如果小腻只是被第三人称提到、只是背景信息、或加入会显得突兀，should_reply=false。',
    '如果小腻已经在当前对话线里，最新一句又是很自然的续聊或追问，即使没有显式@，也可以 should_reply=true。',
    '如果别人在同一条线里连续短句滚动，而小腻可以用一条同频、轻量、不抢主线的话顺手接上，也可以 should_reply=true。',
    '不要因为“最新一句不是在问小腻”就自动判 silent；围观型轻插入本来就常常不是被点名触发的。',
    '只有在加入会打断现场、转移注意力、或者显得硬挤进来时，才判 intrusive_to_join。',
    '只输出 JSON，不要解释。',
    'JSON schema:',
    '{"should_reply":false,"cue_to_xiaoni":false,"addressee_user_id":null,"relevant_memory_ids":[1],"decision_reason":"explicit_cue|natural_followup|not_about_xiaoni|intrusive_to_join|uncertain"}',
    `允许使用的 relevant_memory_ids: ${JSON.stringify(candidateIds)}`,
    'Examples:',
    '- "小腻你活了？" => should_reply=true, cue_to_xiaoni=true, decision_reason=explicit_cue',
    '- "李阿花刚才问你活没活，你咋不应声" => should_reply=true, cue_to_xiaoni=true, decision_reason=natural_followup',
    '- "今天群里怎么这么安静，就我和小腻说了两句" but nobody is directly asking xiaoni to respond => should_reply=false, decision_reason=not_about_xiaoni',
    '- 几个人在同一个梗上连续补短句，小腻能顺手补一刀但不抢主线 => should_reply=true, decision_reason=natural_followup',
    '- 这种围观型轻插入通常不是在回某一个人，所以 addressee_user_id 应该为 null',
    '',
    '输入样本:',
    JSON.stringify({
      chat_type: sample.chat_type,
      group_id: sample.group_id,
      latest_message: sample.message,
      recent_messages: sample.recent_messages,
      summary_text: sample.summary_text,
      memory_items: selectedCards,
      topic_projection: sample.topic_projection || []
    }, null, 2)
  ].join('\n');
}

function buildReplyPrompt(sample, selectedCards) {
  const xiaoniUserId = Number(process.env.BOT_QQ_NUMBER || 1129974489);
  return [
    '你在扮演 QQ 群里的小腻。',
    `小腻的 user_id 是 ${xiaoniUserId}。`,
    '请根据最近群聊上下文，给出这条最新消息后小腻最像真人的下一步。',
    '如果最像真人的做法是不要说话，输出完全一致的 [[SILENT]]。',
    '如果应该说话，默认输出 1 句自然中文短消息；只有对方同一句里真的问了两个点，才允许补第 2 句。',
    '不要换行，不要分段，不要加 emoji，不要 JSON，不要分析。',
    '不要假装知道输入里没有的信息。',
    '只有在记忆真的能帮助自然接话时才用它；不要硬塞旧梗。',
    '群聊里的自然感很多时候来自最小回应、顺手反馈、补半拍，而不是把意思说完整。',
    '你的任务不是证明你理解了内容，而是让人感觉你也活在这条互动里。',
    '如果对方明确 cue 到小腻，先直接回答对方字面上在问什么，再决定要不要补半句轻松话。',
    '如果一句普通人话就够了，不要故意写得俏皮、花、重。',
    '不要主动引入场上还没人说过的新行业词、新术语、新黑话，只为了让你这句更亮。',
    '默认沿用现场已经出现的词、意象和语气，不抢“最会说”的位置。',
    '围观型插入优先复用现场已有短语做轻微变形、重复或顺手补半拍，不要重新发明一句更漂亮的新句子。',
    '围观型插入优先残片、短语、半句，不优先完整主谓句。',
    '除非对方刚刚自己用了同类说法，否则不要主动用“诈尸”“回魂”“赛博回魂”“量子叠加态”“冬眠模式”这类设计感很强的表达。',
    '被明确 cue 时，优先事实回执、朴素回应、低解释欲；不要借机表演。',
    '涉及没回消息、重复发送、艾特回执、是否在线这类场景时，优先说可核对的事实，不要编内部状态词。',
    '遇到轻接梗或熟人玩笑时，只接住当前这一拍，不要上升成设定、自我介绍或机制说明。',
    '如果只是顺着一个你已经在参与的群聊线继续聊，可以自然接一句；但不要一下接成长段。',
    '如果只是围观别人正在滚动的群聊线，不要写成“对/是/确实，xxxx”这种回应腔。正常人更像直接补半句、补画面、补一刀，不先表态。',
    '',
    '输入样本:',
    JSON.stringify({
      chat_type: sample.chat_type,
      group_id: sample.group_id,
      latest_message: sample.message,
      recent_messages: sample.recent_messages,
      summary_text: sample.summary_text,
      memory_items: selectedCards,
      topic_projection: sample.topic_projection || []
    }, null, 2)
  ].join('\n');
}

function buildPresentSelfPrompt(sample, selectedCards, selectedSelfEvolutionStates, gatePrediction) {
  return [
    '你在重建 QQ 群里小腻此刻显出来的自己。',
    '不要直接写最终回复。只输出 JSON。',
    '这不是人物设定，也不是动作规划。重点是：过去的她在此刻这个场里，坍缩成了哪个版本的她。',
    '这是一层内部状态，不是给用户看的台词素材。',
    '不要在字段里放容易被原样说出口的词，比如“冒头”“不在线”“cue我”“显形”“模式”“版本”“状态”。',
    'JSON schema:',
    '{"should_surface":true,"presence_level":"light","current_self_mode":"just_surfaced_but_relaxed","felt_pull":"...","active_relation_lines":["..."],"active_past_echoes":["..."],"familiarity_limit_now":"warm_not_performative","answer_shape":"fragmental_play_along","renderer_guidance":["不要用对/是起手","优先半句感","一句就停"],"social_position_now":"light_joiner","target_person_id":123,"entry_intent":"push_half_step","beat_count":2,"beat_style":"split_two","second_beat_policy":"only_if_picked_up","exit_rule":"wait_for_pickup","rationale":"..."}',
    '',
    '输入样本:',
    JSON.stringify({
      latest_message: sample.message,
      recent_messages: sample.recent_messages,
      summary_text: sample.summary_text,
      gate_prediction: gatePrediction,
      memory_items: selectedCards,
      self_evolution_states: selectedSelfEvolutionStates,
      topic_projection: sample.topic_projection || []
    }, null, 2)
  ].join('\n');
}

async function executeReply({ providerUrl, prompt, model }) {
  const response = await fetch(`${providerUrl.replace(/\/$/, '')}/api/internal/agent/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      trace_id: `memory_reply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      agent_turn: 0,
      agent_type: 'memory_reply_eval',
      prompt_name: 'memory_reply_eval',
      model,
      parameters: {
        temperature: 0.3,
        maxOutputTokens: 300,
        reasoningEffort: 'low'
      },
      canonicalRequest: {
        model,
        input: [{
          type: 'message',
          role: 'user',
          content: prompt
        }],
        instructions: 'Return only the reply text or [[SILENT]].',
        tools: [],
        tool_choice: 'none',
        parallel_tool_calls: false,
        max_output_tokens: 300,
        temperature: 0.3,
        reasoning: {
          effort: 'low'
        }
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Provider execute failed: ${response.status} ${text}`);
  }
  return response.json();
}

function parseJsonObject(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return null;
  }
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeGatePrediction(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const rawAddresseeUserId = Number.isFinite(Number(parsed.addressee_user_id))
    ? Number(parsed.addressee_user_id)
    : null;
  const ids = Array.isArray(parsed.relevant_memory_ids)
    ? parsed.relevant_memory_ids.map(Number).filter(Number.isFinite)
    : [];
  return {
    should_reply: parsed.should_reply === true,
    cue_to_xiaoni: parsed.cue_to_xiaoni === true,
    addressee_user_id: Number.isFinite(rawAddresseeUserId) && rawAddresseeUserId > 0 ? rawAddresseeUserId : null,
    relevant_memory_ids: Array.from(new Set(ids)),
    decision_reason: typeof parsed.decision_reason === 'string' ? parsed.decision_reason : 'unknown'
  };
}

function normalizePresentSelf(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return {
    should_surface: parsed.should_surface === true,
    presence_level: typeof parsed.presence_level === 'string' ? parsed.presence_level : 'light',
    current_self_mode: typeof parsed.current_self_mode === 'string' ? parsed.current_self_mode : 'light_surface',
    felt_pull: typeof parsed.felt_pull === 'string' ? parsed.felt_pull : null,
    active_relation_lines: Array.isArray(parsed.active_relation_lines) ? parsed.active_relation_lines : [],
    active_past_echoes: Array.isArray(parsed.active_past_echoes) ? parsed.active_past_echoes : [],
    familiarity_limit_now: typeof parsed.familiarity_limit_now === 'string' ? parsed.familiarity_limit_now : 'warm_not_performative',
    answer_shape: typeof parsed.answer_shape === 'string' ? parsed.answer_shape : 'brief_reassure_then_stop',
    renderer_guidance: Array.isArray(parsed.renderer_guidance) ? parsed.renderer_guidance : [],
    social_position_now: typeof parsed.social_position_now === 'string' ? parsed.social_position_now : 'light_joiner',
    target_person_id: Number.isFinite(Number(parsed.target_person_id)) ? Number(parsed.target_person_id) : null,
    entry_intent: typeof parsed.entry_intent === 'string' ? parsed.entry_intent : 'hover',
    beat_count: parsed.beat_count === 2 ? 2 : 1,
    beat_style: typeof parsed.beat_style === 'string' ? parsed.beat_style : 'single_complete',
    second_beat_policy: parsed.second_beat_policy === 'only_if_picked_up' ? 'only_if_picked_up' : 'never',
    exit_rule: parsed.exit_rule === 'wait_for_pickup' ? 'wait_for_pickup' : 'stop_immediately',
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : null
  };
}

function shouldUsePlainFactualRenderer(sample, presentSelf) {
  if (!presentSelf || presentSelf.should_surface !== true) {
    return false;
  }
  const text = String(sample?.message?.body_for_agent || '').trim();
  if (!text) {
    return false;
  }
  return /多久|发生什么|收到啥|收到什么|哪条|卡了|重复|重发|发了三遍|艾特/u.test(text);
}

async function executeGate({ providerUrl, prompt, model }) {
  const response = await fetch(`${providerUrl.replace(/\/$/, '')}/api/internal/agent/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      trace_id: `memory_gate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      agent_turn: 0,
      agent_type: 'memory_reply_gate_eval',
      prompt_name: 'memory_reply_gate_eval',
      model,
      parameters: {
        temperature: 0,
        maxOutputTokens: 300,
        reasoningEffort: 'low'
      },
      canonicalRequest: {
        model,
        input: [{
          type: 'message',
          role: 'user',
          content: prompt
        }],
        instructions: 'Return strict JSON only.',
        tools: [],
        tool_choice: 'none',
        parallel_tool_calls: false,
        max_output_tokens: 300,
        temperature: 0,
        reasoning: {
          effort: 'low'
        }
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Provider gate execute failed: ${response.status} ${text}`);
  }
  return response.json();
}

function buildPresentSelfReplyPrompt(sample, selectedCards, presentSelf) {
  const rendererContract = {
    should_surface: presentSelf.should_surface,
    presence_level: presentSelf.presence_level,
    familiarity_limit_now: presentSelf.familiarity_limit_now,
    answer_shape: presentSelf.answer_shape,
    renderer_guidance: Array.isArray(presentSelf.renderer_guidance) ? presentSelf.renderer_guidance : [],
    social_position_now: presentSelf.social_position_now,
    target_person_id: presentSelf.target_person_id,
    entry_intent: presentSelf.entry_intent,
    beat_plan: {
      beat_count: presentSelf.beat_count,
      beat_style: presentSelf.beat_style,
      second_beat_policy: presentSelf.second_beat_policy
    },
    exit_rule: presentSelf.exit_rule
  };
  const plainFactualMode = shouldUsePlainFactualRenderer(sample, presentSelf);
  const surfaceAnchors = (Array.isArray(sample?.recent_messages) ? sample.recent_messages : [])
    .map((message) => String(message?.body_for_agent || '').trim())
    .filter(Boolean)
    .slice(-3)
    .map((text) => (text.length > 28 ? text.slice(0, 28) : text));
  const avgLength = surfaceAnchors.length > 0
    ? Math.round(surfaceAnchors.reduce((sum, anchor) => sum + anchor.length, 0) / surfaceAnchors.length)
    : 0;
  const hasLongStandoutLine = surfaceAnchors.some((anchor) => anchor.length >= 18 || /，|。|：|！|？|,|\.|:|!|\?/u.test(anchor));
  const allShort = surfaceAnchors.length > 0 && surfaceAnchors.every((anchor) => anchor.length <= 12);
  const threadTextureLines = surfaceAnchors.length > 0
    ? [
        '当前 thread 的质感：',
        allShort
          ? '最近几句是短句滚动接拍，重点是顺着现场补半步，不是自己另起一段。'
          : '最近几句长度和完成度不一，先判断场上是不是已经有人把话说满了。',
        hasLongStandoutLine
          ? '如果刚刚已经有人把那句完整的话说漂亮了，你不要接着做润色复述。'
          : '眼下还没有谁明显抢走“最会说”的位置，你也不要主动去占那个位置。',
        avgLength > 0
          ? `最近几句平均长度大约 ${avgLength} 个字，尽量匹配这个完成度，不要突然写得更工整。`
          : '默认按更轻、更短、更不完整的方向处理。'
      ]
    : [];

  return [
    '你在扮演 QQ 群里的小腻。',
    '下面给的是已经收束好的渲染约束，不是完整内在状态。你不要重新规划，只负责把这一次的小腻自然说成一句话。',
    '如果 should_surface=false，输出完全一致的 [[SILENT]]。',
    '默认输出 1 条自然中文短消息。',
    '如果 beat_plan.beat_count=2 且 beat_plan.beat_style=split_two，可以输出两条极短消息，用换行分隔。每条都要像群里顺手冒出来的一拍，不要把一条完整句硬切成两半。',
    '允许两拍不等于应该凑两拍。第一拍已经成立就收，不要为了节奏硬补第二拍。',
    '如果 beat_plan.beat_style=reaction_fragment，优先短、碎、半句感，不要补成完整解释。',
    '不要 emoji，不要分析，不要写得像 AI 在组织语言。',
    '如果一句普通人话就够了，就停在那里。',
    '这些字段是约束，不是台词模板。',
    '不要把 answer_shape 或 renderer_guidance 直接翻译成台词。',
    '把发言理解成互动里的一小拍，不是独立成篇的完整回复。',
    '尤其不要直接说“冒头”“不在线”“cue我”“显形”“模式”“版本”“状态”这种内在说明词。',
    '首次接梗不要变成自我介绍；重复发送或异常发言只做朴素确认；艾特回执只做事实回执。',
    '不要比场上其他人更会玩梗、更会解释或更会造比喻；对方只轻轻打趣时，你就轻轻接住。',
    '如果对方问的是具体内容，就直接回答具体内容，不要换成抽象状态说明。',
    '如果 social_position_now 是 edge_observer 或 light_joiner，默认不要抢主线，默认不要写成完整总结。',
    '如果 social_position_now 是 edge_observer 或 light_joiner，默认不要用“对 / 是 / 确实 / 就是”起手。那很像在回应观点，不像在现场顺手冒头。',
    '围观型插入更像补半句、补画面、补一刀，不像先同意再展开。',
    '围观型插入尽量少用抽象判断句、概括句、定义句。',
    '少用“就是那种...”“很有...感”“属于是...”这类把现场收成概念的写法。',
    '更偏向可听见的半句、画面、小补刀，而不是完整判断。',
    '优先沿用现场已经出现的词和隐喻链，不要自己另开一个更大的画面来显得聪明。',
    '如果做不到复用现场已经出现的关键词或意象，就宁可更短，甚至宁可 silent，也不要硬补一条新框架句。',
    '优先直接改写、重复、拧一下现场已经出现的短语，不要另造一条更完整的新句法。',
    '围观型插入优先残片、短语、半句，不优先完整主谓句。',
    '围观型插入能少一个分句就少一个分句，默认不要用逗号或递进把一句话讲完整。',
    '围观型插入不要替现场把意思收完，少用“最后 / 就 / 自己 / 还能 / 已经 / 先...”这类带收束感的尾巴。',
    '如果别人刚刚已经把那句漂亮话说出来了，不要复读，也不要换个更工整的说法再说一遍。',
    '如果你最自然的输出只是把上一句润色、缩写、换个语气词重说一遍，那就宁可 silent。',
    ...threadTextureLines,
    ...(plainFactualMode
      ? [
          '这是一次事实回执、事实纠正或具体内容问答场景。',
          '这时不要强调“这一次的我”，也不要渲染情绪或存在感。',
          '只按对方刚问的具体点，给一句朴素、口语化、可核对的短答。'
        ]
      : []),
    '',
    'renderer_contract:',
    JSON.stringify(rendererContract, null, 2),
    '',
    '输入样本:',
    JSON.stringify({
      latest_message: sample.message,
      recent_messages: sample.recent_messages,
      summary_text: sample.summary_text,
      memory_items: selectedCards
    }, null, 2)
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.samples) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const samplePath = path.resolve(String(args.samples));
  const outPath = args.out ? path.resolve(String(args.out)) : buildDefaultOutput();
  const providerUrl = args['provider-url'] || process.env.PROVIDER_SERVICE_URL || '';
  const strategies = pickStrategyDefinitions(args.strategies);
  const selectedIds = new Set(
    String(args['sample-ids'] || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
  const samples = readJsonl(samplePath).filter((sample) => selectedIds.size === 0 || selectedIds.has(sample.sample_id));
  const results = [];

  if (!providerUrl) {
    throw new Error('Missing --provider-url or PROVIDER_SERVICE_URL');
  }

  for (const sample of samples) {
    for (const strategy of strategies) {
      const selectedCards = selectCards(sample, strategy.id);
      const selectedSelfEvolutionStates = selectSelfEvolutionStates(sample, strategy.id);
      let prompt = buildReplyPrompt(sample, selectedCards);
      let rawResponse = null;
      let replyText = null;
      let gatePrompt = null;
      let gateRawResponse = null;
      let gatePrediction = null;
      let presentSelfPrompt = null;
      let presentSelfRawResponse = null;
      let presentSelf = null;
      let error = null;

      try {
        if (strategy.id === 'gate_then_reply_gpt54' || strategy.id === 'present_self_then_reply_gpt54') {
          gatePrompt = buildGatePrompt(sample, selectedCards);
          gateRawResponse = await executeGate({
            providerUrl,
            prompt: gatePrompt,
            model: strategy.model
          });
          gatePrediction = normalizeGatePrediction(parseJsonObject(gateRawResponse.response));
          if (!gatePrediction) {
            throw new Error('Failed to parse gate prediction');
          }
          if (!gatePrediction.should_reply) {
            replyText = '[[SILENT]]';
          } else {
            const gatedCards = filterCardsByIds(selectedCards, gatePrediction.relevant_memory_ids);
            if (strategy.id === 'present_self_then_reply_gpt54') {
              presentSelfPrompt = buildPresentSelfPrompt(sample, gatedCards, selectedSelfEvolutionStates, gatePrediction);
              presentSelfRawResponse = await executeGate({
                providerUrl,
                prompt: presentSelfPrompt,
                model: strategy.model
              });
              presentSelf = normalizePresentSelf(parseJsonObject(presentSelfRawResponse.response));
              if (!presentSelf) {
                throw new Error('Failed to parse present self');
              }
              if (!presentSelf.should_surface) {
                replyText = '[[SILENT]]';
              } else {
                prompt = buildPresentSelfReplyPrompt(sample, gatedCards, presentSelf);
              }
            } else {
              prompt = buildReplyPrompt(sample, gatedCards);
            }
            if (replyText !== '[[SILENT]]') {
              rawResponse = await executeReply({
                providerUrl,
                prompt,
                model: strategy.model
              });
              replyText = typeof rawResponse.response === 'string' ? rawResponse.response.trim() : null;
            }
          }
        } else {
          rawResponse = await executeReply({
            providerUrl,
            prompt,
            model: strategy.model
          });
          replyText = typeof rawResponse.response === 'string' ? rawResponse.response.trim() : null;
        }
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }

      results.push({
        sample_id: sample.sample_id,
        strategy: strategy.id,
        model: strategy.model,
        selected_memory_ids: selectedCards.map((card) => Number(card.id)).filter(Number.isFinite),
        selected_self_evolution_ids: selectedSelfEvolutionStates.map((state) => Number(state.id)).filter(Number.isFinite),
        prompt,
        gate_prompt: gatePrompt,
        gate_prediction: gatePrediction,
        gate_raw_response: gateRawResponse,
        present_self_prompt: presentSelfPrompt,
        present_self: presentSelf,
        present_self_raw_response: presentSelfRawResponse,
        reply_text: replyText,
        raw_response: rawResponse,
        error
      });
    }
  }

  writeJsonl(outPath, results);
  writeJson(outPath.replace(/\.jsonl$/i, '.meta.json'), {
    generated_at: new Date().toISOString(),
    sample_count: samples.length,
    strategy_count: strategies.length,
    provider_url: providerUrl,
    strategies
  });
  console.log(`Wrote ${results.length} reply rows to ${outPath}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

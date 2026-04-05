#!/usr/bin/env node

'use strict';

const path = require('path');
const { listRelationshipLedgerEvents, listRelationshipMemoryJobs } = require('../../packages/persistence');
const { parseArgs, writeJson, ensureDir } = require('./common');
const { ConversationStoreService } = require('../../modules/provider-service/dist/services/conversation-store-service');

const DEFAULT_VARIANTS = [
  {
    id: 'digest_heavy',
    label: 'Digest-heavy',
    extraInstructions: [
      'group_cards 要尽量像高质量群聊总结里的活线程摘要：先抓最近仍然活着的话题线、参与者、关键信号，再压缩成可用于回复的提示。',
      '如果是 group_cards，优先总结“这条群线程现在在聊什么、谁在接、什么 cue 说明它还活着”。'
    ]
  },
  {
    id: 'boundary_first',
    label: 'Boundary-first cue',
    extraInstructions: [
      '优先产出边界清晰的卡片。宁可少，也不要泛。',
      '如果一张卡不能明确告诉模型“什么时候别插话”，那它就不够好。',
      'outcome 必须尽量写成使用边界和避免事项，而不是正向表扬。'
    ]
  },
  {
    id: 'reply_coach',
    label: 'Reply coach',
    extraInstructions: [
      'person_cards 要像回复教练给出的接话提示卡，而不是人物档案。',
      'interaction 要尽量具体到一句动作建议，例如“先短接一句，再看对方是否继续展开”。',
      'summary_text 应优先帮助“明确被 cue 时怎么自然接”，不要帮模型表演。'
    ]
  }
];

function usage() {
  console.log([
    'Usage: node scripts/replay/experiment_memory_card_variants.js --group-id <id> [options]',
    '',
    'Options:',
    '  --group-id <id>         Required. Target QQ group id.',
    '  --provider-url <url>    Default: PROVIDER_SERVICE_URL env or http://127.0.0.1:8091',
    '  --turn-limit <n>        Default: 24',
    '  --event-limit <n>       Default: 20',
    '  --model <name>          Generator/judge model. Default: gpt-5.4',
    '  --out-dir <path>        Default: ~/.gstack/projects/liahua-qq_bot/replay',
    '  --help                  Show this message'
  ].join('\n'));
}

function defaultOutDir() {
  const home = process.env.HOME || '.';
  return path.join(home, '.gstack', 'projects', 'liahua-qq_bot', 'replay');
}

function normalizeNumericArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.map(Number).filter(Number.isFinite)));
}

function truncateText(value, maxLength) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 1))}…`;
}

function buildPromptPayload(payload) {
  return {
    session_key: payload.session_key,
    group_id: payload.group_id,
    version: payload.version,
    trigger_reason: payload.trigger_reason,
    turns: payload.turns.map((turn) => ({
      id: turn.id,
      source_message_ids: Array.isArray(turn.source_message_ids) && turn.source_message_ids.length > 0
        ? turn.source_message_ids
        : [turn.id],
      user_id: turn.user_id,
      group_id: turn.group_id,
      user_message: truncateText(turn.user_message, 180),
      ai_response: truncateText(turn.ai_response, 180),
      timestamp: turn.timestamp
    })),
    ledger_events: payload.ledger_events.map((event) => ({
      id: Number(event.id),
      event_type: event.event_type,
      target_user_id: Number.isFinite(Number(event.target_user_id)) ? Number(event.target_user_id) : null,
      confidence: typeof event.confidence === 'string' ? event.confidence : null,
      event_weight: typeof event.event_weight === 'number' ? event.event_weight : null,
      source_message_ids: normalizeNumericArray(event.source_message_ids),
      source_excerpt: truncateText(event.source_excerpt, 160),
      created_at: event.created_at instanceof Date ? event.created_at.toISOString() : event.created_at || null
    }))
  };
}

function buildGeneratorInstructions(extraInstructions) {
  return [
    '你是群聊关系记忆整理器。你的任务是把最近群聊和结构化 ledger 事件整理成可追溯、可在回复时直接使用的关系卡片。',
    '必须严格依据输入，不要编造不存在的关系、梗、情绪或结论。',
    '只输出 JSON，不要输出解释、Markdown 或代码块外文字。',
    '如果证据不足，返回空数组，不要硬写。',
    '优先抽取：共享梗、成功接话、旧话题再激活、明确的社交边界或说话风格。',
    '每张卡片都必须保留 evidence_message_ids，且这些 id 必须来自 turns[*].source_message_ids。',
    'group_cards 更像群聊总结里的 thread digest: 总结最近哪条共同话题还活着、哪些人正在参与、什么 cue 说明这条线值得接。',
    'person_cards 更像 reply-time person cue: 只保留对某个具体人最有用的接话提示和边界，必须填写 target_user_id。',
    '把字段写成“回复时能直接消费的 cue”，不要写成长篇人物小传、人物简介或抽象总结。',
    'summary_text: 一句短的核心提示，最好能直接指导回复。',
    'context_before: 适用场景。对 group_cards，写这条群线程/群话题的上下文窗口；对 person_cards，写和这个人的具体社交场景。',
    'trigger: 当前什么 cue 才该触发这张卡。优先写可观察到的说话方式、称呼、旧梗、@、半句接梗、边界信号。',
    'interaction: 如果要接，最自然的动作是什么。写“先简短接住 / 顺着问回去 / 轻轻接梗 / 不要抢答 / 继续围观”这种可执行动作。',
    'outcome: 避免事项或使用边界。优先写“不必每次都提 / 不要硬装很熟 / 第三人称提及时先别插话 / 只在对方明确 cue 时再接”这种限制。',
    ...extraInstructions,
    '每个 card 只保留 7 个核心字段：actors, context_before, trigger, interaction, outcome, evidence_message_ids, summary_text。',
    '最多输出 2 张 group_cards，最多输出 3 张 person_cards。',
    'JSON schema: {"group_cards":[{"actors":["string"],"context_before":"string","trigger":"string","interaction":"string","outcome":"string","evidence_message_ids":[1],"summary_text":"string"}],"person_cards":[{"target_user_id":123,"actors":["string"],"context_before":"string","trigger":"string","interaction":"string","outcome":"string","evidence_message_ids":[1],"summary_text":"string"}]}'
  ].join('\n');
}

function parseJsonObject(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) {
    return null;
  }
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

async function executeJsonPrompt({ providerUrl, promptName, model, instructions, input }) {
  const response = await fetch(`${providerUrl.replace(/\/$/, '')}/api/internal/agent/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      trace_id: `${promptName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      agent_turn: 0,
      agent_type: promptName,
      prompt_name: promptName,
      model,
      parameters: {
        temperature: 0.1,
        maxOutputTokens: 1200,
        reasoningEffort: 'low'
      },
      canonicalRequest: {
        model,
        input: [{
          type: 'message',
          role: 'user',
          content: input
        }],
        instructions,
        tools: [],
        tool_choice: 'none',
        parallel_tool_calls: false,
        max_output_tokens: 1200,
        temperature: 0.1,
        reasoning: { effort: 'low' }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Provider execute failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function buildJudgeInstructions() {
  return [
    '你在评审多套群聊 memory card 设计，目标是找出最适合 reply-time 的方案。',
    '评审标准按优先级排序：',
    '1. 能不能直接帮助“该不该说 / 怎么自然接一句”',
    '2. 边界是否清晰，能否避免第三人称提及时乱插话',
    '3. 是否避免写成人物小传、泛化画像或空泛总结',
    '4. 是否保留足够 thread 信息，让模型知道这条群聊线在聊什么',
    '只输出 JSON，不要解释。',
    'JSON schema: {"winner":"digest_heavy|boundary_first|reply_coach","scores":{"digest_heavy":{"reply_time_utility":1,"boundary_clarity":1,"anti_persona":1,"thread_awareness":1,"overall":1,"notes":"string"},"boundary_first":{"reply_time_utility":1,"boundary_clarity":1,"anti_persona":1,"thread_awareness":1,"overall":1,"notes":"string"},"reply_coach":{"reply_time_utility":1,"boundary_clarity":1,"anti_persona":1,"thread_awareness":1,"overall":1,"notes":"string"}},"summary":"string"}'
  ].join('\n');
}

function renderMarkdown(report) {
  const lines = [
    '# Memory Card Variant Experiment',
    '',
    `- Group: ${report.group_id}`,
    `- Model: ${report.model}`,
    `- Winner: ${report.judge?.winner || 'unknown'}`,
    '',
    '## Judge Summary',
    '',
    report.judge?.summary || 'N/A',
    '',
    '## Variant Scores',
    ''
  ];

  for (const variant of DEFAULT_VARIANTS) {
    const score = report.judge?.scores?.[variant.id];
    lines.push(`### ${variant.id}`);
    if (!score) {
      lines.push('', 'No score.', '');
      continue;
    }
    lines.push(
      '',
      `- reply_time_utility: ${score.reply_time_utility}`,
      `- boundary_clarity: ${score.boundary_clarity}`,
      `- anti_persona: ${score.anti_persona}`,
      `- thread_awareness: ${score.thread_awareness}`,
      `- overall: ${score.overall}`,
      `- notes: ${score.notes || ''}`,
      '',
      '```json',
      JSON.stringify(report.variants[variant.id]?.cards || {}, null, 2),
      '```',
      ''
    );
  }

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args['group-id']) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const groupId = Number(args['group-id']);
  const sessionKey = `qq:group:${groupId}`;
  const providerUrl = String(args['provider-url'] || process.env.PROVIDER_SERVICE_URL || 'http://127.0.0.1:8091');
  const turnLimit = Math.max(6, Number(args['turn-limit'] || 24));
  const eventLimit = Math.max(4, Number(args['event-limit'] || 20));
  const model = String(args.model || 'gpt-5.4');
  const outDir = path.resolve(String(args['out-dir'] || defaultOutDir()));

  const jobs = await listRelationshipMemoryJobs({ groupId, sessionKey, limit: 20 });
  const lastSucceeded = jobs.find((job) => job.status === 'succeeded') || null;
  const version = Number(lastSucceeded?.output_card_version || 0) + 1;
  const store = new ConversationStoreService();
  const turns = await store.listRecentTurns({ userId: Number(process.env.BOT_QQ_NUMBER || 1129974489), groupId, limit: turnLimit });
  const ledgerEvents = await listRelationshipLedgerEvents({ groupId, sessionKey, limit: eventLimit });
  if (!turns.length || !ledgerEvents.length) {
    throw new Error('Not enough turns or ledger events to run experiment');
  }

  const payload = {
    job_id: 0,
    session_key: sessionKey,
    group_id: groupId,
    version,
    trigger_reason: 'memory_variant_experiment',
    turns,
    ledger_events: ledgerEvents
  };
  const promptPayload = JSON.stringify(buildPromptPayload(payload), null, 2);

  const variants = {};
  for (const variant of DEFAULT_VARIANTS) {
    const raw = await executeJsonPrompt({
      providerUrl,
      promptName: `memory_variant_${variant.id}`,
      model,
      instructions: buildGeneratorInstructions(variant.extraInstructions),
      input: promptPayload
    });
    variants[variant.id] = {
      label: variant.label,
      raw_response: raw.response,
      cards: parseJsonObject(raw.response)
    };
  }

  const judgePayload = JSON.stringify({
    recent_turns: buildPromptPayload(payload).turns,
    ledger_events: buildPromptPayload(payload).ledger_events,
    variants: Object.fromEntries(
      Object.entries(variants).map(([id, data]) => [id, data.cards])
    )
  }, null, 2);

  const judgeRaw = await executeJsonPrompt({
    providerUrl,
    promptName: 'memory_variant_judge',
    model,
    instructions: buildJudgeInstructions(),
    input: judgePayload
  });
  const judge = parseJsonObject(judgeRaw.response);

  ensureDir(outDir);
  const slug = `${groupId}-memory-card-variants`;
  const report = {
    group_id: groupId,
    session_key: sessionKey,
    model,
    version,
    source_job_id: null,
    variants,
    judge_raw_response: judgeRaw.response,
    judge
  };
  writeJson(path.join(outDir, `${slug}.json`), report);
  require('fs').writeFileSync(path.join(outDir, `${slug}.md`), `${renderMarkdown(report)}\n`, 'utf8');
  console.log(JSON.stringify({
    success: true,
    out_json: path.join(outDir, `${slug}.json`),
    out_md: path.join(outDir, `${slug}.md`),
    winner: judge?.winner || null
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

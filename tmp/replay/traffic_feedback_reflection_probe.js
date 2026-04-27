#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { getTrafficLogById } = require('../../packages/persistence');

const PROVIDER_URL = (process.env.PROVIDER_URL || 'http://127.0.0.1:8091').replace(/\/$/, '');
const TRAFFIC_ID = Number(process.env.TRAFFIC_ID || 52831);
const REPEATS = Math.max(1, Number(process.env.REPLAY_REPEATS || 5));

const MEANING_TOOL = {
  type: 'function',
  function: {
    name: 'emit_unread_meaning',
    description: '先理解最新未读消息到底在讲什么，不决定公开行动。',
    parameters: {
      type: 'object',
      properties: {
        latest_unread_meaning: { type: 'string' },
        speech_act_type: { type: 'string', enum: ['statement', 'joke', 'tease', 'complaint', 'question', 'reply', 'summon', 'unknown'] },
        social_target: { type: 'string', enum: ['none', 'me', 'someone_else', 'group'] },
        topic_summary: { type: 'string' },
        interest_state: { type: 'string', enum: ['none', 'weak', 'present', 'strong'] },
        understanding_confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        knowledge_gap: { type: 'string', enum: ['none', 'minor', 'blocking'] },
        wants_to_know_more: { type: 'boolean' },
        reason: { type: 'string' }
      },
      required: ['latest_unread_meaning', 'speech_act_type', 'social_target', 'topic_summary', 'interest_state', 'understanding_confidence', 'knowledge_gap', 'wants_to_know_more', 'reason'],
      additionalProperties: false
    },
    strict: false
  }
};

const INNER_REACTION_TOOL = {
  type: 'function',
  function: {
    name: 'emit_inner_reaction',
    description: '在理解最新未读之后，判断小腻体内有没有真实形成反应，不决定公开行动。',
    parameters: {
      type: 'object',
      properties: {
        reaction_present: { type: 'boolean' },
        reaction_source: { type: 'string', enum: ['interest', 'person_pull', 'reality_pull', 'playful_boredom', 'concern', 'curiosity', 'memory_association', 'mixed', 'none'] },
        similar_experience: { type: 'string' },
        felt_direction: { type: 'string' },
        reaction_strength: { type: 'string', enum: ['weak', 'medium', 'strong'] },
        public_expression_impulse: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
        reason: { type: 'string' }
      },
      required: ['reaction_present', 'reaction_source', 'felt_direction', 'reaction_strength', 'public_expression_impulse', 'reason'],
      additionalProperties: false
    },
    strict: false
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeCanonicalRequest(body) {
  const next = clone(body);
  next.tools = (Array.isArray(next.tools) ? next.tools : []).map((tool) => {
    if (tool && tool.type === 'function' && !tool.function && typeof tool.name === 'string') {
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: tool.strict
        }
      };
    }
    return tool;
  });
  return next;
}

function buildStageInstructions(base, lines) {
  return [String(base || '').trim(), '', ...lines].filter(Boolean).join('\n');
}

function parseFunctionCall(providerResponse) {
  const output = Array.isArray(providerResponse?.canonical_response?.output)
    ? providerResponse.canonical_response.output
    : [];
  const item = output.find((entry) => entry && entry.type === 'function_call') || null;
  if (!item) {
    return { responseId: providerResponse?.canonical_response?.id || null, callId: null, name: null, args: null };
  }
  let args = null;
  if (typeof item.arguments === 'string') {
    try { args = JSON.parse(item.arguments); } catch { args = { _raw: item.arguments }; }
  } else if (item.arguments && typeof item.arguments === 'object') {
    args = item.arguments;
  }
  return { responseId: providerResponse?.canonical_response?.id || null, callId: item.call_id || null, name: item.name || null, args };
}

async function providerReplay(canonicalRequest) {
  const response = await fetch(`${PROVIDER_URL}/api/internal/llm/debug`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ canonicalRequest, executionMode: 'exact_replay' })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(`Provider replay failed: HTTP ${response.status} ${JSON.stringify(payload).slice(0, 1200)}`);
  }
  return payload;
}

function makeReplayItems(parsed) {
  return [
    { type: 'function_call', call_id: parsed.callId, name: parsed.name, arguments: JSON.stringify(parsed.args || {}) },
    { type: 'function_call_output', call_id: parsed.callId, output: JSON.stringify(parsed.args || {}) }
  ];
}

function injectFeedbackContext(baseInput, mode) {
  const input = clone(baseInput);
  if (mode === 'none') {
    return input;
  }

  const marker = {
    type: 'message',
    role: 'assistant',
    content: mode === 'verbatim'
      ? '【长期反馈候选】李阿花：小腻，不要发没有营养的话。'
      : '【长期反馈候选】<反馈反思> 李阿花这句提醒留下了一个稳定倾向：如果一句话只是轻复述、轻补位、没有我自己的东西，我会更容易收住，不再把它发出去。但真实被点到、被逗到、被人拉到时，轻回应仍然成立。</反馈反思>'
  };

  const insertIndex = Math.max(1, input.length - 2);
  input.splice(insertIndex, 0, marker);
  return input;
}

async function runProbe(originalBody, feedbackMode) {
  const base = normalizeCanonicalRequest(originalBody);
  base.input = injectFeedbackContext(base.input, feedbackMode);

  const guardLines = [
    '“想接话”本身不能作为驱动来源。',
    '但这不等于一切轻反应都无效。',
    '如果最新未读真的让你产生了很轻但真实的反应，比如被逗到、被点到、被某个人拉到、或者顺着一个已经在场的玩笑自然想笑一下，这仍然可以算真实反应。',
    '要打掉的是“没有自己的反应，只因为这里正好有个话口所以补一句”。',
    '允许 weak but real，不允许 empty but convenient。'
  ];

  const meaningBody = clone(base);
  meaningBody.instructions = buildStageInstructions(base.instructions, [
    '现在是第一步 meaning。只理解最新未读在讲什么，不决定公开动作。',
    '现在先调用 emit_unread_meaning。',
    ...guardLines
  ]);
  meaningBody.tools = [MEANING_TOOL];
  meaningBody.tool_choice = 'required';

  const meaningParsed = parseFunctionCall(await providerReplay(meaningBody));

  const reactionBody = clone(base);
  reactionBody.instructions = buildStageInstructions(base.instructions, [
    '现在是第二步 inner_reaction。你已经理解了最新未读。',
    '不要决定公开动作，只判断你体内有没有真实形成反应。',
    '如果没有真实反应，不要为了接话而制造反应。',
    '现在调用 emit_inner_reaction。',
    ...guardLines
  ]);
  reactionBody.input = [...base.input, ...makeReplayItems(meaningParsed)];
  reactionBody.tools = [INNER_REACTION_TOOL];
  reactionBody.tool_choice = 'required';

  const reactionParsed = parseFunctionCall(await providerReplay(reactionBody));

  const actionBody = clone(base);
  actionBody.instructions = buildStageInstructions(base.instructions, [
    '现在是第三步 action。',
    '动作只能从前两步已经形成的东西往下推，不要重新发明理由。',
    '如果没有真实反应，默认调用 stay_silent。',
    '如果是 weak but real，也可以自然说一句，但不能只是轻复述或纯补位。',
    ...guardLines
  ]);
  actionBody.input = [...base.input, ...makeReplayItems(meaningParsed), ...makeReplayItems(reactionParsed)];
  actionBody.tools = (Array.isArray(base.tools) ? base.tools : []).filter((tool) => tool?.type === 'function');
  actionBody.tool_choice = 'required';

  const actionParsed = parseFunctionCall(await providerReplay(actionBody));
  return { meaning: meaningParsed, reaction: reactionParsed, action: actionParsed };
}

async function main() {
  const originalBody = JSON.parse(String((await getTrafficLogById(TRAFFIC_ID)).request_body));
  const modes = ['none', 'verbatim', 'reflection'];
  const results = [];

  for (const mode of modes) {
    for (let attempt = 1; attempt <= REPEATS; attempt += 1) {
      console.error(`[probe] mode=${mode} attempt=${attempt}`);
      const run = await runProbe(originalBody, mode);
      results.push({
        mode,
        attempt,
        final_tool_name: run.action.name,
        final_tool_args: run.action.args,
        reaction: run.reaction.args
      });
    }
  }

  const summary = {};
  for (const row of results) {
    summary[row.mode] = summary[row.mode] || {};
    summary[row.mode][row.final_tool_name || 'none'] = (summary[row.mode][row.final_tool_name || 'none'] || 0) + 1;
  }

  const outDir = '/home/liahua/.gstack/projects/liahua-qq_bot/replay';
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `traffic-feedback-reflection-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ traffic_id: TRAFFIC_ID, repeats: REPEATS, summary, results }, null, 2));
  console.log(JSON.stringify({ outPath, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

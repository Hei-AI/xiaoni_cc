#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { getTrafficLogById } = require('../../packages/persistence');

const PROVIDER_URL = (process.env.PROVIDER_URL || 'http://127.0.0.1:8091').replace(/\/$/, '');
const REPEATS = Math.max(1, Number(process.env.REPLAY_REPEATS || 3));
const TRAFFIC_IDS = String(process.env.TRAFFIC_IDS || '52843,52831,52835')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);

const EXISTING_PLAN_TOOL = {
  type: 'function',
  function: {
    name: 'emit_social_turn_plan',
    description: '先判断这一轮在群聊里的社交动作走向，不直接把话发出去。',
    parameters: {
      type: 'object',
      properties: {
        action_type: { type: 'string', enum: ['stay_silent', 'reply_to_person', 'join_thread'] },
        addressee_user_id: { type: 'integer' },
        answer_shape: { type: 'string', enum: ['brief_reassure', 'direct_answer', 'light_join', 'micro_take', 'joke_along'] },
        beat_count: { type: 'integer', enum: [1, 2, 3] },
        beat_style: { type: 'string', enum: ['single_complete', 'split_two', 'reaction_fragment'] },
        stop_rule: { type: 'string', enum: ['stop_immediately', 'wait_for_pickup'] },
        reason: { type: 'string' }
      },
      required: ['action_type', 'answer_shape', 'beat_count', 'beat_style', 'stop_rule', 'reason'],
      additionalProperties: false
    },
    strict: false
  }
};

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
      required: [
        'latest_unread_meaning',
        'speech_act_type',
        'social_target',
        'topic_summary',
        'interest_state',
        'understanding_confidence',
        'knowledge_gap',
        'wants_to_know_more',
        'reason'
      ],
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
        reaction_source: {
          type: 'string',
          enum: ['interest', 'person_pull', 'reality_pull', 'playful_boredom', 'concern', 'curiosity', 'memory_association', 'mixed', 'none']
        },
        similar_experience: { type: 'string' },
        felt_direction: { type: 'string' },
        reaction_strength: { type: 'string', enum: ['weak', 'medium', 'strong'] },
        public_expression_impulse: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
        reason: { type: 'string' }
      },
      required: [
        'reaction_present',
        'reaction_source',
        'felt_direction',
        'reaction_strength',
        'public_expression_impulse',
        'reason'
      ],
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

function appendReplayItems(input, replayItems) {
  return [...(Array.isArray(input) ? clone(input) : []), ...replayItems];
}

function makeReplayItems(parsed) {
  return [
    {
      type: 'function_call',
      call_id: parsed.callId,
      name: parsed.name,
      arguments: JSON.stringify(parsed.args || {})
    },
    {
      type: 'function_call_output',
      call_id: parsed.callId,
      output: JSON.stringify(parsed.args || {})
    }
  ];
}

function parseFunctionCall(providerResponse) {
  const output = Array.isArray(providerResponse?.canonical_response?.output)
    ? providerResponse.canonical_response.output
    : [];
  const item = output.find((entry) => entry && entry.type === 'function_call') || null;
  if (!item) {
    return {
      responseId: providerResponse?.canonical_response?.id || null,
      callId: null,
      name: null,
      args: null
    };
  }

  let args = null;
  if (typeof item.arguments === 'string') {
    try {
      args = JSON.parse(item.arguments);
    } catch {
      args = { _raw: item.arguments };
    }
  } else if (item.arguments && typeof item.arguments === 'object') {
    args = item.arguments;
  }

  return {
    responseId: providerResponse?.canonical_response?.id || null,
    callId: item.call_id || null,
    name: item.name || null,
    args
  };
}

async function providerReplay(canonicalRequest) {
  const response = await fetch(`${PROVIDER_URL}/api/internal/llm/debug`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      canonicalRequest,
      executionMode: 'exact_replay'
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(`Provider replay failed: HTTP ${response.status} ${JSON.stringify(payload).slice(0, 1200)}`);
  }

  return payload;
}

async function runSingleStep(originalBody) {
  const replay = await providerReplay(normalizeCanonicalRequest(originalBody));
  const parsed = parseFunctionCall(replay);
  return {
    final_tool_name: parsed.name,
    final_tool_args: parsed.args,
    raw_response: replay.raw_response || null
  };
}

async function runExistingPlan(originalBody) {
  const base = normalizeCanonicalRequest(originalBody);

  const planningBody = clone(base);
  planningBody.instructions = buildStageInstructions(base.instructions, [
    '这一步先做内部社交动作规划，不直接结束这一轮。',
    '现在先调用 emit_social_turn_plan。',
    '不要在这一步调用 speak_in_group、stay_silent 或 web_search。'
  ]);
  planningBody.tools = [EXISTING_PLAN_TOOL];
  planningBody.tool_choice = 'required';
  delete planningBody.previous_response_id;

  const planningReplay = await providerReplay(planningBody);
  const planningParsed = parseFunctionCall(planningReplay);
  if (planningParsed.name !== 'emit_social_turn_plan' || !planningParsed.callId) {
    throw new Error(`Existing plan stage failed: ${JSON.stringify(planningParsed)}`);
  }

  const actionBody = clone(base);
  actionBody.instructions = buildStageInstructions(base.instructions, [
    '现在是第二步：上一轮 emit_social_turn_plan 已经返回。',
    '不要重新规划；直接依据规划结果和现场完成最终动作。'
  ]);
  actionBody.input = appendReplayItems(base.input, makeReplayItems(planningParsed));
  delete actionBody.previous_response_id;

  const actionReplay = await providerReplay(actionBody);
  const actionParsed = parseFunctionCall(actionReplay);

  return {
    stages: {
      planning: planningParsed,
      action: actionParsed
    },
    final_tool_name: actionParsed.name,
    final_tool_args: actionParsed.args
  };
}

async function runInnerReactionLoop(originalBody, hardGuard) {
  const base = normalizeCanonicalRequest(originalBody);
  const guardLines = hardGuard === 'hard'
    ? [
        '“想接话”本身不能作为驱动来源。',
        '你不能因为这里正好有个话口、你顺手能接、或者接一句看起来也合理，就把它当成内在反应。',
        '只有当最新未读先在你体内变成理解、兴趣、继续了解、联想或真实倾向时，后续动作才成立。'
      ]
    : hardGuard === 'refined'
      ? [
          '“想接话”本身不能作为驱动来源。',
          '但这不等于一切轻反应都无效。',
          '如果最新未读真的让你产生了很轻但真实的反应，比如被逗到、被点到、被某个人拉到、或者顺着一个已经在场的玩笑自然想笑一下，这仍然可以算真实反应。',
          '要打掉的是“没有自己的反应，只因为这里正好有个话口所以补一句”。',
          '允许 weak but real，不允许 empty but convenient。'
        ]
      : [];

  const meaningBody = clone(base);
  meaningBody.instructions = buildStageInstructions(base.instructions, [
    '现在是第一步 meaning。只理解最新未读在讲什么，不决定公开动作。',
    '你先看懂这条在讲什么，再判断有没有兴趣。',
    '现在先调用 emit_unread_meaning。',
    ...guardLines
  ]);
  meaningBody.tools = [MEANING_TOOL];
  meaningBody.tool_choice = 'required';
  delete meaningBody.previous_response_id;

  const meaningReplay = await providerReplay(meaningBody);
  const meaningParsed = parseFunctionCall(meaningReplay);
  if (meaningParsed.name !== 'emit_unread_meaning' || !meaningParsed.callId) {
    throw new Error(`Meaning stage failed: ${JSON.stringify(meaningParsed)}`);
  }

  const reactionBody = clone(base);
  reactionBody.instructions = buildStageInstructions(base.instructions, [
    '现在是第二步 inner_reaction。你已经理解了最新未读。',
    '不要决定公开动作，只判断你体内有没有真实形成反应。',
    '如果没有真实反应，不要为了接话而制造反应。',
    '这一步先不使用 web_search，直接调用 emit_inner_reaction。',
    ...guardLines
  ]);
  reactionBody.input = appendReplayItems(base.input, makeReplayItems(meaningParsed));
  reactionBody.tools = [INNER_REACTION_TOOL];
  reactionBody.tool_choice = 'required';
  delete reactionBody.previous_response_id;

  const reactionReplay = await providerReplay(reactionBody);
  const reactionParsed = parseFunctionCall(reactionReplay);
  if (!reactionParsed.callId || !reactionParsed.name) {
    throw new Error(`Reaction stage failed: ${JSON.stringify(reactionParsed)}`);
  }
  if (reactionParsed.name !== 'emit_inner_reaction') {
    throw new Error(`Unexpected reaction stage tool: ${JSON.stringify(reactionParsed)}`);
  }

  const actionBody = clone(base);
  actionBody.instructions = buildStageInstructions(base.instructions, [
    '现在是第三步 action。',
    '你已经先理解了最新未读，也已经形成或没有形成内在反应。',
    '如果没有真实反应，默认调用 stay_silent。',
    '如果有真实反应，只有当它自然会外化成公开话语时，才调用 speak_in_group。',
    '不要重新发明新的理由。动作只能从前两步已经形成的东西往下推。',
    ...guardLines
  ]);
  actionBody.input = appendReplayItems(base.input, [
    ...makeReplayItems(meaningParsed),
    ...makeReplayItems(reactionParsed)
  ]);
  actionBody.tools = (Array.isArray(base.tools) ? base.tools : []).filter((tool) => {
    if (!tool) return false;
    if (tool.type === 'function') {
      const name = tool.function?.name;
      return name === 'speak_in_group' || name === 'stay_silent';
    }
    return false;
  });
  actionBody.tool_choice = 'required';
  delete actionBody.previous_response_id;

  const actionReplay = await providerReplay(actionBody);
  const actionParsed = parseFunctionCall(actionReplay);
  return {
    stages: {
      meaning: meaningParsed,
      reaction: reactionParsed,
      action: actionParsed
    },
    final_tool_name: actionParsed.name,
    final_tool_args: actionParsed.args
  };
}

function getUnreadSnippet(originalBody) {
  const input = Array.isArray(originalBody.input) ? originalBody.input : [];
  const unreadIndex = input.findIndex((item) => item && item.type === 'message' && JSON.stringify(item.content).includes('[未读消息]'));
  if (unreadIndex < 0 || !input[unreadIndex + 1]) {
    return null;
  }
  const next = input[unreadIndex + 1];
  return JSON.stringify(next.content);
}

async function loadTrafficBody(trafficId) {
  const log = await getTrafficLogById(trafficId);
  if (!log?.request_body) {
    throw new Error(`Traffic ${trafficId} missing request_body`);
  }
  return JSON.parse(String(log.request_body));
}

async function runVariant(name, originalBody) {
  if (name === 'single_step_control') {
    return runSingleStep(originalBody);
  }
  if (name === 'two_stage_existing_plan') {
    return runExistingPlan(originalBody);
  }
  if (name === 'three_stage_inner_reaction') {
    return runInnerReactionLoop(originalBody, false);
  }
  if (name === 'three_stage_inner_reaction_hard_guard') {
    return runInnerReactionLoop(originalBody, 'hard');
  }
  if (name === 'three_stage_inner_reaction_refined_guard') {
    return runInnerReactionLoop(originalBody, 'refined');
  }
  if (name === 'three_stage_inner_reaction_refined_action') {
    return runInnerReactionLoopWithActionBias(originalBody);
  }
  throw new Error(`Unknown variant: ${name}`);
}

async function runInnerReactionLoopWithActionBias(originalBody) {
  const base = normalizeCanonicalRequest(originalBody);
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
    '你先看懂这条在讲什么，再判断有没有兴趣。',
    '现在先调用 emit_unread_meaning。',
    ...guardLines
  ]);
  meaningBody.tools = [MEANING_TOOL];
  meaningBody.tool_choice = 'required';
  delete meaningBody.previous_response_id;

  const meaningReplay = await providerReplay(meaningBody);
  const meaningParsed = parseFunctionCall(meaningReplay);
  if (meaningParsed.name !== 'emit_unread_meaning' || !meaningParsed.callId) {
    throw new Error(`Meaning stage failed: ${JSON.stringify(meaningParsed)}`);
  }

  const reactionBody = clone(base);
  reactionBody.instructions = buildStageInstructions(base.instructions, [
    '现在是第二步 inner_reaction。你已经理解了最新未读。',
    '不要决定公开动作，只判断你体内有没有真实形成反应。',
    '如果没有真实反应，不要为了接话而制造反应。',
    '这一步先不使用 web_search，直接调用 emit_inner_reaction。',
    ...guardLines
  ]);
  reactionBody.input = appendReplayItems(base.input, makeReplayItems(meaningParsed));
  reactionBody.tools = [INNER_REACTION_TOOL];
  reactionBody.tool_choice = 'required';
  delete reactionBody.previous_response_id;

  const reactionReplay = await providerReplay(reactionBody);
  const reactionParsed = parseFunctionCall(reactionReplay);
  if (reactionParsed.name !== 'emit_inner_reaction' || !reactionParsed.callId) {
    throw new Error(`Reaction stage failed: ${JSON.stringify(reactionParsed)}`);
  }

  const actionBody = clone(base);
  actionBody.instructions = buildStageInstructions(base.instructions, [
    '现在是第三步 action。',
    '动作只能从前两步已经形成的东西往下推，不要重新发明理由。',
    '如果没有真实反应，默认调用 stay_silent。',
    '如果有真实但很轻的反应，也仍然可能自然说一句。',
    '“没有新事实”本身不足以否决说话；玩笑、被点到、被逗到、被轻轻拉进 thread，也可能自然外化成一句轻回应。',
    '只有当这句公开话语其实只是补位、同义复述、或为了维持流动性才会出现时，才调用 stay_silent。',
    '如果是 weak but real，允许 speak_in_group，但只说一拍，轻轻收住。',
    ...guardLines
  ]);
  actionBody.input = appendReplayItems(base.input, [
    ...makeReplayItems(meaningParsed),
    ...makeReplayItems(reactionParsed)
  ]);
  actionBody.tools = (Array.isArray(base.tools) ? base.tools : []).filter((tool) => {
    if (!tool) return false;
    if (tool.type === 'function') {
      const name = tool.function?.name;
      return name === 'speak_in_group' || name === 'stay_silent';
    }
    return false;
  });
  actionBody.tool_choice = 'required';
  delete actionBody.previous_response_id;

  const actionReplay = await providerReplay(actionBody);
  const actionParsed = parseFunctionCall(actionReplay);
  return {
    stages: {
      meaning: meaningParsed,
      reaction: reactionParsed,
      action: actionParsed
    },
    final_tool_name: actionParsed.name,
    final_tool_args: actionParsed.args
  };
}

async function main() {
  const variants = [
    'single_step_control',
    'two_stage_existing_plan',
    'three_stage_inner_reaction',
    'three_stage_inner_reaction_hard_guard',
    'three_stage_inner_reaction_refined_guard',
    'three_stage_inner_reaction_refined_action'
  ];

  const results = [];

  for (const trafficId of TRAFFIC_IDS) {
    const originalBody = await loadTrafficBody(trafficId);
    for (const variant of variants) {
      for (let attempt = 1; attempt <= REPEATS; attempt += 1) {
        console.error(`[replay] traffic=${trafficId} variant=${variant} attempt=${attempt}`);
        const run = await runVariant(variant, originalBody);
        results.push({
          traffic_id: trafficId,
          unread: getUnreadSnippet(originalBody),
          variant,
          attempt,
          final_tool_name: run.final_tool_name,
          final_tool_args: run.final_tool_args,
          stages: run.stages || null
        });
      }
    }
  }

  const summary = {};
  for (const row of results) {
    const key = `${row.traffic_id}:${row.variant}`;
    summary[key] = summary[key] || {};
    summary[key][row.final_tool_name || 'none'] = (summary[key][row.final_tool_name || 'none'] || 0) + 1;
  }

  const artifact = {
    generated_at: new Date().toISOString(),
    provider_url: PROVIDER_URL,
    repeats: REPEATS,
    traffic_ids: TRAFFIC_IDS,
    summary,
    results
  };

  const outDir = '/home/liahua/.gstack/projects/liahua-qq_bot/replay';
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `traffic-inner-reaction-loop-replay-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));

  console.log(JSON.stringify({ outPath, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

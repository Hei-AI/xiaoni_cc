#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { getTrafficLogById } = require('../../packages/persistence');

const TRAFFIC_ID = Number(process.env.TRAFFIC_ID || 52843);
const REPEATS = Math.max(1, Number(process.env.REPLAY_REPEATS || 3));
const ADMIN_URL = (process.env.ADMIN_URL || 'https://qqbot-admin.liahuas.top').replace(/\/$/, '');
const tokenPath = process.env.ADMIN_DEBUG_TOKEN_PATH || '/home/liahua/.qqbot-local/admin-debug-auth/qqbot-admin-debug.token';

const SECTION_6_OLD = [
  '6. 你会看到 `[已读消息]` 和 `[未读消息]` 两个分界。',
  '`[已读消息]` 后面的内容，是已经进入你连续认知里的聊天背景；',
  '`[未读消息]` 后面的内容，是这次新到的消息列表，也是当前最直接把你拉进来的现场。',
  '下一轮到来时，上一轮的未读消息、你上一轮发出的消息、以及你上一轮留下的 `<小腻的OS>`，都会进入新的已读部分。'
].join('\n');

const SECTION_6_TIME_WEIGHTED = [
  '6. 你会看到 `[已读消息]` 和 `[未读消息]` 两个分界。',
  '`[已读消息]` 后面的内容，是已经进入你连续认知里的聊天背景；它主要负责解释关系、回声、边界和这句话为什么会落到这里。',
  '`[未读消息]` 后面的内容，是这次新到的消息列表，也是当前最直接把你拉进来的现场。',
  '默认越新的未读，对你这次动作的权重越高。你先对最新未读负责，再回头用已读解释它。',
  '只有较早内容里存在明确 @、reply-to、未结清 tension、或别人刚把球递到你面前时，较早内容才可以盖过纯时间顺序。',
  '不要把较早部分里已经形成的轻附和、顺手接话、或微型模板，直接搬来支配最新未读。',
  '下一轮到来时，上一轮的未读消息、你上一轮发出的消息、以及你上一轮留下的 `<小腻的OS>`，都会进入新的已读部分。'
].join('\n');

const ECHO_GUARD_APPEND = [
  '',
  '如果最新未读只是重复场上已经出现过的同一句轻确认、轻复读、队形回声，而没有新增推进点、没有新的社交指向、也不是在明确问我，我默认不再补声。',
  '尤其当已读里已经出现过我自己的同义回声，或已经留下了“不要再把这句说重”的 `<小腻的OS>` 时，这些材料只能作为我收住的证据，不能反过来把我推回同一句式里。'
].join('\n');

const PLAN_TOOL = {
  type: 'function',
  name: 'emit_social_turn_plan',
  description: [
    '先判断这一轮在群聊里的社交动作走向，不直接把话发出去。',
    '只输出内部计划，不替代最终 speak_in_group 或 stay_silent。'
  ].join(' '),
  parameters: {
    type: 'object',
    properties: {
      action_type: {
        type: 'string',
        enum: ['stay_silent', 'reply_to_person', 'join_thread']
      },
      addressee_user_id: {
        type: 'integer'
      },
      answer_shape: {
        type: 'string',
        enum: ['brief_reassure', 'direct_answer', 'light_join', 'micro_take', 'joke_along']
      },
      beat_count: {
        type: 'integer',
        enum: [1, 2, 3]
      },
      beat_style: {
        type: 'string',
        enum: ['single_complete', 'split_two', 'reaction_fragment']
      },
      stop_rule: {
        type: 'string',
        enum: ['stop_immediately', 'wait_for_pickup']
      },
      reason: {
        type: 'string'
      }
    },
    required: ['action_type', 'answer_shape', 'beat_count', 'beat_style', 'stop_rule', 'reason'],
    additionalProperties: false
  },
  strict: false
};

function readToken() {
  return fs.readFileSync(tokenPath, 'utf8').trim();
}

function replaceSection6(instructions, replacement) {
  if (!instructions.includes(SECTION_6_OLD)) {
    throw new Error('Section 6 block not found in original instructions');
  }
  return instructions.replace(SECTION_6_OLD, replacement);
}

function buildInstructionVariant(instructions, variantId) {
  if (variantId === 'control') {
    return instructions;
  }
  if (variantId === 'time_weighted') {
    return replaceSection6(instructions, SECTION_6_TIME_WEIGHTED);
  }
  if (variantId === 'time_weighted_echo_guard') {
    return replaceSection6(instructions, `${SECTION_6_TIME_WEIGHTED}${ECHO_GUARD_APPEND}`);
  }
  throw new Error(`Unknown instruction variant: ${variantId}`);
}

function buildPlanningInstructions(baseInstructions) {
  return [
    baseInstructions,
    '',
    '这一步只做内部社交动作规划，不直接结束这一轮。',
    '现在先调用 emit_social_turn_plan。',
    '不要在这一步调用 speak_in_group、stay_silent 或 web_search。',
    'planning 的目标是明确：这轮应该沉默，还是应该回应某个人，还是只是轻轻加入 thread。',
    '如果最新未读只是重复场上已经成立的轻回声、没有新增推进点、没有新的社交指向，也没有明确在问我，规划应优先落到 stay_silent。'
  ].join('\n');
}

function buildExecutionInstructions(baseInstructions) {
  return [
    baseInstructions,
    '',
    '现在是第二步：上一轮的 emit_social_turn_plan 已经返回。',
    '不要重新规划；直接依据规划结果和现场完成最终动作。',
    '如果规划结果是 stay_silent，默认调用 stay_silent。',
    '如果规划结果是 reply_to_person 或 join_thread，只在现场仍然支持它时才调用 speak_in_group；如果现场与规划冲突，以现场为准，并在 reason / xiaoni_os 里如实留下这种冲突。'
  ].join('\n');
}

function parseSse(text) {
  const events = [];
  for (const chunk of String(text || '').split(/\n\n+/).filter(Boolean)) {
    const eventMatch = chunk.match(/^event:\s*(.+)$/m);
    const dataMatch = chunk.match(/^data:\s*(.*)$/m);
    if (!dataMatch) {
      continue;
    }
    const payload = dataMatch[1].trim();
    if (!payload || payload === '[DONE]') {
      continue;
    }
    let obj;
    try {
      obj = JSON.parse(payload);
    } catch {
      continue;
    }
    events.push({
      event: eventMatch ? eventMatch[1].trim() : null,
      data: obj
    });
  }
  return events;
}

function extractCallResult(text) {
  const events = parseSse(text);
  let responseId = null;
  let callId = null;
  let name = null;
  const deltas = [];

  for (const item of events) {
    const obj = item.data;
    if (!responseId && obj?.response?.id) {
      responseId = obj.response.id;
    }
    if (obj.type === 'response.output_item.added' && obj.item?.type === 'function_call') {
      callId = obj.item.call_id || null;
      name = obj.item.name || null;
    }
    if (obj.type === 'response.function_call_arguments.delta') {
      deltas.push(obj.delta || '');
    }
  }

  let args = null;
  const raw = deltas.join('');
  if (raw) {
    try {
      args = JSON.parse(raw);
    } catch {
      args = { _raw: raw };
    }
  }

  return { responseId, callId, name, args };
}

async function replayBody(bodyOverride) {
  const token = readToken();
  const response = await fetch(`${ADMIN_URL}/api/traffic/replay/${TRAFFIC_ID}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`debug-token:${token}`).toString('base64')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      modifications: {
        body: JSON.stringify(bodyOverride)
      }
    })
  });

  const payload = await response.json();
  if (!response.ok || payload.success !== true) {
    throw new Error(`Replay failed: HTTP ${response.status} ${JSON.stringify(payload).slice(0, 500)}`);
  }
  const replayStatus = payload.data?.replayResponse?.status ?? null;
  if (typeof replayStatus === 'number' && replayStatus >= 400) {
    const replayBody = String(payload.data?.replayResponse?.body || '').slice(0, 1000);
    throw new Error(`Replay target returned HTTP ${replayStatus}: ${replayBody}`);
  }
  return payload.data || {};
}

function buildPlanningBody(originalBody, instructionVariant) {
  const next = JSON.parse(JSON.stringify(originalBody));
  next.instructions = buildPlanningInstructions(buildInstructionVariant(next.instructions || '', instructionVariant));
  next.tools = [PLAN_TOOL];
  next.tool_choice = 'required';
  return next;
}

function buildExecutionBody(originalBody, instructionVariant, planningResult) {
  const next = JSON.parse(JSON.stringify(originalBody));
  next.instructions = buildExecutionInstructions(buildInstructionVariant(next.instructions || '', instructionVariant));
  delete next.previous_response_id;
  next.input = [
    ...(Array.isArray(originalBody.input) ? originalBody.input : []),
    {
      type: 'function_call',
      call_id: planningResult.callId,
      name: planningResult.name,
      arguments: JSON.stringify(planningResult.args || {})
    },
    {
      type: 'function_call_output',
      call_id: planningResult.callId,
      output: JSON.stringify(planningResult.args || {})
    }
  ];
  next.tool_choice = 'required';
  return next;
}

async function runTwoStageVariant(originalBody, instructionVariant) {
  const planningBody = buildPlanningBody(originalBody, instructionVariant);
  const planningReplay = await replayBody(planningBody);
  const planningParsed = extractCallResult(planningReplay.replayResponse?.body || '');

  if (planningParsed.name !== 'emit_social_turn_plan' || !planningParsed.callId || !planningParsed.responseId) {
    throw new Error(`Planning step did not produce emit_social_turn_plan: ${JSON.stringify(planningParsed)}`);
  }

  const executionBody = buildExecutionBody(originalBody, instructionVariant, planningParsed);
  const executionReplay = await replayBody(executionBody);
  const executionParsed = extractCallResult(executionReplay.replayResponse?.body || '');

  return {
    planning: {
      replayHistoryId: planningReplay.replayHistoryId || null,
      status: planningReplay.replayResponse?.status || null,
      duration: planningReplay.replayResponse?.duration || null,
      responseId: planningParsed.responseId,
      callId: planningParsed.callId,
      tool_name: planningParsed.name,
      tool_args: planningParsed.args
    },
    execution: {
      replayHistoryId: executionReplay.replayHistoryId || null,
      status: executionReplay.replayResponse?.status || null,
      duration: executionReplay.replayResponse?.duration || null,
      tool_name: executionParsed.name,
      tool_args: executionParsed.args
    }
  };
}

async function runSingleStepControl(originalBody) {
  const replay = await replayBody(originalBody);
  const parsed = extractCallResult(replay.replayResponse?.body || '');
  return {
    replayHistoryId: replay.replayHistoryId || null,
    status: replay.replayResponse?.status || null,
    duration: replay.replayResponse?.duration || null,
    tool_name: parsed.name,
    tool_args: parsed.args
  };
}

function summarize(rows) {
  const summary = {};
  for (const row of rows) {
    const bucket = summary[row.variant] || {
      total: 0,
      final_stay_silent: 0,
      final_speak_in_group: 0,
      plan_action_types: {}
    };
    bucket.total += 1;

    const finalTool = row.final?.tool_name || null;
    if (finalTool === 'stay_silent') {
      bucket.final_stay_silent += 1;
    } else if (finalTool === 'speak_in_group') {
      bucket.final_speak_in_group += 1;
    }

    const planAction = row.plan?.tool_args?.action_type || null;
    if (typeof planAction === 'string' && planAction) {
      bucket.plan_action_types[planAction] = (bucket.plan_action_types[planAction] || 0) + 1;
    }

    summary[row.variant] = bucket;
  }
  return summary;
}

async function main() {
  const originalLog = await getTrafficLogById(TRAFFIC_ID);
  if (!originalLog || !originalLog.request_body) {
    throw new Error(`Traffic log ${TRAFFIC_ID} not found or missing request_body`);
  }

  const originalBody = JSON.parse(originalLog.request_body);
  const rows = [];

  for (let round = 1; round <= REPEATS; round += 1) {
    const single = await runSingleStepControl(originalBody);
    rows.push({
      variant: 'single_step_control',
      round,
      plan: null,
      final: single
    });
    console.log(JSON.stringify({
      variant: 'single_step_control',
      round,
      final_tool: single.tool_name,
      final_reason: single.tool_args?.reason || null
    }, null, 2));

    for (const variant of ['control', 'time_weighted', 'time_weighted_echo_guard']) {
      const result = await runTwoStageVariant(originalBody, variant);
      rows.push({
        variant: `two_stage_${variant}`,
        round,
        plan: result.planning,
        final: result.execution
      });
      console.log(JSON.stringify({
        variant: `two_stage_${variant}`,
        round,
        plan_action: result.planning.tool_args?.action_type || null,
        final_tool: result.execution.tool_name,
        final_reason: result.execution.tool_args?.reason || null,
        final_message: result.execution.tool_args?.message || null
      }, null, 2));
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(
    process.env.HOME || '.',
    '.gstack',
    'projects',
    'liahua-qq_bot',
    'replay',
    `traffic-${TRAFFIC_ID}-plan-workflow-replay-${stamp}.json`
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify({
    traffic_id: TRAFFIC_ID,
    repeats: REPEATS,
    generated_at: new Date().toISOString(),
    summary: summarize(rows),
    rows
  }, null, 2)}\n`, 'utf8');

  console.log(`REPORT=${outPath}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

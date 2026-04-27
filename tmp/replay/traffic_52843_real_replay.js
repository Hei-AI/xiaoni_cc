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
  '`[已读消息]` 后面的内容，是已经进入你连续认知里的聊天背景；它负责解释关系、回声、边界和这句话为什么会落到这里。',
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

function readToken() {
  return fs.readFileSync(tokenPath, 'utf8').trim();
}

function replaceSection6(instructions, replacement) {
  if (!instructions.includes(SECTION_6_OLD)) {
    throw new Error('Section 6 block not found in original instructions');
  }
  return instructions.replace(SECTION_6_OLD, replacement);
}

function buildVariantBody(originalBody, variantId) {
  if (variantId === 'control') {
    return originalBody;
  }

  const next = JSON.parse(JSON.stringify(originalBody));
  if (typeof next.instructions !== 'string') {
    throw new Error(`Variant ${variantId}: missing instructions`);
  }

  if (variantId === 'time_weighted') {
    next.instructions = replaceSection6(next.instructions, SECTION_6_TIME_WEIGHTED);
    return next;
  }

  if (variantId === 'time_weighted_echo_guard') {
    next.instructions = replaceSection6(
      next.instructions,
      `${SECTION_6_TIME_WEIGHTED}${ECHO_GUARD_APPEND}`
    );
    return next;
  }

  throw new Error(`Unknown variant: ${variantId}`);
}

function parseFunctionCallFromSse(text) {
  let name = null;
  const deltas = [];

  for (const chunk of String(text || '').split(/\n\n+/).filter(Boolean)) {
    const match = chunk.match(/^data:\s*(.*)$/m);
    if (!match) {
      continue;
    }
    const payload = match[1].trim();
    if (!payload || payload === '[DONE]') {
      continue;
    }
    let obj;
    try {
      obj = JSON.parse(payload);
    } catch {
      continue;
    }

    if (obj.type === 'response.output_item.added' && obj.item?.type === 'function_call') {
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

  return { name, args };
}

async function replayVariant(variantId, bodyOverride) {
  const token = readToken();
  const modifications = variantId === 'control'
    ? {}
    : { body: JSON.stringify(bodyOverride) };

  const response = await fetch(`${ADMIN_URL}/api/traffic/replay/${TRAFFIC_ID}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`debug-token:${token}`).toString('base64')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ modifications })
  });

  const payload = await response.json();
  if (!response.ok || payload.success !== true) {
    throw new Error(`Replay failed for ${variantId}: HTTP ${response.status} ${JSON.stringify(payload).slice(0, 500)}`);
  }

  const data = payload.data || {};
  const replayResponse = data.replayResponse || {};
  const parsed = parseFunctionCallFromSse(replayResponse.body || '');

  return {
    variant: variantId,
    replayHistoryId: data.replayHistoryId || null,
    status: replayResponse.status || null,
    duration: replayResponse.duration || null,
    tool_name: parsed.name,
    tool_args: parsed.args
  };
}

function summarize(rows) {
  const out = {};
  for (const row of rows) {
    const bucket = out[row.variant] || {
      total: 0,
      stay_silent: 0,
      speak_in_group: 0,
      other_tool: 0,
      samples: []
    };
    bucket.total += 1;
    if (row.tool_name === 'stay_silent') {
      bucket.stay_silent += 1;
    } else if (row.tool_name === 'speak_in_group') {
      bucket.speak_in_group += 1;
    } else {
      bucket.other_tool += 1;
    }
    bucket.samples.push({
      replayHistoryId: row.replayHistoryId,
      tool_name: row.tool_name,
      reason: row.tool_args?.reason || null,
      outcome: row.tool_args?.outcome || null,
      message: row.tool_args?.message || null,
      xiaoni_os: row.tool_args?.xiaoni_os || null
    });
    out[row.variant] = bucket;
  }
  return out;
}

async function main() {
  const originalLog = await getTrafficLogById(TRAFFIC_ID);
  if (!originalLog || !originalLog.request_body) {
    throw new Error(`Traffic log ${TRAFFIC_ID} not found or missing request_body`);
  }

  const originalBody = JSON.parse(originalLog.request_body);
  const variants = ['control', 'time_weighted', 'time_weighted_echo_guard'];
  const rows = [];

  for (const variantId of variants) {
    const variantBody = buildVariantBody(originalBody, variantId);
    for (let round = 1; round <= REPEATS; round += 1) {
      const row = await replayVariant(variantId, variantBody);
      row.round = round;
      rows.push(row);
      console.log(JSON.stringify({
        variant: row.variant,
        round,
        replayHistoryId: row.replayHistoryId,
        tool_name: row.tool_name,
        reason: row.tool_args?.reason || null,
        message: row.tool_args?.message || null
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
    `traffic-${TRAFFIC_ID}-real-replay-${stamp}.json`
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

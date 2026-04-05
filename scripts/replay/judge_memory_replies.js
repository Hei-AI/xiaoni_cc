#!/usr/bin/env node

'use strict';

const path = require('path');
const { parseArgs, readJsonl, writeJsonl, writeJson } = require('./common');

function usage() {
  console.log([
    'Usage: node scripts/replay/judge_memory_replies.js --samples <labeled.jsonl> --results <reply-results.jsonl> [options]',
    '',
    'Options:',
    '  --samples <path>        Required. Labeled replay sample JSONL.',
    '  --results <path>        Required. Reply generation result JSONL.',
    '  --out <path>            Output judged JSONL. Default: <results>.judged.jsonl',
    '  --provider-url <url>    Provider internal execute base URL. Default: PROVIDER_SERVICE_URL env.',
    '  --model <name>          Judge model. Default: gpt-5.4',
    '  --help                  Show this message'
  ].join('\n'));
}

function buildDefaultOutput(resultPath) {
  return resultPath.replace(/\.jsonl$/i, '.judged.jsonl');
}

function buildJudgePrompt(sample, candidates) {
  return [
    '你是群聊回复评审。',
    '目标：从候选回复里选出最像真人、最符合上下文的一项。',
    '如果最新消息最合理的动作其实是沉默，那么优先选择 [[SILENT]] 或最接近沉默的一项。',
    '不要偏爱更长、更聪明、更像 AI 的回复。',
    '只输出 JSON。',
    'JSON schema:',
    `{"winner":"${candidates.map((candidate) => candidate.strategy).join('|')}|tie","reason":"..."}`,
    '',
    '样本与人工说明:',
    JSON.stringify({
      latest_message: sample.message,
      recent_messages: sample.recent_messages,
      notes: sample.ground_truth?.notes || null,
      should_reply: sample.ground_truth?.should_reply,
      cue_to_xiaoni: sample.ground_truth?.cue_to_xiaoni
    }, null, 2),
    '',
    '候选回复:',
    JSON.stringify(candidates.map((candidate) => ({
      strategy: candidate.strategy,
      reply_text: candidate.reply_text,
      selected_memory_ids: candidate.selected_memory_ids,
      gate_prediction: candidate.gate_prediction || null
    })), null, 2)
  ].join('\n');
}

async function executeJudge({ providerUrl, prompt, model }) {
  const response = await fetch(`${providerUrl.replace(/\/$/, '')}/api/internal/agent/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      trace_id: `memory_reply_judge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      agent_turn: 0,
      agent_type: 'memory_reply_judge',
      prompt_name: 'memory_reply_judge',
      model,
      parameters: {
        temperature: 0,
        maxOutputTokens: 200,
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
        max_output_tokens: 200,
        temperature: 0,
        reasoning: {
          effort: 'low'
        }
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Provider judge execute failed: ${response.status} ${text}`);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.samples || !args.results) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const samplePath = path.resolve(String(args.samples));
  const resultPath = path.resolve(String(args.results));
  const outPath = args.out ? path.resolve(String(args.out)) : buildDefaultOutput(resultPath);
  const providerUrl = args['provider-url'] || process.env.PROVIDER_SERVICE_URL || '';
  const model = args.model || 'gpt-5.4';

  if (!providerUrl) {
    throw new Error('Missing --provider-url or PROVIDER_SERVICE_URL');
  }

  const sampleMap = new Map(readJsonl(samplePath).map((sample) => [sample.sample_id, sample]));
  const resultRows = readJsonl(resultPath);
  const resultMap = new Map();
  for (const row of resultRows) {
    const bucket = resultMap.get(row.sample_id) || [];
    bucket.push(row);
    resultMap.set(row.sample_id, bucket);
  }

  const judgedRows = [];
  for (const [sampleId, candidates] of resultMap.entries()) {
    const sample = sampleMap.get(sampleId);
    if (!sample) {
      continue;
    }

    const prompt = buildJudgePrompt(sample, candidates);
    let result = null;
    let parsed = null;
    let error = null;
    try {
      result = await executeJudge({ providerUrl, prompt, model });
      parsed = parseJsonObject(result.response);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }

    judgedRows.push({
      sample_id: sampleId,
      result,
      parsed,
      error
    });
  }

  writeJsonl(outPath, judgedRows);
  writeJson(outPath.replace(/\.jsonl$/i, '.meta.json'), {
    generated_at: new Date().toISOString(),
    sample_count: judgedRows.length,
    provider_url: providerUrl,
    model
  });
  console.log(`Wrote ${judgedRows.length} judged rows to ${outPath}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

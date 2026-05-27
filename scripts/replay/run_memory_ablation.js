#!/usr/bin/env node

'use strict';

const path = require('path');
const { parseArgs, readJsonl, writeJsonl, writeJson } = require('./common');

const DEFAULT_STRATEGIES = [
  { id: 'no_memory', model: null },
  { id: 'current_memory', model: null },
  { id: 'oracle_memory', model: null },
  { id: 'no_memory_gpt54', model: 'gpt-5.4' },
  { id: 'current_memory_gpt54', model: 'gpt-5.4' },
  { id: 'oracle_memory_gpt54', model: 'gpt-5.4' }
];

function usage() {
  console.log([
    'Usage: node scripts/replay/run_memory_ablation.js --samples <labeled.jsonl> [options]',
    '',
    'Options:',
    '  --samples <path>        Required. Replay sample JSONL.',
    '  --out <path>            Output result JSONL. Default: ~/.gstack/projects/liahua-qq_bot/replay/memory-ablation-results.jsonl',
    '  --provider-url <url>    Provider internal execute base URL. Default: PROVIDER_SERVICE_URL env.',
    '  --strategies <csv>      Default: no_memory,current_memory,oracle_memory,current_memory_gpt54',
    '  --dry-run               Do not call provider. Emit prompt payload only.',
    '  --help                  Show this message'
  ].join('\n'));
}

function buildDefaultOutput() {
  const home = process.env.HOME || '.';
  return path.join(home, '.gstack', 'projects', 'liahua-qq_bot', 'replay', 'memory-ablation-results.jsonl');
}

function pickStrategyDefinitions(arg) {
  if (!arg) {
    return DEFAULT_STRATEGIES;
  }
  const requested = String(arg).split(',').map((item) => item.trim()).filter(Boolean);
  return requested.map((id) => {
    const existing = DEFAULT_STRATEGIES.find((strategy) => strategy.id === id);
    return existing || { id, model: null };
  });
}

function selectCards(sample, strategyId) {
  return [];
}

function buildDecisionPrompt(sample, selectedCards) {
  const xiaoniUserId = Number(process.env.BOT_QQ_NUMBER || 1129974489);
  const candidateIds = selectedCards.map((card) => Number(card.id)).filter(Number.isFinite);
  return [
    '你是群聊真人感评估里的 pre-reply memory reasoner。',
    '你的任务不是生成回复，而是判断小腻现在是否应该说话，以及哪些记忆真的相关。',
    `小腻的 user_id 是 ${xiaoniUserId}。`,
    '最新这条 message 的 speaker_user_id 已经直接在输入里给你了，不需要你重复判断。',
    '你只需要判断最新 message 的 addressee_user_id，也就是这条话在社交上主要是对谁说的；如果并不明显是对某个人说，就输出 null。',
    '如果不确定，优先保持沉默。',
    '只输出 JSON，不要输出解释、Markdown 或额外文字。',
    'JSON schema:',
    '{"should_reply":true,"cue_to_xiaoni":false,"addressee_user_id":123,"relevant_memory_ids":[1],"decision_reason":"explicit_cue|natural_followup|not_about_xiaoni|intrusive_to_join|uncertain"}',
    `允许使用的 relevant_memory_ids: ${JSON.stringify(candidateIds)}`,
    '',
    '输入样本:',
    JSON.stringify({
      chat_type: sample.chat_type,
      group_id: sample.group_id,
      message: sample.message,
      recent_messages: sample.recent_messages,
      summary_text: sample.summary_text,
      memory_items: selectedCards,
      topic_projection: sample.topic_projection || []
    }, null, 2)
  ].join('\n');
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

function normalizePrediction(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const rawAddresseeUserId = Number.isFinite(Number(parsed.addressee_user_id))
    ? Number(parsed.addressee_user_id)
    : Number.isFinite(Number(parsed.target_user_id))
      ? Number(parsed.target_user_id)
      : null;
  const ids = Array.isArray(parsed.relevant_memory_ids)
    ? parsed.relevant_memory_ids.map(Number).filter(Number.isFinite)
    : [];
  return {
    should_reply: parsed.should_reply === true,
    cue_to_xiaoni: parsed.cue_to_xiaoni === true,
    addressee_user_id: Number.isFinite(rawAddresseeUserId) && rawAddresseeUserId > 0
      ? rawAddresseeUserId
      : null,
    relevant_memory_ids: Array.from(new Set(ids)),
    decision_reason: typeof parsed.decision_reason === 'string' ? parsed.decision_reason : 'unknown'
  };
}

function evaluatePrediction(sample, prediction) {
  const truth = sample.ground_truth || {};
  if (typeof truth.should_reply !== 'boolean' || typeof truth.cue_to_xiaoni !== 'boolean') {
    return null;
  }
  const truthAddresseeUserId = Number.isFinite(Number(truth.addressee_user_id))
    ? Number(truth.addressee_user_id)
    : Number.isFinite(Number(truth.target_user_id))
      ? Number(truth.target_user_id)
      : null;
  const truthMemoryIds = new Set(
    Array.isArray(truth.relevant_memory_ids)
      ? truth.relevant_memory_ids.map(Number).filter(Number.isFinite)
      : []
  );
  const predictedMemoryIds = new Set(
    Array.isArray(prediction?.relevant_memory_ids)
      ? prediction.relevant_memory_ids.map(Number).filter(Number.isFinite)
      : []
  );
  const memoryOverlap = [...predictedMemoryIds].filter((id) => truthMemoryIds.has(id)).length;
  const memoryPrecision = predictedMemoryIds.size === 0 ? (truthMemoryIds.size === 0 ? 1 : 0) : memoryOverlap / predictedMemoryIds.size;
  const memoryRecall = truthMemoryIds.size === 0 ? (predictedMemoryIds.size === 0 ? 1 : 0) : memoryOverlap / truthMemoryIds.size;
  return {
    should_reply_correct: prediction?.should_reply === truth.should_reply,
    cue_to_xiaoni_correct: prediction?.cue_to_xiaoni === truth.cue_to_xiaoni,
    addressee_user_correct: (prediction?.addressee_user_id || null) === truthAddresseeUserId,
    memory_precision: Number(memoryPrecision.toFixed(4)),
    memory_recall: Number(memoryRecall.toFixed(4))
  };
}

async function executeDecision({ providerUrl, prompt, model }) {
  const response = await fetch(`${providerUrl.replace(/\/$/, '')}/api/internal/agent/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      trace_id: `memory_eval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      agent_turn: 0,
      agent_type: 'memory_replay_eval',
      prompt_name: 'memory_replay_eval_reasoner',
      model: model || undefined,
      parameters: {
        temperature: 0.1,
        maxOutputTokens: 500,
        reasoningEffort: 'low'
      },
      canonicalRequest: {
        model: model || undefined,
        input: [{
          type: 'message',
          role: 'user',
          content: prompt
        }],
        instructions: 'Return strict JSON only.',
        tools: [],
        tool_choice: 'none',
        parallel_tool_calls: false,
        max_output_tokens: 500,
        temperature: 0.1,
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.samples) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const samplePath = path.resolve(String(args.samples));
  const outPath = args.out ? path.resolve(String(args.out)) : buildDefaultOutput();
  const providerUrl = args['provider-url'] || process.env.PROVIDER_SERVICE_URL || '';
  const dryRun = args['dry-run'] === true;
  const strategies = pickStrategyDefinitions(args.strategies);
  const samples = readJsonl(samplePath);
  const results = [];

  if (!dryRun && !providerUrl) {
    throw new Error('Missing --provider-url or PROVIDER_SERVICE_URL for non-dry-run execution');
  }

  for (const sample of samples) {
    for (const strategy of strategies) {
      const selectedCards = selectCards(sample, strategy.id);
      const prompt = buildDecisionPrompt(sample, selectedCards);
      let rawResponse = null;
      let prediction = null;
      let error = null;

      try {
        if (!dryRun) {
          rawResponse = await executeDecision({
            providerUrl,
            prompt,
            model: strategy.model
          });
          prediction = normalizePrediction(parseJsonObject(rawResponse.response));
        }
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }

      results.push({
        sample_id: sample.sample_id,
        strategy: strategy.id,
        model: strategy.model || null,
        selected_memory_ids: selectedCards.map((card) => Number(card.id)).filter(Number.isFinite),
        prompt,
        prediction,
        evaluation: prediction ? evaluatePrediction(sample, prediction) : null,
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
    dry_run: dryRun,
    provider_url: dryRun ? null : providerUrl,
    strategies
  });
  console.log(`Wrote ${results.length} ablation rows to ${outPath}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

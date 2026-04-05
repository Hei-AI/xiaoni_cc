#!/usr/bin/env node

'use strict';

const path = require('path');
const { listRelationshipMemoryCards, listSelfEvolutionStates } = require('../../packages/persistence');
const { parseArgs, readJsonl, writeJsonl } = require('./common');

function usage() {
  console.log([
    'Usage: node scripts/replay/refresh_samples_with_live_memory.js --samples <input.jsonl> [options]',
    '',
    'Options:',
    '  --samples <path>        Required. Replay sample JSONL to rewrite.',
    '  --out <path>            Output JSONL. Default: <samples>.live-memory.jsonl',
    '  --group-id <id>         Optional. Override group id for every sample.',
    '  --help                  Show this message'
  ].join('\n'));
}

function buildDefaultOutput(samplePath) {
  return samplePath.replace(/\.jsonl$/i, '.live-memory.jsonl');
}

function uniquePositiveIds(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
  ));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.samples) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const samplePath = path.resolve(String(args.samples));
  const outPath = args.out ? path.resolve(String(args.out)) : buildDefaultOutput(samplePath);
  const forcedGroupId = Number.isFinite(Number(args['group-id'])) ? Number(args['group-id']) : null;
  const rows = readJsonl(samplePath);
  const cardCache = new Map();
  const selfEvolutionCache = new Map();

  async function getCards(groupId) {
    if (!cardCache.has(groupId)) {
      const cards = await listRelationshipMemoryCards({ groupId, isActive: true, limit: 200 });
      cardCache.set(groupId, cards);
    }
    return cardCache.get(groupId);
  }

  async function getSelfEvolution(sessionKey, groupId) {
    const cacheKey = `${sessionKey}::${groupId}`;
    if (!selfEvolutionCache.has(cacheKey)) {
      const states = await listSelfEvolutionStates({ sessionKey, groupId, isActive: true, limit: 200 });
      selfEvolutionCache.set(cacheKey, states);
    }
    return selfEvolutionCache.get(cacheKey);
  }

  const rewritten = [];
  for (const row of rows) {
    const groupId = forcedGroupId || Number(row.group_id);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      rewritten.push(row);
      continue;
    }

    const cards = await getCards(groupId);
    const selfEvolutionStates = await getSelfEvolution(String(row.session_key || `group:${groupId}`), groupId);
    const currentSenderId = Number(row?.message?.sender_id);
    const recentSenderIds = uniquePositiveIds((row.recent_messages || []).map((message) => message.sender_id))
      .filter((senderId) => senderId !== currentSenderId);

    rewritten.push({
      ...row,
      relationship_cards: {
        group_cards: cards.filter((card) => card.target_user_id === null),
        current_user_cards: cards.filter((card) => Number(card.target_user_id) === currentSenderId),
        recent_user_cards: cards.filter((card) => recentSenderIds.includes(Number(card.target_user_id)))
      },
      self_evolution_states: {
        group_states: selfEvolutionStates.filter((state) => state.target_user_id === null),
        current_user_states: selfEvolutionStates.filter((state) => Number(state.target_user_id) === currentSenderId),
        recent_user_states: selfEvolutionStates.filter((state) => recentSenderIds.includes(Number(state.target_user_id)))
      }
    });
  }

  writeJsonl(outPath, rewritten);
  console.log(`Wrote ${rewritten.length} samples with live memory to ${outPath}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

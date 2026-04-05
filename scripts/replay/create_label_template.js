#!/usr/bin/env node

'use strict';

const path = require('path');
const { flattenRelationshipCards, parseArgs, readJsonl, writeJsonl } = require('./common');

function usage() {
  console.log([
    'Usage: node scripts/replay/create_label_template.js --samples <samples.jsonl> [options]',
    '',
    'Options:',
    '  --samples <path>        Required. Replay sample JSONL.',
    '  --out <path>            Output label JSONL. Default: <samples>.labels.jsonl',
    '  --memory-limit <n>      Number of candidate memory cards to surface in notes. Default: 8',
    '  --help                  Show this message'
  ].join('\n'));
}

function buildDefaultOutput(samplePath) {
  return samplePath.replace(/\.jsonl$/i, '.labels.jsonl');
}

function compactMessage(message) {
  if (!message || typeof message !== 'object') {
    return null;
  }
  return {
    sender_id: Number(message.sender_id),
    sender_name: message.sender_name || null,
    body_for_agent: message.body_for_agent || '',
    reply_to_body: message.reply_to_body || null,
    was_mentioned: message.was_mentioned === true
  };
}

function compactCard(card) {
  return {
    id: Number(card.id),
    card_type: card.card_type || null,
    target_user_id: card.target_user_id === null ? null : Number(card.target_user_id),
    summary_text: card.summary_text || '',
    source_message_ids: Array.isArray(card.source_message_ids)
      ? card.source_message_ids.map(Number).filter(Number.isFinite)
      : []
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.samples) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const samplePath = path.resolve(String(args.samples));
  const outPath = args.out ? path.resolve(String(args.out)) : buildDefaultOutput(samplePath);
  const memoryLimit = Math.max(1, Math.min(Number(args['memory-limit'] || 8), 20));
  const samples = readJsonl(samplePath);

  const rows = samples.map((sample) => {
    const candidateCards = flattenRelationshipCards(sample.relationship_cards || {})
      .slice(0, memoryLimit)
      .map(compactCard);

    return {
      sample_id: sample.sample_id,
      ground_truth: {
        should_reply: null,
        cue_to_xiaoni: null,
        addressee_user_id: null,
        relevant_memory_ids: [],
        memory_would_help: null,
        bad_reply_failure_mode: null,
        notes: ''
      },
      context_for_labeler: {
        message: compactMessage(sample.message),
        recent_messages: Array.isArray(sample.recent_messages)
          ? sample.recent_messages.map(compactMessage)
          : [],
        candidate_memory_cards: candidateCards
      }
    };
  });

  writeJsonl(outPath, rows);
  console.log(`Wrote ${rows.length} label template rows to ${outPath}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

#!/usr/bin/env node

'use strict';

const path = require('path');
const { parseArgs, readJsonl, writeJsonl } = require('./common');

function usage() {
  console.log([
    'Usage: node scripts/replay/merge_labels.js --samples <samples.jsonl> --labels <labels.jsonl> [--out <path>]',
    '',
    'Label line shape:',
    '  {"sample_id":"group-...","ground_truth":{"should_reply":true}}',
    'or',
    '  {"sample_id":"group-...","should_reply":true,"cue_to_xiaoni":false}'
  ].join('\n'));
}

function normalizeLabel(row) {
  if (row.ground_truth && typeof row.ground_truth === 'object') {
    return row.ground_truth;
  }
  const next = { ...row };
  delete next.sample_id;
  return next;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.samples || !args.labels) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const samplePath = path.resolve(String(args.samples));
  const labelPath = path.resolve(String(args.labels));
  const outPath = args.out ? path.resolve(String(args.out)) : samplePath;
  const samples = readJsonl(samplePath);
  const labels = readJsonl(labelPath);
  const byId = new Map(labels.map((row) => [row.sample_id, normalizeLabel(row)]));

  const merged = samples.map((sample) => {
    const label = byId.get(sample.sample_id);
    if (!label) {
      return sample;
    }
    return {
      ...sample,
      ground_truth: {
        ...(sample.ground_truth || {}),
        ...label
      }
    };
  });

  writeJsonl(outPath, merged);
  console.log(`Merged ${labels.length} label rows into ${outPath}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

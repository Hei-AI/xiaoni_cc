#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { parseArgs, readJsonl } = require('./common');

function usage() {
  console.log([
    'Usage: node scripts/replay/render_memory_report.js --results <results.jsonl> [--out <report.md>]',
    '',
    'Renders a markdown summary grouped by strategy.'
  ].join('\n'));
}

function buildDefaultOutput(resultPath) {
  return resultPath.replace(/\.jsonl$/i, '.report.md');
}

function buildMetaPath(resultPath) {
  return resultPath.replace(/\.jsonl$/i, '.meta.json');
}

function aggregate(rows) {
  const byStrategy = new Map();
  for (const row of rows) {
    const bucket = byStrategy.get(row.strategy) || {
      strategy: row.strategy,
      model: row.model || null,
      total: 0,
      errors: 0,
      shouldReplyCorrect: 0,
      cueCorrect: 0,
      addresseeCorrect: 0,
      memoryPrecisionSum: 0,
      memoryRecallSum: 0,
      evaluationCount: 0
    };
    bucket.total += 1;
    if (row.error) {
      bucket.errors += 1;
    }
    if (row.evaluation) {
      bucket.evaluationCount += 1;
      if (row.evaluation.should_reply_correct) {
        bucket.shouldReplyCorrect += 1;
      }
      if (row.evaluation.cue_to_xiaoni_correct) {
        bucket.cueCorrect += 1;
      }
      if (row.evaluation.addressee_user_correct) {
        bucket.addresseeCorrect += 1;
      }
      bucket.memoryPrecisionSum += Number(row.evaluation.memory_precision || 0);
      bucket.memoryRecallSum += Number(row.evaluation.memory_recall || 0);
    }
    byStrategy.set(row.strategy, bucket);
  }
  return [...byStrategy.values()];
}

function ratio(numerator, denominator) {
  if (!denominator) {
    return 'n/a';
  }
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function readMeta(resultPath) {
  const metaPath = buildMetaPath(resultPath);
  if (!fs.existsSync(metaPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return null;
  }
}

function buildMarkdown(rows, meta) {
  const aggregates = aggregate(rows);
  const sections = [
    '# Memory Replay Report',
    '',
    `Generated at ${new Date().toISOString()}`,
    '',
    meta && meta.dry_run ? '> Mode: dry-run. Rows only contain prompt payloads, not model predictions.' : null,
    meta && meta.dry_run ? '' : null,
    '| Strategy | Model | Rows | Eval Rows | Errors | Should Reply Acc | Cue Acc | Addressee Acc | Memory Precision | Memory Recall |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|'
  ].filter(Boolean);

  for (const item of aggregates) {
    sections.push([
      `| ${item.strategy}`,
      item.model || 'default',
      `${item.total}`,
      `${item.evaluationCount}`,
      `${item.errors}`,
      ratio(item.shouldReplyCorrect, item.evaluationCount),
      ratio(item.cueCorrect, item.evaluationCount),
      ratio(item.addresseeCorrect, item.evaluationCount),
      item.evaluationCount ? `${(item.memoryPrecisionSum / item.evaluationCount).toFixed(3)}` : 'n/a',
      item.evaluationCount ? `${(item.memoryRecallSum / item.evaluationCount).toFixed(3)}` : 'n/a'
    ].join(' | ') + ' |');
  }

  const failures = rows
    .filter((row) => row.error || (!meta?.dry_run && !row.prediction))
    .slice(0, 20);
  if (failures.length > 0) {
    sections.push('', '## Execution Failures', '');
    for (const row of failures) {
      sections.push(`- \`${row.sample_id}\` / \`${row.strategy}\` — ${row.error || 'missing prediction'}`);
    }
  }

  return `${sections.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.results) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const resultPath = path.resolve(String(args.results));
  const outPath = args.out ? path.resolve(String(args.out)) : buildDefaultOutput(resultPath);
  const rows = readJsonl(resultPath);
  const meta = readMeta(resultPath);
  fs.writeFileSync(outPath, buildMarkdown(rows, meta), 'utf8');
  console.log(`Wrote markdown report to ${outPath}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

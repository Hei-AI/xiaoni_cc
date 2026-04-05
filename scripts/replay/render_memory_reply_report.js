#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { parseArgs, readJsonl } = require('./common');

function usage() {
  console.log([
    'Usage: node scripts/replay/render_memory_reply_report.js --results <results.jsonl> [--out <report.md>]',
    '',
    'Renders reply texts grouped by sample id.'
  ].join('\n'));
}

function buildDefaultOutput(resultPath) {
  return resultPath.replace(/\.jsonl$/i, '.report.md');
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
  const bySample = new Map();

  for (const row of rows) {
    const bucket = bySample.get(row.sample_id) || [];
    bucket.push(row);
    bySample.set(row.sample_id, bucket);
  }

  const lines = ['# Memory Reply Report', '', `Generated at ${new Date().toISOString()}`, ''];
  for (const [sampleId, sampleRows] of bySample.entries()) {
    lines.push(`## ${sampleId}`, '');
    for (const row of sampleRows) {
      lines.push(`### ${row.strategy}`, '');
      lines.push(`- memory_ids: ${JSON.stringify(row.selected_memory_ids || [])}`);
      lines.push(`- error: ${row.error || 'none'}`);
      lines.push(`- reply: ${row.reply_text || '(empty)'}`);
      lines.push('');
    }
  }

  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Wrote markdown report to ${outPath}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

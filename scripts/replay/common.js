#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }

    const keyValue = token.slice(2).split('=');
    const key = keyValue[0];
    const inlineValue = keyValue.length > 1 ? keyValue.slice(1).join('=') : undefined;
    if (typeof inlineValue !== 'undefined') {
      args[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }
  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonl(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Failed to parse JSONL at ${filePath}:${index + 1}: ${error.message}`);
      }
    });
}

function writeJsonl(filePath, rows) {
  ensureDir(path.dirname(filePath));
  const content = rows.map((row) => JSON.stringify(row)).join('\n');
  fs.writeFileSync(filePath, `${content}${rows.length > 0 ? '\n' : ''}`, 'utf8');
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function asNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asBoolean(value, fallback = null) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return fallback;
}

function parseJson(value, fallback) {
  if (value === null || typeof value === 'undefined') {
    return fallback;
  }
  if (typeof value === 'object') {
    return value;
  }
  if (typeof value !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function flattenSelfEvolutionStates(buckets = {}) {
  return [
    ...(Array.isArray(buckets.group_states) ? buckets.group_states : []),
    ...(Array.isArray(buckets.current_user_states) ? buckets.current_user_states : []),
    ...(Array.isArray(buckets.recent_user_states) ? buckets.recent_user_states : [])
  ];
}

function formatDateSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

module.exports = {
  asBoolean,
  asNumber,
  ensureDir,
  flattenSelfEvolutionStates,
  formatDateSlug,
  parseArgs,
  parseJson,
  readJsonl,
  writeJson,
  writeJsonl
};

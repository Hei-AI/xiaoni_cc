import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export const XIAONI_PROMPT_DIR = resolve(__dirname, '../../../../docs/xiaoni_prompt');

type PromptFileCacheEntry = {
  mtimeMs: number;
  size: number;
  text: string;
};

const promptFileCache = new Map<string, PromptFileCacheEntry>();

export function resolveXiaoniPromptFile(fileName: string) {
  return resolve(XIAONI_PROMPT_DIR, fileName);
}

export function readXiaoniPromptFile(fileName: string) {
  const filePath = resolveXiaoniPromptFile(fileName);
  const stats = statSync(filePath);
  const cached = promptFileCache.get(filePath);

  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.text;
  }

  const text = readFileSync(filePath, 'utf8');
  promptFileCache.set(filePath, {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    text
  });
  return text;
}

export function renderXiaoniPromptTemplate(
  fileName: string,
  variables: Record<string, string | number | null | undefined> = {}
) {
  return readXiaoniPromptFile(fileName).replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    const value = variables[key];
    return value === null || value === undefined ? match : String(value);
  });
}

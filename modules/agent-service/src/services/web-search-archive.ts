// Spill-to-file + windowed paging for web_search results.
//
// Why: Tavily returns full page text (include_raw_content). Dumping that into the
// loop would bloat 小腻's context, and since the cost driver is cache-read every
// turn, an oversized tool result keeps costing tokens forever. So we write the
// FULL rendered results to a file under /xiaoni-runtime/web-search/<ref>.md and
// return only a fixed-size character window. The tail is never lost:
//   - she can re-call web_search(result_ref, page=N) → we slice page N from the file
//   - or exec_command grep/cat the same path (executor mounts the same host dir RW)
//
// No filtering: rendering is verbatim; the only shaping is windowing + a per-day
// soft cap to protect the free API quota.

import { promises as fs } from 'fs';
import path from 'path';
import type { WebSearchResultItem, WebSearchSource } from './web-search-client';

export interface RenderResultsParams {
  query: string;
  source: WebSearchSource;
  results: WebSearchResultItem[];
  generatedAt: string;
}

/** Deterministic, filesystem-safe ref. */
export function sanitizeRef(ref: string): string {
  const cleaned = (ref || '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_').replace(/^[_.]+|[_.]+$/g, '');
  return cleaned.slice(0, 120) || 'web-search';
}

/** Render the full result set to markdown — verbatim, no truncation. */
export function renderResultsMarkdown(params: RenderResultsParams): string {
  const lines: string[] = [];
  lines.push(`# web_search: ${params.query}`);
  lines.push('');
  lines.push(`- source: ${params.source}`);
  lines.push(`- results: ${params.results.length}`);
  lines.push(`- generated_at: ${params.generatedAt}`);
  lines.push('');
  params.results.forEach((item, index) => {
    lines.push(`## [${index + 1}] ${item.title || item.url}`);
    lines.push(item.url);
    if (item.score !== null) {
      lines.push(`score: ${item.score}`);
    }
    lines.push('');
    lines.push(item.content || '(no content)');
    lines.push('');
  });
  return lines.join('\n');
}

export interface PageView {
  text: string;
  page: number;
  totalPages: number;
}

/**
 * Window `markdown` into fixed-size pages. Pure — exported for tests.
 * Breaks on a newline near the boundary when possible so a page doesn't cut a line.
 */
export function paginate(markdown: string, page: number, pageChars: number): PageView {
  const size = Math.max(500, pageChars);
  const total = markdown.length === 0 ? 1 : Math.ceil(markdown.length / size);
  const totalPages = Math.max(1, total);
  const clampedPage = Math.min(totalPages, Math.max(1, Math.trunc(page) || 1));
  const start = (clampedPage - 1) * size;
  let end = Math.min(markdown.length, start + size);
  // Soft newline backtrack (only when there's a later page and we found a newline
  // within the last 20% of the window).
  if (end < markdown.length) {
    const nl = markdown.lastIndexOf('\n', end);
    if (nl > start + size * 0.8) {
      end = nl + 1;
    }
  }
  return { text: markdown.slice(start, end), page: clampedPage, totalPages };
}

function resultFilePath(dir: string, ref: string): string {
  return path.join(dir, `${sanitizeRef(ref)}.md`);
}

export async function writeResultsFile(dir: string, ref: string, markdown: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const filePath = resultFilePath(dir, ref);
  await fs.writeFile(filePath, markdown, 'utf8');
  return filePath;
}

export interface ReadPageResult extends PageView {
  found: boolean;
  filePath: string;
}

export async function readResultsPage(dir: string, ref: string, page: number, pageChars: number): Promise<ReadPageResult> {
  const filePath = resultFilePath(dir, ref);
  let markdown: string;
  try {
    markdown = await fs.readFile(filePath, 'utf8');
  } catch {
    return { found: false, filePath, text: '', page: 1, totalPages: 1 };
  }
  return { found: true, filePath, ...paginate(markdown, page, pageChars) };
}

/** Delete result files older than maxAgeDays. Returns count removed. nowMs injectable for tests. */
export async function pruneOldResultFiles(dir: string, maxAgeDays: number, nowMs: number): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return 0;
  }
  const cutoff = nowMs - maxAgeDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const entry of entries) {
    if (!entry.endsWith('.md')) {
      continue;
    }
    const full = path.join(dir, entry);
    try {
      const stat = await fs.stat(full);
      if (stat.mtimeMs < cutoff) {
        await fs.rm(full, { force: true });
        removed += 1;
      }
    } catch {
      // ignore individual file errors
    }
  }
  return removed;
}

export interface DailyUsage {
  allowed: boolean;
  count: number;
  limit: number;
}

/**
 * Soft per-day cap to protect free API quota. Reads/writes <dir>/.usage.json.
 * `today` is a YYYY-MM-DD string supplied by the caller (injectable for tests).
 * Returns allowed=false once count would exceed limit; still increments the
 * attempt count is the caller's choice — we only bump on allowed calls.
 */
export async function checkDailyUsage(dir: string, today: string, limit: number): Promise<DailyUsage> {
  if (!Number.isFinite(limit) || limit <= 0) {
    return { allowed: true, count: 0, limit };
  }
  const usagePath = path.join(dir, '.usage.json');
  let count = 0;
  try {
    const raw = await fs.readFile(usagePath, 'utf8');
    const parsed = JSON.parse(raw) as { date?: string; count?: number };
    if (parsed && parsed.date === today && typeof parsed.count === 'number') {
      count = parsed.count;
    }
  } catch {
    count = 0;
  }
  if (count >= limit) {
    return { allowed: false, count, limit };
  }
  const next = count + 1;
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(usagePath, JSON.stringify({ date: today, count: next }), 'utf8');
  } catch {
    // best-effort; don't block search on usage bookkeeping failure
  }
  return { allowed: true, count: next, limit };
}

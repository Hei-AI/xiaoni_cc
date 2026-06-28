import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  renderResultsMarkdown,
  paginate,
  sanitizeRef,
  writeResultsFile,
  readResultsPage,
  pruneOldResultFiles,
  checkDailyUsage
} from '../services/web-search-archive';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ws-archive-'));
}

test('sanitizeRef strips unsafe chars and bounds length', () => {
  assert.equal(sanitizeRef('ws-AbC_1.2'), 'ws-AbC_1.2');
  // path-traversal chars are stripped to a flat, separator-free token
  assert.doesNotMatch(sanitizeRef('../../etc/passwd'), /[\/\\:.\s]{2,}|\//);
  assert.doesNotMatch(sanitizeRef('a/b\\c:d e'), /[\/\\:\s]/);
  assert.equal(sanitizeRef(''), 'web-search');
});

test('renderResultsMarkdown includes query, urls and content verbatim', () => {
  const md = renderResultsMarkdown({
    query: 'cats',
    source: 'tavily',
    generatedAt: '2026-06-28T00:00:00Z',
    results: [
      { title: 'Cat', url: 'https://cat.example', content: 'meow meow', score: 0.8 },
      { title: '', url: 'https://x.example', content: '', score: null }
    ]
  });
  assert.match(md, /web_search: cats/);
  assert.match(md, /https:\/\/cat\.example/);
  assert.match(md, /meow meow/);
  assert.match(md, /\(no content\)/); // empty content placeholder
});

test('paginate windows by size, clamps page, reports totalPages', () => {
  const body = 'x'.repeat(2500);
  const p1 = paginate(body, 1, 1000);
  assert.equal(p1.totalPages, 3);
  assert.equal(p1.page, 1);
  assert.ok(p1.text.length <= 1000);
  const p2 = paginate(body, 2, 1000);
  assert.equal(p2.page, 2);
  // out-of-range page clamps to last
  const p9 = paginate(body, 9, 1000);
  assert.equal(p9.page, 3);
  // empty doc is a single page
  assert.equal(paginate('', 1, 1000).totalPages, 1);
});

test('write then read paginated round-trips and reports not-found', async () => {
  const dir = await tmpDir();
  // distinct per-line content so different windows are not byte-identical
  const md = Array.from({ length: 600 }, (_, i) => `line-${i}-payload`).join('\n'); // ~9k chars
  const filePath = await writeResultsFile(dir, 'ws-abc', md);
  assert.ok(filePath.endsWith('ws-abc.md'));
  const page1 = await readResultsPage(dir, 'ws-abc', 1, 1000);
  assert.equal(page1.found, true);
  assert.ok(page1.totalPages >= 3);
  assert.equal(page1.page, 1);
  const page2 = await readResultsPage(dir, 'ws-abc', 2, 1000);
  assert.equal(page2.found, true);
  assert.notEqual(page1.text, page2.text);
  const missing = await readResultsPage(dir, 'nope', 1, 1000);
  assert.equal(missing.found, false);
});

test('pruneOldResultFiles removes stale files and keeps fresh ones', async () => {
  const dir = await tmpDir();
  await writeResultsFile(dir, 'old', 'old');
  await writeResultsFile(dir, 'new', 'new');
  const oldPath = path.join(dir, 'old.md');
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  await fs.utimes(oldPath, eightDaysAgo, eightDaysAgo);
  const removed = await pruneOldResultFiles(dir, 7, Date.now());
  assert.equal(removed, 1);
  assert.equal((await readResultsPage(dir, 'old', 1, 1000)).found, false);
  assert.equal((await readResultsPage(dir, 'new', 1, 1000)).found, true);
});

test('pruneOldResultFiles tolerates a missing directory', async () => {
  const removed = await pruneOldResultFiles(path.join(os.tmpdir(), 'ws-does-not-exist-xyz'), 7, Date.now());
  assert.equal(removed, 0);
});

test('checkDailyUsage increments within the day, blocks past the limit, resets next day', async () => {
  const dir = await tmpDir();
  const day = '2026-06-28';
  const a = await checkDailyUsage(dir, day, 2);
  assert.deepEqual([a.allowed, a.count], [true, 1]);
  const b = await checkDailyUsage(dir, day, 2);
  assert.deepEqual([b.allowed, b.count], [true, 2]);
  const c = await checkDailyUsage(dir, day, 2);
  assert.equal(c.allowed, false);
  // new day resets
  const d = await checkDailyUsage(dir, '2026-06-29', 2);
  assert.deepEqual([d.allowed, d.count], [true, 1]);
});

test('checkDailyUsage with non-positive limit is unlimited', async () => {
  const dir = await tmpDir();
  const r = await checkDailyUsage(dir, '2026-06-28', 0);
  assert.equal(r.allowed, true);
});

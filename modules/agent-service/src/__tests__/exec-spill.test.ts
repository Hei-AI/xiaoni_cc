import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StreamCapture, pruneExecOutput } from '../services/agent-loop-service';

// The agent-service StreamCapture is a behavioural MIRROR of the xiaoni-executor
// live path (it only runs in the non-Docker local-dev exec fallback). This smoke
// test guards against silent drift between the two copies, and covers
// pruneExecOutput — which runs at EVERY agent-service startup (prod included),
// not just the dev fallback.

async function feed(text: string, maxChars: number, spillPath: () => string): Promise<StreamCapture> {
  const cap = new StreamCapture(maxChars, spillPath);
  const buf = Buffer.from(text, 'utf8');
  for (let i = 0; i < buf.length; i += 1) {
    cap.push(buf.subarray(i, i + 1)); // one byte at a time → exercise multibyte reassembly
  }
  cap.end();
  await cap.settled();
  return cap;
}

test('agent-service StreamCapture mirrors head+tail+spill (parity with executor)', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'as-exec-'));
  try {
    const spill = path.join(root, 's.stdout.txt');
    const text = Array.from({ length: 40 }, (_, i) => `行${i}内容内容内容`).join('\n');
    const cap = await feed(text, 20, () => spill);
    assert.equal(cap.truncated, true);
    assert.ok(cap.render().startsWith(text.slice(0, 10)), 'head preview');
    assert.ok(cap.render().endsWith(text.slice(-10)), 'tail preview (newest survives)');
    assert.ok(cap.render().includes('已省略'), 'elision marker');
    assert.equal((await readFile(spill)).toString('utf8'), text, 'spill = full output byte-for-byte');
    assert.equal(cap.totalChars, text.length, 'true pre-truncation size');
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    assert.ok(!loneSurrogate.test(cap.render()), 'no split surrogate in preview');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('agent-service StreamCapture: under cap returns full inline, writes no file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'as-exec2-'));
  try {
    const spill = path.join(root, 's.txt');
    const cap = await feed('hello world', 100, () => spill);
    assert.equal(cap.truncated, false);
    assert.equal(cap.render(), 'hello world');
    assert.equal(existsSync(spill), false, 'no litter under cap');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('agent-service pruneExecOutput removes past-TTL spill files (runs at prod startup)', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'as-prune-'));
  try {
    const dir = path.join(root, 'exec-output');
    await mkdir(dir, { recursive: true });
    const oldFile = path.join(dir, 'old.stdout.txt');
    const newFile = path.join(dir, 'new.stdout.txt');
    await writeFile(oldFile, 'old');
    await writeFile(newFile, 'new');
    const now = Date.now();
    const old = new Date(now - 10 * 24 * 60 * 60 * 1000);
    await utimes(oldFile, old, old);
    const removed = await pruneExecOutput(root, 7, now);
    assert.equal(removed, 1);
    assert.equal(existsSync(oldFile), false, 'past-TTL pruned');
    assert.equal(existsSync(newFile), true, 'recent kept');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

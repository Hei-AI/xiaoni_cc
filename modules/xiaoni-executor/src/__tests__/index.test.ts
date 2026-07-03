import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  StreamCapture,
  evaluateCommandPolicy,
  formatCodexOutput,
  persistSession,
  pruneExecOutput,
  spillHeaderNote,
  storePicture,
  translateCommandPaths
} from '../index';

// Minimal RuntimeSession-shaped object for exercising persistSession /
// pruneClosedSessions in isolation. Real StreamCaptures so sessionToSnapshot's
// totalChars + spillHeaderNote reads behave like production.
function makeSession(overrides: Record<string, unknown> = {}): Parameters<typeof persistSession>[0] {
  const spill = () => path.join(tmpdir(), 'xiaoni-exec-test-unused-spill');
  return {
    id: 'exec_test',
    chunkId: 'chunk123',
    cmd: 'echo hi',
    translatedCmd: 'echo hi',
    workdir: '/workspace/qq_bot',
    shell: '/bin/bash',
    login: true,
    tty: false,
    sandboxPermissions: 'use_default',
    startedAt: Date.now() - 1000,
    stdout: '',
    stderr: '',
    stdoutCap: new StreamCapture(1000, spill),
    stderrCap: new StreamCapture(1000, spill),
    truncated: false,
    maxOutputChars: 1000,
    timedOut: false,
    child: undefined,
    exitCode: null,
    signal: null,
    closed: false,
    closedAt: null,
    gitArchiveDir: null,
    gitArchiveError: null,
    persistWriting: false,
    persistDirty: false,
    ...overrides
  } as unknown as Parameters<typeof persistSession>[0];
}

// Feed `text` to a capture as either one chunk or N byte-sized chunks and return
// the settled capture. Byte-slicing forces multibyte chars across chunk edges.
async function feed(text: string, maxChars: number, spillPath: () => string, mode: 'whole' | 'bytes', ceiling?: number): Promise<StreamCapture> {
  const cap = new StreamCapture(maxChars, spillPath, ceiling);
  const buf = Buffer.from(text, 'utf8');
  if (mode === 'whole') {
    cap.push(buf);
  } else {
    for (let i = 0; i < buf.length; i += 1) {
      cap.push(buf.subarray(i, i + 1));
    }
  }
  cap.end();
  await cap.settled();
  return cap;
}

test('translateCommandPaths maps agent /app paths into the mounted workspace', () => {
  assert.equal(
    translateCommandPaths("sed -n '1,8p' /app/modules/agent-service/skills/qq-usage/SKILL.md", '/workspace/qq_bot'),
    "sed -n '1,8p' /workspace/qq_bot/modules/agent-service/skills/qq-usage/SKILL.md"
  );
  assert.equal(
    translateCommandPaths('ls /app && pwd', '/workspace/qq_bot'),
    'ls /workspace/qq_bot && pwd'
  );
});

test('evaluateCommandPolicy trusts Xiaoni and only rejects empty commands', () => {
  assert.deepEqual(evaluateCommandPolicy(''), {
    allowed: false,
    reason: 'empty command'
  });
  assert.equal(evaluateCommandPolicy('docker restart qqbot-agent-service').allowed, true);
  assert.equal(evaluateCommandPolicy('docker container kill qqbot-agent-service').allowed, true);
  assert.equal(evaluateCommandPolicy('docker compose up -d agent-service').allowed, true);
  assert.equal(evaluateCommandPolicy('docker ps').allowed, true);
});

test('formatCodexOutput keeps the model-facing callback close to Codex exec output', () => {
  const output = formatCodexOutput({
    chunkId: 'abc123',
    durationMs: 42,
    exitCode: 0,
    output: 'executor-ok'
  });
  assert.match(output, /^Chunk ID: abc123/);
  assert.match(output, /Wall time: 0\.0420 seconds/);
  assert.match(output, /Process exited with code 0/);
  assert.match(output, /Output:\nexecutor-ok$/);
});

test('storePicture writes a generated image into the runtime picture directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaoni-runtime-'));
  try {
    const stored = await storePicture({
      picture_id: 'task_artifact_123',
      data_url: 'data:image/png;base64,aGVsbG8=',
      mime_type: 'image/png',
      format: 'png'
    }, root);

    assert.equal(stored.picture_id, 'task_artifact_123');
    assert.equal(stored.filename, 'task_artifact_123.png');
    assert.equal(stored.path, path.join(root, 'picture', 'task_artifact_123.png'));
    assert.equal(stored.mime_type, 'image/png');
    assert.equal(stored.bytes, 5);
    assert.equal((await readFile(stored.path)).toString('utf8'), 'hello');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('StreamCapture: under cap returns full output inline and writes no spill file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exec-cap-'));
  try {
    const spill = path.join(root, 's.stdout.txt');
    const cap = await feed('hello world', 100, () => spill, 'whole');
    assert.equal(cap.truncated, false);
    assert.equal(cap.render(), 'hello world');
    assert.equal(cap.spillPath, null);
    assert.equal(existsSync(spill), false, 'non-truncated must not litter a spill file');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('StreamCapture: over cap keeps head+tail inline, spills FULL bytes, marker carries path', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exec-trunc-'));
  try {
    const spill = path.join(root, 's.stdout.txt');
    const text = Array.from({ length: 40 }, (_, i) => `line${i}`).join('\n');
    const cap = await feed(text, 20, () => spill, 'whole'); // maxChars 20 → head 10 + tail 10
    assert.equal(cap.truncated, true);
    const rendered = cap.render();
    // Head is the oldest bytes, tail is the NEWEST — the qq-usage fix.
    assert.ok(rendered.startsWith(text.slice(0, 10)), 'head preview = start of output');
    assert.ok(rendered.endsWith(text.slice(-10)), 'tail preview = newest output');
    assert.equal(cap.spillPath, spill, 'spill path is exposed (surfaced in the header, not the marker)');
    assert.ok(rendered.includes('已省略'), 'in-body marker states the middle was elided');
    // The actionable path lives in the HEADER note, not the in-body marker.
    assert.ok(spillHeaderNote(cap, new StreamCapture(20, () => spill))!.includes(spill), 'header note carries the spill path');
    // Spill file is the COMPLETE output, byte-for-byte (the tail head-keep used to drop).
    assert.equal((await readFile(spill)).toString('utf8'), text);
    assert.equal(cap.totalChars, text.length, 'totalChars is the TRUE pre-truncation size');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('StreamCapture: streaming-equivalence — one chunk vs one-byte chunks are byte-identical', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exec-stream-'));
  try {
    const text = '状态行\n' + Array.from({ length: 60 }, (_, i) => `第${i}行内容`).join('\n');
    const whole = await feed(text, 40, () => path.join(root, 'whole.txt'), 'whole');
    const bytes = await feed(text, 40, () => path.join(root, 'bytes.txt'), 'bytes');
    // Normalize the injected spill path (the only intentional difference) so the
    // structural preview is compared.
    const norm = (c: StreamCapture) => c.render().replace(c.spillPath ?? '', 'PATH');
    assert.equal(norm(whole), norm(bytes), 'render identical regardless of chunking');
    assert.equal(whole.totalChars, bytes.totalChars);
    assert.equal(whole.truncated, bytes.truncated);
    const a = (await readFile(path.join(root, 'whole.txt'))).toString('utf8');
    const b = (await readFile(path.join(root, 'bytes.txt'))).toString('utf8');
    assert.equal(a, b, 'spill files byte-identical');
    assert.equal(a, text, 'spill reconstructs the exact original');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('StreamCapture: multibyte survives chunk boundaries and cut boundaries (no mojibake)', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exec-mb-'));
  try {
    // Emoji (4-byte, surrogate pair) + CJK, delivered one byte at a time.
    const text = 'aaaa😀你好世界🎉bbbb';
    const cap = await feed(text, 1000, () => path.join(root, 'x.txt'), 'bytes');
    assert.equal(cap.truncated, false);
    assert.ok(!cap.render().includes('�'), 'no U+FFFD replacement chars');
    assert.equal(cap.render(), text, 'reassembled exactly');

    // Head cut lands inside the emoji surrogate pair — must not split it.
    const cut = 'aaaa😀' + '你好世界这是一段很长的中文用来撑爆容量限制'.repeat(5);
    const capCut = await feed(cut, 10, () => path.join(root, 'y.txt'), 'bytes'); // head 5
    assert.ok(capCut.truncated);
    assert.ok(!capCut.render().includes('�'), 'no replacement chars at head cut');
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    assert.ok(!loneSurrogate.test(capCut.render()), 'no split surrogate anywhere in preview');
    assert.equal((await readFile(path.join(root, 'y.txt'))).toString('utf8'), cut, 'spill still exact');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('StreamCapture: cap boundary triple — ==cap no truncate/no file, cap+1 truncates', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exec-bound-'));
  try {
    const atCap = await feed('a'.repeat(10), 10, () => path.join(root, 'at.txt'), 'whole');
    assert.equal(atCap.truncated, false, '==cap is not truncation');
    assert.equal(existsSync(path.join(root, 'at.txt')), false);

    const overCap = await feed('a'.repeat(11), 10, () => path.join(root, 'over.txt'), 'whole');
    assert.equal(overCap.truncated, true, 'cap+1 truncates');
    assert.equal(existsSync(path.join(root, 'over.txt')), true);
    // head 5 + tail 5, exactly 1 char elided, no overlap/duplication at the seam.
    assert.equal(overCap.render(), 'aaaaa\n…[中间约 1 字符已省略，完整见上方落盘文件]…\naaaaa');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('StreamCapture: spill ceiling caps the file and flags it', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exec-ceil-'));
  try {
    const spill = path.join(root, 'c.txt');
    const cap = await feed('a'.repeat(500), 20, () => spill, 'whole', 100); // 100-byte ceiling
    assert.equal(cap.truncated, true);
    assert.equal(cap.spillCeilingHit, true, 'ceiling hit is flagged');
    assert.equal((await stat(spill)).size, 100, 'spill file capped at the ceiling');
    assert.ok(spillHeaderNote(cap, new StreamCapture(20, () => spill))!.includes('50MB'), 'header note warns the file is also capped');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('StreamCapture: spill IO failure degrades to inline preview, never throws', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exec-io-'));
  try {
    // Make the spill parent a FILE so mkdir/open fails.
    const blocker = path.join(root, 'blocker');
    await writeFile(blocker, 'x');
    const badPath = path.join(blocker, 'nested', 's.txt');
    const cap = await feed('a'.repeat(100), 20, () => badPath, 'whole');
    assert.equal(cap.truncated, true);
    assert.equal(cap.spillError, true, 'IO error flagged');
    assert.ok(cap.render().includes('写盘失败'), 'marker tells her the full output is unavailable');
    assert.ok(!cap.render().includes(badPath), 'no phantom path when write failed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('StreamCapture: qq-usage symptom — newest-at-tail message stays visible after truncation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exec-qq-'));
  try {
    // Transcript oldest→newest; the notified line is the LAST one.
    const lines = Array.from({ length: 30 }, (_, i) => `<MESSAGE id=${i}>旧消息填充内容内容内容</MESSAGE>`);
    lines.push('<MESSAGE id=99>我引用的这个是啥意思</MESSAGE>');
    const text = lines.join('\n');
    const cap = await feed(text, 80, () => path.join(root, 'qq.txt'), 'whole');
    assert.equal(cap.truncated, true);
    assert.ok(cap.render().includes('我引用的这个是啥意思'), 'the newest notified message survives in the tail preview');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('formatCodexOutput: Original token count uses the true pre-truncation total when provided', () => {
  // The capped `output` is short, but the real output was 4000 chars → 1000 tokens.
  const out = formatCodexOutput({
    chunkId: 'abc123',
    durationMs: 10,
    exitCode: 0,
    output: 'HEAD…elided…TAIL',
    truncated: true,
    originalTokenCount: 1000
  });
  assert.match(out, /Original token count: 1000/);
  assert.match(out, /Output was truncated to max_output_tokens\./);
});

test('formatCodexOutput: spill note is surfaced in the header, right after the truncation line', () => {
  const note = '完整输出已落盘，可读回：\n  完整 stdout: /xiaoni-runtime/exec-output/x.stdout.txt';
  const out = formatCodexOutput({
    chunkId: 'abc123',
    durationMs: 10,
    exitCode: 0,
    output: 'HEAD…\n…[中间约 9 字符已省略，完整见上方落盘文件]…\n…TAIL',
    truncated: true,
    originalTokenCount: 1000,
    spillNote: note
  });
  const lines = out.split('\n');
  const truncIdx = lines.findIndex((l) => l === 'Output was truncated to max_output_tokens.');
  assert.ok(truncIdx >= 0, 'truncation line present');
  assert.equal(lines[truncIdx + 1], '完整输出已落盘，可读回：', 'spill note immediately follows the truncation line');
  assert.ok(out.indexOf('/xiaoni-runtime/exec-output/x.stdout.txt') < out.indexOf('Output:'), 'path appears in the header, above the body');
});

test('spillHeaderNote: lists spilled streams, flags IO failure and ceiling, empty when nothing truncated', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exec-hdr-'));
  try {
    const okCap = await feed('a'.repeat(50), 20, () => path.join(root, 'ok.txt'), 'whole');
    const emptyCap = new StreamCapture(20, () => path.join(root, 'none.txt'));
    const note = spillHeaderNote(okCap, emptyCap);
    assert.ok(note && note.includes(path.join(root, 'ok.txt')), 'names the spilled stdout file');
    assert.ok(note!.includes('stdout') && !note!.includes('stderr'), 'only lists the stream that actually truncated');

    // Both streams truncated → both listed, stdout before stderr (order guard).
    const bothOut = await feed('a'.repeat(50), 20, () => path.join(root, 'both-out.txt'), 'whole');
    const bothErr = await feed('b'.repeat(50), 20, () => path.join(root, 'both-err.txt'), 'whole');
    const bothNote = spillHeaderNote(bothOut, bothErr)!;
    assert.ok(bothNote.indexOf('完整 stdout') < bothNote.indexOf('完整 stderr'), 'stdout listed before stderr');

    // stderr-only → note names stderr, not stdout.
    const errOut = new StreamCapture(20, () => path.join(root, 'eo-out.txt'));
    const errErr = await feed('c'.repeat(50), 20, () => path.join(root, 'eo-err.txt'), 'whole');
    const errNote = spillHeaderNote(errOut, errErr)!;
    assert.ok(errNote.includes('完整 stderr') && !errNote.includes('完整 stdout'), 'stderr-only names stderr not stdout');

    // Nothing truncated → no note at all (header stays clean).
    const smallA = await feed('hi', 100, () => path.join(root, 'a.txt'), 'whole');
    const smallB = new StreamCapture(100, () => path.join(root, 'b.txt'));
    assert.equal(spillHeaderNote(smallA, smallB), undefined, 'no note when nothing truncated');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('pruneExecOutput removes spill files past the TTL and keeps recent ones', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exec-prune-'));
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
    assert.equal(existsSync(oldFile), false, 'past-TTL file pruned');
    assert.equal(existsSync(newFile), true, 'recent file kept (survives into a later run that reads it)');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('persistSession: a coalesced chunk burst + close converges to running:false + real exit_code', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaoni-exec-persist-'));
  try {
    await mkdir(path.join(root, 'sessions'), { recursive: true });
    const session = makeSession({ id: 'exec_persist_conv' });
    // Simulate the production call pattern: fire-and-forget per-chunk writes
    // while running, then the close handler mutates the session and writes once
    // more. The first call becomes the active single-flight writer; the rest
    // coalesce into it. Only awaiting the active writer drains everything.
    const active = persistSession(session, root);
    persistSession(session, root); // coalesced -> dirty
    persistSession(session, root); // coalesced -> dirty
    // close handler runs (synchronous), THEN its persist call coalesces in
    (session as { closed: boolean }).closed = true;
    (session as { exitCode: number | null }).exitCode = 0;
    persistSession(session, root); // coalesced -> dirty, now carrying closed state
    await active;

    const snap = JSON.parse(await readFile(path.join(root, 'sessions', 'exec_persist_conv.json'), 'utf8'));
    assert.equal(snap.running, false, 'final snapshot must not be clobbered back to running:true');
    assert.equal(snap.exit_code, 0, 'final snapshot carries the real exit_code, not a stale null');
    // temp+rename leaves no torn/leftover files behind
    assert.deepEqual((await readdir(path.join(root, 'sessions'))).sort(), ['exec_persist_conv.json']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('persistSession: overlapping writers never leave a torn (unparseable) snapshot', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaoni-exec-torn-'));
  try {
    await mkdir(path.join(root, 'sessions'), { recursive: true });
    const session = makeSession({ id: 'exec_persist_torn' });
    const target = path.join(root, 'sessions', 'exec_persist_torn.json');
    // Kick off a large synchronous burst; single-flight collapses it, temp+rename
    // keeps every observable state a complete JSON document.
    const writers: Promise<void>[] = [];
    for (let i = 0; i < 50; i += 1) {
      (session as { stdout: string }).stdout = 'x'.repeat(i * 200);
      writers.push(persistSession(session, root));
    }
    await Promise.all(writers);
    // The file must always parse cleanly and no .tmp-* orphan is left.
    const files = await readdir(path.join(root, 'sessions'));
    assert.deepEqual(files, ['exec_persist_torn.json'], 'no leftover .tmp-* after the burst');
    const raw = await readFile(target, 'utf8');
    assert.doesNotThrow(() => JSON.parse(raw));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

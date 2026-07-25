import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clampDiaryIndexSnapshot, readDiaryIndexSnapshot, DIARY_INDEX_SNAPSHOT_MAX_BYTES } from '../services/agent-loop-service';

// 快照 cap 裁剪:超 8KB 从最老行丢、保最新;行边界;确定性。

test('clamp: under-limit content passes through trimmed', () => {
  const raw = '\n- 2026-07-23 | 修好了发图\n- 2026-07-24 | 做了不响\n';
  assert.equal(clampDiaryIndexSnapshot(raw), '- 2026-07-23 | 修好了发图\n- 2026-07-24 | 做了不响');
});

test('clamp: empty/whitespace/non-string yields null (no empty block downstream)', () => {
  assert.equal(clampDiaryIndexSnapshot(''), null);
  assert.equal(clampDiaryIndexSnapshot('   \n  \n'), null);
  assert.equal(clampDiaryIndexSnapshot(undefined as unknown as string), null);
});

test('clamp: over-limit drops OLDEST lines first, keeps newest tail within byte cap', () => {
  const lines: string[] = [];
  for (let i = 0; i < 1000; i += 1) {
    lines.push(`- 2026-01-${String((i % 28) + 1).padStart(2, '0')} | 第${i}天的一句话钩子内容占位符`);
  }
  const raw = lines.join('\n');
  const clamped = clampDiaryIndexSnapshot(raw);
  assert.ok(clamped !== null);
  assert.ok(Buffer.byteLength(clamped as string, 'utf8') <= DIARY_INDEX_SNAPSHOT_MAX_BYTES, 'clamped snapshot must fit the byte cap');
  const keptLines = (clamped as string).split('\n');
  // 保最新 = 裁剪结果必须是原文的严格尾段
  assert.deepEqual(keptLines, lines.slice(lines.length - keptLines.length), 'kept lines must be the exact newest tail of the original');
  assert.equal(keptLines[keptLines.length - 1], lines[lines.length - 1], 'the newest line must survive');
  assert.ok(!keptLines.includes(lines[0]), 'the oldest line must be dropped');
  // 确定性:同输入同输出
  assert.equal(clampDiaryIndexSnapshot(raw), clamped);
});

test('clamp: strips NUL bytes (PG text rejects \\u0000; poisoned INDEX.md must not stall the atomic commit)', () => {
  assert.equal(clampDiaryIndexSnapshot('- 2026-07-24 |\u0000 做了不响\u0000'), '- 2026-07-24 | 做了不响');
  assert.equal(clampDiaryIndexSnapshot('\u0000\u0000'), null);
});

test('clamp: content exactly at maxBytes passes through unchanged', () => {
  const exact = 'a'.repeat(DIARY_INDEX_SNAPSHOT_MAX_BYTES);
  assert.equal(clampDiaryIndexSnapshot(exact), exact);
});

test('clamp: single newest line over maxBytes is truncated at codepoint boundary, not dropped wholesale', () => {
  const older = '- 2026-07-23 | 老的一行';
  // 随 cap 缩放:保证单行始终超 DIARY_INDEX_SNAPSHOT_MAX_BYTES,cap 调大不失效
  const huge = `- 2026-07-24 | ${'钩'.repeat(Math.ceil(DIARY_INDEX_SNAPSHOT_MAX_BYTES / 3) + 1000)}`;
  const clamped = clampDiaryIndexSnapshot(`${older}\n${huge}`);
  assert.ok(clamped !== null, 'menu must not vanish because of one oversized line');
  assert.ok(Buffer.byteLength(clamped as string, 'utf8') <= DIARY_INDEX_SNAPSHOT_MAX_BYTES);
  assert.ok((clamped as string).startsWith('- 2026-07-24 | '), 'the newest line head must survive');
  assert.ok(!(clamped as string).includes('�'), 'codepoint truncation must not split a character');
});

test('readDiaryIndexSnapshot: reads and clamps a real file; nonexistent path yields null', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'diary-index-'));
  try {
    const file = join(dir, 'INDEX.md');
    writeFileSync(file, '\n- 2026-07-24 | 做了不响\u0000\n');
    assert.equal(await readDiaryIndexSnapshot(file), '- 2026-07-24 | 做了不响');
    assert.equal(await readDiaryIndexSnapshot(join(dir, 'missing.md')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

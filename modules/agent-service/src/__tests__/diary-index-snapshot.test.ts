import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clampDiaryIndexSnapshot, readDiaryIndexSnapshot, readPeopleIndexSnapshot, DIARY_INDEX_SNAPSHOT_MAX_BYTES } from '../services/agent-loop-service';

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

test('clamp: over-limit renders the overflow notice — never a partial menu', () => {
  const lines: string[] = [];
  for (let i = 0; i < 1000; i += 1) {
    lines.push(`- 2026-01-${String((i % 28) + 1).padStart(2, '0')} | \u7b2c${i}\u5929\u7684\u4e00\u53e5\u8bdd\u94a9\u5b50\u5185\u5bb9\u5360\u4f4d\u7b26`);
  }
  const raw = lines.join('\n');
  const clamped = clampDiaryIndexSnapshot(raw);
  assert.ok(clamped !== null);
  assert.ok(Buffer.byteLength(clamped as string, 'utf8') <= DIARY_INDEX_SNAPSHOT_MAX_BYTES);
  // \u5168\u6709\u6216\u5168\u65e0:\u8d85\u9650\u65f6\u4e0d\u8bb8\u663e\u793a\u4efb\u4f55\u83dc\u5355\u5185\u5bb9(\u90e8\u5206\u83dc\u5355=\u5fd8\u4eba\u4e8b\u6545\u590d\u523b),\u53ea\u7ed9\u6307\u5f15
  assert.ok((clamped as string).includes('\u663e\u793a\u4e0d\u4e0b'), 'overflow must render the notice');
  assert.ok(!(clamped as string).includes('\u94a9\u5b50\u5185\u5bb9\u5360\u4f4d\u7b26'), 'overflow must NOT leak any menu lines');
  // \u786e\u5b9a\u6027:\u540c\u8f93\u5165\u540c\u8f93\u51fa
  assert.equal(clampDiaryIndexSnapshot(raw), clamped);
});

test('clamp: no notice when content fits', () => {
  const raw = '- 2026-07-24 | \u505a\u4e86\u4e0d\u54cd';
  assert.equal(clampDiaryIndexSnapshot(raw), raw);
});

test('clamp: strips NUL bytes (PG text rejects \\u0000; poisoned INDEX.md must not stall the atomic commit)', () => {
  assert.equal(clampDiaryIndexSnapshot('- 2026-07-24 |\u0000 做了不响\u0000'), '- 2026-07-24 | 做了不响');
  assert.equal(clampDiaryIndexSnapshot('\u0000\u0000'), null);
});

test('clamp: content exactly at maxBytes passes through unchanged', () => {
  const exact = 'a'.repeat(DIARY_INDEX_SNAPSHOT_MAX_BYTES);
  assert.equal(clampDiaryIndexSnapshot(exact), exact);
});

test('clamp: single oversized line also renders the notice (same all-or-nothing rule)', () => {
  const huge = `- 2026-07-24 | ${'\u94a9'.repeat(Math.ceil(DIARY_INDEX_SNAPSHOT_MAX_BYTES / 3) + 1000)}`;
  const clamped = clampDiaryIndexSnapshot(huge);
  assert.ok(clamped !== null);
  assert.ok(Buffer.byteLength(clamped as string, 'utf8') <= DIARY_INDEX_SNAPSHOT_MAX_BYTES);
  assert.ok((clamped as string).includes('\u663e\u793a\u4e0d\u4e0b'));
  assert.ok(!(clamped as string).includes('\u94a9\u94a9'), 'no menu content may leak');
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

test('readPeopleIndexSnapshot: reads/clamps people menu (shared NUL strip); missing file yields null', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'people-index-'));
  try {
    const file = join(dir, 'INDEX.md');
    writeFileSync(file, '- \u963f\u82b1(85178516) | owner,agent\u65b9\u5411\u0000\n- \u6960\u6960 | \u5728\u8003\u7814\n');
    assert.equal(await readPeopleIndexSnapshot(file), '- \u963f\u82b1(85178516) | owner,agent\u65b9\u5411\n- \u6960\u6960 | \u5728\u8003\u7814');
    assert.equal(await readPeopleIndexSnapshot(join(dir, 'missing.md')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

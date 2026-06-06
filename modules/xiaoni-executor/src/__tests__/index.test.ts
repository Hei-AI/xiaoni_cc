import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluateCommandPolicy, formatCodexOutput, storePicture, translateCommandPaths } from '../index';

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

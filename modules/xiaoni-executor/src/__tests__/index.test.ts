import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCommandPolicy, formatCodexOutput, translateCommandPaths } from '../index';

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

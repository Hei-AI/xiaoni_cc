import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelContextPolicy } from '../services/model-context-policy';

test('uses conservative GPT-5.5 runtime context budget for Codex requests', () => {
  const policy = resolveModelContextPolicy('gpt-5.5');

  assert.ok(policy);
  assert.equal(policy.model, 'gpt-5.5');
  assert.equal(policy.contextWindowTokens, 272000);
  assert.equal(policy.maxOutputTokens, 128000);
});

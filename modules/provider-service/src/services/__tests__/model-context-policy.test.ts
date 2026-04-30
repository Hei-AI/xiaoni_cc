import test from 'node:test';
import assert from 'node:assert/strict';
import { computeContextThresholds, resolveModelContextPolicy } from '../llm-provider/model-context-policy';
import { normalizeUsageDetails } from '../llm-provider/helpers';
import { inferProviderFromModelName } from '../llm-provider/provider-config';

test('resolves built-in GPT-5 mini context policy', () => {
  const policy = resolveModelContextPolicy('gpt-5-mini');

  assert.ok(policy);
  assert.equal(policy.model, 'gpt-5-mini');
  assert.equal(policy.contextWindowTokens, 400000);
  assert.equal(policy.maxOutputTokens, 128000);
  assert.equal(policy.source, 'default');

  const thresholds = computeContextThresholds(policy, 12000);
  assert.equal(thresholds.replyBudgetTokens, 12000);
  assert.equal(thresholds.softTriggerTokens, 200000);
  assert.equal(thresholds.hardCeilingTokens, 349200);
});

test('supports alias policy resolution for gpt-5.4-mini', () => {
  const policy = resolveModelContextPolicy('gpt-5.4-mini');

  assert.ok(policy);
  assert.equal(policy.model, 'gpt-5-mini');
  assert.equal(policy.contextWindowTokens, 400000);
});

test('allows environment provider overrides by model name', () => {
  const original = process.env.MODEL_PROVIDER_OVERRIDES_JSON;
  process.env.MODEL_PROVIDER_OVERRIDES_JSON = JSON.stringify({
    'gpt-5.4': 'openai',
    'gpt-5-mini': 'codex',
    'gpt-5.4-mini': 'codex'
  });

  try {
    assert.equal(inferProviderFromModelName('gpt-5.4'), 'openai');
    assert.equal(inferProviderFromModelName('gpt-5-mini'), 'codex');
    assert.equal(inferProviderFromModelName('gpt-5.4-mini'), 'codex');
  } finally {
    if (original === undefined) {
      delete process.env.MODEL_PROVIDER_OVERRIDES_JSON;
    } else {
      process.env.MODEL_PROVIDER_OVERRIDES_JSON = original;
    }
  }
});

test('allows environment model context policy overrides', () => {
  const original = process.env.MODEL_CONTEXT_POLICIES_JSON;
  process.env.MODEL_CONTEXT_POLICIES_JSON = JSON.stringify({
    'gpt-5.4': {
      contextWindowTokens: 123456,
      maxOutputTokens: 24000,
      defaultReplyBudgetTokens: 4096,
      softTriggerRatio: 0.4,
      hardBufferRatio: 0.2
    }
  });

  try {
    const policy = resolveModelContextPolicy('gpt-5.4');
    assert.ok(policy);
    assert.equal(policy.source, 'environment');
    assert.equal(policy.contextWindowTokens, 123456);
    assert.equal(policy.maxOutputTokens, 24000);
    assert.equal(policy.defaultReplyBudgetTokens, 4096);
  } finally {
    if (original === undefined) {
      delete process.env.MODEL_CONTEXT_POLICIES_JSON;
    } else {
      process.env.MODEL_CONTEXT_POLICIES_JSON = original;
    }
  }
});

test('normalizes OpenAI-style usage details including cached and reasoning tokens', () => {
  const usage = normalizeUsageDetails({
    input_tokens: 1200,
    output_tokens: 340,
    total_tokens: 1540,
    input_tokens_details: {
      cached_tokens: 600
    },
    output_tokens_details: {
      reasoning_tokens: 80
    }
  });

  assert.equal(usage.inputTokens, 1200);
  assert.equal(usage.outputTokens, 340);
  assert.equal(usage.totalTokens, 1540);
  assert.equal(usage.cachedInputTokens, 600);
  assert.equal(usage.reasoningTokens, 80);
});

test('normalizes legacy prompt/completion usage shapes', () => {
  const usage = normalizeUsageDetails({
    prompt_tokens: 900,
    completion_tokens: 120,
    prompt_tokens_details: {
      cached_tokens: 400
    },
    completion_tokens_details: {
      reasoning_tokens: 32
    }
  });

  assert.equal(usage.inputTokens, 900);
  assert.equal(usage.outputTokens, 120);
  assert.equal(usage.totalTokens, 1020);
  assert.equal(usage.cachedInputTokens, 400);
  assert.equal(usage.reasoningTokens, 32);
});

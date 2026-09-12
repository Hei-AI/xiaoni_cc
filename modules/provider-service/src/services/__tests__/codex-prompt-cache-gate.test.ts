import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexPromptCacheAdmissionGate } from '../llm-provider/codex-prompt-cache-gate';

const GATE_ENV_NAMES = [
  'CODEX_PROMPT_CACHE_GATE_ENABLED',
  'CODEX_PROMPT_CACHE_GATE_RPM',
  'CODEX_PROMPT_CACHE_GATE_WINDOW_MS'
] as const;

function stablePayload(content = 'stable head', promptCacheKey = 'xiaoni:test-global') {
  return {
    model: 'claude-opus-4-6',
    prompt_cache_key: promptCacheKey,
    instructions: 'Stable prompt.',
    tools: [{ type: 'function', function: { name: 'noop' } }],
    input: [{ type: 'message', role: 'user', content }]
  };
}

function waitMs(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function withGateEnv(callback: (gate: CodexPromptCacheAdmissionGate) => Promise<void>) {
  const previous = Object.fromEntries(GATE_ENV_NAMES.map((name) => [name, process.env[name]]));
  const gate = new CodexPromptCacheAdmissionGate();
  try {
    process.env.CODEX_PROMPT_CACHE_GATE_ENABLED = 'true';
    process.env.CODEX_PROMPT_CACHE_GATE_RPM = '100';
    process.env.CODEX_PROMPT_CACHE_GATE_WINDOW_MS = '100';
    await callback(gate);
  } finally {
    gate.resetForTest();
    for (const name of GATE_ENV_NAMES) {
      const value = previous[name];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

test('same cache prefix admits only one active upstream request', async () => {
  await withGateEnv(async (gate) => {
    const first = await gate.acquire({ payload: stablePayload(), executionMode: 'agent_loop' });
    let secondSettled = false;
    const secondPromise = gate.acquire({ payload: stablePayload(), executionMode: 'cache_heartbeat_no_persist' });
    void secondPromise.then(() => {
      secondSettled = true;
    });

    await waitMs(20);
    assert.equal(secondSettled, false, 'a waiting request must not bypass an active same-prefix request');

    first.release();
    const second = await secondPromise;
    assert.equal(second.bypassed, false);
    second.release();
  });
});

test('queued admission is cancelled without starting an upstream request', async () => {
  await withGateEnv(async (gate) => {
    const first = await gate.acquire({ payload: stablePayload(), executionMode: 'agent_loop' });
    const controller = new AbortController();
    const secondPromise = gate.acquire({
      payload: stablePayload(),
      executionMode: 'agent_loop',
      signal: controller.signal
    });

    controller.abort();
    await assert.rejects(secondPromise, (error: unknown) => {
      return error instanceof Error && error.name === 'AbortError';
    });
    first.release();
  });
});

test('runExclusive releases the single-flight lease after the operation fails', async () => {
  await withGateEnv(async (gate) => {
    const expected = new Error('upstream failed');
    await assert.rejects(
      gate.runExclusive({ payload: stablePayload(), executionMode: 'agent_loop' }, async () => {
        throw expected;
      }),
      expected
    );

    let ran = false;
    await gate.runExclusive({ payload: stablePayload(), executionMode: 'agent_loop' }, async () => {
      ran = true;
    });
    assert.equal(ran, true);
  });
});

test('different cache prefixes may still run concurrently', async () => {
  await withGateEnv(async (gate) => {
    const first = await gate.acquire({ payload: stablePayload('first', 'xiaoni:first'), executionMode: 'agent_loop' });
    const second = await gate.acquire({ payload: stablePayload('second', 'xiaoni:second'), executionMode: 'agent_loop' });
    assert.notEqual(first.bucketKey, second.bucketKey);
    first.release();
    second.release();
  });
});

test('same cache namespace stays serialized when only the message tail differs', async () => {
  await withGateEnv(async (gate) => {
    const first = await gate.acquire({ payload: stablePayload('first'), executionMode: 'agent_loop' });
    let secondSettled = false;
    const secondPromise = gate.acquire({ payload: stablePayload('second'), executionMode: 'agent_loop' });
    void secondPromise.then(() => {
      secondSettled = true;
    });

    await waitMs(20);
    assert.equal(secondSettled, false, 'different message tails must not split a shared cache namespace');

    first.release();
    const second = await secondPromise;
    second.release();
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { projectAbMemoryContext } from '../services/ab-memory-projector';
import { AbMemoryStreamItem, AbRetrievalPolicySnapshot } from '../services/ab-types';

const policy: AbRetrievalPolicySnapshot = {
  relevanceWeight: 1,
  recencyWeight: 1,
  importanceWeight: 1,
  typeLimits: {
    observations: { maxItems: 2, maxTokens: 200 },
    reflections: { maxItems: 2, maxTokens: 200 },
    plans: { maxItems: 1, maxTokens: 200 },
    selfState: { maxItems: 1, maxTokens: 200 }
  },
  totalSoftCapTokens: 300,
  totalHardCapTokens: 500
};

function item(overrides: Partial<AbMemoryStreamItem>): AbMemoryStreamItem {
  return {
    id: overrides.id || 'item',
    namespace: overrides.namespace || 'ab:test',
    arm: overrides.arm || 'control',
    type: overrides.type || 'observation',
    subtype: overrides.subtype ?? null,
    content: overrides.content || 'memory content',
    retrievalText: overrides.retrievalText ?? null,
    embeddingText: overrides.embeddingText ?? null,
    importance: overrides.importance ?? 0.5,
    confidence: overrides.confidence ?? 0.8,
    status: overrides.status || 'active',
    sourceEventRefs: overrides.sourceEventRefs || [{ kind: 'test', id: overrides.id || 'item' }],
    provenance: overrides.provenance || { source: 'unit-test' },
    ttlExpiresAt: overrides.ttlExpiresAt ?? null,
    fulfilledAt: overrides.fulfilledAt ?? null,
    createdAt: overrides.createdAt || '2026-04-29T00:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-04-29T00:00:00.000Z'
  };
}

test('projectAbMemoryContext keeps observations, reflections, and plans separated', async () => {
  const context = await projectAbMemoryContext({
    namespace: 'ab:test',
    queryText: 'reply promise fact',
    retrievalPolicy: policy,
    items: [
      item({ id: 'obs-1', type: 'observation', content: 'raw chat fact from recent scene' }),
      item({ id: 'ref-1', type: 'reflection', content: 'stable reflection about the relationship' }),
      item({ id: 'plan-1', type: 'plan', content: 'unfinished promise to reply later' })
    ]
  });

  assert.deepEqual(context.observations.map((entry) => entry.id), ['obs-1']);
  assert.deepEqual(context.reflections.map((entry) => entry.id), ['ref-1']);
  assert.deepEqual(context.plans.map((entry) => entry.id), ['plan-1']);
  assert.equal(context.observations[0]?.metadata?.provenance && typeof context.observations[0].metadata.provenance, 'object');
  assert.ok(context.budget.totalTokens > 0);
});

test('projectAbMemoryContext enforces type-aware item budgets', async () => {
  const context = await projectAbMemoryContext({
    namespace: 'ab:test',
    queryText: 'memory',
    retrievalPolicy: {
      ...policy,
      typeLimits: {
        observations: { maxItems: 1, maxTokens: 200 },
        reflections: { maxItems: 1, maxTokens: 200 },
        plans: { maxItems: 1, maxTokens: 200 },
        selfState: { maxItems: 1, maxTokens: 200 }
      }
    },
    items: [
      item({ id: 'obs-1', type: 'observation', content: 'memory observation one', importance: 1 }),
      item({ id: 'obs-2', type: 'observation', content: 'memory observation two', importance: 0.9 }),
      item({ id: 'ref-1', type: 'reflection', content: 'memory reflection one', importance: 0.1 }),
      item({ id: 'plan-1', type: 'plan', content: 'memory plan one', importance: 0.1 })
    ]
  });

  assert.equal(context.observations.length, 1);
  assert.equal(context.reflections.length, 1);
  assert.equal(context.plans.length, 1);
  assert.equal(context.budget.truncated, true);
  assert.match(context.budget.truncationReason || '', /observations limit/);
});

test('projectAbMemoryContext projects xiaoni_os as selfState instead of plan', async () => {
  const context = await projectAbMemoryContext({
    namespace: 'ab:test',
    queryText: '小腻',
    retrievalPolicy: policy,
    items: [
      item({ id: 'self-1', type: 'plan', subtype: 'xiaoni_os', content: '小腻的OS: 先观场，再观己' }),
      item({ id: 'plan-1', type: 'plan', content: 'short term plan' })
    ]
  });

  assert.deepEqual(context.selfState?.map((entry) => entry.id), ['self-1']);
  assert.deepEqual(context.plans.map((entry) => entry.id), ['plan-1']);
});

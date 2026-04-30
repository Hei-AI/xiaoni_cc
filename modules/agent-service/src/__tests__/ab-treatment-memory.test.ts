import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTreatmentMemoryNamespace,
  expireDueTreatmentPlans,
  fulfillTreatmentPlanMemory,
  isTreatmentMemoryNamespace,
  writeTreatmentObservation,
  writeTreatmentPlan,
  writeTreatmentReflection
} from '../services/ab-treatment-memory';
import type { AbMemoryStreamItem } from '../services/ab-types';

const fixedNow = new Date('2026-04-29T00:00:00.000Z');

function createWrittenItem(overrides: Partial<AbMemoryStreamItem> = {}): AbMemoryStreamItem {
  return {
    id: 'plan-1',
    namespace: buildTreatmentMemoryNamespace({ experimentId: 'exp', sessionKey: 's', peerId: 'p' }),
    arm: 'treatment',
    type: 'plan',
    subtype: null,
    content: 'continue this short-term promise',
    retrievalText: 'continue this short-term promise',
    embeddingText: 'continue this short-term promise',
    importance: 0.8,
    confidence: 0.9,
    status: 'active',
    sourceEventRefs: [],
    provenance: {},
    ttlExpiresAt: '2026-04-28T23:59:59.000Z',
    fulfilledAt: null,
    createdAt: fixedNow.toISOString(),
    updatedAt: fixedNow.toISOString(),
    ...overrides
  };
}

test('treatment memory writes never use control namespace or arm', async () => {
  const namespace = buildTreatmentMemoryNamespace({
    experimentId: 'exp-1',
    sessionKey: 'qq:group:253631878',
    peerId: '253631878'
  });
  const writes: AbMemoryStreamItem[] = [];
  const deps = {
    now: () => fixedNow,
    writeMemoryStreamItem: async (item: AbMemoryStreamItem) => {
      writes.push(item);
    }
  };

  await writeTreatmentObservation(deps, { namespace, content: 'candidate noticed a direct addressee' });
  await writeTreatmentReflection(deps, { namespace, content: 'avoid polished answer tone in this thread' });
  await writeTreatmentPlan(deps, {
    namespace,
    content: 'next turn should continue log review',
    ttlExpiresAt: '2026-04-29T00:05:00.000Z'
  });

  assert.equal(isTreatmentMemoryNamespace(namespace), true);
  assert.equal(writes.length, 3);
  assert.deepEqual(writes.map((item) => item.type), ['observation', 'reflection', 'plan']);
  for (const item of writes) {
    assert.equal(item.arm, 'treatment');
    assert.equal(item.namespace.startsWith('ab:treatment:'), true);
    assert.equal(item.namespace.includes('control'), false);
    assert.equal(item.provenance.isolation, 'treatment_only');
  }
});

test('treatment memory rejects non-treatment namespaces', async () => {
  await assert.rejects(
    () => writeTreatmentObservation({
      now: () => fixedNow,
      writeMemoryStreamItem: async () => undefined
    }, {
      namespace: 'control:qq:group:253631878',
      content: 'should not write'
    }),
    /Treatment memory writes require/
  );
});

test('treatment plan memory can be fulfilled', async () => {
  const plan = createWrittenItem();
  const mutations: Array<{ id: string; status?: string; fulfilledAt?: string | Date }> = [];
  const updated = await fulfillTreatmentPlanMemory({
    now: () => fixedNow,
    markMemoryPlanFulfilled: async (id, params) => {
      mutations.push({ id, ...params });
      return createWrittenItem({ id, status: params?.status ?? 'fulfilled', fulfilledAt: fixedNow.toISOString() });
    }
  }, plan, fixedNow);

  assert.deepEqual(mutations, [{ id: 'plan-1', status: 'fulfilled', fulfilledAt: fixedNow }]);
  assert.equal(updated.status, 'fulfilled');
  assert.equal(updated.fulfilledAt, fixedNow.toISOString());
});

test('expired treatment plans are marked expired while active future plans remain', async () => {
  const namespace = buildTreatmentMemoryNamespace({ experimentId: 'exp', sessionKey: 's', peerId: 'p' });
  const expiredPlan = createWrittenItem({ id: 'expired-plan', namespace, ttlExpiresAt: '2026-04-28T00:00:00.000Z' });
  const futurePlan = createWrittenItem({ id: 'future-plan', namespace, ttlExpiresAt: '2026-04-30T00:00:00.000Z' });
  const mutations: string[] = [];

  const expired = await expireDueTreatmentPlans({
    now: () => fixedNow,
    listMemoryStreamItems: async () => [expiredPlan, futurePlan],
    markMemoryPlanFulfilled: async (id, params) => {
      mutations.push(`${id}:${params?.status}`);
      return createWrittenItem({ id, namespace, status: params?.status ?? 'expired', fulfilledAt: fixedNow.toISOString() });
    }
  }, namespace, fixedNow);

  assert.deepEqual(mutations, ['expired-plan:expired']);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].status, 'expired');
});

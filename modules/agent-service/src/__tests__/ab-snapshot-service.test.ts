import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAbSnapshotSourceKey,
  buildAbTurnSnapshotPayload,
  captureAbTurnSnapshot
} from '../services/ab-snapshot-service';
import { AbSnapshotBuilderInput } from '../services/ab-snapshot-service';

function snapshotInput(): AbSnapshotBuilderInput {
  return {
    traceId: 'trace-1',
    runId: 'run-1',
    sessionKey: 'qq:group:253631878',
    chatType: 'group',
    peerId: '253631878',
    senderId: '1129974489',
    queueMessageIds: [101, 102],
    providerEventIds: ['evt-1'],
    unreadMessages: [{
      id: 101,
      role: 'user',
      content: 'hello',
      senderId: 'u1',
      timestamp: '2026-04-29T01:00:00.000Z'
    }],
    recentContext: [{
      id: 99,
      role: 'assistant',
      content: 'previous reply',
      timestamp: '2026-04-29T00:59:00.000Z'
    }],
    readCutoff: {
      messageId: 98,
      timestamp: '2026-04-29T00:58:00.000Z'
    },
    identityMetadata: { identityRootId: 'qq:1129974489' },
    mediaMetadata: { imageAssetIds: ['img-1'] },
    traceMetadata: { providerRequestId: 'llm-1' },
    memoryStreamView: {
      namespace: 'ab:test',
      observations: [{ id: 'obs-1', type: 'observation', content: 'observed', score: 1 }],
      reflections: [{ id: 'ref-1', type: 'reflection', content: 'reflected', score: 1 }],
      plans: [{ id: 'plan-1', type: 'plan', content: 'planned', score: 1 }],
      budget: {
        observationsTokens: 2,
        reflectionsTokens: 2,
        plansTokens: 2,
        totalTokens: 6,
        truncated: false
      }
    },
    retrievalPolicy: {
      relevanceWeight: 1,
      recencyWeight: 1,
      importanceWeight: 1,
      typeLimits: {
        observations: { maxItems: 4, maxTokens: 200 },
        reflections: { maxItems: 4, maxTokens: 200 },
        plans: { maxItems: 2, maxTokens: 100 }
      },
      totalSoftCapTokens: 400,
      totalHardCapTokens: 600
    },
    runtimeConfig: {
      controlModelName: 'gpt-5.4',
      treatmentModelName: 'gpt-5-mini',
      promptVersions: { main: 'v1' },
      rendererVersions: { runtimeInput: 'v2' },
      metadata: { worker: 'unit-test' }
    }
  };
}

test('buildAbTurnSnapshotPayload captures scene, ids, memory view, and metadata as immutable payload', () => {
  const input = snapshotInput();
  const payload = buildAbTurnSnapshotPayload(input) as any;

  assert.deepEqual(payload.queueMessageIds, [101, 102]);
  assert.deepEqual(payload.providerEventIds, ['evt-1']);
  assert.equal(payload.scene.unreadMessages[0].content, 'hello');
  assert.equal(payload.scene.recentContext[0].content, 'previous reply');
  assert.equal(payload.scene.readCutoff.messageId, 98);
  assert.equal(payload.scene.metadata.identity.identityRootId, 'qq:1129974489');
  assert.equal(payload.scene.metadata.media.imageAssetIds[0], 'img-1');
  assert.equal(payload.memoryStreamView.observations[0].id, 'obs-1');
  assert.equal(payload.runtimeConfig.promptVersions.main, 'v1');

  input.unreadMessages?.push({ role: 'user', content: 'late mutation' });
  assert.equal(payload.scene.unreadMessages.length, 1);
  assert.throws(() => {
    payload.scene.unreadMessages.push({ role: 'user', content: 'mutate frozen payload' });
  }, TypeError);
});

test('buildAbSnapshotSourceKey is deterministic and changes with source ids', () => {
  const first = snapshotInput();
  const second = snapshotInput();
  assert.equal(buildAbSnapshotSourceKey(first), buildAbSnapshotSourceKey(second));

  second.queueMessageIds = [101, 103];
  assert.notEqual(buildAbSnapshotSourceKey(first), buildAbSnapshotSourceKey(second));
});

test('captureAbTurnSnapshot uses sourceKey idempotency and does not create duplicates on repeated capture', async () => {
  const created: Record<string, any> = {};
  const calls: Record<string, number> = {};
  const result1 = await captureAbTurnSnapshot(snapshotInput(), {
    async createAbTurnSnapshot(payload) {
      const sourceKey = String(payload.sourceKey);
      calls[sourceKey] = (calls[sourceKey] || 0) + 1;
      created[sourceKey] ||= {
        ...payload,
        source_key: sourceKey,
        created_at: '2026-04-29T01:00:00.000Z',
        updated_at: '2026-04-29T01:00:00.000Z'
      };
      return created[sourceKey];
    }
  });
  const result2 = await captureAbTurnSnapshot(snapshotInput(), {
    async createAbTurnSnapshot(payload) {
      const sourceKey = String(payload.sourceKey);
      calls[sourceKey] = (calls[sourceKey] || 0) + 1;
      created[sourceKey] ||= {
        ...payload,
        source_key: sourceKey,
        created_at: '2026-04-29T01:00:00.000Z',
        updated_at: '2026-04-29T01:00:00.000Z'
      };
      return created[sourceKey];
    }
  });

  assert.equal(result1.failedOpen, false);
  assert.equal(result2.failedOpen, false);
  assert.equal(result1.sourceKey, result2.sourceKey);
  assert.equal(Object.keys(created).length, 1);
  assert.equal(calls[result1.sourceKey], 2);
  assert.equal(result1.snapshot?.id, result2.snapshot?.id);
});

test('captureAbTurnSnapshot fails open when persistence capture throws', async () => {
  const result = await captureAbTurnSnapshot(snapshotInput(), {
    async createAbTurnSnapshot() {
      throw new Error('db timeout');
    }
  });

  assert.equal(result.snapshot, null);
  assert.equal(result.failedOpen, true);
  assert.equal(result.error?.message, 'db timeout');
  assert.ok(result.sourceKey.startsWith('ab_source_'));
});

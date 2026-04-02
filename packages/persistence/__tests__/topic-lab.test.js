const test = require('node:test');
const assert = require('node:assert/strict');
const { createTopicLabPersistence } = require('../topic-lab');

function createPersistence(overrides = {}) {
  const prisma = overrides.prisma || {};
  return createTopicLabPersistence({
    getPrismaClient: () => prisma,
    createSqlAdapter: overrides.createSqlAdapter || (() => ({
      execute: async () => 0,
      close: async () => undefined
    }))
  });
}

test('createChatSpaceTopic normalizes bigint ids and optional strings', async () => {
  let createPayload = null;
  const persistence = createPersistence({
    prisma: {
      chatSpaceTopic: {
        create: async ({ data }) => {
          createPayload = data;
          return {
            id: 42n,
            chat_space_type: data.chat_space_type,
            chat_space_id: data.chat_space_id,
            status: data.status,
            canonical_title: data.canonical_title,
            metadata: data.metadata
          };
        }
      }
    }
  });

  const result = await persistence.createChatSpaceTopic({
    chatSpaceType: ' group ',
    chatSpaceId: '123',
    status: ' active ',
    canonicalTitle: '  topic title  ',
    metadata: { ok: true }
  });

  assert.equal(createPayload.chat_space_type, 'group');
  assert.equal(createPayload.chat_space_id, 123n);
  assert.equal(createPayload.status, 'active');
  assert.equal(createPayload.canonical_title, 'topic title');
  assert.equal(result.id, 42);
  assert.equal(result.chat_space_type, 'group');
  assert.equal(result.chat_space_id, 123);
  assert.equal(result.status, 'active');
  assert.equal(result.canonical_title, 'topic title');
  assert.deepEqual(result.metadata, { ok: true });
});

test('createTopicProjectionVersionSnapshot creates version, child rows, and topic update in one transaction', async () => {
  const calls = {
    versionCreates: [],
    relationshipCreates: [],
    evidenceCreates: [],
    topicUpdates: []
  };

  const persistence = createPersistence({
    prisma: {
      $transaction: async (callback) => callback({
        topicProjectionVersion: {
          create: async ({ data }) => {
            calls.versionCreates.push(data);
            return {
              id: 99n,
              topic_id: data.topic_id,
              projection_job_id: data.projection_job_id,
              version_number: data.version_number,
              status: data.status,
              lifecycle_state: data.lifecycle_state,
              title: data.title,
              summary_text: data.summary_text,
              input_bundle_hash: data.input_bundle_hash,
              snapshot_json: data.snapshot_json,
              provenance_json: data.provenance_json
            };
          }
        },
        topicVersionRelationship: {
          create: async ({ data }) => {
            calls.relationshipCreates.push(data);
            return data;
          }
        },
        topicVersionEvidence: {
          create: async ({ data }) => {
            calls.evidenceCreates.push(data);
            return data;
          }
        },
        chatSpaceTopic: {
          update: async ({ data }) => {
            calls.topicUpdates.push(data);
            return data;
          }
        }
      })
    }
  });

  const result = await persistence.createTopicProjectionVersionSnapshot({
    topicId: 7,
    projectionJobId: 8,
    versionNumber: 3,
    status: 'accepted',
    lifecycleState: 'active',
    title: 'topic title',
    summaryText: 'topic summary',
    inputBundleHash: 'bundle-1',
    snapshotJson: { title: 'topic title' },
    provenanceJson: { source: 'test' },
    relationships: [{
      targetUserId: 1001,
      relationshipKind: 'inside_topic',
      summaryText: 'shared joke',
      actors: ['a', 'b'],
      sourceMessageIds: [11, 12],
      sourceEventIds: [21]
    }],
    evidence: [{
      sourceKind: 'agent_inbound_message',
      sourceId: 11,
      sortOrder: 1,
      excerptText: 'hello'
    }],
    topicUpdates: {
      status: 'active',
      canonicalTitle: 'topic title',
      currentAcceptedVersionId: 99,
      lastProjectionJobId: 8
    }
  });

  assert.equal(calls.versionCreates.length, 1);
  assert.equal(calls.versionCreates[0].topic_id, 7n);
  assert.equal(calls.versionCreates[0].projection_job_id, 8n);
  assert.equal(calls.relationshipCreates.length, 1);
  assert.equal(calls.relationshipCreates[0].projection_version_id, 99n);
  assert.equal(calls.relationshipCreates[0].target_user_id, 1001n);
  assert.equal(calls.evidenceCreates.length, 1);
  assert.equal(calls.evidenceCreates[0].projection_version_id, 99n);
  assert.equal(calls.evidenceCreates[0].source_id, 11n);
  assert.equal(calls.topicUpdates.length, 1);
  assert.equal(calls.topicUpdates[0].current_accepted_version_id, 99n);
  assert.equal(result.id, 99);
  assert.equal(result.topic_id, 7);
  assert.equal(result.projection_job_id, 8);
  assert.equal(result.version_number, 3);
  assert.equal(result.status, 'accepted');
});

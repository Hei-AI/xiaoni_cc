'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentMediaPersistence } = require('../agent-media');

test('upsertAgentMediaAsset without message sid is idempotent by asset id', async () => {
  const calls = [];
  const persistence = createAgentMediaPersistence({
    getPrismaClient: () => ({
      agentMediaAsset: {
        upsert: async (args) => {
          calls.push(args);
          return {
            ...args.create,
            created_at: new Date('2026-06-24T00:00:00.000Z'),
            updated_at: new Date('2026-06-24T00:00:01.000Z'),
            observations: []
          };
        }
      }
    }),
    createSqlAdapter: () => {
      throw new Error('SQL adapter should not be used for media asset upsert');
    }
  });

  const asset = await persistence.upsertAgentMediaAsset({
    id: 'local_media_abc123',
    source: 'local_runtime',
    sessionKey: 'xiaoni:global',
    chatType: 'direct',
    mediaTag: 'local_media_abc123',
    mimeType: 'image/png',
    sourceLocator: '/xiaoni-runtime/picture/screen.png',
    storageUri: 'http://qqbot-provider-service:8090/api/internal/local-media-assets/screen.png',
    metadata: { executor_path: '/xiaoni-runtime/picture/screen.png' }
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].where, { id: 'local_media_abc123' });
  assert.equal(calls[0].create.source, 'local_runtime');
  assert.equal(calls[0].update.source_locator, '/xiaoni-runtime/picture/screen.png');
  assert.equal(asset.id, 'local_media_abc123');
  assert.equal(asset.metadata.executor_path, '/xiaoni-runtime/picture/screen.png');
});

test('getAgentMediaAssetById reads one asset with session filtering through Prisma', async () => {
  const calls = [];
  const persistence = createAgentMediaPersistence({
    getPrismaClient: () => ({
      agentMediaAsset: {
        findFirst: async (args) => {
          calls.push(args);
          return {
            id: 'asset-img-123',
            source: 'napcat',
            source_message_id: 123n,
            trace_id: 'trace-1',
            session_key: 'qq:group:101',
            chat_type: 'group',
            peer_id: '101',
            peer_name: 'Test Group',
            sender_id: '202',
            sender_name: 'Alice',
            account_id: '303',
            message_sid: 'sid-1',
            media_tag: 'image_1',
            placeholder: '[Image]',
            media_type: 'image',
            mime_type: 'image/png',
            source_locator: 'https://example.test/cat.png',
            storage_uri: null,
            metadata: { file_id: 'file-1' },
            created_at: new Date('2026-06-10T00:00:00.000Z'),
            updated_at: new Date('2026-06-10T00:00:01.000Z'),
            observations: [{
              id: 'obs-1',
              asset_id: 'asset-img-123',
              observer: 'xiaoni',
              description: '旧观察',
              source_model: 'gpt-5-mini',
              confidence: null,
              metadata: {},
              created_at: new Date('2026-06-10T00:00:02.000Z')
            }]
          };
        }
      }
    }),
    createSqlAdapter: () => {
      throw new Error('SQL adapter should not be used for media asset id lookup');
    }
  });

  const asset = await persistence.getAgentMediaAssetById({
    id: 'asset-img-123',
    sessionKey: 'qq:group:101'
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].where, {
    id: 'asset-img-123',
    session_key: 'qq:group:101'
  });
  assert.equal(asset.id, 'asset-img-123');
  assert.equal(asset.source_message_id, 123);
  assert.equal(asset.observations[0].description, '旧观察');
});

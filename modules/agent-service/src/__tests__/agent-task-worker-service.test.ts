import test from 'node:test';
import assert from 'node:assert/strict';
import { agentConfig } from '../config';
import { AgentTaskWorkerService } from '../services/agent-task-worker-service';

test('AgentTaskWorkerService falls back to generation for image_edit tasks without source images', async () => {
  const service = new AgentTaskWorkerService();
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: any }> = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null
    });
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: {
          images: [{
            data_url: 'data:image/png;base64,AA==',
            mime_type: 'image/png'
          }]
        }
      })
    } as Response;
  }) as typeof fetch;

  try {
    const payload = await (service as any).callImageProvider({
      id: 'task-no-source-edit',
      task_type: 'image_edit',
      session_key: 'qq:group:101',
      chat_type: 'group',
      peer_id: '101',
      prompt: '生成一张蓝天白云头像图',
      source_media_asset_ids: []
    });

    assert.equal(payload.data.images.length, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, `${agentConfig.providerServiceUrl}/api/internal/image/generate`);
    assert.deepEqual(calls[0]?.body, {
      prompt: '生成一张蓝天白云头像图',
      n: 1
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AgentTaskWorkerService resolves image_edit sources by global media asset id', async () => {
  const lookups: any[] = [];
  const service = new AgentTaskWorkerService({
    getMediaAssetById: async (params: any) => {
      lookups.push(params);
      return {
        id: params.id,
        media_tag: 'image_1',
        media_type: 'image',
        mime_type: 'image/png',
        storage_uri: 'http://qqbot-provider-service:8091/api/internal/media-assets/hash.png',
        source_locator: 'https://multimedia.nt.qq.com.cn/download?expired=1',
        metadata: {
          file_name: 'hash.png'
        }
      };
    },
    listMediaAssets: async () => {
      throw new Error('global media id should resolve without session asset listing');
    }
  } as any);
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: any }> = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({
      url: String(url),
      body
    });
    if (String(url).endsWith('/api/internal/media/materialize-image')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            data_url: 'data:image/png;base64,AA==',
            mime_type: 'image/png',
            filename: 'hash.png'
          }
        })
      } as Response;
    }
    if (String(url).endsWith('/api/internal/image/edit')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            images: [{
              data_url: 'data:image/png;base64,BB==',
              mime_type: 'image/png'
            }]
          }
        })
      } as Response;
    }
    throw new Error(`Unexpected fetch: ${String(url)}`);
  }) as typeof fetch;

  try {
    const payload = await (service as any).callImageProvider({
      id: 'task-global-source-edit',
      task_type: 'image_edit',
      session_key: 'xiaoni:global',
      chat_type: 'direct',
      peer_id: '3994058476',
      prompt: '把这张图改成水彩风格',
      source_media_asset_ids: ['media_abcdef123456']
    });

    assert.equal(payload.data.images.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(lookups, [{ id: 'media_abcdef123456' }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, `${agentConfig.providerServiceUrl}/api/internal/media/materialize-image`);
  assert.equal(calls[0]?.body?.source_locator, 'http://qqbot-provider-service:8091/api/internal/media-assets/hash.png');
  assert.equal(calls[1]?.url, `${agentConfig.providerServiceUrl}/api/internal/image/edit`);
  assert.deepEqual(calls[1]?.body?.images, [{
    data_url: 'data:image/png;base64,AA==',
    mime_type: 'image/png',
    filename: 'hash.png'
  }]);
});

test('AgentTaskWorkerService registers completed generated image as inspectable media asset', async () => {
  const upserts: any[] = [];
  const service = new AgentTaskWorkerService({
    upsertMediaAssets: async (inputs: any[]) => {
      upserts.push(...inputs);
      return inputs;
    }
  } as any);

  await (service as any).registerFirstPictureAsMediaAsset(
    {
      id: 'task-image-ready',
      task_type: 'image_generate',
      session_key: 'qq:group:101',
      chat_type: 'group',
      peer_id: '101',
      peer_name: '测试群',
      requester_sender_id: '85178516',
      requester_sender_name: 'Li',
      prompt: '一张测试图',
      target_description: '给 Li 看的一张图',
      source_trace_id: 'trace-source',
      source_run_id: 'run-source'
    },
    {
      id: 'task_artifact_1',
      data_url: 'data:image/png;base64,AA==',
      mime_type: 'image/png'
    },
    {
      picture_id: 'task_artifact_1',
      filename: 'task_artifact_1.png',
      path: '/xiaoni-runtime/picture/task_artifact_1.png',
      mime_type: 'image/png',
      bytes: 10
    }
  );

  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]?.id, 'task_artifact_1');
  assert.equal(upserts[0]?.source, 'image_task');
  assert.equal(upserts[0]?.sessionKey, 'xiaoni:global');
  assert.equal(upserts[0]?.mediaTag, 'task_artifact_1');
  assert.equal(upserts[0]?.sourceLocator, 'data:image/png;base64,AA==');
  assert.equal(upserts[0]?.metadata?.executor_path, '/xiaoni-runtime/picture/task_artifact_1.png');
});

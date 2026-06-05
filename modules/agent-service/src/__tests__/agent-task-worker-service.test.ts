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

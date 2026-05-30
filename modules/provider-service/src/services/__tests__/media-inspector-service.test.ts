import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMediaInspectorCanonicalRequest,
  inspectMediaImage,
  parseMediaInspectorResponse
} from '../media-inspector-service';

test('buildMediaInspectorCanonicalRequest uses image-only subagent contract with mini default', () => {
  const request = buildMediaInspectorCanonicalRequest({
    imageUrl: 'https://example.com/image.png',
    reason: '用户问图里的字是什么'
  });

  assert.equal(request.model, 'gpt-5.4-mini');
  assert.equal(request.previous_response_id, undefined);
  assert.equal(request.tools, undefined);
  assert.match(request.instructions || '', /无人格、无记忆、无聊天上下文/);
  assert.match(request.instructions || '', /必须只输出一个 JSON 对象/);
  assert.equal(Array.isArray(request.input), true);
  const input = Array.isArray(request.input) ? request.input[0] : null;
  assert.equal(input?.type, 'message');
  assert.equal(input?.role, 'user');
  assert.deepEqual(input?.content, [
    {
      type: 'input_text',
      text: '任务意图：\n用户问图里的字是什么\n\n请严格按 system 指定 JSON schema 输出。'
    },
    {
      type: 'input_image',
      image_url: 'https://example.com/image.png'
    }
  ]);
});

test('parseMediaInspectorResponse converts structured JSON into a compact description', () => {
  const parsed = parseMediaInspectorResponse(JSON.stringify({
    summary: '这是一张聊天截图。',
    visible_text: ['你好', '世界'],
    objects: ['手机状态栏', '白色背景'],
    uncertainty: ['底部文字较小'],
    safety_notes: []
  }));

  assert.equal(parsed.summary, '这是一张聊天截图。');
  assert.deepEqual(parsed.visible_text, ['你好', '世界']);
  assert.match(parsed.description, /这是一张聊天截图/);
  assert.match(parsed.description, /可见文字：你好 \/ 世界/);
  assert.match(parsed.description, /不确定点：底部文字较小/);
});

test('inspectMediaImage calls executor without main-agent context and returns parsed data', async () => {
  const calls: any[] = [];
  const result = await inspectMediaImage({
    imageUrl: 'data:image/png;base64,abc',
    traceId: 'trace-image',
    defaultModel: 'gpt-5.4-mini',
    reason: '只看图片'
  }, async (payload) => {
    calls.push(payload);
    return {
      response: '{"summary":"图片里有一只猫。","visible_text":[],"objects":["猫"],"uncertainty":[],"safety_notes":[]}',
      model: payload.model,
      provider: 'openai',
      llm_call_id: 'llm-image'
    };
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].agent_type, 'media_inspector');
  assert.equal(calls[0].prompt_name, 'runtime_media_inspect');
  assert.equal(calls[0].canonicalRequest.previous_response_id, undefined);
  assert.equal(calls[0].canonicalRequest.tools, undefined);
  assert.equal(result.description, '图片里有一只猫。\n可见元素：猫');
  assert.equal(result.llm_call_id, 'llm-image');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCanonicalAgentTurnRequest } from '../services/agent-loop-service';

function toolNames(request: ReturnType<typeof buildCanonicalAgentTurnRequest>) {
  return (request.tools || []).map((tool) => tool.type === 'function' ? tool.function.name : tool.type);
}

test('life-only presence tick stays inside the agent loop and cannot send QQ messages', () => {
  const request = buildCanonicalAgentTurnRequest('gpt-5.4-mini', [
    {
      type: 'message',
      role: 'system',
      content: 'system'
    },
    {
      type: 'message',
      role: 'assistant',
      phase: 'commentary',
      content: '<ACTION source="presence_tick">小腻从自己的生活里抬头看了一眼消息列表；还没有打开任何具体会话。</ACTION>'
    }
  ], 'direct');

  const names = toolNames(request);
  assert.ok(names.includes('web_search'));
  assert.ok(names.includes('stay_silent'));
  assert.equal(names.includes('reply_in_private'), false);
  assert.equal(names.includes('speak_in_group'), false);
  assert.notEqual(request.tool_choice, 'required');
});

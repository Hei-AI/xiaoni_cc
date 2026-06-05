import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCanonicalAgentTurnRequest } from '../services/agent-loop-service';

const REMOVED_LIFE_ACTION_TOOL = ['submit', 'life', 'action'].join('_');

function toolNames(request: ReturnType<typeof buildCanonicalAgentTurnRequest>) {
  return (request.tools || []).map((tool) => tool.type === 'function' ? tool.function.name : tool.type);
}

function allowedToolNames(request: ReturnType<typeof buildCanonicalAgentTurnRequest>) {
  const choice = request.tool_choice as any;
  return choice?.type === 'allowed_tools' && Array.isArray(choice.tools)
    ? choice.tools.map((tool: any) => tool.type === 'function' ? tool.name : tool.type)
    : [];
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
      content: '<ACTION source="presence_tick">还没有打开任何具体会话</ACTION>'
    }
  ], 'direct');

  const names = toolNames(request);
  assert.equal(names.includes(REMOVED_LIFE_ACTION_TOOL), false);
  assert.ok(names.includes('web_search'));
  assert.ok(names.includes('recover_energy'));
  assert.equal(names.includes('reply_in_private'), false);
  assert.equal(names.includes('speak_in_group'), false);
  assert.equal(allowedToolNames(request).includes(REMOVED_LIFE_ACTION_TOOL), false);
  assert.equal((request.tool_choice as any)?.mode, 'auto');
  assert.notEqual(request.tool_choice, 'required');
});

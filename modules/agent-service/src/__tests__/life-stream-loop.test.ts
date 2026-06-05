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

test('life-only presence tick uses fixed main-loop tools without the removed life action tool', () => {
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
  assert.ok(names.includes('send_in_private'));
  assert.ok(names.includes('send_in_group'));
  assert.ok(names.includes('inspect_image_placeholder'));
  assert.ok(names.includes('request_image_task'));
  assert.equal(allowedToolNames(request).includes(REMOVED_LIFE_ACTION_TOOL), false);
  assert.ok(allowedToolNames(request).includes('send_in_private'));
  assert.ok(allowedToolNames(request).includes('send_in_group'));
  assert.equal((request.tool_choice as any)?.mode, 'auto');
  assert.notEqual(request.tool_choice, 'required');
});

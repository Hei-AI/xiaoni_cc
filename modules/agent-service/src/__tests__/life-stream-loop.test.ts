import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCanonicalAgentTurnRequest } from '../services/agent-loop-service';

function toolNames(request: ReturnType<typeof buildCanonicalAgentTurnRequest>) {
  return (request.tools || []).map((tool) => tool.type === 'function' ? tool.function.name : tool.type);
}

function allowedToolNames(request: ReturnType<typeof buildCanonicalAgentTurnRequest>) {
  const choice = request.tool_choice as any;
  return choice?.type === 'allowed_tools' && Array.isArray(choice.tools)
    ? choice.tools.map((tool: any) => tool.type === 'function' ? tool.name : tool.type)
    : [];
}

test('life-only autonomous loop stays inside the agent loop and cannot send QQ messages', () => {
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
      content: '<ACTION source="life_loop">life_loop_step</ACTION>'
    }
  ], 'direct');

  const names = toolNames(request);
  assert.ok(names.includes('submit_life_action'));
  assert.ok(names.includes('web_search'));
  assert.equal(names.includes('stay_silent'), false);
  assert.ok(names.includes('recover_energy'));
  assert.equal(names.includes('reply_in_private'), false);
  assert.equal(names.includes('speak_in_group'), false);
  assert.ok(allowedToolNames(request).includes('submit_life_action'));
  assert.notEqual(request.tool_choice, 'required');
});

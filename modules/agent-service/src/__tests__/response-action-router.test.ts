import test from 'node:test';
import assert from 'node:assert/strict';
import { ResponseActionRouter } from '../services/response-action-router';

test('ResponseActionRouter does not create final_answer idle reminder post actions', () => {
  const plan = new ResponseActionRouter().route({
    output: [{
      type: 'message',
      role: 'assistant',
      phase: 'final_answer',
      content: [{ type: 'output_text', text: '先这样。' }]
    }]
  });

  assert.equal(plan.hasFinalAnswer, true);
  assert.equal(plan.hasToolCall, false);
  assert.equal(plan.toolCalls.length, 0);
  assert.equal(plan.replayableOutputs.length, 1);
  assert.deepEqual(plan.postActions, []);
});

test('ResponseActionRouter registers an empty-text final_answer as hasFinalAnswer', () => {
  // Terminal end_turn carrier emitted when the model delivered via a tool and ended
  // the turn empty. It carries no text but must still count as a final_answer so the
  // loop yields via the final_answer branch and the fork / self-continuation revive.
  const plan = new ResponseActionRouter().route({
    output: [{
      type: 'message',
      role: 'assistant',
      phase: 'final_answer',
      content: []
    }]
  });

  assert.equal(plan.hasFinalAnswer, true);
  assert.equal(plan.hasToolCall, false);
  assert.equal(plan.replayableOutputs.length, 1);
  assert.equal(plan.replayableOutputs[0]!.type, 'assistant_message');
});

test('ResponseActionRouter still drops an empty-text commentary message', () => {
  const plan = new ResponseActionRouter().route({
    output: [{
      type: 'message',
      role: 'assistant',
      phase: 'commentary',
      content: []
    }]
  });

  assert.equal(plan.hasFinalAnswer, false);
  assert.equal(plan.replayableOutputs.length, 0);
});

test('ResponseActionRouter does not enqueue idle reminder when final_answer also has a tool call', () => {
  const plan = new ResponseActionRouter().route({
    output: [
      {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: '我去跑一下命令。' }]
      },
      {
        type: 'function_call',
        call_id: 'call-exec',
        name: 'exec_command',
        arguments: '{"cmd":"pwd"}'
      }
    ]
  });

  assert.equal(plan.hasFinalAnswer, true);
  assert.equal(plan.hasToolCall, true);
  assert.equal(plan.toolCalls.length, 1);
  assert.equal(plan.toolCalls[0].name, 'exec_command');
  assert.deepEqual(plan.postActions, []);
});

test('ResponseActionRouter preserves assistant commentary phase as commentary', () => {
  const plan = new ResponseActionRouter().route({
    output: [{
      type: 'message',
      role: 'assistant',
      phase: 'commentary',
      content: [{ type: 'output_text', text: '我先想一下。' }]
    }]
  });

  assert.equal(plan.hasFinalAnswer, false);
  assert.equal(plan.replayableOutputs.length, 1);
  assert.equal(plan.replayableOutputs[0].type, 'assistant_message');
  assert.equal(plan.postActions.length, 0);
});

test('ResponseActionRouter replays assistant output item without rebuilding it', () => {
  const outputItem = {
    type: 'message',
    id: 'msg-original-1',
    role: 'assistant',
    phase: 'commentary',
    status: 'completed',
    provider_extra: { stable: true },
    content: [{
      type: 'output_text',
      text: '原样回放。',
      annotations: [{ type: 'note' }]
    }]
  };
  const plan = new ResponseActionRouter().route({
    output: [outputItem as any]
  });

  assert.equal(plan.replayableOutputs.length, 1);
  assert.deepEqual(plan.replayableOutputs[0].inputItem, outputItem);
});

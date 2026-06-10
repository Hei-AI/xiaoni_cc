import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FINAL_ANSWER_IDLE_REMINDER_TEXT,
  ResponseActionRouter
} from '../services/response-action-router';

test('ResponseActionRouter turns final_answer without tools into an idle-reminder post action', () => {
  assert.equal(
    FINAL_ANSWER_IDLE_REMINDER_TEXT,
    '去找找别的事情做, 你可以做任何事,也可以看看还有哪些事情你没做完,或者感兴趣的其他事情'
  );

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
  assert.deepEqual(plan.postActions, [{
    type: 'enqueue_final_answer_idle_reminder',
    reminderText: FINAL_ANSWER_IDLE_REMINDER_TEXT
  }]);
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

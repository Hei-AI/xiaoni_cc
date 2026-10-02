import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertClosingNarrationToNoteInPlace,
  isReplayItemStrippedByTextGate,
  stampTextAdmitInPlace
} from '../services/agent-loop-service';

// A turn that ends with text and no tool call: keep her words, drop the "I said this and stopped" shape.

const closing = (text: string) => ({
  type: 'message', role: 'assistant', phase: 'final_answer', status: 'completed',
  content: [{ type: 'output_text', text }]
}) as any;

const textOf = (item: any) => (typeof item.content === 'string'
  ? item.content
  : item.content.map((p: any) => p.text).join(''));

test('closing text becomes a user note before the (now stripped) closing message', () => {
  const items = [{ type: 'reasoning', encrypted_content: 'x' }, closing('《以为》已经投出去了，等编辑回信。')] as any[];
  stampTextAdmitInPlace(items, true);
  convertClosingNarrationToNoteInPlace(items);

  assert.equal(items.length, 3);
  const note = items[1];
  assert.equal(note.role, 'user');
  assert.ok(textOf(note).includes('《以为》已经投出去了，等编辑回信。'), 'her words are carried over verbatim');
  const last = items[2];
  // still the raw final_answer (fork trigger reads it), but no longer admitted into her context
  assert.equal(last.role, 'assistant');
  assert.equal(last.phase, 'final_answer');
  assert.equal(last.text_admit, undefined);
  assert.equal(isReplayItemStrippedByTextGate(last), true);
  assert.equal(isReplayItemStrippedByTextGate(note), false);
});

test('a turn that also calls a tool is left alone (the text sits with the next action)', () => {
  const items = [
    { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: '先看收件箱。' }] },
    { type: 'function_call', call_id: 'c1', name: 'exec_command', arguments: '{}' }
  ] as any[];
  stampTextAdmitInPlace(items, true);
  convertClosingNarrationToNoteInPlace(items);
  assert.equal(items.length, 2);
  assert.equal(items[0].text_admit, true);
});

test('text the rewrite leg did not admit stays as it is (already stripped, nothing to carry)', () => {
  const items = [closing('等。')] as any[];
  convertClosingNarrationToNoteInPlace(items);
  assert.equal(items.length, 1);
  assert.equal(isReplayItemStrippedByTextGate(items[0]), true);
});

test('deterministic: converting the same output twice yields the same bytes', () => {
  const a = [closing('读完了 ruk.ca 的几篇。')] as any[];
  const b = JSON.parse(JSON.stringify(a));
  stampTextAdmitInPlace(a, true); stampTextAdmitInPlace(b, true);
  convertClosingNarrationToNoteInPlace(a); convertClosingNarrationToNoteInPlace(b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

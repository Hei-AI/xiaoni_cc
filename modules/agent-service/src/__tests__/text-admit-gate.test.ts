import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAssistantTextAdmittedToReplay,
  isReplayItemStrippedByTextGate,
  stampTextAdmitInPlace,
  stripTextAdmitFlagForWire,
  parsePsychAssessmentVerdict
} from '../services/agent-loop-service';

// text_admit gate (Step 2/3): assistant type:text 上下文准入的可执行契约。
//
// - 一条 assistant-role TEXT replay item 只有携带冻结的 text_admit===true 才留在 replay 里。
// - 无 stamp(历史 / 消极 / fork 失败) → 剥掉(fail-closed)。
// - text_admit 是内部 flag，出线口 scrub 掉，永不进 wire；文本本体保留。
// - 心理评估 fork 的判定解析:找最后一个 PSYCH_VERDICT: KEEP/EVICT；找不到 → null(交调用方 fail-closed)。

const assistantText = (text: string, extra: Record<string, unknown> = {}) =>
  ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }], ...extra }) as any;
const userText = (text: string) =>
  ({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] }) as any;
const toolCall = () =>
  ({ type: 'function_call', call_id: 'c1', name: 'exec_command', arguments: '{"cmd":"ls"}' }) as any;

// ── strip predicate ────────────────────────────────────────────────────────────
test('un-admitted assistant text is stripped (fail-closed default)', () => {
  assert.equal(isReplayItemStrippedByTextGate(assistantText('我先等着')), true);
});

test('admitted assistant text is kept', () => {
  assert.equal(isReplayItemStrippedByTextGate(assistantText('看到群里在聊桌游，下一步去查一下', { text_admit: true })), false);
  assert.equal(isAssistantTextAdmittedToReplay(assistantText('x', { text_admit: true })), true);
});

test('non-assistant-text items are never stripped by the gate', () => {
  assert.equal(isReplayItemStrippedByTextGate(userText('你好')), false, 'user text kept');
  assert.equal(isReplayItemStrippedByTextGate(toolCall()), false, 'tool call kept');
  assert.equal(isReplayItemStrippedByTextGate(undefined), false, 'undefined kept');
});

// ── stamp (freeze the KEEP decision in place) ────────────────────────────────────
test('stampTextAdmitInPlace(admit=true) stamps ONLY assistant text, in place', () => {
  const items = [userText('hi'), assistantText('这段该留'), toolCall()];
  stampTextAdmitInPlace(items, true);
  assert.equal((items[0] as any).text_admit, undefined, 'user text not stamped');
  assert.equal((items[1] as any).text_admit, true, 'assistant text stamped in place');
  assert.equal((items[2] as any).text_admit, undefined, 'tool call not stamped');
  // now the stamped item survives the gate
  assert.equal(isReplayItemStrippedByTextGate(items[1]), false);
});

test('stampTextAdmitInPlace(admit=false) is a no-op (fail-closed = default strip)', () => {
  const item = assistantText('消极的一段');
  stampTextAdmitInPlace([item], false);
  assert.equal((item as any).text_admit, undefined, 'negative verdict leaves NO stamp → stays stripped');
  assert.equal(isReplayItemStrippedByTextGate(item), true);
});

// ── wire scrub (flag must never reach the wire) ─────────────────────────────────
test('stripTextAdmitFlagForWire drops the flag from admitted text, keeps the body', () => {
  const item = assistantText('留下的内容', { text_admit: true });
  const wire = stripTextAdmitFlagForWire(item) as any;
  assert.equal(wire.text_admit, undefined, 'internal flag scrubbed before wire');
  assert.equal(JSON.stringify(wire.content), JSON.stringify(item.content), 'text body preserved');
  assert.notEqual(wire, item, 'flagged item returns a distinct scrubbed copy (persisted item keeps the flag)');
});

test('stripTextAdmitFlagForWire is a same-ref passthrough for un-flagged items (byte-identical builds)', () => {
  const item = assistantText('无 flag');
  assert.equal(stripTextAdmitFlagForWire(item), item, 'unflagged item returned by reference untouched');
});

// ── verdict parser (psych fork output → keep/evict) ──────────────────────────────
const forkOut = (text: string) => [{ type: 'message', role: 'assistant', content: text } as Record<string, unknown>];

test('parsePsychAssessmentVerdict: KEEP → true, EVICT → false', () => {
  assert.equal(parsePsychAssessmentVerdict(forkOut('这段有信息增量。\nPSYCH_VERDICT: KEEP')), true);
  assert.equal(parsePsychAssessmentVerdict(forkOut('纯摸鱼。\nPSYCH_VERDICT: EVICT')), false);
});

test('parsePsychAssessmentVerdict: takes the LAST verdict, case-insensitive', () => {
  assert.equal(parsePsychAssessmentVerdict(forkOut('psych_verdict: evict\n改主意\nPSYCH_VERDICT: keep')), true);
});

test('parsePsychAssessmentVerdict: no recognizable verdict → null (caller fail-closes)', () => {
  assert.equal(parsePsychAssessmentVerdict(forkOut('我拒绝判定')), null);
  assert.equal(parsePsychAssessmentVerdict([]), null);
});

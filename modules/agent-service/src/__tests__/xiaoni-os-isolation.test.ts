import test from 'node:test';
import assert from 'node:assert/strict';
import {
  itemCarriesXiaoniOs,
  stampXiaoniOsHiddenInPlace,
  stripXiaoniOsByFlag,
  renderRecoverEnergyCompletedReminder
} from '../services/agent-loop-service';

// xiaoni_os request isolation (admin toggle) — behavior + cache-safety contract.
//
// The toggle NEVER rewrites history and NEVER alters a toggle-OFF build. It works by:
//  (1) STAMPING os-bearing tool items produced while the run-start snapshot is ON with
//      xiaoni_os_hidden=true — frozen into both the live request copy and the stack ledger;
//  (2) STRIPPING BY FLAG at the single wire chokepoint (buildMainAgentCanonicalRequest maps
//      every input item through stripXiaoniOsByFlag).
// So an item's fate is decided by ITS OWN frozen flag, not the current global toggle:
// "历史开了就是开了、关了就是关了；拨开关只管往后". These tests pin exactly that.

const NEW_OS = '新回合的私房备注-should-be-stripped';
const HIST_OS = '历史回合的私房备注-should-survive';

function privateReplyCall(callId: string, os: string) {
  return {
    type: 'function_call',
    call_id: callId,
    name: 'private_reply',
    arguments: JSON.stringify({ user_id: 123, message: '在的', xiaoni_os: os })
  } as any;
}

function sendResultOutput(callId: string, os: string) {
  return {
    type: 'function_call_output',
    call_id: callId,
    output: JSON.stringify({ ok: true, sent: ['在的'], xiaoni_os: os })
  } as any;
}

// ── itemCarriesXiaoniOs ────────────────────────────────────────────────────────

test('itemCarriesXiaoniOs: detects os in function_call args and JSON function_call_output', () => {
  assert.equal(itemCarriesXiaoniOs(privateReplyCall('c1', NEW_OS)), true);
  assert.equal(itemCarriesXiaoniOs(sendResultOutput('c1', NEW_OS)), true);
});

test('itemCarriesXiaoniOs: false for os-free tool items, non-JSON output, and non-tool items', () => {
  const execCall = {
    type: 'function_call', call_id: 'e1', name: 'exec_command',
    arguments: JSON.stringify({ cmd: 'cat /tmp/notes.md' })
  } as any;
  assert.equal(itemCarriesXiaoniOs(execCall), false);
  // recover_energy wake reminder (Path B, out of scope): output is plain reminder TEXT, not JSON.
  const wakeReminder = { type: 'function_call_output', call_id: 'r1', output: '你睡了 30 分钟，醒来后…' } as any;
  assert.equal(itemCarriesXiaoniOs(wakeReminder), false);
  const userMsg = { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] } as any;
  assert.equal(itemCarriesXiaoniOs(userMsg), false);
});

// ── stampXiaoniOsHiddenInPlace ─────────────────────────────────────────────────

test('stampXiaoniOsHiddenInPlace: hidden=false is a no-op (toggle OFF never stamps)', () => {
  const items = [privateReplyCall('c1', NEW_OS), sendResultOutput('c2', NEW_OS)];
  const before = JSON.stringify(items);
  stampXiaoniOsHiddenInPlace(items, false);
  assert.equal(JSON.stringify(items), before);
  assert.equal((items[0] as any).xiaoni_os_hidden, undefined);
});

test('stampXiaoniOsHiddenInPlace: hidden=true stamps ONLY os-bearing tool items', () => {
  const exec = {
    type: 'function_call', call_id: 'e1', name: 'exec_command',
    arguments: JSON.stringify({ cmd: 'ls' })
  } as any;
  const items = [privateReplyCall('c1', NEW_OS), exec, sendResultOutput('c2', NEW_OS)];
  stampXiaoniOsHiddenInPlace(items, true);
  assert.equal((items[0] as any).xiaoni_os_hidden, true);
  assert.equal((items[1] as any).xiaoni_os_hidden, undefined, 'os-free exec call must not be stamped');
  assert.equal((items[2] as any).xiaoni_os_hidden, true);
});

// ── stripXiaoniOsByFlag ────────────────────────────────────────────────────────

test('stripXiaoniOsByFlag: unflagged item returns the SAME ref, byte-identical (toggle-OFF / history safety)', () => {
  const item = privateReplyCall('c1', HIST_OS); // no flag
  const out = stripXiaoniOsByFlag(item);
  assert.equal(out, item, 'must return same reference so toggle-OFF builds are byte-identical');
  assert.ok(JSON.stringify(out).includes('xiaoni_os'), 'unflagged history keeps its os verbatim');
});

test('stripXiaoniOsByFlag: flagged function_call drops xiaoni_os + flag, keeps other args', () => {
  const item = privateReplyCall('c1', NEW_OS);
  (item as any).xiaoni_os_hidden = true;
  const out = stripXiaoniOsByFlag(item) as any;
  assert.notEqual(out, item, 'flagged item must be a new object (no base mutation)');
  const args = JSON.parse(out.arguments);
  assert.equal('xiaoni_os' in args, false, 'os key stripped from args');
  assert.equal(args.user_id, 123, 'other args preserved');
  assert.equal(args.message, '在的', 'other args preserved');
  assert.equal(out.xiaoni_os_hidden, undefined, 'flag must not reach the wire');
  assert.equal(out.call_id, 'c1');
  assert.equal(out.name, 'private_reply');
});

test('stripXiaoniOsByFlag: flagged function_call_output drops xiaoni_os from JSON output', () => {
  const item = sendResultOutput('c1', NEW_OS);
  (item as any).xiaoni_os_hidden = true;
  const out = stripXiaoniOsByFlag(item) as any;
  const parsed = JSON.parse(out.output);
  assert.equal('xiaoni_os' in parsed, false);
  assert.equal(parsed.ok, true, 'other result fields preserved');
  assert.deepEqual(parsed.sent, ['在的']);
  assert.equal(out.xiaoni_os_hidden, undefined);
});

test('stripXiaoniOsByFlag: does NOT mutate the input item (ledger keeps full os for ops)', () => {
  const item = privateReplyCall('c1', NEW_OS);
  (item as any).xiaoni_os_hidden = true;
  const snapshot = JSON.stringify(item);
  stripXiaoniOsByFlag(item);
  assert.equal(JSON.stringify(item), snapshot, 'source item unchanged — persisted ledger still has os');
});

test('stripXiaoniOsByFlag: deterministic + idempotent (cache byte-stability)', () => {
  const mk = () => { const i = privateReplyCall('c1', NEW_OS); (i as any).xiaoni_os_hidden = true; return i; };
  const a = JSON.stringify(stripXiaoniOsByFlag(mk()));
  const b = JSON.stringify(stripXiaoniOsByFlag(mk()));
  assert.equal(a, b, 'same input → byte-identical output across builds');
  const once = stripXiaoniOsByFlag(mk());
  const twice = stripXiaoniOsByFlag(once);
  assert.equal(JSON.stringify(twice), JSON.stringify(once), 'idempotent: re-stripping a clean item is a no-op');
});

// ── Wire chokepoint simulation (what buildMainAgentCanonicalRequest does) ────────

// Mixed history: one item produced while the toggle was ON (flagged) and one produced while it
// was OFF (unflagged) — both carry os. The chokepoint (map stripXiaoniOsByFlag) must scrub ONLY
// the flagged one. This is the core "拨开关只管往后、历史不变" guarantee.
test('chokepoint: strips new (flagged) os but preserves historical (unflagged) os verbatim', () => {
  const historical = privateReplyCall('hist', HIST_OS); // toggle was OFF → never stamped
  const fresh = privateReplyCall('fresh', NEW_OS);
  (fresh as any).xiaoni_os_hidden = true;               // toggle ON at production → frozen flag
  const freshResult = sendResultOutput('fresh', NEW_OS);
  (freshResult as any).xiaoni_os_hidden = true;

  const ledger = [historical, fresh, freshResult];
  const wire = ledger.map(stripXiaoniOsByFlag);
  const wireJson = JSON.stringify(wire);

  assert.ok(wireJson.includes(HIST_OS), 'historical os survives — history is frozen, not rewritten');
  assert.ok(!wireJson.includes(NEW_OS), 'freshly-flagged os is scrubbed from the model-bound request');
  assert.ok(!wireJson.includes('xiaoni_os_hidden'), 'the internal flag never reaches the wire');
  // Ledger (ops view) still holds the full os on the flagged items — strip did not mutate source.
  assert.ok(JSON.stringify(ledger).includes(NEW_OS), 'persisted ledger keeps full os for admin/ops');
});

test('chokepoint: toggle-OFF (nothing flagged) map is byte-identical to input (ironclad no-op)', () => {
  const input = [privateReplyCall('c1', HIST_OS), sendResultOutput('c2', HIST_OS)];
  const wire = input.map(stripXiaoniOsByFlag);
  assert.equal(JSON.stringify(wire), JSON.stringify(input), 'no flags → zero change vs today');
});

test('chokepoint: a fork clone of the scrubbed wire stays byte-identical (fork-cache alignment)', () => {
  const fresh = privateReplyCall('fresh', NEW_OS);
  (fresh as any).xiaoni_os_hidden = true;
  const wire = [privateReplyCall('hist', HIST_OS), fresh].map(stripXiaoniOsByFlag);
  const forkClone = JSON.parse(JSON.stringify(wire)); // cloneCanonicalAgentTurnRequest shape
  assert.equal(JSON.stringify(forkClone), JSON.stringify(wire), 'fork prefix == main prefix after strip');
});

// ── Path B: recover_energy wake reminder ────────────────────────────────────────

const SLEEP_OS = '醒来后接着写日记-should-be-hidden-when-isolated';

// Every wake cause routes to a DIFFERENT template with a DIFFERENT os-line prefix
// (念头 / 心情 / 备忘 / 执念 / 残影) — B must scrub all of them, not just 'natural'.
const WAKE_CAUSES = ['natural', 'private_or_mention_threshold', 'clock', 'clock_deferred', 'hard_cap'];

function wakeReminderInput(hideXiaoniOs: boolean, wakeCause = 'natural'): any {
  return {
    reason: '冲浪太久累了',
    xiaoniOs: SLEEP_OS,
    wakeCause,
    sleepMinutes: 30,
    clockMinutes: 15,
    recoveredEnergy: {},
    hideXiaoniOs
  };
}

test('B: wake reminder KEEPS the pre-sleep note when isolation is off (all wake causes)', () => {
  for (const wakeCause of WAKE_CAUSES) {
    const reminder = renderRecoverEnergyCompletedReminder(wakeReminderInput(false, wakeCause));
    assert.ok(reminder.includes(SLEEP_OS), `toggle off → note still shown on waking (${wakeCause})`);
  }
});

test('B: wake reminder DROPS the pre-sleep note line when isolation is on (ALL wake causes)', () => {
  for (const wakeCause of WAKE_CAUSES) {
    const reminder = renderRecoverEnergyCompletedReminder(wakeReminderInput(true, wakeCause));
    assert.ok(!reminder.includes(SLEEP_OS), `toggle on → note never reaches the model (${wakeCause})`);
    // The sentinel used to locate the line must never leak into the reminder either.
    assert.ok(!reminder.includes('XIAONI_OS_HIDDEN_LINE'), `sentinel not leaked (${wakeCause})`);
    // Other reminder content (reason) is preserved — only the os line is removed.
    assert.ok(reminder.includes('冲浪太久累了'), `reason preserved (${wakeCause})`);
  }
});

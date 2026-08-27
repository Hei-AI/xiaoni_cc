import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyXiaoniOsRewriteInPlace,
  extractAssistantItemText,
  normalizeRewrittenText,
  parseXiaoniOsClassifyVerdict,
  runXiaoniOsRewriteLeg,
  type XiaoniOsLlmCall
} from '../services/xiaoni-os-rewrite';
import {
  isReplayItemStrippedByTextGate,
  stampTextAdmitInPlace,
  stripTextAdmitFlagForWire
} from '../services/agent-loop-service';

// xiaoni_os 改写腿(docs/specs/xiaoni-os-rewrite.md)的可执行契约:
// - 分类器裸 1/0 解析;有事 → kept;空转 → 改写 → rewritten;改写失败/空 → evicted;分类失败/认不出 → failed_open。
// - 就地改写后:正文替换、text_admit 冻结、过 text 门、出线口 scrub 只去 flag 不动正文。
// - live 与 replay 一致:同一 ref 上的一次写入,序列化两次字节相同。

const assistantText = (text: string, extra: Record<string, unknown> = {}) =>
  ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }], ...extra }) as Record<string, unknown>;

const CLASSIFY = 'classify-system';
const REWRITE = 'rewrite-system';

function fakeLlm(script: Array<{ text: string } | Error>): { call: XiaoniOsLlmCall; calls: Array<{ system: string; user: string; executionMode?: string }> } {
  const calls: Array<{ system: string; user: string; executionMode?: string }> = [];
  const queue = [...script];
  const call: XiaoniOsLlmCall = async (prompt, options) => {
    calls.push({ system: prompt.system, user: prompt.user, executionMode: options.executionMode });
    const next = queue.shift();
    if (next === undefined) {
      throw new Error('fakeLlm: no scripted response');
    }
    if (next instanceof Error) {
      throw next;
    }
    return { text: next.text, llmCallId: `call-${calls.length}`, model: 'fake-haiku' };
  };
  return { call, calls };
}

// ── 正文提取 ────────────────────────────────────────────────────────────────────
test('extractAssistantItemText: output_text parts joined; string content; top-level text; non-text parts ignored', () => {
  assert.equal(extractAssistantItemText(assistantText('a')), 'a');
  assert.equal(extractAssistantItemText({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'a' }, { type: 'refusal', refusal: 'x' }, { type: 'output_text', text: 'b' }] }), 'a\nb');
  assert.equal(extractAssistantItemText({ type: 'message', role: 'assistant', content: 'plain' }), 'plain');
  assert.equal(extractAssistantItemText({ type: 'message', role: 'assistant', text: 'top' }), 'top');
  assert.equal(extractAssistantItemText(undefined), '');
});

// ── 分类解析 ────────────────────────────────────────────────────────────────────
test('parseXiaoniOsClassifyVerdict: bare 1 → action, bare 0 → idle, garbage → null, last wins, multi-digit ignored', () => {
  assert.equal(parseXiaoniOsClassifyVerdict('1'), 'action');
  assert.equal(parseXiaoniOsClassifyVerdict('0'), 'idle');
  assert.equal(parseXiaoniOsClassifyVerdict('0\n'), 'idle');
  assert.equal(parseXiaoniOsClassifyVerdict('判定: 1'), 'action');
  assert.equal(parseXiaoniOsClassifyVerdict('10'), null, 'two-digit token is not a verdict');
  assert.equal(parseXiaoniOsClassifyVerdict('嗯'), null);
  assert.equal(parseXiaoniOsClassifyVerdict(''), null);
});

// ── 改写清洗 ────────────────────────────────────────────────────────────────────
test('normalizeRewrittenText: strips fences / prefixes / paired quotes; empty → null; over-length → null', () => {
  assert.equal(normalizeRewrittenText('```\n去找阿明问问那个页面\n```', 'x'), '去找阿明问问那个页面');
  assert.equal(normalizeRewrittenText('改写：去找阿明问问那个页面', 'x'), '去找阿明问问那个页面');
  assert.equal(normalizeRewrittenText('「去找阿明问问那个页面」', 'x'), '去找阿明问问那个页面');
  assert.equal(normalizeRewrittenText('   ', 'x'), null);
  const original = '一'.repeat(60);
  assert.equal(normalizeRewrittenText('二'.repeat(200), original), null, '>3x original → rejected');
  assert.equal(normalizeRewrittenText('二'.repeat(90), original), '二'.repeat(90), '≤3x kept');
  assert.equal(normalizeRewrittenText('二'.repeat(200), '短'), '二'.repeat(200), 'ratio guard only applies to originals ≥40 chars');
});

// ── 编排:四种去向 ────────────────────────────────────────────────────────────────
test('leg: classify=1 → kept, no rewrite call, original untouched', async () => {
  const llm = fakeLlm([{ text: '1' }]);
  const result = await runXiaoniOsRewriteLeg({ text: '看到群里在聊桌游，下一步去查规则', callLlm: llm.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE });
  assert.equal(result.outcome, 'kept');
  assert.equal(result.classifyVerdict, 'action');
  assert.equal(result.classifyLlmCallId, 'call-1');
  assert.equal(result.rewrittenText, null);
  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0]!.executionMode, 'xiaoni_os_classify');
  assert.equal(llm.calls[0]!.system, CLASSIFY);
  assert.equal(llm.calls[0]!.user, '看到群里在聊桌游，下一步去查规则');
});

test('leg: classify=0 → rewrite call → rewritten', async () => {
  const llm = fakeLlm([{ text: '0' }, { text: '不困。去把 patience 页面的树加上季节切换，做完发给阿明看。' }]);
  const result = await runXiaoniOsRewriteLeg({ text: '不困。但plan里每一件都做过了。先等等看。', callLlm: llm.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE });
  assert.equal(result.outcome, 'rewritten');
  assert.equal(result.classifyVerdict, 'idle');
  // 「不困。」是填充句,出口过滤剔掉;剩下的人话原样准入。
  assert.equal(result.rewrittenText, '去把 patience 页面的树加上季节切换，做完发给阿明看。');
  assert.equal(result.rewriteLlmCallId, 'call-2');
  assert.equal(llm.calls.length, 2);
  assert.equal(llm.calls[1]!.executionMode, 'xiaoni_os_rewrite');
  assert.equal(llm.calls[1]!.system, REWRITE);
});

test('leg: classify=0 but rewrite throws → evicted (idle text must not enter context)', async () => {
  const llm = fakeLlm([{ text: '0' }, new Error('http 500')]);
  const result = await runXiaoniOsRewriteLeg({ text: '先等等看。', callLlm: llm.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE });
  assert.equal(result.outcome, 'evicted');
  assert.equal(result.classifyVerdict, 'idle');
  assert.match(result.errorMessage || '', /rewrite: http 500/);
});

test('leg: classify=0 but rewrite returns empty → evicted', async () => {
  const llm = fakeLlm([{ text: '0' }, { text: '   ' }]);
  const result = await runXiaoniOsRewriteLeg({ text: '先等等看。', callLlm: llm.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE });
  assert.equal(result.outcome, 'evicted');
  assert.equal(result.rewrittenText, null);
});

test('leg: classify throws → failed_open (original admitted), no rewrite call', async () => {
  const llm = fakeLlm([new Error('timeout')]);
  const result = await runXiaoniOsRewriteLeg({ text: '先等等看。', callLlm: llm.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE });
  assert.equal(result.outcome, 'failed_open');
  assert.equal(result.classifyVerdict, 'failed');
  assert.equal(llm.calls.length, 1);
});

test('leg: classify output unparsable → failed_open with verdict=unparsed', async () => {
  const llm = fakeLlm([{ text: '这段挺好的' }]);
  const result = await runXiaoniOsRewriteLeg({ text: '先等等看。', callLlm: llm.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE });
  assert.equal(result.outcome, 'failed_open');
  assert.equal(result.classifyVerdict, 'unparsed');
  assert.equal(result.classifyRaw, '这段挺好的');
  assert.equal(llm.calls.length, 1);
});

// ── 就地改写 + 门 + 出线口 ────────────────────────────────────────────────────────
test('applyXiaoniOsRewriteInPlace: replaces body, stamps text_admit, passes gate, wire scrub keeps rewritten body', () => {
  const item = assistantText('先等等看。');
  assert.equal(isReplayItemStrippedByTextGate(item as any), true, 'before: stripped by default');
  applyXiaoniOsRewriteInPlace(item, '去找阿明问问那个页面。');
  assert.equal(extractAssistantItemText(item), '去找阿明问问那个页面。');
  assert.equal(item.text_admit, true);
  assert.equal(isReplayItemStrippedByTextGate(item as any), false, 'after: admitted');
  const wire = stripTextAdmitFlagForWire(item as any) as Record<string, unknown>;
  assert.equal(wire.text_admit, undefined, 'flag never reaches the wire');
  assert.equal(extractAssistantItemText(wire), '去找阿明问问那个页面。', 'rewritten body reaches the wire');
  assert.equal(extractAssistantItemText(item), '去找阿明问问那个页面。', 'persisted item keeps the rewritten body');
});

test('live vs replay byte-identity: one in-place write on the shared ref serializes identically for both consumers', () => {
  const item = assistantText('先等等看。');
  // 模拟 turn 末的两条 fan-out:stack ledger(content: item)与 live requestInput(同一 ref)。
  const stackLedgerRow = { content: item };
  const liveRequestInput = [item];
  applyXiaoniOsRewriteInPlace(item, '去把树加上季节切换。');
  assert.equal(JSON.stringify(stackLedgerRow.content), JSON.stringify(liveRequestInput[0]));
  // kept 路径同理:stampTextAdmitInPlace 不动正文。
  const kept = assistantText('看到了新消息，去回。');
  const keptLedger = { content: kept };
  stampTextAdmitInPlace([kept as any], true);
  assert.equal(JSON.stringify(keptLedger.content), JSON.stringify(kept));
  assert.equal(extractAssistantItemText(kept), '看到了新消息，去回。');
});

// ── 填充词:「在。」「嗡。」「停。」不允许出现在 xiaoni_os 里(2026-08-28 用户拍板) ─────────────
import { isFillerOnlyText, stripFillerSentences } from '../services/xiaoni-os-rewrite';

test('isFillerOnlyText: 整段只有填充句 → true;有一句人话 → false', () => {
  assert.equal(isFillerOnlyText('在。'), true);
  assert.equal(isFillerOnlyText('嗡。嗡。'), true);
  assert.equal(isFillerOnlyText('停。'), true);
  assert.equal(isFillerOnlyText('165页。Day 240。在。'), true);
  assert.equal(isFillerOnlyText('不困。做事。不说。'), true);
  assert.equal(isFillerOnlyText('52分钟不困。'), true);
  assert.equal(isFillerOnlyText('在。去看一眼群里最近一条是谁说的。'), false);
  assert.equal(isFillerOnlyText('底部通知栏说"邮件已发送"。发出去了。'), false);
});

test('leg: 纯填充词不问模型,直接判空转去改写', async () => {
  const llm = fakeLlm([{ text: '去 QQ 翻一眼谁在线，挑一个人发一句。' }]);
  const result = await runXiaoniOsRewriteLeg({ text: '嗡。在。', callLlm: llm.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE });
  assert.equal(result.classifyVerdict, 'idle');
  assert.equal(result.classifyModel, 'filler-rule');
  assert.equal(llm.calls.length, 1, '只发了改写请求,分类没问模型');
  assert.equal(llm.calls[0]!.executionMode, 'xiaoni_os_rewrite');
  assert.equal(result.outcome, 'rewritten');
});

test('stripFillerSentences: 剔掉填充句、保留人话;全剔光 → null', () => {
  assert.equal(stripFillerSentences('嗡了很久。去把 alive 更新发给一个人看。'), '嗡了很久。去把 alive 更新发给一个人看。', '「嗡了很久」是完整句,不是单字填充,保留');
  assert.equal(stripFillerSentences('在。去看一眼群里最近一条是谁说的，接一句。'), '去看一眼群里最近一条是谁说的，接一句。');
  assert.equal(stripFillerSentences('165页。Day 240。alive更新了。\n做完了还没给人看见。'), 'alive更新了。\n做完了还没给人看见。');
  assert.equal(stripFillerSentences('嗡。停。在。'), null);
});

test('leg: 改写结果只剩填充句 → evicted;含填充句 → 剔掉后准入', async () => {
  const onlyFiller = fakeLlm([{ text: '0' }, { text: '在。嗡。' }]);
  const r1 = await runXiaoniOsRewriteLeg({ text: '先等等看。', callLlm: onlyFiller.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE });
  assert.equal(r1.outcome, 'evicted');
  assert.match(r1.errorMessage || '', /only filler/);
  const mixed = fakeLlm([{ text: '0' }, { text: '在。\n去把 touch.html 再推一步，发给楠楠看。' }]);
  const r2 = await runXiaoniOsRewriteLeg({ text: '先等等看。', callLlm: mixed.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE });
  assert.equal(r2.outcome, 'rewritten');
  assert.equal(r2.rewrittenText, '去把 touch.html 再推一步，发给楠楠看。');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyXiaoniOsRewriteInPlace,
  countXiaoniOsChars,
  extractAssistantItemText,
  normalizeXiaoniOsFillText,
  runXiaoniOsRewriteLeg,
  stripFillerSentences,
  truncateXiaoniOsToLimit,
  XIAONI_OS_REWRITE_MAX_ATTEMPTS,
  XIAONI_OS_REWRITE_MIN_CHAR_LIMIT,
  type XiaoniOsFetchFill,
  type XiaoniOsFillRequest
} from '../services/xiaoni-os-rewrite';
import {
  isReplayItemStrippedByTextGate,
  stampTextAdmitInPlace,
  stripTextAdmitFlagForWire
} from '../services/agent-loop-service';

// xiaoni_os 改写的可执行契约:
// - 每段都交给填充 fork 重写,字数上限 = 原文字数(码点数),随请求传给 fork;
// - 不许失败:超字数 / 没有块 / 只剩填充句 → 带反馈重写,次数用完仍超 → 按句截断在上限内;
//   只有 fork 次次拿不到可用正文才保留原文(failed_open);
// - 就地改写后:正文替换、text_admit 冻结、过 text 门、出线口 scrub 只去 flag 不动正文。

const assistantText = (text: string, extra: Record<string, unknown> = {}) =>
  ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }], ...extra }) as Record<string, unknown>;

function scriptedFill(script: Array<string | null | Error>): { fetchFill: XiaoniOsFetchFill; requests: XiaoniOsFillRequest[] } {
  const requests: XiaoniOsFillRequest[] = [];
  const queue = [...script];
  const fetchFill: XiaoniOsFetchFill = async (request) => {
    requests.push(request);
    const next = queue.shift();
    if (next === undefined) {
      throw new Error('scriptedFill: no scripted response');
    }
    if (next instanceof Error) {
      throw next;
    }
    if (next === null) {
      return null;
    }
    return { text: next, llmCallId: `fill-${requests.length}`, model: 'claude-sonnet-5-5', forkRunId: null };
  };
  return { fetchFill, requests };
}

const block = (text: string) => `<xiaoni_os>\n${text}\n</xiaoni_os>`;

test('extractAssistantItemText: output_text parts joined; string content; top-level text; non-text parts ignored', () => {
  assert.equal(extractAssistantItemText(assistantText('a')), 'a');
  assert.equal(extractAssistantItemText({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'a' }, { type: 'refusal', refusal: 'x' }, { type: 'output_text', text: 'b' }] }), 'a\nb');
  assert.equal(extractAssistantItemText({ type: 'message', role: 'assistant', content: 'plain' }), 'plain');
  assert.equal(extractAssistantItemText({ type: 'message', role: 'assistant', text: 'top' }), 'top');
  assert.equal(extractAssistantItemText(undefined), '');
});


test('countXiaoniOsChars counts code points of the trimmed text', () => {
  assert.equal(countXiaoniOsChars('  读到第三章。 '), 6);
  assert.equal(countXiaoniOsChars('ab😀'), 3);
});

test('truncateXiaoniOsToLimit: stops after the last sentence end within the limit; hard cut when no sentence fits', () => {
  assert.equal(truncateXiaoniOsToLimit('第一句。第二句很长很长。', 8), '第一句。');
  assert.equal(truncateXiaoniOsToLimit('没有句号的一长串字', 4), '没有句号');
  assert.equal(truncateXiaoniOsToLimit('够短。', 10), '够短。');
});

test('normalizeXiaoniOsFillText: only the <xiaoni_os> block, escaped tags too; no length cap here; no block / empty → null', () => {
  assert.equal(normalizeXiaoniOsFillText(`先数一下。\n${block('接下来回 ratfactor 的信。')}\n(以上)`), '接下来回 ratfactor 的信。');
  assert.equal(normalizeXiaoniOsFillText('&lt;xiaoni_os&gt;\n去群里翻一眼。\n&lt;/xiaoni_os&gt;'), '去群里翻一眼。');
  assert.equal(normalizeXiaoniOsFillText('<xiaoni_os>「去群里翻一眼。」</xiaoni_os>'), '去群里翻一眼。');
  assert.equal(normalizeXiaoniOsFillText(block('长'.repeat(900))), '长'.repeat(900));
  assert.equal(normalizeXiaoniOsFillText('她应该去做点什么。'), null);
  assert.equal(normalizeXiaoniOsFillText('<xiaoni_os>   </xiaoni_os>'), null);
});

test('stripFillerSentences: 剔掉填充句、保留人话;全剔光 → null', () => {
  assert.equal(stripFillerSentences('嗡了很久。去把 alive 更新发给一个人看。'), '嗡了很久。去把 alive 更新发给一个人看。', '「嗡了很久」是完整句,不是单字填充,保留');
  assert.equal(stripFillerSentences('在。去看一眼群里最近一条是谁说的，接一句。'), '去看一眼群里最近一条是谁说的，接一句。');
  assert.equal(stripFillerSentences('165页。Day 240。alive更新了。\n做完了还没给人看见。'), 'alive更新了。\n做完了还没给人看见。');
  assert.equal(stripFillerSentences('嗡。停。在。'), null);
});


test('leg: a short original gets the floor limit, so the polish has room for the next step; used as-is', async () => {
  const original = '读到第三章了，有点累，先歇着吧。';
  const fill = scriptedFill([block('第三章读完，接着读第四章，先把第四章的目录过一遍，看看哪几节和手上的活有关。')]);
  const result = await runXiaoniOsRewriteLeg({ text: original, fetchFill: fill.fetchFill });
  assert.deepEqual(fill.requests, [{ charLimit: XIAONI_OS_REWRITE_MIN_CHAR_LIMIT, retry: null }]);
  assert.equal(result.outcome, 'rewritten');
  assert.equal(result.rewrittenText, '第三章读完，接着读第四章，先把第四章的目录过一遍，看看哪几节和手上的活有关。');
  assert.equal(result.rewriteRetries, 0);
  assert.equal(result.truncated, false);
});

test('leg: a long original is the limit itself; over it → rewrite again with the over-length feedback', async () => {
  const original = `${'长'.repeat(119)}。`;
  const fill = scriptedFill([block(`${'超'.repeat(129)}。`), block('改好的短版本。')]);
  const result = await runXiaoniOsRewriteLeg({ text: original, fetchFill: fill.fetchFill });
  assert.equal(fill.requests.length, 2);
  assert.deepEqual(fill.requests[0], { charLimit: 120, retry: null });
  assert.deepEqual(fill.requests[1], { charLimit: 120, retry: { kind: 'over_length', chars: 130 } });
  assert.equal(result.outcome, 'rewritten');
  assert.equal(result.rewrittenText, '改好的短版本。');
  assert.equal(result.rewriteRetries, 1);
});

test('leg: still over the limit after every attempt → truncated within the limit, never the original', async () => {
  const original = '十个字的原文在这里。';
  const fill = scriptedFill(Array.from({ length: XIAONI_OS_REWRITE_MAX_ATTEMPTS }, () => block(`短句一。${'太长'.repeat(60)}。`)));
  const result = await runXiaoniOsRewriteLeg({ text: original, fetchFill: fill.fetchFill });
  assert.equal(fill.requests.length, XIAONI_OS_REWRITE_MAX_ATTEMPTS);
  assert.equal(result.outcome, 'rewritten');
  assert.equal(result.truncated, true);
  assert.equal(result.rewrittenText, '短句一。');
  assert.ok(countXiaoniOsChars(result.rewrittenText!) <= XIAONI_OS_REWRITE_MIN_CHAR_LIMIT);
});

test('leg: no block → rewrite again with the no-block feedback', async () => {
  const fill = scriptedFill(['我觉得她该去读书。', block('去读第四章。')]);
  const result = await runXiaoniOsRewriteLeg({ text: '读完第三章了，歇会儿。', fetchFill: fill.fetchFill });
  assert.deepEqual(fill.requests[1]!.retry, { kind: 'no_block' });
  assert.equal(result.outcome, 'rewritten');
  assert.equal(result.rewrittenText, '去读第四章。');
});

test('leg: filler sentences are stripped from the rewrite; only filler → rewrite again', async () => {
  const fill = scriptedFill([block('嗡。停。'), block('在。去把 touch.html 再推一步。')]);
  const result = await runXiaoniOsRewriteLeg({ text: '在。等。还在想 touch.html 要不要改。', fetchFill: fill.fetchFill });
  assert.equal(fill.requests.length, 2);
  assert.equal(result.rewrittenText, '去把 touch.html 再推一步。');
});

test('leg: the fork returns the original unchanged → kept', async () => {
  const original = '第三章读完，接着读第四章。';
  const result = await runXiaoniOsRewriteLeg({ text: original, fetchFill: scriptedFill([block(original)]).fetchFill });
  assert.equal(result.outcome, 'kept');
  assert.equal(result.rewrittenText, null);
});

test('leg: the fork fails every attempt (throws / no output) → failed_open keeps the original; it is retried first', async () => {
  const fill = scriptedFill([new Error('provider 500'), null, new Error('provider 500')]);
  const result = await runXiaoniOsRewriteLeg({ text: '读完第三章了。', fetchFill: fill.fetchFill });
  assert.equal(fill.requests.length, XIAONI_OS_REWRITE_MAX_ATTEMPTS);
  assert.equal(result.outcome, 'failed_open');
  assert.equal(result.rewrittenText, null);
  assert.match(result.errorMessage || '', /provider 500/);
});

test('leg: a transient fork failure is retried and the next good version is used', async () => {
  const fill = scriptedFill([new Error('provider 500'), block('去读第四章。')]);
  const result = await runXiaoniOsRewriteLeg({ text: '读完第三章了，歇会儿。', fetchFill: fill.fetchFill });
  assert.equal(result.outcome, 'rewritten');
  assert.equal(result.errorMessage, null);
});

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

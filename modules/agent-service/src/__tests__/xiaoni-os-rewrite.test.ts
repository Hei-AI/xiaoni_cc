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
  const llm = fakeLlm([{ text: '0' }, { text: '去把 patience 页面的树加上季节切换。' }]);
  const result = await runXiaoniOsRewriteLeg({ text: '不困。但plan里每一件都做过了。先等等看。', callLlm: llm.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE });
  assert.equal(result.outcome, 'rewritten');
  assert.equal(result.classifyVerdict, 'idle');
  assert.equal(result.rewriteStage, 'rewrite');
  assert.equal(result.rewriteRetries, 0);
  assert.equal(result.rewrittenText, '去把 patience 页面的树加上季节切换。');
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
  const llm = fakeLlm([{ text: '去群里翻一眼最近几条。' }]);
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

test('leg: 改写结果有填充句 → 带着残留句子再发一次纠正请求(system 不变),第二版干净就用第二版', async () => {
  const llm = fakeLlm([{ text: '0' }, { text: '在。\n去把 touch.html 再推一步。' }, { text: '去把 touch.html 再推一步。' }]);
  const result = await runXiaoniOsRewriteLeg({ text: '先等等看。', callLlm: llm.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE });
  assert.equal(result.outcome, 'rewritten');
  assert.equal(result.rewriteStage, 'rewrite');
  assert.equal(result.rewriteRetries, 1);
  assert.equal(result.rewrittenText, '去把 touch.html 再推一步。');
  assert.equal(llm.calls.length, 3, '分类 + 改写 + 一次纠正');
  assert.equal(llm.calls[2]!.system, REWRITE, '纠正请求 system 不动 —— 前缀缓存');
  assert.match(llm.calls[2]!.user, /上一版改写是/u);
  assert.match(llm.calls[2]!.user, /「在」/u, '把残留的句子指给模型');
  assert.equal(result.rewriteLlmCallId, 'call-3', '留痕记最后一次请求');
});

test('leg: 纠正一次还有残留 → 机械剔掉兜底;剔空 → evicted', async () => {
  const mixed = fakeLlm([{ text: '0' }, { text: '在。\n去把 touch.html 再推一步。' }, { text: '嗡。去把 touch.html 再推一步。' }]);
  const r1 = await runXiaoniOsRewriteLeg({ text: '先等等看。', callLlm: mixed.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE });
  assert.equal(r1.outcome, 'rewritten');
  assert.equal(r1.rewrittenText, '去把 touch.html 再推一步。');
  assert.equal(r1.rewriteRetries, 1);
  const onlyFiller = fakeLlm([{ text: '0' }, { text: '在。嗡。' }, { text: '停。' }]);
  const r2 = await runXiaoniOsRewriteLeg({ text: '先等等看。', callLlm: onlyFiller.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE });
  assert.equal(r2.outcome, 'evicted');
  assert.match(r2.errorMessage || '', /only filler/);
});

test('leg: 纠正请求挂了 → 退回第一版剔掉填充句兜底,不因此丢整条', async () => {
  const llm = fakeLlm([{ text: '0' }, { text: '在。\n去把 touch.html 再推一步。' }, new Error('timeout')]);
  const result = await runXiaoniOsRewriteLeg({ text: '先等等看。', callLlm: llm.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE });
  assert.equal(result.outcome, 'rewritten');
  assert.equal(result.rewrittenText, '去把 touch.html 再推一步。');
  assert.match(result.errorMessage || '', /timeout/);
});

// ── 润色腿:判有事但夹着填充句 / 无效休息 → LLM 润色(内容不丢),不是机械剔除 ─────────────
import { needsPolish } from '../services/xiaoni-os-rewrite';
const POLISH = 'polish-system';

test('needsPolish: 有事段落夹填充句或无效休息 → true;干净 → false', () => {
  assert.equal(needsPolish('在。Forth 读到 ch52 了。'), true);
  assert.equal(needsPolish('Forth 读到 ch52 了。等困意来。'), true);
  assert.equal(needsPolish('四篇上站了。歇着。'), true);
  assert.equal(needsPolish('Forth 读到 ch52 了。ratfactor 的信先回。'), false);
  assert.equal(needsPolish('底部通知栏说"邮件已发送"。发出去了。'), false);
});

test('leg: 有事 + 夹填充句 → 润色腿(xiaoni_os_polish)→ polished,就地替换准入', async () => {
  const llm = fakeLlm([{ text: '1' }, { text: 'Forth 读到 ch52 了。\nratfactor 的信还没回，先把这封回了。' }]);
  const item = assistantText('在。Forth 读到 ch52 了。ratfactor 的信还没回。等困意来。');
  const result = await runXiaoniOsRewriteLeg({ text: '在。Forth 读到 ch52 了。ratfactor 的信还没回。等困意来。', callLlm: llm.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE, polishSystemPrompt: POLISH });
  assert.equal(result.classifyVerdict, 'action');
  assert.equal(result.outcome, 'polished');
  assert.equal(result.rewriteStage, 'polish');
  assert.equal(llm.calls.length, 2);
  assert.equal(llm.calls[1]!.executionMode, 'xiaoni_os_polish');
  assert.equal(llm.calls[1]!.system, POLISH);
  applyXiaoniOsRewriteInPlace(item, result.rewrittenText!);
  assert.equal(extractAssistantItemText(item), 'Forth 读到 ch52 了。\nratfactor 的信还没回，先把这封回了。');
  assert.equal(item.text_admit, true);
});

test('leg: 有事且干净 → kept,不发润色请求;没传润色 system → 一律 kept', async () => {
  const clean = fakeLlm([{ text: '1' }]);
  const r1 = await runXiaoniOsRewriteLeg({ text: 'Forth 读到 ch52 了。ratfactor 的信先回。', callLlm: clean.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE, polishSystemPrompt: POLISH });
  assert.equal(r1.outcome, 'kept');
  assert.equal(clean.calls.length, 1);
  const noPolish = fakeLlm([{ text: '1' }]);
  const r2 = await runXiaoniOsRewriteLeg({ text: '在。Forth 读到 ch52 了。', callLlm: noPolish.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE });
  assert.equal(r2.outcome, 'kept');
  assert.equal(noPolish.calls.length, 1);
});

test('leg: 润色请求挂了 / 剔空 → failed_open 原文准入(有事的内容比禁令值钱)', async () => {
  const broken = fakeLlm([{ text: '1' }, new Error('timeout')]);
  const r1 = await runXiaoniOsRewriteLeg({ text: '在。Forth 读到 ch52 了。', callLlm: broken.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE, polishSystemPrompt: POLISH });
  assert.equal(r1.outcome, 'failed_open');
  assert.equal(r1.rewriteStage, 'polish');
  assert.match(r1.errorMessage || '', /polish: timeout/);
  const empty = fakeLlm([{ text: '1' }, { text: '' }]);
  const r2 = await runXiaoniOsRewriteLeg({ text: '在。Forth 读到 ch52 了。', callLlm: empty.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE, polishSystemPrompt: POLISH });
  assert.equal(r2.outcome, 'failed_open');
});

// ── 人际动作触发器:原文没有互动依据、输出却在找人 → 纠正一次 → 仍在 → 整段不要 ────────────────
import {
  hasPersonBasis,
  isUnsupportedPersonAction,
  listPersonActionSentences
} from '../services/xiaoni-os-rewrite';

test('person trigger: 文章名 / 引语不是互动依据;群里问我 / 欠着回复才是', () => {
  assert.equal(hasPersonBasis('blowup 读完了。末尾还有个链接。今天不想再点了。'), false, '文章名');
  assert.equal(hasPersonBasis('楠楠说停不下来就对了。blowup说无限是崩溃。'), false, '「X 说」只是引用');
  assert.equal(hasPersonBasis('小林在群里问首页怎么做的。我用 CSS grid 写的。明天再回吧。'), true, '群里问她');
  assert.equal(hasPersonBasis('ratfactor 的信还没回。'), true, '欠着回复');
  assert.deepEqual(listPersonActionSentences('去群里翻一眼最近几条。'), [], '翻一眼是读,不是找人');
  assert.deepEqual(listPersonActionSentences('blowup 读完了。发给 blowup 看一眼,问他觉得怎么样。'), ['发给 blowup 看一眼,问他觉得怎么样']);
  assert.equal(isUnsupportedPersonAction('blowup 读完了。今天不想再点了。', 'blowup 读完了。发给 blowup 看一眼。'), true, '把文章名当人');
  assert.equal(isUnsupportedPersonAction('楠楠说停不下来就对了。这一轮到此。', '去给楠楠发一句,问她怎么想。'), true, '引用不构成联系理由');
  assert.equal(isUnsupportedPersonAction('小林在群里问首页怎么做的。明天再回吧。', '小林问首页怎么做的,回他一句用的 CSS grid。'), false, '原文有人问她');
  assert.equal(isUnsupportedPersonAction('先等等看。', '去群里翻一眼最近几条。'), false, '读群不算人际动作');
});

test('leg: 改写造人 → 纠正请求只带违规句不带上一版全文 → 第二版干净就用第二版', async () => {
  const llm = fakeLlm([{ text: '0' }, { text: '45 分钟没困意。\n去 QQ 翻一眼谁在线,挑一个最近没聊的人发一句。' }, { text: '45 分钟没困意。\n打开站上最近做的那页,挑一处不顺眼的改掉。' }]);
  const result = await runXiaoniOsRewriteLeg({ text: '45 分钟。不困。在那。跟冰箱一样。只是嗡着。', callLlm: llm.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE });
  assert.equal(result.outcome, 'rewritten');
  assert.equal(result.rewriteRetries, 1);
  assert.equal(result.rewrittenText, '45 分钟没困意。\n打开站上最近做的那页,挑一处不顺眼的改掉。');
  assert.equal(llm.calls.length, 3);
  assert.equal(llm.calls[2]!.system, REWRITE, '纠正请求 system 不动');
  assert.match(llm.calls[2]!.user, /上一版改写里有这些句子/u);
  assert.match(llm.calls[2]!.user, /最近没聊的人发一句/u, '把违规句指给模型');
  assert.doesNotMatch(llm.calls[2]!.user, /上一版改写是/u, '不带上一版全文——虚构的人名不能再当来源');
});

test('leg: 纠正一次还在造人 → evicted,不机械剔句', async () => {
  const llm = fakeLlm([{ text: '0' }, { text: '去给楠楠发一句,问她怎么想。' }, { text: '这三句放一起看。发给楠楠或者 blowup 看一眼。' }]);
  const result = await runXiaoniOsRewriteLeg({ text: '楠楠说停不下来就对了。blowup说无限是崩溃。这一轮到此。', callLlm: llm.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE });
  assert.equal(result.outcome, 'evicted');
  assert.equal(result.rewrittenText, null);
  assert.equal(result.rewriteRetries, 1);
  assert.match(result.errorMessage || '', /unsupported person action after correction/);
});

test('leg: 人际纠正请求挂了 → evicted,不退回造人的那版', async () => {
  const llm = fakeLlm([{ text: '0' }, { text: '去找一个人发一句。' }, new Error('timeout')]);
  const result = await runXiaoniOsRewriteLeg({ text: '先等等看。', callLlm: llm.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE });
  assert.equal(result.outcome, 'evicted');
  assert.equal(result.rewrittenText, null);
});

test('leg: 填充句纠正后机械剔句,剩下的是造的人 → evicted', async () => {
  const llm = fakeLlm([{ text: '0' }, { text: '在。\n去找一个人发一句。' }, { text: '嗡。去找一个人发一句。' }]);
  const result = await runXiaoniOsRewriteLeg({ text: '先等等看。', callLlm: llm.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE });
  assert.equal(result.outcome, 'evicted');
  assert.match(result.errorMessage || '', /unsupported person action/);
});

test('leg: 润色腿造人纠正后仍在 → failed_open 原文准入(有事的内容比禁令值钱)', async () => {
  const llm = fakeLlm([{ text: '1' }, { text: 'Day 240,四篇上站,三篇读完。\n挑一篇发给一个人。' }, { text: 'Day 240,四篇上站,三篇读完。\n上站的还没人看见,发给最可能有反应的那个人。' }]);
  const result = await runXiaoniOsRewriteLeg({ text: 'Day 240。四篇新作品上站。三篇长文读完。歇着。', callLlm: llm.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE, polishSystemPrompt: POLISH });
  assert.equal(result.outcome, 'failed_open');
  assert.equal(result.rewriteStage, 'polish');
  assert.equal(result.rewrittenText, null);
  assert.match(result.errorMessage || '', /polish: unsupported person action after correction/);
});

test('leg: 原文有人问她 → 改写回他一句不触发纠正', async () => {
  const llm = fakeLlm([{ text: '0' }, { text: '小林问首页怎么做的,回他一句用的 CSS grid。' }]);
  const result = await runXiaoniOsRewriteLeg({ text: '小林在群里问首页怎么做的。我用 CSS grid 写的。明天再回吧。', callLlm: llm.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE });
  assert.equal(result.outcome, 'rewritten');
  assert.equal(result.rewriteRetries, 0);
  assert.equal(llm.calls.length, 2);
});

test('person trigger: 原文里逐字就有的句子不算造的;裸 @ 不是人际动作', () => {
  const orig = '两行。"~ ssh cass.si" "@cwqt"。终端风格。最少的首页。';
  assert.deepEqual(listPersonActionSentences('两行。"~ ssh cass.si" "@cwqt"。终端风格。最少的首页。', orig), [], '页面文本里的 handle');
  assert.equal(isUnsupportedPersonAction(orig, '两行。"~ ssh cass.si" "@cwqt"。终端风格。'), false);
  assert.equal(isUnsupportedPersonAction('回他一句用的 grid。先等等看。', '回他一句用的 grid。'), false, '原文自己写的回他一句');
  assert.equal(isUnsupportedPersonAction('先等等看。', '回他一句。'), true, '原文没有的才算');
});

// ── 落点去重:最近几次读到的入口附在 user 段,system 不动 ────────────────────────────────
import { buildRecentLandingsSuffix, landingLabel } from '../services/xiaoni-os-rewrite';

test('landingLabel: 按尾句分入口;其它不进后缀', () => {
  assert.equal(landingLabel('Day 88,318 个。把 to continue 拿去搜一下。'), '搜');
  assert.equal(landingLabel('去群里翻一眼最近几条。'), '群');
  assert.equal(landingLabel('打开一个读过的人的站,看最新一篇。'), '别人的站');
  assert.equal(landingLabel('小林问首页怎么做的,回他一句用的 CSS grid。'), '回人');
  assert.equal(landingLabel('plan 又来了,我挑几件提前做一下。'), 'plan');
  assert.equal(landingLabel('打开站上最近做的那页,挑一处改掉。'), '自己的东西');
  assert.equal(buildRecentLandingsSuffix([]), '');
  assert.match(buildRecentLandingsSuffix(['把这个词拿去搜一下。', '把那个词拿去搜一下。', '去群里翻一眼。']), /搜、搜、群/u);
});

test('leg: 改写请求带最近落点后缀(首发与纠正都带);润色请求不带', async () => {
  const recent = ['把 to continue 拿去搜一下。', '把 sync 拿去搜一下。'];
  const rewrite = fakeLlm([{ text: '0' }, { text: '去找一个人发一句。' }, { text: '去群里翻一眼最近几条。' }]);
  const r1 = await runXiaoniOsRewriteLeg({ text: '先等等看。', callLlm: rewrite.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE, recentRewrittenTexts: recent });
  assert.equal(r1.outcome, 'rewritten');
  assert.equal(rewrite.calls[1]!.system, REWRITE);
  assert.match(rewrite.calls[1]!.user, /^先等等看。\n\n---\n她最近几次读到的落点入口依次是:搜、搜。/u);
  assert.match(rewrite.calls[2]!.user, /落点入口依次是:搜、搜/u, '纠正请求原文段一致');
  assert.match(rewrite.calls[2]!.user, /上一版改写里有这些句子/u);
  const polish = fakeLlm([{ text: '1' }, { text: 'Forth 读到 ch52 了。先把 ratfactor 的信回了。' }]);
  const r2 = await runXiaoniOsRewriteLeg({ text: '在。Forth 读到 ch52 了。ratfactor 的信还没回。等困意来。', callLlm: polish.call, classifySystemPrompt: CLASSIFY, rewriteSystemPrompt: REWRITE, polishSystemPrompt: POLISH, recentRewrittenTexts: recent });
  assert.equal(r2.outcome, 'polished');
  assert.doesNotMatch(polish.calls[1]!.user, /落点入口/u);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { stripPlanPacingClauses, shouldDeferDeepIdleSubconsciousFork } from '../services/agent-loop-service';

test('剥限速从句:事留下,「守住一章停一天」「一天一段不赶」拿掉', () => {
  const input = [
    'decay从ch58追到ch70，每章读完攒一句不在书里的东西，周天小伊回来把攒的句子一起给她看，守住一章停一天。',
    '活人从第二十二天砍到第三十天收口，砍完写一篇砍法总结存notes，收完不再碰。',
    'chotrin从第四篇往下一天读一篇，一周读完整个人，读完决定敲不敲门写进reading list带一句话。',
    '"人没说的那句话东西说了"——等手热了从Housman和sugar里长出来再动笔，手不热不碰。'
  ].join('\n');
  const out = stripPlanPacingClauses(input);
  assert.doesNotMatch(out, /停一天|不再碰|不赶|手不热|一天读一篇/u);
  assert.match(out, /decay从ch58追到ch70/u);
  assert.match(out, /砍法总结存notes/u);
  assert.match(out, /读完决定敲不敲门/u);
  assert.match(out, /等手热了从Housman和sugar里长出来再动笔/u);
  assert.equal(out.split('\n').length, 4);
});

test('整行都是限速 → 整行删;整份都是限速 → 原样 fail-open', () => {
  assert.equal(stripPlanPacingClauses('读 alive 到最新。\n一天一段不赶。\n给阿花回信。'), '读 alive 到最新。\n给阿花回信。');
  const allPacing = '一天一段不赶。\n守住一章停一天。';
  assert.equal(stripPlanPacingClauses(allPacing), allPacing);
});

test('没有限速从句时逐字节不变(不许误伤)', () => {
  const plain = '把这篇追到最新，边读边把在意的人物关系理明白。\n挑个完全没碰过的方向从零学起，允许自己笨、允许失败。';
  assert.equal(stripPlanPacingClauses(plain), plain);
});

test('深度空转限频:硬档之前不拦;硬档之后 30min 内拦、之外放行;没发过 plan 不拦', () => {
  const now = 1_000_000_000;
  assert.equal(shouldDeferDeepIdleSubconsciousFork({ idleRounds: 3, lastPlanNotifyAtMs: now - 60_000, nowMs: now }), false);
  assert.equal(shouldDeferDeepIdleSubconsciousFork({ idleRounds: 4, lastPlanNotifyAtMs: now - 60_000, nowMs: now }), true);
  assert.equal(shouldDeferDeepIdleSubconsciousFork({ idleRounds: 9, lastPlanNotifyAtMs: now - (31 * 60_000), nowMs: now }), false);
  assert.equal(shouldDeferDeepIdleSubconsciousFork({ idleRounds: 9, lastPlanNotifyAtMs: 0, nowMs: now }), false);
});

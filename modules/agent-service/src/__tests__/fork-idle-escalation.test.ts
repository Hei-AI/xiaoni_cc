import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setForkIdleEscalationEnabled,
  getConsecutiveIdlePlanFailures,
  resetConsecutiveIdlePlanFailures,
  recordIdlePlanSettle,
  setLastEmittedSubconsciousPlan,
  getLastEmittedSubconsciousPlan,
  shouldEscalateSubconsciousFork,
  renderSubconsciousForkReminderForTest,
  renderSelfContinuationReminderForTest
} from '../services/agent-loop-service';

// 自驱动 fork 空转升级的回归守卫。
//
// 背景(实测 trace runtrace_1784969153999_faefb37f / slice 90434):一次主请求里有 95 条
// <xiaoni_plan>,占 655 条 input 的 14.5%、496,640 字符的 18.1%;近 6h 有 111/146 = 76% 的
// plan 触发 run 零工具调用。fork 每次都在信息真空里重出题 → 95 条 plan 只有 22 种开头。
//
// 本特性把「上一份 plan 连着 N 轮没被执行」+ 那份 plan 原文喂给 fork。核心约束有两条,
// 下面每条都有专项断言:
//  1) 升级信号【只】进 fork 的尾部 reminder,绝不进主 agent 的续航提醒(后者要冻结进 stack
//     并被主 run replay 逐字节重建 —— 混进去就是 run 边界击穿 + 负面状态注入)。
//  2) 开关 OFF / 未达阈值 / 没有上一份 plan → 退回原文,与改动前逐字节一致。

const SESSION = 'test-session-fork-idle';

function freshSession(key: string) {
  resetConsecutiveIdlePlanFailures(key);
  setLastEmittedSubconsciousPlan(key, '一份占位 plan');
}

test('计数器: 纯文本零动作 settle 累加,碰世界的工具调用归零', () => {
  const key = `${SESSION}-counter`;
  resetConsecutiveIdlePlanFailures(key);

  recordIdlePlanSettle(key, { settledOnFinalAnswer: true, didRealWork: false });
  assert.equal(getConsecutiveIdlePlanFailures(key), 1);
  recordIdlePlanSettle(key, { settledOnFinalAnswer: true, didRealWork: false });
  recordIdlePlanSettle(key, { settledOnFinalAnswer: true, didRealWork: false });
  assert.equal(getConsecutiveIdlePlanFailures(key), 3, '连续空转必须累加,不能封顶在 1');

  recordIdlePlanSettle(key, { settledOnFinalAnswer: true, didRealWork: true });
  assert.equal(getConsecutiveIdlePlanFailures(key), 0, '真干了活必须归零');
});

test('计数器: 没 settle 在 final_answer 上的 turn 既不加也不减', () => {
  const key = `${SESSION}-nosettle`;
  resetConsecutiveIdlePlanFailures(key);
  recordIdlePlanSettle(key, { settledOnFinalAnswer: true, didRealWork: false });
  assert.equal(getConsecutiveIdlePlanFailures(key), 1);

  recordIdlePlanSettle(key, { settledOnFinalAnswer: false, didRealWork: false });
  assert.equal(getConsecutiveIdlePlanFailures(key), 1, '未 settle 不该动计数');
});

test('计数器: didRealWork 优先于 settle —— 干了活又收工也归零', () => {
  const key = `${SESSION}-workthensettle`;
  resetConsecutiveIdlePlanFailures(key);
  recordIdlePlanSettle(key, { settledOnFinalAnswer: true, didRealWork: false });
  recordIdlePlanSettle(key, { settledOnFinalAnswer: true, didRealWork: false });
  assert.equal(getConsecutiveIdlePlanFailures(key), 2);

  // 一个真干活的 run 以 final_answer 收尾:C2 仍会 fire fork,但这不是空转。
  recordIdlePlanSettle(key, { settledOnFinalAnswer: true, didRealWork: true });
  assert.equal(getConsecutiveIdlePlanFailures(key), 0);
});

test('升级门: 三个条件缺一不可(开关 / 阈值 / 上一份 plan)', () => {
  setForkIdleEscalationEnabled(false);
  assert.equal(
    shouldEscalateSubconsciousFork({ idleRounds: 9, lastPlanText: '上一份' }),
    false,
    '开关 OFF 时无论多少轮都不许升级'
  );

  setForkIdleEscalationEnabled(true);
  assert.equal(
    shouldEscalateSubconsciousFork({ idleRounds: 1, lastPlanText: '上一份' }),
    false,
    '第 1 轮空转仍走原文,给她自主机会'
  );
  assert.equal(
    shouldEscalateSubconsciousFork({ idleRounds: 2, lastPlanText: '上一份' }),
    true,
    '连续 2 轮达阈值'
  );
  assert.equal(
    shouldEscalateSubconsciousFork({ idleRounds: 5, lastPlanText: null }),
    false,
    '重启后没有上一份 plan → 退回原文,不渲染半截升级段'
  );
  setForkIdleEscalationEnabled(false);
});

test('OFF / 未达阈值时,fork reminder 与主 agent 续航提醒逐字节一致', () => {
  const baseline = renderSelfContinuationReminderForTest();

  setForkIdleEscalationEnabled(false);
  assert.equal(
    renderSubconsciousForkReminderForTest({ idleRounds: 7, lastPlanText: '上一份 plan' }),
    baseline,
    '开关 OFF = 改动前行为,必须逐字节一致'
  );

  setForkIdleEscalationEnabled(true);
  assert.equal(
    renderSubconsciousForkReminderForTest({ idleRounds: 1, lastPlanText: '上一份 plan' }),
    baseline,
    '未达阈值必须逐字节回落到原文'
  );
  assert.equal(
    renderSubconsciousForkReminderForTest({ idleRounds: 9, lastPlanText: null }),
    baseline,
    '没有上一份 plan 必须逐字节回落到原文'
  );
  setForkIdleEscalationEnabled(false);
});

test('升级段: 轮数与上一份 plan 原文都要真的进去,且原文完整不截断', () => {
  setForkIdleEscalationEnabled(true);
  const lastPlan = [
    '1. 把decay追到第四十八章——这是唯一一条我证明了是"想"的线',
    '2. 把楠楠所有的诗读完然后把欠她的那个回应做出来'
  ].join('\n\n');

  const rendered = renderSubconsciousForkReminderForTest({ idleRounds: 4, lastPlanText: lastPlan });

  assert.notEqual(rendered, renderSelfContinuationReminderForTest(), '达阈值必须真的变了');
  assert.match(rendered, /连续 4 轮了/, '轮数必须烤进文本');
  assert.ok(rendered.includes(lastPlan), '上一份 plan 必须原样完整回贴,不许截断');
  assert.doesNotMatch(rendered, /\{\{[A-Z0-9_]+\}\}/, '不许留未替换的占位符');
  // 原文正文仍在:升级是【追加】,不是把她自己的引导 prompt 换掉。
  assert.ok(rendered.includes('你的长期目标'), '原引导正文必须保留,升级段是追加不是替换');
  setForkIdleEscalationEnabled(false);
});

test('升级段渲染是确定的: 同入参 → 同字节(fork 多 turn 共用同一份,前缀不许漂)', () => {
  setForkIdleEscalationEnabled(true);
  const args = { idleRounds: 3, lastPlanText: '上一份没被执行的 plan' };
  const a = renderSubconsciousForkReminderForTest(args);
  const b = renderSubconsciousForkReminderForTest(args);
  assert.equal(a, b, '同入参必须逐字节相同,否则 fork turn-2 起冷读');
  setForkIdleEscalationEnabled(false);
});

test('隔离专项: 升级触发后,主 agent 的续航提醒仍与 OFF 时逐字节相同', () => {
  // 本特性的核心约束。主 agent 那份提醒会被 buildLoopSelfContinuationStackItem 冻结进
  // stack(content.system_reminder),下一 run replay 要逐字节重建它。计数/升级段一旦漏进去,
  // 既是 run 边界缓存击穿,也是往主上下文注入负面状态(正是 text gate 要挡的那一类)。
  setForkIdleEscalationEnabled(false);
  const mainWhileOff = renderSelfContinuationReminderForTest();

  setForkIdleEscalationEnabled(true);
  const key = `${SESSION}-isolation`;
  freshSession(key);
  recordIdlePlanSettle(key, { settledOnFinalAnswer: true, didRealWork: false });
  recordIdlePlanSettle(key, { settledOnFinalAnswer: true, didRealWork: false });
  recordIdlePlanSettle(key, { settledOnFinalAnswer: true, didRealWork: false });
  assert.ok(getConsecutiveIdlePlanFailures(key) >= 2, '前置条件:已达升级阈值');
  // fork 侧确实升级了……
  assert.notEqual(
    renderSubconsciousForkReminderForTest({
      idleRounds: getConsecutiveIdlePlanFailures(key),
      lastPlanText: getLastEmittedSubconsciousPlan(key)
    }),
    mainWhileOff,
    '前置条件:fork 侧已升级'
  );
  // ……而主 agent 侧一个字节都没变。
  assert.equal(
    renderSelfContinuationReminderForTest(),
    mainWhileOff,
    '主 agent 续航提醒绝不许因为 fork 升级而改变一个字节'
  );
  assert.doesNotMatch(
    renderSelfContinuationReminderForTest(),
    /连续 \d+ 轮了/,
    '升级段绝不许出现在主 agent 上下文里'
  );
  setForkIdleEscalationEnabled(false);
});

test('lastEmittedPlan: 空串/非字符串不覆盖已有值', () => {
  const key = `${SESSION}-lastplan`;
  setLastEmittedSubconsciousPlan(key, '真正发出去的 plan');
  setLastEmittedSubconsciousPlan(key, '   ');
  setLastEmittedSubconsciousPlan(key, null as unknown as string);
  assert.equal(
    getLastEmittedSubconsciousPlan(key),
    '真正发出去的 plan',
    '垃圾输入不许把已有的上一份 plan 冲掉'
  );
});

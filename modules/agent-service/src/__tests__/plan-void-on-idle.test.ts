// plan 空转 run 作废 —— 引擎侧判定回归(docs/specs/xiaoni-plan-run-void-on-idle.md)。
//
// 判定是纯函数 shouldVoidIdlePlanRun,loop 的 settle 分支按 run 实况填参调用。
// 铁律面:OFF 时永远 false(行为与今天逐字节一致);任何一票否决位翻转都必须挡下作废。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldVoidIdlePlanRun,
  setPlanVoidOnIdleEnabled,
  isPlanVoidOnIdleEnabledForTest
} from '../services/agent-loop-service';

const VOIDABLE = {
  queueBacked: true,
  settledOnFinalAnswer: true,
  runCalledAnyTool: false,
  deliveredCount: 0,
  compressionCommitted: false,
  evictedTurnCount: 0,
  triggerIsSubconsciousPlan: true,
  foldedAllSubconsciousPlans: true
};

test('默认 OFF:开关不动时即便全条件满足也不作废', () => {
  assert.equal(isPlanVoidOnIdleEnabledForTest(), false);
  assert.equal(shouldVoidIdlePlanRun(VOIDABLE), false);
});

test('setter 只认 boolean,非 boolean 保持原值', () => {
  setPlanVoidOnIdleEnabled('true' as unknown);
  assert.equal(isPlanVoidOnIdleEnabledForTest(), false);
  setPlanVoidOnIdleEnabled(1 as unknown);
  assert.equal(isPlanVoidOnIdleEnabledForTest(), false);
  setPlanVoidOnIdleEnabled(true);
  assert.equal(isPlanVoidOnIdleEnabledForTest(), true);
  setPlanVoidOnIdleEnabled(false);
  assert.equal(isPlanVoidOnIdleEnabledForTest(), false);
});

test('ON + 全条件满足 → 作废', () => {
  setPlanVoidOnIdleEnabled(true);
  try {
    assert.equal(shouldVoidIdlePlanRun(VOIDABLE), true);
  } finally {
    setPlanVoidOnIdleEnabled(false);
  }
});

test('任一票否决位翻转都挡下作废(逐位)', () => {
  setPlanVoidOnIdleEnabled(true);
  try {
    const vetoes: Array<Partial<typeof VOIDABLE>> = [
      { queueBacked: false },
      // 没 settle 在 final_answer(比如 frame yield)→ 冻结
      { settledOnFinalAnswer: false },
      // 调过任何工具——含 recover_energy(睡过必须留痕)→ 冻结
      { runCalledAnyTool: true },
      // 有可见投递 → 冻结
      { deliveredCount: 1 },
      // 本 run 有压缩提交 → 冻结
      { compressionCommitted: true },
      // 本 run 有 evictedTurns → 冻结
      { evictedTurnCount: 2 },
      // 触发不是 subconscious plan(QQ 消息/其它 reminder)→ 冻结
      { triggerIsSubconsciousPlan: false },
      // 折叠消费过真实外部 notify → 冻结,否则信息丢失
      { foldedAllSubconsciousPlans: false }
    ];
    for (const veto of vetoes) {
      assert.equal(
        shouldVoidIdlePlanRun({ ...VOIDABLE, ...veto }),
        false,
        `veto ${JSON.stringify(veto)} 应挡下作废`
      );
    }
  } finally {
    setPlanVoidOnIdleEnabled(false);
  }
});

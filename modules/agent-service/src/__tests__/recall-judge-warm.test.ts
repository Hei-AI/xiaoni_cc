import assert from 'node:assert/strict';
import test from 'node:test';
import * as persistence from '@qq-bot/persistence';

import { warmRecallJudgeCache } from '../services/xiaoni-recall-delivery';

// 精排 system 预热:低频腿在 LongCat 多副本缓存上常年是冷的,按节拍发一条同 system 的小请求焐热。
// 必须成立:① system 与真精排逐字节一致(否则焐的是别的前缀);② 真精排不跑的时候(开关/投递关、睡着)不发;
// ③ 单独的 source_kind,不混进精排统计。

type Call = { prompt: { system: string; user: string }; options: Record<string, unknown> };

function recorder() {
  const calls: Call[] = [];
  const call = (async (prompt: { system: string; user: string }, options: Record<string, unknown> = {}) => {
    calls.push({ prompt, options });
    return { text: '{"picks":[]}', llmCallId: 'llm-warm', model: 'test' };
  }) as any;
  return { calls, call };
}

test('warm request carries the exact system prefix the real judge sends', async () => {
  const { calls, call } = recorder();
  const outcome = await warmRecallJudgeCache({ readGate: async () => ({ enabled: true }), isAsleep: async () => false, call });
  assert.equal(outcome, 'warmed');
  assert.equal(calls.length, 1);
  const real = (persistence as any).buildJudgePrompt(
    [{ id: 'recall-surface:landing:x', text: '一段旧记忆', leg: 'landing', ageDays: 3 }],
    '她此刻在做的事'
  );
  assert.equal(calls[0]!.prompt.system, real.system);
  assert.ok(calls[0]!.prompt.system.length > 0);
  assert.equal(calls[0]!.options.executionMode, 'recall_rerank_heartbeat');
});

test('no warm request while the judge would not run (switch off / asleep / gate unreadable)', async () => {
  for (const deps of [
    { readGate: async () => ({ enabled: false }), isAsleep: async () => false },
    { readGate: async () => ({ enabled: true }), isAsleep: async () => true },
    { readGate: async () => { throw new Error('db down'); }, isAsleep: async () => false }
  ]) {
    const { calls, call } = recorder();
    const outcome = await warmRecallJudgeCache({ ...deps, call });
    assert.notEqual(outcome, 'warmed');
    assert.equal(calls.length, 0);
  }
});

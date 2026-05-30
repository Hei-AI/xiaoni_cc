import test from 'node:test';
import assert from 'node:assert/strict';
import { SelfActionService } from '../services/self-action-service';

const eligibleState = {
  boredom: 0.8,
  fatigue: 0.2,
  energy: 0.8,
  sharingDesire: 0.7,
  sleepPressure: 0.2,
  cooldownActive: false,
  startupGraceActive: false
};

test('SelfActionService skips the removed legacy random web_search runner', async () => {
  const calls: string[] = [];
  const store = {
    async evaluateSelfActionEligibility() {
      calls.push('evaluate');
      return {
        eligible: true,
        reason: 'eligible',
        lifeState: eligibleState,
        budgetSnapshot: { daily_count: 0 }
      };
    },
    async createDigitalAction(input: any) {
      calls.push(`create:${input.id}`);
      return {};
    },
    async completeDigitalAction(input: any) {
      calls.push(`complete:${input.id}`);
      return {};
    },
    async createSharePoolItemFromDigitalAction(input: any) {
      calls.push(`share:${input.boundaryLabel}`);
      return { id: 42 };
    },
    async failDigitalAction() {
      calls.push('fail');
    }
  };
  const fetchImpl = async () => {
    calls.push('fetch');
    return new Response('{}', { status: 200 });
  };

  const result = await new SelfActionService(store as any, fetchImpl as any).runOnce('background');

  assert.equal(result.ran, false);
  assert.equal(result.reason, 'legacy_self_action_search_removed');
  assert.ok(result.actionId?.startsWith('digital_action_'));
  assert.deepEqual(calls, ['evaluate']);
});

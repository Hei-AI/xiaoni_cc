import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentLoopService } from '../services/agent-loop-service';

function fixture() {
  const queued = new Map<string, any>();
  let sleeping = false;
  let wake = '2026-10-28T00:00:00.000Z';
  const store = {
    getActiveAgentRecoverySession: async () => sleeping ? { id: 'sleep' } : null,
    enqueueQueueMessage: async ({ message, payload }: any) => {
      const created = !queued.has(message.dedupeKey);
      if (created) queued.set(message.dedupeKey, { message, payload });
      return { created };
    }
  };
  const service: any = new AgentLoopService(store as any);
  service.getCurrentRuntimeEnergyState = async () => ({
    energy: 0, maxEnergy: 100, lastWakeAt: wake, recentSleepSessions: []
  });
  service.resolveEffectiveEnergyPolicy = async () => ({ policy: {} });
  return { service, store, queued, setSleeping: (value: boolean) => { sleeping = value; },
    setWake: (value: string) => { wake = value; } };
}

test('rest available is one-shot per wake, including later settles and service replacement', async () => {
  const f = fixture();
  const now = new Date('2026-10-29T12:00:00.000Z');
  assert.equal(await f.service.maybeEnqueueRestAvailableNotify({} as any, now), 'enqueued');
  assert.equal(await f.service.maybeEnqueueRestAvailableNotify({} as any, new Date(now.getTime() + 60000)), 'skipped_duplicate');
  assert.equal(f.queued.size, 1);
  const restarted: any = new AgentLoopService(f.store as any);
  restarted.getCurrentRuntimeEnergyState = f.service.getCurrentRuntimeEnergyState;
  restarted.resolveEffectiveEnergyPolicy = f.service.resolveEffectiveEnergyPolicy;
  assert.equal(await restarted.maybeEnqueueRestAvailableNotify({} as any, now), 'skipped_duplicate');
  const row: any = [...f.queued.values()][0];
  assert.ok(!row.message.dedupeKey.startsWith('lw:'), 'claim must not rotate the dedupe key');
  assert.ok(row.payload.systemReminder.reminder.includes('身体现在接受主动休息'));
  f.setWake('2026-10-29T00:00:00.000Z');
  assert.equal(await f.service.maybeEnqueueRestAvailableNotify({} as any, now), 'enqueued');
  assert.equal(f.queued.size, 2);
});

test('sleeping agent receives no rest-available notification', async () => {
  const f = fixture(); f.setSleeping(true);
  assert.equal(await f.service.maybeEnqueueRestAvailableNotify({} as any, new Date('2026-10-29T12:00:00.000Z')), 'skipped_sleeping');
  assert.equal(f.queued.size, 0);
});

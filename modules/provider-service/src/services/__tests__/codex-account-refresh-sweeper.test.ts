import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexAccountRefreshSweeper } from '../codex-account-refresh-sweeper';

test('CodexAccountRefreshSweeper refreshes each account returned by the manager', async () => {
  const refreshed: string[] = [];
  const sweeper = new CodexAccountRefreshSweeper({
    manager: {
      async listAccountsNeedingRefresh() {
        return [
          { id: 'acct-1', accountId: 'provider-1' },
          { id: 'acct-2', accountId: 'provider-2' }
        ];
      },
      async refreshAccount(id: string) {
        refreshed.push(id);
        return {};
      }
    } as any,
    enabled: true,
    intervalMs: 60_000,
    refreshThresholdMs: 30 * 60 * 1000
  });

  const result = await sweeper.runOnce('startup');

  assert.deepEqual(refreshed, ['acct-1', 'acct-2']);
  assert.equal(result.skipped, false);
  assert.equal(result.refreshed, 2);
  assert.equal(result.failed, 0);
});

test('CodexAccountRefreshSweeper skips overlapping sweeps', async () => {
  let release!: () => void;
  const blocking = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sweeper = new CodexAccountRefreshSweeper({
    manager: {
      async listAccountsNeedingRefresh() {
        return [{ id: 'acct-1', accountId: 'provider-1' }];
      },
      async refreshAccount() {
        await blocking;
        return {};
      }
    } as any,
    enabled: true,
    intervalMs: 60_000,
    refreshThresholdMs: 30 * 60 * 1000
  });

  const firstRun = sweeper.runOnce('startup');
  const skippedRun = await sweeper.runOnce('interval');
  release();
  await firstRun;

  assert.equal(skippedRun.skipped, true);
  assert.equal(skippedRun.skipReason, 'already-running');
});

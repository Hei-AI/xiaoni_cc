import { logger } from '../utils/logger';
import { CodexAccountManager } from './codex-account-manager';

type SweepReason = 'startup' | 'interval';

type CodexAccountRefreshSweeperOptions = {
  manager: CodexAccountManager;
  enabled: boolean;
  intervalMs: number;
  refreshThresholdMs: number;
};

const moduleLogger = logger.createModuleLogger('codex-account-refresh-sweeper');

export class CodexAccountRefreshSweeper {
  private readonly manager: CodexAccountManager;
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly refreshThresholdMs: number;
  private intervalHandle: NodeJS.Timeout | null = null;
  private running = false;

  constructor(options: CodexAccountRefreshSweeperOptions) {
    this.manager = options.manager;
    this.enabled = options.enabled;
    this.intervalMs = options.intervalMs;
    this.refreshThresholdMs = options.refreshThresholdMs;
  }

  start() {
    if (!this.enabled || this.intervalHandle) {
      return;
    }

    void this.runOnce('startup');
    this.intervalHandle = setInterval(() => {
      void this.runOnce('interval');
    }, this.intervalMs);
  }

  async stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async runOnce(reason: SweepReason) {
    if (!this.enabled) {
      return { reason, skipped: true, skipReason: 'disabled', refreshed: 0, failed: 0 };
    }

    if (this.running) {
      moduleLogger.info('Skipping Codex account refresh sweep because a previous sweep is still running', {
        reason
      });
      return { reason, skipped: true, skipReason: 'already-running', refreshed: 0, failed: 0 };
    }

    this.running = true;
    try {
      const candidates = await this.manager.listAccountsNeedingRefresh({
        refreshThresholdMs: this.refreshThresholdMs
      });

      moduleLogger.info('Starting Codex account refresh sweep', {
        reason,
        candidates: candidates.length,
        refreshThresholdMs: this.refreshThresholdMs
      });

      let refreshed = 0;
      let failed = 0;
      for (const account of candidates) {
        try {
          await this.manager.refreshAccount(account.id, {
            trigger: 'background-sweep'
          });
          refreshed += 1;
        } catch (error) {
          failed += 1;
          moduleLogger.warn('Codex account refresh sweep failed for account', {
            reason,
            accountId: account.id,
            providerAccountId: account.accountId || null,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      moduleLogger.info('Completed Codex account refresh sweep', {
        reason,
        candidates: candidates.length,
        refreshed,
        failed
      });

      return { reason, skipped: false, refreshed, failed };
    } finally {
      this.running = false;
    }
  }
}

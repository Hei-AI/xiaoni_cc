import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { RuntimeStore } from './runtime-store';

export type SelfActionRunResult = {
  ran: boolean;
  reason: string;
  actionId?: string;
  shareItemId?: number | null;
};

const moduleLogger = logger.createModuleLogger('self-action-service');
const LEGACY_SELF_ACTION_SEARCH_REMOVED_REASON = 'legacy_self_action_search_removed';

export class SelfActionService {
  constructor(
    private readonly store: RuntimeStore,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async runOnce(surface = 'background'): Promise<SelfActionRunResult> {
    const eligibility = await this.store.evaluateSelfActionEligibility(surface);
    if (!eligibility.eligible) {
      return { ran: false, reason: eligibility.reason };
    }

    const actionId = `digital_action_${Date.now()}_${uuidv4().slice(0, 8)}`;
    void this.fetchImpl;
    moduleLogger.info('Legacy self-action web search skipped', {
      action_id: actionId,
      surface,
      reason: LEGACY_SELF_ACTION_SEARCH_REMOVED_REASON
    });
    return { ran: false, reason: LEGACY_SELF_ACTION_SEARCH_REMOVED_REASON, actionId };
  }
}

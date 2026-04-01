import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatPolicyService } from '../chat-policy-service';

test('auto reply is disabled at runtime when the prompt binding is missing', async () => {
  // Regression: ISSUE-001 — stale rows rendered auto reply as enabled without a prompt binding
  // Found by /qa on 2026-04-01
  // Report: .gstack/qa-reports/qa-report-127.0.0.1-2026-04-01.md
  const service = new ChatPolicyService();
  (service as any).prisma = {
    privateChatSetting: {
      findUnique: async () => ({
        is_enabled: 1,
        continuous_learning_enabled: 1,
        auto_reply_enabled: 1,
        agent_prompt_id: null
      })
    }
  };

  const state = await service.getPolicyState({
    messageType: 'private',
    userId: 999999991
  });

  assert.deepEqual(state, {
    exists: true,
    isEnabled: true,
    continuousLearningEnabled: true,
    autoReplyEnabled: false
  });
});

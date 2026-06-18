import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatPolicyService } from '../chat-policy-service';

test('auto reply follows the runtime toggle without requiring deprecated prompt bindings', async () => {
  // Per-chat prompt bindings are retired; admin and provider runtime must agree.
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
    continuousLearningEnabled: false,
    autoReplyEnabled: true,
    notificationMode: 'all'
  });
});

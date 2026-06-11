import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatPolicyService } from '../chat-policy-service';

test('policy state treats receive as the hard parent switch', async () => {
  const service = new ChatPolicyService();
  (service as any).prisma = {
    groupChatSetting: {
      findUnique: async () => ({
        is_enabled: 0,
        continuous_learning_enabled: 1,
        auto_reply_enabled: 1,
        agent_prompt_id: null
      })
    }
  };

  const state = await service.getPolicyState({
    messageType: 'group',
    userId: 20001,
    groupId: 100
  });

  assert.deepEqual(state, {
    exists: true,
    isEnabled: false,
    continuousLearningEnabled: false,
    autoReplyEnabled: false
  });
});

test('missing policy rows keep IM entry and internal delivery enabled by default', async () => {
  const service = new ChatPolicyService();
  (service as any).prisma = {
    privateChatSetting: {
      findUnique: async () => null
    }
  };

  const state = await service.getPolicyState({
    messageType: 'private',
    userId: 20001
  });

  assert.deepEqual(state, {
    exists: false,
    isEnabled: true,
    continuousLearningEnabled: false,
    autoReplyEnabled: true
  });
});

test('policy state allows group auto reply without a prompt binding', async () => {
  const service = new ChatPolicyService();
  (service as any).prisma = {
    groupChatSetting: {
      findUnique: async () => ({
        is_enabled: 1,
        continuous_learning_enabled: 1,
        auto_reply_enabled: 1,
        agent_prompt_id: null
      })
    }
  };

  const state = await service.getPolicyState({
    messageType: 'group',
    userId: 20001,
    groupId: 100
  });

  assert.deepEqual(state, {
    exists: true,
    isEnabled: true,
    continuousLearningEnabled: false,
    autoReplyEnabled: true
  });
});

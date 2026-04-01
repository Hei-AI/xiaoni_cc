import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationStoreService } from '../conversation-store-service';

test('listRecentTurns falls back to raw_request source ids for inbound-only materialized rows', async () => {
  const service = new ConversationStoreService();
  (service as any).sql = {
    query: async (query: string) => {
      if (query.includes('FROM conversations')) {
        return [{
          id: 11,
          user_id: 20001,
          group_id: 100,
          user_message: 'hello',
          ai_response: null,
          timestamp: new Date().toISOString(),
          response_time: 0,
          status: 'received',
          error_reason: null,
          model_name: null,
          raw_request: {
            source_message_ids: [9001],
            source_message_sids: ['sid-9001']
          },
          raw_response: {},
          trace_id: 'trace-1'
        }];
      }
      if (query.includes('FROM agent_queue_messages')) {
        return [];
      }
      throw new Error(`Unexpected query: ${query}`);
    },
    close: async () => undefined
  };

  const turns = await service.listRecentTurns({
    userId: 20001,
    groupId: 100
  });

  assert.equal(turns.length, 1);
  assert.deepEqual(turns[0]?.source_message_ids, [9001]);
  assert.deepEqual(turns[0]?.source_message_sids, ['sid-9001']);
});

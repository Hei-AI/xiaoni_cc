import test from 'node:test';
import assert from 'node:assert/strict';
import TopicProjectionExecutorService from '../topic-projection-executor-service';
import type { TopicProjectionInputBundle } from '../topic-projection-service';

function buildBundle(): TopicProjectionInputBundle {
  return {
    chat_space_type: 'group',
    chat_space_id: 123,
    session_key: 'qq:group:123',
    trigger_type: 'compact_checkpoint',
    model_name: 'gemini-test',
    captured_at: '2026-04-02T14:00:00.000Z',
    summary_text: '群里最近在玩梗',
    transcript_compact_offset: 6,
    estimated_input_tokens: 800,
    turns: [
      {
        conversation_id: 11,
        user_id: 20001,
        group_id: 123,
        user_message: '今天继续那个奶茶梗',
        ai_response: null,
        timestamp: '2026-04-02T10:00:00.000Z',
        source_message_ids: [1001],
        source_message_sids: ['sid-1001']
      },
      {
        conversation_id: 12,
        user_id: 20002,
        group_id: 123,
        user_message: '我又接上了',
        ai_response: '哈哈',
        timestamp: '2026-04-02T10:01:00.000Z',
        source_message_ids: [1002],
        source_message_sids: ['sid-1002']
      }
    ],
    ledger_events: [
      {
        id: 501,
        group_id: 123,
        target_user_id: 20002,
        session_key: 'qq:group:123',
        event_type: 'shared_joke_formed',
        event_weight: 0.8,
        confidence: 'high',
        source_message_ids: [1001, 1002],
        source_excerpt: '奶茶梗又被复用',
        metadata: { keyword: '奶茶' },
        created_at: '2026-04-02T10:02:00.000Z',
        last_reinforced_at: '2026-04-02T10:02:00.000Z'
      }
    ]
  };
}

test('parseTopics normalizes topic drafts and relationship projections', () => {
  const service = new TopicProjectionExecutorService({
    modelName: 'gemini-test'
  });

  const topics = service.parseTopics(JSON.stringify({
    topics: [
      {
        title: '奶茶梗续上了',
        summary_text: '群里继续复用奶茶梗，小腻和 20002 接话顺畅。',
        lifecycle_state: 'active',
        review_priority_score: 0.9,
        heat_score: 0.7,
        participant_ids: [20001, 20002],
        topic_keywords: ['奶茶', '接话'],
        evidence_message_ids: [1001, 1002],
        source_event_ids: [501],
        relationships: [
          {
            target_user_id: 20002,
            relationship_kind: 'inside_joke',
            summary_text: '小腻和 20002 在奶茶梗上形成稳定接话。',
            actors: ['小腻', '20002'],
            source_event_ids: [501],
            source_message_ids: [1001, 1002]
          }
        ]
      }
    ]
  }), buildBundle());

  assert.equal(topics.length, 1);
  assert.equal(topics[0]?.title, '奶茶梗续上了');
  assert.deepEqual(topics[0]?.participant_ids, [20001, 20002]);
  assert.equal(topics[0]?.relationships.length, 1);
  assert.equal(topics[0]?.relationships[0]?.target_user_id, 20002);
});

test('executePersistedJob materializes candidate topic versions from persisted bundles', async () => {
  const snapshotCalls: any[] = [];
  const topicUpdates: any[] = [];
  const jobUpdates: any[] = [];
  const provider = {
    async generateContent(input: any) {
      assert.equal(input.request.tool_choice, 'required');
      assert.equal(input.request.parallel_tool_calls, false);
      assert.equal(input.request.tools?.[0]?.function?.name, 'emit_topic_projection');
      return {
        modelName: 'gemini-test',
        provider: 'gemini',
        text: '',
        response: {
          output: [
            {
              type: 'function_call',
              name: 'emit_topic_projection',
              arguments: JSON.stringify({
                topics: [
                  {
                    title: '奶茶梗续上了',
                    summary_text: '群里继续复用奶茶梗，小腻和 20002 接话顺畅。',
                    lifecycle_state: 'active',
                    review_priority_score: 0.9,
                    heat_score: 0.7,
                    participant_ids: [20001, 20002],
                    topic_keywords: ['奶茶', '接话'],
                    evidence_message_ids: [1001, 1002],
                    source_event_ids: [501],
                    relationships: [
                      {
                        target_user_id: 20002,
                        relationship_kind: 'inside_joke',
                        summary_text: '小腻和 20002 在奶茶梗上形成稳定接话。',
                        actors: ['小腻', '20002'],
                        source_event_ids: [501],
                        source_message_ids: [1001, 1002]
                      }
                    ]
                  }
                ]
              })
            }
          ]
        }
      };
    }
  };
  const service = new TopicProjectionExecutorService({
    modelName: 'gemini-test',
    llmProviderFactory: () => provider as any,
    now: () => new Date('2026-04-02T14:10:00.000Z').getTime(),
    getJob: async () => ({
      id: 88,
      input_bundle_hash: 'bundle-hash-88',
      input_bundle_json: buildBundle(),
      metadata: {}
    }) as any,
    updateJob: async (id: any, updates: any) => {
      jobUpdates.push({ id, updates });
      return { id, ...updates } as any;
    },
    listTopics: async () => [],
    createTopic: async (input: any) => ({ id: 901, ...input }) as any,
    updateTopic: async (id: any, updates: any) => {
      topicUpdates.push({ id, updates });
      return { id, ...updates } as any;
    },
    listVersions: async () => [],
    createVersionSnapshot: async (input: any) => {
      snapshotCalls.push(input);
      return { id: 501, ...input } as any;
    }
  });

  const result = await service.executePersistedJob({ jobId: 88 });

  assert.equal(result.topics.length, 1);
  assert.deepEqual(result.createdVersionIds, [501]);
  assert.deepEqual(result.touchedTopicIds, [901]);
  assert.equal(snapshotCalls.length, 1);
  assert.equal(snapshotCalls[0]?.topicId, 901);
  assert.equal(snapshotCalls[0]?.status, 'candidate');
  assert.equal(snapshotCalls[0]?.relationships.length, 1);
  assert.equal(snapshotCalls[0]?.evidence.length, 3);
  assert.equal(topicUpdates[0]?.updates.currentCandidateVersionId, 501);
  assert.equal(jobUpdates[0]?.updates.status, 'running');
  assert.equal(jobUpdates[jobUpdates.length - 1]?.updates.status, 'succeeded');
});

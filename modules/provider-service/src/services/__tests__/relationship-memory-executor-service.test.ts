import test from 'node:test';
import assert from 'node:assert/strict';
import RelationshipMemoryExecutorService from '../relationship-memory-executor-service';

function buildPayload() {
  return {
    job_id: 7,
    session_key: 'group:100',
    group_id: 100,
    version: 2,
    trigger_reason: 'compact_checkpoint',
    summary_text: '前面几轮一直围绕奶茶圣经这个梗在来回接。',
    transcript_compact_offset: 6,
    compact_role: 'bridge_material',
    turns: [
      {
        id: 101,
        source_message_ids: [1001],
        user_id: 20001,
        group_id: 100,
        user_message: '昨天那个梗太离谱了',
        ai_response: null,
        timestamp: '2026-03-31T10:00:00.000Z',
        response_time: 0,
        status: null,
        error_reason: null,
        model_name: null,
        raw_request: {},
        raw_response: {},
        trace_id: null
      },
      {
        id: 102,
        source_message_ids: [1002],
        user_id: 20002,
        group_id: 100,
        user_message: '你又提奶茶圣经',
        ai_response: null,
        timestamp: '2026-03-31T10:01:00.000Z',
        response_time: 0,
        status: null,
        error_reason: null,
        model_name: null,
        raw_request: {},
        raw_response: {},
        trace_id: null
      }
    ],
    ledger_events: [
      {
        id: 501,
        group_id: 100,
        target_user_id: 20002,
        event_type: 'shared_joke_formed',
        source_message_ids: [1001, 1002],
        source_excerpt: '奶茶圣经',
        created_at: '2026-03-31T10:01:30.000Z'
      }
    ]
  };
}

test('parses structured relationship memory cards into runtime card format', () => {
  const service = new RelationshipMemoryExecutorService({
    now: () => Date.parse('2026-03-31T12:00:00.000Z')
  });

  const cards = service.parseCards(JSON.stringify({
    group_cards: [
      {
        actors: ['20001', '20002'],
        context_before: '群里已经在拿奶茶圣经互相打趣',
        trigger: '20002 再次提到奶茶圣经',
        interaction: '大家顺着这个梗继续接话',
        outcome: '这个梗已经成了群公共梗',
        evidence_message_ids: [1001, 1002],
        summary_text: '群里已经把奶茶圣经当成公共梗了'
      }
    ],
    person_cards: [
      {
        target_user_id: 20002,
        actors: ['小腻', '20002'],
        context_before: '20002 经常能接住前一天留下的梗',
        trigger: '20002 再次把奶茶圣经翻出来',
        interaction: '这次话题被顺利续上',
        outcome: '和 20002 的共享梗更稳了',
        evidence_message_ids: [1001, 1002],
        summary_text: '和 20002 已经形成奶茶圣经这个共享梗'
      }
    ]
  }), buildPayload() as any);

  assert.equal(cards.length, 2);
  assert.equal(cards[0]?.card_type, 'group_memory');
  assert.equal(cards[1]?.card_type, 'person_memory');
  assert.equal(cards[1]?.target_user_id, 20002);
  assert.deepEqual(cards[1]?.source_event_ids, [501]);
  assert.equal(cards[1]?.decayed_score, cards[1]?.importance_score);
});

test('execute delegates to llm provider and validates JSON response', async () => {
  const calls: any[] = [];
  const service = new RelationshipMemoryExecutorService({
    llmProviderFactory: () => ({
      id: 'google-gemini-cli',
      generateText: async () => {
        throw new Error('not used');
      },
      generateContent: async (input: any) => {
        calls.push(input);
        return {
          provider: 'google-gemini-cli',
          modelName: 'gemini-2.5-flash',
          text: '',
          response: {
            output: [
              {
                type: 'function_call',
                name: 'emit_relationship_memory_cards',
                arguments: JSON.stringify({
                  group_cards: [],
                  person_cards: [
                    {
                      target_user_id: 20002,
                      actors: ['小腻', '20002'],
                      context_before: '已经有连续两次接梗',
                      trigger: '这次再次主动提旧梗',
                      interaction: '群里顺着这个话头续上了',
                      outcome: '关系卡被强化',
                      evidence_message_ids: [1001, 1002],
                      summary_text: '和 20002 的旧梗继续被强化'
                    }
                  ]
                })
              }
            ]
          } as any,
          rawResponse: {},
          canonicalRequest: input.request,
          wireRequest: {},
          canonicalResponse: {} as any,
          wireResponse: {},
          requestFormatVersion: 'test',
          wireProviderFormat: 'test',
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            processingTimeMs: 1
          }
        };
      }
    }) as any
  });

  const result = await service.execute(buildPayload() as any);

  assert.equal(calls.length, 1);
  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0]?.target_user_id, 20002);
  assert.equal(calls[0]?.request?.tool_choice, 'required');
  assert.equal(calls[0]?.request?.parallel_tool_calls, false);
  assert.equal(calls[0]?.request?.tools?.[0]?.function?.name, 'emit_relationship_memory_cards');
  assert.match(String(calls[0]?.request?.instructions), /回复时能直接消费的 cue/);
  assert.match(String(calls[0]?.request?.instructions), /不要写成长篇人物小传、人物简介或抽象总结/);
  assert.match(String(calls[0]?.request?.instructions), /thread digest/);
  assert.match(String(calls[0]?.request?.instructions), /reply-time person cue/);
  assert.match(String(calls[0]?.request?.instructions), /reply-coach 风格/);
  assert.match(String(calls[0]?.request?.instructions), /compact 生成的桥接材料/);
  assert.match(String(calls[0]?.request?.instructions), /emit_relationship_memory_cards/);
  assert.match(String(calls[0]?.request?.input?.[0]?.content || ''), /"compact_role": "bridge_material"/);
});

test('execute filters placeholder-only ledger events before prompting the model', async () => {
  const calls: any[] = [];
  const service = new RelationshipMemoryExecutorService({
    llmProviderFactory: () => ({
      id: 'google-gemini-cli',
      generateText: async () => {
        throw new Error('not used');
      },
      generateContent: async (input: any) => {
        calls.push(input);
        return {
          provider: 'google-gemini-cli',
          modelName: 'gemini-2.5-flash',
          text: JSON.stringify({ group_cards: [], person_cards: [] }),
          response: {} as any,
          rawResponse: {},
          canonicalRequest: input.request,
          wireRequest: {},
          canonicalResponse: {} as any,
          wireResponse: {},
          requestFormatVersion: 'test',
          wireProviderFormat: 'test',
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            processingTimeMs: 1
          }
        };
      }
    }) as any
  });

  const payload = buildPayload() as any;
  payload.ledger_events = [
    {
      id: 600,
      group_id: 100,
      target_user_id: 20002,
      event_type: 'topic_reactivated',
      source_message_ids: [1001],
      source_excerpt: '旧话题关键词延续: [Image]',
      metadata: { keyword: '[Image]' },
      created_at: '2026-03-31T10:02:00.000Z'
    },
    ...payload.ledger_events
  ];

  await service.execute(payload);

  const content = String(calls[0]?.request?.input?.[0]?.content || '');
  assert.match(content, /奶茶圣经/);
  assert.doesNotMatch(content, /\[Image\]/);
});

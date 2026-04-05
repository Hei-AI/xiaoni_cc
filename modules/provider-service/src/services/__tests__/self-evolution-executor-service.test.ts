import test from 'node:test';
import assert from 'node:assert/strict';
import SelfEvolutionExecutorService from '../self-evolution-executor-service';

function buildPayload() {
  return {
    job_id: 9,
    session_key: 'qq:group:253631878',
    group_id: 253631878,
    target_user_id: 714457117,
    version: 1,
    trigger_reason: 'compact_checkpoint',
    summary_text: '最近深夜被点名时，小腻都更像短句露头而不是长解释。',
    transcript_compact_offset: 6,
    compact_role: 'bridge_material',
    turns: [
      {
        id: 101,
        source_message_ids: [1001],
        user_id: 714457117,
        group_id: 253631878,
        user_message: '小腻你活了？',
        ai_response: null,
        timestamp: '2026-04-03T00:01:00.000Z',
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
        group_id: 253631878,
        target_user_id: 714457117,
        event_type: 'reply_chain_success',
        source_message_ids: [1001],
        source_excerpt: '深夜被点名后自然露头',
        created_at: '2026-04-03T00:01:02.000Z'
      }
    ]
  };
}

test('parses structured self evolution states into persistence shape', () => {
  const service = new SelfEvolutionExecutorService({
    now: () => Date.parse('2026-04-03T00:10:00.000Z')
  });

  const states = service.parseStates(JSON.stringify({
    states: [
      {
        scope_type: 'relation_self',
        target_user_id: 714457117,
        social_presence_baseline: 'light',
        entry_preference: 'cue_first',
        warmth_bias: 'warm_light',
        familiarity_ceiling: 'warm_not_performative',
        topic_resonance: ['late_night_ping'],
        boundary_tendencies: { avoid_overexplaining: true },
        reinforced_modes: ['just_surfaced_relaxed'],
        suppressed_modes: ['performative_explainer'],
        source_event_ids: [501],
        source_message_ids: [1001],
        summary_text: '和 714457117 的深夜点名互动会让小腻更自然地短句露头。'
      }
    ]
  }));

  assert.equal(states.length, 1);
  assert.equal(states[0]?.scope_type, 'relation_self');
  assert.equal(states[0]?.target_user_id, 714457117);
  assert.deepEqual(states[0]?.reinforced_modes, ['just_surfaced_relaxed']);
});

test('execute delegates to llm provider and validates self-evolution prompt', async () => {
  const calls: any[] = [];
  const service = new SelfEvolutionExecutorService({
    llmProviderFactory: () => ({
      id: 'google-gemini-cli',
      generateText: async () => {
        throw new Error('not used');
      },
      generateContent: async (input: any) => {
        calls.push(input);
        return {
          provider: 'google-gemini-cli',
          modelName: 'gpt-5.4',
          text: '',
          response: {
            output: [
              {
                type: 'function_call',
                name: 'emit_self_evolution_states',
                arguments: JSON.stringify({
                  states: [
                    {
                      scope_type: 'relation_self',
                      target_user_id: 714457117,
                      social_presence_baseline: 'light',
                      entry_preference: 'cue_first',
                      warmth_bias: 'warm_light',
                      familiarity_ceiling: 'warm_not_performative',
                      topic_resonance: ['late_night_ping'],
                      boundary_tendencies: { avoid_overexplaining: true },
                      reinforced_modes: ['just_surfaced_relaxed'],
                      suppressed_modes: ['performative_explainer'],
                      source_event_ids: [501],
                      source_message_ids: [1001],
                      summary_text: '和 714457117 的深夜点名互动会让小腻更自然地短句露头。'
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
  assert.equal(result.states.length, 1);
  assert.equal(calls[0]?.request?.tool_choice, 'required');
  assert.equal(calls[0]?.request?.parallel_tool_calls, false);
  assert.equal(calls[0]?.request?.tools?.[0]?.function?.name, 'emit_self_evolution_states');
  assert.match(String(calls[0]?.request?.instructions), /长期 self evolution state/);
  assert.match(String(calls[0]?.request?.instructions), /不要写人物简介/);
  assert.match(String(calls[0]?.request?.instructions), /被经历改变/);
  assert.match(String(calls[0]?.request?.instructions), /compact 生成的桥接材料/);
  assert.match(String(calls[0]?.request?.instructions), /emit_self_evolution_states/);
  assert.match(String(calls[0]?.request?.input?.[0]?.content || ''), /"compact_role": "bridge_material"/);
  assert.equal(calls[0]?.providerConfig?.performance?.timeout, 90000);
});

test('execute falls back to heuristic states when model returns empty json payload', async () => {
  const service = new SelfEvolutionExecutorService({
    llmProviderFactory: () => ({
      id: 'codex',
      generateText: async () => {
        throw new Error('not used');
      },
      generateContent: async () => ({
        provider: 'codex',
        modelName: 'gpt-5.4',
        text: JSON.stringify({ states: [] }),
        response: {} as any,
        rawResponse: {},
        canonicalRequest: {},
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
      })
    }) as any
  });

  const result = await service.execute(buildPayload() as any);

  assert.ok(result.states.length >= 1);
  assert.match(result.states[0]?.summary_text || '', /最近|互动|露头/);
  assert.ok((result.states[0]?.entry_preference || '').length <= 32);
});

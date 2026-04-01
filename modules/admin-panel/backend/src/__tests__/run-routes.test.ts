import express from 'express';
import request from 'supertest';
import winston from 'winston';
import { createRunRoutes } from '../routes/run-routes';

jest.mock('@qq-bot/persistence', () => ({
  getRelationshipMemoryCardById: jest.fn(async () => ({
    id: 42
  })),
  listRelationshipMemoryJobs: jest.fn(async () => []),
  listRelationshipMemoryCards: jest.fn(async () => []),
  listRelationshipMemoryOverrides: jest.fn(async () => []),
  listRelationshipLedgerEventsByIds: jest.fn(async () => []),
  listConversationItemsByIds: jest.fn(async () => []),
  deleteRelationshipMemoryOverride: jest.fn(async (id: any) => ({
    id
  })),
  recordRelationshipMemoryOverride: jest.fn(async (input: any) => ({
    id: 9001,
    card_id: input.cardId,
    action_type: input.actionType,
    manual_note: input.manualNote,
    created_by: input.createdBy
  }))
}));

function createLogger(): winston.Logger {
  return winston.createLogger({ silent: true });
}

function createDatabaseMock() {
  return {
    executeQuery: jest.fn()
  };
}

function createApp(database: ReturnType<typeof createDatabaseMock>) {
  const app = express();
  app.use(express.json());
  app.use('/api', createRunRoutes(database as never, createLogger()));
  return app;
}

describe('run routes', () => {
  it('lists conversation items for a session in timeline order', async () => {
    const database = createDatabaseMock();
    database.executeQuery.mockResolvedValueOnce([{
      id: 9001,
      session_key: 'qq:group:123',
      role: 'user',
      phase: 'inbound',
      source: 'napcat',
      trace_id: 'trace-1',
      run_id: 'run-1',
      group_index: 3,
      item_index: 1,
      content: '第一句',
      created_at: '2026-04-01T01:00:00.000Z'
    }, {
      id: 9002,
      session_key: 'qq:group:123',
      role: 'assistant',
      phase: 'outbound',
      source: 'agent',
      trace_id: 'trace-1',
      run_id: 'run-1',
      group_index: 3,
      item_index: 2,
      content: '第二句',
      created_at: '2026-04-01T01:00:01.000Z'
    }]);

    const response = await request(createApp(database))
      .get('/api/runs/sessions/qq%3Agroup%3A123/conversation-items?limit=50');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(database.executeQuery).toHaveBeenCalledWith(expect.stringContaining('FROM conversation_items'), ['qq:group:123', 50]);
    expect(response.body.data).toEqual([{
      id: 9001,
      session_key: 'qq:group:123',
      role: 'user',
      phase: 'inbound',
      source: 'napcat',
      trace_id: 'trace-1',
      run_id: 'run-1',
      group_index: 3,
      item_index: 1,
      content: '第一句',
      created_at: '2026-04-01T01:00:00.000Z'
    }, {
      id: 9002,
      session_key: 'qq:group:123',
      role: 'assistant',
      phase: 'outbound',
      source: 'agent',
      trace_id: 'trace-1',
      run_id: 'run-1',
      group_index: 3,
      item_index: 2,
      content: '第二句',
      created_at: '2026-04-01T01:00:01.000Z'
    }]);
  });

  it('rejects overrides for missing relationship memory cards', async () => {
    const database = createDatabaseMock();
    const persistence = jest.requireMock('@qq-bot/persistence');
    persistence.getRelationshipMemoryCardById.mockResolvedValueOnce(null);

    const response = await request(createApp(database))
      .post('/api/runs/relationship-memory/cards/999999/overrides')
      .send({
        action_type: 'pin'
      });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('Relationship memory card not found');
  });

  it('dedupes repeated relationship memory overrides for the same action', async () => {
    const database = createDatabaseMock();
    const persistence = jest.requireMock('@qq-bot/persistence');
    persistence.listRelationshipMemoryOverrides.mockResolvedValueOnce([{
      id: 77,
      card_id: 42,
      action_type: 'pin',
      manual_note: null,
      created_by: 'admin-panel'
    }]);

    const response = await request(createApp(database))
      .post('/api/runs/relationship-memory/cards/42/overrides')
      .send({
        action_type: 'pin'
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toBe(77);
    expect(response.body.data.action_type).toBe('pin');
    expect(response.body.data.deduped).toBe(true);
  });

  it('returns evidence details for relationship memory cards', async () => {
    const database = createDatabaseMock();
    const persistence = jest.requireMock('@qq-bot/persistence');
    persistence.listRelationshipMemoryJobs.mockResolvedValueOnce([{
      id: 11,
      session_key: 'group:123',
      status: 'succeeded',
      ledger_event_count: 2,
      updated_at: '2026-04-01T01:00:00.000Z',
      created_at: '2026-04-01T00:59:00.000Z'
    }]);
    persistence.listRelationshipMemoryCards.mockResolvedValueOnce([{
      id: 42,
      card_type: 'person',
      group_id: 123,
      target_user_id: 456,
      version: 2,
      summary_text: '他和小腻已经形成固定接梗方式',
      actors: ['小腻', 'liahua'],
      source_event_ids: [701],
      source_message_ids: [8001, 8002],
      decayed_score: 0.83,
      metadata: {}
    }]);
    persistence.listRelationshipMemoryOverrides.mockResolvedValueOnce([]);
    persistence.listRelationshipLedgerEventsByIds.mockResolvedValueOnce([{
      id: 701,
      event_type: 'shared_joke_formed',
      session_key: 'group:123',
      target_user_id: 456,
      source_message_ids: [8001, 8002],
      source_excerpt: 'liahua 先起头，小腻马上接住同一个梗，然后群里继续顺着笑。',
      event_weight: 0.9,
      confidence: 'high',
      created_at: '2026-04-01T00:58:00.000Z',
      metadata: {}
    }]);
    persistence.listConversationItemsByIds.mockResolvedValueOnce([{
      id: 8001,
      session_key: 'qq:group:123',
      role: 'user',
      phase: 'inbound',
      source: 'napcat',
      content: '你又开始拿昨天那个梗说事了',
      group_index: 4,
      item_index: 1,
      created_at: '2026-04-01T00:57:00.000Z'
    }, {
      id: 8002,
      session_key: 'qq:group:123',
      role: 'assistant',
      phase: 'outbound',
      source: 'agent',
      content: '那不是你们先提的吗，我只是顺着接',
      group_index: 4,
      item_index: 2,
      created_at: '2026-04-01T00:57:05.000Z'
    }]);

    const response = await request(createApp(database))
      .get('/api/runs/sessions/qq%3Agroup%3A123/relationship-memory');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.person_cards[0].evidence_events).toEqual([{
      id: 701,
      event_type: 'shared_joke_formed',
      session_key: 'group:123',
      target_user_id: 456,
      source_message_ids: [8001, 8002],
      source_excerpt: 'liahua 先起头，小腻马上接住同一个梗，然后群里继续顺着笑。',
      event_weight: 0.9,
      confidence: 'high',
      created_at: '2026-04-01T00:58:00.000Z',
      last_reinforced_at: null,
      metadata: {}
    }]);
    expect(response.body.data.person_cards[0].evidence_messages).toEqual([{
      id: 8001,
      session_key: 'qq:group:123',
      role: 'user',
      phase: 'inbound',
      source: 'napcat',
      trace_id: null,
      run_id: null,
      group_index: 4,
      item_index: 1,
      content: '你又开始拿昨天那个梗说事了',
      created_at: '2026-04-01T00:57:00.000Z'
    }, {
      id: 8002,
      session_key: 'qq:group:123',
      role: 'assistant',
      phase: 'outbound',
      source: 'agent',
      trace_id: null,
      run_id: null,
      group_index: 4,
      item_index: 2,
      content: '那不是你们先提的吗，我只是顺着接',
      created_at: '2026-04-01T00:57:05.000Z'
    }]);
  });

  it('deletes relationship memory overrides by id', async () => {
    const database = createDatabaseMock();

    const response = await request(createApp(database))
      .delete('/api/runs/relationship-memory/overrides/9001');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toBe(9001);
  });

  it('creates relationship memory overrides for supported actions', async () => {
    const database = createDatabaseMock();

    const response = await request(createApp(database))
      .post('/api/runs/relationship-memory/cards/42/overrides')
      .send({
        action_type: 'pin',
        manual_note: 'keep this one'
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.card_id).toBe(42);
    expect(response.body.data.action_type).toBe('pin');
  });

  it('lists sessions that only have pre-run participation decisions', async () => {
    const database = createDatabaseMock();
    database.executeQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM all_sessions s') && sql.includes('ORDER BY s.sort_created_at DESC')) {
        expect(params).toEqual([30, 0]);
        return [{
          session_key: 'qq:group:67890',
          peer_name: 'group_67890',
          chat_type: 'group',
          latest_run_id: null,
          latest_status: 'pre_run_ignore',
          last_termination_reason: null,
          last_finish_reason: null,
          last_finish_outcome: null,
          last_no_reply: true,
          last_final_response: null,
          latest_started_at: '2026-03-31T13:45:00.000Z',
          latest_completed_at: '2026-03-31T13:45:00.000Z',
          latest_input_message_count: 1,
          latest_message_preview: '1',
          total_runs: 0,
          failed_runs: 0,
          no_reply_runs: 0
        }];
      }

      if (sql.includes('SELECT COUNT(*) AS total') && sql.includes('FROM all_sessions s')) {
        expect(params).toEqual([]);
        return [{ total: 1 }];
      }

      return [];
    });

    const response = await request(createApp(database)).get('/api/runs/sessions');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{
      session_key: 'qq:group:67890',
      peer_name: 'group_67890',
      chat_type: 'group',
      latest_run_id: null,
      latest_status: 'pre_run_ignore',
      last_termination_reason: null,
      last_finish_reason: null,
      last_finish_outcome: null,
      last_no_reply: true,
      last_final_response: null,
      latest_started_at: '2026-03-31T13:45:00.000Z',
      latest_completed_at: '2026-03-31T13:45:00.000Z',
      latest_input_message_count: 1,
      latest_message_preview: '1',
      total_runs: 0,
      failed_runs: 0,
      no_reply_runs: 0
    }]);
    expect(response.body.total).toBe(1);
  });

  it('returns participation-only events for ignored messages that never created a run', async () => {
    const database = createDatabaseMock();
    database.executeQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM timeline_events t")) {
        expect(params).toEqual(['qq:group:1042994150', 10]);
        return [{
          id: 1503,
          trace_id: 'sim_1774963986743_8b8200ad',
          event_time: '2026-03-31T13:33:06.833Z',
          metadata: JSON.stringify({
            decision: 'ignore',
            reason: 'low_signal',
            confidence: 'medium',
            conservative_fallback: false,
            used_embeddings: true,
            used_llm_judge: false,
            continuitySimilarity: 0,
            interestSimilarity: 0.879272623279608,
            recentInboundCount: 0,
            recentReplyCount: 0,
            cooldownRemainingMs: 0,
            path: 'score_deny',
            scores: {
              addressedness: 0,
              continuity: 0,
              socialPosition: 0.2,
              interest: 0.2975,
              timing: 1,
              valueAdd: 0.45,
              final: 0.17665
            }
          }),
          sender_id: '3375477814',
          sender_name: 'liahua',
          body_for_agent: '1',
          raw_body: '1',
          was_mentioned: 0
        }];
      }

      return [];
    });

    const response = await request(createApp(database)).get('/api/runs/sessions/qq%3Agroup%3A1042994150/participation-events');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{
      event_id: 1503,
      trace_id: 'sim_1774963986743_8b8200ad',
      event_time: '2026-03-31T13:33:06.833Z',
      decision: 'ignore',
      reason: 'low_signal',
      confidence: 'medium',
      conservative_fallback: false,
      used_embeddings: true,
      used_llm_judge: false,
      llm_judge_model: null,
      llm_judge_decision: null,
      llm_judge_confidence: null,
      llm_judge_reason: null,
      llm_judge_error: null,
      continuity_similarity: 0,
      interest_similarity: 0.879272623279608,
      scores: {
        addressedness: 0,
        continuity: 0,
        social_position: 0.2,
        interest: 0.2975,
        timing: 1,
        value_add: 0.45,
        final: 0.17665
      },
      recent_inbound_count: 0,
      recent_reply_count: 0,
      cooldown_remaining_ms: 0,
      path: 'score_deny',
      embedding_error: null,
      inbound: {
        sender_id: '3375477814',
        sender_name: 'liahua',
        body_for_agent: '1',
        raw_body: '1',
        was_mentioned: false
      }
    }]);
  });

  it('returns delivery state fields in run detail without inflating sent message counts', async () => {
    const database = createDatabaseMock();
    database.executeQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM agent_runs r')) {
        return [{
          id: 'run-1',
          batch_id: 'batch-1',
          trace_id: 'trace-1',
          conversation_id: 123,
          session_key: 'qq:group:101',
          chat_type: 'group',
          peer_id: '101',
          peer_name: 'Test Group',
          account_id: '303',
          reason_for_start: 'debounce_window_elapsed',
          input_message_count: 1,
          batch_summary: 'Alice: hi',
          status: 'completed',
          delivery_phase: 'finished',
          delivery_commit_count: 1,
          blocked_delivery_attempt_count: 1,
          last_blocked_delivery_reason: 'Outbound delivery already committed earlier in this run.',
          termination_reason: 'reply_sent',
          finish_reason: 'Outbound delivery already committed earlier in this run.',
          finish_outcome: 'blocked_transition',
          no_reply: false,
          final_response: '同一句话',
          error_message: null,
          total_turns: 2,
          started_at: '2026-03-31T10:00:00.000Z',
          completed_at: '2026-03-31T10:00:02.000Z',
          sent_messages: JSON.stringify(['同一句话'])
        }];
      }

      if (sql.includes('FROM agent_message_batch_items')) {
        return [{
          position: 1,
          queue_message_id: 1,
          input_trace_id: 'trace-input-1',
          message_sid: 'sid-1',
          sender_id: '202',
          sender_name: 'Alice',
          body_for_agent: 'hi',
          raw_payload: '{}',
          inbound_context: '{}',
          created_at: '2026-03-31T10:00:00.000Z',
          processing_started_at: '2026-03-31T10:00:00.100Z',
          completed_at: '2026-03-31T10:00:02.000Z'
        }];
      }

      if (sql.includes('FROM llm_call_logs')) {
        return [];
      }

      if (sql.includes('FROM tool_execution_logs')) {
        return [{
          id: 1,
          agent_turn: 2,
          tool_name: 'speak_in_group',
          method_id: 'speak_in_group',
          status: 'completed',
          error_message: null,
          started_at: '2026-03-31T10:00:01.000Z',
          completed_at: '2026-03-31T10:00:01.100Z',
          result: JSON.stringify({
            outcome: 'blocked_transition',
            blocked_reason: 'already_delivery_committed'
          })
        }];
      }

      if (sql.includes('FROM timeline_events')) {
        return [{
          id: 9,
          event_type: 'participation',
          event_name: 'decision',
          event_phase: 'end',
          duration_ms: 12,
          metadata: JSON.stringify({
            decision: 'ignore',
            reason: 'cooldown_active',
            confidence: 'high',
            conservative_fallback: true,
            used_embeddings: false,
            used_llm_judge: false,
            sessionKey: 'qq:group:101',
            recentInboundCount: 4,
            recentReplyCount: 1,
            cooldownRemainingMs: 42000,
            path: 'fast_deny',
            scores: {
              addressedness: 0.1,
              continuity: 0,
              socialPosition: 0.2,
              interest: 0.1,
              timing: 0,
              valueAdd: 0.2,
              final: 0.08
            }
          }),
          event_time: '2026-03-31T10:00:00.050Z'
        }];
      }

      return [];
    });

    const response = await request(createApp(database)).get('/api/runs/run-1');

    expect(response.status).toBe(200);
    expect(response.body.data.run).toMatchObject({
      delivery_phase: 'finished',
      delivery_commit_count: 1,
      blocked_delivery_attempt_count: 1,
      last_blocked_delivery_reason: 'Outbound delivery already committed earlier in this run.'
    });
    expect(response.body.data.result).toMatchObject({
      delivery_phase: 'finished',
      delivery_commit_count: 1,
      blocked_delivery_attempt_count: 1
    });
    expect(response.body.data.decision.sent_messages_count).toBe(1);
    expect(response.body.data.decision.participation).toMatchObject({
      attempts: 1,
      latest: {
        decision: 'ignore',
        reason: 'cooldown_active',
        confidence: 'high',
        conservative_fallback: true,
        used_embeddings: false,
        used_llm_judge: false,
        session_key: 'qq:group:101',
        recent_inbound_count: 4,
        recent_reply_count: 1,
        cooldown_remaining_ms: 42000,
        path: 'fast_deny',
        scores: {
          final: 0.08
        }
      }
    });
  });
});

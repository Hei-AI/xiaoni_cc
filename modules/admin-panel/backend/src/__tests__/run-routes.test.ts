import express from 'express';
import request from 'supertest';
import winston from 'winston';
import { createRunRoutes } from '../routes/run-routes';

jest.mock('@qq-bot/persistence', () => ({
  listAgentInboundMessages: jest.fn(async () => [])
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
    const persistence = jest.requireMock('@qq-bot/persistence');
    persistence.listAgentInboundMessages.mockResolvedValueOnce([{
      id: 9002,
      session_key: 'qq:group:123',
      message_sid: 'sid-2',
      sender_id: '202',
      sender_name: 'Alice',
      source: 'agent',
      body_for_agent: '第二句',
      received_at: '2026-04-01T01:00:01.000Z'
    }, {
      id: 9001,
      session_key: 'qq:group:123',
      message_sid: 'sid-1',
      sender_id: '201',
      sender_name: 'Bob',
      source: 'napcat',
      body_for_agent: '第一句',
      received_at: '2026-04-01T01:00:00.000Z'
    }]);

    const response = await request(createApp(database))
      .get('/api/runs/sessions/qq%3Agroup%3A123/conversation-items?limit=50');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(persistence.listAgentInboundMessages).toHaveBeenCalledWith({
      sessionKey: 'qq:group:123',
      limit: 50
    });
    expect(response.body.data).toEqual([{
      id: 9001,
      session_key: 'qq:group:123',
      role: 'user',
      phase: 'inbound',
      source: 'napcat',
      trace_id: null,
      run_id: null,
      group_index: 1,
      item_index: 0,
      message_sid: 'sid-1',
      sender_id: '201',
      sender_name: 'Bob',
      content: '第一句',
      created_at: '2026-04-01T01:00:00.000Z'
    }, {
      id: 9002,
      session_key: 'qq:group:123',
      role: 'user',
      phase: 'inbound',
      source: 'agent',
      trace_id: null,
      run_id: null,
      group_index: 2,
      item_index: 0,
      message_sid: 'sid-2',
      sender_id: '202',
      sender_name: 'Alice',
      content: '第二句',
      created_at: '2026-04-01T01:00:01.000Z'
    }]);
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

  it('does not query conversation trace with a nonnumeric run id before conversation_id is available', async () => {
    const database = createDatabaseMock();
    database.executeQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM agent_runs')) {
        return [{ conversation_id: null }];
      }
      if (sql.includes('FROM conversations')) {
        throw new Error(`invalid input syntax for type bigint: ${params?.[0]}`);
      }
      return [];
    });

    const response = await request(createApp(database)).get('/api/runs/run_1780105264736_a778356f/trace');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: 'Run trace not available yet'
    });
    expect(database.executeQuery).toHaveBeenCalledTimes(1);
  });

  it('does not query trace span detail with a nonnumeric run id before conversation_id is available', async () => {
    const database = createDatabaseMock();
    database.executeQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM agent_runs')) {
        return [{ conversation_id: null }];
      }
      if (sql.includes('FROM conversations')) {
        throw new Error(`invalid input syntax for type bigint: ${params?.[0]}`);
      }
      return [];
    });

    const response = await request(createApp(database))
      .get('/api/runs/run_1780105264736_a778356f/trace/spans/llm-call%3Allm_1/detail');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: 'Run trace not available yet'
    });
    expect(database.executeQuery).toHaveBeenCalledTimes(1);
  });
});

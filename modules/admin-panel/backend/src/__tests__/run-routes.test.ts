import express from 'express';
import request from 'supertest';
import winston from 'winston';
import { createRunRoutes } from '../routes/run-routes';

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

import express from 'express';
import request from 'supertest';
import winston from 'winston';
import { createCognitionRoutes } from '../cognition-routes';

describe('cognition routes', () => {
  const fetchMock = jest.fn();
  const logger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  } as unknown as winston.Logger;

  beforeAll(() => {
    (global as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as typeof fetch;
  });

  beforeEach(() => {
    fetchMock.mockReset();
    (logger.error as jest.Mock).mockClear();
    delete process.env.ADMIN_DEMO_MODE;
    delete process.env.DEMO_MODE;
  });

  function createApp(database: any = {}) {
    const app = express();
    app.use(express.json());
    app.use('/api', createCognitionRoutes(database as any, logger));
    return app;
  }

  it('proxies GET /cognition/proactivity to qqbot-core', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({
        success: true,
        data: {
          followupEnabled: true,
          isPaused: false
        }
      })
    });

    const response = await request(createApp()).get('/api/cognition/proactivity');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/internal/proactivity'),
      undefined
    );
  });

  it('normalizes PATCH /cognition/proactivity payload before proxying', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({
        success: true,
        data: {
          followupEnabled: true
        }
      })
    });

    const response = await request(createApp())
      .patch('/api/cognition/proactivity')
      .send({
        followup_enabled: 'true',
        is_paused: 0,
        allowed_user_ids: '85178516, 85178516,3450948895',
        observed_group_ids: '12345, 12345,67890',
        allowed_group_ids: [67890, '88888'],
        max_per_run: '2',
        retry_delay_ms: '120000'
      });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/internal/proactivity');
    expect(init.method).toBe('PATCH');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({
      followup_enabled: true,
      is_paused: false,
      allowed_user_ids: [85178516, 3450948895],
      observed_group_ids: [12345, 67890],
      allowed_group_ids: [67890, 88888],
      max_per_run: 2,
      retry_delay_ms: 120000
    });
  });

  it('rejects invalid PATCH /cognition/proactivity payloads before proxying', async () => {
    const response = await request(createApp())
      .patch('/api/cognition/proactivity')
      .send({
        followup_enabled: 'maybe'
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('followup_enabled must be a boolean');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('previews relationship patch without writing to the database', async () => {
    const relationshipRow = {
      id: 12,
      target_user_id: 123456,
      field_scope: 'private_chat',
      group_id: null,
      relationship_summary: '当前关系稳定',
      interaction_style: '自然简洁',
      boundary_notes: '谨慎主动',
      confidence: 0.7,
      status: 'active',
      source_reflection_id: 31,
      last_evidence_id: 9,
      last_observed_at: '2026-03-23T00:00:00.000Z',
      is_current: 1,
      boundary_strategy: 'allow_proactive',
      notes_json: '{}'
    };
    const database = {
      executeQuery: jest.fn(async (query: string) => {
        if (query.includes('information_schema.tables')) {
          return [{ total: 1 }];
        }
        if (query.includes('FROM agent_relationship_memories WHERE id = ?')) {
          return [relationshipRow];
        }
        if (query.includes('FROM agent_plans')) {
          return [{ id: 91 }];
        }
        return [];
      }),
      executeUpdate: jest.fn(),
      executeInsert: jest.fn()
    };

    const response = await request(createApp(database))
      .patch('/api/cognition/relationships/12')
      .send({
        reason: '边界收紧',
        preview_only: true,
        patch: {
          boundary_strategy: 'observe_only',
          boundary_notes: '近期只观察，不主动私聊'
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.after.boundary_strategy).toBe('observe_only');
    expect(response.body.data.affected_plan_ids).toEqual([91]);
    expect(database.executeUpdate).not.toHaveBeenCalled();
    expect(database.executeInsert).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('commits memory patch and triggers cognition recompute', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({
        success: true,
        data: {
          cancelledPlanIds: [44]
        }
      })
    });

    const memoryRow = {
      id: 21,
      memory_scope: 'person_global',
      memory_type: 'commitment',
      subject_type: 'user',
      subject_id: '123456',
      group_id: null,
      status: 'active'
    };
    const database = {
      executeQuery: jest.fn(async (query: string) => {
        if (query.includes('information_schema.tables')) {
          return [{ total: 1 }];
        }
        if (query.includes('FROM agent_memories WHERE id = ?')) {
          return [memoryRow];
        }
        if (query.includes('FROM agent_plans')) {
          return [{ id: 44 }];
        }
        return [];
      }),
      executeUpdate: jest.fn(async () => 1),
      executeInsert: jest.fn(async () => ({
        insertId: 77,
        affectedRows: 1
      }))
    };

    const response = await request(createApp(database))
      .patch('/api/cognition/memories/21')
      .send({
        reason: '手动停用过期记忆',
        patch: {
          status: 'disabled'
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.after.status).toBe('disabled');
    expect(database.executeUpdate).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE agent_memories'),
      ['disabled', 21]
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/internal/cognition/recompute'),
      expect.objectContaining({
        method: 'POST'
      })
    );
  });

  it('lists latest walk candidates with parsed sources', async () => {
    const database = {
      executeQuery: jest.fn(async (query: string) => {
        if (query.includes('information_schema.tables')) {
          return [{ total: 1 }];
        }
        if (query.includes('MAX(computed_at) AS computed_at')) {
          return [{ computed_at: '2026-03-23T10:00:00.000Z' }];
        }
        if (query.includes('COUNT(*) AS total FROM agent_walk_candidates')) {
          return [{ total: 1 }];
        }
        if (query.includes('FROM agent_walk_candidates c')) {
          return [{
            id: 5,
            field_key: 'private:user:123456',
            field_scope: 'private_chat',
            target_user_id: 123456,
            target_group_id: null,
            priority_score: 0.88,
            selected_reason: '优先查看该私聊场域',
            suppressed_reason: null,
            can_speak_now: 1,
            source_relationship_id: 12,
            source_plan_ids_json: '[31]',
            source_memory_ids_json: '[11]',
            source_belief_ids_json: '[1]',
            trigger_sources_json: '["day_plan","commitment_memory"]',
            compiler_inputs_json: '{"field_key":"private:user:123456"}',
            computed_at: '2026-03-23T10:00:00.000Z',
            created_at: '2026-03-23T10:00:00.000Z'
          }];
        }
        return [];
      })
    };

    const response = await request(createApp(database)).get('/api/cognition/candidates');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data[0]).toMatchObject({
      field_key: 'private:user:123456',
      can_speak_now: true,
      source_plan_ids: [31],
      trigger_sources: ['day_plan', 'commitment_memory']
    });
  });

  it('returns field detail with recent action and feedback chains', async () => {
    const database = {
      executeQuery: jest.fn(async (query: string) => {
        if (query.includes('information_schema.tables')) {
          if (query.includes('agent_feedback_events')) {
            return [{ total: 1 }];
          }
          return [{ total: 1 }];
        }
        if (query.includes('FROM agent_social_fields WHERE field_key = ?')) {
          return [{
            field_key: 'private:user:123456',
            field_scope: 'private_chat',
            title: '私聊·用户123456',
            status: 'suppressed',
            user_id: 123456,
            group_id: null
          }];
        }
        if (query.includes('FROM agent_field_scores')) {
          return [{
            id: 1,
            field_key: 'private:user:123456',
            explanation_json: '{"latest_feedback_judgement":"negative"}'
          }];
        }
        if (query.includes('FROM agent_social_edges')) {
          return [];
        }
        if (query.includes('FROM agent_walk_candidates')) {
          return [{
            id: 6,
            field_key: 'private:user:123456',
            trigger_sources_json: '["relationship_trigger"]',
            source_plan_ids_json: '[]',
            source_memory_ids_json: '[]',
            source_belief_ids_json: '[]',
            compiler_inputs_json: '{}'
          }];
        }
        if (query.includes('FROM agent_action_logs')) {
          return [{
            id: 77,
            action_type: 'followup_private_message',
            trigger_kind: 'followup_queue',
            source_plan_id: 44,
            target_user_id: 123456,
            target_group_id: null,
            payload_json: '{"message":"hi"}',
            status: 'completed',
            occurred_at: '2026-03-23T10:00:00.000Z',
            created_at: '2026-03-23T10:00:00.000Z'
          }];
        }
        if (query.includes('FROM agent_feedback_events')) {
          return [{
            id: 91,
            field_key: 'private:user:123456',
            target_user_id: 123456,
            target_group_id: null,
            source_action_log_id: 77,
            judgement: 'negative',
            reason_code: 'no_response_48h',
            explanation_json: '{"should_suppress":true}',
            llm_trace_id: 'trace-1',
            occurred_at: '2026-03-25T10:00:00.000Z',
            created_at: '2026-03-25T10:00:00.000Z'
          }];
        }
        return [];
      })
    };

    const response = await request(createApp(database)).get('/api/cognition/fields/private%3Auser%3A123456');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.recent_action_logs[0]).toMatchObject({
      id: 77,
      action_type: 'followup_private_message',
      payload_json: { message: 'hi' }
    });
    expect(response.body.data.recent_feedback_events[0]).toMatchObject({
      id: 91,
      judgement: 'negative',
      reason_code: 'no_response_48h',
      explanation_json: { should_suppress: true }
    });
  });

  it('blocks cognition commit in read-only demo mode while allowing preview', async () => {
    process.env.ADMIN_DEMO_MODE = 'true';

    const memoryRow = {
      id: 21,
      memory_scope: 'person_global',
      memory_type: 'commitment',
      subject_type: 'user',
      subject_id: '123456',
      group_id: null,
      status: 'active'
    };
    const database = {
      executeQuery: jest.fn(async (query: string) => {
        if (query.includes('information_schema.tables')) {
          return [{ total: 1 }];
        }
        if (query.includes('FROM agent_memories WHERE id = ?')) {
          return [memoryRow];
        }
        if (query.includes('FROM agent_plans')) {
          return [{ id: 44 }];
        }
        return [];
      }),
      executeUpdate: jest.fn(),
      executeInsert: jest.fn()
    };

    const response = await request(createApp(database))
      .patch('/api/cognition/memories/21')
      .send({
        reason: 'demo mode should block commit',
        patch: {
          status: 'disabled'
        }
      });

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('demo');
    expect(database.executeUpdate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

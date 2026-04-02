import express from 'express';
import request from 'supertest';
import winston from 'winston';
import { createTopicLabRoutes } from '../routes/topic-lab-routes';

jest.mock('@qq-bot/persistence', () => ({
  listChatSpaceTopics: jest.fn(async () => []),
  listTopicProjectionJobs: jest.fn(async () => []),
  listTopicProjectionVersions: jest.fn(async () => []),
  listTopicReviewEvents: jest.fn(async () => []),
  listGoldenChatCases: jest.fn(async () => []),
  getChatSpaceTopicById: jest.fn(async () => null),
  getTopicProjectionJobById: jest.fn(async () => null),
  listTopicVersionRelationships: jest.fn(async () => []),
  listTopicVersionEvidence: jest.fn(async () => []),
  createTopicProjectionJob: jest.fn(async (input: any) => ({
    id: 8801,
    ...input
  })),
  updateTopicProjectionJob: jest.fn(async (id: any, updates: any) => ({
    id,
    ...updates
  })),
  createTopicReviewEvent: jest.fn(async (input: any) => ({
    id: 7001,
    topic_id: input.topicId,
    action_type: input.actionType,
    status: input.status,
    created_by: input.createdBy,
    manual_note: input.manualNote,
    patch_json: input.patchJson,
    metadata: input.metadata || {}
  })),
  getTopicProjectionVersionById: jest.fn(async () => null),
  createGoldenChatCase: jest.fn(async (input: any) => ({
    id: 9001,
    topic_id: input.topicId,
    source_projection_version_id: input.sourceProjectionVersionId,
    input_bundle_hash: input.inputBundleHash
  }))
}));

function createLogger(): winston.Logger {
  return winston.createLogger({ silent: true });
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', createTopicLabRoutes({} as never, createLogger()));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  (global as any).fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ success: true })
  }));
});

describe('topic lab routes', () => {
  it('returns current and historical topics for a chat space workspace', async () => {
    const persistence = jest.requireMock('@qq-bot/persistence');
    persistence.listChatSpaceTopics.mockResolvedValueOnce([{
      id: 11,
      chat_space_type: 'group',
      chat_space_id: 123,
      status: 'active',
      canonical_title: 'current topic',
      current_accepted_version_id: 101,
      current_candidate_version_id: 102,
      last_activity_at: '2026-04-02T10:00:00.000Z'
    }, {
      id: 12,
      chat_space_type: 'group',
      chat_space_id: 123,
      status: 'archived',
      canonical_title: 'old topic',
      current_accepted_version_id: 201,
      current_candidate_version_id: null,
      last_activity_at: '2026-04-01T10:00:00.000Z'
    }]);
    persistence.listTopicProjectionJobs.mockResolvedValueOnce([{
      id: 88,
      status: 'pending'
    }]);
    persistence.listTopicProjectionVersions
      .mockResolvedValueOnce([{
        id: 102,
        topic_id: 11,
        version_number: 2,
        status: 'candidate',
        lifecycle_state: 'active',
        title: 'candidate',
        summary_text: 'candidate summary',
        review_priority_score: 0.8,
        heat_score: 0.4,
        evidence_count: 2,
        relationship_count: 1,
        runtime_hit_count: 0
      }, {
        id: 101,
        topic_id: 11,
        version_number: 1,
        status: 'accepted',
        lifecycle_state: 'active',
        title: 'accepted',
        summary_text: 'accepted summary',
        review_priority_score: 0.7,
        heat_score: 0.5,
        evidence_count: 2,
        relationship_count: 1,
        runtime_hit_count: 1
      }])
      .mockResolvedValueOnce([{
        id: 201,
        topic_id: 12,
        version_number: 1,
        status: 'accepted',
        lifecycle_state: 'archived',
        title: 'archived',
        summary_text: 'archived summary',
        review_priority_score: 0.2,
        heat_score: 0.1,
        evidence_count: 1,
        relationship_count: 0,
        runtime_hit_count: 0
      }]);
    persistence.listTopicReviewEvents
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    persistence.listGoldenChatCases
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await request(createApp())
      .get('/api/topic-lab/chat-spaces/group/123/workspace');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.current_topics).toHaveLength(1);
    expect(response.body.data.historical_topics).toHaveLength(1);
    expect(response.body.data.current_topics[0].accepted_version.id).toBe(101);
    expect(response.body.data.current_topics[0].candidate_version.id).toBe(102);
    expect(response.body.data.historical_topics[0].lifecycle_state).toBe('archived');
    expect(response.body.data.latest_jobs[0].id).toBe(88);
  });

  it('returns topic detail with version evidence and relationships', async () => {
    const persistence = jest.requireMock('@qq-bot/persistence');
    persistence.getChatSpaceTopicById.mockResolvedValueOnce({
      id: 11,
      chat_space_type: 'group',
      chat_space_id: 123,
      status: 'active',
      canonical_title: 'current topic',
      current_accepted_version_id: 101,
      current_candidate_version_id: 102,
      last_activity_at: '2026-04-02T10:00:00.000Z'
    });
    persistence.listTopicProjectionVersions.mockResolvedValueOnce([{
      id: 102,
      topic_id: 11,
      version_number: 2,
      status: 'candidate',
      lifecycle_state: 'active',
      title: 'candidate',
      summary_text: 'candidate summary',
      review_priority_score: 0.8,
      heat_score: 0.4,
      evidence_count: 2,
      relationship_count: 1,
      runtime_hit_count: 0
    }, {
      id: 101,
      topic_id: 11,
      version_number: 1,
      status: 'accepted',
      lifecycle_state: 'active',
      title: 'accepted',
      summary_text: 'accepted summary',
      review_priority_score: 0.7,
      heat_score: 0.5,
      evidence_count: 2,
      relationship_count: 1,
      runtime_hit_count: 1
    }]);
    persistence.listTopicReviewEvents.mockReset();
    persistence.listGoldenChatCases.mockReset();
    persistence.listTopicReviewEvents.mockResolvedValue([{ id: 1, action_type: 'approve' }]);
    persistence.listGoldenChatCases.mockResolvedValue([{ id: 5 }]);
    persistence.listTopicVersionRelationships.mockResolvedValueOnce([{ id: 301, summary_text: 'relationship summary' }]);
    persistence.listTopicVersionEvidence.mockResolvedValueOnce([{ id: 401, excerpt_text: 'hello' }]);

    const response = await request(createApp())
      .get('/api/topic-lab/topics/11');

    expect(response.status).toBe(200);
    expect(response.body.data.topic.id).toBe(11);
    expect(response.body.data.detail_version.id).toBe(101);
    expect(response.body.data.relationships[0].id).toBe(301);
    expect(response.body.data.evidence[0].id).toBe(401);
    expect(response.body.data.review_events[0].action_type).toBe('approve');
    expect(response.body.data.golden_cases[0].id).toBe(5);
  });

  it('creates topic review events', async () => {
    const persistence = jest.requireMock('@qq-bot/persistence');
    persistence.getChatSpaceTopicById.mockResolvedValueOnce({
      id: 11,
      chat_space_type: 'group',
      chat_space_id: 123
    });

    const response = await request(createApp())
      .post('/api/topic-lab/topics/11/reviews')
      .send({
        action_type: 'merge',
        base_projection_version_id: 101,
        manual_note: 'merge these',
        patch_json: { merge_into_topic_id: 22 }
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.action_type).toBe('merge');
    expect(persistence.createTopicReviewEvent).toHaveBeenCalledWith(expect.objectContaining({
      topicId: 11,
      actionType: 'merge',
      baseProjectionVersionId: 101
    }));
  });

  it('creates and immediately applies topic review events when apply_now is true', async () => {
    const persistence = jest.requireMock('@qq-bot/persistence');
    persistence.getChatSpaceTopicById.mockResolvedValueOnce({
      id: 11,
      chat_space_type: 'group',
      chat_space_id: 123
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          review_event_id: 7001,
          status: 'applied',
          resultProjectionVersionId: 101
        }
      })
    });

    const response = await request(createApp())
      .post('/api/topic-lab/topics/11/reviews')
      .send({
        action_type: 'approve_candidate',
        base_projection_version_id: 101,
        apply_now: true
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/internal/topic-reviews/apply'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(persistence.createTopicReviewEvent).toHaveBeenCalledWith(expect.objectContaining({
      topicId: 11,
      actionType: 'approve_candidate',
      status: 'recorded_pending_materialization'
    }));
  });

  it('promotes a topic accepted version into a golden case', async () => {
    const persistence = jest.requireMock('@qq-bot/persistence');
    persistence.getChatSpaceTopicById.mockResolvedValueOnce({
      id: 11,
      chat_space_type: 'group',
      chat_space_id: 123,
      current_accepted_version_id: 101,
      current_candidate_version_id: null
    });
    persistence.getTopicProjectionVersionById.mockResolvedValueOnce({
      id: 101,
      topic_id: 11,
      input_bundle_hash: 'bundle-101',
      snapshot_json: { summary: 'accepted summary' },
      provenance_json: { fixture: 'bundle' }
    });

    const response = await request(createApp())
      .post('/api/topic-lab/topics/11/golden-cases')
      .send({
        label: 'golden case'
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.source_projection_version_id).toBe(101);
    expect(persistence.createGoldenChatCase).toHaveBeenCalledWith(expect.objectContaining({
      topicId: 11,
      sourceProjectionVersionId: 101,
      inputBundleHash: 'bundle-101'
    }));
  });

  it('creates a manual reprojection job from the source version bundle and dispatches provider execution', async () => {
    const persistence = jest.requireMock('@qq-bot/persistence');
    persistence.getChatSpaceTopicById.mockResolvedValueOnce({
      id: 11,
      chat_space_type: 'group',
      chat_space_id: 123,
      current_accepted_version_id: 101,
      current_candidate_version_id: 102
    });
    persistence.getTopicProjectionVersionById.mockResolvedValueOnce({
      id: 102,
      topic_id: 11,
      projection_job_id: 5001
    });
    persistence.getTopicProjectionJobById.mockResolvedValueOnce({
      id: 5001,
      input_bundle_hash: 'bundle-5001',
      input_bundle_json: {
        chat_space_type: 'group',
        chat_space_id: 123
      },
      model_name: 'gemini-test',
      prompt_version: 'topic-v1'
    });

    const response = await request(createApp())
      .post('/api/topic-lab/topics/11/reprojection')
      .send({
        source_projection_version_id: 102,
        reason: 'try again'
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.job_id).toBe(8801);
    expect(persistence.createTopicProjectionJob).toHaveBeenCalledWith(expect.objectContaining({
      chatSpaceType: 'group',
      chatSpaceId: 123,
      triggerType: 'manual_reprojection',
      inputBundleHash: 'bundle-5001',
      baseVersionIds: [102]
    }));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/internal/topic-projection/execute'),
      expect.objectContaining({
        method: 'POST'
      })
    );
  });
});

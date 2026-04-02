import test from 'node:test';
import assert from 'node:assert/strict';
import TopicProjectionService from '../topic-projection-service';
import type { SessionTranscriptState } from '../session-transcript-service';

function buildState(overrides: Partial<SessionTranscriptState> = {}): SessionTranscriptState {
  return {
    sessionId: overrides.sessionId ?? 'group:100',
    runtimeSessionKey: overrides.runtimeSessionKey ?? 'qq:group:100',
    chatType: overrides.chatType ?? 'group',
    userId: overrides.userId ?? 20001,
    groupId: overrides.groupId ?? 100,
    summaryText: overrides.summaryText ?? 'summary',
    transcriptCompactOffset: overrides.transcriptCompactOffset ?? 6,
    snapshot: overrides.snapshot ?? null,
    messages: overrides.messages ?? [],
    turns: overrides.turns ?? [
      {
        id: 11,
        user_id: 20001,
        group_id: overrides.chatType === 'direct' ? null : 100,
        user_message: 'first',
        ai_response: null,
        timestamp: '2026-04-02T10:00:00.000Z',
        response_time: 0,
        status: null,
        error_reason: null,
        model_name: null,
        raw_request: {},
        raw_response: {},
        trace_id: null,
        source_message_ids: [1001, 1001],
        source_message_sids: ['sid-1001', 'sid-1001']
      },
      {
        id: 12,
        user_id: 20002,
        group_id: overrides.chatType === 'direct' ? null : 100,
        user_message: 'second',
        ai_response: 'reply',
        timestamp: '2026-04-02T10:01:00.000Z',
        response_time: 0,
        status: 'completed',
        error_reason: null,
        model_name: null,
        raw_request: {},
        raw_response: {},
        trace_id: null,
        source_message_ids: [1002],
        source_message_sids: ['sid-1002']
      }
    ],
    estimatedInputTokens: overrides.estimatedInputTokens ?? 1234,
    contextPolicy: overrides.contextPolicy ?? null as any,
    contextThresholds: overrides.contextThresholds ?? null
  };
}

test('buildInputBundle captures immutable transcript and ledger evidence for a group chat', async () => {
  const service = new TopicProjectionService({
    modelName: 'gemini-test',
    now: () => new Date('2026-04-02T12:00:00.000Z'),
    listEvents: async (filters: any) => {
      assert.equal(filters.groupId, 100);
      assert.equal(filters.sessionKey, 'qq:group:100');
      return [{
        id: 501,
        group_id: 100,
        target_user_id: 20002,
        session_key: 'qq:group:100',
        event_type: 'shared_joke_formed',
        event_weight: 0.9,
        confidence: 'high',
        source_message_ids: [1001, '1002'],
        source_excerpt: 'old joke',
        metadata: { keyword: 'joke' },
        created_at: '2026-04-02T10:02:00.000Z'
      }] as any;
    }
  });

  const bundle = await service.buildInputBundle(buildState(), {
    triggerType: 'compact_checkpoint'
  });

  assert.equal(bundle.chat_space_type, 'group');
  assert.equal(bundle.chat_space_id, 100);
  assert.equal(bundle.model_name, 'gemini-test');
  assert.equal(bundle.captured_at, '2026-04-02T12:00:00.000Z');
  assert.equal(bundle.turns.length, 2);
  assert.deepEqual(bundle.turns[0]?.source_message_ids, [1001]);
  assert.deepEqual(bundle.turns[0]?.source_message_sids, ['sid-1001']);
  assert.equal(bundle.ledger_events.length, 1);
  assert.deepEqual(bundle.ledger_events[0]?.source_message_ids, [1001, 1002]);
  assert.equal(bundle.ledger_events[0]?.created_at, '2026-04-02T10:02:00.000Z');
});

test('createLiveProjectionJob persists hashed bundle for direct chats too', async () => {
  const createdJobs: any[] = [];
  const service = new TopicProjectionService({
    modelName: 'gemini-test',
    now: () => new Date('2026-04-02T12:30:00.000Z'),
    listEvents: async (filters: any) => {
      assert.equal(filters.groupId, undefined);
      assert.equal(filters.sessionKey, 'qq:direct:1129974489:20001');
      return [];
    },
    createJob: async (input: any) => {
      createdJobs.push(input);
      return { id: 88, ...input };
    }
  });

  const result = await service.createLiveProjectionJob(buildState({
    chatType: 'direct',
    groupId: null,
    userId: 20001,
    sessionId: 'direct:20001',
    runtimeSessionKey: 'qq:direct:1129974489:20001'
  }), {
    triggerType: 'manual_reprojection'
  });

  assert.equal(createdJobs.length, 1);
  assert.equal(createdJobs[0].chatSpaceType, 'direct');
  assert.equal(createdJobs[0].chatSpaceId, 20001);
  assert.equal(createdJobs[0].triggerType, 'manual_reprojection');
  assert.equal(createdJobs[0].modelName, 'gemini-test');
  assert.equal(createdJobs[0].inputBundleJson.chat_space_type, 'direct');
  assert.equal(createdJobs[0].inputBundleJson.chat_space_id, 20001);
  assert.equal(typeof result.inputBundleHash, 'string');
  assert.equal(result.inputBundleHash.length, 64);
  assert.equal(result.jobId, 88);
});

test('maybeRequestRefresh schedules a job and dispatches webhook when bundle is new enough', async () => {
  const createdJobs: any[] = [];
  const fetchCalls: Array<{ url: string; init: any }> = [];
  const service = new TopicProjectionService({
    enabled: true,
    webhookUrl: 'http://127.0.0.1:8091/api/internal/topic-projection/execute',
    minNewTurns: 2,
    minNewLedgerEvents: 1,
    modelName: 'gemini-test',
    now: () => new Date('2026-04-02T13:00:00.000Z'),
    listEvents: async () => [{
      id: 501,
      group_id: 100,
      target_user_id: 20002,
      session_key: 'qq:group:100',
      event_type: 'shared_joke_formed',
      source_message_ids: [1001],
      metadata: {},
      created_at: '2026-04-02T10:02:00.000Z'
    }] as any,
    listJobs: async () => [],
    createJob: async (input: any) => {
      createdJobs.push(input);
      return { id: 66, ...input };
    },
    fetchImpl: async (url: any, init: any) => {
      fetchCalls.push({ url: String(url), init });
      return { ok: true } as any;
    }
  });

  const result = await service.maybeRequestRefresh(buildState(), {
    triggerType: 'compact_checkpoint'
  });

  assert.equal(result.requested, true);
  assert.equal(result.jobId, 66);
  assert.equal(createdJobs.length, 1);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.url, 'http://127.0.0.1:8091/api/internal/topic-projection/execute');
  assert.match(String(fetchCalls[0]?.init.body), /"job_id":66/);
});

test('maybeRequestRefresh skips when the latest succeeded job already used the same bundle hash', async () => {
  const service = new TopicProjectionService({
    enabled: true,
    webhookUrl: 'http://127.0.0.1:8091/api/internal/topic-projection/execute',
    minNewTurns: 2,
    minNewLedgerEvents: 1,
    modelName: 'gemini-test',
    now: () => new Date('2026-04-02T13:30:00.000Z'),
    listEvents: async () => [{
      id: 501,
      group_id: 100,
      target_user_id: 20002,
      session_key: 'qq:group:100',
      event_type: 'shared_joke_formed',
      source_message_ids: [1001],
      metadata: {},
      created_at: '2026-04-02T10:02:00.000Z'
    }] as any,
    listJobs: async () => [{
      id: 77,
      status: 'succeeded',
      input_bundle_hash: ''
    }] as any,
    createJob: async () => {
      throw new Error('should_not_create');
    },
    fetchImpl: async () => {
      throw new Error('should_not_dispatch');
    }
  });

  const bundle = await service.buildInputBundle(buildState(), {
    triggerType: 'compact_checkpoint'
  });
  const bundleHash = service.hashInputBundle(bundle);
  const duplicateAwareService = new TopicProjectionService({
    enabled: true,
    webhookUrl: 'http://127.0.0.1:8091/api/internal/topic-projection/execute',
    minNewTurns: 2,
    minNewLedgerEvents: 1,
    modelName: 'gemini-test',
    now: () => new Date('2026-04-02T13:30:00.000Z'),
    listEvents: async () => [{
      id: 501,
      group_id: 100,
      target_user_id: 20002,
      session_key: 'qq:group:100',
      event_type: 'shared_joke_formed',
      source_message_ids: [1001],
      metadata: {},
      created_at: '2026-04-02T10:02:00.000Z'
    }] as any,
    listJobs: async () => [{
      id: 77,
      status: 'succeeded',
      input_bundle_hash: bundleHash
    }] as any,
    createJob: async () => {
      throw new Error('should_not_create');
    },
    fetchImpl: async () => {
      throw new Error('should_not_dispatch');
    }
  });

  const result = await duplicateAwareService.maybeRequestRefresh(buildState(), {
    triggerType: 'compact_checkpoint'
  });

  assert.equal(result.requested, false);
  assert.equal(result.reason, 'bundle_unchanged');
});

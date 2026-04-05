import test from 'node:test';
import assert from 'node:assert/strict';
import RelationshipMemoryService from '../relationship-memory-service';
import type { SessionTranscriptState } from '../session-transcript-service';

function buildState(overrides: Partial<SessionTranscriptState> = {}): SessionTranscriptState {
  return {
    sessionId: overrides.sessionId ?? 'group:100',
    runtimeSessionKey: overrides.runtimeSessionKey ?? 'qq:group:100',
    chatType: overrides.chatType ?? 'group',
    userId: overrides.userId ?? 20001,
    groupId: overrides.groupId ?? 100,
    summaryText: overrides.summaryText ?? null,
    transcriptCompactOffset: overrides.transcriptCompactOffset ?? 6,
    snapshot: overrides.snapshot ?? null,
    messages: overrides.messages ?? [],
    turns: overrides.turns ?? [
      { id: 11, user_id: 20001, group_id: 100, user_message: 'a', ai_response: null, timestamp: new Date().toISOString(), response_time: 0, status: null, error_reason: null, model_name: null, raw_request: {}, raw_response: {}, trace_id: null, source_message_ids: [1001], source_message_sids: ['sid-1001'] },
      { id: 12, user_id: 20002, group_id: 100, user_message: 'b', ai_response: null, timestamp: new Date().toISOString(), response_time: 0, status: null, error_reason: null, model_name: null, raw_request: {}, raw_response: {}, trace_id: null, source_message_ids: [1002], source_message_sids: ['sid-1002'] },
      { id: 13, user_id: 20003, group_id: 100, user_message: 'c', ai_response: null, timestamp: new Date().toISOString(), response_time: 0, status: null, error_reason: null, model_name: null, raw_request: {}, raw_response: {}, trace_id: null, source_message_ids: [1003], source_message_sids: ['sid-1003'] },
      { id: 14, user_id: 20004, group_id: 100, user_message: 'd', ai_response: null, timestamp: new Date().toISOString(), response_time: 0, status: null, error_reason: null, model_name: null, raw_request: {}, raw_response: {}, trace_id: null, source_message_ids: [1004], source_message_sids: ['sid-1004'] },
      { id: 15, user_id: 20005, group_id: 100, user_message: 'e', ai_response: null, timestamp: new Date().toISOString(), response_time: 0, status: null, error_reason: null, model_name: null, raw_request: {}, raw_response: {}, trace_id: null, source_message_ids: [1005], source_message_sids: ['sid-1005'] },
      { id: 16, user_id: 20006, group_id: 100, user_message: 'f', ai_response: null, timestamp: new Date().toISOString(), response_time: 0, status: null, error_reason: null, model_name: null, raw_request: {}, raw_response: {}, trace_id: null, source_message_ids: [1006], source_message_sids: ['sid-1006'] }
    ],
    estimatedInputTokens: overrides.estimatedInputTokens ?? 9000,
    contextPolicy: overrides.contextPolicy ?? null as any,
    contextThresholds: overrides.contextThresholds ?? null
  };
}

test('schedules relationship memory job when compact-adjacent thresholds are met', async () => {
  const createdJobs: any[] = [];
  const fetchCalls: any[] = [];
  const service = new RelationshipMemoryService({
    enabled: true,
    webhookUrl: 'http://example.com/relationship',
    minNewTurns: 6,
    minNewLedgerEvents: 2,
    listJobs: async () => [],
    listEvents: async () => [
      { id: 1, created_at: new Date('2026-03-31T10:00:00Z') },
      { id: 2, created_at: new Date('2026-03-31T10:01:00Z') }
    ] as any,
    createJob: async (input: any) => {
      createdJobs.push(input);
      return { id: 77, ...input };
    },
    fetchImpl: (async (url: any, init: any) => {
      fetchCalls.push({ url, init });
      return { ok: true } as any;
    }) as any
  });

  const result = await service.maybeRequestRefresh(buildState());

  assert.equal(result.requested, true);
  assert.equal(result.reason, 'scheduled');
  assert.equal(result.jobId, 77);
  assert.equal(createdJobs.length, 1);
  assert.equal(fetchCalls.length, 1);
  assert.equal(createdJobs[0].sessionKey, 'qq:group:100');
  assert.equal(JSON.parse(fetchCalls[0].init.body).session_key, 'qq:group:100');
  assert.equal(JSON.parse(fetchCalls[0].init.body).summary_text, null);
  assert.equal(JSON.parse(fetchCalls[0].init.body).transcript_compact_offset, 6);
  assert.equal(JSON.parse(fetchCalls[0].init.body).compact_role, 'bridge_material');
});

test('skips scheduling when there are not enough new ledger events', async () => {
  const service = new RelationshipMemoryService({
    enabled: true,
    webhookUrl: 'http://example.com/relationship',
    minNewTurns: 6,
    minNewLedgerEvents: 2,
    listJobs: async () => [],
    listEvents: async () => [
      { id: 1, created_at: new Date('2026-03-31T10:00:00Z') }
    ] as any,
    createJob: async () => {
      throw new Error('should not create job');
    }
  });

  const result = await service.maybeRequestRefresh(buildState());

  assert.equal(result.requested, false);
  assert.equal(result.reason, 'not_enough_new_events');
});

test('uses runtime session key for ledger and job lookups', async () => {
  const listJobsCalls: any[] = [];
  const listEventsCalls: any[] = [];
  const service = new RelationshipMemoryService({
    enabled: true,
    webhookUrl: 'http://example.com/relationship',
    minNewTurns: 6,
    minNewLedgerEvents: 2,
    listJobs: async (filters: any) => {
      listJobsCalls.push(filters);
      return [];
    },
    listEvents: async (filters: any) => {
      listEventsCalls.push(filters);
      return [
        { id: 1, created_at: new Date('2026-03-31T10:00:00Z') },
        { id: 2, created_at: new Date('2026-03-31T10:01:00Z') }
      ] as any;
    },
    createJob: async (input: any) => ({ id: 88, ...input }),
    fetchImpl: (async () => ({ ok: true } as any)) as any
  });

  await service.maybeRequestRefresh(buildState({
    sessionId: 'group:100',
    runtimeSessionKey: 'qq:group:100'
  }));

  assert.equal(listJobsCalls[0].sessionKey, 'qq:group:100');
  assert.equal(listEventsCalls[0].sessionKey, 'qq:group:100');
});

test('marks failed jobs without replacing cards', async () => {
  const updates: any[] = [];
  const service = new RelationshipMemoryService({
    updateJob: async (id: any, payload: any) => {
      updates.push({ id, payload });
      return { id, ...payload };
    }
  });

  await service.markFailed(99, 'bad_json');

  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, 99);
  assert.equal(updates[0].payload.status, 'failed');
  assert.equal(updates[0].payload.errorMessage, 'bad_json');
});

test('marks jobs as running before execution', async () => {
  const updates: any[] = [];
  const service = new RelationshipMemoryService({
    updateJob: async (id: any, payload: any) => {
      updates.push({ id, payload });
      return { id, ...payload };
    }
  });

  await service.markRunning(88);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, 88);
  assert.equal(updates[0].payload.status, 'running');
  assert.equal(updates[0].payload.errorMessage, null);
});

test('applyResult clears previously active scopes that disappear from the refresh output', async () => {
  const replaceCalls: any[] = [];
  const service = new RelationshipMemoryService({
    listCards: async () => [{
      id: 1,
      card_type: 'group',
      target_user_id: null
    }, {
      id: 2,
      card_type: 'person',
      target_user_id: 20001
    }] as any,
    replaceCards: async (input: any) => {
      replaceCalls.push(input);
      return [];
    },
    updateJob: async () => ({ id: 101 } as any)
  });

  await service.applyResult({
    jobId: 101,
    sessionKey: 'group:100',
    groupId: 100,
    version: 3,
    cards: [{
      card_type: 'group',
      summary_text: '群体氛围已经稳定',
      actors: ['A', 'B'],
      source_event_ids: [701],
      source_message_ids: [1001]
    }]
  });

  assert.equal(replaceCalls.length, 2);
  assert.deepEqual(replaceCalls[0], {
    groupId: 100,
    targetUserId: null,
    cardType: 'group',
    version: 3,
    cards: [{
      summaryText: '群体氛围已经稳定',
      actors: ['A', 'B'],
      contextBefore: null,
      trigger: null,
      interaction: null,
      outcome: null,
      sourceEventIds: [701],
      sourceMessageIds: [1001],
      importanceScore: 0,
      freshnessScore: 0,
      decayedScore: 0,
      retrievalText: '群体氛围已经稳定',
      embeddingText: '群体氛围已经稳定',
      metadata: {}
    }]
  });
  assert.deepEqual(replaceCalls[1], {
    groupId: 100,
    targetUserId: 20001,
    cardType: 'person',
    version: 3,
    cards: []
  });
});

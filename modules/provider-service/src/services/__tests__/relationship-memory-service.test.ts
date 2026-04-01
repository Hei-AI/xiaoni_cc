import test from 'node:test';
import assert from 'node:assert/strict';
import RelationshipMemoryService from '../relationship-memory-service';
import type { SessionTranscriptState } from '../session-transcript-service';

function buildState(overrides: Partial<SessionTranscriptState> = {}): SessionTranscriptState {
  return {
    sessionId: overrides.sessionId ?? 'group:100',
    chatType: overrides.chatType ?? 'group',
    userId: overrides.userId ?? 20001,
    groupId: overrides.groupId ?? 100,
    summaryText: overrides.summaryText ?? null,
    transcriptCompactOffset: overrides.transcriptCompactOffset ?? 6,
    snapshot: overrides.snapshot ?? null,
    messages: overrides.messages ?? [],
    turns: overrides.turns ?? [
      { id: 11, user_id: 20001, group_id: 100, user_message: 'a', ai_response: null, timestamp: new Date().toISOString(), response_time: 0, status: null, error_reason: null, model_name: null, raw_request: {}, raw_response: {}, trace_id: null },
      { id: 12, user_id: 20002, group_id: 100, user_message: 'b', ai_response: null, timestamp: new Date().toISOString(), response_time: 0, status: null, error_reason: null, model_name: null, raw_request: {}, raw_response: {}, trace_id: null },
      { id: 13, user_id: 20003, group_id: 100, user_message: 'c', ai_response: null, timestamp: new Date().toISOString(), response_time: 0, status: null, error_reason: null, model_name: null, raw_request: {}, raw_response: {}, trace_id: null },
      { id: 14, user_id: 20004, group_id: 100, user_message: 'd', ai_response: null, timestamp: new Date().toISOString(), response_time: 0, status: null, error_reason: null, model_name: null, raw_request: {}, raw_response: {}, trace_id: null },
      { id: 15, user_id: 20005, group_id: 100, user_message: 'e', ai_response: null, timestamp: new Date().toISOString(), response_time: 0, status: null, error_reason: null, model_name: null, raw_request: {}, raw_response: {}, trace_id: null },
      { id: 16, user_id: 20006, group_id: 100, user_message: 'f', ai_response: null, timestamp: new Date().toISOString(), response_time: 0, status: null, error_reason: null, model_name: null, raw_request: {}, raw_response: {}, trace_id: null }
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

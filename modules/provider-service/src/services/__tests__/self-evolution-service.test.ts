import test from 'node:test';
import assert from 'node:assert/strict';
import { SelfEvolutionService } from '../self-evolution-service';
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

test('schedules self evolution job when thresholds are met', async () => {
  const createdJobs: any[] = [];
  const fetchCalls: any[] = [];
  const service = new SelfEvolutionService({
    enabled: true,
    webhookUrl: 'http://example.com/self-evolution',
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

test('marks self evolution jobs as running and failed', async () => {
  const updates: any[] = [];
  const service = new SelfEvolutionService({
    updateJob: async (id: any, payload: any) => {
      updates.push({ id, payload });
      return { id, ...payload };
    }
  });

  await service.markRunning(81);
  await service.markFailed(81, 'bad_json');

  assert.equal(updates.length, 2);
  assert.equal(updates[0].payload.status, 'running');
  assert.equal(updates[1].payload.status, 'failed');
  assert.equal(updates[1].payload.errorMessage, 'bad_json');
});

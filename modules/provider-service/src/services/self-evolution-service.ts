import {
  createSelfEvolutionJob,
  listRelationshipLedgerEvents,
  listSelfEvolutionJobs,
  listSelfEvolutionStates,
  replaceSelfEvolutionStates,
  updateSelfEvolutionJob
} from '@qq-bot/persistence';
import { databaseConfig } from '../config';
import type { SessionTranscriptState } from './session-transcript-service';
import type { StoredConversationTurn } from './conversation-store-service';

type SelfEvolutionStateInput = {
  scope_type: string;
  target_user_id?: number | null;
  social_presence_baseline: string;
  entry_preference: string;
  warmth_bias: string;
  familiarity_ceiling: string;
  topic_resonance?: unknown[];
  boundary_tendencies?: Record<string, unknown>;
  reinforced_modes?: unknown[];
  suppressed_modes?: unknown[];
  summary_text: string;
  source_event_ids?: Array<number | string>;
  source_message_ids?: Array<number | string>;
  metadata?: Record<string, unknown>;
};

type SelfEvolutionJobPayload = {
  job_id: number;
  session_key: string;
  group_id: number | null;
  target_user_id: number | null;
  version: number;
  trigger_reason: string;
  summary_text: string | null;
  transcript_compact_offset: number;
  compact_role: 'bridge_material';
  turns: StoredConversationTurn[];
  ledger_events: any[];
};

type SelfEvolutionServiceDeps = {
  enabled?: boolean;
  webhookUrl?: string;
  minNewTurns?: number;
  minNewLedgerEvents?: number;
  now?: () => number;
  createJob?: typeof createSelfEvolutionJob;
  updateJob?: typeof updateSelfEvolutionJob;
  listJobs?: typeof listSelfEvolutionJobs;
  listEvents?: typeof listRelationshipLedgerEvents;
  listStates?: typeof listSelfEvolutionStates;
  replaceStates?: typeof replaceSelfEvolutionStates;
  fetchImpl?: typeof fetch;
};

function normalizeDate(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  return 0;
}

function toNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export class SelfEvolutionService {
  private readonly enabled: boolean;
  private readonly webhookUrl?: string;
  private readonly minNewTurns: number;
  private readonly minNewLedgerEvents: number;
  private readonly now: () => number;
  private readonly createJob: typeof createSelfEvolutionJob;
  private readonly updateJob: typeof updateSelfEvolutionJob;
  private readonly listJobs: typeof listSelfEvolutionJobs;
  private readonly listEvents: typeof listRelationshipLedgerEvents;
  private readonly listStates: typeof listSelfEvolutionStates;
  private readonly replaceStates: typeof replaceSelfEvolutionStates;
  private readonly fetchImpl?: typeof fetch;

  constructor(deps: SelfEvolutionServiceDeps = {}) {
    this.enabled = deps.enabled ?? true;
    this.webhookUrl = deps.webhookUrl;
    this.minNewTurns = deps.minNewTurns ?? 6;
    this.minNewLedgerEvents = deps.minNewLedgerEvents ?? 2;
    this.now = deps.now || (() => Date.now());
    this.createJob = deps.createJob || ((input) => createSelfEvolutionJob(input, databaseConfig));
    this.updateJob = deps.updateJob || ((id, updates) => updateSelfEvolutionJob(id, updates, databaseConfig));
    this.listJobs = deps.listJobs || ((filters) => listSelfEvolutionJobs(filters, databaseConfig));
    this.listEvents = deps.listEvents || ((filters) => listRelationshipLedgerEvents(filters, databaseConfig));
    this.listStates = deps.listStates || ((filters) => listSelfEvolutionStates(filters, databaseConfig));
    this.replaceStates = deps.replaceStates || ((input) => replaceSelfEvolutionStates(input, databaseConfig));
    this.fetchImpl = deps.fetchImpl || globalThis.fetch;
  }

  async maybeRequestRefresh(state: SessionTranscriptState): Promise<{ requested: boolean; reason: string; jobId?: number | null }> {
    const sessionKey = state.runtimeSessionKey || state.sessionId;
    if (!this.enabled || state.chatType !== 'group' || !state.groupId || !this.webhookUrl || !this.fetchImpl) {
      return { requested: false, reason: 'disabled_or_unconfigured' };
    }

    const jobs = await this.listJobs({
      groupId: state.groupId,
      sessionKey,
      limit: 20
    });
    if (jobs.some((job) => job.status === 'pending' || job.status === 'running')) {
      return { requested: false, reason: 'job_inflight' };
    }

    const lastSucceeded = jobs.find((job) => job.status === 'succeeded') || null;
    const lastTurnEnd = toNumber(lastSucceeded?.turn_range_end) || 0;
    const newTurns = state.turns.filter((turn) => turn.id > lastTurnEnd);
    if (newTurns.length < this.minNewTurns) {
      return { requested: false, reason: 'not_enough_new_turns' };
    }

    const events = await this.listEvents({
      groupId: state.groupId,
      sessionKey,
      limit: 200
    });
    const lastFinishedAt = normalizeDate(lastSucceeded?.finished_at);
    const newEvents = events.filter((event) => normalizeDate(event.created_at) > lastFinishedAt);
    if (newEvents.length < this.minNewLedgerEvents) {
      return { requested: false, reason: 'not_enough_new_events' };
    }

    const version = (typeof lastSucceeded?.output_state_version === 'number' ? lastSucceeded.output_state_version : Number(lastSucceeded?.output_state_version || 0)) + 1;
    const inputMessageIds = Array.from(new Set(
      newTurns.flatMap((turn) => Array.isArray(turn.source_message_ids) && turn.source_message_ids.length > 0 ? turn.source_message_ids : [])
    ));
    const job = await this.createJob({
      groupId: state.groupId,
      sessionKey,
      status: 'pending',
      triggerReason: 'compact_checkpoint',
      turnRangeStart: newTurns[0]?.id || null,
      turnRangeEnd: newTurns[newTurns.length - 1]?.id || null,
      sourceEventCount: newEvents.length,
      inputMessageIds,
      outputStateVersion: version,
      metadata: {
        createdAtMs: this.now()
      }
    });

    const payload: SelfEvolutionJobPayload = {
      job_id: Number(job.id),
      session_key: sessionKey,
      group_id: state.groupId,
      target_user_id: null,
      version,
      trigger_reason: 'compact_checkpoint',
      summary_text: state.summaryText,
      transcript_compact_offset: state.transcriptCompactOffset,
      compact_role: 'bridge_material',
      turns: newTurns,
      ledger_events: newEvents
    };

    void this.fetchImpl(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(async (error) => {
      await this.updateJob(Number(job.id), {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'webhook_dispatch_failed',
        finishedAt: new Date()
      }).catch(() => undefined);
    });

    return { requested: true, reason: 'scheduled', jobId: Number(job.id) };
  }

  async applyResult(params: {
    jobId: number;
    sessionKey: string;
    groupId: number;
    version: number;
    states: SelfEvolutionStateInput[];
  }) {
    const buckets = new Map<string, SelfEvolutionStateInput[]>();
    for (const state of params.states) {
      const key = `${state.scope_type}::${state.target_user_id ?? 'group'}`;
      const items = buckets.get(key) || [];
      items.push(state);
      buckets.set(key, items);
    }

    const existingStates = await this.listStates({
      sessionKey: params.sessionKey,
      groupId: params.groupId,
      isActive: true,
      limit: 500
    });
    const existingScopes = new Set(existingStates.map((state) => `${state.scope_type}::${state.target_user_id ?? 'group'}`));
    const nextScopes = new Set(buckets.keys());

    for (const [key, states] of buckets.entries()) {
      const [scopeType, targetUserKey] = key.split('::');
      await this.replaceStates({
        sessionKey: params.sessionKey,
        groupId: params.groupId,
        targetUserId: targetUserKey === 'group' ? null : Number(targetUserKey),
        scopeType,
        version: params.version,
        states: states.map((state) => ({
          socialPresenceBaseline: state.social_presence_baseline,
          entryPreference: state.entry_preference,
          warmthBias: state.warmth_bias,
          familiarityCeiling: state.familiarity_ceiling,
          topicResonance: state.topic_resonance || [],
          boundaryTendencies: state.boundary_tendencies || {},
          reinforcedModes: state.reinforced_modes || [],
          suppressedModes: state.suppressed_modes || [],
          summaryText: state.summary_text,
          sourceEventIds: state.source_event_ids || [],
          sourceMessageIds: state.source_message_ids || [],
          metadata: state.metadata || {}
        }))
      });
    }

    for (const scopeKey of existingScopes) {
      if (nextScopes.has(scopeKey)) {
        continue;
      }
      const [scopeType, targetUserKey] = scopeKey.split('::');
      await this.replaceStates({
        sessionKey: params.sessionKey,
        groupId: params.groupId,
        targetUserId: targetUserKey === 'group' ? null : Number(targetUserKey),
        scopeType,
        version: params.version,
        states: []
      });
    }

    await this.updateJob(params.jobId, {
      status: 'succeeded',
      outputStateVersion: params.version,
      errorMessage: null,
      finishedAt: new Date()
    });
  }

  async markFailed(jobId: number, errorMessage: string) {
    await this.updateJob(jobId, {
      status: 'failed',
      errorMessage,
      finishedAt: new Date()
    });
  }

  async markRunning(jobId: number) {
    await this.updateJob(jobId, {
      status: 'running',
      errorMessage: null,
      startedAt: new Date()
    });
  }
}

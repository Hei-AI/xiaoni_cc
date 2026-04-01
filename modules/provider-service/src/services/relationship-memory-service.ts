import {
  createRelationshipMemoryJob,
  listRelationshipLedgerEvents,
  listRelationshipMemoryJobs,
  replaceRelationshipMemoryCards,
  updateRelationshipMemoryJob
} from '@qq-bot/persistence';
import { databaseConfig } from '../config';
import type { SessionTranscriptState } from './session-transcript-service';
import type { StoredConversationTurn } from './conversation-store-service';
import { logger } from '../utils/logger';

type RelationshipMemoryCardInput = {
  card_type: string;
  target_user_id?: number | null;
  summary_text: string;
  actors: unknown[];
  context_before?: string | null;
  trigger?: string | null;
  interaction?: string | null;
  outcome?: string | null;
  source_event_ids?: Array<number | string>;
  source_message_ids?: Array<number | string>;
  retrieval_text?: string | null;
  embedding_text?: string | null;
  importance_score?: number | null;
  freshness_score?: number | null;
  decayed_score?: number | null;
  metadata?: Record<string, unknown>;
};

type RelationshipMemoryJobPayload = {
  job_id: number;
  session_key: string;
  group_id: number | null;
  version: number;
  trigger_reason: string;
  turns: StoredConversationTurn[];
  ledger_events: any[];
};

type RelationshipMemoryServiceDeps = {
  enabled?: boolean;
  webhookUrl?: string;
  minNewTurns?: number;
  minNewLedgerEvents?: number;
  now?: () => number;
  createJob?: typeof createRelationshipMemoryJob;
  updateJob?: typeof updateRelationshipMemoryJob;
  listJobs?: typeof listRelationshipMemoryJobs;
  listEvents?: typeof listRelationshipLedgerEvents;
  replaceCards?: typeof replaceRelationshipMemoryCards;
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

export class RelationshipMemoryService {
  private readonly moduleLogger = logger.createModuleLogger('relationship-memory-service');
  private readonly enabled: boolean;
  private readonly webhookUrl?: string;
  private readonly minNewTurns: number;
  private readonly minNewLedgerEvents: number;
  private readonly now: () => number;
  private readonly createJob: typeof createRelationshipMemoryJob;
  private readonly updateJob: typeof updateRelationshipMemoryJob;
  private readonly listJobs: typeof listRelationshipMemoryJobs;
  private readonly listEvents: typeof listRelationshipLedgerEvents;
  private readonly replaceCards: typeof replaceRelationshipMemoryCards;
  private readonly fetchImpl?: typeof fetch;

  constructor(deps: RelationshipMemoryServiceDeps = {}) {
    this.enabled = deps.enabled ?? true;
    this.webhookUrl = deps.webhookUrl;
    this.minNewTurns = deps.minNewTurns ?? 6;
    this.minNewLedgerEvents = deps.minNewLedgerEvents ?? 2;
    this.now = deps.now || (() => Date.now());
    this.createJob = deps.createJob || ((input) => createRelationshipMemoryJob(input, databaseConfig));
    this.updateJob = deps.updateJob || ((id, updates) => updateRelationshipMemoryJob(id, updates, databaseConfig));
    this.listJobs = deps.listJobs || ((filters) => listRelationshipMemoryJobs(filters, databaseConfig));
    this.listEvents = deps.listEvents || ((filters) => listRelationshipLedgerEvents(filters, databaseConfig));
    this.replaceCards = deps.replaceCards || ((input) => replaceRelationshipMemoryCards(input, databaseConfig));
    this.fetchImpl = deps.fetchImpl || globalThis.fetch;
  }

  async maybeRequestRefresh(state: SessionTranscriptState): Promise<{ requested: boolean; reason: string; jobId?: number | null }> {
    if (!this.enabled) {
      return { requested: false, reason: 'disabled' };
    }
    if (state.chatType !== 'group' || !state.groupId) {
      return { requested: false, reason: 'group_only' };
    }
    if (!this.webhookUrl || !this.fetchImpl) {
      return { requested: false, reason: 'webhook_unconfigured' };
    }

    const jobs = await this.listJobs({
      groupId: state.groupId,
      sessionKey: state.sessionId,
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
      sessionKey: state.sessionId,
      limit: 200
    });
    const lastFinishedAt = normalizeDate(lastSucceeded?.finished_at);
    const newEvents = events.filter((event) => normalizeDate(event.created_at) > lastFinishedAt);
    if (newEvents.length < this.minNewLedgerEvents) {
      return { requested: false, reason: 'not_enough_new_events' };
    }

    const version = (typeof lastSucceeded?.output_card_version === 'number' ? lastSucceeded.output_card_version : Number(lastSucceeded?.output_card_version || 0)) + 1;
    const turnRangeStart = newTurns[0]?.id || null;
    const turnRangeEnd = newTurns[newTurns.length - 1]?.id || null;
    const job = await this.createJob({
      groupId: state.groupId,
      sessionKey: state.sessionId,
      status: 'pending',
      triggerReason: 'compact_checkpoint',
      turnRangeStart,
      turnRangeEnd,
      ledgerEventCount: newEvents.length,
      inputMessageIds: newTurns.map((turn) => turn.id),
      outputCardVersion: version,
      metadata: {
        createdAtMs: this.now()
      }
    });

    const payload: RelationshipMemoryJobPayload = {
      job_id: Number(job.id),
      session_key: state.sessionId,
      group_id: state.groupId,
      version,
      trigger_reason: 'compact_checkpoint',
      turns: newTurns,
      ledger_events: newEvents
    };

    void this.fetchImpl(this.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }).catch(async (error) => {
      this.moduleLogger.warn('Relationship memory webhook dispatch failed', {
        error: error instanceof Error ? error.message : String(error),
        sessionId: state.sessionId,
        groupId: state.groupId
      });
      await this.updateJob(Number(job.id), {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'webhook_dispatch_failed',
        finishedAt: new Date()
      }).catch(() => undefined);
    });

    return {
      requested: true,
      reason: 'scheduled',
      jobId: Number(job.id)
    };
  }

  async applyResult(params: {
    jobId: number;
    sessionKey: string;
    groupId: number;
    version: number;
    cards: RelationshipMemoryCardInput[];
  }) {
    const buckets = new Map<string, RelationshipMemoryCardInput[]>();
    for (const card of params.cards) {
      const key = `${card.card_type}::${card.target_user_id ?? 'group'}`;
      const items = buckets.get(key) || [];
      items.push(card);
      buckets.set(key, items);
    }

    for (const [key, cards] of buckets.entries()) {
      const [cardType, targetUserKey] = key.split('::');
      await this.replaceCards({
        groupId: params.groupId,
        targetUserId: targetUserKey === 'group' ? null : Number(targetUserKey),
        cardType,
        version: params.version,
        cards: cards.map((card) => ({
          summaryText: card.summary_text,
          actors: card.actors,
          contextBefore: card.context_before || null,
          trigger: card.trigger || null,
          interaction: card.interaction || null,
          outcome: card.outcome || null,
          sourceEventIds: card.source_event_ids || [],
          sourceMessageIds: card.source_message_ids || [],
          importanceScore: typeof card.importance_score === 'number' ? card.importance_score : 0,
          freshnessScore: typeof card.freshness_score === 'number' ? card.freshness_score : 0,
          decayedScore: typeof card.decayed_score === 'number' ? card.decayed_score : 0,
          retrievalText: card.retrieval_text || card.summary_text,
          embeddingText: card.embedding_text || card.summary_text,
          metadata: card.metadata || {}
        }))
      });
    }

    await this.updateJob(params.jobId, {
      status: 'succeeded',
      outputCardVersion: params.version,
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

export default RelationshipMemoryService;

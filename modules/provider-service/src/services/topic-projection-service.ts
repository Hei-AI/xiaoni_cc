import { createHash } from 'crypto';
import {
  createTopicProjectionJob,
  getTopicProjectionJobById,
  listRelationshipLedgerEvents,
  listTopicProjectionJobs,
  updateTopicProjectionJob
} from '@qq-bot/persistence';
import { databaseConfig } from '../config';
import type { SessionTranscriptState } from './session-transcript-service';

type TopicProjectionLedgerEvent = {
  id: number;
  group_id?: number | null;
  target_user_id?: number | null;
  session_key?: string | null;
  event_type: string;
  event_weight?: number | null;
  confidence?: string | null;
  source_message_ids?: Array<number | string>;
  source_excerpt?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | Date | null;
  last_reinforced_at?: string | Date | null;
};

export type TopicProjectionInputBundle = {
  chat_space_type: 'group' | 'direct';
  chat_space_id: number;
  session_key: string;
  trigger_type: string;
  model_name: string;
  captured_at: string;
  summary_text: string | null;
  transcript_compact_offset: number;
  estimated_input_tokens: number;
  turns: Array<{
    conversation_id: number;
    user_id: number;
    group_id: number | null;
    user_message: string;
    ai_response: string | null;
    timestamp: string;
    source_message_ids: number[];
    source_message_sids: string[];
  }>;
  ledger_events: Array<{
    id: number;
    group_id: number | null;
    target_user_id: number | null;
    session_key: string | null;
    event_type: string;
    event_weight: number | null;
    confidence: string | null;
    source_message_ids: number[];
    source_excerpt: string | null;
    metadata: Record<string, unknown>;
    created_at: string | null;
    last_reinforced_at: string | null;
  }>;
};

type TopicProjectionServiceDeps = {
  enabled?: boolean;
  webhookUrl?: string;
  minNewTurns?: number;
  minNewLedgerEvents?: number;
  createJob?: typeof createTopicProjectionJob;
  getJob?: typeof getTopicProjectionJobById;
  listEvents?: typeof listRelationshipLedgerEvents;
  listJobs?: typeof listTopicProjectionJobs;
  updateJob?: typeof updateTopicProjectionJob;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  modelName?: string;
};

function normalizeNumericArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(
    value
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0)
      .map((item) => Math.trunc(item))
  ));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(
    value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
  ));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeLedgerEvent(event: TopicProjectionLedgerEvent) {
  return {
    id: Number(event.id),
    group_id: event.group_id === null || typeof event.group_id === 'undefined' ? null : Number(event.group_id),
    target_user_id: event.target_user_id === null || typeof event.target_user_id === 'undefined'
      ? null
      : Number(event.target_user_id),
    session_key: typeof event.session_key === 'string' ? event.session_key : null,
    event_type: String(event.event_type || ''),
    event_weight: typeof event.event_weight === 'number' ? event.event_weight : null,
    confidence: typeof event.confidence === 'string' ? event.confidence : null,
    source_message_ids: normalizeNumericArray(event.source_message_ids),
    source_excerpt: typeof event.source_excerpt === 'string' ? event.source_excerpt : null,
    metadata: event.metadata && typeof event.metadata === 'object' ? event.metadata : {},
    created_at: toIso(event.created_at),
    last_reinforced_at: toIso(event.last_reinforced_at)
  };
}

export class TopicProjectionService {
  private readonly enabled: boolean;
  private readonly webhookUrl?: string;
  private readonly minNewTurns: number;
  private readonly minNewLedgerEvents: number;
  private readonly createJob: typeof createTopicProjectionJob;
  private readonly getJob: typeof getTopicProjectionJobById;
  private readonly listEvents: typeof listRelationshipLedgerEvents;
  private readonly listJobs: typeof listTopicProjectionJobs;
  private readonly updateJob: typeof updateTopicProjectionJob;
  private readonly fetchImpl?: typeof fetch;
  private readonly now: () => Date;
  private readonly modelName: string;

  constructor(deps: TopicProjectionServiceDeps = {}) {
    this.enabled = deps.enabled ?? true;
    this.webhookUrl = deps.webhookUrl;
    this.minNewTurns = deps.minNewTurns ?? 6;
    this.minNewLedgerEvents = deps.minNewLedgerEvents ?? 2;
    this.createJob = deps.createJob || ((input) => createTopicProjectionJob(input, databaseConfig));
    this.getJob = deps.getJob || ((id) => getTopicProjectionJobById(id, databaseConfig));
    this.listEvents = deps.listEvents || ((filters) => listRelationshipLedgerEvents(filters, databaseConfig));
    this.listJobs = deps.listJobs || ((filters) => listTopicProjectionJobs(filters, databaseConfig));
    this.updateJob = deps.updateJob || ((id, updates) => updateTopicProjectionJob(id, updates, databaseConfig));
    this.fetchImpl = deps.fetchImpl || globalThis.fetch;
    this.now = deps.now || (() => new Date());
    this.modelName = deps.modelName || 'unknown-model';
  }

  async buildInputBundle(
    state: SessionTranscriptState,
    params: { triggerType?: string; ledgerEventLimit?: number } = {}
  ): Promise<TopicProjectionInputBundle> {
    const chatSpaceType = state.chatType;
    const chatSpaceId = state.chatType === 'group'
      ? Number(state.groupId)
      : Number(state.userId);

    if (!Number.isFinite(chatSpaceId) || chatSpaceId <= 0) {
      throw new Error('invalid_chat_space_id');
    }

    const ledgerEvents = await this.listEvents({
      groupId: state.chatType === 'group' ? state.groupId ?? undefined : undefined,
      sessionKey: state.runtimeSessionKey,
      limit: Number.isFinite(params.ledgerEventLimit) ? Number(params.ledgerEventLimit) : 200
    }) as TopicProjectionLedgerEvent[];

    return {
      chat_space_type: chatSpaceType,
      chat_space_id: chatSpaceId,
      session_key: state.runtimeSessionKey,
      trigger_type: params.triggerType || 'compact_checkpoint',
      model_name: this.modelName,
      captured_at: this.now().toISOString(),
      summary_text: state.summaryText,
      transcript_compact_offset: state.transcriptCompactOffset,
      estimated_input_tokens: state.estimatedInputTokens,
      turns: state.turns.map((turn) => ({
        conversation_id: Number(turn.id),
        user_id: Number(turn.user_id),
        group_id: turn.group_id === null || typeof turn.group_id === 'undefined' ? null : Number(turn.group_id),
        user_message: turn.user_message,
        ai_response: turn.ai_response ?? null,
        timestamp: turn.timestamp,
        source_message_ids: normalizeNumericArray(turn.source_message_ids),
        source_message_sids: normalizeStringArray(turn.source_message_sids)
      })),
      ledger_events: ledgerEvents.map(normalizeLedgerEvent)
    };
  }

  hashInputBundle(bundle: TopicProjectionInputBundle): string {
    return createHash('sha256').update(stableStringify(bundle)).digest('hex');
  }

  async getJobById(jobId: number) {
    return this.getJob(jobId);
  }

  async markRunning(jobId: number) {
    await this.updateJob(jobId, {
      status: 'running',
      startedAt: this.now(),
      errorCode: null,
      errorMessage: null
    });
  }

  async markFailed(jobId: number, errorMessage: string, errorCode = 'projection_failed') {
    await this.updateJob(jobId, {
      status: 'failed',
      errorCode,
      errorMessage,
      finishedAt: this.now()
    });
  }

  async markSucceeded(jobId: number, metadata: Record<string, unknown> = {}) {
    const job = await this.getJob(jobId);
    const jobMetadata = job?.metadata && typeof job.metadata === 'object' ? job.metadata as Record<string, unknown> : {};
    await this.updateJob(jobId, {
      status: 'succeeded',
      finishedAt: this.now(),
      metadata: {
        ...jobMetadata,
        ...metadata
      }
    });
  }

  async maybeRequestRefresh(
    state: SessionTranscriptState,
    params: { triggerType?: string; ledgerEventLimit?: number } = {}
  ): Promise<{ requested: boolean; reason: string; jobId?: number | null }> {
    if (!this.enabled) {
      return { requested: false, reason: 'disabled' };
    }
    if (!this.webhookUrl || !this.fetchImpl) {
      return { requested: false, reason: 'webhook_unconfigured' };
    }

    const bundle = await this.buildInputBundle(state, params);
    if (bundle.turns.length < this.minNewTurns) {
      return { requested: false, reason: 'not_enough_new_turns' };
    }
    if (bundle.ledger_events.length < this.minNewLedgerEvents) {
      return { requested: false, reason: 'not_enough_new_events' };
    }

    const jobs = await this.listJobs({
      chatSpaceType: bundle.chat_space_type,
      chatSpaceId: bundle.chat_space_id,
      limit: 20
    });
    if (jobs.some((job) => job.status === 'pending' || job.status === 'running')) {
      return { requested: false, reason: 'job_inflight' };
    }

    const inputBundleHash = this.hashInputBundle(bundle);
    if (jobs.some((job) => job.status === 'succeeded' && job.input_bundle_hash === inputBundleHash)) {
      return { requested: false, reason: 'bundle_unchanged' };
    }

    const job = await this.createJob({
      chatSpaceType: bundle.chat_space_type,
      chatSpaceId: bundle.chat_space_id,
      triggerType: params.triggerType || 'compact_checkpoint',
      status: 'pending',
      inputBundleJson: bundle,
      inputBundleHash,
      baseVersionIds: [],
      modelName: this.modelName,
      metadata: {
        source: 'provider-service',
        bundle_version: 1
      }
    });

    void this.fetchImpl(this.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        job_id: Number(job.id)
      })
    }).catch(async (error) => {
      await this.markFailed(
        Number(job.id),
        error instanceof Error ? error.message : 'topic_projection_webhook_dispatch_failed',
        'webhook_dispatch_failed'
      ).catch(() => undefined);
    });

    return {
      requested: true,
      reason: 'scheduled',
      jobId: Number(job.id)
    };
  }

  async createLiveProjectionJob(
    state: SessionTranscriptState,
    params: { triggerType?: string; ledgerEventLimit?: number; status?: string } = {}
  ) {
    const bundle = await this.buildInputBundle(state, params);
    const inputBundleHash = this.hashInputBundle(bundle);
    const job = await this.createJob({
      chatSpaceType: bundle.chat_space_type,
      chatSpaceId: bundle.chat_space_id,
      triggerType: bundle.trigger_type,
      status: params.status || 'pending',
      inputBundleJson: bundle,
      inputBundleHash,
      baseVersionIds: [],
      modelName: this.modelName,
      metadata: {
        source: 'provider-service',
        bundle_version: 1
      }
    });

    return {
      jobId: Number(job.id),
      inputBundleHash,
      bundle
    };
  }
}

export default TopicProjectionService;

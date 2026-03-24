import { DatabaseManager } from './database';
import {
  AgentBeliefRecord,
  AgentFeedbackEventRecord,
  AgentFeedbackJudgement,
  AgentMemoryRecord,
  AgentMemoryScope,
  AgentMemorySourceKind,
  AgentMemoryType,
  AgentObservationRecord,
  AgentPlanRecord,
  AgentRelationshipBoundaryStrategy,
  AgentRelationshipImpressionProfile,
  AgentRelationshipMemoryBias,
  AgentRelationshipMemoryRecord,
  AgentRelationshipSpeechPolicy,
  AgentReflectionKind,
  AgentSelfModelRecord,
  AgentWalkCandidateRecord,
  QQMessage
} from '../types';
import { logger } from '../utils/logger';
import {
  CognitionEmbeddingScopeType,
  CognitionEmbeddingStore
} from './cognition-embedding-store';

const REFLECTION_POLL_INTERVAL_MS = 60_000;
const DEFAULT_HYBRID_CANDIDATE_LIMIT = 16;
const DEFAULT_MEMORY_HALF_LIFE_DAYS = 14;
const DEFAULT_EVIDENCE_HALF_LIFE_DAYS = 3;
const DEFAULT_BM25_K1 = 1.2;
const DEFAULT_BM25_B = 0.75;
const MAX_VIRTUAL_WALK_PLANNER_CALLS = 12;
const SILENT_FLUSH_MIN_PENDING_OBSERVATIONS = 12;
const SILENT_FLUSH_MAX_SOURCE_OBSERVATIONS = 6;
const SILENT_FLUSH_MIN_INTERVAL_MS = 30 * 60 * 1000;

interface HybridMemoryCandidate {
  memory: AgentMemoryRecord;
  semanticScore: number;
  structuredScore: number;
  lexicalScore: number;
  temporalScore: number;
  importanceScore: number;
  finalScore: number;
}

interface HybridEvidenceCandidate {
  observation: AgentObservationRecord;
  semanticScore: number;
  lexicalScore: number;
  relationScore: number;
  temporalScore: number;
  importanceScore: number;
  finalScore: number;
}

export interface AgentProactivityRuntimeConfig {
  followupEnabled: boolean;
  isPaused: boolean;
  allowedUserIds: number[];
  observedGroupIds: number[];
  allowedGroupIds: number[];
  maxPerRun: number;
  retryDelayMs: number;
}

export interface AgentProactivityControlState extends AgentProactivityRuntimeConfig {
  queuedFollowups: number;
  activeFollowups: number;
  recentActionLogCount: number;
  lastActionAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  source: 'database' | 'defaults';
}

type FeedbackEvaluationResult = {
  judgement: AgentFeedbackJudgement;
  reason_code: string;
  confidence?: number;
  explanation?: string;
  should_suppress?: boolean;
  llm_trace_id?: string | null;
  prompt_id?: string | null;
  prompt_name?: string | null;
  prompt_version?: number | null;
  tool_name?: string | null;
  tool_agent_type?: string | null;
  contract_status?: 'accepted' | 'fallback';
  contract_error_code?: string | null;
  explanation_json?: any;
};

type RelationshipInsightEvaluationResult = {
  relationship_summary?: string;
  interaction_style?: string;
  boundary_notes?: string;
  confidence?: number;
  boundary_strategy?: AgentRelationshipBoundaryStrategy | null;
  impression_profile?: AgentRelationshipImpressionProfile | null;
  speech_policy?: AgentRelationshipSpeechPolicy | null;
  memory_bias?: AgentRelationshipMemoryBias | null;
  llm_trace_id?: string | null;
  prompt_id?: string | null;
  prompt_name?: string | null;
  prompt_version?: number | null;
  tool_name?: string | null;
  tool_agent_type?: string | null;
  contract_status?: 'accepted' | 'fallback';
  contract_error_code?: string | null;
  notes_json?: any;
};

type WalkPlannerAction = 'observe' | 'speak' | 'suppress';

type WalkPlannerEvaluationResult = {
  action: WalkPlannerAction;
  selected_reason?: string;
  suppressed_reason?: string | null;
  goal?: string;
  trigger_condition?: string;
  draft_message?: string;
  tone_rationale?: string;
  confidence?: number;
  llm_trace_id?: string | null;
  prompt_id?: string | null;
  prompt_name?: string | null;
  prompt_version?: number | null;
  tool_name?: string | null;
  tool_agent_type?: string | null;
  contract_status?: 'accepted' | 'fallback';
  contract_error_code?: string | null;
};

type AgentMemoryServiceOptions = {
  feedbackEvaluator?: (params: {
    fieldKey: string;
    targetUserId: number | null;
    targetGroupId: number | null;
    actionLog: {
      id: number;
      action_type: string;
      status: string;
      occurred_at: Date;
      payload_json: any;
    };
    subsequentObservations: AgentObservationRecord[];
    relationship: AgentRelationshipMemoryRecord | null;
    fallback: FeedbackEvaluationResult;
    now: Date;
  }) => Promise<FeedbackEvaluationResult | null>;
  relationshipInsightEvaluator?: (params: {
    targetUserId: number;
    groupId: number | null;
    fieldScope: 'private_chat' | 'group_chat';
    memories: AgentMemoryRecord[];
    beliefs: AgentBeliefRecord[];
    auxiliaryMemories: AgentMemoryRecord[];
    observations: AgentObservationRecord[];
    actionRows: any[];
    existingSnapshot: AgentRelationshipMemoryRecord | null;
    reflectionKind: AgentReflectionKind;
    fallback: RelationshipInsightEvaluationResult;
    now: Date;
  }) => Promise<RelationshipInsightEvaluationResult | null>;
  walkPlannerEvaluator?: (params: {
    field: {
      fieldKey: string;
      fieldScope: 'private_chat' | 'group_chat' | 'thread' | 'tool_channel';
      targetUserId: number | null;
      targetGroupId: number | null;
      title: string;
      latestObservationExcerpt: string | null;
      priorityScore: number;
      inboundScore: number;
      relationshipScore: number;
      planScore: number;
      noveltyScore: number;
      cooldownPenalty: number;
      boundaryPenalty: number;
      activePlanCount: number;
      actionCount: number;
      triggerSources: string[];
      hardSuppressionReason: string | null;
      latestActionAt: Date | null;
      latestIncomingAt: Date | null;
      latestFeedbackJudgement: AgentFeedbackJudgement | null;
      latestFeedbackReasonCode: string | null;
    };
    relationship: AgentRelationshipMemoryRecord | null;
    strategicPlans: AgentPlanRecord[];
    sourceMemories: AgentMemoryRecord[];
    sourceBeliefs: AgentBeliefRecord[];
    now: Date;
  }) => Promise<WalkPlannerEvaluationResult | null>;
};

export class AgentMemoryService {
  private readonly moduleLogger = logger.createModuleLogger('agent-memory-service');
  private lastReflectionCheckAt = 0;
  private readonly feedbackEvaluator?: AgentMemoryServiceOptions['feedbackEvaluator'];
  private readonly relationshipInsightEvaluator?: AgentMemoryServiceOptions['relationshipInsightEvaluator'];
  private readonly walkPlannerEvaluator?: AgentMemoryServiceOptions['walkPlannerEvaluator'];

  constructor(
    private readonly database: DatabaseManager,
    private readonly embeddingStore?: CognitionEmbeddingStore,
    options?: AgentMemoryServiceOptions
  ) {
    this.feedbackEvaluator = options?.feedbackEvaluator;
    this.relationshipInsightEvaluator = options?.relationshipInsightEvaluator;
    this.walkPlannerEvaluator = options?.walkPlannerEvaluator;
  }

  public async maybePromoteBelief(
    beliefId: number,
    options?: {
      evidenceObservationId?: number | null;
      sourceKind?: AgentMemorySourceKind;
    }
  ): Promise<AgentMemoryRecord | null> {
    const belief = await this.getBeliefById(beliefId);
    if (!belief) {
      return null;
    }

    return this.promoteBeliefRecord(belief, {
      evidenceObservationId: options?.evidenceObservationId ?? belief.last_evidence_id ?? null,
      sourceKind: options?.sourceKind
    });
  }

  public async runScheduledReflectionsIfDue(now: Date = new Date()): Promise<void> {
    const nowTs = now.getTime();
    if (nowTs - this.lastReflectionCheckAt < REFLECTION_POLL_INTERVAL_MS) {
      return;
    }
    this.lastReflectionCheckAt = nowTs;

    const dailyKey = `daily:${now.toISOString().slice(0, 10)}`;
    const weeklyKey = `weekly:${this.getIsoWeekKey(now)}`;

    if (!(await this.reflectionExists(dailyKey))) {
      await this.runReflection('daily', dailyKey, now);
    }

    if (!(await this.reflectionExists(weeklyKey))) {
      await this.runReflection('weekly', weeklyKey, now);
    }

    await this.ensureDerivedCognitionState(now);
    await this.materializeVirtualWalkState(now);
  }

  public async materializeVirtualWalkState(now: Date = new Date()): Promise<{
    fieldCount: number;
    edgeCount: number;
    scoreCount: number;
    candidateCount: number;
  }> {
    const [
      hasFields,
      hasScores,
      hasObservations,
      hasRelationships,
      hasPlans,
      hasActionLogs,
      hasCandidates,
      hasFeedbackEvents,
      hasBeliefs,
      hasMemories
    ] = await Promise.all([
      this.hasTable('agent_social_fields'),
      this.hasTable('agent_field_scores'),
      this.hasTable('agent_observations'),
      this.hasTable('agent_relationship_memories'),
      this.hasTable('agent_plans'),
      this.hasTable('agent_action_logs'),
      this.hasTable('agent_walk_candidates'),
      this.hasTable('agent_feedback_events'),
      this.hasTable('agent_beliefs'),
      this.hasTable('agent_memories')
    ]);

    if (!hasFields || !hasScores || !hasObservations || !hasRelationships || !hasPlans || !hasActionLogs) {
      return {
        fieldCount: 0,
        edgeCount: 0,
        scoreCount: 0,
        candidateCount: 0
      };
    }

    const horizonStart = new Date(now.getTime() - 72 * 60 * 60 * 1000);
    const strongSignalHorizon = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const actionHorizonStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [
      observationRows,
      relationshipRows,
      planRows,
      actionRows,
      beliefRows,
      memoryRows
    ] = await Promise.all([
      this.database.executeQuery<any>(
        `
          SELECT id, trace_id, conversation_id, source_type, field_scope, message_type, user_id, group_id, subject_user_id, counterparty_ids, content, tool_payload_ref, raw_payload, occurred_at, created_at
          FROM agent_observations
          WHERE occurred_at >= ?
          ORDER BY occurred_at DESC, id DESC
          LIMIT 600
        `,
        [horizonStart]
      ),
      this.database.executeQuery<any>(
        `
          SELECT *
          FROM agent_relationship_memories
          WHERE is_current = 1
            AND status = 'active'
        `
      ),
      this.database.executeQuery<any>(
        `
          SELECT *
          FROM agent_plans
          WHERE status IN ('queued', 'active')
          ORDER BY updated_at DESC, id DESC
          LIMIT 400
        `
      ),
      this.database.executeQuery<any>(
        `
          SELECT id, target_user_id, target_group_id, status, occurred_at, action_type, source_plan_id, payload_json
          FROM agent_action_logs
          WHERE occurred_at >= ?
          ORDER BY occurred_at DESC, id DESC
          LIMIT 500
        `,
        [actionHorizonStart]
      ),
      hasBeliefs
        ? this.database.executeQuery<any>(
            `
              SELECT *
              FROM agent_beliefs
              WHERE status = 'active'
                AND subject_type = 'user'
                AND belief_type IN ('relationship', 'commitment')
                AND last_observed_at >= ?
              ORDER BY confidence DESC, last_observed_at DESC, id DESC
              LIMIT 240
            `,
            [strongSignalHorizon]
          )
        : Promise.resolve([]),
      hasMemories
        ? this.database.executeQuery<any>(
            `
              SELECT *
              FROM agent_memories
              WHERE status = 'active'
                AND subject_type = 'user'
                AND memory_type IN ('relationship', 'commitment')
                AND last_observed_at >= ?
              ORDER BY salience DESC, confidence DESC, last_observed_at DESC, id DESC
              LIMIT 240
            `,
            [strongSignalHorizon]
          )
        : Promise.resolve([])
    ]);

    type FieldAccumulator = {
      field_key: string;
      field_scope: 'private_chat' | 'group_chat' | 'thread' | 'tool_channel';
      user_id: number | null;
      group_id: number | null;
      thread_key: string | null;
      title: string;
      status: 'active' | 'suppressed' | 'archived';
      last_active_at: Date;
      observation_count: number;
      inbound_observation_count: number;
      action_count: number;
      active_plan_count: number;
      latest_action_at: Date | null;
      latest_incoming_at: Date | null;
      latest_negative_feedback_at: Date | null;
      latest_positive_feedback_at: Date | null;
      latest_feedback_judgement: AgentFeedbackJudgement | null;
      latest_feedback_reason_code: string | null;
      relationship: AgentRelationshipMemoryRecord | null;
      source_observation_ids: number[];
      plan_ids: number[];
      strategic_plan_ids: number[];
      commitment_memory_ids: number[];
      commitment_belief_ids: number[];
      relationship_belief_ids: number[];
      latest_observation_excerpt: string | null;
    };

    const observations = observationRows.map(row => this.mapAgentObservationRow(row));
    const relationships = relationshipRows.map(row => this.mapAgentRelationshipMemoryRow(row));
    const plans = planRows.map(row => this.mapAgentPlanRow(row));
    const beliefs = beliefRows.map(row => this.mapAgentBeliefRow(row));
    const memories = memoryRows.map(row => this.mapAgentMemoryRow(row));

    const relationshipByKey = new Map<string, AgentRelationshipMemoryRecord>();
    relationships.forEach(relationship => {
      relationshipByKey.set(`${relationship.target_user_id}:${relationship.group_id ?? 'global'}`, relationship);
    });

    const commitmentMemoriesByUser = new Map<number, AgentMemoryRecord[]>();
    const relationshipMemoriesByUser = new Map<number, AgentMemoryRecord[]>();
    memories.forEach(memory => {
      const targetUserId = memory.user_id ?? this.parseNumericId(memory.subject_id);
      if (!targetUserId) {
        return;
      }

      if (memory.memory_type === 'commitment') {
        const existing = commitmentMemoriesByUser.get(targetUserId) ?? [];
        existing.push(memory);
        commitmentMemoriesByUser.set(targetUserId, existing);
      }

      if (memory.memory_type === 'relationship') {
        const existing = relationshipMemoriesByUser.get(targetUserId) ?? [];
        existing.push(memory);
        relationshipMemoriesByUser.set(targetUserId, existing);
      }
    });

    const commitmentBeliefsByUser = new Map<number, AgentBeliefRecord[]>();
    const relationshipBeliefsByUser = new Map<number, AgentBeliefRecord[]>();
    beliefs.forEach(belief => {
      const targetUserId = this.parseNumericId(belief.subject_id);
      if (!targetUserId) {
        return;
      }

      if (belief.belief_type === 'commitment') {
        const existing = commitmentBeliefsByUser.get(targetUserId) ?? [];
        existing.push(belief);
        commitmentBeliefsByUser.set(targetUserId, existing);
      }

      if (belief.belief_type === 'relationship') {
        const existing = relationshipBeliefsByUser.get(targetUserId) ?? [];
        existing.push(belief);
        relationshipBeliefsByUser.set(targetUserId, existing);
      }
    });

    const strategicPlans = plans.filter(plan =>
      (plan.plan_type === 'weekly_focus' || plan.plan_type === 'day_plan') &&
      plan.status !== 'cancelled'
    );
    const persistedProactivityRow = await this.getPersistedProactivityControlRow();
    const proactivityConfig = persistedProactivityRow
      ? this.mapPersistedProactivityControlRow(persistedProactivityRow)
      : this.normalizeProactivityConfig({});
    const observedGroupIds = new Set(proactivityConfig.observedGroupIds);
    const allowedGroupIds = new Set(proactivityConfig.allowedGroupIds);

    const fields = new Map<string, FieldAccumulator>();
    const edgeUpserts = new Map<string, {
      source_field_key: string;
      target_field_key: string;
      edge_type: 'user_bridge' | 'plan_entry' | 'tool_entry';
      weight: number;
      last_observed_at: Date;
    }>();

    const ensureField = (params: {
      fieldKey: string;
      fieldScope: 'private_chat' | 'group_chat' | 'thread' | 'tool_channel';
      userId?: number | null;
      groupId?: number | null;
      threadKey?: string | null;
      title: string;
      status?: 'active' | 'suppressed' | 'archived';
      observedAt: Date;
    }): FieldAccumulator => {
      const existing = fields.get(params.fieldKey);
      if (existing) {
        if (params.observedAt > existing.last_active_at) {
          existing.last_active_at = params.observedAt;
        }
        if (existing.status !== 'suppressed' && params.status === 'suppressed') {
          existing.status = 'suppressed';
        }
        return existing;
      }

      const created: FieldAccumulator = {
        field_key: params.fieldKey,
        field_scope: params.fieldScope,
        user_id: params.userId ?? null,
        group_id: params.groupId ?? null,
        thread_key: params.threadKey ?? null,
        title: params.title,
        status: params.status ?? 'active',
        last_active_at: params.observedAt,
        observation_count: 0,
        inbound_observation_count: 0,
        action_count: 0,
        active_plan_count: 0,
        latest_action_at: null,
        latest_incoming_at: null,
        latest_negative_feedback_at: null,
        latest_positive_feedback_at: null,
        latest_feedback_judgement: null,
        latest_feedback_reason_code: null,
        relationship: null,
        source_observation_ids: [],
        plan_ids: [],
        strategic_plan_ids: [],
        commitment_memory_ids: [],
        commitment_belief_ids: [],
        relationship_belief_ids: [],
        latest_observation_excerpt: null
      };
      fields.set(params.fieldKey, created);
      return created;
    };

    const upsertEdge = (params: {
      sourceFieldKey: string;
      targetFieldKey: string;
      edgeType: 'user_bridge' | 'plan_entry' | 'tool_entry';
      weight: number;
      observedAt: Date;
    }) => {
      const key = `${params.sourceFieldKey}:${params.targetFieldKey}:${params.edgeType}`;
      const existing = edgeUpserts.get(key);
      if (!existing) {
        edgeUpserts.set(key, {
          source_field_key: params.sourceFieldKey,
          target_field_key: params.targetFieldKey,
          edge_type: params.edgeType,
          weight: params.weight,
          last_observed_at: params.observedAt
        });
        return;
      }

      existing.weight = Math.max(existing.weight, params.weight);
      if (params.observedAt > existing.last_observed_at) {
        existing.last_observed_at = params.observedAt;
      }
    };

    observations.forEach(observation => {
      const isInbound = observation.source_type === 'incoming_message' || observation.source_type === 'reply_anchor';
      const isNegative = isInbound && this.hasExplicitRejectionSignal(observation.content);

      if (observation.user_id) {
        const field = ensureField({
          fieldKey: `private:user:${observation.user_id}`,
          fieldScope: 'private_chat',
          userId: observation.user_id,
          title: `私聊·用户${observation.user_id}`,
          observedAt: observation.occurred_at
        });
        field.observation_count += 1;
        if (isInbound) {
          field.inbound_observation_count += 1;
          field.latest_incoming_at = field.latest_incoming_at && field.latest_incoming_at > observation.occurred_at
            ? field.latest_incoming_at
            : observation.occurred_at;
        }
        if (isNegative) {
          field.latest_negative_feedback_at = field.latest_negative_feedback_at && field.latest_negative_feedback_at > observation.occurred_at
            ? field.latest_negative_feedback_at
            : observation.occurred_at;
        }
        field.source_observation_ids.push(observation.id);
        if (!field.latest_observation_excerpt) {
          field.latest_observation_excerpt = this.truncateForFlush(observation.content, 80);
        }
      }

      if (observation.group_id) {
        const groupField = ensureField({
          fieldKey: `group:${observation.group_id}`,
          fieldScope: 'group_chat',
          groupId: observation.group_id,
          title: `群聊·群组${observation.group_id}`,
          observedAt: observation.occurred_at
        });
        groupField.observation_count += 1;
        if (isInbound) {
          groupField.inbound_observation_count += 1;
          groupField.latest_incoming_at = groupField.latest_incoming_at && groupField.latest_incoming_at > observation.occurred_at
            ? groupField.latest_incoming_at
            : observation.occurred_at;
        }
        if (isNegative) {
          groupField.latest_negative_feedback_at = groupField.latest_negative_feedback_at && groupField.latest_negative_feedback_at > observation.occurred_at
            ? groupField.latest_negative_feedback_at
            : observation.occurred_at;
        }
        groupField.source_observation_ids.push(observation.id);
        if (!groupField.latest_observation_excerpt) {
          groupField.latest_observation_excerpt = this.truncateForFlush(observation.content, 80);
        }

        if (observation.user_id) {
          upsertEdge({
            sourceFieldKey: `private:user:${observation.user_id}`,
            targetFieldKey: `group:${observation.group_id}`,
            edgeType: 'user_bridge',
            weight: groupField.observation_count,
            observedAt: observation.occurred_at
          });
        }
      }

      if (observation.field_scope === 'tool_channel' && observation.tool_payload_ref) {
        const toolKey = this.normalizeText(observation.tool_payload_ref).replace(/\s+/g, '-').slice(0, 80) || 'default';
        const toolFieldKey = `tool:${toolKey}`;
        const toolField = ensureField({
          fieldKey: toolFieldKey,
          fieldScope: 'tool_channel',
          title: `工具入口·${toolKey}`,
          observedAt: observation.occurred_at
        });
        toolField.observation_count += 1;
        if (isInbound) {
          toolField.inbound_observation_count += 1;
        }
        toolField.source_observation_ids.push(observation.id);
        if (!toolField.latest_observation_excerpt) {
          toolField.latest_observation_excerpt = this.truncateForFlush(observation.content, 80);
        }
        upsertEdge({
          sourceFieldKey: toolFieldKey,
          targetFieldKey: toolFieldKey,
          edgeType: 'tool_entry',
          weight: toolField.observation_count,
          observedAt: observation.occurred_at
        });
      }
    });

    relationships.forEach(relationship => {
      const fieldKey = relationship.group_id
        ? `group:${relationship.group_id}`
        : `private:user:${relationship.target_user_id}`;
      const field = ensureField({
        fieldKey,
        fieldScope: relationship.group_id ? 'group_chat' : 'private_chat',
        userId: relationship.group_id ? null : relationship.target_user_id,
        groupId: relationship.group_id ?? null,
        title: relationship.group_id
          ? `群聊·群组${relationship.group_id}`
          : `私聊·用户${relationship.target_user_id}`,
        status: relationship.boundary_strategy && relationship.boundary_strategy !== 'allow_proactive'
          ? 'suppressed'
          : 'active',
        observedAt: relationship.last_observed_at
      });
      field.relationship = relationship;
      if (relationship.boundary_strategy && relationship.boundary_strategy !== 'allow_proactive') {
        field.status = 'suppressed';
      }
    });

    plans.forEach(plan => {
      let fieldKey: string | null = null;
      let fieldScope: FieldAccumulator['field_scope'] = 'private_chat';
      let title = '计划';

      if (plan.target_group_id) {
        fieldKey = `group:${plan.target_group_id}`;
        fieldScope = 'group_chat';
        title = `群聊·群组${plan.target_group_id}`;
      } else if (plan.target_user_id) {
        fieldKey = `private:user:${plan.target_user_id}`;
        fieldScope = 'private_chat';
        title = `私聊·用户${plan.target_user_id}`;
      }

      if (fieldKey) {
        const observedAt = plan.updated_at ?? plan.created_at;
        const field = ensureField({
          fieldKey,
          fieldScope,
          userId: plan.target_user_id ?? null,
          groupId: plan.target_group_id ?? null,
          title,
          observedAt
        });
        field.active_plan_count += 1;
        field.plan_ids.push(plan.id);
        upsertEdge({
          sourceFieldKey: fieldKey,
          targetFieldKey: fieldKey,
          edgeType: 'plan_entry',
          weight: field.active_plan_count,
          observedAt
        });
      }

      if (plan.plan_type === 'weekly_focus' || plan.plan_type === 'day_plan') {
        for (const field of fields.values()) {
          field.strategic_plan_ids.push(plan.id);
        }
      }
    });

    actionRows.forEach(row => {
      const observedAt = this.parseDate(row.occurred_at);
      if (row.target_user_id) {
        const field = ensureField({
          fieldKey: `private:user:${Number(row.target_user_id)}`,
          fieldScope: 'private_chat',
          userId: Number(row.target_user_id),
          title: `私聊·用户${row.target_user_id}`,
          observedAt
        });
        field.action_count += 1;
        field.latest_action_at = field.latest_action_at && field.latest_action_at > observedAt
          ? field.latest_action_at
          : observedAt;
      }

      if (row.target_group_id) {
        const groupField = ensureField({
          fieldKey: `group:${Number(row.target_group_id)}`,
          fieldScope: 'group_chat',
          groupId: Number(row.target_group_id),
          title: `群聊·群组${row.target_group_id}`,
          observedAt
        });
        groupField.action_count += 1;
        groupField.latest_action_at = groupField.latest_action_at && groupField.latest_action_at > observedAt
          ? groupField.latest_action_at
          : observedAt;
      }
    });

    const feedbackEvents = hasFeedbackEvents
      ? await this.ensureFeedbackEvents({
          now,
          actionRows,
          observations,
          relationships,
          fields
        })
      : [];

    feedbackEvents.forEach(event => {
      const field = fields.get(event.field_key);
      if (!field) {
        return;
      }

      if (event.judgement === 'negative') {
        field.latest_negative_feedback_at = field.latest_negative_feedback_at && field.latest_negative_feedback_at > event.occurred_at
          ? field.latest_negative_feedback_at
          : event.occurred_at;
      }

      if (event.judgement === 'positive') {
        field.latest_positive_feedback_at = field.latest_positive_feedback_at && field.latest_positive_feedback_at > event.occurred_at
          ? field.latest_positive_feedback_at
          : event.occurred_at;
      }

      if (!field.latest_feedback_judgement || !field.latest_feedback_reason_code) {
        field.latest_feedback_judgement = event.judgement;
        field.latest_feedback_reason_code = event.reason_code;
        return;
      }

      const latestFeedbackAt = event.occurred_at;
      const currentLatestAt = field.latest_negative_feedback_at
        ?? field.latest_positive_feedback_at
        ?? null;
      if (!currentLatestAt || latestFeedbackAt >= currentLatestAt) {
        field.latest_feedback_judgement = event.judgement;
        field.latest_feedback_reason_code = event.reason_code;
      }
    });

    if (strategicPlans.length > 0) {
      for (const field of fields.values()) {
        field.strategic_plan_ids = this.uniqueNumbers([
          ...field.strategic_plan_ids,
          ...strategicPlans.map(plan => plan.id)
        ]);
      }
    }

    for (const field of fields.values()) {
      if (field.user_id) {
        field.commitment_memory_ids = (commitmentMemoriesByUser.get(field.user_id) ?? []).map(memory => memory.id);
        field.commitment_belief_ids = (commitmentBeliefsByUser.get(field.user_id) ?? []).map(belief => belief.id);
        field.relationship_belief_ids = (relationshipBeliefsByUser.get(field.user_id) ?? []).map(belief => belief.id);
      }
    }

    const fieldKeys = Array.from(fields.keys());
    const candidateRows: Array<Omit<AgentWalkCandidateRecord, 'id' | 'created_at'>> = [];
    if (fieldKeys.length > 0) {
      let remainingPlannerCalls = this.walkPlannerEvaluator ? MAX_VIRTUAL_WALK_PLANNER_CALLS : 0;
      for (const field of fields.values()) {
        const observeEnabled = field.group_id ? observedGroupIds.has(field.group_id) : true;
        const proactiveEnabled = field.group_id ? allowedGroupIds.has(field.group_id) : true;
        const lastActionHours = field.latest_action_at
          ? Math.max(0, (now.getTime() - field.latest_action_at.getTime()) / (60 * 60 * 1000))
          : null;
        const hasNoResponseNegativeFeedback = Boolean(
          field.latest_action_at &&
          lastActionHours !== null &&
          lastActionHours >= 48 &&
          (!field.latest_incoming_at || field.latest_incoming_at <= field.latest_action_at)
        );
        const hasPositiveFeedback = Boolean(
          field.latest_positive_feedback_at ||
          (
            field.latest_action_at &&
            field.latest_incoming_at &&
            field.latest_incoming_at > field.latest_action_at &&
            !field.latest_negative_feedback_at
          )
        );
        const hasUnknownRelationship = field.field_scope === 'private_chat' && !field.relationship;
        const hasStrategicDirection = strategicPlans.length > 0;
        const hasRelationshipTrigger = this.isRelationshipTriggerActive({
          relationship: field.relationship,
          latestActionAt: field.latest_action_at,
          latestIncomingAt: field.latest_incoming_at,
          now
        });
        const triggerSources = this.uniqueStrings([
          ...(hasStrategicDirection ? strategicPlans.map(plan => plan.plan_type) : []),
          ...(field.commitment_memory_ids.length > 0 ? ['commitment_memory'] : []),
          ...(field.commitment_belief_ids.length > 0 ? ['commitment_belief'] : []),
          ...(hasRelationshipTrigger ? ['relationship_trigger'] : [])
        ]);

        const inboundScore = this.clampScore(field.inbound_observation_count / 5);
        const relationshipBaseScore = field.relationship?.confidence ?? 0;
        const relationshipScore = this.clampScore(relationshipBaseScore + (hasPositiveFeedback ? 0.1 : 0));
        const planScore = this.clampScore(field.active_plan_count * 0.5 + (hasStrategicDirection ? 0.25 : 0));
        const noveltyScore = this.clampScore(lastActionHours === null ? 1 : Math.min(1, lastActionHours / 72));
        const cooldownPenalty = lastActionHours === null
          ? 0
          : this.clampScore((24 - lastActionHours) / 24) * 0.35;
        const boundaryPenalty = field.relationship?.boundary_strategy === 'do_not_contact'
          ? 1
          : field.relationship?.boundary_strategy === 'observe_only'
            ? 0.45
            : hasUnknownRelationship
              ? 0.55
              : 0;
        const hardSuppressionReason = this.buildWalkSuppressionReason({
          fieldScope: field.field_scope,
          relationship: field.relationship,
          cooldownPenalty,
          hasUnknownRelationship,
          hasNegativeFeedback: hasNoResponseNegativeFeedback || Boolean(field.latest_negative_feedback_at),
          hasStrongTrigger: triggerSources.length > 0,
          targetUserId: field.user_id,
          targetGroupId: field.group_id,
          observeEnabled,
          proactiveEnabled
        });
        const priorityScore = this.clampScore(
          inboundScore * 0.35 +
          relationshipScore * 0.25 +
          planScore * 0.2 +
          noveltyScore * 0.2 -
          cooldownPenalty -
          boundaryPenalty
        );
        const plannerEligible = Boolean(
          this.walkPlannerEvaluator &&
          remainingPlannerCalls > 0 &&
          (priorityScore >= 0.35 || triggerSources.length > 0 || Boolean(field.relationship))
        );
        const sourceMemories = field.user_id
          ? [
              ...(commitmentMemoriesByUser.get(field.user_id) ?? []),
              ...(relationshipMemoriesByUser.get(field.user_id) ?? [])
            ]
          : [];
        const sourceBeliefs = field.user_id
          ? [
              ...(commitmentBeliefsByUser.get(field.user_id) ?? []),
              ...(relationshipBeliefsByUser.get(field.user_id) ?? [])
            ]
          : [];
        const plannerResult = plannerEligible
          ? await this.evaluateWalkPlanner({
              field: {
                fieldKey: field.field_key,
                fieldScope: field.field_scope,
                targetUserId: field.user_id,
                targetGroupId: field.group_id,
                title: field.title,
                latestObservationExcerpt: field.latest_observation_excerpt,
                priorityScore,
                inboundScore,
                relationshipScore,
                planScore,
                noveltyScore,
                cooldownPenalty,
                boundaryPenalty,
                activePlanCount: field.active_plan_count,
                actionCount: field.action_count,
                triggerSources,
                hardSuppressionReason,
                latestActionAt: field.latest_action_at,
                latestIncomingAt: field.latest_incoming_at,
                latestFeedbackJudgement: field.latest_feedback_judgement,
                latestFeedbackReasonCode: field.latest_feedback_reason_code
              },
              relationship: field.relationship,
              strategicPlans,
              sourceMemories,
              sourceBeliefs,
              now
            })
          : null;
        if (plannerEligible) {
          remainingPlannerCalls -= 1;
        }
        const plannerAction = plannerResult?.action ?? (hardSuppressionReason ? 'suppress' : triggerSources.length > 0 ? 'speak' : 'observe');
        const rawSuppressionReason = hardSuppressionReason
          ?? (plannerAction === 'suppress'
            ? plannerResult?.suppressed_reason ?? 'planner_suppressed'
            : plannerAction === 'observe'
              ? plannerResult?.suppressed_reason ?? 'planner_observe'
              : null);
        const suppressionReason = rawSuppressionReason
          ? this.truncateForFlush(rawSuppressionReason, 96)
          : null;
        const canSpeakNow = suppressionReason === null &&
          plannerAction === 'speak' &&
          Boolean(field.user_id || field.group_id) &&
          triggerSources.length > 0;
        const rawSelectedReason = plannerResult?.selected_reason
          ?? this.buildWalkSelectedReason(field, triggerSources);
        const selectedReason = this.truncateForFlush(rawSelectedReason, 96);

        await this.database.executeUpdate(
          `
            INSERT INTO agent_social_fields (
              field_key,
              field_scope,
              user_id,
              group_id,
              thread_key,
              title,
              status,
              last_active_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              field_scope = VALUES(field_scope),
              user_id = VALUES(user_id),
              group_id = VALUES(group_id),
              thread_key = VALUES(thread_key),
              title = VALUES(title),
              status = VALUES(status),
              last_active_at = VALUES(last_active_at),
              updated_at = CURRENT_TIMESTAMP(3)
          `,
          [
            field.field_key,
            field.field_scope,
            field.user_id,
            field.group_id,
            field.thread_key,
            field.title,
            canSpeakNow ? field.status : 'suppressed',
            field.last_active_at
          ]
        );

        await this.database.executeInsertAndReturnId(
          `
            INSERT INTO agent_field_scores (
              field_key,
              priority_score,
              inbound_score,
              relationship_score,
              plan_score,
              novelty_score,
              cooldown_penalty,
              boundary_penalty,
              suppression_reason,
              explanation_json,
              computed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              priority_score = VALUES(priority_score),
              inbound_score = VALUES(inbound_score),
              relationship_score = VALUES(relationship_score),
              plan_score = VALUES(plan_score),
              novelty_score = VALUES(novelty_score),
              cooldown_penalty = VALUES(cooldown_penalty),
              boundary_penalty = VALUES(boundary_penalty),
              suppression_reason = VALUES(suppression_reason),
              explanation_json = VALUES(explanation_json),
              computed_at = VALUES(computed_at)
          `,
          [
            field.field_key,
            priorityScore,
            inboundScore,
            relationshipScore,
            planScore,
            noveltyScore,
            cooldownPenalty,
            boundaryPenalty,
            suppressionReason,
            JSON.stringify({
              observation_count: field.observation_count,
              inbound_observation_count: field.inbound_observation_count,
              action_count: field.action_count,
              active_plan_count: field.active_plan_count,
              relationship_summary: field.relationship?.relationship_summary ?? null,
              boundary_strategy: field.relationship?.boundary_strategy ?? null,
              impression_profile: field.relationship?.impression_profile ?? null,
              speech_policy: field.relationship?.speech_policy ?? null,
              memory_bias: field.relationship?.memory_bias ?? null,
              latest_observation_excerpt: field.latest_observation_excerpt,
              source_observation_ids: field.source_observation_ids.slice(0, 12),
              trigger_sources: triggerSources,
              planner_action: plannerAction,
              planner_selected_reason: rawSelectedReason,
              planner_suppressed_reason: rawSuppressionReason,
              planner_goal: plannerResult?.goal ?? null,
              planner_trigger_condition: plannerResult?.trigger_condition ?? null,
              planner_draft_message: plannerResult?.draft_message ?? null,
              planner_tone_rationale: plannerResult?.tone_rationale ?? null,
              planner_llm_trace_id: plannerResult?.llm_trace_id ?? null,
              planner_prompt_id: plannerResult?.prompt_id ?? null,
              planner_prompt_name: plannerResult?.prompt_name ?? null,
              planner_prompt_version: plannerResult?.prompt_version ?? null,
              planner_tool_name: plannerResult?.tool_name ?? null,
              planner_tool_agent_type: plannerResult?.tool_agent_type ?? null,
              planner_contract_status: plannerResult?.contract_status ?? null,
              planner_contract_error_code: plannerResult?.contract_error_code ?? null,
              can_speak_now: canSpeakNow,
              latest_feedback_judgement: field.latest_feedback_judgement,
              latest_feedback_reason_code: field.latest_feedback_reason_code,
              observe_enabled: observeEnabled,
              proactive_enabled: proactiveEnabled
            }),
            now
          ]
        );

        if (hasCandidates) {
          const sourcePlanIds = this.uniqueNumbers([...field.plan_ids, ...field.strategic_plan_ids]);
          const sourceMemoryIds = this.uniqueNumbers([
            ...field.commitment_memory_ids,
            ...((field.user_id ? relationshipMemoriesByUser.get(field.user_id) ?? [] : []).map(memory => memory.id))
          ]);
          const sourceBeliefIds = this.uniqueNumbers([
            ...field.commitment_belief_ids,
            ...field.relationship_belief_ids
          ]);
          candidateRows.push({
            field_key: field.field_key,
            field_scope: field.field_scope,
            target_user_id: field.user_id,
            target_group_id: field.group_id,
            priority_score: priorityScore,
            selected_reason: selectedReason,
            suppressed_reason: suppressionReason,
            can_speak_now: canSpeakNow,
            source_relationship_id: field.relationship?.id ?? null,
            source_plan_ids_json: sourcePlanIds,
            source_memory_ids_json: sourceMemoryIds,
            source_belief_ids_json: sourceBeliefIds,
            trigger_sources_json: triggerSources,
            compiler_inputs_json: {
              field_key: field.field_key,
              target_user_id: field.user_id,
              target_group_id: field.group_id,
              strategic_plan_ids: field.strategic_plan_ids,
              direct_plan_ids: field.plan_ids,
              commitment_memory_ids: field.commitment_memory_ids,
              commitment_belief_ids: field.commitment_belief_ids,
              relationship_belief_ids: field.relationship_belief_ids,
              relationship_snapshot_id: field.relationship?.id ?? null,
              latest_observation_excerpt: field.latest_observation_excerpt,
              latest_action_at: field.latest_action_at?.toISOString() ?? null,
              latest_incoming_at: field.latest_incoming_at?.toISOString() ?? null,
              planner_action: plannerAction,
              planner_goal: plannerResult?.goal ?? null,
              planner_trigger_condition: plannerResult?.trigger_condition ?? null,
              draft_message: plannerResult?.draft_message ?? null,
              tone_rationale: plannerResult?.tone_rationale ?? null,
              planner_llm_trace_id: plannerResult?.llm_trace_id ?? null,
              planner_prompt_id: plannerResult?.prompt_id ?? null,
              planner_prompt_name: plannerResult?.prompt_name ?? null,
              planner_prompt_version: plannerResult?.prompt_version ?? null,
              planner_tool_name: plannerResult?.tool_name ?? null,
              planner_tool_agent_type: plannerResult?.tool_agent_type ?? null,
              planner_contract_status: plannerResult?.contract_status ?? null,
              planner_contract_error_code: plannerResult?.contract_error_code ?? null,
              relationship_insight: field.relationship
                ? {
                    impression_profile: field.relationship.impression_profile ?? null,
                    speech_policy: field.relationship.speech_policy ?? null,
                    memory_bias: field.relationship.memory_bias ?? null
                  }
                : null
            },
            computed_at: now
          });
        }
      }

      await this.database.executeUpdate(
        `
          UPDATE agent_social_fields
          SET
            status = 'archived',
            updated_at = CURRENT_TIMESTAMP(3)
          WHERE field_key NOT IN (${fieldKeys.map(() => '?').join(',')})
        `,
        fieldKeys
      );
    }

    if (await this.hasTable('agent_social_edges')) {
      await this.database.executeUpdate(`DELETE FROM agent_social_edges`);
      for (const edge of edgeUpserts.values()) {
        await this.database.executeInsertAndReturnId(
          `
            INSERT INTO agent_social_edges (
              source_field_key,
              target_field_key,
              edge_type,
              weight,
              last_observed_at
            ) VALUES (?, ?, ?, ?, ?)
          `,
          [
            edge.source_field_key,
            edge.target_field_key,
            edge.edge_type,
            edge.weight,
            edge.last_observed_at
          ]
        );
      }
    }

    if (hasCandidates) {
      await this.database.executeUpdate(
        `
          DELETE FROM agent_walk_candidates
          WHERE computed_at < ?
        `,
        [new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)]
      );

      for (const candidate of candidateRows) {
        await this.database.executeInsertAndReturnId(
          `
            INSERT INTO agent_walk_candidates (
              field_key,
              field_scope,
              target_user_id,
              target_group_id,
              priority_score,
              selected_reason,
              suppressed_reason,
              can_speak_now,
              source_relationship_id,
              source_plan_ids_json,
              source_memory_ids_json,
              source_belief_ids_json,
              trigger_sources_json,
              compiler_inputs_json,
              computed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              field_scope = VALUES(field_scope),
              target_user_id = VALUES(target_user_id),
              target_group_id = VALUES(target_group_id),
              priority_score = VALUES(priority_score),
              selected_reason = VALUES(selected_reason),
              suppressed_reason = VALUES(suppressed_reason),
              can_speak_now = VALUES(can_speak_now),
              source_relationship_id = VALUES(source_relationship_id),
              source_plan_ids_json = VALUES(source_plan_ids_json),
              source_memory_ids_json = VALUES(source_memory_ids_json),
              source_belief_ids_json = VALUES(source_belief_ids_json),
              trigger_sources_json = VALUES(trigger_sources_json),
              compiler_inputs_json = VALUES(compiler_inputs_json),
              computed_at = VALUES(computed_at)
          `,
          [
            candidate.field_key,
            candidate.field_scope,
            candidate.target_user_id ?? null,
            candidate.target_group_id ?? null,
            candidate.priority_score,
            candidate.selected_reason,
            candidate.suppressed_reason ?? null,
            candidate.can_speak_now ? 1 : 0,
            candidate.source_relationship_id ?? null,
            JSON.stringify(candidate.source_plan_ids_json ?? []),
            JSON.stringify(candidate.source_memory_ids_json ?? []),
            JSON.stringify(candidate.source_belief_ids_json ?? []),
            JSON.stringify(candidate.trigger_sources_json ?? []),
            JSON.stringify(candidate.compiler_inputs_json ?? {}),
            candidate.computed_at
          ]
        );
      }
    }

    return {
      fieldCount: fields.size,
      edgeCount: edgeUpserts.size,
      scoreCount: fields.size,
      candidateCount: candidateRows.length
    };
  }

  public async recomputeDerivedPlansForSubject(
    input: {
      subjectType: 'user' | 'group' | 'self';
      subjectId: number | string;
      groupId?: number | null;
    },
    now: Date = new Date()
  ): Promise<{
    cancelledPlanIds: number[];
    fieldCount: number;
    edgeCount: number;
    scoreCount: number;
    candidateCount: number;
  }> {
    const latestReflection = await this.getLatestCompletedReflection();
    if (latestReflection) {
      await this.reevaluateStableMemoriesForSubject(input);
      await this.syncRelationshipMemories(
        latestReflection.id,
        latestReflection.reflection_kind,
        now
      );
    }

    const materialized = await this.materializeVirtualWalkState(now);

    if (latestReflection) {
      await this.syncFollowupPlans(latestReflection.id, latestReflection.reflection_kind, now);
    }

    let cancelledPlanIds: number[] = [];
    if (input.subjectType === 'user') {
      cancelledPlanIds = await this.cancelSuppressedFollowupsForSubject({
        targetUserId: this.parseNumericId(input.subjectId),
        groupId: input.groupId ?? null,
        now
      });
    }
    return {
      cancelledPlanIds,
      ...materialized
    };
  }

  public async getRetrievedMemoriesForMessage(
    message: QQMessage,
    limit: number = 6
  ): Promise<AgentMemoryRecord[]> {
    const safeLimit = Math.max(1, Math.min(8, Math.floor(limit)));
    const queryText = this.extractMessageQueryText(message);
    const relationshipContext = await this.getRelationshipContextForMessage(message);
    const candidateLimit = Math.max(DEFAULT_HYBRID_CANDIDATE_LIMIT, safeLimit * 3);
    const structuredMemories = await this.fetchStructuredMemoryCandidates(message, candidateLimit);
    const candidateMap = new Map<number, HybridMemoryCandidate>();

    structuredMemories.forEach(memory => {
      candidateMap.set(memory.id, this.buildHybridMemoryCandidate(memory, {
        queryText,
        semanticScore: 0,
        relationshipContext,
        now: new Date()
      }));
    });

    if (this.embeddingStore && queryText) {
      try {
        const embeddingCandidates = await this.embeddingStore.searchByQuery(queryText, {
          entityTypes: ['memory'],
          scopeTypes: this.getEmbeddingScopeTypesForMessage(message),
          scopeKeys: this.getEmbeddingScopeKeysForMessage(message),
          limit: candidateLimit
        });

        if (embeddingCandidates.length > 0) {
          const embeddingScores = new Map<number, number>();
          embeddingCandidates.forEach(candidate => {
            embeddingScores.set(candidate.entity_id, Number(candidate.similarity || 0));
          });

          const missingMemoryIds = embeddingCandidates
            .map(candidate => candidate.entity_id)
            .filter(memoryId => !candidateMap.has(memoryId));

          if (missingMemoryIds.length > 0) {
            const embeddedMemories = await this.fetchMemoriesByIds(missingMemoryIds);
            embeddedMemories.forEach(memory => {
              candidateMap.set(memory.id, this.buildHybridMemoryCandidate(memory, {
                queryText,
                semanticScore: embeddingScores.get(memory.id) || 0,
                relationshipContext,
                now: new Date()
              }));
            });
          }

          embeddingScores.forEach((semanticScore, memoryId) => {
            const candidate = candidateMap.get(memoryId);
            if (!candidate) {
              return;
            }

            candidateMap.set(memoryId, this.buildHybridMemoryCandidate(candidate.memory, {
              queryText,
              semanticScore,
              relationshipContext,
              now: new Date()
            }));
          });
        }
      } catch (error) {
        this.moduleLogger.warn('Embedding-based memory retrieval failed, falling back to structured ranking', {
          error: error instanceof Error ? error.message : String(error),
          messageId: message.message_id
        });
      }
    }

    const memories = this.rerankMemoryCandidates(
      this.applyBm25ScoresToMemoryCandidates(Array.from(candidateMap.values()), queryText),
      safeLimit
    ).map(candidate => candidate.memory);

    if (memories.length > 0) {
      await this.database.executeUpdate(
        `UPDATE agent_memories
         SET last_recalled_at = CURRENT_TIMESTAMP(3)
         WHERE id IN (${memories.map(() => '?').join(',')})`,
        memories.map(memory => memory.id)
      );
    }

    return memories;
  }

  public async getRecentEvidenceForMessage(
    message: QQMessage,
    memoryIds: number[],
    limit: number = 4
  ): Promise<AgentObservationRecord[]> {
    const safeLimit = Math.max(1, Math.min(4, Math.floor(limit)));
    const queryText = this.extractMessageQueryText(message);
    const relationshipContext = await this.getRelationshipContextForMessage(message);
    const candidateLimit = Math.max(DEFAULT_HYBRID_CANDIDATE_LIMIT, safeLimit * 3);
    const candidateMap = new Map<number, HybridEvidenceCandidate>();
    const now = new Date();

    if (memoryIds.length > 0) {
      const evidenceRows = await this.fetchEvidenceRowsByMemoryIds(memoryIds, candidateLimit);
      evidenceRows.forEach(row => {
        candidateMap.set(
          row.observation.id,
          this.buildHybridEvidenceCandidate(row.observation, {
            semanticScore: 0,
            queryText,
            relationScore: 1,
            relationshipContext,
            now
          })
        );
      });
    }

    if (this.embeddingStore && queryText) {
      try {
        const embeddingCandidates = await this.embeddingStore.searchByQuery(queryText, {
          entityTypes: ['evidence'],
          scopeTypes: this.getEmbeddingScopeTypesForMessage(message),
          scopeKeys: this.getEmbeddingScopeKeysForMessage(message),
          limit: candidateLimit
        });

        if (embeddingCandidates.length > 0) {
          const evidenceScores = new Map<number, number>();
          embeddingCandidates.forEach(candidate => {
            evidenceScores.set(candidate.entity_id, Number(candidate.similarity || 0));
          });

          const evidenceRows = await this.fetchEvidenceRowsByEvidenceIds(
            embeddingCandidates.map(candidate => candidate.entity_id)
          );

          evidenceRows.forEach(row => {
            const semanticScore = evidenceScores.get(row.evidenceId) || 0;
            const existing = candidateMap.get(row.observation.id);
            const relationScore = existing?.relationScore ?? (memoryIds.includes(row.memoryId) ? 1 : 0.4);
            candidateMap.set(
              row.observation.id,
              this.buildHybridEvidenceCandidate(row.observation, {
                semanticScore,
                queryText,
                relationScore,
                relationshipContext,
                now
              })
            );
          });
        }
      } catch (error) {
        this.moduleLogger.warn('Embedding-based evidence retrieval failed, falling back to recency ranking', {
          error: error instanceof Error ? error.message : String(error),
          messageId: message.message_id
        });
      }
    }

    const recentRows = await this.fetchRecentScopedObservations(message, candidateLimit);
    recentRows.forEach(observation => {
      if (candidateMap.has(observation.id)) {
        return;
      }

        candidateMap.set(
        observation.id,
        this.buildHybridEvidenceCandidate(observation, {
          semanticScore: 0,
          queryText,
          relationScore: 0.2,
          relationshipContext,
          now
        })
      );
    });

    return this.rerankEvidenceCandidates(
      this.applyBm25ScoresToEvidenceCandidates(Array.from(candidateMap.values()), queryText),
      safeLimit
    ).map(candidate => candidate.observation);
  }

  public async maybeFlushDurableContext(
    message: QQMessage,
    options?: {
      conversationId?: string | null;
      traceId?: string | null;
      now?: Date;
      minPendingObservations?: number;
      minIntervalMs?: number;
    }
  ): Promise<number | null> {
    const now = options?.now ?? new Date();
    const minPendingObservations = Math.max(
      3,
      Math.floor(options?.minPendingObservations ?? SILENT_FLUSH_MIN_PENDING_OBSERVATIONS)
    );
    const minIntervalMs = Math.max(
      60_000,
      Math.floor(options?.minIntervalMs ?? SILENT_FLUSH_MIN_INTERVAL_MS)
    );
    const { whereSql, params, fieldScope } = this.buildObservationScopeQuery(message);

    const lastFlushRows = await this.database.executeQuery<any>(
      `
        SELECT id, occurred_at
        FROM agent_observations
        ${whereSql} ${whereSql ? 'AND' : 'WHERE'} source_type = 'compaction_flush'
        ORDER BY occurred_at DESC, id DESC
        LIMIT 1
      `,
      params
    );
    const lastFlushAt = lastFlushRows[0]?.occurred_at ? this.parseDate(lastFlushRows[0].occurred_at) : null;
    if (lastFlushAt && now.getTime() - lastFlushAt.getTime() < minIntervalMs) {
      return null;
    }

    const sourceRows = await this.database.executeQuery<any>(
      `
        SELECT *
        FROM agent_observations
        ${whereSql} ${whereSql ? 'AND' : 'WHERE'} source_type <> 'compaction_flush'
        ${lastFlushAt ? 'AND occurred_at > ?' : ''}
        ORDER BY occurred_at DESC, id DESC
        LIMIT ${Math.max(minPendingObservations, SILENT_FLUSH_MAX_SOURCE_OBSERVATIONS)}
      `,
      lastFlushAt ? [...params, lastFlushAt] : params
    );

    if (sourceRows.length < minPendingObservations) {
      return null;
    }

    const sourceObservations = sourceRows
      .map(row => this.mapAgentObservationRow(row))
      .slice(0, SILENT_FLUSH_MAX_SOURCE_OBSERVATIONS);
    const [selfModel, activePlans, retrievedStableMemories] = await Promise.all([
      this.getCurrentSelfModel(),
      this.getActivePlansForMessage(message, 3),
      this.getRetrievedMemoriesForMessage(message, 4)
    ]);

    const contentLines = [
      `Silent flush captured ${sourceRows.length} recent observations before compaction for ${message.message_type === 'group' ? `group:${message.group_id}` : `user:${message.user_id}`}.`,
      `Recent signals: ${sourceObservations.map(observation => this.truncateForFlush(observation.content)).join(' | ')}`,
      `Active plans: ${activePlans.length > 0 ? activePlans.map(plan => `${plan.plan_type}:${this.truncateForFlush(plan.goal, 60)}`).join(' | ') : 'none'}`,
      `Retrieved memories: ${retrievedStableMemories.length > 0 ? retrievedStableMemories.map(memory => this.truncateForFlush(memory.content, 60)).join(' | ') : 'none'}`
    ];

    return this.database.saveAgentObservation({
      trace_id: options?.traceId ?? null,
      conversation_id: options?.conversationId ?? null,
      source_type: 'compaction_flush',
      field_scope: fieldScope,
      message_type: message.message_type,
      user_id: message.user_id,
      group_id: message.group_id ?? null,
      subject_user_id: message.user_id ?? null,
      counterparty_ids: [message.user_id].filter((value): value is number => Number.isFinite(value)),
      content: contentLines.join('\n'),
      raw_payload: {
        flush_reason: 'pre_compaction_threshold',
        source_observation_ids: sourceObservations.map(observation => observation.id),
        active_plan_ids: activePlans.map(plan => plan.id),
        retrieved_memory_ids: retrievedStableMemories.map(memory => memory.id),
        self_model_id: selfModel?.id ?? null,
        trigger_message_id: message.message_id ?? null,
        min_pending_observations: minPendingObservations,
        last_flush_at: lastFlushAt?.toISOString() ?? null
      },
      occurred_at: now
    });
  }

  public async getCurrentSelfModel(): Promise<AgentSelfModelRecord | undefined> {
    const rows = await this.database.executeQuery<any>(
      `
        SELECT *
        FROM agent_self_model
        WHERE is_current = 1
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `
    );

    return rows[0] ? this.mapAgentSelfModelRow(rows[0]) : undefined;
  }

  public async getRelationshipContextForMessage(
    message: QQMessage
  ): Promise<AgentRelationshipMemoryRecord | undefined> {
    const targetUserId = message.user_id;
    if (!targetUserId) {
      return undefined;
    }

    if (message.message_type === 'group' && message.group_id) {
      const localSnapshot = await this.getCurrentRelationshipSnapshot(targetUserId, message.group_id);
      if (localSnapshot) {
        return localSnapshot;
      }
    }

    return this.getCurrentRelationshipSnapshot(targetUserId, null);
  }

  public async getActivePlansForMessage(
    message: QQMessage,
    limit: number = 3
  ): Promise<AgentPlanRecord[]> {
    const safeLimit = Math.max(1, Math.min(6, Math.floor(limit)));
    const clauses = [`status IN ('queued', 'active')`];
    const params: Array<number | string> = [];

    if (message.message_type === 'private') {
      clauses.push(`(
        target_user_id IS NULL OR target_user_id = ?
      )`);
      params.push(message.user_id);
    } else if (message.message_type === 'group' && message.group_id) {
      clauses.push(`(
        target_group_id IS NULL OR target_group_id = ?
      )`);
      params.push(message.group_id);
    }

    const rows = await this.database.executeQuery<any>(
      `
        SELECT *
        FROM agent_plans
        WHERE ${clauses.join(' AND ')}
        ORDER BY
          CASE status WHEN 'active' THEN 0 ELSE 1 END,
          scheduled_start_at IS NULL,
          scheduled_start_at ASC,
          updated_at DESC,
          id DESC
        LIMIT ${safeLimit}
      `,
      params
    );

    return rows.map(row => this.mapAgentPlanRow(row));
  }

  public async executeDueFollowupPlans(options: {
    now?: Date;
    limit?: number;
    retryDelayMs?: number;
    canSendToUser?: (
      userId: number,
      plan: AgentPlanRecord
    ) => Promise<{ allowed: boolean; reason?: string }>;
    sendPrivateMessage: (
      userId: number,
      message: string,
      plan: AgentPlanRecord
    ) => Promise<void>;
    canSendToGroup?: (
      groupId: number,
      plan: AgentPlanRecord
    ) => Promise<{ allowed: boolean; reason?: string }>;
    sendGroupMessage?: (
      groupId: number,
      message: string,
      plan: AgentPlanRecord
    ) => Promise<void>;
  }): Promise<{
    processed: number;
    completed: number;
    skipped: number;
    failed: number;
  }> {
    const now = options.now ?? new Date();
    const safeLimit = Math.max(1, Math.min(5, Math.floor(options.limit ?? 1)));
    const retryDelayMs = Math.max(60_000, Math.floor(options.retryDelayMs ?? 6 * 60 * 60 * 1000));
    const rows = await this.database.executeQuery<any>(
      `
        SELECT *
        FROM agent_plans
        WHERE plan_type = 'followup_queue'
          AND status IN ('queued', 'active')
          AND (target_user_id IS NOT NULL OR target_group_id IS NOT NULL)
          AND (scheduled_start_at IS NULL OR scheduled_start_at <= ?)
        ORDER BY
          scheduled_start_at IS NULL,
          scheduled_start_at ASC,
          updated_at ASC,
          id ASC
        LIMIT ${safeLimit}
      `,
      [now]
    );

    const plans = rows.map(row => this.mapAgentPlanRow(row));
    const result = {
      processed: plans.length,
      completed: 0,
      skipped: 0,
      failed: 0
    };

    for (const plan of plans) {
      const targetUserId = plan.target_user_id ?? null;
      const targetGroupId = plan.target_group_id ?? null;
      if (!targetUserId && !targetGroupId) {
        result.skipped += 1;
        continue;
      }

      if (targetUserId) {
        const relationshipSnapshot = await this.getCurrentRelationshipSnapshot(
          targetUserId,
          plan.target_group_id ?? null
        );
        if (
          relationshipSnapshot?.boundary_strategy === 'observe_only' ||
          relationshipSnapshot?.boundary_strategy === 'do_not_contact'
        ) {
          await this.cancelPlan(plan.id, now);
          await this.insertActionLog({
            action_type: 'followup_private_message',
            trigger_kind: 'followup_queue',
            source_plan_id: plan.id,
            target_user_id: targetUserId,
            target_group_id: plan.target_group_id ?? null,
            payload_json: {
              goal: plan.goal,
              reason: `relationship_boundary:${relationshipSnapshot.boundary_strategy}`
            },
            status: `cancelled:relationship_boundary:${relationshipSnapshot.boundary_strategy}`,
            occurred_at: now
          });
          result.skipped += 1;
          continue;
        }
      }

      const message = this.renderFollowupMessage(plan);
      const policy = targetUserId
        ? (options.canSendToUser
            ? await options.canSendToUser(targetUserId, plan)
            : { allowed: true })
        : (targetGroupId && options.canSendToGroup
            ? await options.canSendToGroup(targetGroupId, plan)
            : { allowed: Boolean(targetGroupId && options.sendGroupMessage), reason: 'missing_group_sender' });

      if (!policy.allowed) {
        await this.rescheduleFollowupPlan(plan.id, new Date(now.getTime() + retryDelayMs));
        await this.insertActionLog({
          action_type: targetUserId ? 'followup_private_message' : 'followup_group_message',
          trigger_kind: 'followup_queue',
          source_plan_id: plan.id,
          target_user_id: targetUserId,
          target_group_id: targetGroupId,
          payload_json: {
            goal: plan.goal,
            message,
            reason: policy.reason ?? 'policy_blocked'
          },
          status: `skipped:${policy.reason ?? 'policy_blocked'}`,
          occurred_at: now
        });
        result.skipped += 1;
        continue;
      }

      await this.markPlanActive(plan.id, now);

      try {
        if (targetUserId) {
          await options.sendPrivateMessage(targetUserId, message, plan);
        } else if (targetGroupId && options.sendGroupMessage) {
          await options.sendGroupMessage(targetGroupId, message, plan);
        } else {
          throw new Error('missing_group_sender');
        }
        await this.completeFollowupPlan(plan.id, now);
        await this.insertActionLog({
          action_type: targetUserId ? 'followup_private_message' : 'followup_group_message',
          trigger_kind: 'followup_queue',
          source_plan_id: plan.id,
          target_user_id: targetUserId,
          target_group_id: targetGroupId,
          payload_json: {
            goal: plan.goal,
            message
          },
          status: 'completed',
          occurred_at: now
        });
        result.completed += 1;
      } catch (error) {
        await this.rescheduleFollowupPlan(plan.id, new Date(now.getTime() + retryDelayMs));
        await this.insertActionLog({
          action_type: targetUserId ? 'followup_private_message' : 'followup_group_message',
          trigger_kind: 'followup_queue',
          source_plan_id: plan.id,
          target_user_id: targetUserId,
          target_group_id: targetGroupId,
          payload_json: {
            goal: plan.goal,
            message,
            error: error instanceof Error ? error.message : String(error)
          },
          status: 'failed',
          occurred_at: now
        });
        result.failed += 1;
      }
    }

    return result;
  }

  public async upsertMicroIntentionForMessage(
    message: QQMessage,
    now: Date = new Date()
  ): Promise<AgentPlanRecord | null> {
    if (!(await this.hasTable('agent_plans'))) {
      return null;
    }

    const planShape = this.buildMicroIntentionPlanShape(message, now);
    if (!planShape) {
      return null;
    }

    const existingRows = await this.database.executeQuery<any>(
      `
        SELECT id
        FROM agent_plans
        WHERE plan_type = 'micro_intention'
          AND target_user_id <=> ?
          AND target_group_id <=> ?
          AND status IN ('queued', 'active')
        ORDER BY id DESC
      `,
      [planShape.targetUserId, planShape.targetGroupId]
    );

    const keepId = existingRows[0] ? Number(existingRows[0].id) : null;
    if (keepId) {
      await this.database.executeUpdate(
        `
          UPDATE agent_plans
          SET
            target_field_scope = ?,
            goal = ?,
            trigger_condition = ?,
            status = 'active',
            scheduled_start_at = ?,
            scheduled_end_at = NULL,
            source_reflection_id = NULL,
            updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ?
        `,
        [
          planShape.targetFieldScope,
          planShape.goal,
          planShape.triggerCondition,
          now,
          keepId
        ]
      );
      return {
        id: keepId,
        plan_type: 'micro_intention',
        target_field_scope: planShape.targetFieldScope,
        target_user_id: planShape.targetUserId,
        target_group_id: planShape.targetGroupId,
        goal: planShape.goal,
        trigger_condition: planShape.triggerCondition,
        status: 'active',
        scheduled_start_at: now,
        scheduled_end_at: null,
        source_reflection_id: null,
        created_at: now,
        updated_at: now
      };
    }

    const insertedId = await this.database.executeInsertAndReturnId(
      `
        INSERT INTO agent_plans (
          plan_type,
          target_field_scope,
          target_user_id,
          target_group_id,
          goal,
          trigger_condition,
          status,
          scheduled_start_at,
          scheduled_end_at,
          source_reflection_id
        ) VALUES ('micro_intention', ?, ?, ?, ?, ?, 'active', ?, NULL, NULL)
      `,
      [
        planShape.targetFieldScope,
        planShape.targetUserId,
        planShape.targetGroupId,
        planShape.goal,
        planShape.triggerCondition,
        now
      ]
    );

    return {
      id: insertedId,
      plan_type: 'micro_intention',
      target_field_scope: planShape.targetFieldScope,
      target_user_id: planShape.targetUserId,
      target_group_id: planShape.targetGroupId,
      goal: planShape.goal,
      trigger_condition: planShape.triggerCondition,
      status: 'active',
      scheduled_start_at: now,
      scheduled_end_at: null,
      source_reflection_id: null,
      created_at: now,
      updated_at: now
    };
  }

  public async getProactivityControls(
    defaults: AgentProactivityRuntimeConfig
  ): Promise<AgentProactivityControlState> {
    const row = await this.getPersistedProactivityControlRow();
    const effectiveConfig = row
      ? this.mapPersistedProactivityControlRow(row)
      : this.normalizeProactivityConfig(defaults);
    const stats = await this.getProactivityControlStats();

    return {
      ...effectiveConfig,
      ...stats,
      createdAt: row?.created_at ?? null,
      updatedAt: row?.updated_at ?? null,
      source: row ? 'database' : 'defaults'
    };
  }

  public async updateProactivityControls(
    patch: Partial<AgentProactivityRuntimeConfig>,
    defaults: AgentProactivityRuntimeConfig
  ): Promise<AgentProactivityControlState> {
    if (!(await this.hasTable('agent_proactivity_controls'))) {
      throw new Error('agent_proactivity_controls table is missing');
    }

    const existingRow = await this.getPersistedProactivityControlRow();
    const currentConfig = existingRow
      ? this.mapPersistedProactivityControlRow(existingRow)
      : this.normalizeProactivityConfig(defaults);
    const nextConfig = this.normalizeProactivityConfig({
      followupEnabled: patch.followupEnabled ?? currentConfig.followupEnabled,
      isPaused: patch.isPaused ?? currentConfig.isPaused,
      allowedUserIds: patch.allowedUserIds ?? currentConfig.allowedUserIds,
      observedGroupIds: patch.observedGroupIds ?? currentConfig.observedGroupIds,
      allowedGroupIds: patch.allowedGroupIds ?? currentConfig.allowedGroupIds,
      maxPerRun: patch.maxPerRun ?? currentConfig.maxPerRun,
      retryDelayMs: patch.retryDelayMs ?? currentConfig.retryDelayMs
    });

    await this.database.executeUpdate(
      `
        INSERT INTO agent_proactivity_controls (
          id,
          followup_enabled,
          is_paused,
          allowed_user_ids,
          observed_group_ids,
          allowed_group_ids,
          max_per_run,
          retry_delay_ms
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          followup_enabled = VALUES(followup_enabled),
          is_paused = VALUES(is_paused),
          allowed_user_ids = VALUES(allowed_user_ids),
          observed_group_ids = VALUES(observed_group_ids),
          allowed_group_ids = VALUES(allowed_group_ids),
          max_per_run = VALUES(max_per_run),
          retry_delay_ms = VALUES(retry_delay_ms),
          updated_at = CURRENT_TIMESTAMP(3)
      `,
      [
        nextConfig.followupEnabled ? 1 : 0,
        nextConfig.isPaused ? 1 : 0,
        JSON.stringify(nextConfig.allowedUserIds),
        JSON.stringify(nextConfig.observedGroupIds),
        JSON.stringify(nextConfig.allowedGroupIds),
        nextConfig.maxPerRun,
        nextConfig.retryDelayMs
      ]
    );

    return this.getProactivityControls(defaults);
  }

  public async completeMicroIntentionForMessage(
    message: QQMessage,
    now: Date = new Date()
  ): Promise<number> {
    return this.updateMicroIntentionStatusForMessage(message, 'completed', null, now);
  }

  public async cancelMicroIntentionForMessage(
    message: QQMessage,
    reason: string,
    now: Date = new Date()
  ): Promise<number> {
    return this.updateMicroIntentionStatusForMessage(message, 'cancelled', reason, now);
  }

  private async runReflection(
    kind: AgentReflectionKind,
    reflectionKey: string,
    now: Date
  ): Promise<void> {
    const horizonStart = new Date(
      kind === 'weekly'
        ? now.getTime() - 7 * 24 * 60 * 60 * 1000
        : now.getTime() - 24 * 60 * 60 * 1000
    );

    const beliefRows = await this.database.executeQuery<any>(
      `
        SELECT *
        FROM agent_beliefs
        WHERE status = 'active'
          AND last_observed_at >= ?
        ORDER BY last_observed_at DESC, id DESC
        LIMIT 100
      `,
      [horizonStart]
    );

    const beliefs = beliefRows.map(row => this.mapAgentBeliefRow(row));
    const promotedMemoryIds: number[] = [];

    for (const belief of beliefs) {
      const promoted = await this.promoteBeliefRecord(belief, {
        evidenceObservationId: belief.last_evidence_id ?? null,
        sourceKind: kind === 'weekly' ? 'weekly_reflection' : 'daily_reflection'
      });
      if (promoted) {
        promotedMemoryIds.push(promoted.id);
      }
    }

    const reflectionId = await this.database.executeInsertAndReturnId(
      `
        INSERT INTO agent_reflections (
          reflection_kind,
          reflection_key,
          status,
          summary,
          source_belief_ids,
          promoted_memory_ids,
          started_at,
          completed_at
        ) VALUES (?, ?, 'completed', ?, ?, ?, ?, ?)
      `,
      [
        kind,
        reflectionKey,
        `${kind} reflection promoted ${promotedMemoryIds.length} memories`,
        JSON.stringify(beliefs.map(belief => belief.id)),
        JSON.stringify(promotedMemoryIds),
        now,
        new Date()
      ]
    );

    await this.writeSelfModelSnapshot(reflectionId, kind, promotedMemoryIds.length, now);
    await this.syncRelationshipMemories(reflectionId, kind, now);
    await this.syncFollowupPlans(reflectionId, kind, now);
  }

  private async syncRelationshipMemories(
    reflectionId: number,
    reflectionKind: AgentReflectionKind,
    now: Date
  ): Promise<void> {
    if (!(await this.hasTable('agent_relationship_memories'))) {
      return;
    }

    const horizonStart = new Date(
      now.getTime() - (reflectionKind === 'weekly' ? 30 : 14) * 24 * 60 * 60 * 1000
    );
    const [memoryRows, auxiliaryMemoryRows, beliefRows, observationRows, actionRows, currentRows] = await Promise.all([
      this.database.executeQuery<any>(
        `
          SELECT *
          FROM agent_memories
          WHERE status = 'active'
            AND subject_type = 'user'
            AND memory_type = 'relationship'
            AND last_observed_at >= ?
          ORDER BY salience DESC, confidence DESC, last_observed_at DESC, id DESC
          LIMIT 200
        `,
        [horizonStart]
      ),
      this.database.executeQuery<any>(
        `
          SELECT *
          FROM agent_memories
          WHERE status = 'active'
            AND subject_type = 'user'
            AND memory_type IN ('preference', 'summary_insight')
            AND last_observed_at >= ?
          ORDER BY salience DESC, confidence DESC, last_observed_at DESC, id DESC
          LIMIT 240
        `,
        [horizonStart]
      ),
      this.hasTable('agent_beliefs').then((exists) => exists
        ? this.database.executeQuery<any>(
            `
              SELECT *
              FROM agent_beliefs
              WHERE status = 'active'
                AND subject_type = 'user'
                AND belief_type = 'relationship'
                AND last_observed_at >= ?
              ORDER BY confidence DESC, last_observed_at DESC, id DESC
              LIMIT 200
            `,
            [horizonStart]
          )
        : Promise.resolve([])),
      this.database.executeQuery<any>(
        `
          SELECT id, user_id, group_id, field_scope, content, occurred_at, created_at, source_type, message_type
          FROM agent_observations
          WHERE user_id IS NOT NULL
            AND source_type <> 'compaction_flush'
            AND occurred_at >= ?
          ORDER BY occurred_at DESC, id DESC
          LIMIT 400
        `,
        [horizonStart]
      ),
      this.database.executeQuery<any>(
        `
          SELECT target_user_id, target_group_id, status, occurred_at
          FROM agent_action_logs
          WHERE target_user_id IS NOT NULL
            AND occurred_at >= ?
          ORDER BY occurred_at DESC, id DESC
          LIMIT 200
        `,
        [horizonStart]
      ),
      this.database.executeQuery<any>(
        `
          SELECT *
          FROM agent_relationship_memories
          WHERE is_current = 1
            AND status = 'active'
        `
      )
    ]);

    const relationshipMemories = memoryRows.map(row => this.mapAgentMemoryRow(row));
    const auxiliaryMemories = auxiliaryMemoryRows.map(row => this.mapAgentMemoryRow(row));
    const relationshipBeliefs = beliefRows.map(row => this.mapAgentBeliefRow(row));
    const observations = observationRows.map(row => this.mapAgentObservationRow(row));
    const currentSnapshots = currentRows.map(row => this.mapAgentRelationshipMemoryRow(row));
    const auxiliaryMemoriesByKey = new Map<string, AgentMemoryRecord[]>();
    const targets = new Map<string, {
      targetUserId: number;
      groupId: number | null;
      fieldScope: 'private_chat' | 'group_chat';
      observations: AgentObservationRecord[];
      memories: AgentMemoryRecord[];
      auxiliaryMemories: AgentMemoryRecord[];
      beliefs: AgentBeliefRecord[];
      actionRows: any[];
      existingSnapshot: AgentRelationshipMemoryRecord | null;
    }>();

    const ensureTarget = (
      targetUserId: number,
      groupId: number | null,
      fieldScope: 'private_chat' | 'group_chat'
    ) => {
      const key = `${targetUserId}:${groupId ?? 'global'}`;
      const existing = targets.get(key);
      if (existing) {
        return existing;
      }
      const created = {
        targetUserId,
        groupId,
        fieldScope,
        observations: [],
        memories: [],
        auxiliaryMemories: [],
        beliefs: [],
        actionRows: [],
        existingSnapshot: null
      };
      targets.set(key, created);
      return created;
    };

    relationshipMemories.forEach(memory => {
      const targetUserId = memory.user_id ?? this.parseNumericId(memory.subject_id);
      if (!targetUserId) {
        return;
      }

      if (memory.group_id) {
        ensureTarget(targetUserId, memory.group_id, 'group_chat').memories.push(memory);
      }

      ensureTarget(targetUserId, null, 'private_chat').memories.push(memory);
    });

    relationshipBeliefs.forEach(belief => {
      const targetUserId = this.parseNumericId(belief.subject_id);
      if (!targetUserId) {
        return;
      }

      ensureTarget(targetUserId, null, 'private_chat').beliefs.push(belief);
    });

    auxiliaryMemories.forEach(memory => {
      const targetUserId = memory.user_id ?? this.parseNumericId(memory.subject_id);
      if (!targetUserId) {
        return;
      }

      const globalKey = `${targetUserId}:global`;
      const globalExisting = auxiliaryMemoriesByKey.get(globalKey) ?? [];
      globalExisting.push(memory);
      auxiliaryMemoriesByKey.set(globalKey, globalExisting);

      if (memory.group_id) {
        const groupKey = `${targetUserId}:${memory.group_id}`;
        const groupExisting = auxiliaryMemoriesByKey.get(groupKey) ?? [];
        groupExisting.push(memory);
        auxiliaryMemoriesByKey.set(groupKey, groupExisting);
      }
    });

    currentSnapshots.forEach(snapshot => {
      ensureTarget(
        snapshot.target_user_id,
        snapshot.group_id ?? null,
        snapshot.group_id ? 'group_chat' : 'private_chat'
      ).existingSnapshot = snapshot;
    });

    observations.forEach(observation => {
      if (!observation.user_id) {
        return;
      }

      const privateTarget = targets.get(`${observation.user_id}:global`);
      if (privateTarget) {
        privateTarget.observations.push(observation);
      }

      if (observation.group_id) {
        const groupTarget = targets.get(`${observation.user_id}:${observation.group_id}`);
        if (groupTarget) {
          groupTarget.observations.push(observation);
        }
      }
    });

    actionRows.forEach(action => {
      const targetUserId = this.parseNumericId(action.target_user_id);
      if (!targetUserId) {
        return;
      }

      const privateTarget = targets.get(`${targetUserId}:global`);
      if (privateTarget) {
        privateTarget.actionRows.push(action);
      }

      const targetGroupId = this.parseNumericId(action.target_group_id);
      if (targetGroupId) {
        const groupTarget = targets.get(`${targetUserId}:${targetGroupId}`);
        if (groupTarget) {
          groupTarget.actionRows.push(action);
        }
      }
    });

    for (const target of targets.values()) {
      const latestObservation = target.observations[0] ?? null;
      const latestStrongEvidenceAt = [
        ...target.memories.map(memory => memory.last_observed_at.getTime()),
        ...target.beliefs.map(belief => belief.last_observed_at.getTime())
      ].sort((a, b) => b - a)[0] ?? 0;
      target.auxiliaryMemories = this.uniqueMemoryRecords([
        ...(auxiliaryMemoriesByKey.get(`${target.targetUserId}:${target.groupId ?? 'global'}`) ?? []),
        ...(target.groupId ? (auxiliaryMemoriesByKey.get(`${target.targetUserId}:global`) ?? []) : [])
      ]).slice(0, 8);
      const existingOverride = target.existingSnapshot?.notes_json?.manual_override;
      const existingUpdatedAt = target.existingSnapshot?.updated_at?.getTime() ?? 0;

      if (existingOverride && latestStrongEvidenceAt <= existingUpdatedAt) {
        continue;
      }

      if (target.memories.length === 0 && target.beliefs.length === 0) {
        continue;
      }

      const fallbackBoundaryStrategy = this.determineRelationshipBoundaryStrategy(
        target.memories.length + target.beliefs.length,
        target.actionRows,
        target.observations
      );
      const fallback: RelationshipInsightEvaluationResult = {
        relationship_summary: this.buildRelationshipSummary(
          target.targetUserId,
          target.groupId,
          target.memories,
          target.beliefs
        ),
        interaction_style: this.buildRelationshipInteractionStyle(target.groupId),
        boundary_notes: fallbackBoundaryStrategy === 'allow_proactive'
          ? '允许在自然窗口中谨慎主动联系。'
          : '当前以观察和顺势回复为主，不主动打扰。',
        confidence: this.deriveRelationshipConfidence(target.memories.length, target.beliefs.length),
        boundary_strategy: fallbackBoundaryStrategy,
        impression_profile: this.buildFallbackImpressionProfile(target),
        speech_policy: this.buildFallbackSpeechPolicy(target.groupId, fallbackBoundaryStrategy),
        memory_bias: this.buildFallbackMemoryBias(target)
      };
      const evaluatedRelationship = await this.evaluateRelationshipInsight({
        targetUserId: target.targetUserId,
        groupId: target.groupId,
        fieldScope: target.fieldScope,
        memories: target.memories,
        beliefs: target.beliefs,
        auxiliaryMemories: target.auxiliaryMemories,
        observations: target.observations,
        actionRows: target.actionRows,
        existingSnapshot: target.existingSnapshot,
        reflectionKind,
        fallback,
        now
      });
      const notesJson = {
        source_memory_ids: target.memories.slice(0, 8).map(memory => memory.id),
        source_belief_ids: target.beliefs.slice(0, 8).map(belief => belief.id),
        auxiliary_memory_ids: target.auxiliaryMemories.slice(0, 8).map(memory => memory.id),
        recent_observation_ids: target.observations.slice(0, 8).map(observation => observation.id),
        recent_action_statuses: target.actionRows.slice(0, 6).map(action => ({
          status: action.status,
          occurred_at: action.occurred_at
        })),
        reflection_kind: reflectionKind,
        manual_override: false,
        llm_trace_id: evaluatedRelationship.llm_trace_id ?? null,
        prompt_id: evaluatedRelationship.prompt_id ?? null,
        prompt_name: evaluatedRelationship.prompt_name ?? null,
        prompt_version: evaluatedRelationship.prompt_version ?? null,
        tool_name: evaluatedRelationship.tool_name ?? null,
        tool_agent_type: evaluatedRelationship.tool_agent_type ?? null,
        contract_status: evaluatedRelationship.contract_status ?? null,
        contract_error_code: evaluatedRelationship.contract_error_code ?? null,
        impression_profile: evaluatedRelationship.impression_profile ?? null,
        speech_policy: evaluatedRelationship.speech_policy ?? null,
        memory_bias: evaluatedRelationship.memory_bias ?? null,
        ...(evaluatedRelationship.notes_json && typeof evaluatedRelationship.notes_json === 'object'
          ? evaluatedRelationship.notes_json
          : {})
      };

      await this.database.executeUpdate(
        `
          UPDATE agent_relationship_memories
          SET
            is_current = 0,
            status = CASE WHEN status = 'active' THEN 'superseded' ELSE status END,
            updated_at = CURRENT_TIMESTAMP(3)
          WHERE target_user_id = ?
            AND group_id <=> ?
            AND is_current = 1
        `,
        [target.targetUserId, target.groupId]
      );

      await this.database.executeInsertAndReturnId(
        `
          INSERT INTO agent_relationship_memories (
            target_user_id,
            field_scope,
            group_id,
            relationship_summary,
            interaction_style,
            boundary_notes,
            confidence,
            status,
            source_reflection_id,
            last_evidence_id,
            last_observed_at,
            is_current,
            boundary_strategy,
            notes_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 1, ?, ?)
        `,
        [
          target.targetUserId,
          target.fieldScope,
          target.groupId,
          evaluatedRelationship.relationship_summary ?? fallback.relationship_summary,
          evaluatedRelationship.interaction_style ?? fallback.interaction_style,
          evaluatedRelationship.boundary_notes ?? fallback.boundary_notes,
          evaluatedRelationship.confidence ?? fallback.confidence,
          reflectionId,
          latestObservation?.id ?? target.beliefs[0]?.last_evidence_id ?? null,
          latestObservation?.occurred_at ?? new Date(latestStrongEvidenceAt || now.getTime()),
          evaluatedRelationship.boundary_strategy ?? fallback.boundary_strategy,
          JSON.stringify(notesJson)
        ]
      );
    }
  }

  private async ensureDerivedCognitionState(now: Date): Promise<void> {
    const [
      currentSelfModel,
      latestReflection,
      latestDailyReflection,
      latestWeeklyReflection,
      hasFollowupPlan,
      hasDayPlan,
      hasWeeklyFocusPlan
    ] = await Promise.all([
      this.getCurrentSelfModel(),
      this.getLatestCompletedReflection(),
      this.getLatestCompletedReflectionByKind('daily'),
      this.getLatestCompletedReflectionByKind('weekly'),
      this.hasQueuedOrActivePlan('followup_queue'),
      this.hasQueuedOrActivePlan('day_plan'),
      this.hasQueuedOrActivePlan('weekly_focus')
    ]);

    if (!latestReflection) {
      return;
    }

    if (!currentSelfModel) {
      await this.writeSelfModelSnapshot(latestReflection.id, latestReflection.reflection_kind, 0, now);
    }

    if (!hasFollowupPlan) {
      await this.syncFollowupPlans(latestReflection.id, latestReflection.reflection_kind, now);
    }

    if (latestDailyReflection && !hasDayPlan) {
      await this.syncFollowupPlans(latestDailyReflection.id, 'daily', now);
    }

    if (latestWeeklyReflection && !hasWeeklyFocusPlan) {
      await this.syncFollowupPlans(latestWeeklyReflection.id, 'weekly', now);
    }
  }

  private async reevaluateStableMemoriesForSubject(input: {
    subjectType: 'user' | 'group' | 'self';
    subjectId: number | string;
    groupId?: number | null;
  }): Promise<void> {
    if (!(await this.hasTable('agent_beliefs'))) {
      return;
    }

    let whereSql = `WHERE status = 'active'`;
    const params: any[] = [];
    if (input.subjectType === 'self') {
      whereSql += ` AND subject_type = 'self'`;
    } else if (input.subjectType === 'group') {
      whereSql += ` AND subject_type = 'group' AND subject_id = ?`;
      params.push(String(input.subjectId));
    } else {
      whereSql += ` AND subject_type = 'user' AND subject_id = ?`;
      params.push(String(input.subjectId));
    }

    const rows = await this.database.executeQuery<any>(
      `
        SELECT *
        FROM agent_beliefs
        ${whereSql}
        ORDER BY confidence DESC, last_observed_at DESC, id DESC
        LIMIT 40
      `,
      params
    );
    const beliefs = rows.map(row => this.mapAgentBeliefRow(row));

    for (const belief of beliefs) {
      await this.promoteBeliefRecord(belief, {
        evidenceObservationId: belief.last_evidence_id ?? null,
        sourceKind: belief.belief_type === 'relationship' ? 'daily_reflection' : undefined
      });
    }
  }

  private async getLatestCompletedReflection(): Promise<{
    id: number;
    reflection_kind: AgentReflectionKind;
  } | null> {
    const rows = await this.database.executeQuery<any>(
      `
        SELECT id, reflection_kind
        FROM agent_reflections
        WHERE status = 'completed'
        ORDER BY completed_at DESC, id DESC
        LIMIT 1
      `
    );

    if (!rows[0]) {
      return null;
    }

    return {
      id: Number(rows[0].id),
      reflection_kind: rows[0].reflection_kind as AgentReflectionKind
    };
  }

  private async getLatestCompletedReflectionByKind(
    reflectionKind: AgentReflectionKind
  ): Promise<{
    id: number;
    reflection_kind: AgentReflectionKind;
  } | null> {
    const rows = await this.database.executeQuery<any>(
      `
        SELECT id, reflection_kind
        FROM agent_reflections
        WHERE status = 'completed'
          AND reflection_kind = ?
        ORDER BY completed_at DESC, id DESC
        LIMIT 1
      `,
      [reflectionKind]
    );

    if (!rows[0]) {
      return null;
    }

    return {
      id: Number(rows[0].id),
      reflection_kind: rows[0].reflection_kind as AgentReflectionKind
    };
  }

  private async hasQueuedOrActivePlan(planType: AgentPlanRecord['plan_type']): Promise<boolean> {
    const rows = await this.database.executeQuery<{ total: number }>(
      `
        SELECT COUNT(*) AS total
        FROM agent_plans
        WHERE status IN ('queued', 'active')
          AND plan_type = ?
      `,
      [planType]
    );

    return Number(rows[0]?.total || 0) > 0;
  }

  private async writeSelfModelSnapshot(
    reflectionId: number,
    reflectionKind: AgentReflectionKind,
    promotedMemoryCount: number,
    now: Date
  ): Promise<void> {
    const [selfMemoryRows, selfBeliefRows] = await Promise.all([
      this.database.executeQuery<any>(
        `
          SELECT *
          FROM agent_memories
          WHERE status = 'active'
            AND memory_scope = 'self_global'
          ORDER BY salience DESC, confidence DESC, last_observed_at DESC, id DESC
          LIMIT 12
        `
      ),
      this.database.executeQuery<any>(
        `
          SELECT *
          FROM agent_beliefs
          WHERE status = 'active'
            AND subject_type = 'self'
          ORDER BY confidence DESC, last_observed_at DESC, id DESC
          LIMIT 12
        `
      )
    ]);

    const selfMemories = selfMemoryRows.map(row => this.mapAgentMemoryRow(row));
    const selfBeliefs = selfBeliefRows.map(row => this.mapAgentBeliefRow(row));
    const snapshot = this.buildSelfModelSnapshot(
      selfMemories,
      selfBeliefs,
      reflectionKind,
      promotedMemoryCount,
      now
    );

    await this.database.executeUpdate(
      `UPDATE agent_self_model SET is_current = 0 WHERE is_current = 1`
    );

    await this.database.executeInsertAndReturnId(
      `
        INSERT INTO agent_self_model (
          identity_summary,
          core_traits,
          long_term_goals,
          current_concerns,
          availability,
          energy,
          source_reflection_id,
          is_current
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `,
      [
        snapshot.identity_summary,
        JSON.stringify(snapshot.core_traits),
        JSON.stringify(snapshot.long_term_goals),
        JSON.stringify(snapshot.current_concerns),
        snapshot.availability,
        snapshot.energy,
        reflectionId
      ]
    );
  }

  private buildSelfModelSnapshot(
    selfMemories: AgentMemoryRecord[],
    selfBeliefs: AgentBeliefRecord[],
    reflectionKind: AgentReflectionKind,
    promotedMemoryCount: number,
    now: Date
  ): {
    identity_summary: string;
    core_traits: string[];
    long_term_goals: string[];
    current_concerns: string[];
    availability: string | null;
    energy: string | null;
  } {
    const reflectionLabel = reflectionKind === 'weekly'
      ? '周度'
      : reflectionKind === 'daily'
        ? '日度'
        : '阶段性';

    const identitySummaryCandidates = this.uniqueStrings([
      ...selfMemories
        .filter(memory => memory.memory_type === 'identity_fact' || memory.memory_type === 'summary_insight')
        .map(memory => memory.content),
      ...selfBeliefs
        .filter(belief => belief.belief_type === 'identity_fact')
        .map(belief => belief.claim)
    ]).slice(0, 2);

    const coreTraits = this.uniqueStrings([
      ...selfMemories
        .filter(memory => memory.memory_type === 'preference' || memory.memory_type === 'summary_insight')
        .map(memory => memory.content),
      ...selfBeliefs
        .filter(belief => belief.belief_type === 'preference')
        .map(belief => belief.claim)
    ]).slice(0, 3);

    const longTermGoals = this.uniqueStrings([
      ...selfMemories
        .filter(memory => memory.memory_type === 'commitment')
        .map(memory => memory.content),
      ...selfBeliefs
        .filter(belief => belief.belief_type === 'commitment')
        .map(belief => belief.claim)
    ]).slice(0, 3);

    const recentConcernCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const currentConcerns = this.uniqueStrings([
      ...selfMemories
        .filter(memory =>
          (memory.memory_type === 'summary_insight' || memory.memory_type === 'commitment') &&
          memory.last_observed_at >= recentConcernCutoff
        )
        .map(memory => memory.content),
      ...selfBeliefs
        .filter(belief =>
          belief.belief_type === 'commitment' &&
          belief.last_observed_at >= recentConcernCutoff
        )
        .map(belief => belief.claim)
    ]).slice(0, 3);

    const identitySummary = identitySummaryCandidates.length > 0
      ? identitySummaryCandidates.join('；')
      : `小腻当前处于持续观察、整理记忆与跟进的运行阶段；本次${reflectionLabel}反思整理了${promotedMemoryCount}条稳定记忆。`;

    return {
      identity_summary: identitySummary,
      core_traits: coreTraits,
      long_term_goals: longTermGoals,
      current_concerns: currentConcerns,
      availability: null,
      energy: null
    };
  }

  private async syncFollowupPlans(
    reflectionId: number,
    reflectionKind: AgentReflectionKind,
    now: Date
  ): Promise<void> {
    const lookbackDays = reflectionKind === 'weekly' ? 21 : 7;
    const horizonStart = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    const memoryRows = await this.database.executeQuery<any>(
      `
        SELECT *
        FROM agent_memories
        WHERE status = 'active'
          AND memory_type = 'commitment'
          AND subject_type = 'user'
          AND last_observed_at >= ?
        ORDER BY salience DESC, confidence DESC, last_observed_at DESC, id DESC
        LIMIT 24
      `,
      [horizonStart]
    );
    const commitmentMemories = memoryRows.map(row => this.mapAgentMemoryRow(row));
    await this.syncStrategicPlans(reflectionId, reflectionKind, now, commitmentMemories);

    if (!(await this.hasTable('agent_walk_candidates'))) {
      return;
    }

    await this.materializeVirtualWalkState(now);

    const [candidateRows, relationshipRows, strategicPlanRows, existingPlanRows] = await Promise.all([
      this.getLatestWalkCandidates(),
      this.database.executeQuery<any>(
        `
          SELECT *
          FROM agent_relationship_memories
          WHERE is_current = 1
            AND status = 'active'
        `
      ),
      this.database.executeQuery<any>(
        `
          SELECT *
          FROM agent_plans
          WHERE plan_type IN ('weekly_focus', 'day_plan')
            AND status IN ('queued', 'active')
          ORDER BY updated_at DESC, id DESC
        `
      ),
      this.database.executeQuery<any>(
        `
          SELECT *
          FROM agent_plans
          WHERE plan_type = 'followup_queue'
            AND status IN ('queued', 'active')
        `
      )
    ]);

    const relationshipsByKey = new Map<string, AgentRelationshipMemoryRecord>();
    relationshipRows.forEach(row => {
      const snapshot = this.mapAgentRelationshipMemoryRow(row);
      relationshipsByKey.set(`${snapshot.target_user_id}:${snapshot.group_id ?? 'global'}`, snapshot);
    });

    const strategyPlans = strategicPlanRows.map(row => this.mapAgentPlanRow(row));
    const strategyPlanById = new Map<number, AgentPlanRecord>();
    strategyPlans.forEach(plan => strategyPlanById.set(plan.id, plan));

    const existingByTarget = new Map<string, AgentPlanRecord>();
    existingPlanRows.map(row => this.mapAgentPlanRow(row)).forEach(plan => {
      const key = `${plan.target_user_id ?? 'group'}:${plan.target_group_id ?? 'private'}`;
      const existing = existingByTarget.get(key);
      if (!existing || existing.updated_at < plan.updated_at) {
        existingByTarget.set(key, plan);
      }
    });

    const existingPlanIdsToKeep = new Set<number>();
    const nowBucket = now.toISOString().slice(0, 10);

    for (const candidate of candidateRows) {
      if (!candidate.can_speak_now || (!candidate.target_user_id && !candidate.target_group_id)) {
        continue;
      }

      const relationshipSnapshot = candidate.target_user_id
        ? (
            relationshipsByKey.get(`${candidate.target_user_id}:${candidate.target_group_id ?? 'global'}`)
            ?? relationshipsByKey.get(`${candidate.target_user_id}:global`)
          )
        : undefined;
      const boundaryStrategy = relationshipSnapshot?.boundary_strategy ?? null;
      if (boundaryStrategy === 'observe_only' || boundaryStrategy === 'do_not_contact') {
        continue;
      }

      const sourcePlanIds = this.uniqueNumbers(candidate.source_plan_ids_json ?? []);
      const primarySourcePlan = sourcePlanIds
        .map(planId => strategyPlanById.get(planId))
        .find(plan => plan?.plan_type === 'day_plan')
        ?? sourcePlanIds
          .map(planId => strategyPlanById.get(planId))
          .find(plan => plan?.plan_type === 'weekly_focus')
        ?? null;
      const dedupeKey = `followup:${candidate.target_user_id ?? 'group'}:${candidate.target_group_id ?? 'private'}:${nowBucket}`;
      const goal = this.buildFollowupGoalFromCandidate(candidate);
      const triggerCondition = this.buildFollowupTriggerCondition(candidate);
      const metadata = {
        compiler_source_kind: 'virtual_walk_compiler',
        reflection_kind: reflectionKind,
        candidate_field_key: candidate.field_key,
        dedupe_key: dedupeKey,
        trigger_sources: candidate.trigger_sources_json ?? [],
        source_plan_ids: sourcePlanIds,
        source_memory_ids: candidate.source_memory_ids_json ?? [],
        source_belief_ids: candidate.source_belief_ids_json ?? [],
        source_relationship_id: candidate.source_relationship_id ?? null,
        selected_reason: candidate.selected_reason,
        suppressed_reason: candidate.suppressed_reason ?? null,
        compiler_inputs: candidate.compiler_inputs_json ?? {},
        draft_message: candidate.compiler_inputs_json?.draft_message ?? null,
        tone_rationale: candidate.compiler_inputs_json?.tone_rationale ?? null,
        planner_llm_trace_id: candidate.compiler_inputs_json?.planner_llm_trace_id ?? null,
        planner_prompt_id: candidate.compiler_inputs_json?.planner_prompt_id ?? null,
        planner_prompt_name: candidate.compiler_inputs_json?.planner_prompt_name ?? null,
        planner_prompt_version: candidate.compiler_inputs_json?.planner_prompt_version ?? null,
        planner_tool_name: candidate.compiler_inputs_json?.planner_tool_name ?? null,
        planner_tool_agent_type: candidate.compiler_inputs_json?.planner_tool_agent_type ?? null,
        planner_contract_status: candidate.compiler_inputs_json?.planner_contract_status ?? null,
        planner_contract_error_code: candidate.compiler_inputs_json?.planner_contract_error_code ?? null,
        boundary_strategy: boundaryStrategy ?? 'allow_proactive'
      };

      const existingKey = `${candidate.target_user_id ?? 'group'}:${candidate.target_group_id ?? 'private'}`;
      const existingPlan = existingByTarget.get(existingKey);
      if (existingPlan) {
        existingPlanIdsToKeep.add(existingPlan.id);
        await this.database.executeUpdate(
          `
            UPDATE agent_plans
            SET
              target_field_scope = ?,
              goal = ?,
              trigger_condition = ?,
              scheduled_start_at = COALESCE(scheduled_start_at, ?),
              source_reflection_id = ?,
              source_plan_id = ?,
              plan_metadata_json = ?,
              updated_at = CURRENT_TIMESTAMP(3)
            WHERE id = ?
          `,
          [
            candidate.field_scope,
            goal,
            triggerCondition,
            now,
            reflectionId,
            primarySourcePlan?.id ?? null,
            JSON.stringify(metadata),
            existingPlan.id
          ]
        );
        continue;
      }

      const planId = await this.database.executeInsertAndReturnId(
        `
          INSERT INTO agent_plans (
            plan_type,
            target_field_scope,
            target_user_id,
            target_group_id,
            goal,
            trigger_condition,
            status,
            scheduled_start_at,
            scheduled_end_at,
            source_reflection_id,
            source_plan_id,
            plan_metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, NULL, ?, ?, ?)
        `,
        [
          'followup_queue',
          candidate.field_scope,
          candidate.target_user_id,
          candidate.target_group_id ?? null,
          goal,
          triggerCondition,
          now,
          reflectionId,
          primarySourcePlan?.id ?? null,
          JSON.stringify(metadata)
        ]
      );
      existingPlanIdsToKeep.add(planId);
    }

    const stalePlanIds = existingPlanRows
      .map(row => Number(row.id))
      .filter(planId => !existingPlanIdsToKeep.has(planId));

    if (stalePlanIds.length > 0) {
      await this.database.executeUpdate(
        `
          UPDATE agent_plans
          SET
            status = 'cancelled',
            updated_at = CURRENT_TIMESTAMP(3)
          WHERE id IN (${stalePlanIds.map(() => '?').join(',')})
        `,
        stalePlanIds
      );
    }
  }

  private async getLatestWalkCandidates(): Promise<AgentWalkCandidateRecord[]> {
    const rows = await this.database.executeQuery<any>(
      `
        SELECT c.*
        FROM agent_walk_candidates c
        INNER JOIN (
          SELECT MAX(computed_at) AS computed_at
          FROM agent_walk_candidates
        ) latest ON latest.computed_at = c.computed_at
        ORDER BY c.priority_score DESC, c.id ASC
        LIMIT 80
      `
    );

    return rows.map(row => this.mapAgentWalkCandidateRow(row));
  }

  private buildFollowupGoalFromCandidate(candidate: AgentWalkCandidateRecord): string {
    const compilerInputs = candidate.compiler_inputs_json ?? {};
    if (typeof compilerInputs.planner_goal === 'string' && compilerInputs.planner_goal.trim().length > 0) {
      return compilerInputs.planner_goal.trim();
    }
    const excerpt = typeof compilerInputs.latest_observation_excerpt === 'string'
      ? compilerInputs.latest_observation_excerpt
      : '';
    const triggerSources = candidate.trigger_sources_json ?? [];

    if (candidate.field_scope === 'group_chat' || candidate.target_group_id) {
      if (triggerSources.includes('day_plan') || triggerSources.includes('weekly_focus')) {
        return excerpt
          ? `群聊跟进：顺着“${excerpt}”自然接一句，补上当前话题的关注点。`
          : '群聊跟进：围绕当前计划方向自然接一句，补上当前话题的关注点。';
      }
      if (triggerSources.includes('relationship_trigger')) {
        return excerpt
          ? `群聊跟进：顺着“${excerpt}”延续刚打开的群内互动窗口。`
          : '群聊跟进：顺着最近打开的群内互动窗口自然接一句。';
      }
      return excerpt
        ? `群聊跟进：围绕“${excerpt}”做一次低打扰补充。`
        : '群聊跟进：在合适窗口做一次低打扰补充。';
    }

    if (triggerSources.includes('commitment_memory') || triggerSources.includes('commitment_belief')) {
      return excerpt
        ? `跟进：顺着“${excerpt}”确认这项承诺的最新进展。`
        : '跟进：确认对方最近提到的承诺或待办进展。';
    }

    if (triggerSources.includes('relationship_trigger')) {
      return excerpt
        ? `跟进：顺着“${excerpt}”延续最近打开的对话窗口。`
        : '跟进：顺着最近自然打开的对话窗口继续联系。';
    }

    if (triggerSources.includes('day_plan') || triggerSources.includes('weekly_focus')) {
      return excerpt
        ? `跟进：围绕“${excerpt}”自然开启近况确认。`
        : '跟进：围绕当前计划方向自然开启近况确认。';
    }

    return '跟进：在合适窗口做一次低打扰确认。';
  }

  private buildFollowupTriggerCondition(candidate: AgentWalkCandidateRecord): string {
    const compilerInputs = candidate.compiler_inputs_json ?? {};
    if (typeof compilerInputs.planner_trigger_condition === 'string' && compilerInputs.planner_trigger_condition.trim().length > 0) {
      return compilerInputs.planner_trigger_condition.trim();
    }

    const triggerSources = candidate.trigger_sources_json ?? [];
    if (triggerSources.includes('day_plan')) {
      return '今日计划命中该场域，且关系边界允许在自然窗口中主动跟进。';
    }
    if (triggerSources.includes('weekly_focus')) {
      return '本周计划命中该场域，适合在本轮虚拟行走中优先确认进展。';
    }
    if (triggerSources.includes('commitment_memory') || triggerSources.includes('commitment_belief')) {
      return '当前对象存在明确承诺信号，且经过 candidate 排序后进入主动跟进窗口。';
    }
    if (triggerSources.includes('relationship_trigger')) {
      return '关系快照允许主动，且出现了新的互动证据并已过 cooldown。';
    }
    return '当前 candidate 排序命中该场域。';
  }

  private buildMicroIntentionPlanShape(
    message: QQMessage,
    now: Date
  ): {
    targetFieldScope: 'private_chat' | 'group_chat';
    targetUserId: number | null;
    targetGroupId: number | null;
    goal: string;
    triggerCondition: string;
  } | null {
    const excerpt = this.normalizeText(this.extractMessageQueryText(message));
    const safeExcerpt = excerpt ? `“${excerpt.slice(0, 72)}”` : '当前消息';

    if (message.message_type === 'private') {
      return {
        targetFieldScope: 'private_chat',
        targetUserId: message.user_id,
        targetGroupId: null,
        goal: `本回合优先：回应用户${message.user_id}的${safeExcerpt}，判断是直接回复、追问、记录还是延后。`,
        triggerCondition: message.reply_intent_context
          ? '收到新的私聊消息，且当前消息包含 reply 锚点，需要先厘清回应对象。'
          : `收到新的私聊消息，时间=${now.toISOString()}。`
      };
    }

    if (message.message_type === 'group' && message.group_id) {
      const directedReplyHint = message.reply_intent_context
        ? '当前群消息带有 reply 锚点或明确指向，需要优先校准回应对象。'
        : '当前群消息进入需要判断是否发言的窗口。';
      return {
        targetFieldScope: 'group_chat',
        targetUserId: null,
        targetGroupId: message.group_id,
        goal: `本回合优先：在群组${message.group_id}处理用户${message.user_id}的${safeExcerpt}，先判断是否需要发言，再决定回复方式。`,
        triggerCondition: directedReplyHint
      };
    }

    return null;
  }

  private async syncStrategicPlans(
    reflectionId: number,
    reflectionKind: AgentReflectionKind,
    now: Date,
    commitmentMemories: AgentMemoryRecord[]
  ): Promise<void> {
    if (reflectionKind === 'daily') {
      await this.upsertSelfGlobalPlan({
        planType: 'day_plan',
        goal: this.buildDayPlanGoal(commitmentMemories),
        triggerCondition: '今天在自然对话窗口中优先推进这些事项，并保持记忆整理节奏。',
        reflectionId,
        now,
        metadata: {
          compiler_source_kind: 'daily_reflection_plan',
          source_memory_ids: commitmentMemories.slice(0, 6).map(memory => memory.id)
        }
      });
      return;
    }

    if (reflectionKind === 'weekly') {
      await this.upsertSelfGlobalPlan({
        planType: 'weekly_focus',
        goal: this.buildWeeklyFocusGoal(commitmentMemories),
        triggerCondition: '本周在主动跟进与回复决策中优先围绕这些重点展开。',
        reflectionId,
        now,
        metadata: {
          compiler_source_kind: 'weekly_reflection_plan',
          source_memory_ids: commitmentMemories.slice(0, 6).map(memory => memory.id)
        }
      });
    }
  }

  private buildDayPlanGoal(commitmentMemories: AgentMemoryRecord[]): string {
    const highlights = commitmentMemories
      .slice(0, 3)
      .map(memory => this.buildStrategicPlanItem(memory));

    if (highlights.length === 0) {
      return '今日优先：保持观察、整理记忆，并在有自然对话窗口时谨慎推进合适的跟进事项。';
    }

    return `今日优先：${highlights.join('；')}；保持记忆整理与克制主动的节奏。`;
  }

  private buildWeeklyFocusGoal(commitmentMemories: AgentMemoryRecord[]): string {
    const highlights = commitmentMemories
      .slice(0, 3)
      .map(memory => this.buildStrategicPlanItem(memory));

    if (highlights.length === 0) {
      return '本周重点：持续观察关系变化，沉淀稳定记忆，并保持谨慎而连续的主动节奏。';
    }

    return `本周重点：${highlights.join('；')}；持续沉淀稳定承诺与关系线索。`;
  }

  private buildStrategicPlanItem(memory: AgentMemoryRecord): string {
    const targetLabel = memory.user_id
      ? `跟进用户${memory.user_id}`
      : '跟进一条承诺';
    const normalizedContent = this.normalizeText(memory.content.replace(/^用户/, ''));
    return normalizedContent
      ? `${targetLabel}关于“${normalizedContent}”`
      : targetLabel;
  }

  private async upsertSelfGlobalPlan(options: {
    planType: 'weekly_focus' | 'day_plan';
    goal: string;
    triggerCondition: string;
    reflectionId: number;
    now: Date;
    metadata?: any;
  }): Promise<void> {
    const existingRows = await this.database.executeQuery<any>(
      `
        SELECT id
        FROM agent_plans
        WHERE plan_type = ?
          AND target_user_id IS NULL
          AND target_group_id IS NULL
          AND status IN ('queued', 'active')
        ORDER BY id DESC
      `,
      [options.planType]
    );

    const keepId = existingRows[0] ? Number(existingRows[0].id) : null;
    if (keepId) {
      await this.database.executeUpdate(
        `
          UPDATE agent_plans
          SET
            target_field_scope = NULL,
            goal = ?,
            trigger_condition = ?,
            status = 'queued',
            scheduled_start_at = ?,
            scheduled_end_at = NULL,
            source_reflection_id = ?,
            source_plan_id = NULL,
            plan_metadata_json = ?,
            updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ?
        `,
        [
          options.goal,
          options.triggerCondition,
          options.now,
          options.reflectionId,
          JSON.stringify(options.metadata ?? null),
          keepId
        ]
      );
    } else {
      await this.database.executeInsertAndReturnId(
        `
          INSERT INTO agent_plans (
            plan_type,
            target_field_scope,
            target_user_id,
            target_group_id,
            goal,
            trigger_condition,
            status,
            scheduled_start_at,
            scheduled_end_at,
            source_reflection_id,
            source_plan_id,
            plan_metadata_json
          ) VALUES (?, NULL, NULL, NULL, ?, ?, 'queued', ?, NULL, ?, NULL, ?)
        `,
        [
          options.planType,
          options.goal,
          options.triggerCondition,
          options.now,
          options.reflectionId,
          JSON.stringify(options.metadata ?? null)
        ]
      );
    }

    const staleIds = existingRows
      .slice(1)
      .map((row: { id: number | string }) => Number(row.id))
      .filter(planId => Number.isFinite(planId));

    if (staleIds.length > 0) {
      await this.database.executeUpdate(
        `
          UPDATE agent_plans
          SET
            status = 'cancelled',
            updated_at = CURRENT_TIMESTAMP(3)
          WHERE id IN (${staleIds.map(() => '?').join(',')})
        `,
        staleIds
      );
    }
  }

  private async ensureFeedbackEvents(params: {
    now: Date;
    actionRows: any[];
    observations: AgentObservationRecord[];
    relationships: AgentRelationshipMemoryRecord[];
    fields: Map<string, {
      field_key: string;
      field_scope: 'private_chat' | 'group_chat' | 'thread' | 'tool_channel';
      user_id: number | null;
      group_id: number | null;
    }>;
  }): Promise<AgentFeedbackEventRecord[]> {
    const relevantActions = params.actionRows.filter(row =>
      (row.action_type === 'followup_private_message' || row.action_type === 'followup_group_message') &&
      row.status === 'completed'
    );

    if (relevantActions.length === 0) {
      return this.loadRecentFeedbackEvents(params.now);
    }

    const existingActionIds = new Set<number>();
    const actionIds = relevantActions
      .map(row => Number(row.id))
      .filter(id => Number.isFinite(id));

    if (actionIds.length > 0) {
      const existingRows = await this.database.executeQuery<any>(
        `
          SELECT source_action_log_id
          FROM agent_feedback_events
          WHERE source_action_log_id IN (${actionIds.map(() => '?').join(',')})
        `,
        actionIds
      );
      existingRows.forEach(row => existingActionIds.add(Number(row.source_action_log_id)));
    }

    const relationshipsByKey = new Map<string, AgentRelationshipMemoryRecord>();
    params.relationships.forEach(relationship => {
      relationshipsByKey.set(`${relationship.target_user_id}:${relationship.group_id ?? 'global'}`, relationship);
    });

    for (const row of relevantActions) {
      const actionId = Number(row.id);
      if (!Number.isFinite(actionId) || existingActionIds.has(actionId)) {
        continue;
      }

      const targetUserId = this.parseNumericId(row.target_user_id);
      const targetGroupId = this.parseNumericId(row.target_group_id);
      const fieldKey = targetUserId
        ? `private:user:${targetUserId}`
        : targetGroupId
          ? `group:${targetGroupId}`
          : null;
      if (!fieldKey || !params.fields.has(fieldKey)) {
        continue;
      }

      const occurredAt = this.parseDate(row.occurred_at);
      const subsequentObservations = params.observations.filter(observation => {
        const isInbound = observation.source_type === 'incoming_message' || observation.source_type === 'reply_anchor';
        if (!isInbound || observation.occurred_at <= occurredAt) {
          return false;
        }
        if (targetUserId) {
          return observation.user_id === targetUserId;
        }
        if (targetGroupId) {
          return observation.group_id === targetGroupId;
        }
        return false;
      });
      const relationship = targetUserId
        ? relationshipsByKey.get(`${targetUserId}:${targetGroupId ?? 'global'}`)
          ?? relationshipsByKey.get(`${targetUserId}:global`)
          ?? null
        : null;
      const fallback = this.buildFeedbackFallback({
        actionOccurredAt: occurredAt,
        subsequentObservations,
        now: params.now
      });
      const evaluated = await this.evaluateFeedback({
        fieldKey,
        targetUserId,
        targetGroupId,
        actionLog: {
          id: actionId,
          action_type: String(row.action_type),
          status: String(row.status),
          occurred_at: occurredAt,
          payload_json: this.parseJsonField(row.payload_json)
        },
        subsequentObservations,
        relationship,
        fallback,
        now: params.now
      });

      await this.database.executeInsertAndReturnId(
        `
          INSERT INTO agent_feedback_events (
            field_key,
            target_user_id,
            target_group_id,
            source_action_log_id,
            judgement,
            reason_code,
            explanation_json,
            llm_trace_id,
            occurred_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          fieldKey,
          targetUserId,
          targetGroupId,
          actionId,
          evaluated.judgement,
          evaluated.reason_code,
          JSON.stringify({
            explanation: evaluated.explanation ?? null,
            confidence: evaluated.confidence ?? null,
            should_suppress: evaluated.should_suppress ?? (evaluated.judgement === 'negative'),
            observation_count: subsequentObservations.length,
            observation_excerpt: subsequentObservations[0]
              ? this.truncateForFlush(subsequentObservations[0].content, 120)
              : null,
            fallback_reason_code: fallback.reason_code,
            prompt_id: evaluated.prompt_id ?? null,
            prompt_name: evaluated.prompt_name ?? null,
            prompt_version: evaluated.prompt_version ?? null,
            tool_name: evaluated.tool_name ?? null,
            tool_agent_type: evaluated.tool_agent_type ?? null,
            contract_status: evaluated.contract_status ?? null,
            contract_error_code: evaluated.contract_error_code ?? null
          }),
          evaluated.llm_trace_id ?? null,
          params.now
        ]
      );
    }

    return this.loadRecentFeedbackEvents(params.now);
  }

  private async loadRecentFeedbackEvents(now: Date): Promise<AgentFeedbackEventRecord[]> {
    if (!(await this.hasTable('agent_feedback_events'))) {
      return [];
    }

    const horizonStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const rows = await this.database.executeQuery<any>(
      `
        SELECT *
        FROM agent_feedback_events
        WHERE occurred_at >= ?
        ORDER BY occurred_at DESC, id DESC
        LIMIT 400
      `,
      [horizonStart]
    );

    return rows.map(row => this.mapAgentFeedbackEventRow(row));
  }

  private buildFeedbackFallback(params: {
    actionOccurredAt: Date;
    subsequentObservations: AgentObservationRecord[];
    now: Date;
  }): FeedbackEvaluationResult {
    const rejection = params.subsequentObservations.find(observation =>
      this.hasExplicitRejectionSignal(observation.content)
    );
    if (rejection) {
      return {
        judgement: 'negative',
        reason_code: 'explicit_rejection',
        confidence: 0.9,
        explanation: '后续消息里出现了明确拒绝或暂不联系信号。',
        should_suppress: true
      };
    }

    if (params.subsequentObservations.length > 0) {
      return {
        judgement: 'positive',
        reason_code: 'user_replied_after_followup',
        confidence: 0.78,
        explanation: '主动动作之后收到了新的 inbound 消息，说明场域被继续接住。'
      };
    }

    const hoursSinceAction = Math.max(
      0,
      (params.now.getTime() - params.actionOccurredAt.getTime()) / (60 * 60 * 1000)
    );
    if (hoursSinceAction >= 48) {
      return {
        judgement: 'negative',
        reason_code: 'no_response_48h',
        confidence: 0.72,
        explanation: '主动动作发出 48 小时后仍无新的 inbound 消息，按负反馈候选处理。',
        should_suppress: true
      };
    }

    return {
      judgement: 'neutral',
      reason_code: 'awaiting_feedback_window',
      confidence: 0.55,
      explanation: '当前还在等待反馈窗口内，不足以下结论。'
    };
  }

  private async evaluateFeedback(params: {
    fieldKey: string;
    targetUserId: number | null;
    targetGroupId: number | null;
    actionLog: {
      id: number;
      action_type: string;
      status: string;
      occurred_at: Date;
      payload_json: any;
    };
    subsequentObservations: AgentObservationRecord[];
    relationship: AgentRelationshipMemoryRecord | null;
    fallback: FeedbackEvaluationResult;
    now: Date;
  }): Promise<FeedbackEvaluationResult> {
    if (!this.feedbackEvaluator) {
      return params.fallback;
    }

    try {
      const evaluated = await this.feedbackEvaluator(params);
      if (!evaluated) {
        return params.fallback;
      }

      if (
        evaluated.judgement !== 'positive' &&
        evaluated.judgement !== 'neutral' &&
        evaluated.judgement !== 'negative'
      ) {
        return params.fallback;
      }

      if (!evaluated.reason_code) {
        return params.fallback;
      }

      return {
        ...params.fallback,
        ...evaluated
      };
    } catch (error) {
      this.moduleLogger.warn('feedback_evaluator_failed', {
        fieldKey: params.fieldKey,
        targetUserId: params.targetUserId,
        targetGroupId: params.targetGroupId,
        error: error instanceof Error ? error.message : String(error)
      });
      return params.fallback;
    }
  }

  private async hasTable(tableName: string): Promise<boolean> {
    const rows = await this.database.executeQuery<{ total: number }>(
      `
        SELECT COUNT(*) AS total
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name = ?
      `,
      [tableName]
    );

    return Number(rows[0]?.total || 0) > 0;
  }

  private async getPersistedProactivityControlRow(): Promise<any | null> {
    if (!(await this.hasTable('agent_proactivity_controls'))) {
      return null;
    }

    const rows = await this.database.executeQuery<any>(
      `
        SELECT *
        FROM agent_proactivity_controls
        WHERE id = 1
        LIMIT 1
      `
    );

    return rows[0] ?? null;
  }

  private mapPersistedProactivityControlRow(row: any): AgentProactivityRuntimeConfig {
    return this.normalizeProactivityConfig({
      followupEnabled: this.toBooleanFlag(row.followup_enabled, true),
      isPaused: this.toBooleanFlag(row.is_paused, false),
      allowedUserIds: this.parseAllowedUserIds(row.allowed_user_ids),
      observedGroupIds: this.parseAllowedGroupIds(row.observed_group_ids),
      allowedGroupIds: this.parseAllowedGroupIds(row.allowed_group_ids),
      maxPerRun: Number(row.max_per_run),
      retryDelayMs: Number(row.retry_delay_ms)
    });
  }

  private async getProactivityControlStats(): Promise<{
    queuedFollowups: number;
    activeFollowups: number;
    recentActionLogCount: number;
    lastActionAt: string | null;
  }> {
    const [plansReady, actionLogsReady] = await Promise.all([
      this.hasTable('agent_plans'),
      this.hasTable('agent_action_logs')
    ]);
    const [planStats, actionStats] = await Promise.all([
      plansReady
        ? this.database.executeQuery<{
            queued_total: number;
            active_total: number;
          }>(
            `
              SELECT
                SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued_total,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_total
              FROM agent_plans
              WHERE plan_type = 'followup_queue'
            `
          )
        : Promise.resolve([]),
      actionLogsReady
        ? this.database.executeQuery<{
            recent_total: number;
            last_action_at: string | null;
          }>(
            `
              SELECT
                COUNT(*) AS recent_total,
                MAX(occurred_at) AS last_action_at
              FROM agent_action_logs
              WHERE action_type IN ('followup_private_message', 'followup_group_message')
                AND occurred_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            `
          )
        : Promise.resolve([])
    ]);

    return {
      queuedFollowups: Number(planStats[0]?.queued_total || 0),
      activeFollowups: Number(planStats[0]?.active_total || 0),
      recentActionLogCount: Number(actionStats[0]?.recent_total || 0),
      lastActionAt: actionStats[0]?.last_action_at ?? null
    };
  }

  private renderFollowupMessage(plan: AgentPlanRecord): string {
    const metadata = plan.plan_metadata_json ?? {};
    if (typeof metadata.draft_message === 'string' && metadata.draft_message.trim().length > 0) {
      return metadata.draft_message.trim();
    }
    const normalizedGoal = this.normalizeText(plan.goal.replace(/^跟进[:：]\s*/, ''));
    if (plan.target_field_scope === 'group_chat' || plan.target_group_id) {
      if (normalizedGoal.includes('顺着')) {
        return '我接一句：这个点我也在关注，后续有进展可以继续往下说。';
      }
      return `我补一句：${normalizedGoal}。`;
    }
    if (normalizedGoal.startsWith('用户打算')) {
      return `前几天你提到打算${normalizedGoal.slice('用户打算'.length)}，最近进展怎么样？`;
    }
    if (normalizedGoal.startsWith('用户准备')) {
      return `前几天你提到准备${normalizedGoal.slice('用户准备'.length)}，最近进展怎么样？`;
    }
    if (normalizedGoal.startsWith('用户会')) {
      return `前几天你提到会${normalizedGoal.slice('用户会'.length)}，最近进展怎么样？`;
    }
    return `前几天你提到过一件事，我想跟进一下：${normalizedGoal}。最近进展怎么样？`;
  }

  private async markPlanActive(planId: number, now: Date): Promise<void> {
    await this.database.executeUpdate(
      `
        UPDATE agent_plans
        SET
          status = 'active',
          scheduled_start_at = COALESCE(scheduled_start_at, ?),
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?
      `,
      [now, planId]
    );
  }

  private async completeFollowupPlan(planId: number, now: Date): Promise<void> {
    await this.database.executeUpdate(
      `
        UPDATE agent_plans
        SET
          status = 'completed',
          scheduled_end_at = ?,
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?
      `,
      [now, planId]
    );
  }

  private async rescheduleFollowupPlan(planId: number, nextStartAt: Date): Promise<void> {
    await this.database.executeUpdate(
      `
        UPDATE agent_plans
        SET
          status = 'queued',
          scheduled_start_at = ?,
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?
      `,
      [nextStartAt, planId]
    );
  }

  private async cancelPlan(planId: number, now: Date): Promise<void> {
    await this.database.executeUpdate(
      `
        UPDATE agent_plans
        SET
          status = 'cancelled',
          scheduled_end_at = ?,
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?
      `,
      [now, planId]
    );
  }

  private async cancelSuppressedFollowupsForSubject(params: {
    targetUserId: number | null;
    groupId: number | null;
    now: Date;
  }): Promise<number[]> {
    if (!params.targetUserId) {
      return [];
    }

    const snapshot = await this.getCurrentRelationshipSnapshot(
      params.targetUserId,
      params.groupId
    );
    const boundaryStrategy = snapshot?.boundary_strategy ?? null;
    if (boundaryStrategy !== 'observe_only' && boundaryStrategy !== 'do_not_contact') {
      return [];
    }

    const rows = await this.database.executeQuery<any>(
      `
        SELECT id
        FROM agent_plans
        WHERE plan_type = 'followup_queue'
          AND status IN ('queued', 'active')
          AND target_user_id = ?
          AND target_group_id <=> ?
      `,
      [params.targetUserId, params.groupId]
    );
    const planIds = rows
      .map(row => Number(row.id))
      .filter(planId => Number.isFinite(planId));

    for (const planId of planIds) {
      await this.cancelPlan(planId, params.now);
    }

    return planIds;
  }

  private async hasCurrentRelationshipSnapshots(): Promise<boolean> {
    if (!(await this.hasTable('agent_relationship_memories'))) {
      return false;
    }

    const rows = await this.database.executeQuery<{ total: number }>(
      `
        SELECT COUNT(*) AS total
        FROM agent_relationship_memories
        WHERE is_current = 1
          AND status = 'active'
      `
    );

    return Number(rows[0]?.total || 0) > 0;
  }

  private async insertActionLog(record: {
    action_type: string;
    trigger_kind?: string | null;
    source_plan_id?: number | null;
    target_user_id?: number | null;
    target_group_id?: number | null;
    payload_json?: any;
    status: string;
    occurred_at: Date;
  }): Promise<void> {
    await this.database.executeInsertAndReturnId(
      `
        INSERT INTO agent_action_logs (
          action_type,
          trigger_kind,
          source_plan_id,
          target_user_id,
          target_group_id,
          payload_json,
          status,
          occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        record.action_type,
        record.trigger_kind ?? null,
        record.source_plan_id ?? null,
        record.target_user_id ?? null,
        record.target_group_id ?? null,
        JSON.stringify(record.payload_json ?? null),
        record.status,
        record.occurred_at
      ]
    );
  }

  private async updateMicroIntentionStatusForMessage(
    message: QQMessage,
    status: 'completed' | 'cancelled',
    reason: string | null,
    now: Date
  ): Promise<number> {
    if (!(await this.hasTable('agent_plans'))) {
      return 0;
    }

    const targetUserId = message.message_type === 'private' ? message.user_id : null;
    const targetGroupId = message.message_type === 'group' ? message.group_id ?? null : null;
    const metadata = reason
      ? JSON.stringify({
          lifecycle_reason: reason,
          lifecycle_updated_at: now.toISOString()
        })
      : null;

    return this.database.executeUpdate(
      `
        UPDATE agent_plans
        SET
          status = ?,
          scheduled_end_at = ?,
          plan_metadata_json = CASE WHEN ? IS NULL THEN plan_metadata_json ELSE ? END,
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE plan_type = 'micro_intention'
          AND target_user_id <=> ?
          AND target_group_id <=> ?
          AND status IN ('queued', 'active')
      `,
      [status, now, metadata, metadata, targetUserId, targetGroupId]
    );
  }

  private async getCurrentRelationshipSnapshot(
    targetUserId: number,
    groupId: number | null
  ): Promise<AgentRelationshipMemoryRecord | undefined> {
    if (!(await this.hasTable('agent_relationship_memories'))) {
      return undefined;
    }

    const rows = await this.database.executeQuery<any>(
      `
        SELECT *
        FROM agent_relationship_memories
        WHERE target_user_id = ?
          AND group_id <=> ?
          AND is_current = 1
          AND status = 'active'
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `,
      [targetUserId, groupId]
    );

    return rows[0] ? this.mapAgentRelationshipMemoryRow(rows[0]) : undefined;
  }

  private determineRelationshipBoundaryStrategy(
    relationshipEvidenceCount: number,
    actionRows: any[],
    observations: AgentObservationRecord[]
  ): AgentRelationshipBoundaryStrategy {
    if (observations.some(observation => this.hasExplicitRejectionSignal(observation.content))) {
      return 'observe_only';
    }

    const hasRecentFailure = actionRows.some(action => String(action.status || '').startsWith('failed'));
    if (hasRecentFailure) {
      return 'observe_only';
    }

    return relationshipEvidenceCount > 0 ? 'allow_proactive' : 'observe_only';
  }

  private deriveRelationshipConfidence(
    relationshipEvidenceCount: number,
    beliefEvidenceCount: number
  ): number {
    return this.clampScore(
      0.4 +
      Math.min(0.35, relationshipEvidenceCount * 0.18) +
      Math.min(0.15, beliefEvidenceCount * 0.12)
    );
  }

  private buildRelationshipSummary(
    targetUserId: number,
    groupId: number | null,
    memories: AgentMemoryRecord[],
    beliefs: AgentBeliefRecord[]
  ): string {
    const clues = this.uniqueStrings(
      memories
        .slice(0, 3)
        .map(memory => memory.content)
        .concat(beliefs.slice(0, 2).map(belief => belief.claim))
    );

    if (clues.length === 0) {
      return groupId
        ? `用户${targetUserId}在群${groupId}当前主要处于观察阶段，缺少足够稳定的关系线索。`
        : `用户${targetUserId}当前主要处于观察阶段，缺少足够稳定的关系线索。`;
    }

    return groupId
      ? `用户${targetUserId}在群${groupId}当前关系线索：${clues.join('；')}`
      : `用户${targetUserId}当前关系线索：${clues.join('；')}`;
  }

  private buildRelationshipInteractionStyle(
    groupId: number | null
  ): string {
    return groupId
      ? '优先顺着群内上下文自然接话，避免在群里突然转成高频点名推进。'
      : '保持自然、简洁、低打扰的私聊节奏，只在明确窗口里谨慎主动。';
  }

  private hasExplicitRejectionSignal(content: string): boolean {
    const normalized = this.normalizeText(content);
    if (!normalized) {
      return false;
    }

    return [
      '先别',
      '不要',
      '不想聊',
      '别再',
      '别发',
      '别联系',
      '先不用',
      '先不聊',
      '先这样',
      '现在不方便',
      '回头再说',
      '改天再说'
    ].some(token => normalized.includes(this.normalizeText(token)));
  }

  private isRelationshipTriggerActive(params: {
    relationship: AgentRelationshipMemoryRecord | null;
    latestActionAt: Date | null;
    latestIncomingAt: Date | null;
    now: Date;
  }): boolean {
    if (!params.relationship || params.relationship.boundary_strategy !== 'allow_proactive') {
      return false;
    }

    if (!params.latestActionAt) {
      return params.now.getTime() - params.relationship.last_observed_at.getTime() <= 7 * 24 * 60 * 60 * 1000;
    }

    const cooldownEnded = params.now.getTime() - params.latestActionAt.getTime() >= 24 * 60 * 60 * 1000;
    const hasNewEvidence = Boolean(
      params.latestIncomingAt && params.latestIncomingAt.getTime() > params.latestActionAt.getTime()
    );
    return cooldownEnded && hasNewEvidence;
  }

  private buildWalkSuppressionReason(params: {
    fieldScope: 'private_chat' | 'group_chat' | 'thread' | 'tool_channel';
    relationship: AgentRelationshipMemoryRecord | null;
    cooldownPenalty: number;
    hasUnknownRelationship: boolean;
    hasNegativeFeedback: boolean;
    hasStrongTrigger: boolean;
    targetUserId: number | null;
    targetGroupId: number | null;
    observeEnabled: boolean;
    proactiveEnabled: boolean;
  }): string | null {
    if (params.relationship?.boundary_strategy === 'do_not_contact') {
      return 'boundary_strategy_do_not_contact';
    }
    if (params.relationship?.boundary_strategy === 'observe_only') {
      return 'boundary_strategy_observe_only';
    }
    if (params.fieldScope === 'group_chat' && params.targetGroupId) {
      if (!params.observeEnabled) {
        return 'group_observation_disabled';
      }
      if (!params.proactiveEnabled) {
        return 'group_proactivity_not_allowed';
      }
    }
    if (!params.targetUserId && params.fieldScope === 'private_chat') {
      return 'missing_private_target';
    }
    if (params.hasUnknownRelationship) {
      return 'no_current_relationship_snapshot';
    }
    if (params.hasNegativeFeedback) {
      return 'negative_feedback_window_active';
    }
    if (params.cooldownPenalty > 0.25) {
      return 'cooldown_active';
    }
    if (!params.hasStrongTrigger) {
      return 'no_strong_trigger';
    }
    return null;
  }

  private buildWalkSelectedReason(
    field: {
      title: string;
      relationship: AgentRelationshipMemoryRecord | null;
      latest_observation_excerpt: string | null;
      active_plan_count: number;
    },
    triggerSources: string[]
  ): string {
    if (triggerSources.includes('day_plan') || triggerSources.includes('weekly_focus')) {
      return `${field.title} 命中了当前战略计划，需要先看这里再决定是否跟进。`;
    }
    if (triggerSources.includes('commitment_memory') || triggerSources.includes('commitment_belief')) {
      return `${field.title} 命中了明确承诺信号，适合作为当前优先关注对象。`;
    }
    if (triggerSources.includes('relationship_trigger') && field.relationship) {
      return `${field.title} 当前关系快照允许主动，且最近出现了新的互动窗口。`;
    }
    if (field.latest_observation_excerpt) {
      return `${field.title} 最近有新动态：“${field.latest_observation_excerpt}”。`;
    }
    return `${field.title} 保持在当前虚拟行走候选池中。`;
  }

  private async evaluateRelationshipInsight(params: {
    targetUserId: number;
    groupId: number | null;
    fieldScope: 'private_chat' | 'group_chat';
    memories: AgentMemoryRecord[];
    beliefs: AgentBeliefRecord[];
    auxiliaryMemories: AgentMemoryRecord[];
    observations: AgentObservationRecord[];
    actionRows: any[];
    existingSnapshot: AgentRelationshipMemoryRecord | null;
    reflectionKind: AgentReflectionKind;
    fallback: RelationshipInsightEvaluationResult;
    now: Date;
  }): Promise<RelationshipInsightEvaluationResult> {
    if (!this.relationshipInsightEvaluator) {
      return params.fallback;
    }

    try {
      const evaluated = await this.relationshipInsightEvaluator(params);
      if (!evaluated) {
        return params.fallback;
      }

      return {
        ...params.fallback,
        ...evaluated,
        impression_profile: this.normalizeImpressionProfile(evaluated.impression_profile ?? params.fallback.impression_profile),
        speech_policy: this.normalizeSpeechPolicy(evaluated.speech_policy ?? params.fallback.speech_policy),
        memory_bias: this.normalizeMemoryBias(evaluated.memory_bias ?? params.fallback.memory_bias)
      };
    } catch (error) {
      this.moduleLogger.warn('relationship_insight_evaluator_failed', {
        targetUserId: params.targetUserId,
        groupId: params.groupId,
        error: error instanceof Error ? error.message : String(error)
      });
      return params.fallback;
    }
  }

  private async evaluateWalkPlanner(params: {
    field: {
      fieldKey: string;
      fieldScope: 'private_chat' | 'group_chat' | 'thread' | 'tool_channel';
      targetUserId: number | null;
      targetGroupId: number | null;
      title: string;
      latestObservationExcerpt: string | null;
      priorityScore: number;
      inboundScore: number;
      relationshipScore: number;
      planScore: number;
      noveltyScore: number;
      cooldownPenalty: number;
      boundaryPenalty: number;
      activePlanCount: number;
      actionCount: number;
      triggerSources: string[];
      hardSuppressionReason: string | null;
      latestActionAt: Date | null;
      latestIncomingAt: Date | null;
      latestFeedbackJudgement: AgentFeedbackJudgement | null;
      latestFeedbackReasonCode: string | null;
    };
    relationship: AgentRelationshipMemoryRecord | null;
    strategicPlans: AgentPlanRecord[];
    sourceMemories: AgentMemoryRecord[];
    sourceBeliefs: AgentBeliefRecord[];
    now: Date;
  }): Promise<WalkPlannerEvaluationResult | null> {
    if (!this.walkPlannerEvaluator) {
      return null;
    }

    try {
      return await this.walkPlannerEvaluator(params);
    } catch (error) {
      this.moduleLogger.warn('walk_planner_evaluator_failed', {
        fieldKey: params.field.fieldKey,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private buildFallbackImpressionProfile(target: {
    observations: AgentObservationRecord[];
    memories: AgentMemoryRecord[];
    beliefs: AgentBeliefRecord[];
    actionRows: any[];
  }): AgentRelationshipImpressionProfile {
    const base = target.memories.length + target.beliefs.length;
    const hasRejection = target.observations.some(observation => this.hasExplicitRejectionSignal(observation.content));
    const successfulSignals = target.observations.length > 0 ? 1 : 0;
    return {
      familiarity: this.clampScore(0.3 + base * 0.08),
      warmth: this.clampScore(0.35 + successfulSignals * 0.08 - (hasRejection ? 0.15 : 0)),
      trust: this.clampScore(0.35 + target.memories.length * 0.1),
      engagement: this.clampScore(0.3 + target.observations.length * 0.04),
      fragility: this.clampScore(hasRejection ? 0.75 : 0.25 + Math.max(0, target.actionRows.length - target.observations.length) * 0.08)
    };
  }

  private buildFallbackSpeechPolicy(
    groupId: number | null,
    boundaryStrategy: AgentRelationshipBoundaryStrategy
  ): AgentRelationshipSpeechPolicy {
    if (boundaryStrategy === 'do_not_contact') {
      return {
        tone: 'reserved',
        directness: 'low',
        initiative: 'observe',
        verbosity: 'brief'
      };
    }

    if (boundaryStrategy === 'observe_only') {
      return {
        tone: 'neutral',
        directness: 'low',
        initiative: 'observe',
        verbosity: 'brief'
      };
    }

    return {
      tone: groupId ? 'neutral' : 'warm',
      directness: groupId ? 'low' : 'medium',
      initiative: groupId ? 'follow_window' : 'proactive_ok',
      verbosity: 'adaptive'
    };
  }

  private buildFallbackMemoryBias(target: {
    auxiliaryMemories: AgentMemoryRecord[];
  }): AgentRelationshipMemoryBias {
    const retrieveBoostTopics = target.auxiliaryMemories
      .map(memory => this.truncateForFlush(memory.content, 32))
      .filter(Boolean)
      .slice(0, 4);
    return {
      promote_threshold_modifier: 0,
      retrieve_boost_topics: this.uniqueStrings(retrieveBoostTopics),
      sensitive_topics: []
    };
  }

  private normalizeImpressionProfile(
    profile?: AgentRelationshipImpressionProfile | null
  ): AgentRelationshipImpressionProfile {
    return {
      familiarity: this.clampScore(profile?.familiarity ?? 0.3),
      warmth: this.clampScore(profile?.warmth ?? 0.35),
      trust: this.clampScore(profile?.trust ?? 0.35),
      engagement: this.clampScore(profile?.engagement ?? 0.3),
      fragility: this.clampScore(profile?.fragility ?? 0.25)
    };
  }

  private normalizeSpeechPolicy(
    policy?: AgentRelationshipSpeechPolicy | null
  ): AgentRelationshipSpeechPolicy {
    return {
      tone: policy?.tone ?? 'neutral',
      directness: policy?.directness ?? 'medium',
      initiative: policy?.initiative ?? 'follow_window',
      verbosity: policy?.verbosity ?? 'adaptive'
    };
  }

  private normalizeMemoryBias(
    memoryBias?: AgentRelationshipMemoryBias | null
  ): AgentRelationshipMemoryBias {
    return {
      promote_threshold_modifier: Number.isFinite(memoryBias?.promote_threshold_modifier)
        ? Number(memoryBias?.promote_threshold_modifier)
        : 0,
      retrieve_boost_topics: this.uniqueStrings(memoryBias?.retrieve_boost_topics ?? []),
      sensitive_topics: this.uniqueStrings(memoryBias?.sensitive_topics ?? [])
    };
  }

  private uniqueMemoryRecords(memories: AgentMemoryRecord[]): AgentMemoryRecord[] {
    const seen = new Set<number>();
    return memories.filter(memory => {
      if (!memory || seen.has(memory.id)) {
        return false;
      }
      seen.add(memory.id);
      return true;
    });
  }

  private parseNumericId(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private normalizeProactivityConfig(
    input: Partial<AgentProactivityRuntimeConfig>
  ): AgentProactivityRuntimeConfig {
    return {
      followupEnabled: Boolean(input.followupEnabled),
      isPaused: Boolean(input.isPaused),
      allowedUserIds: this.normalizeAllowedUserIds(input.allowedUserIds),
      observedGroupIds: this.normalizeAllowedGroupIds(input.observedGroupIds),
      allowedGroupIds: this.normalizeAllowedGroupIds(input.allowedGroupIds),
      maxPerRun: Math.max(1, Math.min(5, Math.floor(Number(input.maxPerRun ?? 1) || 1))),
      retryDelayMs: Math.max(60_000, Math.floor(Number(input.retryDelayMs ?? 21600000) || 21600000))
    };
  }

  private parseAllowedUserIds(value: unknown): number[] {
    if (Array.isArray(value)) {
      return this.normalizeAllowedUserIds(value);
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? this.normalizeAllowedUserIds(parsed) : [];
      } catch {
        return this.normalizeAllowedUserIds(value.split(','));
      }
    }

    return [];
  }

  private parseAllowedGroupIds(value: unknown): number[] {
    if (Array.isArray(value)) {
      return this.normalizeAllowedGroupIds(value);
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? this.normalizeAllowedGroupIds(parsed) : [];
      } catch {
        return this.normalizeAllowedGroupIds(value.split(','));
      }
    }

    return [];
  }

  private normalizeAllowedUserIds(values: unknown): number[] {
    if (!Array.isArray(values)) {
      return [];
    }

    return Array.from(
      new Set(
        values
          .map(value => Number(String(value).trim()))
          .filter(value => Number.isFinite(value) && value > 0)
      )
    );
  }

  private normalizeAllowedGroupIds(values: unknown): number[] {
    if (!Array.isArray(values)) {
      return [];
    }

    return Array.from(
      new Set(
        values
          .map(value => Number(String(value).trim()))
          .filter(value => Number.isFinite(value) && value > 0)
      )
    );
  }

  private toBooleanFlag(value: unknown, fallback: boolean): boolean {
    if (value === null || value === undefined) {
      return fallback;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      return value > 0;
    }

    const normalized = String(value).trim().toLowerCase();
    if (normalized === '1' || normalized === 'true') {
      return true;
    }
    if (normalized === '0' || normalized === 'false') {
      return false;
    }

    return fallback;
  }

  private uniqueStrings(values: Array<string | null | undefined>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
      const normalized = this.normalizeText(value || '');
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      result.push(normalized);
    }

    return result;
  }

  private uniqueNumbers(values: Array<number | null | undefined>): number[] {
    const seen = new Set<number>();
    const result: number[] = [];

    for (const value of values) {
      if (!Number.isFinite(value) || !value || value <= 0 || seen.has(value)) {
        continue;
      }
      seen.add(value);
      result.push(value);
    }

    return result;
  }

  private async reflectionExists(reflectionKey: string): Promise<boolean> {
    const rows = await this.database.executeQuery<{ total: number }>(
      `SELECT COUNT(*) AS total FROM agent_reflections WHERE reflection_key = ?`,
      [reflectionKey]
    );
    return (rows[0]?.total || 0) > 0;
  }

  private async promoteBeliefRecord(
    belief: AgentBeliefRecord,
    options: {
      evidenceObservationId?: number | null;
      sourceKind?: AgentMemorySourceKind;
    }
  ): Promise<AgentMemoryRecord | null> {
    const promotion = this.resolvePromotionReason(belief, options.sourceKind);
    if (!promotion) {
      return null;
    }

    const evidenceObservation = options.evidenceObservationId
      ? await this.getObservationById(options.evidenceObservationId)
      : null;
    const targetUserId = belief.subject_type === 'user'
      ? this.parseNumericId(belief.subject_id)
      : null;
    const relationshipContext = targetUserId
      ? await this.getCurrentRelationshipSnapshot(
          targetUserId,
          evidenceObservation?.group_id ?? null
        )
      : undefined;
    const memoryScope = this.resolveMemoryScope(belief, evidenceObservation, relationshipContext);
    const fieldScope = evidenceObservation?.field_scope ?? null;
    const userId = evidenceObservation?.user_id ?? null;
    const groupId = evidenceObservation?.group_id ?? null;
    const normalizedContent = this.normalizeText(belief.claim);
    const derivedSalience = this.deriveSalience(belief, relationshipContext);

    const existingRows = await this.database.executeQuery<any>(
      `
        SELECT *
        FROM agent_memories
        WHERE subject_type = ?
          AND subject_id = ?
          AND memory_type = ?
          AND normalized_content = ?
          AND status = 'active'
        ORDER BY id DESC
        LIMIT 1
      `,
      [
        belief.subject_type,
        belief.subject_id,
        belief.belief_type,
        normalizedContent
      ]
    );

    let memoryId: number;
    if (existingRows[0]) {
      memoryId = Number(existingRows[0].id);
      await this.database.executeUpdate(
        `
          UPDATE agent_memories
          SET
            memory_scope = ?,
            field_scope = ?,
            user_id = ?,
            group_id = ?,
            title = ?,
            content = ?,
            confidence = GREATEST(confidence, ?),
            salience = GREATEST(salience, ?),
            source_kind = ?,
            promoted_from_belief_id = ?,
            last_observed_at = ?,
            updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ?
        `,
        [
          memoryScope,
          fieldScope,
          userId,
          groupId,
          belief.belief_type,
          belief.claim,
          belief.confidence,
          derivedSalience,
          promotion,
          belief.id,
          belief.last_observed_at,
          memoryId
        ]
      );
    } else {
      memoryId = await this.database.executeInsertAndReturnId(
        `
          INSERT INTO agent_memories (
            memory_scope,
            memory_type,
            subject_type,
            subject_id,
            field_scope,
            user_id,
            group_id,
            target_user_id,
            conversation_id,
            title,
            content,
            normalized_content,
            confidence,
            salience,
            status,
            source_kind,
            promoted_from_belief_id,
            last_observed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
        `,
        [
          memoryScope,
          belief.belief_type,
          belief.subject_type,
          belief.subject_id,
          fieldScope,
          userId,
          groupId,
          null,
          null,
          belief.belief_type,
          belief.claim,
          normalizedContent,
          belief.confidence,
          derivedSalience,
          promotion,
          belief.id,
          belief.last_observed_at
        ]
      );
    }

    const evidenceText = evidenceObservation?.content || belief.claim;
    const evidenceId = await this.database.executeInsertAndReturnId(
      `
        INSERT INTO agent_memory_evidence (
          memory_id,
          observation_id,
          belief_id,
          evidence_kind,
          quote
        ) VALUES (?, ?, ?, ?, ?)
      `,
      [
        memoryId,
        evidenceObservation?.id ?? null,
        belief.id,
        evidenceObservation ? 'observation' : 'belief',
        evidenceText
      ]
    );

    await this.upsertEmbeddings({
      memoryId,
      memoryScope,
      memoryContent: belief.claim,
      evidenceId,
      evidenceContent: evidenceText,
      evidenceObservation
    });

    return this.getMemoryById(memoryId);
  }

  private async upsertEmbeddings(params: {
    memoryId: number;
    memoryScope: AgentMemoryScope;
    memoryContent: string;
    evidenceId: number;
    evidenceContent: string;
    evidenceObservation: AgentObservationRecord | null;
  }): Promise<void> {
    if (!this.embeddingStore) {
      return;
    }

    try {
      const scopeType = this.mapMemoryScopeToEmbeddingScope(
        params.memoryScope,
        params.evidenceObservation
      );
      const scopeKey = this.buildEmbeddingScopeKey(scopeType, params.evidenceObservation);

      await this.embeddingStore.upsertMemoryEmbedding({
        entity_id: params.memoryId,
        scope_type: scopeType,
        scope_key: scopeKey,
        source_text: params.memoryContent,
        metadata_json: {
          memory_id: params.memoryId,
          memory_scope: params.memoryScope
        }
      });

      await this.embeddingStore.upsertEvidenceEmbedding({
        entity_id: params.evidenceId,
        scope_type: scopeType,
        scope_key: scopeKey,
        source_text: params.evidenceContent,
        metadata_json: {
          evidence_id: params.evidenceId,
          memory_id: params.memoryId
        }
      });
    } catch (error) {
      this.moduleLogger.warn('Failed to upsert cognition embeddings for memory/evidence', {
        memoryId: params.memoryId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async fetchStructuredMemoryCandidates(
    message: QQMessage,
    limit: number
  ): Promise<AgentMemoryRecord[]> {
    const { whereSql, params } = this.buildMemoryScopeQuery(message);
    const rows = await this.database.executeQuery<any>(
      `
        SELECT *
        FROM agent_memories
        WHERE ${whereSql}
        ORDER BY salience DESC, confidence DESC, last_observed_at DESC, id DESC
        LIMIT ${Math.max(1, Math.floor(limit))}
      `,
      params
    );

    return rows.map(row => this.mapAgentMemoryRow(row));
  }

  private async fetchMemoriesByIds(memoryIds: number[]): Promise<AgentMemoryRecord[]> {
    if (memoryIds.length === 0) {
      return [];
    }

    const rows = await this.database.executeQuery<any>(
      `
        SELECT *
        FROM agent_memories
        WHERE status = 'active'
          AND id IN (${memoryIds.map(() => '?').join(',')})
      `,
      memoryIds
    );

    return rows.map(row => this.mapAgentMemoryRow(row));
  }

  private async fetchEvidenceRowsByMemoryIds(
    memoryIds: number[],
    limit: number
  ): Promise<Array<{ evidenceId: number; memoryId: number; observation: AgentObservationRecord }>> {
    if (memoryIds.length === 0) {
      return [];
    }

    const rows = await this.database.executeQuery<any>(
      `
        SELECT
          e.id AS evidence_id,
          e.memory_id,
          o.*
        FROM agent_memory_evidence e
        INNER JOIN agent_observations o ON o.id = e.observation_id
        WHERE e.memory_id IN (${memoryIds.map(() => '?').join(',')})
        ORDER BY o.occurred_at DESC, o.id DESC
        LIMIT ${Math.max(1, Math.floor(limit))}
      `,
      memoryIds
    );

    return rows.map(row => ({
      evidenceId: Number(row.evidence_id),
      memoryId: Number(row.memory_id),
      observation: this.mapAgentObservationRow(row)
    }));
  }

  private async fetchEvidenceRowsByEvidenceIds(
    evidenceIds: number[]
  ): Promise<Array<{ evidenceId: number; memoryId: number; observation: AgentObservationRecord }>> {
    if (evidenceIds.length === 0) {
      return [];
    }

    const rows = await this.database.executeQuery<any>(
      `
        SELECT
          e.id AS evidence_id,
          e.memory_id,
          o.*
        FROM agent_memory_evidence e
        INNER JOIN agent_observations o ON o.id = e.observation_id
        WHERE e.id IN (${evidenceIds.map(() => '?').join(',')})
      `,
      evidenceIds
    );

    return rows.map(row => ({
      evidenceId: Number(row.evidence_id),
      memoryId: Number(row.memory_id),
      observation: this.mapAgentObservationRow(row)
    }));
  }

  private async fetchRecentScopedObservations(
    message: QQMessage,
    limit: number
  ): Promise<AgentObservationRecord[]> {
    const { whereSql, params } = this.buildObservationScopeQuery(message);
    const rows = await this.database.executeQuery<any>(
      `
        SELECT *
        FROM agent_observations
        ${whereSql}
        ORDER BY occurred_at DESC, id DESC
        LIMIT ${Math.max(1, Math.floor(limit))}
      `,
      params
    );

    return rows.map(row => this.mapAgentObservationRow(row));
  }

  private buildHybridMemoryCandidate(
    memory: AgentMemoryRecord,
    options: {
      queryText: string;
      semanticScore: number;
      relationshipContext?: AgentRelationshipMemoryRecord;
      now: Date;
    }
  ): HybridMemoryCandidate {
    const structuredScore = this.calculateMemoryStructuredScore(memory);
    const lexicalScore = this.calculateLexicalMatchScore(
      options.queryText,
      `${memory.title}\n${memory.content}`
    );
    const temporalScore = this.calculateTemporalDecayScore(
      memory.last_observed_at,
      options.now,
      DEFAULT_MEMORY_HALF_LIFE_DAYS
    );
    const importanceScore = this.clampScore(memory.salience);
    const retrievalBias = this.calculateRelationshipMemoryRetrievalBias(
      `${memory.title}\n${memory.content}`,
      memory.user_id ?? this.parseNumericId(memory.subject_id),
      options.relationshipContext
    );
    const finalScore = this.clampScore(
      options.semanticScore * 0.45 +
      structuredScore * 0.3 +
      lexicalScore * 0.1 +
      temporalScore * 0.1 +
      importanceScore * 0.05 +
      retrievalBias
    );

    return {
      memory,
      semanticScore: this.clampScore(options.semanticScore),
      structuredScore,
      lexicalScore,
      temporalScore,
      importanceScore,
      finalScore
    };
  }

  private rerankMemoryCandidates(
    candidates: HybridMemoryCandidate[],
    limit: number
  ): HybridMemoryCandidate[] {
    return [...candidates]
      .sort((left, right) => {
        if (right.finalScore !== left.finalScore) {
          return right.finalScore - left.finalScore;
        }

        if (right.semanticScore !== left.semanticScore) {
          return right.semanticScore - left.semanticScore;
        }

        if (right.lexicalScore !== left.lexicalScore) {
          return right.lexicalScore - left.lexicalScore;
        }

        if (right.temporalScore !== left.temporalScore) {
          return right.temporalScore - left.temporalScore;
        }

        return right.memory.id - left.memory.id;
      })
      .slice(0, limit);
  }

  private buildHybridEvidenceCandidate(
    observation: AgentObservationRecord,
    options: {
      semanticScore: number;
      queryText: string;
      relationScore: number;
      relationshipContext?: AgentRelationshipMemoryRecord;
      now: Date;
    }
  ): HybridEvidenceCandidate {
    const temporalScore = this.calculateTemporalDecayScore(
      observation.occurred_at,
      options.now,
      DEFAULT_EVIDENCE_HALF_LIFE_DAYS
    );
    const lexicalScore = this.calculateLexicalMatchScore(
      options.queryText,
      observation.content
    );
    const importanceScore = this.calculateObservationImportanceScore(observation);
    const retrievalBias = this.calculateRelationshipMemoryRetrievalBias(
      observation.content,
      observation.user_id ?? observation.subject_user_id ?? null,
      options.relationshipContext
    );
    const finalScore = this.clampScore(
      options.semanticScore * 0.35 +
      lexicalScore * 0.2 +
      this.clampScore(options.relationScore) * 0.15 +
      temporalScore * 0.15 +
      importanceScore * 0.15 +
      retrievalBias
    );

    return {
      observation,
      semanticScore: this.clampScore(options.semanticScore),
      lexicalScore,
      relationScore: this.clampScore(options.relationScore),
      temporalScore,
      importanceScore,
      finalScore
    };
  }

  private rerankEvidenceCandidates(
    candidates: HybridEvidenceCandidate[],
    limit: number
  ): HybridEvidenceCandidate[] {
    return [...candidates]
      .sort((left, right) => {
        if (right.finalScore !== left.finalScore) {
          return right.finalScore - left.finalScore;
        }

        if (right.semanticScore !== left.semanticScore) {
          return right.semanticScore - left.semanticScore;
        }

        if (right.lexicalScore !== left.lexicalScore) {
          return right.lexicalScore - left.lexicalScore;
        }

        return right.observation.id - left.observation.id;
      })
      .slice(0, limit);
  }

  private buildMemoryScopeQuery(
    message: QQMessage
  ): { whereSql: string; params: Array<string | number> } {
    const clauses: string[] = [`status = 'active'`];
    const params: Array<string | number> = [];

    if (message.message_type === 'private') {
      clauses.push(`(
        (memory_scope = 'self_global' AND subject_type = 'self')
        OR (memory_scope = 'person_global' AND subject_type = 'user' AND subject_id = ?)
        OR (memory_scope = 'local_field' AND field_scope = 'private_chat' AND user_id = ?)
      )`);
      params.push(String(message.user_id), message.user_id);
    } else if (message.message_type === 'group' && message.group_id) {
      clauses.push(`(
        (memory_scope = 'self_global' AND subject_type = 'self')
        OR (memory_scope = 'local_field' AND field_scope = 'group_chat' AND group_id = ?)
        OR (memory_scope = 'person_global' AND subject_type = 'user' AND subject_id = ?)
      )`);
      params.push(message.group_id, String(message.user_id));
    } else {
      clauses.push(`memory_scope = 'self_global' AND subject_type = 'self'`);
    }

    return {
      whereSql: clauses.join(' AND '),
      params
    };
  }

  private buildObservationScopeQuery(
    message: QQMessage
  ): { whereSql: string; params: Array<string | number>; fieldScope: 'private_chat' | 'group_chat' } {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (message.message_type === 'group' && message.group_id) {
      clauses.push(`WHERE field_scope = 'group_chat'`, `group_id = ?`);
      params.push(message.group_id);
      return {
        whereSql: clauses.join(' AND '),
        params,
        fieldScope: 'group_chat'
      };
    }

    clauses.push(`WHERE field_scope = 'private_chat'`, `user_id = ?`);
    params.push(message.user_id);
    return {
      whereSql: clauses.join(' AND '),
      params,
      fieldScope: 'private_chat'
    };
  }

  private calculateMemoryStructuredScore(memory: AgentMemoryRecord): number {
    return this.clampScore(
      memory.salience * 0.55 +
      memory.confidence * 0.35 +
      (memory.memory_scope === 'self_global' ? 0.1 : 0.05)
    );
  }

  private applyBm25ScoresToMemoryCandidates(
    candidates: HybridMemoryCandidate[],
    queryText: string
  ): HybridMemoryCandidate[] {
    return this.applyBm25Scores(
      candidates,
      queryText,
      candidate => `${candidate.memory.title}\n${candidate.memory.content}`,
      (candidate, lexicalScore) => ({
        ...candidate,
        lexicalScore,
        finalScore: this.clampScore(
          candidate.semanticScore * 0.45 +
          candidate.structuredScore * 0.3 +
          lexicalScore * 0.1 +
          candidate.temporalScore * 0.1 +
          candidate.importanceScore * 0.05 +
          (candidate.finalScore - this.clampScore(
            candidate.semanticScore * 0.45 +
            candidate.structuredScore * 0.3 +
            candidate.lexicalScore * 0.1 +
            candidate.temporalScore * 0.1 +
            candidate.importanceScore * 0.05
          ))
        )
      })
    );
  }

  private applyBm25ScoresToEvidenceCandidates(
    candidates: HybridEvidenceCandidate[],
    queryText: string
  ): HybridEvidenceCandidate[] {
    return this.applyBm25Scores(
      candidates,
      queryText,
      candidate => candidate.observation.content,
      (candidate, lexicalScore) => ({
        ...candidate,
        lexicalScore,
        finalScore: this.clampScore(
          candidate.semanticScore * 0.35 +
          lexicalScore * 0.2 +
          candidate.relationScore * 0.15 +
          candidate.temporalScore * 0.15 +
          candidate.importanceScore * 0.15 +
          (candidate.finalScore - this.clampScore(
            candidate.semanticScore * 0.35 +
            candidate.lexicalScore * 0.2 +
            candidate.relationScore * 0.15 +
            candidate.temporalScore * 0.15 +
            candidate.importanceScore * 0.15
          ))
        )
      })
    );
  }

  private applyBm25Scores<T>(
    candidates: T[],
    queryText: string,
    getText: (candidate: T) => string,
    mapCandidate: (candidate: T, lexicalScore: number) => T
  ): T[] {
    if (!queryText || candidates.length === 0) {
      return candidates;
    }

    const tokenizedDocs = candidates.map(candidate => this.tokenizeForBm25(getText(candidate)));
    const averageDocLength = tokenizedDocs.reduce((sum, tokens) => sum + tokens.length, 0) / tokenizedDocs.length;
    const docFrequency = new Map<string, number>();

    tokenizedDocs.forEach(tokens => {
      Array.from(new Set(tokens)).forEach(token => {
        docFrequency.set(token, (docFrequency.get(token) ?? 0) + 1);
      });
    });

    const queryTokens = this.tokenizeForBm25(queryText);
    return candidates.map((candidate, index) => mapCandidate(
      candidate,
      this.calculateBm25Score(
        queryTokens,
        tokenizedDocs[index],
        averageDocLength,
        tokenizedDocs.length,
        docFrequency
      )
    ));
  }

  private calculateTemporalDecayScore(
    value: Date | null | undefined,
    now: Date,
    halfLifeDays: number
  ): number {
    if (!value) {
      return 0;
    }

    const ageMs = Math.max(0, now.getTime() - value.getTime());
    const halfLifeMs = Math.max(1, halfLifeDays) * 24 * 60 * 60 * 1000;
    return this.clampScore(Math.pow(0.5, ageMs / halfLifeMs));
  }

  private calculateLexicalMatchScore(queryText: string, candidateText: string): number {
    const normalizedQuery = this.normalizeText(queryText).toLowerCase();
    const normalizedCandidate = this.normalizeText(candidateText).toLowerCase();

    if (!normalizedQuery || !normalizedCandidate) {
      return 0;
    }

    if (normalizedCandidate.includes(normalizedQuery)) {
      return 1;
    }

    const tokens = Array.from(
      new Set(
        normalizedQuery
          .split(/[\s,.;:!?，。！？、]+/g)
          .map(token => token.trim())
          .filter(token => token.length >= 2)
      )
    );

    if (tokens.length === 0) {
      return 0;
    }

    const matched = tokens.filter(token => normalizedCandidate.includes(token)).length;
    return this.clampScore(matched / tokens.length);
  }

  private tokenizeForBm25(value: string): string[] {
    const normalized = this.normalizeText(value).toLowerCase();
    if (!normalized) {
      return [];
    }

    return normalized
      .split(/[\s,.;:!?，。！？、】【（）()、/\\|"'`~\-_=+]+/g)
      .map(token => token.trim())
      .filter(token => token.length >= 2);
  }

  private calculateBm25Score(
    queryTokens: string[],
    documentTokens: string[],
    averageDocLength: number,
    documentCount: number,
    docFrequency: Map<string, number>
  ): number {
    if (queryTokens.length === 0 || documentTokens.length === 0) {
      return 0;
    }

    const termCounts = new Map<string, number>();
    documentTokens.forEach(token => {
      termCounts.set(token, (termCounts.get(token) ?? 0) + 1);
    });

    const normalizedQueryTokens = Array.from(new Set(queryTokens));
    let score = 0;

    normalizedQueryTokens.forEach(token => {
      const termFrequency = termCounts.get(token) ?? 0;
      if (termFrequency === 0) {
        return;
      }

      const frequency = docFrequency.get(token) ?? 0;
      const inverseDocumentFrequency = Math.log(1 + ((documentCount - frequency + 0.5) / (frequency + 0.5)));
      const denominator =
        termFrequency +
        DEFAULT_BM25_K1 * (1 - DEFAULT_BM25_B + DEFAULT_BM25_B * (documentTokens.length / Math.max(1, averageDocLength)));
      score += inverseDocumentFrequency * ((termFrequency * (DEFAULT_BM25_K1 + 1)) / Math.max(1e-6, denominator));
    });

    return this.clampScore(score / Math.max(1, normalizedQueryTokens.length * 2));
  }

  private calculateObservationImportanceScore(observation: AgentObservationRecord): number {
    const rawImportance =
      Number(observation.raw_payload?.insight_annotation?.importance_score)
      || Number(observation.raw_payload?.importance_score)
      || 0;
    if (Number.isFinite(rawImportance) && rawImportance > 0) {
      return this.clampScore(rawImportance);
    }

    if (observation.source_type === 'reply_anchor' || observation.source_type === 'tool_result') {
      return 0.75;
    }

    if (this.hasExplicitRejectionSignal(observation.content)) {
      return 0.9;
    }

    return observation.message_type === 'private' ? 0.55 : 0.4;
  }

  private calculateRelationshipMemoryRetrievalBias(
    content: string,
    targetUserId: number | null,
    relationshipContext?: AgentRelationshipMemoryRecord
  ): number {
    if (!relationshipContext || !targetUserId || relationshipContext.target_user_id !== targetUserId) {
      return 0;
    }

    const memoryBias = relationshipContext.memory_bias;
    if (!memoryBias) {
      return 0;
    }

    const normalizedContent = this.normalizeText(content).toLowerCase();
    const boostTopics = Array.isArray(memoryBias.retrieve_boost_topics)
      ? memoryBias.retrieve_boost_topics
      : [];
    const sensitiveTopics = Array.isArray(memoryBias.sensitive_topics)
      ? memoryBias.sensitive_topics
      : [];

    const boost = boostTopics
      .filter(topic => topic && normalizedContent.includes(this.normalizeText(topic).toLowerCase()))
      .length;
    const sensitivityPenalty = sensitiveTopics
      .filter(topic => topic && normalizedContent.includes(this.normalizeText(topic).toLowerCase()))
      .length;

    return this.clampScore(boost * 0.08) - Math.min(0.12, sensitivityPenalty * 0.04);
  }

  private clampScore(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.min(1, value));
  }

  private truncateForFlush(value: string, maxLength: number = 80): string {
    const compact = this.normalizeText(value);
    return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
  }

  private async getBeliefById(id: number): Promise<AgentBeliefRecord | null> {
    const rows = await this.database.executeQuery<any>(
      `SELECT * FROM agent_beliefs WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] ? this.mapAgentBeliefRow(rows[0]) : null;
  }

  private async getMemoryById(id: number): Promise<AgentMemoryRecord | null> {
    const rows = await this.database.executeQuery<any>(
      `SELECT * FROM agent_memories WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] ? this.mapAgentMemoryRow(rows[0]) : null;
  }

  private async getObservationById(id: number): Promise<AgentObservationRecord | null> {
    const rows = await this.database.executeQuery<any>(
      `SELECT * FROM agent_observations WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] ? this.mapAgentObservationRow(rows[0]) : null;
  }

  private resolvePromotionReason(
    belief: AgentBeliefRecord,
    preferred?: AgentMemorySourceKind
  ): AgentMemorySourceKind | null {
    if (preferred === 'daily_reflection' || preferred === 'weekly_reflection') {
      if (belief.belief_type === 'preference' && belief.observation_count < 2) {
        return null;
      }
      return preferred;
    }

    if (belief.belief_type === 'identity_fact') {
      return preferred || 'explicit_fact';
    }

    if (belief.belief_type === 'commitment') {
      return preferred || 'explicit_commitment';
    }

    if (belief.belief_type === 'relationship') {
      return preferred || 'daily_reflection';
    }

    if (belief.belief_type === 'preference' && belief.observation_count >= 2) {
      return preferred || 'repeated_signal';
    }

    return null;
  }

  private resolveMemoryScope(
    belief: AgentBeliefRecord,
    evidenceObservation: AgentObservationRecord | null,
    relationshipContext?: AgentRelationshipMemoryRecord
  ): AgentMemoryScope {
    if (belief.subject_type === 'self') {
      return 'self_global';
    }

    if (evidenceObservation?.field_scope === 'group_chat') {
      const insightModifier = relationshipContext?.memory_bias?.promote_threshold_modifier ?? 0;
      const impression = relationshipContext?.impression_profile;
      const familiarity = impression?.familiarity ?? 0;
      const trust = impression?.trust ?? 0;
      const engagement = impression?.engagement ?? 0;
      if (insightModifier >= 0.1 || familiarity >= 0.7 || trust >= 0.7 || engagement >= 0.7) {
        return 'person_global';
      }
      return 'local_field';
    }

    return 'person_global';
  }

  private deriveSalience(
    belief: AgentBeliefRecord,
    relationshipContext?: AgentRelationshipMemoryRecord
  ): number {
    const baseScore = belief.confidence + Math.min(0.2, belief.observation_count * 0.05);
    const insightModifier = relationshipContext?.memory_bias?.promote_threshold_modifier ?? 0;
    const engagement = relationshipContext?.impression_profile?.engagement ?? 0;
    return Math.min(1, Math.max(0.6, baseScore + insightModifier * 0.15 + engagement * 0.05));
  }

  private mapMemoryScopeToEmbeddingScope(
    scope: AgentMemoryScope,
    observation: AgentObservationRecord | null
  ): CognitionEmbeddingScopeType {
    if (scope === 'self_global') {
      return 'self_global';
    }

    if (scope === 'local_field') {
      return observation?.field_scope === 'group_chat' ? 'group_context' : 'private_user';
    }

    return 'user_global';
  }

  private buildEmbeddingScopeKey(
    scopeType: CognitionEmbeddingScopeType,
    observation: AgentObservationRecord | null
  ): string {
    if (scopeType === 'group_context') {
      return `group:${observation?.group_id ?? 0}`;
    }

    if (scopeType === 'self_global') {
      return 'self:xiaoni';
    }

    if (scopeType === 'local_field') {
      return `field:${observation?.field_scope || 'unknown'}:${observation?.group_id ?? observation?.user_id ?? 0}`;
    }

    return `user:${observation?.subject_user_id ?? observation?.user_id ?? 0}`;
  }

  private getEmbeddingScopeTypesForMessage(message: QQMessage): CognitionEmbeddingScopeType[] {
    if (message.message_type === 'group' && message.group_id) {
      return ['self_global', 'group_context', 'user_global'];
    }

    return ['self_global', 'private_user', 'user_global'];
  }

  private getEmbeddingScopeKeysForMessage(message: QQMessage): string[] {
    const keys = ['self:xiaoni', `user:${message.user_id}`];
    if (message.message_type === 'group' && message.group_id) {
      keys.push(`group:${message.group_id}`);
    }
    return keys;
  }

  private extractMessageQueryText(message: QQMessage): string {
    const normalized = typeof message.normalized_text === 'string'
      ? message.normalized_text.trim()
      : '';

    if (normalized.length > 0) {
      return normalized;
    }

    if (typeof message.raw_message === 'string') {
      return message.raw_message.trim();
    }

    return '';
  }

  private getIsoWeekKey(date: Date): string {
    const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNr = (target.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNr + 3);
    const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
    const weekNo = 1 + Math.round((target.getTime() - firstThursday.getTime()) / 604800000);
    return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  private normalizeText(value: string): string {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 255);
  }

  private parseJsonField(value: unknown): any {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (_error) {
        return undefined;
      }
    }

    return value;
  }

  private parseDate(value: unknown): Date {
    return value instanceof Date ? value : new Date(String(value));
  }

  private mapAgentBeliefRow(row: any): AgentBeliefRecord {
    return {
      id: Number(row.id),
      subject_type: row.subject_type,
      subject_id: row.subject_id,
      belief_type: row.belief_type,
      belief_key: row.belief_key,
      claim: row.claim,
      normalized_claim: row.normalized_claim,
      polarity: row.polarity,
      confidence: Number(row.confidence),
      status: row.status,
      observation_count: Number(row.observation_count || 0),
      last_evidence_id: row.last_evidence_id ?? null,
      first_observed_at: this.parseDate(row.first_observed_at),
      last_observed_at: this.parseDate(row.last_observed_at),
      created_at: this.parseDate(row.created_at),
      updated_at: this.parseDate(row.updated_at)
    };
  }

  private mapAgentMemoryRow(row: any): AgentMemoryRecord {
    return {
      id: Number(row.id),
      memory_scope: row.memory_scope,
      memory_type: row.memory_type as AgentMemoryType,
      subject_type: row.subject_type,
      subject_id: row.subject_id,
      field_scope: row.field_scope ?? null,
      user_id: row.user_id ?? null,
      group_id: row.group_id ?? null,
      target_user_id: row.target_user_id ?? null,
      conversation_id: row.conversation_id ?? null,
      title: row.title,
      content: row.content,
      normalized_content: row.normalized_content,
      confidence: Number(row.confidence),
      salience: Number(row.salience),
      status: row.status,
      source_kind: row.source_kind,
      promoted_from_belief_id: row.promoted_from_belief_id ?? null,
      last_recalled_at: row.last_recalled_at ? this.parseDate(row.last_recalled_at) : null,
      last_observed_at: this.parseDate(row.last_observed_at),
      created_at: this.parseDate(row.created_at),
      updated_at: this.parseDate(row.updated_at)
    };
  }

  private mapAgentObservationRow(row: any): AgentObservationRecord {
    return {
      id: Number(row.id),
      trace_id: row.trace_id ?? null,
      conversation_id: row.conversation_id ?? null,
      source_type: row.source_type,
      field_scope: row.field_scope,
      message_type: row.message_type ?? null,
      user_id: row.user_id ?? null,
      group_id: row.group_id ?? null,
      subject_user_id: row.subject_user_id ?? null,
      counterparty_ids: this.parseJsonField(row.counterparty_ids) ?? undefined,
      content: row.content,
      tool_payload_ref: row.tool_payload_ref ?? null,
      raw_payload: this.parseJsonField(row.raw_payload),
      occurred_at: this.parseDate(row.occurred_at),
      created_at: this.parseDate(row.created_at)
    };
  }

  private mapAgentSelfModelRow(row: any): AgentSelfModelRecord {
    return {
      id: Number(row.id),
      identity_summary: row.identity_summary ?? null,
      core_traits: this.parseJsonField(row.core_traits) ?? [],
      long_term_goals: this.parseJsonField(row.long_term_goals) ?? [],
      current_concerns: this.parseJsonField(row.current_concerns) ?? [],
      availability: row.availability ?? null,
      energy: row.energy ?? null,
      source_reflection_id: row.source_reflection_id ?? null,
      is_current: Boolean(row.is_current),
      created_at: this.parseDate(row.created_at),
      updated_at: this.parseDate(row.updated_at)
    };
  }

  private mapAgentRelationshipMemoryRow(row: any): AgentRelationshipMemoryRecord {
    const notes = this.parseJsonField(row.notes_json);
    return {
      id: Number(row.id),
      target_user_id: Number(row.target_user_id),
      field_scope: row.field_scope ?? null,
      group_id: row.group_id ?? null,
      relationship_summary: row.relationship_summary,
      interaction_style: row.interaction_style ?? null,
      boundary_notes: row.boundary_notes ?? null,
      confidence: Number(row.confidence),
      status: row.status,
      source_reflection_id: row.source_reflection_id ?? null,
      last_evidence_id: row.last_evidence_id ?? null,
      last_observed_at: this.parseDate(row.last_observed_at ?? row.updated_at),
      is_current: Boolean(row.is_current),
      boundary_strategy: row.boundary_strategy ?? null,
      impression_profile: this.normalizeImpressionProfile(notes?.impression_profile),
      speech_policy: this.normalizeSpeechPolicy(notes?.speech_policy),
      memory_bias: this.normalizeMemoryBias(notes?.memory_bias),
      notes_json: notes,
      created_at: this.parseDate(row.created_at),
      updated_at: this.parseDate(row.updated_at)
    };
  }

  private mapAgentPlanRow(row: any): AgentPlanRecord {
    return {
      id: Number(row.id),
      plan_type: row.plan_type,
      target_field_scope: row.target_field_scope ?? null,
      target_user_id: row.target_user_id ?? null,
      target_group_id: row.target_group_id ?? null,
      goal: row.goal,
      trigger_condition: row.trigger_condition ?? null,
      status: row.status,
      scheduled_start_at: row.scheduled_start_at ? this.parseDate(row.scheduled_start_at) : null,
      scheduled_end_at: row.scheduled_end_at ? this.parseDate(row.scheduled_end_at) : null,
      source_reflection_id: row.source_reflection_id ?? null,
      source_plan_id: row.source_plan_id ?? null,
      plan_metadata_json: this.parseJsonField(row.plan_metadata_json),
      created_at: this.parseDate(row.created_at),
      updated_at: this.parseDate(row.updated_at)
    };
  }

  private mapAgentWalkCandidateRow(row: any): AgentWalkCandidateRecord {
    return {
      id: Number(row.id),
      field_key: row.field_key,
      field_scope: row.field_scope,
      target_user_id: row.target_user_id ?? null,
      target_group_id: row.target_group_id ?? null,
      priority_score: Number(row.priority_score || 0),
      selected_reason: row.selected_reason,
      suppressed_reason: row.suppressed_reason ?? null,
      can_speak_now: Boolean(row.can_speak_now),
      source_relationship_id: row.source_relationship_id ?? null,
      source_plan_ids_json: this.parseJsonField(row.source_plan_ids_json) ?? [],
      source_memory_ids_json: this.parseJsonField(row.source_memory_ids_json) ?? [],
      source_belief_ids_json: this.parseJsonField(row.source_belief_ids_json) ?? [],
      trigger_sources_json: this.parseJsonField(row.trigger_sources_json) ?? [],
      compiler_inputs_json: this.parseJsonField(row.compiler_inputs_json) ?? {},
      computed_at: this.parseDate(row.computed_at),
      created_at: this.parseDate(row.created_at)
    };
  }

  private mapAgentFeedbackEventRow(row: any): AgentFeedbackEventRecord {
    return {
      id: Number(row.id),
      field_key: row.field_key,
      target_user_id: this.parseNumericId(row.target_user_id),
      target_group_id: this.parseNumericId(row.target_group_id),
      source_action_log_id: Number(row.source_action_log_id),
      judgement: row.judgement,
      reason_code: row.reason_code,
      explanation_json: this.parseJsonField(row.explanation_json),
      llm_trace_id: row.llm_trace_id ?? null,
      occurred_at: this.parseDate(row.occurred_at),
      created_at: this.parseDate(row.created_at)
    };
  }
}

export default AgentMemoryService;

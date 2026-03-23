import { DatabaseManager } from './database';
import {
  AgentBeliefRecord,
  AgentMemoryRecord,
  AgentMemoryScope,
  AgentMemorySourceKind,
  AgentMemoryType,
  AgentObservationRecord,
  AgentPlanRecord,
  AgentReflectionKind,
  AgentSelfModelRecord,
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
const SILENT_FLUSH_MIN_PENDING_OBSERVATIONS = 12;
const SILENT_FLUSH_MAX_SOURCE_OBSERVATIONS = 6;
const SILENT_FLUSH_MIN_INTERVAL_MS = 30 * 60 * 1000;

interface HybridMemoryCandidate {
  memory: AgentMemoryRecord;
  semanticScore: number;
  structuredScore: number;
  lexicalScore: number;
  temporalScore: number;
  finalScore: number;
}

interface HybridEvidenceCandidate {
  observation: AgentObservationRecord;
  semanticScore: number;
  relationScore: number;
  temporalScore: number;
  finalScore: number;
}

export interface AgentProactivityRuntimeConfig {
  followupEnabled: boolean;
  isPaused: boolean;
  allowedUserIds: number[];
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

export class AgentMemoryService {
  private readonly moduleLogger = logger.createModuleLogger('agent-memory-service');
  private lastReflectionCheckAt = 0;

  constructor(
    private readonly database: DatabaseManager,
    private readonly embeddingStore?: CognitionEmbeddingStore
  ) {}

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
  }

  public async getRetrievedMemoriesForMessage(
    message: QQMessage,
    limit: number = 6
  ): Promise<AgentMemoryRecord[]> {
    const safeLimit = Math.max(1, Math.min(8, Math.floor(limit)));
    const queryText = this.extractMessageQueryText(message);
    const candidateLimit = Math.max(DEFAULT_HYBRID_CANDIDATE_LIMIT, safeLimit * 3);
    const structuredMemories = await this.fetchStructuredMemoryCandidates(message, candidateLimit);
    const candidateMap = new Map<number, HybridMemoryCandidate>();

    structuredMemories.forEach(memory => {
      candidateMap.set(memory.id, this.buildHybridMemoryCandidate(memory, {
        queryText,
        semanticScore: 0,
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
      Array.from(candidateMap.values()),
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
            relationScore: 1,
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
                relationScore,
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
          relationScore: 0.2,
          now
        })
      );
    });

    return this.rerankEvidenceCandidates(
      Array.from(candidateMap.values()),
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
          AND target_user_id IS NOT NULL
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
      if (!targetUserId) {
        result.skipped += 1;
        continue;
      }

      const message = this.renderFollowupMessage(plan);
      const policy = options.canSendToUser
        ? await options.canSendToUser(targetUserId, plan)
        : { allowed: true };

      if (!policy.allowed) {
        await this.rescheduleFollowupPlan(plan.id, new Date(now.getTime() + retryDelayMs));
        await this.insertActionLog({
          action_type: 'followup_private_message',
          trigger_kind: 'followup_queue',
          source_plan_id: plan.id,
          target_user_id: targetUserId,
          target_group_id: null,
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
        await options.sendPrivateMessage(targetUserId, message, plan);
        await this.completeFollowupPlan(plan.id, now);
        await this.insertActionLog({
          action_type: 'followup_private_message',
          trigger_kind: 'followup_queue',
          source_plan_id: plan.id,
          target_user_id: targetUserId,
          target_group_id: null,
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
          action_type: 'followup_private_message',
          trigger_kind: 'followup_queue',
          source_plan_id: plan.id,
          target_user_id: targetUserId,
          target_group_id: null,
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
          max_per_run,
          retry_delay_ms
        ) VALUES (1, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          followup_enabled = VALUES(followup_enabled),
          is_paused = VALUES(is_paused),
          allowed_user_ids = VALUES(allowed_user_ids),
          max_per_run = VALUES(max_per_run),
          retry_delay_ms = VALUES(retry_delay_ms),
          updated_at = CURRENT_TIMESTAMP(3)
      `,
      [
        nextConfig.followupEnabled ? 1 : 0,
        nextConfig.isPaused ? 1 : 0,
        JSON.stringify(nextConfig.allowedUserIds),
        nextConfig.maxPerRun,
        nextConfig.retryDelayMs
      ]
    );

    return this.getProactivityControls(defaults);
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
    await this.syncFollowupPlans(reflectionId, kind, now);
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
    const existingPlanRows = await this.database.executeQuery<any>(
      `
        SELECT id, target_user_id, target_group_id, goal
        FROM agent_plans
        WHERE plan_type = 'followup_queue'
          AND status IN ('queued', 'active')
      `
    );
    const existingPlanIdsToKeep = new Set<number>();
    const dedupeKeys = new Set<string>();

    for (const memory of commitmentMemories) {
      const targetUserId = memory.user_id ?? this.parseNumericId(memory.subject_id);
      if (!targetUserId) {
        continue;
      }

      const goal = this.buildFollowupGoal(memory);
      const dedupeKey = `${targetUserId}:${memory.group_id ?? 'private'}:${goal}`;
      if (dedupeKeys.has(dedupeKey)) {
        continue;
      }
      dedupeKeys.add(dedupeKey);

      const existingRows = await this.database.executeQuery<any>(
        `
          SELECT id
          FROM agent_plans
          WHERE plan_type = 'followup_queue'
            AND status IN ('queued', 'active')
            AND target_user_id <=> ?
            AND target_group_id <=> ?
            AND goal = ?
          ORDER BY id DESC
          LIMIT 1
        `,
        [targetUserId, memory.group_id ?? null, goal]
      );

      const targetFieldScope = memory.field_scope ?? 'private_chat';
      const triggerCondition = reflectionKind === 'weekly'
        ? '本周合适时机确认这项承诺的进展。'
        : '下一次合适的对话窗口确认这项承诺的进展。';

      if (existingRows[0]) {
        existingPlanIdsToKeep.add(Number(existingRows[0].id));
        await this.database.executeUpdate(
          `
            UPDATE agent_plans
            SET
              target_field_scope = ?,
              trigger_condition = ?,
              scheduled_start_at = COALESCE(scheduled_start_at, ?),
              source_reflection_id = ?,
              updated_at = CURRENT_TIMESTAMP(3)
            WHERE id = ?
          `,
          [
            targetFieldScope,
            triggerCondition,
            now,
            reflectionId,
            Number(existingRows[0].id)
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
            source_reflection_id
          ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, NULL, ?)
        `,
        [
          'followup_queue',
          targetFieldScope,
          targetUserId,
          memory.group_id ?? null,
          goal,
          triggerCondition,
          now,
          reflectionId
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

    await this.syncStrategicPlans(reflectionId, reflectionKind, now, commitmentMemories);
  }

  private buildFollowupGoal(memory: AgentMemoryRecord): string {
    return `跟进：${memory.content}`;
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
        now
      });
      return;
    }

    if (reflectionKind === 'weekly') {
      await this.upsertSelfGlobalPlan({
        planType: 'weekly_focus',
        goal: this.buildWeeklyFocusGoal(commitmentMemories),
        triggerCondition: '本周在主动跟进与回复决策中优先围绕这些重点展开。',
        reflectionId,
        now
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
            updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ?
        `,
        [
          options.goal,
          options.triggerCondition,
          options.now,
          options.reflectionId,
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
            source_reflection_id
          ) VALUES (?, NULL, NULL, NULL, ?, ?, 'queued', ?, NULL, ?)
        `,
        [
          options.planType,
          options.goal,
          options.triggerCondition,
          options.now,
          options.reflectionId
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
              WHERE action_type = 'followup_private_message'
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
    const normalizedGoal = this.normalizeText(plan.goal.replace(/^跟进[:：]\s*/, ''));
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
    const memoryScope = this.resolveMemoryScope(belief, evidenceObservation);
    const fieldScope = evidenceObservation?.field_scope ?? null;
    const userId = evidenceObservation?.user_id ?? null;
    const groupId = evidenceObservation?.group_id ?? null;
    const normalizedContent = this.normalizeText(belief.claim);

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
          this.deriveSalience(belief),
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
          this.deriveSalience(belief),
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
    const finalScore = this.clampScore(
      options.semanticScore * 0.45 +
      structuredScore * 0.3 +
      lexicalScore * 0.1 +
      temporalScore * 0.15
    );

    return {
      memory,
      semanticScore: this.clampScore(options.semanticScore),
      structuredScore,
      lexicalScore,
      temporalScore,
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
      relationScore: number;
      now: Date;
    }
  ): HybridEvidenceCandidate {
    const temporalScore = this.calculateTemporalDecayScore(
      observation.occurred_at,
      options.now,
      DEFAULT_EVIDENCE_HALF_LIFE_DAYS
    );
    const finalScore = this.clampScore(
      options.semanticScore * 0.5 +
      this.clampScore(options.relationScore) * 0.2 +
      temporalScore * 0.3
    );

    return {
      observation,
      semanticScore: this.clampScore(options.semanticScore),
      relationScore: this.clampScore(options.relationScore),
      temporalScore,
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

    if (belief.belief_type === 'preference' && belief.observation_count >= 2) {
      return preferred || 'repeated_signal';
    }

    return null;
  }

  private resolveMemoryScope(
    belief: AgentBeliefRecord,
    evidenceObservation: AgentObservationRecord | null
  ): AgentMemoryScope {
    if (belief.subject_type === 'self') {
      return 'self_global';
    }

    if (evidenceObservation?.field_scope === 'group_chat') {
      return 'local_field';
    }

    return 'person_global';
  }

  private deriveSalience(belief: AgentBeliefRecord): number {
    return Math.min(1, Math.max(0.6, belief.confidence + Math.min(0.2, belief.observation_count * 0.05)));
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
      created_at: this.parseDate(row.created_at),
      updated_at: this.parseDate(row.updated_at)
    };
  }
}

export default AgentMemoryService;

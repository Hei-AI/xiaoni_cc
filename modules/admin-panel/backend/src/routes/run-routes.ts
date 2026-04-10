import express from 'express';
import {
  deleteRelationshipMemoryOverride,
  getRelationshipMemoryCardById,
  listAgentInboundMessages,
  listAgentInboundMessagesByIds,
  listRelationshipLedgerEventsByIds,
  listRelationshipMemoryCards,
  listRelationshipMemoryJobs,
  listRelationshipMemoryOverrides,
  recordRelationshipMemoryOverride
} from '@qq-bot/persistence';
import winston from 'winston';
import { DatabaseManager } from '../services/database';
import { buildConversationTracePayload, buildConversationTraceSpanDetail } from '../services/trace-span-builder';

function decodeSessionKey(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toNumber(value: unknown): number {
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function parseJsonObject(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  if (typeof value !== 'string') {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, any>
      : {};
  } catch {
    return {};
  }
}

function extractCachedInputTokens(tokenUsage: Record<string, any>): number {
  return toNumber(
    tokenUsage.cached_input_tokens
    ?? tokenUsage.input_tokens_details?.cached_tokens
    ?? tokenUsage.prompt_tokens_details?.cached_tokens
    ?? tokenUsage.raw_usage?.input_tokens_details?.cached_tokens
    ?? tokenUsage.raw_usage?.prompt_tokens_details?.cached_tokens
  );
}

function buildInClause(count: number) {
  return Array.from({ length: count }, () => '?').join(', ');
}

function parseRelationshipScopeFromSessionKey(sessionKey: string) {
  const groupMatch = sessionKey.match(/(?:^|:)group:(\d+)$/);
  if (groupMatch) {
    return {
      chatType: 'group' as const,
      groupId: Number(groupMatch[1]),
      targetUserId: null,
      normalizedSessionKey: `group:${groupMatch[1]}`
    };
  }

  const privateMatch = sessionKey.match(/(?:^|:)private:(\d+)$/);
  if (privateMatch) {
    return {
      chatType: 'direct' as const,
      groupId: null,
      targetUserId: Number(privateMatch[1]),
      normalizedSessionKey: `private:${privateMatch[1]}`
    };
  }

  return {
    chatType: null,
    groupId: null,
    targetUserId: null,
    normalizedSessionKey: sessionKey
  };
}

function normalizeRelationshipCard(record: any, overrides: any[]) {
  return {
    id: Number(record.id || 0),
    card_type: record.card_type || null,
    group_id: record.group_id === null || typeof record.group_id === 'undefined' ? null : Number(record.group_id),
    target_user_id: record.target_user_id === null || typeof record.target_user_id === 'undefined' ? null : Number(record.target_user_id),
    version: Number(record.version || 0),
    summary_text: record.summary_text || '',
    actors: parseJsonArray(record.actors).map((item) => String(item)),
    context_before: record.context_before || null,
    trigger: record.trigger || null,
    interaction: record.interaction || null,
    outcome: record.outcome || null,
    source_event_ids: parseJsonArray(record.source_event_ids).map((item) => Number(item)).filter(Number.isFinite),
    source_message_ids: parseJsonArray(record.source_message_ids).map((item) => Number(item)).filter(Number.isFinite),
    importance_score: toNumber(record.importance_score),
    freshness_score: toNumber(record.freshness_score),
    decayed_score: toNumber(record.decayed_score),
    last_hit_at: record.last_hit_at || null,
    entered_runtime: Boolean(record.last_hit_at),
    metadata: parseJsonObject(record.metadata),
    created_at: record.created_at || null,
    updated_at: record.updated_at || null,
    overrides: overrides.map((override) => ({
      id: Number(override.id || 0),
      action_type: override.action_type || null,
      manual_note: override.manual_note || null,
      created_by: override.created_by || null,
      metadata: parseJsonObject(override.metadata),
      created_at: override.created_at || null
    }))
  };
}

function truncateEvidenceText(value: unknown, maxLength = 240): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeRelationshipEventEvidence(record: any) {
  return {
    id: Number(record.id || 0),
    event_type: record.event_type || null,
    session_key: record.session_key || null,
    target_user_id: record.target_user_id === null || typeof record.target_user_id === 'undefined' ? null : Number(record.target_user_id),
    source_message_ids: parseJsonArray(record.source_message_ids).map((item) => Number(item)).filter(Number.isFinite),
    source_excerpt: truncateEvidenceText(record.source_excerpt),
    event_weight: toNumber(record.event_weight),
    confidence: record.confidence || null,
    created_at: record.created_at || null,
    last_reinforced_at: record.last_reinforced_at || null,
    metadata: parseJsonObject(record.metadata)
  };
}

function normalizeRelationshipMessageEvidence(record: any) {
  return {
    id: Number(record.id || 0),
    session_key: record.session_key || null,
    role: record.role || 'user',
    phase: record.phase || 'inbound',
    source: record.source || null,
    trace_id: record.trace_id || null,
    run_id: record.run_id || null,
    group_index: Number(record.group_index || 0),
    item_index: Number(record.item_index || 0),
    message_sid: record.message_sid || null,
    sender_id: record.sender_id || null,
    sender_name: record.sender_name || null,
    content: truncateEvidenceText(record.content ?? record.body_for_agent, 320),
    created_at: record.created_at || record.received_at || null
  };
}

async function hydrateRelationshipCardEvidence(cards: any[]) {
  const eventIds = Array.from(new Set(cards.flatMap((card) => card.source_event_ids || [])));
  const messageIds = Array.from(new Set(cards.flatMap((card) => card.source_message_ids || [])));
  const [events, messages] = await Promise.all([
    listRelationshipLedgerEventsByIds(eventIds),
    listAgentInboundMessagesByIds(messageIds)
  ]);
  const eventMap = new Map(events.map((event) => [Number(event.id), normalizeRelationshipEventEvidence(event)]));
  const messageMap = new Map(messages.map((message) => [Number(message.id), normalizeRelationshipMessageEvidence(message)]));

  return cards.map((card) => ({
    ...card,
    evidence_events: (card.source_event_ids || [])
      .map((eventId: number) => eventMap.get(Number(eventId)))
      .filter(Boolean),
    evidence_messages: (card.source_message_ids || [])
      .map((messageId: number) => messageMap.get(Number(messageId)))
      .filter(Boolean)
  }));
}

function buildParticipationSummary(timeline: any[]) {
  const decisionEvents = timeline
    .filter((event: any) => event.event_type === 'participation' && event.event_name === 'decision' && event.event_phase === 'end')
    .map((event: any) => ({
      id: event.id,
      event_time: event.event_time,
      metadata: parseJsonObject(event.metadata)
    }));

  const latest = decisionEvents[decisionEvents.length - 1];
  const latestMetadata = latest?.metadata || {};
  const scores = parseJsonObject(latestMetadata.scores);

  return {
    attempts: decisionEvents.length,
    latest: latest ? {
      event_id: latest.id,
      event_time: latest.event_time,
      decision: latestMetadata.decision || null,
      reason: latestMetadata.reason || null,
      confidence: latestMetadata.confidence || null,
      conservative_fallback: Boolean(latestMetadata.conservative_fallback),
      used_embeddings: Boolean(latestMetadata.used_embeddings),
      used_llm_judge: Boolean(latestMetadata.used_llm_judge || latestMetadata.usedLlmJudge),
      llm_judge_model: latestMetadata.llmJudgeModel || null,
      llm_judge_decision: latestMetadata.llmJudgeDecision || null,
      llm_judge_confidence: latestMetadata.llmJudgeConfidence || null,
      llm_judge_reason: latestMetadata.llmJudgeReason || null,
      llm_judge_error: latestMetadata.llmJudgeError || null,
      continuity_similarity: latestMetadata.continuitySimilarity ?? null,
      interest_similarity: latestMetadata.interestSimilarity ?? null,
      scores: {
        addressedness: toNumber(scores.addressedness),
        continuity: toNumber(scores.continuity),
        social_position: toNumber(scores.socialPosition),
        interest: toNumber(scores.interest),
        timing: toNumber(scores.timing),
        value_add: toNumber(scores.valueAdd),
        final: toNumber(scores.final)
      },
      session_key: latestMetadata.sessionKey || null,
      recent_inbound_count: toNumber(latestMetadata.recentInboundCount),
      recent_reply_count: toNumber(latestMetadata.recentReplyCount),
      cooldown_remaining_ms: toNumber(latestMetadata.cooldownRemainingMs),
      path: latestMetadata.path || null,
      embedding_error: latestMetadata.embeddingError || null
    } : null
  };
}

function buildParticipationEvent(row: any) {
  const metadata = parseJsonObject(row.metadata);
  const scores = parseJsonObject(metadata.scores);

  return {
    event_id: Number(row.id || 0),
    trace_id: row.trace_id || null,
    event_time: row.event_time || null,
    decision: metadata.decision || null,
    reason: metadata.reason || null,
    confidence: metadata.confidence || null,
    conservative_fallback: Boolean(metadata.conservative_fallback),
    used_embeddings: Boolean(metadata.used_embeddings),
    used_llm_judge: Boolean(metadata.used_llm_judge || metadata.usedLlmJudge),
    llm_judge_model: metadata.llmJudgeModel || null,
    llm_judge_decision: metadata.llmJudgeDecision || null,
    llm_judge_confidence: metadata.llmJudgeConfidence || null,
    llm_judge_reason: metadata.llmJudgeReason || null,
    llm_judge_error: metadata.llmJudgeError || null,
    continuity_similarity: metadata.continuitySimilarity ?? null,
    interest_similarity: metadata.interestSimilarity ?? null,
    scores: {
      addressedness: toNumber(scores.addressedness),
      continuity: toNumber(scores.continuity),
      social_position: toNumber(scores.socialPosition),
      interest: toNumber(scores.interest),
      timing: toNumber(scores.timing),
      value_add: toNumber(scores.valueAdd),
      final: toNumber(scores.final)
    },
    recent_inbound_count: toNumber(metadata.recentInboundCount),
    recent_reply_count: toNumber(metadata.recentReplyCount),
    cooldown_remaining_ms: toNumber(metadata.cooldownRemainingMs),
    path: metadata.path || null,
    embedding_error: metadata.embeddingError || null,
    inbound: {
      sender_id: row.sender_id || null,
      sender_name: row.sender_name || null,
      body_for_agent: row.body_for_agent || null,
      raw_body: row.raw_body || null,
      was_mentioned: Boolean(row.was_mentioned)
    }
  };
}

export function createRunRoutes(database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();

  router.get('/runs/sessions', async (req, res) => {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10));
      const limit = Math.max(1, Math.min(100, Number.parseInt(String(req.query.limit || '30'), 10)));
      const offset = (page - 1) * limit;
      const params: Array<string | number> = [];
      const filters: string[] = [];

      if (search) {
        const pattern = `%${search}%`;
        filters.push(`(
          s.session_key ILIKE ?
          OR COALESCE(s.peer_name, '') ILIKE ?
          OR COALESCE(s.latest_message_preview, '') ILIKE ?
          OR COALESCE(s.last_finish_reason, '') ILIKE ?
        )`);
        params.push(pattern, pattern, pattern, pattern);
      }

      const whereClause = filters.length > 0 ? ` AND ${filters.join(' AND ')}` : '';
      const rows = await database.executeQuery(
        `
          WITH queued_trace_ids AS (
            SELECT DISTINCT trace_id
            FROM timeline_events
            WHERE event_type = 'queue'
              AND event_name = 'enqueue'
              AND event_phase = 'end'
          ),
          ranked_runs AS (
            SELECT
              r.id AS run_id,
              r.session_key,
              r.peer_name,
              r.chat_type,
              r.status,
              r.termination_reason,
              r.finish_reason,
              r.finish_outcome,
              r.no_reply,
              r.final_response,
              r.started_at,
              r.completed_at,
              r.created_at,
              b.input_message_count,
              b.summary,
              ROW_NUMBER() OVER (PARTITION BY r.session_key ORDER BY r.created_at DESC, r.id DESC) AS rn
            FROM agent_runs r
            INNER JOIN agent_message_batches b ON b.id = r.batch_id
          ),
          session_stats AS (
            SELECT
              session_key,
              COUNT(*) AS total_runs,
              COUNT(*) FILTER (WHERE status = 'failed') AS failed_runs,
              COUNT(*) FILTER (WHERE no_reply = TRUE) AS no_reply_runs
            FROM agent_runs
            GROUP BY session_key
          ),
          participation_only_sessions AS (
            SELECT
              COALESCE(t.metadata->>'sessionKey', t.metadata->>'session_key') AS session_key,
              COALESCE(inbound.peer_name, COALESCE(t.metadata->>'sessionKey', t.metadata->>'session_key')) AS peer_name,
              COALESCE(inbound.chat_type, 'group') AS chat_type,
              NULL::text AS latest_run_id,
              CONCAT('pre_run_', COALESCE(t.metadata->>'decision', 'unknown')) AS latest_status,
              NULL::text AS last_termination_reason,
              NULL::text AS last_finish_reason,
              NULL::text AS last_finish_outcome,
              TRUE AS last_no_reply,
              NULL::text AS last_final_response,
              t.event_time AS latest_started_at,
              t.event_time AS latest_completed_at,
              1 AS latest_input_message_count,
              COALESCE(inbound.raw_body, inbound.body_for_agent, '') AS latest_message_preview,
              0::bigint AS total_runs,
              0::bigint AS failed_runs,
              0::bigint AS no_reply_runs,
              t.event_time AS sort_created_at,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(t.metadata->>'sessionKey', t.metadata->>'session_key')
                ORDER BY t.event_time DESC, t.id DESC
              ) AS rn
            FROM timeline_events t
            LEFT JOIN agent_inbound_messages inbound ON inbound.trace_id = t.trace_id
            LEFT JOIN queued_trace_ids queued ON queued.trace_id = t.trace_id
            LEFT JOIN session_stats stats ON stats.session_key = COALESCE(t.metadata->>'sessionKey', t.metadata->>'session_key')
            WHERE t.event_type = 'participation'
              AND t.event_name = 'decision'
              AND t.event_phase = 'end'
              AND queued.trace_id IS NULL
              AND stats.session_key IS NULL
          ),
          all_sessions AS (
            SELECT
              s.session_key,
              s.peer_name,
              s.chat_type,
              s.run_id AS latest_run_id,
              s.status AS latest_status,
              s.termination_reason AS last_termination_reason,
              s.finish_reason AS last_finish_reason,
              s.finish_outcome AS last_finish_outcome,
              s.no_reply AS last_no_reply,
              s.final_response AS last_final_response,
              s.started_at AS latest_started_at,
              s.completed_at AS latest_completed_at,
              s.input_message_count AS latest_input_message_count,
              split_part(COALESCE(s.summary, ''), E'\n', 1) AS latest_message_preview,
              stats.total_runs,
              stats.failed_runs,
              stats.no_reply_runs,
              s.created_at AS sort_created_at
            FROM ranked_runs s
            INNER JOIN session_stats stats ON stats.session_key = s.session_key
            WHERE s.rn = 1

            UNION ALL

            SELECT
              p.session_key,
              p.peer_name,
              p.chat_type,
              p.latest_run_id,
              p.latest_status,
              p.last_termination_reason,
              p.last_finish_reason,
              p.last_finish_outcome,
              p.last_no_reply,
              p.last_final_response,
              p.latest_started_at,
              p.latest_completed_at,
              p.latest_input_message_count,
              p.latest_message_preview,
              p.total_runs,
              p.failed_runs,
              p.no_reply_runs,
              p.sort_created_at
            FROM participation_only_sessions p
            WHERE p.rn = 1
          )
          SELECT
            s.session_key,
            s.peer_name,
            s.chat_type,
            s.latest_run_id,
            s.latest_status,
            s.last_termination_reason,
            s.last_finish_reason,
            s.last_finish_outcome,
            s.last_no_reply,
            s.last_final_response,
            s.latest_started_at,
            s.latest_completed_at,
            s.latest_input_message_count,
            s.latest_message_preview,
            s.total_runs,
            s.failed_runs,
            s.no_reply_runs
          FROM all_sessions s
          WHERE 1 = 1
          ${whereClause}
          ORDER BY s.sort_created_at DESC
          LIMIT ? OFFSET ?
        `,
        [...params, limit, offset]
      );

      const totalRows = await database.executeQuery<{ total: number }>(
        `
          WITH queued_trace_ids AS (
            SELECT DISTINCT trace_id
            FROM timeline_events
            WHERE event_type = 'queue'
              AND event_name = 'enqueue'
              AND event_phase = 'end'
          ),
          ranked_runs AS (
            SELECT
              r.session_key,
              r.peer_name,
              split_part(COALESCE(b.summary, ''), E'\n', 1) AS latest_message_preview,
              r.finish_reason AS last_finish_reason,
              ROW_NUMBER() OVER (PARTITION BY r.session_key ORDER BY r.created_at DESC, r.id DESC) AS rn
            FROM agent_runs r
            INNER JOIN agent_message_batches b ON b.id = r.batch_id
          ),
          session_stats AS (
            SELECT session_key
            FROM agent_runs
            GROUP BY session_key
          ),
          participation_only_sessions AS (
            SELECT
              COALESCE(t.metadata->>'sessionKey', t.metadata->>'session_key') AS session_key,
              COALESCE(inbound.peer_name, COALESCE(t.metadata->>'sessionKey', t.metadata->>'session_key')) AS peer_name,
              COALESCE(inbound.raw_body, inbound.body_for_agent, '') AS latest_message_preview,
              NULL::text AS last_finish_reason,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(t.metadata->>'sessionKey', t.metadata->>'session_key')
                ORDER BY t.event_time DESC, t.id DESC
              ) AS rn
            FROM timeline_events t
            LEFT JOIN agent_inbound_messages inbound ON inbound.trace_id = t.trace_id
            LEFT JOIN queued_trace_ids queued ON queued.trace_id = t.trace_id
            LEFT JOIN session_stats stats ON stats.session_key = COALESCE(t.metadata->>'sessionKey', t.metadata->>'session_key')
            WHERE t.event_type = 'participation'
              AND t.event_name = 'decision'
              AND t.event_phase = 'end'
              AND queued.trace_id IS NULL
              AND stats.session_key IS NULL
          ),
          all_sessions AS (
            SELECT
              session_key,
              peer_name,
              latest_message_preview,
              last_finish_reason
            FROM ranked_runs
            WHERE rn = 1

            UNION ALL

            SELECT
              session_key,
              peer_name,
              latest_message_preview,
              last_finish_reason
            FROM participation_only_sessions
            WHERE rn = 1
          )
          SELECT COUNT(*) AS total
          FROM all_sessions s
          WHERE 1 = 1
          ${whereClause}
        `,
        params
      );

      res.json({
        success: true,
        data: rows,
        total: Number(totalRows[0]?.total || 0),
        page,
        limit,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to list run sessions', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to list run sessions',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/runs/sessions/:sessionKey', async (req, res) => {
    try {
      const sessionKey = decodeSessionKey(req.params.sessionKey);
      const rows = await database.executeQuery(
        `
          WITH llm_totals AS (
            SELECT
              trace_id,
              COUNT(*) AS llm_calls_count,
              COALESCE(SUM(COALESCE((token_usage->>'input_tokens')::INTEGER, input_tokens, 0)), 0) AS input_tokens_total,
              COALESCE(SUM(COALESCE((token_usage->>'output_tokens')::INTEGER, output_tokens, 0)), 0) AS output_tokens_total,
              COALESCE(
                SUM(
                  COALESCE(
                    (token_usage->>'cached_input_tokens')::INTEGER,
                    (token_usage->'input_tokens_details'->>'cached_tokens')::INTEGER,
                    (token_usage->'prompt_tokens_details'->>'cached_tokens')::INTEGER,
                    (token_usage->'raw_usage'->'input_tokens_details'->>'cached_tokens')::INTEGER,
                    (token_usage->'raw_usage'->'prompt_tokens_details'->>'cached_tokens')::INTEGER,
                    0
                  )
                ),
                0
              ) AS cached_input_tokens_total
            FROM llm_call_logs
            GROUP BY trace_id
          )
          SELECT
            r.id,
            r.batch_id,
            r.trace_id,
            r.conversation_id,
            r.session_key,
            r.chat_type,
            r.peer_id,
            r.peer_name,
            r.status,
            r.termination_reason,
            r.finish_reason,
            r.finish_outcome,
            r.no_reply,
            r.final_response,
            r.total_turns,
            r.error_message,
            r.started_at,
            r.completed_at,
            r.created_at,
            b.input_message_count,
            b.summary,
            COALESCE(t.llm_calls_count, 0) AS llm_calls_count,
            COALESCE(t.input_tokens_total, 0) AS input_tokens_total,
            COALESCE(t.output_tokens_total, 0) AS output_tokens_total,
            COALESCE(t.cached_input_tokens_total, 0) AS cached_input_tokens_total
          FROM agent_runs r
          INNER JOIN agent_message_batches b ON b.id = r.batch_id
          LEFT JOIN llm_totals t ON t.trace_id = r.trace_id
          WHERE r.session_key = ?
          ORDER BY r.created_at DESC, r.id DESC
        `,
        [sessionKey]
      );

      res.json({
        success: true,
        data: rows,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to list runs for session', { error, sessionKey: req.params.sessionKey });
      res.status(500).json({
        success: false,
        error: 'Failed to list runs for session',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/runs/sessions/:sessionKey/participation-events', async (req, res) => {
    try {
      const sessionKey = decodeSessionKey(req.params.sessionKey);
      const limit = Math.max(1, Math.min(20, Number.parseInt(String(req.query.limit || '10'), 10)));

      const rows = await database.executeQuery(
        `
          SELECT
            t.id,
            t.trace_id,
            t.event_time,
            t.metadata,
            inbound.sender_id,
            inbound.sender_name,
            inbound.body_for_agent,
            inbound.raw_body,
            inbound.was_mentioned
          FROM timeline_events t
          LEFT JOIN agent_inbound_messages inbound ON inbound.trace_id = t.trace_id
          WHERE t.event_type = 'participation'
            AND t.event_name = 'decision'
            AND t.event_phase = 'end'
            AND COALESCE(t.metadata->>'sessionKey', t.metadata->>'session_key') = ?
            AND NOT EXISTS (
              SELECT 1
              FROM timeline_events queued
              WHERE queued.trace_id = t.trace_id
                AND queued.event_type = 'queue'
                AND queued.event_name = 'enqueue'
                AND queued.event_phase = 'end'
            )
          ORDER BY t.event_time DESC, t.id DESC
          LIMIT ?
        `,
        [sessionKey, limit]
      );

      res.json({
        success: true,
        data: rows.map(buildParticipationEvent),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to list participation-only events for session', { error, sessionKey: req.params.sessionKey });
      res.status(500).json({
        success: false,
        error: 'Failed to list participation-only events for session',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/runs/sessions/:sessionKey/conversation-items', async (req, res) => {
    try {
      const sessionKey = decodeSessionKey(req.params.sessionKey || '');
      const limit = Math.max(1, Math.min(300, Number.parseInt(String(req.query.limit || '200'), 10)));

      if (!sessionKey) {
        return res.status(400).json({
          success: false,
          error: 'Missing session key',
          timestamp: new Date().toISOString()
        });
      }

      const rows = await listAgentInboundMessages({
        sessionKey,
        limit
      });

      return res.json({
        success: true,
        data: rows
          .slice()
          .reverse()
          .map((row, index) => normalizeRelationshipMessageEvidence({
            ...row,
            group_index: index + 1,
            item_index: 0
          })),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to list conversation items for session', { error, sessionKey: req.params.sessionKey });
      return res.status(500).json({
        success: false,
        error: 'Failed to list conversation items for session',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/runs/sessions/:sessionKey/relationship-memory', async (req, res) => {
    try {
      const sessionKey = decodeSessionKey(req.params.sessionKey || '');
      if (!sessionKey) {
        return res.status(400).json({
          success: false,
          error: 'Missing session key',
          timestamp: new Date().toISOString()
        });
      }

      const scope = parseRelationshipScopeFromSessionKey(sessionKey);
      const jobSessionKeys = Array.from(new Set([sessionKey, scope.normalizedSessionKey].filter(Boolean)));
      const jobLists = await Promise.all(jobSessionKeys.map((key) => listRelationshipMemoryJobs({
        sessionKey: key,
        limit: 20
      })));
      const jobs = jobLists
        .flat()
        .reduce<any[]>((items, job) => {
          if (items.some((existing) => Number(existing.id) === Number(job.id))) {
            return items;
          }
          items.push({
            id: Number(job.id || 0),
            session_key: job.session_key || null,
            group_id: job.group_id === null || typeof job.group_id === 'undefined' ? null : Number(job.group_id),
            status: job.status || null,
            trigger_reason: job.trigger_reason || null,
            turn_range_start: job.turn_range_start === null || typeof job.turn_range_start === 'undefined' ? null : Number(job.turn_range_start),
            turn_range_end: job.turn_range_end === null || typeof job.turn_range_end === 'undefined' ? null : Number(job.turn_range_end),
            ledger_event_count: toNumber(job.ledger_event_count),
            input_message_ids: parseJsonArray(job.input_message_ids).map((item) => Number(item)).filter(Number.isFinite),
            output_card_version: job.output_card_version === null || typeof job.output_card_version === 'undefined' ? null : Number(job.output_card_version),
            error_message: job.error_message || null,
            metadata: parseJsonObject(job.metadata),
            started_at: job.started_at || null,
            finished_at: job.finished_at || null,
            created_at: job.created_at || null,
            updated_at: job.updated_at || null
          });
          return items;
        }, [])
        .sort((left, right) => new Date(right.updated_at || 0).getTime() - new Date(left.updated_at || 0).getTime());

      if (!scope.chatType) {
        return res.json({
          success: true,
          data: {
            session_key: sessionKey,
            normalized_session_key: scope.normalizedSessionKey,
            chat_type: 'direct',
            jobs,
            group_cards: [],
            person_cards: []
          },
          timestamp: new Date().toISOString()
        });
      }

      const activeCards = await listRelationshipMemoryCards({
        groupId: scope.chatType === 'group' ? scope.groupId : null,
        targetUserId: scope.chatType === 'direct' ? scope.targetUserId : undefined,
        isActive: true,
        limit: 100
      });
      const normalizedCards = await Promise.all(activeCards.map(async (card) => normalizeRelationshipCard(
        card,
        await listRelationshipMemoryOverrides(Number(card.id || 0))
      )));
      const hydratedCards = await hydrateRelationshipCardEvidence(normalizedCards);

      const groupCards = hydratedCards
        .filter((card) => card.target_user_id === null)
        .sort((left, right) => right.decayed_score - left.decayed_score || right.id - left.id);
      const personCards = hydratedCards
        .filter((card) => card.target_user_id !== null)
        .sort((left, right) => right.decayed_score - left.decayed_score || right.id - left.id);

      return res.json({
        success: true,
        data: {
          session_key: sessionKey,
          normalized_session_key: scope.normalizedSessionKey,
          chat_type: scope.chatType,
          group_id: scope.groupId,
          jobs,
          group_cards: groupCards,
          person_cards: personCards
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch relationship memory', { error, sessionKey: req.params.sessionKey });
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch relationship memory',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.post('/runs/relationship-memory/cards/:cardId/overrides', async (req, res) => {
    try {
      const cardId = Number(req.params.cardId);
      const actionType = typeof req.body?.action_type === 'string' ? req.body.action_type.trim() : '';
      const manualNote = typeof req.body?.manual_note === 'string' ? req.body.manual_note.trim() : null;
      const createdBy = typeof req.body?.created_by === 'string' ? req.body.created_by.trim() : 'admin-panel';

      if (!Number.isFinite(cardId) || cardId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid card id',
          timestamp: new Date().toISOString()
        });
      }

      if (!['pin', 'downrank', 'archive'].includes(actionType)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid action_type',
          timestamp: new Date().toISOString()
        });
      }

      const existingCard = await getRelationshipMemoryCardById(cardId);
      if (!existingCard) {
        return res.status(404).json({
          success: false,
          error: 'Relationship memory card not found',
          timestamp: new Date().toISOString()
        });
      }

      const existingOverrides = await listRelationshipMemoryOverrides(cardId);
      const duplicateOverride = existingOverrides.find((override) => override.action_type === actionType);
      if (duplicateOverride) {
        return res.json({
          success: true,
          data: {
            id: Number(duplicateOverride.id || 0),
            card_id: cardId,
            action_type: actionType,
            manual_note: duplicateOverride.manual_note || null,
            created_by: duplicateOverride.created_by || null,
            deduped: true
          },
          timestamp: new Date().toISOString()
        });
      }

      const created = await recordRelationshipMemoryOverride({
        cardId,
        actionType,
        manualNote,
        createdBy,
        metadata: {
          source: 'admin-panel'
        }
      });

      return res.json({
        success: true,
        data: {
          id: Number(created.id || 0),
          card_id: cardId,
          action_type: actionType,
          manual_note: manualNote,
          created_by: createdBy,
          deduped: false
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to create relationship memory override', {
        error,
        cardId: req.params.cardId,
        body: req.body
      });
      return res.status(500).json({
        success: false,
        error: 'Failed to create relationship memory override',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.delete('/runs/relationship-memory/overrides/:overrideId', async (req, res) => {
    try {
      const overrideId = Number(req.params.overrideId);
      if (!Number.isFinite(overrideId) || overrideId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid override id',
          timestamp: new Date().toISOString()
        });
      }

      const deleted = await deleteRelationshipMemoryOverride(overrideId);

      return res.json({
        success: true,
        data: {
          id: Number(deleted.id || 0)
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to delete relationship memory override', {
        error,
        overrideId: req.params.overrideId
      });
      return res.status(500).json({
        success: false,
        error: 'Failed to delete relationship memory override',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/runs/:runId', async (req, res) => {
    try {
      const runId = req.params.runId;
      const runs = await database.executeQuery(
        `
          SELECT
            r.*,
            b.session_key,
            b.chat_type,
            b.peer_id,
            b.peer_name,
            b.account_id,
            b.reason_for_start,
            b.input_message_count,
            b.summary AS batch_summary
          FROM agent_runs r
          INNER JOIN agent_message_batches b ON b.id = r.batch_id
          WHERE r.id = ?
          LIMIT 1
        `,
        [runId]
      );

      const run = runs[0] as any;
      if (!run) {
        return res.status(404).json({
          success: false,
          error: 'Run not found',
          timestamp: new Date().toISOString()
        });
      }

      const inputMessages = await database.executeQuery(
        `
          SELECT
            bi.position,
            q.id AS queue_message_id,
            inbound.trace_id AS input_trace_id,
            q.message_sid,
            q.sender_id,
            q.sender_name,
            q.body_for_agent,
            q.raw_payload,
            q.inbound_context,
            q.created_at,
            q.processing_started_at,
            q.completed_at
          FROM agent_message_batch_items bi
          INNER JOIN agent_queue_messages q ON q.id = bi.queue_message_id
          LEFT JOIN agent_inbound_messages inbound ON inbound.message_sid = q.message_sid
          WHERE bi.batch_id = ?
          ORDER BY bi.position ASC
        `,
        [run.batch_id]
      );

      const llmCalls = await database.executeQuery(
        `
          SELECT
            id,
            agent_turn,
            model_name,
            model_provider,
            prompt_template,
            status,
            error_message,
            processing_time_ms,
            started_at,
            completed_at,
            input_tokens,
            output_tokens,
            token_usage,
            COALESCE((token_usage->>'cached_input_tokens')::INTEGER, 0) AS cached_input_tokens
          FROM llm_call_logs
          WHERE trace_id = ?
          ORDER BY COALESCE(started_at, completed_at, timestamp) ASC, id ASC
        `,
        [run.trace_id]
      );

      const toolCalls = await database.executeQuery(
        `
          SELECT id, agent_turn, tool_name, method_id, status, error_message, started_at, completed_at, result
          FROM tool_execution_logs
          WHERE trace_id = ?
          ORDER BY COALESCE(started_at, completed_at) ASC, id ASC
        `,
        [run.trace_id]
      );

      const timelineTraceIds = Array.from(
        new Set(
          [run.trace_id, ...inputMessages.map((message: any) => message.input_trace_id)]
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
        )
      );

      const timeline = timelineTraceIds.length > 0
        ? await database.executeQuery(
          `
            SELECT id, event_type, event_name, event_phase, duration_ms, metadata, event_time
            FROM timeline_events
            WHERE trace_id IN (${buildInClause(timelineTraceIds.length)})
            ORDER BY event_time ASC, id ASC
          `,
          timelineTraceIds
        )
        : [];
      const participation = buildParticipationSummary(timeline);

      const sentMessages = parseJsonArray(run.sent_messages) as string[];
      const llmTokenTotals = llmCalls.reduce<{ input_tokens: number; output_tokens: number; total_tokens: number; cached_input_tokens: number }>((totals, call: any) => {
        const tokenUsage = parseJsonObject(call.token_usage);
        const inputTokens = toNumber(tokenUsage.input_tokens ?? call.input_tokens);
        const outputTokens = toNumber(tokenUsage.output_tokens ?? call.output_tokens);
        const cachedInputTokens = extractCachedInputTokens(tokenUsage);

        return {
          input_tokens: totals.input_tokens + inputTokens,
          output_tokens: totals.output_tokens + outputTokens,
          total_tokens: totals.total_tokens + inputTokens + outputTokens,
          cached_input_tokens: totals.cached_input_tokens + cachedInputTokens,
        };
      }, {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        cached_input_tokens: 0,
      });

      res.json({
        success: true,
        data: {
          session: {
            session_key: run.session_key,
            peer_id: run.peer_id,
            peer_name: run.peer_name,
            chat_type: run.chat_type,
            account_id: run.account_id
          },
          run: {
            id: run.id,
            batch_id: run.batch_id,
            trace_id: run.trace_id,
            conversation_id: run.conversation_id,
            status: run.status,
            delivery_phase: run.delivery_phase,
            delivery_commit_count: Number(run.delivery_commit_count || 0),
            blocked_delivery_attempt_count: Number(run.blocked_delivery_attempt_count || 0),
            last_blocked_delivery_reason: run.last_blocked_delivery_reason,
            termination_reason: run.termination_reason,
            finish_reason: run.finish_reason,
            finish_outcome: run.finish_outcome,
            no_reply: Boolean(run.no_reply),
            final_response: run.final_response,
            error_message: run.error_message,
            total_turns: Number(run.total_turns || 0),
            started_at: run.started_at,
            completed_at: run.completed_at,
            reason_for_start: run.reason_for_start
          },
          input_batch: {
            id: run.batch_id,
            message_count: Number(run.input_message_count || 0),
            summary: run.batch_summary,
            messages: inputMessages
          },
          decision: {
            llm_calls_count: llmCalls.length,
            tool_calls_count: toolCalls.length,
            sent_messages_count: sentMessages.length,
            token_totals: llmTokenTotals,
            participation,
            llm_calls: llmCalls,
            tool_calls: toolCalls,
            timeline
          },
          result: {
            final_response: run.final_response,
            sent_messages: sentMessages,
            no_reply: Boolean(run.no_reply),
            delivery_phase: run.delivery_phase,
            delivery_commit_count: Number(run.delivery_commit_count || 0),
            blocked_delivery_attempt_count: Number(run.blocked_delivery_attempt_count || 0),
            last_blocked_delivery_reason: run.last_blocked_delivery_reason,
            termination_reason: run.termination_reason,
            finish_reason: run.finish_reason,
            finish_outcome: run.finish_outcome,
            error_message: run.error_message
          },
          trace_summary: {
            trace_id: run.trace_id,
            conversation_id: run.conversation_id
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch run detail', { error, runId: req.params.runId });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch run detail',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/runs/:runId/trace', async (req, res) => {
    try {
      const runId = req.params.runId;
      const runs = await database.executeQuery<{ conversation_id: number | null }>(
        'SELECT conversation_id FROM agent_runs WHERE id = ? LIMIT 1',
        [runId]
      );

      const conversationId = runs[0]?.conversation_id ? String(runs[0].conversation_id) : runId;
      const payload = await buildConversationTracePayload(database, logger, conversationId);
      if (!payload) {
        return res.status(404).json({
          success: false,
          error: runs[0]?.conversation_id ? 'Trace not found' : 'Run trace not available yet',
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        data: payload,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch run trace', { error, runId: req.params.runId });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch run trace',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/runs/:runId/trace/spans/:spanId/detail', async (req, res) => {
    try {
      const runId = req.params.runId;
      const runs = await database.executeQuery<{ conversation_id: number | null }>(
        'SELECT conversation_id FROM agent_runs WHERE id = ? LIMIT 1',
        [runId]
      );

      const conversationId = runs[0]?.conversation_id ? String(runs[0].conversation_id) : runId;
      const detail = await buildConversationTraceSpanDetail(
        database,
        logger,
        conversationId,
        decodeURIComponent(req.params.spanId)
      );

      if (!detail) {
        return res.status(404).json({
          success: false,
          error: 'Trace span detail not found',
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        data: detail,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch run trace span detail', {
        error,
        runId: req.params.runId,
        spanId: req.params.spanId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch run trace span detail',
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
}

export default createRunRoutes;

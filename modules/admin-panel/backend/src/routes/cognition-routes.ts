import express from 'express';
import { DatabaseManager } from '../services/database';
import winston from 'winston';

type CognitionScope = 'all' | 'private' | 'group';
type MemoryScope = 'all' | 'private' | 'group' | 'self';
type RelationshipBoundaryStrategy = 'allow_proactive' | 'observe_only' | 'do_not_contact';
const QQBOT_CORE_URL = process.env.QQBOT_CORE_URL || 'http://qqbot-core:8081';

function isReadOnlyDemoMode(): boolean {
  return process.env.ADMIN_DEMO_MODE === 'true' || process.env.DEMO_MODE === 'true';
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePage(value: unknown): number {
  const parsed = parseInt(String(value || '1'), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parseLimit(value: unknown): number {
  const parsed = parseInt(String(value || DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

function normalizeScope(value: unknown): CognitionScope {
  const normalized = String(value || 'all').toLowerCase();
  if (normalized === 'private' || normalized === 'group') {
    return normalized;
  }

  return 'all';
}

function normalizeMemoryScope(value: unknown): MemoryScope {
  const normalized = String(value || 'all').toLowerCase();
  if (normalized === 'private' || normalized === 'group' || normalized === 'self') {
    return normalized;
  }

  return 'all';
}

function normalizeSearch(value: unknown): string {
  return String(value || '').trim();
}

function likePattern(value: string): string {
  return `%${value.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
}

function parseJsonArray<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  return [];
}

function parseJsonValue<T = unknown>(value: unknown): T | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  return value as T;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapMemoryScopeType(memoryScope: unknown, groupId: unknown): 'private_user' | 'group_context' | 'self_global' {
  if (memoryScope === 'self_global') {
    return 'self_global';
  }

  if (memoryScope === 'local_field' && toNullableNumber(groupId) !== null) {
    return 'group_context';
  }

  return 'private_user';
}

function mapPlanScopeType(targetUserId: unknown, targetGroupId: unknown): 'private_user' | 'group_context' | 'self_global' {
  if (toNullableNumber(targetGroupId) !== null) {
    return 'group_context';
  }

  if (toNullableNumber(targetUserId) !== null) {
    return 'private_user';
  }

  return 'self_global';
}

function buildSubjectName(subjectType: unknown, subjectId: unknown, scopeType?: string): string {
  if (scopeType === 'self_global' || subjectType === 'self') {
    return '小腻';
  }

  if (scopeType === 'group_context' || subjectType === 'group') {
    return `群组${subjectId}`;
  }

  if (subjectType === 'conversation') {
    return `会话${subjectId}`;
  }

  return `用户${subjectId}`;
}

function emptyPagination(page: number, limit: number) {
  return {
    page,
    limit,
    total: 0,
    totalPages: 0
  };
}

function parseReason(value: unknown): string {
  const reason = String(value || '').trim();
  if (!reason) {
    throw new Error('reason is required');
  }
  return reason;
}

function parsePreviewOnly(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  return parseBooleanField(value, 'preview_only');
}

function parsePatchObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('patch must be an object');
  }
  return value as Record<string, any>;
}

function parsePositiveId(value: unknown, fieldName: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

function parseOptionalString(value: unknown, fieldName: string): string | null {
  if (value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return normalized;
}

function parseOptionalNumber(value: unknown, fieldName: string, min = 0, max = 1): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a number`);
  }
  if (parsed < min || parsed > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}`);
  }
  return parsed;
}

function parseBoundaryStrategy(value: unknown): RelationshipBoundaryStrategy | null {
  if (value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  if (normalized === 'allow_proactive' || normalized === 'observe_only' || normalized === 'do_not_contact') {
    return normalized;
  }
  throw new Error('boundary_strategy must be one of allow_proactive, observe_only, do_not_contact');
}

function parseBeliefType(value: unknown): 'identity_fact' | 'preference' | 'commitment' | 'relationship' | null {
  if (value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  if (
    normalized === 'identity_fact' ||
    normalized === 'preference' ||
    normalized === 'commitment' ||
    normalized === 'relationship'
  ) {
    return normalized;
  }
  throw new Error('belief_type must be one of identity_fact, preference, commitment, relationship');
}

function parsePolarity(value: unknown): 'positive' | 'negative' | 'neutral' | null {
  if (value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  if (normalized === 'positive' || normalized === 'negative' || normalized === 'neutral') {
    return normalized;
  }
  throw new Error('polarity must be one of positive, negative, neutral');
}

function parseBeliefStatus(value: unknown): 'active' | 'stale' | null {
  if (value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  if (normalized === 'active' || normalized === 'stale') {
    return normalized;
  }
  throw new Error('status must be one of active, stale');
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function buildImpactSummary(entityType: 'belief' | 'memory' | 'relationship', affectedPlanIds: number[], action: string): string {
  const planImpact = affectedPlanIds.length > 0
    ? `影响 ${affectedPlanIds.length} 条 followup_queue 计划`
    : '当前没有命中 followup_queue 计划';
  return `${entityType} ${action} 已进入认知纠偏流程，${planImpact}。`;
}

async function findAffectedPlanIds(
  database: DatabaseManager,
  subject: {
    subjectType: string;
    subjectId: string | number;
    groupId?: number | null;
  }
): Promise<number[]> {
  if (!(await tableExists(database, 'agent_plans'))) {
    return [];
  }

  let whereSql = `WHERE plan_type = 'followup_queue' AND status IN ('queued', 'active')`;
  const params: any[] = [];

  if (subject.subjectType === 'self') {
    whereSql = `WHERE status IN ('queued', 'active')`;
  } else if (subject.subjectType === 'group') {
    whereSql += ` AND target_group_id = ?`;
    params.push(Number(subject.subjectId));
  } else {
    whereSql += ` AND target_user_id = ?`;
    params.push(Number(subject.subjectId));
    if (subject.groupId !== undefined) {
      whereSql += ` AND target_group_id <=> ?`;
      params.push(subject.groupId ?? null);
    }
  }

  const rows = await database.executeQuery<{ id: number }>(
    `SELECT id FROM agent_plans ${whereSql} ORDER BY updated_at DESC, id DESC LIMIT 50`,
    params
  );

  return rows.map(row => Number(row.id)).filter(id => Number.isFinite(id));
}

async function triggerCognitionRecompute(subject: {
  subjectType: 'user' | 'group' | 'self';
  subjectId: string | number;
  groupId?: number | null;
}): Promise<{ ok: boolean; payload?: any; error?: string }> {
  try {
    const { status, payload } = await proxyQqbotCoreJson('/api/internal/cognition/recompute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        subject_type: subject.subjectType,
        subject_id: subject.subjectId,
        group_id: subject.groupId ?? null
      })
    });

    return {
      ok: status >= 200 && status < 300 && Boolean(payload?.success),
      payload
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to recompute cognition state'
    };
  }
}

function parseBooleanField(value: unknown, fieldName: string): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 1 || value === '1' || value === 'true') {
    return true;
  }
  if (value === 0 || value === '0' || value === 'false') {
    return false;
  }

  throw new Error(`${fieldName} must be a boolean`);
}

function parseIntegerField(value: unknown, fieldName: string, min: number, max?: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  if (parsed < min) {
    throw new Error(`${fieldName} must be >= ${min}`);
  }
  if (typeof max === 'number' && parsed > max) {
    throw new Error(`${fieldName} must be <= ${max}`);
  }
  return parsed;
}

function parseAllowedUserIds(value: unknown): number[] {
  let candidates: unknown[] = [];

  if (Array.isArray(value)) {
    candidates = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed);
      candidates = Array.isArray(parsed) ? parsed : trimmed.split(',');
    } catch {
      candidates = trimmed.split(',');
    }
  } else {
    throw new Error('allowed_user_ids must be an array or comma-separated string');
  }

  return Array.from(
    new Set(
      candidates
        .map(item => Number(String(item).trim()))
        .filter(item => Number.isFinite(item) && item > 0)
    )
  );
}

async function proxyQqbotCoreJson(
  path: string,
  init?: RequestInit
): Promise<{
  status: number;
  payload: any;
}> {
  const response = await fetch(`${QQBOT_CORE_URL}${path}`, init);
  const payload = await response.json().catch(() => ({
    success: false,
    error: `Failed to parse response from ${path}`
  }));

  return {
    status: response.status,
    payload
  };
}

async function tableExists(database: DatabaseManager, tableName: string): Promise<boolean> {
  const rows = await database.executeQuery<{ total: number }>(
    `SELECT COUNT(*) AS total
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = ?`,
    [tableName]
  );

  return (rows[0]?.total || 0) > 0;
}

async function countRows(
  database: DatabaseManager,
  tableName: string,
  whereSql: string,
  params: any[]
): Promise<number> {
  const rows = await database.executeQuery<{ total: number }>(
    `SELECT COUNT(*) AS total FROM ${tableName} ${whereSql}`,
    params
  );

  return rows[0]?.total || 0;
}

export function createCognitionRoutes(database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();

  router.get('/cognition/overview', async (_req, res) => {
    try {
      const [observationsReady, beliefsReady, memoriesReady, evidenceReady, reflectionsReady, selfModelReady, plansReady] = await Promise.all([
        tableExists(database, 'agent_observations'),
        tableExists(database, 'agent_beliefs'),
        tableExists(database, 'agent_memories'),
        tableExists(database, 'agent_memory_evidence'),
        tableExists(database, 'agent_reflections'),
        tableExists(database, 'agent_self_model'),
        tableExists(database, 'agent_plans')
      ]);

      const [observationSummary, beliefSummary, memorySummary, evidenceSummary, reflectionSummary, selfModelSummary, planSummary] = await Promise.all([
        observationsReady
          ? database.executeQuery<{
              total: number;
              private_total: number;
              group_total: number;
              last_24h: number;
              last_7d: number;
              latest_at: string | null;
            }>(`
              SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN field_scope = 'private_chat' THEN 1 ELSE 0 END) AS private_total,
                SUM(CASE WHEN field_scope = 'group_chat' THEN 1 ELSE 0 END) AS group_total,
                SUM(CASE WHEN occurred_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) AS last_24h,
                SUM(CASE WHEN occurred_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS last_7d,
                MAX(occurred_at) AS latest_at
              FROM agent_observations
            `)
          : Promise.resolve([]),
        beliefsReady
          ? database.executeQuery<{
              total: number;
              active_total: number;
              revised_total: number;
              stale_total: number;
              latest_at: string | null;
            }>(`
              SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_total,
                SUM(CASE WHEN status = 'revised' THEN 1 ELSE 0 END) AS revised_total,
                SUM(CASE WHEN status = 'stale' THEN 1 ELSE 0 END) AS stale_total,
                MAX(updated_at) AS latest_at
              FROM agent_beliefs
            `)
          : Promise.resolve([]),
        memoriesReady
          ? database.executeQuery<{
              total: number;
              active_total: number;
              revised_total: number;
              disabled_total: number;
              latest_at: string | null;
            }>(`
              SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_total,
                SUM(CASE WHEN status = 'superseded' THEN 1 ELSE 0 END) AS revised_total,
                SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) AS disabled_total,
                MAX(updated_at) AS latest_at
              FROM agent_memories
            `)
          : Promise.resolve([]),
        evidenceReady
          ? database.executeQuery<{
              total: number;
              latest_at: string | null;
            }>(`
              SELECT
                COUNT(*) AS total,
                MAX(created_at) AS latest_at
              FROM agent_memory_evidence
            `)
          : Promise.resolve([]),
        reflectionsReady
          ? database.executeQuery<{
              total: number;
              completed_total: number;
              failed_total: number;
              latest_at: string | null;
            }>(`
              SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_total,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_total,
                MAX(created_at) AS latest_at
              FROM agent_reflections
            `)
          : Promise.resolve([]),
        selfModelReady
          ? database.executeQuery<{
              total: number;
              current_total: number;
              latest_at: string | null;
            }>(`
              SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN is_current = 1 THEN 1 ELSE 0 END) AS current_total,
                MAX(updated_at) AS latest_at
              FROM agent_self_model
            `)
          : Promise.resolve([]),
        plansReady
          ? database.executeQuery<{
              total: number;
              queued_total: number;
              active_total: number;
              completed_total: number;
              latest_at: string | null;
            }>(`
              SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued_total,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_total,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_total,
                MAX(updated_at) AS latest_at
              FROM agent_plans
            `)
          : Promise.resolve([])
      ]);

      res.json({
        success: true,
        data: {
          observations: observationSummary[0] || {
            total: 0,
            private_total: 0,
            group_total: 0,
            last_24h: 0,
            last_7d: 0,
            latest_at: null
          },
          beliefs: beliefSummary[0] || {
            total: 0,
            active_total: 0,
            revised_total: 0,
            stale_total: 0,
            latest_at: null
          },
          memories: memorySummary[0] || {
            total: 0,
            active_total: 0,
            revised_total: 0,
            disabled_total: 0,
            latest_at: null
          },
          evidence: evidenceSummary[0] || {
            total: 0,
            latest_at: null
          },
          reflections: reflectionSummary[0] || {
            total: 0,
            completed_total: 0,
            failed_total: 0,
            latest_at: null
          },
          self_models: selfModelSummary[0] || {
            total: 0,
            current_total: 0,
            latest_at: null
          },
          plans: planSummary[0] || {
            total: 0,
            queued_total: 0,
            active_total: 0,
            completed_total: 0,
            latest_at: null
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch cognition overview', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch cognition overview',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/cognition/proactivity', async (_req, res) => {
    try {
      const { status, payload } = await proxyQqbotCoreJson('/api/internal/proactivity');
      res.status(status).json(payload);
    } catch (error) {
      logger.error('Failed to fetch cognition proactivity controls', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch cognition proactivity controls',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.patch('/cognition/proactivity', async (req, res) => {
    try {
      const patch: Record<string, unknown> = {};

      if (req.body.followup_enabled !== undefined) {
        patch.followup_enabled = parseBooleanField(req.body.followup_enabled, 'followup_enabled');
      }

      if (req.body.is_paused !== undefined) {
        patch.is_paused = parseBooleanField(req.body.is_paused, 'is_paused');
      }

      if (req.body.allowed_user_ids !== undefined) {
        patch.allowed_user_ids = parseAllowedUserIds(req.body.allowed_user_ids);
      }

      if (req.body.observed_group_ids !== undefined) {
        patch.observed_group_ids = parseAllowedUserIds(req.body.observed_group_ids);
      }

      if (req.body.allowed_group_ids !== undefined) {
        patch.allowed_group_ids = parseAllowedUserIds(req.body.allowed_group_ids);
      }

      if (req.body.max_per_run !== undefined) {
        patch.max_per_run = parseIntegerField(req.body.max_per_run, 'max_per_run', 1, 5);
      }

      if (req.body.retry_delay_ms !== undefined) {
        patch.retry_delay_ms = parseIntegerField(req.body.retry_delay_ms, 'retry_delay_ms', 60_000);
      }

      const { status, payload } = await proxyQqbotCoreJson('/api/internal/proactivity', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(patch)
      });

      res.status(status).json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to update cognition proactivity controls', { error: message });
      res.status(message.includes('must') ? 400 : 500).json({
        success: false,
        error: 'Failed to update cognition proactivity controls',
        message,
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/cognition/observations', async (req, res) => {
    try {
      const page = parsePage(req.query.page);
      const limit = parseLimit(req.query.limit);

      if (!(await tableExists(database, 'agent_observations'))) {
        res.json({
          success: true,
          data: [],
          pagination: emptyPagination(page, limit),
          timestamp: new Date().toISOString()
        });
        return;
      }

      const offset = (page - 1) * limit;
      const scope = normalizeScope(req.query.scope);
      const search = normalizeSearch(req.query.search);

      const whereClauses: string[] = [];
      const params: any[] = [];

      if (scope === 'private') {
        whereClauses.push(`field_scope = 'private_chat'`);
      } else if (scope === 'group') {
        whereClauses.push(`field_scope = 'group_chat'`);
      }

      if (search) {
        const pattern = likePattern(search);
        whereClauses.push(`(
          content LIKE ?
          OR CAST(user_id AS CHAR) LIKE ?
          OR CAST(group_id AS CHAR) LIKE ?
          OR CAST(subject_user_id AS CHAR) LIKE ?
          OR CAST(JSON_EXTRACT(raw_payload, '$.message_id') AS CHAR) LIKE ?
        )`);
        params.push(pattern, pattern, pattern, pattern, pattern);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const total = await countRows(database, 'agent_observations', whereSql, params);
      const rows = await database.executeQuery<any>(
        `SELECT
           CONCAT('observation:', id) AS id,
           id AS record_id,
           field_scope AS scope_type,
           CASE
             WHEN field_scope = 'group_chat' THEN 'group'
             WHEN field_scope = 'tool_channel' THEN 'system'
             ELSE 'user'
           END AS subject_type,
           COALESCE(subject_user_id, user_id, group_id, 0) AS subject_id,
           CASE
             WHEN field_scope = 'group_chat' THEN CONCAT('群组', group_id)
             WHEN field_scope = 'tool_channel' THEN '工具链'
             ELSE CONCAT('用户', COALESCE(subject_user_id, user_id))
           END AS subject_name,
           'agent_observations' AS source_table,
           conversation_id,
           CAST(JSON_EXTRACT(raw_payload, '$.message_id') AS UNSIGNED) AS message_id,
           COALESCE(user_id, subject_user_id, 0) AS sender_id,
           CASE
             WHEN source_type = 'incoming_message' THEN 'user'
             WHEN source_type = 'outgoing_message' THEN 'bot'
             ELSE 'system'
           END AS sender_role,
           'text' AS content_type,
           source_type,
           message_type,
           content,
           LEFT(content, 120) AS summary,
           tool_payload_ref,
           counterparty_ids,
           raw_payload,
           occurred_at AS sent_at,
           created_at,
           created_at AS updated_at
         FROM agent_observations
         ${whereSql}
         ORDER BY occurred_at DESC, id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
      );

      res.json({
        success: true,
        data: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch cognition observations', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch cognition observations',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/cognition/beliefs', async (req, res) => {
    try {
      const page = parsePage(req.query.page);
      const limit = parseLimit(req.query.limit);

      if (!(await tableExists(database, 'agent_beliefs'))) {
        res.json({
          success: true,
          data: [],
          pagination: emptyPagination(page, limit),
          timestamp: new Date().toISOString()
        });
        return;
      }

      const offset = (page - 1) * limit;
      const scope = normalizeScope(req.query.scope);
      const search = normalizeSearch(req.query.search);

      const whereClauses: string[] = [];
      const params: any[] = [];

      if (scope === 'private') {
        whereClauses.push(`subject_type = 'user'`);
      } else if (scope === 'group') {
        whereClauses.push(`subject_type = 'group'`);
      }

      if (search) {
        const pattern = likePattern(search);
        whereClauses.push(`(
          subject_id LIKE ?
          OR claim LIKE ?
          OR belief_key LIKE ?
          OR belief_type LIKE ?
        )`);
        params.push(pattern, pattern, pattern, pattern);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const total = await countRows(database, 'agent_beliefs', whereSql, params);
      const rows = await database.executeQuery<any>(
        `SELECT
           CONCAT('belief:', id) AS id,
           id AS record_id,
           CASE
             WHEN subject_type = 'group' THEN 'group_context'
             WHEN subject_type = 'self' THEN 'self_global'
             ELSE 'private_user'
           END AS scope_type,
           subject_type,
           subject_id,
           CASE
             WHEN subject_type = 'group' THEN CONCAT('群组', subject_id)
             WHEN subject_type = 'self' THEN '小腻'
             WHEN subject_type = 'conversation' THEN CONCAT('会话', subject_id)
             ELSE CONCAT('用户', subject_id)
           END AS subject_name,
           'agent_beliefs' AS source_table,
           belief_type AS title,
           claim AS content,
           CONCAT(
             'key=', belief_key,
             ', polarity=', polarity,
             ', confidence=', confidence,
             ', count=', observation_count,
             ', status=', status
           ) AS detail,
           belief_key,
           polarity,
           confidence,
           status,
           observation_count,
           last_evidence_id,
           first_observed_at,
           last_observed_at,
           updated_at,
           created_at
         FROM agent_beliefs
         ${whereSql}
         ORDER BY last_observed_at DESC, id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
      );

      res.json({
        success: true,
        data: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch cognition beliefs', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch cognition beliefs',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.patch('/cognition/beliefs/:id', async (req, res) => {
    try {
      const beliefId = parsePositiveId(req.params.id, 'belief id');
      const reason = parseReason(req.body?.reason);
      const previewOnly = parsePreviewOnly(req.body?.preview_only);
      const patch = parsePatchObject(req.body?.patch);

      if (!(await tableExists(database, 'agent_beliefs'))) {
        res.status(404).json({
          success: false,
          error: 'Belief table is not available',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const rows = await database.executeQuery<any>(
        `SELECT * FROM agent_beliefs WHERE id = ? LIMIT 1`,
        [beliefId]
      );
      const before = rows[0];
      if (!before) {
        res.status(404).json({
          success: false,
          error: 'Belief not found',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const nextClaim = parseOptionalString(patch.claim, 'patch.claim') ?? before.claim;
      const nextBeliefType = parseBeliefType(patch.belief_type) ?? before.belief_type;
      const nextBeliefKey = parseOptionalString(patch.belief_key, 'patch.belief_key') ?? before.belief_key;
      const nextPolarity = parsePolarity(patch.polarity) ?? before.polarity;
      const nextConfidence = parseOptionalNumber(patch.confidence, 'patch.confidence') ?? Number(before.confidence);
      const nextStatus = parseBeliefStatus(patch.status) ?? 'active';

      const after = {
        ...before,
        belief_type: nextBeliefType,
        belief_key: nextBeliefKey,
        claim: nextClaim,
        normalized_claim: normalizeText(nextClaim),
        polarity: nextPolarity,
        confidence: nextConfidence,
        status: nextStatus
      };

      const affectedPlanIds = await findAffectedPlanIds(database, {
        subjectType: before.subject_type,
        subjectId: before.subject_id
      });
      const impactSummary = buildImpactSummary('belief', affectedPlanIds, previewOnly ? 'preview' : 'commit');

      if (previewOnly) {
        res.json({
          success: true,
          data: {
            before,
            after,
            impact_summary: impactSummary,
            affected_plan_ids: affectedPlanIds
          },
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (isReadOnlyDemoMode()) {
        res.status(403).json({
          success: false,
          error: 'Demo mode is read-only',
          message: '当前是 demo 只读模式，仅允许 preview，不允许 commit。',
          timestamp: new Date().toISOString()
        });
        return;
      }

      await database.executeUpdate(
        `
          UPDATE agent_beliefs
          SET
            status = 'revised',
            updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ?
        `,
        [beliefId]
      );

      const insertResult = await database.executeInsert(
        `
          INSERT INTO agent_beliefs (
            subject_type,
            subject_id,
            belief_type,
            belief_key,
            claim,
            normalized_claim,
            polarity,
            confidence,
            status,
            observation_count,
            last_evidence_id,
            first_observed_at,
            last_observed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
        `,
        [
          before.subject_type,
          before.subject_id,
          after.belief_type,
          after.belief_key,
          after.claim,
          after.normalized_claim,
          after.polarity,
          after.confidence,
          after.status,
          Number(before.observation_count || 1),
          toNullableNumber(before.last_evidence_id),
          before.first_observed_at
        ]
      );

      const nextBeliefId = Number(insertResult.insertId);
      const editResult = await database.executeInsert(
        `
          INSERT INTO agent_cognition_edits (
            entity_type,
            entity_id,
            action_type,
            reason,
            before_json,
            after_json,
            impact_json,
            operator_id
          ) VALUES ('belief', ?, 'patch', ?, ?, ?, ?, 'qqbot-admin')
        `,
        [
          nextBeliefId,
          reason,
          JSON.stringify(before),
          JSON.stringify({ ...after, id: nextBeliefId }),
          JSON.stringify({
            impact_summary: impactSummary,
            affected_plan_ids: affectedPlanIds
          })
        ]
      );

      const recompute = await triggerCognitionRecompute({
        subjectType: before.subject_type,
        subjectId: before.subject_id
      });

      res.json({
        success: true,
        data: {
          before,
          after: { ...after, id: nextBeliefId },
          impact_summary: impactSummary,
          affected_plan_ids: affectedPlanIds,
          edit_id: Number(editResult.insertId),
          recompute
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to patch cognition belief';
      logger.error('Failed to patch cognition belief', { error: message });
      res.status(message.includes('required') || message.includes('must') ? 400 : 500).json({
        success: false,
        error: 'Failed to patch cognition belief',
        message,
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/cognition/memories', async (req, res) => {
    try {
      const page = parsePage(req.query.page);
      const limit = parseLimit(req.query.limit);

      if (!(await tableExists(database, 'agent_memories'))) {
        res.json({
          success: true,
          data: [],
          pagination: emptyPagination(page, limit),
          timestamp: new Date().toISOString()
        });
        return;
      }

      const offset = (page - 1) * limit;
      const scope = normalizeMemoryScope(req.query.scope);
      const search = normalizeSearch(req.query.search);

      const whereClauses: string[] = [];
      const params: any[] = [];

      if (scope === 'private') {
        whereClauses.push(`memory_scope IN ('person_global', 'local_field')`);
      } else if (scope === 'group') {
        whereClauses.push(`memory_scope = 'local_field'`, `group_id IS NOT NULL`);
      } else if (scope === 'self') {
        whereClauses.push(`memory_scope = 'self_global'`);
      }

      if (search) {
        const pattern = likePattern(search);
        whereClauses.push(`(
          content LIKE ?
          OR memory_type LIKE ?
          OR memory_scope LIKE ?
          OR CAST(subject_id AS CHAR) LIKE ?
        )`);
        params.push(pattern, pattern, pattern, pattern);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const total = await countRows(database, 'agent_memories', whereSql, params);
      const memoryRows = await database.executeQuery<any>(
        `SELECT
           agent_memories.*,
           (
             SELECT e.id
             FROM agent_memory_evidence e
             WHERE e.memory_id = agent_memories.id
             ORDER BY e.id DESC
             LIMIT 1
           ) AS last_evidence_id
         FROM agent_memories
         ${whereSql}
         ORDER BY COALESCE(last_recalled_at, updated_at, created_at) DESC, id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
      );
      const rows = memoryRows.map(row => {
        const scopeType = mapMemoryScopeType(row.memory_scope, row.group_id);
        return {
          id: `memory:${row.id}`,
          record_id: row.id,
          scope_type: scopeType,
          subject_type: row.subject_type,
          subject_id: row.subject_id,
          subject_name: buildSubjectName(row.subject_type, row.subject_id, scopeType),
          source_table: 'agent_memories',
          memory_type: row.memory_type,
          content: row.content,
          summary: typeof row.content === 'string' ? row.content.slice(0, 120) : null,
          confidence: Number(row.confidence),
          salience: Number(row.salience),
          status: row.status,
          source_kind: row.source_kind,
          promoted_to_global: row.memory_scope === 'person_global',
          last_evidence_id: toNullableNumber(row.last_evidence_id),
          last_recalled_at: row.last_recalled_at,
          raw_payload: {
            memory_scope: row.memory_scope,
            field_scope: row.field_scope,
            user_id: toNullableNumber(row.user_id),
            group_id: toNullableNumber(row.group_id),
            promoted_from_belief_id: toNullableNumber(row.promoted_from_belief_id)
          },
          created_at: row.created_at,
          updated_at: row.updated_at
        };
      });

      res.json({
        success: true,
        data: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch cognition memories', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch cognition memories',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.patch('/cognition/memories/:id', async (req, res) => {
    try {
      const memoryId = parsePositiveId(req.params.id, 'memory id');
      const reason = parseReason(req.body?.reason);
      const previewOnly = parsePreviewOnly(req.body?.preview_only);
      const patch = parsePatchObject(req.body?.patch);

      if (!(await tableExists(database, 'agent_memories'))) {
        res.status(404).json({
          success: false,
          error: 'Memory table is not available',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const rows = await database.executeQuery<any>(
        `SELECT * FROM agent_memories WHERE id = ? LIMIT 1`,
        [memoryId]
      );
      const before = rows[0];
      if (!before) {
        res.status(404).json({
          success: false,
          error: 'Memory not found',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const patchKeys = Object.keys(patch);
      if (patchKeys.length === 0 || patchKeys.some(key => key !== 'status')) {
        throw new Error('memory patch currently only supports patch.status');
      }

      const nextStatus = parseOptionalString(patch.status, 'patch.status');
      if (nextStatus !== 'active' && nextStatus !== 'disabled') {
        throw new Error('patch.status must be active or disabled');
      }

      const after = {
        ...before,
        status: nextStatus
      };
      const affectedPlanIds = await findAffectedPlanIds(database, {
        subjectType: before.subject_type,
        subjectId: before.subject_id,
        groupId: toNullableNumber(before.group_id)
      });
      const actionType = nextStatus === 'disabled' ? 'disable' : 'patch';
      const impactSummary = buildImpactSummary('memory', affectedPlanIds, previewOnly ? 'preview' : actionType);

      if (previewOnly) {
        res.json({
          success: true,
          data: {
            before,
            after,
            impact_summary: impactSummary,
            affected_plan_ids: affectedPlanIds
          },
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (isReadOnlyDemoMode()) {
        res.status(403).json({
          success: false,
          error: 'Demo mode is read-only',
          message: '当前是 demo 只读模式，仅允许 preview，不允许 commit。',
          timestamp: new Date().toISOString()
        });
        return;
      }

      await database.executeUpdate(
        `
          UPDATE agent_memories
          SET
            status = ?,
            updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ?
        `,
        [nextStatus, memoryId]
      );

      const editResult = await database.executeInsert(
        `
          INSERT INTO agent_cognition_edits (
            entity_type,
            entity_id,
            action_type,
            reason,
            before_json,
            after_json,
            impact_json,
            operator_id
          ) VALUES ('memory', ?, ?, ?, ?, ?, ?, 'qqbot-admin')
        `,
        [
          memoryId,
          actionType,
          reason,
          JSON.stringify(before),
          JSON.stringify(after),
          JSON.stringify({
            impact_summary: impactSummary,
            affected_plan_ids: affectedPlanIds
          })
        ]
      );

      const recompute = await triggerCognitionRecompute({
        subjectType: before.subject_type === 'conversation' ? 'self' : before.subject_type,
        subjectId: before.subject_type === 'conversation' ? 'self' : before.subject_id,
        groupId: toNullableNumber(before.group_id)
      });

      res.json({
        success: true,
        data: {
          before,
          after,
          impact_summary: impactSummary,
          affected_plan_ids: affectedPlanIds,
          edit_id: Number(editResult.insertId),
          recompute
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to patch cognition memory';
      logger.error('Failed to patch cognition memory', { error: message });
      res.status(message.includes('required') || message.includes('must') ? 400 : 500).json({
        success: false,
        error: 'Failed to patch cognition memory',
        message,
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/cognition/evidence', async (req, res) => {
    try {
      const page = parsePage(req.query.page);
      const limit = parseLimit(req.query.limit);

      if (!(await tableExists(database, 'agent_memory_evidence'))) {
        res.json({
          success: true,
          data: [],
          pagination: emptyPagination(page, limit),
          timestamp: new Date().toISOString()
        });
        return;
      }

      const offset = (page - 1) * limit;
      const scope = normalizeMemoryScope(req.query.scope);
      const search = normalizeSearch(req.query.search);

      const whereClauses: string[] = [];
      const params: any[] = [];

      if (scope === 'private') {
        whereClauses.push(`m.memory_scope IN ('person_global', 'local_field')`);
      } else if (scope === 'group') {
        whereClauses.push(`m.memory_scope = 'local_field'`, `m.group_id IS NOT NULL`);
      } else if (scope === 'self') {
        whereClauses.push(`m.memory_scope = 'self_global'`);
      }

      if (search) {
        const pattern = likePattern(search);
        whereClauses.push(`(
          e.quote LIKE ?
          OR o.content LIKE ?
          OR b.claim LIKE ?
          OR CAST(e.observation_id AS CHAR) LIKE ?
          OR CAST(e.belief_id AS CHAR) LIKE ?
        )`);
        params.push(pattern, pattern, pattern, pattern, pattern);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const totalRows = await database.executeQuery<{ total: number }>(
        `
          SELECT COUNT(*) AS total
          FROM agent_memory_evidence e
          INNER JOIN agent_memories m ON m.id = e.memory_id
          LEFT JOIN agent_observations o ON o.id = e.observation_id
          LEFT JOIN agent_beliefs b ON b.id = e.belief_id
          ${whereSql}
        `,
        params
      );
      const total = totalRows[0]?.total || 0;
      const evidenceRows = await database.executeQuery<any>(
        `SELECT
           e.*,
           m.memory_scope,
           m.subject_id,
           m.group_id,
           m.confidence AS memory_confidence,
           o.source_type AS observation_source_type,
           o.content AS observation_content,
           o.raw_payload AS observation_raw_payload,
           b.belief_type,
           b.claim AS belief_claim,
           b.confidence AS belief_confidence
         FROM agent_memory_evidence e
         INNER JOIN agent_memories m ON m.id = e.memory_id
         LEFT JOIN agent_observations o ON o.id = e.observation_id
         LEFT JOIN agent_beliefs b ON b.id = e.belief_id
         ${whereSql}
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
      );
      const rows = evidenceRows.map(row => ({
        id: `evidence:${row.id}`,
        record_id: row.id,
        memory_id: toNullableNumber(row.memory_id),
        memory_scope: mapMemoryScopeType(row.memory_scope, row.group_id),
        source_type: row.observation_source_type || row.belief_type || row.evidence_kind,
        source_table:
          row.observation_id !== null && row.observation_id !== undefined
            ? 'agent_observations'
            : row.belief_id !== null && row.belief_id !== undefined
              ? 'agent_beliefs'
              : 'manual',
        source_record_id: toNullableNumber(row.observation_id) ?? toNullableNumber(row.belief_id),
        quote: row.quote,
        evidence_text: row.observation_content || row.belief_claim || row.quote,
        confidence: toNullableNumber(row.belief_confidence) ?? toNullableNumber(row.memory_confidence),
        raw_payload: row.observation_raw_payload,
        created_at: row.created_at
      }));

      res.json({
        success: true,
        data: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch cognition evidence', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch cognition evidence',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/cognition/reflections', async (req, res) => {
    try {
      const page = parsePage(req.query.page);
      const limit = parseLimit(req.query.limit);

      if (!(await tableExists(database, 'agent_reflections'))) {
        res.json({
          success: true,
          data: [],
          pagination: emptyPagination(page, limit),
          timestamp: new Date().toISOString()
        });
        return;
      }

      const offset = (page - 1) * limit;
      const search = normalizeSearch(req.query.search);
      const whereClauses: string[] = [];
      const params: any[] = [];

      if (search) {
        const pattern = likePattern(search);
        whereClauses.push(`(
          reflection_key LIKE ?
          OR reflection_kind LIKE ?
          OR status LIKE ?
          OR summary LIKE ?
        )`);
        params.push(pattern, pattern, pattern, pattern);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const total = await countRows(database, 'agent_reflections', whereSql, params);
      const reflectionRows = await database.executeQuery<any>(
        `
          SELECT *
          FROM agent_reflections
          ${whereSql}
          ORDER BY started_at DESC, id DESC
          LIMIT ${limit} OFFSET ${offset}
        `,
        params
      );
      const rows = reflectionRows.map(row => {
        const sourceBeliefIds = parseJsonArray<number>(row.source_belief_ids);
        const sourceObservationIds = parseJsonArray<number>(row.source_observation_ids);
        const promotedMemoryIds = parseJsonArray<number>(row.promoted_memory_ids);
        return {
          id: `reflection:${row.id}`,
          record_id: row.id,
          reflection_kind: row.reflection_kind,
          reflection_key: row.reflection_key,
          status: row.status,
          summary: row.summary,
          source_belief_ids: sourceBeliefIds,
          source_observation_ids: sourceObservationIds,
          promoted_memory_ids: promotedMemoryIds,
          source_belief_count: sourceBeliefIds.length,
          promoted_memory_count: promotedMemoryIds.length,
          started_at: row.started_at,
          completed_at: row.completed_at,
          created_at: row.created_at,
          raw_payload: {
            source_observation_ids: sourceObservationIds
          }
        };
      });

      res.json({
        success: true,
        data: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch cognition reflections', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch cognition reflections',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/cognition/self-model', async (req, res) => {
    try {
      const page = parsePage(req.query.page);
      const limit = parseLimit(req.query.limit);

      if (!(await tableExists(database, 'agent_self_model'))) {
        res.json({
          success: true,
          data: [],
          pagination: emptyPagination(page, limit),
          timestamp: new Date().toISOString()
        });
        return;
      }

      const offset = (page - 1) * limit;
      const search = normalizeSearch(req.query.search);
      const whereClauses: string[] = [];
      const params: any[] = [];

      if (search) {
        const pattern = likePattern(search);
        whereClauses.push(`(
          identity_summary LIKE ?
          OR availability LIKE ?
          OR energy LIKE ?
          OR CAST(current_concerns AS CHAR) LIKE ?
        )`);
        params.push(pattern, pattern, pattern, pattern);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const total = await countRows(database, 'agent_self_model', whereSql, params);
      const selfModelRows = await database.executeQuery<any>(
        `
          SELECT *
          FROM agent_self_model
          ${whereSql}
          ORDER BY is_current DESC, updated_at DESC, id DESC
          LIMIT ${limit} OFFSET ${offset}
        `,
        params
      );
      const rows = selfModelRows.map(row => ({
        id: `self-model:${row.id}`,
        record_id: row.id,
        identity_summary: row.identity_summary,
        core_traits: parseJsonArray<string>(row.core_traits),
        long_term_goals: parseJsonArray<string>(row.long_term_goals),
        current_concerns: parseJsonArray<string>(row.current_concerns),
        availability: row.availability,
        energy: row.energy,
        source_reflection_id: toNullableNumber(row.source_reflection_id),
        is_current: Boolean(row.is_current),
        created_at: row.created_at,
        updated_at: row.updated_at,
        raw_payload: {
          source_reflection_id: toNullableNumber(row.source_reflection_id)
        }
      }));

      res.json({
        success: true,
        data: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch cognition self model', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch cognition self model',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/cognition/plans', async (req, res) => {
    try {
      const page = parsePage(req.query.page);
      const limit = parseLimit(req.query.limit);

      if (!(await tableExists(database, 'agent_plans'))) {
        res.json({
          success: true,
          data: [],
          pagination: emptyPagination(page, limit),
          timestamp: new Date().toISOString()
        });
        return;
      }

      const offset = (page - 1) * limit;
      const scope = normalizeMemoryScope(req.query.scope);
      const search = normalizeSearch(req.query.search);
      const whereClauses: string[] = [];
      const params: any[] = [];

      if (scope === 'private') {
        whereClauses.push(`target_user_id IS NOT NULL`);
      } else if (scope === 'group') {
        whereClauses.push(`target_group_id IS NOT NULL`);
      } else if (scope === 'self') {
        whereClauses.push(`target_user_id IS NULL`, `target_group_id IS NULL`);
      }

      if (search) {
        const pattern = likePattern(search);
        whereClauses.push(`(
          goal LIKE ?
          OR trigger_condition LIKE ?
          OR plan_type LIKE ?
          OR CAST(target_user_id AS CHAR) LIKE ?
          OR CAST(target_group_id AS CHAR) LIKE ?
        )`);
        params.push(pattern, pattern, pattern, pattern, pattern);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const total = await countRows(database, 'agent_plans', whereSql, params);
      const planRows = await database.executeQuery<any>(
        `
          SELECT *
          FROM agent_plans
          ${whereSql}
          ORDER BY
            CASE status WHEN 'active' THEN 0 WHEN 'queued' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
            COALESCE(scheduled_start_at, updated_at) DESC,
            id DESC
          LIMIT ${limit} OFFSET ${offset}
        `,
        params
      );
      const rows = planRows.map(row => {
        const scopeType = mapPlanScopeType(row.target_user_id, row.target_group_id);
        return {
          id: `plan:${row.id}`,
          record_id: row.id,
          scope_type: scopeType,
          target_label:
            scopeType === 'group_context'
              ? `群组${row.target_group_id}`
              : scopeType === 'private_user'
                ? `用户${row.target_user_id}`
                : '小腻',
          plan_type: row.plan_type,
          target_field_scope: row.target_field_scope,
          target_user_id: toNullableNumber(row.target_user_id),
          target_group_id: toNullableNumber(row.target_group_id),
          goal: row.goal,
          trigger_condition: row.trigger_condition,
          status: row.status,
          scheduled_start_at: row.scheduled_start_at,
          scheduled_end_at: row.scheduled_end_at,
          source_reflection_id: toNullableNumber(row.source_reflection_id),
          created_at: row.created_at,
          updated_at: row.updated_at,
          raw_payload: {
            source_reflection_id: toNullableNumber(row.source_reflection_id),
            source_plan_id: toNullableNumber(row.source_plan_id),
            plan_metadata_json: typeof row.plan_metadata_json === 'string'
              ? (() => {
                  try {
                    return JSON.parse(row.plan_metadata_json);
                  } catch {
                    return row.plan_metadata_json;
                  }
                })()
              : row.plan_metadata_json
          }
        };
      });

      res.json({
        success: true,
        data: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch cognition plans', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch cognition plans',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/cognition/relationships', async (req, res) => {
    try {
      const page = parsePage(req.query.page);
      const limit = parseLimit(req.query.limit);

      if (!(await tableExists(database, 'agent_relationship_memories'))) {
        res.json({
          success: true,
          data: [],
          pagination: emptyPagination(page, limit),
          timestamp: new Date().toISOString()
        });
        return;
      }

      const offset = (page - 1) * limit;
      const scope = normalizeMemoryScope(req.query.scope);
      const search = normalizeSearch(req.query.search);
      const whereClauses: string[] = [];
      const params: any[] = [];

      if (scope === 'private') {
        whereClauses.push(`group_id IS NULL`);
      } else if (scope === 'group') {
        whereClauses.push(`group_id IS NOT NULL`);
      }

      if (search) {
        const pattern = likePattern(search);
        whereClauses.push(`(
          CAST(target_user_id AS CHAR) LIKE ?
          OR CAST(group_id AS CHAR) LIKE ?
          OR relationship_summary LIKE ?
          OR interaction_style LIKE ?
          OR boundary_notes LIKE ?
          OR boundary_strategy LIKE ?
        )`);
        params.push(pattern, pattern, pattern, pattern, pattern, pattern);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const total = await countRows(database, 'agent_relationship_memories', whereSql, params);
      const rows = await database.executeQuery<any>(
        `
          SELECT *
          FROM agent_relationship_memories
          ${whereSql}
          ORDER BY is_current DESC, updated_at DESC, id DESC
          LIMIT ${limit} OFFSET ${offset}
        `,
        params
      );

      res.json({
        success: true,
        data: rows.map(row => ({
          id: `relationship:${row.id}`,
          record_id: row.id,
          scope_type: row.group_id !== null && row.group_id !== undefined ? 'group_context' : 'private_user',
          target_label: row.group_id !== null && row.group_id !== undefined
            ? `用户${row.target_user_id} / 群组${row.group_id}`
            : `用户${row.target_user_id}`,
          target_user_id: toNullableNumber(row.target_user_id),
          target_group_id: toNullableNumber(row.group_id),
          field_scope: row.field_scope ?? null,
          relationship_summary: row.relationship_summary,
          interaction_style: row.interaction_style ?? null,
          boundary_notes: row.boundary_notes ?? null,
          boundary_strategy: row.boundary_strategy ?? null,
          confidence: Number(row.confidence),
          status: row.status,
          is_current: Boolean(row.is_current),
          source_reflection_id: toNullableNumber(row.source_reflection_id),
          last_evidence_id: toNullableNumber(row.last_evidence_id),
          last_observed_at: row.last_observed_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
          raw_payload: typeof row.notes_json === 'string'
            ? (() => {
                try {
                  return JSON.parse(row.notes_json);
                } catch {
                  return row.notes_json;
                }
              })()
            : row.notes_json
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch cognition relationships', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch cognition relationships',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.patch('/cognition/relationships/:id', async (req, res) => {
    try {
      const relationshipId = parsePositiveId(req.params.id, 'relationship id');
      const reason = parseReason(req.body?.reason);
      const previewOnly = parsePreviewOnly(req.body?.preview_only);
      const patch = parsePatchObject(req.body?.patch);

      if (!(await tableExists(database, 'agent_relationship_memories'))) {
        res.status(404).json({
          success: false,
          error: 'Relationship table is not available',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const rows = await database.executeQuery<any>(
        `SELECT * FROM agent_relationship_memories WHERE id = ? LIMIT 1`,
        [relationshipId]
      );
      const before = rows[0];
      if (!before) {
        res.status(404).json({
          success: false,
          error: 'Relationship not found',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const after = {
        ...before,
        relationship_summary: parseOptionalString(patch.relationship_summary, 'patch.relationship_summary') ?? before.relationship_summary,
        interaction_style: patch.interaction_style === undefined
          ? before.interaction_style
          : parseOptionalString(patch.interaction_style, 'patch.interaction_style'),
        boundary_notes: patch.boundary_notes === undefined
          ? before.boundary_notes
          : parseOptionalString(patch.boundary_notes, 'patch.boundary_notes'),
        confidence: parseOptionalNumber(patch.confidence, 'patch.confidence') ?? Number(before.confidence),
        boundary_strategy: parseBoundaryStrategy(patch.boundary_strategy) ?? before.boundary_strategy,
        status: 'active',
        is_current: 1
      };
      const nextNotesJson = {
        ...(parseJsonValue<Record<string, unknown>>(before.notes_json) || {}),
        manual_override: true,
        manual_override_reason: reason,
        manual_override_at: new Date().toISOString(),
        manual_override_operator: 'qqbot-admin'
      };

      const affectedPlanIds = await findAffectedPlanIds(database, {
        subjectType: 'user',
        subjectId: before.target_user_id,
        groupId: toNullableNumber(before.group_id)
      });
      const impactSummary = buildImpactSummary('relationship', affectedPlanIds, previewOnly ? 'preview' : 'commit');

      if (previewOnly) {
        res.json({
          success: true,
          data: {
            before,
            after,
            impact_summary: impactSummary,
            affected_plan_ids: affectedPlanIds
          },
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (isReadOnlyDemoMode()) {
        res.status(403).json({
          success: false,
          error: 'Demo mode is read-only',
          message: '当前是 demo 只读模式，仅允许 preview，不允许 commit。',
          timestamp: new Date().toISOString()
        });
        return;
      }

      await database.executeUpdate(
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
        [before.target_user_id, toNullableNumber(before.group_id)]
      );

      const insertResult = await database.executeInsert(
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
          before.target_user_id,
          before.field_scope ?? null,
          toNullableNumber(before.group_id),
          after.relationship_summary,
          after.interaction_style ?? null,
          after.boundary_notes ?? null,
          after.confidence,
          toNullableNumber(before.source_reflection_id),
          toNullableNumber(before.last_evidence_id),
          before.last_observed_at,
          after.boundary_strategy ?? null,
          JSON.stringify(nextNotesJson)
        ]
      );

      const nextRelationshipId = Number(insertResult.insertId);
      const editResult = await database.executeInsert(
        `
          INSERT INTO agent_cognition_edits (
            entity_type,
            entity_id,
            action_type,
            reason,
            before_json,
            after_json,
            impact_json,
            operator_id
          ) VALUES ('relationship', ?, 'patch', ?, ?, ?, ?, 'qqbot-admin')
        `,
        [
          nextRelationshipId,
          reason,
          JSON.stringify(before),
          JSON.stringify({ ...after, id: nextRelationshipId }),
          JSON.stringify({
            impact_summary: impactSummary,
            affected_plan_ids: affectedPlanIds
          })
        ]
      );

      const recompute = await triggerCognitionRecompute({
        subjectType: 'user',
        subjectId: before.target_user_id,
        groupId: toNullableNumber(before.group_id)
      });

      res.json({
        success: true,
        data: {
          before,
          after: { ...after, id: nextRelationshipId },
          impact_summary: impactSummary,
          affected_plan_ids: affectedPlanIds,
          edit_id: Number(editResult.insertId),
          recompute
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to patch cognition relationship';
      logger.error('Failed to patch cognition relationship', { error: message });
      res.status(message.includes('required') || message.includes('must') ? 400 : 500).json({
        success: false,
        error: 'Failed to patch cognition relationship',
        message,
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/cognition/edits', async (req, res) => {
    try {
      const page = parsePage(req.query.page);
      const limit = parseLimit(req.query.limit);

      if (!(await tableExists(database, 'agent_cognition_edits'))) {
        res.json({
          success: true,
          data: [],
          pagination: emptyPagination(page, limit),
          timestamp: new Date().toISOString()
        });
        return;
      }

      const offset = (page - 1) * limit;
      const search = normalizeSearch(req.query.search);
      const whereClauses: string[] = [];
      const params: any[] = [];

      if (search) {
        const pattern = likePattern(search);
        whereClauses.push(`(
          entity_type LIKE ?
          OR CAST(entity_id AS CHAR) LIKE ?
          OR action_type LIKE ?
          OR reason LIKE ?
          OR operator_id LIKE ?
        )`);
        params.push(pattern, pattern, pattern, pattern, pattern);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const total = await countRows(database, 'agent_cognition_edits', whereSql, params);
      const rows = await database.executeQuery<any>(
        `
          SELECT *
          FROM agent_cognition_edits
          ${whereSql}
          ORDER BY created_at DESC, id DESC
          LIMIT ${limit} OFFSET ${offset}
        `,
        params
      );

      res.json({
        success: true,
        data: rows.map(row => ({
          id: `edit:${row.id}`,
          record_id: row.id,
          entity_type: row.entity_type,
          entity_id: toNullableNumber(row.entity_id),
          action_type: row.action_type,
          reason: row.reason,
          operator_id: row.operator_id,
          before_json: typeof row.before_json === 'string'
            ? (() => {
                try {
                  return JSON.parse(row.before_json);
                } catch {
                  return row.before_json;
                }
              })()
            : row.before_json,
          after_json: typeof row.after_json === 'string'
            ? (() => {
                try {
                  return JSON.parse(row.after_json);
                } catch {
                  return row.after_json;
                }
              })()
            : row.after_json,
          impact_json: typeof row.impact_json === 'string'
            ? (() => {
                try {
                  return JSON.parse(row.impact_json);
                } catch {
                  return row.impact_json;
                }
              })()
            : row.impact_json,
          created_at: row.created_at
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch cognition edits', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch cognition edits',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/cognition/fields', async (req, res) => {
    try {
      const page = parsePage(req.query.page);
      const limit = parseLimit(req.query.limit);

      if (!(await tableExists(database, 'agent_social_fields')) || !(await tableExists(database, 'agent_field_scores'))) {
        res.json({
          success: true,
          data: [],
          pagination: emptyPagination(page, limit),
          timestamp: new Date().toISOString()
        });
        return;
      }

      const offset = (page - 1) * limit;
      const search = normalizeSearch(req.query.search);
      const whereClauses: string[] = [];
      const params: any[] = [];

      if (search) {
        const pattern = likePattern(search);
        whereClauses.push(`(
          f.field_key LIKE ?
          OR f.title LIKE ?
          OR CAST(f.user_id AS CHAR) LIKE ?
          OR CAST(f.group_id AS CHAR) LIKE ?
          OR s.suppression_reason LIKE ?
        )`);
        params.push(pattern, pattern, pattern, pattern, pattern);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const totalRows = await database.executeQuery<{ total: number }>(
        `
          SELECT COUNT(*) AS total
          FROM agent_social_fields f
          LEFT JOIN (
            SELECT ranked.*
            FROM agent_field_scores ranked
            INNER JOIN (
              SELECT field_key, MAX(computed_at) AS computed_at
              FROM agent_field_scores
              GROUP BY field_key
            ) latest
              ON latest.field_key = ranked.field_key
             AND latest.computed_at = ranked.computed_at
          ) s ON s.field_key = f.field_key
          ${whereSql}
        `,
        params
      );
      const total = totalRows[0]?.total || 0;
      const rows = await database.executeQuery<any>(
        `
          SELECT
            f.*,
            s.priority_score,
            s.inbound_score,
            s.relationship_score,
            s.plan_score,
            s.novelty_score,
            s.cooldown_penalty,
            s.boundary_penalty,
            s.suppression_reason,
            s.explanation_json,
            s.computed_at
          FROM agent_social_fields f
          LEFT JOIN (
            SELECT ranked.*
            FROM agent_field_scores ranked
            INNER JOIN (
              SELECT field_key, MAX(computed_at) AS computed_at
              FROM agent_field_scores
              GROUP BY field_key
            ) latest
              ON latest.field_key = ranked.field_key
             AND latest.computed_at = ranked.computed_at
          ) s ON s.field_key = f.field_key
          ${whereSql}
          ORDER BY COALESCE(s.priority_score, 0) DESC, f.last_active_at DESC, f.id DESC
          LIMIT ${limit} OFFSET ${offset}
        `,
        params
      );

      res.json({
        success: true,
        data: rows.map(row => ({
          id: `field:${row.field_key}`,
          field_key: row.field_key,
          field_scope: row.field_scope,
          title: row.title,
          status: row.status,
          user_id: toNullableNumber(row.user_id),
          group_id: toNullableNumber(row.group_id),
          thread_key: row.thread_key ?? null,
          last_active_at: row.last_active_at,
          priority_score: Number(row.priority_score || 0),
          inbound_score: Number(row.inbound_score || 0),
          relationship_score: Number(row.relationship_score || 0),
          plan_score: Number(row.plan_score || 0),
          novelty_score: Number(row.novelty_score || 0),
          cooldown_penalty: Number(row.cooldown_penalty || 0),
          boundary_penalty: Number(row.boundary_penalty || 0),
          suppression_reason: row.suppression_reason ?? null,
          computed_at: row.computed_at ?? null,
          raw_payload: typeof row.explanation_json === 'string'
            ? (() => {
                try {
                  return JSON.parse(row.explanation_json);
                } catch {
                  return row.explanation_json;
                }
              })()
            : row.explanation_json
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch cognition fields', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch cognition fields',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/cognition/candidates', async (req, res) => {
    try {
      const page = parsePage(req.query.page);
      const limit = parseLimit(req.query.limit);

      if (!(await tableExists(database, 'agent_walk_candidates'))) {
        res.json({
          success: true,
          data: [],
          pagination: emptyPagination(page, limit),
          timestamp: new Date().toISOString()
        });
        return;
      }

      const offset = (page - 1) * limit;
      const search = normalizeSearch(req.query.search);
      const whereClauses: string[] = [];
      const params: any[] = [];

      if (search) {
        const pattern = likePattern(search);
        whereClauses.push(`(
          c.field_key LIKE ?
          OR c.selected_reason LIKE ?
          OR c.suppressed_reason LIKE ?
          OR CAST(c.target_user_id AS CHAR) LIKE ?
          OR CAST(c.target_group_id AS CHAR) LIKE ?
        )`);
        params.push(pattern, pattern, pattern, pattern, pattern);
      }

      const latestComputedAtRows = await database.executeQuery<any>(
        `SELECT MAX(computed_at) AS computed_at FROM agent_walk_candidates`
      );
      const latestComputedAt = latestComputedAtRows[0]?.computed_at ?? null;
      if (!latestComputedAt) {
        res.json({
          success: true,
          data: [],
          pagination: emptyPagination(page, limit),
          timestamp: new Date().toISOString()
        });
        return;
      }

      whereClauses.unshift(`c.computed_at = ?`);
      params.unshift(latestComputedAt);
      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;
      const totalRows = await database.executeQuery<{ total: number }>(
        `SELECT COUNT(*) AS total FROM agent_walk_candidates c ${whereSql}`,
        params
      );
      const total = totalRows[0]?.total || 0;
      const rows = await database.executeQuery<any>(
        `
          SELECT *
          FROM agent_walk_candidates c
          ${whereSql}
          ORDER BY c.priority_score DESC, c.id ASC
          LIMIT ${limit} OFFSET ${offset}
        `,
        params
      );

      res.json({
        success: true,
        data: rows.map(row => ({
          id: `candidate:${row.id}`,
          record_id: toNullableNumber(row.id),
          field_key: row.field_key,
          field_scope: row.field_scope,
          target_user_id: toNullableNumber(row.target_user_id),
          target_group_id: toNullableNumber(row.target_group_id),
          priority_score: Number(row.priority_score || 0),
          selected_reason: row.selected_reason,
          suppressed_reason: row.suppressed_reason ?? null,
          can_speak_now: Boolean(row.can_speak_now),
          source_relationship_id: toNullableNumber(row.source_relationship_id),
          source_plan_ids: parseJsonArray<number>(row.source_plan_ids_json),
          source_memory_ids: parseJsonArray<number>(row.source_memory_ids_json),
          source_belief_ids: parseJsonArray<number>(row.source_belief_ids_json),
          trigger_sources: parseJsonArray<string>(row.trigger_sources_json),
          compiler_inputs: parseJsonValue(row.compiler_inputs_json),
          computed_at: row.computed_at,
          created_at: row.created_at
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch cognition candidates', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch cognition candidates',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/cognition/fields/:fieldKey', async (req, res) => {
    try {
      const fieldKey = String(req.params.fieldKey || '').trim();
      if (!fieldKey) {
        res.status(400).json({
          success: false,
          error: 'fieldKey is required',
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (!(await tableExists(database, 'agent_social_fields'))) {
        res.status(404).json({
          success: false,
          error: 'Field graph is not available',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const [fieldRows, scoreRows, edgeRows, candidateRows] = await Promise.all([
        database.executeQuery<any>(
          `SELECT * FROM agent_social_fields WHERE field_key = ? LIMIT 1`,
          [fieldKey]
        ),
        tableExists(database, 'agent_field_scores').then((exists) => exists
          ? database.executeQuery<any>(
              `
                SELECT *
                FROM agent_field_scores
                WHERE field_key = ?
                ORDER BY computed_at DESC, id DESC
                LIMIT 5
              `,
              [fieldKey]
            )
          : Promise.resolve([])),
        tableExists(database, 'agent_social_edges').then((exists) => exists
          ? database.executeQuery<any>(
              `
                SELECT *
                FROM agent_social_edges
                WHERE source_field_key = ?
                   OR target_field_key = ?
                ORDER BY weight DESC, updated_at DESC, id DESC
                LIMIT 20
              `,
              [fieldKey, fieldKey]
            )
          : Promise.resolve([])),
        tableExists(database, 'agent_walk_candidates').then((exists) => exists
          ? database.executeQuery<any>(
              `
                SELECT *
                FROM agent_walk_candidates
                WHERE field_key = ?
                ORDER BY computed_at DESC, priority_score DESC, id DESC
                LIMIT 5
              `,
              [fieldKey]
            )
          : Promise.resolve([]))
      ]);

      if (!fieldRows[0]) {
        res.status(404).json({
          success: false,
          error: 'Field not found',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const field = fieldRows[0];
      const [actionRows, feedbackRows] = await Promise.all([
        tableExists(database, 'agent_action_logs').then((exists) => exists
          ? database.executeQuery<any>(
              `
                SELECT *
                FROM agent_action_logs
                WHERE (target_user_id <=> ? AND ? IS NOT NULL)
                   OR (target_group_id <=> ? AND ? IS NOT NULL)
                ORDER BY occurred_at DESC, id DESC
                LIMIT 8
              `,
              [
                toNullableNumber(field.user_id),
                toNullableNumber(field.user_id),
                toNullableNumber(field.group_id),
                toNullableNumber(field.group_id)
              ]
            )
          : Promise.resolve([])),
        tableExists(database, 'agent_feedback_events').then((exists) => exists
          ? database.executeQuery<any>(
              `
                SELECT *
                FROM agent_feedback_events
                WHERE field_key = ?
                ORDER BY occurred_at DESC, id DESC
                LIMIT 8
              `,
              [fieldKey]
            )
          : Promise.resolve([]))
      ]);

      res.json({
        success: true,
        data: {
          field,
          scores: scoreRows.map(row => ({
            ...row,
            explanation_json: typeof row.explanation_json === 'string'
              ? (() => {
                  try {
                    return JSON.parse(row.explanation_json);
                  } catch {
                    return row.explanation_json;
                  }
                })()
              : row.explanation_json
          })),
          edges: edgeRows
            ,
          candidates: candidateRows.map(row => ({
            ...row,
            source_plan_ids_json: parseJsonArray<number>(row.source_plan_ids_json),
            source_memory_ids_json: parseJsonArray<number>(row.source_memory_ids_json),
            source_belief_ids_json: parseJsonArray<number>(row.source_belief_ids_json),
            trigger_sources_json: parseJsonArray<string>(row.trigger_sources_json),
            compiler_inputs_json: parseJsonValue(row.compiler_inputs_json)
          })),
          recent_action_logs: actionRows.map(row => ({
            id: toNullableNumber(row.id),
            action_type: row.action_type,
            trigger_kind: row.trigger_kind ?? null,
            source_plan_id: toNullableNumber(row.source_plan_id),
            target_user_id: toNullableNumber(row.target_user_id),
            target_group_id: toNullableNumber(row.target_group_id),
            payload_json: parseJsonValue(row.payload_json),
            status: row.status,
            occurred_at: row.occurred_at,
            created_at: row.created_at
          })),
          recent_feedback_events: feedbackRows.map(row => ({
            id: toNullableNumber(row.id),
            field_key: row.field_key,
            target_user_id: toNullableNumber(row.target_user_id),
            target_group_id: toNullableNumber(row.target_group_id),
            source_action_log_id: toNullableNumber(row.source_action_log_id),
            judgement: row.judgement,
            reason_code: row.reason_code,
            explanation_json: parseJsonValue(row.explanation_json),
            llm_trace_id: row.llm_trace_id ?? null,
            occurred_at: row.occurred_at,
            created_at: row.created_at
          }))
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch cognition field detail', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch cognition field detail',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
}

export default createCognitionRoutes;

import express from 'express';
import axios from 'axios';
import winston from 'winston';
import {
  getXiaoniActionStream,
  getXiaoniActivityFeed,
  findXiaoniReplayEventByEventId,
  listAgentMediaAssets,
  listAgentTasks,
} from '@qq-bot/persistence';
import { DatabaseManager } from '../services/database';
import { buildConversationTracePayload, buildConversationTraceSpanDetail } from '../services/trace-span-builder';

const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || 'http://qqbot-agent-service:8092';
const AGENT_REQUEST_TIMEOUT_MS = 5000;

type AgentProbeResult =
  | {
      ok: true;
      statusCode: number;
      payload: Record<string, unknown>;
      error?: never;
    }
  | {
      ok: false;
      statusCode: number | null;
      payload?: never;
      error: string;
    };

type ActionEventTraceTarget = {
  conversationId: string;
  traceId: string | null;
  spanId: string | null;
};

type ReplayEventProjection = {
  eventId: string;
  eventKind: string;
  source: string;
  traceId: string | null;
  conversationId: string | null;
  internalExecutionLeaseId: string | null;
  providerCallId: string | null;
  replayable: boolean;
  metadata: Record<string, unknown>;
};

async function probeAgentService(): Promise<AgentProbeResult> {
  return axios
    .get(`${AGENT_SERVICE_URL}/health`, {
      timeout: AGENT_REQUEST_TIMEOUT_MS,
      validateStatus: () => true
    })
    .then<AgentProbeResult>((response) => {
      if (response.status >= 200 && response.status < 300) {
        return {
          ok: true,
          statusCode: response.status,
          payload: response.data && typeof response.data === 'object'
            ? response.data as Record<string, unknown>
            : {}
        };
      }

      return {
        ok: false,
        statusCode: response.status,
        error: `agent-service health check returned HTTP ${response.status}`
      };
    })
    .catch<AgentProbeResult>((error) => ({
      ok: false,
      statusCode: null,
      error: error instanceof Error ? error.message : 'Unknown agent-service health check error'
    }));
}

function decodeEventId(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function resolveConversationIdFromTrace(
  database: DatabaseManager,
  traceId: string | null | undefined,
  runId: string | null | undefined
): Promise<string | null> {
  if (runId) {
    const rows = await database.executeQuery<{ conversation_id: number | string | null }>(
      'SELECT conversation_id FROM agent_runs WHERE id = ? LIMIT 1',
      [runId]
    );
    const conversationId = rows[0]?.conversation_id;
    if (conversationId) {
      return String(conversationId);
    }
  }

  if (traceId) {
    const rows = await database.executeQuery<{ id: number | string }>(
      'SELECT id FROM conversations WHERE trace_id = ? ORDER BY id DESC LIMIT 1',
      [traceId]
    );
    if (rows[0]?.id) {
      return String(rows[0].id);
    }
  }

  return null;
}

async function resolveActionEventTraceTarget(
  database: DatabaseManager,
  rawEventId: string
): Promise<ActionEventTraceTarget | null> {
  const eventId = decodeEventId(rawEventId);
  const replayEvent = await findXiaoniReplayEventByEventId(eventId) as ReplayEventProjection | null;
  if (replayEvent) {
    if (!replayEvent.replayable || replayEvent.source !== 'codex_provider') {
      return null;
    }
    const conversationId = replayEvent.conversationId
      || await resolveConversationIdFromTrace(database, replayEvent.traceId, replayEvent.internalExecutionLeaseId);
    if (!conversationId) {
      return null;
    }
    const metadata = replayEvent.metadata && typeof replayEvent.metadata === 'object'
      ? replayEvent.metadata
      : {};
    const spanId = typeof metadata.spanId === 'string' && metadata.spanId.trim()
      ? metadata.spanId.trim()
      : replayEvent.providerCallId
        ? `provider-request:wire:${replayEvent.providerCallId}`
        : replayEvent.eventId;
    return {
      conversationId,
      traceId: replayEvent.traceId || null,
      spanId
    };
  }

  return null;
}

export function createAgentRuntimeRoutes(database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();

  async function loadRuntimeSnapshot() {
    const agentProbe = await probeAgentService();
    const agentPayload = agentProbe.ok ? agentProbe.payload : {};
    return {
      live: agentProbe.ok,
      status: agentProbe.ok ? agentPayload.status || 'unknown' : 'offline',
      service: agentProbe.ok ? agentPayload.service || 'agent-service' : 'agent-service',
      workerBusy: Boolean(agentPayload.worker_busy),
      taskWorkerBusy: Boolean(agentPayload.task_worker_busy),
      presenceTickBusy: Boolean(agentPayload.presence_tick_busy),
      timestamp: typeof agentPayload.timestamp === 'string' ? agentPayload.timestamp : null,
      url: AGENT_SERVICE_URL,
      healthStatusCode: agentProbe.statusCode,
      errorMessage: agentProbe.ok ? null : agentProbe.error
    };
  }

  router.get('/xiaoni/action-stream', async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(200, Number.parseInt(String(req.query.limit || '80'), 10) || 80));
      const identityKey = typeof req.query.identity_key === 'string' && req.query.identity_key.trim()
        ? req.query.identity_key.trim()
        : 'xiaoni';
      const [stream, runtime] = await Promise.all([
        getXiaoniActionStream({ identityKey, limit }),
        loadRuntimeSnapshot()
      ]);

      res.json({
        success: true,
        data: {
          ...stream,
          current: {
            ...stream.current,
            runtime
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load Xiaoni action stream',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/xiaoni/action-stream/events/:eventId/trace', async (req, res) => {
    try {
      const target = await resolveActionEventTraceTarget(database, req.params.eventId);
      if (!target) {
        return res.status(404).json({
          success: false,
          error: 'Action event trace not found',
          timestamp: new Date().toISOString()
        });
      }

      const payload = await buildConversationTracePayload(database, logger, target.conversationId);
      if (!payload) {
        return res.status(404).json({
          success: false,
          error: 'Action event trace not available yet',
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        data: {
          ...payload,
          action_event: {
            event_id: decodeEventId(req.params.eventId),
            focus_span_id: target.spanId,
            trace_id: target.traceId
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch Xiaoni action event trace', { error, eventId: req.params.eventId });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch Xiaoni action event trace',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/xiaoni/action-stream/events/:eventId/trace/spans/:spanId/detail', async (req, res) => {
    try {
      const target = await resolveActionEventTraceTarget(database, req.params.eventId);
      if (!target) {
        return res.status(404).json({
          success: false,
          error: 'Action event trace not found',
          timestamp: new Date().toISOString()
        });
      }

      const spanId = decodeEventId(req.params.spanId);
      const detail = await buildConversationTraceSpanDetail(database, logger, target.conversationId, spanId);
      if (!detail) {
        return res.status(404).json({
          success: false,
          error: 'Action event trace span detail not found',
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        data: detail,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to fetch Xiaoni action event trace span detail', {
        error,
        eventId: req.params.eventId,
        spanId: req.params.spanId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch Xiaoni action event trace span detail',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/agent-runtime/activity-feed', async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(200, Number.parseInt(String(req.query.limit || '80'), 10) || 80));
      const identityKey = typeof req.query.identity_key === 'string' && req.query.identity_key.trim()
        ? req.query.identity_key.trim()
        : 'xiaoni';
      const [feed, runtime] = await Promise.all([
        getXiaoniActivityFeed({ identityKey, limit }),
        loadRuntimeSnapshot()
      ]);

      res.json({
        success: true,
        data: {
          ...feed,
          current: {
            ...feed.current,
            runtime
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load Xiaoni activity feed',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/agent-runtime/tasks', async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(100, Number.parseInt(String(req.query.limit || '30'), 10) || 30));
      const status = typeof req.query.status === 'string' && req.query.status.trim()
        ? req.query.status.trim()
        : undefined;
      const sessionKey = typeof req.query.session_key === 'string' && req.query.session_key.trim()
        ? req.query.session_key.trim()
        : undefined;
      const tasks = await listAgentTasks({ limit, status, sessionKey });
      res.json({
        success: true,
        data: tasks,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list agent tasks',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/agent-runtime/media-assets', async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(100, Number.parseInt(String(req.query.limit || '30'), 10) || 30));
      const sessionKey = typeof req.query.session_key === 'string' && req.query.session_key.trim()
        ? req.query.session_key.trim()
        : undefined;
      const mediaTag = typeof req.query.media_tag === 'string' && req.query.media_tag.trim()
        ? req.query.media_tag.trim()
        : undefined;
      const assets = await listAgentMediaAssets({ limit, sessionKey, mediaTag });
      res.json({
        success: true,
        data: assets,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list agent media assets',
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
}

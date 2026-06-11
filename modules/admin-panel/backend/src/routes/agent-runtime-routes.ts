import express from 'express';
import axios from 'axios';
import winston from 'winston';
import {
  getXiaoniActionStream,
  getXiaoniActivityFeed,
  findXiaoniActionEventTraceTarget,
  getAgentRuntimeControl,
  listAgentMediaAssets,
  listAgentTasks,
  updateAgentRuntimeControl,
} from '@qq-bot/persistence';
import { DatabaseManager } from '../services/database';
import {
  buildConversationTracePayload,
  buildConversationTraceSpanDetail,
  buildStackTracePayload,
  buildStackTraceSpanDetail
} from '../services/trace-span-builder';

const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || 'http://qqbot-agent-service:8092';
const AGENT_REQUEST_TIMEOUT_MS = 5000;
const ACTION_STREAM_RANGE_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000
};

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
  conversationId: string | null;
  traceId: string | null;
  spanId: string | null;
  internalExecutionLeaseId?: string | null;
  llmRequestSliceId?: string | null;
  toolCallId?: string | null;
  stackItemId?: string | null;
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

function firstQueryString(value: unknown): string | null {
  if (Array.isArray(value)) {
    return firstQueryString(value[0]);
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseQueryDate(value: unknown): Date | null {
  const raw = firstQueryString(value);
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveActionStreamTimeFilter(query: express.Request['query']) {
  const range = firstQueryString(query.range) || 'all';
  if (Object.prototype.hasOwnProperty.call(ACTION_STREAM_RANGE_MS, range)) {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - ACTION_STREAM_RANGE_MS[range]);
    return {
      range,
      startTime,
      endTime
    };
  }

  const startTime = parseQueryDate(query.start_time ?? query.startTime);
  const endTime = parseQueryDate(query.end_time ?? query.endTime);
  return {
    range: range === 'custom' ? 'custom' : 'all',
    startTime,
    endTime
  };
}

function serializeActionStreamTimeFilter(filter: ReturnType<typeof resolveActionStreamTimeFilter>) {
  return {
    range: filter.range,
    startTime: filter.startTime ? filter.startTime.toISOString() : null,
    endTime: filter.endTime ? filter.endTime.toISOString() : null
  };
}

async function resolveActionEventTraceTarget(
  rawEventId: string
): Promise<ActionEventTraceTarget | null> {
  const eventId = decodeEventId(rawEventId);
  return await findXiaoniActionEventTraceTarget(eventId) as ActionEventTraceTarget | null;
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
      runtimeEnabled: agentPayload.runtime_enabled !== false,
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
      const timeFilter = resolveActionStreamTimeFilter(req.query);
      const [stream, runtime] = await Promise.all([
        getXiaoniActionStream({
          identityKey,
          limit,
          startTime: timeFilter.startTime,
          endTime: timeFilter.endTime
        }),
        loadRuntimeSnapshot()
      ]);

      res.json({
        success: true,
        data: {
          ...stream,
          filters: {
            ...(typeof stream === 'object' && stream && 'filters' in stream ? (stream as Record<string, unknown>).filters as Record<string, unknown> : {}),
            ...serializeActionStreamTimeFilter(timeFilter)
          },
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
      const target = await resolveActionEventTraceTarget(req.params.eventId);
      if (!target) {
        return res.status(404).json({
          success: false,
          error: 'Action event trace not found',
          timestamp: new Date().toISOString()
        });
      }

      const payload = target.conversationId
        ? await buildConversationTracePayload(database, logger, target.conversationId)
        : await buildStackTracePayload(logger, target);
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
      const target = await resolveActionEventTraceTarget(req.params.eventId);
      if (!target) {
        return res.status(404).json({
          success: false,
          error: 'Action event trace not found',
          timestamp: new Date().toISOString()
        });
      }

      const spanId = decodeEventId(req.params.spanId);
      const detail = target.conversationId
        ? await buildConversationTraceSpanDetail(database, logger, target.conversationId, spanId)
        : await buildStackTraceSpanDetail(logger, target, spanId);
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

  router.get('/agent-runtime/control', async (_req, res) => {
    try {
      const control = await getAgentRuntimeControl({ identityKey: 'xiaoni' });
      res.json({
        success: true,
        data: control,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load Xiaoni runtime control',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.patch('/agent-runtime/control', async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body as Record<string, unknown>
        : {};
      const control = await updateAgentRuntimeControl({
        identityKey: 'xiaoni',
        enabled: body.enabled !== false
      });
      res.json({
        success: true,
        data: control,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update Xiaoni runtime control',
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
      const timeFilter = resolveActionStreamTimeFilter(req.query);
      const [feed, runtime] = await Promise.all([
        getXiaoniActivityFeed({
          identityKey,
          limit,
          startTime: timeFilter.startTime,
          endTime: timeFilter.endTime
        }),
        loadRuntimeSnapshot()
      ]);

      res.json({
        success: true,
        data: {
          ...feed,
          filters: {
            ...(typeof feed === 'object' && feed && 'filters' in feed ? (feed as Record<string, unknown>).filters as Record<string, unknown> : {}),
            ...serializeActionStreamTimeFilter(timeFilter)
          },
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

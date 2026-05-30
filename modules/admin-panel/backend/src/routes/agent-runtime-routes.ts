import express from 'express';
import axios from 'axios';
import {
  getXiaoniActivityFeed,
  listAgentMediaAssets,
  listAgentTasks,
} from '@qq-bot/persistence';
import { DatabaseManager } from '../services/database';

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

export function createAgentRuntimeRoutes(_database: DatabaseManager) {
  const router = express.Router();

  router.get('/agent-runtime/activity-feed', async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(200, Number.parseInt(String(req.query.limit || '80'), 10) || 80));
      const identityKey = typeof req.query.identity_key === 'string' && req.query.identity_key.trim()
        ? req.query.identity_key.trim()
        : 'xiaoni';
      const [feed, agentProbe] = await Promise.all([
        getXiaoniActivityFeed({ identityKey, limit }),
        probeAgentService()
      ]);
      const agentPayload = agentProbe.ok ? agentProbe.payload : {};

      res.json({
        success: true,
        data: {
          ...feed,
          current: {
            ...feed.current,
            runtime: {
              live: agentProbe.ok,
              status: agentProbe.ok ? agentPayload.status || 'unknown' : 'offline',
              service: agentProbe.ok ? agentPayload.service || 'agent-service' : 'agent-service',
              workerBusy: Boolean(agentPayload.worker_busy),
              taskWorkerBusy: Boolean(agentPayload.task_worker_busy),
              presenceTickBusy: Boolean(agentPayload.presence_tick_busy),
              selfActionBusy: Boolean(agentPayload.self_action_busy),
              timestamp: typeof agentPayload.timestamp === 'string' ? agentPayload.timestamp : null,
              url: AGENT_SERVICE_URL,
              healthStatusCode: agentProbe.statusCode,
              errorMessage: agentProbe.ok ? null : agentProbe.error
            }
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

import express from 'express';
import {
  listAgentMediaAssets,
  listAgentTasks,
} from '@qq-bot/persistence';
import { DatabaseManager } from '../services/database';

export function createAgentRuntimeRoutes(_database: DatabaseManager) {
  const router = express.Router();

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

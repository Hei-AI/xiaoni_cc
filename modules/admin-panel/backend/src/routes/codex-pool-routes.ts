import express from 'express';
import winston from 'winston';
import { DatabaseManager } from '../services/database';
import {
  activateCodexAccount,
  completeCodexLogin,
  createCodexLoginSession,
  getCodexAccountsStatus,
  listCodexAccounts,
  removeCodexAccount,
  refreshCodexAccount,
  setCodexAccountEnabled
} from '../services/codex-pool-service';

export function createCodexPoolRoutes(_database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();

  router.get('/codex-pool/status', async (_req, res) => {
    try {
      res.json(await getCodexAccountsStatus());
    } catch (error) {
      logger.error('Failed to load codex accounts status', { error });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load codex accounts status',
        timestamp: new Date().toISOString(),
      });
    }
  });

  router.get('/codex-pool/accounts', async (_req, res) => {
    try {
      res.json(await listCodexAccounts());
    } catch (error) {
      logger.error('Failed to list codex accounts', { error });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list codex accounts',
        timestamp: new Date().toISOString(),
      });
    }
  });

  router.post('/codex-pool/login-session', async (req, res) => {
    try {
      const redirectUri = typeof req.body?.redirectUri === 'string' ? req.body.redirectUri.trim() : undefined;
      const replaceAccountId = typeof req.body?.replaceAccountId === 'string' ? req.body.replaceAccountId.trim() : undefined;
      res.json(await createCodexLoginSession(redirectUri, replaceAccountId));
    } catch (error) {
      logger.error('Failed to create codex login session', { error });
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create codex login session',
        timestamp: new Date().toISOString(),
      });
    }
  });

  router.post('/codex-pool/complete-login', async (req, res) => {
    try {
      res.json(await completeCodexLogin({
        callbackUrl: typeof req.body?.callbackUrl === 'string' ? req.body.callbackUrl : undefined,
        code: typeof req.body?.code === 'string' ? req.body.code : undefined,
        state: typeof req.body?.state === 'string' ? req.body.state : undefined
      }));
    } catch (error) {
      logger.error('Failed to complete codex login', { error });
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to complete codex login',
        timestamp: new Date().toISOString(),
      });
    }
  });

  router.post('/codex-pool/accounts/:accountId/activate', async (req, res) => {
    try {
      res.json(await activateCodexAccount(req.params.accountId));
    } catch (error) {
      logger.error('Failed to activate codex account', { error });
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to activate codex account',
        timestamp: new Date().toISOString(),
      });
    }
  });

  router.post('/codex-pool/accounts/:accountId/refresh', async (req, res) => {
    try {
      res.json(await refreshCodexAccount(req.params.accountId));
    } catch (error) {
      logger.error('Failed to refresh codex account', { error });
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to refresh codex account',
        timestamp: new Date().toISOString(),
      });
    }
  });

  router.post('/codex-pool/accounts/:accountId/enabled', async (req, res) => {
    try {
      res.json(await setCodexAccountEnabled(req.params.accountId, req.body?.enabled !== false));
    } catch (error) {
      logger.error('Failed to update codex account status', { error });
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update codex account status',
        timestamp: new Date().toISOString(),
      });
    }
  });

  router.delete('/codex-pool/accounts/:accountId', async (req, res) => {
    try {
      res.json(await removeCodexAccount(req.params.accountId));
    } catch (error) {
      logger.error('Failed to remove codex account', { error });
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove codex account',
        timestamp: new Date().toISOString(),
      });
    }
  });

  return router;
}

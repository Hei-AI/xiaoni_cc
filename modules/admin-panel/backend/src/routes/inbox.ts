import express from 'express';
import axios from 'axios';
import { logger } from '../utils/logger';

const router = express.Router();
const moduleLogger = logger.createModuleLogger('inbox-api');
const PROVIDER_SERVICE_URL = process.env.PROVIDER_SERVICE_URL || 'http://qqbot-provider-service:8090';

const providerClient = axios.create({
  baseURL: PROVIDER_SERVICE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }
});

async function proxyInboxRequest(
  req: express.Request,
  res: express.Response,
  endpoint: string
) {
  try {
    const response = await providerClient.request({
      method: req.method,
      url: endpoint,
      data: req.method === 'GET' ? undefined : req.body,
      params: req.query
    });

    res.status(response.status).json(response.data);
  } catch (error: any) {
    moduleLogger.error('Inbox proxy request failed', {
      endpoint,
      error: error?.message || String(error)
    });

    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }

    res.status(503).json({
      success: false,
      error: 'Provider Service 不可用',
      details: error?.message || 'Unknown proxy failure'
    });
  }
}

router.get('/stats', async (req, res) => {
  await proxyInboxRequest(req, res, '/api/inbox/stats');
});

router.get('/conversations', async (req, res) => {
  await proxyInboxRequest(req, res, '/api/inbox/conversations');
});

router.get('/conversations/:sessionKey/messages', async (req, res) => {
  await proxyInboxRequest(req, res, `/api/inbox/conversations/${encodeURIComponent(req.params.sessionKey)}/messages`);
});

router.post('/messages/claim', async (req, res) => {
  await proxyInboxRequest(req, res, '/api/inbox/messages/claim');
});

router.post('/simulate', async (req, res) => {
  await proxyInboxRequest(req, res, '/api/inbox/simulate');
});

router.get('/health', async (_req, res) => {
  try {
    const [providerHealth, inboxStats] = await Promise.all([
      providerClient
        .get('/health')
        .then((response) => response.data)
        .catch((error) => ({ success: false, error: error.message })),
      providerClient
        .get('/api/inbox/stats')
        .then((response) => response.data)
        .catch((error) => ({ success: false, error: error.message }))
    ]);

    res.json({
      success: true,
      providerService: providerHealth,
      inbox: inboxStats,
      proxyStatus: 'healthy'
    });
  } catch (error: any) {
    moduleLogger.error('Inbox health check failed', {
      error: error?.message || String(error)
    });

    res.status(503).json({
      success: false,
      error: 'Inbox health check failed',
      details: error?.message || 'Unknown health check failure',
      proxyStatus: 'unhealthy'
    });
  }
});

export default router;

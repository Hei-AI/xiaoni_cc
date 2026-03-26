import express from 'express';
import axios from 'axios';
import { logger } from '../utils/logger';

const router = express.Router();
const moduleLogger = logger.createModuleLogger('simple-queue-api');
const PROVIDER_SERVICE_URL = process.env.PROVIDER_SERVICE_URL || 'http://qqbot-provider-service:8090';

const providerClient = axios.create({
  baseURL: PROVIDER_SERVICE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }
});

async function proxySimpleQueueRequest(
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
    moduleLogger.error('Simple queue proxy request failed', {
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
  await proxySimpleQueueRequest(req, res, '/api/simple-queue/stats');
});

router.get('/partitions', async (req, res) => {
  await proxySimpleQueueRequest(req, res, '/api/simple-queue/partitions');
});

router.get('/health', async (req, res) => {
  await proxySimpleQueueRequest(req, res, '/api/simple-queue/health');
});

router.post('/simulate/private', async (req, res) => {
  await proxySimpleQueueRequest(req, res, '/api/simple-queue/simulate/private');
});

router.post('/simulate/group', async (req, res) => {
  await proxySimpleQueueRequest(req, res, '/api/simple-queue/simulate/group');
});

export default router;

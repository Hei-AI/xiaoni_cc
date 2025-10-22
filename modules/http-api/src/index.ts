import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import axios from 'axios';
import { getDatabasePool } from './config/database';
import { FunctionRegistryService } from './services/function-registry-service';
import { createFunctionRoutes } from './routes/function-routes';
import { createPromptRoutes } from './routes/prompt-routes';
import { createInvocationRoutes } from './routes/invocation-routes';
import { logger, createModuleLogger } from './utils/logger';

config();

const app = express();
const PORT = Number(process.env.HTTP_PORT || 8080);
const QQBOT_CORE_URL = process.env.QQBOT_CORE_URL || 'http://qqbot-core:8081';

const moduleLogger = createModuleLogger('bootstrap');

// Core middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Instantiate services
const pool = getDatabasePool();
const functionRegistryService = new FunctionRegistryService(pool);

// Health endpoints
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'qq-bot-http-api',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/status', (_req, res) => {
  res.json({
    service: 'HTTP API Gateway',
    status: 'running',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

// Legacy messaging proxy endpoints
app.post('/api/send_private', async (req, res) => {
  const { user_id, message } = req.body ?? {};

  if (!user_id || !message) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: user_id, message',
      timestamp: new Date().toISOString()
    });
  }

  moduleLogger.info('Forwarding private message request', { userId: user_id });

  try {
    await axios.post(`${QQBOT_CORE_URL}/api/internal/send_private`, { user_id, message }, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'HTTP-API-Gateway'
      }
    });

    res.json({
      success: true,
      message: 'Private message sent successfully via gateway',
      user_id,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    moduleLogger.error('Failed to send private message via gateway', {
      error: error.message,
      userId: user_id
    });

    if (error.code === 'ECONNREFUSED') {
      res.status(503).json({
        success: false,
        error: 'QQBot Core service unavailable',
        timestamp: new Date().toISOString()
      });
    } else if (error.response?.status) {
      res.status(error.response.status).json({
        success: false,
        error: error.response.data?.error || 'Unknown error from QQBot Core',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Gateway internal error',
        timestamp: new Date().toISOString()
      });
    }
  }
});

app.post('/api/send_group', async (req, res) => {
  const { group_id, message } = req.body ?? {};

  if (!group_id || !message) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: group_id, message',
      timestamp: new Date().toISOString()
    });
  }

  moduleLogger.info('Forwarding group message request', { groupId: group_id });

  try {
    await axios.post(`${QQBOT_CORE_URL}/api/internal/send_group`, { group_id, message }, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'HTTP-API-Gateway'
      }
    });

    res.json({
      success: true,
      message: 'Group message sent successfully via gateway',
      group_id,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    moduleLogger.error('Failed to send group message via gateway', {
      error: error.message,
      groupId: group_id
    });

    if (error.code === 'ECONNREFUSED') {
      res.status(503).json({
        success: false,
        error: 'QQBot Core service unavailable',
        timestamp: new Date().toISOString()
      });
    } else if (error.response?.status) {
      res.status(error.response.status).json({
        success: false,
        error: error.response.data?.error || 'Unknown error from QQBot Core',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Gateway internal error',
        timestamp: new Date().toISOString()
      });
    }
  }
});

app.get('/api/bot/status', async (_req, res) => {
  try {
    const response = await axios.get(`${QQBOT_CORE_URL}/api/status`, {
      timeout: 5000
    });

    res.json({
      success: true,
      gateway_status: 'healthy',
      qqbot_core: response.data,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    moduleLogger.warn('Failed to get QQBot Core status', { error: error.message });

    res.status(503).json({
      success: false,
      gateway_status: 'healthy',
      qqbot_core: 'unavailable',
      error: 'QQBot Core service unavailable',
      timestamp: new Date().toISOString()
    });
  }
});

// Function registry routes
app.use('/v1/functions', createFunctionRoutes(functionRegistryService));
app.use('/v1/prompts', createPromptRoutes(functionRegistryService));
app.use('/v1/functions', createInvocationRoutes(functionRegistryService));

const server = app.listen(PORT, () => {
  logger.info(`HTTP API service listening on port ${PORT}`);
});

const gracefulShutdown = async () => {
  moduleLogger.info('Shutting down HTTP API service');
  server.close(async () => {
    moduleLogger.info('HTTP server closed');
    try {
      await pool.end();
      moduleLogger.info('Database pool closed');
    } catch (error: any) {
      moduleLogger.error('Error closing database pool', { error: error.message });
    } finally {
      process.exit(0);
    }
  });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

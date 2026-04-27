import express from 'express';
import { randomUUID } from 'crypto';
import winston from 'winston';
import { DatabaseManager } from '../services/database';

const PROVIDER_SERVICE_URL = process.env.PROVIDER_SERVICE_URL || 'http://qqbot-provider-service:8090';
const IMAGE_LAB_JOB_TTL_MS = 30 * 60 * 1000;

type ImageLabOperation = 'generate' | 'edit';
type ImageLabJobStatus = 'pending' | 'succeeded' | 'failed';
type ImageLabProxyResult = Awaited<ReturnType<typeof proxyImageRequest>>;

type ImageLabJob = {
  id: string;
  operation: ImageLabOperation;
  status: ImageLabJobStatus;
  createdAt: string;
  updatedAt: string;
  metadata: ReturnType<typeof safeRequestMetadata>;
  result?: ImageLabProxyResult;
  error?: string;
};

const imageLabJobs = new Map<string, ImageLabJob>();

function toClientStatus(status: number): number {
  return status >= 502 && status <= 504 ? 500 : status;
}

function safeRequestMetadata(operation: ImageLabOperation, body: any) {
  const images = Array.isArray(body?.images) ? body.images : undefined;
  return {
    operation,
    model: typeof body?.model === 'string' ? body.model : 'gpt-image-2',
    prompt_length: typeof body?.prompt === 'string' ? body.prompt.length : 0,
    size: typeof body?.size === 'string' ? body.size : null,
    quality: typeof body?.quality === 'string' ? body.quality : null,
    format: typeof body?.format === 'string' ? body.format : null,
    has_image: body?.image !== undefined || (images !== undefined && images.length > 0),
    has_mask: body?.mask !== undefined
  };
}

async function proxyImageRequest(operation: ImageLabOperation, body: any) {
  const response = await fetch(`${PROVIDER_SERVICE_URL}/api/internal/image/${operation}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body || {})
  });

  const text = await response.text();
  let payload: any = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (_error) {
      payload = null;
    }
  }

  if (!payload) {
    return {
      status: response.ok ? 500 : toClientStatus(response.status),
      payload: {
        success: false,
        error: response.ok ? 'Provider returned an invalid image response' : `Provider image request failed with HTTP ${response.status}`,
        timestamp: new Date().toISOString()
      }
    };
  }

  return {
    status: toClientStatus(response.status),
    payload
  };
}

function cleanupImageLabJobs() {
  const cutoff = Date.now() - IMAGE_LAB_JOB_TTL_MS;
  for (const [id, job] of imageLabJobs.entries()) {
    if (Date.parse(job.createdAt) < cutoff) {
      imageLabJobs.delete(id);
    }
  }
}

function serializeJob(job: ImageLabJob) {
  return {
    id: job.id,
    operation: job.operation,
    status: job.status,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    metadata: job.metadata,
    ...(job.error ? { error: job.error } : {}),
    ...(job.result ? { status_code: job.result.status } : {})
  };
}

function createImageLabJob(operation: ImageLabOperation, body: any, logger: winston.Logger) {
  cleanupImageLabJobs();
  const now = new Date().toISOString();
  const job: ImageLabJob = {
    id: randomUUID(),
    operation,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    metadata: safeRequestMetadata(operation, body)
  };
  imageLabJobs.set(job.id, job);

  void (async () => {
    try {
      const result = await proxyImageRequest(operation, body || {});
      job.result = result;
      job.status = result.status >= 200 && result.status < 300 && result.payload?.success !== false ? 'succeeded' : 'failed';
      job.error = job.status === 'failed'
        ? result.payload?.error || result.payload?.message || `Image ${operation} failed with HTTP ${result.status}`
        : undefined;
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
      logger.error('Async image lab job failed', {
        jobId: job.id,
        error: job.error,
        ...job.metadata
      });
    } finally {
      job.updatedAt = new Date().toISOString();
    }
  })();

  return job;
}

function sendJobResponse(res: express.Response, job: ImageLabJob) {
  if (job.status === 'pending') {
    return res.json({
      success: true,
      job: serializeJob(job),
      timestamp: new Date().toISOString()
    });
  }

  if (job.status === 'failed') {
    return res.json({
      success: false,
      job: serializeJob(job),
      error: job.error || 'Image Lab job failed',
      timestamp: new Date().toISOString()
    });
  }

  return res.json({
    success: true,
    job: serializeJob(job),
    data: job.result?.payload?.data ?? job.result?.payload,
    timestamp: new Date().toISOString()
  });
}

export function createImageLabRoutes(_database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();

  router.post('/image-lab/generate', async (req, res) => {
    try {
      logger.info('Proxying image lab generation request', safeRequestMetadata('generate', req.body));
      if (req.body?.async === true) {
        const job = createImageLabJob('generate', req.body || {}, logger);
        res.status(202).json({
          success: true,
          job: serializeJob(job),
          timestamp: new Date().toISOString()
        });
        return;
      }

      const result = await proxyImageRequest('generate', req.body || {});
      res.status(result.status).json(result.payload);
    } catch (error) {
      logger.error('Failed to proxy image lab generation request', {
        error: error instanceof Error ? error.message : String(error),
        ...safeRequestMetadata('generate', req.body)
      });
      res.status(500).json({
        success: false,
        error: 'Failed to reach provider image generation endpoint',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.post('/image-lab/edit', async (req, res) => {
    try {
      logger.info('Proxying image lab edit request', safeRequestMetadata('edit', req.body));
      if (req.body?.async === true) {
        const job = createImageLabJob('edit', req.body || {}, logger);
        res.status(202).json({
          success: true,
          job: serializeJob(job),
          timestamp: new Date().toISOString()
        });
        return;
      }

      const result = await proxyImageRequest('edit', req.body || {});
      res.status(result.status).json(result.payload);
    } catch (error) {
      logger.error('Failed to proxy image lab edit request', {
        error: error instanceof Error ? error.message : String(error),
        ...safeRequestMetadata('edit', req.body)
      });
      res.status(500).json({
        success: false,
        error: 'Failed to reach provider image edit endpoint',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/image-lab/jobs/:jobId', (req, res) => {
    cleanupImageLabJobs();
    const job = imageLabJobs.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        success: false,
        error: 'Image Lab job not found',
        timestamp: new Date().toISOString()
      });
      return;
    }

    sendJobResponse(res, job);
  });

  return router;
}

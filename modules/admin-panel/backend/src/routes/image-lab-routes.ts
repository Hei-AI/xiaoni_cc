import express from 'express';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import winston from 'winston';
import {
  addImageLabArtifacts,
  createImageLabRun,
  ensureImageLabSchema,
  getImageLabRunById,
  listImageLabRuns,
  updateImageLabRun,
} from '@qq-bot/persistence';
import { DatabaseManager } from '../services/database';

const PROVIDER_SERVICE_URL = process.env.PROVIDER_SERVICE_URL || 'http://qqbot-provider-service:8090';
const IMAGE_LAB_JOB_TTL_MS = 30 * 60 * 1000;
const IMAGE_LAB_STORAGE_ROOT = process.env.IMAGE_LAB_STORAGE_ROOT || '/app/resources/uploads/image-lab';

type ImageLabOperation = 'generate' | 'edit';
type ImageLabHistoryOperation = ImageLabOperation | 'prompt_assistant';
type ImageLabJobStatus = 'pending' | 'succeeded' | 'failed';
type ImageLabProxyResult = Awaited<ReturnType<typeof proxyImageRequest>>;

type ImageLabJob = {
  id: string;
  operation: ImageLabOperation;
  status: ImageLabJobStatus;
  historyRunId: string;
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

function safePromptAssistantMetadata(body: any) {
  const images = Array.isArray(body?.referenceImages) ? body.referenceImages : undefined;
  return {
    operation: 'prompt_assistant' as ImageLabHistoryOperation,
    prompt_length: typeof body?.prompt === 'string' ? body.prompt.length : 0,
    mode: typeof body?.mode === 'string' ? body.mode : null,
    size: typeof body?.size === 'string' ? body.size : null,
    quality: typeof body?.quality === 'string' ? body.quality : null,
    format: typeof body?.format === 'string' ? body.format : null,
    reference_count: images?.length || 0
  };
}

function normalizePrompt(body: any): string {
  return typeof body?.prompt === 'string' ? body.prompt.trim() : '';
}

function sanitizeImageInput(image: any, index: number) {
  const record = image && typeof image === 'object' && !Array.isArray(image) ? image : {};
  const dataUrl = typeof record.data_url === 'string' ? record.data_url : typeof record.dataUrl === 'string' ? record.dataUrl : undefined;
  const base64 = typeof record.b64_json === 'string' ? record.b64_json : typeof record.base64 === 'string' ? record.base64 : undefined;
  return {
    id: typeof record.id === 'string' ? record.id : null,
    filename: typeof record.filename === 'string' ? record.filename : typeof record.name === 'string' ? record.name : `image-${index + 1}`,
    mime_type: typeof record.mime_type === 'string' ? record.mime_type : typeof record.mimeType === 'string' ? record.mimeType : null,
    has_data_url: Boolean(dataUrl),
    has_base64: Boolean(base64),
    bytes_estimate: typeof base64 === 'string' ? Math.floor(base64.length * 0.75) : null
  };
}

function sanitizeImageLabRequestBody(operation: ImageLabHistoryOperation, body: any) {
  const images = Array.isArray(body?.images) ? body.images : body?.image ? [body.image] : [];
  const referenceImages = Array.isArray(body?.referenceImages) ? body.referenceImages : [];
  return {
    operation,
    model: typeof body?.model === 'string' ? body.model : 'gpt-image-2',
    prompt_length: typeof body?.prompt === 'string' ? body.prompt.length : 0,
    size: typeof body?.size === 'string' ? body.size : null,
    quality: typeof body?.quality === 'string' ? body.quality : null,
    format: typeof body?.format === 'string' ? body.format : typeof body?.output_format === 'string' ? body.output_format : null,
    n: typeof body?.n === 'number' ? body.n : null,
    async: body?.async === true,
    images: images.map(sanitizeImageInput),
    reference_images: referenceImages.map(sanitizeImageInput),
    has_mask: body?.mask !== undefined
  };
}

function sanitizeImageLabResult(payload: any) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const images = Array.isArray(data?.images)
    ? data.images
    : Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data?.data)
        ? data.data
        : [];
  return {
    success: payload?.success !== false,
    image_count: images.length,
    images: images.map((image: any, index: number) => ({
      index,
      mime_type: typeof image?.mime_type === 'string' ? image.mime_type : typeof image?.mimeType === 'string' ? image.mimeType : null,
      format: typeof image?.format === 'string' ? image.format : null,
      revised_prompt: typeof image?.revised_prompt === 'string' ? image.revised_prompt : typeof image?.revisedPrompt === 'string' ? image.revisedPrompt : null,
      bytes_estimate: typeof image?.bytes_estimate === 'number' ? image.bytes_estimate : null,
      has_data_url: typeof image?.data_url === 'string' || typeof image?.dataUrl === 'string',
      has_url: typeof image?.url === 'string'
    }))
  };
}

function mimeTypeToExtension(mimeType: string, format?: string | null): string {
  if (format === 'jpeg' || mimeType === 'image/jpeg') {
    return 'jpg';
  }
  if (format === 'webp' || mimeType === 'image/webp') {
    return 'webp';
  }
  return 'png';
}

function extractImageData(image: any): { buffer: Buffer; mimeType: string; format: string | null } | null {
  const mimeType = typeof image?.mime_type === 'string'
    ? image.mime_type
    : typeof image?.mimeType === 'string'
      ? image.mimeType
      : typeof image?.format === 'string'
        ? `image/${image.format === 'jpeg' ? 'jpeg' : image.format}`
        : 'image/png';
  const format = typeof image?.format === 'string' ? image.format : null;
  const dataUrl = typeof image?.data_url === 'string'
    ? image.data_url
    : typeof image?.dataUrl === 'string'
      ? image.dataUrl
      : null;
  const base64 = typeof image?.b64_json === 'string'
    ? image.b64_json
    : typeof image?.base64 === 'string'
      ? image.base64
      : null;

  if (dataUrl) {
    const match = /^data:([^;,]+);base64,(.*)$/is.exec(dataUrl);
    if (!match) {
      return null;
    }
    return {
      buffer: Buffer.from(match[2].replace(/\s+/g, ''), 'base64'),
      mimeType: match[1].toLowerCase(),
      format
    };
  }

  if (base64) {
    return {
      buffer: Buffer.from(base64.replace(/\s+/g, ''), 'base64'),
      mimeType,
      format
    };
  }

  return null;
}

function getPayloadImages(payload: any): any[] {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  if (Array.isArray(data?.images)) {
    return data.images;
  }
  if (Array.isArray(data?.results)) {
    return data.results;
  }
  if (Array.isArray(data?.data)) {
    return data.data;
  }
  return [];
}

async function persistImageArtifacts(runId: string, payload: any) {
  const images = getPayloadImages(payload);
  if (images.length === 0) {
    return [];
  }

  const runDir = path.join(IMAGE_LAB_STORAGE_ROOT, runId);
  await fs.mkdir(runDir, { recursive: true });
  const artifacts = [];

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const extracted = extractImageData(image);
    if (!extracted || extracted.buffer.length === 0) {
      continue;
    }
    const artifactId = randomUUID();
    const extension = mimeTypeToExtension(extracted.mimeType, extracted.format);
    const filename = `${artifactId}.${extension}`;
    const filePath = path.join(runDir, filename);
    await fs.writeFile(filePath, extracted.buffer);
    artifacts.push({
      id: artifactId,
      kind: 'image',
      filePath,
      publicPath: `/api/image-lab/assets/${encodeURIComponent(runId)}/${encodeURIComponent(filename)}`,
      mimeType: extracted.mimeType,
      format: extracted.format,
      bytes: extracted.buffer.length,
      revisedPrompt: typeof image?.revised_prompt === 'string'
        ? image.revised_prompt
        : typeof image?.revisedPrompt === 'string'
          ? image.revisedPrompt
          : null,
      metadata: {
        source_index: index,
        provider_bytes_estimate: typeof image?.bytes_estimate === 'number' ? image.bytes_estimate : null
      }
    });
  }

  if (artifacts.length === 0) {
    return [];
  }
  return addImageLabArtifacts(runId, artifacts);
}

function createRunInput(operation: ImageLabHistoryOperation, body: any, id = randomUUID()) {
  return {
    id,
    operation,
    status: 'pending',
    parentRunId: typeof body?.parent_run_id === 'string' ? body.parent_run_id : typeof body?.parentRunId === 'string' ? body.parentRunId : null,
    prompt: normalizePrompt(body),
    provider: typeof body?.provider === 'string' ? body.provider : 'gpt-image-2',
    model: typeof body?.model === 'string' ? body.model : 'gpt-image-2',
    size: typeof body?.size === 'string' ? body.size : null,
    quality: typeof body?.quality === 'string' ? body.quality : null,
    format: typeof body?.format === 'string' ? body.format : typeof body?.output_format === 'string' ? body.output_format : null,
    inputJson: sanitizeImageLabRequestBody(operation, body),
    startedAt: new Date()
  };
}

async function completeHistoryRun(runId: string, result: ImageLabProxyResult) {
  const success = result.status >= 200 && result.status < 300 && result.payload?.success !== false;
  const errorMessage = success
    ? null
    : result.payload?.error || result.payload?.message || `Image Lab request failed with HTTP ${result.status}`;
  const artifacts = success ? await persistImageArtifacts(runId, result.payload) : [];
  const run = await updateImageLabRun({
    id: runId,
    status: success ? 'succeeded' : 'failed',
    resultJson: sanitizeImageLabResult(result.payload),
    errorMessage,
    completedAt: new Date()
  });
  return {
    ...run,
    artifacts: artifacts.length > 0 ? artifacts : run.artifacts || []
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

async function proxyPromptAssistantRequest(body: any) {
  const response = await fetch(`${PROVIDER_SERVICE_URL}/api/internal/image/prompt-assistant`, {
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
        error: response.ok ? 'Provider returned an invalid prompt assistant response' : `Provider prompt assistant request failed with HTTP ${response.status}`,
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
    history_run_id: job.historyRunId,
    operation: job.operation,
    status: job.status,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    metadata: job.metadata,
    ...(job.error ? { error: job.error } : {}),
    ...(job.result ? { status_code: job.result.status } : {})
  };
}

async function createImageLabJob(operation: ImageLabOperation, body: any, logger: winston.Logger) {
  cleanupImageLabJobs();
  const now = new Date().toISOString();
  const historyRunId = randomUUID();
  await createImageLabRun(createRunInput(operation, body, historyRunId));
  const job: ImageLabJob = {
    id: randomUUID(),
    operation,
    status: 'pending',
    historyRunId,
    createdAt: now,
    updatedAt: now,
    metadata: safeRequestMetadata(operation, body)
  };
  imageLabJobs.set(job.id, job);

  void (async () => {
    try {
      const result = await proxyImageRequest(operation, body || {});
      job.result = result;
      const historyRun = await completeHistoryRun(historyRunId, result);
      if (job.result.payload && typeof job.result.payload === 'object') {
        job.result.payload.data = {
          ...(job.result.payload.data && typeof job.result.payload.data === 'object' ? job.result.payload.data : {}),
          history_run: historyRun
        };
      }
      job.status = result.status >= 200 && result.status < 300 && result.payload?.success !== false ? 'succeeded' : 'failed';
      job.error = job.status === 'failed'
        ? result.payload?.error || result.payload?.message || `Image ${operation} failed with HTTP ${result.status}`
        : undefined;
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
      await updateImageLabRun({
        id: historyRunId,
        status: 'failed',
        errorMessage: job.error,
        completedAt: new Date()
      }).catch((historyError: unknown) => {
        logger.warn('Failed to mark image lab history run as failed', {
          historyRunId,
          error: historyError instanceof Error ? historyError.message : String(historyError)
        });
      });
      logger.error('Async image lab job failed', {
        jobId: job.id,
        historyRunId,
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

let imageLabSchemaReady: Promise<void> | null = null;

function ensureImageLabHistoryReady(logger: winston.Logger) {
  if (!imageLabSchemaReady) {
    imageLabSchemaReady = ensureImageLabSchema().catch((error: unknown) => {
      imageLabSchemaReady = null;
      logger.error('Failed to ensure image lab history schema', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    });
  }
  return imageLabSchemaReady;
}

function sendHistoryRun(res: express.Response, run: any) {
  res.json({
    success: true,
    data: run,
    timestamp: new Date().toISOString()
  });
}

export function createImageLabRoutes(_database: DatabaseManager, logger: winston.Logger) {
  const router = express.Router();

  router.post('/image-lab/prompt-assistant', async (req, res) => {
    try {
      await ensureImageLabHistoryReady(logger);
      const historyRunId = randomUUID();
      await createImageLabRun(createRunInput('prompt_assistant', req.body || {}, historyRunId));
      logger.info('Proxying image lab prompt assistant request', safePromptAssistantMetadata(req.body));
      const result = await proxyPromptAssistantRequest(req.body || {});
      const success = result.status >= 200 && result.status < 300 && result.payload?.success !== false;
      const historyRun = await updateImageLabRun({
        id: historyRunId,
        status: success ? 'succeeded' : 'failed',
        resultJson: {
          success,
          model_name: result.payload?.data?.modelName || null,
          detected_use_case: result.payload?.data?.detectedUseCase || null,
          source_pattern_count: Array.isArray(result.payload?.data?.sourcePatterns) ? result.payload.data.sourcePatterns.length : 0
        },
        errorMessage: success ? null : result.payload?.error || result.payload?.message || `Prompt assistant failed with HTTP ${result.status}`,
        completedAt: new Date()
      });
      if (result.payload && typeof result.payload === 'object') {
        result.payload.data = {
          ...(result.payload.data && typeof result.payload.data === 'object' ? result.payload.data : {}),
          history_run: historyRun
        };
      }
      res.status(result.status).json(result.payload);
    } catch (error) {
      logger.error('Failed to proxy image lab prompt assistant request', {
        error: error instanceof Error ? error.message : String(error),
        ...safePromptAssistantMetadata(req.body)
      });
      res.status(500).json({
        success: false,
        error: 'Failed to reach provider image prompt assistant endpoint',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.post('/image-lab/generate', async (req, res) => {
    try {
      await ensureImageLabHistoryReady(logger);
      logger.info('Proxying image lab generation request', safeRequestMetadata('generate', req.body));
      if (req.body?.async === true) {
        const job = await createImageLabJob('generate', req.body || {}, logger);
        res.status(202).json({
          success: true,
          job: serializeJob(job),
          timestamp: new Date().toISOString()
        });
        return;
      }

      const result = await proxyImageRequest('generate', req.body || {});
      const historyRunId = randomUUID();
      await createImageLabRun(createRunInput('generate', req.body || {}, historyRunId));
      const historyRun = await completeHistoryRun(historyRunId, result);
      if (result.payload && typeof result.payload === 'object') {
        result.payload.data = {
          ...(result.payload.data && typeof result.payload.data === 'object' ? result.payload.data : {}),
          history_run: historyRun
        };
      }
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
      await ensureImageLabHistoryReady(logger);
      logger.info('Proxying image lab edit request', safeRequestMetadata('edit', req.body));
      if (req.body?.async === true) {
        const job = await createImageLabJob('edit', req.body || {}, logger);
        res.status(202).json({
          success: true,
          job: serializeJob(job),
          timestamp: new Date().toISOString()
        });
        return;
      }

      const result = await proxyImageRequest('edit', req.body || {});
      const historyRunId = randomUUID();
      await createImageLabRun(createRunInput('edit', req.body || {}, historyRunId));
      const historyRun = await completeHistoryRun(historyRunId, result);
      if (result.payload && typeof result.payload === 'object') {
        result.payload.data = {
          ...(result.payload.data && typeof result.payload.data === 'object' ? result.payload.data : {}),
          history_run: historyRun
        };
      }
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

  router.get('/image-lab/history', async (req, res) => {
    try {
      await ensureImageLabHistoryReady(logger);
      const limit = Number.parseInt(String(req.query.limit || '50'), 10);
      const operation = typeof req.query.operation === 'string' ? req.query.operation : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const runs = await listImageLabRuns({ limit, operation, status });
      res.json({
        success: true,
        data: {
          runs
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to list image lab history', {
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({
        success: false,
        error: 'Failed to list image lab history',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/image-lab/history/:runId', async (req, res) => {
    try {
      await ensureImageLabHistoryReady(logger);
      const run = await getImageLabRunById(req.params.runId);
      if (!run) {
        res.status(404).json({
          success: false,
          error: 'Image Lab history run not found',
          timestamp: new Date().toISOString()
        });
        return;
      }
      sendHistoryRun(res, run);
    } catch (error) {
      logger.error('Failed to load image lab history run', {
        runId: req.params.runId,
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({
        success: false,
        error: 'Failed to load image lab history run',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/image-lab/assets/:runId/:filename', async (req, res) => {
    const runId = req.params.runId;
    const filename = req.params.filename;
    if (!/^[a-f0-9-]{36}$/i.test(runId) || !/^[a-f0-9-]{36}\.(png|jpg|jpeg|webp)$/i.test(filename)) {
      res.status(404).json({
        success: false,
        error: 'Image Lab asset not found',
        timestamp: new Date().toISOString()
      });
      return;
    }

    const requestedPath = path.resolve(IMAGE_LAB_STORAGE_ROOT, runId, filename);
    const allowedDir = path.resolve(IMAGE_LAB_STORAGE_ROOT, runId);
    if (!requestedPath.startsWith(`${allowedDir}${path.sep}`)) {
      res.status(404).json({
        success: false,
        error: 'Image Lab asset not found',
        timestamp: new Date().toISOString()
      });
      return;
    }

    res.sendFile(requestedPath, (error) => {
      if (error && !res.headersSent) {
        res.status(404).json({
          success: false,
          error: 'Image Lab asset not found',
          timestamp: new Date().toISOString()
        });
      }
    });
  });

  return router;
}

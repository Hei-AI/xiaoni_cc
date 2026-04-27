export type ImageLabMode = 'generate' | 'edit';
export type ImageLabQuality = 'auto' | 'low' | 'medium' | 'high';
export type ImageLabFormat = 'png' | 'jpeg' | 'webp';

export interface ImageLabReferenceImage {
  id?: string;
  name?: string;
  dataUrl?: string;
  base64?: string;
  mimeType?: string;
}

export interface ImageLabRequest {
  prompt: string;
  size: string;
  width?: number;
  height?: number;
  quality: ImageLabQuality;
  format: ImageLabFormat;
  compression: number;
  n: number;
  referenceImages?: ImageLabReferenceImage[];
}

export interface ImageLabImageResult {
  dataUrl: string;
  base64?: string;
  mimeType: string;
  revisedPrompt?: string | null;
}

export interface ImageLabResponse {
  images: ImageLabImageResult[];
  raw: unknown;
}

type ImageLabJobStatus = 'pending' | 'succeeded' | 'failed';

type ApiEnvelope = {
  success?: boolean;
  data?: unknown;
  job?: {
    id?: unknown;
    status?: unknown;
    error?: unknown;
  };
  message?: string;
  error?: string;
};

type ResponseImageCandidate = {
  dataUrl?: unknown;
  data_url?: unknown;
  url?: unknown;
  base64?: unknown;
  b64_json?: unknown;
  mimeType?: unknown;
  mime_type?: unknown;
  format?: unknown;
  revisedPrompt?: unknown;
  revised_prompt?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mimeTypeFor(format: ImageLabFormat | string | undefined): string {
  if (format === 'jpeg' || format === 'jpg') {
    return 'image/jpeg';
  }
  if (format === 'webp') {
    return 'image/webp';
  }
  return 'image/png';
}

function normalizeDataUrl(value: string, mimeType: string): string {
  if (value.startsWith('data:')) {
    return value;
  }
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  return `data:${mimeType};base64,${value}`;
}

function getCandidateImages(data: unknown): ResponseImageCandidate[] {
  if (Array.isArray(data)) {
    return data.filter(isRecord);
  }

  if (!isRecord(data)) {
    return [];
  }

  const arrays = [data.images, data.results, data.output, data.data];
  for (const value of arrays) {
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  return [data];
}

function normalizeImage(candidate: ResponseImageCandidate, requestedFormat: ImageLabFormat): ImageLabImageResult | null {
  const explicitMimeType = candidate.mimeType ?? candidate.mime_type;
  const candidateFormat = typeof candidate.format === 'string' ? candidate.format : requestedFormat;
  const mimeType = typeof explicitMimeType === 'string' ? explicitMimeType : mimeTypeFor(candidateFormat);
  const dataUrl = candidate.dataUrl ?? candidate.data_url ?? candidate.url;
  const base64 = candidate.base64 ?? candidate.b64_json;
  const source = typeof dataUrl === 'string' ? dataUrl : typeof base64 === 'string' ? base64 : null;

  if (!source) {
    return null;
  }

  const revisedPrompt = candidate.revisedPrompt ?? candidate.revised_prompt;

  return {
    dataUrl: normalizeDataUrl(source, mimeType),
    base64: typeof base64 === 'string' ? base64 : undefined,
    mimeType,
    revisedPrompt: typeof revisedPrompt === 'string' ? revisedPrompt : null,
  };
}

async function readImageLabEnvelope(response: Response): Promise<ApiEnvelope> {
  let payload: ApiEnvelope;
  try {
    payload = (await response.json()) as ApiEnvelope;
  } catch (_error) {
    payload = {};
  }

  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || payload.error || 'Image Lab request failed');
  }

  return payload;
}

function parseImageLabResponsePayload(payload: ApiEnvelope, requestedFormat: ImageLabFormat): ImageLabResponse {
  const data = payload.data ?? payload;
  const images = getCandidateImages(data)
    .map((candidate) => normalizeImage(candidate, requestedFormat))
    .filter((image): image is ImageLabImageResult => image !== null);

  if (images.length === 0) {
    throw new Error('Image Lab response did not include an image');
  }

  return { images, raw: payload };
}

async function parseImageLabResponse(response: Response, requestedFormat: ImageLabFormat): Promise<ImageLabResponse> {
  return parseImageLabResponsePayload(await readImageLabEnvelope(response), requestedFormat);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollImageLabJob(jobId: string, requestedFormat: ImageLabFormat): Promise<ImageLabResponse> {
  const startedAt = Date.now();
  const timeoutMs = 6 * 60 * 1000;

  while (Date.now() - startedAt < timeoutMs) {
    await delay(2500);
    const response = await fetch(`/api/image-lab/jobs/${encodeURIComponent(jobId)}`);
    let payload: ApiEnvelope;
    try {
      payload = (await response.json()) as ApiEnvelope;
    } catch (_error) {
      payload = {};
    }

    if (!response.ok) {
      throw new Error(payload.message || payload.error || `Image Lab job polling failed with HTTP ${response.status}`);
    }

    const status = payload.job?.status as ImageLabJobStatus | undefined;
    if (status === 'pending') {
      continue;
    }
    if (status === 'failed' || payload.success === false) {
      const jobError = typeof payload.job?.error === 'string' ? payload.job.error : undefined;
      throw new Error(jobError || payload.error || payload.message || 'Image Lab job failed');
    }

    return parseImageLabResponsePayload(payload, requestedFormat);
  }

  throw new Error('Image Lab job timed out while waiting for a result');
}

function buildBody(payload: ImageLabRequest): Record<string, unknown> {
  const referenceImages = (payload.referenceImages ?? []).map((image, index) => ({
    id: image.id,
    filename: image.name || `reference-${index + 1}`,
    data_url: image.dataUrl,
    b64_json: image.base64,
    mime_type: image.mimeType,
  }));
  const compressionFields = payload.format === 'png'
    ? {}
    : {
        compression: payload.compression,
        output_compression: payload.compression,
      };

  return {
    provider: 'gpt-image-2',
    prompt: payload.prompt,
    size: payload.size,
    quality: payload.quality,
    format: payload.format,
    output_format: payload.format,
    ...compressionFields,
    n: payload.n,
    images: referenceImages,
    async: true,
  };
}

async function postImageLab(endpoint: '/api/image-lab/generate' | '/api/image-lab/edit', payload: ImageLabRequest): Promise<ImageLabResponse> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildBody(payload)),
  });

  if (response.status === 202) {
    const envelope = await readImageLabEnvelope(response);
    const jobId = envelope.job?.id;
    if (typeof jobId !== 'string' || !jobId) {
      throw new Error('Image Lab job response did not include a job id');
    }
    return pollImageLabJob(jobId, payload.format);
  }

  return parseImageLabResponse(response, payload.format);
}

export function generateImageLab(payload: ImageLabRequest): Promise<ImageLabResponse> {
  return postImageLab('/api/image-lab/generate', payload);
}

export function editImageLab(payload: ImageLabRequest): Promise<ImageLabResponse> {
  return postImageLab('/api/image-lab/edit', payload);
}

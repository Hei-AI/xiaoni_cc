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
  artifactId?: string;
}

export interface ImageLabResponse {
  images: ImageLabImageResult[];
  raw: unknown;
  historyRun?: ImageLabHistoryRun | null;
}

export interface ImageLabPromptAssistantRequest {
  prompt: string;
  mode: ImageLabMode;
  size: string;
  quality: ImageLabQuality;
  format: ImageLabFormat;
  referenceImages?: ImageLabReferenceImage[];
}

export interface ImageLabPromptAssistantResponse {
  finalPrompt: string;
  detectedUseCase: string;
  summary: string;
  sections: {
    subject: string;
    scene: string;
    style: string;
    composition: string;
    camera: string;
    lighting: string;
    details: string;
    constraints: string;
  };
  suggested?: {
    size?: string;
    quality?: ImageLabQuality | string;
    format?: ImageLabFormat | string;
  };
  warnings: string[];
  sourcePatterns: Array<{
    id: string;
    label: string;
    useCase: string;
    sourceUrl?: string;
  }>;
  modelName?: string;
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

export interface ImageLabHistoryArtifact {
  id: string;
  run_id: string;
  public_path: string;
  mime_type: string;
  format?: string | null;
  bytes?: number | null;
  width?: number | null;
  height?: number | null;
  revised_prompt?: string | null;
  created_at: string;
}

export interface ImageLabHistoryRun {
  id: string;
  operation: 'generate' | 'edit' | 'prompt_assistant' | string;
  status: 'pending' | 'succeeded' | 'failed' | string;
  parent_run_id?: string | null;
  prompt: string;
  provider?: string | null;
  model?: string | null;
  size?: string | null;
  quality?: string | null;
  format?: string | null;
  input_json?: Record<string, unknown>;
  result_json?: Record<string, unknown>;
  error_message?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
  artifacts: ImageLabHistoryArtifact[];
}

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

  const historyRun = isRecord(data) && isRecord(data.history_run) ? data.history_run as unknown as ImageLabHistoryRun : null;
  return { images, raw: payload, historyRun };
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

async function urlToDataUrl(url: string): Promise<{ dataUrl: string; mimeType: string }> {
  if (url.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,/i.exec(url);
    return {
      dataUrl: url,
      mimeType: match?.[1] || 'image/png',
    };
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load reference image ${url}`);
  }
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Failed to read reference image'));
    reader.onerror = () => reject(new Error('Failed to read reference image'));
    reader.readAsDataURL(blob);
  });
  return {
    dataUrl,
    mimeType: blob.type || 'image/png',
  };
}

async function resolveReferenceImage(image: ImageLabReferenceImage, index: number) {
  const resolved = image.dataUrl ? await urlToDataUrl(image.dataUrl) : null;
  return {
    id: image.id,
    filename: image.name || `reference-${index + 1}`,
    data_url: resolved?.dataUrl,
    b64_json: image.base64,
    mime_type: image.mimeType || resolved?.mimeType,
  };
}

async function buildBody(payload: ImageLabRequest): Promise<Record<string, unknown>> {
  const referenceImages = await Promise.all((payload.referenceImages ?? []).map(resolveReferenceImage));
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
    body: JSON.stringify(await buildBody(payload)),
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

function normalizePromptAssistantPayload(payload: ApiEnvelope): ImageLabPromptAssistantResponse {
  const data = isRecord(payload.data) ? payload.data : {};
  const sections = isRecord(data.sections) ? data.sections : {};
  const suggested = isRecord(data.suggested) ? data.suggested : {};
  const sourcePatterns = Array.isArray(data.sourcePatterns)
    ? data.sourcePatterns.filter(isRecord).map((item) => ({
        id: typeof item.id === 'string' ? item.id : '',
        label: typeof item.label === 'string' ? item.label : '',
        useCase: typeof item.useCase === 'string' ? item.useCase : '',
        sourceUrl: typeof item.sourceUrl === 'string' ? item.sourceUrl : undefined,
      })).filter((item) => item.id && item.label)
    : [];

  const finalPrompt = typeof data.finalPrompt === 'string' ? data.finalPrompt.trim() : '';
  if (!finalPrompt) {
    throw new Error('Prompt Assistant response did not include a final prompt');
  }

  return {
    finalPrompt,
    detectedUseCase: typeof data.detectedUseCase === 'string' ? data.detectedUseCase : 'general',
    summary: typeof data.summary === 'string' ? data.summary : '',
    sections: {
      subject: typeof sections.subject === 'string' ? sections.subject : '',
      scene: typeof sections.scene === 'string' ? sections.scene : '',
      style: typeof sections.style === 'string' ? sections.style : '',
      composition: typeof sections.composition === 'string' ? sections.composition : '',
      camera: typeof sections.camera === 'string' ? sections.camera : '',
      lighting: typeof sections.lighting === 'string' ? sections.lighting : '',
      details: typeof sections.details === 'string' ? sections.details : '',
      constraints: typeof sections.constraints === 'string' ? sections.constraints : '',
    },
    suggested: {
      size: typeof suggested.size === 'string' ? suggested.size : undefined,
      quality: typeof suggested.quality === 'string' ? suggested.quality : undefined,
      format: typeof suggested.format === 'string' ? suggested.format : undefined,
    },
    warnings: Array.isArray(data.warnings) ? data.warnings.filter((item): item is string => typeof item === 'string') : [],
    sourcePatterns,
    modelName: typeof data.modelName === 'string' ? data.modelName : undefined,
    raw: payload,
  };
}

export async function assistImageLabPrompt(payload: ImageLabPromptAssistantRequest): Promise<ImageLabPromptAssistantResponse> {
  const referenceImages = (payload.referenceImages ?? []).map((image, index) => ({
    id: image.id,
    name: image.name || `reference-${index + 1}`,
    mimeType: image.mimeType,
    hasImage: Boolean(image.dataUrl || image.base64),
  }));

  const response = await fetch('/api/image-lab/prompt-assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: payload.prompt,
      mode: payload.mode,
      size: payload.size,
      quality: payload.quality,
      format: payload.format,
      referenceImages,
    }),
  });

  return normalizePromptAssistantPayload(await readImageLabEnvelope(response));
}

function normalizeHistoryImage(run: ImageLabHistoryRun, artifact: ImageLabHistoryArtifact): ImageLabImageResult {
  return {
    dataUrl: artifact.public_path,
    mimeType: artifact.mime_type || mimeTypeFor(run.format || undefined),
    revisedPrompt: artifact.revised_prompt || null,
    artifactId: artifact.id,
  };
}

export async function fetchImageLabHistory(limit = 50): Promise<ImageLabHistoryRun[]> {
  const response = await fetch(`/api/image-lab/history?limit=${encodeURIComponent(String(limit))}`);
  const envelope = await readImageLabEnvelope(response);
  const data = isRecord(envelope.data) ? envelope.data : {};
  const runs = Array.isArray(data.runs) ? data.runs : [];
  return runs.filter(isRecord) as unknown as ImageLabHistoryRun[];
}

export function imageLabHistoryRunToImages(run: ImageLabHistoryRun): ImageLabImageResult[] {
  if (!Array.isArray(run.artifacts)) {
    return [];
  }
  return run.artifacts
    .filter((artifact) => typeof artifact.public_path === 'string' && artifact.public_path.length > 0)
    .map((artifact) => normalizeHistoryImage(run, artifact));
}

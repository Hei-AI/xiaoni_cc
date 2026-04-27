import {
  ImageBackground,
  ImageDataInput,
  ImageEditRequest,
  ImageGenerateRequest,
  ImageOutputFormat,
  ImageQuality,
  NormalizedImageFile,
  NormalizedImageOptions
} from './types';

export class ImageProviderError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'ImageProviderError';
    this.statusCode = statusCode;
  }
}

const SUPPORTED_MODEL = 'gpt-image-2';
const DEFAULT_SIZE = 'auto';
const DEFAULT_QUALITY: ImageQuality = 'auto';
const DEFAULT_FORMAT: ImageOutputFormat = 'png';
const MAX_IMAGE_INPUT_BYTES = 25 * 1024 * 1024;
const BASE64_DATA_URL_PATTERN = /^data:([^;,]+);base64,(.*)$/is;

const IMAGE_MIME_TO_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
};

export function normalizeImageOptions(input: ImageGenerateRequest | ImageEditRequest): NormalizedImageOptions {
  if (!input || typeof input !== 'object') {
    throw new ImageProviderError('Request body must be an object');
  }

  const prompt = normalizePrompt(input.prompt);
  const model = normalizeModel(input.model);
  const size = normalizeSize(input.size);
  const quality = normalizeQuality(input.quality);
  const format = normalizeFormat(input.format);
  const background = normalizeBackground(input.background);
  const outputCompression = normalizeOutputCompression(input.output_compression, format);
  const n = normalizeImageCount(input.n);

  return {
    model,
    prompt,
    size,
    quality,
    format,
    ...(background ? { background } : {}),
    ...(outputCompression !== undefined ? { output_compression: outputCompression } : {}),
    ...(n !== undefined ? { n } : {})
  };
}

export function normalizeEditImages(input: ImageEditRequest): NormalizedImageFile[] {
  const rawImages = Array.isArray(input.images)
    ? input.images
    : input.image !== undefined
      ? Array.isArray(input.image) ? input.image : [input.image]
      : [];

  if (rawImages.length === 0) {
    throw new ImageProviderError('image or images is required for image edits');
  }

  return rawImages.map((image, index) => normalizeImageDataInput(image, `image_${index + 1}`));
}

export function normalizeEditMask(input: ImageEditRequest): NormalizedImageFile | undefined {
  return input.mask === undefined ? undefined : normalizeImageDataInput(input.mask, 'mask');
}

export function normalizeImageDataInput(input: ImageDataInput, fallbackName: string): NormalizedImageFile {
  let rawData: string | undefined;
  let mimeType: string | undefined;
  let filename: string | undefined;

  if (typeof input === 'string') {
    rawData = input;
  } else if (input && typeof input === 'object') {
    rawData = firstNonEmptyString(input.data_url, input.b64_json, input.data);
    mimeType = typeof input.mime_type === 'string' && input.mime_type.trim() ? input.mime_type.trim().toLowerCase() : undefined;
    filename = typeof input.filename === 'string' && input.filename.trim() ? input.filename.trim() : undefined;
  }

  if (!rawData || typeof rawData !== 'string') {
    throw new ImageProviderError(`${fallbackName} must be a base64 string or data URL`);
  }

  const parsed = parseBase64Image(rawData, mimeType);
  if (parsed.buffer.length === 0) {
    throw new ImageProviderError(`${fallbackName} is empty`);
  }
  if (parsed.buffer.length > MAX_IMAGE_INPUT_BYTES) {
    throw new ImageProviderError(`${fallbackName} exceeds the ${MAX_IMAGE_INPUT_BYTES} byte limit`);
  }

  const extension = IMAGE_MIME_TO_EXTENSION[parsed.mimeType] || 'png';
  return {
    buffer: parsed.buffer,
    mimeType: parsed.mimeType,
    filename: filename || `${fallbackName}.${extension}`,
    bytes: parsed.buffer.length
  };
}

export function normalizeImageApiResponse(response: any, format: ImageOutputFormat) {
  const items = Array.isArray(response?.data) ? response.data : [];
  return items.map((item: any) => {
    const b64Json = typeof item?.b64_json === 'string' ? stripBase64Whitespace(item.b64_json) : undefined;
    const mimeType = mimeTypeForFormat(format);

    if (b64Json) {
      return {
        data_url: `data:${mimeType};base64,${b64Json}`,
        mime_type: mimeType,
        format,
        revised_prompt: typeof item?.revised_prompt === 'string' ? item.revised_prompt : undefined,
        bytes_estimate: estimateBase64Bytes(b64Json)
      };
    }

    if (typeof item?.url === 'string' && item.url.trim()) {
      return {
        url: item.url.trim(),
        mime_type: mimeType,
        format,
        revised_prompt: typeof item?.revised_prompt === 'string' ? item.revised_prompt : undefined
      };
    }

    return null;
  }).filter(Boolean);
}

export function toSafeImageLogMetadata(params: {
  operation: 'generate' | 'edit';
  options: NormalizedImageOptions;
  imageCount?: number;
  maskBytes?: number;
}) {
  return {
    operation: params.operation,
    model: params.options.model,
    prompt_length: params.options.prompt.length,
    size: params.options.size,
    quality: params.options.quality,
    format: params.options.format,
    background: params.options.background || null,
    output_compression: params.options.output_compression ?? null,
    n: params.options.n ?? null,
    image_count: params.imageCount ?? null,
    mask_bytes: params.maskBytes ?? null
  };
}

export function mimeTypeForFormat(format: ImageOutputFormat) {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}

function normalizePrompt(value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ImageProviderError('prompt is required');
  }
  if (value.length > 32000) {
    throw new ImageProviderError('prompt is too long');
  }
  return value.trim();
}

function normalizeModel(value: unknown): 'gpt-image-2' {
  if (value === undefined || value === null || value === '') {
    return SUPPORTED_MODEL;
  }
  if (value !== SUPPORTED_MODEL) {
    throw new ImageProviderError('Only model gpt-image-2 is supported');
  }
  return SUPPORTED_MODEL;
}

function normalizeSize(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_SIZE;
  }
  if (value === 'auto') {
    return 'auto';
  }
  if (typeof value !== 'string') {
    throw new ImageProviderError('size must be "auto" or "<width>x<height>"');
  }

  const match = value.match(/^(\d{2,5})x(\d{2,5})$/);
  if (!match) {
    throw new ImageProviderError('size must be "auto" or "<width>x<height>"');
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const totalPixels = width * height;

  if (longEdge > 3840) {
    throw new ImageProviderError('size maximum edge must be <= 3840px');
  }
  if (width % 16 !== 0 || height % 16 !== 0) {
    throw new ImageProviderError('size width and height must be multiples of 16px');
  }
  if (longEdge / shortEdge > 3) {
    throw new ImageProviderError('size long edge to short edge ratio must be <= 3:1');
  }
  if (totalPixels < 655360 || totalPixels > 8294400) {
    throw new ImageProviderError('size total pixels must be between 655360 and 8294400');
  }

  return value;
}

function normalizeQuality(value: unknown): ImageQuality {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_QUALITY;
  }
  if (value === 'auto' || value === 'low' || value === 'medium' || value === 'high') {
    return value;
  }
  throw new ImageProviderError('quality must be one of auto, low, medium, high');
}

function normalizeFormat(value: unknown): ImageOutputFormat {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_FORMAT;
  }
  if (value === 'png' || value === 'jpeg' || value === 'webp') {
    return value;
  }
  throw new ImageProviderError('format must be one of png, jpeg, webp');
}

function normalizeBackground(value: unknown): ImageBackground | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (value === 'transparent') {
    throw new ImageProviderError('gpt-image-2 does not support transparent background');
  }
  if (value === 'auto' || value === 'opaque') {
    return value;
  }
  throw new ImageProviderError('background must be auto or opaque');
}

function normalizeOutputCompression(value: unknown, format: ImageOutputFormat) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (format === 'png') {
    throw new ImageProviderError('output_compression is only supported for jpeg and webp');
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 100) {
    throw new ImageProviderError('output_compression must be an integer from 0 to 100');
  }
  return numeric;
}

function normalizeImageCount(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 10) {
    throw new ImageProviderError('n must be an integer from 1 to 10');
  }
  return numeric;
}

function parseBase64Image(input: string, explicitMimeType?: string) {
  const trimmed = input.trim();
  const dataUrlMatch = trimmed.match(BASE64_DATA_URL_PATTERN);
  const mimeType = normalizeImageMimeType(dataUrlMatch?.[1] || explicitMimeType || 'image/png');
  const base64 = stripBase64Whitespace(dataUrlMatch ? dataUrlMatch[2] : trimmed);

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    throw new ImageProviderError('image data must be valid base64');
  }

  return {
    buffer: Buffer.from(base64, 'base64'),
    mimeType
  };
}

function normalizeImageMimeType(value: string) {
  const mimeType = value.toLowerCase();
  if (!IMAGE_MIME_TO_EXTENSION[mimeType]) {
    throw new ImageProviderError('image mime_type must be image/png, image/jpeg, or image/webp');
  }
  return mimeType;
}

function stripBase64Whitespace(value: string) {
  return value.replace(/\s+/g, '');
}

function estimateBase64Bytes(base64: string) {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
}

function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return undefined;
}

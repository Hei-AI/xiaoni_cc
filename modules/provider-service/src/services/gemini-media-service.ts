import fs from 'fs/promises';
import { geminiMediaConfig } from '../config';
import { logger } from '../utils/logger';

/**
 * Gemini media-analysis service.
 *
 * A dedicated, standalone caller for a fast multimodal side model
 * (audio / video / image understanding) that 小腻 reaches as a *tool* — it is
 * NOT a main-loop provider and deliberately does not implement the LLMProvider
 * abstraction or the OpenResponse canonical request contract. The tool always
 * pairs a text prompt with one or more media parts.
 *
 * Routing: the request goes to CLIProxyAPI's native Gemini `generateContent`
 * surface (`{baseUrl}/v1beta/models/{model}:generateContent`, auth via
 * `x-goog-api-key`) — the same proxy 小腻's codex image-gen already uses. The
 * upstream Google API key therefore lives only in CLIProxyAPI's config, never
 * in provider-service.
 */

export type GeminiMediaPart = {
  /** e.g. 'audio/wav', 'video/mp4', 'image/png'. Required for inline data. */
  mimeType: string;
  /** Inline base64 payload (already encoded). Takes precedence over filePath. */
  dataBase64?: string;
  /** Absolute path on disk; read and base64-encoded when dataBase64 is absent. */
  filePath?: string;
};

export type GeminiMediaGenerationConfig = {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
};

export type GeminiMediaAnalyzeInput = {
  /** Required text instruction that accompanies the media. */
  prompt: string;
  /** One or more media parts to analyze. */
  media: GeminiMediaPart[];
  /** Override the default model (defaults to geminiMediaConfig.model). */
  model?: string;
  systemInstruction?: string;
  generationConfig?: GeminiMediaGenerationConfig;
};

export type GeminiMediaUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  thoughtsTokens?: number;
  modalities: Array<{ modality: string; tokenCount: number }>;
};

export type GeminiMediaAnalyzeResult = {
  provider: 'gemini-cliproxy';
  model: string;
  text: string;
  /** Candidate finish reason (e.g. 'STOP', 'MAX_TOKENS', 'SAFETY'). Undefined when absent. */
  finishReason?: string;
  /** Set when the prompt itself was blocked (e.g. 'SAFETY') and no candidate was produced. */
  blockReason?: string;
  usage: GeminiMediaUsage;
};

/** Caller-side problems (empty prompt, no media, oversized inline). HTTP 400. */
export class GeminiMediaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiMediaValidationError';
  }
}

/** Misconfiguration (missing proxy key). HTTP 500. */
export class GeminiMediaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiMediaConfigError';
  }
}

/** Upstream (CLIProxyAPI / Gemini) returned a non-2xx response. */
export class GeminiMediaRequestError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'GeminiMediaRequestError';
    this.statusCode = statusCode;
  }
}

type ResolvedInlinePart = { mimeType: string; data: string };

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/** Approximate decoded byte length of a base64 string (without allocating a Buffer). */
function base64ByteLength(base64: string): number {
  const clean = base64.replace(/=+$/, '');
  return Math.floor((clean.length * 3) / 4);
}

/**
 * Build the native Gemini `generateContent` payload from a validated prompt and
 * already-resolved inline parts. Pure and exported so the request contract is
 * unit-tested without touching the network.
 */
export function buildGeminiMediaPayload(
  input: Pick<GeminiMediaAnalyzeInput, 'prompt' | 'systemInstruction' | 'generationConfig'>,
  resolvedParts: ResolvedInlinePart[]
): Record<string, any> {
  const parts: any[] = [{ text: input.prompt }];
  for (const part of resolvedParts) {
    parts.push({ inline_data: { mime_type: part.mimeType, data: part.data } });
  }

  const payload: Record<string, any> = {
    contents: [{ role: 'user', parts }]
  };

  if (typeof input.systemInstruction === 'string' && input.systemInstruction.trim()) {
    payload.systemInstruction = { parts: [{ text: input.systemInstruction }] };
  }

  const gc = input.generationConfig;
  if (
    gc &&
    (gc.temperature !== undefined ||
      gc.topP !== undefined ||
      gc.topK !== undefined ||
      gc.maxOutputTokens !== undefined)
  ) {
    payload.generationConfig = {
      ...(gc.temperature !== undefined ? { temperature: gc.temperature } : {}),
      ...(gc.topP !== undefined ? { topP: gc.topP } : {}),
      ...(gc.topK !== undefined ? { topK: gc.topK } : {}),
      ...(gc.maxOutputTokens !== undefined ? { maxOutputTokens: gc.maxOutputTokens } : {})
    };
  }

  return payload;
}

/**
 * Parse a native Gemini `generateContent` response into the service result.
 * Thought parts (`part.thought === true`) are excluded from the answer text;
 * per-modality prompt token details are surfaced so callers can confirm the
 * media modality was actually consumed. Pure and exported for unit tests.
 */
export function parseGeminiMediaResponse(body: any, model: string): GeminiMediaAnalyzeResult {
  const candidate = body?.candidates?.[0];
  const parts: any[] = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const text = parts
    .filter((part) => typeof part?.text === 'string' && part?.thought !== true)
    .map((part) => part.text as string)
    .join('');

  const usageMetadata = body?.usageMetadata || {};
  const modalities = Array.isArray(usageMetadata.promptTokensDetails)
    ? usageMetadata.promptTokensDetails
        .filter((detail: any) => detail && typeof detail.modality === 'string')
        .map((detail: any) => ({
          modality: detail.modality as string,
          tokenCount: Number(detail.tokenCount) || 0
        }))
    : [];

  const finishReason = typeof candidate?.finishReason === 'string' ? candidate.finishReason : undefined;
  const blockReason = typeof body?.promptFeedback?.blockReason === 'string'
    ? body.promptFeedback.blockReason
    : undefined;

  return {
    provider: 'gemini-cliproxy',
    model,
    text,
    ...(finishReason ? { finishReason } : {}),
    ...(blockReason ? { blockReason } : {}),
    usage: {
      inputTokens: usageMetadata.promptTokenCount ?? 0,
      outputTokens: usageMetadata.candidatesTokenCount ?? 0,
      totalTokens: usageMetadata.totalTokenCount ?? 0,
      ...(typeof usageMetadata.thoughtsTokenCount === 'number'
        ? { thoughtsTokens: usageMetadata.thoughtsTokenCount }
        : {}),
      modalities
    }
  };
}

export class GeminiMediaService {
  private readonly config: typeof geminiMediaConfig;
  private readonly moduleLogger = logger.createModuleLogger('gemini-media-service');

  constructor(config: typeof geminiMediaConfig = geminiMediaConfig) {
    this.config = config;
  }

  async analyze(input: GeminiMediaAnalyzeInput): Promise<GeminiMediaAnalyzeResult> {
    const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
    if (!prompt) {
      throw new GeminiMediaValidationError('A non-empty text prompt is required.');
    }

    const media = Array.isArray(input?.media) ? input.media : [];
    if (media.length === 0) {
      throw new GeminiMediaValidationError('At least one media part is required.');
    }

    if (!this.config.apiKey) {
      throw new GeminiMediaConfigError(
        'Gemini media proxy key is not configured (GEMINI_MEDIA_API_KEY / CODEX_PROXY_API_KEY).'
      );
    }

    const model = (typeof input.model === 'string' && input.model.trim()) || this.config.model;
    const resolvedParts = await this.resolveInlineParts(media);
    const payload = buildGeminiMediaPayload(
      { prompt, systemInstruction: input.systemInstruction, generationConfig: input.generationConfig },
      resolvedParts
    );

    const url = `${this.config.baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.config.apiKey
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (error) {
      throw new GeminiMediaRequestError(
        `Gemini media request failed to reach proxy: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      this.moduleLogger.error('Gemini media generateContent returned non-2xx', {
        status: response.status,
        model,
        body: errorText.slice(0, 500)
      });
      throw new GeminiMediaRequestError(
        `Gemini media API error (${response.status} ${response.statusText}): ${errorText.slice(0, 500)}`,
        response.status
      );
    }

    const body = await response.json();
    const result = parseGeminiMediaResponse(body, model);
    this.moduleLogger.info('Gemini media analysis complete', {
      model,
      parts: resolvedParts.length,
      modalities: result.usage.modalities,
      outputTokens: result.usage.outputTokens
    });
    return result;
  }

  private async resolveInlineParts(media: GeminiMediaPart[]): Promise<ResolvedInlinePart[]> {
    const resolved: ResolvedInlinePart[] = [];

    for (let index = 0; index < media.length; index += 1) {
      const part = media[index];
      const mimeType = typeof part?.mimeType === 'string' ? part.mimeType.trim() : '';
      if (!mimeType) {
        throw new GeminiMediaValidationError(`media[${index}] is missing mimeType.`);
      }

      let data: string;
      if (typeof part.dataBase64 === 'string' && part.dataBase64.trim()) {
        data = part.dataBase64.trim();
        if (!BASE64_PATTERN.test(data)) {
          throw new GeminiMediaValidationError(`media[${index}].dataBase64 is not valid base64.`);
        }
        if (base64ByteLength(data) > this.config.maxInlineBytes) {
          throw new GeminiMediaValidationError(
            `media[${index}] exceeds the inline size limit of ${this.config.maxInlineBytes} bytes.`
          );
        }
      } else if (typeof part.filePath === 'string' && part.filePath.trim()) {
        const buffer = await this.readMediaFile(part.filePath.trim(), index);
        data = buffer.toString('base64');
      } else {
        throw new GeminiMediaValidationError(`media[${index}] requires either dataBase64 or filePath.`);
      }

      resolved.push({ mimeType, data });
    }

    return resolved;
  }

  private async readMediaFile(filePath: string, index: number): Promise<Buffer> {
    // Stat before read so an oversized file is rejected on its size metadata
    // rather than after being pulled fully into memory (OOM guard: the filePath
    // branch has no equivalent of the express body-size limit).
    let stat: import('fs').Stats;
    try {
      stat = await fs.stat(filePath);
    } catch (error) {
      throw new GeminiMediaValidationError(
        `media[${index}] file could not be read (${filePath}): ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!stat.isFile()) {
      throw new GeminiMediaValidationError(`media[${index}] path is not a regular file (${filePath}).`);
    }
    if (stat.size > this.config.maxInlineBytes) {
      throw new GeminiMediaValidationError(
        `media[${index}] (${filePath}) exceeds the inline size limit of ${this.config.maxInlineBytes} bytes.`
      );
    }

    try {
      return await fs.readFile(filePath);
    } catch (error) {
      throw new GeminiMediaValidationError(
        `media[${index}] file could not be read (${filePath}): ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

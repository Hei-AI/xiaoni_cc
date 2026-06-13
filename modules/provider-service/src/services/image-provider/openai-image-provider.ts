import { fetch, File, FormData } from 'undici';
import { aiConfig } from '../../config';
import { logger } from '../../utils/logger';
import {
  buildCodexUserAgent,
  extractCodexAccountId,
  resolveCodexOAuthCredential
} from '../llm-provider/codex-oauth';
import {
  ImageEditRequest,
  ImageGenerateRequest,
  ImageProviderResult,
  NormalizedImageFile,
  NormalizedImageOptions
} from './types';
import {
  ImageProviderError,
  normalizeEditImages,
  normalizeEditMask,
  normalizeImageApiResponse,
  normalizeImageOptions,
  toSafeImageLogMetadata
} from './validation';

type OpenAIImageProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  authMode?: ImageProviderAuthMode;
  codexBaseUrl?: string;
  codexGenerationPaths?: string[];
  codexEditPaths?: string[];
  codexResponsesPath?: string;
  timeoutMs?: number;
};

type ImageProviderAuthMode = 'auto' | 'openai' | 'codex';

type ImageTransport = {
  mode: 'openai' | 'codex';
  accessToken: string;
  baseUrl: string;
  generationPaths: string[];
  editPaths: string[];
  responsesPath?: string;
  accountId?: string | null;
};

type ImageRequestKind = 'generation' | 'edit';

type CodexImageError = {
  message: string;
  code?: string;
};

export class OpenAIImageProvider {
  private readonly openAiApiKey?: string;
  private readonly openAiBaseUrl: string;
  private readonly authMode: ImageProviderAuthMode;
  private readonly codexBaseUrl: string;
  private readonly codexGenerationPaths: string[];
  private readonly codexEditPaths: string[];
  private readonly codexResponsesPath: string;
  private readonly timeoutMs: number;
  private readonly moduleLogger = logger.createModuleLogger('image-provider-openai');

  constructor(config: OpenAIImageProviderConfig = {}) {
    this.openAiApiKey = config.apiKey || aiConfig.openai_api_key || process.env.OPENAI_API_KEY || undefined;
    this.openAiBaseUrl = this.normalizeBaseUrl(
      config.baseUrl || process.env.IMAGE_PROVIDER_OPENAI_BASE_URL || aiConfig.openai_base_url || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    );
    this.authMode = this.normalizeAuthMode(config.authMode || process.env.IMAGE_PROVIDER_AUTH_MODE || 'auto');
    this.codexBaseUrl = this.normalizeBaseUrl(
      config.codexBaseUrl || process.env.IMAGE_PROVIDER_CODEX_BASE_URL || aiConfig.codex_base_url || process.env.CODEX_BASE_URL || 'https://chatgpt.com/backend-api'
    );
    this.codexGenerationPaths = config.codexGenerationPaths || this.normalizePathList(
      process.env.IMAGE_PROVIDER_CODEX_GENERATION_PATHS ||
        process.env.IMAGE_PROVIDER_CODEX_GENERATIONS_PATHS ||
        process.env.IMAGE_PROVIDER_GENERATION_PATHS,
      ['/codex/images/generations', '/images/generations']
    );
    this.codexEditPaths = config.codexEditPaths || this.normalizePathList(
      process.env.IMAGE_PROVIDER_CODEX_EDIT_PATHS ||
        process.env.IMAGE_PROVIDER_EDITS_PATHS,
      ['/codex/images/edits', '/images/edits']
    );
    this.codexResponsesPath = this.normalizePath(
      config.codexResponsesPath ||
        process.env.IMAGE_PROVIDER_CODEX_RESPONSES_PATH ||
        aiConfig.codex_responses_path ||
        process.env.CODEX_RESPONSES_PATH ||
        '/codex/responses'
    );
    this.timeoutMs = config.timeoutMs || Number.parseInt(process.env.IMAGE_PROVIDER_TIMEOUT_MS || '300000', 10);
  }

  async generate(input: ImageGenerateRequest): Promise<ImageProviderResult> {
    const options = normalizeImageOptions(input);
    this.moduleLogger.info('Starting image generation', toSafeImageLogMetadata({
      operation: 'generate',
      options
    }));

    const transport = await this.resolveTransport();
    if (transport.mode === 'codex') {
      const response = await this.postCodexResponses(transport, options);
      return this.buildResult({ ...response, provider: transport.mode }, options);
    }

    const response = await this.postJson(transport, transport.generationPaths, this.buildImagePayload(options));
    return this.buildResult({ ...response, provider: transport.mode }, options);
  }

  async edit(input: ImageEditRequest): Promise<ImageProviderResult> {
    const options = normalizeImageOptions(input);
    const images = normalizeEditImages(input);
    const mask = normalizeEditMask(input);
    this.moduleLogger.info('Starting image edit', toSafeImageLogMetadata({
      operation: 'edit',
      options,
      imageCount: images.length,
      maskBytes: mask?.bytes
    }));

    const transport = await this.resolveTransport();
    if (transport.mode === 'codex') {
      const response = await this.postCodexResponses(transport, options, images, mask);
      return this.buildResult({ ...response, provider: transport.mode }, options);
    }

    const response = await this.postForm(transport, transport.editPaths, () => this.buildEditForm(options, images, mask));
    return this.buildResult({ ...response, provider: transport.mode }, options);
  }

  buildImagePayload(options: NormalizedImageOptions): Record<string, unknown> {
    return {
      model: options.model,
      prompt: options.prompt,
      size: options.size,
      quality: options.quality,
      output_format: options.format,
      ...(options.background ? { background: options.background } : {}),
      ...(options.output_compression !== undefined ? { output_compression: options.output_compression } : {}),
      ...(options.n !== undefined ? { n: options.n } : {})
    };
  }

  private buildEditForm(options: NormalizedImageOptions, images: NormalizedImageFile[], mask?: NormalizedImageFile) {
    const form = new FormData();
    const payload = this.buildImagePayload(options);
    for (const [key, value] of Object.entries(payload)) {
      form.set(key, String(value));
    }

    for (const image of images) {
      const fieldName = images.length === 1 ? 'image' : 'image[]';
      form.append(fieldName, new File([image.buffer], image.filename, { type: image.mimeType }));
    }

    if (mask) {
      form.set('mask', new File([mask.buffer], mask.filename, { type: mask.mimeType }));
    }

    return form;
  }

  private async postJson(transport: ImageTransport, paths: string[], payload: Record<string, unknown>) {
    return await this.tryPaths(transport, paths, 'generation', (path, activeTransport) =>
      this.postJsonPath(activeTransport, path, payload)
    );
  }

  private async postJsonPath(transport: ImageTransport, path: string, payload: Record<string, unknown>) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${transport.baseUrl}${this.normalizePath(path)}`, {
        method: 'POST',
        headers: this.buildHeaders(transport, true),
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      return await this.parseResponse(response, transport);
    } catch (error) {
      this.throwIfAbortError(error, `${transport.mode === 'codex' ? 'Codex' : 'OpenAI'} Image API`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async postForm(transport: ImageTransport, paths: string[], buildForm: () => FormData) {
    return await this.tryPaths(transport, paths, 'edit', (path, activeTransport) =>
      this.postFormPath(activeTransport, path, buildForm())
    );
  }

  private async postFormPath(transport: ImageTransport, path: string, form: FormData) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${transport.baseUrl}${this.normalizePath(path)}`, {
        method: 'POST',
        headers: this.buildHeaders(transport, false),
        body: form,
        signal: controller.signal
      });
      return await this.parseResponse(response, transport);
    } catch (error) {
      this.throwIfAbortError(error, `${transport.mode === 'codex' ? 'Codex' : 'OpenAI'} Image API`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async postCodexResponses(
    transport: ImageTransport,
    options: NormalizedImageOptions,
    images: NormalizedImageFile[] = [],
    mask?: NormalizedImageFile
  ) {
    const count = Math.max(1, options.n || 1);
    const singleOptions = {
      ...options,
      n: undefined
    };
    const results = [];
    for (let index = 0; index < count; index += 1) {
      results.push(await this.postSingleCodexResponse(transport, singleOptions, images, mask));
    }

    return {
      data: results.flatMap((result) => result.data || []),
      usage: results.map((result) => result.usage).filter(Boolean)
    };
  }

  private async postSingleCodexResponse(
    transport: ImageTransport,
    options: NormalizedImageOptions,
    images: NormalizedImageFile[],
    mask?: NormalizedImageFile
  ) {
    try {
      return await this.postCodexResponsesOnce(transport, options, images, mask);
    } catch (error: any) {
      const status = error?.status || error?.statusCode;
      if (status !== 401 && status !== 403) {
        throw error;
      }

      const refreshedTransport = await this.resolveTransport(true);
      if (refreshedTransport.mode !== 'codex' || refreshedTransport.accessToken === transport.accessToken) {
        throw error;
      }

      this.moduleLogger.warn('Retrying Codex image response with refreshed OAuth token', {
        status
      });
      return await this.postCodexResponsesOnce(refreshedTransport, options, images, mask);
    }
  }

  private async postCodexResponsesOnce(
    transport: ImageTransport,
    options: NormalizedImageOptions,
    images: NormalizedImageFile[],
    mask?: NormalizedImageFile
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${transport.baseUrl}${transport.responsesPath || this.codexResponsesPath}`, {
        method: 'POST',
        headers: this.buildHeaders(transport, true, 'text/event-stream'),
        body: JSON.stringify(this.buildCodexResponsesPayload(options, images, mask)),
        signal: controller.signal
      });
      return await this.parseCodexResponsesResponse(response);
    } catch (error) {
      this.throwIfAbortError(error, 'Codex Image API');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async tryPaths(
    transport: ImageTransport,
    paths: string[],
    kind: ImageRequestKind,
    request: (path: string, transport: ImageTransport) => Promise<any>
  ) {
    let activeTransport = transport;
    let lastError: ImageProviderError | null = null;

    for (const [index, path] of paths.entries()) {
      try {
        return await request(path, activeTransport);
      } catch (error: any) {
        const status = error?.status || error?.statusCode;
        const canTryNextPath = activeTransport.mode === 'codex' && (status === 404 || status === 405) && index < paths.length - 1;
        if (canTryNextPath) {
          lastError = error;
          this.moduleLogger.warn('Image provider path was not accepted; trying fallback path', {
            mode: activeTransport.mode,
            kind,
            status,
            path: this.normalizePath(path),
            nextPath: this.normalizePath(paths[index + 1])
          });
          continue;
        }

        const canRefresh = activeTransport.mode === 'codex' && (status === 401 || status === 403);
        if (canRefresh) {
          const refreshedTransport = await this.resolveTransport(true);
          if (refreshedTransport.mode === 'codex' && refreshedTransport.accessToken !== activeTransport.accessToken) {
            this.moduleLogger.warn('Retrying Codex image request with refreshed OAuth token', {
              kind,
              status
            });
            activeTransport = refreshedTransport;
            return await request(path, activeTransport);
          }
        }

        throw error;
      }
    }

    throw lastError || new ImageProviderError(`No ${kind} endpoint path is configured for image provider`, 503);
  }

  private async parseResponse(response: any, transport: ImageTransport) {
    const text = await response.text();
    let json: any = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (_error) {
        json = null;
      }
    }

    if (!response.ok) {
      const message = typeof json?.error?.message === 'string'
        ? json.error.message
        : `${transport.mode === 'codex' ? 'Codex' : 'OpenAI'} Image API failed with HTTP ${response.status}`;
      throw new ImageProviderError(message, response.status);
    }

    if (!json || !Array.isArray(json.data)) {
      throw new ImageProviderError('OpenAI Image API returned an invalid response', 502);
    }

    return json;
  }

  private async parseCodexResponsesResponse(response: any) {
    const text = await response.text();
    const events = this.parseSsePayload(text);

    if (!response.ok) {
      const json = this.tryParseJson(text);
      const errorEvent = events.find((event) => event?.type === 'error' || event?.type === 'response.failed');
      const codexError = this.extractCodexError(errorEvent);
      const message = json?.error?.message || codexError?.message || `Codex Image API failed with HTTP ${response.status}`;
      throw new ImageProviderError(message, response.status);
    }

    const failedEvent = events.find((event) => event?.type === 'error' || event?.type === 'response.failed');
    if (failedEvent) {
      const codexError = this.extractCodexError(failedEvent);
      throw new ImageProviderError(codexError?.message || 'Codex image generation failed', this.statusForCodexError(codexError));
    }

    const imageItems = events
      .filter((event) => event?.type === 'response.output_item.done' && event?.item?.type === 'image_generation_call')
      .map((event) => event.item)
      .filter((item) => typeof item?.result === 'string' && item.result.length > 0);

    if (imageItems.length === 0) {
      throw new ImageProviderError('Codex image generation returned no image result', 500);
    }

    const completed = [...events].reverse().find((event) => event?.type === 'response.completed');
    return {
      data: imageItems.map((item) => ({
        b64_json: item.result,
        revised_prompt: typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined
      })),
      ...(completed?.response?.usage ? { usage: completed.response.usage } : {})
    };
  }

  private buildResult(response: any, options: NormalizedImageOptions): ImageProviderResult {
    const images = normalizeImageApiResponse(response, options.format);
    if (images.length === 0) {
      throw new ImageProviderError('OpenAI Image API returned no images', 502);
    }

    return {
      ...(response?.provider === 'openai' || response?.provider === 'codex' ? { provider: response.provider } : {}),
      model: options.model,
      images,
      ...(response?.usage ? { usage: response.usage } : {})
    };
  }

  private async resolveTransport(forceRefresh = false): Promise<ImageTransport> {
    if ((this.authMode === 'auto' || this.authMode === 'openai') && this.openAiApiKey) {
      return {
        mode: 'openai',
        accessToken: this.openAiApiKey,
        baseUrl: this.openAiBaseUrl,
        generationPaths: ['/images/generations'],
        editPaths: ['/images/edits']
      };
    }

    if (this.authMode === 'openai') {
      throw new ImageProviderError('Missing OPENAI_API_KEY for image provider', 503);
    }

    const { credential } = await resolveCodexOAuthCredential(aiConfig, forceRefresh);
    if (!credential?.access) {
      throw new ImageProviderError(
        'Missing image provider credentials. Provide OPENAI_API_KEY or Codex OAuth credentials at /root/.codex/auth.json.',
        503
      );
    }

    return {
      mode: 'codex',
      accessToken: credential.access,
      accountId: credential.accountId || extractCodexAccountId(credential.access),
      baseUrl: this.codexBaseUrl,
      generationPaths: this.codexGenerationPaths,
      editPaths: this.codexEditPaths,
      responsesPath: this.codexResponsesPath
    };
  }

  private buildHeaders(transport: ImageTransport, jsonBody: boolean, accept?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${transport.accessToken}`
    };

    if (jsonBody) {
      headers['Content-Type'] = 'application/json';
    }

    if (transport.mode === 'codex') {
      headers.accept = accept || 'application/json';
      headers.originator = 'openclaw';
      headers['OpenAI-Beta'] = 'responses=experimental';
      headers['User-Agent'] = buildCodexUserAgent();
      if (transport.accountId) {
        headers['chatgpt-account-id'] = transport.accountId;
      }
    }

    return headers;
  }

  private buildCodexResponsesPayload(
    options: NormalizedImageOptions,
    images: NormalizedImageFile[],
    mask?: NormalizedImageFile
  ): Record<string, unknown> {
    const content: Record<string, unknown>[] = [
      {
        type: 'input_text',
        text: mask
          ? `${options.prompt}\n\nUse the final reference image as the edit mask.`
          : options.prompt
      },
      ...images.map((image) => ({
        type: 'input_image',
        image_url: this.toDataUrl(image)
      }))
    ];

    if (mask) {
      content.push({
        type: 'input_image',
        image_url: this.toDataUrl(mask)
      });
    }

    return {
      model: process.env.IMAGE_PROVIDER_CODEX_RESPONSE_MODEL || aiConfig.model_name || process.env.AI_MODEL_NAME || 'gpt-5.4-mini',
      store: false,
      stream: true,
      instructions: 'Use the image_generation tool to create exactly the requested image. Return the image result, not explanatory text.',
      input: [
        {
          role: 'user',
          content
        }
      ],
      tools: [
        {
          type: 'image_generation',
          model: options.model,
          size: options.size,
          quality: options.quality,
          output_format: options.format,
          background: options.background || 'auto',
          ...(options.format !== 'png' && options.output_compression !== undefined
            ? { output_compression: options.output_compression }
            : {})
        }
      ],
      parallel_tool_calls: true
    };
  }

  private toDataUrl(image: NormalizedImageFile): string {
    return `data:${image.mimeType};base64,${image.buffer.toString('base64')}`;
  }

  private parseSsePayload(payload: string): any[] {
    return payload
      .split(/\r?\n\r?\n/)
      .map((block) =>
        block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n')
      )
      .filter((line) => line.length > 0 && line !== '[DONE]')
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  private tryParseJson(value: string): any | null {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private extractCodexError(event: any): CodexImageError | null {
    const candidates = [
      event?.error,
      event?.response?.error,
      event?.item?.error
    ];

    for (const candidate of candidates) {
      if (typeof candidate?.message === 'string' && candidate.message.trim().length > 0) {
        return {
          message: candidate.message,
          ...(typeof candidate.code === 'string'
            ? { code: candidate.code }
            : typeof candidate.type === 'string'
              ? { code: candidate.type }
              : {})
        };
      }
    }

    if (typeof event?.message === 'string' && event.message.trim().length > 0) {
      return { message: event.message };
    }

    return null;
  }

  private statusForCodexError(error: CodexImageError | null): number {
    if (!error?.code) {
      return 500;
    }

    if (error.code === 'moderation_blocked' || error.code.endsWith('_user_error')) {
      return 400;
    }

    return 500;
  }

  private throwIfAbortError(error: unknown, providerName: string): never | void {
    if (error instanceof Error && (error.name === 'AbortError' || error.message === 'This operation was aborted')) {
      throw new ImageProviderError(`${providerName} timed out after ${Math.round(this.timeoutMs / 1000)} seconds`, 500);
    }
  }

  private normalizeBaseUrl(value: string): string {
    return value.replace(/\/+$/, '');
  }

  private normalizePath(value: string): string {
    return value.startsWith('/') ? value : `/${value}`;
  }

  private normalizePathList(value: string | undefined, fallback: string[]): string[] {
    if (!value) {
      return fallback;
    }

    const paths = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => this.normalizePath(item));

    return paths.length > 0 ? paths : fallback;
  }

  private normalizeAuthMode(value: string): ImageProviderAuthMode {
    if (value === 'openai' || value === 'codex' || value === 'auto') {
      return value;
    }

    this.moduleLogger.warn('Invalid IMAGE_PROVIDER_AUTH_MODE; falling back to auto', {
      value
    });
    return 'auto';
  }
}

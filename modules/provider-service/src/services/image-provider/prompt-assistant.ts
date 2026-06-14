import { aiConfig } from '../../config';
import { UnifiedLLMConfig } from '../../types';
import { createProviderClient } from '../llm-provider';
import { extractNamedFunctionCallArgsFromOpenAIResponse } from '../llm-provider/helpers';
import { LLMProvider, OpenResponseToolDefinition } from '../llm-provider/types';
import { withReplayLlmCallId } from '../provider-replay-ledger';
import { ImagePromptPattern, ImagePromptUseCase, selectImagePromptPatterns } from './prompt-patterns';

const TOOL_NAME = 'compose_image_prompt';
const MAX_PROMPT_LENGTH = 8000;

export type ImagePromptAssistantMode = 'generate' | 'edit';
export type ImagePromptAssistantRequest = {
  prompt?: unknown;
  mode?: unknown;
  size?: unknown;
  quality?: unknown;
  format?: unknown;
  referenceImages?: unknown;
};

export type ImagePromptAssistantResult = {
  provider?: 'codex';
  llmCallId?: string;
  usage?: unknown;
  requestFormatVersion?: string;
  wireProviderFormat?: string;
  finalPrompt: string;
  detectedUseCase: ImagePromptUseCase;
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
  suggested: {
    size?: string;
    quality?: string;
    format?: string;
  };
  warnings: string[];
  sourcePatterns: Array<{
    id: string;
    label: string;
    useCase: ImagePromptUseCase;
    sourceUrl?: string;
  }>;
  modelName: string;
};

type ImagePromptAssistantDeps = {
  providerFactory?: (providerId: 'codex') => LLMProvider;
  modelName?: string;
};

const IMAGE_PROMPT_TOOL: OpenResponseToolDefinition = {
  type: 'function',
  function: {
    name: TOOL_NAME,
    description: 'Return a professional GPT image prompt plan from a plain user image request.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['finalPrompt', 'detectedUseCase', 'summary', 'sections', 'suggested', 'warnings'],
      properties: {
        finalPrompt: {
          type: 'string',
          description: 'The final prompt ready to send to gpt-image-2. Preserve any exact visible text requested by the user.'
        },
        detectedUseCase: {
          type: 'string',
          enum: ['portrait', 'poster', 'product', 'character', 'scene', 'ui', 'edit', 'general']
        },
        summary: {
          type: 'string',
          description: 'One short sentence explaining how the prompt was improved.'
        },
        sections: {
          type: 'object',
          additionalProperties: false,
          required: ['subject', 'scene', 'style', 'composition', 'camera', 'lighting', 'details', 'constraints'],
          properties: {
            subject: { type: 'string' },
            scene: { type: 'string' },
            style: { type: 'string' },
            composition: { type: 'string' },
            camera: { type: 'string' },
            lighting: { type: 'string' },
            details: { type: 'string' },
            constraints: { type: 'string' }
          }
        },
        suggested: {
          type: 'object',
          additionalProperties: false,
          properties: {
            size: { type: 'string' },
            quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high'] },
            format: { type: 'string', enum: ['png', 'jpeg', 'webp'] }
          }
        },
        warnings: {
          type: 'array',
          items: { type: 'string' }
        }
      }
    }
  }
};

function normalizeMode(value: unknown): ImagePromptAssistantMode {
  return value === 'edit' ? 'edit' : 'generate';
}

function normalizePrompt(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Prompt is required');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Prompt is required');
  }
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Prompt is too long; keep it under ${MAX_PROMPT_LENGTH} characters`);
  }
  return trimmed;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeReferenceImages(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 6).map((item, index) => {
    const record = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
    return {
      index: index + 1,
      id: normalizeString(record.id),
      name: normalizeString(record.name) || normalizeString(record.filename) || `reference-${index + 1}`,
      mimeType: normalizeString(record.mimeType) || normalizeString(record.mime_type),
      hasImageData: typeof record.dataUrl === 'string'
        || typeof record.data_url === 'string'
        || typeof record.base64 === 'string'
        || typeof record.b64_json === 'string'
    };
  });
}

function createConfig(modelName: string): UnifiedLLMConfig {
  return {
    id: 'image-prompt-assistant',
    name: 'Image Prompt Assistant',
    category: 'image',
    model: {
      name: modelName,
      provider: 'codex',
      providerSpecific: {
        reasoningEffort: process.env.IMAGE_PROMPT_ASSISTANT_REASONING_EFFORT || 'low'
      }
    },
    generation: {
      temperature: 0.35,
      topP: 0.8,
      maxOutputTokens: 1800
    },
    thinking: {
      reasoningEffort: process.env.IMAGE_PROMPT_ASSISTANT_REASONING_EFFORT || 'low'
    },
    safety: [],
    tools: {
      functionCalling: {
        mode: 'ANY'
      }
    },
    context: {},
    performance: {
      timeout: Number.parseInt(process.env.IMAGE_PROMPT_ASSISTANT_TIMEOUT_MS || '120000', 10)
    },
    version: {
      version: '1.0.0',
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'provider-service',
      isActive: true
    }
  };
}

function buildInstructions() {
  return [
    '你是 gpt-image-2 图像创作提示词助手。',
    '把用户的普通描述转换成专业、可直接用于图像生成的 prompt。',
    '目标不是堆形容词，而是补齐主体、场景、风格、构图、镜头、光照、材质细节和约束。',
    '不要逐字复制参考模板。只学习结构和视觉决策方式。',
    '如果用户要求画面中出现具体文字，必须逐字保留该文字。',
    '如果是 edit 模式，明确哪些元素保持不变、哪些元素改变。',
    '不要输出解释性正文。必须通过 compose_image_prompt 工具返回结构化结果。'
  ].join('\n');
}

function buildUserPayload(input: {
  prompt: string;
  mode: ImagePromptAssistantMode;
  size?: string;
  quality?: string;
  format?: string;
  referenceImages: ReturnType<typeof normalizeReferenceImages>;
  patterns: ImagePromptPattern[];
}) {
  return {
    user_brief: input.prompt,
    mode: input.mode,
    current_parameters: {
      size: input.size,
      quality: input.quality,
      format: input.format
    },
    reference_images: input.referenceImages,
    style_patterns: input.patterns.map((pattern) => ({
      id: pattern.id,
      label: pattern.label,
      use_case: pattern.useCase,
      prompt_dna: pattern.promptDna,
      source_url: pattern.sourceUrl
    })),
    output_rules: {
      final_prompt_language: 'Preserve user language where natural; English technical visual terms are allowed.',
      avoid_fake_parameters: true,
      do_not_claim_image_was_generated: true
    }
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Image prompt assistant returned missing ${field}`);
  }
  return value.trim();
}

function normalizeUseCase(value: unknown): ImagePromptUseCase {
  return value === 'portrait' || value === 'poster' || value === 'product' || value === 'character'
    || value === 'scene' || value === 'ui' || value === 'edit' || value === 'general'
    ? value
    : 'general';
}

function normalizeResult(args: Record<string, any>, patterns: ImagePromptPattern[], modelName: string): ImagePromptAssistantResult {
  const sections = args.sections && typeof args.sections === 'object' && !Array.isArray(args.sections)
    ? args.sections as Record<string, unknown>
    : {};
  const suggested = args.suggested && typeof args.suggested === 'object' && !Array.isArray(args.suggested)
    ? args.suggested as Record<string, unknown>
    : {};

  return {
    finalPrompt: requireString(args.finalPrompt, 'finalPrompt'),
    detectedUseCase: normalizeUseCase(args.detectedUseCase),
    summary: requireString(args.summary, 'summary'),
    sections: {
      subject: requireString(sections.subject, 'sections.subject'),
      scene: requireString(sections.scene, 'sections.scene'),
      style: requireString(sections.style, 'sections.style'),
      composition: requireString(sections.composition, 'sections.composition'),
      camera: requireString(sections.camera, 'sections.camera'),
      lighting: requireString(sections.lighting, 'sections.lighting'),
      details: requireString(sections.details, 'sections.details'),
      constraints: requireString(sections.constraints, 'sections.constraints')
    },
    suggested: {
      size: normalizeString(suggested.size),
      quality: normalizeString(suggested.quality),
      format: normalizeString(suggested.format)
    },
    warnings: Array.isArray(args.warnings)
      ? args.warnings.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0).map((item: string) => item.trim())
      : [],
    sourcePatterns: patterns.map((pattern) => ({
      id: pattern.id,
      label: pattern.label,
      useCase: pattern.useCase,
      sourceUrl: pattern.sourceUrl
    })),
    modelName
  };
}

export class ImagePromptAssistantService {
  private readonly providerFactory: (providerId: 'codex') => LLMProvider;
  private readonly modelName: string;

  constructor(deps: ImagePromptAssistantDeps = {}) {
    this.providerFactory = deps.providerFactory || ((providerId) => createProviderClient(providerId));
    this.modelName = deps.modelName
      || process.env.IMAGE_PROMPT_ASSISTANT_MODEL
      || process.env.IMAGE_PROVIDER_CODEX_RESPONSE_MODEL
      || aiConfig.model_name
      || 'gpt-5-mini';
  }

  async compose(input: ImagePromptAssistantRequest): Promise<ImagePromptAssistantResult> {
    const prompt = normalizePrompt(input.prompt);
    const mode = normalizeMode(input.mode);
    const patterns = selectImagePromptPatterns({ prompt, mode });
    const provider = this.providerFactory('codex');
    const config = createConfig(this.modelName);
	    const context = withReplayLlmCallId({
	      agentType: 'image_prompt_assistant',
	      promptName: 'image_prompt_assistant',
	      replayIdentityKey: 'xiaoni-internal'
	    }, 'image_prompt');
    const result = await provider.generateContent({
      modelName: this.modelName,
      providerConfig: config,
      request: {
        model: this.modelName,
        instructions: buildInstructions(),
        input: [
          {
            type: 'message',
            role: 'user',
            content: JSON.stringify(buildUserPayload({
              prompt,
              mode,
              size: normalizeString(input.size),
              quality: normalizeString(input.quality),
              format: normalizeString(input.format),
              referenceImages: normalizeReferenceImages(input.referenceImages),
              patterns
            }), null, 2)
          }
        ],
        tools: [IMAGE_PROMPT_TOOL],
        tool_choice: 'required',
        parallel_tool_calls: false,
        temperature: config.generation.temperature,
        top_p: config.generation.topP,
        max_output_tokens: config.generation.maxOutputTokens,
        store: false
      },
      context
    });
	    const parsed = extractNamedFunctionCallArgsFromOpenAIResponse(result.response, TOOL_NAME);
    if (!parsed) {
      throw new Error('Image prompt assistant returned no structured tool result');
    }

    return {
      ...normalizeResult(parsed, patterns, result.modelName),
      provider: 'codex',
      llmCallId: context.llmCallId,
      usage: result.usage,
      requestFormatVersion: result.requestFormatVersion,
      wireProviderFormat: result.wireProviderFormat
    };
  }
}

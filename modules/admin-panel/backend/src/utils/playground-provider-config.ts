import type {
  PlaygroundProviderConfig,
  PlaygroundProviderId,
} from '../types/playground';

const DEFAULT_VERSION = {
  version: '1.0.0',
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
  createdBy: 'playground',
  updatedBy: 'playground',
  isActive: true,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }

  return value;
}

function normalizeModelName(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function normalizePlaygroundProvider(value: unknown): PlaygroundProviderId {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'openai') return 'openai';
  if (normalized === 'codex' || normalized === 'openai-codex') return 'codex';
  if (
    normalized === 'codex-local' ||
    normalized === 'openai-codex-local' ||
    normalized === 'local-codex' ||
    normalized === 'codex-openai'
  ) return 'codex-local';
  if (normalized === 'custom') return 'custom';
  if (
    normalized === 'google-legacy' ||
    normalized === 'google' ||
    normalized === 'gemini-api' ||
    normalized === 'google-api'
  ) {
    return normalized === 'google' ? 'google' : 'google-legacy';
  }
  return 'google-gemini-cli';
}

export function defaultModelForPlaygroundProvider(provider: PlaygroundProviderId): string {
  switch (provider) {
    case 'openai':
      return 'gpt-5-mini';
    case 'codex-local':
      return 'gpt-5.5';
    case 'codex':
      return 'gpt-5-mini';
    case 'google':
    case 'google-legacy':
      return 'gemini-2.5-flash';
    case 'custom':
      return 'custom-model';
    case 'google-gemini-cli':
    default:
      return 'gemini-2.5-flash';
  }
}

export function createDefaultPlaygroundProviderConfig(
  provider: PlaygroundProviderId = 'google-gemini-cli'
): PlaygroundProviderConfig {
  return {
    id: 'playground-provider',
    name: 'Playground Provider Config',
    category: 'playground',
    model: {
      name: null,
      provider,
      providerSpecific: {},
    },
    generation: {
      temperature: 0.7,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 2048,
    },
    thinking: {},
    safety: [],
    tools: {},
    context: {},
    performance: {},
    version: { ...DEFAULT_VERSION },
  };
}

export function normalizePlaygroundProviderConfig(
  value: unknown,
  fallbackProvider?: PlaygroundProviderId
): PlaygroundProviderConfig {
  const record = asRecord(parseMaybeJson(value));
  if (!record) {
    return createDefaultPlaygroundProviderConfig(fallbackProvider);
  }

  const model = asRecord(record.model);
  if (model && typeof model.name === 'string' && typeof model.provider === 'string') {
    const provider = normalizePlaygroundProvider(model.provider);
    return {
      id: typeof record.id === 'string' ? record.id : 'playground-provider',
      name: typeof record.name === 'string' ? record.name : 'Playground Provider Config',
      description: typeof record.description === 'string' ? record.description : undefined,
      category: typeof record.category === 'string' ? record.category : 'playground',
      model: {
        ...model,
        name: normalizeModelName(model.name),
        provider,
        providerSpecific: asRecord(parseMaybeJson(model.providerSpecific)) || {},
        allowedTokenIds: Array.isArray(model.allowedTokenIds) ? model.allowedTokenIds.filter((item): item is number => typeof item === 'number') : undefined,
        fallbackModels: Array.isArray(model.fallbackModels) ? model.fallbackModels.filter((item): item is string => typeof item === 'string') : undefined,
      },
      generation: asRecord(parseMaybeJson(record.generation)) || {},
      thinking: asRecord(parseMaybeJson(record.thinking)) || {},
      safety: Array.isArray(parseMaybeJson(record.safety))
        ? (parseMaybeJson(record.safety) as Array<Record<string, unknown>>)
        : [],
      tools: asRecord(parseMaybeJson(record.tools)) || {},
      context: asRecord(parseMaybeJson(record.context)) || {},
      performance: asRecord(parseMaybeJson(record.performance)) || {},
      version: asRecord(parseMaybeJson(record.version)) || { ...DEFAULT_VERSION },
    };
  }

  const provider = normalizePlaygroundProvider(record.provider ?? fallbackProvider);
  const context = asRecord(parseMaybeJson(record.context)) || {};
  const generation = asRecord(parseMaybeJson(record.generation)) || {};
  const stopSequences = Array.isArray(generation.stopSequences)
    ? generation.stopSequences
    : Array.isArray(generation.stop)
      ? generation.stop
      : generation.stop !== undefined
        ? [generation.stop]
        : undefined;

  return {
    id: 'playground-provider',
    name: 'Playground Provider Config',
    category: 'playground',
    model: {
      name: normalizeModelName(context.modelName),
      provider,
      providerSpecific: asRecord(parseMaybeJson(record.providerSpecific)) || {},
    },
    generation: {
      ...generation,
      ...(stopSequences ? { stopSequences } : {}),
    },
    thinking: asRecord(parseMaybeJson(record.thinking)) || {},
    safety: Array.isArray(parseMaybeJson(record.safety))
      ? (parseMaybeJson(record.safety) as Array<Record<string, unknown>>)
      : [],
    tools: asRecord(parseMaybeJson(record.tools)) || {},
    context,
    performance: asRecord(parseMaybeJson(record.performance)) || {},
    version: { ...DEFAULT_VERSION },
  };
}

export function getPlaygroundProviderId(providerConfig: PlaygroundProviderConfig): PlaygroundProviderId {
  return normalizePlaygroundProvider(providerConfig.model?.provider);
}

export function getPlaygroundModelName(providerConfig: PlaygroundProviderConfig): string | null {
  return normalizeModelName(providerConfig.model?.name);
}

export function getPlaygroundProviderSpecific(providerConfig: PlaygroundProviderConfig): Record<string, unknown> {
  return asRecord(parseMaybeJson(providerConfig.model?.providerSpecific)) || {};
}

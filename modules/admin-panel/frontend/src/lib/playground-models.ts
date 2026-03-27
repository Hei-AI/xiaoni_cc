import type { PlaygroundProviderConfig } from '@/types/playground';
import {
  PLAYGROUND_PROVIDER_MODEL_OPTIONS,
  asRecord,
  defaultModelForProvider,
  normalizePromptProvider,
  parseMaybeJson,
  resolvePromptProviderConfig,
} from '@/lib/provider-config';

type PromptModelLike = {
  model_name?: string | null;
} | null | undefined;

export type PlaygroundNormalizedTools = {
  definitions: unknown[];
  toolChoice: unknown | null;
  extras: Record<string, unknown>;
};

function normalizeModelName(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export {
  PLAYGROUND_PROVIDER_MODEL_OPTIONS,
  asRecord,
  normalizePromptProvider,
  parseMaybeJson,
  resolvePromptProviderConfig,
};

function buildUniqueToolName(existingDefinitions: unknown[], baseName: string): string {
  const existingNames = new Set(
    existingDefinitions
      .map((definition) => getPlaygroundToolDefinitionName(definition, -1))
      .filter((name) => !name.startsWith('#'))
  );

  if (!existingNames.has(baseName)) {
    return baseName;
  }

  let suffix = 2;
  while (existingNames.has(`${baseName}_${suffix}`)) {
    suffix += 1;
  }

  return `${baseName}_${suffix}`;
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

export function getPlaygroundToolDefinitionName(value: unknown, index: number): string {
  const record = asRecord(value);
  const functionRecord = asRecord(record?.function);

  const candidates = [
    functionRecord?.name,
    record?.name,
    record?.toolName,
    record?.id,
  ];

  const name = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);
  if (typeof name === 'string') {
    return name;
  }

  return index >= 0 ? `#${index + 1}` : '#unknown';
}

export function normalizePlaygroundTools(
  tools: Record<string, unknown> | undefined
): PlaygroundNormalizedTools {
  const source = tools || {};
  const definitions = Array.isArray(source.definitions) ? source.definitions : [];
  const extras = Object.fromEntries(
    Object.entries(source).filter(([key]) => key !== 'definitions' && key !== 'toolChoice')
  );

  return {
    definitions,
    toolChoice: Object.prototype.hasOwnProperty.call(source, 'toolChoice') ? source.toolChoice ?? null : null,
    extras,
  };
}

export function createPlaygroundToolDefinition(existingDefinitions: unknown[]): Record<string, unknown> {
  const toolName = buildUniqueToolName(existingDefinitions, 'playground_tool');

  return {
    type: 'function',
    function: {
      name: toolName,
      description: 'Temporary playground tool',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  };
}

export function duplicatePlaygroundToolDefinition(
  definition: unknown,
  existingDefinitions: unknown[]
): unknown {
  const cloned = cloneJsonValue(definition);
  const record = asRecord(cloned);

  if (!record) {
    return createPlaygroundToolDefinition(existingDefinitions);
  }

  const functionRecord = asRecord(record.function);
  if (functionRecord && typeof functionRecord.name === 'string' && functionRecord.name.trim().length > 0) {
    return {
      ...record,
      function: {
        ...functionRecord,
        name: buildUniqueToolName(existingDefinitions, `${functionRecord.name.trim()}_copy`),
      },
    };
  }

  if (typeof record.name === 'string' && record.name.trim().length > 0) {
    return {
      ...record,
      name: buildUniqueToolName(existingDefinitions, `${record.name.trim()}_copy`),
    };
  }

  return cloned;
}

export function defaultModelForPlaygroundProvider(
  provider: PlaygroundProviderConfig['provider']
): string {
  return defaultModelForProvider(provider);
}

export function getPromptDefaultModelName(prompt: PromptModelLike): string | null {
  return normalizeModelName(prompt?.model_name);
}

export function derivePlaygroundModelOverride(
  providerConfig: PlaygroundProviderConfig | null | undefined,
  prompt: PromptModelLike
): string {
  const provider = providerConfig?.provider || 'google-gemini-cli';
  const storedModel = normalizeModelName(providerConfig?.context?.modelName);
  const promptModel = getPromptDefaultModelName(prompt);
  const providerDefaultModel = defaultModelForPlaygroundProvider(provider);

  if (!storedModel) {
    return '';
  }

  // Older cases persisted the prompt/provider default directly into context.modelName.
  if (promptModel && storedModel === promptModel) {
    return '';
  }

  if (!promptModel && storedModel === providerDefaultModel) {
    return '';
  }

  return storedModel;
}

export function applyPlaygroundModelOverride(
  providerConfig: PlaygroundProviderConfig,
  modelOverride: string
): PlaygroundProviderConfig {
  const normalizedOverride = normalizeModelName(modelOverride);
  const nextContext = {
    ...(providerConfig.context || {}),
  };

  if (normalizedOverride) {
    nextContext.modelName = normalizedOverride;
  } else {
    delete nextContext.modelName;
  }

  return {
    ...providerConfig,
    context: nextContext,
  };
}

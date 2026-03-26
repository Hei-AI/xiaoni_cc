import { UnifiedLLMConfig } from '../types';
import { createProviderClient, resolveProviderId } from './llm-provider';
import { OpenResponseCreateRequest, OpenResponseInputItem } from './llm-provider/types';

type DebugPayload = {
  canonicalRequest?: Record<string, any>;
  configOverride?: Record<string, any> | null;
  executionMode?: string;
  systemPrompt?: string;
  userInput?: string;
  messages?: Array<{ role: string; content: string }>;
  parameters?: Record<string, any>;
  model?: string;
  conversation_id?: string;
};

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);

  return normalized.length > 0 ? normalized : undefined;
}

function buildMessagesInput(systemPrompt: string | undefined, messages: Array<{ role: string; content: string }>): OpenResponseInputItem[] {
  const input: OpenResponseInputItem[] = [];
  if (systemPrompt && systemPrompt.trim()) {
    input.push({
      type: 'message',
      role: 'system',
      content: systemPrompt
    });
  }

  for (const message of messages) {
    const role = message.role === 'assistant'
      ? 'assistant'
      : message.role === 'system'
        ? 'system'
        : 'user';
    input.push({
      type: 'message',
      role,
      content: message.content
    });
  }

  return input;
}

function buildUnifiedConfig(
  modelName: string,
  provider: ReturnType<typeof resolveProviderId>,
  parameters: Record<string, any> = {},
  systemPrompt?: string,
  configOverride?: Record<string, any> | null
): UnifiedLLMConfig {
  if (configOverride && typeof configOverride === 'object' && configOverride.model) {
    return {
      ...(configOverride as UnifiedLLMConfig),
      model: {
        ...(configOverride.model as Record<string, any>),
        name: typeof (configOverride.model as Record<string, any>).name === 'string'
          ? (configOverride.model as Record<string, any>).name
          : modelName,
        provider
      }
    };
  }

  const modelConfig = parameters.model_config && typeof parameters.model_config === 'object'
    ? parameters.model_config
    : {};
  const advancedConfig = parameters.advanced_config && typeof parameters.advanced_config === 'object'
    ? parameters.advanced_config
    : {};
  const generationConfig = advancedConfig.generationConfig && typeof advancedConfig.generationConfig === 'object'
    ? advancedConfig.generationConfig
    : {};
  const thinkingConfig = advancedConfig.thinkingConfig && typeof advancedConfig.thinkingConfig === 'object'
    ? advancedConfig.thinkingConfig
    : {};
  const safetySettings = Array.isArray(advancedConfig.safetySettings)
    ? advancedConfig.safetySettings
    : [];
  const toolsConfig = advancedConfig.toolsConfig && typeof advancedConfig.toolsConfig === 'object'
    ? advancedConfig.toolsConfig
    : {};

  return {
    id: 'provider-debug',
    name: 'Provider Debug',
    category: 'custom',
    model: {
      name: modelName,
      provider,
      providerSpecific: modelConfig.providerSpecific && typeof modelConfig.providerSpecific === 'object'
        ? modelConfig.providerSpecific
        : {}
    },
    generation: {
      temperature: typeof generationConfig.temperature === 'number' ? generationConfig.temperature : undefined,
      topP: typeof generationConfig.topP === 'number' ? generationConfig.topP : undefined,
      topK: typeof generationConfig.topK === 'number' ? generationConfig.topK : undefined,
      maxOutputTokens: typeof generationConfig.maxOutputTokens === 'number' ? generationConfig.maxOutputTokens : undefined,
      stopSequences: normalizeStringArray(generationConfig.stopSequences)
    },
    thinking: {
      thinkingBudget: typeof thinkingConfig.thinkingBudget === 'number' ? thinkingConfig.thinkingBudget : undefined,
      includeThoughts: typeof thinkingConfig.includeThoughts === 'boolean' ? thinkingConfig.includeThoughts : undefined,
      reasoningEffort: typeof thinkingConfig.reasoningEffort === 'string' ? thinkingConfig.reasoningEffort : undefined
    },
    safety: safetySettings,
    tools: {
      ...toolsConfig,
      functionCalling: toolsConfig.functionCallingConfig && typeof toolsConfig.functionCallingConfig === 'object'
        ? {
            mode: toolsConfig.functionCallingConfig.mode
          }
        : undefined
    },
    context: {
      systemInstruction: systemPrompt
    },
    performance: {
      timeout: typeof generationConfig.timeout === 'number' ? generationConfig.timeout : undefined
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

function buildRequestFromMessages(
  modelName: string,
  systemPrompt: string | undefined,
  messages: Array<{ role: string; content: string }>,
  config: UnifiedLLMConfig
): OpenResponseCreateRequest {
  return {
    model: modelName,
    input: buildMessagesInput(systemPrompt, messages),
    instructions: undefined,
    temperature: config.generation.temperature,
    top_p: config.generation.topP,
    max_output_tokens: config.generation.maxOutputTokens,
    stop: config.generation.stopSequences,
    reasoning: config.thinking?.reasoningEffort
      ? {
          effort: config.thinking.reasoningEffort
        }
      : undefined
  };
}

export async function executeDebugRequest(payload: DebugPayload) {
  const canonicalRequest = payload.canonicalRequest && typeof payload.canonicalRequest === 'object'
    ? payload.canonicalRequest as OpenResponseCreateRequest
    : null;
  const messages = Array.isArray(payload.messages)
    ? payload.messages.filter(item => item && typeof item.content === 'string' && item.content.trim().length > 0)
    : (typeof payload.userInput === 'string' && payload.userInput.trim()
      ? [{ role: 'user', content: payload.userInput }]
      : []);
  const modelName = typeof payload.model === 'string' && payload.model.trim().length > 0
    ? payload.model
    : typeof canonicalRequest?.model === 'string' && canonicalRequest.model.trim().length > 0
      ? canonicalRequest.model
      : 'gemini-2.5-flash';

  const configOverride = payload.configOverride && typeof payload.configOverride === 'object'
    ? payload.configOverride
    : null;
  const providerId = resolveProviderId(configOverride as UnifiedLLMConfig | null, modelName);
  const config = buildUnifiedConfig(
    modelName,
    providerId,
    payload.parameters,
    payload.systemPrompt,
    configOverride
  );
  const request = canonicalRequest || buildRequestFromMessages(modelName, payload.systemPrompt, messages, config);
  const client = createProviderClient(providerId);
  const result = await client.generateContent({
    request,
    modelName,
    providerConfig: config,
    context: {
      conversationId: payload.conversation_id
    }
  });

  return {
    success: true,
    response: result.text,
    thinking: '',
    model: result.modelName,
    provider: result.provider,
    usage: {
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      total_tokens: result.usage.inputTokens + result.usage.outputTokens
    },
    performance: {
      processing_time_ms: result.usage.processingTimeMs
    },
    canonical_request: result.canonicalRequest,
    wire_request: result.wireRequest,
    canonical_response: result.canonicalResponse,
    wire_response: result.wireResponse,
    raw_response: result.rawResponse,
    debug_metadata: {
      execution_mode: payload.executionMode || (canonicalRequest ? 'exact_replay' : 'prompt_debug'),
      config_override_applied: Boolean(configOverride)
    }
  };
}

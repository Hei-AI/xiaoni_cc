import { v4 as uuidv4 } from 'uuid';
import { UnifiedLLMConfig } from '../types';
import { createProviderClient, resolveProviderId } from './llm-provider';
import { computeContextThresholds, resolveModelContextPolicy } from './llm-provider/model-context-policy';
import { OpenResponseCreateRequest, OpenResponseInputItem } from './llm-provider/types';
import { runtimeStoreService } from './runtime-store-service';
import { logger } from '../utils/logger';

const moduleLogger = logger.createModuleLogger('provider-debug-service');

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

type AgentExecutePayload = DebugPayload & {
  trace_id?: string;
  run_id?: string;
  agent_turn?: number;
  agent_type?: string;
  prompt_name?: string;
  llm_call_id?: string;
  input_start_index?: number | null;
  input_end_index?: number | null;
  input_stack_item_ids?: Array<string | number>;
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

function buildMessagesInput(messages: Array<{ role: string; content: string }>): OpenResponseInputItem[] {
  const input: OpenResponseInputItem[] = [];

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

function normalizeInstructions(systemPrompt: string | undefined): string | undefined {
  if (typeof systemPrompt !== 'string') {
    return undefined;
  }

  const trimmed = systemPrompt.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function resolveProviderContextSessionId(
  requestMetadata: Record<string, any> = {},
  request?: Pick<OpenResponseCreateRequest, 'prompt_cache_key'> | null,
  providerId?: string
) {
  const codexSessionId = normalizeString(requestMetadata.codex_session_id ?? request?.prompt_cache_key);
  if ((providerId === 'codex' || providerId === 'codex-local') && codexSessionId) {
    return codexSessionId;
  }
  return normalizeString(
    requestMetadata.session_id
    ?? requestMetadata.session_key
    ?? codexSessionId
  );
}

function normalizeUsageSourceKindFromExecutionMode(executionMode: string) {
  if (executionMode === 'image_vision_fork_no_persist' || executionMode === 'image_vision_fork') {
    return 'image_vision_fork';
  }
  return (executionMode || 'codex_provider')
    .replace(/_no_persist$/u, '')
    .replace(/[^a-z0-9_:-]+/giu, '_')
    .replace(/_+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .toLowerCase()
    .slice(0, 32) || 'codex_provider';
}

export function identityKeyForProviderUsage(sourceKind: string, replayIdentityKey?: string) {
  if (sourceKind === 'image_vision_fork' || sourceKind === 'cache_heartbeat') {
    return 'xiaoni';
  }
  if (sourceKind === 'subconscious_agent_fork') {
    return 'xiaoni';
  }
  return replayIdentityKey || 'xiaoni-internal';
}

export function shouldRecordCodexProviderUsageEvent(params: {
  persistLlmCall: boolean;
  provider: string;
  executionMode: string;
}) {
  if (params.persistLlmCall) {
    return false;
  }
  // Record lightweight provider usage events for codex AND anthropic non-persist
  // non-fork calls (e.g. sleep cache heartbeat) so the usage observatory still
  // sees their token cost. The three forks below stay no-persist for all providers.
  if (params.provider !== 'codex' && params.provider !== 'codex-local' && params.provider !== 'anthropic') {
    return false;
  }
  if (
    params.executionMode === 'core_memory_compression_fork_no_persist'
    || params.executionMode === 'core_memory_compression_fork'
    || params.executionMode === 'subconscious_agent_fork_no_persist'
    || params.executionMode === 'subconscious_agent_fork'
    || params.executionMode === 'image_vision_fork_no_persist'
    || params.executionMode === 'image_vision_fork'
  ) {
    return false;
  }
  return true;
}

export function buildUnifiedConfig(
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

export function buildRequestFromMessages(
  modelName: string,
  systemPrompt: string | undefined,
  messages: Array<{ role: string; content: string }>,
  config: UnifiedLLMConfig
): OpenResponseCreateRequest {
  return {
    model: modelName,
    input: buildMessagesInput(messages),
    instructions: normalizeInstructions(systemPrompt),
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

async function executeProviderRequest(
  payload: AgentExecutePayload,
  executionMode: string,
  persistLlmCall: boolean,
  signal?: AbortSignal
) {
  const llmCallId = payload.llm_call_id || `llm_${Date.now()}_${uuidv4().slice(0, 8)}`;
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
  const requestMetadata = canonicalRequest?.metadata && typeof canonicalRequest.metadata === 'object'
    ? canonicalRequest.metadata
    : {};
  const client = createProviderClient(providerId);
  const providerContext = {
    traceId: payload.trace_id,
    conversationId: payload.conversation_id,
    agentTurn: payload.agent_turn,
    agentType: payload.agent_type,
    llmCallId,
    promptName: payload.prompt_name,
    replayIdentityKey: persistLlmCall ? 'xiaoni' : 'xiaoni-internal',
    sessionId: resolveProviderContextSessionId(requestMetadata, request, providerId),
    turnId: normalizeString(payload.run_id ?? requestMetadata.turn_id ?? requestMetadata.run_id),
    sandbox: normalizeString(requestMetadata.sandbox) || 'none',
    executionMode
  };
  const startedAt = Date.now();
  const result = await client.generateContent({
    request,
    modelName,
    providerConfig: config,
    context: providerContext,
    signal
  });
  const finishedAt = Date.now();
  const contextPolicy = resolveModelContextPolicy(modelName, config);
  const contextThresholds = contextPolicy
    ? computeContextThresholds(contextPolicy, request.max_output_tokens)
    : null;

  let recordedSlice: Awaited<ReturnType<typeof runtimeStoreService.recordLlmCall>> | null = null;
  if (persistLlmCall) {
    recordedSlice = await runtimeStoreService.recordLlmCall({
      traceId: payload.trace_id,
      runId: payload.run_id,
      conversationId: payload.conversation_id,
      llmCallId,
      agentTurn: payload.agent_turn,
      agentType: payload.agent_type,
      promptName: payload.prompt_name,
      inputStartIndex: payload.input_start_index ?? null,
      inputEndIndex: payload.input_end_index ?? null,
      inputStackItemIds: Array.isArray(payload.input_stack_item_ids) ? payload.input_stack_item_ids : [],
      modelName: result.modelName,
      modelProvider: result.provider,
      canonicalRequest: result.canonicalRequest as Record<string, unknown>,
      wireRequest: result.wireRequest as Record<string, unknown>,
      wireRequestHeaders: result.wireRequestHeaders || null,
      wireRequestUrl: result.wireRequestUrl || null,
      canonicalResponse: result.canonicalResponse as Record<string, unknown>,
      wireResponse: result.wireResponse as Record<string, unknown>,
      wireResponseHeaders: result.wireResponseHeaders || null,
      wireResponseStatus: result.wireResponseStatus ?? null,
      wireResponseStatusText: result.wireResponseStatusText || null,
      rawResponse: result.rawResponse as Record<string, unknown>,
      outputItems: Array.isArray(result.canonicalResponse?.output) ? result.canonicalResponse.output : [],
      effectiveUnifiedConfig: config as unknown as Record<string, unknown>,
      processedResponse: result.text,
      usage: {
        ...result.usage,
        processingTimeMs: result.usage.processingTimeMs || (finishedAt - startedAt)
      },
      requestFormatVersion: result.requestFormatVersion,
      wireProviderFormat: result.wireProviderFormat
    });
	  }
  if (shouldRecordCodexProviderUsageEvent({
    persistLlmCall,
    provider: result.provider,
    executionMode
  })) {
    const sourceKind = normalizeUsageSourceKindFromExecutionMode(executionMode);
    await runtimeStoreService.recordCodexProviderUsageEvent({
      sourceKind,
      identityKey: identityKeyForProviderUsage(sourceKind, providerContext.replayIdentityKey),
      traceId: payload.trace_id,
      runId: payload.run_id,
      conversationId: payload.conversation_id,
      llmCallId,
      modelName: result.modelName,
      modelProvider: result.provider,
      canonicalRequest: result.canonicalRequest as Record<string, unknown>,
      wireRequest: result.wireRequest as Record<string, unknown>,
      wireRequestHeaders: result.wireRequestHeaders || null,
      wireRequestUrl: result.wireRequestUrl || null,
      canonicalResponse: result.canonicalResponse as Record<string, unknown>,
      wireResponse: result.wireResponse as Record<string, unknown>,
      wireResponseHeaders: result.wireResponseHeaders || null,
      wireResponseStatus: result.wireResponseStatus ?? null,
      wireResponseStatusText: result.wireResponseStatusText || null,
      rawResponse: result.rawResponse as Record<string, unknown>,
      outputItems: Array.isArray(result.canonicalResponse?.output) ? result.canonicalResponse.output : [],
      usage: {
        ...result.usage,
        processingTimeMs: result.usage.processingTimeMs || (finishedAt - startedAt)
      },
      requestFormatVersion: result.requestFormatVersion,
      wireProviderFormat: result.wireProviderFormat,
      processingTimeMs: result.usage.processingTimeMs || (finishedAt - startedAt),
      metadata: {
        execution_mode: executionMode,
        config_override_applied: Boolean(configOverride)
      }
    }).catch((error) => {
      moduleLogger.warn('Failed to record Codex provider usage event', {
        sourceKind,
        llmCallId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  return {
    success: true,
    llm_call_id: llmCallId,
    llm_request_slice_id: recordedSlice?.sliceId || llmCallId,
    response: result.text,
    thinking: '',
    model: result.modelName,
    provider: result.provider,
    usage: {
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      total_tokens: result.usage.totalTokens
    },
    usage_details: {
      total_tokens: result.usage.totalTokens,
      cached_input_tokens: result.usage.cachedInputTokens || 0,
      reasoning_tokens: result.usage.reasoningTokens || 0,
      raw_usage: result.usage.rawUsage || {}
    },
    performance: {
      processing_time_ms: result.usage.processingTimeMs
    },
    canonical_request: result.canonicalRequest,
    wire_request: result.wireRequest,
    wire_request_headers: result.wireRequestHeaders || null,
    wire_request_url: result.wireRequestUrl || null,
    canonical_response: result.canonicalResponse,
    wire_response: result.wireResponse,
    wire_response_headers: result.wireResponseHeaders || null,
    wire_response_status: result.wireResponseStatus ?? null,
    wire_response_status_text: result.wireResponseStatusText || null,
    raw_response: result.rawResponse,
    request_format_version: result.requestFormatVersion,
    wire_provider_format: result.wireProviderFormat,
    context_policy: contextPolicy
      ? {
          model: contextPolicy.model,
          source: contextPolicy.source,
          context_window_tokens: contextPolicy.contextWindowTokens,
          max_output_tokens: contextPolicy.maxOutputTokens,
          default_reply_budget_tokens: contextPolicy.defaultReplyBudgetTokens,
          soft_trigger_ratio: contextPolicy.softTriggerRatio,
          hard_buffer_ratio: contextPolicy.hardBufferRatio,
          soft_trigger_tokens: contextThresholds?.softTriggerTokens || null,
          hard_ceiling_tokens: contextThresholds?.hardCeilingTokens || null,
          reply_budget_tokens: contextThresholds?.replyBudgetTokens || null
        }
      : null,
    debug_metadata: {
      execution_mode: executionMode,
      config_override_applied: Boolean(configOverride)
    }
  };
}

export async function executeDebugRequest(payload: DebugPayload, signal?: AbortSignal) {
  return executeProviderRequest(
    payload,
    payload.executionMode || (payload.canonicalRequest ? 'exact_replay' : 'prompt_debug'),
    false,
    signal
  );
}

export async function executeAgentRequest(payload: AgentExecutePayload) {
  return executeProviderRequest(
    payload,
    payload.executionMode || 'agent_loop',
    true
  );
}

import crypto from 'crypto';
import winston from 'winston';
import { DatabaseManager } from './database';
import { PlaygroundCaseBuilder } from './playground-case-builder';
import {
  PlaygroundBaselineSnapshot,
  PlaygroundCase,
  PlaygroundComparison,
  PlaygroundExecutionMode,
  PlaygroundPromptInput,
  PlaygroundPromptMode,
  PlaygroundProviderConfig,
  PlaygroundRequestPatch,
  PlaygroundRun
} from '../types/playground';

type RunExecutionInput = {
  caseId: string;
  executionMode?: PlaygroundExecutionMode;
  promptMode: PlaygroundPromptMode;
  promptId?: string | null;
  providerConfig: PlaygroundProviderConfig;
  promptInput: PlaygroundPromptInput;
  draftPrompt?: {
    systemInstruction?: string;
    userPromptTemplate?: string | null;
    contextVariables?: Record<string, unknown>;
  } | null;
  executedBy?: string;
};

type PromptRecord = {
  id: string;
  prompt_name: string;
  system_instructions: unknown;
  user_prompt_template?: string | null;
  context_variables?: unknown;
  model_name?: string | null;
};

type PromptExecutionState = {
  resolvedPrompt: PromptRecord | null;
  renderedPromptInput: PlaygroundPromptInput;
  promptSnapshot: {
    mode: PlaygroundPromptMode;
    promptId: string | null;
    promptName: string | null;
    systemInstruction: string;
    userPromptTemplate: string | null;
    contextVariables: Record<string, unknown>;
  };
};

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  if (typeof value === 'object') {
    return value as T;
  }
  return fallback;
}

function stringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null || left === undefined || right === undefined) {
    return left === right;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    return left.every((item, index) => deepEqual(item, right[index]));
  }

  if (typeof left === 'object' && typeof right === 'object') {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();

    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(leftRecord[key], rightRecord[key]));
  }

  return false;
}

function parseSystemInstructions(value: unknown): string {
  const parsed = parseJsonField<unknown>(value, value);
  if (Array.isArray(parsed)) {
    return parsed
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean)
      .join('\n');
  }
  return typeof parsed === 'string' ? parsed : '';
}

function applyContextVariables(
  template: string,
  contextVariables: Record<string, unknown> = {},
  runtimeVariables: Record<string, unknown> = {}
): string {
  const allVariables = {
    ...contextVariables,
    ...runtimeVariables
  };

  return template
    .replace(/\{\{(\w+)\}\}/g, (match, key) => {
      if (!(key in allVariables)) {
        return match;
      }
      const value = allVariables[key];
      return typeof value === 'string' ? value : JSON.stringify(value);
    })
    .replace(/\$\{(\w+)\}/g, (match, key) => {
      if (!(key in allVariables)) {
        return match;
      }
      const value = allVariables[key];
      return typeof value === 'string' ? value : JSON.stringify(value);
    });
}

function normalizeProvider(provider?: string | null): PlaygroundProviderConfig['model']['provider'] {
  const normalized = (provider || '').trim().toLowerCase();
  if (normalized === 'openai') return 'openai';
  if (normalized === 'codex' || normalized === 'openai-codex') return 'codex';
  if (normalized === 'google-legacy' || normalized === 'google' || normalized === 'gemini-api') return 'google-legacy';
  return 'google-gemini-cli';
}

function getProviderFromConfig(providerConfig: PlaygroundProviderConfig): PlaygroundProviderConfig['model']['provider'] {
  return normalizeProvider(providerConfig.model?.provider);
}

function getModelNameFromConfig(providerConfig: PlaygroundProviderConfig): string | null {
  return typeof providerConfig.model?.name === 'string' && providerConfig.model.name.trim().length > 0
    ? providerConfig.model.name.trim()
    : null;
}

function getProviderSpecificFromConfig(providerConfig: PlaygroundProviderConfig): Record<string, unknown> {
  const providerSpecific = providerConfig.model?.providerSpecific;
  return providerSpecific && typeof providerSpecific === 'object' && !Array.isArray(providerSpecific)
    ? providerSpecific
    : {};
}

function normalizePromptMessages(messages: PlaygroundPromptInput['messages']): PlaygroundPromptInput['messages'] {
  return messages
    .map((message): PlaygroundPromptInput['messages'][number] => ({
      role: message.role === 'assistant'
        ? 'assistant'
        : message.role === 'system'
          ? 'system'
          : 'user',
      content: typeof message.content === 'string' ? message.content : ''
    }))
    .filter((message) => message.content.trim().length > 0);
}

function buildOpenResponseInput(messages: PlaygroundPromptInput['messages']): Array<Record<string, unknown>> {
  return normalizePromptMessages(messages).map((message) => ({
    type: 'message',
    role: message.role === 'system' ? 'developer' : message.role,
    content: [
      {
        type: 'input_text',
        text: message.content
      }
    ]
  }));
}

function extractOpenResponseMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => (typeof (part as { text?: unknown })?.text === 'string' ? (part as { text: string }).text : ''))
    .filter(Boolean)
    .join('\n');
}

function isSystemInstructionShadowMessage(item: Record<string, unknown>, baselineInstructions: string): boolean {
  const normalizedInstructions = baselineInstructions.trim();
  if (!normalizedInstructions) {
    return false;
  }

  const role = typeof item.role === 'string' ? item.role : '';
  if (role !== 'developer' && role !== 'system') {
    return false;
  }

  return extractOpenResponseMessageText(item.content).trim() === normalizedInstructions;
}

function mergePatchedOpenResponseInput(
  baselineInput: unknown,
  messages: PlaygroundPromptInput['messages'],
  baselineInstructions: string,
  systemInstruction: string
): Array<Record<string, unknown>> {
  const nextMessages = buildOpenResponseInput(messages);
  const nextSystemShadow = buildOpenResponseInput([{ role: 'system', content: systemInstruction }])[0] || null;
  const items = Array.isArray(baselineInput) ? baselineInput : [];

  if (items.length === 0) {
    return nextMessages;
  }

  const merged: Array<Record<string, unknown>> = [];
  let messageIndex = 0;

  for (const item of items) {
    if (item && typeof item === 'object' && (item as { type?: string }).type === 'message') {
      if (isSystemInstructionShadowMessage(item as Record<string, unknown>, baselineInstructions)) {
        if (nextSystemShadow) {
          merged.push(nextSystemShadow);
        }
        continue;
      }

      if (messageIndex < nextMessages.length) {
        merged.push(nextMessages[messageIndex]);
        messageIndex += 1;
      }
      continue;
    }

    merged.push(item as Record<string, unknown>);
  }

  while (messageIndex < nextMessages.length) {
    merged.push(nextMessages[messageIndex]);
    messageIndex += 1;
  }

  return merged;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[\s,.;:!?()[\]{}"'\n\r\t]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildComparison(
  baselineText: string | undefined,
  currentText: string,
  previousRunText?: string
): PlaygroundComparison {
  if (!baselineText) {
    return {
      hasBaseline: false,
      match: false,
      similarity: 0,
      diffCount: 0,
      currentText,
      previousRunText
    };
  }

  if (baselineText === currentText) {
    return {
      hasBaseline: true,
      match: true,
      similarity: 100,
      diffCount: 0,
      baselineText,
      currentText,
      previousRunText
    };
  }

  const leftTokens = new Set(tokenize(baselineText));
  const rightTokens = new Set(tokenize(currentText));
  const intersection = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
  const union = new Set([...Array.from(leftTokens), ...Array.from(rightTokens)]).size;
  const similarity = union > 0 ? Math.round((intersection / union) * 100) : 0;
  const diffCount = Math.abs(leftTokens.size - rightTokens.size) + (union - intersection);

  return {
    hasBaseline: true,
    match: false,
    similarity,
    diffCount,
    baselineText,
    currentText,
    previousRunText
  };
}

export class PlaygroundRunService {
  private readonly providerServiceUrl: string;

  constructor(
    private readonly db: DatabaseManager,
    private readonly logger: winston.Logger,
    private readonly caseBuilder: PlaygroundCaseBuilder
  ) {
    this.providerServiceUrl =
      process.env.PROVIDER_SERVICE_URL || 'http://qqbot-provider-service:8090';
  }

  async createRun(input: RunExecutionInput): Promise<PlaygroundRun> {
    const caseRecord = await this.caseBuilder.getCaseById(input.caseId);
    if (!caseRecord) {
      throw new Error(`Playground case not found: ${input.caseId}`);
    }

    if (caseRecord.source === 'span' && caseRecord.baselineSnapshot?.canonicalRequest) {
      return this.createSpanReplayRun(caseRecord, input);
    }

    const provider = getProviderFromConfig(input.providerConfig);
    const promptExecution = await this.resolvePromptExecutionState(caseRecord, input);
    const modelName = this.resolveModelName(provider, input.providerConfig, promptExecution.resolvedPrompt);

    const response = await fetch(`${this.providerServiceUrl}/api/internal/llm/debug`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        systemPrompt: promptExecution.renderedPromptInput.systemInstruction,
        messages: promptExecution.renderedPromptInput.messages,
        configOverride: input.providerConfig,
        model: modelName,
        conversation_id: caseRecord.traceContext.conversationId || caseRecord.sourceRef
      })
    });

    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok || payload.success !== true) {
      const failureRun = await this.persistRun({
        caseRecord,
        promptMode: input.promptMode,
        promptId: promptExecution.promptSnapshot.promptId,
        promptSnapshot: promptExecution.promptSnapshot,
        providerConfig: input.providerConfig,
        promptInput: input.promptInput,
        outputSnapshot: {
          error: payload.error || payload.message || `HTTP ${response.status}`
        },
        comparisonSnapshot: {
          hasBaseline: Boolean(caseRecord.baselineOutput?.responseText),
          match: false,
          similarity: 0,
          diffCount: 0,
          baselineText: caseRecord.baselineOutput?.responseText || '',
          currentText: ''
        },
        modelName,
        provider,
        status: 'failed',
        executedBy: input.executedBy || 'admin'
      });

      return failureRun;
    }

    const outputText = typeof payload.response === 'string' ? payload.response : '';
    const previousRun = (await this.caseBuilder.listRunsByCase(caseRecord.id))[0];
    const comparison = buildComparison(
      caseRecord.baselineOutput?.responseText,
      outputText,
      typeof previousRun?.outputSnapshot?.responseText === 'string'
        ? previousRun.outputSnapshot.responseText
        : undefined
    );

    return this.persistRun({
      caseRecord,
      promptMode: input.promptMode,
      promptId: promptExecution.promptSnapshot.promptId,
      promptSnapshot: promptExecution.promptSnapshot,
      providerConfig: input.providerConfig,
      promptInput: input.promptInput,
      outputSnapshot: {
        responseText: outputText,
        thinking: typeof payload.thinking === 'string' ? payload.thinking : '',
        usage: parseJsonField<Record<string, unknown>>(payload.usage, {}),
        performance: parseJsonField<Record<string, unknown>>(payload.performance, {}),
        provider: typeof payload.provider === 'string' ? payload.provider : provider,
        modelName: typeof payload.model === 'string' ? payload.model : modelName,
        canonicalRequest: payload.canonical_request || null,
        wireRequest: payload.wire_request || null,
        canonicalResponse: payload.canonical_response || null,
        wireResponse: payload.wire_response || null,
        rawResponse: payload.raw_response || null,
        metadata: parseJsonField<Record<string, unknown>>(payload.debug_metadata, {})
      },
      comparisonSnapshot: comparison,
      modelName: typeof payload.model === 'string' ? payload.model : modelName,
      provider: typeof payload.provider === 'string' ? payload.provider : provider,
      status: 'completed',
      executedBy: input.executedBy || 'admin'
    });
  }

  async cloneRun(runId: string): Promise<PlaygroundRun> {
    const sourceRun = await this.caseBuilder.getRunById(runId);
    if (!sourceRun) {
      throw new Error(`Playground run not found: ${runId}`);
    }

    return this.createRun({
      caseId: sourceRun.caseId,
      executionMode: sourceRun.executionMode,
      promptMode: sourceRun.promptMode,
      promptId: sourceRun.promptId || null,
      providerConfig: sourceRun.providerConfigSnapshot,
      promptInput: sourceRun.inputSnapshot,
      draftPrompt: sourceRun.promptSnapshot
        ? {
            systemInstruction: typeof sourceRun.promptSnapshot.systemInstruction === 'string'
              ? sourceRun.promptSnapshot.systemInstruction
              : undefined,
            userPromptTemplate: typeof sourceRun.promptSnapshot.userPromptTemplate === 'string'
              ? sourceRun.promptSnapshot.userPromptTemplate
              : null,
            contextVariables: parseJsonField<Record<string, unknown>>(
              sourceRun.promptSnapshot.contextVariables,
              {}
            )
          }
        : null,
      executedBy: sourceRun.executedBy
    });
  }

  private async resolvePromptExecutionState(
    caseRecord: PlaygroundCase,
    input: RunExecutionInput
  ): Promise<PromptExecutionState> {
    const resolvedPrompt = input.promptMode === 'saved'
      ? await this.loadPrompt(input.promptId || caseRecord.promptId || null)
      : null;

    const runtimeVariables = {
      conversation_id: caseRecord.traceContext.conversationId || caseRecord.sourceRef,
      trace_id: caseRecord.traceContext.traceId || null,
      prompt_case_id: caseRecord.id
    };

    const savedPromptBaseContext = resolvedPrompt
      ? parseJsonField<Record<string, unknown>>(resolvedPrompt.context_variables, {})
      : {};
    const currentContextVariables = input.draftPrompt?.contextVariables || input.promptInput.contextVariables || {};
    const hasSavedPromptInstructionOverride =
      input.promptMode === 'saved'
      && resolvedPrompt
      && input.promptInput.systemInstruction !== caseRecord.promptInput.systemInstruction;
    const hasSavedPromptContextOverride =
      input.promptMode === 'saved'
      && resolvedPrompt
      && !deepEqual(currentContextVariables, caseRecord.promptInput.contextVariables || {});
    const messageContext = input.promptMode === 'saved' && resolvedPrompt
      ? (hasSavedPromptContextOverride ? currentContextVariables : savedPromptBaseContext)
      : currentContextVariables;
    const systemInstructionTemplate = input.promptMode === 'saved' && resolvedPrompt
      ? (
          hasSavedPromptInstructionOverride
            ? input.promptInput.systemInstruction
            : parseSystemInstructions(resolvedPrompt.system_instructions)
        )
      : (input.draftPrompt?.systemInstruction || input.promptInput.systemInstruction);
    const renderedSystemInstruction = applyContextVariables(
      systemInstructionTemplate,
      messageContext,
      runtimeVariables
    );

    const userTemplate = input.promptMode === 'saved'
      ? resolvedPrompt?.user_prompt_template || null
      : input.draftPrompt?.userPromptTemplate || null;

    const renderedMessages = input.promptInput.messages.map((message) => {
      if (message.role !== 'user' || !userTemplate) {
        return message;
      }

      return {
        ...message,
        content: applyContextVariables(userTemplate, messageContext, {
          ...runtimeVariables,
          user_input: message.content
        })
      };
    });

    return {
      resolvedPrompt,
      renderedPromptInput: {
        systemInstruction: renderedSystemInstruction,
        messages: renderedMessages,
        contextVariables: messageContext
      },
      promptSnapshot: {
        mode: input.promptMode,
        promptId: resolvedPrompt?.id || input.promptId || null,
        promptName: resolvedPrompt?.prompt_name || null,
        systemInstruction: renderedSystemInstruction,
        userPromptTemplate: userTemplate,
        contextVariables: messageContext
      }
    };
  }

  private async createSpanReplayRun(caseRecord: PlaygroundCase, input: RunExecutionInput): Promise<PlaygroundRun> {
    const baselineSnapshot = caseRecord.baselineSnapshot;
    if (!baselineSnapshot?.canonicalRequest) {
      throw new Error(`Playground case ${caseRecord.id} is missing a baseline snapshot`);
    }

    const promptExecution = await this.resolvePromptExecutionState(caseRecord, input);
    const requestPatch = this.buildRequestPatch(
      baselineSnapshot,
      promptExecution.renderedPromptInput,
      input.providerConfig
    );
    const executionMode: PlaygroundExecutionMode = input.executionMode
      || (Object.keys(requestPatch).length === 0 ? 'exact_replay' : 'patched_replay');
    const effectiveRequest = executionMode === 'exact_replay'
      ? baselineSnapshot.canonicalRequest
      : this.applyPatchToCanonicalRequest(baselineSnapshot.canonicalRequest, requestPatch);
    const effectiveConfig = this.buildEffectiveConfigOverride(baselineSnapshot, input.providerConfig, requestPatch);
    const modelName = this.resolveReplayModelName(baselineSnapshot, input.providerConfig);
    const provider = getProviderFromConfig(input.providerConfig);

    const response = await fetch(`${this.providerServiceUrl}/api/internal/llm/debug`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        executionMode,
        canonicalRequest: effectiveRequest,
        configOverride: effectiveConfig,
        conversation_id: caseRecord.traceContext.conversationId || caseRecord.sourceRef
      })
    });

    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok || payload.success !== true) {
      return this.persistRun({
        caseRecord,
        executionMode,
        promptMode: input.promptMode,
        promptId: promptExecution.promptSnapshot.promptId,
        promptSnapshot: promptExecution.promptSnapshot,
        providerConfig: input.providerConfig,
        promptInput: input.promptInput,
        baselineSnapshot,
        requestPatch,
        effectiveRequest,
        effectiveConfig,
        outputSnapshot: {
          error: payload.error || payload.message || `HTTP ${response.status}`
        },
        comparisonSnapshot: {
          hasBaseline: Boolean(caseRecord.baselineOutput?.responseText),
          match: false,
          similarity: 0,
          diffCount: 0,
          baselineText: caseRecord.baselineOutput?.responseText || '',
          currentText: ''
        },
        diffSnapshot: {
          requestPatch,
          baselineRequest: baselineSnapshot.canonicalRequest,
          effectiveRequest
        },
        modelName,
        provider,
        status: 'failed',
        executedBy: input.executedBy || 'admin'
      });
    }

    const outputText = typeof payload.response === 'string' ? payload.response : '';
    const previousRun = (await this.caseBuilder.listRunsByCase(caseRecord.id))[0];
    const comparison = buildComparison(
      caseRecord.baselineOutput?.responseText,
      outputText,
      typeof previousRun?.outputSnapshot?.responseText === 'string'
        ? previousRun.outputSnapshot.responseText
        : undefined
    );

    return this.persistRun({
      caseRecord,
      executionMode,
      promptMode: input.promptMode,
      promptId: promptExecution.promptSnapshot.promptId,
      promptSnapshot: promptExecution.promptSnapshot,
      providerConfig: input.providerConfig,
      promptInput: input.promptInput,
      baselineSnapshot,
      requestPatch,
      effectiveRequest,
      effectiveConfig,
      outputSnapshot: {
        responseText: outputText,
        thinking: typeof payload.thinking === 'string' ? payload.thinking : '',
        usage: parseJsonField<Record<string, unknown>>(payload.usage, {}),
        performance: parseJsonField<Record<string, unknown>>(payload.performance, {}),
        provider: typeof payload.provider === 'string' ? payload.provider : provider,
        modelName: typeof payload.model === 'string' ? payload.model : modelName,
        canonicalRequest: payload.canonical_request || effectiveRequest,
        wireRequest: payload.wire_request || null,
        canonicalResponse: payload.canonical_response || null,
        wireResponse: payload.wire_response || null,
        rawResponse: payload.raw_response || null,
        metadata: parseJsonField<Record<string, unknown>>(payload.debug_metadata, {})
      },
      comparisonSnapshot: comparison,
      diffSnapshot: {
        requestPatch,
        baselineRequest: baselineSnapshot.canonicalRequest,
        effectiveRequest
      },
      modelName: typeof payload.model === 'string' ? payload.model : modelName,
      provider: typeof payload.provider === 'string' ? payload.provider : provider,
      status: 'completed',
      executedBy: input.executedBy || 'admin'
    });
  }

  private async persistRun(params: {
    caseRecord: PlaygroundCase;
    executionMode?: PlaygroundExecutionMode;
    promptMode: PlaygroundPromptMode;
    promptId?: string | null;
    promptSnapshot: Record<string, unknown>;
    providerConfig: PlaygroundProviderConfig;
    promptInput: PlaygroundPromptInput;
    baselineSnapshot?: PlaygroundBaselineSnapshot | null;
    requestPatch?: PlaygroundRequestPatch | null;
    effectiveRequest?: Record<string, unknown> | null;
    effectiveConfig?: Record<string, unknown> | null;
    outputSnapshot: Record<string, unknown>;
    comparisonSnapshot: Record<string, unknown> | PlaygroundComparison;
    diffSnapshot?: Record<string, unknown> | null;
    modelName: string | null;
    provider: string;
    status: 'completed' | 'failed';
    executedBy: string;
  }): Promise<PlaygroundRun> {
    const runId = crypto.randomUUID();

    await this.db.executeInsert(
      `
        INSERT INTO playground_runs (
          id, case_id, execution_mode, prompt_mode, prompt_id, prompt_snapshot, provider_config_snapshot,
          input_snapshot, baseline_snapshot, request_patch, effective_request, effective_config,
          output_snapshot, comparison_snapshot, diff_snapshot, model_name, provider,
          status, executed_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        runId,
        params.caseRecord.id,
        params.executionMode || 'exact_replay',
        params.promptMode,
        params.promptId || null,
        stringify(params.promptSnapshot),
        stringify(params.providerConfig),
        stringify(params.promptInput),
        stringify(params.baselineSnapshot || null),
        stringify(params.requestPatch || null),
        stringify(params.effectiveRequest || null),
        stringify(params.effectiveConfig || null),
        stringify(params.outputSnapshot),
        stringify(params.comparisonSnapshot),
        stringify(params.diffSnapshot || null),
        params.modelName,
        params.provider,
        params.status,
        params.executedBy
      ]
    );

    const saved = await this.caseBuilder.getRunById(runId);
    if (!saved) {
      throw new Error('Failed to load persisted playground run');
    }

    return saved;
  }

  private resolveModelName(
    provider: PlaygroundProviderConfig['model']['provider'],
    providerConfig: PlaygroundProviderConfig,
    prompt: PromptRecord | null
  ): string {
    const contextModel = getModelNameFromConfig(providerConfig);
    if (prompt?.model_name && contextModel && prompt.model_name === contextModel) {
      return prompt.model_name;
    }
    if (contextModel && contextModel.trim()) {
      return contextModel;
    }
    if (prompt?.model_name && prompt.model_name.trim()) {
      return prompt.model_name;
    }
    throw new Error(`Playground execution requires an explicit model name for provider ${provider}`);
  }

  private async loadPrompt(promptId: string | null): Promise<PromptRecord | null> {
    if (!promptId) {
      return null;
    }

    const rows = await this.db.executeQuery<PromptRecord>(
      `
        SELECT id, prompt_name, system_instructions, user_prompt_template, context_variables, model_name
        FROM agent_prompts
        WHERE id = ?
      `,
      [promptId]
    );
    return rows[0] || null;
  }

  private buildRequestPatch(
    baselineSnapshot: PlaygroundBaselineSnapshot,
    promptInput: PlaygroundPromptInput,
    providerConfig: PlaygroundProviderConfig
  ): PlaygroundRequestPatch {
    const baselineRequest = baselineSnapshot.canonicalRequest || {};
    const baselineInput = this.extractPromptInputFromBaseline(baselineRequest);
    const patch: PlaygroundRequestPatch = {};

    if (promptInput.systemInstruction !== baselineInput.systemInstruction) {
      patch.instructions = promptInput.systemInstruction;
    }
    if (!deepEqual(promptInput.messages, baselineInput.messages)) {
      patch.input = mergePatchedOpenResponseInput(
        baselineRequest.input,
        promptInput.messages,
        baselineInput.systemInstruction,
        promptInput.systemInstruction
      );
    }

    const currentTools = providerConfig.tools || {};
    const baselineTools = {
      definitions: Array.isArray(baselineRequest.tools) ? baselineRequest.tools : [],
      toolChoice: baselineRequest.tool_choice ?? null
    };
    if (!deepEqual(currentTools, baselineTools)) {
      patch.tools = (currentTools as any).definitions ?? currentTools;
      patch.tool_choice = (currentTools as any).toolChoice ?? null;
    }

    const fieldMappings: Array<[keyof PlaygroundRequestPatch, unknown, unknown]> = [
      ['temperature', providerConfig.generation.temperature, baselineRequest.temperature],
      ['top_p', providerConfig.generation.topP, baselineRequest.top_p],
      ['max_output_tokens', providerConfig.generation.maxOutputTokens, baselineRequest.max_output_tokens],
      ['stop', providerConfig.generation.stopSequences, baselineRequest.stop]
    ];
    fieldMappings.forEach(([field, nextValue, baselineValue]) => {
      if (!deepEqual(nextValue, baselineValue) && nextValue !== undefined) {
        (patch as any)[field] = nextValue;
      }
    });

    const nextProvider = getProviderFromConfig(providerConfig);
    const baselineProvider = normalizeProvider(
      typeof (baselineSnapshot.effectiveUnifiedConfig as any)?.model?.provider === 'string'
        ? (baselineSnapshot.effectiveUnifiedConfig as any).model.provider
        : ((baselineSnapshot.provider as PlaygroundProviderConfig['model']['provider']) || 'google-gemini-cli')
    );
    if (nextProvider && nextProvider !== baselineProvider) {
      patch.provider = nextProvider;
    }

    const nextModelName = getModelNameFromConfig(providerConfig);
    if (nextModelName && nextModelName !== baselineSnapshot.modelName) {
      patch.modelName = nextModelName;
    }

    const baselineProviderSpecific = parseJsonField<Record<string, unknown>>(
      (baselineSnapshot.effectiveUnifiedConfig as any)?.model?.providerSpecific,
      {}
    );
    if (!deepEqual(getProviderSpecificFromConfig(providerConfig), baselineProviderSpecific)) {
      patch.providerSpecific = getProviderSpecificFromConfig(providerConfig);
    }

    return patch;
  }

  private extractPromptInputFromBaseline(canonicalRequest: Record<string, unknown>): PlaygroundPromptInput {
    const instructions = typeof canonicalRequest.instructions === 'string' ? canonicalRequest.instructions : '';
    const normalizedInstructions = instructions.trim();
    const items = Array.isArray(canonicalRequest.input) ? canonicalRequest.input : [];
    const messages = normalizePromptMessages(items
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && (item as any).type === 'message'))
      .map((item) => ({
        role: (item.role === 'assistant'
          ? 'assistant'
          : item.role === 'developer' || item.role === 'system'
            ? 'system'
            : 'user') as 'assistant' | 'system' | 'user',
        content: Array.isArray(item.content)
          ? extractOpenResponseMessageText(item.content)
          : typeof item.content === 'string'
            ? item.content
            : ''
      }))
      .filter((message) => {
        if (message.role !== 'system' || !normalizedInstructions) {
          return true;
        }

        return message.content.trim() !== normalizedInstructions;
      }));

    return {
      systemInstruction: instructions,
      messages,
      contextVariables: {}
    };
  }

  private applyPatchToCanonicalRequest(
    baselineRequest: Record<string, unknown>,
    patch: PlaygroundRequestPatch
  ): Record<string, unknown> {
    const nextRequest = JSON.parse(JSON.stringify(baselineRequest || {})) as Record<string, unknown>;

    if (patch.instructions !== undefined) {
      nextRequest.instructions = patch.instructions;
    }
    if (patch.input !== undefined) {
      nextRequest.input = patch.input;
    }
    if (patch.tools !== undefined) {
      nextRequest.tools = patch.tools;
    }
    if (patch.tool_choice !== undefined) {
      nextRequest.tool_choice = patch.tool_choice;
    }
    if (patch.max_output_tokens !== undefined) {
      nextRequest.max_output_tokens = patch.max_output_tokens;
    }
    if (patch.temperature !== undefined) {
      nextRequest.temperature = patch.temperature;
    }
    if (patch.top_p !== undefined) {
      nextRequest.top_p = patch.top_p;
    }
    if (patch.stop !== undefined) {
      nextRequest.stop = patch.stop;
    }
    if (patch.modelName) {
      nextRequest.model = patch.modelName;
    }

    return nextRequest;
  }

  private buildEffectiveConfigOverride(
    baselineSnapshot: PlaygroundBaselineSnapshot,
    providerConfig: PlaygroundProviderConfig,
    patch: PlaygroundRequestPatch
  ): Record<string, unknown> | null {
    const baseConfig = parseJsonField<Record<string, unknown> | null>(baselineSnapshot.effectiveUnifiedConfig, null);
    if (!baseConfig) {
      return null;
    }

    const nextConfig = JSON.parse(JSON.stringify(baseConfig)) as Record<string, unknown>;
    const nextModel = parseJsonField<Record<string, unknown>>(nextConfig.model, {});
    const nextGeneration = parseJsonField<Record<string, unknown>>(nextConfig.generation, {});
    const nextThinking = parseJsonField<Record<string, unknown>>(nextConfig.thinking, {});
    nextModel.name = patch.modelName || getModelNameFromConfig(providerConfig) || baselineSnapshot.modelName || nextModel.name;
    nextModel.provider = patch.provider || getProviderFromConfig(providerConfig) || nextModel.provider;
    nextModel.providerSpecific = getProviderSpecificFromConfig(providerConfig) || nextModel.providerSpecific || {};
    nextConfig.model = nextModel;
    nextConfig.generation = {
      ...nextGeneration,
      ...(providerConfig.generation || {})
    };
    nextConfig.thinking = {
      ...nextThinking,
      ...(providerConfig.thinking || {})
    };
    nextConfig.safety = providerConfig.safety || [];
    nextConfig.tools = providerConfig.tools || {};
    return nextConfig;
  }

  private resolveReplayModelName(
    baselineSnapshot: PlaygroundBaselineSnapshot,
    providerConfig: PlaygroundProviderConfig
  ): string | null {
    return getModelNameFromConfig(providerConfig)
      || baselineSnapshot.modelName
      || null;
  }
}

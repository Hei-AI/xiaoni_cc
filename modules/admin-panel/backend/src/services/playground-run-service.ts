import crypto from 'crypto';
import winston from 'winston';
import { DatabaseManager } from './database';
import { PlaygroundCaseBuilder } from './playground-case-builder';
import {
  PlaygroundCase,
  PlaygroundComparison,
  PlaygroundPromptInput,
  PlaygroundPromptMode,
  PlaygroundProviderConfig,
  PlaygroundRun
} from '../types/playground';

type RunExecutionInput = {
  caseId: string;
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

function normalizeProvider(provider: PlaygroundProviderConfig['provider']): PlaygroundProviderConfig['provider'] {
  return provider || 'google-gemini-cli';
}

function defaultModelForProvider(provider: PlaygroundProviderConfig['provider']): string {
  switch (provider) {
    case 'openai':
      return 'gpt-5-mini';
    case 'codex':
      return 'gpt-5.2-codex';
    case 'google-legacy':
      return 'gemini-2.5-flash';
    case 'google-gemini-cli':
    default:
      return 'gemini-2.5-flash';
  }
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
  private readonly qqbotCoreUrl: string;

  constructor(
    private readonly db: DatabaseManager,
    private readonly logger: winston.Logger,
    private readonly caseBuilder: PlaygroundCaseBuilder
  ) {
    this.qqbotCoreUrl = process.env.QQBOT_CORE_URL || 'http://qqbot-core:8081';
  }

  async createRun(input: RunExecutionInput): Promise<PlaygroundRun> {
    const caseRecord = await this.caseBuilder.getCaseById(input.caseId);
    if (!caseRecord) {
      throw new Error(`Playground case not found: ${input.caseId}`);
    }

    const provider = normalizeProvider(input.providerConfig.provider);
    const resolvedPrompt = input.promptMode === 'saved'
      ? await this.loadPrompt(input.promptId || caseRecord.promptId || null)
      : null;

    const runtimeVariables = {
      conversation_id: caseRecord.traceContext.conversationId || caseRecord.sourceRef,
      trace_id: caseRecord.traceContext.traceId || null,
      prompt_case_id: caseRecord.id
    };

    const renderedSystemInstruction = input.promptMode === 'saved' && resolvedPrompt
      ? applyContextVariables(
          parseSystemInstructions(resolvedPrompt.system_instructions),
          parseJsonField<Record<string, unknown>>(resolvedPrompt.context_variables, {}),
          runtimeVariables
        )
      : applyContextVariables(
          input.draftPrompt?.systemInstruction || input.promptInput.systemInstruction,
          input.draftPrompt?.contextVariables || input.promptInput.contextVariables,
          runtimeVariables
        );

    const userTemplate = input.promptMode === 'saved'
      ? resolvedPrompt?.user_prompt_template || null
      : input.draftPrompt?.userPromptTemplate || null;
    const messageContext = input.promptMode === 'saved' && resolvedPrompt
      ? parseJsonField<Record<string, unknown>>(resolvedPrompt.context_variables, {})
      : (input.draftPrompt?.contextVariables || input.promptInput.contextVariables);

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

    const modelName = this.resolveModelName(provider, input.providerConfig, resolvedPrompt);
    const parameters = this.buildParameters(input.providerConfig);
    const promptSnapshot = {
      mode: input.promptMode,
      promptId: resolvedPrompt?.id || input.promptId || null,
      promptName: resolvedPrompt?.prompt_name || null,
      systemInstruction: renderedSystemInstruction,
      userPromptTemplate: userTemplate,
      contextVariables: messageContext
    };

    const response = await fetch(`${this.qqbotCoreUrl}/api/internal/llm/debug`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        systemPrompt: renderedSystemInstruction,
        messages: renderedMessages,
        parameters,
        model: modelName,
        conversation_id: caseRecord.traceContext.conversationId || caseRecord.sourceRef
      })
    });

    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok || payload.success !== true) {
      const failureRun = await this.persistRun({
        caseRecord,
        promptMode: input.promptMode,
        promptId: resolvedPrompt?.id || input.promptId || null,
        promptSnapshot,
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
      promptId: resolvedPrompt?.id || input.promptId || null,
      promptSnapshot,
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

  private async persistRun(params: {
    caseRecord: PlaygroundCase;
    promptMode: PlaygroundPromptMode;
    promptId?: string | null;
    promptSnapshot: Record<string, unknown>;
    providerConfig: PlaygroundProviderConfig;
    promptInput: PlaygroundPromptInput;
    outputSnapshot: Record<string, unknown>;
    comparisonSnapshot: Record<string, unknown> | PlaygroundComparison;
    modelName: string;
    provider: string;
    status: 'completed' | 'failed';
    executedBy: string;
  }): Promise<PlaygroundRun> {
    const runId = crypto.randomUUID();

    await this.db.executeInsert(
      `
        INSERT INTO playground_runs (
          id, case_id, prompt_mode, prompt_id, prompt_snapshot, provider_config_snapshot,
          input_snapshot, output_snapshot, comparison_snapshot, model_name, provider,
          status, executed_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        runId,
        params.caseRecord.id,
        params.promptMode,
        params.promptId || null,
        stringify(params.promptSnapshot),
        stringify(params.providerConfig),
        stringify(params.promptInput),
        stringify(params.outputSnapshot),
        stringify(params.comparisonSnapshot),
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

  private buildParameters(providerConfig: PlaygroundProviderConfig): Record<string, unknown> {
    return {
      model_config: {
        provider: providerConfig.provider,
        providerSpecific: providerConfig.providerSpecific || {}
      },
      advanced_config: {
        generationConfig: providerConfig.generation || {},
        thinkingConfig: providerConfig.thinking || {},
        safetySettings: providerConfig.safety || [],
        toolsConfig: providerConfig.tools || {}
      }
    };
  }

  private resolveModelName(
    provider: PlaygroundProviderConfig['provider'],
    providerConfig: PlaygroundProviderConfig,
    prompt: PromptRecord | null
  ): string {
    const contextModel = typeof providerConfig.context?.modelName === 'string'
      ? providerConfig.context.modelName
      : null;
    if (prompt?.model_name && contextModel && prompt.model_name === contextModel) {
      return prompt.model_name;
    }
    if (contextModel && contextModel.trim()) {
      return contextModel;
    }
    if (prompt?.model_name && prompt.model_name.trim()) {
      return prompt.model_name;
    }
    return defaultModelForProvider(provider);
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
}

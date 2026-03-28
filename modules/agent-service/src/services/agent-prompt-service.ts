import { resolveChatAgentPrompt } from '@qq-bot/persistence';
import { agentConfig, databaseConfig } from '../config';
import { QueueMessagePayload } from '../types';
import { logger } from '../utils/logger';

export type ResolvedAgentRuntimePrompt = {
  source: 'default' | 'group' | 'private';
  promptId: string | null;
  promptName: string;
  systemPrompt: string;
  userPromptTemplate: string | null;
  contextVariables: Record<string, unknown>;
  runtimeVariables: Record<string, unknown>;
  modelName: string;
  parameters: Record<string, unknown>;
};

export interface AgentPromptResolver {
  resolveForQueueMessage(queueMessage: QueueMessagePayload): Promise<ResolvedAgentRuntimePrompt>;
}

const moduleLogger = logger.createModuleLogger('agent-prompt-service');

function renderPromptTemplate(
  template: string,
  contextVariables: Record<string, unknown> = {},
  runtimeVariables: Record<string, unknown> = {}
): string {
  if (!template || typeof template !== 'string') {
    return template || '';
  }

  const allVariables: Record<string, unknown> = {
    ...contextVariables,
    ...runtimeVariables
  };

  let rendered = template;

  rendered = rendered.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(allVariables, key)) {
      return match;
    }
    return stringifyTemplateValue(allVariables[key]);
  });

  rendered = rendered.replace(/\$\{(\w+)\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(allVariables, key)) {
      return match;
    }
    return stringifyTemplateValue(allVariables[key]);
  });

  rendered = rendered.replace(/\{\{now\.(\w+)\}\}/g, (_match, format) => {
    const now = new Date();
    switch (format) {
      case 'iso':
        return now.toISOString();
      case 'date':
        return now.toDateString();
      case 'time':
        return now.toTimeString();
      case 'locale':
        return now.toLocaleString('zh-CN');
      default:
        return now.toISOString();
    }
  });

  return rendered;
}

function stringifyTemplateValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  const serialized = JSON.stringify(value);
  if (typeof serialized === 'string') {
    return serialized;
  }

  return String(value);
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function buildRuntimeVariables(queueMessage: QueueMessagePayload, modelName: string): Record<string, unknown> {
  return {
    trace_id: queueMessage.traceId,
    run_id: queueMessage.runId,
    batch_id: queueMessage.batchId,
    source: queueMessage.source,
    chat_type: queueMessage.chatType,
    session_key: queueMessage.sessionKey,
    peer_id: queueMessage.peerId,
    peer_name: queueMessage.peerName || null,
    sender_id: queueMessage.senderId,
    sender_name: queueMessage.senderName || null,
    account_id: queueMessage.accountId,
    model: modelName,
    received_at: queueMessage.receivedAt,
    latest_message: queueMessage.bodyForAgent
  };
}

function buildDefaultPrompt(queueMessage: QueueMessagePayload): ResolvedAgentRuntimePrompt {
  const runtimeVariables = buildRuntimeVariables(queueMessage, agentConfig.modelName);
  return {
    source: 'default',
    promptId: null,
    promptName: 'agent_loop_v1',
    systemPrompt: agentConfig.systemPrompt,
    userPromptTemplate: null,
    contextVariables: {},
    runtimeVariables,
    modelName: agentConfig.modelName,
    parameters: {}
  };
}

export class AgentPromptService implements AgentPromptResolver {
  async resolveForQueueMessage(queueMessage: QueueMessagePayload): Promise<ResolvedAgentRuntimePrompt> {
    const groupId = queueMessage.chatType === 'group'
      ? Number(queueMessage.inboundContext.NativeChannelId || queueMessage.peerId)
      : undefined;
    const userId = Number(queueMessage.senderId);
    const resolved = await resolveChatAgentPrompt({
      chatType: queueMessage.chatType,
      groupId,
      userId
    }, databaseConfig);

    if (!resolved || !resolved.prompt) {
      if (resolved?.bindingPromptId) {
        moduleLogger.warn('Chat prompt binding points to a missing or inactive prompt; falling back to default prompt', {
          traceId: queueMessage.traceId,
          bindingSource: resolved.bindingSource,
          bindingPromptId: resolved.bindingPromptId,
          chatType: queueMessage.chatType,
          groupId: groupId || null,
          userId: Number.isFinite(userId) ? userId : null
        });
      }
      return buildDefaultPrompt(queueMessage);
    }

    const contextVariables = normalizeObject(resolved.prompt.contextVariables);
    const modelConfig = normalizeObject(resolved.prompt.modelConfig);
    const advancedConfig = normalizeObject(resolved.prompt.advancedConfig);
    const modelName = resolved.prompt.modelName || agentConfig.modelName;
    const runtimeVariables = buildRuntimeVariables(queueMessage, modelName);

    const parameters: Record<string, unknown> = {};
    if (Object.keys(modelConfig).length > 0) {
      parameters.model_config = modelConfig;
    }
    if (Object.keys(advancedConfig).length > 0) {
      parameters.advanced_config = advancedConfig;
    }

    return {
      source: resolved.bindingSource,
      promptId: resolved.prompt.id,
      promptName: resolved.prompt.promptName,
      systemPrompt: renderPromptTemplate(resolved.prompt.systemInstruction, contextVariables, runtimeVariables),
      userPromptTemplate: resolved.prompt.userPromptTemplate,
      contextVariables,
      runtimeVariables,
      modelName,
      parameters
    };
  }
}

export function applyPromptTemplate(
  template: string,
  contextVariables: Record<string, unknown>,
  runtimeVariables: Record<string, unknown>
): string {
  return renderPromptTemplate(template, contextVariables, runtimeVariables);
}

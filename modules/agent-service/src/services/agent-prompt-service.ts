import { agentConfig } from '../config';
import { QueueMessagePayload } from '../types';
import { formatEast8Timestamp } from './east8-time';
import {
  XIAONI_MAIN_AGENT_PROMPT_ID,
  XIAONI_MAIN_AGENT_PROMPT_NAME
} from '../prompts/xiaoni-main-agent';

export type ResolvedAgentRuntimePrompt = {
  source: 'default' | 'group' | 'private' | 'static';
  promptId: string | null;
  promptName: string;
  systemPrompt: string;
  // Rendered skills_instructions.md, frozen alongside systemPrompt so it only
  // refreshes when the stable snapshot is invalidated (i.e. at the compression
  // boundary). Populated in AgentLoopService.resolveStableRuntimePrompt, not in
  // the resolver, to avoid a circular import on buildSkillsInstructions.
  skillsInstructions?: string;
  identityGenesisSnapshot: string;
  userPromptTemplate: string | null;
  contextVariables: Record<string, unknown>;
  runtimeVariables: Record<string, unknown>;
  modelName: string;
  parameters: Record<string, unknown>;
};

export interface AgentPromptResolver {
  resolveForQueueMessage(queueMessage: QueueMessagePayload): Promise<ResolvedAgentRuntimePrompt>;
}

export class MissingAgentPromptBindingError extends Error {
  constructor(
    message: string,
    readonly details: {
      reason: 'missing_binding' | 'missing_prompt';
      bindingSource?: 'group' | 'private' | null;
      bindingPromptId?: string | null;
      chatType: QueueMessagePayload['chatType'];
      groupId?: number;
      userId: number;
    }
  ) {
    super(message);
    this.name = 'MissingAgentPromptBindingError';
  }
}

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

  // Every time token entering Xiaoni's context is East-8 ("YYYY-MM-DD HH:MM:SS").
  // This renders into the current-turn trigger (cache_volatile), never the cached
  // system-prompt prefix, so it does not affect prompt-cache stability.
  rendered = rendered.replace(/\{\{now\.(\w+)\}\}/g, (_match, format) => {
    const east8 = formatEast8Timestamp();
    switch (format) {
      case 'date':
        return east8.slice(0, 10);
      case 'time':
        return east8.slice(11);
      case 'iso':
      case 'locale':
      default:
        return east8;
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

export class AgentPromptService implements AgentPromptResolver {
  async resolveForQueueMessage(queueMessage: QueueMessagePayload): Promise<ResolvedAgentRuntimePrompt> {
    const contextVariables = {};
    const modelName = agentConfig.xiaoniMainAgentModelName;
    const runtimeVariables = buildRuntimeVariables(queueMessage, modelName);
    const systemPrompt = agentConfig.systemPrompt;

    return {
      source: 'static',
      promptId: XIAONI_MAIN_AGENT_PROMPT_ID,
      promptName: XIAONI_MAIN_AGENT_PROMPT_NAME,
      systemPrompt: renderPromptTemplate(systemPrompt, contextVariables, runtimeVariables),
      identityGenesisSnapshot: systemPrompt,
      userPromptTemplate: null,
      contextVariables,
      runtimeVariables,
      modelName,
      parameters: {}
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

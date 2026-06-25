import { v4 as uuidv4 } from 'uuid';
import type { AgentToolCall, ConversationTranscriptPhase } from '../types';

export type ResponseInputContentPart =
  | {
      type: 'input_text';
      text: string;
      [key: string]: unknown;
    }
  | {
      type: 'output_text';
      text: string;
      [key: string]: unknown;
    }
  | {
      type: 'refusal';
      refusal: string;
      [key: string]: unknown;
    }
  | {
      type: 'input_image';
      image_url: string;
      [key: string]: unknown;
    };

export type ResponseInputItem =
  | {
      type: 'message';
      role: 'system' | 'user' | 'assistant' | 'developer';
      content: string | ResponseInputContentPart[];
      phase?: ConversationTranscriptPhase;
      [key: string]: unknown;
    }
  | {
      type: 'function_call';
      call_id: string;
      name: string;
      arguments: string;
      [key: string]: unknown;
    }
  | {
      type: 'function_call_output';
      call_id: string;
      output: string;
      [key: string]: unknown;
    }
  | {
      type: 'reasoning';
      content?: string;
      summary?: string | Array<Record<string, unknown>>;
      encrypted_content?: string;
      [key: string]: unknown;
    };

export type CanonicalAgentResponse = {
  id?: string;
  output?: Array<{
    type?: string;
    call_id?: string;
    role?: 'assistant' | 'user' | 'system';
    name?: string;
    arguments?: string;
    content?: string | Array<{
      type?: string;
      text?: string;
      [key: string]: unknown;
    }>;
    summary?: string | Array<Record<string, unknown>>;
    encrypted_content?: string;
    phase?: ConversationTranscriptPhase;
    status?: string;
    [key: string]: unknown;
  }>;
} | null | undefined;

export type ReplayableModelOutput =
  | {
      type: 'tool_call';
      inputItem: Extract<ResponseInputItem, { type: 'function_call' }>;
      toolCall: AgentToolCall;
    }
  | {
      type: 'assistant_message';
      phase: ConversationTranscriptPhase;
      text: string;
      inputItem: ResponseInputItem;
    }
  | {
      type: 'reasoning';
      inputItem: Extract<ResponseInputItem, { type: 'reasoning' }>;
    };

export type ResponsePostAction = never;

export type ResponseActionPlan = {
  replayableOutputs: ReplayableModelOutput[];
  hasToolCall: boolean;
  hasFinalAnswer: boolean;
  toolCalls: AgentToolCall[];
  postActions: ResponsePostAction[];
};

function cloneReplayItem<T>(item: T): T {
  return JSON.parse(JSON.stringify(item)) as T;
}

function isReasoningReplayItem(value: unknown): value is Extract<ResponseInputItem, { type: 'reasoning' }> {
  if (!value || typeof value !== 'object' || (value as { type?: unknown }).type !== 'reasoning') {
    return false;
  }

  const item = value as {
    content?: unknown;
    summary?: unknown;
    encrypted_content?: unknown;
  };
  return typeof item.encrypted_content === 'string' && item.encrypted_content.length > 0
    || typeof item.content === 'string' && item.content.length > 0
    || typeof item.summary === 'string' && item.summary.length > 0
    || Array.isArray(item.summary) && item.summary.length > 0;
}

export function isReplayableToolCall(
  item: ReplayableModelOutput
): item is Extract<ReplayableModelOutput, { type: 'tool_call' }> {
  return item.type === 'tool_call';
}

export function extractReplayableModelOutputs(response: CanonicalAgentResponse): ReplayableModelOutput[] {
  const output = Array.isArray(response?.output) ? response.output : [];
  const replayItems: ReplayableModelOutput[] = [];

  for (const item of output) {
    if (item?.type === 'reasoning') {
      const reasoningItem = cloneReplayItem(item) as Extract<ResponseInputItem, { type: 'reasoning' }>;
      if (isReasoningReplayItem(reasoningItem)) {
        replayItems.push({
          type: 'reasoning',
          inputItem: reasoningItem
        });
      }
      continue;
    }

    if (item?.type === 'message' && item.role === 'assistant') {
      const text = Array.isArray(item.content)
        ? item.content
            .map((part) => part?.type === 'output_text' && typeof part.text === 'string' ? part.text.trim() : '')
            .filter(Boolean)
            .join('\n')
        : '';
      const phase = item.phase === 'final_answer' ? 'final_answer' : 'commentary';
      // Empty-text commentary is dropped from replay (nothing to say), but a
      // final_answer with empty text is a real terminal signal — the model ended its
      // turn after delivering everything through a tool call. It must register as
      // hasFinalAnswer so the loop yields via the final_answer branch and a
      // final_answer lands at the replay tail for the fork / self-continuation gates.
      if (text || phase === 'final_answer') {
        replayItems.push({
          type: 'assistant_message',
          phase,
          text,
          inputItem: cloneReplayItem(item) as ResponseInputItem
        });
      }
      continue;
    }

    if (item?.type !== 'function_call' || typeof item.name !== 'string') {
      continue;
    }

    const rawArguments = typeof item.arguments === 'string' ? item.arguments : '{}';
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(rawArguments) as Record<string, unknown>;
    } catch {
      args = {};
    }

    const callId = item.call_id || `tool_${uuidv4().slice(0, 8)}`;
    const inputItem = cloneReplayItem(item) as Extract<ResponseInputItem, { type: 'function_call' }>;
    inputItem.call_id = callId;
    inputItem.name = item.name;
    inputItem.arguments = rawArguments;
    replayItems.push({
      type: 'tool_call',
      inputItem,
      toolCall: {
        callId,
        name: item.name,
        args,
        rawArguments
      }
    });
  }

  return replayItems;
}

export class ResponseActionRouter {
  route(response: CanonicalAgentResponse): ResponseActionPlan {
    const replayableOutputs = extractReplayableModelOutputs(response);
    const toolCalls = replayableOutputs
      .filter(isReplayableToolCall)
      .map((item) => item.toolCall);
    const hasToolCall = toolCalls.length > 0;
    const hasFinalAnswer = replayableOutputs.some((item) => item.type === 'assistant_message' && item.phase === 'final_answer');

    return {
      replayableOutputs,
      hasToolCall,
      hasFinalAnswer,
      toolCalls,
      postActions: []
    };
  }
}

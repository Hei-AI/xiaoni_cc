import { v4 as uuidv4 } from 'uuid';
import type { AgentToolCall, ConversationTranscriptPhase } from '../types';

export const FINAL_ANSWER_IDLE_REMINDER_TEXT = '去找找别的事情做, 你可以做任何事,也可以看看还有哪些事情你没做完,或者感兴趣的其他事情';

export type ResponseInputContentPart =
  | {
      type: 'input_text';
      text: string;
    }
  | {
      type: 'output_text';
      text: string;
    }
  | {
      type: 'refusal';
      refusal: string;
    }
  | {
      type: 'input_image';
      image_url: string;
    };

export type ResponseInputItem =
  | {
      type: 'message';
      role: 'system' | 'user' | 'assistant' | 'developer';
      content: string | ResponseInputContentPart[];
      phase?: ConversationTranscriptPhase;
    }
  | {
      type: 'function_call';
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: 'function_call_output';
      call_id: string;
      output: string;
    }
  | {
      type: 'reasoning';
      content?: string;
      summary?: string | Array<Record<string, unknown>>;
      encrypted_content?: string;
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
    }>;
    summary?: string | Array<Record<string, unknown>>;
    encrypted_content?: string;
    phase?: ConversationTranscriptPhase;
    status?: string;
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

export type ResponsePostAction = {
  type: 'enqueue_final_answer_idle_reminder';
  reminderText: string;
};

export type ResponseActionPlan = {
  replayableOutputs: ReplayableModelOutput[];
  hasToolCall: boolean;
  hasFinalAnswer: boolean;
  toolCalls: AgentToolCall[];
  postActions: ResponsePostAction[];
};

function buildOutputTextPart(text: string): ResponseInputContentPart {
  return {
    type: 'output_text',
    text
  };
}

function buildMessageInputItem(
  role: 'user' | 'assistant' | 'developer',
  parts: string[],
  phase?: ConversationTranscriptPhase
): ResponseInputItem {
  const content = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => role === 'assistant' ? buildOutputTextPart(part) : { type: 'input_text' as const, text: part });

  return {
    type: 'message',
    role,
    ...(phase ? { phase } : {}),
    content
  };
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

function normalizeReasoningReplayInputItem(
  item: Extract<ResponseInputItem, { type: 'reasoning' }>
): Extract<ResponseInputItem, { type: 'reasoning' }> {
  return {
    type: 'reasoning',
    ...(typeof item.content === 'string' && item.content.length > 0 ? { content: item.content } : {}),
    ...(typeof item.summary === 'string' && item.summary.length > 0
      ? { summary: item.summary }
      : Array.isArray(item.summary) && item.summary.length > 0
      ? { summary: item.summary }
      : { summary: [] }),
    ...(typeof item.encrypted_content === 'string' && item.encrypted_content.length > 0
      ? { encrypted_content: item.encrypted_content }
      : {})
  };
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
      const reasoningItem = normalizeReasoningReplayInputItem({
        type: 'reasoning',
        ...(typeof item.content === 'string' && item.content.length > 0
          ? { content: item.content }
          : {}),
        ...(typeof item.summary === 'string' && item.summary.length > 0
          ? { summary: item.summary }
          : Array.isArray(item.summary) && item.summary.length > 0
          ? { summary: item.summary }
          : {}),
        ...(typeof item.encrypted_content === 'string' && item.encrypted_content.length > 0
          ? { encrypted_content: item.encrypted_content }
          : {})
      });
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
      if (text) {
        const phase = item.phase === 'final_answer' ? 'final_answer' : 'commentary';
        replayItems.push({
          type: 'assistant_message',
          phase,
          text,
          inputItem: buildMessageInputItem('assistant', [text], phase)
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
    replayItems.push({
      type: 'tool_call',
      inputItem: {
        type: 'function_call',
        call_id: callId,
        name: item.name,
        arguments: rawArguments
      },
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
      postActions: hasFinalAnswer && !hasToolCall
        ? [{
            type: 'enqueue_final_answer_idle_reminder',
            reminderText: FINAL_ANSWER_IDLE_REMINDER_TEXT
          }]
        : []
    };
  }
}

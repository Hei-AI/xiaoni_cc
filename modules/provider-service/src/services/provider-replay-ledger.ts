import { v4 as uuidv4 } from 'uuid';
import type { LLMProviderContext } from './llm-provider/types';

export function createReplayLlmCallId(prefix = 'llm') {
  return `${prefix}_${Date.now()}_${uuidv4().slice(0, 8)}`;
}

export function withReplayLlmCallId(context: LLMProviderContext = {}, prefix = 'llm'): LLMProviderContext {
  return {
    ...context,
    llmCallId: context.llmCallId || createReplayLlmCallId(prefix)
  };
}

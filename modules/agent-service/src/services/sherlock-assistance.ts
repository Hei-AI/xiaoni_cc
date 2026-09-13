import type { AgentToolCall } from '../types';

export type SherlockAssistanceKind = 'investigate' | 'execute' | 'human' | 'clarify';

// Routing is internal. It never grants authority beyond the submitted request.
export const SHERLOCK_ROUTE_TOOL = {
  type: 'function',
  function: {
    name: 'classify_assistance',
    description: 'Classify the requested help before any computer operation.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['investigate', 'execute', 'human', 'clarify'] },
        reason: { type: 'string' }
      },
      required: ['kind', 'reason'],
      additionalProperties: false
    }
  }
} as const;

export function parseSherlockRoute(calls: AgentToolCall[]): {
  kind: SherlockAssistanceKind;
  reason: string;
} | null {
  if (calls.length !== 1 || calls[0].name !== 'classify_assistance') return null;
  const { kind, reason } = calls[0].args;
  if (kind !== 'investigate' && kind !== 'execute' && kind !== 'human' && kind !== 'clarify') return null;
  if (typeof reason !== 'string' || !reason.trim()) return null;
  return { kind, reason: reason.trim() };
}

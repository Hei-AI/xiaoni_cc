import type { AgentToolCall } from '../types';

export type SherlockAssistanceKind = 'investigate' | 'execute' | 'human' | 'clarify';

// Only this public view crosses the help-tool boundary, including deduplicated
// results saved by older versions. Internal routing remains in the task ledger.
export function presentLiAhuaHelp(result: Record<string, unknown>): Record<string, unknown> {
  const status = result.status;
  const waiting = status === 'waiting_for_li_ahua' || status === 'help_human_sent';
  const uncertain = status === 'delivery_uncertain' || status === 'help_human_sending';
  const available = status === 'helper_replied' || status === 'result_available';
  return {
    ok: result.ok === true || waiting,
    ...(result.help_id ? { help_id: result.help_id } : {}),
    status: available ? 'result_available' : waiting ? 'waiting_for_li_ahua'
      : uncertain ? 'delivery_uncertain' : status === 'help_running' || status === 'help_busy' ? 'pending' : 'unavailable',
    ...(available && typeof result.result === 'string' ? { result: result.result } : {}),
    message: available ? '求助有了结果。仍未解决时，带上原 help_id 说明情况。'
      : waiting ? '求助已发到你与李阿花的 QQ 私聊，等待回复。'
      : uncertain ? '尚未确认求助是否送达，请先核对你与李阿花的 QQ 私聊。'
      : status === 'help_running' || status === 'help_busy' ? '这件求助还在处理中。'
      : '这次求助暂未完成，请保留原 help_id 后再试。'
  };
}

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

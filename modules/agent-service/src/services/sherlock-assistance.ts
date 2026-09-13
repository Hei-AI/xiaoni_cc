import type { AgentToolCall } from '../types';

export type SherlockAssistanceKind = 'investigate' | 'execute' | 'human' | 'clarify';
export type AssistanceGoalResult = { status: 'completed' | 'blocked'; text: string };
export type DelegatedTaskBrief = {
  task: string;
  context: string;
  acceptanceCriteria: string;
  omittedSensitiveContext: string[];
};

export const ASSISTANCE_FINISH_TOOL_NAME = 'finish_task';
export const DELEGATED_BRIEF_TOOL_NAME = 'build_delegated_brief';

export const ASSISTANCE_FINISH_TOOL = {
  type: 'function',
  function: {
    name: ASSISTANCE_FINISH_TOOL_NAME,
    description: 'Finish the delegated Goal only after verifying completion, or when required information or an unavailable personal action genuinely blocks further progress.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['completed', 'blocked'] },
        summary: { type: 'string', description: 'What was done and the resulting state, or progress made before the blocker.' },
        verification: { type: 'string', description: 'The concrete check and evidence used to verify the result or current state. Use an empty string only when blocked and no verification is available.' },
        blocked_reason: { type: 'string', description: 'The exact missing information or unavailable personal action. Must be empty when completed.' }
      },
      required: ['status', 'summary', 'verification', 'blocked_reason'],
      additionalProperties: false
    }
  }
} as const;

export const DELEGATED_BRIEF_TOOL = {
  type: 'function',
  function: {
    name: DELEGATED_BRIEF_TOOL_NAME,
    description: 'Return a privacy-minimized third-person task brief for the execution worker.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string' },
        context: { type: 'string' },
        acceptance_criteria: { type: 'string' },
        omitted_sensitive_context: { type: 'array', items: { type: 'string' } }
      },
      required: ['task', 'context', 'acceptance_criteria', 'omitted_sensitive_context'],
      additionalProperties: false
    }
  }
} as const;

export function parseAssistanceFinishCall(call: AgentToolCall): AssistanceGoalResult | null {
  if (call.name !== ASSISTANCE_FINISH_TOOL_NAME) return null;
  const status = call.args.status;
  const summary = typeof call.args.summary === 'string' ? call.args.summary.trim() : '';
  const verification = typeof call.args.verification === 'string' ? call.args.verification.trim() : '';
  const blockedReason = typeof call.args.blocked_reason === 'string' ? call.args.blocked_reason.trim() : '';
  if (!summary) return null;
  if (status === 'completed' && verification && !blockedReason) {
    return { status, text: `${summary}\n验证：${verification}` };
  }
  if (status === 'blocked' && blockedReason) {
    return { status, text: `${summary}\n阻塞原因：${blockedReason}${verification ? `\n当前状态核对：${verification}` : ''}` };
  }
  return null;
}

export function parseDelegatedTaskBrief(calls: AgentToolCall[]): DelegatedTaskBrief | null {
  if (calls.length !== 1 || calls[0].name !== DELEGATED_BRIEF_TOOL_NAME) return null;
  const args = calls[0].args;
  const task = typeof args.task === 'string' ? args.task.trim() : '';
  const context = typeof args.context === 'string' ? args.context.trim() : '';
  const acceptanceCriteria = typeof args.acceptance_criteria === 'string' ? args.acceptance_criteria.trim() : '';
  const rawOmittedSensitiveContext = args.omitted_sensitive_context;
  if (!Array.isArray(rawOmittedSensitiveContext)) return null;
  const omittedSensitiveContext = rawOmittedSensitiveContext
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
  const workerVisibleText = `${task}\n${context}\n${acceptanceCriteria}`;
  if (!task || !acceptanceCriteria || omittedSensitiveContext.length !== rawOmittedSensitiveContext.length) return null;
  if (workerVisibleText.includes('小腻') || workerVisibleText.includes('李阿花')) return null;
  return { task, context, acceptanceCriteria, omittedSensitiveContext };
}

export function parseAssistanceGoalResult(text: string | null): AssistanceGoalResult | null {
  const value = (text || '').trim();
  const completed = value.match(/^<goal_completed>\s*([\s\S]*?)\s*<\/goal_completed>$/u);
  if (completed?.[1]?.trim()) return { status: 'completed', text: completed[1].trim() };
  const blocked = value.match(/^<goal_blocked>\s*([\s\S]*?)\s*<\/goal_blocked>$/u);
  if (blocked?.[1]?.trim()) return { status: 'blocked', text: blocked[1].trim() };
  return null;
}

// Only this public view crosses the help-tool boundary, including deduplicated
// results saved by older versions. Internal routing remains in the task ledger.
export function presentLiAhuaHelp(result: Record<string, unknown>): Record<string, unknown> {
  const status = result.status;
  const waiting = status === 'waiting_for_li_ahua' || status === 'help_human_sent';
  const uncertain = status === 'delivery_uncertain' || status === 'help_human_sending';
  const available = status === 'helper_replied' || status === 'result_available';
  const active = status === 'help_ready' || status === 'help_running' || status === 'help_busy' || status === 'pending';
  return {
    ok: result.ok === true || waiting || active,
    ...(result.help_id ? { help_id: result.help_id } : {}),
    status: available ? 'result_available' : waiting ? 'waiting_for_li_ahua'
      : uncertain ? 'delivery_uncertain' : active ? 'pending' : 'unavailable',
    ...(active ? { completion_signal: 'help_task_notification', wait_for_notification: true } : {}),
    ...(available && typeof result.result === 'string' ? { result: result.result } : {}),
    message: available ? '求助有了结果。仍未解决时，带上原 help_id 说明情况。'
      : waiting ? '求助已发到你与李阿花的 QQ 私聊，等待回复。'
      : uncertain ? '尚未确认求助是否送达，请先核对你与李阿花的 QQ 私聊。'
      : active ? '任务已交给后台处理；完成后会通知你，不用在这里等待。'
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

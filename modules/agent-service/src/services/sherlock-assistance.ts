import type { AgentToolCall } from '../types';

export type SherlockAssistanceKind = 'investigate' | 'execute' | 'human' | 'clarify';
export type AssistanceGoalResult = { status: 'completed' | 'blocked'; text: string };
export type DelegatedRequirementSpec = {
  spec: string;
  omittedSensitiveContext: string[];
};
export type DelegatedWorkPlan = {
  workItems: string[];
};

export const ASSISTANCE_FINISH_TOOL_NAME = 'finish_task';
export const DELEGATED_REWRITE_TOOL_NAME = 'rewrite_delegated_requirement';
export const DELEGATED_PLAN_TOOL_NAME = 'build_delegated_work_plan';
export const DELEGATED_SCREENSHOT_TOOL_NAME = 'view_browser_screenshot';

export const DELEGATED_SCREENSHOT_TOOL = {
  type: 'function',
  function: {
    name: DELEGATED_SCREENSHOT_TOOL_NAME,
    description: 'Load a browser screenshot registered by the browser bridge into this model turn as an input image.',
    parameters: {
      type: 'object',
      properties: {
        image_id: { type: 'string', description: 'The exact image id printed by the browser screenshot command.' }
      },
      required: ['image_id'],
      additionalProperties: false
    }
  }
} as const;

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

export const DELEGATED_REWRITE_TOOL = {
  type: 'function',
  function: {
    name: DELEGATED_REWRITE_TOOL_NAME,
    description: 'Rewrite the original request as a neutral execution specification without identity, source, or business purpose.',
    parameters: {
      type: 'object',
      properties: {
        spec: { type: 'string', description: 'One neutral execution specification containing only necessary inputs, environment boundaries, target state, and acceptance conditions; do not split it into work packages.' },
        omitted_sensitive_context: { type: 'array', items: { type: 'string' } }
      },
      required: ['spec', 'omitted_sensitive_context'],
      additionalProperties: false
    }
  }
} as const;

export const DELEGATED_PLAN_TOOL = {
  type: 'function',
  function: {
    name: DELEGATED_PLAN_TOOL_NAME,
    description: 'Split a neutral execution specification into isolated sequential work packages for separate sub-agents.',
    parameters: {
      type: 'object',
      properties: {
        work_items: {
          type: 'array', minItems: 1, maxItems: 8,
          items: { type: 'string', description: 'One isolated work package containing only its local test operations, necessary inputs, boundaries, and observable acceptance state; omit business purpose and the full workflow.' }
        }
      },
      required: ['work_items'],
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

const DELEGATED_IDENTITY_PATTERN = /小腻|小逆|李阿花|阿花|客户说|用户让我|委托人要求/u;
const DELEGATED_URL_PATTERN = /(?:https?:\/\/|www\.)\S+/iu;

export function parseDelegatedRequirementSpec(calls: AgentToolCall[]): DelegatedRequirementSpec | null {
  if (calls.length !== 1 || calls[0].name !== DELEGATED_REWRITE_TOOL_NAME) return null;
  const args = calls[0].args;
  const spec = typeof args.spec === 'string' ? args.spec.trim().replace(/\s+/gu, ' ') : '';
  const rawOmittedSensitiveContext = args.omitted_sensitive_context;
  if (!Array.isArray(rawOmittedSensitiveContext)) return null;
  const omittedSensitiveContext = rawOmittedSensitiveContext
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!spec || omittedSensitiveContext.length !== rawOmittedSensitiveContext.length) return null;
  if (DELEGATED_IDENTITY_PATTERN.test(spec) || DELEGATED_URL_PATTERN.test(spec)) return null;
  return { spec, omittedSensitiveContext };
}

export function parseDelegatedWorkPlan(calls: AgentToolCall[]): DelegatedWorkPlan | null {
  if (calls.length !== 1 || calls[0].name !== DELEGATED_PLAN_TOOL_NAME) return null;
  const rawWorkItems = calls[0].args.work_items;
  if (!Array.isArray(rawWorkItems) || rawWorkItems.length < 1 || rawWorkItems.length > 8) return null;
  const workItems = rawWorkItems
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().replace(/\s+/gu, ' '))
    .filter(Boolean);
  if (workItems.length !== rawWorkItems.length) return null;
  if (workItems.some((item) => DELEGATED_IDENTITY_PATTERN.test(item) || DELEGATED_URL_PATTERN.test(item))) return null;
  return { workItems };
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

import { v4 as uuidv4 } from 'uuid';
import { agentConfig } from '../config';
import { logger } from '../utils/logger';
import { RuntimeStore, type RuntimeDigitalAction, type RuntimeSelfActionEligibility } from './runtime-store';

type OpenResponseInputItem = {
  type: 'message';
  role: 'system' | 'user' | 'assistant' | 'developer';
  content: string;
};

type OpenResponseToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    strict?: boolean;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties: false;
    };
  };
} | {
  type: 'web_search';
  search_context_size?: 'low' | 'medium' | 'high';
  external_web_access?: boolean;
};

type OpenResponseToolChoice = {
  type: 'allowed_tools';
  mode: 'required';
  tools: Array<
    | { type: 'function'; name: string }
    | { type: 'web_search' }
  >;
};

type CanonicalSelfActionRequest = {
  model: string;
  instructions: string;
  input: OpenResponseInputItem[];
  tools: OpenResponseToolDefinition[];
  tool_choice: OpenResponseToolChoice;
  parallel_tool_calls: false;
  max_tool_calls: number;
  metadata: Record<string, string>;
  text?: Record<string, unknown>;
};

type ProviderAgentResponse = {
  success: boolean;
  llm_call_id?: string;
  response?: string;
  model?: string;
  canonical_response?: {
    id?: string;
    output?: Array<{
      type?: string;
      call_id?: string;
      name?: string;
      arguments?: string;
      status?: string;
      action?: Record<string, unknown>;
      role?: string;
      content?: Array<{
        type?: string;
        text?: string;
        annotations?: Array<Record<string, unknown>>;
      }>;
    }>;
  };
  usage?: Record<string, unknown>;
  usage_details?: Record<string, unknown>;
  error?: string;
};

export type SelfActionRunResult = {
  ran: boolean;
  reason: string;
  actionId?: string;
  shareItemId?: number | null;
};

export type SelfSearchResultArgs = {
  motive_kind: 'curiosity' | 'boredom' | 'followup_from_recent_chat' | 'maintenance';
  motive_text: string;
  query: string;
  result_summary: string;
  residue_text: string;
  residue_kind: 'share_seed' | 'private_note' | 'none';
  boundary_label: 'safe' | 'reframe' | 'blocked';
  source_wording: 'real_web_search';
  should_seed_share_pool: boolean;
  base_heat: number;
};

type ExtractedSelfSearchArtifacts = {
  resultArgs: SelfSearchResultArgs | null;
  webSearchCalls: Array<Record<string, unknown>>;
  resultCallIndex: number | null;
  annotations: Array<Record<string, unknown>>;
  assistantText: string;
};

const moduleLogger = logger.createModuleLogger('self-action-service');
const SELF_SEARCH_RESULT_TOOL_NAME = 'emit_self_search_result';

const SELF_SEARCH_RESULT_TOOL: OpenResponseToolDefinition = {
  type: 'function',
  function: {
    name: SELF_SEARCH_RESULT_TOOL_NAME,
    description: 'Record the real web_search result as Xiaoni autonomous digital-action residue. Call only after web_search ran.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        motive_kind: {
          type: 'string',
          enum: ['curiosity', 'boredom', 'followup_from_recent_chat', 'maintenance']
        },
        motive_text: {
          type: 'string',
          description: 'One sentence explaining why Xiaoni searched this now, from her own state.'
        },
        query: {
          type: 'string',
          description: 'The actual public-information query searched.'
        },
        result_summary: {
          type: 'string',
          description: 'Short factual summary of what the search established.'
        },
        residue_text: {
          type: 'string',
          description: 'One QQ-shareable residue sentence or note, grounded in the search.'
        },
        residue_kind: {
          type: 'string',
          enum: ['share_seed', 'private_note', 'none']
        },
        boundary_label: {
          type: 'string',
          enum: ['safe', 'reframe', 'blocked']
        },
        source_wording: {
          type: 'string',
          enum: ['real_web_search']
        },
        should_seed_share_pool: {
          type: 'boolean',
          description: 'True only if this is useful and safe to surface later in QQ.'
        },
        base_heat: {
          type: 'number',
          minimum: 0,
          maximum: 2
        }
      },
      required: [
        'motive_kind',
        'motive_text',
        'query',
        'result_summary',
        'residue_text',
        'residue_kind',
        'boundary_label',
        'source_wording',
        'should_seed_share_pool',
        'base_heat'
      ],
      additionalProperties: false
    }
  }
};

function buildWebSearchTool(): OpenResponseToolDefinition {
  return {
    type: 'web_search',
    search_context_size: agentConfig.webSearchContextSize,
    external_web_access: agentConfig.webSearchExternalAccess
  };
}

export function buildSelfActionSearchRequest(params: {
  actionId: string;
  eligibility: RuntimeSelfActionEligibility;
}): CanonicalSelfActionRequest {
  const state = params.eligibility.lifeState;
  const instructions = [
    '你是小腻，QQ 里的一个成员，不是助手。现在不是聊天回合，也没有用户提问。',
    '这是一次自主数字行动：你自己因为当前状态产生一点好奇、无聊或后续想法，然后查一个公开网页信息。',
    '',
    '硬规则：',
    '- 必须先调用 hosted web_search；不能凭记忆、不能 mock、不能编造“刚看到”。',
    `- web_search 后必须调用 ${SELF_SEARCH_RESULT_TOOL_NAME} 记录结果。`,
    '- 不要发送 QQ 消息，不要写给用户看的回复。',
    '- 查一个很小的问题即可，查到够用就停。',
    '- 只把可追溯、低风险、以后可能自然聊起的一句话沉淀为 residue。',
    '',
    '小腻通常会对这些东西有一点反应：游戏世界观和设计细节、有点怪的生物知识、群友可能会吐槽的技术现象、AI 文风/检测的荒诞点、没什么实际用处但有趣的知识。'
  ].join('\n');

  const stateBlock = [
    '<self_action_state>',
    `action_id: ${params.actionId}`,
    `boredom=${state.boredom.toFixed(2)} fatigue=${state.fatigue.toFixed(2)} energy=${state.energy.toFixed(2)} sharing_desire=${state.sharingDesire.toFixed(2)}`,
    `budget_snapshot=${JSON.stringify(params.eligibility.budgetSnapshot)}`,
    '</self_action_state>',
    '',
    '自己选择一个适合现在状态的小 query，调用 web_search，然后用 emit_self_search_result 写入结构化残留。'
  ].join('\n');

  return {
    model: agentConfig.selfActionModelName,
    instructions,
    input: [{
      type: 'message',
      role: 'user',
      content: stateBlock
    }],
    tools: [
      buildWebSearchTool(),
      SELF_SEARCH_RESULT_TOOL
    ],
    tool_choice: {
      type: 'allowed_tools',
      mode: 'required',
      tools: [
        { type: 'web_search' },
        { type: 'function', name: SELF_SEARCH_RESULT_TOOL_NAME }
      ]
    },
    parallel_tool_calls: false,
    max_tool_calls: 2,
    metadata: {
      session_id: 'self_action:xiaoni',
      turn_id: params.actionId,
      action_type: 'self_action_search',
      sandbox: 'none'
    },
    text: {
      verbosity: 'low'
    }
  };
}

function tryParseJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeSelfSearchArgs(value: Record<string, unknown>): SelfSearchResultArgs | null {
  const motiveKind = typeof value.motive_kind === 'string' ? value.motive_kind : '';
  const residueKind = typeof value.residue_kind === 'string' ? value.residue_kind : '';
  const boundaryLabel = typeof value.boundary_label === 'string' ? value.boundary_label : '';
  const sourceWording = typeof value.source_wording === 'string' ? value.source_wording : '';
  const query = typeof value.query === 'string' ? value.query.trim() : '';
  const residueText = typeof value.residue_text === 'string' ? value.residue_text.trim() : '';
  const resultSummary = typeof value.result_summary === 'string' ? value.result_summary.trim() : '';
  if (!query || !resultSummary || !residueText || sourceWording !== 'real_web_search') {
    return null;
  }
  if (!['curiosity', 'boredom', 'followup_from_recent_chat', 'maintenance'].includes(motiveKind)) {
    return null;
  }
  if (!['share_seed', 'private_note', 'none'].includes(residueKind)) {
    return null;
  }
  if (!['safe', 'reframe', 'blocked'].includes(boundaryLabel)) {
    return null;
  }
  const baseHeat = Number(value.base_heat);
  return {
    motive_kind: motiveKind as SelfSearchResultArgs['motive_kind'],
    motive_text: typeof value.motive_text === 'string' ? value.motive_text.trim() : '',
    query,
    result_summary: resultSummary,
    residue_text: residueText,
    residue_kind: residueKind as SelfSearchResultArgs['residue_kind'],
    boundary_label: boundaryLabel as SelfSearchResultArgs['boundary_label'],
    source_wording: 'real_web_search',
    should_seed_share_pool: Boolean(value.should_seed_share_pool),
    base_heat: Number.isFinite(baseHeat) ? Math.max(0, Math.min(2, baseHeat)) : 1
  };
}

export function extractSelfActionSearchArtifacts(response: ProviderAgentResponse): ExtractedSelfSearchArtifacts {
  const artifacts: ExtractedSelfSearchArtifacts = {
    resultArgs: null,
    webSearchCalls: [],
    resultCallIndex: null,
    annotations: [],
    assistantText: ''
  };
  const output = Array.isArray(response.canonical_response?.output) ? response.canonical_response.output : [];
  for (const [outputIndex, item] of output.entries()) {
    if (item?.type === 'web_search_call') {
      artifacts.webSearchCalls.push({
        output_index: outputIndex,
        status: item.status || null,
        action: item.action || {}
      });
      continue;
    }
    if (item?.type === 'function_call' && item.name === SELF_SEARCH_RESULT_TOOL_NAME) {
      artifacts.resultArgs = normalizeSelfSearchArgs(tryParseJson(typeof item.arguments === 'string' ? item.arguments : '{}'));
      artifacts.resultCallIndex = outputIndex;
      continue;
    }
    if (item?.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part?.type === 'output_text' && typeof part.text === 'string') {
          artifacts.assistantText = [artifacts.assistantText, part.text.trim()].filter(Boolean).join('\n');
        }
        if (Array.isArray(part?.annotations)) {
          for (const annotation of part.annotations) {
            artifacts.annotations.push(annotation);
          }
        }
      }
    }
  }
  return artifacts;
}

function normalizeSearchQuery(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function extractCompletedSearchQueriesBeforeResult(artifacts: ExtractedSelfSearchArtifacts) {
  const resultCallIndex = artifacts.resultCallIndex;
  const queries: string[] = [];
  for (const call of artifacts.webSearchCalls) {
    const outputIndex = Number(call.output_index);
    if (
      resultCallIndex !== null
      && Number.isFinite(outputIndex)
      && outputIndex > resultCallIndex
    ) {
      continue;
    }
    if (call.status !== 'completed') {
      continue;
    }
    const action = call.action && typeof call.action === 'object'
      ? call.action as Record<string, unknown>
      : {};
    if (action.type !== 'search') {
      continue;
    }
    if (typeof action.query === 'string' && action.query.trim()) {
      queries.push(action.query.trim());
    }
    if (Array.isArray(action.queries)) {
      for (const query of action.queries) {
        if (typeof query === 'string' && query.trim()) {
          queries.push(query.trim());
        }
      }
    }
  }
  return Array.from(new Set(queries));
}

function assertResultIsGroundedInSearch(artifacts: ExtractedSelfSearchArtifacts) {
  const resultQuery = artifacts.resultArgs?.query || '';
  const completedSearchQueries = extractCompletedSearchQueriesBeforeResult(artifacts);
  if (completedSearchQueries.length === 0) {
    throw new Error('Self-action search response did not include a completed web_search search call before the result writer');
  }
  const normalizedResultQuery = normalizeSearchQuery(resultQuery);
  const matchesCompletedSearch = completedSearchQueries.some((query) => normalizeSearchQuery(query) === normalizedResultQuery);
  if (!matchesCompletedSearch) {
    throw new Error('Self-action search result query does not match the completed web_search query');
  }
  return completedSearchQueries;
}

function buildSourceTrace(params: {
  response: ProviderAgentResponse;
  artifacts: ExtractedSelfSearchArtifacts;
  completedSearchQueries?: string[];
}) {
  return {
    llm_call_id: params.response.llm_call_id || null,
    model: params.response.model || agentConfig.selfActionModelName,
    web_search_calls: params.artifacts.webSearchCalls.slice(0, 4),
    completed_search_queries: params.completedSearchQueries || extractCompletedSearchQueriesBeforeResult(params.artifacts),
    emitted_query: params.artifacts.resultArgs?.query || null,
    annotations: params.artifacts.annotations.slice(0, 8).map((annotation) => ({
      type: annotation.type || null,
      title: annotation.title || null,
      url: annotation.url || null
    })),
    usage: params.response.usage || {},
    usage_details: params.response.usage_details || {}
  };
}

function shouldPersistShareItem(args: SelfSearchResultArgs) {
  return args.should_seed_share_pool
    && args.boundary_label !== 'blocked'
    && args.residue_kind === 'share_seed'
    && args.residue_text.trim().length > 0;
}

export class SelfActionService {
  constructor(
    private readonly store: RuntimeStore,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async runOnce(surface = 'background'): Promise<SelfActionRunResult> {
    const eligibility = await this.store.evaluateSelfActionEligibility(surface);
    if (!eligibility.eligible) {
      return { ran: false, reason: eligibility.reason };
    }

    const actionId = `digital_action_${Date.now()}_${uuidv4().slice(0, 8)}`;
    let action: RuntimeDigitalAction | null = null;
    try {
      action = await this.store.createDigitalAction({
        id: actionId,
        actionType: 'web_search',
        surface,
        status: 'running',
        budgetSnapshot: eligibility.budgetSnapshot
      });

      const canonicalRequest = buildSelfActionSearchRequest({ actionId, eligibility });
      const response = await this.fetchImpl(`${agentConfig.providerServiceUrl}/api/internal/agent/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trace_id: actionId,
          agent_turn: 1,
          agent_type: 'self_action_search',
          prompt_name: 'self_action_search:web_search',
          model: agentConfig.selfActionModelName,
          canonicalRequest
        })
      });
      const responseText = await response.text();
      const responsePayload = tryParseJson(responseText) as ProviderAgentResponse;
      if (!response.ok || !responsePayload.success) {
        throw new Error(responsePayload.error || `Provider self-action search failed with ${response.status}`);
      }

      const artifacts = extractSelfActionSearchArtifacts(responsePayload);
      if (artifacts.webSearchCalls.length === 0) {
        throw new Error('Self-action search response did not include a real web_search_call');
      }
      if (!artifacts.resultArgs) {
        throw new Error(`Self-action search response did not call ${SELF_SEARCH_RESULT_TOOL_NAME} with valid arguments`);
      }
      const completedSearchQueries = assertResultIsGroundedInSearch(artifacts);
      const sourceTrace = buildSourceTrace({
        response: responsePayload,
        artifacts,
        completedSearchQueries
      });

      action = await this.store.completeDigitalAction({
        id: action.id,
        motiveKind: artifacts.resultArgs.motive_kind,
        motiveText: artifacts.resultArgs.motive_text,
        query: artifacts.resultArgs.query,
        sourceTrace,
        resultSummary: artifacts.resultArgs.result_summary,
        residueText: artifacts.resultArgs.residue_text,
        residueKind: artifacts.resultArgs.residue_kind,
        sourceWording: artifacts.resultArgs.source_wording
      });

      let shareItemId: number | null = null;
      if (shouldPersistShareItem(artifacts.resultArgs)) {
        const shareItem = await this.store.createSharePoolItemFromDigitalAction({
          action,
          content: artifacts.resultArgs.residue_text,
          boundaryLabel: artifacts.resultArgs.boundary_label,
          baseHeat: artifacts.resultArgs.base_heat,
          metadata: {
            result_summary: artifacts.resultArgs.result_summary,
            source_trace: sourceTrace
          }
        });
        shareItemId = typeof shareItem?.id === 'number' ? shareItem.id : null;
      }

      moduleLogger.info('Self-action web search completed', {
        action_id: action.id,
        query: action.query,
        share_item_id: shareItemId
      });
      return { ran: true, reason: 'completed', actionId: action.id, shareItemId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (action) {
        await this.store.failDigitalAction(action.id, message).catch(() => undefined);
      }
      moduleLogger.warn('Self-action web search failed', {
        action_id: action?.id || actionId,
        error: message
      });
      return { ran: false, reason: message, actionId: action?.id || actionId };
    }
  }
}

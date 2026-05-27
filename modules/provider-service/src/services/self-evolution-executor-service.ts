import type { UnifiedLLMConfig } from '../types';
import type { StoredConversationTurn } from './conversation-store-service';
import { listSelfEvolutionStates } from '@qq-bot/persistence';
import { aiConfig, databaseConfig, selfEvolutionConfig } from '../config';
import { buildUnifiedConfig } from './provider-debug-service';
import { createProviderClient, resolveProviderId } from './llm-provider';
import { extractNamedFunctionCallArgsFromOpenAIResponse } from './llm-provider/helpers';
import type { LLMProvider, OpenResponseCreateRequest, OpenResponseToolDefinition } from './llm-provider/types';

type SelfEvolutionLedgerEventRecord = {
  id: number;
  group_id?: number | null;
  target_user_id?: number | null;
  event_type: string;
  source_message_ids?: Array<number | string>;
  source_excerpt?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | Date | null;
};

export type SelfEvolutionExecutionPayload = {
  job_id: number;
  session_key: string;
  group_id: number | null;
  target_user_id: number | null;
  version: number;
  trigger_reason: string;
  summary_text?: string | null;
  transcript_compact_offset?: number;
  compact_role?: 'bridge_material' | string | null;
  turns: StoredConversationTurn[];
  ledger_events: SelfEvolutionLedgerEventRecord[];
};

type GeneratedSelfEvolutionState = {
  scope_type: string;
  target_user_id: number | null;
  social_presence_baseline: string;
  entry_preference: string;
  warmth_bias: string;
  familiarity_ceiling: string;
  topic_resonance: unknown[];
  boundary_tendencies: Record<string, unknown>;
  reinforced_modes: unknown[];
  suppressed_modes: unknown[];
  summary_text: string;
  source_event_ids: number[];
  source_message_ids: number[];
  metadata: Record<string, unknown>;
};

type ExecutionResult = {
  modelName: string;
  states: GeneratedSelfEvolutionState[];
  rawText: string;
};

type SelfEvolutionExecutorDeps = {
  llmProviderFactory?: (providerId: ReturnType<typeof resolveProviderId>) => LLMProvider;
  now?: () => number;
  modelName?: string;
  fallbackModelName?: string;
  timeoutMs?: number;
  listStates?: typeof listSelfEvolutionStates;
};

const SELF_EVOLUTION_TOOL_NAME = 'emit_self_evolution_states';
const SELF_EVOLUTION_TOOL: OpenResponseToolDefinition = {
  type: 'function',
  function: {
    name: SELF_EVOLUTION_TOOL_NAME,
    description: 'Return the structured self evolution states derived from the provided turns and ledger events.',
    parameters: {
      type: 'object',
      properties: {
        states: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              scope_type: { type: 'string' },
              target_user_id: { type: ['number', 'null'] },
              social_presence_baseline: { type: 'string' },
              entry_preference: { type: 'string' },
              warmth_bias: { type: 'string' },
              familiarity_ceiling: { type: 'string' },
              topic_resonance: {
                type: 'array',
                items: { type: 'string' }
              },
              boundary_tendencies: {
                type: 'object',
                additionalProperties: true
              },
              reinforced_modes: {
                type: 'array',
                items: { type: 'string' }
              },
              suppressed_modes: {
                type: 'array',
                items: { type: 'string' }
              },
              summary_text: { type: 'string' },
              source_event_ids: {
                type: 'array',
                items: { type: 'number' }
              },
              source_message_ids: {
                type: 'array',
                items: { type: 'number' }
              },
              metadata: {
                type: 'object',
                additionalProperties: true
              }
            },
            required: ['summary_text']
          }
        }
      },
      required: ['states']
    }
  }
};

function truncateText(value: unknown, maxLength: number) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 1))}…`;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizeNumericArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(
    value.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0).map((item) => Math.trunc(item))
  ));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(
    value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean).slice(0, 8)
  ));
}

function normalizeState(raw: unknown): GeneratedSelfEvolutionState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const state = raw as Record<string, unknown>;
  const summaryText = truncateText(state.summary_text, 220);
  if (!summaryText) {
    return null;
  }

  return {
    scope_type: typeof state.scope_type === 'string' && state.scope_type.trim() ? state.scope_type.trim() : 'group_self',
    target_user_id: Number.isFinite(Number(state.target_user_id)) ? Number(state.target_user_id) : null,
    social_presence_baseline: truncateText(state.social_presence_baseline, 32) || 'light',
    entry_preference: truncateText(state.entry_preference, 32) || 'cue_first',
    warmth_bias: truncateText(state.warmth_bias, 32) || 'warm_light',
    familiarity_ceiling: truncateText(state.familiarity_ceiling, 32) || 'warm_not_performative',
    topic_resonance: normalizeStringArray(state.topic_resonance),
    boundary_tendencies: state.boundary_tendencies && typeof state.boundary_tendencies === 'object' && !Array.isArray(state.boundary_tendencies)
      ? state.boundary_tendencies as Record<string, unknown>
      : {},
    reinforced_modes: normalizeStringArray(state.reinforced_modes),
    suppressed_modes: normalizeStringArray(state.suppressed_modes),
    summary_text: summaryText,
    source_event_ids: normalizeNumericArray(state.source_event_ids),
    source_message_ids: normalizeNumericArray(state.source_message_ids),
    metadata: state.metadata && typeof state.metadata === 'object' && !Array.isArray(state.metadata)
      ? state.metadata as Record<string, unknown>
      : {}
  };
}

function buildPromptPayload(payload: SelfEvolutionExecutionPayload) {
  return {
    session_key: payload.session_key,
    group_id: payload.group_id,
    target_user_id: payload.target_user_id,
    version: payload.version,
    trigger_reason: payload.trigger_reason,
    summary_text: typeof payload.summary_text === 'string' && payload.summary_text.trim()
      ? truncateText(payload.summary_text, 320)
      : null,
    transcript_compact_offset: Number.isFinite(Number(payload.transcript_compact_offset))
      ? Number(payload.transcript_compact_offset)
      : null,
    compact_role: payload.compact_role || 'bridge_material',
    turns: payload.turns.map((turn) => ({
      id: turn.id,
      source_message_ids: Array.isArray(turn.source_message_ids) && turn.source_message_ids.length > 0
        ? turn.source_message_ids
        : [turn.id],
      user_id: turn.user_id,
      group_id: turn.group_id,
      user_message: truncateText(turn.user_message, 180),
      timestamp: turn.timestamp
    })),
    ledger_events: payload.ledger_events.map((event) => ({
      id: event.id,
      target_user_id: event.target_user_id ?? null,
      event_type: event.event_type,
      source_message_ids: normalizeNumericArray(event.source_message_ids),
      source_excerpt: truncateText(event.source_excerpt, 160),
      metadata: event.metadata || {},
      created_at: event.created_at || null
    }))
  };
}

function buildSelfEvolutionConfig(
  modelName: string,
  providerId: ReturnType<typeof resolveProviderId>,
  timeoutMs: number
): UnifiedLLMConfig {
  return buildUnifiedConfig(modelName, providerId, {
    advanced_config: {
      generationConfig: {
        timeout: timeoutMs
      }
    }
  }, [
    '你在生成“小腻”的长期自我演化状态。',
    '不要写人物简介、角色设定、抽象人设。',
    '你要总结的是：过去这些经历怎样慢慢改变了她在这个群里、或和这个人之间的存在方式。',
    '重点是边界、靠近方式、出场惯性、共同经历的重量，不是知识点。'
  ].join('\n'));
}

function buildRequest(payload: SelfEvolutionExecutionPayload, config: UnifiedLLMConfig): OpenResponseCreateRequest {
  return {
    model: config.model.name,
    input: [{
      type: 'message',
      role: 'user',
      content: JSON.stringify(buildPromptPayload(payload), null, 2)
    }],
    instructions: [
      '根据输入，为“小腻”生成长期 self evolution state。',
      '允许输出 group_self 和 relation_self。',
      '每条 state 必须体现“被经历改变”的方向，不要只重复事件。',
      '如果输入里提供了 summary_text / compact_role，把它只当 compact 生成的桥接材料；它不能覆盖原始 turns 和 ledger evidence。',
      '优先依据原始 turns 与 ledger_events 判断哪些经历真正改变了她的出场方式、靠近方式和边界感。',
      '重点字段：social_presence_baseline, entry_preference, warmth_bias, familiarity_ceiling, topic_resonance, boundary_tendencies, reinforced_modes, suppressed_modes, summary_text。',
      '不要把 state 写成人物小传。不要写人物简介，不要写“她是一个怎样的人”。要写“她因为这些经历，变得更容易怎样出现、怎样收着、怎样靠近”。',
      `必须通过 ${SELF_EVOLUTION_TOOL_NAME} 返回结构化结果，不要改用普通文本回复。`
    ].join('\n'),
    tools: [SELF_EVOLUTION_TOOL],
    tool_choice: 'required',
    parallel_tool_calls: false,
    max_output_tokens: 900,
    temperature: 0.1
  };
}

function deriveHeuristicTopicResonance(payload: SelfEvolutionExecutionPayload) {
  const resonance = new Set<string>();
  for (const event of payload.ledger_events) {
    const keyword = typeof event.metadata?.keyword === 'string' ? event.metadata.keyword.trim() : '';
    if (keyword) {
      resonance.add(keyword);
      continue;
    }
    if (event.event_type === 'reply_chain_success') {
      resonance.add('direct_followup');
    } else if (event.event_type === 'shared_joke_formed') {
      resonance.add('shared_joke');
    } else if (event.event_type === 'topic_reactivated') {
      resonance.add('old_thread_reactivated');
    }
  }
  return Array.from(resonance).slice(0, 6);
}

function buildHeuristicStateSummary(params: {
  targetUserId: number | null;
  events: SelfEvolutionLedgerEventRecord[];
}) {
  const eventTypes = new Set(params.events.map((event) => event.event_type));
  if (params.targetUserId === null) {
    if (eventTypes.has('reply_chain_success') && eventTypes.has('shared_joke_formed')) {
      return '最近她在群里更像被 cue 后自然露头、轻轻接梗的人，但仍然会收着，不会为了存在感硬补句子。';
    }
    if (eventTypes.has('reply_chain_success')) {
      return '最近她在被点名或刚参与过的线程里，更容易短句露头并直接接住问题，不再急着解释过多。';
    }
    if (eventTypes.has('shared_joke_formed')) {
      return '最近群里的共享梗更容易把她轻轻带出来，但她还是偏向轻接一句，不会把梗写重。';
    }
    return '最近她仍然更像轻存在感的群友，先看气氛和关系边界，再决定要不要出现。';
  }

  if (eventTypes.has('shared_joke_formed')) {
    return `和 ${params.targetUserId} 的互动最近更容易把她带到轻松熟一点的状态，但她会把熟悉度停在轻接一句的位置。`;
  }
  if (eventTypes.has('reply_chain_success')) {
    return `和 ${params.targetUserId} 的对话最近更容易让她在被 cue 或自然续线时短句露头，先直接接住，再停住。`;
  }
  return `和 ${params.targetUserId} 的关系最近更像轻量熟悉、cue first，不会一上来就装得很近。`;
}

function deriveHeuristicStates(payload: SelfEvolutionExecutionPayload): GeneratedSelfEvolutionState[] {
  const states: GeneratedSelfEvolutionState[] = [];
  const byTarget = new Map<number | null, SelfEvolutionLedgerEventRecord[]>();
  for (const event of payload.ledger_events) {
    const key = Number.isFinite(Number(event.target_user_id)) ? Number(event.target_user_id) : null;
    const items = byTarget.get(key) || [];
    items.push(event);
    byTarget.set(key, items);
  }

  const buildState = (targetUserId: number | null, events: SelfEvolutionLedgerEventRecord[]): GeneratedSelfEvolutionState => {
    const eventTypes = new Set(events.map((event) => event.event_type));
    const reinforcedModes = [];
    if (eventTypes.has('reply_chain_success')) {
      reinforcedModes.push('brief_direct_followup');
    }
    if (eventTypes.has('shared_joke_formed')) {
      reinforcedModes.push('light_play_along');
    }
    if (eventTypes.has('topic_reactivated')) {
      reinforcedModes.push('thread_continuity');
    }
    return {
      scope_type: truncateText(targetUserId === null ? 'group_self' : 'relation_self', 32) || 'group_self',
      target_user_id: targetUserId,
      social_presence_baseline: truncateText('light', 32) || 'light',
      entry_preference: truncateText(
        eventTypes.has('reply_chain_success') ? 'cue_first_but_thread_continuation_ok' : 'cue_first',
        32
      ) || 'cue_first',
      warmth_bias: truncateText(eventTypes.has('shared_joke_formed') ? 'warm_light' : 'light', 32) || 'light',
      familiarity_ceiling: truncateText(
        eventTypes.has('shared_joke_formed') ? 'warm_not_performative' : 'light_to_warm',
        32
      ) || 'warm_not_performative',
      topic_resonance: deriveHeuristicTopicResonance({
        ...payload,
        ledger_events: events
      }),
      boundary_tendencies: {
        avoid_overexplaining: true,
        avoid_forced_entry: true,
        keep_one_line_by_default: true
      },
      reinforced_modes: reinforcedModes,
      suppressed_modes: ['performative_explainer', 'forced_familiarity'],
      summary_text: buildHeuristicStateSummary({
        targetUserId,
        events
      }),
      source_event_ids: events.map((event) => event.id),
      source_message_ids: Array.from(new Set(events.flatMap((event) => normalizeNumericArray(event.source_message_ids)))),
      metadata: {
        generated_at_ms: Date.now(),
        generator: 'self_evolution_executor_heuristic_fallback'
      }
    };
  };

  const groupEvents = byTarget.get(null) || payload.ledger_events;
  if (groupEvents.length > 0) {
    states.push(buildState(null, groupEvents));
  }

  const relationTargets = Array.from(byTarget.entries())
    .filter(([targetUserId]) => targetUserId !== null)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 2);
  for (const [targetUserId, events] of relationTargets) {
    states.push(buildState(targetUserId, events));
  }

  return states;
}

export default class SelfEvolutionExecutorService {
  private readonly llmProviderFactory: (providerId: ReturnType<typeof resolveProviderId>) => LLMProvider;
  private readonly now: () => number;
  private readonly modelName: string;
  private readonly fallbackModelName: string | null;
  private readonly timeoutMs: number;
  private readonly listStates: typeof listSelfEvolutionStates;

  constructor(deps: SelfEvolutionExecutorDeps = {}) {
    this.llmProviderFactory = deps.llmProviderFactory || ((providerId) => createProviderClient(providerId));
    this.now = deps.now || (() => Date.now());
    this.modelName = deps.modelName || aiConfig.model_name;
    this.fallbackModelName = deps.fallbackModelName || (this.modelName === 'gpt-5.4' ? 'gpt-5.4-mini' : null);
    this.timeoutMs = Math.max(1000, deps.timeoutMs || selfEvolutionConfig.timeoutMs || 90000);
    this.listStates = deps.listStates || ((filters) => listSelfEvolutionStates(filters, databaseConfig));
  }

  parseStates(text: string) {
    const parsed = parseJsonObject(text);
    return this.parseStatesPayload(parsed);
  }

  parseStatesPayload(payload: Record<string, unknown> | null | undefined) {
    if (!payload) {
      return [];
    }
    const rawStates = Array.isArray(payload.states) ? payload.states : [];
    return rawStates
      .map((state) => normalizeState(state))
      .filter((state): state is GeneratedSelfEvolutionState => Boolean(state))
      .map((state) => ({
        ...state,
        metadata: {
          ...state.metadata,
          generated_at_ms: this.now(),
          generator: 'self_evolution_executor'
        }
      }));
  }

  private async loadPersistedFallbackStates(payload: SelfEvolutionExecutionPayload) {
    const persistedStates = await this.listStates({
      sessionKey: payload.session_key,
      groupId: payload.group_id ?? undefined,
      targetUserId: payload.target_user_id ?? undefined,
      isActive: true,
      limit: 20
    });

    return persistedStates
      .map((state) => normalizeState({
        scope_type: state.scope_type,
        target_user_id: state.target_user_id,
        social_presence_baseline: state.social_presence_baseline,
        entry_preference: state.entry_preference,
        warmth_bias: state.warmth_bias,
        familiarity_ceiling: state.familiarity_ceiling,
        topic_resonance: state.topic_resonance,
        boundary_tendencies: state.boundary_tendencies,
        reinforced_modes: state.reinforced_modes,
        suppressed_modes: state.suppressed_modes,
        source_event_ids: state.source_event_ids,
        source_message_ids: state.source_message_ids,
        summary_text: state.summary_text,
        metadata: {
          ...(state.metadata && typeof state.metadata === 'object' ? state.metadata : {}),
          fallback_source: 'persisted_active_state',
          loaded_at_ms: this.now()
        }
      }))
      .filter((state): state is GeneratedSelfEvolutionState => Boolean(state));
  }

  async execute(payload: SelfEvolutionExecutionPayload): Promise<ExecutionResult> {
    const attempt = async (modelName: string): Promise<ExecutionResult> => {
      const providerId = resolveProviderId(null, modelName);
      const config = buildSelfEvolutionConfig(modelName, providerId, this.timeoutMs);
      const provider = this.llmProviderFactory(providerId);
      const request = buildRequest(payload, config);
      const result = await provider.generateContent({
        request,
        modelName,
        providerConfig: config,
        context: {
          traceId: `self_evolution_${payload.job_id}`,
          agentType: 'self_evolution_executor',
          promptName: 'self_evolution_executor'
        }
      });

      const toolPayload = extractNamedFunctionCallArgsFromOpenAIResponse(result.response, SELF_EVOLUTION_TOOL_NAME);
      const states = this.parseStatesPayload(toolPayload) || this.parseStates(result.text);
      return {
        modelName: result.modelName,
        states,
        rawText: toolPayload ? JSON.stringify(toolPayload) : result.text
      };
    };

    try {
      const primary = await attempt(this.modelName);
      if (primary.states.length > 0) {
        return primary;
      }
      const persistedStates = await this.loadPersistedFallbackStates(payload);
      return {
        modelName: persistedStates.length > 0 ? 'persisted-fallback' : 'heuristic-fallback',
        states: persistedStates.length > 0 ? persistedStates : deriveHeuristicStates(payload),
        rawText: primary.rawText
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/usage_limit_reached|429|Too Many Requests/i.test(message)) {
        throw error;
      }

      if (this.fallbackModelName) {
        try {
          const secondary = await attempt(this.fallbackModelName);
          if (secondary.states.length > 0) {
            return secondary;
          }
        } catch (fallbackError) {
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          if (!/usage_limit_reached|429|Too Many Requests/i.test(fallbackMessage)) {
            throw fallbackError;
          }
        }
      }

      const persistedStates = await this.loadPersistedFallbackStates(payload);
      if (persistedStates.length > 0) {
        return {
          modelName: 'persisted-fallback',
          states: persistedStates,
          rawText: JSON.stringify({ persisted_fallback: true })
        };
      }

      return {
        modelName: 'heuristic-fallback',
        states: deriveHeuristicStates(payload),
        rawText: JSON.stringify({ heuristic_fallback: true })
      };
    }
  }
}

import type { UnifiedLLMConfig } from '../types';
import type { StoredConversationTurn } from './conversation-store-service';
import { aiConfig } from '../config';
import { buildUnifiedConfig } from './provider-debug-service';
import { createProviderClient, resolveProviderId } from './llm-provider';
import type { LLMProvider, OpenResponseCreateRequest } from './llm-provider/types';
import { logger } from '../utils/logger';

type LedgerEventRecord = {
  id: number;
  group_id?: number | null;
  target_user_id?: number | null;
  event_type: string;
  confidence?: string | null;
  event_weight?: number | null;
  source_message_ids?: Array<number | string>;
  source_excerpt?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | Date | null;
};

export type RelationshipMemoryExecutionPayload = {
  job_id: number;
  session_key: string;
  group_id: number | null;
  version: number;
  trigger_reason: string;
  turns: StoredConversationTurn[];
  ledger_events: LedgerEventRecord[];
};

type GeneratedRelationshipMemoryCard = {
  card_type: string;
  target_user_id: number | null;
  summary_text: string;
  actors: string[];
  context_before: string;
  trigger: string;
  interaction: string;
  outcome: string;
  source_event_ids: number[];
  source_message_ids: number[];
  retrieval_text: string;
  embedding_text: string;
  importance_score: number;
  freshness_score: number;
  decayed_score: number;
  metadata: Record<string, unknown>;
};

type GeneratedCardDraft = {
  target_user_id: number | null;
  actors: string[];
  context_before: string;
  trigger: string;
  interaction: string;
  outcome: string;
  evidence_message_ids: number[];
  summary_text: string;
};

type ExecutionResult = {
  modelName: string;
  cards: GeneratedRelationshipMemoryCard[];
  rawText: string;
};

type RelationshipMemoryExecutorDeps = {
  llmProviderFactory?: (providerId: ReturnType<typeof resolveProviderId>) => LLMProvider;
  now?: () => number;
  modelName?: string;
};

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

function truncateText(value: unknown, maxLength: number) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 1))}…`;
}

function stripNonSemanticPlaceholders(value: unknown) {
  return (typeof value === 'string' ? value : '')
    .replace(/\[(?:Image|Video|Audio|Voice|Sticker|Emoji|File(?::[^\]]*)?)\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSemanticLedgerEvent(event: LedgerEventRecord) {
  const excerpt = stripNonSemanticPlaceholders(event.source_excerpt);
  const keyword = stripNonSemanticPlaceholders((event.metadata as Record<string, unknown> | null | undefined)?.keyword);
  return Boolean(excerpt || keyword);
}

function normalizeNumericArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.trunc(item))));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 8)));
}

function normalizeCardDraft(raw: unknown, targetUserId: number | null): GeneratedCardDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const card = raw as Record<string, unknown>;
  const evidenceMessageIds = normalizeNumericArray(card.evidence_message_ids);
  const summaryText = truncateText(card.summary_text, 180);
  if (!summaryText || evidenceMessageIds.length === 0) {
    return null;
  }

  return {
    target_user_id: targetUserId,
    actors: normalizeStringArray(card.actors),
    context_before: truncateText(card.context_before, 180),
    trigger: truncateText(card.trigger, 180),
    interaction: truncateText(card.interaction, 180),
    outcome: truncateText(card.outcome, 180),
    evidence_message_ids: evidenceMessageIds,
    summary_text: summaryText
  };
}

function buildEventLookup(events: LedgerEventRecord[]) {
  return new Map<number, LedgerEventRecord>(
    events
      .filter((event) => Number.isFinite(Number(event.id)))
      .map((event) => [Number(event.id), event])
  );
}

function buildTurnLookup(turns: StoredConversationTurn[]) {
  const lookup = new Map<number, StoredConversationTurn>();
  for (const turn of turns) {
    const sourceMessageIds = Array.isArray(turn.source_message_ids) && turn.source_message_ids.length > 0
      ? turn.source_message_ids
      : [turn.id];
    for (const sourceMessageId of sourceMessageIds) {
      const numeric = Number(sourceMessageId);
      if (Number.isFinite(numeric) && numeric > 0 && !lookup.has(numeric)) {
        lookup.set(numeric, turn);
      }
    }
  }
  return lookup;
}

function deriveSourceEventIds(
  draft: GeneratedCardDraft,
  cardType: string,
  events: LedgerEventRecord[]
) {
  const evidenceSet = new Set(draft.evidence_message_ids);
  const directMatches = events
    .filter((event) => {
      const sourceMessageIds = normalizeNumericArray(event.source_message_ids);
      return sourceMessageIds.some((messageId) => evidenceSet.has(messageId));
    })
    .map((event) => Number(event.id));

  if (directMatches.length > 0) {
    return Array.from(new Set(directMatches));
  }

  return Array.from(new Set(events
    .filter((event) => cardType === 'group_memory'
      ? !Number.isFinite(Number(event.target_user_id))
      : Number(event.target_user_id) === draft.target_user_id
    )
    .map((event) => Number(event.id))
    .filter((id) => Number.isFinite(id))));
}

function buildRetrievalText(draft: GeneratedCardDraft, supportingTurns: StoredConversationTurn[]) {
  return [
    draft.summary_text,
    draft.context_before,
    draft.trigger,
    draft.interaction,
    draft.outcome,
    draft.actors.join(' '),
    supportingTurns.map((turn) => turn.user_message).join('\n')
  ]
    .map((item) => truncateText(item, 400))
    .filter(Boolean)
    .join('\n');
}

function buildEmbeddingText(draft: GeneratedCardDraft) {
  return [
    draft.summary_text,
    draft.context_before,
    draft.trigger,
    draft.interaction,
    draft.outcome,
    draft.actors.join(' ')
  ]
    .filter(Boolean)
    .join('\n');
}

function buildPromptPayload(payload: RelationshipMemoryExecutionPayload) {
  return {
    session_key: payload.session_key,
    group_id: payload.group_id,
    version: payload.version,
    trigger_reason: payload.trigger_reason,
    turns: payload.turns.map((turn) => ({
      id: turn.id,
      source_message_ids: Array.isArray(turn.source_message_ids) && turn.source_message_ids.length > 0
        ? turn.source_message_ids
        : [turn.id],
      user_id: turn.user_id,
      group_id: turn.group_id,
      user_message: truncateText(turn.user_message, 180),
      ai_response: truncateText(turn.ai_response, 180),
      timestamp: turn.timestamp
    })),
    ledger_events: payload.ledger_events.map((event) => ({
      id: Number(event.id),
      event_type: event.event_type,
      target_user_id: Number.isFinite(Number(event.target_user_id)) ? Number(event.target_user_id) : null,
      confidence: typeof event.confidence === 'string' ? event.confidence : null,
      event_weight: typeof event.event_weight === 'number' ? event.event_weight : null,
      source_message_ids: normalizeNumericArray(event.source_message_ids),
      source_excerpt: truncateText(event.source_excerpt, 160),
      created_at: event.created_at instanceof Date ? event.created_at.toISOString() : event.created_at || null
    }))
  };
}

function buildRelationshipMemoryConfig(modelName: string, providerId: ReturnType<typeof resolveProviderId>): UnifiedLLMConfig {
  return buildUnifiedConfig(
    modelName,
    providerId,
    {
      advanced_config: {
        generationConfig: {
          temperature: 0.1,
          topP: 0.2,
          maxOutputTokens: 1200
        },
        thinkingConfig: {
          reasoningEffort: 'low'
        }
      }
    },
    undefined,
    null
  );
}

export class RelationshipMemoryExecutorService {
  private readonly moduleLogger = logger.createModuleLogger('relationship-memory-executor');
  private readonly llmProviderFactory: (providerId: ReturnType<typeof resolveProviderId>) => LLMProvider;
  private readonly now: () => number;
  private readonly modelName: string;

  constructor(deps: RelationshipMemoryExecutorDeps = {}) {
    this.llmProviderFactory = deps.llmProviderFactory || createProviderClient;
    this.now = deps.now || (() => Date.now());
    this.modelName = deps.modelName || aiConfig.model_name || 'gemini-2.5-flash';
  }

  async execute(payload: RelationshipMemoryExecutionPayload): Promise<ExecutionResult> {
    const filteredPayload: RelationshipMemoryExecutionPayload = {
      ...payload,
      ledger_events: payload.ledger_events.filter((event) => isSemanticLedgerEvent(event))
    };
    const providerId = resolveProviderId(null, this.modelName);
    const provider = this.llmProviderFactory(providerId);
    const config = buildRelationshipMemoryConfig(this.modelName, providerId);
    const requestPayload = buildPromptPayload(filteredPayload);
    const instructions = [
      '你是群聊关系记忆整理器。你的任务是把最近群聊和结构化 ledger 事件整理成可追溯的关系卡片。',
      '必须严格依据输入，不要编造不存在的关系、梗、情绪或结论。',
      '只输出 JSON，不要输出解释、Markdown 或代码块外文字。',
      '如果证据不足，返回空数组，不要硬写。',
      '优先抽取：共享梗、成功接话、旧话题再激活。',
      '每张卡片都必须保留 evidence_message_ids，且这些 id 必须来自 turns[*].source_message_ids。',
      'group_cards 表示群公共记忆，不带 target_user_id。',
      'person_cards 表示和具体人的关系记忆，必须填写 target_user_id。',
      '每个 card 只保留 7 个核心字段：actors, context_before, trigger, interaction, outcome, evidence_message_ids, summary_text。',
      '最多输出 2 张 group_cards，最多输出 3 张 person_cards。',
      'JSON schema: {"group_cards":[{"actors":["string"],"context_before":"string","trigger":"string","interaction":"string","outcome":"string","evidence_message_ids":[1],"summary_text":"string"}],"person_cards":[{"target_user_id":123,"actors":["string"],"context_before":"string","trigger":"string","interaction":"string","outcome":"string","evidence_message_ids":[1],"summary_text":"string"}]}'
    ].join('\n');

    const request: OpenResponseCreateRequest = {
      model: this.modelName,
      instructions,
      input: [
        {
          type: 'message',
          role: 'user',
          content: JSON.stringify(requestPayload, null, 2)
        }
      ],
      temperature: 0.1,
      top_p: 0.2,
      max_output_tokens: 1200
    };

    const result = await provider.generateContent({
      modelName: this.modelName,
      providerConfig: config,
      request,
      context: {
        sessionId: filteredPayload.session_key,
        agentType: 'relationship_memory_executor',
        promptName: 'relationship_memory_executor'
      }
    });

    const cards = this.parseCards(result.text, filteredPayload);
    return {
      modelName: result.modelName,
      cards,
      rawText: result.text
    };
  }

  parseCards(text: string, payload: RelationshipMemoryExecutionPayload): GeneratedRelationshipMemoryCard[] {
    const parsed = parseJsonObject(text);
    if (!parsed) {
      throw new Error('relationship_memory_executor_non_json');
    }

    const drafts: Array<{ cardType: string; draft: GeneratedCardDraft }> = [];
    const rawGroupCards = Array.isArray(parsed.group_cards) ? parsed.group_cards : [];
    for (const rawCard of rawGroupCards.slice(0, 2)) {
      const draft = normalizeCardDraft(rawCard, null);
      if (draft) {
        drafts.push({ cardType: 'group_memory', draft });
      }
    }

    const rawPersonCards = Array.isArray(parsed.person_cards) ? parsed.person_cards : [];
    for (const rawCard of rawPersonCards.slice(0, 3)) {
      const targetUserId = Number((rawCard as Record<string, unknown>)?.target_user_id);
      const draft = normalizeCardDraft(rawCard, Number.isFinite(targetUserId) && targetUserId > 0 ? Math.trunc(targetUserId) : null);
      if (draft && draft.target_user_id !== null) {
        drafts.push({ cardType: 'person_memory', draft });
      }
    }

    const eventLookup = buildEventLookup(payload.ledger_events);
    const turnLookup = buildTurnLookup(payload.turns);
    const generatedAt = new Date(this.now()).toISOString();

    const cards = drafts.map(({ cardType, draft }) => {
      const sourceEventIds = deriveSourceEventIds(draft, cardType, payload.ledger_events);
      const supportingTurns = draft.evidence_message_ids
        .map((messageId) => turnLookup.get(messageId))
        .filter((turn): turn is StoredConversationTurn => Boolean(turn));
      const supportingEvents = sourceEventIds
        .map((eventId) => eventLookup.get(eventId))
        .filter(Boolean);
      const importanceScore = supportingEvents.length > 0 ? Math.min(1, 0.35 + supportingEvents.length * 0.2) : 0.3;
      const freshnessScore = 1;

      return {
        card_type: cardType,
        target_user_id: draft.target_user_id,
        summary_text: draft.summary_text,
        actors: draft.actors,
        context_before: draft.context_before,
        trigger: draft.trigger,
        interaction: draft.interaction,
        outcome: draft.outcome,
        source_event_ids: sourceEventIds,
        source_message_ids: draft.evidence_message_ids,
        retrieval_text: buildRetrievalText(draft, supportingTurns),
        embedding_text: buildEmbeddingText(draft),
        importance_score: importanceScore,
        freshness_score: freshnessScore,
        decayed_score: importanceScore * freshnessScore,
        metadata: {
          generator: 'relationship_memory_executor',
          generated_at: generatedAt,
          model_name: this.modelName,
          supporting_event_types: supportingEvents.map((event) => event?.event_type).filter(Boolean)
        }
      };
    });

    const deduped = new Map<string, GeneratedRelationshipMemoryCard>();
    for (const card of cards) {
      const key = `${card.card_type}:${card.target_user_id ?? 'group'}:${card.summary_text}`;
      if (!deduped.has(key)) {
        deduped.set(key, card);
      } else {
        this.moduleLogger.debug('Dropped duplicate relationship memory card', {
          key,
          sessionKey: payload.session_key
        });
      }
    }

    return Array.from(deduped.values());
  }
}

export default RelationshipMemoryExecutorService;

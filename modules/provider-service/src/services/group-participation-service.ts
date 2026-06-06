import { getPrismaClient } from '@qq-bot/persistence';
import { aiConfig, databaseConfig } from '../config';
import type { FinalizedInboundContext, UnifiedLLMConfig } from '../types';
import EmbeddingService from './embedding-service';
import { logger } from '../utils/logger';
import { createProviderClient, resolveProviderId } from './llm-provider';
import { extractNamedFunctionCallArgsFromOpenAIResponse } from './llm-provider/helpers';
import type { LLMProvider, OpenResponseToolDefinition } from './llm-provider/types';
import { withReplayLlmCallId } from './provider-replay-ledger';

type ParticipationDecision = 'reply' | 'ignore' | 'ambiguous';

type ParticipationReason =
  | 'private_chat'
  | 'explicit_mention'
  | 'reply_to_bot'
  | 'cooldown_active'
  | 'recent_reply_budget_exceeded'
  | 'low_signal'
  | 'score_reply'
  | 'score_ambiguous'
  | 'llm_judge_reply'
  | 'llm_judge_ignore'
  | 'llm_judge_ambiguous'
  | 'embedding_unavailable'
  | 'embedding_error'
  | 'llm_judge_error';

type RecentInboundMessage = {
  messageSid: string;
  senderId: string;
  bodyForAgent: string;
  wasMentioned: boolean;
  replyToSender?: string | null;
  replyToBody?: string | null;
  receivedAtMs: number;
};

type GroupParticipationDecisionResult = {
  decision: ParticipationDecision;
  reason: ParticipationReason;
  confidence: 'high' | 'medium' | 'low';
  conservativeFallback: boolean;
  usedEmbeddings: boolean;
  usedLlmJudge: boolean;
  scores: {
    addressedness: number;
    continuity: number;
    socialPosition: number;
    interest: number;
    timing: number;
    valueAdd: number;
    final: number;
  };
  metadata: Record<string, unknown>;
};

type EmbeddingClient = Pick<EmbeddingService, 'isEnabled' | 'createEmbeddings'>;

type AmbiguousJudgeInput = {
  inboundContext: FinalizedInboundContext;
  recentMessages: RecentInboundMessage[];
  scores: GroupParticipationDecisionResult['scores'];
  metadata: Record<string, unknown>;
  usedEmbeddings: boolean;
  embeddingError: boolean;
};

type AmbiguousJudgeOutput = {
  decision: ParticipationDecision;
  confidence: 'high' | 'medium' | 'low';
  reason?: string;
  modelName?: string;
};

type GroupParticipationServiceDeps = {
  embeddingService?: EmbeddingClient;
  llmJudge?: (input: AmbiguousJudgeInput) => Promise<AmbiguousJudgeOutput | null>;
  llmProviderFactory?: (providerId: ReturnType<typeof resolveProviderId>) => LLMProvider;
  now?: () => number;
  cooldownMs?: number;
  maxRepliesPerWindow?: number;
  replyWindowMs?: number;
  recentInboundLimit?: number;
  botNameCues?: string[];
  interestPrototypeTexts?: string[];
  recentMessageProvider?: (params: { sessionKey: string; currentMessageSid?: string }) => Promise<RecentInboundMessage[]>;
};

const GROUP_PARTICIPATION_TOOL_NAME = 'emit_group_participation_decision';
const GROUP_PARTICIPATION_TOOL: OpenResponseToolDefinition = {
  type: 'function',
  function: {
    name: GROUP_PARTICIPATION_TOOL_NAME,
    description: 'Return the structured decision for whether the bot should join the current group thread.',
    parameters: {
      type: 'object',
      properties: {
        decision: {
          type: 'string',
          enum: ['reply', 'ignore', 'ambiguous']
        },
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low']
        },
        reason: {
          type: 'string',
          description: 'Short reason, up to 24 characters.'
        }
      },
      required: ['decision', 'confidence']
    }
  }
};

const DEFAULT_COOLDOWN_MS = Number.parseInt(process.env.GROUP_PARTICIPATION_COOLDOWN_MS || '90000', 10);
const DEFAULT_REPLY_WINDOW_MS = Number.parseInt(process.env.GROUP_PARTICIPATION_REPLY_WINDOW_MS || '600000', 10);
const DEFAULT_MAX_REPLIES_PER_WINDOW = Number.parseInt(process.env.GROUP_PARTICIPATION_MAX_REPLIES_PER_WINDOW || '2', 10);
const DEFAULT_RECENT_INBOUND_LIMIT = Number.parseInt(process.env.GROUP_PARTICIPATION_RECENT_INBOUND_LIMIT || '6', 10);
const DEFAULT_LLM_JUDGE_ENABLED = process.env.GROUP_PARTICIPATION_LLM_JUDGE_ENABLED !== 'false';
const DEFAULT_LLM_JUDGE_MODEL = (process.env.GROUP_PARTICIPATION_LLM_JUDGE_MODEL || aiConfig.model_name || 'gemini-2.5-flash').trim();
const DEFAULT_BOT_NAME_CUES = (process.env.GROUP_PARTICIPATION_BOT_NAME_CUES || '小腻')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const DEFAULT_INTEREST_PROTOTYPES = [
  '群里有人在问意见、求推荐、征求看法，适合自然接一句。',
  '群里在聊日常吃喝玩乐、轻松吐槽、随手闲聊，这类话题更容易自然参与。',
  '群里有人在继续刚才的话题，尤其是延续上文、补充细节、追问后续。'
];

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index];
    const r = right[index];
    dot += l * r;
    leftNorm += l * l;
    rightNorm += r * r;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function normalizeSimilarityToScore(similarity: number) {
  if (similarity >= 0.92) {
    return 1;
  }
  if (similarity >= 0.84) {
    return 0.85;
  }
  if (similarity >= 0.76) {
    return 0.65;
  }
  if (similarity >= 0.7) {
    return 0.45;
  }
  return 0;
}

function countMatches(text: string, patterns: RegExp[]) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function normalizeConfidence(value: unknown): 'high' | 'medium' | 'low' {
  if (typeof value !== 'string') {
    return 'low';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized;
  }
  return 'low';
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

function truncateText(value: string | undefined | null, maxLength: number) {
  const trimmed = (value || '').trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function buildJudgeConfig(modelName: string, providerId: ReturnType<typeof resolveProviderId>): UnifiedLLMConfig {
  return {
    id: 'group-participation-judge',
    name: 'Group Participation Judge',
    category: 'runtime',
    model: {
      name: modelName,
      provider: providerId
    },
    generation: {
      temperature: 0.1,
      topP: 0.2,
      maxOutputTokens: 160
    },
    safety: [],
    tools: {},
    context: {},
    performance: {
      timeout: 15000
    },
    version: {
      version: '1.0.0',
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'provider-service',
      isActive: true
    }
  };
}

export class GroupParticipationService {
  private readonly moduleLogger = logger.createModuleLogger('group-participation-service');
  private readonly prisma = getPrismaClient({
    databaseUrl: databaseConfig.url,
    host: databaseConfig.host,
    port: databaseConfig.port,
    user: databaseConfig.user,
    password: databaseConfig.password,
    database: databaseConfig.database
  });
  private readonly embeddingService?: EmbeddingClient;
  private readonly llmJudge?: GroupParticipationServiceDeps['llmJudge'];
  private readonly llmProviderFactory: (providerId: ReturnType<typeof resolveProviderId>) => LLMProvider;
  private readonly now: () => number;
  private readonly cooldownMs: number;
  private readonly maxRepliesPerWindow: number;
  private readonly replyWindowMs: number;
  private readonly recentInboundLimit: number;
  private readonly botNameCues: string[];
  private readonly interestPrototypeTexts: string[];
  private readonly recentReplyTimestamps = new Map<string, number[]>();
  private readonly recentMessageProvider?: GroupParticipationServiceDeps['recentMessageProvider'];

  constructor(deps: GroupParticipationServiceDeps = {}) {
    this.embeddingService = deps.embeddingService;
    this.llmJudge = deps.llmJudge;
    this.llmProviderFactory = deps.llmProviderFactory || createProviderClient;
    this.now = deps.now || (() => Date.now());
    this.cooldownMs = deps.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.maxRepliesPerWindow = deps.maxRepliesPerWindow ?? DEFAULT_MAX_REPLIES_PER_WINDOW;
    this.replyWindowMs = deps.replyWindowMs ?? DEFAULT_REPLY_WINDOW_MS;
    this.recentInboundLimit = deps.recentInboundLimit ?? DEFAULT_RECENT_INBOUND_LIMIT;
    this.botNameCues = deps.botNameCues ?? DEFAULT_BOT_NAME_CUES;
    this.interestPrototypeTexts = deps.interestPrototypeTexts ?? DEFAULT_INTEREST_PROTOTYPES;
    this.recentMessageProvider = deps.recentMessageProvider;
  }

  async decide(inboundContext: FinalizedInboundContext): Promise<GroupParticipationDecisionResult> {
    if (inboundContext.ChatType !== 'group') {
      return this.buildStaticDecision('reply', 'private_chat', 'high', {
        addressedness: 1,
        continuity: 0,
        socialPosition: 1,
        interest: 1,
        timing: 1,
        valueAdd: 1,
        final: 1
      }, {
        path: 'private'
      });
    }

    const sessionKey = inboundContext.SessionKey || 'unknown-session';
    const now = this.now();
    this.pruneRecentReplies(now);

    const addressedness = this.computeAddressedness(inboundContext);
    const directReplyToBot = inboundContext.ReplyToSenderId === inboundContext.AccountId;
    if (inboundContext.WasMentioned === true) {
      return this.buildStaticDecision('reply', 'explicit_mention', 'high', {
        addressedness: 1,
        continuity: 0.9,
        socialPosition: 1,
        interest: 0.8,
        timing: 1,
        valueAdd: 0.8,
        final: 1
      }, {
        sessionKey,
        path: 'fast_allow'
      });
    }

    if (directReplyToBot) {
      return this.buildStaticDecision('reply', 'reply_to_bot', 'high', {
        addressedness: 1,
        continuity: 1,
        socialPosition: 1,
        interest: 0.8,
        timing: 1,
        valueAdd: 0.8,
        final: 1
      }, {
        sessionKey,
        path: 'fast_allow'
      });
    }

    const cooldown = this.getRecentReplyState(sessionKey, now);
    if (cooldown.withinCooldown) {
      return this.buildStaticDecision('ignore', 'cooldown_active', 'high', {
        addressedness,
        continuity: 0,
        socialPosition: 0,
        interest: 0,
        timing: 0,
        valueAdd: 0,
        final: 0
      }, {
        sessionKey,
        path: 'fast_deny',
        cooldownRemainingMs: cooldown.cooldownRemainingMs
      });
    }

    if (cooldown.recentReplyCount >= this.maxRepliesPerWindow) {
      return this.buildStaticDecision('ignore', 'recent_reply_budget_exceeded', 'high', {
        addressedness,
        continuity: 0,
        socialPosition: 0,
        interest: 0,
        timing: 0.1,
        valueAdd: 0,
        final: 0
      }, {
        sessionKey,
        path: 'fast_deny',
        recentReplyCount: cooldown.recentReplyCount
      });
    }

    const recentMessages = await this.getRecentMessages({
      sessionKey,
      currentMessageSid: inboundContext.MessageSid
    });
    const embeddingSignals = await this.computeEmbeddingSignals(inboundContext, recentMessages);
    const socialPosition = this.computeSocialPosition(inboundContext, recentMessages);
    const interest = this.computeInterest(
      inboundContext,
      recentMessages,
      embeddingSignals.continuityScore,
      embeddingSignals.interestScore
    );
    const timing = this.computeTimingScore(cooldown);
    const valueAdd = this.computeValueAdd(inboundContext, recentMessages);

    const finalScore = clamp01(
      addressedness * 0.34
      + embeddingSignals.continuityScore * 0.24
      + socialPosition * 0.14
      + interest * 0.14
      + timing * 0.08
      + valueAdd * 0.06
    );

    const metadata: Record<string, unknown> = {
      sessionKey,
      recentInboundCount: recentMessages.length,
      cooldownRemainingMs: cooldown.cooldownRemainingMs,
      recentReplyCount: cooldown.recentReplyCount,
      embeddingError: embeddingSignals.embeddingError || null,
      continuitySimilarity: embeddingSignals.topSimilarity ?? null,
      interestSimilarity: embeddingSignals.interestSimilarity ?? null
    };

    const scores = {
      addressedness,
      continuity: embeddingSignals.continuityScore,
      socialPosition,
      interest,
      timing,
      valueAdd,
      final: finalScore
    };

    if (embeddingSignals.continuityScore >= 0.85 && (socialPosition >= 0.35 || interest >= 0.55)) {
      return {
        decision: 'reply',
        reason: 'score_reply',
        confidence: 'medium',
        conservativeFallback: false,
        usedEmbeddings: embeddingSignals.usedEmbeddings,
        usedLlmJudge: false,
        scores,
        metadata: {
          ...metadata,
          path: 'strong_continuity_override'
        }
      };
    }

    if (finalScore >= 0.68) {
      return {
        decision: 'reply',
        reason: 'score_reply',
        confidence: finalScore >= 0.8 ? 'high' : 'medium',
        conservativeFallback: false,
        usedEmbeddings: embeddingSignals.usedEmbeddings,
        usedLlmJudge: false,
        scores,
        metadata
      };
    }

    if (finalScore >= 0.48) {
      const llmJudgedDecision = await this.maybeResolveAmbiguousWithLlm({
        inboundContext,
        recentMessages,
        scores,
        metadata,
        usedEmbeddings: embeddingSignals.usedEmbeddings,
        embeddingError: embeddingSignals.embeddingError
      });
      if (llmJudgedDecision) {
        return llmJudgedDecision;
      }

      return {
        decision: 'ambiguous',
        reason: embeddingSignals.embeddingError ? 'embedding_error' : 'score_ambiguous',
        confidence: 'low',
        conservativeFallback: true,
        usedEmbeddings: embeddingSignals.usedEmbeddings,
        usedLlmJudge: false,
        scores,
        metadata
      };
    }

    if (embeddingSignals.embeddingError) {
      return {
        decision: 'ignore',
        reason: 'embedding_error',
        confidence: 'low',
        conservativeFallback: true,
        usedEmbeddings: embeddingSignals.usedEmbeddings,
        usedLlmJudge: false,
        scores,
        metadata
      };
    }

    return {
      decision: 'ignore',
      reason: embeddingSignals.usedEmbeddings ? 'low_signal' : 'embedding_unavailable',
      confidence: 'medium',
      conservativeFallback: !embeddingSignals.usedEmbeddings,
      usedEmbeddings: embeddingSignals.usedEmbeddings,
      usedLlmJudge: false,
      scores,
      metadata
    };
  }

  recordBotReply(sessionKey: string, timestamp = this.now()) {
    const next = (this.recentReplyTimestamps.get(sessionKey) || []).concat(timestamp);
    this.recentReplyTimestamps.set(sessionKey, next);
    this.pruneRecentReplies(timestamp);
  }

  private buildStaticDecision(
    decision: ParticipationDecision,
    reason: ParticipationReason,
    confidence: 'high' | 'medium' | 'low',
    scores: GroupParticipationDecisionResult['scores'],
    metadata: Record<string, unknown>
  ): GroupParticipationDecisionResult {
    return {
      decision,
      reason,
      confidence,
      conservativeFallback: decision !== 'reply',
      usedEmbeddings: false,
      usedLlmJudge: false,
      scores,
      metadata
    };
  }

  private async maybeResolveAmbiguousWithLlm(input: AmbiguousJudgeInput): Promise<GroupParticipationDecisionResult | null> {
    const modelName = DEFAULT_LLM_JUDGE_MODEL;
    if (!DEFAULT_LLM_JUDGE_ENABLED || !modelName) {
      return null;
    }

    try {
      const result = this.llmJudge
        ? await this.llmJudge(input)
        : await this.runDefaultLlmJudge(input, modelName);

      if (!result) {
        return null;
      }

      const decision = result.decision === 'reply' || result.decision === 'ignore' || result.decision === 'ambiguous'
        ? result.decision
        : 'ambiguous';
      const reason: ParticipationReason =
        decision === 'reply'
          ? 'llm_judge_reply'
          : decision === 'ignore'
            ? 'llm_judge_ignore'
            : 'llm_judge_ambiguous';

      return {
        decision,
        reason,
        confidence: result.confidence,
        conservativeFallback: decision !== 'reply',
        usedEmbeddings: input.usedEmbeddings,
        usedLlmJudge: true,
        scores: input.scores,
        metadata: {
          ...input.metadata,
          path: 'llm_judge',
          usedLlmJudge: true,
          llmJudgeModel: result.modelName || modelName,
          llmJudgeDecision: decision,
          llmJudgeConfidence: result.confidence,
          llmJudgeReason: result.reason || null
        }
      };
    } catch (error) {
      this.moduleLogger.warn('Participation LLM judge failed', {
        error: error instanceof Error ? error.message : String(error),
        sessionKey: input.inboundContext.SessionKey
      });

      return {
        decision: 'ignore',
        reason: 'llm_judge_error',
        confidence: 'low',
        conservativeFallback: true,
        usedEmbeddings: input.usedEmbeddings,
        usedLlmJudge: true,
        scores: input.scores,
        metadata: {
          ...input.metadata,
          path: 'llm_judge_error',
          usedLlmJudge: true,
          llmJudgeModel: modelName,
          llmJudgeError: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  private async runDefaultLlmJudge(input: AmbiguousJudgeInput, modelName: string): Promise<AmbiguousJudgeOutput | null> {
    const providerId = resolveProviderId(null, modelName);
    const provider = this.llmProviderFactory(providerId);
    const config = buildJudgeConfig(modelName, providerId);
    const recentMessages = input.recentMessages
      .slice(-3)
      .map((message, index) => ({
        index: index + 1,
        sender_id: message.senderId,
        body: truncateText(message.bodyForAgent, 120),
        was_mentioned: message.wasMentioned,
        reply_to_sender: message.replyToSender || null
      }));
    const payload = {
      current_message: truncateText(input.inboundContext.BodyForAgent, 160),
      raw_message: truncateText(input.inboundContext.RawBody, 160),
      sender_id: input.inboundContext.SenderId || null,
      sender_name: input.inboundContext.SenderName || null,
      was_mentioned: Boolean(input.inboundContext.WasMentioned),
      reply_to_sender_id: input.inboundContext.ReplyToSenderId || null,
      reply_to_body: truncateText(input.inboundContext.ReplyToBody, 120),
      cooldown_remaining_ms: input.metadata.cooldownRemainingMs || 0,
      recent_reply_count: input.metadata.recentReplyCount || 0,
      recent_inbound_count: input.metadata.recentInboundCount || 0,
      used_embeddings: input.usedEmbeddings,
      embedding_error: input.embeddingError,
      scores: input.scores,
      recent_messages: recentMessages
    };
    const instructions = [
      '你是群聊参与裁决器，只判断机器人这条消息是否值得进入主回复循环。',
      '目标是像真实群友一样克制。避免过度参与。',
      '当信号不足、时机不对、像硬插话时，优先 ignore。',
      '只有在当前消息明显在接机器人、值得自然接一句、且不是冷却期刷屏时才 reply。',
      `必须通过 ${GROUP_PARTICIPATION_TOOL_NAME} 返回结构化结果，不要改用普通文本回复。`
    ].join('\n');
	    const context = withReplayLlmCallId({
	      sessionId: input.inboundContext.SessionKey,
	      agentType: 'group_participation_judge',
	      promptName: 'group_participation_judge',
	      replayIdentityKey: 'xiaoni-internal'
	    }, 'group_judge');

    const result = await provider.generateContent({
      modelName,
      providerConfig: config,
      request: {
        model: modelName,
        instructions,
        input: [
          {
            type: 'message',
            role: 'user',
            content: JSON.stringify(payload, null, 2)
          }
        ],
        tools: [GROUP_PARTICIPATION_TOOL],
        tool_choice: 'required',
        parallel_tool_calls: false,
        temperature: 0.1,
        top_p: 0.2,
        max_output_tokens: 160
      },
      context
    });
	    const parsed = extractNamedFunctionCallArgsFromOpenAIResponse(result.response, GROUP_PARTICIPATION_TOOL_NAME)
      || parseJsonObject(result.text);
    if (!parsed) {
      throw new Error('LLM judge returned non-JSON payload');
    }

    const decisionValue = typeof parsed.decision === 'string' ? parsed.decision.trim().toLowerCase() : '';
    const decision: ParticipationDecision =
      decisionValue === 'reply' || decisionValue === 'ignore' || decisionValue === 'ambiguous'
        ? decisionValue
        : 'ambiguous';

    return {
      decision,
      confidence: normalizeConfidence(parsed.confidence),
      reason: typeof parsed.reason === 'string' ? truncateText(parsed.reason, 24) : undefined,
      modelName: result.modelName
    };
  }

  private computeAddressedness(inboundContext: FinalizedInboundContext) {
    let score = 0;
    const text = `${inboundContext.RawBody}\n${inboundContext.BodyForAgent}`.toLowerCase();
    if (this.botNameCues.some((cue) => cue && text.includes(cue.toLowerCase()))) {
      score += 0.55;
    }
    if (inboundContext.ReplyToSenderId === inboundContext.AccountId) {
      score += 0.45;
    }
    if (inboundContext.WasMentioned === true) {
      score = 1;
    }
    return clamp01(score);
  }

  private computeSocialPosition(inboundContext: FinalizedInboundContext, recentMessages: RecentInboundMessage[]) {
    if (recentMessages.length === 0) {
      return 0.2;
    }

    const sameSenderCount = recentMessages.filter((message) => message.senderId === inboundContext.SenderId).length;
    const botRelevantCount = recentMessages.filter((message) => message.wasMentioned || (message.replyToSender || '').includes(inboundContext.AccountId || '')).length;
    return clamp01(0.2 + sameSenderCount * 0.18 + botRelevantCount * 0.12);
  }

  private computeInterest(
    inboundContext: FinalizedInboundContext,
    recentMessages: RecentInboundMessage[],
    continuityScore: number,
    embeddingInterestScore: number
  ) {
    const text = inboundContext.BodyForAgent;
    const questionSignals = countMatches(text, [/[\?？]/, /\b(吗|呢|咋|怎么|为什么|要不要|是不是)\b/u]);
    const opinionSignals = countMatches(text, [/\b(觉得|感觉|你说|怎么看)\b/u, /(推荐|建议|帮我|给我)/u]);
    const recencyBoost = recentMessages.length > 0 ? 0.15 : 0;
    return clamp01(
      Math.min(0.55, questionSignals * 0.2 + opinionSignals * 0.22)
      + continuityScore * 0.2
      + embeddingInterestScore * 0.35
      + recencyBoost
    );
  }

  private computeTimingScore(state: { cooldownRemainingMs: number; recentReplyCount: number }) {
    if (state.cooldownRemainingMs > 0) {
      return 0;
    }
    if (state.recentReplyCount === 0) {
      return 1;
    }
    if (state.recentReplyCount === 1) {
      return 0.6;
    }
    return 0.2;
  }

  private computeValueAdd(inboundContext: FinalizedInboundContext, recentMessages: RecentInboundMessage[]) {
    const text = inboundContext.BodyForAgent.trim();
    if (!text) {
      return 0;
    }
    if (text.length >= 18) {
      return 0.7;
    }
    if (recentMessages.some((message) => message.bodyForAgent.trim() === text)) {
      return 0.15;
    }
    return /[？?]/.test(text) ? 0.8 : 0.45;
  }

  private getRecentReplyState(sessionKey: string, now: number) {
    const timestamps = (this.recentReplyTimestamps.get(sessionKey) || []).filter((value) => now - value <= this.replyWindowMs);
    this.recentReplyTimestamps.set(sessionKey, timestamps);

    const lastReplyAt = timestamps.length > 0 ? timestamps[timestamps.length - 1] : null;
    const cooldownRemainingMs = lastReplyAt === null ? 0 : Math.max(0, this.cooldownMs - (now - lastReplyAt));
    return {
      recentReplyCount: timestamps.length,
      cooldownRemainingMs,
      withinCooldown: cooldownRemainingMs > 0
    };
  }

  private pruneRecentReplies(now: number) {
    for (const [sessionKey, timestamps] of this.recentReplyTimestamps.entries()) {
      const active = timestamps.filter((value) => now - value <= this.replyWindowMs);
      if (active.length === 0) {
        this.recentReplyTimestamps.delete(sessionKey);
        continue;
      }
      this.recentReplyTimestamps.set(sessionKey, active);
    }
  }

  private async getRecentMessages(params: { sessionKey: string; currentMessageSid?: string }) {
    if (this.recentMessageProvider) {
      return this.recentMessageProvider(params);
    }

    const rows = await this.prisma.agentInboundMessage.findMany({
      where: {
        session_key: params.sessionKey,
        ...(params.currentMessageSid ? { NOT: { message_sid: params.currentMessageSid } } : {})
      },
      orderBy: [
        { received_at: 'desc' },
        { id: 'desc' }
      ],
      take: this.recentInboundLimit,
      select: {
        message_sid: true,
        sender_id: true,
        body_for_agent: true,
        was_mentioned: true,
        reply_to_sender: true,
        reply_to_body: true,
        received_at: true
      }
    });

    return rows.map((row) => ({
      messageSid: row.message_sid,
      senderId: row.sender_id,
      bodyForAgent: row.body_for_agent,
      wasMentioned: Boolean(row.was_mentioned),
      replyToSender: row.reply_to_sender,
      replyToBody: row.reply_to_body,
      receivedAtMs: row.received_at.getTime()
    }));
  }

  private async computeEmbeddingSignals(inboundContext: FinalizedInboundContext, recentMessages: RecentInboundMessage[]) {
    const textCandidates = [
      inboundContext.ReplyToBody,
      ...recentMessages.map((message) => message.bodyForAgent).filter(Boolean)
    ]
      .map((value) => (value || '').trim())
      .filter((value, index, array) => value.length >= 2 && array.indexOf(value) === index)
      .slice(0, 4);
    const interestCandidates = this.interestPrototypeTexts.slice(0, 3);

    if (!this.embeddingService?.isEnabled()) {
      return {
        continuityScore: inboundContext.ReplyToBody ? 0.45 : 0,
        interestScore: 0,
        usedEmbeddings: false,
        embeddingError: false,
        topSimilarity: null as number | null,
        interestSimilarity: null as number | null
      };
    }

    try {
      const response = await this.embeddingService.createEmbeddings({
        input: [inboundContext.BodyForAgent, ...textCandidates, ...interestCandidates],
        model: aiConfig.embedding_model_id
      });
      const allVectors = response.data.map((item) => item.embedding);
      const [current, ...others] = allVectors;
      const continuityVectors = others.slice(0, textCandidates.length);
      const interestVectors = others.slice(textCandidates.length);
      let topSimilarity = 0;
      for (const vector of continuityVectors) {
        topSimilarity = Math.max(topSimilarity, cosineSimilarity(current, vector));
      }
      let interestSimilarity = 0;
      for (const vector of interestVectors) {
        interestSimilarity = Math.max(interestSimilarity, cosineSimilarity(current, vector));
      }

      return {
        continuityScore: textCandidates.length > 0 ? normalizeSimilarityToScore(topSimilarity) : 0,
        interestScore: normalizeSimilarityToScore(interestSimilarity),
        usedEmbeddings: true,
        embeddingError: false,
        topSimilarity,
        interestSimilarity
      };
    } catch (error) {
      this.moduleLogger.warn('Embedding participation scoring failed', {
        error: error instanceof Error ? error.message : String(error),
        sessionKey: inboundContext.SessionKey
      });
      return {
        continuityScore: inboundContext.ReplyToBody ? 0.35 : 0,
        interestScore: 0,
        usedEmbeddings: false,
        embeddingError: true,
        topSimilarity: null as number | null,
        interestSimilarity: null as number | null
      };
    }
  }
}

export type {
  GroupParticipationDecisionResult,
  ParticipationDecision,
  ParticipationReason,
  RecentInboundMessage
};

export default GroupParticipationService;

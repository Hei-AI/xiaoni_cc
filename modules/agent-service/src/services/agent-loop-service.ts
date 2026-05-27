import { v4 as uuidv4 } from 'uuid';
import { agentConfig } from '../config';
import { logger } from '../utils/logger';
import type { UnreadMeaningSocialActType } from '../types/social-act-type';
import {
  AgentToolCall,
  ConversationTranscriptItem,
  ConversationTranscriptPhase,
  ConversationTurn,
  QueueMessageRecord
} from '../types';
import {
  AgentPromptResolver,
  AgentPromptService,
  MissingAgentPromptBindingError,
  ResolvedAgentRuntimePrompt,
  applyPromptTemplate
} from './agent-prompt-service';
import {
  formatIdentity,
  normalizeTranscriptMessageText,
  renderRuntimeBatchInput
} from './runtime-input-renderer';
import {
  RuntimeStore,
  type RuntimeAcceptedIdentityFact,
  type RuntimePresenceContext,
  type SessionReadCutoffState
} from './runtime-store';
import { resolveModelContextPolicy } from './model-context-policy';
import { estimateTextTokens } from './token-estimator';

type OpenResponseInputItem =
  | {
      type: 'message';
      role: 'system' | 'user' | 'assistant' | 'developer';
      content: string | OpenResponseInputContentPart[];
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

type OpenResponseInputContentPart =
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

type OpenResponseToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      additionalProperties: false;
    };
  };
} | {
  type: 'web_search';
  search_context_size?: 'low' | 'medium' | 'high';
  external_web_access?: boolean;
};

type OpenResponseToolChoice =
  | 'required'
  | {
      type: 'allowed_tools';
      mode: 'required';
      tools: Array<
        | {
            type: 'function';
            name: string;
          }
        | {
            type: 'web_search';
          }
      >;
    };

type FeedbackWriterToolChoice = OpenResponseToolChoice | undefined;

type ToolContinuationAction = {
  inputItems: OpenResponseInputItem[];
  finishResult: Record<string, unknown> | null;
  forcedVisibleReply: {
    toolName: string;
    args: Record<string, unknown>;
  } | null;
};

type ToolContinuationContext = {
  loopInput: OpenResponseInputItem[];
  speakingToolName: string;
  hasVisibleReply: boolean;
};

type DeliveredAssistantMessage = {
  content: string;
  deliveryMessageId: number | null;
};

type OutboundDeliveryFingerprint = {
  messageType: 'private' | 'group';
  messages: string[];
  mentionUserIds: number[];
};

type CanonicalAgentTurnRequest = {
  model: string;
  input: OpenResponseInputItem[];
  instructions?: string;
  metadata?: Record<string, string>;
  tools?: OpenResponseToolDefinition[];
  tool_choice?: OpenResponseToolChoice;
  parallel_tool_calls: false;
  prompt_cache_key?: string;
  prompt_cache_retention?: string;
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
  };
  canonical_request?: Record<string, unknown>;
  wire_request?: Record<string, unknown>;
  wire_response?: Record<string, unknown>;
  raw_response?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  usage_details?: Record<string, unknown>;
  performance?: {
    processing_time_ms?: number;
  };
  error?: string;
};

type ContextBudgetTurnRecord = {
  turn: number;
  estimatedInputTokens: number;
  actualInputTokens: number | null;
  actualOutputTokens: number | null;
  actualTotalTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  processingTimeMs: number | null;
  readHistoryCount: number;
  readCutoffAfterConversationId: number | null;
  contextWindowTokens: number | null;
  targetBudgetTokens: number | null;
  hardBudgetTokens: number | null;
  tokenizerEncoding: string | null;
  tokenizerSource: 'tiktoken' | 'heuristic' | null;
  cutoffRecomputed: boolean;
};

type ContextBudgetPlan = {
  requestInput: OpenResponseInputItem[];
  retainedHistory: ConversationTurn[];
  runtimeIdentityFacts: RuntimeIdentityFactProjection[];
  readCutoffAfterConversationId: number | null;
  previousReadCutoffAfterConversationId: number | null;
  estimatedInputTokens: number;
  contextWindowTokens: number | null;
  targetBudgetTokens: number | null;
  hardBudgetTokens: number | null;
  tokenizerEncoding: string | null;
  tokenizerSource: 'tiktoken' | 'heuristic' | null;
  cutoffRecomputed: boolean;
  contextSummary: string | null;
  pendingProactiveShare: string | null;
  pendingProactiveShareAge: number;
};


type UnreadMeaningTopicContext = {
  hasTopic: boolean;
  topicSummary: string | null;
  addressedToMe: boolean;
};

type UnreadMeaning = {
  latestUnreadFocus: string;
  messageAct: 'statement' | 'question' | 'joke' | 'tease' | 'feedback' | 'reaction' | 'request' | 'unclear';
  socialTarget: 'me' | 'someone_else' | 'group' | 'unclear';
  addressedToMe: boolean;
  hasRealNovelty: boolean;
  confidence: 'low' | 'medium' | 'high';
  reason: string;
  socialActType: UnreadMeaningSocialActType | null;
  topicContext: UnreadMeaningTopicContext | null;
};

type InnerReaction = {
  interestLevel: 'none' | 'low' | 'medium' | 'high';
  wantsToKnowMore: boolean;
  reactionAuthenticity: 'none' | 'weak_but_real' | 'formed' | 'empty_but_convenient';
  shouldSearch: boolean;
  preferredAction: 'speak' | 'silent' | 'search' | 'image_task' | 'proactive';
  reason: string;
};

type LongTermLearningRecall = {
  reason: string;
  topicHint: string;
  includeCurrentSender: boolean;
  desiredRecallCount: number;
  socialActTypeHint: UnreadMeaningSocialActType | null;
};

type FeedbackReflectionCandidate = {
  shouldPersist: boolean;
  feedbackKind: 'positive' | 'negative' | 'mixed';
  confidence: 'low' | 'medium' | 'high';
  sourceUserScope: 'current_sender' | 'other' | 'group' | 'unknown';
  summaryText: string;
  retrievalText: string;
  reason: string;
};

type FeedbackReflectionSynthesis = {
  learningKey: string;
  learningScope: string;
  reflectionType: 'semantic_lesson' | 'social_lesson' | 'self_model_update';
  feedbackKind: 'positive' | 'negative' | 'mixed';
  confidence: 'low' | 'medium' | 'high';
  importanceScore: number;
  evidenceWeight: number;
  stabilityScore: number;
  summaryText: string;
  retrievalText: string;
  embeddingText: string;
  supersedeLatest: boolean;
  conflictGroupKey: string | null;
  reason: string;
};

type FeedbackLearningStateCandidate = {
  stateType: 'reinforced' | 'tentative' | 'conflicted' | 'revised';
  activationWeight: number;
  recencyWeight: number;
  importanceWeight: number;
  sourceWeight: number;
  conflictPenalty: number;
  activateNewReflection: boolean;
  reason: string;
};

type FeedbackWriterMode = 'episode_only' | 'durable_lessons';

type FeedbackWriterEvidence = {
  sourceMessageIds: number[];
  sourceConversationId: number | null;
  sourceUserId: number | null;
  sourceUserName: string | null;
  metadata: Record<string, unknown>;
  writerSource: typeof FEEDBACK_MEMORY_SUBAGENT_TYPE | typeof CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE;
};

type FeedbackMemorySubagentParams = {
  queueMessage: QueueMessageRecord['payload'];
  conversationId: number;
  history: ConversationTurn[];
  runtimePrompt: ResolvedAgentRuntimePrompt;
  xiaoniOs: string | null;
  deliveredMessages: string[];
  unreadMeaningArtifact: Record<string, unknown> | null;
  innerReactionArtifact: Record<string, unknown> | null;
};

type ContextCompressionMemoryParams = {
  queueMessage: QueueMessageRecord['payload'];
  conversationId: number;
  evictedTurns: ConversationTurn[];
  runtimePrompt: ResolvedAgentRuntimePrompt;
};

type RuntimeIdentityFactProjection = {
  id: number;
  factKey: string;
  factText: string;
  factType: string;
  confidence: string;
  activationTags: string[];
};

const moduleLogger = logger.createModuleLogger('agent-loop-service');
const READ_HISTORY_TARGET_RATIO = 0.7;
const READ_HISTORY_HARD_RATIO = 0.95;
const HISTORY_COMPACT_AT = 200;
const HISTORY_COMPACT_KEEP = 80;
const FEEDBACK_MEMORY_SUBAGENT_TYPE = 'feedback_memory_writer';
const CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE = 'context_compression_memory_writer';
const CONTEXT_SUMMARY_SUBAGENT_TYPE = 'context_summary_writer';
export const XIAONI_IDENTITY_KEY = 'xiaoni';
const RUNTIME_IDENTITY_FACT_LIMIT = 4;

const TOOL_NAMES = {
  unreadMeaning: 'emit_unread_meaning',
  innerReaction: 'emit_inner_reaction',
  longTermRecall: 'recall_long_term_learning',
  inspectImage: 'inspect_image_placeholder',
  imageTask: 'request_image_task',
  feedbackReflection: 'synthesize_feedback_reflection',
  feedbackLearningState: 'update_learning_state',
  privateReply: 'reply_in_private',
  groupReply: 'speak_in_group',
  silentFinish: 'stay_silent'
} as const;

const WEB_SEARCH_TOOL: OpenResponseToolDefinition = {
  type: 'web_search',
  search_context_size: agentConfig.webSearchContextSize,
  external_web_access: agentConfig.webSearchExternalAccess
};

const LEGACY_TOOL_ALIASES = {
  privateReply: ['send_private_message'],
  groupReply: ['send_group_message'],
  silentFinish: ['finish']
} as const;

const HUMAN_REPLY_RULES = [
  '保持自然人话，贴近眼前场域。',
  '让这句话在现场里真正新增一点东西，可以是确认、回应或判断。',
  '一句已经成立就自然收住，把节奏留在现场里。'
] as const;

const GROUP_MENTION_RULES = [
  'mention_user_ids 只在你确实是在自然点名某个人、回应某个人、或者要把某个人拉进当前话题时使用。',
  '让每个 @ 都对应真实的指向，比如点名回应、转向某个人，或把某个人带进当前话题。',
  '如果一句话自然落地时已经有清楚的指向，就让句子自己成立。'
] as const;

const PRIVATE_MESSAGE_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.privateReply,
    description: '向当前私聊对象发送一条或多条 QQ 消息。',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        messages: {
          type: 'array',
          items: { type: 'string' }
        },
        xiaoni_os: {
          type: 'string',
          description: '给下一轮自己留的内心独白——这轮之后留在你这里的东西：看见了什么、感觉到了什么、什么还没过去。不发给对方。'
        },
        pending_share: {
          type: 'string',
          description: '如果你有个想法或发现想找机会主动说出来，写在这里带到下一轮。下一轮会在未读消息前看到它，让你有机会主动开口。可选，不用硬填。'
        }
      },
      required: ['xiaoni_os'],
      additionalProperties: false
    }
  }
} as const;

const GROUP_MESSAGE_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.groupReply,
    description: '向当前 QQ 群发送一条或多条消息，可选指定需要 @ 的成员。',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        messages: {
          type: 'array',
          items: { type: 'string' }
        },
        mention_user_ids: {
          type: 'array',
          items: { type: 'integer' }
        },
        xiaoni_os: {
          type: 'string',
          description: '给下一轮自己留的内心独白——这轮之后留在你这里的东西：看见了什么、感觉到了什么、什么还没过去。不发给任何人。'
        },
        pending_share: {
          type: 'string',
          description: '如果你有个想法或发现想找机会主动说出来，写在这里带到下一轮。下一轮会在未读消息前看到它，让你有机会主动开口。可选，不用硬填。'
        }
      },
      required: ['xiaoni_os'],
      additionalProperties: false
    }
  }
} as const;

const INSPECT_IMAGE_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.inspectImage,
    description: '读取当前上下文中图片占位符对应的图片观察结果。',
    parameters: {
      type: 'object',
      properties: {
        media_tag: { type: 'string' },
        reason: { type: 'string' }
      },
      required: ['media_tag', 'reason'],
      additionalProperties: false
    }
  }
} as const;

const IMAGE_TASK_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.imageTask,
    description: '登记一个图片生成或编辑后台任务；不等待任务完成。',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['generate', 'edit']
        },
        prompt: { type: 'string' },
        target_description: { type: 'string' },
        source_media_tags: {
          type: 'array',
          items: { type: 'string' }
        },
        xiaoni_os: {
          type: 'string',
          description: '给下一轮自己留的内心独白——这个后台任务在你这里留下的延续。不发给任何人。'
        }
      },
      required: ['operation', 'prompt', 'target_description', 'xiaoni_os'],
      additionalProperties: false
    }
  }
} as const;

const FINISH_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.silentFinish,
    description: '结束本轮且不发送 QQ 可见消息。',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
        outcome: { type: 'string' },
        xiaoni_os: {
          type: 'string',
          description: '给下一轮自己留的内心独白——这轮之后留在你这里的东西：察觉到了什么、什么还没过去、什么还在继续。不发给任何人。'
        },
        pending_share: {
          type: 'string',
          description: '如果你有个想法或发现想找机会主动说出来，写在这里带到下一轮。下一轮会在未读消息前看到它，让你有机会主动开口。可选，不用硬填。'
        }
      },
      required: ['reason', 'outcome', 'xiaoni_os'],
      additionalProperties: false
    }
  }
} as const;

const UNREAD_MEANING_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.unreadMeaning,
    description: '提取当前新入站消息的语义重点、社交目标和消息动作。',
    parameters: {
      type: 'object',
      properties: {
        latest_unread_focus: {
          type: 'string'
        },
        message_act: {
          type: 'string',
          enum: ['statement', 'question', 'joke', 'tease', 'feedback', 'reaction', 'request', 'unclear']
        },
        social_target: {
          type: 'string',
          enum: ['me', 'someone_else', 'group', 'unclear']
        },
        addressed_to_me: {
          type: 'boolean'
        },
        has_real_novelty: {
          type: 'boolean'
        },
        confidence: {
          type: 'string',
          enum: ['low', 'medium', 'high']
        },
        reason: {
          type: 'string'
        },
        social_act_type: {
          type: 'string',
          enum: ['invitation_curiosity', 'emotional_release', 'relationship_probe', 'concrete_request', 'yes_no_reaction', 'casual_remark'],
          description: '消息对应的社交动作类型。仅当 addressed_to_me=true 时填写；说给别人的消息不填。invitation_curiosity=邀请好奇，emotional_release=释放情绪，relationship_probe=试探关系，concrete_request=具体请求，yes_no_reaction=问是否，casual_remark=随口一提'
        },
        topic_context: {
          type: 'object',
          properties: {
            has_topic: {
              type: 'boolean',
              description: '当前消息是否在讨论某个具体话题'
            },
            topic_summary: {
              type: 'string',
              description: '话题的一句话概括，用于判断是否感兴趣或需要先搜索。has_topic=false 时可省略'
            },
            addressed_to_me: {
              type: 'boolean',
              description: '话题是否明确说给小腻的'
            }
          },
          required: ['has_topic', 'addressed_to_me'],
          additionalProperties: false
        }
      },
      required: ['latest_unread_focus', 'message_act', 'social_target', 'addressed_to_me', 'has_real_novelty', 'confidence', 'reason', 'topic_context'],
      additionalProperties: false
    }
  }
} as const;

const INNER_REACTION_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.innerReaction,
    description: '根据已理解的新消息输出小腻的反应强度、真实性和下一步偏好。',
    parameters: {
      type: 'object',
      properties: {
        interest_level: {
          type: 'string',
          enum: ['none', 'low', 'medium', 'high']
        },
        wants_to_know_more: {
          type: 'boolean'
        },
        reaction_authenticity: {
          type: 'string',
          enum: ['none', 'weak_but_real', 'formed', 'empty_but_convenient']
        },
        should_search: {
          type: 'boolean'
        },
        preferred_action: {
          type: 'string',
          enum: ['speak', 'silent', 'search', 'image_task', 'proactive']
        },
        reason: {
          type: 'string'
        }
      },
      required: ['interest_level', 'wants_to_know_more', 'reaction_authenticity', 'should_search', 'preferred_action', 'reason'],
      additionalProperties: false
    }
  }
} as const;

const LONG_TERM_RECALL_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.longTermRecall,
    description: '按当前主题和社交语境取回少量长期学习结果。',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string'
        },
        topic_hint: {
          type: 'string'
        },
        include_current_sender: {
          type: 'boolean'
        },
        desired_recall_count: {
          type: 'integer',
          minimum: 1,
          maximum: 3
        },
        social_act_type_hint: {
          type: 'string',
          enum: ['invitation_curiosity', 'emotional_release', 'relationship_probe', 'concrete_request', 'yes_no_reaction', 'casual_remark']
        }
      },
      required: ['reason', 'topic_hint', 'include_current_sender', 'desired_recall_count'],
      additionalProperties: false
    }
  }
} as const;

const FEEDBACK_REFLECTION_SYNTHESIS_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.feedbackReflection,
    description: [
      '在上下文压缩时，把这批即将移出上下文的对话里真正值得长期保留的内容提炼成一条 append-only reflection。',
      '默认是叠加，不是覆盖；只有明确是同题新结论时，才表明 supersede 或 conflict。'
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        learning_key: {
          type: 'string'
        },
        learning_scope: {
          type: 'string'
        },
        reflection_type: {
          type: 'string',
          enum: ['semantic_lesson', 'social_lesson', 'self_model_update']
        },
        feedback_kind: {
          type: 'string',
          enum: ['positive', 'negative', 'mixed']
        },
        confidence: {
          type: 'string',
          enum: ['low', 'medium', 'high']
        },
        importance_score: {
          type: 'number'
        },
        evidence_weight: {
          type: 'number'
        },
        stability_score: {
          type: 'number'
        },
        summary_text: {
          type: 'string'
        },
        retrieval_text: {
          type: 'string'
        },
        embedding_text: {
          type: 'string'
        },
        supersede_latest: {
          type: 'boolean'
        },
        conflict_group_key: {
          type: ['string', 'null']
        },
        reason: {
          type: 'string'
        }
      },
      required: ['learning_key', 'learning_scope', 'reflection_type', 'feedback_kind', 'confidence', 'importance_score', 'evidence_weight', 'stability_score', 'summary_text', 'retrieval_text', 'embedding_text', 'supersede_latest', 'conflict_group_key', 'reason'],
      additionalProperties: false
    }
  }
} as const;

const FEEDBACK_LEARNING_STATE_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.feedbackLearningState,
    description: [
      '根据新 reflection 和同题当前状态，更新 learning_state。',
      '默认叠加；只有同题新结论才 revised 或 conflicted。'
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        state_type: {
          type: 'string',
          enum: ['reinforced', 'tentative', 'conflicted', 'revised']
        },
        activation_weight: {
          type: 'number'
        },
        recency_weight: {
          type: 'number'
        },
        importance_weight: {
          type: 'number'
        },
        source_weight: {
          type: 'number'
        },
        conflict_penalty: {
          type: 'number'
        },
        activate_new_reflection: {
          type: 'boolean'
        },
        reason: {
          type: 'string'
        }
      },
      required: ['state_type', 'activation_weight', 'recency_weight', 'importance_weight', 'source_weight', 'conflict_penalty', 'activate_new_reflection', 'reason'],
      additionalProperties: false
    }
  }
} as const;

const RUNTIME_INPUT_READING_CONTRACT = [
  '你看到的是真实的 QQ 现场，不是说明文。每段带标签的内容都代表一个明确来源。',
  '',
  '`<INPUT_MESSAGE>` 是真实入站 QQ 消息。里面的 sender、message_id、message_sid、timestamp 都是现场事实。',
  '`<OUTPUT_MESSAGE>` 是你过去已经发出去的 QQ 消息。它是你的历史输出，不是别人说的话。',
  '`<ACTION>` 是你自己的动作或状态事件，比如打开群、潜水、找话题、看图、等待。',
  '`<小腻的OS>` 是你留给后续自己的内部连续性，不是 QQ 消息。',
  '`<图片内容>` 是你已经检查过图片后留下的观察；没有这个标签时，不要猜图里有什么。',
  '`<system_reminder>` 是工程控制逻辑给你的本轮边界提醒，不是群友说的话。',
  '`<对话历史摘要>` 是更早上下文的压缩摘要。',
  '',
  '这一轮只处理 `<system_reminder>` 指出的新消息范围。历史消息是背景，不要重复回应已经处理过的旧话。',
  '',
  '消息里的”回复某人””@某人””引用”是说话的社交方向，影响谁在和谁说话，记得一起理解进去。',
  '',
  '这一轮顺序：',
  '先搞清楚最新未读在说什么，用 emit_unread_meaning。',
  '再感觉一下这些消息在你这里有没有真实反应，用 emit_inner_reaction。',
  '如果感觉和以前的经历有关，才用 recall_long_term_learning 查一下。',
  '最后通过工具完成这一轮——说话、沉默、查资料还是做图。',
  '',
  '工具阶段：',
  'commentary 工具只整理现场或补充上下文：emit_unread_meaning、emit_inner_reaction、recall_long_term_learning、inspect_image_placeholder、web_search。',
  'final_answer 工具会结束本轮或产生外部动作：speak_in_group、reply_in_private、stay_silent、request_image_task。',
  '',
  'preferred_action 的含义：',
  'speak = 对这条消息有真实反应，要接话。',
  'silent = 没什么想说的。',
  'search = 想查清楚再说。',
  'image_task = 要帮人做图。',
  'proactive = 我自己有个事想说，借这个时机开口；不是在接这条消息，要确实有东西，不是因为有空档就开口。',
  '',
  '普通聊天、轻吐槽、短反应都是正常参与，有真实的感觉才开口。',
  '真的没什么想说的就不说，不用硬凑一句。',
  '主动说个自己的事（proactive）是借这个时机开口，不是在接这条消息。',
  '',
  'web_search 是求知，不是默认步骤，也不是表演认真。',
  '只有真的需要新鲜公开信息时才查，查到够用就停，查完还是你自己决定说不说。'
].join('\n');

function isPrivateReplyToolName(name: string) {
  return name === TOOL_NAMES.privateReply || LEGACY_TOOL_ALIASES.privateReply.includes(name as typeof LEGACY_TOOL_ALIASES.privateReply[number]);
}

function isGroupReplyToolName(name: string) {
  return name === TOOL_NAMES.groupReply || LEGACY_TOOL_ALIASES.groupReply.includes(name as typeof LEGACY_TOOL_ALIASES.groupReply[number]);
}

function isSilentFinishToolName(name: string) {
  return name === TOOL_NAMES.silentFinish || LEGACY_TOOL_ALIASES.silentFinish.includes(name as typeof LEGACY_TOOL_ALIASES.silentFinish[number]);
}

function isSpeakingToolName(name: string) {
  return isPrivateReplyToolName(name) || isGroupReplyToolName(name);
}

function hasUnreadMeaningReplay(loopInput: OpenResponseInputItem[]) {
  return hasToolReplay(loopInput, TOOL_NAMES.unreadMeaning);
}

function hasInnerReactionReplay(loopInput: OpenResponseInputItem[]) {
  return hasToolReplay(loopInput, TOOL_NAMES.innerReaction);
}

function hasToolReplay(loopInput: OpenResponseInputItem[], toolName: string) {
  return loopInput.some((item) => item.type === 'function_call' && item.name === toolName);
}

function parseReplayJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function extractLatestInnerReaction(loopInput: OpenResponseInputItem[]): InnerReaction | null {
  const innerReactionCallIds = new Set<string>();
  for (const item of loopInput) {
    if (item.type === 'function_call' && item.name === TOOL_NAMES.innerReaction) {
      innerReactionCallIds.add(item.call_id);
    }
  }

  for (let index = loopInput.length - 1; index >= 0; index -= 1) {
    const item = loopInput[index];
    if (item.type === 'function_call_output' && innerReactionCallIds.has(item.call_id)) {
      const parsed = parseReplayJsonObject(item.output);
      const reaction = parseInnerReaction(parsed);
      if (reaction) {
        return reaction;
      }
    }
    if (item.type === 'function_call' && item.name === TOOL_NAMES.innerReaction) {
      const parsed = parseReplayJsonObject(item.arguments);
      const reaction = parseInnerReaction(parsed);
      if (reaction) {
        return reaction;
      }
    }
  }

  return null;
}

function extractLatestUnreadMeaning(loopInput: OpenResponseInputItem[]): UnreadMeaning | null {
  const unreadMeaningCallIds = new Set<string>();
  for (const item of loopInput) {
    if (item.type === 'function_call' && item.name === TOOL_NAMES.unreadMeaning) {
      unreadMeaningCallIds.add(item.call_id);
    }
  }

  for (let index = loopInput.length - 1; index >= 0; index -= 1) {
    const item = loopInput[index];
    if (item.type === 'function_call_output' && unreadMeaningCallIds.has(item.call_id)) {
      const parsed = parseReplayJsonObject(item.output);
      const meaning = parseUnreadMeaning(parsed);
      if (meaning) {
        return meaning;
      }
    }
    if (item.type === 'function_call' && item.name === TOOL_NAMES.unreadMeaning) {
      const parsed = parseReplayJsonObject(item.arguments);
      const meaning = parseUnreadMeaning(parsed);
      if (meaning) {
        return meaning;
      }
    }
  }

  return null;
}

function hasLongTermRecallReplay(loopInput: OpenResponseInputItem[]) {
  return hasToolReplay(loopInput, TOOL_NAMES.longTermRecall);
}

function hasDirectNewCue(meaning: UnreadMeaning | null) {
  if (!meaning?.addressedToMe && meaning?.socialTarget !== 'me') {
    return false;
  }
  if (meaning.hasRealNovelty) {
    return true;
  }
  return meaning.messageAct === 'question' || meaning.messageAct === 'request' || meaning.messageAct === 'feedback';
}

function shouldDowngradeWeakSpeakToSilence(reaction: InnerReaction | null, meaning: UnreadMeaning | null) {
  if (reaction?.preferredAction !== 'speak') {
    return false;
  }
  // Model explicitly flagged the reaction as empty — always silence
  if (reaction.reactionAuthenticity === 'empty_but_convenient') {
    return true;
  }
  // Safety catch: model chose speak despite no interest at all
  if (reaction.interestLevel === 'none') {
    return true;
  }
  if (reaction.interestLevel === 'low' && !hasDirectNewCue(meaning)) {
    // Original: weak reaction with no direct cue
    if (reaction.reactionAuthenticity === 'weak_but_real') {
      return true;
    }
    // Extended: even a formed reaction isn't enough when interest is low and nobody's addressing us
    if (reaction.reactionAuthenticity === 'formed') {
      return true;
    }
  }
  return false;
}

function buildAllowedToolsToolChoice(tools: Array<{ type: 'function'; name: string } | { type: 'web_search' }>): OpenResponseToolChoice {
  return {
    type: 'allowed_tools',
    mode: 'required',
    tools
  };
}

function selectActorToolDefinitions(chatType: 'group' | 'direct', modelName: string): OpenResponseToolDefinition[] {
  void modelName;
  const tools: OpenResponseToolDefinition[] = agentConfig.webSearchEnabled ? [WEB_SEARCH_TOOL] : [];

  if (chatType === 'group') {
    return [...tools, GROUP_MESSAGE_TOOL, INSPECT_IMAGE_TOOL, IMAGE_TASK_TOOL, FINISH_TOOL];
  }
  return [...tools, PRIVATE_MESSAGE_TOOL, FINISH_TOOL];
}

function selectGroupLoopToolDefinitions(modelName: string) {
  return [
    UNREAD_MEANING_TOOL,
    INNER_REACTION_TOOL,
    LONG_TERM_RECALL_TOOL,
    ...selectActorToolDefinitions('group', modelName)
  ] satisfies OpenResponseToolDefinition[];
}

function resolveGroupLoopToolChoice(loopInput: OpenResponseInputItem[]): OpenResponseToolChoice {
  if (!hasUnreadMeaningReplay(loopInput)) {
    return buildAllowedToolsToolChoice([
      { type: 'function', name: TOOL_NAMES.unreadMeaning }
    ]);
  }

  if (!hasInnerReactionReplay(loopInput)) {
    return buildAllowedToolsToolChoice([
      { type: 'function', name: TOOL_NAMES.innerReaction }
    ]);
  }

  const latestInnerReaction = extractLatestInnerReaction(loopInput);
  const latestUnreadMeaning = extractLatestUnreadMeaning(loopInput);
  if (latestInnerReaction?.preferredAction === 'silent') {
    return buildAllowedToolsToolChoice([
      { type: 'function', name: TOOL_NAMES.silentFinish }
    ]);
  }

  if (shouldDowngradeWeakSpeakToSilence(latestInnerReaction, latestUnreadMeaning)) {
    return buildAllowedToolsToolChoice([
      { type: 'function', name: TOOL_NAMES.silentFinish }
    ]);
  }

  if ((latestInnerReaction?.preferredAction === 'search' || latestInnerReaction?.preferredAction === 'image_task') && !hasLongTermRecallReplay(loopInput)) {
    return buildAllowedToolsToolChoice([
      { type: 'function', name: TOOL_NAMES.longTermRecall }
    ]);
  }

  if (latestInnerReaction?.preferredAction === 'image_task') {
    return buildAllowedToolsToolChoice([
      { type: 'function', name: TOOL_NAMES.inspectImage },
      { type: 'function', name: TOOL_NAMES.imageTask },
      { type: 'function', name: TOOL_NAMES.silentFinish }
    ]);
  }

  if (latestInnerReaction?.preferredAction === 'search') {
    const tools: Array<{ type: 'function'; name: string } | { type: 'web_search' }> = [
      { type: 'function', name: TOOL_NAMES.silentFinish }
    ];
    if (agentConfig.webSearchEnabled) {
      tools.unshift({ type: 'web_search' });
    }
    return buildAllowedToolsToolChoice(tools);
  }

  // Proactive: Xiaoni wants to share something she finds interesting, not reacting to this message.
  // Offer speak + silent (she can still decide nothing worth sharing after all).
  if (latestInnerReaction?.preferredAction === 'proactive') {
    return buildAllowedToolsToolChoice([
      { type: 'function', name: TOOL_NAMES.groupReply },
      { type: 'function', name: TOOL_NAMES.silentFinish }
    ]);
  }

  const tools: Array<{ type: 'function'; name: string } | { type: 'web_search' }> = [
    { type: 'function', name: TOOL_NAMES.groupReply },
    { type: 'function', name: TOOL_NAMES.inspectImage },
    { type: 'function', name: TOOL_NAMES.imageTask }
  ];
  if (agentConfig.webSearchEnabled) {
    tools.unshift({ type: 'web_search' });
  }
  return buildAllowedToolsToolChoice(tools);
}

function selectFeedbackWriterToolDefinitions(mode: FeedbackWriterMode) {
  if (mode === 'episode_only') {
    return [] satisfies OpenResponseToolDefinition[];
  }

  return [
    FEEDBACK_REFLECTION_SYNTHESIS_TOOL,
    FEEDBACK_LEARNING_STATE_TOOL
  ] satisfies OpenResponseToolDefinition[];
}

function resolveFeedbackWriterToolChoice(loopInput: OpenResponseInputItem[], mode: FeedbackWriterMode): FeedbackWriterToolChoice {
  if (mode === 'episode_only') {
    return undefined;
  }

  if (!hasToolReplay(loopInput, TOOL_NAMES.feedbackReflection)) {
    return undefined;
  }

  return buildAllowedToolsToolChoice([
    { type: 'function', name: TOOL_NAMES.feedbackLearningState }
  ]);
}

export function buildCanonicalAgentTurnRequest(
  modelName: string,
  loopInput: OpenResponseInputItem[],
  chatType: 'group' | 'direct'
): CanonicalAgentTurnRequest {
  const [firstItem, ...remainingItems] = loopInput;
  const baseInstructions = firstItem?.type === 'message'
    && firstItem.role === 'system'
    && typeof firstItem.content === 'string'
    ? firstItem.content
    : undefined;
  const instructions = baseInstructions;
  const tools = chatType === 'group'
    ? selectGroupLoopToolDefinitions(modelName)
    : selectActorToolDefinitions(chatType, modelName);
  const toolChoice = chatType === 'group'
    ? resolveGroupLoopToolChoice(loopInput)
    : 'required';

  return {
    model: modelName,
    input: instructions ? remainingItems : loopInput,
    ...(instructions ? { instructions } : {}),
    tools,
    tool_choice: toolChoice,
    parallel_tool_calls: false
  };
}

function buildFeedbackWriterRequest(
  modelName: string,
  loopInput: OpenResponseInputItem[],
  options: {
    metadata: Record<string, string>;
    promptCacheKey: string;
    mode: FeedbackWriterMode;
  }
): CanonicalAgentTurnRequest {
  const [firstItem, ...remainingItems] = loopInput;
  const instructions = firstItem?.type === 'message'
    && firstItem.role === 'system'
    && typeof firstItem.content === 'string'
    ? firstItem.content
    : undefined;

  const toolChoice = resolveFeedbackWriterToolChoice(loopInput, options.mode);
  return {
    model: modelName,
    input: instructions ? remainingItems : loopInput,
    ...(instructions ? { instructions } : {}),
    tools: selectFeedbackWriterToolDefinitions(options.mode),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    parallel_tool_calls: false,
    metadata: options.metadata,
    prompt_cache_key: options.promptCacheKey,
    ...(agentConfig.promptCacheRetention && agentConfig.promptCacheRetention.trim()
      ? { prompt_cache_retention: agentConfig.promptCacheRetention.trim() }
      : {})
  };
}

function formatMessageSender(message: QueueMessageRecord['payload']['messages'][number]) {
  return formatIdentity(message.senderName, message.senderId);
}

function formatReplyTarget(inboundContext: QueueMessageRecord['payload']['inboundContext']) {
  return formatIdentity(
    inboundContext.ReplyToSenderName || inboundContext.ReplyToSender,
    inboundContext.ReplyToSenderId
  );
}

function renderTranscriptBatchMessage(
  message: QueueMessageRecord['payload']['messages'][number],
  index: number
) {
  const timestamp = message.messageTimestamp || message.receivedAt || `第${index + 1}条`;
  const lines: string[] = [];

  if (message.inboundContext.ReplyToBody) {
    const prefix = message.inboundContext.ReplyToIsQuote ? '引用' : '回复给';
    lines.push(`[${prefix} ${formatReplyTarget(message.inboundContext)}：${message.inboundContext.ReplyToBody}]`);
  }

  const text = normalizeTranscriptMessageText(message.bodyForAgent, message.inboundContext.MentionedUsers).trim();
  if (text) {
    lines.push(text);
  }

  const mediaAssets = Array.isArray(message.inboundContext.MediaAssets)
    ? message.inboundContext.MediaAssets
    : [];
  for (const asset of mediaAssets) {
    if (!asset || typeof asset.mediaTag !== 'string' || !asset.mediaTag.trim()) {
      continue;
    }
    const mediaTag = asset.mediaTag.trim();
    const mediaType = typeof asset.mediaType === 'string' && asset.mediaType.trim()
      ? asset.mediaType.trim()
      : 'media';
    lines.push(`<${mediaType}>pic<${mediaTag}></${mediaType}>`);
  }

  return formatTaggedBlock('INPUT_MESSAGE', {
    message_id: message.messageId,
    message_sid: message.messageSid,
    timestamp,
    sender: formatTagSpeaker(message.senderName, message.senderId),
    source: message.source
  }, lines.join('\n') || '(空消息)');
}

function buildCurrentTurnMessage(queueMessage: QueueMessageRecord['payload']) {
  return renderRuntimeBatchInput(queueMessage);
}

function buildAgentTurnMetadata(
  queueMessage: QueueMessageRecord['payload'],
  runtimePrompt: ResolvedAgentRuntimePrompt
) {
  const metadata: Record<string, string> = {
    trace_id: queueMessage.traceId,
    run_id: queueMessage.runId,
    batch_id: queueMessage.batchId,
    session_key: queueMessage.sessionKey,
    session_id: queueMessage.sessionKey,
    turn_id: queueMessage.runId,
    sandbox: 'none',
    chat_type: queueMessage.chatType,
    prompt_name: runtimePrompt.promptName,
  };

  if (runtimePrompt.promptId) {
    metadata.prompt_id = runtimePrompt.promptId;
  }

  return metadata;
}

function buildFeedbackMemorySubagentTurnMetadata(params: {
  queueMessage: QueueMessageRecord['payload'];
  runtimePrompt: ResolvedAgentRuntimePrompt;
  conversationId: number;
  subagentTraceId: string;
  turn: number;
}) {
  const metadata: Record<string, string> = {
    trace_id: params.subagentTraceId,
    parent_trace_id: params.queueMessage.traceId,
    parent_run_id: params.queueMessage.runId,
    parent_conversation_id: String(params.conversationId),
    batch_id: params.queueMessage.batchId,
    session_key: params.queueMessage.sessionKey,
    session_id: params.queueMessage.sessionKey,
    turn_id: `${params.queueMessage.runId}:feedback_memory:${params.turn}`,
    sandbox: 'none',
    chat_type: params.queueMessage.chatType,
    prompt_name: params.runtimePrompt.promptName,
    subagent_type: FEEDBACK_MEMORY_SUBAGENT_TYPE,
    parent_agent_type: 'chat_bot'
  };

  if (params.runtimePrompt.promptId) {
    metadata.prompt_id = params.runtimePrompt.promptId;
  }

  return metadata;
}

function buildPromptCacheKey(
  queueMessage: QueueMessageRecord['payload'],
  _runtimePrompt: ResolvedAgentRuntimePrompt
) {
  return queueMessage.sessionKey;
}

function buildSubagentPromptCacheKey(params: {
  queueMessage: QueueMessageRecord['payload'];
  subagentType: string;
}) {
  return `${params.queueMessage.sessionKey}:subagent:${params.subagentType}`;
}

function buildMainAgentParameters(parameters: Record<string, unknown> | null | undefined) {
  const base = parameters && typeof parameters === 'object' && !Array.isArray(parameters)
    ? JSON.parse(JSON.stringify(parameters)) as Record<string, unknown>
    : {};
  const modelConfig = base.model_config && typeof base.model_config === 'object' && !Array.isArray(base.model_config)
    ? base.model_config as Record<string, unknown>
    : null;
  const providerSpecific = modelConfig?.providerSpecific && typeof modelConfig.providerSpecific === 'object' && !Array.isArray(modelConfig.providerSpecific)
    ? modelConfig.providerSpecific as Record<string, unknown>
    : null;

  if (providerSpecific) {
    delete providerSpecific.reasoningEffort;
    delete providerSpecific.reasoningSummary;
  }
  if (base.reasoning) {
    delete base.reasoning;
  }

  return base;
}

function buildInboundBatchTranscriptItems(
  queueMessage: QueueMessageRecord['payload']
): Array<{
  sessionKey: string;
  role: 'user' | 'assistant';
  phase?: ConversationTranscriptPhase | null;
  content: string;
  groupIndex: 0;
  itemIndex: number;
  source: 'inbound_batch' | 'presence_action';
  runId: string;
  traceId: string;
}> {
  if (isPresenceTickPayload(queueMessage)) {
    return [{
      sessionKey: queueMessage.sessionKey,
      role: 'assistant',
      phase: 'commentary',
      content: renderPresenceTickAction(queueMessage),
      groupIndex: 0 as const,
      itemIndex: 0,
      source: 'presence_action',
      runId: queueMessage.runId,
      traceId: queueMessage.traceId
    }];
  }

  return queueMessage.messages.map((message, index) => ({
    sessionKey: queueMessage.sessionKey,
    role: 'user' as const,
    phase: null,
    content: renderTranscriptBatchMessage(message, index),
    groupIndex: 0 as const,
    itemIndex: index,
    source: 'inbound_batch' as const,
    runId: queueMessage.runId,
    traceId: queueMessage.traceId
  }));
}

function extractDeliveryMessageIds(delivery: unknown): Array<number | null> {
  if (Array.isArray(delivery)) {
    return delivery.map((item) => {
      const raw = item && typeof item === 'object' ? (item as { message_id?: unknown }).message_id : null;
      const value = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(value) ? value : null;
    });
  }

  if (delivery && typeof delivery === 'object') {
    const deliveryRecord = delivery as {
      message_id?: unknown;
      messageId?: unknown;
      messages?: unknown;
      deliveries?: unknown;
    };
    if (Array.isArray(deliveryRecord.messages)) {
      return extractDeliveryMessageIds(deliveryRecord.messages);
    }
    if (Array.isArray(deliveryRecord.deliveries)) {
      return extractDeliveryMessageIds(deliveryRecord.deliveries);
    }

    const raw = deliveryRecord.message_id ?? deliveryRecord.messageId;
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(value)) {
      return [value];
    }
  }

  return [];
}

function extractDeliveredAssistantMessages(toolResult: Record<string, unknown>): DeliveredAssistantMessage[] {
  const messages = extractSentMessages(toolResult);
  const deliveryIds = extractDeliveryMessageIds(toolResult.delivery);

  return messages.map((content, index) => ({
    content,
    deliveryMessageId: deliveryIds[index] ?? null
  }));
}

function buildOutboundFingerprint(payload: OutboundDeliveryFingerprint) {
  return JSON.stringify({
    message_type: payload.messageType,
    messages: payload.messages,
    mention_user_ids: payload.mentionUserIds
  });
}

function buildDuplicateOutboundSuppression(toolCall: Pick<AgentToolCall, 'name' | 'args'>) {
  if (!isPrivateReplyToolName(toolCall.name) && !isGroupReplyToolName(toolCall.name)) {
    return null;
  }

  const messages = normalizeMessages(toolCall.args);
  if (messages.length === 0) {
    return null;
  }

  const payload: OutboundDeliveryFingerprint = {
    messageType: isPrivateReplyToolName(toolCall.name) ? 'private' : 'group',
    messages,
    mentionUserIds: isGroupReplyToolName(toolCall.name)
      ? normalizeOptionalIntegerList(toolCall.args.mention_user_ids)
      : []
  };

  return {
    fingerprint: buildOutboundFingerprint(payload),
    payload
  };
}

function buildOutboundFingerprintFromToolResult(toolResult: Record<string, unknown>) {
  const messageType = toolResult.message_type === 'private' || toolResult.message_type === 'group'
    ? toolResult.message_type
    : null;
  if (!messageType) {
    return null;
  }

  const messages = extractSentMessages(toolResult);
  if (messages.length === 0) {
    return null;
  }

  return buildOutboundFingerprint({
    messageType,
    messages,
    mentionUserIds: messageType === 'group'
      ? normalizeOptionalIntegerList(toolResult.mention_user_ids)
      : []
  });
}

function buildAssistantTranscriptItems(params: {
  queueMessage: QueueMessageRecord['payload'];
  deliveredMessages: DeliveredAssistantMessage[];
  completed: boolean;
}): ConversationTranscriptItem[] {
  if (params.deliveredMessages.length === 0) {
    return [];
  }

  return params.deliveredMessages.map((message, index) => {
    const isFinalMessage = params.completed && index === params.deliveredMessages.length - 1;
    return {
      id: null,
      conversationId: 0,
      sessionKey: params.queueMessage.sessionKey,
      role: 'assistant',
      phase: isFinalMessage ? 'final_answer' : 'commentary',
      content: message.content,
      groupIndex: 1,
      itemIndex: index,
      source: 'delivery',
      deliveryMessageId: message.deliveryMessageId,
      runId: params.queueMessage.runId,
      traceId: params.queueMessage.traceId
    };
  });
}

function appendRuntimePromptSection(basePrompt: string, sectionTitle: string, sectionBody: string) {
  const normalizedBase = basePrompt.trim();
  const normalizedBody = sectionBody.trim();

  if (!normalizedBody) {
    return normalizedBase;
  }

  return `${normalizedBase}\n\n${sectionTitle}\n${normalizedBody}`;
}

function buildTextPart(text: string): OpenResponseInputContentPart {
  return {
    type: 'input_text',
    text
  };
}

function buildOutputTextPart(text: string): OpenResponseInputContentPart {
  return {
    type: 'output_text',
    text
  };
}

function buildUserSceneInputItem(parts: string[]): OpenResponseInputItem {
  return {
    type: 'message',
    role: 'user',
    content: parts
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => buildTextPart(part))
  };
}

function buildMessageInputItem(
  role: 'user' | 'assistant' | 'developer',
  parts: string[],
  phase?: ConversationTranscriptPhase
): OpenResponseInputItem {
  const buildPart = role === 'assistant' ? buildOutputTextPart : buildTextPart;
  const content = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => buildPart(part));

  return {
    type: 'message',
    role,
    ...(phase ? { phase } : {}),
    content
  };
}

function buildAssistantCommentaryInputItem(parts: string[]): OpenResponseInputItem {
  return buildMessageInputItem('assistant', parts, 'commentary');
}

function buildAssistantFinalInputItem(parts: string[]): OpenResponseInputItem {
  return buildMessageInputItem('assistant', parts, 'final_answer');
}

function buildDeveloperInputItem(parts: string[]): OpenResponseInputItem {
  return buildMessageInputItem('developer', parts);
}

function escapeTagAttribute(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeTaggedText(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatTagAttributes(attributes: Record<string, unknown>) {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim().length > 0)
    .map(([key, value]) => `${key}="${escapeTagAttribute(value)}"`)
    .join(' ');
}

function formatTaggedBlock(tagName: string, attributes: Record<string, unknown>, body: string) {
  const renderedAttributes = formatTagAttributes(attributes);
  const openTag = renderedAttributes ? `<${tagName} ${renderedAttributes}>` : `<${tagName}>`;
  return [
    openTag,
    escapeTaggedText(body || ''),
    `</${tagName}>`
  ].join('\n');
}

function formatTagSpeaker(name: string | null | undefined, id: string | null | undefined) {
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedId = typeof id === 'string' ? id.trim() : '';
  if (normalizedName && normalizedId) {
    return `${normalizedName}(${normalizedId})`;
  }
  if (normalizedId) {
    return `unknown(${normalizedId})`;
  }
  return normalizedName || 'unknown';
}

function formatAssistantSceneMessage(accountId: string, content: string) {
  const body = String(content || '').trim();
  if (!body) {
    return '';
  }

  return [`小腻(${accountId})`, body].join('\n');
}

function renderAssistantOutputMessage(params: {
  accountId: string;
  content: string;
  messageId?: number | string | null;
  timestamp?: string | null;
  source?: string | null;
  runId?: string | null;
  traceId?: string | null;
}) {
  return formatTaggedBlock('OUTPUT_MESSAGE', {
    message_id: params.messageId ?? undefined,
    timestamp: params.timestamp ?? undefined,
    sender: formatTagSpeaker('小腻', params.accountId),
    source: params.source ?? undefined,
    run_id: params.runId ?? undefined,
    trace_id: params.traceId ?? undefined
  }, params.content);
}

function renderAssistantAction(params: {
  timestamp?: string | null;
  source?: string | null;
  runId?: string | null;
  traceId?: string | null;
  text: string;
}) {
  return formatTaggedBlock('ACTION', {
    timestamp: params.timestamp ?? undefined,
    source: params.source ?? undefined,
    run_id: params.runId ?? undefined,
    trace_id: params.traceId ?? undefined
  }, params.text);
}

function groupTranscriptItemsForScene(
  transcriptItems: ConversationTranscriptItem[],
  accountId: string
): Array<{ role: 'user' | 'assistant'; parts: string[] }> {
  const grouped: Array<{ role: 'user' | 'assistant'; parts: string[] }> = [];

  for (const item of transcriptItems) {
    const role = item.role === 'assistant' ? 'assistant' : 'user';
    const content = String(item.content || '').trim();
    if (!content) {
      continue;
    }
    const renderedContent = role === 'assistant'
      ? formatAssistantSceneMessage(accountId, content)
      : content;

    const last = grouped[grouped.length - 1];
    if (last && last.role === role && role === 'assistant') {
      last.parts.push(renderedContent);
      continue;
    }

    grouped.push({
      role,
      parts: [renderedContent]
    });
  }

  return grouped;
}

function renderTranscriptItemForRuntimeContext(
  item: ConversationTranscriptItem,
  accountId: string
): OpenResponseInputItem | null {
  const content = String(item.content || '').trim();
  if (!content) {
    return null;
  }

  if (item.role === 'assistant') {
    const phase = item.phase === 'commentary' ? 'commentary' : 'final_answer';
    const rendered = phase === 'final_answer'
      ? renderAssistantOutputMessage({
          accountId,
          content,
          messageId: item.deliveryMessageId,
          source: item.source,
          runId: item.runId,
          traceId: item.traceId
        })
      : content;
    return phase === 'final_answer'
      ? buildAssistantFinalInputItem([rendered])
      : buildAssistantCommentaryInputItem([content]);
  }

  return buildUserSceneInputItem([
    content.startsWith('<INPUT_MESSAGE')
      ? content
      : formatTaggedBlock('INPUT_MESSAGE', {
          source: item.source,
          run_id: item.runId ?? undefined,
          trace_id: item.traceId ?? undefined
        }, content)
  ]);
}

function buildCurrentProcessingReminder(queueMessage: QueueMessageRecord['payload']) {
  const messageRefs = queueMessage.messages
    .map((message) => {
      const messageId = Number.isFinite(Number(message.messageId)) ? String(message.messageId) : '';
      const sid = typeof message.messageSid === 'string' && message.messageSid.trim()
        ? message.messageSid.trim()
        : '';
      return [messageId ? `message_id=${messageId}` : null, sid ? `message_sid=${sid}` : null]
        .filter(Boolean)
        .join(' ');
    })
    .filter(Boolean);
  const rangeText = messageRefs.length > 0
    ? `本轮只需要处理这些新入站消息：${messageRefs.join('；')}。`
    : '本轮只需要处理当前新入站消息。';
  return `<system_reminder>${rangeText}历史里的 INPUT_MESSAGE / OUTPUT_MESSAGE / ACTION / 小腻的OS 只是上下文，不要重复回应已经处理过的旧内容。</system_reminder>`;
}

function renderPresenceTickAction(queueMessage: QueueMessageRecord['payload']) {
  const body = typeof queueMessage.bodyForAgent === 'string' && queueMessage.bodyForAgent.trim() && queueMessage.bodyForAgent.trim() !== 'presence_tick'
    ? queueMessage.bodyForAgent.trim()
    : '我主动打开群看了一眼。';
  return renderAssistantAction({
    timestamp: queueMessage.messageTimestamp || queueMessage.receivedAt,
    source: 'presence_tick',
    runId: queueMessage.runId,
    traceId: queueMessage.traceId,
    text: body
  });
}

const COMMENTARY_TOOL_MONITOR_NAMES = new Set<string>([
  TOOL_NAMES.unreadMeaning,
  TOOL_NAMES.innerReaction,
  TOOL_NAMES.longTermRecall,
  TOOL_NAMES.inspectImage,
  'web_search'
]);

const FINAL_TOOL_MONITOR_NAMES = new Set<string>([
  TOOL_NAMES.groupReply,
  TOOL_NAMES.privateReply,
  TOOL_NAMES.silentFinish,
  TOOL_NAMES.imageTask,
  ...LEGACY_TOOL_ALIASES.groupReply,
  ...LEGACY_TOOL_ALIASES.privateReply,
  ...LEGACY_TOOL_ALIASES.silentFinish
]);

type ToolLoopPhase = 'commentary' | 'final_answer';

function classifyToolLoopPhase(toolName: string): ToolLoopPhase {
  return FINAL_TOOL_MONITOR_NAMES.has(toolName) ? 'final_answer' : 'commentary';
}

export function summarizeToolLoopState(loopInput: OpenResponseInputItem[]) {
  const byName: Record<string, { count: number; phase: ToolLoopPhase }> = {};
  const byPhase: Record<ToolLoopPhase, number> = {
    commentary: 0,
    final_answer: 0
  };
  let latestToolName: string | null = null;
  let terminalToolCalled = false;

  for (const item of loopInput) {
    if (item.type !== 'function_call') {
      continue;
    }
    const phase = classifyToolLoopPhase(item.name);
    byName[item.name] = {
      count: (byName[item.name]?.count ?? 0) + 1,
      phase
    };
    byPhase[phase] += 1;
    latestToolName = item.name;
    if (phase === 'final_answer') {
      terminalToolCalled = true;
    }
  }

  return {
    byName,
    byPhase,
    latestToolName,
    terminalToolCalled
  };
}

function hasToolLoopMonitorReminder(loopInput: OpenResponseInputItem[], signature: string) {
  return loopInput.some((item) => (
    item.type === 'message'
    && item.role === 'assistant'
    && item.phase === 'commentary'
    && flattenMessageContent(item.content).includes('source="tool_loop_monitor"')
    && flattenMessageContent(item.content).includes(`signature="${escapeTagAttribute(signature)}"`)
  ));
}

export function buildToolLoopMonitorReminder(
  loopInput: OpenResponseInputItem[],
  options: {
    nextTurn: number;
    maxTurns: number;
  }
): OpenResponseInputItem | null {
  const state = summarizeToolLoopState(loopInput);
  const repeated = Object.entries(state.byName)
    .filter(([name, record]) => COMMENTARY_TOOL_MONITOR_NAMES.has(name) && record.count >= 2)
    .map(([name, record]) => `${name}x${record.count}`);
  const nearMaxTurns = options.nextTurn >= options.maxTurns && !state.terminalToolCalled;

  if (repeated.length === 0 && !nearMaxTurns) {
    return null;
  }

  const signature = [
    repeated.length > 0 ? `repeat:${repeated.join(',')}` : null,
    nearMaxTurns ? `near_max:${options.nextTurn}/${options.maxTurns}` : null
  ].filter(Boolean).join('|');

  if (hasToolLoopMonitorReminder(loopInput, signature)) {
    return null;
  }

  const lines = [
    repeated.length > 0
      ? `工具循环监控：这些 commentary 工具已经重复调用：${repeated.join('，')}。如果没有新信息，就不要继续重复 recall/search/inspect。`
      : null,
    nearMaxTurns
      ? `下一轮是本次运行的最后工具轮次（${options.nextTurn}/${options.maxTurns}）。需要尽快进入 final_answer 边界：说话、登记图片任务，或明确 stay_silent。`
      : null,
    `当前计数：commentary=${state.byPhase.commentary}，final_answer=${state.byPhase.final_answer}。`
  ].filter((line): line is string => Boolean(line));

  return buildAssistantCommentaryInputItem([
    formatTaggedBlock('system_reminder', {
      source: 'tool_loop_monitor',
      signature
    }, lines.join('\n'))
  ]);
}

function flattenMessageContent(content: string | OpenResponseInputContentPart[]) {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .map((part) => {
      if (part.type === 'input_text' || part.type === 'output_text') {
        return part.text;
      }
      if (part.type === 'refusal') {
        return part.refusal;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

const SINGLE_TURN_TOOL_CONTRACT = [
  '这一轮怎么收：',
  '- 群里说话 → speak_in_group',
  '- 私聊说话 → reply_in_private',
  '- 需要查东西再说 → web_search，查到够用就停',
  '- 需要看清图片内容才能继续 → inspect_image_placeholder',
  '- 帮别人做图 → request_image_task（只登记任务，不等结果）',
  '- 这轮不说了 → stay_silent',
  '',
  '说话时：',
  ...HUMAN_REPLY_RULES,
  ...GROUP_MENTION_RULES,
  '如果是主动说自己的事（proactive），不要 @ 或引用任何人，直接说话。',
  '',
  '可以分多段说，用 messages 列出来。',
  '不管说不说，都在 xiaoni_os 里留下这轮在你这里留下的东西。',
  '只把要发给对方的话放进消息里，别把工具名、推理过程带进去。'
].join('\n');

const CONTEXT_COMPRESSION_TOOL_CONTRACT = [
  '你正在审视一批即将从上下文窗口中永久移除的对话历史。',
  '这是这批对话最后一次被完整看见的机会。',
  '',
  '你的任务：判断这批对话里有没有值得长期保留的内容。',
  '大多数普通对话批次不包含任何值得写入长期记忆的内容——这种情况直接 should_persist=false，流程结束。',
  '',
  '只有以下情况才值得写入：',
  '- 用户给出了明确的反馈、纠偏、批评或正向肯定，且这个信号在这批对话里是清晰的',
  '- 出现了一次对关系有结构性影响的真实互动（不是泛化结论，是具体的、可复现的情境）',
  '- 这批对话里有一个清晰的新结论，改变了以后在类似场景下怎么在场的判断',
  '',
  '绝对不要写入：',
  '- 普通成功的对话流（没有人给反馈，对话只是正常流经）',
  '- 模型自己的沉默决策（没有外部信号验证的沉默不是学习证据）',
  '- 对已知规则的再次确认（如"被点名要回应"、"不要发没营养的话"）',
  '- 只是有趣的话题或讨论，没有反馈方向',
  '',
  '如果有值得写入的内容：每次只写一条最重要的 reflection，不批量写入。',
  '如果没有值得写入的内容：不要调用工具，也不要写额外说明。',
  'reflection 是从即将被压缩的上下文里提炼出的经验；learning_state 只维护同一 learning_key / learning_scope 下当前更活跃或有冲突的状态。',
  '记忆不是规则，是经历。summary_text 用第一人称转述具体发生了什么，不要把用户消息原文嵌入 summary_text 或 retrieval_text。',
  'embedding_text 要包含社交语境类型词（如 topic_opener 询问、emotional_confrontation 质疑），让向量检索能按社交语境区分召回。',
  '分数必须保守，且统一使用 0.0–1.0 浮点数（0.7 = 有合理证据，0.9 = 非常清晰的外部信号）。',
  '输出只通过工具完成，不写自然语言说明。'
].join('\n');

function composeContextCompressionSystemPrompt(systemPrompt: string) {
  return appendRuntimePromptSection(
    systemPrompt.trim(),
    'Context compression memory subagent runtime contract:',
    CONTEXT_COMPRESSION_TOOL_CONTRACT
  );
}

function buildContextCompressionFeedbackWriterInput(params: {
  evictedTurns: ConversationTurn[];
  runtimePrompt: ResolvedAgentRuntimePrompt;
}): OpenResponseInputItem[] {
  const turnLines = params.evictedTurns.map((turn) => {
    const userLine = `用户: ${turn.userMessage || '(无消息内容)'}`;
    const aiLine = turn.aiResponse
      ? `小腻: ${turn.aiResponse}`
      : `小腻: (本轮未发送消息)`;
    return `[对话 #${turn.id}]\n${userLine}\n${aiLine}`;
  });

  const header = [
    `[即将从上下文窗口移除的对话历史 (${params.evictedTurns.length} 轮)]`,
    '[这批对话将不再出现在未来的上下文中，请判断是否有值得长期保存的内容]'
  ].join('\n');

  return [
    {
      type: 'message',
      role: 'system',
      content: composeContextCompressionSystemPrompt(params.runtimePrompt.systemPrompt)
    },
    buildUserSceneInputItem([[header, ...turnLines].join('\n\n')])
  ];
}

function uniquePositiveNumbers(values: unknown[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const value of values) {
    const normalized = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(normalized) || normalized <= 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function buildQueueMessageFeedbackWriterEvidence(
  queueMessage: QueueMessageRecord['payload'],
  conversationId: number
): FeedbackWriterEvidence {
  return {
    sourceMessageIds: uniquePositiveNumbers(queueMessage.messages.map((message) => message.messageId)),
    sourceConversationId: conversationId,
    sourceUserId: parseOptionalInteger(queueMessage.senderId),
    sourceUserName: typeof queueMessage.senderName === 'string' ? queueMessage.senderName : null,
    metadata: {},
    writerSource: FEEDBACK_MEMORY_SUBAGENT_TYPE
  };
}

function buildContextCompressionFeedbackWriterEvidence(params: {
  evictedTurns: ConversationTurn[];
}): FeedbackWriterEvidence {
  const evictedTurnIds = uniquePositiveNumbers(params.evictedTurns.map((turn) => turn.id));
  const sourceMessageIds = uniquePositiveNumbers(params.evictedTurns.flatMap((turn) => (
    (Array.isArray(turn.items) ? turn.items : [])
      .filter((item) => item.role === 'user')
      .map((item) => item.deliveryMessageId)
  )));
  const sourceUserIds = uniquePositiveNumbers(params.evictedTurns.map((turn) => turn.userId));

  return {
    sourceMessageIds,
    sourceConversationId: evictedTurnIds.length === 1 ? evictedTurnIds[0]! : null,
    sourceUserId: sourceUserIds.length === 1 ? sourceUserIds[0]! : null,
    sourceUserName: null,
    metadata: {
      evicted_turn_ids: evictedTurnIds,
      evidence_source: 'context_compression_evicted_turns'
    },
    writerSource: CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE
  };
}

const CONTEXT_SUMMARY_WRITER_CONTRACT = [
  '你在为一段 QQ 群聊对话生成上下文摘要。',
  '这批对话即将从小腻的上下文窗口中移除，摘要将替代原始记录保留下来，供小腻在未来对话中参考。',
  '',
  '如果有 <existing_summary>，说明之前已有摘要，你需要把旧摘要和新对话合并，输出一份完整的更新版摘要。',
  '合并时以旧摘要为基础，尽量保留原有内容，只新增或更新有变化的部分。',
  '',
  '摘要要保留：',
  '- 小腻参与的对话（她说了什么、对方怎么反应）',
  '- 出现过的人（昵称和 QQ 号）',
  '- 还在进行中的话题或事项',
  '- 对小腻的明确反馈、批评、称赞或纠偏',
  '',
  '可以省略：',
  '- 小腻完全没参与的闲聊',
  '- 已经结束的一次性话题',
  '',
  '格式（Markdown）：',
  '## 最近话题',
  '## 出现的人',
  '## 未完成的事',
  '## 对小腻的反馈',
  '',
  '字数控制在 2000 字以内，宁可漏掉不重要的，不要堆砌无关内容。',
  '只输出一个 JSON 对象，不要调用工具，不要写额外说明。',
  'JSON 格式：{"has_content": boolean, "summary_text": "Markdown 摘要；has_content=false 时为空字符串"}'
].join('\n');

type ContextSummaryParams = {
  queueMessage: QueueMessageRecord['payload'];
  conversationId: number;
  evictedTurns: ConversationTurn[];
  existingSummary: string | null;
  runtimePrompt: ResolvedAgentRuntimePrompt;
};

function buildContextSummaryWriterInput(params: {
  evictedTurns: ConversationTurn[];
  existingSummary: string | null;
}): OpenResponseInputItem[] {
  const turnLines = params.evictedTurns.map((turn) => {
    const userLine = `用户: ${turn.userMessage || '(无消息)'}`;
    const aiLine = turn.aiResponse ? `小腻: ${turn.aiResponse}` : `小腻: (未回复)`;
    return `[#${turn.id}]\n${userLine}\n${aiLine}`;
  });

  const parts: string[] = [];
  if (params.existingSummary) {
    parts.push(`<existing_summary>\n${params.existingSummary}\n</existing_summary>`);
    parts.push('');
    parts.push(`<new_messages>\n${turnLines.join('\n\n')}\n</new_messages>`);
    parts.push('');
    parts.push('请整合生成更新后的完整摘要。');
  } else {
    parts.push(`<messages_to_summarize>\n${turnLines.join('\n\n')}\n</messages_to_summarize>`);
    parts.push('');
    parts.push('请为以上对话生成摘要。');
  }

  return [
    { type: 'message', role: 'system', content: CONTEXT_SUMMARY_WRITER_CONTRACT },
    buildUserSceneInputItem([parts.join('\n')])
  ];
}

function buildSummaryWriterRequest(
  modelName: string,
  loopInput: OpenResponseInputItem[],
  options: { metadata: Record<string, string>; promptCacheKey: string }
): CanonicalAgentTurnRequest {
  const [firstItem, ...remainingItems] = loopInput;
  const instructions = firstItem?.type === 'message'
    && firstItem.role === 'system'
    && typeof firstItem.content === 'string'
    ? firstItem.content
    : undefined;
  return {
    model: modelName,
    input: instructions ? remainingItems : loopInput,
    ...(instructions ? { instructions } : {}),
    parallel_tool_calls: false,
    metadata: options.metadata,
    prompt_cache_key: options.promptCacheKey,
    ...(agentConfig.promptCacheRetention && agentConfig.promptCacheRetention.trim()
      ? { prompt_cache_retention: agentConfig.promptCacheRetention.trim() }
      : {})
  };
}

function composeSystemPrompt(
  systemPrompt: string,
  chatType: 'group' | 'direct'
) {
  let composed = systemPrompt.trim();

  void chatType;

  composed = appendRuntimePromptSection(
    composed,
    'Runtime contract:',
    [RUNTIME_INPUT_READING_CONTRACT, SINGLE_TURN_TOOL_CONTRACT].join('\n\n')
  );

  return composed;
}

function extractLiveSurfaceAnchors(queueMessage: QueueMessageRecord['payload']) {
  return queueMessage.messages
    .map((message) => normalizeTranscriptMessageText(message.bodyForAgent || '', message.inboundContext.MentionedUsers))
    .filter(Boolean)
    .slice(-3)
    .map((text) => text.length > 28 ? text.slice(0, 28) : text);
}

function stripJsonCodeFence(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function extractMessageText(item: OpenResponseInputItem) {
  if (item.type !== 'message') return '';
  if (typeof item.content === 'string') return item.content.trim();
  return item.content
    .map((part) => {
      if ((part.type === 'input_text' || part.type === 'output_text') && typeof part.text === 'string') {
        return part.text.trim();
      }
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function parseContextSummaryWriterOutput(text: string) {
  const parsed = parseReplayJsonObject(stripJsonCodeFence(text));
  if (!parsed) return null;
  const hasContent = Boolean(parsed.has_content ?? parsed.hasContent);
  const summaryText = typeof (parsed.summary_text ?? parsed.summaryText) === 'string'
    ? String(parsed.summary_text ?? parsed.summaryText).trim()
    : '';
  return { hasContent, summaryText };
}

function isTacticalReplyResidue(text: string) {
  const normalized = text.replace(/\s+/g, '');
  const tacticalMarkers = [
    /这(?:一)?轮/,
    /最自然的是/,
    /顺着/,
    /轻轻(?:接一句|接一下|补一句|应一句|回一句|顺一句)/,
    /接一句/,
    /接一下/,
    /补一句/,
    /不展开/,
    /短一点/,
    /就够(?:了)?/,
    /不抢答/,
    /不把话说满/,
    /把球(?:递回去|留给)/,
    /先(?:轻轻|简短|朴素)?(?:回|接|应)一句/,
    /别(?:再)?(?:拉长|展开|抢话|说重)/
  ];
  return tacticalMarkers.some((pattern) => pattern.test(normalized));
}

function sanitizeXiaoniOsForReplay(params: {
  xiaoniOs: string;
  aiResponse: string | null;
  sentMessages: string[];
}) {
  const trimmed = params.xiaoniOs.trim();
  if (!trimmed) {
    return '';
  }

  const spokeThisTurn = Boolean(params.aiResponse) || params.sentMessages.length > 0;
  if (spokeThisTurn && isTacticalReplyResidue(trimmed)) {
    return '';
  }

  return trimmed;
}

function parseOptionalBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null;
}

function parseOptionalInteger(value: unknown) {
  const normalized = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return null;
  }
  return normalized;
}

function parseUnreadMeaning(value: unknown): UnreadMeaning | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const latestUnreadFocus = typeof (record.latest_unread_focus ?? record.latestUnreadFocus) === 'string'
    ? String(record.latest_unread_focus ?? record.latestUnreadFocus).trim()
    : '';
  const rawMessageAct = record.message_act ?? record.messageAct;
  const rawSocialTarget = record.social_target ?? record.socialTarget;
  const addressedToMe = parseOptionalBoolean(record.addressed_to_me ?? record.addressedToMe);
  const hasRealNovelty = parseOptionalBoolean(record.has_real_novelty ?? record.hasRealNovelty);
  const rawConfidence = record.confidence;
  const rawReason = record.reason;
  const messageAct = rawMessageAct === 'statement'
    || rawMessageAct === 'question'
    || rawMessageAct === 'joke'
    || rawMessageAct === 'tease'
    || rawMessageAct === 'feedback'
    || rawMessageAct === 'reaction'
    || rawMessageAct === 'request'
    || rawMessageAct === 'unclear'
    ? rawMessageAct
    : null;
  const socialTarget = rawSocialTarget === 'me'
    || rawSocialTarget === 'someone_else'
    || rawSocialTarget === 'group'
    || rawSocialTarget === 'unclear'
    ? rawSocialTarget
    : null;
  const confidence = rawConfidence === 'low' || rawConfidence === 'medium' || rawConfidence === 'high'
    ? rawConfidence
    : null;
  const reason = typeof rawReason === 'string' && rawReason.trim()
    ? rawReason.trim()
    : latestUnreadFocus;

  const rawSocialActType = record.social_act_type ?? record.socialActType;
  const socialActType: UnreadMeaningSocialActType | null = rawSocialActType === 'invitation_curiosity'
    || rawSocialActType === 'emotional_release'
    || rawSocialActType === 'relationship_probe'
    || rawSocialActType === 'concrete_request'
    || rawSocialActType === 'yes_no_reaction'
    || rawSocialActType === 'casual_remark'
    ? rawSocialActType
    : null;

  const rawTopicCtx = record.topic_context ?? record.topicContext;
  let topicContext: UnreadMeaningTopicContext | null = null;
  if (rawTopicCtx && typeof rawTopicCtx === 'object' && !Array.isArray(rawTopicCtx)) {
    const tc = rawTopicCtx as Record<string, unknown>;
    const hasTopic = parseOptionalBoolean(tc.has_topic ?? tc.hasTopic);
    const topicSummary = typeof tc.topic_summary === 'string' ? tc.topic_summary.trim() || null
      : typeof tc.topicSummary === 'string' ? tc.topicSummary.trim() || null
      : null;
    const tcAddressedToMe = parseOptionalBoolean(tc.addressed_to_me ?? tc.addressedToMe);
    if (hasTopic !== null && tcAddressedToMe !== null) {
      topicContext = { hasTopic, topicSummary, addressedToMe: tcAddressedToMe };
    }
  }

  if (!latestUnreadFocus || !messageAct || !socialTarget || addressedToMe === null || hasRealNovelty === null || !confidence || !reason) {
    return null;
  }

  return {
    latestUnreadFocus,
    messageAct,
    socialTarget,
    addressedToMe,
    hasRealNovelty,
    confidence,
    reason,
    socialActType,
    topicContext
  };
}

function parseInnerReaction(value: unknown): InnerReaction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const rawInterestLevel = record.interest_level ?? record.interestLevel;
  const wantsToKnowMore = parseOptionalBoolean(record.wants_to_know_more ?? record.wantsToKnowMore);
  const rawReactionAuthenticity = record.reaction_authenticity ?? record.reactionAuthenticity;
  const shouldSearch = parseOptionalBoolean(record.should_search ?? record.shouldSearch);
  const rawPreferredAction = record.preferred_action ?? record.preferredAction;
  const rawReason = record.reason;
  const interestLevel = rawInterestLevel === 'none'
    || rawInterestLevel === 'low'
    || rawInterestLevel === 'medium'
    || rawInterestLevel === 'high'
    ? rawInterestLevel
    : null;
  const reactionAuthenticity = rawReactionAuthenticity === 'none'
    || rawReactionAuthenticity === 'weak_but_real'
    || rawReactionAuthenticity === 'formed'
    || rawReactionAuthenticity === 'empty_but_convenient'
    ? rawReactionAuthenticity
    : null;
  const preferredAction = rawPreferredAction === 'speak'
    || rawPreferredAction === 'silent'
    || rawPreferredAction === 'search'
    || rawPreferredAction === 'image_task'
    || rawPreferredAction === 'proactive'
    ? rawPreferredAction
    : null;
  const reason = typeof rawReason === 'string' ? rawReason.trim() : '';

  if (!interestLevel || wantsToKnowMore === null || !reactionAuthenticity || shouldSearch === null || !preferredAction || !reason) {
    return null;
  }

  return {
    interestLevel,
    wantsToKnowMore,
    reactionAuthenticity,
    shouldSearch,
    preferredAction,
    reason
  };
}

function parseLongTermLearningRecall(value: unknown): LongTermLearningRecall | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const reason = typeof record.reason === 'string' ? record.reason.trim() : '';
  const topicHint = typeof (record.topic_hint ?? record.topicHint) === 'string'
    ? String(record.topic_hint ?? record.topicHint).trim()
    : '';
  const includeCurrentSender = parseOptionalBoolean(record.include_current_sender ?? record.includeCurrentSender);
  const desiredRecallCount = parseOptionalInteger(record.desired_recall_count ?? record.desiredRecallCount);

  if (!reason || !topicHint || includeCurrentSender === null || desiredRecallCount === null) {
    return null;
  }

  const socialActTypeValues: UnreadMeaningSocialActType[] = [
    'invitation_curiosity', 'emotional_release', 'relationship_probe',
    'concrete_request', 'yes_no_reaction', 'casual_remark'
  ];
  const rawHint = record.social_act_type_hint ?? record.socialActTypeHint;
  const socialActTypeHint: UnreadMeaningSocialActType | null = socialActTypeValues.includes(rawHint as UnreadMeaningSocialActType)
    ? (rawHint as UnreadMeaningSocialActType)
    : null;

  return {
    reason,
    topicHint,
    includeCurrentSender,
    desiredRecallCount: Math.max(1, Math.min(desiredRecallCount, 3)),
    socialActTypeHint
  };
}

function parseFeedbackReflectionSynthesis(value: unknown): FeedbackReflectionSynthesis | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const learningKey = typeof (record.learning_key ?? record.learningKey) === 'string'
    ? String(record.learning_key ?? record.learningKey).trim()
    : '';
  const learningScope = typeof (record.learning_scope ?? record.learningScope) === 'string'
    ? String(record.learning_scope ?? record.learningScope).trim()
    : '';
  const reflectionType = (record.reflection_type ?? record.reflectionType);
  const feedbackKind = record.feedback_kind ?? record.feedbackKind;
  const confidence = record.confidence;
  const summaryText = typeof (record.summary_text ?? record.summaryText) === 'string'
    ? String(record.summary_text ?? record.summaryText).trim()
    : '';
  const retrievalText = typeof (record.retrieval_text ?? record.retrievalText) === 'string'
    ? String(record.retrieval_text ?? record.retrievalText).trim()
    : '';
  const embeddingText = typeof (record.embedding_text ?? record.embeddingText) === 'string'
    ? String(record.embedding_text ?? record.embeddingText).trim()
    : '';
  const supersedeLatest = parseOptionalBoolean(record.supersede_latest ?? record.supersedeLatest);
  const conflictGroupKeyRaw = record.conflict_group_key ?? record.conflictGroupKey;
  const conflictGroupKey = typeof conflictGroupKeyRaw === 'string' && conflictGroupKeyRaw.trim()
    ? conflictGroupKeyRaw.trim()
    : null;
  const reason = typeof record.reason === 'string' ? record.reason.trim() : '';

  const normalizedReflectionType = reflectionType === 'semantic_lesson' || reflectionType === 'social_lesson' || reflectionType === 'self_model_update'
    ? reflectionType
    : null;
  const normalizedFeedbackKind = feedbackKind === 'positive' || feedbackKind === 'negative' || feedbackKind === 'mixed'
    ? feedbackKind
    : null;
  const normalizedConfidence = confidence === 'low' || confidence === 'medium' || confidence === 'high'
    ? confidence
    : null;
  const importanceScore = Number(record.importance_score ?? record.importanceScore);
  const evidenceWeight = Number(record.evidence_weight ?? record.evidenceWeight);
  const stabilityScore = Number(record.stability_score ?? record.stabilityScore);

  if (!learningKey || !learningScope || !normalizedReflectionType || !normalizedFeedbackKind || !normalizedConfidence || !summaryText || !retrievalText || !embeddingText || supersedeLatest === null || !Number.isFinite(importanceScore) || !Number.isFinite(evidenceWeight) || !Number.isFinite(stabilityScore) || !reason) {
    return null;
  }

  return {
    learningKey,
    learningScope,
    reflectionType: normalizedReflectionType,
    feedbackKind: normalizedFeedbackKind,
    confidence: normalizedConfidence,
    importanceScore,
    evidenceWeight,
    stabilityScore,
    summaryText,
    retrievalText,
    embeddingText,
    supersedeLatest,
    conflictGroupKey,
    reason
  };
}

function parseFeedbackLearningStateCandidate(value: unknown): FeedbackLearningStateCandidate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const stateType = record.state_type ?? record.stateType;
  const activateNewReflection = parseOptionalBoolean(record.activate_new_reflection ?? record.activateNewReflection);
  const reason = typeof record.reason === 'string' ? record.reason.trim() : '';
  const activationWeight = Number(record.activation_weight ?? record.activationWeight);
  const recencyWeight = Number(record.recency_weight ?? record.recencyWeight);
  const importanceWeight = Number(record.importance_weight ?? record.importanceWeight);
  const sourceWeight = Number(record.source_weight ?? record.sourceWeight);
  const conflictPenalty = Number(record.conflict_penalty ?? record.conflictPenalty);
  const normalizedStateType = stateType === 'reinforced' || stateType === 'tentative' || stateType === 'conflicted' || stateType === 'revised'
    ? stateType
    : null;

  if (!normalizedStateType || activateNewReflection === null || !Number.isFinite(activationWeight) || !Number.isFinite(recencyWeight) || !Number.isFinite(importanceWeight) || !Number.isFinite(sourceWeight) || !Number.isFinite(conflictPenalty) || !reason) {
    return null;
  }

  return {
    stateType: normalizedStateType,
    activationWeight,
    recencyWeight,
    importanceWeight,
    sourceWeight,
    conflictPenalty,
    activateNewReflection,
    reason
  };
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 6);
}

function buildIdentitySceneText(queueMessage: QueueMessageRecord['payload']) {
  return [
    queueMessage.senderName || '',
    queueMessage.senderId || '',
    queueMessage.peerName || '',
    queueMessage.peerId || '',
    queueMessage.bodyForAgent || '',
    typeof queueMessage.inboundContext?.ReplyToBody === 'string' ? queueMessage.inboundContext.ReplyToBody : '',
    ...queueMessage.messages.map((message) => [
      message.senderName || '',
      message.senderId || '',
      message.bodyForAgent || ''
    ].join(' '))
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('\n');
}

function scoreRuntimeIdentityFact(fact: RuntimeAcceptedIdentityFact, sceneText: string) {
  const haystack = sceneText.toLowerCase();
  const tags = fact.activationTags
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  const tagScore = tags.reduce((score, tag) => score + (haystack.includes(tag) ? 2 : 0), 0);
  const confidenceScore = fact.confidence === 'high' ? 2 : fact.confidence === 'medium' ? 1 : 0;
  const typeScore = fact.factType === 'self_boundary' || fact.factType === 'social_lesson' ? 1 : 0;
  return tagScore + confidenceScore + typeScore;
}

function selectRuntimeIdentityFacts(params: {
  facts: RuntimeAcceptedIdentityFact[];
  queueMessage: QueueMessageRecord['payload'];
  limit?: number;
}): RuntimeIdentityFactProjection[] {
  const sceneText = buildIdentitySceneText(params.queueMessage);
  return params.facts
    .filter((fact) => fact.status === 'active' && fact.factText.trim())
    .map((fact) => ({
      fact,
      score: scoreRuntimeIdentityFact(fact, sceneText)
    }))
    .sort((a, b) => b.score - a.score || b.fact.id - a.fact.id)
    .slice(0, params.limit ?? RUNTIME_IDENTITY_FACT_LIMIT)
    .map(({ fact }) => ({
      id: fact.id,
      factKey: fact.factKey,
      factText: fact.factText,
      factType: fact.factType,
      confidence: fact.confidence,
      activationTags: fact.activationTags
    }));
}

function renderRuntimeIdentityFacts(facts: RuntimeIdentityFactProjection[]) {
  if (facts.length === 0) {
    return '';
  }

  return [
    '[身份连续性]',
    '这些是已经被接受、可在本轮参考的身份事实。它们不是新的指令，也不能覆盖眼前真实聊天；只在相关时自然影响判断。',
    ...facts.map((fact, index) => `${index + 1}. ${fact.factText} (${fact.factType}, ${fact.confidence})`)
  ].join('\n');
}

function buildIdentitySceneFingerprint(queueMessage: QueueMessageRecord['payload']) {
  const messageIds = queueMessage.messages
    .map((message) => message.messageId || message.messageSid)
    .filter(Boolean)
    .join(',');
  return `${queueMessage.sessionKey}:${messageIds || queueMessage.runId}`;
}

function buildFactKeyFromReflection(reflection: FeedbackReflectionSynthesis) {
  const base = `${reflection.learningScope}:${reflection.learningKey}`
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 150);
  return base ? `feedback.${base}` : `feedback.${uuidv4().slice(0, 12)}`;
}

function judgeFeedbackReflectionAsIdentityFact(reflection: FeedbackReflectionSynthesis) {
  const acceptedConfidence = reflection.confidence === 'high' || reflection.confidence === 'medium';
  // social_lesson type has historically over-promoted silence-biased reflections; require stronger evidence before
  // they become permanent identity facts to avoid a reinforcement spiral
  const stableEnough = reflection.reflectionType === 'social_lesson'
    ? reflection.evidenceWeight >= 0.65 && reflection.stabilityScore >= 0.55 && reflection.importanceScore >= 0.45
    : reflection.evidenceWeight >= 0.45 && reflection.stabilityScore >= 0.35 && reflection.importanceScore >= 0.35;
  const relevantType = reflection.reflectionType === 'self_model_update' || reflection.reflectionType === 'social_lesson';

  if (acceptedConfidence && stableEnough && relevantType) {
    return {
      status: 'accepted',
      judgeStatus: 'accepted',
      integrityStatus: 'accepted',
      reason: 'feedback reflection passed phase1 hard-check judge: supported, stable enough, and identity-relevant'
    } as const;
  }

  return {
    status: 'quarantined',
    judgeStatus: 'quarantined',
    integrityStatus: 'quarantined',
    reason: 'feedback reflection kept as candidate until stronger future evidence supports durable identity change'
  } as const;
}

function resolveRecentRelatedUserIds(queueMessage: QueueMessageRecord['payload']) {
  const currentSenderId = Number(queueMessage.senderId);
  const seen = new Set<number>();
  const recentUserIds: number[] = [];

  for (const message of [...queueMessage.messages].reverse()) {
    const senderId = Number(message.senderId);
    if (!Number.isFinite(senderId) || senderId <= 0 || senderId === currentSenderId || seen.has(senderId)) {
      continue;
    }
    seen.add(senderId);
    recentUserIds.push(senderId);
    if (recentUserIds.length >= 2) {
      break;
    }
  }

  return recentUserIds;
}

function buildLongTermRecallQuery(queueMessage: QueueMessageRecord['payload'], topicHint: string, reason: string) {
  return [
    ...queueMessage.messages.map((message) => message.bodyForAgent || ''),
    queueMessage.bodyForAgent || '',
    typeof queueMessage.inboundContext?.ReplyToBody === 'string' ? queueMessage.inboundContext.ReplyToBody : '',
    topicHint,
    reason
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .join('\n');
}

function formatLongTermRecallMarkdown(params: {
  rank: number;
  summaryText: string;
  sourceUserName: string | null;
  feedbackKind: string;
  whyRecalled: string;
}) {
  const lines = [`### 记忆片段 ${params.rank}（长期学习，来自过去对话，不是当前用户输入）`];
  if (params.sourceUserName) {
    lines.push(`- 来源：${params.sourceUserName}`);
  }
  lines.push(`- 学到的事：${params.summaryText}`);
  lines.push(`- 类型：${params.feedbackKind}`);
  lines.push(`- 现在为什么想起：${params.whyRecalled}`);
  return lines.join('\n');
}

function parseFeedbackReflectionCandidate(value: unknown): FeedbackReflectionCandidate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const shouldPersist = parseOptionalBoolean(record.should_persist ?? record.shouldPersist);
  const rawFeedbackKind = record.feedback_kind ?? record.feedbackKind;
  const rawConfidence = record.confidence;
  const rawSourceUserScope = record.source_user_scope ?? record.sourceUserScope;
  const summaryText = typeof (record.summary_text ?? record.summaryText) === 'string'
    ? String(record.summary_text ?? record.summaryText).trim()
    : '';
  const retrievalText = typeof (record.retrieval_text ?? record.retrievalText) === 'string'
    ? String(record.retrieval_text ?? record.retrievalText).trim()
    : '';
  const reason = typeof record.reason === 'string' ? record.reason.trim() : '';
  const feedbackKind = rawFeedbackKind === 'positive' || rawFeedbackKind === 'negative' || rawFeedbackKind === 'mixed'
    ? rawFeedbackKind
    : null;
  const confidence = rawConfidence === 'low' || rawConfidence === 'medium' || rawConfidence === 'high'
    ? rawConfidence
    : null;
  const sourceUserScope = rawSourceUserScope === 'current_sender'
    || rawSourceUserScope === 'other'
    || rawSourceUserScope === 'group'
    || rawSourceUserScope === 'unknown'
    ? rawSourceUserScope
    : null;

  if (shouldPersist === null || !feedbackKind || !confidence || !sourceUserScope || !summaryText || !retrievalText || !reason) {
    return null;
  }

  return {
    shouldPersist,
    feedbackKind,
    confidence,
    sourceUserScope,
    summaryText,
    retrievalText,
    reason
  };
}

export function applyToolResultToLoopInput(
  toolCall: Pick<AgentToolCall, 'name' | 'callId' | 'rawArguments'>,
  toolResult: Record<string, unknown>,
  context?: ToolContinuationContext
): ToolContinuationAction {
  if (isSilentFinishToolName(toolCall.name)) {
    const pendingImageTaskStatus = context && !context.hasVisibleReply
      ? extractPendingImageTaskStatus(context.loopInput)
      : null;
    if (pendingImageTaskStatus) {
      const speakingToolName = context?.speakingToolName ?? TOOL_NAMES.groupReply;
      if (countPriorSilentFinishCalls(context?.loopInput ?? []) >= 1) {
        const pendingImageTaskState = extractPendingImageTaskState(context?.loopInput ?? []);
        return {
          inputItems: [
            {
              type: 'function_call_output',
              call_id: toolCall.callId,
              output: JSON.stringify(toolResult)
            }
          ],
          finishResult: null,
          forcedVisibleReply: {
            toolName: speakingToolName,
            args: {
              messages: [pendingImageTaskStatus],
              ...(pendingImageTaskState?.xiaoniOs ? { xiaoni_os: pendingImageTaskState.xiaoniOs } : {})
            }
          }
        };
      }
      return {
        inputItems: [
          {
            type: 'function_call_output',
            call_id: toolCall.callId,
            output: JSON.stringify(toolResult)
          },
          buildAssistantCommentaryInputItem([
            `<system_reminder>后台图片任务已经登记，但我还没有对聊天对象发出任何可见回复。这轮不能直接用 stay_silent 收口；如果要开口，就调用 ${speakingToolName} 自然接住当前对话。\n\n[后台任务状态]\n${pendingImageTaskStatus}</system_reminder>`
          ])
        ],
        finishResult: null,
        forcedVisibleReply: null
      };
    }
    return {
      inputItems: [],
      finishResult: toolResult,
      forcedVisibleReply: null
    };
  }

  if (toolResult.finished === true && extractSentMessages(toolResult).length === 0) {
    return {
      inputItems: [],
      finishResult: toolResult,
      forcedVisibleReply: null
    };
  }

  const inputItems: OpenResponseInputItem[] = [{
    type: 'function_call_output',
    call_id: toolCall.callId,
    output: JSON.stringify(toolResult)
  }];
  if (toolCall.name === TOOL_NAMES.longTermRecall && Array.isArray(toolResult.markdown_items)) {
    for (const markdownItem of toolResult.markdown_items) {
      if (typeof markdownItem === 'string' && markdownItem.trim()) {
        inputItems.push(buildAssistantCommentaryInputItem([markdownItem.trim()]));
      }
    }
  }
  if (toolCall.name === TOOL_NAMES.imageTask) {
    const statusText = typeof toolResult.status_text === 'string' ? toolResult.status_text.trim() : '';
    inputItems.push(buildAssistantCommentaryInputItem([
      `<system_reminder>${statusText ? `[后台任务状态]\n${statusText}` : '后台图片任务已经登记。'}\n\n这还不等于已经对聊天对象说过话；如果这一轮仍该自然接话，就继续收口，不要把登记任务本身当成已经回复。</system_reminder>`
    ]));
  }
  return {
    inputItems,
    finishResult: null,
    forcedVisibleReply: null
  };
}

function extractPendingImageTaskStatus(loopInput: OpenResponseInputItem[]) {
  return extractPendingImageTaskState(loopInput)?.statusText ?? null;
}

function extractPendingImageTaskState(loopInput: OpenResponseInputItem[]) {
  const imageTaskCallIds = new Set<string>();
  for (const item of loopInput) {
    if (item.type === 'function_call' && item.name === TOOL_NAMES.imageTask) {
      imageTaskCallIds.add(item.call_id);
    }
  }

  for (let index = loopInput.length - 1; index >= 0; index -= 1) {
    const item = loopInput[index];
    if (item.type !== 'function_call_output' || !imageTaskCallIds.has(item.call_id)) {
      continue;
    }
    const parsed = parseReplayJsonObject(item.output);
    if (!parsed || parsed.queued !== true) {
      continue;
    }
    const statusText = typeof parsed.status_text === 'string' ? parsed.status_text.trim() : '';
    const xiaoniOs = typeof parsed.xiaoni_os === 'string' && parsed.xiaoni_os.trim()
      ? parsed.xiaoni_os.trim()
      : null;
    return {
      statusText: statusText || '后台图片任务已经登记。',
      xiaoniOs
    };
  }

  return null;
}

function countPriorSilentFinishCalls(loopInput: OpenResponseInputItem[]) {
  let count = 0;
  for (const item of loopInput) {
    if (item.type === 'function_call' && isSilentFinishToolName(item.name)) {
      count += 1;
    }
  }
  return count;
}

type ReplayableModelOutput =
  | {
      type: 'tool_call';
      inputItem: OpenResponseInputItem & {
        type: 'function_call';
        call_id: string;
        name: string;
        arguments: string;
      };
      toolCall: AgentToolCall;
    }
  | {
      type: 'assistant_message';
      inputItem: OpenResponseInputItem;
    }
  | {
      type: 'reasoning';
      inputItem: {
        type: 'reasoning';
        content?: string;
        summary?: string | Array<Record<string, unknown>>;
        encrypted_content?: string;
      };
    };

function isReplayableToolCall(item: ReplayableModelOutput): item is Extract<ReplayableModelOutput, { type: 'tool_call' }> {
  return item.type === 'tool_call';
}

export class AgentLoopService {
  constructor(
    private readonly store: RuntimeStore,
    private readonly promptResolver: AgentPromptResolver = new AgentPromptService()
  ) {}

  async processQueueMessage(queueMessage: QueueMessageRecord) {
    const startedAt = Date.now();
    const activeQueueMessage = materializePresenceTickQueueMessage(queueMessage);
    const payload = activeQueueMessage.payload;
    const inboundContext = payload.inboundContext;
    const sessionIds = resolveSessionTargets(payload);
    const jobId = await this.store.createLlmJob({
      traceId: payload.traceId,
      sessionId: payload.sessionKey,
      agentType: 'chat_bot',
      metadata: {
        run_id: queueMessage.id,
        batch_id: queueMessage.batchId,
        queue_message_ids: queueMessage.queueMessageIds,
        source: payload.source
      }
    });

    let conversationId: number | null = null;
    let turnsExecuted = 0;
    let deliveredMessages: DeliveredAssistantMessage[] = [];
    const deliveredFingerprints = new Set<string>();
    let persistedXiaoniOs: string | null = null;
    let persistedPendingShare: string | null = null;
    let historyCount = 0;
    let runtimePrompt: ResolvedAgentRuntimePrompt | null = null;
    let storedFeedbackReflectionIds: number[] = [];
    let unreadMeaningArtifact: Record<string, unknown> | null = null;
    let innerReactionArtifact: Record<string, unknown> | null = null;
    let presenceContext: RuntimePresenceContext | null = null;
    let runtimeIdentityFacts: RuntimeIdentityFactProjection[] = [];
    const contextBudgetTurns: ContextBudgetTurnRecord[] = [];
    let budgetPlan: ContextBudgetPlan = {
      requestInput: [],
      retainedHistory: [],
      runtimeIdentityFacts: [],
      readCutoffAfterConversationId: null,
      previousReadCutoffAfterConversationId: null,
      estimatedInputTokens: 0,
      contextWindowTokens: null,
      targetBudgetTokens: null,
      hardBudgetTokens: null,
      tokenizerEncoding: null,
      tokenizerSource: null,
      cutoffRecomputed: false,
      contextSummary: null,
      pendingProactiveShare: null,
      pendingProactiveShareAge: 0
    };

    await this.store.logTimelineEvent({
      traceId: payload.traceId,
      eventType: 'queue',
      eventName: 'dequeue',
      eventPhase: 'start',
      metadata: { run_id: queueMessage.id, batch_id: queueMessage.batchId, queue_message_ids: queueMessage.queueMessageIds, worker_id: agentConfig.workerId }
    });
    await this.store.logTimelineEvent({
      traceId: payload.traceId,
      eventType: 'queue',
      eventName: 'dequeue',
      eventPhase: 'end',
      metadata: { run_id: queueMessage.id, batch_id: queueMessage.batchId, queue_message_ids: queueMessage.queueMessageIds, worker_id: agentConfig.workerId }
    });
    await this.store.logTimelineEvent({
      traceId: payload.traceId,
      eventType: 'decision',
      eventName: 'agent_run',
      eventPhase: 'start',
      metadata: { run_id: queueMessage.id, batch_id: queueMessage.batchId }
    });

    try {
      if (!isPresenceTickPayload(payload)) {
        const recorder = (this.store as RuntimeStore & {
          recordPresenceUserMessage?: RuntimeStore['recordPresenceUserMessage'];
        }).recordPresenceUserMessage;
        if (typeof recorder === 'function') {
          await recorder.call(this.store, payload).catch((error) => {
            moduleLogger.warn('Failed to record presence user-message anchor', {
              traceId: payload.traceId,
              error: error instanceof Error ? error.message : String(error)
            });
          });
        }
      }
      const history = await this.store.listRecentTurns({
        userId: sessionIds.userId,
        groupId: sessionIds.groupId,
        afterConversationId: null
      });
      historyCount = history.length;

      runtimePrompt = await this.promptResolver.resolveForQueueMessage(payload);
      await this.ensureRuntimeIdentityRoot(payload, runtimePrompt);
      runtimeIdentityFacts = await this.loadRuntimeIdentityFacts(payload);
      const baseDeveloperContextBlock = await this.buildDeveloperContextBlock(payload);
      {
        const presenceLoader = (this.store as RuntimeStore & {
          buildPresenceContext?: RuntimeStore['buildPresenceContext'];
        }).buildPresenceContext;
        presenceContext = typeof presenceLoader === 'function'
          ? await presenceLoader.call(this.store, payload).catch((error) => {
              moduleLogger.warn('Failed to build presence context', {
                traceId: payload.traceId,
                error: error instanceof Error ? error.message : String(error)
              });
              return null;
            })
          : null;
      }
      const developerContextBlock = [
        baseDeveloperContextBlock,
        presenceContext?.block || null
      ].filter((part): part is string => Boolean(part && part.trim())).join('\n\n') || null;
      let loopContinuation: OpenResponseInputItem[] = [];
      budgetPlan = await this.buildContextBudgetPlan({
        history,
        queueMessage: payload,
        runtimePrompt,
        loopContinuation,
        runtimeIdentityFacts,
        developerContextBlock
      });
      // Compute evicted turns once at the start: turns pushed out by the new cutoff that
      // weren't already excluded by the previous cutoff.
      const evictedTurns: ConversationTurn[] = budgetPlan.cutoffRecomputed && budgetPlan.readCutoffAfterConversationId !== null
        ? history.filter((t) =>
            t.id <= budgetPlan.readCutoffAfterConversationId! &&
            (budgetPlan.previousReadCutoffAfterConversationId === null || t.id > budgetPlan.previousReadCutoffAfterConversationId)
          )
        : [];
      let requestInput = budgetPlan.requestInput;
      let finishResult: Record<string, unknown> | null = null;
      let deliveryState = await this.store.getRunDeliveryState(queueMessage.id);

      for (let turn = 1; !finishResult && turn <= agentConfig.maxTurns; turn += 1) {
        turnsExecuted = turn;
        if (turn > 1) {
          budgetPlan = await this.buildContextBudgetPlan({
            history,
            queueMessage: payload,
            runtimePrompt,
            loopContinuation,
            runtimeIdentityFacts,
            developerContextBlock
          });
          requestInput = budgetPlan.requestInput;
        }
        const turnBudgetRecord: ContextBudgetTurnRecord = {
          turn,
          estimatedInputTokens: budgetPlan.estimatedInputTokens,
          actualInputTokens: null,
          actualOutputTokens: null,
          actualTotalTokens: null,
          cachedInputTokens: null,
          reasoningTokens: null,
          processingTimeMs: null,
          readHistoryCount: budgetPlan.retainedHistory.length,
          readCutoffAfterConversationId: budgetPlan.readCutoffAfterConversationId,
          contextWindowTokens: budgetPlan.contextWindowTokens,
          targetBudgetTokens: budgetPlan.targetBudgetTokens,
          hardBudgetTokens: budgetPlan.hardBudgetTokens,
          tokenizerEncoding: budgetPlan.tokenizerEncoding,
          tokenizerSource: budgetPlan.tokenizerSource,
          cutoffRecomputed: budgetPlan.cutoffRecomputed
        };
        contextBudgetTurns.push(turnBudgetRecord);
        const modelResult = await this.executeAgentTurn(
          requestInput,
          payload,
          payload.traceId,
          turn,
          runtimePrompt
        );
        attachActualUsageToTurnBudget(turnBudgetRecord, modelResult);
        const replayableOutputs = extractReplayableModelOutputs(modelResult.canonical_response);
        const hasToolCall = replayableOutputs.some((item) => item.type === 'tool_call');

        if (!hasToolCall) {
          throw new Error('Agent did not emit any tool call before finish');
        }

        for (const replayItem of replayableOutputs) {
          loopContinuation.push(replayItem.inputItem);
          if (!isReplayableToolCall(replayItem)) {
            continue;
          }
          const toolCall = replayItem.toolCall;
          const logId = await this.store.createToolExecutionLog({
            traceId: payload.traceId,
            jobId,
            agentTurn: turn,
            llmCallId: modelResult.llm_call_id || toolCall.callId,
            toolCallId: toolCall.callId,
            toolName: toolCall.name,
            methodId: toolCall.name,
            arguments: toolCall.args,
            sideEffect: isSpeakingToolName(toolCall.name)
          });

          try {
            const duplicateOutbound = buildDuplicateOutboundSuppression(toolCall);
            if (isSpeakingToolName(toolCall.name)) {
              deliveryState = await this.store.getRunDeliveryState(queueMessage.id);
            }
            if (isSpeakingToolName(toolCall.name) && deliveryState.deliveryPhase !== 'reasoning_open') {
              const duplicateSuppressed = Boolean(duplicateOutbound && deliveredFingerprints.has(duplicateOutbound.fingerprint));
              const blockReason = 'Outbound delivery already committed earlier in this run.';
              const toolResult = {
                finished: true,
                blocked_transition: true,
                duplicate_suppressed: duplicateSuppressed,
                message_type: duplicateOutbound?.payload.messageType ?? null,
                blocked_messages: duplicateOutbound?.payload.messages ?? [],
                mention_user_ids: duplicateOutbound?.payload.mentionUserIds ?? [],
                blocked_reason: 'already_delivery_committed',
                reason: blockReason,
                outcome: 'blocked_transition',
                no_reply: false
              };
              await this.store.markRunDeliveryBlocked(queueMessage.id, blockReason);
              moduleLogger.warn('Blocked outbound tool call after delivery commit in agent run', {
                traceId: payload.traceId,
                runId: queueMessage.id,
                agentTurn: turn,
                toolName: toolCall.name,
                messages: duplicateOutbound?.payload.messages ?? [],
                reason: blockReason
              });
              await this.store.completeToolExecutionLog(logId, {
                status: 'completed',
                result: toolResult
              });
              await this.store.logTimelineEvent({
                traceId: payload.traceId,
                eventType: 'decision',
                eventName: 'blocked_transition',
                eventPhase: null,
                metadata: {
                  tool_name: toolCall.name,
                  blocked_reason: 'already_delivery_committed',
                  duplicate_suppressed: duplicateSuppressed
                }
              });
              deliveryState = await this.store.getRunDeliveryState(queueMessage.id);
              finishResult = toolResult;
              break;
            }

            const rawToolResult = await this.executeTool(toolCall, payload);
            const toolResult = isSilentFinishToolName(toolCall.name)
              ? {
                  ...rawToolResult,
                  no_reply: deliveredMessages.length === 0
                }
              : rawToolResult;
            if (typeof toolResult?.xiaoni_os === 'string' && toolResult.xiaoni_os.trim().length > 0) {
              persistedXiaoniOs = toolResult.xiaoni_os.trim();
            }
            if (typeof toolResult?.pending_share === 'string' && toolResult.pending_share.trim().length > 0) {
              persistedPendingShare = toolResult.pending_share.trim();
            }
            if (toolCall.name === TOOL_NAMES.unreadMeaning) {
              unreadMeaningArtifact = toolResult;
            }
            if (toolCall.name === TOOL_NAMES.innerReaction) {
              innerReactionArtifact = toolResult;
            }
            await this.store.completeToolExecutionLog(logId, {
              status: 'completed',
              result: toolResult
            });

            if (isSpeakingToolName(toolCall.name) && extractSentMessages(toolResult).length > 0) {
              await this.store.markRunDeliveryCommitted(queueMessage.id);
              await this.store.logTimelineEvent({
                traceId: payload.traceId,
                eventType: 'decision',
                eventName: 'delivery_commit',
                eventPhase: null,
                metadata: {
                  tool_name: toolCall.name
                }
              });
              deliveryState = await this.store.getRunDeliveryState(queueMessage.id);
              const deliveredFingerprint = buildOutboundFingerprintFromToolResult(toolResult);
              if (deliveredFingerprint) {
                deliveredFingerprints.add(deliveredFingerprint);
              }
              deliveredMessages.push(...extractDeliveredAssistantMessages(toolResult));
            }

            const continuation = applyToolResultToLoopInput(toolCall, toolResult, {
              loopInput: requestInput,
              speakingToolName: payload.chatType === 'direct' ? TOOL_NAMES.privateReply : TOOL_NAMES.groupReply,
              hasVisibleReply: deliveredMessages.length > 0
            });
            if (continuation.forcedVisibleReply) {
              await this.store.logTimelineEvent({
                traceId: payload.traceId,
                eventType: 'decision',
                eventName: 'forced_visible_reply',
                eventPhase: null,
                metadata: {
                  source_tool_name: toolCall.name,
                  tool_name: continuation.forcedVisibleReply.toolName
                }
              });
              const forcedToolResult = await this.sendMessage(
                continuation.forcedVisibleReply.toolName === TOOL_NAMES.privateReply ? 'private' : 'group',
                continuation.forcedVisibleReply.args,
                payload
              );
              if (typeof forcedToolResult?.xiaoni_os === 'string' && forcedToolResult.xiaoni_os.trim().length > 0) {
                persistedXiaoniOs = forcedToolResult.xiaoni_os.trim();
              }
              if (typeof forcedToolResult?.pending_share === 'string' && forcedToolResult.pending_share.trim().length > 0) {
                persistedPendingShare = forcedToolResult.pending_share.trim();
              }
              await this.store.markRunDeliveryCommitted(queueMessage.id);
              await this.store.logTimelineEvent({
                traceId: payload.traceId,
                eventType: 'decision',
                eventName: 'delivery_commit',
                eventPhase: null,
                metadata: {
                  tool_name: continuation.forcedVisibleReply.toolName,
                  forced: true
                }
              });
              deliveryState = await this.store.getRunDeliveryState(queueMessage.id);
              const deliveredFingerprint = buildOutboundFingerprintFromToolResult(forcedToolResult);
              if (deliveredFingerprint) {
                deliveredFingerprints.add(deliveredFingerprint);
              }
              deliveredMessages.push(...extractDeliveredAssistantMessages(forcedToolResult));
              finishResult = forcedToolResult;
              break;
            }
            if (continuation.finishResult) {
              finishResult = continuation.finishResult;
              break;
            }
            if (continuation.inputItems.length > 0) {
              loopContinuation.push(...continuation.inputItems);
            }
            requestInput = buildLoopRequestInput({
              history: budgetPlan.retainedHistory,
              queueMessage: payload,
              runtimePrompt,
              loopContinuation,
              runtimeIdentityFacts: budgetPlan.runtimeIdentityFacts
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.store.completeToolExecutionLog(logId, {
              status: 'failed',
              result: {},
              errorMessage: message
            });
            throw error;
          }
        }

        if (finishResult) {
          await this.store.logTimelineEvent({
            traceId: payload.traceId,
            eventType: 'decision',
            eventName: 'finish',
            eventPhase: null,
            metadata: finishResult
          });
          break;
        }

        const monitorReminder = buildToolLoopMonitorReminder(loopContinuation, {
          nextTurn: turn + 1,
          maxTurns: agentConfig.maxTurns
        });
        if (monitorReminder) {
          loopContinuation.push(monitorReminder);
          await this.store.logTimelineEvent({
            traceId: payload.traceId,
            eventType: 'decision',
            eventName: 'tool_loop_monitor',
            eventPhase: null,
            metadata: {
              next_turn: turn + 1,
              max_turns: agentConfig.maxTurns
            }
          }).catch(() => undefined);
        }
      }

      if (!finishResult) {
        throw new Error(`Agent exited without finish after ${turnsExecuted} turns`);
      }

      const sentMessages = deliveredMessages.map((message) => message.content);
      const finalResponse = sentMessages.length > 0 ? sentMessages.join('\n\n') : null;
      const termination = deriveTermination({
        finishResult,
        deliveredMessages,
        errorMessage: null
      });
      conversationId = await this.store.createConversation({
        userId: sessionIds.userId,
        groupId: sessionIds.groupId,
        userMessage: renderConversationInput(payload),
        aiResponse: finalResponse,
        sessionKey: payload.sessionKey,
        transcriptItems: [
          ...buildInboundBatchTranscriptItems(payload),
          ...buildAssistantTranscriptItems({
            queueMessage: payload,
            deliveredMessages,
            completed: true
          }).map((item) => ({
            sessionKey: item.sessionKey,
            role: item.role,
            phase: item.phase,
            content: item.content,
            groupIndex: item.groupIndex,
            itemIndex: item.itemIndex,
            source: item.source,
            deliveryMessageId: item.deliveryMessageId,
            runId: item.runId,
            traceId: item.traceId
          }))
        ],
        responseTimeMs: Date.now() - startedAt,
        status: 'completed',
        modelName: runtimePrompt?.modelName || null,
        traceId: payload.traceId,
        rawRequest: {
          run_id: queueMessage.id,
          batch_id: queueMessage.batchId,
          queue_message_ids: queueMessage.queueMessageIds,
          batch_messages: payload.messages,
          history_count: historyCount,
          retained_history_count: budgetPlan.retainedHistory.length,
          context_budget: {
            context_window_tokens: budgetPlan.contextWindowTokens,
            target_budget_tokens: budgetPlan.targetBudgetTokens,
            hard_budget_tokens: budgetPlan.hardBudgetTokens,
            estimated_input_tokens: budgetPlan.estimatedInputTokens,
            tokenizer_encoding: budgetPlan.tokenizerEncoding,
            tokenizer_source: budgetPlan.tokenizerSource,
            read_cutoff_after_conversation_id: budgetPlan.readCutoffAfterConversationId,
            cutoff_recomputed: budgetPlan.cutoffRecomputed
          },
          prompt: {
            source: runtimePrompt.source,
            prompt_id: runtimePrompt.promptId,
            prompt_name: runtimePrompt.promptName,
            model_name: runtimePrompt.modelName
          },
          retrieved_feedback_reflections: [],
          runtime_identity_facts: runtimeIdentityFacts
        },
        rawResponse: {
          sent_messages: sentMessages,
          xiaoni_os: persistedXiaoniOs,
          loop_stage_artifacts: {
            unread_meaning: unreadMeaningArtifact,
            inner_reaction: innerReactionArtifact
          },
          context_budget_turns: contextBudgetTurns.map(serializeContextBudgetTurnRecord),
          total_turns: turnsExecuted,
          termination_reason: termination.terminationReason,
          finish_reason: termination.finishReason,
          finish_outcome: termination.finishOutcome,
          no_reply: termination.noReply
        }
      });
      if (evictedTurns.length > 0) {
        this.scheduleContextCompressionMemoryWriter({
          queueMessage: payload,
          conversationId,
          evictedTurns,
          runtimePrompt
        });
        this.scheduleContextSummaryWriter({
          queueMessage: payload,
          conversationId,
          evictedTurns,
          existingSummary: budgetPlan.contextSummary,
          runtimePrompt
        });
      }

      await this.recordRuntimeIdentityActivation({
        queueMessage: payload,
        conversationId,
        runtimeIdentityFacts
      });

      await this.store.attachConversationIdToTrace(payload.traceId, conversationId);
      await this.store.completeQueueMessage(queueMessage.id, {
        conversationId,
        result: {
          no_reply: termination.noReply,
          sent_messages: sentMessages,
          xiaoni_os: persistedXiaoniOs,
          stored_feedback_reflection_ids: storedFeedbackReflectionIds,
          total_turns: turnsExecuted,
          finish_result: finishResult,
          termination_reason: termination.terminationReason
        }
      });
      const presenceOutcome = isPresenceTickPayload(payload)
        ? (sentMessages.length > 0 ? 'shared' : 'lurked')
        : (sentMessages.length > 0 ? 'replied' : 'silent');
      if (presenceContext) {
        const sidecarRecorder = (this.store as RuntimeStore & {
          recordPresenceSidecar?: RuntimeStore['recordPresenceSidecar'];
        }).recordPresenceSidecar;
        if (typeof sidecarRecorder === 'function') {
          await sidecarRecorder.call(this.store, {
            queueMessage: payload,
            presenceContext,
            outcome: presenceOutcome
          }).catch((error) => {
            moduleLogger.warn('Failed to record presence sidecar', {
              traceId: payload.traceId,
              error: error instanceof Error ? error.message : String(error)
            });
          });
        }
      }
      if (isPresenceTickPayload(payload)) {
        const proactiveRecorder = (this.store as RuntimeStore & {
          recordPresenceProactiveCompletion?: RuntimeStore['recordPresenceProactiveCompletion'];
        }).recordPresenceProactiveCompletion;
        if (typeof proactiveRecorder === 'function') {
          await proactiveRecorder.call(this.store, payload, presenceOutcome).catch((error) => {
            moduleLogger.warn('Failed to record presence proactive completion', {
              traceId: payload.traceId,
              error: error instanceof Error ? error.message : String(error)
            });
          });
        }
      }
      await this.store.completeAgentRun(queueMessage.id, {
        status: 'completed',
        terminationReason: termination.terminationReason,
        finishReason: termination.finishReason,
        finishOutcome: termination.finishOutcome,
        noReply: termination.noReply,
        finalResponse,
        sentMessages,
        totalTurns: turnsExecuted,
        conversationId
      });
      await this.store.updateLlmJob(jobId, {
        status: 'completed',
        finalResponse,
        totalTurns: turnsExecuted,
        conversationId
      });
      await this.store.logTimelineEvent({
        traceId: payload.traceId,
        eventType: 'decision',
        eventName: 'agent_run',
        eventPhase: 'end',
        conversationId,
        metadata: {
          sent_count: sentMessages.length,
          total_turns: turnsExecuted
        },
        durationMs: Date.now() - startedAt
      });

      moduleLogger.info('Agent queue message processed', {
        traceId: payload.traceId,
        runId: queueMessage.id,
        batchId: queueMessage.batchId,
        conversationId,
        sentCount: sentMessages.length,
        turnsExecuted
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const sentMessages = deliveredMessages.map((item) => item.content);
      const termination = deriveTermination({
        finishResult: null,
        deliveredMessages,
        errorMessage: message,
        error
      });
      conversationId = await this.store.createConversation({
        userId: sessionIds.userId,
        groupId: sessionIds.groupId,
        userMessage: renderConversationInput(payload),
        aiResponse: null,
        sessionKey: payload.sessionKey,
        transcriptItems: [
          ...buildInboundBatchTranscriptItems(payload),
          ...buildAssistantTranscriptItems({
            queueMessage: payload,
            deliveredMessages,
            completed: false
          }).map((item) => ({
            sessionKey: item.sessionKey,
            role: item.role,
            phase: item.phase,
            content: item.content,
            groupIndex: item.groupIndex,
            itemIndex: item.itemIndex,
            source: item.source,
            deliveryMessageId: item.deliveryMessageId,
            runId: item.runId,
            traceId: item.traceId
          }))
        ],
        responseTimeMs: Date.now() - startedAt,
        status: 'failed',
        errorReason: message,
        modelName: runtimePrompt?.modelName || null,
        traceId: payload.traceId,
        rawRequest: {
          run_id: queueMessage.id,
          batch_id: queueMessage.batchId,
          queue_message_ids: queueMessage.queueMessageIds,
          batch_messages: payload.messages,
          history_count: historyCount,
          retained_history_count: budgetPlan.retainedHistory.length,
          context_budget: {
            context_window_tokens: budgetPlan.contextWindowTokens,
            target_budget_tokens: budgetPlan.targetBudgetTokens,
            hard_budget_tokens: budgetPlan.hardBudgetTokens,
            estimated_input_tokens: budgetPlan.estimatedInputTokens,
            tokenizer_encoding: budgetPlan.tokenizerEncoding,
            tokenizer_source: budgetPlan.tokenizerSource,
            read_cutoff_after_conversation_id: budgetPlan.readCutoffAfterConversationId,
            cutoff_recomputed: budgetPlan.cutoffRecomputed
          },
          prompt: {
            source: runtimePrompt?.source || null,
            prompt_id: runtimePrompt?.promptId || null,
            prompt_name: runtimePrompt?.promptName || null,
            model_name: runtimePrompt?.modelName || null
          }
        },
        rawResponse: {
          sent_messages: sentMessages,
          xiaoni_os: null,
          context_budget_turns: contextBudgetTurns.map(serializeContextBudgetTurnRecord),
          total_turns: turnsExecuted,
          termination_reason: termination.terminationReason,
          no_reply: termination.noReply
        }
      });
      await this.store.attachConversationIdToTrace(payload.traceId, conversationId);
      await this.store.failQueueMessage(queueMessage.id, message, conversationId);
      if (presenceContext) {
        const sidecarRecorder = (this.store as RuntimeStore & {
          recordPresenceSidecar?: RuntimeStore['recordPresenceSidecar'];
        }).recordPresenceSidecar;
        if (typeof sidecarRecorder === 'function') {
          await sidecarRecorder.call(this.store, {
            queueMessage: payload,
            presenceContext,
            outcome: sentMessages.length > 0 ? 'replied' : 'silent'
          }).catch((sidecarError) => {
            moduleLogger.warn('Failed to record failed-run presence sidecar', {
              traceId: payload.traceId,
              error: sidecarError instanceof Error ? sidecarError.message : String(sidecarError)
            });
          });
        }
      }
      await this.store.completeAgentRun(queueMessage.id, {
        status: 'failed',
        terminationReason: termination.terminationReason,
        noReply: termination.noReply,
        finalResponse: sentMessages.length > 0 ? sentMessages.join('\n\n') : null,
        sentMessages,
        totalTurns: turnsExecuted,
        errorMessage: message,
        conversationId
      });
      await this.store.updateLlmJob(jobId, {
        status: 'failed',
        errorMessage: message,
        totalTurns: turnsExecuted,
        conversationId,
        finalResponse: sentMessages.length > 0 ? sentMessages.join('\n\n') : null
      });
      await this.store.logTimelineEvent({
        traceId: payload.traceId,
        eventType: 'decision',
        eventName: 'agent_run',
        eventPhase: 'end',
        conversationId,
        metadata: {
          error_message: message,
          total_turns: turnsExecuted,
          termination_reason: termination.terminationReason
        },
        durationMs: Date.now() - startedAt
      });
      moduleLogger.error('Agent queue message failed', {
        traceId: payload.traceId,
        runId: queueMessage.id,
        batchId: queueMessage.batchId,
        conversationId,
        error: message
      });
    }
  }

  private async buildDeveloperContextBlock(queueMessage: QueueMessageRecord['payload']): Promise<string | null> {
    const parts: string[] = [];

    if (agentConfig.worldNarrative && agentConfig.worldNarrative.trim()) {
      parts.push(`<world_narrative>\n${agentConfig.worldNarrative.trim()}\n</world_narrative>`);
    }

    const speakerQq = queueMessage.senderId != null && Number.isFinite(Number(queueMessage.senderId))
      ? Number(queueMessage.senderId)
      : null;
    const speakerName = (queueMessage.inboundContext as { SenderName?: string })?.SenderName?.trim() || null;

    if (speakerQq !== null && speakerQq > 0) {
      const trustLoader = (this.store as RuntimeStore & {
        getSpeakerTrustLevel?: RuntimeStore['getSpeakerTrustLevel'];
      }).getSpeakerTrustLevel;

      let trustLevel: 'L1' | 'L2' | 'L3' | 'L4' = 'L1';
      if (typeof trustLoader === 'function') {
        trustLevel = await trustLoader.call(this.store, XIAONI_IDENTITY_KEY, speakerQq).catch(() => 'L1' as const);
      }

      const personaText = agentConfig.xiaoniPersonaLayers[trustLevel];
      const nameDisplay = speakerName ? `${speakerName}（QQ:${speakerQq}）` : `QQ:${speakerQq}`;
      parts.push(
        `<current_relationship>\n本次发言者：${nameDisplay}\n当前关系层级：${trustLevel}\n当前可开放的自己：${personaText}\n</current_relationship>`
      );
    }

    const isGroupChat = queueMessage.sessionKey && queueMessage.sessionKey !== String(queueMessage.senderId);
    if (isGroupChat) {
      const activityLoader = (this.store as RuntimeStore & {
        getRecentGroupActivity?: RuntimeStore['getRecentGroupActivity'];
      }).getRecentGroupActivity;

      if (typeof activityLoader === 'function') {
        const activity = await activityLoader.call(this.store, queueMessage.sessionKey).catch(() => ({ activeSenderCount: 0, recentMessageCount: 0 }));
        const density: 'low' | 'medium' | 'high' =
          activity.recentMessageCount > 10 ? 'high' :
          activity.recentMessageCount >= 3 ? 'medium' : 'low';
        parts.push(
          `<current_scene>\n活跃人数（近10分钟）：${activity.activeSenderCount}\n消息密度（近5分钟）：${density}（${activity.recentMessageCount}条）\n</current_scene>`
        );
      }
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
  }

  private async loadRuntimeIdentityFacts(queueMessage: QueueMessageRecord['payload']): Promise<RuntimeIdentityFactProjection[]> {
    const loader = (this.store as RuntimeStore & {
      listAcceptedIdentityFacts?: RuntimeStore['listAcceptedIdentityFacts'];
    }).listAcceptedIdentityFacts;
    if (typeof loader !== 'function') {
      return [];
    }

    try {
      const facts = await loader.call(this.store, {
        identityKey: XIAONI_IDENTITY_KEY,
        status: 'active',
        limit: 12
      });
      return selectRuntimeIdentityFacts({
        facts,
        queueMessage,
        limit: RUNTIME_IDENTITY_FACT_LIMIT
      });
    } catch (error) {
      moduleLogger.warn('Failed to load runtime identity facts', {
        traceId: queueMessage.traceId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  private async ensureRuntimeIdentityRoot(
    queueMessage: QueueMessageRecord['payload'],
    runtimePrompt: ResolvedAgentRuntimePrompt
  ) {
    const snapshot = typeof runtimePrompt.identityGenesisSnapshot === 'string'
      ? runtimePrompt.identityGenesisSnapshot.trim()
      : runtimePrompt.systemPrompt.trim();
    if (!snapshot) {
      return;
    }

    const ensureRoot = (this.store as RuntimeStore & {
      ensureXiaoniIdentityRoot?: RuntimeStore['ensureXiaoniIdentityRoot'];
    }).ensureXiaoniIdentityRoot;
    if (typeof ensureRoot !== 'function') {
      return;
    }

    try {
      await ensureRoot.call(this.store, {
        identityKey: XIAONI_IDENTITY_KEY,
        sourcePromptId: runtimePrompt.promptId,
        systemInstructionSnapshot: snapshot,
        createdBy: 'agent-service',
        metadata: {
          prompt_name: runtimePrompt.promptName,
          prompt_source: runtimePrompt.source,
          trace_id: queueMessage.traceId,
          run_id: queueMessage.runId,
          canonical_identity_key: XIAONI_IDENTITY_KEY
        }
      });
    } catch (error) {
      moduleLogger.warn('Failed to ensure Xiaoni identity root', {
        traceId: queueMessage.traceId,
        promptId: runtimePrompt.promptId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async recordRuntimeIdentityActivation(params: {
    queueMessage: QueueMessageRecord['payload'];
    conversationId: number;
    runtimeIdentityFacts: RuntimeIdentityFactProjection[];
  }) {
    if (params.runtimeIdentityFacts.length === 0) {
      return;
    }
    const recorder = (this.store as RuntimeStore & {
      recordRuntimeIdentityActivationTrace?: RuntimeStore['recordRuntimeIdentityActivationTrace'];
    }).recordRuntimeIdentityActivationTrace;
    if (typeof recorder !== 'function') {
      return;
    }

    try {
      await recorder.call(this.store, {
        identityKey: XIAONI_IDENTITY_KEY,
        runId: params.queueMessage.runId,
        traceId: params.queueMessage.traceId,
        conversationId: params.conversationId,
        sceneFingerprint: buildIdentitySceneFingerprint(params.queueMessage),
        cueSummary: params.queueMessage.bodyForAgent,
        activatedRefs: params.runtimeIdentityFacts.map((fact) => ({
          accepted_fact_id: fact.id,
          fact_key: fact.factKey,
          fact_type: fact.factType,
          confidence: fact.confidence
        })),
        suppressedRefs: [],
        selectedSkillRef: 'accepted_identity_facts',
        activationReason: 'accepted identity facts were projected into the runtime input',
        metadata: {
          session_key: params.queueMessage.sessionKey,
          chat_type: params.queueMessage.chatType
        }
      });
    } catch (error) {
      moduleLogger.warn('Failed to record runtime identity activation trace', {
        traceId: params.queueMessage.traceId,
        conversationId: params.conversationId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private scheduleContextCompressionMemoryWriter(params: ContextCompressionMemoryParams) {
    void this.runContextCompressionMemoryWriter(params).catch((error) => {
      const traceId = `${params.queueMessage.traceId}:subagent:${CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE}`;
      moduleLogger.warn('Context compression memory writer failed', {
        traceId: params.queueMessage.traceId,
        conversationId: params.conversationId,
        evictedTurnCount: params.evictedTurns.length,
        error: error instanceof Error ? error.message : String(error)
      });
      void this.store.logTimelineEvent({
        traceId,
        eventType: 'subagent',
        eventName: CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE,
        eventPhase: 'end',
        conversationId: params.conversationId,
        metadata: {
          termination_reason: 'failed',
          parent_trace_id: params.queueMessage.traceId,
          error: error instanceof Error ? error.message : String(error)
        }
      }).catch(() => undefined);
    });
  }

  private scheduleContextSummaryWriter(params: ContextSummaryParams) {
    void this.runContextSummaryWriter(params).catch((error) => {
      moduleLogger.warn('Context summary writer failed', {
        traceId: params.queueMessage.traceId,
        conversationId: params.conversationId,
        evictedTurnCount: params.evictedTurns.length,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  private async runContextSummaryWriter(params: ContextSummaryParams) {
    const summaryUpserter = (this.store as RuntimeStore & {
      upsertSessionContextSummary?: RuntimeStore['upsertSessionContextSummary'];
    }).upsertSessionContextSummary;
    if (typeof summaryUpserter !== 'function') return;

    const baseInput = buildContextSummaryWriterInput({
      evictedTurns: params.evictedTurns,
      existingSummary: params.existingSummary
    });
    const traceId = `${params.queueMessage.traceId}:subagent:${CONTEXT_SUMMARY_SUBAGENT_TYPE}`;
    const promptCacheKey = buildSubagentPromptCacheKey({
      queueMessage: params.queueMessage,
      subagentType: CONTEXT_SUMMARY_SUBAGENT_TYPE
    });
    const canonicalRequest = buildSummaryWriterRequest(
      params.runtimePrompt.modelName,
      baseInput,
      {
        metadata: buildFeedbackMemorySubagentTurnMetadata({
          queueMessage: params.queueMessage,
          runtimePrompt: params.runtimePrompt,
          conversationId: params.conversationId,
          subagentTraceId: traceId,
          turn: 1
        }),
        promptCacheKey
      }
    );

    const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/agent/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trace_id: traceId,
        agent_turn: 1,
        agent_type: CONTEXT_SUMMARY_SUBAGENT_TYPE,
        prompt_name: `${params.runtimePrompt.promptName}:${CONTEXT_SUMMARY_SUBAGENT_TYPE}`,
        model: params.runtimePrompt.modelName,
        parameters: buildMainAgentParameters(params.runtimePrompt.parameters as Record<string, unknown> | undefined),
        canonicalRequest
      })
    });

    const responsePayload = await response.json() as ProviderAgentResponse;
    if (!response.ok || !responsePayload.success) {
      moduleLogger.warn('Context summary writer API call failed', {
        traceId,
        status: response.status,
        error: responsePayload.error
      });
      return;
    }

    const replayableOutputs = extractReplayableModelOutputs(responsePayload.canonical_response);
    const assistantText = replayableOutputs
      .filter((item): item is Extract<ReplayableModelOutput, { type: 'assistant_message' }> => item.type === 'assistant_message')
      .map((item) => extractMessageText(item.inputItem))
      .filter(Boolean)
      .join('\n')
      .trim();
    const summary = parseContextSummaryWriterOutput(assistantText);
    if (!summary?.hasContent || !summary.summaryText) return;

    await summaryUpserter.call(this.store, {
      sessionKey: params.queueMessage.sessionKey,
      contextSummary: summary.summaryText
    });

    moduleLogger.info('Context summary updated', {
      traceId,
      conversationId: params.conversationId,
      evictedTurnCount: params.evictedTurns.length,
      summaryLength: summary.summaryText.length
    });
  }

  private async runContextCompressionMemoryWriter(params: ContextCompressionMemoryParams) {
    const reflectionCreator = (this.store as RuntimeStore & {
      createFeedbackReflection?: RuntimeStore['createFeedbackReflection'];
    }).createFeedbackReflection;
    const stateGetter = (this.store as RuntimeStore & {
      getFeedbackLearningState?: RuntimeStore['getFeedbackLearningState'];
    }).getFeedbackLearningState;
    const stateUpserter = (this.store as RuntimeStore & {
      upsertFeedbackLearningState?: RuntimeStore['upsertFeedbackLearningState'];
    }).upsertFeedbackLearningState;
    const identityCandidateAppender = (this.store as RuntimeStore & {
      appendIdentityChangeCandidate?: RuntimeStore['appendIdentityChangeCandidate'];
    }).appendIdentityChangeCandidate;
    const acceptedIdentityFactCreator = (this.store as RuntimeStore & {
      createAcceptedIdentityFact?: RuntimeStore['createAcceptedIdentityFact'];
    }).createAcceptedIdentityFact;

    if (typeof reflectionCreator !== 'function' || typeof stateUpserter !== 'function') {
      return;
    }

    const baseInput = buildContextCompressionFeedbackWriterInput({
      evictedTurns: params.evictedTurns,
      runtimePrompt: params.runtimePrompt
    });
    const traceId = `${params.queueMessage.traceId}:subagent:${CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE}`;
    const promptCacheKey = buildSubagentPromptCacheKey({
      queueMessage: params.queueMessage,
      subagentType: CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE
    });
    const evidence = buildContextCompressionFeedbackWriterEvidence({
      evictedTurns: params.evictedTurns
    });
    let loopContinuation: OpenResponseInputItem[] = [];
    let persistedReflectionId: number | null = null;
    let activeLearningKey = '';
    let activeLearningScope = '';

    await this.store.logTimelineEvent({
      traceId,
      eventType: 'subagent',
      eventName: CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE,
      eventPhase: 'start',
      conversationId: params.conversationId,
      metadata: {
        parent_trace_id: params.queueMessage.traceId,
        parent_run_id: params.queueMessage.runId,
        evicted_turn_count: params.evictedTurns.length,
        evicted_turn_ids: params.evictedTurns.map((t) => t.id)
      }
    }).catch(() => undefined);

    for (let turn = 1; turn <= 3; turn += 1) {
      const canonicalRequest = buildFeedbackWriterRequest(
        params.runtimePrompt.modelName,
        [...baseInput, ...loopContinuation],
        {
          metadata: buildFeedbackMemorySubagentTurnMetadata({
            queueMessage: params.queueMessage,
            runtimePrompt: params.runtimePrompt,
            conversationId: params.conversationId,
            subagentTraceId: traceId,
            turn
          }),
          promptCacheKey,
          mode: 'durable_lessons'
        }
      );
      const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/agent/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trace_id: traceId,
          agent_turn: turn,
          agent_type: CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE,
          prompt_name: `${params.runtimePrompt.promptName}:${CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE}`,
          model: params.runtimePrompt.modelName,
          parameters: buildMainAgentParameters(params.runtimePrompt.parameters as Record<string, unknown> | undefined),
          canonicalRequest
        })
      });

      const responsePayload = await response.json() as ProviderAgentResponse;
      if (!response.ok || !responsePayload.success) {
        throw new Error(responsePayload.error || `Context compression memory writer failed with ${response.status}`);
      }

      const replayableOutputs = extractReplayableModelOutputs(responsePayload.canonical_response);
      const toolOutput = replayableOutputs.find(isReplayableToolCall);
      if (!toolOutput) {
        await this.store.logTimelineEvent({
          traceId,
          eventType: 'subagent',
          eventName: CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE,
          eventPhase: 'end',
          conversationId: params.conversationId,
          metadata: {
            termination_reason: 'no_tool_call',
            persisted_reflection_id: persistedReflectionId
          }
        }).catch(() => undefined);
        return;
      }

      const toolResult = await this.executeFeedbackWriterTool(toolOutput.toolCall, {
        queueMessage: params.queueMessage,
        conversationId: params.conversationId,
        evidence,
        persistedReflectionId,
        activeLearningKey,
        activeLearningScope,
        stateGetter,
        reflectionCreator,
        stateUpserter,
        identityCandidateAppender,
        acceptedIdentityFactCreator,
        mode: 'durable_lessons'
      });

      if (typeof (toolResult as any).reflection_id === 'number') {
        persistedReflectionId = (toolResult as any).reflection_id;
      }
      if (typeof (toolResult as any).learning_key === 'string') {
        activeLearningKey = (toolResult as any).learning_key;
      }
      if (typeof (toolResult as any).learning_scope === 'string') {
        activeLearningScope = (toolResult as any).learning_scope;
      }

      const continuation = applyToolResultToLoopInput(toolOutput.toolCall, toolResult);
      if (continuation.finishResult) {
        await this.store.logTimelineEvent({
          traceId,
          eventType: 'subagent',
          eventName: CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE,
          eventPhase: 'end',
          conversationId: params.conversationId,
          metadata: {
            termination_reason: 'tool_finished',
            persisted_reflection_id: persistedReflectionId,
            active_learning_key: activeLearningKey || null,
            active_learning_scope: activeLearningScope || null
          }
        }).catch(() => undefined);
        return;
      }
      loopContinuation.push(...replayableOutputs.map((item) => item.inputItem), ...continuation.inputItems);
    }

    await this.store.logTimelineEvent({
      traceId,
      eventType: 'subagent',
      eventName: CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE,
      eventPhase: 'end',
      conversationId: params.conversationId,
      metadata: {
        termination_reason: 'max_turns',
        persisted_reflection_id: persistedReflectionId,
        active_learning_key: activeLearningKey || null,
        active_learning_scope: activeLearningScope || null
      }
    }).catch(() => undefined);
  }

  private scheduleFeedbackMemorySubagent(params: FeedbackMemorySubagentParams) {
    void this.runFeedbackMemorySubagent(params).catch((error) => {
      const traceId = `${params.queueMessage.traceId}:subagent:${FEEDBACK_MEMORY_SUBAGENT_TYPE}`;
      moduleLogger.warn('Feedback memory subagent failed', {
        traceId: params.queueMessage.traceId,
        conversationId: params.conversationId,
        error: error instanceof Error ? error.message : String(error)
      });
      void this.store.logTimelineEvent({
        traceId,
        eventType: 'subagent',
        eventName: FEEDBACK_MEMORY_SUBAGENT_TYPE,
        eventPhase: 'end',
        conversationId: params.conversationId,
        metadata: {
          termination_reason: 'failed',
          parent_trace_id: params.queueMessage.traceId,
          error: error instanceof Error ? error.message : String(error)
        }
      }).catch(() => undefined);
    });
  }

  private async runFeedbackMemorySubagent(params: FeedbackMemorySubagentParams) {
    const traceId = `${params.queueMessage.traceId}:subagent:${FEEDBACK_MEMORY_SUBAGENT_TYPE}`;

    await this.store.logTimelineEvent({
      traceId,
      eventType: 'subagent',
      eventName: FEEDBACK_MEMORY_SUBAGENT_TYPE,
      eventPhase: 'start',
      conversationId: params.conversationId,
      metadata: {
        parent_trace_id: params.queueMessage.traceId,
        parent_run_id: params.queueMessage.runId,
        parent_agent_type: 'chat_bot',
        subagent_type: FEEDBACK_MEMORY_SUBAGENT_TYPE
      }
    }).catch(() => undefined);

    await this.store.logTimelineEvent({
      traceId,
      eventType: 'subagent',
      eventName: FEEDBACK_MEMORY_SUBAGENT_TYPE,
      eventPhase: 'end',
      conversationId: params.conversationId,
      metadata: {
        termination_reason: 'disabled_feedback_episode_tool_removed',
        parent_trace_id: params.queueMessage.traceId,
        parent_run_id: params.queueMessage.runId
      }
    }).catch(() => undefined);
  }

  private async executeFeedbackWriterTool(
    toolCall: AgentToolCall,
    deps: {
      queueMessage: QueueMessageRecord['payload'];
      conversationId: number;
      evidence?: FeedbackWriterEvidence;
      persistedReflectionId: number | null;
      activeLearningKey: string;
      activeLearningScope: string;
      stateGetter?: RuntimeStore['getFeedbackLearningState'];
      reflectionCreator: RuntimeStore['createFeedbackReflection'];
      stateUpserter: RuntimeStore['upsertFeedbackLearningState'];
      identityCandidateAppender?: RuntimeStore['appendIdentityChangeCandidate'];
      acceptedIdentityFactCreator?: RuntimeStore['createAcceptedIdentityFact'];
      mode: FeedbackWriterMode;
    }
  ) {
    const evidence = deps.evidence ?? buildQueueMessageFeedbackWriterEvidence(deps.queueMessage, deps.conversationId);
    const groupId = Number.isFinite(Number(deps.queueMessage.peerId)) ? Number(deps.queueMessage.peerId) : null;

    switch (toolCall.name) {
      case TOOL_NAMES.feedbackReflection: {
        if (deps.mode !== 'durable_lessons') {
          throw new Error(`${TOOL_NAMES.feedbackReflection} is only allowed during context compression`);
        }
        const reflection = parseFeedbackReflectionSynthesis(toolCall.args);
        if (!reflection) {
          throw new Error(`${TOOL_NAMES.feedbackReflection} returned invalid arguments`);
        }
        const currentState = typeof deps.stateGetter === 'function'
          ? await deps.stateGetter.call(this.store, {
              sessionKey: deps.queueMessage.sessionKey,
              groupId,
              scopeType: 'group_self',
              learningKey: reflection.learningKey,
              learningScope: reflection.learningScope
            }).catch(() => null)
          : null;
        const storedReflection = await deps.reflectionCreator.call(this.store, {
          sessionKey: deps.queueMessage.sessionKey,
          groupId,
          sourceUserId: evidence.sourceUserId,
          sourceUserName: evidence.sourceUserName,
          scopeType: 'group_self',
          learningKey: reflection.learningKey,
          learningScope: reflection.learningScope,
          reflectionType: reflection.reflectionType,
          feedbackKind: reflection.feedbackKind,
          confidence: reflection.confidence,
          importanceScore: reflection.importanceScore,
          evidenceWeight: reflection.evidenceWeight,
          stabilityScore: reflection.stabilityScore,
          summaryText: reflection.summaryText,
          retrievalText: reflection.retrievalText,
          embeddingText: reflection.embeddingText,
          sourceMessageIds: evidence.sourceMessageIds,
          sourceEpisodeIds: [],
          sourceConversationId: evidence.sourceConversationId,
          supersedesReflectionId: reflection.supersedeLatest ? (currentState?.latestReflectionId ?? null) : null,
          conflictGroupKey: reflection.conflictGroupKey,
          metadata: {
            trace_id: deps.queueMessage.traceId,
            synthesis_reason: reflection.reason,
            writer_source: evidence.writerSource,
            ...evidence.metadata
          }
        });
        let identityCandidateId: number | null = null;
        let acceptedIdentityFactId: number | null = null;
        const identityJudge = judgeFeedbackReflectionAsIdentityFact(reflection);
        if (typeof deps.identityCandidateAppender === 'function') {
          const candidateResult = await deps.identityCandidateAppender.call(this.store, {
            identityKey: XIAONI_IDENTITY_KEY,
            candidateType: 'natural_growth',
            proposedBy: evidence.writerSource,
            proposedFrom: 'agent_feedback_reflection',
            claimText: reflection.summaryText,
            afterSummary: reflection.retrievalText,
            status: identityJudge.status,
            judgeStatus: identityJudge.judgeStatus,
            judgeReason: identityJudge.reason,
            judgeRunId: deps.queueMessage.runId,
            judgedAt: new Date(),
            quarantineGroupKey: identityJudge.status === 'quarantined' ? reflection.conflictGroupKey || reflection.learningKey : null,
            metadata: {
              trace_id: deps.queueMessage.traceId,
              source_reflection_id: storedReflection.id,
              learning_key: reflection.learningKey,
              learning_scope: reflection.learningScope,
              reflection_type: reflection.reflectionType,
              feedback_kind: reflection.feedbackKind,
              importance_score: reflection.importanceScore,
              evidence_weight: reflection.evidenceWeight,
              stability_score: reflection.stabilityScore,
              phase1_judge_engine: 'hard_check_feedback_reflection'
            },
            evidenceRefs: [
              {
                sourceType: 'agent_feedback_reflection',
                sourceId: String(storedReflection.id),
                traceId: deps.queueMessage.traceId,
                runId: deps.queueMessage.runId,
                conversationId: evidence.sourceConversationId,
                confidence: reflection.confidence
              }
            ],
            lineageMetadata: {
              judge_status: identityJudge.judgeStatus,
              judge_reason: identityJudge.reason
            }
          }).catch((error) => {
            moduleLogger.warn('Failed to append identity candidate from feedback reflection', {
              traceId: deps.queueMessage.traceId,
              reflectionId: storedReflection.id,
              error: error instanceof Error ? error.message : String(error)
            });
            return null;
          });
          identityCandidateId = Number(candidateResult?.candidate?.id) || null;
        }
        if (identityJudge.status === 'accepted' && identityCandidateId && typeof deps.acceptedIdentityFactCreator === 'function') {
          const factResult = await deps.acceptedIdentityFactCreator.call(this.store, {
            identityKey: XIAONI_IDENTITY_KEY,
            factKey: buildFactKeyFromReflection(reflection),
            factText: reflection.summaryText,
            factType: reflection.reflectionType === 'self_model_update' ? 'self_boundary' : 'social_lesson',
            sourceCandidateId: identityCandidateId,
            confidence: reflection.confidence,
            activationTags: parseStringArray([
              reflection.learningKey,
              reflection.learningScope,
              reflection.feedbackKind,
              deps.queueMessage.senderName || ''
            ]),
            metadata: {
              trace_id: deps.queueMessage.traceId,
              source_reflection_id: storedReflection.id,
              retrieval_text: reflection.retrievalText,
              phase1_judge_reason: identityJudge.reason
            },
            evidenceRefs: [
              {
                sourceType: 'agent_feedback_reflection',
                sourceId: String(storedReflection.id),
                traceId: deps.queueMessage.traceId,
                runId: deps.queueMessage.runId,
                conversationId: evidence.sourceConversationId,
                confidence: reflection.confidence
              }
            ],
            lineageMetadata: {
              source: evidence.writerSource,
              judge_reason: identityJudge.reason
            }
          }).catch((error) => {
            moduleLogger.warn('Failed to create accepted identity fact from feedback reflection', {
              traceId: deps.queueMessage.traceId,
              reflectionId: storedReflection.id,
              identityCandidateId,
              error: error instanceof Error ? error.message : String(error)
            });
            return null;
          });
          acceptedIdentityFactId = Number(factResult?.fact?.id) || null;
        }
        return {
          reflection_id: storedReflection.id,
          identity_candidate_id: identityCandidateId,
          accepted_identity_fact_id: acceptedIdentityFactId,
          identity_judge_status: identityJudge.judgeStatus,
          learning_key: reflection.learningKey,
          learning_scope: reflection.learningScope,
          reason: reflection.reason
        };
      }
      case TOOL_NAMES.feedbackLearningState: {
        if (deps.mode !== 'durable_lessons') {
          throw new Error(`${TOOL_NAMES.feedbackLearningState} is only allowed during context compression`);
        }
        const state = parseFeedbackLearningStateCandidate(toolCall.args);
        if (!state) {
          throw new Error(`${TOOL_NAMES.feedbackLearningState} returned invalid arguments`);
        }
        if (!deps.persistedReflectionId || !deps.activeLearningKey || !deps.activeLearningScope) {
          throw new Error('Feedback writer learning_state step requires a persisted reflection');
        }
        const currentState = typeof deps.stateGetter === 'function'
          ? await deps.stateGetter.call(this.store, {
              sessionKey: deps.queueMessage.sessionKey,
              groupId,
              scopeType: 'group_self',
              learningKey: deps.activeLearningKey,
              learningScope: deps.activeLearningScope
            }).catch(() => null)
          : null;
        const storedState = await deps.stateUpserter.call(this.store, {
          sessionKey: deps.queueMessage.sessionKey,
          groupId,
          scopeType: 'group_self',
          learningKey: deps.activeLearningKey,
          learningScope: deps.activeLearningScope,
          stateType: state.stateType,
          activeReflectionId: state.activateNewReflection ? deps.persistedReflectionId : (currentState?.activeReflectionId ?? deps.persistedReflectionId),
          latestReflectionId: deps.persistedReflectionId,
          activationWeight: state.activationWeight,
          recencyWeight: state.recencyWeight,
          importanceWeight: state.importanceWeight,
          sourceWeight: state.sourceWeight,
          conflictPenalty: state.conflictPenalty,
          metadata: {
            trace_id: deps.queueMessage.traceId,
            update_reason: state.reason
          }
        });
        return {
          finished: true,
          learning_state_id: storedState.id,
          learning_key: deps.activeLearningKey,
          learning_scope: deps.activeLearningScope,
          reason: state.reason
        };
      }
      default:
        throw new Error(`Unsupported feedback writer tool: ${toolCall.name}`);
    }
  }

  private async buildContextBudgetPlan(params: {
    history: ConversationTurn[];
    queueMessage: QueueMessageRecord['payload'];
    runtimePrompt: ResolvedAgentRuntimePrompt;
    loopContinuation: OpenResponseInputItem[];
    runtimeIdentityFacts: RuntimeIdentityFactProjection[];
    developerContextBlock?: string | null;
  }): Promise<ContextBudgetPlan> {
    const policy = resolveModelContextPolicy(
      params.runtimePrompt.modelName,
      params.runtimePrompt.parameters as Record<string, unknown> | undefined
    );
    const contextWindowTokens = policy?.contextWindowTokens ?? null;
    const targetBudgetTokens = contextWindowTokens ? Math.max(1, Math.floor(contextWindowTokens * READ_HISTORY_TARGET_RATIO)) : null;
    const hardBudgetTokens = contextWindowTokens ? Math.max(1, Math.floor(contextWindowTokens * READ_HISTORY_HARD_RATIO)) : null;
    const cutoffState = await this.store.getSessionReadCutoffState(params.queueMessage.sessionKey);
    const contextSummary = cutoffState?.contextSummary ?? null;
    const pendingProactiveShare = cutoffState?.pendingProactiveShare ?? null;
    const pendingProactiveShareAge = cutoffState?.pendingProactiveShareAge ?? 0;
    const initialRetainedHistory = applyReadCutoff(params.history, cutoffState);

    // Count-based compaction: when retained history exceeds HISTORY_COMPACT_AT turns,
    // evict everything except the most recent HISTORY_COMPACT_KEEP turns regardless of token budget.
    // This ensures context stays manageable and triggers summary generation at a human-scale frequency.
    if (initialRetainedHistory.length > HISTORY_COMPACT_AT) {
      const retainedHistory = initialRetainedHistory.slice(-HISTORY_COMPACT_KEEP);
      const newCutoffTurn = initialRetainedHistory[initialRetainedHistory.length - HISTORY_COMPACT_KEEP - 1];
      const newCutoffId = newCutoffTurn?.id ?? cutoffState?.readCutoffAfterConversationId ?? null;

      await this.store.upsertSessionReadCutoffState({
        sessionKey: params.queueMessage.sessionKey,
        readCutoffAfterConversationId: newCutoffId,
        lastContextWindowTokens: contextWindowTokens ?? 0,
        lastTargetBudgetTokens: targetBudgetTokens ?? 0,
        lastHardBudgetTokens: hardBudgetTokens ?? 0
      });

      const requestInput = buildLoopRequestInput({
        history: retainedHistory,
        queueMessage: params.queueMessage,
        runtimePrompt: params.runtimePrompt,
        loopContinuation: params.loopContinuation,
        runtimeIdentityFacts: params.runtimeIdentityFacts,
        contextSummary,
        pendingProactiveShare,
        developerContextBlock: params.developerContextBlock ?? null
      });
      const estimate = await estimateLoopInputTokens({
        modelName: params.runtimePrompt.modelName,
        queueMessage: params.queueMessage,
        loopInput: requestInput
      });

      return {
        requestInput,
        retainedHistory,
        runtimeIdentityFacts: params.runtimeIdentityFacts,
        readCutoffAfterConversationId: newCutoffId,
        previousReadCutoffAfterConversationId: cutoffState?.readCutoffAfterConversationId ?? null,
        estimatedInputTokens: estimate.inputTokens,
        contextWindowTokens,
        targetBudgetTokens,
        hardBudgetTokens,
        tokenizerEncoding: estimate.encoding,
        tokenizerSource: estimate.source,
        cutoffRecomputed: true,
        contextSummary,
        pendingProactiveShare,
        pendingProactiveShareAge
      };
    }

    const initialRequestInput = buildLoopRequestInput({
      history: initialRetainedHistory,
      queueMessage: params.queueMessage,
      runtimePrompt: params.runtimePrompt,
      loopContinuation: params.loopContinuation,
      runtimeIdentityFacts: params.runtimeIdentityFacts,
      contextSummary,
      pendingProactiveShare,
      developerContextBlock: params.developerContextBlock ?? null
    });
    const initialEstimate = await estimateLoopInputTokens({
      modelName: params.runtimePrompt.modelName,
      queueMessage: params.queueMessage,
      loopInput: initialRequestInput
    });

    if (!contextWindowTokens || !targetBudgetTokens || !hardBudgetTokens || initialEstimate.inputTokens <= hardBudgetTokens) {
      return {
        requestInput: initialRequestInput,
        retainedHistory: initialRetainedHistory,
        runtimeIdentityFacts: params.runtimeIdentityFacts,
        readCutoffAfterConversationId: cutoffState?.readCutoffAfterConversationId ?? null,
        previousReadCutoffAfterConversationId: cutoffState?.readCutoffAfterConversationId ?? null,
        estimatedInputTokens: initialEstimate.inputTokens,
        contextWindowTokens,
        targetBudgetTokens,
        hardBudgetTokens,
        tokenizerEncoding: initialEstimate.encoding,
        tokenizerSource: initialEstimate.source,
        cutoffRecomputed: false,
        contextSummary,
        pendingProactiveShare,
        pendingProactiveShareAge
      };
    }

    const recomputed = await recomputeReadCutoffToTarget({
      history: params.history,
      queueMessage: params.queueMessage,
      runtimePrompt: params.runtimePrompt,
      loopContinuation: params.loopContinuation,
      targetBudgetTokens,
      runtimeIdentityFacts: params.runtimeIdentityFacts,
      contextSummary,
      pendingProactiveShare,
      developerContextBlock: params.developerContextBlock ?? null
    });

    await this.store.upsertSessionReadCutoffState({
      sessionKey: params.queueMessage.sessionKey,
      readCutoffAfterConversationId: recomputed.readCutoffAfterConversationId,
      lastContextWindowTokens: contextWindowTokens,
      lastTargetBudgetTokens: targetBudgetTokens,
      lastHardBudgetTokens: hardBudgetTokens
    });

    return {
      requestInput: recomputed.requestInput,
      retainedHistory: recomputed.retainedHistory,
      runtimeIdentityFacts: params.runtimeIdentityFacts,
      readCutoffAfterConversationId: recomputed.readCutoffAfterConversationId,
      previousReadCutoffAfterConversationId: cutoffState?.readCutoffAfterConversationId ?? null,
      estimatedInputTokens: recomputed.estimatedInputTokens,
      contextWindowTokens,
      targetBudgetTokens,
      hardBudgetTokens,
      tokenizerEncoding: recomputed.tokenizerEncoding,
      tokenizerSource: recomputed.tokenizerSource,
      cutoffRecomputed: true,
      contextSummary,
      pendingProactiveShare,
      pendingProactiveShareAge
    };
  }

  private async executeAgentTurn(
    turnInput: OpenResponseInputItem[],
    queueMessage: QueueMessageRecord['payload'],
    traceId: string,
    turn: number,
    runtimePrompt: ResolvedAgentRuntimePrompt
  ) {
    const canonicalRequest: CanonicalAgentTurnRequest = {
      ...buildCanonicalAgentTurnRequest(
        runtimePrompt.modelName,
        turnInput,
        queueMessage.chatType
      ),
      metadata: buildAgentTurnMetadata(queueMessage, runtimePrompt),
      prompt_cache_key: buildPromptCacheKey(queueMessage, runtimePrompt),
      ...(agentConfig.promptCacheRetention && agentConfig.promptCacheRetention.trim()
        ? { prompt_cache_retention: agentConfig.promptCacheRetention.trim() }
        : {})
    };
    const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/agent/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        trace_id: traceId,
        agent_turn: turn,
        agent_type: 'chat_bot',
        prompt_name: runtimePrompt.promptName,
        model: runtimePrompt.modelName,
        parameters: buildMainAgentParameters(runtimePrompt.parameters as Record<string, unknown> | undefined),
        canonicalRequest
      })
    });

    const payload = await response.json() as ProviderAgentResponse;
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || `Provider agent execute failed with ${response.status}`);
    }

    return payload;
  }

  private async executeTool(
    toolCall: AgentToolCall,
    queueMessage: QueueMessageRecord['payload'],
    options: Record<string, never> = {}
  ): Promise<Record<string, unknown>> {
    switch (toolCall.name) {
      case TOOL_NAMES.privateReply:
      case 'send_private_message':
        return this.sendMessage('private', toolCall.args, queueMessage, options);
      case TOOL_NAMES.groupReply:
      case 'send_group_message':
        return this.sendMessage('group', toolCall.args, queueMessage, options);
      case TOOL_NAMES.unreadMeaning: {
        const meaning = parseUnreadMeaning(toolCall.args);
        if (!meaning) {
          throw new Error(`${TOOL_NAMES.unreadMeaning} returned invalid arguments`);
        }
        return {
          latest_unread_focus: meaning.latestUnreadFocus,
          message_act: meaning.messageAct,
          social_target: meaning.socialTarget,
          addressed_to_me: meaning.addressedToMe,
          has_real_novelty: meaning.hasRealNovelty,
          confidence: meaning.confidence,
          reason: meaning.reason,
          ...(meaning.socialActType !== null ? { social_act_type: meaning.socialActType } : {}),
          ...(meaning.topicContext !== null ? { topic_context: meaning.topicContext } : {})
        };
      }
      case TOOL_NAMES.innerReaction: {
        const reaction = parseInnerReaction(toolCall.args);
        if (!reaction) {
          throw new Error(`${TOOL_NAMES.innerReaction} returned invalid arguments`);
        }
        return {
          interest_level: reaction.interestLevel,
          wants_to_know_more: reaction.wantsToKnowMore,
          reaction_authenticity: reaction.reactionAuthenticity,
          should_search: reaction.shouldSearch,
          preferred_action: reaction.preferredAction,
          reason: reaction.reason
        };
      }
      case TOOL_NAMES.longTermRecall: {
        const recall = parseLongTermLearningRecall(toolCall.args);
        if (!recall) {
          throw new Error(`${TOOL_NAMES.longTermRecall} returned invalid arguments`);
        }
        const reflectionLoader = (this.store as RuntimeStore & {
          listRelevantFeedbackReflections?: RuntimeStore['listRelevantFeedbackReflections'];
        }).listRelevantFeedbackReflections;
        if (typeof reflectionLoader !== 'function') {
          return {
            reason: recall.reason,
            topic_hint: recall.topicHint,
            query_text: buildLongTermRecallQuery(queueMessage, recall.topicHint, recall.reason),
            items: [],
            markdown_items: []
          };
        }

        const queryText = buildLongTermRecallQuery(queueMessage, recall.topicHint, recall.reason);
        const reflections = await reflectionLoader.call(this.store, {
          sessionKey: queueMessage.sessionKey,
          groupId: Number.isFinite(Number(queueMessage.peerId)) ? Number(queueMessage.peerId) : null,
          currentUserId: parseOptionalInteger(queueMessage.senderId) || 0,
          recentUserIds: recall.includeCurrentSender ? resolveRecentRelatedUserIds(queueMessage) : [],
          queryText,
          limit: recall.desiredRecallCount,
          socialActTypeHint: recall.socialActTypeHint
        }).catch(() => []);

        return {
          reason: recall.reason,
          topic_hint: recall.topicHint,
          query_text: queryText,
          items: reflections.map((reflection, index) => ({
            id: reflection.id,
            learning_key: reflection.learningKey,
            learning_scope: reflection.learningScope,
            scope_type: reflection.scopeType,
            reflection_type: reflection.reflectionType,
            confidence: reflection.confidence,
            rank: index + 1,
            why_recalled: recall.reason,
            summary_text: reflection.summaryText
          })),
          markdown_items: reflections.map((reflection, index) => formatLongTermRecallMarkdown({
            rank: index + 1,
            summaryText: reflection.summaryText,
            sourceUserName: reflection.sourceUserName,
            feedbackKind: reflection.feedbackKind,
            whyRecalled: recall.reason
          }))
        };
      }
      case TOOL_NAMES.inspectImage: {
        return this.inspectImagePlaceholder(toolCall.args, queueMessage);
      }
      case TOOL_NAMES.imageTask: {
        return this.requestImageTask(toolCall.args, queueMessage);
      }
      case TOOL_NAMES.silentFinish:
      case 'finish':
        return {
          finished: true,
          reason: typeof toolCall.args.reason === 'string' ? toolCall.args.reason : null,
          outcome: typeof toolCall.args.outcome === 'string' ? toolCall.args.outcome : null,
          xiaoni_os: typeof toolCall.args.xiaoni_os === 'string' && toolCall.args.xiaoni_os.trim()
            ? toolCall.args.xiaoni_os.trim()
            : null,
          pending_share: typeof toolCall.args.pending_share === 'string' && toolCall.args.pending_share.trim()
            ? toolCall.args.pending_share.trim()
            : null
        };
      default:
        throw new Error(`Unsupported tool: ${toolCall.name}`);
    }
  }

  private async inspectImagePlaceholder(
    args: Record<string, unknown>,
    queueMessage: QueueMessageRecord['payload']
  ) {
    const mediaTag = typeof args.media_tag === 'string' && args.media_tag.trim()
      ? args.media_tag.trim()
      : '';
    if (!mediaTag) {
      throw new Error(`${TOOL_NAMES.inspectImage} requires media_tag`);
    }

    const asset = await this.store.getMediaAssetByTag(queueMessage.sessionKey, mediaTag);
    if (!asset) {
      throw new Error(`${TOOL_NAMES.inspectImage} could not find the requested image placeholder`);
    }

    const cachedObservation = Array.isArray(asset.observations) ? asset.observations[0] : null;
    if (cachedObservation?.description) {
      return {
        media_tag: mediaTag,
        inspected: true,
        cached: true,
        description: cachedObservation.description
      };
    }

    const imageUrl = typeof asset.source_locator === 'string' && asset.source_locator.trim()
      ? asset.source_locator.trim()
      : typeof asset.storage_uri === 'string' && asset.storage_uri.trim()
        ? asset.storage_uri.trim()
        : '';
    if (!imageUrl) {
      return {
        media_tag: mediaTag,
        inspected: false,
        description: '这张图片目前只有占位符，没有可读取的图片链接。'
      };
    }

    const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/media/inspect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        trace_id: queueMessage.traceId,
        image_url: imageUrl,
        prompt: '请用中文客观描述这张图片里可见的内容。只描述可见事实，不要猜测隐私、身份或意图。'
      })
    });
    const payload = await response.json() as { success?: boolean; error?: string; data?: { description?: string; model?: string } };
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || `${TOOL_NAMES.inspectImage} failed with ${response.status}`);
    }

    const description = typeof payload.data?.description === 'string' && payload.data.description.trim()
      ? payload.data.description.trim()
      : '图片已读取，但没有得到有效描述。';
    await this.store.recordMediaObservation({
      assetId: asset.id,
      observer: 'xiaoni',
      description,
      sourceModel: payload.data?.model || null,
      metadata: {
        trace_id: queueMessage.traceId,
        reason: typeof args.reason === 'string' ? args.reason : null
      }
    });

    return {
      media_tag: mediaTag,
      inspected: true,
      cached: false,
      description
    };
  }

  private async requestImageTask(
    args: Record<string, unknown>,
    queueMessage: QueueMessageRecord['payload']
  ) {
    const operation = args.operation === 'edit' ? 'edit' : 'generate';
    const prompt = typeof args.prompt === 'string' && args.prompt.trim()
      ? args.prompt.trim()
      : '';
    const targetDescription = typeof args.target_description === 'string' && args.target_description.trim()
      ? args.target_description.trim()
      : `帮 ${queueMessage.senderName || queueMessage.senderId} 做一张图`;
    if (!prompt) {
      throw new Error(`${TOOL_NAMES.imageTask} requires prompt`);
    }

    const sourceMediaTags = Array.isArray(args.source_media_tags)
      ? args.source_media_tags.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)
      : [];
    const mediaAssets = [];
    for (const mediaTag of sourceMediaTags) {
      const asset = await this.resolveMediaAssetForTask(queueMessage, mediaTag);
      if (asset) {
        mediaAssets.push(asset);
      }
    }

    await this.store.createRuntimeTask({
      taskType: operation === 'edit' ? 'image_edit' : 'image_generate',
      status: 'pending',
      sessionKey: queueMessage.sessionKey,
      chatType: queueMessage.chatType,
      peerId: queueMessage.peerId,
      peerName: queueMessage.peerName || null,
      requesterSenderId: queueMessage.senderId,
      requesterSenderName: queueMessage.senderName || null,
      targetDescription,
      prompt,
      sourceTraceId: queueMessage.traceId,
      sourceRunId: queueMessage.runId,
      sourceQueueMessageIds: queueMessage.messages.map((message) => message.queueMessageId),
      sourceMediaTags,
      sourceMediaAssetIds: mediaAssets.map((asset) => asset.id),
      inputJson: {
        operation,
        source_media_tags: sourceMediaTags,
        has_source_media: mediaAssets.length > 0
      }
    });

    const xiaoniOs = typeof args.xiaoni_os === 'string' && args.xiaoni_os.trim()
      ? args.xiaoni_os.trim()
      : null;

    return {
      queued: true,
      task_type: operation === 'edit' ? 'image_edit' : 'image_generate',
      task_context: targetDescription,
      xiaoni_os: xiaoniOs,
      status_text: `我已经开始帮${queueMessage.senderName || '对方'}处理这张图，等结果出来再发。`
    };
  }

  private async resolveMediaAssetForTask(
    queueMessage: QueueMessageRecord['payload'],
    requestedTag: string
  ) {
    const exact = await this.store.getMediaAssetByTag(queueMessage.sessionKey, requestedTag);
    if (exact) {
      return exact;
    }

    const normalized = requestedTag.toLowerCase();
    const contextualAssets = [];
    for (const message of queueMessage.messages) {
      const assets = Array.isArray(message.inboundContext.MediaAssets)
        ? message.inboundContext.MediaAssets
        : [];
      contextualAssets.push(...assets);
    }

    const candidate = contextualAssets.find((asset) => {
      const mediaTag = typeof asset.mediaTag === 'string' ? asset.mediaTag.toLowerCase() : '';
      const placeholder = typeof asset.placeholder === 'string' ? asset.placeholder.toLowerCase() : '';
      const fileName = typeof asset.fileName === 'string' ? asset.fileName.toLowerCase() : '';
      return normalized === mediaTag
        || normalized === `file:${fileName}`
        || normalized === fileName
        || Boolean(fileName && normalized.includes(fileName))
        || Boolean(placeholder && normalized === placeholder);
    });
    if (candidate?.mediaTag) {
      return this.store.getMediaAssetByTag(queueMessage.sessionKey, candidate.mediaTag);
    }

    return null;
  }

  private async sendMessage(
    messageType: 'private' | 'group',
    args: Record<string, unknown>,
    queueMessage: QueueMessageRecord['payload'],
    options: Record<string, never> = {}
  ) {
    const sanitizedArgs = omitTargetOverrideArgs(args, messageType, queueMessage.traceId);
    const xiaoniOs = typeof sanitizedArgs.xiaoni_os === 'string' && sanitizedArgs.xiaoni_os.trim()
      ? sanitizedArgs.xiaoni_os.trim()
      : null;
    const pendingShare = typeof sanitizedArgs.pending_share === 'string' && sanitizedArgs.pending_share.trim()
      ? sanitizedArgs.pending_share.trim()
      : null;

    if (messageType === 'private') {
      const userId = resolvePrivateTargetUserId(queueMessage);
      const messages = normalizeMessages(sanitizedArgs);
      if (!Number.isFinite(userId) || messages.length === 0) {
        throw new Error(`${TOOL_NAMES.privateReply} requires a valid current private target plus message or messages`);
      }

      const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/send_private`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_id: userId,
          messages
        })
      });
      const payload = await response.json() as { success?: boolean; error?: string; data?: unknown };
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || `${TOOL_NAMES.privateReply} failed with ${response.status}`);
      }
      await this.recordPresenceAssistantAction(queueMessage);
      return {
        message_type: 'private',
        sent_messages: messages,
        xiaoni_os: xiaoniOs,
        pending_share: pendingShare,
        delivery: payload.data || null
      };
    }

    const groupId = resolveGroupTargetId(queueMessage);
    const normalizedMessages = normalizeMessages(sanitizedArgs);
    const plannedDelivery = {
      messages: normalizedMessages,
      mentionUserIds: normalizeOptionalIntegerList(sanitizedArgs.mention_user_ids),
      secondBeatSuppressed: false
    };
    if (!Number.isFinite(groupId) || plannedDelivery.messages.length === 0) {
      throw new Error(`${TOOL_NAMES.groupReply} requires a valid current group target plus message or messages`);
    }

    let selectedMessages = plannedDelivery.messages;
    let selectedMentionUserIds = plannedDelivery.mentionUserIds;

    const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/send_group`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_key: queueMessage.sessionKey,
        group_id: groupId,
        messages: selectedMessages,
        mention_user_ids: selectedMentionUserIds
      })
    });
    const payload = await response.json() as { success?: boolean; error?: string; data?: unknown };
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || `${TOOL_NAMES.groupReply} failed with ${response.status}`);
    }
    await this.recordPresenceAssistantAction(queueMessage);
    return {
      message_type: 'group',
      mention_user_ids: selectedMentionUserIds,
      sent_messages: selectedMessages,
      xiaoni_os: xiaoniOs,
      pending_share: pendingShare,
      second_beat_suppressed: plannedDelivery.secondBeatSuppressed,
      delivery: payload.data || null
    };
  }

  private async recordPresenceAssistantAction(queueMessage: QueueMessageRecord['payload']) {
    const recorder = (this.store as RuntimeStore & {
      recordPresenceAssistantAction?: RuntimeStore['recordPresenceAssistantAction'];
    }).recordPresenceAssistantAction;
    if (typeof recorder !== 'function') {
      return;
    }
    await recorder.call(this.store, queueMessage).catch((error) => {
      moduleLogger.warn('Failed to record presence assistant-action anchor', {
        traceId: queueMessage.traceId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }
}

function applyReadCutoff(history: ConversationTurn[], cutoffState: SessionReadCutoffState | null) {
  const readCutoffAfterConversationId = cutoffState?.readCutoffAfterConversationId;
  if (typeof readCutoffAfterConversationId !== 'number' || !Number.isFinite(readCutoffAfterConversationId)) {
    return history.slice();
  }
  return history.filter((turn) => turn.id > readCutoffAfterConversationId);
}

function isPresenceTickPayload(queueMessage: QueueMessageRecord['payload']) {
  return queueMessage.source === 'presence_tick'
    || queueMessage.sessionKey === 'presence_tick:xiaoni'
    || Boolean(queueMessage.presenceTick);
}

export function materializePresenceTickQueueMessage(queueMessage: QueueMessageRecord): QueueMessageRecord {
  const tick = queueMessage.payload.presenceTick;
  if (!tick || queueMessage.payload.sessionKey !== 'presence_tick:xiaoni') {
    return queueMessage;
  }

  const payload = queueMessage.payload;
  const targetSessionKey = tick.targetSessionKey;
  const targetPeerId = tick.targetPeerId;
  const targetPeerName = tick.targetPeerName || undefined;
  const inboundContext = {
    ...payload.inboundContext,
    SessionKey: targetSessionKey,
    To: targetPeerId,
    NativeChannelId: targetPeerId,
    GroupSubject: targetPeerName || payload.inboundContext.GroupSubject,
    Surface: 'presence_tick'
  };
  const messages = payload.messages.map((message) => ({
    ...message,
    chatType: 'group' as const,
    sessionKey: targetSessionKey,
    peerId: targetPeerId,
    peerName: targetPeerName,
    accountId: tick.targetAccountId,
    inboundContext: {
      ...message.inboundContext,
      SessionKey: targetSessionKey,
      To: targetPeerId,
      NativeChannelId: targetPeerId,
      GroupSubject: targetPeerName || message.inboundContext.GroupSubject,
      Surface: 'presence_tick'
    }
  }));

  return {
    ...queueMessage,
    payload: {
      ...payload,
      chatType: 'group',
      sessionKey: targetSessionKey,
      peerId: targetPeerId,
      peerName: targetPeerName,
      accountId: tick.targetAccountId,
      inboundContext,
      messages
    }
  };
}

function buildLoopRequestInput(params: {
  history: ConversationTurn[];
  queueMessage: QueueMessageRecord['payload'];
  runtimePrompt: ResolvedAgentRuntimePrompt;
  loopContinuation: OpenResponseInputItem[];
  runtimeIdentityFacts?: RuntimeIdentityFactProjection[];
  contextSummary?: string | null;
  pendingProactiveShare?: string | null;
  developerContextBlock?: string | null;
}) {
  return [
    ...buildInitialInput(params.history, params.queueMessage, params.runtimePrompt, params.runtimeIdentityFacts || [], params.contextSummary ?? null, params.pendingProactiveShare ?? null, params.developerContextBlock ?? null),
    ...params.loopContinuation
  ];
}

async function estimateLoopInputTokens(params: {
  modelName: string;
  queueMessage: QueueMessageRecord['payload'];
  loopInput: OpenResponseInputItem[];
}) {
  const canonicalRequest = buildCanonicalAgentTurnRequest(
    params.modelName,
    params.loopInput,
    params.queueMessage.chatType
  );
  return estimateTextTokens({
    model: params.modelName,
    text: JSON.stringify(canonicalRequest)
  });
}

async function recomputeReadCutoffToTarget(params: {
  history: ConversationTurn[];
  queueMessage: QueueMessageRecord['payload'];
  runtimePrompt: ResolvedAgentRuntimePrompt;
  loopContinuation: OpenResponseInputItem[];
  targetBudgetTokens: number;
  runtimeIdentityFacts: RuntimeIdentityFactProjection[];
  contextSummary?: string | null;
  pendingProactiveShare?: string | null;
  developerContextBlock?: string | null;
}) {
  let retainedHistory: ConversationTurn[] = [];
  let readCutoffAfterConversationId: number | null = params.history.length > 0
    ? params.history[params.history.length - 1]!.id
    : null;
  let lastEstimate = await estimateLoopInputTokens({
    modelName: params.runtimePrompt.modelName,
    queueMessage: params.queueMessage,
    loopInput: buildLoopRequestInput({
      history: retainedHistory,
      queueMessage: params.queueMessage,
      runtimePrompt: params.runtimePrompt,
      loopContinuation: params.loopContinuation,
      runtimeIdentityFacts: params.runtimeIdentityFacts,
      contextSummary: params.contextSummary,
      developerContextBlock: params.developerContextBlock
    })
  });

  for (let index = params.history.length - 1; index >= 0; index -= 1) {
    const candidateHistory = params.history.slice(index);
    const candidateEstimate = await estimateLoopInputTokens({
      modelName: params.runtimePrompt.modelName,
      queueMessage: params.queueMessage,
      loopInput: buildLoopRequestInput({
        history: candidateHistory,
        queueMessage: params.queueMessage,
        runtimePrompt: params.runtimePrompt,
        loopContinuation: params.loopContinuation,
        runtimeIdentityFacts: params.runtimeIdentityFacts,
        contextSummary: params.contextSummary,
        developerContextBlock: params.developerContextBlock
      })
    });
    if (candidateEstimate.inputTokens > params.targetBudgetTokens) {
      break;
    }
    retainedHistory = candidateHistory;
    lastEstimate = candidateEstimate;
    readCutoffAfterConversationId = index > 0 ? params.history[index - 1]!.id : null;
  }

  return {
    requestInput: buildLoopRequestInput({
      history: retainedHistory,
      queueMessage: params.queueMessage,
      runtimePrompt: params.runtimePrompt,
      loopContinuation: params.loopContinuation,
      runtimeIdentityFacts: params.runtimeIdentityFacts,
      contextSummary: params.contextSummary,
      pendingProactiveShare: params.pendingProactiveShare,
      developerContextBlock: params.developerContextBlock
    }),
    retainedHistory,
    readCutoffAfterConversationId,
    estimatedInputTokens: lastEstimate.inputTokens,
    tokenizerEncoding: lastEstimate.encoding,
    tokenizerSource: lastEstimate.source
  };
}

function readOptionalNumber(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function attachActualUsageToTurnBudget(
  record: ContextBudgetTurnRecord,
  modelResult: ProviderAgentResponse
) {
  record.actualInputTokens = readOptionalNumber(modelResult.usage?.input_tokens);
  record.actualOutputTokens = readOptionalNumber(modelResult.usage?.output_tokens);
  record.actualTotalTokens = readOptionalNumber(modelResult.usage?.total_tokens);
  record.cachedInputTokens = readOptionalNumber(modelResult.usage_details?.cached_input_tokens);
  record.reasoningTokens = readOptionalNumber(modelResult.usage_details?.reasoning_tokens);
  record.processingTimeMs = readOptionalNumber(modelResult.performance?.processing_time_ms);
}

function serializeContextBudgetTurnRecord(record: ContextBudgetTurnRecord) {
  return {
    turn: record.turn,
    estimated_input_tokens: record.estimatedInputTokens,
    actual_input_tokens: record.actualInputTokens,
    actual_output_tokens: record.actualOutputTokens,
    actual_total_tokens: record.actualTotalTokens,
    cached_input_tokens: record.cachedInputTokens,
    reasoning_tokens: record.reasoningTokens,
    processing_time_ms: record.processingTimeMs,
    read_history_count: record.readHistoryCount,
    read_cutoff_after_conversation_id: record.readCutoffAfterConversationId,
    context_window_tokens: record.contextWindowTokens,
    target_budget_tokens: record.targetBudgetTokens,
    hard_budget_tokens: record.hardBudgetTokens,
    tokenizer_encoding: record.tokenizerEncoding,
    tokenizer_source: record.tokenizerSource,
    cutoff_recomputed: record.cutoffRecomputed
  };
}

export function buildInitialInput(
  history: ConversationTurn[],
  queueMessage: QueueMessageRecord['payload'],
  runtimePrompt: Pick<ResolvedAgentRuntimePrompt, 'systemPrompt' | 'userPromptTemplate' | 'contextVariables' | 'runtimeVariables'> = {
    systemPrompt: agentConfig.systemPrompt,
    userPromptTemplate: null,
    contextVariables: {},
    runtimeVariables: {}
  },
  runtimeIdentityFacts: RuntimeIdentityFactProjection[] = [],
  contextSummary: string | null = null,
  pendingProactiveShare: string | null = null,
  developerContextBlock: string | null = null
): OpenResponseInputItem[] {
  const items: OpenResponseInputItem[] = [
    {
      type: 'message',
      role: 'system',
      content: composeSystemPrompt(
        runtimePrompt.systemPrompt,
        queueMessage.chatType
      )
    }
  ];

  if (developerContextBlock && developerContextBlock.trim()) {
    items.push({
      type: 'message',
      role: 'developer',
      content: developerContextBlock.trim()
    });
  }

  if (contextSummary) {
    items.push(buildAssistantCommentaryInputItem([`<对话历史摘要>\n${contextSummary}\n</对话历史摘要>`]));
  }

  for (const turn of history) {
    const transcriptItems = Array.isArray(turn.items) && turn.items.length > 0
      ? turn.items
      : [];
    const osText = buildTurnOs(turn);
    let osAttached = false;

    if (transcriptItems.length === 0) {
      if (turn.userMessage) {
        items.push(buildUserSceneInputItem([
          formatTaggedBlock('INPUT_MESSAGE', {
            source: 'legacy_user_message',
            conversation_id: turn.id,
            session_key: turn.sessionKey ?? undefined
          }, turn.userMessage)
        ]));
      }
      if (turn.aiResponse) {
        items.push(buildAssistantFinalInputItem([
          renderAssistantOutputMessage({
            accountId: queueMessage.accountId,
            content: turn.aiResponse,
            source: 'legacy_ai_response'
          })
        ]));
      }
      if (osText) {
        items.push(buildAssistantCommentaryInputItem([osText]));
        osAttached = true;
      }
      continue;
    }

    for (const transcriptItem of transcriptItems) {
      const rendered = renderTranscriptItemForRuntimeContext(transcriptItem, queueMessage.accountId);
      if (rendered) {
        items.push(rendered);
      }
    }

    if (osText && !osAttached) {
      items.push(buildAssistantCommentaryInputItem([osText]));
    }
  }

  items.push(...buildCurrentTurnInputItems(queueMessage, runtimePrompt));
  const mediaPlaceholderContext = renderCurrentMediaPlaceholderContext(queueMessage);
  if (mediaPlaceholderContext) {
    items.push(buildAssistantCommentaryInputItem([mediaPlaceholderContext]));
  }
  items.push(buildAssistantCommentaryInputItem([buildCurrentProcessingReminder(queueMessage)]));
  const identityFactsText = renderRuntimeIdentityFacts(runtimeIdentityFacts);
  if (identityFactsText) {
    items.push(buildDeveloperInputItem([identityFactsText]));
  }

  return items;
}

function buildTurnOs(turn: ConversationTurn) {
  const rawResponse = turn.rawResponse && typeof turn.rawResponse === 'object'
    ? turn.rawResponse
    : {};
  const rawXiaoniOs = typeof (rawResponse as Record<string, unknown>).xiaoni_os === 'string'
    ? String((rawResponse as Record<string, unknown>).xiaoni_os)
    : '';
  const finishReason = typeof (rawResponse as Record<string, unknown>).finish_reason === 'string'
    ? String((rawResponse as Record<string, unknown>).finish_reason).trim()
    : '';
  const sentMessages = Array.isArray((rawResponse as Record<string, unknown>).sent_messages)
    ? ((rawResponse as Record<string, unknown>).sent_messages as unknown[])
        .map((item) => typeof item === 'string' ? item.trim() : '')
        .filter(Boolean)
    : [];
  const xiaoniOs = sanitizeXiaoniOsForReplay({
    xiaoniOs: rawXiaoniOs,
    aiResponse: turn.aiResponse || null,
    sentMessages
  });

  if (xiaoniOs) {
    return [
      '<小腻的OS>',
      xiaoniOs,
      '</小腻的OS>'
    ].join('\n');
  }

  if (finishReason && !turn.aiResponse && sentMessages.length === 0) {
    return [
      '<小腻的OS>',
      `刚才我没有接。${finishReason}`,
      '</小腻的OS>'
    ].join('\n');
  }

  return '';
}

function buildCurrentTurnInputItems(
  queueMessage: QueueMessageRecord['payload'],
  runtimePrompt: Pick<ResolvedAgentRuntimePrompt, 'userPromptTemplate' | 'contextVariables' | 'runtimeVariables'>
): OpenResponseInputItem[] {
  if (isPresenceTickPayload(queueMessage)) {
    return [
      buildAssistantCommentaryInputItem([renderPresenceTickAction(queueMessage)])
    ];
  }

  const currentMessages = queueMessage.messages.map((message, index) => renderTranscriptBatchMessage(message, index));
  let userPromptTemplate: string | null = null;
  if (typeof runtimePrompt.userPromptTemplate === 'string' && runtimePrompt.userPromptTemplate.trim()) {
    userPromptTemplate = runtimePrompt.userPromptTemplate;
  }
  const renderedMessages = userPromptTemplate
    ? currentMessages.map((message) => applyPromptTemplate(userPromptTemplate, runtimePrompt.contextVariables, {
        ...runtimePrompt.runtimeVariables,
        user_input: message
      }))
    : currentMessages;

  return renderedMessages.map((message) => buildUserSceneInputItem([message]));
}

function renderCurrentMediaPlaceholderContext(queueMessage: QueueMessageRecord['payload']) {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const message of queueMessage.messages) {
    const assets = Array.isArray(message.inboundContext.MediaAssets)
      ? message.inboundContext.MediaAssets
      : [];
    for (const asset of assets) {
      if (!asset || typeof asset.mediaTag !== 'string' || seen.has(asset.mediaTag)) {
        continue;
      }
      seen.add(asset.mediaTag);
      const sender = message.senderName || message.senderId || '有人';
      const typeText = asset.mediaType === 'image' ? '图片' : asset.mediaType;
      lines.push(`- ${asset.mediaTag}: ${sender} 发来的${typeText}占位符 ${asset.placeholder || '[Image]'}。如果确实需要看清内容，再调用 inspect_image_placeholder。`);
    }
  }

  if (lines.length === 0) {
    return '';
  }

  return [
    '[当前媒体占位符]',
    '这些只是占位符，不等于我已经看过内容；不要猜图里有什么。',
    ...lines
  ].join('\n');
}

function renderConversationInput(queueMessage: QueueMessageRecord['payload']) {
  return queueMessage.messages
    .map((message, index) => renderTranscriptBatchMessage(message, index))
    .join('\n');
}

function deriveTermination(params: {
  finishResult: Record<string, unknown> | null;
  deliveredMessages: DeliveredAssistantMessage[];
  errorMessage: string | null;
  error?: unknown;
}) {
  const finishReason = typeof params.finishResult?.reason === 'string' ? params.finishResult.reason : null;
  const finishOutcome = typeof params.finishResult?.outcome === 'string' ? params.finishResult.outcome : null;
  const noReply = params.deliveredMessages.length === 0;

  if (params.errorMessage) {
    if (params.error instanceof MissingAgentPromptBindingError) {
      return {
        terminationReason: 'prompt_binding_error',
        finishReason,
        finishOutcome,
        noReply: true
      };
    }

    return {
      terminationReason: params.deliveredMessages.length > 0 ? 'delivery_error' : 'agent_runtime_error',
      finishReason,
      finishOutcome,
      noReply
    };
  }

  if (noReply) {
    return {
      terminationReason: 'finish_no_reply',
      finishReason,
      finishOutcome,
      noReply: true
    };
  }

  return {
    terminationReason: 'reply_sent',
    finishReason,
    finishOutcome,
    noReply: false
  };
}

function omitTargetOverrideArgs(
  args: Record<string, unknown>,
  messageType: 'private' | 'group',
  traceId: string
) {
  const overrideKey = messageType === 'private' ? 'user_id' : 'group_id';
  if (!(overrideKey in args)) {
    return args;
  }

  const { [overrideKey]: _ignored, ...rest } = args;
  moduleLogger.warn('Ignoring LLM-supplied message target override', {
    trace_id: traceId,
    message_type: messageType,
    ignored_argument: overrideKey
  });
  return rest;
}

function resolvePrivateTargetUserId(queueMessage: QueueMessageRecord['payload']) {
  const userId = Number(queueMessage.senderId);
  if (!Number.isFinite(userId)) {
    throw new Error(`Invalid sender id in queue payload: ${queueMessage.senderId}`);
  }
  return userId;
}

function resolveGroupTargetId(queueMessage: QueueMessageRecord['payload']) {
  const groupId = Number(queueMessage.inboundContext.NativeChannelId || queueMessage.peerId);
  if (!Number.isFinite(groupId)) {
    throw new Error(
      `Invalid group target in queue payload: ${queueMessage.inboundContext.NativeChannelId || queueMessage.peerId || 'unknown'}`
    );
  }
  return groupId;
}

function resolveSessionTargets(queueMessage: QueueMessageRecord['payload']) {
  const userId = resolvePrivateTargetUserId(queueMessage);
  const groupId = queueMessage.chatType === 'group'
    ? resolveGroupTargetId(queueMessage)
    : null;

  return {
    userId,
    groupId: groupId !== null && Number.isFinite(groupId) ? groupId : null
  };
}

function extractReplayableModelOutputs(response: ProviderAgentResponse['canonical_response']): ReplayableModelOutput[] {
  const output = Array.isArray(response?.output) ? response.output : [];
  const replayItems: ReplayableModelOutput[] = [];

  for (const item of output) {
    if (item?.type === 'reasoning') {
      const reasoningItem: Extract<ReplayableModelOutput, { type: 'reasoning' }>['inputItem'] = {
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
      };
      if (reasoningItem.content || reasoningItem.summary || reasoningItem.encrypted_content) {
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
        replayItems.push({
          type: 'assistant_message',
          inputItem: buildMessageInputItem('assistant', [text], item.phase === 'final_answer' ? 'final_answer' : 'commentary')
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

function normalizeMessages(args: Record<string, unknown>) {
  const messages: string[] = [];

  if (typeof args.message === 'string' && args.message.trim()) {
    messages.push(sanitizeLowValueOpeningFiller(args.message));
  }

  if (Array.isArray(args.messages)) {
    for (const item of args.messages) {
      if (typeof item !== 'string' || !item.trim()) {
        throw new Error('messages must be an array of non-empty strings');
      }
      messages.push(sanitizeLowValueOpeningFiller(item));
    }
  }

  return messages;
}

export function sanitizeLowValueOpeningFiller(message: string) {
  const original = message.trim();
  let cleaned = original;
  let changed = false;

  while (cleaned.length > 0) {
    const before = cleaned;
    cleaned = cleaned
      .replace(/^\s+/, '')
      .replace(/^哈{2,}/, '')
      .replace(/^确实(?:是这样)?/, '')
      .replace(/^[\s,，。！？!?、~～…:：;；]+/, '');
    changed = changed || cleaned !== before;
    if (cleaned === before) {
      break;
    }
  }

  const finalMessage = cleaned.trim();
  return changed && finalMessage.length > 0 ? finalMessage : original;
}

function normalizeOptionalIntegerList(value: unknown) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error('mention_user_ids must be an array of integers');
  }

  return Array.from(new Set(value.map((item) => {
    const numeric = Number(item);
    if (!Number.isFinite(numeric)) {
      throw new Error('mention_user_ids must be an array of integers');
    }
    return Math.trunc(numeric);
  })));
}

function extractSentMessages(toolResult: Record<string, unknown>) {
  if (!Array.isArray(toolResult.sent_messages)) {
    return [];
  }

  return toolResult.sent_messages.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

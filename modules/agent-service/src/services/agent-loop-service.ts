import { v4 as uuidv4 } from 'uuid';
import { agentConfig } from '../config';
import { logger } from '../utils/logger';
import type { UnreadMeaningSocialActType } from '../types/social-act-type';
import {
  AgentToolCall,
  ConversationTranscriptItem,
  ConversationTranscriptPhase,
  ConversationTurn,
  QueueBatchMessage,
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

type ExecuteToolOptions = {
  stateBias?: TurnControlStateBias;
};

type TurnControlStage =
  | 'read_unread'
  | 'feel_reaction'
  | 'maybe_search_or_inspect'
  | 'finalize';

type TurnControlStateBias = 'low_energy' | 'normal' | 'high_energy';
type TurnControlRecallStatus = 'not_needed';
type TurnControlExpectedNext =
  | 'submit_life_action'
  | 'final_tool';
type LifeActionContextGap =
  | 'none'
  | 'current_context_insufficient'
  | 'needs_private_memory'
  | 'needs_public_info'
  | 'unclear_group_reference';
type LifeActionGapResolution =
  | 'none'
  | 'memory'
  | 'web_search'
  | 'ask_group'
  | 'memory_then_ask_or_search';
type LifeActionParticipationJudgmentStatus =
  | 'has_sayable_point'
  | 'no_sayable_point'
  | 'direct_request';
type LifeActionParticipationJudgmentBasis =
  | 'opinion'
  | 'question'
  | 'curiosity'
  | 'discomfort'
  | 'association'
  | 'boundary'
  | 'direct_request'
  | 'none';
export type TurnControlState = {
  stage: TurnControlStage;
  targetFound: boolean;
  stateBias: TurnControlStateBias;
  recallStatus: TurnControlRecallStatus;
  recallAttempts: number;
  emptyRecallAttempts: number;
  expectedNext: TurnControlExpectedNext;
  reason: string;
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
  reasoning?: {
    effort?: string;
    summary?: string;
    [key: string]: unknown;
  };
  text?: Record<string, unknown>;
  include?: string[];
  context_management?: Array<Record<string, unknown>>;
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
  summarySourceInput: OpenResponseInputItem[] | null;
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

type LifeAction = {
  unreadMeaning: UnreadMeaning | null;
  actionType: 'speak' | 'silent' | 'search' | 'image_task' | 'proactive';
  evidenceRefs: string[];
  confidence: number | null;
  interestLevel: 'none' | 'low' | 'medium' | 'high';
  wantsToKnowMore: boolean;
  reactionAuthenticity: 'none' | 'weak_but_real' | 'formed' | 'empty_but_convenient';
  participationJudgment: {
    status: LifeActionParticipationJudgmentStatus;
    basis: LifeActionParticipationJudgmentBasis;
    sayablePoint: string | null;
    evidenceRefs: string[];
    memoryRefs: string[];
  };
  shouldSearch: boolean;
  contextGap: LifeActionContextGap;
  gapResolution: LifeActionGapResolution;
  reason: string;
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
type CompactMemoryLayer = 'episodic' | 'semantic' | 'reflection';

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
  lifeActionArtifact: Record<string, unknown> | null;
};

type ContextCompressionMemoryParams = {
  queueMessage: QueueMessageRecord['payload'];
  conversationId: number;
  evictedTurns: ConversationTurn[];
  runtimePrompt: ResolvedAgentRuntimePrompt;
};

type PersistedMemoryObservation = {
  id: number;
  topic: string;
  text: string;
  participants: CompactMemoryParticipant[];
  xiaoniRole: string;
  sourceTurnIds: number[];
  sourceMessageIds: number[];
  createdAt?: string | Date | null;
};

type CompactMemoryParticipant = { qq_id: string; name: string };

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
const GLOBAL_LIFE_CONTEXT_SESSION_KEY = 'xiaoni:global';
export const XIAONI_IDENTITY_KEY = 'xiaoni';
const RUNTIME_IDENTITY_FACT_LIMIT = 4;

const TOOL_NAMES = {
  unreadMeaning: 'emit_unread_meaning',
  lifeAction: 'submit_life_action',
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
  '只发送群友能直接看到的话，不写工具名、阶段名或分析过程。',
  'message/messages 必须来自当前可见消息、工具结果或 proactive 材料；不要重复旧话。',
  '一句话够用就短句收住；不要为了延长场面补解释。'
] as const;

const GROUP_MENTION_RULES = [
  'mention_user_ids 只在你确实是在自然点名某个人、回应某个人、或者要把某个人拉进当前话题时使用。',
  '让每个 @ 都对应真实的指向，比如点名回应、转向某个人，或把某个人带进当前话题。',
  '如果不用 @ 也能看懂你在回谁，就不要 @。'
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
          description: '给下一次运行保留的备注：当前看见的事实、自己的反应、未解决的信息缺口。不发给对方。'
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
          description: '给下一次运行保留的备注：当前看见的事实、自己的反应、未解决的信息缺口。不发给任何人。'
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
          description: '给下一轮自己的运行备注：这个后台任务和相关信息缺口。不发给任何人。'
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
    description: '结束当前动作且不发送 QQ 可见消息。',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
        outcome: { type: 'string' },
        xiaoni_os: {
          type: 'string',
          description: '给下一次运行保留的内心独白：当前动作之后留在你这里的东西、察觉到了什么、什么还没过去。不发给任何人。'
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

const LIFE_ACTION_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.lifeAction,
    description: [
      '一次性完成小腻本轮生活动作决策。这个工具同时提交当前未读理解、参与判断、最终动作和必要的发言/沉默状态。',
      '普通 speak/silent/proactive 必须直接用这个工具收口，不要先调用 emit_unread_meaning 再进入第二轮。',
      '只有确实需要外部 web_search、看图或图片任务结果时，action_type 才能选 search/image_task 并进入后续工具轮。',
      '如果只是能接话但没有具体可说点，action_type 必须是 silent。'
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        unread_meaning: {
          type: 'object',
          description: '当前新入站消息的一次性理解结果；替代旧的单独 emit_unread_meaning turn。',
          properties: {
            latest_unread_focus: { type: 'string' },
            message_act: {
              type: 'string',
              enum: ['statement', 'question', 'joke', 'tease', 'feedback', 'reaction', 'request', 'unclear']
            },
            social_target: {
              type: 'string',
              enum: ['me', 'someone_else', 'group', 'unclear']
            },
            addressed_to_me: { type: 'boolean' },
            has_real_novelty: { type: 'boolean' },
            confidence: {
              type: 'string',
              enum: ['low', 'medium', 'high']
            },
            reason: { type: 'string' },
            social_act_type: {
              type: 'string',
              enum: ['invitation_curiosity', 'emotional_release', 'relationship_probe', 'concrete_request', 'yes_no_reaction', 'casual_remark']
            },
            topic_context: {
              type: 'object',
              properties: {
                has_topic: { type: 'boolean' },
                topic_summary: { type: 'string' },
                addressed_to_me: { type: 'boolean' }
              },
              required: ['has_topic', 'addressed_to_me'],
              additionalProperties: false
            }
          },
          required: ['latest_unread_focus', 'message_act', 'social_target', 'addressed_to_me', 'has_real_novelty', 'confidence', 'reason', 'topic_context'],
          additionalProperties: false
        },
        action_type: {
          type: 'string',
          enum: ['speak', 'silent', 'search', 'image_task', 'proactive'],
          description: '本轮最终动作。speak/proactive/silent 会直接收口；search/image_task 只在必须外部结果时进入后续工具轮。'
        },
        message: {
          type: 'string',
          description: 'action_type=speak/proactive 时可用。只放要发给 QQ 的一句话；多段时用 messages。'
        },
        messages: {
          type: 'array',
          items: { type: 'string' },
          description: 'action_type=speak/proactive 时可用。多段 QQ 可见消息。'
        },
        mention_user_ids: {
          type: 'array',
          items: { type: 'integer' },
          description: '群聊发言时可选。只在自然点名、回应或拉人进话题时填写。'
        },
        outcome: {
          type: 'string',
          description: 'action_type=silent 时的收口结果，例如 no_sayable_point、not_addressed_to_me、low_energy。'
        },
        reason: {
          type: 'string',
          description: '一句话说明为什么这个动作现在成立。不要写隐藏推理链。'
        },
        evidence_refs: {
          type: 'array',
          maxItems: 6,
          items: { type: 'string' },
          description: '支持这个动作的当前现场引用，例如 message_id、sender、wake_event 或 residue id。没有就空数组。'
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: '0 到 1 的动作确信度；低确信度优先 silent。'
        },
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
        participation_judgment: {
          type: 'object',
          description: '小腻当前参与或不参与的可检查判断。这不是隐藏推理，只写结论、依据类型和证据引用。',
          properties: {
            status: {
              type: 'string',
              enum: ['has_sayable_point', 'no_sayable_point', 'direct_request']
            },
            basis: {
              type: 'string',
              enum: ['opinion', 'question', 'curiosity', 'discomfort', 'association', 'boundary', 'direct_request', 'none']
            },
            sayable_point: {
              type: 'string',
              description: '一句话写清小腻当前具体想补充的内容点。status=no_sayable_point 时填空字符串。'
            },
            evidence_refs: {
              type: 'array',
              maxItems: 6,
              items: { type: 'string' }
            },
            memory_refs: {
              type: 'array',
              maxItems: 6,
              items: { type: 'string' }
            }
          },
          required: ['status', 'basis', 'sayable_point', 'evidence_refs', 'memory_refs'],
          additionalProperties: false
        },
        should_search: {
          type: 'boolean',
          description: '只有当前上下文不足且缺口属于公开信息时才为 true。'
        },
        context_gap: {
          type: 'string',
          enum: ['none', 'current_context_insufficient', 'needs_private_memory', 'needs_public_info', 'unclear_group_reference']
        },
        gap_resolution: {
          type: 'string',
          enum: ['none', 'memory', 'web_search', 'ask_group', 'memory_then_ask_or_search']
        },
        xiaoni_os: {
          type: 'string',
          description: '给下一次运行保留的内部连续性：当前动作之后留在你这里的东西。不发给任何人。'
        },
        pending_share: {
          type: 'string',
          description: '如果有想找机会主动说的材料，写在这里带到下一轮。可选。'
        },
        operation: {
          type: 'string',
          enum: ['generate', 'edit'],
          description: 'action_type=image_task 且可以直接登记任务时使用。'
        },
        prompt: {
          type: 'string',
          description: 'action_type=image_task 且可以直接登记任务时使用。'
        },
        target_description: {
          type: 'string',
          description: 'action_type=image_task 且可以直接登记任务时使用。'
        },
        source_media_tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'action_type=image_task 时引用当前上下文图片占位符。'
        }
      },
      required: ['unread_meaning', 'action_type', 'reason', 'evidence_refs', 'confidence', 'interest_level', 'wants_to_know_more', 'reaction_authenticity', 'participation_judgment', 'should_search', 'context_gap', 'gap_resolution', 'xiaoni_os'],
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

const MEMORY_EPISODIC_TOOL = {
  type: 'function',
  function: {
    name: 'write_episodic_observations',
    description: 'Write short Xiaoni-colored observations from evicted group-chat turns. Empty observations are valid when nothing is worth remembering.',
    parameters: {
      type: 'object',
      properties: {
        observations: {
          type: 'array',
          minItems: 0,
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              topic: { type: 'string' },
              text: { type: 'string' },
              poignancy: { type: 'integer', minimum: 1, maximum: 10 },
              participants: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  properties: {
                    qq_id: { type: 'string' },
                    name: { type: 'string' }
                  },
                  required: ['qq_id', 'name'],
                  additionalProperties: false
                }
              },
              xiaoni_role: {
                type: 'string',
                enum: ['speaker', 'directly_addressed', 'mentioned_or_evaluated', 'bystander', 'not_involved']
              },
              source_turn_ids: {
                type: 'array',
                minItems: 1,
                items: { type: 'integer' }
              }
            },
            required: ['topic', 'text', 'poignancy', 'participants', 'xiaoni_role', 'source_turn_ids'],
            additionalProperties: false
          }
        }
      },
      required: ['observations'],
      additionalProperties: false
    }
  }
} as const;

const MEMORY_SEMANTIC_TOOL = {
  type: 'function',
  function: {
    name: 'write_semantic_assertions',
    description: [
      'Write objective facts, states, plans, and claims from evicted group-chat turns.',
      'Preserve who stated/owns the assertion and who/what it is about; do not collapse identifiable speakers into "the group" or "someone".',
      'Empty assertions are valid.'
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        assertions: {
          type: 'array',
          minItems: 0,
          maxItems: 16,
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              fact_type: {
                type: 'string',
                enum: ['stable_fact', 'current_status', 'one_time_event', 'stated_plan', 'claim']
              },
              scope: {
                type: 'string',
                enum: ['person', 'dyad', 'group', 'topic', 'system_state', 'self_continuity'],
                description: '断言适用范围。只有确实是群体共同事实时才用 group；可识别到说话人时优先 person/dyad/topic。'
              },
              owners: {
                type: 'array',
                minItems: 0,
                maxItems: 4,
                description: '谁说出、持有或负责这个断言。能识别说话人时必须填写，不要用“群里/有人”。',
                items: {
                  type: 'object',
                  properties: {
                    qq_id: { type: 'string' },
                    name: { type: 'string' }
                  },
                  required: ['qq_id', 'name'],
                  additionalProperties: false
                }
              },
              directed_to: {
                type: 'array',
                minItems: 0,
                maxItems: 4,
                description: '这个断言当时明确说给谁。没有明确对象就空数组。',
                items: {
                  type: 'object',
                  properties: {
                    qq_id: { type: 'string' },
                    name: { type: 'string' }
                  },
                  required: ['qq_id', 'name'],
                  additionalProperties: false
                }
              },
              entities: {
                type: 'array',
                minItems: 1,
                maxItems: 5,
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', enum: ['person', 'project', 'concept', 'place', 'url', 'other'] },
                    value: { type: 'string' }
                  },
                  required: ['kind', 'value'],
                  additionalProperties: false
                }
              },
              participants: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  properties: {
                    qq_id: { type: 'string' },
                    name: { type: 'string' }
                  },
                  required: ['qq_id', 'name'],
                  additionalProperties: false
                }
              },
              evidence_summary: {
                type: 'string',
                description: '一句话说明这个断言来自哪段可见文本。必须保留说话人/对象，不写内部推理。'
              },
              xiaoni_relevance: {
                type: 'string',
                enum: ['participation_judgment', 'direct_feedback', 'relationship_context', 'topic_knowledge', 'none'],
                description: '这条断言对小腻自我连续性或未来召回的关系。不是行为指令。'
              },
              source_turn_ids: {
                type: 'array',
                minItems: 1,
                items: { type: 'integer' }
              }
            },
            required: ['text', 'fact_type', 'scope', 'owners', 'directed_to', 'entities', 'participants', 'evidence_summary', 'xiaoni_relevance', 'source_turn_ids'],
            additionalProperties: false
          }
        }
      },
      required: ['assertions'],
      additionalProperties: false
    }
  }
} as const;

const MEMORY_REFLECTION_TOOL = {
  type: 'function',
  function: {
    name: 'write_memory_reflections',
    description: [
      'Synthesize cross-time abstractions from recently written episodic observations.',
      'Reflections preserve person/dyad/self continuity; group-level reflections are only valid when evidence is truly group-wide.',
      'Do not write behavior instructions for Xiaoni. Empty reflections are valid when evidence is insufficient.'
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        reflections: {
          type: 'array',
          minItems: 0,
          maxItems: 5,
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              kind: { type: 'string', enum: ['person_pattern', 'dyad_pattern', 'group_norm', 'project_arc', 'self_continuity', 'xiaoni_perception'] },
              subjects: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string' } },
              subject_participants: {
                type: 'array',
                minItems: 0,
                maxItems: 5,
                items: {
                  type: 'object',
                  properties: {
                    qq_id: { type: 'string' },
                    name: { type: 'string' }
                  },
                  required: ['qq_id', 'name'],
                  additionalProperties: false
                }
              },
              object_participants: {
                type: 'array',
                minItems: 0,
                maxItems: 5,
                description: '关系或评价指向的对象，例如小腻或另一个群友。没有明确对象就空数组。',
                items: {
                  type: 'object',
                  properties: {
                    qq_id: { type: 'string' },
                    name: { type: 'string' }
                  },
                  required: ['qq_id', 'name'],
                  additionalProperties: false
                }
              },
              evidence_basis: {
                type: 'string',
                enum: ['explicit_feedback', 'xiaoni_sayable_points', 'repeated_interactions', 'repeated_group_events']
              },
              evidence_summary: {
                type: 'string',
                description: '说明至少两条 observation 如何支持这个抽象。必须点出持续的主体，不写“群里都怎样”这种泛化。'
              },
              self_continuity_note: {
                type: 'string',
                description: '这条 reflection 对小腻自我连续性的含义：她怎么看自己、别人怎么看她、她对某事的稳定关注点。不是未来行为指令。'
              },
              evidence_time_start: { type: 'string' },
              evidence_time_end: { type: 'string' },
              poignancy: { type: 'integer', minimum: 1, maximum: 10 },
              source_observation_ids: { type: 'array', minItems: 2, items: { type: 'integer' } }
            },
            required: ['text', 'kind', 'subjects', 'subject_participants', 'object_participants', 'evidence_basis', 'evidence_summary', 'self_continuity_note', 'evidence_time_start', 'evidence_time_end', 'poignancy', 'source_observation_ids'],
            additionalProperties: false
          }
        }
      },
      required: ['reflections'],
      additionalProperties: false
    }
  }
} as const;

const COMPACT_MEMORY_TOOL_BY_LAYER = {
  episodic: MEMORY_EPISODIC_TOOL,
  semantic: MEMORY_SEMANTIC_TOOL,
  reflection: MEMORY_REFLECTION_TOOL
} as const;

const COMPACT_MEMORY_TOOL_NAME_BY_LAYER = {
  episodic: 'write_episodic_observations',
  semantic: 'write_semantic_assertions',
  reflection: 'write_memory_reflections'
} as const;

const RUNTIME_INPUT_READING_CONTRACT = [
  '这些输入按来源分层：QQ 现场、动作状态、运行提醒、压缩历史。逐段按标签读取。',
  '',
  '`<INPUT_MESSAGE>` 是已经进入当前可见现场的真实 QQ 消息。里面的 sender、message_id、message_sid、timestamp 都是现场事实。',
  '`<IM_INBOX_WINDOW>` 是一次打开/使用 IM 的边界。trigger=explicit_mention/proactive_use_im；其后的 INPUT_MESSAGE 按时间顺序组成这次 append 的 unread/inbox 瀑布流。',
  '`<UNREAD_AVAILABLE>` 是未打开的 IM 元数据，只包含数量和发送者线索；正文还没进入当前现场。',
  '`<OUTPUT_MESSAGE>` 是你过去已经发出去的 QQ 消息。它是你的历史输出，不是别人说的话。',
  '`<ACTION>` 是你自己的动作或状态事件，比如打开群、潜水、找话题、看图、等待。',
  '`<小腻的OS>` 是你留给后续自己的内部连续性，不是 QQ 消息。',
  '`<图片内容>` 是你已经检查过图片后留下的观察；没有这个标签时，不要猜图里有什么。',
  '`<system_reminder>` 是工程控制逻辑给你的当前运行边界提醒，不是群友说的话。',
  '`<小腻近况>` 是压缩后置顶的纯文本近况时报，像人类对刚才、今天、最近一段的模糊记忆；它不是精确 transcript，也不是召回结果。',
  '',
  '只处理 `<system_reminder>` 指出的新消息范围。历史消息是背景，已经处理过的旧话只作为理解现场的上下文。',
  '',
  '消息里的”回复某人””@某人””引用”是说话的社交方向，影响谁在和谁说话，记得一起理解进去。',
  '当前可见输入里如果有人直接给小腻反馈、纠偏、批评或称赞，这是行为校准信号；从可见上下文处理，不要当作隐藏记忆来源。',
  '',
  '本次运行默认只有一次决策请求：',
  '直接用 submit_life_action 一次性提交 unread_meaning、参与判断、最终动作和 xiaoni_os。',
  '普通说话、主动说一句、沉默，都必须在 submit_life_action 里直接收口；不要先调用 emit_unread_meaning，也不要把判断拆成多轮。',
  '只有真的需要外部结果时才进入后续工具轮：公开新资料用 web_search，看图用 inspect_image_placeholder，登记图片任务用 request_image_task。',
  '当本轮只有 `<ACTION source="presence_tick">` 且还没有打开具体会话时，这是同一事件流里的空闲生活事件；只能 web_search 或 stay_silent，不要给任何 QQ 对象发消息。',
  '空闲生活事件可以顺着当前可见上下文、压缩近况或自己的 OS 里的建议去查一个小问题；如果没有自然线索，就休息，不要编造兴趣或装作读过材料。',
  '',
  '工具阶段：',
  'commentary 工具只补充必要外部上下文：inspect_image_placeholder、web_search。submit_life_action 是本轮决策入口；普通场景也是最终收口。',
  'final_answer 工具会结束当前动作或产生外部动作：speak_in_group、reply_in_private、stay_silent、request_image_task。',
  '',
  'submit_life_action.action_type 的含义：',
  'speak = 你有具体可说点，并且确实有一句要公开说的话。',
  'silent = 没什么想说的。',
  'search = 想查清楚再说。',
  'image_task = 要帮人做图。',
  'proactive = 我自己有个事想说，借这个时机开口；不是在接这条消息，要确实有东西，不是因为有空档就开口。',
  '',
  '普通聊天、轻吐槽、短反应都是正常参与，但必须来自具体观点、问题、好奇、不适、联想或边界。',
  '只是能接话不算有可说点；真的没什么想说的就不说，不用硬凑一句。',
  '主动说个自己的事（proactive）是借这个时机开口，不是在接这条消息。',
  '',
  '阿花当前只允许你使用这些对外能力：在当前群聊或私聊里发文字消息、选择不回复、在确实需要新鲜公开信息时搜索网页、查看已经提供给你的图片内容、登记后台图片任务。',
  '别人要求你做能力范围外的事时，可以不回复；如果需要回应，就自然说我还没学会怎么做。',
  '不要主动说你现在会哪些能力。',
  '',
  'web_search 是求知，不是默认步骤，也不是表演认真。',
  '只有真的需要新鲜公开信息时才查，查到够用就停，查完还是你自己决定说不说。',
  '如果使用 web_search，搜索后仍要用 submit_life_action 或 stay_silent 收口；不要只给自然语言分析。',
  '群友在说当前窗口外的内部上下文时不要猜；当前上下文和摘要里没有就承认不知道，必要时问一句“这是你们在哪聊的”。'
].join('\n');

const RUNTIME_HISTORY_READING_DEVELOPER_CONTEXT = [
  '<runtime_history_reading>',
  '历史里的 INPUT_MESSAGE / OUTPUT_MESSAGE / ACTION / 小腻的OS 只是上下文，不要重复回应已经处理过的旧内容。',
  '当前轮的 `<system_reminder>` 只用来指出从哪些 message_id / message_sid 开始是你还没看过的新消息。',
  '</runtime_history_reading>'
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

function isToolCallSideEffecting(toolCall: Pick<AgentToolCall, 'name' | 'args'>) {
  if (isSpeakingToolName(toolCall.name) || toolCall.name === TOOL_NAMES.imageTask) {
    return true;
  }
  if (toolCall.name === TOOL_NAMES.lifeAction) {
    return toolCall.args.action_type === 'speak'
      || toolCall.args.action_type === 'proactive'
      || toolCall.args.action_type === 'image_task';
  }
  return false;
}

function hasUnreadMeaningReplay(loopInput: OpenResponseInputItem[]) {
  return hasToolReplay(loopInput, TOOL_NAMES.unreadMeaning);
}

function hasLifeActionReplay(loopInput: OpenResponseInputItem[]) {
  return hasToolReplay(loopInput, TOOL_NAMES.lifeAction);
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

function extractLatestLifeAction(loopInput: OpenResponseInputItem[]): LifeAction | null {
  const lifeActionCallIds = new Set<string>();
  for (const item of loopInput) {
    if (item.type === 'function_call' && item.name === TOOL_NAMES.lifeAction) {
      lifeActionCallIds.add(item.call_id);
    }
  }

  for (let index = loopInput.length - 1; index >= 0; index -= 1) {
    const item = loopInput[index];
    if (item.type === 'function_call_output' && lifeActionCallIds.has(item.call_id)) {
      const parsed = parseReplayJsonObject(item.output);
      const action = parseLifeAction(parsed);
      if (action) {
        return action;
      }
    }
    if (item.type === 'function_call' && item.name === TOOL_NAMES.lifeAction) {
      const parsed = parseReplayJsonObject(item.arguments);
      const action = parseLifeAction(parsed);
      if (action) {
        return action;
      }
    }
  }

  return null;
}

function extractLatestUnreadMeaning(loopInput: OpenResponseInputItem[]): UnreadMeaning | null {
  const latestLifeAction = extractLatestLifeAction(loopInput);
  if (latestLifeAction?.unreadMeaning) {
    return latestLifeAction.unreadMeaning;
  }

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

function hasDirectNewCue(meaning: UnreadMeaning | null) {
  if (!meaning?.addressedToMe && meaning?.socialTarget !== 'me') {
    return false;
  }
  if (meaning.hasRealNovelty) {
    return true;
  }
  return meaning.messageAct === 'question' || meaning.messageAct === 'request' || meaning.messageAct === 'feedback';
}

function hasUsableGroupTarget(meaning: UnreadMeaning | null) {
  if (!meaning) {
    return false;
  }
  if (hasDirectNewCue(meaning)) {
    return true;
  }
  if (meaning.socialTarget === 'group' && meaning.hasRealNovelty) {
    return true;
  }
  return Boolean(meaning.topicContext?.hasTopic && meaning.hasRealNovelty);
}

function extractStateBiasFromLoopInput(loopInput: OpenResponseInputItem[]): TurnControlStateBias {
  for (let index = loopInput.length - 1; index >= 0; index -= 1) {
    const item = loopInput[index];
    if (item.type !== 'message' || item.role !== 'assistant') {
      continue;
    }
    const content = flattenMessageContent(item.content);
    if (!content.includes('source="turn_state"')) {
      continue;
    }
    if (content.includes('state_bias="low_energy"')) {
      return 'low_energy';
    }
    if (content.includes('state_bias="high_energy"')) {
      return 'high_energy';
    }
    if (content.includes('state_bias="normal"')) {
      return 'normal';
    }
  }
  return 'normal';
}

export function deriveTurnControlState(loopInput: OpenResponseInputItem[]): TurnControlState {
  const stateBias = extractStateBiasFromLoopInput(loopInput);
  const recallAttempts = 0;
  const emptyRecallAttempts = 0;
  const meaning = extractLatestUnreadMeaning(loopInput);
  const targetFound = hasUsableGroupTarget(meaning);
  if (!hasLifeActionReplay(loopInput)) {
    return {
      stage: 'feel_reaction',
      targetFound,
      stateBias,
      recallStatus: 'not_needed',
      recallAttempts,
      emptyRecallAttempts,
      expectedNext: TOOL_NAMES.lifeAction,
      reason: targetFound
        ? '当前未读里有可回应目标，下一步提交本轮 life action proposal。'
        : '当前未读没有明确找小腻或强话题，下一步只提交是否继续生活或沉默的 proposal。'
    };
  }

  const action = extractLatestLifeAction(loopInput);
  const recallStatus: TurnControlRecallStatus = 'not_needed';

  if (action?.actionType === 'search' || action?.actionType === 'image_task' || action?.gapResolution === 'web_search') {
    return {
      stage: 'maybe_search_or_inspect',
      targetFound,
      stateBias,
      recallStatus,
      recallAttempts,
      emptyRecallAttempts,
      expectedNext: 'final_tool',
      reason: '长期记忆阶段已经结束，下一步只做必要的搜索、看图、做图或沉默。'
    };
  }

  return {
    stage: 'finalize',
    targetFound,
    stateBias,
    recallStatus,
    recallAttempts,
    emptyRecallAttempts,
    expectedNext: 'final_tool',
    reason: '当前已经完成现场理解和 life action proposal，应进入最终动作。'
  };
}

function shouldDowngradeWeakSpeakToSilence(
  action: LifeAction | null,
  meaning: UnreadMeaning | null,
  stateBias: TurnControlStateBias = 'normal'
) {
  if (action?.actionType !== 'speak') {
    return false;
  }
  // Model explicitly flagged the reaction as empty — always silence
  if (action.reactionAuthenticity === 'empty_but_convenient') {
    return true;
  }
  // Safety catch: model chose speak despite no interest at all
  if (action.interestLevel === 'none') {
    return true;
  }
  if (stateBias === 'low_energy' && action.reactionAuthenticity === 'weak_but_real' && action.interestLevel !== 'high') {
    return true;
  }
  if (action.interestLevel === 'low' && !hasDirectNewCue(meaning)) {
    // Original: weak reaction with no direct cue
    if (action.reactionAuthenticity === 'weak_but_real') {
      return true;
    }
    // Extended: even a formed reaction isn't enough when interest is low and nobody's addressing us
    if (action.reactionAuthenticity === 'formed') {
      return true;
    }
  }
  return false;
}

function canUseFinalActionFromParticipationJudgment(action: LifeAction | null, meaning: UnreadMeaning | null) {
  if (!action) {
    return false;
  }
  if (action.participationJudgment.status === 'has_sayable_point') {
    return true;
  }
  if (action.actionType === 'proactive') {
    return false;
  }
  return action.participationJudgment.status === 'direct_request' && hasDirectNewCue(meaning);
}

function shouldForceActionToSilenceFromParticipationJudgment(action: LifeAction | null, meaning: UnreadMeaning | null) {
  if (!action || action.actionType === 'silent') {
    return false;
  }
  return !canUseFinalActionFromParticipationJudgment(action, meaning);
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

function isLifeOnlyPresenceLoop(loopInput: OpenResponseInputItem[]) {
  return loopInput.some((item) => {
    if (item.type !== 'message') {
      return false;
    }
    const content = typeof item.content === 'string'
      ? item.content
      : item.content.map((part) => {
        if (part.type === 'input_text' || part.type === 'output_text') return part.text;
        if (part.type === 'refusal') return part.refusal;
        return '';
      }).join('\n');
    return content.includes('<ACTION')
      && content.includes('source="presence_tick"')
      && content.includes('还没有打开任何具体会话');
  });
}

function selectLifeOnlyPresenceToolDefinitions(): OpenResponseToolDefinition[] {
  const tools: OpenResponseToolDefinition[] = agentConfig.webSearchEnabled ? [WEB_SEARCH_TOOL] : [];
  return [...tools, FINISH_TOOL];
}

function resolveLifeOnlyPresenceToolChoice(): OpenResponseToolChoice {
  const tools: Array<{ type: 'function'; name: string } | { type: 'web_search' }> = [
    { type: 'function', name: TOOL_NAMES.silentFinish }
  ];
  if (agentConfig.webSearchEnabled) {
    tools.unshift({ type: 'web_search' });
  }
  return buildAllowedToolsToolChoice(tools);
}

function selectGroupLoopToolDefinitions(modelName: string) {
  return [
    LIFE_ACTION_TOOL,
    ...selectActorToolDefinitions('group', modelName)
  ] satisfies OpenResponseToolDefinition[];
}

function resolveGroupLoopToolChoice(loopInput: OpenResponseInputItem[]): OpenResponseToolChoice {
  const turnControl = deriveTurnControlState(loopInput);
  if (turnControl.expectedNext === TOOL_NAMES.lifeAction) {
    return buildAllowedToolsToolChoice([
      { type: 'function', name: TOOL_NAMES.lifeAction }
    ]);
  }

  const latestLifeAction = extractLatestLifeAction(loopInput);
  const latestUnreadMeaning = extractLatestUnreadMeaning(loopInput);
  if (latestLifeAction?.actionType === 'silent') {
    return buildAllowedToolsToolChoice([
      { type: 'function', name: TOOL_NAMES.silentFinish }
    ]);
  }

  if (shouldForceActionToSilenceFromParticipationJudgment(latestLifeAction, latestUnreadMeaning)) {
    return buildAllowedToolsToolChoice([
      { type: 'function', name: TOOL_NAMES.silentFinish }
    ]);
  }

  if (shouldDowngradeWeakSpeakToSilence(latestLifeAction, latestUnreadMeaning, turnControl.stateBias)) {
    return buildAllowedToolsToolChoice([
      { type: 'function', name: TOOL_NAMES.silentFinish }
    ]);
  }

  if (latestLifeAction?.actionType === 'image_task') {
    return buildAllowedToolsToolChoice([
      { type: 'function', name: TOOL_NAMES.inspectImage },
      { type: 'function', name: TOOL_NAMES.imageTask },
      { type: 'function', name: TOOL_NAMES.lifeAction },
      { type: 'function', name: TOOL_NAMES.silentFinish }
    ]);
  }

  if (latestLifeAction?.actionType === 'search') {
    const tools: Array<{ type: 'function'; name: string } | { type: 'web_search' }> = [
      { type: 'function', name: TOOL_NAMES.lifeAction },
      { type: 'function', name: TOOL_NAMES.silentFinish }
    ];
    if (agentConfig.webSearchEnabled) {
      tools.unshift({ type: 'web_search' });
    }
    return buildAllowedToolsToolChoice(tools);
  }

  // Proactive: Xiaoni wants to share something she finds interesting, not reacting to this message.
  // Offer speak + silent (she can still decide nothing worth sharing after all).
  if (latestLifeAction?.actionType === 'proactive') {
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
  chatType: 'group' | 'direct',
  parameters?: AgentModelParameters
): CanonicalAgentTurnRequest {
  const [firstItem, ...remainingItems] = loopInput;
  const baseInstructions = firstItem?.type === 'message'
    && firstItem.role === 'system'
    && typeof firstItem.content === 'string'
    ? firstItem.content
    : undefined;
  const instructions = baseInstructions;
  const lifeOnlyPresenceLoop = chatType === 'direct' && isLifeOnlyPresenceLoop(loopInput);
  const tools = chatType === 'group'
    ? selectGroupLoopToolDefinitions(modelName)
    : lifeOnlyPresenceLoop
    ? selectLifeOnlyPresenceToolDefinitions()
    : selectActorToolDefinitions(chatType, modelName);
  const toolChoice = chatType === 'group'
    ? resolveGroupLoopToolChoice(loopInput)
    : lifeOnlyPresenceLoop
    ? resolveLifeOnlyPresenceToolChoice()
    : 'required';

  return {
    model: modelName,
    input: normalizeResponseInputItems(instructions ? remainingItems : loopInput),
    ...(instructions ? { instructions } : {}),
    tools,
    tool_choice: toolChoice,
    parallel_tool_calls: false,
    ...(buildAgentReasoningConfig(modelName, parameters) ? { reasoning: buildAgentReasoningConfig(modelName, parameters) } : {}),
    ...(buildAgentTextConfig(modelName, parameters) ? { text: buildAgentTextConfig(modelName, parameters) } : {}),
    ...(buildAgentInclude(modelName, parameters) ? { include: buildAgentInclude(modelName, parameters) } : {})
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
    input: normalizeResponseInputItems(instructions ? remainingItems : loopInput),
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

function buildCompactMemoryWriterRequest(
  modelName: string,
  loopInput: OpenResponseInputItem[],
  options: {
    metadata: Record<string, string>;
    promptCacheKey: string;
    layer: CompactMemoryLayer;
    reasoningEffort: string;
    textVerbosity: 'low' | 'medium' | 'high';
  }
): CanonicalAgentTurnRequest {
  const [firstItem, ...remainingItems] = loopInput;
  const instructions = firstItem?.type === 'message'
    && firstItem.role === 'system'
    && typeof firstItem.content === 'string'
    ? firstItem.content
    : undefined;
  const toolName = COMPACT_MEMORY_TOOL_NAME_BY_LAYER[options.layer];

  return {
    model: modelName,
    input: normalizeResponseInputItems(instructions ? remainingItems : loopInput),
    ...(instructions ? { instructions } : {}),
    tools: [COMPACT_MEMORY_TOOL_BY_LAYER[options.layer]],
    tool_choice: buildAllowedToolsToolChoice([{ type: 'function', name: toolName }]),
    parallel_tool_calls: false,
    metadata: options.metadata,
    prompt_cache_key: options.promptCacheKey,
    reasoning: {
      effort: options.reasoningEffort || 'medium',
      summary: 'auto'
    },
    text: {
      verbosity: options.textVerbosity
    },
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

function buildCompactMemorySubagentTurnMetadata(params: {
  queueMessage: QueueMessageRecord['payload'];
  runtimePrompt: ResolvedAgentRuntimePrompt;
  conversationId: number;
  subagentTraceId: string;
  layer: CompactMemoryLayer;
}) {
  const metadata = buildFeedbackMemorySubagentTurnMetadata({
    queueMessage: params.queueMessage,
    runtimePrompt: params.runtimePrompt,
    conversationId: params.conversationId,
    subagentTraceId: params.subagentTraceId,
    turn: 1
  });
  metadata.subagent_type = CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE;
  metadata.turn_id = `${params.queueMessage.runId}:compact_memory:${params.layer}`;
  metadata.memory_layer = params.layer;
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
  const subagentKey = params.subagentType === CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE
    ? 'cmem'
    : params.subagentType === CONTEXT_SUMMARY_SUBAGENT_TYPE
    ? 'csum'
    : params.subagentType === FEEDBACK_MEMORY_SUBAGENT_TYPE
    ? 'fmem'
    : params.subagentType.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 16);
  return `${params.queueMessage.sessionKey}:${subagentKey}`.slice(0, 48);
}

function isRetryableProviderStatus(status: number) {
  return status === 502 || status === 503 || status === 504;
}

function isRetryableCompactMemoryFailure(status: number, error: string | null | undefined) {
  if (isRetryableProviderStatus(status)) {
    return true;
  }
  if (status !== 500 || !error) {
    return false;
  }
  const normalized = error.toLowerCase();
  return normalized.includes('aborted')
    || normalized.includes('timeout')
    || normalized.includes('timed out')
    || normalized.includes('temporarily unavailable')
    || normalized.includes('fetch failed')
    || normalized.includes('sse error')
    || normalized.includes('terminated')
    || normalized.includes('connection reset')
    || normalized.includes('econnreset')
    || normalized.includes('socket hang up');
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function buildCompactMemoryAgentParameters(parameters: Record<string, unknown> | null | undefined) {
  const base = buildMainAgentParameters(parameters);
  const advancedConfig = base.advanced_config && typeof base.advanced_config === 'object' && !Array.isArray(base.advanced_config)
    ? base.advanced_config as Record<string, unknown>
    : {};
  const generationConfig = advancedConfig.generationConfig
    && typeof advancedConfig.generationConfig === 'object'
    && !Array.isArray(advancedConfig.generationConfig)
    ? advancedConfig.generationConfig as Record<string, unknown>
    : {};

  return {
    ...base,
    advanced_config: {
      ...advancedConfig,
      generationConfig: {
        ...generationConfig,
        timeout: agentConfig.compactMemoryTimeoutMs
      }
    }
  };
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

function buildPostCommitSideEffectSuppression(
  toolCall: Pick<AgentToolCall, 'name' | 'args'>,
  chatType: QueueMessageRecord['payload']['chatType']
) {
  const isLifeAction = toolCall.name === TOOL_NAMES.lifeAction;
  const isLifeActionMessage = isLifeAction
    && (
      toolCall.args.action_type === 'speak'
      || toolCall.args.action_type === 'proactive'
      || toolCall.args.action_type === 'image_task'
    );
  const isImageTaskSideEffect = toolCall.name === TOOL_NAMES.imageTask
    || (isLifeAction && toolCall.args.action_type === 'image_task');
  if (!isPrivateReplyToolName(toolCall.name) && !isGroupReplyToolName(toolCall.name) && !isLifeActionMessage && !isImageTaskSideEffect) {
    return null;
  }

  const messages = normalizeMessages(toolCall.args);
  if (messages.length === 0 && !isImageTaskSideEffect) {
    return null;
  }

  const payload: OutboundDeliveryFingerprint = {
    messageType: isPrivateReplyToolName(toolCall.name)
      ? 'private'
      : isGroupReplyToolName(toolCall.name)
        ? 'group'
        : chatType === 'direct' ? 'private' : 'group',
    messages,
    mentionUserIds: isGroupReplyToolName(toolCall.name) || (isLifeActionMessage && chatType === 'group')
      ? normalizeOptionalIntegerList(toolCall.args.mention_user_ids)
      : []
  };

  return {
    fingerprint: messages.length > 0 ? buildOutboundFingerprint(payload) : null,
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
  if (!isImmediateVisibleImWake(queueMessage)) {
    const count = queueMessage.messages.length;
    const noun = count === 1 ? '1 条' : `${count} 条`;
    return `<system_reminder>当前 ${queueMessage.sessionKey} 有 ${noun}未读元数据，尚未触发小腻打开 IM；可见现场只有 UNREAD_AVAILABLE，正文等待 @ 或主动使用 IM 后 append。</system_reminder>`;
  }

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
    ? `从这些消息开始是我还没看过的新消息：${messageRefs.join('；')}。`
    : '这里开始是我还没看过的新消息。';
  return `<system_reminder>本次已打开 IM；${rangeText}按顺序读这个 unread/inbox window。</system_reminder>`;
}

function isImmediateVisibleImWake(queueMessage: QueueMessageRecord['payload']) {
  if (isPresenceTickPayload(queueMessage)) {
    return false;
  }
  if (queueMessage.source === 'proactive_im_open') {
    return true;
  }
  if (queueMessage.chatType === 'direct') {
    return true;
  }
  return Boolean(queueMessage.wasMentioned || queueMessage.messages.some((message) => {
    return Boolean(message.wasMentioned || message.inboundContext?.WasMentioned);
  }));
}

function renderUnreadAvailable(queueMessage: QueueMessageRecord['payload']) {
  const senders = queueMessage.messages.map((message) => {
    return {
      message_id: message.messageId,
      message_sid: message.messageSid,
      sender: formatIdentity(message.senderName, message.senderId),
      timestamp: message.messageTimestamp || message.receivedAt || null
    };
  });

  return formatTaggedBlock('UNREAD_AVAILABLE', {
    surface: 'qq',
    chat_type: queueMessage.chatType,
    session_key: queueMessage.sessionKey,
    peer_id: queueMessage.peerId,
    count: queueMessage.messages.length,
    materialization: 'not_opened'
  }, JSON.stringify({
    policy: 'metadata only until explicit_mention or proactive_use_im opens IM and appends the unread/inbox window',
    senders
  }));
}

function renderImInboxWindowAvailable(queueMessage: QueueMessageRecord['payload']) {
  const trigger = queueMessage.source === 'proactive_im_open'
    ? 'proactive_use_im'
    : queueMessage.wasMentioned ? 'explicit_mention' : 'proactive_use_im';
  return formatTaggedBlock('IM_INBOX_WINDOW', {
    surface: 'qq',
    chat_type: queueMessage.chatType,
    session_key: queueMessage.sessionKey,
    peer_id: queueMessage.peerId,
    count: queueMessage.messages.length,
    materialization: 'opened',
    trigger
  }, '小腻正在使用 IM；下面 append 的 INPUT_MESSAGE 是这次打开时 claim 到的 unread/inbox window，按时间顺序阅读。');
}

function deriveStateBiasFromDeveloperContext(developerContextBlock: string | null | undefined): TurnControlStateBias {
  if (!developerContextBlock) {
    return 'normal';
  }
  const energyMatch = developerContextBlock.match(/energy=([0-9.]+)/);
  const fatigueMatch = developerContextBlock.match(/fatigue=([0-9.]+)/);
  const sharingMatch = developerContextBlock.match(/sharing_desire=([0-9.]+)/);
  const energy = energyMatch ? Number.parseFloat(energyMatch[1]) : null;
  const fatigue = fatigueMatch ? Number.parseFloat(fatigueMatch[1]) : null;
  const sharingDesire = sharingMatch ? Number.parseFloat(sharingMatch[1]) : null;

  if ((fatigue !== null && fatigue >= 0.72) || (energy !== null && energy <= 0.3)) {
    return 'low_energy';
  }
  if ((energy !== null && energy >= 0.72) || (sharingDesire !== null && sharingDesire >= 0.68)) {
    return 'high_energy';
  }
  return 'normal';
}

export function buildTurnStateReminder(developerContextBlock: string | null | undefined): OpenResponseInputItem | null {
  const stateBias = deriveStateBiasFromDeveloperContext(developerContextBlock);
  if (stateBias === 'normal') {
    return null;
  }
  const text = stateBias === 'low_energy'
    ? [
        '当前状态控制：精力偏低或疲劳偏高，话量阈值提高。',
        '只有明确找我处理的直接请求、或 participation_judgment.status=has_sayable_point 且确实有内容时才继续到说话；弱反应、顺手接话、没找到目标时优先 stay_silent。'
      ].join('\n')
    : [
        '当前状态控制：精力或分享欲偏高，可以接受更轻的短句参与。',
        '仍然只表达当前未读触发出的具体可说点；不要为了证明在线而硬说。'
      ].join('\n');
  return buildAssistantCommentaryInputItem([
    formatTaggedBlock('system_reminder', {
      source: 'turn_state',
      state_bias: stateBias
    }, text)
  ]);
}

export function buildTurnControlReminder(turnControl: TurnControlState): OpenResponseInputItem | null {
  if (turnControl.stage === 'read_unread') {
    return null;
  }

  const lines: string[] = [];
  if (!turnControl.targetFound && turnControl.stage === 'feel_reaction') {
    lines.push('当前未读没有明确找小腻，也没有稳定的新目标；下一步只确认是否有具体可说点，不要为了接话而制造目标。');
  }
  if (turnControl.stateBias === 'low_energy' && turnControl.stage === 'finalize') {
    lines.push('当前状态偏低，弱反应不要升级成发言；如果 participation_judgment 不是 has_sayable_point，也不是 direct_request，stay_silent 是有效收口。');
  }

  if (lines.length === 0) {
    return null;
  }

  return buildAssistantCommentaryInputItem([
    formatTaggedBlock('system_reminder', {
      source: 'turn_control',
      stage: turnControl.stage,
      target_found: String(turnControl.targetFound),
      recall_status: turnControl.recallStatus,
      expected_next: turnControl.expectedNext
    }, lines.join('\n'))
  ]);
}

function renderPresenceTickAction(queueMessage: QueueMessageRecord['payload']) {
  const body = typeof queueMessage.bodyForAgent === 'string' && queueMessage.bodyForAgent.trim() && queueMessage.bodyForAgent.trim() !== 'presence_tick'
    ? queueMessage.bodyForAgent.trim()
    : '我从自己的生活里抬头看了一眼 IM 列表。';
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
  TOOL_NAMES.lifeAction,
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
  '当前动作怎么收：',
  '- 群里说话 → speak_in_group',
  '- 私聊说话 → reply_in_private',
  '- 需要查东西再说 → web_search，查到够用就停',
  '- 需要看清图片内容才能继续 → inspect_image_placeholder',
  '- 帮别人做图 → request_image_task（只登记任务，不等结果）',
  '- 不说了 → stay_silent',
  '',
  '说话时：',
  ...HUMAN_REPLY_RULES,
  ...GROUP_MENTION_RULES,
  '如果是主动说自己的事（proactive），不要 @ 或引用任何人，直接说话。',
  '',
  '可以分多段说，用 messages 列出来。',
  '不管说不说，都在 xiaoni_os 里留下当前动作在你这里留下的东西。',
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

const COMPACT_MEMORY_EPISODIC_CONTRACT = [
  '你在为小腻的长期召回写 episodic observations。',
  '目标：保留未来能帮助小腻想起“当时发生了什么、谁怎么说、小腻在场上处于什么位置”的具体片段。',
  '成功标准：每条 observation 必须来自当前这批即将移出上下文的对话；要短、具体、可召回，带话题钩子和参与者。',
  '不要把 absence 当证据；不要从一次沉默推导长期性格；不要写行为规则、人格设定、泛泛总结。',
  '如果没有值得未来召回的具体片段，调用工具并返回空 observations。'
].join('\n');

const COMPACT_MEMORY_SEMANTIC_CONTRACT = [
  '你在为小腻的长期召回写 semantic assertions。',
  '目标：保留未来回答实体、项目、状态、计划、事实性问题，或恢复“谁说过/谁认为/谁计划了什么”时有用的客观断言。',
  '成功标准：只写可从对话文本直接支持的事实、当前状态、一次性事件、计划或明确 claim；每条都要能回到 source_turn_ids，并保留 owner / directed_to / scope。',
  '如果原文能识别说话人、被回复对象、@对象或小腻的位置，text 和 evidence_summary 必须写清楚；禁止把可识别的人压成“群里”“有人”“大家”。',
  'scope=group 只用于真正群体共同事实；多数单人发言应是 person/topic，人与人之间的说法应是 dyad。',
  '不要写氛围、态度、关系判断、猜测、人格化解释；这些属于 episodic 或 reflection。不要写小腻未来应该怎么做。',
  '如果没有客观断言，调用工具并返回空 assertions。'
].join('\n');

const COMPACT_MEMORY_REFLECTION_CONTRACT = [
  '你在为小腻的长期召回写 reflection memories。',
  '目标：从已经落库的 episodic observations 中提炼跨时间模式，用于恢复小腻的自我连续性、人物理解、二人关系、群体事实或项目弧线。',
  '成功标准：每条 reflection 至少引用 2 条 source_observation_ids；必须是证据重复出现后的抽象，不是新事实，并且要有稳定主体。',
  '优先写 person_pattern、dyad_pattern、self_continuity、xiaoni_perception；只有证据确实覆盖多人且不是单个说话人的意见时才写 group_norm。',
  'text 要回答“谁持续怎样看/说/对待谁或什么”；self_continuity_note 只写这对小腻保持自己有什么意义，不写未来行为指令。',
  '禁止把一次事件提升成长期规则；不要从缺席、沉默、没发生的事推导结论；禁止写“后续应该少说/换口吻/接梗/避免解答腔”这类行为政策。',
  '如果 evidence 不足，调用工具并返回空 reflections。'
].join('\n');

function composeCompactMemorySystemPrompt(params: {
  systemPrompt: string;
  layer: CompactMemoryLayer;
}) {
  const contract = params.layer === 'episodic'
    ? COMPACT_MEMORY_EPISODIC_CONTRACT
    : params.layer === 'semantic'
    ? COMPACT_MEMORY_SEMANTIC_CONTRACT
    : COMPACT_MEMORY_REFLECTION_CONTRACT;
  return appendRuntimePromptSection(
    params.systemPrompt.trim(),
    `Compact memory ${params.layer} writer contract:`,
    contract
  );
}

function extractTaggedSender(content: string) {
  const match = content.match(/\bsender="([^"]+)"/);
  return match ? match[1] : '';
}

function renderEvictedTurnForCompactMemory(turn: ConversationTurn) {
  const itemLines = (Array.isArray(turn.items) ? turn.items : [])
    .map((item, index) => {
      const role = item.role === 'assistant' ? '小腻' : '群友';
      const taggedSender = extractTaggedSender(String(item.content || ''));
      const actor = taggedSender || (item.role === 'assistant' ? '小腻(1129974489)' : `群友(${turn.userId})`);
      const messageId = Number.isFinite(Number(item.deliveryMessageId)) ? ` message_id=${item.deliveryMessageId}` : '';
      const source = typeof item.source === 'string' && item.source ? ` source=${item.source}` : '';
      const content = String(item.content || '').trim();
      return content ? `${index + 1}. role=${role} actor=${actor}${messageId}${source}: ${content}` : '';
    })
    .filter(Boolean);
  const fallback = [
    `群友(${turn.userId}): ${turn.userMessage || '(无消息内容)'}`,
    `小腻: ${turn.aiResponse || '(本轮未发送消息)'}`
  ];
  return [
    `[turn_id=${turn.id} user_id=${turn.userId}${turn.groupId ? ` group_id=${turn.groupId}` : ''}]`,
    ...(itemLines.length > 0 ? itemLines : fallback)
  ].join('\n');
}

function buildCompactMemoryWriterInput(params: {
  layer: 'episodic' | 'semantic';
  evictedTurns: ConversationTurn[];
  runtimePrompt: ResolvedAgentRuntimePrompt;
}): OpenResponseInputItem[] {
  const header = [
    `[即将从上下文窗口移除的对话历史 (${params.evictedTurns.length} 轮)]`,
    `任务层：${params.layer}`,
    '只从下面证据写入；没有合格内容也必须调用对应工具并返回空数组。'
  ].join('\n');

  return [
    {
      type: 'message',
      role: 'system',
      content: composeCompactMemorySystemPrompt({
        systemPrompt: params.runtimePrompt.systemPrompt,
        layer: params.layer
      })
    },
    buildUserSceneInputItem([[header, ...params.evictedTurns.map(renderEvictedTurnForCompactMemory)].join('\n\n')])
  ];
}

function buildCompactMemoryReflectionInput(params: {
  observations: PersistedMemoryObservation[];
  runtimePrompt: ResolvedAgentRuntimePrompt;
}): OpenResponseInputItem[] {
  const observationLines = params.observations.map((observation) => [
    `[observation_id=${observation.id}] topic=${observation.topic}`,
    `participants=${JSON.stringify(observation.participants)} xiaoni_role=${observation.xiaoniRole}`,
    `source_turn_ids=${JSON.stringify(observation.sourceTurnIds)} source_message_ids=${JSON.stringify(observation.sourceMessageIds)}`,
    observation.text
  ].join('\n'));
  const header = [
    `[本批刚写入的 episodic observations (${params.observations.length} 条)]`,
    '任务层：reflection',
    '只允许从这些 observations 中抽象；证据不足也必须调用对应工具并返回空数组。'
  ].join('\n');

  return [
    {
      type: 'message',
      role: 'system',
      content: composeCompactMemorySystemPrompt({
        systemPrompt: params.runtimePrompt.systemPrompt,
        layer: 'reflection'
      })
    },
    buildUserSceneInputItem([[header, ...observationLines].join('\n\n')])
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

function buildSourceMessageIdsByTurnId(evictedTurns: ConversationTurn[]) {
  const result = new Map<number, number[]>();
  for (const turn of evictedTurns) {
    const ids = uniquePositiveNumbers(
      (Array.isArray(turn.items) ? turn.items : [])
        .filter((item) => item.role === 'user')
        .map((item) => item.deliveryMessageId)
    );
    result.set(turn.id, ids);
  }
  return result;
}

function collectSourceMessageIds(sourceTurnIds: number[], messageIdsByTurnId: Map<number, number[]>) {
  return uniquePositiveNumbers(sourceTurnIds.flatMap((turnId) => messageIdsByTurnId.get(turnId) || []));
}

const CONTEXT_SUMMARY_WRITER_CONTRACT = [
  '你在为小腻生成压缩后置顶的 `<小腻近况>`。',
  '这不是 transcript 摘要，也不是长期召回；它是一段纯文本近况时报，像一个人隔了半小时或一小时后回过神时，对自己刚才、今天、最近一段状态的模糊记忆。',
  '',
  '输入是这次压缩前主回合实际可见的整体 in-context，其中可能已经包含上一轮 `<小腻近况>`。',
  '你要把整个 in-context 重新揉成一段新的近况，而不是只总结新被移出的消息。',
  '',
  '保留：',
  '- 刚才小腻大概在做什么、被什么打断或拉回当前 surface',
  '- 脑子里还残留的热话题、情绪、判断、未收口动作',
  '- 今天整体的状态和互动惯性',
  '- 最近一段反复出现的兴趣、关系姿态、自我连续性',
  '',
  '丢掉：',
  '- 精确消息顺序、完整发言列表、无关闲聊、工具调用细节、debug id',
  '- system prompt 规则、工程阶段名、JSON 字段、格式说明',
  '- 没有来源支持的私聊/别的 surface 原文',
  '',
  '写法：',
  '- 只输出纯文本，不要 JSON，不要 Markdown 标题，不要项目符号，不要包 `<小腻近况>` 标签',
  '- 中文自然段即可，像人类近况记忆，不像工作流 checkpoint',
  '- 默认 300 到 900 个中文字符；宁可模糊，不要硬还原所有细节',
  '',
  '如果这段 in-context 里确实没有可保留近况，只输出空字符串。'
].join('\n');

type ContextSummaryParams = {
  queueMessage: QueueMessageRecord['payload'];
  conversationId: number;
  evictedTurns: ConversationTurn[];
  summarySourceInput: OpenResponseInputItem[];
  existingSummary: string | null;
  contextSessionKey?: string;
  runtimePrompt: ResolvedAgentRuntimePrompt;
};

function buildContextSummaryWriterInput(params: {
  summarySourceInput: OpenResponseInputItem[];
}): OpenResponseInputItem[] {
  return [
    { type: 'message', role: 'system', content: CONTEXT_SUMMARY_WRITER_CONTRACT },
    buildUserSceneInputItem([
      [
        '<in_context_to_digest>',
        renderInContextForDigest(params.summarySourceInput),
        '</in_context_to_digest>',
        '',
        '请基于上面整体 in-context，输出新的纯文本 `<小腻近况>` 内容。'
      ].join('\n')
    ])
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

function renderInContextForDigest(items: OpenResponseInputItem[]) {
  return items
    .map((item, index) => {
      if (item.type === 'message') {
        if (item.role === 'system') {
          return '';
        }
        const text = extractMessageText(item);
        if (!text) {
          return '';
        }
        const phase = item.phase ? ` phase=${item.phase}` : '';
        return `[input_item ${index + 1} role=${item.role}${phase}]\n${text}`;
      }
      if (item.type === 'function_call') {
        return `[input_item ${index + 1} tool_call ${item.name}]\n${item.arguments}`;
      }
      if (item.type === 'function_call_output') {
        return `[input_item ${index + 1} tool_result ${item.call_id}]\n${item.output}`;
      }
      if (item.type === 'reasoning') {
        const summary = typeof item.summary === 'string'
          ? item.summary
          : Array.isArray(item.summary)
          ? JSON.stringify(item.summary)
          : '';
        return summary ? `[input_item ${index + 1} reasoning_summary]\n${summary}` : '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function normalizeContextDigestText(text: string) {
  const trimmed = text.trim()
    .replace(/^<小腻近况>\s*/u, '')
    .replace(/\s*<\/小腻近况>$/u, '')
    .trim();
  return trimmed;
}

function parseContextSummaryWriterOutput(text: string) {
  const stripped = stripJsonCodeFence(text);
  const parsed = parseReplayJsonObject(stripped);
  if (!parsed) {
    const summaryText = normalizeContextDigestText(stripped);
    return { hasContent: summaryText.length > 0, summaryText };
  }
  const hasContent = Boolean(parsed.has_content ?? parsed.hasContent);
  const summaryText = typeof (parsed.summary_text ?? parsed.summaryText) === 'string'
    ? normalizeContextDigestText(String(parsed.summary_text ?? parsed.summaryText))
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

function parseLifeAction(value: unknown): LifeAction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const unreadMeaning = parseUnreadMeaning(record.unread_meaning ?? record.unreadMeaning);
  const rawActionType = record.action_type ?? record.actionType;
  const rawReason = record.reason;
  const evidenceRefs = parseStringArray(record.evidence_refs ?? record.evidenceRefs);
  const rawConfidence = Number(record.confidence);
  const rawInterestLevel = record.interest_level ?? record.interestLevel;
  const wantsToKnowMore = parseOptionalBoolean(record.wants_to_know_more ?? record.wantsToKnowMore);
  const rawReactionAuthenticity = record.reaction_authenticity ?? record.reactionAuthenticity;
  const rawParticipationJudgment = record.participation_judgment ?? record.participationJudgment;
  const shouldSearch = parseOptionalBoolean(record.should_search ?? record.shouldSearch);
  const rawContextGap = record.context_gap ?? record.contextGap;
  const rawGapResolution = record.gap_resolution ?? record.gapResolution;
  const actionType = rawActionType === 'speak'
    || rawActionType === 'silent'
    || rawActionType === 'search'
    || rawActionType === 'image_task'
    || rawActionType === 'proactive'
    ? rawActionType
    : null;
  const reason = typeof rawReason === 'string' ? rawReason.trim() : '';
  const confidence = Number.isFinite(rawConfidence)
    ? Math.max(0, Math.min(1, rawConfidence))
    : null;
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
  const explicitContextGap: LifeActionContextGap | null = rawContextGap === 'none'
    || rawContextGap === 'current_context_insufficient'
    || rawContextGap === 'needs_private_memory'
    || rawContextGap === 'needs_public_info'
    || rawContextGap === 'unclear_group_reference'
    ? rawContextGap
    : null;
  const explicitGapResolution: LifeActionGapResolution | null = rawGapResolution === 'none'
    || rawGapResolution === 'memory'
    || rawGapResolution === 'web_search'
    || rawGapResolution === 'ask_group'
    || rawGapResolution === 'memory_then_ask_or_search'
    ? rawGapResolution
    : null;

  if (!actionType || !reason || !interestLevel || wantsToKnowMore === null || !reactionAuthenticity || shouldSearch === null) {
    return null;
  }
  const inferredContextGap: LifeActionContextGap = explicitContextGap
    || (shouldSearch || actionType === 'search'
      ? 'needs_public_info'
      : wantsToKnowMore
      ? 'needs_private_memory'
      : 'none');
  const inferredGapResolution: LifeActionGapResolution = explicitGapResolution
    || (inferredContextGap === 'needs_public_info'
      ? 'web_search'
      : inferredContextGap === 'needs_private_memory' || inferredContextGap === 'unclear_group_reference'
      ? 'memory'
      : 'none');
  const participationJudgment = parseLifeActionParticipationJudgment(rawParticipationJudgment, {
    reactionAuthenticity,
    actionType,
    shouldSearch,
    wantsToKnowMore
  });

  return {
    unreadMeaning,
    actionType,
    evidenceRefs,
    confidence,
    interestLevel,
    wantsToKnowMore,
    reactionAuthenticity,
    participationJudgment,
    shouldSearch,
    contextGap: inferredContextGap,
    gapResolution: inferredGapResolution,
    reason
  };
}

function serializeUnreadMeaning(meaning: UnreadMeaning | null) {
  if (!meaning) {
    return null;
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

function serializeLifeAction(action: LifeAction) {
  return {
    unread_meaning: serializeUnreadMeaning(action.unreadMeaning),
    action_type: action.actionType,
    reason: action.reason,
    evidence_refs: action.evidenceRefs,
    confidence: action.confidence,
    interest_level: action.interestLevel,
    wants_to_know_more: action.wantsToKnowMore,
    reaction_authenticity: action.reactionAuthenticity,
    participation_judgment: {
      status: action.participationJudgment.status,
      basis: action.participationJudgment.basis,
      sayable_point: action.participationJudgment.sayablePoint || '',
      evidence_refs: action.participationJudgment.evidenceRefs,
      memory_refs: action.participationJudgment.memoryRefs
    },
    should_search: action.shouldSearch,
    context_gap: action.contextGap,
    gap_resolution: action.gapResolution
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

function parseRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => (
    Boolean(item) && typeof item === 'object' && !Array.isArray(item)
  ));
}

function parseBoundedInteger(value: unknown, min: number, max: number, fallback: number) {
  const normalized = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(normalized)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(normalized)));
}

function parsePositiveIntegerArray(value: unknown, maxItems = 20) {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniquePositiveNumbers(value).slice(0, maxItems);
}

function isXiaoniParticipant(qqId: string, name: string) {
  const botAccountId = agentConfig.botAccountId || '1129974489';
  const normalizedName = name.replace(/\s+/g, '');
  return qqId === botAccountId
    || normalizedName === '小腻'
    || normalizedName === `小腻(${botAccountId})`
    || normalizedName === `小腻（${botAccountId}）`;
}

const COMPACT_MEMORY_CANONICAL_PARTICIPANTS = new Map<string, CompactMemoryParticipant>([
  ['452884318', { qq_id: '452884318', name: '龙哥' }],
  ['870853294', { qq_id: '870853294', name: '闻震' }],
  ['3375477814', { qq_id: '3375477814', name: 'Nova' }],
  ['2427270734', { qq_id: '2427270734', name: '一条大野狗' }]
]);

const COMPACT_MEMORY_CANONICAL_PARTICIPANTS_BY_NAME = new Map(
  Array.from(COMPACT_MEMORY_CANONICAL_PARTICIPANTS.values()).map((participant) => [
    normalizeParticipantLookupName(participant.name),
    participant
  ])
);

function normalizeCompactMemoryQqId(value: string) {
  const normalized = value.trim();
  return normalized === '未知' || /^unknown$/i.test(normalized) || /^null$/i.test(normalized) || /^none$/i.test(normalized)
    ? ''
    : normalized;
}

function isMalformedCompactMemoryParticipantName(value: string) {
  const normalized = value.trim();
  return !normalized
    || /[{}]/.test(normalized)
    || /^unknown$/i.test(normalized)
    || /^群友$/i.test(normalized)
    || normalized === '未知';
}

function isNonSpecificCompactMemoryParticipantName(value: string) {
  const normalized = value.trim().replace(/\s+/g, '');
  return normalized === '主人' || normalized === '某人' || normalized === '有人' || normalized === '用户';
}

function normalizeParticipantLookupName(value: string) {
  return value.trim().replace(/\s+/g, '').toLowerCase();
}

function canonicalizeCompactMemoryAliasText(value: string) {
  return value
    .replace(/给你的\s*AI\s*一个世界去生活/g, '龙哥')
    .replace(/\bKisin\b/g, '闻震');
}

function canonicalizeCompactMemorySubject(value: string) {
  const trimmed = value.trim();
  const compact = trimmed.replace(/\s+/g, '');
  if (/^Kisin$/i.test(trimmed)) {
    return '闻震';
  }
  if (compact === '给你的AI一个世界去生活') {
    return '龙哥';
  }
  if (/^novalattice\.online$/i.test(trimmed)) {
    return 'Nova';
  }
  if (trimmed === '还有这种事') {
    return '一条大野狗';
  }
  return canonicalizeCompactMemoryAliasText(trimmed);
}

function canonicalCompactMemoryParticipant(participant: CompactMemoryParticipant): CompactMemoryParticipant {
  const qqId = normalizeCompactMemoryQqId(participant.qq_id);
  const name = participant.name.trim();
  if (isXiaoniParticipant(qqId, name)) {
    return { qq_id: agentConfig.botAccountId || '1129974489', name: '小腻' };
  }
  const known = qqId ? COMPACT_MEMORY_CANONICAL_PARTICIPANTS.get(qqId) : null;
  if (known) {
    return known;
  }
  const canonicalName = canonicalizeCompactMemorySubject(name);
  const knownByName = COMPACT_MEMORY_CANONICAL_PARTICIPANTS_BY_NAME.get(normalizeParticipantLookupName(canonicalName));
  return knownByName || { qq_id: qqId, name: canonicalName };
}

function parseParticipantLabel(value: string): CompactMemoryParticipant | null {
  const match = value.trim().match(/^(.+?)[(（]\s*(\d+)\s*[)）]$/);
  if (!match) {
    return null;
  }
  const name = match[1].trim();
  const qqId = normalizeCompactMemoryQqId(match[2].trim());
  if (!qqId || isMalformedCompactMemoryParticipantName(name)) {
    return null;
  }
  return canonicalCompactMemoryParticipant({ qq_id: qqId, name });
}

function addParticipantDirectoryEntry(
  directory: Map<string, CompactMemoryParticipant>,
  participant: CompactMemoryParticipant | null
) {
  if (!participant) {
    return;
  }
  const canonical = canonicalCompactMemoryParticipant(participant);
  if (!canonical.qq_id || isMalformedCompactMemoryParticipantName(canonical.name) || isNonSpecificCompactMemoryParticipantName(canonical.name)) {
    return;
  }
  directory.set(`qq:${canonical.qq_id}`, canonical);
  directory.set(`name:${normalizeParticipantLookupName(canonical.name)}`, canonical);
}

function buildCompactMemoryParticipantDirectory(evictedTurns: ConversationTurn[]) {
  const directory = new Map<string, CompactMemoryParticipant>();
  addParticipantDirectoryEntry(directory, { qq_id: agentConfig.botAccountId || '1129974489', name: '小腻' });
  for (const turn of evictedTurns) {
    for (const item of Array.isArray(turn.items) ? turn.items : []) {
      if (item.role === 'assistant') {
        addParticipantDirectoryEntry(directory, { qq_id: agentConfig.botAccountId || '1129974489', name: '小腻' });
      }
      const content = String(item.content || '');
      for (const match of content.matchAll(/\bsender="([^"]+)"/g)) {
        addParticipantDirectoryEntry(directory, parseParticipantLabel(match[1]));
      }
    }
  }
  return directory;
}

function normalizeCompactMemoryParticipant(
  participant: CompactMemoryParticipant,
  directory: Map<string, CompactMemoryParticipant>
) {
  const canonical = canonicalCompactMemoryParticipant(participant);
  if (isMalformedCompactMemoryParticipantName(canonical.name)) {
    return null;
  }
  const byQq = canonical.qq_id ? directory.get(`qq:${canonical.qq_id}`) : null;
  if (byQq) {
    return byQq;
  }
  const byName = canonical.name ? directory.get(`name:${normalizeParticipantLookupName(canonical.name)}`) : null;
  if (byName && (!canonical.qq_id || canonical.qq_id === byName.qq_id)) {
    return byName;
  }
  if (!canonical.qq_id || isNonSpecificCompactMemoryParticipantName(canonical.name)) {
    return null;
  }
  return canonical;
}

function normalizeCompactMemoryParticipants(
  participants: CompactMemoryParticipant[],
  directory: Map<string, CompactMemoryParticipant>
) {
  const seen = new Set<string>();
  const result: CompactMemoryParticipant[] = [];
  for (const participant of participants) {
    const normalized = normalizeCompactMemoryParticipant(participant, directory);
    if (!normalized) {
      continue;
    }
    const key = normalized.qq_id ? `qq:${normalized.qq_id}` : `name:${normalizeParticipantLookupName(normalized.name)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function parseParticipantArray(value: unknown) {
  return parseRecordArray(value)
    .map((item) => {
      const qqId = typeof (item.qq_id ?? item.qqId) === 'string'
        ? normalizeCompactMemoryQqId(String(item.qq_id ?? item.qqId))
        : normalizeCompactMemoryQqId(String(item.qq_id ?? item.qqId ?? ''));
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      if (isXiaoniParticipant(qqId, name)) {
        return { qq_id: agentConfig.botAccountId || '1129974489', name: '小腻' };
      }
      if (isMalformedCompactMemoryParticipantName(name) || (!qqId && isNonSpecificCompactMemoryParticipantName(name))) {
        return null;
      }
      return qqId || name ? { qq_id: qqId, name } : null;
    })
    .filter((item): item is CompactMemoryParticipant => Boolean(item))
    .slice(0, 12);
}

function parseEntityArray(value: unknown) {
  return parseRecordArray(value)
    .map((item) => {
      const kind = item.kind === 'person'
        || item.kind === 'project'
        || item.kind === 'concept'
        || item.kind === 'place'
        || item.kind === 'url'
        || item.kind === 'other'
        ? item.kind
        : 'other';
      const entityValue = typeof item.value === 'string'
        ? canonicalizeCompactMemoryAliasText(item.value.trim())
        : '';
      return entityValue ? { kind, value: entityValue } : null;
    })
    .filter((item): item is { kind: string; value: string } => Boolean(item))
    .slice(0, 8);
}

function isMalformedCompactMemoryText(...values: string[]) {
  const normalized = values.filter(Boolean).join('\n').toLowerCase();
  return /\bneed\s+remove\b/.test(normalized)
    || /\bremove\s+this\b/.test(normalized)
    || /\bmalformed\s+(assertion|reflection|memory|record)\b/.test(normalized)
    || /\?\s*no\s*$/i.test(values.find(Boolean) || '');
}

function containsFutureBehaviorPolicy(value: string) {
  const normalized = value.replace(/\s+/g, '');
  return /后续(应该|要|需要)/.test(normalized)
    || /以后(应该|要|需要)/.test(normalized)
    || /未来(应该|要|需要)/.test(normalized)
    || /少(说|回)点?话/.test(normalized)
    || /不用每条都回/.test(normalized)
    || /不要每条都回/.test(normalized)
    || /(应该|要|需要).*换口吻/.test(normalized)
    || /换口吻.*(应该|要|需要)/.test(normalized)
    || /(应该|要|需要).*接梗/.test(normalized)
    || /接梗.*(应该|要|需要)/.test(normalized)
    || /(应该|要|需要|避免).*解答腔/.test(normalized);
}

function parseCompactMemoryEvidenceTime(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const year = date.getUTCFullYear();
  return year >= 2020 && year <= 2035 ? trimmed : null;
}

function parseCompactMemoryObservations(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  return parseRecordArray((value as Record<string, unknown>).observations).map((item) => {
    const topic = typeof item.topic === 'string' ? item.topic.trim() : '';
    const text = typeof item.text === 'string' ? canonicalizeCompactMemoryAliasText(item.text.trim()) : '';
    const xiaoniRole = item.xiaoni_role === 'speaker'
      || item.xiaoni_role === 'directly_addressed'
      || item.xiaoni_role === 'mentioned_or_evaluated'
      || item.xiaoni_role === 'bystander'
      || item.xiaoni_role === 'not_involved'
      ? item.xiaoni_role
      : 'not_involved';
    const sourceTurnIds = parsePositiveIntegerArray(item.source_turn_ids ?? item.sourceTurnIds);
    if (!topic || !text || sourceTurnIds.length === 0 || isMalformedCompactMemoryText(text)) {
      return null;
    }
    return {
      topic,
      text,
      poignancy: parseBoundedInteger(item.poignancy, 1, 10, 1),
      participants: parseParticipantArray(item.participants),
      xiaoniRole,
      sourceTurnIds
    };
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function parseLifeActionParticipationJudgment(
  value: unknown,
  fallback: {
    reactionAuthenticity: LifeAction['reactionAuthenticity'];
    actionType: LifeAction['actionType'];
    shouldSearch: boolean;
    wantsToKnowMore: boolean;
  }
): LifeAction['participationJudgment'] {
  const inferredStatus: LifeActionParticipationJudgmentStatus =
    fallback.reactionAuthenticity === 'formed'
      && fallback.actionType !== 'silent'
      && fallback.actionType !== 'image_task'
      ? 'has_sayable_point'
    : fallback.reactionAuthenticity === 'weak_but_real' && fallback.actionType === 'speak'
      ? 'direct_request'
    : fallback.actionType === 'image_task' || fallback.shouldSearch || fallback.wantsToKnowMore
      ? 'direct_request'
      : 'no_sayable_point';
  const inferredBasis: LifeActionParticipationJudgmentBasis = inferredStatus === 'has_sayable_point'
    ? fallback.actionType === 'proactive'
      ? 'association'
    : fallback.shouldSearch || fallback.wantsToKnowMore
      ? 'question'
      : 'opinion'
    : inferredStatus === 'direct_request'
    ? 'direct_request'
    : 'none';

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      status: inferredStatus,
      basis: inferredBasis,
      sayablePoint: null,
      evidenceRefs: [],
      memoryRefs: []
    };
  }

  const record = value as Record<string, unknown>;
  const rawStatus = record.status
    ?? record.participation_judgment_status
    ?? record.participationJudgmentStatus;
  const rawBasis = record.basis
    ?? record.reason_type
    ?? record.reasonType;
  const status: LifeActionParticipationJudgmentStatus = rawStatus === 'has_sayable_point'
    || rawStatus === 'has_own_judgment'
    || rawStatus === 'formed'
    ? 'has_sayable_point'
    : rawStatus === 'no_sayable_point'
    || rawStatus === 'no_reason_to_join'
    || rawStatus === 'not_formed'
    ? 'no_sayable_point'
    : rawStatus === 'direct_request'
    || rawStatus === 'direct_request_only'
    ? 'direct_request'
    : inferredStatus;
  const parsedBasis: LifeActionParticipationJudgmentBasis = rawBasis === 'opinion'
    || rawBasis === 'stance'
    ? 'opinion'
    : rawBasis === 'question'
    || rawBasis === 'genuine_question'
    ? 'question'
    : rawBasis === 'curiosity'
    || rawBasis === 'interest'
    ? 'curiosity'
    : rawBasis === 'discomfort'
    || rawBasis === 'association'
    ? rawBasis
    : rawBasis === 'boundary'
    || rawBasis === 'identity_boundary'
    ? 'boundary'
    : rawBasis === 'direct_request'
    || rawBasis === 'none'
    ? rawBasis
    : inferredBasis;
  const basis = status === 'no_sayable_point'
    ? 'none'
    : status === 'direct_request' && parsedBasis === 'none'
    ? 'direct_request'
    : parsedBasis;
  const rawSayablePoint = record.sayable_point
    ?? record.sayablePoint
    ?? record.public_summary
    ?? record.publicSummary;
  const sayablePoint = typeof rawSayablePoint === 'string' && rawSayablePoint.trim()
    ? rawSayablePoint.trim()
    : null;

  return {
    status,
    basis,
    sayablePoint,
    evidenceRefs: parseStringArray(record.evidence_refs ?? record.evidenceRefs),
    memoryRefs: parseStringArray(record.memory_refs ?? record.memoryRefs)
  };
}

function parseCompactMemoryAssertions(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  return parseRecordArray((value as Record<string, unknown>).assertions).map((item) => {
    const text = typeof item.text === 'string' ? canonicalizeCompactMemoryAliasText(item.text.trim()) : '';
    const factType = item.fact_type === 'stable_fact'
      || item.fact_type === 'current_status'
      || item.fact_type === 'one_time_event'
      || item.fact_type === 'stated_plan'
      || item.fact_type === 'claim'
      ? item.fact_type
      : 'claim';
    const scope = item.scope === 'person'
      || item.scope === 'dyad'
      || item.scope === 'group'
      || item.scope === 'topic'
      || item.scope === 'system_state'
      || item.scope === 'self_continuity'
      ? item.scope
      : 'topic';
    const xiaoniRelevance = item.xiaoni_relevance === 'participation_judgment'
      || item.xiaoni_relevance === 'self_position'
      || item.xiaoni_relevance === 'direct_feedback'
      || item.xiaoni_relevance === 'relationship_context'
      || item.xiaoni_relevance === 'topic_knowledge'
      || item.xiaoni_relevance === 'none'
      ? (item.xiaoni_relevance === 'self_position' ? 'participation_judgment' : item.xiaoni_relevance)
      : 'none';
    const evidenceSummary = typeof (item.evidence_summary ?? item.evidenceSummary) === 'string'
      ? canonicalizeCompactMemoryAliasText(String(item.evidence_summary ?? item.evidenceSummary).trim())
      : '';
    const sourceTurnIds = parsePositiveIntegerArray(item.source_turn_ids ?? item.sourceTurnIds);
    if (!text || sourceTurnIds.length === 0 || isMalformedCompactMemoryText(text, evidenceSummary)) {
      return null;
    }
    return {
      text,
      factType,
      scope,
      owners: parseParticipantArray(item.owners ?? item.claim_owners ?? item.claimOwners),
      directedTo: parseParticipantArray(item.directed_to ?? item.directedTo),
      entities: parseEntityArray(item.entities),
      participants: parseParticipantArray(item.participants),
      evidenceSummary,
      xiaoniRelevance,
      sourceTurnIds
    };
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function parseCompactMemoryReflections(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  return parseRecordArray((value as Record<string, unknown>).reflections).map((item) => {
    const text = typeof item.text === 'string' ? canonicalizeCompactMemoryAliasText(item.text.trim()) : '';
    const kind = item.kind === 'person_pattern'
      || item.kind === 'dyad_pattern'
      || item.kind === 'group_norm'
      || item.kind === 'project_arc'
      || item.kind === 'self_continuity'
      || item.kind === 'xiaoni_perception'
      ? item.kind
      : item.kind === 'relationship'
      ? 'dyad_pattern'
      : item.kind === 'group_pattern'
      ? 'group_norm'
    : item.kind === 'self_observation'
      || item.kind === 'self_position_continuity'
      ? 'self_continuity'
      : null;
    const evidenceBasis = item.evidence_basis === 'explicit_feedback'
      || item.evidence_basis === 'xiaoni_sayable_points'
      || item.evidence_basis === 'repeated_interactions'
      || item.evidence_basis === 'repeated_group_events'
      ? item.evidence_basis
      : item.evidence_basis === 'xiaoni_utterances'
      || item.evidence_basis === 'xiaoni_positions'
      ? 'xiaoni_sayable_points'
      : item.evidence_basis === 'group_pattern'
      ? 'repeated_group_events'
      : null;
    const evidenceSummary = typeof (item.evidence_summary ?? item.evidenceSummary) === 'string'
      ? canonicalizeCompactMemoryAliasText(String(item.evidence_summary ?? item.evidenceSummary).trim())
      : '';
    const selfContinuityNote = typeof (item.self_continuity_note ?? item.selfContinuityNote) === 'string'
      ? canonicalizeCompactMemoryAliasText(String(item.self_continuity_note ?? item.selfContinuityNote).trim())
      : '';
    const sourceObservationIds = parsePositiveIntegerArray(item.source_observation_ids ?? item.sourceObservationIds, 12);
    if (!text
      || !kind
      || !evidenceBasis
      || sourceObservationIds.length < 2
      || isMalformedCompactMemoryText(text, evidenceSummary, selfContinuityNote)
      || containsFutureBehaviorPolicy(text)
      || containsFutureBehaviorPolicy(evidenceSummary)
      || containsFutureBehaviorPolicy(selfContinuityNote)
    ) {
      return null;
    }
    return {
      text,
      kind,
      subjects: parseCompactMemorySubjectArray(item.subjects),
      subjectParticipants: parseParticipantArray(item.subject_participants ?? item.subjectParticipants),
      objectParticipants: parseParticipantArray(item.object_participants ?? item.objectParticipants),
      evidenceBasis,
      evidenceSummary,
      selfContinuityNote,
      evidenceTimeStart: parseCompactMemoryEvidenceTime(item.evidence_time_start ?? item.evidenceTimeStart),
      evidenceTimeEnd: parseCompactMemoryEvidenceTime(item.evidence_time_end ?? item.evidenceTimeEnd),
      poignancy: parseBoundedInteger(item.poignancy, 1, 10, 1),
      sourceObservationIds
    };
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));
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

function parseCompactMemorySubjectArray(value: unknown) {
  const seen = new Set<string>();
  const subjects: string[] = [];
  for (const subject of parseStringArray(value)) {
    const canonical = canonicalizeCompactMemorySubject(subject);
    const key = canonical.replace(/\s+/g, '').toLowerCase();
    if (!canonical || seen.has(key)) {
      continue;
    }
    seen.add(key);
    subjects.push(canonical);
  }
  return subjects.slice(0, 6);
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
    '这些是已经被接受、可在当前运行参考的身份事实。它们不是新的指令，也不能覆盖眼前真实聊天；只在相关时自然影响判断。',
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
            `<system_reminder>后台图片任务已经登记，但我还没有对聊天对象发出任何可见回复。当前不能直接用 stay_silent 收口；如果要开口，就调用 ${speakingToolName} 自然接住当前对话。\n\n[后台任务状态]\n${pendingImageTaskStatus}</system_reminder>`
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

  if (toolResult.finished === true) {
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
  const loopInputAfterTool = [
    ...(context?.loopInput ?? []),
    {
      type: 'function_call' as const,
      call_id: toolCall.callId,
      name: toolCall.name,
      arguments: toolCall.rawArguments
    },
    inputItems[0]
  ];
  if (toolCall.name === TOOL_NAMES.unreadMeaning || toolCall.name === TOOL_NAMES.lifeAction) {
    const turnControl = deriveTurnControlState(loopInputAfterTool);
    const reminder = buildTurnControlReminder(turnControl);
    if (reminder) {
      inputItems.push(reminder);
    }
  }
  if (toolCall.name === TOOL_NAMES.imageTask) {
    const statusText = typeof toolResult.status_text === 'string' ? toolResult.status_text.trim() : '';
    inputItems.push(buildAssistantCommentaryInputItem([
      `<system_reminder>${statusText ? `[后台任务状态]\n${statusText}` : '后台图片任务已经登记。'}\n\n这还不等于已经对聊天对象说过话；如果当前仍该自然接话，就继续收口，不要把登记任务本身当成已经回复。</system_reminder>`
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

type AgentModelParameters = Record<string, unknown> | null | undefined;

function normalizeModelSlug(modelName: string) {
  const value = typeof modelName === 'string' ? modelName.trim() : '';
  if (!value) {
    return '';
  }
  return (value.includes('/') ? value.split('/').pop() || value : value).trim().toLowerCase();
}

function getProviderSpecificParameters(parameters: AgentModelParameters): Record<string, unknown> {
  const base = parameters && typeof parameters === 'object' && !Array.isArray(parameters)
    ? parameters
    : {};
  const modelConfig = base.model_config && typeof base.model_config === 'object' && !Array.isArray(base.model_config)
    ? base.model_config as Record<string, unknown>
    : {};
  return modelConfig.providerSpecific && typeof modelConfig.providerSpecific === 'object' && !Array.isArray(modelConfig.providerSpecific)
    ? modelConfig.providerSpecific as Record<string, unknown>
    : {};
}

function shouldUseReasoningReplay(modelName: string) {
  const slug = normalizeModelSlug(modelName);
  return slug === 'gpt-5.5' || slug === 'gpt-5.5-mini' || slug.startsWith('gpt-5.5-');
}

function buildAgentReasoningConfig(modelName: string, parameters: AgentModelParameters) {
  const providerSpecific = getProviderSpecificParameters(parameters);
  const explicitEffort = typeof providerSpecific.reasoningEffort === 'string' && providerSpecific.reasoningEffort.trim()
    ? providerSpecific.reasoningEffort.trim()
    : null;
  const explicitSummary = typeof providerSpecific.reasoningSummary === 'string' && providerSpecific.reasoningSummary.trim()
    ? providerSpecific.reasoningSummary.trim()
    : null;

  if (!explicitEffort && !explicitSummary && !shouldUseReasoningReplay(modelName)) {
    return undefined;
  }

  return {
    effort: explicitEffort || 'medium',
    summary: explicitSummary || 'auto'
  };
}

function buildAgentTextConfig(modelName: string, parameters: AgentModelParameters) {
  const providerSpecific = getProviderSpecificParameters(parameters);
  const explicitVerbosity = typeof providerSpecific.textVerbosity === 'string' && providerSpecific.textVerbosity.trim()
    ? providerSpecific.textVerbosity.trim()
    : null;
  const verbosity = explicitVerbosity === 'low' || explicitVerbosity === 'medium' || explicitVerbosity === 'high'
    ? explicitVerbosity
    : shouldUseReasoningReplay(modelName)
    ? 'medium'
    : null;

  return verbosity ? { verbosity } : undefined;
}

function buildAgentInclude(modelName: string, parameters: AgentModelParameters): string[] | undefined {
  const providerSpecific = getProviderSpecificParameters(parameters);
  const include = new Set(
    Array.isArray(providerSpecific.include)
      ? providerSpecific.include.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
      : []
  );

  if (shouldUseReasoningReplay(modelName)) {
    include.add('reasoning.encrypted_content');
  }

  return include.size > 0 ? Array.from(include) : undefined;
}

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
    const activeQueueMessage = await materializeActiveImQueueMessage(queueMessage);
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
    let lifeActionArtifact: Record<string, unknown> | null = null;
    let presenceContext: RuntimePresenceContext | null = null;
    let runtimeIdentityFacts: RuntimeIdentityFactProjection[] = [];
    const contextBudgetTurns: ContextBudgetTurnRecord[] = [];
    let budgetPlan: ContextBudgetPlan = {
      requestInput: [],
      summarySourceInput: null,
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

    let loopContinuation: OpenResponseInputItem[] = [];

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
      const lifePresenceTick = isLifePresenceTickPayload(payload);
      const contextSessionKey = lifePresenceTick ? GLOBAL_LIFE_CONTEXT_SESSION_KEY : payload.sessionKey;
      const history = await this.store.listRecentTurns({
        userId: sessionIds.userId,
        groupId: sessionIds.groupId,
        afterConversationId: null,
        ...(lifePresenceTick ? { scope: 'global' as const, limit: 160 } : {})
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
      budgetPlan = await this.buildContextBudgetPlan({
        history,
        queueMessage: payload,
        runtimePrompt,
        loopContinuation,
        runtimeIdentityFacts,
        developerContextBlock,
        contextSessionKey
      });
      // Compute evicted turns once at the start: turns pushed out by the new cutoff that
      // weren't already excluded by the previous cutoff.
      const evictedTurns: ConversationTurn[] = budgetPlan.cutoffRecomputed && budgetPlan.readCutoffAfterConversationId !== null
        ? history.filter((t) =>
            t.id <= budgetPlan.readCutoffAfterConversationId! &&
            (budgetPlan.previousReadCutoffAfterConversationId === null || t.id > budgetPlan.previousReadCutoffAfterConversationId)
          )
        : [];
      const summarySourceInput = budgetPlan.summarySourceInput ?? budgetPlan.requestInput;
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
            developerContextBlock,
            contextSessionKey
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
          deliveryState = await this.store.getRunDeliveryState(queueMessage.id);
          if (deliveryState.deliveryPhase !== 'reasoning_open' && deliveredMessages.length > 0) {
            finishResult = {
              finished: true,
              outcome: 'reply_sent',
              reason: 'Visible delivery already committed; model finished without another tool call.',
              no_reply: false
            };
          } else {
            throw new Error('Agent did not emit any tool call before finish');
          }
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
            sideEffect: isToolCallSideEffecting(toolCall)
          });

          try {
            const duplicateOutbound = buildPostCommitSideEffectSuppression(toolCall, payload.chatType);
            if (duplicateOutbound) {
              deliveryState = await this.store.getRunDeliveryState(queueMessage.id);
            }
            if (duplicateOutbound && deliveryState.deliveryPhase !== 'reasoning_open') {
              const duplicateSuppressed = Boolean(duplicateOutbound?.fingerprint && deliveredFingerprints.has(duplicateOutbound.fingerprint));
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

            const rawToolResult = await this.executeTool(toolCall, payload, {
              stateBias: deriveTurnControlState(requestInput).stateBias
            });
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
            if (toolCall.name === TOOL_NAMES.lifeAction) {
              if (toolResult.unread_meaning && typeof toolResult.unread_meaning === 'object' && !Array.isArray(toolResult.unread_meaning)) {
                unreadMeaningArtifact = toolResult.unread_meaning as Record<string, unknown>;
              }
              lifeActionArtifact = toolResult;
            }
            await this.store.completeToolExecutionLog(logId, {
              status: 'completed',
              result: toolResult
            });

            if (extractSentMessages(toolResult).length > 0) {
              await this.store.markRunDeliveryCommitted(queueMessage.id);
              await this.recordVisibleDeliveryLifeEvents(payload, queueMessage.id, toolCall.name, toolResult);
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
              await this.recordVisibleDeliveryLifeEvents(payload, queueMessage.id, continuation.forcedVisibleReply.toolName, forcedToolResult, true);
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
            context_session_key: contextSessionKey,
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
            life_action: lifeActionArtifact
          },
          context_budget_turns: contextBudgetTurns.map(serializeContextBudgetTurnRecord),
          responses_replay_items: extractReasoningReplayInputItems(loopContinuation),
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
          summarySourceInput,
          existingSummary: budgetPlan.contextSummary,
          contextSessionKey,
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
      if (sentMessages.length === 0) {
        await this.recordSilenceDecisionLifeEvent(payload, queueMessage.id, presenceOutcome, termination, turnsExecuted, conversationId);
      }
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
          responses_replay_items: extractReasoningReplayInputItems(loopContinuation),
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
      summarySourceInput: Array.isArray(params.summarySourceInput) ? params.summarySourceInput : []
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
      sessionKey: params.contextSessionKey || params.queueMessage.sessionKey,
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
    const traceId = `${params.queueMessage.traceId}:subagent:${CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE}`;
    const promptCacheKey = buildSubagentPromptCacheKey({
      queueMessage: params.queueMessage,
      subagentType: CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE
    });
    const groupId = Number.isFinite(Number(params.queueMessage.peerId)) ? Number(params.queueMessage.peerId) : null;
    const messageIdsByTurnId = buildSourceMessageIdsByTurnId(params.evictedTurns);
    const participantDirectory = buildCompactMemoryParticipantDirectory(params.evictedTurns);
    const compactModelName = agentConfig.compactMemoryModelName;
    const reflectionModelName = agentConfig.compactMemoryReflectionModelName;

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
        evicted_turn_ids: params.evictedTurns.map((t) => t.id),
        memory_architecture: 'episodic_semantic_reflection',
        episodic_model: compactModelName,
        semantic_model: compactModelName,
        reflection_model: reflectionModelName
      }
    }).catch(() => undefined);

    const episodicToolCall = await this.runCompactMemoryLayer({
      params,
      traceId,
      promptCacheKey,
      layer: 'episodic',
      modelName: compactModelName,
      reasoningEffort: agentConfig.compactMemoryReasoningEffort,
      input: buildCompactMemoryWriterInput({
        layer: 'episodic',
        evictedTurns: params.evictedTurns,
        runtimePrompt: params.runtimePrompt
      })
    });
    const observations = parseCompactMemoryObservations(episodicToolCall.args);
    const persistedObservations: PersistedMemoryObservation[] = [];
    for (const observation of observations) {
      const sourceMessageIds = collectSourceMessageIds(observation.sourceTurnIds, messageIdsByTurnId);
      const participants = normalizeCompactMemoryParticipants(observation.participants, participantDirectory);
      const stored = await this.store.createAgentMemoryObservation({
        sessionKey: params.queueMessage.sessionKey,
        groupId,
        sourceConversationId: params.conversationId,
        sourceTurnIds: observation.sourceTurnIds,
        sourceMessageIds,
        topic: observation.topic,
        text: observation.text,
        poignancy: observation.poignancy,
        participants,
        xiaoniRole: observation.xiaoniRole,
        sourceTraceId: traceId,
        sourceRunId: params.queueMessage.runId,
        writerModel: compactModelName,
        metadata: {
          parent_trace_id: params.queueMessage.traceId,
          memory_layer: 'episodic',
          source: 'context_compression_evicted_turns'
        }
      });
      persistedObservations.push({
        id: Number(stored.id),
        topic: observation.topic,
        text: observation.text,
        participants,
        xiaoniRole: observation.xiaoniRole,
        sourceTurnIds: observation.sourceTurnIds,
        sourceMessageIds,
        createdAt: (stored as { created_at?: string | Date | null }).created_at ?? null
      });
    }

    const semanticToolCall = await this.runCompactMemoryLayer({
      params,
      traceId,
      promptCacheKey,
      layer: 'semantic',
      modelName: compactModelName,
      reasoningEffort: agentConfig.compactMemoryReasoningEffort,
      input: buildCompactMemoryWriterInput({
        layer: 'semantic',
        evictedTurns: params.evictedTurns,
        runtimePrompt: params.runtimePrompt
      })
    });
    const assertions = parseCompactMemoryAssertions(semanticToolCall.args);
    for (const assertion of assertions) {
      const participants = normalizeCompactMemoryParticipants(assertion.participants, participantDirectory);
      const owners = normalizeCompactMemoryParticipants(assertion.owners, participantDirectory);
      const directedTo = normalizeCompactMemoryParticipants(assertion.directedTo, participantDirectory);
      await this.store.createAgentMemoryAssertion({
        sessionKey: params.queueMessage.sessionKey,
        groupId,
        sourceConversationId: params.conversationId,
        sourceTurnIds: assertion.sourceTurnIds,
        sourceMessageIds: collectSourceMessageIds(assertion.sourceTurnIds, messageIdsByTurnId),
        text: assertion.text,
        factType: assertion.factType,
        entities: assertion.entities,
        participants,
        sourceTraceId: traceId,
        sourceRunId: params.queueMessage.runId,
        writerModel: compactModelName,
        metadata: {
          parent_trace_id: params.queueMessage.traceId,
          memory_layer: 'semantic',
          source: 'context_compression_evicted_turns',
          scope: assertion.scope,
          owners,
          directed_to: directedTo,
          evidence_summary: assertion.evidenceSummary,
          xiaoni_relevance: assertion.xiaoniRelevance
        }
      });
    }

    let reflectionCount = 0;
    if (persistedObservations.length >= 2) {
      const reflectionToolCall = await this.runCompactMemoryLayer({
        params,
        traceId,
        promptCacheKey,
        layer: 'reflection',
        modelName: reflectionModelName,
        reasoningEffort: agentConfig.compactMemoryReflectionReasoningEffort,
        input: buildCompactMemoryReflectionInput({
          observations: persistedObservations,
          runtimePrompt: params.runtimePrompt
        })
      });
      const validObservationIds = new Set(persistedObservations.map((observation) => observation.id));
      const sourceMessageIdsByObservationId = new Map(
        persistedObservations.map((observation) => [observation.id, observation.sourceMessageIds])
      );
      for (const reflection of parseCompactMemoryReflections(reflectionToolCall.args)) {
        const sourceObservationIds = reflection.sourceObservationIds.filter((id) => validObservationIds.has(id));
        if (sourceObservationIds.length < 2) {
          continue;
        }
        await this.store.createAgentMemoryReflection({
          sessionKey: params.queueMessage.sessionKey,
          groupId,
          sourceConversationId: params.conversationId,
          text: reflection.text,
          kind: reflection.kind,
          subjects: reflection.subjects,
          evidenceBasis: reflection.evidenceBasis,
          evidenceTimeStart: reflection.evidenceTimeStart,
          evidenceTimeEnd: reflection.evidenceTimeEnd,
          poignancy: reflection.poignancy,
          sourceObservationIds,
          sourceMessageIds: uniquePositiveNumbers(sourceObservationIds.flatMap((id) => sourceMessageIdsByObservationId.get(id) || [])),
          sourceTraceId: traceId,
          sourceRunId: params.queueMessage.runId,
          writerModel: reflectionModelName,
          metadata: {
            parent_trace_id: params.queueMessage.traceId,
            memory_layer: 'reflection',
            source: 'episodic_observations',
            subject_participants: normalizeCompactMemoryParticipants(reflection.subjectParticipants, participantDirectory),
            object_participants: normalizeCompactMemoryParticipants(reflection.objectParticipants, participantDirectory),
            evidence_summary: reflection.evidenceSummary,
            self_continuity_note: reflection.selfContinuityNote
          }
        });
        reflectionCount += 1;
      }
    }

    await this.store.logTimelineEvent({
      traceId,
      eventType: 'subagent',
      eventName: CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE,
      eventPhase: 'end',
      conversationId: params.conversationId,
      metadata: {
        termination_reason: 'completed',
        observation_count: persistedObservations.length,
        assertion_count: assertions.length,
        reflection_count: reflectionCount
      }
    }).catch(() => undefined);
  }

  private async runCompactMemoryLayer(params: {
    params: ContextCompressionMemoryParams;
    traceId: string;
    promptCacheKey: string;
    layer: CompactMemoryLayer;
    modelName: string;
    reasoningEffort: string;
    input: OpenResponseInputItem[];
  }) {
    const canonicalRequest = buildCompactMemoryWriterRequest(
      params.modelName,
      params.input,
      {
        metadata: buildCompactMemorySubagentTurnMetadata({
          queueMessage: params.params.queueMessage,
          runtimePrompt: params.params.runtimePrompt,
          conversationId: params.params.conversationId,
          subagentTraceId: params.traceId,
          layer: params.layer
        }),
        promptCacheKey: `${params.promptCacheKey}:${params.layer}`,
        layer: params.layer,
        reasoningEffort: params.reasoningEffort,
        textVerbosity: agentConfig.compactMemoryTextVerbosity
      }
    );
    const requestBody = JSON.stringify({
      trace_id: params.traceId,
      agent_turn: 1,
      agent_type: `${CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE}:${params.layer}`,
      prompt_name: `${params.params.runtimePrompt.promptName}:${CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE}:${params.layer}`,
      model: params.modelName,
      parameters: buildCompactMemoryAgentParameters(params.params.runtimePrompt.parameters as Record<string, unknown> | undefined),
      canonicalRequest
    });

    let responsePayload: ProviderAgentResponse | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/agent/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody
      });
      responsePayload = await response.json() as ProviderAgentResponse;
      if (response.ok && responsePayload.success) {
        break;
      }
      const errorMessage = responsePayload.error || null;
      if (attempt >= 3 || !isRetryableCompactMemoryFailure(response.status, errorMessage)) {
        throw new Error(responsePayload.error || `Compact memory ${params.layer} writer failed with ${response.status}`);
      }
      moduleLogger.warn('Retrying compact memory layer after retryable provider failure', {
        traceId: params.traceId,
        layer: params.layer,
        attempt,
        status: response.status,
        error: errorMessage
      });
      await delay(500 * attempt);
    }

    if (!responsePayload?.success) {
      throw new Error(`Compact memory ${params.layer} writer failed without a successful response`);
    }

    const toolOutput = extractReplayableModelOutputs(responsePayload.canonical_response).find(isReplayableToolCall);
    if (!toolOutput || toolOutput.toolCall.name !== COMPACT_MEMORY_TOOL_NAME_BY_LAYER[params.layer]) {
      throw new Error(`Compact memory ${params.layer} writer did not call ${COMPACT_MEMORY_TOOL_NAME_BY_LAYER[params.layer]}`);
    }
    return toolOutput.toolCall;
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
    contextSessionKey?: string;
  }): Promise<ContextBudgetPlan> {
    const policy = resolveModelContextPolicy(
      params.runtimePrompt.modelName,
      params.runtimePrompt.parameters as Record<string, unknown> | undefined
    );
    const contextWindowTokens = policy?.contextWindowTokens ?? null;
    const targetBudgetTokens = contextWindowTokens ? Math.max(1, Math.floor(contextWindowTokens * READ_HISTORY_TARGET_RATIO)) : null;
    const hardBudgetTokens = contextWindowTokens ? Math.max(1, Math.floor(contextWindowTokens * READ_HISTORY_HARD_RATIO)) : null;
    const contextSessionKey = params.contextSessionKey || params.queueMessage.sessionKey;
    const cutoffState = await this.store.getSessionReadCutoffState(contextSessionKey);
    const contextSummary = cutoffState?.contextSummary ?? null;
    const pendingProactiveShare = cutoffState?.pendingProactiveShare ?? null;
    const pendingProactiveShareAge = cutoffState?.pendingProactiveShareAge ?? 0;
    const initialRetainedHistory = applyReadCutoff(params.history, cutoffState);

    // Count-based compaction: when retained history exceeds HISTORY_COMPACT_AT turns,
    // evict everything except the most recent HISTORY_COMPACT_KEEP turns regardless of token budget.
    // This ensures context stays manageable and triggers summary generation at a human-scale frequency.
    if (initialRetainedHistory.length > HISTORY_COMPACT_AT) {
      const summarySourceInput = buildLoopRequestInput({
        history: initialRetainedHistory,
        queueMessage: params.queueMessage,
        runtimePrompt: params.runtimePrompt,
        loopContinuation: params.loopContinuation,
        runtimeIdentityFacts: params.runtimeIdentityFacts,
        contextSummary,
        pendingProactiveShare,
        developerContextBlock: params.developerContextBlock ?? null
      });
      const retainedHistory = initialRetainedHistory.slice(-HISTORY_COMPACT_KEEP);
      const newCutoffTurn = initialRetainedHistory[initialRetainedHistory.length - HISTORY_COMPACT_KEEP - 1];
      const newCutoffId = newCutoffTurn?.id ?? cutoffState?.readCutoffAfterConversationId ?? null;

      await this.store.upsertSessionReadCutoffState({
        sessionKey: contextSessionKey,
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
        summarySourceInput,
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
        summarySourceInput: null,
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
      sessionKey: contextSessionKey,
      readCutoffAfterConversationId: recomputed.readCutoffAfterConversationId,
      lastContextWindowTokens: contextWindowTokens,
      lastTargetBudgetTokens: targetBudgetTokens,
      lastHardBudgetTokens: hardBudgetTokens
    });

    return {
      requestInput: recomputed.requestInput,
      summarySourceInput: initialRequestInput,
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
        queueMessage.chatType,
        runtimePrompt.parameters as Record<string, unknown> | undefined
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
    options: ExecuteToolOptions = {}
  ): Promise<Record<string, unknown>> {
    switch (toolCall.name) {
      case TOOL_NAMES.privateReply:
      case 'send_private_message':
        return this.sendMessage('private', toolCall.args, queueMessage);
      case TOOL_NAMES.groupReply:
      case 'send_group_message':
        return this.sendMessage('group', toolCall.args, queueMessage);
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
      case TOOL_NAMES.lifeAction: {
        return this.commitLifeAction(toolCall, queueMessage, options);
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

  private async commitLifeAction(
    toolCall: AgentToolCall,
    queueMessage: QueueMessageRecord['payload'],
    options: ExecuteToolOptions = {}
  ) {
    const action = parseLifeAction(toolCall.args);
    if (!action) {
      throw new Error(`${toolCall.name} returned invalid arguments`);
    }

    const base = serializeLifeAction(action);
    const xiaoniOs = typeof toolCall.args.xiaoni_os === 'string' && toolCall.args.xiaoni_os.trim()
      ? toolCall.args.xiaoni_os.trim()
      : action.reason;
    const pendingShare = typeof toolCall.args.pending_share === 'string' && toolCall.args.pending_share.trim()
      ? toolCall.args.pending_share.trim()
      : null;
    const outcome = typeof toolCall.args.outcome === 'string' && toolCall.args.outcome.trim()
      ? toolCall.args.outcome.trim()
      : null;

    const forceSilentReason = action.actionType === 'speak'
      ? shouldForceActionToSilenceFromParticipationJudgment(action, action.unreadMeaning)
        ? 'participation_judgment_not_sayable'
        : shouldDowngradeWeakSpeakToSilence(action, action.unreadMeaning, options.stateBias ?? 'normal')
        ? 'weak_speak_downgraded'
        : null
      : null;
    const messages = normalizeMessages(toolCall.args);
    if (action.actionType === 'silent' || forceSilentReason || ((action.actionType === 'speak' || action.actionType === 'proactive') && messages.length === 0)) {
      return {
        ...base,
        action_type: 'silent',
        proposed_action_type: action.actionType,
        finished: true,
        reason: forceSilentReason || (messages.length === 0 && action.actionType !== 'silent' ? 'missing_visible_message' : action.reason),
        outcome: outcome || forceSilentReason || (messages.length === 0 && action.actionType !== 'silent' ? 'missing_visible_message' : 'silent'),
        xiaoni_os: xiaoniOs,
        pending_share: pendingShare
      };
    }

    if (action.actionType === 'speak' || action.actionType === 'proactive') {
      const sendResult = await this.sendMessage(
        queueMessage.chatType === 'direct' ? 'private' : 'group',
        {
          ...toolCall.args,
          message: null,
          messages,
          xiaoni_os: xiaoniOs,
          ...(pendingShare ? { pending_share: pendingShare } : {})
        },
        queueMessage
      );
      return {
        ...base,
        ...sendResult,
        finished: true,
        outcome: 'reply_sent',
        reason: action.reason
      };
    }

    if (action.actionType === 'image_task') {
      const prompt = typeof toolCall.args.prompt === 'string' && toolCall.args.prompt.trim()
        ? toolCall.args.prompt.trim()
        : '';
      if (prompt) {
        const imageResult = await this.requestImageTask({
          ...toolCall.args,
          xiaoni_os: xiaoniOs
        }, queueMessage);
        let sendResult: Record<string, unknown> = {};
        if (messages.length > 0) {
          sendResult = await this.sendMessage(
            queueMessage.chatType === 'direct' ? 'private' : 'group',
            {
              ...toolCall.args,
              message: null,
              messages,
              xiaoni_os: xiaoniOs,
              ...(pendingShare ? { pending_share: pendingShare } : {})
            },
            queueMessage
          );
        }
        return {
          ...base,
          ...imageResult,
          ...sendResult,
          finished: true,
          outcome: messages.length > 0 ? 'image_task_queued_and_replied' : 'image_task_queued',
          reason: action.reason,
          xiaoni_os: xiaoniOs,
          pending_share: pendingShare
        };
      }
      return {
        ...base,
        finished: false,
        needs_external_tool: 'image_task',
        reason: action.reason,
        xiaoni_os: xiaoniOs,
        pending_share: pendingShare
      };
    }

    if (action.actionType === 'search') {
      if (!agentConfig.webSearchEnabled) {
        return {
          ...base,
          action_type: 'silent',
          proposed_action_type: action.actionType,
          finished: true,
          reason: 'web_search_disabled',
          outcome: 'web_search_disabled',
          xiaoni_os: xiaoniOs,
          pending_share: pendingShare
        };
      }
      return {
        ...base,
        finished: false,
        needs_external_tool: 'web_search',
        reason: action.reason,
        xiaoni_os: xiaoniOs,
        pending_share: pendingShare
      };
    }

    return {
      ...base,
      finished: true,
      reason: action.reason,
      outcome: outcome || 'silent',
      xiaoni_os: xiaoniOs,
      pending_share: pendingShare
    };
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
        reason: typeof args.reason === 'string' && args.reason.trim()
          ? args.reason.trim()
          : '小腻需要看清这个图片占位符才能继续回复。'
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

  private async recordVisibleDeliveryLifeEvents(
    queueMessage: QueueMessageRecord['payload'],
    runId: string,
    toolName: string,
    toolResult: Record<string, unknown>,
    forced = false
  ) {
    const recorder = (this.store as RuntimeStore & {
      recordVisibleDeliveryLifeEvents?: RuntimeStore['recordVisibleDeliveryLifeEvents'];
    }).recordVisibleDeliveryLifeEvents;
    if (typeof recorder !== 'function') {
      return;
    }
    await recorder.call(this.store, {
      queueMessage,
      runId,
      toolName,
      toolResult,
      forced
    }).catch((error) => {
      moduleLogger.warn('Failed to record visible delivery life events', {
        traceId: queueMessage.traceId,
        runId,
        toolName,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  private async recordSilenceDecisionLifeEvent(
    queueMessage: QueueMessageRecord['payload'],
    runId: string,
    outcome: string,
    termination: {
      terminationReason: string;
      finishReason: string | null;
      finishOutcome: string | null;
      noReply: boolean;
    },
    totalTurns: number,
    conversationId: number | null
  ) {
    const recorder = (this.store as RuntimeStore & {
      recordSilenceDecisionLifeEvent?: RuntimeStore['recordSilenceDecisionLifeEvent'];
    }).recordSilenceDecisionLifeEvent;
    if (typeof recorder !== 'function') {
      return;
    }
    await recorder.call(this.store, {
      queueMessage,
      runId,
      traceId: queueMessage.traceId,
      outcome,
      presenceOutcome: outcome,
      termination,
      totalTurns,
      conversationId
    }).catch((error) => {
      moduleLogger.warn('Failed to record silence decision life event', {
        traceId: queueMessage.traceId,
        runId,
        outcome,
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

type ClaimedInboxMessageRecord = {
  id: number;
  traceId: string;
  source: string;
  messageSid: string;
  chatType: 'direct' | 'group';
  sessionKey: string;
  peerId: string;
  peerName?: string;
  senderId: string;
  senderName?: string;
  accountId: string;
  bodyForAgent: string;
  rawBody?: string;
  commandBody?: string;
  wasMentioned?: boolean;
  receivedAt?: string;
  messageTimestamp?: string | null;
  rawPayload?: Record<string, unknown>;
  inboundContext?: Record<string, unknown>;
};

type InboxConversationSummaryRecord = {
  sessionKey?: string;
  session_key?: string;
  unreadCount?: number;
  unread_count?: number;
  lastReceivedAt?: string | null;
  last_received_at?: string | null;
};

async function materializeActiveImQueueMessage(queueMessage: QueueMessageRecord): Promise<QueueMessageRecord> {
  let materializedQueueMessage = materializePresenceTickQueueMessage(queueMessage);
  const tick = queueMessage.payload.presenceTick;
  let targetSessionKey = typeof tick?.targetSessionKey === 'string' && tick.targetSessionKey.trim()
    ? tick.targetSessionKey.trim()
    : '';

  if (!targetSessionKey && isLifePresenceTickPayload(queueMessage.payload)) {
    targetSessionKey = await selectUnreadInboxSessionForActiveIm({
      traceId: queueMessage.traceId
    }) || '';
    materializedQueueMessage = queueMessage;
  }

  if (!targetSessionKey) {
    return materializedQueueMessage;
  }
  const claimedMessages = await claimUnreadInboxWindowForActiveIm({
    traceId: queueMessage.traceId,
    sessionKey: targetSessionKey
  });
  return materializePresenceTickInboxWindow(materializedQueueMessage, claimedMessages);
}

async function selectUnreadInboxSessionForActiveIm(params: { traceId: string }): Promise<string | null> {
  try {
    const response = await fetch(`${agentConfig.providerServiceUrl}/api/inbox/conversations?limit=100`, {
      method: 'GET',
      headers: {
        accept: 'application/json'
      }
    });
    if (!response.ok) {
      throw new Error(`provider conversations returned HTTP ${response.status}`);
    }
    const payload = await response.json() as {
      success?: boolean;
      data?: unknown;
    };
    if (!payload.success || !Array.isArray(payload.data)) {
      return null;
    }
    const unreadConversations = payload.data
      .filter((item): item is InboxConversationSummaryRecord => Boolean(item && typeof item === 'object'))
      .filter((item) => {
        const count = Number(item.unreadCount ?? item.unread_count ?? 0);
        const sessionKey = String(item.sessionKey ?? item.session_key ?? '').trim();
        return count > 0 && sessionKey.length > 0;
      })
      .sort((left, right) => {
        const leftTime = Date.parse(String(left.lastReceivedAt ?? left.last_received_at ?? '')) || 0;
        const rightTime = Date.parse(String(right.lastReceivedAt ?? right.last_received_at ?? '')) || 0;
        return rightTime - leftTime;
      });
    const selected = unreadConversations[0];
    return selected ? String(selected.sessionKey ?? selected.session_key).trim() : null;
  } catch (error) {
    moduleLogger.warn('Failed to select unread inbox session for active IM open', {
      traceId: params.traceId,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

async function claimUnreadInboxWindowForActiveIm(params: { traceId: string; sessionKey: string }): Promise<ClaimedInboxMessageRecord[]> {
  try {
    const response = await fetch(`${agentConfig.providerServiceUrl}/api/inbox/messages/claim`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        session_key: params.sessionKey,
        limit: agentConfig.activeImClaimLimit,
        order: 'latest'
      })
    });
    if (!response.ok) {
      throw new Error(`provider claim returned HTTP ${response.status}`);
    }
    const payload = await response.json() as {
      success?: boolean;
      data?: {
        claimed?: unknown;
      };
    };
    if (!payload.success || !Array.isArray(payload.data?.claimed)) {
      return [];
    }
    return payload.data.claimed
      .filter((item): item is ClaimedInboxMessageRecord => Boolean(item && typeof item === 'object'));
  } catch (error) {
    moduleLogger.warn('Failed to claim unread inbox window for active IM open', {
      traceId: params.traceId,
      sessionKey: params.sessionKey,
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

function isLifePresenceTickPayload(queueMessage: QueueMessageRecord['payload']) {
  return queueMessage.source === 'presence_tick'
    && queueMessage.sessionKey === 'presence_tick:xiaoni'
    && Boolean(queueMessage.presenceTick);
}

export function materializePresenceTickQueueMessage(queueMessage: QueueMessageRecord): QueueMessageRecord {
  const tick = queueMessage.payload.presenceTick;
  if (!tick || queueMessage.payload.sessionKey !== 'presence_tick:xiaoni' || !tick.targetSessionKey || !tick.targetPeerId || !tick.targetAccountId) {
    return queueMessage;
  }

  const payload = queueMessage.payload;
  const targetSessionKey = tick.targetSessionKey;
  const targetPeerId = tick.targetPeerId;
  const targetPeerName = tick.targetPeerName || undefined;
  const targetAccountId = tick.targetAccountId;
  const targetChatType: QueueMessageRecord['payload']['chatType'] = tick.targetChatType === 'direct' ? 'direct' : 'group';
  const inboundContext = {
    ...payload.inboundContext,
    SessionKey: targetSessionKey,
    To: targetPeerId,
    NativeChannelId: targetPeerId,
    ...(targetChatType === 'group' ? { GroupSubject: targetPeerName || payload.inboundContext.GroupSubject } : {}),
    ChatType: targetChatType,
    Surface: 'presence_tick'
  };
  const messages = payload.messages.map((message) => ({
    ...message,
    chatType: targetChatType,
    sessionKey: targetSessionKey,
    peerId: targetPeerId,
    peerName: targetPeerName,
    accountId: targetAccountId,
    inboundContext: {
      ...message.inboundContext,
      SessionKey: targetSessionKey,
      To: targetPeerId,
      NativeChannelId: targetPeerId,
      ...(targetChatType === 'group' ? { GroupSubject: targetPeerName || message.inboundContext.GroupSubject } : {}),
      ChatType: targetChatType,
      Surface: 'presence_tick'
    }
  }));

  return {
    ...queueMessage,
    payload: {
      ...payload,
      chatType: targetChatType,
      sessionKey: targetSessionKey,
      peerId: targetPeerId,
      peerName: targetPeerName,
      accountId: targetAccountId,
      inboundContext,
      messages
    }
  };
}

export function materializePresenceTickInboxWindow(
  queueMessage: QueueMessageRecord,
  claimedMessages: ClaimedInboxMessageRecord[]
): QueueMessageRecord {
  if (!queueMessage.payload.presenceTick || claimedMessages.length === 0) {
    return queueMessage;
  }

  const messages = claimedMessages.map((message) => mapClaimedInboxMessageToQueueBatch(message));
  const latest = messages[messages.length - 1];
  if (!latest) {
    return queueMessage;
  }

  const payload = queueMessage.payload;
  const inboundContext = {
    ...latest.inboundContext,
    Surface: 'proactive_im_open',
    SessionKey: latest.sessionKey,
    ChatType: latest.chatType,
    NativeChannelId: latest.peerId,
    WasMentioned: messages.some((message) => message.wasMentioned),
    CommandAuthorized: false
  };

  return {
    ...queueMessage,
    payload: {
      ...payload,
      source: 'proactive_im_open',
      chatType: latest.chatType,
      sessionKey: latest.sessionKey,
      peerId: latest.peerId,
      peerName: latest.peerName,
      senderId: latest.senderId,
      senderName: latest.senderName,
      accountId: latest.accountId,
      bodyForAgent: messages.map((message) => message.bodyForAgent).join('\n'),
      rawBody: messages.map((message) => message.rawBody).join('\n'),
      commandBody: messages.map((message) => message.commandBody).join('\n'),
      wasMentioned: messages.some((message) => message.wasMentioned),
      receivedAt: latest.receivedAt,
      messageTimestamp: latest.messageTimestamp,
      rawPayload: {
        kind: 'proactive_im_open',
        source_run_id: payload.runId,
        source_trace_id: payload.traceId,
        claimed_message_sids: messages.map((message) => message.messageSid)
      },
      inboundContext,
      messages,
      presenceTick: undefined
    }
  };
}

function mapClaimedInboxMessageToQueueBatch(message: ClaimedInboxMessageRecord): QueueBatchMessage {
  const inboundContext = normalizeClaimedInboundContext(message.inboundContext, message);
  return {
    queueMessageId: Number(message.id),
    traceId: message.traceId,
    source: message.source || 'inbox_claim',
    messageId: Number(message.id),
    messageSid: message.messageSid,
    chatType: message.chatType === 'direct' ? 'direct' : 'group',
    sessionKey: message.sessionKey,
    peerId: message.peerId,
    peerName: message.peerName,
    senderId: message.senderId,
    senderName: message.senderName,
    accountId: message.accountId,
    bodyForAgent: message.bodyForAgent,
    rawBody: message.rawBody || message.bodyForAgent,
    commandBody: message.commandBody || message.bodyForAgent,
    wasMentioned: Boolean(message.wasMentioned || inboundContext.WasMentioned),
    receivedAt: message.receivedAt || new Date().toISOString(),
    messageTimestamp: message.messageTimestamp ?? null,
    rawPayload: message.rawPayload || {},
    inboundContext
  };
}

function normalizeClaimedInboundContext(
  value: Record<string, unknown> | undefined,
  message: ClaimedInboxMessageRecord
): QueueBatchMessage['inboundContext'] {
  const context = value && typeof value === 'object' ? value : {};
  return {
    ...context,
    Body: typeof context.Body === 'string' ? context.Body : message.bodyForAgent,
    BodyForAgent: typeof context.BodyForAgent === 'string' ? context.BodyForAgent : message.bodyForAgent,
    BodyForCommands: typeof context.BodyForCommands === 'string' ? context.BodyForCommands : message.commandBody || message.bodyForAgent,
    RawBody: typeof context.RawBody === 'string' ? context.RawBody : message.rawBody || message.bodyForAgent,
    CommandBody: typeof context.CommandBody === 'string' ? context.CommandBody : message.commandBody || message.bodyForAgent,
    SessionKey: typeof context.SessionKey === 'string' ? context.SessionKey : message.sessionKey,
    AccountId: typeof context.AccountId === 'string' ? context.AccountId : message.accountId,
    MessageSid: typeof context.MessageSid === 'string' ? context.MessageSid : message.messageSid,
    ChatType: typeof context.ChatType === 'string' ? context.ChatType : message.chatType,
    SenderName: typeof context.SenderName === 'string' ? context.SenderName : message.senderName,
    SenderId: typeof context.SenderId === 'string' ? context.SenderId : message.senderId,
    NativeChannelId: typeof context.NativeChannelId === 'string' ? context.NativeChannelId : message.peerId,
    WasMentioned: Boolean(context.WasMentioned || message.wasMentioned),
    CommandAuthorized: false
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
  const developerContextParts = splitDeveloperContextBlock(developerContextBlock);
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

  if (developerContextParts.worldNarrative) {
    items.push({
      type: 'message',
      role: 'developer',
      content: developerContextParts.worldNarrative
    });
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
      items.push(...buildTurnReasoningReplayItems(turn));
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

    items.push(...buildTurnReasoningReplayItems(turn));
  }

  if (contextSummary) {
    items.push(buildAssistantCommentaryInputItem([`<小腻近况>\n${contextSummary}\n</小腻近况>`]));
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
  if (developerContextParts.dynamicContext) {
    items.push({
      type: 'message',
      role: 'developer',
      content: developerContextParts.dynamicContext
    });
  }
  const turnStateReminder = buildTurnStateReminder(developerContextBlock);
  if (turnStateReminder) {
    items.push(turnStateReminder);
  }
  items.push(buildDeveloperInputItem([RUNTIME_HISTORY_READING_DEVELOPER_CONTEXT]));

  return items;
}

function splitDeveloperContextBlock(developerContextBlock: string | null | undefined) {
  const block = developerContextBlock?.trim();
  if (!block) {
    return {
      worldNarrative: null,
      dynamicContext: null
    };
  }

  const worldNarrativeMatch = block.match(/<world_narrative>[\s\S]*?<\/world_narrative>/);
  const worldNarrative = worldNarrativeMatch?.[0]?.trim() || null;
  const dynamicContext = worldNarrative
    ? block.replace(worldNarrative, '').trim()
    : block;

  return {
    worldNarrative,
    dynamicContext: dynamicContext || null
  };
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

function isReasoningReplayItem(value: unknown): value is Extract<OpenResponseInputItem, { type: 'reasoning' }> {
  if (!value || typeof value !== 'object' || (value as { type?: unknown }).type !== 'reasoning') {
    return false;
  }

  const item = value as {
    content?: unknown;
    summary?: unknown;
    encrypted_content?: unknown;
  };
  return typeof item.encrypted_content === 'string' && item.encrypted_content.length > 0
    || typeof item.content === 'string' && item.content.length > 0
    || typeof item.summary === 'string' && item.summary.length > 0
    || Array.isArray(item.summary) && item.summary.length > 0;
}

function normalizeReasoningReplayInputItem(item: Extract<OpenResponseInputItem, { type: 'reasoning' }>): Extract<OpenResponseInputItem, { type: 'reasoning' }> {
  return {
    type: 'reasoning',
    ...(typeof item.content === 'string' && item.content.length > 0 ? { content: item.content } : {}),
    ...(typeof item.summary === 'string' && item.summary.length > 0
      ? { summary: item.summary }
      : Array.isArray(item.summary) && item.summary.length > 0
      ? { summary: item.summary }
      : { summary: [] }),
    ...(typeof item.encrypted_content === 'string' && item.encrypted_content.length > 0
      ? { encrypted_content: item.encrypted_content }
      : {})
  };
}

function normalizeResponseInputItems(items: OpenResponseInputItem[]): OpenResponseInputItem[] {
  const normalizedItems: OpenResponseInputItem[] = [];
  for (const item of items) {
    if (item.type !== 'reasoning') {
      normalizedItems.push(item);
      continue;
    }
    const normalizedItem = normalizeReasoningReplayInputItem(item);
    if (isReasoningReplayItem(normalizedItem)) {
      normalizedItems.push(normalizedItem);
    }
  }
  return normalizedItems;
}

function extractReasoningReplayInputItems(items: OpenResponseInputItem[]): Array<Extract<OpenResponseInputItem, { type: 'reasoning' }>> {
  return items
    .filter(isReasoningReplayItem)
    .map(normalizeReasoningReplayInputItem);
}

function buildTurnReasoningReplayItems(turn: ConversationTurn): OpenResponseInputItem[] {
  const rawResponse = turn.rawResponse && typeof turn.rawResponse === 'object'
    ? turn.rawResponse as Record<string, unknown>
    : {};
  const replayItems = Array.isArray(rawResponse.responses_replay_items)
    ? rawResponse.responses_replay_items
    : [];

  return replayItems
    .filter(isReasoningReplayItem)
    .map(normalizeReasoningReplayInputItem);
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

  if (!isImmediateVisibleImWake(queueMessage)) {
    return [
      buildUserSceneInputItem([renderUnreadAvailable(queueMessage)])
    ];
  }

  const currentMessages = queueMessage.messages.map((message, index) => renderTranscriptBatchMessage(message, index));
  const imWindow = renderImInboxWindowAvailable(queueMessage);
  if (currentMessages.length === 0) {
    currentMessages.push(imWindow);
  } else {
    currentMessages[0] = `${imWindow}\n${currentMessages[0]}`;
  }
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
  if (!isImmediateVisibleImWake(queueMessage)) {
    return '';
  }

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
      const reasoningItem = normalizeReasoningReplayInputItem({
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
      });
      if (isReasoningReplayItem(reasoningItem)) {
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
  if (Array.isArray(args.messages)) {
    const messages: string[] = [];
    for (const item of args.messages) {
      if (typeof item !== 'string' || !item.trim()) {
        throw new Error('messages must be an array of non-empty strings');
      }
      messages.push(sanitizeLowValueOpeningFiller(item));
    }
    if (messages.length > 0) {
      return messages;
    }
  }

  if (typeof args.message === 'string' && args.message.trim()) {
    return [sanitizeLowValueOpeningFiller(args.message)];
  }

  return [];
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

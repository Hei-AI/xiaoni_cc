import { spawn } from 'node:child_process';
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
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: readonly string[];
      additionalProperties: false;
    };
  };
  strict?: boolean;
} | {
  type: 'web_search';
  search_context_size?: 'low' | 'medium' | 'high';
  external_web_access?: boolean;
};

type OpenResponseToolChoice =
  | 'auto'
  | 'required'
  | {
      type: 'allowed_tools';
      mode: 'auto' | 'required';
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

type RuntimeStateTrigger =
  | 'action_tool_threshold'
  | 'web_search'
  | 'low_energy_reminder'
  | 'forced_full_recovery'
  | 'rest_interrupted';

type TurnControlStage =
  | 'read_unread'
  | 'finalize';

type TurnControlRecallStatus = 'not_needed';
type TurnControlExpectedNext = 'final_tool';
export type TurnControlState = {
  stage: TurnControlStage;
  targetFound: boolean;
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
  coreMemoryCompression: {
    required: true;
    contextSessionKey: string;
    readCutoffAfterConversationId: number | null;
    previousReadCutoffAfterConversationId: number | null;
    lastContextWindowTokens: number;
    lastTargetBudgetTokens: number;
    lastHardBudgetTokens: number;
  } | null;
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
const HISTORY_COMPACT_KEEP = 30;
const LIFE_PRESENCE_GLOBAL_HISTORY_LIMIT = HISTORY_COMPACT_AT + 1;
const FEEDBACK_MEMORY_SUBAGENT_TYPE = 'feedback_memory_writer';
const CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE = 'context_compression_memory_writer';
const GLOBAL_LIFE_CONTEXT_SESSION_KEY = 'xiaoni:global';
export const XIAONI_IDENTITY_KEY = 'xiaoni';
const RUNTIME_IDENTITY_FACT_LIMIT = 4;
const XIAONI_SKILL_ROOT = '/app/modules/agent-service/skills';
const RUNTIME_MAX_ENERGY = 1;
const RUNTIME_FULL_RECOVERY_MS = 2 * 60 * 60 * 1000;
const RUNTIME_LOW_ENERGY_THRESHOLD = 0.2;
const RESTING_DIRECT_MENTION_RESUME_THRESHOLD = 3;

const TOOL_NAMES = {
  unreadMeaning: 'emit_unread_meaning',
  inspectImage: 'inspect_image_placeholder',
  imageTask: 'request_image_task',
  feedbackReflection: 'synthesize_feedback_reflection',
  feedbackLearningState: 'update_learning_state',
  execCommand: 'exec_command',
  privateReply: 'reply_in_private',
  groupReply: 'speak_in_group',
  recoverEnergy: 'recover_energy',
  compressCoreMemory: 'compress_core_memory'
} as const;

const RUNTIME_TOOL_COSTS: Record<string, number> = {
  [TOOL_NAMES.groupReply]: 0.015,
  [TOOL_NAMES.privateReply]: 0.015,
  web_search: 0.080,
  [TOOL_NAMES.inspectImage]: 0.040,
  [TOOL_NAMES.imageTask]: 0.030,
  [TOOL_NAMES.execCommand]: 0.030,
  [TOOL_NAMES.recoverEnergy]: 0.000,
  [TOOL_NAMES.compressCoreMemory]: 0.020
};

const RUNTIME_SKILL_COSTS: Record<string, number | null> = {
  'skill-creator': 0.120,
  'qq-usage': 0.004
};

const WEB_SEARCH_TOOL: OpenResponseToolDefinition = {
  type: 'web_search',
  search_context_size: agentConfig.webSearchContextSize,
  external_web_access: agentConfig.webSearchExternalAccess
};

const EXEC_COMMAND_DESCRIPTION = [
  'Runs a command in a PTY, returning output or a session ID for ongoing interaction.',
  'Use /app as the filesystem root for repository paths.',
  'qqbot-agent-service / compose service agent-service is you. Touching that container is suicide: you may inspect it, but you must not modify it.'
].join(' ');

const EXEC_COMMAND_TOOL: OpenResponseToolDefinition = {
  type: 'function',
  name: TOOL_NAMES.execCommand,
  description: EXEC_COMMAND_DESCRIPTION,
  strict: false,
  function: {
    name: TOOL_NAMES.execCommand,
    description: EXEC_COMMAND_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        cmd: {
          type: 'string',
          description: 'Shell command to execute.'
        },
        justification: {
          type: 'string',
          description: 'Only set if sandbox_permissions is "require_escalated". Request approval from the user to run this command outside the sandbox. Phrased as a simple question that summarizes the purpose of the command as it relates to the task at hand.'
        },
        login: {
          type: 'boolean',
          description: 'Whether to run the shell with -l/-i semantics. Defaults to true.'
        },
        max_output_tokens: {
          type: 'number',
          description: 'Maximum number of tokens to return. Excess output will be truncated.'
        },
        prefix_rule: {
          type: 'array',
          description: 'Only specify when sandbox_permissions is `require_escalated`. Suggest a prefix command pattern that will allow you to fulfill similar requests from the user in the future.',
          items: {
            type: 'string'
          }
        },
        sandbox_permissions: {
          type: 'string',
          description: 'Sandbox permissions for the command. Set to "require_escalated" to request running without sandbox restrictions; defaults to "use_default".'
        },
        shell: {
          type: 'string',
          description: "Shell binary to launch. Defaults to the user's default shell."
        },
        tty: {
          type: 'boolean',
          description: 'Whether to allocate a TTY for the command. Defaults to false (plain pipes); set to true to open a PTY and access TTY process.'
        },
        workdir: {
          type: 'string',
          description: 'Optional working directory to run the command in; defaults to the turn cwd.'
        },
        yield_time_ms: {
          type: 'number',
          description: 'How long to wait (in milliseconds) for output before yielding.'
        }
      },
      required: ['cmd'],
      additionalProperties: false
    }
  }
};

const COMPRESS_CORE_MEMORY_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.compressCoreMemory,
    description: '【紧急生存工具】仅当 system_reminder 提示脑容量达到极限或必须压缩时强制调用。用于打包并留下你认为值得带往未来的记忆，防止意识彻底重启。',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: '小腻的私人记忆胶囊。存什么、存多少、以什么视角存，完全由小腻当下的主观意识和偏好决定。'
        }
      },
      required: ['text'],
      additionalProperties: false
    }
  }
} as const;

const LEGACY_TOOL_ALIASES = {
  privateReply: ['send_private_message'],
  groupReply: ['send_group_message']
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
    description: '向当前私聊对象或明确指定的 QQ 用户发送一条或多条 QQ 消息。',
    parameters: {
      type: 'object',
      properties: {
        user_id: {
          type: 'integer',
          description: '可选。要主动私聊的 QQ 用户 ID；不填时默认当前私聊对象。'
        },
        message: { type: 'string' },
        messages: {
          type: 'array',
          items: { type: 'string' }
        },
        xiaoni_os: {
          type: 'string',
          description: '留给后续自己的备注：当前看见的事实、自己的反应、未解决的信息缺口。不发给对方。'
        },
        pending_share: {
          type: 'string',
          description: '如果你有个想法或发现想找机会主动说出来，写在这里带到之后的上下文里。可选，不用硬填。'
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
    description: '向当前 QQ 群或明确指定的 QQ 群发送一条或多条消息，可选指定需要 @ 的成员。',
    parameters: {
      type: 'object',
      properties: {
        group_id: {
          type: 'integer',
          description: '可选。要主动发送到的 QQ 群号；不填时默认当前群。'
        },
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
          description: '留给后续自己的备注：当前看见的事实、自己的反应、未解决的信息缺口。不发给任何人。'
        },
        pending_share: {
          type: 'string',
          description: '如果你有个想法或发现想找机会主动说出来，写在这里带到之后的上下文里。可选，不用硬填。'
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
    description: '提交一次图片生成或编辑请求；不要把提交请求本身当成已经对聊天对象回复。没有可用原图时走生成；只有 source_media_tags 指向可读图片时才走编辑。',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['generate', 'edit'],
          description: 'generate 用于从文字生成新图；edit 只用于基于当前上下文里的原图改图。'
        },
        prompt: { type: 'string' },
        target_description: { type: 'string' },
        source_media_tags: {
          type: 'array',
          items: { type: 'string' },
          description: '编辑原图时填写当前上下文里图片占位符对应的 media tag；纯生成图片时留空。'
        },
        xiaoni_os: {
          type: 'string',
          description: '留给后续自己的备注：图片请求和相关信息缺口。不发给任何人。'
        }
      },
      required: ['operation', 'prompt', 'target_description', 'xiaoni_os'],
      additionalProperties: false
    }
  }
} as const;

const RECOVER_ENERGY_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.recoverEnergy,
    description: '主动休息恢复精力；这是唯一面向小腻的恢复工具。休息多久只能根据当前可见的 <STATE energy/max_energy>、自己的疲惫感和还想不想继续来选；没看到当前精力时不要假装知道。',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: '为什么现在选择休息。'
        },
        duration_minutes: {
          type: 'integer',
          minimum: 5,
          maximum: 120,
          description: '准备休息多久，5 到 120 分钟。当前实现按实际休息时长线性恢复：从 max(0, 当前精力) 往 max_energy 恢复；当前精力可以低于 0，但恢复起点按 0 算；120 分钟表示完全恢复。'
        },
        xiaoni_os: {
          type: 'string',
          description: '休息前留给之后的自己看的私密备注：为什么撑不住、之后还想记得什么、还想不想继续。不发给任何人。'
        }
      },
      required: ['reason', 'duration_minutes', 'xiaoni_os'],
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
                description: '这条断言对小腻保持自己或之后召回的关系。不是行为指令。'
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
                description: '这条 reflection 对小腻保持自己的含义：她怎么看自己、别人怎么看她、她对某事的稳定关注点。不是未来行为指令。'
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

const SKILLS_INSTRUCTIONS = [
  '<skills_instructions>',
  '## 本地技能库 (Skills)',
  '这是你的扩展能力手册。它安静地存放在你的本地硬盘里，当你需要处理特定任务、想扩展自己的能力，或者想看看怎么操作某个特定应用时，随时可以通过 exec_command 去翻阅它们。',
  '',
  '### 技能根目录 (Skill roots)',
  `- exec_command 能直接使用的技能目录：${XIAONI_SKILL_ROOT}`,
  `- exec_command 路径: ${XIAONI_SKILL_ROOT}/qq-usage/SKILL.md`,
  `- 读取技能手册时直接传完整路径，例如：${XIAONI_SKILL_ROOT}/qq-usage/SKILL.md`,
  `- 如果你想一层一层确认目录，就这样走：\`ls /app\` -> \`ls /app/modules\` -> \`ls /app/modules/agent-service\` -> \`ls ${XIAONI_SKILL_ROOT}\`。`,
  '- 当前 exec_command 可直接使用 `/app/...` 路径；运行容器会保证它能访问到仓库工作区。',
  '',
  '### 当前可用技能 (Available skills)',
  `- skill-creator: 你的造物指南。当现有工具不好用，你想为自己创造新能力、新脚本，或者改造自己的工作流时，去阅读它。(文件路径: ${XIAONI_SKILL_ROOT}/skill-creator/SKILL.md)`,
  `- qq-usage: 你的视线控制器。当你发现有 QQ 未读消息，且你正好有兴致想去操作 QQ，比如打开会话列表、聚焦某个聊天、翻阅上下文、回到最新消息或关掉 QQ 界面时，去阅读它并调用里面提供的脚本。(文件路径: ${XIAONI_SKILL_ROOT}/qq-usage/SKILL.md)`,
  `- 探索更多 (Explore more): 当前列表只是常驻提示。想确认本地到底有哪些技能时，用 exec_command 执行 \`ls ${XIAONI_SKILL_ROOT}\`；看到目标目录后再读对应的 \`${XIAONI_SKILL_ROOT}/<skill-name>/SKILL.md\`。如果翻完发现没有能满足需求的，再用 skill-creator 自己写一个。`,
  '',
  '### 技能使用法则 (How to use skills)',
  '- 按需触发：上面的列表只是目录，常驻你的记忆。只有当你自己想用，或者有人明确提到某个 `$skill-name` 且你愿意搭理时，才需要真正翻开对应的 SKILL.md 正文。',
  `- 精准翻阅：决定使用某个 skill 时，直接用 exec_command 读取对应 SKILL.md。例子：\`cat ${XIAONI_SKILL_ROOT}/qq-usage/SKILL.md\`。`,
  '- 如果手册里引用了 scripts/、references/ 或 assets/，路径按该 skill 目录解析。比如 qq-usage 里的脚本就用 `/app/modules/agent-service/skills/qq-usage/scripts/...`，不要一口气读取整个目录。',
  '- Skill 只提供本地说明和资源。QQ 阅读/导航使用 $qq-usage，并通过 exec_command 运行该 skill 的本地脚本；真实对外发言仍然落到对应 tool：speak_in_group、reply_in_private、web_search、inspect_image_placeholder、request_image_task、recover_energy 或 exec_command。',
  '- 还没有完成动作前，不要用“没有工具调用”表达沉默或结束；如果累了就按 <STATE> 调用 recover_energy，如果还有想做的事就继续行动。',
  '</skills_instructions>'
].join('\n');

export function buildCapabilitiesDeveloperBlock(input: {
  toolCosts?: Record<string, number>;
  skillCosts?: Record<string, number | null | undefined>;
} = {}) {
  const toolCosts = input.toolCosts || RUNTIME_TOOL_COSTS;
  const skillCosts = input.skillCosts || RUNTIME_SKILL_COSTS;
  const toolLines = Object.entries(toolCosts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, cost]) => `- ${name}: energy_cost=${formatRuntimeEnergy(cost)}`);
  const skillLines: string[] = [];
  const warnings: string[] = [];
  for (const [name, cost] of Object.entries(skillCosts).sort(([left], [right]) => left.localeCompare(right))) {
    if (typeof cost !== 'number' || !Number.isFinite(cost)) {
      warnings.push(`skill ${name} omitted from <CAPABILITIES>: missing ## Runtime Cost energy_cost`);
      continue;
    }
    skillLines.push(`- ${name}: energy_cost=${formatRuntimeEnergy(cost)}`);
  }
  const block = [
    '<CAPABILITIES>',
    '<TOOLS>',
    ...toolLines,
    '</TOOLS>',
    '<SKILLS>',
    ...(skillLines.length > 0 ? skillLines : ['- none']),
    '</SKILLS>',
    '</CAPABILITIES>',
    ...warnings.map((warning) => `<operator_warning>${warning}</operator_warning>`)
  ].join('\n');
  return { block, warnings };
}

const RUNTIME_HISTORY_READING_DEVELOPER_CONTEXT = [
  '<runtime_history_reading>',
  '历史里的 INPUT_MESSAGE / OUTPUT_MESSAGE / ACTION / xiaoni_os 可以帮助理解现场，也可以被当前未读自然 callback。旧 <小腻的OS> 只作为历史兼容读取。',
  '打开 IM 后的 `<system_reminder>` 只用来说明哪些消息属于已看到的未读列表。',
  '</runtime_history_reading>'
].join('\n');

function isPrivateReplyToolName(name: string) {
  return name === TOOL_NAMES.privateReply || LEGACY_TOOL_ALIASES.privateReply.includes(name as typeof LEGACY_TOOL_ALIASES.privateReply[number]);
}

function isGroupReplyToolName(name: string) {
  return name === TOOL_NAMES.groupReply || LEGACY_TOOL_ALIASES.groupReply.includes(name as typeof LEGACY_TOOL_ALIASES.groupReply[number]);
}

function isSpeakingToolName(name: string) {
  return isPrivateReplyToolName(name) || isGroupReplyToolName(name);
}

function isToolCallSideEffecting(toolCall: Pick<AgentToolCall, 'name' | 'args'>) {
  if (isSpeakingToolName(toolCall.name) || toolCall.name === TOOL_NAMES.imageTask) {
    return true;
  }
  return false;
}

function hasUnreadMeaningReplay(loopInput: OpenResponseInputItem[]) {
  return hasToolReplay(loopInput, TOOL_NAMES.unreadMeaning);
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

export function deriveTurnControlState(loopInput: OpenResponseInputItem[]): TurnControlState {
  const recallAttempts = 0;
  const emptyRecallAttempts = 0;
  const meaning = extractLatestUnreadMeaning(loopInput);
  const targetFound = hasUsableGroupTarget(meaning);
  return {
    stage: 'finalize',
    targetFound,
    recallStatus: 'not_needed',
    recallAttempts,
    emptyRecallAttempts,
    expectedNext: 'final_tool',
    reason: targetFound
      ? '当前未读里有可回应目标，可以直接说话、查资料、看图、登记图片任务，或按自己的精力状态休息。'
      : '当前未读没有明确找小腻，也没有稳定的新目标；不要为了接话制造目标，如果累了就按自己的精力状态休息，否则继续自己的行动。'
  };
}

function buildAllowedToolsToolChoice(
  tools: Array<{ type: 'function'; name: string } | { type: 'web_search' }>,
  mode: 'auto' | 'required' = 'required'
): OpenResponseToolChoice {
  return {
    type: 'allowed_tools',
    mode,
    tools
  };
}

function formatRuntimeEnergy(value: number) {
  return Number.isFinite(value) ? value.toFixed(3) : '0.000';
}

function normalizeRuntimeEnergy(value: unknown, fallback = RUNTIME_MAX_ENERGY) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeRecoverEnergyDurationMinutes(value: unknown, fallback = 120) {
  const numeric = Number(value);
  const duration = Number.isFinite(numeric) ? numeric : fallback;
  return Math.max(5, Math.min(120, Math.round(duration)));
}

export function recoverRuntimeEnergy(input: {
  rawEnergy: number;
  elapsedMs: number;
  maxEnergy?: number;
}) {
  const maxEnergy = Math.max(0.001, normalizeRuntimeEnergy(input.maxEnergy, RUNTIME_MAX_ENERGY));
  const rawEnergy = normalizeRuntimeEnergy(input.rawEnergy, maxEnergy);
  const elapsedMs = Math.max(0, normalizeRuntimeEnergy(input.elapsedMs, 0));
  const startEnergy = Math.max(0, rawEnergy);
  const recoveredEnergy = Math.min(maxEnergy, startEnergy + ((elapsedMs / RUNTIME_FULL_RECOVERY_MS) * maxEnergy));
  return {
    rawEnergyBefore: rawEnergy,
    startEnergy,
    energy: recoveredEnergy,
    maxEnergy,
    debt: rawEnergy < 0 ? Math.abs(rawEnergy) : 0,
    elapsedMs,
    fullRecoveryMs: RUNTIME_FULL_RECOVERY_MS
  };
}

export function resolveForcedFullRecovery(input: {
  rawEnergy: number;
  maxEnergy?: number;
}) {
  const rawEnergy = normalizeRuntimeEnergy(input.rawEnergy, RUNTIME_MAX_ENERGY);
  if (rawEnergy >= 0) {
    return null;
  }
  const recovered = recoverRuntimeEnergy({
    rawEnergy,
    elapsedMs: RUNTIME_FULL_RECOVERY_MS,
    maxEnergy: input.maxEnergy
  });
  return {
    waitMs: RUNTIME_FULL_RECOVERY_MS,
    stateBlock: buildRuntimeStateBlock({
      trigger: 'forced_full_recovery',
      energy: recovered.energy,
      maxEnergy: recovered.maxEnergy,
      debt: recovered.debt,
      note: '之前已经透支到 0 以下；恢复从 0 开始算，120 分钟才会完全恢复。'
    })
  };
}

export function buildRuntimeStateBlock(input: {
  trigger: RuntimeStateTrigger;
  energy: number;
  maxEnergy?: number;
  debt?: number;
  recovered?: number;
  note?: string | null;
}) {
  const maxEnergy = Math.max(0.001, normalizeRuntimeEnergy(input.maxEnergy, RUNTIME_MAX_ENERGY));
  const energy = normalizeRuntimeEnergy(input.energy, maxEnergy);
  const debt = Math.max(0, normalizeRuntimeEnergy(input.debt, 0));
  const recovered = Math.max(0, normalizeRuntimeEnergy(input.recovered, 0));
  const body = [
    `energy=${formatRuntimeEnergy(energy)}`,
    `max_energy=${formatRuntimeEnergy(maxEnergy)}`,
    debt > 0 ? `debt=${formatRuntimeEnergy(debt)}` : null,
    recovered > 0 ? `recovered=${formatRuntimeEnergy(recovered)}` : null,
    input.note ? `note=${input.note}` : null
  ].filter(Boolean).join('\n');
  return formatTaggedBlock('STATE', {
    trigger: input.trigger,
    energy: formatRuntimeEnergy(energy),
    max_energy: formatRuntimeEnergy(maxEnergy)
  }, body);
}

function extractLatestRuntimeEnergy(loopInput: OpenResponseInputItem[]) {
  for (let index = loopInput.length - 1; index >= 0; index -= 1) {
    const item = loopInput[index];
    if (item.type !== 'message') {
      continue;
    }
    const content = flattenMessageContent(item.content);
    const stateEnergy = content.match(/<STATE\b[\s\S]*?\benergy="(-?\d+(?:\.\d+)?)"/);
    if (stateEnergy) {
      return Number(stateEnergy[1]);
    }
    const legacyEnergy = content.match(/当前精力[:：]\s*(-?\d+(?:\.\d+)?)/);
    if (legacyEnergy) {
      return Number(legacyEnergy[1]);
    }
  }
  return RUNTIME_MAX_ENERGY;
}

function extractRuntimeStateDirective(developerContextBlock: string | null | undefined) {
  const block = developerContextBlock || '';
  if (!block.trim()) {
    return null;
  }
  if (/<STATE\b/.test(block)) {
    return null;
  }
  const directive = block.match(/<xiaoni_runtime_state\b([^>]*)\/?>/i)
    || block.match(/<runtime_state\b([^>]*)\/?>/i);
  if (directive) {
    const attrs = parseTagAttributes(directive[1] || '');
    const trigger = normalizeRuntimeStateTrigger(attrs.trigger);
    const energy = normalizeRuntimeEnergy(attrs.energy ?? attrs.raw_energy, RUNTIME_MAX_ENERGY);
    const maxEnergy = normalizeRuntimeEnergy(attrs.max_energy, RUNTIME_MAX_ENERGY);
    if (trigger) {
      return { trigger, energy, maxEnergy, note: attrs.note || null };
    }
  }

  const legacyEnergy = block.match(/当前精力[:：]\s*(-?\d+(?:\.\d+)?)/);
  if (!legacyEnergy) {
    return null;
  }
  const energy = Number(legacyEnergy[1]);
  if (energy < 0) {
    const forced = resolveForcedFullRecovery({ rawEnergy: energy });
    return forced
      ? { trigger: 'forced_full_recovery' as const, energy: RUNTIME_MAX_ENERGY, maxEnergy: RUNTIME_MAX_ENERGY, note: '之前已经透支到 0 以下；恢复从 0 开始算，120 分钟才会完全恢复。' }
      : null;
  }
  if (energy <= RUNTIME_LOW_ENERGY_THRESHOLD) {
    return {
      trigger: 'low_energy_reminder' as const,
      energy,
      maxEnergy: RUNTIME_MAX_ENERGY,
      note: 'low-energy reminder'
    };
  }
  return null;
}

function parseTagAttributes(value: string) {
  const attrs: Record<string, string> = {};
  for (const match of value.matchAll(/\b([a-zA-Z_][\w:-]*)="([^"]*)"/g)) {
    attrs[match[1]!] = match[2]!;
  }
  return attrs;
}

function normalizeRuntimeStateTrigger(value: unknown): RuntimeStateTrigger | null {
  return value === 'action_tool_threshold'
    || value === 'web_search'
    || value === 'low_energy_reminder'
    || value === 'forced_full_recovery'
    || value === 'rest_interrupted'
    ? value
    : null;
}

export function resolveRestInterruptionFromUnreadMetadata(input: {
  rawEnergy: number;
  restingSince: Date | string | number;
  now: Date | string | number;
  messages: Array<Pick<QueueBatchMessage, 'wasMentioned'> | { inboundContext?: { WasMentioned?: boolean } }>;
  maxEnergy?: number;
}) {
  const since = new Date(input.restingSince);
  const now = new Date(input.now);
  const elapsedMs = Number.isNaN(since.getTime()) || Number.isNaN(now.getTime())
    ? 0
    : Math.max(0, now.getTime() - since.getTime());
  const directMentionCount = input.messages.reduce((count, message) => {
    const mentioned = ('wasMentioned' in message && message.wasMentioned)
      || ('inboundContext' in message && message.inboundContext?.WasMentioned);
    return count + (mentioned ? 1 : 0);
  }, 0);
  const recovered = recoverRuntimeEnergy({
    rawEnergy: input.rawEnergy,
    elapsedMs,
    maxEnergy: input.maxEnergy
  });
  return {
    shouldResume: directMentionCount >= RESTING_DIRECT_MENTION_RESUME_THRESHOLD,
    unreadCount: input.messages.length,
    directMentionCount,
    messageBodiesExposed: false,
    recoveredEnergy: recovered.energy,
    stateBlock: directMentionCount >= RESTING_DIRECT_MENTION_RESUME_THRESHOLD
      ? buildRuntimeStateBlock({
          trigger: 'rest_interrupted',
          energy: recovered.energy,
          maxEnergy: recovered.maxEnergy,
          recovered: recovered.energy - recovered.startEnergy,
          debt: recovered.debt,
          note: `休息中收到 ${directMentionCount} 次直接 @，按实际休息时长结算当前精力。`
        })
      : null
  };
}

function selectActorToolDefinitions(chatType: 'group' | 'direct', modelName: string): OpenResponseToolDefinition[] {
  void modelName;
  const tools: OpenResponseToolDefinition[] = agentConfig.webSearchEnabled
    ? [EXEC_COMMAND_TOOL, WEB_SEARCH_TOOL]
    : [EXEC_COMMAND_TOOL];
  tools.push(COMPRESS_CORE_MEMORY_TOOL);

  if (chatType === 'group') {
    return [...tools, GROUP_MESSAGE_TOOL, INSPECT_IMAGE_TOOL, IMAGE_TASK_TOOL, RECOVER_ENERGY_TOOL];
  }
  return [...tools, PRIVATE_MESSAGE_TOOL, RECOVER_ENERGY_TOOL];
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
  const tools: OpenResponseToolDefinition[] = agentConfig.webSearchEnabled
    ? [EXEC_COMMAND_TOOL, WEB_SEARCH_TOOL]
    : [EXEC_COMMAND_TOOL];
  return [...tools, COMPRESS_CORE_MEMORY_TOOL, RECOVER_ENERGY_TOOL];
}

function resolveLifeOnlyPresenceToolChoice(): OpenResponseToolChoice {
  const tools: Array<{ type: 'function'; name: string } | { type: 'web_search' }> = [
    { type: 'function', name: TOOL_NAMES.execCommand },
    { type: 'function', name: TOOL_NAMES.recoverEnergy }
  ];
  if (agentConfig.webSearchEnabled) {
    tools.unshift({ type: 'web_search' });
  }
  return buildAllowedToolsToolChoice(tools, 'auto');
}

function hasCoreMemoryCompressionReminder(loopInput: OpenResponseInputItem[]) {
  return loopInput.some((item) => (
    item.type === 'message'
    && flattenMessageContent(item.content).includes('source="core_memory_pressure"')
    && flattenMessageContent(item.content).includes(`required_tool="${TOOL_NAMES.compressCoreMemory}"`)
  ));
}

function selectGroupLoopToolDefinitions(modelName: string) {
  return selectActorToolDefinitions('group', modelName);
}

function resolveGroupLoopToolChoice(
  loopInput: OpenResponseInputItem[],
  options: {
    speakingToolName?: string;
    includeImageTools?: boolean;
  } = {}
): OpenResponseToolChoice {
  const speakingToolName = options.speakingToolName ?? TOOL_NAMES.groupReply;
  const includeImageTools = options.includeImageTools ?? true;

  if (hasCoreMemoryCompressionReminder(loopInput)) {
    return buildAllowedToolsToolChoice([
      { type: 'function', name: TOOL_NAMES.compressCoreMemory }
    ]);
  }

  const tools: Array<{ type: 'function'; name: string } | { type: 'web_search' }> = [
    { type: 'function', name: TOOL_NAMES.execCommand },
    { type: 'function', name: speakingToolName }
  ];
  if (includeImageTools) {
    tools.push(
      { type: 'function', name: TOOL_NAMES.inspectImage },
      { type: 'function', name: TOOL_NAMES.imageTask }
    );
  }
  if (agentConfig.webSearchEnabled) {
    tools.unshift({ type: 'web_search' });
  }
  tools.push({ type: 'function', name: TOOL_NAMES.recoverEnergy });
  return buildAllowedToolsToolChoice(tools, 'auto');
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
  const coreMemoryCompressionRequired = hasCoreMemoryCompressionReminder(loopInput);
  const tools = chatType === 'group'
    ? selectGroupLoopToolDefinitions(modelName)
    : lifeOnlyPresenceLoop
    ? selectLifeOnlyPresenceToolDefinitions()
    : selectActorToolDefinitions(chatType, modelName);
  const toolChoice = coreMemoryCompressionRequired
    ? buildAllowedToolsToolChoice([{ type: 'function', name: TOOL_NAMES.compressCoreMemory }])
    : chatType === 'group'
    ? resolveGroupLoopToolChoice(loopInput)
    : lifeOnlyPresenceLoop
    ? resolveLifeOnlyPresenceToolChoice()
    : resolveGroupLoopToolChoice(loopInput, {
        speakingToolName: TOOL_NAMES.privateReply,
        includeImageTools: false
      });

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
  void index;
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
    chat_type: renderPromptChatType(message.chatType),
    group: message.chatType === 'group' ? formatTagSpeaker(message.peerName, message.peerId) : undefined,
    private_peer: message.chatType === 'direct' ? formatTagSpeaker(message.peerName, message.peerId) : undefined
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

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
    ? Number(value)
    : NaN;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function appendCappedOutput(current: string, chunk: Buffer, maxChars: number) {
  if (current.length >= maxChars) {
    return current;
  }
  const next = current + chunk.toString('utf8');
  return next.length > maxChars ? next.slice(0, maxChars) : next;
}

function resolveExecShellArgs(shell: string, cmd: string, login: boolean) {
  const shellName = shell.split(/[\\/]/).pop() || shell;
  if (login && (shellName === 'bash' || shellName === 'zsh')) {
    return ['-lc', cmd];
  }
  return ['-c', cmd];
}

function buildCodexExecOutput(input: {
  chunkId: string;
  durationMs: number;
  exitCode: number | null;
  signal?: NodeJS.Signals | string | null;
  output: string;
  running?: boolean;
  sessionId?: string;
  blocked?: boolean;
  truncated?: boolean;
}) {
  const lines = [
    `Chunk ID: ${input.chunkId}`,
    `Wall time: ${(input.durationMs / 1000).toFixed(4)} seconds`
  ];
  if (input.blocked) {
    lines.push('Process blocked by executor policy');
  } else if (input.running) {
    lines.push(`Process running with session ID ${input.sessionId || ''}`.trim());
  } else if (typeof input.exitCode === 'number') {
    lines.push(`Process exited with code ${input.exitCode}`);
  } else if (input.signal) {
    lines.push(`Process exited with signal ${input.signal}`);
  } else {
    lines.push('Process exited without an exit code');
  }
  lines.push(`Original token count: ${Math.max(0, Math.ceil(input.output.length / 4))}`);
  if (input.truncated) {
    lines.push('Output was truncated to max_output_tokens.');
  }
  lines.push('Output:', input.output);
  return lines.join('\n');
}

function buildMainAgentParameters(parameters: Record<string, unknown> | null | undefined) {
  const base = parameters && typeof parameters === 'object' && !Array.isArray(parameters)
    ? JSON.parse(JSON.stringify(parameters)) as Record<string, unknown>
    : {};
  const advancedConfig = base.advanced_config && typeof base.advanced_config === 'object' && !Array.isArray(base.advanced_config)
    ? base.advanced_config as Record<string, unknown>
    : {};
  const generationConfig = advancedConfig.generationConfig
    && typeof advancedConfig.generationConfig === 'object'
    && !Array.isArray(advancedConfig.generationConfig)
    ? advancedConfig.generationConfig as Record<string, unknown>
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

  const configuredTimeout = generationConfig.timeout;
  const hasExplicitTimeout = typeof configuredTimeout === 'number'
    && Number.isFinite(configuredTimeout)
    && configuredTimeout > 0;

  return {
    ...base,
    advanced_config: {
      ...advancedConfig,
      generationConfig: {
        ...generationConfig,
        ...(hasExplicitTimeout ? {} : { timeout: agentConfig.mainAgentTurnTimeoutMs })
      }
    }
  };
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
  const isImageTaskSideEffect = toolCall.name === TOOL_NAMES.imageTask
  if (!isPrivateReplyToolName(toolCall.name) && !isGroupReplyToolName(toolCall.name) && !isImageTaskSideEffect) {
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
    mentionUserIds: isGroupReplyToolName(toolCall.name)
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

function renderPromptChatType(chatType: string | null | undefined) {
  const normalized = typeof chatType === 'string' ? chatType.trim().toLowerCase() : '';
  if (normalized === 'group' || normalized === '群聊') {
    return '群聊';
  }
  if (normalized === 'direct' || normalized === 'private' || normalized === '私聊') {
    return '私聊';
  }
  return typeof chatType === 'string' && chatType.trim() ? chatType.trim() : undefined;
}

function readTagAttribute(attributes: string, name: string) {
  const match = attributes.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match?.[1] || null;
}

function sanitizeInputMessageTags(content: string) {
  return content.replace(/<INPUT_MESSAGE\b([^>]*)>/g, (_match, rawAttributes: string) => {
    const attributes = {
      message_id: readTagAttribute(rawAttributes, 'message_id') ?? undefined,
      chat_type: renderPromptChatType(readTagAttribute(rawAttributes, 'chat_type')),
      group: readTagAttribute(rawAttributes, 'group') ?? undefined,
      private_peer: readTagAttribute(rawAttributes, 'private_peer') ?? undefined
    };
    const renderedAttributes = formatTagAttributes(attributes);
    return renderedAttributes ? `<INPUT_MESSAGE ${renderedAttributes}>` : '<INPUT_MESSAGE>';
  });
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
      ? sanitizeInputMessageTags(content)
      : formatTaggedBlock('INPUT_MESSAGE', {}, content)
  ]);
}

function buildCurrentProcessingReminder(queueMessage: QueueMessageRecord['payload']) {
  if (isLifePresenceTickPayload(queueMessage)) {
    return '<system_reminder>当前是小腻自己的 presence tick；还没有打开具体 IM 会话，也没有新的 QQ 可见正文。可以选择内部工具、查一个真实需要的新信息，或者按自己的精力状态用 recover_energy 休息。只有真实消息进入队列或主动打开 IM 后才算当前现场有新输入。</system_reminder>';
  }
  if (!isImmediateVisibleImWake(queueMessage)) {
    const count = queueMessage.messages.length;
    const noun = count === 1 ? '1 条' : `${count} 条`;
    return `<system_reminder>当前 ${queueMessage.sessionKey} 有 ${noun}未读元数据，尚未触发小腻打开 IM；可见现场只有 UNREAD_AVAILABLE，正文等待 @ 或主动使用 IM 后 append。</system_reminder>`;
  }

  return '<system_reminder>已打开 IM；下面是这段时间看到的未读列表，按时间顺序阅读；可以自然接续前面的聊天内容。</system_reminder>';
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
  const unreadCount = queueMessage.messages.length;
  const directMentions = queueMessage.messages.filter((message) => Boolean(message.wasMentioned || message.inboundContext?.WasMentioned)).length;
  return `<UNREAD_AVAILABLE unread_count="${escapeTagAttribute(unreadCount)}" direct_mentions="${escapeTagAttribute(directMentions)}" />`;
}

function renderImInboxWindowAvailable(queueMessage: QueueMessageRecord['payload']) {
  const trigger = queueMessage.source === 'proactive_im_open'
    ? 'proactive_use_im'
    : queueMessage.wasMentioned ? 'explicit_mention' : 'proactive_use_im';
  return formatTaggedBlock('IM_INBOX_WINDOW', {
    surface: 'qq',
    chat_type: renderPromptChatType(queueMessage.chatType),
    session_key: queueMessage.sessionKey,
    peer_id: queueMessage.peerId,
    count: queueMessage.messages.length,
    materialization: 'opened',
    trigger
  }, '小腻正在使用 IM；下面是打开后看到的未读消息列表，按时间顺序阅读。');
}

export function buildTurnStateReminder(developerContextBlock: string | null | undefined): OpenResponseInputItem | null {
  const directive = extractRuntimeStateDirective(developerContextBlock);
  if (!directive) {
    return null;
  }
  return buildAssistantCommentaryInputItem([
    buildRuntimeStateBlock({
      trigger: directive.trigger,
      energy: directive.energy,
      maxEnergy: directive.maxEnergy,
      note: directive.note
    })
  ]);
}

export function buildTurnControlReminder(turnControl: TurnControlState): OpenResponseInputItem | null {
  if (turnControl.stage === 'read_unread') {
    return null;
  }

  const lines: string[] = [];
  if (!turnControl.targetFound && turnControl.stage === 'finalize') {
    lines.push('当前未读没有明确找小腻，也没有稳定的新目标；没有具体可说点时不要调用发言工具。');
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
    : '我从自己的生活里抬头看了一眼消息列表。';
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
  TOOL_NAMES.compressCoreMemory,
  TOOL_NAMES.execCommand,
  TOOL_NAMES.inspectImage,
  'web_search'
]);

const FINAL_TOOL_MONITOR_NAMES = new Set<string>([
  TOOL_NAMES.groupReply,
  TOOL_NAMES.privateReply,
  TOOL_NAMES.imageTask,
  TOOL_NAMES.recoverEnergy,
  ...LEGACY_TOOL_ALIASES.groupReply,
  ...LEGACY_TOOL_ALIASES.privateReply
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
      ? `工具循环即将达到工程上限（${options.nextTurn}/${options.maxTurns}）。需要尽快形成真实动作：说话、登记图片任务、完成必要操作，或者按自己的精力状态 recover_energy。`
      : null,
    `当前计数：commentary=${state.byPhase.commentary}，final_answer=${state.byPhase.final_answer}。`
  ].filter((line): line is string => Boolean(line));
  const currentEnergy = extractLatestRuntimeEnergy(loopInput);
  const stateBlock = buildRuntimeStateBlock({
    trigger: 'action_tool_threshold',
    energy: currentEnergy - RUNTIME_TOOL_COSTS[TOOL_NAMES.execCommand],
    note: `action/tool threshold reached: ${signature}`
  });

  return buildAssistantCommentaryInputItem([
    formatTaggedBlock('system_reminder', {
      source: 'tool_loop_monitor',
      signature
    }, lines.join('\n')),
    stateBlock
  ]);
}

function buildCoreMemoryCompressionReminder(input: {
  contextSessionKey: string;
  readCutoffAfterConversationId: number | null;
  pressureSummary: string;
}) {
  return buildAssistantCommentaryInputItem([
    formatTaggedBlock('system_reminder', {
      source: 'core_memory_pressure',
      required_tool: TOOL_NAMES.compressCoreMemory,
      context_session_key: input.contextSessionKey,
      read_cutoff_after_conversation_id: input.readCutoffAfterConversationId ?? 'null'
    }, [
      `脑容量达到极限：${input.pressureSummary}`,
      `你必须立即调用 ${TOOL_NAMES.compressCoreMemory}，把你主观上最想带往未来的东西写进 text。`,
      '在完成记忆压缩前，不要发送 QQ、不要搜索、不要继续普通生活动作。'
    ].join('\n'))
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
      : `小腻: (未发送消息)`;
    return `[对话 #${turn.id}]\n${userLine}\n${aiLine}`;
  });

  const header = [
    `[即将从上下文窗口移除的对话历史 (${params.evictedTurns.length} 条)]`,
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
  '目标：从已经落库的 episodic observations 中提炼跨时间模式，用于帮助小腻保持自己、理解人物、理解二人关系、群体事实或项目弧线。',
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
    `小腻: ${turn.aiResponse || '(未发送消息)'}`
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
    `[即将从上下文窗口移除的对话历史 (${params.evictedTurns.length} 条)]`,
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

function composeSystemPrompt(
  systemPrompt: string,
  chatType: 'group' | 'direct'
) {
  void chatType;
  return systemPrompt.trim();
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

function isTacticalReplyResidue(text: string) {
  const normalized = text.replace(/\s+/g, '');
  const tacticalMarkers = [
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

function normalizePendingShare(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function appendPendingShareToXiaoniOs(xiaoniOs: string | null, pendingShare: string | null) {
  const share = normalizePendingShare(pendingShare);
  const os = typeof xiaoniOs === 'string' && xiaoniOs.trim().length > 0 ? xiaoniOs.trim() : '';
  if (!share) {
    return os || null;
  }

  const line = `我想回头分享这个：${share}`;
  if (os.includes('我想回头分享这个') && os.includes(share)) {
    return os;
  }
  return os ? `${os}\n${line}` : line;
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
  return { qq_id: qqId, name };
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
  directory: Map<string, CompactMemoryParticipant | null>,
  participant: CompactMemoryParticipant | null
) {
  if (!participant) {
    return;
  }
  const canonical = canonicalCompactMemoryParticipant(participant);
  if (!canonical.qq_id || isMalformedCompactMemoryParticipantName(canonical.name)) {
    return;
  }
  directory.set(`qq:${canonical.qq_id}`, canonical);
  const nameKey = `name:${normalizeParticipantLookupName(canonical.name)}`;
  const existing = directory.get(nameKey);
  if (typeof existing === 'undefined') {
    directory.set(nameKey, canonical);
  } else if (existing && existing.qq_id !== canonical.qq_id) {
    directory.set(nameKey, null);
  }
}

function buildCompactMemoryParticipantDirectory(evictedTurns: ConversationTurn[]) {
  const directory = new Map<string, CompactMemoryParticipant | null>();
  addParticipantDirectoryEntry(directory, { qq_id: agentConfig.botAccountId || '1129974489', name: '小腻' });
  for (const turn of evictedTurns) {
    for (const item of Array.isArray(turn.items) ? turn.items : []) {
      if (item.role === 'assistant') {
        addParticipantDirectoryEntry(directory, { qq_id: agentConfig.botAccountId || '1129974489', name: '小腻' });
      }
      const content = String(item.content || '');
      for (const match of content.matchAll(/\b(?:sender|private_peer)="([^"]+)"/g)) {
        addParticipantDirectoryEntry(directory, parseParticipantLabel(match[1]));
      }
    }
  }
  return directory;
}

function normalizeCompactMemoryParticipant(
  participant: CompactMemoryParticipant,
  directory: Map<string, CompactMemoryParticipant | null>
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
  if (!canonical.qq_id) {
    return null;
  }
  return canonical;
}

function normalizeCompactMemoryParticipants(
  participants: CompactMemoryParticipant[],
  directory: Map<string, CompactMemoryParticipant | null>
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
    output: toolCall.name === TOOL_NAMES.execCommand && typeof toolResult.codex_output === 'string'
      ? toolResult.codex_output
      : JSON.stringify(toolResult)
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
  if (toolCall.name === TOOL_NAMES.unreadMeaning) {
    const turnControl = deriveTurnControlState(loopInputAfterTool);
    const reminder = buildTurnControlReminder(turnControl);
    if (reminder) {
      inputItems.push(reminder);
    }
  }
  if (toolCall.name === TOOL_NAMES.imageTask) {
    const statusText = typeof toolResult.status_text === 'string' ? toolResult.status_text.trim() : '';
    inputItems.push(buildAssistantCommentaryInputItem([
      `<system_reminder>${statusText ? `[图片请求状态]\n${statusText}` : '图片请求已经提交。'}\n\n这还不等于已经对聊天对象说过话；如果当前仍该自然接话，就继续收口，不要把提交请求本身当成已经回复。</system_reminder>`
    ]));
  }
  if (toolCall.name === 'web_search') {
    const currentEnergy = extractLatestRuntimeEnergy(context?.loopInput ?? []);
    inputItems.push(buildAssistantCommentaryInputItem([
      buildRuntimeStateBlock({
        trigger: 'web_search',
        energy: currentEnergy - RUNTIME_TOOL_COSTS.web_search,
        note: 'hosted web_search completed'
      })
    ]));
  }
  return {
    inputItems,
    finishResult: null,
    forcedVisibleReply: null
  };
}

function extractLatestQueuedImageTaskState(loopInput: OpenResponseInputItem[]) {
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
    const statusText = typeof parsed.status_text === 'string' && parsed.status_text.trim()
      ? parsed.status_text.trim()
      : '图片请求已经提交。';
    const xiaoniOs = typeof parsed.xiaoni_os === 'string' && parsed.xiaoni_os.trim()
      ? parsed.xiaoni_os.trim()
      : null;
    return { statusText, xiaoniOs };
  }

  return null;
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
    const originatedFromLifeOnlyPresenceTick = isLifePresenceTickPayload(queueMessage.payload);
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
    let coreMemoryCompressionArtifact: Record<string, unknown> | null = null;
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
      pendingProactiveShareAge: 0,
      coreMemoryCompression: null
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
      const contextSessionKey = originatedFromLifeOnlyPresenceTick ? GLOBAL_LIFE_CONTEXT_SESSION_KEY : payload.sessionKey;
      const history = await this.store.listRecentTurns({
        userId: sessionIds.userId,
        groupId: sessionIds.groupId,
        afterConversationId: null,
        ...(originatedFromLifeOnlyPresenceTick ? { scope: 'global' as const, limit: LIFE_PRESENCE_GLOBAL_HISTORY_LIMIT } : {})
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
          const pendingImageTaskState = deliveredMessages.length === 0
            ? extractLatestQueuedImageTaskState(requestInput)
            : null;
          if (pendingImageTaskState) {
            const forcedToolName = payload.chatType === 'direct' ? TOOL_NAMES.privateReply : TOOL_NAMES.groupReply;
            await this.store.logTimelineEvent({
              traceId: payload.traceId,
              eventType: 'decision',
              eventName: 'forced_visible_reply',
              eventPhase: null,
              metadata: {
                source_tool_name: TOOL_NAMES.imageTask,
                tool_name: forcedToolName,
                reason: 'model_stopped_after_image_task_without_visible_reply'
              }
            });
            const forcedToolResult = await this.sendMessage(
              forcedToolName === TOOL_NAMES.privateReply ? 'private' : 'group',
              {
                messages: [pendingImageTaskState.statusText],
                ...(pendingImageTaskState.xiaoniOs ? { xiaoni_os: pendingImageTaskState.xiaoniOs } : {})
              },
              payload
            );
            if (typeof forcedToolResult?.xiaoni_os === 'string' && forcedToolResult.xiaoni_os.trim().length > 0) {
              persistedXiaoniOs = forcedToolResult.xiaoni_os.trim();
            }
            if (typeof forcedToolResult?.pending_share === 'string' && forcedToolResult.pending_share.trim().length > 0) {
              persistedPendingShare = forcedToolResult.pending_share.trim();
            }
            await this.store.markRunDeliveryCommitted(queueMessage.id);
            await this.recordVisibleDeliveryLifeEvents(payload, queueMessage.id, forcedToolName, forcedToolResult, true);
            await this.store.logTimelineEvent({
              traceId: payload.traceId,
              eventType: 'decision',
              eventName: 'delivery_commit',
              eventPhase: null,
              metadata: {
                tool_name: forcedToolName,
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
          } else if (deliveryState.deliveryPhase !== 'reasoning_open' && deliveredMessages.length > 0) {
            finishResult = {
              finished: true,
              outcome: 'reply_sent',
              reason: 'Visible delivery already committed; model finished without another tool call.',
              no_reply: false
            };
          } else {
            loopContinuation.push(buildAssistantCommentaryInputItem([
              formatTaggedBlock('system_reminder', {
                source: 'no_tool_call_continue',
                required_next: 'act_or_recover'
              }, [
                '刚才没有调用任何工具，所以当前动作还没有完成。',
                '如果当前要回复，就调用说话工具；如果需要外部信息，就调用 web_search / inspect_image_placeholder / request_image_task；如果精力状态显示该休息，就按自己的状态调用 recover_energy。',
                '不要用“没有工具调用”表达沉默或结束。'
              ].join('\n'))
            ]));
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

            let rawToolResult = await this.executeTool(toolCall, payload);
            if (toolCall.name === TOOL_NAMES.compressCoreMemory) {
              const text = typeof rawToolResult.text === 'string' && rawToolResult.text.trim()
                ? rawToolResult.text.trim()
                : null;
              if (!text) {
                throw new Error(`${TOOL_NAMES.compressCoreMemory} requires non-empty text`);
              }
              const compression = budgetPlan.coreMemoryCompression;
              const compressionSessionKey = compression?.contextSessionKey ?? contextSessionKey;
              await this.store.upsertSessionContextSummary({
                sessionKey: compressionSessionKey,
                contextSummary: text
              });
              if (compression) {
                await this.store.upsertSessionReadCutoffState({
                  sessionKey: compression.contextSessionKey,
                  readCutoffAfterConversationId: compression.readCutoffAfterConversationId,
                  lastContextWindowTokens: compression.lastContextWindowTokens,
                  lastTargetBudgetTokens: compression.lastTargetBudgetTokens,
                  lastHardBudgetTokens: compression.lastHardBudgetTokens
                });
              }
              coreMemoryCompressionArtifact = {
                tool_name: toolCall.name,
                context_session_key: compressionSessionKey,
                read_cutoff_after_conversation_id: compression?.readCutoffAfterConversationId ?? null,
                previous_read_cutoff_after_conversation_id: compression?.previousReadCutoffAfterConversationId ?? null,
                source_response_id: modelResult.llm_call_id || null,
                tool_call_id: toolCall.callId,
                text_length: text.length
              };
              rawToolResult = {
                ...rawToolResult,
                context_summary_written: true,
                read_cutoff_written: Boolean(compression),
                context_session_key: compressionSessionKey,
                read_cutoff_after_conversation_id: compression?.readCutoffAfterConversationId ?? null
              };
              await this.store.logTimelineEvent({
                traceId: payload.traceId,
                eventType: 'memory',
                eventName: 'core_memory_compressed',
                eventPhase: null,
                metadata: coreMemoryCompressionArtifact
              });
            }
            const toolResult = rawToolResult;
            if (toolCall.name === TOOL_NAMES.recoverEnergy) {
              const recoveryRecorder = (this.store as RuntimeStore & {
                recordRecoverEnergyLifeEvent?: RuntimeStore['recordRecoverEnergyLifeEvent'];
              }).recordRecoverEnergyLifeEvent;
              if (typeof recoveryRecorder === 'function') {
                await recoveryRecorder.call(this.store, {
                  queueMessage: payload,
                  runId: queueMessage.id,
                  toolName: toolCall.name,
                  toolResult
                }).catch((error) => {
                  moduleLogger.warn('Failed to record recover_energy life event', {
                    traceId: payload.traceId,
                    runId: queueMessage.id,
                    error: error instanceof Error ? error.message : String(error)
                  });
                });
              }
            }
            if (typeof toolResult?.xiaoni_os === 'string' && toolResult.xiaoni_os.trim().length > 0) {
              persistedXiaoniOs = toolResult.xiaoni_os.trim();
            }
            if (typeof toolResult?.pending_share === 'string' && toolResult.pending_share.trim().length > 0) {
              persistedPendingShare = toolResult.pending_share.trim();
            }
            if (toolCall.name === TOOL_NAMES.unreadMeaning) {
              unreadMeaningArtifact = toolResult;
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
      persistedXiaoniOs = appendPendingShareToXiaoniOs(persistedXiaoniOs, persistedPendingShare);
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
          pending_share: persistedPendingShare,
          loop_stage_artifacts: {
            unread_meaning: unreadMeaningArtifact,
            core_memory_compression: coreMemoryCompressionArtifact
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
          pending_share: persistedPendingShare,
          stored_feedback_reflection_ids: storedFeedbackReflectionIds,
          total_turns: turnsExecuted,
          finish_result: finishResult,
          core_memory_compression: coreMemoryCompressionArtifact,
          termination_reason: termination.terminationReason
        }
      });
      const recoveredEnergy = Boolean(finishResult?.recovered);
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
      if (sentMessages.length === 0 && !recoveredEnergy) {
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

  private async buildDeveloperContextBlock(_queueMessage: QueueMessageRecord['payload']): Promise<string | null> {
    const parts: string[] = [];

    if (agentConfig.worldNarrative && agentConfig.worldNarrative.trim()) {
      parts.push(`<world_narrative>\n${agentConfig.worldNarrative.trim()}\n</world_narrative>`);
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
        activationReason: 'accepted identity facts were selected for runtime metadata',
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
      const newCutoffTurn = initialRetainedHistory[initialRetainedHistory.length - HISTORY_COMPACT_KEEP - 1];
      const newCutoffId = newCutoffTurn?.id ?? cutoffState?.readCutoffAfterConversationId ?? null;

      const compressionLoopContinuation = [
        ...params.loopContinuation,
        buildCoreMemoryCompressionReminder({
          contextSessionKey,
          readCutoffAfterConversationId: newCutoffId,
          pressureSummary: `当前可读历史 ${initialRetainedHistory.length} 条，超过压缩阈值 ${HISTORY_COMPACT_AT}。`
        })
      ];
      const requestInput = buildLoopRequestInput({
        history: initialRetainedHistory,
        queueMessage: params.queueMessage,
        runtimePrompt: params.runtimePrompt,
        loopContinuation: compressionLoopContinuation,
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
        retainedHistory: initialRetainedHistory,
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
        pendingProactiveShareAge,
        coreMemoryCompression: {
          required: true,
          contextSessionKey,
          readCutoffAfterConversationId: newCutoffId,
          previousReadCutoffAfterConversationId: cutoffState?.readCutoffAfterConversationId ?? null,
          lastContextWindowTokens: contextWindowTokens ?? 0,
          lastTargetBudgetTokens: targetBudgetTokens ?? 0,
          lastHardBudgetTokens: hardBudgetTokens ?? 0
        }
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
        pendingProactiveShareAge,
        coreMemoryCompression: null
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

    const compressionLoopContinuation = [
      ...params.loopContinuation,
      buildCoreMemoryCompressionReminder({
        contextSessionKey,
        readCutoffAfterConversationId: recomputed.readCutoffAfterConversationId,
        pressureSummary: `预计输入 ${initialEstimate.inputTokens} tokens，超过 hard budget ${hardBudgetTokens}，必须先压缩核心记忆。`
      })
    ];
    const compressionRequestInput = buildLoopRequestInput({
      history: recomputed.retainedHistory,
      queueMessage: params.queueMessage,
      runtimePrompt: params.runtimePrompt,
      loopContinuation: compressionLoopContinuation,
      runtimeIdentityFacts: params.runtimeIdentityFacts,
      contextSummary,
      pendingProactiveShare,
      developerContextBlock: params.developerContextBlock ?? null
    });
    const compressionEstimate = await estimateLoopInputTokens({
      modelName: params.runtimePrompt.modelName,
      queueMessage: params.queueMessage,
      loopInput: compressionRequestInput
    });

    return {
      requestInput: compressionRequestInput,
      summarySourceInput: initialRequestInput,
      retainedHistory: recomputed.retainedHistory,
      runtimeIdentityFacts: params.runtimeIdentityFacts,
      readCutoffAfterConversationId: recomputed.readCutoffAfterConversationId,
      previousReadCutoffAfterConversationId: cutoffState?.readCutoffAfterConversationId ?? null,
      estimatedInputTokens: compressionEstimate.inputTokens,
      contextWindowTokens,
      targetBudgetTokens,
      hardBudgetTokens,
      tokenizerEncoding: compressionEstimate.encoding,
      tokenizerSource: compressionEstimate.source,
      cutoffRecomputed: true,
      contextSummary,
      pendingProactiveShare,
      pendingProactiveShareAge,
      coreMemoryCompression: {
        required: true,
        contextSessionKey,
        readCutoffAfterConversationId: recomputed.readCutoffAfterConversationId,
        previousReadCutoffAfterConversationId: cutoffState?.readCutoffAfterConversationId ?? null,
        lastContextWindowTokens: contextWindowTokens,
        lastTargetBudgetTokens: targetBudgetTokens,
        lastHardBudgetTokens: hardBudgetTokens
      }
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
    queueMessage: QueueMessageRecord['payload']
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
      case TOOL_NAMES.execCommand: {
        return this.executeCommand(toolCall.args);
      }
      case TOOL_NAMES.inspectImage: {
        return this.inspectImagePlaceholder(toolCall.args, queueMessage);
      }
      case TOOL_NAMES.imageTask: {
        return this.requestImageTask(toolCall.args, queueMessage);
      }
      case TOOL_NAMES.recoverEnergy: {
        const durationMinutes = normalizeRecoverEnergyDurationMinutes(toolCall.args.duration_minutes ?? toolCall.args.durationMinutes);
        return {
          finished: true,
          recovered: true,
          reason: typeof toolCall.args.reason === 'string' ? toolCall.args.reason : null,
          duration_minutes: durationMinutes,
          duration_ms: durationMinutes * 60 * 1000,
          energy_cost: RUNTIME_TOOL_COSTS[TOOL_NAMES.recoverEnergy],
          xiaoni_os: typeof toolCall.args.xiaoni_os === 'string' && toolCall.args.xiaoni_os.trim()
            ? toolCall.args.xiaoni_os.trim()
            : null
        };
      }
      case TOOL_NAMES.compressCoreMemory: {
        const text = typeof toolCall.args.text === 'string' && toolCall.args.text.trim()
          ? toolCall.args.text.trim()
          : '';
        if (!text) {
          throw new Error(`${TOOL_NAMES.compressCoreMemory} requires text`);
        }
        return {
          compressed: true,
          text,
          outcome: 'core_memory_compressed'
        };
      }
      default:
        throw new Error(`Unsupported tool: ${toolCall.name}`);
    }
  }

  private async executeCommand(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const cmd = typeof args.cmd === 'string' && args.cmd.trim()
      ? args.cmd
      : '';
    if (!cmd) {
      const message = `${TOOL_NAMES.execCommand} requires cmd`;
      return {
        cmd,
        workdir: process.cwd(),
        shell: process.env.SHELL || '/bin/sh',
        login: args.login !== false,
        tty: Boolean(args.tty),
        sandbox_permissions: typeof args.sandbox_permissions === 'string' ? args.sandbox_permissions : 'use_default',
        exit_code: null,
        signal: null,
        timed_out: false,
        duration_ms: 0,
        stdout: '',
        stderr: message,
        truncated: false,
        error_message: message,
        codex_output: buildCodexExecOutput({
          chunkId: uuidv4().slice(0, 8),
          durationMs: 0,
          exitCode: null,
          output: message
        })
      };
    }

    if (agentConfig.xiaoniExecutorUrl) {
      try {
        const response = await fetch(`${agentConfig.xiaoniExecutorUrl}/api/internal/exec-command`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(args)
        });
        const text = await response.text();
        let payload: unknown = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = null;
        }
        if (!response.ok) {
          throw new Error(`xiaoni-executor HTTP ${response.status}: ${text || response.statusText}`);
        }
        if (payload && typeof payload === 'object' && 'result' in payload) {
          const result = (payload as { result?: unknown }).result;
          if (result && typeof result === 'object' && !Array.isArray(result)) {
            return result as Record<string, unknown>;
          }
        }
        throw new Error(`xiaoni-executor returned invalid payload: ${text}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          cmd,
          executor: 'xiaoni-executor',
          executor_unavailable: true,
          workdir: typeof args.workdir === 'string' && args.workdir.trim() ? args.workdir.trim() : process.cwd(),
          shell: typeof args.shell === 'string' && args.shell.trim() ? args.shell.trim() : process.env.SHELL || '/bin/sh',
          login: args.login !== false,
          tty: Boolean(args.tty),
          sandbox_permissions: typeof args.sandbox_permissions === 'string' ? args.sandbox_permissions : 'use_default',
          exit_code: null,
          signal: null,
          timed_out: false,
          duration_ms: 0,
          stdout: '',
          stderr: message,
          truncated: false,
          error_message: message,
          codex_output: buildCodexExecOutput({
            chunkId: uuidv4().slice(0, 8),
            durationMs: 0,
            exitCode: null,
            output: message
          })
        };
      }
    }

    const shell = typeof args.shell === 'string' && args.shell.trim()
      ? args.shell.trim()
      : process.env.SHELL || '/bin/sh';
    const workdir = typeof args.workdir === 'string' && args.workdir.trim()
      ? args.workdir.trim()
      : process.cwd();
    const login = args.login !== false;
    const maxOutputTokens = clampNumber(args.max_output_tokens, 10_000, 1, 200_000);
    const maxOutputChars = Math.max(1, maxOutputTokens * 4);
    const timeoutMs = clampNumber(args.yield_time_ms, 10_000, 250, 30_000);
    const startedAt = Date.now();

    return await new Promise<Record<string, unknown>>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const sandboxPermissions = typeof args.sandbox_permissions === 'string'
        ? args.sandbox_permissions
        : 'use_default';
      const buildResult = (input: {
        exitCode: number | null;
        signal: NodeJS.Signals | null;
        errorMessage?: string | null;
      }) => {
        const durationMs = Date.now() - startedAt;
        const truncated = stdout.length >= maxOutputChars || stderr.length >= maxOutputChars;
        return {
          cmd,
          workdir,
          shell,
          login,
          tty: Boolean(args.tty),
          sandbox_permissions: sandboxPermissions,
          exit_code: input.exitCode,
          signal: input.signal || null,
          timed_out: timedOut,
          duration_ms: durationMs,
          stdout,
          stderr,
          truncated,
          codex_output: buildCodexExecOutput({
            chunkId: uuidv4().slice(0, 8),
            durationMs,
            exitCode: input.exitCode,
            signal: input.signal || null,
            output: stdout + stderr,
            truncated
          }),
          ...(input.errorMessage ? { error_message: input.errorMessage } : {})
        };
      };
      const finish = (result: Record<string, unknown>) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        resolve(result);
      };

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(shell, resolveExecShellArgs(shell, cmd, login), {
          cwd: workdir,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stderr = appendCappedOutput(stderr, Buffer.from(message), maxOutputChars);
        finish(buildResult({
          exitCode: null,
          signal: null,
          errorMessage: message
        }));
        return;
      }

      timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!settled) {
            child.kill('SIGKILL');
          }
        }, 1_000).unref();
      }, timeoutMs);
      timeout.unref();

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = appendCappedOutput(stdout, chunk, maxOutputChars);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = appendCappedOutput(stderr, chunk, maxOutputChars);
      });
      child.on('error', (error) => {
        const message = error instanceof Error ? error.message : String(error);
        stderr = appendCappedOutput(stderr, Buffer.from(message), maxOutputChars);
        finish(buildResult({
          exitCode: null,
          signal: null,
          errorMessage: message
        }));
      });
      child.on('close', (code, signal) => {
        finish(buildResult({
          exitCode: typeof code === 'number' ? code : null,
          signal: signal || null
        }));
      });
    });
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
    const requestedOperation = args.operation === 'edit' ? 'edit' : 'generate';
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
    const operation = requestedOperation === 'edit' && mediaAssets.length > 0 ? 'edit' : 'generate';
    const normalizedFromEdit = requestedOperation === 'edit' && operation === 'generate';
    const normalizationReason = normalizedFromEdit
      ? sourceMediaTags.length > 0
        ? 'source_media_unresolved'
        : 'source_media_missing'
      : null;

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
        requested_operation: requestedOperation,
        source_media_tags: sourceMediaTags,
        has_source_media: mediaAssets.length > 0,
        ...(normalizedFromEdit ? {
          normalized_from_edit: true,
          normalization_reason: normalizationReason
        } : {})
      }
    });

    const xiaoniOs = typeof args.xiaoni_os === 'string' && args.xiaoni_os.trim()
      ? args.xiaoni_os.trim()
      : null;

    return {
      queued: true,
      task_type: operation === 'edit' ? 'image_edit' : 'image_generate',
      requested_task_type: requestedOperation === 'edit' ? 'image_edit' : 'image_generate',
      task_context: targetDescription,
      xiaoni_os: xiaoniOs,
      status_text: operation === 'edit'
        ? `我已经开始帮${queueMessage.senderName || '对方'}处理这张图，等结果出来再发。`
        : normalizedFromEdit
          ? `我这边没拿到可用原图，先帮${queueMessage.senderName || '对方'}生成一张新图，等结果出来再发。`
          : `我已经开始帮${queueMessage.senderName || '对方'}生成这张图，等结果出来再发。`
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
    void options;
    const sanitizedArgs = args;
    const xiaoniOs = typeof sanitizedArgs.xiaoni_os === 'string' && sanitizedArgs.xiaoni_os.trim()
      ? sanitizedArgs.xiaoni_os.trim()
      : null;
    const pendingShare = typeof sanitizedArgs.pending_share === 'string' && sanitizedArgs.pending_share.trim()
      ? sanitizedArgs.pending_share.trim()
      : null;

    if (messageType === 'private') {
      const userId = resolvePrivateTargetUserId(queueMessage, sanitizedArgs);
      const messages = normalizeMessages(sanitizedArgs);
      if (!Number.isFinite(userId) || messages.length === 0) {
        throw new Error(`${TOOL_NAMES.privateReply} requires a valid private target plus message or messages`);
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
        target_user_id: userId,
        sent_messages: messages,
        xiaoni_os: xiaoniOs,
        pending_share: pendingShare,
        delivery: payload.data || null
      };
    }

    const groupId = resolveGroupTargetId(queueMessage, sanitizedArgs);
    const normalizedMessages = normalizeMessages(sanitizedArgs);
    const plannedDelivery = {
      messages: normalizedMessages,
      mentionUserIds: normalizeOptionalIntegerList(sanitizedArgs.mention_user_ids),
      secondBeatSuppressed: false
    };
    if (!Number.isFinite(groupId) || plannedDelivery.messages.length === 0) {
      throw new Error(`${TOOL_NAMES.groupReply} requires a valid group target plus message or messages`);
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
      target_group_id: groupId,
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
  latestUnreadReceivedAt?: string | null;
  latest_unread_received_at?: string | null;
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
        const leftTime = Date.parse(String(
          left.latestUnreadReceivedAt
          ?? left.latest_unread_received_at
          ?? left.lastReceivedAt
          ?? left.last_received_at
          ?? ''
        )) || 0;
        const rightTime = Date.parse(String(
          right.latestUnreadReceivedAt
          ?? right.latest_unread_received_at
          ?? right.lastReceivedAt
          ?? right.last_received_at
          ?? ''
        )) || 0;
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
  _runtimeIdentityFacts: RuntimeIdentityFactProjection[] = [],
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

  items.push(buildDeveloperInputItem([
    developerContextParts.worldNarrative,
    SKILLS_INSTRUCTIONS,
    buildCapabilitiesDeveloperBlock().block
  ].filter((part): part is string => Boolean(part))));

  if (contextSummary) {
    items.push(buildAssistantCommentaryInputItem([`<小腻近况>\n${contextSummary}\n</小腻近况>`]));
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

  items.push(...buildCurrentTurnInputItems(queueMessage, runtimePrompt));
  const mediaPlaceholderContext = renderCurrentMediaPlaceholderContext(queueMessage);
  if (mediaPlaceholderContext) {
    items.push(buildAssistantCommentaryInputItem([mediaPlaceholderContext]));
  }
  items.push(buildAssistantCommentaryInputItem([buildCurrentProcessingReminder(queueMessage)]));
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
  const block = developerContextBlock
    ?.replace(/<current_relationship>[\s\S]*?<\/current_relationship>/g, '')
    .trim();
  if (!block) {
    return {
      worldNarrative: null,
      dynamicContext: null,
      capabilityRefresh: false
    };
  }

  const worldNarrativeMatch = block.match(/<world_narrative>[\s\S]*?<\/world_narrative>/);
  const worldNarrative = worldNarrativeMatch?.[0]?.trim() || null;
  const capabilityRefresh = /<capability_refresh\b/i.test(block)
    || /<CAPABILITY_REFRESH\b/.test(block);
  const dynamicContext = worldNarrative
    ? block.replace(worldNarrative, '').trim()
    : block;

  return {
    worldNarrative,
    dynamicContext: dynamicContext || null,
    capabilityRefresh
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
      '<xiaoni_os>',
      xiaoniOs,
      '</xiaoni_os>'
    ].join('\n');
  }

  if (finishReason && !turn.aiResponse && sentMessages.length === 0) {
    return [
      '<xiaoni_os>',
      `刚才我没有接。${finishReason}`,
      '</xiaoni_os>'
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

function resolveOptionalToolTargetId(args: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (!(key in args)) {
      continue;
    }
    const numeric = Number(args[key]);
    if (!Number.isFinite(numeric)) {
      throw new Error(`Invalid target id in tool argument ${key}: ${String(args[key])}`);
    }
    return Math.trunc(numeric);
  }
  return null;
}

function resolvePrivateTargetUserId(queueMessage: QueueMessageRecord['payload'], args: Record<string, unknown> = {}) {
  const explicitUserId = resolveOptionalToolTargetId(args, 'user_id', 'target_user_id');
  const userId = explicitUserId ?? Number(queueMessage.senderId);
  if (!Number.isFinite(userId)) {
    throw new Error(`Invalid sender id in queue payload: ${queueMessage.senderId}`);
  }
  return userId;
}

function resolveGroupTargetId(queueMessage: QueueMessageRecord['payload'], args: Record<string, unknown> = {}) {
  const explicitGroupId = resolveOptionalToolTargetId(args, 'group_id', 'target_group_id');
  const groupId = explicitGroupId ?? Number(queueMessage.inboundContext.NativeChannelId || queueMessage.peerId);
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

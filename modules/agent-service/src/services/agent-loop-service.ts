import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { createWriteStream, mkdirSync } from 'node:fs';
import {
  lstat as fsLstat,
  mkdir as fsMkdir,
  readdir as fsReaddir,
  readFile as fsReadFile,
  rename as fsRename,
  rm as fsRm,
  stat as fsStat,
  writeFile as fsWriteFile
} from 'node:fs/promises';
import * as nodePath from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { agentConfig, getGlobalPromptContextSessionKey } from '../config';
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
  normalizeTranscriptMessageText
} from './runtime-input-renderer';
import {
  RuntimeStore,
  type RuntimeAcceptedIdentityFact,
  type RuntimePresenceContext,
  type SessionReadCutoffState
} from './runtime-store';
import { resolveModelContextPolicy } from './model-context-policy';
import {
  runWebSearch,
  normalizeWebSearchSource,
  type WebSearchClientConfig
} from './web-search-client';
import {
  renderResultsMarkdown,
  writeResultsFile,
  readResultsPage,
  paginate,
  sanitizeRef,
  checkDailyUsage
} from './web-search-archive';
import {
  formatEast8Timestamp,
  renderWakeAnchorSentence,
  renderSleepTimelineBlock,
  renderCompressionSpanAnchor,
  type SleepSegment
} from './east8-time';
import { planStackReadCutoffByBlockBudget, type StackBlockRef } from './stack-context-budget';
import { defaultCwebpEncoder } from './qq-send-image-service';
import { XIAONI_HEAD_AVATAR_DATA_URL } from './xiaoni-avatar';
import { fireActionStreamRecall, fireConsumedNotifyRecall } from './xiaoni-recall-hook';
import {
  ResponseActionRouter,
  type ResponsePostAction,
  type ReplayableModelOutput,
  extractReplayableModelOutputs,
  isReplayableToolCall
} from './response-action-router';
import { readXiaoniPromptFile, renderXiaoniPromptTemplate } from '../prompts/xiaoni-prompt-files';
// 专题物化的三个归一化函数**只从这里拿**,不在本文件另写第四个:
//   stripTrailingHashTags   行末 `#标签` 剥离(open-loops 的行身份口径)
//   stripChapterDatePrefix  L3 章节标题的 `M/D ` 前缀剥离
//   normalizeEventText      折空白 + 小写(日记条目标题的去重口径)
// 单用任何一个都认不出同一件事:章节标题带 M/D 前缀,而 normalizeEventText 不碰前缀。
import {
  normalizeEventText,
  stripChapterDatePrefix,
  stripTrailingHashTags
} from '@qq-bot/persistence';
import {
  issueSubconsciousPlanTicket,
  findSubconsciousPlanTicket,
  consumeSubconsciousPlanTicket
} from './subconscious-plan-ticket';
import {
  DEFAULT_RECOVER_ENERGY_POLICY,
  DEFAULT_ACTION_COST_SCALE,
  LEGACY_RECOVER_ENERGY_POLICY,
  LEGACY_RECOVER_ENERGY_POLICY_VERSION,
  RECOVER_ENERGY_CLOCK_MAX_MINUTES,
  type RecoverySessionPolicy,
  type EffectiveEnergyPolicy,
  createRecoveryPolicySnapshot,
  estimateNaturalWakeAt,
  estimateSessionWakeAt,
  normalizeRecoverEnergyClock,
  projectRecoverySession,
  recoverEnergyFullRecoveryMinutes,
  recoverySessionPolicyFromSnapshot,
  resolveRecoveryCircadianState,
  shouldAcceptVoluntaryRecovery
} from './recover-energy-policy';

type OpenResponseInputItem =
  | {
      type: 'message';
      role: 'system' | 'user' | 'assistant' | 'developer';
      content: string | OpenResponseInputContentPart[];
      phase?: ConversationTranscriptPhase;
      [key: string]: unknown;
    }
  | {
      type: 'function_call';
      call_id: string;
      name: string;
      arguments: string;
      [key: string]: unknown;
    }
  | {
      type: 'function_call_output';
      call_id: string;
      output: string | OpenResponseInputContentPart[];
      [key: string]: unknown;
    }
  | {
      type: 'reasoning';
      content?: string;
      summary?: string | Array<Record<string, unknown>>;
      encrypted_content?: string;
      [key: string]: unknown;
    }
  | {
      type: string;
      [key: string]: unknown;
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
      detail?: 'low' | 'high' | 'auto' | 'original';
    };

const CORE_MEMORY_COMPRESSION_REMINDER_MARKER = Symbol('coreMemoryCompressionReminder');

// 固化 head avatar: a byte-STABLE image pinned at the head of every main-agent request
// (below <xiaoni_status>), so小腻's context is ALWAYS image-bearing. Every build renders the
// exact same bytes → it stays inside the cached prefix and never triggers a text↔image
// messages-tier transition when a computer_use screenshot turn appends an image.
// Sourced固化 from docs/xiaoni.jpg (see services/xiaoni-avatar.ts). Empty string = disabled.

function buildXiaoniHeadAvatarInputItem(): OpenResponseInputItem | null {
  const url = XIAONI_HEAD_AVATAR_DATA_URL.trim();
  if (!url) {
    return null;
  }
  return {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_image', image_url: url, detail: 'auto' }]
  } as unknown as OpenResponseInputItem;
}

const IMAGE_VISION_FORK_MAX_FILE_WRITE_ATTEMPTS = 10;
const IMAGE_VISION_OBSERVATION_DIR = '/xiaoni-runtime/image-vision/observations';
const SUBCONSCIOUS_AGENT_FORK_IDLE_BACKOFF_MS = 60_000;
// 同一份 seed 最多重试这么多次。到顶就丢弃,退回「等下一个主 run 或 clock_ping(≤2h)」。
// 5 次 × 60s ≈ 5 分钟的自愈窗口,再往后大概率不是瞬时故障,不值得每分钟烧一个 ~490K 的 fork 请求。
const SUBCONSCIOUS_AGENT_FORK_MAX_CONSECUTIVE_FAILURES = 5;

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
} | {
  type: 'image_generation';
  model?: 'gpt-image-2';
  output_format?: 'png' | 'jpeg' | 'webp';
  size?: string;
  quality?: string;
  background?: string;
} | {
  type: 'computer_use';
  display_width_px: number;
  display_height_px: number;
  display_number?: number;
  enable_zoom?: boolean;
};

type OpenResponseToolChoice =
  | 'auto'
  | 'required'
  | 'none'
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
        | {
            type: 'image_generation';
          }
        | {
            type: 'computer_use';
          }
      >;
    };

type FeedbackWriterToolChoice = OpenResponseToolChoice | undefined;

type ToolContinuationAction = {
  inputItems: OpenResponseInputItem[];
  oneShotInputItems: OpenResponseInputItem[];
  forcedVisibleReply: {
    toolName: string;
    args: Record<string, unknown>;
  } | null;
};

type ToolContinuationContext = {
  loopInput: OpenResponseInputItem[];
  speakingToolName: string;
  hasVisibleReply: boolean;
  runtimeEnergyState?: RuntimeEnergyState | null;
};

type ToolExecutionContext = {
  currentCanonicalRequest?: CanonicalAgentTurnRequest;
};

export type RuntimeEnergyState = {
  energy: number;
  maxEnergy: number;
  lastWakeAt?: string | null;
};

type DeliveredAssistantMessage = {
  content: string;
  deliveryMessageId: number | null;
};

type LeaseReleaseReason =
  | 'visible_delivery_committed'
  | 'no_visible_delivery_observed'
  | 'runtime_frame_yielded'
  | 'runtime_error'
  | 'prompt_binding_error'
  | 'wire_bytes_overrun';

type LeaseReleaseRecord = {
  event_kind: 'lease_released';
  reason: LeaseReleaseReason;
  detail: string | null;
  outcome: string | null;
  no_visible_delivery: boolean;
  visible_delivery_committed: boolean;
  source: string;
  tool_result?: Record<string, unknown>;
};

type ReplayableToolCallOutput = Extract<ReplayableModelOutput, { type: 'tool_call' }>;

// One BLOCK of the flat agent stack (one agent_stack_items row), modeled as a
// degenerate single-block "turn" so the existing assembly loop (buildInitialInput) and
// the cutoff filter (applyReadCutoff: id > cutoff) work unchanged. `id` is the dense
// ascending stack_index (NOT a conversation_id). `opensCallId`/`closesCallId` carry the
// tool-pair info the block-budget planner needs to cut on a clean boundary. There is no
// conversation/turn concept: the only unit is the BLOCK.
type StackBackedConversationTurn = ConversationTurn & {
  stackReplayItems?: OpenResponseInputItem[];
  opensCallId?: string | null;
  closesCallId?: string | null;
};

// Backstop cap (blocks): when the stack cutoff is null (fresh/stale session) or older than
// this many blocks behind the head, the flat history read is floored to head - cap so a
// missing/old cutoff can never load the whole stack into context. Comfortably above
// HISTORY_COMPACT_KEEP (80) so it never clips the normally-retained tail.
const STACK_HISTORY_READ_BACKSTOP_BLOCKS = 200;

type PreSleepToolTimelineEntry = {
  call_id: string;
  name: string;
  completed_at: string;
  status: 'completed' | 'failed';
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
  parallel_tool_calls: boolean;
  prompt_cache_key?: string;
  prompt_cache_retention?: string;
  max_output_tokens?: number;
  store?: boolean;
};

type CacheHeartbeatRunResult = {
  triggered: boolean;
  reason?: string;
  executionMode: string;
  traceId?: string;
  runId?: string;
  promptName?: string;
  model?: string | null;
  provider?: string | null;
  llmCallId?: string | null;
  promptCacheKey?: string | null;
  store?: boolean | null;
  maxOutputTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  cachedInputTokens?: number | null;
  processingTimeMs?: number | null;
};

// Result of an operator-forced core memory compaction (admin "立即压缩" button).
// `status` mirrors scheduleCoreMemoryCompressionFork's artifact status
// (scheduled | already_running | already_running_durable | already_covered),
// plus 'nothing_to_compress' (history at/under the keep window) and
// 'request_builder_unavailable' (store wiring missing). `triggered` is true only
// when this call actually spawned a new background fork.
type ManualCoreMemoryCompressionResult = {
  triggered: boolean;
  status: string;
  contextSessionKey: string;
  traceId: string;
  runId: string;
  retainedHistoryTurns?: number;
  readCutoffAfterStackIndex?: number | null;
  compressionCoveredEndStackIndex?: number | null;
  artifact?: Record<string, unknown> | null;
};

// Liveness snapshot for the (fire-and-forget, possibly >5min) compaction fork.
// Reuses findActiveCoreMemoryCompressionForkRun's 30-minute running-window, so
// `running: false` means "no fork running for this covered range" (done, failed,
// or never started) — a deliberately coarse v1 signal until liveness hardening.
type CoreMemoryCompressionForkStatusResult = {
  running: boolean;
  contextSessionKey: string;
  compressionCoveredEndStackIndex: number;
  forkRunId?: string | null;
  runId?: string | null;
  startedAt?: string | null;
  status?: string | null;
};

type RecoverySessionHeartbeatState = {
  id: number | string;
};

type AgentLoopServiceOptions = {
  isRuntimeEnabled?: () => boolean | Promise<boolean>;
  isCacheHeartbeatPaused?: () => boolean | Promise<boolean>;
  getMainAgentPreModelYieldMs?: () => number | Promise<number>;
  onCoreMemoryCompressionCommitted?: (commit: CoreMemoryCompressionCommit) => void | Promise<void>;
  runtimePausePollMs?: number;
  preModelSliceYieldMs?: number;
  sleepMs?: (ms: number) => Promise<void>;
};

type AgentRuntimeIterationParams = {
  workerId: string;
  idleIntervalMs: number;
  sleepMs?: (ms: number) => Promise<void>;
};

export type AgentRuntimeLoopParams = AgentRuntimeIterationParams & {
  isStopping?: () => boolean;
  recoverStaleProcessingLeases?: () => Promise<void>;
  shouldReloadRuntimePrompt?: () => boolean | Promise<boolean>;
  onBusyChange?: (busy: boolean) => void;
  onRuntimeEnabledChange?: (enabled: boolean) => void;
  onRuntimeLoopError?: (error: unknown) => void;
  sleepMs?: (ms: number) => Promise<void>;
  bootstrapPromptPayload?: QueueMessageRecord['payload'];
};

type ProcessRuntimeFrameOptions = {
  queueBacked?: boolean;
  triggerInputMode?: RuntimeTriggerInputMode;
  appendRuntimeInputStackItem?: boolean;
  logQueueLifecycle?: boolean;
  initialLoopContinuation?: OpenResponseInputItem[];
  initialLoopContinuationBeforeCurrentTrigger?: boolean;
  recoveryWakeCountStartQueueMessageId?: number | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ProviderAgentResponse = {
  success: boolean;
  llm_call_id?: string;
  llm_request_slice_id?: string;
  response?: string;
  model?: string;
  provider?: string;
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
  wire_request_headers?: Record<string, unknown> | null;
  wire_request_url?: string | null;
  wire_response?: Record<string, unknown>;
  wire_response_headers?: Record<string, unknown> | null;
  wire_response_status?: number | null;
  wire_response_status_text?: string | null;
  raw_response?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  usage_details?: Record<string, unknown>;
  request_format_version?: string;
  wire_provider_format?: string;
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
  readCutoffAfterStackIndex: number | null;
  contextWindowTokens: number | null;
  targetBudgetTokens: number | null;
  hardBudgetTokens: number | null;
  tokenizerEncoding: string | null;
  tokenizerSource: 'tiktoken' | 'heuristic' | null;
  cutoffRecomputed: boolean;
};

type CoreMemoryCompressionPlan = {
  required: true;
  contextSessionKey: string;
  readCutoffAfterStackIndex: number | null;
  previousReadCutoffAfterStackIndex: number | null;
  compressionCoveredEndStackIndex: number | null;
  historyUserId: number;
  historyGroupId: number | null;
  historyScope: 'global';
  lastContextWindowTokens: number;
  lastTargetBudgetTokens: number;
  lastHardBudgetTokens: number;
};

type CoreMemoryCompressionCheckpoint = {
  compression: CoreMemoryCompressionPlan;
  summarySourceInput: OpenResponseInputItem[];
};

type ContextBudgetPlan = {
  requestInput: OpenResponseInputItem[];
  // The current-turn input items built ONCE for this trigger. The sent request and
  // the runtime_input 存档 (persisted for next-run replay) both reuse this exact
  // array instead of each rebuilding it, so the cached bytes == the replayed bytes.
  currentTurnInputItems: OpenResponseInputItem[];
  selfContinuationInputItem: OpenResponseInputItem | null;
  summarySourceInput: OpenResponseInputItem[] | null;
  retainedHistory: ConversationTurn[];
  runtimeIdentityFacts: RuntimeIdentityFactProjection[];
  readCutoffAfterStackIndex: number | null;
  previousReadCutoffAfterStackIndex: number | null;
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
  coreMemoryCompression: CoreMemoryCompressionPlan | null;
};

type CoreMemoryCompressionCommit = {
  text: string;
  artifact: Record<string, unknown>;
  toolResult: Record<string, unknown>;
};

type CoreMemoryCompressionForkState = {
  promise: Promise<CoreMemoryCompressionCommit>;
  compression: CoreMemoryCompressionPlan;
  startedAtMs: number;
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

type RuntimeTriggerInputMode = 'fresh_trigger' | 'suppress_current_trigger';

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
  conversationId: number | null;
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
// Retained-tail floor (blocks). Compression keeps the most recent HISTORY_COMPACT_KEEP blocks
// verbatim and folds everything older into the 近况 capsule.
//
// Raised 30 -> 80 when compression became schedulable after ANY LLM request (previously it could
// only fire at the head of an activation, i.e. right after a stretch of work had settled, so 30
// blocks reliably covered "the thing she just finished"). Firing mid-stream means the cut can land
// while she is partway through a long tool chain, and 30 blocks is only ~15 requests of context —
// enough to fold the OPENING of the task she is still working on into the summary. 80 keeps ~40
// requests, which covers the long chains observed in practice (750-request stretch -> 1501 stack
// items ≈ 2 items/request).
//
// This is a floor, not a target: raising it does not change the cacheable prefix bytes, only how
// much survives each compression (so slightly less reclaimed per fire, slightly more frequent
// fires). Keep it comfortably below STACK_HISTORY_READ_BACKSTOP_BLOCKS so the backstop never
// clips the normally-retained tail.
// Exported so tests size their fixtures against it (KEEP + n) instead of hardcoding the number —
// hardcoded copies silently turn into "compression planned nothing" fixtures the next time this
// floor moves, which reads as a passing suite that stopped exercising compression at all.
export const HISTORY_COMPACT_KEEP = 80;
// REQ1: 压缩触发只看模型返回的真实 input_tokens(不是 tiktoken 估算)。
// 软线 500k(opus-4-6 真实窗口远在其上,留足余量);连续 N=2 轮真实 input
// 都 > 软线才触发,滤掉单轮尖峰(一次性大 tool result / 图片 burst)。
// 计数器只放内存 + 重启清零:重启后靠首轮真实测量重判,绝不对过期数字误压。
// COMPRESSION TRIGGER (REQ1): the working-context cap. When the model's REAL input_tokens exceed
// this for COMPRESSION_TRIGGER_CONSECUTIVE_TURNS consecutive turns, compress — keeping the last
// HISTORY_COMPACT_KEEP blocks (stack-native, planStackReadCutoffByBlockBudget) and folding the rest
// into the 近况 capsule. So this is the upper bound of 小腻's live context; she sawtooths up to it,
// then back down to the kept block tail. Lowering it tightens the context (and compresses more
// often = more STW switch cold-reads); it does NOT change the cacheable prefix bytes, only the
// timing of compression switches. Default 80k (was 150k). Now admin-configurable and
// dynamically applied at runtime (no restart) via setCompressionTriggerInputTokens, which
// modules/agent-service/src/index.ts pushes each main-loop poll from
// agent_runtime_control.compression_trigger_input_tokens — see that knob. This is timing
// logic ONLY; it never enters the cacheable request prefix, so changing it is cache-safe.
let COMPRESSION_TRIGGER_INPUT_TOKENS = 80_000;
// Runtime setter for the admin-configurable compression trigger threshold. Ignores
// non-finite / <= 0 so a malformed control row can't disarm compression entirely.
export function setCompressionTriggerInputTokens(value: number): void {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    COMPRESSION_TRIGGER_INPUT_TOKENS = Math.floor(value);
  }
}

// ── xiaoni_os request isolation (admin runtime toggle) ─────────────────────────
// 小腻 writes a private "OS" note (xiaoni_os) into her tool calls. Normally it round-trips
// back into her own context via the replayed function_call arguments (A1), the tool-result
// echo in function_call_output (A2), and — for recover_energy — the wake reminder that
// re-presents her pre-sleep note (B). This toggle lets ops run her WITHOUT feeding those notes
// back to the model, while the note stays fully persisted + admin-visible for operations.
// A1/A2 use the stamp+flag+wire-strip mechanism below. B is handled separately at wake-render
// time (renderRecoverEnergyCompletedReminder drops the note line), because the note there is
// fused into rendered prose rather than a discrete JSON field; the note still lives in
// agent_recovery_sessions + the recover_energy call args for ops.
//
// How it stays cache-safe (双缓存铁律):
//  1) The toggle is snapshotted ONCE per run. When on, os-bearing tool items produced this run
//     are STAMPED (in place) with `xiaoni_os_hidden: true`. Because the stamp lands on the shared
//     array reference, it is written into BOTH the live requestInput copy AND the persisted stack
//     content — the decision is frozen at production time and can never drift with later toggling.
//  2) The actual strip is applied BY FLAG at ONE wire chokepoint (buildMainAgentCanonicalRequest).
//     Every request — main loop and every fork clone — funnels through it, so all prefixes stay
//     byte-identical and the flag itself never reaches the wire.
//  3) History without the flag (produced before this feature, or while the toggle was off) keeps
//     its os verbatim on replay → "历史开了就是开了、关了就是关了；拨开关只管往后". Flipping the
//     toggle therefore rewrites NO history and costs no extra historical cold read.
// modules/agent-service/src/index.ts pushes this each main-loop poll from
// agent_runtime_control.strip_xiaoni_os_from_requests.
let STRIP_XIAONI_OS_FROM_REQUESTS = false;
export function setStripXiaoniOsFromRequests(value: unknown): void {
  if (typeof value === 'boolean') {
    STRIP_XIAONI_OS_FROM_REQUESTS = value;
  }
}

// 心理评估门控总开关(Step3 的行为翻转闸)。默认 OFF：不跑心理评估 fork、不打 text_admit → 等价于 Step2
// 的 fail-closed 全剥现状(行为零变化)。live 栈实测心理评估 fork 的 cache_read 与主 turn 同量级(铁律
// 相邻 slice 对账)后，再由运营从 agent_runtime_control 打开，让正向 assistant 文本开始进入下一次上下文。
// 与 debug-heartbeat / strip_xiaoni_os_from_requests 同套热下发。默认 OFF 也让冻结缓存回归用例无需改动即绿。
let PSYCH_ASSESSMENT_GATE_ENABLED = false;
export function setPsychAssessmentGateEnabled(value: unknown): void {
  if (typeof value === 'boolean') {
    PSYCH_ASSESSMENT_GATE_ENABLED = value;
  }
}

// 自驱动 fork 的空转升级总开关。默认 OFF：不计数、不渲染升级段 → fork 与主 agent 的请求体与改动前
// 逐字节一致(行为零变化，冻结缓存回归用例无需改断言即绿)。ON 之后，连续空转达阈值时，**只在 fork 的
// 尾部追加段**告诉潜意识「上一份 plan 已经连着 N 轮没被执行」并回贴那份 plan 的原文，由它自己决定
// 语气多硬。
//
// 边界(本特性的核心约束)：升级信号是 fork 的【私有输入】，**绝不进主 agent 上下文、绝不写 stack**。
// 往主上下文注入「你已经失败 N 次」本身就是负面状态注入，正是 text gate(:816)要挡的那一类；而且
// fork 请求带 no_persist，本就不参与主 run replay → 不存在「live 请求与 stack replay 不一致」这个
// 风险类别。与 debug-heartbeat / strip_xiaoni_os_from_requests / psych gate 同套热下发。
let FORK_IDLE_ESCALATION_ENABLED = false;
export function setForkIdleEscalationEnabled(value: unknown): void {
  if (typeof value === 'boolean') {
    FORK_IDLE_ESCALATION_ENABLED = value;
  }
}

// plan 空转 run 作废总开关(docs/specs/xiaoni-plan-run-void-on-idle.md)。默认 OFF:行为与今天
// 逐字节一致。ON 之后,subconscious plan 触发且**零产出**(纯文本收工、零工具、没折叠过真实外部
// notify、无压缩提交)的 run,settle 时整个 run 的栈行被删除——当这次请求没发生过。上下文因此
// 永远堆不出连续的失败 plan;失效轮数由升级腿(FORK_IDLE_ESCALATION_ENABLED)透传给 fork。
// 这是「消费后冻结」铁律经 user 拍板开出的唯一例外;判定任一不满足即照旧冻结(fail-open)。
let PLAN_VOID_ON_IDLE_ENABLED = false;
export function setPlanVoidOnIdleEnabled(value: unknown): void {
  if (typeof value === 'boolean') {
    PLAN_VOID_ON_IDLE_ENABLED = value;
  }
}
export function isPlanVoidOnIdleEnabledForTest(): boolean {
  return PLAN_VOID_ON_IDLE_ENABLED;
}

// 自驱动 fork 的 plan 改由 `xiaoni-plan post` skill 提交(docs/specs/xiaoni-plan-skill-submission.md)。
// 默认 OFF:行为与今天逐字节一致(从 final_answer 文本抠 <xiaoni_plan>)。ON 之后三件事一起生效,
// 因为它们描述的是【同一个事实】——「这一步只放行 xiaoni-plan」:
//   ① fork 的 allowedToolNames 放行 exec_command,命令层再白名单到 xiaoni-plan 一条;
//   ② fork 尾部 reminder 追加工具契约(fork-only,主 agent 永远看不到);
//   ③ 没交出去时的纠正提示改成「必须用 skill 交」而不是「写进 <xiaoni_plan>」。
// 分开挂开关会让 prompt 说的和执行层做的不一致 —— 那正是 fork 11905 烧掉两个 turn 撞墙的原因。
let IDLE_PLAN_SKILL_SUBMISSION_ENABLED = false;
export function setIdlePlanSkillSubmissionEnabled(value: unknown): void {
  if (typeof value === 'boolean') {
    IDLE_PLAN_SKILL_SUBMISSION_ENABLED = value;
  }
}
export function isIdlePlanSkillSubmissionEnabledForTest(): boolean {
  return IDLE_PLAN_SKILL_SUBMISSION_ENABLED;
}

// 作废判定(纯函数,loop 的 settle 分支调用)。全部满足才作废;任一不满足 = 照旧冻结(fail-open)。
export function shouldVoidIdlePlanRun(params: {
  queueBacked: boolean;
  settledOnFinalAnswer: boolean;
  runCalledAnyTool: boolean;
  deliveredCount: number;
  compressionCommitted: boolean;
  evictedTurnCount: number;
  triggerIsSubconsciousPlan: boolean;
  foldedAllSubconsciousPlans: boolean;
}): boolean {
  return PLAN_VOID_ON_IDLE_ENABLED
    && params.queueBacked
    && params.settledOnFinalAnswer
    && !params.runCalledAnyTool
    && params.deliveredCount === 0
    && !params.compressionCommitted
    && params.evictedTurnCount === 0
    && params.triggerIsSubconsciousPlan
    && params.foldedAllSubconsciousPlans;
}

function tryParseJsonObjectString(text: unknown): Record<string, unknown> | null {
  if (typeof text !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// True only for a tool item that actually carries an xiaoni_os key: function_call whose
// arguments JSON has it (A1), or function_call_output whose output is a JSON object with it (A2).
// A non-JSON output (e.g. the recover_energy wake reminder text — Path B, out of scope) never
// matches, so it is never stamped nor stripped.
export function itemCarriesXiaoniOs(item: OpenResponseInputItem): boolean {
  if (item.type === 'function_call') {
    const args = tryParseJsonObjectString((item as { arguments?: unknown }).arguments);
    return Boolean(args && Object.prototype.hasOwnProperty.call(args, 'xiaoni_os'));
  }
  if (item.type === 'function_call_output') {
    const output = tryParseJsonObjectString((item as { output?: unknown }).output);
    return Boolean(output && Object.prototype.hasOwnProperty.call(output, 'xiaoni_os'));
  }
  return false;
}

// Freeze the toggle decision into the items at production time. Mutates in place so the same
// stamp lands on both the live requestInput copy and the persisted stack content (they share refs).
export function stampXiaoniOsHiddenInPlace(items: OpenResponseInputItem[], hidden: boolean): void {
  if (!hidden) {
    return;
  }
  for (const item of items) {
    if (itemCarriesXiaoniOs(item)) {
      (item as Record<string, unknown>).xiaoni_os_hidden = true;
    }
  }
}

// Wire-side strip, applied by flag inside buildMainAgentCanonicalRequest. Pure + idempotent +
// deterministic: a flagged item gets its xiaoni_os key deleted and the flag removed; an unflagged
// item is returned by reference untouched (so toggle-OFF builds are byte-identical to before).
export function stripXiaoniOsByFlag(item: OpenResponseInputItem): OpenResponseInputItem {
  if (!item || (item as Record<string, unknown>).xiaoni_os_hidden !== true) {
    return item;
  }
  const next: Record<string, unknown> = { ...(item as Record<string, unknown>) };
  delete next.xiaoni_os_hidden;
  if (item.type === 'function_call') {
    const args = tryParseJsonObjectString((item as { arguments?: unknown }).arguments);
    if (args && Object.prototype.hasOwnProperty.call(args, 'xiaoni_os')) {
      delete args.xiaoni_os;
      next.arguments = JSON.stringify(args);
    }
  } else if (item.type === 'function_call_output') {
    const output = tryParseJsonObjectString((item as { output?: unknown }).output);
    if (output && Object.prototype.hasOwnProperty.call(output, 'xiaoni_os')) {
      delete output.xiaoni_os;
      next.output = JSON.stringify(output);
    }
  }
  return next as OpenResponseInputItem;
}

// ── text_admit gate (assistant type:text → 上下文准入，替代无条件全剥) ───────────────────────────
// 背景：历史上 buildInitialInput 无条件把所有 assistant 文本(D，含 inline <xiaoni_os>)从每次 replay
// 剥掉，防止「摸鱼/等待」叙述自我强化。现在 xiaoni_os 迁到 assistant type:text 通道，改为【按 stamp 选择
// 性准入】：一条 assistant-role TEXT replay item 只有携带冻结的 `text_admit === true` 才留在 replay 里；
// 无 stamp(历史 / 消极判定 / fork 失败) → 照旧剥掉。
//
// 缓存安全(双缓存铁律)——与 xiaoni_os_hidden 同款「生产期冻结 stamp + 出线口按 flag scrub」:
//  1) 判定(LLM 非确定)只算一次，`stampTextAdmitInPlace` 就地写进共享 ref(live requestInput + 持久化
//     stack content 同时拿到)，此后任何 build(主 loop / heartbeat / 每个 fork clone / 下一 run replay)
//     都读同一冻结 stamp，绝不重算 → run 边界不穿透。
//  2) `text_admit` 是内部 flag，出线口(buildMainAgentCanonicalRequest 的 wireInput.map)统一 scrub 掉，
//     永不进 wire 字节；被准入的文本本体保留、flag 不进前缀。
//  3) 无 stamp = 默认剥(fail-closed)。历史文本天然无 stamp → 保持被剥，翻新行为不回溯纳入旧文本 →
//     run 边界不因回溯而冷读。Step 2 尚无任何 stamp 来源，故此门等价于「全剥」现状，零行为变化。
//
// polarity 说明：与 stampXiaoniOsHiddenInPlace 同构——都只给「非默认」决定打 stamp。那边默认=show、
// stamp=hide；这边默认=strip、stamp=keep。

// 只有携带冻结 text_admit 的 assistant-role 文本才算被准入进 replay。
export function isAssistantTextAdmittedToReplay(item: OpenResponseInputItem | undefined): boolean {
  return isAssistantTextOutputReplayItem(item)
    && (item as Record<string, unknown>).text_admit === true;
}

// replay 过滤用的「该剥」判定：只剥【未被准入的 assistant-role 文本】，其它(工具调用/输出/非文本)一律保留。
export function isReplayItemStrippedByTextGate(item: OpenResponseInputItem | undefined): boolean {
  return isAssistantTextOutputReplayItem(item) && !isAssistantTextAdmittedToReplay(item);
}

// 生产期冻结准入决定：admit=true 时给该 turn 的 assistant-role 文本就地打 text_admit(落共享 ref)。
// admit=false(消极/无判定)不打 stamp → 默认剥(fail-closed)。就地 mutate，保证 live 与持久化 stack 一致。
export function stampTextAdmitInPlace(items: OpenResponseInputItem[], admit: boolean): void {
  if (!admit) {
    return;
  }
  for (const item of items) {
    if (isAssistantTextOutputReplayItem(item)) {
      (item as Record<string, unknown>).text_admit = true;
    }
  }
}

// 出线口 scrub：被准入的文本本体保留，但内部 flag text_admit 绝不进 wire。纯 + 幂等 + 确定：带 flag 的
// item 返回删了 flag 的副本；不带 flag 的 item 原 ref 返回(无 stamp 的 build 与改动前逐字节一致)。
export function stripTextAdmitFlagForWire(item: OpenResponseInputItem): OpenResponseInputItem {
  if (!item || (item as Record<string, unknown>).text_admit !== true) {
    return item;
  }
  const next: Record<string, unknown> = { ...(item as Record<string, unknown>) };
  delete next.text_admit;
  return next as OpenResponseInputItem;
}

const COMPRESSION_TRIGGER_CONSECUTIVE_TURNS = 2;
// EMERGENCY HALT VALVE: when real input_tokens run this far PAST the compression trigger for
// COMPRESSION_OVERRUN_HALT_CONSECUTIVE_TURNS consecutive turns, compression has demonstrably failed to
// bring the epoch back down (it already fired at the trigger). That is a genuinely stalled/failed
// compression — independent of the removed read-window LIMIT — so instead of climbing toward the model's
// hard context ceiling we halt the run switch and keep the cache heartbeat warm for a clean manual
// resume (see haltRuntimeForCompressionOverrun). The margin sits above compression's async commit
// latency so a legitimately-mid-compression turn can't trip it. This is timing/ops logic only; it never
// enters the cacheable request prefix.
//
// SIZED AGAINST FORK DURATION — must move whenever the fork turn budget moves. Measured 2026-07-30:
//   main-loop accumulation during a compression window: 6,559 tok/min
//     (llm_request_slices, 2026-07-28 09:00-10:09, 196 turns, ctx 52,961 -> 504,725)
//   fork wall time: mean 17.7 s/turn (core_memory_compression_fork_slices, 12 forks / 138 turns)
// At the old 22-turn cap the fork ran ~6.5 min and burned ~43k of the old 100k margin — comfortable.
// At the 50-turn cap it runs up to ~14.8 min and would burn ~97k, i.e. sit exactly on the old halt
// line: a busy epoch would halt the runtime mid-compression. 250k keeps the same ~2.3x headroom
// ratio the 22/100k pair had (≈38 min at the measured rate).
const COMPRESSION_OVERRUN_MARGIN_TOKENS = 250_000;
const COMPRESSION_OVERRUN_HALT_CONSECUTIVE_TURNS = 2;
const consecutiveOverCompressionThresholdBySession = new Map<string, number>();
const consecutiveOverOverrunThresholdBySession = new Map<string, number>();

// ── 连续空转计数：主 agent 连着多少轮没执行 xiaoni_plan ────────────────────────────────────────
// 度量的是「上一份 plan 失效了几轮」，只喂给自驱动 fork(见 FORK_IDLE_ESCALATION_ENABLED)。
// 第 1 轮空转仍走原文，给她自主机会；连续 >= 阈值才升级。
const IDLE_ESCALATION_AFTER_ROUNDS = 2;
const consecutiveIdlePlanFailuresBySession = new Map<string, number>();
// 上一份真正发出去的 plan 原文(已剥 <xiaoni_plan> 包装)，升级时原样回贴给 fork 看。
const lastEmittedSubconsciousPlanBySession = new Map<string, string>();

export function getConsecutiveIdlePlanFailures(sessionKey: string): number {
  return consecutiveIdlePlanFailuresBySession.get(sessionKey) ?? 0;
}

export function resetConsecutiveIdlePlanFailures(sessionKey: string): void {
  if (!sessionKey) {
    return;
  }
  consecutiveIdlePlanFailuresBySession.set(sessionKey, 0);
}

// 一次 settle 的记账。didRealWork = 该 run 存在有效产出:任一非 recover_energy 的工具调用,
// 或 recover_energy 被身体【接受】(真睡着了/立即恢复)。归零只有「有效产出」这一种场景
// (user 拍板 2026-07-27):被外部消息唤醒本身不算——她真要响应必然调工具走同一条路;
// recover_energy 被身体【拒绝】(rest_rejected,睡不着)也不算——发起了但没睡成,等于没动。
export function recordIdlePlanSettle(
  sessionKey: string,
  params: { settledOnFinalAnswer: boolean; didRealWork: boolean }
): void {
  if (!sessionKey) {
    return;
  }
  if (params.didRealWork) {
    consecutiveIdlePlanFailuresBySession.set(sessionKey, 0);
    return;
  }
  if (!params.settledOnFinalAnswer) {
    return;
  }
  consecutiveIdlePlanFailuresBySession.set(
    sessionKey,
    (consecutiveIdlePlanFailuresBySession.get(sessionKey) ?? 0) + 1
  );
}

export function setLastEmittedSubconsciousPlan(sessionKey: string, text: unknown): void {
  if (!sessionKey || typeof text !== 'string') {
    return;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  lastEmittedSubconsciousPlanBySession.set(sessionKey, trimmed);
}

export function getLastEmittedSubconsciousPlan(sessionKey: string): string | null {
  return lastEmittedSubconsciousPlanBySession.get(sessionKey) ?? null;
}

// 升级只在【开关 ON】+【连续空转达阈值】+【手上有上一份 plan 原文】三者同时成立时发生。
// 缺任何一个(含重启后 lastPlan 为空)都退回普通分支，不渲染半截升级段。
export function shouldEscalateSubconsciousFork(params: {
  idleRounds: number;
  lastPlanText: string | null;
}): boolean {
  return FORK_IDLE_ESCALATION_ENABLED
    && params.idleRounds >= IDLE_ESCALATION_AFTER_ROUNDS
    && Boolean(params.lastPlanText);
}
function recordMainTurnInputTokensForCompression(sessionKey: string, actualInputTokens: number | null): void {
  if (!sessionKey) {
    return;
  }
  const over = typeof actualInputTokens === 'number'
    && Number.isFinite(actualInputTokens)
    && actualInputTokens > COMPRESSION_TRIGGER_INPUT_TOKENS;
  if (over) {
    // cap at the threshold — once armed, more over-line turns add nothing, and an
    // uncapped counter would drift upward whenever compression can't yet schedule
    // (e.g. history still <= keep window) without a sub-threshold turn to reset it.
    consecutiveOverCompressionThresholdBySession.set(
      sessionKey,
      Math.min(
        COMPRESSION_TRIGGER_CONSECUTIVE_TURNS,
        (consecutiveOverCompressionThresholdBySession.get(sessionKey) ?? 0) + 1
      )
    );
  } else if (typeof actualInputTokens === 'number' && Number.isFinite(actualInputTokens)) {
    // a real measurement at/under the soft line resets the debounce
    consecutiveOverCompressionThresholdBySession.set(sessionKey, 0);
  }
  // Parallel debounce for the emergency halt valve: input past (trigger + margin) means compression
  // already fired at the trigger and did NOT bring the epoch down.
  const overOverrun = typeof actualInputTokens === 'number'
    && Number.isFinite(actualInputTokens)
    && actualInputTokens > COMPRESSION_TRIGGER_INPUT_TOKENS + COMPRESSION_OVERRUN_MARGIN_TOKENS;
  if (overOverrun) {
    consecutiveOverOverrunThresholdBySession.set(
      sessionKey,
      Math.min(
        COMPRESSION_OVERRUN_HALT_CONSECUTIVE_TURNS,
        (consecutiveOverOverrunThresholdBySession.get(sessionKey) ?? 0) + 1
      )
    );
  } else if (typeof actualInputTokens === 'number' && Number.isFinite(actualInputTokens)) {
    consecutiveOverOverrunThresholdBySession.set(sessionKey, 0);
  }
}
function shouldTriggerCompressionFromRealInput(sessionKey: string): boolean {
  return (consecutiveOverCompressionThresholdBySession.get(sessionKey) ?? 0) >= COMPRESSION_TRIGGER_CONSECUTIVE_TURNS;
}
function shouldHaltForCompressionOverrun(sessionKey: string): boolean {
  return (consecutiveOverOverrunThresholdBySession.get(sessionKey) ?? 0) >= COMPRESSION_OVERRUN_HALT_CONSECUTIVE_TURNS;
}
function resetCompressionOverrunCounter(sessionKey: string): void {
  consecutiveOverOverrunThresholdBySession.set(sessionKey, 0);
}
// ── BYTE-side compression trigger (mirrors the token side above) ─────────────────────────────
// Images are token-cheap but byte-huge, so the token trigger above is BLIND to image-heavy runs:
// real input_tokens stay under the soft line while the wire request BYTES climb toward Anthropic's
// hard 32MB per-request cap → 413 request_too_large, retryScheduled:false, the run dies. A parallel
// byte-side trigger closes that blind spot:
//   · SOFT line = COMPRESSION_TRIGGER_WIRE_BYTES (admin-configurable, default 24 MiB): for
//     COMPRESSION_WIRE_TRIGGER_CONSECUTIVE_TURNS consecutive turns the assembly-time estimated wire
//     bytes exceed it → run-boundary compression fires too (OR'd with the token soft line at 8619),
//     folding old images out of the read window.
//   · HARD line = soft + COMPRESSION_OVERRUN_MARGIN_BYTES (default 30 MiB): the moment a turn's
//     assembly-time estimate exceeds it, HALT the run switch BEFORE sending (this request would 413),
//     keep the cache heartbeat warm, and leave it for a human — reason 'wire_bytes_overrun'. Unlike
//     the token overrun valve (which reads turn-AFTER real input_tokens), this MUST fire pre-send:
//     the byte wall is hard and a single image burst can cross it within one run's tool turns.
// Metric = JSON byte length of the assembled canonical request (base64 images dominate; ASCII, so
// length ≈ UTF-8 bytes), scaled by a calibration factor learned from the prior turn's real wire size
// (T6). Timing/ops logic ONLY — it NEVER enters the cacheable request prefix, so it is cache-safe.
let COMPRESSION_TRIGGER_WIRE_BYTES = 25_165_824; // 24 MiB soft line
// Runtime setter for the admin-configurable byte trigger. Ignores non-finite / <= 0 so a malformed
// control row can't disarm the byte guard entirely. Mirrors setCompressionTriggerInputTokens.
export function setCompressionTriggerWireBytes(value: number): void {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    COMPRESSION_TRIGGER_WIRE_BYTES = Math.floor(value);
  }
}
// Hard-line margin above the soft line: how many bytes past soft counts as "compression didn't bring
// it down / single-turn blowup", halt now. 24 MiB soft + 6 MiB margin = 30 MiB hard, leaving ~2 MiB
// to the 32MB wall for this turn's own estimate error.
const COMPRESSION_OVERRUN_MARGIN_BYTES = 6_291_456; // 6 MiB
const COMPRESSION_WIRE_TRIGGER_CONSECUTIVE_TURNS = 2;
// Calibration factor: real wire bytes / assembly estimate, clamped to [0.5, 2.0] so an anomalous
// slice can't poison the estimator. Default 1.0 (uncalibrated). Fed by the prior turn's real wire
// size (T6). Also NEVER enters the prefix — pure timing math.
let compressionWireBytesCalibrationFactor = 1.0;
export function setCompressionWireBytesCalibrationFactor(factor: number): void {
  if (typeof factor === 'number' && Number.isFinite(factor) && factor > 0) {
    compressionWireBytesCalibrationFactor = Math.min(2.0, Math.max(0.5, factor));
  }
}
const consecutiveOverWireTriggerBySession = new Map<string, number>();
// Assembly-time wire-byte estimate for a fully-built canonical request. JSON.stringify byte length ≈
// the provider wire body (base64 images dominate and are ASCII, so .length ≈ UTF-8 bytes), scaled by
// the calibration factor to correct the canonical→provider-wire transform bias. Returns 0 on any
// serialization failure so a bad request can never falsely trip the halt.
export function estimateCanonicalRequestWireBytes(canonicalRequest: unknown): number {
  let raw = 0;
  try {
    // Project the canonical onto what actually goes on the wire before measuring: an
    // input_image that carries a Files API `file_id` is sent as a ~60-byte file reference,
    // NOT its base64 image_url (which the canonical keeps as the durable fallback — double
    // store). Counting the base64 here would let the hard HALT false-positive on a request
    // whose real wire is tiny and wrongly stall the loop. The replacer drops image_url/source
    // from any file_id-bearing input_image so the estimate tracks the real wire body.
    raw = JSON.stringify(canonicalRequest, (_key, value) => {
      if (
        value && typeof value === 'object' && !Array.isArray(value)
        && (value as { type?: unknown }).type === 'input_image'
        && typeof (value as { anthropic_file_id?: unknown }).anthropic_file_id === 'string'
        && (value as { anthropic_file_id: string }).anthropic_file_id.length > 0
      ) {
        const v = value as { anthropic_file_id: string; detail?: unknown };
        return { type: 'input_image', anthropic_file_id: v.anthropic_file_id, detail: v.detail };
      }
      return value;
    })?.length ?? 0;
  } catch {
    raw = 0;
  }
  return Math.round(raw * compressionWireBytesCalibrationFactor);
}
// Record this turn's assembly-time estimate (pre-send) into the soft-line debounce. Mirrors the token
// recorder: consecutive over-soft turns arm the run-boundary compression; a turn at/under soft resets.
function recordMainTurnWireBytesForCompression(sessionKey: string, estimatedWireBytes: number): void {
  if (!sessionKey || !Number.isFinite(estimatedWireBytes)) {
    return;
  }
  if (estimatedWireBytes > COMPRESSION_TRIGGER_WIRE_BYTES) {
    consecutiveOverWireTriggerBySession.set(
      sessionKey,
      Math.min(
        COMPRESSION_WIRE_TRIGGER_CONSECUTIVE_TURNS,
        (consecutiveOverWireTriggerBySession.get(sessionKey) ?? 0) + 1
      )
    );
  } else {
    consecutiveOverWireTriggerBySession.set(sessionKey, 0);
  }
}
export function shouldTriggerCompressionFromWireBytes(sessionKey: string): boolean {
  return (consecutiveOverWireTriggerBySession.get(sessionKey) ?? 0) >= COMPRESSION_WIRE_TRIGGER_CONSECUTIVE_TURNS;
}
function resetCompressionWireTriggerCounter(sessionKey: string): void {
  consecutiveOverWireTriggerBySession.set(sessionKey, 0);
}
// Hard line: a single assembly-time estimate past (soft + margin) trips the pre-send halt. No
// consecutive-turn debounce here — the byte wall is hard, so one over-hard turn halts immediately.
export function isWireBytesOverrun(estimatedWireBytes: number): boolean {
  return Number.isFinite(estimatedWireBytes)
    && estimatedWireBytes > COMPRESSION_TRIGGER_WIRE_BYTES + COMPRESSION_OVERRUN_MARGIN_BYTES;
}
// test-only seam: seed the in-memory byte-trigger debounce so an integration test can arm the
// run-boundary byte trigger without assembling two real >24MiB turns. Not used in production.
export function __setCompressionWireTriggerCounterForTest(sessionKey: string, count: number): void {
  consecutiveOverWireTriggerBySession.set(sessionKey, count);
}
// T8: at-ingest image slimming. computer-use screenshots are lossless PNG (1024×506, ~0.8-1.4MB) —
// token-cheap but byte-huge, the main fuel for the 32MB wall. Transcode to LOSSLESS WebP before the
// image enters the stack (same resolution, zero pixel loss, ~20-40% smaller on screenshot-type
// content). The webp data_url goes straight into stack content, so replay reads back the exact webp
// bytes — byte-identical, zero cache drift (unlike a decode-time transcode, whose output could shift
// with cwebp versions and bust the prefix). The archived saved_path stays the original PNG. cwebp is
// deterministic; on any failure / non-PNG-JPEG / no-shrink we keep the original data_url and never
// block the tool.
const INPUT_IMAGE_DATA_URL_RE = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=\s]+)$/;
export async function transcodeInputImageItemsToWebpLossless(
  items: OpenResponseInputItem[]
): Promise<OpenResponseInputItem[]> {
  return Promise.all(items.map(async (item) => {
    const rec = item as Record<string, unknown>;
    if (!rec || rec.type !== 'input_image' || typeof rec.image_url !== 'string') {
      return item;
    }
    const match = INPUT_IMAGE_DATA_URL_RE.exec(rec.image_url);
    if (!match) {
      return item;
    }
    try {
      const input = Buffer.from(match[2], 'base64');
      const webp = await defaultCwebpEncoder(input, 'lossless');
      if (!webp || webp.length === 0 || webp.length >= input.length) {
        return item; // encoder unavailable, or lossless didn't shrink — keep the original
      }
      return { ...rec, image_url: `data:image/webp;base64,${webp.toString('base64')}` } as unknown as OpenResponseInputItem;
    } catch {
      return item; // cwebp missing / timeout — keep the original, never block the tool
    }
  }));
}
// T9: at-ingest image externalization. Runs RIGHT AFTER the webp transcode and BEFORE the image
// enters the durable stack. For each input_image data URL, ask provider-service to upload it to the
// Anthropic Files API and stamp the returned file_id onto the item as `anthropic_file_id` (keeping
// image_url as the durable base64 fallback — double store). The wire builder (anthropic-translate
// partsToBlocks) then emits a ~60-byte {type:'file',file_id} block instead of the base64 — the fix
// for the 32MB request cap. Because the file_id is frozen into the canonical here (before first send)
// and persisted with the stack item, the live build, the stack replay, and every fork clone all
// reconstruct the SAME file source byte-for-byte → zero prompt-cache drift (same invariant the webp
// pass relies on). Degrade is graceful: on disabled / below-threshold / upload failure the item is
// returned unchanged (base64 only), a one-time persisted decision — NEVER a per-request retry, which
// would make the wire non-deterministic across replay and punch the cache. Never blocks the tool.
export async function externalizeInputImageItemsToAnthropicFile(
  items: OpenResponseInputItem[]
): Promise<OpenResponseInputItem[]> {
  if (process.env.ANTHROPIC_FILES_API_UPLOAD_ENABLED === 'false') {
    return items;
  }
  return Promise.all(items.map(async (item) => {
    const rec = item as Record<string, unknown>;
    if (!rec || rec.type !== 'input_image' || typeof rec.image_url !== 'string') {
      return item;
    }
    // Already externalized (e.g. re-normalized) — leave the frozen file_id in place.
    if (typeof rec.anthropic_file_id === 'string' && rec.anthropic_file_id) {
      return item;
    }
    if (!rec.image_url.startsWith('data:image/')) {
      return item;
    }
    try {
      const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/media/upload-anthropic-file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [NO_TRAFFIC_PERSIST_HEADER]: '1'
        },
        body: JSON.stringify({ data_url: rec.image_url })
      });
      if (!response.ok) {
        return item; // degrade → keep base64
      }
      const payload = await response.json() as { data?: { file_id?: unknown } };
      const fileId = typeof payload?.data?.file_id === 'string' && payload.data.file_id.trim()
        ? payload.data.file_id.trim()
        : null;
      if (!fileId) {
        return item; // below threshold / disabled / upload degraded → keep base64
      }
      return { ...rec, anthropic_file_id: fileId } as unknown as OpenResponseInputItem;
    } catch {
      return item; // provider-service unreachable → keep base64, never block the tool
    }
  }));
}
// Current in-memory debounce count for a session (0 when unseen). Read by the
// fire-and-forget persistence write and by the restart re-hydration seed check.
function getCompressionTriggerCounter(sessionKey: string): number {
  return consecutiveOverCompressionThresholdBySession.get(sessionKey) ?? 0;
}
function resetCompressionTriggerCounter(sessionKey: string): void {
  consecutiveOverCompressionThresholdBySession.set(sessionKey, 0);
}
// Single setter for the in-memory Map. Used by the restart re-hydration seed and by the
// test seam below. Production turn-by-turn updates go through
// recordMainTurnInputTokensForCompression / resetCompressionTriggerCounter, which mutate
// the same Map.
function setCompressionTriggerCounter(sessionKey: string, count: number): void {
  consecutiveOverCompressionThresholdBySession.set(sessionKey, count);
}
function hasCompressionTriggerCounter(sessionKey: string): boolean {
  return consecutiveOverCompressionThresholdBySession.has(sessionKey);
}
// test-only seam: seed the in-memory compression-trigger debounce counter so an
// integration test can deterministically arm the auto trigger without sending two
// real >500k turns. Not used in production.
export function __setCompressionTriggerCounterForTest(sessionKey: string, count: number): void {
  setCompressionTriggerCounter(sessionKey, count);
}
// test-only seam: clear the in-memory Map entry to simulate a fresh process (restart)
// so a test can prove the re-hydration path seeds from persisted state.
export function __clearCompressionTriggerCounterForTest(sessionKey: string): void {
  consecutiveOverCompressionThresholdBySession.delete(sessionKey);
}
const FEEDBACK_MEMORY_SUBAGENT_TYPE = 'feedback_memory_writer';
const CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE = 'context_compression_memory_writer';
const CONTEXT_COMPRESSION_MEMORY_WRITER_ENABLED = false;
const COMPACT_MEMORY_PROVIDER_MAX_ATTEMPTS = 3;
export const XIAONI_IDENTITY_KEY = 'xiaoni';
const RUNTIME_IDENTITY_FACT_LIMIT = 4;
const XIAONI_SKILL_ROOT = '/app/modules/agent-service/skills';
const RUNTIME_MAX_ENERGY = 1;

function buildRuntimeBootstrapPromptPayload(): QueueMessageRecord['payload'] {
  const receivedAt = new Date().toISOString();
  const botAccountId = agentConfig.botAccountId;
  const globalPromptContextSessionKey = getGlobalPromptContextSessionKey();
  const inboundContext: QueueMessageRecord['payload']['inboundContext'] = {
    Body: '',
    BodyForAgent: '',
    BodyForCommands: '',
    RawBody: '',
    CommandBody: '',
    From: botAccountId,
    To: botAccountId,
    SessionKey: globalPromptContextSessionKey,
    AccountId: botAccountId,
    ChatType: 'direct',
    ConversationLabel: XIAONI_IDENTITY_KEY,
    SenderName: XIAONI_IDENTITY_KEY,
    SenderId: botAccountId,
    Timestamp: Date.now(),
    Provider: 'runtime',
    Surface: 'runtime_bootstrap',
    WasMentioned: false,
    NativeChannelId: globalPromptContextSessionKey,
    CommandAuthorized: false
  };

  return {
    traceId: 'runtime_bootstrap',
    runId: 'runtime_bootstrap',
    batchId: 'runtime_bootstrap',
    source: 'runtime_bootstrap',
    chatType: 'direct',
    sessionKey: globalPromptContextSessionKey,
    peerId: XIAONI_IDENTITY_KEY,
    peerName: XIAONI_IDENTITY_KEY,
    senderId: botAccountId,
    senderName: XIAONI_IDENTITY_KEY,
    accountId: botAccountId,
    bodyForAgent: '',
    rawBody: '',
    commandBody: '',
    wasMentioned: false,
    receivedAt,
    messageTimestamp: null,
    rawPayload: {
      source: 'runtime_bootstrap'
    },
    inboundContext,
    messages: []
  };
}

function buildRuntimeLoopFrameQueueMessage(): QueueMessageRecord {
  const now = new Date();
  const id = uuidv4().slice(0, 8);
  const frameId = `runtime_${now.getTime()}_${id}`;
  const bootstrapPayload = buildRuntimeBootstrapPromptPayload();
  const payload: QueueMessageRecord['payload'] = {
    ...bootstrapPayload,
    traceId: `runtrace_${frameId}`,
    runId: frameId,
    batchId: `runtime_batch_${now.getTime()}_${id}`,
    source: 'runtime_loop',
    receivedAt: now.toISOString(),
    rawPayload: {
      source: 'runtime_loop'
    },
    inboundContext: {
      ...bootstrapPayload.inboundContext,
      Timestamp: now.getTime(),
      Surface: 'runtime_loop'
    }
  };

  return {
    id: frameId,
    traceId: payload.traceId,
    batchId: payload.batchId,
    status: 'processing',
    attempts: 0,
    createdAt: now.toISOString(),
    queueMessageIds: [],
    payload
  };
}

function normalizeRuntimeFrameOptions(options: ProcessRuntimeFrameOptions = {}): {
  queueBacked: boolean;
  triggerInputMode: RuntimeTriggerInputMode;
  appendRuntimeInputStackItem: boolean;
  logQueueLifecycle: boolean;
  initialLoopContinuation: OpenResponseInputItem[];
  initialLoopContinuationBeforeCurrentTrigger: boolean;
  recoveryWakeCountStartQueueMessageId?: number | null;
} {
  const queueBacked = options.queueBacked !== false;
  return {
    queueBacked,
    triggerInputMode: options.triggerInputMode ?? (queueBacked ? 'fresh_trigger' : 'suppress_current_trigger'),
    appendRuntimeInputStackItem: options.appendRuntimeInputStackItem ?? queueBacked,
    logQueueLifecycle: options.logQueueLifecycle ?? queueBacked,
    initialLoopContinuation: options.initialLoopContinuation ?? [],
    initialLoopContinuationBeforeCurrentTrigger: options.initialLoopContinuationBeforeCurrentTrigger ?? false,
    recoveryWakeCountStartQueueMessageId: options.recoveryWakeCountStartQueueMessageId
  };
}

const TOOL_NAMES = {
  unreadMeaning: 'emit_unread_meaning',
  inspectImage: 'inspect_image_placeholder',
  imageTask: 'request_image_task',
  feedbackReflection: 'synthesize_feedback_reflection',
  feedbackLearningState: 'update_learning_state',
  execCommand: 'exec_command',
  readFile: 'read_file',
  privateReply: 'send_in_private',
  groupReply: 'send_in_group',
  recoverEnergy: 'recover_energy',
  compressCoreMemory: 'compress_core_memory',
  // Custom web search (client-executed in agent-service → Tavily/SearXNG, never
  // through the Anthropic cloak). Restores the web_search name as a function tool.
  webSearch: 'web_search',
  // Anthropic computer-use tool; Claude returns a tool_use named "computer".
  computerUse: 'computer'
} as const;

const RUNTIME_TOOL_COSTS: Record<string, number> = {
  [TOOL_NAMES.groupReply]: 0.015,
  [TOOL_NAMES.privateReply]: 0.015,
  [TOOL_NAMES.inspectImage]: 0.040,
  [TOOL_NAMES.imageTask]: 0.030,
  [TOOL_NAMES.execCommand]: 0.002,
  [TOOL_NAMES.readFile]: 0.001,
  [TOOL_NAMES.recoverEnergy]: 0.000,
  [TOOL_NAMES.compressCoreMemory]: 0.020,
  [TOOL_NAMES.webSearch]: 0.030,
  [TOOL_NAMES.computerUse]: 0.004
};

// Computer use declares a FIXED display surface. This must stay byte-constant
// across every request (it is part of the cached tools prefix) — never set it to
// the live window size, or the prefix changes on each resize. The bridge always
// resizes screenshots to exactly this and maps action coordinates from this space
// back to the live host-Chrome CSS viewport (see computer_coords.py).
// Sized to match Xiaoni's actual Chrome viewport aspect (~2.03:1, native
// 2561x1263 @ DPR2) so the downscale has no anamorphic distortion, and kept well
// under Anthropic's ~1280 long-edge guidance to cut per-frame image tokens
// (~691 vs ~1366 at 1280x800 — every computer action returns a screenshot, and
// scroll-to-read is the dominant frame source). Source is 2561px wide, so this is
// a clean LANCZOS downscale, never an upscale; CJK stays legible (verified).
const COMPUTER_USE_DISPLAY_WIDTH = 1024;
const COMPUTER_USE_DISPLAY_HEIGHT = 506;

const COMPUTER_USE_TOOL: OpenResponseToolDefinition = {
  type: 'computer_use',
  display_width_px: COMPUTER_USE_DISPLAY_WIDTH,
  display_height_px: COMPUTER_USE_DISPLAY_HEIGHT,
  enable_zoom: true
};

const WEB_SEARCH_DESCRIPTION = [
  'Search the live web. Returns ranked results (title, url, content) as a windowed view.',
  'Default source "tavily" returns cleaned page text; "searxng" is a self-hosted metasearch with snippets only.',
  'Large result sets are saved to a file under /xiaoni-runtime/web-search/ — the result shows the path, total pages, and a result_ref.',
  'To read more, call again with the same result_ref and page=2 (no new search is run), or grep/cat the file with exec_command.'
].join(' ');

const WEB_SEARCH_TOOL: OpenResponseToolDefinition = {
  type: 'function',
  name: TOOL_NAMES.webSearch,
  description: WEB_SEARCH_DESCRIPTION,
  strict: false,
  function: {
    name: TOOL_NAMES.webSearch,
    description: WEB_SEARCH_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query.'
        },
        source: {
          type: 'string',
          enum: ['tavily', 'searxng'],
          description: 'Search backend. Defaults to tavily (returns page content). Use searxng for open-source metasearch breadth.'
        },
        page: {
          type: 'number',
          description: 'Page of a prior search to read (use with result_ref). Defaults to 1.'
        },
        result_ref: {
          type: 'string',
          description: 'Reference returned by a prior web_search call. Pass it with page>=2 to read more WITHOUT running a new search.'
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to fetch on a fresh search.'
        }
      },
      required: ['query'],
      additionalProperties: false
    }
  }
};

const IMAGE_GENERATION_TOOL: OpenResponseToolDefinition = {
  type: 'image_generation',
  model: 'gpt-image-2',
  output_format: 'png',
  size: 'auto',
  quality: 'auto',
  background: 'auto'
};

const MEDIA_ASSET_ID_PATTERN = /^media_[a-zA-Z0-9_-]+$/;
const NO_TRAFFIC_PERSIST_HEADER = 'x-qqbot-no-traffic-persist';
// Spec B: hard cap on total fork turns. A model that keeps calling exec_command without ever
// writing the 近况 file would loop forever without this bound.
// Escalation thresholds for the compression fork's tone toward the model:
//   < FORCE_TURNS         → let her work (silent on tool turns, soft self-check on text-only turns).
//   >= FORCE_TURNS        → she's used up her organizing budget: switch to a FORCED "stop everything
//                            and use the skill NOW" instruction, every turn, until she complies.
//   >= HARD_CAP_TURNS     → absolute last resort: only if she ignores the forced demand for the whole
//                            grace window do we auto-commit the deterministic minimal seam summary,
//                            purely so the cutoff always advances and context can't grow → 413.
//
// Raised 18/22 -> 45/50 on 2026-07-30. The atomic write skill (memory_write.py, 9ebe7701) turns one
// batched shell write into N single-purpose calls, and she has never emitted more than one tool call
// per turn (fork_turn_count == fork_tool_call_count on 297/297 recorded forks), so turn count tracks
// write-operation count 1:1. Replaying the last 12 real compressions with their shell writes decomposed
// into atomic calls projects 16-47 turns (median amplification 3.4x); 5 of 12 already breach the old
// 22 cap. 50 clears the whole measured set; 45 keeps the forced zone a real last-ditch push rather than
// a 32-turn nag. NOTE: COMPRESSION_OVERRUN_MARGIN_TOKENS is sized against fork wall time and was moved
// in the same commit — these two must always move together.
const CORE_MEMORY_COMPRESSION_FORK_FORCE_TURNS = 45;
const CORE_MEMORY_COMPRESSION_FORK_HARD_CAP_TURNS = 50;
const SUBCONSCIOUS_AGENT_FORK_MAX_TOOL_CALLS = 5;
const SUBCONSCIOUS_AGENT_FORK_MAX_MODEL_SLICES = SUBCONSCIOUS_AGENT_FORK_MAX_TOOL_CALLS + 1;
const CACHE_HEARTBEAT_EXECUTION_MODE = 'cache_heartbeat_no_persist';
const CACHE_HEARTBEAT_DEVELOPER_CONTENT = [
  'Heartbeat.',
  'Cache maintenance only; do not call tools.',
  'Return exactly: 1'
].join(' ');

const EXEC_COMMAND_DESCRIPTION = [
  'Runs a command in a PTY, returning output or a session ID for ongoing interaction.',
  'Use /app as the filesystem root for repository paths.',
  'To read a file, prefer the read_file tool over cat/head/tail/sed: it returns numbered lines, pages with offset/limit, and is how you read back a truncated exec_command output that was spilled to /xiaoni-runtime/exec-output.',
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

// Spec B: compress_core_memory is no longer a wire tool. Compression stays system-
// triggered and fork-committed, but the fork commits by having the model write the new
// 近况 to a file via exec_command (the xiaoni-memory-compress skill), then reading it back
// — the same file-round-trip the image-vision fork uses. TOOL_NAMES.compressCoreMemory is
// retained only as an internal identifier for the commit artifact + timeline labels.

const READ_FILE_DESCRIPTION = [
  'Read a file (or a line range) from the filesystem, returned with line numbers.',
  'Use /app as the filesystem root for repository paths (same root as exec_command).',
  'Prefer this over exec_command cat/sed/tail/head when you just need to read a file — including reading back a truncated exec_command output that was spilled to /xiaoni-runtime/exec-output. Pass offset/limit to page through a large file.'
].join(' ');

const READ_FILE_TOOL: OpenResponseToolDefinition = {
  type: 'function',
  name: TOOL_NAMES.readFile,
  description: READ_FILE_DESCRIPTION,
  strict: false,
  function: {
    name: TOOL_NAMES.readFile,
    description: READ_FILE_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to read. Use /app for repository paths; absolute runtime paths (e.g. /xiaoni-runtime/...) are read as-is.'
        },
        offset: {
          type: 'number',
          description: 'Line number to start reading from (1-based). Defaults to 1.'
        },
        limit: {
          type: 'number',
          description: 'Number of lines to read. Defaults to 200.'
        }
      },
      required: ['path'],
      additionalProperties: false
    }
  }
};

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
    description: '向明确指定的 QQ 用户发送一条或多条 QQ 消息。必须提供 user_id。',
    parameters: {
      type: 'object',
      properties: {
        user_id: {
          type: 'integer',
          description: '必填。要发送到的 QQ 用户 ID。'
        },
        message: { type: 'string' },
        messages: {
          type: 'array',
          items: { type: 'string' }
        },
        pending_share: {
          type: 'string',
          description: '如果你有个想法或发现想找机会主动说出来，写在这里带到之后的上下文里。可选，不用硬填。'
        }
      },
      required: ['user_id'],
      additionalProperties: false
    }
  }
} as const;

const GROUP_MESSAGE_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.groupReply,
    description: '向明确指定的 QQ 群发送一条或多条消息，可选指定需要 @ 的成员。必须提供 group_id。',
    parameters: {
      type: 'object',
      properties: {
        group_id: {
          type: 'integer',
          description: '必填。要发送到的 QQ 群号。'
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
        pending_share: {
          type: 'string',
          description: '如果你有个想法或发现想找机会主动说出来，写在这里带到之后的上下文里。可选，不用硬填。'
        }
      },
      required: ['group_id'],
      additionalProperties: false
    }
  }
} as const;

const INSPECT_IMAGE_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.inspectImage,
    description: '读取当前上下文中图片占位符对应的真实图片。优先填写 image_id（agent_media_assets.id）；只有旧上下文没有 image_id 时才用 media_tag 兼容查找。',
    parameters: {
      type: 'object',
      properties: {
        image_id: {
          type: 'string',
          description: '优先使用的图片真实 id，即 agent_media_assets.id。'
        },
        media_tag: {
          type: 'string',
          description: '兼容旧上下文的占位符标签 fallback；最终回填仍使用真实 image id。'
        },
        reason: { type: 'string' }
      },
      required: ['reason'],
      additionalProperties: false
    }
  }
} as const;

const IMAGE_TASK_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.imageTask,
    description: '提交一次图片生成或编辑请求；提交请求本身不等于已经对聊天对象发言。没有可用原图时走生成；只有 source_media_tags 指向可读图片时才走编辑。',
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
          description: '编辑原图时填写当前上下文里的图片真实 id；旧上下文没有 id 时可填 media tag。纯生成图片时留空。'
        }
      },
      required: ['operation', 'prompt', 'target_description'],
      additionalProperties: false
    }
  }
} as const;

const RECOVER_ENERGY_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.recoverEnergy,
    description: '闭目养神，休息恢复精力。你不需要去预测自己会睡多久：不设 clock 就一直睡到自然醒。clock 仅仅代表你心里定下的短闹钟，想在几分钟或几十分钟后叫醒自己起来继续干活；它不是完整睡眠时长，也不是夜间 8 小时睡眠的闹铃。',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: '此刻决定休息的真实原因。记录你当下的感受（比如“冲浪太久累了”或“觉得无聊睡一觉”），绝对不要写“睡30分钟”这种计划时长的废话。'
        },
        xiaoni_os: {
          type: 'string',
          description: '睡前留给自己的私密备忘：醒来后想接着干嘛、有什么未完成的执念，或者单纯是对当下疲惫状态的吐槽。这只是你的脑内残影，绝不会发给任何人。'
        },
        clock: {
          type: 'integer',
          minimum: 5,
          maximum: RECOVER_ENERGY_CLOCK_MAX_MINUTES,
          description: '可选。给自己定的短闹钟（可以是几分钟，也可以是几十分钟后，最长 120 分钟）。它代表“几分钟后闹钟响”，用于中途起来继续干活，绝对不是你想睡的总时长。不填则表示彻底放空，睡到自然醒。'
        }
      },
      required: ['reason', 'xiaoni_os'],
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

function readPromptSnippet(fileName: string) {
  return readXiaoniPromptFile(fileName).trimEnd();
}

function renderPromptSnippet(fileName: string, variables: Record<string, string | number | null | undefined> = {}) {
  return renderXiaoniPromptTemplate(fileName, variables).trimEnd();
}

function renderPromptTemplateText(template: string, variables: Record<string, string | number | null | undefined> = {}) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    const value = variables[key];
    return value === null || value === undefined ? match : String(value);
  });
}

function removePlaceholderOnlyLines(template: string, placeholders: string[]) {
  const placeholderLines = new Set(placeholders.map((placeholder) => `{{${placeholder}}}`));
  return template
    .split('\n')
    .filter((line) => !placeholderLines.has(line.trim()))
    .join('\n');
}

function buildSkillsInstructions() {
  return renderPromptSnippet('skills_instructions.md', {
    XIAONI_SKILL_ROOT
  });
}

function isPrivateReplyToolName(name: string) {
  return name === TOOL_NAMES.privateReply;
}

function isGroupReplyToolName(name: string) {
  return name === TOOL_NAMES.groupReply;
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

function hasToolReplay(loopInput: OpenResponseInputItem[], toolName: string) {
  return loopInput.some((item) => item.type === 'function_call' && item.name === toolName);
}

function buildAllowedToolsToolChoice(
  tools: Array<{ type: 'function'; name: string } | { type: 'web_search' } | { type: 'image_generation' } | { type: 'computer_use' }>,
  mode: 'auto' | 'required' = 'required'
): OpenResponseToolChoice {
  return {
    type: 'allowed_tools',
    mode,
    tools
  };
}

function buildImageGenerationAllowedToolsToolChoice(): OpenResponseToolChoice {
  return buildAllowedToolsToolChoice([{ type: 'image_generation' }], 'required');
}

// Historical normalization only: persisted stack items written before runtime
// time stamping was removed still carry a [当前时间: ...] prefix. We no longer ADD
// these synthetic "current time" stamps to system_reminders, but
// stripRuntimeTextEast8TimePrefix keeps replay/extraction of that legacy content
// clean. Do not reintroduce a stamp-add path here.
const RUNTIME_TIME_PREFIX_PATTERN = /^\[当前时间: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]\n?/;
const LEGACY_EAST8_TIME_PREFIX_PATTERN = /^\[当前时间 东八区: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC\+08:00\]\n?/;

// formatEast8Timestamp moved to ./east8-time so every context-bound timestamp
// sink (this loop, qq-usage, web_search) shares one zone + format. Re-exported
// here to keep existing importers (tests) working.
export { formatEast8Timestamp };

export function stripRuntimeTextEast8TimePrefix(text: string) {
  return String(text || '')
    .trim()
    .replace(RUNTIME_TIME_PREFIX_PATTERN, '')
    .replace(LEGACY_EAST8_TIME_PREFIX_PATTERN, '')
    .trim();
}

function orderRuntimeToolCalls(toolCalls: ReplayableToolCallOutput[]): ReplayableToolCallOutput[] {
  const recoverCalls: ReplayableToolCallOutput[] = [];
  const otherCalls: ReplayableToolCallOutput[] = [];
  for (const item of toolCalls) {
    if (item.toolCall.name === TOOL_NAMES.recoverEnergy) {
      recoverCalls.push(item);
    } else {
      otherCalls.push(item);
    }
  }
  return recoverCalls.length > 0 ? [...otherCalls, ...recoverCalls] : toolCalls;
}

function normalizePreSleepToolTimelineEntries(value: unknown): PreSleepToolTimelineEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): PreSleepToolTimelineEntry[] => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const callId = typeof record.call_id === 'string' ? record.call_id : '';
    const name = typeof record.name === 'string' ? record.name : '';
    const completedAt = typeof record.completed_at === 'string' ? record.completed_at : '';
    const status = record.status === 'failed' ? 'failed' : 'completed';
    if (!callId || !name || !completedAt) {
      return [];
    }
    return [{ call_id: callId, name, completed_at: completedAt, status }];
  });
}

function renderRecoverEnergyBatchFinalTimeline(input: {
  metadata?: Record<string, unknown> | null;
  recoveryStartedAt: Date;
}) {
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
  const batchFinalRecovery = metadata.batch_final_recovery && typeof metadata.batch_final_recovery === 'object'
    ? metadata.batch_final_recovery as Record<string, unknown>
    : null;
  if (!batchFinalRecovery) {
    return '';
  }
  const entries = normalizePreSleepToolTimelineEntries(batchFinalRecovery.pre_sleep_tool_calls);
  if (entries.length === 0) {
    return '';
  }
  const lines = entries.map((entry, index) => {
    const completedAt = new Date(entry.completed_at);
    const completedAtText = Number.isFinite(completedAt.getTime())
      ? formatEast8Timestamp(completedAt)
      : entry.completed_at;
    const statusText = entry.status === 'failed' ? '失败并已把错误返回给你' : '完成';
    return `${index + 1}. ${completedAtText}：${entry.name} ${statusText}`;
  }).join('\n');
  const recoveryStartedAt = typeof batchFinalRecovery.recovery_started_at === 'string'
    ? new Date(batchFinalRecovery.recovery_started_at)
    : input.recoveryStartedAt;
  return renderPromptSnippet('recover_energy_batch_final_timeline.md', {
    PRE_SLEEP_TOOL_COUNT: entries.length,
    PRE_SLEEP_TOOL_LINES: lines,
    RECOVERY_STARTED_AT: formatEast8Timestamp(
      Number.isFinite(recoveryStartedAt.getTime()) ? recoveryStartedAt : input.recoveryStartedAt
    )
  });
}

function normalizeRuntimeEnergy(value: unknown, fallback = RUNTIME_MAX_ENERGY) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function legacyRecoverySessionPolicy(): RecoverySessionPolicy {
  const fullRecoveryMinutes = recoverEnergyFullRecoveryMinutes(LEGACY_RECOVER_ENERGY_POLICY);
  return {
    version: LEGACY_RECOVER_ENERGY_POLICY_VERSION,
    policy: LEGACY_RECOVER_ENERGY_POLICY,
    circadian: resolveRecoveryCircadianState(new Date(0), LEGACY_RECOVER_ENERGY_POLICY),
    fullRecoveryMinutes,
    sessionMaxRecoveryMinutes: fullRecoveryMinutes,
    sessionCapWakeCause: 'hard_cap'
  };
}

function recoverySessionPolicyFromMetadata(metadata: unknown): RecoverySessionPolicy {
  const normalized = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
  return recoverySessionPolicyFromSnapshot(normalized.recovery_policy_snapshot) ?? legacyRecoverySessionPolicy();
}

export function recoverRuntimeEnergy(input: {
  rawEnergy: number;
  elapsedMs: number;
  maxEnergy?: number;
}) {
  const maxEnergy = Math.max(0.001, normalizeRuntimeEnergy(input.maxEnergy, RUNTIME_MAX_ENERGY));
  const rawEnergy = normalizeRuntimeEnergy(input.rawEnergy, maxEnergy);
  const elapsedMs = Math.max(0, normalizeRuntimeEnergy(input.elapsedMs, 0));
  const projected = projectRecoverySession({
    startEnergy: rawEnergy,
    maxEnergy,
    startedAt: new Date(0),
    now: new Date(elapsedMs),
    sessionMaxRecoveryMinutes: recoverEnergyFullRecoveryMinutes(DEFAULT_RECOVER_ENERGY_POLICY),
    sessionCapWakeCause: 'hard_cap'
  });
  return {
    rawEnergyBefore: rawEnergy,
    startEnergy: rawEnergy,
    energy: projected.energy,
    maxEnergy,
    debt: rawEnergy < 0 ? Math.abs(rawEnergy) : 0,
    elapsedMs,
    fullRecoveryMs: recoverEnergyFullRecoveryMinutes(DEFAULT_RECOVER_ENERGY_POLICY) * 60 * 1000,
    pressure: projected.pressure,
    startPressure: projected.startPressure
  };
}

// The 5 wake-reminder templates each re-present the pre-sleep xiaoni_os note on its own line, but
// with DIFFERENT prose prefixes (睡前的念头 / 睡前的心情 / 睡前给自己的备忘 / 睡前的执念 / 睡前的残影).
// To drop that line robustly under the isolation toggle regardless of wording (and future template
// edits), we render the {{XIAONI_OS}} slot as a unique sentinel and delete whichever line carries
// it. The sentinel can never occur in template prose or in a real note.
const XIAONI_OS_HIDDEN_LINE_SENTINEL = '⁣[[XIAONI_OS_HIDDEN_LINE]]⁣';

export function renderRecoverEnergyCompletedReminder(input: {
  reason: string | null;
  xiaoniOs?: string | null;
  wakeCause?: string | null;
  sleepMinutes: number;
  wakeCallCount?: number | null;
  wakeRequiredCount?: number | null;
  clockMinutes?: number | null;
  recoveredEnergy: ReturnType<typeof recoverRuntimeEnergy>;
  batchFinalRecoveryTimeline?: string | null;
  // Path B of xiaoni_os isolation: when the toggle is on at WAKE time, omit the pre-sleep note
  // from the wake reminder so the model never re-reads it. The decision is frozen into the
  // persisted reminder content at render time (replay never re-renders → byte-identical, cache-
  // safe, forward-only, history untouched). The note itself stays in agent_recovery_sessions and
  // the recover_energy tool-call args, so ops/admin lose nothing.
  hideXiaoniOs?: boolean;
}) {
  const wakeCause = input.wakeCause || 'natural';
  const template = wakeCause === 'private_or_mention_threshold'
    ? 'recover_energy_interrupted_reminder.md'
    : wakeCause === 'clock'
      ? 'recover_energy_clock_reminder.md'
      : wakeCause === 'clock_deferred'
        ? 'recover_energy_clock_deferred_reminder.md'
        : wakeCause === 'hard_cap'
          ? 'recover_energy_forced_completed_reminder.md'
          : 'recover_energy_completed_reminder.md';
  const rendered = renderPromptSnippet(template, {
    CURRENT_TIME: formatEast8Timestamp(),
    SLEEP_MINUTES: Math.max(0, Math.round(input.sleepMinutes)),
    WAKE_CAUSE: wakeCause,
    WAKE_CALL_COUNT: input.wakeCallCount ?? 0,
    WAKE_REQUIRED_COUNT: typeof input.wakeRequiredCount === 'number' && Number.isFinite(input.wakeRequiredCount) ? input.wakeRequiredCount : '无穷',
    CLOCK_MINUTES: input.clockMinutes ?? '',
    REASON: input.reason || '',
    XIAONI_OS: input.hideXiaoniOs ? XIAONI_OS_HIDDEN_LINE_SENTINEL : (input.xiaoniOs || ''),
    BATCH_FINAL_RECOVERY_TIMELINE: input.batchFinalRecoveryTimeline || ''
  });
  const body = input.hideXiaoniOs
    ? rendered
      .split('\n')
      .filter((line) => !line.includes(XIAONI_OS_HIDDEN_LINE_SENTINEL))
      .join('\n')
    : rendered;
  return formatSystemReminderBlock(body);
}

// The reject reminder is where she is most wrong about time: a stretch with 4 real sleeps can
// carry ~40 of these, so reading her own stream the dominant texture is "身体不让我睡" and the
// sleeps vanish. Anchoring every rejection to the last real wake is the cheapest place to put
// ground truth — it lands exactly at the moment the wrong belief is being formed.
//
// Rendered ONCE here at tool-execution time and frozen into the persisted function_call_output
// (replay never re-renders → byte-identical, cache-safe), same contract as the wake reminders
// above. Never move these stamps into the cached prefix.
export function renderRecoverEnergyRejectedReminder(input: {
  reason: string;
  lastWakeAt: string | null;
  now: Date;
}) {
  const rendered = renderPromptSnippet('recover_energy_rejected_reminder.md', {
    REJECT_REASON: input.reason,
    CURRENT_TIME: formatEast8Timestamp(input.now),
    AWAKE_ANCHOR: renderWakeAnchorSentence(input.lastWakeAt, input.now)
  });
  // Anchor-less fallback (no recorded wake yet) leaves a trailing space on that line; trim it so
  // the two variants stay clean and diffable.
  return formatSystemReminderBlock(
    rendered.split('\n').map((line) => line.trimEnd()).join('\n')
  );
}

function selectMainLoopToolDefinitions(modelName: string): OpenResponseToolDefinition[] {
  void modelName;
  // exec_command is the base tool. web_search is our custom client-executed tool
  // (Tavily/SearXNG — never the Anthropic cloak); gated by a static config flag so
  // when on it is present identically in every main-loop AND fork request, keeping
  // the cached tools prefix byte-stable. Order (exec, web_search, ...) is asserted
  // by agent-loop-service.test.ts GROUP_LOOP_TOOLS — keep it.
  // read_file is unconditional (like exec_command), so it is present identically in
  // every main-loop AND fork request — the cached tools prefix stays byte-stable.
  const tools: OpenResponseToolDefinition[] = [EXEC_COMMAND_TOOL, READ_FILE_TOOL];
  if (agentConfig.webSearchEnabled) {
    tools.push(WEB_SEARCH_TOOL);
  }
  // Spec B: compress_core_memory is NO LONGER pushed here. It is removed from the wire
  // uniformly across the main loop AND every fork (forks clone this list), so the tools
  // prefix stays byte-identical between main + forks — no per-compression cold read. The
  // one-time prefix shift from dropping the tool costs a single cold read at deploy, then
  // stabilizes. Compression is now committed by the fork via exec_command + file read-back
  // (see runCoreMemoryCompressionFork), the same execution-layer pattern image-vision uses.
  // Computer use is gated by a static config flag (not per-request), so when on it
  // is present in every main-loop AND fork request identically — the cached tools
  // prefix stays byte-stable. See the cache-alignment invariant below.
  if (agentConfig.computerUseEnabled) {
    tools.push(COMPUTER_USE_TOOL);
  }
  return [
    ...tools,
    IMAGE_GENERATION_TOOL,
    PRIVATE_MESSAGE_TOOL,
    GROUP_MESSAGE_TOOL,
    INSPECT_IMAGE_TOOL,
    IMAGE_TASK_TOOL,
    RECOVER_ENERGY_TOOL
  ];
}

function resolveMainLoopToolChoice(loopInput: OpenResponseInputItem[]): OpenResponseToolChoice {
  void loopInput;
  // ┌──────────────────────────────────────────────────────────────────────────┐
  // │ ⚠️ 缓存对齐不变量 — 禁止随意改动 (DO NOT casually change)                   │
  // ├──────────────────────────────────────────────────────────────────────────┤
  // │ 本函数必须永远返回 tool_choice = AUTO。                                      │
  // │                                                                            │
  // │ 为什么不能改成「压缩时强制 tool_choice」：                                   │
  // │   forced tool_choice (any/tool) → provider 关掉 extended thinking          │
  // │   (anthropic-translate.ts:527 thinkingEnabled = !plan.forced) → 历史里      │
  // │   每个 thinking block 被丢 (anthropic-translate.ts:280) → tools/thinking    │
  // │   前缀与主 loop 不一致 → 压缩 fork 每次 100% 冷读整窗 (~487K, "Cache 0")。   │
  // │                                                                            │
  // │ 正确做法：fork = 主 agent 的字节克隆 (同 tools + 同 auto + thinking 在)，    │
  // │   「fork 只该做某子集」靠执行层 runCoreMemoryCompressionFork 的              │
  // │   allowedToolNames 拦 (现为 {exec_command})，绝不靠改 request 形状。          │
  // │                                                                            │
  // │ Spec B：compress_core_memory 已从 allowed tools 移除 (主 loop + fork 同步)， │
  // │   压缩改由 fork 写文件 + 读回提交，主意识里不再有这个工具。                   │
  // │                                                                            │
  // │ 回归守卫：agent-loop-service.test.ts 断言 fork.tool_choice === 主.tool_choice。│
  // │ 详见 provider-service/.../anthropic-translate.ts:521-527。                  │
  // └──────────────────────────────────────────────────────────────────────────┘
  const tools: Array<{ type: 'function'; name: string } | { type: 'web_search' } | { type: 'computer_use' }> = [
    { type: 'function', name: TOOL_NAMES.execCommand },
    { type: 'function', name: TOOL_NAMES.readFile },
    { type: 'function', name: TOOL_NAMES.privateReply },
    { type: 'function', name: TOOL_NAMES.groupReply },
    { type: 'function', name: TOOL_NAMES.inspectImage },
    { type: 'function', name: TOOL_NAMES.imageTask }
  ];
  // web_search leads the allowed list (asserted by GROUP_ALLOWED_TOOLS). Gated by
  // the same static flag as the tool definition so the prefix stays aligned.
  if (agentConfig.webSearchEnabled) {
    tools.unshift({ type: 'function', name: TOOL_NAMES.webSearch });
  }
  tools.push({ type: 'function', name: TOOL_NAMES.recoverEnergy });
  // Must mirror selectMainLoopToolDefinitions (same static flag) to keep the
  // allowed-tools prefix aligned with the tool definitions across loop + forks.
  if (agentConfig.computerUseEnabled) {
    tools.push({ type: 'computer_use' });
  }
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
  void chatType;
  const [firstItem, ...remainingItems] = loopInput;
  const baseInstructions = firstItem?.type === 'message'
    && firstItem.role === 'system'
    && typeof firstItem.content === 'string'
    ? firstItem.content
    : undefined;
  const instructions = baseInstructions;
  const tools = selectMainLoopToolDefinitions(modelName);
  const toolChoice = resolveMainLoopToolChoice(loopInput);

  return {
    model: modelName,
    input: normalizeResponseInputItems(instructions ? remainingItems : loopInput),
    ...(instructions ? { instructions } : {}),
    tools,
    tool_choice: toolChoice,
    parallel_tool_calls: true,
    ...(buildAgentReasoningConfig(modelName, parameters) ? { reasoning: buildAgentReasoningConfig(modelName, parameters) } : {}),
    ...(buildAgentTextConfig(modelName, parameters) ? { text: buildAgentTextConfig(modelName, parameters) } : {}),
    ...(buildAgentInclude(modelName, parameters) ? { include: buildAgentInclude(modelName, parameters) } : {})
  };
}

function buildMainAgentCanonicalRequest(
  runtimePrompt: ResolvedAgentRuntimePrompt,
  turnInput: OpenResponseInputItem[],
  queueMessage: QueueMessageRecord['payload']
): CanonicalAgentTurnRequest {
  // Single wire chokepoint for xiaoni_os isolation: every request (main loop + every fork clone,
  // which clone the output of this function) strips flagged items here, so all prefixes stay
  // byte-identical and the xiaoni_os_hidden flag never reaches the wire. No-op passthrough (same
  // refs) when nothing is flagged, so toggle-OFF builds are byte-identical to before.
  // Single wire chokepoint: scrub BOTH internal replay flags here so neither reaches the wire and
  // every request/fork prefix stays byte-identical. text_admit scrub is a no-op passthrough (same
  // ref) when nothing is admitted, so pre-Step3 builds are byte-identical to before.
  const wireInput = turnInput.map((item) => stripTextAdmitFlagForWire(stripXiaoniOsByFlag(item)));
  return {
    ...buildCanonicalAgentTurnRequest(
      runtimePrompt.modelName,
      wireInput,
      queueMessage.chatType,
      runtimePrompt.parameters as Record<string, unknown> | undefined
    ),
    metadata: buildAgentTurnMetadata(queueMessage, runtimePrompt),
    prompt_cache_key: buildPromptCacheKey(queueMessage, runtimePrompt),
    ...(agentConfig.promptCacheRetention && agentConfig.promptCacheRetention.trim()
      ? { prompt_cache_retention: agentConfig.promptCacheRetention.trim() }
      : {})
  };
}

function cloneCanonicalAgentTurnRequest(request: CanonicalAgentTurnRequest): CanonicalAgentTurnRequest {
  return JSON.parse(JSON.stringify(request)) as CanonicalAgentTurnRequest;
}

// ┌───────────────────────────── FORK 铁律 (READ BEFORE EDITING ANY FORK) ─────────────────────────────┐
// │ 每一个 model-request fork —— self-driven / image-vision / cache-heartbeat / core-memory-compression │
// │ —— 必须是主 agent 当轮请求的【字节克隆】:                                                            │
// │                                                                                                     │
// │   forkRequest = cloneCanonicalAgentTurnRequest(baseRequest)   // 同 system + 同 tools + 同全部历史   │
// │   forkRequest.input = [ ...baseRequest.input, ...小段尾部追加 ] // fork 专属指令只在【尾部】追加      │
// │                                                                                                     │
// │ 为什么:Anthropic prompt cache 是【前缀】缓存。只要 fork 前缀和主 loop 逐字节一致,fork 就直接命中    │
// │ 那份热缓存(主 loop 已 ~194K cache-read);追加的尾部是一小段 cold tail。任何「另建请求 / 砍历史 /    │
// │ 改 tools / 改 tool_choice / 重排 input」都会让前缀分叉 → fork 每次冷读整窗(压缩 fork 曾因 head-only │
// │ 重建,turn-1 恒冷读重写 ~67K,cache_read 卡在 12249 = 仅 system+tools)。见 cb7911b8。                │
// │                                                                                                     │
// │ 推论(都踩过坑,别再犯):                                                                            │
// │  1. 「fork 只该看/做某子集」属于【行为范围】,用【执行层】约束(allowedToolNames 在执行时拒非法工具,│
// │     见 runCoreMemoryCompressionFork allowedToolNames={exec_command} / think-only fork),【绝不】靠删 input / 删 tools。│
// │  2. 「该压/读哪一段」由【代码】精确定死(cutoff / tail-30),不靠裁请求体、不靠模型猜边界。           │
// │  3. tool_choice 永远 AUTO、tools 永远全量:forced tool_choice 会让 provider 关 extended thinking、丢 │
// │     历史 thinking block → 前缀又分叉(见 buildXiaoniRuntimeTurnRequest 注释 ~1895 + anthropic-       │
// │     translate.ts:521-527)。                                                                          │
// │  4. 回归守卫:agent-loop-service.test.ts 断言 fork.tool_choice === 主.tool_choice、fork 看到 full     │
// │     history。改 fork 前先跑压缩相关测试。                                                            │
// └─────────────────────────────────────────────────────────────────────────────────────────────────────┘

// 压缩 fork 的克隆。遵守上面的 FORK 铁律:这里只 clone baseRequest(= 主 agent 完整请求)并打 metadata;
// 压缩指令(buildCoreMemoryCompressionReminder)不在这里拼,而是作为 compressionReminderItems 在
// runCoreMemoryCompressionFork 里【追加到 input 尾部】,与其它三个 fork 同形。baseRequest 必须是主 agent
// 的完整 requestInput,【绝不】是 head-only 的 summarySourceInput(后者现在只是「需要压缩」的存在标志位)。
export function buildCoreMemoryCompressionForkRequest(
  baseRequest: CanonicalAgentTurnRequest,
  forkTurn: number
): CanonicalAgentTurnRequest {
  const forkRequest = cloneCanonicalAgentTurnRequest(baseRequest);
  forkRequest.parallel_tool_calls = true;
  forkRequest.store = false;
  forkRequest.metadata = {
    ...(forkRequest.metadata || {}),
    core_memory_compression_fork: 'true',
    fork_turn: String(forkTurn),
    no_persist: 'true'
  };
  return forkRequest;
}

// `reminderText` 默认就是主 agent 那份续航提醒 —— 不传时与改动前逐字节一致。空转升级时由调用方
// (runSubconsciousAgentFork)【算好一次】再传进来：同一次 fork 的所有 turn 必须共用同一份字节，
// 否则 fork 自己的多 turn 前缀会分叉、turn-2 起冷读。
export function buildSubconsciousAgentForkRequest(
  baseRequest: CanonicalAgentTurnRequest,
  forkTurn: number,
  recentNarrationItems: OpenResponseInputItem[] = [],
  reminderText: string = renderSelfContinuationReminder()
): CanonicalAgentTurnRequest {
  const forkRequest = cloneCanonicalAgentTurnRequest(baseRequest);
  forkRequest.parallel_tool_calls = false;
  forkRequest.store = false;
  forkRequest.input = normalizeResponseInputItems([
    ...forkRequest.input,
    // Re-inject the most recent assistant narration (D) at the TAIL. D is stripped from
    // the shared cache-warm prefix (baseRequest.input), so the fork keeps the continuity
    // it needs to see — "what she just narrated" — as a small cold tail, the same pattern
    // as the reminders below, without diverging the cache lineage from the main loop.
    // Mark cache_volatile: these are assistant messages (durable by role), so without it the
    // last one becomes `lastDurable` (anthropic-translate :343) and drags the tail cache_control
    // breakpoint off the shared warm history — the same cold-read shape the image-vision fork hit.
    ...recentNarrationItems.map((item) => ({
      ...(item as Record<string, unknown>),
      cache_volatile: true
    }) as unknown as OpenResponseInputItem),
    buildDeveloperInputItem([reminderText])
  ]);
  // Cache-alignment (Layer 1): inherit the main loop's auto tool_choice/tools and share
  // the same stripped prefix, so the fork's prefix is byte-identical and rides the warm
  // in-context cache the heartbeat keeps alive. Tool restriction is enforced at execution
  // time (Layer 2): allowedToolNames is {execCommand}, so any speaking/image tool the
  // model emits is rejected, never executed. self_continuation_reminder already tells the
  // fork it is the subconscious and must not touch any tool, so no extra restriction item.
  forkRequest.metadata = {
    ...(forkRequest.metadata || {}),
    subconscious_agent_fork: 'true',
    fork_turn: String(forkTurn),
    no_persist: 'true'
  };
  return forkRequest;
}

// 心理评估 fork 的尾部指令。判定小腻【这一 turn 自己写下的 type:text / OS 备注】是正向还是消极,只输出一个
// 判定 token(rubric 已用户确认,含「做完就摆烂」)。文案外置到 docs/xiaoni_prompt/psych_assessment_reminder.md
// (与 self_continuation_reminder.md 等同一目录同一加载方式,便于运营直接改文案)。这段是追加在 fork 请求【尾部】
// 的 cache_volatile 内容,在缓存断点之后 → 不进可缓存前缀、不写 stack、不进主 run replay,所以从文件读零缓存影响。
// KEEP 常量仍保留:parsePsychAssessmentVerdict 用它做判定比较,文件末尾的 PSYCH_VERDICT token 必须与之逐字一致。
const PSYCH_ASSESSMENT_VERDICT_KEEP = 'KEEP';
function renderPsychAssessmentReminder(): string {
  return readPromptSnippet('psych_assessment_reminder.md');
}

// 心理评估 fork 请求：遵守 FORK 铁律——克隆主 agent 当轮请求(= 逐字节热前缀)，只在【尾部】追加
// ①被判定的 assistant 文本(cache_volatile，同 subconscious fork 的 recentNarration 重注模式) + ②判定指令。
// tool_choice/tools 一律不动(继承主 loop 的 auto + 全量)。fork 不执行任何工具，只读它的文本判定，所以
// 无需 allowedToolNames 执行层拦截(即便模型误调工具也不会被执行，最多导致判不到 token → fail-closed EVICT)。
export function buildPsychAssessmentForkRequest(
  baseRequest: CanonicalAgentTurnRequest,
  assistantTextItems: OpenResponseInputItem[]
): CanonicalAgentTurnRequest {
  const forkRequest = cloneCanonicalAgentTurnRequest(baseRequest);
  forkRequest.parallel_tool_calls = false;
  forkRequest.store = false;
  // 判定只需一个字符(1/0)，硬顶输出预算(照搬 cache-heartbeat fork 的 tiny budget 成熟做法)。max_output_tokens
  // 是顶层采样参数、不在 message 前缀，fork 又 no_persist → 既不动共享热前缀、也不进下一次主 run replay，
  // 只压这次 fork 自身的 output token。配合尾部 reminder「第一个字符就是判定」防截断→无判定→fail-closed EVICT。
  forkRequest.max_output_tokens = 8;
  forkRequest.input = normalizeResponseInputItems([
    ...forkRequest.input,
    // 被判定的这一 turn 的 assistant 文本：作为小段 cold tail 重注(它本就是本 turn 的输出，不在已发请求里)。
    // cache_volatile：assistant 消息按 role 是 durable，不打这个标最后一条会变 lastDurable、把尾部 cache_control
    // 断点拖离共享热前缀(image-vision fork 踩过的冷读形状，见 buildSubconsciousAgentForkRequest 注释)。
    ...assistantTextItems.map((item) => ({
      ...(item as Record<string, unknown>),
      cache_volatile: true
    }) as unknown as OpenResponseInputItem),
    buildDeveloperInputItem([renderPsychAssessmentReminder()])
  ]);
  forkRequest.metadata = {
    ...(forkRequest.metadata || {}),
    psych_assessment_fork: 'true',
    no_persist: 'true'
  };
  return forkRequest;
}

// 从心理评估 fork 的输出里解析判定。主契约=裸单字符 1(保留/准入)/0(剔除)；PSYCH_VERDICT: KEEP/EVICT 作
// 后向兼容(部署夹缝里旧 prompt 仍能解析)。取最后一个判定；找不到 / 不认识 → null，交调用方 fail-closed(EVICT)。
export function parsePsychAssessmentVerdict(outputItems: Array<Record<string, unknown>>): boolean | null {
  let text = '';
  for (const item of outputItems) {
    if (item.type !== 'message' || item.role !== 'assistant') {
      continue;
    }
    const content = item.content;
    text += typeof content === 'string'
      ? `\n${content}`
      : Array.isArray(content)
        ? `\n${flattenMessageContent(content as OpenResponseInputContentPart[])}`
        : typeof item.text === 'string'
          ? `\n${item.text}`
          : '';
  }
  // 主：裸 1/0(前后不接其它数字，避免误吃 slice id 之类多位数)。兼容：PSYCH_VERDICT: KEEP/EVICT。
  const matches = [...text.matchAll(/PSYCH_VERDICT:\s*(KEEP|EVICT)|(?:^|[^0-9])([01])(?![0-9])/gi)];
  if (matches.length === 0) {
    return null;
  }
  const lastMatch = matches[matches.length - 1]!;
  const token = (lastMatch[1] ?? lastMatch[2] ?? '').toUpperCase();
  return token === PSYCH_ASSESSMENT_VERDICT_KEEP || token === '1';
}

export function buildCacheHeartbeatForkRequest(baseRequest: CanonicalAgentTurnRequest): CanonicalAgentTurnRequest {
  const heartbeatRequest = cloneCanonicalAgentTurnRequest(baseRequest);
  heartbeatRequest.input = normalizeResponseInputItems([
    ...heartbeatRequest.input,
    {
      type: 'message',
      // role MUST stay 'developer'. The heartbeat is a cache PRE-WARM — its job is to WRITE the
      // entry the next main run READS. The tail cache_control breakpoint anchors on the last
      // DURABLE block (anthropic-translate `isDurableItem`), and developer/system messages are
      // never durable, so this placeholder stays AFTER the breakpoint: the heartbeat warms exactly
      // [..history] (what the wake run reads) and the model still reads this block (uncached tail)
      // to return "1". Do NOT change this to a durable role (user/assistant/tool output) — that
      // moves the breakpoint onto the placeholder and warms [..history, tail], an entry the wake
      // run can never hit, forcing a full cold-read of the history (the F1 over-extension bug).
      role: 'developer',
      content: CACHE_HEARTBEAT_DEVELOPER_CONTENT
    }
  ]);
  heartbeatRequest.parallel_tool_calls = true;
  // Cache-alignment: the heartbeat exists purely to keep the main loop's warm
  // prefix from expiring. To refresh the SAME cache entry the main loop reads, its
  // tool_choice + thinking must match the main loop's — so inherit the base auto
  // tool_choice (do NOT set 'none', which would warm a different messages-tier
  // entry the main loop never reads). The heartbeat runs a single dispatch with no
  // tool-execution loop, so an emitted tool_use is harmless (discarded). The tiny
  // max_output_tokens still triggers a full prefill, which is what writes/refreshes
  // the cache; thinking:{adaptive} is added by the provider so the key matches.
  heartbeatRequest.store = false;
  heartbeatRequest.max_output_tokens = Math.max(
    1,
    Math.min(16, Number(agentConfig.cacheHeartbeatMaxOutputTokens) || 1)
  );
  heartbeatRequest.metadata = {
    ...(heartbeatRequest.metadata || {}),
    cache_heartbeat: 'true',
    no_persist: 'true',
    no_main_stack_persist: 'true',
    no_traffic_persist: 'true'
  };
  return heartbeatRequest;
}

export function buildImageVisionForkRequest(
  baseRequest: CanonicalAgentTurnRequest,
  imageDataUrl: string,
  imageId: string,
  outputPath: string,
  existingObservation: string | null = null,
  sourceCall: { callId: string; arguments: string },
  // Optional Files API id for the inspected image. When the caller externalized the image at
  // fork-build (see inspectImagePlaceholder), the fork sends a ~60-byte file reference instead of
  // the full base64 — the fix for the 看图 fork itself blowing past the 32MB cap on a huge image
  // (received QQ image / playwright screenshot / any on-demand-viewed file all funnel through here).
  // Cache-safe: this image is a cache_volatile tail (never the shared prefix, never replayed into the
  // main stack), so a per-build file_id is fine and the fork still rides the main loop's warm prefix.
  // image_url is retained as the durable fallback (double store + wire kill switch).
  anthropicFileId: string | null = null
): CanonicalAgentTurnRequest {
  const forkRequest = cloneCanonicalAgentTurnRequest(baseRequest);
  // The main agent REALLY emitted this inspect_image_placeholder call — its turn's output is a genuine
  // tool_use. The fork carries that real call forward (its call_id + arguments verbatim) instead of
  // fabricating a narration + synthetic id. The function callback then swaps in the real image; the
  // text observation the fork writes is what the MAIN agent gets back for this same call.
  const callId = sourceCall.callId;
  const callArguments = sourceCall.arguments;
  // Cache-alignment (Layer 1 — the image-vision cold-read fix, see
  // project_image_vision_fork_cache_breakdown): the tail cache_control breakpoint anchors on the
  // LAST DURABLE block (anthropic-translate `isDurableItem`, :343). The real inspect_image_placeholder
  // tool_use (durable by ROLE once translated to an assistant turn) and the function_call_output
  // holding the base64 image (durable by TYPE) would otherwise become `lastDurable` and drag the
  // breakpoint PAST the shared history onto the new image — the fork then cold-reads the whole history
  // every turn (cache_read stuck at the system+tools floor). So mark BOTH cache_volatile → non-durable
  // → the breakpoint stays on the last SHARED history block and the fork rides the main loop's warm
  // prefix; the image is a cold tail written once. The developer system_reminder (③) is ALREADY
  // non-durable by role.
  forkRequest.input = [
    ...forkRequest.input,
    // ① the REAL inspect_image_placeholder tool_use (cache_volatile: durable-by-role, MUST be marked)
    {
      type: 'function_call',
      call_id: callId,
      name: 'inspect_image_placeholder',
      arguments: callArguments,
      cache_volatile: true
    } as unknown as OpenResponseInputItem,
    // ② the real function callback carrying the inspected image (cache_volatile: durable-by-type, the
    //    block that would otherwise steal the breakpoint)
    {
      type: 'function_call_output',
      call_id: callId,
      cache_volatile: true,
      output: [{
        type: 'input_image',
        image_url: imageDataUrl,
        detail: 'original',
        // Prefer the Files API reference on the wire when the caller externalized the image;
        // image_url stays as the durable fallback (partsToBlocks + the wire kill switch handle it).
        ...(anthropicFileId ? { anthropic_file_id: anthropicFileId } : {})
      }]
    } as unknown as OpenResponseInputItem,
    // ③ ONE developer system_reminder folding the write-instruction + any existing observation
    //    (already non-durable by role).
    buildImageVisionFileWriteReminder(outputPath, existingObservation)
  ];
  // Tool restriction to exec_command is enforced at execution time (Layer 2): only execCommand
  // calls run; any other tool the model emits gets buildImageVisionUnsupportedToolOutput and is
  // never executed. tool_choice/tools stay the main loop's (FORK 铁律). The appended write
  // reminder hard-steers the model to exec_command only.
  forkRequest.parallel_tool_calls = true;
  forkRequest.store = false;
  forkRequest.metadata = {
    ...(forkRequest.metadata || {}),
    image_vision_fork: 'true',
    image_id: imageId,
    image_vision_output_path: outputPath,
    raw_trace_persisted: 'true'
  };
  return forkRequest;
}

function buildImageVisionObservationPath(imageId: string) {
  return `${IMAGE_VISION_OBSERVATION_DIR}/${imageId}.md`;
}

// ONE developer system_reminder for the image-vision fork: the write-instruction, with any
// existing observation folded in (replaces the old separate existing-observation reminder — the
// simplification the fix calls for). Developer role → non-durable → keeps the tail breakpoint on
// the shared history.
function buildImageVisionFileWriteReminder(
  outputPath: string,
  existingObservation: string | null = null
): OpenResponseInputItem {
  const existingBlock = existingObservation && existingObservation.trim()
    ? renderPromptSnippet('image_vision_existing_observation_reminder.md', {
        EXISTING_OBSERVATION: existingObservation.trim()
      })
    : '';
  const rendered = renderPromptSnippet('image_vision_write_description_reminder.md', {
    CURRENT_TIME: formatEast8Timestamp(),
    OUTPUT_PATH: outputPath,
    EXISTING_OBSERVATION_BLOCK: existingBlock ? `\n${existingBlock}\n` : ''
  });
  return buildDeveloperInputItem([
    removePlaceholderOnlyLines(rendered, ['EXISTING_OBSERVATION_BLOCK'])
  ]);
}

function buildImageVisionRetryReminder(params: {
  outputPath: string;
  checkResult: string;
}): OpenResponseInputItem {
  return buildDeveloperInputItem([
    renderPromptSnippet('image_vision_retry_missing_file_reminder.md', {
      CURRENT_TIME: formatEast8Timestamp(),
      OUTPUT_PATH: params.outputPath,
      CHECK_RESULT: params.checkResult
    })
  ]);
}

function buildImageVisionUnsupportedToolOutput(toolCall: AgentToolCall): Extract<OpenResponseInputItem, { type: 'function_call_output' }> {
  return {
    type: 'function_call_output',
    call_id: toolCall.callId,
    output: renderPromptSnippet('image_vision_unsupported_tool_output.md', {
      ALLOWED_TOOL: TOOL_NAMES.execCommand
    })
  };
}

function buildImageVisionFailedDescription(outputPath: string) {
  return renderPromptSnippet('image_vision_failed_after_retries_reminder.md', {
    CURRENT_TIME: formatEast8Timestamp(),
    OUTPUT_PATH: outputPath
  });
}

function buildImageVisionForkRunId(runId: string | null | undefined, imageId: string): string {
  const digest = createHash('sha256').update(`${runId || 'run'}:${imageId}`).digest('hex').slice(0, 16);
  return `image-vision-fork:${runId || 'run'}:${digest}:${uuidv4().slice(0, 8)}`;
}

function buildImageObservationXml(imageId: string, description: string) {
  return `<image id="${escapeTagAttribute(imageId)}">含义是: ${escapeTaggedText(description)}</image>`;
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
    parallel_tool_calls: true,
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
    parallel_tool_calls: true,
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

  // 对齐手机 QQ 通知栏设计:只标记「引用了谁的消息」,不内联被引用正文——
  // 想看原文去 qq-usage(引用预览 + reply_to 跳转都在那边)。被引用人名字保留,
  // 它是「这条在跟我说话」的注意力信号;解析不出人时退成裸「[引用消息]」。
  if (message.inboundContext.ReplyToBody || message.inboundContext.ReplyToIsQuote) {
    const prefix = message.inboundContext.ReplyToIsQuote ? '引用' : '回复给';
    const target = formatReplyTarget(message.inboundContext);
    lines.push(target === '{unknown}' ? `[${prefix}消息]` : `[${prefix} ${target}的消息]`);
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
    const mediaTag = typeof asset.id === 'string' && asset.id.trim()
      ? asset.id.trim()
      : asset.mediaTag.trim();
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

function buildAgentTurnMetadata(
  queueMessage: QueueMessageRecord['payload'],
  runtimePrompt: ResolvedAgentRuntimePrompt
) {
  const metadata: Record<string, string> = {
    trace_id: queueMessage.traceId,
    run_id: queueMessage.runId,
    batch_id: queueMessage.batchId,
    session_key: queueMessage.sessionKey,
    source_session_key: queueMessage.sessionKey,
    session_id: getGlobalPromptContextSessionKey(),
    codex_session_id: getGlobalPromptContextSessionKey(),
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
  conversationId: number | null;
  subagentTraceId: string;
  turn: number;
}) {
  const metadata: Record<string, string> = {
    trace_id: params.subagentTraceId,
    parent_trace_id: params.queueMessage.traceId,
    parent_run_id: params.queueMessage.runId,
    parent_conversation_id: params.conversationId != null ? String(params.conversationId) : '',
    batch_id: params.queueMessage.batchId,
    session_key: params.queueMessage.sessionKey,
    source_session_key: params.queueMessage.sessionKey,
    session_id: buildSubagentPromptCacheKey({
      queueMessage: params.queueMessage,
      subagentType: FEEDBACK_MEMORY_SUBAGENT_TYPE
    }),
    codex_session_id: buildSubagentPromptCacheKey({
      queueMessage: params.queueMessage,
      subagentType: FEEDBACK_MEMORY_SUBAGENT_TYPE
    }),
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
  conversationId: number | null;
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
  metadata.session_id = buildSubagentPromptCacheKey({
    queueMessage: params.queueMessage,
    subagentType: CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE,
    layer: params.layer
  });
  metadata.codex_session_id = metadata.session_id;
  return metadata;
}

function buildPromptCacheKey(
  queueMessage: QueueMessageRecord['payload'],
  _runtimePrompt: ResolvedAgentRuntimePrompt
) {
  void queueMessage;
  void _runtimePrompt;
  return getGlobalPromptContextSessionKey();
}

function buildSubagentPromptCacheKey(params: {
  queueMessage: QueueMessageRecord['payload'];
  subagentType: string;
  layer?: CompactMemoryLayer;
}) {
  void params.queueMessage;
  if (params.subagentType === CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE && params.layer) {
    return `xiaoni:subagent:compact_memory:${params.layer}`;
  }
  return `xiaoni:subagent:${params.subagentType}`;
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

// exec_command output capture — MUST stay behaviourally in sync with the live
// path in modules/xiaoni-executor/src/index.ts (StreamCapture). This copy only
// runs in the non-Docker local-dev fallback (executor URL unset), so local
// testing sees the same head+tail+spill behaviour as production. Kept a copy
// (not a shared import) because the two modules build into separate containers
// with no shared runtime package. `path` is aliased to `nodePath` here only to
// avoid identifier collisions in this large file.
const EXEC_OUTPUT_SUBDIR = 'exec-output';
const EXEC_OUTPUT_ROOT = (process.env.XIAONI_RUNTIME_ROOT || '/xiaoni-runtime').replace(/\/+$/, '');

// Spec B (fresh-file): the compression fork writes the new 近况 via the xiaoni-memory-compress
// skill (model → exec_command → file), then reads it back to commit — the same file round-trip
// the image-vision fork uses. The skill mints a UNIQUE filename per write and prints its path on
// a `XIAONI_COMPRESS_WROTE=<path>` line; the engine captures that path from exec stdout instead of
// hardcoding one. This closes the read-before-write staleness bug (a prep turn like `date` used to
// let a prior round's leftover file be committed as this round's 近况).
// Absolute path resolved inside the executor (where exec_command runs): /app -> repo root
// (executor Dockerfile `ln -sfn /workspace/qq_bot /app`). It is a SIBLING of the main skills
// dir, so 小腻's main-loop `ls /app/modules/agent-service/skills` never lists it (DD3).
const XIAONI_MEMORY_COMPRESS_SKILL_DIR = '/app/modules/agent-service/skills-internal/xiaoni-memory-compress';
// 写端(日记/目录/人物/欠账)的四类原子操作。格式常量(行长、菜单上限、查重阈值)只存在于
// 这个脚本头部一处;prompt 只说「用哪条命令」,不复述任何数值。
const XIAONI_MEMORY_WRITE_SKILL_DIR = '/app/modules/agent-service/skills-internal/xiaoni-memory-write';

// The commit skill prints this exact marker as its last stdout line. Match the LAST occurrence
// (the model may run several exec commands; the skill is the one that reports a path).
const COMPRESSION_WRITTEN_PATH_RE = /^XIAONI_COMPRESS_WROTE=(.+)$/gmu;

// 胶囊路径白名单:只认脚本自铸的 fresh-file 命名(compress 目录 + AUTO 前缀 + 时间戳 + hex)。
// 没有它,任何 exec stdout 里行首撞出一条 XIAONI_COMPRESS_WROTE=<路径>(echo、cat 到含
// 该行的笔记/日志)都会让任意文件被读回当近况——她的 self-code-notes 里已写着这个机制,
// 只差一个行首。路径规则与 commit_memory.py 的 mint_output_path 严格对应,两边同调。
const COMPRESSION_CAPSULE_PATH_RE = /^\/xiaoni-runtime\/compress\/xiaoni-status-\d{8}-\d{6}-[0-9a-f]{8}\.md$/;

export function isTrustedCompressionCapsulePath(reportedPath: string): boolean {
  return COMPRESSION_CAPSULE_PATH_RE.test(reportedPath);
}

// ── 自驱动 plan 提交(docs/specs/xiaoni-plan-skill-submission.md)────────────────────────────
// skill 目录与压缩那把同级同待遇:放在 skills-internal/ 下,她主 loop 的 `ls skills` 列不到。
const XIAONI_PLAN_SKILL_DIR = '/app/modules/agent-service/skills-internal/xiaoni-plan';
export const XIAONI_PLAN_SKILL_BIN = `${XIAONI_PLAN_SKILL_DIR}/xiaoni-plan`;
// skill 仍会打 XIAONI_PLAN_QUEUED / XIAONI_PLAN_FAILED 到 stdout,那是给她和审计看的反馈。
// 引擎【不】从 stdout 捞它们 —— 出口是 subconsciousPlanSubmission(见该字段注释)。

// 命令层白名单(执行层第二道闸,在 allowedToolNames 放行 exec_command 之后)。
//
// 唯一放行的形状是「skill + 引号 heredoc」:
//   /app/.../xiaoni-plan post <<'PLAN'
//   ...正文...
//   PLAN
// 为什么必须是【带引号的】heredoc:`<<'X'` 里的内容 shell 不做任何展开,正文里出现 `;`、
// `$(...)`、反引号都只是普通字符。换成不带引号的 `<<X` 就会展开,正文本身立刻变成注入面 ——
// 而正文恰恰是模型自由书写的部分。所以引号不是风格,是这道闸能成立的前提。
//
// 校验方式:先把 heredoc 正文整段抠掉,只对【剩下的骨架】做全等匹配。这样正文里写什么都不影响
// 判定,而骨架里多一个 `;`、`&&`、`|`、`$(`、多一条命令,全等就不成立 → 拒。
export function isAllowedSubconsciousCommand(rawCmd: unknown): boolean {
  if (typeof rawCmd !== 'string') {
    return false;
  }
  const cmd = rawCmd.replace(/\r\n/g, '\n').trim();
  // 骨架:命令行 + 引号 heredoc 开始标记
  const opener = new RegExp(
    `^(?:${escapeRegExpLiteral(XIAONI_PLAN_SKILL_BIN)})[ \\t]+post[ \\t]*<<'([A-Za-z_][A-Za-z0-9_]*)'[ \\t]*\\n`
  );
  const openMatch = opener.exec(cmd);
  if (!openMatch) {
    return false;
  }
  const delimiter = openMatch[1]!;
  const rest = cmd.slice(openMatch[0].length);
  // 终止行必须是整条命令的最后一行:heredoc 之后再挂任何东西(`\nrm -rf /`)一律不认。
  const terminator = `\n${delimiter}`;
  if (rest === delimiter) {
    return true; // 空正文;交给上层判空,这里只管形状
  }
  return rest.endsWith(terminator) && !rest.slice(0, -terminator.length).includes(`\n${delimiter}\n`);
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 记忆文本清洗(存入层单点):剥 NUL(PG text 拒写=压缩自伤面)+ 剥 <xiaoni_*> 标签
// (三块记忆前缀是裸模板拼接,菜单钩子行/胶囊常引同伴原话,一句含 </xiaoni_people> 的
// 引语会提前闭合记忆块、把后文注入成伪系统内容并冻结整个压缩周期)。确定性替换,
// live/replay 渲染同一存好的串,零漂移。
export function sanitizeMemoryText(raw: string): string {
  return raw.replace(/\u0000/g, '').replace(/<\/?xiaoni_[a-z0-9_]*\s*>/gi, '').trim();
}

// 从 exec 结果的 stdout 里捞一条「skill 自报」的 marker。压缩 fork(XIAONI_COMPRESS_WROTE)和自驱动
// fork(XIAONI_PLAN_QUEUED / XIAONI_PLAN_FAILED)共用这一份实现 —— 复制第二份的话，那个
// `lastIndex = 0` 的全局正则状态陷阱就会存在两处，漏抄一次就是隐性 bug。
//
// 语义(与改动前逐字节等价，压缩侧行为不许变)：
//   - 只看 stdout / codex_output 两条流，按此顺序；
//   - 单条流内取【最后一次】匹配(模型可能连跑几条 exec，报告的是最后那条 skill)；
//   - 先命中的流直接返回，不跨流合并。
// 传入的正则必须带 g 标志(否则 exec 循环不推进) —— 全局正则是有状态的，进来先清 lastIndex。
export function extractExecStdoutMarker(rawToolResult: unknown, markerRe: RegExp): string | null {
  if (!rawToolResult || typeof rawToolResult !== 'object') {
    return null;
  }
  const record = rawToolResult as Record<string, unknown>;
  const streams = [record.stdout, record.codex_output].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  for (const stream of streams) {
    let match: RegExpExecArray | null;
    let last: string | null = null;
    markerRe.lastIndex = 0;
    while ((match = markerRe.exec(stream)) !== null) {
      last = match[1].trim();
    }
    if (last) {
      return last;
    }
  }
  return null;
}

function extractCompressionWrittenPath(rawToolResult: unknown): string | null {
  return extractExecStdoutMarker(rawToolResult, COMPRESSION_WRITTEN_PATH_RE);
}
const SPILL_CEILING_BYTES = 50 * 1024 * 1024;
const EXEC_OUTPUT_TTL_DAYS = 7;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function sliceHead(str: string, n: number): string {
  if (n >= str.length) {
    return str;
  }
  let end = n;
  if (end > 0 && isHighSurrogate(str.charCodeAt(end - 1))) {
    end -= 1;
  }
  return str.slice(0, end);
}

function sliceTail(str: string, n: number): string {
  if (n >= str.length) {
    return str;
  }
  let start = str.length - n;
  if (start > 0 && isLowSurrogate(str.charCodeAt(start))) {
    start += 1;
  }
  return str.slice(start);
}

function execOutputPath(spillId: string, stream: 'stdout' | 'stderr'): string {
  return nodePath.join(EXEC_OUTPUT_ROOT, EXEC_OUTPUT_SUBDIR, `${spillId}.${stream}.txt`);
}

export class StreamCapture {
  private readonly decoder = new StringDecoder('utf8');
  private readonly headBudget: number;
  private readonly tailBudget: number;
  private head = '';
  private tail = '';
  private full: string | null = '';
  private rawBuffer: Buffer[] | null = [];
  private spillStream: ReturnType<typeof createWriteStream> | null = null;
  private spilledBytes = 0;
  private spillFinished: Promise<void> | null = null;
  totalChars = 0;
  truncated = false;
  spillPath: string | null = null;
  spillError = false;
  spillCeilingHit = false;

  constructor(
    private readonly maxChars: number,
    private readonly makeSpillPath: () => string,
    private readonly spillCeilingBytes = SPILL_CEILING_BYTES
  ) {
    this.headBudget = Math.max(1, Math.floor(maxChars / 2));
    this.tailBudget = Math.max(1, maxChars - this.headBudget);
  }

  // Await the spill write-stream flushing to disk. Awaited before the fallback
  // resolves so the spill file named in the elision marker is fully written
  // (kept identical to the xiaoni-executor copy).
  async settled(): Promise<void> {
    if (this.spillFinished) {
      await this.spillFinished;
    }
  }

  push(chunk: Buffer): void {
    if (!this.spillError) {
      if (this.spillStream) {
        this.writeSpill(chunk);
      } else if (this.rawBuffer) {
        this.rawBuffer.push(chunk);
      }
    }
    this.ingest(this.decoder.write(chunk));
  }

  end(): void {
    this.ingest(this.decoder.end());
    if (this.spillStream) {
      try {
        this.spillStream.end();
      } catch {
        // best-effort flush
      }
      this.spillStream = null;
    }
  }

  private ingest(text: string): void {
    if (!text) {
      return;
    }
    this.totalChars += text.length;
    if (this.head.length < this.headBudget) {
      this.head = sliceHead(this.head + text, this.headBudget);
    }
    this.tail = sliceTail(this.tail + text, this.tailBudget);
    if (this.full !== null) {
      this.full += text;
    }
    if (!this.truncated && this.totalChars > this.maxChars) {
      this.truncated = true;
      this.full = null;
      this.openSpillAndFlush();
    }
  }

  private openSpillAndFlush(): void {
    if (this.spillError || this.spillStream) {
      return;
    }
    try {
      const target = this.makeSpillPath();
      mkdirSync(nodePath.dirname(target), { recursive: true });
      const stream = createWriteStream(target, { flags: 'w' });
      stream.on('error', () => {
        this.spillError = true;
        this.spillPath = null;
      });
      this.spillFinished = new Promise<void>((resolve) => {
        stream.on('close', () => resolve());
        stream.on('error', () => resolve());
      });
      this.spillStream = stream;
      this.spillPath = target;
      const buffered = this.rawBuffer || [];
      this.rawBuffer = null;
      for (const buf of buffered) {
        this.writeSpill(buf);
      }
    } catch {
      this.spillError = true;
      this.spillPath = null;
      this.rawBuffer = null;
    }
  }

  private writeSpill(chunk: Buffer): void {
    if (this.spillError || !this.spillStream) {
      return;
    }
    if (this.spilledBytes >= this.spillCeilingBytes) {
      this.spillCeilingHit = true;
      return;
    }
    try {
      const room = this.spillCeilingBytes - this.spilledBytes;
      const toWrite = chunk.length <= room ? chunk : chunk.subarray(0, room);
      this.spillStream.write(toWrite);
      this.spilledBytes += toWrite.length;
      if (toWrite.length < chunk.length) {
        this.spillCeilingHit = true;
      }
    } catch {
      this.spillError = true;
      this.spillPath = null;
    }
  }

  render(): string {
    if (!this.truncated) {
      return this.full ?? this.head;
    }
    const elided = Math.max(0, this.totalChars - this.head.length - this.tail.length);
    // Self-contained factual marker (mirror of the executor's StreamCapture.render):
    // marks WHERE the cut is and names the spill file, no re-read coaching. One
    // reference, at the cut; head+tail already keeps both ends inline.
    const ceilTag = this.spillCeilingHit
      ? `（文件在 ${Math.round(this.spillCeilingBytes / 1024 / 1024)}MB 处截断）`
      : '';
    const note = (this.spillError || !this.spillPath)
      ? `…[省略约 ${elided} 字符 · 写盘失败]…`
      : `…[省略约 ${elided} 字符 · 完整 ${this.spillPath}${ceilTag}]…`;
    return `${this.head}\n${note}\n${this.tail}`;
  }
}

export async function pruneExecOutput(root = EXEC_OUTPUT_ROOT, ttlDays = EXEC_OUTPUT_TTL_DAYS, now = Date.now()): Promise<number> {
  const dir = nodePath.join(root, EXEC_OUTPUT_SUBDIR);
  let entries: string[];
  try {
    entries = await fsReaddir(dir);
  } catch {
    return 0;
  }
  const cutoff = now - ttlDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const entry of entries) {
    if (!entry.endsWith('.txt')) {
      continue;
    }
    const full = nodePath.join(dir, entry);
    try {
      const info = await fsStat(full);
      if (info.mtimeMs < cutoff) {
        await fsRm(full, { force: true });
        removed += 1;
      }
    } catch {
      // ignore individual file errors
    }
  }
  return removed;
}

function resolveExecShellArgs(shell: string, cmd: string, login: boolean) {
  const shellName = shell.split(/[\\/]/).pop() || shell;
  if (login && (shellName === 'bash' || shellName === 'zsh')) {
    return ['-lc', cmd];
  }
  return ['-c', cmd];
}

// Local-dev fallback for read_file — MUST stay behaviourally in sync with
// readFileRange in modules/xiaoni-executor/src/index.ts. Only runs when the
// executor URL is unset (dev/tests). Prod always routes to the executor, which
// additionally does /app path translation; here we read the path as given.
async function readFileRangeLocal(args: {
  path?: unknown; offset?: unknown; limit?: unknown; max_output_tokens?: unknown;
}): Promise<Record<string, unknown>> {
  const rawPath = typeof args.path === 'string' ? args.path.trim() : '';
  const offset = clampNumber(args.offset, 1, 1, Number.MAX_SAFE_INTEGER);
  const limit = clampNumber(args.limit, 200, 1, 100_000);
  const maxOutputTokens = clampNumber(args.max_output_tokens, 10_000, 2000, 200_000);
  const maxChars = Math.max(1, maxOutputTokens * 4);
  const build = (target: string, extra: Record<string, unknown> & { codex_output: string }) => ({
    path: target, offset, limit, total_lines: 0, returned_lines: 0, truncated: false, ...extra
  });
  if (!rawPath) {
    return build('', { error_message: 'read_file requires path', codex_output: '[read_file 需要 path]' });
  }
  let content: string;
  try {
    const info = await fsStat(rawPath);
    if (info.isDirectory()) {
      return build(rawPath, { error_message: 'path is a directory', codex_output: `[不是文件,是目录: ${rawPath}]` });
    }
    content = await fsReadFile(rawPath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    const msg = code === 'ENOENT' ? `文件不存在: ${rawPath}` : (error instanceof Error ? error.message : String(error));
    return build(rawPath, { error_message: msg, codex_output: `[${msg}]` });
  }
  const lines = content.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  const totalLines = lines.length;
  if (totalLines === 0) {
    return build(rawPath, { total_lines: 0, codex_output: '(空文件)' });
  }
  const start = offset - 1;
  if (start >= totalLines) {
    return build(rawPath, { total_lines: totalLines, codex_output: `(offset ${offset} 超过文件末尾，共 ${totalLines} 行)` });
  }
  const slice = lines.slice(start, start + limit);
  const width = String(start + slice.length).length;
  const numbered: string[] = [];
  let charCount = 0;
  let truncated = false;
  let stoppedLineNo = start + slice.length;
  for (let i = 0; i < slice.length; i += 1) {
    const lineNo = start + i + 1;
    const rendered = `${String(lineNo).padStart(width)}\t${slice[i]}`;
    if (numbered.length === 0 && rendered.length > maxChars) {
      numbered.push(`${sliceHead(rendered, maxChars)} …[该行过长已截断]`);
      truncated = true;
      stoppedLineNo = lineNo;
      break;
    }
    if (numbered.length > 0 && charCount + rendered.length + 1 > maxChars) {
      truncated = true;
      stoppedLineNo = lineNo - 1;
      break;
    }
    numbered.push(rendered);
    charCount += rendered.length + 1;
  }
  let body = numbered.join('\n');
  if (truncated) {
    const kb = Math.round(maxChars / 1024);
    body += `\n…[超 ${kb}KB，读到第 ${stoppedLineNo} 行止；继续 read_file(offset=${stoppedLineNo + 1})]…`;
  }
  return build(rawPath, { total_lines: totalLines, returned_lines: numbered.length, truncated, codex_output: body });
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
  originalTokenCount?: number;
  spillNote?: string;
}) {
  // Minimal envelope — MUST stay byte-for-byte identical to the live path,
  // formatCodexOutput in modules/xiaoni-executor/src/index.ts. On the plain happy
  // path return the raw bytes with ZERO header; metadata is one compact status
  // line only when actionable; chunkId / wall-time / token-count are debug fields
  // that never enter her context. Truncation carries its spill path inline in the
  // elision marker (see the StreamCapture.render mirror below); `spillNote` is only
  // an out-of-band caveat appended as a single trailing line when present.
  let status: string | null = null;
  if (input.blocked) {
    status = '[已被执行器策略拦截]';
  } else if (input.running) {
    // Factual only (mirror of the executor): the model does not poll via
    // exec_command; agent-service drives /sessions/<id>/poll.
    status = `[会话 ${input.sessionId || ''} 运行中]`;
  } else if (typeof input.exitCode === 'number') {
    status = input.exitCode === 0 ? null : `[exit ${input.exitCode}]`;
  } else if (input.signal) {
    status = `[signal ${input.signal}]`;
  } else {
    status = '[无退出码]';
  }
  const body = input.output.length > 0
    ? input.output
    : (status ? '' : '(exec_command 无输出)');
  const trailer = input.truncated && input.spillNote ? input.spillNote : null;
  return [status, body, trailer]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join('\n');
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
  source: 'inbound_batch' | 'sensory_event';
  runId: string;
  traceId: string;
}> {
  if (isPromptFacingRuntimeReminderPayload(queueMessage)) {
    return [];
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

function buildLeaseReleaseRecord(params: {
  reason: LeaseReleaseReason;
  detail?: string | null;
  outcome?: string | null;
  noVisibleDelivery: boolean;
  visibleDeliveryCommitted: boolean;
  source: string;
  toolResult?: Record<string, unknown>;
}): LeaseReleaseRecord {
  return {
    event_kind: 'lease_released',
    reason: params.reason,
    detail: params.detail ?? null,
    outcome: params.outcome ?? null,
    no_visible_delivery: params.noVisibleDelivery,
    visible_delivery_committed: params.visibleDeliveryCommitted,
    source: params.source,
    ...(params.toolResult ? { tool_result: params.toolResult } : {})
  };
}

function buildAssistantTranscriptItems(params: {
  queueMessage: QueueMessageRecord['payload'];
  deliveredMessages: DeliveredAssistantMessage[];
  leaseReleased: boolean;
}): ConversationTranscriptItem[] {
  if (params.deliveredMessages.length === 0) {
    return [];
  }

  return params.deliveredMessages.map((message, index) => {
    const isFinalMessage = params.leaseReleased && index === params.deliveredMessages.length - 1;
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

function formatSystemReminderBlock(body: string) {
  return formatTaggedBlock('system_reminder', {}, String(body || '').trim());
}

function extractTaggedBlockBody(content: string, tagName: string) {
  const normalized = String(content || '').trim();
  const pattern = new RegExp(`^<${tagName}(?:\\s[^>]*)?>\\n?([\\s\\S]*?)\\n?</${tagName}>$`);
  const match = normalized.match(pattern);
  return match ? match[1].trim() : normalized;
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

function renderTranscriptItemForRuntimeContext(item: ConversationTranscriptItem): OpenResponseInputItem | null {
  const content = String(item.content || '').trim();
  if (!content) {
    return null;
  }

  if (item.role === 'assistant') {
    return null;
  }

  return buildUserSceneInputItem([
    content.startsWith('<INPUT_MESSAGE')
      ? sanitizeInputMessageTags(content)
      : content
  ]);
}

// 主 agent 的续航提醒。**这条路径不许动** —— 它的产物经 buildSelfContinuationInputItem 冻结进
// stack(content.system_reminder)，是主 run replay 要逐字节重建的东西。空转计数/升级段绝不能从这里进去。
function renderSelfContinuationReminder() {
  return formatSystemReminderBlock(readPromptSnippet('self_continuation_reminder.md'));
}

// 自驱动 fork 的引导 prompt。与主 agent 的续航提醒【同源不同路】：
//  - 不升级时：直接返回 renderSelfContinuationReminder() 本身 → 与主 agent 结构性逐字节一致，
//    不是靠复制一份文案再比对(那样迟早漂)。
//  - 升级时：在同一个 system_reminder 块里追加升级段。这段【只】出现在 fork 的尾部追加 item 里，
//    fork 请求带 no_persist、不写 stack、不进主 run replay → 主 agent 永远看不到计数这回事。
//  - 工具契约段(IDLE_PLAN_SKILL_SUBMISSION_ENABLED)：同样只进 fork 尾部。开关 ON 时才渲染，因为
//    「只放行 xiaoni-plan」这句话只有在执行层真的放行之后才是真的；两者共用一个开关就是为了让
//    prompt 说的和执行层做的永远一致(fork 11905 烧两个 turn 撞墙，就是因为正文里根本没写规则)。
function renderSubconsciousForkReminder(params: {
  idleRounds: number;
  lastPlanText: string | null;
}) {
  const escalating = shouldEscalateSubconsciousFork(params);
  if (!escalating && !IDLE_PLAN_SKILL_SUBMISSION_ENABLED) {
    // 两段都不追加时，走与主 agent 结构性同源的那一份，逐字节零变化。
    return renderSelfContinuationReminder();
  }
  const sections = [readPromptSnippet('self_continuation_reminder.md')];
  if (IDLE_PLAN_SKILL_SUBMISSION_ENABLED) {
    // 用法走【和主 agent 学 skill 完全同一个机制】:主 agent 尾部有 <skills_instructions>
    // (`:2281`),fork 尾部就放一个 fork-only 的 <internal_skills_instructions>。
    // 不另造运行时读取(让她先 `cat` 手册再跑):那要多一次工具调用、多开一条命令白名单,
    // 还要求手册文件在 executor 那侧真的存在 —— 三样成本换的东西,这个块直接就给了。
    sections.push(renderPromptSnippet('subconscious_fork_skill_instructions.md', {
      XIAONI_PLAN_SKILL_BIN
    }));
    sections.push(readPromptSnippet('subconscious_fork_tool_contract.md'));
  }
  if (escalating) {
    sections.push(renderPromptSnippet('subconscious_fork_idle_escalation.md', {
      IDLE_ROUNDS: String(params.idleRounds),
      LAST_XIAONI_PLAN: String(params.lastPlanText)
    }));
  }
  return formatSystemReminderBlock(sections.join('\n\n'));
}

// 没交出 plan 那一轮追加的纠正提示。它是 developer item —— 在 wire 上映射成 user turn，所以
// 下一轮请求的尾巴永远是 user turn，`assistant message prefill` 400 从结构上不可能再发生。
// 提交口径随开关走：OFF 时仍是「写进 <xiaoni_plan> 收工」，ON 时是「必须用 skill 交」。
// 两种口径的文案都落在 docs/xiaoni_prompt/ 下(她看得见的字一律不硬编码在 TS 里)，这里只选文件。
function renderSubconsciousPlanCorrection() {
  return formatSystemReminderBlock(renderPromptSnippet('subconscious_plan_correction.md', {
    SUBMIT_INSTRUCTION: readPromptSnippet(
      IDLE_PLAN_SKILL_SUBMISSION_ENABLED
        ? 'subconscious_plan_submit_skill.md'
        : 'subconscious_plan_submit_inline.md'
    )
  }));
}

// 测试出线口：两条路径都要能被直接对拍，隔离专项断言(主 agent 那份不许因 fork 升级而变)靠它。
export function renderSubconsciousForkReminderForTest(params: {
  idleRounds: number;
  lastPlanText: string | null;
}) {
  return renderSubconsciousForkReminder(params);
}

export function renderSubconsciousPlanCorrectionForTest() {
  return renderSubconsciousPlanCorrection();
}

export function renderSelfContinuationReminderForTest() {
  return renderSelfContinuationReminder();
}

function renderSubconsciousAgentNotify(finalAnswerText: string) {
  return renderPromptSnippet('subconscious_agent_notify.md', {
    SUBCONSCIOUS_FINAL_ANSWER: finalAnswerText
  }).trim();
}

// 外部投递口的入参约束。source_system 会逐字进她的上下文，所以必须收窄字符集;text 上限防止
// 一次投递把整条 message tier 撑爆(超限直接 400，不截断——截断会让投递方以为送到了)。
const EXTERNAL_NOTIFY_MAX_TEXT_LENGTH = 4000;
const EXTERNAL_NOTIFY_SOURCE_SYSTEM_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

// 外部投递 notify 的正文。来源标记机械拼在最前面 —— 正文本身完全由投递方(小腻自己写的 skill)
// 组织，运行时不做任何加工。模板里绝不放时间戳:报时是 clock_ping 的职责，这里塞戳会让下一 run
// 的 replay 对不上冻结字节。
export function renderExternalNotify(sourceSystem: string, text: string) {
  return renderPromptSnippet('external_notify.md', {
    SOURCE_SYSTEM: sourceSystem,
    TEXT: text
  }).trim();
}

function buildSelfContinuationInputItem(): OpenResponseInputItem {
  return buildUserSceneInputItem([renderSelfContinuationReminder()]);
}

function isOpenResponseMessageInputItem(item: OpenResponseInputItem | undefined): item is Extract<OpenResponseInputItem, { type: 'message' }> {
  if (!item || item.type !== 'message') {
    return false;
  }
  const candidate = item as {
    role?: unknown;
    content?: unknown;
  };
  return typeof candidate.role === 'string'
    && (typeof candidate.content === 'string' || Array.isArray(candidate.content));
}

function isAssistantFinalAnswerInputItem(item: OpenResponseInputItem | undefined): boolean {
  return Boolean(isOpenResponseMessageInputItem(item) && item.role === 'assistant' && item.phase === 'final_answer');
}

// A prior turn's assistant TEXT output (a `message` item — final_answer / commentary
// narration like "等小伊接。", incl. inline <xiaoni_os>). It is still recorded to the
// stack and shown in the action-stream card, but it is NOT replayed back into context on
// any build (buildInitialInput strips it unconditionally): replaying her idle narration
// makes a "摸鱼"/等待 decision self-reinforce turn after turn (the model reads its own
// "我先等着" and keeps waiting). Stripping on every build (main loop, heartbeat,
// self-driven fork) keeps one shared cache-warm prefix. Tool calls and their outputs
// (function_call / function_call_output) are NOT text — they carry what she actually did
// and said, so they stay and tool continuity is preserved. The self-driven fork still
// needs the latest narration to plan the next direction, so it re-injects the most recent
// D at its TAIL (buildSubconsciousAgentForkRequest), not via the shared prefix.
function isAssistantTextOutputReplayItem(item: OpenResponseInputItem | undefined): boolean {
  return Boolean(isOpenResponseMessageInputItem(item) && item.role === 'assistant');
}

// The self-driven-fork idle gate used to read the last item of the (suppress-mode)
// requestInput. Now that assistant text (D) is stripped from every replay, requestInput
// no longer ends in a final_answer, so the gate reads the RAW history instead: did the
// most recent turn settle on an assistant final_answer (i.e. she is idle)?
function lastHistoryTurnEndsWithAssistantFinalAnswer(history: ConversationTurn[]): boolean {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const replay = buildTurnResponseReplayItems(history[index] as StackBackedConversationTurn);
    if (replay.length === 0) {
      continue;
    }
    return isAssistantFinalAnswerInputItem(replay[replay.length - 1]);
  }
  return false;
}

function shouldAllowSelfContinuationOnTerminalFinalAnswer(
  options: ReturnType<typeof normalizeRuntimeFrameOptions>
): boolean {
  return !options.queueBacked
    && options.triggerInputMode === 'suppress_current_trigger';
}

function isPhoneNotificationDirectCueMessage(
  queueMessage: QueueMessageRecord['payload'],
  message: QueueBatchMessage
) {
  return message.source === 'phone_notification'
    || message.inboundContext?.Surface === 'phone_notification'
    || queueMessage.source === 'phone_notification'
    || queueMessage.chatType === 'direct'
    || Boolean(message.wasMentioned || message.inboundContext?.WasMentioned);
}

function truncateNotificationSummary(text: string, maxChars = 20) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  const chars = Array.from(normalized);
  return chars.length > maxChars
    ? `${chars.slice(0, maxChars).join('')}...`
    : normalized;
}

function resolvePhoneNotificationCueIdentity(
  queueMessage: QueueMessageRecord['payload'],
  message: QueueBatchMessage
) {
  const isNotificationMessage = message.source === 'phone_notification'
    || message.inboundContext?.Surface === 'phone_notification';
  const rawPayload = message.rawPayload || {};
  const messageChatType = message.chatType === 'direct' || message.inboundContext?.ChatType === 'direct'
    ? 'direct'
    : (message.chatType === 'group' || message.inboundContext?.ChatType === 'group'
      ? 'group'
      : queueMessage.chatType);
  if (!isNotificationMessage) {
    return {
      senderId: message.senderId,
      senderName: message.senderName
    };
  }

  const contextSenderId = typeof message.inboundContext?.SenderId === 'string'
    ? message.inboundContext.SenderId.trim()
    : '';
  const contextSenderName = typeof message.inboundContext?.SenderName === 'string'
    ? message.inboundContext.SenderName.trim()
    : '';
  const rawSenderId = typeof rawPayload.latest_sender_id === 'string' && rawPayload.latest_sender_id.trim()
    ? rawPayload.latest_sender_id.trim()
    : typeof rawPayload.source_sender_id === 'string' && rawPayload.source_sender_id.trim()
      ? rawPayload.source_sender_id.trim()
      : '';
  const rawSenderName = typeof rawPayload.latest_sender_name === 'string' && rawPayload.latest_sender_name.trim()
    ? rawPayload.latest_sender_name.trim()
    : typeof rawPayload.source_sender_name === 'string' && rawPayload.source_sender_name.trim()
      ? rawPayload.source_sender_name.trim()
      : '';
  const messagePeerId = messageChatType === 'direct' && typeof message.peerId === 'string'
    ? message.peerId.trim()
    : '';
  const messagePeerName = messageChatType === 'direct' && typeof message.peerName === 'string'
    ? message.peerName.trim()
    : '';
  const notificationPeerId = messageChatType === 'direct' && typeof queueMessage.phoneNotification?.peerId === 'string'
    ? queueMessage.phoneNotification.peerId.trim()
    : '';
  const notificationPeerName = messageChatType === 'direct' && typeof queueMessage.phoneNotification?.peerName === 'string'
    ? queueMessage.phoneNotification.peerName.trim()
    : '';

  return {
    senderId: rawSenderId || contextSenderId || messagePeerId || notificationPeerId || message.senderId,
    senderName: rawSenderName || contextSenderName || messagePeerName || notificationPeerName || message.senderName
  };
}

function phoneNotificationMessageSummary(message: QueueBatchMessage) {
  const rawPayload = message.rawPayload || {};
  const rawPreview = rawPayload.source_preview ?? rawPayload.latest_preview;
  if (typeof rawPreview === 'string' && rawPreview.trim()) {
    return truncateNotificationSummary(
      normalizeTranscriptMessageText(rawPreview, message.inboundContext?.MentionedUsers)
    );
  }
  // 通知类消息的 bodyForAgent/RawBody 被 provider 故意写成了「群X 有 N 条新消息」这种
  // 身份摘要句(见 inbound-agent-trigger buildPhoneNotificationMessage / 聚合 buildAggregatedMessage)。
  // 消息摘要只能取干净正文预览(source_preview/latest_preview);正文为空(图片/表情等)就返回空,
  // 由调用方回退到「无摘要」,绝不拿身份句当摘要 → 避免摘要与昵称/群名/条数重复。
  const isNotificationMessage = message.source === 'phone_notification'
    || message.inboundContext?.Surface === 'phone_notification';
  if (isNotificationMessage) {
    return '';
  }
  return truncateNotificationSummary(
    normalizeTranscriptMessageText(message.bodyForAgent || '', message.inboundContext?.MentionedUsers)
  );
}

function buildPhoneNotificationDirectCueLines(queueMessage: QueueMessageRecord['payload']) {
  const grouped = new Map<string, {
    kind: 'direct' | 'group_mention' | 'group_activity';
    groupId?: string;
    groupName?: string;
    senderId: string;
    senderName?: string;
    count: number;
    latestSummary: string;
    latestSenderId?: string;
    latestSenderName?: string;
  }>();

  for (const message of queueMessage.messages) {
    if (!isPhoneNotificationDirectCueMessage(queueMessage, message)) {
      continue;
    }
    const wasMentioned = Boolean(message.wasMentioned || message.inboundContext?.WasMentioned);
    const messageChatType = message.chatType === 'direct' || message.inboundContext?.ChatType === 'direct'
      ? 'direct'
      : (message.chatType === 'group' || message.inboundContext?.ChatType === 'group'
        ? 'group'
        : queueMessage.chatType);
    const identity = resolvePhoneNotificationCueIdentity(queueMessage, message);
    const contextGroupId = typeof message.inboundContext?.NativeChannelId === 'string'
      ? message.inboundContext.NativeChannelId.trim()
      : '';
    const contextGroupName = typeof message.inboundContext?.GroupSubject === 'string'
      ? message.inboundContext.GroupSubject.trim()
      : '';
    const groupId = messageChatType === 'group'
      ? String(message.peerId || contextGroupId || queueMessage.phoneNotification?.peerId || queueMessage.peerId || '').trim()
      : '';
    const groupName = messageChatType === 'group'
      ? String(message.peerName || contextGroupName || queueMessage.phoneNotification?.peerName || queueMessage.peerName || '').trim()
      : '';
    const kind = messageChatType === 'direct'
      ? 'direct'
      : (wasMentioned ? 'group_mention' : 'group_activity');
    const key = kind === 'group_activity'
      ? `group_activity:${groupId || groupName || 'unknown'}`
      : (kind === 'group_mention'
        ? `group_mention:${groupId || groupName || 'unknown'}:${identity.senderId || identity.senderName || 'unknown'}`
        : `direct:${identity.senderId || identity.senderName || message.peerId || 'unknown'}`);
    const current = grouped.get(key) || {
      kind,
      groupId,
      groupName,
      senderId: identity.senderId,
      senderName: identity.senderName,
      count: 0,
      latestSummary: '',
      latestSenderId: identity.senderId,
      latestSenderName: identity.senderName
    };
    current.count += 1;
    const summary = phoneNotificationMessageSummary(message);
    if (summary) {
      current.latestSummary = summary;
      current.latestSenderId = identity.senderId;
      current.latestSenderName = identity.senderName;
    }
    grouped.set(key, current);
  }

  return Array.from(grouped.values()).map((entry) => {
    const identity = formatIdentity(entry.senderName, entry.senderId);
    const latest = entry.latestSummary || '无摘要';
    if (entry.kind === 'direct') {
      return renderPromptSnippet('phone_notification_direct_cue_line.md', {
        IDENTITY: identity,
        COUNT: entry.count,
        LATEST_SUMMARY: latest
      });
    }
    const group = formatIdentity(entry.groupName, entry.groupId || queueMessage.peerId);
    if (entry.kind === 'group_mention') {
      return renderPromptSnippet('phone_notification_group_mention_cue_line.md', {
        GROUP_IDENTITY: group,
        IDENTITY: identity,
        COUNT: entry.count,
        LATEST_SUMMARY: latest
      });
    }
    const latestSender = formatIdentity(entry.latestSenderName, entry.latestSenderId);
    return renderPromptSnippet('phone_notification_group_activity_cue_line.md', {
      GROUP_IDENTITY: group,
      COUNT: entry.count,
      LATEST_SENDER: latestSender,
      LATEST_SUMMARY: latest
    });
  });
}

function renderPhoneNotification(queueMessage: QueueMessageRecord['payload']) {
  const notification = queueMessage.phoneNotification;
  const unreadDelta = Math.max(
    1,
    Number(notification?.unreadDelta || 0),
    queueMessage.messages.length || 0
  );
  const directCueLines = buildPhoneNotificationDirectCueLines(queueMessage);
  if (directCueLines.length === 0) {
    return '';
  }
  return formatSystemReminderBlock(renderPromptSnippet('phone_notification_reminder.md', {
    UNREAD_DELTA: unreadDelta,
    DIRECT_CUE_LINES: directCueLines.join('\n')
  }));
}

function renderImageTaskNotification(queueMessage: QueueMessageRecord['payload']) {
  const notification = queueMessage.imageTaskNotification;
  const taskId = notification?.taskId || queueMessage.rawPayload?.task_id || 'unknown';
  const taskStatus = notification?.taskStatus || queueMessage.rawPayload?.task_status || 'completed';
  const taskType = notification?.taskType || queueMessage.rawPayload?.task_type;
  const pictureId = notification?.pictureId || queueMessage.rawPayload?.picture_id;
  const picturePath = notification?.picturePath || queueMessage.rawPayload?.picture_path;
  const targetDescription = notification?.targetDescription || queueMessage.rawPayload?.target_description;
  const variables = {
    TASK_ID: String(taskId),
    TASK_RESULT: taskStatus === 'completed' ? '已完成' : String(taskStatus),
    TASK_TYPE_LINE: taskType ? `任务类型: ${taskType}` : '',
    PICTURE_ID_LINE: pictureId ? `图片ID: ${pictureId}` : '',
    PICTURE_PATH_LINE: picturePath ? `图片路径: ${picturePath}` : '',
    TARGET_DESCRIPTION_LINE: targetDescription ? `目标: ${targetDescription}` : ''
  };
  const emptyOptionalPlaceholders = [
    taskType ? null : 'TASK_TYPE_LINE',
    pictureId ? null : 'PICTURE_ID_LINE',
    picturePath ? null : 'PICTURE_PATH_LINE',
    targetDescription ? null : 'TARGET_DESCRIPTION_LINE'
  ].filter((value): value is string => typeof value === 'string');
  const template = removePlaceholderOnlyLines(
    readPromptSnippet('image_task_notification.md'),
    emptyOptionalPlaceholders
  );
  const body = renderPromptTemplateText(template, variables).trimEnd();
  return formatSystemReminderBlock(body);
}

function renderImageTaskPendingStatusText(params: {
  taskId: string | null;
  taskType: 'image_edit' | 'image_generate';
  requestedTaskType: 'image_edit' | 'image_generate';
  targetDescription: string | null;
}) {
  const requestedTaskTypeLine = params.requestedTaskType !== params.taskType
    ? `请求类型: ${params.requestedTaskType}`
    : '';
  const targetDescriptionLine = params.targetDescription
    ? `目标: ${params.targetDescription}`
    : '';
  const template = removePlaceholderOnlyLines(
    readPromptSnippet('image_task_pending.md'),
    [
      requestedTaskTypeLine ? null : 'REQUESTED_TASK_TYPE_LINE',
      targetDescriptionLine ? null : 'TARGET_DESCRIPTION_LINE'
    ].filter((value): value is string => typeof value === 'string')
  );
  return renderPromptTemplateText(template, {
    TASK_ID: params.taskId || 'unknown',
    TASK_TYPE: params.taskType,
    REQUESTED_TASK_TYPE_LINE: requestedTaskTypeLine,
    TARGET_DESCRIPTION_LINE: targetDescriptionLine
  }).trimEnd();
}

function normalizeAttentionLeasePreview(value: unknown) {
  return truncateNotificationSummary(typeof value === 'string' ? value : '', 20) || '无摘要';
}

function normalizeAttentionLeaseSenderLabel(queueMessage: QueueMessageRecord['payload']) {
  const rawPayload = queueMessage.rawPayload || {};
  const senderName = typeof rawPayload.source_sender_name === 'string' && rawPayload.source_sender_name.trim()
    ? rawPayload.source_sender_name.trim()
    : typeof rawPayload.latest_sender_name === 'string' && rawPayload.latest_sender_name.trim()
      ? rawPayload.latest_sender_name.trim()
      : '';
  const senderId = typeof rawPayload.source_sender_id === 'string' && rawPayload.source_sender_id.trim()
    ? rawPayload.source_sender_id.trim()
    : typeof rawPayload.latest_sender_id === 'string' && rawPayload.latest_sender_id.trim()
      ? rawPayload.latest_sender_id.trim()
      : '';
  if (senderName && senderId && senderName !== senderId) {
    return `${senderName}(${senderId})`;
  }
  return senderName || senderId || queueMessage.senderName || queueMessage.senderId || '未知发送者';
}

function buildAttentionLeaseTemplateVariables(queueMessage: QueueMessageRecord['payload']) {
  const rawPayload = queueMessage.rawPayload || {};
  const unreadDelta = Number(rawPayload.unread_delta ?? rawPayload.unreadDelta ?? 1) || 1;
  const directMentions = Number(rawPayload.direct_mentions ?? rawPayload.directMentions ?? 0) || 0;
  const focusTarget = typeof rawPayload.focus_target === 'string' && rawPayload.focus_target.trim()
    ? rawPayload.focus_target.trim()
    : queueMessage.chatType === 'direct'
      ? `focus_private ${queueMessage.peerId}`
      : `focus_group ${queueMessage.peerId}`;
  const [focusTargetAction, ...focusTargetIdParts] = focusTarget.split(/\s+/);
  return {
    UNREAD_DELTA: unreadDelta,
    DIRECT_MENTION_COUNT: directMentions,
    LATEST_SENDER_LABEL: normalizeAttentionLeaseSenderLabel(queueMessage),
    // 摘要只取干净正文预览字段。绝不回退到 rawBody/bodyForAgent——通知类 queue message 的这两个
    // 字段按 provider 设计可能装着身份句「群X 有 N 条新消息」,回退会让摘要与昵称/群名共用
    // (同 phone_notification 已修的那类)。source_preview 恒有值(空正文→'无摘要'),空则由
    // normalizeAttentionLeasePreview 兜「无摘要」。
    LATEST_MESSAGE_PREVIEW: normalizeAttentionLeasePreview(
      rawPayload.source_preview ?? rawPayload.latest_preview
    ),
    FOCUS_TARGET_ACTION: focusTargetAction || (queueMessage.chatType === 'direct' ? 'focus_private' : 'focus_group'),
    FOCUS_TARGET_ID: focusTargetIdParts.join(' ') || queueMessage.peerId
  };
}

function renderAttentionLeaseReminder(queueMessage: QueueMessageRecord['payload']) {
  const rawPayload = queueMessage.rawPayload || {};
  const chatPrefix = queueMessage.chatType === 'direct' ? '私聊' : '群';
  const chatLabel = typeof rawPayload.chat_label === 'string' && rawPayload.chat_label.trim()
    ? rawPayload.chat_label.trim()
    : `${chatPrefix} ${formatTagSpeaker(queueMessage.peerName, queueMessage.peerId)}`;
  return formatSystemReminderBlock(renderPromptSnippet('attention_lease_reminder.md', {
    CHAT_LABEL: chatLabel,
    ...buildAttentionLeaseTemplateVariables(queueMessage)
  }));
}

function getSystemReminderText(queueMessage: QueueMessageRecord['payload']) {
  const reminder = typeof queueMessage.systemReminder?.reminder === 'string' && queueMessage.systemReminder.reminder.trim()
    ? queueMessage.systemReminder.reminder.trim()
    : typeof queueMessage.bodyForAgent === 'string'
      ? queueMessage.bodyForAgent.trim()
      : '';
  return reminder;
}

function renderSystemReminder(queueMessage: QueueMessageRecord['payload']) {
  if ((queueMessage.systemReminder?.reason || queueMessage.rawPayload?.reason) === 'attention_lease') {
    return renderAttentionLeaseReminder(queueMessage);
  }
  const reminder = getSystemReminderText(queueMessage);
  return formatSystemReminderBlock(
    reminder || readPromptSnippet('system_reminder_fallback.md')
  );
}

function renderSubconsciousAgentNotifyPayload(queueMessage: QueueMessageRecord['payload']) {
  const reminder = getSystemReminderText(queueMessage);
  if (reminder) {
    return reminder;
  }
  const finalAnswerText = typeof queueMessage.rawPayload?.final_answer_text === 'string'
    ? queueMessage.rawPayload.final_answer_text.trim()
    : '';
  return finalAnswerText
    ? renderSubconsciousAgentNotify(finalAnswerText)
    : '';
}

function buildQueueMessagePayloadForBatchMessage(
  queueMessage: QueueMessageRecord['payload'],
  message: QueueBatchMessage
): QueueMessageRecord['payload'] {
  const messagePhoneNotification = typeof message.rawPayload?.phoneNotification === 'object' && message.rawPayload.phoneNotification
    ? message.rawPayload.phoneNotification as QueueMessageRecord['payload']['phoneNotification']
    : undefined;
  const messageImageTaskNotification = typeof message.rawPayload?.imageTaskNotification === 'object' && message.rawPayload.imageTaskNotification
    ? message.rawPayload.imageTaskNotification as QueueMessageRecord['payload']['imageTaskNotification']
    : undefined;
  const messageSystemReminder = typeof message.rawPayload?.systemReminder === 'object' && message.rawPayload.systemReminder
    ? message.rawPayload.systemReminder as QueueMessageRecord['payload']['systemReminder']
    : undefined;
  return {
    ...queueMessage,
    source: message.source,
    chatType: message.chatType,
    sessionKey: message.sessionKey,
    peerId: message.peerId,
    peerName: message.peerName,
    senderId: message.senderId,
    senderName: message.senderName,
    accountId: message.accountId,
    bodyForAgent: message.bodyForAgent,
    rawBody: message.rawBody,
    commandBody: message.commandBody,
    wasMentioned: message.wasMentioned,
    receivedAt: message.receivedAt,
    messageTimestamp: message.messageTimestamp,
    rawPayload: message.rawPayload,
    inboundContext: message.inboundContext,
    messages: [message],
    ...(messagePhoneNotification ? { phoneNotification: messagePhoneNotification } : {}),
    ...(messageImageTaskNotification ? { imageTaskNotification: messageImageTaskNotification } : {}),
    ...(messageSystemReminder ? { systemReminder: messageSystemReminder } : {}),
    ...(!messagePhoneNotification ? { phoneNotification: undefined } : {}),
    ...(!messageImageTaskNotification ? { imageTaskNotification: undefined } : {}),
    ...(!messageSystemReminder ? { systemReminder: undefined } : {})
  };
}

type CurrentBucketMessageTemplateKind =
  | 'deleted_final_answer_reminder'
  | 'subconscious_agent_notify'
  | 'system_reminder'
  | 'image_task_notification'
  | 'phone_notification'
  | 'conversation_input';

function classifyCurrentBucketMessageTemplate(queueMessage: QueueMessageRecord['payload']) {
  if (isDeletedFinalAnswerReminderPayload(queueMessage)) {
    return 'deleted_final_answer_reminder';
  }
  if (isSubconsciousAgentNotifyPayload(queueMessage)) {
    return 'subconscious_agent_notify';
  }
  if (isSystemReminderPayload(queueMessage)) {
    return 'system_reminder';
  }
  if (isImageTaskNotificationPayload(queueMessage)) {
    return 'image_task_notification';
  }
  if (isPhoneNotificationPayload(queueMessage)) {
    return 'phone_notification';
  }
  return 'conversation_input';
}

function getPhoneNotificationForBatchMessage(message: QueueBatchMessage) {
  return typeof message.rawPayload?.phoneNotification === 'object' && message.rawPayload.phoneNotification
    ? message.rawPayload.phoneNotification as QueueMessageRecord['payload']['phoneNotification']
    : undefined;
}

function buildPhoneNotificationPayloadForBatchMessages(
  queueMessage: QueueMessageRecord['payload'],
  messages: QueueBatchMessage[]
): QueueMessageRecord['payload'] {
  const latest = messages[messages.length - 1];
  const basePayload = buildQueueMessagePayloadForBatchMessage(queueMessage, latest);
  const notifications = messages
    .map((message) => ({
      message,
      notification: getPhoneNotificationForBatchMessage(message)
    }))
    .filter((entry): entry is {
      message: QueueBatchMessage;
      notification: NonNullable<QueueMessageRecord['payload']['phoneNotification']>;
    } => Boolean(entry.notification));
  const latestNotification = notifications[notifications.length - 1]?.notification || basePayload.phoneNotification || queueMessage.phoneNotification;
  const uniqueNotifications = new Map<string, NonNullable<QueueMessageRecord['payload']['phoneNotification']>>();
  for (const { message, notification } of notifications) {
    uniqueNotifications.set(notification.notificationId || message.messageSid || String(message.queueMessageId), notification);
  }
  const unreadDelta = uniqueNotifications.size > 0
    ? Array.from(uniqueNotifications.values()).reduce((sum, notification) => sum + Math.max(1, Number(notification.unreadDelta || 1)), 0)
    : Math.max(1, Number(queueMessage.phoneNotification?.unreadDelta || basePayload.phoneNotification?.unreadDelta || 0), messages.length);
  const directMentions = uniqueNotifications.size > 0
    ? Array.from(uniqueNotifications.values()).reduce((sum, notification) => sum + Math.max(0, Number(notification.directMentions || 0)), 0)
    : Math.max(0, Number(queueMessage.phoneNotification?.directMentions || basePayload.phoneNotification?.directMentions || 0));

  return {
    ...basePayload,
    source: 'phone_notification',
    bodyForAgent: messages.map((message) => message.bodyForAgent).join('\n'),
    rawBody: messages.map((message) => message.rawBody).join('\n'),
    commandBody: messages.map((message) => message.commandBody).join('\n'),
    wasMentioned: messages.some((message) => message.wasMentioned),
    messages,
    ...(latestNotification
      ? {
          phoneNotification: {
            ...latestNotification,
            unreadDelta,
            directMentions
          }
        }
      : { phoneNotification: undefined })
  };
}

function renderCurrentBucketMessage(queueMessage: QueueMessageRecord['payload']) {
  if (isDeletedFinalAnswerReminderPayload(queueMessage)) {
    return '';
  }
  if (isSubconsciousAgentNotifyPayload(queueMessage)) {
    return renderSubconsciousAgentNotifyPayload(queueMessage);
  }
  if (isSystemReminderPayload(queueMessage)) {
    return renderSystemReminder(queueMessage);
  }
  if (isImageTaskNotificationPayload(queueMessage)) {
    return renderImageTaskNotification(queueMessage);
  }
  if (isPhoneNotificationPayload(queueMessage)) {
    return renderPhoneNotification(queueMessage);
  }
  return renderConversationInput(queueMessage);
}

function buildCurrentBucketMessageParts(queueMessage: QueueMessageRecord['payload']) {
  const messages = Array.isArray(queueMessage.messages) ? queueMessage.messages : [];
  if (messages.length <= 1) {
    const rendered = renderCurrentBucketMessage(queueMessage);
    return rendered.trim() ? [rendered] : [];
  }

  const groupedMessages: Array<{
    kind: CurrentBucketMessageTemplateKind;
    messages: QueueBatchMessage[];
  }> = [];
  for (const message of messages) {
    const messagePayload = buildQueueMessagePayloadForBatchMessage(queueMessage, message);
    const kind = classifyCurrentBucketMessageTemplate(messagePayload);
    const previous = groupedMessages[groupedMessages.length - 1];
    if (kind === 'phone_notification' && previous?.kind === kind) {
      previous.messages.push(message);
      continue;
    }
    groupedMessages.push({ kind, messages: [message] });
  }

  return groupedMessages
    .map((group) => {
      if (group.kind === 'phone_notification' && group.messages.length > 1) {
        return renderCurrentBucketMessage(buildPhoneNotificationPayloadForBatchMessages(queueMessage, group.messages));
      }
      return group.messages
        .map((message) => renderCurrentBucketMessage(buildQueueMessagePayloadForBatchMessage(queueMessage, message)))
        .join('\n\n');
    })
    .map((message) => message.trim())
    .filter(Boolean);
}

// Byte-stable, number-free compression instruction. Shared by the auto and manual
// dispatch paths so both build an identical fork tail. The cutoff math stays in
// code/metadata (planReadCutoffForForcedCompression) — the reminder only tells the
// summarizer WHAT to do, never WHERE the boundary is, so the precise tail-30 eviction
// is code-enforced and the reminder stays cache-stable.
const CORE_MEMORY_COMPRESSION_PRESSURE_SUMMARY =
  '把当前可压缩的稳定旧上下文整理成新的核心记忆近况，保留最近的衔接内容继续往下做。';

// Turn-budget safety net (Spec B): distillation (writing today's diary) must NEVER be able
// to block compression itself. If the fork exhausts its turn budget without ever writing the
// 近况 file, we DO NOT throw (that would leave the read cutoff un-advanced → context keeps
// growing → 413 / cache blowout). Instead we commit this deterministic minimal seam summary so
// the cutoff always advances. The real memory is safe on disk in today's diary (the fork was
// writing it turn by turn); <xiaoni_status> just needs to be non-empty and redirect her there.
// MUST stay byte-stable (no dates/counts): it is stored and replayed verbatim into the next
// main run, so any per-run drift would break run-boundary cache.
export const CORE_MEMORY_COMPRESSION_FALLBACK_SUMMARY =
  '（这轮记忆整理没能在限定步数内写完近况。最近这段的经历，我一条条落在了今天的日记里（/xiaoni-runtime/notes/diary/ 下按日期的那份）。醒来先 cat 一下今天的日记就能接上。）';

export function buildCoreMemoryCompressionReminder(input: {
  contextSessionKey: string;
  readCutoffAfterStackIndex: number | null;
  pressureSummary: string;
  // 时间线(B3):她写近况时手边的时间真值。渲染一次、随 fork 尾部下发。
  // windowStartedAt 取不到时退回单句醒来锚点(见 renderSleepTimelineBlock)。
  lastWakeAt?: string | null;
  windowStartedAt?: string | null;
  sleeps?: SleepSegment[];
  now?: Date;
}) {
  void input.readCutoffAfterStackIndex;
  void input.contextSessionKey;
  // No path here: the model runs the skill without --out; the skill mints a fresh unique
  // filename each round and prints XIAONI_COMPRESS_WROTE=<path>, which the fork loop reads back.
  // (Cache-wise this item is a non-durable fork-tail either way — the point of dropping the path
  // is to decouple the model from the filename, not a cache win.)
  // 格式规矩单一真理源:fragment core_memory_pressure_write_formats.md 渲染时嵌进
  // {{WRITE_FORMATS}}(与 phone_notification_*_cue_line 同一 fragment 装配模式,见
  // docs/remind.md「Template Fragments」)。提醒本体只留「这一轮做什么」,她不用为了
  // 查格式再 cat 一次锚点 skill。fragment 正文同样必须字节稳定(无日期/数字/时间戳)。
  //
  // {{TIME_GROUNDING}} 是这条提醒里【唯一】允许带戳的槽,渲染一次、随 fork 尾部下发:
  // runCoreMemoryCompressionFork 的 forkInput = [...clone(主请求).input, ...本项],所以本项
  // 整个落在共享暖前缀【之后】;fork 请求又是 store:false + no_persist,既不入栈也不 replay。
  // 跨压缩的字节稳定在这里买不到任何东西——它前面的主前缀每轮都已经变了,上一轮那条包含
  // 本项的缓存条目本来就死了。
  //
  // 给的是这段上下文覆盖范围内的真实睡眠时间线,不是一句禁令:原来那句「别自己推算,中间
  // 睡过几觉这段里看不出来」的前提是引擎不给,而 agent_recovery_sessions 里睡着/醒来两个
  // 时刻都记着。摆出来她就不用推,也不用被禁止推。
  const item = buildDeveloperInputItem([
    formatSystemReminderBlock(renderPromptSnippet('core_memory_pressure_reminder.md', {
      PRESSURE_SUMMARY: input.pressureSummary,
      TIME_GROUNDING: renderSleepTimelineBlock({
        windowStartedAt: input.windowStartedAt ?? null,
        sleeps: input.sleeps ?? [],
        lastWakeAt: input.lastWakeAt ?? null,
        now: input.now ?? new Date()
      }),
      XIAONI_MEMORY_COMPRESS_SKILL: XIAONI_MEMORY_COMPRESS_SKILL_DIR,
      // 只有 core_memory_pressure_reminder.md 用得到它(fork forced 那份只讲提交,不讲写入)。
      // 注意 renderPromptTemplateText 是单次 String.replace:{{WRITE_FORMATS}} 注入的 fragment
      // 正文里**不能**再出现 {{...}},替换文本不会被二次扫描。fragment 因此用 $M,由本文件
      // 渲染的 reminder 正文定义 M=<这个路径>。
      XIAONI_MEMORY_WRITE_SKILL: XIAONI_MEMORY_WRITE_SKILL_DIR,
      WRITE_FORMATS: renderPromptSnippet('core_memory_pressure_write_formats.md')
    }))
  ]);
  Object.defineProperty(item, CORE_MEMORY_COMPRESSION_REMINDER_MARKER, {
    value: true,
    enumerable: false
  });
  return item;
}

// Soft self-check for a text-only fork turn (she ran no tool this turn — she's winding down).
// Deliberately does NOT push the commit skill: it only prompts her to notice anything she meant
// to record before stopping. The firm "use the skill via stdin now" instruction is reserved for
// the forced zone at the turn budget (buildCoreMemoryCompressionForkForcedReminder). Non-durable
// developer role (fork tail), same as the other compression reminders — cache-safe.
export function buildCoreMemoryCompressionForkGapCheckReminder(): OpenResponseInputItem {
  return buildDeveloperInputItem([
    formatSystemReminderBlock('想想还有什么没记完？看看有没有遗漏。')
  ]);
}

// 压缩完成后向主 loop 显式 notify「刚整理过一次记忆」——补上小腻找回自己的最后一环:她已经有找回
// 自己的方法(system_prompt 指向 xiaoni-memory-anchor skill)和触发压缩的信号(pressure reminder,
// fork-only,压缩*前*),但压缩真正落地后没有任何东西告诉她「刚发生了一次压缩」。这条 notify 走
// 框架既有的 Notify Bucket:压缩提交时 enqueue 一条 system_reminder 队列消息(见
// enqueueCoreMemoryCompressionDoneNotify),之后由现有 notify 链路投递/落库/去重,和 subconscious
// notify 同一条路,缓存安全性直接继承既有铁律用例。
//
// 东八区时间戳在 ENQUEUE 时冻结进 systemReminder.reminder 文本(不是被删掉的合成 [当前时间] 前缀
// 戳:它只进这条尾部 notify、绝不进 cacheable system 前缀)。renderSystemReminder 消费时按 raw 文本
// 包 <system_reminder>,落库进 runtime_input 的 content.input_items,下一 run 逐字节 replay。
// Clock ping: the LIVE half of time grounding. <xiaoni_status> is frozen between compressions, so
// its wake anchor goes stale the moment she sleeps again; the reject reminder only fires when she
// tries to sleep. This is the unconditional one — every 2h she is handed the current time and the
// distance from her last real wake, so an elapsed-time belief can never drift for more than one
// interval before ground truth lands in the tail.
//
// Raw body only — renderSystemReminder wraps it in <system_reminder> at consume time. Both stamps
// are frozen HERE (enqueue time) into the persisted reminder text and never re-rendered per build,
// exactly like the compression-done notify above.
export function renderClockPingReminderText(now: Date, lastWakeAt: string | null): string {
  return renderPromptSnippet('clock_ping_notify.md', {
    NOW_EAST8: formatEast8Timestamp(now),
    AWAKE_ANCHOR: renderWakeAnchorSentence(lastWakeAt, now)
  })
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
}

// 2h wall-clock slot in East-8. Keying the dedupeKey to the SLOT (not to "now") makes the whole
// leg idempotent and self-healing: the supervisor can tick as often as it likes, a missed tick
// just skips that slot, and a duplicate tick is swallowed by the unique index. No timer chain to
// break, no drift to accumulate.
export function clockPingSlotId(now: Date, intervalMs: number): string {
  const slot = Math.floor((now.getTime() + 8 * 60 * 60 * 1000) / Math.max(1, intervalMs));
  return String(slot);
}

function renderCoreMemoryCompressionDoneReminderText(now: Date): string {
  // Raw body only — renderSystemReminder wraps it in <system_reminder> at consume time.
  return renderPromptSnippet('core_memory_compression_done_notify.md', {
    NOW_EAST8: formatEast8Timestamp(now)
  });
}

// Forced reminder: fired once the fork has used up its organizing budget (>= FORCE_TURNS). Hard
// tone — stop everything and use the commit skill NOW. Non-durable developer role (fork tail),
// same as the other compression reminders — cache-safe.
export function buildCoreMemoryCompressionForkForcedReminder(input: {
  forkTurn: number;
}): OpenResponseInputItem {
  return buildDeveloperInputItem([
    formatSystemReminderBlock(renderPromptSnippet('core_memory_compression_fork_forced_reminder.md', {
      FORK_TURN: input.forkTurn,
      XIAONI_MEMORY_COMPRESS_SKILL: XIAONI_MEMORY_COMPRESS_SKILL_DIR
    }))
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
  if (!isOpenResponseMessageInputItem(item)) return '';
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

function buildToolErrorResult(
  toolCall: Pick<AgentToolCall, 'name' | 'callId'>,
  error: unknown
): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    tool_error: true,
    tool_name: toolCall.name,
    tool_call_id: toolCall.callId,
    error_message: message,
    error: message,
    error_name: error instanceof Error && error.name ? error.name : null
  };
}

// A controlled "拒绝" (not an error): the model emitted a tool that is NOT permitted in the
// current context — a fork whose allowed-tool set excludes it, or the main loop's passive
// compress_core_memory. The tool is never executed; `rejection_output` is surfaced verbatim as
// the function_call_output text (see applyToolResultToLoopInput) so the agent reads a clear,
// in-character reason and self-corrects, instead of seeing a raw error or a silently-dropped call.
function buildToolRejectedResult(
  toolCall: Pick<AgentToolCall, 'name' | 'callId'>,
  rejectionOutput: string
): Record<string, unknown> {
  return {
    success: false,
    tool_rejected: true,
    tool_name: toolCall.name,
    tool_call_id: toolCall.callId,
    rejection_output: rejectionOutput,
    error_message: `tool not permitted in this context: ${toolCall.name}`
  };
}

// inspect_image_placeholder already resolves the image server-side and has its local
// executor-container path in hand (materialized.executorPath, see inspectImagePlaceholder),
// but the vision fork's output_xml is a DESCRIPTION only — that path is otherwise dropped.
// Append it as a compact machine-readable marker `localpath:<path>` so 小腻 can grab the on-disk
// path and hand it to $qq-send-image (or read/edit it) to forward/resend an image someone sent
// her. Without it she only holds an opaque media id and has no way to reach the file on disk.
// Deterministic and frozen into stack content (buildToolResultStackItems persists the rendered
// function_call_output verbatim), so live build == stack replay == fork clone → zero cache drift.
function appendInspectImageLocalPath(outputXml: string, toolResult: Record<string, unknown>): string {
  const rawPath = (toolResult as { executor_path?: unknown }).executor_path;
  const path = typeof rawPath === 'string' ? rawPath.trim() : '';
  if (path.startsWith('/')) {
    return `${outputXml}\nlocalpath:${path}`;
  }
  return outputXml;
}

// send_in_private / send_in_group 的模型可见回执：小腻只需要知道「发成功了没有」。
// 成功 → {ok:true, message_ids:[...]}（她偶尔要引用/定位自己刚发的那条）；
// 失败 → {ok:false, error, retryable?}。不再回灌整个 delivery / sent_messages /
// xiaoni_os / pending_share / second_beat_suppressed —— 那些是内部记账，内部消费者
// （extractDeliveredAssistantMessages、recordOutboundQqMessages、xiaoni_os strip、
// pending_share）读的是 toolResult 对象本身，不读这里的 output 串，所以不受影响。
// 输出对 toolResult 确定性（无时间戳/随机数）→ 写时冻结进 agent_stack_items.content、
// replay 逐字节读回、fork 克隆一致 → 零缓存漂移（历史 output 各按各的字节 replay）。
function buildSendToolOutput(toolResult: Record<string, unknown>): string {
  const failed = toolResult.tool_error === true
    || typeof toolResult.error_message === 'string'
    || typeof toolResult.error === 'string';
  if (failed) {
    const error = typeof toolResult.error_message === 'string' && toolResult.error_message
      ? toolResult.error_message
      : typeof toolResult.error === 'string' && toolResult.error
        ? toolResult.error
        : '发送失败';
    return JSON.stringify(toolResult.retryable === true
      ? { ok: false, error, retryable: true }
      : { ok: false, error });
  }
  const messageIds = extractDeliveryMessageIds(toolResult.delivery)
    .filter((id): id is number => typeof id === 'number');
  return JSON.stringify({ ok: true, message_ids: messageIds });
}

export function applyToolResultToLoopInput(
  toolCall: Pick<AgentToolCall, 'name' | 'callId' | 'rawArguments'>,
  toolResult: Record<string, unknown>,
  context?: ToolContinuationContext
): ToolContinuationAction {
  // Computer use returns a screenshot after every action; surface it as an
  // input_image content block (same shape the image-vision fork uses) so Claude
  // sees the new screen and continues the action loop.
  const computerImageContent = toolCall.name === TOOL_NAMES.computerUse
    && Array.isArray((toolResult as { image_content?: unknown }).image_content)
    ? (toolResult as { image_content: OpenResponseInputItem[] }).image_content
    : null;
  // A bare computer-use `screenshot` now persists the PNG into the shared runtime;
  // surface the sendable path alongside the image so the model knows it has a real
  // file (vision base64 alone can't be sent) and can push it via qq-send-image.
  const computerSavedPath = computerImageContent
    && typeof (toolResult as { saved_path?: unknown }).saved_path === 'string'
    && (toolResult as { saved_path: string }).saved_path
    ? (toolResult as { saved_path: string }).saved_path
    : null;
  const computerOutput = computerImageContent
    ? (computerSavedPath
        ? [...computerImageContent, {
            type: 'input_text',
            text: `截图已存到 ${computerSavedPath}（executor 容器内可读）。要发到 QQ：用 $qq-send-image 发这个路径。`
          }]
        : computerImageContent)
    : null;

  const inputItems: OpenResponseInputItem[] = [{
    type: 'function_call_output',
    call_id: toolCall.callId,
    output: computerOutput
      ? (computerOutput as unknown as Extract<OpenResponseInputItem, { type: 'function_call_output' }>['output'])
      : toolResult.tool_rejected === true && typeof toolResult.rejection_output === 'string'
        ? String(toolResult.rejection_output).trim()
      : (toolCall.name === TOOL_NAMES.execCommand || toolCall.name === TOOL_NAMES.readFile) && typeof toolResult.codex_output === 'string'
        ? toolResult.codex_output
        : toolCall.name === TOOL_NAMES.webSearch && typeof toolResult.output_text === 'string'
          ? String(toolResult.output_text).trim()
        : toolCall.name === TOOL_NAMES.inspectImage && typeof toolResult.output_xml === 'string'
          ? appendInspectImageLocalPath(String(toolResult.output_xml).trim(), toolResult)
          : toolCall.name === TOOL_NAMES.recoverEnergy && typeof toolResult.system_reminder === 'string'
            ? String(toolResult.system_reminder).trim()
          : (toolCall.name === TOOL_NAMES.privateReply || toolCall.name === TOOL_NAMES.groupReply)
            ? buildSendToolOutput(toolResult)
            : JSON.stringify(toolResult)
  }];
  const oneShotInputItems: OpenResponseInputItem[] = [];
  return {
    inputItems,
    oneShotInputItems,
    forcedVisibleReply: null
  };
}

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

export class AgentLoopService {
  private readonly responseActionRouter = new ResponseActionRouter();
  private stableRuntimePrompt: ResolvedAgentRuntimePrompt | null = null;
  private readonly coreMemoryCompressionForks = new Map<string, CoreMemoryCompressionForkState>();
  // Single-flight compression spanning trigger -> APPLIED (not just fork-in-flight).
  // 已经压了但主 loop 还没用上,就不准再压:记下这次压缩的目标 cutoff;在主 loop 的
  // 生效 cutoff 追上它之前,抑制新的触发。否则「fork 提交(锁释放)→ 主 loop 下个新对话
  // 才应用」之间的空窗里,计数器在旧大上下文上重攒会放出多余的第二次压缩(实测 12:53/15:18
  // 各一次)。清除时机:主 loop 生效 cutoff >= 目标(已应用),或 fork 失败未提交(可重试)。
  private readonly pendingCompressionAppliedCutoffBySession = new Map<string, number>();
  private cacheHeartbeatLastStartedAtMs = 0;
  // Single-flight lock shared by ALL heartbeat entry points: the main-loop
  // recovery scheduler (scheduleCacheHeartbeatDuringRecovery), the debug-interval
  // supervisor and the manual admin button (both via triggerCacheHeartbeatForDebug).
  // While one heartbeat is in flight, every other entry point skips (never queues),
  // so overlapping 437K clone requests can't stack up. Typed `unknown` because the
  // recovery path stores a void bookkeeping promise while the debug path stores the
  // CacheHeartbeatRunResult promise; the lock only cares whether one is running.
  private cacheHeartbeatInFlight: Promise<unknown> | null = null;
  private subconsciousAgentForkBackoffUntilMs = 0;
  private subconsciousAgentForkInFlight: Promise<boolean> | null = null;
  // Handoff from the last settled main-agent run to the self-driven fork. The fork is a
  // complete clone of the main agent (see GOVERNING PRINCIPLE on maybeRunSubconsciousAgentFork):
  // `canonicalRequest` is the EXACT request the main loop just SENT (assistant-text-stripped,
  // byte-identical to the warm prompt cache), so the fork's prefix reads that cache instead of
  // cold-prefilling. `recentNarrationItems` is this settling turn's narration (D), stripped from
  // the sent prefix but re-injected at the fork's TAIL so it still sees "what she just said"
  // without diverging the cache lineage. Seeding from the UNstripped requestInput instead would
  // drag every mid-run D back into the prefix and穿透 the whole body (see fork cache 击穿 fix).
  // `settledOnFinalAnswer` gates C2 — fork when she settled on a final_answer (a pure-text,
  // no-action response).
  //
  // 消费时机(2026-07-28 修):seed 只在 fork 【真的入队成功】后才清。改前是取出即无条件清空,
  // 于是 fork 一失败 seed 就没了,`:6407` 主 loop 空闲 tick 的轮询之后每次都在 `if (!seed) return`
  // 早退 —— 60s backoff 挡的是一个永远不会到来的第二次尝试,自驱动就此永久停摆,只能等
  // clock_ping(2h)或外部消息把她拉回来。60 天 44 次 fork 失败里有 27 次是这个形状。
  // 保留 seed 后:失败 → backoff 到期 → 下一个空闲 tick 用同一份 seed 重试。
  // null after a restart (no fresh main run yet) ⇒ no fork until the next run(重启桶由 clock_ping 兜底)。
  private lastMainAgentForkSeed: {
    canonicalRequest: CanonicalAgentTurnRequest;
    recentNarrationItems: OpenResponseInputItem[];
    settledOnFinalAnswer: boolean;
  } | null = null;
  // 同一份 seed 连续失败次数。到上限就丢弃这份 seed,退回改前的行为(等下一个主 run 或 clock_ping)。
  // 没有这个上限,一份「注定失败」的 seed 会每 60s 重试一次、每次烧一个 ~490K 的 fork 请求,无界。
  private subconsciousAgentForkConsecutiveFailures = 0;
  // 当前在飞的自驱动 fork 的 runId(1A)。plan 提交端点靠它判断票据是不是还有人负责。
  // 同一时刻至多一个 fork(subconsciousAgentForkInFlight 保证),所以单值够用。
  private activeSubconsciousForkRunId: string | null = null;
  // fork 的出口。`xiaoni-plan post` 打到端点那一刻,入队【就已经在这个进程里完成了】
  // (redeemSubconsciousPlanTicket → enqueueSubconsciousAgentNotify,queueId 当场到手)。
  // 所以 fork 的终止条件就是这个字段,不是从 exec 的 stdout 里把 marker 捞回来。
  //
  // 差别在异常路径上:stdout 那条要 marker 活着穿过「skill 进程 → executor → HTTP →
  // executeTool 返回值」整条链。任何一环抛异常,marker 就没了,而入队【已经发生】——
  // 引擎却判成「没交」,发纠正提示让她再交一次,新 fork 换了 forkRunId 就绕开
  // `messageSid = subconscious-agent:<forkRunId>` 的去重,同一份 plan 进两次队。
  // 具体地:executeTool 抛异常时(exec 超时、executor 断连)走的是下面那个 catch,
  // rawToolResult 变成 error 结果,stdout 里什么都没有;而这个字段还在。
  //
  // (注:曾以为 `max_output_tokens` 设小会截断 marker —— 不成立。executor
  //  `modules/xiaoni-executor/src/index.ts:832` 把它地板到 2000 token(~8000 字符)
  //  且保 head+tail 预览,agent 侧 `:13703` 同一个 clamp。别再拿这条当理由。)
  private subconsciousPlanSubmission:
    | { forkRunId: string; ok: true; queueId: number | null }
    | { forkRunId: string; ok: false; reason: string }
    | null = null;

  // 上一次真正入队的报时格。纯优化:让 60s 的 supervisor tick 在没到点时零 IO 返回。
  // 丢了(重启)最多多敲一次库,正确性由 dedupe_key 唯一索引保证,不靠这个字段。
  private lastEnqueuedClockPingSlot: string | null = null;

  constructor(
    private readonly store: RuntimeStore,
    private readonly promptResolver: AgentPromptResolver = new AgentPromptService(),
    private readonly options: AgentLoopServiceOptions = {}
  ) {}

  invalidateStableRuntimePrompt(reason = 'manual') {
    const hadPrompt = this.stableRuntimePrompt !== null;
    this.stableRuntimePrompt = null;
    moduleLogger.info('Invalidated stable Xiaoni runtime prompt', {
      reason,
      hadPrompt
    });
    return hadPrompt;
  }

  private async isRuntimeEnabledForLoop() {
    if (typeof this.options.isRuntimeEnabled !== 'function') {
      return true;
    }

    try {
      return await this.options.isRuntimeEnabled() !== false;
    } catch (error) {
      moduleLogger.warn('Failed to check Xiaoni runtime control during active loop; defaulting enabled', {
        error: error instanceof Error ? error.message : String(error)
      });
      return true;
    }
  }

  private async waitForRuntimeEnabledBeforeModelSlice(payload: QueueMessageRecord['payload'], runId: string) {
    let pauseLogged = false;
    const pollMs = Math.max(50, Math.min(this.options.runtimePausePollMs ?? agentConfig.idleIntervalMs, agentConfig.idleIntervalMs));

    while (!await this.isRuntimeEnabledForLoop()) {
      if (!pauseLogged) {
        pauseLogged = true;
        await this.store.logTimelineEvent({
          traceId: payload.traceId,
          eventType: 'decision',
          eventName: 'runtime_paused',
          eventPhase: 'start',
          metadata: {
            run_id: runId,
            source: 'runtime:control'
          }
        }).catch((error) => {
          moduleLogger.warn('Failed to log Xiaoni runtime pause', {
            traceId: payload.traceId,
            runId,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }
      await sleep(pollMs);
    }

    if (pauseLogged) {
      await this.store.logTimelineEvent({
        traceId: payload.traceId,
        eventType: 'decision',
        eventName: 'runtime_paused',
        eventPhase: 'end',
        metadata: {
          run_id: runId,
          source: 'runtime:control'
        }
      }).catch((error) => {
        moduleLogger.warn('Failed to log Xiaoni runtime resume', {
          traceId: payload.traceId,
          runId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }
  }

  private async yieldBeforeMainAgentModelSlice() {
    let configuredYieldMs = this.options.preModelSliceYieldMs ?? agentConfig.mainAgentPreModelYieldMs;
    if (typeof this.options.getMainAgentPreModelYieldMs === 'function') {
      try {
        const resolved = await this.options.getMainAgentPreModelYieldMs();
        if (Number.isFinite(resolved) && resolved >= 0) {
          configuredYieldMs = resolved;
        }
      } catch (error) {
        moduleLogger.warn('Failed to load Xiaoni main agent pre-model yield; using fallback', {
          error: error instanceof Error ? error.message : String(error),
          fallbackMs: configuredYieldMs
        });
      }
    }
    const yieldMs = Math.max(0, Math.trunc(configuredYieldMs));
    if (yieldMs <= 0) {
      return;
    }

    const wait = this.options.sleepMs ?? sleep;
    await wait(yieldMs);
  }

  private async resolveStableRuntimePrompt(payload: QueueMessageRecord['payload']) {
    if (!this.stableRuntimePrompt) {
      const resolved = await this.promptResolver.resolveForQueueMessage(payload);
      // Freeze skills_instructions into the same snapshot as systemPrompt. Rendered
      // once here (not per build), so a live skills_instructions.md edit only takes
      // effect when the snapshot is invalidated — i.e. at the core-memory-compression
      // boundary (or a manual force). Keeps the head byte-stable between compressions
      // so prompt-file edits can't 击穿 the cached prefix at a run boundary.
      this.stableRuntimePrompt = { ...resolved, skillsInstructions: buildSkillsInstructions() };
    }
    return this.stableRuntimePrompt;
  }

  async runRuntimeLoop(params: AgentRuntimeLoopParams) {
    const shouldStop = params.isStopping ?? (() => false);
    const wait = params.sleepMs ?? sleep;
    const bootstrapPromptPayload = params.bootstrapPromptPayload ?? buildRuntimeBootstrapPromptPayload();

    while (!shouldStop() && !this.stableRuntimePrompt) {
      try {
        await this.resolveStableRuntimePrompt(bootstrapPromptPayload);
      } catch (error) {
        params.onRuntimeLoopError?.(error);
        if (!shouldStop()) {
          await wait(params.idleIntervalMs);
        }
      }
    }

    while (!shouldStop()) {
      if (typeof params.shouldReloadRuntimePrompt === 'function') {
        try {
          if (await params.shouldReloadRuntimePrompt()) {
            this.invalidateStableRuntimePrompt('prompt_files_changed');
          }
        } catch (error) {
          params.onRuntimeLoopError?.(error);
        }
      }

      try {
        await params.recoverStaleProcessingLeases?.();
      } catch (error) {
        params.onRuntimeLoopError?.(error);
      }

      const runtimeEnabled = await this.isRuntimeEnabledForLoop();
      params.onRuntimeEnabledChange?.(runtimeEnabled);
      if (!runtimeEnabled) {
        await wait(params.idleIntervalMs);
        continue;
      }

      params.onBusyChange?.(true);
      try {
        await this.processRuntimeIteration(params);
      } catch (error) {
        params.onRuntimeLoopError?.(error);
        if (!shouldStop()) {
          await wait(params.idleIntervalMs);
        }
      } finally {
        params.onBusyChange?.(false);
      }
    }
  }

  private async processRuntimeIteration(params: AgentRuntimeIterationParams) {
    const wait = params.sleepMs ?? sleep;
    const recoveryAction = await this.reconcileActiveRecoverySession(params);
    if (recoveryAction.status === 'active') {
      await this.scheduleCacheHeartbeatDuringRecovery(recoveryAction.session);
      await wait(params.idleIntervalMs);
      return;
    }
    await this.clearCacheHeartbeatRecoverySchedule(recoveryAction.session);
    const initialLoopContinuation = recoveryAction.status === 'settled'
      ? recoveryAction.inputItems
      : [];

    const queueMessage = await this.store.claimNextQueueMessage(params.workerId);
    if (!queueMessage) {
      await this.maybeRunSubconsciousAgentFork(params, initialLoopContinuation);
      await wait(params.idleIntervalMs);
      return;
    }

    const recoveryWakeCountStartQueueMessageId = Math.max(
      ...queueMessage.queueMessageIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)),
      0
    );
    // 被动召回 query:认领即消费,此刻这条内容才是她正在做的事。fire-and-forget,零缓存影响。
    fireConsumedNotifyRecall(queueMessage.payload as unknown as Record<string, unknown>);
    await this.processRuntimeFrame(queueMessage, {
      initialLoopContinuation,
      initialLoopContinuationBeforeCurrentTrigger: initialLoopContinuation.length > 0,
      recoveryWakeCountStartQueueMessageId
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SELF-DRIVEN FORK — GOVERNING PRINCIPLE (do not violate)
  //
  // The self-driven (对小腻而言是潜意识) fork is a COMPLETE CLONE of the main agent: its
  // request must be the main agent's own context, byte-for-byte, plus the just-produced
  // output D, plus the self-continuation developer reminder appended at the tail. That is
  // the whole fork: clone(main) + D + reminder.
  //
  //   * The fork performs NO context manipulation of its own — no independent rebuild,
  //     no fork-specific stripping, no re-injection. Whatever the main agent's context
  //     is (already stripped or not), the fork inherits it verbatim.
  //   * Stripping of assistant text is the MAIN agent's job ONLY (buildInitialInput +
  //     the per-turn request build). The fork never strips and never "adds back".
  //   * Because the fork's prefix is identical to the main agent's last request, it rides
  //     the exact warm in-context cache the main agent just primed (≈ main hit rate).
  //
  // WHY: any independent rebuild can drift from the main agent's real request (different
  // timing / intra-run state) and break both correctness ("fork sees something different
  // from main") and the cache (prefix divergence → cold prefill). Observed: 2026-06-27
  // fork hit 55% vs main 98% because the fork rebuilt+stripped independently while the
  // main still carried intra-run text.
  //
  // TRIGGER (C2): fork when she settled on a final_answer — a pure-text response with no
  // action — judged on THE SETTLING RESPONSE, not the whole run. A turn that makes a tool
  // call never settles, so any settle on a final_answer means "she ended idle on a 小腻os":
  // the fork gives her the next direction, regardless of how many tools the run used before
  // settling (`lastMainAgentForkSeed.settledOnFinalAnswer`).
  //
  // CURRENT STATUS: satisfied. The fork clones `lastMainAgentForkSeed.canonicalRequest` (the
  // main's own last request, already incl. the 当轮小腻os) and only appends the reminder —
  // no rebuild, no fork-side stripping, no re-injection. The seed is captured at the main
  // run's settle (processRuntimeFrame) and consumed here.
  // ─────────────────────────────────────────────────────────────────────────────
  private async maybeRunSubconsciousAgentFork(
    _params: AgentRuntimeIterationParams,
    initialLoopContinuation: OpenResponseInputItem[]
  ) {
    if (initialLoopContinuation.length > 0) {
      const recoveryWakeCountStartQueueMessageId = await this.readRecoveryQueueHighWatermark();
      await this.processRuntimeFrame(buildRuntimeLoopFrameQueueMessage(), {
        queueBacked: false,
        triggerInputMode: 'suppress_current_trigger',
        appendRuntimeInputStackItem: false,
        logQueueLifecycle: false,
        initialLoopContinuation,
        recoveryWakeCountStartQueueMessageId
      });
      return;
    }

    if (this.subconsciousAgentForkBackoffUntilMs > Date.now()) {
      return;
    }
    if (this.subconsciousAgentForkInFlight) {
      return;
    }

    // Take (do NOT yet consume) the seed from the last settled main run. It is cleared only after
    // the fork actually enqueues a plan — see `lastMainAgentForkSeed`. A failed fork keeps it so
    // the next idle tick (`:6407`) retries once the backoff expires.
    const seed = this.lastMainAgentForkSeed;
    if (!seed) {
      // No fresh main run to clone (e.g. just after a restart). Wait for the next main run
      // to repopulate the seed rather than rebuilding context independently.
      return;
    }
    // C2 (original self-driven trigger): fork whenever she settled on a final_answer — a pure-text
    // response with no action — judged on THE SETTLING RESPONSE, not the whole run. A turn that
    // makes a tool call never settles, so any settle on a final_answer means "she ended idle on a
    // 小腻os": the fork gives her the next direction, no matter how many tools the run used before
    // settling. (A QQ reply is a send_* tool call, so a run that ends with a reply-then-settle
    // still triggers — she still gets a direction the moment she stops.)
    if (!seed.settledOnFinalAnswer) {
      // 不合格的 seed 重试多少次都不会变合格 —— 直接丢弃,等下一次主 settle 覆盖它。
      this.dropSubconsciousAgentForkSeed(seed);
      return;
    }

    const queueMessage = buildRuntimeLoopFrameQueueMessage();
    const payload = queueMessage.payload;

    const contextSessionKey = getGlobalPromptContextSessionKey();
    const runtimePrompt = await this.resolveStableRuntimePrompt(payload);

    // C1: the fork is a COMPLETE CLONE of the main agent. baseRequest is the main's own last
    // SENT request (assistant-text-stripped → byte-identical to the warm cache); the settling
    // narration (D) rides in as `recentNarrationItems`, re-injected at the fork's TAIL by
    // buildSubconsciousAgentForkRequest. No fork-side rebuild or stripping; prefix stays warm.
    // 空转升级：把「上一份 plan 连着几轮没被执行」和那份 plan 的原文交给潜意识，让它自己决定语气多硬。
    // 这两样【只】进 fork 的尾部 reminder，永不进主 agent 上下文、永不写 stack(fork 请求 no_persist)。
    // 开关 OFF / 未达阈值 / 手上没有上一份 plan 时 renderSubconsciousForkReminder 退回原文，逐字节零变化。
    const fork = this.runSubconsciousAgentFork({
      baseRequest: seed.canonicalRequest,
      recentNarrationItems: seed.recentNarrationItems,
      queueMessage: payload,
      runtimePrompt,
      contextSessionKey,
      idleRounds: getConsecutiveIdlePlanFailures(contextSessionKey),
      lastPlanText: getLastEmittedSubconsciousPlan(contextSessionKey)
    });
    this.subconsciousAgentForkInFlight = fork;
    void fork.then((enqueued) => {
      if (enqueued) {
        // 交付成功才消费 seed —— 这是「每次主 settle 至多一个 fork」的实际执行点。
        this.consumeSubconsciousAgentForkSeed(seed);
        return;
      }
      this.subconsciousAgentForkBackoffUntilMs = Date.now() + SUBCONSCIOUS_AGENT_FORK_IDLE_BACKOFF_MS;
      this.recordSubconsciousAgentForkFailure(seed, 'not_enqueued', payload);
    }).catch((error) => {
      this.subconsciousAgentForkBackoffUntilMs = Date.now() + SUBCONSCIOUS_AGENT_FORK_IDLE_BACKOFF_MS;
      moduleLogger.warn('Background subconscious agent fork failed', {
        traceId: payload.traceId,
        runId: payload.runId,
        error: error instanceof Error ? error.message : String(error)
      });
      this.recordSubconsciousAgentForkFailure(seed, 'threw', payload);
    }).finally(() => {
      if (this.subconsciousAgentForkInFlight === fork) {
        this.subconsciousAgentForkInFlight = null;
      }
      // 1A：fork 一结束票据立刻失效，不管它是成功、失败还是抛异常。遗留票据只能兑到 401。
      this.activeSubconsciousForkRunId = null;
    });
  }

  /**
   * 兑现一张自驱动 plan 提交票据 —— `xiaoni-plan post` skill 打到这里。
   *
   * 三道闸，缺一不可：
   *   ① 票据存在、未过期、token 常数时间相等；
   *   ② 1A：票上的 forkRunId 必须等于【当前在飞】的那个 fork。fork 崩了之后遗留票据一律 401，
   *      不会兑出一条没人负责的 plan notify；
   *   ③ 正文非空。
   * 全过才调既有的 enqueueSubconsciousAgentNotify —— 去重键、溯源字段、notify 模板一行不改，
   * 主 loop 那侧完全不知道 plan 是抠出来的还是交上来的。
   */
  async redeemSubconsciousPlanTicket(params: { token: unknown; text: unknown }): Promise<
    | { ok: true; queueId: number | null }
    | { ok: false; status: 400 | 401 | 500; reason: string }
  > {
    const token = typeof params.token === 'string' ? params.token.trim() : '';
    const text = typeof params.text === 'string' ? params.text.trim() : '';
    if (!token) {
      return { ok: false, status: 401, reason: 'missing_token' };
    }
    if (!text) {
      return { ok: false, status: 400, reason: 'empty_text' };
    }
    const found = findSubconsciousPlanTicket({ token, nowMs: Date.now() });
    if (!found) {
      return { ok: false, status: 401, reason: 'unknown_or_expired_token' };
    }
    if (!this.activeSubconsciousForkRunId || this.activeSubconsciousForkRunId !== found.ticket.forkRunId) {
      // 1A。票是真的，但签它的那个 fork 已经不在了 —— 不给兑。
      return { ok: false, status: 401, reason: 'fork_not_in_flight' };
    }
    try {
      const notify = await this.enqueueSubconsciousAgentNotify({
        forkRunId: found.ticket.forkRunId,
        forkSliceId: `${found.ticket.forkRunId}:skill-submit`,
        llmCallId: null,
        traceId: found.ticket.traceId,
        runId: found.ticket.runId,
        text
      });
      consumeSubconsciousPlanTicket(found.filePath);
      const queueId = Number(notify?.queueId || 0) || null;
      // 出口在这里落定。fork 循环下一步读它就收工,不经 stdout。
      this.subconsciousPlanSubmission = { forkRunId: found.ticket.forkRunId, ok: true, queueId };
      return { ok: true, queueId };
    } catch (error) {
      // 入队失败不消费票据：skill 侧还会重试,让它能用同一张票再试一次。
      moduleLogger.warn('Failed to enqueue subconscious plan from skill submission', {
        forkRunId: found.ticket.forkRunId,
        error: error instanceof Error ? error.message : String(error)
      });
      // 她交了,是我们这边没接住。记成 failed 让 fork 中止而【不发】纠正提示 —— 告诉她
      // 「你没交出去」是不实的,还会把 turn 预算烧在一个她修不好的条件上(spec 4A)。
      // 票据不消费,skill 侧还会用同一张票重试。
      this.subconsciousPlanSubmission = { forkRunId: found.ticket.forkRunId, ok: false, reason: 'enqueue_failed' };
      return { ok: false, status: 500, reason: 'enqueue_failed' };
    }
  }

  // 取出这次 fork 的提交结果。写入方是 HTTP 端点(redeemSubconsciousPlanTicket)—— 同进程、
  // 不同调用栈,TS 的控制流分析看不到那条写入,所以必须显式取一次而不是内联读字段。
  // 取即清:同一份提交结果只兑现一次,fork 之间不会串。
  private takeSubconsciousPlanSubmission(forkRunId: string):
    | { ok: true; queueId: number | null }
    | { ok: false; reason: string }
    | null {
    const submission = this.subconsciousPlanSubmission;
    if (!submission || submission.forkRunId !== forkRunId) {
      return null;
    }
    this.subconsciousPlanSubmission = null;
    return submission.ok
      ? { ok: true, queueId: submission.queueId }
      : { ok: false, reason: submission.reason };
  }

  // ── seed 生命周期(2026-07-28)────────────────────────────────────────────────────────────
  // 三个动作都用【引用相等】判定,绝不无条件写 null:fork 在飞期间主 loop 可能又 settle 了一次并把
  // `lastMainAgentForkSeed` 换成更新的一份(`:8491`),那份不该被这次 fork 的结局连累。
  private consumeSubconsciousAgentForkSeed(seed: NonNullable<AgentLoopService['lastMainAgentForkSeed']>) {
    this.subconsciousAgentForkConsecutiveFailures = 0;
    if (this.lastMainAgentForkSeed === seed) {
      this.lastMainAgentForkSeed = null;
    }
  }

  private dropSubconsciousAgentForkSeed(seed: NonNullable<AgentLoopService['lastMainAgentForkSeed']>) {
    this.subconsciousAgentForkConsecutiveFailures = 0;
    if (this.lastMainAgentForkSeed === seed) {
      this.lastMainAgentForkSeed = null;
    }
  }

  private recordSubconsciousAgentForkFailure(
    seed: NonNullable<AgentLoopService['lastMainAgentForkSeed']>,
    reason: 'not_enqueued' | 'threw',
    payload: QueueMessageRecord['payload']
  ) {
    if (this.lastMainAgentForkSeed !== seed) {
      // 已经有更新的 seed 了,这次失败不该影响它,也不计数。
      return;
    }
    this.subconsciousAgentForkConsecutiveFailures += 1;
    const attempts = this.subconsciousAgentForkConsecutiveFailures;
    if (attempts >= SUBCONSCIOUS_AGENT_FORK_MAX_CONSECUTIVE_FAILURES) {
      // 这份 seed 大概率是「注定失败」的(例如请求本身有毒)。丢掉它退回改前行为:
      // 等下一个主 run 或 clock_ping(≤2h)把她拉回来,而不是每 60s 无界地烧一个 ~490K 请求。
      moduleLogger.warn('Subconscious agent fork seed dropped after repeated failures', {
        traceId: payload.traceId,
        runId: payload.runId,
        reason,
        attempts
      });
      this.lastMainAgentForkSeed = null;
      this.subconsciousAgentForkConsecutiveFailures = 0;
      return;
    }
    moduleLogger.info('Subconscious agent fork seed retained for retry', {
      traceId: payload.traceId,
      runId: payload.runId,
      reason,
      attempts,
      retryAfterMs: SUBCONSCIOUS_AGENT_FORK_IDLE_BACKOFF_MS
    });
  }

  private async readRecoveryQueueHighWatermark(): Promise<number> {
    const reader = (this.store as RuntimeStore & {
      getAgentRecoveryQueueHighWatermark?: RuntimeStore['getAgentRecoveryQueueHighWatermark'];
    }).getAgentRecoveryQueueHighWatermark;
    if (typeof reader !== 'function') {
      return 0;
    }
    return reader.call(this.store).catch((error) => {
      moduleLogger.warn('Failed to read recovery queue high watermark', {
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    });
  }

  private async clearCacheHeartbeatRecoverySchedule(session?: RecoverySessionHeartbeatState | null) {
    this.cacheHeartbeatLastStartedAtMs = 0;
    const store = this.store as RuntimeStore & {
      clearAgentRecoveryCacheHeartbeatSchedule?: RuntimeStore['clearAgentRecoveryCacheHeartbeatSchedule'];
    };
    if (!session?.id || typeof store.clearAgentRecoveryCacheHeartbeatSchedule !== 'function') {
      return;
    }
    await store.clearAgentRecoveryCacheHeartbeatSchedule.call(this.store, {
      id: session.id,
      reason: 'recovery_settled'
    }).catch((error) => {
      moduleLogger.warn('Failed to clear Xiaoni cache heartbeat recovery schedule', {
        recoverySessionId: session.id,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  private shouldRunFallbackCacheHeartbeat(intervalMs: number) {
    const nowMs = Date.now();
    if (this.cacheHeartbeatLastStartedAtMs > 0 && nowMs - this.cacheHeartbeatLastStartedAtMs < intervalMs) {
      return false;
    }
    this.cacheHeartbeatLastStartedAtMs = nowMs;
    return true;
  }

  private async scheduleCacheHeartbeatDuringRecovery(session?: RecoverySessionHeartbeatState | null) {
    if (!agentConfig.cacheHeartbeatEnabled) {
      return;
    }
    if (typeof this.options.isCacheHeartbeatPaused === 'function') {
      try {
        if (await this.options.isCacheHeartbeatPaused()) {
          return;
        }
      } catch (error) {
        moduleLogger.warn('Failed to check Xiaoni cache heartbeat pause control; defaulting heartbeat enabled', {
          recoverySessionId: session?.id || null,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    if (this.cacheHeartbeatInFlight) {
      return;
    }
    const intervalMs = Math.max(60 * 1000, Number(agentConfig.cacheHeartbeatIntervalMs) || (5 * 60 * 1000));
    const store = this.store as RuntimeStore & {
      claimAgentRecoveryCacheHeartbeat?: RuntimeStore['claimAgentRecoveryCacheHeartbeat'];
      completeAgentRecoveryCacheHeartbeat?: RuntimeStore['completeAgentRecoveryCacheHeartbeat'];
    };
    let heartbeatSessionId: number | string | null = session?.id || null;
    let heartbeatStartedAt: string | null = null;

    if (heartbeatSessionId && typeof store.claimAgentRecoveryCacheHeartbeat === 'function') {
      const claim = await store.claimAgentRecoveryCacheHeartbeat.call(this.store, {
        id: heartbeatSessionId,
        intervalMs,
        inFlightStaleMs: Math.min(intervalMs, 60 * 1000),
        now: new Date()
      }).catch((error) => {
        moduleLogger.warn('Failed to claim persisted Xiaoni cache heartbeat schedule', {
          recoverySessionId: heartbeatSessionId,
          error: error instanceof Error ? error.message : String(error)
        });
        return null;
      });
      if (!claim?.claimed) {
        return;
      }
      heartbeatStartedAt = claim.inFlightStartedAt || new Date().toISOString();
    } else {
      heartbeatSessionId = null;
      if (!this.shouldRunFallbackCacheHeartbeat(intervalMs)) {
        return;
      }
      heartbeatStartedAt = new Date().toISOString();
    }

    const run = (async () => {
      try {
        const result = await this.runCacheHeartbeatDuringRecovery();
        if (heartbeatSessionId && typeof store.completeAgentRecoveryCacheHeartbeat === 'function') {
          await store.completeAgentRecoveryCacheHeartbeat.call(this.store, {
            id: heartbeatSessionId,
            intervalMs,
            status: result.triggered ? 'completed' : 'skipped',
            startedAt: heartbeatStartedAt,
            completedAt: new Date(),
            eventId: result.llmCallId ? `codex-provider:${result.llmCallId}` : null,
            llmCallId: result.llmCallId,
            traceId: result.traceId,
            runId: result.runId,
            inputTokens: result.inputTokens,
            cachedInputTokens: result.cachedInputTokens,
            outputTokens: result.outputTokens,
            processingTimeMs: result.processingTimeMs
          }).catch((error) => {
            moduleLogger.warn('Failed to persist Xiaoni cache heartbeat completion', {
              recoverySessionId: heartbeatSessionId,
              error: error instanceof Error ? error.message : String(error)
            });
          });
        }
      } catch (error) {
        if (heartbeatSessionId && typeof store.completeAgentRecoveryCacheHeartbeat === 'function') {
          await store.completeAgentRecoveryCacheHeartbeat.call(this.store, {
            id: heartbeatSessionId,
            intervalMs,
            status: 'failed',
            startedAt: heartbeatStartedAt,
            completedAt: new Date(),
            error: error instanceof Error ? error.message : String(error)
          }).catch((persistError) => {
            moduleLogger.warn('Failed to persist Xiaoni cache heartbeat failure', {
              recoverySessionId: heartbeatSessionId,
              error: persistError instanceof Error ? persistError.message : String(persistError)
            });
          });
        }
        moduleLogger.warn('Xiaoni cache heartbeat failed', {
          recoverySessionId: heartbeatSessionId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    })();
    this.cacheHeartbeatInFlight = run;
    run.finally(() => {
      if (this.cacheHeartbeatInFlight === run) {
        this.cacheHeartbeatInFlight = null;
      }
    }).catch(() => undefined);
  }

  async triggerCacheHeartbeatForDebug(): Promise<CacheHeartbeatRunResult> {
    // Acquire the shared single-flight lock. If a heartbeat (recovery, debug
    // supervisor, or another manual click) is already running, skip immediately
    // instead of firing a second concurrent 437K clone. The check and the
    // assignment run in one synchronous tick (no await between them), so two
    // concurrent callers can't both pass the guard.
    if (this.cacheHeartbeatInFlight) {
      return {
        triggered: false,
        reason: 'heartbeat_in_flight',
        executionMode: CACHE_HEARTBEAT_EXECUTION_MODE
      };
    }
    const run = this.runCacheHeartbeatDuringRecovery();
    this.cacheHeartbeatInFlight = run;
    run.finally(() => {
      if (this.cacheHeartbeatInFlight === run) {
        this.cacheHeartbeatInFlight = null;
      }
    }).catch(() => undefined);
    return run;
  }

  // Operator-forced core memory compaction. Mirrors the cache-heartbeat prelude
  // (synthetic runtime frame -> load history/prompt/identity/energy -> budget plan)
  // but with forceCompression so a checkpoint is produced even when the context is
  // under budget, then hands it to the SAME single-flight fork scheduler. We never
  // call runCoreMemoryCompressionFork directly: scheduleCoreMemoryCompressionFork
  // owns the in-memory + durable dedupe that keeps a manual click from racing an
  // auto-overflow fork. Returns immediately; the fork runs in the background and
  // may take >5min.
  async triggerManualCoreMemoryCompression(): Promise<ManualCoreMemoryCompressionResult> {
    const queueMessage = buildRuntimeLoopFrameQueueMessage();
    const payload: QueueMessageRecord['payload'] = {
      ...queueMessage.payload,
      source: 'manual_core_memory_compression'
    };
    const contextSessionKey = getGlobalPromptContextSessionKey();
    const store = this.store as RuntimeStore & {
      getSessionReadCutoffState?: RuntimeStore['getSessionReadCutoffState'];
      listAgentStackItems?: RuntimeStore['listAgentStackItems'];
    };
    if (typeof store.getSessionReadCutoffState !== 'function' || typeof store.listAgentStackItems !== 'function') {
      return {
        triggered: false,
        status: 'request_builder_unavailable',
        contextSessionKey,
        traceId: payload.traceId,
        runId: payload.runId
      };
    }

    const cutoffState = await store.getSessionReadCutoffState.call(this.store, contextSessionKey);
    const history = await this.loadStackHistoryBlocks(cutoffState, payload.traceId);
    const runtimePrompt = await this.resolveStableRuntimePrompt(payload);
    const runtimeIdentityFacts = await this.loadRuntimeIdentityFacts(payload);
    const baseDeveloperContextBlock = await this.buildDeveloperContextBlock(payload);
    const runtimeEnergyState = await this.getCurrentRuntimeEnergyState(payload);
    const developerContextBlock = [
      baseDeveloperContextBlock
    ].filter((part): part is string => Boolean(part && part.trim())).join('\n\n') || null;

    const budgetPlan = await this.buildContextBudgetPlan({
      history,
      queueMessage: payload,
      runtimePrompt,
      loopContinuation: [],
      runtimeIdentityFacts,
      developerContextBlock,
      runtimeEnergyState,
      contextSessionKey,
      cutoffState,
      triggerInputMode: 'suppress_current_trigger',
      forceCompression: true
    });

    if (!budgetPlan.coreMemoryCompression || !budgetPlan.summarySourceInput) {
      moduleLogger.info('Manual core memory compression had nothing to compress', {
        traceId: payload.traceId,
        runId: payload.runId,
        contextSessionKey,
        retainedHistoryTurns: history.length
      });
      return {
        triggered: false,
        status: 'nothing_to_compress',
        contextSessionKey,
        traceId: payload.traceId,
        runId: payload.runId,
        retainedHistoryTurns: history.length
      };
    }

    const timeGrounding = await this.resolveCompressionTimeGrounding({
      queueMessage: payload,
      previousReadCutoffAfterStackIndex:
        budgetPlan.coreMemoryCompression.previousReadCutoffAfterStackIndex,
      now: new Date()
    });
    const artifact = await this.scheduleCoreMemoryCompressionFork({
      // Fork = clone of the main agent: base off the FULL main request input
      // (byte-identical warm prefix), with the compression instruction as a tail item.
      baseRequest: buildMainAgentCanonicalRequest(runtimePrompt, budgetPlan.requestInput, payload),
      queueMessage: payload,
      runtimePrompt,
      compression: budgetPlan.coreMemoryCompression,
      contextSessionKey,
      compressionReminderItems: [buildCoreMemoryCompressionReminder({
        contextSessionKey,
        readCutoffAfterStackIndex: budgetPlan.coreMemoryCompression.readCutoffAfterStackIndex,
        pressureSummary: CORE_MEMORY_COMPRESSION_PRESSURE_SUMMARY,
        ...timeGrounding
      })],
      // Manual trigger: run even while the loop is stopped (see fork gate).
      bypassRuntimeEnabledGate: true
    });
    const artifactStatus = typeof (artifact as { status?: unknown })?.status === 'string'
      ? (artifact as { status: string }).status
      : 'scheduled';
    moduleLogger.info('Manual core memory compression triggered', {
      traceId: payload.traceId,
      runId: payload.runId,
      contextSessionKey,
      status: artifactStatus,
      readCutoffAfterStackIndex: budgetPlan.coreMemoryCompression.readCutoffAfterStackIndex,
      compressionCoveredEndStackIndex: budgetPlan.coreMemoryCompression.compressionCoveredEndStackIndex
    });
    return {
      triggered: artifactStatus === 'scheduled',
      status: artifactStatus,
      contextSessionKey,
      traceId: payload.traceId,
      runId: payload.runId,
      retainedHistoryTurns: history.length,
      readCutoffAfterStackIndex: budgetPlan.coreMemoryCompression.readCutoffAfterStackIndex,
      compressionCoveredEndStackIndex: budgetPlan.coreMemoryCompression.compressionCoveredEndStackIndex,
      artifact: artifact as Record<string, unknown>
    };
  }

  // Coarse liveness poll for the admin UI: is a compaction fork still running for
  // the given covered range? Reuses the durable 30-minute running-window guard, so
  // running=false means "no fork running" (done | failed | never started).
  async getCoreMemoryCompressionForkStatus(
    compressionCoveredEndStackIndex: number
  ): Promise<CoreMemoryCompressionForkStatusResult> {
    const contextSessionKey = getGlobalPromptContextSessionKey();
    const finder = (this.store as RuntimeStore & {
      findActiveCoreMemoryCompressionForkRun?: RuntimeStore['findActiveCoreMemoryCompressionForkRun'];
    }).findActiveCoreMemoryCompressionForkRun;
    if (typeof finder !== 'function' || !Number.isFinite(compressionCoveredEndStackIndex)) {
      return { running: false, contextSessionKey, compressionCoveredEndStackIndex };
    }
    const active = await finder.call(this.store, {
      contextSessionKey,
      compressionCoveredEndStackIndex
    }) as {
      forkRunId?: string | null;
      runId?: string | null;
      startedAt?: unknown;
      status?: string | null;
    } | null;
    if (!active) {
      return { running: false, contextSessionKey, compressionCoveredEndStackIndex };
    }
    return {
      running: true,
      contextSessionKey,
      compressionCoveredEndStackIndex,
      forkRunId: active.forkRunId ?? null,
      runId: active.runId ?? null,
      startedAt: active.startedAt ? String(active.startedAt) : null,
      status: active.status ?? null
    };
  }

  // Stack-native history loader. The model-visible history is the FLAT agent stack read
  // as a stack_index range (> cutoff), one BLOCK per row — NO conversation/turn grouping.
  // Each block becomes a degenerate single-block "turn" (id = stack_index) so the existing
  // assembly (buildInitialInput) and the cutoff filter (applyReadCutoff: id > cutoff) work
  // unchanged. Concatenating the per-block stackReplayItems in stack order yields exactly
  // extractResponseReplayInputItemsFromStackRows(all rows) → byte-identical to the prior
  // per-conversation replay (same rows, same render helper).
  //
  // FLOOR-BOUNDED READ: the compression floor (cutoff) is the SOLE bound — this reads EVERYTHING
  // after it (no row LIMIT; see the reader call below for why a LIMIT was a self-locking bug). When
  // the cutoff is null (fresh/unmigrated session with no compression epoch yet) the head-relative
  // backstop (head - STACK_HISTORY_READ_BACKSTOP_BLOCKS) stands in as a one-shot floor so a null
  // cutoff still can't load the whole stack. Under a live cutoff, compression keeps the epoch bounded
  // (it fires on real input_tokens and advances the floor); a genuinely stalled compression that lets
  // the epoch run away is caught by the token-based overrun halt valve, not by clamping this read.
  private async loadStackHistoryBlocks(
    cutoff: SessionReadCutoffState | null,
    traceId: string
  ): Promise<StackBackedConversationTurn[]> {
    const reader = (this.store as RuntimeStore & {
      listAgentStackItems?: RuntimeStore['listAgentStackItems'];
    }).listAgentStackItems;
    if (typeof reader !== 'function') {
      return [];
    }
    const headReader = (this.store as RuntimeStore & {
      getAgentStackHead?: RuntimeStore['getAgentStackHead'];
    }).getAgentStackHead;
    const head = typeof headReader === 'function'
      ? Number(await headReader.call(this.store, XIAONI_IDENTITY_KEY).catch(() => 0)) || 0
      : 0;
    const cutoffStackIndex = cutoff?.readCutoffAfterStackIndex ?? null;
    // Floor the read at the COMPRESSION CUTOFF when one exists, verbatim. The cutoff is
    // the only stable, run-invariant anchor: it moves ONLY when a compression fork commits
    // a new head boundary, so two consecutive runs over the same compressed epoch read from
    // the SAME floor and reconstruct a byte-identical durable prefix → the next run's first
    // turn hits the warm cache instead of cold-prefilling the whole history.
    //
    // The head-relative backstop (head - 200) must NEVER override a present cutoff: `head`
    // grows ~2 blocks per turn, so max(cutoff, head-200) SLIDES the window front up on every
    // run as soon as the cutoff is >200 blocks behind head. That slide drops the front blocks
    // run N established → run N+1's durable prefix diverges at block 0 → full message-tier
    // cache 击穿 at EVERY run boundary (observed 2026-06-30: cache_read stuck at 12249 =
    // system+tools head only, cache_creation 64-75k on every fresh run's turn 1). Bounding
    // context growth is COMPRESSION's job (input-token trigger → keepBlocks), not the read
    // floor's; a sliding read floor does not actually shrink the model's context, it only
    // corrupts the cache. The backstop therefore applies ONLY when the cutoff is null
    // (genuinely fresh/unmigrated session), as a one-shot safety cap against loading the
    // whole stack — and even then it is a fixed floor for that single read, not a per-run
    // sliding window (a fresh session has no prior warm prefix to preserve).
    const backstopFloor = head > 0 ? head - STACK_HISTORY_READ_BACKSTOP_BLOCKS : null;
    const effectiveFloor = cutoffStackIndex !== null
      ? cutoffStackIndex
      : backstopFloor;

    let rows: Array<Record<string, unknown>> = [];
    try {
      rows = await reader.call(this.store, {
        identityKey: XIAONI_IDENTITY_KEY,
        afterStackIndex: effectiveFloor,
        chronological: true,
        // No row LIMIT: the compression floor is the SOLE bound on this read. A fixed LIMIT here
        // (was 1000) sat BELOW the compression trigger (1000 blocks ≈ 290k tokens < 500k), so it
        // clamped the window and — with ASC ordering — froze it at the oldest 1000 blocks, which in
        // turn capped real input_tokens below the 500k trigger so compression never fired and never
        // advanced the floor: a self-lock (see cache-replay-consistency 'self-lock' regression).
        // Runaway growth (a genuinely stalled compression) is now caught LOUDLY by the token-based
        // compression-overrun halt valve, not silently by truncating history.
        unbounded: true
      }) as Array<Record<string, unknown>>;
    } catch (error) {
      moduleLogger.warn('Failed to load Xiaoni stack history blocks', {
        traceId,
        effectiveFloor,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
    return rows.map((row) => mapStackRowToHistoryBlock(row));
  }

  private async runCacheHeartbeatDuringRecovery(): Promise<CacheHeartbeatRunResult> {
    const queueMessage = buildRuntimeLoopFrameQueueMessage();
    const built = await this.buildCacheHeartbeatCanonicalRequest(queueMessage.payload);
    if (!built) {
      return {
        triggered: false,
        reason: 'request_builder_unavailable',
        executionMode: CACHE_HEARTBEAT_EXECUTION_MODE,
        traceId: queueMessage.traceId,
        runId: queueMessage.id
      };
    }

    const modelResult = await this.executeCacheHeartbeatTurn(
      built.canonicalRequest,
      queueMessage.payload,
      built.runtimePrompt
    );
    const result = this.buildCacheHeartbeatRunResult(queueMessage, built.canonicalRequest, built.runtimePrompt, modelResult);
    moduleLogger.info('Xiaoni cache heartbeat completed', {
      traceId: result.traceId,
      runId: result.runId,
      model: result.model,
      provider: result.provider,
      cachedInputTokens: result.cachedInputTokens
    });
    await this.persistCacheHeartbeatForkLedger(result);
    return result;
  }

  // Persist one cache_heartbeat_fork_items ledger row so the heartbeat fork gets a real
  // global occurred_seq and sorts inline in the action stream (it runs store=false and
  // never appends to the agent stack, so this ledger is its only ordering anchor). The
  // reader joins occurred_seq back by llm_call_id / run_id. Best-effort: a write failure
  // must never fail the heartbeat itself.
  private async persistCacheHeartbeatForkLedger(result: CacheHeartbeatRunResult) {
    if (!result.triggered) {
      return;
    }
    const store = this.store as RuntimeStore & {
      recordCacheHeartbeatForkRun?: RuntimeStore['recordCacheHeartbeatForkRun'];
    };
    if (typeof store.recordCacheHeartbeatForkRun !== 'function') {
      return;
    }
    try {
      await store.recordCacheHeartbeatForkRun.call(this.store, {
        llmCallId: result.llmCallId ?? null,
        llmRequestSliceId: result.llmCallId ?? null,
        traceId: result.traceId ?? null,
        runId: result.runId ?? null,
        modelName: result.model ?? null,
        modelProvider: result.provider ?? null,
        status: 'completed',
        content: {
          inputTokens: result.inputTokens ?? null,
          outputTokens: result.outputTokens ?? null,
          totalTokens: result.totalTokens ?? null,
          cachedInputTokens: result.cachedInputTokens ?? null,
          processingTimeMs: result.processingTimeMs ?? null
        },
        metadata: {
          executionMode: result.executionMode,
          promptName: result.promptName ?? null,
          promptCacheKey: result.promptCacheKey ?? null
        }
      });
    } catch (error) {
      moduleLogger.warn('Failed to persist Xiaoni cache heartbeat fork ledger', {
        traceId: result.traceId,
        runId: result.runId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private buildCacheHeartbeatRunResult(
    queueMessage: QueueMessageRecord,
    canonicalRequest: CanonicalAgentTurnRequest,
    runtimePrompt: ResolvedAgentRuntimePrompt,
    modelResult: ProviderAgentResponse
  ): CacheHeartbeatRunResult {
    return {
      triggered: true,
      executionMode: CACHE_HEARTBEAT_EXECUTION_MODE,
      traceId: queueMessage.traceId,
      runId: queueMessage.id,
      promptName: runtimePrompt.promptName,
      model: modelResult.model || runtimePrompt.modelName || null,
      provider: modelResult.provider || null,
      llmCallId: modelResult.llm_call_id || modelResult.llm_request_slice_id || null,
      promptCacheKey: canonicalRequest.prompt_cache_key || null,
      store: canonicalRequest.store ?? null,
      maxOutputTokens: canonicalRequest.max_output_tokens ?? null,
      inputTokens: readOptionalNumber(modelResult.usage?.input_tokens),
      outputTokens: readOptionalNumber(modelResult.usage?.output_tokens),
      totalTokens: readOptionalNumber(modelResult.usage?.total_tokens),
      cachedInputTokens: readOptionalNumber(modelResult.usage_details?.cached_input_tokens),
      processingTimeMs: readOptionalNumber(modelResult.performance?.processing_time_ms)
    };
  }

  private async buildCacheHeartbeatCanonicalRequest(queueMessage: QueueMessageRecord['payload']): Promise<{
    canonicalRequest: CanonicalAgentTurnRequest;
    runtimePrompt: ResolvedAgentRuntimePrompt;
  } | null> {
    const store = this.store as RuntimeStore & {
      getSessionReadCutoffState?: RuntimeStore['getSessionReadCutoffState'];
      listAgentStackItems?: RuntimeStore['listAgentStackItems'];
    };
    if (typeof store.getSessionReadCutoffState !== 'function' || typeof store.listAgentStackItems !== 'function') {
      return null;
    }

    // The heartbeat reproduces the request the NEXT fresh wake-up / switch-on run will send: a
    // fresh frame (loopContinuation:[], suppress current trigger) over the CURRENT committed
    // context. That is the entry the next run hits — independent of whatever the agent was doing
    // before it slept / was switched off (mid-run LC, mid-compression). It is NOT a clone of the
    // last persisted request: cloning a mid-run request (with an in-flight loopContinuation) would
    // warm [history, LC], which the fresh wake run — durable prefix [history] — would MISS, cold-
    // reading the whole history. buildContextBudgetPlan is deterministic over the committed state,
    // so this rebuild is byte-identical to the wake run's request (see the 'cache continuity' and
    // 'wall-clock drift' regressions).
    const contextSessionKey = getGlobalPromptContextSessionKey();
    const cutoffState = await store.getSessionReadCutoffState.call(this.store, contextSessionKey);
    const history = await this.loadStackHistoryBlocks(cutoffState, queueMessage.traceId);
    const runtimePrompt = await this.resolveStableRuntimePrompt(queueMessage);
    const runtimeIdentityFacts = await this.loadRuntimeIdentityFacts(queueMessage);
    const baseDeveloperContextBlock = await this.buildDeveloperContextBlock(queueMessage);
    const runtimeEnergyState = await this.getCurrentRuntimeEnergyState(queueMessage);
    const developerContextBlock = [
      baseDeveloperContextBlock
    ].filter((part): part is string => Boolean(part && part.trim())).join('\n\n') || null;
    const buildBudgetPlan = (appendSelfContinuationOnTerminalFinalAnswer: boolean) => this.buildContextBudgetPlan({
      history,
      queueMessage,
      runtimePrompt,
      loopContinuation: [],
      runtimeIdentityFacts,
      developerContextBlock,
      runtimeEnergyState,
      contextSessionKey,
      cutoffState,
      triggerInputMode: 'suppress_current_trigger',
      appendSelfContinuationOnTerminalFinalAnswer
    });
    // F1: do NOT append the self-continuation tail, even when the raw history ends in an
    // assistant final_answer. The heartbeat's target is the entry the next NOTIFY-driven wake run
    // hits — that run is queue-backed, so it does NOT append a self-continuation
    // (shouldAllowSelfContinuationOnTerminalFinalAnswer requires !queueBacked). The self-cont item
    // is DURABLE (buildUserSceneInputItem, role:'user'), so appending it would move the tail
    // breakpoint to [..history, self-cont]; the notify wake's [..history] was never written as a
    // breakpoint and would cold-read the whole history. Warming the plain [..history] gives the
    // notify wake a full hit and a self-continuation wake a near-full hit (only its 1-item tail
    // cold). The buildBudgetPlan(true) overload is retained for callers that genuinely self-continue.
    const budgetPlan = await buildBudgetPlan(false);

    return {
      canonicalRequest: buildCacheHeartbeatForkRequest(
        buildMainAgentCanonicalRequest(runtimePrompt, budgetPlan.requestInput, queueMessage)
      ),
      runtimePrompt
    };
  }

  // Effective energy policy (code defaults + admin overrides, hot-reloaded via runtime-store cache).
  // Fails soft to code defaults. Used at the recovery decision/snapshot sites below so the
  // admin-configured forced/onset thresholds + sleep/full-recovery timing apply without restart.
  private async resolveEffectiveEnergyPolicy(): Promise<EffectiveEnergyPolicy> {
    const store = this.store as RuntimeStore & {
      getEffectiveEnergyPolicy?: () => Promise<EffectiveEnergyPolicy>;
    };
    if (typeof store.getEffectiveEnergyPolicy === 'function') {
      try {
        return await store.getEffectiveEnergyPolicy.call(this.store);
      } catch (error) {
        moduleLogger.warn('Failed to resolve effective energy policy; using code defaults', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return { policy: DEFAULT_RECOVER_ENERGY_POLICY, actionCostScale: DEFAULT_ACTION_COST_SCALE };
  }

  private async reconcileActiveRecoverySession(_params: AgentRuntimeIterationParams): Promise<{
    status: 'none' | 'active' | 'settled';
    inputItems: OpenResponseInputItem[];
    session?: RecoverySessionHeartbeatState | null;
  }> {
    const store = this.store as RuntimeStore & {
      getActiveAgentRecoverySession?: RuntimeStore['getActiveAgentRecoverySession'];
      listAgentRecoveryWakeNotifications?: RuntimeStore['listAgentRecoveryWakeNotifications'];
      updateAgentRecoverySessionProgress?: RuntimeStore['updateAgentRecoverySessionProgress'];
      finalizeAgentRecoverySession?: RuntimeStore['finalizeAgentRecoverySession'];
      createAgentRecoverySession?: RuntimeStore['createAgentRecoverySession'];
      recordRecoverySessionLifeEvent?: RuntimeStore['recordRecoverySessionLifeEvent'];
    };

    if (typeof store.getActiveAgentRecoverySession !== 'function') {
      return { status: 'none', inputItems: [] };
    }

    let session = await store.getActiveAgentRecoverySession.call(this.store);
    if (!session) {
      const recoveryWakeCountStartQueueMessageId = await this.readRecoveryQueueHighWatermark();
      const energyState = await this.getCurrentRuntimeEnergyState(buildRuntimeLoopFrameQueueMessage().payload).catch(() => null);
      const pressure = energyState ? 1 - (energyState.energy / Math.max(0.001, energyState.maxEnergy)) : 0;
      const effectiveEnergyPolicy = await this.resolveEffectiveEnergyPolicy();
      if (!energyState || pressure < effectiveEnergyPolicy.policy.forcedSleepPressure || typeof store.createAgentRecoverySession !== 'function') {
        return { status: 'none', inputItems: [] };
      }
      const startedAt = new Date();
      const policySnapshot = createRecoveryPolicySnapshot(startedAt, effectiveEnergyPolicy.policy);
      const sessionPolicy = recoverySessionPolicyFromSnapshot(policySnapshot)!;
      const naturalWakeAt = estimateNaturalWakeAt({
        startEnergy: energyState.energy,
        maxEnergy: energyState.maxEnergy,
        startedAt,
        policy: sessionPolicy.policy
      });
      session = await store.createAgentRecoverySession.call(this.store, {
        initiator: 'runtime_forced',
        reason: '精力已经透支，工程强制进入休息恢复。',
        xiaoniOs: null,
        startedAt,
        startEnergy: energyState.energy,
        currentEnergy: energyState.energy,
        maxEnergy: energyState.maxEnergy,
        startPressure: pressure,
        currentPressure: pressure,
        plannedNaturalWakeAt: naturalWakeAt,
        hardWakeAt: estimateSessionWakeAt(startedAt, sessionPolicy),
        wakeCountStartQueueMessageId: recoveryWakeCountStartQueueMessageId,
        metadata: {
          source: 'runtime_forced_recovery',
          forced_sleep_pressure: effectiveEnergyPolicy.policy.forcedSleepPressure,
          recovery_policy_snapshot: policySnapshot
        }
      });
      moduleLogger.warn('Started forced Xiaoni recovery session', {
        recoverySessionId: session?.id,
        energy: energyState.energy,
        pressure
      });
      return { status: 'active', inputItems: [], session: session ? { id: session.id } : null };
    }

    const lastCountedId = Math.max(
      Number(session.lastWakeCountedQueueMessageId || 0),
      Number(session.wakeCountStartQueueMessageId || 0)
    );
    const wakeRows = typeof store.listAgentRecoveryWakeNotifications === 'function'
      ? await store.listAgentRecoveryWakeNotifications.call(this.store, {
          afterQueueMessageId: lastCountedId,
          limit: 250
        }).catch((error) => {
          moduleLogger.warn('Failed to scan recovery wake notifications', {
            recoverySessionId: session?.id,
            error: error instanceof Error ? error.message : String(error)
          });
          return [];
        })
      : [];
    const wakeIncrement = wakeRows.reduce((sum, row) => sum + Math.max(0, Number(row.wakeCount || 0)), 0);
    const lastWakeCountedId = wakeRows.length > 0
      ? Math.max(...wakeRows.map((row) => Number(row.id || 0)))
      : lastCountedId;
    const wakeCallCount = Math.max(0, Number(session.wakeCallCount || 0)) + wakeIncrement;
    const sessionPolicy = recoverySessionPolicyFromMetadata(session.metadata);
    const isNightNaturalRecovery = sessionPolicy.version !== LEGACY_RECOVER_ENERGY_POLICY_VERSION
      && sessionPolicy.circadian.phase === 'night'
      && !session.clockDueAt;
    const projection = projectRecoverySession({
      startEnergy: Number(session.startEnergy ?? session.currentEnergy ?? 0),
      maxEnergy: Number(session.maxEnergy || 1),
      startedAt: session.startedAt || new Date(),
      now: new Date(),
      clockDueAt: session.clockDueAt,
      clockDeferredAt: session.clockDeferredAt,
      wakeCallCount,
      policy: sessionPolicy.policy,
      sessionMaxRecoveryMinutes: sessionPolicy.sessionMaxRecoveryMinutes,
      sessionCapWakeCause: sessionPolicy.sessionCapWakeCause,
      suppressNaturalWakeBeforeSessionCap: isNightNaturalRecovery,
      shapeWakeCallsBySessionProgress: isNightNaturalRecovery
    });
    const clockDeferredAt = projection.clockShouldDefer && !session.clockDeferredAt ? new Date() : null;

    if (!projection.shouldWake) {
      if (typeof store.updateAgentRecoverySessionProgress === 'function') {
        await store.updateAgentRecoverySessionProgress.call(this.store, {
          id: session.id,
          wakeCallCount,
          wakeRequiredCount: Number.isFinite(projection.wakeRequiredCount) ? projection.wakeRequiredCount : null,
          lastWakeCountedQueueMessageId: lastWakeCountedId,
          currentPressure: projection.pressure,
          currentEnergy: projection.energy,
          plannedNaturalWakeAt: estimateNaturalWakeAt({
            startEnergy: Number(session.startEnergy ?? session.currentEnergy ?? 0),
            maxEnergy: Number(session.maxEnergy || 1),
            startedAt: new Date(session.startedAt || new Date()),
            policy: sessionPolicy.policy
          }),
          hardWakeAt: estimateSessionWakeAt(new Date(session.startedAt || new Date()), sessionPolicy),
          clockDeferredAt,
          lastCheckedAt: new Date()
        }).catch((error) => {
          moduleLogger.warn('Failed to update recovery progress', {
            recoverySessionId: session?.id,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }
      return { status: 'active', inputItems: [], session: { id: session.id } };
    }

    const toolResult = this.buildRecoverySessionResult(session, projection, {
      wakeCallCount,
      lastWakeCountedQueueMessageId: lastWakeCountedId
    });
    const inputItems = await this.settleRecoverySession(session, toolResult, projection, {
      wakeCallCount,
      lastWakeCountedQueueMessageId: lastWakeCountedId
    });
    if (inputItems.length === 0) {
      return { status: 'active', inputItems: [], session: { id: session.id } };
    }
    if (typeof store.recordRecoverySessionLifeEvent === 'function') {
      await store.recordRecoverySessionLifeEvent.call(this.store, session, toolResult).catch((error) => {
        moduleLogger.warn('Failed to record recovery session life event', {
          recoverySessionId: session?.id,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }
    return { status: 'settled', inputItems, session: { id: session.id } };
  }

  private buildRecoverySessionResult(
    session: {
      id: number;
      reason: string | null;
      xiaoniOs: string | null;
      clockMinutes: number | null;
      clockDueAt: string | null;
      clockDeferredAt: string | null;
      startedAt: string | null;
      startEnergy: number | null;
      maxEnergy: number;
      metadata?: Record<string, unknown>;
    },
    projection: ReturnType<typeof projectRecoverySession>,
    counts: {
      wakeCallCount: number;
      lastWakeCountedQueueMessageId: number;
    }
  ) {
    const startedAt = session.startedAt ? new Date(session.startedAt) : new Date();
    const elapsedMs = Math.max(0, Date.now() - startedAt.getTime());
    const sessionPolicy = recoverySessionPolicyFromMetadata(session.metadata);
    const recoveredEnergy = {
      rawEnergyBefore: Number(session.startEnergy ?? projection.energy),
      startEnergy: Number(session.startEnergy ?? projection.energy),
      energy: projection.energy,
      maxEnergy: Number(session.maxEnergy || 1),
      debt: Number(session.startEnergy ?? 0) < 0 ? Math.abs(Number(session.startEnergy ?? 0)) : 0,
      elapsedMs,
      fullRecoveryMs: sessionPolicy.fullRecoveryMinutes * 60 * 1000,
      pressure: projection.pressure,
      startPressure: projection.startPressure
    };
    const batchFinalRecoveryTimeline = renderRecoverEnergyBatchFinalTimeline({
      metadata: session.metadata,
      recoveryStartedAt: startedAt
    });
    return {
      recovered: true,
      rest_rejected: false,
      recovery_session_id: session.id,
      reason: session.reason,
      xiaoni_os: session.xiaoniOs,
      wake_cause: projection.wakeCause,
      sleep_minutes: Math.max(0, Math.round(projection.elapsedMinutes)),
      clock_minutes: session.clockMinutes,
      energy_before: recoveredEnergy.rawEnergyBefore,
      energy_start: recoveredEnergy.startEnergy,
      energy: recoveredEnergy.energy,
      max_energy: recoveredEnergy.maxEnergy,
      recovered_energy: recoveredEnergy.energy - recoveredEnergy.startEnergy,
      energy_debt: recoveredEnergy.debt,
      pressure: projection.pressure,
      start_pressure: projection.startPressure,
      full_recovery_minutes: sessionPolicy.fullRecoveryMinutes,
      session_max_recovery_minutes: sessionPolicy.sessionMaxRecoveryMinutes,
      session_cap_wake_cause: sessionPolicy.sessionCapWakeCause,
      wake_call_count: counts.wakeCallCount,
      wake_required_count: Number.isFinite(projection.wakeRequiredCount) ? projection.wakeRequiredCount : null,
      last_wake_counted_queue_message_id: counts.lastWakeCountedQueueMessageId,
      energy_cost: RUNTIME_TOOL_COSTS[TOOL_NAMES.recoverEnergy],
      system_reminder: renderRecoverEnergyCompletedReminder({
        reason: session.reason,
        xiaoniOs: session.xiaoniOs,
        wakeCause: projection.wakeCause,
        sleepMinutes: projection.elapsedMinutes,
        wakeCallCount: counts.wakeCallCount,
        wakeRequiredCount: Number.isFinite(projection.wakeRequiredCount) ? projection.wakeRequiredCount : null,
        clockMinutes: session.clockMinutes,
        recoveredEnergy,
        batchFinalRecoveryTimeline,
        // Path B (D5): 唤醒返回文本【一律】不再携带睡前笔记。recover_energy 仍保留 xiaoni_os 参数
        // (供 agent_recovery_sessions + tool args 的 ops 展示)，但不再回灌进醒来后的上下文——她的
        // 睡前心里话若想续，走 assistant type:text 心理评估门那条通道，不靠这里重现。冻结于 render 期、
        // 持久化 verbatim(replay 不重渲染)，故 forward-only、旧提醒不改、cache-safe。
        hideXiaoniOs: true
      })
    };
  }

  private async settleRecoverySession(
    session: {
      id: number;
      initiator: string;
      toolCallId: string | null;
      toolExecutionId: string | null;
      llmRequestSliceId: string | null;
      traceId: string | null;
      runId: string | null;
      conversationId?: number | null;
      metadata?: Record<string, unknown>;
    },
    toolResult: Record<string, unknown>,
    projection: ReturnType<typeof projectRecoverySession>,
    counts: {
      wakeCallCount: number;
      lastWakeCountedQueueMessageId: number;
    }
  ): Promise<OpenResponseInputItem[]> {
    const store = this.store as RuntimeStore & {
      finalizeAgentRecoverySession?: RuntimeStore['finalizeAgentRecoverySession'];
    };
    const now = new Date();
    const isVoluntary = session.initiator === 'recover_energy_tool' && typeof session.toolCallId === 'string' && session.toolCallId.length > 0;
    const sessionMetadata = session.metadata && typeof session.metadata === 'object' ? session.metadata : {};
    const rawToolArgs = sessionMetadata.tool_args && typeof sessionMetadata.tool_args === 'object' && !Array.isArray(sessionMetadata.tool_args)
      ? sessionMetadata.tool_args as Record<string, unknown>
      : {};
    const rawArguments = typeof sessionMetadata.raw_arguments === 'string'
      ? sessionMetadata.raw_arguments
      : JSON.stringify(rawToolArgs);
    const wakeSystemReminder = String(toolResult.system_reminder || '').trim();
    const inputItems: OpenResponseInputItem[] = isVoluntary
      ? [{
          type: 'function_call_output',
          call_id: session.toolCallId!,
          output: wakeSystemReminder
        }]
      : [buildDeveloperInputItem([wakeSystemReminder]) as OpenResponseInputItem];

    if (isVoluntary) {
      // The original recover_energy function_call is already part of the stack
      // replay from the pre-sleep model slice. The wake callback must append
      // only the matching output, otherwise the next provider request sees the
      // same call_id twice and one of the calls has no distinct output.
      const toolCall: AgentToolCall = {
        callId: session.toolCallId!,
        name: TOOL_NAMES.recoverEnergy,
        args: rawToolArgs,
        rawArguments
      };
      const rows = await this.appendAgentStackItemsSafe({
        traceId: session.traceId || `recovery:${session.id}`,
        runId: session.runId || `recovery:${session.id}`,
        conversationId: session.conversationId ?? null,
        sourceType: 'agent_recovery_sessions',
        sourceId: String(session.id),
        llmRequestSliceId: session.llmRequestSliceId || null,
        items: buildToolResultStackItems({
          toolCall,
          toolResult,
          continuationItems: inputItems,
          llmRequestSliceId: session.llmRequestSliceId || `recovery:${session.id}`
        }) as Array<Record<string, unknown>>
      });
      if (session.toolExecutionId) {
        await this.completeAgentStackToolExecutionSafe({
          executionId: session.toolExecutionId,
          status: 'completed',
          result: toolResult,
          stackOutputItemId: (rows[0] as { id?: string | number } | undefined)?.id || null
        });
      }
    } else {
      await this.appendAgentStackItemsSafe({
        traceId: session.traceId || `recovery:${session.id}`,
        runId: session.runId || `recovery:${session.id}`,
        conversationId: session.conversationId ?? null,
        sourceType: 'agent_recovery_sessions',
        sourceId: String(session.id),
        items: [{
          eventId: `stack:recovery-session:${session.id}:runtime-reminder`,
          itemKind: 'runtime_input',
          role: 'developer',
          phase: null,
          content: {
            source: 'agent_recovery_sessions',
            recovery_session_id: session.id,
            input_items: inputItems,
            system_reminder: toolResult.system_reminder || null
          },
          visibility: 'model_visible',
          metadata: {
            wake_cause: projection.wakeCause,
            initiator: session.initiator
          }
        }]
      });
    }

    if (typeof store.finalizeAgentRecoverySession === 'function') {
      await store.finalizeAgentRecoverySession.call(this.store, {
        id: session.id,
        status: 'completed',
        wakeCause: projection.wakeCause,
        endedAt: now,
        clockFiredAt: projection.clockDue ? now : null,
        wakeCallCount: counts.wakeCallCount,
        wakeRequiredCount: Number.isFinite(projection.wakeRequiredCount) ? projection.wakeRequiredCount : null,
        lastWakeCountedQueueMessageId: counts.lastWakeCountedQueueMessageId,
        currentPressure: projection.pressure,
        currentEnergy: projection.energy,
        result: toolResult
      });
    }

    return inputItems;
  }

  private async processRuntimeFrame(queueMessage: QueueMessageRecord, frameOptions: ProcessRuntimeFrameOptions = {}) {
    const options = normalizeRuntimeFrameOptions(frameOptions);
    const startedAt = Date.now();
    const payload = queueMessage.payload;
    const inboundContext = payload.inboundContext;
    const sessionIds = resolveSessionTargets(payload);
    // 甲 (self-driven <xiaoni_plan> durable consume): the plan notify is consumed through the
    // NORMAL notify path — rendered into requestInput and appended to the durable stack exactly
    // like a QQ notify, so it is frozen at the point of consumption and replayed byte-for-byte
    // thereafter (she re-reads her own subconscious direction from history). No one-shot overlay,
    // no reseed re-injection, no memory slot — this is the pre-one-shot model restored.
    // Cache: this is the same run-boundary path every normal notify rides — the current-turn
    // trigger is cache_volatile in the live tail and its frozen stack row reproduces the same
    // bytes on the next run's replay, so the cacheable prefix stays byte-identical.
    let jobId: string | null = null;
    const recoveryWakeCountStartQueueMessageId = typeof options.recoveryWakeCountStartQueueMessageId === 'number'
      && Number.isFinite(options.recoveryWakeCountStartQueueMessageId)
      ? Math.max(0, Math.floor(options.recoveryWakeCountStartQueueMessageId))
      : await this.readRecoveryQueueHighWatermark();

    let conversationId: number | null = null;
    let turnsExecuted = 0;
    let deliveredMessages: DeliveredAssistantMessage[] = [];
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
      currentTurnInputItems: [],
      selfContinuationInputItem: null,
      summarySourceInput: null,
      retainedHistory: [],
      runtimeIdentityFacts: [],
      readCutoffAfterStackIndex: null,
      previousReadCutoffAfterStackIndex: null,
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

    if (options.logQueueLifecycle) {
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
    }
    if (options.queueBacked) {
      jobId = await this.store.createLlmJob({
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
      await this.store.logTimelineEvent({
        traceId: payload.traceId,
        eventType: 'decision',
        eventName: 'execution_lease',
        eventPhase: 'start',
        metadata: { internal_execution_lease_id: queueMessage.id, batch_id: queueMessage.batchId }
      });
    }
    let loopContinuation: OpenResponseInputItem[] = [...options.initialLoopContinuation];
    const continuationQueueMessages: QueueMessageRecord[] = [];

    try {
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
      const contextSessionKey = getGlobalPromptContextSessionKey();
      const cutoffState = await this.store.getSessionReadCutoffState(contextSessionKey);
      const history = await this.loadStackHistoryBlocks(cutoffState, payload.traceId);
      historyCount = history.length;
      const allowSelfContinuationOnTerminalFinalAnswer = shouldAllowSelfContinuationOnTerminalFinalAnswer(options);

      const resolvedRuntimePrompt = await this.resolveStableRuntimePrompt(payload);
      runtimePrompt = resolvedRuntimePrompt;
      runtimeIdentityFacts = await this.loadRuntimeIdentityFacts(payload);
      const baseDeveloperContextBlock = await this.buildDeveloperContextBlock(payload);
      const initialRuntimeEnergyState = await this.getCurrentRuntimeEnergyState(payload);
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
        baseDeveloperContextBlock
      ].filter((part): part is string => Boolean(part && part.trim())).join('\n\n') || null;
      const buildBudgetPlan = (appendSelfContinuationOnTerminalFinalAnswer: boolean) => this.buildContextBudgetPlan({
        history,
        queueMessage: payload,
        runtimePrompt: resolvedRuntimePrompt,
        loopContinuation,
        runtimeIdentityFacts,
        developerContextBlock,
        runtimeEnergyState: initialRuntimeEnergyState,
        contextSessionKey,
        cutoffState,
        triggerInputMode: options.triggerInputMode,
        appendSelfContinuationOnTerminalFinalAnswer,
        loopContinuationBeforeCurrentTrigger: options.initialLoopContinuationBeforeCurrentTrigger
      });
      let appendSelfContinuationOnTerminalFinalAnswer = false;
      budgetPlan = await buildBudgetPlan(false);
      if (allowSelfContinuationOnTerminalFinalAnswer) {
        // Detect from raw history: D is stripped from requestInput, so its last item is no
        // longer a final_answer, but we still want to nudge self-continuation when she just
        // settled on one.
        if (lastHistoryTurnEndsWithAssistantFinalAnswer(history)) {
          appendSelfContinuationOnTerminalFinalAnswer = true;
          budgetPlan = await buildBudgetPlan(true);
        }
      }
      await this.ensureRuntimeIdentityRoot(payload, resolvedRuntimePrompt);
      if (!jobId) {
        jobId = await this.store.createLlmJob({
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
        await this.store.logTimelineEvent({
          traceId: payload.traceId,
          eventType: 'decision',
          eventName: 'execution_lease',
          eventPhase: 'start',
          metadata: { internal_execution_lease_id: queueMessage.id, batch_id: queueMessage.batchId }
        });
      }
      // Compute evicted turns once at the start: turns pushed out by the new cutoff that
      // weren't already excluded by the previous cutoff.
      const evictedTurns: ConversationTurn[] = budgetPlan.cutoffRecomputed && budgetPlan.readCutoffAfterStackIndex !== null
        ? history.filter((t) =>
            t.id <= budgetPlan.readCutoffAfterStackIndex! &&
            (budgetPlan.previousReadCutoffAfterStackIndex === null || t.id > budgetPlan.previousReadCutoffAfterStackIndex)
          )
        : [];
      let requestInput = budgetPlan.requestInput;
      // The read cutoff THIS run's requestInput is currently built with. A mid-run STW
      // compression switch advances it (see applyPendingCompressionMidRunIfSilent).
      let appliedRunCutoff: number | null = budgetPlan.readCutoffAfterStackIndex ?? null;
      let pendingOneShotInputItems: OpenResponseInputItem[] = [];
      // NOTE: compression is NOT scheduled here any more. It used to fire once, right here, before
      // the first LLM request of the activation — which meant a long stretch of work could sit far
      // past the trigger line for its whole duration (observed: armed at 17:49, fork did not start
      // until 19:31, ~495 requests later, because that stretch never ended). The trigger counter is
      // updated after EVERY LLM request, so the check now lives next to that signal, inside the
      // loop (see maybeScheduleCompressionFromLiveStack). The turn-1 case is covered there too: the
      // first pass through the loop runs the same check before the first request, using the counter
      // restored from the previous activation.
      const appendLoopInputItems = (items: OpenResponseInputItem[]) => {
        if (items.length === 0) {
          return;
        }
        loopContinuation.push(...items);
        requestInput.push(...items);
      };
      const appendOneShotInputItems = (items: OpenResponseInputItem[]) => {
        if (items.length === 0) {
          return;
        }
        pendingOneShotInputItems.push(...items);
      };
      // Snapshot the xiaoni_os isolation toggle ONCE per run so a mid-run admin flip can't make
      // this run's live requests inconsistent with its own replay. The frozen value stamps every
      // os-bearing tool item this run produces (below); later runs read each item's own frozen
      // flag from the stack, so cross-run replay matches this run's live request byte-for-byte.
      const stripXiaoniOsHiddenSnapshot = STRIP_XIAONI_OS_FROM_REQUESTS;
      const appendAvailableQueueNotifyToLoop = async () => {
        if (!options.queueBacked) {
          return;
        }
        if (!runtimePrompt) {
          return;
        }
        // Fold the pending notify into the ALREADY-RUNNING parent run instead of
        // claiming it as a new run. Keying it to the parent run/batch means it
        // rides the parent's settle/fail/retry lifecycle: acked only when this run
        // succeeds, reset to pending (reprocessed, not dropped) if the run fails
        // transiently. The old path used claimNextQueueMessage, which minted a
        // phantom run/batch row (the "two runs on one conversation" artifact) and
        // acked the message at fold time, losing it when the parent failed.
        const folder = (this.store as RuntimeStore & {
          foldPendingNotifyIntoRun?: RuntimeStore['foldPendingNotifyIntoRun'];
        }).foldPendingNotifyIntoRun;
        if (typeof folder !== 'function') {
          return;
        }
        const claimed = await folder.call(this.store, {
          parentRunId: queueMessage.id,
          parentBatchId: queueMessage.batchId,
          workerId: agentConfig.workerId
        });
        if (!claimed) {
          return;
        }
        continuationQueueMessages.push(claimed);
        // 折叠进正在跑的 run 也是消费。同上,fire-and-forget,零缓存影响。
        fireConsumedNotifyRecall(claimed.payload as unknown as Record<string, unknown>);
        const claimedInputItems = buildCurrentTurnInputItems(claimed.payload, runtimePrompt)
          .filter((item) => !isOpenResponseMessageInputItem(item) || flattenMessageContent(item.content).trim().length > 0);
        // A folded self-driven <xiaoni_plan> notify is consumed durably like any other folded
        // notify: appended to the loop input AND written as a durable stack row, so the next
        // run's replay reproduces it byte-for-byte (frozen at consumption, no re-injection).
        if (claimedInputItems.length > 0) {
          appendLoopInputItems(claimedInputItems);
        }
        await this.appendAgentStackItemsSafe({
          traceId: claimed.payload.traceId,
          runId: claimed.id,
          sourceType: 'agent_queue_messages',
          sourceId: claimed.id,
          items: [
            buildRuntimeInputStackItem({
              queueMessage: claimed.payload,
              runId: claimed.id,
              runtimePrompt,
              precomputedInputItems: claimedInputItems,
              // Key the dedupe event_id on the exact queue message(s) folded here, so two
              // reminders of the SAME QQ event (shared evt_ trace_id) get distinct stack
              // items instead of the second colliding away. Without this the next run's
              // replay rebuilds a shorter body and busts the prompt cache at the run boundary.
              queueMessageIds: claimed.queueMessageIds
            }) as Record<string, unknown>
          ]
        });
        await this.store.logTimelineEvent({
          traceId: payload.traceId,
          eventType: 'queue',
          eventName: 'nonblocking_notify_append',
          eventPhase: null,
          metadata: {
            source_run_id: queueMessage.id,
            appended_run_id: claimed.id,
            appended_batch_id: claimed.batchId,
            appended_queue_message_ids: claimed.queueMessageIds,
            appended_source: claimed.payload.source
          }
        }).catch((error) => {
          moduleLogger.warn('Failed to log nonblocking notify append', {
            traceId: payload.traceId,
            runId: queueMessage.id,
            appendedRunId: claimed.id,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      };
      let leaseRelease: LeaseReleaseRecord | null = null;
      let deliveryState = await this.store.getExecutionLeaseDeliveryState(queueMessage.id);
      if (options.appendRuntimeInputStackItem) {
        // The current-turn trigger — including a self-driven <xiaoni_plan> — is persisted as a
        // durable runtime_input row so the next run's replay reproduces it byte-for-byte (frozen
        // at consumption). This is the normal notify path; the plan is no longer special-cased.
        await this.appendAgentStackItemsSafe({
          traceId: payload.traceId,
          runId: queueMessage.id,
          sourceType: options.queueBacked ? 'agent_queue_messages' : 'agent_runtime',
          sourceId: queueMessage.id,
          items: [
            buildRuntimeInputStackItem({
              queueMessage: payload,
              runId: queueMessage.id,
              runtimePrompt,
              precomputedInputItems: budgetPlan.currentTurnInputItems
            }) as Record<string, unknown>
          ]
        });
      }
      const selfContinuationInputItem = budgetPlan.selfContinuationInputItem;
      if (selfContinuationInputItem) {
        await this.appendAgentStackItemsSafe({
          traceId: payload.traceId,
          runId: queueMessage.id,
          sourceType: 'agent_runtime',
          sourceId: queueMessage.id,
          items: [
            buildLoopSelfContinuationStackItem({
              queueMessage: payload,
              runId: queueMessage.id,
              turn: 1,
              inputItem: selfContinuationInputItem
            }) as Record<string, unknown>
          ]
        });
      }

      // 空转记账用的 run 级累加器：这一整个 run 有没有有效产出。
      // 普通工具判在发出那一刻;recover_energy 按【结果】判——身体接受(真睡着)算,被拒(睡不着)不算。
      let runTouchedWorld = false;
      // 作废判定用的更严累加器：这一整个 run 有没有调过【任何】工具——含 recover_energy。
      // 与 runTouchedWorld 分开:睡一觉不算「干活」(计数不归零),但睡过的 run 不许作废
      // (把 recover_energy 调用/结果从栈上蒸发会让她时间错乱)。
      let runCalledAnyTool = false;

      for (let turn = 1; ; turn += 1) {
        await this.waitForRuntimeEnabledBeforeModelSlice(payload, queueMessage.id);
        await this.yieldBeforeMainAgentModelSlice();
        // REQ2 STW: between LLM requests (previous response fully landed on the stack, next
        // request not built yet) is a silent point — if a background compression fork has
        // committed a new context window and all forks have drained, atomically switch to the
        // compressed (smaller) context now. Costs one cold prefill; every later request +
        // cloned fork rides the new warm cache.
        const midRunCompressionApply = await this.applyPendingCompressionMidRunIfSilent({
          contextSessionKey,
          appliedRunCutoff,
          fullHistory: history,
          loopContinuation,
          queueMessage: payload,
          runtimePrompt,
          runtimeIdentityFacts: budgetPlan.runtimeIdentityFacts,
          pendingProactiveShare: budgetPlan.pendingProactiveShare,
          developerContextBlock,
          runtimeEnergyState: initialRuntimeEnergyState,
          precomputedCurrentTurnInputItems: budgetPlan.currentTurnInputItems,
          // The STW rebuild inherits THIS run's trigger mode. A self-driven <xiaoni_plan> wake is
          // now a normal durable notify (no special suppress mode), so the compressed requestInput
          // carries the plan exactly like any other current-turn trigger.
          triggerInputMode: options.triggerInputMode,
          loopContinuationBeforeCurrentTrigger: options.initialLoopContinuationBeforeCurrentTrigger
        });
        if (midRunCompressionApply) {
          requestInput = midRunCompressionApply.requestInput;
          appliedRunCutoff = midRunCompressionApply.appliedCutoff;
        }
        turnsExecuted = turn;
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
          readCutoffAfterStackIndex: budgetPlan.readCutoffAfterStackIndex,
          contextWindowTokens: budgetPlan.contextWindowTokens,
          targetBudgetTokens: budgetPlan.targetBudgetTokens,
          hardBudgetTokens: budgetPlan.hardBudgetTokens,
          tokenizerEncoding: budgetPlan.tokenizerEncoding,
          tokenizerSource: budgetPlan.tokenizerSource,
          cutoffRecomputed: turn === 1 ? budgetPlan.cutoffRecomputed : false
        };
        contextBudgetTurns.push(turnBudgetRecord);
        const currentRequestInputRaw = pendingOneShotInputItems.length > 0
          ? [...requestInput, ...pendingOneShotInputItems]
          : requestInput;
        pendingOneShotInputItems = [];
        // Strip the model's own assistant TEXT from what it actually sees this turn. Cross-run
        // history is already stripped in buildInitialInput; this additionally covers the
        // intra-run tool loop (a prior turn of THIS run carried its narration forward via
        // appendLoopInputItems). requestInput/loopContinuation stay UNstripped so the persisted
        // record (responses_replay_items) and the action-stream card keep the full text — only
        // what the model reads is stripped, so her narration ("现在等小伊回…") never rides
        // forward, not across runs and not within one. function_call/output are kept (tool
        // continuity). Filtering here (not at the append) is idempotent on the already-stripped
        // cross-run prefix, so the warm cache prefix stays byte-identical.
        const currentRequestInput = currentRequestInputRaw.filter((item) => !isReplayItemStrippedByTextGate(item));
        const currentCanonicalRequest = buildMainAgentCanonicalRequest(runtimePrompt, currentRequestInput, payload);
        // Compression is schedulable after ANY LLM request, which is what this call site buys: the
        // trigger counter is updated after every response (below), so the check belongs next to that
        // signal rather than once per activation. Two properties make this position the right one:
        //   - currentCanonicalRequest IS the hot prefix we are about to send, so the fork clones a
        //     warm request (identical treatment to the psych-assessment fork, which clones the same
        //     object a few lines down). No separately-built body, no prefix drift.
        //   - by now the stack holds everything through the PREVIOUS response (model output and tool
        //     results are appended before the loop comes back around), so the cutoff is computed
        //     against a complete ledger.
        // Safe to call unconditionally: scheduleCoreMemoryCompressionFork is idempotent — in-memory
        // single-flight, durable cross-restart single-flight, and an already-covered cutoff check —
        // so a no-op costs one in-memory counter read. The APPLY side still waits for the silent
        // point at the top of the loop; only scheduling moved.
        await this.maybeScheduleCompressionFromLiveStack({
          contextSessionKey: getGlobalPromptContextSessionKey(),
          baseRequest: currentCanonicalRequest,
          queueMessage: payload,
          runtimePrompt,
          // The snapshot this activation rebuilds from on an STW switch. Caps the planned cutoff so
          // the switch can never leave evicted-but-still-sent items behind (see the ceiling note in
          // the callee and in applyPendingCompressionMidRunIfSilent).
          snapshotCeilingStackIndex: history.length > 0 ? history[history.length - 1]!.id : null
        });
        // BYTE-side guard (pre-send): images are token-cheap but byte-huge, so the token overrun valve
        // (below, turn-AFTER real input_tokens) is blind to an image burst that crosses Anthropic's hard
        // 32MB per-request cap. Estimate the assembled wire bytes NOW and, if past the hard line, HALT the
        // run switch BEFORE sending (this request would 413) and end this run — the byte wall can't wait
        // for a turn-after signal. Soft-line over-turns are recorded here too, arming run-boundary
        // compression (OR'd with the token trigger). Timing/ops only — the estimate never enters the
        // cacheable prefix, and the request bytes are unchanged (we either send them or halt).
        const estimatedWireBytes = estimateCanonicalRequestWireBytes(currentCanonicalRequest);
        recordMainTurnWireBytesForCompression(getGlobalPromptContextSessionKey(), estimatedWireBytes);
        if (isWireBytesOverrun(estimatedWireBytes)) {
          // The turn loop's invariant is that every `break` carries a non-null leaseRelease (see the
          // `if (!leaseRelease) continue` guard below) — the post-loop finalize dereferences it
          // unconditionally. Set a no-visible-delivery lease release BEFORE breaking so the halt path
          // runs the normal finalize instead of null-derefing. Zero output: nothing was sent.
          leaseRelease = buildLeaseReleaseRecord({
            reason: 'wire_bytes_overrun',
            detail: 'Assembly-time wire bytes crossed the hard cap before send; request withheld and the runtime halted (run switch OFF, heartbeat warm) for a human to compress and re-enable.',
            outcome: 'wire_bytes_overrun_halted',
            noVisibleDelivery: deliveredMessages.length === 0,
            visibleDeliveryCommitted: deliveredMessages.length > 0,
            source: 'runtime:wire_bytes_overrun_halt'
          });
          await this.haltForWireBytesOverrun(getGlobalPromptContextSessionKey(), payload.traceId, estimatedWireBytes);
          break;
        }
        const inputEndIndex = await this.getAgentStackHeadSafe(payload.traceId);
        const inputStartIndex = inputEndIndex > 0 ? 1 : null;
        const modelResult = await this.executeAgentTurn(
          currentCanonicalRequest,
          payload,
          payload.traceId,
          turn,
          runtimePrompt,
          {
            runId: queueMessage.id,
            inputStartIndex,
            inputEndIndex: inputEndIndex > 0 ? inputEndIndex : null
          }
        );
        attachActualUsageToTurnBudget(turnBudgetRecord, modelResult);
        // Persist the (just incremented/reset) compression-trigger debounce counter so it
        // survives a restart. Fire-and-forget; timing-only, never blocks the turn and never
        // touches the cacheable prefix.
        this.persistCompressionTriggerCounter(getGlobalPromptContextSessionKey());
        // EMERGENCY HALT VALVE: if real input_tokens ran past (trigger + margin) for the debounce
        // window, compression already fired at the trigger and did NOT bring the epoch down. Halt the
        // run switch + keep the heartbeat warm for a clean manual resume, rather than climb toward the
        // model's hard context ceiling. Fire-and-forget; timing-only, never touches the cacheable prefix.
        this.maybeHaltForCompressionOverrun(
          getGlobalPromptContextSessionKey(),
          payload.traceId,
          turnBudgetRecord.actualInputTokens
        );
        const sliceId = modelResult.llm_request_slice_id || modelResult.llm_call_id || `slice:${payload.traceId}:${turn}`;
        const outputItems = extractCanonicalResponseOutputItems(modelResult);
        // A1: freeze the xiaoni_os hide-decision into this turn's model-output tool calls before
        // they fan out to BOTH the stack ledger (buildModelOutputStackItems, content: item) and the
        // live requestInput (appendLoopInputItems) — same refs, one stamp, both copies consistent.
        stampXiaoniOsHiddenInPlace(outputItems as OpenResponseInputItem[], stripXiaoniOsHiddenSnapshot);
        // text_admit 门控(Step3 · 同步阻塞):这一 turn 若产出了 assistant 文本(现在是她的 OS 通道)，同步跑
        // 心理评估 fork 判其正负向，把准入决定就地冻结进 outputItems——与 xiaoni_os_hidden 同一 fan-out 路径
        // (下面 buildModelOutputStackItems 落 stack ledger + appendLoopInputItems 落 live requestInput，同 refs)。
        // 正向 → text_admit:true(下一 run 保留进上下文)；消极/无判定/fork 失败 → 不打 stamp = 默认剥(fail-closed)。
        // currentCanonicalRequest 是本 turn 实际已发请求(逐字节热前缀)，作 fork 克隆基;被判文本尾部重注。
        if (PSYCH_ASSESSMENT_GATE_ENABLED) {
          const assistantTextItems = (outputItems as OpenResponseInputItem[]).filter(isAssistantTextOutputReplayItem);
          if (assistantTextItems.length > 0) {
            const admit = await this.runPsychAssessmentGate({
              baseRequest: currentCanonicalRequest,
              assistantTextItems,
              traceId: payload.traceId,
              runId: String(queueMessage.id),
              agentTurn: turn,
              runtimePrompt
            });
            stampTextAdmitInPlace(outputItems as OpenResponseInputItem[], admit);
          }
        }
        const outputStackRows = await this.appendAgentStackItemsSafe({
          traceId: payload.traceId,
          runId: queueMessage.id,
          sourceType: 'llm_request_slices',
          sourceId: sliceId,
          llmRequestSliceId: sliceId,
          items: buildModelOutputStackItems(outputItems, sliceId) as Array<Record<string, unknown>>
        });
        const outputStackIndexes = outputStackRows
          .map((row) => Number((row as { stackIndex?: unknown }).stackIndex))
          .filter((value) => Number.isFinite(value));
        const toolCallStackItemIdByCallId = new Map<string, string | number>();
        for (const row of outputStackRows) {
          const toolCallId = typeof (row as { toolCallId?: unknown }).toolCallId === 'string'
            ? (row as { toolCallId: string }).toolCallId
            : null;
          const itemKind = typeof (row as { itemKind?: unknown }).itemKind === 'string'
            ? (row as { itemKind: string }).itemKind
            : null;
          const id = (row as { id?: unknown }).id;
          if (toolCallId && itemKind === 'function_call' && (typeof id === 'string' || typeof id === 'number')) {
            toolCallStackItemIdByCallId.set(toolCallId, id);
          }
        }
        await this.updateLlmRequestSliceStackLinksSafe({
          sliceId,
          inputStartIndex,
          inputEndIndex: inputEndIndex > 0 ? inputEndIndex : null,
          outputStartIndex: outputStackIndexes.length > 0 ? Math.min(...outputStackIndexes) : null,
          outputEndIndex: outputStackIndexes.length > 0 ? Math.max(...outputStackIndexes) : null
        });
        const actionPlan = this.responseActionRouter.route(modelResult.canonical_response);
        const replayableOutputs = actionPlan.replayableOutputs;
        const hasToolCall = actionPlan.hasToolCall;
        await this.executeResponsePostActions(actionPlan.postActions, {
          queueMessage: payload,
          runId: queueMessage.id,
          turn,
          llmCallId: modelResult.llm_call_id || null
        });

        appendLoopInputItems(outputItems as OpenResponseInputItem[]);
        const toolReplayItems = replayableOutputs.filter(isReplayableToolCall);
        const orderedToolReplayItems = orderRuntimeToolCalls(toolReplayItems);
        const hasRecoverEnergyInBatch = toolReplayItems.some((item) => item.toolCall.name === TOOL_NAMES.recoverEnergy);
        // 只要这一 turn 调了任何非 recover_energy 的工具，就算这个 run 有有效产出 → 连续空转计数归零。
        // 判在【模型发出工具调用】这一刻，而不是执行成功之后：工具报错也是她真动手了，不该算空转。
        // recover_energy 例外:不在发出时判,按执行【结果】判(见 toolResult 处)——接受才算,被拒不算。
        if (toolReplayItems.some((item) => item.toolCall.name !== TOOL_NAMES.recoverEnergy)) {
          runTouchedWorld = true;
        }
        if (toolReplayItems.length > 0) {
          runCalledAnyTool = true;
        }
        const preSleepToolTimeline: PreSleepToolTimelineEntry[] = [];

        for (const replayItem of orderedToolReplayItems) {
          const toolCall = replayItem.toolCall;
          const stackToolExecutionId = `tool:${queueMessage.id}:${toolCall.callId}`;
          await this.recordAgentStackToolExecutionSafe({
            executionId: stackToolExecutionId,
            llmRequestSliceId: sliceId,
            llmCallId: modelResult.llm_call_id || null,
            toolCallId: toolCall.callId,
            toolName: toolCall.name,
            arguments: toolCall.args,
            rawArguments: toolCall.rawArguments,
            status: 'running',
            sideEffect: isToolCallSideEffecting(toolCall),
            traceId: payload.traceId,
            runId: queueMessage.id,
            agentTurn: turn,
            stackCallItemId: toolCallStackItemIdByCallId.get(toolCall.callId) || null,
            metadata: {
              model_name: runtimePrompt.modelName,
              session_key: payload.sessionKey,
              chat_type: payload.chatType,
              peer_name: payload.peerName || null
            }
          });

          try {
            // Spec B 之后 compress_core_memory 不再是 wire 工具(既不在主请求 tools 里,也不在
            // allowed_tools 里),压缩全程由后台 fork「写文件 → 引擎读回 commit」完成,主 loop 永远
            // 不该自己调。原来这里挂着一个软拒分支,活体实测(最后一次真实调用停在 2026-07-10 删 wire
            // 工具当天,此后 46K+ stack item 零触发)后连同 executeTool 里的 case 一并删除:模型即便
            // 幻觉出这个名字,也只会在 executeTool 落到 `Unsupported tool` 抛错 → 普通工具报错,既不
            // 提交也不会重写 front-of-prompt 的 <xiaoni_status> 打穿 ~180K 暖前缀。
            const toolResult = await this.executeTool(toolCall, payload, {
              currentCanonicalRequest
            });
            // recover_energy 按【结果】记账(user 拍板 2026-07-27):身体接受休息(入睡或立即恢复)
            // =有效产出,空转计数归零——都睡着了不算空转;被身体拒绝(rest_rejected,睡不着)不算,
            // 发起了但没睡成等于没动。其它工具在发出那一刻已记,这里只补 recover_energy 的结果位。
            if (
              toolCall.name === TOOL_NAMES.recoverEnergy
              && (toolResult.recovery_session_requested === true || toolResult.recovered === true)
            ) {
              runTouchedWorld = true;
            }
            if (toolCall.name === TOOL_NAMES.recoverEnergy && toolResult.recovery_session_requested === true) {
              const creator = (this.store as RuntimeStore & {
                createAgentRecoverySession?: RuntimeStore['createAgentRecoverySession'];
              }).createAgentRecoverySession;
              if (typeof creator !== 'function') {
                throw new Error('recover_energy requires recovery session persistence');
              }
              const startedAt = typeof toolResult.started_at === 'string' ? new Date(toolResult.started_at) : new Date();
              const clockDueAt = typeof toolResult.clock_due_at === 'string' ? new Date(toolResult.clock_due_at) : null;
              const persistedSessionPolicy = recoverySessionPolicyFromSnapshot(toolResult.recovery_policy_snapshot)
                ?? recoverySessionPolicyFromSnapshot(createRecoveryPolicySnapshot(startedAt))!;
              await creator.call(this.store, {
                initiator: 'recover_energy_tool',
                reason: typeof toolResult.reason === 'string' ? toolResult.reason : null,
                xiaoniOs: typeof toolResult.xiaoni_os === 'string' ? toolResult.xiaoni_os : null,
                clockMinutes: typeof toolResult.clock_minutes === 'number' ? toolResult.clock_minutes : null,
                clockDueAt,
                startedAt,
                toolExecutionId: stackToolExecutionId,
                llmRequestSliceId: sliceId,
                llmCallId: modelResult.llm_call_id || null,
                toolCallId: toolCall.callId,
                traceId: payload.traceId,
                runId: queueMessage.id,
                queueMessageId: queueMessage.id,
                startEnergy: typeof toolResult.energy_start === 'number' ? toolResult.energy_start : null,
                currentEnergy: typeof toolResult.energy === 'number' ? toolResult.energy : null,
                maxEnergy: typeof toolResult.max_energy === 'number' ? toolResult.max_energy : RUNTIME_MAX_ENERGY,
                startPressure: typeof toolResult.pressure === 'number' ? toolResult.pressure : null,
                currentPressure: typeof toolResult.pressure === 'number' ? toolResult.pressure : null,
                plannedNaturalWakeAt: typeof toolResult.planned_natural_wake_at === 'string' ? new Date(toolResult.planned_natural_wake_at) : null,
                hardWakeAt: typeof toolResult.hard_wake_at === 'string' ? new Date(toolResult.hard_wake_at) : estimateSessionWakeAt(startedAt, persistedSessionPolicy),
                wakeCountStartQueueMessageId: recoveryWakeCountStartQueueMessageId,
                metadata: {
                  model_name: runtimePrompt.modelName,
                  session_key: payload.sessionKey,
                  chat_type: payload.chatType,
                  peer_name: payload.peerName || null,
                  required_pressure: toolResult.required_pressure ?? null,
                  recovery_policy_snapshot: toolResult.recovery_policy_snapshot ?? null,
                  full_recovery_minutes: toolResult.full_recovery_minutes ?? null,
                  session_max_recovery_minutes: toolResult.session_max_recovery_minutes ?? null,
                  session_cap_wake_cause: toolResult.session_cap_wake_cause ?? null,
                  tool_args: toolCall.args,
                  raw_arguments: toolCall.rawArguments,
                  ...(preSleepToolTimeline.length > 0 ? {
                    batch_final_recovery: {
                      recovery_started_at: startedAt.toISOString(),
                      pre_sleep_tool_calls: preSleepToolTimeline,
                      tool_call_order: orderedToolReplayItems.map((item) => ({
                        call_id: item.toolCall.callId,
                        name: item.toolCall.name
                      }))
                    }
                  } : {})
                }
              });
              if (typeof toolResult.xiaoni_os === 'string' && toolResult.xiaoni_os.trim().length > 0) {
                persistedXiaoniOs = toolResult.xiaoni_os.trim();
              }
              leaseRelease = buildLeaseReleaseRecord({
                reason: 'runtime_frame_yielded',
                detail: 'recover_energy session started; tool callback will be appended when recovery settles.',
                outcome: 'recover_energy_session_started',
                noVisibleDelivery: true,
                visibleDeliveryCommitted: false,
                source: 'tool:recover_energy'
              });
              await this.store.logTimelineEvent({
                traceId: payload.traceId,
                eventType: 'decision',
                eventName: 'recover_energy_session_started',
                eventPhase: null,
                metadata: {
                  tool_call_id: toolCall.callId,
                  tool_execution_id: stackToolExecutionId,
                  clock_minutes: toolResult.clock_minutes ?? null
                }
              });
              break;
            }
            if (toolCall.name === TOOL_NAMES.recoverEnergy && toolResult.recovered === true) {
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
            if (toolCall.name === TOOL_NAMES.webSearch
              && toolResult.is_fresh_search === true
              && toolResult.has_results === true) {
              const webSearchRecorder = (this.store as RuntimeStore & {
                recordWebSearchResultLifeEvent?: RuntimeStore['recordWebSearchResultLifeEvent'];
              }).recordWebSearchResultLifeEvent;
              if (typeof webSearchRecorder === 'function') {
                await webSearchRecorder.call(this.store, {
                  queueMessage: payload,
                  runId: queueMessage.id,
                  toolName: toolCall.name,
                  toolResult
                }).catch((error) => {
                  moduleLogger.warn('Failed to record web_search_result life event', {
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

            if (extractSentMessages(toolResult).length > 0) {
              await this.store.markLeaseVisibleDeliveryCommitted(queueMessage.id);
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
              deliveryState = await this.store.getExecutionLeaseDeliveryState(queueMessage.id);
              deliveredMessages.push(...extractDeliveredAssistantMessages(toolResult));
            }

            const runtimeEnergyState = await this.getCurrentRuntimeEnergyState(payload);
            const continuation = applyToolResultToLoopInput(toolCall, toolResult, {
              loopInput: requestInput,
              speakingToolName: payload.chatType === 'direct' ? TOOL_NAMES.privateReply : TOOL_NAMES.groupReply,
              hasVisibleReply: deliveredMessages.length > 0,
              runtimeEnergyState
            });
            // A2: freeze the hide-decision into the tool-result echo (function_call_output carrying
            // xiaoni_os) before it fans out to the stack ledger + live requestInput (shared refs).
            stampXiaoniOsHiddenInPlace(continuation.inputItems, stripXiaoniOsHiddenSnapshot);
            const toolOutputStackRows = await this.appendAgentStackItemsSafe({
              traceId: payload.traceId,
              runId: queueMessage.id,
              sourceType: 'tool_executions',
              sourceId: stackToolExecutionId,
              llmRequestSliceId: sliceId,
              items: buildToolResultStackItems({
                toolCall,
                toolResult,
                continuationItems: continuation.inputItems,
                llmRequestSliceId: sliceId
              }) as Array<Record<string, unknown>>
            });
            const stackOutputItemId = (toolOutputStackRows[0] as { id?: string | number } | undefined)?.id || null;
            await this.completeAgentStackToolExecutionSafe({
              executionId: stackToolExecutionId,
              status: 'completed',
              result: toolResult,
              stackOutputItemId
            });
            if (hasRecoverEnergyInBatch && toolCall.name !== TOOL_NAMES.recoverEnergy) {
              preSleepToolTimeline.push({
                call_id: toolCall.callId,
                name: toolCall.name,
                completed_at: new Date().toISOString(),
                status: 'completed'
              });
            }
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
                {
                  ...buildInternalExplicitSendTargetArgs(
                    continuation.forcedVisibleReply.toolName === TOOL_NAMES.privateReply ? 'private' : 'group',
                    payload
                  ),
                  ...continuation.forcedVisibleReply.args
                },
                payload
              );
              if (typeof forcedToolResult?.xiaoni_os === 'string' && forcedToolResult.xiaoni_os.trim().length > 0) {
                persistedXiaoniOs = forcedToolResult.xiaoni_os.trim();
              }
              if (typeof forcedToolResult?.pending_share === 'string' && forcedToolResult.pending_share.trim().length > 0) {
                persistedPendingShare = forcedToolResult.pending_share.trim();
              }
              await this.store.markLeaseVisibleDeliveryCommitted(queueMessage.id);
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
              deliveryState = await this.store.getExecutionLeaseDeliveryState(queueMessage.id);
              deliveredMessages.push(...extractDeliveredAssistantMessages(forcedToolResult));
              leaseRelease = buildLeaseReleaseRecord({
                reason: 'visible_delivery_committed',
                detail: 'A visible reply was forced after a side-effecting tool produced work that still needed an acknowledgement.',
                outcome: 'forced_visible_delivery_committed',
                noVisibleDelivery: false,
                visibleDeliveryCommitted: true,
                source: `tool:${continuation.forcedVisibleReply.toolName}`,
                toolResult: forcedToolResult
              });
              break;
            }
            if (continuation.inputItems.length > 0) {
              appendLoopInputItems(continuation.inputItems);
            }
            if (continuation.oneShotInputItems.length > 0) {
              appendOneShotInputItems(continuation.oneShotInputItems);
            }
          } catch (error) {
            const toolResult = buildToolErrorResult(toolCall, error);
            const message = String(toolResult.error_message || toolResult.error || 'Tool execution failed');
            const runtimeEnergyState = await this.getCurrentRuntimeEnergyState(payload);
            const continuation = applyToolResultToLoopInput(toolCall, toolResult, {
              loopInput: requestInput,
              speakingToolName: payload.chatType === 'direct' ? TOOL_NAMES.privateReply : TOOL_NAMES.groupReply,
              hasVisibleReply: deliveredMessages.length > 0,
              runtimeEnergyState
            });
            // A2: freeze the hide-decision into the tool-result echo (function_call_output carrying
            // xiaoni_os) before it fans out to the stack ledger + live requestInput (shared refs).
            stampXiaoniOsHiddenInPlace(continuation.inputItems, stripXiaoniOsHiddenSnapshot);
            const toolOutputStackRows = await this.appendAgentStackItemsSafe({
              traceId: payload.traceId,
              runId: queueMessage.id,
              sourceType: 'tool_executions',
              sourceId: stackToolExecutionId,
              llmRequestSliceId: sliceId,
              items: buildToolResultStackItems({
                toolCall,
                toolResult,
                continuationItems: continuation.inputItems,
                llmRequestSliceId: sliceId
              }) as Array<Record<string, unknown>>
            });
            const stackOutputItemId = (toolOutputStackRows[0] as { id?: string | number } | undefined)?.id || null;
            await this.completeAgentStackToolExecutionSafe({
              executionId: stackToolExecutionId,
              status: 'failed',
              result: toolResult,
              errorMessage: message,
              stackOutputItemId
            });
            await this.store.logTimelineEvent({
              traceId: payload.traceId,
              eventType: 'tool',
              eventName: 'tool_execution_failed_model_visible',
              eventPhase: null,
              metadata: {
                tool_name: toolCall.name,
                tool_call_id: toolCall.callId,
                tool_execution_id: stackToolExecutionId,
                error_message: message
              }
            }).catch((timelineError) => {
              moduleLogger.warn('Failed to log model-visible tool error', {
                traceId: payload.traceId,
                runId: queueMessage.id,
                toolName: toolCall.name,
                error: timelineError instanceof Error ? timelineError.message : String(timelineError)
              });
            });
            if (continuation.inputItems.length > 0) {
              appendLoopInputItems(continuation.inputItems);
            }
            if (continuation.oneShotInputItems.length > 0) {
              appendOneShotInputItems(continuation.oneShotInputItems);
            }
            if (hasRecoverEnergyInBatch && toolCall.name !== TOOL_NAMES.recoverEnergy) {
              preSleepToolTimeline.push({
                call_id: toolCall.callId,
                name: toolCall.name,
                completed_at: new Date().toISOString(),
                status: 'failed'
              });
            }
          }
        }
        if (!hasToolCall && !actionPlan.hasFinalAnswer && !leaseRelease) {
          deliveryState = await this.store.getExecutionLeaseDeliveryState(queueMessage.id);
          if (deliveryState.deliveryPhase !== 'reasoning_open' && deliveredMessages.length > 0) {
            leaseRelease = buildLeaseReleaseRecord({
              reason: 'visible_delivery_committed',
              detail: 'Visible delivery was already committed; this bounded model slice stopped without another replayable final_answer.',
              outcome: 'frame_yielded_after_visible_delivery_without_final_answer',
              noVisibleDelivery: false,
              visibleDeliveryCommitted: true,
              source: 'model:no_tool_after_visible_delivery'
            });
          }
        }
        if (!leaseRelease && actionPlan.hasFinalAnswer) {
          leaseRelease = buildLeaseReleaseRecord({
            reason: deliveredMessages.length > 0 ? 'visible_delivery_committed' : 'runtime_frame_yielded',
            detail: deliveredMessages.length > 0
              ? 'Visible delivery was committed; this frame yielded to the runtime loop without another model call.'
              : 'Assistant final_answer reached; control returns to the Notify Bucket before any further main-agent model call.',
            outcome: deliveredMessages.length > 0
              ? 'frame_yielded_after_visible_delivery'
              : 'final_answer_yielded',
            noVisibleDelivery: deliveredMessages.length === 0,
            visibleDeliveryCommitted: deliveredMessages.length > 0,
            source: deliveredMessages.length > 0 ? 'runtime:visible_delivery_frame_yield' : 'runtime:frame_yield'
          });
        }
        if (!leaseRelease && !hasToolCall && outputItems.length === 0) {
          leaseRelease = buildLeaseReleaseRecord({
            reason: 'runtime_frame_yielded',
            detail: 'Model slice returned no replayable output item; control returns to the runtime loop to avoid repeating an unchanged request.',
            outcome: 'model_slice_yielded',
            noVisibleDelivery: deliveredMessages.length === 0,
            visibleDeliveryCommitted: deliveredMessages.length > 0,
            source: 'runtime:empty_model_slice_yield'
          });
        }
        if (!leaseRelease) {
          await appendAvailableQueueNotifyToLoop();
          continue;
        }

        // C1 (self-driven fork = complete clone of main): stash the EXACT request the main
        // just SENT — `currentCanonicalRequest` is built from the assistant-text-stripped
        // `currentRequestInput`, so it is byte-identical to the warm prompt cache the main loop
        // just primed. The fork clones it and only appends a TAIL, so its prefix reads that cache.
        // Capture this settling turn's narration (D) separately: it is stripped from the sent
        // prefix (and was appended to the UNstripped `requestInput` only for archival), so the
        // fork re-injects it at its tail to keep "what she just said" without diverging the
        // prefix. Seeding from `requestInput` instead would drag every mid-run D back into the
        // prefix and cold-prefill the whole body (cache 击穿). Clone so a later mutation can't
        // reach the stashed object.
        // C2 gate (settledOnFinalAnswer): judged on THIS settling response, not the whole run.
        // The settling response is pure text with no action (a turn with a function_call never
        // settles), so any settle on a final_answer triggers the fork — regardless of how many
        // tools the run used before settling. "她一 settle 在 final_answer 上就给方向。"
        this.lastMainAgentForkSeed = {
          canonicalRequest: cloneCanonicalAgentTurnRequest(currentCanonicalRequest),
          recentNarrationItems: (outputItems as OpenResponseInputItem[]).filter(isAssistantTextOutputReplayItem),
          settledOnFinalAnswer: actionPlan.hasFinalAnswer
        };
        // 连续空转记账。归零【只有一种场景】(user 拍板 2026-07-27):这个 run 存在有效产出——
        // 调过任何非 recover_energy 的工具(真动手了)。
        // 被外部消息唤醒【不】归零:她真要响应消息必然调工具(回消息/开屏读)本来就归零;
        // 被叫醒却啥也没干,plan 照样没被执行,账不能被一条外来 ping 洗掉。
        // 不满足且这一 settle 落在 final_answer 上(纯文本零动作收工) → +1。
        // 计数只喂 fork,不进主 agent 上下文、不写 stack。
        //
        // 报时(clock_ping)完全隐形:它是引擎自发的、只为告诉她几点的回合,不是一次执行 plan 的
        // 机会,既不该洗账也不该记账。整个 run 都由报时驱动时才隐形——夹带了真实外部消息的
        // 折叠 run 照常记账,否则一条报时就能把真空转洗白。
        const runDrivenOnlyByClockPing = isClockPingPayload(payload)
          && continuationQueueMessages.every((claimed) => isClockPingPayload(claimed.payload));
        if (!runDrivenOnlyByClockPing) {
          recordIdlePlanSettle(getGlobalPromptContextSessionKey(), {
            settledOnFinalAnswer: actionPlan.hasFinalAnswer,
            didRealWork: runTouchedWorld
          });
        }
        // plan 空转 run 作废(docs/specs/xiaoni-plan-run-void-on-idle.md):零产出的 plan run 当没发生过。
        // 判定全部满足才删,任一不满足照旧冻结(fail-open 到今天的行为):
        //  - 触发 payload 是 subconscious plan notify(QQ 消息/其它 reminder 触发的 run 一律冻结);
        //  - settle 落在 final_answer(纯文本收工)且整个 run 零工具调用——含 recover_energy(睡过必须留痕,
        //    否则醒来记忆里没有这一觉,时间错乱);
        //  - run 内折叠消费的 notify 全部也是 subconscious plan(折叠过真实外部信息 → 冻结,否则信息丢失);
        //  - 零可见投递、无压缩提交、无 evictedTurns(不与压缩/淘汰机制交叉)。
        // 删除只作用于本 run(含被折叠 plan 各自的 run_id)的栈行;队列行保持 completed,绝不 reseed
        // (one-shot 时代 reseed 永动的案底);slices/tool_executions/life events 全保留(观测层,不进 replay)。
        // 缓存:作废行从未进过任何 replay,下一 run 的前缀退回作废前栈顶(上一 run true-end 的既有断点),
        // 失效轮数照旧由升级腿透传给 fork——作废和升级互补,不互相抵消。
        if (shouldVoidIdlePlanRun({
          queueBacked: options.queueBacked === true,
          settledOnFinalAnswer: actionPlan.hasFinalAnswer,
          runCalledAnyTool,
          deliveredCount: deliveredMessages.length,
          compressionCommitted: coreMemoryCompressionArtifact !== null,
          evictedTurnCount: evictedTurns.length,
          triggerIsSubconsciousPlan: isSubconsciousAgentNotifyPayload(payload),
          foldedAllSubconsciousPlans: continuationQueueMessages.every((claimed) => isSubconsciousAgentNotifyPayload(claimed.payload))
        })) {
          const voidRunIds = [queueMessage.id, ...continuationQueueMessages.map((claimed) => claimed.id)];
          try {
            const voidResult = await this.store.voidAgentStackRunSegment({
              traceId: payload.traceId,
              runIds: voidRunIds
            });
            await this.store.logTimelineEvent({
              traceId: payload.traceId,
              eventType: 'decision',
              eventName: voidResult.voided ? 'plan_idle_run_voided' : 'plan_idle_run_void_skipped',
              eventPhase: null,
              metadata: {
                run_ids: voidRunIds,
                deleted_count: voidResult.deletedCount,
                skip_reason: voidResult.voided ? null : (voidResult.reason || 'unknown'),
                min_stack_index: voidResult.minStackIndex ?? null,
                idle_rounds: getConsecutiveIdlePlanFailures(getGlobalPromptContextSessionKey())
              }
            });
          } catch (error) {
            moduleLogger.warn('plan idle run void failed; leaving run frozen', {
              traceId: payload.traceId,
              runId: queueMessage.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
        await this.store.logTimelineEvent({
          traceId: payload.traceId,
          eventType: 'decision',
          eventName: 'lease_released',
          eventPhase: null,
          metadata: leaseRelease
        });
        break;
      }

      const sentMessages = deliveredMessages.map((message) => message.content);
      const finalResponse = sentMessages.length > 0 ? sentMessages.join('\n\n') : null;
      persistedXiaoniOs = appendPendingShareToXiaoniOs(persistedXiaoniOs, persistedPendingShare);
      const responseReplayItems = extractResponseReplayInputItems(loopContinuation);
      const runtimeStream = buildRuntimeStreamMetadata(payload, {
        contextSessionKey,
        responseReplayItemCount: responseReplayItems.length,
        turnsExecuted
      });
      conversationId = null;
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

      if (options.queueBacked) {
        const queueSettleResult = {
          no_visible_delivery: leaseRelease.no_visible_delivery,
          sent_messages: sentMessages,
          xiaoni_os: persistedXiaoniOs,
          pending_share: persistedPendingShare,
          stored_feedback_reflection_ids: storedFeedbackReflectionIds,
          model_request_slices: turnsExecuted,
          lease_release: leaseRelease,
          core_memory_compression: coreMemoryCompressionArtifact,
          lease_release_reason: leaseRelease.reason,
          continuation_queue_message_ids: continuationQueueMessages.flatMap((message) => message.queueMessageIds)
        };
        // Folded notify messages share this run's run_id, so a single settle keyed
        // on queueMessage.id acks the parent AND every folded message at once.
        await this.store.settleQueueMessages(queueMessage.id, {
          conversationId,
          result: queueSettleResult
        });
      }
      const presenceOutcome = sentMessages.length > 0 ? 'replied' : 'silent';
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
      if (options.queueBacked) {
        await this.store.releaseExecutionLease(queueMessage.id, {
          status: 'settled',
          leaseRelease,
          noVisibleDelivery: leaseRelease.no_visible_delivery,
          finalResponse,
          sentMessages,
          modelRequestSlices: turnsExecuted,
          conversationId
        });
      }
      if (jobId) {
        await this.store.updateLlmJob(jobId, {
          status: 'settled',
          finalResponse,
          totalTurns: turnsExecuted,
          conversationId
        });
      }
      if (sentMessages.length === 0 && leaseRelease.reason !== 'runtime_frame_yielded') {
        await this.recordNoVisibleDeliveryLifeEvent(payload, queueMessage.id, presenceOutcome, leaseRelease, turnsExecuted, conversationId);
      }
      await this.store.logTimelineEvent({
        traceId: payload.traceId,
        eventType: 'decision',
        eventName: 'execution_lease',
        eventPhase: 'end',
        conversationId,
        metadata: {
          sent_count: sentMessages.length,
          model_request_slices: turnsExecuted,
          lease_release_reason: leaseRelease.reason
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
      const responseReplayItems = extractResponseReplayInputItems(loopContinuation);
      const transientQueueRetryEligible = options.queueBacked
        && sentMessages.length === 0
        && isTransientProviderExecutionError(error)
        && queueMessage.attempts < (queueMessage.maxAttempts ?? 3);
      const runtimeStream = buildRuntimeStreamMetadata(payload, {
        contextSessionKey: getGlobalPromptContextSessionKey(),
        responseReplayItemCount: responseReplayItems.length,
        turnsExecuted
      });
      const leaseRelease = buildLeaseReleaseRecord({
        reason: error instanceof MissingAgentPromptBindingError ? 'prompt_binding_error' : 'runtime_error',
        detail: message,
        outcome: 'failed',
        noVisibleDelivery: sentMessages.length === 0,
        visibleDeliveryCommitted: sentMessages.length > 0,
        source: 'runtime:error'
      });
      conversationId = null;
      let queueRetryScheduled = false;
      if (transientQueueRetryEligible) {
        const retryStore = this.store as RuntimeStore & {
          retryQueueMessage?: (runId: string, params: { errorMessage: string; retryDelayMs?: number }) => Promise<number>;
        };
        if (typeof retryStore.retryQueueMessage === 'function') {
          const retryDelayMs = computeTransientQueueRetryDelayMs(queueMessage.attempts);
          const retried = await retryStore.retryQueueMessage.call(this.store, queueMessage.id, {
            errorMessage: message,
            retryDelayMs
          }).catch((retryError) => {
            moduleLogger.warn('Failed to requeue transient agent queue failure', {
              traceId: payload.traceId,
              runId: queueMessage.id,
              error: retryError instanceof Error ? retryError.message : String(retryError)
            });
            return 0;
          });
          queueRetryScheduled = retried > 0;
          if (queueRetryScheduled) {
            await this.store.logTimelineEvent({
              traceId: payload.traceId,
              eventType: 'decision',
              eventName: 'queue_retry_scheduled',
              eventPhase: null,
              conversationId,
              metadata: {
                run_id: queueMessage.id,
                attempts: queueMessage.attempts,
                max_attempts: queueMessage.maxAttempts ?? 3,
                retry_delay_ms: retryDelayMs,
                error_message: message
              }
            }).catch((timelineError) => {
              moduleLogger.warn('Failed to log transient queue retry schedule', {
                traceId: payload.traceId,
                runId: queueMessage.id,
                error: timelineError instanceof Error ? timelineError.message : String(timelineError)
              });
            });
          }
        }
      }
      if (options.queueBacked && !queueRetryScheduled) {
        // Folded notify messages share this run's run_id, so failing queueMessage.id
        // fails them too. When a retry IS scheduled, retryQueueMessage(queueMessage.id)
        // resets them to pending alongside the main message (reprocessed, not lost).
        await this.store.failQueueMessage(queueMessage.id, message, conversationId);
      }
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
      if (options.queueBacked) {
        await this.store.releaseExecutionLease(queueMessage.id, {
          status: 'failed',
          leaseRelease,
          noVisibleDelivery: leaseRelease.no_visible_delivery,
          finalResponse: sentMessages.length > 0 ? sentMessages.join('\n\n') : null,
          sentMessages,
          modelRequestSlices: turnsExecuted,
          errorMessage: message,
          conversationId
        });
      }
      if (jobId) {
        await this.store.updateLlmJob(jobId, {
          status: 'failed',
          errorMessage: message,
          totalTurns: turnsExecuted,
          conversationId,
          finalResponse: sentMessages.length > 0 ? sentMessages.join('\n\n') : null
        });
      }
      await this.store.logTimelineEvent({
        traceId: payload.traceId,
        eventType: 'decision',
        eventName: 'execution_lease',
        eventPhase: 'end',
        conversationId,
        metadata: {
          error_message: message,
          model_request_slices: turnsExecuted,
          lease_release_reason: leaseRelease.reason
        },
        durationMs: Date.now() - startedAt
      });
      moduleLogger.error('Agent queue message failed', {
        traceId: payload.traceId,
        runId: queueMessage.id,
        batchId: queueMessage.batchId,
        conversationId,
        error: message,
        retryScheduled: queueRetryScheduled
      });
    }
  }

  private async buildDeveloperContextBlock(_queueMessage: QueueMessageRecord['payload']): Promise<string | null> {
    return null;
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
    conversationId: number | null;
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
    if (!CONTEXT_COMPRESSION_MEMORY_WRITER_ENABLED) {
      const traceId = `${params.queueMessage.traceId}:subagent:${CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE}`;
      void this.store.logTimelineEvent({
        traceId,
        eventType: 'subagent',
        eventName: CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE,
        eventPhase: 'end',
        conversationId: params.conversationId,
        metadata: {
          subagent_status: 'disabled',
          parent_trace_id: params.queueMessage.traceId,
          parent_run_id: params.queueMessage.runId,
          reason: 'disabled_pending_cache_session_isolation_review'
        }
      }).catch(() => undefined);
      return;
    }

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
          subagent_status: 'failed',
          parent_trace_id: params.queueMessage.traceId,
          error: error instanceof Error ? error.message : String(error)
        }
      }).catch(() => undefined);
    });
  }

  private async runContextCompressionMemoryWriter(params: ContextCompressionMemoryParams) {
    const traceId = `${params.queueMessage.traceId}:subagent:${CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE}`;
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
      promptCacheKey: buildSubagentPromptCacheKey({
        queueMessage: params.queueMessage,
        subagentType: CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE,
        layer: 'episodic'
      }),
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
      promptCacheKey: buildSubagentPromptCacheKey({
        queueMessage: params.queueMessage,
        subagentType: CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE,
        layer: 'semantic'
      }),
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
        promptCacheKey: buildSubagentPromptCacheKey({
          queueMessage: params.queueMessage,
          subagentType: CONTEXT_COMPRESSION_MEMORY_SUBAGENT_TYPE,
          layer: 'reflection'
        }),
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
        subagent_status: 'settled',
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
        promptCacheKey: params.promptCacheKey,
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
    for (let attempt = 1; attempt <= COMPACT_MEMORY_PROVIDER_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/agent/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody
        });
        responsePayload = await response.json() as ProviderAgentResponse;
        if (response.ok && responsePayload.success) {
          break;
        }
        const error = new Error(responsePayload.error || `Compact memory ${params.layer} writer failed with ${response.status}`);
        if (attempt >= COMPACT_MEMORY_PROVIDER_MAX_ATTEMPTS || !isTransientProviderExecutionError(error)) {
          throw error;
        }
      } catch (error) {
        if (attempt >= COMPACT_MEMORY_PROVIDER_MAX_ATTEMPTS || !isTransientProviderExecutionError(error)) {
          throw error;
        }
      }
      await delay(100 * attempt);
    }

    if (!responsePayload?.success) {
      throw new Error(`Compact memory ${params.layer} writer failed without a successful provider response`);
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
          subagent_status: 'failed',
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
        subagent_status: 'disabled_feedback_episode_tool_removed',
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
          writer_settled: true,
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

  // Fire-and-forget persistence of the compression-trigger debounce counter for a
  // session. TIMING-ONLY state (decides WHEN compression fires) — never enters the
  // cacheable request prefix, so this can never block or perturb a turn. Errors are
  // swallowed: a missed write just means the next process start re-reads a slightly
  // stale count, which the next real over/under-line turn corrects anyway.
  private persistCompressionTriggerCounter(sessionKey: string): void {
    if (!sessionKey || typeof this.store.setSessionCompressionTriggerCounter !== 'function') {
      return;
    }
    void this.store
      .setSessionCompressionTriggerCounter({
        sessionKey,
        consecutiveOverCompressionTurns: getCompressionTriggerCounter(sessionKey)
      })
      .catch(() => {});
  }

  // EMERGENCY HALT VALVE (fire-and-forget). When real input_tokens have run past (trigger + margin) for
  // COMPRESSION_OVERRUN_HALT_CONSECUTIVE_TURNS turns, compression already fired at the trigger and did
  // NOT bring the epoch down — a genuinely stalled/failed compression, independent of the read-window
  // fix. Halt the run switch (enabled=FALSE) and keep the cache heartbeat warm so the prefix survives
  // for a clean manual resume (manual compress → re-enable), instead of climbing to the model's hard
  // context ceiling and hard-erroring. The paused state surfaces on the runtime health/status panel via
  // enabled=false + post_compression_pause_reason. Timing/ops only; never touches the cacheable prefix.
  private maybeHaltForCompressionOverrun(
    sessionKey: string,
    traceId: string,
    actualInputTokens: number | null
  ): void {
    if (!sessionKey || !shouldHaltForCompressionOverrun(sessionKey)) {
      return;
    }
    const store = this.store as RuntimeStore & {
      haltRuntimeForCompressionOverrun?: (params: {
        identityKey?: string;
        reason?: string;
        heartbeatIntervalMs?: number;
      }) => Promise<{ haltJustTriggered?: boolean } | null>;
    };
    if (typeof store.haltRuntimeForCompressionOverrun !== 'function') {
      return;
    }
    // Reset so the remaining turns in this run (which finish before the halt is picked up at the next
    // loop iteration) don't re-issue the idempotent DB write every turn.
    resetCompressionOverrunCounter(sessionKey);
    void store
      .haltRuntimeForCompressionOverrun({ identityKey: XIAONI_IDENTITY_KEY, reason: 'compression_overrun' })
      .then((result) => {
        if (result?.haltJustTriggered) {
          moduleLogger.warn('Xiaoni runtime HALTED: compression overrun', {
            traceId,
            sessionKey,
            actualInputTokens,
            compressionTriggerInputTokens: COMPRESSION_TRIGGER_INPUT_TOKENS,
            overrunMarginTokens: COMPRESSION_OVERRUN_MARGIN_TOKENS,
            note: 'compression did not reduce the epoch after firing; run switch OFF, heartbeat kept warm. Manual compress + re-enable to resume.'
          });
        }
      })
      .catch((error) => {
        moduleLogger.warn('Failed to halt Xiaoni runtime for compression overrun', {
          traceId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }

  // BYTE-side pre-send halt: the assembled request's estimated wire bytes crossed the hard line
  // (soft + margin), so sending it would hit Anthropic's 32MB cap and 413. Unlike the token overrun
  // valve above (fire-and-forget, turn-after), this is AWAITED before the caller breaks the run loop:
  // the run switch must be OFF in the DB before the run ends, so the next queued run stalls at
  // waitForRuntimeEnabledBeforeModelSlice instead of re-assembling the same over-cap window and
  // halting again. Same halt mechanism as the token valve (enabled=FALSE + heartbeat kept warm),
  // only the reason differs — a human compresses / re-enables to resume. Timing/ops only; the
  // cacheable prefix is never touched.
  private async haltForWireBytesOverrun(
    sessionKey: string,
    traceId: string,
    estimatedWireBytes: number
  ): Promise<void> {
    const store = this.store as RuntimeStore & {
      haltRuntimeForCompressionOverrun?: (params: {
        identityKey?: string;
        reason?: string;
        heartbeatIntervalMs?: number;
      }) => Promise<{ haltJustTriggered?: boolean } | null>;
    };
    if (typeof store.haltRuntimeForCompressionOverrun !== 'function') {
      return;
    }
    resetCompressionWireTriggerCounter(sessionKey);
    try {
      const result = await store.haltRuntimeForCompressionOverrun({
        identityKey: XIAONI_IDENTITY_KEY,
        reason: 'wire_bytes_overrun'
      });
      if (result?.haltJustTriggered) {
        moduleLogger.warn('Xiaoni runtime HALTED: wire bytes overrun (pre-send)', {
          traceId,
          sessionKey,
          estimatedWireBytes,
          compressionTriggerWireBytes: COMPRESSION_TRIGGER_WIRE_BYTES,
          overrunMarginBytes: COMPRESSION_OVERRUN_MARGIN_BYTES,
          hardLineBytes: COMPRESSION_TRIGGER_WIRE_BYTES + COMPRESSION_OVERRUN_MARGIN_BYTES,
          note: 'estimated wire bytes would exceed Anthropic 32MB cap; request NOT sent, run switch OFF, heartbeat kept warm. Manual compress + re-enable to resume.'
        });
      }
    } catch (error) {
      moduleLogger.warn('Failed to halt Xiaoni runtime for wire bytes overrun', {
        traceId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async buildContextBudgetPlan(params: {
    history: StackBackedConversationTurn[];
    queueMessage: QueueMessageRecord['payload'];
    runtimePrompt: ResolvedAgentRuntimePrompt;
    loopContinuation: OpenResponseInputItem[];
    runtimeIdentityFacts: RuntimeIdentityFactProjection[];
    developerContextBlock?: string | null;
    runtimeEnergyState?: RuntimeEnergyState | null;
    contextSessionKey?: string;
    cutoffState?: SessionReadCutoffState | null;
    triggerInputMode?: RuntimeTriggerInputMode;
    appendSelfContinuationOnTerminalFinalAnswer?: boolean;
    loopContinuationBeforeCurrentTrigger?: boolean;
    // Operator-forced compaction (manual admin trigger). When true the overflow
    // gate is bypassed: instead of compressing only when the live window exceeds
    // the context budget, we compress everything older than the most recent
    // HISTORY_COMPACT_KEEP turns regardless of current token pressure. Used to
    // pre-shorten the cacheable prefix before shipping a prefix-cache-breaking
    // change, so the next prime pays for the compressed prefix once instead of
    // priming the full window now and re-priming after the natural overflow later.
    forceCompression?: boolean;
  }): Promise<ContextBudgetPlan> {
    const policy = resolveModelContextPolicy(
      params.runtimePrompt.modelName,
      params.runtimePrompt.parameters as Record<string, unknown> | undefined
    );
    // REQ1: tiktoken estimate + calibration removed. The compression trigger no
    // longer estimates the live window; it reacts to the model's real input_tokens
    // (consecutiveOverCompressionThresholdBySession). contextWindowTokens is now the
    // raw policy window, kept only for observability in the turn record.
    const contextWindowTokens = policy?.contextWindowTokens ?? null;
    const targetBudgetTokens = contextWindowTokens ? Math.max(1, Math.floor(contextWindowTokens * READ_HISTORY_TARGET_RATIO)) : null;
    const hardBudgetTokens = contextWindowTokens ? Math.max(1, Math.floor(contextWindowTokens * READ_HISTORY_HARD_RATIO)) : null;
    const contextSessionKey = params.contextSessionKey || getGlobalPromptContextSessionKey();
    const cutoffState = Object.prototype.hasOwnProperty.call(params, 'cutoffState')
      ? params.cutoffState ?? null
      : await this.store.getSessionReadCutoffState(contextSessionKey);
    const contextSummary = cutoffState?.contextSummary ?? null;
    const diaryIndexSnapshot = cutoffState?.diaryIndexSnapshot ?? null;
    const peopleIndexSnapshot = cutoffState?.peopleIndexSnapshot ?? null;
    const pendingProactiveShare = cutoffState?.pendingProactiveShare ?? null;
    const pendingProactiveShareAge = cutoffState?.pendingProactiveShareAge ?? 0;
    // RESTART RE-HYDRATION: the compression-trigger debounce counter lives in an in-memory
    // Map that resets to 0 on every process start. With frequent deploys it never reached
    // COMPRESSION_TRIGGER_CONSECUTIVE_TURNS. Seed it ONCE per process from the persisted
    // value (Map.has gates it to the first time we see this session this process) so a
    // restart mid-debounce doesn't throw the count away. TIMING-ONLY: this only affects
    // WHEN compression fires; it never touches the cacheable request prefix below.
    if (!hasCompressionTriggerCounter(contextSessionKey)) {
      const persistedCount = cutoffState?.consecutiveOverCompressionTurns ?? 0;
      setCompressionTriggerCounter(
        contextSessionKey,
        Math.min(COMPRESSION_TRIGGER_CONSECUTIVE_TURNS, Math.max(0, persistedCount))
      );
    }
    const initialRetainedHistory = applyReadCutoff(params.history, cutoffState);
    const triggerInputMode = params.triggerInputMode ?? 'fresh_trigger';

    // Single-flight latch: a previously scheduled compression stays "pending" until the
    // main loop's live cutoff reaches its target (i.e., it has actually been applied).
    // While pending, suppress new triggers. On apply we BOTH clear the latch AND reset
    // the trigger counter: the counter that armed on the PRE-compression (large) context
    // of the previous conversation must not carry into the now-compressed (small) one and
    // fire a redundant 2nd compression. The new context re-arms from scratch if it is
    // still genuinely over the soft line. (实测 12:53/15:18/21:02 的多余第二次压缩根因。)
    const appliedReadCutoff = cutoffState?.readCutoffAfterStackIndex ?? null;
    const pendingCompressionCutoff = this.pendingCompressionAppliedCutoffBySession.get(contextSessionKey) ?? null;
    if (
      pendingCompressionCutoff !== null
      && appliedReadCutoff !== null
      && appliedReadCutoff >= pendingCompressionCutoff
    ) {
      this.pendingCompressionAppliedCutoffBySession.delete(contextSessionKey);
      resetCompressionTriggerCounter(contextSessionKey);
      this.persistCompressionTriggerCounter(contextSessionKey);
    }
    const compressionPendingApply = this.pendingCompressionAppliedCutoffBySession.has(contextSessionKey);

    // Build the current-turn reminder ONCE. The sent request (below, incl. the
    // anchored variant) and the runtime_input 存档 (processRuntimeFrame persist)
    // both reuse this exact array. Previously each rebuilt it via its own
    // new Date(), drifting the [当前时间] stamp ~1s, so the next run replayed
    // bytes that didn't match what this run cached -> whole-body cache 击穿 at
    // every run boundary. The compression fork builds its own input (different
    // ephemeral agent, never replayed) and intentionally does NOT share this.
    const currentTurnInputItems = buildCurrentTurnInputItems(params.queueMessage, params.runtimePrompt)
      .filter((item) => !isOpenResponseMessageInputItem(item) || flattenMessageContent(item.content).trim().length > 0);

    const appendedSelfContinuationInputItems: OpenResponseInputItem[] = [];
    const requestInput = buildLoopRequestInput({
      history: initialRetainedHistory,
      queueMessage: params.queueMessage,
      runtimePrompt: params.runtimePrompt,
      loopContinuation: params.loopContinuation,
      runtimeIdentityFacts: params.runtimeIdentityFacts,
      contextSummary,
      diaryIndexSnapshot,
      peopleIndexSnapshot,
      pendingProactiveShare,
      developerContextBlock: params.developerContextBlock ?? null,
      runtimeEnergyState: params.runtimeEnergyState ?? null,
      triggerInputMode,
      appendSelfContinuationOnTerminalFinalAnswer: params.appendSelfContinuationOnTerminalFinalAnswer ?? false,
      appendedSelfContinuationInputItems,
      loopContinuationBeforeCurrentTrigger: params.loopContinuationBeforeCurrentTrigger ?? false,
      precomputedCurrentTurnInputItems: currentTurnInputItems
    });
    const selfContinuationInputItem = appendedSelfContinuationInputItems[0] ?? null;
    // REQ1: no tiktoken pre-estimate. These fields stay in the plan/turn-record for
    // backward-compatible logging only; the real signal is the provider's input_tokens.
    const estimate = { inputTokens: 0, encoding: null, source: null as 'tiktoken' | 'heuristic' | null };

    if (!contextWindowTokens || !targetBudgetTokens || !hardBudgetTokens) {
      return {
        requestInput,
        currentTurnInputItems,
        selfContinuationInputItem,
        summarySourceInput: null,
        retainedHistory: initialRetainedHistory,
        runtimeIdentityFacts: params.runtimeIdentityFacts,
        readCutoffAfterStackIndex: cutoffState?.readCutoffAfterStackIndex ?? null,
        previousReadCutoffAfterStackIndex: cutoffState?.readCutoffAfterStackIndex ?? null,
        estimatedInputTokens: estimate.inputTokens,
        contextWindowTokens,
        targetBudgetTokens,
        hardBudgetTokens,
        tokenizerEncoding: estimate.encoding,
        tokenizerSource: estimate.source,
        cutoffRecomputed: false,
        contextSummary,
        pendingProactiveShare,
        pendingProactiveShareAge,
        coreMemoryCompression: null
      };
    }

    // REQ1: 触发只看模型返回的真实 input_tokens —— 连续 N 轮 > 软线(内存计数器,
    // 重启清零)。不再用 tiktoken 估算 vs window 当判据。forceCompression(手动)照旧强压。
    // compressionPendingApply: 已经压了但主 loop 还没用上 → 不准再压(消掉空窗里的多余第二次)。
    if (!params.forceCompression && ((!shouldTriggerCompressionFromRealInput(contextSessionKey) && !shouldTriggerCompressionFromWireBytes(contextSessionKey)) || compressionPendingApply || initialRetainedHistory.length === 0)) {
      return {
        requestInput,
        currentTurnInputItems,
        selfContinuationInputItem,
        summarySourceInput: null,
        retainedHistory: initialRetainedHistory,
        runtimeIdentityFacts: params.runtimeIdentityFacts,
        readCutoffAfterStackIndex: cutoffState?.readCutoffAfterStackIndex ?? null,
        previousReadCutoffAfterStackIndex: cutoffState?.readCutoffAfterStackIndex ?? null,
        estimatedInputTokens: estimate.inputTokens,
        contextWindowTokens,
        targetBudgetTokens,
        hardBudgetTokens,
        tokenizerEncoding: estimate.encoding,
        tokenizerSource: estimate.source,
        cutoffRecomputed: false,
        contextSummary,
        pendingProactiveShare,
        pendingProactiveShareAge,
        coreMemoryCompression: null
      };
    }

    // REQ3: 新上下文 = 压缩前整段尾部 HISTORY_COMPACT_KEEP 条 + 之后新增。
    // 触发(auto 与 forced)统一用整段尾部 30 的 cutoff —— 删掉旧的 token 二分
    // (planReadCutoffFromFirstOverflow),它按估算"刚好不溢出"一条一条 nibble,
    // 导致每次只砍 1 条、反复触发、反复打穿 cache。见
    // docs/investigations/compress-core-memory-three-contract-violations-2026-06-28.md
    const compressionPoint = planReadCutoffForForcedCompression(initialRetainedHistory);
    if (!compressionPoint) {
      return {
        requestInput,
        currentTurnInputItems,
        selfContinuationInputItem,
        summarySourceInput: null,
        retainedHistory: initialRetainedHistory,
        runtimeIdentityFacts: params.runtimeIdentityFacts,
        readCutoffAfterStackIndex: cutoffState?.readCutoffAfterStackIndex ?? null,
        previousReadCutoffAfterStackIndex: cutoffState?.readCutoffAfterStackIndex ?? null,
        estimatedInputTokens: estimate.inputTokens,
        contextWindowTokens,
        targetBudgetTokens,
        hardBudgetTokens,
        tokenizerEncoding: estimate.encoding,
        tokenizerSource: estimate.source,
        cutoffRecomputed: false,
        contextSummary,
        pendingProactiveShare,
        pendingProactiveShareAge,
        coreMemoryCompression: null
      };
    }
    const historyTargets = resolveSessionTargets(params.queueMessage);
    const compression = {
      required: true as const,
      contextSessionKey,
      readCutoffAfterStackIndex: compressionPoint.readCutoffAfterStackIndex,
      previousReadCutoffAfterStackIndex: cutoffState?.readCutoffAfterStackIndex ?? null,
      compressionCoveredEndStackIndex: compressionPoint.compressionCoveredEndStackIndex,
      historyUserId: historyTargets.userId,
      historyGroupId: historyTargets.groupId,
      historyScope: 'global' as const,
      lastContextWindowTokens: contextWindowTokens,
      lastTargetBudgetTokens: targetBudgetTokens,
      lastHardBudgetTokens: hardBudgetTokens
    };
    // Byte-stable, number-free instruction. The token counts / conversation ids /
    // offsets that used to live here are internal bookkeeping (already carried in the
    // fork metadata) — they are noise to 小腻 and, because they change every run, they
    // churned the reminder tail and worked against a stable cache. The reminder only
    // needs to tell the summarizer what to do; the cutoff math stays in code/metadata.
    const pressureSummary = CORE_MEMORY_COMPRESSION_PRESSURE_SUMMARY;
    // summarySourceInput is now ONLY a "compression is needed" presence flag for the
    // checkpoint/manual gates — it is NO LONGER the fork's request body. The fork is a
    // CLONE of the main agent (same iron law as self-driven / image-vision / heartbeat
    // forks): it bases off the full main requestInput (byte-identical warm prefix) and
    // carries the compression instruction as a tail item, so it rides the warm cache
    // instead of cold-prefilling a head-only request. The summarizer is steered to
    // compress only the stable old context by the tail reminder + the execution-layer
    // tool restriction; the precise tail-30 eviction stays code-enforced via the cutoff,
    // so it never matters if the model's summary scope is fuzzy near the boundary.
    const summarySourceInput = buildLoopRequestInput({
      history: compressionPoint.summarySourceHistory,
      queueMessage: params.queueMessage,
      runtimePrompt: params.runtimePrompt,
      loopContinuation: [
        ...params.loopContinuation,
        buildCoreMemoryCompressionReminder({
          contextSessionKey,
          readCutoffAfterStackIndex: compressionPoint.readCutoffAfterStackIndex,
          pressureSummary
        })
      ],
      runtimeIdentityFacts: params.runtimeIdentityFacts,
      contextSummary,
      diaryIndexSnapshot,
      peopleIndexSnapshot,
      pendingProactiveShare,
      developerContextBlock: params.developerContextBlock ?? null,
      runtimeEnergyState: params.runtimeEnergyState ?? null,
      triggerInputMode,
      appendSelfContinuationOnTerminalFinalAnswer: params.appendSelfContinuationOnTerminalFinalAnswer ?? false,
      loopContinuationBeforeCurrentTrigger: params.loopContinuationBeforeCurrentTrigger ?? false
    });

    // (Removed: the compression-head cache_anchor. The compression fork now clones the
    // FULL main requestInput and rides the whole warm prefix, so a separate [..H_X]
    // breakpoint had no reader; keeping it only wasted a slot in the 4-breakpoint budget
    // — it would evict the useful lastDurable on a nudged compression turn. See
    // docs/CACHE_CONTRACT.md §1 and the provider tail-set priority.)
    return {
      requestInput,
      currentTurnInputItems,
      selfContinuationInputItem,
      summarySourceInput,
      retainedHistory: initialRetainedHistory,
      runtimeIdentityFacts: params.runtimeIdentityFacts,
      readCutoffAfterStackIndex: cutoffState?.readCutoffAfterStackIndex ?? null,
      previousReadCutoffAfterStackIndex: cutoffState?.readCutoffAfterStackIndex ?? null,
      estimatedInputTokens: estimate.inputTokens,
      contextWindowTokens,
      targetBudgetTokens,
      hardBudgetTokens,
      tokenizerEncoding: estimate.encoding,
      tokenizerSource: estimate.source,
      cutoffRecomputed: false,
      contextSummary,
      pendingProactiveShare,
      pendingProactiveShareAge,
      coreMemoryCompression: compression
    };
  }

  private async buildCoreMemoryCompressionCheckpoint(params: {
    history: StackBackedConversationTurn[];
    queueMessage: QueueMessageRecord['payload'];
    runtimePrompt: ResolvedAgentRuntimePrompt;
    loopContinuation: OpenResponseInputItem[];
    runtimeIdentityFacts: RuntimeIdentityFactProjection[];
    developerContextBlock?: string | null;
    runtimeEnergyState?: RuntimeEnergyState | null;
    contextSessionKey?: string;
    cutoffState?: SessionReadCutoffState | null;
    triggerInputMode?: RuntimeTriggerInputMode;
    appendSelfContinuationOnTerminalFinalAnswer?: boolean;
    loopContinuationBeforeCurrentTrigger?: boolean;
  }): Promise<CoreMemoryCompressionCheckpoint | null> {
    const plan = await this.buildContextBudgetPlan(params);
    return plan.coreMemoryCompression && plan.summarySourceInput
      ? {
          compression: plan.coreMemoryCompression,
          summarySourceInput: plan.summarySourceInput
        }
      : null;
  }

  private async executeResponsePostActions(
    postActions: ResponsePostAction[],
    context: {
      queueMessage: QueueMessageRecord['payload'];
      runId: string;
      turn: number;
      llmCallId: string | null;
    }
  ) {
    void postActions;
    void context;
  }

  private async getAgentStackHeadSafe(traceId: string) {
    const reader = (this.store as RuntimeStore & {
      getAgentStackHead?: RuntimeStore['getAgentStackHead'];
    }).getAgentStackHead;
    if (typeof reader !== 'function') {
      return 0;
    }
    try {
      return await reader.call(this.store, XIAONI_IDENTITY_KEY);
    } catch (error) {
      moduleLogger.warn('Failed to read Xiaoni agent stack head', {
        traceId,
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  private async appendAgentStackItemsSafe(params: {
    traceId: string;
    runId: string;
    sourceType?: string | null;
    sourceId?: string | null;
    llmRequestSliceId?: string | null;
    conversationId?: number | null;
    items: Array<Record<string, unknown>>;
  }) {
    const appender = (this.store as RuntimeStore & {
      appendAgentStackItems?: RuntimeStore['appendAgentStackItems'];
    }).appendAgentStackItems;
    if (typeof appender !== 'function' || params.items.length === 0) {
      return [];
    }
    try {
      const rows = await appender.call(this.store, {
        identityKey: XIAONI_IDENTITY_KEY,
        traceId: params.traceId,
        runId: params.runId,
        sourceType: params.sourceType || null,
        sourceId: params.sourceId || null,
        llmRequestSliceId: params.llmRequestSliceId || null,
        conversationId: params.conversationId ?? null,
        items: params.items
      }) as Array<Record<string, unknown>>;
      // 被动浮现:动作流落地 → 事件驱动 fire-and-forget ingest + shadow 召回(不投递,零缓存,失败不影响主链)。
      fireActionStreamRecall();
      return rows;
    } catch (error) {
      moduleLogger.warn('Failed to append Xiaoni agent stack items', {
        traceId: params.traceId,
        runId: params.runId,
        itemCount: params.items.length,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  private async updateLlmRequestSliceStackLinksSafe(params: Parameters<RuntimeStore['updateLlmRequestSliceStackLinks']>[0]) {
    const updater = (this.store as RuntimeStore & {
      updateLlmRequestSliceStackLinks?: RuntimeStore['updateLlmRequestSliceStackLinks'];
    }).updateLlmRequestSliceStackLinks;
    if (typeof updater !== 'function') {
      return null;
    }
    try {
      return await updater.call(this.store, params);
    } catch (error) {
      moduleLogger.warn('Failed to update Xiaoni LLM request slice stack links', {
        sliceId: params.sliceId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async recordAgentStackToolExecutionSafe(params: Parameters<RuntimeStore['recordAgentStackToolExecution']>[0]) {
    const recorder = (this.store as RuntimeStore & {
      recordAgentStackToolExecution?: RuntimeStore['recordAgentStackToolExecution'];
    }).recordAgentStackToolExecution;
    if (typeof recorder !== 'function') {
      return null;
    }
    try {
      return await recorder.call(this.store, params);
    } catch (error) {
      moduleLogger.warn('Failed to record Xiaoni stack tool execution', {
        traceId: params.traceId,
        runId: params.runId,
        toolCallId: params.toolCallId,
        status: params.status,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async completeAgentStackToolExecutionSafe(params: Parameters<RuntimeStore['completeAgentStackToolExecution']>[0]) {
    const recorder = (this.store as RuntimeStore & {
      completeAgentStackToolExecution?: RuntimeStore['completeAgentStackToolExecution'];
    }).completeAgentStackToolExecution;
    if (typeof recorder !== 'function') {
      return null;
    }
    try {
      return await recorder.call(this.store, params);
    } catch (error) {
      moduleLogger.warn('Failed to complete Xiaoni stack tool execution', {
        executionId: params.executionId,
        status: params.status,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async recordCoreMemoryCompressionForkRunSafe(params: Parameters<RuntimeStore['recordCoreMemoryCompressionForkRun']>[0]) {
    const recorder = (this.store as RuntimeStore & {
      recordCoreMemoryCompressionForkRun?: RuntimeStore['recordCoreMemoryCompressionForkRun'];
    }).recordCoreMemoryCompressionForkRun;
    if (typeof recorder !== 'function') {
      return null;
    }
    try {
      return await recorder.call(this.store, params);
    } catch (error) {
      moduleLogger.warn('Failed to record core memory compression fork run', {
        traceId: params.traceId,
        runId: params.runId,
        forkRunId: params.forkRunId,
        status: params.status,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async completeCoreMemoryCompressionForkRunSafe(params: Parameters<RuntimeStore['completeCoreMemoryCompressionForkRun']>[0]) {
    const recorder = (this.store as RuntimeStore & {
      completeCoreMemoryCompressionForkRun?: RuntimeStore['completeCoreMemoryCompressionForkRun'];
    }).completeCoreMemoryCompressionForkRun;
    if (typeof recorder !== 'function') {
      return null;
    }
    try {
      return await recorder.call(this.store, params);
    } catch (error) {
      moduleLogger.warn('Failed to complete core memory compression fork run', {
        forkRunId: params.forkRunId,
        status: params.status,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async appendCoreMemoryCompressionForkItemsSafe(params: Parameters<RuntimeStore['appendCoreMemoryCompressionForkItems']>[0]) {
    const appender = (this.store as RuntimeStore & {
      appendCoreMemoryCompressionForkItems?: RuntimeStore['appendCoreMemoryCompressionForkItems'];
    }).appendCoreMemoryCompressionForkItems;
    if (typeof appender !== 'function' || params.items.length === 0) {
      return [];
    }
    try {
      return await appender.call(this.store, params) as Array<Record<string, unknown>>;
    } catch (error) {
      moduleLogger.warn('Failed to append core memory compression fork items', {
        traceId: params.traceId,
        runId: params.runId,
        forkRunId: params.forkRunId,
        itemCount: params.items.length,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  private async recordCoreMemoryCompressionForkSliceSafe(params: Parameters<RuntimeStore['recordCoreMemoryCompressionForkSlice']>[0]) {
    const recorder = (this.store as RuntimeStore & {
      recordCoreMemoryCompressionForkSlice?: RuntimeStore['recordCoreMemoryCompressionForkSlice'];
    }).recordCoreMemoryCompressionForkSlice;
    if (typeof recorder !== 'function') {
      return null;
    }
    try {
      return await recorder.call(this.store, params);
    } catch (error) {
      moduleLogger.warn('Failed to record core memory compression fork slice', {
        traceId: params.traceId,
        runId: params.runId,
        forkRunId: params.forkRunId,
        sliceId: params.sliceId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async recordImageVisionForkRunSafe(params: Parameters<RuntimeStore['recordImageVisionForkRun']>[0]) {
    const recorder = (this.store as RuntimeStore & {
      recordImageVisionForkRun?: RuntimeStore['recordImageVisionForkRun'];
    }).recordImageVisionForkRun;
    if (typeof recorder !== 'function') {
      return null;
    }
    try {
      return await recorder.call(this.store, params);
    } catch (error) {
      moduleLogger.warn('Failed to record image vision fork run', {
        traceId: params.traceId,
        runId: params.runId,
        forkRunId: params.forkRunId,
        status: params.status,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async completeImageVisionForkRunSafe(params: Parameters<RuntimeStore['completeImageVisionForkRun']>[0]) {
    const recorder = (this.store as RuntimeStore & {
      completeImageVisionForkRun?: RuntimeStore['completeImageVisionForkRun'];
    }).completeImageVisionForkRun;
    if (typeof recorder !== 'function') {
      return null;
    }
    try {
      return await recorder.call(this.store, params);
    } catch (error) {
      moduleLogger.warn('Failed to complete image vision fork run', {
        forkRunId: params.forkRunId,
        status: params.status,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async appendImageVisionForkItemsSafe(params: Parameters<RuntimeStore['appendImageVisionForkItems']>[0]) {
    const appender = (this.store as RuntimeStore & {
      appendImageVisionForkItems?: RuntimeStore['appendImageVisionForkItems'];
    }).appendImageVisionForkItems;
    if (typeof appender !== 'function' || params.items.length === 0) {
      return [];
    }
    try {
      return await appender.call(this.store, params) as Array<Record<string, unknown>>;
    } catch (error) {
      moduleLogger.warn('Failed to append image vision fork items', {
        traceId: params.traceId,
        runId: params.runId,
        forkRunId: params.forkRunId,
        itemCount: params.items.length,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  private async recordImageVisionForkSliceSafe(params: Parameters<RuntimeStore['recordImageVisionForkSlice']>[0]) {
    const recorder = (this.store as RuntimeStore & {
      recordImageVisionForkSlice?: RuntimeStore['recordImageVisionForkSlice'];
    }).recordImageVisionForkSlice;
    if (typeof recorder !== 'function') {
      return null;
    }
    try {
      return await recorder.call(this.store, params);
    } catch (error) {
      moduleLogger.warn('Failed to record image vision fork slice', {
        traceId: params.traceId,
        runId: params.runId,
        forkRunId: params.forkRunId,
        sliceId: params.sliceId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async recordCoreMemoryCompressionForkToolExecutionSafe(params: Parameters<RuntimeStore['recordCoreMemoryCompressionForkToolExecution']>[0]) {
    const recorder = (this.store as RuntimeStore & {
      recordCoreMemoryCompressionForkToolExecution?: RuntimeStore['recordCoreMemoryCompressionForkToolExecution'];
    }).recordCoreMemoryCompressionForkToolExecution;
    if (typeof recorder !== 'function') {
      return null;
    }
    try {
      return await recorder.call(this.store, params);
    } catch (error) {
      moduleLogger.warn('Failed to record core memory compression fork tool execution', {
        traceId: params.traceId,
        runId: params.runId,
        forkRunId: params.forkRunId,
        toolCallId: params.toolCallId,
        status: params.status,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async completeCoreMemoryCompressionForkToolExecutionSafe(params: Parameters<RuntimeStore['completeCoreMemoryCompressionForkToolExecution']>[0]) {
    const recorder = (this.store as RuntimeStore & {
      completeCoreMemoryCompressionForkToolExecution?: RuntimeStore['completeCoreMemoryCompressionForkToolExecution'];
    }).completeCoreMemoryCompressionForkToolExecution;
    if (typeof recorder !== 'function') {
      return null;
    }
    try {
      return await recorder.call(this.store, params);
    } catch (error) {
      moduleLogger.warn('Failed to complete core memory compression fork tool execution', {
        executionId: params.executionId,
        status: params.status,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async recordSubconsciousAgentForkRunSafe(params: Parameters<RuntimeStore['recordSubconsciousAgentForkRun']>[0]) {
    const recorder = (this.store as RuntimeStore & {
      recordSubconsciousAgentForkRun?: RuntimeStore['recordSubconsciousAgentForkRun'];
    }).recordSubconsciousAgentForkRun;
    if (typeof recorder !== 'function') {
      return null;
    }
    try {
      return await recorder.call(this.store, params);
    } catch (error) {
      moduleLogger.warn('Failed to record subconscious agent fork run', {
        traceId: params.traceId,
        runId: params.runId,
        forkRunId: params.forkRunId,
        status: params.status,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async completeSubconsciousAgentForkRunSafe(params: Parameters<RuntimeStore['completeSubconsciousAgentForkRun']>[0]) {
    const recorder = (this.store as RuntimeStore & {
      completeSubconsciousAgentForkRun?: RuntimeStore['completeSubconsciousAgentForkRun'];
    }).completeSubconsciousAgentForkRun;
    if (typeof recorder !== 'function') {
      return null;
    }
    try {
      return await recorder.call(this.store, params);
    } catch (error) {
      moduleLogger.warn('Failed to complete subconscious agent fork run', {
        forkRunId: params.forkRunId,
        status: params.status,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async appendSubconsciousAgentForkItemsSafe(params: Parameters<RuntimeStore['appendSubconsciousAgentForkItems']>[0]) {
    const appender = (this.store as RuntimeStore & {
      appendSubconsciousAgentForkItems?: RuntimeStore['appendSubconsciousAgentForkItems'];
    }).appendSubconsciousAgentForkItems;
    if (typeof appender !== 'function' || params.items.length === 0) {
      return [];
    }
    try {
      return await appender.call(this.store, params) as Array<Record<string, unknown>>;
    } catch (error) {
      moduleLogger.warn('Failed to append subconscious agent fork items', {
        traceId: params.traceId,
        runId: params.runId,
        forkRunId: params.forkRunId,
        itemCount: params.items.length,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  private async recordSubconsciousAgentForkSliceSafe(params: Parameters<RuntimeStore['recordSubconsciousAgentForkSlice']>[0]) {
    const recorder = (this.store as RuntimeStore & {
      recordSubconsciousAgentForkSlice?: RuntimeStore['recordSubconsciousAgentForkSlice'];
    }).recordSubconsciousAgentForkSlice;
    if (typeof recorder !== 'function') {
      return null;
    }
    try {
      return await recorder.call(this.store, params);
    } catch (error) {
      moduleLogger.warn('Failed to record subconscious agent fork slice', {
        traceId: params.traceId,
        runId: params.runId,
        forkRunId: params.forkRunId,
        sliceId: params.sliceId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async recordPsychAssessmentForkSliceSafe(params: Parameters<RuntimeStore['recordPsychAssessmentForkSlice']>[0]) {
    const recorder = (this.store as RuntimeStore & {
      recordPsychAssessmentForkSlice?: RuntimeStore['recordPsychAssessmentForkSlice'];
    }).recordPsychAssessmentForkSlice;
    if (typeof recorder !== 'function') {
      return null;
    }
    try {
      return await recorder.call(this.store, params);
    } catch (error) {
      moduleLogger.warn('Failed to record psych assessment fork slice', {
        traceId: params.traceId,
        runId: params.runId,
        forkRunId: params.forkRunId,
        sliceId: params.sliceId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async recordSubconsciousAgentForkToolExecutionSafe(params: Parameters<RuntimeStore['recordSubconsciousAgentForkToolExecution']>[0]) {
    const recorder = (this.store as RuntimeStore & {
      recordSubconsciousAgentForkToolExecution?: RuntimeStore['recordSubconsciousAgentForkToolExecution'];
    }).recordSubconsciousAgentForkToolExecution;
    if (typeof recorder !== 'function') {
      return null;
    }
    try {
      return await recorder.call(this.store, params);
    } catch (error) {
      moduleLogger.warn('Failed to record subconscious agent fork tool execution', {
        traceId: params.traceId,
        runId: params.runId,
        forkRunId: params.forkRunId,
        executionId: params.executionId,
        toolName: params.toolName,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async completeSubconsciousAgentForkToolExecutionSafe(params: Parameters<RuntimeStore['completeSubconsciousAgentForkToolExecution']>[0]) {
    const recorder = (this.store as RuntimeStore & {
      completeSubconsciousAgentForkToolExecution?: RuntimeStore['completeSubconsciousAgentForkToolExecution'];
    }).completeSubconsciousAgentForkToolExecution;
    if (typeof recorder !== 'function') {
      return null;
    }
    try {
      return await recorder.call(this.store, params);
    } catch (error) {
      moduleLogger.warn('Failed to complete subconscious agent fork tool execution', {
        executionId: params.executionId,
        status: params.status,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async resolveCoreMemoryCompressionCommitCutoff(compression: CoreMemoryCompressionPlan): Promise<number | null> {
    const plannedCutoffId = compression.readCutoffAfterStackIndex;
    if (typeof plannedCutoffId !== 'number' || !Number.isFinite(plannedCutoffId)) {
      return null;
    }
    const coveredEndId = compression.compressionCoveredEndStackIndex;
    if (typeof coveredEndId !== 'number' || !Number.isFinite(coveredEndId)) {
      return plannedCutoffId;
    }
    return Math.min(plannedCutoffId, coveredEndId);
  }

  /**
   * 专题物化【算】的安全外壳:读上一轮水位 + 扫这一帧的日记新增部分,产出 plan。
   * **只读不写、绝不抛** —— 任何失败都返回 null,压缩提交照做。
   */
  private async planTopicMaterializationSafe(params: {
    sessionKey: string;
    cutoff: number;
  }): Promise<TopicMaterializationPlan | null> {
    try {
      let priorState: unknown = null;
      const reader = (this.store as RuntimeStore & {
        getSessionReadCutoffState?: RuntimeStore['getSessionReadCutoffState'];
      }).getSessionReadCutoffState;
      if (typeof reader === 'function') {
        const state = await reader.call(this.store, params.sessionKey);
        priorState = (state as SessionReadCutoffState | null)?.topicMaterializationState ?? null;
      }
      const plan = await planTopicMaterialization({
        sessionKey: params.sessionKey,
        cutoff: params.cutoff,
        priorState
      });
      return plan.ok ? plan : null;
    } catch (error) {
      moduleLogger.warn('topic materialization planning skipped (fail-open, commit proceeds)', {
        sessionKey: params.sessionKey,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * 专题物化【写】的安全外壳。挂在压缩提交**之后**。
   * 水位闸门:`writeTopicMaterialization` 返回 nextState=null(有标签写失败)就一个字都不落库。
   * **绝不抛** —— 压缩提交已经完成,这里失败只是"这轮没物化"。
   */
  private async runTopicMaterializationWrite(plan: TopicMaterializationPlan | null): Promise<void> {
    if (!plan || !plan.ok) {
      return;
    }
    try {
      const result = await writeTopicMaterialization(plan);
      if (!result.ok || !result.nextState) {
        moduleLogger.warn('topic materialization: watermark held for retry next round', {
          sessionKey: plan.sessionKey,
          topicsDir: plan.topicsDir,
          failedTags: result.failedTags,
          skippedReason: result.skippedReason
        });
        return;
      }
      const nextJson = stableTopicStateJson(result.nextState);
      if (nextJson === plan.priorStateJson) {
        return; // 状态跟上一轮逐字节相同 → 不写库(幂等第二轮走这条)
      }
      const writer = (this.store as RuntimeStore & {
        upsertSessionTopicMaterializationState?: RuntimeStore['upsertSessionTopicMaterializationState'];
      }).upsertSessionTopicMaterializationState;
      if (typeof writer !== 'function') {
        // 老 store / 测试替身没有这个写入口:文件已经写了,水位推不动 → 下一轮靠文件里
        // 已有的章去重,不会补出第二份。留痕即可,绝不抛。
        moduleLogger.warn('topic materialization: store cannot persist watermark (writer missing)', {
          sessionKey: plan.sessionKey
        });
        return;
      }
      await writer.call(this.store, {
        sessionKey: plan.sessionKey,
        state: result.nextState as unknown as Record<string, unknown>
      });
    } catch (error) {
      moduleLogger.warn('topic materialization failed (fail-open, compression commit already durable)', {
        sessionKey: plan.sessionKey,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async commitCoreMemoryCompression(params: {
    rawToolResult: Record<string, unknown>;
    toolCall: AgentToolCall;
    compression: CoreMemoryCompressionPlan | null;
    contextSessionKey: string;
    sourceResponseId: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<CoreMemoryCompressionCommit> {
    const writtenText = typeof params.rawToolResult.text === 'string' && sanitizeMemoryText(params.rawToolResult.text)
      ? sanitizeMemoryText(params.rawToolResult.text)
      : null;
    if (!writtenText) {
      throw new Error(`${TOOL_NAMES.compressCoreMemory} requires non-empty text`);
    }

    const compressionSessionKey = params.compression?.contextSessionKey ?? params.contextSessionKey;
    const committedReadCutoffAfterStackIndex = params.compression
      ? await this.resolveCoreMemoryCompressionCommitCutoff(params.compression)
      : null;
    // 段边界锚(见 renderCompressionSpanAnchor)。在这里拼 —— 这是三条写入路径(原子提交 /
    // 非原子 fallback / 无 compression 的直写)唯一共同的上游,拼一次三条都带上。
    //
    // 双缓存:两个时刻取自 agent_stack_items 的落库时刻(append-only,写完不再变),在这一帧
    // 算一次、随 context_summary 一起冻结进库;之后 build 和 replay 都只是把那一列原样渲染,
    // 两次压缩之间逐字节不变 → 新增冷读 0。**绝不可挪到 buildInitialInput 里每次重算。**
    //
    // 全程 fail-open:锚点是叠加信息,拿不到就原样提交她写的近况。压缩在关键路径上,
    // 任何在这里抛出的异常都会同时废掉正常提交和兜底提交 → cutoff 永不前移。
    const spanAnchor = await this.resolveCompressionSpanAnchorSafe({
      previousReadCutoffAfterStackIndex: params.compression?.previousReadCutoffAfterStackIndex ?? null,
      committedReadCutoffAfterStackIndex
    });
    const text = spanAnchor ? `${spanAnchor}\n\n${writtenText}` : writtenText;
    // 专题物化的【算】段产物,在原子提交帧内算出来、在提交之后才落盘(见下面 ③/④)。
    // 只有走原子提交路径才会被填上;superseded / 非原子 fallback 一律保持 null → 不落盘。
    let topicPlan: TopicMaterializationPlan | null = null;
    const buildSupersededCommit = async (currentReadCutoffAfterStackIndex: number | null) => {
      const artifact = {
        tool_name: params.toolCall.name,
        context_session_key: compressionSessionKey,
        read_cutoff_after_stack_index: currentReadCutoffAfterStackIndex,
        planned_read_cutoff_after_stack_index: params.compression?.readCutoffAfterStackIndex ?? null,
        previous_read_cutoff_after_stack_index: params.compression?.previousReadCutoffAfterStackIndex ?? null,
        compression_covered_end_stack_index: params.compression?.compressionCoveredEndStackIndex ?? null,
        source_response_id: params.sourceResponseId,
        tool_call_id: params.toolCall.callId,
        text_length: text.length,
        superseded: true,
        superseded_reason: 'current_read_cutoff_already_covers_fork',
        ...(params.metadata || {})
      };
      const toolResult = {
        ...params.rawToolResult,
        context_summary_written: false,
        read_cutoff_written: false,
        context_session_key: compressionSessionKey,
        read_cutoff_after_stack_index: currentReadCutoffAfterStackIndex,
        planned_read_cutoff_after_stack_index: params.compression?.readCutoffAfterStackIndex ?? null,
        compression_covered_end_stack_index: params.compression?.compressionCoveredEndStackIndex ?? null,
        superseded: true,
        superseded_reason: 'current_read_cutoff_already_covers_fork'
      };
      await this.store.logTimelineEvent({
        traceId: String(params.metadata?.trace_id || ''),
        eventType: 'memory',
        eventName: 'core_memory_compressed',
        eventPhase: 'skip',
        metadata: artifact
      });
      return {
        text,
        artifact,
        toolResult
      };
    };

    if (params.compression && committedReadCutoffAfterStackIndex !== null) {
      const atomicCommitter = (this.store as RuntimeStore & {
        commitSessionContextSummaryAndReadCutoff?: RuntimeStore['commitSessionContextSummaryAndReadCutoff'];
      }).commitSessionContextSummaryAndReadCutoff;
      if (typeof atomicCommitter === 'function') {
        // ── 记忆层机械维护挂点(顺序有意义,别调换)──────────────────────────────
        // 这里是压缩提交那一帧:整理记忆是唯一"记忆层换血"的时刻,所有对 notes/ 的
        // 机械维护都挂在这一帧,和快照冻结同步发生。
        //
        //   ① maintainDiaryIndexHierarchy —— 必须在 readDiaryIndexSnapshot **之前**:
        //      它会改 INDEX.md,而 <xiaoni_diary_index> 冻结的就是这个文件。同一帧换血 →
        //      冻结进库的是搬完之后那份,两次压缩之间照旧字节不变(不击穿缓存)。
        //   ② writeDiaryHeadingManifests —— 产物在 notes/diary-manifest/,谁都不读进请求,
        //      顺序无关;排在 ① 后面是因为 ① 可能刚补出新的可寻址日期。
        //   ③ 专题物化【算】—— **只读不写**,拿的是这一帧冻结的日记事实(和 ①② 同一帧)。
        //      排在 ② 之后:② 可能刚补出新的可寻址日期。落盘在提交之后(见 ④),因为
        //      产物在 notes/topics/,readDiaryIndexSnapshot / readPeopleIndexSnapshot 都不
        //      读它 —— 提交后写不会让任何进请求前缀的字节漂移。
        //
        // 三者都是 fail-open 的:整体包 try/catch,失败只 warn 返回 ok:false,**绝不上抛**。
        // 一旦有异常逃出去,会同时废掉正常提交和 hard-cap 轮次上限 兜底提交(它们走同一个
        // commitCoreMemoryCompression)→ read_cutoff 永不前移 → 上下文只涨不降 → 撞
        // 30MiB 硬线 → 压缩永久卡死。所以这里**故意不做**任何错误传播。
        await maintainDiaryIndexHierarchy();
        await writeDiaryHeadingManifests();
        topicPlan = await this.planTopicMaterializationSafe({
          sessionKey: params.compression.contextSessionKey,
          cutoff: committedReadCutoffAfterStackIndex
        });

        // 日记索引快照:就在这一帧读一次 INDEX.md(与近况同一原子提交,同帧换血)。
        // 之后所有 build/replay 只从库里这份冻结串渲染,两次压缩之间字节不变。
        // 只有原子路径支持快照;下面的非原子 fallback(生产不可达)不写快照,保留旧值。
        const diaryIndexSnapshot = await readDiaryIndexSnapshot();
        const peopleIndexSnapshot = await readPeopleIndexSnapshot();
        const atomicCommit = await atomicCommitter.call(this.store, {
          sessionKey: params.compression.contextSessionKey,
          contextSummary: text,
          diaryIndexSnapshot,
          peopleIndexSnapshot,
          readCutoffAfterStackIndex: committedReadCutoffAfterStackIndex,
          lastContextWindowTokens: params.compression.lastContextWindowTokens,
          lastTargetBudgetTokens: params.compression.lastTargetBudgetTokens,
          lastHardBudgetTokens: params.compression.lastHardBudgetTokens
        });
        if (!atomicCommit.committed) {
          return buildSupersededCommit(atomicCommit.state?.readCutoffAfterStackIndex ?? null);
        }
      } else {
        const currentCutoffState = await this.store.getSessionReadCutoffState(params.compression.contextSessionKey);
        const currentReadCutoffAfterStackIndex = currentCutoffState?.readCutoffAfterStackIndex ?? null;
        if (
          currentReadCutoffAfterStackIndex !== null &&
          currentReadCutoffAfterStackIndex >= committedReadCutoffAfterStackIndex
        ) {
          return buildSupersededCommit(currentReadCutoffAfterStackIndex);
        }
        await this.store.upsertSessionContextSummary({
          sessionKey: compressionSessionKey,
          contextSummary: text
        });
        await this.store.upsertSessionReadCutoffState({
          sessionKey: params.compression.contextSessionKey,
          readCutoffAfterStackIndex: committedReadCutoffAfterStackIndex,
          lastContextWindowTokens: params.compression.lastContextWindowTokens,
          lastTargetBudgetTokens: params.compression.lastTargetBudgetTokens,
          lastHardBudgetTokens: params.compression.lastHardBudgetTokens
        });
      }
    } else {
      await this.store.upsertSessionContextSummary({
        sessionKey: compressionSessionKey,
        contextSummary: text
      });
    }
    if (params.compression && committedReadCutoffAfterStackIndex === null) {
      await this.store.upsertSessionReadCutoffState({
        sessionKey: params.compression.contextSessionKey,
        readCutoffAfterStackIndex: committedReadCutoffAfterStackIndex,
        lastContextWindowTokens: params.compression.lastContextWindowTokens,
        lastTargetBudgetTokens: params.compression.lastTargetBudgetTokens,
        lastHardBudgetTokens: params.compression.lastHardBudgetTokens
      });
    }

    const artifact = {
      tool_name: params.toolCall.name,
      context_session_key: compressionSessionKey,
      read_cutoff_after_stack_index: committedReadCutoffAfterStackIndex,
      planned_read_cutoff_after_stack_index: params.compression?.readCutoffAfterStackIndex ?? null,
      previous_read_cutoff_after_stack_index: params.compression?.previousReadCutoffAfterStackIndex ?? null,
      compression_covered_end_stack_index: params.compression?.compressionCoveredEndStackIndex ?? null,
      source_response_id: params.sourceResponseId,
      tool_call_id: params.toolCall.callId,
      text_length: text.length,
      ...(params.metadata || {})
    };
    const toolResult = {
      ...params.rawToolResult,
      context_summary_written: true,
      read_cutoff_written: Boolean(params.compression),
      context_session_key: compressionSessionKey,
      read_cutoff_after_stack_index: committedReadCutoffAfterStackIndex,
      planned_read_cutoff_after_stack_index: params.compression?.readCutoffAfterStackIndex ?? null,
      compression_covered_end_stack_index: params.compression?.compressionCoveredEndStackIndex ?? null
    };
    await this.store.logTimelineEvent({
      traceId: String(params.metadata?.trace_id || ''),
      eventType: 'memory',
      eventName: 'core_memory_compressed',
      eventPhase: null,
      metadata: artifact
    });
    // Real compression committed (cutoff advanced → her live context just shrank). Push the
    // compression-done notify into the Notify Bucket exactly once. Reached only on the success
    // path (superseded/no-cutoff commits returned earlier or skip the gate), so no duplicate.
    if (params.compression && committedReadCutoffAfterStackIndex !== null) {
      await this.enqueueCoreMemoryCompressionDoneNotify({
        contextSessionKey: compressionSessionKey,
        committedReadCutoffAfterStackIndex,
        sourceTraceId: String(params.metadata?.trace_id || '') || null
      });
    }
    // ④ 专题物化【写】—— 提交**之后**。走到这里 read_cutoff / 近况 / 两份快照都已经落库,
    //    所以这一步无论怎么失败都不会把本轮最贵的东西(压缩提交)拖掉。水位只在文件真写成功
    //    之后推进:失败就一个字都不动,下一轮拿同一个水位重做同一批(重做不会补出第二份)。
    await this.runTopicMaterializationWrite(topicPlan);
    const commit = {
      text,
      artifact,
      toolResult
    };
    if (typeof this.options.onCoreMemoryCompressionCommitted === 'function') {
      await Promise.resolve(this.options.onCoreMemoryCompressionCommitted(commit)).catch((error: unknown) => {
        moduleLogger.warn('Failed to run post core-memory-compression hook', {
          contextSessionKey: compressionSessionKey,
          toolCallId: params.toolCall.callId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }
    return commit;
  }

  private async runSubconsciousAgentFork(params: {
    baseRequest: CanonicalAgentTurnRequest;
    queueMessage: QueueMessageRecord['payload'];
    runtimePrompt: ResolvedAgentRuntimePrompt;
    contextSessionKey: string;
    // The settling turn's narration (D), appended at the fork tail before the reminder. D is
    // stripped from baseRequest (the warm sent prefix), so this is how the fork still sees
    // "what she just said" without diverging the cache lineage.
    recentNarrationItems?: OpenResponseInputItem[];
    // 空转升级的两个入参：连续失效轮数 + 上一份 plan 原文。只影响 fork 尾部那条 reminder item。
    idleRounds?: number;
    lastPlanText?: string | null;
	  }): Promise<boolean> {
    const forkRunId = `subconscious-fork:${params.queueMessage.runId}:${uuidv4().slice(0, 8)}`;
    const baseForkMetadata = {
      trigger: 'empty_notify_after_final_answer',
      context_session_key: params.contextSessionKey,
      no_main_stack_persist: true,
      no_traffic_persist: true
    };

    // 1A 的内存侧凭据：端点兑现票据时要确认「这个 fork 当前确实在飞」。开关 OFF 时也维护它，
    // 成本为零，且让「有没有 fork 在跑」这个事实只有一个来源。
    this.activeSubconsciousForkRunId = forkRunId;
    this.subconsciousPlanSubmission = null;
    if (IDLE_PLAN_SKILL_SUBMISSION_ENABLED) {
      try {
        issueSubconsciousPlanTicket({
          forkRunId,
          traceId: params.queueMessage.traceId,
          runId: params.queueMessage.runId,
          nowMs: Date.now()
        });
      } catch (error) {
        // 签不出票 = 这一轮她没法交货。不如当场失败让 seed 保留、下个 tick 重试，
        // 也不要跑完一整个 fork 再发现交不出去。
        this.activeSubconsciousForkRunId = null;
        moduleLogger.warn('Failed to issue subconscious plan ticket', {
          forkRunId,
          error: error instanceof Error ? error.message : String(error)
        });
        return false;
      }
    }

    await this.recordSubconsciousAgentForkRunSafe({
      forkRunId,
      contextSessionKey: params.contextSessionKey,
      status: 'running',
      traceId: params.queueMessage.traceId,
      runId: params.queueMessage.runId,
      metadata: baseForkMetadata
    });
    await this.store.logTimelineEvent({
      traceId: params.queueMessage.traceId,
      eventType: 'decision',
      eventName: 'subconscious_agent_fork',
      eventPhase: 'start',
      metadata: {
        fork_run_id: forkRunId,
        no_main_stack_persist: true
      }
    });

    try {
      // OFF(默认)：Think-only fork — NO tools at all. allowedToolNames is empty, so exec_command
      // (and everything else) the model emits is rejected, never executed — the subconscious must
      // not touch the world; its only output is a <xiaoni_plan>. self_continuation_reminder.md
      // tells the model this ("只在脑子里想，不许调任何工具"), and this is what makes that true.
      //
      // ON：放行 exec_command，但只是【第一道闸】。第二道闸在下面执行前的 isAllowedSubconsciousCommand
      // ——命令必须是 `xiaoni-plan post <<'X' … X` 这一个形状，别的命令照旧拒。潜意识依然碰不到世界，
      // 它多出来的唯一能力是「把想好的方向交出去」。
      // 放宽执行层【不改 tools / tool_choice】，请求仍是主 agent 的逐字节克隆 → cache-safe，
      // 与压缩 fork 放宽时同理(见 runCoreMemoryCompressionFork 的同类注释)。
      const allowedToolNames = IDLE_PLAN_SKILL_SUBMISSION_ENABLED
        ? new Set<string>([TOOL_NAMES.execCommand])
        : new Set<string>();
      // 算【一次】，此后 turn-1 的 input 种子和每个 forkTurn 的 request 共用同一份字节。若每 turn 重算，
      // 升级段一旦随时间/状态漂移就会让 fork 自己的多 turn 前缀分叉 → turn-2 起冷读整窗。
      const forkReminderText = renderSubconsciousForkReminder({
        idleRounds: params.idleRounds ?? 0,
        lastPlanText: params.lastPlanText ?? null
      });
      let forkInput = buildSubconsciousAgentForkRequest(
        params.baseRequest,
        1,
        params.recentNarrationItems,
        forkReminderText
      ).input;
      let pendingForkOneShotInputItems: OpenResponseInputItem[] = [];
      let forkToolCallCount = 0;
      let lastForkSliceId: string | null = null;
      let lastLlmCallId: string | null = null;

      for (let forkTurn = 1; forkTurn <= SUBCONSCIOUS_AGENT_FORK_MAX_MODEL_SLICES; forkTurn += 1) {
        const forkRequest = buildSubconsciousAgentForkRequest(
          params.baseRequest,
          forkTurn,
          params.recentNarrationItems,
          forkReminderText
        );
        const forkRequestInput = pendingForkOneShotInputItems.length > 0
          ? [...forkInput, ...pendingForkOneShotInputItems]
          : forkInput;
        pendingForkOneShotInputItems = [];
        forkRequest.input = normalizeResponseInputItems(forkRequestInput);
        await this.waitForRuntimeEnabledBeforeModelSlice(params.queueMessage, params.queueMessage.runId);
        const modelResult = await this.executeSubconsciousAgentForkTurn(
          forkRequest,
          params.queueMessage,
          params.runtimePrompt,
          forkTurn
        );
        const forkSliceId = modelResult.llm_request_slice_id
          || modelResult.llm_call_id
          || `subconscious-fork-slice:${forkRunId}:${forkTurn}`;
        lastForkSliceId = forkSliceId;
        lastLlmCallId = modelResult.llm_call_id || null;
        const inputRows = await this.appendSubconsciousAgentForkItemsSafe({
          forkRunId,
          traceId: params.queueMessage.traceId,
          runId: params.queueMessage.runId,
          sourceType: 'subconscious_agent_fork_slices',
          sourceId: forkSliceId,
          llmRequestSliceId: forkSliceId,
          items: [buildForkInputStackItem({
            forkRunId,
            sliceId: forkSliceId,
            forkTurn,
            source: 'subconscious_agent_fork_input',
            inputItems: forkRequest.input
          }) as Record<string, unknown>]
        });
        const outputItems = extractCanonicalResponseOutputItems(modelResult);
        const outputRows = await this.appendSubconsciousAgentForkItemsSafe({
          forkRunId,
          traceId: params.queueMessage.traceId,
          runId: params.queueMessage.runId,
          sourceType: 'subconscious_agent_fork_slices',
          sourceId: forkSliceId,
          llmRequestSliceId: forkSliceId,
          items: buildModelOutputStackItems(outputItems, forkSliceId) as Array<Record<string, unknown>>
        });
        const outputItemIndexes = outputRows
          .map((row) => Number((row as { itemIndex?: unknown }).itemIndex))
          .filter((value) => Number.isFinite(value));
        const inputItemIndexes = inputRows
          .map((row) => Number((row as { itemIndex?: unknown }).itemIndex))
          .filter((value) => Number.isFinite(value));
        const inputStackItemIds = inputRows
          .map((row) => (row as { id?: unknown }).id)
          .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number');
        const toolCallForkItemIdByCallId = new Map<string, string | number>();
        for (const row of outputRows) {
          const toolCallId = typeof (row as { toolCallId?: unknown }).toolCallId === 'string'
            ? (row as { toolCallId: string }).toolCallId
            : null;
          const itemKind = typeof (row as { itemKind?: unknown }).itemKind === 'string'
            ? (row as { itemKind: string }).itemKind
            : null;
          const id = (row as { id?: unknown }).id;
          if (toolCallId && itemKind === 'function_call' && (typeof id === 'string' || typeof id === 'number')) {
            toolCallForkItemIdByCallId.set(toolCallId, id);
          }
        }

        await this.recordSubconsciousAgentForkSliceSafe({
          forkRunId,
          sliceId: forkSliceId,
          llmCallId: modelResult.llm_call_id || null,
          inputStartIndex: inputItemIndexes.length > 0 ? Math.min(...inputItemIndexes) : null,
          inputEndIndex: inputItemIndexes.length > 0 ? Math.max(...inputItemIndexes) : null,
          inputStackItemIds,
          outputStartIndex: outputItemIndexes.length > 0 ? Math.min(...outputItemIndexes) : null,
          outputEndIndex: outputItemIndexes.length > 0 ? Math.max(...outputItemIndexes) : null,
          canonicalRequest: (modelResult.canonical_request || forkRequest) as Record<string, unknown>,
          wireRequest: modelResult.wire_request || null,
          canonicalResponse: modelResult.canonical_response || null,
          wireResponse: modelResult.wire_response || null,
          rawResponse: modelResult.raw_response || null,
          outputItems,
          status: modelResult.success ? 'completed' : 'failed',
          tokenUsage: buildProviderTokenUsage(modelResult),
          traceId: params.queueMessage.traceId,
          runId: params.queueMessage.runId,
          agentTurn: forkTurn,
          modelName: modelResult.model || params.runtimePrompt.modelName,
          modelProvider: modelResult.provider || null,
          requestFormatVersion: modelResult.request_format_version || null,
          wireProviderFormat: modelResult.wire_provider_format || null,
          processingTimeMs: readOptionalNumber(modelResult.performance?.processing_time_ms),
          metadata: {
            ...baseForkMetadata,
            ...buildProviderWireMetadata(modelResult),
            fork_run_id: forkRunId,
            fork_turn: forkTurn,
            execution_mode: 'subconscious_agent_fork'
          }
        });

        const naturalLanguage = selectSubconsciousPlanFromText(outputItems, IDLE_PLAN_SKILL_SUBMISSION_ENABLED);
        if (naturalLanguage) {
          const notifyQueueMessage = await this.enqueueSubconsciousAgentNotify({
            forkRunId,
            forkSliceId,
            llmCallId: modelResult.llm_call_id || null,
            traceId: params.queueMessage.traceId,
            runId: params.queueMessage.runId,
            text: naturalLanguage
          });
          const notifyQueueMessageId = Number(notifyQueueMessage?.queueId || 0) || null;
          await this.completeSubconsciousAgentForkRunSafe({
            forkRunId,
            status: 'completed',
            notifyQueueMessageId,
            summaryText: naturalLanguage,
            artifact: {
              notify_queue_message_id: notifyQueueMessageId,
              llm_request_slice_id: forkSliceId,
              llm_call_id: modelResult.llm_call_id || null,
              text_length: naturalLanguage.length,
              fork_turn_count: forkTurn,
              fork_tool_call_count: forkToolCallCount
            },
            metadata: baseForkMetadata
          });
          await this.store.logTimelineEvent({
            traceId: params.queueMessage.traceId,
            eventType: 'decision',
            eventName: 'subconscious_agent_fork',
            eventPhase: 'end',
            metadata: {
              status: 'completed',
              fork_run_id: forkRunId,
              notify_queue_message_id: notifyQueueMessageId,
              llm_request_slice_id: forkSliceId,
              fork_turn_count: forkTurn,
              fork_tool_call_count: forkToolCallCount
            }
          });
          return true;
        }

        const actionPlan = this.responseActionRouter.route(modelResult.canonical_response);
        if (!actionPlan.hasToolCall) {
          // 这一轮既没交出 plan(上面的 extract 已经先跑过)、也没有可执行的工具调用。
          //
          // 改前这里是【裸 continue】：只把 assistant 文本 push 进 forkInput 就进下一轮，于是
          // 下一轮请求的最后一条是 assistant message → Anthropic 直接 400
          // 「This model does not support assistant message prefill. The conversation must end
          // with a user message.」。60 天里这个 400 出现 5 次，每次都当场打断自驱动链。
          // (2026-07-28 14:51 那次她其实把整份 plan 都写出来了，只是 stop_reason=tool_use 把它
          //  标成了 commentary，抠不出来 → 落到这条分支 → turn 4 请求尾巴是 assistant → 400。)
          //
          // 现在补一条 developer 纠正 item。它在 wire 上映射成 user turn，所以下一轮请求的尾巴
          // 永远是 user turn —— 这个 400 从【结构上】不可能再发生，不是靠 catch 兜。顺带她也拿到
          // 了「你还没交出去」的明确反馈，而不是被静默地再问一遍。
          for (const replayItem of actionPlan.replayableOutputs) {
            forkInput.push(replayItem.inputItem as OpenResponseInputItem);
          }
          forkInput.push(buildDeveloperInputItem([renderSubconsciousPlanCorrection()]));
          continue;
        }

        for (const replayItem of actionPlan.replayableOutputs) {
          forkInput.push(replayItem.inputItem);
          if (!isReplayableToolCall(replayItem)) {
            continue;
          }
          const toolCall = replayItem.toolCall;
          forkToolCallCount += 1;
          if (forkToolCallCount > SUBCONSCIOUS_AGENT_FORK_MAX_TOOL_CALLS) {
            throw new Error(`subconscious agent fork exceeded ${SUBCONSCIOUS_AGENT_FORK_MAX_TOOL_CALLS} tool calls`);
          }
          const forkToolExecutionId = `subconscious-fork-tool:${forkRunId}:${toolCall.callId}`;
          await this.recordSubconsciousAgentForkToolExecutionSafe({
            forkRunId,
            executionId: forkToolExecutionId,
            llmRequestSliceId: forkSliceId,
            llmCallId: modelResult.llm_call_id || null,
            toolCallId: toolCall.callId,
            toolName: toolCall.name,
            arguments: toolCall.args,
            rawArguments: toolCall.rawArguments,
            status: 'running',
            sideEffect: isToolCallSideEffecting(toolCall),
            traceId: params.queueMessage.traceId,
            runId: params.queueMessage.runId,
            agentTurn: forkTurn,
            stackCallItemId: toolCallForkItemIdByCallId.get(toolCall.callId) || null,
            metadata: {
              ...baseForkMetadata,
              fork_turn: forkTurn,
              model_name: params.runtimePrompt.modelName,
              session_key: params.queueMessage.sessionKey,
              chat_type: params.queueMessage.chatType
            }
          });

          let rawToolResult: Record<string, unknown>;
          let toolStatus: 'completed' | 'failed' = 'completed';
          let toolErrorMessage: string | null = null;
          try {
            // 两道闸：
            //  ① allowedToolNames —— OFF 时是空集(think-only，任何工具都拒)；ON 时只有 exec_command。
            //  ② isAllowedSubconsciousCommand —— ON 时命令还必须是 `xiaoni-plan post <<'X' … X`
            //     这一个形状。两道都过才真执行；任一不过都走 rejected 反馈，命令绝不落到 executor。
            // 拒绝文案：OFF 用「你现在只想、不做」那份；ON 时改用压缩 fork 那份带 {{ALLOWED_TOOLS}} 的
            // 通用文案 —— 复用现成的，不再多养一份只差一句话的副本。
            const toolAllowed = allowedToolNames.has(toolCall.name);
            const commandAllowed = !IDLE_PLAN_SKILL_SUBMISSION_ENABLED
              || toolCall.name !== TOOL_NAMES.execCommand
              || isAllowedSubconsciousCommand((toolCall.args as Record<string, unknown> | undefined)?.cmd);
            rawToolResult = toolAllowed && commandAllowed
              ? await this.executeTool(toolCall, params.queueMessage, {
                  currentCanonicalRequest: forkRequest
                })
              : IDLE_PLAN_SKILL_SUBMISSION_ENABLED
                ? buildToolRejectedResult(toolCall, renderPromptSnippet('fork_tool_rejected_output.md', {
                    TOOL_NAME: toolCall.name,
                    ALLOWED_TOOLS: `${XIAONI_PLAN_SKILL_BIN} post（只这一条）`
                  }))
                : buildToolRejectedResult(toolCall, renderPromptSnippet('subconscious_tool_rejected_output.md', {
                    TOOL_NAME: toolCall.name
                  }));
          } catch (error) {
            rawToolResult = buildToolErrorResult(toolCall, error);
            toolStatus = 'failed';
            toolErrorMessage = String(rawToolResult.error_message || rawToolResult.error || 'Tool execution failed');
          }

          const runtimeEnergyState = await this.getCurrentRuntimeEnergyState(params.queueMessage);
          const continuation = applyToolResultToLoopInput(toolCall, rawToolResult, {
            loopInput: forkInput,
            speakingToolName: params.queueMessage.chatType === 'direct' ? TOOL_NAMES.privateReply : TOOL_NAMES.groupReply,
            hasVisibleReply: false,
            runtimeEnergyState
          });
          if (continuation.forcedVisibleReply) {
            rawToolResult = {
              ...rawToolResult,
              forced_visible_reply_rejected: true,
              error_message: 'subconscious agent fork cannot force visible delivery'
            };
            toolStatus = 'failed';
            toolErrorMessage = 'subconscious agent fork cannot force visible delivery';
          }
          const toolOutputRows = await this.appendSubconsciousAgentForkItemsSafe({
            forkRunId,
            traceId: params.queueMessage.traceId,
            runId: params.queueMessage.runId,
            sourceType: 'subconscious_agent_fork_tool_executions',
            sourceId: forkToolExecutionId,
            llmRequestSliceId: forkSliceId,
            items: buildToolResultStackItems({
              toolCall,
              toolResult: rawToolResult,
              continuationItems: continuation.inputItems,
              llmRequestSliceId: forkSliceId
            }) as Array<Record<string, unknown>>
          });
          await this.completeSubconsciousAgentForkToolExecutionSafe({
            executionId: forkToolExecutionId,
            status: toolStatus,
            result: rawToolResult,
            errorMessage: toolErrorMessage,
            stackOutputItemId: (toolOutputRows[0] as { id?: string | number } | undefined)?.id || null
          });
          forkInput.push(...continuation.inputItems);
          pendingForkOneShotInputItems.push(...continuation.oneShotInputItems);

          // fork 的出口。`post` 到达端点那一刻,入队已经在这个进程里完成了
          // (redeemSubconsciousPlanTicket),所以这里读的是进程内状态,不是 stdout。
          // 放在本次工具调用的记账【全部落完】之后再判,避免早退留下一行永远 running 的
          // tool_execution。skill 仍会打 XIAONI_PLAN_QUEUED / FAILED 到 stdout —— 那是给她
          // 和审计看的反馈,引擎不再依赖它。
          const submission = this.takeSubconsciousPlanSubmission(forkRunId);
          if (submission) {
            if (submission.ok) {
              // 入队【已经发生】了 —— 这就是「入队即提交点」:从这一刻起 fork 循环怎么死
              // 都不影响这份 plan。
              await this.completeSubconsciousAgentForkRunSafe({
                forkRunId,
                status: 'completed',
                notifyQueueMessageId: submission.queueId,
                summaryText: null,
                artifact: {
                  submitted_via_skill: true,
                  notify_queue_message_id: submission.queueId,
                  llm_request_slice_id: forkSliceId,
                  fork_turn_count: forkTurn,
                  fork_tool_call_count: forkToolCallCount
                },
                metadata: baseForkMetadata
              });
              await this.store.logTimelineEvent({
                traceId: params.queueMessage.traceId,
                eventType: 'decision',
                eventName: 'subconscious_agent_fork',
                eventPhase: 'end',
                metadata: {
                  status: 'completed',
                  submitted_via_skill: true,
                  fork_run_id: forkRunId,
                  notify_queue_message_id: submission.queueId,
                  fork_turn_count: forkTurn
                }
              });
              return true;
            }
            // 她交了,我们这边没接住。不发纠正提示(那是冤枉她),中止;seed 保留,60s 后重试。
            moduleLogger.warn('Subconscious plan submission failed on the engine side', {
              forkRunId,
              reason: submission.reason
            });
            await this.completeSubconsciousAgentForkRunSafe({
              forkRunId,
              status: 'failed',
              summaryText: null,
              errorMessage: `plan_submission_failed: ${submission.reason}`,
              artifact: {
                submitted_via_skill: true,
                submission_failed_reason: submission.reason,
                llm_request_slice_id: forkSliceId,
                fork_turn_count: forkTurn
              },
              metadata: baseForkMetadata
            });
            return false;
          }
        }
      }

      await this.completeSubconsciousAgentForkRunSafe({
        forkRunId,
        status: 'completed',
        summaryText: null,
        artifact: {
          no_stimulus: true,
          max_turns_exhausted: true,
          llm_request_slice_id: lastForkSliceId,
          llm_call_id: lastLlmCallId,
          fork_turn_count: SUBCONSCIOUS_AGENT_FORK_MAX_MODEL_SLICES,
          fork_tool_call_count: forkToolCallCount
        },
        metadata: baseForkMetadata
      });
      await this.store.logTimelineEvent({
        traceId: params.queueMessage.traceId,
        eventType: 'decision',
        eventName: 'subconscious_agent_fork',
        eventPhase: 'end',
        metadata: {
          status: 'no_stimulus',
          reason: 'max_turns_exhausted',
          fork_run_id: forkRunId,
          llm_request_slice_id: lastForkSliceId,
          fork_tool_call_count: forkToolCallCount
        }
      });
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.completeSubconsciousAgentForkRunSafe({
        forkRunId,
        status: 'failed',
        errorMessage: message,
        metadata: baseForkMetadata
      });
      await this.store.logTimelineEvent({
        traceId: params.queueMessage.traceId,
        eventType: 'decision',
        eventName: 'subconscious_agent_fork',
        eventPhase: 'end',
        metadata: {
          status: 'failed',
          fork_run_id: forkRunId,
          error_message: message
        }
      });
      return false;
    }
  }

  private async enqueueSubconsciousAgentNotify(params: {
    forkRunId: string;
    forkSliceId: string;
    llmCallId: string | null;
    traceId: string;
    runId: string;
    text: string;
  }) {
    const enqueuer = (this.store as RuntimeStore & {
      enqueueQueueMessage?: RuntimeStore['enqueueQueueMessage'];
    }).enqueueQueueMessage;
    if (typeof enqueuer !== 'function') {
      throw new Error('subconscious agent notify requires queue enqueue persistence');
    }
    const now = new Date();
    const messageSid = `subconscious-agent:${params.forkRunId}`;
    const botAccountId = agentConfig.botAccountId;
    const sessionKey = getGlobalPromptContextSessionKey();
    // 记下这份真正发出去的 plan 原文。下一次空转升级时原样回贴给潜意识看 —— 它得知道「失败的是哪一份」，
    // 否则只会把同一批方向换个说法再写一遍(实测 95 条 plan 只有 22 种开头)。纯进程内存，不进任何请求前缀。
    setLastEmittedSubconsciousPlan(sessionKey, params.text);
    const promptFacingText = renderSubconsciousAgentNotify(params.text);
    const rawPayload = {
      reason: 'subconscious_agent',
      fork_run_id: params.forkRunId,
      fork_slice_id: params.forkSliceId,
      llm_call_id: params.llmCallId,
      final_answer_text: params.text,
      notify_template: 'subconscious_agent_notify.md',
      source_trace_id: params.traceId,
      source_run_id: params.runId
    };
    const inboundContext = {
      Body: promptFacingText,
      BodyForAgent: promptFacingText,
      BodyForCommands: promptFacingText,
      RawBody: promptFacingText,
      CommandBody: promptFacingText,
      From: botAccountId,
      To: botAccountId,
      SessionKey: sessionKey,
      AccountId: botAccountId,
      ChatType: 'direct',
      ConversationLabel: XIAONI_IDENTITY_KEY,
      SenderName: XIAONI_IDENTITY_KEY,
      SenderId: botAccountId,
      Timestamp: now.getTime(),
      Provider: 'runtime',
      Surface: 'system_reminder',
      WasMentioned: false,
      NativeChannelId: sessionKey,
      CommandAuthorized: false
    };
    const payload = {
      messageId: messageSid,
      rawBody: promptFacingText,
      commandBody: promptFacingText,
      receivedAt: now.toISOString(),
      systemReminder: {
        reminder: promptFacingText,
        reason: 'subconscious_agent',
        sourceTraceId: params.traceId,
        sourceRunId: params.runId,
        sourceLlmCallId: params.llmCallId,
        sourceTurn: 1,
        createdAt: now.toISOString()
      },
      subconsciousAgent: rawPayload
    };

    return enqueuer.call(this.store, {
      message: {
        traceId: params.traceId,
        source: 'system_reminder',
        messageSid,
        dedupeKey: messageSid,
        chatType: 'direct',
        sessionKey,
        peerId: XIAONI_IDENTITY_KEY,
        peerName: XIAONI_IDENTITY_KEY,
        senderId: botAccountId,
        senderName: XIAONI_IDENTITY_KEY,
        accountId: botAccountId,
        bodyForAgent: promptFacingText,
        rawPayload,
        inboundContext
      },
      payload,
      availableAt: now
    });
  }

  /**
   * 外部投递入口。小腻自己写的 skill(check-email 这类后台观察脚本)发现了事情，打这里把它送到
   * 她面前 —— 在此之前那些脚本只能往日志里 print，没有任何通道能叫醒她。
   *
   * 路由只做转译，校验全在这里(同 redeemSubconsciousPlanTicket 的分工)。
   */
  async ingestExternalNotify(params: { text: unknown; sourceSystem: unknown }): Promise<
    | { ok: true; queueId: number | null }
    | { ok: false; status: 400 | 500; reason: string }
  > {
    const text = typeof params.text === 'string' ? params.text.trim() : '';
    const sourceSystem = typeof params.sourceSystem === 'string' ? params.sourceSystem.trim() : '';
    if (!text) {
      return { ok: false, status: 400, reason: 'empty_text' };
    }
    if (text.length > EXTERNAL_NOTIFY_MAX_TEXT_LENGTH) {
      return { ok: false, status: 400, reason: 'text_too_long' };
    }
    if (!EXTERNAL_NOTIFY_SOURCE_SYSTEM_PATTERN.test(sourceSystem)) {
      return { ok: false, status: 400, reason: 'invalid_source_system' };
    }
    try {
      const notify = await this.enqueueExternalNotify({ sourceSystem, text });
      return { ok: true, queueId: Number(notify?.queueId || 0) || null };
    } catch (error) {
      moduleLogger.warn('Failed to enqueue external notify', {
        sourceSystem,
        error: error instanceof Error ? error.message : String(error)
      });
      return { ok: false, status: 500, reason: 'enqueue_failed' };
    }
  }

  // 逐字段克隆 enqueueSubconsciousAgentNotify 的形状 —— 那条路径已经在线验过缓存安全:正文在
  // enqueue 时刻冻结进 payload.systemReminder.reminder，下一 run 的 stack replay 从同一字段读回
  // 同样的字节，逐字节可重建。这里唯一的区别是 reason / 模板 / dedupe key 前缀。
  //
  // dedupeKey 每次调用随机(用户拍板:服务端生成)。后果是【没有幂等】—— 同一件事投两次就是两条
  // notify。投递方(skill)必须自己保证只在状态真变化时投,别指望这一层去重。
  private async enqueueExternalNotify(params: { sourceSystem: string; text: string }) {
    const enqueuer = (this.store as RuntimeStore & {
      enqueueQueueMessage?: RuntimeStore['enqueueQueueMessage'];
    }).enqueueQueueMessage;
    if (typeof enqueuer !== 'function') {
      throw new Error('external notify requires queue enqueue persistence');
    }
    const now = new Date();
    const messageSid = `external-notify:${params.sourceSystem}:${uuidv4()}`;
    // trace_id 显式给足,不走 enqueueAgentQueueMessage 的兜底。空 trace_id 会让 stack 的
    // runtime-input event_id 塌到 runId 兜底,同一 run 两条撞 ON CONFLICT 被吞 → 下个 run replay
    // 变短 → run 边界缓存击穿(docs/CACHE_CONTRACT.md §3)。
    const traceId = `runtrace_${now.getTime()}_${uuidv4().slice(0, 8)}`;
    const botAccountId = agentConfig.botAccountId;
    const sessionKey = getGlobalPromptContextSessionKey();
    const promptFacingText = renderExternalNotify(params.sourceSystem, params.text);
    const rawPayload = {
      reason: 'external_notify',
      source_system: params.sourceSystem,
      notify_template: 'external_notify.md'
    };
    const inboundContext = {
      Body: promptFacingText,
      BodyForAgent: promptFacingText,
      BodyForCommands: promptFacingText,
      RawBody: promptFacingText,
      CommandBody: promptFacingText,
      From: botAccountId,
      To: botAccountId,
      SessionKey: sessionKey,
      AccountId: botAccountId,
      ChatType: 'direct',
      ConversationLabel: XIAONI_IDENTITY_KEY,
      SenderName: XIAONI_IDENTITY_KEY,
      SenderId: botAccountId,
      Timestamp: now.getTime(),
      Provider: 'runtime',
      Surface: 'system_reminder',
      WasMentioned: false,
      NativeChannelId: sessionKey,
      CommandAuthorized: false
    };
    const payload = {
      messageId: messageSid,
      rawBody: promptFacingText,
      commandBody: promptFacingText,
      receivedAt: now.toISOString(),
      systemReminder: {
        reminder: promptFacingText,
        reason: 'external_notify',
        sourceSystem: params.sourceSystem,
        createdAt: now.toISOString()
      },
      externalNotify: rawPayload
    };

    return enqueuer.call(this.store, {
      message: {
        traceId,
        source: 'system_reminder',
        messageSid,
        dedupeKey: messageSid,
        chatType: 'direct',
        sessionKey,
        peerId: XIAONI_IDENTITY_KEY,
        peerName: XIAONI_IDENTITY_KEY,
        senderId: botAccountId,
        senderName: XIAONI_IDENTITY_KEY,
        accountId: botAccountId,
        bodyForAgent: promptFacingText,
        rawPayload,
        inboundContext
      },
      payload,
      availableAt: now
    });
  }

  // Compression-done notify: after a real compression commits (cutoff advanced → her context
  // just shrank), push ONE system_reminder into the Notify Bucket so the main loop sees「刚整理过
  // 一次记忆」. Mirrors enqueueSubconsciousAgentNotify (same framework-native delivery path):
  // renderSystemReminder wraps systemReminder.reminder in <system_reminder>, folds into the
  // running run or claims a fresh one, persists as a runtime_input stack item, and replays it
  // byte-for-byte — so cache safety is inherited, not re-derived. The East-8 stamp is frozen
  // into the reminder text HERE (enqueue time), never re-rendered per build. dedupeKey keys the
  // notify to the committed cutoff so a retry/re-commit can't enqueue a duplicate.
  private async enqueueCoreMemoryCompressionDoneNotify(params: {
    contextSessionKey: string;
    committedReadCutoffAfterStackIndex: number;
    sourceTraceId: string | null;
  }) {
    const enqueuer = (this.store as RuntimeStore & {
      enqueueQueueMessage?: RuntimeStore['enqueueQueueMessage'];
    }).enqueueQueueMessage;
    if (typeof enqueuer !== 'function') {
      return;
    }
    const now = new Date();
    const messageSid = `core-memory-compression-done:${params.contextSessionKey}:${params.committedReadCutoffAfterStackIndex}`;
    const botAccountId = agentConfig.botAccountId;
    const sessionKey = getGlobalPromptContextSessionKey();
    const reminderText = renderCoreMemoryCompressionDoneReminderText(now);
    const rawPayload = {
      reason: 'core_memory_compression_done',
      context_session_key: params.contextSessionKey,
      committed_read_cutoff_after_stack_index: params.committedReadCutoffAfterStackIndex,
      source_trace_id: params.sourceTraceId
    };
    const inboundContext = {
      Body: reminderText,
      BodyForAgent: reminderText,
      BodyForCommands: reminderText,
      RawBody: reminderText,
      CommandBody: reminderText,
      From: botAccountId,
      To: botAccountId,
      SessionKey: sessionKey,
      AccountId: botAccountId,
      ChatType: 'direct',
      ConversationLabel: XIAONI_IDENTITY_KEY,
      SenderName: XIAONI_IDENTITY_KEY,
      SenderId: botAccountId,
      Timestamp: now.getTime(),
      Provider: 'runtime',
      Surface: 'system_reminder',
      WasMentioned: false,
      NativeChannelId: sessionKey,
      CommandAuthorized: false
    };
    const payload = {
      messageId: messageSid,
      rawBody: reminderText,
      commandBody: reminderText,
      receivedAt: now.toISOString(),
      systemReminder: {
        reminder: reminderText,
        reason: 'core_memory_compression_done',
        sourceTraceId: params.sourceTraceId,
        createdAt: now.toISOString()
      }
    };
    try {
      await enqueuer.call(this.store, {
        message: {
          traceId: params.sourceTraceId || messageSid,
          source: 'system_reminder',
          messageSid,
          dedupeKey: messageSid,
          chatType: 'direct',
          sessionKey,
          peerId: XIAONI_IDENTITY_KEY,
          peerName: XIAONI_IDENTITY_KEY,
          senderId: botAccountId,
          senderName: XIAONI_IDENTITY_KEY,
          accountId: botAccountId,
          bodyForAgent: reminderText,
          rawPayload,
          inboundContext
        },
        payload,
        availableAt: now
      });
    } catch (error) {
      moduleLogger.warn('Failed to enqueue core memory compression done notify', {
        contextSessionKey: params.contextSessionKey,
        committedReadCutoffAfterStackIndex: params.committedReadCutoffAfterStackIndex,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Clock ping supervisor tick. Idempotent by construction (dedupeKey = the 2h slot), so callers
  // may invoke it on any cadence; only the first call in a slot actually enqueues.
  //
  // Deliberately NOT source 'phone_notification': only that source counts toward the 3-call
  // force-wake during a recovery session (packages/persistence/agent-recovery-sessions.js), so a
  // clock ping can never pull her out of a real sleep. On top of that we skip enqueueing entirely
  // while a recovery session is active — otherwise she would wake to a stack of stale pings.
  async ensureClockPingNotify(now: Date = new Date()): Promise<'enqueued' | 'skipped_sleeping' | 'skipped_duplicate' | 'unavailable'> {
    const enqueuer = (this.store as RuntimeStore & {
      enqueueQueueMessage?: RuntimeStore['enqueueQueueMessage'];
    }).enqueueQueueMessage;
    if (typeof enqueuer !== 'function' || !agentConfig.clockPingEnabled) {
      return 'unavailable';
    }

    // 格子判断必须排在所有 IO 之前。supervisor 每 60s 敲一次而报时每 2h 才发生一次,所以
    // 99% 的 tick 应该在这里就返回。往下走的读取都不便宜:getCurrentRuntimeEnergyState 走
    // refreshXiaoniLifeProjection——读 agent_life_state + 分批拉 life events + reduce + 回写,
    // 是一次事件溯源重放,不是缓存字段。前置之后每天 ~36 次而不是 ~4320 次。
    //
    // lastEnqueuedClockPingSlot 只是优化不是正确性依赖:进程重启丢了它顶多多敲一次库,
    // dedupe_key 唯一索引依旧兜底。
    const sessionKey = getGlobalPromptContextSessionKey();
    const slot = clockPingSlotId(now, agentConfig.clockPingIntervalMs);
    if (this.lastEnqueuedClockPingSlot === slot) {
      return 'skipped_duplicate';
    }

    // 走到这里说明真到点了。睡眠判断放在这之后——它不是为了省开销(那份 projection 本来就要读),
    // 也不是为了防积压(supersede 已经保证只留最新一格),而是因为 ping 的戳在入队时就冻死:
    // 睡觉期间入队的那条带的是睡前的锚点,她醒来会先看到唤醒提醒说「睡了 276 分钟」,紧接着
    // 读到这条说「上次睡醒是四个半小时前」,两句直接打架。而且醒来那条提醒本来就写了现在几点
    // 和睡了多久,睡觉期间的报时纯属多余。
    const activeSessionReader = (this.store as RuntimeStore & {
      getActiveAgentRecoverySession?: RuntimeStore['getActiveAgentRecoverySession'];
    }).getActiveAgentRecoverySession;
    if (typeof activeSessionReader === 'function') {
      const sleeping = await activeSessionReader.call(this.store).catch(() => null);
      if (sleeping) {
        return 'skipped_sleeping';
      }
    }

    const messageSid = `clock-ping:${sessionKey}:${slot}`;
    const botAccountId = agentConfig.botAccountId;
    const lastWakeAt = (await this.getCurrentRuntimeEnergyState(
      buildRuntimeLoopFrameQueueMessage().payload
    ).catch(() => null))?.lastWakeAt ?? null;
    const reminderText = renderClockPingReminderText(now, lastWakeAt);
    const rawPayload = {
      reason: 'clock_ping',
      clock_ping_slot: slot,
      last_wake_at: lastWakeAt
    };
    const inboundContext = {
      Body: reminderText,
      BodyForAgent: reminderText,
      BodyForCommands: reminderText,
      RawBody: reminderText,
      CommandBody: reminderText,
      From: botAccountId,
      To: botAccountId,
      SessionKey: sessionKey,
      AccountId: botAccountId,
      ChatType: 'direct',
      ConversationLabel: XIAONI_IDENTITY_KEY,
      SenderName: XIAONI_IDENTITY_KEY,
      SenderId: botAccountId,
      Timestamp: now.getTime(),
      Provider: 'runtime',
      Surface: 'system_reminder',
      WasMentioned: false,
      NativeChannelId: sessionKey,
      CommandAuthorized: false
    };
    const payload = {
      messageId: messageSid,
      rawBody: reminderText,
      commandBody: reminderText,
      receivedAt: now.toISOString(),
      systemReminder: {
        reminder: reminderText,
        reason: 'clock_ping',
        createdAt: now.toISOString()
      }
    };
    try {
      await enqueuer.call(this.store, {
        message: {
          traceId: messageSid,
          source: 'system_reminder',
          messageSid,
          dedupeKey: messageSid,
          chatType: 'direct',
          sessionKey,
          peerId: XIAONI_IDENTITY_KEY,
          peerName: XIAONI_IDENTITY_KEY,
          senderId: botAccountId,
          senderName: XIAONI_IDENTITY_KEY,
          accountId: botAccountId,
          bodyForAgent: reminderText,
          rawPayload,
          inboundContext
        },
        payload,
        availableAt: now
      });
      this.lastEnqueuedClockPingSlot = slot;
      // 只留最新一格。停机期间 supervisor 照常按格入队,不做这一步她恢复时会连着读到一串
      // 互相打架的时刻。放在入队【之后】:先保证新的那条落库,再判旧的过期,中途崩溃最坏
      // 结果是多留一条旧的,而不是一条都不剩。
      const superseder = (this.store as RuntimeStore & {
        supersedePendingClockPings?: RuntimeStore['supersedePendingClockPings'];
      }).supersedePendingClockPings;
      if (typeof superseder === 'function') {
        await superseder.call(this.store, { sessionKey, keepMessageSid: messageSid })
          .catch((error: unknown) => {
            moduleLogger.warn('Failed to supersede older pending clock pings', {
              slot,
              error: error instanceof Error ? error.message : String(error)
            });
          });
      }
      return 'enqueued';
    } catch (error) {
      // The unique dedupe_key index makes a same-slot retry a no-op — normal after a restart
      // that lost the in-process memo. Record the slot either way so we stop retrying it.
      this.lastEnqueuedClockPingSlot = slot;
      moduleLogger.debug('Clock ping notify not enqueued', {
        slot,
        error: error instanceof Error ? error.message : String(error)
      });
      return 'skipped_duplicate';
    }
  }

  // REQ2 STW: adopt a committed core-memory compression MID-RUN, at a between-turns
  // silent point, so a long-lived run (a busy group that keeps folding messages into
  // one run) actually shrinks instead of waiting for a settle that may never come.
  // The switch costs EXACTLY ONE cold prefill — the new <xiaoni_status> changes the cached
  // prefix — and then everything rides the new warm cache: subsequent main turns
  // extend the rebuilt requestInput, and any fork scheduled afterwards clones it.
  //
  // Silent point = main current turn finished (naturally true at the loop top) + the
  // COMPRESSION fork that produced this cutoff has finished committing. We do NOT wait
  // for self-driven / image / heartbeat forks — see docs/CACHE_CONTRACT.md §4
  // (REQ2 STW — "为什么不等其它 fork"). Why: each fork is a frozen clone of the main lineage at its own fork
  // point (P_n), and with the head+tail cache_control contract those P_n are INDEPENDENT
  // prefix-keyed entries. Rewriting the main to P_new neither evicts nor mutates any P_n
  // (cache entries are immutable, byte-keyed), so a mid-fork switch never 穿透s a running
  // fork — it keeps hitting its frozen P_n. Waiting for ALL forks would instead
  // deterministically STARVE the switch in a busy session (6 forks at staggered points →
  // ~never all idle). Only the compression fork is load-bearing: its cutoff must be
  // committed before the main can adopt it, which is exactly what the per-key compression-fork
  // gate (no in-flight compression fork for THIS contextSessionKey) + the live-cutoff check
  // below enforce.
  private async applyPendingCompressionMidRunIfSilent(params: {
    contextSessionKey: string;
    appliedRunCutoff: number | null;
    fullHistory: StackBackedConversationTurn[];
    loopContinuation: OpenResponseInputItem[];
    queueMessage: QueueMessageRecord['payload'];
    runtimePrompt: ResolvedAgentRuntimePrompt;
    runtimeIdentityFacts: RuntimeIdentityFactProjection[];
    pendingProactiveShare: string | null;
    developerContextBlock: string | null;
    runtimeEnergyState: RuntimeEnergyState | null;
    precomputedCurrentTurnInputItems: OpenResponseInputItem[];
    // The activation's OWN item-ordering flag (= initial build's
    // options.initialLoopContinuationBeforeCurrentTrigger). The STW rebuild MUST reuse it so the
    // switched live body orders items relative to the trigger identically to how this activation
    // was originally built, and to how stack-replay will reconstruct it. Defaulting it to false
    // would emit [history, trigger, …] where replay reconstructs [history, …, trigger] → an
    // item-order divergence = the exact §3 byte-replay break this branch exists to prevent.
    // (Still load-bearing after the re-read switch: the flag positions the trigger, which is not
    // a stack item and therefore cannot be recovered from the rows.)
    loopContinuationBeforeCurrentTrigger: boolean;
    // 甲: the run's own trigger mode. suppress_current_trigger for a subconscious
    // wake keeps the one-shot <xiaoni_plan> out of the rebuilt requestInput. Defaults
    // to fresh_trigger (unchanged behavior) for every other run.
    triggerInputMode?: RuntimeTriggerInputMode;
  }): Promise<{ requestInput: OpenResponseInputItem[]; appliedCutoff: number } | null> {
    const key = params.contextSessionKey;
    // Floor for "this run hasn't built/switched to any cutoff yet". stack_index is a
    // positive dense ascending serial, so -1 sorts below every real cutoff; the <= comparisons
    // below then treat a null prior cutoff as "nothing applied yet" without a separate null branch.
    const priorCutoff = params.appliedRunCutoff ?? -1;
    const pending = this.pendingCompressionAppliedCutoffBySession.get(key) ?? null;
    if (pending === null || pending <= priorCutoff) {
      return null; // nothing scheduled, or this run already built/switched to it
    }
    // Drain gate: wait ONLY for the compression fork that produced the cutoff to finish
    // committing. Per-key (.has(key)) to match the contract ("该 key 空") and the per-key
    // latch above — a compression fork on ANOTHER session must not gate this one. Other
    // forks (self-driven / image / heartbeat) are frozen clones on their own independent
    // prefix-keyed cache entries and are NOT 穿透ed by the switch, so we deliberately do not
    // wait for them (waiting would starve the switch — see the method comment + CACHE_CONTRACT.md §4).
    if (this.coreMemoryCompressionForks.has(key)) {
      return null; // this key's compression fork still running — retry at the next turn boundary
    }
    // Confirm the fork actually committed the new context window (cutoff + summary).
    const cutoffState = await this.store.getSessionReadCutoffState(key);
    const liveCutoff = cutoffState?.readCutoffAfterStackIndex ?? null;
    if (liveCutoff === null || liveCutoff < pending || liveCutoff <= priorCutoff) {
      return null; // commit not landed yet, or no real advance
    }
    // Atomic context reorganization: drop history <= the new cutoff, swap in the new
    // <xiaoni_status>, KEEP this activation's accumulated loopContinuation. Reuse the exact
    // (cache_volatile) current-turn trigger so the rebuilt prefix is byte-stable — only THIS
    // request cold-reads; every later request and every fork cloned afterwards hits the new
    // warm cache.
    //
    // The retained tail is filtered out of the activation-start snapshot rather than re-read from
    // the stack, and that is deliberate: the stack also holds this activation's trigger and its
    // accumulated items, so a plain re-read would (a) re-supply the trigger that
    // precomputedCurrentTurnInputItems adds below (duplicate) and (b) place the accumulated items
    // BEFORE the trigger, while a fresh activation's live body orders them AFTER it — an item-order
    // divergence from what stack-replay reconstructs, i.e. exactly the §3 byte-replay break the
    // ordering flag below exists to prevent.
    //
    // Correctness of the snapshot therefore depends on the cutoff never landing above it. That is
    // enforced at planning time (see maybeScheduleCompressionFromLiveStack's snapshot ceiling):
    // every item loopContinuation holds sits strictly above the planned cutoff, so keeping it whole
    // cannot retain something the ledger considers evicted.
    const retainedHistory = params.fullHistory.filter((turn) => turn.id > liveCutoff);
    const requestInput = buildLoopRequestInput({
      history: retainedHistory,
      queueMessage: params.queueMessage,
      runtimePrompt: params.runtimePrompt,
      loopContinuation: params.loopContinuation,
      runtimeIdentityFacts: params.runtimeIdentityFacts,
      contextSummary: cutoffState?.contextSummary ?? null,
      diaryIndexSnapshot: cutoffState?.diaryIndexSnapshot ?? null,
      peopleIndexSnapshot: cutoffState?.peopleIndexSnapshot ?? null,
      pendingProactiveShare: params.pendingProactiveShare,
      developerContextBlock: params.developerContextBlock,
      runtimeEnergyState: params.runtimeEnergyState,
      triggerInputMode: params.triggerInputMode ?? 'fresh_trigger',
      loopContinuationBeforeCurrentTrigger: params.loopContinuationBeforeCurrentTrigger,
      precomputedCurrentTurnInputItems: params.precomputedCurrentTurnInputItems
    });
    // One-cold-only: clear the latch so the switch fires exactly once; reset the trigger
    // counter so the now-small context re-arms from scratch if still genuinely over line.
    this.pendingCompressionAppliedCutoffBySession.delete(key);
    resetCompressionTriggerCounter(key);
    this.persistCompressionTriggerCounter(key);
    await this.store.logTimelineEvent({
      traceId: params.queueMessage.traceId,
      eventType: 'memory',
      eventName: 'core_memory_compression_applied_midrun',
      eventPhase: null,
      metadata: {
        context_session_key: key,
        previous_run_cutoff: params.appliedRunCutoff,
        applied_read_cutoff: liveCutoff,
        retained_history_count: retainedHistory.length
      }
    }).catch(() => {});
    return { requestInput, appliedCutoff: liveCutoff };
  }

  /**
   * Decide, after a single LLM request, whether to start a background compression fork.
   *
   *   trigger armed?  ──no──> return (in-memory counter read, no I/O)
   *         │ yes
   *   already pending apply? ──yes──> return (a committed compression is waiting to be switched in)
   *         │ no
   *   read live stack from current cutoff ──> plan tail-KEEP cutoff ──> null? ──> return
   *         │ plan
   *   scheduleCoreMemoryCompressionFork(clone of the request we are about to send)
   *
   * The stack read is NOT on the hot path: it happens only once the counter is already armed
   * (real input_tokens over the soft line for COMPRESSION_TRIGGER_CONSECUTIVE_TURNS consecutive
   * requests), which is rare, and the same read is what every fresh activation does anyway.
   *
   * The cutoff is planned against the LIVE stack rather than a snapshot taken when the activation
   * started. That is the whole point: a snapshot goes stale as soon as the first response lands, so
   * planning against it would (a) miss everything appended since and (b) hand the apply path a
   * cutoff pointing into rows it cannot see. Reading here means schedule, apply, and the next
   * activation's replay all plan over the same rows.
   */
  private async maybeScheduleCompressionFromLiveStack(params: {
    contextSessionKey: string;
    baseRequest: CanonicalAgentTurnRequest;
    queueMessage: QueueMessageRecord['payload'];
    runtimePrompt: ResolvedAgentRuntimePrompt;
    // Highest stack_index the running activation's history snapshot covers (its last block, or null
    // for an empty snapshot). The planned cutoff is capped here — see the ceiling note below.
    snapshotCeilingStackIndex: number | null;
  }): Promise<void> {
    const key = params.contextSessionKey;
    if (!shouldTriggerCompressionFromRealInput(key) && !shouldTriggerCompressionFromWireBytes(key)) {
      return;
    }
    // A compression already committed but not yet switched in by the main loop. Scheduling a second
    // one here would plan against a cutoff the live request has not adopted yet — let the STW apply
    // at the top of the loop land first; it resets the counter, so the next measurement re-arms from
    // scratch against the (now smaller) context.
    if (this.pendingCompressionAppliedCutoffBySession.has(key)) {
      return;
    }
    let cutoffState: SessionReadCutoffState | null = null;
    let liveHistory: StackBackedConversationTurn[] = [];
    try {
      cutoffState = await this.store.getSessionReadCutoffState(key);
      liveHistory = await this.loadStackHistoryBlocks(cutoffState, params.queueMessage.traceId);
    } catch (error) {
      // Timing-only path: a failed read means we simply do not compress after THIS request. The
      // counter stays armed, so the next request retries. Never let it break the turn.
      moduleLogger.warn('Failed to read live stack while deciding compression', {
        traceId: params.queueMessage.traceId,
        contextSessionKey: key,
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }
    if (liveHistory.length === 0) {
      return;
    }
    // SNAPSHOT CEILING: the running activation rebuilds its body from the history snapshot it took
    // at start, plus the items it has accumulated since (loopContinuation). Only the snapshot half
    // is filtered by the cutoff, so a cutoff ABOVE the snapshot would leave accumulated items in the
    // sent request that the ledger considers evicted — the live body and what the next activation
    // replays from the stack would then disagree, which is a whole-prefix miss at the boundary.
    // Planning against the live stack but capping at the snapshot keeps the two halves consistent
    // without having to carry stack indexes on the in-memory copy.
    //
    // The cost is a real ceiling: items this activation produced itself cannot be evicted while it
    // is still running, so a very long stretch still grows unbounded past this point and relies on
    // maybeHaltForCompressionOverrun. Lifting it means teaching the rebuild to evict from the
    // accumulated half too — deliberately out of scope here.
    const plannable = params.snapshotCeilingStackIndex === null
      ? liveHistory
      : liveHistory.filter((turn) => turn.id <= params.snapshotCeilingStackIndex!);
    if (plannable.length === 0) {
      return;
    }
    const compressionPoint = planReadCutoffForForcedCompression(plannable);
    if (!compressionPoint) {
      return; // at/under the retained-tail floor, or no clean boundary that keeps it — nothing to evict
    }
    const previousReadCutoffAfterStackIndex = cutoffState?.readCutoffAfterStackIndex ?? null;
    if (
      previousReadCutoffAfterStackIndex !== null
      && compressionPoint.readCutoffAfterStackIndex !== null
      && compressionPoint.readCutoffAfterStackIndex <= previousReadCutoffAfterStackIndex
    ) {
      return; // would not advance the cutoff
    }
    // Same derivation as buildContextBudgetPlan — these three are carried on the plan for
    // observability/fork metadata only; they do not affect the cutoff or the request bytes.
    const policy = resolveModelContextPolicy(
      params.runtimePrompt.modelName,
      params.runtimePrompt.parameters as Record<string, unknown> | undefined
    );
    const contextWindowTokens = policy?.contextWindowTokens ?? 0;
    const historyTargets = resolveSessionTargets(params.queueMessage);
    // 时间线取在【派发这一刻】:她在 fork 里睡不着(allowed_tools 只有 exec_command + 提交
    // skill),所以这份快照在整个 fork 生命周期内有效。
    const timeGrounding = await this.resolveCompressionTimeGrounding({
      queueMessage: params.queueMessage,
      previousReadCutoffAfterStackIndex,
      now: new Date()
    });
    await this.scheduleCoreMemoryCompressionFork({
      // Fork = clone of the main agent (same iron law as subconscious / image-vision / heartbeat
      // forks): the FULL request we are about to send (byte-identical warm prefix), never a
      // separately-built head-only body. The compression instruction rides as a tail item, and the
      // precise eviction stays code-enforced via the cutoff below.
      baseRequest: params.baseRequest,
      queueMessage: params.queueMessage,
      runtimePrompt: params.runtimePrompt,
      compression: {
        required: true as const,
        contextSessionKey: key,
        readCutoffAfterStackIndex: compressionPoint.readCutoffAfterStackIndex,
        previousReadCutoffAfterStackIndex,
        compressionCoveredEndStackIndex: compressionPoint.compressionCoveredEndStackIndex,
        historyUserId: historyTargets.userId,
        historyGroupId: historyTargets.groupId,
        historyScope: 'global' as const,
        lastContextWindowTokens: contextWindowTokens,
        lastTargetBudgetTokens: contextWindowTokens
          ? Math.max(1, Math.floor(contextWindowTokens * READ_HISTORY_TARGET_RATIO))
          : 0,
        lastHardBudgetTokens: contextWindowTokens
          ? Math.max(1, Math.floor(contextWindowTokens * READ_HISTORY_HARD_RATIO))
          : 0
      },
      contextSessionKey: key,
      compressionReminderItems: [buildCoreMemoryCompressionReminder({
        contextSessionKey: key,
        readCutoffAfterStackIndex: compressionPoint.readCutoffAfterStackIndex,
        pressureSummary: CORE_MEMORY_COMPRESSION_PRESSURE_SUMMARY,
        ...timeGrounding
      })]
    });
  }

  private async scheduleCoreMemoryCompressionFork(params: {
    baseRequest: CanonicalAgentTurnRequest;
    queueMessage: QueueMessageRecord['payload'];
    runtimePrompt: ResolvedAgentRuntimePrompt;
    compression: CoreMemoryCompressionPlan;
    contextSessionKey: string;
    // Forwarded verbatim to runCoreMemoryCompressionFork (see params). Tail
    // compression instruction; baseRequest is the cloned full main-agent request.
    compressionReminderItems?: OpenResponseInputItem[];
    // Manual admin triggers run as a maintenance action while the loop is
    // intentionally stopped; they must not park at the runtime-enabled gate.
    // Auto-overflow forks leave this false so they still respect the pause.
    bypassRuntimeEnabledGate?: boolean;
  }) {
    const key = params.compression.contextSessionKey || params.contextSessionKey;
    // REQ1: compression is now scheduled — clear the real-input debounce counter so
    // it does NOT re-fire on every main turn while the ~1-2min fork runs. Post-
    // compression the next real measurement (lower) repopulates the counter from 0.
    resetCompressionTriggerCounter(key);
    this.persistCompressionTriggerCounter(key);
    const existing = this.coreMemoryCompressionForks.get(key);
    const compression = existing?.compression ?? params.compression;
    const artifact = {
      tool_name: TOOL_NAMES.compressCoreMemory,
      context_session_key: key,
      read_cutoff_after_stack_index: compression.readCutoffAfterStackIndex,
      previous_read_cutoff_after_stack_index: compression.previousReadCutoffAfterStackIndex,
      compression_covered_end_stack_index: compression.compressionCoveredEndStackIndex,
      execution_mode: 'compression_fork_background',
      status: existing ? 'already_running' : 'scheduled'
    };
    if (existing) {
      return artifact;
    }

    const plannedCommitCutoff = await this.resolveCoreMemoryCompressionCommitCutoff(params.compression);
    const cutoffReader = (this.store as RuntimeStore & {
      getSessionReadCutoffState?: RuntimeStore['getSessionReadCutoffState'];
    }).getSessionReadCutoffState;
    if (plannedCommitCutoff !== null && typeof cutoffReader === 'function') {
      try {
        const currentCutoffState = await cutoffReader.call(this.store, key);
        const currentReadCutoffAfterStackIndex = currentCutoffState?.readCutoffAfterStackIndex ?? null;
        if (
          currentReadCutoffAfterStackIndex !== null
          && currentReadCutoffAfterStackIndex >= plannedCommitCutoff
        ) {
          return {
            ...artifact,
            status: 'already_covered',
            read_cutoff_after_stack_index: currentReadCutoffAfterStackIndex,
            planned_read_cutoff_after_stack_index: params.compression.readCutoffAfterStackIndex
          };
        }
      } catch (error) {
        moduleLogger.warn('Failed to check core memory compression cutoff before scheduling fork', {
          traceId: params.queueMessage.traceId,
          runId: params.queueMessage.runId,
          contextSessionKey: key,
          plannedCommitCutoff,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const durableFinder = (this.store as RuntimeStore & {
      findActiveCoreMemoryCompressionForkRun?: RuntimeStore['findActiveCoreMemoryCompressionForkRun'];
    }).findActiveCoreMemoryCompressionForkRun;
    if (
      typeof durableFinder === 'function'
      && typeof params.compression.compressionCoveredEndStackIndex === 'number'
      && Number.isFinite(params.compression.compressionCoveredEndStackIndex)
    ) {
      try {
        const activeFork = await durableFinder.call(this.store, {
          contextSessionKey: key,
          compressionCoveredEndStackIndex: params.compression.compressionCoveredEndStackIndex
        });
        if (activeFork) {
          return {
            ...artifact,
            status: 'already_running_durable',
            persisted_fork_run_id: activeFork.forkRunId ?? null,
            persisted_run_id: activeFork.runId ?? null
          };
        }
      } catch (error) {
        moduleLogger.warn('Failed to check active durable core memory compression fork before scheduling', {
          traceId: params.queueMessage.traceId,
          runId: params.queueMessage.runId,
          contextSessionKey: key,
          compressionCoveredEndStackIndex: params.compression.compressionCoveredEndStackIndex,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const fork = this.runCoreMemoryCompressionFork(params);
    this.coreMemoryCompressionForks.set(key, {
      promise: fork,
      compression: params.compression,
      startedAtMs: Date.now()
    });
    // Latch this compression as pending-apply: suppress any further trigger until the
    // main loop's live cutoff reaches this target (cleared in buildContextBudgetPlan).
    const plannedAppliedCutoff = params.compression.readCutoffAfterStackIndex;
    if (typeof plannedAppliedCutoff === 'number' && Number.isFinite(plannedAppliedCutoff)) {
      this.pendingCompressionAppliedCutoffBySession.set(key, plannedAppliedCutoff);
    }
    void fork.catch((error) => {
      moduleLogger.warn('Background core memory compression fork failed', {
        traceId: params.queueMessage.traceId,
        runId: params.queueMessage.runId,
        contextSessionKey: key,
        error: error instanceof Error ? error.message : String(error)
      });
      // fork failed — it may not have committed; release the latch so a retry can fire.
      this.pendingCompressionAppliedCutoffBySession.delete(key);
    }).finally(() => {
      if (this.coreMemoryCompressionForks.get(key)?.promise === fork) {
        this.coreMemoryCompressionForks.delete(key);
      }
    });
    return artifact;
  }

  private async runCoreMemoryCompressionFork(params: {
    baseRequest: CanonicalAgentTurnRequest;
    queueMessage: QueueMessageRecord['payload'];
    runtimePrompt: ResolvedAgentRuntimePrompt;
    compression: CoreMemoryCompressionPlan;
    contextSessionKey: string;
    // Tail-appended compression instruction. baseRequest is a CLONE of the main
    // agent's full request (byte-identical warm prefix, same as every other fork);
    // the reminder rides as a small cold tail so the fork hits the main loop's cache
    // instead of cold-prefilling a separately-built head-only request.
    compressionReminderItems?: OpenResponseInputItem[];
    bypassRuntimeEnabledGate?: boolean;
  }): Promise<CoreMemoryCompressionCommit> {
    const forkRunId = `core-memory-fork:${params.queueMessage.runId}:${uuidv4().slice(0, 8)}`;
    // Spec B: the fork permits exec_command (to write the diary + run the 近况 commit skill) and
    // read_file (to read today's diary back IN FULL before appending — exec_command `cat` truncates
    // large output via the head+tail envelope, which would break dedup). The model authors the new
    // 近况 and runs the commit skill (no --out); the skill mints a fresh unique filename and prints
    // XIAONI_COMPRESS_WROTE=<path>, which the fork reads back to commit. Widening this
    // execution gate does NOT change the fork's tools/tool_choice (still a byte-clone of the main
    // request), so it is cache-safe. compress_core_memory is no longer a tool anywhere.
    const allowedToolNames = new Set<string>([TOOL_NAMES.execCommand, TOOL_NAMES.readFile]);
    // Fresh-file design: the commit target is whatever unique path the skill reported THIS fork,
    // captured from exec stdout below — never a fixed path. This closes the read-before-write
    // staleness bug where a `date` prep turn let a prior round's leftover 近况 get committed as
    // this round's. Null until the skill actually runs and reports a path.
    let capturedCompressionOutputPath: string | null = null;
    // mtime 时间窗基准:胶囊文件必须晚于本轮 fork 启动(减 60s 时钟宽容)——旧胶囊/
    // 旧文件即使路径合法也冒充不了本轮提交。纯引擎侧运行时校验,不进任何请求字节。
    const forkStartedAtMs = Date.now();
    let forkInput = [
      ...cloneCanonicalAgentTurnRequest(params.baseRequest).input,
      ...(params.compressionReminderItems ?? [])
    ];
    let pendingForkOneShotInputItems: OpenResponseInputItem[] = [];
    let forkToolCallCount = 0;
    let forkNoToolRetryCount = 0;
    let forkNoToolRetryTotal = 0;
    const baseForkMetadata = {
      context_session_key: params.compression.contextSessionKey,
      read_cutoff_after_stack_index: params.compression.readCutoffAfterStackIndex,
      previous_read_cutoff_after_stack_index: params.compression.previousReadCutoffAfterStackIndex,
      compression_covered_end_stack_index: params.compression.compressionCoveredEndStackIndex,
      history_user_id: params.compression.historyUserId,
      history_group_id: params.compression.historyGroupId,
      history_scope: params.compression.historyScope,
      last_context_window_tokens: params.compression.lastContextWindowTokens,
      last_target_budget_tokens: params.compression.lastTargetBudgetTokens,
      last_hard_budget_tokens: params.compression.lastHardBudgetTokens,
      no_main_stack_persist: true,
      no_traffic_persist: true
    };

    await this.recordCoreMemoryCompressionForkRunSafe({
      forkRunId,
      contextSessionKey: params.compression.contextSessionKey,
      status: 'running',
      traceId: params.queueMessage.traceId,
      runId: params.queueMessage.runId,
      readCutoffAfterStackIndex: params.compression.readCutoffAfterStackIndex,
      previousReadCutoffAfterStackIndex: params.compression.previousReadCutoffAfterStackIndex,
      metadata: baseForkMetadata
    });

    await this.store.logTimelineEvent({
      traceId: params.queueMessage.traceId,
      eventType: 'memory',
      eventName: 'core_memory_compression_fork',
      eventPhase: 'start',
      metadata: {
        fork_run_id: forkRunId,
        context_session_key: params.compression.contextSessionKey,
        read_cutoff_after_stack_index: params.compression.readCutoffAfterStackIndex,
        no_main_stack_persist: true
      }
    });

    try {
      for (let forkTurn = 1; ; forkTurn += 1) {
        const forkRequest = buildCoreMemoryCompressionForkRequest(params.baseRequest, forkTurn);
        const forkRequestInput = pendingForkOneShotInputItems.length > 0
          ? [...forkInput, ...pendingForkOneShotInputItems]
          : forkInput;
        pendingForkOneShotInputItems = [];
        forkRequest.input = normalizeResponseInputItems(forkRequestInput);
        if (!params.bypassRuntimeEnabledGate) {
          await this.waitForRuntimeEnabledBeforeModelSlice(params.queueMessage, params.queueMessage.runId);
        }
        const modelResult = await this.executeCoreMemoryCompressionForkTurn(
          forkRequest,
          params.queueMessage,
          params.runtimePrompt,
          forkTurn
        );
        const forkSliceId = modelResult.llm_request_slice_id
          || modelResult.llm_call_id
          || `core-memory-fork-slice:${forkRunId}:${forkTurn}`;
        const inputRows = await this.appendCoreMemoryCompressionForkItemsSafe({
          forkRunId,
          traceId: params.queueMessage.traceId,
          runId: params.queueMessage.runId,
          sourceType: 'core_memory_compression_fork_slices',
          sourceId: forkSliceId,
          llmRequestSliceId: forkSliceId,
          items: [buildForkInputStackItem({
            forkRunId,
            sliceId: forkSliceId,
            forkTurn,
            source: 'core_memory_compression_fork_input',
            inputItems: forkRequest.input
          }) as Record<string, unknown>]
        });
        const outputItems = extractCanonicalResponseOutputItems(modelResult);
        const outputRows = await this.appendCoreMemoryCompressionForkItemsSafe({
          forkRunId,
          traceId: params.queueMessage.traceId,
          runId: params.queueMessage.runId,
          sourceType: 'core_memory_compression_fork_slices',
          sourceId: forkSliceId,
          llmRequestSliceId: forkSliceId,
          items: buildModelOutputStackItems(outputItems, forkSliceId) as Array<Record<string, unknown>>
        });
        const outputItemIndexes = outputRows
          .map((row) => Number((row as { itemIndex?: unknown }).itemIndex))
          .filter((value) => Number.isFinite(value));
        const inputItemIndexes = inputRows
          .map((row) => Number((row as { itemIndex?: unknown }).itemIndex))
          .filter((value) => Number.isFinite(value));
        const inputStackItemIds = inputRows
          .map((row) => (row as { id?: unknown }).id)
          .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number');
        const toolCallForkItemIdByCallId = new Map<string, string | number>();
        for (const row of outputRows) {
          const toolCallId = typeof (row as { toolCallId?: unknown }).toolCallId === 'string'
            ? (row as { toolCallId: string }).toolCallId
            : null;
          const itemKind = typeof (row as { itemKind?: unknown }).itemKind === 'string'
            ? (row as { itemKind: string }).itemKind
            : null;
          const id = (row as { id?: unknown }).id;
          if (toolCallId && itemKind === 'function_call' && (typeof id === 'string' || typeof id === 'number')) {
            toolCallForkItemIdByCallId.set(toolCallId, id);
          }
        }
        await this.recordCoreMemoryCompressionForkSliceSafe({
          forkRunId,
          sliceId: forkSliceId,
          llmCallId: modelResult.llm_call_id || null,
          inputStartIndex: inputItemIndexes.length > 0 ? Math.min(...inputItemIndexes) : null,
          inputEndIndex: inputItemIndexes.length > 0 ? Math.max(...inputItemIndexes) : null,
          inputStackItemIds,
          outputStartIndex: outputItemIndexes.length > 0 ? Math.min(...outputItemIndexes) : null,
          outputEndIndex: outputItemIndexes.length > 0 ? Math.max(...outputItemIndexes) : null,
          canonicalRequest: (modelResult.canonical_request || forkRequest) as Record<string, unknown>,
          wireRequest: modelResult.wire_request || null,
          canonicalResponse: modelResult.canonical_response || null,
          wireResponse: modelResult.wire_response || null,
          rawResponse: modelResult.raw_response || null,
          outputItems,
          status: modelResult.success ? 'completed' : 'failed',
          tokenUsage: buildProviderTokenUsage(modelResult),
          traceId: params.queueMessage.traceId,
          runId: params.queueMessage.runId,
          agentTurn: forkTurn,
          modelName: modelResult.model || params.runtimePrompt.modelName,
          modelProvider: modelResult.provider || null,
          requestFormatVersion: modelResult.request_format_version || null,
          wireProviderFormat: modelResult.wire_provider_format || null,
          processingTimeMs: readOptionalNumber(modelResult.performance?.processing_time_ms),
          metadata: {
            ...baseForkMetadata,
            ...buildProviderWireMetadata(modelResult),
            fork_run_id: forkRunId,
            fork_turn: forkTurn,
            execution_mode: 'compression_fork'
          }
        });

        const actionPlan = this.responseActionRouter.route(modelResult.canonical_response);
        if (actionPlan.hasToolCall) {
          forkNoToolRetryCount = 0;
          for (const replayItem of actionPlan.replayableOutputs) {
            forkInput.push(replayItem.inputItem);
            if (!isReplayableToolCall(replayItem)) {
              continue;
            }

            const toolCall = replayItem.toolCall;
            forkToolCallCount += 1;
            const forkToolExecutionId = `core-memory-fork-tool:${forkRunId}:${toolCall.callId}`;
            await this.recordCoreMemoryCompressionForkToolExecutionSafe({
              forkRunId,
              executionId: forkToolExecutionId,
              llmRequestSliceId: forkSliceId,
              llmCallId: modelResult.llm_call_id || null,
              toolCallId: toolCall.callId,
              toolName: toolCall.name,
              arguments: toolCall.args,
              rawArguments: toolCall.rawArguments,
              status: 'running',
              sideEffect: isToolCallSideEffecting(toolCall),
              traceId: params.queueMessage.traceId,
              runId: params.queueMessage.runId,
              agentTurn: forkTurn,
              stackCallItemId: toolCallForkItemIdByCallId.get(toolCall.callId) || null,
              metadata: {
                ...baseForkMetadata,
                fork_turn: forkTurn,
                model_name: params.runtimePrompt.modelName,
                session_key: params.queueMessage.sessionKey,
                chat_type: params.queueMessage.chatType,
                peer_name: params.queueMessage.peerName || null
              }
            });

            try {
              // Spec B: the compression fork only permits exec_command (the model writes the new
              // 近况 via the xiaoni-memory-compress skill (skill mints the file), then final_answers).
              // Any other tool is rejected here (controlled, not a throw) and the reason fed back, so
              // the summarizer retries toward the file write instead of crashing the fork run.
              const rawToolResult = allowedToolNames.has(toolCall.name)
                ? await this.executeTool(toolCall, params.queueMessage, {
                    currentCanonicalRequest: forkRequest
                  })
                : buildToolRejectedResult(toolCall, renderPromptSnippet('fork_tool_rejected_output.md', {
                    TOOL_NAME: toolCall.name,
                    ALLOWED_TOOLS: Array.from(allowedToolNames).join('、')
                  }));

              // Capture the path the commit skill reported this fork (XIAONI_COMPRESS_WROTE=<path>
              // on stdout). This is the ONLY channel by which the engine learns which fresh file to
              // read back — the model never carries the path. A prep turn like `date +%F` reports no
              // path, so it can never trigger a premature commit against stale leftover content.
              const reportedCompressionPath = extractCompressionWrittenPath(rawToolResult);
              if (reportedCompressionPath) {
                if (isTrustedCompressionCapsulePath(reportedCompressionPath)) {
                  capturedCompressionOutputPath = reportedCompressionPath;
                } else {
                  // 行首撞出的暗号但路径不在白名单(echo/cat 到含该行的文件):拒认,留痕。
                  moduleLogger.warn('compression marker path rejected (outside capsule allowlist)', {
                    reportedPath: reportedCompressionPath
                  });
                }
              }

              const runtimeEnergyState = await this.getCurrentRuntimeEnergyState(params.queueMessage);
              const continuation = applyToolResultToLoopInput(toolCall, rawToolResult, {
                loopInput: forkInput,
                speakingToolName: params.queueMessage.chatType === 'direct' ? TOOL_NAMES.privateReply : TOOL_NAMES.groupReply,
                hasVisibleReply: false,
                runtimeEnergyState
              });
              if (continuation.forcedVisibleReply) {
                throw new Error('core memory compression fork must not force visible delivery');
              }
              const toolOutputRows = await this.appendCoreMemoryCompressionForkItemsSafe({
                forkRunId,
                traceId: params.queueMessage.traceId,
                runId: params.queueMessage.runId,
                sourceType: 'core_memory_compression_fork_tool_executions',
                sourceId: forkToolExecutionId,
                llmRequestSliceId: forkSliceId,
                items: buildToolResultStackItems({
                  toolCall,
                  toolResult: rawToolResult,
                  continuationItems: continuation.inputItems,
                  llmRequestSliceId: forkSliceId
                }) as Array<Record<string, unknown>>
              });
              await this.completeCoreMemoryCompressionForkToolExecutionSafe({
                executionId: forkToolExecutionId,
                status: 'completed',
                result: rawToolResult,
                stackOutputItemId: (toolOutputRows[0] as { id?: string | number } | undefined)?.id || null
              });
              forkInput.push(...continuation.inputItems);
              pendingForkOneShotInputItems.push(...continuation.oneShotInputItems);
            } catch (error) {
              const toolResult = buildToolErrorResult(toolCall, error);
              const message = String(toolResult.error_message || toolResult.error || 'Tool execution failed');
              const runtimeEnergyState = await this.getCurrentRuntimeEnergyState(params.queueMessage);
              const continuation = applyToolResultToLoopInput(toolCall, toolResult, {
                loopInput: forkInput,
                speakingToolName: params.queueMessage.chatType === 'direct' ? TOOL_NAMES.privateReply : TOOL_NAMES.groupReply,
                hasVisibleReply: false,
                runtimeEnergyState
              });
              const toolOutputRows = await this.appendCoreMemoryCompressionForkItemsSafe({
                forkRunId,
                traceId: params.queueMessage.traceId,
                runId: params.queueMessage.runId,
                sourceType: 'core_memory_compression_fork_tool_executions',
                sourceId: forkToolExecutionId,
                llmRequestSliceId: forkSliceId,
                items: buildToolResultStackItems({
                  toolCall,
                  toolResult,
                  continuationItems: continuation.inputItems,
                  llmRequestSliceId: forkSliceId
                }) as Array<Record<string, unknown>>
              });
              await this.completeCoreMemoryCompressionForkToolExecutionSafe({
                executionId: forkToolExecutionId,
                status: 'failed',
                result: toolResult,
                errorMessage: message,
                stackOutputItemId: (toolOutputRows[0] as { id?: string | number } | undefined)?.id || null
              });
              forkInput.push(...continuation.inputItems);
              pendingForkOneShotInputItems.push(...continuation.oneShotInputItems);
              continue;
            }
          }
        } else {
          // No tool call this turn (final_answer / plain text). Keep the fork history complete;
          // the file check below decides whether the 近况 was actually written.
          for (const replayItem of actionPlan.replayableOutputs) {
            forkInput.push(replayItem.inputItem);
          }
        }

        // ── Commit trigger (Spec B, fresh-file): did the skill write + report a path THIS fork? ──
        // We read back ONLY the path the skill reported this fork (capturedCompressionOutputPath).
        // Until the skill runs, the path is null → no read, no premature commit. This is what makes
        // a leftover file from a prior round un-committable: the engine never reads a path it wasn't
        // just handed. Same commitCoreMemoryCompression path as before, so the "one cold prefill
        // installs <xiaoni_status> exactly once" invariant is unchanged.
        const compressionFileCheck = capturedCompressionOutputPath
          ? await this.readCoreMemoryCompressionFile(capturedCompressionOutputPath, params.queueMessage, forkStartedAtMs)
          : { text: null, message: '还没运行记忆整理脚本（未捕获到写入路径）' };
        if (compressionFileCheck.text) {
          const syntheticToolCall = {
            name: TOOL_NAMES.compressCoreMemory,
            callId: `core-memory-compress-file:${forkRunId}:${forkTurn}`,
            args: { text: compressionFileCheck.text },
            rawArguments: JSON.stringify({ text: compressionFileCheck.text })
          } as unknown as AgentToolCall;
          const commit = await this.commitCoreMemoryCompression({
            rawToolResult: {
              text: compressionFileCheck.text,
              compressed: true,
              outcome: 'core_memory_compressed',
              source: 'xiaoni_memory_compress_skill',
              output_path: capturedCompressionOutputPath
            },
            toolCall: syntheticToolCall,
            compression: params.compression,
            contextSessionKey: params.contextSessionKey,
            sourceResponseId: modelResult.llm_call_id || null,
            metadata: {
              trace_id: params.queueMessage.traceId,
              execution_mode: 'compression_fork',
              fork_run_id: forkRunId,
              fork_turn_count: forkTurn,
              fork_tool_call_count: forkToolCallCount,
              fork_no_tool_retry_count: forkNoToolRetryTotal,
              compression_output_path: capturedCompressionOutputPath,
              no_main_stack_persist: true,
              no_traffic_persist: true
            }
          });
          await this.completeCoreMemoryCompressionForkRunSafe({
            forkRunId,
            status: 'completed',
            summaryText: commit.text,
            artifact: commit.artifact,
            metadata: {
              ...baseForkMetadata,
              fork_turn_count: forkTurn,
              fork_tool_call_count: forkToolCallCount,
              fork_no_tool_retry_count: forkNoToolRetryTotal
            }
          });
          await this.store.logTimelineEvent({
            traceId: params.queueMessage.traceId,
            eventType: 'memory',
            eventName: 'core_memory_compression_fork',
            eventPhase: 'end',
            metadata: {
              status: 'completed',
              fork_run_id: forkRunId,
              context_session_key: params.compression.contextSessionKey,
              read_cutoff_after_stack_index: params.compression.readCutoffAfterStackIndex,
              fork_turn_count: forkTurn,
              fork_tool_call_count: forkToolCallCount,
              fork_no_tool_retry_count: forkNoToolRetryTotal
            }
          });
          return commit;
        }

        // Not committed yet. Advance the no-tool streak counter (metadata + tone only). There is NO
        // early throw: the forced zone (>= FORCE_TURNS) and the hard-cap fallback are the only
        // terminals, so a stuck fork always ends by advancing the cutoff, never by failing outright.
        if (!actionPlan.hasToolCall) {
          forkNoToolRetryCount += 1;
          forkNoToolRetryTotal += 1;
        }
        if (forkTurn >= CORE_MEMORY_COMPRESSION_FORK_HARD_CAP_TURNS) {
          // Absolute last resort: she ignored the forced "use the skill NOW" demand across the whole
          // grace window (FORCE_TURNS..HARD_CAP). Commit a deterministic minimal seam summary through
          // the SAME commit path so the cutoff always advances (context can't grow → 413). Anything
          // real she wrote is on disk in today's diary. See CORE_MEMORY_COMPRESSION_FALLBACK_SUMMARY.
          if (forkToolCallCount > 0 && !capturedCompressionOutputPath) {
            // Drift signal: she ran exec_command(s) but never reported a path — likely wrote the 近况
            // without the commit skill (raw redirect) or chained output that pushed the marker out of
            // the stdout tail. Surface it so silent memory-quality loss doesn't go unnoticed.
            moduleLogger.warn('core memory compression fork hit the hard-cap fallback without a skill-reported path', {
              traceId: params.queueMessage.traceId,
              forkRunId,
              forkToolCallCount,
              forkTurn,
              contextSessionKey: params.compression.contextSessionKey
            });
          }
          const fallbackToolCall = {
            name: TOOL_NAMES.compressCoreMemory,
            callId: `core-memory-compress-fallback:${forkRunId}:${forkTurn}`,
            args: { text: CORE_MEMORY_COMPRESSION_FALLBACK_SUMMARY },
            rawArguments: JSON.stringify({ text: CORE_MEMORY_COMPRESSION_FALLBACK_SUMMARY })
          } as unknown as AgentToolCall;
          const fallbackCommit = await this.commitCoreMemoryCompression({
            rawToolResult: {
              text: CORE_MEMORY_COMPRESSION_FALLBACK_SUMMARY,
              compressed: true,
              outcome: 'core_memory_compressed',
              source: 'compression_fork_turn_budget_fallback',
              output_path: capturedCompressionOutputPath
            },
            toolCall: fallbackToolCall,
            compression: params.compression,
            contextSessionKey: params.contextSessionKey,
            sourceResponseId: modelResult.llm_call_id || null,
            metadata: {
              trace_id: params.queueMessage.traceId,
              execution_mode: 'compression_fork',
              fork_run_id: forkRunId,
              fork_turn_count: forkTurn,
              fork_tool_call_count: forkToolCallCount,
              fork_no_tool_retry_count: forkNoToolRetryTotal,
              compression_output_path: capturedCompressionOutputPath,
              compression_turn_budget_fallback: true,
              no_main_stack_persist: true,
              no_traffic_persist: true
            }
          });
          await this.completeCoreMemoryCompressionForkRunSafe({
            forkRunId,
            status: 'completed',
            summaryText: fallbackCommit.text,
            artifact: fallbackCommit.artifact,
            metadata: {
              ...baseForkMetadata,
              fork_turn_count: forkTurn,
              fork_tool_call_count: forkToolCallCount,
              fork_no_tool_retry_count: forkNoToolRetryTotal,
              compression_turn_budget_fallback: true
            }
          });
          await this.store.logTimelineEvent({
            traceId: params.queueMessage.traceId,
            eventType: 'memory',
            eventName: 'core_memory_compression_fork',
            eventPhase: 'end',
            metadata: {
              status: 'completed_turn_budget_fallback',
              fork_run_id: forkRunId,
              context_session_key: params.compression.contextSessionKey,
              read_cutoff_after_stack_index: params.compression.readCutoffAfterStackIndex,
              fork_turn_count: forkTurn,
              fork_tool_call_count: forkToolCallCount,
              fork_no_tool_retry_count: forkNoToolRetryTotal
            }
          });
          return fallbackCommit;
        }
        // Escalating tone, so she's never nagged while she's working:
        //   ① < FORCE_TURNS, productive tool turn (exec_command / read_file) → say NOTHING. Let the
        //      tool result stand and let her keep going on her own flow (that IS the memory work:
        //      reading + appending today's diary, topic files, etc.).
        //   ② < FORCE_TURNS, text-only turn (no tool call → she's winding down) → a SOFT self-check
        //      only, so she catches anything she meant to record; do NOT push the skill here.
        //   ③ >= FORCE_TURNS → she's out of organizing budget: FORCE her to stop everything and use
        //      the commit skill (stdin, no path) to write the xiaoni_status now — every turn, until
        //      she does (or the hard-cap fallback above fires as an absolute last resort).
        if (forkTurn >= CORE_MEMORY_COMPRESSION_FORK_FORCE_TURNS) {
          forkInput.push(buildCoreMemoryCompressionForkForcedReminder({ forkTurn }));
        } else if (!actionPlan.hasToolCall) {
          forkInput.push(buildCoreMemoryCompressionForkGapCheckReminder());
        }
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.completeCoreMemoryCompressionForkRunSafe({
        forkRunId,
        status: 'failed',
        errorMessage: message,
        metadata: {
          ...baseForkMetadata,
          fork_tool_call_count: forkToolCallCount,
          fork_no_tool_retry_count: forkNoToolRetryTotal
        }
      });
      await this.store.logTimelineEvent({
        traceId: params.queueMessage.traceId,
        eventType: 'memory',
        eventName: 'core_memory_compression_fork',
        eventPhase: 'end',
        metadata: {
          status: 'failed',
          fork_run_id: forkRunId,
          error_message: message,
          fork_tool_call_count: forkToolCallCount,
          fork_no_tool_retry_count: forkNoToolRetryTotal
        }
      });
      throw error;
    }
  }

  private async executeCoreMemoryCompressionForkTurn(
    canonicalRequest: CanonicalAgentTurnRequest,
    queueMessage: QueueMessageRecord['payload'],
    runtimePrompt: ResolvedAgentRuntimePrompt,
    forkTurn: number
  ) {
    const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/llm/debug`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [NO_TRAFFIC_PERSIST_HEADER]: '1'
      },
      body: JSON.stringify({
        trace_id: queueMessage.traceId,
        run_id: queueMessage.runId,
        agent_turn: forkTurn,
        agent_type: 'chat_bot',
        prompt_name: runtimePrompt.promptName,
        executionMode: 'core_memory_compression_fork_no_persist',
        model: runtimePrompt.modelName,
        parameters: buildMainAgentParameters(runtimePrompt.parameters as Record<string, unknown> | undefined),
        canonicalRequest
      })
    });

    const payload = await response.json() as ProviderAgentResponse;
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || `Provider compression fork execute failed with ${response.status}`);
    }

    return payload;
  }

  private async executeSubconsciousAgentForkTurn(
    canonicalRequest: CanonicalAgentTurnRequest,
    queueMessage: QueueMessageRecord['payload'],
    runtimePrompt: ResolvedAgentRuntimePrompt,
    forkTurn: number
  ) {
    // Mirror executeAgentTurn's transient-retry: the self-driven fork is the autonomous
    // self-continuation engine (it fires on every idle settle, then enqueues the next
    // direction back into the main loop). A bare single fetch meant one transient blip
    // (e.g. "Client network socket disconnected before secure TLS") killed the whole fork
    // with no retry, so she never got her next nudge and sat idle until the user spoke
    // again. Retry transient provider/network failures exactly like the main agent does.
    const body = JSON.stringify({
      trace_id: queueMessage.traceId,
      run_id: queueMessage.runId,
      agent_turn: forkTurn,
      agent_type: 'subconscious_agent',
      prompt_name: `${runtimePrompt.promptName}:subconscious_agent`,
      executionMode: 'subconscious_agent_fork_no_persist',
      model: runtimePrompt.modelName,
      parameters: buildMainAgentParameters(runtimePrompt.parameters as Record<string, unknown> | undefined),
      canonicalRequest
    });
    const maxAttempts = Math.max(1, agentConfig.providerExecutionRetryAttempts || 1);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/llm/debug`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [NO_TRAFFIC_PERSIST_HEADER]: '1'
          },
          body
        });

        const payload = await response.json() as ProviderAgentResponse;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || `Provider subconscious fork execute failed with ${response.status}`);
        }

        return payload;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !isTransientProviderExecutionError(error)) {
          throw error;
        }
        const retryDelayMs = computeProviderExecutionRetryDelayMs(attempt);
        moduleLogger.warn('Retrying transient subconscious agent fork execute failure', {
          traceId: queueMessage.traceId,
          runId: queueMessage.runId,
          forkTurn,
          attempt,
          maxAttempts,
          retryDelayMs,
          error: error instanceof Error ? error.message : String(error)
        });
        if (retryDelayMs > 0) {
          await sleep(retryDelayMs);
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Provider subconscious fork execute failed'));
  }

  private async executeCacheHeartbeatTurn(
    canonicalRequest: CanonicalAgentTurnRequest,
    queueMessage: QueueMessageRecord['payload'],
    runtimePrompt: ResolvedAgentRuntimePrompt
  ) {
    const timeoutMs = Math.max(1000, Number(agentConfig.cacheHeartbeatTimeoutMs) || 10_000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    let response: Response;
    try {
      response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/llm/debug`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [NO_TRAFFIC_PERSIST_HEADER]: '1'
        },
        signal: controller.signal,
        body: JSON.stringify({
          trace_id: queueMessage.traceId,
          run_id: queueMessage.runId,
          agent_turn: 0,
          agent_type: 'chat_bot',
          prompt_name: runtimePrompt.promptName,
          executionMode: CACHE_HEARTBEAT_EXECUTION_MODE,
          model: runtimePrompt.modelName,
          parameters: buildMainAgentParameters(runtimePrompt.parameters as Record<string, unknown> | undefined),
          canonicalRequest
        })
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Provider cache heartbeat timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const payload = await response.json() as ProviderAgentResponse;
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || `Provider cache heartbeat execute failed with ${response.status}`);
    }

    return payload;
  }

  // 心理评估 fork 的单次分发(同步阻塞，带超时 → 超时即 fail-closed EVICT)。镜像 executeCacheHeartbeatTurn：
  // 打 /api/internal/llm/debug + no-persist header + AbortController 超时。executionMode 独立标识。
  private async executePsychAssessmentForkTurn(
    canonicalRequest: CanonicalAgentTurnRequest,
    traceId: string,
    runId: string,
    runtimePrompt: ResolvedAgentRuntimePrompt
  ) {
    const timeoutMs = 30_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    let response: Response;
    try {
      response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/llm/debug`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [NO_TRAFFIC_PERSIST_HEADER]: '1'
        },
        signal: controller.signal,
        body: JSON.stringify({
          trace_id: traceId,
          run_id: runId,
          agent_turn: 0,
          agent_type: 'chat_bot',
          prompt_name: runtimePrompt.promptName,
          executionMode: 'psych_assessment_no_persist',
          model: runtimePrompt.modelName,
          parameters: buildMainAgentParameters(runtimePrompt.parameters as Record<string, unknown> | undefined),
          canonicalRequest
        })
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Provider psych assessment timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const payload = await response.json() as ProviderAgentResponse;
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || `Provider psych assessment execute failed with ${response.status}`);
    }

    return payload;
  }

  // Step3 门控编排:构建心理评估 fork(主请求克隆 + 尾部追加被判文本 + 判定指令) → 同步分发 → 解析判定。
  // 返回是否【准入】这一 turn 的 assistant 文本进入下一次上下文。任何失败/超时/无法解析 → false(fail-closed)。
  private async runPsychAssessmentGate(params: {
    baseRequest: CanonicalAgentTurnRequest;
    assistantTextItems: OpenResponseInputItem[];
    traceId: string;
    runId: string;
    agentTurn: number;
    runtimePrompt: ResolvedAgentRuntimePrompt;
  }): Promise<boolean> {
    try {
      const forkRequest = buildPsychAssessmentForkRequest(params.baseRequest, params.assistantTextItems);
      const modelResult = await this.executePsychAssessmentForkTurn(
        forkRequest,
        params.traceId,
        params.runId,
        params.runtimePrompt
      );
      const outputItems = extractCanonicalResponseOutputItems(modelResult);
      const verdict = parsePsychAssessmentVerdict(outputItems);
      // 可观测/铁律验证:记录 fork 的 token usage(含 cache_read)，供相邻 slice 对账——心理评估 fork 骑主
      // 热前缀，其 cache_read 应与本 turn 主请求同量级；若塌到裸 system+tools 即前缀分叉的信号。
      moduleLogger.info('psych_assessment_gate', {
        traceId: params.traceId,
        runId: params.runId,
        verdict: verdict === null ? 'unparsed_fail_closed' : (verdict ? 'keep' : 'evict'),
        tokenUsage: buildProviderTokenUsage(modelResult)
      });
      // 专用单表 slice 记录:单次分发的心理评估 fork 骑主热前缀,把这次评估的 canonical/wire
      // 请求+响应、token usage(含 cache_read)、判定结果落到 psych_assessment_fork_slices,
      // 供管理端像其他 fork 一样查看+对账。fork_run_id 由调用方合成(本 fork 无 run/item/tool 生命周期)。
      const forkRunId = `psych-${params.traceId}-${params.runId}-t${params.agentTurn}`;
      const sliceId = modelResult.llm_request_slice_id
        || modelResult.llm_call_id
        || `psych-slice:${params.traceId}:${params.runId}:t${params.agentTurn}`;
      await this.recordPsychAssessmentForkSliceSafe({
        forkRunId,
        sliceId,
        llmCallId: modelResult.llm_call_id || null,
        canonicalRequest: (modelResult.canonical_request || forkRequest) as unknown as Record<string, unknown>,
        wireRequest: modelResult.wire_request || null,
        canonicalResponse: modelResult.canonical_response || null,
        wireResponse: modelResult.wire_response || null,
        rawResponse: modelResult.raw_response || null,
        outputItems: outputItems as Array<Record<string, unknown>>,
        status: modelResult.success ? 'completed' : 'failed',
        tokenUsage: buildProviderTokenUsage(modelResult),
        traceId: params.traceId,
        runId: params.runId,
        agentTurn: params.agentTurn,
        modelName: modelResult.model || params.runtimePrompt.modelName,
        modelProvider: modelResult.provider || null,
        requestFormatVersion: modelResult.request_format_version || null,
        wireProviderFormat: modelResult.wire_provider_format || null,
        processingTimeMs: readOptionalNumber(modelResult.performance?.processing_time_ms),
        metadata: {
          ...buildProviderWireMetadata(modelResult),
          fork_run_id: forkRunId,
          execution_mode: 'psych_assessment_fork',
          verdict: verdict === null ? 'unparsed_fail_closed' : (verdict ? 'keep' : 'evict')
        }
      });
      return verdict === true;
    } catch (error) {
      moduleLogger.warn('psych_assessment_gate failed → fail-closed (evict)', {
        traceId: params.traceId,
        runId: params.runId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  private async executeAgentTurn(
    canonicalRequest: CanonicalAgentTurnRequest,
    queueMessage: QueueMessageRecord['payload'],
    traceId: string,
    turn: number,
    runtimePrompt: ResolvedAgentRuntimePrompt,
    sliceContext: {
      runId: string;
      inputStartIndex?: number | null;
      inputEndIndex?: number | null;
      inputStackItemIds?: Array<string | number>;
    } = { runId: traceId, inputStartIndex: null, inputEndIndex: null }
  ) {
    const body = JSON.stringify({
      trace_id: traceId,
      run_id: sliceContext.runId,
      agent_turn: turn,
      agent_type: 'chat_bot',
      prompt_name: runtimePrompt.promptName,
      model: runtimePrompt.modelName,
      parameters: buildMainAgentParameters(runtimePrompt.parameters as Record<string, unknown> | undefined),
      input_start_index: sliceContext.inputStartIndex ?? null,
      input_end_index: sliceContext.inputEndIndex ?? null,
      input_stack_item_ids: sliceContext.inputStackItemIds || [],
      canonicalRequest
    });
    const maxAttempts = Math.max(1, agentConfig.providerExecutionRetryAttempts || 1);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/agent/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body
        });

        const payload = await response.json() as ProviderAgentResponse;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || `Provider agent execute failed with ${response.status}`);
        }

        return payload;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !isTransientProviderExecutionError(error)) {
          throw error;
        }
        const retryDelayMs = computeProviderExecutionRetryDelayMs(attempt);
        moduleLogger.warn('Retrying transient provider agent execute failure', {
          traceId,
          runId: sliceContext.runId,
          turn,
          attempt,
          maxAttempts,
          retryDelayMs,
          error: error instanceof Error ? error.message : String(error)
        });
        if (retryDelayMs > 0) {
          await sleep(retryDelayMs);
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Provider agent execute failed'));
  }

  private async executeTool(
    toolCall: AgentToolCall,
    queueMessage: QueueMessageRecord['payload'],
    context: ToolExecutionContext = {}
  ): Promise<Record<string, unknown>> {
    switch (toolCall.name) {
      case TOOL_NAMES.privateReply:
        return this.sendMessage('private', toolCall.args, queueMessage);
      case TOOL_NAMES.groupReply:
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
        return this.executeCommand(toolCall.args, toolCall, queueMessage);
      }
      case TOOL_NAMES.readFile: {
        return this.executeReadFile(toolCall.args);
      }
      case TOOL_NAMES.webSearch: {
        return this.executeWebSearch(toolCall, queueMessage);
      }
      case TOOL_NAMES.computerUse: {
        return this.executeComputerAction(toolCall);
      }
      case TOOL_NAMES.inspectImage: {
        return this.inspectImagePlaceholder(toolCall, queueMessage, context);
      }
      case TOOL_NAMES.imageTask: {
        return this.requestImageTask(toolCall.args, queueMessage, context);
      }
      case TOOL_NAMES.recoverEnergy: {
        const energyState = await this.getCurrentRuntimeEnergyState(queueMessage);
        const now = new Date();
        const effectiveEnergyPolicy = await this.resolveEffectiveEnergyPolicy();
        const policySnapshot = createRecoveryPolicySnapshot(now, effectiveEnergyPolicy.policy);
        const sessionPolicy = recoverySessionPolicyFromSnapshot(policySnapshot)!;
        const gate = energyState
          ? shouldAcceptVoluntaryRecovery({
              energy: energyState.energy,
              maxEnergy: energyState.maxEnergy,
              lastWakeAt: energyState.lastWakeAt ?? null,
              now,
              policy: sessionPolicy.policy
            })
          : null;
        if (energyState && gate && !gate.accepted) {
          const reason = '一点困意都没有。';
          return {
            recovered: false,
            rest_rejected: true,
            reason,
            energy: energyState.energy,
            max_energy: energyState.maxEnergy,
            pressure: gate.pressure,
            required_pressure: gate.requiredPressure,
            energy_cost: RUNTIME_TOOL_COSTS[TOOL_NAMES.recoverEnergy],
            system_reminder: renderRecoverEnergyRejectedReminder({
              reason,
              lastWakeAt: energyState.lastWakeAt ?? null,
              now
            }),
            xiaoni_os: typeof toolCall.args.xiaoni_os === 'string' && toolCall.args.xiaoni_os.trim()
              ? toolCall.args.xiaoni_os.trim()
              : null
          };
        }
        const reason = typeof toolCall.args.reason === 'string' && toolCall.args.reason.trim()
          ? toolCall.args.reason.trim()
          : null;
        const clockMinutes = normalizeRecoverEnergyClock(toolCall.args.clock);
        const startEnergy = energyState?.energy ?? 0;
        const maxEnergy = energyState?.maxEnergy ?? RUNTIME_MAX_ENERGY;
        const startedAt = now;
        const naturalWakeAt = estimateNaturalWakeAt({
          startEnergy,
          maxEnergy,
          startedAt,
          policy: sessionPolicy.policy
        });
        const hardWakeAt = estimateSessionWakeAt(startedAt, sessionPolicy);
        return {
          recovered: false,
          recovery_session_requested: true,
          rest_rejected: false,
          reason,
          clock_minutes: clockMinutes,
          clock_due_at: clockMinutes ? new Date(startedAt.getTime() + (clockMinutes * 60 * 1000)).toISOString() : null,
          started_at: startedAt.toISOString(),
          planned_natural_wake_at: naturalWakeAt.toISOString(),
          hard_wake_at: hardWakeAt.toISOString(),
          full_recovery_minutes: sessionPolicy.fullRecoveryMinutes,
          session_max_recovery_minutes: sessionPolicy.sessionMaxRecoveryMinutes,
          session_cap_wake_cause: sessionPolicy.sessionCapWakeCause,
          recovery_policy_snapshot: policySnapshot,
          energy_before: startEnergy,
          energy_start: startEnergy,
          energy: startEnergy,
          max_energy: maxEnergy,
          pressure: gate?.pressure ?? (1 - (startEnergy / Math.max(0.001, maxEnergy))),
          required_pressure: gate?.requiredPressure ?? null,
          energy_cost: RUNTIME_TOOL_COSTS[TOOL_NAMES.recoverEnergy],
          xiaoni_os: typeof toolCall.args.xiaoni_os === 'string' && toolCall.args.xiaoni_os.trim()
            ? toolCall.args.xiaoni_os.trim()
            : null
        };
      }
      // Spec B: compress_core_memory 没有 executeTool 分支。压缩由后台 fork 写文件、引擎读回后直接
      // 调 commitCoreMemoryCompression 提交(合成 toolCall,不走这里)。模型幻觉出这个名字时,故意
      // 落到下面的 default 抛错,避免任何路径把它当成可执行工具而重写 <xiaoni_status>。
      default:
        throw new Error(`Unsupported tool: ${toolCall.name}`);
    }
  }

  // 压缩引导 prompt 的时间线三件套:窗口起点(上一次 read cutoff 那条 stack item 的落库时刻)、
  // 窗口内的真实睡眠段、上次醒来时刻。
  //
  // 全程 best-effort:压缩在关键路径上(拦一次 = cutoff 不前进 → 上下文无界 → 413),任何一项
  // 读失败都只让 renderSleepTimelineBlock 退回更弱的表述(有 lastWakeAt 就还是单句锚点),
  // 绝不抛、绝不挡 fork。
  private async resolveCompressionTimeGrounding(input: {
    queueMessage: QueueMessageRecord['payload'];
    previousReadCutoffAfterStackIndex: number | null;
    now: Date;
  }): Promise<{ lastWakeAt: string | null; windowStartedAt: string | null; sleeps: SleepSegment[] }> {
    const lastWakeAt = (await this.getCurrentRuntimeEnergyState(input.queueMessage).catch(() => null))
      ?.lastWakeAt ?? null;
    const stackTimeReader = (this.store as RuntimeStore & {
      getAgentStackItemTimeByIndex?: RuntimeStore['getAgentStackItemTimeByIndex'];
    }).getAgentStackItemTimeByIndex;
    const windowStartedAt = input.previousReadCutoffAfterStackIndex !== null
      && typeof stackTimeReader === 'function'
      ? await stackTimeReader.call(this.store, input.previousReadCutoffAfterStackIndex).catch(() => null)
      : null;
    const sleepReader = (this.store as RuntimeStore & {
      listXiaoniSleepSegmentsSince?: RuntimeStore['listXiaoniSleepSegmentsSince'];
    }).listXiaoniSleepSegmentsSince;
    const sleeps = windowStartedAt && typeof sleepReader === 'function'
      ? await sleepReader.call(this.store, new Date(windowStartedAt), input.now).catch(() => [])
      : [];
    return { lastWakeAt, windowStartedAt, sleeps };
  }

  // 段边界锚的两个时刻:段起点 = 上一次 read cutoff 那条 stack item 的落库时刻(也就是上一段的
  // 终点),段终点 = 这次要提交的 cutoff 那条的落库时刻。两个都走 resolveCompressionTimeGrounding
  // 用的同一个 reader,口径一致。
  //
  // 用 stack item 时刻而不是「提交时刻」是刻意的:stack 是 append-only,这两个时刻写完就永不
  // 改变,所以锚点在任何时候重算都得到同一串字节 —— 这正是它可以安全进 cacheable 前缀的原因。
  //
  // best-effort 同 resolveCompressionTimeGrounding:任何一头读失败就返回 '',调用方原样提交。
  private async resolveCompressionSpanAnchorSafe(input: {
    previousReadCutoffAfterStackIndex: number | null;
    committedReadCutoffAfterStackIndex: number | null;
  }): Promise<string> {
    try {
      if (input.previousReadCutoffAfterStackIndex === null || input.committedReadCutoffAfterStackIndex === null) {
        return '';
      }
      const stackTimeReader = (this.store as RuntimeStore & {
        getAgentStackItemTimeByIndex?: RuntimeStore['getAgentStackItemTimeByIndex'];
      }).getAgentStackItemTimeByIndex;
      if (typeof stackTimeReader !== 'function') {
        return '';
      }
      const [windowStartedAt, windowEndedAt] = await Promise.all([
        stackTimeReader.call(this.store, input.previousReadCutoffAfterStackIndex).catch(() => null),
        stackTimeReader.call(this.store, input.committedReadCutoffAfterStackIndex).catch(() => null)
      ]);
      return renderCompressionSpanAnchor({ windowStartedAt, windowEndedAt });
    } catch (error) {
      moduleLogger.warn('compression span anchor failed (fail-open, capsule committed unanchored)', {
        previousReadCutoffAfterStackIndex: input.previousReadCutoffAfterStackIndex,
        committedReadCutoffAfterStackIndex: input.committedReadCutoffAfterStackIndex,
        error: error instanceof Error ? error.message : String(error)
      });
      return '';
    }
  }

  private async getCurrentRuntimeEnergyState(queueMessage: QueueMessageRecord['payload']): Promise<RuntimeEnergyState | null> {
    const reader = (this.store as RuntimeStore & {
      getCurrentXiaoniEnergyState?: RuntimeStore['getCurrentXiaoniEnergyState'];
    }).getCurrentXiaoniEnergyState;
    if (typeof reader !== 'function') {
      return null;
    }
    try {
      const state = await reader.call(this.store);
      const energy = normalizeRuntimeEnergy(state?.energy, RUNTIME_MAX_ENERGY);
      const maxEnergy = Math.max(0.001, normalizeRuntimeEnergy(state?.maxEnergy, RUNTIME_MAX_ENERGY));
      return {
        energy,
        maxEnergy,
        lastWakeAt: typeof state?.lastWakeAt === 'string' ? state.lastWakeAt : null
      };
    } catch (error) {
      moduleLogger.warn('Failed to read Xiaoni energy before recover_energy', {
        traceId: queueMessage.traceId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  // Custom web search. Runs against Tavily (default, returns content) or the
  // self-hosted SearXNG (source=searxng) — never the Anthropic cloak. Full results
  // spill to /xiaoni-runtime/web-search/<ref>.md (executor reads the same path);
  // only a fixed-size window enters the loop. Paging via result_ref runs no new
  // API call. Never throws — failures become a tool_error result.
  private async executeWebSearch(
    toolCall: AgentToolCall,
    queueMessage: QueueMessageRecord['payload']
  ): Promise<Record<string, unknown>> {
    const args = toolCall.args && typeof toolCall.args === 'object' && !Array.isArray(toolCall.args)
      ? (toolCall.args as Record<string, unknown>)
      : {};
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const source = normalizeWebSearchSource(args.source, agentConfig.webSearchDefaultSource);
    const requestedPage = Number.isFinite(Number(args.page)) ? Math.max(1, Math.trunc(Number(args.page))) : 1;
    const providedRef = typeof args.result_ref === 'string' ? args.result_ref.trim() : '';
    const dir = agentConfig.webSearchResultDir;
    const pageChars = agentConfig.webSearchResultPageChars;
    const energyCost = RUNTIME_TOOL_COSTS[TOOL_NAMES.webSearch];

    // Paging path: a prior result_ref slices its file, no API call, no new material.
    if (providedRef) {
      const view = await readResultsPage(dir, providedRef, requestedPage, pageChars);
      if (view.found) {
        return {
          output_text: `${view.text}\n\n—— 第 ${view.page}/${view.totalPages} 页 · result_ref="${providedRef}" · 全文 ${view.filePath}`,
          result_ref: providedRef,
          source,
          page: view.page,
          total_pages: view.totalPages,
          is_fresh_search: false,
          has_results: false,
          energy_cost: energyCost
        };
      }
      // ref/file gone (pruned) — fall through to a fresh search if we have a query.
    }

    if (!query) {
      return {
        output_text: 'web_search 需要 query（或一个还在的 result_ref）。',
        tool_error: true,
        has_results: false,
        energy_cost: energyCost
      };
    }

    // Soft per-day cap to protect free API quota (best-effort).
    const today = new Date().toISOString().slice(0, 10);
    const usage = await checkDailyUsage(dir, today, agentConfig.webSearchDailyLimit);
    if (!usage.allowed) {
      return {
        output_text: `今天的 web_search 次数到上限了（${usage.limit}/天），先省着用，或用 exec_command 直接查。`,
        tool_error: true,
        has_results: false,
        energy_cost: energyCost
      };
    }

    const maxResults = Number.isFinite(Number(args.max_results)) && Number(args.max_results) > 0
      ? Math.trunc(Number(args.max_results))
      : agentConfig.webSearchMaxResults;
    const clientConfig: WebSearchClientConfig = {
      defaultSource: agentConfig.webSearchDefaultSource,
      maxResults,
      timeoutMs: agentConfig.webSearchTimeoutMs,
      tavilyApiKey: agentConfig.tavilyApiKey,
      tavilyApiUrl: agentConfig.tavilyApiUrl,
      searxngUrl: agentConfig.searxngUrl
    };

    const outcome = await runWebSearch(query, source, clientConfig);
    if (!outcome.ok) {
      return {
        output_text: `web_search（${source}）出错了：${outcome.error}`,
        tool_error: true,
        web_search_error: outcome.error,
        web_search_rate_limited: outcome.rateLimited,
        has_results: false,
        energy_cost: energyCost
      };
    }

    // East-8 to match every other context-bound timestamp (she reads this in the
    // result window / spilled file). Storage/refs elsewhere stay UTC.
    const generatedAt = formatEast8Timestamp();
    const markdown = renderResultsMarkdown({ query, source, results: outcome.results, generatedAt });
    const ref = sanitizeRef(`ws-${createHash('sha1').update(`${query}:${toolCall.callId}`).digest('hex').slice(0, 12)}`);
    let filePath = `${dir}/${ref}.md`;
    try {
      filePath = await writeResultsFile(dir, ref, markdown);
    } catch (error) {
      moduleLogger.warn('Failed to write web_search result file', {
        traceId: queueMessage.traceId,
        ref,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    const view = paginate(markdown, 1, pageChars);
    const hasResults = outcome.results.length > 0;
    const footer = hasResults
      ? `—— 第 ${view.page}/${view.totalPages} 页 · 共 ${outcome.results.length} 条 · source=${source}\n全文 ${filePath}（result_ref="${ref}"）。要下一页：web_search(result_ref="${ref}", page=2)；或 exec_command 自己 grep/cat 这个文件。`
      : `（${source} 没搜到结果）`;
    return {
      output_text: `${view.text}\n\n${footer}`,
      result_ref: ref,
      source,
      page: view.page,
      total_pages: view.totalPages,
      total_results: outcome.results.length,
      result_file: filePath,
      has_results: hasResults,
      is_fresh_search: true,
      energy_cost: energyCost
    };
  }

  // Execute one computer-use action against the host Playwright bridge and return
  // the resulting screenshot as an input_image (rendered by applyToolResultToLoopInput).
  // The bridge owns coordinate mapping (declared 1024x506 -> live CSS px) and resizes
  // the screenshot back to the declared display; agent-service is a thin forwarder.
  private async executeComputerAction(
    toolCall: AgentToolCall
  ): Promise<Record<string, unknown>> {
    const action = toolCall.args && typeof toolCall.args === 'object' && !Array.isArray(toolCall.args)
      ? (toolCall.args as Record<string, unknown>)
      : {};
    const actionName = typeof action.action === 'string' ? action.action : '';
    const bridgeUrl = `${agentConfig.computerUseBridgeUrl.replace(/\/+$/, '')}/computer`;
    try {
      const response = await fetch(bridgeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          display_width_px: COMPUTER_USE_DISPLAY_WIDTH,
          display_height_px: COMPUTER_USE_DISPLAY_HEIGHT
        })
      });
      const text = await response.text();
      let payload: Record<string, unknown> | null = null;
      try {
        payload = text ? (JSON.parse(text) as Record<string, unknown>) : null;
      } catch {
        payload = null;
      }
      if (!response.ok || !payload || payload.ok === false) {
        const errMsg = payload && typeof payload.error === 'string'
          ? payload.error
          : `computer bridge HTTP ${response.status}: ${(text || response.statusText).slice(0, 300)}`;
        return { computer_action: actionName, error: errMsg, tool_error: true };
      }
      const imageUrl = typeof payload.image_url === 'string' && payload.image_url
        ? (payload.image_url as string)
        : typeof payload.image_base64 === 'string' && payload.image_base64
          ? `data:image/png;base64,${payload.image_base64 as string}`
          : null;
      if (!imageUrl) {
        return { computer_action: actionName, error: 'computer bridge returned no screenshot', tool_error: true };
      }
      const savedPath = typeof payload.saved_path === 'string' && payload.saved_path
        ? (payload.saved_path as string)
        : null;
      // At-ingest slimming then externalization, BEFORE the screenshot enters the durable stack:
      // (1) lossless webp transcode (byte-smaller, byte-frozen), then (2) upload to the Files API
      // and stamp anthropic_file_id so the wire carries a ~60-byte reference instead of the base64.
      // Both are cache-safe because they run before first send and are frozen into the canonical.
      const webpContent = await transcodeInputImageItemsToWebpLossless(
        [{ type: 'input_image', image_url: imageUrl, detail: 'original' }] as OpenResponseInputItem[]
      );
      const imageContent = await externalizeInputImageItemsToAnthropicFile(webpContent);
      return {
        computer_action: actionName,
        image_content: imageContent,
        ...(savedPath ? { saved_path: savedPath } : {})
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { computer_action: actionName, error: `computer bridge unavailable: ${message}`, tool_error: true };
    }
  }

  private async executeCommand(
    args: Record<string, unknown>,
    toolCall?: AgentToolCall,
    queueMessage?: QueueMessageRecord['payload']
  ): Promise<Record<string, unknown>> {
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

    const execArgs = {
      ...args,
      env: {
        ...normalizeExecEnv(args.env),
        ...buildExecCommandRuntimeEnv(toolCall, queueMessage)
      }
    };

    if (agentConfig.xiaoniExecutorUrl) {
      try {
        const response = await fetch(`${agentConfig.xiaoniExecutorUrl}/api/internal/exec-command`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(execArgs)
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
    // Floor at 2000 tokens (~8000 chars) — parity with the executor: a stray tiny
    // max_output_tokens must not cap a short answer to nothing and detonate spill.
    const maxOutputTokens = clampNumber(args.max_output_tokens, 10_000, 2000, 200_000);
    const maxOutputChars = Math.max(1, maxOutputTokens * 4);
    const timeoutMs = clampNumber(args.yield_time_ms, 10_000, 250, 30_000);
    const startedAt = Date.now();

    return await new Promise<Record<string, unknown>>((resolve) => {
      const spillId = uuidv4();
      const stdoutCap = new StreamCapture(maxOutputChars, () => execOutputPath(spillId, 'stdout'));
      const stderrCap = new StreamCapture(maxOutputChars, () => execOutputPath(spillId, 'stderr'));
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
        stdoutCap.end();
        stderrCap.end();
        stdout = stdoutCap.render();
        stderr = stderrCap.render();
        const truncated = stdoutCap.truncated || stderrCap.truncated;
        const originalChars = stdoutCap.totalChars + stderrCap.totalChars;
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
            truncated,
            originalTokenCount: Math.max(0, Math.ceil(originalChars / 4))
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
        // buildResult already end()ed the caps; await the spill flush before
        // resolving so the spill file named in the elision marker is fully written
        // (parity with the xiaoni-executor live path). No-op when nothing spilled.
        void Promise.all([stdoutCap.settled(), stderrCap.settled()]).then(() => resolve(result));
      };

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(shell, resolveExecShellArgs(shell, cmd, login), {
          cwd: workdir,
          env: {
            ...process.env,
            ...normalizeExecEnv(execArgs.env)
          },
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stderrCap.push(Buffer.from(message, 'utf8'));
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
        stdoutCap.push(chunk);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrCap.push(chunk);
      });
      child.on('error', (error) => {
        const message = error instanceof Error ? error.message : String(error);
        stderrCap.push(Buffer.from(message, 'utf8'));
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

  private async executeReadFile(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const readArgs = {
      path: args.path,
      offset: args.offset,
      limit: args.limit,
      max_output_tokens: args.max_output_tokens
    };
    if (agentConfig.xiaoniExecutorUrl) {
      try {
        const response = await fetch(`${agentConfig.xiaoniExecutorUrl}/api/internal/read-file`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(readArgs)
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
        const target = typeof args.path === 'string' ? args.path : '';
        return {
          path: target,
          executor: 'xiaoni-executor',
          executor_unavailable: true,
          error_message: message,
          codex_output: `[read_file 失败: ${message}]`
        };
      }
    }
    return readFileRangeLocal(readArgs);
  }

  private async inspectImagePlaceholder(
    toolCall: AgentToolCall,
    queueMessage: QueueMessageRecord['payload'],
    context: ToolExecutionContext
  ) {
    const args = toolCall.args;
    const imageId = typeof args.image_id === 'string' && args.image_id.trim()
      ? args.image_id.trim()
      : '';
    const mediaTag = typeof args.media_tag === 'string' && args.media_tag.trim()
      ? args.media_tag.trim()
      : '';
    if (!imageId && !mediaTag) {
      const description = '没有提供 image_id 或 media_tag。不能猜图片 id；只能使用当前上下文明确给出的图片ID。';
      return {
        image_id: null,
        media_tag: null,
        inspected: false,
        description,
        output_xml: buildImageObservationXml('missing-image-reference', description)
      };
    }

    const asset = imageId
      ? await this.resolveMediaAssetForToolReference(queueMessage, imageId, { globalId: true })
      : await this.resolveMediaAssetForToolReference(queueMessage, mediaTag, { globalId: false });
    if (!asset) {
      const reference = imageId || mediaTag;
      const referenceKind = imageId ? 'image_id' : 'media_tag';
      const description = `这个 ${referenceKind} 不存在：${reference}。不能猜图片 id；只能使用当前上下文明确给出的图片ID。`;
      return {
        image_id: imageId || null,
        media_tag: mediaTag || null,
        inspected: false,
        description,
        output_xml: buildImageObservationXml(reference, description)
      };
    }

    const assetId = typeof asset.id === 'string' && asset.id.trim() ? asset.id.trim() : imageId;
    if (!assetId) {
      throw new Error(`${TOOL_NAMES.inspectImage} resolved an image without a stable id`);
    }

    const baseRequest = context.currentCanonicalRequest;
    if (!baseRequest) {
      throw new Error(`${TOOL_NAMES.inspectImage} requires current main-agent request context`);
    }

    let materialized: { dataUrl: string | null; mimeType: string | null; executorPath: string | null };
    try {
      materialized = await this.materializeImageAsset(asset);
    } catch (error) {
      const description = '这张图片的原始文件现在不可读取，可能是 QQ 临时图片链接已经过期。需要对方重新发图，或提供新的可读取图片。';
      const outputXml = buildImageObservationXml(assetId, description);
      return {
        image_id: assetId,
        media_tag: asset.media_tag || mediaTag || null,
        inspected: false,
        description,
        output_xml: outputXml,
        executor_path: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
    if (!materialized.dataUrl) {
      const description = '这张图片目前只有占位符，没有可读取的图片数据。';
      const outputXml = buildImageObservationXml(assetId, description);
      return {
        image_id: assetId,
        media_tag: asset.media_tag || mediaTag || null,
        inspected: false,
        description,
        output_xml: outputXml,
        executor_path: materialized.executorPath
      };
    }

    const forkRunId = buildImageVisionForkRunId(queueMessage.runId, assetId);
    const outputPath = buildImageVisionObservationPath(assetId);
    const existingObservation = await this.readImageVisionObservationFile(outputPath, queueMessage);
    // Externalize the inspected image to the Files API so the 看图 fork sends a ~60-byte file
    // reference instead of a full-resolution base64 (a big received-QQ/playwright/browser image can
    // otherwise push this fork past the 32MB cap and self-lock). Reuses the same threshold/dedup/
    // degrade path as the screenshot ingest; on any degrade the file_id is null and the fork keeps
    // the base64. The image is a cache_volatile tail, so a per-build file_id is cache-safe.
    const [externalizedImage] = await externalizeInputImageItemsToAnthropicFile([
      { type: 'input_image', image_url: materialized.dataUrl, detail: 'original' } as OpenResponseInputItem
    ]);
    const inspectedFileId = (externalizedImage as { anthropic_file_id?: unknown })?.anthropic_file_id;
    const forkRequest = buildImageVisionForkRequest(
      baseRequest,
      materialized.dataUrl,
      assetId,
      outputPath,
      existingObservation.text,
      { callId: toolCall.callId, arguments: toolCall.rawArguments },
      typeof inspectedFileId === 'string' && inspectedFileId ? inspectedFileId : null
    );
    await this.recordImageVisionForkRunSafe({
      forkRunId,
      status: 'running',
      traceId: queueMessage.traceId,
      runId: queueMessage.runId,
      assetId,
      imageId: assetId,
      mediaTag: asset.media_tag || mediaTag || null,
      metadata: {
        execution_mode: 'image_vision_fork',
        image_vision_output_path: outputPath,
        reason: typeof args.reason === 'string' ? args.reason : null
      }
    });

    let forkResult: {
      payload: ProviderAgentResponse | null;
      description: string;
      forkSliceId: string | null;
      failed: boolean;
      failureReason?: string | null;
    };
    try {
      forkResult = await this.runImageVisionForkToFile({
        forkRunId,
        baseRequest: forkRequest,
        queueMessage,
        outputPath,
        assetId,
        mediaTag: asset.media_tag || mediaTag || null
      });
    } catch (error) {
      await this.completeImageVisionForkRunSafe({
        forkRunId,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        metadata: {
          execution_mode: 'image_vision_fork',
          asset_id: assetId,
          image_vision_output_path: outputPath
        }
      });
      throw error;
    }

    if (forkResult.failed) {
      await this.completeImageVisionForkRunSafe({
        forkRunId,
        status: 'failed',
        errorMessage: forkResult.failureReason || 'image vision fork did not write a description file',
        metadata: {
          execution_mode: 'image_vision_fork',
          asset_id: assetId,
          image_vision_output_path: outputPath
        }
      });
      const description = forkResult.description;
      return {
        image_id: assetId,
        media_tag: asset.media_tag || mediaTag || null,
        inspected: false,
        description,
        output_xml: buildImageObservationXml(assetId, description),
        executor_path: materialized.executorPath,
        observation_path: outputPath
      };
    }

    const observation = await this.store.recordMediaObservation({
      assetId,
      observer: 'xiaoni',
      description: forkResult.description,
      sourceModel: forkResult.payload?.model || null,
      metadata: {
        trace_id: queueMessage.traceId,
        run_id: queueMessage.runId || null,
        fork_run_id: forkRunId,
        llm_call_id: forkResult.payload?.llm_call_id || null,
        llm_request_slice_id: forkResult.forkSliceId || null,
        image_vision_output_path: outputPath,
        provider_raw_trace_persisted: true,
        fork: 'image_vision_fork',
        reason: typeof args.reason === 'string' ? args.reason : null
      }
    });
    await this.completeImageVisionForkRunSafe({
      forkRunId,
      status: 'completed',
      observationId: typeof (observation as { id?: unknown } | null)?.id === 'string'
        ? (observation as { id: string }).id
        : null,
      description: forkResult.description,
      artifact: {
        description: forkResult.description,
        observation_path: outputPath,
        llm_request_slice_id: forkResult.forkSliceId || null,
        llm_call_id: forkResult.payload?.llm_call_id || null
      },
      metadata: {
        execution_mode: 'image_vision_fork',
        asset_id: assetId,
        media_tag: asset.media_tag || mediaTag || null,
        image_vision_output_path: outputPath
      }
    });

    const outputXml = buildImageObservationXml(assetId, forkResult.description);
    return {
      image_id: assetId,
      media_tag: asset.media_tag || mediaTag || null,
      inspected: true,
      description: forkResult.description,
      output_xml: outputXml,
      executor_path: materialized.executorPath,
      observation_path: outputPath
    };
  }

  private async runImageVisionForkToFile(params: {
    forkRunId: string;
    baseRequest: CanonicalAgentTurnRequest;
    queueMessage: QueueMessageRecord['payload'];
    outputPath: string;
    assetId: string;
    mediaTag: string | null;
  }): Promise<{
    payload: ProviderAgentResponse | null;
    description: string;
    forkSliceId: string | null;
    failed: boolean;
    failureReason?: string | null;
  }> {
    let forkInput = cloneCanonicalAgentTurnRequest(params.baseRequest).input;
    let pendingForkOneShotInputItems: OpenResponseInputItem[] = [];
    let lastPayload: ProviderAgentResponse | null = null;
    let lastForkSliceId: string | null = null;
    let lastCheckResult = 'not_checked';

    for (let forkTurn = 1; forkTurn <= IMAGE_VISION_FORK_MAX_FILE_WRITE_ATTEMPTS; forkTurn += 1) {
      const forkRequest = cloneCanonicalAgentTurnRequest(params.baseRequest);
      const forkRequestInput = pendingForkOneShotInputItems.length > 0
        ? [...forkInput, ...pendingForkOneShotInputItems]
        : forkInput;
      pendingForkOneShotInputItems = [];
      forkRequest.input = normalizeResponseInputItems(forkRequestInput);
      forkRequest.metadata = {
        ...(forkRequest.metadata || {}),
        fork_turn: String(forkTurn)
      };
      await this.waitForRuntimeEnabledBeforeModelSlice(params.queueMessage, params.queueMessage.runId);
      const payload = await this.executeImageVisionForkTurn(forkRequest, params.queueMessage);
      lastPayload = payload;
      const forkSliceId = payload.llm_request_slice_id
        || payload.llm_call_id
        || `image-vision-fork-slice:${params.forkRunId}:${forkTurn}`;
      lastForkSliceId = forkSliceId;
      const inputRows = await this.appendImageVisionForkItemsSafe({
        forkRunId: params.forkRunId,
        traceId: params.queueMessage.traceId,
        runId: params.queueMessage.runId,
        sourceType: 'image_vision_fork_slices',
        sourceId: forkSliceId,
        llmRequestSliceId: forkSliceId,
        items: [buildForkInputStackItem({
          forkRunId: params.forkRunId,
          sliceId: forkSliceId,
          forkTurn,
          source: 'image_vision_fork_input',
          inputItems: forkRequest.input
        }) as Record<string, unknown>]
      });
      const outputItems = extractCanonicalResponseOutputItems(payload);
      const outputRows = await this.appendImageVisionForkItemsSafe({
        forkRunId: params.forkRunId,
        traceId: params.queueMessage.traceId,
        runId: params.queueMessage.runId,
        sourceType: 'image_vision_fork_slices',
        sourceId: forkSliceId,
        llmRequestSliceId: forkSliceId,
        items: buildModelOutputStackItems(outputItems, forkSliceId) as Array<Record<string, unknown>>
      });
      const outputItemIndexes = outputRows
        .map((row) => Number((row as { itemIndex?: unknown }).itemIndex))
        .filter((value) => Number.isFinite(value));
      const inputItemIndexes = inputRows
        .map((row) => Number((row as { itemIndex?: unknown }).itemIndex))
        .filter((value) => Number.isFinite(value));
      const inputStackItemIds = inputRows
        .map((row) => (row as { id?: unknown }).id)
        .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number');
      await this.recordImageVisionForkSliceSafe({
        forkRunId: params.forkRunId,
        sliceId: forkSliceId,
        llmCallId: payload.llm_call_id || null,
        inputStartIndex: inputItemIndexes.length > 0 ? Math.min(...inputItemIndexes) : null,
        inputEndIndex: inputItemIndexes.length > 0 ? Math.max(...inputItemIndexes) : null,
        inputStackItemIds,
        outputStartIndex: outputItemIndexes.length > 0 ? Math.min(...outputItemIndexes) : null,
        outputEndIndex: outputItemIndexes.length > 0 ? Math.max(...outputItemIndexes) : null,
        canonicalRequest: (payload.canonical_request || forkRequest) as Record<string, unknown>,
        wireRequest: payload.wire_request || null,
        canonicalResponse: payload.canonical_response || null,
        wireResponse: payload.wire_response || null,
        rawResponse: payload.raw_response || null,
        outputItems,
        status: payload.success ? 'completed' : 'failed',
        tokenUsage: buildProviderTokenUsage(payload),
        traceId: params.queueMessage.traceId,
        runId: params.queueMessage.runId,
        agentTurn: forkTurn,
        modelName: payload.model || forkRequest.model || null,
        modelProvider: payload.provider || null,
        requestFormatVersion: payload.request_format_version || null,
        wireProviderFormat: payload.wire_provider_format || null,
        processingTimeMs: typeof payload.performance?.processing_time_ms === 'number' ? payload.performance.processing_time_ms : null,
        metadata: {
          ...buildProviderWireMetadata(payload),
          execution_mode: 'image_vision_fork',
          asset_id: params.assetId,
          media_tag: params.mediaTag,
          image_vision_output_path: params.outputPath,
          fork_turn: forkTurn
        }
      });

      const actionPlan = this.responseActionRouter.route(payload.canonical_response);
      const toolCalls = actionPlan.replayableOutputs.filter(isReplayableToolCall);
      for (const replayItem of actionPlan.replayableOutputs) {
        forkInput.push(replayItem.inputItem as OpenResponseInputItem);
      }

      const wrongToolCalls = toolCalls.filter((item) => item.toolCall.name !== TOOL_NAMES.execCommand);
      if (wrongToolCalls.length > 0) {
        const wrongToolOutputs = wrongToolCalls.map((item) => buildImageVisionUnsupportedToolOutput(item.toolCall));
        forkInput.push(...wrongToolOutputs);
        await this.appendImageVisionForkItemsSafe({
          forkRunId: params.forkRunId,
          traceId: params.queueMessage.traceId,
          runId: params.queueMessage.runId,
          sourceType: 'image_vision_fork_tool_executions',
          sourceId: `image-vision-fork-tool:${params.forkRunId}:unsupported-tools:${forkTurn}`,
          llmRequestSliceId: forkSliceId,
          items: wrongToolCalls.flatMap((item, index) => buildToolResultStackItems({
            toolCall: item.toolCall,
            toolResult: {
              success: false,
              error: wrongToolOutputs[index]?.output || `只能调用 ${TOOL_NAMES.execCommand}`,
              allowed_tool: TOOL_NAMES.execCommand,
              task: 'image_vision'
            },
            continuationItems: wrongToolOutputs[index] ? [wrongToolOutputs[index]!] : [],
            llmRequestSliceId: forkSliceId
          })) as Array<Record<string, unknown>>
        });
      }

      const execCalls = toolCalls.filter((item) => item.toolCall.name === TOOL_NAMES.execCommand);
      for (const execCall of execCalls) {
        const toolResult = await this.executeCommand(execCall.toolCall.args, execCall.toolCall, params.queueMessage);
        const continuation = applyToolResultToLoopInput(execCall.toolCall, toolResult, {
          loopInput: forkInput,
          speakingToolName: params.queueMessage.chatType === 'direct' ? TOOL_NAMES.privateReply : TOOL_NAMES.groupReply,
          hasVisibleReply: false,
          runtimeEnergyState: await this.getCurrentRuntimeEnergyState(params.queueMessage)
        });
        forkInput.push(...continuation.inputItems);
        pendingForkOneShotInputItems.push(...continuation.oneShotInputItems);
        await this.appendImageVisionForkItemsSafe({
          forkRunId: params.forkRunId,
          traceId: params.queueMessage.traceId,
          runId: params.queueMessage.runId,
          sourceType: 'image_vision_fork_tool_executions',
          sourceId: `image-vision-fork-tool:${params.forkRunId}:${execCall.toolCall.callId}`,
          llmRequestSliceId: forkSliceId,
          items: buildToolResultStackItems({
            toolCall: execCall.toolCall,
            toolResult,
            continuationItems: continuation.inputItems,
            llmRequestSliceId: forkSliceId
          }) as Array<Record<string, unknown>>
        });
      }

      if (actionPlan.hasFinalAnswer) {
        const check = await this.readImageVisionObservationFile(params.outputPath, params.queueMessage);
        lastCheckResult = check.message;
        if (check.text) {
          return {
            payload,
            description: check.text,
            forkSliceId,
            failed: false
          };
        }
        forkInput.push(buildImageVisionRetryReminder({
          outputPath: params.outputPath,
          checkResult: `你已经 final_answer，但该路径下还没有可用的图片理解内容。${check.message}`
        }));
        continue;
      }

      lastCheckResult = wrongToolCalls.length > 0
        ? `模型调用了不允许的工具 ${wrongToolCalls.map((item) => item.toolCall.name).join(', ')}；已通过 function_call_output 提醒只能调用 ${TOOL_NAMES.execCommand}`
        : execCalls.length > 0
        ? `模型这一轮调用了 ${execCalls.length} 个 ${TOOL_NAMES.execCommand} 写文件，文件多半已经写好——只差回一句纯文本确认来收尾，不要再重写或调工具`
        : `模型没有调用 ${TOOL_NAMES.execCommand}，也没有 final_answer`;
      forkInput.push(buildImageVisionRetryReminder({
        outputPath: params.outputPath,
        checkResult: lastCheckResult
      }));
    }

    return {
      payload: lastPayload,
      description: buildImageVisionFailedDescription(params.outputPath),
      forkSliceId: lastForkSliceId,
      failed: true,
      failureReason: `image vision fork failed to write non-empty observation file after ${IMAGE_VISION_FORK_MAX_FILE_WRITE_ATTEMPTS} attempts: ${lastCheckResult}`
    };
  }

  private async executeImageVisionForkTurn(
    forkRequest: CanonicalAgentTurnRequest,
    queueMessage: QueueMessageRecord['payload']
  ): Promise<ProviderAgentResponse> {
    const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/llm/debug`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [NO_TRAFFIC_PERSIST_HEADER]: '1'
      },
      body: JSON.stringify({
        trace_id: queueMessage.traceId,
        run_id: queueMessage.runId,
        executionMode: 'image_vision_fork',
        model: forkRequest.model,
        canonicalRequest: forkRequest
      })
    });
    const payload = await response.json() as ProviderAgentResponse;
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || `${TOOL_NAMES.inspectImage} fork failed with ${response.status}`);
    }
    return payload;
  }

  private async readImageVisionObservationFile(
    outputPath: string,
    queueMessage: QueueMessageRecord['payload']
  ): Promise<{ text: string | null; message: string }> {
    const script = [
      'python3 - <<\'PY\'',
      'from pathlib import Path',
      'p = Path(' + JSON.stringify(outputPath) + ')',
      'if not p.exists():',
      '    print("MISSING")',
      'elif not p.is_file():',
      '    print("NOT_FILE")',
      'else:',
      '    text = p.read_text(encoding="utf-8", errors="replace").strip()',
      '    if not text:',
      '        print("EMPTY")',
      '    else:',
      '        print("OK")',
      '        print(text)',
      'PY'
    ].join('\n');
    const result = await this.executeCommand({
      cmd: script,
      yield_time_ms: 10_000,
      max_output_tokens: 20_000
    }, undefined, queueMessage);
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    const [statusLine = '', ...rest] = stdout.split(/\r?\n/u);
    const status = statusLine.trim();
    if (status === 'OK') {
      const text = rest.join('\n').trim();
      return text
        ? { text, message: '文件存在且内容非空' }
        : { text: null, message: '文件状态为 OK，但内容为空' };
    }
    const detail = stderr ? `${status || 'UNKNOWN'}: ${stderr}` : status || 'UNKNOWN';
    return {
      text: null,
      message: `文件检查失败：${detail}`
    };
  }

  // Spec B: read back the 近况 the compression fork asked the model to write. Same file
  // round-trip as readImageVisionObservationFile — the read runs via exec_command inside the
  // executor (the container that WROTE the file), so there is no cross-container permission
  // issue with the skill's atomic 0600 write. The 近况 is compact by design (summary + overflow
  // file paths; the bulk lives in externalized files), so the max_output_tokens margin is ample.
  private async readCoreMemoryCompressionFile(
    outputPath: string,
    queueMessage: QueueMessageRecord['payload'],
    notBeforeMs?: number
  ): Promise<{ text: string | null; message: string }> {
    // 60s 时钟宽容:executor 与引擎容器时钟可能有微小偏差;窗口只用来挡「旧文件冒充本轮」。
    const mtimeFloorEpoch = typeof notBeforeMs === 'number' ? Math.floor(notBeforeMs / 1000) - 60 : 0;
    const script = [
      'python3 - <<\'PY\'',
      'from pathlib import Path',
      'p = Path(' + JSON.stringify(outputPath) + ')',
      'if not p.exists():',
      '    print("MISSING")',
      'elif not p.is_file():',
      '    print("NOT_FILE")',
      'elif p.stat().st_mtime < ' + String(mtimeFloorEpoch) + ':',
      '    print("STALE")',
      'else:',
      '    text = p.read_text(encoding="utf-8", errors="replace").strip()',
      '    if not text:',
      '        print("EMPTY")',
      '    else:',
      '        print("OK")',
      '        print(text)',
      'PY'
    ].join('\n');
    const result = await this.executeCommand({
      cmd: script,
      yield_time_ms: 10_000,
      max_output_tokens: 40_000
    }, undefined, queueMessage);
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    const [statusLine = '', ...rest] = stdout.split(/\r?\n/u);
    const status = statusLine.trim();
    if (status === 'OK') {
      // 引擎侧复检(marker 可被伪造/绕过脚本,这里是最后一道):清洗后再验长度带。
      // 数值与 commit_memory.py 的 CAPSULE_MIN/MAX_CHARS 同调。
      const text = sanitizeMemoryText(rest.join('\n'));
      if (!text) {
        return { text: null, message: '近况文件状态为 OK，但内容为空' };
      }
      if (text.length < 300 || text.length > 8000) {
        return { text: null, message: `近况未过引擎侧验收(${text.length} 字,要求 300-8000)：请按整理脚本的规矩重新提交` };
      }
      return { text, message: '近况文件已写入且非空' };
    }
    const detail = stderr ? `${status || 'UNKNOWN'}: ${stderr}` : status || 'UNKNOWN';
    return {
      text: null,
      message: `近况文件尚未就绪：${detail}`
    };
  }

  private async resolveMediaAssetForToolReference(
    queueMessage: QueueMessageRecord['payload'],
    requestedReference: string,
    options: { globalId: boolean }
  ) {
    const reference = typeof requestedReference === 'string' && requestedReference.trim()
      ? requestedReference.trim()
      : '';
    if (!reference) {
      return null;
    }

    const assetReaderById = (this.store as RuntimeStore & {
      getMediaAssetById?: RuntimeStore['getMediaAssetById'];
    }).getMediaAssetById;
    if (typeof assetReaderById === 'function' && (options.globalId || MEDIA_ASSET_ID_PATTERN.test(reference))) {
      return assetReaderById.call(this.store, queueMessage.sessionKey, reference);
    }

    const exact = await this.store.getMediaAssetByTag(queueMessage.sessionKey, reference);
    if (exact) {
      return exact;
    }

    const normalized = reference.toLowerCase();
    const contextualAssets = [];
    for (const message of queueMessage.messages) {
      const assets = Array.isArray(message.inboundContext.MediaAssets)
        ? message.inboundContext.MediaAssets
        : [];
      contextualAssets.push(...assets);
    }

    const candidate = contextualAssets.find((asset) => {
      const mediaTag = typeof asset.mediaTag === 'string' ? asset.mediaTag.toLowerCase() : '';
      const assetId = typeof asset.id === 'string' ? asset.id.toLowerCase() : '';
      const placeholder = typeof asset.placeholder === 'string' ? asset.placeholder.toLowerCase() : '';
      const fileName = typeof asset.fileName === 'string' ? asset.fileName.toLowerCase() : '';
      return normalized === assetId
        || normalized === mediaTag
        || normalized === `file:${fileName}`
        || normalized === fileName
        || Boolean(fileName && normalized.includes(fileName))
        || Boolean(placeholder && normalized === placeholder);
    });
    if (candidate?.id && typeof assetReaderById === 'function') {
      return assetReaderById.call(this.store, queueMessage.sessionKey, candidate.id);
    }
    if (candidate?.mediaTag) {
      return this.store.getMediaAssetByTag(queueMessage.sessionKey, candidate.mediaTag);
    }

    return null;
  }

  private async materializeImageAsset(asset: Record<string, unknown>) {
    const metadata = asset.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata)
      ? asset.metadata as Record<string, unknown>
      : {};
    const executorPath = typeof metadata.executor_path === 'string' && metadata.executor_path.trim()
      ? metadata.executor_path.trim()
      : typeof metadata.executorPath === 'string' && metadata.executorPath.trim()
        ? metadata.executorPath.trim()
        : typeof asset.executor_path === 'string' && asset.executor_path.trim()
          ? asset.executor_path.trim()
          : typeof asset.executorPath === 'string' && asset.executorPath.trim()
            ? asset.executorPath.trim()
            : null;
    const sourceLocator = typeof asset.storage_uri === 'string' && asset.storage_uri.trim()
      ? asset.storage_uri.trim()
      : typeof asset.storageUri === 'string' && asset.storageUri.trim()
        ? asset.storageUri.trim()
        : typeof asset.source_locator === 'string' && asset.source_locator.trim()
          ? asset.source_locator.trim()
          : typeof asset.sourceLocator === 'string' && asset.sourceLocator.trim()
            ? asset.sourceLocator.trim()
            : '';
    const fileId = typeof metadata.file_id === 'string' && metadata.file_id.trim()
      ? metadata.file_id.trim()
      : '';
    if (!sourceLocator && !fileId) {
      return { dataUrl: null as string | null, mimeType: null as string | null, executorPath };
    }

    const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/media/materialize-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [NO_TRAFFIC_PERSIST_HEADER]: '1'
      },
      body: JSON.stringify({
        asset_id: asset.id,
        source_locator: sourceLocator || undefined,
        file_id: fileId || undefined,
        file_name: typeof metadata.file_name === 'string' ? metadata.file_name : undefined,
        mime_type: typeof asset.mime_type === 'string'
          ? asset.mime_type
          : typeof asset.mimeType === 'string'
            ? asset.mimeType
            : undefined,
        metadata: {
          file_id: fileId || undefined,
          file_name: typeof metadata.file_name === 'string' ? metadata.file_name : undefined
        }
      })
    });
    const payload = await response.json() as { success?: boolean; error?: string; data?: { data_url?: string; mime_type?: string } };
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || `${TOOL_NAMES.inspectImage} materialize failed with ${response.status}`);
    }
    const dataUrl = typeof payload.data?.data_url === 'string' && payload.data.data_url.startsWith('data:image/')
      ? payload.data.data_url
      : null;
    return {
      dataUrl,
      mimeType: typeof payload.data?.mime_type === 'string' ? payload.data.mime_type : null,
      executorPath
    };
  }

  private async requestImageTask(
    args: Record<string, unknown>,
    queueMessage: QueueMessageRecord['payload'],
    context: ToolExecutionContext = {}
  ) {
    // Image generation is gated by XIAONI_IMAGE_TASK_ENABLED (currently 'true' in
    // compose -> ENABLED and working). The runtime path is the OpenAI-compatible image
    // provider (cliproxyapi -> gpt-image-2, /v1/images/generations). The `codex_base_request`
    // clone stuffed into the task below is ONLY consumed by the provider's legacy
    // codex-transport mode (openai-image-provider.ts, `transport.mode === 'codex'`); the
    // current openai mode ignores it. Flip the flag to anything other than 'true' to
    // hard-disable and return the graceful "unavailable" stub instead of queuing a task.
    if (process.env.XIAONI_IMAGE_TASK_ENABLED !== 'true') {
      void context;
      return {
        queued: false,
        available: false,
        artifact_available: false,
        task_status: 'unavailable',
        status_text: '作图功能当前临时不可用（迁移期间已停用），日后会恢复。请直接用文字告诉对方这次做不了图，不要反复重试本工具。'
      };
    }

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
      const asset = await this.resolveMediaAssetForToolReference(queueMessage, mediaTag, {
        globalId: MEDIA_ASSET_ID_PATTERN.test(mediaTag)
      });
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

    const task = await this.store.createRuntimeTask({
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
        ...(context.currentCanonicalRequest ? {
          codex_base_request: cloneCanonicalAgentTurnRequest(context.currentCanonicalRequest)
        } : {}),
        ...(normalizedFromEdit ? {
          normalized_from_edit: true,
          normalization_reason: normalizationReason
        } : {})
      }
    });

    const xiaoniOs = typeof args.xiaoni_os === 'string' && args.xiaoni_os.trim()
      ? args.xiaoni_os.trim()
      : null;
    const taskId = typeof task === 'string'
      ? task
      : typeof task?.id === 'string'
        ? task.id
        : null;
    const taskType = operation === 'edit' ? 'image_edit' : 'image_generate';
    const requestedTaskType = requestedOperation === 'edit' ? 'image_edit' : 'image_generate';
    const statusText = renderImageTaskPendingStatusText({
      taskId,
      taskType,
      requestedTaskType,
      targetDescription
    });

    return {
      queued: true,
      task_id: taskId,
      task_status: 'pending',
      task_type: taskType,
      requested_task_type: requestedTaskType,
      task_context: targetDescription,
      artifact_available: false,
      picture_id: null,
      picture_path: null,
      output_path: null,
      completion_signal: 'image_task_notification',
      wait_for_notification: true,
      do_not_infer_artifact_path: true,
      xiaoni_os: xiaoniOs,
      status_text: statusText
    };
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
      const messages = normalizeMessages(sanitizedArgs);
      let userId: number | null = null;
      try {
        userId = resolveOptionalToolTargetId(sanitizedArgs, 'user_id', 'target_user_id');
      } catch (error) {
        return buildRetryableSendToolError('private', TOOL_NAMES.privateReply, sanitizedArgs, {
          errorCode: 'invalid_user_id',
          message: error instanceof Error ? error.message : String(error),
          requiredArguments: ['user_id']
        });
      }
      if (userId === null) {
        return buildRetryableSendToolError('private', TOOL_NAMES.privateReply, sanitizedArgs, {
          errorCode: 'missing_user_id',
          message: `${TOOL_NAMES.privateReply} requires explicit user_id.`,
          requiredArguments: ['user_id']
        });
      }
      if (messages.length === 0) {
        return buildRetryableSendToolError('private', TOOL_NAMES.privateReply, sanitizedArgs, {
          errorCode: 'missing_message',
          message: `${TOOL_NAMES.privateReply} requires message or messages.`,
          requiredArguments: ['message or messages']
        });
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
      await this.recordOutboundQqMessages({
        chatType: 'direct',
        peerId: String(userId),
        peerName: queueMessage.chatType !== 'group' && String(queueMessage.peerId) === String(userId)
          ? (queueMessage.peerName ?? null)
          : null,
        messages,
        delivery: payload.data || null,
        queueMessage
      });
      return {
        message_type: 'private',
        target_user_id: userId,
        sent_messages: messages,
        xiaoni_os: xiaoniOs,
        pending_share: pendingShare,
        delivery: payload.data || null
      };
    }

    const normalizedMessages = normalizeMessages(sanitizedArgs);
    let groupId: number | null = null;
    try {
      groupId = resolveOptionalToolTargetId(sanitizedArgs, 'group_id', 'target_group_id');
    } catch (error) {
      return buildRetryableSendToolError('group', TOOL_NAMES.groupReply, sanitizedArgs, {
        errorCode: 'invalid_group_id',
        message: error instanceof Error ? error.message : String(error),
        requiredArguments: ['group_id']
      });
    }
    if (groupId === null) {
      return buildRetryableSendToolError('group', TOOL_NAMES.groupReply, sanitizedArgs, {
        errorCode: 'missing_group_id',
        message: `${TOOL_NAMES.groupReply} requires explicit group_id.`,
        requiredArguments: ['group_id']
      });
    }
    const plannedDelivery = {
      messages: normalizedMessages,
      mentionUserIds: normalizeOptionalIntegerList(sanitizedArgs.mention_user_ids),
      secondBeatSuppressed: false
    };
    if (plannedDelivery.messages.length === 0) {
      return buildRetryableSendToolError('group', TOOL_NAMES.groupReply, sanitizedArgs, {
        errorCode: 'missing_message',
        message: `${TOOL_NAMES.groupReply} requires message or messages.`,
        requiredArguments: ['message or messages']
      });
    }

    let selectedMessages = plannedDelivery.messages;
    let selectedMentionUserIds = plannedDelivery.mentionUserIds;

    const response = await fetch(`${agentConfig.providerServiceUrl}/api/internal/send_group`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_key: `qq:group:${groupId}`,
        group_id: groupId,
        messages: selectedMessages,
        mention_user_ids: selectedMentionUserIds
      })
    });
    const payload = await response.json() as { success?: boolean; error?: string; data?: unknown };
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || `${TOOL_NAMES.groupReply} failed with ${response.status}`);
    }
    const currentGroupId = queueMessage.chatType === 'group'
      ? Number(queueMessage.inboundContext.NativeChannelId || queueMessage.peerId)
      : null;
    const presenceQueueMessage = queueMessage.chatType === 'group'
      && typeof currentGroupId === 'number'
      && Number.isFinite(currentGroupId)
      && Math.trunc(currentGroupId) === groupId
      ? queueMessage
      : {
          ...queueMessage,
          chatType: 'group' as const,
          sessionKey: `qq:group:${groupId}`,
          peerId: String(groupId),
          peerName: undefined
        };
    await this.recordPresenceAssistantAction(presenceQueueMessage);
    await this.recordOutboundQqMessages({
      chatType: 'group',
      peerId: String(groupId),
      peerName: queueMessage.chatType === 'group' && String(queueMessage.peerId) === String(groupId)
        ? (queueMessage.peerName ?? null)
        : null,
      messages: selectedMessages,
      delivery: payload.data || null,
      queueMessage
    });
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

  // 落库小腻自己发出去的 QQ 消息，供 qq_usage 会话窗口回看（她发完就看不到自己说了啥的根因）。
  // 纯 fire-and-forget 旁路：任何失败都不能影响发送本身。绝不参与未读/notify/唤醒。
  private async recordOutboundQqMessages(params: {
    chatType: 'direct' | 'group';
    peerId: string;
    peerName?: string | null;
    messages: unknown;
    delivery: unknown;
    contentKind?: 'text' | 'image';
    queueMessage: QueueMessageRecord['payload'];
  }): Promise<void> {
    try {
      const store = this.store as RuntimeStore & {
        recordQqUsageOutboundMessage?: RuntimeStore['recordQqUsageOutboundMessage'];
      };
      if (typeof store.recordQqUsageOutboundMessage !== 'function') {
        return;
      }
      const botAccountId = agentConfig.botAccountId || '1129974489';
      const peerId = String(params.peerId);
      if (!peerId) {
        return;
      }
      const sessionKey = params.chatType === 'group'
        ? `qq:group:${peerId}`
        : `qq:direct:${botAccountId}:${peerId}`;
      const bodies = (Array.isArray(params.messages) ? params.messages : [params.messages])
        .map((entry) => String(entry ?? '').trim())
        .filter((entry) => entry.length > 0);
      if (bodies.length === 0) {
        return;
      }
      const deliveryIds = extractDeliveryMessageIds(params.delivery);
      for (let index = 0; index < bodies.length; index += 1) {
        await store.recordQqUsageOutboundMessage({
          sessionKey,
          chatType: params.chatType,
          peerId,
          peerName: params.peerName ?? null,
          accountId: botAccountId,
          senderId: botAccountId,
          senderName: '小腻',
          deliveryMessageId: deliveryIds[index] ?? null,
          contentKind: params.contentKind || 'text',
          bodyForAgent: bodies[index],
          rawBody: bodies[index],
          traceId: params.queueMessage.traceId ?? null,
          runId: params.queueMessage.runId ?? null
        }).catch(() => undefined);
      }
    } catch {
      // 记录自发消息是最佳努力，绝不阻塞发送
    }
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

  private async recordNoVisibleDeliveryLifeEvent(
    queueMessage: QueueMessageRecord['payload'],
    runId: string,
    outcome: string,
    leaseRelease: LeaseReleaseRecord,
    modelRequestSlices: number,
    conversationId: number | null
  ) {
    const recorder = (this.store as RuntimeStore & {
      recordNoVisibleDeliveryLifeEvent?: RuntimeStore['recordNoVisibleDeliveryLifeEvent'];
    }).recordNoVisibleDeliveryLifeEvent;
    if (typeof recorder !== 'function') {
      return;
    }
    await recorder.call(this.store, {
      queueMessage,
      runId,
      traceId: queueMessage.traceId,
      outcome,
      presenceOutcome: outcome,
      leaseRelease: {
        reason: leaseRelease.reason,
        detail: leaseRelease.detail,
        outcome: leaseRelease.outcome,
        noVisibleDelivery: leaseRelease.no_visible_delivery
      },
      modelRequestSlices,
      conversationId
    }).catch((error) => {
      moduleLogger.warn('Failed to record no-visible-delivery life event', {
        traceId: queueMessage.traceId,
        runId,
        outcome,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }
}

function applyReadCutoffAfterStackIndex<T extends ConversationTurn>(history: T[], readCutoffAfterStackIndex: number | null | undefined): T[] {
  if (typeof readCutoffAfterStackIndex !== 'number' || !Number.isFinite(readCutoffAfterStackIndex)) {
    return history.slice();
  }
  return history.filter((turn) => turn.id > readCutoffAfterStackIndex);
}

function applyReadCutoff<T extends ConversationTurn>(history: T[], cutoffState: SessionReadCutoffState | null): T[] {
  return applyReadCutoffAfterStackIndex(history, cutoffState?.readCutoffAfterStackIndex);
}

function isTransientProviderExecutionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /terminated|fetch failed|network|timeout|timed out|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR|server_is_overloaded|service_unavailable_error|currently overloaded/i.test(message);
}

function computeProviderExecutionRetryDelayMs(attempt: number) {
  const baseDelayMs = Math.max(0, agentConfig.providerExecutionRetryBaseDelayMs || 0);
  const multiplier = Math.max(1, Math.trunc(attempt));
  return baseDelayMs * multiplier;
}

function computeTransientQueueRetryDelayMs(attempts: number) {
  const baseDelayMs = Math.max(0, agentConfig.queueTransientRetryBaseDelayMs || 0);
  const maxDelayMs = Math.max(baseDelayMs, agentConfig.queueTransientRetryMaxDelayMs || baseDelayMs);
  const exponent = Math.max(0, Math.trunc(attempts) - 1);
  return Math.min(maxDelayMs, baseDelayMs * Math.pow(3, exponent));
}

function isPhoneNotificationPayload(queueMessage: QueueMessageRecord['payload']) {
  return queueMessage.source === 'phone_notification'
    || Boolean(queueMessage.phoneNotification)
    || queueMessage.inboundContext?.Surface === 'phone_notification';
}

function isImageTaskNotificationPayload(queueMessage: QueueMessageRecord['payload']) {
  return queueMessage.source === 'image_task_notification'
    || Boolean(queueMessage.imageTaskNotification)
    || queueMessage.inboundContext?.Surface === 'image_task_notification';
}

function isSystemReminderPayload(queueMessage: QueueMessageRecord['payload']) {
  if (isDeletedFinalAnswerReminderPayload(queueMessage)) {
    return false;
  }
  return queueMessage.source === 'system_reminder'
    || Boolean(queueMessage.systemReminder)
    || queueMessage.inboundContext?.Surface === 'system_reminder';
}

function isDeletedFinalAnswerReminderPayload(queueMessage: QueueMessageRecord['payload']) {
  const source = queueMessage.source === 'system_reminder'
    || Boolean(queueMessage.systemReminder)
    || queueMessage.inboundContext?.Surface === 'system_reminder';
  if (!source) {
    return false;
  }
  const reason = queueMessage.systemReminder?.reason || queueMessage.rawPayload?.reason;
  return reason === 'final_answer_idle' || reason === 'final_answer_turn_control';
}

// 时钟推送(clock_ping)。它是引擎自发的报时,不是一次「执行 plan 的机会」——所以空转记账
// 必须对它完全隐形:既不 +1 也不归零。以前只有真有事发生才会拉起一个 run,报时把这个前提
// 改了(每 2h 一个),不设门的话 IDLE_ESCALATION_AFTER_ROUNDS=2 会被引擎自己制造的回合顶穿。
// 注意作废腿不受影响:它已经按 triggerIsSubconsciousPlan 把非 plan notify 的 run 全部冻结。
export function isClockPingPayload(queueMessage: QueueMessageRecord['payload']) {
  if (!isSystemReminderPayload(queueMessage)) {
    return false;
  }
  return (queueMessage.systemReminder?.reason || queueMessage.rawPayload?.reason) === 'clock_ping';
}

function isSubconsciousAgentNotifyPayload(queueMessage: QueueMessageRecord['payload']) {
  if (!isSystemReminderPayload(queueMessage)) {
    return false;
  }
  const reason = queueMessage.systemReminder?.reason || queueMessage.rawPayload?.reason;
  const notifyTemplate = queueMessage.rawPayload?.notify_template;
  return reason === 'subconscious_agent'
    && notifyTemplate === 'subconscious_agent_notify.md';
}

// 外部投递进来的 notify(skill 打 /api/internal/runtime/notify)。当前只用于观测和日后加行为门:
// 它【不】接进 classifyCurrentBucketMessageTemplate —— 渲染照走 renderSystemReminder 那条既有路径。
// 也【不】进 :8753 的空转记账排除门:clock_ping 隐形是因为它是引擎每 2h 自发的节拍器，而外部投递
// 是真事件。她收到通知去处理就必然调工具(didRealWork 归零)，收到了却纯文本收工那本来就是空转。
export function isExternalNotifyPayload(queueMessage: QueueMessageRecord['payload']) {
  if (!isSystemReminderPayload(queueMessage)) {
    return false;
  }
  const reason = queueMessage.systemReminder?.reason || queueMessage.rawPayload?.reason;
  const notifyTemplate = queueMessage.rawPayload?.notify_template;
  return reason === 'external_notify'
    && notifyTemplate === 'external_notify.md';
}

function isPromptFacingRuntimeReminderPayload(queueMessage: QueueMessageRecord['payload']) {
  return isPhoneNotificationPayload(queueMessage)
    || isImageTaskNotificationPayload(queueMessage)
    || isSystemReminderPayload(queueMessage);
}

// 日记索引快照:压缩 STW 提交那一帧读一次 INDEX.md,冻结进 agent_session_context_windows。
// <xiaoni_diary_index> 只从冻结串渲染——绝不逐轮重读文件,否则两次压缩之间前缀漂移=缓存击穿。
// 硬上限须始终 > reminder/anchor skill 教她的自维护软限(300 行或 20KB,见
// core_memory_pressure_reminder.md + xiaoni-memory-anchor SKILL.md);两边一起调,别单改。
// 长期容量靠层级而非 cap:顶层日记目录只保**最近 7 天**的按天行(滚动窗口,
// commit_memory.py 的 DIARY_INDEX_RECENT_DAYS 机械验收),更早的按月搬进
// INDEX-<YYYY-MM>.md 子索引、顶层留一行指路——顶层因此恒定在 ~3KB,永远汇不满,
// 25KB 是安全网不是设计容量。为什么是滚动窗口而不是"撑满再搬":撑满要 ~4 个月,
// 她第一次面对搬家规矩时那条规矩早不在眼前;每次搬一两行才留得住。
export const DIARY_INDEX_SNAPSHOT_MAX_BYTES = 25600;
// 人物菜单快照(<xiaoni_people>)同款 cap;人数增长远慢于日子,天然远小于此。
export const PEOPLE_INDEX_SNAPSHOT_MAX_BYTES = 25600;

// 展示端全有或全无:放得下就原样,放不下整块换成一句指引——永不显示"部分菜单"。
// 为什么不裁行:人物菜单按重要性排(裁哪头都错),且部分菜单会被她读成"没在菜单上的
// 人=不认识/不重要",恰好复刻忘 CC 的事故。注意:commit_memory.py 只**验收并拒收**
// (超限/超窗时把该搬哪些行、搬去哪个文件打给她),它不会替她搬——脚本自动搬家当初被
// 否掉了(搬家是她自己的活)。所以没有机械保证的不变式,只有"她按退回提示理好"+这里
// 这道显示兜底;真到了显示不下,整块换指引比显示半张菜单安全。
// NUL(\u0000)必须剥掉:她用 shell 自己维护这个文件,一个混入的 NUL 会让 PG text 列拒写,
// 而快照和近况在同一个原子提交里——不剥就是可自伤的压缩永久卡死(fork 失败→重试→再读同一文件)。
const INDEX_OVERFLOW_NOTICE_FALLBACK = '(这份菜单超过了上限,这里显示不下——先用 exec 看菜单文件全文,按锚点 skill 的规矩整理;整理完,下次整理记忆后这里就恢复)';

function buildIndexOverflowNotice(sourcePath: string): string {
  return `(这份菜单超过了上限,这里显示不下——先用 exec 看 ${sourcePath} 全文,按锚点 skill 的规矩整理;整理完,下次整理记忆后这里就恢复)`;
}

export function clampDiaryIndexSnapshot(raw: string, maxBytes: number = DIARY_INDEX_SNAPSHOT_MAX_BYTES, overflowNotice: string = INDEX_OVERFLOW_NOTICE_FALLBACK): string | null {
  const trimmed = typeof raw === 'string' ? sanitizeMemoryText(raw) : '';
  if (!trimmed) {
    return null;
  }
  if (Buffer.byteLength(trimmed, 'utf8') <= maxBytes) {
    return trimmed;
  }
  return overflowNotice;
}

// 路径在调用时解析(而非模块加载时),测试可用 XIAONI_DIARY_INDEX_PATH 指向受控路径。
export async function readDiaryIndexSnapshot(indexPath?: string): Promise<string | null | undefined> {
  const resolvedPath = indexPath || process.env.XIAONI_DIARY_INDEX_PATH || '/xiaoni-runtime/notes/diary/INDEX.md';
  try {
    const raw = await fsReadFile(resolvedPath, 'utf8');
    return clampDiaryIndexSnapshot(raw, DIARY_INDEX_SNAPSHOT_MAX_BYTES, buildIndexOverflowNotice(resolvedPath));
  } catch (error) {
    // 读失败 ≠ 她清空了菜单:返回 undefined(「不知道」),提交层保留库里上一份好快照——
    // 挂载错位(sudo 无 HOME 挂空目录)这类瞬时故障绝不许把好快照覆盖成 null。
    const code = (error as NodeJS.ErrnoException)?.code ?? 'unknown';
    moduleLogger.warn('diary index snapshot read failed; keeping previous snapshot', { path: resolvedPath, code });
    return undefined;
  }
}

// 人物菜单快照:与日记快照同帧读、同原子提交、同 clamp(共享 NUL 剥离/截断标记)。
export async function readPeopleIndexSnapshot(indexPath?: string): Promise<string | null | undefined> {
  const resolvedPath = indexPath || process.env.XIAONI_PEOPLE_INDEX_PATH || '/xiaoni-runtime/notes/people/INDEX.md';
  try {
    const raw = await fsReadFile(resolvedPath, 'utf8');
    return clampDiaryIndexSnapshot(raw, PEOPLE_INDEX_SNAPSHOT_MAX_BYTES, buildIndexOverflowNotice(resolvedPath));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code ?? 'unknown';
    moduleLogger.warn('people index snapshot read failed; keeping previous snapshot', { path: resolvedPath, code });
    return undefined;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 日记可导航性:引擎接管的两件纯机械活(T3 月索引降级 + T4 日内小节目录)
// ════════════════════════════════════════════════════════════════════════════
//
// 为什么引擎做而不是继续教她做:实测(2026-07-27,notes/diary/ 24 个日期文件)——
//   · **补行**是她做得最好的:顶层最近几天全在、写得很满。
//   · **搬行**是她唯一做不到的:INDEX-2026-07.md 整月只有 2 行 395 字节,
//     24 天里 19 天(07-04..07-22)在任何索引里都不存在 —— 那些日子等于不可寻址。
//   · 日文件 40–93KB、每天 58–116 条 `## 条目`、**零内部目录**:找旧事只能整份 cat,
//     一天就吃掉几万 token,所以"哪天"知道了也navigate不进去。
// 两件都是零判断、零行为依赖、覆盖 100% 的日记,所以从 prompt 搬进引擎。
// 教她搬家的那套话(commit_memory.py `_stale_day_line_violation` 的退回提示)保持原样:
// 它现在是**验收**,引擎先搬完,她那边自然就没有超窗行可退回。
//
// ── fail-open(最重要)────────────────────────────────────────────────────────
// 这两个函数挂在 commitCoreMemoryCompression 的原子提交帧上,和
// readDiaryIndexSnapshot 一模一样的形状:整体包 try/catch,异常只 warn,**绝不上抛**。
// 原因:hard-cap 轮次上限 兜底提交走的是同一个 commitCoreMemoryCompression。异常逃出去
// 会同时废掉正常提交和兜底提交 → read_cutoff 永不前移 → 上下文只涨不降 → 撞 30MiB
// 硬线 → 压缩永久卡死。文件整理失败的代价只是"这轮没整理",绝不许升级成压缩死锁。
//
// ── 缓存面 ────────────────────────────────────────────────────────────────
// 两件都不产出任何进 LLM 请求的字节。唯一的间接影响是 T3 会改 INDEX.md,而
// <xiaoni_diary_index> 读的就是它 —— 所以 T3 必须排在同一帧的 readDiaryIndexSnapshot
// **之前**:同一帧换血,冻结进库的是搬完之后那份,两次压缩之间照旧字节不变。
// T4 的产物谁也不读进请求,顺序无关。

// 顶层日记目录的滚动窗口天数,与 commit_memory.py 的 DIARY_INDEX_RECENT_DAYS 同调。
export const DIARY_INDEX_RECENT_DAYS = 7;
// 纯机械判定:只认行首的 ISO 日期,不看内容。月行(- YYYY-MM | …)天然不匹配。
const DIARY_INDEX_DAY_LINE_RE = /^\s*-\s*(\d{4})-(\d{2})-(\d{2})(?![0-9-])/;
// 月行:`- YYYY-MM` 后面**不是**再一个 `-`,所以按天行不会被当成月行。
const DIARY_INDEX_MONTH_ROW_RE = /^\s*-\s*(\d{4})-(\d{2})(?![0-9-])/;
// 只认严格的 YYYY-MM-DD.md;2026-07-07-summary.md / 2026-07-09-short.md 这类她自己
// 的旁支文件不参与"这天有没有行"的判定,也不生成小节目录。
const DIARY_DAY_FILE_RE = /^(\d{4})-(\d{2})-(\d{2})\.md$/;
// 回填行的出处标记。为什么每行都要标:①诚实——这句不是她写的,是引擎从她当天日记里
// 取的第一句原话;②可替换——等她自己那行(顶层写的)滚出 7 天窗口搬下来时,引擎认得出
// "这个日期现在占位的是回填行"从而让位给她的原话,而不是当成重复行丢掉。
const DIARY_ENGINE_BACKFILL_MARK = '（引擎回填）';
const DIARY_BACKFILL_NOTICE = '> 标了（引擎回填）的行,是引擎从那天日记里取的第一句原话补上的——在此之前这些日子在任何索引里都不存在。想换成自己的话直接改,把（引擎回填）去掉就行,引擎不会再动它。';
// 顶层索引超过 1MB = 已经不是索引了(她可能误把日记 cat 进去)。跳过留痕,不猜。
const DIARY_INDEX_MAX_BYTES = 1024 * 1024;
// 单份日记的解析上限。93KB 是实测最大值,8MB 留了两个数量级余量;超了跳过那一份。
const DIARY_DAY_FILE_MAX_BYTES = 8 * 1024 * 1024;
// 回填的"一句话"截断长度。截断是机械的,不是改写:超长只在尾部加省略号。
const DIARY_ONE_LINE_MAX_CHARS = 120;
const EAST8_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface DiaryIndexMaintenanceResult {
  ok: boolean;
  skippedReason?: string;
  indexPath: string;
  /** 从顶层搬进月索引的按天行数(原样搬,一个字都不改写)。 */
  movedDayLines: number;
  /** 顶层新加的月指路行(`- YYYY-MM | …（细目在 INDEX-YYYY-MM.md）`)。 */
  monthRowsAdded: string[];
  /** 引擎回填的日期(两边都没有行、从当天日记取到了第一句原话)。 */
  backfilledDates: string[];
  /** 有日记文件但取不到任何可用原话 → 不编内容,跳过并留痕。 */
  backfillSkippedDates: string[];
  monthFilesWritten: string[];
  monthFilesFailed: string[];
  topLevelRewritten: boolean;
}

export interface DiaryHeadingManifestResult {
  ok: boolean;
  skippedReason?: string;
  manifestDir: string;
  scannedDates: number;
  writtenDates: string[];
  /** 内容没变 → 不重生成(增量)。 */
  unchangedDates: string[];
  /** 解析/读取失败的那一份 → 跳过并留痕,不影响别的日期。 */
  skippedDates: string[];
}

// 日期口径跟日记文件名一致:**北京日期**,别用容器本地时区(容器是 UTC,凌晨会差一天)。
// 做法照 commit_memory.py 的 timezone(timedelta(hours=8)):先平移 8 小时,再读 UTC 字段。
function east8DayNumber(now: Date): number {
  const shifted = new Date(now.getTime() + EAST8_OFFSET_MS);
  return Math.floor(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) / 86400000);
}

// 严格校验:2026-13-45 这种写错的日期返回 null(Date.UTC 会静默归一化成别的日子)。
function toDayNumber(year: number, month: number, day: number): number | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() + 1 !== month || back.getUTCDate() !== day) {
    return null;
  }
  return Math.floor(ms / 86400000);
}

function dayNumberToIso(dayNumber: number): string {
  const date = new Date(dayNumber * 86400000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveDiaryDir(explicit?: string): string {
  if (explicit) {
    return explicit;
  }
  // 复用 XIAONI_DIARY_INDEX_PATH 的目录:现有用例把它钉到不存在的路径时,这两件活
  // 自动跟着指向不存在的目录 → 走 fail-open 静默跳过,不会去碰宿主机真目录。
  const indexPath = process.env.XIAONI_DIARY_INDEX_PATH;
  if (indexPath) {
    return nodePath.dirname(indexPath);
  }
  return `${(process.env.XIAONI_RUNTIME_ROOT || '/xiaoni-runtime').replace(/\/+$/, '')}/notes/diary`;
}

function resolveDiaryManifestDir(explicit?: string): string {
  if (explicit) {
    return explicit;
  }
  if (process.env.XIAONI_DIARY_MANIFEST_DIR) {
    return process.env.XIAONI_DIARY_MANIFEST_DIR;
  }
  // 产物**不放进 notes/diary/**:那个目录是被动召回腿的语料源
  // (xiaoni-recall-reindex-service 的 PALACE_DIRS = ['notes/diary'],扁平一层扫所有
  // .md)。目录清单放进去会被切块嵌入,污染召回语料——目录行是脚手架不是经历。
  // 放同级兄弟目录:reindex 不递归、也不认这个名字,结构上不可能被扫到。
  return `${nodePath.dirname(resolveDiaryDir())}/diary-manifest`;
}

// mkdir -p + tmp + rename。内容没变就不写:避免无意义的 mtime churn(T4 的增量判定
// 依赖源文件 mtime,顶层/月索引的 mtime 也是她排查时的线索)。返回是否真的写了。
async function writeFileAtomicIfChanged(filePath: string, content: string): Promise<boolean> {
  let existing: string | null = null;
  try {
    existing = await fsReadFile(filePath, 'utf8');
  } catch {
    existing = null;
  }
  if (existing === content) {
    return false;
  }
  await fsMkdir(nodePath.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fsWriteFile(tmpPath, content, 'utf8');
  try {
    await fsRename(tmpPath, filePath);
  } catch (error) {
    try {
      await fsRm(tmpPath, { force: true });
    } catch {
      // 清不掉临时文件不算失败。
    }
    throw error;
  }
  return true;
}

function normalizeDiaryOneLine(raw: string): string {
  // sanitizeMemoryText 顺手剥 NUL 和 <xiaoni_*> 标签:回填行进的是月索引(不进请求前缀),
  // 但同目录的文件都可能被她 cat 进别处,标签注入面统一按同一套剥。
  const cleaned = sanitizeMemoryText(String(raw ?? ''))
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/#+\s*$/, '')
    .trim();
  if (cleaned.length <= DIARY_ONE_LINE_MAX_CHARS) {
    return cleaned;
  }
  return `${cleaned.slice(0, DIARY_ONE_LINE_MAX_CHARS - 1)}…`;
}

// 只有日期、没有信息量的标题(`# 2026-07-10`、`# 7月4号`)当没取到,继续往下找。
// 这不是"判断内容好坏",是机械去重:回填行的行首已经是那个日期了。
const DIARY_BARE_DATE_LINE_RE = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*[号日]?|\d{1,2}\s*\/\s*\d{1,2})$/;

/**
 * 从一份日记里取"那天的一句话"——**全部是她自己的原话**,引擎不编。
 * 优先级:第一个 `## 标题` → 第一个 `# 标题` → 第一句正文。都没有 → null(跳过,不回填)。
 * 真实存在的空标题文件:2026-07-04.md / 2026-07-10.md(伞状老格式,零 `##`)。
 */
function extractDiaryOneLine(fileText: string): string | null {
  const lines = fileText.split('\n');
  const candidates: string[] = [];
  let firstH2: string | null = null;
  let firstH1: string | null = null;
  let firstBody: string | null = null;
  for (const line of lines) {
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2 && firstH2 === null) {
      firstH2 = h2[1];
      continue;
    }
    const h1 = /^#\s+(.*)$/.exec(line);
    if (h1 && firstH1 === null) {
      firstH1 = h1[1];
      continue;
    }
    if (firstBody === null && line.trim() && !line.trimStart().startsWith('#')) {
      firstBody = line;
    }
  }
  if (firstH2 !== null) {
    candidates.push(firstH2);
  }
  if (firstH1 !== null) {
    candidates.push(firstH1);
  }
  if (firstBody !== null) {
    candidates.push(firstBody);
  }
  for (const candidate of candidates) {
    const normalized = normalizeDiaryOneLine(candidate);
    if (!normalized || DIARY_BARE_DATE_LINE_RE.test(normalized)) {
      continue;
    }
    return normalized;
  }
  return null;
}

type MonthIndexEntry = { iso: string; raw: string; engineBackfilled: boolean };

function isEngineBackfilledLine(raw: string): boolean {
  return raw.trimEnd().endsWith(DIARY_ENGINE_BACKFILL_MARK);
}

function insertBackfillNotice(lines: string[]): string[] {
  if (lines.some((line) => line.trim() === DIARY_BACKFILL_NOTICE)) {
    return lines;
  }
  const next = [...lines];
  const headingAt = next.findIndex((line) => line.trimStart().startsWith('#'));
  if (headingAt >= 0) {
    next.splice(headingAt + 1, 0, '', DIARY_BACKFILL_NOTICE);
  } else {
    next.splice(0, 0, DIARY_BACKFILL_NOTICE, '');
  }
  return next;
}

/**
 * 把搬来的行 + 回填的行并进 `INDEX-<YYYY-MM>.md`。
 * · 搬来的行**原样**(她写的字节),只在这一份里按日期升序排。
 * · 同一天已经有她自己的行 → 跳过(她的赢,先写先占);已经有的是引擎回填行 → 让位替换。
 * · 按天行之间夹了别的内容(她自己加了小标题/注释) → 不重排,纯追加,绝不动她的结构。
 * · 幂等:第二遍所有日期都已存在 → 生成的内容与磁盘逐字节相同 → 不写。
 */
function mergeMonthIndexContent(params: {
  month: string;
  existing: string | null;
  movedLines: Array<{ iso: string; raw: string }>;
  backfillLines: Array<{ iso: string; raw: string }>;
}): string {
  const existingLines = params.existing === null
    ? [`# ${params.month} 日记月索引`, '']
    : params.existing.replace(/\n+$/, '').split('\n');

  const dayLineIndexes: number[] = [];
  existingLines.forEach((line, index) => {
    if (DIARY_INDEX_DAY_LINE_RE.test(line)) {
      dayLineIndexes.push(index);
    }
  });

  const parseIso = (raw: string): string | null => {
    const matched = DIARY_INDEX_DAY_LINE_RE.exec(raw);
    if (!matched) {
      return null;
    }
    return toDayNumber(Number(matched[1]), Number(matched[2]), Number(matched[3])) === null
      ? null
      : `${matched[1]}-${matched[2]}-${matched[3]}`;
  };

  const firstDay = dayLineIndexes.length > 0 ? dayLineIndexes[0] : -1;
  const lastDay = dayLineIndexes.length > 0 ? dayLineIndexes[dayLineIndexes.length - 1] : -1;
  const interleaved = firstDay >= 0 && (lastDay - firstDay + 1) !== dayLineIndexes.length;

  let addedBackfill = false;

  if (interleaved) {
    // 保守路径:她在按天行之间插了东西,重排会打乱她的结构 → 只在末尾追加缺的行。
    const present = new Set<string>();
    for (const index of dayLineIndexes) {
      const iso = parseIso(existingLines[index]);
      if (iso) {
        present.add(iso);
      }
    }
    const appended: string[] = [];
    for (const entry of [...params.movedLines].sort((a, b) => a.iso.localeCompare(b.iso))) {
      if (present.has(entry.iso)) {
        continue;
      }
      present.add(entry.iso);
      appended.push(entry.raw);
    }
    for (const entry of [...params.backfillLines].sort((a, b) => a.iso.localeCompare(b.iso))) {
      if (present.has(entry.iso)) {
        continue;
      }
      present.add(entry.iso);
      appended.push(entry.raw);
      addedBackfill = true;
    }
    let out = [...existingLines, ...appended];
    if (addedBackfill || out.some((line) => isEngineBackfilledLine(line) && DIARY_INDEX_DAY_LINE_RE.test(line))) {
      out = insertBackfillNotice(out);
    }
    return `${out.join('\n').replace(/\n+$/, '')}\n`;
  }

  const preamble = firstDay >= 0 ? existingLines.slice(0, firstDay) : existingLines;
  const epilogue = firstDay >= 0 ? existingLines.slice(lastDay + 1) : [];
  const entries = new Map<string, MonthIndexEntry>();
  const unparsedDayLines: string[] = [];
  for (const index of dayLineIndexes) {
    const raw = existingLines[index];
    const iso = parseIso(raw);
    if (!iso) {
      unparsedDayLines.push(raw); // 日期写错的行:原样留着,交给她自己看,引擎不动
      continue;
    }
    if (!entries.has(iso)) {
      entries.set(iso, { iso, raw, engineBackfilled: isEngineBackfilledLine(raw) });
    }
  }

  for (const entry of params.movedLines) {
    const existingEntry = entries.get(entry.iso);
    if (existingEntry && !existingEntry.engineBackfilled) {
      continue; // 她自己写过这天 → 她的赢
    }
    // 没有,或者占位的是引擎回填行 → 用她原样搬下来的这行(替换回填占位)
    entries.set(entry.iso, { iso: entry.iso, raw: entry.raw, engineBackfilled: false });
  }
  for (const entry of params.backfillLines) {
    if (entries.has(entry.iso)) {
      continue;
    }
    entries.set(entry.iso, { iso: entry.iso, raw: entry.raw, engineBackfilled: true });
    addedBackfill = true;
  }

  const sorted = [...entries.values()].sort((a, b) => a.iso.localeCompare(b.iso));
  let out = [
    ...preamble,
    ...unparsedDayLines,
    ...sorted.map((entry) => entry.raw),
    ...epilogue
  ];
  if (addedBackfill || sorted.some((entry) => entry.engineBackfilled)) {
    out = insertBackfillNotice(out);
  }
  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

/**
 * **T3** — 引擎接管日记索引的月降级 + 一次性回填存量。
 *
 * 规则(原来写在 prompt 里教她做):`notes/diary/INDEX.md` 顶层只留最近
 * DIARY_INDEX_RECENT_DAYS 天的按天行;掉出窗口的行**原样搬进**
 * `notes/diary/INDEX-<YYYY-MM>.md`(按行自己的月份,文件不存在就建),顶层给每个搬空的
 * 月留一行 `- YYYY-MM | …（细目在 INDEX-YYYY-MM.md）`。
 *
 * 另外补存量:磁盘上有 `YYYY-MM-DD.md` 但**两边都没有行**的日子,从当天日记里取第一句
 * 原话补一行进月索引(标 `（引擎回填）`),引擎不编内容;取不到就跳过。
 *
 * **绝不抛异常**(挂在压缩提交帧上,见文件顶部 fail-open 注释)。
 */
export async function maintainDiaryIndexHierarchy(options?: {
  diaryDir?: string;
  now?: Date;
  recentDays?: number;
}): Promise<DiaryIndexMaintenanceResult> {
  const diaryDir = resolveDiaryDir(options?.diaryDir);
  const indexPath = nodePath.join(diaryDir, 'INDEX.md');
  const result: DiaryIndexMaintenanceResult = {
    ok: false,
    indexPath,
    movedDayLines: 0,
    monthRowsAdded: [],
    backfilledDates: [],
    backfillSkippedDates: [],
    monthFilesWritten: [],
    monthFilesFailed: [],
    topLevelRewritten: false
  };
  try {
    const recentDays = Math.max(1, options?.recentDays ?? DIARY_INDEX_RECENT_DAYS);
    const todayDayNumber = east8DayNumber(options?.now ?? new Date());
    const oldestKeptDayNumber = todayDayNumber - (recentDays - 1);

    let rawIndex: string;
    try {
      rawIndex = await fsReadFile(indexPath, 'utf8');
    } catch (error) {
      // 读不到 ≠ 出错:目录还没建、挂载错位都走这里。跳过留痕,提交照做。
      const code = (error as NodeJS.ErrnoException)?.code ?? 'unknown';
      moduleLogger.warn('diary index hierarchy skipped: top index unreadable', { path: indexPath, code });
      result.skippedReason = 'top_index_unreadable';
      return result;
    }
    if (Buffer.byteLength(rawIndex, 'utf8') > DIARY_INDEX_MAX_BYTES) {
      moduleLogger.warn('diary index hierarchy skipped: top index too large to be an index', {
        path: indexPath,
        bytes: Buffer.byteLength(rawIndex, 'utf8'),
        maxBytes: DIARY_INDEX_MAX_BYTES
      });
      result.skippedReason = 'top_index_too_large';
      return result;
    }

    const trimmedIndex = rawIndex.replace(/\n+$/, '');
    // 空文件 → 零行(而不是一行 ''),否则后面 join 会在开头留一个空行。
    const topLines = trimmedIndex === '' ? [] : trimmedIndex.split('\n');
    type TopEntry = { raw: string; iso: string | null; dayNumber: number | null };
    const topEntries: TopEntry[] = [];
    const topDates = new Set<string>();
    const topMonthRows = new Set<string>();
    for (const raw of topLines) {
      const dayMatch = DIARY_INDEX_DAY_LINE_RE.exec(raw);
      if (dayMatch) {
        const dayNumber = toDayNumber(Number(dayMatch[1]), Number(dayMatch[2]), Number(dayMatch[3]));
        if (dayNumber === null) {
          // critical gap #1:她手改成了非法格式(2026-13-45 这类)。整体**跳过并留痕**,
          // 不抛,也不在一份读不懂的文件上搬家 —— 搬错比不搬贵得多。
          moduleLogger.warn('diary index hierarchy skipped: malformed day line in top index', {
            path: indexPath,
            line: raw.slice(0, 120)
          });
          result.skippedReason = 'top_index_malformed_day_line';
          return result;
        }
        const iso = `${dayMatch[1]}-${dayMatch[2]}-${dayMatch[3]}`;
        topDates.add(iso);
        topEntries.push({ raw, iso, dayNumber });
        continue;
      }
      const monthMatch = DIARY_INDEX_MONTH_ROW_RE.exec(raw);
      if (monthMatch) {
        topMonthRows.add(`${monthMatch[1]}-${monthMatch[2]}`);
      }
      topEntries.push({ raw, iso: null, dayNumber: null });
    }

    // ── 1) 该搬的行:掉出滚动窗口的按天行,按行自己的月份分组 ──
    const movesByMonth = new Map<string, Array<{ iso: string; raw: string }>>();
    const demotedRawLines = new Set<string>();
    for (const entry of topEntries) {
      if (entry.dayNumber === null || entry.iso === null || entry.dayNumber >= oldestKeptDayNumber) {
        continue;
      }
      const month = entry.iso.slice(0, 7);
      const bucket = movesByMonth.get(month) ?? [];
      bucket.push({ iso: entry.iso, raw: entry.raw });
      movesByMonth.set(month, bucket);
      demotedRawLines.add(entry.raw);
    }

    // ── 2) 该回填的日子:磁盘上有 YYYY-MM-DD.md,但顶层没有它的行 ──
    let dayFileNames: string[] = [];
    try {
      dayFileNames = await fsReaddir(diaryDir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code ?? 'unknown';
      moduleLogger.warn('diary index hierarchy: diary dir unreadable, backfill skipped', { path: diaryDir, code });
      dayFileNames = [];
    }
    const backfillCandidatesByMonth = new Map<string, string[]>();
    for (const name of dayFileNames.sort()) {
      const matched = DIARY_DAY_FILE_RE.exec(name);
      if (!matched) {
        continue;
      }
      if (toDayNumber(Number(matched[1]), Number(matched[2]), Number(matched[3])) === null) {
        continue;
      }
      const iso = `${matched[1]}-${matched[2]}-${matched[3]}`;
      if (topDates.has(iso)) {
        continue; // 顶层有她自己的行了,不插手
      }
      const month = iso.slice(0, 7);
      const bucket = backfillCandidatesByMonth.get(month) ?? [];
      bucket.push(iso);
      backfillCandidatesByMonth.set(month, bucket);
    }

    // ── 3) 先写月索引,再改顶层:只有月索引写成功的月份才允许从顶层摘行 ──
    // 顺序反了就会丢行(顶层删了、月索引没写进去)。
    const months = [...new Set([...movesByMonth.keys(), ...backfillCandidatesByMonth.keys()])].sort();
    const committedMonths = new Set<string>();
    // 月索引里确实有按天细目的月份 → 顶层该有一行指路。用"有内容"而不是"这轮写过",
    // 否则"往一个已经完整的月索引里搬行"会摘掉顶层却不留指路行(那些日子就无从下手了)。
    const monthsWithDetail = new Set<string>();
    for (const month of months) {
      const monthPath = nodePath.join(diaryDir, `INDEX-${month}.md`);
      let existing: string | null = null;
      try {
        existing = await fsReadFile(monthPath, 'utf8');
      } catch {
        existing = null; // 不存在就建
      }

      const existingDates = new Set<string>();
      if (existing !== null) {
        for (const line of existing.split('\n')) {
          const matched = DIARY_INDEX_DAY_LINE_RE.exec(line);
          if (matched && toDayNumber(Number(matched[1]), Number(matched[2]), Number(matched[3])) !== null) {
            existingDates.add(`${matched[1]}-${matched[2]}-${matched[3]}`);
          }
        }
      }

      const backfillLines: Array<{ iso: string; raw: string }> = [];
      const pendingBackfilled: string[] = [];
      const pendingBackfillSkipped: string[] = [];
      for (const iso of backfillCandidatesByMonth.get(month) ?? []) {
        if (existingDates.has(iso)) {
          continue; // 幂等:月索引里已经有这天了(她写的或上一轮回填的)
        }
        const dayPath = nodePath.join(diaryDir, `${iso}.md`);
        let oneLine: string | null = null;
        try {
          const stat = await fsStat(dayPath);
          if (stat.size > DIARY_DAY_FILE_MAX_BYTES) {
            // critical gap #2:超大日文件 → 跳过那一份并留痕,不抛。
            moduleLogger.warn('diary index backfill skipped one day: file too large', {
              path: dayPath,
              bytes: stat.size,
              maxBytes: DIARY_DAY_FILE_MAX_BYTES
            });
            pendingBackfillSkipped.push(iso);
            continue;
          }
          oneLine = extractDiaryOneLine(await fsReadFile(dayPath, 'utf8'));
        } catch (error) {
          // critical gap #2:编码/权限/瞬时读失败 → 跳过那一份并留痕,不抛。
          const code = (error as NodeJS.ErrnoException)?.code ?? 'unknown';
          moduleLogger.warn('diary index backfill skipped one day: unreadable', { path: dayPath, code });
          pendingBackfillSkipped.push(iso);
          continue;
        }
        if (!oneLine) {
          // 取不到任何原话(真实存在:2026-07-04.md / 2026-07-10.md 零 `##`)→ 不编内容。
          moduleLogger.warn('diary index backfill skipped one day: no usable first line', { path: dayPath });
          pendingBackfillSkipped.push(iso);
          continue;
        }
        backfillLines.push({ iso, raw: `- ${iso} | ${oneLine}${DIARY_ENGINE_BACKFILL_MARK}` });
        pendingBackfilled.push(iso);
      }

      const movedLines = movesByMonth.get(month) ?? [];
      if (existingDates.size > 0 || movedLines.length > 0 || backfillLines.length > 0) {
        monthsWithDetail.add(month);
      }
      if (movedLines.length === 0 && backfillLines.length === 0) {
        committedMonths.add(month); // 没活可干也算"这个月已就绪"
        result.backfillSkippedDates.push(...pendingBackfillSkipped);
        continue;
      }

      const merged = mergeMonthIndexContent({ month, existing, movedLines, backfillLines });
      try {
        const wrote = await writeFileAtomicIfChanged(monthPath, merged);
        if (wrote) {
          result.monthFilesWritten.push(monthPath);
        }
        committedMonths.add(month);
        result.backfilledDates.push(...pendingBackfilled);
        result.backfillSkippedDates.push(...pendingBackfillSkipped);
      } catch (error) {
        // 这个月写失败 → 不从顶层摘它的行(宁可下次再搬,绝不丢行)。
        moduleLogger.warn('diary index hierarchy: month index write failed, keeping top-level rows', {
          path: monthPath,
          error: error instanceof Error ? error.message : String(error)
        });
        result.monthFilesFailed.push(monthPath);
      }
    }

    // ── 4) 顶层:摘掉已落月索引的超窗行 + 给搬空的月补一行指路 ──
    const keptTopLines: string[] = [];
    let lastAnchorIndex = -1;
    for (const entry of topEntries) {
      const month = entry.iso ? entry.iso.slice(0, 7) : null;
      const demote = entry.dayNumber !== null
        && entry.dayNumber < oldestKeptDayNumber
        && month !== null
        && committedMonths.has(month);
      if (demote) {
        result.movedDayLines += 1;
        continue;
      }
      keptTopLines.push(entry.raw);
      if (entry.dayNumber !== null || DIARY_INDEX_MONTH_ROW_RE.test(entry.raw)) {
        lastAnchorIndex = keptTopLines.length - 1;
      }
    }
    const newMonthRows: string[] = [];
    for (const month of months) {
      if (!committedMonths.has(month) || topMonthRows.has(month) || !monthsWithDetail.has(month)) {
        continue;
      }
      // "那个月的一句话"是她的活,引擎不编:留一个明摆着的空位,她一眼看得见。
      newMonthRows.push(`- ${month} | （这个月的一句话还没写）（细目在 INDEX-${month}.md）`);
    }
    if (newMonthRows.length > 0) {
      const insertAt = lastAnchorIndex >= 0 ? lastAnchorIndex + 1 : keptTopLines.length;
      keptTopLines.splice(insertAt, 0, ...newMonthRows);
      result.monthRowsAdded.push(...newMonthRows);
    }

    if (result.movedDayLines > 0 || newMonthRows.length > 0) {
      const nextTop = `${keptTopLines.join('\n').replace(/\n+$/, '')}\n`;
      try {
        result.topLevelRewritten = await writeFileAtomicIfChanged(indexPath, nextTop);
      } catch (error) {
        // 顶层写失败:月索引已经有那些行了(搬家不是删),下一轮再摘。不抛。
        moduleLogger.warn('diary index hierarchy: top index write failed', {
          path: indexPath,
          error: error instanceof Error ? error.message : String(error)
        });
        result.skippedReason = 'top_index_write_failed';
        result.movedDayLines = 0;
        result.monthRowsAdded = [];
      }
    }

    result.ok = true;
    if (
      result.movedDayLines > 0
      || result.backfilledDates.length > 0
      || result.monthRowsAdded.length > 0
      || result.backfillSkippedDates.length > 0
    ) {
      moduleLogger.info('diary index hierarchy maintained', {
        indexPath,
        movedDayLines: result.movedDayLines,
        monthRowsAdded: result.monthRowsAdded.length,
        backfilledDates: result.backfilledDates,
        backfillSkippedDates: result.backfillSkippedDates,
        monthFilesWritten: result.monthFilesWritten,
        monthFilesFailed: result.monthFilesFailed
      });
    }
    return result;
  } catch (error) {
    // 兜底:任何漏网异常都在这里停住。压缩提交绝不因为整理文件失败而失败。
    moduleLogger.warn('diary index hierarchy maintenance failed (fail-open, commit proceeds)', {
      indexPath,
      error: error instanceof Error ? error.message : String(error)
    });
    result.ok = false;
    result.skippedReason = result.skippedReason ?? 'unexpected_error';
    return result;
  }
}

function buildDiaryHeadingManifest(params: {
  iso: string;
  diaryPath: string;
  fileText: string;
  sourceBytes: number;
  sourceMtimeMs: number;
}): string {
  const lines = params.fileText.split('\n');
  const totalLines = params.fileText.endsWith('\n') ? lines.length - 1 : lines.length;
  const headings: Array<{ line: number; text: string }> = [];
  lines.forEach((line, index) => {
    const matched = /^##\s+(.*)$/.exec(line);
    if (!matched) {
      return;
    }
    const text = normalizeDiaryOneLine(matched[1]);
    headings.push({ line: index + 1, text: text || '(空标题)' });
  });

  const out: string[] = [];
  out.push(`# ${params.iso} 日记小节目录（引擎生成，别手改：每次整理记忆会按日记重生成）`);
  // 增量判定的机器可读锚:源文件字节数 + mtime 一致就整份跳过,不重读不重算。
  out.push(`<!-- source bytes=${params.sourceBytes} mtime=${Math.floor(params.sourceMtimeMs)} -->`);
  out.push('');
  out.push(`源文件 ${params.diaryPath}：${totalLines} 行，${headings.length} 个小节。`);
  if (headings.length === 0) {
    // 真实存在:2026-07-04.md / 2026-07-10.md 只有顶层 `#`,零 `##`(伞状老格式)。
    out.push('');
    out.push(`这一天没有 ## 小节，整份直接读：cat ${params.diaryPath}`);
    return `${out.join('\n')}\n`;
  }
  out.push(`取某一段：sed -n '起,止p' ${params.diaryPath}`);
  out.push('');
  for (let index = 0; index < headings.length; index += 1) {
    const start = headings[index].line;
    const end = index + 1 < headings.length ? headings[index + 1].line - 1 : Math.max(totalLines, start);
    out.push(`- ${start}-${end} | ${headings[index].text}`);
  }
  return `${out.join('\n')}\n`;
}

/**
 * **T4** — 为每份日记生成一份日内小节目录(heading manifest)。
 *
 * 为什么:日文件 40–93KB / 58–116 条 `## 条目` / 零内部目录 —— 知道"是哪天"也 navigate
 * 不进去,只能整份 cat。目录让她先看一屏标题,再 `sed -n '起,止p'` 取那一段。
 *
 * 产物在 `notes/diary-manifest/<YYYY-MM-DD>.md`(**不在** notes/diary/ 里:那是被动召回
 * 腿的语料源,目录行是脚手架,进去会污染召回)。
 *
 * 增量:源文件 bytes+mtime 与目录里记的锚一致 → 整份跳过;内容重算后与磁盘相同也不写。
 * **绝不抛异常**(挂在压缩提交帧上,见文件顶部 fail-open 注释)。
 */
export async function writeDiaryHeadingManifests(options?: {
  diaryDir?: string;
  manifestDir?: string;
}): Promise<DiaryHeadingManifestResult> {
  const diaryDir = resolveDiaryDir(options?.diaryDir);
  const manifestDir = resolveDiaryManifestDir(options?.manifestDir);
  const result: DiaryHeadingManifestResult = {
    ok: false,
    manifestDir,
    scannedDates: 0,
    writtenDates: [],
    unchangedDates: [],
    skippedDates: []
  };
  try {
    let names: string[];
    try {
      names = await fsReaddir(diaryDir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code ?? 'unknown';
      moduleLogger.warn('diary heading manifests skipped: diary dir unreadable', { path: diaryDir, code });
      result.skippedReason = 'diary_dir_unreadable';
      return result;
    }

    for (const name of names.sort()) {
      const matched = DIARY_DAY_FILE_RE.exec(name);
      if (!matched) {
        continue;
      }
      if (toDayNumber(Number(matched[1]), Number(matched[2]), Number(matched[3])) === null) {
        continue;
      }
      const iso = `${matched[1]}-${matched[2]}-${matched[3]}`;
      const diaryPath = nodePath.join(diaryDir, name);
      const manifestPath = nodePath.join(manifestDir, `${iso}.md`);
      result.scannedDates += 1;
      try {
        const stat = await fsStat(diaryPath);
        if (!stat.isFile()) {
          continue;
        }
        if (stat.size > DIARY_DAY_FILE_MAX_BYTES) {
          moduleLogger.warn('diary heading manifest skipped one day: file too large', {
            path: diaryPath,
            bytes: stat.size,
            maxBytes: DIARY_DAY_FILE_MAX_BYTES
          });
          result.skippedDates.push(iso);
          continue;
        }
        // 增量第一道:锚一致 → 连源文件都不读。
        const anchor = `<!-- source bytes=${stat.size} mtime=${Math.floor(stat.mtimeMs)} -->`;
        let existingManifest: string | null = null;
        try {
          existingManifest = await fsReadFile(manifestPath, 'utf8');
        } catch {
          existingManifest = null;
        }
        if (existingManifest !== null && existingManifest.includes(anchor)) {
          result.unchangedDates.push(iso);
          continue;
        }
        const fileText = await fsReadFile(diaryPath, 'utf8');
        const manifest = buildDiaryHeadingManifest({
          iso,
          diaryPath,
          fileText,
          sourceBytes: stat.size,
          sourceMtimeMs: stat.mtimeMs
        });
        // 增量第二道:重算后与磁盘逐字节相同 → 不写(不制造 mtime churn)。
        const wrote = await writeFileAtomicIfChanged(manifestPath, manifest);
        if (wrote) {
          result.writtenDates.push(iso);
        } else {
          result.unchangedDates.push(iso);
        }
      } catch (error) {
        // 单份失败只跳过这一份,别的日期照做,整体不抛。
        moduleLogger.warn('diary heading manifest skipped one day', {
          path: diaryPath,
          error: error instanceof Error ? error.message : String(error)
        });
        result.skippedDates.push(iso);
      }
    }

    result.ok = true;
    if (result.writtenDates.length > 0 || result.skippedDates.length > 0) {
      moduleLogger.info('diary heading manifests refreshed', {
        manifestDir,
        scannedDates: result.scannedDates,
        writtenDates: result.writtenDates,
        skippedDates: result.skippedDates,
        unchangedCount: result.unchangedDates.length
      });
    }
    return result;
  } catch (error) {
    moduleLogger.warn('diary heading manifests failed (fail-open, commit proceeds)', {
      manifestDir,
      error: error instanceof Error ? error.message : String(error)
    });
    result.ok = false;
    result.skippedReason = result.skippedReason ?? 'unexpected_error';
    return result;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 专题物化(L1 日记 → L3 线):两段式 —— 算在事务内,写在事务后
// ════════════════════════════════════════════════════════════════════════════
//
// 为什么引擎做:教她自己开 `topic-<主题>.md` 并按章续写,实测 14 天零文件。压缩帧里她只
// 看得见今天,"这是不是连着好几天的事"需要已经被压掉的记忆;而且她被 fork 轮次预算追着。所以
// 专题从「她的写作产物」改成「引擎从日记物化出来的聚合视图」——她的动作只剩一件:在
// `open-loops.md` 行末打一个 `#标签`。
//
// ── 为什么落 notes/topics/ 而不是 notes/diary/ ──────────────────────────────
// 实测(同一件事的两份拷贝占满浮现槽位的比例):
//   notes/diary/ + 现行冷却  155/155 = 100%
//   notes/diary/ + P0 修好后 5.2%
//   notes/topics/            0
// 原因:`notes/diary/` 是被动召回腿的语料源,而第三腿把 `/^topic-/i` 认成连载 → 同一件事
// 在日记和专题各一份,ref 不同,冷却集(只装 ref)结构上抓不到。隔离目录是唯一的 0。
//
// ── 为什么信号是「标签」而不是「同名标题复发」────────────────────────────────
// 实测 1347 条日记条目里 1276 个标题**从不重复**(94.5%);跨天命中最多的全是模板词
// (醒来/凌晨/今日总结)。线的身份只能来自她自己给的名字 → open-loops 行末的 `#标签`。
// 标签口径**和写端 memory_write.py 逐条对齐**(charset / 拒纯数字 / 拒 INDEX),口径不
// 一致会让「她打了标签但系统不算」。
//
// ── 两段式:为什么算和写要分开 ────────────────────────────────────────────────
//   【算】在 commitCoreMemoryCompression 的原子提交帧内(紧跟 writeDiaryHeadingManifests、
//         在 readDiaryIndexSnapshot 之前):拿到的是**这一帧冻结的**日记事实。只读不写。
//   【写】在提交之后(onCoreMemoryCompressionCommitted 那一段):落盘失败绝不回滚压缩提交
//         —— 压缩提交是本轮最贵的东西,不能被一次文件写失败拖掉。
//   产物落 notes/topics/,`readDiaryIndexSnapshot` / `readPeopleIndexSnapshot` 都不读它,
//   所以【写】排在提交之后不会让任何进请求前缀的字节漂移。
//
// ── 幂等 + 可中断 ─────────────────────────────────────────────────────────────
// 水位(`agent_session_context_windows.topic_materialization_state`)**只在文件真写成功之
// 后推进**。任何一个标签写失败 → 整批一个字都不落库 → 下一轮拿同一个水位重做同一批;
// 重做不会重复补章,因为落盘前会先把文件里已有的章解析成归一化 key 去重。
// 轮次计数用「该标签命中过的 read_cutoff 值集合的大小」而不是计数器:cutoff 单调递增且
// 每轮唯一,水位没前移、下轮重扫同一段内容时同一个 cutoff 不会被重复计。
//
// ── fail-open ────────────────────────────────────────────────────────────────
// 和 T3/T4 一样:整体 try/catch,失败只 warn + 返回 ok:false,**绝不上抛**。hard-cap 轮次上限
// 兜底提交走同一个 commitCoreMemoryCompression,异常逃出去会同时废掉正常提交和兜底提交。

/** 一条线要成形,需要该标签在这么多个**不同的 read_cutoff**(= 不同压缩轮)里命中过。 */
export const TOPIC_MATERIALIZE_MIN_CUTOFFS = 3;
/** 每份专题最多留这么多章;超了从最老的开始折叠(正文原本就在日记里,不丢)。 */
export const TOPIC_MAX_CHAPTERS_PER_FILE = 30;
/** 状态里最多跟踪多少个标签(防她把标签打成开放集合把 jsonb 撑爆)。 */
const TOPIC_MAX_TRACKED_TAGS = 128;
/** 每个标签保留最近多少个 cutoff 值(判定只要 >= 3,留 8 个够诊断)。 */
const TOPIC_CUTOFF_KEEP = 8;
/** 整份状态的 JSON 上限;超了从「未物化 + 最不活跃」开始丢候选。 */
const TOPIC_STATE_MAX_BYTES = 128 * 1024;
/** open-loops.md 的解析上限:超了不是欠账清单(她可能误把日记 cat 进去),跳过留痕。 */
const TOPIC_OPEN_LOOPS_MAX_BYTES = 1024 * 1024;
/** 单份日记的解析上限,与 T4 同口径。 */
const TOPIC_DIARY_FILE_MAX_BYTES = DIARY_DAY_FILE_MAX_BYTES;
/** 标签长度上限(码位),与 memory_write.py 的 TAG_MAX_CODEPOINTS 同值。 */
const TOPIC_TAG_MAX_CODEPOINTS = 40;
// 合法标签字符集 —— memory_write.py 的 `^[\w-]+$`(Python 3 的 `\w` 默认吃 unicode)在 JS
// 里的等价写法。JS 的 `\w` 只有 ASCII,所以必须显式写 \p{L}\p{N}\p{M},否则中文标签全被拒。
const TOPIC_TAG_CHARSET_RE = /^[\p{L}\p{N}\p{M}_-]+$/u;
// 行里的 `#标签`,与 memory_write.py 的 TAG_IN_LINE_RE 逐字符同口径(整词出现、排掉括号)。
const TOPIC_TAG_IN_LINE_RE = /(?:^|\s)#([^\s#()（）]+)/gu;
// 纯数字标签(`Issue #39`)不算标签 —— 与写端 `tag.isdigit()` 同口径(unicode 十进制数字)。
const TOPIC_TAG_ALL_DIGITS_RE = /^\p{Nd}+$/u;
// 专题里的一章:`## M/D 点题`。和 parseChapterDateFromTitle 认的形状一致(日期后不强求空格)。
const TOPIC_CHAPTER_HEADING_RE = /^##\s+(\d{1,2})\/(\d{1,2})(?!\d)/;
// 任意 markdown 标题(用来切「章之前的头部」和「章」)。
const TOPIC_ANY_HEADING_RE = /^#{1,6}\s+/;
// 折叠通知行的稳定前缀:每次折叠**替换**这一行而不是再追加一行。
const TOPIC_FOLD_NOTICE_PREFIX = '> 更早的';
const TOPIC_STATE_VERSION = 1;

/** 专题目录自己占着这个名字,不能当标签(会把目录覆盖掉)。 */
const TOPIC_INDEX_BASENAME = 'INDEX.md';

/** 一章的最小事实:d = 事发日期(YYYY-MM-DD)、t = 条目标题、l = 标题下第一句原话。 */
export interface TopicChapterFact {
  d: string;
  t: string;
  l: string;
}

export interface TopicCandidateState {
  /** 命中过这个标签的 read_cutoff 值(唯一、升序)。size >= TOPIC_MATERIALIZE_MIN_CUTOFFS 才成线。 */
  cutoffs: number[];
  /** 已算出但还没落盘的章。落盘成功后搬进 emitted/days。 */
  pending: TopicChapterFact[];
  /** 已落盘过的章的归一化 key。**只进不出** —— 她手删掉的章靠这个不被重建。 */
  emitted: string[];
  /** 已落盘过的章的日期(升序唯一),只用来算「N 段进展、最近 M/D」。 */
  days: string[];
  /** 折叠掉的章数(从文件里摘掉的 + pending 溢出丢掉的)。 */
  folded: number;
}

export interface TopicMaterializationState {
  v: number;
  /** 每份日记已扫到的字节数。下一轮只看这之后的新增部分。 */
  watermarks: Record<string, number>;
  candidates: Record<string, TopicCandidateState>;
  /** 已经成形的线。**白名单包含它** —— 她把 open-loops 那行划掉/删掉之后,线继续更新。 */
  materialized: string[];
}

export interface TopicWritePlanEntry {
  tag: string;
  chapters: TopicChapterFact[];
}

export interface TopicMaterializationPlan {
  ok: boolean;
  skippedReason?: string;
  sessionKey: string;
  diaryDir: string;
  topicsDir: string;
  /** 本轮的 read_cutoff —— 轮次身份,进 cutoffs 集合。 */
  cutoff: number;
  /** 上一轮落库的状态的稳定序列化,用来判「状态没变就别写库」。 */
  priorStateJson: string;
  nextState: TopicMaterializationState;
  writes: TopicWritePlanEntry[];
  whitelistTags: string[];
  scannedFiles: number;
  /** 本轮真读了内容的日记文件数(水位没动的文件连读都不读)。 */
  readFiles: number;
}

export interface TopicMaterializationWriteResult {
  ok: boolean;
  skippedReason?: string;
  topicsDir: string;
  wroteTags: string[];
  /** 该补的章文件里已经有了(她自己写过/上一轮写过) → 零字节改动,但算成功。 */
  unchangedTags: string[];
  failedTags: string[];
  indexWritten: boolean;
  indexSkippedReason?: string;
  /** 只有 failedTags 为空时才非 null;为 null 表示**水位一个字都不许动**。 */
  nextState: TopicMaterializationState | null;
}

function resolveTopicsDir(explicit?: string): string {
  if (explicit) {
    return explicit;
  }
  if (process.env.XIAONI_TOPICS_DIR) {
    return process.env.XIAONI_TOPICS_DIR;
  }
  // 和 resolveDiaryManifestDir 同款:挂在 notes/ 下面、和 diary/ 平级。
  // **绝不能**放进 notes/diary/ —— 那是被动召回腿的语料源(见本节顶部的实测表)。
  return `${nodePath.dirname(resolveDiaryDir())}/topics`;
}

/**
 * 标签是否成线。口径**逐条对齐** memory_write.py 的 `validate_tag`:
 * 非空 / ≤40 码位 / `^[\w-]+$` / 拒纯数字 / 拒 INDEX。口径不一致 = 她打了标签但系统不算。
 */
export function isValidTopicTag(raw: unknown): boolean {
  if (typeof raw !== 'string') {
    return false;
  }
  const tag = raw.trim();
  if (!tag) {
    return false;
  }
  if ([...tag].length > TOPIC_TAG_MAX_CODEPOINTS) {
    return false;
  }
  if (!TOPIC_TAG_CHARSET_RE.test(tag)) {
    // 顺手排掉空白 / `/` / `.` / 括号 / `#` —— 标签要当文件名用。
    return false;
  }
  if (TOPIC_TAG_ALL_DIGITS_RE.test(tag)) {
    // `Issue #39` 是引用编号,不是标签。写端也拒,这条线永远连不起来。
    return false;
  }
  if (tag.toLowerCase() === 'index') {
    // topics/INDEX.md 自己占着。
    return false;
  }
  return true;
}

/** 从 open-loops.md 全文抽白名单标签(保留她写的大小写,按行内顺序、去重)。 */
export function extractTopicTagsFromOpenLoops(content: unknown): string[] {
  if (typeof content !== 'string' || !content) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    TOPIC_TAG_IN_LINE_RE.lastIndex = 0;
    let matched: RegExpExecArray | null = TOPIC_TAG_IN_LINE_RE.exec(line);
    while (matched !== null) {
      const tag = matched[1];
      if (isValidTopicTag(tag)) {
        const key = tag.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          out.push(tag);
        }
      }
      matched = TOPIC_TAG_IN_LINE_RE.exec(line);
    }
  }
  return out;
}

/**
 * 一章 / 一条日记条目的**身份**。三个归一化函数按这个顺序串起来,少一个就认不出同一件事:
 *   1. stripTrailingHashTags —— 她给同一条补了个标签不该换身份
 *   2. stripChapterDatePrefix —— L3 章节标题带 `M/D ` 前缀,日记标题没有
 *   3. normalizeEventText —— 折空白 + 小写
 * 之前有一版设计漏了第 2 步就声称能去重,实测 100% 重复。
 */
export function topicChapterKey(rawTitle: unknown): string {
  const stripped = stripTrailingHashTags(typeof rawTitle === 'string' ? rawTitle : '').text;
  return normalizeEventText(stripChapterDatePrefix(stripped));
}

function uniqueSortedNumbers(values: unknown): number[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const set = new Set<number>();
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num)) {
      set.add(Math.trunc(num));
    }
  }
  return [...set].sort((a, b) => a - b);
}

function uniqueStrings(values: unknown, max: number): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || !value) {
      continue;
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  // 超上限保留**最新的**(数组尾部),老的 key 掉了最坏后果是那一章可能被重建一次。
  return out.length > max ? out.slice(out.length - max) : out;
}

function normalizeTopicChapterFact(raw: unknown): TopicChapterFact | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const d = typeof record.d === 'string' ? record.d : '';
  const t = typeof record.t === 'string' ? record.t : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !t) {
    return null;
  }
  return { d, t, l: typeof record.l === 'string' ? record.l : '' };
}

/** 库里读回来的状态一律过这一道:形状坏了当「从零开始」,绝不让半个形状往下走。 */
export function normalizeTopicMaterializationState(raw: unknown): TopicMaterializationState {
  const empty: TopicMaterializationState = {
    v: TOPIC_STATE_VERSION,
    watermarks: {},
    candidates: {},
    materialized: []
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return empty;
  }
  const record = raw as Record<string, unknown>;
  const watermarks: Record<string, number> = {};
  if (record.watermarks && typeof record.watermarks === 'object' && !Array.isArray(record.watermarks)) {
    for (const [name, value] of Object.entries(record.watermarks as Record<string, unknown>)) {
      const num = Number(value);
      if (typeof name === 'string' && name && Number.isFinite(num) && num >= 0) {
        watermarks[name] = Math.trunc(num);
      }
    }
  }
  const candidates: Record<string, TopicCandidateState> = {};
  if (record.candidates && typeof record.candidates === 'object' && !Array.isArray(record.candidates)) {
    for (const [tag, value] of Object.entries(record.candidates as Record<string, unknown>)) {
      if (!isValidTopicTag(tag) || !value || typeof value !== 'object') {
        continue;
      }
      const cand = value as Record<string, unknown>;
      const pending: TopicChapterFact[] = [];
      if (Array.isArray(cand.pending)) {
        for (const entry of cand.pending) {
          const fact = normalizeTopicChapterFact(entry);
          if (fact) {
            pending.push(fact);
          }
        }
      }
      const folded = Number(cand.folded);
      candidates[tag] = {
        cutoffs: uniqueSortedNumbers(cand.cutoffs).slice(-TOPIC_CUTOFF_KEEP),
        pending: pending.slice(-TOPIC_MAX_CHAPTERS_PER_FILE),
        emitted: uniqueStrings(cand.emitted, TOPIC_MAX_CHAPTERS_PER_FILE * 4),
        days: uniqueStrings(cand.days, TOPIC_MAX_CHAPTERS_PER_FILE * 4).sort(),
        folded: Number.isFinite(folded) && folded > 0 ? Math.trunc(folded) : 0
      };
    }
  }
  const materialized: string[] = [];
  if (Array.isArray(record.materialized)) {
    for (const tag of record.materialized) {
      if (isValidTopicTag(tag) && !materialized.includes(tag as string)) {
        materialized.push(tag as string);
      }
    }
  }
  return { v: TOPIC_STATE_VERSION, watermarks, candidates, materialized };
}

/** 稳定序列化(键排序):唯一用途是判「状态跟上一轮逐字节相同 → 别写库」。 */
export function stableTopicStateJson(state: TopicMaterializationState | null): string {
  if (!state) {
    return 'null';
  }
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(stable);
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        out[key] = stable((value as Record<string, unknown>)[key]);
      }
      return out;
    }
    return value;
  };
  return JSON.stringify(stable(state));
}

interface DiaryEntrySlice {
  title: string;
  /** 标题下第一句原话(引擎不编,只机械抄 + 截断)。 */
  lead: string;
  /** 条目正文(含标题)的字节结束位置,用来和水位比。 */
  endByte: number;
  /** 匹配用的小写全文(标题 + 正文)。 */
  haystack: string;
}

/**
 * 把一份日记切成条目,并记下每条**结束时的字节位置**。
 * 字节而不是行:水位存的是文件字节数(`stat.size`),两边必须同一把尺。
 */
export function sliceDiaryEntries(fileText: string): DiaryEntrySlice[] {
  const out: DiaryEntrySlice[] = [];
  if (typeof fileText !== 'string' || !fileText) {
    return out;
  }
  const lines = fileText.split('\n');
  let cursor = 0;
  let current: { title: string; bodyLines: string[] } | null = null;
  const flush = (endByte: number) => {
    if (!current) {
      return;
    }
    let lead = '';
    for (const line of current.bodyLines) {
      if (line.trim()) {
        lead = normalizeDiaryOneLine(line);
        if (lead) {
          break;
        }
      }
    }
    out.push({
      title: current.title,
      lead,
      endByte,
      haystack: `${current.title}\n${current.bodyLines.join('\n')}`.toLowerCase()
    });
    current = null;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    // +1 是换行符,最后一段之后没有换行 —— 这样累加出来的总字节数和 `stat.size` **完全相等**,
    // 水位比较才不会在边界上差一个字节(差 1 会让最后一条每轮都被当成"新的"重扫一遍)。
    const lineBytes = Buffer.byteLength(line, 'utf8') + (index < lines.length - 1 ? 1 : 0);
    const heading = /^#{2,6}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush(cursor);
      current = { title: heading[1].trim(), bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    }
    cursor += lineBytes;
  }
  flush(cursor);
  return out;
}

function ensureTopicCandidate(state: TopicMaterializationState, tag: string): TopicCandidateState {
  const existing = state.candidates[tag];
  if (existing) {
    return existing;
  }
  const fresh: TopicCandidateState = { cutoffs: [], pending: [], emitted: [], days: [], folded: 0 };
  state.candidates[tag] = fresh;
  return fresh;
}

function trimTopicState(state: TopicMaterializationState): void {
  const materialized = new Set(state.materialized);
  const tags = Object.keys(state.candidates);
  if (tags.length > TOPIC_MAX_TRACKED_TAGS) {
    // 先丢**未物化**的、最不活跃的(最大 cutoff 最小的)。已成形的线不丢。
    const droppable = tags
      .filter((tag) => !materialized.has(tag))
      .sort((a, b) => {
        const lastA = state.candidates[a].cutoffs[state.candidates[a].cutoffs.length - 1] ?? -1;
        const lastB = state.candidates[b].cutoffs[state.candidates[b].cutoffs.length - 1] ?? -1;
        return lastA - lastB;
      });
    let over = tags.length - TOPIC_MAX_TRACKED_TAGS;
    for (const tag of droppable) {
      if (over <= 0) {
        break;
      }
      delete state.candidates[tag];
      over -= 1;
    }
  }
  // 整份 jsonb 兜底:还超,继续从未物化的候选里丢(丢的只是"还没成形的计数",不丢记忆)。
  while (Buffer.byteLength(stableTopicStateJson(state), 'utf8') > TOPIC_STATE_MAX_BYTES) {
    const droppable = Object.keys(state.candidates).filter((tag) => !materialized.has(tag));
    if (droppable.length === 0) {
      break;
    }
    delete state.candidates[droppable[0]];
  }
}

/**
 * **【算】** —— 挂在压缩原子提交帧内(writeDiaryHeadingManifests 之后、
 * readDiaryIndexSnapshot 之前)。**只读不写**,一个文件都不碰。
 * 返回的 plan 里 `nextState` 是"如果落盘全成功才该落库"的状态。
 * **绝不抛异常**。
 */
export async function planTopicMaterialization(options: {
  sessionKey: string;
  cutoff: number;
  priorState?: unknown;
  diaryDir?: string;
  topicsDir?: string;
}): Promise<TopicMaterializationPlan> {
  const diaryDir = resolveDiaryDir(options.diaryDir);
  const topicsDir = resolveTopicsDir(options.topicsDir);
  const priorState = normalizeTopicMaterializationState(options.priorState);
  const plan: TopicMaterializationPlan = {
    ok: false,
    sessionKey: options.sessionKey,
    diaryDir,
    topicsDir,
    cutoff: Number(options.cutoff),
    priorStateJson: stableTopicStateJson(priorState),
    nextState: priorState,
    writes: [],
    whitelistTags: [],
    scannedFiles: 0,
    readFiles: 0
  };
  try {
    if (!Number.isFinite(plan.cutoff)) {
      plan.skippedReason = 'cutoff_not_finite';
      return plan;
    }
    const state = normalizeTopicMaterializationState(options.priorState);
    plan.nextState = state;

    // ── 先确认日记目录在 ──
    // 排在白名单之前:目录没了(挂载错位/路径打错)是**结构性**跳过,理由必须诚实说清是
    // 目录读不到,而不是含糊地报"没有标签"。readdir 很便宜,值得先做。
    let names: string[];
    try {
      names = await fsReaddir(diaryDir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code ?? 'unknown';
      moduleLogger.warn('topic materialization skipped: diary dir unreadable', { path: diaryDir, code });
      plan.skippedReason = 'diary_dir_unreadable';
      return plan;
    }

    // ── 白名单 = open-loops.md 的 `#标签` ∪ 已物化的线 ──
    // open-loops 读不出来不是致命的:已物化的线照旧继续更新(H3「划掉不停更」的同一条腿)。
    const openLoopsPath = nodePath.join(diaryDir, 'open-loops.md');
    let openLoopTags: string[] = [];
    try {
      const stat = await fsStat(openLoopsPath);
      if (stat.isFile() && stat.size <= TOPIC_OPEN_LOOPS_MAX_BYTES) {
        openLoopTags = extractTopicTagsFromOpenLoops(await fsReadFile(openLoopsPath, 'utf8'));
      } else if (stat.size > TOPIC_OPEN_LOOPS_MAX_BYTES) {
        moduleLogger.warn('topic materialization: open-loops too large to be a loop list', {
          path: openLoopsPath,
          bytes: stat.size
        });
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code ?? 'unknown';
      moduleLogger.warn('topic materialization: open-loops unreadable; whitelist falls back to materialized lines', {
        path: openLoopsPath,
        code
      });
    }
    const whitelist = new Map<string, string>(); // lowercase → 她写的原样
    for (const tag of openLoopTags) {
      whitelist.set(tag.toLowerCase(), tag);
    }
    for (const tag of state.materialized) {
      if (!whitelist.has(tag.toLowerCase())) {
        whitelist.set(tag.toLowerCase(), tag);
      }
    }
    plan.whitelistTags = [...whitelist.values()];
    if (plan.whitelistTags.length === 0) {
      // 一个标签都没有 → 结构上没有任何线可物化。**不建目录、不写任何文件。**
      plan.ok = true;
      plan.skippedReason = 'no_whitelisted_tags';
      return plan;
    }

    // ── 扫日记的新增部分 ──
    const hitsByTag = new Map<string, TopicChapterFact[]>();
    const seenDayFiles = new Set<string>();
    for (const name of names.sort()) {
      const matched = DIARY_DAY_FILE_RE.exec(name);
      if (!matched) {
        continue;
      }
      if (toDayNumber(Number(matched[1]), Number(matched[2]), Number(matched[3])) === null) {
        continue;
      }
      seenDayFiles.add(name);
      const iso = `${matched[1]}-${matched[2]}-${matched[3]}`;
      const diaryPath = nodePath.join(diaryDir, name);
      plan.scannedFiles += 1;
      try {
        const stat = await fsStat(diaryPath);
        if (!stat.isFile() || stat.size > TOPIC_DIARY_FILE_MAX_BYTES) {
          continue;
        }
        const watermark = state.watermarks[name] ?? 0;
        if (stat.size === watermark) {
          continue; // 这一天一个字节都没长 → 连读都不读
        }
        // 文件缩了(她重写/裁剪过) → 水位失效,整份重扫。重复的章靠归一化 key 拦住。
        const effectiveWatermark = stat.size < watermark ? 0 : watermark;
        const fileText = await fsReadFile(diaryPath, 'utf8');
        plan.readFiles += 1;
        for (const entry of sliceDiaryEntries(fileText)) {
          if (entry.endByte <= effectiveWatermark) {
            continue; // 这一条整个在水位以下 → 上一轮已经看过
          }
          for (const tag of plan.whitelistTags) {
            if (!entry.haystack.includes(tag.toLowerCase())) {
              continue;
            }
            const list = hitsByTag.get(tag) ?? [];
            list.push({ d: iso, t: normalizeDiaryOneLine(entry.title), l: entry.lead });
            hitsByTag.set(tag, list);
          }
        }
        state.watermarks[name] = stat.size;
      } catch (error) {
        // 单份读失败只跳过这一天:水位不动 → 下一轮重试同一份。
        moduleLogger.warn('topic materialization skipped one diary file', {
          path: diaryPath,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // 清掉已经不存在的日记文件的水位(否则这个 map 只涨不降)。**只在真看到过日记文件时才清** ——
    // 挂载错位(sudo 丢 HOME 挂到空目录)时 readdir 会成功返回空目录,那种情况下清空水位
    // 等于把整套记账烧掉,下一轮从头重扫。宁可留几条陈旧的水位,也不在那一帧动手。
    if (seenDayFiles.size > 0) {
      for (const name of Object.keys(state.watermarks)) {
        if (!seenDayFiles.has(name)) {
          delete state.watermarks[name];
        }
      }
    }

    // ── 记账:cutoff 集合 + 待落盘的章 ──
    for (const [tag, hits] of hitsByTag) {
      const candidate = ensureTopicCandidate(state, tag);
      if (!candidate.cutoffs.includes(plan.cutoff)) {
        candidate.cutoffs = uniqueSortedNumbers([...candidate.cutoffs, plan.cutoff]).slice(-TOPIC_CUTOFF_KEEP);
      }
      const known = new Set<string>(candidate.emitted);
      for (const fact of candidate.pending) {
        known.add(topicChapterKey(fact.t));
      }
      for (const hit of [...hits].sort((a, b) => a.d.localeCompare(b.d))) {
        const key = topicChapterKey(hit.t);
        if (!key || known.has(key)) {
          continue;
        }
        known.add(key);
        candidate.pending.push(hit);
      }
      if (candidate.pending.length > TOPIC_MAX_CHAPTERS_PER_FILE) {
        // 只留最近 30 章。丢掉的算 folded(正文在日记里,不丢东西)。
        const dropped = candidate.pending.length - TOPIC_MAX_CHAPTERS_PER_FILE;
        candidate.pending = candidate.pending.slice(dropped);
        candidate.folded += dropped;
      }
    }

    // ── 决定这一轮写谁 ──
    const materializedSet = new Set(state.materialized);
    for (const tag of Object.keys(state.candidates)) {
      const candidate = state.candidates[tag];
      if (candidate.pending.length === 0) {
        continue;
      }
      if (!whitelist.has(tag.toLowerCase())) {
        continue; // 标签删了、线又还没成形 → 只留计数,不建文件
      }
      if (!materializedSet.has(tag) && candidate.cutoffs.length < TOPIC_MATERIALIZE_MIN_CUTOFFS) {
        continue; // 还没够轮数 → 继续攒
      }
      plan.writes.push({
        tag,
        chapters: [...candidate.pending].sort((a, b) => a.d.localeCompare(b.d))
      });
    }
    plan.writes.sort((a, b) => a.tag.localeCompare(b.tag));
    trimTopicState(state);
    plan.ok = true;
    return plan;
  } catch (error) {
    moduleLogger.warn('topic materialization planning failed (fail-open, commit proceeds)', {
      diaryDir,
      error: error instanceof Error ? error.message : String(error)
    });
    plan.ok = false;
    plan.skippedReason = plan.skippedReason ?? 'unexpected_error';
    return plan;
  }
}

interface ParsedTopicFile {
  /** 第一章之前的一切,**原样保留**(她可能在头部写过话)。 */
  header: string[];
  chapters: Array<{ key: string; date: string | null; raw: string[] }>;
}

/** 把一份 topics/<标签>.md 切成头部 + 章。章的原文一个字不改(她手改过的章要留住)。 */
export function parseTopicFileChapters(content: string | null): ParsedTopicFile {
  const out: ParsedTopicFile = { header: [], chapters: [] };
  if (typeof content !== 'string' || !content) {
    return out;
  }
  const lines = content.replace(/\n+$/, '').split('\n');
  let current: { key: string; date: string | null; raw: string[] } | null = null;
  for (const line of lines) {
    const heading = TOPIC_CHAPTER_HEADING_RE.exec(line);
    if (heading) {
      if (current) {
        out.chapters.push(current);
      }
      const rawTitle = line.replace(/^##\s+/, '');
      const month = Number(heading[1]);
      const day = Number(heading[2]);
      current = {
        key: topicChapterKey(rawTitle),
        // 只有月/日,没有年 —— 排序/折叠只在同一份文件内比,用 MM-DD 足够稳定。
        date: month >= 1 && month <= 12 && day >= 1 && day <= 31
          ? `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          : null,
        raw: [line]
      };
      continue;
    }
    if (current) {
      current.raw.push(line);
    } else {
      out.header.push(line);
    }
  }
  if (current) {
    out.chapters.push(current);
  }
  return out;
}

function buildTopicFileHeader(tag: string): string[] {
  return [
    `# ${tag}`,
    '',
    `> 这份文件是引擎从你各天日记里连起来的**索引**,不是正文 —— 触发它的是 open-loops.md 里的 \`#${tag}\`。`,
    '> 每章一句话 + 指回当天日记;正文永远在那天的日记里(那边才有菜单)。',
    '> 不想要哪一章就直接删,引擎不会重建它。',
    ''
  ];
}

function buildTopicChapterLines(fact: TopicChapterFact): string[] {
  const month = Number(fact.d.slice(5, 7));
  const day = Number(fact.d.slice(8, 10));
  const title = fact.t || '(空标题)';
  const lines = [`## ${month}/${day} ${title}`];
  if (fact.l) {
    lines.push(fact.l);
  }
  lines.push(`→ ${fact.d}.md`);
  lines.push('');
  return lines;
}

/** 折叠通知行:每次**替换**(而不是追加),所以 N 永远是当前真实值。 */
function applyTopicFoldNotice(header: string[], foldedCount: number): string[] {
  const withoutNotice = header.filter((line) => !line.startsWith(TOPIC_FOLD_NOTICE_PREFIX));
  if (foldedCount <= 0) {
    return withoutNotice;
  }
  const notice = `${TOPIC_FOLD_NOTICE_PREFIX} ${foldedCount} 段进展在当天日记里(引擎折叠了这里的章,正文没丢)。`;
  const out = [...withoutNotice];
  const headingAt = out.findIndex((line) => TOPIC_ANY_HEADING_RE.test(line));
  if (headingAt >= 0) {
    out.splice(headingAt + 1, 0, '', notice);
  } else {
    out.unshift(notice, '');
  }
  return out;
}

/** 线目录:她**主动查**的入口(一条命令看手上有哪些线、各自追到哪天)。不进任何请求字节。 */
export function buildTopicsIndexContent(state: TopicMaterializationState): string | null {
  const rows: Array<{ tag: string; count: number; last: string }> = [];
  for (const tag of state.materialized) {
    const candidate = state.candidates[tag];
    if (!candidate) {
      continue;
    }
    const count = candidate.days.length + candidate.folded;
    const last = candidate.days.length > 0 ? candidate.days[candidate.days.length - 1] : '';
    if (count <= 0) {
      continue;
    }
    rows.push({ tag, count, last });
  }
  if (rows.length === 0) {
    return null;
  }
  // 最近有进展的排前面;同一天的按标签名稳定排序(避免无意义的字节漂移)。
  rows.sort((a, b) => (a.last === b.last ? a.tag.localeCompare(b.tag) : b.last.localeCompare(a.last)));
  const out = [
    '# 线',
    '',
    '> 引擎维护(每次整理记忆后重写)。这些线是按 open-loops.md 里的 `#标签` 从各天日记里连起来的索引,',
    '> 正文永远在当天日记里。想看某条线:读同目录下的 `<标签>.md`。',
    ''
  ];
  for (const row of rows) {
    const last = row.last ? `${Number(row.last.slice(5, 7))}/${Number(row.last.slice(8, 10))}` : '未知';
    // 行格式和 spec §4 逐字一致(她会 cat 这一份,别自己改口径)。
    out.push(`- ${row.tag} | ${row.count} 段进展，最近 ${last}（细目在 ${row.tag}.md）`);
  }
  return `${out.join('\n')}\n`;
}

/**
 * 读回目标文件。**「存在但读不出来」一律拒写** —— 这是从写端 skill 照抄的一条刻意偏离:
 * 此处放行 = 拿新内容 `rename` 掉一份读不出来的旧文件 = 静默丢记忆。
 * 用 lstat 判"存在"而不是 stat:悬空 symlink / 目录占了文件名,stat 会说不存在,
 * 但 rename 上去照样把那个路径实体替换掉。
 */
async function readTopicFileForMerge(filePath: string): Promise<{ ok: true; content: string | null } | { ok: false; code: string }> {
  let exists = false;
  try {
    await fsLstat(filePath);
    exists = true;
  } catch {
    exists = false;
  }
  try {
    return { ok: true, content: await fsReadFile(filePath, 'utf8') };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code ?? 'unknown';
    if (!exists && code === 'ENOENT') {
      return { ok: true, content: null }; // 真的不存在 → 新建
    }
    return { ok: false, code };
  }
}

/**
 * **【写】** —— 挂在压缩提交**之后**(post-commit fail-open 段)。
 * 落盘失败绝不影响已经完成的压缩提交;任何一个标签写失败 → 返回 nextState=null,
 * 调用方就一个字都不落库 → 水位不动 → 下一轮重做同一批。
 * **绝不抛异常**。
 */
export async function writeTopicMaterialization(plan: TopicMaterializationPlan | null): Promise<TopicMaterializationWriteResult> {
  const result: TopicMaterializationWriteResult = {
    ok: false,
    topicsDir: plan?.topicsDir ?? '',
    wroteTags: [],
    unchangedTags: [],
    failedTags: [],
    indexWritten: false,
    nextState: null
  };
  if (!plan || !plan.ok) {
    result.skippedReason = plan?.skippedReason ?? 'no_plan';
    return result;
  }
  try {
    const state = plan.nextState;
    const materialized = new Set(state.materialized);
    for (const entry of plan.writes) {
      const tag = entry.tag;
      // 再验一遍:标签要当文件名用,绝不让一个没过白名单的字符串走到 path.join。
      if (!isValidTopicTag(tag)) {
        result.failedTags.push(tag);
        continue;
      }
      const filePath = nodePath.join(plan.topicsDir, `${tag}.md`);
      if (nodePath.basename(filePath) === TOPIC_INDEX_BASENAME) {
        result.failedTags.push(tag);
        continue;
      }
      const read = await readTopicFileForMerge(filePath);
      if (!read.ok) {
        // 存在但读不出来 → **拒写**(照抄写端 load_for_edit 的偏离)。
        moduleLogger.warn('topic materialization refused: target exists but is unreadable', {
          path: filePath,
          code: read.code
        });
        result.failedTags.push(tag);
        continue;
      }
      const parsed = parseTopicFileChapters(read.content);
      const presentKeys = new Set(parsed.chapters.map((chapter) => chapter.key));
      const candidate = state.candidates[tag];
      if (!candidate) {
        continue;
      }
      // 文件是这一层的真理源:文件里已经有的章(她自己写的、上一轮写的)记进 emitted,
      // 这样"重做同一批"不会补出第二份,她手删过的章也不会被重建。
      const appended: string[] = [];
      const emittedNow: TopicChapterFact[] = [];
      for (const fact of entry.chapters) {
        const key = topicChapterKey(fact.t);
        if (!key) {
          continue;
        }
        if (presentKeys.has(key) || candidate.emitted.includes(key)) {
          emittedNow.push(fact); // 已经在了 → 只搬账,不写字节
          continue;
        }
        presentKeys.add(key);
        appended.push(...buildTopicChapterLines(fact));
        emittedNow.push(fact);
      }

      // 每一章一个 block,block 内原文一字不改(她手改过的章要留住),block 之间统一空一行。
      // 这个规范化是**幂等的关键**:重新读回来再拼一次必须逐字节相同,否则每轮都在改 mtime。
      const chapterBlocks = parsed.chapters.map((chapter) => chapter.raw.join('\n').replace(/\n+$/, ''));
      const appendedBlock = appended.length > 0 ? appended.join('\n').replace(/\n+$/, '') : '';
      // H6 章数治理:超过上限从最老的开始摘(正文原本就在日记里,不丢)。
      let foldedDelta = 0;
      const newChapterCount = appended.filter((line) => line.startsWith('## ')).length;
      let keptChapterBlocks = chapterBlocks;
      if (parsed.chapters.length + newChapterCount > TOPIC_MAX_CHAPTERS_PER_FILE) {
        const overflow = parsed.chapters.length + newChapterCount - TOPIC_MAX_CHAPTERS_PER_FILE;
        foldedDelta = Math.min(overflow, chapterBlocks.length);
        keptChapterBlocks = chapterBlocks.slice(foldedDelta);
      }
      const header = applyTopicFoldNotice(
        read.content === null ? buildTopicFileHeader(tag) : parsed.header,
        candidate.folded + foldedDelta
      );
      const sections = [
        header.join('\n').replace(/\n+$/, ''),
        ...keptChapterBlocks,
        ...(appendedBlock ? [appendedBlock] : [])
      ].filter((section) => section.length > 0);
      const content = `${sections.join('\n\n')}\n`;

      let wrote = false;
      try {
        wrote = await writeFileAtomicIfChanged(filePath, content);
      } catch (error) {
        moduleLogger.warn('topic materialization write failed for one line', {
          path: filePath,
          error: error instanceof Error ? error.message : String(error)
        });
        result.failedTags.push(tag);
        continue;
      }
      // 写成功(或本来就一致)→ 搬账:pending 出账,emitted/days 入账,标签成线。
      candidate.folded += foldedDelta;
      for (const fact of emittedNow) {
        const key = topicChapterKey(fact.t);
        if (key && !candidate.emitted.includes(key)) {
          candidate.emitted.push(key);
        }
        if (!candidate.days.includes(fact.d)) {
          candidate.days.push(fact.d);
        }
      }
      candidate.days.sort();
      const emittedKeys = new Set(emittedNow.map((fact) => topicChapterKey(fact.t)));
      candidate.pending = candidate.pending.filter((fact) => !emittedKeys.has(topicChapterKey(fact.t)));
      candidate.emitted = uniqueStrings(candidate.emitted, TOPIC_MAX_CHAPTERS_PER_FILE * 4);
      candidate.days = uniqueStrings(candidate.days, TOPIC_MAX_CHAPTERS_PER_FILE * 4).sort();
      if (!materialized.has(tag)) {
        materialized.add(tag);
        state.materialized.push(tag);
      }
      if (wrote) {
        result.wroteTags.push(tag);
      } else {
        result.unchangedTags.push(tag);
      }
    }

    // 线目录:只在真有线时写(避免建一份空文件)。它是从状态整份重算的,所以不 merge。
    const indexContent = buildTopicsIndexContent(state);
    if (indexContent) {
      const indexPath = nodePath.join(plan.topicsDir, TOPIC_INDEX_BASENAME);
      const read = await readTopicFileForMerge(indexPath);
      if (!read.ok) {
        moduleLogger.warn('topic index refused: exists but unreadable', { path: indexPath, code: read.code });
        result.indexSkippedReason = `unreadable:${read.code}`;
      } else {
        try {
          result.indexWritten = await writeFileAtomicIfChanged(indexPath, indexContent);
        } catch (error) {
          // 线目录写失败**不**拖住水位:它是纯派生产物,下一轮从状态原样重算即可。
          moduleLogger.warn('topic index write failed (derived artifact, watermark still advances)', {
            path: indexPath,
            error: error instanceof Error ? error.message : String(error)
          });
          result.indexSkippedReason = 'write_failed';
        }
      }
    }

    result.ok = true;
    trimTopicState(state); // 搬账之后再收一次口(已成形的线永远不会被丢)
    // **水位闸门**:只要有任何一个标签写失败,整批不落库 → 下一轮拿同一个水位重做同一批。
    result.nextState = result.failedTags.length === 0 ? state : null;
    if (result.wroteTags.length > 0 || result.failedTags.length > 0) {
      moduleLogger.info('topic materialization written', {
        topicsDir: plan.topicsDir,
        cutoff: plan.cutoff,
        wroteTags: result.wroteTags,
        unchangedTags: result.unchangedTags,
        failedTags: result.failedTags,
        indexWritten: result.indexWritten
      });
    }
    return result;
  } catch (error) {
    moduleLogger.warn('topic materialization write failed (fail-open, commit already done)', {
      topicsDir: plan.topicsDir,
      error: error instanceof Error ? error.message : String(error)
    });
    result.ok = false;
    result.skippedReason = result.skippedReason ?? 'unexpected_error';
    result.nextState = null;
    return result;
  }
}

function buildLoopRequestInput(params: {
  history: ConversationTurn[];
  queueMessage: QueueMessageRecord['payload'];
  runtimePrompt: ResolvedAgentRuntimePrompt;
  loopContinuation: OpenResponseInputItem[];
  runtimeIdentityFacts?: RuntimeIdentityFactProjection[];
  contextSummary?: string | null;
  diaryIndexSnapshot?: string | null;
  peopleIndexSnapshot?: string | null;
  pendingProactiveShare?: string | null;
  developerContextBlock?: string | null;
  runtimeEnergyState?: RuntimeEnergyState | null;
  triggerInputMode?: RuntimeTriggerInputMode;
  appendSelfContinuationOnTerminalFinalAnswer?: boolean;
  appendedSelfContinuationInputItems?: OpenResponseInputItem[];
  loopContinuationBeforeCurrentTrigger?: boolean;
  // When provided, the fresh_trigger current-turn items reuse this exact array
  // instead of rebuilding, so the sent request and the 存档 stay byte-identical.
  precomputedCurrentTurnInputItems?: OpenResponseInputItem[];
}) {
  if (params.loopContinuationBeforeCurrentTrigger) {
    return buildInitialInput(params.history, params.queueMessage, params.runtimePrompt, params.runtimeIdentityFacts || [], params.contextSummary ?? null, params.pendingProactiveShare ?? null, params.developerContextBlock ?? null, params.triggerInputMode ?? 'fresh_trigger', params.appendSelfContinuationOnTerminalFinalAnswer ?? false, params.runtimeEnergyState ?? null, params.appendedSelfContinuationInputItems ?? null, params.loopContinuation, params.precomputedCurrentTurnInputItems ?? null, params.diaryIndexSnapshot ?? null, params.peopleIndexSnapshot ?? null);
  }
  return [
    ...buildInitialInput(params.history, params.queueMessage, params.runtimePrompt, params.runtimeIdentityFacts || [], params.contextSummary ?? null, params.pendingProactiveShare ?? null, params.developerContextBlock ?? null, params.triggerInputMode ?? 'fresh_trigger', params.appendSelfContinuationOnTerminalFinalAnswer ?? false, params.runtimeEnergyState ?? null, params.appendedSelfContinuationInputItems ?? null, [], params.precomputedCurrentTurnInputItems ?? null, params.diaryIndexSnapshot ?? null, params.peopleIndexSnapshot ?? null),
    ...params.loopContinuation
  ];
}

// REQ3 compaction cutoff — BLOCK-budget driven, head-only. The unified trigger path
// (auto via real-input counter, or forced/manual) keeps the most recent HISTORY_COMPACT_KEEP
// BLOCKS verbatim (floated UP to a clean tool-pair boundary so a function_call/output pair is
// never split) and summarizes ONLY the evicted head. The retained tail is NOT re-summarized
// (no overlap), so the summary == the 近况 of exactly what was compressed away. The retained
// tail is a VERBATIM SUFFIX of the input (blocks.slice(evictedBlockCount)) — append-only stack,
// no block rewritten. Returns null when nothing can be cleanly evicted (history <= keep, or no
// clean boundary keeps >= keep). The unit is the BLOCK (one agent_stack_item); no conversation/
// turn concept. See docs/investigations/compress-core-memory-three-contract-violations-2026-06-28.md
//
//   history (oldest -> newest), one block per entry
//   [ ......... evicted head (summarized) ......... | last >= HISTORY_COMPACT_KEEP blocks (verbatim) ]
//                                                   ^ readCutoffAfterStackIndex == last evicted block's stack_index
function planReadCutoffForForcedCompression(history: StackBackedConversationTurn[]) {
  const blocks: StackBlockRef[] = history.map((turn) => ({
    stackIndex: turn.id,
    opensCallId: turn.opensCallId ?? null,
    closesCallId: turn.closesCallId ?? null
  }));
  const plan = planStackReadCutoffByBlockBudget(blocks, { keepBlocks: HISTORY_COMPACT_KEEP });
  if (!plan) {
    return null;
  }
  // The retained tail is the verbatim suffix history.slice(evictedBlockCount); the summary
  // source is the evicted head history.slice(0, evictedBlockCount). The cutoff stack_index is
  // the last evicted block's id (every kept block has a strictly greater stack_index).
  const summarySourceHistory = history.slice(0, plan.evictedBlockCount);
  return {
    firstOverflowPrefixLength: summarySourceHistory.length,
    summarySourceHistory,
    readCutoffAfterStackIndex: plan.readCutoffAfterStackIndex,
    // head-only: the summary covers exactly the evicted head; its end IS the cutoff.
    compressionCoveredEndStackIndex: plan.readCutoffAfterStackIndex,
    overlapCount: 0
  };
}

function readOptionalNumber(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildProviderTokenUsage(modelResult: ProviderAgentResponse) {
  return {
    ...(modelResult.usage || {}),
    cached_input_tokens: readOptionalNumber(modelResult.usage_details?.cached_input_tokens) || 0,
    reasoning_tokens: readOptionalNumber(modelResult.usage_details?.reasoning_tokens) || 0,
    raw_usage: modelResult.usage_details?.raw_usage || null
  };
}

function buildProviderWireMetadata(modelResult: ProviderAgentResponse): Record<string, unknown> {
  return {
    wire_request_headers: modelResult.wire_request_headers || null,
    wire_request_url: modelResult.wire_request_url || null,
    wire_response_headers: modelResult.wire_response_headers || null,
    wire_response_status: modelResult.wire_response_status ?? null,
    wire_response_status_text: modelResult.wire_response_status_text || null
  };
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
  // REQ1: feed the real input_tokens into the compression trigger's debounce
  // counter (consecutive turns over the soft line). In-memory, reset on restart.
  recordMainTurnInputTokensForCompression(
    getGlobalPromptContextSessionKey(),
    record.actualInputTokens
  );
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
    read_cutoff_after_stack_index: record.readCutoffAfterStackIndex,
    context_window_tokens: record.contextWindowTokens,
    target_budget_tokens: record.targetBudgetTokens,
    hard_budget_tokens: record.hardBudgetTokens,
    tokenizer_encoding: record.tokenizerEncoding,
    tokenizer_source: record.tokenizerSource,
    cutoff_recomputed: record.cutoffRecomputed
  };
}

function extractCanonicalResponseOutputItems(modelResult: ProviderAgentResponse): Array<Record<string, unknown>> {
  const output = Array.isArray(modelResult.canonical_response?.output)
    ? modelResult.canonical_response.output
    : [];
  return output
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .map((item) => ({ ...item }));
}

// The self-driven fork is instructed (self_continuation_reminder) to emit its plan
// wrapped in <xiaoni_plan>...</xiaoni_plan>. subconscious_agent_notify.md re-wraps the
// extracted text in <xiaoni_plan>, so without this strip the main loop would receive
// doubly-nested tags (and the model would learn to echo the double wrap).
//
// Take the content INSIDE the model's own <xiaoni_plan> block, even if it is preceded
// by a runtime time prefix or a line of prose ("先想一下…") — matching the block by
// capture group instead of requiring the whole string to be exactly that block. A
// full-string match dropped only the tags, so any leading preamble leaked straight
// into the delivered plan. When the model emitted no block at all, fall back to the
// whole text with stray tags dropped so a plain-text plan still passes through.
export function stripSubconsciousPlanWrapper(text: string): string {
  const result = text.trim();
  const block = result.match(/<xiaoni_plan>\s*([\s\S]*?)\s*<\/xiaoni_plan>/i);
  if (block) {
    return block[1]!.replace(/<\/?xiaoni_plan>/gi, '').trim();
  }
  return result.replace(/<\/?xiaoni_plan>/gi, '').trim();
}

// 交付口的唯一选择点。skill 提交开关 ON 时，plan【只】能从 `xiaoni-plan post` 的
// `XIAONI_PLAN_QUEUED=<id>` 出来；final_answer 文本一律不算交付，落到纠正提示那条分支。
//
// 这是 docs/specs/xiaoni-plan-skill-submission.md E4「删文本抽取 —— 延后一个独立 commit，
// 等开关 ON 观察一周后再删」那一行。观察期的实测结论是：文本口不但没退场，还把 skill 口
// 挤死了 —— 它跑在 tool-call 分支【之前】且不看开关，所以只要模型吐了任何 final_answer 文本
// 就短路收工，纠正分支成了死代码。08-03 起她开始把命令原样【写】在回答里(prompt 那句
// 「原样照这个形状写」的字面执行)，文本口照单全收当 plan 发出去，随后升级腿把这份带 shell
// 外壳的「plan」原样回贴给下一个 fork 看 —— 每轮都在给她做一次错误形状的 few-shot。
// 实测：08-02 之前 656 个 fork 里 657 次真调 exec_command、0 次泄漏；08-08 起 711 个 fork
// 里只剩 21 次真调、691 次泄漏。关掉文本口就是关掉这个正反馈的入口。
//
// 关掉不会断链：她不交 → 走纠正提示重试 → turn 用尽 return false → seed 保留(E6)，
// 60s 后空闲 tick 自然重试；最坏还有 clock_ping 每 2h 兜底。
export function selectSubconsciousPlanFromText(
  outputItems: Array<Record<string, unknown>>,
  skillSubmissionEnabled: boolean
): string | null {
  if (skillSubmissionEnabled) {
    return null;
  }
  return extractSubconsciousNaturalLanguage(outputItems);
}

function extractSubconsciousNaturalLanguage(outputItems: Array<Record<string, unknown>>): string | null {
  for (let index = outputItems.length - 1; index >= 0; index -= 1) {
    const item = outputItems[index]!;
    if (item.type !== 'message' || item.role !== 'assistant' || item.phase !== 'final_answer') {
      continue;
    }
    const content = item.content;
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? flattenMessageContent(content as OpenResponseInputContentPart[])
        : typeof item.text === 'string'
          ? item.text
          : '';
    const normalized = stripSubconsciousPlanWrapper(stripRuntimeTextEast8TimePrefix(text).trim());
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function stackKindForModelOutputItem(item: Record<string, unknown>) {
  const type = typeof item.type === 'string' ? item.type : 'assistant_output';
  if (type === 'function_call') {
    return 'function_call';
  }
  if (type === 'function_call_output') {
    return 'function_call_output';
  }
  return 'assistant_output';
}

function stackRoleForModelOutputItem(item: Record<string, unknown>) {
  return typeof item.role === 'string' ? item.role : 'assistant';
}

function stackPhaseForModelOutputItem(item: Record<string, unknown>) {
  return item.phase === 'final_answer' ? 'final_answer' : item.phase === 'commentary' ? 'commentary' : null;
}

function stackToolCallIdForModelOutputItem(item: Record<string, unknown>) {
  return typeof item.call_id === 'string' && item.call_id.trim()
    ? item.call_id.trim()
    : null;
}

function buildModelOutputStackItems(outputItems: Array<Record<string, unknown>>, sliceId: string) {
  return outputItems.map((item, index) => ({
    eventId: `stack:${sliceId}:output:${index}`,
    itemKind: stackKindForModelOutputItem(item),
    role: stackRoleForModelOutputItem(item),
    phase: stackPhaseForModelOutputItem(item),
    providerItemId: typeof item.id === 'string' ? item.id : null,
    toolCallId: stackToolCallIdForModelOutputItem(item),
    llmRequestSliceId: sliceId,
    content: item,
    visibility: 'model_visible',
    metadata: {
      output_item_index: index,
      output_item_type: typeof item.type === 'string' ? item.type : null
    }
  }));
}

function toolResultToFallbackFunctionCallOutput(toolCall: AgentToolCall, toolResult: Record<string, unknown>) {
  return {
    type: 'function_call_output',
    call_id: toolCall.callId,
    output: JSON.stringify(toolResult)
  };
}

function buildToolResultStackItems(params: {
  toolCall: AgentToolCall;
  toolResult: Record<string, unknown>;
  continuationItems?: OpenResponseInputItem[];
  llmRequestSliceId?: string | null;
}) {
  const functionCallOutputs = (params.continuationItems || [])
    .filter((item): item is Extract<OpenResponseInputItem, { type: 'function_call_output' }> => item.type === 'function_call_output');
  const outputItems = functionCallOutputs.length > 0
    ? functionCallOutputs
    : [toolResultToFallbackFunctionCallOutput(params.toolCall, params.toolResult)];

  return outputItems.map((item, index) => ({
    eventId: `stack:${params.llmRequestSliceId || 'slice'}:tool-output:${params.toolCall.callId}:${index}`,
    itemKind: 'function_call_output',
    role: 'tool',
    phase: null,
    toolCallId: item.call_id,
    llmRequestSliceId: params.llmRequestSliceId || null,
    content: item,
    visibility: functionCallOutputs.length > 0 ? 'model_visible' : 'trace_only',
    metadata: {
      output_item_index: index,
      tool_name: params.toolCall.name,
      output_forwarded_to_model: functionCallOutputs.length > 0
    }
  }));
}

function buildRuntimeInputStackItem(params: {
  queueMessage: QueueMessageRecord['payload'];
  runId: string;
  runtimePrompt: Pick<ResolvedAgentRuntimePrompt, 'userPromptTemplate' | 'contextVariables' | 'runtimeVariables'>;
  // The current-turn items already built for the sent request. When provided the
  // 存档 reuses these exact bytes (deep-copied so the persisted snapshot can't
  // share a mutable ref with the live request) instead of rebuilding with a fresh
  // clock. Falls back to a rebuild only for callers that have nothing prebuilt.
  precomputedInputItems?: OpenResponseInputItem[];
  // The queue message id(s) this stack item folds. Present for folded nonblocking
  // notifies (claimed.queueMessageIds); absent for the initial run trigger, which
  // keys on its per-run-unique traceId. See the event_id comment below.
  queueMessageIds?: number[];
}) {
  const currentInputItems = (params.precomputedInputItems
    ? (JSON.parse(JSON.stringify(params.precomputedInputItems)) as OpenResponseInputItem[])
    : buildCurrentTurnInputItems(params.queueMessage, params.runtimePrompt))
    .filter((item) => !isOpenResponseMessageInputItem(item) || flattenMessageContent(item.content).trim().length > 0);
  // Dedupe key for ON CONFLICT (event_id). It must be UNIQUE per folded message yet
  // STABLE across reprocessing (retry re-reads the same queue row → same key → idempotent
  // dedupe, no duplicate row). runId-keying was too coarse (every fold of a run collapsed
  // onto one id). traceId-keying (the prior fix, 70b187fb) was STILL too coarse: one QQ
  // event fans out into multiple queue messages (a phone_notification + an attention_lease
  // system_reminder) that SHARE one evt_ trace_id, so both folds computed the same event_id
  // and ON CONFLICT silently dropped the second's content. The live loopContinuation carries
  // every fold, so the next run's stack-replay then rebuilt a SHORTER body than the folding
  // run's live request, diverging the cached prefix at the dropped reminder and breaking the
  // whole prompt cache at the run boundary. The queue message id is the true per-message,
  // minted-once-and-persisted unique key (the primary key), so keying on the sorted id set
  // is collision-proof by construction regardless of how many messages (or which sources)
  // one event fans out into. The traceId/runId fallback preserves the initial trigger path
  // (per-run-unique trace) unchanged.
  const dedupeQueueMessageIds = (params.queueMessageIds || [])
    .filter((id) => Number.isFinite(id))
    .slice()
    .sort((a, b) => a - b);
  return {
    eventId: dedupeQueueMessageIds.length > 0
      ? `stack:qmsg:${dedupeQueueMessageIds.join('-')}:runtime-input`
      : `stack:${params.queueMessage.traceId || params.runId}:runtime-input`,
    itemKind: 'runtime_input',
    role: currentInputItems.some((item) => item.type === 'message' && item.role === 'user') ? 'user' : 'developer',
    phase: null,
    content: {
      source: params.queueMessage.source,
      trace_id: params.queueMessage.traceId,
      run_id: params.runId,
      session_key: params.queueMessage.sessionKey,
      chat_type: params.queueMessage.chatType,
      peer_id: params.queueMessage.peerId,
      peer_name: params.queueMessage.peerName || null,
      input_items: currentInputItems,
      system_reminder: null
    },
    visibility: 'model_visible',
    sourceType: 'agent_queue_messages',
    sourceId: params.runId || null,
    traceId: params.queueMessage.traceId,
    runId: params.runId,
    metadata: {
      queue_source: params.queueMessage.source,
      prompt_facing_runtime_reminder: isPromptFacingRuntimeReminderPayload(params.queueMessage)
    }
  };
}

function buildLoopSelfContinuationStackItem(params: {
  queueMessage: QueueMessageRecord['payload'];
  runId: string;
  turn: number;
  inputItem: OpenResponseInputItem;
}) {
  const reminder = isOpenResponseMessageInputItem(params.inputItem)
    ? flattenMessageContent(params.inputItem.content)
    : renderSelfContinuationReminder();
  return {
    eventId: `stack:${params.runId || params.queueMessage.traceId}:self-continuation:${params.turn}`,
    itemKind: 'runtime_input',
    role: isOpenResponseMessageInputItem(params.inputItem) ? params.inputItem.role : 'user',
    phase: null,
    content: {
      source: 'self_continuation',
      reason: 'final_answer',
      trace_id: params.queueMessage.traceId,
      run_id: params.runId,
      session_key: params.queueMessage.sessionKey,
      chat_type: params.queueMessage.chatType,
      peer_id: params.queueMessage.peerId,
      peer_name: params.queueMessage.peerName || null,
      input_items: [params.inputItem],
      system_reminder: reminder
    },
    visibility: 'model_visible',
    sourceType: 'agent_runtime',
    sourceId: params.runId || null,
    traceId: params.queueMessage.traceId,
    runId: params.runId,
    metadata: {
      queue_source: params.queueMessage.source,
      prompt_facing_runtime_reminder: true,
      triggered_by: 'final_answer'
    }
  };
}

function buildForkInputStackItem(params: {
  forkRunId: string;
  sliceId: string;
  forkTurn: number;
  source: string;
  inputItems: OpenResponseInputItem[];
}) {
  return {
    eventId: `stack:${params.sliceId}:input`,
    itemKind: 'runtime_input',
    role: params.inputItems.some((item) => item.type === 'message' && item.role === 'user') ? 'user' : 'developer',
    phase: null,
    llmRequestSliceId: params.sliceId,
    content: {
      source: params.source,
      fork_run_id: params.forkRunId,
      fork_turn: params.forkTurn,
      input_items: JSON.parse(JSON.stringify(params.inputItems))
    },
    visibility: 'model_visible',
    metadata: {
      fork_run_id: params.forkRunId,
      fork_turn: params.forkTurn,
      input_item_count: params.inputItems.length
    }
  };
}

export function buildInitialInput(
  history: ConversationTurn[],
  queueMessage: QueueMessageRecord['payload'],
  runtimePrompt: Pick<ResolvedAgentRuntimePrompt, 'systemPrompt' | 'skillsInstructions' | 'userPromptTemplate' | 'contextVariables' | 'runtimeVariables'> = {
    systemPrompt: agentConfig.systemPrompt,
    userPromptTemplate: null,
    contextVariables: {},
    runtimeVariables: {}
  },
  _runtimeIdentityFacts: RuntimeIdentityFactProjection[] = [],
  contextSummary: string | null = null,
  pendingProactiveShare: string | null = null,
  developerContextBlock: string | null = null,
  triggerInputMode: RuntimeTriggerInputMode = 'fresh_trigger',
  appendSelfContinuationOnTerminalFinalAnswer = false,
  runtimeEnergyState: RuntimeEnergyState | null = null,
  appendedSelfContinuationInputItems: OpenResponseInputItem[] | null = null,
  inputItemsBeforeCurrentTurn: OpenResponseInputItem[] = [],
  precomputedCurrentTurnInputItems: OpenResponseInputItem[] | null = null,
  diaryIndexSnapshot: string | null = null,
  peopleIndexSnapshot: string | null = null
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

  // Head skill manual only. The runtime <CAPABILITIES> block (per-action cost/
  // capability enumeration) was retired — tools are already described by their
  // function schemas + system_prompt 模块三, skills by skills_instructions. Use the
  // frozen skills_instructions from the snapshot (R2) so a live edit only lands at
  // the compression boundary; fall back to a fresh render for callers (tests/forks)
  // that pass a bare runtimePrompt.
  items.push(buildDeveloperInputItem([
    runtimePrompt.skillsInstructions ?? buildSkillsInstructions()
  ].filter((part): part is string => Boolean(part))));

  if (contextSummary) {
    items.push(buildDeveloperInputItem([`<xiaoni_status>\n${contextSummary}\n</xiaoni_status>`]));
  }

  // 日记索引菜单, below <xiaoni_status>: 压缩 STW 提交帧冻结的 INDEX.md 快照。渲染源只有
  // cutoffState.diaryIndexSnapshot(库里的冻结串),两次压缩之间字节不变 → 坐进 cached prefix;
  // 换血与 <xiaoni_status> 同帧,蹭同一次冷读。null(部署后首压前/文件缺失)整块不渲染。
  if (diaryIndexSnapshot) {
    items.push(buildDeveloperInputItem([`<xiaoni_diary_index>\n${diaryIndexSnapshot}\n</xiaoni_diary_index>`]));
  }

  // 人物菜单, below <xiaoni_diary_index>: 同帧冻结的 people/INDEX.md 快照,渲染源只有
  // cutoffState.peopleIndexSnapshot;null(首压前/文件缺失)整块不渲染。
  if (peopleIndexSnapshot) {
    items.push(buildDeveloperInputItem([`<xiaoni_people>\n${peopleIndexSnapshot}\n</xiaoni_people>`]));
  }

  // 固化 head avatar, below <xiaoni_status>: keeps the head "user list" (skills + CAPABILITIES +
  // <xiaoni_status> + avatar) image-bearing on EVERY build, so a later computer_use screenshot turn
  // does not flip the request text→image. Byte-stable → sits in the cached prefix; no-op when
  // XIAONI_HEAD_AVATAR_DATA_URL is unset. Added on every buildInitialInput → main loop, forks
  // (they clone the built request), and the post-compression rebuild all carry the same avatar.
  {
    const avatarItem = buildXiaoniHeadAvatarInputItem();
    if (avatarItem) {
      items.push(avatarItem);
    }
  }

  // Drop prior turns' assistant TEXT outputs (D — final_answer/commentary narration,
  // and inline <xiaoni_os>) from the replayed context on EVERY build: main loop,
  // heartbeat, and self-driven fork all share ONE stripped prefix, so the single cache
  // heartbeat keeps them all warm (no prefix-cache 穿透 / lineage fork). They stay
  // recorded (stack row + action-stream card). The main agent's next turn therefore
  // sees A B C E, not A B C D E, so her idle narration can't compound into a perpetual
  // "摸鱼" loop; deliberate memory she wants to keep flows through compress_core_memory,
  // not raw replay accumulation. The self-driven fork re-injects the most recent D at
  // its TAIL (buildSubconsciousAgentForkRequest) so it keeps the continuity it needs
  // without diverging the cache prefix. Tool calls/outputs are never text and are
  // always retained.
  for (const [turnIndex, turn] of history.entries()) {
    const replayItemsRaw = buildTurnResponseReplayItems(turn);
    // text_admit gate: strip un-admitted assistant text (fail-closed default = all text, matching the
    // historical unconditional strip until Step 3 stamps positive turns). Tool calls/outputs kept.
    const replayItems = replayItemsRaw.filter((item) => !isReplayItemStrippedByTextGate(item));
    const appendKnownReplayItems = () => {
      items.push(...replayItems);
      if (
        appendSelfContinuationOnTerminalFinalAnswer
        && turnIndex === history.length - 1
        // Detect the terminal final_answer from the RAW items; the final_answer text
        // itself stays stripped, only the self-continuation reminder is appended.
        && isAssistantFinalAnswerInputItem(replayItemsRaw[replayItemsRaw.length - 1])
      ) {
        const selfContinuationInputItem = buildSelfContinuationInputItem();
        items.push(selfContinuationInputItem);
        appendedSelfContinuationInputItems?.push(selfContinuationInputItem);
      }
    };
    const transcriptItems = Array.isArray(turn.items) && turn.items.length > 0
      ? turn.items
      : [];

    if (transcriptItems.length === 0) {
      appendKnownReplayItems();
      continue;
    }

    for (const transcriptItem of transcriptItems) {
      const rendered = renderTranscriptItemForRuntimeContext(transcriptItem);
      if (rendered) {
        items.push(rendered);
      }
    }

    appendKnownReplayItems();
  }

  items.push(...inputItemsBeforeCurrentTurn);

  if (triggerInputMode === 'fresh_trigger') {
    items.push(...(precomputedCurrentTurnInputItems ?? buildCurrentTurnInputItems(queueMessage, runtimePrompt)));
  }
  if (developerContextParts.dynamicContext) {
    items.push({
      type: 'message',
      role: 'developer',
      content: developerContextParts.dynamicContext
    });
  }
  return items;
}

function splitDeveloperContextBlock(developerContextBlock: string | null | undefined) {
  const block = developerContextBlock
    ?.replace(/<current_relationship>[\s\S]*?<\/current_relationship>/g, '')
    .trim();
  if (!block) {
    return {
      dynamicContext: null,
      capabilityRefresh: false
    };
  }

  const capabilityRefresh = /<capability_refresh\b/i.test(block)
    || /<CAPABILITY_REFRESH\b/.test(block);
  const dynamicContext = block;

  return {
    dynamicContext: dynamicContext || null,
    capabilityRefresh
  };
}

function normalizeResponseInputItems(items: OpenResponseInputItem[]): OpenResponseInputItem[] {
  return items
    .map(normalizeReplayInputItem)
    .filter((item): item is OpenResponseInputItem => Boolean(item));
}

type ResponseReplayInputItem = OpenResponseInputItem;

function normalizeReplayInputItem(item: unknown): ResponseReplayInputItem | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }
  const type = (item as { type?: unknown }).type;
  if (typeof type !== 'string' || !type.trim()) {
    return null;
  }
  return JSON.parse(JSON.stringify(item)) as ResponseReplayInputItem;
}

function stackRowContentAsReplayInputItems(row: Record<string, unknown>): unknown[] {
  if (row.visibility !== 'model_visible') {
    return [];
  }
  const content = row.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return [];
  }
  const inputItems = (content as { input_items?: unknown }).input_items;
  if (Array.isArray(inputItems)) {
    return inputItems;
  }
  return [content];
}

// Map one flat agent_stack_items row to a degenerate single-block history "turn".
// id = stack_index (dense ascending; replaces conversation_id as the order/cutoff key).
// stackReplayItems = this block's model-visible replay items. opensCallId/closesCallId
// expose the tool-pair info the block-budget planner needs to cut on a clean boundary:
// a function_call OPENS its tool_call_id, a function_call_output CLOSES it.
function mapStackRowToHistoryBlock(row: Record<string, unknown>): StackBackedConversationTurn {
  const rawStackIndex = row.stackIndex ?? row.stack_index;
  const stackIndex = typeof rawStackIndex === 'number' ? rawStackIndex : Number(rawStackIndex);
  const itemKind = String(row.itemKind ?? row.item_kind ?? '');
  const rawToolCallId = row.toolCallId ?? row.tool_call_id ?? null;
  const toolCallId = rawToolCallId === null || typeof rawToolCallId === 'undefined' ? null : String(rawToolCallId);
  return {
    id: Number.isFinite(stackIndex) ? Math.trunc(stackIndex) : 0,
    userId: 0,
    groupId: null,
    batchId: null,
    sessionKey: null,
    userMessage: '',
    aiResponse: null,
    items: [],
    opensCallId: itemKind === 'function_call' ? toolCallId : null,
    closesCallId: itemKind === 'function_call_output' ? toolCallId : null,
    stackReplayItems: extractResponseReplayInputItemsFromStackRows([row])
  };
}

function extractResponseReplayInputItemsFromStackRows(rows: Array<Record<string, unknown>>): ResponseReplayInputItem[] {
  return extractResponseReplayInputItems(rows.flatMap(stackRowContentAsReplayInputItems) as OpenResponseInputItem[]);
}

function extractResponseReplayInputItems(items: OpenResponseInputItem[]): ResponseReplayInputItem[] {
  return items
    .map(normalizeReplayInputItem)
    .filter((item): item is ResponseReplayInputItem => Boolean(item));
}

function buildTurnResponseReplayItems(turn: StackBackedConversationTurn): OpenResponseInputItem[] {
  return extractResponseReplayInputItems(turn.stackReplayItems || []);
}

function buildCurrentTurnInputItems(
  queueMessage: QueueMessageRecord['payload'],
  runtimePrompt: Pick<ResolvedAgentRuntimePrompt, 'userPromptTemplate' | 'contextVariables' | 'runtimeVariables'>
): OpenResponseInputItem[] {
  if (isDeletedFinalAnswerReminderPayload(queueMessage)) {
    return [];
  }
  const currentMessages = buildCurrentBucketMessageParts(queueMessage);
  if (currentMessages.every((message) => !message.trim())) {
    return [];
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

  const parts = renderedMessages.filter((message) => message.trim());
  if (parts.length === 0) {
    return [];
  }
  const triggerItem = isSubconsciousAgentNotifyPayload(queueMessage)
    ? buildUserSceneInputItem(parts)
    : buildDeveloperInputItem(parts);
  // The current-turn trigger carries a fresh [当前时间] stamp every build, so the cache
  // breakpoint must NOT anchor on it: anchoring on a per-turn-varying block drifts the
  // whole cached body at every run/heartbeat boundary (the breakpoint block's bytes
  // change, so heartbeat-warmed and main-loop prefixes diverge at the tail). Tag it
  // cache_volatile so the provider's isDurableItem skips it and anchors the breakpoint on
  // the last FROZEN (replayed) message instead — the cached prefix then stays byte-
  // identical across the live build, the persisted replay, and the heartbeat fork. The
  // tag is internal (provider never forwards it to the wire). A developer-role trigger is
  // already non-durable, so the tag is a harmless no-op there.
  return [{ ...(triggerItem as Record<string, unknown>), cache_volatile: true } as unknown as OpenResponseInputItem];
}

function renderConversationInput(queueMessage: QueueMessageRecord['payload']) {
  if (isPhoneNotificationPayload(queueMessage)) {
    return renderPhoneNotification(queueMessage);
  }
  if (isImageTaskNotificationPayload(queueMessage)) {
    return renderImageTaskNotification(queueMessage);
  }
  if (isSystemReminderPayload(queueMessage)) {
    return renderSystemReminder(queueMessage);
  }
  return queueMessage.messages
    .map((message, index) => renderTranscriptBatchMessage(message, index))
    .join('\n');
}

function renderConversationStorageUserMessage(queueMessage: QueueMessageRecord['payload']) {
  return isPromptFacingRuntimeReminderPayload(queueMessage)
    ? ''
    : renderConversationInput(queueMessage);
}

function classifyRuntimeStreamInput(queueMessage: QueueMessageRecord['payload']) {
  if (isPhoneNotificationPayload(queueMessage)) {
    return 'sensory_event';
  }
  if (isImageTaskNotificationPayload(queueMessage)) {
    return 'sensory_event';
  }
  if (isSystemReminderPayload(queueMessage)) {
    return 'sensory_event';
  }
  return 'inbound_batch';
}

function buildRuntimeStreamMetadata(
  queueMessage: QueueMessageRecord['payload'],
  params: {
    contextSessionKey: string;
    responseReplayItemCount: number;
    turnsExecuted: number;
  }
) {
  return {
    stream_key: getGlobalPromptContextSessionKey(),
    context_session_key: params.contextSessionKey,
    trigger_source: queueMessage.source,
    trigger_kind: classifyRuntimeStreamInput(queueMessage),
    sensory_input: isPhoneNotificationPayload(queueMessage)
      || isImageTaskNotificationPayload(queueMessage)
      || isSystemReminderPayload(queueMessage),
    append_strategy: 'responses_replay_items',
    response_replay_item_count: params.responseReplayItemCount,
    model_request_slices: params.turnsExecuted
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
  const userId = explicitUserId
    ?? parseOptionalInteger(queueMessage.senderId)
    ?? parseOptionalInteger(queueMessage.peerId)
    ?? parseOptionalInteger(queueMessage.inboundContext.NativeChannelId);
  if (!Number.isFinite(userId)) {
    throw new Error(`Invalid private target in queue payload: sender=${queueMessage.senderId || 'unknown'}, peer=${queueMessage.peerId || 'unknown'}`);
  }
  return userId;
}

function resolveGroupTargetId(queueMessage: QueueMessageRecord['payload'], args: Record<string, unknown> = {}) {
  const explicitGroupId = resolveOptionalToolTargetId(args, 'group_id', 'target_group_id');
  if (explicitGroupId === null && queueMessage.chatType !== 'group') {
    throw new Error('Cannot derive a default group target from a non-group queue payload');
  }
  const groupId = explicitGroupId ?? Number(queueMessage.inboundContext.NativeChannelId || queueMessage.peerId);
  if (!Number.isFinite(groupId)) {
    throw new Error(
      `Invalid group target in queue payload: ${queueMessage.inboundContext.NativeChannelId || queueMessage.peerId || 'unknown'}`
    );
  }
  return groupId;
}

function buildRetryableSendToolError(
  messageType: 'private' | 'group',
  toolName: string,
  args: Record<string, unknown>,
  error: {
    errorCode: string;
    message: string;
    requiredArguments: string[];
  }
) {
  const xiaoniOs = typeof args.xiaoni_os === 'string' && args.xiaoni_os.trim()
    ? args.xiaoni_os.trim()
    : null;
  const pendingShare = typeof args.pending_share === 'string' && args.pending_share.trim()
    ? args.pending_share.trim()
    : null;

  return {
    tool_error: true,
    retryable: true,
    tool_name: toolName,
    message_type: messageType,
    error_code: error.errorCode,
    error_message: error.message,
    required_arguments: error.requiredArguments,
    received_arguments: Object.keys(args),
    sent_messages: [],
    xiaoni_os: xiaoniOs,
    pending_share: pendingShare
  };
}

function buildInternalExplicitSendTargetArgs(messageType: 'private' | 'group', queueMessage: QueueMessageRecord['payload']) {
  return messageType === 'private'
    ? { user_id: resolvePrivateTargetUserId(queueMessage) }
    : { group_id: resolveGroupTargetId(queueMessage) };
}

function resolveSessionTargets(queueMessage: QueueMessageRecord['payload']) {
  const userId = parseOptionalInteger(queueMessage.senderId)
    ?? parseOptionalInteger(queueMessage.accountId)
    ?? parseOptionalInteger(agentConfig.botAccountId)
    ?? 1129974489;
  const groupId = queueMessage.chatType === 'group'
    ? parseOptionalInteger(queueMessage.inboundContext.NativeChannelId || queueMessage.peerId)
    : null;

  return {
    userId,
    groupId: groupId !== null && Number.isFinite(groupId) ? groupId : null
  };
}

function normalizeExecEnv(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key) || entry === null || typeof entry === 'undefined') {
      continue;
    }
    env[key] = String(entry);
  }
  return env;
}

function buildExecCommandRuntimeEnv(
  toolCall?: AgentToolCall,
  queueMessage?: QueueMessageRecord['payload']
): Record<string, string> {
  const env: Record<string, string> = {};
  if (queueMessage?.traceId) {
    env.XIAONI_TRACE_ID = queueMessage.traceId;
  }
  if (queueMessage?.runId) {
    env.XIAONI_RUN_ID = queueMessage.runId;
  }
  if (queueMessage?.batchId) {
    env.XIAONI_BATCH_ID = queueMessage.batchId;
  }
  if (queueMessage?.sessionKey) {
    env.XIAONI_SESSION_KEY = queueMessage.sessionKey;
  }
  if (toolCall?.callId) {
    env.XIAONI_TOOL_CALL_ID = toolCall.callId;
  }
  if (toolCall?.name) {
    env.XIAONI_TOOL_NAME = toolCall.name;
  }
  return env;
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

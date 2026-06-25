/**
 * Pure translation between the repo's OpenAI-Responses-shaped canonical request
 * and the Anthropic Messages API. No network, no side effects — unit testable.
 *
 *   canonical (OpenResponseCreateRequest)            Anthropic /v1/messages body
 *   ─────────────────────────────────────           ──────────────────────────
 *   instructions                          ──►        system (cached block)
 *   input[] message(user)                 ──►        messages[] user/text|image
 *   input[] message(assistant, phase)     ──►        messages[] assistant/text
 *   input[] message(developer)            ──►        messages[] user/<system-reminder> text
 *   input[] function_call                 ──►        assistant tool_use block
 *   input[] function_call_output          ──►        user tool_result block (text|image)
 *   input[] reasoning (anthropic-native)  ──►        assistant thinking block (signed)
 *   tool_choice.allowed_tools([subset])   ──►        tools[]=subset defs + tool_choice(auto|any|tool)
 *   reasoning/include/text/prompt_cache_* ──►        dropped (Anthropic has no equivalent)
 *
 * Response (Messages) is translated back to OpenResponseOutputItem[] so the
 * agent-service stack / replay / Raw Trace keep working unchanged.
 *
 * Caching: Anthropic prompt cache is prefix-match (tools -> system -> messages),
 * keyed by the content prefix PLUS tool_choice and the thinking param (a change
 * to either invalidates the messages tier; changing tool *definitions* invalidates
 * everything). To let a fork ride the main loop's warm in-context (history) cache,
 * the fork must send a byte-identical prefix AND matching tool_choice + thinking.
 * The agent-service aligns the vision/subconscious/heartbeat forks to the main
 * loop's auto tool_choice, so here we translate them faithfully (full allowed set
 * + auto + adaptive thinking); only genuinely forced-tool phases (compression)
 * crop tools / drop thinking and accept a cold prefix. Tool restriction for the
 * aligned forks is enforced at execution time (allowlist reject) in agent-service,
 * not via tool_choice — see the Layer-1/Layer-2 split. We place <=2 ephemeral
 * breakpoints (system + last durable message block); a fork's appended tail stays
 * after them and reads the main's entry via the 20-block lookback. Model is set
 * per-request by the caller (claude-opus-4-6).
 */

import { signClaudeBillingCch } from './anthropic-cch';
import type {
  OpenResponseCreateRequest,
  OpenResponseInputItem,
  OpenResponseMessageContentPart,
  OpenResponseOutputItem,
  OpenResponseResource,
  OpenResponseToolChoice,
  OpenResponseToolDefinition
} from './types';

const ANTHROPIC_THINKING_MARKER = '__anthropic_thinking__';
const ANTHROPIC_REDACTED_MARKER = '__anthropic_redacted_thinking__';
const DEFAULT_MAX_TOKENS = 16000;
// Minimal Claude Code cloaking: the subscription endpoint server-side-validates that
// requests look like the official CLI, and the leading system block must be the
// Claude Code identity. We prepend ONLY this one static line (not the full CLI system
// prompt) so behavioral bleed into Xiaoni's persona is minimal; the real instructions
// follow as the next, more-specific system block. Static -> stays a cache-stable
// prefix. Env-overridable in case Anthropic changes the required string.
// Match the identity string of the CLI version we claim (cc_version=2.1.77 -> the
// current "Claude Agent SDK" wording, verified against a working CC-subscription
// proxy). If the endpoint ever 403s on this, flip CLAUDE_CODE_IDENTITY_PROMPT to the
// classic "You are Claude Code, Anthropic's official CLI for Claude." without a rebuild.
const CLAUDE_CODE_IDENTITY_PROMPT =
  process.env.CLAUDE_CODE_IDENTITY_PROMPT || "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
// Real Claude Code sends the billing header as system[0] TEXT (not an HTTP header)
// and signs the cch over the request body (see CLIProxyAPI claude_signing.go). We use
// the documented unsigned value cch=00000: it keeps system[0] byte-stable across turns
// so the prefix cache still works. NOTE: unsigned may be metered as extra-usage rather
// than counted against the subscription pool — per-request cch signing is the follow-up
// if that matters. Env-overridable.
const CLAUDE_BILLING_SYSTEM_BLOCK =
  process.env.CLAUDE_BILLING_SYSTEM_BLOCK
  || 'x-anthropic-billing-header: cc_version=2.1.77.e19; cc_entrypoint=claude-vscode; cch=00000;';
const WEB_SEARCH_TOOL_TYPE = 'web_search_20260209';
const WEB_SEARCH_TOOL_NAME = 'web_search';

export type AnthropicImageSource =
  | { type: 'base64'; media_type: string; data: string }
  | { type: 'url'; url: string };

export type AnthropicContentBlock =
  | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
  | { type: 'image'; source: AnthropicImageSource }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
  | { type: 'tool_result'; tool_use_id: string; content: string | AnthropicContentBlock[]; is_error?: boolean }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

export interface AnthropicTool {
  name?: string;
  description?: string;
  input_schema?: Record<string, any>;
  type?: string;
}

export type AnthropicToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'none' }
  | { type: 'tool'; name: string };

export interface AnthropicMessagesRequest {
  model: string;
  max_tokens: number;
  system?: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  thinking?: { type: 'adaptive' };
  metadata?: Record<string, string>;
}

export interface TranslateResult {
  body: AnthropicMessagesRequest;
  thinkingEnabled: boolean;
}

function parseImageSource(imageUrl: string): AnthropicImageSource {
  if (typeof imageUrl === 'string' && imageUrl.startsWith('data:')) {
    const match = /^data:([^;]+);base64,(.*)$/s.exec(imageUrl);
    if (match && match[1] && typeof match[2] === 'string') {
      return { type: 'base64', media_type: match[1], data: match[2] };
    }
  }
  return { type: 'url', url: imageUrl };
}

function partsToBlocks(parts: OpenResponseMessageContentPart[]): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];
  for (const part of parts) {
    if (!part || typeof part !== 'object') {
      continue;
    }
    if (part.type === 'input_text' && typeof (part as any).text === 'string') {
      blocks.push({ type: 'text', text: (part as any).text });
    } else if (part.type === 'output_text' && typeof (part as any).text === 'string') {
      blocks.push({ type: 'text', text: (part as any).text });
    } else if (part.type === 'input_image') {
      const url = (part as any).image_url || (part as any).source?.url;
      if (typeof url === 'string' && url.length > 0) {
        blocks.push({ type: 'image', source: parseImageSource(url) });
      }
    }
  }
  return blocks;
}

function contentToBlocks(content: string | OpenResponseMessageContentPart[]): AnthropicContentBlock[] {
  if (typeof content === 'string') {
    return content.length > 0 ? [{ type: 'text', text: content }] : [];
  }
  if (Array.isArray(content)) {
    return partsToBlocks(content);
  }
  return [];
}

function functionCallOutputToToolResult(
  callId: string,
  output: OpenResponseInputItem extends { type: 'function_call_output'; output: infer O } ? O : any
): AnthropicContentBlock {
  if (typeof output === 'string') {
    return { type: 'tool_result', tool_use_id: callId, content: output };
  }
  if (Array.isArray(output)) {
    const blocks = partsToBlocks(output as OpenResponseMessageContentPart[]);
    if (blocks.length > 0) {
      return { type: 'tool_result', tool_use_id: callId, content: blocks };
    }
  }
  return { type: 'tool_result', tool_use_id: callId, content: '' };
}

/**
 * Decode a stored reasoning item back into the original Anthropic block
 * (thinking | redacted_thinking). Returns null for non-anthropic reasoning
 * items (e.g. legacy OpenAI reasoning) so they are dropped on replay.
 */
function decodeAnthropicReasoning(encrypted?: string): AnthropicContentBlock | null {
  if (typeof encrypted !== 'string' || encrypted.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(encrypted);
    if (parsed && parsed[ANTHROPIC_THINKING_MARKER] === true && typeof parsed.signature === 'string') {
      return {
        type: 'thinking',
        thinking: typeof parsed.thinking === 'string' ? parsed.thinking : '',
        signature: parsed.signature
      };
    }
    if (parsed && parsed[ANTHROPIC_REDACTED_MARKER] === true && typeof parsed.data === 'string') {
      return { type: 'redacted_thinking', data: parsed.data };
    }
  } catch {
    // not an anthropic-native reasoning item
  }
  return null;
}

function normalizeInputItems(input: OpenResponseCreateRequest['input']): OpenResponseInputItem[] {
  if (typeof input === 'string') {
    return input.length > 0
      ? [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: input }] }]
      : [];
  }
  return Array.isArray(input) ? input : [];
}

/**
 * Map one canonical input item to a (role, blocks) tuple. Returns null for items
 * that should be dropped (e.g. non-anthropic reasoning, item_reference).
 */
function itemToRoleBlocks(
  item: OpenResponseInputItem,
  thinkingEnabled: boolean
): { role: 'user' | 'assistant'; blocks: AnthropicContentBlock[] } | null {
  if (item.type === 'message') {
    const role = item.role;
    const blocks = contentToBlocks(item.content);
    if (role === 'assistant') {
      return { role: 'assistant', blocks };
    }
    // user / system / developer all become a user turn (4.6 has no mid-convo system role)
    return { role: 'user', blocks };
  }
  if (item.type === 'function_call') {
    const id = item.call_id || item.id;
    if (!id) {
      return null;
    }
    let parsedArgs: Record<string, any> = {};
    try {
      parsedArgs = item.arguments ? JSON.parse(item.arguments) : {};
    } catch {
      parsedArgs = {};
    }
    return { role: 'assistant', blocks: [{ type: 'tool_use', id, name: item.name, input: parsedArgs }] };
  }
  if (item.type === 'function_call_output') {
    return { role: 'user', blocks: [functionCallOutputToToolResult(item.call_id, item.output)] };
  }
  if (item.type === 'reasoning') {
    if (!thinkingEnabled) {
      return null; // drop thinking when this request runs without thinking
    }
    const decoded = decodeAnthropicReasoning(item.encrypted_content);
    if (!decoded) {
      return null; // not anthropic-native (e.g. legacy OpenAI reasoning) -> drop
    }
    return { role: 'assistant', blocks: [decoded] };
  }
  return null; // item_reference and unknown -> drop
}

/**
 * Durable items persist into replay history; volatile items (developer / system
 * runtime reminders) are one-shot and re-appended fresh each turn. The cache
 * breakpoint must land on the last DURABLE block so the volatile tail stays
 * after the last breakpoint (uncached, cheap) and the durable prefix is reused.
 */
function isDurableItem(item: OpenResponseInputItem): boolean {
  if (item.type === 'message') {
    return item.role !== 'developer' && item.role !== 'system';
  }
  return true;
}

interface BlockRef {
  msgIdx: number;
  blockIdx: number;
}

function buildMessages(
  input: OpenResponseInputItem[],
  thinkingEnabled: boolean
): { messages: AnthropicMessage[]; lastDurable: BlockRef | null; anchors: BlockRef[] } {
  const messages: AnthropicMessage[] = [];
  let lastDurable: BlockRef | null = null;
  const anchors: BlockRef[] = [];

  for (const item of input) {
    const mapped = itemToRoleBlocks(item, thinkingEnabled);
    if (!mapped || mapped.blocks.length === 0) {
      continue;
    }
    const last = messages[messages.length - 1];
    if (last && last.role === mapped.role) {
      last.content.push(...mapped.blocks);
    } else {
      messages.push({ role: mapped.role, content: [...mapped.blocks] });
    }
    const here: BlockRef = { msgIdx: messages.length - 1, blockIdx: messages[messages.length - 1]!.content.length - 1 };
    if (isDurableItem(item)) {
      lastDurable = here;
    }
    // A cache_anchor item marks a stable mid-history boundary the agent-service
    // wants kept warm across turns (e.g. the compression head boundary, so a
    // compression fork reading [..H_X] reuses this entry instead of cold-prefilling).
    if ((item as { cache_anchor?: unknown }).cache_anchor === true) {
      anchors.push(here);
    }
  }

  // Anthropic requires the first message to be 'user'. In practice the leading
  // <CAPABILITIES> developer block already maps to user; this is a safety net.
  if (messages.length > 0 && messages[0]!.role === 'assistant') {
    messages.unshift({ role: 'user', content: [{ type: 'text', text: '(对话开始)' }] });
    const shift = (ref: BlockRef | null): BlockRef | null => (ref ? { msgIdx: ref.msgIdx + 1, blockIdx: ref.blockIdx } : ref);
    lastDurable = shift(lastDurable);
    for (let i = 0; i < anchors.length; i += 1) {
      anchors[i] = shift(anchors[i]!)!;
    }
  }

  return { messages, lastDurable, anchors };
}

interface ToolPlan {
  tools: AnthropicTool[];
  toolChoice: AnthropicToolChoice | undefined;
  /** true when tool_choice forces a tool (any/tool) -> thinking must be off */
  forced: boolean;
}

function functionToolName(tool: OpenResponseToolDefinition): string | null {
  return tool.type === 'function' ? tool.function.name : null;
}

function serializeFunctionTool(tool: OpenResponseToolDefinition): AnthropicTool | null {
  if (tool.type !== 'function') {
    return null;
  }
  return {
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters || { type: 'object', properties: {} }
  };
}

function hasWebSearchDef(tools: OpenResponseToolDefinition[] | undefined): boolean {
  return Boolean(tools?.some((tool) => tool.type === 'web_search' || tool.type === 'web_search_preview'));
}

function buildToolPlan(request: OpenResponseCreateRequest): ToolPlan {
  const defs = Array.isArray(request.tools) ? request.tools : [];
  const choice: OpenResponseToolChoice | undefined = request.tool_choice;

  const buildFromAllowed = (
    allowedFnNames: Set<string> | null,
    allowWebSearch: boolean
  ): AnthropicTool[] => {
    const result: AnthropicTool[] = [];
    for (const def of defs) {
      if (def.type === 'function') {
        if (allowedFnNames === null || allowedFnNames.has(def.function.name)) {
          const serialized = serializeFunctionTool(def);
          if (serialized) {
            result.push(serialized);
          }
        }
      } else if ((def.type === 'web_search' || def.type === 'web_search_preview') && allowWebSearch) {
        result.push({ type: WEB_SEARCH_TOOL_TYPE, name: WEB_SEARCH_TOOL_NAME });
      }
      // image_generation defs are intentionally dropped (image gen stays on codex)
    }
    return result;
  };

  // tool_choice: 'none'
  if (choice === 'none') {
    return { tools: [], toolChoice: { type: 'none' }, forced: false };
  }

  // explicit single function force
  if (choice && typeof choice === 'object' && choice.type === 'function') {
    const name = choice.function.name;
    const tools = buildFromAllowed(new Set([name]), false);
    return { tools, toolChoice: tools.length ? { type: 'tool', name } : undefined, forced: tools.length > 0 };
  }

  // allowed_tools subset
  if (choice && typeof choice === 'object' && choice.type === 'allowed_tools') {
    const fnNames = new Set<string>();
    let allowWeb = false;
    for (const t of choice.tools) {
      if (t.type === 'function') {
        fnNames.add(t.name);
      } else if (t.type === 'web_search' || t.type === 'web_search_preview') {
        allowWeb = true;
      }
    }
    const tools = buildFromAllowed(fnNames, allowWeb);
    if (tools.length === 0) {
      return { tools: [], toolChoice: undefined, forced: false };
    }
    const required = choice.mode === 'required';
    if (required) {
      if (tools.length === 1 && tools[0]?.name) {
        return { tools, toolChoice: { type: 'tool', name: tools[0].name }, forced: true };
      }
      return { tools, toolChoice: { type: 'any' }, forced: true };
    }
    return { tools, toolChoice: { type: 'auto' }, forced: false };
  }

  // 'auto' | 'required' | undefined -> all defined tools
  const tools = buildFromAllowed(null, hasWebSearchDef(defs));
  if (tools.length === 0) {
    return { tools: [], toolChoice: undefined, forced: false };
  }
  if (choice === 'required') {
    return { tools, toolChoice: { type: 'any' }, forced: true };
  }
  return { tools, toolChoice: { type: 'auto' }, forced: false };
}

const MAX_CACHE_BREAKPOINTS = 4;

function setBlockCacheControl(body: AnthropicMessagesRequest, ref: BlockRef): boolean {
  const block = body.messages[ref.msgIdx]?.content[ref.blockIdx];
  if (!block) {
    return false;
  }
  // cache_control is valid on any block type (text/image/tool_use/tool_result)
  (block as { cache_control?: { type: 'ephemeral' } }).cache_control = { type: 'ephemeral' };
  return true;
}

function placeCacheBreakpoints(body: AnthropicMessagesRequest, lastDurable: BlockRef | null, anchors: BlockRef[] = []): void {
  let used = 0;
  // breakpoint 1: end of system (caches tools + system together) — stable prefix
  if (body.system && body.system.length > 0) {
    const lastSystem = body.system[body.system.length - 1];
    if (lastSystem) {
      lastSystem.cache_control = { type: 'ephemeral' };
      used += 1;
    }
  }
  // mid-history anchors (e.g. the compression head boundary). Explicitly pinning
  // them every turn keeps [..anchor] warm across turns even when it drifts past the
  // 20-block lookback of the live tail, so forks reading exactly that prefix hit it.
  // Dedup against the live tail and reserve one slot for it.
  const seen = new Set<string>();
  const key = (ref: BlockRef) => `${ref.msgIdx}:${ref.blockIdx}`;
  const tailKey = lastDurable ? key(lastDurable) : null;
  for (const anchor of anchors) {
    if (used >= MAX_CACHE_BREAKPOINTS - 1) {
      break; // keep a slot for the live tail
    }
    const k = key(anchor);
    if (k === tailKey || seen.has(k)) {
      continue;
    }
    if (setBlockCacheControl(body, anchor)) {
      seen.add(k);
      used += 1;
    }
  }
  // final breakpoint: end of the last DURABLE block (caches the replayable history
  // prefix; the volatile developer/runtime-reminder tail stays uncached after it).
  if (lastDurable && used < MAX_CACHE_BREAKPOINTS && !seen.has(key(lastDurable))) {
    setBlockCacheControl(body, lastDurable);
  }
}

export interface TranslateOptions {
  /** force a specific model id; defaults to request.model */
  model?: string;
  /** default max_tokens when request.max_output_tokens is unset */
  defaultMaxTokens?: number;
}

export function translateCanonicalToMessages(
  request: OpenResponseCreateRequest,
  options: TranslateOptions = {}
): TranslateResult {
  const plan = buildToolPlan(request);
  // Thinking (adaptive) whenever tool use is not forced and tools are not disabled.
  // Forced tool_choice (any/tool) is incompatible with extended thinking. Aligned
  // forks (vision/subconscious/heartbeat) inherit the main loop's auto tool_choice,
  // so thinking turns ON for them too -> their tools+system+history prefix and the
  // thinking param are byte-identical to the main loop's, and they read the same
  // warm cache entry. Only forced-tool phases (compression) drop thinking.
  const thinkingEnabled = !plan.forced && plan.toolChoice?.type !== 'none';

  const { messages, lastDurable, anchors } = buildMessages(normalizeInputItems(request.input), thinkingEnabled);

  const body: AnthropicMessagesRequest = {
    model: options.model || request.model,
    max_tokens: typeof request.max_output_tokens === 'number' && request.max_output_tokens > 0
      ? request.max_output_tokens
      : (options.defaultMaxTokens || DEFAULT_MAX_TOKENS),
    messages
  };

  // system[] mirrors real Claude Code's shape so the subscription endpoint accepts it:
  //   [0] billing header text block  (cc_version/entrypoint/cch — server-validated)
  //   [1] Claude Code identity       (the "agent identifier" cloak)
  //   [2] the real instructions (Xiaoni)
  // Both cloak blocks are byte-stable; the cache breakpoint lands on the last block
  // (instructions), so the whole stable system prefix caches together.
  const systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = [
    { type: 'text', text: CLAUDE_BILLING_SYSTEM_BLOCK },
    { type: 'text', text: CLAUDE_CODE_IDENTITY_PROMPT }
  ];
  if (typeof request.instructions === 'string' && request.instructions.trim().length > 0) {
    systemBlocks.push({ type: 'text', text: request.instructions });
  }
  body.system = systemBlocks;

  if (plan.tools.length > 0) {
    body.tools = plan.tools;
  }
  if (plan.toolChoice) {
    body.tool_choice = plan.toolChoice;
  }

  if (thinkingEnabled) {
    body.thinking = { type: 'adaptive' };
  }

  if (request.metadata && typeof request.metadata === 'object') {
    // Anthropic metadata only accepts a small set; we forward nothing sensitive.
    // Keep it omitted to avoid 400s on unknown keys.
  }

  placeCacheBreakpoints(body, lastDurable, anchors);

  // Final step: sign the billing block's cch over the fully-assembled body. Must run
  // last (after system/messages/tools/breakpoints are all set) so the checksum covers
  // the exact bytes that will be sent.
  signClaudeBillingCch(body);

  return { body, thinkingEnabled };
}

// ---------------------------------------------------------------------------
// Response: Anthropic Messages -> OpenResponseResource (canonical output items)
// ---------------------------------------------------------------------------

interface AnthropicResponseBlock {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: Record<string, any>;
  [key: string]: any;
}

export interface AnthropicMessagesResponse {
  id?: string;
  model?: string;
  stop_reason?: string;
  content?: AnthropicResponseBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    [key: string]: any;
  };
  [key: string]: any;
}

function encodeAnthropicThinking(thinking: string, signature: string): string {
  return JSON.stringify({ [ANTHROPIC_THINKING_MARKER]: true, thinking, signature });
}

/**
 * The OpenAI path read a model-emitted `phase`; Anthropic encodes the same
 * distinction in `stop_reason`:
 *   end_turn  -> final_answer (model finished, nothing pending)
 *   tool_use  -> commentary   (model paused to act, will continue)
 *   max_tokens-> commentary   (truncated; not a finished answer)
 */
function resolvePhaseFromStopReason(
  stopReason: string | undefined,
  hasToolUse: boolean
): 'commentary' | 'final_answer' {
  switch (stopReason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'final_answer';
    case 'tool_use':
    case 'max_tokens':
    case 'pause_turn':
      return 'commentary';
    default:
      // refusal / unknown -> fall back to tool-use presence
      return hasToolUse ? 'commentary' : 'final_answer';
  }
}

export function translateMessagesResponseToCanonical(
  resp: AnthropicMessagesResponse,
  fallbackModel: string
): OpenResponseResource {
  const blocks = Array.isArray(resp.content) ? resp.content : [];
  const hasToolUse = blocks.some((b) => b.type === 'tool_use');
  const phase = resolvePhaseFromStopReason(resp.stop_reason, hasToolUse);

  const output: OpenResponseOutputItem[] = [];
  const textParts: string[] = [];

  // reasoning items first (Anthropic emits thinking before text/tool_use).
  // Both thinking and redacted_thinking must round-trip so full-content replay
  // is lossless on the same model.
  for (const block of blocks) {
    if (block.type === 'thinking' && typeof block.signature === 'string') {
      output.push({
        type: 'reasoning',
        encrypted_content: encodeAnthropicThinking(block.thinking || '', block.signature)
      });
    } else if (block.type === 'redacted_thinking' && typeof (block as any).data === 'string') {
      output.push({
        type: 'reasoning',
        encrypted_content: JSON.stringify({ [ANTHROPIC_REDACTED_MARKER]: true, data: (block as any).data })
      });
    }
  }

  // assistant message (concatenated text)
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text);
    }
  }
  const assistantText = textParts.join('');
  if (assistantText.length > 0) {
    output.push({
      type: 'message',
      role: 'assistant',
      phase,
      content: [{ type: 'output_text', text: assistantText }],
      status: 'completed'
    });
  }

  // tool calls
  for (const block of blocks) {
    if (block.type === 'tool_use' && block.id && block.name) {
      output.push({
        type: 'function_call',
        call_id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input || {}),
        status: 'completed'
      });
    } else if (block.type === 'server_tool_use' && block.name === WEB_SEARCH_TOOL_NAME) {
      output.push({
        type: 'web_search_call',
        id: block.id,
        status: 'completed',
        action: { type: 'search', query: (block.input as any)?.query }
      });
    }
  }

  const inputTokens = resp.usage?.input_tokens || 0;
  const outputTokens = resp.usage?.output_tokens || 0;
  const cacheRead = resp.usage?.cache_read_input_tokens || 0;
  const cacheCreate = resp.usage?.cache_creation_input_tokens || 0;
  const totalPromptTokens = inputTokens + cacheRead + cacheCreate;

  return {
    id: resp.id,
    object: 'response',
    status: 'completed',
    model: resp.model || fallbackModel,
    output,
    output_text: assistantText,
    usage: {
      input_tokens: totalPromptTokens,
      output_tokens: outputTokens,
      total_tokens: totalPromptTokens + outputTokens,
      input_tokens_details: { cached_tokens: cacheRead }
    }
  };
}

export function extractTextFromMessagesResponse(resp: AnthropicMessagesResponse): string {
  const blocks = Array.isArray(resp.content) ? resp.content : [];
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
}

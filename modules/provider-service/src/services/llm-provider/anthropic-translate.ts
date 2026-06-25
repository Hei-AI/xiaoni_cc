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
 * Caching: Anthropic prompt cache is prefix-match (tools -> system -> messages).
 * A tool_choice change invalidates only the messages tier, so cropping tools[]
 * for forced-tool phases (forks) costs nothing extra — the main-loop normal mode
 * keeps a stable warm prefix. We place <=2 ephemeral breakpoints (system + last
 * message block). Model is set per-request by the caller (claude-opus-4-6).
 */

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
const DEFAULT_MAX_TOKENS = 8192;
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
  | { type: 'thinking'; thinking: string; signature: string };

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

const FORK_METADATA_KEYS = [
  'cache_heartbeat',
  'core_memory_compression_fork',
  'subconscious_agent_fork',
  'image_vision_fork'
];

function isForkOrHeartbeat(request: OpenResponseCreateRequest): boolean {
  const meta = request.metadata || {};
  return FORK_METADATA_KEYS.some((key) => meta[key] === 'true');
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

function decodeAnthropicThinking(encrypted?: string): { thinking: string; signature: string } | null {
  if (typeof encrypted !== 'string' || encrypted.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(encrypted);
    if (parsed && parsed[ANTHROPIC_THINKING_MARKER] === true && typeof parsed.signature === 'string') {
      return { thinking: typeof parsed.thinking === 'string' ? parsed.thinking : '', signature: parsed.signature };
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
    const decoded = decodeAnthropicThinking(item.encrypted_content);
    if (!decoded) {
      return null; // not anthropic-native (e.g. legacy OpenAI reasoning) -> drop
    }
    return { role: 'assistant', blocks: [{ type: 'thinking', thinking: decoded.thinking, signature: decoded.signature }] };
  }
  return null; // item_reference and unknown -> drop
}

function buildMessages(
  input: OpenResponseInputItem[],
  thinkingEnabled: boolean
): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [];
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
  }
  return messages;
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

function placeCacheBreakpoints(body: AnthropicMessagesRequest): void {
  // breakpoint 1: end of system (caches tools + system together)
  if (body.system && body.system.length > 0) {
    const lastSystem = body.system[body.system.length - 1];
    if (lastSystem) {
      lastSystem.cache_control = { type: 'ephemeral' };
    }
  }
  // breakpoint 2: last content block of the last message (caches history prefix)
  const lastMessage = body.messages[body.messages.length - 1];
  if (lastMessage && lastMessage.content.length > 0) {
    const lastBlock = lastMessage.content[lastMessage.content.length - 1];
    if (lastBlock && (lastBlock.type === 'text')) {
      lastBlock.cache_control = { type: 'ephemeral' };
    }
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
  const fork = isForkOrHeartbeat(request);
  // Thinking (adaptive) only when this request is NOT forced-tool and NOT a fork.
  // Forced tool_choice (any/tool) is incompatible with extended thinking, and
  // forks run deterministically without thinking.
  const thinkingEnabled = !fork && !plan.forced && plan.toolChoice?.type !== 'none';

  const messages = buildMessages(normalizeInputItems(request.input), thinkingEnabled);

  const body: AnthropicMessagesRequest = {
    model: options.model || request.model,
    max_tokens: typeof request.max_output_tokens === 'number' && request.max_output_tokens > 0
      ? request.max_output_tokens
      : (options.defaultMaxTokens || DEFAULT_MAX_TOKENS),
    messages
  };

  if (typeof request.instructions === 'string' && request.instructions.trim().length > 0) {
    body.system = [{ type: 'text', text: request.instructions }];
  }

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

  placeCacheBreakpoints(body);

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

export function translateMessagesResponseToCanonical(
  resp: AnthropicMessagesResponse,
  fallbackModel: string
): OpenResponseResource {
  const blocks = Array.isArray(resp.content) ? resp.content : [];
  const hasToolUse = blocks.some((b) => b.type === 'tool_use');
  const phase: 'commentary' | 'final_answer' = hasToolUse ? 'commentary' : 'final_answer';

  const output: OpenResponseOutputItem[] = [];
  const textParts: string[] = [];

  // reasoning items first (Anthropic emits thinking before text/tool_use)
  for (const block of blocks) {
    if (block.type === 'thinking' && typeof block.signature === 'string') {
      output.push({
        type: 'reasoning',
        encrypted_content: encodeAnthropicThinking(block.thinking || '', block.signature)
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

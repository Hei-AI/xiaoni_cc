import fs from 'fs';
import path from 'path';
import winston from 'winston';
import {
  getTrafficLogById,
  listRuntimeIdentityActivationTraces,
  listIdentityEvidenceRefs,
  listTraceTrafficLogs,
  listAgentStackItems,
  listLlmRequestSlices,
  listToolExecutions,
  parseInstantValue,
  serializeTimestampForApi
} from '@qq-bot/persistence';
import { DatabaseManager } from './database';

type TraceConfidence = 'observed' | 'derived' | 'missing';

interface TraceSpanEventDto {
  id: string;
  name: string;
  timestamp: string | null;
  attributes: Record<string, unknown>;
}

interface TraceSpanLinkDto {
  id: string;
  linked_trace_id: string | null;
  linked_span_id: string | null;
  attributes: Record<string, unknown>;
}

interface TraceSpanDto {
  span_id: string;
  parent_span_id: string | null;
  trace_id: string;
  conversation_id: string | null;
  name: string;
  kind: 'internal' | 'client' | 'server' | 'producer' | 'consumer';
  status_code: 'unset' | 'ok' | 'error';
  status_message: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  depth: number;
  sort_key: string;
  summary: string;
  attributes: Record<string, unknown>;
  input: unknown;
  output: unknown;
  evidence: unknown;
  events: TraceSpanEventDto[];
  links: TraceSpanLinkDto[];
  confidence: TraceConfidence;
  source_ref: string | number | null;
}

interface TracePayloadTrimOptions {
  truncateLargeFields?: boolean;
  includeRawWireText?: boolean;
}

interface TraceSpanDetailDto {
  input: unknown;
  output: unknown;
  evidence: unknown;
}

const TRACE_PAYLOAD_MAX_INLINE_BYTES = 16 * 1024;

function estimateJsonBytes(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'string') {
    return Buffer.byteLength(value, 'utf8');
  }
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch (_error) {
    return Buffer.byteLength(String(value), 'utf8');
  }
}

function buildDeferredPayload(value: unknown, label: string) {
  return {
    __trace_payload_truncated: true,
    label,
    bytes: estimateJsonBytes(value),
    preview: safePreview(value, 640)
  };
}

function maybeTrimLargeField(value: unknown, label: string, options?: TracePayloadTrimOptions) {
  if (!options?.truncateLargeFields) {
    return value;
  }
  return estimateJsonBytes(value) > TRACE_PAYLOAD_MAX_INLINE_BYTES
    ? buildDeferredPayload(value, label)
    : value;
}

function parseJsonField<T>(value: any, fallback: T): T {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return fallback;
    }
  }
  if (typeof value === 'object') {
    return value as T;
  }
  return fallback;
}

function rawJsonText(value: any, fallback: string | null = null): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function normalizeIdentityEvidenceRef(row: any) {
  return {
    ...row,
    id: toNumber(row?.id) ?? row?.id,
    identity_event_id: toNumber(row?.identity_event_id) ?? row?.identity_event_id ?? null,
    change_candidate_id: toNumber(row?.change_candidate_id) ?? row?.change_candidate_id ?? null,
    accepted_fact_id: toNumber(row?.accepted_fact_id) ?? row?.accepted_fact_id ?? null,
    conversation_id: toNumber(row?.conversation_id) ?? row?.conversation_id ?? null,
    metadata: parseJsonField<Record<string, unknown> | null>(row?.metadata, null),
    created_at: toIsoString(row?.created_at)
  };
}

function normalizeRuntimeIdentityActivationTrace(row: any) {
  return {
    ...row,
    id: toNumber(row?.id) ?? row?.id,
    conversation_id: toNumber(row?.conversation_id) ?? row?.conversation_id ?? null,
    activated_refs: parseJsonField<unknown[]>(row?.activated_refs, []),
    suppressed_refs: parseJsonField<unknown[]>(row?.suppressed_refs, []),
    metadata: parseJsonField<Record<string, unknown> | null>(row?.metadata, null),
    created_at: toIsoString(row?.created_at)
  };
}

function toNumber(value: any): number | null {
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function toIsoString(value: any): string | null {
  return serializeTimestampForApi(value) as string | null;
}

function extractCachedInputTokens(tokenUsage: any): number {
  const usage = tokenUsage && typeof tokenUsage === 'object' ? tokenUsage : {};
  return toNumber(
    usage.cached_input_tokens
    ?? usage.input_tokens_details?.cached_tokens
    ?? usage.prompt_tokens_details?.cached_tokens
    ?? usage.raw_usage?.input_tokens_details?.cached_tokens
    ?? usage.raw_usage?.prompt_tokens_details?.cached_tokens
  ) ?? 0;
}

function toMillis(value: any): number | null {
  const parsed = parseInstantValue(value);
  return parsed ? parsed.getTime() : null;
}

function getDurationMs(startAt?: any, endAt?: any, fallback?: any): number | null {
  const start = toMillis(startAt);
  const end = toMillis(endAt);
  if (start !== null && end !== null) {
    return Math.max(0, end - start);
  }
  const fallbackValue = toNumber(fallback);
  return fallbackValue !== null ? Math.max(0, fallbackValue) : null;
}

function compareTimes(left: any, right: any, leftFallback = 0, rightFallback = 0): number {
  const leftTime = toMillis(left) ?? leftFallback;
  const rightTime = toMillis(right) ?? rightFallback;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return 0;
}

function safePreview(value: unknown, maxLength = 140): string {
  if (value === null || value === undefined || value === '') {
    return 'No summary available';
  }

  const raw =
    typeof value === 'string'
      ? value
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);

  const compact = raw.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return 'No summary available';
  }
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function extractRuntimeGuidanceFromCanonicalRequest(request: any): string | null {
  const inputItems = Array.isArray(request?.input) ? request.input : [];
  for (const item of inputItems) {
    if (item?.type !== 'message' || typeof item.content !== 'string') {
      continue;
    }
    const content = item.content.trim();
    if (content.startsWith('Runtime guidance:')) {
      return content;
    }
  }
  return null;
}

function enrichCanonicalRequest(request: any) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return request;
  }

  const runtimeGuidance = extractRuntimeGuidanceFromCanonicalRequest(request);
  const instructions = typeof request.instructions === 'string' ? request.instructions.trim() : '';
  const effectiveInstructions = runtimeGuidance
    ? [instructions, runtimeGuidance].filter(Boolean).join('\n\n')
    : instructions || null;

  return {
    ...request,
    runtime_guidance: runtimeGuidance,
    effective_instructions: effectiveInstructions
  };
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function extractSseFinalResponse(responseBody: string | null): {
  body: unknown;
  raw_body: string | null;
  body_format: 'json' | 'text';
  body_source: 'sse_complete' | 'raw';
} {
  if (!responseBody || typeof responseBody !== 'string') {
    return {
      body: responseBody,
      raw_body: responseBody,
      body_format: 'text',
      body_source: 'raw',
    };
  }

  const rawBody = responseBody;
  const trimmedBody = responseBody.trim();
  const parsedJsonBody = tryParseJson(trimmedBody);
  if (parsedJsonBody !== null) {
    return {
      body: parsedJsonBody,
      raw_body: rawBody,
      body_format: 'json',
      body_source: 'raw',
    };
  }

  if (!/^event:\s/m.test(responseBody) && !/^data:\s/m.test(responseBody)) {
    return {
      body: responseBody,
      raw_body: rawBody,
      body_format: 'text',
      body_source: 'raw',
    };
  }

  let completedResponse: unknown = null;
  const blocks = responseBody.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((line) => line.length > 0 && line !== '[DONE]');
    for (const line of dataLines) {
      const parsed = tryParseJson(line);
      if (!parsed || typeof parsed !== 'object') {
        continue;
      }
      const event = parsed as Record<string, unknown>;
      const type = typeof event.type === 'string' ? event.type : '';
      if (
        (type === 'response.done' || type === 'response.completed' || type === 'response.incomplete')
        && event.response
      ) {
        completedResponse = event.response;
      }
    }
  }

  if (completedResponse !== null) {
    return {
      body: completedResponse,
      raw_body: rawBody,
      body_format: 'json',
      body_source: 'sse_complete',
    };
  }

  return {
    body: responseBody,
    raw_body: rawBody,
    body_format: 'text',
    body_source: 'raw',
  };
}

function normalizeStatusCode(value: any): 'unset' | 'ok' | 'error' {
  const normalized = (value ?? '').toString().trim().toLowerCase();
  if (!normalized) {
    return 'unset';
  }
  if (['success', 'completed', 'sent', 'ok'].includes(normalized)) {
    return 'ok';
  }
  if (['failed', 'error', 'timeout', 'cancelled'].includes(normalized)) {
    return 'error';
  }
  return 'unset';
}

function normalizeLlmCall(call: any, options?: TracePayloadTrimOptions) {
  const tokenUsage = parseJsonField<any>(call.token_usage, {});
  const effectiveUnifiedConfig = parseJsonField<any>(call.effective_unified_config, null);
  const canonicalRequest = enrichCanonicalRequest(parseJsonField<any>(call.canonical_request, null));
  const wireRequest = parseJsonField<any>(call.wire_request, null);
  const canonicalResponse = parseJsonField<any>(call.canonical_response, null);
  const wireResponse = parseJsonField<any>(call.wire_response, null);
  const rawResponse = parseJsonField<any>(call.raw_response, null);
  const normalized: any = {
    id: call.id,
    llm_call_id: call.llm_call_id || null,
    trace_id: call.trace_id,
    conversation_id: call.conversation_id || null,
    agent_turn: toNumber(call.agent_turn),
    call_sequence: toNumber(call.call_sequence) || 0,
    started_at: toIsoString(call.started_at || (call.timestamp && call.api_call_time_ms
      ? new Date(new Date(call.timestamp).getTime() - Number(call.api_call_time_ms))
      : null) || call.timestamp),
    completed_at: toIsoString(call.completed_at || call.timestamp),
    duration_ms: getDurationMs(call.started_at, call.completed_at || call.timestamp, call.api_call_time_ms || call.processing_time_ms),
    status: normalizeStatusCode(call.status),
    model_name: call.model_name,
    model_provider: call.model_provider,
    agent_type: call.agent_type,
    prompt_template: call.prompt_template,
    canonical_request: maybeTrimLargeField(canonicalRequest, 'canonical_request', options),
    wire_request: maybeTrimLargeField(wireRequest, 'wire_request', options),
    canonical_response: maybeTrimLargeField(canonicalResponse, 'canonical_response', options),
    wire_response: maybeTrimLargeField(wireResponse, 'wire_response', options),
    raw_response: maybeTrimLargeField(rawResponse, 'raw_response', options),
    effective_unified_config: maybeTrimLargeField(effectiveUnifiedConfig, 'effective_unified_config', options),
    processed_response: maybeTrimLargeField(call.processed_response || null, 'processed_response', options),
    input_tokens: toNumber(call.input_tokens),
    output_tokens: toNumber(call.output_tokens),
    token_usage: tokenUsage,
    api_call_time_ms: toNumber(call.api_call_time_ms),
    processing_time_ms: toNumber(call.processing_time_ms),
    error_message: call.error_message || null,
    error_code: call.error_code || null,
    request_format_version: call.request_format_version || null,
    wire_provider_format: call.wire_provider_format || null,
    http_requests: [] as any[],
    provider_requests: [] as any[]
  };
  if (options?.includeRawWireText) {
    normalized.wire_request_raw_text = rawJsonText(call.wire_request_raw_text, rawJsonText(call.wire_request));
    normalized.wire_response_raw_text = rawJsonText(call.wire_response_raw_text, rawJsonText(call.wire_response));
  }
  return normalized;
}

function normalizeStackLlmSlice(slice: any, options?: TracePayloadTrimOptions) {
  const canonicalRequest = enrichCanonicalRequest(parseJsonField<any>(slice.canonicalRequest ?? slice.canonical_request, null));
  const wireRequest = parseJsonField<any>(slice.wireRequest ?? slice.wire_request, null);
  const canonicalResponse = parseJsonField<any>(slice.canonicalResponse ?? slice.canonical_response, null);
  const wireResponse = parseJsonField<any>(slice.wireResponse ?? slice.wire_response, null);
  const rawResponse = parseJsonField<any>(slice.rawResponse ?? slice.raw_response, null);
  const tokenUsage = parseJsonField<any>(slice.tokenUsage ?? slice.token_usage, {});
  const outputItems = parseJsonField<any[]>(slice.outputItems ?? slice.output_items, []);
  const startedAt = toIsoString(slice.createdAt ?? slice.created_at);
  const completedAt = toIsoString(slice.completedAt ?? slice.completed_at ?? slice.updatedAt ?? slice.updated_at);
  return {
    id: slice.id ?? null,
    slice_id: slice.sliceId ?? slice.slice_id,
    llm_call_id: slice.llmCallId ?? slice.llm_call_id ?? null,
    trace_id: slice.traceId ?? slice.trace_id ?? null,
    run_id: slice.runId ?? slice.run_id ?? null,
    conversation_id: slice.conversationId ?? slice.conversation_id ?? null,
    agent_turn: toNumber(slice.agentTurn ?? slice.agent_turn),
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: getDurationMs(startedAt, completedAt, slice.processingTimeMs ?? slice.processing_time_ms),
    status: normalizeStatusCode(slice.status),
    model_name: slice.modelName ?? slice.model_name ?? null,
    model_provider: slice.modelProvider ?? slice.model_provider ?? null,
    canonical_request: maybeTrimLargeField(canonicalRequest, 'canonical_request', options),
    wire_request: maybeTrimLargeField(wireRequest, 'wire_request', options),
    canonical_response: maybeTrimLargeField(canonicalResponse, 'canonical_response', options),
    wire_response: maybeTrimLargeField(wireResponse, 'wire_response', options),
    raw_response: maybeTrimLargeField(rawResponse, 'raw_response', options),
    output_items: maybeTrimLargeField(outputItems, 'output_items', options),
    token_usage: tokenUsage,
    input_start_index: toNumber(slice.inputStartIndex ?? slice.input_start_index),
    input_end_index: toNumber(slice.inputEndIndex ?? slice.input_end_index),
    output_start_index: toNumber(slice.outputStartIndex ?? slice.output_start_index),
    output_end_index: toNumber(slice.outputEndIndex ?? slice.output_end_index),
    input_tokens: toNumber(tokenUsage.input_tokens),
    output_tokens: toNumber(tokenUsage.output_tokens),
    request_format_version: slice.requestFormatVersion ?? slice.request_format_version ?? null,
    wire_provider_format: slice.wireProviderFormat ?? slice.wire_provider_format ?? null,
    metadata: parseJsonField<any>(slice.metadata, {}),
    ...(options?.includeRawWireText
      ? {
          wire_request_raw_text: rawJsonText(slice.wireRequest ?? slice.wire_request),
          wire_response_raw_text: rawJsonText(slice.wireResponse ?? slice.wire_response)
        }
      : {})
  };
}

function normalizeStackToolExecution(row: any) {
  const startedAt = toIsoString(row.startedAt ?? row.started_at ?? row.createdAt ?? row.created_at);
  const completedAt = toIsoString(row.completedAt ?? row.completed_at ?? row.updatedAt ?? row.updated_at);
  return {
    id: row.id ?? null,
    execution_id: row.executionId ?? row.execution_id ?? null,
    llm_request_slice_id: row.llmRequestSliceId ?? row.llm_request_slice_id ?? null,
    llm_call_id: row.llmCallId ?? row.llm_call_id ?? null,
    tool_call_id: row.toolCallId ?? row.tool_call_id ?? null,
    tool_name: row.toolName ?? row.tool_name ?? null,
    arguments: parseJsonField<any>(row.arguments, {}),
    raw_arguments: row.rawArguments ?? row.raw_arguments ?? null,
    result: parseJsonField<any>(row.result, {}),
    status: normalizeStatusCode(row.status),
    error_message: row.errorMessage ?? row.error_message ?? null,
    side_effect: Boolean(row.sideEffect ?? row.side_effect),
    trace_id: row.traceId ?? row.trace_id ?? null,
    run_id: row.runId ?? row.run_id ?? null,
    conversation_id: row.conversationId ?? row.conversation_id ?? null,
    agent_turn: toNumber(row.agentTurn ?? row.agent_turn),
    stack_call_item_id: row.stackCallItemId ?? row.stack_call_item_id ?? null,
    stack_output_item_id: row.stackOutputItemId ?? row.stack_output_item_id ?? null,
    metadata: parseJsonField<any>(row.metadata, {}),
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: getDurationMs(startedAt, completedAt)
  };
}

function buildPlaygroundCapability(call: any): 'exact' | 'unsupported' {
  return call.canonical_request && call.effective_unified_config ? 'exact' : 'unsupported';
}

function buildPlaygroundSnapshot(call: any, spanId: string) {
  return {
    traceId: call.trace_id || null,
    conversationId: call.conversation_id || null,
    llmCallId: call.llm_call_id || null,
    spanId,
    agentTurn: call.agent_turn ?? null,
    provider: call.model_provider || null,
    modelName: call.model_name || null,
    canonicalRequest: call.canonical_request,
    canonicalResponse: call.canonical_response,
    wireRequest: call.wire_request,
    wireResponse: call.wire_response,
    requestFormatVersion: call.request_format_version || null,
    wireProviderFormat: call.wire_provider_format || null,
    effectiveUnifiedConfig: call.effective_unified_config || null
  };
}

function buildSyntheticProviderRequestSpanId(call: any): string {
  if (call.llm_call_id) {
    return `provider-request:wire:${call.llm_call_id}`;
  }
  const sliceId = typeof call.slice_id === 'string' && call.slice_id.trim()
    ? call.slice_id.trim()
    : String(call.id || 'unknown');
  return `provider-request:slice:${encodeURIComponent(sliceId)}`;
}

function parseSyntheticProviderRequestSpanId(spanId: string): { llmCallId: string | null; sliceId: string | null } | null {
  if (spanId.startsWith('provider-request:wire:')) {
    const rawId = spanId.slice('provider-request:wire:'.length);
    return rawId ? { llmCallId: rawId, sliceId: null } : null;
  }

  if (spanId.startsWith('provider-request:slice:')) {
    const rawId = spanId.slice('provider-request:slice:'.length);
    if (!rawId) {
      return null;
    }
    try {
      return { llmCallId: null, sliceId: decodeURIComponent(rawId) };
    } catch {
      return { llmCallId: null, sliceId: rawId };
    }
  }

  return null;
}

function syntheticProviderHost(call: any): string {
  if (call.model_provider === 'codex') {
    return 'CLIProxyAPI';
  }
  return call.model_provider || 'provider';
}

function syntheticProviderPath(call: any): string {
  const format = typeof call.wire_provider_format === 'string' ? call.wire_provider_format : '';
  if (format.includes('/responses')) {
    return '/responses';
  }
  return format || 'wire_payload';
}

type CliProxyApiLogSection = {
  title: string;
  body: string;
};

type ParsedCliProxyApiLogPart = {
  metadata: Record<string, string>;
  headers: Record<string, string | string[]>;
  rawBody: string;
  body: unknown;
};

type ParsedCliProxyApiLogDetail = {
  logFile: string;
  request: ParsedCliProxyApiLogPart | null;
  response: ParsedCliProxyApiLogPart | null;
};

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'openai-api-key',
  'proxy-authorization'
]);

function redactSensitiveHeaders(headers: Record<string, string | string[]> | null | undefined): Record<string, string | string[]> | null {
  if (!headers) {
    return null;
  }
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key,
    SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) ? '[redacted]' : value
  ]));
}

function isSafeCliProxyCorrelationId(value: string): boolean {
  return /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
}

function cliProxyRequestLogDir(): string | null {
  if (process.env.CLIPROXY_REQUEST_LOG_DETAIL_ENABLED !== 'true') {
    return null;
  }
  const configured = (process.env.CLIPROXY_REQUEST_LOG_DIR || '').trim();
  if (!configured) {
    return null;
  }
  const resolved = path.resolve(configured);
  try {
    const stat = fs.statSync(resolved);
    return stat.isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function cliProxyLogScanLimit(): number {
  const parsed = Number.parseInt(process.env.CLIPROXY_REQUEST_LOG_SCAN_LIMIT || '500', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
}

function splitCliProxyApiLogSections(content: string): CliProxyApiLogSection[] {
  const normalized = content.replace(/\r\n/g, '\n');
  const matches = Array.from(normalized.matchAll(/^=== ([^=\n]+?) ===\n/gm));
  if (matches.length === 0) {
    return [];
  }

  return matches.map((match, index) => {
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index || normalized.length : normalized.length;
    return {
      title: match[1].trim(),
      body: normalized.slice(start, end)
    };
  });
}

function parseCliProxyMetadata(block: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  block.split('\n').forEach((line) => {
    const match = line.match(/^([^:\n]+):\s*(.*)$/);
    if (!match) {
      return;
    }
    const key = match[1].trim();
    if (!key) {
      return;
    }
    metadata[key] = match[2].trim();
  });
  return metadata;
}

function parseCliProxyHeaders(block: string): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  block.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '<none>') {
      return;
    }
    const match = line.match(/^([^:\n]+):\s*(.*)$/);
    if (!match) {
      return;
    }
    const key = match[1].trim();
    const value = match[2].trim();
    if (!key) {
      return;
    }
    const existing = headers[key];
    if (existing === undefined) {
      headers[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      headers[key] = [existing, value];
    }
  });
  return headers;
}

function cliProxyHeadersContainLlmCallId(headers: Record<string, string | string[]>, llmCallId: string): boolean {
  const expected = llmCallId.trim();
  return Object.entries(headers).some(([key, value]) => {
    if (key.toLowerCase() !== 'x-llm-call-id') {
      return false;
    }
    const values = Array.isArray(value) ? value : [value];
    return values.some((headerValue) => headerValue.trim() === expected);
  });
}

function cliProxyLogHasLlmCallHeader(content: string, llmCallId: string): boolean {
  const sections = splitCliProxyApiLogSections(content);
  for (const section of sections) {
    if (section.title === 'HEADERS' && cliProxyHeadersContainLlmCallId(parseCliProxyHeaders(section.body), llmCallId)) {
      return true;
    }
    if (/^API REQUEST(?:\s+\d+)?$/.test(section.title)) {
      const requestPart = parseCliProxyApiLogPart(section.body);
      if (cliProxyHeadersContainLlmCallId(requestPart.headers, llmCallId)) {
        return true;
      }
    }
  }
  return false;
}

function parseCliProxyBody(rawBody: string): unknown {
  const body = rawBody.trim();
  if (!body || body === '<empty>') {
    return null;
  }
  if (body.startsWith('{') || body.startsWith('[')) {
    try {
      return JSON.parse(body);
    } catch {
      return rawBody.trimEnd();
    }
  }
  return rawBody.trimEnd();
}

function parseCliProxyApiLogPart(sectionBody: string): ParsedCliProxyApiLogPart {
  const normalized = sectionBody.replace(/\r\n/g, '\n');
  const headersMarker = '\nHeaders:\n';
  const bodyMarker = '\nBody:\n';
  const headersIndex = normalized.indexOf(headersMarker);

  if (headersIndex === -1) {
    return {
      metadata: parseCliProxyMetadata(normalized),
      headers: {},
      rawBody: '',
      body: null
    };
  }

  const metadataText = normalized.slice(0, headersIndex);
  const afterHeaders = normalized.slice(headersIndex + headersMarker.length);
  const bodyIndex = afterHeaders.indexOf(bodyMarker);
  const headersText = bodyIndex === -1 ? afterHeaders : afterHeaders.slice(0, bodyIndex);
  const rawBody = bodyIndex === -1 ? '' : afterHeaders.slice(bodyIndex + bodyMarker.length).trimEnd();

  return {
    metadata: parseCliProxyMetadata(metadataText),
    headers: parseCliProxyHeaders(headersText),
    rawBody,
    body: parseCliProxyBody(rawBody)
  };
}

function inferCliProxyBodyFormat(body: unknown): string {
  if (body === null || body === undefined) {
    return 'empty';
  }
  if (typeof body !== 'string') {
    return 'json';
  }
  const trimmed = body.trimStart();
  if (trimmed.startsWith('event:') || trimmed.startsWith('data:')) {
    return 'sse';
  }
  return 'text';
}

function parseCliProxyApiRequestLog(content: string, logFile: string): ParsedCliProxyApiLogDetail | null {
  const sections = splitCliProxyApiLogSections(content);
  const requestSections = sections.filter((section) => /^API REQUEST(?:\s+\d+)?$/.test(section.title));
  const responseSections = sections.filter((section) => /^API RESPONSE(?:\s+\d+)?$/.test(section.title));
  const requestSection = requestSections.length > 0 ? requestSections[requestSections.length - 1] : null;
  const responseSection = responseSections.length > 0 ? responseSections[responseSections.length - 1] : null;

  if (!requestSection && !responseSection) {
    return null;
  }

  return {
    logFile,
    request: requestSection ? parseCliProxyApiLogPart(requestSection.body) : null,
    response: responseSection ? parseCliProxyApiLogPart(responseSection.body) : null
  };
}

function findCliProxyApiRequestLog(llmCallId: string | null | undefined, logger: winston.Logger): ParsedCliProxyApiLogDetail | null {
  const trimmed = typeof llmCallId === 'string' ? llmCallId.trim() : '';
  if (!trimmed || !isSafeCliProxyCorrelationId(trimmed)) {
    return null;
  }
  const logDir = cliProxyRequestLogDir();
  if (!logDir) {
    return null;
  }

  try {
    const files = fs.readdirSync(logDir)
      .filter((name) => name.endsWith('.log'))
      .map((name) => {
        const fullPath = path.join(logDir, name);
        const stat = fs.statSync(fullPath);
        return { name, fullPath, mtimeMs: stat.mtimeMs, size: stat.size };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, cliProxyLogScanLimit());

    for (const file of files) {
      if (file.size <= 0) {
        continue;
      }
      const content = fs.readFileSync(file.fullPath, 'utf8');
      if (!cliProxyLogHasLlmCallHeader(content, trimmed)) {
        continue;
      }
      const parsed = parseCliProxyApiRequestLog(content, file.name);
      if (parsed) {
        return parsed;
      }
    }
  } catch (error) {
    logger.warn('Failed to read CLIProxyAPI request logs for trace detail', {
      error: error instanceof Error ? error.message : String(error),
      llmCallId: trimmed,
      logDir
    });
  }

  return null;
}

function buildCliProxyApiSpanDetail(call: any, logger: winston.Logger): TraceSpanDetailDto | null {
  const log = findCliProxyApiRequestLog(call.llm_call_id, logger);
  if (!log) {
    return null;
  }

  const request = log.request;
  const response = log.response;
  const statusCode = response?.metadata?.Status ? Number.parseInt(response.metadata.Status, 10) : (call.error_message ? null : 200);

  return {
    input: {
      headers: redactSensitiveHeaders(request?.headers),
      body: request?.body ?? null,
      raw_body: request?.rawBody || null,
      method: request?.metadata?.['HTTP Method'] || 'POST',
      upstream_url: request?.metadata?.['Upstream URL'] || null,
      body_source: 'cliproxyapi.request_log.api_request'
    },
    output: {
      status_code: Number.isFinite(statusCode) ? statusCode : (call.error_message ? null : 200),
      headers: redactSensitiveHeaders(response?.headers),
      body: response?.body ?? null,
      raw_body: response?.rawBody || null,
      body_format: inferCliProxyBodyFormat(response?.body),
      body_source: 'cliproxyapi.request_log.api_response',
      error_message: call.error_message
    },
    evidence: {
      synthetic: true,
      source: 'cliproxyapi.request_log',
      fallback_source: 'llm_request_slices.wire_request/wire_response',
      log_file: log.logFile,
      llm_call_id: call.llm_call_id || null,
      model_provider: call.model_provider || null,
      wire_provider_format: call.wire_provider_format || null,
      request_format_version: call.request_format_version || null,
      request_timestamp: call.started_at,
      response_timestamp: call.completed_at
    }
  };
}

function normalizeStackSliceProviderCall(slice: any) {
  const metadata = slice.metadata && typeof slice.metadata === 'object' ? slice.metadata : {};
  return {
    id: slice.slice_id || slice.id,
    slice_id: slice.slice_id || null,
    llm_call_id: slice.llm_call_id || null,
    trace_id: slice.trace_id || null,
    conversation_id: slice.conversation_id || null,
    agent_turn: slice.agent_turn ?? null,
    started_at: slice.started_at,
    completed_at: slice.completed_at,
    duration_ms: slice.duration_ms,
    status: slice.status,
    model_name: slice.model_name || null,
    model_provider: slice.model_provider || null,
    canonical_request: slice.canonical_request,
    wire_request: slice.wire_request,
    canonical_response: slice.canonical_response,
    wire_response: slice.wire_response,
    input_tokens: slice.input_tokens,
    output_tokens: slice.output_tokens,
    token_usage: slice.token_usage,
    error_message: typeof metadata.errorMessage === 'string'
      ? metadata.errorMessage
      : typeof metadata.error_message === 'string'
        ? metadata.error_message
        : null,
    error_code: null,
    request_format_version: slice.request_format_version,
    wire_provider_format: slice.wire_provider_format,
    wire_request_raw_text: slice.wire_request_raw_text,
    wire_response_raw_text: slice.wire_response_raw_text
  };
}

function hasProviderWirePayload(providerCall: any): boolean {
  return providerCall?.wire_request !== null && providerCall?.wire_request !== undefined;
}

function buildStackProviderRequestSpan(params: {
  providerCall: any;
  parentSpanId: string;
  traceId: string;
  conversationId: string | null;
  agentTurn?: number | null;
}): TraceSpanDto {
  const { providerCall } = params;
  return createSpan({
    span_id: buildSyntheticProviderRequestSpanId(providerCall),
    parent_span_id: params.parentSpanId,
    trace_id: params.traceId,
    conversation_id: providerCall.conversation_id || params.conversationId,
    name: 'provider.request',
    kind: 'client',
    status_code: providerCall.status,
    status_message: providerCall.error_message || null,
    started_at: providerCall.started_at,
    ended_at: providerCall.completed_at,
    duration_ms: providerCall.duration_ms,
    summary: `POST ${syntheticProviderHost(providerCall)}${syntheticProviderPath(providerCall)} -> ${providerCall.status}`,
    attributes: {
      'semantic.role': 'provider_request',
      'semantic.display_name': `POST ${syntheticProviderHost(providerCall)}`,
      'http.method': 'POST',
      'http.url': null,
      'http.host': syntheticProviderHost(providerCall),
      'http.path': syntheticProviderPath(providerCall),
      'http.status_code': providerCall.error_message ? null : 200,
      'trace.llm_call_id': providerCall.llm_call_id || null,
      'trace.agent_turn': providerCall.agent_turn ?? params.agentTurn ?? null,
      'provider.api_type': providerCall.wire_provider_format || providerCall.model_provider || null,
      'provider.traffic_log_id': null,
      'provider.synthetic_source': 'llm_request_slices.wire_payload',
      'stack.slice_id': providerCall.slice_id || null
    },
    input: {
      headers: null,
      body: providerCall.wire_request,
      raw_body: providerCall.wire_request_raw_text || null,
      method: 'POST',
      upstream_url: null,
      body_source: 'llm_request_slices.wire_request'
    },
    output: {
      status_code: providerCall.error_message ? null : 200,
      headers: null,
      body: providerCall.wire_response,
      raw_body: providerCall.wire_response_raw_text || null,
      body_format: 'json',
      body_source: 'llm_request_slices.wire_response',
      error_message: providerCall.error_message
    },
    evidence: {
      synthetic: true,
      source: 'llm_request_slices.wire_request/wire_response',
      slice_id: providerCall.slice_id || null,
      llm_call_id: providerCall.llm_call_id || null,
      model_provider: providerCall.model_provider || null,
      wire_provider_format: providerCall.wire_provider_format || null,
      request_format_version: providerCall.request_format_version || null,
      request_body: providerCall.wire_request,
      response_body: providerCall.wire_response,
      duration_ms: providerCall.duration_ms,
      request_timestamp: providerCall.started_at,
      response_timestamp: providerCall.completed_at
    },
    events: [],
    links: [],
    confidence: 'observed',
    source_ref: providerCall.slice_id || providerCall.llm_call_id || providerCall.id
  });
}

function normalizeToolCall(call: any) {
  const result = parseJsonField<any>(call.result, null);
  return {
    id: call.id,
    tool_call_id: call.tool_call_id || null,
    trace_id: call.trace_id,
    conversation_id: call.conversation_id || null,
    job_id: call.job_id || null,
    agent_turn: toNumber(call.agent_turn),
    llm_call_id: call.llm_call_id || null,
    tool_type: call.tool_type,
    tool_name: call.tool_name,
    method_id: call.method_id || null,
    arguments: parseJsonField<any>(call.arguments, null),
    result,
    outcome: typeof result?.outcome === 'string' ? result.outcome : null,
    blocked_reason: typeof result?.blocked_reason === 'string' ? result.blocked_reason : null,
    duplicate_suppressed: Boolean(result?.duplicate_suppressed),
    status: normalizeStatusCode(call.status),
    error_message: call.error_message || null,
    execution_mode: call.execution_mode || null,
    side_effect: Boolean(call.side_effect),
    started_at: toIsoString(call.started_at),
    completed_at: toIsoString(call.completed_at || call.started_at),
    duration_ms: getDurationMs(call.started_at, call.completed_at, call.duration_ms),
    http_requests: [] as any[]
  };
}

function normalizeHttpLog(log: any, options?: TracePayloadTrimOptions) {
  const statusCode = toNumber(log.response_status);
  const normalizedResponse = extractSseFinalResponse(log.response_body || null);
  return {
    id: log.id,
    trace_id: log.trace_id || null,
    conversation_id: log.conversation_id || null,
    user_id: log.user_id || null,
    session_id: log.session_id || null,
    agent_turn: toNumber(log.agent_turn),
    llm_call_id: log.llm_call_id || null,
    tool_call_id: log.tool_call_id || null,
    request_id: log.request_id || null,
    method: log.method,
    url: log.url,
    host: log.host,
    path: log.path,
    status: statusCode !== null && statusCode < 400 ? 'ok' : (log.error_message ? 'error' : 'unset'),
    response_status: statusCode,
    request_timestamp: toIsoString(log.request_timestamp),
    response_timestamp: toIsoString(log.response_timestamp || log.request_timestamp),
    duration_ms: getDurationMs(log.request_timestamp, log.response_timestamp, log.duration_ms),
    request_headers: maybeTrimLargeField(parseJsonField<any>(log.request_headers, {}), 'request_headers', options),
    response_headers: maybeTrimLargeField(parseJsonField<any>(log.response_headers, {}), 'response_headers', options),
    request_body: maybeTrimLargeField(log.request_body || null, 'request_body', options),
    response_body: maybeTrimLargeField(log.response_body || null, 'response_body', options),
    normalized_response_body: maybeTrimLargeField(normalizedResponse.body, 'normalized_response_body', options),
    normalized_response_raw_body: maybeTrimLargeField(normalizedResponse.raw_body, 'normalized_response_raw_body', options),
    normalized_response_body_format: normalizedResponse.body_format,
    normalized_response_body_source: normalizedResponse.body_source,
    is_ai_request: Boolean(log.is_ai_request),
    api_type: log.api_type || null,
    api_version: log.api_version || null,
    error_message: log.error_message || null,
    attribution: 'unattributed' as 'tool_call_id' | 'llm_call_id' | 'time_window' | 'unattributed'
  };
}

function summarizeProviderStatuses(logs: any[]): number[] {
  return Array.from(
    new Set(
      logs
        .map((log) => toNumber(log.response_status))
        .filter((value): value is number => value !== null)
    )
  ).sort((left, right) => left - right);
}

function summarizeProviderHosts(logs: any[]): string[] {
  return Array.from(
    new Set(
      logs
        .map((log) => (typeof log.host === 'string' ? log.host.trim() : ''))
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeQueueMessage(row: any) {
  return {
    id: row.id,
    trace_id: row.trace_id,
    source: row.source || null,
    message_sid: row.message_sid || null,
    chat_type: row.chat_type || null,
    session_key: row.session_key || null,
    status: row.status || null,
    sender_id: row.sender_id || null,
    sender_name: row.sender_name || null,
    peer_id: row.peer_id || null,
    peer_name: row.peer_name || null,
    body_for_agent: row.body_for_agent || null,
    raw_payload: parseJsonField<any>(row.raw_payload, {}),
    inbound_context: parseJsonField<any>(row.inbound_context, {}),
    payload: parseJsonField<any>(row.payload, {}),
    created_at: toIsoString(row.created_at),
    processing_started_at: toIsoString(row.processing_started_at),
    completed_at: toIsoString(row.completed_at),
    conversation_id: row.conversation_id || null,
    error_message: row.error_message || null,
    result: parseJsonField<any>(row.result, {})
  };
}

function attachHttpLogs(toolCalls: any[], llmCalls: any[], httpLogs: any[]) {
  const toolById = new Map(toolCalls.filter((item) => item.tool_call_id).map((item) => [item.tool_call_id, item]));
  const llmById = new Map(llmCalls.filter((item) => item.llm_call_id).map((item) => [item.llm_call_id, item]));
  const unattributed: any[] = [];

  for (const httpLog of httpLogs) {
    if (httpLog.tool_call_id && toolById.has(httpLog.tool_call_id)) {
      httpLog.attribution = 'tool_call_id';
      toolById.get(httpLog.tool_call_id)!.http_requests.push(httpLog);
      continue;
    }

    if (httpLog.llm_call_id && llmById.has(httpLog.llm_call_id)) {
      httpLog.attribution = 'llm_call_id';
      const llmCall = llmById.get(httpLog.llm_call_id)!;
      if (httpLog.is_ai_request) {
        llmCall.provider_requests.push(httpLog);
      } else {
        llmCall.http_requests.push(httpLog);
      }
      continue;
    }

    const requestTime = toMillis(httpLog.request_timestamp);
    const matchingTool = toolCalls.find((toolCall) => {
      const start = toMillis(toolCall.started_at);
      const end = toMillis(toolCall.completed_at || toolCall.started_at);
      return requestTime !== null && start !== null && end !== null && requestTime >= start && requestTime <= end;
    });

    if (matchingTool) {
      httpLog.attribution = 'time_window';
      matchingTool.http_requests.push(httpLog);
      continue;
    }

    unattributed.push(httpLog);
  }

  return unattributed;
}

function pairTimelineEvents(events: any[]) {
  const startMap = new Map<string, any[]>();
  const spans: Array<{
    id: string;
    type: string;
    started_at: string | null;
    ended_at: string | null;
    duration_ms: number | null;
    status: 'unset' | 'ok' | 'error';
    title: string;
    summary: string;
    evidence: any;
    events: TraceSpanEventDto[];
    confidence: TraceConfidence;
  }> = [];

  const buildLifecycleType = (eventType: string, eventName: string) => {
    const combined = `${eventType}.${eventName}`.toLowerCase();
    if (combined.includes('queue')) return 'queue';
    if (combined.includes('context')) return 'context';
    if (combined.includes('decision')) return 'decision';
    if (combined.includes('delivery')) return 'delivery';
    if (combined.includes('trace')) return 'terminal';
    return eventType || 'trace';
  };

  const summarizeLifecycleEvent = (event: any) => {
    const metadata = parseJsonField<any>(event.metadata, {});
    if (event.event_type === 'participation' && event.event_name === 'decision') {
      const decision = typeof metadata.decision === 'string' ? metadata.decision : 'unknown';
      const reason = typeof metadata.reason === 'string' ? metadata.reason : 'unknown_reason';
      const confidence = typeof metadata.confidence === 'string' ? metadata.confidence : 'unknown_confidence';
      return `participation / ${decision} / ${reason} / ${confidence}`;
    }
    return `${event.event_type} / ${event.event_name} / ${event.event_phase || 'instant'}`;
  };

  const buildLifecycleAttributes = (event: any) => {
    const metadata = parseJsonField<any>(event.metadata, {});
    const attributes: Record<string, unknown> = {
      metadata
    };
    if (event.event_type === 'participation' && event.event_name === 'decision') {
      attributes['participation.decision'] = metadata.decision || null;
      attributes['participation.reason'] = metadata.reason || null;
      attributes['participation.confidence'] = metadata.confidence || null;
      attributes['participation.used_embeddings'] = metadata.used_embeddings ?? null;
      attributes['participation.used_llm_judge'] = metadata.used_llm_judge ?? metadata.usedLlmJudge ?? null;
      attributes['participation.llm_judge_model'] = metadata.llmJudgeModel || null;
      attributes['participation.llm_judge_decision'] = metadata.llmJudgeDecision || null;
      attributes['participation.llm_judge_confidence'] = metadata.llmJudgeConfidence || null;
      attributes['participation.llm_judge_error'] = metadata.llmJudgeError || null;
      attributes['participation.conservative_fallback'] = metadata.conservative_fallback ?? null;
    }
    return attributes;
  };

  for (const event of events) {
    const key = `${event.event_type}:${event.event_name}`;
    const eventDto: TraceSpanEventDto = {
      id: `timeline-event-${event.id}`,
      name: `${event.event_type}.${event.event_name}.${event.event_phase || 'instant'}`,
      timestamp: toIsoString(event.event_time),
      attributes: {
        event_type: event.event_type,
        event_name: event.event_name,
        event_phase: event.event_phase,
        ...buildLifecycleAttributes(event)
      }
    };

    if (event.event_phase === 'start') {
      const bucket = startMap.get(key) || [];
      bucket.push(event);
      startMap.set(key, bucket);
      continue;
    }

    if (event.event_phase === 'end') {
      const bucket = startMap.get(key) || [];
      const startEvent = bucket.shift();
      if (bucket.length === 0) {
        startMap.delete(key);
      } else {
        startMap.set(key, bucket);
      }

      spans.push({
        id: `timeline-${event.id}`,
        type: buildLifecycleType(event.event_type, event.event_name),
        started_at: toIsoString(startEvent?.event_time) || toIsoString(event.event_time),
        ended_at: toIsoString(event.event_time),
        duration_ms: getDurationMs(startEvent?.event_time, event.event_time, event.duration_ms),
        status: 'ok',
        title: `${event.event_type}.${event.event_name}`,
        summary: summarizeLifecycleEvent(event),
        evidence: {
          start: startEvent || null,
          end: event
        },
        events: startEvent ? [
          {
            id: `timeline-event-${startEvent.id}`,
            name: `${startEvent.event_type}.${startEvent.event_name}.start`,
            timestamp: toIsoString(startEvent.event_time),
            attributes: buildLifecycleAttributes(startEvent)
          },
          eventDto
        ] : [eventDto],
        confidence: startEvent ? 'observed' : 'derived'
      });
      continue;
    }

    spans.push({
      id: `timeline-${event.id}`,
      type: buildLifecycleType(event.event_type, event.event_name),
      started_at: toIsoString(event.event_time),
      ended_at: toIsoString(event.event_time),
      duration_ms: event.duration_ms ?? null,
      status: normalizeStatusCode(event.event_name),
      title: `${event.event_type}.${event.event_name}`,
      summary: summarizeLifecycleEvent(event),
      evidence: event,
      events: [eventDto],
      confidence: 'observed'
    });
  }

  return spans.filter((span) => (
    span.type === 'queue'
    || span.type === 'context'
    || (span.type === 'decision' && span.title === 'participation.decision')
  ));
}

function buildSyntheticTurns(llmCalls: any[], toolCalls: any[], unattributedHttp: any[], conversation: any, latestJob: any) {
  const explicitTurns = new Set<number>();
  llmCalls.forEach((call) => {
    if (call.agent_turn !== null) explicitTurns.add(call.agent_turn);
  });
  toolCalls.forEach((call) => {
    if (call.agent_turn !== null) explicitTurns.add(call.agent_turn);
  });
  unattributedHttp.forEach((call) => {
    if (call.agent_turn !== null) explicitTurns.add(call.agent_turn);
  });

  const turnValues = explicitTurns.size > 0 ? Array.from(explicitTurns).sort((a, b) => a - b) : [1];
  return turnValues.map((turn) => {
    const turnLlmCalls = llmCalls.filter((call) => (call.agent_turn ?? 1) === turn);
    const turnToolCalls = toolCalls.filter((call) => (call.agent_turn ?? 1) === turn);
    const turnHttp = unattributedHttp.filter((log) => (log.agent_turn ?? turn) === turn);
    const turnStartCandidates = [
      ...turnLlmCalls.map((call) => call.started_at),
      ...turnToolCalls.map((call) => call.started_at),
      ...turnHttp.map((call) => call.request_timestamp)
    ].filter(Boolean);
    const turnEndCandidates = [
      ...turnLlmCalls.map((call) => call.completed_at),
      ...turnToolCalls.map((call) => call.completed_at),
      ...turnHttp.map((call) => call.response_timestamp)
    ].filter(Boolean);

    return {
      turn,
      started_at: turnStartCandidates.sort()[0] || null,
      ended_at: turnEndCandidates.sort().slice(-1)[0] || turnStartCandidates.sort().slice(-1)[0] || null,
      duration_ms: getDurationMs(turnStartCandidates.sort()[0], turnEndCandidates.sort().slice(-1)[0]),
      llm_calls: turnLlmCalls,
      tool_calls: turnToolCalls,
      unattributed_http: turnHttp,
      outcome: turn === turnValues[turnValues.length - 1]
        ? {
            conversation_status: conversation.status,
            job_status: latestJob?.status || null,
            final_response: conversation.ai_response || latestJob?.final_response || null,
            error_message: conversation.error_reason || latestJob?.error_message || null
          }
        : null
    };
  });
}

function createSpan(params: Omit<TraceSpanDto, 'depth' | 'sort_key'>): TraceSpanDto {
  return {
    ...params,
    depth: 0,
    sort_key: ''
  };
}

function assignTreeMetadata(spans: TraceSpanDto[], rootSpanId: string) {
  const byId = new Map(spans.map((span) => [span.span_id, span]));
  const children = new Map<string, TraceSpanDto[]>();

  spans.forEach((span) => {
    if (span.span_id === rootSpanId) {
      return;
    }
    const parentId = span.parent_span_id && byId.has(span.parent_span_id) ? span.parent_span_id : rootSpanId;
    span.parent_span_id = parentId;
    const bucket = children.get(parentId) || [];
    bucket.push(span);
    children.set(parentId, bucket);
  });

  children.forEach((bucket) => {
    bucket.sort((left, right) => {
      const timeOrder = compareTimes(left.started_at, right.started_at);
      if (timeOrder !== 0) {
        return timeOrder;
      }
      return left.span_id.localeCompare(right.span_id);
    });
  });

  const visit = (spanId: string, depth: number, prefix: string) => {
    const bucket = children.get(spanId) || [];
    bucket.forEach((child, index) => {
      child.depth = depth;
      child.sort_key = `${prefix}.${String(index + 1).padStart(3, '0')}`;
      visit(child.span_id, depth + 1, child.sort_key);
    });
  };

  const root = byId.get(rootSpanId);
  if (root) {
    root.depth = 0;
    root.sort_key = '000';
    visit(rootSpanId, 1, '000');
  }
}

export async function buildConversationTracePayload(
  database: DatabaseManager,
  logger: winston.Logger,
  conversationId: string
) {
  const conversations = await database.executeQuery(
    `SELECT id, trace_id, batch_id, user_id, group_id, user_message, ai_response, status,
            error_reason, response_time, model_name, raw_request, timestamp
     FROM conversations
     WHERE id = ?`,
    [conversationId]
  );

  if (!conversations || conversations.length === 0) {
    return null;
  }

  const conversation = conversations[0] as any;
  const traceId = conversation.trace_id || `conversation-${conversationId}`;

  const safeQuery = async (sql: string, params: any[] = [], label: string) => {
    try {
      return await database.executeQuery(sql, params);
    } catch (error) {
      logger.warn(`Trace query failed: ${label}`, {
        error: error instanceof Error ? error.message : String(error),
        conversationId,
        traceId
      });
      return [];
    }
  };

  const queueQuery = `
    SELECT q.*
    FROM agent_queue_messages q
    INNER JOIN (
      SELECT id, created_at
      FROM agent_queue_messages
      WHERE trace_id = ?
      UNION DISTINCT
      SELECT id, created_at
      FROM agent_queue_messages
      WHERE conversation_id = ?
    ) matched ON matched.id = q.id
    ORDER BY matched.created_at ASC, matched.id ASC
  `;

  const safeTrafficQuery = async () => {
    try {
      return await listTraceTrafficLogs({
        traceId,
        conversationId
      });
    } catch (error) {
      logger.warn('Trace query failed: traffic persistence', {
        error: error instanceof Error ? error.message : String(error),
        conversationId,
        traceId
      });
      return [];
    }
  };

  const safeRuntimeIdentityActivationTraceQuery = async () => {
    try {
      return await listRuntimeIdentityActivationTraces({
        traceId,
        conversationId,
        limit: 100
      });
    } catch (error) {
      logger.warn('Trace query failed: runtime identity activation traces', {
        error: error instanceof Error ? error.message : String(error),
        conversationId,
        traceId
      });
      return [];
    }
  };

  const safeIdentityEvidenceRefQuery = async () => {
    try {
      return await listIdentityEvidenceRefs({
        traceId,
        limit: 200
      });
    } catch (error) {
      logger.warn('Trace query failed: identity evidence refs', {
        error: error instanceof Error ? error.message : String(error),
        conversationId,
        traceId
      });
      return [];
    }
  };

  const safeStackSliceQuery = async () => {
    try {
      const byConversation = await listLlmRequestSlices({
        conversationId,
        limit: 500
      }) as any[];
      const byTrace = await listLlmRequestSlices({
        traceId,
        limit: 500
      }) as any[];
      const bySliceId = new Map<string, any>();
      [...byConversation, ...byTrace].forEach((slice) => {
        const sliceId = slice?.sliceId || slice?.slice_id;
        if (sliceId) {
          bySliceId.set(sliceId, slice);
        }
      });
      return Array.from(bySliceId.values());
    } catch (error) {
      logger.warn('Trace query failed: Xiaoni agent stack LLM slices', {
        error: error instanceof Error ? error.message : String(error),
        conversationId,
        traceId
      });
      return [];
    }
  };

  const safeStackToolExecutionQuery = async () => {
    try {
      const byConversation = await listToolExecutions({
        conversationId,
        limit: 500
      }) as any[];
      const byTrace = await listToolExecutions({
        traceId,
        limit: 500
      }) as any[];
      const byExecutionId = new Map<string, any>();
      [...byConversation, ...byTrace].forEach((tool) => {
        const executionId = tool?.executionId || tool?.execution_id || tool?.id;
        if (executionId) {
          byExecutionId.set(String(executionId), tool);
        }
      });
      return Array.from(byExecutionId.values());
    } catch (error) {
      logger.warn('Trace query failed: Xiaoni tool executions', {
        error: error instanceof Error ? error.message : String(error),
        conversationId,
        traceId
      });
      return [];
    }
  };

  const safeStackItemQuery = async () => {
    try {
      const byConversation = await listAgentStackItems({
        conversationId,
        limit: 1000
      }) as any[];
      const byTrace = await listAgentStackItems({
        traceId,
        limit: 1000
      }) as any[];
      const byId = new Map<string, any>();
      [...byConversation, ...byTrace].forEach((item) => {
        const id = item?.id || item?.eventId || item?.event_id;
        if (id) {
          byId.set(String(id), item);
        }
      });
      return Array.from(byId.values());
    } catch (error) {
      logger.warn('Trace query failed: Xiaoni agent stack items', {
        error: error instanceof Error ? error.message : String(error),
        conversationId,
        traceId
      });
      return [];
    }
  };

  const [
    llmCallRows,
    toolCallRows,
    httpRows,
    websocketRows,
    timelineRows,
    llmJobRows,
    queueRows,
    runtimeIdentityActivationTraceRows,
    identityEvidenceRefRows,
    stackSliceRows,
    stackToolExecutionRows,
    stackItemRows
  ] = await Promise.all([
    Promise.resolve([]),
    Promise.resolve([]),
    safeTrafficQuery(),
    safeQuery(
      `SELECT * FROM websocket_logs
       WHERE trace_id = ?
       ORDER BY timestamp ASC, id ASC`,
      [traceId],
      'websocket_logs'
    ),
    safeQuery(
      `SELECT * FROM timeline_events
       WHERE trace_id = ?
       ORDER BY event_time ASC, id ASC`,
      [traceId],
      'timeline_events'
    ),
    safeQuery(
      `SELECT * FROM llm_jobs
       WHERE trace_id = ?
       ORDER BY created_at ASC, id ASC`,
      [traceId],
      'llm_jobs'
    ),
    safeQuery(
      queueQuery,
      [traceId, conversationId],
      'agent_queue_messages'
    ),
    safeRuntimeIdentityActivationTraceQuery(),
    safeIdentityEvidenceRefQuery(),
    safeStackSliceQuery(),
    safeStackToolExecutionQuery(),
    safeStackItemQuery()
  ]);

  const llmCalls = (llmCallRows as any[])
    .map((row) => normalizeLlmCall(row, { truncateLargeFields: true }))
    .sort((left, right) => {
      const timeComparison = compareTimes(
        left.started_at || left.completed_at,
        right.started_at || right.completed_at
      );
      if (timeComparison !== 0) {
        return timeComparison;
      }
      if (left.call_sequence !== right.call_sequence) {
        return left.call_sequence - right.call_sequence;
      }
      return left.id - right.id;
    });
  const stackSlices = (stackSliceRows as any[])
    .map((row) => normalizeStackLlmSlice(row, { truncateLargeFields: true }))
    .sort((left, right) => compareTimes(left.started_at, right.started_at)
      || ((left.agent_turn || 0) - (right.agent_turn || 0)));
  const stackToolExecutions = (stackToolExecutionRows as any[]).map(normalizeStackToolExecution);
  const stackToolCallIds = new Set(
    stackToolExecutions
      .map((tool) => tool.tool_call_id)
      .filter((toolCallId): toolCallId is string => typeof toolCallId === 'string' && toolCallId.trim().length > 0)
  );
  const toolCalls = (toolCallRows as any[])
    .map(normalizeToolCall)
    .filter((tool) => !tool.tool_call_id || !stackToolCallIds.has(tool.tool_call_id));
  const stackItems = Array.isArray(stackItemRows) ? stackItemRows as any[] : [];
  const httpLogs = (httpRows as any[]).map((row) => normalizeHttpLog(row, { truncateLargeFields: true }));
  const queueMessages = (queueRows as any[]).map(normalizeQueueMessage);
  const runtimeIdentityActivationTraces = Array.isArray(runtimeIdentityActivationTraceRows)
    ? (runtimeIdentityActivationTraceRows as any[]).map(normalizeRuntimeIdentityActivationTrace)
    : [];
  const identityEvidenceRefs = Array.isArray(identityEvidenceRefRows)
    ? (identityEvidenceRefRows as any[]).map(normalizeIdentityEvidenceRef)
    : [];
  const unattributedHttp = attachHttpLogs(toolCalls, llmCalls, httpLogs);
  const lifecycleSpans = pairTimelineEvents(timelineRows as any[]);
  const latestJob = (llmJobRows as any[]).length > 0 ? (llmJobRows as any[])[(llmJobRows as any[]).length - 1] : null;
  const turnSpans = buildSyntheticTurns(llmCalls, toolCalls, unattributedHttp, conversation, latestJob);

  const spanRecords: TraceSpanDto[] = [];
  const rootSpanId = `trace-root:${traceId}`;

  const rootStartedAt = [
    ...lifecycleSpans.map((span) => span.started_at),
    ...stackSlices.map((slice) => slice.started_at),
    ...stackToolExecutions.map((tool) => tool.started_at),
    ...llmCalls.map((call) => call.started_at),
    ...toolCalls.map((call) => call.started_at),
    ...httpLogs.map((log) => log.request_timestamp),
    ...queueMessages.map((message) => message.created_at),
    ...runtimeIdentityActivationTraces.map((row) => row.created_at),
    ...identityEvidenceRefs.map((row) => row.created_at),
    ...(websocketRows as any[]).map((row) => toIsoString(row.timestamp)),
    toIsoString(conversation.timestamp)
  ].filter(Boolean).sort()[0] || null;

  const rootEndedAt = [
    ...lifecycleSpans.map((span) => span.ended_at),
    ...stackSlices.map((slice) => slice.completed_at),
    ...stackToolExecutions.map((tool) => tool.completed_at),
    ...llmCalls.map((call) => call.completed_at),
    ...toolCalls.map((call) => call.completed_at),
    ...httpLogs.map((log) => log.response_timestamp),
    ...queueMessages.map((message) => message.completed_at || message.processing_started_at || message.created_at),
    ...runtimeIdentityActivationTraces.map((row) => row.created_at),
    ...identityEvidenceRefs.map((row) => row.created_at),
    ...(websocketRows as any[]).map((row) => toIsoString(row.timestamp)),
    latestJob?.completed_at,
    toIsoString(conversation.timestamp)
  ].filter(Boolean).sort().slice(-1)[0] || null;

  spanRecords.push(createSpan({
    span_id: rootSpanId,
    parent_span_id: null,
    trace_id: traceId,
    conversation_id: conversationId,
    name: 'conversation.trace',
    kind: 'internal',
    status_code: normalizeStatusCode(conversation.status),
    status_message: conversation.error_reason || null,
    started_at: rootStartedAt,
    ended_at: rootEndedAt,
    duration_ms: getDurationMs(rootStartedAt, rootEndedAt, conversation.response_time),
    summary: safePreview(conversation.ai_response || conversation.user_message || conversationId),
    attributes: {
      'semantic.role': 'trace_root',
      'semantic.display_name': 'Conversation Trace',
      'conversation.id': conversationId,
      'conversation.status': conversation.status,
      'conversation.batch_id': conversation.batch_id || null
    },
    input: parseJsonField<any>(conversation.raw_request, conversation.raw_request),
    output: {
      final_response: conversation.ai_response || null,
      response_time_ms: toNumber(conversation.response_time),
      error_reason: conversation.error_reason || null
    },
    evidence: conversation,
    events: [],
    links: [],
    confidence: 'observed',
    source_ref: conversationId
  }));

  const firstInboundRow = (websocketRows as any[]).find((row) => row.direction === 'IN');
  if (firstInboundRow) {
    const rawPayload = parseJsonField<any>(firstInboundRow.raw_payload, firstInboundRow.raw_payload);
    spanRecords.push(createSpan({
      span_id: `websocket-in:${firstInboundRow.id}`,
      parent_span_id: rootSpanId,
      trace_id: traceId,
      conversation_id: conversationId,
      name: 'ingress.message',
      kind: 'server',
      status_code: normalizeStatusCode(firstInboundRow.status),
      status_message: firstInboundRow.error_message || null,
      started_at: toIsoString(firstInboundRow.timestamp),
      ended_at: toIsoString(firstInboundRow.timestamp),
      duration_ms: toNumber(firstInboundRow.processing_time_ms),
      summary: safePreview(rawPayload?.message || rawPayload?.raw_message || conversation.user_message),
      attributes: {
        'semantic.role': 'ingress',
        'message.type': firstInboundRow.message_type,
        'message.direction': firstInboundRow.direction
      },
      input: rawPayload,
      output: parseJsonField<any>(firstInboundRow.processed_payload, null),
      evidence: {
        ...firstInboundRow,
        raw_payload: rawPayload,
        processed_payload: parseJsonField<any>(firstInboundRow.processed_payload, null),
        metadata: parseJsonField<any>(firstInboundRow.metadata, null)
      },
      events: [],
      links: [],
      confidence: 'observed',
      source_ref: firstInboundRow.id
    }));
  } else if (queueMessages.length > 0) {
    const firstQueuedMessage = queueMessages[0];
    spanRecords.push(createSpan({
      span_id: `queue-ingress:${firstQueuedMessage.id}`,
      parent_span_id: rootSpanId,
      trace_id: traceId,
      conversation_id: conversationId,
      name: 'ingress.message',
      kind: 'server',
      status_code: firstQueuedMessage.error_message ? 'error' : 'ok',
      status_message: firstQueuedMessage.error_message,
      started_at: firstQueuedMessage.created_at,
      ended_at: firstQueuedMessage.created_at,
      duration_ms: null,
      summary: safePreview(firstQueuedMessage.body_for_agent || firstQueuedMessage.raw_payload?.raw_message),
      attributes: {
        'semantic.role': 'ingress',
        'message.type': firstQueuedMessage.chat_type,
        'message.source': firstQueuedMessage.source
      },
      input: firstQueuedMessage.raw_payload,
      output: firstQueuedMessage.inbound_context,
      evidence: firstQueuedMessage,
      events: [],
      links: [],
      confidence: 'observed',
      source_ref: firstQueuedMessage.id
    }));
  }

  runtimeIdentityActivationTraces.forEach((row, index) => {
    const spanId = `runtime-identity-activation:${row.id ?? index}`;
    spanRecords.push(createSpan({
      span_id: spanId,
      parent_span_id: rootSpanId,
      trace_id: traceId,
      conversation_id: row.conversation_id || conversationId,
      name: 'identity.activation',
      kind: 'internal',
      status_code: 'ok',
      status_message: null,
      started_at: row.created_at,
      ended_at: row.created_at,
      duration_ms: null,
      summary: safePreview(row.cue_summary || row.activation_reason || row.selected_skill_ref || row.identity_key),
      attributes: {
        'semantic.role': 'identity_activation',
        'semantic.display_name': 'identity.activation',
        'identity.key': row.identity_key,
        'identity.scene_fingerprint': row.scene_fingerprint || null,
        'identity.selected_skill_ref': row.selected_skill_ref || null,
        'identity.activated_ref_count': Array.isArray(row.activated_refs) ? row.activated_refs.length : 0,
        'identity.suppressed_ref_count': Array.isArray(row.suppressed_refs) ? row.suppressed_refs.length : 0,
        'trace.run_id': row.run_id || null
      },
      input: {
        cue_summary: row.cue_summary || null,
        scene_fingerprint: row.scene_fingerprint || null
      },
      output: {
        activated_refs: row.activated_refs,
        suppressed_refs: row.suppressed_refs,
        selected_skill_ref: row.selected_skill_ref || null,
        activation_reason: row.activation_reason || null
      },
      evidence: row,
      events: [],
      links: [],
      confidence: 'observed',
      source_ref: row.id ?? index
    }));
  });

  identityEvidenceRefs.forEach((row, index) => {
    spanRecords.push(createSpan({
      span_id: `identity-evidence:${row.id ?? index}`,
      parent_span_id: rootSpanId,
      trace_id: traceId,
      conversation_id: row.conversation_id || conversationId,
      name: 'identity.evidence_ref',
      kind: 'internal',
      status_code: row.redaction_status === 'visible' ? 'ok' : 'unset',
      status_message: row.redaction_status === 'visible' ? null : row.redaction_status,
      started_at: row.created_at,
      ended_at: row.created_at,
      duration_ms: null,
      summary: safePreview(`${row.source_type}:${row.source_id}`),
      attributes: {
        'semantic.role': 'identity_evidence',
        'semantic.display_name': 'identity.evidence_ref',
        'identity.key': row.identity_key,
        'identity.event_id': row.identity_event_id || null,
        'identity.change_candidate_id': row.change_candidate_id || null,
        'identity.accepted_fact_id': row.accepted_fact_id || null,
        'identity.source_type': row.source_type,
        'identity.source_id': row.source_id,
        'identity.redaction_status': row.redaction_status,
        'identity.confidence': row.confidence,
        'trace.run_id': row.run_id || null
      },
      input: {
        source_type: row.source_type,
        source_id: row.source_id
      },
      output: {
        redaction_status: row.redaction_status,
        confidence: row.confidence
      },
      evidence: row,
      events: [],
      links: [],
      confidence: 'observed',
      source_ref: row.id ?? index
    }));
  });

  lifecycleSpans.forEach((span) => {
    const endMetadata = parseJsonField<any>(span.evidence?.end?.metadata, {});
    spanRecords.push(createSpan({
      span_id: span.id,
      parent_span_id: rootSpanId,
      trace_id: traceId,
      conversation_id: conversationId,
      name: `phase.${span.type}`,
      kind: 'internal',
      status_code: span.status,
      status_message: null,
      started_at: span.started_at,
      ended_at: span.ended_at,
      duration_ms: span.duration_ms,
      summary: safePreview(span.summary),
      attributes: {
        'semantic.role': span.type,
        'semantic.display_name': span.title,
        ...(span.type === 'decision' && span.title === 'participation.decision'
          ? {
              'participation.decision': endMetadata.decision || null,
              'participation.reason': endMetadata.reason || null,
              'participation.confidence': endMetadata.confidence || null,
              'participation.used_embeddings': endMetadata.used_embeddings ?? null,
              'participation.used_llm_judge': endMetadata.used_llm_judge ?? endMetadata.usedLlmJudge ?? null,
              'participation.llm_judge_model': endMetadata.llmJudgeModel || null,
              'participation.llm_judge_decision': endMetadata.llmJudgeDecision || null,
              'participation.llm_judge_confidence': endMetadata.llmJudgeConfidence || null,
              'participation.llm_judge_error': endMetadata.llmJudgeError || null,
              'participation.conservative_fallback': endMetadata.conservative_fallback ?? null
            }
          : {})
      },
      input: span.evidence?.start || null,
      output: span.evidence?.end || span.evidence || null,
      evidence: span.evidence,
      events: span.events,
      links: [],
      confidence: span.confidence,
      source_ref: span.id
    }));
  });

  const turnSpanIdByTurn = new Map<number, string>();
  turnSpans.forEach((turn) => {
    const turnSpanId = `turn:${traceId}:${turn.turn}`;
    turnSpanIdByTurn.set(turn.turn, turnSpanId);
    spanRecords.push(createSpan({
      span_id: turnSpanId,
      parent_span_id: rootSpanId,
      trace_id: traceId,
      conversation_id: conversationId,
      name: `turn.${turn.turn}`,
      kind: 'internal',
      status_code: normalizeStatusCode(turn.outcome?.error_message ? 'error' : 'success'),
      status_message: turn.outcome?.error_message || null,
      started_at: turn.started_at,
      ended_at: turn.ended_at,
      duration_ms: turn.duration_ms,
      summary: safePreview(turn.outcome?.final_response || `LLM ${turn.llm_calls.length} / Tool ${turn.tool_calls.length} / HTTP ${turn.unattributed_http.length}`),
      attributes: {
        'semantic.role': 'turn',
        'turn.index': turn.turn,
        'turn.llm_count': turn.llm_calls.length,
        'turn.tool_count': turn.tool_calls.length,
        'turn.http_count': turn.unattributed_http.length
      },
      input: {
        started_at: turn.started_at,
        ended_at: turn.ended_at
      },
      output: turn.outcome,
      evidence: {
        llm_calls: turn.llm_calls,
        tool_calls: turn.tool_calls,
        unattributed_http: turn.unattributed_http
      },
      events: [],
      links: [],
      confidence: 'derived',
      source_ref: turn.turn
    }));
  });

  const stackSliceSpanIdBySliceId = new Map<string, string>();
  stackSlices.forEach((slice) => {
    const spanId = `stack-slice:${slice.slice_id}`;
    if (slice.slice_id) {
      stackSliceSpanIdBySliceId.set(slice.slice_id, spanId);
    }
    const providerCall = normalizeStackSliceProviderCall(slice);
    const hasProviderRequest = hasProviderWirePayload(providerCall);
    spanRecords.push(createSpan({
      span_id: spanId,
      parent_span_id: turnSpanIdByTurn.get(slice.agent_turn ?? 1) || rootSpanId,
      trace_id: traceId,
      conversation_id: slice.conversation_id || conversationId,
      name: 'llm.request_slice',
      kind: 'client',
      status_code: slice.status,
      status_message: null,
      started_at: slice.started_at,
      ended_at: slice.completed_at,
      duration_ms: slice.duration_ms,
      summary: safePreview(slice.canonical_response || slice.raw_response || slice.output_items),
      attributes: {
        'semantic.role': 'generation',
        'semantic.actor': 'xiaoni',
        'semantic.display_name': `${slice.model_provider || 'model'} / ${slice.model_name || 'unknown'}`,
        'stack.slice_id': slice.slice_id,
        'stack.input_start_index': slice.input_start_index,
        'stack.input_end_index': slice.input_end_index,
        'stack.output_start_index': slice.output_start_index,
        'stack.output_end_index': slice.output_end_index,
        'llm.model_name': slice.model_name,
        'llm.model_provider': slice.model_provider,
        'llm.llm_call_id': slice.llm_call_id,
        'usage.input_tokens': slice.input_tokens,
        'usage.output_tokens': slice.output_tokens,
        'trace.agent_turn': slice.agent_turn,
        'provider.request_count': hasProviderRequest ? 1 : 0,
        'provider.hosts': hasProviderRequest ? [syntheticProviderHost(providerCall)] : []
      },
      input: {
        canonical_request: slice.canonical_request,
        wire_request: slice.wire_request,
        input_range: {
          start: slice.input_start_index,
          end: slice.input_end_index
        }
      },
      output: {
        canonical_response: slice.canonical_response,
        wire_response: slice.wire_response,
        raw_response: slice.raw_response,
        output_items: slice.output_items,
        token_usage: slice.token_usage
      },
      evidence: {
        ...slice,
        stack_items: stackItems.filter((item) => (item.llmRequestSliceId || item.llm_request_slice_id) === slice.slice_id),
        synthetic_provider_request: hasProviderRequest
          ? {
              span_id: buildSyntheticProviderRequestSpanId(providerCall),
              source: 'llm_request_slices.wire_request/wire_response',
              slice_id: providerCall.slice_id || null,
              llm_call_id: providerCall.llm_call_id || null,
              wire_provider_format: providerCall.wire_provider_format || null
            }
          : null
      },
      events: [],
      links: [],
      confidence: 'observed',
      source_ref: slice.slice_id
    }));

    if (hasProviderRequest) {
      spanRecords.push(buildStackProviderRequestSpan({
        providerCall,
        parentSpanId: spanId,
        traceId,
        conversationId: slice.conversation_id || conversationId,
        agentTurn: slice.agent_turn
      }));
    }
  });

  stackToolExecutions.forEach((tool) => {
    const spanId = tool.tool_call_id ? `tool-call:${tool.tool_call_id}` : `tool-exec:${tool.execution_id || tool.id}`;
    spanRecords.push(createSpan({
      span_id: spanId,
      parent_span_id: (tool.llm_request_slice_id && stackSliceSpanIdBySliceId.get(tool.llm_request_slice_id))
        || turnSpanIdByTurn.get(tool.agent_turn ?? 1)
        || rootSpanId,
      trace_id: traceId,
      conversation_id: tool.conversation_id || conversationId,
      name: 'tool.execution',
      kind: 'internal',
      status_code: tool.status,
      status_message: tool.error_message || null,
      started_at: tool.started_at,
      ended_at: tool.completed_at,
      duration_ms: tool.duration_ms,
      summary: safePreview(tool.result || tool.error_message || tool.arguments),
      attributes: {
        'semantic.role': 'invocation',
        'semantic.capability': tool.tool_name,
        'semantic.display_name': tool.tool_name,
        'tool.name': tool.tool_name,
        'tool.side_effect': tool.side_effect,
        'tool.execution_id': tool.execution_id,
        'stack.slice_id': tool.llm_request_slice_id,
        'stack.call_item_id': tool.stack_call_item_id,
        'stack.output_item_id': tool.stack_output_item_id,
        'trace.agent_turn': tool.agent_turn
      },
      input: {
        arguments: tool.arguments,
        raw_arguments: tool.raw_arguments
      },
      output: {
        result: tool.result,
        error_message: tool.error_message
      },
      evidence: tool,
      events: [],
      links: [],
      confidence: 'observed',
      source_ref: tool.execution_id || tool.id
    }));
  });

  const llmSpanIdByCallId = new Map<string, string>();
  llmCalls.forEach((call) => {
    const spanId = call.llm_call_id ? `llm-call:${call.llm_call_id}` : `llm:${call.id}`;
    const playgroundCapability = buildPlaygroundCapability(call);
    const playgroundSnapshot = buildPlaygroundSnapshot(call, spanId);
    const providerStatuses = summarizeProviderStatuses(call.provider_requests);
    const providerHosts = summarizeProviderHosts(call.provider_requests);
    if (call.llm_call_id) {
      llmSpanIdByCallId.set(call.llm_call_id, spanId);
    }
    spanRecords.push(createSpan({
      span_id: spanId,
      parent_span_id: turnSpanIdByTurn.get(call.agent_turn ?? 1) || rootSpanId,
      trace_id: traceId,
      conversation_id: call.conversation_id || conversationId,
      name: 'llm.generation',
      kind: 'client',
      status_code: call.status,
      status_message: call.error_message || null,
      started_at: call.started_at,
      ended_at: call.completed_at,
      duration_ms: call.duration_ms,
      summary: safePreview(call.processed_response || call.canonical_response || call.wire_response),
      attributes: {
        'semantic.role': 'generation',
        'semantic.actor': call.agent_type,
        'semantic.display_name': `${call.model_provider || 'model'} / ${call.model_name}`,
        'llm.model_name': call.model_name,
        'llm.model_provider': call.model_provider,
        'llm.prompt_template': call.prompt_template,
        'usage.input_tokens': call.input_tokens,
        'usage.output_tokens': call.output_tokens,
        'trace.agent_turn': call.agent_turn,
        'provider.request_count': call.provider_requests.length,
        'provider.hosts': providerHosts,
        'provider.statuses': providerStatuses,
        'playground.capability': playgroundCapability
      },
      input: {
        prompt_template: call.prompt_template,
        canonical_request: call.canonical_request,
        wire_request: call.wire_request,
        effective_unified_config: call.effective_unified_config
      },
      output: {
        processed_response: call.processed_response,
        canonical_response: call.canonical_response,
        wire_response: call.wire_response,
        raw_response: call.raw_response,
        token_usage: call.token_usage,
        error_message: call.error_message,
        error_code: call.error_code
      },
      evidence: {
        ...call,
        provider_requests: call.provider_requests.map((log: any) => ({
          traffic_log_id: log.id,
          request_id: log.request_id,
          method: log.method,
          host: log.host,
          path: log.path,
          response_status: log.response_status,
          duration_ms: log.duration_ms,
          api_type: log.api_type
        })),
        playground_capability: playgroundCapability,
        playground_source_snapshot: playgroundSnapshot
      },
      events: [],
      links: [],
      confidence: call.started_at && call.completed_at ? 'observed' : 'derived',
      source_ref: call.id
    }));

    if (call.provider_requests.length === 0) {
      return;
    }

    call.provider_requests.forEach((log: any) => {
      spanRecords.push(createSpan({
        span_id: `provider-request:${log.id}`,
        parent_span_id: spanId,
        trace_id: traceId,
        conversation_id: log.conversation_id || conversationId,
        name: 'provider.request',
        kind: 'client',
        status_code: log.status as 'unset' | 'ok' | 'error',
        status_message: log.error_message || null,
        started_at: log.request_timestamp,
        ended_at: log.response_timestamp,
        duration_ms: log.duration_ms,
        summary: `${log.method} ${log.host}${log.path || ''} -> ${log.response_status || 'pending'}`,
        attributes: {
          'semantic.role': 'provider_request',
          'semantic.display_name': `${log.method} ${log.host}`,
          'http.method': log.method,
          'http.url': log.url,
          'http.host': log.host,
          'http.path': log.path,
          'http.status_code': log.response_status,
          'trace.llm_call_id': log.llm_call_id,
          'trace.agent_turn': log.agent_turn,
          'provider.api_type': log.api_type,
          'provider.traffic_log_id': log.id
        },
        input: {
          headers: log.request_headers,
          body: log.request_body
        },
        output: {
          status_code: log.response_status,
          headers: log.response_headers,
          body: log.normalized_response_body,
          raw_body: log.normalized_response_raw_body,
          body_format: log.normalized_response_body_format,
          body_source: log.normalized_response_body_source,
          error_message: log.error_message
        },
        evidence: {
          traffic_log_id: log.id,
          request_id: log.request_id,
          llm_call_id: log.llm_call_id,
          method: log.method,
          host: log.host,
          path: log.path,
          url: log.url,
          request_headers: log.request_headers,
          request_body: log.request_body,
          response_status: log.response_status,
          response_headers: log.response_headers,
          response_body: log.response_body,
          normalized_response_body: log.normalized_response_body,
          normalized_response_body_source: log.normalized_response_body_source,
          duration_ms: log.duration_ms,
          request_timestamp: log.request_timestamp,
          response_timestamp: log.response_timestamp,
          api_type: log.api_type
        },
        events: [],
        links: [],
        confidence: 'observed',
        source_ref: log.id
      }));
    });
	  });

  const toolSpanIdByCallId = new Map<string, string>();
  toolCalls.forEach((call) => {
    const spanId = call.tool_call_id ? `tool-call:${call.tool_call_id}` : `tool:${call.id}`;
    if (call.tool_call_id) {
      toolSpanIdByCallId.set(call.tool_call_id, spanId);
    }
    const isBlockedTransition = call.outcome === 'blocked_transition';
    spanRecords.push(createSpan({
      span_id: spanId,
      parent_span_id: (call.llm_call_id && llmSpanIdByCallId.get(call.llm_call_id))
        || turnSpanIdByTurn.get(call.agent_turn ?? 1)
        || rootSpanId,
      trace_id: traceId,
      conversation_id: call.conversation_id || conversationId,
      name: isBlockedTransition ? 'tool.blocked_transition' : 'tool.invocation',
      kind: 'internal',
      status_code: call.status,
      status_message: call.error_message || null,
      started_at: call.started_at,
      ended_at: call.completed_at,
      duration_ms: call.duration_ms,
      summary: safePreview(
        (isBlockedTransition && (call.result?.reason || call.blocked_reason || call.tool_name))
          || call.result
          || call.error_message
          || call.arguments
      ),
      attributes: {
        'semantic.role': isBlockedTransition ? 'blocked_transition' : 'invocation',
        'semantic.capability': call.method_id || call.tool_name,
        'semantic.display_name': call.tool_name,
        'tool.name': call.tool_name,
        'tool.method_id': call.method_id,
        'tool.execution_mode': call.execution_mode,
        'tool.side_effect': call.side_effect,
        'trace.agent_turn': call.agent_turn,
        'tool.outcome': call.outcome,
        'tool.blocked_reason': call.blocked_reason,
        'tool.duplicate_suppressed': call.duplicate_suppressed
      },
      input: call.arguments,
      output: {
        result: call.result,
        error_message: call.error_message
      },
      evidence: call,
      events: [],
      links: [],
      confidence: call.tool_call_id ? 'observed' : 'derived',
      source_ref: call.id
    }));
  });

  const providerTrafficLogIds = new Set(
    llmCalls.flatMap((call) => call.provider_requests.map((log: any) => String(log.id)))
  );

  httpLogs.forEach((log) => {
    if (providerTrafficLogIds.has(String(log.id))) {
      return;
    }
    spanRecords.push(createSpan({
      span_id: `http:${log.id}`,
      parent_span_id: (log.tool_call_id && toolSpanIdByCallId.get(log.tool_call_id))
        || (log.llm_call_id && llmSpanIdByCallId.get(log.llm_call_id))
        || turnSpanIdByTurn.get(log.agent_turn ?? 1)
        || rootSpanId,
      trace_id: traceId,
      conversation_id: log.conversation_id || conversationId,
      name: 'http.request',
      kind: 'client',
      status_code: log.status as 'unset' | 'ok' | 'error',
      status_message: log.error_message || null,
      started_at: log.request_timestamp,
      ended_at: log.response_timestamp,
      duration_ms: log.duration_ms,
      summary: `${log.response_status || 'pending'} ${log.path}`,
      attributes: {
        'semantic.role': 'external_http',
        'semantic.display_name': `${log.method} ${log.host}`,
        'http.method': log.method,
        'http.url': log.url,
        'http.host': log.host,
        'http.path': log.path,
        'http.status_code': log.response_status,
        'trace.agent_turn': log.agent_turn,
        'trace.attribution': log.attribution
      },
      input: {
        headers: log.request_headers,
        body: log.request_body
      },
      output: {
        status_code: log.response_status,
        headers: log.response_headers,
        body: log.response_body,
        error_message: log.error_message
      },
      evidence: log,
      events: [],
      links: [],
      confidence: log.attribution === 'time_window' ? 'derived' : log.attribution === 'unattributed' ? 'missing' : 'observed',
      source_ref: log.id
    }));
  });

  const deliveryLogs = (websocketRows as any[]).filter((row) => row.direction === 'OUT');
  if (deliveryLogs.length > 0 || conversation.ai_response) {
    const lastDeliveryLog = deliveryLogs[deliveryLogs.length - 1];
    spanRecords.push(createSpan({
      span_id: `delivery:${traceId}`,
      parent_span_id: rootSpanId,
      trace_id: traceId,
      conversation_id: conversationId,
      name: 'delivery.output',
      kind: 'producer',
      status_code: deliveryLogs.length > 0 ? 'ok' : 'unset',
      status_message: null,
      started_at: toIsoString(lastDeliveryLog?.timestamp) || rootEndedAt,
      ended_at: toIsoString(lastDeliveryLog?.timestamp) || rootEndedAt,
      duration_ms: null,
      summary: safePreview(conversation.ai_response || latestJob?.final_response || 'No final response emitted'),
      attributes: {
        'semantic.role': 'delivery',
        'delivery.status': deliveryLogs.length > 0 ? 'sent' : 'generated_not_sent',
        'delivery.websocket_count': deliveryLogs.length
      },
      input: deliveryLogs,
      output: {
        final_response: conversation.ai_response || latestJob?.final_response || null,
        terminal_job_status: latestJob?.status || null
      },
      evidence: deliveryLogs,
      events: [],
      links: [],
      confidence: deliveryLogs.length > 0 ? 'observed' : 'derived',
      source_ref: traceId
    }));
  }

  spanRecords.push(createSpan({
    span_id: `terminal:${traceId}`,
    parent_span_id: rootSpanId,
    trace_id: traceId,
    conversation_id: conversationId,
    name: 'terminal.outcome',
    kind: 'consumer',
    status_code: normalizeStatusCode(conversation.status),
    status_message: conversation.error_reason || null,
    started_at: rootEndedAt,
    ended_at: rootEndedAt,
    duration_ms: getDurationMs(rootStartedAt, rootEndedAt, conversation.response_time),
    summary: safePreview(conversation.error_reason || conversation.ai_response || conversation.status),
    attributes: {
      'semantic.role': 'terminal',
      'conversation.status': conversation.status,
      'conversation.model_name': conversation.model_name || null
    },
    input: {
      started_at: rootStartedAt,
      ended_at: rootEndedAt
    },
    output: {
      final_output: conversation.ai_response || latestJob?.final_response || null,
      error_reason: conversation.error_reason || null
    },
    evidence: conversation,
    events: [],
    links: [],
    confidence: 'derived',
    source_ref: traceId
  }));

  assignTreeMetadata(spanRecords, rootSpanId);

  const orderedSpans = [...spanRecords].sort((left, right) => left.sort_key.localeCompare(right.sort_key));
  const firstErrorSpan = orderedSpans.find((span) => span.status_code === 'error') || null;
  const bottleneckSpan = [...orderedSpans]
    .filter((span) => typeof span.duration_ms === 'number')
    .sort((left, right) => (right.duration_ms || 0) - (left.duration_ms || 0))[0] || null;

  const dataQuality = {
    trace_headers_propagated: httpLogs.some((log) => log.llm_call_id || log.tool_call_id || log.agent_turn !== null || log.conversation_id) ? 'complete' : (httpLogs.length > 0 ? 'partial' : 'missing'),
    llm_logs_complete: (llmCalls.length + stackSlices.length) === 0 ? 'missing' : ([...llmCalls, ...stackSlices].every((call) => call.started_at && call.completed_at) ? 'complete' : 'partial'),
    tool_logs_complete: (toolCalls.length + stackToolExecutions.length) === 0 ? 'missing' : ([...toolCalls, ...stackToolExecutions].every((call) => call.started_at) ? 'complete' : 'partial'),
    http_logs_complete: httpLogs.length === 0 ? 'missing' : (httpLogs.every((log) => log.request_timestamp && log.response_timestamp) ? 'complete' : 'partial'),
    timeline_complete: timelineRows.length > 0 ? 'complete' : 'partial',
    identity_trace_lite: runtimeIdentityActivationTraces.length > 0 || identityEvidenceRefs.length > 0 ? 'complete' : 'missing',
    agent_stack_complete: stackSlices.length > 0 || stackItems.length > 0 ? 'complete' : 'missing'
  };
  const tokenSummary = [...llmCalls, ...stackSlices].reduce((summary, call) => {
    const inputTokens = toNumber(call.token_usage?.input_tokens ?? call.input_tokens) ?? 0;
    const outputTokens = toNumber(call.token_usage?.output_tokens ?? call.output_tokens) ?? 0;
    const cachedInputTokens = extractCachedInputTokens(call.token_usage);

    return {
      input_tokens: summary.input_tokens + inputTokens,
      output_tokens: summary.output_tokens + outputTokens,
      total_tokens: summary.total_tokens + inputTokens + outputTokens,
      cached_input_tokens: summary.cached_input_tokens + cachedInputTokens
    };
  }, {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cached_input_tokens: 0
  });

  return {
    conversation_id: conversationId,
    batch_id: conversation.batch_id || null,
    trace: {
      trace_id: traceId,
      root_span_id: rootSpanId,
      status: conversation.status,
      started_at: rootStartedAt,
      ended_at: rootEndedAt,
      duration_ms: getDurationMs(rootStartedAt, rootEndedAt, conversation.response_time),
      span_count: orderedSpans.length,
      error_count: orderedSpans.filter((span) => span.status_code === 'error').length,
      summary: safePreview(conversation.ai_response || conversation.user_message),
      first_error: firstErrorSpan ? {
        span_id: firstErrorSpan.span_id,
        title: firstErrorSpan.name,
        summary: firstErrorSpan.summary
      } : null,
      bottleneck: bottleneckSpan ? {
        span_id: bottleneckSpan.span_id,
        title: bottleneckSpan.name,
        duration_ms: bottleneckSpan.duration_ms
      } : null,
      token_summary: tokenSummary
    },
    spans: orderedSpans,
    raw_evidence: {
      conversation,
      websocket_logs: websocketRows,
      timeline_events: timelineRows,
      llm_calls: llmCalls,
      tool_calls: toolCalls,
      http_logs: httpLogs,
      agent_stack_items: stackItems,
      llm_request_slices: stackSlices,
      tool_executions: stackToolExecutions,
      llm_jobs: llmJobRows,
      queue_messages: queueMessages,
      runtime_identity_activation_traces: runtimeIdentityActivationTraces,
      identity_evidence_refs: identityEvidenceRefs
    },
    data_quality: {
      ...dataQuality,
      overall: Object.values(dataQuality).every((value) => value === 'complete') ? 'complete' : 'partial'
    }
  };
}

export async function buildConversationTraceSpanDetail(
  database: DatabaseManager,
  logger: winston.Logger,
  conversationId: string,
  spanId: string
): Promise<TraceSpanDetailDto | null> {
  const conversations = await database.executeQuery(
    `SELECT id, trace_id, batch_id, user_id, group_id, user_message, ai_response, status,
            error_reason, response_time, model_name, raw_request, timestamp
     FROM conversations
     WHERE id = ?`,
    [conversationId]
  );

  if (!conversations || conversations.length === 0) {
    return null;
  }

  const conversation = conversations[0] as any;
  const traceId = conversation.trace_id || `conversation-${conversationId}`;

  if (spanId.startsWith('stack-slice:')) {
    const sliceId = spanId.slice('stack-slice:'.length);
    const rows = await database.executeQuery(
      `SELECT * FROM llm_request_slices WHERE slice_id = ? LIMIT 1`,
      [sliceId]
    );
    const row = rows[0] as any;
    if (!row) {
      return null;
    }
    const slice = normalizeStackLlmSlice(row, { includeRawWireText: true });
    return {
      input: {
        canonical_request: slice.canonical_request,
        wire_request: slice.wire_request,
        input_range: {
          start: slice.input_start_index,
          end: slice.input_end_index
        }
      },
      output: {
        canonical_response: slice.canonical_response,
        wire_response: slice.wire_response,
        raw_response: slice.raw_response,
        output_items: slice.output_items,
        token_usage: slice.token_usage
      },
      evidence: slice
    };
  }

  if (spanId.startsWith('tool-call:')) {
    const toolCallId = spanId.slice('tool-call:'.length);
    const rows = await database.executeQuery(
      `
        SELECT *
        FROM tool_executions
        WHERE tool_call_id = ?
          AND (trace_id = ? OR conversation_id = ?)
        ORDER BY started_at DESC, id DESC
        LIMIT 1
      `,
      [toolCallId, traceId, conversationId]
    );
    const row = rows[0] as any;
    if (!row) {
      return null;
    }
    const tool = normalizeStackToolExecution(row);
    return {
      input: {
        arguments: tool.arguments,
        raw_arguments: tool.raw_arguments
      },
      output: {
        result: tool.result,
        error_message: tool.error_message
      },
      evidence: tool
    };
  }

  if (spanId.startsWith('llm-call:')) {
    const llmCallId = spanId.slice('llm-call:'.length);
    const rows = await database.executeQuery(
      `SELECT * FROM llm_request_slices WHERE llm_call_id = ? OR slice_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      [llmCallId, llmCallId]
    );
    const row = rows[0] as any;
    if (!row) {
      return null;
    }
    const slice = normalizeStackLlmSlice(row, { includeRawWireText: true });

    return {
      input: {
        canonical_request: slice.canonical_request,
        wire_request: slice.wire_request,
        input_range: {
          start: slice.input_start_index,
          end: slice.input_end_index
        }
      },
      output: {
        canonical_response: slice.canonical_response,
        wire_response: slice.wire_response,
        raw_response: slice.raw_response,
        output_items: slice.output_items,
        token_usage: slice.token_usage
      },
      evidence: slice
    };
  }

  const syntheticProviderRequest = parseSyntheticProviderRequestSpanId(spanId);
  if (syntheticProviderRequest) {
    const lookupId = syntheticProviderRequest.llmCallId || syntheticProviderRequest.sliceId;
    if (!lookupId) {
      return null;
    }
    const rows = await database.executeQuery(
      `
        SELECT *
        FROM llm_request_slices
        WHERE (llm_call_id = ? OR slice_id = ?)
          AND (trace_id = ? OR conversation_id = ?)
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
      [lookupId, lookupId, traceId, conversationId]
    );
    const row = rows[0] as any;
    if (!row) {
      return null;
    }
    const slice = normalizeStackLlmSlice(row, { includeRawWireText: true });
    const providerCall = normalizeStackSliceProviderCall(slice);
    if (!hasProviderWirePayload(providerCall)) {
      return null;
    }
    return {
      input: {
        headers: null,
        body: providerCall.wire_request,
        raw_body: providerCall.wire_request_raw_text || null,
        method: 'POST',
        upstream_url: null,
        body_source: 'llm_request_slices.wire_request'
      },
      output: {
        status_code: providerCall.error_message ? null : 200,
        headers: null,
        body: providerCall.wire_response,
        raw_body: providerCall.wire_response_raw_text || null,
        body_format: 'json',
        body_source: 'llm_request_slices.wire_response',
        error_message: providerCall.error_message
      },
      evidence: {
        synthetic: true,
        source: 'llm_request_slices.wire_request/wire_response',
        slice_id: providerCall.slice_id || null,
        llm_call_id: providerCall.llm_call_id || null,
        model_provider: providerCall.model_provider || null,
        wire_provider_format: providerCall.wire_provider_format || null,
        request_format_version: providerCall.request_format_version || null
      }
    };
  }

  if (spanId.startsWith('provider-request:') || spanId.startsWith('http:')) {
    const rawId = spanId.includes(':') ? spanId.split(':').slice(1).join(':') : spanId;
    const log = await getTrafficLogById(rawId);
    if (!log) {
      return null;
    }
    const normalizedLog = normalizeHttpLog(log);
    const responseBody = spanId.startsWith('provider-request:')
      ? normalizedLog.normalized_response_body
      : normalizedLog.response_body;
    const responseRawBody = spanId.startsWith('provider-request:')
      ? normalizedLog.normalized_response_raw_body
      : null;

    return {
      input: {
        headers: normalizedLog.request_headers,
        body: normalizedLog.request_body
      },
      output: spanId.startsWith('provider-request:')
        ? {
            status_code: normalizedLog.response_status,
            headers: normalizedLog.response_headers,
            body: responseBody,
            raw_body: responseRawBody,
            body_format: normalizedLog.normalized_response_body_format,
            body_source: normalizedLog.normalized_response_body_source,
            error_message: normalizedLog.error_message
          }
        : {
            status_code: normalizedLog.response_status,
            headers: normalizedLog.response_headers,
            body: normalizedLog.response_body,
            error_message: normalizedLog.error_message
          },
      evidence: spanId.startsWith('provider-request:')
        ? {
            traffic_log_id: normalizedLog.id,
            request_id: normalizedLog.request_id,
            llm_call_id: normalizedLog.llm_call_id,
            method: normalizedLog.method,
            host: normalizedLog.host,
            path: normalizedLog.path,
            url: normalizedLog.url,
            request_headers: normalizedLog.request_headers,
            request_body: normalizedLog.request_body,
            response_status: normalizedLog.response_status,
            response_headers: normalizedLog.response_headers,
            response_body: normalizedLog.response_body,
            normalized_response_body: normalizedLog.normalized_response_body,
            normalized_response_body_source: normalizedLog.normalized_response_body_source,
            duration_ms: normalizedLog.duration_ms,
            request_timestamp: normalizedLog.request_timestamp,
            response_timestamp: normalizedLog.response_timestamp,
            api_type: normalizedLog.api_type
          }
        : normalizedLog
    };
  }

  logger.debug('Trace span detail not required for span', { conversationId, traceId, spanId });
  return null;
}

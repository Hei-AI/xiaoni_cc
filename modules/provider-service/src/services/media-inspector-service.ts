import type { OpenResponseCreateRequest } from './llm-provider/types';

export type MediaInspectionStructuredResult = {
  description: string;
  summary: string | null;
  visible_text: string[];
  objects: string[];
  uncertainty: string[];
  safety_notes: string[];
  raw_response: string;
};

type MediaInspectionExecutorResult = {
  response?: string;
  model?: string;
  provider?: string | null;
  llm_call_id?: string | null;
};

type MediaInspectionExecutor = (payload: {
  trace_id?: string;
  agent_turn: number;
  agent_type: string;
  prompt_name: string;
  model: string;
  canonicalRequest: OpenResponseCreateRequest;
}) => Promise<MediaInspectionExecutorResult>;

export type InspectMediaImageInput = {
  imageUrl: string;
  traceId?: string;
  reason?: string;
  model?: string;
  defaultModel?: string;
};

const DEFAULT_MEDIA_INSPECTOR_MODEL = 'gpt-5.4-mini';
const DEFAULT_INSPECTION_REASON = '请客观描述这张图片里可见的内容。';

export const MEDIA_INSPECTOR_SYSTEM_PROMPT = [
  '你是一个无人格、无记忆、无聊天上下文的视觉识别子任务。',
  '你只能根据当前这张图片和任务意图回答；不要继承、猜测或引用任何主 agent 的上下文、人格、关系或历史。',
  '只描述图片中可见的事实。不要猜测隐私身份、动机、未出现的背景或用户意图。',
  '如果图片里有文字，尽量转写可见文字；看不清就明确写不确定。',
  '必须只输出一个 JSON 对象，不要输出 Markdown 或解释性正文。',
  'JSON schema: {"summary":"一句中文概述","visible_text":["可见文字"],"objects":["可见元素"],"uncertainty":["不确定点"],"safety_notes":["必要安全说明"]}'
].join('\n');

function normalizeOptionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

export function resolveMediaInspectorModel(input?: string | null, fallback?: string | null) {
  return normalizeOptionalText(input)
    || normalizeOptionalText(fallback)
    || DEFAULT_MEDIA_INSPECTOR_MODEL;
}

function normalizeInspectionReason(reason?: string) {
  const normalized = normalizeOptionalText(reason) || DEFAULT_INSPECTION_REASON;
  return truncateText(normalized, 500);
}

export function buildMediaInspectorCanonicalRequest(input: InspectMediaImageInput): OpenResponseCreateRequest {
  const model = resolveMediaInspectorModel(input.model, input.defaultModel);
  const reason = normalizeInspectionReason(input.reason);

  return {
    model,
    instructions: MEDIA_INSPECTOR_SYSTEM_PROMPT,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: [
              '任务意图：',
              reason,
              '',
              '请严格按 system 指定 JSON schema 输出。'
            ].join('\n')
          },
          {
            type: 'input_image',
            image_url: input.imageUrl
          }
        ]
      }
    ],
    temperature: 0,
    max_output_tokens: 900,
    store: false,
    metadata: {
      agent_type: 'media_inspector',
      context_policy: 'image_only_no_main_context'
    }
  };
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  if (candidate.startsWith('{') && candidate.endsWith('}')) {
    return candidate;
  }

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return candidate.slice(firstBrace, lastBrace + 1);
  }
  return null;
}

function normalizeStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean)
      .slice(0, 20);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function buildDescription(params: {
  summary: string | null;
  visibleText: string[];
  objects: string[];
  uncertainty: string[];
  safetyNotes: string[];
  fallback: string;
}) {
  const lines: string[] = [];
  if (params.summary) {
    lines.push(params.summary);
  }
  if (params.visibleText.length > 0) {
    lines.push(`可见文字：${params.visibleText.join(' / ')}`);
  }
  if (params.objects.length > 0) {
    lines.push(`可见元素：${params.objects.join('、')}`);
  }
  if (params.uncertainty.length > 0) {
    lines.push(`不确定点：${params.uncertainty.join('、')}`);
  }
  if (params.safetyNotes.length > 0) {
    lines.push(`安全说明：${params.safetyNotes.join('、')}`);
  }
  return lines.join('\n').trim() || params.fallback || '图片已读取，但没有得到有效描述。';
}

export function parseMediaInspectorResponse(responseText: string): MediaInspectionStructuredResult {
  const rawResponse = responseText.trim();
  const jsonObject = extractJsonObject(rawResponse);
  if (!jsonObject) {
    return {
      description: rawResponse || '图片已读取，但没有得到有效描述。',
      summary: rawResponse || null,
      visible_text: [],
      objects: [],
      uncertainty: [],
      safety_notes: [],
      raw_response: rawResponse
    };
  }

  try {
    const parsed = JSON.parse(jsonObject) as Record<string, unknown>;
    const summary = normalizeOptionalText(parsed.summary) || normalizeOptionalText(parsed.description);
    const visibleText = normalizeStringList(parsed.visible_text);
    const objects = normalizeStringList(parsed.objects);
    const uncertainty = normalizeStringList(parsed.uncertainty);
    const safetyNotes = normalizeStringList(parsed.safety_notes);
    return {
      description: buildDescription({
        summary,
        visibleText,
        objects,
        uncertainty,
        safetyNotes,
        fallback: rawResponse
      }),
      summary,
      visible_text: visibleText,
      objects,
      uncertainty,
      safety_notes: safetyNotes,
      raw_response: rawResponse
    };
  } catch {
    return {
      description: rawResponse || '图片已读取，但没有得到有效描述。',
      summary: rawResponse || null,
      visible_text: [],
      objects: [],
      uncertainty: [],
      safety_notes: [],
      raw_response: rawResponse
    };
  }
}

export async function inspectMediaImage(
  input: InspectMediaImageInput,
  executeAgentRequest: MediaInspectionExecutor
) {
  const model = resolveMediaInspectorModel(input.model, input.defaultModel);
  const canonicalRequest = buildMediaInspectorCanonicalRequest({
    ...input,
    model
  });
  const result = await executeAgentRequest({
    trace_id: input.traceId,
    agent_turn: 0,
    agent_type: 'media_inspector',
    prompt_name: 'runtime_media_inspect',
    model,
    canonicalRequest
  });
  const parsed = parseMediaInspectorResponse(result.response || '');

  return {
    ...parsed,
    model: result.model || model,
    provider: result.provider || null,
    llm_call_id: result.llm_call_id || null
  };
}

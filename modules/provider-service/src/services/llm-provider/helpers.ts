import type {
  OpenResponseCreateRequest,
  OpenResponseInputContentPart,
  OpenResponseInputItem,
  OpenResponseOutputItem,
  OpenResponseResource,
  OpenResponseToolChoice,
  OpenResponseToolDefinition,
  OpenResponseUsage
} from './types';

export interface NormalizedToolDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, any>;
}

export interface GeminiCompatibleUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface NormalizedUsageDetails {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  rawUsage: Record<string, any>;
}

export function cloneValue<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  const globalRef = global as typeof global & {
    structuredClone?: <K>(input: K) => K;
  };

  try {
    if (typeof globalRef.structuredClone === 'function') {
      return globalRef.structuredClone(value);
    }
  } catch {
    // ignore
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

export function estimateTokensFromText(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

export function estimateTokensFromContents(contents: any[]): number {
  if (!Array.isArray(contents) || contents.length === 0) {
    return 0;
  }

  let totalChars = 0;
  for (const content of contents) {
    if (!Array.isArray(content?.parts)) {
      continue;
    }

    for (const part of content.parts) {
      if (typeof part?.text === 'string') {
        totalChars += part.text.length;
      } else if (part?.functionResponse) {
        totalChars += JSON.stringify(part.functionResponse).length;
      }
    }
  }

  return Math.ceil(totalChars / 4);
}

export function normalizeSystemInstruction(systemInstruction: any): string | undefined {
  if (!systemInstruction) {
    return undefined;
  }

  if (typeof systemInstruction === 'string') {
    const trimmed = systemInstruction.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(systemInstruction?.parts)) {
    const text = systemInstruction.parts
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
    return text || undefined;
  }

  return undefined;
}

export function geminiContentsToOpenResponseInput(contents: any[], systemInstruction?: any): OpenResponseInputItem[] {
  const input: OpenResponseInputItem[] = [];
  const normalizedSystem = normalizeSystemInstruction(systemInstruction);

  for (const content of contents || []) {
    const role = content?.role === 'model'
      ? 'assistant'
      : (content?.role === 'system' || content?.role === 'developer' || content?.role === 'assistant'
        ? content.role
        : 'user');
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const normalizedParts: OpenResponseInputContentPart[] = [];

    for (const part of parts) {
      if (typeof part?.text === 'string') {
        normalizedParts.push({ type: 'input_text', text: part.text });
      } else if (part?.inlineData?.data) {
        normalizedParts.push({
          type: 'input_image',
          image_url: `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`
        });
      } else if (part?.functionResponse?.name) {
        normalizedParts.push({
          type: 'input_text',
          text: JSON.stringify(part.functionResponse.response || {})
        });
        input.push({
          type: 'function_call_output',
          call_id: part.functionResponse.name,
          output: JSON.stringify(part.functionResponse.response || {})
        });
      }
    }

    if (normalizedParts.length > 0) {
      input.push({ type: 'message', role, content: normalizedParts });
    }
  }

  if (normalizedSystem) {
    input.unshift({
      type: 'message',
      role: 'system',
      content: [{ type: 'input_text', text: normalizedSystem }]
    });
  }

  return input;
}

export function openResponseInputToOpenAIInput(
  input: string | OpenResponseInputItem[],
  instructions?: string
): any {
  if (typeof input === 'string') {
    return instructions
      ? [
          { role: 'system', content: [{ type: 'input_text', text: instructions }] },
          { role: 'user', content: [{ type: 'input_text', text: input }] }
        ]
      : input;
  }

  const normalizedInput: any[] = [];
  if (instructions) {
    normalizedInput.push({
      type: 'message',
      role: 'system',
      content: [{ type: 'input_text', text: instructions }]
    });
  }

  for (const item of input) {
    if (item.type === 'message') {
      normalizedInput.push({
        type: 'message',
        role: item.role,
        ...(typeof (item as { phase?: string }).phase === 'string'
          ? { phase: (item as { phase?: string }).phase }
          : {}),
        content: typeof item.content === 'string'
          ? item.content
          : item.content.map((part) => {
              if (part.type === 'input_text') {
                return part;
              }
              if (part.type === 'input_image' && part.image_url) {
                return {
                  type: 'input_image',
                  image_url: part.image_url
                };
              }
              return part;
            })
      });
      continue;
    }

    normalizedInput.push(item);
  }

  return normalizedInput;
}

export function openResponseInputToGeminiRequest(request: OpenResponseCreateRequest): {
  contents: any[];
  systemInstruction?: { parts: Array<{ text: string }> };
} {
  const contents: any[] = [];
  const systemParts: string[] = [];
  const input = typeof request.input === 'string'
    ? [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: request.input }] } satisfies OpenResponseInputItem]
    : request.input;

  if (request.instructions) {
    systemParts.push(request.instructions);
  }

  for (const item of input) {
    if (item.type === 'message') {
      const parts: any[] = typeof item.content === 'string'
        ? [{ text: item.content }]
        : item.content.flatMap((part): any[] => {
            if (part.type === 'input_text') {
              return [{ text: part.text }];
            }
            if (part.type === 'input_image' && part.image_url?.startsWith('data:')) {
              const match = /^data:([^;]+);base64,(.+)$/.exec(part.image_url);
              if (match) {
                return [{
                  inlineData: {
                    mimeType: match[1],
                    data: match[2]
                  }
                }];
              }
            }
            return [];
          });

      if (item.role === 'system' || item.role === 'developer') {
        const text = parts
          .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
          .filter(Boolean)
          .join('\n');
        if (text) {
          systemParts.push(text);
        }
        continue;
      }

      if (parts.length > 0) {
        contents.push({
          role: item.role === 'assistant' ? 'model' : item.role,
          parts
        });
      }
      continue;
    }

    if (item.type === 'function_call_output') {
      let responsePayload: any = item.output;
      if (typeof responsePayload === 'string') {
        try {
          responsePayload = JSON.parse(responsePayload);
        } catch {
          responsePayload = { output: responsePayload };
        }
      }
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: item.call_id,
            response: responsePayload
          }
        }]
      });
    }
  }

  return {
    contents,
    systemInstruction: systemParts.length > 0
      ? {
          parts: systemParts.map((text) => ({ text }))
        }
      : undefined
  };
}

export function geminiRequestToOpenResponseRequest(
  request: {
    contents?: any[];
    tools?: any[];
    generationConfig?: any;
    safetySettings?: any;
    systemInstruction?: any;
    model?: { name?: string };
    toolConfig?: any;
    metadata?: Record<string, string>;
    [key: string]: any;
  },
  modelName: string,
  providerConfig?: { generation?: any }
): OpenResponseCreateRequest {
  const generationConfig = request.generationConfig || providerConfig?.generation || {};
  // Keep systemInstruction as `instructions` instead of duplicating it into `input`.
  const input = geminiContentsToOpenResponseInput(request.contents || [], undefined);
  const instructionsFromSystem = normalizeSystemInstruction(request.systemInstruction);
  const tools = extractToolDeclarations(request.tools || []);
  const toolChoice = functionCallingModeToOpenAIToolChoice(request?.toolConfig?.functionCallingConfig?.mode);

  const normalizedTools: OpenResponseToolDefinition[] | undefined = tools.length > 0
    ? tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters || { type: 'object', properties: {} }
        }
      }))
    : undefined;

  const normalizedToolChoice: OpenResponseToolChoice | undefined = normalizedTools && normalizedTools.length > 0
    ? toolChoice
    : undefined;

  return {
    model: modelName,
    input,
    instructions: instructionsFromSystem,
    tools: normalizedTools,
    tool_choice: normalizedToolChoice,
    max_output_tokens: generationConfig.maxOutputTokens,
    temperature: generationConfig.temperature,
    top_p: generationConfig.topP,
    stop: Array.isArray(generationConfig.stopSequences) ? generationConfig.stopSequences : undefined,
    metadata: request.metadata
  };
}

export function extractToolDeclarations(tools: any[]): NormalizedToolDeclaration[] {
  if (!Array.isArray(tools) || tools.length === 0) {
    return [];
  }

  const declarations: NormalizedToolDeclaration[] = [];
  for (const tool of tools) {
    if (Array.isArray(tool?.functionDeclarations)) {
      for (const declaration of tool.functionDeclarations) {
        const normalized = normalizeToolDeclaration(declaration);
        if (normalized) {
          declarations.push(normalized);
        }
      }
      continue;
    }

    const normalized = normalizeToolDeclaration(tool);
    if (normalized) {
      declarations.push(normalized);
    }
  }

  return declarations;
}

export function normalizeToolDeclaration(input: any): NormalizedToolDeclaration | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const name = typeof input.name === 'string' ? input.name : input.id;
  if (!name || typeof name !== 'string') {
    return null;
  }

  let parameters = input.parameters;
  if (typeof parameters === 'string') {
    try {
      parameters = JSON.parse(parameters);
    } catch {
      parameters = undefined;
    }
  }

  return {
    name,
    description: typeof input.description === 'string' ? input.description : '',
    parameters: parameters && typeof parameters === 'object' ? parameters : undefined
  };
}

export function functionCallingModeToOpenAIToolChoice(mode?: string): 'auto' | 'required' | 'none' {
  const normalized = typeof mode === 'string' ? mode.toUpperCase() : 'AUTO';
  if (normalized === 'NONE') {
    return 'none';
  }
  if (normalized === 'ANY') {
    return 'required';
  }
  return 'auto';
}

export function toOpenResponseUsage(params: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  rawUsage?: Record<string, any>;
}): OpenResponseUsage {
  const inputTokens = params.inputTokens ?? 0;
  const outputTokens = params.outputTokens ?? 0;
  const totalTokens = params.totalTokens ?? (inputTokens + outputTokens);
  const rawUsage = params.rawUsage && typeof params.rawUsage === 'object' ? params.rawUsage : {};
  const inputTokenDetails = rawUsage.input_tokens_details && typeof rawUsage.input_tokens_details === 'object'
    ? cloneValue(rawUsage.input_tokens_details)
    : {};
  const outputTokenDetails = rawUsage.output_tokens_details && typeof rawUsage.output_tokens_details === 'object'
    ? cloneValue(rawUsage.output_tokens_details)
    : {};

  if (params.cachedInputTokens !== undefined) {
    inputTokenDetails.cached_tokens = params.cachedInputTokens;
  }
  if (params.reasoningTokens !== undefined) {
    outputTokenDetails.reasoning_tokens = params.reasoningTokens;
  }

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    ...(Object.keys(inputTokenDetails).length > 0 ? { input_tokens_details: inputTokenDetails } : {}),
    ...(Object.keys(outputTokenDetails).length > 0 ? { output_tokens_details: outputTokenDetails } : {})
  };
}

export function normalizeUsageDetails(rawUsage: any, fallbackOutputTokens: number = 0): NormalizedUsageDetails {
  const usage = rawUsage && typeof rawUsage === 'object' ? cloneValue(rawUsage) : {};
  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? fallbackOutputTokens);
  const totalTokens = Number(usage.total_tokens ?? (inputTokens + outputTokens));
  const inputTokenDetails = usage.input_tokens_details && typeof usage.input_tokens_details === 'object'
    ? usage.input_tokens_details
    : usage.prompt_tokens_details && typeof usage.prompt_tokens_details === 'object'
      ? usage.prompt_tokens_details
      : {};
  const outputTokenDetails = usage.output_tokens_details && typeof usage.output_tokens_details === 'object'
    ? usage.output_tokens_details
    : usage.completion_tokens_details && typeof usage.completion_tokens_details === 'object'
      ? usage.completion_tokens_details
      : {};

  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : fallbackOutputTokens,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : ((Number.isFinite(inputTokens) ? inputTokens : 0) + (Number.isFinite(outputTokens) ? outputTokens : fallbackOutputTokens)),
    cachedInputTokens: Number.isFinite(Number(inputTokenDetails.cached_tokens))
      ? Number(inputTokenDetails.cached_tokens)
      : 0,
    reasoningTokens: Number.isFinite(Number(outputTokenDetails.reasoning_tokens))
      ? Number(outputTokenDetails.reasoning_tokens)
      : 0,
    rawUsage: usage
  };
}

export function openResponseFromGeminiResponse(params: {
  model: string;
  text: string;
  rawResponse: any;
  inputTokens: number;
  outputTokens: number;
}): OpenResponseResource {
  const parts = Array.isArray(params.rawResponse?.candidates?.[0]?.content?.parts)
    ? params.rawResponse.candidates[0].content.parts
    : [];
  const output: OpenResponseOutputItem[] = [];
  const messageParts = parts
    .filter((part: any) => typeof part?.text === 'string')
    .map((part: any) => ({ type: 'output_text', text: part.text } as const));

  if (messageParts.length > 0 || params.text) {
    output.push({
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: messageParts.length > 0 ? messageParts : [{ type: 'output_text', text: params.text }]
    });
  }

  for (const part of parts) {
    if (part?.functionCall?.name) {
      output.push({
        type: 'function_call',
        call_id: part.functionCall.name,
        name: part.functionCall.name,
        arguments: JSON.stringify(part.functionCall.args || {}),
        status: 'completed'
      });
    }
  }

  return {
    status: 'completed',
    model: params.model,
    output_text: params.text,
    output,
    usage: toOpenResponseUsage({
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens
    })
  };
}

export function buildGeminiCompatibleResponseFromOpenResponse(
  response: OpenResponseResource,
  rawResponse?: any
): any {
  const text = extractTextFromOpenAIResponse(response);
  const functionCalls = extractFunctionCallsFromOpenAIResponse(response);
  return buildGeminiCompatibleResponse({
    text,
    functionCalls,
    rawResponse: rawResponse ?? response,
    usage: {
      promptTokenCount: response.usage?.input_tokens ?? 0,
      candidatesTokenCount: response.usage?.output_tokens ?? 0,
      totalTokenCount: response.usage?.total_tokens
        ?? ((response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0))
    }
  });
}

export function buildGeminiCompatibleResponse(params: {
  text: string;
  functionCalls?: Array<{ name: string; args?: Record<string, any> }>;
  rawResponse: any;
  usage?: GeminiCompatibleUsage;
}): any {
  const parts: any[] = [];

  if (params.text) {
    parts.push({ text: params.text });
  }

  for (const functionCall of params.functionCalls || []) {
    parts.push({
      functionCall: {
        name: functionCall.name,
        args: functionCall.args || {}
      }
    });
  }

  return {
    ...cloneValue(params.rawResponse),
    text: params.text,
    usageMetadata: {
      promptTokenCount: params.usage?.promptTokenCount ?? estimateTokensFromText(params.text),
      candidatesTokenCount: params.usage?.candidatesTokenCount ?? estimateTokensFromText(params.text),
      totalTokenCount:
        params.usage?.totalTokenCount ??
        ((params.usage?.promptTokenCount ?? 0) + (params.usage?.candidatesTokenCount ?? 0))
    },
    candidates: [
      {
        content: {
          parts
        }
      }
    ]
  };
}

export function extractTextFromGeminiResponse(response: any): string {
  if (!response) {
    return '';
  }

  if (typeof response?.text === 'string' && response.text.length > 0) {
    return response.text;
  }

  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .filter((part: any) => typeof part?.text === 'string')
    .map((part: any) => part.text)
    .join(' ');
}

export function extractFunctionCallsFromOpenAIResponse(response: any): Array<{ name: string; args: Record<string, any> }> {
  const calls: Array<{ name: string; args: Record<string, any> }> = [];
  const output = Array.isArray(response?.output) ? response.output : [];

  for (const item of output) {
    if (item?.type !== 'function_call' || typeof item?.name !== 'string') {
      continue;
    }

    let args: Record<string, any> = {};
    if (typeof item.arguments === 'string' && item.arguments.trim().length > 0) {
      try {
        args = JSON.parse(item.arguments);
      } catch {
        args = {};
      }
    } else if (item.arguments && typeof item.arguments === 'object') {
      args = item.arguments;
    }

    calls.push({ name: item.name, args });
  }

  return calls;
}

export function extractNamedFunctionCallArgsFromOpenAIResponse(
  response: any,
  functionName: string
): Record<string, any> | null {
  const calls = extractFunctionCallsFromOpenAIResponse(response);
  const match = calls.find((call) => call.name === functionName);
  return match?.args && typeof match.args === 'object' && !Array.isArray(match.args)
    ? match.args
    : null;
}

export function extractTextFromOpenAIResponse(response: any): string {
  if (typeof response?.output_text === 'string' && response.output_text.length > 0) {
    return response.output_text;
  }

  const output = Array.isArray(response?.output) ? response.output : [];
  const textParts: string[] = [];

  for (const item of output) {
    if (item?.type !== 'message' || !Array.isArray(item?.content)) {
      continue;
    }

    for (const part of item.content) {
      if (typeof part?.text === 'string') {
        textParts.push(part.text);
      } else if (typeof part?.output_text === 'string') {
        textParts.push(part.output_text);
      }
    }
  }

  return textParts.join('\n');
}

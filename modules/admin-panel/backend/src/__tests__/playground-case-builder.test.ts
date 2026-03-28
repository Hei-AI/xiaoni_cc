import winston from 'winston';
import {
  PlaygroundCaseBuilder,
  PlaygroundCompatibilityError,
  buildPlaygroundResponseTextFallback,
  buildPromptInputFromCanonicalRequest,
  buildProviderConfigFromBaselineSnapshot,
  summarizeToolCallsFromResponse,
  validatePlaygroundPromptInput,
  validatePlaygroundProviderConfig,
} from '../services/playground-case-builder';
import type {
  PlaygroundBaselineOutput,
  PlaygroundBaselineSnapshot,
  PlaygroundCase,
} from '../types/playground';

function createLogger(): winston.Logger {
  return winston.createLogger({ silent: true });
}

function createFakeDb() {
  return {
    executeQuery: jest.fn(),
    executeUpdate: jest.fn(),
    executeInsert: jest.fn(),
  };
}

describe('buildPromptInputFromCanonicalRequest', () => {
  it('fills system instruction from a plain string instruction', () => {
    const promptInput = buildPromptInputFromCanonicalRequest({
      instructions: 'System prompt',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hello' }],
        },
      ],
    });

    expect(promptInput.systemInstruction).toBe('System prompt');
    expect(promptInput.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('supports array and JSON-string-array instructions and deduplicates mirrored system messages', () => {
    const arrayPromptInput = buildPromptInputFromCanonicalRequest({
      instructions: ['first line', 'second line'],
      input: [
        {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: 'first line\nsecond line' }],
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'payload' }],
        },
      ],
    });

    const jsonPromptInput = buildPromptInputFromCanonicalRequest({
      instructions: '["json first","json second"]',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'payload' }],
        },
      ],
    });

    expect(arrayPromptInput.systemInstruction).toBe('first line\nsecond line');
    expect(arrayPromptInput.messages).toEqual([{ role: 'user', content: 'payload' }]);
    expect(jsonPromptInput.systemInstruction).toBe('json first\njson second');
    expect(jsonPromptInput.messages).toEqual([{ role: 'user', content: 'payload' }]);
  });
});

describe('buildProviderConfigFromBaselineSnapshot', () => {
  it('maps canonical request fields while preserving unified config fields', () => {
    const snapshot: PlaygroundBaselineSnapshot = {
      provider: 'openai',
      modelName: 'gpt-5.4',
      canonicalRequest: {
        tools: [{ type: 'function', name: 'lookup' }],
        tool_choice: 'required',
        temperature: 0.2,
        top_p: 0.9,
        max_output_tokens: 512,
        stop: ['END'],
      },
      effectiveUnifiedConfig: {
        model: {
          provider: 'openai',
          name: 'gpt-5.4',
          providerSpecific: { reasoningEffort: 'medium' },
        },
        generation: {
          topK: 64,
        },
        thinking: {
          includeThoughts: true,
          thinkingBudget: 2048,
        },
        safety: [{ policy: 'default' }],
        context: { trace: 'ctx' },
      },
    };

    const providerConfig = buildProviderConfigFromBaselineSnapshot(snapshot, 'openai');

    expect(providerConfig.model.provider).toBe('openai');
    expect(providerConfig.model.name).toBe('gpt-5.4');
    expect(providerConfig.model.providerSpecific).toEqual({ reasoningEffort: 'medium' });
    expect(providerConfig.generation).toMatchObject({
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 512,
      topK: 64,
      stopSequences: ['END'],
    });
    expect(providerConfig.thinking).toEqual({
      includeThoughts: true,
      thinkingBudget: 2048,
    });
    expect(providerConfig.safety).toEqual([{ policy: 'default' }]);
    expect(providerConfig.context).toEqual({ trace: 'ctx', promptTemplate: null });
    expect(providerConfig.tools).toEqual({
      definitions: [{ type: 'function', name: 'lookup' }],
      toolChoice: 'required',
    });
  });
});

describe('playground contract guards', () => {
  it('rejects system messages in prompt input', () => {
    expect(() => validatePlaygroundPromptInput({
      systemInstruction: 'system prompt',
      messages: [{ role: 'system', content: 'shadow prompt' }],
      contextVariables: {},
    })).toThrow(PlaygroundCompatibilityError);

    expect(() => validatePlaygroundPromptInput({
      systemInstruction: 'system prompt',
      messages: [{ role: 'user', content: 'hello' }],
      contextVariables: {},
    })).not.toThrow();
  });

  it('rejects unsupported tool config extras', () => {
    expect(() => validatePlaygroundProviderConfig({
      model: { provider: 'openai', name: 'gpt-5.4-mini', providerSpecific: {} },
      generation: {},
      thinking: {},
      safety: [],
      tools: {
        definitions: [{ type: 'function', function: { name: 'lookup' } }],
        toolChoice: 'required',
        customToolConfig: { enabled: true },
      },
      context: {},
    })).toThrow('Playground tools only support definitions and toolChoice');
  });
});

describe('tool-only fallback output', () => {
  it('summarizes tool calls from canonical response output', () => {
    const canonicalResponse = {
      output: [
        {
          type: 'function_call',
          name: 'lookup_weather',
          arguments: '{\n  \"city\": \"Shanghai\"\n}',
          call_id: 'call_123',
          status: 'completed',
        },
      ],
    };

    expect(summarizeToolCallsFromResponse(canonicalResponse)).toBe('lookup_weather({"city":"Shanghai"})');
    expect(buildPlaygroundResponseTextFallback({
      processedResponse: '',
      canonicalResponse,
      wireResponse: null,
    })).toBe('lookup_weather({"city":"Shanghai"})');
  });

  it('uses tool summary in baseline output when no assistant text exists', () => {
    const db = createFakeDb();
    const builder = new PlaygroundCaseBuilder(db as never, createLogger());
    const baselineOutput = (builder as any).buildBaselineOutput(
      null,
      {
        model_provider: 'openai',
        model_name: 'gpt-5.4',
        processed_response: '',
        canonical_response: JSON.stringify({
          output: [
            {
              type: 'function_call',
              name: 'finish',
              arguments: { reason: 'done' },
              call_id: 'call_456',
              status: 'completed',
            },
          ],
        }),
        wire_response: null,
        canonical_request: null,
        wire_request: null,
        input_tokens: 10,
        output_tokens: 1,
      },
      null
    );

    expect(baselineOutput).toMatchObject({
      sourceKind: 'llm_call',
      responseText: 'finish({"reason":"done"})',
    });
  });
});

describe('PlaygroundCaseBuilder.createCaseFromSpan', () => {
  it('refreshes an existing span case instead of returning stale data', async () => {
    const db = createFakeDb();
    const builder = new PlaygroundCaseBuilder(db as never, createLogger());
    const builderAny = builder as any;

    const existingCase: PlaygroundCase = {
      id: 'existing-case',
      name: 'Span · stale',
      source: 'span',
      sourceRef: 'trace-1:span-1',
      caseMode: 'contextual',
      traceContext: { traceId: 'trace-1', spanId: 'span-1' },
      promptId: null,
      promptModeDefault: 'draft',
      promptInput: { systemInstruction: '', messages: [], contextVariables: {} },
      providerConfig: {
        id: 'playground-provider',
        name: 'Playground Provider Config',
        category: 'playground',
        model: { name: 'old-model', provider: 'openai', providerSpecific: {} },
        generation: {},
        thinking: {},
        safety: [],
        tools: {},
        context: {},
        performance: {},
        version: {},
      },
      baselineSnapshot: null,
      currentPatch: null,
      importFidelity: 'exact',
      baselineOutput: null,
      rawEvidence: {},
      tags: ['span'],
      notes: null,
      isFavorite: false,
      createdBy: 'admin',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };

    const llmCall = {
      trace_id: 'trace-1',
      conversation_id: 'conversation-1',
      llm_call_id: 'llm-1',
      agent_turn: 3,
      model_provider: 'openai',
      model_name: 'gpt-5.4',
      canonical_request: JSON.stringify({
        instructions: ['refreshed instruction'],
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'hello again' }],
          },
        ],
      }),
      effective_unified_config: JSON.stringify({
        model: { provider: 'openai', name: 'gpt-5.4', providerSpecific: { reasoningEffort: 'medium' } },
        generation: { topK: 12 },
      }),
      canonical_response: null,
      wire_request: null,
      wire_response: null,
      request_format_version: 'v1',
      wire_provider_format: 'responses',
    };

    const baselineOutput: PlaygroundBaselineOutput = {
      sourceKind: 'llm_call',
      responseText: 'baseline output',
    };

    const savedCase: PlaygroundCase = {
      ...existingCase,
      name: 'Span · span-1',
      traceContext: {
        traceId: 'trace-1',
        conversationId: 'conversation-1',
        llmCallId: 'llm-1',
        agentTurn: 3,
        trafficLogId: null,
        spanId: 'span-1',
      },
      promptInput: {
        systemInstruction: 'refreshed instruction',
        messages: [{ role: 'user', content: 'hello again' }],
        contextVariables: {},
      },
      providerConfig: {
        ...existingCase.providerConfig,
        model: { name: 'gpt-5.4', provider: 'openai', providerSpecific: { reasoningEffort: 'medium' } },
        generation: { topK: 12 },
      },
      baselineOutput,
      rawEvidence: { spanId: 'span-1' },
      updatedAt: '2026-03-28T00:00:00.000Z',
    };

    builderAny.findExistingSpanCase = jest.fn().mockResolvedValue(existingCase);
    builderAny.loadLLMCallForSpan = jest.fn().mockResolvedValue(llmCall);
    builderAny.loadConversation = jest.fn().mockResolvedValue(null);
    builderAny.buildBaselineOutput = jest.fn().mockReturnValue(baselineOutput);
    builderAny.refreshSpanCase = jest.fn().mockResolvedValue(undefined);
    builderAny.persistCase = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(builder, 'getCaseById').mockResolvedValue(savedCase);

    const result = await builder.createCaseFromSpan('trace-1', 'span-1');

    expect(builderAny.refreshSpanCase).toHaveBeenCalledTimes(1);
    expect(builderAny.persistCase).not.toHaveBeenCalled();
    expect(builderAny.refreshSpanCase).toHaveBeenCalledWith(
      'existing-case',
      expect.objectContaining({
        id: 'existing-case',
        promptModeDefault: 'draft',
        promptId: null,
        promptInput: {
          systemInstruction: 'refreshed instruction',
          messages: [{ role: 'user', content: 'hello again' }],
          contextVariables: {},
        },
      })
    );
    expect(result).toBe(savedCase);
  });
});

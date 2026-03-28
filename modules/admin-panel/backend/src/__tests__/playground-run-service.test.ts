import winston from 'winston';
import { PlaygroundRunService } from '../services/playground-run-service';
import type { PlaygroundCase, PlaygroundProviderConfig, PlaygroundPromptInput } from '../types/playground';

function createLogger(): winston.Logger {
  return winston.createLogger({ silent: true });
}

function createProviderConfig(overrides: Partial<PlaygroundProviderConfig> = {}): PlaygroundProviderConfig {
  return {
    model: { provider: 'openai', name: 'gpt-5.4-mini', providerSpecific: {} },
    generation: {},
    thinking: {},
    safety: [],
    tools: {},
    context: {},
    ...overrides,
  };
}

function createPromptInput(overrides: Partial<PlaygroundPromptInput> = {}): PlaygroundPromptInput {
  return {
    systemInstruction: 'System prompt',
    messages: [{ role: 'user', content: 'hello' }],
    contextVariables: {},
    ...overrides,
  };
}

function createCaseRecord(overrides: Partial<PlaygroundCase> = {}): PlaygroundCase {
  return {
    id: 'case-1',
    name: 'Span Case',
    source: 'span',
    sourceRef: 'trace-1:span-1',
    caseMode: 'contextual',
    traceContext: {
      traceId: 'trace-1',
      conversationId: 'conversation-1',
      llmCallId: 'llm-1',
      spanId: 'span-1',
      agentTurn: 1,
    },
    promptId: null,
    promptModeDefault: 'draft',
    promptInput: createPromptInput(),
    providerConfig: createProviderConfig(),
    baselineSnapshot: {
      provider: 'openai',
      modelName: 'gpt-5.4-mini',
      canonicalRequest: {
        model: 'gpt-5.4-mini',
        instructions: 'System prompt',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'hello' }],
          },
        ],
      },
    },
    currentPatch: null,
    importFidelity: 'exact',
    baselineOutput: {
      sourceKind: 'llm_call',
      responseText: 'baseline',
    },
    rawEvidence: {},
    tags: ['span'],
    notes: null,
    isFavorite: false,
    createdBy: 'admin',
    createdAt: '2026-03-28T00:00:00.000Z',
    updatedAt: '2026-03-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('PlaygroundRunService.createRun', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('rejects prompt input messages with system role', async () => {
    const db = {
      executeInsert: jest.fn(),
      executeQuery: jest.fn(),
      executeUpdate: jest.fn(),
    };
    const caseBuilder = {
      getCaseById: jest.fn().mockResolvedValue(createCaseRecord()),
      listRunsByCase: jest.fn().mockResolvedValue([]),
      getRunById: jest.fn(),
    };
    const service = new PlaygroundRunService(db as never, createLogger(), caseBuilder as never);

    await expect(service.createRun({
      caseId: 'case-1',
      promptMode: 'draft',
      providerConfig: createProviderConfig(),
      promptInput: createPromptInput({
        messages: [{ role: 'system', content: 'shadow prompt' }],
      }),
    })).rejects.toThrow('Use systemInstruction instead');

    expect(caseBuilder.getCaseById).toHaveBeenCalledWith('case-1');
    expect(global.fetch).toBe(originalFetch);
  });

  it('rejects provider tool config extras', async () => {
    const db = {
      executeInsert: jest.fn(),
      executeQuery: jest.fn(),
      executeUpdate: jest.fn(),
    };
    const caseBuilder = {
      getCaseById: jest.fn().mockResolvedValue(createCaseRecord()),
      listRunsByCase: jest.fn().mockResolvedValue([]),
      getRunById: jest.fn(),
    };
    const service = new PlaygroundRunService(db as never, createLogger(), caseBuilder as never);

    await expect(service.createRun({
      caseId: 'case-1',
      promptMode: 'draft',
      providerConfig: createProviderConfig({
        tools: {
          definitions: [],
          toolChoice: 'auto',
          customToolConfig: { enabled: true },
        },
      }),
      promptInput: createPromptInput(),
    })).rejects.toThrow('Playground tools only support definitions and toolChoice');
  });

  it('uses tool-call summary as responseText for tool-only span replay runs', async () => {
    const db = {
      executeInsert: jest.fn(),
      executeQuery: jest.fn(),
      executeUpdate: jest.fn(),
    };
    const caseRecord = createCaseRecord();
    const caseBuilder = {
      getCaseById: jest.fn().mockResolvedValue(caseRecord),
      listRunsByCase: jest.fn().mockResolvedValue([]),
      getRunById: jest.fn(),
    };
    const service = new PlaygroundRunService(db as never, createLogger(), caseBuilder as never);
    const persistRunSpy = jest.spyOn(service as any, 'persistRun').mockImplementation(async (params: any) => ({
      id: 'run-1',
      caseId: params.caseRecord.id,
      executionMode: params.executionMode,
      promptMode: params.promptMode,
      promptId: params.promptId || null,
      promptSnapshot: params.promptSnapshot,
      providerConfigSnapshot: params.providerConfig,
      inputSnapshot: params.promptInput,
      baselineSnapshot: params.baselineSnapshot || null,
      requestPatch: params.requestPatch || null,
      effectiveRequest: params.effectiveRequest || null,
      effectiveConfig: params.effectiveConfig || null,
      outputSnapshot: params.outputSnapshot,
      comparisonSnapshot: params.comparisonSnapshot,
      diffSnapshot: params.diffSnapshot || null,
      modelName: params.modelName,
      provider: params.provider,
      status: params.status,
      executedBy: params.executedBy,
      createdAt: '2026-03-28T00:00:00.000Z',
    }));

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        provider: 'openai',
        model: 'gpt-5.4-mini',
        response: '',
        canonical_response: {
          output: [
            {
              type: 'function_call',
              name: 'lookup_weather',
              arguments: '{\"city\":\"Shanghai\"}',
              call_id: 'call_789',
              status: 'completed',
            },
          ],
        },
        wire_response: null,
      }),
    } as Response);

    const result = await service.createRun({
      caseId: 'case-1',
      promptMode: 'draft',
      providerConfig: createProviderConfig(),
      promptInput: createPromptInput(),
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(persistRunSpy).toHaveBeenCalledTimes(1);
    expect(result.outputSnapshot?.responseText).toBe('lookup_weather({"city":"Shanghai"})');
    expect(result.comparisonSnapshot).toMatchObject({
      hasBaseline: true,
      currentText: 'lookup_weather({"city":"Shanghai"})',
    });
  });
});

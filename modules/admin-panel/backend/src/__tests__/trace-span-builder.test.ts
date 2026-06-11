import winston from 'winston';
import {
  listRuntimeIdentityActivationTraces,
  listIdentityEvidenceRefs,
  listTraceTrafficLogs,
  listAgentStackItems,
  listLlmRequestSlices,
  listToolExecutions
} from '@qq-bot/persistence';
import { buildConversationTracePayload, buildConversationTraceSpanDetail } from '../services/trace-span-builder';

jest.mock('@qq-bot/persistence', () => ({
  listRuntimeIdentityActivationTraces: jest.fn(),
  listIdentityEvidenceRefs: jest.fn(),
  listTraceTrafficLogs: jest.fn(),
  listAgentStackItems: jest.fn(),
  listLlmRequestSlices: jest.fn(),
  listToolExecutions: jest.fn(),
  parseInstantValue: jest.fn((value: unknown) => {
    if (!value) {
      return null;
    }
    const parsed = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }),
  serializeTimestampForApi: jest.fn((value: unknown) => {
    if (!value) {
      return null;
    }
    const parsed = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }),
}));

function createLogger(): winston.Logger {
  return winston.createLogger({ silent: true });
}

function createDatabase() {
  const conversation = {
    id: 'conversation-1',
    trace_id: 'trace-1',
    batch_id: 'batch-1',
    user_id: 'user-1',
    group_id: null,
    user_message: 'hello',
    ai_response: 'hi',
    status: 'completed',
    error_reason: null,
    response_time: 1200,
    model_name: 'gpt-5.4-mini',
    raw_request: JSON.stringify({ prompt: 'hello' }),
    timestamp: '2026-03-28T10:00:00.000Z',
  };

  return {
    executeQuery: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM conversations')) {
        return [conversation];
      }
      if (sql.includes('FROM llm_request_slices')) {
        return [{
          id: 11,
          slice_id: params[0] || 'slice-1',
          llm_call_id: 'llm-call-1',
          trace_id: 'trace-1',
          run_id: 'run-1',
          conversation_id: 'conversation-1',
          agent_turn: 1,
          created_at: '2026-03-28T10:00:01.000Z',
          completed_at: '2026-03-28T10:00:03.000Z',
          status: 'completed',
          model_name: 'gpt-5.4-mini',
          model_provider: 'codex',
          canonical_request: { model: 'gpt-5.4-mini', input: [{ role: 'user', content: 'hello' }] },
          wire_request: { model: 'gpt-5.4-mini', input: [{ role: 'user', content: 'hello' }] },
          canonical_response: { output_text: 'hi' },
          wire_response: { id: 'resp-1' },
          raw_response: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }] },
          output_items: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }],
          token_usage: { input_tokens: 10, output_tokens: 20 },
          input_start_index: 1,
          input_end_index: 2,
          output_start_index: 3,
          output_end_index: 3,
          request_format_version: 'openresponse/v1',
          wire_provider_format: 'codex/responses',
          processing_time_ms: 2000,
          metadata: {}
        }];
      }
      if (sql.includes('FROM tool_executions')) {
        return [{
          id: 21,
          execution_id: 'tool:run-1:call-1',
          llm_request_slice_id: 'slice-1',
          llm_call_id: 'llm-call-1',
          tool_call_id: 'call-1',
          tool_name: 'recover_energy',
          arguments: { reason: 'done' },
          raw_arguments: '{"reason":"done"}',
          result: { status_text: 'resting' },
          status: 'completed',
          side_effect: true,
          trace_id: 'trace-1',
          run_id: 'run-1',
          conversation_id: 'conversation-1',
          agent_turn: 1,
          started_at: '2026-03-28T10:00:03.000Z',
          completed_at: '2026-03-28T10:00:04.000Z',
          metadata: {}
        }];
      }
      if (sql.includes('FROM websocket_logs')
        || sql.includes('FROM timeline_events')
        || sql.includes('FROM llm_jobs')
        || sql.includes('FROM agent_queue_messages')) {
        return [];
      }
      return [];
    }),
  };
}

describe('buildConversationTracePayload', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (listRuntimeIdentityActivationTraces as jest.Mock).mockResolvedValue([]);
    (listIdentityEvidenceRefs as jest.Mock).mockResolvedValue([]);
    (listTraceTrafficLogs as jest.Mock).mockResolvedValue([]);
    (listLlmRequestSlices as jest.Mock).mockResolvedValue([{
      id: '11',
      sliceId: 'slice-1',
      llmCallId: 'llm-call-1',
      traceId: 'trace-1',
      runId: 'run-1',
      conversationId: 'conversation-1',
      agentTurn: 1,
      createdAt: '2026-03-28T10:00:01.000Z',
      completedAt: '2026-03-28T10:00:03.000Z',
      status: 'completed',
      modelName: 'gpt-5.4-mini',
      modelProvider: 'codex',
      canonicalRequest: { model: 'gpt-5.4-mini' },
      wireRequest: { model: 'gpt-5.4-mini' },
      canonicalResponse: { output_text: 'hi' },
      wireResponse: { id: 'resp-1' },
      rawResponse: { output: [{ type: 'message' }] },
      outputItems: [{ type: 'message' }],
      tokenUsage: { input_tokens: 10, output_tokens: 20 },
      inputStartIndex: 1,
      inputEndIndex: 2,
      outputStartIndex: 3,
      outputEndIndex: 3,
      requestFormatVersion: 'openresponse/v1',
      wireProviderFormat: 'codex/responses',
      processingTimeMs: 2000,
      metadata: {}
    }]);
    (listToolExecutions as jest.Mock).mockResolvedValue([{
      id: '21',
      executionId: 'tool:run-1:call-1',
      llmRequestSliceId: 'slice-1',
      llmCallId: 'llm-call-1',
      toolCallId: 'call-1',
      toolName: 'recover_energy',
      arguments: { reason: 'done' },
      rawArguments: '{"reason":"done"}',
      result: { status_text: 'resting' },
      status: 'completed',
      sideEffect: true,
      traceId: 'trace-1',
      runId: 'run-1',
      conversationId: 'conversation-1',
      agentTurn: 1,
      startedAt: '2026-03-28T10:00:03.000Z',
      completedAt: '2026-03-28T10:00:04.000Z',
      metadata: {}
    }]);
    (listAgentStackItems as jest.Mock).mockResolvedValue([{
      id: '31',
      eventId: 'stack:item-1',
      llmRequestSliceId: 'slice-1',
      itemKind: 'function_call',
      content: { type: 'function_call', call_id: 'call-1', name: 'recover_energy' },
      traceId: 'trace-1',
      runId: 'run-1',
      conversationId: 'conversation-1',
      createdAt: '2026-03-28T10:00:02.000Z',
      metadata: {}
    }]);
  });

  it('builds trace spans from llm_request_slices and tool_executions', async () => {
    const db = createDatabase();

    const payload = await buildConversationTracePayload(db as never, createLogger(), 'conversation-1');

    expect(payload?.spans.some((span) => span.span_id === 'stack-slice:slice-1')).toBe(true);
    expect(payload?.spans.some((span) => span.span_id === 'tool-call:call-1')).toBe(true);
    expect(payload?.raw_evidence.llm_request_slices).toHaveLength(1);
    expect(payload?.raw_evidence.tool_executions).toHaveLength(1);
    expect(db.executeQuery).not.toHaveBeenCalledWith(expect.stringContaining('llm_call_logs'), expect.anything());
    expect(db.executeQuery).not.toHaveBeenCalledWith(expect.stringContaining('tool_execution_logs'), expect.anything());
  });
});

describe('buildConversationTraceSpanDetail', () => {
  it('loads stack slice request and response detail from llm_request_slices', async () => {
    const detail = await buildConversationTraceSpanDetail(
      createDatabase() as never,
      createLogger(),
      'conversation-1',
      'stack-slice:slice-1'
    );

    expect(detail?.input).toMatchObject({
      canonical_request: { model: 'gpt-5.4-mini' },
      wire_request: { model: 'gpt-5.4-mini' }
    });
    expect(detail?.output).toMatchObject({
      canonical_response: { output_text: 'hi' },
      wire_response: { id: 'resp-1' }
    });
  });
});

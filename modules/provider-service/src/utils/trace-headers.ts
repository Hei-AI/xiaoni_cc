export interface TraceCorrelationContext {
  traceId?: string;
  conversationId?: string;
  agentTurn?: number;
  llmCallId?: string;
  toolCallId?: string;
}

export function buildTraceHeaders(
  context?: TraceCorrelationContext
): Record<string, string> {
  if (!context) {
    return {};
  }

  const headers: Record<string, string> = {};

  if (context.traceId) {
    headers['x-trace-id'] = context.traceId;
  }
  if (context.conversationId) {
    headers['x-conversation-id'] = context.conversationId;
  }
  if (typeof context.agentTurn === 'number' && Number.isFinite(context.agentTurn)) {
    headers['x-agent-turn'] = String(context.agentTurn);
  }
  if (context.llmCallId) {
    headers['x-llm-call-id'] = context.llmCallId;
  }
  if (context.toolCallId) {
    headers['x-tool-call-id'] = context.toolCallId;
  }

  return headers;
}

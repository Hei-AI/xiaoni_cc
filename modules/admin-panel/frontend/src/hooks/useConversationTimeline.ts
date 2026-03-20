import { useQuery } from '@tanstack/react-query';
import { LLMFlowResponse, ConversationTimelineData, TimelineNode, ENGINE_NAMES, LLMCallRecord, ProcessingEvent } from '../types';

const SAFE_STATUS: Array<LLMCallRecord['output']['status']> = ['SUCCESS', 'ERROR', 'TIMEOUT', 'SKIPPED'];

const safeJsonParse = <T>(value: any): T | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch (err) {
      console.warn('🔥 TIMELINE WARN: Failed to parse JSON field', { value, err });
      return undefined;
    }
  }

  if (typeof value === 'object') {
    return value as T;
  }

  return undefined;
};

const toNumber = (value: any, fallback = 0): number => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const normalizeStatus = (status: any): LLMCallRecord['output']['status'] => {
  const upper = (status ?? '').toString().toUpperCase();
  if (SAFE_STATUS.includes(upper as LLMCallRecord['output']['status'])) {
    return upper as LLMCallRecord['output']['status'];
  }
  return upper.includes('SUCCESS') ? 'SUCCESS' : 'ERROR';
};

const isModernCallChain = (chain: any): chain is LLMCallRecord[] => {
  return Array.isArray(chain) && chain.length > 0 && chain.every(call => call && typeof call === 'object' && call.input && call.output);
};

const normalizeCallChainRecords = (
  calls: any[] = [],
  fallbackTimestamp?: string
): LLMCallRecord[] => {
  return calls.map((rawCall, index) => {
    const parsedCanonicalRequest = safeJsonParse<any>(rawCall?.canonical_request);
    const parsedWireRequest = safeJsonParse<any>(rawCall?.wire_request);
    const parsedCanonicalResponse = safeJsonParse<any>(rawCall?.canonical_response);
    const parsedWireResponse = safeJsonParse<any>(rawCall?.wire_response);
    const parsedTokenUsage = safeJsonParse<any>(rawCall?.token_usage) ?? {};

    const promptTokens = toNumber(parsedTokenUsage.input_tokens ?? rawCall?.input_tokens, 0);
    const completionTokens = toNumber(parsedTokenUsage.output_tokens ?? rawCall?.output_tokens, 0);
    const totalTokens = toNumber(parsedTokenUsage.total_tokens, promptTokens + completionTokens);

    const apiCallTimeMs = toNumber(rawCall?.api_call_time_ms, toNumber(rawCall?.processing_time_ms, 0));
    const processingTimeMs = toNumber(rawCall?.processing_time_ms, apiCallTimeMs);
    const queueWaitMs = toNumber(rawCall?.queue_wait_time_ms, 0);
    const rawCostEstimate = rawCall?.cost_estimate;
    const numericCostEstimate = rawCostEstimate !== undefined && rawCostEstimate !== null ? Number(rawCostEstimate) : undefined;
    const costEstimate = numericCostEstimate !== undefined && Number.isFinite(numericCostEstimate) ? numericCostEstimate : undefined;
    const timestampIso = rawCall?.timestamp || fallbackTimestamp || new Date().toISOString();
    const status = normalizeStatus(rawCall?.status);

    return {
      sequence: rawCall?.call_sequence ?? index + 1,
      stage: rawCall?.stage || 'llm_pipeline',
      agent_type: rawCall?.agent_type || 'unknown',
      purpose: rawCall?.purpose || rawCall?.prompt_template || rawCall?.tool_name || 'llm_call',
      input: {
        model_name: rawCall?.model_name || 'unknown',
        model_provider: rawCall?.model_provider || 'unknown',
        prompt_template: rawCall?.prompt_template || 'default',
        canonical_request: parsedCanonicalRequest,
        wire_request: parsedWireRequest,
        request_format_version: rawCall?.request_format_version || undefined,
        wire_provider_format: rawCall?.wire_provider_format || undefined,
        timestamp: timestampIso
      },
      output: {
        status,
        canonical_response: parsedCanonicalResponse,
        wire_response: parsedWireResponse,
        processed_response: rawCall?.processed_response,
        token_usage: {
          input_tokens: promptTokens,
          output_tokens: completionTokens,
          total_tokens: totalTokens
        },
        performance: {
          api_call_time_ms: apiCallTimeMs,
          processing_time_ms: processingTimeMs,
          queue_wait_time_ms: queueWaitMs
        },
        cost_estimate: costEstimate,
        error_info: rawCall?.error_message
          ? {
              error_message: rawCall.error_message,
              error_code: rawCall.error_code ?? 'UNKNOWN_ERROR',
              retry_count: toNumber(rawCall.retry_count, 0)
            }
          : undefined,
        timestamp: timestampIso
      }
    };
  });
};

const normalizeCallChain = (flow: LLMFlowResponse, fallbackTimestamp?: string): LLMCallRecord[] => {
  if (isModernCallChain(flow.llm_call_chain)) {
    return flow.llm_call_chain;
  }
  return normalizeCallChainRecords(flow.llm_call_chain || [], fallbackTimestamp);
};

// Helper function to calculate cost (rough estimation)
const calculateCost = (trace: any): number => {
  const promptTokens = trace.input_tokens || trace.prompt_tokens || 0;
  const completionTokens = trace.output_tokens || trace.completion_tokens || 0;

  // Rough pricing: $0.001 per 1000 tokens for prompt, $0.002 per 1000 tokens for completion
  const promptCost = (promptTokens / 1000) * 0.001;
  const completionCost = (completionTokens / 1000) * 0.002;

  return Math.round((promptCost + completionCost) * 1000) / 1000; // Round to 3 decimal places
};

// Helper function to extract confidence from response
const extractConfidence = (response: any): number => {
  // Try to extract confidence from response, default to 0.8
  if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
    // Look for confidence patterns in the text
    const text = response.candidates[0].content.parts[0].text;
    const confidenceMatch = text.match(/confidence[:\s]*(\d+\.?\d*)/i);
    if (confidenceMatch) {
      return parseFloat(confidenceMatch[1]);
    }
  }
  return 0.8; // Default confidence
};

// Build timeline nodes from LLM flow data
const buildTimelineNodes = (llmFlowData: LLMFlowResponse): TimelineNode[] => {
  const nodes: TimelineNode[] = [];

  // 🔥 优先使用新的 llm_call_chain 结构 (MESSAGE_FLOW_API规范)
  const llmCalls = llmFlowData.llm_call_chain;

  if (llmCalls.length > 0) {
    // 使用新的扁平化 llm_call_chain 结构
    llmCalls.forEach((call, index) => {
      const agentType = call.agent_type || 'unknown';
      const title = ENGINE_NAMES[agentType] || `${agentType}`;
      const isSuccess = call.output.status === 'SUCCESS';

      // 从新的结构中获取处理时间
      const processingTime = call.output.performance.processing_time_ms || call.output.performance.api_call_time_ms || 0;

      // 从新的结构中获取token信息
      const totalTokens = call.output.token_usage.total_tokens || 0;

      nodes.push({
        id: `llm_${index}`,
        timestamp: new Date(call.input.timestamp),
        type: 'llm_call',
        title: title,
        duration_ms: processingTime,
        status: isSuccess ? 'success' : 'error',
        summary: `模型: ${call.input.model_name} | 耗时: ${processingTime}ms`,
        data: {
          input: call.input,
          output: call.output,
          model_name: call.input.model_name,
          agent_type: agentType,
          prompt_tokens: call.output.token_usage.input_tokens || 0,
          completion_tokens: call.output.token_usage.output_tokens || 0,
          total_tokens: totalTokens,
          processing_time_ms: processingTime,
          api_call_time_ms: call.output.performance.api_call_time_ms || 0,
          success: isSuccess,
          status: call.output.status,
          error_message: call.output.error_info?.error_message,
          cost: call.output.cost_estimate || calculateCost(call.output),
          confidence: extractConfidence(call.output.wire_response)
        }
      });
    });
  }

  // 🔥 防御性排序：处理时间戳异常和确保稳定排序
  return nodes.sort((a, b) => {
    const timeDiff = a.timestamp.getTime() - b.timestamp.getTime();
    if (timeDiff !== 0) return timeDiff;

    // 时间戳相同时，按照ID排序确保稳定性
    return a.id.localeCompare(b.id);
  });
};

// Calculate timeline summary (with new API flow_summary support)
const calculateTimelineSummary = (nodes: TimelineNode[], flowSummary?: any) => {
  // 🔥 优先使用新API提供的flow_summary数据
  if (flowSummary) {
    return {
      total_duration: flowSummary.total_processing_time_ms || flowSummary.llm_processing_time_ms || 0,
      total_cost: flowSummary.total_cost_estimate || 0,
      total_tokens: flowSummary.total_tokens_used || 0,
      success_rate: flowSummary.success_rate || 0,
      efficiency_score: flowSummary.efficiency_score || 0,
      // 新增字段
      queue_wait_time: flowSummary.queue_wait_time_ms || 0,
      bottleneck_stage: flowSummary.bottleneck_stage
    };
  }

  // 回退到客户端计算
  const llmNodes = nodes.filter(node => node.type === 'llm_call');

  const totalDuration = llmNodes.reduce((sum, node) => sum + (node.duration_ms || 0), 0);
  const totalCost = llmNodes.reduce((sum, node) => sum + (node.data.cost || 0), 0);
  const totalTokens = llmNodes.reduce((sum, node) => {
    const promptTokens = node.data.prompt_tokens || node.data.input_tokens || 0;
    const completionTokens = node.data.completion_tokens || node.data.output_tokens || 0;
    return sum + promptTokens + completionTokens;
  }, 0);
  const successCount = llmNodes.filter(node => node.status === 'success').length;
  const successRate = llmNodes.length > 0 ? (successCount / llmNodes.length) * 100 : 100;

  return {
    total_duration: totalDuration,
    total_cost: Math.round(totalCost * 1000) / 1000,
    total_tokens: totalTokens,
    success_rate: Math.round(successRate * 10) / 10,
    efficiency_score: 80, // 默认值
    queue_wait_time: 0,
    bottleneck_stage: undefined
  };
};

export const useConversationTimeline = (conversationId: string, autoRefreshEnabled: boolean = true) => {
  return useQuery({
    queryKey: ['conversationTimeline', conversationId],
    queryFn: async (): Promise<ConversationTimelineData> => {
      const response = await fetch(`/api/debug/conversation/${conversationId}/llm-flow`);

      if (!response.ok) {
        throw new Error(`Failed to fetch conversation timeline: ${response.statusText}`);
      }

      const llmFlowData: LLMFlowResponse = await response.json();
      if (!llmFlowData.message_input || !llmFlowData.message_output || !Array.isArray(llmFlowData.llm_call_chain) || !Array.isArray(llmFlowData.processing_events)) {
        throw new Error('Malformed llm-flow response: missing canonical timeline fields');
      }

      const normalizedCallChain = normalizeCallChain(llmFlowData, llmFlowData.message_output.timestamp);
      const normalizedProcessingEvents: ProcessingEvent[] = llmFlowData.processing_events;
      const normalizedFlowData: LLMFlowResponse = {
        ...llmFlowData,
        llm_call_chain: normalizedCallChain,
        processing_events: normalizedProcessingEvents
      };

      const timelineNodes = buildTimelineNodes(normalizedFlowData);
      const timelineSummary = calculateTimelineSummary(timelineNodes, normalizedFlowData.flow_summary);

      const queuedTimestampMs = Date.parse(normalizedFlowData.message_input.queued_at);
      const websocketInput = {
        ...normalizedFlowData.message_input,
        raw_message: normalizedFlowData.message_input.message,
        message_id: normalizedFlowData.message_input.message_id ?? Date.now(),
        time: Number.isFinite(queuedTimestampMs) ? Math.floor(queuedTimestampMs / 1000) : Math.floor(Date.now() / 1000)
      };

      const websocketOutput = {
        content: normalizedFlowData.message_output.content,
        response_time_ms: normalizedFlowData.message_output.response_time_ms,
        model: normalizedFlowData.message_output.model_used,
        timestamp: normalizedFlowData.message_output.timestamp
      };

      return {
        conversation_id: conversationId,
        trace_id: normalizedFlowData.trace_id,
        message_input: normalizedFlowData.message_input,
        message_output: normalizedFlowData.message_output,
        llm_call_chain: normalizedCallChain,
        processing_events: normalizedFlowData.processing_events,
        flow_summary: normalizedFlowData.flow_summary,
        debug_info: normalizedFlowData.debug_info,
        websocket_input: websocketInput,
        websocket_output: websocketOutput,
        timeline_nodes: timelineNodes,
        timeline_events: normalizedFlowData.processing_events,
        timeline_summary: timelineSummary
      };
    },
    refetchInterval: autoRefreshEnabled ? 30000 : false, // Conditional auto-refresh
    enabled: !!conversationId, // Only run query if conversationId exists
  });
};
